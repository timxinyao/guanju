# 固件配置

本项目固定使用 ESPHome 2026.10.1，支持 Python 3.12–3.14。三个配置用于不同阶段：

- [radar-observer.yaml](radar-observer.yaml)：通过 USB 日志观察雷达，不连接电视。
- [radar-network-observer.yaml](radar-network-observer.yaml)：在本地网络观察雷达，不控制电视。
- [tv-trial.yaml](tv-trial.yaml)：当前设备入口，使用 Sony 电视的受支持接口控制画面；参见 [电视功能说明](TV-TRIAL.md)。

从 [secrets.example.yaml](secrets.example.yaml) 复制出本机 `secrets.yaml`，填写自己的 Wi-Fi 和 Sony 电视设置。不要提交或分享实际密钥文件、包含密钥的配置输出及构建产物。配置和首次烧录见[入门教程](../docs/getting-started.md)，接线见[硬件说明](../docs/hardware.md)，更新及恢复见[维护说明](../docs/maintenance.md)。

本项目用于辅助观察距离，雷达存在盲区和误报，不能识别儿童或保证安全。网络访问与 OTA 边界见 [安全说明](../SECURITY.zh-CN.md)。
