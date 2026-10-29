#include "../firmware/tv_trial_settings.h"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
using namespace tv_trial;
#define CHECK(c) do { if (!(c)) throw std::runtime_error(std::string(__func__)+":"+std::to_string(__LINE__)+" " #c); } while(false)

SettingsHardware baseline() {
  SettingsHardware h;
  h.parameters = {8,8,1,{50,50,40,30,20,15,15,15,15},{0,0,40,40,30,30,20,20,20}};
  h.resolution = 0;
  h.parameter_sequence = 1;
  h.resolution_sequence = 1;
  h.periodic_fresh = true;
  return h;
}
void fresh_read(SettingsHardware &h) { ++h.parameter_sequence; ++h.resolution_sequence; }

void settings_reject_all_invalid_bounds() {
  Settings s;
  CHECK(s.valid());
  for (uint16_t x : {0,49,51,149,301,65535}) { s.distance_cm=x; CHECK(!s.valid()); }
  s={};
  for (uint16_t x : {0,999,1500,5001,65535}) { s.near_ms=x; CHECK(!s.valid()); }
  s={}; s.radar_timeout_s=0; CHECK(!s.valid()); s.radar_timeout_s=3; CHECK(!s.valid());
  s={}; s.clear_ms=1500; CHECK(!s.valid()); s.clear_ms=3000; CHECK(!s.valid());
  s={}; s.sensitivity=static_cast<Sensitivity>(3); CHECK(!s.valid());
}
void observation_gate_stays_eight_for_all_software_near_distances() {
  Settings s;
  for (const auto &v : std::array<std::array<uint16_t,2>,7>{{{50,2},{150,2},{160,3},{220,3},{230,4},{290,4},{300,4}}}) {
    s.distance_cm=v[0]; CHECK(s.valid()); CHECK(s.gate()==8);
  }
}
void sensitivity_profiles_preserve_zero_and_adjust_nonzero() {
  Settings s;
  auto p=s.radar_target();
  CHECK(p.move==(std::array<uint8_t,9>{50,50,40,30,20,15,15,15,15}));
  CHECK(p.still==(std::array<uint8_t,9>{0,0,40,40,30,30,20,20,20}));
  s.sensitivity=Sensitivity::Low; p=s.radar_target();
  CHECK(p.move==(std::array<uint8_t,9>{60,60,50,40,30,25,25,25,25}));
  CHECK(p.still==(std::array<uint8_t,9>{0,0,50,50,40,40,30,30,30}));
  s.sensitivity=Sensitivity::High; p=s.radar_target();
  CHECK(p.move==(std::array<uint8_t,9>{40,40,30,20,10,5,5,5,5}));
  CHECK(p.still==(std::array<uint8_t,9>{0,0,30,30,20,20,10,10,10}));
}
void apply_waits_for_picture_recovery_and_times_out() {
  SettingsTransaction t;
  CHECK(t.begin({},100));
  CHECK(t.next(100,true,baseline()).kind==SettingsActionKind::None);
  CHECK(t.busy());
  CHECK(t.next(15101,true,baseline()).kind==SettingsActionKind::None);
  CHECK(!t.busy()); CHECK(!t.ready()); CHECK(t.error()!=nullptr);
  CHECK(t.revision()==0);
}
void matching_hardware_still_needs_new_final_read_and_save() {
  SettingsTransaction t;
  auto h=baseline();
  CHECK(t.begin({},100));
  CHECK(t.next(100,false,h).kind==SettingsActionKind::ReadAll);
  CHECK(t.next(200,false,h).kind==SettingsActionKind::None);
  fresh_read(h);
  CHECK(t.next(300,false,h).kind==SettingsActionKind::ReadAll);
  CHECK(t.next(400,false,h).kind==SettingsActionKind::None);
  fresh_read(h);
  CHECK(t.next(500,false,h).kind==SettingsActionKind::Save);
  CHECK(!t.ready()); CHECK(t.revision()==0);
  t.complete_save(true,500);
  CHECK(t.ready()); CHECK(t.revision()==1);
}
void write_nine_gates_and_only_commit_after_complete_verification() {
  Settings desired; desired.distance_cm=300; desired.sensitivity=Sensitivity::High;
  desired.radar_timeout_s=2; desired.near_ms=5000; desired.clear_ms=2000;
  SettingsTransaction t({},4); auto h=baseline();
  CHECK(t.begin(desired,100));
  CHECK(t.next(100,false,h).kind==SettingsActionKind::ReadAll);
  fresh_read(h);
  CHECK(t.next(200,false,h).kind==SettingsActionKind::WriteRange);
  h.parameters.max_move=8; h.parameters.max_still=8; h.parameters.timeout=2;
  ++h.parameter_sequence;
  CHECK(t.next(2100,false,h).kind==SettingsActionKind::None); // matching numbers without ACK are insufficient
  h.range_ack={1,true};
  auto action=t.next(2200,false,h);
  const std::array<uint8_t,9> move{40,40,30,20,10,5,5,5,5};
  const std::array<uint8_t,9> still{0,0,30,30,20,20,10,10,10};
  for (uint8_t i=0;i<9;++i) {
    CHECK(action.kind==SettingsActionKind::WriteGate); CHECK(action.gate==i);
    h.parameters.move[i]=move[i]; h.parameters.still[i]=still[i];
    ++h.parameter_sequence; ++h.gate_ack.sequence; h.gate_ack.success=true;
    action=t.next(2300+i*100,false,h);
  }
  CHECK(action.kind==SettingsActionKind::ReadAll);
  fresh_read(h);
  CHECK(t.next(3300,false,h).kind==SettingsActionKind::Save);
  CHECK(t.saved().distance_cm==150); CHECK(t.revision()==4);
  t.complete_save(true,3300);
  CHECK(t.ready()); CHECK(t.saved()==desired); CHECK(t.revision()==5);
}
void failed_gate_ack_and_partial_write_never_commit() {
  Settings s; s.sensitivity=Sensitivity::High;
  SettingsTransaction t({},7); auto h=baseline();
  CHECK(t.begin(s,100)); t.next(100,false,h); fresh_read(h);
  CHECK(t.next(200,false,h).kind==SettingsActionKind::WriteRange);
  h.range_ack={1,true}; ++h.parameter_sequence;
  CHECK(t.next(2200,false,h).kind==SettingsActionKind::WriteGate);
  h.gate_ack={1,false};
  CHECK(t.next(2300,false,h).kind==SettingsActionKind::None);
  CHECK(!t.ready()); CHECK(!t.busy()); CHECK(t.revision()==7); CHECK(t.saved()==Settings{});
  CHECK(t.begin({},2400)); // explicit retry/defaults is allowed after failure
}
void missing_ack_is_bounded_even_with_matching_readback() {
  Settings s; s.distance_cm=300; s.radar_timeout_s=2;
  SettingsTransaction t; auto h=baseline();
  CHECK(t.begin(s,100)); t.next(100,false,h); fresh_read(h);
  CHECK(t.next(200,false,h).kind==SettingsActionKind::WriteRange);
  h.parameters.max_move=8; h.parameters.max_still=8; h.parameters.timeout=2; ++h.parameter_sequence;
  CHECK(t.next(4201,false,h).kind==SettingsActionKind::None);
  CHECK(!t.busy()); CHECK(!t.ready()); CHECK(t.revision()==0);
}
void final_mismatch_or_stale_radar_never_reaches_save() {
  for (bool stale : {false,true}) {
    SettingsTransaction t; auto h=baseline();
    CHECK(t.begin({},100)); t.next(100,false,h); fresh_read(h); t.next(200,false,h); fresh_read(h);
    if (stale) h.periodic_fresh=false; else h.parameters.still[0]=1;
    CHECK(t.next(300,false,h).kind==SettingsActionKind::None);
    CHECK(!t.ready()); CHECK(t.revision()==0);
    if (stale) {
      CHECK(t.busy()); // Matching boot readback waits for the first periodic frame.
      h.periodic_fresh=true;
      CHECK(t.next(400,false,h).kind==SettingsActionKind::Save);
      t.complete_save(true,400); CHECK(t.ready());
    } else CHECK(!t.busy());
  }
}
void persistence_failure_and_reboot_keep_last_verified_settings() {
  Settings old; old.distance_cm=250; old.near_ms=4000;
  SettingsTransaction t(old,8); auto h=baseline();
  CHECK(t.begin({},100)); t.next(100,false,h); fresh_read(h); t.next(200,false,h); fresh_read(h);
  CHECK(t.next(300,false,h).kind==SettingsActionKind::Save);
  t.complete_save(false,300);
  CHECK(!t.ready()); CHECK(t.saved()==old); CHECK(t.revision()==8);
  SettingsTransaction rebooted(t.saved(),t.revision());
  CHECK(rebooted.begin(rebooted.saved(),1000,true));
  CHECK(!rebooted.ready()); CHECK(rebooted.busy());
}
void boot_reconcile_does_not_increment_saved_revision() {
  SettingsTransaction t({},8); auto h=baseline();
  CHECK(t.begin({},100,true)); t.next(100,false,h); fresh_read(h); t.next(200,false,h); fresh_read(h);
  CHECK(t.next(300,false,h).kind==SettingsActionKind::Save);
  t.complete_save(true,300); CHECK(t.ready()); CHECK(t.revision()==8);
}
void records_reject_corruption_and_unsupported_values() {
  Settings s; s.distance_cm=300; s.sensitivity=Sensitivity::High; s.near_ms=5000;
  auto bytes=encode_settings(s,42); Settings decoded; uint32_t revision=0;
  CHECK(decode_settings(bytes,decoded,revision)); CHECK(decoded==s); CHECK(revision==42);
  for (size_t i=0;i<bytes.size();++i) { auto bad=bytes; bad[i]^=0x80; CHECK(!decode_settings(bad,decoded,revision)); }
  s.distance_cm=49; bytes=encode_settings(s,42); CHECK(!decode_settings(bytes,decoded,revision));
}
void same_origin_accepts_ip_mdns_ports_and_rejects_cross_site() {
  CHECK(settings_origin_allowed("","tv-radar.local"));
  CHECK(settings_origin_allowed("http://192.0.2.20","192.0.2.20"));
  CHECK(settings_origin_allowed("http://tv-radar.local:80","tv-radar.local:80"));
  CHECK(settings_origin_allowed("http://TV-RADAR.local","tv-radar.local"));
  CHECK(!settings_origin_allowed("http://evil.example","tv-radar.local"));
  CHECK(!settings_origin_allowed("http://tv-radar.local.evil.example","tv-radar.local"));
  CHECK(!settings_origin_allowed("http://tv-radar.local@evil.example","tv-radar.local"));
  CHECK(!settings_origin_allowed("null","tv-radar.local"));
  CHECK(!settings_origin_allowed("http://tv-radar.local/path","tv-radar.local"));
}
void mailbox_cas_rejects_overlaps_and_old_revision_without_mixing_fields() {
  SettingsMailbox box;
  SettingsView ready; ready.status=SettingsStatus::Ready; ready.phase="ready";
  ready.revision=4; ready.has_pending=false; box.publish(0,ready);
  Settings first; first.distance_cm=300; first.near_ms=5000;
  Settings second; second.distance_cm=50; second.near_ms=1000;
  CHECK(box.submit(3,first).result==SettingsSubmitResult::RevisionConflict);
  auto result=box.submit(4,first); CHECK(result.result==SettingsSubmitResult::Accepted);
  CHECK(result.view.settings==Settings{}); CHECK(result.view.pending==first);
  CHECK(box.submit(4,second).result==SettingsSubmitResult::Busy);
  Settings accepted; uint32_t operation=0;
  CHECK(box.take(accepted,operation)); CHECK(accepted==first); CHECK(operation!=0);
  CHECK(!box.take(accepted,operation));
  // Old main-loop publication cannot erase a newly accepted reservation.
  box.publish(0,ready); CHECK(box.snapshot().status==SettingsStatus::Applying);
  ready.settings=first; ready.revision=5; box.publish(operation,ready);
  CHECK(box.snapshot().status==SettingsStatus::Ready); CHECK(box.snapshot().revision==5);
  CHECK(box.submit(4,second).result==SettingsSubmitResult::RevisionConflict);
  CHECK(box.submit(5,second).result==SettingsSubmitResult::Accepted);
}
void config_ack_parses_explicit_success_failure_and_rejects_truncation() {
  RadarFrames p;
  std::array<uint8_t,14> ack{0xFD,0xFC,0xFB,0xFA,4,0,0x64,1,0,0,4,3,2,1};
  for (size_t i=0;i<ack.size()-1;++i) CHECK(p.feed(ack[i])==RadarEvent::None);
  CHECK(p.feed(ack.back())==RadarEvent::CommandAck); CHECK(p.ack_command()==0x64); CHECK(p.ack_success());
  ack[8]=1;
  RadarEvent event=RadarEvent::None; for(auto b:ack) event=p.feed(b);
  CHECK(event==RadarEvent::CommandAck); CHECK(!p.ack_success());
}
int main() {
  int count=0,failed=0;
  const auto run=[&](const char *name,void(*f)()){ ++count; try{f(); std::cout<<"PASS "<<name<<'\n';}catch(const std::exception&e){++failed;std::cerr<<"FAIL "<<e.what()<<'\n';}};
#define RUN(t) run(#t,t)
  RUN(settings_reject_all_invalid_bounds); RUN(observation_gate_stays_eight_for_all_software_near_distances);
  RUN(sensitivity_profiles_preserve_zero_and_adjust_nonzero); RUN(apply_waits_for_picture_recovery_and_times_out);
  RUN(matching_hardware_still_needs_new_final_read_and_save); RUN(write_nine_gates_and_only_commit_after_complete_verification);
  RUN(failed_gate_ack_and_partial_write_never_commit); RUN(missing_ack_is_bounded_even_with_matching_readback);
  RUN(final_mismatch_or_stale_radar_never_reaches_save); RUN(persistence_failure_and_reboot_keep_last_verified_settings);
  RUN(boot_reconcile_does_not_increment_saved_revision); RUN(records_reject_corruption_and_unsupported_values);
  RUN(same_origin_accepts_ip_mdns_ports_and_rejects_cross_site);
  RUN(mailbox_cas_rejects_overlaps_and_old_revision_without_mixing_fields);
  RUN(config_ack_parses_explicit_success_failure_and_rejects_truncation);
  std::cout<<count-failed<<'/'<<count<<" settings tests passed\n";
  return failed==0?EXIT_SUCCESS:EXIT_FAILURE;
}
