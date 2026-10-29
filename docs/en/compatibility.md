[English](compatibility.md) | [简体中文](../compatibility.md)

# Compatibility and limitations

The current TV adapter targets only Sony BRAVIA IP control: it sends `getPowerStatus`, `getPowerSavingMode` and `setPowerSavingMode` to `/sony/system`, with the PSK in the `X-Auth-PSK` HTTP header. This Sony API path has been used on an actual TV, but that does not establish compatibility with every BRAVIA model or system version. Other TVs require a new adapter and verification; this is not generic HDMI control and does not claim support for Samsung or other brands.

The TV must support the relevant interface and PSK authentication and be reachable by the board on the local network. Enable the applicable remote/IP control setting on your TV, select pre-shared-key authentication and set a PSK. Menu paths vary by model, region and system version; consult the manual for your TV. [Sony BRAVIA Professional's IP control documentation](https://pro-bravia.sony.net/setup/device-settings/red-da/) describes authentication and setup for some models, but is not a compatibility guarantee for every consumer model. Enter your TV IP and PSK only in your local `firmware/secrets.yaml`; do not send them to AI services or publish them.

The device sends no wake or power-toggle commands. Monitoring pauses while the TV is in standby, while the user's intent may remain ON. Once the TV is turned on again, radar, TV connectivity and parameter health conditions must also be satisfied before monitoring resumes.

The physical hardware used is the Waveshare ESP32-C3-Zero-M and HLK-LD2410C. The `esp32-c3-devkitm-1` board identifier in the YAML is the current compilation target; it does not recommend purchasing a different board. See [Hardware](hardware.md) for wiring and model selection. The radar reports presence and distance; it cannot identify a child or guarantee angle or posture and must not be used as safety protection. Verify coverage and false triggers independently in the actual environment. The macOS, Windows and Linux instructions provide equivalent paths, but USB drivers and permissions, Python, Wi-Fi and TV models must be verified on each setup.
