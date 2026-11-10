/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const Handpose = require('../../src/extensions/scratch3_handpose2scratch');

const DIRS = ['scratch3_handpose2scratch', 'camp_shared'].map(d => path.join(__dirname, '../../src/extensions', d));

// ---------- 測試用的假物件（與臉部網格的測試相同） ----------
const makeRuntime = ({camera = true} = {}) => ({
    ioDevices: {
        video: {
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

/** 21 個點的手：第 i 點在影像的 (x0 + 10i, y0 + 5i, i)。 */
const hand = (x0 = 0, y0 = 0) => {
    const pts = [];
    for (let i = 0; i < 21; i++) pts.push([x0 + (10 * i), y0 + (5 * i), i]);
    return {landmarks: pts, handInViewConfidence: 0.99};
};

const makeMl5 = (results, counters = {}) => ({
    handpose: () => {
        counters.loads = (counters.loads || 0) + 1;
        return Promise.resolve({
            model: {estimateHands: () => Promise.resolve(results.length > 1 ? results.shift() : results[0])}
        });
    }
});

const make = async ({results = [[]], camera = true, loadMl5, counters = {}} = {}) => {
    const runtime = makeRuntime({camera});
    const ui = makeUi();
    const schedule = makeSchedule();
    const ext = new Handpose(runtime, {
        loadMl5: loadMl5 || (() => Promise.resolve(makeMl5(results, counters))),
        ui,
        schedule,
        scope: {fetch: () => Promise.resolve('real')},
        overlay: makeOverlay()
    });
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    return {ext, runtime, ui, schedule, counters, overlay: ext._overlay};
};

const H1 = {HAND_NUMBER: '1'};

test('原始碼不直接引入 ml5、不呼叫 alert', t => {
    for (const dir of DIRS) {
        for (const file of fs.readdirSync(dir)) {
            const text = fs.readFileSync(path.join(dir, file), 'utf8');
            t.notMatch(text, /require\(\s*['"]ml5['"]\s*\)/, `${file} 沒有 require('ml5')`);
            t.notMatch(text, /\balert\s*\(\s*[^)]/, `${file} 沒有呼叫 alert`);
        }
    }
    t.end();
});

test('加入擴展：開攝影機、載入手部模型、顯示「手部辨識」訊息', async t => {
    const {ext, runtime, ui} = await make({results: [[hand(100, 40)]]});
    t.equal(runtime.ioDevices.video.enabled, 1);
    t.equal(ext.status, 'ready');
    t.match(ui.shown[0].text, /正在準備手部辨識/);
    t.equal(ui.shown[ui.shown.length - 1].text, '手部辨識準備好了');
    t.equal(ext.getHandCount(), 1);
});

test('具名特徵點與依編號取點：座標換算與左右翻轉', async t => {
    const {ext, runtime} = await make({results: [[hand(100, 40)]]});
    // 食指指尖 = 第 8 點（從 0 開始）→ 影像 (180, 80)
    t.equal(ext.getPartX({HAND_NUMBER: '1', PART: 'indexTip'}), 240 - (180 * 0.75));
    t.equal(ext.getPartY({HAND_NUMBER: '1', PART: 'indexTip'}), 180 - (80 * 0.75));
    t.equal(ext.getPartX({HAND_NUMBER: '1', PART: 'wrist'}), 240 - 75);
    // 依編號（從 1 開始）：編號 9 = 第 8 點
    t.equal(ext.getX({HAND_NUMBER: '1', LANDMARK: '9'}), ext.getPartX({HAND_NUMBER: '1', PART: 'indexTip'}));
    t.equal(ext.getY({HAND_NUMBER: '1', LANDMARK: '9'}), ext.getPartY({HAND_NUMBER: '1', PART: 'indexTip'}));
    runtime.ioDevices.video.mirror = false;
    t.equal(ext.getPartX({HAND_NUMBER: '1', PART: 'wrist'}), -(240 - 75));
    t.equal(ext.getZ({LANDMARK: '21'}), 20, 'z 是模型的原始值');
});

test('原版作品的 getX／getY 沒有手的編號，當作第 1 隻手', async t => {
    const {ext} = await make({results: [[hand(100, 40)]]});
    t.equal(ext.getX({LANDMARK: '1'}), 240 - 75);
    t.equal(ext.getY({LANDMARK: '1'}), 180 - 30);
});

test('手離開畫面後清空資料，不回報舊座標（原版的問題）', async t => {
    const {ext, schedule} = await make({results: [[hand(100, 40)], []]});
    t.equal(ext.getHandCount(), 1);
    t.not(ext.getX({LANDMARK: '1'}), '');
    await schedule.runNext();
    t.equal(ext.getHandCount(), 0);
    t.equal(ext.getX({LANDMARK: '1'}), '');
    t.equal(ext.getPartX({HAND_NUMBER: '1', PART: 'thumbTip'}), '');
    t.equal(ext.getZ({LANDMARK: '1'}), '');
});

test('讀不到資料時回傳空白、不丟錯誤', async t => {
    const {ext} = await make({results: [[hand()]]});
    t.equal(ext.getX({HAND_NUMBER: '2', LANDMARK: '1'}), '', '只有一隻手');
    t.equal(ext.getX({HAND_NUMBER: '1', LANDMARK: '22'}), '');
    t.equal(ext.getX({HAND_NUMBER: 'abc', LANDMARK: 'x'}), '');
    t.equal(ext.getPartX({HAND_NUMBER: '1', PART: 'nope'}), '');
});

test('關閉影像：清空資料、停止辨識；再開啟不重新下載模型', async t => {
    const {ext, schedule, counters} = await make({results: [[hand(1, 1)]]});
    ext.videoToggle({VIDEO_STATE: 'off'});
    t.equal(ext.getHandCount(), 0);
    await schedule.runNext();
    t.equal(schedule.pending(), 0);
    await ext.videoToggle({VIDEO_STATE: 'on'});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(ext.getHandCount(), 1);
    t.equal(counters.loads, 1);
});

test('載入失敗：顯示「手部辨識無法啟動」，可以重試', async t => {
    let attempts = 0;
    const loadMl5 = () => (++attempts === 1 ? Promise.reject(new Error('函式庫下載失敗')) : Promise.resolve(makeMl5([[hand()]])));
    const {ext, ui} = await make({loadMl5});
    t.equal(ext.status, 'error');
    t.match(ui.shown[ui.shown.length - 1].text, /手部辨識無法啟動（函式庫下載失敗）/);
    await ext.videoToggle({VIDEO_STATE: 'on'});
    t.equal(ext.status, 'ready');
});

test('攝影機無法使用：提示，不載入模型', async t => {
    const counters = {};
    const {ext, ui} = await make({camera: false, counters});
    t.equal(ext.status, 'idle');
    t.equal(counters.loads, undefined);
    t.match(ui.shown[0].text, /攝影機/);
});

test('偵測框標示「第 1 隻手」', async t => {
    const {ext, overlay} = await make({results: [[hand(100, 40)]]});
    ext.setShowBox({STATE: 'on'});
    const boxes = overlay.draws[overlay.draws.length - 1];
    t.equal(boxes.length, 1);
    t.equal(boxes[0].label, '第 1 隻手');
    t.equal(boxes[0].x2, 240 - 75, '手腕在最右邊（照鏡子）');
});

test('共通積木：手動辨識、辨識一次', async t => {
    const {ext, schedule} = await make({results: [[hand()], [], [hand()]]});
    t.equal(ext.getHandCount(), 1);
    await ext.setDetectMode({MODE: 'manual'});
    await schedule.runNext();
    t.equal(schedule.pending(), 0, '手動模式停止迴圈');
    await ext.detectOnce();
    t.equal(ext.getHandCount(), 0);
    await ext.detectOnce();
    t.equal(ext.getHandCount(), 1);
});

test('積木清單：SPEC 7.7.2 的三項＋共通積木，沒有「找不到時回傳」與距離／角度', async t => {
    const {ext} = await make();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'handpose2scratch', '與原版相同的 id，原版作品可開');
    t.equal(info.name, '手部姿勢');
    const blocks = info.blocks.filter(b => b !== '---');
    t.same(blocks.map(b => b.opcode), [
        'getHandCount', 'getPartX', 'getPartY', 'getX', 'getY', 'getZ',
        'videoToggle', 'selectCamera', 'setVideoTransparency',
        'setInput', 'setDetectMode', 'detectOnce', 'setDetectInterval', 'getDetectRate', 'setShowBox', 'setRatio'
    ]);
    t.ok(blocks.find(b => b.opcode === 'getZ').hideFromPalette, 'getZ 不顯示（只為了原版作品）');
    t.notOk(blocks.some(b => /setNotFound|getDistance|getAngle/.test(b.opcode)), 'SPEC 定案不做');
    t.equal(blocks[0].text, '偵測到幾隻手');
    t.equal(info.menus.landmark.items.length, 21, '原版的選單名稱 landmark 不變');
    t.same(info.menus.handNumberMenu.items, [{text: '1', value: '1'}], '模型只追蹤一隻手');
    const parts = info.menus.partMenu.items;
    t.equal(parts.length, 21);
    t.same(parts.slice(0, 5).map(p => p.text), ['手腕', '拇指根部', '拇指第二關節', '拇指第一關節', '拇指指尖']);
    t.equal(parts[8].text, '食指指尖');
    t.equal(parts[20].text, '小指指尖');
    t.equal(new Set(parts.map(p => p.value)).size, 21);
    for (const b of blocks) t.notMatch(b.text, /[ぁ-んァ-ン]|undefined/, `${b.opcode} 有繁中文案`);
});

test('具名特徵點的編號就是模型的 0–20', t => {
    Handpose.HAND_PARTS.forEach(([, , idx], i) => t.equal(idx, i));
    t.end();
});
