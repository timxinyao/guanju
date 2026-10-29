# Calm status and animated toddler scene

The user approved keeping the last confirmed TV presentation during brief uncertainty, shrinking the main status heading to 26–28 px, removing the “电视距离助手” subtitle and near-zone explanation block, and animating the child between TV and sofa. The child is a roughly three-year-old girl with short hair and small tied pigtails.

## Behavior

- Add a presentation-only TV state model. Within a connected session, retain the last confirmed visible/off/standby presentation for at most 5000 ms of continuous unknown TV state. Repeated unknown events must not extend that deadline. No transition caption or “切换中” text is shown.
- Initial incomplete hydration shows “正在连接” and has no invented confirmed picture. A continuous unconfirmed connected state becomes “电视状态待确认” after 5000 ms. A confirmed TV state replaces it immediately.
- Device disconnect/expired heartbeat invalidates cached presentation immediately, and a new connection generation cannot reuse it. Explicit TV communication/command failures must be presented immediately rather than concealed by the grace period. Standby is confirmed and immediate.
- Preserve raw entity values, diagnostics, derive(), control enablement, settings validation, and device control. Held presentation never authorizes a control or marks a command successful.
- TV title, state dot and screen share one presentation result: muted green for visible; indigo for picture off; gray for standby/offline; amber for unconfirmed. Explicit failures have a distinct accessible fault indication. Keep text with color; no color-only meanings.
- The TV illustration fades between landscape and dark screen after confirmation (about 400 ms). Unknown/offline must be visually distinct. The room stays light and calm.
- A short-haired toddler girl with small pigtails runs along a small curved path between near-TV standing and sofa sitting (700–900 ms), with alternating limbs and gentle bounce; rising/sitting have a small settling motion. Animate only actual near↔far changes, not every render or initial hydration. Do not queue obsolete trips; rapid reversals follow the latest target. Absent/unknown/stale data hides the girl rather than inventing movement.
- Person location uses radar scene classification, TV screen uses TV state, and radar waves use fresh radar data. These remain independent, including while automation is off or the TV is in standby.
- Preserve the single-screen mobile layout, iOS safe areas, visible switch, refresh, parameter/details dialogs and useful control/recovery explanations. Implementation and browser QA use simulated data. Reduced-motion uses stable end poses and no running/bouncing.

## Scope and validation

Self-contained vanilla JS/CSS/SVG; no CDN, new runtime dependency, raster generation or firmware-control changes. Prove timing/session/fault boundaries with deterministic tests, then validate actual rendered normal/off/standby/unknown/offline/near/far/absent and rapid reversal/reduced-motion behavior. Local preview fixtures use simulated data only. Browser plugin is absent; use existing bundled Playwright when available. Device/Safari hardware behavior is not claimed from Chromium tests.

## Deployment boundary

The ongoing session previously authorized Wi-Fi firmware updates; the user approved this UI design. After review/build checks, a reachable known controller may receive this update using the documented maintenance procedure: record intent/settings, disable automation, verify no owned picture-off, upload once, confirm ready/settings and restore the recorded intent. Never wake the TV or change radar settings. Keep personal build/config/logs outside Git. Actual Safari/iPhone and active-TV behavior remain unverified unless separately observed.
