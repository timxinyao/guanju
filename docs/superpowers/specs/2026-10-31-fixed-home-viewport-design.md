# Fixed home viewport

## Request and acceptance

The user wants the home screen to open at its settled position in the supplied recording and remain there when swiped. Keep the header below the iOS safe area and all essential home actions above the bottom safe area. Settings and device-details dialogs must retain their own scrolling.

The recording shows the whole home screen moving vertically. The current stylesheet also allows automatic shell height on short screens. Confirm the layout failure in a browser before changing it; the recording alone does not establish the exact iOS mechanism.

## Approach

Use one bounded home viewport, prevent document scrolling and size the illustration from the available space. Prefer CSS to global touch cancellation, which can interfere with sliders and dialog scrolling. Add narrowly scoped viewport handling only if browser evidence requires it. Do not change radar, TV or settings semantics.

Check 320×700, 402×874 and a desktop viewport. Include nonzero simulated safe-area insets, wheel/touch scrolling, reload and dialog close. Home controls must remain reachable, and opening a long dialog must not move the home screen. Chromium simulation does not establish physical iPhone/Safari behavior.

Deliver an actual continuous-browser MP4, independent review, project verification, Git integration and a Wi-Fi update that preserves the existing device parameters and automation preference.
