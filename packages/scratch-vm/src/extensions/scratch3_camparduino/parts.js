/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * Arduino 擴展的更多零件（2026-11-11 使用者指定，功能參考 qblock，積木文字與程式為營隊自行撰寫）：
 * 按鈕、蜂鳴器音調、超音波、DHT11 溫溼度、脈衝寬度、MAX7219 LED 矩陣、1602 LCD（I2C）、WS2812 燈條、
 * 藍牙模組（軟體序列埠），以及限制範圍、文字／數字／ASCII 轉換。
 *
 * - 音調、超音波、DHT11、脈衝寬度、WS2812、LED 矩陣需要營隊韌體（CampFirmata）；板子上還是舊的
 *   StandardFirmata 時，提示學員重新燒錄。
 * - LCD 用 StandardFirmata 原本就有的 I2C；藍牙用 Firmata 標準的軟體序列埠。
 * 這裡的方法會掛到 Scratch3CampArduinoBlocks 上（見 index.js），所以 this 是擴展本身。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const {MODE, ANALOG_PIN_OFFSET, CAMP, SW_SERIAL0, encode} = require('./firmata');
const ui = require('./ui');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const DIGITAL_PINS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/** 數位腳位加上 A0–A5（當數位腳位用時是 14–19）。 */
const ALL_PINS = [...DIGITAL_PINS, 14, 15, 16, 17, 18, 19];
const PWM_PINS = [3, 5, 6, 9, 10, 11];
/** 選單上的腳位名稱：數位腳位 D2、可輸出 PWM 的 D3(PWM)、類比腳位 A0（值不變，舊作品照常可用）。 */
const pinLabel = p => (p >= ANALOG_PIN_OFFSET ? `A${p - ANALOG_PIN_OFFSET}` : PWM_PINS.includes(p) ? `D${p}(PWM)` : `D${p}`);
const BUTTONS = [1, 2, 3, 4];
const MAX_PIXELS = 60;
const DHT_CACHE_MS = 2000;
/** 超音波測不到（太遠或沒接好）時的值，公分。 */
const SONAR_NO_ECHO = 999;
const SONAR_TIMEOUT_US = 25000;
const MAX_PULSE_TIMEOUT_US = 250000;
const BT_BUFFER_MAX = 1024;

/** LED 矩陣預設圖案（笑臉）：64 個 0／1，每 8 個一個橫排，由上到下。 */
const SMILEY = '0011110001000010101001011000000110100101100110010100001000111100';

const NOTES = [
    ['低音 Sol', 196], ['低音 La', 220], ['低音 Si', 247],
    ['Do', 262], ['Re', 294], ['Mi', 330], ['Fa', 349], ['Sol', 392], ['La', 440], ['Si', 494],
    ['高音 Do', 523], ['高音 Re', 587], ['高音 Mi', 659], ['高音 Fa', 698], ['高音 Sol', 784], ['高音 La', 880], ['高音 Si', 988]
];

const PIXEL_COLORS = {
    red: [255, 0, 0], orange: [255, 90, 0], yellow: [255, 200, 0], green: [0, 255, 0], cyan: [0, 255, 255],
    blue: [0, 0, 255], purple: [160, 0, 255], pink: [255, 60, 150], white: [255, 255, 255], off: [0, 0, 0]
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const byte = v => clamp(Math.round(Cast.toNumber(v)), 0, 255);

/** 色相（0–360）轉 RGB（飽和度、亮度皆最大）。 */
const hueToRgb = hue => {
    const h = (((hue % 360) + 360) % 360) / 60;
    const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
    const table = [[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]];
    return table[Math.floor(h) % 6];
};

// ------------------------------------------------------------------ 1602 LCD（PCF8574 轉接板）
// 轉接板的 8 個輸出：P0 = RS、P1 = RW、P2 = EN、P3 = 背光、P4–P7 = D4–D7（最常見的接法）
const LCD_RS = 0x01;
const LCD_EN = 0x04;
const LCD_BACKLIGHT = 0x08;

/** 一個位元組拆成兩個 4 位元送出，每次都要拉一下 EN。 */
const lcdBytes = (value, rs) => {
    const out = [];
    for (const nibble of [value & 0xF0, (value << 4) & 0xF0]) {
        const base = nibble | LCD_BACKLIGHT | (rs ? LCD_RS : 0);
        out.push(base | LCD_EN, base);
    }
    return out;
};

/** LCD 只能顯示 ASCII；其他字（例如中文）換成 ?，並補滿或截成 16 個字。 */
const lcdText = text => Array.from(String(text))
    .map(c => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '?'))
    .join('')
    .slice(0, 16)
    .padEnd(16, ' ');

// ------------------------------------------------------------------ 積木

/**
 * @param {object} h - 建積木參數的小工具（index.js 提供）
 * @returns {Array<object|string>} 積木
 */
function partBlocks (h) {
    const {pin, num, text} = h;
    const menuArg = (menu, def) => ({type: ArgumentType.STRING, menu, defaultValue: String(def)});
    return [
        '---',
        // ---- 按鈕 ----
        {opcode: 'buttonSetup', blockType: BlockType.COMMAND, text: '按鈕 [BUTTON] 接在腳位 [PIN]', arguments: {BUTTON: menuArg('buttons', 1), PIN: pin('allPins', 2)}},
        {opcode: 'buttonPressed', blockType: BlockType.BOOLEAN, text: '按鈕 [BUTTON] 被按下？', arguments: {BUTTON: menuArg('buttons', 1)}},
        '---',
        // ---- 蜂鳴器音調 ----
        {opcode: 'toneFor', blockType: BlockType.COMMAND, text: '蜂鳴器（腳位 [PIN]）播放 [NOTE] [MS] 毫秒', arguments: {PIN: pin('digitalPins', 8), NOTE: menuArg('notes', 262), MS: num(500)}},
        {opcode: 'toneOn', blockType: BlockType.COMMAND, text: '蜂鳴器（腳位 [PIN]）一直播放 [NOTE]', arguments: {PIN: pin('digitalPins', 8), NOTE: menuArg('notes', 262)}},
        {opcode: 'toneOff', blockType: BlockType.COMMAND, text: '蜂鳴器（腳位 [PIN]）停止播放', arguments: {PIN: pin('digitalPins', 8)}},
        '---',
        // ---- 感測器 ----
        {opcode: 'sonarDistance', blockType: BlockType.REPORTER, text: '超音波距離（公分）Trig 腳位 [TRIG] Echo 腳位 [ECHO]', arguments: {TRIG: pin('allPins', 14), ECHO: pin('allPins', 15)}},
        {opcode: 'dhtRead', blockType: BlockType.REPORTER, text: '溫溼度感測器 DHT11（腳位 [PIN]）的 [WHAT]', arguments: {PIN: pin('allPins', 4), WHAT: menuArg('dhtValues', 'tempC')}},
        {opcode: 'pulseWidth', blockType: BlockType.REPORTER, text: '腳位 [PIN] 的 [LEVEL] 脈衝寬度（微秒），最多等 [TIMEOUT] 微秒', arguments: {PIN: pin('allPins', 7), LEVEL: menuArg('levels', 1), TIMEOUT: num(20000)}},
        '---',
        // ---- LED 矩陣（MAX7219） ----
        {opcode: 'matrixSetup', blockType: BlockType.COMMAND, text: 'LED 矩陣接在腳位 DIN [DIN] CS [CS] CLK [CLK]', arguments: {DIN: pin('allPins', 12), CS: pin('allPins', 10), CLK: pin('allPins', 11)}},
        {opcode: 'matrixPattern', blockType: BlockType.COMMAND, text: 'LED 矩陣顯示圖案 [PATTERN]', arguments: {PATTERN: {type: ArgumentType.CAMP_MATRIX8, defaultValue: SMILEY}}},
        {opcode: 'matrixRow', blockType: BlockType.COMMAND, text: 'LED 矩陣第 [ROW] 橫排設為 [VALUE]（0–255）', arguments: {ROW: menuArg('eight', 1), VALUE: num(255)}},
        {opcode: 'matrixColumn', blockType: BlockType.COMMAND, text: 'LED 矩陣第 [COL] 直排設為 [VALUE]（0–255）', arguments: {COL: menuArg('eight', 1), VALUE: num(255)}},
        {opcode: 'matrixDot', blockType: BlockType.COMMAND, text: 'LED 矩陣第 [ROW] 橫排第 [COL] 個點 [STATE]', arguments: {ROW: menuArg('eight', 1), COL: menuArg('eight', 1), STATE: menuArg('onOff', 'on')}},
        '---',
        // ---- 1602 LCD ----
        {opcode: 'lcdSetup', blockType: BlockType.COMMAND, text: '1602 LCD 的 I2C 位址設為 [ADDRESS]', arguments: {ADDRESS: text('0x27')}},
        {opcode: 'lcdPrint', blockType: BlockType.COMMAND, text: '1602 LCD 的 [LINE] 顯示 [TEXT]', arguments: {LINE: menuArg('lcdLines', 1), TEXT: text('Hello!')}},
        '---',
        // ---- WS2812 燈條 ----
        {opcode: 'pixelSetup', blockType: BlockType.COMMAND, text: '燈條（WS2812）接在腳位 [PIN]，共 [COUNT] 顆', arguments: {PIN: pin('allPins', 6), COUNT: num(16)}},
        {opcode: 'pixelClear', blockType: BlockType.COMMAND, text: '燈條全部熄滅'},
        {opcode: 'pixelColor', blockType: BlockType.COMMAND, text: '燈條第 [N] 顆設為 [COLOR]，亮度 [LEVEL]', arguments: {N: num(1), COLOR: menuArg('pixelColors', 'red'), LEVEL: num(255)}},
        {opcode: 'pixelRgb', blockType: BlockType.COMMAND, text: '燈條第 [N] 顆設為 紅 [R] 綠 [G] 藍 [B]', arguments: {N: num(1), R: num(255), G: num(0), B: num(0)}},
        {opcode: 'pixelAll', blockType: BlockType.COMMAND, text: '燈條全部設為 紅 [R] 綠 [G] 藍 [B]', arguments: {R: num(0), G: num(0), B: num(255)}},
        {opcode: 'pixelBrightness', blockType: BlockType.COMMAND, text: '燈條亮度設為 [LEVEL]（0–255）', arguments: {LEVEL: num(128)}},
        {opcode: 'pixelRainbow', blockType: BlockType.COMMAND, text: '燈條彩虹效果，起始色相 [HUE] 方向 [DIRECTION]', arguments: {HUE: num(0), DIRECTION: menuArg('rainbowDirections', 'forward')}},
        '---',
        // ---- 藍牙模組 ----
        {opcode: 'btSetup', blockType: BlockType.COMMAND, text: '藍牙模組接在腳位 RX [RX] TX [TX]，鮑率 [BAUD]', arguments: {RX: pin('allPins', 10), TX: pin('allPins', 11), BAUD: menuArg('bauds', 9600)}},
        {opcode: 'btAvailable', blockType: BlockType.REPORTER, text: '藍牙收到的位元組數'},
        {opcode: 'btRead', blockType: BlockType.REPORTER, text: '從藍牙讀取文字'},
        {opcode: 'btWrite', blockType: BlockType.COMMAND, text: '傳送 [TEXT] 到藍牙', arguments: {TEXT: text('hello')}}
    ];
}

/** 放在「感測輔助」後面的計算積木。 */
function mathBlocks (h) {
    const {num, text} = h;
    return [
        {opcode: 'constrainValue', blockType: BlockType.REPORTER, text: '把 [VALUE] 限制在 [MIN] 到 [MAX] 之間', arguments: {VALUE: num(150), MIN: num(0), MAX: num(100)}},
        {opcode: 'textToNumber', blockType: BlockType.REPORTER, text: '把文字 [TEXT] 轉成 [TYPE]', arguments: {TEXT: text('123'), TYPE: {type: ArgumentType.STRING, menu: 'numberTypes', defaultValue: 'int'}}},
        {opcode: 'codeToChar', blockType: BlockType.REPORTER, text: 'ASCII 數值 [CODE] 轉成字元', arguments: {CODE: num(65)}},
        {opcode: 'charToCode', blockType: BlockType.REPORTER, text: '字元 [CHAR] 轉成 ASCII 數值', arguments: {CHAR: text('A')}}
    ];
}

const items = list => list.map(([text, value]) => ({text, value: String(value)}));

const PART_MENUS = {
    allPins: {acceptReporters: true, items: ALL_PINS.map(p => ({text: pinLabel(p), value: String(p)}))},
    buttons: {acceptReporters: true, items: items(BUTTONS.map(b => [String(b), b]))},
    notes: {acceptReporters: true, items: items(NOTES.map(([name, f]) => [`${name}（${f}）`, f]))},
    dhtValues: {acceptReporters: false, items: items([['溫度（°C）', 'tempC'], ['溫度（°F）', 'tempF'], ['濕度（%）', 'humidity']])},
    eight: {acceptReporters: true, items: items([1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), n]))},
    onOff: {acceptReporters: false, items: items([['亮', 'on'], ['滅', 'off']])},
    lcdLines: {acceptReporters: false, items: items([['第一行', 1], ['第二行', 2]])},
    pixelColors: {acceptReporters: false, items: items([['紅', 'red'], ['橙', 'orange'], ['黃', 'yellow'], ['綠', 'green'], ['青', 'cyan'], ['藍', 'blue'], ['紫', 'purple'], ['粉紅', 'pink'], ['白', 'white'], ['熄滅', 'off']])},
    rainbowDirections: {acceptReporters: false, items: items([['正向', 'forward'], ['反向', 'backward']])},
    bauds: {acceptReporters: true, items: items([['9600', 9600], ['19200', 19200], ['38400', 38400], ['57600', 57600]])},
    numberTypes: {acceptReporters: false, items: items([['整數', 'int'], ['小數', 'float']])}
};

// ------------------------------------------------------------------ 狀態

function initParts (ext) {
    ext.buttons = new Map();
    ext.matrix = null; // {rows: number[8]}
    ext.lcd = null; // {address}
    ext.pixels = null; // {count}
    ext.btBuffer = [];
    ext.btReady = false;
    ext.dhtCache = new Map();
    ext.dhtPending = new Map();
    ext.pending = new Map(); // reqId → resolve
    ext.nextReqId = 1;
    ext.campWarned = false;
}

/** 解碼器的回呼（index.js 合併進 FirmataParser 的 handlers）。 */
function partHandlers (ext) {
    return {
        onCampPulse: (command, reqId, us) => ext._resolveRequest(reqId, us),
        onCampDht: (reqId, status, values) => ext._resolveRequest(reqId, {status, values}),
        onSerial: (port, bytes) => {
            if (port !== SW_SERIAL0) return;
            ext.btBuffer.push(...bytes);
            if (ext.btBuffer.length > BT_BUFFER_MAX) ext.btBuffer.splice(0, ext.btBuffer.length - BT_BUFFER_MAX);
        }
    };
}

// ------------------------------------------------------------------ 方法

const PartMethods = {
    _resetParts () {
        for (const resolve of this.pending.values()) resolve(null);
        initParts(this);
    },

    /** 板子上是不是營隊韌體（CampFirmata）。不是的話提示重新燒錄（只提示一次）。 */
    _requireCamp () {
        if (!this.connected) return false;
        if (/CampFirmata/i.test(this.firmware)) return true;
        if (!this.campWarned) {
            this.campWarned = true;
            ui.show('這個積木需要新版的韌體。\n請點「燒錄 Firmata 韌體」重新燒錄一次（約 30 秒），再試一次', {kind: 'error'});
        }
        return false;
    },

    _allPin (value) {
        const t = String(value).trim();
        if (/^A[0-5]$/i.test(t)) return ANALOG_PIN_OFFSET + Number(t[1]);
        const pin = Math.round(Cast.toNumber(value));
        return ALL_PINS.includes(pin) ? pin : null;
    },

    /** 送出一個要等板子回覆的指令；逾時回傳 null。 */
    _request (build, timeoutMs) {
        const id = this.nextReqId;
        this.nextReqId = (this.nextReqId % 127) + 1;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(null);
            }, timeoutMs);
            this.pending.set(id, value => {
                clearTimeout(timer);
                this.pending.delete(id);
                resolve(value);
            });
            this._send(build(id)).then(ok => {
                if (!ok && this.pending.has(id)) this.pending.get(id)(null);
            });
        });
    },

    _resolveRequest (id, value) {
        const resolve = this.pending.get(id);
        if (resolve) resolve(value);
    },

    // ---------------- 按鈕 ----------------

    async buttonSetup (args) {
        const button = Math.round(Cast.toNumber(args.BUTTON));
        const pin = this._allPin(args.PIN);
        if (!this.connected || !BUTTONS.includes(button) || pin === null) return;
        this.buttons.set(button, pin);
        this.pinModes.delete(pin);
        await this._ensureMode(pin, MODE.PULLUP);
        // A0–A5 在埠 1、2；確保該埠有回報
        await this._send(encode.reportDigitalPort(pin >> 3, true));
    },

    /** 按鈕一腳接腳位、一腳接 GND（上拉輸入）：按下時讀到 0。 */
    buttonPressed (args) {
        const pin = this.buttons.get(Math.round(Cast.toNumber(args.BUTTON)));
        if (!this.connected || pin === undefined) return false;
        return this._digitalValue(pin) === 0;
    },

    // ---------------- 蜂鳴器音調 ----------------

    _toneArgs (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        const freq = clamp(Math.round(Cast.toNumber(args.NOTE)), 31, 20000);
        return {pin, freq};
    },

    async toneFor (args) {
        const {pin, freq} = this._toneArgs(args);
        if (pin === null || !this._requireCamp()) return;
        const ms = clamp(Math.round(Cast.toNumber(args.MS)), 0, 10000);
        if (!ms) return;
        // 韌體播完會把腳位改回不輸出（低電位觸發的蜂鳴器模組才不會一直通電）；下次用這支腳時要重新送模式
        this.pinModes.delete(pin);
        await this._send(encode.campTone(pin, freq, ms));
        await sleep(ms); // 等這個音播完再往下，排旋律才會對
    },

    async toneOn (args) {
        const {pin, freq} = this._toneArgs(args);
        if (pin === null || !this._requireCamp()) return;
        this.pinModes.delete(pin);
        this.tonePin = pin;
        await this._send(encode.campTone(pin, freq, 0));
    },

    async toneOff (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (pin === null || !this._requireCamp()) return;
        if (this.tonePin === pin) this.tonePin = null;
        this.pinModes.delete(pin);
        await this._send(encode.campTone(pin, 0, 0));
    },

    // ---------------- 感測器 ----------------

    async sonarDistance (args) {
        const trig = this._allPin(args.TRIG);
        const echo = this._allPin(args.ECHO);
        if (trig === null || echo === null || trig === echo || !this._requireCamp()) return 0;
        this.pinModes.set(trig, MODE.OUTPUT);
        this.pinModes.set(echo, MODE.INPUT);
        const us = await this._request(id => encode.campSonar(id, trig, echo, SONAR_TIMEOUT_US), 500);
        if (!us) return SONAR_NO_ECHO;
        return Math.round(us / 58 * 10) / 10;
    },

    async dhtRead (args) {
        const pin = this._allPin(args.PIN);
        if (pin === null || !this._requireCamp()) return '';
        let entry = this.dhtCache.get(pin);
        if (!entry || Date.now() - entry.at > DHT_CACHE_MS) {
            // DHT11 一秒最多讀一次；同時有多個積木在讀時共用同一次
            if (!this.dhtPending.has(pin)) {
                this.pinModes.set(pin, MODE.INPUT);
                this.dhtPending.set(pin, this._request(id => encode.campDht11(id, pin), 1000).finally(() => this.dhtPending.delete(pin)));
            }
            const reply = await this.dhtPending.get(pin);
            if (reply && reply.status === 0) {
                const [hum, humDec, temp, tempDec] = reply.values;
                entry = {at: Date.now(), humidity: hum + (humDec / 10), tempC: temp + (tempDec / 10)};
                this.dhtCache.set(pin, entry);
            } else {
                ui.show(`讀不到溫溼度感測器（腳位 ${pin >= ANALOG_PIN_OFFSET ? `A${pin - ANALOG_PIN_OFFSET}` : pin}）。\n請檢查接線：VCC 接 5V、GND 接 GND、DATA 接這個腳位`, {kind: 'error'});
                return '';
            }
        }
        if (args.WHAT === 'humidity') return entry.humidity;
        if (args.WHAT === 'tempF') return Math.round((entry.tempC * 9 / 5 + 32) * 10) / 10;
        return entry.tempC;
    },

    async pulseWidth (args) {
        const pin = this._allPin(args.PIN);
        if (pin === null || !this._requireCamp()) return 0;
        const timeout = clamp(Math.round(Cast.toNumber(args.TIMEOUT)), 1, MAX_PULSE_TIMEOUT_US);
        const level = Cast.toBoolean(args.LEVEL) && String(args.LEVEL) !== '0';
        this.pinModes.set(pin, MODE.INPUT);
        const us = await this._request(id => encode.campPulseIn(id, pin, level, timeout), Math.ceil(timeout / 1000) + 500);
        return us || 0;
    },

    // ---------------- LED 矩陣 ----------------

    async matrixSetup (args) {
        const din = this._allPin(args.DIN);
        const cs = this._allPin(args.CS);
        const clk = this._allPin(args.CLK);
        if (din === null || cs === null || clk === null || new Set([din, cs, clk]).size < 3 || !this._requireCamp()) return;
        for (const p of [din, cs, clk]) this.pinModes.set(p, MODE.OUTPUT);
        this.matrix = {rows: new Array(8).fill(0)};
        await this._send(encode.matrixConfig(din, cs, clk));
    },

    _matrixReady () {
        if (!this._requireCamp()) return false;
        if (!this.matrix) {
            ui.show('請先用「LED 矩陣接在腳位 …」設定矩陣的腳位', {kind: 'error'});
            return false;
        }
        return true;
    },

    async _matrixFlush (rows) {
        const bytes = [];
        for (const r of rows) bytes.push(...encode.matrixRow(r, this.matrix.rows[r]));
        await this._send(bytes);
    },

    _eight (value) {
        const n = Math.round(Cast.toNumber(value));
        return n >= 1 && n <= 8 ? n - 1 : null;
    },

    /** 圖案：64 個 0／1（其他字元會略過），每 8 個是一個橫排，由上到下、由左到右。 */
    async matrixPattern (args) {
        if (!this._matrixReady()) return;
        const bits = String(args.PATTERN).replace(/[^01]/g, '').padEnd(64, '0').slice(0, 64);
        for (let r = 0; r < 8; r++) this.matrix.rows[r] = parseInt(bits.slice(r * 8, r * 8 + 8), 2);
        await this._matrixFlush([0, 1, 2, 3, 4, 5, 6, 7]);
    },

    /** 橫排的值：最高位元（128）是最左邊的點。 */
    async matrixRow (args) {
        const r = this._eight(args.ROW);
        if (r === null || !this._matrixReady()) return;
        this.matrix.rows[r] = byte(args.VALUE);
        await this._matrixFlush([r]);
    },

    /** 直排的值：最高位元（128）是最上面的點。 */
    async matrixColumn (args) {
        const c = this._eight(args.COL);
        if (c === null || !this._matrixReady()) return;
        const value = byte(args.VALUE);
        const mask = 0x80 >> c;
        for (let r = 0; r < 8; r++) {
            if (value & (0x80 >> r)) this.matrix.rows[r] |= mask;
            else this.matrix.rows[r] &= ~mask;
        }
        await this._matrixFlush([0, 1, 2, 3, 4, 5, 6, 7]);
    },

    async matrixDot (args) {
        const r = this._eight(args.ROW);
        const c = this._eight(args.COL);
        if (r === null || c === null || !this._matrixReady()) return;
        const mask = 0x80 >> c;
        if (args.STATE === 'off') this.matrix.rows[r] &= ~mask;
        else this.matrix.rows[r] |= mask;
        await this._matrixFlush([r]);
    },

    // ---------------- 1602 LCD ----------------

    async lcdSetup (args) {
        if (!this.connected) return;
        const t = String(args.ADDRESS).trim();
        const address = /^0x/i.test(t) ? parseInt(t, 16) : Math.round(Cast.toNumber(t));
        if (!(address >= 0x03 && address <= 0x77)) {
            ui.show('LCD 的 I2C 位址不正確，常見的是 0x27 或 0x3F', {kind: 'error'});
            return;
        }
        this.lcd = {address};
        await this._send(encode.i2cConfig());
        await sleep(50);
        // 依 HD44780 資料手冊：先送三次 0x3，再切成 4 位元模式
        const nibble = v => [v | LCD_BACKLIGHT | LCD_EN, v | LCD_BACKLIGHT];
        await this._send(encode.i2cWrite(address, nibble(0x30)));
        await sleep(5);
        await this._send(encode.i2cWrite(address, nibble(0x30)));
        await sleep(1);
        await this._send(encode.i2cWrite(address, [...nibble(0x30), ...nibble(0x20)]));
        await sleep(1);
        await this._send(encode.i2cWrite(address, [...lcdBytes(0x28, false), ...lcdBytes(0x0C, false), ...lcdBytes(0x06, false), ...lcdBytes(0x01, false)]));
        await sleep(3); // 清除畫面要 1.5 毫秒以上
    },

    async lcdPrint (args) {
        if (!this.connected) return;
        if (!this.lcd) {
            ui.show('請先用「1602 LCD 的 I2C 位址設為 …」設定 LCD', {kind: 'error'});
            return;
        }
        const line = String(args.LINE) === '2' ? 1 : 0;
        const bytes = [...lcdBytes(0x80 | (line ? 0x40 : 0x00), false)];
        for (const c of lcdText(args.TEXT)) bytes.push(...lcdBytes(c.charCodeAt(0), true));
        await this._send(encode.i2cWrite(this.lcd.address, bytes));
    },

    // ---------------- WS2812 燈條 ----------------

    async pixelSetup (args) {
        const pin = this._allPin(args.PIN);
        if (pin === null || !this._requireCamp()) return;
        const count = clamp(Math.round(Cast.toNumber(args.COUNT)), 1, MAX_PIXELS);
        if (Cast.toNumber(args.COUNT) > MAX_PIXELS) ui.show(`燈條最多 ${MAX_PIXELS} 顆（Arduino Uno 的記憶體限制）`, {autoHideMs: 4000});
        this.pinModes.set(pin, MODE.OUTPUT);
        this.pixels = {count};
        await this._send(encode.pixelConfig(pin, count));
    },

    _pixelReady () {
        if (!this._requireCamp()) return false;
        if (!this.pixels) {
            ui.show('請先用「燈條（WS2812）接在腳位 …」設定燈條', {kind: 'error'});
            return false;
        }
        return true;
    },

    /** 第幾顆（從 1 開始）→ 燈條上的編號（從 0 開始）；超出範圍回傳 null。 */
    _pixelIndex (value) {
        const n = Math.round(Cast.toNumber(value));
        return n >= 1 && n <= this.pixels.count ? n - 1 : null;
    },

    async pixelClear () {
        if (!this._pixelReady()) return;
        await this._send(encode.pixelClear());
    },

    async pixelColor (args) {
        if (!this._pixelReady()) return;
        const i = this._pixelIndex(args.N);
        const color = PIXEL_COLORS[args.COLOR];
        if (i === null || !color) return;
        const level = byte(args.LEVEL) / 255;
        await this._send([...encode.pixelSet(i, ...color.map(c => Math.round(c * level))), ...encode.pixelShow()]);
    },

    async pixelRgb (args) {
        if (!this._pixelReady()) return;
        const i = this._pixelIndex(args.N);
        if (i === null) return;
        await this._send([...encode.pixelSet(i, byte(args.R), byte(args.G), byte(args.B)), ...encode.pixelShow()]);
    },

    async pixelAll (args) {
        if (!this._pixelReady()) return;
        await this._send([...encode.pixelFill(byte(args.R), byte(args.G), byte(args.B)), ...encode.pixelShow()]);
    },

    async pixelBrightness (args) {
        if (!this._pixelReady()) return;
        await this._send([...encode.pixelBrightness(byte(args.LEVEL)), ...encode.pixelShow()]);
    },

    async pixelRainbow (args) {
        if (!this._pixelReady()) return;
        const start = Cast.toNumber(args.HUE);
        const step = 360 / this.pixels.count * (args.DIRECTION === 'backward' ? -1 : 1);
        const bytes = [];
        for (let i = 0; i < this.pixels.count; i++) bytes.push(...encode.pixelSet(i, ...hueToRgb(start + (step * i))));
        bytes.push(...encode.pixelShow());
        await this._send(bytes);
    },

    // ---------------- 藍牙模組 ----------------

    /** RX、TX 是 Arduino 這一端：藍牙模組的 TXD 接 RX 腳位、RXD 接 TX 腳位。 */
    async btSetup (args) {
        const rx = this._allPin(args.RX);
        const tx = this._allPin(args.TX);
        const baud = Math.round(Cast.toNumber(args.BAUD));
        if (!this.connected || rx === null || tx === null || rx === tx || !(baud >= 300 && baud <= 57600)) return;
        this.pinModes.set(rx, MODE.INPUT);
        this.pinModes.set(tx, MODE.OUTPUT);
        this.btBuffer = [];
        if (this.btReady) await this._send(encode.serialClose());
        await this._send([...encode.serialConfig(baud, rx, tx), ...encode.serialReadContinuously()]);
        this.btReady = true;
    },

    _btCheck () {
        if (!this.connected) return false;
        if (!this.btReady) {
            ui.show('請先用「藍牙模組接在腳位 …」設定藍牙模組', {kind: 'error'});
            return false;
        }
        return true;
    },

    btAvailable () {
        return this.btBuffer.length;
    },

    /** 讀出目前收到的所有文字（UTF-8），讀完就清空。 */
    btRead () {
        if (!this.btBuffer.length) return '';
        const bytes = new Uint8Array(this.btBuffer);
        this.btBuffer = [];
        return new TextDecoder('utf-8').decode(bytes);
    },

    async btWrite (args) {
        if (!this._btCheck()) return;
        const bytes = Array.from(new TextEncoder().encode(Cast.toString(args.TEXT)));
        if (bytes.length) await this._send(encode.serialWrite(bytes));
    },

    // ---------------- 計算 ----------------

    constrainValue (args) {
        const v = Cast.toNumber(args.VALUE);
        const a = Cast.toNumber(args.MIN);
        const b = Cast.toNumber(args.MAX);
        return clamp(v, Math.min(a, b), Math.max(a, b));
    },

    /** 轉不出來時是 0。 */
    textToNumber (args) {
        const text = Cast.toString(args.TEXT).trim();
        const n = args.TYPE === 'float' ? parseFloat(text) : parseInt(text, 10);
        return Number.isFinite(n) ? n : 0;
    },

    codeToChar (args) {
        const code = Math.round(Cast.toNumber(args.CODE));
        return code >= 0 && code <= 255 ? String.fromCharCode(code) : '';
    },

    charToCode (args) {
        const text = Cast.toString(args.CHAR);
        return text.length ? text.charCodeAt(0) : 0;
    }
};

const encodeToneStop = pin => encode.campTone(pin, 0, 0);

module.exports = {pinLabel, PWM_PINS, SMILEY, encodeToneStop, partBlocks, mathBlocks, PART_MENUS, PartMethods, initParts, partHandlers, NOTES, SONAR_NO_ECHO, MAX_PIXELS, lcdBytes, lcdText, hueToRgb};
