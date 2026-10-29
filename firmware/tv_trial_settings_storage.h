#pragma once
#include "tv_trial_settings.h"
#include "nvs.h"

namespace tv_trial {
// One NVS blob, in a namespace separate from ESPHome's intent / Wi-Fi data.
// A failed save never calls reset() or changes unrelated keys.
inline bool load_verified_settings(Settings &settings, uint32_t &revision) {
  nvs_handle_t handle;
  if (nvs_open("tv_trial",NVS_READONLY,&handle)!=ESP_OK) return false;
  SettingsRecord record{}; size_t size=record.size();
  const auto result=nvs_get_blob(handle,"settings_v1",record.data(),&size);
  nvs_close(handle);
  return result==ESP_OK && size==record.size() && decode_settings(record,settings,revision);
}
inline bool save_verified_settings(Settings settings, uint32_t revision) {
  if (!settings.valid()) return false;
  nvs_handle_t handle;
  if (nvs_open("tv_trial",NVS_READWRITE,&handle)!=ESP_OK) return false;
  const auto record=encode_settings(settings,revision);
  bool success=nvs_set_blob(handle,"settings_v1",record.data(),record.size())==ESP_OK;
  if (success) success=nvs_commit(handle)==ESP_OK;
  SettingsRecord readback{}; size_t size=readback.size();
  if (success) success=nvs_get_blob(handle,"settings_v1",readback.data(),&size)==ESP_OK &&
    size==record.size() && readback==record;
  nvs_close(handle);
  return success;
}
}  // namespace tv_trial
