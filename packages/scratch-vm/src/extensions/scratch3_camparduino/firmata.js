/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * Firmata 協定的最小子集（編碼與解碼）。純邏輯，不碰任何序列埠，方便單元測試。
 * 協定規格：https://github.com/firmata/protocol 。這是營隊自行撰寫的實作（AGPL-3.0）。
 *
 * StandardFirmata 的功能：腳位模式、數位讀寫、類比讀取、PWM、伺服馬達、版本與韌體名稱、I2C 寫入（1602 LCD）、
 * 軟體序列埠（藍牙模組，Firmata 標準的 SERIAL_MESSAGE）。
 * 加上營隊韌體（CampFirmata）的自訂指令 CAMP_*：蜂鳴器音調、脈衝寬度、超音波、DHT11、WS2812、MAX7219。
 * 韌體原始碼：packages/camp-host/firmware/CampFirmata/camp_features.h（兩邊的編號與格式必須一致）。
 */

const START_SYSEX = 0xF0;
const END_SYSEX = 0xF7;
const REPORT_VERSION = 0xF9;
const SET_PIN_MODE = 0xF4;
const SET_DIGITAL_PIN_VALUE = 0xF5;
const DIGITAL_MESSAGE = 0x90;
const ANALOG_MESSAGE = 0xE0;
const REPORT_ANALOG = 0xC0;
const REPORT_DIGITAL = 0xD0;
const SYSEX_REPORT_FIRMWARE = 0x79;
const SYSEX_SERVO_CONFIG = 0x70;
const SYSEX_EXTENDED_ANALOG = 0x6F;
const SYSEX_I2C_REQUEST = 0x76;
const SYSEX_I2C_CONFIG = 0x78;
const SYSEX_SERIAL_MESSAGE = 0x60;
const SERIAL_CONFIG = 0x10;
const SERIAL_WRITE = 0x20;
const SERIAL_READ = 0x30;
const SERIAL_REPLY = 0x40;
const SERIAL_CLOSE = 0x50;
/** 第一個軟體序列埠（藍牙模組用）。 */
const SW_SERIAL0 = 0x08;

/** 營隊韌體的自訂指令（camp_features.h）。 */
const CAMP = {TONE: 0x01, PULSE_IN: 0x02, SONAR: 0x03, DHT11: 0x04, PIXEL: 0x05, MATRIX: 0x06};

/** 一則 sysex 最多帶幾個原始位元組（每個拆成兩個 7 位元；Firmata 的接收緩衝區是 64）。 */
const MAX_SYSEX_PAYLOAD = 28;

/** 把數值拆成 n 個 7 位元（低位在前）。 */
const split7 = (value, n) => {
    let v = Math.max(0, Math.floor(Number(value) || 0));
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(v % 128);
        v = Math.floor(v / 128);
    }
    return out;
};

const sysex = (...body) => [START_SYSEX, ...body, END_SYSEX];

/** 每個位元組拆成兩個 7 位元，超過上限就分成多則 sysex。 */
const chunked = (prefix, bytes) => {
    const out = [];
    for (let i = 0; i < bytes.length; i += MAX_SYSEX_PAYLOAD) {
        const part = bytes.slice(i, i + MAX_SYSEX_PAYLOAD).flatMap(b => [b & 0x7F, (b >> 7) & 0x7F]);
        out.push(...sysex(...prefix, ...part));
    }
    return out;
};

const MODE = {INPUT: 0, OUTPUT: 1, ANALOG: 2, PWM: 3, SERVO: 4, PULLUP: 11};

/** Uno：A0–A5 是腳位 14–19。 */
const ANALOG_PIN_OFFSET = 14;

const encode = {
    reportVersion: () => [REPORT_VERSION],
    queryFirmware: () => [START_SYSEX, SYSEX_REPORT_FIRMWARE, END_SYSEX],
    pinMode: (pin, mode) => [SET_PIN_MODE, pin, mode],
    digitalWrite: (pin, value) => [SET_DIGITAL_PIN_VALUE, pin, value ? 1 : 0],
    /**
     * 開關某個數位埠（每 8 支腳位一個埠）的狀態回報。
     * @param port
     * @param enable
     */
    reportDigitalPort: (port, enable) => [REPORT_DIGITAL | (port & 0x0F), enable ? 1 : 0],
    /**
     * 開關某個類比通道（0 = A0）的回報。
     * @param channel
     * @param enable
     */
    reportAnalog: (channel, enable) => [REPORT_ANALOG | (channel & 0x0F), enable ? 1 : 0],
    /**
     * PWM 或伺服馬達的輸出值。腳位 ≤ 15 且值 < 2^14 用一般訊息，否則用延伸訊息。
     * @param pin
     * @param value
     */
    analogWrite: (pin, value) => {
        const v = Math.max(0, Math.round(value));
        if (pin <= 15 && v < 0x4000) return [ANALOG_MESSAGE | pin, v & 0x7F, (v >> 7) & 0x7F];
        return [START_SYSEX, SYSEX_EXTENDED_ANALOG, pin, v & 0x7F, (v >> 7) & 0x7F, (v >> 14) & 0x7F, END_SYSEX];
    },
    /**
     * 伺服馬達的脈波範圍（微秒）。SG90 等常見伺服用 544–2400。
     * @param pin
     * @param minPulse
     * @param maxPulse
     */
    servoConfig: (pin, minPulse = 544, maxPulse = 2400) => [
        START_SYSEX, SYSEX_SERVO_CONFIG, pin,
        minPulse & 0x7F, (minPulse >> 7) & 0x7F, maxPulse & 0x7F, (maxPulse >> 7) & 0x7F, END_SYSEX
    ],

    // ---- I2C（StandardFirmata） ----
    i2cConfig: () => sysex(SYSEX_I2C_CONFIG, 0, 0),
    /** 寫入 7 位元位址的 I2C 裝置；太長會自動分成多次寫入。 */
    i2cWrite: (address, bytes) => chunked([SYSEX_I2C_REQUEST, address & 0x7F, 0x00], bytes),

    // ---- 軟體序列埠（StandardFirmata 的 SERIAL_MESSAGE） ----
    serialConfig: (baud, rxPin, txPin, port = SW_SERIAL0) =>
        sysex(SYSEX_SERIAL_MESSAGE, SERIAL_CONFIG | port, ...split7(baud, 3), rxPin, txPin),
    serialReadContinuously: (port = SW_SERIAL0) => sysex(SYSEX_SERIAL_MESSAGE, SERIAL_READ | port, 0x00),
    serialWrite: (bytes, port = SW_SERIAL0) => chunked([SYSEX_SERIAL_MESSAGE, SERIAL_WRITE | port], bytes),
    serialClose: (port = SW_SERIAL0) => sysex(SYSEX_SERIAL_MESSAGE, SERIAL_CLOSE | port),

    // ---- 營隊韌體 ----
    /** 頻率 0 = 停止；持續時間 0 = 一直響。 */
    campTone: (pin, freq, durationMs) => sysex(CAMP.TONE, pin, ...split7(freq, 3), ...split7(durationMs, 3)),
    campPulseIn: (reqId, pin, level, timeoutUs) => sysex(CAMP.PULSE_IN, reqId & 0x7F, pin, level ? 1 : 0, ...split7(timeoutUs, 4)),
    campSonar: (reqId, trig, echo, timeoutUs) => sysex(CAMP.SONAR, reqId & 0x7F, trig, echo, ...split7(timeoutUs, 4)),
    campDht11: (reqId, pin) => sysex(CAMP.DHT11, reqId & 0x7F, pin),
    pixelConfig: (pin, count) => sysex(CAMP.PIXEL, 0, pin, ...split7(count, 2)),
    pixelSet: (index, r, g, b) => sysex(CAMP.PIXEL, 1, ...split7(index, 2), ...split7(r, 2), ...split7(g, 2), ...split7(b, 2)),
    pixelFill: (r, g, b) => sysex(CAMP.PIXEL, 2, ...split7(r, 2), ...split7(g, 2), ...split7(b, 2)),
    pixelBrightness: value => sysex(CAMP.PIXEL, 3, ...split7(value, 2)),
    pixelShow: () => sysex(CAMP.PIXEL, 4),
    pixelClear: () => sysex(CAMP.PIXEL, 5),
    matrixConfig: (din, cs, clk) => sysex(CAMP.MATRIX, 0, din, cs, clk),
    /** 第 row（0–7）排寫入 8 個點（最高位元 = 最左邊）。 */
    matrixRow: (row, value) => sysex(CAMP.MATRIX, 1, row, ...split7(value, 2)),
    matrixBrightness: value => sysex(CAMP.MATRIX, 2, value & 0x0F)
};

/** Firmata.sendSysex 把每個位元組拆成兩個 7 位元送回來；合併回原本的位元組。 */
const joinPairs = data => {
    const out = [];
    for (let i = 0; i + 1 < data.length; i += 2) out.push(data[i] | (data[i + 1] << 7));
    return out;
};
const read7 = (values, start, n) => {
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = (v * 128) + (values[start + i] & 0x7F);
    return v;
};

/**
 * 逐位元組的解碼器。把收到的資料餵進 feed()，解出的事件由 handlers 回呼：
 *   onVersion(major, minor)、onFirmware(name, major, minor)、
 *   onDigitalPort(port, mask)（mask 的第 i 位是該埠第 i 支腳位）、onAnalog(channel, value)、
 *   onCampPulse(command, reqId, microseconds)、onCampDht(reqId, status, [濕度, 濕度小數, 溫度, 溫度小數])、
 *   onSerial(port, bytes)
 */
class FirmataParser {
    constructor (handlers = {}) {
        this.handlers = handlers;
        this._cmd = null;
        this._data = [];
        this._sysex = null;
    }

    feed (bytes) {
        for (const b of bytes) this._byte(b);
    }

    _byte (b) {
        if (this._sysex) {
            if (b === END_SYSEX) {
                this._onSysex(this._sysex);
                this._sysex = null;
            } else if (b >= 0x80) {
                // 在 sysex 中途遇到新的命令位元組：資料不完整，丟棄並重新同步。
                this._sysex = null;
                this._byte(b);
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
        const h = this.handlers;
        if (cmd === REPORT_VERSION) {
            if (h.onVersion) h.onVersion(d[0], d[1]);
            return;
        }
        const type = cmd & 0xF0;
        const n = cmd & 0x0F;
        if (type === ANALOG_MESSAGE) {
            if (h.onAnalog) h.onAnalog(n, d[0] | (d[1] << 7));
        } else if (type === DIGITAL_MESSAGE) {
            if (h.onDigitalPort) h.onDigitalPort(n, d[0] | (d[1] << 7));
        }
    }

    _onSysex (data) {
        if (data[0] === SYSEX_REPORT_FIRMWARE && data.length >= 3) {
            let name = '';
            for (let i = 3; i + 1 < data.length; i += 2) name += String.fromCharCode(data[i] | (data[i + 1] << 7));
            if (this.handlers.onFirmware) this.handlers.onFirmware(name, data[1], data[2]);
            return;
        }
        const h = this.handlers;
        const cmd = data[0];
        if ((cmd === CAMP.PULSE_IN || cmd === CAMP.SONAR) && data.length >= 13) {
            const v = joinPairs(data.slice(1));
            if (h.onCampPulse) h.onCampPulse(cmd, v[0], read7(v, 1, 5));
        } else if (cmd === CAMP.DHT11 && data.length >= 21) {
            const v = joinPairs(data.slice(1));
            if (h.onCampDht) h.onCampDht(v[0], v[1], [read7(v, 2, 2), read7(v, 4, 2), read7(v, 6, 2), read7(v, 8, 2)]);
        } else if (cmd === SYSEX_SERIAL_MESSAGE && data.length >= 2 && (data[1] & 0xF0) === SERIAL_REPLY) {
            if (h.onSerial) h.onSerial(data[1] & 0x0F, joinPairs(data.slice(2)));
        }
    }
}

module.exports = {MODE, ANALOG_PIN_OFFSET, CAMP, SW_SERIAL0, encode, FirmataParser, split7};
