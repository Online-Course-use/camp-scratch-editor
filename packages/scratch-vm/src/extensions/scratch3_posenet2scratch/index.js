/* eslint-disable */
/**
 * 姿態網路擴展。
 *
 * 改寫自 champierre/posenet2scratch（AGPL-3.0，https://github.com/champierre/posenet2scratch，
 * commit 94f396d7，2025-05-03）。營隊於 2026-11 修改：
 *   - 改用營隊的視覺擴展基底（../camp_shared/vision-extension.js）：ml5 延遲載入、模型由本網域提供、
 *     不用 alert()、載入失敗與攝影機無法使用時有明確提示、模型只載入一次、沒有人時清空資料
 *   - 依 SPEC 7.7.3（★＋☆）：偵測到幾個人、第 N 個人的具名部位 x／y、兩個部位的距離與角度、
 *     最低信心值、找不到時回傳值；加上 7.7.0 的共通積木
 *   - 原版的 34 個「某部位 x／y」專用積木改由具名下拉選單的 2 個積木取代；專用積木保留但不顯示，
 *     用原版做的作品仍可開啟
 *   - 不再改動攝影機影像元素的大小（原版把共用的影像元素設成 480×360，會影響其他擴展），
 *     改為把影像畫到自己的 480×360 畫布再辨識
 *   - 繁體中文文案
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const CampVisionExtension = require('../camp_shared/vision-extension');

const blockIconURI = 'data:image/png;base64,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';

/**
 * PoseNet 的 17 個部位，順序就是模型輸出的順序（選單的值 '0'–'16' 與原版相同）。
 * [原版專用積木用的名稱, 下拉選單文字]。「左／右」是**被拍的人自己的**左右。
 */
const BODY_PARTS = [
    ['Nose', '鼻子'],
    ['LeftEye', '左眼'],
    ['RightEye', '右眼'],
    ['LeftEar', '左耳'],
    ['RightEar', '右耳'],
    ['LeftShoulder', '左肩'],
    ['RightShoulder', '右肩'],
    ['LeftElbow', '左手肘'],
    ['RightElbow', '右手肘'],
    ['LeftWrist', '左手腕'],
    ['RightWrist', '右手腕'],
    ['LeftHip', '左臀'],
    ['RightHip', '右臀'],
    ['LeftKnee', '左膝'],
    ['RightKnee', '右膝'],
    ['LeftAnkle', '左腳踝'],
    ['RightAnkle', '右腳踝']
];

/** 預設的最低信心值：低於這個值的部位當作找不到（PoseNet 對畫面外的部位會亂猜位置）。 */
const DEFAULT_MIN_CONFIDENCE = 0.2;

/** 影像先畫成這個大小再辨識，座標就直接對應舞台（倍率 1）。 */
const FRAME_W = 480;
const FRAME_H = 360;

const Message = {
    name: {'zh-tw': '姿態網路', 'en': 'Posenet2Scratch'},
    peopleCount: {'zh-tw': '偵測到幾個人', 'ja': '人数', 'en': 'people count'},
    getX: {'zh-tw': '第 [PERSON_NUMBER] 個人的 [PART] 的 x 座標', 'ja': '[PERSON_NUMBER] 人目の [PART] のx座標', 'en': '[PART] x of person no. [PERSON_NUMBER]'},
    getY: {'zh-tw': '第 [PERSON_NUMBER] 個人的 [PART] 的 y 座標', 'ja': '[PERSON_NUMBER] 人目の [PART] のy座標', 'en': '[PART] y of person no. [PERSON_NUMBER]'},
    getDistance: {'zh-tw': '第 [PERSON_NUMBER] 個人的 [PART_A] 到 [PART_B] 的距離', 'en': 'distance from [PART_A] to [PART_B] of person no. [PERSON_NUMBER]'},
    getAngle: {'zh-tw': '第 [PERSON_NUMBER] 個人的 [PART_A] 到 [PART_B] 的角度', 'en': 'direction from [PART_A] to [PART_B] of person no. [PERSON_NUMBER]'},
    setMinConfidence: {'zh-tw': '最低信心值設為 [CONFIDENCE]', 'en': 'set minimum confidence to [CONFIDENCE]'},
    getMinConfidence: {'zh-tw': '最低信心值', 'en': 'minimum confidence'},
    legacyX: {'zh-tw': '[PART] 的 x 座標', 'en': '[PART] x'},
    legacyY: {'zh-tw': '[PART] 的 y 座標', 'en': '[PART] y'}
};

const range = (from, to) => {
    const items = [];
    for (let i = from; i <= to; i++) items.push({text: String(i), value: String(i)});
    return items;
};

class Scratch3Posenet2ScratchBlocks extends CampVisionExtension {
    static get LABEL () {
        return '姿態辨識';
    }

    static get ITEM_NAME () {
        return '個人';
    }

    constructor (runtime, deps = {}) {
        super(runtime, deps, Message);
        this.ratio = 1;
        this.minConfidence = DEFAULT_MIN_CONFIDENCE;
        this._frame = null;
    }

    async _createModel (ml5) {
        const posenet = ml5.poseNet({maxPoseDetections: 10});
        await posenet.ready;
        return posenet.net;
    }

    /**
     * 攝影機影像先畫到自己的 480×360 畫布（PoseNet 依影像元素的 width／height 換算座標，
     * 而共用的影像元素沒有設定這兩個值；直接改它會影響臉部、手部擴展）。
     */
    _frameFor (input) {
        if (!input || !input.videoWidth || !this._scope.document) return input;
        if (!this._frame) {
            this._frame = this._scope.document.createElement('canvas');
            this._frame.width = FRAME_W;
            this._frame.height = FRAME_H;
        }
        const ctx = this._frame.getContext('2d');
        ctx.drawImage(input, 0, 0, FRAME_W, FRAME_H);
        return this._frame;
    }

    async _predict (model, input) {
        const poses = await model.estimateMultiplePoses(this._frameFor(input), {
            flipHorizontal: false,
            maxDetections: 10,
            scoreThreshold: 0.5,
            nmsRadius: 20
        });
        return (poses || []).map(pose => ({
            score: pose.score,
            keypoints: pose.keypoints.map(k => [k.position.x, k.position.y, k.score])
        }));
    }

    _boxPoints (item) {
        return (item.keypoints || []).filter(p => p[2] >= this.minConfidence);
    }

    /** 第 person 個人的第 part（0–16）個部位，信心值夠才回傳舞台座標，否則 null。 */
    _partPoint (person, part) {
        const item = this._item(person);
        const index = parseInt(part, 10);
        const p = item && item.keypoints && item.keypoints[index];
        if (!p || !(index >= 0 && index < BODY_PARTS.length) || !(p[2] >= this.minConfidence)) return null;
        return this._toStage(p, item.space);
    }

    getInfo () {
        this._locale = this.setLocale();
        const person = {type: ArgumentType.STRING, menu: 'personNumbers', defaultValue: '1'};
        const part = defaultValue => ({type: ArgumentType.STRING, menu: 'parts', defaultValue});
        const legacy = [];
        BODY_PARTS.forEach(([key, text]) => {
            for (const axis of ['X', 'Y']) {
                legacy.push({
                    opcode: `get${key}${axis}`,
                    blockType: BlockType.REPORTER,
                    text: this._t(`legacy${axis}`).replace('[PART]', text),
                    hideFromPalette: true
                });
            }
        });

        return {
            id: 'posenet2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'getPeopleCount', blockType: BlockType.REPORTER, text: this._t('peopleCount')},
                {opcode: 'getX', blockType: BlockType.REPORTER, text: this._t('getX'), arguments: {PERSON_NUMBER: person, PART: part('0')}},
                {opcode: 'getY', blockType: BlockType.REPORTER, text: this._t('getY'), arguments: {PERSON_NUMBER: person, PART: part('0')}},
                {
                    opcode: 'getDistance',
                    blockType: BlockType.REPORTER,
                    text: this._t('getDistance'),
                    arguments: {PERSON_NUMBER: person, PART_A: part('9'), PART_B: part('10')}
                },
                {
                    opcode: 'getAngle',
                    blockType: BlockType.REPORTER,
                    text: this._t('getAngle'),
                    arguments: {PERSON_NUMBER: person, PART_A: part('6'), PART_B: part('5')}
                },
                {
                    opcode: 'setMinConfidence',
                    blockType: BlockType.COMMAND,
                    text: this._t('setMinConfidence'),
                    arguments: {CONFIDENCE: {type: ArgumentType.NUMBER, defaultValue: DEFAULT_MIN_CONFIDENCE}}
                },
                {opcode: 'getMinConfidence', blockType: BlockType.REPORTER, text: this._t('getMinConfidence')},
                this._notFoundBlock(),
                '---',
                ...this._videoBlocks(),
                '---',
                // 座標已經是舞台大小，不需要「倍率」積木（原版也沒有）
                ...this._detectBlocks().filter(b => b.opcode !== 'setRatio'),
                ...legacy
            ],
            menus: Object.assign(this._commonMenus(), {
                // 選單名稱沿用原版，原版作品才能開啟
                personNumbers: {acceptReporters: true, items: range(1, 10)},
                parts: {acceptReporters: true, items: BODY_PARTS.map(([, text], i) => ({text, value: String(i)}))}
            })
        };
    }

    getPeopleCount () {
        return this.detections.length;
    }

    getX (args) {
        const p = this._partPoint(args.PERSON_NUMBER, args.PART);
        return p ? p[0] : this.notFound;
    }

    getY (args) {
        const p = this._partPoint(args.PERSON_NUMBER, args.PART);
        return p ? p[1] : this.notFound;
    }

    getDistance (args) {
        const a = this._partPoint(args.PERSON_NUMBER, args.PART_A);
        const b = this._partPoint(args.PERSON_NUMBER, args.PART_B);
        return a && b ? this._vision.distance(a, b) : this.notFound;
    }

    getAngle (args) {
        const a = this._partPoint(args.PERSON_NUMBER, args.PART_A);
        const b = this._partPoint(args.PERSON_NUMBER, args.PART_B);
        return a && b ? this._vision.direction(a, b) : this.notFound;
    }

    setMinConfidence (args) {
        const value = Cast.toNumber(args.CONFIDENCE);
        this.minConfidence = Math.min(1, Math.max(0, value));
        if (this.showBox) this._drawBoxes();
    }

    getMinConfidence () {
        return this.minConfidence;
    }
}

// 原版的 34 個專用積木（第 1 個人的某部位）
BODY_PARTS.forEach(([key], i) => {
    Scratch3Posenet2ScratchBlocks.prototype[`get${key}X`] = function () {
        return this.getX({PERSON_NUMBER: '1', PART: String(i)});
    };
    Scratch3Posenet2ScratchBlocks.prototype[`get${key}Y`] = function () {
        return this.getY({PERSON_NUMBER: '1', PART: String(i)});
    };
});

module.exports = Scratch3Posenet2ScratchBlocks;
module.exports.BODY_PARTS = BODY_PARTS;
module.exports.DEFAULT_MIN_CONFIDENCE = DEFAULT_MIN_CONFIDENCE;
