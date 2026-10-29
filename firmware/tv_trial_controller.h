#pragma once
#include <cstdint>

namespace tv_trial {
enum class Power : uint8_t { Unknown, Active, Standby };
enum class Mode : uint8_t { Unknown, Normal, Low, High, PictureOff };
enum class RpcKind : uint8_t { None, Query, Hide, Restore };
enum class Outcome : uint8_t { Success, Rejected, Uncertain };
struct Request { RpcKind kind{RpcKind::None}; uint32_t token{0}; Mode mode{Mode::Normal}; };
class Controller {
 public:
  static constexpr uint32_t NEAR_MS = 3000;
  static constexpr uint32_t AWAY_MS = 1000;
  static constexpr uint32_t RADAR_FRESH_MS = 2500;
  static constexpr uint32_t TV_FRESH_MS = 5000;
  static constexpr uint32_t SNAPSHOT_MAX_AGE_MS = 2000;
  static constexpr uint32_t POLL_MS = 1000;
  static constexpr uint32_t VERIFY_MS = 500;

  void set_link(bool connected, uint32_t now) {
    if (link_ != connected) ++connection_epoch_;
    link_ = connected;
    if (!connected) {
      tv_valid_ = false;
      pause_("ON; paused: Wi-Fi unavailable");
    }
    tick_(now);
  }

  void set_radar_ready(bool ready, uint32_t now) {
    radar_ready_ = ready;
    if (!ready) pause_("ON; paused: radar range not verified");
    tick_(now);
  }

  void radar_frame(uint32_t now, bool present, bool measurement_known = true) {
    // A late frame must not conceal an interruption between loop() calls.
    if (radar_seen_ && elapsed_(now, radar_at_) > RADAR_FRESH_MS) {
      pause_("ON; paused: radar data expired");
      interval_valid_ = false;
    }
    if (!measurement_known) pause_("ON; paused: radar measurement unknown");
    if (!interval_valid_ || !radar_seen_ || present != present_) {
      interval_at_ = now;
      interval_valid_ = true;
    }
    radar_measurement_known_ = measurement_known;
    present_ = measurement_known && present;
    radar_at_ = now;
    radar_seen_ = true;
  }

  void set_enabled(bool enable, uint32_t now) {
    if (enabled_ != enable) {
      monitoring_ = false;
      interval_valid_ = false;
    }
    // This is user intent. ESPHome may restore it before Wi-Fi, radar or TV
    // setup; lack of current health must never overwrite the saved choice.
    enabled_ = enable;
    if (!enable) {
      if (owned_) restore_pending_ = true;
    }
    tick_(now);
  }

  void request_restore(uint32_t now) {
    set_enabled(false, now);
    manual_restore_ = true;
    restore_pending_ = true;
    force_query_ = true;
    reason_ = "Manual restore requested";
  }

  Request next(uint32_t now) {
    tick_(now);
    // Do not abandon an outstanding request even after its deadline. The
    // adapter must finish it before another RPC can start (including recovery).
    if (in_flight_.kind != RpcKind::None || !link_) return {};
    const bool verifying = verify_ != RpcKind::None;
    const bool verify_due = verifying && elapsed_(now, command_at_) >= VERIFY_MS;
    const bool poll_due = !query_seen_ || elapsed_(now, query_at_) >= POLL_MS;
    if (force_query_ || (verify_due && !verification_queried_) || poll_due) {
      force_query_ = false;
      query_seen_ = true;
      query_at_ = now;
      return start_(RpcKind::Query, now, Mode::Normal);
    }
    if (!tv_fresh(now) || power_ != Power::Active) return {};
    // A setter's ACK cannot authorize another setter before a fresh readback.
    if (verifying && !verification_queried_) return {};
    if (restore_pending_ && (owned_ || manual_restore_) &&
        (verify_ != RpcKind::Restore || elapsed_(now, command_at_) >= POLL_MS)) {
      return start_(RpcKind::Restore, now, owned_ ? restore_mode_ : Mode::Normal);
    }
    if (verify_ != RpcKind::None) return {};
    if (owned_) {
      if (effective(now) && interval_valid_ && !present_ &&
          elapsed_(now, interval_at_) >= away_ms_) {
        restore_pending_ = true;
        return start_(RpcKind::Restore, now, restore_mode_);
      }
      return {};
    }
    if (effective(now) && interval_valid_ && present_ &&
        elapsed_(now, interval_at_) >= near_ms_ && visible_(mode_)) {
      // Acquire potential ownership BEFORE dispatch. An HTTP timeout can mean
      // pictureOff was executed; that responsibility survives the failure.
      owned_ = true;
      confirmed_owned_ = false;
      restore_mode_ = mode_;
      return start_(RpcKind::Hide, now, Mode::PictureOff);
    }
    return {};
  }

  void complete_query(uint32_t token, uint32_t now, Power power, Mode mode,
                      uint32_t observed_at) {
    if (!matches_(token, RpcKind::Query)) return;
    if (query_epoch_ != connection_epoch_ || elapsed_(now, observed_at) > SNAPSHOT_MAX_AGE_MS || power == Power::Unknown ||
        (power == Power::Active && mode == Mode::Unknown)) {
      fail_query(token, now);
      return;
    }
    in_flight_ = {};
    // Space ordinary polls from completion. Counting from dispatch starves
    // setters when an otherwise valid query takes longer than POLL_MS.
    query_at_ = now;
    tv_valid_ = true;
    tv_at_ = observed_at;
    power_ = power;
    mode_ = mode;
    if (power == Power::Standby) {
      clear_ownership_(now);
      tick_(now);
      return;
    }
    if (verify_ != RpcKind::None && elapsed_(now, command_at_) >= VERIFY_MS)
      verification_queried_ = true;
    if (verify_ == RpcKind::Restore && verification_queried_ && visible_(mode)) {
      clear_ownership_(now);
      reason_ = enabled_ ? "Picture restored; Trial ON" : "Picture restored; Trial OFF";
    } else if (owned_ && verify_ == RpcKind::Hide && verification_queried_) {
      if (mode == Mode::PictureOff) {
        confirmed_owned_ = true;
        verify_ = RpcKind::None;
        reason_ = restore_pending_ ? "Recovery pending" : "Picture OFF by this trial";
      } else if (elapsed_(now, command_at_) >= 3000) {
        // A successful HTTP reply without the expected readback is not success.
        // Retain potential ownership and send an idempotent compensating restore.
        pause_("ON; hide not confirmed; recovery pending");
      }
    } else if (confirmed_owned_ && visible_(mode) && !restore_pending_) {
      clear_ownership_(now);
      reason_ = "Picture changed externally; confirming near zone again";
    }
    tick_(now);
  }

  void fail_query(uint32_t token, uint32_t now) {
    if (!matches_(token, RpcKind::Query)) return;
    in_flight_ = {};
    tv_valid_ = false;
    query_at_ = now;
    pause_("ON; paused: TV communication failed");
  }

  void complete_command(uint32_t token, uint32_t now, Outcome outcome) {
    if (in_flight_.token != token || (in_flight_.kind != RpcKind::Hide &&
                                    in_flight_.kind != RpcKind::Restore)) return;
    const RpcKind kind = in_flight_.kind;
    in_flight_ = {};
    command_at_ = now;
    verify_ = kind;
    verification_queried_ = false;
    // No snapshot taken before a setter can verify that setter.
    tv_valid_ = false;
    query_at_ = now;
    if (kind == RpcKind::Hide && outcome == Outcome::Rejected) {
      clear_ownership_(now);
      pause_("ON; paused: TV rejected pictureOff");
    } else if (outcome != Outcome::Success) {
      pause_("ON; command uncertain / failed; recovery pending");
    }
    if (!enabled_ && owned_) restore_pending_ = true;
  }

  bool enabled() const { return enabled_; }  // Persisted user intent, not health.
  bool configure_timing(uint32_t near_ms, uint32_t clear_ms, uint32_t now) {
    if (near_ms<1000 || near_ms>5000 || near_ms%1000!=0 || (clear_ms!=1000 && clear_ms!=2000)) return false;
    near_ms_=near_ms; away_ms_=clear_ms;
    monitoring_=false; interval_valid_=false;
    tick_(now); return true;
  }
  void invalidate_radar_measurement(uint32_t now) {
    radar_measurement_known_=false;
    pause_("ON; paused: waiting for radar after settings");
    tick_(now);
  }
  bool effective(uint32_t now) const {
    return monitoring_ && healthy_(now) && power_ == Power::Active;
  }
  // Includes an unconfirmed setter which may have reached the TV.
  bool owns_picture() const { return owned_; }
  bool radar_fresh(uint32_t now) const {
    return radar_ready_ && radar_seen_ && elapsed_(now, radar_at_) <= RADAR_FRESH_MS;
  }
  bool tv_fresh(uint32_t now) const {
    return link_ && tv_valid_ && elapsed_(now, tv_at_) <= TV_FRESH_MS;
  }
  bool present() const { return present_; }
  bool radar_measurement_known() const { return radar_measurement_known_; }
  Power power() const { return power_; }
  Mode mode() const { return mode_; }
  const char *status() const { return reason_; }

 private:
  static uint32_t elapsed_(uint32_t now, uint32_t then) { return now - then; }
  static bool visible_(Mode mode) {
    return mode == Mode::Normal || mode == Mode::Low || mode == Mode::High;
  }
  bool healthy_(uint32_t now) const {
    return link_ && radar_fresh(now) && radar_measurement_known_ && tv_fresh(now);
  }
  bool matches_(uint32_t token, RpcKind kind) const {
    return in_flight_.kind == kind && in_flight_.token == token;
  }
  void pause_(const char *reason) {
    if (enabled_ || owned_ || manual_restore_) reason_ = reason;
    monitoring_ = false;
    interval_valid_ = false;
    if (owned_ || manual_restore_) restore_pending_ = true;
  }
  void tick_(uint32_t now) {
    if (enabled_) {
      if (!radar_fresh(now)) pause_("ON; paused: radar unavailable");
      else if (!radar_measurement_known_) pause_("ON; paused: radar measurement unknown");
      else if (!link_) pause_("ON; paused: Wi-Fi unavailable");
      // A setter deliberately invalidates the old TV snapshot until readback.
      else if (verify_ == RpcKind::None && !tv_fresh(now)) pause_("ON; paused: TV status expired");
    }
    const bool stalled = in_flight_.kind != RpcKind::None && elapsed_(now, request_at_) > 6000;
    if (stalled) pause_("ON; RPC stalled; waiting without parallel request");
    const bool can_monitor = enabled_ && healthy_(now) && power_ == Power::Active &&
      verify_ == RpcKind::None && !restore_pending_ && !manual_restore_ && !stalled;
    if (can_monitor && !monitoring_) {
      // Standby, unknown data and recovery never count toward the next 3 s.
      interval_at_ = now;
      interval_valid_ = radar_seen_;
    }
    monitoring_ = can_monitor;
    if (!enabled_) reason_ = (owned_ || manual_restore_) ? "OFF; picture recovery pending" : "Trial OFF";
    else if (can_monitor) reason_ = owned_ ? "ON; picture OFF by this trial" : "ON; monitoring near zone";
    else if (tv_fresh(now) && power_ == Power::Standby) reason_ = "ON; paused: TV standby (will not wake)";
    else if (restore_pending_) reason_ = "ON; paused: picture recovery pending";
    else if (verify_ != RpcKind::None) reason_ = "ON; checking picture command";
  }
  Request start_(RpcKind kind, uint32_t now, Mode mode) {
    ++sequence_;
    if (sequence_ == 0) ++sequence_;
    request_at_ = now;
    if (kind == RpcKind::Query) query_epoch_ = connection_epoch_;
    in_flight_ = {kind, sequence_, mode};
    return in_flight_;
  }
  void clear_ownership_(uint32_t now) {
    owned_ = false;
    confirmed_owned_ = false;
    restore_pending_ = false;
    manual_restore_ = false;
    verify_ = RpcKind::None;
    verification_queried_ = false;
    interval_at_ = now;
    interval_valid_ = radar_seen_;
    monitoring_ = false;
  }

  bool enabled_{false}, link_{false}, radar_ready_{false}, radar_seen_{false};
  bool monitoring_{false};
  bool radar_measurement_known_{false};
  bool present_{false}, interval_valid_{false}, tv_valid_{false}, query_seen_{false};
  bool owned_{false}, confirmed_owned_{false}, restore_pending_{false}, manual_restore_{false};
  bool force_query_{false}, verification_queried_{false};
  uint32_t radar_at_{0}, interval_at_{0}, tv_at_{0}, query_at_{0};
  uint32_t command_at_{0}, request_at_{0}, sequence_{0};
  uint32_t connection_epoch_{0}, query_epoch_{0};
  uint32_t near_ms_{NEAR_MS},away_ms_{AWAY_MS};
  Power power_{Power::Unknown};
  Mode mode_{Mode::Unknown}, restore_mode_{Mode::Normal};
  RpcKind verify_{RpcKind::None};
  Request in_flight_{};
  const char *reason_{"Trial OFF"};
};
}  // namespace tv_trial
