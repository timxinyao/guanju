'use strict';
const assert = require('node:assert/strict');
const { IDS, runExclusive, boundedRequest, readEntity, applyVersionedState } = require('./app.js');
(async () => {
  const lock = { active: false };
  let aborted = false;
  const hanging = async (_url, { signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return { ok: true, json: () => new Promise(() => {}) };
  };
  await assert.rejects(runExclusive(lock, () => boundedRequest(hanging, '/', {}, true, 25)), /timeout/);
  assert.equal(aborted, true);
  assert.equal(lock.active, false, '锁必须在响应正文超时后释放');
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const model = {}, revisions = {};
  const read = readEntity(async () => ({ ok: true, json: () => waiting }), '/state', IDS.tv, model, revisions, () => 1, 1, 1000);
  assert.equal(applyVersionedState(model, revisions, { id: IDS.tv, value: 'Active / pictureOff' }, 1, 1), true);
  release({ id: IDS.tv, value: 'Active / picture visible' });
  await assert.rejects(read, /stale/);
  assert.equal(model[IDS.tv], 'Active / pictureOff', '较早 GET 不得覆盖较新的 SSE');
  console.log('挂起响应超时解锁、同代乱序读取检查通过');
})().catch(err => { console.error(err); process.exitCode = 1; });
