[English](en/architecture.md) | [简体中文](architecture.md)

# 架构与接口

ESP32-C3 运行 ESPHome，LD2410C 经 GPIO20/21 的硬件 UART 提供雷达数据；USB Serial/JTAG 用于日志和首次烧录。主循环解析雷达、协调参数和控制器状态。独立的串行 TV RPC worker 负责 HTTP 请求，控制器状态由主循环管理，避免阻塞串口及并发修改状态。Sony 请求发到 `/sony/system`，使用 `X-Auth-PSK`；只查询电源与省电模式、设置省电模式，不执行唤醒/电源操作。

控制器区分用户意图、健康状态与本次息屏恢复责任：意图由 ESPHome preference 独立保存，雷达及电视状态过期、待机或参数未验证时暂停；恢复责任只在 RAM，重启丢失。`Restore Picture` 会关闭意图并请求恢复。参数验证后的单个配置 blob 存在 NVS `tv_trial` 命名空间 `settings_v1`，与意图、Wi-Fi 数据分开。

## 设置与网页

`GET /settings` 返回 `revision`、`status`、`phase`、已保存 `settings`，事务中还可能有 `pending` 和错误。`POST /settings` 使用 `expected_revision` 和完整设置（或 `action: defaults`），仅接受合法范围且空闲、版本匹配的请求；冲突时应重新读取。提交返回 `202 Accepted` 后，设备先处理画面恢复，再向雷达写入并回读各阶段，全部匹配且数据新鲜并完成 NVS 保存后才变为 `ready`、更新版本。失败或未确认时监测暂停，不能将 HTTP 200 当成设置完成。

网页从设备提供 CSS/JS，消费 `/events` 的 SSE 原始实体名称（例如 `binary_sensor/Radar Data Fresh`），结合心跳、新鲜度和设置派生展示。首页与详情共享前台串行诊断轮询；仅新鲜、可判定的同一快照及有效目标类别距离驱动人物，未知或过期不推断为无人。距离投影、扒柜和坐姿仅为示意，不改变控制逻辑。雷达波纹只反映诊断中的雷达数据新鲜，不说明自动监测生效。右上刷新执行整个页面 reload。设备提供三个 PNG 图标路由：`/apple-touch-icon.png`、`/apple-touch-icon-v1.png` 和 `/apple-touch-icon-precomposed.png`。已有主屏幕图标可能缓存，需移除重加。

正式 YAML 配置原生 ESPHome OTA，未启用网页 OTA、Home Assistant 原生 API 或配网门户。观察版和联网观察版不控制电视，具体阶段及命令见[入门](getting-started.md)。实现细节以 `firmware/tv_trial_runtime.h`、`tv_trial_controller.h`、`tv_trial_settings*.h` 和 `firmware/ui/` 为准。

## 有界诊断与周期验证

`GET /diagnostics` 提供主循环缓存、带版本的只读快照，不开放原始 UART。HTTP 在短锁内复制固定 POD 快照，锁外使用 handler 唯一固定缓冲格式化。全局每秒一次准入、单个在途响应与 4,096 字节缓冲限制额外诊断负担。12 条 RAM 环形记录保存观察到的状态/区域/设置/审计变化及设置电视画面的请求/结果，不逐帧写 flash，不保证无损回放；日常电视查询不填充事件队列。完整 schema、429 退避及电脑侧采集见[本地诊断](diagnostics.md)。

运行时每 30 秒审计硬件参数。每次要求参数和分辨率响应序号均在请求后的 3 秒内前进；一次有界重试会重新建立基线，目标周期帧不能替代参数读回。重试失败以 `parameter_audit_timeout` 暂停监测，直到显式设置事务成功。现有控制器保留 ON 意图，并在可达时只恢复本次负责的画面。临时暂停 10/30 分钟和恢复使用现有 ESPHome 按钮路由，不增加 RPC worker、SSE 连接或持久化计时器。
