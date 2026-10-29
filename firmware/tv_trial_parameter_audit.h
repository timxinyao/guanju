#pragma once
#include <cstdint>

namespace tv_trial {
enum class AuditAction : uint8_t { None, ReadAll, Failed };

// Periodic target frames are not configuration verification. Both readback
// sequences must advance after the latest request, within a bounded deadline.
// Failure is sticky until a complete settings transaction verifies again.
class ParameterAudit {
 public:
  static constexpr uint32_t INTERVAL_MS=30000;
  static constexpr uint32_t DEADLINE_MS=3000;
  void verified(uint32_t now, uint32_t parameters, uint32_t resolution) {
    checked_at_=now; parameters_=parameters; resolution_=resolution;
    pending_=false; failed_=false; attempts_=0;
  }
  AuditAction next(uint32_t now, uint32_t parameters, uint32_t resolution) {
    if(failed_) return AuditAction::Failed;
    if(pending_) {
      if(now-requested_at_<DEADLINE_MS && parameters!=parameters_ && resolution!=resolution_) {
        verified(now,parameters,resolution);
        return AuditAction::None;
      }
      if(now-requested_at_<DEADLINE_MS) return AuditAction::None;
      if(attempts_>=2) { pending_=false; failed_=true; return AuditAction::Failed; }
    } else if(now-checked_at_<INTERVAL_MS) return AuditAction::None;
    parameters_=parameters; resolution_=resolution; requested_at_=now;
    pending_=true; ++attempts_;
    return AuditAction::ReadAll;
  }
  bool pending() const { return pending_; }
  bool failed() const { return failed_; }
 private:
  uint32_t checked_at_{0}, requested_at_{0}, parameters_{0}, resolution_{0};
  uint8_t attempts_{0};
  bool pending_{false}, failed_{false};
};
}  // namespace tv_trial
