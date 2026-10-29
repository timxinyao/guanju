#pragma once
#include "tv_trial_radar_protocol.h"
#include <array>
#include <cstdint>
#include <cstring>
#include <string>

namespace tv_trial {
enum class Sensitivity : uint8_t { Low, Standard, High };
struct Settings {
  uint16_t distance_cm{150}, near_ms{3000};
  uint8_t radar_timeout_s{1};
  uint16_t clear_ms{1000};
  Sensitivity sensitivity{Sensitivity::Standard};
  bool valid() const {
    return distance_cm>=50 && distance_cm<=300 && (distance_cm-50)%10==0 &&
      near_ms>=1000 && near_ms<=5000 && near_ms%1000==0 &&
      radar_timeout_s>=1 && radar_timeout_s<=2 &&
      (clear_ms==1000 || clear_ms==2000) && static_cast<uint8_t>(sensitivity)<=2;
  }
  uint8_t gate() const {
    // Observe the factory nominal 6 m area for Far/Absent. Automatic
    // pictureOff still uses only the configured software distance_cm.
    return 8;
  }
  RadarParameters radar_target() const {
    RadarParameters p{gate(),gate(),radar_timeout_s,
      {50,50,40,30,20,15,15,15,15},{0,0,40,40,30,30,20,20,20}};
    const auto adjust=[this](uint8_t x) -> uint8_t {
      if (x==0 || sensitivity==Sensitivity::Standard) return x;
      if (sensitivity==Sensitivity::Low) return static_cast<uint8_t>(x>90?100:x+10);
      return static_cast<uint8_t>(x<=10?1:x-10);
    };
    for (auto &x:p.move) x=adjust(x);
    for (auto &x:p.still) x=adjust(x);
    return p;
  }
  bool operator==(const Settings &o) const {
    return distance_cm==o.distance_cm && near_ms==o.near_ms && radar_timeout_s==o.radar_timeout_s &&
      clear_ms==o.clear_ms && sensitivity==o.sensitivity;
  }
};
enum class SettingsStatus : uint8_t { Ready, Applying, Error };
struct SettingsView {
  uint32_t revision{0};
  SettingsStatus status{SettingsStatus::Applying};
  const char *phase{"boot_reconcile"};
  Settings settings{}, pending{};
  bool has_pending{true};
  const char *error{nullptr};
};
enum class SettingsSubmitResult : uint8_t { Accepted, Busy, RevisionConflict, Invalid };
struct SettingsSubmitResponse { SettingsSubmitResult result{SettingsSubmitResult::Invalid}; SettingsView view{}; };
class SettingsEndpoint {
 public:
  virtual ~SettingsEndpoint() = default;
  virtual SettingsView settings_snapshot() = 0;
  virtual SettingsSubmitResponse submit_settings(uint32_t expected_revision, const Settings &settings) = 0;
};
// Callers serialize these methods with one short lock. No controller, UART,
// persistence, allocation or HTTP response is touched inside that lock.
class SettingsMailbox {
 public:
  SettingsView snapshot() const { return view_; }
  SettingsSubmitResponse submit(uint32_t expected, const Settings &value) {
    auto result=SettingsSubmitResult::Accepted;
    if (!value.valid() || view_.revision==UINT32_MAX) result=SettingsSubmitResult::Invalid;
    else if (view_.status==SettingsStatus::Applying) result=SettingsSubmitResult::Busy;
    else if (expected!=view_.revision) result=SettingsSubmitResult::RevisionConflict;
    if (result==SettingsSubmitResult::Accepted) {
      ++operation_; if (operation_==0) ++operation_;
      queued_=true; candidate_=value;
      view_.status=SettingsStatus::Applying; view_.phase="queued";
      view_.pending=value; view_.has_pending=true; view_.error=nullptr;
    }
    return {result,view_};
  }
  bool take(Settings &value, uint32_t &operation) {
    if (!queued_) return false;
    value=candidate_; operation=operation_; queued_=false; return true;
  }
  void publish(uint32_t operation, const SettingsView &view) {
    if (operation==operation_ && !queued_) view_=view;
  }
 private:
  SettingsView view_{};
  Settings candidate_{};
  uint32_t operation_{0};
  bool queued_{false};
};
struct SettingsAck { uint32_t sequence{0}; bool success{false}; };
struct SettingsHardware {
  RadarParameters parameters{};
  uint8_t resolution{0xFF};
  uint32_t parameter_sequence{0}, resolution_sequence{0};
  SettingsAck range_ack{}, gate_ack{}, resolution_ack{};
  bool periodic_fresh{false};
};
enum class SettingsActionKind : uint8_t { None, ReadAll, WriteResolution, WriteRange, WriteGate, Save };
struct SettingsAction { SettingsActionKind kind{SettingsActionKind::None}; uint8_t gate{0}; };
enum class SettingsPhase : uint8_t { Ready, Recover, Read, Resolution, Range, Gate, Verify, Save, Error };
class SettingsTransaction {
 public:
  SettingsTransaction(Settings saved = {}, uint32_t revision = 0) : saved_(saved), revision_(revision) {}
  bool begin(Settings value, uint32_t now, bool boot = false) {
    if (busy() || !value.valid() || (!boot && revision_==UINT32_MAX)) return false;
    pending_=value; boot_=boot; verified_=false; error_=nullptr;
    overall_at_=now; gate_=0; enter_(SettingsPhase::Recover,now);
    return true;
  }
  SettingsAction next(uint32_t now, bool owns_picture, const SettingsHardware &h) {
    if (!busy()) return {};
    uint32_t limit=3000;
    if (phase_==SettingsPhase::Recover) limit=15000;
    else if (phase_==SettingsPhase::Resolution || phase_==SettingsPhase::Range) limit=4000;
    else if (phase_==SettingsPhase::Gate) limit=1500;
    if (now-overall_at_>60000 || now-stage_at_>limit) {
      fail_(phase_==SettingsPhase::Recover?"picture_recovery_timeout":"radar_stage_timeout"); return {};
    }
    if (phase_==SettingsPhase::Recover) {
      if (owns_picture) return {};
      enter_(SettingsPhase::Read,now);
    }
    if (!issued_) return issue_(now,h);
    if (phase_==SettingsPhase::Read) {
      if (h.parameter_sequence<=parameter_base_ || h.resolution_sequence<=resolution_base_) return {};
      if (matches_(h)) enter_(SettingsPhase::Verify,now);
      else enter_(h.resolution==0?SettingsPhase::Range:SettingsPhase::Resolution,now);
      return issue_(now,h);
    }
    if (phase_==SettingsPhase::Resolution || phase_==SettingsPhase::Range || phase_==SettingsPhase::Gate) {
      const auto ack=phase_==SettingsPhase::Gate?h.gate_ack:
        (phase_==SettingsPhase::Range?h.range_ack:h.resolution_ack);
      if (ack.sequence<=ack_base_) return {};
      if (!ack.success) { fail_("radar_write_rejected"); return {}; }
      if (h.parameter_sequence<=parameter_base_) return {};
      if (phase_==SettingsPhase::Resolution) {
        if (h.resolution_sequence<=resolution_base_) return {};
        if (h.resolution!=0) { fail_("resolution_readback_mismatch"); return {}; }
        if (now-stage_at_<1800) return {};
        enter_(SettingsPhase::Range,now);
      } else if (phase_==SettingsPhase::Range) {
        const auto target=pending_.radar_target();
        if (h.parameters.max_move!=target.max_move || h.parameters.max_still!=target.max_still ||
            h.parameters.timeout!=target.timeout) { fail_("range_readback_mismatch"); return {}; }
        if (now-stage_at_<1800) return {};
        gate_=0; enter_(SettingsPhase::Gate,now);
      } else {
        const auto target=pending_.radar_target();
        if (h.parameters.move[gate_]!=target.move[gate_] || h.parameters.still[gate_]!=target.still[gate_]) {
          fail_("gate_readback_mismatch"); return {};
        }
        ++gate_;
        enter_(gate_<9?SettingsPhase::Gate:SettingsPhase::Verify,now);
      }
      return issue_(now,h);
    }
    if (phase_==SettingsPhase::Verify) {
      if (h.parameter_sequence<=parameter_base_ || h.resolution_sequence<=resolution_base_) return {};
      if (!matches_(h)) { fail_("final_readback_mismatch"); return {}; }
      // Boot can deliver parameter ACKs before its first periodic report.
      // Matching parameters wait within the existing stage deadline; stale
      // radar never reaches Save and never marks the transaction ready.
      if (!h.periodic_fresh) return {};
      enter_(SettingsPhase::Save,now);
      return issue_(now,h);
    }
    return {};
  }
  void complete_save(bool success, uint32_t) {
    if (phase_!=SettingsPhase::Save || !issued_) return;
    if (!success) { fail_("persistence_failed"); return; }
    saved_=pending_; if (!boot_) ++revision_;
    phase_=SettingsPhase::Ready; verified_=true;
  }
  bool busy() const { return phase_!=SettingsPhase::Ready && phase_!=SettingsPhase::Error; }
  bool ready() const { return phase_==SettingsPhase::Ready && verified_; }
  SettingsPhase phase() const { return phase_; }
  const Settings &saved() const { return saved_; }
  const Settings &pending() const { return pending_; }
  uint32_t revision() const { return revision_; }
  uint8_t gate_index() const { return gate_; }
  const char *error() const { return error_; }
  void abort(const char *reason) { fail_(reason); }
  uint32_t proposed_revision() const { return revision_+(boot_?0:1); }
 private:
  bool matches_(const SettingsHardware &h) const {
    const auto target=pending_.radar_target();
    return h.resolution==0 && h.parameters.max_move==target.max_move &&
      h.parameters.max_still==target.max_still && h.parameters.timeout==target.timeout &&
      h.parameters.sensitivities_match(target);
  }
  void enter_(SettingsPhase phase,uint32_t now) { phase_=phase; stage_at_=now; issued_=false; }
  void fail_(const char *error) { phase_=SettingsPhase::Error; error_=error; verified_=false; }
  SettingsAction issue_(uint32_t now,const SettingsHardware &h) {
    issued_=true; stage_at_=now;
    parameter_base_=h.parameter_sequence; resolution_base_=h.resolution_sequence;
    switch (phase_) {
      case SettingsPhase::Read: case SettingsPhase::Verify: return {SettingsActionKind::ReadAll,0};
      case SettingsPhase::Resolution: ack_base_=h.resolution_ack.sequence; return {SettingsActionKind::WriteResolution,0};
      case SettingsPhase::Range: ack_base_=h.range_ack.sequence; return {SettingsActionKind::WriteRange,0};
      case SettingsPhase::Gate: ack_base_=h.gate_ack.sequence; return {SettingsActionKind::WriteGate,gate_};
      case SettingsPhase::Save: return {SettingsActionKind::Save,0};
      default: return {};
    }
  }
  Settings saved_{}, pending_{};
  uint32_t revision_{0};
  SettingsPhase phase_{SettingsPhase::Ready};
  bool boot_{false},issued_{false},verified_{false};
  uint32_t overall_at_{0},stage_at_{0},parameter_base_{0},resolution_base_{0},ack_base_{0};
  uint8_t gate_{0};
  const char *error_{nullptr};
};
using SettingsRecord = std::array<uint8_t,20>;
inline uint32_t settings_checksum(const SettingsRecord &b) {
  uint32_t h=2166136261U;
  for (size_t i=0;i<16;++i) h=(h^b[i])*16777619U;
  return h;
}
inline SettingsRecord encode_settings(Settings s, uint32_t revision) {
  SettingsRecord b{'T','V','S','1'};
  for (uint8_t i=0;i<4;++i) b[4+i]=static_cast<uint8_t>(revision>>(i*8));
  b[8]=s.distance_cm&255; b[9]=s.distance_cm>>8; b[10]=s.near_ms&255; b[11]=s.near_ms>>8;
  b[12]=s.radar_timeout_s; b[13]=s.clear_ms&255; b[14]=s.clear_ms>>8; b[15]=static_cast<uint8_t>(s.sensitivity);
  const auto sum=settings_checksum(b);
  for (uint8_t i=0;i<4;++i) b[16+i]=static_cast<uint8_t>(sum>>(i*8));
  return b;
}
inline bool decode_settings(const SettingsRecord &b, Settings &s, uint32_t &revision) {
  if (b[0]!='T'||b[1]!='V'||b[2]!='S'||b[3]!='1') return false;
  uint32_t sum=0,r=0;
  for (uint8_t i=0;i<4;++i) { sum|=static_cast<uint32_t>(b[16+i])<<(i*8); r|=static_cast<uint32_t>(b[4+i])<<(i*8); }
  if (sum!=settings_checksum(b)) return false;
  Settings value;
  value.distance_cm=b[8]|(b[9]<<8); value.near_ms=b[10]|(b[11]<<8); value.radar_timeout_s=b[12];
  value.clear_ms=b[13]|(b[14]<<8); value.sensitivity=static_cast<Sensitivity>(b[15]);
  if (!value.valid()) return false;
  s=value; revision=r; return true;
}
inline bool settings_origin_allowed(const std::string &origin, const std::string &host) {
  if (origin.empty()) return true; // Native clients do not send browser Origin.
  if (host.empty() || host.find_first_of("/@\\?# \r\n\t")!=std::string::npos) return false;
  if (origin.rfind("http://",0)!=0) return false; // This device serves plain HTTP only.
  std::string authority=origin.substr(7), normalized_host=host;
  if (authority.find_first_of("/@\\?# \r\n\t")!=std::string::npos) return false;
  for (auto &c:authority) if(c>='A'&&c<='Z') c=static_cast<char>(c-'A'+'a');
  for (auto &c:normalized_host) if(c>='A'&&c<='Z') c=static_cast<char>(c-'A'+'a');
  const auto normalize=[](std::string &s){ if(s.size()>3&&s.compare(s.size()-3,3,":80")==0) s.resize(s.size()-3); };
  normalize(authority); normalize(normalized_host);
  return authority==normalized_host;
}
}  // namespace tv_trial
