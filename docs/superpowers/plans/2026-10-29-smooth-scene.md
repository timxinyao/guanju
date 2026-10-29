# Calm scene implementation plan

> Use superpowers:subagent-driven-development. Keep changes isolated in the registered smooth-scene worktree; only local Git integration is authorized.

**Goal:** Apply the approved small-heading, stable-TV-status and running toddler-girl design.
**Architecture:** Keep raw control derivation intact; add a session-scoped presentation cache and an interruptible decorative actor animation. Match TV image and status dot to the same presentation result.
**Tech stack:** Existing vanilla JS/CSS/inline SVG, Node tests, Python fixture server and bundled Playwright.
**Spec:** [Approved design](../specs/2026-10-29-smooth-scene.md).

## Tasks and ownership

- [x] UI implementer owns firmware/ui/app.js, app.css and UI tests. First add failing behavior tests for unknown timing, repeated samples, confirmed updates, session resets, immediate failures and untouched control enablement; then implement. Draw the approved toddler girl and animation. No fixture/docs/firmware-control edits.
- [x] Fixture/docs implementer owns tools/ui_preview.py, paired docs/development-ui.md and docs/en/development-ui.md, paired usage guides, firmware/ui/README.md and changelogs. Add deterministic, cancellable simulated TV transition/long-unknown/failure scenarios if needed. Keep existing near/far/offline/settings fixtures. Document the presentation grace and illustration boundaries in both languages.
- [x] Main coordinates local preview service and mobile/desktop browser QA; a visual_tester exercises live fixture flows, captures screenshots and timing/position evidence, checks console, viewport overflow and reduced-motion. No physical hardware.
- [x] Independent reviewer covers the full branch, including asynchronous rendering and latest-target behavior. Fix actionable findings and run the full project verification entry with example configuration.
- [x] Reconcile documents, complete local Git delivery preparation, stop the owned fixture service and preserve evidence. Integrate the reviewed SHA using native local-only squash/archive cleanup; Git records are the final integration evidence. No remote push. A previously authorized Wi-Fi update follows maintenance preflight after checks; record the actual outcome without claiming iPhone or active-TV validation.

## Review focus

5000 ms boundary must not be extended by repeated stale values; reconnect must invalidate cached screen; explicit failures and raw controls must not be delayed; animation must not run again on heartbeat or stale/absent data; interrupting a trip must not leave a ghost actor or wrong final pose.
