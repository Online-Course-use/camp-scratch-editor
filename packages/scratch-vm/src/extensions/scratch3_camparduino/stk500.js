/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * Intel HEX 解析與 STK500v1 燒錄（Arduino Uno 的 optiboot 開機載入程式使用的協定）。
 * 營隊自行撰寫（AGPL-3.0）；協定規格見 Atmel AVR061「STK500 Communication Protocol」。
 *
 * 純邏輯：透過一個 transport 物件收發，不直接碰 WebSerial，所以可以用模擬的開機載入程式做單元測試。
 *
 *   transport.write(bytes: number[]|Uint8Array): Promise<void>
 *   transport.read(count: number, timeoutMs: number): Promise<Uint8Array>   // 逾時丟錯
 *   transport.clear(): void                                                  // 丟掉已收到但還沒讀的資料
 */

const CMD = {
    GET_SYNC: 0x30,
    ENTER_PROGMODE: 0x50,
    LEAVE_PROGMODE: 0x51,
    LOAD_ADDRESS: 0x55,
    PROG_PAGE: 0x64,
    READ_PAGE: 0x74,
    CRC_EOP: 0x20
};
const RESP = {INSYNC: 0x14, OK: 0x10};

/** ATmega328P（Uno）的快閃記憶體頁大小；整份 hex 以這個大小切頁寫入。 */
const UNO_PAGE_SIZE = 128;
/** Uno 的應用程式空間（扣掉 0.5KB 的 optiboot）= 32256 bytes。 */
const UNO_MAX_BYTES = 32256;

class FlashError extends Error {
    /**
     * @param {string} code - NO_BOOTLOADER、SYNC_LOST、VERIFY_FAILED、BAD_HEX、TOO_LARGE
     * @param {string} message - 給人看的說明
     */
    constructor (code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * 解析 Intel HEX。只支援 AVR 會用到的記錄類型：資料（00）、結尾（01）、延伸線性位址（04，高位址）。
 * 每一行都檢查檢查碼；空洞填 0xFF（快閃記憶體清除後的值）。
 * @param {string} text - hex 檔文字
 * @returns {Uint8Array} 從位址 0 開始的連續內容
 */
function parseIntelHex (text) {
    const lines = text.split(/\r?\n/).map(l => l.trim())
        .filter(l => l.length > 0);
    const chunks = [];
    let base = 0;
    let max = 0;
    let sawEof = false;
    for (const [i, line] of lines.entries()) {
        if (line[0] !== ':' || line.length < 11 || line.length % 2 === 0) {
            throw new FlashError('BAD_HEX', `韌體檔第 ${i + 1} 行格式不正確`);
        }
        const bytes = [];
        for (let p = 1; p < line.length; p += 2) {
            const v = parseInt(line.slice(p, p + 2), 16);
            if (Number.isNaN(v)) throw new FlashError('BAD_HEX', `韌體檔第 ${i + 1} 行含有非法字元`);
            bytes.push(v);
        }
        const len = bytes[0];
        if (bytes.length !== len + 5) throw new FlashError('BAD_HEX', `韌體檔第 ${i + 1} 行長度不符`);
        if (bytes.reduce((s, b) => (s + b) & 0xFF, 0) !== 0) {
            throw new FlashError('BAD_HEX', `韌體檔第 ${i + 1} 行檢查碼錯誤`);
        }
        const addr = (bytes[1] << 8) | bytes[2];
        const type = bytes[3];
        if (type === 0x00) {
            const start = base + addr;
            chunks.push([start, bytes.slice(4, 4 + len)]);
            max = Math.max(max, start + len);
        } else if (type === 0x01) {
            sawEof = true;
            break;
        } else if (type === 0x04) {
            base = ((bytes[4] << 8) | bytes[5]) * 0x10000;
        } else {
            throw new FlashError('BAD_HEX', `韌體檔第 ${i + 1} 行有不支援的記錄類型 ${type}`);
        }
    }
    if (!sawEof) throw new FlashError('BAD_HEX', '韌體檔沒有結尾記錄，可能不完整');
    if (max === 0) throw new FlashError('BAD_HEX', '韌體檔是空的');
    if (max > UNO_MAX_BYTES) throw new FlashError('TOO_LARGE', `韌體有 ${max} bytes，超過 Uno 的上限 ${UNO_MAX_BYTES}`);
    const out = new Uint8Array(max).fill(0xFF);
    for (const [start, data] of chunks) out.set(data, start);
    return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 送出一個命令，期待回 INSYNC（＋資料）＋OK。
 * @param transport
 * @param bytes
 * @param dataLength
 * @param timeoutMs
 */
async function command (transport, bytes, dataLength = 0, timeoutMs = 1000) {
    transport.clear();
    await transport.write(bytes);
    const reply = await transport.read(dataLength + 2, timeoutMs);
    if (reply[0] !== RESP.INSYNC || reply[reply.length - 1] !== RESP.OK) {
        throw new FlashError('SYNC_LOST', '板子的回應不正確，通訊中斷');
    }
    return reply.slice(1, reply.length - 1);
}

/**
 * 與開機載入程式同步。板子剛重置時 optiboot 只等約 1 秒，所以連續送同步封包直到有回應。
 * @param {object} transport - 見檔案開頭
 * @param {object} [options] - attempts（預設 12 次）、waitMs（每次等待回應的毫秒數）
 * @returns {Promise<void>} 同步成功時 resolve
 */
async function sync (transport, {attempts = 12, waitMs = 250} = {}) {
    for (let i = 0; i < attempts; i++) {
        transport.clear();
        await transport.write([CMD.GET_SYNC, CMD.CRC_EOP]);
        try {
            const reply = await transport.read(2, waitMs);
            if (reply[0] === RESP.INSYNC && reply[1] === RESP.OK) return;
        } catch (e) {
            // 逾時：再試一次
        }
        await sleep(20);
    }
    throw new FlashError('NO_BOOTLOADER',
        '板子沒有回應。請確認這是 Arduino Uno、USB 線能傳資料，且沒有其他程式（例如 Arduino IDE 的序列埠監控視窗）佔用連接埠');
}

/**
 * 把程式寫進板子並逐頁讀回比對。
 * @param {object} transport - 見檔案開頭
 * @param {Uint8Array} image - parseIntelHex 的結果
 * @param {object} [options] - pageSize、onProgress(done, total, phase)，phase 是 'write' 或 'verify'
 * @returns {Promise<void>} 完成（含讀回驗證）時 resolve
 */
async function writeAndVerify (transport, image, {pageSize = UNO_PAGE_SIZE, onProgress} = {}) {
    const pages = Math.ceil(image.length / pageSize);
    const pageAt = n => {
        const page = new Uint8Array(pageSize).fill(0xFF);
        page.set(image.subarray(n * pageSize, (n + 1) * pageSize));
        return page;
    };
    const loadAddress = n => {
        const word = (n * pageSize) >> 1; // 位址以「字」（2 bytes）為單位
        return command(transport, [CMD.LOAD_ADDRESS, word & 0xFF, (word >> 8) & 0xFF, CMD.CRC_EOP]);
    };

    await command(transport, [CMD.ENTER_PROGMODE, CMD.CRC_EOP]);
    for (let n = 0; n < pages; n++) {
        await loadAddress(n);
        await command(transport,
            [CMD.PROG_PAGE, (pageSize >> 8) & 0xFF, pageSize & 0xFF, 0x46, ...pageAt(n), CMD.CRC_EOP], 0, 2000);
        if (onProgress) onProgress(n + 1, pages, 'write');
    }
    for (let n = 0; n < pages; n++) {
        await loadAddress(n);
        const back = await command(transport,
            [CMD.READ_PAGE, (pageSize >> 8) & 0xFF, pageSize & 0xFF, 0x46, CMD.CRC_EOP], pageSize, 2000);
        const want = pageAt(n);
        for (let i = 0; i < pageSize; i++) {
            if (back[i] !== want[i]) {
                throw new FlashError('VERIFY_FAILED', `讀回比對失敗（第 ${n + 1} 頁），請再燒錄一次`);
            }
        }
        if (onProgress) onProgress(n + 1, pages, 'verify');
    }
    await command(transport, [CMD.LEAVE_PROGMODE, CMD.CRC_EOP]);
}

module.exports = {CMD, RESP, UNO_PAGE_SIZE, UNO_MAX_BYTES, FlashError, parseIntelHex, sync, writeAndVerify};
