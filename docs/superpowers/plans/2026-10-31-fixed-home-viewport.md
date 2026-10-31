# Fixed home viewport implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Keep the home screen at its settled first-screen position without document scrolling.

**Architecture:** Bound the home layout to the available viewport and preserve safe-area padding. Let the scene shrink before essential controls. Keep dialog scrolling separate.

**Tech Stack:** Existing native CSS/JavaScript, Python preview fixture and Playwright.

**Spec:** [Fixed home viewport](../specs/2026-10-31-fixed-home-viewport-design.md).

## Global constraints

- Preserve radar, TV, settings and connection behavior.
- Keep iOS top/bottom safe areas and existing touch targets.
- Use existing dependencies and record simulated versus physical validation separately.

## Review focus

- Nonzero safe areas must not create document overflow.
- Short screens must keep essential controls visible.
- Reload and dialog focus restoration must not shift the home position.
- Dialog scrolling and setting sliders must still work.
- Resize must not leave stale viewport dimensions or clip controls.

## Task 1: Reproduce and bound the home layout

**Files:** `firmware/ui/app.css`; `firmware/ui/app.js` only if needed; browser regression checks in `firmware/ui/`; bilingual usage/development documentation and changelogs.

**Interfaces:** Existing `.app-shell`, `.sheet`, preview fixture routes and visible controls. No backend changes.

- [ ] Add a meaningful browser regression that fails on the current layout: home bounding rectangles must not move after scrolling, and the restore action must fit within the usable viewport. Include nonzero safe areas and 320×700.
- [ ] Record the failing result, then make the smallest layout fix. Preserve internal sheet scrolling and safe areas.
- [ ] Run the regression plus settings/details interaction checks. Verify reload, focus return and resize.
- [ ] Synchronize the short bilingual explanations and changelogs. Do not claim physical iPhone verification.
- [ ] Run `python tools/verify_project.py --config`, capture a continuous preview MP4 and obtain independent review of the final diff.
- [ ] Commit the reviewed task, integrate with the managed worktree flow and push main. Build the resulting exact main, update the existing board over Wi-Fi and verify settings, intent, health and served assets.
