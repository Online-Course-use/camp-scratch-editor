/* eslint-disable */
/**
 * 手部姿勢擴展。
 *
 * 改寫自 champierre/handpose2scratch（AGPL-3.0，https://github.com/champierre/handpose2scratch，
 * commit 8d70fa3e，2025-10-01）。營隊於 2026-11 修改：
 *   - 改用營隊的視覺擴展基底（../camp_shared/vision-extension.js）：ml5 延遲載入、模型由本網域提供、
 *     不用 alert()、載入失敗與攝影機無法使用時有明確提示、模型只載入一次
 *   - **手離開畫面時清空資料**（原版會一直回報最後一次的座標）
 *   - 依 SPEC 7.7.2 只做三項：偵測到幾隻手、第 N 隻手的具名特徵點 x／y、依編號取點 x／y；
 *     加上 7.7.0 的共通積木（影像、選擇攝影機、辨識輸入／方式／間隔、偵測框）
 *   - 繁體中文文案
 * 模型（ml5 0.12.2 的 handpose）一次只追蹤一隻手，所以「偵測到幾隻手」只會是 0 或 1。
 * 原有積木 getX、getY、getZ（參數 LANDMARK）、videoToggle、setVideoTransparency、setRatio 的 opcode 不變，
 * 用原版做的作品可以開啟（getZ 不在 SPEC 範圍，保留但不顯示在積木區）。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const CampVisionExtension = require('../camp_shared/vision-extension');

const blockIconURI = 'data:image/png;base64,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';

const FINGERS = [
    ['thumb', '拇指', ['根部', '第二關節', '第一關節', '指尖']],
    ['index', '食指', ['指根', '第二關節', '第一關節', '指尖']],
    ['middle', '中指', ['指根', '第二關節', '第一關節', '指尖']],
    ['ring', '無名指', ['指根', '第二關節', '第一關節', '指尖']],
    ['pinky', '小指', ['指根', '第二關節', '第一關節', '指尖']]
];
const JOINT_KEYS = ['Base', 'Joint2', 'Joint1', 'Tip'];

/**
 * 具名特徵點：[積木裡存的值, 下拉選單文字, 模型的點編號（從 0 開始）]。
 * 順序就是模型的 21 個點：0 手腕，1–4 拇指，5–8 食指，9–12 中指，13–16 無名指，17–20 小指。
 */
const HAND_PARTS = [['wrist', '手腕', 0]];
FINGERS.forEach(([key, name, joints], f) => {
    joints.forEach((joint, j) => HAND_PARTS.push([`${key}${JOINT_KEYS[j]}`, `${name}${joint}`, 1 + (f * 4) + j]));
});
const PART_INDEX = Object.fromEntries(HAND_PARTS.map(([value, , i]) => [value, i]));

const Message = {
    name: {'zh-tw': '手部姿勢', 'en': 'Handpose2Scratch'},
    handCount: {'zh-tw': '偵測到幾隻手', 'en': 'hand count'},
    getPartX: {'zh-tw': '第 [HAND_NUMBER] 隻手的 [PART] 的 x 座標', 'en': 'x of [PART] of hand no: [HAND_NUMBER]'},
    getPartY: {'zh-tw': '第 [HAND_NUMBER] 隻手的 [PART] 的 y 座標', 'en': 'y of [PART] of hand no: [HAND_NUMBER]'},
    getX: {'zh-tw': '第 [HAND_NUMBER] 隻手的特徵點編號 [LANDMARK] 的 x 座標', 'ja': '[LANDMARK] のx座標', 'en': 'x of [LANDMARK] of hand no: [HAND_NUMBER]'},
    getY: {'zh-tw': '第 [HAND_NUMBER] 隻手的特徵點編號 [LANDMARK] 的 y 座標', 'ja': '[LANDMARK] のy座標', 'en': 'y of [LANDMARK] of hand no: [HAND_NUMBER]'},
    getZ: {'zh-tw': '特徵點編號 [LANDMARK] 的 z 座標', 'ja': '[LANDMARK] のz座標', 'en': 'z of [LANDMARK]'}
};

const range = (from, to) => {
    const items = [];
    for (let i = from; i <= to; i++) items.push({text: String(i), value: String(i)});
    return items;
};

class Scratch3Handpose2ScratchBlocks extends CampVisionExtension {
    static get LABEL () {
        return '手部辨識';
    }

    static get ITEM_NAME () {
        return '隻手';
    }

    constructor (runtime, deps = {}) {
        super(runtime, deps, Message);
    }

    async _createModel (ml5) {
        const handpose = await ml5.handpose({});
        return handpose && handpose.model;
    }

    async _predict (model, input) {
        const predictions = await model.estimateHands(input);
        return (predictions || []).map(p => ({keypoints: p.landmarks}));
    }

    getInfo () {
        this._locale = this.setLocale();
        const hand = {type: ArgumentType.STRING, menu: 'handNumberMenu', defaultValue: '1'};
        const landmark = {type: ArgumentType.STRING, menu: 'landmark', defaultValue: '1'};
        const part = {type: ArgumentType.STRING, menu: 'partMenu', defaultValue: 'indexTip'};

        return {
            id: 'handpose2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'getHandCount', blockType: BlockType.REPORTER, text: this._t('handCount')},
                {opcode: 'getPartX', blockType: BlockType.REPORTER, text: this._t('getPartX'), arguments: {HAND_NUMBER: hand, PART: part}},
                {opcode: 'getPartY', blockType: BlockType.REPORTER, text: this._t('getPartY'), arguments: {HAND_NUMBER: hand, PART: part}},
                {opcode: 'getX', blockType: BlockType.REPORTER, text: this._t('getX'), arguments: {HAND_NUMBER: hand, LANDMARK: landmark}},
                {opcode: 'getY', blockType: BlockType.REPORTER, text: this._t('getY'), arguments: {HAND_NUMBER: hand, LANDMARK: landmark}},
                {opcode: 'getZ', blockType: BlockType.REPORTER, text: this._t('getZ'), hideFromPalette: true, arguments: {LANDMARK: landmark}},
                '---',
                ...this._videoBlocks(),
                '---',
                ...this._detectBlocks()
            ],
            menus: Object.assign(this._commonMenus(), {
                // 模型一次只追蹤一隻手
                handNumberMenu: {acceptReporters: true, items: range(1, 1)},
                landmark: {acceptReporters: true, items: range(1, 21)},
                partMenu: {acceptReporters: false, items: HAND_PARTS.map(([value, text]) => ({text, value}))}
            })
        };
    }

    /** 原版作品的 getX／getY 沒有 HAND_NUMBER，當作第 1 隻手。 */
    _hand (args) {
        return this._item(args.HAND_NUMBER === undefined ? '1' : args.HAND_NUMBER);
    }

    getHandCount () {
        return this.detections.length;
    }

    getPartX (args) {
        const p = this._averagePoint(this._hand(args), PART_INDEX[args.PART] === undefined ? null : [PART_INDEX[args.PART]]);
        return p ? p[0] : this.notFound;
    }

    getPartY (args) {
        const p = this._averagePoint(this._hand(args), PART_INDEX[args.PART] === undefined ? null : [PART_INDEX[args.PART]]);
        return p ? p[1] : this.notFound;
    }

    getX (args) {
        const p = this._numberedPoint(this._hand(args), args.LANDMARK);
        return p ? p[0] : this.notFound;
    }

    getY (args) {
        const p = this._numberedPoint(this._hand(args), args.LANDMARK);
        return p ? p[1] : this.notFound;
    }

    getZ (args) {
        const hand = this._hand(args);
        const point = hand && hand.keypoints && hand.keypoints[parseInt(args.LANDMARK, 10) - 1];
        return point ? point[2] : this.notFound;
    }
}

module.exports = Scratch3Handpose2ScratchBlocks;
module.exports.HAND_PARTS = HAND_PARTS;
