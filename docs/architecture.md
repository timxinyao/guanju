# 架构与接口

ESP32-C3 运行 ESPHome，LD2410C 经 GPIO20/21 的硬件 UART 提供雷达数据；USB Serial/JTAG 用于日志和首次烧录。主循环解析雷达、协调参数和控制器状态。独立的串行 TV RPC worker 负责 HTTP 请求，控制器状态由主循环管理，避免阻塞串口及并发修改状态。Sony 请求发到 `/sony/system`，使用 `X-Auth-PSK`；只查询电源与省电模式、设置省电模式，不执行唤醒/电源操作。

控制器区分用户意图、健康状态与本次息屏恢复责任：意图由 ESPHome preference 独立保存，雷达及电视状态过期、待机或参数未验证时暂停；恢复责任只在 RAM，重启丢失。`Restore Picture` 会关闭意图并请求恢复。参数验证后的单个配置 blob 存在 NVS `tv_trial` 命名空间 `settings_v1`，与意图、Wi-Fi 数据分开。

## 设置与网页

`GET /settings` 返回 `revision`、`status`、`phase`、已保存 `settings`，事务中还可能有 `pending` 和错误。`POST /settings` 使用 `expected_revision` 和完整设置（或 `action: defaults`），仅接受合法范围且空闲、版本匹配的请求；冲突时应重新读取。提交返回 `202 Accepted` 后，设备先处理画面恢复，再向雷达写入并回读各阶段，全部匹配且数据新鲜并完成 NVS 保存后才变为 `ready`、更新版本。失败或未确认时监测暂停，不能将 HTTP 200 当成设置完成。

网页从设备提供 CSS/JS，消费 `/events` 的 SSE 原始实体名称（例如 `binary_sensor/Radar Data Fresh`），结合心跳、新鲜度和设置派生展示。雷达波纹只反映数据新鲜在线，不说明自动监测生效；近/远/无人图为示意。右上刷新执行整个页面 reload。设备提供三个 PNG 图标路由：`/apple-touch-icon.png`、`/apple-touch-icon-v1.png` 和 `/apple-touch-icon-precomposed.png`。已有主屏幕图标可能缓存，需移除重加。

正式 YAML 配置原生 ESPHome OTA，未启用网页 OTA、Home Assistant 原生 API 或配网门户。观察版和联网观察版不控制电视，具体阶段及命令见[入门](getting-started.md)。实现细节以 `firmware/tv_trial_runtime.h`、`tv_trial_controller.h`、`tv_trial_settings*.h` 和 `firmware/ui/` 为准。
