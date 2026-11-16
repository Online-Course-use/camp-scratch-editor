/* eslint-disable */
/**
 * 影像訓練器擴展：學員在瀏覽器裡現場用攝影機畫面訓練影像分類（最多 10 個標籤）。
 *
 * 改寫自 champierre/ml2scratch（AGPL-3.0，https://github.com/champierre/ml2scratch，commit ba1ad68e，2026-09-17；
 * 該倉庫 package.json 寫 MIT 但 LICENSE 檔是 AGPL-3.0，依 SPEC 7.3.2 一律以 AGPL-3.0 處理）。營隊於 2026-11 修改：
 *   - 改用營隊的視覺擴展基底（../camp_shared/vision-extension.js）：ml5 延遲載入、MobileNet 模型由本網域提供、
 *     攝影機與辨識的共通積木
 *   - 移除所有 alert、confirm 與原版的上傳視窗，改用不會卡住畫面的對話框（../camp_shared/dialog.js）
 *   - 「清除標籤」執行前確認（SPEC 7.7.5）；「載入學習資料」驗證格式與大小，只接受本擴展存下來的檔案（learning-data.js）
 *   - 修正原版的錯誤：辨識結果原本不是信心最高的標籤；每次辨識的特徵張量沒有釋放（記憶體越用越多）
 *   - 依 SPEC 7.7.5 新增：標籤名稱、辨識到的標籤名稱、最低信心值；標籤上限 10
 *   - 繁體中文文案
 * 原版積木的 opcode 與選單名稱保留（不在 SPEC 範圍的不顯示），用原版做的作品可以開啟；
 * 但原版下載的學習資料檔不能載入（格式不同，SPEC 要求只接受本擴展匯出的檔案）。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const CampVisionExtension = require('../camp_shared/vision-extension');
const dialog = require('../camp_shared/dialog');
const learningData = require('./learning-data');

const blockIconURI = 'data:image/png;base64,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';

/** 事件積木在收到辨識結果後維持「成立」多久（毫秒），沿用原版。 */
const HAT_TIMEOUT = 100;
const DEFAULT_MIN_CONFIDENCE = 0.6;
/** 預設每 0.5 秒辨識一次（原版 1 秒；太快的話「當辨識到標籤」會一直重複觸發）。 */
const DEFAULT_INTERVAL_MS = 500;

/** 本網域自架的模型（由 camp-host/scripts/mirror-models.mjs 準備）。ml5 允許直接指定網址，不需要改導。 */
const MODEL_URLS = {
    mobilenetURL: '/models/mobilenet-layers/model.json',
    graphModelURL: '/models/mobilenet-graph/model.json'
};

const Message = {
    name: {'zh-tw': '影像訓練器', 'en': 'ML2Scratch'},
    train: {'zh-tw': '學習標籤 [LABEL]', 'en': 'train label [LABEL]'},
    getCountByLabel: {'zh-tw': '標籤 [LABEL] 的樣本數', 'en': 'counts of label [LABEL]'},
    getLabel: {'zh-tw': '辨識到的標籤', 'en': 'label'},
    whenAnyLabel: {'zh-tw': '當辨識到任何標籤', 'en': 'when received any label'},
    whenReceived: {'zh-tw': '當辨識到標籤 [LABEL]', 'en': 'when received label [LABEL]'},
    reset: {'zh-tw': '清除標籤 [LABEL]', 'en': 'reset label [LABEL]'},
    resetAll: {'zh-tw': '清除所有標籤', 'en': 'reset all labels'},
    download: {'zh-tw': '儲存學習資料', 'en': 'download learning data'},
    upload: {'zh-tw': '載入學習資料', 'en': 'upload learning data'},
    setLabelName: {'zh-tw': '標籤 [LABEL] 的名稱設為 [NAME]', 'en': 'set name of label [LABEL] to [NAME]'},
    getLabelName: {'zh-tw': '標籤 [LABEL] 的名稱', 'en': 'name of label [LABEL]'},
    getLabelResultName: {'zh-tw': '辨識到的標籤名稱', 'en': 'name of detected label'},
    setMinConfidence: {'zh-tw': '最低信心設為 [CONFIDENCE]', 'en': 'set minimum confidence to [CONFIDENCE]'},
    getMinConfidence: {'zh-tw': '最低信心', 'en': 'minimum confidence'},
    legacyTrain: {'zh-tw': '學習標籤 [N]', 'en': 'train label [N]'},
    legacyCount: {'zh-tw': '標籤 [N] 的樣本數', 'en': 'counts of label [N]'},
    toggleClassification: {'zh-tw': '辨識 [CLASSIFICATION_STATE]', 'en': 'turn classification [CLASSIFICATION_STATE]'},
    setClassificationInterval: {'zh-tw': '每 [CLASSIFICATION_INTERVAL] 秒辨識一次', 'en': 'label once every [CLASSIFICATION_INTERVAL] seconds'},
    switchCamera: {'zh-tw': '切換攝影機為 [DEVICE]', 'en': 'switch webcam to [DEVICE]'}
};

const normalizeLabel = value => {
    const n = parseInt(Cast.toString(value), 10);
    return n >= 1 && n <= learningData.MAX_LABEL && String(n) === Cast.toString(value).trim() ? String(n) : null;
};

const labelItems = () => {
    const items = [];
    for (let i = 1; i <= learningData.MAX_LABEL; i++) items.push({text: String(i), value: String(i)});
    return items;
};

class Scratch3ML2ScratchBlocks extends CampVisionExtension {
    static get LABEL () {
        return '影像辨識';
    }

    static get ITEM_NAME () {
        return '個結果';
    }

    constructor (runtime, deps = {}) {
        super(runtime, deps, Message);
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.minConfidence = DEFAULT_MIN_CONFIDENCE;
        this.labelNames = {};
        this._dialog = Object.assign({}, dialog, deps.dialog || {});
        this._readFile = deps.readFile || (file => file.text());
        this._hatFlags = {};
        this._warnedFirstTraining = false;
    }

    // ------------------------------------------------------------ 模型

    async _createModel (ml5) {
        const extractor = ml5.featureExtractor('MobileNet', MODEL_URLS);
        await extractor.ready;
        return {extractor, knn: ml5.KNNClassifier(), tf: ml5.tf};
    }

    async _predict (model, input) {
        if (!model.knn.getNumLabels()) return [];
        const features = model.extractor.infer(input);
        let result;
        try {
            result = await model.knn.classify(features);
        } finally {
            if (features && features.dispose) features.dispose();
        }
        let label = null;
        let confidence = 0;
        for (const [l, c] of Object.entries((result && result.confidencesByLabel) || {})) {
            if (c > confidence) {
                label = l;
                confidence = c;
            }
        }
        if (label === null || confidence < this.minConfidence) return [];
        return [{label, confidence}];
    }

    _setDetections (items) {
        super._setDetections(items);
        // 每次有新結果就重設：只有這次辨識到的標籤成立，之前的結果不會在之後才觸發事件
        if (items.length) this._hatFlags = {any: true, [items[0].label]: true};
    }

    _counts () {
        if (!this.model) return {};
        return this.model.knn.getCountByLabel() || {};
    }

    _total () {
        return Object.values(this._counts()).reduce((a, b) => a + (b || 0), 0);
    }

    _display (label) {
        return this.labelNames[label] ? `${label}（${this.labelNames[label]}）` : label;
    }

    // ------------------------------------------------------------ 積木清單

    getDevices () {
        return this.getCameraMenu();
    }

    getInfo () {
        this._locale = this.setLocale();
        const label = (menu, defaultValue = '1') => ({type: ArgumentType.STRING, menu, defaultValue});
        const hidden = [];
        for (let i = 1; i <= 3; i++) {
            hidden.push({opcode: `addExample${i}`, blockType: BlockType.COMMAND, text: this._t('legacyTrain').replace('[N]', i), hideFromPalette: true});
        }
        for (let i = 1; i <= learningData.MAX_LABEL; i++) {
            hidden.push({opcode: `getCountByLabel${i}`, blockType: BlockType.REPORTER, text: this._t('legacyCount').replace('[N]', i), hideFromPalette: true});
        }
        hidden.push(
            {opcode: 'trainAny', blockType: BlockType.COMMAND, text: this._t('train'), hideFromPalette: true, arguments: {LABEL: {type: ArgumentType.STRING, defaultValue: '1'}}},
            {opcode: 'whenReceivedAny', blockType: BlockType.HAT, isEdgeActivated: false, text: this._t('whenReceived'), hideFromPalette: true, arguments: {LABEL: {type: ArgumentType.STRING, defaultValue: '1'}}},
            {opcode: 'resetAny', blockType: BlockType.COMMAND, text: this._t('reset'), hideFromPalette: true, arguments: {LABEL: {type: ArgumentType.STRING, defaultValue: '1'}}},
            {opcode: 'toggleClassification', blockType: BlockType.COMMAND, text: this._t('toggleClassification'), hideFromPalette: true, arguments: {CLASSIFICATION_STATE: label('classification_menu', 'on')}},
            {opcode: 'setClassificationInterval', blockType: BlockType.COMMAND, text: this._t('setClassificationInterval'), hideFromPalette: true, arguments: {CLASSIFICATION_INTERVAL: label('classification_interval_menu', '1')}},
            {opcode: 'switchCamera', blockType: BlockType.COMMAND, text: this._t('switchCamera'), hideFromPalette: true, arguments: {DEVICE: label('mediadevices', '')}}
        );

        return {
            id: 'ml2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'train', blockType: BlockType.COMMAND, text: this._t('train'), arguments: {LABEL: label('train_menu')}},
                {opcode: 'getCountByLabel', blockType: BlockType.REPORTER, text: this._t('getCountByLabel'), arguments: {LABEL: label('count_menu')}},
                {opcode: 'getLabel', blockType: BlockType.REPORTER, text: this._t('getLabel')},
                {opcode: 'whenAnyLabel', blockType: BlockType.HAT, isEdgeActivated: false, text: this._t('whenAnyLabel')},
                {opcode: 'whenReceived', blockType: BlockType.HAT, isEdgeActivated: false, text: this._t('whenReceived'), arguments: {LABEL: label('received_menu')}},
                {opcode: 'reset', blockType: BlockType.COMMAND, text: this._t('reset'), arguments: {LABEL: label('reset_menu')}},
                {opcode: 'resetAll', blockType: BlockType.COMMAND, text: this._t('resetAll')},
                {opcode: 'download', blockType: BlockType.COMMAND, text: this._t('download')},
                {opcode: 'upload', blockType: BlockType.COMMAND, text: this._t('upload')},
                '---',
                {
                    opcode: 'setLabelName',
                    blockType: BlockType.COMMAND,
                    text: this._t('setLabelName'),
                    arguments: {LABEL: label('train_menu'), NAME: {type: ArgumentType.STRING, defaultValue: '剪刀'}}
                },
                {opcode: 'getLabelName', blockType: BlockType.REPORTER, text: this._t('getLabelName'), arguments: {LABEL: label('count_menu')}},
                {opcode: 'getLabelResultName', blockType: BlockType.REPORTER, text: this._t('getLabelResultName')},
                {
                    opcode: 'setMinConfidence',
                    blockType: BlockType.COMMAND,
                    text: this._t('setMinConfidence'),
                    arguments: {CONFIDENCE: {type: ArgumentType.NUMBER, defaultValue: DEFAULT_MIN_CONFIDENCE}}
                },
                {opcode: 'getMinConfidence', blockType: BlockType.REPORTER, text: this._t('getMinConfidence')},
                '---',
                ...this._videoBlocks(),
                '---',
                // 影像訓練器沒有偵測框、倍率（SPEC 7.7.0：偵測框只有臉／手／姿態）
                ...this._detectBlocks().filter(b => b.opcode !== 'setShowBox' && b.opcode !== 'setRatio'),
                ...hidden
            ],
            menus: Object.assign(this._commonMenus(), {
                // 選單名稱沿用原版，原版作品才能開啟
                train_menu: {acceptReporters: true, items: labelItems()},
                count_menu: {acceptReporters: true, items: labelItems()},
                received_menu: {acceptReporters: true, items: labelItems()},
                reset_menu: {acceptReporters: true, items: labelItems()},
                video_menu: {acceptReporters: true, items: this._commonMenus().videoMenu.items},
                input_menu: {acceptReporters: false, items: [{text: this._t('camera'), value: 'webcam'}, {text: this._t('stage'), value: 'stage'}]},
                classification_menu: {acceptReporters: false, items: [{text: this._t('off'), value: 'off'}, {text: this._t('on'), value: 'on'}]},
                classification_interval_menu: {acceptReporters: true, items: ['1', '0.5', '0.2', '0.1'].map(v => ({text: v, value: v}))},
                mediadevices: {acceptReporters: true, items: 'getDevices'}
            })
        };
    }

    // ------------------------------------------------------------ 學習

    async train (args) {
        const label = normalizeLabel(args.LABEL);
        if (!label) {
            this._ui.show(`標籤要是 1 到 ${learningData.MAX_LABEL} 的數字`, {kind: 'error'});
            return;
        }
        if (!this._sourceAvailable()) {
            this._ui.show('請先用「影像 開啟」打開攝影機，再學習', {kind: 'error'});
            return;
        }
        await this._prepare();
        if (!this.model) return;
        const src = this._source();
        if (!src) {
            this._ui.show('攝影機畫面還沒準備好，請稍等一下再試', {kind: 'error'});
            return;
        }
        const features = this.model.extractor.infer(src.el);
        try {
            this.model.knn.addExample(features, label);
        } finally {
            if (features && features.dispose) features.dispose();
        }
        if (!this._warnedFirstTraining) {
            this._warnedFirstTraining = true;
            this._ui.show(
                '提醒：學習資料不會跟著作品存檔。重新整理或換電腦之後要重新學習；\n想保留的話，用「儲存學習資料」下載成檔案。',
                {autoHideMs: 8000}
            );
        }
        this._ensureLoop();
    }

    getCountByLabel (args) {
        const label = normalizeLabel(args.LABEL);
        return label ? (this._counts()[label] || 0) : 0;
    }

    getLabel () {
        return this.detections.length ? this.detections[0].label : '';
    }

    getLabelResultName () {
        if (!this.detections.length) return '';
        const label = this.detections[0].label;
        return this.labelNames[label] || label;
    }

    whenReceived (args) {
        const key = Cast.toString(args.LABEL) === 'any' ? 'any' : normalizeLabel(args.LABEL);
        if (!key || !this._hatFlags[key]) return false;
        setTimeout(() => {
            this._hatFlags[key] = false;
        }, HAT_TIMEOUT);
        return true;
    }

    whenAnyLabel () {
        return this.whenReceived({LABEL: 'any'});
    }

    async reset (args) {
        if (Cast.toString(args.LABEL) === 'all') return this.resetAll();
        const label = normalizeLabel(args.LABEL);
        if (!label) return;
        const count = this.getCountByLabel({LABEL: label});
        if (!count) {
            this._ui.show(`標籤 ${this._display(label)} 沒有樣本`, {autoHideMs: 2500});
            return;
        }
        const ok = await this._dialog.confirmDialog(this._scope, `要清除標籤 ${this._display(label)} 的 ${count} 個樣本嗎？\n清除後不能復原。`, {okText: '清除'});
        if (!ok) return;
        this.model.knn.clearLabel(label);
        this._setDetections([]);
        this._ui.show(`已清除標籤 ${this._display(label)}`, {kind: 'ok', autoHideMs: 2500});
    }

    async resetAll () {
        const total = this._total();
        if (!total) {
            this._ui.show('目前沒有任何樣本', {autoHideMs: 2500});
            return;
        }
        const ok = await this._dialog.confirmDialog(this._scope, `要清除所有標籤的 ${total} 個樣本嗎？\n清除後不能復原。`, {okText: '全部清除'});
        if (!ok) return;
        this.model.knn.clearAllLabels();
        this._setDetections([]);
        this._ui.show('已清除所有標籤', {kind: 'ok', autoHideMs: 2500});
    }

    // ------------------------------------------------------------ 儲存與載入

    download () {
        if (!this._total()) {
            this._ui.show('還沒有學習資料可以儲存，先用「學習標籤」學幾張吧', {kind: 'error'});
            return;
        }
        const knn = this.model.knn;
        const dataset = knn.getClassifierDataset();
        const examples = {};
        for (const [index, tensor] of Object.entries(dataset)) {
            const label = knn.mapStringToIndex[index];
            if (label && tensor) examples[label] = tensor.dataSync();
        }
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
        const ok = this._dialog.downloadText(this._scope, `影像訓練器學習資料-${stamp}.json`, learningData.encode({labelNames: this.labelNames, examples}));
        if (ok) this._ui.show('學習資料已開始下載', {kind: 'ok', autoHideMs: 2500});
    }

    async upload () {
        const file = await this._dialog.pickFileDialog(
            this._scope,
            '選擇之前用「儲存學習資料」存下來的檔案（.json）',
            {accept: '.json,application/json'}
        );
        if (!file) return;
        let data;
        try {
            if (file.size > learningData.MAX_BYTES) throw new learningData.LearningDataError(`檔案太大（上限 ${learningData.MAX_BYTES / 1024 / 1024} MB）`);
            data = learningData.decode(await this._readFile(file), file.size);
        } catch (e) {
            const reason = e instanceof learningData.LearningDataError ? e.message : '讀取檔案失敗';
            this._ui.show(`沒辦法載入學習資料：${reason}`, {kind: 'error'});
            return;
        }
        await this._prepare();
        if (!this.model) return;
        if (this._total()) {
            const ok = await this._dialog.confirmDialog(this._scope, '載入會取代目前的學習資料（目前學過的樣本會被清除）。要繼續嗎？', {okText: '載入'});
            if (!ok) return;
        }
        const {knn, tf} = this.model;
        knn.clearAllLabels();
        const dataset = {};
        let total = 0;
        const labels = Object.keys(data.examples).sort((a, b) => Number(a) - Number(b));
        for (const label of labels) {
            const {count, values} = data.examples[label];
            const index = knn.mapStringToIndex.push(label) - 1;
            dataset[index] = tf.tensor2d(values, [count, learningData.FEATURE_DIM]);
            total += count;
        }
        knn.setClassifierDataset(dataset);
        this.labelNames = Object.assign({}, data.labelNames);
        this._setDetections([]);
        this._ui.show(`已載入學習資料（${labels.length} 個標籤、${total} 個樣本）`, {kind: 'ok', autoHideMs: 3000});
        this._ensureLoop();
    }

    // ------------------------------------------------------------ 標籤名稱與信心

    setLabelName (args) {
        const label = normalizeLabel(args.LABEL);
        if (!label) return;
        const name = Cast.toString(args.NAME).trim().slice(0, learningData.MAX_NAME_LENGTH);
        if (name) this.labelNames[label] = name;
        else delete this.labelNames[label];
    }

    getLabelName (args) {
        const label = normalizeLabel(args.LABEL);
        return (label && this.labelNames[label]) || '';
    }

    setMinConfidence (args) {
        this.minConfidence = Math.min(1, Math.max(0, Cast.toNumber(args.CONFIDENCE)));
    }

    getMinConfidence () {
        return this.minConfidence;
    }

    // ------------------------------------------------------------ 原版的積木（不顯示，只為了原版作品）

    addExample1 () {
        return this.train({LABEL: '1'});
    }

    addExample2 () {
        return this.train({LABEL: '2'});
    }

    addExample3 () {
        return this.train({LABEL: '3'});
    }

    trainAny (args) {
        return this.train(args);
    }

    whenReceivedAny (args) {
        return this.whenReceived(args);
    }

    resetAny (args) {
        return this.reset(args);
    }

    toggleClassification (args) {
        return this.setDetectMode({MODE: args.CLASSIFICATION_STATE === 'off' ? 'manual' : 'continuous'});
    }

    setClassificationInterval (args) {
        return this.setDetectInterval({MS: Cast.toNumber(args.CLASSIFICATION_INTERVAL) * 1000});
    }

    async switchCamera (args) {
        const cameras = await this._refreshCameras();
        // 原版存的是攝影機的 deviceId；新的選單是編號
        const index = (cameras.findIndex(c => c.deviceId === args.DEVICE) + 1) || parseInt(Cast.toString(args.DEVICE), 10);
        if (index > 0) return this.selectCamera({CAMERA: String(index)});
    }
}

for (let i = 1; i <= learningData.MAX_LABEL; i++) {
    Scratch3ML2ScratchBlocks.prototype[`getCountByLabel${i}`] = function () {
        return this.getCountByLabel({LABEL: String(i)});
    };
}

module.exports = Scratch3ML2ScratchBlocks;
module.exports.MODEL_URLS = MODEL_URLS;
module.exports.DEFAULT_MIN_CONFIDENCE = DEFAULT_MIN_CONFIDENCE;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
