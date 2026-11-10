/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 視覺類 AI 擴展的共用基底（SPEC 7.7.0）。臉部網格、手部姿勢都繼承它；姿態網路之後也用。
 *
 * 基底負責：開關攝影機、延遲載入 ml5 與模型（只載入一次、失敗會提示並可重試）、持續或手動辨識、
 * 辨識輸入（攝影機／舞台）、辨識間隔與每秒次數、選擇攝影機、偵測框、座標換算，
 * 以及這些功能的共通積木。沒有偵測到東西、或關閉影像時一律清空資料，積木不會回報舊座標。
 *
 * 子類別要提供：
 *   - static get LABEL ()             訊息裡的名稱，例如「臉部辨識」
 *   - static get ITEM_NAME ()         偵測框上的名稱，例如「張臉」→「第 1 張臉」
 *   - async _createModel (ml5)        回傳有預測功能的模型（在本網域模型改導期間呼叫）
 *   - async _predict (model, input)   回傳 [{keypoints: [[x, y, z], …]}]
 *   - getInfo ()                      用 _videoBlocks()、_detectBlocks()、_commonMenus() 組出積木清單
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const formatMessage = require('format-message');
const loader = require('./loader');
const vision = require('./vision');
const campUi = require('../scratch3_camparduino/ui');

const NOT_FOUND_VALUES = {blank: '', zero: 0, minus1: -1};

/** 預設的辨識間隔（毫秒）。辨識本身通常比這個久，這只是讓瀏覽器有空處理其他事情。 */
const DEFAULT_INTERVAL_MS = 33;
const MAX_INTERVAL_MS = 10000;

const CommonMessage = {
    videoToggle: {'zh-tw': '影像 [VIDEO_STATE]', 'ja': 'ビデオを [VIDEO_STATE] にする', 'ja-Hira': 'ビデオを [VIDEO_STATE] にする', 'en': 'turn video [VIDEO_STATE]'},
    selectCamera: {'zh-tw': '選擇攝影機 [CAMERA]', 'en': 'use camera [CAMERA]'},
    setVideoTransparency: {'zh-tw': '影像透明度設為 [TRANSPARENCY]', 'en': 'set video transparency to [TRANSPARENCY]'},
    setInput: {'zh-tw': '辨識輸入 [INPUT]', 'en': 'detect from [INPUT]'},
    setDetectMode: {'zh-tw': '辨識方式 [MODE]', 'en': 'detection mode [MODE]'},
    detectOnce: {'zh-tw': '辨識一次', 'en': 'detect once'},
    setDetectInterval: {'zh-tw': '辨識間隔設為 [MS] 毫秒', 'en': 'set detection interval to [MS] ms'},
    getDetectRate: {'zh-tw': '每秒辨識次數', 'en': 'detections per second'},
    setShowBox: {'zh-tw': '顯示偵測框 [STATE]', 'en': 'show detection box [STATE]'},
    setNotFound: {'zh-tw': '找不到時回傳 [VALUE]', 'en': 'when not found, report [VALUE]'},
    setRatio: {'zh-tw': '倍率設為 [RATIO]', 'ja': '倍率を [RATIO] にする', 'ja-Hira': 'ばいりつを [RATIO] にする', 'en': 'set ratio to [RATIO]'},
    on: {'zh-tw': '開啟', 'ja': '入', 'ja-Hira': 'いり', 'en': 'on'},
    off: {'zh-tw': '關閉', 'ja': '切', 'ja-Hira': 'きり', 'en': 'off'},
    video_on_flipped: {'zh-tw': '開啟（左右翻轉）', 'ja': '左右反転', 'ja-Hira': 'さゆうはんてん', 'en': 'on flipped'},
    camera: {'zh-tw': '攝影機', 'en': 'camera'},
    stage: {'zh-tw': '舞台', 'en': 'stage'},
    continuous: {'zh-tw': '持續辨識', 'en': 'continuous'},
    manual: {'zh-tw': '只在「辨識一次」時', 'en': 'only on "detect once"'},
    blank: {'zh-tw': '空白', 'en': 'blank'}
};
const AvailableLocales = ['en', 'ja', 'ja-Hira', 'zh-tw'];

class CampVisionExtension {
    /**
     * @param {object} runtime - Scratch 的執行環境
     * @param {object} [deps] - 測試用：替換載入函式庫、訊息面板、排程、瀏覽器物件與共用視覺工具
     * @param {object} [messages] - 子類別自己的文案（會覆蓋共通文案）
     */
    constructor (runtime, deps = {}, messages = {}) {
        this.runtime = runtime;
        this._messages = Object.assign({}, CommonMessage, messages);
        this._loadMl5 = deps.loadMl5 || loader.loadMl5;
        this._ui = deps.ui || campUi;
        this._schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
        this._scope = deps.scope || globalThis;
        this._vision = Object.assign({}, vision, deps.vision || {});
        this._overlay = deps.overlay || new vision.BoxOverlay(runtime.renderer, this._scope);
        this._rate = new vision.RateMeter(deps.now);
        this._locale = 'en';

        /** 目前偵測到的東西：[{keypoints, space}]，space 是 'video' 或 'stage'；沒有時是空陣列。 */
        this.detections = [];
        this.ratio = 0.75;
        /** 'idle'、'loading'、'ready' 或 'error' */
        this.status = 'idle';
        this.model = null;
        this.notFound = '';
        this.input = 'camera';
        this.mode = 'continuous';
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.showBox = false;
        this._cameras = [];
        this._cameraIndex = 0;
        this._preparing = null;
        this._videoOn = false;
        this._looping = false;
        this._detectErrorShown = false;
        this._stageCanvas = null;

        // 與原版相同：加入擴展就開啟攝影機（像照鏡子）並開始準備
        this.ready = this._turnVideoOn(true);
    }

    get _label () {
        return this.constructor.LABEL;
    }

    get _video () {
        return this.runtime.ioDevices.video;
    }

    _t (key) {
        const m = this._messages[key];
        return m[this._locale] || m.en;
    }

    // ------------------------------------------------------------ 攝影機與模型

    /**
     * 開啟攝影機，準備模型（只會準備一次），然後開始辨識。
     * @param {boolean} mirror - 是否像照鏡子一樣左右相反
     * @returns {Promise<void>} 不會丟出錯誤；失敗時顯示訊息
     */
    async _turnVideoOn (mirror) {
        this._videoOn = true;
        try {
            await this._video.enableVideo();
        } catch (e) {
            // 交給下面的檢查顯示訊息
        }
        if (!this._videoOn) return;
        this._video.mirror = mirror;
        if (!this._video.provider || !this._video.provider.video) {
            this._videoOn = false;
            this._ui.show(
                '沒辦法使用攝影機。\n請在網址列左邊允許這個網站使用攝影機，並確認沒有其他程式正在使用它，再把「影像」積木設為開啟',
                {kind: 'error'}
            );
            if (this.input !== 'stage') return;
        } else {
            await this._refreshCameras();
            // 之前選過別的攝影機：關掉再打開影像時，官方會回到預設攝影機，所以再換一次
            if (this._cameraIndex > 0) await this._applyCamera(this._cameraIndex, {quiet: true});
        }
        await this._prepare();
        this._ensureLoop();
    }

    async _refreshCameras () {
        const list = await this._vision.listCameras(this._scope);
        if (list.length) this._cameras = list;
        return this._cameras;
    }

    /**
     * 載入函式庫與模型。
     * @returns {Promise<void>} 不會丟出錯誤；失敗時 status 為 'error'，下次開啟影像會重試
     */
    _prepare () {
        if (this.model) return Promise.resolve();
        if (this._preparing) return this._preparing;
        this.status = 'loading';
        this._ui.show(`正在準備${this._label}，第一次需要一點時間…`);
        this._preparing = (async () => {
            try {
                const ml5 = await this._loadMl5(this._scope);
                const model = await loader.withLocalModels(this._scope, () => this._createModel(ml5));
                if (!model) throw new Error('模型沒有載入');
                this.model = model;
                this.status = 'ready';
                this._ui.show(`${this._label}準備好了`, {kind: 'ok', autoHideMs: 2500});
            } catch (e) {
                this.status = 'error';
                console.error(`[${this._label}] 準備失敗`, e);
                this._ui.show(
                    `${this._label}無法啟動（${(e && e.message) || '未知的原因'}）。\n請檢查網路後重新整理頁面；如果還是不行，請告訴老師`,
                    {kind: 'error'}
                );
            } finally {
                this._preparing = null;
            }
        })();
        return this._preparing;
    }

    // ------------------------------------------------------------ 辨識

    /** 目前有沒有東西可以辨識：舞台永遠有；攝影機要影像開著。 */
    _sourceAvailable () {
        return this.input === 'stage' || this._videoOn;
    }

    /** @returns {{el: object, space: string}|null} 這一次要辨識的畫面 */
    _source () {
        if (this.input === 'stage') {
            const canvas = this._vision.captureStage(this.runtime.renderer, this._scope, this._stageCanvas);
            if (!canvas) return null;
            this._stageCanvas = canvas;
            return {el: canvas, space: 'stage'};
        }
        const video = this._video.provider && this._video.provider.video;
        if (!video || video.readyState < 2) return null;
        return {el: video, space: 'video'};
    }

    /**
     * 辨識一次並更新 detections。
     * @returns {Promise<void>}
     */
    async _detect () {
        if (!this.model) return;
        const src = this._source();
        let items = [];
        if (src) {
            try {
                const found = await this._predict(this.model, src.el);
                items = (found || []).map(item => Object.assign({}, item, {space: src.space}));
                this._rate.tick();
            } catch (e) {
                if (!this._detectErrorShown) {
                    this._detectErrorShown = true;
                    console.error(`[${this._label}] 辨識失敗`, e);
                }
            }
        }
        // 沒有偵測到、影像還沒好、或辨識途中被關掉：一律清空，積木不會回報舊的座標
        this._setDetections(this._sourceAvailable() ? items : []);
    }

    _setDetections (items) {
        this.detections = items;
        if (this.showBox) this._drawBoxes();
    }

    _ensureLoop () {
        if (this._looping || !this.model || this.mode !== 'continuous' || !this._sourceAvailable()) return;
        this._looping = true;
        const tick = async () => {
            if (!this.model || this.mode !== 'continuous' || !this._sourceAvailable()) {
                this._looping = false;
                if (!this._sourceAvailable()) this._setDetections([]);
                return;
            }
            await this._detect();
            this._schedule(tick, this.intervalMs);
        };
        tick();
    }

    _drawBoxes () {
        const name = this.constructor.ITEM_NAME;
        const boxes = this.detections.map((item, i) => {
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
            for (const p of this._boxPoints(item)) {
                const [x, y] = this._toStage(p, item.space);
                if (x < x1) x1 = x;
                if (x > x2) x2 = x;
                if (y < y1) y1 = y;
                if (y > y2) y2 = y;
            }
            return {x1, y1, x2, y2, label: `第 ${i + 1} ${name}`};
        }).filter(b => Number.isFinite(b.x1));
        this._overlay.draw(boxes);
    }

    /** 偵測框要包住哪些點；子類別可以排除不可靠的點（例如姿態網路的低信心點）。 */
    _boxPoints (item) {
        return item.keypoints || [];
    }

    // ------------------------------------------------------------ 座標

    /**
     * 影像（或舞台截圖）的像素座標 → Scratch 舞台座標。
     * @param {Array<number>} point - [x, y, z]
     * @param {string} space - 'video' 或 'stage'
     * @returns {Array<number>} [x, y]
     */
    _toStage (point, space) {
        if (space === 'stage') return [point[0] - 240, 180 - point[1]];
        const x = 240 - (point[0] * this.ratio);
        return [this._video.mirror === false ? -1 * x : x, 180 - (point[1] * this.ratio)];
    }

    /** 第 N 個（從 1 開始）偵測到的東西；沒有就回傳 null。 */
    _item (number) {
        return this.detections[parseInt(number, 10) - 1] || null;
    }

    /** 依編號取點（從 1 開始），回傳舞台座標或 null。 */
    _numberedPoint (item, number) {
        const point = item && item.keypoints && item.keypoints[parseInt(number, 10) - 1];
        return point ? this._toStage(point, item.space) : null;
    }

    /** 多個點（從 0 開始的編號）的平均，回傳舞台座標或 null。 */
    _averagePoint (item, indices) {
        if (!item || !item.keypoints || !indices) return null;
        let sx = 0, sy = 0;
        for (const i of indices) {
            const p = item.keypoints[i];
            if (!p) return null;
            const [x, y] = this._toStage(p, item.space);
            sx += x;
            sy += y;
        }
        return [sx / indices.length, sy / indices.length];
    }

    // ------------------------------------------------------------ 共通積木

    _videoBlocks () {
        return [
            {
                opcode: 'videoToggle',
                blockType: BlockType.COMMAND,
                text: this._t('videoToggle'),
                arguments: {VIDEO_STATE: {type: ArgumentType.STRING, menu: 'videoMenu', defaultValue: 'off'}}
            },
            {
                opcode: 'selectCamera',
                blockType: BlockType.COMMAND,
                text: this._t('selectCamera'),
                arguments: {CAMERA: {type: ArgumentType.STRING, menu: 'cameraMenu', defaultValue: '1'}}
            },
            {
                opcode: 'setVideoTransparency',
                blockType: BlockType.COMMAND,
                text: this._t('setVideoTransparency'),
                arguments: {TRANSPARENCY: {type: ArgumentType.NUMBER, defaultValue: 50}}
            }
        ];
    }

    _detectBlocks () {
        return [
            {
                opcode: 'setInput',
                blockType: BlockType.COMMAND,
                text: this._t('setInput'),
                arguments: {INPUT: {type: ArgumentType.STRING, menu: 'inputMenu', defaultValue: 'camera'}}
            },
            {
                opcode: 'setDetectMode',
                blockType: BlockType.COMMAND,
                text: this._t('setDetectMode'),
                arguments: {MODE: {type: ArgumentType.STRING, menu: 'modeMenu', defaultValue: 'continuous'}}
            },
            {opcode: 'detectOnce', blockType: BlockType.COMMAND, text: this._t('detectOnce')},
            {
                opcode: 'setDetectInterval',
                blockType: BlockType.COMMAND,
                text: this._t('setDetectInterval'),
                arguments: {MS: {type: ArgumentType.NUMBER, defaultValue: 100}}
            },
            {opcode: 'getDetectRate', blockType: BlockType.REPORTER, text: this._t('getDetectRate')},
            {
                opcode: 'setShowBox',
                blockType: BlockType.COMMAND,
                text: this._t('setShowBox'),
                arguments: {STATE: {type: ArgumentType.STRING, menu: 'onOffMenu', defaultValue: 'on'}}
            },
            {
                opcode: 'setRatio',
                blockType: BlockType.COMMAND,
                text: this._t('setRatio'),
                arguments: {RATIO: {type: ArgumentType.STRING, menu: 'ratioMenu', defaultValue: '0.75'}}
            }
        ];
    }

    _notFoundBlock () {
        return {
            opcode: 'setNotFound',
            blockType: BlockType.COMMAND,
            text: this._t('setNotFound'),
            arguments: {VALUE: {type: ArgumentType.STRING, menu: 'notFoundMenu', defaultValue: 'blank'}}
        };
    }

    _commonMenus () {
        return {
            videoMenu: {
                acceptReporters: true,
                items: [
                    {text: this._t('off'), value: 'off'},
                    {text: this._t('on'), value: 'on'},
                    {text: this._t('video_on_flipped'), value: 'on-flipped'}
                ]
            },
            cameraMenu: {acceptReporters: true, items: 'getCameraMenu'},
            inputMenu: {
                acceptReporters: false,
                items: [{text: this._t('camera'), value: 'camera'}, {text: this._t('stage'), value: 'stage'}]
            },
            modeMenu: {
                acceptReporters: false,
                items: [{text: this._t('continuous'), value: 'continuous'}, {text: this._t('manual'), value: 'manual'}]
            },
            onOffMenu: {
                acceptReporters: false,
                items: [{text: this._t('on'), value: 'on'}, {text: this._t('off'), value: 'off'}]
            },
            notFoundMenu: {
                acceptReporters: false,
                items: [{text: this._t('blank'), value: 'blank'}, {text: '0', value: 'zero'}, {text: '-1', value: 'minus1'}]
            },
            ratioMenu: {acceptReporters: true, items: ['0.5', '0.75', '1', '1.5', '2.0'].map(v => ({text: v, value: v}))}
        };
    }

    /** 攝影機選單：依序編號；使用者允許攝影機之後才看得到名稱。 */
    getCameraMenu () {
        if (!this._cameras.length) return [{text: '1', value: '1'}];
        return this._cameras.map((c, i) => ({
            text: `${i + 1}：${c.label || `${this._t('camera')} ${i + 1}`}`,
            value: String(i + 1)
        }));
    }

    getDetectRate () {
        return this._rate.rate;
    }

    setNotFound (args) {
        if (Object.prototype.hasOwnProperty.call(NOT_FOUND_VALUES, args.VALUE)) this.notFound = NOT_FOUND_VALUES[args.VALUE];
    }

    videoToggle (args) {
        const state = args.VIDEO_STATE;
        if (state === 'off') {
            this._videoOn = false;
            this._video.disableVideo();
            if (this.input !== 'stage') this._setDetections([]);
            return;
        }
        return this._turnVideoOn(state === 'on');
    }

    async selectCamera (args) {
        const index = parseInt(Cast.toString(args.CAMERA), 10);
        if (!this._videoOn) {
            this._ui.show('請先用「影像 開啟」打開攝影機，再選擇攝影機', {kind: 'error'});
            return;
        }
        await this._applyCamera(index, {quiet: false});
    }

    async _applyCamera (index, {quiet}) {
        const cameras = await this._refreshCameras();
        if (!(index >= 1 && index <= cameras.length)) {
            this._ui.show(`找不到第 ${index} 支攝影機（這台電腦有 ${cameras.length} 支）`, {kind: 'error'});
            return;
        }
        try {
            await this._vision.useCamera(this._video, cameras[index - 1].deviceId, this._scope);
            this._cameraIndex = index;
            if (!quiet) {
                this._ui.show(`已切換到攝影機 ${index}${cameras[index - 1].label ? `：${cameras[index - 1].label}` : ''}`, {kind: 'ok', autoHideMs: 2500});
            }
        } catch (e) {
            this._ui.show(`沒辦法切換到攝影機 ${index}（${(e && e.message) || '未知的原因'}）`, {kind: 'error'});
        }
    }

    /**
     * 影像預覽的透明度（沿用官方影像偵測的做法）。
     * @param {object} args - 積木參數，TRANSPARENCY 為 0–100
     */
    setVideoTransparency (args) {
        const transparency = Cast.toNumber(args.TRANSPARENCY);
        this.globalVideoTransparency = transparency;
        this._video.setPreviewGhost(transparency);
    }

    async setInput (args) {
        const input = args.INPUT === 'stage' ? 'stage' : 'camera';
        if (input === this.input) return;
        this.input = input;
        this._setDetections([]);
        if (!this._sourceAvailable()) return;
        await this._prepare();
        this._ensureLoop();
    }

    async setDetectMode (args) {
        this.mode = args.MODE === 'manual' ? 'manual' : 'continuous';
        this._rate.reset();
        if (this.mode === 'continuous' && this._sourceAvailable()) {
            await this._prepare();
            this._ensureLoop();
        }
    }

    async detectOnce () {
        if (!this._sourceAvailable()) return;
        await this._prepare();
        await this._detect();
    }

    setDetectInterval (args) {
        const ms = Cast.toNumber(args.MS);
        this.intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(0, ms));
    }

    setShowBox (args) {
        this.showBox = args.STATE !== 'off';
        if (this.showBox) this._drawBoxes();
        else this._overlay.clear();
    }

    setRatio (args) {
        const ratio = parseFloat(args.RATIO);
        if (ratio > 0) this.ratio = ratio;
    }

    setLocale () {
        const locale = formatMessage.setup().locale;
        return AvailableLocales.includes(locale) ? locale : 'en';
    }
}

module.exports = CampVisionExtension;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
