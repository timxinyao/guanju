#pragma once
#include "tv_trial_diagnostics.h"
#include "tv_trial_settings.h"
#ifdef USE_ESP32
#include <mutex>
#include <sys/socket.h>
#include "esphome/components/web_server_base/web_server_base.h"
#include "esphome/core/hal.h"

namespace tv_trial {
class DiagnosticsHttpHandler final : public AsyncWebHandler {
 public:
  explicit DiagnosticsHttpHandler(DiagnosticsEndpoint &endpoint): endpoint_(endpoint) {}
  bool canHandle(AsyncWebServerRequest *request) const override {
    char url[AsyncWebServerRequest::URL_BUF_SIZE];
    if(request->url_to(url)!="/diagnostics") return false;
    // ESPHome calls canHandle once when admitting each request, including raw
    // POST before its body callbacks. Socket reuse clears an aborted upload's
    // marker. Only bounded socket IDs are retained, never stack request pointers.
    take_rejected_(httpd_req_to_sockfd(static_cast<httpd_req_t *>(*request)));
    return true;
  }
  void handleBody(AsyncWebServerRequest *request,uint8_t *,size_t len,size_t index,size_t total) override {
    if(index!=0) return;
    // This endpoint never accepts an upload. IDF consumes bodies before the
    // request callback; reject immediately rather than buffering or draining a
    // slow arbitrary-size body on its HTTP task. No request pointer is retained.
    const int fd=httpd_req_to_sockfd(static_cast<httpd_req_t *>(*request));
    mark_rejected_(fd);
    reject_body_(request);
    if(len<total && fd>=0) shutdown(fd,SHUT_RD);
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    const int fd=httpd_req_to_sockfd(static_cast<httpd_req_t *>(*request));
    if(take_rejected_(fd)) return;
    // GET and form POST bypass handleBody in ESPHome's IDF adapter. Explicitly
    // reject them here and stop reads; otherwise a slow GET body could monopolize
    // the HTTP task while the framework tries to drain it after this callback.
    if(request->contentLength()>0) {
      reject_body_(request);
      if(fd>=0) shutdown(fd,SHUT_RD);
      return;
    }
    if(!origin_allowed_(request)) { send_(request,"403 Forbidden",R"({"error":"forbidden"})"); return; }
    if(request->method()!=HTTP_GET) { method_not_allowed_(request); return; }
    std::unique_lock<std::mutex> lock(mutex_,std::try_to_lock);
    if(!lock.owns_lock()) { retry_(request,"busy"); return; }
    const auto admission=admission_.acquire(esphome::millis());
    if(admission!=DiagnosticsAdmission::Result::Accepted) { retry_(request,"rate_limited"); return; }
    endpoint_.diagnostics_snapshot(snapshot_);
    if(diagnostics_json(snapshot_,body_,sizeof(body_))) send_(request,"200 OK",body_);
    else send_(request,"503 Service Unavailable",R"({"error":"snapshot_too_large","retry_after_ms":1000})");
    admission_.release();
  }
 private:
  struct RejectedBody { int fd{-1}; bool rejected{false}; };
  bool take_rejected_(int fd) const {
    std::lock_guard<std::mutex> lock(body_mutex_);
    for(auto &slot:rejected_) if(slot.rejected && slot.fd==fd) { slot.rejected=false; return true; }
    return false;
  }
  void mark_rejected_(int fd) {
    std::lock_guard<std::mutex> lock(body_mutex_);
    auto *selected=&rejected_[0];
    for(auto &slot:rejected_) {
      if(slot.rejected && slot.fd==fd) { selected=&slot; break; }
      if(!slot.rejected) selected=&slot;
    }
    *selected={fd,true};
  }
  static void reject_body_(AsyncWebServerRequest *request) {
    if(!origin_allowed_(request)) send_(request,"403 Forbidden",R"({"error":"forbidden"})");
    else if(request->method()!=HTTP_GET) method_not_allowed_(request);
    else send_(request,"400 Bad Request",R"({"error":"body_not_allowed"})");
  }
  static bool origin_allowed_(AsyncWebServerRequest *request) {
    const auto origin=request->get_header("Origin");
    return !origin.has_value() || (!origin->empty() && settings_origin_allowed(*origin,request->get_header("Host").value_or("")));
  }
  static void send_(AsyncWebServerRequest *request,const char *status,const char *json) {
    auto *raw=static_cast<httpd_req_t *>(*request);
    httpd_resp_set_status(raw,status); httpd_resp_set_type(raw,"application/json");
    httpd_resp_set_hdr(raw,"Cache-Control","no-store");
    httpd_resp_set_hdr(raw,"Connection","close");
    httpd_resp_send(raw,json,HTTPD_RESP_USE_STRLEN);
  }
  static void method_not_allowed_(AsyncWebServerRequest *request) {
    httpd_resp_set_hdr(static_cast<httpd_req_t *>(*request),"Allow","GET");
    send_(request,"405 Method Not Allowed",R"({"error":"method_not_allowed"})");
  }
  static void retry_(AsyncWebServerRequest *request,const char *error) {
    httpd_resp_set_hdr(static_cast<httpd_req_t *>(*request),"Retry-After","1");
    send_(request,"429 Too Many Requests",std::strcmp(error,"busy")==0?
      R"({"error":"busy","retry_after_ms":1000})":R"({"error":"rate_limited","retry_after_ms":1000})");
  }
  DiagnosticsEndpoint &endpoint_;
  std::mutex mutex_;
  mutable std::mutex body_mutex_;
  mutable std::array<RejectedBody,8> rejected_{};
  DiagnosticsAdmission admission_{};
  // One endpoint-owned response buffer, independent of client count. IDF's
  // synchronous send completes before the lock is released; no queued bodies.
  DiagnosticsSnapshot snapshot_{};
  char body_[DIAGNOSTICS_MAX_BYTES]{};
};
inline void register_diagnostics_http(DiagnosticsEndpoint &endpoint) {
  static bool registered=false;
  if(registered) return;
  esphome::web_server_base::global_web_server_base->add_handler(new DiagnosticsHttpHandler(endpoint));
  registered=true;
}
}  // namespace tv_trial
#endif
