#pragma once
// Only the transport boundary is replaced. The production handler, admission,
// serialization and origin checks run unchanged in the host HTTP contract test.
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>
struct httpd_req_t {
  std::string status,content_type,body;
  std::map<std::string,std::string> headers;
  unsigned sends{0};
};
constexpr int HTTPD_RESP_USE_STRLEN=-1;
inline void httpd_resp_set_status(httpd_req_t *r,const char *s) { r->status=s; }
inline void httpd_resp_set_type(httpd_req_t *r,const char *s) { r->content_type=s; }
inline void httpd_resp_set_hdr(httpd_req_t *r,const char *k,const char *v) { r->headers[k]=v; }
inline void httpd_resp_send(httpd_req_t *r,const char *body,int len) {
  ++r->sends; r->body=len<0?std::string(body):std::string(body,static_cast<size_t>(len));
}
inline int httpd_req_to_sockfd(httpd_req_t *) { return -1; }
enum WebRequestMethod { HTTP_GET,HTTP_POST,HTTP_PUT,HTTP_OPTIONS };
class AsyncWebServerRequest {
 public:
  static constexpr size_t URL_BUF_SIZE=128;
  std::string path{"/diagnostics"};
  WebRequestMethod verb{HTTP_GET};
  size_t length{0};
  std::map<std::string,std::string> headers;
  httpd_req_t response;
  std::string url_to(char *) const { return path; }
  WebRequestMethod method() const { return verb; }
  size_t contentLength() const { return length; }
  std::optional<std::string> get_header(const char *name) const {
    const auto found=headers.find(name);
    return found==headers.end()?std::nullopt:std::optional<std::string>(found->second);
  }
  explicit operator httpd_req_t *() { return &response; }
};
class AsyncWebHandler {
 public:
  virtual ~AsyncWebHandler()=default;
  virtual bool canHandle(AsyncWebServerRequest *) const { return false; }
  virtual void handleRequest(AsyncWebServerRequest *) {}
  virtual void handleBody(AsyncWebServerRequest *,uint8_t *,size_t,size_t,size_t) {}
};
namespace esphome::web_server_base {
struct TestWebServerBase {
  std::vector<AsyncWebHandler *> handlers;
  void add_handler(AsyncWebHandler *h) { handlers.push_back(h); }
  ~TestWebServerBase() { for(auto *h:handlers) delete h; }
};
inline TestWebServerBase test_base;
inline TestWebServerBase *global_web_server_base=&test_base;
}
