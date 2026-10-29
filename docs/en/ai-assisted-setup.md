[English](ai-assisted-setup.md) | [简体中文](../ai-assisted-setup.md)

# Setup with an AI agent

Codex, Claude, Cursor and other agents that can read a local repository and run shell commands can help. Open the repository on your computer and have the agent read the project instructions. Connect the board over USB; the computer and device need to be on the same LAN and the computer needs serial-port access. AI does not run on the board, and the firmware does not need an OpenAI API key. The device serves its own webpage and runs the control logic independently; the page is not a Codex service. The device UI is currently in Chinese.

Keep your passwords yourself and edit `firmware/secrets.yaml` locally. Do not send Wi-Fi passwords, the TV PSK, firmware binaries, expanded configuration output or private photos to chat or publish them. AI can suggest actions but can make mistakes. Before flashing, personally check the device, port, wiring and commands to be run; a person must perform on-site calibration. If the board or port is uncertain, stop and check instead of letting the agent guess.

## Prompts to copy

```text
Please read this repository's AGENTS.md, README and docs/en/getting-started.md first, then inspect the actual firmware and scripts. I want to assemble and install Guanju on my computer. First explain the plan, identify the operating system and Python version, list USB serial ports and ask me to confirm the actual board; do not guess the board, pins or port. Check the wiring in docs/en/hardware.md, then use only radar-observer.yaml without connecting to the TV. Tell me how to check each step. Do not flash or control the TV without my confirmation. Do not read, print, upload or ask me to paste firmware/secrets.yaml into chat; I will fill it in locally myself. Do not upload firmware, logs or private photos.
```

Follow the agent's instructions to connect the board with a data cable and compare the port list before and after plugging it in. Ask it to compile the observer first, then USB-flash it after you confirm the port. Observe movement, stillness and departure to confirm that the radar works. If it does not, check the hardware first instead of proceeding to TV control.

```text
I have confirmed the observer works. Please check the network observer configuration and commands, explain how I can privately fill in the Wi-Fi and fallback hotspot passwords, then compile and USB-flash radar-network-observer.yaml after I confirm the port. Do not display secrets. Help me find the device IP using the router or mDNS, and explain why the fallback hotspot does not mean it joined home Wi-Fi.
```

Once network observation works, enable IP control and set the PSK yourself in the TV menu, then privately enter it in local secrets. Confirm Sony interface compatibility and the TV status before installing `tv-trial.yaml`. With the device page open, personally approach, remain still and leave from the actual viewing position, adjust parameters and watch for false triggers. The radar cannot identify people, and AI cannot replace on-site verification.

```text
Network observation is confirmed. Please use docs/en/getting-started.md and docs/en/usage.md to explain USB installation of production firmware, verification that settings are ready, and on-site calibration. I have entered the TV IP and PSK in the local file myself; do not read or echo them. First explain expected behavior, conditions that pause monitoring and how to restore the picture, then wait for my confirmation before acting.
```

For later updates, ask the agent to follow [maintenance](maintenance.md): record the intent state, turn it off and confirm restoration responsibility has cleared before compiling and uploading. After updating, wait for settings to become ready and check the original values. A successful command or HTTP 200 alone does not establish that the device is working.

## Handoff template

Share only sanitized facts between sessions; omit addresses, usernames, passwords, raw logs, compiled firmware and photos:

```text
System/version:
Board and wiring checked:
Current firmware stage: observer / network observer / production
Confirmed: serial enumeration / radar / Wi-Fi / TV interface / settings ready (describe each)
Symptoms and error summary without sensitive information:
Current intent state and whether picture restoration was confirmed:
Next steps and things I need to confirm on site:
```
