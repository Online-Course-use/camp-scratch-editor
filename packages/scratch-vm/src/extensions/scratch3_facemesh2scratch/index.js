/* eslint-disable */
/**
 * 臉部網格擴展。
 *
 * 改寫自 champierre/facemesh2scratch（AGPL-3.0，https://github.com/champierre/facemesh2scratch）。
 * 營隊於 2026-11 修改：
 *   - ml5 改為加入擴展時才從本網域載入（不打包進主程式），模型改由本網域提供（見 loader.js）
 *   - 移除會卡住畫面的 alert()，改用右下角的訊息面板；載入失敗、攝影機無法使用時有明確提示
 *   - 畫面裡沒有臉、或關閉影像時清空資料；積木讀不到資料時回傳「找不到時的值」而不是丟出錯誤
 *   - 模型只載入一次，開關影像不會重新下載
 *   - 依 SPEC 7.7.0、7.7.1 新增積木：具名特徵點、距離與角度、找不到時回傳值、選擇攝影機、
 *     辨識輸入、辨識方式／間隔／每秒次數、顯示偵測框（共用工具在 ../camp_shared/vision.js）
 *   - 繁體中文文案
 * 原有積木（getX、getY、getPeopleCount、videoToggle、setVideoTransparency、setRatio）的 opcode 與參數不變，
 * 舊作品可以照常開啟。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const formatMessage = require('format-message');
const loader = require('./loader');
const vision = require('../camp_shared/vision');
const campUi = require('../scratch3_camparduino/ui');

const blockIconURI = 'data:image/png;base64,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';

/**
 * 具名特徵點：[積木裡存的值, 下拉選單文字, 臉部網格的點編號（從 0 開始；多個點取平均）]。
 * 「左／右」是**學員自己的**左右（MediaPipe 的定義），不是畫面上的左右。
 * 存進作品的是英文值，日後改中文名稱不影響舊作品。
 */
const FACE_PARTS = [
    ['noseTip', '鼻尖', [1]],
    ['betweenEyes', '兩眼中間', [168]],
    ['leftEye', '左眼', [263, 362]],
    ['rightEye', '右眼', [33, 133]],
    ['leftEyebrow', '左眉', [334]],
    ['rightEyebrow', '右眉', [105]],
    ['mouthCenter', '嘴巴中心', [13, 14]],
    ['upperLip', '上嘴唇', [13]],
    ['lowerLip', '下嘴唇', [14]],
    ['leftMouthCorner', '左嘴角', [291]],
    ['rightMouthCorner', '右嘴角', [61]],
    ['leftCheek', '左臉頰', [425]],
    ['rightCheek', '右臉頰', [205]],
    ['chin', '下巴', [152]],
    ['forehead', '額頭', [10]],
    ['leftFaceEdge', '臉的左邊', [454]],
    ['rightFaceEdge', '臉的右邊', [234]]
];
const PART_INDEX = Object.fromEntries(FACE_PARTS.map(([value, , idx]) => [value, idx]));

const NOT_FOUND_VALUES = {blank: '', zero: 0, minus1: -1};

const Message = {
    name: {'zh-tw': '臉部網格', 'en': 'Facemesh2Scratch'},
    peopleCount: {'zh-tw': '偵測到幾張臉', 'ja': '人数', 'ja-Hira': 'にんずう', 'en': 'people count'},
    getPartX: {'zh-tw': '第 [PERSON_NUMBER] 張臉的 [PART] 的 x 座標', 'en': 'x of [PART] of face no: [PERSON_NUMBER]'},
    getPartY: {'zh-tw': '第 [PERSON_NUMBER] 張臉的 [PART] 的 y 座標', 'en': 'y of [PART] of face no: [PERSON_NUMBER]'},
    getX: {
        'zh-tw': '第 [PERSON_NUMBER] 張臉的特徵點編號 [KEYPOINT] 的 x 座標',
        'ja': '[PERSON_NUMBER] 人目の [KEYPOINT] 番目の部位のx座標',
        'ja-Hira': '[PERSON_NUMBER] にんめの [KEYPOINT] ばんめのぶいのxざひょう',
        'en': 'x of person no: [PERSON_NUMBER] , keypoint no: [KEYPOINT]'
    },
    getY: {
        'zh-tw': '第 [PERSON_NUMBER] 張臉的特徵點編號 [KEYPOINT] 的 y 座標',
        'ja': '[PERSON_NUMBER] 人目の [KEYPOINT] 番目の部位のy座標',
        'ja-Hira': '[PERSON_NUMBER] にんめの [KEYPOINT] ばんめのぶいのyざひょう',
        'en': 'y of person no: [PERSON_NUMBER] , keypoint no: [KEYPOINT]'
    },
    getDistance: {'zh-tw': '第 [PERSON_NUMBER] 張臉的 [PART_A] 到 [PART_B] 的距離', 'en': 'distance from [PART_A] to [PART_B] of face no: [PERSON_NUMBER]'},
    getAngle: {'zh-tw': '第 [PERSON_NUMBER] 張臉的 [PART_A] 到 [PART_B] 的角度', 'en': 'direction from [PART_A] to [PART_B] of face no: [PERSON_NUMBER]'},
    setNotFound: {'zh-tw': '找不到時回傳 [VALUE]', 'en': 'when not found, report [VALUE]'},
    videoToggle: {'zh-tw': '影像 [VIDEO_STATE]', 'ja': 'ビデオを [VIDEO_STATE] にする', 'ja-Hira': 'ビデオを [VIDEO_STATE] にする', 'en': 'turn video [VIDEO_STATE]'},
    selectCamera: {'zh-tw': '選擇攝影機 [CAMERA]', 'en': 'use camera [CAMERA]'},
    setVideoTransparency: {'zh-tw': '影像透明度設為 [TRANSPARENCY]', 'en': 'set video transparency to [TRANSPARENCY]'},
    setInput: {'zh-tw': '辨識輸入 [INPUT]', 'en': 'detect from [INPUT]'},
    setDetectMode: {'zh-tw': '辨識方式 [MODE]', 'en': 'detection mode [MODE]'},
    detectOnce: {'zh-tw': '辨識一次', 'en': 'detect once'},
    setDetectInterval: {'zh-tw': '辨識間隔設為 [MS] 毫秒', 'en': 'set detection interval to [MS] ms'},
    getDetectRate: {'zh-tw': '每秒辨識次數', 'en': 'detections per second'},
    setShowBox: {'zh-tw': '顯示偵測框 [STATE]', 'en': 'show detection box [STATE]'},
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

/** 預設的辨識間隔（毫秒）。辨識本身通常比這個久，這只是讓瀏覽器有空處理其他事情。 */
const DEFAULT_INTERVAL_MS = 33;
const MAX_INTERVAL_MS = 10000;

const range = (from, to) => {
    const items = [];
    for (let i = from; i <= to; i++) items.push({text: String(i), value: String(i)});
    return items;
};

class Scratch3Facemesh2ScratchBlocks {
    /**
     * @param {object} runtime - Scratch 的執行環境
     * @param {object} [deps] - 測試用：替換載入函式庫、訊息面板、排程、瀏覽器物件與共用視覺工具
     */
    constructor (runtime, deps = {}) {
        this.runtime = runtime;
        this._loadMl5 = deps.loadMl5 || loader.loadMl5;
        this._ui = deps.ui || campUi;
        this._schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
        this._scope = deps.scope || globalThis;
        this._vision = Object.assign({}, vision, deps.vision || {});
        this._overlay = deps.overlay || new vision.BoxOverlay(runtime.renderer, this._scope);
        this._rate = new vision.RateMeter(deps.now);

        /** 目前畫面裡的臉：[{keypoints, space}]，space 是 'video' 或 'stage'；沒有臉時是空陣列。 */
        this.faces = [];
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

    get _video () {
        return this.runtime.ioDevices.video;
    }

    _t (key) {
        const m = Message[key];
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
        this._ui.show('正在準備臉部辨識，第一次需要一點時間…');
        this._preparing = (async () => {
            try {
                const ml5 = await this._loadMl5(this._scope);
                const facemesh = await loader.withLocalModels(this._scope, () => ml5.facemesh({}));
                if (!facemesh || !facemesh.model) throw new Error('模型沒有載入');
                this.model = facemesh.model;
                this.status = 'ready';
                this._ui.show('臉部辨識準備好了', {kind: 'ok', autoHideMs: 2500});
            } catch (e) {
                this.status = 'error';
                console.error('[臉部網格] 準備失敗', e);
                this._ui.show(
                    `臉部辨識無法啟動（${(e && e.message) || '未知的原因'}）。\n請檢查網路後重新整理頁面；如果還是不行，請告訴老師`,
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
     * 辨識一次並更新 faces。
     * @returns {Promise<void>}
     */
    async _detect () {
        if (!this.model) return;
        const src = this._source();
        let faces = [];
        if (src) {
            try {
                const predictions = await this.model.estimateFaces(src.el);
                faces = (predictions || []).map(p => ({keypoints: p.scaledMesh, space: src.space}));
                this._rate.tick();
            } catch (e) {
                if (!this._detectErrorShown) {
                    this._detectErrorShown = true;
                    console.error('[臉部網格] 辨識失敗', e);
                }
            }
        }
        // 沒有臉、影像還沒好、或辨識途中被關掉：一律清空，積木不會回報舊的座標
        this._setFaces(this._sourceAvailable() ? faces : []);
    }

    _setFaces (faces) {
        this.faces = faces;
        if (this.showBox) this._drawBoxes();
    }

    _ensureLoop () {
        if (this._looping || !this.model || this.mode !== 'continuous' || !this._sourceAvailable()) return;
        this._looping = true;
        const tick = async () => {
            if (!this.model || this.mode !== 'continuous' || !this._sourceAvailable()) {
                this._looping = false;
                if (!this._sourceAvailable()) this._setFaces([]);
                return;
            }
            await this._detect();
            this._schedule(tick, this.intervalMs);
        };
        tick();
    }

    _drawBoxes () {
        const boxes = this.faces.map((face, i) => {
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
            for (const p of face.keypoints || []) {
                const [x, y] = this._toStage(p, face.space);
                if (x < x1) x1 = x;
                if (x > x2) x2 = x;
                if (y < y1) y1 = y;
                if (y > y2) y2 = y;
            }
            return {x1, y1, x2, y2, label: `第 ${i + 1} 張臉`};
        }).filter(b => Number.isFinite(b.x1));
        this._overlay.draw(boxes);
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

    _face (args) {
        return this.faces[parseInt(args.PERSON_NUMBER, 10) - 1] || null;
    }

    /** 依編號取點（積木從 1 開始），回傳舞台座標或 null。 */
    _numberedPoint (args) {
        const face = this._face(args);
        const point = face && face.keypoints && face.keypoints[parseInt(args.KEYPOINT, 10) - 1];
        return point ? this._toStage(point, face.space) : null;
    }

    /** 具名特徵點（多個點取平均），回傳舞台座標或 null。 */
    _partPoint (face, part) {
        const idx = PART_INDEX[part];
        if (!face || !face.keypoints || !idx) return null;
        let sx = 0, sy = 0;
        for (const i of idx) {
            const p = face.keypoints[i];
            if (!p) return null;
            const [x, y] = this._toStage(p, face.space);
            sx += x;
            sy += y;
        }
        return [sx / idx.length, sy / idx.length];
    }

    // ------------------------------------------------------------ 積木清單

    get PERSON_NUMBER_MENU () {
        return range(1, 10);
    }

    get KEYPOINT_MENU () {
        return range(1, 468);
    }

    get PART_MENU () {
        return FACE_PARTS.map(([value, text]) => ({text, value}));
    }

    get VIDEO_MENU () {
        return [
            {text: this._t('off'), value: 'off'},
            {text: this._t('on'), value: 'on'},
            {text: this._t('video_on_flipped'), value: 'on-flipped'}
        ];
    }

    get RATIO_MENU () {
        return ['0.5', '0.75', '1', '1.5', '2.0'].map(v => ({text: v, value: v}));
    }

    /** 攝影機選單：依序編號；允許使用者允許攝影機之後才看得到名稱。 */
    getCameraMenu () {
        if (!this._cameras.length) return [{text: '1', value: '1'}];
        return this._cameras.map((c, i) => ({
            text: `${i + 1}：${c.label || `${this._t('camera')} ${i + 1}`}`,
            value: String(i + 1)
        }));
    }

    getInfo () {
        this._locale = this.setLocale();
        const person = {type: ArgumentType.STRING, menu: 'personNumberMenu', defaultValue: '1'};
        const part = defaultValue => ({type: ArgumentType.STRING, menu: 'partMenu', defaultValue});

        return {
            id: 'facemesh2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'getPeopleCount', blockType: BlockType.REPORTER, text: this._t('peopleCount')},
                {
                    opcode: 'getPartX',
                    blockType: BlockType.REPORTER,
                    text: this._t('getPartX'),
                    arguments: {PERSON_NUMBER: person, PART: part('noseTip')}
                },
                {
                    opcode: 'getPartY',
                    blockType: BlockType.REPORTER,
                    text: this._t('getPartY'),
                    arguments: {PERSON_NUMBER: person, PART: part('noseTip')}
                },
                {
                    opcode: 'getX',
                    blockType: BlockType.REPORTER,
                    text: this._t('getX'),
                    arguments: {
                        PERSON_NUMBER: person,
                        KEYPOINT: {type: ArgumentType.STRING, menu: 'keypointMenu', defaultValue: '1'}
                    }
                },
                {
                    opcode: 'getY',
                    blockType: BlockType.REPORTER,
                    text: this._t('getY'),
                    arguments: {
                        PERSON_NUMBER: person,
                        KEYPOINT: {type: ArgumentType.STRING, menu: 'keypointMenu', defaultValue: '1'}
                    }
                },
                {
                    opcode: 'getDistance',
                    blockType: BlockType.REPORTER,
                    text: this._t('getDistance'),
                    arguments: {PERSON_NUMBER: person, PART_A: part('upperLip'), PART_B: part('lowerLip')}
                },
                {
                    opcode: 'getAngle',
                    blockType: BlockType.REPORTER,
                    text: this._t('getAngle'),
                    arguments: {PERSON_NUMBER: person, PART_A: part('rightEye'), PART_B: part('leftEye')}
                },
                {
                    opcode: 'setNotFound',
                    blockType: BlockType.COMMAND,
                    text: this._t('setNotFound'),
                    arguments: {VALUE: {type: ArgumentType.STRING, menu: 'notFoundMenu', defaultValue: 'blank'}}
                },
                '---',
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
                },
                '---',
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
            ],
            menus: {
                personNumberMenu: {acceptReporters: true, items: this.PERSON_NUMBER_MENU},
                keypointMenu: {acceptReporters: true, items: this.KEYPOINT_MENU},
                partMenu: {acceptReporters: false, items: this.PART_MENU},
                notFoundMenu: {
                    acceptReporters: false,
                    items: [{text: this._t('blank'), value: 'blank'}, {text: '0', value: 'zero'}, {text: '-1', value: 'minus1'}]
                },
                videoMenu: {acceptReporters: true, items: this.VIDEO_MENU},
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
                ratioMenu: {acceptReporters: true, items: this.RATIO_MENU}
            }
        };
    }

    // ------------------------------------------------------------ 回報值積木

    getPeopleCount () {
        return this.faces.length;
    }

    getPartX (args) {
        const p = this._partPoint(this._face(args), args.PART);
        return p ? p[0] : this.notFound;
    }

    getPartY (args) {
        const p = this._partPoint(this._face(args), args.PART);
        return p ? p[1] : this.notFound;
    }

    getX (args) {
        const p = this._numberedPoint(args);
        return p ? p[0] : this.notFound;
    }

    getY (args) {
        const p = this._numberedPoint(args);
        return p ? p[1] : this.notFound;
    }

    getDistance (args) {
        const face = this._face(args);
        const a = this._partPoint(face, args.PART_A);
        const b = this._partPoint(face, args.PART_B);
        return a && b ? this._vision.distance(a, b) : this.notFound;
    }

    getAngle (args) {
        const face = this._face(args);
        const a = this._partPoint(face, args.PART_A);
        const b = this._partPoint(face, args.PART_B);
        return a && b ? this._vision.direction(a, b) : this.notFound;
    }

    getDetectRate () {
        return this._rate.rate;
    }

    // ------------------------------------------------------------ 指令積木

    setNotFound (args) {
        if (Object.prototype.hasOwnProperty.call(NOT_FOUND_VALUES, args.VALUE)) this.notFound = NOT_FOUND_VALUES[args.VALUE];
    }

    videoToggle (args) {
        const state = args.VIDEO_STATE;
        if (state === 'off') {
            this._videoOn = false;
            this._video.disableVideo();
            if (this.input !== 'stage') this._setFaces([]);
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
     * A scratch command block handle that configures the video preview's
     * transparency from passed arguments.
     * @param {object} args - the block arguments
     * @param {number} args.TRANSPARENCY - the transparency to set the video
     *   preview to
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
        this._setFaces([]);
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

module.exports = Scratch3Facemesh2ScratchBlocks;
module.exports.FACE_PARTS = FACE_PARTS;
