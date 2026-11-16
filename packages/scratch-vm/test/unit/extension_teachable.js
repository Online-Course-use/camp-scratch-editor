/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const teachable = require('../../src/extensions/camp_shared/teachable');
const loader = require('../../src/extensions/camp_shared/loader');
const TM2Scratch = require('../../src/extensions/scratch3_tm2scratch');
const TMPose2Scratch = require('../../src/extensions/scratch3_tmpose2scratch');

const GOOD = 'https://teachablemachine.withgoogle.com/models/abc_DEF-1/';

// ---------- 網址白名單與模型類型 ----------
test('模型網址白名單：只接受 Teachable Machine 的分享連結', t => {
    t.equal(teachable.normalizeModelUrl(GOOD), GOOD);
    t.equal(teachable.normalizeModelUrl('  https://teachablemachine.withgoogle.com/models/abc  '), 'https://teachablemachine.withgoogle.com/models/abc/', '補上結尾的 /');
    t.equal(teachable.normalizeModelUrl('https://storage.googleapis.com/tm-model/xyz/'), 'https://storage.googleapis.com/tm-model/xyz/');
    for (const bad of [
        'http://teachablemachine.withgoogle.com/models/abc/',
        'https://evil.example.com/models/abc/',
        'https://teachablemachine.withgoogle.com.evil.com/models/abc/',
        'https://teachablemachine.withgoogle.com/train/image',
        'https://teachablemachine.withgoogle.com/models/abc/../../x/',
        'https://storage.googleapis.com/other-bucket/abc/',
        'https://user:pw@teachablemachine.withgoogle.com/models/abc/',
        'https://teachablemachine.withgoogle.com:8443/models/abc/',
        'javascript:alert(1)',
        '',
        'https://teachablemachine.withgoogle.com/models/'
    ]) {
        t.throws(() => teachable.normalizeModelUrl(bad), /只能使用 Teachable Machine 的分享連結|請貼上 Teachable Machine 的分享連結/, `拒絕 ${bad}`);
    }
    t.end();
});

test('從 metadata 判斷模型類型與標籤', t => {
    t.equal(teachable.modelType({packageName: '@teachablemachine/image', labels: ['a']}), 'image');
    t.equal(teachable.modelType({wordLabels: ['Background Noise', 'clap']}), 'sound');
    t.equal(teachable.modelType({packageName: '@teachablemachine/pose', labels: ['up']}), 'pose');
    t.equal(teachable.modelType({labels: ['a'], modelSettings: {posenet: {}}}), 'pose');
    t.equal(teachable.modelType({foo: 1}), null);
    t.same(teachable.modelLabels({wordLabels: ['x', 'y']}), ['x', 'y']);
    t.end();
});

const fetchReturning = (status, body) => async url => ({ok: status === 200, status, json: async () => (typeof body === 'function' ? body(url) : body)});

test('讀 metadata：放錯擴展或積木時給清楚的提示', async t => {
    const imageMeta = {packageName: '@teachablemachine/image', labels: ['貓', '狗'], timeStamp: 1};
    const soundMeta = {wordLabels: ['Background Noise', '拍手'], timeStamp: 1};
    const poseMeta = {packageName: '@teachablemachine/pose', labels: ['舉手'], timeStamp: 1};
    const s = body => ({fetch: fetchReturning(200, body)});
    t.same(await teachable.fetchMetadata(s(imageMeta), GOOD, 'image'), imageMeta);
    await t.rejects(teachable.fetchMetadata(s(soundMeta), GOOD, 'image'), /這是聲音模型，請改用「設定聲音模型網址」/);
    await t.rejects(teachable.fetchMetadata(s(imageMeta), GOOD, 'sound'), /這是圖片模型，請改用「設定圖片模型網址」/);
    await t.rejects(teachable.fetchMetadata(s(poseMeta), GOOD, 'image'), /這是姿態模型，請改用「Teachable Machine（姿態）」擴展/);
    await t.rejects(teachable.fetchMetadata(s(imageMeta), GOOD, 'pose'), /這是圖片模型，請改用「Teachable Machine（影像、聲音）」擴展/);
    await t.rejects(teachable.fetchMetadata({fetch: fetchReturning(404, {})}, GOOD, 'image'), /找不到這個模型（HTTP 404）/);
    await t.rejects(teachable.fetchMetadata({fetch: () => Promise.reject(new TypeError('x'))}, GOOD, 'image'), /連不到 Teachable Machine/);
    await t.rejects(teachable.fetchMetadata(s({labels: []}), GOOD, 'image'), /沒有任何標籤/);
});

test('信心最高的標籤與門檻；原版各語言的「任何」', t => {
    const probs = [{label: 'a', confidence: 0.2}, {label: 'b', confidence: 0.7}];
    t.same(teachable.topLabel(probs, 0.5), probs[1]);
    t.equal(teachable.topLabel(probs, 0.8), null);
    t.equal(teachable.topLabel([], 0), null);
    for (const v of ['any', '任何', 'どれか', 'のどれか']) t.ok(teachable.isAny(v));
    t.notOk(teachable.isAny('貓'));
    t.end();
});

test('畫面中央取正方形（照鏡子時左右翻轉）', t => {
    const calls = [];
    const ctx = {save () {}, restore () {}, translate: (...a) => calls.push(['translate', ...a]), scale: (...a) => calls.push(['scale', ...a]), drawImage: (...a) => calls.push(['drawImage', ...a.slice(1)])};
    const scope = {document: {createElement: () => ({getContext: () => ctx})}};
    const c = teachable.squareCrop(scope, {videoWidth: 640, videoHeight: 480}, 224, true);
    t.equal(c.width, 224);
    t.same(calls[0], ['translate', 224, 0]);
    t.same(calls[1], ['scale', -1, 1]);
    t.same(calls[2], ['drawImage', 80, 0, 480, 480, 0, 0, 224, 224], '取中央 480×480');
    const input = {width: 0, height: 0};
    t.equal(teachable.squareCrop(scope, input, 224, false), input, '沒有大小時原樣回傳');
    t.end();
});

test('原始碼不從第三方網站載入函式庫，沒有 alert', t => {
    for (const dir of ['scratch3_tm2scratch', 'scratch3_tmpose2scratch', 'scratch3_campspeech']) {
        const text = fs.readFileSync(path.join(__dirname, '../../src/extensions', dir, 'index.js'), 'utf8');
        t.notMatch(text, /src\s*=\s*['"`]https?:\/\/|loadScriptSynchronously|XMLHttpRequest/, `${dir} 執行時不從外部網站載入程式`);
        t.notMatch(text, /require\(\s*['"]ml5['"]\s*\)/);
        t.notMatch(text, /\balert\s*\(\s*[^)]/);
    }
    t.equal(loader.localModelUrl('https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/float/075/model-stride16.json'), '/models/posenet-float/model-stride16.json', 'TM 姿態用的 PoseNet 權重改導到本網域');
    t.end();
});

// ---------- 共用的假物件 ----------
const makeRuntime = ({camera = true} = {}) => ({
    ioDevices: {video: {
        mirror: true,
        provider: {video: null},
        enableVideo () { this.provider.video = camera ? {readyState: 4} : null; return Promise.resolve(); },
        disableVideo () { this.provider.video = null; },
        setPreviewGhost () {}
    }}
});
const makeUi = () => {
    const shown = [];
    return {shown, show: (text, opts = {}) => shown.push({text, kind: opts.kind || 'info'}), hide () {}, last () { return shown[shown.length - 1]; }};
};
const makeSchedule = () => {
    const queue = [];
    const schedule = (fn, ms) => queue.push([fn, ms]);
    schedule.runNext = async () => { const it = queue.shift(); if (it) await it[0](); };
    schedule.queue = queue;
    return schedule;
};

// ---------- Teachable Machine（影像、聲音） ----------
const makeMl5 = state => ({
    imageClassifier: async url => {
        state.imageUrl = url;
        if (state.imageFail) return {model: new Error('Failed to fetch')};
        return {model: {}, classify: async () => state.imageResults};
    },
    soundClassifier: async url => {
        state.soundUrl = url;
        const recognizer = {listening: false, isListening () { return this.listening; }, stopListening () { this.listening = false; state.stopped = (state.stopped || 0) + 1; }};
        return {model: {model: recognizer}, classify: cb => { recognizer.listening = true; state.soundCb = cb; }};
    }
});

const makeTm = async ({metadata = {}, state = {}, camera = true} = {}) => {
    const ui = makeUi();
    const schedule = makeSchedule();
    const scope = {fetch: async url => {
        state.fetched = url;
        const key = Object.keys(metadata).find(k => url.startsWith(k));
        return key ? {ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(metadata[key]))} : {ok: false, status: 404, json: async () => ({})};
    }};
    const ext = new TM2Scratch(makeRuntime({camera}), {loadMl5: async () => makeMl5(state), ui, schedule, scope, overlay: {draw () {}, clear () {}}});
    await ext.ready;
    await new Promise(r => setImmediate(r));
    return {ext, ui, schedule, state};
};

const IMG = 'https://teachablemachine.withgoogle.com/models/img/';
const SND = 'https://teachablemachine.withgoogle.com/models/snd/';
const META = {
    [IMG]: {packageName: '@teachablemachine/image', labels: ['貓', '狗'], timeStamp: 100},
    [SND]: {wordLabels: ['Background Noise', '拍手', '口哨'], timeStamp: 200}
};

test('TM 影像：設定網址 → 載入、辨識、標籤、信心、事件', async t => {
    const state = {imageResults: [{label: '貓', confidence: 0.9}, {label: '狗', confidence: 0.1}]};
    const {ext, ui, schedule} = await makeTm({metadata: META, state});
    t.equal(ext.intervalMs, 1000, '預設每 1 秒辨識');
    t.equal(ext.getImageLabel(), '', '還沒設定模型');
    await ext.setImageClassificationModelURL({URL: IMG});
    t.match(state.imageUrl, /^https:\/\/teachablemachine\.withgoogle\.com\/models\/img\/model\.json\?\d+$/);
    t.match(ui.last().text, /已載入圖片模型（標籤：貓、狗）/);
    await schedule.runNext();
    t.equal(ext.getImageLabel(), '貓');
    t.equal(ext.imageLabelConfidence({LABEL: '貓'}), 0.9);
    t.equal(ext.imageLabelConfidence({LABEL: '兔'}), 0);
    t.equal(ext.whenReceived({LABEL: '貓'}), true);
    t.equal(ext.whenReceived({LABEL: '狗'}), false);
    t.equal(ext.whenReceived({LABEL: 'any'}), true);
    t.equal(ext.whenReceived({LABEL: '任何'}), true, '原版作品的「任何」');
    t.same(ext.getLabelsMenu().map(i => i.value), ['any', '貓', '狗']);
    t.same(ext.getLabelsWithoutAnyMenu().map(i => i.value), ['貓', '狗']);
    ext.setConfidenceThreshold({CONFIDENCE_THRESHOLD: 0.95});
    t.equal(ext.getImageLabel(), '', '低於最低信心');
    t.equal(ext.whenReceived({LABEL: 'any'}), false);
});

test('TM 影像：白名單外的網址、放錯類型、載入失敗都有提示', async t => {
    const state = {};
    const {ext, ui} = await makeTm({metadata: META, state});
    await ext.setImageClassificationModelURL({URL: 'https://example.com/model/'});
    t.match(ui.last().text, /只能使用 Teachable Machine 的分享連結/);
    t.equal(state.fetched, undefined, '白名單外的網址完全不連線');
    await ext.setImageClassificationModelURL({URL: SND});
    t.match(ui.last().text, /這是聲音模型/);
    state.imageFail = true;
    await ext.setImageClassificationModelURL({URL: IMG});
    t.match(ui.last().text, /圖片模型載入失敗（Failed to fetch）/);
    t.equal(ext.image, null);
    t.same(ext.getLabelsMenu().map(i => i.value), ['any'], '沒有模型時選單只有「任何」');
});

test('TM 影像：同一個模型沒重新訓練就不重新下載', async t => {
    const state = {imageResults: []};
    const {ext, ui} = await makeTm({metadata: META, state});
    await ext.setImageClassificationModelURL({URL: IMG});
    state.imageUrl = null;
    await ext.setImageClassificationModelURL({URL: IMG});
    t.equal(state.imageUrl, null);
    t.match(ui.last().text, /已經載入了/);
    META[IMG].timeStamp = 101;
    await ext.setImageClassificationModelURL({URL: IMG});
    t.not(state.imageUrl, null, '重新訓練（timeStamp 不同）時重新載入');
});

test('TM 聲音：持續聆聽；「任何」不算背景雜音；關閉辨識時停止聆聽', async t => {
    const state = {};
    const {ext, ui} = await makeTm({metadata: META, state});
    await ext.setSoundClassificationModelURL({URL: SND});
    t.match(ui.last().text, /已載入聲音模型/);
    t.ok(state.soundCb, '開始聆聽');
    state.soundCb(null, [{label: 'Background Noise', confidence: 0.9}, {label: '拍手', confidence: 0.1}]);
    t.equal(ext.getSoundLabel(), 'Background Noise');
    t.equal(ext.whenReceivedSoundLabel({LABEL: 'any'}), false, '背景雜音不算「任何」');
    state.soundCb(null, [{label: '拍手', confidence: 0.8}]);
    t.equal(ext.whenReceivedSoundLabel({LABEL: 'any'}), true);
    t.equal(ext.whenReceivedSoundLabel({LABEL: '拍手'}), true);
    t.equal(ext.soundLabelConfidence({LABEL: '拍手'}), 0.8);
    t.same(ext.getSoundLabelsWithoutBackgroundMenu().map(i => i.value), ['any', '拍手', '口哨'], '事件選單不列背景雜音');
    await ext.toggleClassification({CLASSIFICATION_STATE: 'off'});
    t.equal(state.stopped, 1);
    t.equal(ext.getSoundLabel(), '');
    state.soundCb(null, [{label: '口哨', confidence: 1}]);
    t.equal(ext.getSoundLabel(), '', '停止後的結果不採用');
    await ext.toggleClassification({CLASSIFICATION_STATE: 'on'});
    state.soundCb(null, [{label: '口哨', confidence: 1}]);
    t.equal(ext.getSoundLabel(), '口哨', '重新開始聆聽');
});

test('TM 聲音：麥克風無法使用時提示', async t => {
    const state = {};
    const {ext, ui} = await makeTm({metadata: META, state});
    await ext.setSoundClassificationModelURL({URL: SND});
    state.soundCb('ERROR: Permission denied');
    t.match(ui.last().text, /沒辦法使用麥克風/);
    t.equal(ui.last().kind, 'error');
});

test('TM：辨識頻率（秒，最快 0.1）與辨識開關', async t => {
    const {ext, schedule} = await makeTm({metadata: META, state: {imageResults: []}});
    ext.setClassificationInterval({CLASSIFICATION_INTERVAL: '0.5'});
    t.equal(ext.intervalMs, 500);
    ext.setClassificationInterval({CLASSIFICATION_INTERVAL: '0.01'});
    t.equal(ext.intervalMs, 100);
    await ext.toggleClassification({CLASSIFICATION_STATE: 'off'});
    t.equal(ext.mode, 'manual');
    await schedule.runNext();
    t.equal(schedule.queue.length, 0, '關閉後停止辨識');
});

test('TM 影像、聲音：積木清單（SPEC 7.7.6，✚ 不顯示）', async t => {
    const {ext} = await makeTm();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'tm2scratch');
    t.equal(info.name, 'Teachable Machine（影像、聲音）');
    const blocks = info.blocks.filter(b => b !== '---');
    t.same(blocks.filter(b => !b.hideFromPalette).map(b => b.opcode), [
        'setImageClassificationModelURL', 'getImageLabel', 'whenReceived', 'imageLabelConfidence',
        'setSoundClassificationModelURL', 'getSoundLabel', 'whenReceivedSoundLabel', 'soundLabelConfidence',
        'setConfidenceThreshold', 'getConfidenceThreshold', 'setClassificationInterval', 'toggleClassification',
        'videoToggle', 'selectCamera', 'setVideoTransparency', 'setInput', 'getDetectRate'
    ]);
    t.same(blocks.filter(b => b.hideFromPalette).map(b => b.opcode), ['isImageLabelDetected', 'isSoundLabelDetected', 'classifyVideoImageBlock', 'switchCamera']);
    for (const m of ['received_menu', 'image_labels_menu', 'image_labels_without_any_menu', 'received_sound_label_menu', 'sound_labels_menu', 'sound_labels_without_any_menu', 'video_menu', 'classification_interval_menu', 'classification_menu', 'mediadevices']) {
        t.ok(info.menus[m], `原版選單 ${m}`);
        if (typeof info.menus[m].items === 'string') t.equal(typeof ext[info.menus[m].items], 'function', `${m} 的動態選單有實作`);
    }
    t.notOk(blocks.some(b => /teachablemachine\.withgoogle\.com\/models\/[A-Za-z0-9]/.test(JSON.stringify(b.arguments || {}))), '不再內建範例模型網址');
    for (const b of blocks) t.notMatch(b.text, /[ぁ-んァ-ン]|undefined/);
});

// ---------- Teachable Machine（姿態） ----------
const POSE = 'https://teachablemachine.withgoogle.com/models/pose1/';

const makePose = async ({state = {}} = {}) => {
    const ui = makeUi();
    const schedule = makeSchedule();
    const scope = {fetch: async url => (url.startsWith(POSE)
        ? {ok: true, status: 200, json: async () => ({packageName: '@teachablemachine/pose', labels: ['站', '舉手'], timeStamp: 5})}
        : {ok: false, status: 404, json: async () => ({})})};
    const tmPose = {load: async (modelUrl, metadataUrl) => {
        state.loaded = [modelUrl, metadataUrl];
        state.fetchDuringLoad = scope.fetch;
        return {
            estimatePose: async (input, flip) => { state.estimateArgs = [input, flip]; return {pose: {}, posenetOutput: 'P'}; },
            predict: async out => { state.predictInput = out; return state.prediction; }
        };
    }};
    const ext = new TMPose2Scratch(makeRuntime(), {loadMl5: async () => tmPose, ui, schedule, scope, overlay: {draw () {}, clear () {}}});
    await ext.ready;
    await new Promise(r => setImmediate(r));
    return {ext, ui, schedule, state, scope};
};

test('TM 姿態：載入（PoseNet 權重改導）、辨識、事件', async t => {
    const state = {prediction: [{className: '站', probability: 0.2}, {className: '舉手', probability: 0.8}]};
    const {ext, ui, schedule, scope} = await makePose({state});
    await ext.setPoseClassificationModelURL({URL: 'https://teachablemachine.withgoogle.com/models/pose1'});
    t.same(state.loaded, [`${POSE}model.json`, `${POSE}metadata.json`]);
    t.not(state.fetchDuringLoad, undefined);
    t.match(ui.last().text, /已載入姿態模型（標籤：站、舉手）/);
    await schedule.runNext();
    t.equal(state.predictInput, 'P', 'PoseNet 的輸出交給分類模型');
    t.equal(ext.getPoseLabel(), '舉手');
    t.equal(ext.poseLabelConfidence({LABEL: '舉手'}), 0.8);
    t.equal(ext.whenPoseLabelReceived({LABEL: '舉手'}), true);
    t.equal(ext.whenPoseLabelReceived({LABEL: '站'}), false);
    t.same(ext.getPoseLabelsMenu().map(i => i.value), ['any', '站', '舉手']);
    await ext.setPoseClassificationModelURL({URL: IMG});
    t.match(ui.last().text, /找不到這個模型/);
});

test('TM 姿態：只載入本網域的 TensorFlow.js 與 @teachablemachine/pose', t => {
    t.equal(loader.TFJS_URL, '/vendor/tfjs-1.3.1.min.js');
    t.equal(loader.TM_POSE_URL, '/vendor/teachablemachine-pose-0.8.6.min.js');
    t.end();
});

test('loadTmPose：先載入 TensorFlow.js 再載入 tmPose', async t => {
    const order = [];
    const scope = {document: {createElement: () => ({remove () {}}), head: {appendChild: s => {
        order.push(s.src);
        setImmediate(() => {
            if (s.src.includes('tfjs')) scope.tf = {};
            else scope.tmPose = {ok: true};
            s.onload();
        });
    }}}};
    const tmPose = await loader.loadTmPose(scope);
    t.same(order, ['/vendor/tfjs-1.3.1.min.js', '/vendor/teachablemachine-pose-0.8.6.min.js']);
    t.same(tmPose, {ok: true});
});

test('TM 姿態：積木清單', async t => {
    const {ext} = await makePose();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'tmpose2scratch');
    t.equal(info.name, 'Teachable Machine（姿態）');
    const blocks = info.blocks.filter(b => b !== '---');
    t.same(blocks.filter(b => !b.hideFromPalette).map(b => b.opcode), [
        'setPoseClassificationModelURL', 'getPoseLabel', 'whenPoseLabelReceived', 'poseLabelConfidence',
        'setConfidenceThreshold', 'getConfidenceThreshold', 'setClassificationInterval', 'toggleClassification',
        'videoToggle', 'selectCamera', 'setVideoTransparency', 'setInput', 'getDetectRate'
    ]);
    for (const m of ['received_pose_label_menu', 'pose_labels_menu', 'pose_labels_without_any_menu', 'video_menu', 'classification_interval_menu', 'classification_menu']) t.ok(info.menus[m]);
    for (const b of blocks) t.notMatch(b.text, /[ぁ-んァ-ン]|undefined/);
});

// ---------- 瀏覽器實測發現的問題 ----------
test('訊息裡的擴展名稱正確（之前 _label 名稱衝突，訊息會印出程式碼）', async t => {
    const {ui} = await makeTm();
    t.equal(ui.last().text, 'Teachable Machine準備好了');
    const pose = await makePose();
    t.equal(pose.ui.last().text, 'Teachable Machine（姿態）準備好了');
    for (const s of [...ui.shown, ...pose.ui.shown]) t.notMatch(s.text, /=>|function|\{/);
});

test('TM 姿態：分類模型的層改名後再載入（避免和 TM 影像的模型撞名）', async t => {
    let loadedUrl = null;
    const artifacts = {
        modelTopology: {class_name: 'Sequential', config: {name: 'sequential_2', layers: [
            {class_name: 'Dense', config: {name: 'dense_Dense1', units: 100}},
            {class_name: 'Dropout', config: {name: 'dropout_Dropout1'}},
            {class_name: 'Dense', config: {name: 'dense_Dense2'}}
        ]}},
        weightSpecs: [{name: 'dense_Dense1/kernel', shape: [1, 100]}, {name: 'dense_Dense1/bias', shape: [100]}, {name: 'dense_Dense2/kernel', shape: [100, 2]}],
        weightData: new ArrayBuffer(8)
    };
    const tf = {io: {
        browserHTTPRequest: url => ({load: async () => { loadedUrl = url; return artifacts; }}),
        fromMemory: a => ({memory: a})
    }};
    const handler = await TMPose2Scratch.prefixedLayersModel(tf, `${POSE}model.json`, 'p_');
    t.equal(loadedUrl, `${POSE}model.json`);
    const m = handler.memory;
    t.same(m.modelTopology.config.layers.map(l => l.config.name), ['p_dense_Dense1', 'p_dropout_Dropout1', 'p_dense_Dense2']);
    t.same(m.weightSpecs.map(w => w.name), ['p_dense_Dense1/kernel', 'p_dense_Dense1/bias', 'p_dense_Dense2/kernel']);
    t.equal(m.modelTopology.config.name, 'p_sequential_2');
    t.equal(m.weightData, artifacts.weightData);
    t.equal(artifacts.modelTopology.config.layers[0].config.name, 'dense_Dense1', '不改動原本的資料');
    artifacts.modelTopology.class_name = 'Model';
    t.equal(await TMPose2Scratch.prefixedLayersModel(tf, 'u', 'p_'), 'u', '不是 Sequential 時原樣交給 TensorFlow.js');
    t.equal(await TMPose2Scratch.prefixedLayersModel(undefined, 'u', 'p_'), 'u');
});

test('換模型時釋放舊模型', async t => {
    const state = {imageResults: []};
    const {ext} = await makeTm({metadata: META, state});
    await ext.setImageClassificationModelURL({URL: IMG});
    let disposed = 0;
    ext.image.classifier.model.dispose = () => disposed++;
    META[IMG].timeStamp = 999;
    await ext.setImageClassificationModelURL({URL: IMG});
    t.equal(disposed, 1);
});
