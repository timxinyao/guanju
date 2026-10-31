'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { waitForAddress, stopProcess } = require('./mobile.browser.cjs');
const { chromium } = require('playwright');
(async () => {
  const server = spawn('python3', ['-u', 'tools/ui_preview.py', 'serve'], { cwd: path.resolve(__dirname, '../..') });
  let browser;
  try {
    const address = await waitForAddress(server);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true });
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
    let zone = 'absent', cm = 50, stale = false, reads = 0, sequence = 0, configRevision = 1, diagNear = 200, diagnosticsBusy = false, settingsReads = 0, settingsRevision = 1, settingsCm = 200, settingsNearMs = 3000, settingsReady = true, session = 'browser-fixture', holdSettings = false, releaseSettings = null;
    await page.route('**/settings', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      settingsReads++; const response = await route.fetch(), body = await response.json(); body.revision = settingsRevision; body.settings.distance_cm = settingsCm; body.settings.near_ms = settingsNearMs;
      if (holdSettings) await new Promise(resolve => { releaseSettings = resolve; });
      await route.fulfill({ response, json: body });
    });
    await page.route('**/diagnostics', async route => {
      reads++; if (diagnosticsBusy) return route.fulfill({status:429,json:{retry_after_ms:1000}}); sequence++; const uptime = 100000 + sequence * 1000;
      const snapshot = { schema_version:1,session_id:session,sequence,uptime_ms:uptime,sample_sequence:sequence,sample_at_ms:uptime-(stale?5000:100),config_revision:configRevision,near_threshold_cm:diagNear,release_threshold_cm:diagNear+20,zone,
        distance:{moving_valid:zone==='near'||zone==='far',moving_cm:cm,still_valid:false,still_cm:0},
        health:{wifi_connected:true,radar_fresh:true,measurement_known:true,tv_fresh:true,settings_ready:settingsReady,parameter_audit:'idle'},
        tv:{power:'active',mode:'normal',owns_picture_off:false},intent_enabled:false,monitoring:false,external_override:false,reason:'',snooze_remaining_ms:0,recent_events:[],events_dropped:0 };
      await route.fulfill({ json: snapshot });
    });
    await page.goto(address); await page.locator('#trial:not(:disabled)').waitFor();
    const scene = page.locator('.scene');
    async function stableProportions() { assert.ok(await page.locator('#head, #actor-bob').evaluateAll(nodes => nodes.every(node => { const m=node.getScreenCTM(); return m.a*m.d-m.b*m.c>0 && Math.abs(Math.hypot(m.a,m.b)-Math.hypot(m.c,m.d))<.001; })), 'head and body must not be stretched or mirrored'); }
    await page.waitForFunction(() => document.querySelector('.scene').dataset.state === 'absent');
    assert.ok(reads>0, 'home must poll');
    assert.equal(await page.locator('#actor-opacity').getAttribute('opacity'),'0','initial absence must not invent a person');
    assert.match(await page.locator('#scene-near-area').getAttribute('d'), /V214\.8/);
    assert.equal(await page.locator('#range').textContent(),'2.0 米','latest verified diagnostic threshold must match the displayed floor');
    assert.match(await page.locator('#scene-release-area').getAttribute('d'), /V222\.64/);
    zone='near'; cm=50; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='present');
    await page.waitForFunction(() => document.querySelector('#actor-position').getAttribute('transform') === 'translate(201 156)');
    assert.equal(await page.locator('#rear-hair').getAttribute('fill'), '#19191d'); await stableProportions();
    assert.equal(await page.locator('#actor-opacity').getAttribute('opacity'), '1');
    const output=process.env.SCENE_OUTPUT; if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'scene-near.png')});}
    zone='far'; cm=300; await page.waitForFunction(() => document.querySelector('#actor-position').getAttribute('transform') === 'translate(201 254)');
    assert.match(await page.locator('#actor-bob').getAttribute('transform'), /translate\(0 38\)/); await stableProportions();
    if(output) await page.screenshot({path:path.join(output,'scene-seated.png')});
    zone='unknown'; await page.waitForFunction(() => document.querySelector('.scene').dataset.state === 'unknown');
    assert.equal(await page.locator('#actor-position').getAttribute('transform'),'translate(201 254)');
    assert.equal(await page.locator('#actor-opacity').getAttribute('opacity'),'.18'.replace(/^\./,'0.'));
    zone='far'; cm=230; stale=true; await page.waitForTimeout(1300);
    assert.equal(await scene.getAttribute('data-state'),'unknown','stale measurements must not revive a person');
    stale=false; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='present');
    await page.emulateMedia({reducedMotion:'no-preference'});
    zone='near'; cm=100;
    const position = () => page.locator('#actor-position').evaluate(node => { const m=node.transform.baseVal.consolidate().matrix; return {x:m.e,y:m.f}; });
    await page.waitForFunction(() => {const m=document.querySelector('#actor-position').transform.baseVal.consolidate().matrix;return Math.abs(m.e-201)<.1&&Math.abs(m.f-175.6)<.1;},null,{timeout:8000});
    await page.request.post(address+'/_fixture/PictureOff');
    await page.waitForFunction(() => document.querySelector('.scene').dataset.tv==='off');
    assert.equal(await page.locator('#actor-opacity').getAttribute('opacity'),'1','picture-off must not hide a fresh target');
    await page.setViewportSize({width:320,height:700}); zone='absent';
    await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='absent');
    await page.waitForTimeout(700); const leaving=await position(); await stableProportions(); assert.ok(leaving.x<201&&Math.abs(leaving.y-175.6)<.5,'absence walks directly left');
    zone='far'; cm=300; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='present');
    const reverseStart=await position(); await page.waitForTimeout(500); const returning=await position(); assert.ok(returning.x>reverseStart.x,'retarget reverses from the current position');
    zone='unknown'; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='unknown');
    const stopped=await position(); await page.waitForTimeout(350); const still=await position();
    assert.ok(Math.abs(still.x-stopped.x)<.1&&Math.abs(still.y-stopped.y)<.1,'unknown stops at the current position');
    zone='near'; cm=100; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='present');
    await page.waitForFunction(() => {const m=document.querySelector('#actor-position').transform.baseVal.consolidate().matrix;return Math.abs(m.e-201)<.1&&Math.abs(m.f-175.6)<.1;},null,{timeout:8000});
    zone='absent'; await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='absent');
    await page.waitForFunction(() => document.querySelector('#actor-opacity').getAttribute('opacity')==='0',null,{timeout:8000});
    const exitBox=await page.locator('#actor-position').boundingBox(); assert.ok(exitBox.x+exitBox.width<=0,'short-screen exit passes the left viewport edge');
    await page.setViewportSize({width:402,height:874}); zone='far'; cm=230;
    await page.waitForFunction(() => document.querySelector('.scene').dataset.state==='present');
    await page.locator('#details-open').click(); await page.locator('#details-close').click(); const closed=reads;
    await page.waitForTimeout(1400); assert.ok(reads>closed,'details close must not stop home polling');
    // Another client changes configuration; once diagnostics expire, old /settings is no longer trusted.
    configRevision=2; diagNear=270; zone='far'; cm=280;
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(() => document.querySelector('#range').textContent==='2.7 米');
    await page.waitForFunction(() => Math.abs(document.querySelector('#actor-position').transform.baseVal.consolidate().matrix.f-246.16)<.01);
    assert.match(await page.locator('#scene-near-area').getAttribute('d'),/V242\.24/);
    const releasePath=await page.locator('#scene-release-area').getAttribute('d');
    assert.ok(Math.abs(Number(releasePath.match(/V([\d.]+)/)[1])-250.08)<.001,'release boundary uses 290cm projection');
    assert.equal(await page.locator('#approach-time').textContent(),'—','old revision timing is untrusted');
    cm=260; await page.waitForFunction(() => Math.abs(document.querySelector('#actor-position').transform.baseVal.consolidate().matrix.f-238.32)<.01);
    assert.match(await page.locator('#actor-bob').getAttribute('transform'),/translate\(0 38\)/,'sitting hysteresis retains pose in red');
    cm=300; await page.waitForFunction(() => Math.abs(document.querySelector('#actor-position').transform.baseVal.consolidate().matrix.f-254)<.01);
    await page.waitForFunction(() => document.querySelector('#actor-bob').getAttribute('transform').includes('translate(0 38)'));
    await page.waitForTimeout(100); // Allow the SVG presentation attributes to reach the rendered frame.
    const seat=await page.evaluate(()=>{const actor=document.querySelector('#actor-bob'), rect=document.querySelector('rect[x="137"][y="274"]'), p=new DOMPoint(0,-18).matrixTransform(actor.getScreenCTM()), q=new DOMPoint(0,274).matrixTransform(rect.getScreenCTM());return {hip:p.y,top:q.y,bounds:rect.getBoundingClientRect().top,actor:actor.getAttribute('transform'),root:document.querySelector('#actor-position').getAttribute('transform')};});
    assert.ok(Math.abs(seat.hip-seat.top)<1,`300cm endpoint contacts the sofa: ${JSON.stringify(seat)}`);
    zone='near'; for(const [distance,y] of [[50,156],[60,159.92],[70,163.84]]) {cm=distance;await page.waitForFunction(value=>Math.abs(document.querySelector('#actor-position').transform.baseVal.consolidate().matrix.f-value)<.01,y);}
    const retryStart=settingsReads; diagnosticsBusy=true; await page.waitForTimeout(5000);
    assert.equal(await page.locator('#range').textContent(),'—','expired diagnostics must not revive superseded range');
    assert.equal(await page.locator('#approach-time').textContent(),'—','superseded timing must not appear confirmed');
    assert.equal(await page.locator('#scene-floor').evaluate(node=>node.style.visibility),'hidden','superseded floor must be hidden');
    assert.ok(settingsReads-retryStart<=1,'rendering stale state cannot queue unbounded settings reads');
    // A verified new settings revision can restore the fallback; readiness loss invalidates it again.
    settingsRevision=2; settingsCm=270; settingsNearMs=4000; diagnosticsBusy=false;
    await page.locator('#settings-open').click();
    await page.waitForFunction(() => document.querySelector('#approach-time').textContent==='4 秒');
    await page.locator('#settings-close').click();
    settingsReady=false; await page.waitForFunction(() => document.querySelector('#scene-floor').style.visibility==='hidden');
    assert.equal(await page.locator('#range').textContent(),'—'); assert.equal(await page.locator('#approach-time').textContent(),'—');
    settingsReady=true; await page.waitForFunction(() => document.querySelector('#approach-time').textContent==='4 秒');
    // A changed configuration must preserve a dirty draft and require the existing conflict path.
    await page.locator('#settings-open').click(); await page.locator('#distance:not(:disabled)').waitFor();
    await page.locator('#distance').focus(); await page.keyboard.press('ArrowLeft');
    const draftValue=await page.locator('#distance').inputValue(); assert.equal(draftValue,'260');
    configRevision=3; diagNear=280;
    await page.waitForFunction(() => document.querySelector('#settings-message').textContent.includes('参数已改变'));
    assert.equal(await page.locator('#distance').inputValue(),draftValue,'external revision does not discard the draft');
    assert.equal(await page.locator('#settings-apply').isDisabled(),true,'conflicting draft cannot be applied');
    await page.locator('#settings-close').click(); assert.equal(await page.locator('#settings-guard').isVisible(),true);
    await page.locator('#settings-discard').click(); settingsRevision=3; settingsCm=280;
    await page.locator('#settings-open').click(); await page.locator('#distance:not(:disabled)').waitFor();
    assert.equal(await page.locator('#distance').inputValue(),'280'); await page.locator('#settings-close').click();
    // Same revision from a new boot invalidates old cache, while preserving a dirty draft.
    await page.locator('#settings-open').click(); await page.locator('#distance:not(:disabled)').waitFor();
    await page.locator('#distance').focus(); await page.keyboard.press('ArrowLeft');
    const rebootDraft=await page.locator('#distance').inputValue(); assert.equal(rebootDraft,'270');
    holdSettings=true; session='browser-new-boot'; const beforeHeld=settingsReads;
    for(let i=0;i<30 && (settingsReads===beforeHeld || !releaseSettings);i++) await page.waitForTimeout(200);
    assert.ok(releaseSettings,'new device session must trigger a settings reread');
    assert.equal(await page.locator('#approach-time').textContent(),'—');
    assert.equal(await page.locator('#distance').inputValue(),rebootDraft);
    assert.match(await page.locator('#settings-message').textContent(),/参数已改变/);
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
    holdSettings=false; releaseSettings(); await page.waitForTimeout(500);
    assert.equal(await page.locator('#range').textContent(),'—','late settings response after backgrounding is ignored');
    assert.equal(await page.locator('#approach-time').textContent(),'—');
    assert.equal(await page.locator('#distance').inputValue(),rebootDraft,'late response cannot discard the dirty draft');
    const hiddenReads=reads, hiddenPosition=await page.locator('#actor-position').getAttribute('transform');
    await page.waitForTimeout(1500); assert.equal(reads,hiddenReads); assert.equal(await page.locator('#actor-position').getAttribute('transform'),hiddenPosition);
    assert.equal(await scene.getAttribute('data-state'),'unknown');
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('#approach-time').textContent==='4 秒');
    await page.locator('#settings-close').click(); await page.locator('#settings-discard').click();
    holdSettings=true; releaseSettings=null; session='browser-next-boot'; const beforeDisconnectRead=settingsReads;
    for(let i=0;i<30 && (settingsReads===beforeDisconnectRead || !releaseSettings);i++) await page.waitForTimeout(200);
    assert.ok(releaseSettings,'session change must invalidate same-revision settings');
    await page.request.post(address+'/_fixture/Offline');
    await page.waitForFunction(() => document.querySelector('#connection').textContent==='设备未连接',null,{timeout:8000});
    holdSettings=false; releaseSettings(); await page.waitForTimeout(500);
    assert.equal(await page.locator('#range').textContent(),'—','old generation response cannot restore range');
    assert.equal(await page.locator('#approach-time').textContent(),'—','old generation response cannot restore timing');
    assert.deepEqual(errors,[]); await context.close();
    console.log('生产页面共享诊断、动态色带、姿态、未知、详情关闭和后台停止通过');
  } finally { if(browser) await browser.close(); await stopProcess(server); }
})().catch(error => { console.error(error); process.exitCode=1; });
