'use strict';
// Real Chromium + local Python fixture. Run separately from dependency-free host checks.
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
function waitForAddress(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const finish = (error, address) => { clearTimeout(timer); child.stdout.off('data', data); child.off('exit', exited); child.off('error', failed); error ? reject(error) : resolve(address); };
    const data = chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) finish(null, match[0]); };
    const exited = code => finish(new Error('fixture exit ' + code));
    const failed = error => finish(error);
    const timer = setTimeout(() => finish(new Error('fixture startup timed out')), timeoutMs);
    child.stdout.on('data', data); child.once('exit', exited); child.once('error', failed);
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode);
  });
}
async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}
module.exports = { waitForAddress, stopProcess };
async function main() {
  const { chromium } = require('playwright');
  const server = spawn('python3', ['-u', 'tools/ui_preview.py', 'serve'], { cwd: path.resolve(__dirname, '../..') });
  let browser;
  try {
    const address = await waitForAddress(server);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const output = process.env.MOBILE_OUTPUT || 'output/mobile-qa'; fs.mkdirSync(output, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, ...(process.env.MOBILE_VIDEO ? { recordVideo: { dir: output, size: { width: 402, height: 874 } } } : {}) });
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
    let diagnosticsRequests = 0; page.on('request', r => { if (r.url().endsWith('/diagnostics')) diagnosticsRequests++; });
    await page.goto(address); await page.locator('#trial:not(:disabled)').waitFor();
    await page.locator('#scene-explanation').waitFor({ timeout: 3000 });
    assert.match(await page.locator('#scene-explanation').textContent(), /没有近距离目标/);
    await page.waitForTimeout(1200); assert.ok(diagnosticsRequests > 0, 'home polls diagnostics for the scene');
    assert.match(await page.locator('#restore').textContent(), /恢复画面并停用/);
    await page.screenshot({ path: path.join(output, 'home.png') });
    await page.locator('#settings-open').click(); assert.equal(await page.locator('#settings-close').textContent(), '关闭');
    assert.equal(await page.locator('#advanced-settings').getAttribute('open'), null);
    assert.ok(await page.locator('.timings .stepper button').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().width >= 44 && n.getBoundingClientRect().height >= 44)), 'stepper touch targets must be at least 44 × 44');
    await page.locator('[data-step="near_ms"][data-delta="1000"]').click();
    await page.locator('#settings-close').click();
    assert.equal(await page.locator('#settings-backdrop').isVisible(), true, 'dirty close stays open until explicit choice');
    await page.locator('#settings-keep').click();
    assert.equal(await page.locator('#near-value').textContent(), '4 秒');
    await page.locator('#settings-close').click(); await page.locator('#settings-discard').click();
    assert.equal(await page.locator('#settings-backdrop').isVisible(), false);
    await page.locator('#settings-open').click(); assert.equal(await page.locator('#near-value').textContent(), '3 秒');
    await page.screenshot({ path: path.join(output, 'settings.png') }); await page.locator('#settings-close').click();
    await page.locator('#details-open').click(); await page.waitForTimeout(1200);
    assert.ok(diagnosticsRequests > 0); await page.locator('#diagnostic-distance').waitFor();
    assert.equal(await page.locator('#diagnostic-distance').textContent(), '—', 'absent never uses residual distances');
    await page.request.post(address + '/_fixture/Far'); await page.waitForTimeout(1400);
    assert.equal(await page.locator('#diagnostic-distance').textContent(), '约 2.5 米');
    await page.screenshot({ path: path.join(output, 'debug.png') });
    await page.locator('#details-close').click(); const closedReads = diagnosticsRequests;
    await page.waitForTimeout(1200); assert.ok(diagnosticsRequests > closedReads, 'home keeps polling after details close');
    for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `home-${size.width}.png`) });
    }
    assert.deepEqual(errors, []);
    const video = page.video(); await context.close(); if (video) console.log('Recording:', await video.path());
    console.log('Real browser mobile layouts, settings guard and diagnostic lifecycle passed.');
  } finally { if (browser) await browser.close(); await stopProcess(server); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
