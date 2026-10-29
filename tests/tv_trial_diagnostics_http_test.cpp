#define USE_ESP32
#include "../firmware/tv_trial_diagnostics_http.h"
#include <cassert>
#include <condition_variable>
#include <chrono>
#include <mutex>
#include <thread>
using namespace tv_trial;
struct CachedEndpoint : DiagnosticsEndpoint {
  unsigned copies{0};
  bool block{false},entered{false},released{false},overflow{false};
  std::mutex mutex;
  std::condition_variable condition;
  void diagnostics_snapshot(DiagnosticsSnapshot &out) override {
    std::unique_lock<std::mutex> lock(mutex);
    ++copies;
    if(block) { entered=true; condition.notify_all(); condition.wait(lock,[&]{return released;}); }
    out={}; out.sequence=42; std::strcpy(out.session_id,"0123456789abcdef");
    if(overflow) {
      out.event_count=12;
      for(auto &e:out.events) {
        std::memset(e.type,1,sizeof(e.type)-1);
        std::memset(e.detail,1,sizeof(e.detail)-1);
      }
    }
  }
};
int main() {
  CachedEndpoint endpoint;
  DiagnosticsHttpHandler handler(endpoint);
  AsyncWebServerRequest request;
  assert(handler.canHandle(&request));
  request.path="/events"; assert(!handler.canHandle(&request)); request.path="/diagnostics";
  handler.handleRequest(&request);
  assert(request.response.status=="200 OK");
  assert(request.response.body.find("\"sequence\":42")!=std::string::npos);
  assert(request.response.headers["Cache-Control"]=="no-store");
  assert(request.response.headers["Connection"]=="close");
  assert(endpoint.copies==1);
  AsyncWebServerRequest second;
  handler.handleRequest(&second);
  assert(second.response.status=="429 Too Many Requests");
  assert(second.response.headers["Retry-After"]=="1");
  assert(second.response.body==R"({"error":"rate_limited","retry_after_ms":1000})");
  assert(endpoint.copies==1);
  esphome::test_millis=1100;
  AsyncWebServerRequest post; post.verb=HTTP_POST;
  handler.handleRequest(&post);
  assert(post.response.status=="405 Method Not Allowed");
  assert(post.response.headers["Allow"]=="GET");
  AsyncWebServerRequest cross;
  cross.headers={{"Origin","http://other.local"},{"Host","tv.local"}};
  handler.handleRequest(&cross);
  assert(cross.response.status=="403 Forbidden");
  assert(endpoint.copies==1);
  // ESPHome sends GET and form POST directly to handleRequest, without a
  // handleBody callback. These paths must reject, not silently return.
  AsyncWebServerRequest get_body; get_body.length=100000;
  handler.handleRequest(&get_body);
  assert(get_body.response.status=="400 Bad Request" && get_body.response.sends==1);
  AsyncWebServerRequest form; form.verb=HTTP_POST; form.length=10;
  form.headers["Content-Type"]="application/x-www-form-urlencoded";
  handler.handleRequest(&form);
  assert(form.response.status=="405 Method Not Allowed" && form.response.sends==1);
  AsyncWebServerRequest body; body.verb=HTTP_POST; body.length=100000;
  handler.handleBody(&body,nullptr,10,0,100000);
  handler.handleRequest(&body);
  assert(body.response.status=="405 Method Not Allowed" && body.response.sends==1);
  // Aborted raw upload can omit handleRequest. A new request on the same
  // socket must clear the old rejection marker during route admission.
  AsyncWebServerRequest aborted; aborted.verb=HTTP_POST; aborted.length=100000;
  assert(handler.canHandle(&aborted));
  handler.handleBody(&aborted,nullptr,10,0,100000);
  AsyncWebServerRequest reused; reused.length=100000;
  assert(handler.canHandle(&reused));
  handler.handleRequest(&reused);
  assert(reused.response.status=="400 Bad Request" && reused.response.sends==1);
  assert(endpoint.copies==1);
  // Concurrent readers never wait with a second 4 KiB response or snapshot.
  endpoint.block=true;
  AsyncWebServerRequest held;
  std::thread active([&]{handler.handleRequest(&held);});
  {
    std::unique_lock<std::mutex> lock(endpoint.mutex);
    assert(endpoint.condition.wait_for(lock,std::chrono::seconds(2),[&]{return endpoint.entered;}));
  }
  AsyncWebServerRequest concurrent;
  handler.handleRequest(&concurrent);
  assert(concurrent.response.status=="429 Too Many Requests");
  assert(concurrent.response.body==R"({"error":"busy","retry_after_ms":1000})");
  { std::lock_guard<std::mutex> lock(endpoint.mutex); endpoint.released=true; }
  endpoint.condition.notify_all(); active.join();
  assert(held.response.status=="200 OK");
  assert(endpoint.copies==2);
  endpoint.overflow=true;
  esphome::test_millis=2100;
  AsyncWebServerRequest too_large;
  handler.handleRequest(&too_large);
  assert(too_large.response.status=="503 Service Unavailable");
  assert(too_large.response.body==R"({"error":"snapshot_too_large","retry_after_ms":1000})");
  endpoint.overflow=false;
  esphome::test_millis=3100;
  AsyncWebServerRequest recovered;
  handler.handleRequest(&recovered);
  assert(recovered.response.status=="200 OK"); // Failure releases single-flight admission.
}
