/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 視覺類擴展共用的工具（SPEC 7.7.0）：選擇攝影機、拍下舞台畫面、在舞台上畫偵測框。
 * 臉部網格先用；M4 的手部、姿態、影像訓練器、Teachable Machine 也用這一份。
 */

/** 舞台的大小（Scratch 座標 x：−240～240，y：−180～180）。 */
const STAGE_W = 480;
const STAGE_H = 360;

// ---------------------------------------------------------------- 攝影機

/**
 * 列出這台電腦的攝影機。瀏覽器要在使用者允許攝影機之後，才會給攝影機的名稱。
 * @param {object} scope - 瀏覽器的 window
 * @returns {Promise<Array<{deviceId: string, label: string}>>} 攝影機清單（沒有就是空陣列）
 */
async function listCameras (scope = globalThis) {
    const md = scope.navigator && scope.navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return [];
    try {
        const devices = await md.enumerateDevices();
        return devices
            .filter(d => d.kind === 'videoinput')
            .map(d => ({deviceId: d.deviceId, label: d.label || ''}));
    } catch (e) {
        return [];
    }
}

/**
 * 把舞台上的影像換成另一支攝影機。
 *
 * 官方的 VideoProvider（scratch-gui/src/lib/video/video-provider.js）沒有選擇攝影機的功能，
 * 這裡直接替換它的 video 元素來源與 track（我們的 fork 版本凍結，這些內部欄位不會變）。
 * 已知限制：換過攝影機之後，再開「造型 → 攝影機拍照」視窗可能拿到已關閉的舊畫面；關掉影像再開就恢復。
 *
 * @param {object} video - runtime.ioDevices.video（影像必須已經開啟）
 * @param {string} deviceId - 要換成的攝影機
 * @param {object} scope - 瀏覽器的 window
 * @returns {Promise<void>} 失敗時丟出錯誤
 */
async function useCamera (video, deviceId, scope = globalThis) {
    const provider = video && video.provider;
    if (!provider || !provider._video) throw new Error('影像還沒開啟');
    const md = scope.navigator && scope.navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw new Error('這個瀏覽器不能選擇攝影機');
    const stream = await md.getUserMedia({
        audio: false,
        video: {deviceId: {exact: deviceId}, width: {min: 480, ideal: 640}, height: {min: 360, ideal: 480}}
    });
    const track = stream.getVideoTracks()[0];
    const old = provider._track;
    provider._video.srcObject = stream;
    if (provider._video.play) {
        const p = provider._video.play();
        if (p && p.catch) p.catch(() => {});
    }
    provider._track = track;
    if (old && old !== track && old.stop) old.stop();
}

// ---------------------------------------------------------------- 舞台畫面

/**
 * 把目前的舞台畫面複製到一張 480×360 的 2D 畫布，給 AI 模型辨識（「辨識輸入：舞台」）。
 * 舞台是 WebGL 畫布，畫完要立刻複製，否則內容可能已被清掉，所以先 draw() 再同步複製。
 * @param {object} renderer - runtime.renderer
 * @param {object} scope - 瀏覽器的 window
 * @param {HTMLCanvasElement} [reuse] - 重複使用的畫布
 * @returns {HTMLCanvasElement|null} 舞台畫面；沒有舞台時回傳 null
 */
function captureStage (renderer, scope = globalThis, reuse = null) {
    if (!renderer || !renderer.canvas || !scope.document) return null;
    const canvas = reuse || scope.document.createElement('canvas');
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (renderer.draw) renderer.draw();
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.drawImage(renderer.canvas, 0, 0, STAGE_W, STAGE_H);
    return canvas;
}

// ---------------------------------------------------------------- 偵測框

/**
 * 在舞台上方疊一層透明畫布畫偵測框（「顯示偵測框」積木，除錯用）。
 *
 * 刻意畫在頁面上而不是畫進舞台：這樣偵測框不會出現在作品縮圖、也不會被別的積木讀到。
 * 每次畫的時候對齊舞台目前的位置與大小（全螢幕、縮小舞台都跟得上）。
 */
class BoxOverlay {
    /**
     * @param {object} renderer - runtime.renderer
     * @param {object} scope - 瀏覽器的 window
     */
    constructor (renderer, scope = globalThis) {
        this.renderer = renderer;
        this.scope = scope;
        this.canvas = null;
    }

    _ensure () {
        const doc = this.scope.document;
        if (!doc || !this.renderer || !this.renderer.canvas) return null;
        if (!this.canvas) {
            const c = doc.createElement('canvas');
            Object.assign(c.style, {position: 'fixed', pointerEvents: 'none', zIndex: '5', left: '0', top: '0'});
            c.setAttribute('aria-hidden', 'true');
            doc.body.appendChild(c);
            this.canvas = c;
        }
        return this.canvas;
    }

    /**
     * 畫出偵測框。
     * @param {Array<{x1: number, y1: number, x2: number, y2: number, label?: string}>} boxes - 舞台座標
     * @returns {void}
     */
    draw (boxes) {
        const c = this._ensure();
        if (!c) return;
        const rect = this.renderer.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            c.style.display = 'none';
            return;
        }
        c.style.display = 'block';
        c.style.left = `${rect.left}px`;
        c.style.top = `${rect.top}px`;
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
        if (c.width !== Math.round(rect.width)) c.width = Math.round(rect.width);
        if (c.height !== Math.round(rect.height)) c.height = Math.round(rect.height);
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, c.width, c.height);
        const sx = c.width / STAGE_W;
        const sy = c.height / STAGE_H;
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff8c1a';
        ctx.fillStyle = '#ff8c1a';
        ctx.font = '12px system-ui, "Noto Sans TC", sans-serif';
        for (const b of boxes) {
            // 舞台座標 → 畫布像素（y 軸方向相反）
            const left = (Math.min(b.x1, b.x2) + 240) * sx;
            const right = (Math.max(b.x1, b.x2) + 240) * sx;
            const top = (180 - Math.max(b.y1, b.y2)) * sy;
            const bottom = (180 - Math.min(b.y1, b.y2)) * sy;
            ctx.strokeRect(left, top, right - left, bottom - top);
            if (b.label) ctx.fillText(b.label, left + 2, Math.max(12, top - 4));
        }
    }

    clear () {
        if (this.canvas) {
            const ctx = this.canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.style.display = 'none';
        }
    }
}

// ---------------------------------------------------------------- 辨識頻率

/**
 * 記錄最近幾次辨識完成的時間，算出每秒辨識次數。
 */
class RateMeter {
    constructor (now = () => Date.now(), windowMs = 2000) {
        this.now = now;
        this.windowMs = windowMs;
        this.stamps = [];
    }

    tick () {
        const t = this.now();
        this.stamps.push(t);
        while (this.stamps.length && this.stamps[0] < t - this.windowMs) this.stamps.shift();
    }

    reset () {
        this.stamps = [];
    }

    /** @returns {number} 每秒辨識次數（四捨五入到小數一位） */
    get rate () {
        const t = this.now();
        const recent = this.stamps.filter(s => s >= t - this.windowMs);
        if (recent.length < 2) return 0;
        const span = recent[recent.length - 1] - recent[0];
        if (span <= 0) return 0;
        return Math.round(((recent.length - 1) / span) * 10000) / 10;
    }
}

// ---------------------------------------------------------------- 計算

/**
 * 兩點的距離（舞台座標）。
 * @returns {number} 距離，四捨五入到小數兩位
 */
function distance (a, b) {
    return Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100;
}

/**
 * 從 a 指向 b 的角度，用 Scratch 的「面朝」方向：0 是上、90 是右、−90 是左、180 是下。
 * @returns {number} −180～180，四捨五入到小數一位
 */
function direction (a, b) {
    const deg = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    return Math.round(deg * 10) / 10;
}

module.exports = {STAGE_W, STAGE_H, listCameras, useCamera, captureStage, BoxOverlay, RateMeter, distance, direction};
