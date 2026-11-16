/* eslint-disable */
// 營隊 Arduino 擴展：2026-11-11 新增的零件積木（按鈕、音調、超音波、DHT11、脈衝、LED 矩陣、LCD、WS2812、藍牙、計算）
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const Arduino = require('../../src/extensions/scratch3_camparduino');
const {CAMP, encode, FirmataParser, split7} = require('../../src/extensions/scratch3_camparduino/firmata');
const parts = require('../../src/extensions/scratch3_camparduino/parts');

const FW_DIR = path.join(__dirname, '../../../camp-host/firmware/CampFirmata');

/** 假連線：記下送出的位元組。firmware 預設是營隊韌體。 */
const makeExt = ({firmware = 'CampFirmata.ino 2.5', connected = true} = {}) => {
    const ext = new Arduino({on () {}});
    const sent = [];
    ext.link = {write: async bytes => { sent.push(...bytes); }, close: async () => {}};
    ext.connected = connected;
    ext.firmware = firmware;
    return {ext, sent};
};

/** 從送出的位元組裡找出所有 sysex：[[command, ...data], …] */
const sysexes = bytes => {
    const out = [];
    let cur = null;
    for (const b of bytes) {
        if (b === 0xF0) cur = [];
        else if (b === 0xF7 && cur) { out.push(cur); cur = null; }
        else if (cur) cur.push(b);
    }
    return out;
};

/** 板子用 Firmata.sendSysex 回覆：每個位元組拆成兩個 7 位元。 */
const reply = (command, values) => [0xF0, command, ...values.flatMap(v => [v & 0x7F, (v >> 7) & 0x7F]), 0xF7];

const tick = () => new Promise(r => setImmediate(r));

// ---------- 韌體與網頁兩邊的指令編號一致 ----------
test('韌體 camp_features.h 與 firmata.js 的指令編號一致', t => {
    const h = fs.readFileSync(path.join(FW_DIR, 'camp_features.h'), 'utf8');
    const defs = {};
    for (const m of h.matchAll(/#define CAMP_([A-Z0-9_]+)\s+0x([0-9A-F]+)/gi)) defs[m[1]] = parseInt(m[2], 16);
    t.same({TONE: defs.TONE, PULSE_IN: defs.PULSE_IN, SONAR: defs.SONAR, DHT11: defs.DHT11, PIXEL: defs.PIXEL, MATRIX: defs.MATRIX}, CAMP);
    const ino = fs.readFileSync(path.join(FW_DIR, 'CampFirmata.ino'), 'utf8');
    t.match(ino, /campSysex\(command, argc, argv\)/, '韌體的 sysexCallback 會先交給營隊指令');
    t.match(ino, /campReset\(\)/, '系統重置時停止音調、熄滅燈條');
    t.ok(ino.indexOf('campReleasePins();') > ino.indexOf('setPinModeCallback(i, OUTPUT);'), '重置後放開數位腳位（在 StandardFirmata 設成輸出之後）');
    t.match(ino, /campLoop\(\)/, 'loop 會檢查有長度的音調是否播完');
    const major = /#define CAMP_FIRMWARE_MAJOR (\d+)/.exec(h)[1];
    const minor = /#define CAMP_FIRMWARE_MINOR (\d+)/.exec(h)[1];
    const index = fs.readFileSync(path.join(__dirname, '../../src/extensions/scratch3_camparduino/index.js'), 'utf8');
    t.ok(index.includes(`'/firmware/CampFirmata-${major}.${minor}.0-uno.hex'`),'韌體版號與擴展的 FIRMWARE_URL 一致');
    t.ok(fs.existsSync(path.join(FW_DIR, `../../public/firmware/CampFirmata-${major}.${minor}.0-uno.hex`)), '建置好的 hex 存在');
    t.end();
});

test('編碼：7 位元拆分與各指令格式', t => {
    t.same(split7(262, 3), [6, 2, 0]);
    t.same(split7(25000, 4), [40, 67, 1, 0]);
    t.same(encode.campTone(8, 262, 500), [0xF0, CAMP.TONE, 8, 6, 2, 0, 116, 3, 0, 0xF7]);
    t.same(encode.campSonar(5, 14, 15, 25000), [0xF0, CAMP.SONAR, 5, 14, 15, 40, 67, 1, 0, 0xF7]);
    t.same(encode.i2cWrite(0x27, [0x0C, 0x88]), [0xF0, 0x76, 0x27, 0x00, 0x0C, 0, 0x08, 1, 0xF7], 'StandardFirmata 的 I2C 寫入格式');
    t.same(encode.serialConfig(9600, 10, 11), [0xF0, 0x60, 0x18, 0, 75, 0, 10, 11, 0xF7], '軟體序列埠 0（0x08）');
    t.equal(sysexes(encode.serialWrite(new Array(60).fill(65))).length, 3, '太長會分成多則（每則最多 28 個位元組）');
    t.end();
});

test('解碼：營隊指令的回覆、軟體序列埠收到的資料', t => {
    const got = {};
    const p = new FirmataParser({
        onCampPulse: (cmd, id, us) => { got.pulse = [cmd, id, us]; },
        onCampDht: (id, status, v) => { got.dht = [id, status, v]; },
        onSerial: (port, bytes) => { got.serial = [port, bytes]; }
    });
    p.feed(reply(CAMP.SONAR, [7, ...split7(1160, 5)]));
    t.same(got.pulse, [CAMP.SONAR, 7, 1160]);
    p.feed(reply(CAMP.DHT11, [3, 0, ...split7(55, 2), ...split7(0, 2), ...split7(26, 2), ...split7(4, 2)]));
    t.same(got.dht, [3, 0, [55, 0, 26, 4]]);
    p.feed([0xF0, 0x60, 0x48, 0x68, 0, 0x69, 0, 0xF7]);
    t.same(got.serial, [8, [0x68, 0x69]]);
    t.end();
});

// ---------- 需要營隊韌體 ----------
test('舊的 StandardFirmata：營隊韌體的積木提示重新燒錄（只提示一次），不送出指令', async t => {
    const {ext, sent} = makeExt({firmware: 'StandardFirmata.ino 2.5'});
    const shown = [];
    const ui = require('../../src/extensions/scratch3_camparduino/ui');
    const orig = ui.show;
    ui.show = (text, opts) => shown.push(text);
    await ext.toneOn({PIN: '8', NOTE: '262'});
    t.equal(await ext.sonarDistance({TRIG: '14', ECHO: '15'}), 0);
    await ext.pixelSetup({PIN: '6', COUNT: '8'});
    ui.show = orig;
    t.equal(sent.length, 0);
    t.equal(shown.length, 1);
    t.match(shown[0], /燒錄 Firmata 韌體/);
});

test('沒連線時什麼都不做、不丟錯', async t => {
    const {ext, sent} = makeExt({connected: false});
    await ext.toneFor({PIN: '8', NOTE: '262', MS: '10'});
    await ext.buttonSetup({BUTTON: '1', PIN: '2'});
    t.equal(ext.buttonPressed({BUTTON: '1'}), false);
    t.equal(await ext.dhtRead({PIN: '4', WHAT: 'tempC'}), '');
    await ext.lcdPrint({LINE: '1', TEXT: 'x'});
    t.equal(sent.length, 0);
});

// ---------- 按鈕 ----------
test('按鈕：上拉輸入，按下（接地）時為真；A0–A5 也可以', async t => {
    const {ext, sent} = makeExt();
    await ext.buttonSetup({BUTTON: '1', PIN: '2'});
    t.ok(sent.join(',').includes([0xF4, 2, 11].join(',')), '腳位 2 設為上拉輸入');
    ext.digital[0] = 0b00000100;
    t.equal(ext.buttonPressed({BUTTON: '1'}), false, '放開（上拉為高）');
    ext.digital[0] = 0;
    t.equal(ext.buttonPressed({BUTTON: '1'}), true, '按下（接地為低）');
    await ext.buttonSetup({BUTTON: '2', PIN: 'A3'});
    t.ok(sent.join(',').includes([0xD2, 1].join(',')), 'A3（腳位 17）所在的埠 2 開始回報');
    ext.digital[2] = 0;
    t.equal(ext.buttonPressed({BUTTON: '2'}), true);
    t.equal(ext.buttonPressed({BUTTON: '3'}), false, '沒設定的按鈕');
});

// ---------- 音調 ----------
test('蜂鳴器：播放 N 毫秒會等音播完；一直播放與停止；按停止鍵會停掉一直響的音', async t => {
    const listeners = {};
    const ext = new Arduino({on: (n, fn) => (listeners[n] = fn)});
    const sent = [];
    ext.link = {write: async b => { sent.push(...b); }, close: async () => {}};
    ext.connected = true;
    ext.firmware = 'CampFirmata.ino 2.5';
    const start = Date.now();
    await ext.toneFor({PIN: '8', NOTE: '440', MS: '60'});
    t.ok(Date.now() - start >= 55, '等音播完才往下');
    t.same(sysexes(sent)[0], [CAMP.TONE, 8, ...split7(440, 3), ...split7(60, 3)]);
    sent.length = 0;
    await ext.toneOn({PIN: '8', NOTE: '262'});
    t.same(sysexes(sent)[0], [CAMP.TONE, 8, ...split7(262, 3), 0, 0, 0]);
    sent.length = 0;
    listeners.PROJECT_STOP_ALL();
    await tick();
    t.same(sysexes(sent)[0], [CAMP.TONE, 8, 0, 0, 0, 0, 0, 0], '按停止 → 停止播放');
    sent.length = 0;
    await ext.toneOff({PIN: '8'});
    t.same(sysexes(sent)[0], [CAMP.TONE, 8, 0, 0, 0, 0, 0, 0]);
    t.notOk(ext.pinModes.has(8), '韌體停止後會放開腳位，網頁不再當它是輸出');
    sent.length = 0;
    await ext.digitalWrite({PIN: '8', VALUE: '1'});
    t.same(sent.slice(0, 3), [0xF4, 8, 1], '之後在同一腳輸出會先重新設定模式');
    t.ok(parts.NOTES.find(([n, f]) => n === 'La' && f === 440));
});

// ---------- 超音波、脈衝、DHT11 ----------
test('超音波：換算成公分；測不到時是 999', async t => {
    const {ext, sent} = makeExt();
    const p = ext.sonarDistance({TRIG: 'A0', ECHO: 'A1'});
    await tick();
    const [cmd, id, trig, echo] = sysexes(sent)[0];
    t.same([cmd, trig, echo], [CAMP.SONAR, 14, 15]);
    ext.parser.feed(reply(CAMP.SONAR, [id, ...split7(580, 5)]));
    t.equal(await p, 10, '580 微秒 = 10 公分');
    const p2 = ext.sonarDistance({TRIG: '14', ECHO: '15'});
    await tick();
    ext.parser.feed(reply(CAMP.SONAR, [sysexes(sent)[1][1], 0, 0, 0, 0, 0]));
    t.equal(await p2, parts.SONAR_NO_ECHO);
    t.equal(await ext.sonarDistance({TRIG: '14', ECHO: '14'}), 0, 'Trig 與 Echo 不能同一支腳位');
});

test('超音波：板子沒回覆時逾時，回傳 999、不會卡住', async t => {
    const {ext} = makeExt();
    t.equal(await ext.sonarDistance({TRIG: '2', ECHO: '3'}), parts.SONAR_NO_ECHO);
});

test('脈衝寬度：逾時上限 0.25 秒', async t => {
    const {ext, sent} = makeExt();
    const p = ext.pulseWidth({PIN: '7', LEVEL: '1', TIMEOUT: '99999999'});
    await tick();
    const s = sysexes(sent)[0];
    t.same(s.slice(0, 1).concat(s.slice(2, 4)), [CAMP.PULSE_IN, 7, 1]);
    t.same(s.slice(4), split7(250000, 4));
    ext.parser.feed(reply(CAMP.PULSE_IN, [s[1], ...split7(1500, 5)]));
    t.equal(await p, 1500);
});

test('DHT11：溫度（°C、°F）與濕度；2 秒內共用同一次讀取；讀不到時提示並回傳空白', async t => {
    const {ext, sent} = makeExt();
    const a = ext.dhtRead({PIN: '4', WHAT: 'tempC'});
    const b = ext.dhtRead({PIN: '4', WHAT: 'humidity'});
    await tick();
    t.equal(sysexes(sent).length, 1, '同時讀兩個值只送一次');
    const id = sysexes(sent)[0][1];
    ext.parser.feed(reply(CAMP.DHT11, [id, 0, ...split7(60, 2), ...split7(0, 2), ...split7(25, 2), ...split7(5, 2)]));
    t.equal(await a, 25.5);
    t.equal(await b, 60);
    t.equal(await ext.dhtRead({PIN: '4', WHAT: 'tempF'}), 77.9, '用快取，不再送出');
    t.equal(sysexes(sent).length, 1);

    const ui = require('../../src/extensions/scratch3_camparduino/ui');
    const orig = ui.show;
    let msg = '';
    ui.show = text => { msg = text; };
    const c = ext.dhtRead({PIN: '5', WHAT: 'tempC'});
    await tick();
    ext.parser.feed(reply(CAMP.DHT11, [sysexes(sent)[1][1], 1, 0, 0, 0, 0, 0, 0, 0, 0]));
    t.equal(await c, '');
    ui.show = orig;
    t.match(msg, /讀不到溫溼度感測器（腳位 5）/);
});

// ---------- LED 矩陣 ----------
test('LED 矩陣：圖案、橫排、直排、單點（最高位元 = 最左／最上）', async t => {
    const {ext, sent} = makeExt();
    await ext.matrixSetup({DIN: '12', CS: '10', CLK: '11'});
    t.same(sysexes(sent)[0], [CAMP.MATRIX, 0, 12, 10, 11]);
    sent.length = 0;
    await ext.matrixPattern({PATTERN: '10000000 01000000 00100000 00010000 00001000 00000100 00000010 00000001'});
    t.same(ext.matrix.rows, [128, 64, 32, 16, 8, 4, 2, 1]);
    t.equal(sysexes(sent).length, 8);
    sent.length = 0;
    await ext.matrixRow({ROW: '1', VALUE: '255'});
    t.same(sysexes(sent), [[CAMP.MATRIX, 1, 0, ...split7(255, 2)]]);
    await ext.matrixColumn({COL: '8', VALUE: '255'});
    t.ok(ext.matrix.rows.every(r => r & 1), '最右邊一直排全亮');
    await ext.matrixDot({ROW: '2', COL: '2', STATE: 'off'});
    t.equal(ext.matrix.rows[1] & 0x40, 0);
    await ext.matrixDot({ROW: '9', COL: '1', STATE: 'on'});
    t.equal(ext.matrix.rows.length, 8, '超出 1–8 不做事');
});

test('LED 矩陣：沒先設定腳位時提示', async t => {
    const {ext, sent} = makeExt();
    const ui = require('../../src/extensions/scratch3_camparduino/ui');
    const orig = ui.show;
    let msg = '';
    ui.show = text => { msg = text; };
    await ext.matrixRow({ROW: '1', VALUE: '1'});
    ui.show = orig;
    t.match(msg, /請先用「LED 矩陣接在腳位/);
    t.equal(sent.length, 0);
    await ext.matrixSetup({DIN: '12', CS: '12', CLK: '11'});
    t.equal(sent.length, 0, '三支腳位不能重複');
});

// ---------- 1602 LCD ----------
test('LCD：初始化、每行補滿 16 字、中文換成 ?', async t => {
    const {ext, sent} = makeExt({firmware: 'StandardFirmata.ino 2.5'});
    await ext.lcdSetup({ADDRESS: '0x27'});
    const s = sysexes(sent);
    t.same(s[0], [0x78, 0, 0], '開啟 I2C');
    t.ok(s.slice(1).every(m => m[0] === 0x76 && m[1] === 0x27), '之後都是寫到 0x27');
    sent.length = 0;
    await ext.lcdPrint({LINE: '2', TEXT: 'Hi 你好'});
    const data = [];
    for (const m of sysexes(sent)) for (let i = 3; i + 1 < m.length; i += 2) data.push(m[i] | (m[i + 1] << 7));
    t.equal(data.length, 4 * 17, '1 個游標指令 + 16 個字，每個 4 個位元組');
    t.same(data.slice(0, 4), parts.lcdBytes(0xC0, false), '第二行的位址 0x40');
    t.equal(parts.lcdText('Hi 你好'), 'Hi ??           ');
    t.same(parts.lcdBytes(0x41, true), [0x4D, 0x49, 0x1D, 0x19], '字元 A：先高 4 位元再低 4 位元，各拉一次 EN');
    sent.length = 0;
    await ext.lcdSetup({ADDRESS: '999'});
    t.equal(sent.length, 0, '位址不正確時不送出');
});

// ---------- WS2812 ----------
test('燈條：設定、單顆（顏色與亮度、RGB）、全部、亮度、彩虹、清除；第幾顆從 1 開始', async t => {
    const {ext, sent} = makeExt();
    await ext.pixelSetup({PIN: '6', COUNT: '200'});
    t.same(sysexes(sent)[0], [CAMP.PIXEL, 0, 6, ...split7(parts.MAX_PIXELS, 2)], '最多 60 顆');
    sent.length = 0;
    await ext.pixelColor({N: '1', COLOR: 'red', LEVEL: '128'});
    t.same(sysexes(sent), [[CAMP.PIXEL, 1, 0, 0, ...split7(128, 2), 0, 0, 0, 0], [CAMP.PIXEL, 4]]);
    sent.length = 0;
    await ext.pixelRgb({N: '61', R: '1', G: '2', B: '3'});
    t.equal(sent.length, 0, '超過顆數不做事');
    await ext.pixelAll({R: '0', G: '0', B: '300'});
    t.same(sysexes(sent)[0], [CAMP.PIXEL, 2, 0, 0, 0, 0, ...split7(255, 2)]);
    sent.length = 0;
    await ext.pixelRainbow({HUE: '0', DIRECTION: 'forward'});
    const msgs = sysexes(sent);
    t.equal(msgs.length, parts.MAX_PIXELS + 1, '每顆一則，最後顯示');
    t.same(parts.hueToRgb(0), [255, 0, 0]);
    t.same(parts.hueToRgb(120), [0, 255, 0]);
    t.same(parts.hueToRgb(-120), [0, 0, 255]);
    sent.length = 0;
    await ext.pixelBrightness({LEVEL: '64'});
    await ext.pixelClear();
    t.same(sysexes(sent).map(m => m[1]), [3, 4, 5]);
});

// ---------- 藍牙 ----------
test('藍牙：設定軟體序列埠並持續讀取；收到的資料以 UTF-8 讀出後清空；傳送中文', async t => {
    const {ext, sent} = makeExt({firmware: 'StandardFirmata.ino 2.5'});
    await ext.btSetup({RX: '10', TX: '11', BAUD: '9600'});
    t.same(sysexes(sent), [[0x60, 0x18, 0, 75, 0, 10, 11], [0x60, 0x38, 0]]);
    const bytes = Array.from(Buffer.from('你好', 'utf8'));
    ext.parser.feed([0xF0, 0x60, 0x48, ...bytes.flatMap(b => [b & 0x7F, b >> 7]), 0xF7]);
    t.equal(ext.btAvailable(), 6);
    t.equal(ext.btRead(), '你好');
    t.equal(ext.btAvailable(), 0);
    t.equal(ext.btRead(), '');
    sent.length = 0;
    await ext.btWrite({TEXT: 'A好'});
    const m = sysexes(sent)[0];
    t.equal(m[1], 0x28);
    const out = [];
    for (let i = 2; i + 1 < m.length; i += 2) out.push(m[i] | (m[i + 1] << 7));
    t.same(out, Array.from(Buffer.from('A好', 'utf8')));
    sent.length = 0;
    await ext.btSetup({RX: '10', TX: '10', BAUD: '9600'});
    t.equal(sent.length, 0, 'RX 與 TX 不能同一支腳位');
    await ext.btSetup({RX: '10', TX: '11', BAUD: '115200'});
    t.equal(sent.length, 0, '軟體序列埠最高 57600');
});

// ---------- 計算 ----------
test('限制範圍與轉換', t => {
    const {ext} = makeExt();
    t.equal(ext.constrainValue({VALUE: '150', MIN: '0', MAX: '100'}), 100);
    t.equal(ext.constrainValue({VALUE: '-5', MIN: '100', MAX: '0'}), 0, '最小最大寫反也可以');
    t.equal(ext.textToNumber({TEXT: ' 42abc', TYPE: 'int'}), 42);
    t.equal(ext.textToNumber({TEXT: '3.14', TYPE: 'float'}), 3.14);
    t.equal(ext.textToNumber({TEXT: 'abc', TYPE: 'int'}), 0);
    t.equal(ext.codeToChar({CODE: '65'}), 'A');
    t.equal(ext.codeToChar({CODE: '999'}), '');
    t.equal(ext.charToCode({CHAR: 'a'}), 97);
    t.equal(ext.charToCode({CHAR: ''}), 0);
    t.end();
});

// ---------- 積木清單 ----------
test('積木清單：原本 26 個＋新增 30 個；選單與方法齊全', t => {
    const {ext} = makeExt();
    const info = ext.getInfo();
    const blocks = info.blocks.filter(b => b !== '---');
    t.equal(blocks.length, 56);
    const added = ['buttonSetup', 'buttonPressed', 'toneFor', 'toneOn', 'toneOff', 'sonarDistance', 'dhtRead', 'pulseWidth',
        'matrixSetup', 'matrixPattern', 'matrixRow', 'matrixColumn', 'matrixDot', 'lcdSetup', 'lcdPrint',
        'pixelSetup', 'pixelClear', 'pixelColor', 'pixelRgb', 'pixelAll', 'pixelBrightness', 'pixelRainbow',
        'btSetup', 'btAvailable', 'btRead', 'btWrite', 'constrainValue', 'textToNumber', 'codeToChar', 'charToCode'];
    t.equal(added.length, 30);
    for (const op of added) {
        const b = blocks.find(x => x.opcode === op);
        t.ok(b, `有 ${op}`);
        t.equal(typeof ext[op], 'function');
        for (const a of Object.values(b.arguments || {})) if (a.menu) t.ok(info.menus[a.menu], `${op} 的選單 ${a.menu}`);
        const placeholders = (b.text.match(/\[([A-Z_]+)\]/g) || []).map(x => x.slice(1, -1)).sort();
        t.same(placeholders, Object.keys(b.arguments || {}).sort(), `${op} 的參數與文字一致`);
    }
    t.equal(new Set(blocks.map(b => b.opcode)).size, blocks.length, '沒有重複');
    for (const removed of ['start_up', 'function', 'serial_write', 'esp8266_sendtoifttt']) t.notOk(blocks.some(b => b.opcode === removed), `不做 ${removed}`);
    t.end();
});

// ---------- 2026-11-16 使用者實測後的調整 ----------
test('腳位選單：數位 D2、PWM 腳位 D3(PWM)、類比 A0；值不變（舊作品照常可用）', t => {
    const {ext} = makeExt();
    const {menus} = ext.getInfo();
    const label = (menu, value) => menus[menu].items.find(i => i.value === value).text;
    t.equal(label('digitalPins', '2'), 'D2');
    t.equal(label('digitalPins', '3'), 'D3(PWM)');
    t.equal(label('digitalPins', '13'), 'D13');
    t.equal(label('pwmPins', '9'), 'D9(PWM)');
    t.equal(label('analogPins', '0'), 'A0');
    t.equal(label('anyPins', 'A5'), 'A5');
    t.equal(label('allPins', '11'), 'D11(PWM)');
    t.equal(label('allPins', '14'), 'A0');
    t.equal(label('allPins', '19'), 'A5');
    t.ok(menus.digitalPins.items.every(i => /^D\d+(\(PWM\))?$/.test(i.text)));
    t.end();
});

test('與其他積木重複的 7 個積木與「腳位模式設為」不顯示在積木區，但舊作品仍可執行', t => {
    const {ext} = makeExt();
    const blocks = ext.getInfo().blocks.filter(b => b !== '---');
    const hidden = blocks.filter(b => b.hideFromPalette).map(b => b.opcode).sort();
    t.same(hidden, ['buzzerBeep', 'ledBlink', 'ledOff', 'ledOn', 'pinMode', 'readAuto', 'rgbSet', 'servoSweep']);
    for (const op of hidden) t.equal(typeof ext[op], 'function', `${op} 仍可執行`);
    t.end();
});

test('LED 矩陣圖案用 8×8 點選欄位；64 個 0／1 或舊的文字格式都能用', async t => {
    const ArgumentType = require('../../src/extension-support/argument-type');
    const {ext, sent} = makeExt();
    const block = ext.getInfo().blocks.find(b => b.opcode === 'matrixPattern');
    t.equal(block.arguments.PATTERN.type, ArgumentType.CAMP_MATRIX8);
    t.equal(block.arguments.PATTERN.defaultValue, parts.SMILEY);
    t.match(parts.SMILEY, /^[01]{64}$/);
    await ext.matrixSetup({DIN: '12', CS: '10', CLK: '11'});
    await ext.matrixPattern({PATTERN: '1'.repeat(8) + '0'.repeat(56)});
    t.equal(ext.matrix.rows[0], 255);
    t.equal(ext.matrix.rows[1], 0);
    await ext.matrixPattern({PATTERN: '00000001 00000000'});
    t.equal(ext.matrix.rows[0], 1);
    t.ok(sent.length > 0);
    t.end();
});

test('執行環境把 8×8 矩陣參數轉成 camp_matrix8 shadow 積木', t => {
    const Runtime = require('../../src/engine/runtime');
    const ArgumentType = require('../../src/extension-support/argument-type');
    const rt = new Runtime();
    const {ext} = makeExt();
    rt._registerExtensionPrimitives(ext.getInfo());
    const cat = rt._blockInfo.find(c => c.id === 'camparduino');
    const b = cat.blocks.find(x => x.info && x.info.opcode === 'matrixPattern');
    t.match(b.xml, /<shadow type="camp_matrix8"><field name="MATRIX">0011110001000010/);
    t.ok(ArgumentType.CAMP_MATRIX8);
    t.end();
});

test('韌體版本：舊版營隊韌體提示更新', t => {
    const {campFirmwareOutdated} = require('../../src/extensions/scratch3_camparduino/index');
    t.ok(campFirmwareOutdated('CampFirmata.ino 2.5'), '1.0 回報的是檔名與 Firmata 版本');
    t.ok(campFirmwareOutdated('CampFirmata 1.0'));
    t.notOk(campFirmwareOutdated('CampFirmata 1.1'));
    t.notOk(campFirmwareOutdated('CampFirmata 2.0'));
    t.notOk(campFirmwareOutdated('StandardFirmata.ino 2.5'), '不是營隊韌體由積木各自提示');
    t.notOk(campFirmwareOutdated(''));
    t.end();
});
