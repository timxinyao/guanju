#pragma once
#include "tv_trial_settings.h"
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace tv_trial {
struct SettingsHttpSubmission { uint32_t revision{0}; Settings settings{}; };
inline bool settings_http_origin_allowed(bool present, const std::string &origin, const std::string &host) {
  return !present || (!origin.empty() && settings_origin_allowed(origin,host));
}

class SettingsHttpBody {
 public:
  bool append(const uint8_t *data, size_t len, size_t index, size_t total) {
    if (total>512) { too_long_=true; return false; }
    if (bad_ || index!=size_ || index>total || len>total-index || (size_ && total!=total_)) {
      bad_=true; return false;
    }
    total_=total;
    for(size_t i=0;i<len;++i) data_[size_++]=static_cast<char>(data[i]);
    return true;
  }
  bool complete() const { return !bad_ && !too_long_ && size_==total_ && size_>0; }
  bool too_long() const { return too_long_; }
  std::string str() const { return std::string(data_,size_); }
 private:
  char data_[512]{};
  size_t size_{0}, total_{0};
  bool bad_{false}, too_long_{false};
};

// The caller serializes access. An interrupted request may never reach the
// final callback, so reclaim the oldest slot when all slots are occupied.
// Eviction can reject an in-flight request but never combines two bodies.
class SettingsHttpBuffers {
 public:
  void append(int fd, const uint8_t *data, size_t len, size_t index, size_t total) {
    if(fd<0) return;
    Slot *slot=find(fd);
    if(index==0) {
      if(!slot) {
        slot=&slots_[0];
        for(auto &candidate:slots_) {
          if(candidate.fd<0) { slot=&candidate; break; }
          if(candidate.order<slot->order) slot=&candidate;
        }
      }
      slot->fd=fd; slot->body=SettingsHttpBody{}; slot->order=++sequence_;
    }
    if(slot) slot->body.append(data,len,index,total);
  }
  bool take(int fd, SettingsHttpBody &body) {
    Slot *slot=find(fd);
    if(!slot) return false;
    body=slot->body; slot->fd=-1; return true;
  }
 private:
  struct Slot { int fd{-1}; uint64_t order{0}; SettingsHttpBody body{}; };
  Slot *find(int fd) { for(auto &slot:slots_) if(slot.fd==fd && fd>=0) return &slot; return nullptr; }
  std::array<Slot,8> slots_{};
  uint64_t sequence_{0};
};

// A deliberately narrow JSON reader: only the specified object, string and
// unsigned-integer forms are accepted. Duplicate or unknown keys are errors.
class SettingsHttpJsonReader {
 public:
  explicit SettingsHttpJsonReader(const std::string &s): text_(s) {}
  bool parse(SettingsHttpSubmission &out) {
    SettingsHttpSubmission candidate;
    unsigned seen=0;
    if (!take('{')) return false;
    do {
      std::string key;
      if (!string(key) || !take(':')) return false;
      if (key=="expected_revision") {
        if (seen&1 || !number(candidate.revision)) return false;
        seen|=1;
      } else if (key=="action") {
        std::string action;
        if (seen&6 || !string(action) || action!="defaults") return false;
        seen|=2;
      } else if (key=="settings") {
        if (seen&6 || !settings(candidate.settings)) return false;
        seen|=4;
      } else return false;
    } while (take(','));
    if (!take('}') || (seen!=3 && seen!=5)) return false;
    whitespace();
    if (pos_!=text_.size() || !candidate.settings.valid()) return false;
    out=candidate;
    return true;
  }
 private:
  void whitespace() { while(pos_<text_.size() && (text_[pos_]==' ' || text_[pos_]=='\t' || text_[pos_]=='\r' || text_[pos_]=='\n')) ++pos_; }
  bool take(char c) { whitespace(); if(pos_==text_.size() || text_[pos_]!=c) return false; ++pos_; return true; }
  bool string(std::string &out) {
    if (!take('"')) return false;
    out.clear();
    while(pos_<text_.size()) {
      unsigned char c=static_cast<unsigned char>(text_[pos_++]);
      if(c=='"') return true;
      if(c<0x20) return false;
      if(c=='\\') {
        if(pos_==text_.size()) return false;
        c=static_cast<unsigned char>(text_[pos_++]);
        switch(c) {
          case '"': case '\\': case '/': break;
          case 'b': c='\b'; break; case 'f': c='\f'; break; case 'n': c='\n'; break;
          case 'r': c='\r'; break; case 't': c='\t'; break;
          case 'u': {
            if(pos_+4>text_.size()) return false;
            unsigned value=0;
            for(int i=0;i<4;++i) {
              const char h=text_[pos_++];
              unsigned n;
              if(h>='0' && h<='9') n=static_cast<unsigned>(h-'0');
              else if(h>='a' && h<='f') n=static_cast<unsigned>(h-'a'+10);
              else if(h>='A' && h<='F') n=static_cast<unsigned>(h-'A'+10);
              else return false;
              value=value*16+n;
            }
            // Every accepted key and value is ASCII; non-ASCII can never match.
            if(value>0x7f) return false;
            c=static_cast<unsigned char>(value); break;
          }
          default: return false;
        }
      }
      out.push_back(static_cast<char>(c));
    }
    return false;
  }
  bool number(uint32_t &out) {
    whitespace();
    if(pos_==text_.size() || text_[pos_]<'0' || text_[pos_]>'9') return false;
    if(text_[pos_]=='0' && pos_+1<text_.size() && text_[pos_+1]>='0' && text_[pos_+1]<='9') return false;
    uint32_t n=0;
    while(pos_<text_.size() && text_[pos_]>='0' && text_[pos_]<='9') {
      unsigned digit=static_cast<unsigned>(text_[pos_++]-'0');
      if(n>(UINT32_MAX-digit)/10) return false;
      n=n*10+digit;
    }
    out=n; return true;
  }
  bool settings(Settings &out) {
    if(!take('{')) return false;
    unsigned seen=0;
    do {
      std::string key;
      if(!string(key) || !take(':')) return false;
      if(key=="sensitivity") {
        std::string value;
        if((seen&16) || !string(value)) return false;
        if(value=="low") out.sensitivity=Sensitivity::Low;
        else if(value=="standard") out.sensitivity=Sensitivity::Standard;
        else if(value=="high") out.sensitivity=Sensitivity::High;
        else return false;
        seen|=16;
      } else {
        unsigned bit=key=="distance_cm"?1:key=="near_ms"?2:key=="radar_timeout_s"?4:key=="clear_ms"?8:0;
        uint32_t n;
        if(!bit || (seen&bit) || !number(n) || n>(bit==4?UINT8_MAX:UINT16_MAX)) return false;
        if(bit==1) out.distance_cm=static_cast<uint16_t>(n);
        else if(bit==2) out.near_ms=static_cast<uint16_t>(n);
        else if(bit==4) out.radar_timeout_s=static_cast<uint8_t>(n);
        else out.clear_ms=static_cast<uint16_t>(n);
        seen|=bit;
      }
    } while(take(','));
    return seen==31 && take('}');
  }
  const std::string &text_;
  size_t pos_{0};
};
inline bool parse_settings_submission(const std::string &body, SettingsHttpSubmission &out) {
  return body.size()<=512 && SettingsHttpJsonReader(body).parse(out);
}
}  // namespace tv_trial

#ifdef USE_ESP32
#include <mutex>
#include <sys/socket.h>
#include "esphome/components/json/json_util.h"
#include "esphome/components/web_server_base/web_server_base.h"

namespace tv_trial {
class SettingsHttpHandler final : public AsyncWebHandler {
 public:
  explicit SettingsHttpHandler(SettingsEndpoint &endpoint): endpoint_(endpoint) {}
  bool canHandle(AsyncWebServerRequest *request) const override {
    char url[AsyncWebServerRequest::URL_BUF_SIZE];
    return request->url_to(url)=="/settings";
  }
  void handleBody(AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) override {
    const int fd=httpd_req_to_sockfd(static_cast<httpd_req_t *>(*request));
    {
      std::lock_guard<std::mutex> lock(mutex_);
      buffers_.append(fd,data,len,index,total);
    }
    if(total>512 && index==0) {
      // The IDF server consumes the body synchronously before handleRequest.
      // Respond now and interrupt further reads so a slow oversized upload
      // cannot monopolize its only HTTP task. A marker suppresses the later
      // handleRequest response if the entire body arrived in this chunk.
      const auto origin=request->get_header("Origin");
      const auto host=request->get_header("Host");
      auto *raw=static_cast<httpd_req_t *>(*request);
      httpd_resp_set_hdr(raw,"Connection","close");
      if(!settings_http_origin_allowed(origin.has_value(),origin.value_or(""),host.value_or("")))
        send_(request,"403 Forbidden",R"({"error":"forbidden"})");
      else
        send_(request,"413 Payload Too Large",R"({"error":"too_large"})");
      if(len<total && fd>=0) shutdown(fd,SHUT_RD);
    }
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    const int fd=httpd_req_to_sockfd(static_cast<httpd_req_t *>(*request));
    SettingsHttpBody body;
    bool found=false;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      found=buffers_.take(fd,body);
    }
    if(request->method()==HTTP_POST && found && body.too_long()) return;
    const auto origin=request->get_header("Origin");
    const auto host=request->get_header("Host");
    if(!settings_http_origin_allowed(origin.has_value(),origin.value_or(""),host.value_or(""))) {
      send_(request,"403 Forbidden",R"({"error":"forbidden"})"); return;
    }
    if(request->method()==HTTP_GET) { send_view_(request,"200 OK",endpoint_.settings_snapshot()); return; }
    if(request->method()!=HTTP_POST) { send_(request,"405 Method Not Allowed",R"({"error":"method_not_allowed"})"); return; }
    if(request->contentLength()>512) { send_(request,"413 Payload Too Large",R"({"error":"too_large"})"); return; }
    auto type=request->get_header("Content-Type").value_or("");
    for(auto &c:type) if(c>='A' && c<='Z') c=static_cast<char>(c-'A'+'a');
    const auto semicolon=type.find(';');
    auto media=type.substr(0,semicolon);
    while(!media.empty() && (media.back()==' ' || media.back()=='\t')) media.pop_back();
    if(media!="application/json") { send_(request,"400 Bad Request",R"({"error":"invalid_settings"})"); return; }
    SettingsHttpSubmission submission;
    if(!found || !body.complete() || !parse_settings_submission(body.str(),submission)) {
      send_(request,"400 Bad Request",R"({"error":"invalid_settings"})"); return;
    }
    const auto response=endpoint_.submit_settings(submission.revision,submission.settings);
    switch(response.result) {
      case SettingsSubmitResult::Accepted: send_view_(request,"202 Accepted",response.view); break;
      case SettingsSubmitResult::Busy: send_error_(request,"busy",response.view.revision); break;
      case SettingsSubmitResult::RevisionConflict: send_error_(request,"revision_conflict",response.view.revision); break;
      case SettingsSubmitResult::Invalid: send_(request,"400 Bad Request",R"({"error":"invalid_settings"})"); break;
    }
  }
 private:
  static const char *sensitivity_(Sensitivity value) {
    switch(value) { case Sensitivity::Low: return "low"; case Sensitivity::High: return "high"; default: return "standard"; }
  }
  static void write_settings_(JsonObject obj, const Settings &s) {
    obj["distance_cm"]=s.distance_cm; obj["near_ms"]=s.near_ms;
    obj["radar_timeout_s"]=s.radar_timeout_s; obj["clear_ms"]=s.clear_ms;
    obj["sensitivity"]=sensitivity_(s.sensitivity);
  }
  static void send_(AsyncWebServerRequest *request, const char *status, const char *json) {
    auto *raw=static_cast<httpd_req_t *>(*request);
    httpd_resp_set_status(raw,status);
    httpd_resp_set_type(raw,"application/json");
    httpd_resp_send(raw,json,HTTPD_RESP_USE_STRLEN);
  }
  static void send_error_(AsyncWebServerRequest *request,const char *error,uint32_t revision) {
    auto json=esphome::json::build_json([&](JsonObject root) { root["error"]=error; root["revision"]=revision; });
    send_(request,"409 Conflict",json.c_str());
  }
  static void send_view_(AsyncWebServerRequest *request,const char *status,const SettingsView &view) {
    auto json=esphome::json::build_json([&](JsonObject root) {
      root["revision"]=view.revision;
      root["status"]=view.status==SettingsStatus::Ready?"ready":view.status==SettingsStatus::Applying?"applying":"error";
      root["phase"]=view.phase;
      write_settings_(root["settings"].to<JsonObject>(),view.settings);
      if(view.has_pending) write_settings_(root["pending"].to<JsonObject>(),view.pending);
      else root["pending"]=nullptr;
      if(view.error) root["error"]=view.error; else root["error"]=nullptr;
    });
    send_(request,status,json.c_str());
  }
  SettingsEndpoint &endpoint_;
  std::mutex mutex_;
  SettingsHttpBuffers buffers_{};
};
inline void register_settings_http(SettingsEndpoint &endpoint) {
  esphome::web_server_base::global_web_server_base->add_handler(new SettingsHttpHandler(endpoint));
}
}  // namespace tv_trial
#endif
