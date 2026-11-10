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

const make = async ({results = [[]], camera = true, loadMl5, counters = {}} = {}) => {
    const runtime = makeRuntime({camera});
    const ui = makeUi();
    const schedule = makeSchedule();
    const scope = {fetch: () => Promise.resolve('real')};
    const ext = new Facemesh(runtime, {
        loadMl5: loadMl5 || (() => Promise.resolve(makeMl5(results, counters))),
        ui,
        schedule,
        scope
    });
    await ext.ready;
    // 第一次辨識是非同步的，等它跑完
    await new Promise(resolve => setImmediate(resolve));
    return {ext, runtime, ui, schedule, scope, counters};
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
    t.same(info.blocks.map(b => b.opcode), ['getX', 'getY', 'getPeopleCount', 'videoToggle', 'setVideoTransparency', 'setRatio']);
    t.equal(info.menus.keypointMenu.items.length, 468);
    ext.setLocale = () => 'zh-tw';
    const zh = ext.getInfo();
    t.equal(zh.name, '臉部網格');
    t.equal(zh.blocks[2].text, '偵測到幾張臉');
    t.same(zh.menus.videoMenu.items.map(i => i.text), ['關閉', '開啟', '開啟（左右翻轉）']);
    ext.setRatio({RATIO: '0'});
    t.equal(ext.ratio, 0.75, '不接受 0 倍率');
});
