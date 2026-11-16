/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 語音辨識擴展（SPEC 7.7.4）：瀏覽器內建的 Web Speech API 的薄封裝。
 *
 * - 找不到維護中的 Scratch 3 開源實作，所以自己寫（SPEC 7.2）。
 * - 聲音會送到 Google 的語音服務轉成文字（瀏覽器內部的連線，不受編輯器的安全標頭管轄）；已寫進個資告知（SPEC 4.4）。
 * - Chrome、Edge 才支援；其他瀏覽器顯示「請改用 Chrome 或 Edge」。
 * - 積木：聆聽並等待、聽到的話、語言設為（★）；辨識信心、即時聽到的話、下一個詞、剩幾個詞（☆）。
 *   「語言代碼設為」依定案不做。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const formatMessage = require('format-message');
const campUi = require('../scratch3_camparduino/ui');

const blockIconURI = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj4KICA8cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHJ4PSI2IiBmaWxsPSIjN2M0ZGZmIi8+CiAgPHJlY3QgeD0iMTYiIHk9IjciIHdpZHRoPSI4IiBoZWlnaHQ9IjE1IiByeD0iNCIgZmlsbD0iI2ZmZiIvPgogIDxwYXRoIGQ9Ik0xMiAxOGE4IDggMCAwIDAgMTYgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHBhdGggZD0iTTIwIDI2djVNMTYgMzFoOCIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+Cjwvc3ZnPgo=';

const LANGUAGES = [
    ['zh-TW', '繁體中文'],
    ['zh-CN', '簡體中文'],
    ['en-US', 'English（美）'],
    ['ja-JP', '日本語'],
    ['ko-KR', '한국어']
];
const DEFAULT_LANGUAGE = 'zh-TW';
/** 一次聆聽最久多少毫秒（瀏覽器通常在安靜幾秒後自己結束，這是保險）。 */
const MAX_LISTEN_MS = 15000;
/** 詞的佇列最多保留幾個。 */
const MAX_WORDS = 100;

const Message = {
    name: {'zh-tw': '語音辨識', 'en': 'Speech Recognition'},
    listenAndWait: {'zh-tw': '聆聽並等待', 'en': 'listen and wait'},
    getHeard: {'zh-tw': '聽到的話', 'en': 'speech'},
    setLanguage: {'zh-tw': '語言設為 [LANGUAGE]', 'en': 'set language to [LANGUAGE]'},
    getConfidence: {'zh-tw': '辨識信心', 'en': 'confidence'},
    getInterim: {'zh-tw': '即時聽到的話', 'en': 'live speech'},
    nextWord: {'zh-tw': '下一個詞', 'en': 'next word'},
    wordsLeft: {'zh-tw': '剩幾個詞', 'en': 'words left'}
};
const AvailableLocales = ['en', 'zh-tw'];

/**
 * 把一句話切成詞。中文、日文沒有空格，用瀏覽器內建的斷詞（Intl.Segmenter）；沒有就用空白切。
 * @param {string} text - 一句話
 * @param {string} lang - 語言代碼
 * @returns {Array<string>} 詞
 */
function splitWords (text, lang) {
    const t = String(text || '').trim();
    if (!t) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try {
            return [...new Intl.Segmenter(lang, {granularity: 'word'}).segment(t)]
                .filter(s => s.isWordLike)
                .map(s => s.segment);
        } catch (e) {
            // 退回用空白切
        }
    }
    return t.split(/\s+/).filter(Boolean);
}

class Scratch3CampSpeechBlocks {
    /**
     * @param {object} runtime - Scratch 的執行環境
     * @param {object} [deps] - 測試用：scope（瀏覽器的 window）、ui（訊息面板）
     */
    constructor (runtime, deps = {}) {
        this.runtime = runtime;
        this._scope = deps.scope || globalThis;
        this._ui = deps.ui || campUi;
        this._maxListenMs = deps.maxListenMs || MAX_LISTEN_MS;
        this.language = DEFAULT_LANGUAGE;
        this.heard = '';
        this.interim = '';
        this.confidence = 0;
        this.words = [];
        this._listening = null;
        this._recognition = null;
        this._locale = 'en';
        if (runtime && runtime.on) runtime.on('PROJECT_STOP_ALL', () => this._abort());
    }

    _t (key) {
        const m = Message[key];
        return m[this._locale] || m.en;
    }

    get _SpeechRecognition () {
        return this._scope.SpeechRecognition || this._scope.webkitSpeechRecognition || null;
    }

    getInfo () {
        this._locale = this.setLocale();
        return {
            id: 'campspeech',
            name: this._t('name'),
            blockIconURI: blockIconURI,
            blocks: [
                {opcode: 'listenAndWait', blockType: BlockType.COMMAND, text: this._t('listenAndWait')},
                {opcode: 'getHeard', blockType: BlockType.REPORTER, text: this._t('getHeard')},
                {
                    opcode: 'setLanguage',
                    blockType: BlockType.COMMAND,
                    text: this._t('setLanguage'),
                    arguments: {LANGUAGE: {type: ArgumentType.STRING, menu: 'languages', defaultValue: DEFAULT_LANGUAGE}}
                },
                '---',
                {opcode: 'getConfidence', blockType: BlockType.REPORTER, text: this._t('getConfidence')},
                {opcode: 'getInterim', blockType: BlockType.REPORTER, text: this._t('getInterim')},
                {opcode: 'nextWord', blockType: BlockType.REPORTER, text: this._t('nextWord')},
                {opcode: 'wordsLeft', blockType: BlockType.REPORTER, text: this._t('wordsLeft')}
            ],
            menus: {
                languages: {acceptReporters: false, items: LANGUAGES.map(([value, text]) => ({text, value}))}
            }
        };
    }

    /**
     * 開始聆聽，等辨識出一句話（或安靜、逾時、出錯）才繼續。同時呼叫多次時共用同一次聆聽。
     * @returns {Promise<void>} 不會丟出錯誤
     */
    listenAndWait () {
        if (this._listening) return this._listening;
        const SR = this._SpeechRecognition;
        if (!SR) {
            this._ui.show('這個瀏覽器不支援語音辨識，請改用 Chrome 或 Edge', {kind: 'error'});
            this.heard = '';
            return Promise.resolve();
        }
        this._listening = new Promise(resolve => {
            let finalText = '';
            let finalConfidence = 0;
            let errorShown = false;
            let timer = null;
            let rec;
            const finish = () => {
                clearTimeout(timer);
                if (this._recognition === rec) this._recognition = null;
                this.heard = finalText.trim();
                this.confidence = this.heard ? Math.round(finalConfidence * 100) / 100 : 0;
                this.interim = '';
                if (this.heard) {
                    this.words = this.words.concat(splitWords(this.heard, this.language)).slice(-MAX_WORDS);
                }
                if (!errorShown) this._ui.hide();
                this._listening = null;
                resolve();
            };
            try {
                rec = new SR();
                rec.lang = this.language;
                rec.interimResults = true;
                rec.continuous = false;
                rec.maxAlternatives = 1;
            } catch (e) {
                this._ui.show('語音辨識無法啟動，請改用 Chrome 或 Edge', {kind: 'error'});
                errorShown = true;
                finish();
                return;
            }
            rec.onresult = event => {
                let interim = '';
                for (let i = event.resultIndex || 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    const alt = result[0];
                    if (!alt) continue;
                    if (result.isFinal) {
                        finalText += alt.transcript;
                        finalConfidence = alt.confidence || 0;
                    } else {
                        interim += alt.transcript;
                    }
                }
                this.interim = (finalText + interim).trim();
            };
            rec.onerror = event => {
                const code = event && event.error;
                let message = null;
                if (code === 'not-allowed' || code === 'service-not-allowed') {
                    message = '沒辦法使用麥克風。\n請在網址列左邊允許這個網站使用麥克風，再試一次';
                } else if (code === 'audio-capture') {
                    message = '找不到麥克風，請確認麥克風已經接上';
                } else if (code === 'network') {
                    message = '語音辨識需要連上網路（聲音會送到 Google 的語音服務），請檢查網路';
                } else if (code === 'language-not-supported') {
                    message = '這個語言目前不能辨識，請換一個語言';
                }
                // no-speech（沒有聽到聲音）、aborted（被停止）不算錯誤：聽到的話是空白
                if (message) {
                    errorShown = true;
                    this._ui.show(message, {kind: 'error'});
                }
            };
            rec.onend = finish;
            this._recognition = rec;
            timer = setTimeout(() => {
                try {
                    rec.stop();
                } catch (e) {
                    finish();
                }
            }, this._maxListenMs);
            try {
                rec.start();
                this._ui.show('正在聆聽…請對著麥克風說話');
            } catch (e) {
                this._ui.show('語音辨識無法啟動，請稍後再試', {kind: 'error'});
                errorShown = true;
                finish();
            }
        });
        return this._listening;
    }

    /** 按下停止（紅色按鈕）時停止聆聽。 */
    _abort () {
        if (this._recognition) {
            try {
                this._recognition.abort();
            } catch (e) {
                // 已經停了
            }
        }
    }

    getHeard () {
        return this.heard;
    }

    setLanguage (args) {
        const value = Cast.toString(args.LANGUAGE);
        if (LANGUAGES.some(([code]) => code === value)) this.language = value;
    }

    getConfidence () {
        return this.confidence;
    }

    getInterim () {
        return this.interim;
    }

    nextWord () {
        return this.words.length ? this.words.shift() : '';
    }

    wordsLeft () {
        return this.words.length;
    }

    setLocale () {
        const locale = formatMessage.setup().locale;
        return AvailableLocales.includes(locale) ? locale : 'en';
    }
}

module.exports = Scratch3CampSpeechBlocks;
module.exports.LANGUAGES = LANGUAGES;
module.exports.splitWords = splitWords;
