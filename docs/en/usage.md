[English](usage.md) | [简体中文](../usage.md)

# Usage and on-site calibration

The production firmware serves its own webpage. On a trusted LAN, open `http://<device-IP>/` or try `http://tv-radar.local/`; find the address in the router's connected-device list or serial logs. This is not an account or cloud service, and the computer need not stay on. The webpage and control interfaces have no access authentication: restrict them to a trusted network and do not expose them to the internet. The device UI is currently in Chinese; labels below include the Chinese text shown on the page.

## Understanding status

The automatic-function switch represents the user's **intent**, not a guarantee that monitoring is active. Startup, TV standby or disconnection, stale or unknown radar data, and unverified settings can pause monitoring while intent remains ON; the device will not wake the TV. Open device details and check “实际监测” (actual monitoring), “雷达数据” (radar data), “测距可判定” (measurement known), “电视状态” (TV status), “本次恢复责任” (current restoration responsibility), and settings status. The radar ripple means fresh data is online; it does not mean automatic picture-off is active. The near, far and absent person illustrations are only indicative, not a child's identity or precise posture.

The subtitle beneath the title has been removed. During brief uncertainty about TV state, the page can retain the last confirmed picture presentation for up to 5 seconds within the same connection; continuous uncertainty then shows an unconfirmed state. Repeated unknown values do not extend the deadline. This cache affects presentation only: it does not alter device control, monitoring or command success. Disconnect, heartbeat expiry, reconnection or an explicit TV communication/command failure immediately invalidates the previous presentation. The girl running between the TV and sofa illustrates near/far states, not a real angle, identity or movement path. The system reduced-motion preference uses stable end poses.

`Unknown` means the current measurement cannot be determined; it does not mean nobody is present. The radar may retain its last distance after a person leaves; do not treat that number as current presence or an accurate position. A single radar cannot guarantee target angle, identity or posture, and has blind spots, obstructions and false positives. This project is not a child safety or protective device.

With intent ON, the TV active and its connection fresh, the radar measurement known and settings verified, a target must remain in the near zone for the confirmation time before picture-off is triggered. TV standby pauses monitoring without waking it. The `Restore Picture` button turns off automatic-function intent and requests restoration. If the device turned off the picture, you can also turn the automatic function off and wait for restoration. Confirm the picture is restored and “本次恢复责任” is no; if the TV cannot be reached, troubleshoot first or use the TV remote.

Restoration responsibility `owned` exists only in RAM and is lost on power loss or restart. If the screen remains off after a restart, use the remote or webpage to restore it. Do not unplug power as a substitute for confirming restoration.

## Adjusting settings

Defaults are a 150 cm near range, 3-second near confirmation, 1-second radar absence delay, 1-second clear confirmation and standard sensitivity. Radar gate 8 observes a nominal area of about 6 m for near/far/absent classification; it does not cause picture-off throughout 6 m. Automatic picture-off uses the configured near threshold. Actual range, blind spots and false triggers vary with the environment.

1. Start with the TV displaying normally. Check that radar data is fresh, the TV is connected and settings are `ready`. Open the settings button at the top right to read saved values.
2. At the actual installation position, have a person approach slowly from normal viewing distance; observe target status and picture-off, then leave the near zone and wait for restoration. Also test stillness, different positions and an empty scene. Keep the remote available.
3. Adjust near range (50–300 cm), near confirmation, absence delay, clear confirmation and sensitivity as needed. Higher sensitivity may detect subtle movement more readily but may increase false triggers. Make small changes and test each in the real environment.
4. Select “应用设置” (apply settings) and wait for the page to report verification and saving, then read back the expected values. Monitoring pauses while applying; the device first restores any picture it controls, then writes to the radar, reads back each part, verifies everything and saves. An accepted submission or HTTP 200 does not mean completion. On failure, conflict or an unknown result, refresh and use device status as the authority; retry or restore defaults if needed.

Restoration wait includes the radar absence delay, clear confirmation and communication time; it is not an exact timer. Multiple browser tabs consume connections, so close extra pages while troubleshooting. The top-right refresh button reloads the entire page; automatic reconnection only synchronizes state.

## Troubleshooting

- **No serial port:** try another USB-C data cable or port; check the system port list, permissions and board boot mode. See [getting started](getting-started.md).
- **Cannot open the page:** confirm the device joined 2.4 GHz home Wi-Fi, the router does not isolate clients and the IP has not changed. Use the router's IP listing if mDNS fails. The fallback hotspot does not mean it joined the home network.
- **TV status unavailable / expired:** confirm the TV is on, reachable on the network, the IP and local PSK are correct and IP control is enabled; check model support. The device does not wake a TV in standby.
- **Old distance remains with nobody present:** use measurement-known, scene and freshness status; the sensor may retain a distance. `Unknown` does not imply absence.
- **A person to the side is not detected:** check orientation, obstructions, actual coverage and sensitivity. A single radar does not guarantee side coverage, identity or posture. Change position and test on site; parameter adjustment cannot guarantee safety.
- **Unstable page or insufficient connections:** close extra tabs and device pages, then refresh. Open SSE connections consume device sockets.
- **Old phone home-screen icon:** remove it, reload the updated page in Safari and add it again. Cache and appearance still need verification on each actual system.
