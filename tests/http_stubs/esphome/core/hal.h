#pragma once
#include <atomic>
#include <cstdint>
namespace esphome {
inline std::atomic<uint32_t> test_millis{100};
inline uint32_t millis() { return test_millis.load(); }
}
