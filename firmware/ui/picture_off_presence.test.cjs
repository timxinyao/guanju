'use strict';
const assert = require('node:assert/strict');
const { sceneObservation } = require('./app.js');
const frame = {schema_version:1,session_id:'boot',sequence:1,uptime_ms:10000,sample_sequence:1,sample_at_ms:9900,config_revision:1,near_threshold_cm:150,release_threshold_cm:170,zone:'near',distance:{moving_valid:true,moving_cm:90,still_valid:false,still_cm:0},health:{wifi_connected:true,radar_fresh:true,measurement_known:true,tv_fresh:true,settings_ready:true,parameter_audit:'idle'},intent_enabled:true,monitoring:true,external_override:false,reason:'',snooze_remaining_ms:0,recent_events:[],events_dropped:0,tv:{power:'active',mode:'normal',owns_picture_off:false}};
for (const [power,mode] of [['active','normal'],['active','picture_off'],['standby','unknown'],['unknown','unknown']]) {
  assert.deepEqual(sceneObservation({...frame,tv:{power,mode,owns_picture_off:false}},1000,1000,true),{presence:'present',distanceCm:90},`${power}/${mode} cannot suppress fresh radar presence`);
}
assert.equal(sceneObservation(frame,1000,5000,true).presence,'unknown');
assert.equal(sceneObservation({...frame,health:{...frame.health,radar_fresh:false}},1000,1000,true).presence,'unknown');
console.log('息屏、待机和电视未知不改变有效雷达人物状态');
