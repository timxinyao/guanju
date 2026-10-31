'use strict';
const assert = require('node:assert/strict');
const { sceneObservation, sceneFloorBounds, createDistanceMotion, createSettingsEvidence } = require('./app.js');
assert.equal(typeof sceneObservation, 'function', 'scene must derive presence from one diagnostic frame');
assert.equal(typeof sceneFloorBounds, 'function');
assert.equal(typeof createDistanceMotion, 'function');
assert.equal(typeof createSettingsEvidence, 'function', 'configuration evidence must invalidate obsolete settings');
const frame = {
  schema_version: 1, session_id: 'boot', sequence: 1, uptime_ms: 10000, sample_sequence: 2, sample_at_ms: 9900,
  config_revision: 1, near_threshold_cm: 150, release_threshold_cm: 170, zone: 'far',
  distance: { moving_valid: true, moving_cm: 230, still_valid: true, still_cm: 200 },
  health: { wifi_connected:true,radar_fresh:true,measurement_known:true,tv_fresh:true,settings_ready:true,parameter_audit:'idle' },
  tv:{power:'active',mode:'normal',owns_picture_off:false}, intent_enabled:true,monitoring:true,external_override:false,
  reason:'',snooze_remaining_ms:0,recent_events:[],events_dropped:0
};
const evidence=createSettingsEvidence(); const initialToken=evidence.token();
assert.equal(evidence.matches(1),true);assert.equal(evidence.sameRevision(1),false,'Error recovery needs an observed session');assert.equal(evidence.observe(frame),true);assert.notEqual(evidence.token(),initialToken);assert.equal(evidence.matches(1),true);
assert.equal(evidence.observe({...frame,sequence:2}),false,'same configuration cannot restart reads');
assert.equal(evidence.observe({...frame,config_revision:2}),true);assert.equal(evidence.matches(1),false);assert.equal(evidence.matches(2),true);
assert.equal(evidence.observe({...frame,config_revision:2,health:{...frame.health,settings_ready:false}}),true);assert.equal(evidence.matches(2),false,'not-ready settings are untrusted');assert.equal(evidence.sameRevision(2),true,'same revision can be considered separately for Error recovery');assert.equal(evidence.sameRevision(1),false);
const oldToken=evidence.token();assert.equal(evidence.observe({...frame,session_id:'new-boot',config_revision:2}),true);assert.notEqual(evidence.token(),oldToken,'new session invalidates in-flight reads');
const beforeReset=evidence.token();evidence.reset();assert.notEqual(evidence.token(),beforeReset,'connection generation invalidates in-flight reads');
assert.deepEqual(sceneObservation(frame,1000,1000,true),{presence:'present',distanceCm:200});
assert.deepEqual(sceneObservation({...frame,distance:{moving_valid:false,moving_cm:40,still_valid:true,still_cm:270}},1000,1000,true),{presence:'present',distanceCm:270});
assert.equal(sceneObservation({...frame,distance:{moving_valid:false,moving_cm:40,still_valid:true,still_cm:0}},1000,1000,true).presence,'unknown');
assert.equal(sceneObservation({...frame,zone:'absent'},1000,1000,true).presence,'absent');
assert.equal(sceneObservation({...frame,zone:'absent',health:{...frame.health,measurement_known:false}},1000,1000,true).presence,'unknown');
assert.equal(sceneObservation(frame,1000,5000,true).presence,'unknown');
assert.equal(sceneObservation(frame,1000,1000,false).presence,'unknown');
const floor=sceneFloorBounds(100,120); assert.equal(floor.near,175.6);assert.equal(floor.release,183.44);assert.equal(sceneFloorBounds(null,170),null);
const firstAbsent=createDistanceMotion(); firstAbsent.update({presence:'absent',outsideX:-240},0,false); assert.equal(firstAbsent.read().opacity,0,'initial absence must not invent a person'); assert.equal(firstAbsent.read().phase,'absent');
const model=createDistanceMotion();
model.update({presence:'present',distanceCm:300},0,false);model.advance(5000);let s=model.read();assert.equal(s.pose,'sitting');assert.equal(s.x,201);
model.update({presence:'absent'},5000,false);model.advance(5100);s=model.read();assert.equal(s.phase,'releasing');assert.equal(s.x,201);
model.advance(5700);const leaving=model.read();assert.ok(leaving.x<201);const y=leaving.y;
model.update({presence:'present',distanceCm:100},5700,false);assert.equal(model.read().x,leaving.x,'retarget starts at interpolated position');
model.advance(6000);assert.ok(model.read().x>leaving.x);model.advance(10000);s=model.read();assert.equal(s.pose,'standing');assert.ok(s.y<y);
model.update({presence:'present',distanceCm:50},10000,false);model.update({presence:'present',distanceCm:50},11000,false);model.advance(12500);assert.equal(model.read().pose,'clinging','identical observations must not restart motion');
model.update({presence:'absent'},12500,false);model.advance(13300);const beforeUnknown=model.read();model.update({presence:'unknown'},13300,false);model.advance(20000);s=model.read();assert.equal(s.x,beforeUnknown.x);assert.equal(s.y,beforeUnknown.y);assert.equal(s.phase,'unknown');assert.ok(s.opacity>0&&s.opacity<1);
model.update({presence:'present',distanceCm:300},20000,true);s=model.read();assert.equal(s.pose,'sitting');assert.equal(s.phase,'idle');assert.equal(s.y,254);
const boundary=createDistanceMotion();
for (const [cm,expected] of [[60,'clinging'],[70,'clinging'],[71,'standing'],[280,'sitting'],[260,'sitting'],[259,'standing']]) {
  boundary.update({presence:'present',distanceCm:cm},30000,true);assert.equal(boundary.read().pose,expected,`pose hysteresis ${cm}`);
}
assert.equal(sceneObservation({...frame,zone:'absent',sample_at_ms:6000},1000,1000,true).presence,'unknown','stale absence cannot trigger exit');
const projected=createDistanceMotion(), nondefault=sceneFloorBounds(270,290);
for (const cm of [280,260,300,50,60,70]) {
  projected.update({presence:'present',distanceCm:cm},40000,true);
  assert.ok(Math.abs(projected.read().y-sceneFloorBounds(cm,cm).near)<1e-9,`pose must not change the ${cm}cm projection`);
  if(cm===280)assert.ok(projected.read().y>nondefault.near&&projected.read().y<nondefault.release,'280cm belongs in amber');
  if(cm===260)assert.ok(projected.read().y<nondefault.near,'260cm belongs in red while sitting hysteresis persists');
  if(cm===260)assert.equal(projected.read().pose,'sitting','hysteresis remains independent of position');
}

const drift=createDistanceMotion();drift.update({presence:'present',distanceCm:280},0,true);drift.update({presence:'present',distanceCm:275},100,false);drift.advance(275);assert.equal(drift.read().pose,'sitting','small in-pose distance changes must not force a stand');
console.log('原子诊断、距离投影、动作中断及重复目标通过');
