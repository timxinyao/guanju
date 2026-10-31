# Black pigtails scene deployment plan

> **For agentic workers:** Use subagent-driven development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved distance-driven girl animation in the device-hosted page and install the reviewed firmware over the existing native OTA connection.

**Architecture:** Reuse the foreground diagnostics poller, its request queue, cache sequence protection and distance freshness checks. A presentation-only scene model drives an SVG character; it never changes controller decisions or settings. Preserve the existing TV presentation and viewport layout.

**Tech stack:** Existing dependency-free JavaScript/CSS/SVG, Node assertions, local Chrome/Playwright, ESPHome.

**Spec:** The approved design and constraints below.

## Approved design

- The TV and sofa stay vertically aligned on the original centre axis. The oblique furniture experiment is rejected.
- A toddler girl faces the TV with her back to the viewer. Her hair is black (`#19191d`), with restrained charcoal shading, two rounded short pigtails and coral pink ties. No hat, eyes or nose in the back view.
- Match the approved character and gestures: closest position leans on the TV cabinet, middle distances use the same standing pose, furthest position sits on the sofa with her head and upper body visible.
- Use a clamped 50–300 cm illustrative distance projection. Enter the closest pose at <=60 cm and retain it through 70 cm; enter sitting at >=280 cm and retain it down to 260 cm. These are illustration boundaries, not detection settings or posture recognition.
- Confirmed absence walks directly left from the current interpolated position; a newly detected target enters from the left. Release hands or rise before leaving. An interrupted walk resumes from the rendered position.
- Alternate arms and legs, add restrained body and hair movement, and settle at rest. Keep head and body proportions stable with no nonuniform scaling or negative-scale mirroring.
- Draw near/red, release-margin/amber and far/green ground zones using the same distance projection and the verified thresholds. Waves expand from the cabinet when radar data is fresh. Positions and left-side transitions do not represent real left/right tracking.
- Unknown or stale measurements do not imply absence: stop the path, retain the last coordinates and de-emphasize the character without an exit story. Reduced motion settles directly to the static result.

## Global constraints

- Change the web presentation only. Do not change radar, controller, settings transactions, TV commands, Wi-Fi or OTA protocols.
- Use one shared foreground `/diagnostics` poller and the existing request queue. Retain at most one in-flight request, approximately one successful poll per second, existing 429/backoff handling, and no polling while hidden or disconnected. Closing details must not stop the home scene; no second SSE connection.
- Use `diagnosticView` freshness/validity checks and monotonic cache acceptance. Only fresh known `near`/`far` frames with valid positive category distances provide the nearest distance. Only a fresh known `absent` frame may trigger departure. Never use aggregate detection distance or stale/invalid category values.
- Diagnostics receipt and expiry must refresh the home presentation. Preserve the TV transition grace, picture-off presence, saved intent, parameter controls, refresh action, safe areas and fixed viewport.
- Production UI contains no demo controls, simulated distances or prototype labels. It must not claim child identity or recognized posture.
- Do not read, display or publish private secrets, configuration logs or personal firmware. Use example secrets for device-free checks.
- Update matching English/Chinese usage, architecture and changelog descriptions. Keep rules concise and avoid historical process notes in AGENTS.md.

## Review focus

- Repeated 1 Hz identical targets must not restart or prevent pose settling.
- A retarget, absence or unknown during motion must not teleport or detour through the sofa.
- A late request after visibility changes, reconnect or device reboot must not revive old positions.
- Changing the near threshold must keep the coloured floor boundaries consistent with the distance projection.
- Picture-off and standby must not remove a freshly measured target; hidden pages must not keep an animation loop or poller running.

## Task 1: Integrate the scene and document its limits

**Files:** `firmware/ui/app.js`, `firmware/ui/app.css`, focused scene tests, existing related tests as needed, `firmware/ui/README.md`, paired usage/architecture guides, paired changelogs, and this plan.

**Consumes:** `diagnosticView(data, receivedAt, now)`, `updateDiagnosticsCache`, `createDiagnosticsPoller`, verified settings and existing connection lifecycle. Prototype is a visual reference; its simulated controller is not production input.

**Produces:** A dependency-free production scene, meaningful exported pure-model tests, and a browser fixture flow covering valid distances, absence, interruption, unknown and reduced motion.

- [x] Write and run failing focused tests for freshness/category rejection, same-target stability, direct exit/entry, interruption and viewport-compatible scene markup.
- [x] Integrate the approved SVG and animation state model; wire it to the existing diagnostics lifecycle and TV presentation.
- [x] Verify the focused tests turn green, including repeated target updates, expired/late frames and non-default threshold geometry.
- [x] Run the full project check with example configs, plus the relevant viewport/browser checks.
- [x] Update matching public documents and perform the knowledge/rule consistency check.
- [ ] Commit the complete task and obtain an independent review of its exact HEAD.

## Task 2: Verify, publish and install the reviewed version

**Ownership:** Parent integrates the reviewed branch; deployment worker exclusively owns device access during flashing. Visual worker records the production UI using fixtures without touching the device.

- [ ] Record an actual continuous production-browser MP4 and check the approved geometry, black pigtails, gestures, presence while picture-off and fixed viewport.
- [ ] Resolve review findings, verify the exact final HEAD and finish the registered worktree with squash, main/tag push and owned-resource cleanup.
- [ ] Read the actual device identity, current intent, settings and ownership again. Pause only for the upload and confirm no owned picture-off remains.
- [ ] Compile exact reviewed firmware sources using secrets opaquely, upload over verified native OTA and wait for reboot.
- [ ] Confirm served assets match the reviewed source, settings/revision are retained, radar/TV states are fresh, original intent is restored and one parameter audit completes. Never wake the TV.
- [ ] Preserve private deployment evidence, report actual validation and untested physical/iOS paths, and deliver the production preview video.
