[English](getting-started.md) | [简体中文](../getting-started.md)

# Installation and first flash

This guide starts with a new ESP32-C3 and LD2410C that have been connected. Check power, pins and mounting direction against the [hardware guide](hardware.md) first; this guide does not replace on-site safety judgment. TV control currently implements specific Sony BRAVIA IP interfaces only; read [compatibility](compatibility.md) first. For help from an AI agent, also see [AI-assisted setup](ai-assisted-setup.md).

## 1. Prepare your computer and network

- A macOS, Windows or Linux computer with Python 3.12–3.14 (3.13 recommended) and Git. Initial dependency installation and compilation require internet access. Once built, the device runs on the local network without an always-on computer or internet connection.
- A USB-C **data cable** connecting the board. Native ESP32-C3 USB does not inherently use a CH340; if your particular board has a separate USB-to-serial chip, use the appropriate driver for that chip. Your computer needs serial-port access.
- Your home 2.4 GHz Wi-Fi name and password; the ESP32-C3 cannot join 5 GHz Wi-Fi. The TV and board should be on a trusted LAN where they can reach each other. Disable guest-network client isolation.
- Enable the applicable remote/IP control on your Sony TV, set your own pre-shared key (PSK), and find the TV's LAN IP. Menu names vary by model and system; see [compatibility](compatibility.md).

Clone or download the repository and open a terminal in its root directory (the directory containing `firmware` and `requirements.txt`). On macOS/Linux:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

If 3.13 is unavailable, create the virtual environment with an installed 3.12 or 3.14. If PowerShell blocks scripts, follow your local policy or run `.venv\Scripts\activate.bat` in Command Prompt. Activate the environment each time you open a new terminal. `requirements.txt` pins ESPHome; do not use `--offline` the first time, since the toolchain must be downloaded. See the [official ESPHome CLI guide](https://esphome.io/guides/cli/).

## 2. Fill in secrets privately

Copy the template (this command works in the activated environment on macOS, Linux and Windows):

```sh
python -c "from pathlib import Path; p=Path('firmware/secrets.yaml'); p.write_text(Path('firmware/secrets.example.yaml').read_text(encoding='utf-8'), encoding='utf-8') if not p.exists() else print('secrets.yaml already exists; unchanged')"
```

Open `firmware/secrets.yaml` in a local text editor and fill in `home_wifi_ssid`, `home_wifi_password`, `radar_ap_password`, `sony_tv_host` and `sony_tv_psk`. The fallback hotspot password must be at least 8 characters. Enter the TV IP alone, without `http://`. Use YAML strings and escape quotes or backslashes as required by YAML. Do not send secrets to AI chats, include them in screenshots, or commit them. Build outputs, firmware and expanded configuration output may also contain secrets; do not share them. `secrets.example.yaml` contains placeholders only.

## 3. Find the serial port and observe the radar

Run this once with the board disconnected and again after connecting the data cable; compare the new port:

```sh
python -m serial.tools.list_ports
```

Typical names are `/dev/cu.usbmodem...` on macOS, `/dev/ttyACM...` on Linux and `COM...` on Windows; use the port actually listed. Replace `<serial-port>` below with your port and keep the quotes. If no port appears, try another data cable or USB port, check the system device list, Linux serial group permissions and the board's BOOT/RESET procedure. Do not guess pins.

First compile the observer, which neither connects to a network nor controls the TV:

```sh
python -m esphome config firmware/radar-observer.yaml
python -m esphome compile firmware/radar-observer.yaml
```

The Waveshare ESP32-C3-Zero-M has no USB-to-UART bridge chip. Before flashing, disconnect the USB data cable, hold the board's BOOT button (GPIO9), then connect the cable and release BOOT after it enters download mode. If the cable is already connected, hold BOOT and press RESET once, then release BOOT after entering download mode. See the [official Waveshare board documentation](https://docs.waveshare.com/ESP32-C3-Zero). Run `python -m serial.tools.list_ports` again, confirm the actual port in download mode, replace `<serial-port>` and upload:

```sh
python -m esphome upload firmware/radar-observer.yaml --device "<serial-port>"
```

If the board remains in download mode after uploading, release BOOT and press RESET once to run the firmware. The port may change; list and confirm it again before viewing logs. Erasing flash is unnecessary:

```sh
python -m serial.tools.list_ports
python -m esphome logs firmware/radar-observer.yaml --device "<serial-port>"
```

Observe target and distance changes as a person moves, stays still and leaves; press Ctrl+C to exit logs. If nothing changes, check wiring, power and mounting direction first; see [usage](usage.md). Do not treat a retained distance as proof that someone is currently present. Once observation works as expected, compile and USB-flash `firmware/radar-network-observer.yaml` in the same way. This version connects to Wi-Fi and offers an observation page but still does not control the TV. It has no native OTA configured; continue to use USB until the production firmware is installed.

## 4. Connect and install production firmware

Find `tv-radar` in the router's connected-device list, or try `http://tv-radar.local/` on a network that supports mDNS. On a phone or computer on the same LAN, open `http://<device-IP>/`. If the password-protected `TV-Radar-Setup` fallback hotspot appears, the home Wi-Fi connection has failed; the hotspot does not prove the device joined your home network and is not a Wi-Fi setup portal. Check 2.4 GHz, password, signal and isolation, then edit local secrets and recompile/USB-flash.

After confirming radar and Wi-Fi, install production firmware with USB still connected:

```sh
python -m esphome config firmware/tv-trial.yaml
python -m esphome compile firmware/tv-trial.yaml
python -m esphome upload firmware/tv-trial.yaml --device "<serial-port>"
python -m esphome logs firmware/tv-trial.yaml --device "<serial-port>"
```

`config` may expand secrets; do not share its output. Wait for startup and settings verification, then check the TV connection, radar data and settings status on the device page and calibrate on site using the [usage guide](usage.md). The device UI is currently in Chinese. Only the production firmware configures native ESPHome OTA (TCP 3232 by default on ESP32); see [maintenance](maintenance.md) for subsequent updates. Firmware upload through the webpage is disabled; there is no Home Assistant native API or Wi-Fi configuration portal.

The device-free repository check is `python tools/verify_project.py`. Add `--config` to validate the three configurations in a temporary copy using example secrets without printing keys; install the dependencies first. This check also needs Node.js (CI uses 22), a C++ compiler and `sh`. On Windows, use Git Bash or a similar environment with Python, Node and a C++ compiler configured, or use Linux as in CI. The check cannot establish that wiring, TV or Wi-Fi work on real hardware.
