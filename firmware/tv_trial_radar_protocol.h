#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace tv_trial {
enum class RadarEvent : uint8_t { None, Periodic, Parameters, Resolution, CommandAck };
enum class ScenePresence : uint8_t { Near, Far, Absent, Unknown, Unavailable };
struct RadarParameters {
  uint8_t max_move{0}, max_still{0};
  uint16_t timeout{0};
  std::array<uint8_t, 9> move{}, still{};
  RadarParameters trial_target() const {
    auto target = *this;
    target.max_move = 8;
    target.max_still = 8;
    target.timeout = 1;
    return target;
  }
  bool sensitivities_match(const RadarParameters &other) const {
    return move == other.move && still == other.still;
  }
  bool matches_trial_target(const RadarParameters &original) const {
    return max_move == 8 && max_still == 8 && timeout == 1 && sensitivities_match(original);
  }
};
class RadarFrames {
 public:
  RadarEvent feed(uint8_t byte) {
    if (size_ == buffer_.size()) discard_();
    buffer_[size_++] = byte;
    while (size_ >= 4) {
      const bool periodic = header_(0xF4,0xF3,0xF2,0xF1);
      const bool ack = header_(0xFD,0xFC,0xFB,0xFA);
      if (!periodic && !ack) { discard_(); continue; }
      if (size_ < 6) return RadarEvent::None;
      const size_t payload = static_cast<size_t>(buffer_[4]) + (buffer_[5] << 8);
      if (payload < 4 || payload + 10 > buffer_.size()) { discard_(); continue; }
      const size_t length = payload + 10;
      if (size_ < length) return RadarEvent::None;
      const uint8_t *footer = &buffer_[length - 4];
      if ((periodic && !(footer[0]==0xF8 && footer[1]==0xF7 && footer[2]==0xF6 && footer[3]==0xF5)) ||
          (ack && !(footer[0]==4 && footer[1]==3 && footer[2]==2 && footer[3]==1))) {
        discard_(); continue;
      }
      RadarEvent event = RadarEvent::None;
      if (periodic && ((payload == 13 && buffer_[6] == 2) || (payload == 35 && buffer_[6] == 1)) &&
          buffer_[7] == 0xAA && buffer_[length-6] == 0x55 && buffer_[length-5] == 0) {
        // Target states 0/1/2/3 mean absent/moving/still/both. Distances are
        // little-endian centimetres. Ignore residual distances of absent
        // categories and never use the aggregate detection-distance field.
        const uint8_t state = buffer_[8];
        const bool moving = state == 1 || state == 3;
        const bool still = state == 2 || state == 3;
        const uint16_t moving_cm = static_cast<uint16_t>(buffer_[9] | (buffer_[10] << 8));
        const uint16_t still_cm = static_cast<uint16_t>(buffer_[12] | (buffer_[13] << 8));
        present_ = (moving && moving_cm >= 1 && moving_cm <= near_distance_cm_) ||
                   (still && still_cm >= 1 && still_cm <= near_distance_cm_);
        // Zero is conservatively treated as an unknown measurement, not an
        // assertion of absence. One usable near target is sufficient even if
        // the other category is unknown. Unsupported/noise states stay unknown.
        measurement_known_ = state <= 3 && (state == 0 || present_ ||
          ((!moving || moving_cm > 0) && (!still || still_cm > 0)));
        scene_ = !measurement_known_ ? ScenePresence::Unknown :
          (present_ ? ScenePresence::Near : (state==0 ? ScenePresence::Absent : ScenePresence::Far));
        event = RadarEvent::Periodic;
      } else if (ack && buffer_[7] == 1) {
        if (payload == 4 && (buffer_[6] == 0x60 || buffer_[6] == 0x64 || buffer_[6] == 0xAA)) {
          ack_command_ = buffer_[6];
          ack_success_ = buffer_[8] == 0 && buffer_[9] == 0;
          event = RadarEvent::CommandAck;
        } else if (buffer_[8] == 0 && buffer_[9] == 0 && buffer_[6] == 0x61 && payload == 28 && buffer_[10] == 0xAA &&
            buffer_[11] >= 2 && buffer_[11] <= 8 && buffer_[12] >= 2 && buffer_[12] <= buffer_[11] &&
            buffer_[13] >= 2 && buffer_[13] <= buffer_[11]) {
          bool valid = true;
          for (size_t i = 14; i < 32; ++i) if (buffer_[i] > 100) valid = false;
          if (valid) {
            parameters_.max_move = buffer_[12];
            parameters_.max_still = buffer_[13];
            for (size_t i = 0; i < 9; ++i) {
              parameters_.move[i] = buffer_[14+i];
              parameters_.still[i] = buffer_[23+i];
            }
            parameters_.timeout = static_cast<uint16_t>(buffer_[32] | (buffer_[33] << 8));
            event = RadarEvent::Parameters;
          }
        } else if (buffer_[8] == 0 && buffer_[9] == 0 && buffer_[6] == 0xAB && payload == 6 && buffer_[10] <= 1 && buffer_[11] == 0) {
          resolution_ = buffer_[10];
          event = RadarEvent::Resolution;
        }
      }
      size_ = 0;
      return event;
    }
    return RadarEvent::None;
  }
  bool present() const { return present_; }
  ScenePresence scene(bool available = true) const {
    return available ? scene_ : ScenePresence::Unavailable;
  }
  void set_near_distance(uint16_t distance_cm) {
    near_distance_cm_=distance_cm;
    present_=false; measurement_known_=false;
    scene_=ScenePresence::Unknown;
  }
  bool measurement_known() const { return measurement_known_; }
  const RadarParameters &parameters() const { return parameters_; }
  uint8_t resolution() const { return resolution_; }
  uint8_t ack_command() const { return ack_command_; }
  bool ack_success() const { return ack_success_; }
 private:
  bool header_(uint8_t a, uint8_t b, uint8_t c, uint8_t d) const {
    return buffer_[0]==a && buffer_[1]==b && buffer_[2]==c && buffer_[3]==d;
  }
  void discard_() {
    for (size_t i = 1; i < size_; ++i) buffer_[i-1] = buffer_[i];
    --size_;
  }
  RadarParameters parameters_{};
  std::array<uint8_t,64> buffer_{};
  size_t size_{0};
  bool present_{false};
  bool measurement_known_{false};
  ScenePresence scene_{ScenePresence::Unknown};
  uint8_t ack_command_{0};
  bool ack_success_{false};
  uint16_t near_distance_cm_{150};
  uint8_t resolution_{0xFF};
};
}  // namespace tv_trial
