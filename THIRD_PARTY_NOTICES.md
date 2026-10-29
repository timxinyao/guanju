**English** | [简体中文](THIRD_PARTY_NOTICES.zh-CN.md)

# Third-party components and assets

The repository LICENSE covers source code, documentation, and illustrations created for this project; it does not change the licenses of external components. Dependencies are installed or built through their tools; the repository does not copy their complete source or personal compiled firmware.

| Project | Use | Upstream license |
| --- | --- | --- |
| ESPHome | Configuration compilation, LD2410 driver, and web/OTA infrastructure | [GNU GPL v3](https://github.com/esphome/esphome/blob/dev/LICENSE) |
| ESP-IDF | ESP32 system, HTTP, Wi-Fi, and storage | [Upstream license](https://github.com/espressif/esp-idf/blob/master/LICENSE) |
| ArduinoJson | JSON handling through ESPHome | [MIT](https://github.com/bblanchon/ArduinoJson/blob/7.x/LICENSE.txt) |

Complete firmware may include transitive dependencies of these projects. Before distributing compiled firmware, check the actual pinned versions and dependency licenses, along with any corresponding source and notice obligations; this project's MIT license alone does not describe every firmware component.

The icon and original wiring diagram were created for the project using image-generation tools; the enclosure diagram is an original project SVG. See the [icon notes](design/guanju-app-icon.md) (in Chinese). Official hardware manuals and product pages are linked only; vendor photos and manuals are not relicensed as original project work. Names and trademarks including Waveshare, Hi-Link, Sony, ESPHome, and Apple belong to their respective owners and are used to describe compatible hardware and operation.
