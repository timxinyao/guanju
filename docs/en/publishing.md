[English](publishing.md) | [简体中文](../publishing.md)

# GitHub publishing handoff

This repository is prepared locally. Creating a GitHub repository, configuring the remote and making the first push are for another agent to perform with the user's authorization. Creating a remote repository is not the same as pushing the local source; do not overwrite an existing remote without confirmation.

## Handoff steps

1. Work in the **official project directory** supplied by the user. Read `AGENTS.md`, this page and [SECURITY.md](../../SECURITY.md).
2. Check the local state:

   ```sh
   git status --short
   git branch --show-current
   git log -3 --oneline
   git remote -v
   ```

   The expected state is `main` with no unhandled changes. No GitHub organization or repository URL is assumed here.
3. Create an empty repository under the GitHub account selected by the user. A remote containing a README or LICENSE is not empty: inspect the differences first and do not force-push over it.
4. Review files and history intended for publication. Ensure they contain no `firmware/secrets.yaml`, personal `.bin` or `.elf` files, complete configuration logs, flash backups, build caches or private network information.
5. In an environment with the dependencies installed, run `python tools/verify_project.py --config` and compare the results with the verification record and unverified items below.
6. Set the remote using the repository URL actually returned. These commands are templates only; never treat a placeholder URL as a real destination:

   ```sh
   git remote add origin <user-authorized-repository-URL>
   git push -u origin main
   ```

   Add `origin` only when it does not already exist; otherwise verify who owns the existing remote first. If the development archive history needs to be kept, inspect the relevant tag for public suitability before pushing `archive/open-source-readiness` separately. Do not blindly push all local tags.
7. Check GitHub's files, LICENSE, images, relative links and CI results, including the default English `README.md`, `README.zh-CN.md` and their language-switch links. The device UI remains Chinese. A repository description may say “ESP32-C3 + LD2410C TV proximity screen-off assistant with a device-hosted Chinese web UI”; do not claim “works with all TVs” or “reliable child protection”.

## Local verification record

On 2026-10-29, local checks were completed on macOS with Python 3.13 and ESPHome 2026.10.1:

- 49 C++ controller checks, 15 settings-transaction checks and HTTP adapter checks passed with ASan/UBSan; all three Node.js web test suites passed.
- Five verification-tool unit tests, web JavaScript syntax, embedded-icon consistency, public-document relative links and privacy checks passed.
- All three YAML files validated with temporary example secrets. `tv-trial.yaml` compiled fully with example credentials only: RAM 33.4%, Flash 56.8%. No personal firmware was used or published.
- No new hardware flash, wiring or enclosure assembly, Windows/Linux operation, other TV models or iPhone hardware testing was performed. Suggested enclosure dimensions need physical measurement.
- GitHub Actions remains to be checked after remote creation and its first run.
- No real home credentials or personally compiled firmware are included; this round did not flash a real device.

## Do not publish

Keep real secrets and historical personal logs and backups in the user's private location. Do not copy them into Git for the sake of a “complete” project. Example files provide keys and placeholders only; each user fills them locally and builds their own firmware.
