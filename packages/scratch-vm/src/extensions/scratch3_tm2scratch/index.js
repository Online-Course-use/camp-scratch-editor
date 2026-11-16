/* eslint-disable */
/**
 * Teachable Machine（影像、聲音）擴展：學員在 Teachable Machine 網站訓練模型，把分享連結貼進積木。
 *
 * 改寫自 champierre/tm2scratch（AGPL-3.0，https://github.com/champierre/tm2scratch，commit d018790，2026-03-05）。
 * 營隊於 2026-11 修改：
 *   - 不再於執行時從第三方網站（stretch3.github.io）載入 ml5；改用本網域自架的 ml5 0.12.2（SPEC 7.3.4）
 *   - 不再預先連到 Google 的範例模型；模型網址只接受 Teachable Machine 的分享連結（白名單，SPEC 7.7.6）
 *   - 改用營隊的視覺擴展基底：不另開第二個攝影機，與其他擴展共用舞台影像；選擇攝影機、辨識輸入等共通積木
 *   - 載入中、載入失敗、放錯類型的模型、麥克風無法使用時有明確提示
 *   - 圖片取攝影機畫面中央的正方形再辨識（Teachable Machine 用正方形畫面訓練）
 *   - 繁體中文文案
 * 「辨識到 [標籤] 了嗎？」屬於 SPEC 的 ✚（本次未納入），保留但不顯示，原版作品仍可開啟。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const CampTeachableExtension = require('../camp_shared/teachable-extension');

const blockIconURI = 'data:image/png;base64,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';

const BACKGROUND_LABELS = ['_background_noise_', 'Background Noise', '背景雜音'];

const Message = {
    name: {'zh-tw': 'Teachable Machine（影像、聲音）', 'en': 'TM2Scratch'},
    setImageClassificationModelURL: {'zh-tw': '設定圖片模型網址 [URL]', 'en': 'image classification model URL [URL]'},
    getImageLabel: {'zh-tw': '圖片標籤', 'en': 'image label'},
    whenReceived: {'zh-tw': '當辨識到圖片標籤 [LABEL]', 'en': 'when received [LABEL]'},
    imageLabelConfidence: {'zh-tw': '圖片標籤 [LABEL] 的信心', 'en': 'confidence of image [LABEL]'},
    isImageLabelDetected: {'zh-tw': '辨識到圖片標籤 [LABEL] 了嗎？', 'en': 'image [LABEL] detected'},
    classifyVideoImageBlock: {'zh-tw': '辨識一次圖片', 'en': 'classify image'},
    setSoundClassificationModelURL: {'zh-tw': '設定聲音模型網址 [URL]', 'en': 'sound classification model URL [URL]'},
    getSoundLabel: {'zh-tw': '聲音標籤', 'en': 'sound label'},
    whenReceivedSoundLabel: {'zh-tw': '當辨識到聲音標籤 [LABEL]', 'en': 'when received sound [LABEL]'},
    soundLabelConfidence: {'zh-tw': '聲音標籤 [LABEL] 的信心', 'en': 'confidence of sound [LABEL]'},
    isSoundLabelDetected: {'zh-tw': '辨識到聲音標籤 [LABEL] 了嗎？', 'en': 'sound [LABEL] detected'}
};

class Scratch3TM2ScratchBlocks extends CampTeachableExtension {
    static get LABEL () {
        return 'Teachable Machine';
    }

    static get ITEM_NAME () {
        return '個結果';
    }

    constructor (runtime, deps = {}) {
        super(runtime, deps, Message);
        /** 已載入的模型：{url, metadata, labels, classifier} */
        this.image = null;
        this.sound = null;
        /** 最近一次的聲音辨識結果 [{label, confidence}] */
        this.soundProbs = [];
        this._soundListening = false;
        this._soundToken = 0;
    }

    // ------------------------------------------------------------ 圖片（走視覺基底的辨識迴圈）

    async _createModel (ml5) {
        // 一開始沒有模型；學員設定網址時才載入。這裡只確認 ml5 已載入。
        return {ml5};
    }

    async _predict (model, input) {
        if (!this.image) return [];
        const results = await this.image.classifier.classify(this._squareInput(input, 224));
        return [{probs: (results || []).map(r => ({label: String(r.label), confidence: r.confidence}))}];
    }

    get imageProbs () {
        return this.detections.length ? this.detections[0].probs : [];
    }

    async setImageClassificationModelURL (args) {
        const loaded = await this._loadTeachable('image', args.URL, this.image, async (url, model) => {
            // 加上時間避免瀏覽器用到重新訓練前的舊檔（與原版相同）
            const classifier = await model.ml5.imageClassifier(`${url}model.json?${Date.now()}`);
            return this._checkMl5Classifier(classifier);
        });
        if (!loaded) return;
        this._disposeModel(this.image);
        this.image = loaded;
        this._setDetections([]);
        this._ensureLoop();
    }

    // ------------------------------------------------------------ 聲音（麥克風持續聆聽）

    async setSoundClassificationModelURL (args) {
        const loaded = await this._loadTeachable('sound', args.URL, this.sound, async (url, model) => {
            const classifier = await model.ml5.soundClassifier(`${url}model.json`);
            return this._checkMl5Classifier(classifier);
        });
        if (!loaded) return;
        this._stopSound();
        this._disposeModel(this.sound);
        this.sound = loaded;
        this.soundProbs = [];
        if (this.classifying) this._startSound();
    }

    _startSound () {
        if (!this.sound || this._soundListening) return;
        this._soundListening = true;
        const token = ++this._soundToken;
        try {
            this.sound.classifier.classify((err, results) => {
                if (token !== this._soundToken || !this._soundListening) return;
                if (err) {
                    this._soundListening = false;
                    this.soundProbs = [];
                    console.error(`[${this._label}] 聲音辨識失敗`, err);
                    this._ui.show(
                        '沒辦法使用麥克風。\n請在網址列左邊允許這個網站使用麥克風，並確認沒有其他程式正在使用它，再設定一次聲音模型網址',
                        {kind: 'error'}
                    );
                    return;
                }
                this.soundProbs = (results || []).map(r => ({label: String(r.label), confidence: r.confidence}));
            });
        } catch (e) {
            this._soundListening = false;
        }
    }

    _stopSound () {
        this._soundToken++;
        this._soundListening = false;
        this.soundProbs = [];
        const recognizer = this.sound && this.sound.classifier.model && this.sound.classifier.model.model;
        try {
            if (recognizer && recognizer.isListening && recognizer.isListening()) recognizer.stopListening();
        } catch (e) {
            // 已經停了
        }
    }

    _onToggle (on) {
        if (on) this._startSound();
        else this._stopSound();
    }

    // ------------------------------------------------------------ 積木清單

    getLabelsMenu () {
        return this._labelMenu(this.image);
    }

    getLabelsWithAnyWithoutOfMenu () {
        return this._labelMenu(this.image);
    }

    getLabelsWithoutAnyMenu () {
        return this._labelMenu(this.image, {withAny: false});
    }

    getSoundLabelsWithoutBackgroundMenu () {
        return this._labelMenu(this.sound, {exclude: BACKGROUND_LABELS});
    }

    getSoundLabelsWithoutBackgroundWithAnyWithoutOfMenu () {
        return this._labelMenu(this.sound, {exclude: BACKGROUND_LABELS});
    }

    getSoundLabelsWithoutAnyMenu () {
        return this._labelMenu(this.sound, {withAny: false});
    }

    getInfo () {
        this._locale = this.setLocale();
        const url = {type: ArgumentType.STRING, defaultValue: CampTeachableExtension.URL_PLACEHOLDER};
        const label = (menu, defaultValue) => ({type: ArgumentType.STRING, menu, defaultValue});
        return {
            id: 'tm2scratch',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'setImageClassificationModelURL', blockType: BlockType.COMMAND, text: this._t('setImageClassificationModelURL'), arguments: {URL: url}},
                {opcode: 'getImageLabel', blockType: BlockType.REPORTER, text: this._t('getImageLabel')},
                {opcode: 'whenReceived', blockType: BlockType.HAT, text: this._t('whenReceived'), arguments: {LABEL: label('received_menu', 'any')}},
                {opcode: 'imageLabelConfidence', blockType: BlockType.REPORTER, text: this._t('imageLabelConfidence'), arguments: {LABEL: label('image_labels_without_any_menu', '')}},
                '---',
                {opcode: 'setSoundClassificationModelURL', blockType: BlockType.COMMAND, text: this._t('setSoundClassificationModelURL'), arguments: {URL: url}},
                {opcode: 'getSoundLabel', blockType: BlockType.REPORTER, text: this._t('getSoundLabel')},
                {opcode: 'whenReceivedSoundLabel', blockType: BlockType.HAT, text: this._t('whenReceivedSoundLabel'), arguments: {LABEL: label('received_sound_label_menu', 'any')}},
                {opcode: 'soundLabelConfidence', blockType: BlockType.REPORTER, text: this._t('soundLabelConfidence'), arguments: {LABEL: label('sound_labels_without_any_menu', '')}},
                '---',
                ...this._teachableBlocks(),
                '---',
                ...this._teachableVideoBlocks(),
                // 原版有、SPEC 未納入（✚）或不需要的積木：保留給原版作品
                {opcode: 'isImageLabelDetected', blockType: BlockType.BOOLEAN, text: this._t('isImageLabelDetected'), hideFromPalette: true, arguments: {LABEL: label('image_labels_menu', 'any')}},
                {opcode: 'isSoundLabelDetected', blockType: BlockType.BOOLEAN, text: this._t('isSoundLabelDetected'), hideFromPalette: true, arguments: {LABEL: label('sound_labels_menu', 'any')}},
                {opcode: 'classifyVideoImageBlock', blockType: BlockType.COMMAND, text: this._t('classifyVideoImageBlock'), hideFromPalette: true},
                {opcode: 'switchCamera', blockType: BlockType.COMMAND, text: this._t('switchCamera'), hideFromPalette: true, arguments: {DEVICE: label('mediadevices', '')}}
            ],
            menus: Object.assign(this._teachableMenus(), {
                received_menu: {acceptReporters: true, items: 'getLabelsMenu'},
                image_labels_menu: {acceptReporters: true, items: 'getLabelsWithAnyWithoutOfMenu'},
                image_labels_without_any_menu: {acceptReporters: true, items: 'getLabelsWithoutAnyMenu'},
                received_sound_label_menu: {acceptReporters: true, items: 'getSoundLabelsWithoutBackgroundMenu'},
                sound_labels_menu: {acceptReporters: true, items: 'getSoundLabelsWithoutBackgroundWithAnyWithoutOfMenu'},
                sound_labels_without_any_menu: {acceptReporters: true, items: 'getSoundLabelsWithoutAnyMenu'},
                mediadevices: {acceptReporters: true, items: 'getDevices'}
            })
        };
    }

    // ------------------------------------------------------------ 積木

    getImageLabel () {
        return this._bestLabel(this.imageProbs);
    }

    whenReceived (args) {
        return this._matches(this.imageProbs, args.LABEL);
    }

    isImageLabelDetected (args) {
        return this._matches(this.imageProbs, args.LABEL);
    }

    imageLabelConfidence (args) {
        return this._confidence(this.imageProbs, args.LABEL);
    }

    async classifyVideoImageBlock () {
        await this.detectOnce();
        return JSON.stringify(this.imageProbs);
    }

    getSoundLabel () {
        return this._bestLabel(this.soundProbs);
    }

    /** 聲音的「任何」不算背景雜音（安靜時背景雜音的信心通常最高）。 */
    _soundMatches (value) {
        const label = this._bestLabel(this.soundProbs);
        if (this._tm.isAny(value)) return label !== '' && !BACKGROUND_LABELS.includes(label);
        return this._matches(this.soundProbs, value);
    }

    whenReceivedSoundLabel (args) {
        return this._soundMatches(args.LABEL);
    }

    isSoundLabelDetected (args) {
        return this._soundMatches(args.LABEL);
    }

    soundLabelConfidence (args) {
        return this._confidence(this.soundProbs, args.LABEL);
    }
}

module.exports = Scratch3TM2ScratchBlocks;
