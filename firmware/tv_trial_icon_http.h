#pragma once

#include "tv_trial_app_icon_data.h"
#include "esphome/components/web_server_base/web_server_base.h"

namespace tv_trial {
class AppIconHttpHandler final : public AsyncWebHandler {
 public:
  bool canHandle(AsyncWebServerRequest *request) const override {
    if (request->method() != HTTP_GET) return false;
    char url[AsyncWebServerRequest::URL_BUF_SIZE];
    const auto path = request->url_to(url);
    return path == "/apple-touch-icon.png" || path == "/apple-touch-icon-v1.png" ||
           path == "/apple-touch-icon-precomposed.png";
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    request->send(request->beginResponse(200, "image/png", app_icon_png, sizeof(app_icon_png)));
  }
};
inline void register_app_icon_http() {
  // Runtime can be initialized again after a TV worker allocation failure.
  static bool registered = false;
  if (registered) return;
  esphome::web_server_base::global_web_server_base->add_handler(new AppIconHttpHandler());
  registered = true;
}
}  // namespace tv_trial
