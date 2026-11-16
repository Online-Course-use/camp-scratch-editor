/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 影像訓練器「學習資料」檔案的格式與驗證（SPEC 7.7.5：載入時必須驗證格式與大小，只接受本擴展匯出的檔案）。
 *
 * 檔案是 JSON：
 *   { format: 'camp-image-trainer', version: 1, feature: FEATURE_ID, dim: 256,
 *     labelNames: { '1': '剪刀', … },
 *     examples: { '1': { count: 8, data: '<base64 的 Float32 陣列，count × dim 個數字>' }, … } }
 * examples 存的是 KNN 分類器內部的資料（每個樣本是 MobileNet 擷取的特徵），不是照片，看不出原本的畫面。
 */

const FORMAT = 'camp-image-trainer';
const VERSION = 1;
/** 特徵來源：ml5 特徵擷取器 MobileNet v1（alpha 0.25），conv_pw_13_relu 層經平均池化後的 256 個數字（瀏覽器實測 shape [1, 256]）。 */
const FEATURE_ID = 'mobilenet_v1_0.25_224/conv_pw_13_relu';
const FEATURE_DIM = 256;
const MAX_LABEL = 10;
const MAX_EXAMPLES_PER_LABEL = 500;
/** 檔案大小上限 10 MB。每個樣本存成檔案約 1.4 KB（256 個數字 × 4 bytes，再經 base64），10 個標籤 × 500 個樣本也只要約 7 MB。 */
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 50;

function bytesToBase64 (bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(s);
}

function base64ToBytes (b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

/**
 * 產生學習資料檔案的內容。
 * @param {object} data - labelNames：{標籤: 名稱}；examples：{標籤: Float32Array（count × dim）}
 * @returns {string} JSON 文字
 */
function encode ({labelNames = {}, examples = {}}) {
    const out = {format: FORMAT, version: VERSION, feature: FEATURE_ID, dim: FEATURE_DIM, labelNames: {}, examples: {}};
    for (const [label, name] of Object.entries(labelNames)) if (name) out.labelNames[label] = String(name);
    for (const [label, values] of Object.entries(examples)) {
        if (!values || !values.length) continue;
        out.examples[label] = {count: values.length / FEATURE_DIM, data: bytesToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))};
    }
    return JSON.stringify(out);
}

/** 驗證失敗時丟出的錯誤，訊息是給學員看的繁中說明。 */
class LearningDataError extends Error {}

const isLabel = key => /^(10|[1-9])$/.test(key);

/**
 * 讀取並驗證學習資料檔案。
 * @param {string} text - 檔案內容
 * @param {number} [size] - 檔案大小（bytes），先檢查大小再讀內容
 * @returns {{labelNames: object, examples: object}} examples：{標籤: {count, values: Float32Array}}
 */
function decode (text, size = text.length) {
    if (size > MAX_BYTES) throw new LearningDataError(`檔案太大（上限 ${MAX_BYTES / 1024 / 1024} MB）`);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new LearningDataError('這不是影像訓練器的學習資料檔（不是 JSON 格式）');
    }
    if (!obj || typeof obj !== 'object' || obj.format !== FORMAT) {
        throw new LearningDataError('這不是用「儲存學習資料」存下來的檔案');
    }
    if (obj.version !== VERSION) throw new LearningDataError(`學習資料的版本不符（${obj.version}）`);
    if (obj.feature !== FEATURE_ID || obj.dim !== FEATURE_DIM) throw new LearningDataError('學習資料是用不同的模型做的，不能載入');
    if (!obj.examples || typeof obj.examples !== 'object' || Array.isArray(obj.examples)) throw new LearningDataError('學習資料的內容不完整');

    const examples = {};
    for (const [label, ex] of Object.entries(obj.examples)) {
        if (!isLabel(label)) throw new LearningDataError(`標籤只能是 1–${MAX_LABEL}（檔案裡有「${label}」）`);
        if (!ex || !Number.isInteger(ex.count) || ex.count < 1 || ex.count > MAX_EXAMPLES_PER_LABEL || typeof ex.data !== 'string') {
            throw new LearningDataError(`標籤 ${label} 的資料不正確`);
        }
        const bytes = base64ToBytes(ex.data);
        if (bytes.length !== ex.count * FEATURE_DIM * 4) throw new LearningDataError(`標籤 ${label} 的資料長度不對`);
        const values = new Float32Array(bytes.buffer, bytes.byteOffset, ex.count * FEATURE_DIM);
        for (let i = 0; i < values.length; i++) {
            if (!Number.isFinite(values[i])) throw new LearningDataError(`標籤 ${label} 的資料不正確`);
        }
        examples[label] = {count: ex.count, values};
    }
    if (!Object.keys(examples).length) throw new LearningDataError('學習資料裡沒有任何樣本');

    const labelNames = {};
    if (obj.labelNames && typeof obj.labelNames === 'object') {
        for (const [label, name] of Object.entries(obj.labelNames)) {
            if (isLabel(label) && typeof name === 'string') labelNames[label] = name.slice(0, MAX_NAME_LENGTH);
        }
    }
    return {labelNames, examples};
}

module.exports = {FORMAT, VERSION, FEATURE_ID, FEATURE_DIM, MAX_LABEL, MAX_BYTES, MAX_NAME_LENGTH, encode, decode, LearningDataError};
