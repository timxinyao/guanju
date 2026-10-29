#pragma once

#include "tv_trial_controller.h"
#include "tv_trial_radar_protocol.h"
#include "tv_trial_settings.h"
#include "tv_trial_settings_storage.h"
#include "tv_trial_settings_http.h"
#include "tv_trial_icon_http.h"
#include "esphome/components/ld2410/ld2410.h"
#include "esphome/components/number/number.h"
#include "esphome/components/wifi/wifi_component.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/json/json_util.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace tv_trial {

// Only this worker performs HTTP. It never reads or mutates controller state;
// POD queue messages are the boundary to the ESPHome / UART main loop.
class Runtime : public SettingsEndpoint {
 public:
  using GateNumbers = std::array<esphome::number::Number *,9>;
  Controller controller;

  void begin(const std::string &host, const std::string &psk,
             esphome::ld2410::LD2410Component *radar,
             esphome::number::Number *move, esphome::number::Number *still,
             esphome::number::Number *timeout, GateNumbers move_thresholds,
             GateNumbers still_thresholds) {
    if (started_) return;
    register_app_icon_http();
    url_ = "http://" + host + "/sony/system";
    psk_ = psk;
    radar_ = radar;
    move_ = move;
    still_ = still;
    timeout_ = timeout;
    move_thresholds_=move_thresholds;
    still_thresholds_=still_thresholds;
    boot_at_ = esphome::millis();
    Settings saved; uint32_t revision=0;
    load_verified_settings(saved,revision);
    settings_=SettingsTransaction(saved,revision);
    settings_.begin(saved,boot_at_,true);
    controller.set_radar_ready(false,boot_at_);
    publish_settings_();
    // Never enable verbose IDF HTTP diagnostics: they may print request headers.
    esp_log_level_set("HTTP_CLIENT", ESP_LOG_NONE);
    esp_log_level_set("TRANSPORT_BASE", ESP_LOG_NONE);
    requests_ = xQueueCreate(1, sizeof(Request));
    replies_ = xQueueCreate(1, sizeof(Reply));
    if (requests_ == nullptr || replies_ == nullptr ||
        xTaskCreate(worker_, "tv_rpc", 8192, this, 1, &worker_task_) != pdPASS) {
      if (requests_ != nullptr) vQueueDelete(requests_);
      if (replies_ != nullptr) vQueueDelete(replies_);
      requests_ = nullptr;
      replies_ = nullptr;
      settings_.abort("tv_worker_initialization_failed");
      publish_settings_();
      register_settings_http(*this);
      ESP_LOGE("tv_trial", "Cannot start TV worker; monitoring stays paused");
      return;
    }
    started_ = true;
    register_settings_http(*this);
    ESP_LOGI("tv_trial", "User intent=%s; monitoring waits for health; no wake / power commands",
      controller.enabled() ? "ON" : "OFF");
  }

  SettingsView settings_snapshot() override {
    portENTER_CRITICAL(&settings_lock_);
    const auto result=mailbox_.snapshot();
    portEXIT_CRITICAL(&settings_lock_);
    return result;
  }
  SettingsSubmitResponse submit_settings(uint32_t expected, const Settings &value) override {
    portENTER_CRITICAL(&settings_lock_);
    const auto result=started_?mailbox_.submit(expected,value):
      SettingsSubmitResponse{SettingsSubmitResult::Invalid,mailbox_.snapshot()};
    portEXIT_CRITICAL(&settings_lock_);
    return result;
  }

  // Called for every consumed UART RX byte, including unchanging reports.
  void feed(const std::vector<uint8_t> &bytes) {
    const uint32_t now = esphome::millis();
    for (uint8_t byte : bytes) {
      switch (frames_.feed(byte)) {
        case RadarEvent::Periodic:
          last_periodic_at_ = now;
          periodic_seen_ = true;
          controller.radar_frame(now, frames_.present(), frames_.measurement_known());
          break;
        case RadarEvent::Parameters:
          ++hardware_.parameter_sequence;
          hardware_.parameters=frames_.parameters();
          if (!original_seen_) {
            original_ = frames_.parameters();
            original_seen_ = true;
          }
          break;
        case RadarEvent::Resolution:
          ++hardware_.resolution_sequence;
          hardware_.resolution=frames_.resolution();
          if (!original_resolution_seen_) {
            original_resolution_ = frames_.resolution();
            original_resolution_seen_ = true;
          }
          break;
        case RadarEvent::CommandAck: {
          auto *ack=frames_.ack_command()==0x64?&hardware_.gate_ack:
            (frames_.ack_command()==0x60?&hardware_.range_ack:&hardware_.resolution_ack);
          ++ack->sequence; ack->success=frames_.ack_success();
          break;
        }
        default: break;
      }
    }
  }

  void loop() {
    if (!started_) return;
    uint32_t now = esphome::millis();
    controller.set_link(esphome::wifi::global_wifi_component->is_connected(), now);
    Reply reply{};
    if (xQueueReceive(replies_, &reply, 0) == pdTRUE) {
      if (reply.request.kind == RpcKind::Query) {
        if (reply.outcome == Outcome::Success)
          controller.complete_query(reply.request.token, now, reply.power, reply.mode, reply.observed_at);
        else controller.fail_query(reply.request.token, now);
      } else {
        controller.complete_command(reply.request.token, now, reply.outcome);
      }
      if (reply.outcome != Outcome::Success)
        ESP_LOGW("tv_trial", "TV RPC failed / uncertain (HTTP %d); checking state before recovery", reply.http_code);
    }
    configure_settings_(now);
    now = esphome::millis();
    // Linearize accepting a new settings reservation against selecting Hide.
    // HTTP only owns the mailbox; the controller is always accessed here.
    portENTER_CRITICAL(&settings_lock_);
    if (mailbox_.snapshot().status!=SettingsStatus::Ready) controller.set_radar_ready(false,now);
    const auto request = controller.next(now);
    portEXIT_CRITICAL(&settings_lock_);
    if (request.kind != RpcKind::None && xQueueSend(requests_, &request, 0) != pdTRUE) {
      if (request.kind == RpcKind::Query) controller.fail_query(request.token, now);
      else controller.complete_command(request.token, now, Outcome::Uncertain);
    }
  }

  std::string range_status() const {
    if (!settings_.ready()) return "Detection settings not verified; monitoring paused";
    char text[112];
    std::snprintf(text,sizeof(text),"Software %u cm / nominal gate %u (0.75m); radar delay %u s",
      settings_.saved().distance_cm,settings_.saved().gate(),settings_.saved().radar_timeout_s);
    return text;
  }

  std::string tv_status() const {
    if (!controller.tv_fresh(esphome::millis())) return "Unavailable / state expired";
    if (controller.power() == Power::Standby) return "Standby (will not wake)";
    return controller.mode() == Mode::PictureOff ? "Active / pictureOff" : "Active / picture visible";
  }

  const char *scene_presence() const {
    switch (frames_.scene(controller.radar_fresh(esphome::millis()))) {
      case ScenePresence::Near: return "Near";
      case ScenePresence::Far: return "Far";
      case ScenePresence::Absent: return "Absent";
      case ScenePresence::Unknown: return "Unknown";
      case ScenePresence::Unavailable: return "Unavailable";
    }
    return "Unavailable";
  }

 private:
  struct Reply {
    Request request{};
    Outcome outcome{Outcome::Uncertain};
    Power power{Power::Unknown};
    Mode mode{Mode::Unknown};
    uint32_t observed_at{0};
    int http_code{0};
  };
  struct Body {
    char bytes[1024]{};
    size_t size{0};
    bool overflow{false};
  };

  static esp_err_t http_event_(esp_http_client_event_t *event) {
    if (event->event_id == HTTP_EVENT_ON_DATA && event->data_len > 0) {
      auto *body = static_cast<Body *>(event->user_data);
      const size_t count = static_cast<size_t>(event->data_len);
      if (body->size + count >= sizeof(body->bytes)) {
        body->overflow = true;
        return ESP_FAIL;
      }
      std::memcpy(body->bytes + body->size, event->data, count);
      body->size += count;
      body->bytes[body->size] = '\0';
    }
    return ESP_OK;
  }

  Outcome rpc_(const char *method, const char *params, uint32_t token,
               JsonDocument &document, int &http_code) {
    char payload[200];
    const int count = std::snprintf(payload, sizeof(payload),
      "{\"method\":\"%s\",\"id\":%lu,\"params\":%s,\"version\":\"1.0\"}",
      method, static_cast<unsigned long>(token), params);
    if (count < 0 || static_cast<size_t>(count) >= sizeof(payload)) return Outcome::Uncertain;
    Body body{};
    esp_http_client_config_t config{};
    config.url = url_.c_str();
    config.method = HTTP_METHOD_POST;
    config.timeout_ms = 800;
    config.disable_auto_redirect = true;
    config.buffer_size = 512;
    config.buffer_size_tx = 1024;
    config.event_handler = http_event_;
    config.user_data = &body;
    const auto client = esp_http_client_init(&config);
    if (client == nullptr) return Outcome::Uncertain;
    esp_http_client_set_header(client, "Content-Type", "application/json");
    // Each RPC owns one short-lived socket; ask the TV to finish the response
    // and close, and still always release our handle below on every outcome.
    esp_http_client_set_header(client, "Connection", "close");
    // Header spelling is intentional: this TV requires X-Auth-PSK.
    esp_http_client_set_header(client, "X-Auth-PSK", psk_.c_str());
    esp_http_client_set_post_field(client, payload, count);
    const esp_err_t result = esp_http_client_perform(client);
    http_code = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (result != ESP_OK || http_code != 200 || body.overflow || body.size == 0)
      return Outcome::Uncertain;
    if (deserializeJson(document, body.bytes, body.size) ||
        !document["id"].is<uint32_t>() || document["id"].as<uint32_t>() != token)
      return Outcome::Uncertain;
    if (document["error"].is<JsonArray>() && document["error"][0].is<int>())
      return Outcome::Rejected;
    return document["result"].is<JsonArray>() ? Outcome::Success : Outcome::Uncertain;
  }

  static Mode decode_mode_(const char *value) {
    if (value == nullptr) return Mode::Unknown;
    if (std::strcmp(value, "off") == 0) return Mode::Normal;
    if (std::strcmp(value, "low") == 0) return Mode::Low;
    if (std::strcmp(value, "high") == 0) return Mode::High;
    if (std::strcmp(value, "pictureOff") == 0) return Mode::PictureOff;
    return Mode::Unknown;
  }

  Reply perform_(const Request &request) {
    Reply reply{};
    reply.request = request;
    JsonDocument document;
    if (request.kind == RpcKind::Query) {
      reply.observed_at = esphome::millis();
      reply.outcome = rpc_("getPowerStatus", "[]", request.token, document, reply.http_code);
      if (reply.outcome != Outcome::Success) return reply;
      const char *status = document["result"][0]["status"] | "";
      if (std::strcmp(status, "standby") == 0) {
        reply.power = Power::Standby;
        return reply;
      }
      if (std::strcmp(status, "active") != 0) { reply.outcome = Outcome::Uncertain; return reply; }
      reply.power = Power::Active;
      document.clear();
      reply.outcome = rpc_("getPowerSavingMode", "[]", request.token, document, reply.http_code);
      if (reply.outcome == Outcome::Success) {
        reply.mode = decode_mode_(document["result"][0]["mode"] | "");
        if (reply.mode == Mode::Unknown) reply.outcome = Outcome::Uncertain;
      }
      return reply;
    }
    const char *mode = "off";
    if (request.kind == RpcKind::Hide) mode = "pictureOff";
    else if (request.mode == Mode::Low) mode = "low";
    else if (request.mode == Mode::High) mode = "high";
    char params[48];
    std::snprintf(params, sizeof(params), "[{\"mode\":\"%s\"}]", mode);
    reply.outcome = rpc_("setPowerSavingMode", params, request.token, document, reply.http_code);
    return reply;
  }

  static void worker_(void *argument) {
    auto *self = static_cast<Runtime *>(argument);
    Request request{};
    for (;;) {
      if (xQueueReceive(self->requests_, &request, portMAX_DELAY) == pdTRUE) {
        const Reply reply = self->perform_(request);
        xQueueSend(self->replies_, &reply, portMAX_DELAY);
      }
    }
  }

  void log_original_() {
    ESP_LOGI("tv_trial", "Original radar: move gate=%u, still gate=%u, timeout=%u s, resolution=%s",
      original_.max_move, original_.max_still, original_.timeout, original_resolution_ == 0 ? "0.75m" : "0.2m");
    char move[48]{}, still[48]{};
    size_t m = 0, s = 0;
    for (size_t i = 0; i < 9; ++i) {
      m += std::snprintf(move + m, sizeof(move) - m, "%s%u", i ? "," : "", original_.move[i]);
      s += std::snprintf(still + s, sizeof(still) - s, "%s%u", i ? "," : "", original_.still[i]);
    }
    ESP_LOGI("tv_trial", "Original move thresholds=[%s]; still thresholds=[%s]", move, still);
  }

  static const char *settings_phase_(SettingsPhase phase, uint8_t gate) {
    static const char *const gates[]={"write_gate_0","write_gate_1","write_gate_2","write_gate_3",
      "write_gate_4","write_gate_5","write_gate_6","write_gate_7","write_gate_8"};
    switch (phase) {
      case SettingsPhase::Ready: return "ready";
      case SettingsPhase::Recover: return "recover_picture";
      case SettingsPhase::Read: return "read_radar";
      case SettingsPhase::Resolution: return "write_range";
      case SettingsPhase::Range: return "write_range";
      case SettingsPhase::Gate: return gate<9?gates[gate]:"verify_all";
      case SettingsPhase::Verify: return "verify_all";
      case SettingsPhase::Save: return "save";
      case SettingsPhase::Error: return "error";
    }
    return "error";
  }

  void publish_settings_() {
    SettingsView view;
    view.revision=settings_.revision(); view.settings=settings_.saved();
    view.pending=settings_.pending(); view.has_pending=!settings_.ready();
    view.status=settings_.busy()?SettingsStatus::Applying:(settings_.ready()?SettingsStatus::Ready:SettingsStatus::Error);
    view.phase=(boot_reconcile_ && settings_.phase()==SettingsPhase::Recover)?"boot_reconcile":
      settings_phase_(settings_.phase(),settings_.gate_index());
    view.error=settings_.error();
    portENTER_CRITICAL(&settings_lock_);
    mailbox_.publish(settings_operation_,view);
    portEXIT_CRITICAL(&settings_lock_);
  }

  bool current_hardware_matches_() const {
    const auto target=settings_.saved().radar_target();
    return hardware_.resolution==0 && hardware_.parameters.max_move==target.max_move &&
      hardware_.parameters.max_still==target.max_still && hardware_.parameters.timeout==target.timeout &&
      hardware_.parameters.sensitivities_match(target);
  }

  void configure_settings_(uint32_t now) {
    Settings requested; uint32_t operation=0;
    portENTER_CRITICAL(&settings_lock_);
    const bool accepted=mailbox_.take(requested,operation);
    portEXIT_CRITICAL(&settings_lock_);
    if (accepted) {
      settings_operation_=operation; boot_reconcile_=false;
      if (!settings_.begin(requested,now)) settings_.abort("settings_admission_failed");
      controller.set_radar_ready(false,now);
    }
    if (original_seen_ && original_resolution_seen_ && !original_logged_) {
      original_logged_=true; log_original_();
    }
    hardware_.periodic_fresh=periodic_seen_ && now-last_periodic_at_<=Controller::RADAR_FRESH_MS;
    if (settings_.busy()) {
      controller.set_radar_ready(false,now);
      const auto action=settings_.next(now,controller.owns_picture(),hardware_);
      const auto target=settings_.pending().radar_target();
      switch (action.kind) {
        case SettingsActionKind::ReadAll:
          radar_->read_all_info();
          break;
        case SettingsActionKind::WriteResolution:
          radar_->set_distance_resolution("0.75m");
          break;
        case SettingsActionKind::WriteRange:
          if (!move_->has_state() || !still_->has_state() || !timeout_->has_state() ||
              move_->state!=hardware_.parameters.max_move || still_->state!=hardware_.parameters.max_still ||
              timeout_->state!=hardware_.parameters.timeout) {
            settings_.abort("radar_parameters_not_initialized"); break;
          }
          move_->publish_state(target.max_move); still_->publish_state(target.max_still);
          timeout_->publish_state(target.timeout);
          radar_->set_max_distances_timeout();
          break;
        case SettingsActionKind::WriteGate: {
          const auto gate=action.gate;
          auto *move=move_thresholds_[gate]; auto *still=still_thresholds_[gate];
          if (move==nullptr || still==nullptr || !move->has_state() || !still->has_state()) {
            settings_.abort("gate_parameters_not_initialized"); break;
          }
          move->publish_state(target.move[gate]); still->publish_state(target.still[gate]);
          radar_->set_gate_threshold(gate);
          break;
        }
        case SettingsActionKind::Save: {
          // Persist only after the pure coordinator has checked every ACK and
          // the final full parameter / resolution readback.
          const bool saved=save_verified_settings(settings_.pending(),settings_.proposed_revision());
          settings_.complete_save(saved,esphome::millis());
          if (settings_.ready()) {
            frames_.set_near_distance(settings_.saved().distance_cm);
            controller.invalidate_radar_measurement(esphome::millis());
            controller.configure_timing(settings_.saved().near_ms,settings_.saved().clear_ms,esphome::millis());
            controller.set_radar_ready(true,esphome::millis());
            last_parameter_check_=esphome::millis();
            ESP_LOGI("tv_trial","Detection settings verified and saved; revision=%lu",
              static_cast<unsigned long>(settings_.revision()));
          }
          boot_reconcile_=false;
          break;
        }
        default: break;
      }
    } else if (settings_.ready()) {
      if (!current_hardware_matches_()) {
        settings_.abort("hardware_configuration_changed");
        controller.set_radar_ready(false,now);
      } else if (now-last_parameter_check_>=30000) {
        last_parameter_check_=now;
        radar_->read_all_info();
      }
    }
    if (!settings_.busy() && !settings_.ready()) controller.set_radar_ready(false,now);
    publish_settings_();
  }

  RadarFrames frames_{};
  RadarParameters original_{};
  SettingsHardware hardware_{};
  SettingsTransaction settings_{};
  SettingsMailbox mailbox_{};
  portMUX_TYPE settings_lock_=portMUX_INITIALIZER_UNLOCKED;
  uint32_t settings_operation_{0};
  bool boot_reconcile_{true};
  bool started_{false}, original_seen_{false}, original_resolution_seen_{false}, periodic_seen_{false},original_logged_{false};
  uint8_t original_resolution_{0xFF};
  uint32_t boot_at_{0}, last_parameter_check_{0}, last_periodic_at_{0};
  esphome::ld2410::LD2410Component *radar_{nullptr};
  esphome::number::Number *move_{nullptr}, *still_{nullptr}, *timeout_{nullptr};
  GateNumbers move_thresholds_{},still_thresholds_{};
  std::string url_, psk_;
  QueueHandle_t requests_{nullptr}, replies_{nullptr};
  TaskHandle_t worker_task_{nullptr};
};

inline Runtime runtime;
}  // namespace tv_trial
