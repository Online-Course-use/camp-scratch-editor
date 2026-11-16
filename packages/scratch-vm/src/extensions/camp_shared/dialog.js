/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 不會卡住畫面的對話框（取代 confirm()、alert() 與原版的上傳視窗）。
 * 積木會等使用者按下按鈕才往下執行（回傳 Promise），但編輯器其他部分照常運作。
 * 外觀與 ../scratch3_camparduino/ui.js 的訊息面板一致。沒有 DOM（單元測試）時直接回傳「取消」。
 */

const BUTTON_STYLE = {
    padding: '6px 14px',
    border: '2px solid #000',
    borderRadius: '6px',
    font: 'inherit',
    cursor: 'pointer',
    boxShadow: '2px 2px 0 #000'
};

/**
 * 建立一個置中的對話框。
 * @param {object} scope - 瀏覽器的 window
 * @param {string} message - 說明文字
 * @returns {{root: HTMLElement, box: HTMLElement, buttons: HTMLElement, close: function}|null} 對話框；沒有 DOM 時回傳 null
 */
function createBox (scope, message) {
    const doc = scope.document;
    if (!doc || !doc.body) return null;
    const root = doc.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '100000',
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });
    const box = doc.createElement('div');
    Object.assign(box.style, {
        maxWidth: '420px',
        padding: '16px 20px',
        border: '2px solid #000',
        borderRadius: '8px',
        background: '#fff',
        color: '#111',
        font: '15px/1.6 system-ui, "Noto Sans TC", sans-serif',
        boxShadow: '4px 4px 0 #000',
        whiteSpace: 'pre-line'
    });
    const text = doc.createElement('div');
    text.textContent = message;
    const buttons = doc.createElement('div');
    Object.assign(buttons.style, {display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px'});
    box.appendChild(text);
    box.appendChild(buttons);
    root.appendChild(box);
    doc.body.appendChild(root);
    return {root, box, buttons, close: () => root.remove()};
}

function addButton (scope, parent, label, primary) {
    const b = scope.document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, BUTTON_STYLE, {background: primary ? '#ff8c1a' : '#fff', color: '#111'});
    parent.appendChild(b);
    return b;
}

/**
 * 確認對話框。
 * @param {object} scope - 瀏覽器的 window
 * @param {string} message - 要確認的內容
 * @param {object} [options] - okText：確定按鈕的文字
 * @returns {Promise<boolean>} 按「確定」為 true；「取消」、按 Esc 或沒有 DOM 為 false
 */
function confirmDialog (scope, message, {okText = '確定'} = {}) {
    const d = createBox(scope, message);
    if (!d) return Promise.resolve(false);
    return new Promise(resolve => {
        const done = value => {
            scope.document.removeEventListener('keydown', onKey, true);
            d.close();
            resolve(value);
        };
        const onKey = e => {
            if (e.key === 'Escape') done(false);
        };
        addButton(scope, d.buttons, '取消', false).onclick = () => done(false);
        const ok = addButton(scope, d.buttons, okText, true);
        ok.onclick = () => done(true);
        scope.document.addEventListener('keydown', onKey, true);
        if (ok.focus) ok.focus();
    });
}

/**
 * 選檔對話框：讓使用者選一個檔案（按鈕是使用者自己按的，瀏覽器才允許開啟選檔視窗）。
 * @param {object} scope - 瀏覽器的 window
 * @param {string} message - 說明文字
 * @param {object} [options] - accept：可選的檔案類型
 * @returns {Promise<File|null>} 選到的檔案；取消或沒有 DOM 時為 null
 */
function pickFileDialog (scope, message, {accept = ''} = {}) {
    const d = createBox(scope, message);
    if (!d) return Promise.resolve(null);
    return new Promise(resolve => {
        const input = scope.document.createElement('input');
        input.type = 'file';
        if (accept) input.accept = accept;
        input.style.marginTop = '10px';
        d.box.insertBefore(input, d.buttons);
        const done = value => {
            d.close();
            resolve(value);
        };
        addButton(scope, d.buttons, '取消', false).onclick = () => done(null);
        addButton(scope, d.buttons, '載入', true).onclick = () => done((input.files && input.files[0]) || null);
    });
}

/**
 * 讓瀏覽器下載一個檔案。
 * @param {object} scope - 瀏覽器的 window
 * @param {string} filename - 檔名
 * @param {string} text - 檔案內容
 * @param {string} [type] - MIME 類型
 * @returns {boolean} 有沒有成功觸發下載
 */
function downloadText (scope, filename, text, type = 'application/json') {
    const doc = scope.document;
    if (!doc || !scope.URL || !scope.Blob) return false;
    const url = scope.URL.createObjectURL(new scope.Blob([text], {type}));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => scope.URL.revokeObjectURL(url), 10000);
    return true;
}

module.exports = {confirmDialog, pickFileDialog, downloadText};
