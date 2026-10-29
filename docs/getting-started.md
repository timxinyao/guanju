# 从零安装与首次烧录

本教程适用于接好 ESP32-C3 和 LD2410C 的新设备。先按[硬件说明](hardware.md)核对供电、针脚和安装方向；本文不替代现场安全判断。电视控制目前只实现 Sony BRAVIA 的特定 IP 接口，先读[兼容性](compatibility.md)。如果想让 AI 协助，请同时看 [AI 协助教程](ai-assisted-setup.md)。

## 1. 准备电脑和网络

- macOS、Windows 或 Linux 电脑；安装 Python 3.12–3.14，推荐 3.13，以及 Git。首次安装依赖和编译需要互联网；编译完成后的设备在局域网运行，不要求电脑常开或外网。
- USB-C **数据线**连接开发板。ESP32-C3 原生 USB 不默认使用 CH340；如果你的具体板子另有 USB 转串口芯片，按其型号处理驱动。电脑需要串口权限。
- 家里的 2.4 GHz Wi-Fi 名称和密码；ESP32-C3 不能连接 5 GHz Wi-Fi。电视和开发板应位于能互相访问的可信局域网，关闭访客网络的客户端隔离。
- Sony 电视打开适用的远程/IP 控制，自己设置预共享密钥 PSK 并查到电视的局域网 IP。菜单名称随型号和系统不同，参考[兼容性](compatibility.md)。

克隆或下载仓库，在终端切到仓库根目录（即能看到 `firmware`、`requirements.txt` 的目录）。macOS/Linux 使用：

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell 使用：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

若未安装 3.13，可用已安装的 3.12 或 3.14 创建虚拟环境。PowerShell 禁止脚本时，可按本机策略处理，或用命令提示符执行 `.venv\Scripts\activate.bat`。以后每次打开新终端都要先激活此环境。`requirements.txt` 固定 ESPHome 版本；首次不要加 `--offline`，需要下载工具链。有关命令参见 [ESPHome CLI 官方文档](https://esphome.io/guides/cli/)。

## 2. 私下填写配置

复制模板（以下命令在 macOS、Linux 和 Windows 的已激活环境均可用）：

```sh
python -c "from pathlib import Path; p=Path('firmware/secrets.yaml'); p.write_text(Path('firmware/secrets.example.yaml').read_text(encoding='utf-8'), encoding='utf-8') if not p.exists() else print('secrets.yaml already exists; unchanged')"
```

用本地文本编辑器打开 `firmware/secrets.yaml`，分别填写 `home_wifi_ssid`、`home_wifi_password`、`radar_ap_password`、`sony_tv_host`、`sony_tv_psk`。备用热点密码至少 8 个字符；电视 IP 写地址本身，不带 `http://`。使用 YAML 字符串，含引号或反斜线的值需按 YAML 规则转义。不要把秘密发到 AI 聊天、截图或提交；构建产物、固件和配置展开输出也可能含密钥，不要分享。`secrets.example.yaml` 只是占位示例。

## 3. 找串口，先观察雷达

先不插板，运行一次；插入数据线后再运行一次，比较新增端口：

```sh
python -m serial.tools.list_ports
```

macOS 常见 `/dev/cu.usbmodem...`，Linux 常见 `/dev/ttyACM...`，Windows 常见 `COM...`；具体以实际枚举为准。下面的 `<串口>` 是占位符，替换为自己的端口并保留引号。找不到时换数据线/USB 口，检查系统设备列表、Linux 串口组权限及板子的 BOOT/RESET 操作；不要猜测针脚。

先编译不联网、不控制电视的观察版：

```sh
python -m esphome config firmware/radar-observer.yaml
python -m esphome compile firmware/radar-observer.yaml
```

微雪 ESP32-C3-Zero-M 没有 USB 转 UART 桥接芯片。烧录前先断开 USB 数据线，按住板上 BOOT（GPIO9）再连接数据线，进入下载模式后松开 BOOT；如果数据线已经连接，也可按住 BOOT，再按一下 RESET，进入下载模式后松开 BOOT。参见[微雪官方板卡说明](https://docs.waveshare.com/ESP32-C3-Zero)。再次运行 `python -m serial.tools.list_ports`，确认下载模式下的实际端口，再替换 `<串口>` 并上传：

```sh
python -m esphome upload firmware/radar-observer.yaml --device "<串口>"
```

上传后若板子停留在下载模式，松开 BOOT 并按一下 RESET 运行固件。端口可能变化，再次列出端口并确认后查看日志；不需要清空闪存：

```sh
python -m serial.tools.list_ports
python -m esphome logs firmware/radar-observer.yaml --device "<串口>"
```

人物移动、静止和离开时观察目标及距离变化；退出日志按 Ctrl+C。若没有变化，先排查接线、供电和安装方向，见[使用说明](usage.md)。不要把残留距离当作当前有人。观察符合预期后，用同样方式编译、USB 上传 `firmware/radar-network-observer.yaml`；此版本连接 Wi-Fi 并提供观察页面，仍不控制电视。它没有配置原生 OTA；进入正式版前继续用 USB。

## 4. 联网并安装正式版

在路由器已连接设备列表找 `tv-radar` 的 IP，也可在支持 mDNS 的网络试 `http://tv-radar.local/`。用手机或电脑在同一局域网访问 `http://<设备IP>/`。若出现受密码保护的 `TV-Radar-Setup` 备用热点，说明家庭 Wi-Fi 未连上；它不是家庭 Wi-Fi 已连接的证明，也不是配网门户。检查 2.4 GHz、密码、信号和隔离设置，再修改本地 secrets 并重新编译/USB 烧录。

确认雷达和 Wi-Fi 后，在 USB 仍连接时安装正式版：

```sh
python -m esphome config firmware/tv-trial.yaml
python -m esphome compile firmware/tv-trial.yaml
python -m esphome upload firmware/tv-trial.yaml --device "<串口>"
python -m esphome logs firmware/tv-trial.yaml --device "<串口>"
```

`config` 可能展开秘密，请勿分享输出。等待启动及参数验证，在设备网页查看电视连接、雷达数据和参数状态，按[使用说明](usage.md)现场校准。正式版才配置 ESPHome 原生 OTA（ESP32 默认 TCP 3232）；后续更新见[维护说明](maintenance.md)。网页固件上传未启用，也没有 Home Assistant 原生 API 或 Wi-Fi 配网门户。

仓库无需连接设备的检查为 `python tools/verify_project.py`；加 `--config` 会在临时副本使用示例 secrets 验证三个配置，不输出密钥，但仍需先安装依赖。该检查还需要 Node.js（CI 使用 22）、C++ 编译器和 `sh`；Windows 可在配置好 Python、Node 和 C++ 编译器的 Git Bash 等环境运行，或参考 CI 使用 Linux。此检查不能证明接线、电视或无线网络实测通过。
