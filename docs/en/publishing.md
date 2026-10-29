[English](publishing.md) | [简体中文](../publishing.md)

# GitHub publishing and maintenance

The public repository is [github.com/timxinyao/guanju](https://github.com/timxinyao/guanju), with clone URL `https://github.com/timxinyao/guanju.git`. Creating the repository and making the first push are separate steps: confirm the push against the commits and files on GitHub.

## Publishing and maintenance checks

1. In the official project directory, read `AGENTS.md`, this page and [SECURITY.md](../../SECURITY.md), then check `git status --short`, `git branch --show-current` and `git remote -v`. Confirm that `origin` points to the intended repository, and account for uncommitted changes and existing remote content; do not force-push over it.
2. Review files and history intended for publication. Ensure they contain no `firmware/secrets.yaml`, personal `.bin` or `.elf` files, complete configuration logs, flash backups, build caches or private network information.
3. In an environment with the dependencies installed, run `python tools/verify_project.py --config` and compare the results with the verification record and unverified items below. Complete the independent review required by the project before pushing.
4. After pushing, check GitHub's commits, files, LICENSE, images, relative links and actual Actions result, including the default English `README.md`, `README.zh-CN.md` and their language-switch links. The device UI remains Chinese.
5. If development archives need to be public, inspect each relevant tag before pushing it separately; do not blindly push all local tags. Keep the Sony compatibility and physical verification limits in the repository description, and do not claim universal TV compatibility or a certified safety device.

## Local verification record

On 2026-10-29, local checks were completed on macOS with Python 3.13 and ESPHome 2026.10.1:

- 49 C++ controller checks, 15 settings-transaction checks and HTTP adapter checks passed with ASan/UBSan; all three Node.js web test suites passed.
- Five verification-tool unit tests, web JavaScript syntax, embedded-icon consistency, public-document relative links and privacy checks passed.
- All three YAML files validated with temporary example secrets. `tv-trial.yaml` compiled fully with example credentials only: RAM 33.4%, Flash 56.8%. No personal firmware was used or published.
- No new hardware flash, wiring or enclosure assembly, Windows/Linux operation, other TV models or iPhone hardware testing was performed. Suggested enclosure dimensions need physical measurement.
- Check each GitHub Actions result for the relevant commit on the Actions page; local verification does not establish the hosted result.
- No real home credentials or personally compiled firmware are included; this round did not flash a real device.

## Do not publish

Keep real secrets and historical personal logs and backups in the user's private location. Do not copy them into Git for the sake of a “complete” project. Example files provide keys and placeholders only; each user fills them locally and builds their own firmware.
