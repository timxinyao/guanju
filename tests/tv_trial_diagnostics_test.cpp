#include "../firmware/tv_trial_parameter_audit.h"
#include "../firmware/tv_trial_diagnostics.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
using namespace tv_trial;

// A repeating cached readback must not keep monitoring trusted indefinitely.
void audit_requires_both_new_sequences_and_times_out() {
  ParameterAudit audit;
  audit.verified(100,4,8);
  assert(audit.next(30099,4,8)==AuditAction::None);
  assert(audit.next(30100,4,8)==AuditAction::ReadAll);
  assert(audit.pending());
  assert(audit.next(30200,5,8)==AuditAction::None);
  assert(audit.next(33100,5,8)==AuditAction::ReadAll);
  // Retry establishes a new baseline; a partial reply from attempt one cannot
  // be combined with a partial reply from attempt two to pass the audit.
  assert(audit.next(33200,5,9)==AuditAction::None);
  assert(audit.next(36100,5,9)==AuditAction::Failed);
  assert(audit.failed());
  assert(audit.next(36200,6,10)==AuditAction::Failed);
  audit.verified(37000,6,10);
  assert(!audit.failed() && !audit.pending());
}
void audit_success_and_wraparound() {
  ParameterAudit audit;
  const uint32_t start=UINT32_MAX-1000;
  audit.verified(start,UINT32_MAX,UINT32_MAX);
  assert(audit.next(start+30000,UINT32_MAX,UINT32_MAX)==AuditAction::ReadAll);
  assert(audit.next(start+30100,0,0)==AuditAction::None);
  assert(!audit.pending() && !audit.failed());
  assert(audit.next(start+60100,0,0)==AuditAction::ReadAll);
}


void admission_is_global_single_flight_and_wrap_safe() {
  DiagnosticsAdmission gate;
  assert(gate.acquire(100)==DiagnosticsAdmission::Result::Accepted);
  assert(gate.acquire(1100)==DiagnosticsAdmission::Result::Busy);
  gate.release();
  assert(gate.acquire(1099)==DiagnosticsAdmission::Result::RateLimited);
  assert(gate.acquire(1100)==DiagnosticsAdmission::Result::Accepted);
  gate.release();
  DiagnosticsAdmission wrap;
  assert(wrap.acquire(UINT32_MAX-500)==DiagnosticsAdmission::Result::Accepted);
  wrap.release();
  assert(wrap.acquire(498)==DiagnosticsAdmission::Result::RateLimited);
  assert(wrap.acquire(499)==DiagnosticsAdmission::Result::Accepted);
}
void history_retains_only_recent_bounded_events_in_order() {
  DiagnosticsHistory history;
  for(unsigned i=0;i<40;++i) history.append(i*100,"zone",i%2?"near":"far");
  DiagnosticsSnapshot view;
  history.copy_to(view);
  assert(view.event_count==12 && view.events_dropped==28);
  assert(view.events[0].sequence==29 && view.events[0].at_ms==2800);
  assert(view.events[11].sequence==40 && view.events[11].at_ms==3900);
}
void json_nulls_invalid_or_stale_categories_and_escapes_text() {
  DiagnosticsSnapshot view;
  std::strcpy(view.session_id,"0123456789abcdef");
  std::strcpy(view.reason,"paused \"near\"\n");
  view.uptime_ms=4294967300ULL;
  view.moving_valid=true; view.moving_cm=123;
  view.still_valid=false; view.still_cm=999;
  view.radar_fresh=true; view.measurement_known=true;
  char json[DIAGNOSTICS_MAX_BYTES];
  assert(diagnostics_json(view,json,sizeof(json)));
  const std::string text=json;
  assert(text.find("\"schema_version\":1")!=std::string::npos);
  assert(text.find("\"uptime_ms\":4294967300")!=std::string::npos);
  assert(text.find("\"moving_cm\":123")!=std::string::npos);
  assert(text.find("\"still_cm\":null")!=std::string::npos);
  assert(text.find("paused \\\"near\\\"\\n")!=std::string::npos);
  view.radar_fresh=false;
  assert(diagnostics_json(view,json,sizeof(json)));
  assert(std::string(json).find("\"moving_cm\":null")!=std::string::npos);
  assert(std::string(json).find("\"moving_valid\":false")!=std::string::npos);
  char tiny[32];
  assert(!diagnostics_json(view,tiny,sizeof(tiny)));
  assert(tiny[0]=='\0'); // Never send a truncated JSON success.
}
void maximum_normal_snapshot_is_bounded_and_uptime_survives_wrap() {
  DiagnosticsHistory history;
  const std::string detail(63,'x'), type(15,'x');
  for(unsigned i=0;i<12;++i) history.append(UINT64_MAX,type.c_str(),detail.c_str());
  DiagnosticsSnapshot view; history.copy_to(view);
  std::memset(view.reason,'x',sizeof(view.reason)-1);
  std::memset(view.session_id,'a',sizeof(view.session_id)-1);
  view.uptime_ms=UINT64_MAX; view.sample_at_ms=UINT64_MAX;
  view.sequence=UINT32_MAX; view.sample_sequence=UINT32_MAX; view.config_revision=UINT32_MAX;
  char json[DIAGNOSTICS_MAX_BYTES];
  assert(diagnostics_json(view,json,sizeof(json)));
  assert(std::strlen(json)<4096);
  DiagnosticsUptime uptime;
  assert(uptime.update(UINT32_MAX-3)==UINT32_MAX-3ULL);
  assert(uptime.update(5)==4294967301ULL);
}

int main() {
  audit_requires_both_new_sequences_and_times_out();
  audit_success_and_wraparound();
  admission_is_global_single_flight_and_wrap_safe();
  history_retains_only_recent_bounded_events_in_order();
  json_nulls_invalid_or_stale_categories_and_escapes_text();
  maximum_normal_snapshot_is_bounded_and_uptime_survives_wrap();
  std::cout << "diagnostics tests passed\n";
}
