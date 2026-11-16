/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * Teachable Machine 兩個擴展（影像／聲音、姿態）的共用基底（SPEC 7.7.6）。
 * 建在視覺擴展基底上（攝影機、辨識迴圈、辨識輸入），再加上：載入模型的流程與提示、最低信心、
 * 辨識頻率（秒）、辨識開關、依模型標籤自動產生的下拉選單。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const CampVisionExtension = require('./vision-extension');
const teachable = require('./teachable');

const DEFAULT_THRESHOLD = 0.5;
/** 預設每 1 秒辨識一次；最快 0.1 秒（SPEC 7.7.6）。 */
const DEFAULT_INTERVAL_MS = 1000;
const MIN_INTERVAL_MS = 100;
const URL_PLACEHOLDER = 'https://teachablemachine.withgoogle.com/models/';

const TeachableMessage = {
    setConfidenceThreshold: {'zh-tw': '最低信心設為 [CONFIDENCE_THRESHOLD]', 'en': 'set confidence threshold [CONFIDENCE_THRESHOLD]'},
    getConfidenceThreshold: {'zh-tw': '最低信心', 'en': 'confidence threshold'},
    setClassificationInterval: {'zh-tw': '辨識頻率設為每 [CLASSIFICATION_INTERVAL] 秒', 'en': 'label once every [CLASSIFICATION_INTERVAL] seconds'},
    toggleClassification: {'zh-tw': '辨識 [CLASSIFICATION_STATE]', 'en': 'turn classification [CLASSIFICATION_STATE]'},
    switchCamera: {'zh-tw': '切換攝影機為 [DEVICE]', 'en': 'switch webcam to [DEVICE]'},
    any: {'zh-tw': '任何', 'en': 'any'},
    noModel: {'zh-tw': '（先設定模型網址）', 'en': '(set the model URL first)'}
};

class CampTeachableExtension extends CampVisionExtension {
    constructor (runtime, deps = {}, messages = {}) {
        super(runtime, deps, Object.assign({}, TeachableMessage, messages));
        this._tm = Object.assign({}, teachable, deps.teachable || {});
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.confidenceThreshold = DEFAULT_THRESHOLD;
        this.classifying = true;
        this._crop = null;
    }

    // ------------------------------------------------------------ 載入模型

    /**
     * 載入一個 Teachable Machine 模型，全程用右下角訊息回報。
     * @param {string} type - 'image'、'sound' 或 'pose'
     * @param {string} rawUrl - 學員貼上的網址
     * @param {object|null} current - 目前已載入的 {url, metadata}
     * @param {function(string, object): Promise<object>} create - 用網址與函式庫建立分類器
     * @returns {Promise<object|null>} {url, metadata, labels, classifier}；失敗或不用重新載入時回傳 null
     */
    async _loadTeachable (type, rawUrl, current, create) {
        const name = `${this._tm.TYPE_TEXT[type]}模型`;
        let url;
        try {
            url = this._tm.normalizeModelUrl(rawUrl);
        } catch (e) {
            this._ui.show(e.message, {kind: 'error'});
            return null;
        }
        await this._prepare();
        if (!this.model) return null;
        this._ui.show(`正在載入${name}…`);
        try {
            const metadata = await this._tm.fetchMetadata(this._scope, url, type);
            // 同一個網址、模型沒有重新訓練過：不用重新下載
            if (current && current.url === url && String(current.metadata.timeStamp) === String(metadata.timeStamp)) {
                this._ui.show(`${name}已經載入了`, {kind: 'ok', autoHideMs: 2000});
                return null;
            }
            const classifier = await create(url, this.model);
            const labels = this._tm.modelLabels(metadata);
            this._ui.show(`已載入${name}（標籤：${labels.join('、')}）`, {kind: 'ok', autoHideMs: 4000});
            return {url, metadata, labels, classifier};
        } catch (e) {
            const reason = e instanceof this._tm.TeachableError ? e.message : `${name}載入失敗（${(e && e.message) || '未知的原因'}），請確認連結正確、網路可以連到 Google`;
            console.error(`[${this._label}] 載入模型失敗`, e);
            this._ui.show(reason, {kind: 'error'});
            return null;
        }
    }

    /** 換模型時釋放舊模型佔用的記憶體。 */
    _disposeModel (loaded) {
        const model = loaded && loaded.classifier && loaded.classifier.model;
        try {
            if (model && model.dispose) model.dispose();
        } catch (e) {
            // 已經釋放了
        }
    }

    /** ml5 載入失敗時不丟錯誤，而是把錯誤放在 model 裡；統一檢查。 */
    _checkMl5Classifier (classifier) {
        if (!classifier || !classifier.model || classifier.model instanceof Error) {
            throw new Error((classifier && classifier.model && classifier.model.message) || '模型檔無法讀取');
        }
        return classifier;
    }

    /** 攝影機畫面取中央正方形（照鏡子時左右翻轉），與 Teachable Machine 訓練時的畫面一致。 */
    _squareInput (input, size) {
        const flip = input === (this._video.provider && this._video.provider.video) && this._video.mirror !== false;
        const out = this._tm.squareCrop(this._scope, input, size, flip, this._crop);
        if (out !== input) this._crop = out;
        return out;
    }

    // ------------------------------------------------------------ 標籤

    /** probs 裡信心最高、且不低於最低信心的標籤；沒有就是空字串。 */
    _bestLabel (probs) {
        const top = this._tm.topLabel(probs, this.confidenceThreshold);
        return top ? top.label : '';
    }

    _matches (probs, value) {
        const label = this._bestLabel(probs);
        return this._tm.isAny(value) ? label !== '' : label === Cast.toString(value);
    }

    _confidence (probs, value) {
        const entry = (probs || []).find(p => p.label === Cast.toString(value));
        return entry ? Math.round(entry.confidence * 1000) / 1000 : 0;
    }

    /** 動態選單：「任何」＋模型的標籤（可排除某些標籤）。 */
    _labelMenu (loaded, {withAny = true, exclude = []} = {}) {
        const labels = loaded ? loaded.labels.filter(l => !exclude.includes(l)) : [];
        const items = labels.map(l => ({text: l, value: l}));
        if (withAny) items.unshift({text: this._t('any'), value: 'any'});
        if (!items.length) items.push({text: this._t('noModel'), value: ''});
        return items;
    }

    // ------------------------------------------------------------ 共通積木

    _teachableBlocks () {
        return [
            {
                opcode: 'setConfidenceThreshold',
                blockType: BlockType.COMMAND,
                text: this._t('setConfidenceThreshold'),
                arguments: {CONFIDENCE_THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: DEFAULT_THRESHOLD}}
            },
            {opcode: 'getConfidenceThreshold', blockType: BlockType.REPORTER, text: this._t('getConfidenceThreshold')},
            {
                opcode: 'setClassificationInterval',
                blockType: BlockType.COMMAND,
                text: this._t('setClassificationInterval'),
                arguments: {CLASSIFICATION_INTERVAL: {type: ArgumentType.STRING, menu: 'classification_interval_menu', defaultValue: '1'}}
            },
            {
                opcode: 'toggleClassification',
                blockType: BlockType.COMMAND,
                text: this._t('toggleClassification'),
                arguments: {CLASSIFICATION_STATE: {type: ArgumentType.STRING, menu: 'classification_menu', defaultValue: 'off'}}
            }
        ];
    }

    /** 影像相關的共通積木：影像、選擇攝影機、影像透明度、辨識輸入、每秒辨識次數（頻率與開關用上面 TM 自己的積木）。 */
    _teachableVideoBlocks () {
        const detect = this._detectBlocks();
        return [
            ...this._videoBlocks(),
            detect.find(b => b.opcode === 'setInput'),
            detect.find(b => b.opcode === 'getDetectRate')
        ];
    }

    _teachableMenus () {
        const common = this._commonMenus();
        return Object.assign(common, {
            // 選單名稱沿用原版，原版作品才能開啟
            video_menu: {acceptReporters: true, items: common.videoMenu.items},
            classification_interval_menu: {acceptReporters: true, items: ['1', '0.5', '0.2', '0.1'].map(v => ({text: v, value: v}))},
            classification_menu: {acceptReporters: false, items: [{text: this._t('off'), value: 'off'}, {text: this._t('on'), value: 'on'}]}
        });
    }

    setConfidenceThreshold (args) {
        this.confidenceThreshold = Math.min(1, Math.max(0, Cast.toNumber(args.CONFIDENCE_THRESHOLD)));
    }

    getConfidenceThreshold () {
        return this.confidenceThreshold;
    }

    setClassificationInterval (args) {
        const seconds = Cast.toNumber(args.CLASSIFICATION_INTERVAL);
        this.intervalMs = Math.min(60000, Math.max(MIN_INTERVAL_MS, Math.round(seconds * 1000)));
    }

    async toggleClassification (args) {
        this.classifying = args.CLASSIFICATION_STATE !== 'off';
        await this.setDetectMode({MODE: this.classifying ? 'continuous' : 'manual'});
        if (!this.classifying) this._setDetections([]);
        this._onToggle(this.classifying);
    }

    /** 子類別：辨識開關切換時（例如聲音要開始／停止聆聽）。 */
    _onToggle () {}

    getDevices () {
        return this.getCameraMenu();
    }

    async switchCamera (args) {
        const cameras = await this._refreshCameras();
        // 原版存的是攝影機的 deviceId；新的選單是編號
        const index = (cameras.findIndex(c => c.deviceId === args.DEVICE) + 1) || parseInt(Cast.toString(args.DEVICE), 10);
        if (index > 0) return this.selectCamera({CAMERA: String(index)});
    }
}

module.exports = CampTeachableExtension;
module.exports.DEFAULT_THRESHOLD = DEFAULT_THRESHOLD;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
module.exports.URL_PLACEHOLDER = URL_PLACEHOLDER;
