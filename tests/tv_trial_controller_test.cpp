#include "../firmware/tv_trial_controller.h"
#include "../firmware/tv_trial_radar_protocol.h"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace tv_trial;

#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(\
  std::string(__func__) + ":" + std::to_string(__LINE__) + " " #condition); } while (false)

struct Rig {
  Controller c;
  Power power{Power::Active};
  Mode mode{Mode::Normal};
  uint32_t now{100};

  Rig() {
    c.set_link(true, now);
    c.set_radar_ready(true, now);
    c.radar_frame(now, true);
    poll(now, true);
  }

  Request poll(uint32_t time, bool present, bool measurement_known = true) {
    now = time;
    c.radar_frame(now, present, measurement_known);
    auto request = c.next(now);
    if (request.kind == RpcKind::Query) {
      c.complete_query(request.token, now, power, mode, now);
      request = c.next(now);
    }
    return request;
  }

  void arm() { c.set_enabled(true, now); CHECK(c.enabled()); }

  Request hide() {
    arm();
    CHECK(poll(1100, true).kind == RpcKind::None);
    CHECK(poll(2100, true).kind == RpcKind::None);
    auto request = poll(3100, true);
    CHECK(request.kind == RpcKind::Hide);
    return request;
  }

  void hidden() {
    auto request = hide();
    c.complete_command(request.token, now, Outcome::Success);
    mode = Mode::PictureOff;
    CHECK(poll(3600, true).kind == RpcKind::None);
    CHECK(c.owns_picture());
  }
};

void default_off_and_three_second_near_debounce() {
  Rig r;
  CHECK(!r.c.enabled());
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  r.arm();
  CHECK(r.poll(6100, true).kind == RpcKind::None);
  CHECK(r.poll(7100, true).kind == RpcKind::None);
  CHECK(r.poll(8099, true).kind == RpcKind::None);
  CHECK(r.poll(8100, true).kind == RpcKind::Hide);
}

void short_near_pulse_does_not_hide() {
  Rig r;
  r.arm();
  CHECK(r.poll(1100, true).kind == RpcKind::None);
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  CHECK(r.poll(3099, false).kind == RpcKind::None);
  CHECK(r.poll(3100, true).kind == RpcKind::None);
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6099, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::Hide);
}

void one_second_away_debounce_resets_on_presence() {
  Rig r;
  r.hidden();
  CHECK(r.poll(4000, false).kind == RpcKind::None);
  CHECK(r.poll(4500, false).kind == RpcKind::None);
  CHECK(r.poll(4999, true).kind == RpcKind::None);
  CHECK(r.poll(5000, false).kind == RpcKind::None);
  CHECK(r.poll(5999, false).kind == RpcKind::None);
  CHECK(r.poll(6000, false).kind == RpcKind::Restore);
}

void manual_off_restores_only_owned_picture() {
  Rig r;
  r.hidden();
  r.c.set_enabled(false, r.now);
  auto request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Restore);
  CHECK(r.c.owns_picture());
  r.c.complete_command(request.token, r.now, Outcome::Success);
  CHECK(r.c.owns_picture());  // An ACK alone is not a picture readback.
  r.mode = Mode::Normal;
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
  CHECK(!r.c.enabled());
}

void already_picture_off_is_never_claimed_or_restored() {
  Rig r;
  r.mode = Mode::PictureOff;
  r.poll(1100, true);
  r.arm();
  for (uint32_t t = 2100; t <= 11100; t += 1000)
    CHECK(r.poll(t, t < 5100).kind == RpcKind::None);
  r.c.set_enabled(false, r.now);
  CHECK(r.c.next(r.now).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
}

void standby_clears_ownership_and_does_not_wake() {
  Rig r;
  r.hidden();
  r.power = Power::Standby;
  CHECK(r.poll(4600, false).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
  CHECK(r.c.enabled());
  r.c.request_restore(r.now);
  auto request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, r.now, Power::Standby, Mode::Unknown, r.now);
  CHECK(r.c.next(r.now).kind == RpcKind::None);
}

void radar_stale_pauses_without_erasing_user_intent() {
  Rig r;
  r.arm();
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  auto request = r.c.next(4701);
  CHECK(r.c.enabled());
  CHECK(request.kind == RpcKind::Query || request.kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
}

void stale_owned_radar_requests_recovery_on_fresh_tv() {
  Rig r;
  r.hidden();
  auto request = r.c.next(6201);
  CHECK(r.c.enabled());
  CHECK(r.c.owns_picture());
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, 6201, Power::Active, Mode::PictureOff, 6201);
  CHECK(r.c.next(6201).kind == RpcKind::Restore);
}

void communication_failure_preserves_recovery_until_reconnect() {
  Rig r;
  r.hidden();
  auto request = r.c.next(4600);
  CHECK(request.kind == RpcKind::Query);
  r.c.fail_query(request.token, 4600);
  CHECK(r.c.enabled());
  CHECK(r.c.owns_picture());
  r.c.set_link(false, 4600);
  CHECK(r.c.next(10000).kind == RpcKind::None);
  r.c.set_link(true, 10100);
  request = r.c.next(10100);
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, 10100, Power::Active, Mode::PictureOff, 10100);
  CHECK(r.c.next(10100).kind == RpcKind::Restore);
}

void uncertain_hide_is_reconciled_even_if_first_query_is_visible() {
  Rig r;
  auto request = r.hide();
  r.c.complete_command(request.token, 3100, Outcome::Uncertain);
  CHECK(r.c.enabled());
  CHECK(r.c.owns_picture());
  r.mode = Mode::Normal;
  request = r.poll(3600, true);
  CHECK(request.kind == RpcKind::Restore);
  r.c.complete_command(request.token, 3600, Outcome::Success);
  CHECK(r.c.owns_picture());
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
}

void manual_off_during_hide_waits_for_reply_then_restores() {
  Rig r;
  auto request = r.hide();
  r.c.set_enabled(false, 3150);
  CHECK(r.c.next(3150).kind == RpcKind::None);
  r.c.complete_command(request.token, 3200, Outcome::Success);
  r.mode = Mode::PictureOff;
  CHECK(r.poll(3700, true).kind == RpcKind::Restore);
}

void rejected_hide_is_not_owned() {
  Rig r;
  auto request = r.hide();
  r.c.complete_command(request.token, 3100, Outcome::Rejected);
  CHECK(r.c.enabled());
  CHECK(!r.c.owns_picture());
  CHECK(r.poll(4100, true).kind == RpcKind::None);
}

void failed_restore_keeps_responsibility() {
  Rig r;
  r.hidden();
  r.c.set_enabled(false, r.now);
  auto request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Restore);
  r.c.complete_command(request.token, r.now, Outcome::Uncertain);
  CHECK(r.c.owns_picture());
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(4600, true).kind == RpcKind::Restore);
}

void explicit_restore_can_restore_unowned_picture_but_disarms() {
  Rig r;
  r.mode = Mode::PictureOff;
  r.poll(1100, true);
  r.arm();
  r.c.request_restore(r.now);
  CHECK(!r.c.enabled());
  auto request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, r.now, Power::Active, Mode::PictureOff, r.now);
  request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Restore);
  CHECK(request.mode == Mode::Normal);
}

void rpc_serialization_ignores_old_response_and_stale_snapshot() {
  Rig r;
  auto request = r.c.next(1100);
  CHECK(request.kind == RpcKind::Query);
  CHECK(r.c.next(1200).kind == RpcKind::None);
  r.c.complete_query(request.token + 1, 1200, Power::Active, Mode::Normal, 1200);
  CHECK(r.c.next(1200).kind == RpcKind::None);
  r.c.complete_query(request.token, 4001, Power::Active, Mode::Normal, 1100);
  r.c.set_enabled(true, 4001);
  CHECK(r.c.enabled());
}

void stalled_request_never_opens_a_second_rpc() {
  Rig r;
  auto request = r.hide();
  CHECK(request.kind == RpcKind::Hide);
  CHECK(r.c.next(9500).kind == RpcKind::None);
  CHECK(r.c.enabled());
  CHECK(r.c.owns_picture());
}

void reboot_does_not_claim_previous_picture_off() {
  Rig r;
  r.hidden();
  Rig rebooted;
  rebooted.mode = Mode::PictureOff;
  CHECK(rebooted.poll(1100, true).kind == RpcKind::None);
  CHECK(!rebooted.c.enabled());
  CHECK(!rebooted.c.owns_picture());
}

void restores_previous_saving_mode() {
  Rig r;
  r.mode = Mode::Low;
  r.poll(1100, true);
  r.arm();
  r.poll(2100, true);
  r.poll(3100, true);
  auto request = r.poll(4100, true);
  CHECK(request.kind == RpcKind::Hide);
  r.c.complete_command(request.token, 4100, Outcome::Success);
  r.mode = Mode::PictureOff;
  r.poll(4600, true);
  r.c.set_enabled(false, 4600);
  request = r.c.next(4600);
  CHECK(request.kind == RpcKind::Restore);
  CHECK(request.mode == Mode::Low);
}

void timer_wrap_does_not_trigger_early() {
  Rig r;
  r.now = 0xFFFFF800U;
  r.c.set_link(true, r.now);
  r.c.radar_frame(r.now, true);
  auto request = r.c.next(r.now);
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, r.now, Power::Active, Mode::Normal, r.now);
  r.arm();
  CHECK(r.poll(0xFFFFFBE8U, true).kind == RpcKind::None);
  CHECK(r.poll(0xFFFFFFD0U, true).kind == RpcKind::None);
  CHECK(r.poll(0x000003B7U, true).kind == RpcKind::None);
  CHECK(r.poll(0x000003B8U, true).kind == RpcKind::Hide);
}

void slow_successful_query_cannot_starve_pending_restore() {
  Rig r;
  r.hidden();
  r.c.radar_frame(4600, true);
  r.c.set_enabled(false, 4600);
  auto request = r.c.next(4600);
  CHECK(request.kind == RpcKind::Query);
  // UART remains serviced while the worker spends 1100 ms doing this RPC.
  r.c.radar_frame(5100, true);
  r.c.radar_frame(5700, true);
  r.c.complete_query(request.token, 5700, Power::Active, Mode::PictureOff, 4600);
  request = r.c.next(5700);
  CHECK(request.kind == RpcKind::Restore);
}

void slow_successful_query_cannot_starve_debounced_hide() {
  Rig r;
  r.arm();
  r.c.radar_frame(2100, true);
  auto request = r.c.next(2100);
  CHECK(request.kind == RpcKind::Query);
  r.c.radar_frame(2600, true);
  r.c.radar_frame(3200, true);
  r.c.complete_query(request.token, 3200, Power::Active, Mode::Normal, 2100);
  CHECK(r.c.next(3200).kind == RpcKind::Hide);
}

void standby_accepts_on_and_resumes_after_three_new_seconds() {
  Rig r;
  r.power = Power::Standby;
  CHECK(r.poll(1100, true).kind == RpcKind::None);
  r.arm();
  CHECK(r.c.enabled());
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  CHECK(r.poll(3100, true).kind == RpcKind::None);
  r.power = Power::Active;
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::None);
  CHECK(r.poll(7099, true).kind == RpcKind::None);
  CHECK(r.poll(7100, true).kind == RpcKind::Hide);
}

void manual_off_in_standby_stays_off_after_power_on() {
  Rig r;
  r.arm();
  r.power = Power::Standby;
  CHECK(r.poll(1100, true).kind == RpcKind::None);
  CHECK(r.c.enabled());
  r.c.set_enabled(false, 1100);
  r.power = Power::Active;
  for (uint32_t t = 2100; t <= 7100; t += 1000)
    CHECK(r.poll(t, true).kind == RpcKind::None);
  CHECK(!r.c.enabled());
}

void restored_on_before_components_ready_waits_for_health() {
  Controller c;
  c.set_enabled(true, 1);  // ESPHome restores the switch before runtime.begin().
  CHECK(c.enabled());
  CHECK(c.next(100).kind == RpcKind::None);
  c.set_link(true, 100);
  c.set_radar_ready(true, 100);
  c.radar_frame(100, true);
  auto request = c.next(100);
  CHECK(request.kind == RpcKind::Query);
  c.radar_frame(1100, true);
  c.complete_query(request.token, 1100, Power::Active, Mode::Normal, 100);
  CHECK(c.next(1100).kind == RpcKind::None);
  for (uint32_t t : {2100U, 3100U, 4099U}) {
    c.radar_frame(t, true);
    request = c.next(t);
    if (request.kind == RpcKind::Query) {
      c.complete_query(request.token, t, Power::Active, Mode::Normal, t);
      request = c.next(t);
    }
    CHECK(request.kind == RpcKind::None);
  }
  c.radar_frame(4100, true);
  request = c.next(4100);
  if (request.kind == RpcKind::Query) {
    c.complete_query(request.token, 4100, Power::Active, Mode::Normal, 4100);
    request = c.next(4100);
  }
  CHECK(request.kind == RpcKind::Hide);
}

void network_reconnect_requires_a_new_near_interval() {
  Rig r;
  r.arm();
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  r.c.set_link(false, 2200);
  CHECK(r.c.enabled());
  CHECK(r.poll(3100, true).kind == RpcKind::None);
  r.c.set_link(true, 4100);
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::None);
  CHECK(r.poll(7099, true).kind == RpcKind::None);
  CHECK(r.poll(7100, true).kind == RpcKind::Hide);
}

void radar_reconnect_requires_a_new_near_interval() {
  Rig r;
  r.arm();
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  auto request = r.c.next(4701);
  CHECK(request.kind == RpcKind::Query);
  r.c.complete_query(request.token, 4701, Power::Active, Mode::Normal, 4701);
  CHECK(r.c.enabled());
  CHECK(r.poll(4800, true).kind == RpcKind::None);
  CHECK(r.poll(5800, true).kind == RpcKind::None);
  CHECK(r.poll(6800, true).kind == RpcKind::None);
  CHECK(r.poll(7799, true).kind == RpcKind::None);
  CHECK(r.poll(7800, true).kind == RpcKind::Hide);
}

void tv_failure_recovers_intent_but_restarts_confirmation() {
  Rig r;
  r.arm();
  r.c.radar_frame(2100, true);
  auto request = r.c.next(2100);
  CHECK(request.kind == RpcKind::Query);
  r.c.fail_query(request.token, 2100);
  CHECK(r.c.enabled());
  CHECK(r.poll(3100, true).kind == RpcKind::None);
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6099, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::Hide);
}

void old_query_from_previous_connection_cannot_resume_monitoring() {
  Rig r;
  r.arm();
  r.c.radar_frame(1100, true);
  auto request = r.c.next(1100);
  CHECK(request.kind == RpcKind::Query);
  r.c.set_link(false, 1200);
  r.c.set_link(true, 1300);
  r.c.radar_frame(1400, true);
  r.c.complete_query(request.token, 1400, Power::Active, Mode::Normal, 1100);
  CHECK(r.c.enabled());
  CHECK(!r.c.tv_fresh(1400));
  CHECK(r.c.next(1400).kind == RpcKind::None);
  CHECK(r.poll(2400, true).kind == RpcKind::None);
  CHECK(r.poll(3400, true).kind == RpcKind::None);
  CHECK(r.poll(4400, true).kind == RpcKind::None);
  CHECK(r.poll(5399, true).kind == RpcKind::None);
  CHECK(r.poll(5400, true).kind == RpcKind::Hide);
}

void successful_fault_recovery_resumes_on_with_new_confirmation() {
  Rig r;
  auto request = r.hide();
  r.c.complete_command(request.token, 3100, Outcome::Uncertain);
  CHECK(r.c.enabled());
  request = r.poll(3600, true);
  CHECK(request.kind == RpcKind::Restore);
  r.c.complete_command(request.token, 3600, Outcome::Success);
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
  CHECK(r.c.enabled());
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::None);
  CHECK(r.poll(7099, true).kind == RpcKind::None);
  CHECK(r.poll(7100, true).kind == RpcKind::Hide);
}

// Fixtures follow the LD2410 wire layout, independent of the decoder.
const std::array<uint8_t, 23> normal_frame{
  0xF4,0xF3,0xF2,0xF1,0x0D,0x00,0x02,0xAA,0x03,0x90,0x00,0x25,
  0x80,0x00,0x30,0x90,0x00,0x55,0x00,0xF8,0xF7,0xF6,0xF5};
const std::array<uint8_t, 38> parameter_frame{
  0xFD,0xFC,0xFB,0xFA,0x1C,0x00,0x61,0x01,0x00,0x00,0xAA,0x08,0x08,0x08,
  50,50,40,30,20,15,15,15,15,0,0,40,40,30,30,20,20,20,5,0,4,3,2,1};

std::array<uint8_t,23> target_frame(uint8_t state, uint16_t moving, uint16_t still) {
  auto frame = normal_frame;
  frame[8] = state;
  frame[9] = static_cast<uint8_t>(moving & 0xFF);
  frame[10] = static_cast<uint8_t>(moving >> 8);
  frame[12] = static_cast<uint8_t>(still & 0xFF);
  frame[13] = static_cast<uint8_t>(still >> 8);
  return frame;
}

template<size_t N> RadarEvent feed(RadarFrames &parser, const std::array<uint8_t,N> &bytes) {
  RadarEvent event = RadarEvent::None;
  for (auto byte : bytes) {
    auto next = parser.feed(byte);
    if (next != RadarEvent::None) event = next;
  }
  return event;
}

void identical_periodic_frames_provide_heartbeat() {
  RadarFrames parser;
  CHECK(feed(parser, normal_frame) == RadarEvent::Periodic);
  CHECK(parser.present());
  CHECK(feed(parser, normal_frame) == RadarEvent::Periodic);
  auto absent = normal_frame;
  absent[8] = 0;
  CHECK(feed(parser, absent) == RadarEvent::Periodic);
  CHECK(!parser.present());
}

void invalid_periodic_frame_is_not_presence_or_heartbeat() {
  RadarFrames parser;
  auto invalid = normal_frame;
  invalid[17] = 0;
  CHECK(feed(parser, invalid) == RadarEvent::None);
  invalid = normal_frame;
  invalid[4] = 0xFF;
  CHECK(feed(parser, invalid) == RadarEvent::None);
  CHECK(feed(parser, normal_frame) == RadarEvent::Periodic);
}

void parameter_ack_preserves_zero_thresholds_and_timeout() {
  RadarFrames parser;
  CHECK(feed(parser, parameter_frame) == RadarEvent::Parameters);
  CHECK(parser.parameters().max_move == 8);
  CHECK(parser.parameters().max_still == 8);
  CHECK(parser.parameters().timeout == 5);
  CHECK(parser.parameters().move == (std::array<uint8_t,9>{50,50,40,30,20,15,15,15,15}));
  CHECK(parser.parameters().still == (std::array<uint8_t,9>{0,0,40,40,30,30,20,20,20}));
  auto invalid = parameter_frame;
  invalid[9] = 1;
  CHECK(feed(parser, invalid) == RadarEvent::None);
  CHECK(parser.parameters().timeout == 5);
}

void resolution_requires_valid_ack() {
  RadarFrames parser;
  CHECK(parser.resolution() == 0xFF);
  const std::array<uint8_t,16> resolution{
    0xFD,0xFC,0xFB,0xFA,0x06,0,0xAB,1,0,0,0,0,4,3,2,1};
  CHECK(feed(parser, resolution) == RadarEvent::Resolution);
  CHECK(parser.resolution() == 0);
}

void near_distance_includes_150_but_excludes_151_cm() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(1, 150, 0)) == RadarEvent::Periodic);
  CHECK(parser.present());
  CHECK(parser.measurement_known());
  CHECK(feed(parser, target_frame(1, 151, 0)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(parser.measurement_known());
}

void absent_state_ignores_residual_near_distances() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(0, 90, 80)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(parser.measurement_known());
}

void distant_moving_target_does_not_use_still_residue() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(1, 250, 80)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(parser.measurement_known());
}

void static_near_target_is_accepted_without_motion() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(2, 400, 150)) == RadarEvent::Periodic);
  CHECK(parser.present());
  CHECK(parser.measurement_known());
  CHECK(feed(parser, target_frame(2, 100, 151)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(parser.measurement_known());
}

void either_real_near_target_is_enough_but_zero_is_unknown() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(3, 400, 100)) == RadarEvent::Periodic);
  CHECK(parser.present());
  CHECK(feed(parser, target_frame(3, 100, 0)) == RadarEvent::Periodic);
  CHECK(parser.present());
  CHECK(parser.measurement_known());
  CHECK(feed(parser, target_frame(1, 0, 100)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(!parser.measurement_known());
  CHECK(feed(parser, target_frame(3, 0, 200)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(!parser.measurement_known());
}

void unsupported_target_state_is_unknown_not_a_near_target() {
  RadarFrames parser;
  CHECK(feed(parser, target_frame(5, 80, 80)) == RadarEvent::Periodic);
  CHECK(!parser.present());
  CHECK(!parser.measurement_known());
}

void far_motion_and_absent_residue_never_start_hide() {
  Rig r;
  r.arm();
  RadarFrames parser;
  for (uint32_t t = 1100; t <= 7100; t += 1000) {
    CHECK(feed(parser, target_frame(t < 4100 ? 1 : 0, t < 4100 ? 250 : 90, 80)) == RadarEvent::Periodic);
    CHECK(r.poll(t, parser.present(), parser.measurement_known()).kind == RpcKind::None);
  }
  CHECK(r.c.enabled());
  CHECK(!r.c.owns_picture());
}

void static_near_frames_confirm_for_three_seconds_then_hide() {
  Rig r;
  r.arm();
  RadarFrames parser;
  CHECK(feed(parser, target_frame(2, 400, 150)) == RadarEvent::Periodic);
  CHECK(r.poll(1100, parser.present(), parser.measurement_known()).kind == RpcKind::None);
  CHECK(r.poll(2100, parser.present(), parser.measurement_known()).kind == RpcKind::None);
  CHECK(r.poll(3099, parser.present(), parser.measurement_known()).kind == RpcKind::None);
  CHECK(r.poll(3100, parser.present(), parser.measurement_known()).kind == RpcKind::Hide);
}

void unknown_measurement_recovers_owned_picture_without_erasing_on() {
  Rig r;
  r.hidden();
  // A structurally valid frame can contain no usable measurement. This is
  // a fault recovery, not a claim that the near zone became clear.
  auto request = r.poll(4000, false, false);
  CHECK(request.kind == RpcKind::Restore);
  CHECK(r.c.enabled());
  CHECK(!r.c.effective(4000));
  CHECK(r.c.radar_fresh(4000));
  r.c.complete_command(request.token, 4000, Outcome::Success);
  r.mode = Mode::Normal;
  CHECK(r.poll(4500, false, false).kind == RpcKind::None);
  CHECK(!r.c.owns_picture());
  CHECK(r.poll(5500, false, false).kind == RpcKind::None);
  CHECK(r.poll(6500, false, false).kind == RpcKind::None);
  CHECK(r.c.enabled());
  CHECK(r.poll(7000, true).kind == RpcKind::None);
  CHECK(r.poll(8000, true).kind == RpcKind::None);
  CHECK(r.poll(9000, true).kind == RpcKind::None);
  CHECK(r.poll(9999, true).kind == RpcKind::None);
  CHECK(r.poll(10000, true).kind == RpcKind::Hide);
}

void unknown_measurement_cannot_complete_an_old_near_interval() {
  Rig r;
  r.arm();
  CHECK(r.poll(2100, true).kind == RpcKind::None);
  CHECK(r.poll(3000, false, false).kind == RpcKind::None);
  CHECK(r.c.enabled());
  CHECK(!r.c.effective(3000));
  CHECK(r.poll(3100, true).kind == RpcKind::None);
  CHECK(r.poll(4100, true).kind == RpcKind::None);
  CHECK(r.poll(5100, true).kind == RpcKind::None);
  CHECK(r.poll(6099, true).kind == RpcKind::None);
  CHECK(r.poll(6100, true).kind == RpcKind::Hide);
}

void trial_target_uses_one_second_timeout_without_changing_sensitivity() {
  RadarFrames parser;
  CHECK(feed(parser, parameter_frame) == RadarEvent::Parameters);
  const auto original = parser.parameters();
  const auto target = original.trial_target();
  CHECK(target.max_move == 8);
  CHECK(target.max_still == 8);
  CHECK(target.timeout == 1);
  CHECK(target.move == (std::array<uint8_t,9>{50,50,40,30,20,15,15,15,15}));
  CHECK(target.still == (std::array<uint8_t,9>{0,0,40,40,30,30,20,20,20}));
  CHECK(original.timeout == 5);
  CHECK(original.max_move == 8);
}

void trial_readback_accepts_one_second_and_rejects_old_timeout() {
  RadarFrames parser;
  CHECK(feed(parser, parameter_frame) == RadarEvent::Parameters);
  const auto original = parser.parameters();
  auto readback = parameter_frame;
  readback[12] = 8;
  readback[13] = 8;
  readback[32] = 1;
  CHECK(feed(parser, readback) == RadarEvent::Parameters);
  CHECK(parser.parameters().matches_trial_target(original));
  readback[32] = 5;
  CHECK(feed(parser, readback) == RadarEvent::Parameters);
  CHECK(!parser.parameters().matches_trial_target(original));
  readback[32] = 1;
  readback[23] = 1;  // The original g0 static threshold is genuinely zero.
  CHECK(feed(parser, readback) == RadarEvent::Parameters);
  CHECK(!parser.parameters().matches_trial_target(original));
  readback[23] = 0;
  readback[12] = 2;
  CHECK(feed(parser, readback) == RadarEvent::Parameters);
  CHECK(!parser.parameters().matches_trial_target(original));
}
void verified_settings_drive_actual_timing_and_distance() {
  Rig r;
  CHECK(r.c.configure_timing(1000,2000,100));
  r.arm();
  CHECK(r.poll(1099,true).kind==RpcKind::None);
  auto request=r.poll(1100,true); CHECK(request.kind==RpcKind::Hide);
  r.c.complete_command(request.token,1100,Outcome::Success); r.mode=Mode::PictureOff;
  CHECK(r.poll(1600,true).kind==RpcKind::None);
  CHECK(r.poll(2000,false).kind==RpcKind::None);
  CHECK(r.poll(3000,false).kind==RpcKind::None);
  CHECK(r.poll(3999,false).kind==RpcKind::None);
  CHECK(r.poll(4000,false).kind==RpcKind::Restore);
  RadarFrames frames;
  frames.set_near_distance(300);
  CHECK(feed(frames,target_frame(1,250,0))==RadarEvent::Periodic); CHECK(frames.present());
  frames.set_near_distance(50);
  CHECK(!frames.measurement_known()); // Must wait for a frame measured under the new rule.
  CHECK(feed(frames,target_frame(1,51,0))==RadarEvent::Periodic); CHECK(!frames.present());
  CHECK(feed(frames,target_frame(2,400,50))==RadarEvent::Periodic); CHECK(frames.present());
}
void configuration_pause_and_manual_off_do_not_restore_old_intent() {
  Rig r; r.hidden();
  r.c.set_radar_ready(false,3600);
  auto request=r.c.next(3600); CHECK(request.kind==RpcKind::Restore);
  r.c.complete_command(request.token,3600,Outcome::Success);
  r.c.set_enabled(false,3700); r.mode=Mode::Normal;
  CHECK(r.poll(4100,true).kind==RpcKind::None); CHECK(!r.c.owns_picture());
  CHECK(r.c.configure_timing(5000,2000,4200));
  r.c.set_radar_ready(true,4200);
  for(uint32_t t=4200;t<=10200;t+=1000) CHECK(r.poll(t,true).kind==RpcKind::None);
  CHECK(!r.c.enabled());
}
void invalidating_measurement_does_not_forge_uart_heartbeat() {
  Rig r; r.arm();
  r.c.invalidate_radar_measurement(1100);
  CHECK(r.c.radar_fresh(1100)); CHECK(!r.c.radar_measurement_known()); CHECK(!r.c.effective(1100));
  CHECK(!r.c.radar_fresh(2701));
}
void radar_scene_distinguishes_real_near_far_absent_unknown_and_stale() {
  RadarFrames p;
  CHECK(p.scene()==ScenePresence::Unknown);
  CHECK(p.scene(false)==ScenePresence::Unavailable);
  struct Case { uint8_t state; uint16_t moving,still; ScenePresence want; };
  const Case cases[]{
    {1,250,80,ScenePresence::Far},
    {2,400,140,ScenePresence::Near},
    {0,60,80,ScenePresence::Absent},
    {3,0,250,ScenePresence::Unknown},
    {3,80,0,ScenePresence::Near},
    {5,80,80,ScenePresence::Unknown}
  };
  for(const auto &c:cases) {
    CHECK(feed(p,target_frame(c.state,c.moving,c.still))==RadarEvent::Periodic);
    CHECK(p.scene()==c.want);
  }
  p.set_near_distance(300);
  CHECK(feed(p,target_frame(1,250,0))==RadarEvent::Periodic);
  CHECK(p.scene()==ScenePresence::Near);
  CHECK(p.scene(false)==ScenePresence::Unavailable);
}

int main() {
  int failures = 0;
  int count = 0;
  const auto run = [&](const char *name, void (*test)()) {
    ++count;
    try { test(); std::cout << "PASS " << name << '\n'; }
    catch (const std::exception &e) { ++failures; std::cerr << "FAIL " << e.what() << '\n'; }
  };
#define RUN(name) run(#name, name)
  RUN(default_off_and_three_second_near_debounce);
  RUN(short_near_pulse_does_not_hide);
  RUN(one_second_away_debounce_resets_on_presence);
  RUN(manual_off_restores_only_owned_picture);
  RUN(already_picture_off_is_never_claimed_or_restored);
  RUN(standby_clears_ownership_and_does_not_wake);
  RUN(radar_stale_pauses_without_erasing_user_intent);
  RUN(stale_owned_radar_requests_recovery_on_fresh_tv);
  RUN(communication_failure_preserves_recovery_until_reconnect);
  RUN(uncertain_hide_is_reconciled_even_if_first_query_is_visible);
  RUN(manual_off_during_hide_waits_for_reply_then_restores);
  RUN(rejected_hide_is_not_owned);
  RUN(failed_restore_keeps_responsibility);
  RUN(explicit_restore_can_restore_unowned_picture_but_disarms);
  RUN(rpc_serialization_ignores_old_response_and_stale_snapshot);
  RUN(stalled_request_never_opens_a_second_rpc);
  RUN(reboot_does_not_claim_previous_picture_off);
  RUN(restores_previous_saving_mode);
  RUN(timer_wrap_does_not_trigger_early);
  RUN(slow_successful_query_cannot_starve_pending_restore);
  RUN(slow_successful_query_cannot_starve_debounced_hide);
  RUN(standby_accepts_on_and_resumes_after_three_new_seconds);
  RUN(manual_off_in_standby_stays_off_after_power_on);
  RUN(restored_on_before_components_ready_waits_for_health);
  RUN(network_reconnect_requires_a_new_near_interval);
  RUN(radar_reconnect_requires_a_new_near_interval);
  RUN(tv_failure_recovers_intent_but_restarts_confirmation);
  RUN(old_query_from_previous_connection_cannot_resume_monitoring);
  RUN(successful_fault_recovery_resumes_on_with_new_confirmation);
  RUN(identical_periodic_frames_provide_heartbeat);
  RUN(invalid_periodic_frame_is_not_presence_or_heartbeat);
  RUN(parameter_ack_preserves_zero_thresholds_and_timeout);
  RUN(resolution_requires_valid_ack);
  RUN(near_distance_includes_150_but_excludes_151_cm);
  RUN(absent_state_ignores_residual_near_distances);
  RUN(distant_moving_target_does_not_use_still_residue);
  RUN(static_near_target_is_accepted_without_motion);
  RUN(either_real_near_target_is_enough_but_zero_is_unknown);
  RUN(unsupported_target_state_is_unknown_not_a_near_target);
  RUN(far_motion_and_absent_residue_never_start_hide);
  RUN(static_near_frames_confirm_for_three_seconds_then_hide);
  RUN(unknown_measurement_recovers_owned_picture_without_erasing_on);
  RUN(unknown_measurement_cannot_complete_an_old_near_interval);
  RUN(trial_target_uses_one_second_timeout_without_changing_sensitivity);
  RUN(trial_readback_accepts_one_second_and_rejects_old_timeout);
  RUN(verified_settings_drive_actual_timing_and_distance);
  RUN(configuration_pause_and_manual_off_do_not_restore_old_intent);
  RUN(invalidating_measurement_does_not_forge_uart_heartbeat);
  RUN(radar_scene_distinguishes_real_near_far_absent_unknown_and_stale);
  std::cout << count - failures << '/' << count << " passed\n";
  return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
