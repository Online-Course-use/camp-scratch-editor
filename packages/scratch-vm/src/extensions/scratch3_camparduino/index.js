/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * 營隊 Arduino Uno 擴展：以 WebSerial 連線，使用 Firmata 協定；可在網頁內燒錄營隊韌體 CampFirmata
 * （StandardFirmata 2.5.9 加上自訂指令，見 packages/camp-host/firmware/）。更多零件的積木在 parts.js。
 * 營隊自行撰寫（AGPL-3.0）。規格見營隊平台 SPEC 7.5、7.7.7。
 *
 * 設計重點：
 * - 連線與燒錄都必須由使用者點擊積木觸發（瀏覽器要求手勢才能開連接埠選擇視窗），不能在綠旗時自動執行。
 * - 板子拔掉、通訊失敗時：回報「未連線」並停止程式，**不得讓編輯器當掉**；積木在未連線時一律安全地什麼都不做。
 */
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const {MODE, ANALOG_PIN_OFFSET, encode, FirmataParser} = require('./firmata');
const stk500 = require('./stk500');
const SerialLink = require('./serial');
const ui = require('./ui');
const parts = require('./parts');

const FIRMATA_BAUD = 57600;
const BOOTLOADER_BAUD = 115200;
// 營隊韌體：StandardFirmata 2.5.9 加上營隊的自訂指令（原始碼在 packages/camp-host/firmware/）
const FIRMWARE_URL = '/firmware/CampFirmata-1.1.0-uno.hex';
const FIRMWARE_VERSION_TEXT = 'CampFirmata 1.1';
// 板子上的營隊韌體低於這個版本就提示更新（1.0 回報的名稱是「CampFirmata.ino 2.5」，沒有自己的版號）
const FIRMWARE_MIN = [1, 1];

/** 韌體名稱是營隊韌體但版本太舊。不是營隊韌體（例如 StandardFirmata）時回傳 false，由用到的積木提示。 */
const campFirmwareOutdated = firmware => {
    if (!/CampFirmata/i.test(firmware)) return false;
    const m = /^CampFirmata (\d+)\.(\d+)$/.exec(firmware);
    if (!m) return true;
    const [major, minor] = [Number(m[1]), Number(m[2])];
    return major < FIRMWARE_MIN[0] || (major === FIRMWARE_MIN[0] && minor < FIRMWARE_MIN[1]);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const DIGITAL_PINS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const PWM_PINS = [3, 5, 6, 9, 10, 11];
const ANALOG_NAMES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

const COLORS = {
    red: [255, 0, 0],
    orange: [255, 90, 0],
    yellow: [255, 200, 0],
    green: [0, 255, 0],
    blue: [0, 0, 255],
    purple: [160, 0, 255],
    white: [255, 255, 255],
    off: [0, 0, 0]
};
/** 伺服馬達每轉 1 度等待的毫秒數。 */
const SWEEP_MS_PER_DEGREE = {slow: 25, medium: 10, fast: 4};

const pinItems = pins => pins.map(p => ({text: parts.pinLabel(p), value: String(p)}));

class Scratch3CampArduinoBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        this.link = null;
        this.connected = false;
        this.busy = false;
        this.status = '未連線';
        this.firmware = '';
        this.version = '';
        this.digital = [0, 0, 0]; // 每個埠一個位元遮罩
        this.analog = new Array(6).fill(0);
        this.pinModes = new Map();
        this.pinValues = new Map();
        this.analogReporting = new Set();
        this.servoPins = new Set();
        this.epoch = 0; // 按停止鍵時加 1，讓進行中的等待與迴圈中止
        this.parser = new FirmataParser({
            onVersion: (major, minor) => {
                this.version = `${major}.${minor}`;
            },
            onFirmware: (name, major, minor) => {
                this.firmware = `${name} ${major}.${minor}`;
            },
            onDigitalPort: (port, mask) => {
                if (port < this.digital.length) this.digital[port] = mask;
            },
            onAnalog: (channel, value) => {
                if (channel < this.analog.length) this.analog[channel] = value;
            },
            ...parts.partHandlers(this)
        });
        parts.initParts(this);
        if (runtime && runtime.on) {
            runtime.on('PROJECT_STOP_ALL', () => {
                this.epoch++;
                // 按停止時讓一直響的蜂鳴器停下來
                if (this.connected && this.tonePin !== undefined && this.tonePin !== null) {
                    this._send(parts.encodeToneStop(this.tonePin));
                    this.pinModes.delete(this.tonePin);
                    this.tonePin = null;
                }
            });
        }
    }

    getInfo () {
        const level = {type: ArgumentType.STRING, menu: 'levels', defaultValue: '1'};
        const pin = (menu, def) => ({type: ArgumentType.STRING, menu, defaultValue: String(def)});
        const num = def => ({type: ArgumentType.NUMBER, defaultValue: def});
        return {
            id: 'camparduino',
            name: 'Arduino Uno',
            blocks: [
                // ---- 連線 ----
                {opcode: 'connect', blockType: BlockType.COMMAND, text: '連接 Arduino'},
                {opcode: 'disconnect', blockType: BlockType.COMMAND, text: '中斷連接'},
                {opcode: 'isConnected', blockType: BlockType.BOOLEAN, text: '已連接 Arduino 嗎？'},
                {opcode: 'firmataVersion', blockType: BlockType.REPORTER, text: 'Firmata 版本'},
                {opcode: 'getStatus', blockType: BlockType.REPORTER, text: '連線狀態'},
                {opcode: 'flashFirmware', blockType: BlockType.COMMAND, text: '燒錄 Firmata 韌體（點一下積木）'},
                '---',
                // ---- 基本輸出入 ----
                {
                    opcode: 'pinMode',
                    hideFromPalette: true,
                    blockType: BlockType.COMMAND,
                    text: '腳位 [PIN] 模式設為 [MODE]',
                    arguments: {PIN: pin('digitalPins', 13), MODE: {type: ArgumentType.STRING, menu: 'modes', defaultValue: 'output'}}
                },
                {
                    opcode: 'digitalWrite',
                    blockType: BlockType.COMMAND,
                    text: '數位腳位 [PIN] 設為 [VALUE]',
                    arguments: {PIN: pin('digitalPins', 13), VALUE: level}
                },
                {
                    opcode: 'digitalRead',
                    blockType: BlockType.REPORTER,
                    text: '讀取數位腳位 [PIN]',
                    arguments: {PIN: pin('digitalPins', 2)}
                },
                {
                    opcode: 'analogRead',
                    blockType: BlockType.REPORTER,
                    text: '讀取類比腳位 [PIN]',
                    arguments: {PIN: pin('analogPins', 0)}
                },
                {
                    opcode: 'pwmWrite',
                    blockType: BlockType.COMMAND,
                    text: 'PWM 腳位 [PIN] 輸出 [VALUE]（0–255）',
                    arguments: {PIN: pin('pwmPins', 9), VALUE: num(128)}
                },
                {
                    opcode: 'readAuto',
                    hideFromPalette: true,
                    blockType: BlockType.REPORTER,
                    text: '讀取腳位 [PIN]（自動判斷）',
                    arguments: {PIN: pin('anyPins', 2)}
                },
                {
                    opcode: 'pinModeOf',
                    blockType: BlockType.REPORTER,
                    text: '腳位 [PIN] 的模式',
                    arguments: {PIN: pin('anyPins', 13)}
                },
                {
                    opcode: 'pinStateOf',
                    blockType: BlockType.REPORTER,
                    text: '腳位 [PIN] 的狀態',
                    arguments: {PIN: pin('anyPins', 13)}
                },
                '---',
                // ---- 常用零件 ----
                {opcode: 'ledOn', hideFromPalette: true, blockType: BlockType.COMMAND, text: '點亮 LED（腳位 [PIN]）', arguments: {PIN: pin('digitalPins', 13)}},
                {opcode: 'ledOff', hideFromPalette: true, blockType: BlockType.COMMAND, text: '熄滅 LED（腳位 [PIN]）', arguments: {PIN: pin('digitalPins', 13)}},
                {
                    opcode: 'ledBlink',
                    hideFromPalette: true,
                    blockType: BlockType.COMMAND,
                    text: 'LED（腳位 [PIN]）閃爍 [TIMES] 次，亮 [ON] 毫秒 滅 [OFF] 毫秒',
                    arguments: {PIN: pin('digitalPins', 13), TIMES: num(3), ON: num(300), OFF: num(300)}
                },
                {
                    opcode: 'buzzerBeep',
                    hideFromPalette: true,
                    blockType: BlockType.COMMAND,
                    text: '蜂鳴器（腳位 [PIN]）響 [MS] 毫秒',
                    arguments: {PIN: pin('digitalPins', 8), MS: num(500)}
                },
                {
                    opcode: 'servoWrite',
                    blockType: BlockType.COMMAND,
                    text: '伺服馬達（腳位 [PIN]）轉到 [ANGLE] 度',
                    arguments: {PIN: pin('digitalPins', 9), ANGLE: num(90)}
                },
                {
                    opcode: 'servoSweep',
                    hideFromPalette: true,
                    blockType: BlockType.COMMAND,
                    text: '伺服馬達（腳位 [PIN]）從 [FROM] 度轉到 [TO] 度，速度 [SPEED]',
                    arguments: {
                        PIN: pin('digitalPins', 9),
                        FROM: num(0),
                        TO: num(180),
                        SPEED: {type: ArgumentType.STRING, menu: 'sweepSpeeds', defaultValue: 'medium'}
                    }
                },
                {
                    opcode: 'rgbSet',
                    hideFromPalette: true,
                    blockType: BlockType.COMMAND,
                    text: 'RGB LED（紅 [R] 綠 [G] 藍 [B]）設為 [COLOR]',
                    arguments: {
                        R: pin('pwmPins', 9),
                        G: pin('pwmPins', 10),
                        B: pin('pwmPins', 11),
                        COLOR: {type: ArgumentType.STRING, menu: 'colors', defaultValue: 'red'}
                    }
                },
                {
                    opcode: 'motorRun',
                    blockType: BlockType.COMMAND,
                    text: '直流馬達（方向腳 [DIR] 速度腳 [PWM]）速度 [SPEED]％ 方向 [DIRECTION]',
                    arguments: {
                        DIR: pin('digitalPins', 4),
                        PWM: pin('pwmPins', 5),
                        SPEED: num(60),
                        DIRECTION: {type: ArgumentType.STRING, menu: 'directions', defaultValue: 'forward'}
                    }
                },
                {
                    opcode: 'motorStop',
                    blockType: BlockType.COMMAND,
                    text: '直流馬達（方向腳 [DIR] 速度腳 [PWM]）停止',
                    arguments: {DIR: pin('digitalPins', 4), PWM: pin('pwmPins', 5)}
                },
                ...parts.partBlocks({pin, num, text: def => ({type: ArgumentType.STRING, defaultValue: def})}),
                '---',
                // ---- 感測輔助 ----
                {
                    opcode: 'waitDigital',
                    blockType: BlockType.COMMAND,
                    text: '等待數位腳位 [PIN] 變成 [VALUE]',
                    arguments: {PIN: pin('digitalPins', 2), VALUE: level}
                },
                {
                    opcode: 'analogBetween',
                    blockType: BlockType.BOOLEAN,
                    text: '類比腳位 [PIN] 介於 [MIN] 與 [MAX] 之間嗎？',
                    arguments: {PIN: pin('analogPins', 0), MIN: num(0), MAX: num(512)}
                },
                {
                    opcode: 'mapValue',
                    blockType: BlockType.REPORTER,
                    text: '把 [VALUE] 從 [IN_MIN]–[IN_MAX] 對應到 [OUT_MIN]–[OUT_MAX]',
                    arguments: {VALUE: num(512), IN_MIN: num(0), IN_MAX: num(1023), OUT_MIN: num(0), OUT_MAX: num(255)}
                },
                ...parts.mathBlocks({num, text: def => ({type: ArgumentType.STRING, defaultValue: def})})
            ],
            menus: {
                digitalPins: {acceptReporters: true, items: pinItems(DIGITAL_PINS)},
                pwmPins: {acceptReporters: true, items: pinItems(PWM_PINS)},
                analogPins: {acceptReporters: true, items: ANALOG_NAMES.map((t, i) => ({text: t, value: String(i)}))},
                anyPins: {acceptReporters: true, items: [...pinItems(DIGITAL_PINS), ...ANALOG_NAMES.map(t => ({text: t, value: t}))]},
                modes: {
                    acceptReporters: false,
                    items: [{text: '輸出', value: 'output'}, {text: '輸入', value: 'input'}, {text: '上拉輸入', value: 'pullup'}]
                },
                levels: {acceptReporters: true, items: [{text: '高', value: '1'}, {text: '低', value: '0'}]},
                sweepSpeeds: {
                    acceptReporters: false,
                    items: [{text: '慢', value: 'slow'}, {text: '中', value: 'medium'}, {text: '快', value: 'fast'}]
                },
                colors: {
                    acceptReporters: false,
                    items: [
                        {text: '紅', value: 'red'}, {text: '橙', value: 'orange'}, {text: '黃', value: 'yellow'},
                        {text: '綠', value: 'green'}, {text: '藍', value: 'blue'}, {text: '紫', value: 'purple'},
                        {text: '白', value: 'white'}, {text: '關閉', value: 'off'}
                    ]
                },
                directions: {acceptReporters: false, items: [{text: '正轉', value: 'forward'}, {text: '反轉', value: 'backward'}]},
                ...parts.PART_MENUS
            }
        };
    }

    // ================= 連線 =================

    async connect () {
        if (this.connected || this.busy) return;
        if (!SerialLink.supported()) {
            this.status = '錯誤：這個瀏覽器不支援序列埠，請改用 Chrome 或 Edge';
            ui.show('請改用 Chrome 或 Edge 瀏覽器：這個瀏覽器不支援連接 Arduino', {kind: 'error'});
            return;
        }
        this.busy = true;
        try {
            this.status = '連線中…（請在跳出的視窗選擇 Arduino 連接埠）';
            const link = new SerialLink();
            await link.request(); // 必須最先做：需要使用者手勢
            await this._openFirmata(link);
            if (campFirmwareOutdated(this.firmware)) {
                ui.show('已連接 Arduino，但板子上的營隊韌體是舊版。\n請點「燒錄 Firmata 韌體」更新一次（約 30 秒）', {kind: 'error'});
            } else {
                ui.show(`已連接 Arduino（${this.firmware || `Firmata ${this.version}`}）`, {kind: 'ok', autoHideMs: 2500});
            }
        } catch (e) {
            this._reportError(e, '連接');
        } finally {
            this.busy = false;
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

    firmataVersion () {
        return this.firmware || this.version || '';
    }

    /**
     * 以 Firmata 的鮑率開啟連線，並等待板子重置後回報版本。
     * @param link
     */
    async _openFirmata (link) {
        this._resetState();
        link.onData = bytes => this.parser.feed(bytes);
        link.onLost = () => this._lost();
        await link.open(FIRMATA_BAUD);
        this.link = link;
        this.status = '連線中…（等待 Arduino 重置，最多 8 秒）';
        // Uno 在連接埠開啟時會自動重置，約需 2 秒才會回報 Firmata 版本。
        const deadline = Date.now() + 8000;
        let lastAsk = 0;
        while (!this.version && Date.now() < deadline) {
            if (Date.now() - lastAsk > 1500) {
                lastAsk = Date.now();
                await this._send(encode.reportVersion());
            }
            await sleep(100);
        }
        if (!this.version) {
            await this._close();
            this.status = '錯誤：連上連接埠，但板子沒有回應 Firmata。可能還沒燒錄 Firmata 韌體';
            throw new Error('NO_FIRMATA');
        }
        await this._send(encode.queryFirmware());
        await this._send([...encode.reportDigitalPort(0, true), ...encode.reportDigitalPort(1, true)]);
        this.connected = true;
        this.status = `已連線（Firmata ${this.version}）`;
    }

    _resetState () {
        this.connected = false;
        this.version = '';
        this.firmware = '';
        this.digital = [0, 0, 0];
        this.analog = new Array(6).fill(0);
        this.pinModes.clear();
        this.pinValues.clear();
        this.analogReporting.clear();
        this.servoPins.clear();
        this.tonePin = null;
        this._resetParts();
        this.parser = new FirmataParser(this.parser.handlers);
    }

    async _close () {
        this.connected = false;
        const link = this.link;
        this.link = null;
        if (link) {
            link.onLost = null;
            await link.close();
        }
    }

    /** 連線意外中斷（拔 USB、板子重置、寫入失敗）：回報並停止程式，編輯器不受影響。 */
    _lost () {
        if (!this.connected && !this.link) return;
        this.connected = false;
        this.link = null;
        this.status = '連線中斷（USB 被拔除或板子重置）';
        ui.show('Arduino 連線中斷了。請檢查 USB 線，再點「連接 Arduino」', {kind: 'error'});
        if (this.runtime && this.runtime.stopAll) this.runtime.stopAll();
    }

    _reportError (e, action) {
        const name = e && e.name;
        if (name === 'NotFoundError') {
            this.status = '未連線（沒有選擇連接埠）';
            return;
        }
        if (name === 'InvalidStateError' || name === 'NetworkError') {
            this.status = `錯誤：連接埠無法開啟，可能被其他程式佔用（例如 Arduino IDE 的序列埠監控視窗）`;
        } else if (!(e && e.message === 'NO_FIRMATA')) {
            this.status = `錯誤：${action}失敗（${(e && e.message) || e}）`;
        }
        ui.show(this.status.replace(/^錯誤：/, ''), {kind: 'error'});
    }

    async _send (bytes) {
        if (!this.link) return false;
        try {
            await this.link.write(bytes);
            return true;
        } catch (e) {
            this._lost();
            return false;
        }
    }

    // ================= 燒錄 Firmata 韌體 =================

    /** 把預先編譯好的 StandardFirmata 寫進 Uno（STK500v1，需先在板子上按手勢選連接埠）。 */
    async flashFirmware () {
        if (this.busy) return;
        if (!SerialLink.supported()) {
            ui.show('請改用 Chrome 或 Edge 瀏覽器：這個瀏覽器不支援燒錄', {kind: 'error'});
            return;
        }
        this.busy = true;
        let link = null;
        try {
            if (this.connected) await this._close();
            this.status = '燒錄中…（請在跳出的視窗選擇 Arduino 連接埠）';
            link = new SerialLink();
            await link.request(); // 必須最先做：需要使用者手勢

            ui.show('正在讀取韌體檔…');
            const image = await this._loadFirmware();
            const ok = typeof window === 'undefined' ||
                window.confirm('這會覆蓋板子上現有的程式，燒錄成營隊的 Firmata 韌體。\n要繼續嗎？');
            if (!ok) {
                ui.hide();
                this.status = '未連線（已取消燒錄）';
                return;
            }

            ui.show('正在連接板子…');
            await link.open(BOOTLOADER_BAUD);
            // 用 DTR 讓 Uno 重置，進入開機載入程式（optiboot）。
            await link.setSignals({dataTerminalReady: false, requestToSend: false});
            await sleep(250);
            await link.setSignals({dataTerminalReady: true, requestToSend: true});
            await sleep(50);

            ui.show('正在與板子同步…');
            await stk500.sync(link);
            await stk500.writeAndVerify(link, image, {
                onProgress: (done, total, phase) =>
                    ui.show(`${phase === 'write' ? '燒錄中' : '驗證中'}… ${Math.round(done / total * 100)}%\n請不要拔掉 USB 線`)
            });
            await link.close();

            // 燒完以 Firmata 的鮑率重新連線，確認韌體真的在跑。
            ui.show('燒錄完成，正在確認…');
            await sleep(500);
            await this._openFirmata(link);
            link = null;
            ui.show(`燒錄完成！已連接 Arduino（${this.firmware || FIRMWARE_VERSION_TEXT}）`, {kind: 'ok', autoHideMs: 4000});
        } catch (e) {
            if (link) await link.close().catch(() => {});
            this._flashError(e);
        } finally {
            this.busy = false;
        }
    }

    async _loadFirmware () {
        let hexText;
        let expected;
        try {
            const [hex, sha] = await Promise.all([fetch(FIRMWARE_URL), fetch(`${FIRMWARE_URL}.sha256`)]);
            if (!hex.ok || !sha.ok) throw new Error(`HTTP ${hex.status}/${sha.status}`);
            hexText = await hex.text();
            expected = (await sha.text()).trim().toLowerCase();
        } catch (e) {
            throw new stk500.FlashError('NO_FIRMWARE', '讀不到韌體檔，請檢查網路後再試');
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hexText));
        const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        if (actual !== expected) {
            throw new stk500.FlashError('BAD_FIRMWARE', '韌體檔的雜湊對不上，已停止燒錄（檔案可能被損壞或竄改）');
        }
        return stk500.parseIntelHex(hexText);
    }

    _flashError (e) {
        const name = e && e.name;
        if (name === 'NotFoundError') {
            ui.hide();
            this.status = '未連線（沒有選擇連接埠）';
            return;
        }
        let message;
        if (e instanceof stk500.FlashError) message = e.message;
        else if (name === 'InvalidStateError' || name === 'NetworkError') {
            message = '連接埠無法開啟，可能被其他程式佔用（例如 Arduino IDE 的序列埠監控視窗）。關掉它再試一次';
        } else if (e && e.message === 'NO_FIRMATA') {
            message = '燒錄看起來完成了，但板子沒有回應 Firmata。請拔掉 USB 線再接上，然後點「連接 Arduino」';
        } else message = `燒錄失敗：${(e && e.message) || e}`;
        this.status = `錯誤：${message}`;
        ui.show(`${message}\n（燒錄失敗不會弄壞板子，可以再試一次）`, {kind: 'error'});
    }

    // ================= 基本輸出入 =================

    _pin (value, allowed) {
        const pin = Math.round(Cast.toNumber(value));
        return allowed.includes(pin) ? pin : null;
    }

    async _ensureMode (pin, mode) {
        if (this.pinModes.get(pin) === mode) return;
        this.pinModes.set(pin, mode);
        await this._send(encode.pinMode(pin, mode));
        if (mode === MODE.SERVO) this.servoPins.add(pin);
    }

    async _setDigital (pin, high) {
        await this._ensureMode(pin, MODE.OUTPUT);
        this.pinValues.set(pin, high ? 1 : 0);
        await this._send(encode.digitalWrite(pin, high));
    }

    pinMode (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        const mode = {output: MODE.OUTPUT, input: MODE.INPUT, pullup: MODE.PULLUP}[args.MODE];
        if (mode === undefined) return;
        this.pinModes.delete(pin); // 使用者明確設定，一定送出
        return this._ensureMode(pin, mode);
    }

    digitalWrite (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        return this._setDigital(pin, Cast.toBoolean(args.VALUE) && String(args.VALUE) !== '0');
    }

    digitalRead (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return 0;
        if (this.pinModes.get(pin) !== MODE.INPUT && this.pinModes.get(pin) !== MODE.PULLUP) this._ensureMode(pin, MODE.INPUT);
        return this._digitalValue(pin);
    }

    _digitalValue (pin) {
        return (this.digital[pin >> 3] >> (pin & 7)) & 1;
    }

    analogRead (args) {
        const channel = this._pin(args.PIN, [0, 1, 2, 3, 4, 5]);
        if (!this.connected || channel === null) return 0;
        if (!this.analogReporting.has(channel)) {
            this.analogReporting.add(channel);
            this._send([...encode.pinMode(ANALOG_PIN_OFFSET + channel, MODE.ANALOG), ...encode.reportAnalog(channel, true)]);
        }
        return this.analog[channel];
    }

    pwmWrite (args) {
        const pin = this._pin(args.PIN, PWM_PINS);
        if (!this.connected || pin === null) return;
        return this._pwm(pin, Cast.toNumber(args.VALUE));
    }

    async _pwm (pin, value) {
        const v = Math.min(255, Math.max(0, Math.round(value)));
        await this._ensureMode(pin, MODE.PWM);
        this.pinValues.set(pin, v);
        await this._send(encode.analogWrite(pin, v));
    }

    readAuto (args) {
        const text = String(args.PIN);
        if (/^A[0-5]$/i.test(text)) return this.analogRead({PIN: text.slice(1)});
        return this.digitalRead(args);
    }

    pinModeOf (args) {
        const pin = this._anyPin(args.PIN);
        if (!this.connected || pin === null) return '';
        const mode = this.pinModes.get(pin);
        if (mode === undefined) return '尚未設定';
        return {[MODE.INPUT]: '輸入', [MODE.OUTPUT]: '輸出', [MODE.ANALOG]: '類比輸入', [MODE.PWM]: 'PWM', [MODE.SERVO]: '伺服馬達', [MODE.PULLUP]: '上拉輸入'}[mode] || '';
    }

    pinStateOf (args) {
        const pin = this._anyPin(args.PIN);
        if (!this.connected || pin === null) return 0;
        if (pin >= ANALOG_PIN_OFFSET) return this.analog[pin - ANALOG_PIN_OFFSET];
        const mode = this.pinModes.get(pin);
        if (mode === MODE.INPUT || mode === MODE.PULLUP) return this._digitalValue(pin);
        return this.pinValues.get(pin) || 0;
    }

    _anyPin (value) {
        const text = String(value);
        if (/^A[0-5]$/i.test(text)) return ANALOG_PIN_OFFSET + Number(text[1]);
        return this._pin(value, DIGITAL_PINS);
    }

    // ================= 常用零件 =================

    ledOn (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (this.connected && pin !== null) return this._setDigital(pin, true);
    }

    ledOff (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (this.connected && pin !== null) return this._setDigital(pin, false);
    }

    async ledBlink (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        const times = Math.min(100, Math.max(0, Math.round(Cast.toNumber(args.TIMES))));
        const on = Math.max(0, Cast.toNumber(args.ON));
        const off = Math.max(0, Cast.toNumber(args.OFF));
        const epoch = this.epoch;
        for (let i = 0; i < times && this.connected && epoch === this.epoch; i++) {
            await this._setDigital(pin, true);
            await sleep(on);
            await this._setDigital(pin, false);
            if (i < times - 1) await sleep(off);
        }
    }

    async buzzerBeep (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        const ms = Math.min(10000, Math.max(0, Cast.toNumber(args.MS)));
        await this._setDigital(pin, true);
        await sleep(ms);
        // 即使中途按了停止，也要把蜂鳴器關掉。
        await this._setDigital(pin, false);
    }

    async servoWrite (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        await this._servo(pin, Cast.toNumber(args.ANGLE));
    }

    async _servo (pin, angle) {
        const a = Math.min(180, Math.max(0, Math.round(angle)));
        if (!this.servoPins.has(pin)) {
            await this._send(encode.servoConfig(pin));
        }
        await this._ensureMode(pin, MODE.SERVO);
        this.pinValues.set(pin, a);
        await this._send(encode.analogWrite(pin, a));
    }

    async servoSweep (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        const from = Math.min(180, Math.max(0, Math.round(Cast.toNumber(args.FROM))));
        const to = Math.min(180, Math.max(0, Math.round(Cast.toNumber(args.TO))));
        const delay = SWEEP_MS_PER_DEGREE[args.SPEED] || SWEEP_MS_PER_DEGREE.medium;
        const step = to >= from ? 1 : -1;
        const epoch = this.epoch;
        for (let a = from; a !== to + step && this.connected && epoch === this.epoch; a += step) {
            await this._servo(pin, a);
            await sleep(delay);
        }
    }

    async rgbSet (args) {
        const r = this._pin(args.R, PWM_PINS);
        const g = this._pin(args.G, PWM_PINS);
        const b = this._pin(args.B, PWM_PINS);
        const color = COLORS[args.COLOR];
        if (!this.connected || r === null || g === null || b === null || !color) return;
        // 假設共陰極 RGB LED（最常見）：值越大越亮。
        await this._pwm(r, color[0]);
        await this._pwm(g, color[1]);
        await this._pwm(b, color[2]);
    }

    async motorRun (args) {
        const dir = this._pin(args.DIR, DIGITAL_PINS);
        const pwm = this._pin(args.PWM, PWM_PINS);
        if (!this.connected || dir === null || pwm === null || dir === pwm) return;
        const speed = Math.min(100, Math.max(0, Cast.toNumber(args.SPEED)));
        await this._setDigital(dir, args.DIRECTION !== 'backward');
        await this._pwm(pwm, speed * 255 / 100);
    }

    async motorStop (args) {
        const dir = this._pin(args.DIR, DIGITAL_PINS);
        const pwm = this._pin(args.PWM, PWM_PINS);
        if (!this.connected || dir === null || pwm === null || dir === pwm) return;
        await this._pwm(pwm, 0);
        await this._setDigital(dir, false);
    }

    // ================= 感測輔助 =================

    async waitDigital (args) {
        const pin = this._pin(args.PIN, DIGITAL_PINS);
        if (!this.connected || pin === null) return;
        const target = Cast.toBoolean(args.VALUE) && String(args.VALUE) !== '0' ? 1 : 0;
        if (this.pinModes.get(pin) !== MODE.INPUT && this.pinModes.get(pin) !== MODE.PULLUP) await this._ensureMode(pin, MODE.INPUT);
        const epoch = this.epoch;
        // 剛設成輸入時，板子要一點時間才回報第一筆狀態；先等一下避免誤判。
        await sleep(30);
        while (this.connected && epoch === this.epoch && this._digitalValue(pin) !== target) await sleep(10);
    }

    analogBetween (args) {
        const value = this.analogRead({PIN: args.PIN});
        const a = Cast.toNumber(args.MIN);
        const b = Cast.toNumber(args.MAX);
        return value >= Math.min(a, b) && value <= Math.max(a, b);
    }

    mapValue (args) {
        const v = Cast.toNumber(args.VALUE);
        const inMin = Cast.toNumber(args.IN_MIN);
        const inMax = Cast.toNumber(args.IN_MAX);
        const outMin = Cast.toNumber(args.OUT_MIN);
        const outMax = Cast.toNumber(args.OUT_MAX);
        if (inMax === inMin) return outMin;
        return outMin + ((v - inMin) * (outMax - outMin) / (inMax - inMin));
    }
}

Object.assign(Scratch3CampArduinoBlocks.prototype, parts.PartMethods);

module.exports = Scratch3CampArduinoBlocks;
module.exports.campFirmwareOutdated = campFirmwareOutdated;
