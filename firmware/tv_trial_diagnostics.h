#pragma once
#include "tv_trial_controller.h"
#include "tv_trial_radar_protocol.h"
#include <array>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace tv_trial {
constexpr size_t DIAGNOSTICS_MAX_BYTES=4096;
constexpr size_t DIAGNOSTICS_EVENT_CAPACITY=12;
struct DiagnosticsEvent {
  uint32_t sequence{0};
  uint64_t at_ms{0};
  char type[16]{}, detail[64]{};
};
struct DiagnosticsSnapshot {
  char session_id[17]{}, reason[96]{};
  uint32_t sequence{0}, sample_sequence{0}, config_revision{0}, snooze_remaining_ms{0};
  uint64_t uptime_ms{0}, sample_at_ms{0};
  uint16_t near_threshold_cm{150}, release_threshold_cm{170}, moving_cm{0}, still_cm{0};
  bool moving_valid{false}, still_valid{false}, wifi_connected{false}, radar_fresh{false};
  bool measurement_known{false}, tv_fresh{false}, settings_ready{false};
  bool audit_pending{false}, audit_failed{false}, intent_enabled{false}, monitoring{false};
  bool owns_picture_off{false}, external_override{false};
  ScenePresence zone{ScenePresence::Unavailable};
  Power power{Power::Unknown};
  Mode mode{Mode::Unknown};
  std::array<DiagnosticsEvent,DIAGNOSTICS_EVENT_CAPACITY> events{};
  size_t event_count{0};
  uint32_t events_dropped{0};
};
inline const char *diagnostics_zone(ScenePresence zone) {
  switch(zone) {
    case ScenePresence::Near: return "near";
    case ScenePresence::Far: return "far";
    case ScenePresence::Absent: return "absent";
    case ScenePresence::Unknown: return "unknown";
    default: return "unavailable";
  }
}
inline const char *diagnostics_mode(Mode mode) {
  switch(mode) {
    case Mode::Normal: return "normal";
    case Mode::Low: return "low";
    case Mode::High: return "high";
    case Mode::PictureOff: return "picture_off";
    default: return "unknown";
  }
}
class DiagnosticsUptime {
 public:
  uint64_t update(uint32_t now) { total_+=static_cast<uint32_t>(now-last_); last_=now; return total_; }
 private:
  uint32_t last_{0};
  uint64_t total_{0};
};
class DiagnosticsHistory {
 public:
  void append(uint64_t now, const char *type, const char *detail) {
    auto &event=events_[next_];
    event={}; event.sequence=++sequence_; event.at_ms=now;
    std::snprintf(event.type,sizeof(event.type),"%s",type);
    std::snprintf(event.detail,sizeof(event.detail),"%s",detail);
    next_=(next_+1)%events_.size();
    if(size_<events_.size()) ++size_; else ++dropped_;
  }
  void copy_to(DiagnosticsSnapshot &snapshot) const {
    snapshot.event_count=size_; snapshot.events_dropped=dropped_;
    const auto first=(next_+events_.size()-size_)%events_.size();
    for(size_t i=0;i<size_;++i) snapshot.events[i]=events_[(first+i)%events_.size()];
  }
 private:
  std::array<DiagnosticsEvent,DIAGNOSTICS_EVENT_CAPACITY> events_{};
  size_t next_{0}, size_{0};
  uint32_t sequence_{0}, dropped_{0};
};
// Caller serializes acquire/release. This is global per endpoint, not per client.
class DiagnosticsAdmission {
 public:
  enum class Result : uint8_t { Accepted, RateLimited, Busy };
  Result acquire(uint32_t now) {
    if(busy_) return Result::Busy;
    if(seen_ && now-last_<1000) return Result::RateLimited;
    seen_=true; busy_=true; last_=now; return Result::Accepted;
  }
  void release() { busy_=false; }
 private:
  uint32_t last_{0};
  bool seen_{false}, busy_{false};
};

// Fixed-buffer writer; an overflow clears the output rather than publishing a
// partial success. No heap JSON document, radar work or controller calls here.
class DiagnosticsJsonWriter {
 public:
  DiagnosticsJsonWriter(char *out,size_t capacity): out_(out),capacity_(capacity) {
    if(capacity_) out_[0]='\0';
  }
  void append(const char *format,...) {
    if(!ok_ || used_>=capacity_) { ok_=false; return; }
    va_list args; va_start(args,format);
    const int count=std::vsnprintf(out_+used_,capacity_-used_,format,args);
    va_end(args);
    if(count<0 || static_cast<size_t>(count)>=capacity_-used_) { ok_=false; return; }
    used_+=static_cast<size_t>(count);
  }
  void string(const char *value,size_t bound) {
    append("\"");
    for(size_t i=0;i<bound && value[i];++i) {
      const auto c=static_cast<unsigned char>(value[i]);
      if(c=='"' || c=='\\') append("\\%c",c);
      else if(c=='\n') append("\\n");
      else if(c=='\r') append("\\r");
      else if(c=='\t') append("\\t");
      else if(c<0x20) append("\\u%04x",static_cast<unsigned>(c));
      else append("%c",c);
    }
    append("\"");
  }
  bool finish() { if(!ok_ && capacity_) out_[0]='\0'; return ok_; }
 private:
  char *out_;
  size_t capacity_,used_{0};
  bool ok_{true};
};
inline bool diagnostics_json(const DiagnosticsSnapshot &s,char *out,size_t capacity) {
  DiagnosticsJsonWriter json(out,capacity);
  const auto boolean=[](bool v) { return v?"true":"false"; };
  const bool moving=s.radar_fresh && s.moving_valid && s.moving_cm>0;
  const bool still=s.radar_fresh && s.still_valid && s.still_cm>0;
  json.append("{\"schema_version\":1,\"session_id\":"); json.string(s.session_id,sizeof(s.session_id));
  json.append(",\"sequence\":%lu,\"uptime_ms\":%llu,\"sample_sequence\":%lu,\"sample_at_ms\":%llu,"
    "\"config_revision\":%lu,\"near_threshold_cm\":%u,\"release_threshold_cm\":%u,\"zone\":\"%s\",\"distance\":{\"moving_cm\":",
    static_cast<unsigned long>(s.sequence),static_cast<unsigned long long>(s.uptime_ms),
    static_cast<unsigned long>(s.sample_sequence),static_cast<unsigned long long>(s.sample_at_ms),
    static_cast<unsigned long>(s.config_revision),static_cast<unsigned>(s.near_threshold_cm),static_cast<unsigned>(s.release_threshold_cm),
    diagnostics_zone(s.radar_fresh?s.zone:ScenePresence::Unavailable));
  if(moving) json.append("%u",static_cast<unsigned>(s.moving_cm)); else json.append("null");
  json.append(",\"still_cm\":");
  if(still) json.append("%u",static_cast<unsigned>(s.still_cm)); else json.append("null");
  json.append(",\"moving_valid\":%s,\"still_valid\":%s},\"health\":{\"wifi_connected\":%s,\"radar_fresh\":%s,"
    "\"measurement_known\":%s,\"tv_fresh\":%s,\"settings_ready\":%s,\"parameter_audit\":\"%s\"},"
    "\"intent_enabled\":%s,\"monitoring\":%s,\"reason\":",
    boolean(moving),boolean(still),boolean(s.wifi_connected),boolean(s.radar_fresh),
    boolean(s.radar_fresh && s.measurement_known),boolean(s.tv_fresh),boolean(s.settings_ready),
    s.audit_failed?"failed":s.audit_pending?"pending":"idle",boolean(s.intent_enabled),boolean(s.monitoring));
  json.string(s.reason,sizeof(s.reason));
  json.append(",\"tv\":{\"power\":\"%s\",\"mode\":\"%s\",\"owns_picture_off\":%s},\"snooze_remaining_ms\":%lu,"
    "\"external_override\":%s,\"recent_events\":[",
    !s.tv_fresh?"unknown":s.power==Power::Active?"active":s.power==Power::Standby?"standby":"unknown",
    diagnostics_mode(s.tv_fresh?s.mode:Mode::Unknown),boolean(s.owns_picture_off),
    static_cast<unsigned long>(s.snooze_remaining_ms),boolean(s.external_override));
  for(size_t i=0;i<s.event_count && i<s.events.size();++i) {
    const auto &e=s.events[i];
    json.append("%s{\"sequence\":%lu,\"at_ms\":%llu,\"type\":",i?",":"",
      static_cast<unsigned long>(e.sequence),static_cast<unsigned long long>(e.at_ms));
    json.string(e.type,sizeof(e.type)); json.append(",\"detail\":"); json.string(e.detail,sizeof(e.detail)); json.append("}");
  }
  json.append("],\"events_dropped\":%lu}",static_cast<unsigned long>(s.events_dropped));
  return json.finish();
}
class DiagnosticsEndpoint {
 public:
  virtual ~DiagnosticsEndpoint()=default;
  virtual void diagnostics_snapshot(DiagnosticsSnapshot &out)=0;
};
}  // namespace tv_trial
