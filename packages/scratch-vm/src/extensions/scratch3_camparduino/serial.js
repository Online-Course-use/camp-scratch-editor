/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * WebSerial 的薄封裝：一條連線、一個接收緩衝區。同時給 Firmata 與 STK500 燒錄用
 * （提供 stk500.js 要的 write／read／clear）。只在瀏覽器執行；Safari 沒有 WebSerial。
 */
class SerialLink {
    constructor () {
        this.port = null;
        this.writer = null;
        this.reader = null;
        this._buffer = [];
        this._waiters = [];
        /** 收到資料時的回呼（Firmata 用）。燒錄時不設，資料留在緩衝區給 read() 取。 */
        this.onData = null;
        /** 連線意外結束時的回呼（拔掉 USB、讀寫失敗）。主動呼叫 close() 不會觸發。 */
        this.onLost = null;
        this._closing = false;
        this._onDisconnect = this._onDisconnect.bind(this);
    }

    static supported () {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    /** 跳出連接埠選擇視窗。**必須在使用者手勢（點擊）之後呼叫**，否則瀏覽器會拒絕。 */
    async request () {
        this.port = await navigator.serial.requestPort();
    }

    async open (baudRate) {
        await this.port.open({baudRate, bufferSize: 4096});
        this._closing = false;
        this._buffer = [];
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        navigator.serial.addEventListener('disconnect', this._onDisconnect);
        this._pump();
    }

    async _pump () {
        const reader = this.reader;
        try {
            for (;;) {
                const {value, done} = await reader.read();
                if (done) break;
                if (value && value.length) {
                    if (this.onData) this.onData(value);
                    else this._buffer.push(...value);
                    this._wake();
                }
            }
        } catch (e) {
            // 讀取失敗：板子被拔掉或重置
        }
        if (!this._closing) this._lost();
    }

    _wake () {
        const waiters = this._waiters;
        this._waiters = [];
        for (const w of waiters) w();
    }

    _onDisconnect (event) {
        if (event.target === this.port && !this._closing) this._lost();
    }

    _lost () {
        if (this._closing) return;
        this._closing = true;
        if (this.onLost) this.onLost();
        this._release();
    }

    clear () {
        this._buffer = [];
    }

    async write (bytes) {
        await this.writer.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }

    /**
     * 讀取剛好 count 個位元組；逾時丟錯。
     * @param {number} count - 要讀的位元組數
     * @param {number} timeoutMs - 逾時毫秒
     * @returns {Promise<Uint8Array>} 讀到的資料
     */
    read (count, timeoutMs) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;
            const check = () => {
                if (this._buffer.length >= count) return resolve(Uint8Array.from(this._buffer.splice(0, count)));
                const left = deadline - Date.now();
                if (left <= 0) return reject(new Error('讀取逾時'));
                const timer = setTimeout(check, left);
                this._waiters.push(() => {
                    clearTimeout(timer);
                    check();
                });
            };
            check();
        });
    }

    /**
     * 控制 DTR／RTS 線（Uno 用 DTR 觸發重置）。
     * @param {{dataTerminalReady: boolean, requestToSend: boolean}} signals - 訊號狀態
     * @returns {Promise<void>} 設定完成時 resolve
     */
    setSignals (signals) {
        return this.port.setSignals(signals);
    }

    _release () {
        navigator.serial.removeEventListener('disconnect', this._onDisconnect);
    }

    async close () {
        this._closing = true;
        this._release();
        try {
            if (this.reader) await this.reader.cancel().catch(() => {});
            if (this.reader) this.reader.releaseLock();
            if (this.writer) this.writer.releaseLock();
            if (this.port) await this.port.close().catch(() => {});
        } catch (e) {
            // 已經關了
        }
        this.reader = null;
        this.writer = null;
        this._buffer = [];
        this._wake();
    }
}

module.exports = SerialLink;
