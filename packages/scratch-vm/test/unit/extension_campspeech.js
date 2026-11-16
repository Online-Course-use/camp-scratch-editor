/* eslint-disable */
const {test} = require('tap');
const Speech = require('../../src/extensions/scratch3_campspeech');

/** 假的 Web Speech API：測試自己決定要送出什麼結果。 */
const makeScope = () => {
    const instances = [];
    class FakeRecognition {
        constructor () {
            instances.push(this);
            this.started = 0;
            this.stopped = 0;
            this.aborted = 0;
        }
        start () { this.started++; }
        stop () { this.stopped++; this.onend && this.onend(); }
        abort () { this.aborted++; this.onerror && this.onerror({error: 'aborted'}); this.onend && this.onend(); }
        emit (parts, resultIndex = 0) {
            const results = parts.map(([transcript, isFinal, confidence = 0.9]) => Object.assign([{transcript, confidence}], {isFinal}));
            this.onresult({resultIndex, results});
        }
    }
    return {scope: {webkitSpeechRecognition: FakeRecognition}, instances};
};

const makeUi = () => {
    const shown = [];
    let hidden = 0;
    return {shown, show: (text, opts = {}) => shown.push({text, kind: opts.kind || 'info'}), hide: () => hidden++, get hidden () { return hidden; }, last () { return shown[shown.length - 1]; }};
};

const make = (opts = {}) => {
    const {scope, instances} = opts.scope ? {scope: opts.scope, instances: []} : makeScope();
    const ui = makeUi();
    const listeners = {};
    const runtime = {on: (name, fn) => (listeners[name] = fn)};
    const ext = new Speech(runtime, {scope, ui, maxListenMs: opts.maxListenMs || 50});
    return {ext, ui, instances, listeners};
};

test('聆聽並等待：等到最後結果，聽到的話與信心', async t => {
    const {ext, ui, instances} = make();
    const p = ext.listenAndWait();
    const rec = instances[0];
    t.equal(rec.lang, 'zh-TW', '預設繁體中文');
    t.equal(rec.interimResults, true);
    t.equal(rec.continuous, false);
    t.match(ui.last().text, /正在聆聽/);
    rec.emit([['你好', false]]);
    t.equal(ext.getInterim(), '你好', '即時聽到的話');
    rec.emit([['你好嗎', true, 0.876]]);
    rec.onend();
    await p;
    t.equal(ext.getHeard(), '你好嗎');
    t.equal(ext.getConfidence(), 0.88);
    t.equal(ext.getInterim(), '', '結束後清空即時結果');
    t.ok(ui.hidden >= 1, '結束後收起「正在聆聽」');
});

test('同時呼叫多次共用同一次聆聽', async t => {
    const {ext, instances} = make();
    const p1 = ext.listenAndWait();
    const p2 = ext.listenAndWait();
    t.equal(p1, p2);
    t.equal(instances.length, 1);
    instances[0].onend();
    await p1;
});

test('沒有聽到聲音：聽到的話變空白（不會留著上一句）', async t => {
    const {ext, instances} = make();
    let p = ext.listenAndWait();
    instances[0].emit([['第一句', true]]);
    instances[0].onend();
    await p;
    t.equal(ext.getHeard(), '第一句');
    p = ext.listenAndWait();
    instances[1].onerror({error: 'no-speech'});
    instances[1].onend();
    await p;
    t.equal(ext.getHeard(), '');
    t.equal(ext.getConfidence(), 0);
});

test('逾時會停止聆聽', async t => {
    const {ext, instances} = make({maxListenMs: 20});
    await ext.listenAndWait();
    t.equal(instances[0].stopped, 1);
});

test('錯誤提示：麥克風被拒、沒有麥克風、沒有網路', async t => {
    for (const [code, re] of [['not-allowed', /允許這個網站使用麥克風/], ['audio-capture', /找不到麥克風/], ['network', /連上網路/]]) {
        const {ext, ui, instances} = make();
        const p = ext.listenAndWait();
        instances[0].onerror({error: code});
        instances[0].onend();
        await p;
        t.match(ui.last().text, re, code);
        t.equal(ui.last().kind, 'error');
    }
});

test('不支援的瀏覽器：請改用 Chrome 或 Edge', async t => {
    const {ext, ui} = make({scope: {}});
    await ext.listenAndWait();
    t.match(ui.last().text, /請改用 Chrome 或 Edge/);
    t.equal(ext.getHeard(), '');
});

test('按下停止時中止聆聽', async t => {
    const {ext, instances, listeners} = make({maxListenMs: 5000});
    const p = ext.listenAndWait();
    listeners.PROJECT_STOP_ALL();
    await p;
    t.equal(instances[0].aborted, 1);
});

test('語言設為：只接受清單裡的 5 種', async t => {
    const {ext, instances} = make();
    ext.setLanguage({LANGUAGE: 'ja-JP'});
    const p = ext.listenAndWait();
    t.equal(instances[0].lang, 'ja-JP');
    instances[0].onend();
    await p;
    ext.setLanguage({LANGUAGE: 'fr-FR'});
    t.equal(ext.language, 'ja-JP', '不在清單裡的不改');
});

test('下一個詞、剩幾個詞', async t => {
    const {ext, instances} = make();
    ext.setLanguage({LANGUAGE: 'en-US'});
    const p = ext.listenAndWait();
    instances[0].emit([['move left now', true]]);
    instances[0].onend();
    await p;
    t.equal(ext.wordsLeft(), 3);
    t.equal(ext.nextWord(), 'move');
    t.equal(ext.nextWord(), 'left');
    t.equal(ext.wordsLeft(), 1);
    ext.nextWord();
    t.equal(ext.nextWord(), '', '沒有詞了是空白');
    t.ok(Speech.splitWords('我要往左走', 'zh-TW').length >= 2, '中文也能切詞');
    t.same(Speech.splitWords('', 'zh-TW'), []);
});

test('積木清單（SPEC 7.7.4：★＋☆，沒有「語言代碼設為」）', t => {
    const {ext} = make();
    ext.setLocale = () => 'zh-tw';
    const info = ext.getInfo();
    t.equal(info.id, 'campspeech');
    t.equal(info.name, '語音辨識');
    t.same(info.blocks.filter(b => b !== '---').map(b => b.text), ['聆聽並等待', '聽到的話', '語言設為 [LANGUAGE]', '辨識信心', '即時聽到的話', '下一個詞', '剩幾個詞']);
    t.same(info.menus.languages.items.map(i => i.text), ['繁體中文', '簡體中文', 'English（美）', '日本語', '한국어']);
    t.end();
});
