[English](en/diagnostics.md) | [简体中文](diagnostics.md)

# 本地诊断与 agent 采集

打开**设备详情**可查看近似距离与引导校准；首页和详情共享诊断轮询；关闭详情后首页继续使用快照，页面进入后台或连接断开时停止轮询。校准仅提供建议，不识别儿童、不定位人物、不自动应用设置，也不代表电视与射频环境已通过实机验证。

`GET /diagnostics` 是可选、**只读、无认证且仅供可信局域网使用**的接口。不包含 Wi-Fi 密码、电视 PSK 或原始 UART 字节，但会描述房间活动：征得家庭成员同意、在本机保存，分享前脱敏。不要开放互联网访问或设置端口转发。此功能不改变 OTA 凭据或安全设置，参见[维护说明](maintenance.md)。

## 小板上的资源边界

- 主循环约每秒更新一次缓存快照。HTTP 仅复制有界快照并写入固定 JSON 缓冲，不操作雷达或控制器。
- **全局**每秒只接受一次诊断请求，手机与 agent 共用额度，不是每个客户端各一次。只运行一个采集器，采集时关闭其他网页的设备详情。
- handler 仅持有一份响应缓冲，不排队积压响应，不增加 SSE 长连接。响应小于 4,096 字节，带 `Cache-Control: no-store`，请求关闭连接；底层 HTTP 服务仍管理 socket 超时及总连接池。
- 并发忙碌或频率超限返回 **429**、`Retry-After: 1` 和 `{"error":"rate_limited","retry_after_ms":1000}`（或 `error: "busy"`）。至少等待提示时间，持续失败时进一步退避；格式化超限返回 503，不发送截断的成功 JSON。
- RAM 只保留最近 **12 条状态转换事件**。旧记录覆盖，细节文字可能截断，不逐帧写 flash；重启后进入新会话，历史丢失。
- 这些限制只覆盖 `/diagnostics`，**不是所有 ESPHome 路由的全站限流**，也不是互联网抗攻击保护。

## schema_version 1

| 字段 | 含义 |
| --- | --- |
| `schema_version` | `1`；不支持的版本应拒绝解析，不能猜测。 |
| `session_id` | 随机 16 字符运行会话 ID，不是稳定设备标识或凭据。 |
| `sequence`、`uptime_ms` | 缓存快照序号及发布时设备运行毫秒数；运行时间跨 32 位计时器回绕累计。 |
| `sample_sequence`、`sample_at_ms` | 最新有效周期雷达帧序号及其运行时间戳；尚无帧时为零。新快照不代表新雷达帧。 |
| `config_revision` | 最近完整验证并保存的设置版本。 |
| `near_threshold_cm`、`release_threshold_cm` | 进入阈值及滞回退出阈值（`D + 20 cm`）；当前余量为暂定值，不是医学建议。 |
| `zone` | `near`、`far`、`absent`、`unknown`、`unavailable`；未知/过期不是无人。 |
| `distance` | `moving_cm`、`still_cm`、`moving_valid`、`still_valid`。类别不存在、无效或过期时距离为 `null`；数值是雷达近似测距，不是人物坐标。 |
| `health` | 布尔值 `wifi_connected`、`radar_fresh`、`measurement_known`、`tv_fresh`、`settings_ready`；`parameter_audit` 为 `idle`、`pending` 或 `failed`。 |
| `intent_enabled`、`monitoring`、`reason` | 保存的用户意图、实际监测及人可读原因；原因文字不是稳定机器枚举。 |
| `tv` | `power`：`active`、`standby`、`unknown`；`mode`：`normal`、`low`、`high`、`picture_off`、`unknown`；`owns_picture_off` 为本会话的恢复责任（含执行结果不确定的命令）。过期电视状态为未知。 |
| `snooze_remaining_ms`、`external_override` | 临时暂停剩余毫秒数，以及画面被外部恢复后的礼让暂停；均不等于关闭用户意图。 |
| `recent_events` | 从旧到新的 `{sequence,at_ms,type,detail}`。类型包括 `boot`、`zone`、`state`、`settings`、`audit`、`command`；命令 ACK **不等于**电视读回成功。 |
| `events_dropped` | 本会话固定环形队列覆盖的条数，不是所有漏采雷达帧/短暂状态的数量。 |

快照、样本与事件序号是可回绕的无符号 32 位计数。会话 ID 改变时应重置比较/去重状态。时间戳是设备运行时间，不是 UTC；需要对齐现实时间时由电脑另记接收时间。字段可落后一个快照周期及网络延迟，不应把这个观察接口当作额外控制闭环。

## 简单串行采集示例

在同一可信局域网的电脑运行，将示例主机名替换成已确认的设备地址。最多尝试 60 次串行快照，正常每次间隔两秒，只把成功快照追加到本机 JSONL 文件。不打开 SSE，不发控制命令，观察窗口结束后退出。关闭设备详情后通常不应频繁遇到 429。

```sh
DEVICE='http://tv-radar.local'
OUT='guanju-snapshots.jsonl'
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT HUP INT TERM
n=0
while [ "$n" -lt 60 ]; do
  n=$((n + 1))
  code=$(curl --silent --show-error --max-time 3 --max-filesize 4096 \
    --output "$TMP" --write-out '%{http_code}' "$DEVICE/diagnostics") || code=000
  case "$code" in
    200) cat "$TMP" >> "$OUT"; printf '\n' >> "$OUT"; sleep 2 ;;
    429|503) sleep 4 ;;
    *) sleep 5 ;;
  esac
done
```

这是**快照采集，不是无损记录或完整雷达回放**。快速状态变化与被覆盖事件可能遗漏，相同样本序号表示没有新帧。不能把请求失败、`null`、未知或不变快照当作无人。应按相同配置 revision 比较，并单独记录已知的近/远/静止/空房间动作；调整建议由主人审核。电脑上的粗粒度回放可比较展示/摘要逻辑，但不能证明新控制算法安全，后者仍需合适的带时间戳测试轨迹和现场验证。

## 参数审计失败与暂停

设置验证完成后，每 30 秒请求新的完整参数/分辨率读回。**两种响应序号都必须在 3 秒内前进**；允许一次重试，重试重新建立序号基线。第二次期限到达仍不满足时，设置进入 `parameter_audit_timeout`，监测暂停，电视可达时只恢复本会话负责的画面。仅持续收到目标帧不能维持参数可信。迟到响应不会悄悄清除错误：排查原因后显式重新应用设置，完成全部验证和持久化。

现有 ESPHome 按钮还提供 `Pause 10 Minutes`、`Pause 30 Minutes`、`Resume Monitoring`，POST 路径为 `/button/<URL 编码名称>/press`。这是**控制接口，不是只读诊断**；采集 agent 没有许可不得调用。临时暂停保留 ON 意图，只恢复本次负责的画面。恢复/到期后重新进行健康门控确认，不唤醒电视、不打开 OFF 意图，也不绕过外部恢复画面的礼让暂停。
