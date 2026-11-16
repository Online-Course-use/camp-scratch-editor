# 著作權與授權聲明

本倉庫是 [`scratchfoundation/scratch-editor`](https://github.com/scratchfoundation/scratch-editor) **v15.1.1**（commit `99bcc17e`）的 fork，依 **GNU Affero General Public License v3.0**（AGPL-3.0）授權，全文見倉庫根目錄的 [LICENSE](../../LICENSE)。
我們修改過的檔案在 git 歷史中可查（`git log 99bcc17..`）；fork 凍結在此基底，不追官方更新。

## 營隊新增或修改的部分

| 項目 | 位置 | 說明 |
|---|---|---|
| 編輯器外殼 | `packages/camp-host/` | 本套件。來源是主平台的「積木編輯器宿主」（同為 AGPL-3.0），2026-11 複製進來並改為營隊用途 |
| 擴展註冊與清單卡片 | `packages/scratch-vm/src/extension-support/extension-manager.js`、`packages/scratch-gui/src/lib/libraries/extensions/index.jsx` | 把營隊擴展加進官方「添加擴展」清單 |
| 8×8 LED 矩陣欄位 | `packages/scratch-gui/src/lib/camp-matrix8.js`、`packages/scratch-gui/src/lib/blocks.js`、`packages/scratch-vm/src/extension-support/argument-type.js`、`packages/scratch-vm/src/engine/runtime.js` | Arduino「LED 矩陣顯示圖案」的點選格子。改寫自 scratch-blocks 2.1.19 的 `src/fields/field_matrix.ts`（5×5，Copyright 2016 Massachusetts Institute of Technology，Apache-2.0），營隊改為 8×8（2026-11-16） |
| 舞台顯示器 id 修正 | `packages/scratch-vm/src/engine/runtime.js`、`packages/scratch-vm/src/serialization/sb3.js` | 修正上游的問題：擴展的回報積木在工具箱沒有固定 id，勾選顯示在舞台上後重新整理會重複、舊的關不掉。改為以 opcode 當 id，載入舊作品時合併重複的顯示器（2026-11-10） |
| 8×8 矩陣積木存檔修正 | `packages/scratch-vm/src/serialization/sb3.js` | 營隊的 8×8 LED 矩陣 shadow 積木 `camp_matrix8` 會被當成擴展 `camp` 寫進作品、重新開啟時載入失敗；把 `camp` 列為非擴展前綴（2026-11-16） |

## 營隊擴展與其來源

| 擴展 | 位置 | 來源與授權 |
|---|---|---|
| Arduino Uno | `packages/scratch-vm/src/extensions/scratch3_camparduino/` | **營隊自行撰寫**（AGPL-3.0）。以 WebSerial 實作 Firmata 協定的子集（含 I2C、軟體序列埠）、營隊韌體的自訂指令與 STK500v1 燒錄；協定規格見 https://github.com/firmata/protocol 與 Atmel AVR061。2026-11-11 依使用者指定補上 qblock 的零件積木，只參考其功能，積木文字與程式為營隊撰寫 |
| 臉部網格 | `packages/scratch-vm/src/extensions/scratch3_facemesh2scratch/` | 改寫自 [champierre/facemesh2scratch](https://github.com/champierre/facemesh2scratch)（AGPL-3.0）。**營隊於 2026-11 修改**：函式庫改為延遲載入、模型改由本網域提供、移除 `alert()`、沒有臉時清空資料、新增繁體中文（修改內容列於 `index.js` 檔頭）。視覺類擴展共用的 `packages/scratch-vm/src/extensions/camp_shared/`（`loader.js` 延遲載入與模型改導、`vision.js` 選擇攝影機／偵測框／舞台截圖、`vision-extension.js` 共用基底）為營隊自行撰寫（AGPL-3.0）；依 SPEC 7.7 新增的積木（具名特徵點、距離／角度等）亦為營隊撰寫。執行時使用 ml5.js 0.12.2（MIT）與其內含的 TensorFlow.js（Apache-2.0），見下方「AI 模型與函式庫」 |
| 手部姿勢 | `packages/scratch-vm/src/extensions/scratch3_handpose2scratch/` | 改寫自 [champierre/handpose2scratch](https://github.com/champierre/handpose2scratch)（AGPL-3.0，commit `8d70fa3e`，2025-10-01）；清單卡片圖示取自同一倉庫。**營隊於 2026-11 修改**：改用上述共用基底（延遲載入、模型自架、不用 `alert()`）、手離開畫面時清空資料、依 SPEC 7.7.2 調整積木、新增繁體中文。執行時使用 ml5.js 0.12.2 內含的 handpose（Apache-2.0） |
| 姿態網路 | `packages/scratch-vm/src/extensions/scratch3_posenet2scratch/` | 改寫自 [champierre/posenet2scratch](https://github.com/champierre/posenet2scratch)（AGPL-3.0，commit `94f396d7`，2025-05-03）；清單卡片圖示取自同一倉庫。**營隊於 2026-11 修改**：改用共用基底（延遲載入、模型自架、不用 `alert()`、沒有人時清空）、依 SPEC 7.7.3 調整積木（34 個專用積木改為具名選單，原積木保留不顯示）、不再改動共用影像元素的大小、新增繁體中文。執行時使用 ml5.js 0.12.2 內含的 PoseNet（Apache-2.0） |
| 影像訓練器 | `packages/scratch-vm/src/extensions/scratch3_ml2scratch/` | 改寫自 [champierre/ml2scratch](https://github.com/champierre/ml2scratch)（AGPL-3.0，commit `ba1ad68e`，2026-09-17；該倉庫 `package.json` 寫 MIT、`LICENSE` 檔為 AGPL-3.0，一律以 AGPL-3.0 處理）；清單卡片圖示取自同一倉庫。**營隊於 2026-11 修改**：改用共用基底、移除 `alert`／`confirm` 改為不阻塞的對話框（`camp_shared/dialog.js`，營隊撰寫）、學習資料改為營隊自訂格式並驗證（`learning-data.js`，營隊撰寫）、修正辨識結果與記憶體釋放的錯誤、依 SPEC 7.7.5 新增積木、新增繁體中文。執行時使用 ml5.js 0.12.2 內含的特徵擷取器與 KNN 分類器（Apache-2.0） |
| 語音辨識 | `packages/scratch-vm/src/extensions/scratch3_campspeech/` | **營隊自行撰寫**（AGPL-3.0）。使用瀏覽器內建的 Web Speech API（聲音由瀏覽器送到 Google 的語音服務）。圖示為營隊繪製 |
| Teachable Machine（影像、聲音） | `packages/scratch-vm/src/extensions/scratch3_tm2scratch/` | 改寫自 [champierre/tm2scratch](https://github.com/champierre/tm2scratch)（AGPL-3.0，commit `d018790`，2026-03-05）；積木圖示取自同一倉庫。**營隊於 2026-11 修改**：不再於執行時載入第三方網站的 ml5（改用本網域的 ml5 0.12.2）、模型網址白名單、改用共用基底、新增繁體中文。共用的 `camp_shared/teachable.js`、`camp_shared/teachable-extension.js` 為營隊撰寫 |
| Teachable Machine（姿態） | `packages/scratch-vm/src/extensions/scratch3_tmpose2scratch/` | 改寫自 [champierre/tmpose2scratch](https://github.com/champierre/tmpose2scratch)（AGPL-3.0，commit `2b14da3`，2024-11-29）；積木圖示取自同一倉庫。**營隊於 2026-11 修改**：TensorFlow.js 與 @teachablemachine/pose 改為本網域自架、模型網址白名單、分類模型層名加前綴以免與 ml5 撞名、改用共用基底、新增繁體中文 |


## 隨附的預編譯韌體

| 檔案 | 授權 | 來源 |
|---|---|---|
| `public/firmware/CampFirmata-1.1.0-uno.hex` | **GNU LGPL-2.1-or-later**（Firmata 函式庫與營隊修改）、Adafruit NeoPixel（LGPL-3.0）、Arduino AVR 核心（LGPL-2.1） | 營隊韌體（1.1，2026-11-16）：Firmata 函式庫 **2.5.9** 的範例 StandardFirmata 加上營隊自訂指令（音調、脈衝寬度、超音波、DHT11、WS2812、MAX7219）。**修改後的完整原始碼在本倉庫 `packages/camp-host/firmware/`**（含建置方式與 Adafruit NeoPixel 1.15.5 原始碼），使用者可自行重新編譯替換，符合 LGPL 的要求。Firmata 原始碼：https://github.com/firmata/arduino （tag `2.5.9`） |
| SHA-256 | `public/firmware/CampFirmata-1.1.0-uno.hex.sha256` | 擴展燒錄前會核對此雜湊 |

## AI 模型與函式庫（執行時由本網域提供）

以下檔案**不納入版控**，由 `scripts/mirror-models.mjs`（`npm run mirror-models`）在建置前準備，並逐一核對 SHA-256（雜湊值寫在該腳本內）。編輯器執行時只從本網域讀取，不連到原始來源。

| 檔案 | 授權 | 來源 |
|---|---|---|
| `public/vendor/ml5-0.12.2.min.js` | MIT（ml5.js）；內含 TensorFlow.js 與 tfjs-models（Apache-2.0）等，其授權聲明保留於檔案內 | npm 套件 `ml5@0.12.2` 的 `dist/ml5.min.js`，**未修改**。原始碼：https://github.com/ml5js/ml5-library （tag `v0.12.2`） |
| `public/models/facemesh/` | Apache-2.0（MediaPipe Face Mesh，Google） | `https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1`，未修改 |
| `public/models/blazeface/` | Apache-2.0（BlazeFace，Google） | `https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1`，未修改 |
| `public/models/handdetector/` | Apache-2.0（MediaPipe Hands 手掌偵測，Google） | `https://tfhub.dev/mediapipe/tfjs-model/handdetector/1/default/1`，未修改 |
| `public/models/handskeleton/` | Apache-2.0（MediaPipe Hands 手部骨架，Google） | `https://tfhub.dev/mediapipe/tfjs-model/handskeleton/1/default/1`（含 `anchors.json`），未修改 |
| `public/models/posenet/` | Apache-2.0（PoseNet，Google） | `https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/quant2/075/`（MobileNetV1、0.75、stride 16），未修改 |
| `public/models/mobilenet-layers/` | Apache-2.0（MobileNet v1，Google） | `https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/`，未修改（影像訓練器擷取特徵用） |
| `public/models/mobilenet-graph/` | Apache-2.0（MobileNet v1，Google） | `https://tfhub.dev/google/imagenet/mobilenet_v1_025_224/classification/1`，未修改（ml5 特徵擷取器會一併載入） |
| `public/models/posenet-float/` | Apache-2.0（PoseNet，Google） | `https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/float/075/`，未修改（Teachable Machine 姿態用） |
| `public/vendor/tfjs-1.3.1.min.js` | Apache-2.0（TensorFlow.js，Google） | npm `@tensorflow/tfjs@1.3.1` 的 `dist/tf.min.js`（建置時自 jsDelivr 下載），未修改 |
| `public/vendor/teachablemachine-pose-0.8.6.min.js` | Apache-2.0（Teachable Machine，Google） | npm `@teachablemachine/pose@0.8.6` 的 `dist/teachablemachine-pose.min.js`（建置時自 jsDelivr 下載），未修改 |

## 第三方元件

| 元件 | 版本 | 授權 | 著作權人 |
|---|---|---|---|
| scratch-gui、scratch-vm、scratch-render、scratch-paint 等（本倉庫 `packages/`） | 15.1.1 | AGPL-3.0-only | Scratch Foundation |
| scratch-blocks（打包於 scratch-gui 內） | 隨 scratch-gui | Apache-2.0 | Massachusetts Institute of Technology / Google |
| jose | 見 package-lock.json | MIT | Filip Skokan |

scratch-gui 預建產物內含的其他相依套件授權聲明，隨附於 `public/gui/scratch-gui-standalone.js.LICENSE.txt`。
完整相依套件授權清單須於上線前產生並留存。

## 素材庫

`public/library-assets/` 中的角色、造型、背景與音效由 `scripts/mirror-library-assets.mjs` 於建置時自 Scratch 官方素材伺服器鏡像，未納入版控。

## 商標

Scratch 名稱、標誌、Scratch Cat 等圖樣為 Scratch Foundation 的商標（見倉庫根目錄的 TRADEMARK 檔）。
本專案與 Scratch Foundation 無任何關聯，亦未獲其背書；介面中不顯示 Scratch 標誌。
