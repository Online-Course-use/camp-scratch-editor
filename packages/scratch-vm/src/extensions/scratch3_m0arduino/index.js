/**
 * M0 實驗用：最小的 Arduino（StandardFirmata）擴展。
 *
 * 目的只有一個：驗證「跨來源 iframe 內的 WebSerial」＋「Firmata 協定」＋「Uno」能不能走通。
 * 不是正式版 —— 正式版會重寫（spec 7.5、7.7.7），並有完整的錯誤處理與繁中文案。
 *
 * 通訊：WebSerial，57600 baud，StandardFirmata。
 * 注意：Uno 在序列埠開啟時會自動重置（DTR），約需 2 秒才會送出 Firmata 版本。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');

const START_SYSEX = 0xF0;
const END_SYSEX = 0xF7;
const REPORT_VERSION = 0xF9;
const REPORT_FIRMWARE = 0x79;
const SET_PIN_MODE = 0xF4;
const SET_DIGITAL_PIN_VALUE = 0xF5;
const DIGITAL_MESSAGE = 0x90;
const ANALOG_MESSAGE = 0xE0;
const REPORT_ANALOG = 0xC0;
const REPORT_DIGITAL = 0xD0;

const MODE_INPUT = 0;
const MODE_OUTPUT = 1;
const MODE_ANALOG = 2;
const MODE_PULLUP = 11;

class Scratch3M0ArduinoBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.connected = false;
        this.status = '未連線';
        this.version = '';
        this.firmware = '';
        this.digital = new Array(16).fill(0);
        this.analog = new Array(6).fill(0);
        this._inputPins = new Set();
        this._cmd = null;
        this._data = [];
        this._sysex = null;
        this._onDisconnect = this._onDisconnect.bind(this);
    }

    getInfo () {
        const pins = [];
        for (let i = 2; i <= 13; i++) pins.push({text: String(i), value: String(i)});
        const apins = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((t, i) => ({text: t, value: String(i)}));
        return {
            id: 'm0arduino',
            name: 'M0 Arduino (Firmata)',
            blocks: [
                {opcode: 'connect', blockType: BlockType.COMMAND, text: '連接 Arduino'},
                {opcode: 'disconnect', blockType: BlockType.COMMAND, text: '中斷連接'},
                {opcode: 'isConnected', blockType: BlockType.BOOLEAN, text: '已連接 Arduino 嗎？'},
                {opcode: 'getStatus', blockType: BlockType.REPORTER, text: '連線狀態'},
                {opcode: 'getFirmware', blockType: BlockType.REPORTER, text: 'Firmata 韌體'},
                {
                    opcode: 'pinMode',
                    blockType: BlockType.COMMAND,
                    text: '腳位 [PIN] 模式設為 [MODE]',
                    arguments: {
                        PIN: {type: ArgumentType.STRING, menu: 'pins', defaultValue: '13'},
                        MODE: {type: ArgumentType.STRING, menu: 'modes', defaultValue: String(MODE_OUTPUT)}
                    }
                },
                {
                    opcode: 'digitalWrite',
                    blockType: BlockType.COMMAND,
                    text: '數位腳位 [PIN] 設為 [VALUE]',
                    arguments: {
                        PIN: {type: ArgumentType.STRING, menu: 'pins', defaultValue: '13'},
                        VALUE: {type: ArgumentType.STRING, menu: 'levels', defaultValue: '1'}
                    }
                },
                {
                    opcode: 'digitalRead',
                    blockType: BlockType.REPORTER,
                    text: '讀取數位腳位 [PIN]',
                    arguments: {PIN: {type: ArgumentType.STRING, menu: 'pins', defaultValue: '2'}}
                },
                {
                    opcode: 'analogRead',
                    blockType: BlockType.REPORTER,
                    text: '讀取類比腳位 [PIN]',
                    arguments: {PIN: {type: ArgumentType.STRING, menu: 'apins', defaultValue: '0'}}
                }
            ],
            menus: {
                pins: {acceptReporters: true, items: pins},
                apins: {acceptReporters: true, items: apins},
                modes: {
                    acceptReporters: false,
                    items: [
                        {text: '輸出', value: String(MODE_OUTPUT)},
                        {text: '輸入', value: String(MODE_INPUT)},
                        {text: '上拉輸入', value: String(MODE_PULLUP)}
                    ]
                },
                levels: {acceptReporters: false, items: [{text: '高', value: '1'}, {text: '低', value: '0'}]}
            }
        };
    }

    // ---- 連線 ----
    async connect () {
        if (this.connected) return;
        if (!('serial' in navigator)) {
            this.status = '錯誤：此瀏覽器不支援 WebSerial（請用 Chrome 或 Edge）';
            return;
        }
        try {
            this.status = '連線中…（請在跳出的視窗選擇 Arduino 連接埠）';
            this.port = await navigator.serial.requestPort();
            await this.port.open({baudRate: 57600});
            navigator.serial.addEventListener('disconnect', this._onDisconnect);
            this.writer = this.port.writable.getWriter();
            this.reader = this.port.readable.getReader();
            this._readLoop();
            this.status = '連線中…（等待 Arduino 重置後回報 Firmata 版本，最多 8 秒）';
            const deadline = Date.now() + 8000;
            let lastAsk = 0;
            while (!this.connected && Date.now() < deadline) {
                if (Date.now() - lastAsk > 1500) {
                    lastAsk = Date.now();
                    await this._write([REPORT_VERSION]);
                }
                await new Promise(r => setTimeout(r, 100));
            }
            if (!this.connected) {
                this.status = '錯誤：連上序列埠，但沒有收到 Firmata 回應（板子是否已燒錄 StandardFirmata？鮑率 57600）';
                await this._close();
                return;
            }
            await this._write([START_SYSEX, REPORT_FIRMWARE, END_SYSEX]);
            // 開啟數位埠回報（port 0 = 腳位 0–7，port 1 = 腳位 8–13）
            await this._write([REPORT_DIGITAL | 0, 1, REPORT_DIGITAL | 1, 1]);
            this.status = `已連線（Firmata ${this.version}）`;
        } catch (e) {
            this.status = `錯誤：${e && e.name ? e.name : ''} ${e && e.message ? e.message : e}`;
            await this._close();
        }
    }

    async disconnect () {
        await this._close();
        this.status = '未連線';
    }

    isConnected () {
        return this.connected;
    }

    getStatus () {
        return this.status;
    }

    getFirmware () {
        return this.firmware || this.version || '';
    }

    // ---- 腳位 ----
    pinMode (args) {
        const pin = Number(args.PIN);
        const mode = Number(args.MODE);
        if (!this.connected) return;
        if (mode === MODE_INPUT || mode === MODE_PULLUP) this._inputPins.add(pin);
        return this._write([SET_PIN_MODE, pin, mode]);
    }

    digitalWrite (args) {
        const pin = Number(args.PIN);
        if (!this.connected) return;
        // 沒設過模式就先設成輸出
        const pre = this._inputPins.has(pin) ? [] : [SET_PIN_MODE, pin, MODE_OUTPUT];
        return this._write([...pre, SET_DIGITAL_PIN_VALUE, pin, Number(args.VALUE) ? 1 : 0]);
    }

    digitalRead (args) {
        const pin = Number(args.PIN);
        if (!this.connected) return 0;
        if (!this._inputPins.has(pin)) {
            this._inputPins.add(pin);
            this._write([SET_PIN_MODE, pin, MODE_INPUT]);
        }
        return this.digital[pin] ? 1 : 0;
    }

    analogRead (args) {
        const a = Number(args.PIN);
        if (!this.connected) return 0;
        if (!this._analogOn) this._analogOn = new Set();
        if (!this._analogOn.has(a)) {
            this._analogOn.add(a);
            this._write([SET_PIN_MODE, 14 + a, MODE_ANALOG, REPORT_ANALOG | a, 1]);
        }
        return this.analog[a];
    }

    // ---- 低階 ----
    async _write (bytes) {
        if (!this.writer) return;
        try {
            await this.writer.write(new Uint8Array(bytes));
        } catch (e) {
            this.status = `錯誤：寫入失敗 ${e && e.message ? e.message : e}`;
            this.connected = false;
        }
    }

    async _readLoop () {
        try {
            for (;;) {
                const {value, done} = await this.reader.read();
                if (done) break;
                if (value) for (const b of value) this._feed(b);
            }
        } catch (e) {
            if (this.connected) this.status = `錯誤：讀取中斷 ${e && e.message ? e.message : e}`;
            this.connected = false;
        }
    }

    _feed (b) {
        if (this._sysex) {
            if (b === END_SYSEX) {
                this._onSysex(this._sysex);
                this._sysex = null;
            } else {
                this._sysex.push(b);
            }
            return;
        }
        if (b >= 0x80) {
            if (b === START_SYSEX) {
                this._sysex = [];
                this._cmd = null;
            } else {
                this._cmd = b;
                this._data = [];
            }
            return;
        }
        if (this._cmd === null) return;
        this._data.push(b);
        if (this._data.length >= 2) {
            this._onMessage(this._cmd, this._data);
            this._cmd = null;
            this._data = [];
        }
    }

    _onMessage (cmd, d) {
        if (cmd === REPORT_VERSION) {
            this.version = `${d[0]}.${d[1]}`;
            this.connected = true;
            return;
        }
        const type = cmd & 0xF0;
        const n = cmd & 0x0F;
        if (type === ANALOG_MESSAGE && n < 6) {
            this.analog[n] = d[0] | (d[1] << 7);
        } else if (type === DIGITAL_MESSAGE) {
            const mask = d[0] | (d[1] << 7);
            for (let i = 0; i < 8; i++) this.digital[n * 8 + i] = (mask >> i) & 1;
        }
    }

    _onSysex (data) {
        if (data[0] === REPORT_FIRMWARE) {
            let name = '';
            for (let i = 3; i + 1 < data.length; i += 2) name += String.fromCharCode(data[i] | (data[i + 1] << 7));
            this.firmware = `${name} ${data[1]}.${data[2]}`;
        }
    }

    _onDisconnect () {
        this.connected = false;
        this.status = '連線中斷（USB 被拔除或板子重置）';
    }

    async _close () {
        this.connected = false;
        try {
            navigator.serial.removeEventListener('disconnect', this._onDisconnect);
            if (this.reader) await this.reader.cancel().catch(() => {});
            if (this.reader) this.reader.releaseLock();
            if (this.writer) this.writer.releaseLock();
            if (this.port) await this.port.close().catch(() => {});
        } catch (e) {
            // 忽略
        }
        this.reader = null;
        this.writer = null;
        this.port = null;
        this._inputPins.clear();
        this._analogOn = null;
    }
}

module.exports = Scratch3M0ArduinoBlocks;
