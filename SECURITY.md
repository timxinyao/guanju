**English** | [简体中文](SECURITY.zh-CN.md)

# Security and network boundaries

The device web page and REST API have no access authentication, and ESPHome native OTA has no password by default. Anyone with network access to the device may be able to view its state, change settings, or update its firmware. Use it only on a trusted, isolated LAN; do not expose device ports to the internet or an untrusted network. The fallback access point password and TV PSK are stored in `firmware/secrets.yaml`; do not commit or share this file.

You may optionally add a password to native OTA: add `ota_password` to your local `firmware/secrets.yaml`, then add `password: !secret ota_password` under the `platform: esphome` entry in `ota` in your local `tv-trial.yaml`. This protects OTA only; it does not authenticate the web page or REST API. See [maintenance](docs/en/maintenance.md) for update and recovery steps.

If you find a security issue, contact the project maintainers privately first. Do not disclose real network addresses, credentials, complete configuration logs, or build artifacts.
