/*
 * 營隊擴充指令（2026-11，營隊學習平台）
 *
 * 加在 StandardFirmata 2.5.9 之上的自訂 sysex 指令，讓網頁可以使用 StandardFirmata 沒有的零件：
 * 蜂鳴器音調、脈衝寬度、超音波距離、DHT11 溫溼度、WS2812 燈條、MAX7219 LED 矩陣。
 * 指令編號用 Firmata 保留給使用者自訂的 0x01–0x0F。數值一律拆成 7 位元一組（低位在前）。
 *
 * 授權：與 StandardFirmata 相同，GNU LGPL 2.1 或更新版本。WS2812 使用 Adafruit NeoPixel（LGPL 3.0）。
 * 網頁端的對應程式：packages/scratch-vm/src/extensions/scratch3_camparduino/firmata.js（CAMP_*）。
 */
#ifndef CAMP_FEATURES_H
#define CAMP_FEATURES_H

#include <Adafruit_NeoPixel.h>

#define CAMP_TONE      0x01  // pin, freq(3), duration ms(3)；freq = 0 表示停止
#define CAMP_PULSE_IN  0x02  // reqId, pin, level, timeout µs(4)        → reqId, µs(5)
#define CAMP_SONAR     0x03  // reqId, trig, echo, timeout µs(4)        → reqId, µs(5)
#define CAMP_DHT11     0x04  // reqId, pin                               → reqId, status, hum(2), humDec(2), temp(2), tempDec(2)
#define CAMP_PIXEL     0x05  // sub, …（見 handlePixel）
#define CAMP_MATRIX    0x06  // sub, …（見 handleMatrix）

#define CAMP_MAX_PIXELS 60

// 韌體版本（改了韌體就加一，並同步改 README 的檔名與擴展的 FIRMWARE_URL）
#define CAMP_FIRMWARE_MAJOR 1
#define CAMP_FIRMWARE_MINOR 1

static Adafruit_NeoPixel *campPixels = NULL;
static byte campTonePin = 255;   // 正在播放音調的腳位（Arduino 同時只能播一個音）
static boolean campToneTimed = false;  // 有指定長度的音調：播完後要放開腳位
static unsigned long campToneEnd = 0;
static byte matrixDin = 255, matrixCs = 255, matrixClk = 255;

static unsigned long campRead7(byte *argv, byte count) {
  unsigned long v = 0;
  for (byte i = 0; i < count; i++) v |= ((unsigned long)(argv[i] & 0x7F)) << (7 * i);
  return v;
}

static void campWrite7(byte *out, unsigned long v, byte count) {
  for (byte i = 0; i < count; i++) {
    out[i] = v & 0x7F;
    v >>= 7;
  }
}

/* ---------- 腳位放開 ---------- */

// 改為不輸出（高阻抗）。Firmata 記錄為 INPUT，但不加入數位回報（portConfigInputs 不設），
// 空接的腳位才不會因為雜訊一直回報。網頁要讀取或輸出時會重新送腳位模式。
static void campReleasePin(byte pin) {
  if (!IS_PIN_DIGITAL(pin) || IS_PIN_ANALOG(pin)) return;
  pinMode(PIN_TO_DIGITAL(pin), INPUT);
  Firmata.setPinMode(pin, INPUT);
}

static void campStopTone() {
  if (campTonePin == 255) return;
  noTone(campTonePin);
  campReleasePin(campTonePin);
  campTonePin = 255;
  campToneTimed = false;
}

/* ---------- DHT11（依資料手冊的時序自行實作） ---------- */

// 等待腳位離開 level，回傳迴圈次數（只用來比較長短）；逾時回傳 0。
// 讀取期間關閉中斷，micros() 在計時器溢位後會不準，所以用迴圈次數計時（一圈約 4–5 微秒）。
static unsigned int campWaitWhile(byte pin, byte level, unsigned int maxLoops) {
  unsigned int loops = 0;
  while (digitalRead(pin) == level) {
    if (++loops >= maxLoops) return 0;
  }
  return loops + 1;
}

// 讀 DHT11 的 5 個位元組；成功回傳 0，1 = 沒回應，2 = 讀取逾時，3 = 檢查碼錯誤
static byte campReadDht11(byte pin, byte *data) {
  for (byte i = 0; i < 5; i++) data[i] = 0;
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(20);                      // 起始訊號：至少 18 ms 低電位
  digitalWrite(pin, HIGH);
  delayMicroseconds(30);
  pinMode(pin, INPUT_PULLUP);

  noInterrupts();
  byte status = 0;
  if (!campWaitWhile(pin, HIGH, 200) || !campWaitWhile(pin, LOW, 200) || !campWaitWhile(pin, HIGH, 200)) {
    status = 1;
  } else {
    for (byte i = 0; i < 40; i++) {
      unsigned int low = campWaitWhile(pin, LOW, 200);
      unsigned int high = campWaitWhile(pin, HIGH, 200);
      if (!low || !high) {
        status = 2;
        break;
      }
      data[i / 8] <<= 1;
      if (high > low) data[i / 8] |= 1;   // 高電位比低電位長 = 1
    }
  }
  interrupts();
  if (status) return status;
  if ((byte)(data[0] + data[1] + data[2] + data[3]) != data[4]) return 3;
  return 0;
}

/* ---------- MAX7219 ---------- */

static void matrixSend(byte reg, byte value) {
  if (matrixCs == 255) return;
  digitalWrite(matrixCs, LOW);
  shiftOut(matrixDin, matrixClk, MSBFIRST, reg);
  shiftOut(matrixDin, matrixClk, MSBFIRST, value);
  digitalWrite(matrixCs, HIGH);
}

// sub 0: 設定腳位 din, cs, clk（初始化並清空）
// sub 1: 第 row（0–7）列寫入 value(2)
// sub 2: 亮度 0–15
static void handleMatrix(byte argc, byte *argv) {
  if (argc < 1) return;
  switch (argv[0]) {
    case 0:
      if (argc < 4) return;
      matrixDin = argv[1]; matrixCs = argv[2]; matrixClk = argv[3];
      pinMode(matrixDin, OUTPUT); pinMode(matrixCs, OUTPUT); pinMode(matrixClk, OUTPUT);
      digitalWrite(matrixCs, HIGH);
      matrixSend(0x0F, 0x00);   // 關閉測試模式
      matrixSend(0x09, 0x00);   // 不用 BCD 解碼
      matrixSend(0x0B, 0x07);   // 掃描 8 列
      matrixSend(0x0A, 0x08);   // 亮度
      matrixSend(0x0C, 0x01);   // 開始顯示
      for (byte r = 1; r <= 8; r++) matrixSend(r, 0);
      break;
    case 1:
      if (argc < 4 || argv[1] > 7) return;
      matrixSend(argv[1] + 1, (byte)campRead7(argv + 2, 2));
      break;
    case 2:
      if (argc < 2) return;
      matrixSend(0x0A, argv[1] & 0x0F);
      break;
  }
}

/* ---------- WS2812 ---------- */

// sub 0: 設定 pin, count(2)；sub 1: 第 index(2) 顆設為 r(2) g(2) b(2)；sub 2: 全部設為 r g b
// sub 3: 亮度(2)；sub 4: 顯示；sub 5: 全部熄滅並顯示
static void handlePixel(byte argc, byte *argv) {
  if (argc < 1) return;
  byte sub = argv[0];
  if (sub == 0) {
    if (argc < 4) return;
    unsigned int count = campRead7(argv + 2, 2);
    if (count < 1) count = 1;
    if (count > CAMP_MAX_PIXELS) count = CAMP_MAX_PIXELS;
    if (campPixels) {
      campPixels->clear();
      campPixels->show();
      delete campPixels;
    }
    campPixels = new Adafruit_NeoPixel(count, argv[1], NEO_GRB + NEO_KHZ800);
    campPixels->begin();
    campPixels->clear();
    campPixels->show();
    return;
  }
  if (!campPixels) return;
  switch (sub) {
    case 1:
      if (argc < 9) return;
      campPixels->setPixelColor(campRead7(argv + 1, 2), campRead7(argv + 3, 2), campRead7(argv + 5, 2), campRead7(argv + 7, 2));
      break;
    case 2:
      if (argc < 7) return;
      campPixels->fill(campPixels->Color(campRead7(argv + 1, 2), campRead7(argv + 3, 2), campRead7(argv + 5, 2)));
      break;
    case 3:
      if (argc < 3) return;
      campPixels->setBrightness(campRead7(argv + 1, 2));
      break;
    case 4:
      campPixels->show();
      break;
    case 5:
      campPixels->clear();
      campPixels->show();
      break;
  }
}

/* ---------- 進入點 ---------- */

// 處理營隊指令；不是營隊指令時回傳 false
static boolean campSysex(byte command, byte argc, byte *argv) {
  byte reply[12];
  switch (command) {
    case CAMP_TONE: {
      if (argc < 7) return true;
      byte pin = argv[0];
      unsigned long freq = campRead7(argv + 1, 3);
      unsigned long duration = campRead7(argv + 4, 3);
      if (freq == 0) {
        if (campTonePin == pin) campStopTone();
        else {
          noTone(pin);
          campReleasePin(pin);
        }
      } else {
        if (campTonePin != 255 && campTonePin != pin) campStopTone();
        campTonePin = pin;
        pinMode(pin, OUTPUT);
        Firmata.setPinMode(pin, OUTPUT);
        campToneTimed = duration != 0;
        campToneEnd = millis() + duration;
        if (duration) tone(pin, freq, duration);
        else tone(pin, freq);
      }
      return true;
    }
    case CAMP_PULSE_IN:
    case CAMP_SONAR: {
      unsigned long width = 0;
      if (command == CAMP_PULSE_IN) {
        if (argc < 7) return true;
        pinMode(argv[1], INPUT);
        width = pulseIn(argv[1], argv[2] ? HIGH : LOW, campRead7(argv + 3, 4));
      } else {
        if (argc < 7) return true;
        byte trig = argv[1], echo = argv[2];
        pinMode(trig, OUTPUT);
        pinMode(echo, INPUT);
        digitalWrite(trig, LOW);
        delayMicroseconds(2);
        digitalWrite(trig, HIGH);
        delayMicroseconds(10);
        digitalWrite(trig, LOW);
        width = pulseIn(echo, HIGH, campRead7(argv + 3, 4));
      }
      reply[0] = argv[0];
      campWrite7(reply + 1, width, 5);
      Firmata.sendSysex(command, 6, reply);
      return true;
    }
    case CAMP_DHT11: {
      if (argc < 2) return true;
      byte data[5];
      byte status = campReadDht11(argv[1], data);
      reply[0] = argv[0];
      reply[1] = status;
      campWrite7(reply + 2, data[0], 2);
      campWrite7(reply + 4, data[1], 2);
      campWrite7(reply + 6, data[2], 2);
      campWrite7(reply + 8, data[3], 2);
      Firmata.sendSysex(command, 10, reply);
      return true;
    }
    case CAMP_PIXEL:
      handlePixel(argc, argv);
      return true;
    case CAMP_MATRIX:
      handleMatrix(argc, argv);
      return true;
  }
  return false;
}

// 系統重置（網頁重新連線）時：停止音調、熄滅燈條與矩陣
static void campReset() {
  campStopTone();
  if (campPixels) {
    campPixels->clear();
    campPixels->show();
  }
  if (matrixCs != 255) {
    for (byte r = 1; r <= 8; r++) matrixSend(r, 0);
  }
}

// 重置後呼叫（在 StandardFirmata 把腳位設成輸出之後）：放開數位腳位 2–13。
// 已設定的 LED 矩陣與燈條腳位保持輸出，避免空接的時脈線把雜訊打進去造成亂閃。
static void campReleasePins() {
  for (byte i = 0; i < TOTAL_PINS; i++) {
    if (i == matrixDin || i == matrixClk) continue;
    if (campPixels && i == campPixels->getPin()) continue;
    if (i == matrixCs) {
      digitalWrite(matrixCs, HIGH);  // 不選取矩陣
      continue;
    }
    campReleasePin(i);
  }
}

// 每圈 loop() 呼叫：有長度的音調播完後放開腳位
static void campLoop() {
  if (campTonePin != 255 && campToneTimed && (long)(millis() - campToneEnd) >= 0) campStopTone();
}

#endif
