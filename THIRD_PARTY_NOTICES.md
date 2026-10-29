# 第三方组件与素材

仓库 LICENSE 适用于本项目新增源码、文档和自制图示，不改变外部组件的许可证。依赖通过工具安装/构建，仓库不复制其完整源码或个人编译固件。

| 项目 | 用途 | 上游许可入口 |
| --- | --- | --- |
| ESPHome | 配置编译、LD2410 驱动、网页/OTA 基础设施 | [GNU GPL v3](https://github.com/esphome/esphome/blob/dev/LICENSE) |
| ESP-IDF | ESP32 系统、HTTP、Wi-Fi 与存储 | [上游许可说明](https://github.com/espressif/esp-idf/blob/master/LICENSE) |
| ArduinoJson | 经 ESPHome 使用的 JSON 处理 | [MIT](https://github.com/bblanchon/ArduinoJson/blob/7.x/LICENSE.txt) |

完整固件还可能包含上述项目的传递依赖。需要分发编译固件时，应核对实际固定版本及依赖许可、相应源码和声明义务；本项目的 MIT 不能单独概括所有固件组成。

图标与原接线图由项目使用图像生成工具制作；外壳示意为本项目原创 SVG。制作说明见 [图标说明](design/guanju-app-icon.md)。官方硬件手册和产品页面只链接，不将厂商照片/手册当作本项目原创重新许可。Waveshare、Hi-Link、Sony、ESPHome、Apple 等名称和商标归各权利人所有，列名用于说明兼容硬件与工作方式。
