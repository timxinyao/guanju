(() => {
  'use strict';

  const IDS = {
    intent: 'switch/TV Trial', monitoring: 'binary_sensor/Trial Monitoring',
    radar: 'binary_sensor/Radar Data Fresh', known: 'binary_sensor/Radar Measurement Known',
    tvConnected: 'binary_sensor/TV Connected', owns: 'binary_sensor/Trial Owns Picture Off',
    moving: 'binary_sensor/Moving Target', still: 'binary_sensor/Still Target',
    zone: 'text_sensor/Near Zone', scene: 'text_sensor/Scene Presence', status: 'text_sensor/Trial Status',
    range: 'text_sensor/Near Zone Range', tv: 'text_sensor/TV Status',
    firmware: 'text_sensor/Radar Firmware Version', ip: 'text_sensor/IP Address',
    movingDistance: 'sensor/Moving Distance', stillDistance: 'sensor/Still Distance',
    detectionDistance: 'sensor/Detection Distance', signal: 'sensor/WiFi Signal', uptime: 'sensor/Uptime'
  };
  const CORE = [IDS.intent, IDS.monitoring, IDS.radar, IDS.zone, IDS.tv];
  const value = (states, id) => states[id] == null ? null : states[id];
  const on = x => x === true || x === 'ON' || x === 'on';
  const off = x => x === false || x === 'OFF' || x === 'off';
  const isAlive = (last, now) => last > 0 && now - last <= 15000;
  const supportsNativeSwitch = prototype => 'switch' in prototype;
  function acceptState(states, data, expected, current) {
    if (expected !== current || !data || typeof data.id !== 'string' || !Object.values(IDS).includes(data.id)) return false;
    states[data.id] = data.value ?? data.state ?? null;
    return true;
  }
  function applyVersionedState(states, revisions, data, expected, current, readRevision = null) {
    if (!data || typeof data.id !== 'string') return false;
    const revision = revisions[data.id] || 0;
    if (readRevision !== null && readRevision !== revision) return false;
    if (!acceptState(states, data, expected, current)) return false;
    revisions[data.id] = revision + 1;
    return true;
  }
  async function boundedRequest(fetcher, url, options = {}, json = false, timeoutMs = 4000) {
    const controller = new AbortController(), external = options.signal;
    let timeout, cancel;
    const aborted = new Promise((_, reject) => {
      cancel = () => { controller.abort(); const error = new Error('request cancelled'); error.name = 'AbortError'; reject(error); };
      if (external) external.addEventListener('abort', cancel, { once: true });
    });
    const expired = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('request timeout')); }, timeoutMs); });
    const operation = (async () => {
      if (external && external.aborted) { cancel(); return; }
      const response = await fetcher(url, { ...options, cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status); error.status = response.status;
        const retry = response.headers && Number(response.headers.get('Retry-After'));
        if (Number.isFinite(retry) && retry > 0) error.retryAfterMs = retry * 1000;
        if (response.status === 429 && response.json) {
          try { const data = await response.json(); if (Number.isFinite(data.retry_after_ms)) error.retryAfterMs = Math.max(error.retryAfterMs || 0, data.retry_after_ms); } catch (_) {}
        } else if (response.body) Promise.resolve(response.body.cancel()).catch(() => {});
        throw error;
      }
      if (json) return response.json();
      if (response.body) Promise.resolve(response.body.cancel()).catch(() => {});
    })();
    try { return await Promise.race([operation, expired, aborted]); }
    finally { clearTimeout(timeout); if (external) external.removeEventListener('abort', cancel); }
  }
  async function readEntity(fetcher, url, id, states, revisions, currentGeneration, expected, timeoutMs = 4000) {
    const revision = revisions[id] || 0;
    const data = await boundedRequest(fetcher, url, {}, true, timeoutMs);
    if (!data || data.id !== id || !applyVersionedState(states, revisions, data, expected, currentGeneration(), revision)) throw new Error('stale response');
    return data;
  }
  async function runExclusive(lock, work, onChange = () => {}) {
    if (lock.active) return false;
    lock.active = true; onChange();
    try { return await work(); }
    finally { lock.active = false; onChange(); }
  }
  function createRequestQueue() {
    const queue = []; let running = false;
    async function drain() {
      if (running) return;
      running = true;
      while (queue.length) {
        queue.sort((a, b) => a.priority - b.priority);
        const item = queue.shift();
        try { if (!item.valid()) throw new Error('stale request'); item.resolve(await item.work()); }
        catch (error) { item.reject(error); }
      }
      running = false;
    }
    return (work, priority = 2, valid = () => true) => new Promise((resolve, reject) => { queue.push({ work, priority, valid, resolve, reject }); drain(); });
  }
  // Optional diagnostics use the same queue as controls; never add another event stream.
  function createDiagnosticsPoller({ enqueue, fetcher, onData, onError, schedule = setTimeout, cancel = clearTimeout }) {
    let active = false, pending = false, timer = null, controller = null, epoch = 0, backoff = 1000;
    async function poll() {
      if (!active || pending) return;
      pending = true; const current = epoch; controller = new AbortController();
      const signal = controller.signal; let requestedAt = Date.now();
      try {
        const data = await enqueue(() => { requestedAt = Date.now(); return boundedRequest(fetcher, '/diagnostics', { signal }, true); }, 4, () => active && current === epoch);
        if (active && current === epoch) { onData(data, requestedAt); backoff = 1000; }
      } catch (error) {
        if (active && current === epoch && error.name !== 'AbortError') {
          backoff = Math.min(30000, Math.max(backoff * 2, error.retryAfterMs || 0)); onError(error);
        }
      } finally {
        pending = false; controller = null;
        if (active) timer = schedule(poll, current === epoch ? backoff : 0);
      }
    }
    return { setActive(next) {
      if (active === next) return;
      active = next; epoch++; if (timer !== null) cancel(timer); timer = null;
      if (!active) { if (controller) controller.abort(); }
      else { backoff = 1000; poll(); }
    } };
  }
  function updateDiagnosticsCache(previous, data, observedAt) {
    if (previous && previous.data.session_id === data.session_id) {
      const advance = (data.sequence - previous.data.sequence) >>> 0;
      if (advance === 0 || advance >= 0x80000000 || data.uptime_ms < previous.data.uptime_ms) return previous;
    }
    return { data, observedAt };
  }
  // Snapshot session, revision and readiness bound the lifetime of any cached /settings value.
  function createSettingsEvidence() {
    let current = null, version = 0;
    return {
      observe(data) {
        const next = { session: data.session_id, revision: data.config_revision, ready: data.health.settings_ready };
        if (current && current.session === next.session && current.revision === next.revision && current.ready === next.ready) return false;
        current = next; version++; return true;
      },
      matches: revision => !current || (current.ready && revision === current.revision),
      sameRevision: revision => !!current && revision === current.revision,
      session: () => current && current.session,
      token: () => version,
      invalidate() { version++; },
      reset() { current = null; version++; }
    };
  }
  function diagnosticView(data, receivedAt, now) {
    const valid = !!data && data.schema_version === 1 && typeof data.session_id === 'string' &&
      ['sequence', 'uptime_ms', 'sample_sequence', 'sample_at_ms', 'config_revision', 'near_threshold_cm', 'release_threshold_cm', 'snooze_remaining_ms', 'events_dropped'].every(k => Number.isSafeInteger(data[k]) && data[k] >= 0) &&
      !!data.health && ['wifi_connected', 'radar_fresh', 'measurement_known', 'tv_fresh', 'settings_ready'].every(k => typeof data.health[k] === 'boolean') &&
      ['idle', 'pending', 'failed'].includes(data.health.parameter_audit) && !!data.distance && !!data.tv &&
      ['active', 'standby', 'unknown'].includes(data.tv.power) && ['normal', 'low', 'high', 'picture_off', 'unknown'].includes(data.tv.mode) &&
      typeof data.tv.owns_picture_off === 'boolean' && typeof data.intent_enabled === 'boolean' && typeof data.monitoring === 'boolean' && typeof data.external_override === 'boolean' &&
      typeof data.reason === 'string' && Array.isArray(data.recent_events) && ['near', 'far', 'absent', 'unknown', 'unavailable'].includes(data.zone);
    const fresh = valid && now - receivedAt >= 0 && now - receivedAt <= 3500;
    const age = valid ? data.uptime_ms - data.sample_at_ms + (now - receivedAt) : Infinity;
    const radarCurrent = fresh && data.health.radar_fresh === true && data.uptime_ms >= data.sample_at_ms && age <= 2500;
    const sampleFresh = radarCurrent && data.health.measurement_known === true && ['near', 'far'].includes(data.zone);
    const cm = key => sampleFresh && data.distance[key + '_valid'] === true && Number.isFinite(data.distance[key + '_cm']) && data.distance[key + '_cm'] > 0 ? data.distance[key + '_cm'] : null;
    const moving = cm('moving'), still = cm('still'), values = [moving, still].filter(x => x !== null);
    const nearest = values.length ? Math.min(...values) : null;
    const format = n => n === null ? '—' : '约 ' + (n / 100).toFixed(1) + ' 米';
    return { valid, fresh, radarCurrent, sampleFresh, nearest, moving, still, distance: format(nearest), movingText: format(moving), stillText: format(still),
      zone: radarCurrent ? ({ near: '近处有目标', far: '远处有目标', absent: '未检测到目标', unknown: '测距状态不明确', unavailable: '雷达不可用' }[data.zone] || '未知') : '等待新鲜数据' };
  }
  // A scene target comes from one accepted diagnostic snapshot, never independent SSE sensors.
  function sceneObservation(data, observedAt, now, connected) {
    if (!connected) return { presence: 'unknown' };
    const view = diagnosticView(data, observedAt, now);
    if (!view.radarCurrent || !data.health.measurement_known) return { presence: 'unknown' };
    if (data.zone === 'absent') return { presence: 'absent' };
    if (view.sampleFresh && view.nearest !== null) return { presence: 'present', distanceCm: view.nearest };
    return { presence: 'unknown' };
  }
  const sceneClamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const sceneY = cm => 156 + (sceneClamp(cm, 50, 300) - 50) / 250 * 98;
  function sceneFloorBounds(near, release) {
    if (!Number.isFinite(near) || !Number.isFinite(release) || near < 50 || near > 300 || release < near || release > 320) return null;
    return { near: sceneY(near), release: sceneY(release) };
  }
  function createDistanceMotion() {
    const state = { presence: 'unknown', distanceCm: null, x: -60, y: 254, opacity: 0, phase: 'unknown', direction: 'front', sit: 0, cling: 0, desiredPose: 'standing', motion: null };
    const ease = n => n * n * (3 - 2 * n);
    const pose = () => state.sit > .001 ? 'sitting' : state.cling > .001 ? 'clinging' : 'standing';
    function advance(now) {
      const m = state.motion; if (!m) return;
      let t = now - m.start;
      if (m.keepPose) { const progress = sceneClamp(t / m.travelMs, 0, 1), e = ease(progress); state.x = m.x + (m.toX - m.x) * e; state.y = m.y + (m.toY - m.y) * e; state.phase = progress < 1 ? 'shifting' : 'idle'; if (progress >= 1) state.motion = null; return; }
      if (t < m.releaseMs) { state.phase = 'releasing'; const k = 1 - ease(sceneClamp(t / m.releaseMs, 0, 1)); state.sit = m.sit * k; state.cling = m.cling * k; return; }
      state.sit = 0; state.cling = 0; t -= m.releaseMs;
      if (t < m.turnMs) { state.phase = 'turning'; return; } t -= m.turnMs;
      if (t < m.travelMs) { state.phase = 'moving'; m.progress = sceneClamp(t / m.travelMs, 0, 1); const e = ease(m.progress); state.x = m.x + (m.toX - m.x) * e; state.y = m.y + (m.toY - m.y) * e; return; }
      state.x = m.toX; state.y = m.toY; t -= m.travelMs;
      if (t < m.poseMs) { state.phase = 'posing'; const k = ease(sceneClamp(t / m.poseMs, 0, 1)); state.sit = m.pose === 'sitting' ? k : 0; state.cling = m.pose === 'clinging' ? k : 0; state.direction = 'front'; return; }
      state.sit = m.pose === 'sitting' ? 1 : 0; state.cling = m.pose === 'clinging' ? 1 : 0; state.motion = null; state.direction = 'front'; state.phase = state.presence === 'absent' ? 'absent' : 'idle'; if (state.presence === 'absent') state.opacity = 0;
    }
    function update(target, now, reduced) {
      advance(now);
      const previous = state.presence, previousPhase = state.phase, old = state.motion;
      const cm = target.presence === 'present' ? sceneClamp(target.distanceCm, 50, 300) : null;
      let destPose = 'standing';
      if (cm !== null) {
        if ((state.desiredPose === 'sitting' && cm >= 260) || cm >= 280) destPose = 'sitting';
        else if ((state.desiredPose === 'clinging' && cm <= 70) || cm <= 60) destPose = 'clinging';
      }
      if (target.presence === 'unknown') { state.presence = 'unknown'; state.distanceCm = null; state.motion = null; state.phase = 'unknown'; state.direction = 'front'; if (state.opacity > 0) state.opacity = .18; return; }
      const outsideX = Number.isFinite(target.outsideX) ? Math.min(-60, target.outsideX) : -60;
      const x = target.presence === 'absent' ? outsideX : 201;
      const y = cm === null ? state.y : sceneY(cm);
      state.presence = target.presence; state.distanceCm = cm; state.desiredPose = destPose;
      if (target.presence === 'absent' && state.opacity === 0) { state.motion = null; state.x = x; state.phase = 'absent'; state.direction = 'front'; return; }
      if (target.presence === 'present' && ((previous === 'absent' && previousPhase === 'absent') || (previous === 'unknown' && state.opacity === 0))) { state.x = outsideX; state.y = y; state.sit = 0; state.cling = 0; }
      if (reduced) { state.motion = null; state.x = x; state.y = y; state.sit = destPose === 'sitting' ? 1 : 0; state.cling = destPose === 'clinging' ? 1 : 0; state.opacity = target.presence === 'present' ? 1 : 0; state.phase = target.presence === 'present' ? 'idle' : 'absent'; state.direction = 'front'; return; }
      if (old && previous === target.presence && Math.abs(old.toX - x) < .5 && Math.abs(old.toY - y) < .5 && old.pose === destPose) { state.opacity = 1; return; }
      const distance = Math.hypot(x - state.x, y - state.y);
      if (distance < .5 && pose() === destPose && !old && (destPose === 'standing' || Math.max(state.sit, state.cling) > .999)) { state.opacity = target.presence === 'present' ? 1 : 0; state.phase = target.presence === 'present' ? 'idle' : 'absent'; return; }
      if (!old && previous === 'present' && destPose !== 'standing' && pose() === destPose && Math.max(state.sit, state.cling) > .999 && distance < 12) {
        state.opacity = 1; state.direction = 'front'; state.phase = 'shifting';
        state.motion = { x: state.x, y: state.y, toX: x, toY: y, start: now, travelMs: 350, pose: destPose, keepPose: true };
        return;
      }
      state.opacity = 1; state.direction = x < state.x ? 'left' : 'right';
      const releaseMs = 260 * Math.max(state.sit, state.cling), travelMs = distance < .5 ? 0 : sceneClamp(distance / 115 * 1000, 650, 2600);
      state.motion = { x: state.x, y: state.y, toX: x, toY: y, start: now, sit: state.sit, cling: state.cling, releaseMs, turnMs: travelMs ? 150 : 0, travelMs, poseMs: destPose === 'standing' ? 0 : 300, pose: destPose, progress: 0 };
      state.phase = releaseMs ? 'releasing' : travelMs ? 'turning' : 'posing';
    }
    return { update, advance, read: () => ({ ...state, pose: pose(), poseProgress: Math.max(state.sit, state.cling) }) };
  }
  // Presentation is deliberately separate from raw device state and control permissions.
  function createTvPresentation() {
    let session = null, confirmed = null, unknownSince = null;
    const confirmedKinds = {
      'Active / picture visible': 'visible', 'Active / pictureOff': 'off',
      'Standby (will not wake)': 'standby'
    };
    const faults = {
      'ON; paused: TV communication failed': '电视通信失败',
      'ON; paused: TV rejected pictureOff': '电视拒绝关闭画面',
      'ON; command uncertain / failed; recovery pending': '画面操作未确认',
      'ON; hide not confirmed; recovery pending': '息屏未确认',
      'ON; RPC stalled; waiting without parallel request': '电视请求超时'
    };
    const titles = { connecting: '正在连接', visible: '画面正常', off: '画面已关闭', standby: '电视待机中', unknown: '电视状态待确认', offline: '设备已断开' };
    return { update(states, alive, generation, now, initialConnecting = false) {
      if (generation !== session) { session = generation; confirmed = null; unknownSince = null; }
      if (!alive) { confirmed = null; unknownSince = null; const kind = initialConnecting ? 'connecting' : 'offline'; return { kind, title: titles[kind] }; }
      const status = value(states, IDS.status);
      const fault = typeof status === 'string' && Object.prototype.hasOwnProperty.call(faults, status) ? faults[status] : null;
      if (fault) { confirmed = null; unknownSince = null; return { kind: 'fault', title: fault }; }
      const complete = CORE.every(id => value(states, id) !== null && value(states, id) !== '');
      const tv = value(states, IDS.tv);
      const kind = complete && typeof tv === 'string' && Object.prototype.hasOwnProperty.call(confirmedKinds, tv) ? confirmedKinds[tv] : null;
      if (kind) { confirmed = kind; unknownSince = null; return { kind, title: titles[kind] }; }
      if (unknownSince === null) unknownSince = now;
      const result = now - unknownSince < 5000 ? (confirmed || 'connecting') : 'unknown';
      return { kind: result, title: titles[result], ...(result !== 'unknown' ? { deadline: unknownSince + 5000 } : {}) };
    } };
  }
  const SETTINGS_KEYS = ['distance_cm', 'near_ms', 'radar_timeout_s', 'clear_ms', 'sensitivity'];
  const DEFAULT_SETTINGS = { distance_cm: 150, near_ms: 3000, radar_timeout_s: 1, clear_ms: 1000, sensitivity: 'standard' };
  function validateSettings(s) {
    return !!s && Number.isInteger(s.distance_cm) && s.distance_cm >= 50 && s.distance_cm <= 300 && s.distance_cm % 10 === 0 &&
      Number.isInteger(s.near_ms) && s.near_ms >= 1000 && s.near_ms <= 5000 && s.near_ms % 1000 === 0 &&
      [1, 2].includes(s.radar_timeout_s) && [1000, 2000].includes(s.clear_ms) && ['low', 'standard', 'high'].includes(s.sensitivity);
  }
  const sameSettings = (a, b) => validateSettings(a) && validateSettings(b) && SETTINGS_KEYS.every(key => a[key] === b[key]);
  async function pollSettings(read, expectedRevision, target, wait, attempts = 120) {
    for (let i = 0; i < attempts; i++) {
      await wait(); const data = await read();
      if (!data) continue;
      if (data.status === 'error') throw new Error('device-error');
      if (data.status === 'ready' && data.revision !== expectedRevision) {
        if (data.revision !== ((expectedRevision + 1) >>> 0) || !sameSettings(data.settings, target)) throw new Error('conflict');
        return data;
      }
    }
    throw new Error('timeout');
  }
  function settingsCloseDecision(dirty, applying) { return applying ? 'wait' : dirty ? 'confirm' : 'close'; }
  function calibrationResult(samples, expected) {
    const distances = samples.map(s => s.nearest).filter(n => Number.isFinite(n) && n > 0);
    return { count: samples.length, matched: samples.filter(s => s.zone === expected).length,
      uncertain: samples.filter(s => ['unknown', 'unavailable'].includes(s.zone)).length,
      min: distances.length ? Math.min(...distances) : null, max: distances.length ? Math.max(...distances) : null };
  }
  const translations = {
    'Trial OFF': '自动息屏已关闭',
    'ON; paused: snoozed': '暂时暂停，到时自动恢复',
    'ON; paused: external picture change; waiting for clear zone': '画面被手动恢复，离开近区后继续',
    'OFF; picture recovery pending': '已关闭，等待恢复画面',
    'ON; monitoring near zone': '已开启，正在监测近区',
    'ON; picture OFF by this trial': '已开启，本次已关闭画面',
    'ON; paused: TV standby (will not wake)': '已暂停：电视待机',
    'ON; paused: picture recovery pending': '已暂停：等待恢复画面',
    'ON; checking picture command': '正在确认画面操作',
    'ON; paused: Wi-Fi unavailable': '已暂停：Wi-Fi 不可用',
    'ON; paused: radar range not verified': '已暂停：雷达范围未验证',
    'ON; paused: radar data expired': '已暂停：雷达数据过期',
    'ON; paused: radar measurement unknown': '已暂停：测距状态不明确',
    'ON; paused: radar unavailable': '已暂停：雷达不可用',
    'ON; paused: TV status expired': '已暂停：电视状态过期',
    'ON; paused: TV communication failed': '已暂停：电视通信失败',
    'ON; paused: TV rejected pictureOff': '已暂停：电视拒绝关闭画面',
    'ON; command uncertain / failed; recovery pending': '操作未确认，等待恢复画面',
    'ON; hide not confirmed; recovery pending': '息屏未确认，等待恢复画面',
    'ON; RPC stalled; waiting without parallel request': '电视请求超时，等待完成',
    'Manual restore requested': '已请求手动恢复画面',
    'Picture restored; Trial ON': '画面已恢复，自动息屏已开启',
    'Picture restored; Trial OFF': '画面已恢复，自动息屏已关闭',
    'Recovery pending': '等待恢复画面',
    'Picture OFF by this trial': '本次已关闭画面',
    'Picture changed externally; confirming near zone again': '画面由外部更改，正在重新确认近区',
    'Reading original radar parameters': '正在读取雷达原始参数',
    'Setting / verifying 0.75 m resolution': '正在设置并验证 0.75 米分辨率',
    'Setting / verifying nominal 1.5 m range': '正在设置并验证约 1.5 米范围',
    'Nominal 1.5 m (gate 2), 0.75 m steps': '约 1.5 米，步长 0.75 米',
    'Range NOT verified; trial unavailable': '范围未验证，无法试用',
    'Active / picture visible': '电视开启，画面正常',
    'Active / pictureOff': '电视开启，画面已关闭',
    'Standby (will not wake)': '电视待机，不会唤醒',
    'Unavailable / state expired': '不可用或状态已过期',
    'Unavailable': '不可用'
  };
  function detailValue(id, v, alive) {
    if (!alive || v == null || v === '' || v === 'unknown' || v === 'Unknown' || v === 'NA') return '未知';
    if ([IDS.monitoring, IDS.radar, IDS.known, IDS.owns].includes(id)) return on(v) ? '是' : off(v) ? '否' : '未知';
    if (id === IDS.range && typeof v === 'string' && v.startsWith('Nominal 1.5 m (gate 2), 0.75 m steps; radar delay 1 s')) return '约 1.5 米，雷达无人延时 1 秒';
    if ([IDS.status, IDS.range, IDS.tv].includes(id)) return typeof v === 'string' && Object.prototype.hasOwnProperty.call(translations, v) ? translations[v] : '状态未知';
    if (id === IDS.signal && typeof v === 'number' && Number.isFinite(v)) return `${v} dBm`;
    if (id === IDS.uptime && typeof v === 'number' && Number.isFinite(v)) return `${Math.floor(v)} 秒`;
    if ([IDS.ip, IDS.firmware].includes(id) && typeof v === 'string' && /^[\w.:-]+$/.test(v)) return v;
    return '未知';
  }
  function derive(states, alive) {
    const complete = CORE.every(id => value(states, id) !== null && value(states, id) !== '');
    const connected = alive && complete;
    const intent = value(states, IDS.intent);
    const tv = value(states, IDS.tv);
    const active = typeof tv === 'string' && tv.startsWith('Active / ');
    const monitoring = on(value(states, IDS.monitoring));
    const radar = on(value(states, IDS.radar));
    const zone = value(states, IDS.zone);
    let headline = '状态未知';
    if (connected && tv === 'Active / picture visible') headline = '画面正常';
    else if (connected && tv === 'Active / pictureOff') headline = '画面已关闭';
    else if (connected && tv === 'Standby (will not wake)') headline = '电视待机中';
    let zoneTitle = '正在获取测距状态';
    let zoneHelp = '请稍候，或刷新设备状态';
    if (connected && radar && zone === 'Presence') {
      zoneTitle = '近距离检测到目标'; zoneHelp = '近区持续有人时自动息屏';
    } else if (connected && radar && zone === 'Clear') {
      zoneTitle = '当前没有近距离目标'; zoneHelp = '仅在近区持续有人时息屏';
    } else if (connected && radar && zone === 'Unknown') {
      zoneTitle = '测距状态不明确'; zoneHelp = '暂不能判断近区是否有人';
    } else if (connected) {
      zoneTitle = '雷达状态不可用'; zoneHelp = '等待雷达数据与范围确认';
    }
    let helper = '等待设备状态';
    if (connected) {
      if (!on(intent)) helper = '已关闭，需要时可手动开启';
      else if (value(states, IDS.status) === 'ON; paused: snoozed') helper = '暂时暂停，到时自动恢复';
      else if (value(states, IDS.status) === 'ON; paused: external picture change; waiting for clear zone') helper = '尊重手动恢复，离开近区后继续';
      else if (monitoring) helper = '正在监测近距离目标';
      else if (tv === 'Standby (will not wake)') helper = '电视待机时暂停，开机后继续';
      else helper = '已开启，等待设备状态恢复';
    }
    const intentKnown = on(intent) || off(intent);
    return { connected, complete, active, intent: on(intent), monitoring, headline, zoneTitle, zoneHelp, helper,
      canSwitch: alive && intentKnown, canRestore: alive && intentKnown && active };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsEvidence, sceneObservation, sceneFloorBounds, createDistanceMotion, IDS, derive, createTvPresentation, isAlive, acceptState, detailValue, supportsNativeSwitch, settingsCloseDecision, calibrationResult, updateDiagnosticsCache, diagnosticView, createDiagnosticsPoller, applyVersionedState, boundedRequest, readEntity, runExclusive, createRequestQueue, validateSettings, sameSettings, pollSettings };
    return;
  }
  const meta = (name, content, attr = 'name') => {
    let node = document.head.querySelector(`meta[${attr}="${name}"]`);
    if (!node) { node = document.createElement('meta'); node.setAttribute(attr, name); document.head.append(node); }
    node.setAttribute('content', content);
  };
  document.title = '观距';
  meta('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  meta('theme-color', '#ffffff');
  meta('apple-mobile-web-app-capable', 'yes');
  meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  meta('apple-mobile-web-app-title', '观距');
  const icon = document.createElement('link'); icon.rel = 'apple-touch-icon';
  icon.href = '/apple-touch-icon-v1.png'; icon.sizes = '180x180'; icon.type = 'image/png';
  document.head.append(icon);

  const markup = `
    <main class="app-shell" id="main-content">
      <header class="topbar"><div><h1>观距</h1></div>
        <nav class="header-actions" aria-label="设备操作"><button class="header-action refresh" id="refresh" aria-label="刷新网页" title="刷新网页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v-4m0 0h-4m4 0-3 3A8 8 0 1 0 20 13"/></svg></button><button class="header-action" id="settings-open" aria-label="参数设置" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="17" r="2"/></svg></button><button class="header-action" id="details-open" aria-label="设备详情" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-8h.01"/></svg></button></nav>
      </header>
      <section class="summary" aria-live="polite" data-tv="connecting"><h2><span class="dot" aria-hidden="true"></span><span id="headline">正在连接</span></h2><p id="scene-explanation">正在获取测距状态</p><span class="sr-only" id="connection">设备正在连接</span></section>
      <section class="scene" data-state="unknown" data-monitoring="false" data-tv="connecting" aria-label="雷达探测和电视沙发示意图">
    <svg viewBox="0 0 402 330" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs><linearGradient id="screen" x2="0" y2="1"><stop stop-color="#f7faf8"/><stop offset="1" stop-color="#e2ece5"/></linearGradient><clipPath id="floor"><path d="M201 104 L67 281 Q201 315 335 281 Z"/></clipPath></defs>
      <g id="scene-floor" clip-path="url(#floor)"><path id="scene-near-area" d="M50 102H352V195.2H50Z" fill="#f7deda"/><path id="scene-release-area" d="M50 195.2H352V203.04H50Z" fill="#f9eacb"/><path id="scene-far-area" d="M50 203.04H352V315H50Z" fill="#e5f1e7"/><path id="scene-boundaries" d="M50 195.2H352M50 203.04H352" stroke="#fff" stroke-width="1.5" opacity=".8"/></g>
      <path d="M201 104L67 281Q201 315 335 281Z" fill="none" stroke="#dce9df" stroke-width="1"/>
      <g clip-path="url(#floor)" fill="none" stroke="#7ba388" stroke-width="1.7" stroke-linecap="round"><g transform="translate(201 112)"><g class="scene-wave"><path d="M-18 7 Q0 27 18 7" vector-effect="non-scaling-stroke"/></g><g class="scene-wave scene-wave-two"><path d="M-18 7 Q0 27 18 7" vector-effect="non-scaling-stroke"/></g><g class="scene-wave scene-wave-three"><path d="M-18 7 Q0 27 18 7" vector-effect="non-scaling-stroke"/></g></g></g>
      <rect x="125" y="10" width="152" height="77" rx="1" fill="url(#screen)" stroke="#536d61" stroke-width="1.4"/><path d="M127 55q27-20 51-9t51-3q23-13 46-7v49H127Z" fill="#dfeae3" opacity=".65"/><rect class="screen-overlay" x="127" y="12" width="148" height="73"/><path d="M198 87v5m6-5v5m-23 3 20-3 20 3" fill="none" stroke="#536d61" stroke-width="2" stroke-linecap="round"/><rect x="115" y="95" width="172" height="18" rx="1" fill="#f8fbf9" stroke="#6d8379"/><path d="M158 96v16m86-16v16m-125 1-2 5m165-5 2 5" stroke="#6d8379" fill="none"/>
      <g stroke="#536d61" stroke-width="1.1" fill="#f9fcfa"><rect x="139" y="263" width="124" height="32" rx="8"/><path d="M139 275v-3q0-10 10-10h43q9 0 9 9 0-9 9-9h43q10 0 10 10v3"/><rect x="127" y="271" width="12" height="33" rx="6"/><rect x="263" y="271" width="12" height="33" rx="6"/><rect x="137" y="274" width="128" height="31" rx="4"/><path d="M141 305l-1 7h4l2-7m110 0 2 7h4l-1-7"/></g>
      <g id="actor-position"><ellipse id="shadow" cx="0" cy="0" rx="17" ry="4" fill="#486551" opacity=".16"/><g id="actor-opacity"><g id="actor-facing"><g id="actor-bob" stroke="#536d61" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
        <g id="leg-back"><path id="leg-back-line" d="M-4 -18 L-5 -7 L-8 -2" fill="none" stroke="#64776a" stroke-width="3.3"/><path id="leg-back-foot" d="M-8 -2 h-4" fill="none" stroke="#5c7163" stroke-width="2.7"/></g>
        <g id="leg-front"><path id="leg-front-line" d="M4 -18 L5 -7 L8 -2" fill="none" stroke="#64776a" stroke-width="3.3"/><path id="leg-front-foot" d="M8 -2 h4" fill="none" stroke="#5c7163" stroke-width="2.7"/></g>
        <g id="arm-back"><path id="arm-back-line" d="M-6 -38 Q-12 -33 -13 -25" fill="none" stroke="#d6b9a4" stroke-width="4"/></g>
        <path id="dress" d="M-8 -40 Q0 -43 8 -40 L13 -19 Q0 -15 -13 -19Z" fill="#f2dfce"/><path d="M-12 -21 Q0 -18 12 -21" fill="none" stroke="#a9c0ab"/><path d="M-5 -38 Q0 -35 5 -38" fill="none" stroke="#cfb6a6" stroke-width=".9"/>
        <g id="arm-front"><path id="arm-front-line" d="M7 -38 Q12 -33 14 -26" fill="none" stroke="#e7c8b3" stroke-width="4"/></g>
        <g id="head">
          <g id="hair-tails" fill="#19191d" stroke="#111115" stroke-width=".8" stroke-linejoin="round">
            <g id="pigtail-left"><path d="M-9 -58 Q-12 -59 -14 -57 Q-16 -56 -15.5 -54 Q-15 -52.7 -13.4 -53.2 Q-10.8 -54 -9 -55.8 Z"/><path d="M-11.5 -57 Q-13.3 -57 -14.7 -55.4 M-11.8 -55.8 Q-13.1 -55.8 -14.1 -54.7" fill="none" stroke="#48484d" stroke-width=".8"/></g>
            <g id="pigtail-right"><path d="M9 -58 Q12 -59 14 -57 Q16 -56 15.5 -54 Q15 -52.7 13.4 -53.2 Q10.8 -54 9 -55.8 Z"/><path d="M11.5 -57 Q13.3 -57 14.7 -55.4 M11.8 -55.8 Q13.1 -55.8 14.1 -54.7" fill="none" stroke="#48484d" stroke-width=".8"/></g>
          </g>
          <path id="rear-hair" d="M-10 -54 Q-10 -66 0 -66 Q10 -66 10 -54 L10 -50 Q9 -43.5 4 -43 Q2 -42.4 0 -43 Q-2 -42.4 -4 -43 Q-9 -43.5 -10 -50 Z" fill="#19191d" stroke="#111115"/>
          <circle cx="-10.2" cy="-58" r="1.65" fill="#e88f82" stroke="none"/><circle cx="10.2" cy="-58" r="1.65" fill="#e88f82" stroke="none"/>
          <path d="M-7 -59 Q-3 -64 3 -63 M-7 -49 Q0 -45 7 -49" fill="none" stroke="#49494e" stroke-width=".8" stroke-linecap="round" opacity=".9"/>
        </g>
      </g></g></g></g>
      <!-- The sofa front hides the lower body at the seated depth. -->
      <path d="M137 274h128v31H137Z" fill="#f9fcfa" stroke="#536d61" stroke-width="1.1"/>
    </svg>
      </section>
      <section class="control-panel"><span class="tv-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M9 20h6m-3-3v3"/></svg></span><div class="control-copy"><h3>自动息屏</h3><p id="control-help">等待设备状态</p></div><label class="switch-area"><input id="trial" type="checkbox" switch aria-label="自动息屏" disabled></label></section>
      <section class="rules" aria-label="自动息屏规则"><div><strong id="range">—</strong><span>近距范围</span></div><div><strong id="approach-time">—</strong><span>靠近确认</span></div></section>
      <section class="pause-controls" aria-label="临时暂停"><button id="pause-10" disabled>暂停 10 分钟</button><button id="pause-30" disabled>暂停 30 分钟</button><button id="resume" hidden disabled>继续监测</button></section>
      <section class="restore"><button id="restore" disabled>恢复画面并停用</button></section>
      <p class="footer">局域网连接 · 无需电脑常开</p>
    </main>
    <div class="sheet-backdrop" id="backdrop" hidden><section class="sheet debug-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <div class="sheet-handle"></div><div class="sheet-heading"><h2 id="sheet-title">调试模式</h2><button id="details-close" aria-label="关闭调试模式">返回</button></div>
      <p class="settings-intro">查看设备实际观测，不影响自动息屏设置。</p>
      <p class="settings-message" id="diagnostic-message" role="status">正在读取设备诊断…</p>
      <dl class="diagnostic-main"><div><dt>最近目标距离<small>雷达近似测距，不代表精确位置</small></dt><dd id="diagnostic-distance">—</dd></div><div><dt>目标状态</dt><dd id="diagnostic-zone">等待新鲜数据</dd></div><div><dt>雷达数据</dt><dd id="diagnostic-radar">未知</dd></div><div><dt>电视连接</dt><dd id="diagnostic-tv">未知</dd></div><div><dt>自动监测</dt><dd id="diagnostic-monitoring">未知</dd></div><div class="reason-row"><dt>当前状态说明</dt><dd id="diagnostic-reason">等待设备确认</dd></div></dl>
      <details class="debug-section"><summary>测量与设备详情</summary><dl id="diagnostic-extra"></dl><dl id="details-list"></dl></details>
      <details class="debug-section"><summary>最近事件 <span id="event-count"></span></summary><p class="debug-note">设备内存中的有限记录，重启清空；不是完整雷达录制。</p><ol id="diagnostic-events"></ol></details>
      <details class="debug-section" id="calibration"><summary>引导校准</summary><p class="debug-note">先关闭自动息屏，在实际观看位置观察。这里只记录与建议，不会应用参数。</p><p id="calibration-instruction">依次检查近处、远处、静坐和无人场景。</p><p id="calibration-progress" class="debug-note"></p><button class="secondary-button" id="calibration-start">开始观察</button><button class="secondary-button" id="calibration-record" hidden disabled>记录这一步</button><button class="text-button" id="calibration-cancel" hidden>结束观察</button><ol id="calibration-results"></ol></details>
      <p class="settings-footer">仅在此页前台打开时更新 · 可信局域网内使用</p>
    </section></div>
    <div class="sheet-backdrop" id="settings-backdrop" hidden><section class="sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <div class="sheet-handle"></div><div class="sheet-heading"><h2 id="settings-title">参数设置</h2><button id="settings-close">关闭</button></div>
      <p class="settings-intro">根据家里的观看位置，调到刚刚好。</p>
      <p class="settings-message" id="settings-message" role="status" aria-live="polite">正在读取设备参数…</p>
      <div class="settings-guard" id="settings-guard" hidden role="alert"><strong>修改还没有应用</strong><p>继续调整，或放弃修改后关闭。</p><div><button id="settings-keep">继续编辑</button><button id="settings-discard">放弃修改</button></div></div>
      <button class="settings-reload" id="settings-reload" hidden>重新加载设备参数</button>
      <fieldset id="settings-fields" disabled>
        <div class="settings-card"><div class="range-heading"><strong>近距范围</strong><output id="distance-value">—</output></div><div class="range-input"><span>0.5 米</span><input type="range" id="distance" min="50" max="300" step="10" aria-label="近距范围"><span>3.0 米</span></div><p>雷达观察范围约 6 米；近于此距离才开始确认。</p></div>
        <div class="settings-card timings"><div class="timing-list">
          <div class="timing-row"><span>靠近确认</span><output id="near-value">—</output><div class="stepper"><button type="button" data-step="near_ms" data-delta="-1000" aria-label="减少靠近确认时间">−</button><button type="button" data-step="near_ms" data-delta="1000" aria-label="增加靠近确认时间">＋</button></div></div>

          <div class="timing-row"><span>恢复确认</span><output id="clear-value">—</output><div class="stepper"><button type="button" data-step="clear_ms" data-delta="-1000" aria-label="减少恢复确认时间">−</button><button type="button" data-step="clear_ms" data-delta="1000" aria-label="增加恢复确认时间">＋</button></div></div>
        </div><p id="base-delay">基础恢复等待时间尚未确认。</p></div>
        <details class="advanced-settings" id="advanced-settings"><summary>高级设置</summary><div class="settings-card advanced-card"><div class="timing-list">          <div class="timing-row"><span>无人延时</span><output id="radar-timeout-value">—</output><div class="stepper"><button type="button" data-step="radar_timeout_s" data-delta="-1" aria-label="减少无人延时">−</button><button type="button" data-step="radar_timeout_s" data-delta="1" aria-label="增加无人延时">＋</button></div></div></div><p>目标消失后，雷达等待多久报告无人。</p></div>
        <div class="settings-card"><strong class="settings-label">灵敏度</strong><div class="sensitivity" role="radiogroup" aria-label="灵敏度"><label><input type="radio" name="sensitivity" value="low"><span>低</span></label><label><input type="radio" name="sensitivity" value="standard"><span>标准</span></label><label><input type="radio" name="sensitivity" value="high"><span>高</span></label></div><p>越高越容易检测到细微活动，也可能增加误触发。</p></div>
        </details>
        <button class="settings-apply" id="settings-apply" type="button">应用设置</button>
        <button class="settings-defaults" id="settings-defaults" type="button">恢复默认参数</button>
      </fieldset>
      <p class="settings-footer">设置保存在小板中，不影响 Wi-Fi 和功能开关。</p>
    </section></div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;
  class ObserverApp extends HTMLElement {
    connectedCallback() { if (!this.dataset.ready) { this.dataset.ready = '1'; this.innerHTML = markup; start(this); } }
  }
  customElements.define('esp-app', ObserverApp);

  function start(app) {
    const states = Object.create(null), revisions = Object.create(null);
    const enqueue = createRequestQueue();
    const el = id => app.querySelector('#' + id);
    if (!supportsNativeSwitch(HTMLInputElement.prototype)) el('trial').classList.add('switch-fallback');
    const controlLock = { active: false }, refreshLock = { active: false }, settingsLock = { active: false }, recoveryLock = { active: false };
    let source = null, lastEvent = 0, reconnectTimer = 0, retry = 1000, generation = 0, toastTimer = 0;
    let settingsData = null, settingsGeneration = -1, settingsResponseGeneration = -1, settingsResponseAt = 0, settingsRead = null, settingsMutation = 0, draft = null, draftRevision = null, dirty = false, conflict = false, settingsNotice = '';
    let previousFocus = null, diagnostics = null, diagnosticsAt = 0, diagnosticsError = '', diagnosticsCache = null;
    let calibrationStep = -1, calibrationRecording = false, calibrationSamples = [], calibrationLast = '', calibrationSession = '', calibrationResults = [];
    const calibrationSteps = [{ title: '站在希望提醒的近处', expected: 'near' }, { title: '退到正常观看位置', expected: 'far' }, { title: '在观看位置安静坐好', expected: 'far' }, { title: '离开雷达覆盖区域', expected: 'absent' }];
    const tvPresentation = createTvPresentation(), distanceMotion = createDistanceMotion(), settingsEvidence = createSettingsEvidence();
    let sceneFrame = 0, presentationTimer = 0, presentationDeadline = null, connectionFailed = false, hasConnected = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const text = (id, content) => { const node = el(id); if (node.textContent !== content) { node.textContent = content; if (node.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); } };
    const apiPath = id => { const [domain, name] = id.split('/'); return '/' + domain + '/' + encodeURIComponent(name); };
    const request = (url, options = {}) => enqueue(() => boundedRequest(fetch, url, options), 0);
    const diagnosticsPoller = createDiagnosticsPoller({ enqueue, fetcher: fetch, onData: (data, requestedAt) => {
      if (!diagnosticView(data, 0, 0).valid) throw new Error('invalid diagnostics');
      const previous = diagnosticsCache;
      diagnosticsCache = updateDiagnosticsCache(previous, data, requestedAt); diagnostics = diagnosticsCache.data; diagnosticsAt = diagnosticsCache.observedAt; diagnosticsError = '';
      const previousSession = settingsEvidence.session();
      const changed = diagnosticsCache !== previous && settingsEvidence.observe(diagnostics);
      if (changed) {
        settingsGeneration = -1; settingsResponseGeneration = -1; settingsNotice = '';
        if (dirty && ((previousSession && previousSession !== diagnostics.session_id) || draftRevision !== diagnostics.config_revision)) conflict = true;
      }
      collectCalibration(); render();
      if (changed && !document.hidden && !settingsLock.active) readSettings().catch(() => {});
    }, onError: error => { diagnosticsError = error.status === 404 ? '当前固件不支持诊断，请更新固件。' : error.status === 429 ? '设备繁忙，正在减慢更新。' : '诊断暂不可用，正在重试。'; render(); } });
    function updateDiagnosticsPolling() { diagnosticsPoller.setActive(!document.hidden && isAlive(lastEvent, Date.now())); }
    function setState(data, expected = generation) { if (applyVersionedState(states, revisions, data, expected, generation)) render(); }
    async function get(id, expected = generation) { const data = await enqueue(() => readEntity(fetch, apiPath(id), id, states, revisions, () => generation, expected), CORE.includes(id) || id === IDS.scene ? 1 : 3, () => expected === generation); render(); return data; }
    function notify(message) { const box = el('toast'); box.textContent = message; box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 3500); }
    function validEnvelope(data) {
      return !!data && Number.isInteger(data.revision) && data.revision >= 0 && data.revision <= 0xffffffff &&
        ['ready', 'applying', 'error'].includes(data.status) && validateSettings(data.settings);
    }
    function syncSettings(data, epoch) {
      if (epoch !== generation || !validEnvelope(data)) throw new Error('invalid settings');
      settingsData = data; settingsGeneration = !document.hidden && data.status !== 'error' && settingsEvidence.matches(data.revision) ? epoch : -1;
      settingsResponseGeneration = !document.hidden && data.status === 'error' && settingsEvidence.sameRevision(data.revision) ? epoch : -1; settingsResponseAt = Date.now();
      if (dirty && draftRevision !== data.revision) conflict = true;
      if (!dirty && data.status !== 'applying') { draft = { ...data.settings }; draftRevision = data.revision; conflict = false; }
      render();
      return data;
    }
    function readSettings() {
      if (settingsRead && settingsRead.epoch === generation && settingsRead.mutation === settingsMutation && settingsRead.evidence === settingsEvidence.token()) return settingsRead.promise;
      const epoch = generation, mutation = settingsMutation, evidence = settingsEvidence.token();
      const reading = (async () => {
        try {
          const data = await enqueue(() => boundedRequest(fetch, '/settings', {}, true), 2, () => epoch === generation && mutation === settingsMutation && evidence === settingsEvidence.token());
          if (epoch !== generation || mutation !== settingsMutation || evidence !== settingsEvidence.token()) throw new Error('stale response');
          settingsNotice = '';
          return syncSettings(data, epoch);
        } catch (error) {
          if (epoch === generation && mutation === settingsMutation && evidence === settingsEvidence.token()) {
            settingsGeneration = -1; settingsResponseGeneration = -1;
            settingsNotice = error.status === 404 ? '当前固件不支持参数设置，请更新固件。' : '无法读取设备参数，请刷新后重试。';
            render();
          }
          throw error;
        }
      })();
      const entry = { epoch, mutation, evidence, promise: reading };
      settingsRead = entry;
      reading.finally(() => { if (settingsRead === entry) settingsRead = null; }).catch(() => {});
      return reading;
    }
    // An Error envelope can authorize retry only while its diagnostic session and revision are current.
    // It must never make the saved settings a verified home-display fallback.
    function currentErrorResponse(now = Date.now()) {
      const view = diagnosticView(diagnostics, diagnosticsAt, now);
      return !!settingsData && settingsData.status === 'error' && settingsResponseGeneration === generation &&
        !document.hidden && isAlive(lastEvent, now) && now >= settingsResponseAt && now - settingsResponseAt <= 3500 &&
        view.fresh && !diagnostics.health.settings_ready && settingsEvidence.sameRevision(settingsData.revision);
    }
    function renderSettings() {
      const alive = isAlive(lastEvent, Date.now()), current = (settingsGeneration === generation || currentErrorResponse()) && settingsData;
      let message = settingsNotice;
      if (!message && conflict) message = '设备参数已改变。重新加载将丢弃未应用的修改。';
      else if (!message && current && current.status === 'applying') message = '正在应用并验证参数，监测暂时暂停。';
      else if (!message && current && current.status === 'error') message = '参数未能确认，监测已暂停；可重试或恢复默认。';
      else if (!message && dirty) message = '有未应用的修改。';
      else if (!message && !current) message = '正在读取设备参数…';
      else if (!message) message = '参数已由设备确认。';
      text('settings-message', message);
      el('settings-reload').hidden = !conflict;
      el('settings-apply').disabled = !current || !['ready', 'error'].includes(current.status) || !dirty;
      el('settings-fields').disabled = !draft || !alive || !current || current.status === 'applying' || settingsLock.active || conflict;
      if (!draft) return;
      el('distance').value = draft.distance_cm;
      el('distance').style.setProperty('--range-fill', `${(draft.distance_cm - 50) / 250 * 100}%`);
      el('distance-value').textContent = (draft.distance_cm / 100).toFixed(1) + ' 米';
      el('near-value').textContent = (draft.near_ms / 1000) + ' 秒';
      el('radar-timeout-value').textContent = draft.radar_timeout_s + ' 秒';
      el('clear-value').textContent = (draft.clear_ms / 1000) + ' 秒';
      el('base-delay').textContent = `基础恢复等待约 ${draft.radar_timeout_s + draft.clear_ms / 1000} 秒，另加通信时间。`;
      app.querySelectorAll('input[name="sensitivity"]').forEach(input => { input.checked = input.value === draft.sensitivity; });
      const bounds = { near_ms: [1000, 5000], radar_timeout_s: [1, 2], clear_ms: [1000, 2000] };
      app.querySelectorAll('[data-step]').forEach(button => { const [min, max] = bounds[button.dataset.step]; const next = draft[button.dataset.step] + Number(button.dataset.delta); button.disabled = next < min || next > max; });
    }
    function showDetails() {
      const labels = [[IDS.status,'试用状态'],[IDS.range,'近距范围'],[IDS.tv,'电视状态'],[IDS.monitoring,'实际监测'],[IDS.radar,'雷达数据'],[IDS.known,'测距可判定'],[IDS.owns,'本次恢复责任'],[IDS.signal,'Wi-Fi 信号'],[IDS.uptime,'运行时间'],[IDS.ip,'IP 地址'],[IDS.firmware,'雷达固件']];
      const list = el('details-list');
      for (const [id, label] of labels) {
        let row = list.querySelector(`[data-key="${id}"]`);
        if (!row) { row = document.createElement('div'); row.dataset.key = id; const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); row.append(dt, dd); list.append(row); }
        row.lastChild.textContent = id === IDS.range ? (settingsGeneration === generation && settingsData && settingsData.status === 'ready' && isAlive(lastEvent, Date.now()) ? `${(settingsData.settings.distance_cm / 100).toFixed(1)} 米，雷达无人延时 ${settingsData.settings.radar_timeout_s} 秒` : '未知') : detailValue(id, value(states, id), isAlive(lastEvent, Date.now()));
      }
    }
    function renderDiagnostics() {
      const view = diagnosticView(diagnostics, diagnosticsAt, Date.now()), data = view.fresh ? diagnostics : null;
      text('diagnostic-message', diagnosticsError || (view.fresh ? '实时快照 · 约每秒更新' : '等待新鲜诊断数据…'));
      text('diagnostic-distance', view.distance); text('diagnostic-zone', view.zone);
      text('diagnostic-radar', data ? (view.radarCurrent ? (data.health.measurement_known ? '正常' : '测距不明确') : '数据过期') : '未知');
      text('diagnostic-tv', data ? (data.health.tv_fresh ? (data.tv.power === 'standby' ? '待机，不会唤醒' : '已连接') : '状态过期') : '未知');
      text('diagnostic-monitoring', data ? (data.monitoring ? '运行中' : data.intent_enabled ? '已开启，当前暂停' : '已关闭') : '未知');
      text('diagnostic-reason', data ? (translations[data.reason] || '设备状态暂未识别，请查看最近事件') : '等待设备确认');
      const rows = data ? [
        ['移动目标距离', view.movingText], ['静止目标距离', view.stillText],
        ['进入 / 离开近区', `${data.near_threshold_cm / 100} / ${data.release_threshold_cm / 100} 米`],
        ['参数审计', ({ idle: '已确认', pending: '正在核验', failed: '未通过，监测暂停' })[data.health.parameter_audit] || '未知'],
        ['参数状态 / 版本', `${data.health.settings_ready ? '已确认' : '未就绪'} / ${data.config_revision}`],
        ['临时暂停', data.snooze_remaining_ms > 0 ? `约剩 ${Math.ceil(data.snooze_remaining_ms / 60000)} 分钟（设备快照）` : '未暂停'],
        ['尊重手动恢复', data.external_override ? '等待离开近区' : '未暂停'],
        ['快照 / 测量序号', `${data.sequence} / ${data.sample_sequence}`]
      ] : [['测量数据', '等待新鲜数据']];
      const extra = el('diagnostic-extra'); extra.replaceChildren();
      rows.forEach(([label, value]) => { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); extra.append(row); });
      const events = el('diagnostic-events'); events.replaceChildren();
      const recent = data && Array.isArray(data.recent_events) ? data.recent_events.slice(-12).reverse() : [];
      text('event-count', recent.length ? `· ${recent.length}` : '');
      if (!recent.length) { const item = document.createElement('li'); item.textContent = data ? '暂无事件' : '等待设备记录'; events.append(item); }
      for (const event of recent) { const item = document.createElement('li'); const age = Number.isFinite(event.at_ms) ? Math.max(0, Math.floor((data.uptime_ms - event.at_ms) / 1000)) : null; item.textContent = `${age === null ? '' : age + ' 秒前 · '}${String(event.type || '').slice(0, 40)} — ${translations[event.detail] || String(event.detail || '').slice(0, 160)}`; events.append(item); }
      if (data && data.events_dropped) { const item = document.createElement('li'); item.textContent = `较早的 ${data.events_dropped} 条记录已移出内存。`; events.append(item); }
      renderCalibration();
    }
    function collectCalibration() {
      if (!calibrationRecording || calibrationStep < 0 || calibrationStep >= calibrationSteps.length || document.hidden) return;
      if (diagnostics.intent_enabled) { calibrationStep = -1; text('calibration-instruction', '自动息屏已开启，已停止观察。请先关闭再校准。'); return; }
      if (calibrationSession && calibrationSession !== diagnostics.session_id) { calibrationStep = -1; calibrationResults = []; text('calibration-instruction', '设备已重启，请重新开始观察。'); return; }
      calibrationSession = diagnostics.session_id;
      const key = diagnostics.session_id + ':' + diagnostics.sequence;
      if (key === calibrationLast) return; calibrationLast = key;
      const view = diagnosticView(diagnostics, diagnosticsAt, Date.now());
      if (!view.fresh) return;
      if (calibrationSamples.length < 30) calibrationSamples.push({ zone: view.radarCurrent ? diagnostics.zone : 'unavailable', nearest: view.nearest });
    }
    function renderCalibration() {
      const active = calibrationStep >= 0 && calibrationStep < calibrationSteps.length;
      el('calibration-start').hidden = active && calibrationRecording; el('calibration-start').textContent = active ? '开始这一步' : calibrationResults.length ? '重新观察' : '开始观察'; el('calibration-record').hidden = !active || !calibrationRecording; el('calibration-cancel').hidden = !active;
      el('calibration-start').disabled = !diagnosticView(diagnostics, diagnosticsAt, Date.now()).fresh || diagnostics.intent_enabled;
      el('calibration-record').disabled = calibrationSamples.length < 3 || !diagnosticView(diagnostics, diagnosticsAt, Date.now()).fresh;
      if (active) { text('calibration-instruction', `${calibrationStep + 1} / 4 · ${calibrationSteps[calibrationStep].title}`); text('calibration-progress', calibrationRecording ? `已观察 ${calibrationSamples.length} 次快照（最多 30 次）。至少 3 次后可记录；这不是完整雷达采样。` : '站好位置后开始这一步；移动过程不计入记录。'); }
      else text('calibration-progress', diagnostics && diagnostics.intent_enabled ? '请先回首页关闭自动息屏。' : '结果仅供调整参考，不会改变任何参数。');
      const list = el('calibration-results'); list.replaceChildren();
      calibrationResults.forEach((result, index) => { const item = document.createElement('li'); item.textContent = `${calibrationSteps[index].title}：${result.matched}/${result.count} 次符合预期${result.uncertain ? `，${result.uncertain} 次不明确` : ''}${result.min !== null ? `；有效距离约 ${(result.min / 100).toFixed(1)}–${(result.max / 100).toFixed(1)} 米` : ''}`; list.append(item); });
    }
    el('calibration-start').addEventListener('click', () => {
      if (!diagnosticView(diagnostics, diagnosticsAt, Date.now()).fresh || diagnostics.intent_enabled) return;
      if (calibrationStep < 0 || calibrationStep >= calibrationSteps.length) { calibrationStep = 0; calibrationResults = []; } calibrationRecording = true; calibrationSamples = []; calibrationLast = diagnostics.session_id + ':' + diagnostics.sequence; calibrationSession = diagnostics.session_id; renderCalibration();
    });
    el('calibration-record').addEventListener('click', () => {
      if (!calibrationRecording || calibrationStep < 0 || calibrationSamples.length < 3 || !diagnosticView(diagnostics, diagnosticsAt, Date.now()).fresh) return;
      calibrationResults.push(calibrationResult(calibrationSamples, calibrationSteps[calibrationStep].expected)); calibrationStep++; calibrationRecording = false; calibrationSamples = [];
      if (calibrationStep === calibrationSteps.length) { const clean = calibrationResults.every(r => r.matched === r.count); text('calibration-instruction', clean ? '这些观察符合预期。仍请在真实观看时继续确认，结果不代表完整验证。' : '部分观察不符合预期。先检查摆放和遮挡，再到参数设置小幅调整后重测。'); }
      renderCalibration();
    });
    el('calibration-cancel').addEventListener('click', () => { calibrationStep = -1; calibrationRecording = false; calibrationSamples = []; text('calibration-instruction', '观察已结束，已记录的结果保留在此页。'); renderCalibration(); });
    function paintScene(now) {
      distanceMotion.advance(now); const state = distanceMotion.read(), node = id => el(id);
      node('actor-position').setAttribute('transform', `translate(${state.x} ${state.y})`);
      node('actor-opacity').setAttribute('opacity', state.opacity);
      node('shadow').setAttribute('opacity', state.opacity * .16 * (1 - state.sit));
      const moving = state.phase === 'moving', m = state.motion;
      const envelope = moving && m ? Math.max(0, Math.min(1, m.progress * 6, (1 - m.progress) * 6)) : 0;
      const gait = moving ? Math.sin((now - m.start - m.releaseMs - m.turnMs) * .018) : 0, swing = gait * 27 * envelope;
      const direction = state.direction === 'left' ? -1 : 1, sideways = moving || state.phase === 'turning';
      node('leg-back').setAttribute('transform', `rotate(${swing} -4 -18)`); node('leg-front').setAttribute('transform', `rotate(${-swing} 4 -18)`);
      node('arm-back').setAttribute('transform', `rotate(${-swing * .75} -6 -38)`); node('arm-front').setAttribute('transform', `rotate(${swing * .75} 7 -38)`);
      const v = (a, b) => a + (b - a) * state.sit, h = (a, b) => a + (b - a) * state.cling;
      node('leg-back-line').setAttribute('d', `M-4 -18 L${v(-5,-13)} ${v(-7,-16)} L${v(-8,-13)} ${v(-2,-3)}`);
      node('leg-back-foot').setAttribute('d', `M${v(-8,-13)} ${v(-2,-3)} h-4`);
      node('leg-front-line').setAttribute('d', `M4 -18 L${v(5,13)} ${v(-7,-16)} L${v(8,13)} ${v(-2,-3)}`);
      node('leg-front-foot').setAttribute('d', `M${v(8,13)} ${v(-2,-3)} h4`);
      node('arm-back-line').setAttribute('d', `M-6 -38 Q${h(-12,-19)} ${h(-33,-50)} ${h(-13,-22)} ${h(-25,-61)}`);
      node('arm-front-line').setAttribute('d', `M7 -38 Q${h(12,19)} ${h(-33,-50)} ${h(14,22)} ${h(-26,-61)}`);
      node('dress').setAttribute('d', `M${h(-8,-6)} -40 Q${h(0,2)} -43 ${h(8,10)} -40 L13 -19 Q0 -15 -13 -19Z`);
      const bob = moving ? Math.abs(gait) * 1.8 * envelope : 0, lean = moving ? direction * 5 * envelope : 0;
      node('actor-bob').setAttribute('transform', `translate(0 ${state.sit * 38 - bob}) rotate(${lean} 0 -18)`);
      node('head').setAttribute('transform', sideways ? `rotate(${direction * 4} 0 -54)` : `translate(${state.cling * 2} 0)`);
      node('pigtail-left').setAttribute('transform', `rotate(${gait * 4 * envelope} -10 -58)`);
      node('pigtail-right').setAttribute('transform', `rotate(${-gait * 4 * envelope} 10 -58)`);
      node('dress').setAttribute('transform', `rotate(${-gait * 2 * envelope} 0 -39)`);
      app.querySelector('.scene').dataset.state = state.presence;
      sceneFrame = 0;
      if (state.motion && !document.hidden) sceneFrame = requestAnimationFrame(() => paintScene(Date.now()));
    }
    function updateActor(target, now) {
      const svg = app.querySelector('.scene svg'), matrix = svg.getScreenCTM();
      if (matrix && Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) > 1e-8) target = { ...target, outsideX: new DOMPoint(-30, 0).matrixTransform(matrix.inverse()).x };
      distanceMotion.update(target, now, reducedMotion.matches);
      if (sceneFrame) cancelAnimationFrame(sceneFrame);
      sceneFrame = 0; paintScene(now);
    }
    function updateFloor(bounds) {
      el('scene-floor').style.visibility = bounds ? 'visible' : 'hidden';
      if (!bounds) return;
      const near = bounds.near, release = bounds.release;
      el('scene-near-area').setAttribute('d', `M50 102H352V${near}H50Z`);
      el('scene-release-area').setAttribute('d', `M50 ${near}H352V${release}H50Z`);
      el('scene-far-area').setAttribute('d', `M50 ${release}H352V315H50Z`);
      el('scene-boundaries').setAttribute('d', `M50 ${near}H352M50 ${release}H352`);
    }
    reducedMotion.addEventListener('change', () => render());
    function render() {
      const now = Date.now(), alive = isAlive(lastEvent, now), d = derive(states, alive);
      const presentation = tvPresentation.update(states, alive, generation, now, !connectionFailed && !hasConnected);
      if (presentationDeadline !== (presentation.deadline ?? null)) {
        clearTimeout(presentationTimer); presentationDeadline = presentation.deadline ?? null;
        if (presentationDeadline !== null) presentationTimer = setTimeout(render, Math.max(0, presentationDeadline - now));
      }
      const scene = app.querySelector('.scene');
      scene.dataset.tv = presentation.kind;
      app.querySelector('.summary').dataset.tv = presentation.kind;
      const view = diagnosticView(diagnostics, diagnosticsAt, now);
      scene.dataset.monitoring = String(alive && view.radarCurrent);
      updateActor(sceneObservation(diagnostics, diagnosticsAt, now, alive && !document.hidden), now);
      text('connection', alive ? '设备在线' : connectionFailed || hasConnected ? '设备未连接' : '设备正在连接');
      text('headline', presentation.title); text('scene-explanation', d.zoneTitle); text('control-help', d.helper);
      const toggle = el('trial'); toggle.checked = d.intent; toggle.disabled = controlLock.active || !d.canSwitch;
      el('restore').disabled = controlLock.active || !d.canRestore;
      const paused = value(states, IDS.status) === 'ON; paused: snoozed';
      el('pause-10').disabled = el('pause-30').disabled = controlLock.active || !d.canSwitch || !d.intent;
      el('resume').hidden = !paused; el('resume').disabled = controlLock.active || !d.canSwitch || !d.intent;
      const confirmed = d.connected && settingsGeneration === generation && settingsData && settingsData.status === 'ready' ? settingsData.settings : null;
      const diagnosticBounds = view.fresh && diagnostics.health.settings_ready ? sceneFloorBounds(diagnostics.near_threshold_cm, diagnostics.release_threshold_cm) : null;
      const bounds = view.fresh ? diagnosticBounds : confirmed ? sceneFloorBounds(confirmed.distance_cm, confirmed.distance_cm + 20) : null;
      updateFloor(bounds);
      const shownRange = diagnosticBounds ? diagnostics.near_threshold_cm : !view.fresh && confirmed ? confirmed.distance_cm : null;
      text('range', shownRange !== null ? (shownRange / 100).toFixed(1) + ' 米' : '—');
      text('approach-time', confirmed ? `${confirmed.near_ms / 1000} 秒` : '—');
      updateDiagnosticsPolling();
      if (!el('backdrop').hidden) { showDetails(); renderDiagnostics(); }
      renderSettings();
    }
    function disconnect(failed = true) { if (dirty) conflict = true; settingsNotice = ''; settingsResponseGeneration = -1; settingsEvidence.reset(); diagnostics = null; diagnosticsCache = null; diagnosticsAt = 0; if (failed) connectionFailed = true; generation++; if (source) source.close(); source = null; clearTimeout(reconnectTimer); lastEvent = 0; render(); }
    function connect() {
      disconnect(false); for (const id of Object.keys(states)) delete states[id]; for (const id of Object.keys(revisions)) delete revisions[id]; const current = generation; source = new EventSource('/events');
      source.onopen = () => { if (current !== generation) return; lastEvent = Date.now(); connectionFailed = false; hasConnected = true; retry = 1000; render(); readSettings().catch(() => {}); hydrate(current); };
      const update = event => { if (current !== generation) return; lastEvent = Date.now(); try { setState(JSON.parse(event.data)); } catch (_) { render(); } };
      source.addEventListener('state', update); source.addEventListener('state_detail_all', update);
      source.addEventListener('ping', () => { if (current !== generation) return; lastEvent = Date.now(); render(); });
      source.onerror = () => { if (current !== generation) return; disconnect(); reconnectTimer = setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); };
    }
    async function hydrate(epoch) {
      await runExclusive(refreshLock, async () => {
        const primary = [...new Set([...CORE, IDS.scene, IDS.owns])];
        const pending = primary.map(id => get(id, epoch).then(() => true, () => false));
        const settingsPromise = readSettings().catch(() => {});
        for (let i = 0; i < primary.length; i++) {
          const id = primary[i], ok = await pending[i];
          if (epoch !== generation) break;
          if (!ok && CORE.includes(id) && value(states, id) == null) { await delay(200); try { await get(id, epoch); } catch (_) {} }
        }
        await settingsPromise;
        for (const id of Object.values(IDS)) {
          if (epoch !== generation) break;
          if (!primary.includes(id)) { try { await get(id, epoch); } catch (_) {} }
        }
      }, () => { el('refresh').classList.toggle('spinning', refreshLock.active); render(); });
      if (epoch !== generation && source && source.readyState === EventSource.OPEN) hydrate(generation);
    }
    async function refresh() { if (refreshLock.active) return; if (!source || source.readyState === EventSource.CLOSED) connect(); return hydrate(generation); }
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function confirm(check, ids, epoch) {
      for (let i = 0; i < 8 && epoch === generation; i++) { await delay(500); let ok = true; for (const id of ids) { try { await get(id, epoch); } catch (_) { ok = false; } } if (epoch === generation && ok && check()) return true; }
      return false;
    }
    el('refresh').addEventListener('click', () => window.location.reload());
    el('trial').addEventListener('change', async event => {
      const target = event.target.checked;
      event.target.checked = on(value(states, IDS.intent));
      if (controlLock.active || !derive(states, isAlive(lastEvent, Date.now())).canSwitch) return;
      const epoch = generation;
      await runExclusive(controlLock, async () => { try {
        await request(apiPath(IDS.intent) + (target ? '/turn_on' : '/turn_off'), { method: 'POST' });
        if (!await confirm(() => target ? on(value(states, IDS.intent)) : off(value(states, IDS.intent)), [IDS.intent], epoch)) throw new Error('unconfirmed');
      } catch (_) { notify('操作未确认，请刷新后重试'); }
      }, render);
    });
    el('restore').addEventListener('click', async () => {
      if (controlLock.active || !derive(states, isAlive(lastEvent, Date.now())).canRestore) return;
      const epoch = generation;
      await runExclusive(controlLock, async () => { try {
        await request('/button/' + encodeURIComponent('Restore Picture') + '/press', { method: 'POST' });
        if (!await confirm(() => off(value(states, IDS.intent)) && off(value(states, IDS.owns)) && value(states, IDS.tv) === 'Active / picture visible', [IDS.intent, IDS.owns, IDS.tv], epoch)) throw new Error('unconfirmed');
        notify('画面已恢复，自动息屏已关闭');
      } catch (_) { notify('恢复未确认，请检查电视状态'); }
      }, render);
    });
    async function pauseControl(name, resume = false) {
      const state = derive(states, isAlive(lastEvent, Date.now()));
      if (controlLock.active || !state.canSwitch || !state.intent) return;
      const epoch = generation;
      await runExclusive(controlLock, async () => {
        try {
          await request('/button/' + encodeURIComponent(name) + '/press', { method: 'POST' });
          const checked = await confirm(() => resume ? value(states, IDS.status) !== 'ON; paused: snoozed' : value(states, IDS.status) === 'ON; paused: snoozed', [IDS.status, IDS.monitoring, IDS.intent], epoch);
          notify(checked ? (resume ? '暂停已结束，按设备状态恢复监测' : '已暂时暂停，功能开关保持开启') : '操作已提交，状态尚未确认');
        } catch (_) { notify('操作未确认，请查看设备状态'); }
      }, render);
    }
    el('pause-10').addEventListener('click', () => pauseControl('Pause 10 Minutes'));
    el('pause-30').addEventListener('click', () => pauseControl('Pause 30 Minutes'));
    el('resume').addEventListener('click', () => pauseControl('Resume Monitoring', true));
    function editDraft(key, next) {
      if (!draft || settingsLock.active || conflict) return;
      const candidate = { ...draft, [key]: next };
      if (!validateSettings(candidate)) return;
      draft = candidate; dirty = !settingsData || !sameSettings(draft, settingsData.settings); settingsNotice = ''; el('settings-guard').hidden = true; renderSettings();
    }
    el('distance').addEventListener('input', event => editDraft('distance_cm', Number(event.target.value)));
    app.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => editDraft(button.dataset.step, draft[button.dataset.step] + Number(button.dataset.delta))));
    app.querySelectorAll('input[name="sensitivity"]').forEach(input => input.addEventListener('change', () => { if (input.checked) editDraft('sensitivity', input.value); }));
    el('settings-reload').addEventListener('click', async () => {
      try { const data = await readSettings(); draft = { ...data.settings }; draftRevision = data.revision; dirty = false; conflict = false; settingsNotice = ''; render(); }
      catch (_) { /* readSettings displays the failure */ }
    });
    async function submitSettings(defaults) {
      if (!draft || conflict || settingsLock.active || !isAlive(lastEvent, Date.now()) || !settingsData || !((settingsGeneration === generation && settingsData.status === 'ready') || currentErrorResponse())) return;
      await runExclusive(settingsLock, async () => {
        try {
          const current = await readSettings();
          if (conflict || current.revision !== draftRevision) throw new Error('conflict');
          if (current.status === 'applying') throw new Error('busy');
          if (!((settingsGeneration === generation && current.status === 'ready') || currentErrorResponse())) throw new Error('stale response');
          const target = defaults ? { ...DEFAULT_SETTINGS } : { ...draft };
          const expected = current.revision, epoch = generation;
          const body = defaults ? { expected_revision: expected, action: 'defaults' } : { expected_revision: expected, settings: target };
          settingsMutation++; settingsGeneration = -1; render();
          const accepted = await enqueue(() => boundedRequest(fetch, '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, true), 0, () => epoch === generation);
          settingsMutation++;
          syncSettings(accepted, epoch);
          const result = await pollSettings(async () => {
            try { return await readSettings(); } catch (_) { return null; }
          }, expected, target, () => delay(750), 160);
          draft = { ...result.settings }; draftRevision = result.revision; dirty = false; conflict = false;
          settingsNotice = '参数已验证并保存。'; render();
        } catch (error) {
          settingsMutation++;
          if (error.message === 'device-error') settingsNotice = '参数未能确认，监测已暂停；可重试或恢复默认。';
          else if (error.message === 'conflict' || error.status === 409) { conflict = true; settingsNotice = '设备忙或参数已改变。重新加载将丢弃未应用的修改。'; }
          else if (error.message === 'busy') settingsNotice = '设备正在应用参数，请稍后重试。';
          else if (error.status === 400) settingsNotice = '参数不符合范围，请检查后重试。';
          else { settingsGeneration = -1; settingsNotice = '应用结果未确认，请刷新查看；监测可能已暂停。'; }
          render();
        }
      }, render);
    }
    el('settings-apply').addEventListener('click', () => submitSettings(false));
    el('settings-defaults').addEventListener('click', () => submitSettings(true));
    function closeSettings(discard = false) {
      const decision = settingsCloseDecision(dirty, settingsLock.active);
      if (decision === 'wait') { notify('正在验证并保存，请等待结果'); return; }
      if (decision === 'confirm' && !discard) { el('settings-guard').hidden = false; el('settings-keep').focus(); el('settings-guard').scrollIntoView({ block: 'nearest' }); return; }
      if (discard && settingsData) { draft = { ...settingsData.settings }; draftRevision = settingsData.revision; dirty = false; conflict = false; settingsNotice = ''; }
      el('settings-guard').hidden = true; el('settings-backdrop').hidden = true; document.body.classList.remove('sheet-open'); el('main-content').inert = false; if (previousFocus) previousFocus.focus();
    }
    el('settings-keep').addEventListener('click', () => { el('settings-guard').hidden = true; el('settings-close').focus(); });
    el('settings-discard').addEventListener('click', () => closeSettings(true));
    el('settings-open').addEventListener('click', () => { previousFocus = document.activeElement; el('settings-backdrop').hidden = false; el('main-content').inert = true; document.body.classList.add('sheet-open'); renderSettings(); el('settings-close').focus(); readSettings().catch(() => {}); });
    el('settings-close').addEventListener('click', () => closeSettings());
    el('settings-backdrop').addEventListener('click', event => { if (event.target === el('settings-backdrop')) closeSettings(); });
    el('settings-backdrop').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
      else if (event.key === 'Tab') {
        const focusable = [...el('settings-backdrop').querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled), summary')].filter(node => node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    function closeSheet() { calibrationRecording = false; calibrationSamples = []; el('backdrop').hidden = true; document.body.classList.remove('sheet-open'); el('main-content').inert = false; if (previousFocus) previousFocus.focus(); }
    el('details-open').addEventListener('click', () => { previousFocus = document.activeElement; showDetails(); el('backdrop').hidden = false; el('main-content').inert = true; document.body.classList.add('sheet-open'); diagnosticsError = ''; renderDiagnostics(); updateDiagnosticsPolling(); el('details-close').focus(); });
    el('details-close').addEventListener('click', closeSheet);
    el('backdrop').addEventListener('click', e => { if (e.target === el('backdrop')) closeSheet(); });
    el('backdrop').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
      else if (e.key === 'Tab') {
        const nodes = [...el('backdrop').querySelectorAll('button:not(:disabled):not([hidden]), summary')].filter(n => n.offsetParent !== null);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('visibilitychange', () => { updateDiagnosticsPolling(); if (!document.hidden) refresh(); else { settingsEvidence.invalidate(); settingsGeneration = -1; settingsResponseGeneration = -1; settingsNotice = ''; calibrationRecording = false; calibrationSamples = []; diagnostics = null; diagnosticsCache = null; diagnosticsAt = 0; render(); } });
    window.addEventListener('pagehide', () => { settingsEvidence.invalidate(); settingsGeneration = -1; settingsResponseGeneration = -1; settingsNotice = ''; diagnosticsPoller.setActive(false); diagnostics = null; diagnosticsCache = null; diagnosticsAt = 0; if (sceneFrame) cancelAnimationFrame(sceneFrame); sceneFrame = 0; distanceMotion.update({ presence: 'unknown' }, Date.now(), reducedMotion.matches); });
    window.addEventListener('beforeunload', event => { if (dirty || settingsLock.active) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
    setInterval(() => { if (!document.hidden && !el('settings-backdrop').hidden && !settingsLock.active && isAlive(lastEvent, Date.now())) readSettings().catch(() => {}); }, 3000);
    setInterval(() => { if (!document.hidden && isAlive(lastEvent, Date.now()) && settingsGeneration !== generation && !settingsLock.active) readSettings().catch(() => {}); }, 15000);
    setInterval(() => {
      if (document.hidden || !isAlive(lastEvent, Date.now()) || refreshLock.active) return;
      const epoch = generation, missing = CORE.filter(id => value(states, id) == null);
      if (missing.length) runExclusive(recoveryLock, async () => { for (const id of missing) { if (epoch !== generation) break; try { await get(id, epoch); } catch (_) {} } });
    }, 15000);
    setInterval(() => { if (lastEvent && !isAlive(lastEvent, Date.now())) { disconnect(); reconnectTimer = setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); } else render(); }, 1000);
    refresh();
  }
})();
