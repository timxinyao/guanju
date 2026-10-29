'use strict';
const assert = require('node:assert/strict');
const { IDS, derive, isAlive, acceptState, detailValue, supportsNativeSwitch } = require('./app.js');
const states = {
  [IDS.intent]: true,
  [IDS.monitoring]: true,
  [IDS.radar]: true,
  [IDS.zone]: 'Clear',
  [IDS.tv]: 'Active / picture visible'
};
const online = derive(states, true);
assert.equal(online.connected, true);
assert.equal(online.headline, '画面正常');
assert.equal(online.zoneTitle, '当前没有近距离目标');
assert.equal(online.canSwitch, true);
assert.equal(online.canRestore, true);
assert.equal(online.monitoring, true);
const unknown = derive({ ...states, [IDS.zone]: 'Unknown' }, true);
assert.equal(unknown.zoneTitle, '测距状态不明确');
assert.notEqual(unknown.zoneTitle, online.zoneTitle);
const standby = derive({ ...states, [IDS.tv]: 'Standby (will not wake)', [IDS.monitoring]: false }, true);
assert.equal(standby.intent, true);
assert.equal(standby.monitoring, false);
assert.equal(standby.canSwitch, true);
assert.equal(standby.canRestore, false);
assert.equal(standby.headline, '电视待机中');
const unavailable = derive({ ...states, [IDS.radar]: false }, true);
assert.equal(unavailable.zoneTitle, '雷达状态不可用');
const incomplete = { ...states }; delete incomplete[IDS.tv];
assert.equal(derive(incomplete, true).connected, false);
assert.equal(derive(incomplete, true).canRestore, false);
assert.equal(derive(incomplete, true).canSwitch, true);
const expired = derive(states, false);
assert.equal(expired.headline, '状态未知');
assert.equal(expired.canSwitch, false);
assert.equal(expired.canRestore, false);
assert.equal(isAlive(1000, 16000), true);
assert.equal(isAlive(1000, 16001), false);
assert.equal(isAlive(0, 500), false);
assert.equal(detailValue(IDS.status, 'ON; monitoring near zone', true), '已开启，正在监测近区');
assert.equal(detailValue(IDS.tv, 'Standby (will not wake)', true), '电视待机，不会唤醒');
assert.equal(detailValue(IDS.range, 'Nominal 1.5 m (gate 2), 0.75 m steps', true), '约 1.5 米，步长 0.75 米');
assert.equal(detailValue(IDS.range, 'Nominal 1.5 m (gate 2), 0.75 m steps; radar delay 1 s', true), '约 1.5 米，雷达无人延时 1 秒');
assert.equal(detailValue(IDS.range, 'Nominal 1.5 m (gate 2), 0.75 m steps; radar delay 3 s', true), '状态未知');
assert.equal(detailValue(IDS.status, 'Unrecognized English status', true), '状态未知');
assert.equal(detailValue(IDS.tv, 'Active / picture visible', false), '未知');
assert.equal(detailValue(IDS.owns, false, true), '否');
const latest = { [IDS.tv]: 'Standby (will not wake)' };
assert.equal(acceptState(latest, { id: IDS.tv, value: 'Active / picture visible' }, 2, 3), false);
assert.equal(latest[IDS.tv], 'Standby (will not wake)');
assert.equal(acceptState(latest, { id: IDS.tv, value: 'Active / picture visible' }, 3, 3), true);
assert.equal(latest[IDS.tv], 'Active / picture visible');
assert.equal(supportsNativeSwitch({ switch: false }), true);
assert.equal(supportsNativeSwitch({}), false);
console.log('状态派生、中文详情、过期响应与心跳边界检查通过');
