# CleanYourTV · 观距：AI 协作入口

本项目是 ESPHome/ESP-IDF 固件与设备托管网页：LD2410C 雷达 → ESP32-C3 → Sony BRAVIA IP 控制。先读 [README](README.md)、[架构](docs/architecture.md) 和相关教程，再修改代码。

## 结构与验证

- `firmware/tv-trial.yaml`：生产入口；两个 observer 配置用于分阶段排查。
- `firmware/tv_trial_*.h`：判定、参数事务、存储、HTTP 和运行时；`firmware/ui/`：无外网依赖的原生 JS/CSS。
- `tools/verify_project.py --config`：完整无设备验证；`requirements.txt` 固定 ESPHome。开发需 Python、Node、POSIX sh、C++17 编译器，详见 README。
- `tools/ui_preview.py` 的服务启停、模式隔离和运行登记按 [本地预览说明](docs/development-ui.md) 操作。
- 修改图标后运行 `python tools/embed_app_icon.py firmware/ui/apple-touch-icon.png firmware/tv_trial_app_icon_data.h`，保持嵌入头一致。

## 必须保持的边界

- 不读取、回显、提交或发布用户的 `firmware/secrets.yaml`、真实配置日志、个人固件、闪存备份；仅使用示例秘密做无设备验证。
- USB/OTA 会改变真实硬件；没有用户授权不烧录、不改 Wi-Fi、不修改电视状态。操作前辨认目标，不能猜针脚或串口。
- 程序不唤醒电视。用户 intent 与实际 Monitoring 分离；待机/故障保留意图。只自动恢复本次负责的息屏，所有权仅 RAM，不在重启后认领其他来源的 pictureOff。
- 硬件 gate 8 仅用于远区观察；自动息屏必须经过有效目标对应的软件近距阈值与确认时间。Unknown/过期不等于无人；无目标时忽略残留距离。
- 参数提交不是应用成功：先暂停/恢复自身画面，串行写入、完整读回、持久化成功后才推进 revision；失败保持暂停，不能半套配置继续息屏。
- HTTP 回调只通过有界快照/队列交接，不能跨线程直接操作 UART/控制器，不能保存栈 request 指针。保留超时、旧连接/旧响应保护。
- 网页不依赖 CDN；状态必须来自设备。人物不代表儿童识别，波纹仅表示雷达在线探测。右上刷新整页重载，自动恢复连接只同步状态。
- 优先小改，保留他人修改；改变行为时补有意义的断言并同步文档。交付说明实际验证及未验证项，不能把模拟、编译或 HTTP 200 当实机成功。

## 接手真实设备

按 [AI 安装指南](docs/ai-assisted-setup.md) 和 [维护说明](docs/maintenance.md) 分阶段进行。记录可脱敏的型号、串口、版本、状态、配置 revision 与结果；不要把凭据写进提示词或交接。
