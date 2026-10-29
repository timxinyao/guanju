[English](diagnostics.md) | [简体中文](../diagnostics.md)

# Local diagnostics and agent collection

Open **设备详情** (device details) to inspect approximate distances and guided calibration. Closing details or backgrounding the page stops its extra diagnostic polling. Calibration is advice only: it does not identify children, map positions, automatically apply settings or establish TV/RF reliability.

`GET /diagnostics` is an optional, **read-only, unauthenticated trusted-LAN endpoint**. It contains no Wi-Fi password, TV PSK or raw UART bytes. It nevertheless describes activity in the room: collect with the household's permission, keep files local and redact them before sharing. Do not expose the board to the internet or add port forwarding. This feature does not change existing OTA credentials or security settings; see [maintenance](maintenance.md).

## Bounded work on the board

- The main loop updates a cached snapshot about once per second. HTTP only copies that bounded snapshot and formats it into a fixed buffer; it never operates the radar or controller.
- One accepted diagnostic request per second **globally**, shared by phone pages and agents, not one allowance per client. Use one collector and close device details in other pages during collection.
- One handler-owned response buffer; no response queue or extra SSE connection. The response is smaller than 4,096 bytes, uses `Cache-Control: no-store` and requests connection close. The existing HTTP server still owns socket timeouts and its total connection pool.
- Concurrent/busy or too-frequent requests return **429**, `Retry-After: 1`, and `{"error":"rate_limited","retry_after_ms":1000}` (or `error: "busy"`). Wait at least that long; back off further on recurring errors. A formatting overflow returns 503 rather than truncated success JSON.
- Only the last **12 transition events** live in RAM. Old events are overwritten; no per-frame flash writes. Event details may be truncated. Reboot starts a new session and loses history.
- These limits apply to `/diagnostics`, **not every existing ESPHome route**. They are resource safeguards, not an internet-facing denial-of-service defense.

## Schema version 1

| Field | Meaning |
| --- | --- |
| `schema_version` | `1`; reject an unsupported version rather than guessing. |
| `session_id` | Random 16-character runtime session ID, not a stable device identity or credential. |
| `sequence`, `uptime_ms` | Cached snapshot sequence and device uptime at publication. Uptime is extended across the 32-bit timer wrap. |
| `sample_sequence`, `sample_at_ms` | Latest accepted periodic radar-frame sequence and its device-uptime timestamp; zero before a frame. A new snapshot does not imply a new radar sample. |
| `config_revision` | Last fully verified and saved settings revision. |
| `near_threshold_cm`, `release_threshold_cm` | Entry threshold and hysteresis release threshold (`D + 20 cm`); the margin is provisional, not a medical recommendation. |
| `zone` | `near`, `far`, `absent`, `unknown` or `unavailable`; unknown/stale is not absence. |
| `distance` | `moving_cm`, `still_cm`, `moving_valid`, `still_valid`. A category's distance is `null` if absent, invalid or stale. Values are approximate radar readings, not person coordinates. |
| `health` | Booleans `wifi_connected`, `radar_fresh`, `measurement_known`, `tv_fresh`, `settings_ready`; `parameter_audit` is `idle`, `pending` or `failed`. |
| `intent_enabled`, `monitoring`, `reason` | Saved user intent, effective monitoring and human-readable controller reason. Reason wording is not a stable machine enum. |
| `tv` | `power`: `active`, `standby`, `unknown`; `mode`: `normal`, `low`, `high`, `picture_off`, `unknown`; `owns_picture_off`: this runtime's restoration responsibility, including an uncertain command. Stale TV observations are unknown. |
| `snooze_remaining_ms`, `external_override` | Remaining temporary pause and courtesy pause after an externally restored picture. Neither means user intent was disabled. |
| `recent_events` | Oldest to newest retained `{sequence,at_ms,type,detail}` entries. Types include `boot`, `zone`, `state`, `settings`, `audit`, `command`. Command acknowledgement is **not** successful TV readback. |
| `events_dropped` | Number overwritten from the fixed event ring in this session; not a count of every missed radar frame or short transition. |

Snapshot, sample and event sequences are unsigned 32-bit counters and may wrap. Session ID changes require resetting comparison/deduplication state. Timestamps are device uptime, not UTC; record a computer reception timestamp when wall-clock correlation is needed. All values can lag the current state by a snapshot interval and network delay: do not use this observation interface as an additional control loop.

## Small sequential collection example

Run on a computer on the same trusted LAN. Replace the example host with the device's verified address. This takes at most 60 sequential snapshots, normally two seconds apart, writing only successful snapshots to a local JSONL file. It opens no SSE stream, never sends a control command and exits after the bounded observation window. With device details closed, 429 should be unusual.

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

This is **snapshot collection, not lossless recording or full radar replay**. Faster target changes and overwritten events can be missed; identical sample sequences mean no new frame. Do not infer absence from a missing request, `null`, unknown or an unchanged snapshot. Compare runs with the same configuration revision, record known near/far/still/empty-room actions separately, and propose changes for the owner to review. Replaying these coarse snapshots on a computer can compare presentation/summary behavior but cannot prove a new control algorithm safe; that needs suitable timestamped test traces and real on-site validation.

## Audit failures and pauses

After settings are verified, the runtime requests a fresh complete parameter/resolution readback every 30 seconds. **Both response sequences must advance within 3 seconds**; one retry uses fresh sequence baselines. If the second deadline expires, settings enter `parameter_audit_timeout`, monitoring pauses and only this session's owned picture is recovered when the TV is reachable. Continuing target frames alone do not keep configuration trusted. A late reply does not silently clear this error: fix the cause and explicitly reapply settings to complete full verification and persistence.

Existing ESPHome button endpoints also expose `Pause 10 Minutes`, `Pause 30 Minutes` and `Resume Monitoring` under `/button/<URL-encoded name>/press` with POST. These are **controls, not read-only diagnostic routes**; an agent collecting data must not invoke them without permission. Pausing preserves ON intent and restores only owned picture. Resume/expiry begins normal health-gated confirmation, never wakes the TV, never enables an OFF intent and does not defeat the external-restore courtesy pause.
