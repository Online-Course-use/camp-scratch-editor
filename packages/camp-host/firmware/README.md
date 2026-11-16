# 營隊韌體 CampFirmata（Arduino Uno）

營隊 Arduino 擴展用的韌體，學員在編輯器裡點「燒錄 Firmata 韌體」就會燒進 Uno。
建置好的檔案放在 `../public/firmware/CampFirmata-1.1.0-uno.hex`（與 `.sha256`），擴展燒錄前會核對雜湊。

## 內容

| 位置 | 內容 | 授權 |
|---|---|---|
| `CampFirmata/CampFirmata.ino` | Firmata 函式庫 2.5.9 的範例 StandardFirmata，加上營隊修改（檔頭與「營隊修改」標示處） | GNU LGPL 2.1 或更新版本（`CampFirmata/LICENSE.txt`） |
| `CampFirmata/camp_features.h` | 營隊自訂指令：蜂鳴器音調、脈衝寬度、超音波、DHT11、WS2812、MAX7219 | GNU LGPL 2.1 或更新版本 |
| `libraries/Adafruit_NeoPixel/` | Adafruit NeoPixel 1.15.5（WS2812 燈條），未修改 | GNU LGPL 3.0（`libraries/Adafruit_NeoPixel/COPYING`） |

其餘用到的函式庫隨 Arduino IDE 安裝，未修改：Firmata 2.5.9（LGPL 2.1）、Servo 1.3.0（LGPL 2.1）、Arduino AVR 核心 1.8.8（含 Wire、SoftwareSerial，LGPL 2.1）。

網頁端的對應程式：`packages/scratch-vm/src/extensions/scratch3_camparduino/firmata.js`（`CAMP` 的指令編號必須與 `camp_features.h` 一致，單元測試會檢查）。

## 自訂指令（Firmata sysex 0x01–0x06）

| 編號 | 指令 | 送出 | 回覆 |
|---|---|---|---|
| 0x01 | 音調 | 腳位、頻率（3×7 位元）、持續毫秒（3×7，0 = 一直響）；頻率 0 = 停止 | — |
| 0x02 | 脈衝寬度 | 請求編號、腳位、高/低、逾時微秒（4×7） | 請求編號、微秒（5×7） |
| 0x03 | 超音波 | 請求編號、Trig、Echo、逾時微秒（4×7） | 請求編號、微秒（5×7） |
| 0x04 | DHT11 | 請求編號、腳位 | 請求編號、狀態、濕度、濕度小數、溫度、溫度小數（各 2×7） |
| 0x05 | WS2812 | 子指令 0 設定（腳位、顆數）、1 單顆、2 全部、3 亮度、4 顯示、5 熄滅 | — |
| 0x06 | MAX7219 | 子指令 0 設定（DIN、CS、CLK）、1 寫一個橫排、2 亮度 | — |

回覆由 `Firmata.sendSysex` 送出，每個位元組會再拆成兩個 7 位元。
1602 LCD 用 StandardFirmata 原本的 I2C；藍牙模組用 Firmata 標準的軟體序列埠（SERIAL_MESSAGE）。

## 建置（Windows，Arduino IDE 2 內附的 arduino-cli）

```bash
CLI="$LOCALAPPDATA/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
"$CLI" compile --fqbn arduino:avr:uno \
  --libraries "packages/camp-host/firmware/libraries" \
  --libraries "$LOCALAPPDATA/Arduino15/libraries" \
  --output-dir build packages/camp-host/firmware/CampFirmata
cp build/CampFirmata.ino.hex packages/camp-host/public/firmware/CampFirmata-1.1.0-uno.hex
sha256sum packages/camp-host/public/firmware/CampFirmata-1.1.0-uno.hex | cut -c1-64 > packages/camp-host/public/firmware/CampFirmata-1.1.0-uno.hex.sha256
```

2026-11-16 建置結果（1.1）：程式 18,150 bytes（Uno 的 56%）、全域變數 1,039 bytes（剩 1,009 bytes；燈條最多 60 顆，每顆再用 3 bytes）。

改了韌體就要**改版號**：`camp_features.h` 的 `CAMP_FIRMWARE_MAJOR`／`MINOR`、hex 檔名、擴展裡的 `FIRMWARE_URL` 與 `FIRMWARE_MIN`（單元測試會檢查前三者一致）。板子回報的韌體名稱是「CampFirmata 主.次」，低於 `FIRMWARE_MIN` 時，連線後會提示學員重新燒錄。

## 版本

| 版本 | 日期 | 內容 |
|---|---|---|
| 1.0 | 2026-11-11 | 第一版（回報名稱為「CampFirmata.ino 2.5」） |
| 1.1 | 2026-11-16 | 重置後數位腳位 2–13 改為不輸出（StandardFirmata 原本是輸出低電位）；蜂鳴器停止或播完後腳位也改回不輸出；韌體名稱與版本改為「CampFirmata 1.1」。原因：低電位觸發的蜂鳴器模組在腳位為低電位時一直通電，會把 LED 矩陣掃描造成的電源波動放成雜音 |

## 注意

- 沒用到的數位腳位是不輸出（高阻抗），和一般 Arduino 程式相同；已設定的 LED 矩陣與燈條腳位在重新連線時保持輸出。
- `tone()` 用 Timer2：播放音調時，PWM 腳位 3 和 11 暫時不能用。伺服馬達用 Timer1，會佔用 PWM 腳位 9 和 10。
- 超音波、脈衝寬度、DHT11 在板子上讀取時會暫停其他工作最多約 25 毫秒（脈衝寬度依逾時設定，最多 0.25 秒）。
- 軟體序列埠（藍牙）建議 9600 鮑率，最高 57600。
