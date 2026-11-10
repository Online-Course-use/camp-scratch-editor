/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 臉部網格的「延遲載入」與「模型自架」。
 *
 * - ml5 不打包進編輯器主程式（整包約 3.3 MB）。學員加入這個擴展時，才從本網域的
 *   /vendor/ 用 <script> 載入。
 * - ml5 0.12.2 把模型網址寫死為 tfhub.dev，也沒有提供改網址的選項。編輯器的安全標頭不允許
 *   連到那裡，所以在「載入模型的這段時間」把這兩個固定網址改導到本網域的 /models/，
 *   載入完成就還原，不影響頁面上其他的網路請求。
 *
 * 檔案由 packages/camp-host/scripts/mirror-models.mjs 準備（含雜湊核對）。
 */
const ML5_URL = '/vendor/ml5-0.12.2.min.js';

const MODEL_ROUTES = [
    ['https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1/', '/models/facemesh/'],
    ['https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/', '/models/blazeface/']
];

/**
 * 模型的原始網址對應到本網域的哪個檔案。
 * @param {string} url - 函式庫想下載的網址
 * @returns {string|null} 本網域的路徑；不是我們自架的模型就回傳 null
 */
function localModelUrl (url) {
    if (typeof url !== 'string') return null;
    for (const [from, to] of MODEL_ROUTES) {
        if (url.startsWith(from)) {
            const file = url.slice(from.length).split(/[?#]/)[0];
            // 只接受單純的檔名，避免被拿來讀取其他路徑
            if (!/^[A-Za-z0-9._-]+$/.test(file)) return null;
            return to + file;
        }
    }
    return null;
}

/**
 * 在執行 fn 的期間，把模型下載改導到本網域；結束（成功或失敗）後還原。
 * @param {object} scope - 有 fetch 的物件（瀏覽器的 window）
 * @param {function(): Promise} fn - 會觸發模型下載的動作
 * @returns {Promise} fn 的結果
 */
async function withLocalModels (scope, fn) {
    const original = scope.fetch;
    const redirected = function (input, init) {
        const local = localModelUrl(typeof input === 'string' ? input : input && input.url);
        return original.call(scope, local || input, init);
    };
    scope.fetch = redirected;
    try {
        return await fn();
    } finally {
        if (scope.fetch === redirected) scope.fetch = original;
    }
}

/** 每個 window 進行中的載入（避免同時插入兩個 <script>）。 */
const loading = new WeakMap();

/**
 * 載入 ml5（只載入一次；失敗可以重試）。
 * @param {object} [scope] - 瀏覽器的 window
 * @returns {Promise<object>} ml5
 */
function loadMl5 (scope = globalThis) {
    if (scope.ml5) return Promise.resolve(scope.ml5);
    if (loading.has(scope)) return loading.get(scope);
    const promise = new Promise((resolve, reject) => {
        const doc = scope.document;
        if (!doc) {
            reject(new Error('沒有瀏覽器環境'));
            return;
        }
        const script = doc.createElement('script');
        script.src = ML5_URL;
        script.async = true;
        script.onload = () => (scope.ml5 ? resolve(scope.ml5) : reject(new Error('函式庫載入後沒有啟動')));
        script.onerror = () => {
            script.remove();
            reject(new Error('函式庫下載失敗'));
        };
        doc.head.appendChild(script);
    }).catch(err => {
        loading.delete(scope);
        throw err;
    });
    loading.set(scope, promise);
    return promise;
}

module.exports = {ML5_URL, MODEL_ROUTES, localModelUrl, withLocalModels, loadMl5};
