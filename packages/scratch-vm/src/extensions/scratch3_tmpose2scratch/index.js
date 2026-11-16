/* eslint-disable */
/**
 * Teachable Machine（姿態）擴展：學員在 Teachable Machine 網站訓練姿態模型，把分享連結貼進積木。
 *
 * 改寫自 champierre/tmpose2scratch（AGPL-3.0，https://github.com/champierre/tmpose2scratch，commit 2b14da3，2024-11-29）。
 * 營隊於 2026-11 修改：
 *   - 不再於執行時從 cdn.jsdelivr.net 載入 TensorFlow.js 與 @teachablemachine/pose；改為建置時下載、核對雜湊，
 *     由本網域提供（SPEC 7.3.4，見 ../camp_shared/loader.js 的 loadTmPose）。原版是同步載入，會卡住畫面
 *   - PoseNet 的權重改由本網域提供（載入模型期間改導）
 *   - 不再預先連到 Google 的範例模型；模型網址只接受 Teachable Machine 的分享連結（白名單，SPEC 7.7.6）
 *   - 改用營隊的視覺擴展基底：與其他擴展共用舞台影像；選擇攝影機、辨識輸入等共通積木
 *   - 載入中、載入失敗、放錯類型的模型時有明確提示
 *   - 繁體中文文案
 * 「辨識到 [標籤] 了嗎？」屬於 SPEC 的 ✚（本次未納入），保留但不顯示，原版作品仍可開啟。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const CampTeachableExtension = require('../camp_shared/teachable-extension');
const loader = require('../camp_shared/loader');

const blockIconURI = 'data:image/png;base64,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';

/**
 * 讀取 Teachable Machine 的分類模型，並在每一層的名稱前加上前綴。
 *
 * 原因（2026-11-10 瀏覽器實測發現）：ml5（Teachable Machine 影像用）與這裡的 TensorFlow.js 1.3.1 是兩份程式，
 * 但共用同一個 TensorFlow.js 引擎；Teachable Machine 匯出的模型層名都叫 dense_Dense1…，
 * 先載入影像模型再載入姿態模型就會出現「Variable with name dense_Dense1/kernel was already registered」而失敗。
 * 只處理 Teachable Machine 匯出的 Sequential 模型；其他格式原樣交給 TensorFlow.js。
 * @param {object} tf - TensorFlow.js 1.3.1
 * @param {string} url - model.json 的網址
 * @param {string} prefix - 名稱前綴
 * @returns {Promise<string|object>} 可交給 tf.loadLayersModel 的網址或 IOHandler
 */
async function prefixedLayersModel (tf, url, prefix) {
    if (!tf || !tf.io || !tf.io.browserHTTPRequest || !tf.io.fromMemory) return url;
    const artifacts = await tf.io.browserHTTPRequest(url).load();
    const topology = JSON.parse(JSON.stringify(artifacts.modelTopology || {}));
    if (topology.class_name !== 'Sequential' || !topology.config || !Array.isArray(topology.config.layers)) return url;
    const rename = name => `${prefix}${name}`;
    if (topology.config.name) topology.config.name = rename(topology.config.name);
    for (const layer of topology.config.layers) {
        if (layer.config && layer.config.name) layer.config.name = rename(layer.config.name);
    }
    const weightSpecs = (artifacts.weightSpecs || []).map(w => Object.assign({}, w, {name: rename(w.name)}));
    return tf.io.fromMemory({modelTopology: topology, weightSpecs, weightData: artifacts.weightData});
}

/** @teachablemachine/pose 的 PoseNet 輸入大小（Teachable Machine 預設 257）。 */
const POSE_INPUT_SIZE = 257;

const Message = {
    name: {'zh-tw': 'Teachable Machine（姿態）', 'en': 'TMPose2Scratch'},
    setPoseClassificationModelURL: {'zh-tw': '設定姿態模型網址 [URL]', 'en': 'pose classification model URL [URL]'},
    getPoseLabel: {'zh-tw': '姿態標籤', 'en': 'pose label'},
    whenPoseLabelReceived: {'zh-tw': '當辨識到姿態標籤 [LABEL]', 'en': 'when received pose label [LABEL]'},
    poseLabelConfidence: {'zh-tw': '姿態標籤 [LABEL] 的信心', 'en': 'confidence of pose [LABEL]'},
    isPoseLabelDetected: {'zh-tw': '辨識到姿態標籤 [LABEL] 了嗎？', 'en': 'pose [LABEL] detected'},
    classifyVideoPoseBlock: {'zh-tw': '辨識一次姿態', 'en': 'classify pose'}
};

class Scratch3TMPose2ScratchBlocks extends CampTeachableExtension {
    static get LABEL () {
        return 'Teachable Machine（姿態）';
    }

    static get ITEM_NAME () {
        return '個結果';
    }

    constructor (runtime, deps = {}) {
        // 這個擴展用的函式庫是 @teachablemachine/pose（不是 ml5）
        super(runtime, Object.assign({}, deps, {loadMl5: deps.loadMl5 || loader.loadTmPose}), Message);
        this.pose = null;
    }

    async _createModel (tmPose) {
        return {tmPose};
    }

    async _predict (model, input) {
        if (!this.pose) return [];
        const classifier = this.pose.classifier;
        const {posenetOutput} = await classifier.estimatePose(this._squareInput(input, POSE_INPUT_SIZE), false);
        const prediction = await classifier.predict(posenetOutput);
        return [{probs: (prediction || []).map(p => ({label: String(p.className), confidence: p.probability}))}];
    }

    get poseProbs () {
        return this.detections.length ? this.detections[0].probs : [];
    }

    async setPoseClassificationModelURL (args) {
        const loaded = await this._loadTeachable('pose', args.URL, this.pose, async (url, model) => {
            const checkpoint = await prefixedLayersModel(this._scope.tf, `${url}model.json`, 'campTmPose_');
            // PoseNet 的權重改由本網域提供
            return loader.withLocalModels(this._scope, () => model.tmPose.load(checkpoint, `${url}metadata.json`));
        });
        if (!loaded) return;
        this._disposeModel(this.pose);
        this.pose = loaded;
        this._setDetections([]);
        this._ensureLoop();
    }

    getPoseLabelsMenu () {
        return this._labelMenu(this.pose);
    }

    getPoseLabelsWithAnyWithoutOfMenu () {
        return this._labelMenu(this.pose);
    }

    getPoseLabelsWithoutAnyMenu () {
        return this._labelMenu(this.pose, {withAny: false});
    }

    getInfo () {
        this._locale = this.setLocale();
        const label = (menu, defaultValue) => ({type: ArgumentType.STRING, menu, defaultValue});
        return {
            id: 'tmpose2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'setPoseClassificationModelURL',
                    blockType: BlockType.COMMAND,
                    text: this._t('setPoseClassificationModelURL'),
                    arguments: {URL: {type: ArgumentType.STRING, defaultValue: CampTeachableExtension.URL_PLACEHOLDER}}
                },
                {opcode: 'getPoseLabel', blockType: BlockType.REPORTER, text: this._t('getPoseLabel')},
                {opcode: 'whenPoseLabelReceived', blockType: BlockType.HAT, text: this._t('whenPoseLabelReceived'), arguments: {LABEL: label('received_pose_label_menu', 'any')}},
                {opcode: 'poseLabelConfidence', blockType: BlockType.REPORTER, text: this._t('poseLabelConfidence'), arguments: {LABEL: label('pose_labels_without_any_menu', '')}},
                '---',
                ...this._teachableBlocks(),
                '---',
                ...this._teachableVideoBlocks(),
                {opcode: 'isPoseLabelDetected', blockType: BlockType.BOOLEAN, text: this._t('isPoseLabelDetected'), hideFromPalette: true, arguments: {LABEL: label('pose_labels_menu', 'any')}},
                {opcode: 'classifyVideoPoseBlock', blockType: BlockType.COMMAND, text: this._t('classifyVideoPoseBlock'), hideFromPalette: true}
            ],
            menus: Object.assign(this._teachableMenus(), {
                received_pose_label_menu: {acceptReporters: true, items: 'getPoseLabelsMenu'},
                pose_labels_menu: {acceptReporters: true, items: 'getPoseLabelsWithAnyWithoutOfMenu'},
                pose_labels_without_any_menu: {acceptReporters: true, items: 'getPoseLabelsWithoutAnyMenu'}
            })
        };
    }

    getPoseLabel () {
        return this._bestLabel(this.poseProbs);
    }

    whenPoseLabelReceived (args) {
        return this._matches(this.poseProbs, args.LABEL);
    }

    isPoseLabelDetected (args) {
        return this._matches(this.poseProbs, args.LABEL);
    }

    poseLabelConfidence (args) {
        return this._confidence(this.poseProbs, args.LABEL);
    }

    async classifyVideoPoseBlock () {
        await this.detectOnce();
        return JSON.stringify(this.poseProbs);
    }
}

module.exports = Scratch3TMPose2ScratchBlocks;
module.exports.prefixedLayersModel = prefixedLayersModel;
