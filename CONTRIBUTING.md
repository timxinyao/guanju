**English** | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing

Bug fixes, improvements to the hardware build guides, and new TV integrations are welcome. Start with the [README](README.md), [architecture](docs/en/architecture.md), [AI entry point](AGENTS.md) (in Chinese), and [security boundaries](SECURITY.md).

## Getting started

1. Work in your own branch or worktree. Do not upload your personal `secrets.yaml`, build directories, secrets in screenshots, or firmware images.
2. Install the pinned versions in `requirements.txt`, and prepare Node.js 22, POSIX sh, and a C++17 compiler. WSL2 is recommended for the full checks on Windows.
3. Run `python tools/verify_project.py --config` for device-free checks. For page changes, use the [simulated preview](docs/en/development-ui.md); a real TV is not required.
4. Add meaningful regression assertions for changes to detection, recovery, settings transactions, or request ordering. Prose-only edits do not need tests that mirror the implementation.
5. Update the relevant user documentation and report the commands, results, and any hardware or systems not tested. Reviews must cover requirements and failure paths, not just passing tests.

## Adding a TV integration

The existing runtime uses Sony `/sony/system`. Before adding a brand, define the semantics of status queries, picture off and restoration, standby, and errors. Preserve the invariants: never wake the TV, restore only a picture-off action owned by this controller, and read back state after a timeout. Do not claim support for a new model without evidence; document the conditions of any real-device tests in the compatibility guide.

## Issues and change descriptions

When reporting a problem, include the model, radar and firmware versions, sanitized state, and reproduction steps. Use the templates and do not attach complete configuration logs, a PSK, Wi-Fi passwords, or personal firmware images. Handle security issues privately as described in [SECURITY.md](SECURITY.md).

Suggested commit prefixes are `feat:`, `fix:`, `docs:`, `test:`, and `chore:`; describe the concrete result. By submitting a change, you confirm that you can contribute it under the repository's MIT license. Preserve attribution and license information for third-party content.

## Bilingual documentation

Maintain the English and Chinese paired files together when changing user documentation, including section structure, links, commands, parameters, and security boundaries. Call out any portions that cannot be synchronized in the change description. Bilingual documentation does not mean the device web interface supports language switching.
