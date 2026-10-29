[English](en/development-ui.md) | [简体中文](development-ui.md)

# 本地 UI 预览

此服务仅绑定本机 `127.0.0.1`，使用内存中的模拟实体，不连接或控制电视、雷达或任何设备，不依赖 ESPHome。根页面从 `firmware/ui/app.js` 和 `firmware/ui/app.css` 提供 `/0.js` 与 `/0.css`；它们由固件 UI 的开发者维护。每次启动重新生成独立数据。

```sh
python3 tools/ui_preview.py status
python3 tools/ui_preview.py start
python3 tools/ui_preview.py status
python3 tools/ui_preview.py stop
```

启动先实际绑定端口 0，命令输出的地址即实际地址；打开该地址查看 UI，在同一地址的 `/_fixture` 页面切换模拟情景。Normal、Near、Standby、Unknown、Unavailable、PictureOff、Expired 和 Offline 均为服务端模拟；Offline 中断 SSE 并使实体 REST 返回 503，控制页仍可恢复。Expired 保持连接但停止事件和心跳，供验证状态超时。Restore Picture 模拟先关闭试用，再短暂等待后恢复画面。仅供 UI 行为验证，不能代表真实设备结果。

运行登记为 `output/ui-preview-state.json`，含 PID、进程创建时间、项目根目录、模式、实际地址及日志路径；日志在 `output/ui-preview.log`，数据只在进程内。状态和停止命令核验登记对应的 PID、创建时间与进程命令；登记无法核验时保留现场，不按端口猜测停止目标。异常退出后，先检查登记中的 PID 是否已退出或被重用，再手动移除失效登记。启动和状态不自动接管未知进程。主会话负责停止本次启动的实例，日志保留。

如需前台进程可执行 `python3 tools/ui_preview.py serve`，它输出实际地址，Ctrl-C 停止；该单次模式不登记，不由上述 `status`/`stop` 管理。不要同时以相同登记路径运行多个托管实例。

设置面板使用本地 `/settings` 模拟异步应用：依次经历 queued、read_radar、verify_all、save，约 3 秒后提交；应用期间停止实际监测但保留试用意图。若有本次恢复责任，先模拟恢复画面。设置和 revision 仅在成功保存时更新，全部数据随进程退出消失。

在 `/_fixture` 中选择 **SettingsFail** 后，下一次有效设置应用会在验证阶段失败；原值和 revision 保留，可重试或恢复默认。选择 **SettingsConflict** 后，下一次有效提交会模拟其他客户端更新距离和 revision，返回 409；UI 可重新读取服务端值。这两个按钮只设置一次性故障，不切换当前雷达或电视场景。
