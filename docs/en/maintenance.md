[English](maintenance.md) | [简体中文](../maintenance.md)

# Updates, recovery and maintenance

Use the firmware and webpage only on a trusted LAN. Production firmware uses native ESPHome OTA on TCP 3232 by default on ESP32; the repository sets no OTA password by default. The webpage itself does not support firmware uploads. Restrict network access and do not expose the device to the internet. `radar-observer.yaml` and `radar-network-observer.yaml` have no native OTA configured and should be updated over USB. Secrets, local build directories and firmware binaries can contain Wi-Fi credentials or the TV PSK; do not share or commit them.

## Update production firmware

Replace `<device-IP>` below with the address found in your router. First activate the installed virtual environment in the repository root. Keep the USB data cable available for recovery if the network becomes unreachable. The device UI is currently in Chinese.

1. On the device page, record whether automatic-function intent was ON or OFF and note the verified settings. Turn the automatic function off first; wait until the TV picture is restored and “本次恢复责任” (current restoration responsibility) in device details is no. If you cannot confirm this, restore the TV and troubleshoot the connection before updating; do not arbitrarily disconnect power from the TV.
2. Close extra device-page tabs and SSE connections to avoid exhausting connections. Confirm the computer and device are on a mutually reachable LAN.
3. Compile and upload using native OTA:

   ```sh
   python -m esphome compile firmware/tv-trial.yaml
   python -m esphome upload firmware/tv-trial.yaml --device "<device-IP>"
   ```

   `upload` uses the most recent build, so recompile after changing configuration. For the first USB installation, a network fault or a failed OTA, use `--device "<serial-port>"` for USB upload instead. Do not share command output containing secrets.
4. Wait for the device to restart and reconnect, then reopen the page. Check that settings status is `ready`, verify the original settings and confirm radar and TV status are normal. Restore intent ON or leave it OFF according to the choice recorded before updating, then test the function and picture restoration on site. Upload completion, HTTP 200 or a visible page does not establish that operation has been verified.

## Optional OTA password

To add authentication, add your chosen `ota_password` to **your local** `firmware/secrets.yaml` and keep it private. Add it to the existing `ota` configuration in your local `firmware/tv-trial.yaml`:

```yaml
ota:
  - platform: esphome
    password: !secret ota_password
```

When introducing or changing the password, use USB installation first so the password running on the board matches your subsequent local configuration. Do not put the real password in the repository or chat. Use OTA only after confirming this. If you lose the password or OTA fails, recover over USB. See the [official ESPHome OTA documentation](https://esphome.io/components/ota/esphome/); a password does not replace trusted network isolation.

## Troubleshooting and recovery

If the picture remains off after a device restart, restoration responsibility in RAM does not survive power loss. Restore it using the remote or webpage `Restore Picture` (the button also turns intent off), then check TV connectivity and settings. Monitoring pauses if settings fail or are uncertain; read the page status, check radar wiring, then retry or restore defaults. If flashing fails, preserve the current state, check board model, USB data cable, port and BOOT/RESET, and serial-flash following [getting started](getting-started.md). Do not erase flash as a default troubleshooting step.

When changing Wi-Fi or the TV IP/PSK, edit local secrets yourself, recompile and install; use USB if the device is unreachable. Periodically run `python tools/verify_project.py` without connecting a device; add `--config` to validate configurations with temporary example secrets. These checks do not replace real hardware testing.
