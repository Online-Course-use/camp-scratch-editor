/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const ML2Scratch = require('../../src/extensions/scratch3_ml2scratch');
const learningData = require('../../src/extensions/scratch3_ml2scratch/learning-data');
const dialog = require('../../src/extensions/camp_shared/dialog');

const DIR = path.join(__dirname, '../../src/extensions/scratch3_ml2scratch');
const D = learningData.FEATURE_DIM;

// ---------- 假的 ml5：特徵擷取器＋KNN ----------
class FakeKnn {
    constructor () {
        this.mapStringToIndex = [];
        this.data = {}; // label → 樣本數
        this.next = null; // 下一次 classify 的 confidencesByLabel
        this.dataset = null;
    }
    addExample (features, label) {
        if (!this.mapStringToIndex.includes(label)) this.mapStringToIndex.push(label);
        this.data[label] = (this.data[label] || 0) + 1;
        this.lastFeatures = features;
    }
    getNumLabels () {
        return Object.values(this.data).filter(n => n > 0).length;
    }
    getCountByLabel () {
        return Object.assign({}, this.data);
    }
    async classify () {
        return {confidencesByLabel: this.next || {}};
    }
    clearLabel (label) {
        delete this.data[label];
    }
    clearAllLabels () {
        this.data = {};
        this.mapStringToIndex = [];
    }
    getClassifierDataset () {
        const ds = {};
        this.mapStringToIndex.forEach((label, i) => {
            if (this.data[label]) ds[i] = {dataSync: () => new Float32Array(this.data[label] * D).fill(i + 1)};
        });
        return ds;
    }
    setClassifierDataset (ds) {
        this.dataset = ds;
        this.data = {};
        for (const [i, t] of Object.entries(ds)) this.data[this.mapStringToIndex[i]] = t.shape[0];
    }
}

const makeMl5 = (state = {}) => {
    state.disposed = 0;
    state.inferred = 0;
    state.knn = new FakeKnn();
    return {
        featureExtractor: (name, options) => {
            state.extractorArgs = [name, options];
            return {
                ready: Promise.resolve(),
                infer: input => {
                    state.inferred++;
                    state.lastInput = input;
                    return {dispose: () => state.disposed++};
                }
            };
        },
        KNNClassifier: () => state.knn,
        tf: {tensor2d: (values, shape) => ({values, shape})}
    };
};

const makeRuntime = ({camera = true} = {}) => ({
    ioDevices: {
        video: {
            mirror: true,
            provider: {video: null},
            enableVideo () {
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
    return {shown, show: (text, opts = {}) => shown.push({text, kind: opts.kind || 'info'}), hide: () => {}, last () { return shown[shown.length - 1]; }};
};

const makeSchedule = () => {
    const queue = [];
    const schedule = (fn, ms) => queue.push([fn, ms]);
    schedule.runNext = async () => {
        const item = queue.shift();
        if (item) await item[0]();
    };
    schedule.queue = queue;
    return schedule;
};

const make = async ({camera = true, confirm = true, file = null, fileText = null, loadMl5} = {}) => {
    const state = {};
    const ui = makeUi();
    const schedule = makeSchedule();
    const dialogs = {confirms: [], downloads: []};
    const ext = new ML2Scratch(makeRuntime({camera}), {
        loadMl5: loadMl5 || (() => Promise.resolve(makeMl5(state))),
        ui,
        schedule,
        scope: {fetch () {}},
        overlay: {draw () {}, clear () {}},
        dialog: {
            confirmDialog: (scope, message) => {
                dialogs.confirms.push(message);
                return Promise.resolve(confirm);
            },
            pickFileDialog: () => Promise.resolve(file),
            downloadText: (scope, name, text) => {
                dialogs.downloads.push({name, text});
                return true;
            }
        },
        readFile: () => Promise.resolve(fileText)
    });
    await ext.ready;
    await new Promise(resolve => setImmediate(resolve));
    return {ext, state, ui, schedule, dialogs};
};

// ---------- 原始碼 ----------
test('原始碼不直接引入 ml5，沒有 alert／confirm／prompt', t => {
    for (const file of fs.readdirSync(DIR)) {
        const text = fs.readFileSync(path.join(DIR, file), 'utf8');
        t.notMatch(text, /require\(\s*['"]ml5['"]\s*\)/);
        t.notMatch(text, /\b(alert|confirm|prompt)\s*\(/, `${file} 沒有阻塞的對話框`);
    }
    t.end();
});

// ---------- 載入與學習 ----------
test('加入擴展：用本網域的 MobileNet 載入特徵擷取器，預設每 0.5 秒辨識', async t => {
    const {ext, state, ui, schedule} = await make();
    t.equal(ext.status, 'ready');
    t.same(state.extractorArgs, ['MobileNet', {mobilenetURL: '/models/mobilenet-layers/model.json', graphModelURL: '/models/mobilenet-graph/model.json'}]);
    t.match(ui.shown[0].text, /正在準備影像辨識/);
    t.equal(ext.intervalMs, 500);
    t.equal(schedule.queue[0][1], 500);
    t.equal(state.inferred, 0, '還沒有樣本時不辨識');
});

test('學習標籤：擷取目前畫面的特徵加進標籤，釋放特徵張量；第一次學習提醒資料不會存進作品', async t => {
    const {ext, state, ui} = await make();
    await ext.train({LABEL: '2'});
    t.equal(ext.getCountByLabel({LABEL: '2'}), 1);
    t.equal(state.disposed, 1, '特徵張量已釋放');
    t.match(ui.last().text, /學習資料不會跟著作品存檔/);
    const count = ui.shown.length;
    await ext.train({LABEL: '2'});
    t.equal(ext.getCountByLabel({LABEL: '2'}), 2);
    t.equal(ui.shown.length, count, '提醒只出現一次');
    t.equal(ext.getCountByLabel({LABEL: '3'}), 0);
});

test('標籤只能是 1–10；影像關閉時不能學習', async t => {
    const {ext, ui} = await make();
    for (const bad of ['0', '11', 'abc', '1.5', '']) {
        await ext.train({LABEL: bad});
        t.match(ui.last().text, /1 到 10/, `「${bad}」被拒絕`);
    }
    await ext.train({LABEL: '10'});
    t.equal(ext.getCountByLabel({LABEL: '10'}), 1);
    ext.videoToggle({VIDEO_STATE: 'off'});
    await ext.train({LABEL: '1'});
    t.match(ui.last().text, /請先用「影像 開啟」/);
});

// ---------- 辨識 ----------
test('辨識結果是信心最高的標籤（原版的錯誤已修正），並釋放特徵張量', async t => {
    const {ext, state, schedule} = await make();
    await ext.train({LABEL: '1'});
    await ext.train({LABEL: '2'});
    state.knn.next = {'1': 0.9, '2': 0.1, '3': 0.0};
    const disposed = state.disposed;
    await schedule.runNext();
    t.equal(ext.getLabel(), '1', '原版會回傳最後一個信心大於 0 的標籤（2）');
    t.equal(state.disposed, disposed + 1);
});

test('最低信心：最高信心低於它時沒有結果，事件不觸發', async t => {
    const {ext, state, schedule} = await make();
    await ext.train({LABEL: '1'});
    t.equal(ext.getMinConfidence(), 0.6);
    state.knn.next = {'1': 0.5, '2': 0.5};
    await schedule.runNext();
    t.equal(ext.getLabel(), '');
    t.equal(ext.whenAnyLabel(), false);
    ext.setMinConfidence({CONFIDENCE: 0.4});
    await schedule.runNext();
    t.equal(ext.getLabel(), '1');
    ext.setMinConfidence({CONFIDENCE: 9});
    t.equal(ext.getMinConfidence(), 1);
});

test('事件積木：當辨識到任何標籤／當辨識到標籤 N', async t => {
    const {ext, state, schedule} = await make();
    await ext.train({LABEL: '3'});
    state.knn.next = {'3': 1};
    t.equal(ext.whenReceived({LABEL: '3'}), false, '還沒辨識');
    await schedule.runNext();
    t.equal(ext.whenReceived({LABEL: '3'}), true);
    t.equal(ext.whenReceived({LABEL: '4'}), false);
    t.equal(ext.whenAnyLabel(), true);
    t.equal(ext.whenReceived({LABEL: 'any'}), true, '原版的「any」也可以');
    t.equal(ext.whenReceivedAny({LABEL: '3'}), true, '原版的 whenReceivedAny');
    await new Promise(resolve => setTimeout(resolve, 150));
    t.equal(ext.whenReceived({LABEL: '3'}), false, '100 毫秒後恢復，等下一次辨識');
});

test('事件積木：結果換成別的標籤後，舊標籤的事件不會再觸發', async t => {
    const {ext, state, schedule} = await make();
    await ext.train({LABEL: '1'});
    await ext.train({LABEL: '2'});
    state.knn.next = {'1': 1};
    await schedule.runNext();
    state.knn.next = {'2': 1};
    await schedule.runNext();
    t.equal(ext.whenReceived({LABEL: '1'}), false, '瀏覽器實測發現的問題：標籤 1 的舊結果還會觸發');
    t.equal(ext.whenReceived({LABEL: '2'}), true);
});

test('標籤名稱與辨識到的標籤名稱', async t => {
    const {ext, state, schedule} = await make();
    await ext.train({LABEL: '1'});
    state.knn.next = {'1': 1};
    await schedule.runNext();
    t.equal(ext.getLabelResultName(), '1', '沒有名稱時用編號');
    ext.setLabelName({LABEL: '1', NAME: '  剪刀  '});
    t.equal(ext.getLabelName({LABEL: '1'}), '剪刀');
    t.equal(ext.getLabelResultName(), '剪刀');
    ext.setLabelName({LABEL: '1', NAME: 'x'.repeat(80)});
    t.equal(ext.getLabelName({LABEL: '1'}).length, 50, '名稱最多 50 字');
    ext.setLabelName({LABEL: '1', NAME: ''});
    t.equal(ext.getLabelName({LABEL: '1'}), '', '空白名稱 = 移除');
    ext.setLabelName({LABEL: '99', NAME: 'x'});
    t.equal(ext.getLabelName({LABEL: '99'}), '');
});

// ---------- 清除 ----------
test('清除標籤：先確認，取消就不清', async t => {
    const r1 = await make({confirm: false});
    await r1.ext.train({LABEL: '1'});
    await r1.ext.reset({LABEL: '1'});
    t.match(r1.dialogs.confirms[0], /要清除標籤 1 的 1 個樣本嗎？\n清除後不能復原/);
    t.equal(r1.ext.getCountByLabel({LABEL: '1'}), 1, '取消時保留');

    const r2 = await make({confirm: true});
    await r2.ext.train({LABEL: '1'});
    await r2.ext.train({LABEL: '2'});
    r2.ext.setLabelName({LABEL: '1', NAME: '石頭'});
    await r2.ext.reset({LABEL: '1'});
    t.match(r2.dialogs.confirms[0], /標籤 1（石頭）/);
    t.equal(r2.ext.getCountByLabel({LABEL: '1'}), 0);
    t.equal(r2.ext.getCountByLabel({LABEL: '2'}), 1);
});

test('清除所有標籤：確認後全部清除；沒有樣本時不跳確認', async t => {
    const {ext, dialogs, ui} = await make();
    await ext.resetAll();
    t.equal(dialogs.confirms.length, 0);
    t.match(ui.last().text, /沒有任何樣本/);
    await ext.train({LABEL: '1'});
    await ext.train({LABEL: '2'});
    await ext.reset({LABEL: 'all'});
    t.match(dialogs.confirms[0], /所有標籤的 2 個樣本/);
    t.equal(ext.getCountByLabel({LABEL: '1'}) + ext.getCountByLabel({LABEL: '2'}), 0);
});

// ---------- 儲存與載入 ----------
test('儲存學習資料：下載本擴展格式的 JSON（含標籤名稱）', async t => {
    const {ext, dialogs, ui} = await make();
    ext.download();
    t.match(ui.last().text, /還沒有學習資料/);
    t.equal(dialogs.downloads.length, 0);
    await ext.train({LABEL: '1'});
    await ext.train({LABEL: '4'});
    await ext.train({LABEL: '4'});
    ext.setLabelName({LABEL: '4', NAME: '布'});
    ext.download();
    const {name, text} = dialogs.downloads[0];
    t.match(name, /^影像訓練器學習資料-\d{8}-\d{4}\.json$/);
    const decoded = learningData.decode(text);
    t.same(Object.keys(decoded.examples).sort(), ['1', '4']);
    t.equal(decoded.examples['4'].count, 2);
    t.same(decoded.labelNames, {'4': '布'});
});

test('載入學習資料：驗證通過後取代目前資料（先確認）', async t => {
    const values = new Float32Array(3 * D).fill(0.5);
    const text = learningData.encode({labelNames: {'2': '剪刀'}, examples: {'2': values, '7': new Float32Array(D)}});
    const {ext, state, dialogs, ui} = await make({file: {size: text.length}, fileText: text});
    await ext.train({LABEL: '1'});
    await ext.upload();
    t.match(dialogs.confirms[0], /取代目前的學習資料/);
    t.equal(ext.getCountByLabel({LABEL: '1'}), 0, '舊資料被取代');
    t.equal(ext.getCountByLabel({LABEL: '2'}), 3);
    t.equal(ext.getCountByLabel({LABEL: '7'}), 1);
    t.same(state.knn.mapStringToIndex, ['2', '7']);
    t.same(state.knn.dataset[0].shape, [3, D]);
    t.equal(ext.getLabelName({LABEL: '2'}), '剪刀');
    t.match(ui.last().text, /已載入學習資料（2 個標籤、4 個樣本）/);
});

test('載入學習資料：不合格的檔案被拒絕，原本的資料不變', async t => {
    const cases = [
        ['not json', /不是 JSON/],
        [JSON.stringify({dataset: {}, tensors: {}}), /不是用「儲存學習資料」存下來的檔案/],
        [JSON.stringify({format: 'camp-image-trainer', version: 2}), /版本不符/],
        [JSON.stringify({format: 'camp-image-trainer', version: 1, feature: 'x', dim: D, examples: {}}), /不同的模型/]
    ];
    for (const [text, re] of cases) {
        const {ext, ui} = await make({file: {size: text.length}, fileText: text});
        await ext.train({LABEL: '1'});
        await ext.upload();
        t.match(ui.last().text, re);
        t.equal(ui.last().kind, 'error');
        t.equal(ext.getCountByLabel({LABEL: '1'}), 1, '原本的資料不變');
    }
    const big = await make({file: {size: learningData.MAX_BYTES + 1}, fileText: '{}'});
    await big.ext.upload();
    t.match(big.ui.last().text, /檔案太大/);
    const cancel = await make({file: null});
    await cancel.ext.upload();
    t.equal(cancel.ui.last().text, '影像辨識準備好了', '取消選檔什麼都不做');
});

test('learning-data：驗證每一個欄位', t => {
    const ok = (examples, labelNames = {}) => JSON.stringify({format: learningData.FORMAT, version: 1, feature: learningData.FEATURE_ID, dim: D, labelNames, examples});
    const b64 = n => Buffer.from(new Float32Array(n * D).buffer).toString('base64');
    t.throws(() => learningData.decode(ok({})), /沒有任何樣本/);
    t.throws(() => learningData.decode(ok({'11': {count: 1, data: b64(1)}})), /標籤只能是 1–10/);
    t.throws(() => learningData.decode(ok({'01': {count: 1, data: b64(1)}})), /標籤只能是/);
    t.throws(() => learningData.decode(ok({'1': {count: 2, data: b64(1)}})), /長度不對/);
    t.throws(() => learningData.decode(ok({'1': {count: 0, data: ''}})), /資料不正確/);
    t.throws(() => learningData.decode(ok({'1': {count: 1.5, data: b64(1)}})), /資料不正確/);
    t.throws(() => learningData.decode(ok({'1': {count: 501, data: ''}})), /資料不正確/);
    const nan = new Float32Array(D);
    nan[5] = NaN;
    t.throws(() => learningData.decode(ok({'1': {count: 1, data: Buffer.from(nan.buffer).toString('base64')}})), /資料不正確/, '不接受 NaN');
    t.throws(() => learningData.decode(JSON.stringify([1, 2])), /不是用「儲存學習資料」/);
    const good = learningData.decode(ok({'1': {count: 1, data: b64(1)}}, {'1': 'x'.repeat(80), '12': 'bad', '2': 5}));
    t.equal(good.labelNames['1'].length, 50);
    t.notOk('12' in good.labelNames);
    t.notOk('2' in good.labelNames);
    t.equal(good.examples['1'].values.length, D);
    t.throws(() => learningData.decode('{}', learningData.MAX_BYTES + 1), /檔案太大/);
    t.end();
});

test('learning-data：存了再讀回來數值一樣', t => {
    const values = new Float32Array(2 * D).map((_, i) => i / 7);
    const back = learningData.decode(learningData.encode({examples: {'5': values}}));
    t.equal(back.examples['5'].count, 2);
    t.same(Array.from(back.examples['5'].values.slice(0, 20)), Array.from(values.slice(0, 20)));
    t.equal(back.examples['5'].values[2 * D - 1], values[2 * D - 1]);
    t.end();
});

// ---------- 積木清單與原版相容 ----------
test('積木清單：SPEC 7.7.5 ★＋☆、共通積木（沒有偵測框與倍率）；原版積木保留不顯示', async t => {
    const {ext} = await make();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'ml2scratch');
    t.equal(info.name, '影像訓練器');
    const blocks = info.blocks.filter(b => b !== '---');
    t.same(blocks.filter(b => !b.hideFromPalette).map(b => b.opcode), [
        'train', 'getCountByLabel', 'getLabel', 'whenAnyLabel', 'whenReceived', 'reset', 'resetAll', 'download', 'upload',
        'setLabelName', 'getLabelName', 'getLabelResultName', 'setMinConfidence', 'getMinConfidence',
        'videoToggle', 'selectCamera', 'setVideoTransparency',
        'setInput', 'setDetectMode', 'detectOnce', 'setDetectInterval', 'getDetectRate'
    ]);
    const hidden = blocks.filter(b => b.hideFromPalette).map(b => b.opcode);
    for (const op of ['addExample1', 'addExample3', 'getCountByLabel1', 'getCountByLabel10', 'trainAny', 'whenReceivedAny', 'resetAny', 'toggleClassification', 'setClassificationInterval', 'switchCamera']) {
        t.ok(hidden.includes(op), `原版 ${op} 保留`);
        t.equal(typeof ext[op], 'function');
    }
    for (const menu of ['train_menu', 'count_menu', 'received_menu', 'reset_menu', 'video_menu', 'input_menu', 'classification_menu', 'classification_interval_menu', 'mediadevices']) {
        t.ok(info.menus[menu], `原版選單 ${menu} 保留`);
    }
    t.equal(info.menus.train_menu.items.length, 10, '標籤上限 10');
    for (const b of blocks) t.notMatch(b.text, /[ぁ-んァ-ン]|undefined|\[N\]/, `${b.opcode} 有繁中文案`);
});

test('原版積木：辨識開關、秒數、學習標籤 1–3、標籤 N 的樣本數', async t => {
    const {ext} = await make();
    await ext.addExample3();
    t.equal(ext.getCountByLabel3(), 1);
    await ext.toggleClassification({CLASSIFICATION_STATE: 'off'});
    t.equal(ext.mode, 'manual');
    await ext.toggleClassification({CLASSIFICATION_STATE: 'on'});
    t.equal(ext.mode, 'continuous');
    ext.setClassificationInterval({CLASSIFICATION_INTERVAL: '0.2'});
    t.equal(ext.intervalMs, 200);
});

test('dialog：沒有 DOM 時確認回傳 false、選檔回傳 null、下載回傳 false', async t => {
    t.equal(await dialog.confirmDialog({}, 'x'), false);
    t.equal(await dialog.pickFileDialog({}, 'x'), null);
    t.equal(dialog.downloadText({}, 'a.json', '{}'), false);
});
