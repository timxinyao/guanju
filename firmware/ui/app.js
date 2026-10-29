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
    const controller = new AbortController();
    let timeout;
    const expired = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('request timeout')); }, timeoutMs); });
    const operation = (async () => {
      const response = await fetcher(url, { ...options, cache: 'no-store', signal: controller.signal });
      if (!response.ok) { if (response.body) Promise.resolve(response.body.cancel()).catch(() => {}); const error = new Error('HTTP ' + response.status); error.status = response.status; throw error; }
      if (json) return response.json();
      if (response.body) Promise.resolve(response.body.cancel()).catch(() => {});
    })();
    try { return await Promise.race([operation, expired]); }
    finally { clearTimeout(timeout); }
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
  function deriveScene(states, alive) {
    if (!alive || !on(value(states, IDS.radar))) return 'unknown';
    const scene = value(states, IDS.scene);
    return scene === 'Near' ? 'near' : scene === 'Far' ? 'far' : scene === 'Absent' ? 'absent' : 'unknown';
  }
  function deriveScanning(states, alive) {
    return alive && on(value(states, IDS.radar));
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
  function createSceneMotion() {
    let target = null, token = 0, running = false;
    const visible = state => state === 'near' || state === 'far';
    return {
      update(next) {
        if (next === target) return { target, animate: false, token, running };
        const animate = visible(target) && visible(next);
        target = next; running = animate; token++;
        return { target, animate, token, running };
      },
      finish(completed) { if (completed !== token || !running) return false; running = false; return true; },
      stop() { token++; running = false; }
    };
  }
  function sceneTrajectory(x, y, target) {
    const destination = target === 'far' ? 52 : 0;
    return [{ x, y }, { x: x / 2 + 13, y: (y + destination) / 2 }, { x: 0, y: destination }];
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
  const translations = {
    'Trial OFF': '自动息屏已关闭',
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
      else if (monitoring) helper = '正在监测近距离目标';
      else if (tv === 'Standby (will not wake)') helper = '电视待机时暂停，开机后继续';
      else helper = '已开启，等待设备状态恢复';
    }
    const intentKnown = on(intent) || off(intent);
    return { connected, complete, active, intent: on(intent), monitoring, headline, zoneTitle, zoneHelp, helper,
      canSwitch: alive && intentKnown, canRestore: alive && intentKnown && active };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IDS, derive, deriveScene, deriveScanning, createTvPresentation, createSceneMotion, sceneTrajectory, isAlive, acceptState, detailValue, supportsNativeSwitch, applyVersionedState, boundedRequest, readEntity, runExclusive, createRequestQueue, validateSettings, sameSettings, pollSettings };
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
      <section class="summary" aria-live="polite" data-tv="connecting"><h2><span class="dot" aria-hidden="true"></span><span id="headline">正在连接</span></h2><span class="sr-only" id="connection">设备正在连接</span></section>
      <section class="scene" data-state="unknown" data-monitoring="false" data-tv="connecting" aria-label="雷达探测和电视沙发示意图">
        <svg viewBox="0 0 360 224" role="img" aria-hidden="true"><defs><linearGradient id="screen" x2="0" y2="1"><stop stop-color="#f7faf8"/><stop offset="1" stop-color="#e2ece5"/></linearGradient><clipPath id="scan-clip"><rect x="10" y="111" width="340" height="113"/></clipPath></defs>
          <ellipse cx="180" cy="210" rx="100" ry="13" fill="#f2f7f3"/>
          <g clip-path="url(#scan-clip)" fill="none" stroke="#42654e" stroke-width="2.2"><g transform="translate(180 108)"><g class="scan-wave wave-one"><path d="M-14 6 Q0 25 14 6"/></g><g class="scan-wave wave-two"><path d="M-14 6 Q0 25 14 6"/></g><g class="scan-wave wave-three"><path d="M-14 6 Q0 25 14 6"/></g></g></g>
          <rect x="104" y="8" width="152" height="77" rx="1" fill="url(#screen)" stroke="#536d61" stroke-width="1.4"/><g class="screen-landscape"><path d="M106 53q27-20 51-9t51-3q23-13 46-7v49H106Z" fill="#dfeae3" opacity=".65"/><path d="M106 59q26-10 51 3t50-5q27-13 47-10v36H106Z" fill="#d5e4d9" opacity=".6"/></g><rect class="screen-overlay" x="106" y="10" width="148" height="73"/><path d="M177 85v5m6-5v5m-23 3 20-3 20 3" fill="none" stroke="#536d61" stroke-width="2" stroke-linecap="round"/>
          <rect x="94" y="93" width="172" height="18" rx="1" fill="#f8fbf9" stroke="#6d8379"/><path d="M137 94v16m86-16v16m-125 1-2 5m165-5 2 5" stroke="#6d8379" fill="none"/>
          <g stroke="#536d61" stroke-width="1.1" fill="#f9fcfa"><rect x="118" y="177" width="124" height="32" rx="8"/><path d="M118 189v-3q0-10 10-10h43q9 0 9 9 0-9 9-9h43q10 0 10 10v3"/></g>
          <g stroke="#536d61" stroke-width="1.1" fill="#f9fcfa"><rect x="106" y="185" width="12" height="33" rx="6"/><rect x="242" y="185" width="12" height="33" rx="6"/><rect x="116" y="188" width="128" height="31" rx="4"/><path d="M120 219l-1 7h4l2-7m110 0 2 7h4l-1-7"/></g>
          <g class="scene-actor" aria-hidden="true"><g class="actor-body" stroke="#536d61" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
            <g class="actor-leg leg-left"><path d="M176 145l-1 7m-2 1h5" fill="none" stroke-width="2"/></g><g class="actor-leg leg-right"><path d="M184 145l1 7m-1 1h5" fill="none" stroke-width="2"/></g>
            <path class="seated-legs" d="M174 143q-5 2-4 6l5 2m11-8q5 2 4 6l-5 2m-12 0h4m6 0h4" fill="none" stroke-width="2"/>
            <g class="actor-arm arm-left"><path d="M175 131l-5 7" fill="none" stroke-width="2.2"/></g><g class="actor-arm arm-right"><path d="M185 131l5 7" fill="none" stroke-width="2.2"/></g>
            <path d="M175 128q5-2 10 0l5 17h-20Z" fill="#f3e4d3"/><path d="M174 144h12" fill="none" stroke="#a7bfa8"/>
            <circle cx="180" cy="118" r="9" fill="#f8e8d8"/><path d="M171 118q-1-10 9-10t9 10q-3-1-5-5-4 5-13 5Z" fill="#748d78"/><path d="M171 114q-5-2-5 3 1 3 5 2m18-5q5-2 5 3-1 3-5 2" fill="#748d78"/><circle cx="177" cy="120" r=".7" fill="#536d61" stroke="none"/><circle cx="183" cy="120" r=".7" fill="#536d61" stroke="none"/><path d="M178 123q2 1 4 0" fill="none"/>
          </g></g>
        </svg>
      </section>
      <section class="control-panel"><span class="tv-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M9 20h6m-3-3v3"/></svg></span><div class="control-copy"><h3>自动息屏</h3><p id="control-help">等待设备状态</p></div><label class="switch-area"><input id="trial" type="checkbox" switch aria-label="自动息屏" disabled></label></section>
      <section class="rules" aria-label="自动息屏规则"><div><strong id="range">—</strong><span>近距范围</span></div><div><strong id="recovery-time">—</strong><span>基础恢复等待</span></div></section>
      <section class="restore"><button id="restore" disabled>恢复画面</button><p>恢复画面并关闭自动息屏</p></section>
      <p class="footer">局域网连接 · 无需电脑常开</p>
    </main>
    <div class="sheet-backdrop" id="backdrop" hidden><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="sheet-handle"></div><div class="sheet-heading"><h2 id="sheet-title">设备详情</h2><button id="details-close" aria-label="关闭设备详情">完成</button></div><dl id="details-list"></dl></section></div>
    <div class="sheet-backdrop" id="settings-backdrop" hidden><section class="sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <div class="sheet-handle"></div><div class="sheet-heading"><h2 id="settings-title">参数设置</h2><button id="settings-close">完成</button></div>
      <p class="settings-intro">根据家里的观看位置，调到刚刚好。</p>
      <p class="settings-message" id="settings-message" role="status" aria-live="polite">正在读取设备参数…</p>
      <button class="settings-reload" id="settings-reload" hidden>重新加载设备参数</button>
      <fieldset id="settings-fields" disabled>
        <div class="settings-card"><div class="range-heading"><strong>近距范围</strong><output id="distance-value">—</output></div><div class="range-input"><span>0.5 米</span><input type="range" id="distance" min="50" max="300" step="10" aria-label="近距范围"><span>3.0 米</span></div><p>雷达观察范围约 6 米；近于此距离才开始确认。</p></div>
        <div class="settings-card timings"><div class="timing-list">
          <div class="timing-row"><span>靠近确认</span><output id="near-value">—</output><div class="stepper"><button type="button" data-step="near_ms" data-delta="-1000" aria-label="减少靠近确认时间">−</button><button type="button" data-step="near_ms" data-delta="1000" aria-label="增加靠近确认时间">＋</button></div></div>
          <div class="timing-row"><span>无人延时</span><output id="radar-timeout-value">—</output><div class="stepper"><button type="button" data-step="radar_timeout_s" data-delta="-1" aria-label="减少无人延时">−</button><button type="button" data-step="radar_timeout_s" data-delta="1" aria-label="增加无人延时">＋</button></div></div>
          <div class="timing-row"><span>恢复确认</span><output id="clear-value">—</output><div class="stepper"><button type="button" data-step="clear_ms" data-delta="-1000" aria-label="减少恢复确认时间">−</button><button type="button" data-step="clear_ms" data-delta="1000" aria-label="增加恢复确认时间">＋</button></div></div>
        </div><p id="base-delay">基础恢复等待时间尚未确认。</p></div>
        <div class="settings-card"><strong class="settings-label">灵敏度</strong><div class="sensitivity" role="radiogroup" aria-label="灵敏度"><label><input type="radio" name="sensitivity" value="low"><span>低</span></label><label><input type="radio" name="sensitivity" value="standard"><span>标准</span></label><label><input type="radio" name="sensitivity" value="high"><span>高</span></label></div><p>越高越容易检测到细微活动，也可能增加误触发。</p></div>
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
    let settingsData = null, settingsGeneration = -1, settingsRead = null, settingsMutation = 0, draft = null, draftRevision = null, dirty = false, conflict = false, settingsNotice = '';
    let previousFocus = null;
    const tvPresentation = createTvPresentation(), sceneMotion = createSceneMotion();
    let actorAnimation = null, presentationTimer = 0, presentationDeadline = null, connectionFailed = false, hasConnected = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const text = (id, content) => { const node = el(id); if (node.textContent !== content) { node.textContent = content; if (node.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); } };
    const apiPath = id => { const [domain, name] = id.split('/'); return '/' + domain + '/' + encodeURIComponent(name); };
    const request = (url, options = {}) => enqueue(() => boundedRequest(fetch, url, options), 0);
    function setState(data, expected = generation) { if (applyVersionedState(states, revisions, data, expected, generation)) render(); }
    async function get(id, expected = generation) { const data = await enqueue(() => readEntity(fetch, apiPath(id), id, states, revisions, () => generation, expected), CORE.includes(id) || id === IDS.scene ? 1 : 3, () => expected === generation); render(); return data; }
    function notify(message) { const box = el('toast'); box.textContent = message; box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 3500); }
    function validEnvelope(data) {
      return !!data && Number.isInteger(data.revision) && data.revision >= 0 && data.revision <= 0xffffffff &&
        ['ready', 'applying', 'error'].includes(data.status) && validateSettings(data.settings);
    }
    function syncSettings(data, epoch) {
      if (epoch !== generation || !validEnvelope(data)) throw new Error('invalid settings');
      settingsData = data; settingsGeneration = epoch;
      if (dirty && draftRevision !== data.revision) conflict = true;
      if (!dirty && data.status !== 'applying') { draft = { ...data.settings }; draftRevision = data.revision; conflict = false; }
      render();
      return data;
    }
    function readSettings() {
      if (settingsRead && settingsRead.epoch === generation && settingsRead.mutation === settingsMutation) return settingsRead.promise;
      const epoch = generation, mutation = settingsMutation;
      const reading = (async () => {
        try {
          const data = await enqueue(() => boundedRequest(fetch, '/settings', {}, true), 2, () => epoch === generation && mutation === settingsMutation);
          if (epoch !== generation || mutation !== settingsMutation) throw new Error('stale response');
          settingsNotice = '';
          return syncSettings(data, epoch);
        } catch (error) {
          if (epoch === generation && mutation === settingsMutation) {
            settingsGeneration = -1;
            settingsNotice = error.status === 404 ? '当前固件不支持参数设置，请更新固件。' : '无法读取设备参数，请刷新后重试。';
            render();
          }
          throw error;
        }
      })();
      const entry = { epoch, mutation, promise: reading };
      settingsRead = entry;
      reading.finally(() => { if (settingsRead === entry) settingsRead = null; }).catch(() => {});
      return reading;
    }
    function renderSettings() {
      const alive = isAlive(lastEvent, Date.now()), current = settingsGeneration === generation && settingsData;
      let message = settingsNotice;
      if (!message && conflict) message = '设备参数已改变。重新加载将丢弃未应用的修改。';
      else if (!message && current && current.status === 'applying') message = '正在应用并验证参数，监测暂时暂停。';
      else if (!message && current && current.status === 'error') message = '参数未能确认，监测已暂停；可重试或恢复默认。';
      else if (!message && dirty) message = '有未应用的修改。';
      else if (!message && !current) message = '正在读取设备参数…';
      else if (!message) message = '参数已由设备确认。';
      text('settings-message', message);
      el('settings-reload').hidden = !conflict;
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
    reducedMotion.addEventListener('change', event => {
      if (!event.matches) return;
      sceneMotion.stop();
      if (actorAnimation) { actorAnimation.cancel(); actorAnimation = null; }
      app.querySelector('.scene').classList.remove('running');
    });
    function updateActor(target) {
      const scene = app.querySelector('.scene'), actor = scene.querySelector('.scene-actor');
      const move = sceneMotion.update(target);
      if (scene.dataset.state === target) return;
      // Capture the interpolated position before cancelling an obsolete trip.
      const current = getComputedStyle(actor).transform;
      if (actorAnimation) { actorAnimation.cancel(); actorAnimation = null; }
      scene.classList.remove('running');
      scene.dataset.state = target;
      if (!move.animate || reducedMotion.matches || !actor.animate) { sceneMotion.stop(); return; }
      const matrix = current === 'none' ? { e: 0, f: 0 } : new DOMMatrixReadOnly(current);
      const points = sceneTrajectory(matrix.e, matrix.f, target);
      actorAnimation = actor.animate(points.map(point => ({ transform: `translate(${point.x}px, ${point.y}px)` })),
        { duration: 800, easing: 'ease-in-out' });
      scene.classList.add('running');
      actorAnimation.onfinish = () => {
        if (!sceneMotion.finish(move.token)) return;
        actorAnimation = null; scene.classList.remove('running');
      };
    }
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
      scene.dataset.monitoring = String(deriveScanning(states, alive));
      updateActor(deriveScene(states, alive));
      text('connection', alive ? '设备在线' : connectionFailed || hasConnected ? '设备未连接' : '设备正在连接');
      text('headline', presentation.title); text('control-help', d.helper);
      const toggle = el('trial'); toggle.checked = d.intent; toggle.disabled = controlLock.active || !d.canSwitch;
      el('restore').disabled = controlLock.active || !d.canRestore;
      const confirmed = d.connected && settingsGeneration === generation && settingsData && settingsData.status === 'ready' ? settingsData.settings : null;
      text('range', confirmed ? (confirmed.distance_cm / 100).toFixed(1) + ' 米' : '—');
      text('recovery-time', confirmed ? `约 ${confirmed.radar_timeout_s + confirmed.clear_ms / 1000} 秒` : '—');
      if (!el('backdrop').hidden) showDetails();
      renderSettings();
    }
    function disconnect(failed = true) { if (failed) connectionFailed = true; generation++; if (source) source.close(); source = null; clearTimeout(reconnectTimer); lastEvent = 0; render(); }
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
    function editDraft(key, next) {
      if (!draft || settingsLock.active || conflict) return;
      const candidate = { ...draft, [key]: next };
      if (!validateSettings(candidate)) return;
      draft = candidate; dirty = true; settingsNotice = ''; renderSettings();
    }
    el('distance').addEventListener('input', event => editDraft('distance_cm', Number(event.target.value)));
    app.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => editDraft(button.dataset.step, draft[button.dataset.step] + Number(button.dataset.delta))));
    app.querySelectorAll('input[name="sensitivity"]').forEach(input => input.addEventListener('change', () => { if (input.checked) editDraft('sensitivity', input.value); }));
    el('settings-reload').addEventListener('click', async () => {
      try { const data = await readSettings(); draft = { ...data.settings }; draftRevision = data.revision; dirty = false; conflict = false; settingsNotice = ''; render(); }
      catch (_) { /* readSettings displays the failure */ }
    });
    async function submitSettings(defaults) {
      if (!draft || conflict || settingsLock.active || !isAlive(lastEvent, Date.now())) return;
      await runExclusive(settingsLock, async () => {
        try {
          const current = await readSettings();
          if (conflict || current.revision !== draftRevision) throw new Error('conflict');
          if (current.status === 'applying') throw new Error('busy');
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
    function closeSettings() { el('settings-backdrop').hidden = true; document.body.classList.remove('sheet-open'); if (previousFocus) previousFocus.focus(); }
    el('settings-open').addEventListener('click', () => { previousFocus = document.activeElement; el('settings-backdrop').hidden = false; document.body.classList.add('sheet-open'); renderSettings(); el('settings-close').focus(); readSettings().catch(() => {}); });
    el('settings-close').addEventListener('click', closeSettings);
    el('settings-backdrop').addEventListener('click', event => { if (event.target === el('settings-backdrop')) closeSettings(); });
    el('settings-backdrop').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
      else if (event.key === 'Tab') {
        const focusable = [...el('settings-backdrop').querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled)')].filter(node => node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    function closeSheet() { el('backdrop').hidden = true; document.body.classList.remove('sheet-open'); if (previousFocus) previousFocus.focus(); }
    el('details-open').addEventListener('click', () => { previousFocus = document.activeElement; showDetails(); el('backdrop').hidden = false; document.body.classList.add('sheet-open'); el('details-close').focus(); });
    el('details-close').addEventListener('click', closeSheet);
    el('backdrop').addEventListener('click', e => { if (e.target === el('backdrop')) closeSheet(); });
    el('backdrop').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } else if (e.key === 'Tab') { e.preventDefault(); el('details-close').focus(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
    setInterval(() => { if (!el('settings-backdrop').hidden && !settingsLock.active && isAlive(lastEvent, Date.now())) readSettings().catch(() => {}); }, 3000);
    setInterval(() => { if (isAlive(lastEvent, Date.now()) && settingsGeneration !== generation && !settingsLock.active) readSettings().catch(() => {}); }, 15000);
    setInterval(() => {
      if (!isAlive(lastEvent, Date.now()) || refreshLock.active) return;
      const epoch = generation, missing = CORE.filter(id => value(states, id) == null);
      if (missing.length) runExclusive(recoveryLock, async () => { for (const id of missing) { if (epoch !== generation) break; try { await get(id, epoch); } catch (_) {} } });
    }, 15000);
    setInterval(() => { if (lastEvent && !isAlive(lastEvent, Date.now())) { disconnect(); reconnectTimer = setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); } else render(); }, 1000);
    refresh();
  }
})();
