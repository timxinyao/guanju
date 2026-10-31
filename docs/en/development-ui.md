[English](development-ui.md) | [简体中文](../development-ui.md)

# Local UI preview

This service binds only to local `127.0.0.1` and uses simulated entities in memory. It does not connect to or control a TV, radar or any other device, and does not depend on ESPHome. The root page serves `firmware/ui/app.js` and `firmware/ui/app.css` as `/0.js` and `/0.css`; these files are maintained as the device UI. Each launch starts with fresh, independent data.

Run from the project root:

```sh
python3 tools/ui_preview.py status
python3 tools/ui_preview.py start
python3 tools/ui_preview.py status
python3 tools/ui_preview.py stop
```

Starting actually binds port 0 first; the printed address is the address in use. Open it to view the UI, and use `/_fixture` on the same address to change simulated scenarios. Normal, Near, Far, Standby, Unknown, Unavailable, PictureOff, Expired and Offline are all server simulations. Offline interrupts SSE and makes entity REST requests return 503; the fixture page can still restore the simulation. Expired leaves the connection open but stops events and heartbeats to exercise state expiry. Restore Picture simulates turning the trial off first, then restoring the picture after a short wait. This validates UI behaviour only and cannot establish real-device results.

**PictureOff**, **HideTransition** and **RestoreTransition** retain the current radar state: select Near, Far, Normal or Unknown first to simulate a picture change with that state. No person is invented when the radar has no target. HideTransition begins with a visible picture, spends 1.5 seconds with TV status unavailable, then confirms picture-off; RestoreTransition simulates the reverse. **TVUnknown** keeps SSE online while TV status remains unavailable, for checking presentation beyond 5 seconds; **TVFailure** simulates an explicit TV communication failure. Switching scenarios invalidates earlier transition timers. These are simulations and send no commands to real devices. Run `python3 -m unittest discover -s tests -p test_ui_preview_fixture.py` offline to check fixture transitions and cancellation.

The registration file `output/ui-preview-state.json` records PID, process creation time, project root, mode, actual address and log path. Logs are in `output/ui-preview.log`; simulated data exists only in the process. Status and stop verify the registered PID, creation time and process command. If registration cannot be verified, leave the process alone rather than guessing a target from its port. After an abnormal exit, first check whether the recorded PID exited or was reused, then remove the stale registration manually. Start and status do not automatically take over unknown processes. The main session is responsible for stopping the instance it starts; logs are retained.

For a foreground process, run `python3 tools/ui_preview.py serve`. It prints the actual address and stops with Ctrl-C. This one-shot mode is not registered or managed by `status`/`stop` above. Do not run multiple managed instances with the same registration path.

The settings panel uses the local `/settings` simulation to apply changes asynchronously: it goes through queued, read_radar, verify_all and save, then commits after about 3 seconds. Actual monitoring stops during application while the trial intent is retained. If the simulation owns a picture-off state, it first simulates restoring the picture. Settings and revision change only after successful saving; all data disappears when the process exits.

Select **SettingsFail** in `/_fixture` to make the next valid settings application fail during verification. Original values and revision remain; retry or restore defaults. Select **SettingsConflict** to make the next valid submission simulate another client changing distance and revision and return 409; the UI can reread the server's values. These buttons arm one-shot failures only; they do not switch the current radar or TV scenario.

## Diagnostics, pause and calibration fixtures

`GET /diagnostics` mirrors firmware v1 fields: session, snapshot/sample sequences, uptime, configuration revision, thresholds, category distances and validity, health/reason, TV/restoration ownership, remaining pause, external-restore wait and recent events. Snapshots are cached for about one second, with one accepted request per second shared by all clients. Excess requests receive HTTP 429, `retry_after_ms: 1000` and `Retry-After: 1`. History holds at most 12 RAM events. Unknown, absent and stale states do not invent distances; Expired retains the old sample time and reports stale data, while Offline returns 503. Snapshots are not a complete radar recording.

Simulated button routes `Pause 10 Minutes`, `Pause 30 Minutes` and `Resume Monitoring` match home controls. Pause retains enabled intent, simulates restoring only the session-owned picture and never wakes standby; expiry uses a real monotonic clock. **ExternalRestore** retains the radar scene while simulating external picture restoration and waiting for clear. Resume ends only the timed pause. Python tests use a controlled clock for expiry, obsolete timers and long uptime; HTTP tests use a local server for endpoints and rate limiting. Neither is browser-rendering or real-device validation.

Browser checks should cover the device-derived home explanation and near/approach rules, explicit “恢复画面并停用” action, settings close/keep-editing/discard paths and initially collapsed advanced controls. Debug polls only while open and foregrounded through the shared serialized queue, cancels on close/background, backs off on 429 and creates no extra SSE connection. For guided calibration, turn automation off, then select Near, Far, Far (seated-still) and Normal (absent), recording 3–30 snapshots per step. It summarizes only and never applies settings. The simulated stillness step cannot establish real stationary-target detection.

Run `node firmware/ui/viewport.browser.cjs` for the fixed-home regression; set `CHROME_PATH` to choose the browser. The script substitutes nonzero safe-area values in CSS and checks short and desktop viewports, scrolling, dialogs, slider input, reload and resize. This simulation does not validate a real iPhone or Safari.

Optional real-browser script, run from the project root with Node-importable Playwright and Chromium at `/usr/bin/chromium`:

```sh
node firmware/ui/mobile.browser.cjs
```

The script starts and stops its own foreground `serve` fixture; it does not take over the managed instance above. Screenshots and continuous browser video go to `output/mobile-qa/`. This is separate from default browser-free verification and is not a claim that it has passed. Check the actual exit result, screenshots and recording. Convert browser video to a directly playable MP4 before delivering it as MP4; do not call a sparse screenshot montage continuous recording. Viewport sizes are responsive test samples, not asserted dimensions of a particular iPhone. Report current-feature browser screenshots, continuous MP4, Safari/iPhone and hardware validation separately from actual evidence; the historical record below does not establish them.

## Historical validation record (earlier version)

On 2026-10-29, existing Chrome / Playwright checked 402×874, 320×700 and 1280×900 viewports, delayed/failed initial SSE connections, the fixed five-second unknown deadline, short uncertainty with raw control permissions, 800 ms motion and early reversals, dynamic reduced motion, and settings/details/refresh. There were no JavaScript page errors; the fixture’s missing favicon returns an unrelated 404. The real-time demo is a continuous recording. After OTA on the reference controller, saved settings and the automation preference remained intact and the TV stayed in standby. Simulated scenes do not establish physical proximity behavior or iPhone compatibility.
