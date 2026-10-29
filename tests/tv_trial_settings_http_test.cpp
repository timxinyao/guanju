#include "../firmware/tv_trial_settings_http.h"
#include <cassert>
#include <string>
using namespace tv_trial;
int main() {
  SettingsHttpSubmission submission;
  const std::string valid = R"({"expected_revision":42,"settings":{"distance_cm":150,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000,"sensitivity":"standard"}})";
  assert(parse_settings_submission(valid, submission));
  assert(submission.revision == 42 && submission.settings == Settings{});
  assert(parse_settings_submission(R"({"expected_revision":4294967295,"action":"defaults"})", submission));
  assert(submission.revision == UINT32_MAX && submission.settings == Settings{});
  const char *invalid[] = {
    "", "null", "{}", R"({"expected_revision":true,"action":"defaults"})",
    R"({"expected_revision":1.0,"action":"defaults"})", R"({"expected_revision":-1,"action":"defaults"})",
    R"({"expected_revision":4294967296,"action":"defaults"})",
    R"({"expected_revision":1,"action":"defaults","settings":{}})",
    R"({"expected_revision":1,"action":"defaults","action":"defaults"})",
    R"({"expected_revision":1,"action":"other"})", R"({"expected_revision":1,"action":"defaults"}junk)",
    R"({"expected_revision":1,"settings":{"distance_cm":150,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000}})",
    R"({"expected_revision":1,"settings":{"distance_cm":150,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000,"sensitivity":"standard","extra":1}})",
    R"({"expected_revision":1,"settings":{"distance_cm":true,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000,"sensitivity":"standard"}})",
    R"({"expected_revision":1,"settings":{"distance_cm":65586,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000,"sensitivity":"standard"}})",
    R"({"expected_revision":1,"settings":{"distance_cm":155,"near_ms":3000,"radar_timeout_s":1,"clear_ms":1000,"sensitivity":"standard"}})"
  };
  for (auto value : invalid) assert(!parse_settings_submission(value, submission));
  assert(settings_origin_allowed("", ""));
  assert(!settings_http_origin_allowed(true, "", "tv.local"));
  assert(settings_http_origin_allowed(false, "", ""));
  assert(settings_origin_allowed("http://TV.local:80", "tv.local"));
  assert(settings_origin_allowed("http://192.0.2.20:8080", "192.0.2.20:8080"));
  assert(!settings_origin_allowed("http://evil.local", "tv.local"));
  assert(!settings_origin_allowed("http://tv.local.evil", "tv.local"));
  assert(!settings_origin_allowed("https://tv.local", "tv.local"));
  SettingsHttpBody body;
  assert(body.append(reinterpret_cast<const uint8_t *>(valid.data()), 10, 0, valid.size()));
  assert(body.append(reinterpret_cast<const uint8_t *>(valid.data()+10), valid.size()-10, 10, valid.size()));
  assert(body.complete() && parse_settings_submission(body.str(), submission));
  SettingsHttpBuffers buffers;
  buffers.append(1,reinterpret_cast<const uint8_t *>(valid.data()),10,0,valid.size());
  buffers.append(2,reinterpret_cast<const uint8_t *>(valid.data()),11,0,valid.size());
  buffers.append(1,reinterpret_cast<const uint8_t *>(valid.data()+10),valid.size()-10,10,valid.size());
  buffers.append(2,reinterpret_cast<const uint8_t *>(valid.data()+11),valid.size()-11,11,valid.size());
  SettingsHttpBody first, second;
  assert(buffers.take(1,first) && buffers.take(2,second));
  assert(first.complete() && second.complete() && first.str()==valid && second.str()==valid);
  for(int fd=0;fd<9;++fd) buffers.append(fd,reinterpret_cast<const uint8_t *>(valid.data()),10,0,valid.size());
  assert(!buffers.take(0,first));
  buffers.append(8,reinterpret_cast<const uint8_t *>(valid.data()+10),valid.size()-10,10,valid.size());
  assert(buffers.take(8,second) && second.complete() && second.str()==valid);
  buffers.append(42,reinterpret_cast<const uint8_t *>(valid.data()),10,0,513);
  assert(buffers.take(42,first) && first.too_long());
  buffers.append(42,reinterpret_cast<const uint8_t *>(valid.data()),10,0,valid.size());
  buffers.append(42,reinterpret_cast<const uint8_t *>(valid.data()+10),valid.size()-10,10,valid.size());
  assert(buffers.take(42,first) && first.complete() && first.str()==valid);
  SettingsHttpBody bad;
  assert(!bad.append(reinterpret_cast<const uint8_t *>(valid.data()), 10, 1, valid.size()));
  assert(!bad.complete());
  SettingsHttpBody too_long;
  assert(!too_long.append(reinterpret_cast<const uint8_t *>(valid.data()), 10, 0, 513));
  assert(too_long.too_long());
}
