[English](en/maintenance.md) | [简体中文](maintenance.md)

# 更新、恢复与维护

固件和网页只用于可信局域网。正式版的 ESPHome 原生 OTA 在 ESP32 默认使用 TCP 3232，仓库默认未设置 OTA 密码；网页本身没有固件上传功能。限制网络访问，不要向互联网开放。`radar-observer.yaml` 和 `radar-network-observer.yaml` 没有配置原生 OTA，应通过 USB 更新。所有密钥、本地构建目录及固件二进制都可能包含 Wi-Fi/电视 PSK，不要分享或提交。

## 更新正式固件

下面的 `<设备IP>` 替换成路由器中查到的实际地址；先在仓库根目录激活已安装依赖的虚拟环境。保留 USB 数据线以便网络不可达时恢复。

1. 在设备网页记下自动功能原来的意图 ON/OFF 和已验证参数。先关闭自动功能；等待电视画面恢复，设备详情中「本次恢复责任」为否。若无法确认，先恢复电视并排查连接，不要开始更新，也不要擅自断电视电源。
2. 关闭多余设备网页标签和 SSE 连接，避免连接数耗尽。确认电脑和设备在同一可互通 LAN。
3. 编译后通过原生 OTA 上传：

   ```sh
   python -m esphome compile firmware/tv-trial.yaml
   python -m esphome upload firmware/tv-trial.yaml --device "<设备IP>"
   ```

   `upload` 使用最近一次编译的产物，修改配置后先重新编译。首次 USB 安装、网络故障或 OTA 失败可改用 `--device "<串口>"` USB 上传。不要分享包含 secrets 的命令输出。
4. 等待设备重启并重新连网，重新打开页面；查看参数状态 `ready` 并核对原参数，确认雷达和电视状态正常。只按更新前记录的选择恢复意图 ON 或保持 OFF，然后现场验证功能与画面恢复。上传完成、HTTP 200 或页面出现都不等于运行验证成功。

## 可选 OTA 密码

如需增加认证，在**本机** `firmware/secrets.yaml` 添加自选的 `ota_password`，自行保管；在本机 `firmware/tv-trial.yaml` 的现有 `ota` 配置中添加：

```yaml
ota:
  - platform: esphome
    password: !secret ota_password
```

首次引入或变更密码时，安全起见使用 USB 安装，使板上运行的密码和之后本机配置一致；不要把真实密码写进仓库或聊天。确认后才用 OTA。遗失密码或 OTA 不通时用 USB 恢复。细节见 [ESPHome OTA 官方文档](https://esphome.io/components/ota/esphome/)；密码不替代可信网络隔离。

## 故障与恢复

若设备重启后画面仍关闭，运行内存中的恢复责任不会跨断电保留；用遥控器或网页 `Restore Picture` 恢复（该按钮也关闭意图），检查电视连接与设置。参数失败或不明时监测暂停，先读页面状态，排查雷达接线后重试或恢复默认。若刷写失败，保留现状，核对板型、USB 数据线、端口与 BOOT/RESET，再按[入门步骤](getting-started.md)串口刷写；不要清空闪存作为默认排障手段。

更换 Wi-Fi 或电视 IP/PSK 时，由自己编辑本地 secrets，重新编译并安装；设备不可达时用 USB。定期在不连接设备的环境执行 `python tools/verify_project.py`，可加 `--config` 使用临时示例 secrets 验证配置；检查不能代替硬件实测。
