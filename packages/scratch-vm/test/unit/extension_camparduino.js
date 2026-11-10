/* eslint-disable */
const fs = require('fs');
const path = require('path');
const {test} = require('tap');

const {MODE, encode, FirmataParser} = require('../../src/extensions/scratch3_camparduino/firmata');
const stk500 = require('../../src/extensions/scratch3_camparduino/stk500');
const Scratch3CampArduinoBlocks = require('../../src/extensions/scratch3_camparduino');

const HEX_PATH = path.join(__dirname, '../../../camp-host/public/firmware/StandardFirmata-2.5.9-uno.hex');
const hexText = () => fs.readFileSync(HEX_PATH, 'utf8');

// ---------- 模擬 Uno 的 optiboot 開機載入程式 ----------
class SimBoard {
    constructor (opts = {}) {
        this.opts = opts;
        this.flash = new Uint8Array(stk500.UNO_MAX_BYTES).fill(0xFF);
        this.out = [];
        this.inbuf = [];
        this.addr = 0;
        this.progmode = false;
        this.syncs = 0;
        this.left = false;
    }

    clear () {
        this.out = [];
    }

    async write (bytes) {
        this.inbuf.push(...bytes);
        for (;;) {
            const b = this.inbuf;
            if (b.length === 0) return;
            const cmd = b[0];
            const need = {0x30: 2, 0x50: 2, 0x51: 2, 0x55: 4, 0x74: 5}[cmd];
            const total = cmd === 0x64 ? (b.length >= 3 ? 3 + ((b[1] << 8) | b[2]) + 1 + 1 : Infinity) : need;
            if (!total || b.length < total) return;
            const frame = b.splice(0, total);
            this.handle(frame);
        }
    }

    handle (f) {
        const ok = [0x14, 0x10];
        switch (f[0]) {
        case 0x30:
            this.syncs++;
            if (this.opts.silent || this.syncs <= (this.opts.ignoreFirst || 0)) return;
            this.out.push(...ok);
            return;
        case 0x50: this.progmode = true; this.out.push(...ok); return;
        case 0x51: this.progmode = false; this.left = true; this.out.push(...ok); return;
        case 0x55: this.addr = (f[1] | (f[2] << 8)) * 2; this.out.push(...ok); return;
        case 0x64: {
            const len = (f[1] << 8) | f[2];
            if (this.opts.failProg) { this.out.push(0x15, 0x10); return; }
            this.flash.set(f.slice(4, 4 + len), this.addr);
            this.out.push(...ok);
            return;
        }
        case 0x74: {
            const len = (f[1] << 8) | f[2];
            const data = Array.from(this.flash.subarray(this.addr, this.addr + len));
            if (this.opts.corruptPage !== undefined && this.addr === this.opts.corruptPage * 128) data[5] ^= 0xFF;
            this.out.push(0x14, ...data, 0x10);
            return;
        }
        default: return;
        }
    }

    async read (n, timeoutMs) {
        if (this.out.length >= n) return Uint8Array.from(this.out.splice(0, n));
        throw new Error('讀取逾時');
    }
}

test('Intel HEX：解析真正的 StandardFirmata，大小合理且每行檢查碼都對', t => {
    const image = stk500.parseIntelHex(hexText());
    t.ok(image.length > 10000 && image.length < stk500.UNO_MAX_BYTES, `韌體 ${image.length} bytes`);
    t.equal(image[0], 0x0C, '開頭是 AVR 的 jmp 指令（0x0C 0x94）');
    t.end();
});

test('Intel HEX：檢查碼錯誤、格式錯誤、缺結尾、過大、空檔、空洞補 0xFF 與延伸位址', t => {
    t.throws(() => stk500.parseIntelHex(':0300000002330000000\n:00000001FF\n'), {code: 'BAD_HEX'}, '長度不符');
    t.throws(() => stk500.parseIntelHex(':02000000AABB00\n:00000001FF\n'), {code: 'BAD_HEX'}, '檢查碼錯誤');
    t.throws(() => stk500.parseIntelHex('hello\n'), {code: 'BAD_HEX'}, '不是 hex');
    t.throws(() => stk500.parseIntelHex(':02000000AABB99\n'), {code: 'BAD_HEX'}, '缺結尾記錄');
    t.throws(() => stk500.parseIntelHex(':00000001FF\n'), {code: 'BAD_HEX'}, '空的');
    // 位址 0x10 放 2 bytes，中間 0x00–0x0F 補 0xFF
    const img = stk500.parseIntelHex(':02001000AABB89\n:00000001FF\n');
    t.equal(img.length, 0x12);
    t.equal(img[0], 0xFF);
    t.equal(img[0x10], 0xAA);
    t.equal(img[0x11], 0xBB);
    // 延伸線性位址 0x0001 → 0x10000 以上，超過 Uno 空間
    t.throws(() => stk500.parseIntelHex(':020000040001F9\n:02000000AABB99\n:00000001FF\n'), {code: 'TOO_LARGE'});
    t.end();
});

test('STK500：對模擬的 Uno 燒錄真的 StandardFirmata，快閃記憶體內容與映像一致', async t => {
    const image = stk500.parseIntelHex(hexText());
    const board = new SimBoard();
    const progress = [];
    await stk500.sync(board);
    await stk500.writeAndVerify(board, image, {onProgress: (d, n, phase) => progress.push(phase)});
    t.same(Array.from(board.flash.subarray(0, image.length)), Array.from(image), '內容一致');
    t.ok(board.flash.subarray(image.length, image.length + 100).every(b => b === 0xFF), '映像之外沒被動到');
    t.ok(board.left, '最後有離開燒錄模式（讓板子開始跑新程式）');
    t.ok(progress.includes('write') && progress.includes('verify'), '有回報寫入與驗證進度');
    t.end();
});

test('STK500：讀回比對不符 → VERIFY_FAILED；板子回錯誤碼 → SYNC_LOST', async t => {
    const image = stk500.parseIntelHex(hexText());
    await t.rejects(stk500.writeAndVerify(new SimBoard({corruptPage: 3}), image), {code: 'VERIFY_FAILED'});
    await t.rejects(stk500.writeAndVerify(new SimBoard({failProg: true}), image), {code: 'SYNC_LOST'});
    t.end();
});

test('STK500：同步——開機載入程式晚幾次才回應仍可成功；完全沒回應 → NO_BOOTLOADER', async t => {
    const late = new SimBoard({ignoreFirst: 3});
    await stk500.sync(late, {attempts: 6, waitMs: 5});
    t.equal(late.syncs, 4, '前 3 次沒回應，第 4 次成功');
    await t.rejects(stk500.sync(new SimBoard({silent: true}), {attempts: 3, waitMs: 5}), {code: 'NO_BOOTLOADER'});
    t.end();
});

// ---------- Firmata ----------
test('Firmata 解碼：版本、韌體名稱、數位埠、類比值，可跨多次餵入', t => {
    const got = {};
    const p = new FirmataParser({
        onVersion: (a, b) => { got.version = `${a}.${b}`; },
        onFirmware: (n, a, b) => { got.firmware = `${n} ${a}.${b}`; },
        onDigitalPort: (port, mask) => { got.digital = [port, mask]; },
        onAnalog: (ch, v) => { got.analog = [ch, v]; }
    });
    const name = 'StandardFirmata.ino';
    const fw = [0xF0, 0x79, 2, 5];
    for (const c of name) fw.push(c.charCodeAt(0) & 0x7F, 0);
    fw.push(0xF7);
    const stream = [0xF9, 2, 5, ...fw, 0x91, 0x25, 0x01, 0xE3, 0x7F, 0x07];
    for (const b of stream) p.feed([b]); // 一次一個位元組
    t.equal(got.version, '2.5');
    t.equal(got.firmware, 'StandardFirmata.ino 2.5');
    t.same(got.digital, [1, 0x25 | (1 << 7)], '埠 1 的遮罩');
    t.same(got.analog, [3, 0x7F | (7 << 7)], 'A3 = 1023');
    t.end();
});

test('Firmata 解碼：sysex 傳到一半被新命令打斷時重新同步，不會卡住', t => {
    const got = [];
    const p = new FirmataParser({onAnalog: (ch, v) => got.push([ch, v])});
    p.feed([0xF0, 0x79, 2, 0xE1, 5, 0]); // 壞掉的 sysex 後面接一個正常的類比訊息
    t.same(got, [[1, 5]]);
    t.end();
});

test('Firmata 編碼：腳位模式、數位寫入、PWM、伺服馬達設定', t => {
    t.same(encode.pinMode(13, MODE.OUTPUT), [0xF4, 13, 1]);
    t.same(encode.digitalWrite(13, true), [0xF5, 13, 1]);
    t.same(encode.digitalWrite(13, 0), [0xF5, 13, 0]);
    t.same(encode.analogWrite(9, 255), [0xE9, 0x7F, 0x01], 'PWM 255 = 低 7 位 0x7F、高位 1');
    t.same(encode.analogWrite(9, 0), [0xE9, 0, 0]);
    t.same(encode.analogWrite(20, 10), [0xF0, 0x6F, 20, 10, 0, 0, 0xF7], '腳位 > 15 用延伸訊息');
    t.same(encode.servoConfig(9), [0xF0, 0x70, 9, 544 & 0x7F, 544 >> 7, 2400 & 0x7F, 2400 >> 7, 0xF7]);
    t.same(encode.reportDigitalPort(1, true), [0xD1, 1]);
    t.same(encode.reportAnalog(2, true), [0xC2, 1]);
    t.end();
});

// ---------- 積木行為（用假的連線） ----------
function makeExt (connected = true) {
    const ext = new Scratch3CampArduinoBlocks({on () {}});
    const sent = [];
    ext.link = {write: async bytes => { sent.push(Array.from(bytes)); }, close: async () => {}};
    ext.connected = connected;
    return {ext, sent};
}

test('積木：沒連線時一律安全地什麼都不做、讀取回 0，不丟錯', async t => {
    const {ext, sent} = makeExt(false);
    await ext.ledOn({PIN: '13'});
    await ext.pwmWrite({PIN: '9', VALUE: '100'});
    await ext.servoWrite({PIN: '9', ANGLE: '90'});
    await ext.waitDigital({PIN: '2', VALUE: '1'});
    t.equal(ext.digitalRead({PIN: '2'}), 0);
    t.equal(ext.analogRead({PIN: '0'}), 0);
    t.equal(ext.readAuto({PIN: 'A0'}), 0);
    t.equal(sent.length, 0, '什麼都沒送出');
    t.equal(ext.isConnected(), false);
    t.end();
});

test('積木：點亮／熄滅 LED 會先設成輸出再寫入；無效腳位被忽略', async t => {
    const {ext, sent} = makeExt();
    await ext.ledOn({PIN: '13'});
    await ext.ledOff({PIN: '13'});
    t.same(sent, [[0xF4, 13, 1], [0xF5, 13, 1], [0xF5, 13, 0]], '輸出模式只設一次');
    await ext.ledOn({PIN: '1'}); // 0、1 腳位保留給序列通訊
    await ext.ledOn({PIN: '99'});
    t.equal(sent.length, 3, '無效腳位沒有送出任何東西');
    t.end();
});

test('積木：PWM 0–255 會夾回範圍；只接受 PWM 腳位', async t => {
    const {ext, sent} = makeExt();
    await ext.pwmWrite({PIN: '9', VALUE: '300'});
    await ext.pwmWrite({PIN: '9', VALUE: '-5'});
    await ext.pwmWrite({PIN: '8', VALUE: '100'}); // 8 不是 PWM 腳位
    t.same(sent, [[0xF4, 9, 3], [0xE9, 0x7F, 0x01], [0xE9, 0, 0]]);
    t.end();
});

test('積木：伺服馬達先送脈波範圍設定、再設模式、再寫角度，角度夾在 0–180', async t => {
    const {ext, sent} = makeExt();
    await ext.servoWrite({PIN: '9', ANGLE: '200'});
    await ext.servoWrite({PIN: '9', ANGLE: '90'});
    t.same(sent[0].slice(0, 3), [0xF0, 0x70, 9], '先 servoConfig');
    t.same(sent[1], [0xF4, 9, MODE.SERVO]);
    t.same(sent[2], [0xE9, 180 & 0x7F, 180 >> 7], '200 度夾成 180（7 位元分兩個位元組：52、1）');
    t.same(sent[3], [0xE9, 90, 0], '第二次不再重送設定');
    t.equal(sent.length, 4);
    t.end();
});

test('積木：直流馬達的方向腳與速度腳不可相同；速度百分比換成 0–255；停止會歸零', async t => {
    const {ext, sent} = makeExt();
    await ext.motorRun({DIR: '5', PWM: '5', SPEED: '50', DIRECTION: 'forward'});
    t.equal(sent.length, 0, '同一支腳位被拒絕');
    await ext.motorRun({DIR: '4', PWM: '5', SPEED: '100', DIRECTION: 'backward'});
    t.same(sent, [[0xF4, 4, 1], [0xF5, 4, 0], [0xF4, 5, 3], [0xE5, 0x7F, 0x01]], '反轉＝方向腳低、速度 100％＝255');
    sent.length = 0;
    await ext.motorStop({DIR: '4', PWM: '5'});
    t.same(sent, [[0xE5, 0, 0], [0xF5, 4, 0]]);
    t.end();
});

test('積木：RGB LED 依顏色寫三個 PWM 腳位', async t => {
    const {ext, sent} = makeExt();
    await ext.rgbSet({R: '9', G: '10', B: '11', COLOR: 'green'});
    const values = sent.filter(b => (b[0] & 0xF0) === 0xE0).map(b => b[1] | (b[2] << 7));
    t.same(values, [0, 255, 0]);
    t.end();
});

test('積木：類比讀取第一次會開啟回報；讀到的是最新值；類比範圍判斷與自動讀取', async t => {
    const {ext, sent} = makeExt();
    t.equal(ext.analogRead({PIN: '2'}), 0);
    t.same(sent[0], [0xF4, 16, MODE.ANALOG, 0xC2, 1], 'A2 = 腳位 16，開啟回報');
    ext.parser.feed([0xE2, 0x7F, 0x07]); // A2 = 1023
    t.equal(ext.analogRead({PIN: '2'}), 1023);
    t.equal(sent.length, 1, '不重複送設定');
    t.equal(ext.analogBetween({PIN: '2', MIN: '1000', MAX: '500'}), false);
    t.equal(ext.analogBetween({PIN: '2', MIN: '2000', MAX: '1000'}), true, '上下限顛倒也可以');
    t.equal(ext.readAuto({PIN: 'A2'}), 1023, 'A2 走類比');
    t.end();
});

test('積木：數位讀取依回報的埠遮罩；等待腳位變化會在中途停止時結束', async t => {
    const {ext, sent} = makeExt();
    ext.parser.feed([0x91, 0x04, 0x00]); // 埠 1（腳位 8–15）：第 2 位 = 腳位 10 為高
    t.equal(ext.digitalRead({PIN: '10'}), 1);
    t.equal(ext.digitalRead({PIN: '9'}), 0);
    t.same(sent[0], [0xF4, 10, MODE.INPUT]);
    const wait = ext.waitDigital({PIN: '2', VALUE: '1'});
    setTimeout(() => { ext.epoch++; }, 80); // 按了停止
    await wait;
    t.pass('停止後等待結束，沒有卡住');
    t.end();
});

test('積木：LED 閃爍次數與停止；映射積木的算術', async t => {
    const {ext, sent} = makeExt();
    await ext.ledBlink({PIN: '13', TIMES: '2', ON: '1', OFF: '1'});
    t.same(sent.filter(b => b[0] === 0xF5).map(b => b[2]), [1, 0, 1, 0], '亮滅各 2 次');
    t.equal(ext.mapValue({VALUE: '512', IN_MIN: '0', IN_MAX: '1023', OUT_MIN: '0', OUT_MAX: '255'}).toFixed(1), '127.6');
    t.equal(ext.mapValue({VALUE: '5', IN_MIN: '3', IN_MAX: '3', OUT_MIN: '7', OUT_MAX: '9'}), 7, '輸入範圍為 0 時不除以 0');
    t.end();
});

test('積木：通訊失敗時回報中斷而不是丟錯', async t => {
    const {ext} = makeExt();
    ext.link.write = async () => { throw new Error('port closed'); };
    await ext.ledOn({PIN: '13'}); // 不會丟錯
    t.equal(ext.isConnected(), false);
    t.match(ext.getStatus(), /中斷/);
    t.end();
});

test('擴展資訊：沒有音調積木（StandardFirmata 不支援），積木 id 不重複', t => {
    const info = new Scratch3CampArduinoBlocks({on () {}}).getInfo();
    const ops = info.blocks.filter(b => b !== '---').map(b => b.opcode);
    t.equal(new Set(ops).size, ops.length, '沒有重複的 opcode');
    t.notOk(ops.some(o => /tone/i.test(o)));
    t.ok(ops.includes('flashFirmware') && ops.includes('pwmWrite') && ops.includes('servoSweep'));
    t.end();
});
