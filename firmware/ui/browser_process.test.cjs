'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { waitForAddress, stopProcess } = require('./mobile.browser.cjs');
(async () => {
  assert.equal(typeof waitForAddress, 'function');
  const failed = spawn(process.execPath, ['-e', 'process.exit(2)']);
  await assert.rejects(waitForAddress(failed, 500), /exit 2/);
  await stopProcess(failed);
  const hanging = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await assert.rejects(waitForAddress(hanging, 20), /timed out/);
  await stopProcess(hanging);
  assert.notEqual(hanging.signalCode, null);
  const exited = spawn(process.execPath, ['-e', '']); await once(exited, 'exit');
  await stopProcess(exited);
  console.log('浏览器夹具启动超时与已退出进程清理检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
