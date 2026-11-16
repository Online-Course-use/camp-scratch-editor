/* eslint-disable */
// 營隊修正（2026-11-10）：擴展回報積木的舞台顯示器 id 固定為 opcode，舊作品裡重複的顯示器會合併。
const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const sb3 = require('../../src/serialization/sb3');

const project = monitors => ({
    targets: [{
        isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0
    }],
    monitors,
    extensions: ['campspeech'],
    meta: {semver: '3.0.0'}
});

const monitor = (id, opcode, y, params = {}) => ({
    id, mode: 'default', opcode, params, spriteName: null, value: 0, width: 0, height: 0,
    x: 5, y, visible: true, sliderMin: 0, sliderMax: 100, isDiscrete: true
});

test('工具箱：可勾選的擴展回報積木用 opcode 當固定 id；其他積木不加', async t => {
    const vm = new VirtualMachine();
    await vm.extensionManager.loadExtensionURL('campspeech');
    const xml = vm.runtime.getBlocksXML().map(c => c.xml).join('');
    t.match(xml, /<block type="campspeech_getHeard" id="campspeech_getHeard">/, '無參數的回報積木有固定 id');
    t.match(xml, /<block type="campspeech_listenAndWait">/, '指令積木不加 id');
    t.notMatch(xml, /id="campspeech_setLanguage"/);
});

test('載入舊作品：同一個積木的多個隨機 id 顯示器合併成一個，id 是 opcode', async t => {
    const vm = new VirtualMachine();
    await sb3.deserialize(project([
        monitor('SKe[p/^Kspc%UW*42ofj', 'campspeech_getHeard', 5),
        monitor('Xsj|X)5|P1svqTpv:4SQ', 'campspeech_getHeard', 92),
        monitor('abc', 'campspeech_wordsLeft', 34)
    ]), vm.runtime);
    const ids = [...vm.runtime._monitorState.keys()].sort();
    t.same(ids, ['campspeech_getHeard', 'campspeech_wordsLeft']);
    t.equal(vm.runtime._monitorState.get('campspeech_getHeard').visible, true);
});

test('內建積木與變數的顯示器 id 不受影響', async t => {
    const vm = new VirtualMachine();
    const p = project([monitor('xposition_custom', 'motion_xposition', 5), monitor('loudness', 'sensing_loudness', 30)]);
    await sb3.deserialize(p, vm.runtime);
    const ids = [...vm.runtime._monitorState.keys()].sort();
    t.notOk(ids.includes('motion_xposition'), '內建積木不改成 opcode');
    t.ok(ids.includes('loudness'));
});
