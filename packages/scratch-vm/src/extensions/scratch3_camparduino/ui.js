/* eslint-disable */
// 營隊自己撰寫的程式，格式與註解風格不套用上游的 lint 規則（上游的規則是為官方程式碼訂的）。
/**
 * 燒錄進度的小面板：直接在編輯器頁面右下角顯示一塊訊息，不用會卡住畫面的 alert()。
 * 沒有 DOM（單元測試）時什麼都不做。
 */
let panel = null;
let hideTimer = null;

function ensure () {
    if (typeof document === 'undefined') return null;
    if (!panel) {
        panel = document.createElement('div');
        panel.setAttribute('role', 'status');
        panel.setAttribute('aria-live', 'polite');
        Object.assign(panel.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: '99999',
            maxWidth: '360px',
            padding: '12px 16px',
            border: '2px solid #000',
            borderRadius: '6px',
            background: '#fff',
            color: '#111',
            font: '14px/1.5 system-ui, "Noto Sans TC", sans-serif',
            boxShadow: '3px 3px 0 #000',
            whiteSpace: 'pre-line'
        });
        document.body.appendChild(panel);
    }
    return panel;
}

/**
 * 顯示一則訊息。
 * @param {string} text - 內容
 * @param {object} [options] - kind：'info'（預設）、'error' 或 'ok'；autoHideMs：幾毫秒後自動隱藏（錯誤不會自動隱藏）
 * @returns {void}
 */
function show (text, {kind = 'info', autoHideMs = 0} = {}) {
    const el = ensure();
    if (!el) return;
    clearTimeout(hideTimer);
    el.textContent = text;
    el.style.background = kind === 'error' ? '#fee2e2' : kind === 'ok' ? '#dcfce7' : '#fff';
    el.style.display = 'block';
    if (kind === 'error') {
        el.textContent = `${text}\n（點一下這裡關閉）`;
        el.style.cursor = 'pointer';
        el.onclick = hide;
    } else {
        el.style.cursor = 'default';
        el.onclick = null;
    }
    if (autoHideMs > 0) hideTimer = setTimeout(hide, autoHideMs);
}

function hide () {
    clearTimeout(hideTimer);
    if (panel) panel.style.display = 'none';
}

module.exports = {show, hide};
