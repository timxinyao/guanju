[English](README.md) | **简体中文**

<p align="center"><img src="firmware/ui/apple-touch-icon.png" width="96" alt="观距图标"></p>

# Guanju · 观距

**靠近自动息屏，退远恢复画面。** 用一块 ESP32-C3 和毫米波雷达，给支持 IP 控制的 Sony BRAVIA 电视加上距离提醒；手机可在局域网里查看状态、调参数。

这是独立的雷达距离助手项目。控制逻辑、中文网页和参数存储都运行在 ESP32 上。完成配置后，给小板持续供电即可，不需要电脑、Codex、Home Assistant 或云服务常驻。

设备网页目前为中文；上方语言链接切换仓库介绍，各教程顶部可切换对应语言。

<p align="center"><img src="docs/assets/app-home.jpg" width="300" alt="观距手机网页：距离状态、功能开关及参数入口"></p>

[开始制作](docs/getting-started.md) · [硬件与接线](docs/hardware.md) · [让 AI 协助安装](docs/ai-assisted-setup.md) · [电视兼容性](docs/compatibility.md) · [MIT 许可](LICENSE)

## 它能做什么

- 有效目标在近区持续达到确认时间后，关闭电视画面；离开近区后恢复本次关闭的画面，不关闭电视电源。
- 功能开关保存你的选择：电视待机时暂停，开机后按选择继续；程序不主动开机或唤醒电视。
- 手机中文网页，一屏首页、状态示意、参数面板、恢复默认和手动恢复画面。可添加到 iPhone 主屏幕；实体刷新按钮重新加载整个网页。
- 距离、靠近确认、无人延时、恢复确认和三档灵敏度可调；写入雷达、完整读回并保存成功后才生效。
- 首次 USB 烧录，之后可通过同一局域网的 Wi-Fi 更新。网页资源和图标嵌入固件，不依赖 CDN。

**兼容边界：** 当前实现仅适配 Sony BRAVIA 的 `/sony/system` IP 控制接口。是否可用取决于电视型号、接口和权限；不等于所有 Sony 电视已验证，其他品牌尚未适配。先看[兼容性](docs/compatibility.md)，再买硬件。

**检测边界：** 雷达提供目标状态和辅助距离，不识别儿童身份、左右坐标或坐姿。超近盲区、边缘、静止、多目标和环境干扰会影响检测。人物与波纹只是状态示意；这是 DIY 距离提醒项目，不能代替看护或视力保护措施。

## 需要买什么

| 物品 | 本项目使用的型号/要求 | 数量 |
| --- | --- | --- |
| 毫米波雷达 | 海凌科 **HLK-LD2410C**，确认排针已焊接 | 1 |
| 控制板 | 微雪 **ESP32-C3-Zero-M**，`-M` 为带排针版本 | 1 |
| 连接线 | 母对母杜邦线 | 4 根 |
| USB 线 | USB-C **数据线**，仅充电线不能首烧 | 1 |
| 电源 | 稳定的 5V USB 电源 | 1 |
| 外壳/固定 | 非金属塑料盒、绝缘固定材料 | 按需 |

采购入口、替代型号注意事项、电源与针脚核对见[硬件文档](docs/hardware.md)；不需要 3D 打印机，现成塑料盒即可，见[装盒与安装](docs/enclosure.md)。

## 接线总览

**先断开 USB 电源，再接线；按丝印名称核对，不按颜色或针脚顺序猜。**

| LD2410C | ESP32-C3-Zero-M |
| --- | --- |
| VCC | 5V |
| GND | GND |
| TX | GPIO20 / RX |
| RX | GPIO21 / TX |
| OUT | 留空 |

<img src="docs/assets/wiring-guide.png" width="650" alt="LD2410C 与 ESP32-C3-Zero-M 逻辑接线图：5V、GND、TX 到 GPIO20、RX 到 GPIO21，OUT 留空">

上图是逻辑连接关系，**不是实物排针位置图**。两板正反面、排针方向和通电检查见[完整接线步骤](docs/hardware.md)。

## 从零做到能用

1. [确认电视接口](docs/compatibility.md)，准备硬件并按图断电接线。
2. [准备电脑环境](docs/getting-started.md)：Python 3.12–3.14，推荐 3.13，安装固定版本 ESPHome。
3. 复制 `firmware/secrets.example.yaml` 为本机 `firmware/secrets.yaml`，填写自己的 **2.4GHz Wi-Fi**、备用热点密码、电视地址和 PSK。此文件不进入 Git，也不要贴进 AI 聊天或 Issue。
4. 按教程选择正确 USB 串口，先观察雷达，再编译/烧录 `firmware/tv-trial.yaml`。
5. 手机连同一局域网，打开 `http://tv-radar.local/`；无法解析时用路由器或 USB 日志查到的设备 IP。
6. 保持功能关闭，先核对雷达、电视状态和参数，再开功能做近处、退远及沙发左右的现场校准。
7. 需要改程序时按[维护与 Wi-Fi 更新](docs/maintenance.md)操作，不需要一直连着电脑。

第一次用开发板或想让 Codex、Claude Code、Cursor 等协助？从[AI 安装指南](docs/ai-assisted-setup.md)复制分阶段提示词，让 agent 读取仓库和列出串口；你在本机填写秘密，它通过本机工具协助编译和烧录。

## 默认参数

| 参数 | 默认值 | 可调范围 |
| --- | --- | --- |
| 软件近距门限 | 1.5 米 | 0.5–3.0 米，步长 0.1 米 |
| 靠近确认 | 3 秒 | 1–5 秒 |
| 雷达无人延时 | 1 秒 | 1 或 2 秒 |
| 程序恢复确认 | 1 秒 | 1 或 2 秒 |
| 灵敏度 | 标准 | 低 / 标准 / 高 |

无人延时与恢复确认会叠加，另有网络、轮询和电视执行时间，不能承诺故障时也在固定秒数内恢复。雷达的名义约 6 米观察范围用于区分远处目标与无人，**不等于 6 米内都会息屏**。详情见[日常使用与校准](docs/usage.md)。

## 文档导航

| 你想做什么 | 从这里开始 |
| --- | --- |
| 买齐硬件、核对型号和针脚 | [硬件采购与接线](docs/hardware.md) |
| 装盒、固定在电视旁 | [外壳与安装](docs/enclosure.md) |
| 安装依赖、首次 USB 烧录、连接 Wi-Fi | [从零安装](docs/getting-started.md) |
| 让 Codex 或其他 agent 协助 | [AI 协作安装](docs/ai-assisted-setup.md) |
| 调距离、灵敏度、添加 iPhone 图标 | [使用与校准](docs/usage.md) |
| Wi-Fi OTA、回退、故障排查 | [维护说明](docs/maintenance.md) |
| 确认电视是否适配 | [兼容性](docs/compatibility.md) |
| 理解状态机、线程和 API | [架构](docs/architecture.md) |
| 在电脑上预览网页 | [本地 UI 预览](docs/development-ui.md) |
| 贡献代码 | [贡献指南](CONTRIBUTING.zh-CN.md) |
| 作为 AI 接手项目 | [AGENTS.md](AGENTS.md) |
| 接手创建 GitHub 仓库与首次推送 | [发布交接](docs/publishing.md) |

## 开发验证

```sh
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python tools/verify_project.py --config
```

验证还需要 Node.js 22、POSIX `sh` 和支持 C++17/ASan/UBSan 的编译器；Windows 全量开发检查建议用 WSL2，首次 USB 烧录可按教程在 Windows 原生环境操作。命令在本机运行，不接触电视或刷写设备；`--config` 在临时副本中使用示例密钥，不覆盖你的私有配置。CI 采用相同检查；当前线上 CI 状态需在仓库发布后确认。

## 网络、许可与项目状态

网页/REST 和默认原生 OTA 无认证，仅限可信局域网，**不要暴露到公网**。可选 OTA 密码、秘密与构建产物处理见 [SECURITY.md](SECURITY.zh-CN.md)。编译后的个人固件含网络与电视凭据，仓库不提供此类二进制下载。

项目源代码、文档和自制图示采用 [MIT](LICENSE)。ESPHome、ESP-IDF 等第三方组件保留各自许可证；分发完整固件时须同时考虑这些组件，见[第三方说明](THIRD_PARTY_NOTICES.zh-CN.md)。

本项目来自实际 ESP32-C3-Zero-M、LD2410C 和 Sony 电视的个人试用，持续整理为可复刻方案；不将个别实机结果当成所有电视、网络与安装位置的保证。已验证与未验证范围见 [CHANGELOG.md](CHANGELOG.zh-CN.md)。
