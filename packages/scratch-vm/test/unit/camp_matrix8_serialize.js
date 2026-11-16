/* eslint-disable */
// 營隊修正（2026-11-16）：8×8 LED 矩陣的 shadow 積木 camp_matrix8 不能被當成擴展 `camp`，
// 否則存檔後重新開啟會去載入不存在的擴展、整份作品失敗（老師唯讀查看 zz_vision 作品時發現）。
const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const sb3 = require('../../src/serialization/sb3');

const stage = blocks => ({
    isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {},
    currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0
});

// 舊作品（修正前存的）：extensions 裡有 camp，積木裡有 camp_matrix8 shadow
const oldProject = () => ({
    targets: [stage({
        m: {opcode: 'camp_matrix8', next: null, parent: null, inputs: {}, fields: {MATRIX: ['0000000000000000000000000000000000000000000000000000000000000000', null]},
            shadow: true, topLevel: true, x: 0, y: 0}
    })],
    monitors: [],
    extensions: ['camp'],
    meta: {semver: '3.0.0'}
});

test('載入含 camp_matrix8 的舊作品：不會去載入擴展 camp', async t => {
    const vm = new VirtualMachine();
    const {extensions} = await sb3.deserialize(oldProject(), vm.runtime);
    t.notOk(extensions.extensionIDs.has('camp'));
});

test('存檔：camp_matrix8 不會讓作品的 extensions 出現 camp', async t => {
    const vm = new VirtualMachine();
    const {targets} = await sb3.deserialize(oldProject(), vm.runtime);
    targets.forEach(target => vm.runtime.addTarget(target));
    const json = sb3.serialize(vm.runtime);
    t.notOk(json.extensions.includes('camp'));
    const blocks = Object.values(json.targets[0].blocks);
    t.ok(blocks.some(b => b.opcode === 'camp_matrix8'), '積木本身仍保留');
});

test('真正的營隊擴展（camparduino）仍被當成擴展', async t => {
    const vm = new VirtualMachine();
    const p = oldProject();
    p.targets[0].blocks.c = {opcode: 'camparduino_connect', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0};
    const {extensions} = await sb3.deserialize(p, vm.runtime);
    t.ok(extensions.extensionIDs.has('camparduino'));
});
