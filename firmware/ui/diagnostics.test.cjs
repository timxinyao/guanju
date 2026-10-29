'use strict';
const assert = require('node:assert/strict');
const { diagnosticView, updateDiagnosticsCache, createDiagnosticsPoller, boundedRequest, createRequestQueue, sameSettings } = require('./app.js');
const snapshot = {
  schema_version: 1, session_id: 'test-boot', sequence: 12, uptime_ms: 10000,
  sample_sequence: 30, sample_at_ms: 9900, config_revision: 0,
  near_threshold_cm: 150, release_threshold_cm: 170, zone: 'far',
  distance: { moving_cm: 230, still_cm: 280, moving_valid: true, still_valid: true },
  health: { wifi_connected: true, radar_fresh: true, measurement_known: true, tv_fresh: true, settings_ready: true, parameter_audit: 'idle' },
  intent_enabled: true, monitoring: true, reason: 'ON; monitoring near zone',
  tv: { power: 'active', mode: 'normal', owns_picture_off: false }, snooze_remaining_ms: 0,
  external_override: false, recent_events: [], events_dropped: 0
};
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  // Catch residual target distances and stale data presented as a current measurement.
  assert.equal(typeof diagnosticView, 'function', 'diagnostics must derive safe display values');
  assert.equal(diagnosticView(snapshot, 100, 100).distance, '约 2.3 米');
  assert.equal(diagnosticView({ ...snapshot, zone: 'absent' }, 100, 100).distance, '—');
  assert.equal(diagnosticView({ ...snapshot, zone: 'unknown' }, 100, 100).distance, '—');
  assert.equal(diagnosticView({ ...snapshot, sample_at_ms: 7000 }, 100, 100).distance, '—');
  assert.equal(diagnosticView(snapshot, 100, 4000).distance, '—');
  assert.equal(diagnosticView({ ...snapshot, distance: { ...snapshot.distance, moving_valid: false } }, 100, 100).distance, '约 2.8 米');
  assert.equal(diagnosticView({ ...snapshot, distance: { moving_cm: 0, moving_valid: true, still_cm: null, still_valid: false } }, 100, 100).distance, '—');
  assert.equal(diagnosticView(null, 0, 100).distance, '—');
  assert.equal(diagnosticView({ ...snapshot, tv: null }, 100, 100).valid, false);
  assert.equal(diagnosticView({ ...snapshot, health: { ...snapshot.health, radar_fresh: 'true' } }, 100, 100).valid, false);
  assert.equal(diagnosticView({ ...snapshot, uptime_ms: 2400, sample_at_ms: 0 }, 10000, 10200).sampleFresh, false);
  assert.equal(diagnosticView({ ...snapshot, uptime_ms: 2400, sample_at_ms: 0 }, 10000, 10200).zone, '等待新鲜数据');
  assert.equal(diagnosticView({ ...snapshot, sample_at_ms: 11000 }, 100, 100).sampleFresh, false);
  assert.equal(typeof updateDiagnosticsCache, 'function');
  let cache = updateDiagnosticsCache(null, snapshot, 1000);
  cache = updateDiagnosticsCache(cache, { ...snapshot }, 2000);
  cache = updateDiagnosticsCache(cache, { ...snapshot }, 3000);
  cache = updateDiagnosticsCache(cache, { ...snapshot }, 5000);
  assert.equal(cache.observedAt, 1000, 'same snapshot must not rejuvenate on repeated reads');
  assert.equal(diagnosticView(cache.data, cache.observedAt, 5000).distance, '—');
  cache = updateDiagnosticsCache(cache, { ...snapshot, sequence: 13, uptime_ms: 11000 }, 5000);
  assert.equal(cache.observedAt, 5000, 'a newly published snapshot gets its own baseline');
  cache = updateDiagnosticsCache(cache, { ...snapshot, sequence: 12 }, 6000);
  assert.equal(cache.data.sequence, 13, 'older snapshot cannot overwrite current one');
  cache = updateDiagnosticsCache(cache, { ...snapshot, session_id: 'new-boot', sequence: 1, uptime_ms: 100 }, 6000);
  assert.equal(cache.observedAt, 6000, 'new boot clears old snapshot baseline');
  // Caller cancellation must abort a request even while its body is hanging.
  const cancel = new AbortController(); let requestSignal;
  const hanging = boundedRequest(async (_url, options) => { requestSignal = options.signal; return { ok: true, json: () => new Promise(() => {}) }; }, '/diagnostics', { signal: cancel.signal }, true, 10000);
  cancel.abort(); await assert.rejects(hanging, error => error.name === 'AbortError');
  assert.equal(requestSignal.aborted, true);
  // Closed/hidden diagnostics do no work; activation is single-flight through the shared queue.
  const timers = new Map(); let timerID = 0, reads = 0, aborts = 0, delivered = 0;
  let respond; const enqueue = createRequestQueue();
  const poller = createDiagnosticsPoller({ enqueue,
    fetcher: async (_url, { signal }) => { reads++; signal.addEventListener('abort', () => aborts++); return { ok: true, json: () => new Promise(resolve => { respond = resolve; }) }; },
    onData: () => delivered++, onError: () => {},
    schedule: (fn, ms) => { timers.set(++timerID, { fn, ms }); return timerID; }, cancel: id => timers.delete(id)
  });
  await flush(); assert.equal(reads, 0);
  poller.setActive(true); poller.setActive(true); await flush(); assert.equal(reads, 1);
  poller.setActive(false); respond(snapshot); await flush(); assert.equal(aborts, 1); assert.equal(delivered, 0); assert.equal(timers.size, 0);
  poller.setActive(true); await flush(); assert.equal(reads, 2); respond(snapshot); await flush();
  assert.equal(delivered, 1); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, 1000);
  poller.setActive(false); assert.equal(timers.size, 0);
  // Back off instead of hammering the global firmware rate limit.
  let backoff;
  const busy = createDiagnosticsPoller({ enqueue, fetcher: async () => ({ ok: false, status: 429, headers: { get: () => '3' }, json: async () => ({ error: 'rate_limited', retry_after_ms: 3000 }) }), onData: () => {}, onError: () => {}, schedule: (_fn, ms) => { backoff = ms; return 1; }, cancel: () => {} });
  busy.setActive(true); await flush(); await flush(); assert.ok(backoff >= 3000); busy.setActive(false);
  console.log('诊断有效距离、取消、单飞队列和限流退避检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
