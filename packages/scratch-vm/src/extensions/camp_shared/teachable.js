/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * Teachable Machine 兩個擴展（影像／聲音、姿態）共用的工具。
 *
 * - 模型網址白名單（SPEC 7.3.4、7.7.6）：只允許 Teachable Machine 的分享連結
 *   （teachablemachine.withgoogle.com/models/…，或它實際存放的 storage.googleapis.com/tm-model/…）。
 *   其他網址在擴展內就拒絕，不只靠安全標頭。
 * - 依 metadata.json 判斷模型是影像、聲音還是姿態，放錯積木時給清楚的提示。
 */

const TYPE_TEXT = {image: '圖片', sound: '聲音', pose: '姿態'};

/** 原版各語言的「任何」選項，舊作品存的是這些文字。 */
const ANY_VALUES = ['any', '任何', 'どれか', 'のどれか', '어떤', 'irgendeine'];
const isAny = value => ANY_VALUES.includes(String(value));

class TeachableError extends Error {}

/**
 * 檢查並整理 Teachable Machine 的分享連結。
 * @param {string} input - 學員貼上的網址
 * @returns {string} 以 / 結尾的模型資料夾網址
 */
function normalizeModelUrl (input) {
    const text = String(input || '').trim();
    let url;
    try {
        url = new URL(text);
    } catch (e) {
        throw new TeachableError('請貼上 Teachable Machine 的分享連結（https://teachablemachine.withgoogle.com/models/…）');
    }
    const ok = url.protocol === 'https:' && !url.username && !url.password && !url.port && (
        (url.hostname === 'teachablemachine.withgoogle.com' && /^\/models\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) ||
        (url.hostname === 'storage.googleapis.com' && /^\/tm-model\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))
    );
    if (!ok) {
        throw new TeachableError('只能使用 Teachable Machine 的分享連結（https://teachablemachine.withgoogle.com/models/…），其他網址不能載入');
    }
    return `${url.origin}${url.pathname.replace(/\/?$/, '/')}`;
}

/**
 * 從 metadata.json 判斷模型類型。
 * @param {object} metadata - Teachable Machine 的 metadata.json
 * @returns {'image'|'sound'|'pose'|null} 類型；認不出來時為 null
 */
function modelType (metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    const pkg = String(metadata.packageName || '');
    if (pkg.includes('pose') || metadata.modelSettings && metadata.modelSettings.posenet) return 'pose';
    if (Array.isArray(metadata.wordLabels)) return 'sound';
    if (pkg.includes('image') || Array.isArray(metadata.labels)) return 'image';
    return null;
}

/** 模型的標籤清單。 */
function modelLabels (metadata) {
    if (!metadata) return [];
    const labels = Array.isArray(metadata.wordLabels) ? metadata.wordLabels : metadata.labels;
    return Array.isArray(labels) ? labels.map(String) : [];
}

/**
 * 讀取 metadata.json 並確認類型正確。
 * @param {object} scope - 瀏覽器的 window（用它的 fetch）
 * @param {string} url - normalizeModelUrl 整理過的網址
 * @param {string} expected - 'image'、'sound' 或 'pose'
 * @returns {Promise<object>} metadata
 */
async function fetchMetadata (scope, url, expected) {
    let res;
    try {
        res = await scope.fetch(`${url}metadata.json`, {cache: 'no-store'});
    } catch (e) {
        throw new TeachableError('連不到 Teachable Machine，請檢查網路（教室網路要能連到 Google）');
    }
    if (!res.ok) throw new TeachableError(`找不到這個模型（HTTP ${res.status}），請確認在 Teachable Machine 按了「上傳我的模型」並複製了正確的連結`);
    let metadata;
    try {
        metadata = await res.json();
    } catch (e) {
        throw new TeachableError('這個連結不是 Teachable Machine 的模型');
    }
    const type = modelType(metadata);
    if (!type) throw new TeachableError('這個連結不是 Teachable Machine 的模型');
    if (expected === 'image' && type === 'sound') throw new TeachableError('這是聲音模型，請改用「設定聲音模型網址」積木');
    if (expected === 'sound' && type === 'image') throw new TeachableError('這是圖片模型，請改用「設定圖片模型網址」積木');
    if (type !== expected) {
        const where = type === 'pose' ? '「Teachable Machine（姿態）」擴展' : '「Teachable Machine（影像、聲音）」擴展';
        throw new TeachableError(`這是${TYPE_TEXT[type]}模型，請改用${where}`);
    }
    if (!modelLabels(metadata).length) throw new TeachableError('這個模型沒有任何標籤');
    return metadata;
}

/**
 * 取信心最高的一項；低於門檻時回傳 null。
 * @param {Array<{label: string, confidence: number}>} probs - 辨識結果
 * @param {number} threshold - 最低信心
 * @returns {{label: string, confidence: number}|null} 結果
 */
function topLabel (probs, threshold) {
    let best = null;
    for (const p of probs || []) if (!best || p.confidence > best.confidence) best = p;
    return best && best.confidence >= threshold ? best : null;
}

/**
 * 把畫面中央的正方形畫到 size × size 的畫布（Teachable Machine 用正方形的攝影機畫面訓練）。
 * @param {object} scope - 瀏覽器的 window
 * @param {object} input - video 或 canvas
 * @param {number} size - 輸出大小
 * @param {boolean} flip - 是否左右翻轉（照鏡子）
 * @param {HTMLCanvasElement} [reuse] - 重複使用的畫布
 * @returns {HTMLCanvasElement|object} 畫布；沒有 DOM 時原樣回傳 input
 */
function squareCrop (scope, input, size, flip, reuse = null) {
    if (!scope.document) return input;
    const w = input.videoWidth || input.width;
    const h = input.videoHeight || input.height;
    if (!w || !h) return input;
    const canvas = reuse || scope.document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const side = Math.min(w, h);
    ctx.save();
    if (flip) {
        ctx.translate(size, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(input, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    ctx.restore();
    return canvas;
}

module.exports = {TYPE_TEXT, ANY_VALUES, isAny, TeachableError, normalizeModelUrl, modelType, modelLabels, fetchMetadata, topLabel, squareCrop};
