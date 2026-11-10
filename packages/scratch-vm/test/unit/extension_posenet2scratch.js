/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const Posenet = require('../../src/extensions/scratch3_posenet2scratch');
const loader = require('../../src/extensions/camp_shared/loader');

const DIR = path.join(__dirname, '../../src/extensions/scratch3_posenet2scratch');

// ---------- 測試用的假物件 ----------
const makeRuntime = ({camera = true} = {}) => ({
    ioDevices: {
        video: {
            mirror: true,
            enabled: 0,
            provider: {video: null},
            enableVideo () {
                this.enabled++;
                this.provider.video = camera ? {readyState: 4} : null;
                return Promise.resolve();
            },
            disableVideo () {
                this.provider.video = null;
            },
            setPreviewGhost () {}
        }
    }
});

const makeUi = () => {
    const shown = [];
    return {shown, show: (text, opts = {}) => shown.push({text, kind: opts.kind || 'info'}), hide: () => {}};
};

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

const makeOverlay = () => ({draws: [], clears: 0, draw (b) { this.draws.push(b); }, clear () { this.clears++; }});

/** 一個人：第 i 個部位在 (x0 + 10i, y0 + 5i)，信心值 scores[i]（預設 0.9）。 */
const pose = (x0 = 0, y0 = 0, scores = {}) => ({
    score: 0.8,
    keypoints: Array.from({length: 17}, (_, i) => ({
        part: `p${i}`,
        position: {x: x0 + (10 * i), y: y0 + (5 * i)},
        score: scores[i] === undefined ? 0.9 : scores[i]
    }))
});

const makeMl5 = (results, counters = {}) => ({
    poseNet: options => {
        counters.loads = (counters.loads || 0) + 1;
        counters.options = options;
        return {
            ready: Promise.resolve(),
            net: {
                estimateMultiplePoses: (input, opts) => {
                    counters.lastInput = input;
                    counters.lastOpts = opts;
                    return Promise.resolve(results.length > 1 ? results.shift() : results[0]);
                }
            }
        };
    }
});

const make = async ({results = [[]], camera = true, loadMl5, counters = {}, scope} = {}) => {
    const runtime = makeRuntime({camera});
    const ui = makeUi();
    const schedule = makeSchedule();
    const ext = new Posenet(runtime, {
        loadMl5: loadMl5 || (() => Promise.resolve(makeMl5(results, counters))),
        ui,
        schedule,
        scope: scope || {fetch: () => Promise.resolve('real')},
        overlay: makeOverlay()
    });
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    return {ext, runtime, ui, schedule, counters, overlay: ext._overlay};
};

const P = (person, part) => ({PERSON_NUMBER: String(person), PART: String(part)});

test('原始碼不直接引入 ml5、不呼叫 alert，也不改共用影像元素的大小', t => {
    for (const file of fs.readdirSync(DIR)) {
        const text = fs.readFileSync(path.join(DIR, file), 'utf8');
        t.notMatch(text, /require\(\s*['"]ml5['"]\s*\)/);
        t.notMatch(text, /\balert\s*\(\s*[^)]/);
        t.notMatch(text, /video\.width\s*=/, '原版會改 provider.video.width，影響其他擴展');
    }
    t.end();
});

test('PoseNet 模型網址改導到本網域', t => {
    t.equal(
        loader.localModelUrl('https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/quant2/075/model-stride16.json'),
        '/models/posenet/model-stride16.json'
    );
    t.equal(
        loader.localModelUrl('https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/quant2/075/group1-shard1of1.bin'),
        '/models/posenet/group1-shard1of1.bin'
    );
    t.equal(loader.localModelUrl('https://storage.googleapis.com/tfjs-models/savedmodel/posenet/resnet50/quant2/model-stride16.json'), null, '沒自架的變體不改導');
    t.equal(loader.localModelUrl('https://storage.googleapis.com/tm-model/abc/model.json'), null, 'Teachable Machine 的網址不受影響');
    t.end();
});

test('加入擴展：載入模型（最多 10 人）、顯示「姿態辨識」訊息', async t => {
    const {ext, ui, counters} = await make({results: [[pose(100, 40)]]});
    t.equal(ext.status, 'ready');
    t.same(counters.options, {maxPoseDetections: 10});
    t.same(counters.lastOpts, {flipHorizontal: false, maxDetections: 10, scoreThreshold: 0.5, nmsRadius: 20});
    t.match(ui.shown[0].text, /正在準備姿態辨識/);
    t.equal(ui.shown[ui.shown.length - 1].text, '姿態辨識準備好了');
    t.equal(ext.getPeopleCount(), 1);
});

test('部位座標：影像已是舞台大小（倍率 1），照鏡子時 x 相反', async t => {
    const {ext, runtime} = await make({results: [[pose(100, 40)]]});
    t.equal(ext.getX(P(1, 0)), 240 - 100, '鼻子');
    t.equal(ext.getY(P(1, 0)), 180 - 40);
    t.equal(ext.getX(P(1, 9)), 240 - 190, '左手腕');
    runtime.ioDevices.video.mirror = false;
    t.equal(ext.getX(P(1, 0)), -(240 - 100));
});

test('攝影機影像先畫到自己的 480×360 畫布再辨識', async t => {
    const drawn = [];
    const canvas = {getContext: () => ({drawImage: (...a) => drawn.push(a.slice(1))})};
    const scope = {fetch () {}, document: {createElement: () => canvas}};
    const counters = {};
    const runtime = makeRuntime();
    runtime.ioDevices.video.enableVideo = function () {
        this.provider.video = {readyState: 4, videoWidth: 1280, videoHeight: 720};
        return Promise.resolve();
    };
    const ext = new Posenet(runtime, {loadMl5: () => Promise.resolve(makeMl5([[pose()]], counters)), ui: makeUi(), schedule: makeSchedule(), scope, overlay: makeOverlay()});
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    t.equal(counters.lastInput, canvas, '辨識的是自己的畫布');
    t.same(drawn[0], [0, 0, 480, 360]);
    t.equal(canvas.width, 480);
    t.equal(canvas.height, 360);
    t.notOk('width' in runtime.ioDevices.video.provider.video, '沒有改動共用的影像元素');
});

test('多人：第 2 個人', async t => {
    const {ext} = await make({results: [[pose(100, 40), pose(300, 100)]]});
    t.equal(ext.getPeopleCount(), 2);
    t.equal(ext.getX(P(2, 0)), 240 - 300);
    t.equal(ext.getX(P(3, 0)), '', '沒有第 3 個人');
});

test('最低信心值：低於它的部位當作找不到', async t => {
    const {ext} = await make({results: [[pose(100, 40, {15: 0.1, 16: 0.25})]]});
    t.equal(ext.getMinConfidence(), 0.2, '預設 0.2');
    t.equal(ext.getX(P(1, 15)), '', '左腳踝信心 0.1 < 0.2');
    t.not(ext.getX(P(1, 16)), '', '右腳踝信心 0.25 ≥ 0.2');
    ext.setMinConfidence({CONFIDENCE: 0.3});
    t.equal(ext.getX(P(1, 16)), '');
    ext.setMinConfidence({CONFIDENCE: 0});
    t.not(ext.getX(P(1, 15)), '');
    ext.setMinConfidence({CONFIDENCE: 5});
    t.equal(ext.getMinConfidence(), 1, '最大 1');
    ext.setMinConfidence({CONFIDENCE: -1});
    t.equal(ext.getMinConfidence(), 0, '最小 0');
});

test('距離與角度；任一部位找不到就回傳找不到的值', async t => {
    const {ext} = await make({results: [[pose(100, 40, {16: 0})]]});
    // 左肩(5) → 右肩(6)：影像 (150,65) → (160,70)；舞台 (90,115) → (80,110)
    t.equal(ext.getDistance({PERSON_NUMBER: '1', PART_A: '5', PART_B: '6'}), Math.round(Math.hypot(10, 5) * 100) / 100);
    t.equal(ext.getAngle({PERSON_NUMBER: '1', PART_A: '0', PART_B: '0'}), 0);
    t.equal(ext.getDistance({PERSON_NUMBER: '1', PART_A: '5', PART_B: '16'}), '');
    ext.setNotFound({VALUE: 'minus1'});
    t.equal(ext.getAngle({PERSON_NUMBER: '1', PART_A: '5', PART_B: '16'}), -1);
    t.equal(ext.getX(P(2, 0)), -1);
});

test('人離開畫面後清空資料', async t => {
    const {ext, schedule} = await make({results: [[pose(100, 40)], []]});
    t.equal(ext.getPeopleCount(), 1);
    await schedule.runNext();
    t.equal(ext.getPeopleCount(), 0);
    t.equal(ext.getX(P(1, 0)), '');
    t.equal(ext.getNoseX(), '');
});

test('原版的 34 個專用積木：第 1 個人的部位', async t => {
    const {ext} = await make({results: [[pose(100, 40)]]});
    t.equal(ext.getNoseX(), ext.getX(P(1, 0)));
    t.equal(ext.getRightAnkleY(), ext.getY(P(1, 16)));
    t.equal(ext.getLeftWristX(), ext.getX(P(1, 9)));
});

test('偵測框只包住信心值夠的部位', async t => {
    const scores = {};
    for (let i = 5; i < 17; i++) scores[i] = 0.05;
    const {ext, overlay} = await make({results: [[pose(100, 40, scores)]]});
    ext.setShowBox({STATE: 'on'});
    const box = overlay.draws[overlay.draws.length - 1][0];
    t.equal(box.label, '第 1 個人');
    t.equal(box.x2, 240 - 100, '鼻子');
    t.equal(box.x1, 240 - 140, '只到右耳（第 4 個），低信心的身體部位不算');
});

test('攝影機無法使用、載入失敗：明確提示', async t => {
    const r1 = await make({camera: false});
    t.match(r1.ui.shown[0].text, /攝影機/);
    const r2 = await make({loadMl5: () => Promise.reject(new Error('函式庫下載失敗'))});
    t.match(r2.ui.shown[r2.ui.shown.length - 1].text, /姿態辨識無法啟動（函式庫下載失敗）/);
});

test('積木清單：SPEC 7.7.3 ★＋☆、共通積木，沒有倍率；原版選單名稱與專用積木保留', async t => {
    const {ext} = await make();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'posenet2scratch');
    t.equal(info.name, '姿態網路');
    const blocks = info.blocks.filter(b => b !== '---');
    const visible = blocks.filter(b => !b.hideFromPalette).map(b => b.opcode);
    t.same(visible, [
        'getPeopleCount', 'getX', 'getY', 'getDistance', 'getAngle', 'setMinConfidence', 'getMinConfidence', 'setNotFound',
        'videoToggle', 'selectCamera', 'setVideoTransparency',
        'setInput', 'setDetectMode', 'detectOnce', 'setDetectInterval', 'getDetectRate', 'setShowBox'
    ]);
    const hidden = blocks.filter(b => b.hideFromPalette).map(b => b.opcode);
    t.equal(hidden.length, 34, '原版 34 個專用積木都在（不顯示）');
    t.ok(hidden.includes('getNoseX') && hidden.includes('getRightAnkleY'));
    for (const op of hidden) t.equal(typeof ext[op], 'function', `${op} 有實作`);
    t.same(info.menus.parts.items.map(i => i.value), Array.from({length: 17}, (_, i) => String(i)), '部位選單的值與原版相同');
    t.same(info.menus.parts.items.slice(0, 3).map(i => i.text), ['鼻子', '左眼', '右眼']);
    t.equal(info.menus.personNumbers.items.length, 10);
    t.equal(blocks[0].text, '偵測到幾個人');
    for (const b of blocks) t.notMatch(b.text, /[ぁ-んァ-ン]|undefined/, `${b.opcode} 有繁中文案`);
    t.equal(blocks.find(b => b.opcode === 'getNoseX').text, '鼻子 的 x 座標', '專用積木的部位名稱已代入');
});
