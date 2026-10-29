[English](en/compatibility.md) | [简体中文](compatibility.md)

# 兼容性与边界

当前电视适配只针对 Sony BRAVIA 的 IP 控制：向电视 `/sony/system` 发送 `getPowerStatus`、`getPowerSavingMode` 和 `setPowerSavingMode`，PSK 放在 HTTP 请求头 `X-Auth-PSK`。这个 Sony API 路径已有实际运行记录，但不能因此断言所有 BRAVIA 型号或系统版本兼容；其他电视需要实现并验证新的 adapter，不是通用 HDMI 控制，也不宣称支持三星等其他品牌。

电视须支持对应接口及 PSK，并能从开发板局域网访问。自己在电视设置中启用适用的远程/IP 控制，选择预共享密钥认证并设置 PSK；菜单路径因型号、地区和系统版本不同，请以该型号手册为准。[Sony BRAVIA Professional 官方 IP 控制说明](https://pro-bravia.sony.net/setup/device-settings/red-da/)列出部分型号的认证与设置，但并非所有消费型号的兼容保证。电视 IP 与 PSK 只填自己的本地 `firmware/secrets.yaml`，不要发给 AI 或公开。

设备不会发唤醒或电源开关命令。电视待机时监测暂停而用户意图可保持 ON；重新开机后仍需满足雷达、电视连接和参数健康条件才恢复监测。

实物使用 Waveshare ESP32-C3-Zero-M 和 HLK-LD2410C；YAML 中的 `esp32-c3-devkitm-1` 是当前编译板标识，不表示推荐采购另一块开发板。接线和选购边界见[硬件说明](hardware.md)。雷达是存在与距离传感器，不能识别儿童身份、确保角度或坐姿，不可用于安全防护。请在真实环境独立验证覆盖范围和误触发。macOS、Windows、Linux 教程提供相同操作路径；不同机器的 USB 驱动、权限、Python、无线网络及电视型号需各自实测。
