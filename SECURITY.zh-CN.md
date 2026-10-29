[English](SECURITY.md) | **简体中文**

# 安全与网络边界

设备网页与 REST 接口没有访问认证，默认 ESPHome 原生 OTA 也没有密码。可访问设备的本地网络用户可能查看状态、改变设置或更新固件；请仅在可信、隔离的局域网使用，不要将设备端口暴露到互联网或不可信网络。备用热点密码和电视 PSK 使用 `firmware/secrets.yaml` 保存，该文件不应提交或分享。

可选择给原生 OTA 加密码：在本机 `firmware/secrets.yaml` 增加 `ota_password`，并在本地 `tv-trial.yaml` 的 `ota` 下对应 `platform: esphome` 项加上 `password: !secret ota_password`。这只保护 OTA，并不会为网页或 REST 接口增加认证。更新及恢复步骤见[维护说明](docs/maintenance.md)。

发现安全问题时，请先私下联系项目维护者；避免公开真实网络地址、密钥、完整配置日志或构建产物。
