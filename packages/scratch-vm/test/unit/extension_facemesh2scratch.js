/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const loader = require('../../src/extensions/scratch3_facemesh2scratch/loader');
const Facemesh = require('../../src/extensions/scratch3_facemesh2scratch');

const SRC_DIR = path.join(__dirname, '../../src/extensions/scratch3_facemesh2scratch');

// ---------- 測試用的假物件 ----------
const makeRuntime = ({camera = true} = {}) => {
    const video = {
        mirror: true,
        enabled: 0,
        disabled: 0,
        provider: {video: null},
        enableVideo () {
            this.enabled++;
            this.provider.video = camera ? {readyState: 4} : null;
            return Promise.resolve();
        },
        disableVideo () {
            this.disabled++;
            this.provider.video = null;
        },
        setPreviewGhost () {}
    };
    return {ioDevices: {video}};
};

const makeUi = () => {
    const shown = [];
    return {shown, show: (text, opts = {}) => shown.push({text, kind: opts.kind || 'info'}), hide: () => {}};
};

/** 手動推進的排程：測試自己決定什麼時候跑下一次辨識。 */
const makeSchedule = () => {
    const queue = [];
    const schedule = fn => queue.push(fn);
    schedule.runNext = async () => {
        const fn = queue.shift();
        if (fn) await fn();
    };
    schedule.pending = () => queue.length;
    return schedule;
};

const face = (x, y) => ({scaledMesh: [[x, y, 0], [x + 10, y + 10, 0]]});

/** 假的 ml5：results 是每次辨識依序回傳的結果。 */
const makeMl5 = (results, counters = {}) => ({
    facemesh: () => {
        counters.loads = (counters.loads || 0) + 1;
        return Promise.resolve({
            model: {estimateFaces: () => Promise.resolve(results.length > 1 ? results.shift() : results[0])}
        });
    }
});

/** 468 個點的臉：第 i 點在影像的 (x0 + i, y0 + i/2)。 */
const meshFace = (x0 = 0, y0 = 0) => {
    const pts = [];
    for (let i = 0; i < 468; i++) pts.push([x0 + i, y0 + (i / 2), 0]);
    return {scaledMesh: pts};
};

const makeOverlay = () => ({draws: [], clears: 0, draw (b) { this.draws.push(b); }, clear () { this.clears++; }});

const make = async ({results = [[]], camera = true, loadMl5, counters = {}, vision, overlay, now} = {}) => {
    const runtime = makeRuntime({camera});
    const ui = makeUi();
    const schedule = makeSchedule();
    const scope = {fetch: () => Promise.resolve('real')};
    const ext = new Facemesh(runtime, {
        loadMl5: loadMl5 || (() => Promise.resolve(makeMl5(results, counters))),
        ui,
        schedule,
        scope,
        vision,
        overlay: overlay || makeOverlay(),
        now
    });
    await ext.ready;
    // 第一次辨識是非同步的，等它跑完
    await new Promise(resolve => setImmediate(resolve));
    return {ext, runtime, ui, schedule, scope, counters, overlay: ext._overlay};
};

const P1 = {PERSON_NUMBER: '1', KEYPOINT: '1'};

// ---------- 模型自架 ----------
test('模型網址改導到本網域', t => {
    t.equal(
        loader.localModelUrl('https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1/model.json?tfjs-format=file'),
        '/models/facemesh/model.json'
    );
    t.equal(
        loader.localModelUrl('https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/group1-shard1of1.bin?tfjs-format=file'),
        '/models/blazeface/group1-shard1of1.bin'
    );
    t.equal(loader.localModelUrl('https://tfhub.dev/mediapipe/tfjs-model/handskeleton/1/default/1/model.json'), null, '沒有自架的模型不改導');
    t.equal(loader.localModelUrl('https://example.com/model.json'), null);
    t.equal(loader.localModelUrl('https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1/../../secret'), null, '不接受含路徑的檔名');
    t.equal(loader.localModelUrl(undefined), null);
    t.end();
});

test('只在載入模型期間改導，結束後還原（失敗也還原）', async t => {
    const calls = [];
    const original = (url, init) => {
        calls.push(url);
        return Promise.resolve('ok');
    };
    const scope = {fetch: original};

    await loader.withLocalModels(scope, async () => {
        await scope.fetch('https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1/model.json?tfjs-format=file');
        await scope.fetch('https://example.com/other');
        await scope.fetch({url: 'https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/model.json'});
    });
    t.equal(calls[0], '/models/facemesh/model.json');
    t.equal(calls[1], 'https://example.com/other', '其他請求原樣通過');
    t.equal(calls[2], '/models/blazeface/model.json', 'Request 物件也會改導');
    t.equal(scope.fetch, original, '結束後還原');

    await t.rejects(loader.withLocalModels(scope, () => Promise.reject(new Error('boom'))));
    t.equal(scope.fetch, original, '失敗後也還原');
});

// ---------- 延遲載入 ----------
test('擴展的原始碼不直接引入 ml5（否則會被打包進主程式）', t => {
    for (const file of fs.readdirSync(SRC_DIR)) {
        const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
        t.notMatch(text, /require\(\s*['"]ml5['"]\s*\)/, `${file} 沒有 require('ml5')`);
        t.notMatch(text, /from\s+['"]ml5['"]/, `${file} 沒有 import ml5`);
        t.notMatch(text, /\balert\s*\(\s*[^)]/, `${file} 沒有呼叫 alert`);
    }
    t.end();
});

test('沒有瀏覽器環境時 loadMl5 回報失敗，而且可以重試', async t => {
    await t.rejects(loader.loadMl5({}));
    const fake = {name: 'ml5'};
    t.equal(await loader.loadMl5({ml5: fake}), fake, '已經載入過就直接使用');
});

test('用 <script> 從本網域載入 ml5，只載入一次', async t => {
    const appended = [];
    const scope = {
        document: {
            createElement: () => ({remove () {}}),
            head: {appendChild: s => appended.push(s)}
        }
    };
    const p1 = loader.loadMl5(scope);
    const p2 = loader.loadMl5(scope);
    t.equal(appended.length, 1);
    t.equal(appended[0].src, '/vendor/ml5-0.12.2.min.js');
    scope.ml5 = {ok: true};
    appended[0].onload();
    t.equal(await p1, scope.ml5);
    t.equal(await p2, scope.ml5);
});

test('<script> 下載失敗時回報錯誤，下次會重新嘗試', async t => {
    const appended = [];
    const scope = {
        document: {
            createElement: () => ({remove () {}}),
            head: {appendChild: s => appended.push(s)}
        }
    };
    const p = loader.loadMl5(scope);
    appended[0].onerror();
    await t.rejects(p);
    loader.loadMl5(scope).catch(() => {});
    t.equal(appended.length, 2, '失敗後再呼叫會重新載入');
    appended[1].onerror();
});

// ---------- 擴展行為 ----------
test('加入擴展：開攝影機、載入模型、顯示訊息，不呼叫 alert', async t => {
    let alerts = 0;
    global.alert = () => alerts++;
    const {ext, runtime, ui} = await make({results: [[face(100, 50)]]});
    delete global.alert;

    t.equal(alerts, 0);
    t.equal(runtime.ioDevices.video.enabled, 1);
    t.equal(ext.status, 'ready');
    t.match(ui.shown[0].text, /正在準備/);
    t.equal(ui.shown[ui.shown.length - 1].kind, 'ok');
    t.equal(ext.getPeopleCount(), 1);
});

test('座標換算與左右翻轉', async t => {
    const {ext, runtime} = await make({results: [[face(100, 40)]]});
    // 影像 640×480，倍率 0.75 → 舞台 480×360
    t.equal(ext.getX(P1), 240 - 75);
    t.equal(ext.getY(P1), 180 - 30);
    runtime.ioDevices.video.mirror = false;
    t.equal(ext.getX(P1), -(240 - 75));
    t.equal(ext.getX({PERSON_NUMBER: '1', KEYPOINT: '2'}), -(240 - 82.5));
});

test('沒有臉時積木回傳空白，不丟錯誤', async t => {
    const {ext} = await make({results: [[]]});
    t.equal(ext.getPeopleCount(), 0);
    t.equal(ext.getX(P1), '');
    t.equal(ext.getY(P1), '');
    t.equal(ext.getX({PERSON_NUMBER: '5', KEYPOINT: '1'}), '');
    t.equal(ext.getX({PERSON_NUMBER: 'abc', KEYPOINT: 'xyz'}), '');
    t.equal(ext.getX({PERSON_NUMBER: '1', KEYPOINT: '999'}), '');
});

test('臉離開畫面後清空資料，不回報舊座標', async t => {
    const {ext, schedule} = await make({results: [[face(100, 40), face(300, 200)], [face(100, 40)], []]});
    t.equal(ext.getPeopleCount(), 2);
    await schedule.runNext();
    t.equal(ext.getPeopleCount(), 1);
    t.equal(ext.getX({PERSON_NUMBER: '2', KEYPOINT: '1'}), '', '第二張臉離開');
    await schedule.runNext();
    t.equal(ext.getPeopleCount(), 0);
    t.equal(ext.getX(P1), '');
});

test('關閉影像：清空資料、停止辨識；再開啟不重新下載模型', async t => {
    const {ext, runtime, schedule, counters} = await make({results: [[face(100, 40)]]});
    t.equal(ext.getPeopleCount(), 1);

    ext.videoToggle({VIDEO_STATE: 'off'});
    t.equal(ext.getPeopleCount(), 0, '立刻清空');
    t.equal(runtime.ioDevices.video.disabled, 1);
    await schedule.runNext();
    t.equal(schedule.pending(), 0, '辨識迴圈停止');
    t.equal(ext.getPeopleCount(), 0);

    await ext.videoToggle({VIDEO_STATE: 'on-flipped'});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(runtime.ioDevices.video.mirror, false);
    t.equal(ext.getPeopleCount(), 1);
    t.equal(counters.loads, 1, '模型只載入一次');

    await ext.videoToggle({VIDEO_STATE: 'on'});
    t.equal(runtime.ioDevices.video.mirror, true);
});

test('模型還沒載入就關閉影像，不會出錯', async t => {
    let release;
    const gate = new Promise(resolve => (release = resolve));
    const runtime = makeRuntime();
    const ui = makeUi();
    const ext = new Facemesh(runtime, {
        loadMl5: () => gate.then(() => makeMl5([[face(1, 1)]])),
        ui,
        schedule: makeSchedule(),
        scope: {fetch: () => {}}
    });
    await new Promise(resolve => setImmediate(resolve));
    t.equal(ext.status, 'loading');
    t.doesNotThrow(() => ext.videoToggle({VIDEO_STATE: 'off'}));
    release();
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    t.equal(ext.getPeopleCount(), 0, '影像已關閉，不開始辨識');
});

test('載入失敗（例如被安全標頭擋住）：顯示錯誤訊息，不是靜默失敗；之後可以重試', async t => {
    let attempts = 0;
    const loadMl5 = () => {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error('函式庫下載失敗')) : Promise.resolve(makeMl5([[face(1, 1)]]));
    };
    const {ext, ui} = await make({loadMl5});
    t.equal(ext.status, 'error');
    const last = ui.shown[ui.shown.length - 1];
    t.equal(last.kind, 'error');
    t.match(last.text, /臉部辨識無法啟動/);
    t.match(last.text, /函式庫下載失敗/);
    t.equal(ext.getX(P1), '');

    await ext.videoToggle({VIDEO_STATE: 'on'});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(ext.status, 'ready', '重新開啟影像會再試一次');
    t.equal(ext.getPeopleCount(), 1);
});

test('模型載入失敗時同樣顯示錯誤', async t => {
    const loadMl5 = () => Promise.resolve({facemesh: () => Promise.reject(new TypeError('Failed to fetch'))});
    const {ext, ui, scope} = await make({loadMl5});
    t.equal(ext.status, 'error');
    t.equal(ui.shown[ui.shown.length - 1].kind, 'error');
    t.equal(await scope.fetch('x'), 'real', '改導已還原');
});

test('攝影機無法使用：顯示提示，不載入模型', async t => {
    const counters = {};
    const {ext, ui} = await make({camera: false, counters});
    t.equal(ext.status, 'idle');
    t.equal(counters.loads, undefined);
    t.equal(ui.shown.length, 1);
    t.equal(ui.shown[0].kind, 'error');
    t.match(ui.shown[0].text, /攝影機/);
});

test('辨識途中出錯不會中斷迴圈', async t => {
    let n = 0;
    const loadMl5 = () => Promise.resolve({
        facemesh: () => Promise.resolve({
            model: {estimateFaces: () => (++n === 1 ? Promise.reject(new Error('gl')) : Promise.resolve([face(8, 8)]))}
        })
    });
    const origError = console.error;
    console.error = () => {};
    const {ext, schedule} = await make({loadMl5});
    console.error = origError;
    t.equal(ext.getPeopleCount(), 0);
    await schedule.runNext();
    t.equal(ext.getPeopleCount(), 1);
});

test('積木清單與繁中文案', async t => {
    const {ext} = await make();
    const info = ext.getInfo();
    t.equal(info.id, 'facemesh2scratch', '擴展 id 不變，舊作品才能還原');
    const opcodes = info.blocks.filter(b => b !== '---').map(b => b.opcode);
    for (const old of ['getX', 'getY', 'getPeopleCount', 'videoToggle', 'setVideoTransparency', 'setRatio']) {
        t.ok(opcodes.includes(old), `保留原有積木 ${old}`);
    }
    t.same(opcodes, [
        'getPeopleCount', 'getPartX', 'getPartY', 'getX', 'getY', 'getDistance', 'getAngle', 'setNotFound',
        'videoToggle', 'selectCamera', 'setVideoTransparency',
        'setInput', 'setDetectMode', 'detectOnce', 'setDetectInterval', 'getDetectRate', 'setShowBox', 'setRatio'
    ]);
    const getX = info.blocks.find(b => b.opcode === 'getX');
    t.same(Object.keys(getX.arguments), ['PERSON_NUMBER', 'KEYPOINT'], '原有積木的參數名稱不變');
    t.equal(info.menus.keypointMenu.items.length, 468);
    t.equal(info.menus.cameraMenu.items, 'getCameraMenu', '攝影機選單是動態的');
    ext.setLocale = () => 'zh-tw';
    const zh = ext.getInfo();
    t.equal(zh.name, '臉部網格');
    t.equal(zh.blocks[0].text, '偵測到幾張臉');
    t.same(zh.menus.videoMenu.items.map(i => i.text), ['關閉', '開啟', '開啟（左右翻轉）']);
    t.same(zh.menus.partMenu.items.slice(0, 4).map(i => i.text), ['鼻尖', '兩眼中間', '左眼', '右眼']);
    t.equal(zh.menus.partMenu.items.length, 17);
    for (const b of zh.blocks) {
        if (b === '---') continue;
        t.notMatch(b.text, /[ぁ-んァ-ン]|undefined/, `${b.opcode} 有繁中文案`);
    }
    ext.setRatio({RATIO: '0'});
    t.equal(ext.ratio, 0.75, '不接受 0 倍率');
});

// ---------- SPEC 7.7.1 臉部積木 ----------
test('具名特徵點：用對應的點（多點取平均）換算成舞台座標', async t => {
    const {ext, runtime} = await make({results: [[meshFace()]]});
    // 鼻尖 = 第 1 點 (1, 0.5)；倍率 0.75、像照鏡子
    t.equal(ext.getPartX({PERSON_NUMBER: '1', PART: 'noseTip'}), 240 - 0.75);
    t.equal(ext.getPartY({PERSON_NUMBER: '1', PART: 'noseTip'}), 180 - 0.375);
    // 左眼 = 263 與 362 的平均 → x 312.5
    t.equal(ext.getPartX({PERSON_NUMBER: '1', PART: 'leftEye'}), 240 - (312.5 * 0.75));
    // 嘴巴中心 = 13 與 14 的平均
    t.equal(ext.getPartY({PERSON_NUMBER: '1', PART: 'mouthCenter'}), 180 - (6.75 * 0.75));
    runtime.ioDevices.video.mirror = false;
    t.equal(ext.getPartX({PERSON_NUMBER: '1', PART: 'noseTip'}), -(240 - 0.75), '不翻轉時 x 相反');
    t.equal(ext.getPartX({PERSON_NUMBER: '1', PART: 'nope'}), '', '不認得的部位回傳找不到的值');
    t.equal(ext.getPartX({PERSON_NUMBER: '2', PART: 'noseTip'}), '', '沒有第 2 張臉');
});

test('具名特徵點的編號都在 0–467，名稱不重複', t => {
    const parts = Facemesh.FACE_PARTS;
    t.equal(new Set(parts.map(p => p[0])).size, parts.length);
    t.equal(new Set(parts.map(p => p[1])).size, parts.length);
    for (const [, , idx] of parts) for (const i of idx) t.ok(i >= 0 && i < 468);
    t.end();
});

test('兩個特徵點的距離與角度（Scratch 面朝方向）', async t => {
    const {ext} = await make({results: [[meshFace()]]});
    const d = ext.getDistance({PERSON_NUMBER: '1', PART_A: 'upperLip', PART_B: 'lowerLip'});
    // 13 → 14：影像上 (1, 0.5) → 舞台上 (-0.75, -0.375)
    t.equal(d, Math.round(Math.hypot(0.75, 0.375) * 100) / 100);
    t.equal(ext.getAngle({PERSON_NUMBER: '1', PART_A: 'noseTip', PART_B: 'noseTip'}), 0);
    t.equal(ext.getDistance({PERSON_NUMBER: '3', PART_A: 'upperLip', PART_B: 'lowerLip'}), '');
});

test('找不到時回傳 空白／0／-1，套用到所有座標積木', async t => {
    const {ext} = await make({results: [[]]});
    const reporters = [
        () => ext.getX(P1), () => ext.getY(P1),
        () => ext.getPartX({PERSON_NUMBER: '1', PART: 'chin'}), () => ext.getPartY({PERSON_NUMBER: '1', PART: 'chin'}),
        () => ext.getDistance({PERSON_NUMBER: '1', PART_A: 'chin', PART_B: 'forehead'}),
        () => ext.getAngle({PERSON_NUMBER: '1', PART_A: 'chin', PART_B: 'forehead'})
    ];
    for (const r of reporters) t.equal(r(), '');
    ext.setNotFound({VALUE: 'zero'});
    for (const r of reporters) t.equal(r(), 0);
    ext.setNotFound({VALUE: 'minus1'});
    for (const r of reporters) t.equal(r(), -1);
    ext.setNotFound({VALUE: 'whatever'});
    t.equal(ext.notFound, -1, '不認得的值不改變設定');
});

// ---------- SPEC 7.7.0 共通積木 ----------
test('辨識輸入：舞台。不需要攝影機，座標直接是舞台座標、不翻轉', async t => {
    let captured = 0;
    const vision = {captureStage: () => { captured++; return {stageCanvas: true}; }};
    const {ext, runtime, schedule} = await make({results: [[face(240, 180)]], camera: false, vision});
    t.equal(ext.status, 'idle', '攝影機不能用，原本不會載入模型');
    await ext.setInput({INPUT: 'stage'});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(ext.status, 'ready');
    t.ok(captured >= 1, '拍下舞台畫面來辨識');
    t.equal(ext.getX(P1), 0, '舞台截圖正中央 = 舞台座標 0');
    t.equal(ext.getY(P1), 0);
    runtime.ioDevices.video.mirror = false;
    t.equal(ext.getX(P1), 0, '舞台輸入不受左右翻轉影響');
    await schedule.runNext();
    t.equal(schedule.pending(), 1, '持續辨識舞台');
    await ext.setInput({INPUT: 'camera'});
    t.equal(ext.getPeopleCount(), 0, '切換輸入時清空');
    await schedule.runNext();
    t.equal(schedule.pending(), 0, '回到攝影機但影像沒開：停止辨識');
});

test('辨識方式：只在「辨識一次」時；持續辨識時用設定的間隔', async t => {
    let n = 0;
    const loadMl5 = () => Promise.resolve({
        facemesh: () => Promise.resolve({model: {estimateFaces: () => Promise.resolve(++n % 2 ? [face(1, 1)] : [])}})
    });
    const runtime = makeRuntime();
    const waits = [];
    const queue = [];
    const schedule = (fn, ms) => { waits.push(ms); queue.push(fn); };
    const ext = new Facemesh(runtime, {loadMl5, ui: makeUi(), schedule, scope: {fetch () {}}, overlay: makeOverlay()});
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    t.equal(waits[0], 33, '預設間隔 33 毫秒');

    ext.setDetectInterval({MS: 250});
    await queue.shift()();
    t.equal(waits[1], 250);
    ext.setDetectInterval({MS: -5});
    t.equal(ext.intervalMs, 0);
    ext.setDetectInterval({MS: 999999});
    t.equal(ext.intervalMs, 10000);

    await ext.setDetectMode({MODE: 'manual'});
    const before = n;
    await queue.shift()();
    t.equal(n, before, '手動模式：迴圈停止，不再辨識');
    t.equal(queue.length, 0);
    await ext.detectOnce();
    t.equal(n, before + 1, '「辨識一次」辨識一次');
    const count = ext.getPeopleCount();
    await ext.detectOnce();
    t.not(ext.getPeopleCount(), count, '每次「辨識一次」都更新結果');

    await ext.setDetectMode({MODE: 'continuous'});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(queue.length, 1, '回到持續辨識');
});

test('「辨識一次」在影像關閉時不做事、不出錯', async t => {
    const {ext} = await make({results: [[face(1, 1)]]});
    ext.videoToggle({VIDEO_STATE: 'off'});
    await ext.detectOnce();
    t.equal(ext.getPeopleCount(), 0);
});

test('每秒辨識次數', async t => {
    let clock = 0;
    const {ext, schedule} = await make({results: [[face(1, 1)]], now: () => clock});
    for (let i = 0; i < 5; i++) {
        clock += 100;
        await schedule.runNext();
    }
    t.equal(ext.getDetectRate(), 10, '每 100 毫秒一次 = 每秒 10 次');
    clock += 5000;
    t.equal(ext.getDetectRate(), 0, '很久沒有辨識 = 0');
});

test('顯示偵測框：畫出每張臉的框，關掉就清除', async t => {
    const {ext, overlay, schedule} = await make({results: [[face(100, 40), face(300, 200)], []]});
    t.equal(overlay.draws.length, 0, '預設不畫');
    ext.setShowBox({STATE: 'on'});
    const boxes = overlay.draws[overlay.draws.length - 1];
    t.equal(boxes.length, 2);
    t.same(boxes[0], {x1: 240 - 82.5, y1: 180 - 37.5, x2: 240 - 75, y2: 180 - 30, label: '第 1 張臉'});
    await schedule.runNext();
    t.same(overlay.draws[overlay.draws.length - 1], [], '沒有臉時框也消失');
    ext.setShowBox({STATE: 'off'});
    t.equal(overlay.clears, 1);
});

test('選擇攝影機：切換、記住選擇，重新開啟影像時再套用', async t => {
    const used = [];
    const vision = {
        listCameras: () => Promise.resolve([{deviceId: 'a', label: '內建'}, {deviceId: 'b', label: ''}]),
        useCamera: (video, id) => { used.push(id); return Promise.resolve(); }
    };
    const {ext, ui} = await make({results: [[]], vision});
    t.same(ext.getCameraMenu(), [{text: '1：內建', value: '1'}, {text: '2：camera 2', value: '2'}]);

    await ext.selectCamera({CAMERA: '2'});
    t.same(used, ['b']);
    t.equal(ui.shown[ui.shown.length - 1].kind, 'ok');

    await ext.selectCamera({CAMERA: '5'});
    t.match(ui.shown[ui.shown.length - 1].text, /找不到第 5 支攝影機（這台電腦有 2 支）/);
    t.same(used, ['b'], '不存在的攝影機不切換');

    ext.videoToggle({VIDEO_STATE: 'off'});
    await ext.selectCamera({CAMERA: '1'});
    t.match(ui.shown[ui.shown.length - 1].text, /請先用「影像 開啟」/);

    await ext.videoToggle({VIDEO_STATE: 'on'});
    t.same(used, ['b', 'b'], '重新開啟影像時套用之前選的攝影機');
});

test('切換攝影機失敗時顯示原因', async t => {
    const vision = {
        listCameras: () => Promise.resolve([{deviceId: 'a', label: 'A'}]),
        useCamera: () => Promise.reject(new Error('NotReadableError'))
    };
    const {ext, ui} = await make({vision});
    await ext.selectCamera({CAMERA: '1'});
    const last = ui.shown[ui.shown.length - 1];
    t.equal(last.kind, 'error');
    t.match(last.text, /NotReadableError/);
    t.equal(ext._cameraIndex, 0, '失敗時不記住');
});

test('還沒允許攝影機時，攝影機選單仍有一個項目', async t => {
    const {ext} = await make();
    t.same(ext.getCameraMenu(), [{text: '1', value: '1'}]);
});

// ---------- 共用工具 camp_shared/vision.js ----------
const vision = require('../../src/extensions/camp_shared/vision');

test('vision：距離與 Scratch 面朝方向', t => {
    t.equal(vision.distance([0, 0], [3, 4]), 5);
    t.equal(vision.direction([0, 0], [0, 10]), 0, '往上 = 0');
    t.equal(vision.direction([0, 0], [10, 0]), 90, '往右 = 90');
    t.equal(vision.direction([0, 0], [-10, 0]), -90, '往左 = -90');
    t.equal(vision.direction([0, 0], [0, -10]), 180, '往下 = 180');
    t.end();
});

test('vision：列出攝影機只取 videoinput', async t => {
    const scope = {navigator: {mediaDevices: {enumerateDevices: () => Promise.resolve([
        {kind: 'audioinput', deviceId: 'm', label: 'mic'},
        {kind: 'videoinput', deviceId: 'v1', label: 'Cam'},
        {kind: 'videoinput', deviceId: 'v2', label: ''}
    ])}}};
    t.same(await vision.listCameras(scope), [{deviceId: 'v1', label: 'Cam'}, {deviceId: 'v2', label: ''}]);
    t.same(await vision.listCameras({}), [], '沒有 mediaDevices 時是空的');
    t.same(await vision.listCameras({navigator: {mediaDevices: {enumerateDevices: () => Promise.reject(new Error('x'))}}}), []);
});

test('vision：切換攝影機會換掉影像來源並關閉舊的', async t => {
    let oldStopped = false;
    const newTrack = {id: 'new'};
    let constraints = null;
    const scope = {navigator: {mediaDevices: {getUserMedia: c => {
        constraints = c;
        return Promise.resolve({getVideoTracks: () => [newTrack]});
    }}}};
    const el = {srcObject: 'old', play: () => Promise.resolve()};
    const video = {provider: {_video: el, _track: {stop: () => (oldStopped = true)}}};
    await vision.useCamera(video, 'cam-2', scope);
    t.same(constraints.video.deviceId, {exact: 'cam-2'});
    t.equal(constraints.audio, false);
    t.equal(video.provider._track, newTrack);
    t.not(el.srcObject, 'old');
    t.ok(oldStopped);
    await t.rejects(vision.useCamera({provider: {}}, 'x', scope), /影像還沒開啟/);
});

test('vision：偵測框把舞台座標換算到疊在舞台上的畫布', t => {
    const rects = [];
    const ctx = {clearRect () {}, strokeRect: (...a) => rects.push(a), fillText () {}};
    const appended = [];
    const scope = {document: {
        createElement: () => ({style: {}, setAttribute () {}, getContext: () => ctx, width: 0, height: 0}),
        body: {appendChild: c => appended.push(c)}
    }};
    const renderer = {canvas: {getBoundingClientRect: () => ({left: 10, top: 20, width: 960, height: 720})}};
    const o = new vision.BoxOverlay(renderer, scope);
    o.draw([{x1: -240, y1: 180, x2: 0, y2: 0}]);
    t.equal(appended.length, 1);
    t.equal(appended[0].style.left, '10px');
    t.equal(appended[0].style.pointerEvents, 'none', '不擋滑鼠');
    t.same(rects[0], [0, 0, 480, 360], '舞台左上四分之一 → 畫布左上（放大兩倍）');
    o.clear();
    t.equal(appended[0].style.display, 'none');
    new vision.BoxOverlay(null, scope).draw([]);
    t.end();
});

test('vision：拍下舞台會先重畫再複製成 480×360', t => {
    const calls = [];
    const ctx = {clearRect () {}, drawImage: (...a) => calls.push(['drawImage', a[1], a[2], a[3], a[4]])};
    const scope = {document: {createElement: () => ({getContext: () => ctx})}};
    const renderer = {canvas: {}, draw: () => calls.push(['draw'])};
    const c = vision.captureStage(renderer, scope);
    t.equal(c.width, 480);
    t.equal(c.height, 360);
    t.same(calls, [['draw'], ['drawImage', 0, 0, 480, 360]]);
    t.equal(vision.captureStage(null, scope), null);
    t.end();
});

test('vision：每秒辨識次數', t => {
    let clock = 0;
    const m = new vision.RateMeter(() => clock);
    t.equal(m.rate, 0);
    for (let i = 0; i < 3; i++) { m.tick(); clock += 250; }
    clock -= 250;
    t.equal(m.rate, 4);
    m.reset();
    t.equal(m.rate, 0);
    t.end();
});
