[English](en/development-ui.md) | [简体中文](development-ui.md)

# 本地 UI 预览

此服务仅绑定本机 `127.0.0.1`，使用内存中的模拟实体，不连接或控制电视、雷达或任何设备，不依赖 ESPHome。根页面从 `firmware/ui/app.js` 和 `firmware/ui/app.css` 提供 `/0.js` 与 `/0.css`；它们由固件 UI 的开发者维护。每次启动重新生成独立数据。

```sh
python3 tools/ui_preview.py status
python3 tools/ui_preview.py start
python3 tools/ui_preview.py status
python3 tools/ui_preview.py stop
```

启动先实际绑定端口 0，命令输出的地址即实际地址；打开该地址查看 UI，在同一地址的 `/_fixture` 页面切换模拟情景。Normal、Near、Far、Standby、Unknown、Unavailable、PictureOff、Expired 和 Offline 均为服务端模拟；Offline 中断 SSE 并使实体 REST 返回 503，控制页仍可恢复。Expired 保持连接但停止事件和心跳，供验证状态超时。Restore Picture 模拟先关闭试用，再短暂等待后恢复画面。仅供 UI 行为验证，不能代表真实设备结果。

**PictureOff**、**HideTransition** 和 **RestoreTransition** 保留当前雷达状态，因此可先选择 Near、Far、Normal 或 Unknown，再模拟电视画面变化；没有雷达目标时不会凭空显示人物。HideTransition 从画面正常开始，经 1.5 秒电视状态不可用后确认息屏；RestoreTransition 反向模拟恢复。**TVUnknown** 保持 SSE 在线而电视状态持续不可用，供检查超过 5 秒的展示；**TVFailure** 模拟明确的电视通信失败。切换场景会使先前过渡定时器失效。它们均为模拟，不向真实设备发命令。可离线运行 `python3 -m unittest discover -s tests -p test_ui_preview_fixture.py` 检查夹具的过渡及取消。

运行登记为 `output/ui-preview-state.json`，含 PID、进程创建时间、项目根目录、模式、实际地址及日志路径；日志在 `output/ui-preview.log`，数据只在进程内。状态和停止命令核验登记对应的 PID、创建时间与进程命令；登记无法核验时保留现场，不按端口猜测停止目标。异常退出后，先检查登记中的 PID 是否已退出或被重用，再手动移除失效登记。启动和状态不自动接管未知进程。主会话负责停止本次启动的实例，日志保留。

如需前台进程可执行 `python3 tools/ui_preview.py serve`，它输出实际地址，Ctrl-C 停止；该单次模式不登记，不由上述 `status`/`stop` 管理。不要同时以相同登记路径运行多个托管实例。

设置面板使用本地 `/settings` 模拟异步应用：依次经历 queued、read_radar、verify_all、save，约 3 秒后提交；应用期间停止实际监测但保留试用意图。若有本次恢复责任，先模拟恢复画面。设置和 revision 仅在成功保存时更新，全部数据随进程退出消失。

在 `/_fixture` 中选择 **SettingsFail** 后，下一次有效设置应用会在验证阶段失败；原值和 revision 保留，可重试或恢复默认。选择 **SettingsConflict** 后，下一次有效提交会模拟其他客户端更新距离和 revision，返回 409；UI 可重新读取服务端值。这两个按钮只设置一次性故障，不切换当前雷达或电视场景。

## 诊断、暂停与校准夹具

`GET /diagnostics` 使用与固件一致的 v1 字段：会话、快照/测量序号、运行时间、配置版本、门限、目标类别距离及有效性、健康与原因、电视/恢复责任、剩余暂停时间、外部恢复等待和最近事件。快照约缓存 1 秒，所有客户端共用每秒一次的接受额度；过密请求返回 HTTP 429、`retry_after_ms: 1000` 和 `Retry-After: 1`。最多保留 12 条内存事件。未知、无人或过期不输出伪造距离；Expired 保留旧测量时间且报告不新鲜，Offline 返回 503。这些快照不是完整雷达录制。

模拟按钮路由 `Pause 10 Minutes`、`Pause 30 Minutes`、`Resume Monitoring` 对应首页的暂停/继续操作。暂停保留开启意图，模拟恢复本次负责的画面，不唤醒待机电视；真实单调时钟控制到期。**ExternalRestore** 保留雷达场景并模拟外部恢复画面与等待离开近区；继续只结束定时暂停。Python 测试使用可控时钟验证到期、旧定时器失效和长运行时间，HTTP 测试用本地服务器检查端点和限流；它们不是浏览器渲染或真实设备测试。

浏览器检查应覆盖：首页真实场景说明与近距/靠近确认，明确的「恢复画面并停用」，设置「关闭」的继续编辑/放弃修改分支与默认收起的高级设置。调试仅在打开且前台时通过同一串行队列轮询，关闭/后台取消请求，429 退避，不新增 SSE。引导校准先关闭自动息屏，依次 Near、Far、Far（静坐）、Normal（无人），每步记录 3–30 次快照；只汇总，不自动应用参数。模拟静坐步骤不能证明真实雷达能检测静止目标。

可选真实浏览器脚本（从项目根目录运行，需可由 Node 导入的 Playwright，以及 `/usr/bin/chromium`）：

```sh
node firmware/ui/mobile.browser.cjs
```

脚本自行启动独立的前台 `serve` 夹具并在结束时停止，不接管上述托管实例；输出截图与连续浏览器录像到 `output/mobile-qa/`。它独立于默认无浏览器验证，不代表已运行成功。检查实际退出结果、截图和录像；浏览器录像需转换为可直接播放的 MP4 后再作为 MP4 交付，不能将稀疏截图拼接称为连续录屏。视口尺寸只是响应式测试样本，不是对某款 iPhone 分辨率的断言。当前新增功能的浏览器截图、连续 MP4、Safari/iPhone 与实机验证，均应以本轮实际产生的证据分别报告，不沿用以下历史记录。

## 历史验证记录（此前版本）

2026-10-29 使用已有 Chrome / Playwright 检查了 402×874、320×700 和 1280×900 视口，以及初次 SSE 延迟/失败、连续未知的固定 5 秒期限、短暂未知与原始控件权限、800 毫秒跑动和早期反转、动态减少动画、设置/详情/刷新。无 JavaScript 页面异常；预览服务未提供 favicon 的 404 不影响应用。真实时间演示来自连续录屏。参考小板 OTA 后参数和功能选择保留，电视仍待机；没有把模拟场景当作真实近距或 iPhone 验证。
