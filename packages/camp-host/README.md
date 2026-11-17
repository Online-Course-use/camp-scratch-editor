# 營隊編輯器外殼（camp-host）

營隊學習平台（`camp.fantageeks.com`）的 Scratch 編輯器。被營隊網站以 iframe 嵌入，**只做三件事：載入專案、匯出專案（含舞台縮圖）、驗證嵌入權杖**。
本倉庫是 [`scratchfoundation/scratch-editor`](https://github.com/scratchfoundation/scratch-editor)（**v15.1.1**，AGPL-3.0）的 fork：
在官方「添加擴展」清單加入營隊的擴展，並新增本套件。**fork 版本凍結，不追官方更新，需要時才由維護者決定更新。**
依 [GNU AGPL v3](../../LICENSE) 公開原始碼；第三方元件與商標聲明見 [NOTICE.md](./NOTICE.md)。

## 這個倉庫有什麼

| 位置 | 內容 |
|---|---|
| `packages/scratch-gui`、`scratch-vm`…… | 官方 scratch-editor 的 monorepo，**只做三類修改**：① 營隊擴展的程式碼與註冊 ② 「添加擴展」清單的卡片 ③ 繁中文案 |
| `packages/scratch-vm/src/extensions/scratch3_*` | 營隊擴展（Arduino、臉部網格…） |
| `packages/camp-host/` | **本套件**：iframe 外殼。`bridge.ts` 來源檢查與請求對應、`token.ts` ES256 公鑰驗章、`editor/` 掛上 scratch-gui |

外殼不持有任何東西：無資料庫、無帳號、無機密。專案內容只經 `postMessage` 進出（協定 v1.2，權威定義見營隊網站 SPEC 8.3）。

## 建置（Windows 實測過，Node 24）

營隊網站**不得**含這個倉庫的程式碼；兩邊只經 iframe 與 postMessage 溝通。建置分兩段，**不要在 Vercel 上建 scratch-gui**（太重），在本機或 GitHub Actions 建好再部署靜態檔。

```bash
# 在倉庫根目錄
npm install --ignore-scripts                          # canvas 的原生編譯在 Windows 會失敗，只有測試用得到，所以略過腳本
npm run prepare --workspace @scratch/scratch-gui      # 下載 micro:bit 的 hex（需要網路）
# 依序建置：task-herder → scratch-storage → scratch-svg-renderer → scratch-paint → scratch-render → scratch-vm → scratch-gui
# gui 用 npm run build:dist-standalone --workspace @scratch/scratch-gui

# 外殼（獨立的 npm 專案，不在根目錄的 workspaces 裡）
cd packages/camp-host
npm install
npm run mirror-models    # 下載 AI 模型、複製 ml5 到 public/models、public/vendor（需要網路；會核對雜湊，可重複執行）
npm run mirror-assets    # 下載素材庫（角色、造型、背景、音效）到 public/library-assets（約 58 MB；少了這步，素材庫選了會載入失敗）
npm run build            # prebuild 會把 ../scratch-gui/dist 複製到 public/，再由 Vite 輸出到 dist/
```

AI 擴展的函式庫（ml5）與模型**不打包進 scratch-gui**：學員加入擴展時才從本網域的 `/vendor/`、`/models/` 載入，所以沒用到 AI 擴展的學員不會多下載。少了 `mirror-models` 這一步，擴展會顯示「臉部辨識無法啟動」。

⚠️ 踩過的雷：不要用 `npm install <套件> --workspace …` 單獨安裝（會把已提升的相依套件修剪掉）；不要同時跑兩個 `npm install`。

## 本機開發

```bash
cd packages/camp-host
cp .env.example .env.local   # VITE_TOKEN_PUBLIC_KEY 由營隊網站的 `npm run keys:editor -- --write <本資料夾>` 寫入
npm run dev                  # 編輯器 http://localhost:5174（營隊網站在 3000，EDITOR_ORIGIN 要設成這個）
npm run harness              # 假的營隊網站 http://localhost:5175，用來單獨測 postMessage（另開終端機）
npm test                     # 協定、bridge、權杖的單元測試
```

## 設定（全部可公開）

| 變數 | 說明 |
|---|---|
| `VITE_TOKEN_PUBLIC_KEY` | ES256 **公鑰**（與營隊網站的 `EDITOR_TOKEN_PRIVATE_KEY` 成對） |
| `VITE_ALLOWED_ORIGINS` | 允許嵌入本編輯器的來源（逗號分隔）；同時決定 CSP 的 `frame-ancestors` |
| `VITE_SOURCE_URL` | 本倉庫的公開網址，顯示在編輯器右下角（AGPL 義務：向使用者提供原始碼） |

## 安全標頭

見 `vercel.json`（正式）與 `vite.config.ts`（本機，同一份政策）：`frame-ancestors` 只允許營隊網站；`connect-src` 只有本網域加三個外部網域：`storage.googleapis.com`、`teachablemachine.withgoogle.com`（Teachable Machine），以及 `synthesis-service.scratch.mit.edu`（官方「文字轉語音」擴展）。官方「翻譯」擴展在我們的網域無法使用：Scratch 的翻譯伺服器只接受來自 `scratch.mit.edu` 的請求（CORS），開放 `connect-src` 也沒用；`Permissions-Policy` 不封鎖鏡頭、麥克風、序列埠。

## Arduino 韌體

`public/firmware/` 放預先編譯好的 **StandardFirmata**（Firmata 2.5.9，`arduino:avr:uno`，57600 baud），供網頁內燒錄用（見 `NOTICE.md` 的授權與雜湊）。擴展只從本網域載入它，並先核對 SHA-256。
