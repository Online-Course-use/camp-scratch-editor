# 著作權與授權聲明

本倉庫是 [`scratchfoundation/scratch-editor`](https://github.com/scratchfoundation/scratch-editor) **v15.1.1**（commit `99bcc17e`）的 fork，依 **GNU Affero General Public License v3.0**（AGPL-3.0）授權，全文見倉庫根目錄的 [LICENSE](../../LICENSE)。
我們修改過的檔案在 git 歷史中可查（`git log 99bcc17..`）；fork 凍結在此基底，不追官方更新。

## 營隊新增或修改的部分

| 項目 | 位置 | 說明 |
|---|---|---|
| 編輯器外殼 | `packages/camp-host/` | 本套件。來源是主平台的「積木編輯器宿主」（同為 AGPL-3.0），2026-11 複製進來並改為營隊用途 |
| 擴展註冊與清單卡片 | `packages/scratch-vm/src/extension-support/extension-manager.js`、`packages/scratch-gui/src/lib/libraries/extensions/index.jsx` | 把營隊擴展加進官方「添加擴展」清單 |

## 營隊擴展與其來源

| 擴展 | 位置 | 來源與授權 |
|---|---|---|
| Arduino Uno | `packages/scratch-vm/src/extensions/scratch3_camparduino/` | **營隊自行撰寫**（AGPL-3.0）。以 WebSerial 實作 Firmata 協定的最小子集與 STK500v1 燒錄；協定規格見 https://github.com/firmata/protocol 與 Atmel AVR061 |
| 臉部網格 | `packages/scratch-vm/src/extensions/scratch3_facemesh2scratch/` | 改寫自 [champierre/facemesh2scratch](https://github.com/champierre/facemesh2scratch)（AGPL-3.0，M0 讀過的 commit 見 `M0-驗證報告.md`）。依賴 ml5.js 0.12.2（MIT）、TensorFlow.js（Apache-2.0） |

> 其餘擴展（手部姿勢、姿態網路、影像訓練器、語音辨識、Teachable Machine）加入時在此逐項補上：名稱、來源倉庫、鎖定的 commit、授權。

## 隨附的預編譯韌體

| 檔案 | 授權 | 來源 |
|---|---|---|
| `public/firmware/StandardFirmata-2.5.9-uno.hex` | **GNU LGPL-2.1-or-later**（Firmata 函式庫）、Arduino AVR 核心（LGPL-2.1） | 以 Arduino IDE 2 的範例 *Firmata → StandardFirmata* 編譯（Firmata 函式庫 **2.5.9**、`arduino:avr:uno`、AVR core 1.8.8），**未修改原始碼**。原始碼：https://github.com/firmata/arduino （tag `2.5.9`）。LGPL 要求：使用者可以取得函式庫原始碼並自行重新編譯替換——上述連結即為取得方式；Firmata 函式庫的授權全文見該倉庫的 `LICENSE.txt` |
| SHA-256 | `public/firmware/StandardFirmata-2.5.9-uno.hex.sha256` | 擴展載入韌體前會核對此雜湊 |

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
