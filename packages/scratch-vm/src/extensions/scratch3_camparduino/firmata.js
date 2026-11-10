/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * Firmata 協定的最小子集（編碼與解碼）。純邏輯，不碰任何序列埠，方便單元測試。
 * 協定規格：https://github.com/firmata/protocol 。這是營隊自行撰寫的實作（AGPL-3.0）。
 *
 * 只實作 StandardFirmata 的功能：腳位模式、數位讀寫、類比讀取、PWM、伺服馬達、版本與韌體名稱。
 * StandardFirmata **沒有**音調（tone）功能，所以這裡也沒有。
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
    ]
};

/**
 * 逐位元組的解碼器。把收到的資料餵進 feed()，解出的事件由 handlers 回呼：
 *   onVersion(major, minor)、onFirmware(name, major, minor)、
 *   onDigitalPort(port, mask)（mask 的第 i 位是該埠第 i 支腳位）、onAnalog(channel, value)
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
        }
    }
}

module.exports = {MODE, ANALOG_PIN_OFFSET, encode, FirmataParser};
