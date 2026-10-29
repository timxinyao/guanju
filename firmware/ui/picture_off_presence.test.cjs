'use strict';
const assert = require('node:assert/strict');
const { IDS, deriveScene, createTvPresentation, createSceneMotion } = require('./app.js');

// TV display status must not determine whether the radar's person is shown.
for (const [presence, expected] of [['Near', 'near'], ['Far', 'far'], ['Absent', 'absent'], ['Unknown', 'unknown']]) {
  for (const tv of ['Active / picture visible', 'Active / pictureOff', 'Unavailable / state expired']) {
    const states = { [IDS.radar]: true, [IDS.scene]: presence, [IDS.tv]: tv };
    assert.equal(deriveScene(states, true), expected, `${presence} with ${tv}`);
    assert.equal(createSceneMotion().update(deriveScene(states, true)).target, expected);
  }
}
const near = { [IDS.intent]: true, [IDS.monitoring]: true, [IDS.radar]: true,
  [IDS.zone]: 'Presence', [IDS.scene]: 'Near', [IDS.tv]: 'Active / pictureOff' };
assert.equal(createTvPresentation().update(near, true, 1, 0).kind, 'off');
assert.equal(deriveScene(near, false), 'unknown');
assert.equal(deriveScene({ ...near, [IDS.radar]: false }, true), 'unknown');
console.log('息屏和电视过渡不改变雷达人物状态；未知或过期不会显示人物');
