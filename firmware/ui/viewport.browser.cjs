'use strict';
// Independent local fixture and real Chromium; no hardware or private configuration.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { waitForAddress, stopProcess } = require('./mobile.browser.cjs');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const server = spawn('python3', ['-u', 'tools/ui_preview.py', 'serve'], { cwd: root });
  let browser;
  try {
    const address = await waitForAddress(server);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const output = process.env.VIEWPORT_OUTPUT;
    if (output) fs.mkdirSync(output, { recursive: true });
    for (const { size, topInset, bottomInset } of [
      { size: { width: 320, height: 700 }, topInset: 59, bottomInset: 34 },
      { size: { width: 402, height: 874 }, topInset: 59, bottomInset: 34 },
      { size: { width: 1280, height: 900 }, topInset: 59, bottomInset: 34 },
      { size: { width: 320, height: 700 }, topInset: 0, bottomInset: 0 },
      { size: { width: 402, height: 874 }, topInset: 0, bottomInset: 0 },
    ]) {
      const context = await browser.newContext({ viewport: size, hasTouch: true, ...(output && size.width === 402 && topInset ? { recordVideo: { dir: output, size } } : {}) });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      // Chromium does not expose iOS safe-area env values. Substitute nonzero insets in the served CSS.
      await page.route('**/0.css', async route => {
        const response = await route.fetch();
        const css = (await response.text()).replaceAll('env(safe-area-inset-top,0px)', `${topInset}px`).replaceAll('env(safe-area-inset-bottom,0px)', `${bottomInset}px`);
        await route.fulfill({ response, body: css });
      });
      await page.goto(address); await page.locator('#trial:not(:disabled)').waitFor();
      const measure = () => page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
        return { scrollY, scrollHeight: document.documentElement.scrollHeight, height: innerHeight, header: rect('.topbar'), restore: rect('#restore'), footer: rect('.footer') };
      });
      const before = await measure();
      if (output) await page.screenshot({ path: path.join(output, `home-${size.width}-inset-${topInset}.png`) });
      await page.mouse.move(size.width / 2, size.height / 2); await page.mouse.wheel(0, 800); await page.waitForTimeout(150);
      const after = await measure();
      console.log(JSON.stringify({ size, topInset, bottomInset, before, after }));
      assert.ok(before.scrollHeight <= size.height, 'home content must fit the viewport');
      assert.equal(after.scrollY, 0, 'home must not scroll');
      assert.equal(after.header.top, before.header.top, 'home must remain at its initial position');
      assert.ok(before.header.top >= topInset, 'header must clear top safe area');
      assert.ok(before.restore.bottom <= size.height - bottomInset, 'restore must clear bottom safe area');
      assert.ok(before.footer.bottom <= size.height - bottomInset, 'footer must clear bottom safe area');
      assert.ok(before.restore.height >= 44, 'restore must keep a 44px target');
      assert.ok(await page.locator('.header-action, .pause-controls button:not([hidden]), .switch-area').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })), 'home touch targets must remain at least 44px');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: size.width / 2, y: size.height * .75 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: size.width / 2, y: size.height * .25 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150); assert.equal((await measure()).scrollY, 0, 'touch must not move home');
      await page.locator('#settings-open').click();
      const slider = page.locator('#distance');
      await slider.waitFor({ state: 'visible' });
      const sliderValue = await slider.inputValue();
      await slider.focus(); await page.keyboard.press('ArrowRight');
      assert.notEqual(await slider.inputValue(), sliderValue, 'settings slider responds to input');
      await page.locator('#advanced-settings > summary').click();
      const sheet = page.locator('.settings-sheet');
      await sheet.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await sheet.evaluate(el => el.scrollTop > 0), 'settings retains internal scrolling');
      await page.locator('#settings-close').click();
      await page.locator('#settings-discard').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-open');
      assert.equal((await measure()).header.top, before.header.top, 'closing settings must not move home');
      await page.locator('#details-open').click();
      await page.locator('#calibration > summary').click();
      const details = page.locator('.debug-sheet');
      await details.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await details.evaluate(el => el.scrollTop > 0), 'details retains internal scrolling');
      await page.locator('#details-close').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'details-open');
      if (!(await page.locator('#trial').isChecked())) await page.locator('#trial').click();
      await page.locator('#pause-10:not(:disabled)').waitFor();
      await page.locator('#pause-10').click(); await page.locator('#resume:visible').waitFor();
      const paused = await measure();
      assert.ok(paused.footer.bottom <= size.height - bottomInset, 'paused controls must fit above bottom safe area');
      assert.ok(paused.restore.bottom <= size.height - bottomInset, 'restore remains reachable while paused');
      await page.locator('#resume').click(); await page.locator('#resume').waitFor({ state: 'hidden' });
      await page.reload(); await page.locator('#trial:not(:disabled)').waitFor();
      assert.equal((await measure()).header.top, before.header.top, 'reload must preserve initial position');
      await page.setViewportSize({ width: 402, height: 874 });
      const resized = await measure();
      assert.equal(resized.scrollY, 0, 'resize must not move home');
      assert.ok(resized.restore.bottom <= 874 - bottomInset && resized.footer.bottom <= 874 - bottomInset, 'resize keeps controls in the usable viewport');
      assert.deepEqual(errors, []);
      const video = page.video();
      if (video) await page.waitForTimeout(1000);
      await context.close();
      if (video) console.log('Recording:', await video.path());
    }
    console.log('Fixed home viewport and dialog scrolling passed.');
  } finally { if (browser) await browser.close(); await stopProcess(server); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
