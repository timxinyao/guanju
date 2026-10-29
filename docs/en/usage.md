[English](usage.md) | [简体中文](../usage.md)

# Usage and on-site calibration

The production firmware serves its own webpage. On a trusted LAN, open `http://<device-IP>/` or try `http://tv-radar.local/`; find the address in the router's connected-device list or serial logs. This is not an account or cloud service, and the computer need not stay on. The webpage and control interfaces have no access authentication: restrict them to a trusted network and do not expose them to the internet. The device UI is currently in Chinese; labels below include the Chinese text shown on the page.

## Understanding status

The automatic-function switch represents the user's **intent**, not a guarantee that monitoring is active. Startup, TV standby or disconnection, stale or unknown radar data, and unverified settings can pause monitoring while intent remains ON; the device will not wake the TV. The home screen keeps TV status, a device-derived scene explanation, near range and approach confirmation time. The top-right details button opens “调试模式” (debug mode) for health details and pause reasons. The radar ripple means fresh data is online; it does not mean automatic picture-off is active. The near, far and absent person illustrations are only indicative, not a child's identity or precise posture.

The home scene explanation comes from device state: unknown is not guessed to mean absent, and there is no invented trigger countdown. During brief uncertainty about TV state, the page can retain the last confirmed picture presentation for up to 5 seconds within the same connection; continuous uncertainty then shows an unconfirmed state. Repeated unknown values do not extend the deadline. This cache affects presentation only: it does not alter device control, monitoring or command success. Disconnect, heartbeat expiry, reconnection or an explicit TV communication/command failure immediately invalidates the previous presentation. The girl running between the TV and sofa illustrates near/far states, not a real angle, identity or movement path. The system reduced-motion preference uses stable end poses.

`Unknown` means the current measurement cannot be determined; it does not mean nobody is present. The radar may retain its last distance after a person leaves; do not treat that number as current presence or an accurate position. A single radar cannot guarantee target angle, identity or posture, and has blind spots, obstructions and false positives. This project is not a child safety or protective device.

With intent ON, the TV active and its connection fresh, the radar measurement known and settings verified, a target must remain in the near zone for the confirmation time before picture-off is triggered. TV standby pauses monitoring without waking it. “恢复画面并停用” (restore picture and disable; device API: `Restore Picture`) turns off automatic-function intent and requests restoration. If the device turned off the picture, you can also turn the automatic function off and wait for restoration. Confirm the picture is restored and “本次恢复责任” is no; if the TV cannot be reached, troubleshoot first or use the TV remote.

Restoration responsibility `owned` exists only in RAM and is lost on power loss or restart. If the screen remains off after a restart, use the remote or webpage to restore it. Do not unplug power as a substitute for confirming restoration.

## Temporary pause

With intent ON, select “暂停 10 分钟” or “暂停 30 分钟” to pause for 10 or 30 minutes. Pausing retains the enabled intent and automatically restores only the picture-off owned by this session. It does not wake a TV in standby or claim a picture turned off externally. “继续监测” (resume monitoring) appears during the pause and can end it early. Expiry or resume still requires the normal health and fresh-measurement checks; neither means immediate picture-off. Approximate remaining minutes come from the device snapshot in debug details, not a home-screen countdown calculated by the browser.

If a remote or another client restores this session's picture-off, the controller respects that external change and waits for a valid clear-zone confirmation before allowing a new automatic hide. Resume ends only the temporary pause; it does not bypass this wait. Turning the automatic function off is different from temporarily pausing it.

## Adjusting settings

Defaults are a 150 cm near range, 3-second near confirmation, 1-second radar absence delay, 1-second clear confirmation and standard sensitivity. Radar gate 8 observes a nominal area of about 6 m for near/far/absent classification; it does not cause picture-off throughout 6 m. Automatic picture-off uses the configured near threshold. Actual range, blind spots and false triggers vary with the environment. Entry uses configured threshold D; once near, the current code releases that state only when valid target distances exceed D + 20 cm, or a valid absent state is confirmed, to reduce boundary jitter. The 20 cm margin is provisional hysteresis in code, not a medical or safety distance or a webpage setting. Confirmation also needs recent valid supporting measurements after the interval ends: one old reading or elapsed wall time alone cannot trigger a command.

1. Start with the TV displaying normally. Check that radar data is fresh, the TV is connected and settings are `ready`. Open the settings button at the top right to read saved values. “关闭” (close) does not save: an unapplied draft requires “继续编辑” (keep editing) or “放弃修改” (discard changes). Wait for an in-progress application to finish before closing.
2. Turn automatic picture-off off first and use guided calibration below to observe near, far, seated-still and absent scenes. Once placement and settings are suitable, enable the function to test actual picture-off and restoration. Keep the remote available.
3. Adjust near range (50–300 cm), approach confirmation and recovery confirmation as needed. Absence delay and sensitivity are in “高级设置” (advanced settings), collapsed initially. Higher sensitivity may detect subtle movement more readily but may increase false triggers. Make small changes and test each in the real environment.
4. Select “应用设置” (apply settings) and wait for the page to report verification and saving, then read back the expected values. Monitoring pauses while applying; the device first restores any picture it controls, then writes to the radar, reads back each part, verifies everything and saves. An accepted submission or HTTP 200 does not mean completion. On failure, conflict or an unknown result, refresh and use device status as the authority; retry or restore defaults if needed.

Restoration wait includes the radar absence delay, clear confirmation and communication time; it is not an exact timer. Multiple browser tabs consume connections, so close extra pages while troubleshooting. The top-right refresh button reloads the entire page; automatic reconnection only synchronizes state.

## Debugging and guided calibration

The top-right details button opens “调试模式” (debug mode). Home does not poll diagnostics. Only while the panel is open, the page is foregrounded and the connection is live does it request `GET /diagnostics`, starting at about one request per second. Diagnostics use the same serialized queue as existing controls, with at most one diagnostic request outstanding and no additional SSE connection. Returning, backgrounding or leaving the page cancels diagnostics. Busy responses, HTTP 429 and offline failures trigger backoff. Other users and collection clients share the device's rate limit; each client is not guaranteed a snapshot every second.

“最近目标距离” (nearest target distance) is the nearest approximate distance among valid, fresh moving/still target categories, not a precise position. Absent, unknown or stale measurements show “—”, not residual distances. Expand “测量与设备详情” for category distances, entry/release thresholds, parameter audit, configuration revision, pause snapshots and sequence numbers. “最近事件” contains at most 12 RAM events, cleared on restart; older entries are displaced. These are bounded state snapshots and events, not a complete or lossless radar recording.

“引导校准” (guided calibration) can start only with automatic picture-off OFF and fresh diagnostics:

1. Stand at the near position where you want a reminder; expect near.
2. Move back to the normal viewing position; expect far.
3. Sit still at that viewing position and continue checking far detection.
4. Leave the radar coverage area and check for absent.

Get into position first, then select “开始观察” (start observing) or “开始这一步” (start this step); movement between positions is excluded. Collect at least 3 distinct snapshots per step before selecting “记录这一步” (record this step); each step retains at most 30. The page summarizes matches, uncertain observations and the range of valid distances. It neither selects a precise safe distance nor applies parameters. “结束观察” ends observation; recorded results remain only in the current page and are lost on reload. Backgrounding or closing debug stops collection; a device restart or enabling automation ends the observation session. If results differ from expectations, check placement, obstructions and reflections, then adjust settings slightly and retest. These short observations do not replace validation under actual viewing conditions.

## Troubleshooting

- **No serial port:** try another USB-C data cable or port; check the system port list, permissions and board boot mode. See [getting started](getting-started.md).
- **Cannot open the page:** confirm the device joined 2.4 GHz home Wi-Fi, the router does not isolate clients and the IP has not changed. Use the router's IP listing if mDNS fails. The fallback hotspot does not mean it joined the home network.
- **TV status unavailable / expired:** confirm the TV is on, reachable on the network, the IP and local PSK are correct and IP control is enabled; check model support. The device does not wake a TV in standby.
- **Old distance remains with nobody present:** use measurement-known, scene and freshness status; the sensor may retain a distance. `Unknown` does not imply absence.
- **A person to the side is not detected:** check orientation, obstructions, actual coverage and sensitivity. A single radar does not guarantee side coverage, identity or posture. Change position and test on site; parameter adjustment cannot guarantee safety.
- **Unstable page or insufficient connections:** close extra tabs and device pages, then refresh. Open SSE connections consume device sockets.
- **Old phone home-screen icon:** remove it, reload the updated page in Safari and add it again. Cache and appearance still need verification on each actual system.
