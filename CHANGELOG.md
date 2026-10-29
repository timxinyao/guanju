**English** | [简体中文](CHANGELOG.zh-CN.md)

# Changelog

## Unreleased

- Remove the page subtitle, smooth brief unknown TV presentation for up to 5 seconds without changing control, and animate an illustrative girl between near and far positions. Disconnects, reconnection and explicit failures invalidate the presentation; reduced-motion uses stable poses.
- Add simulated TV transition, sustained unknown and explicit failure scenarios to the local UI fixture.

- Name the independent radar distance assistant **Guanju (观距)**.

- Add paired English and Chinese documentation and language-switch links; the device web interface remains in Chinese.

## Initial open-source preparation · 2026-10-29

- Organize the standalone ESP32-C3-Zero-M and HLK-LD2410C firmware, Chinese web page, home-screen icon, settings, and calibration workflow.
- Retain Sony picture control, near-distance confirmation, persistent user choice, RAM-only recovery responsibility, and serial settings transactions.
- Add public configuration templates, repeatable device-free verification, CI, and guides for hardware procurement, wiring, enclosure installation, first USB flashing, later Wi-Fi updates, and AI-assisted setup.
- Keep personal network credentials, historical real-device logs, flash backups, and build caches outside the repository.

### Existing validation evidence

Earlier work included USB flashing, native Wi-Fi OTA, settings readback, and web and actual picture-off/restoration trials on one ESP32-C3-Zero-M / LD2410C / Sony TV setup. Several states of the newer web interface were checked in a browser using a simulated service. Host-side device-free tests cover detection, transactions, and HTTP input; these records do not establish coverage of every environment.

### Current and future validation limits

Refer to the release handoff for the actual checks performed during open-source preparation. The following are not guaranteed: every Sony model, other brands, all iOS versions and home-screen icon caches, physical flashing on Windows or Linux, enclosure dimensions fitting every build, long-term Wi-Fi stability, all child heights and postures or near-distance edges, multiple targets, and power-loss/fault combinations. The enclosure is an assembly suggestion and illustration, with no guarantee from a tested print fit.
