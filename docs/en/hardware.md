[English](hardware.md) | [简体中文](../hardware.md)

# Hardware and wiring

This list is for the **Hi-Link HLK-LD2410C + Waveshare ESP32-C3-Zero-M** used by this project. Once assembled, follow [Getting started](getting-started.md) to flash the firmware, then [Usage and calibration](usage.md) to verify it. See [Enclosure and installation](enclosure.md) for mounting and placement.

## Shopping list

| Item | Quantity | What to check |
| --- | --- | --- |
| Hi-Link **HLK-LD2410C** 24 GHz presence radar | 1 | Choose the LD2410**C**, not the LD2410B or LD2410S; confirm the module's header pins are already soldered. Check the model and pin labels on the actual module. |
| Waveshare **ESP32-C3-Zero-M** | 1 | The Zero-**M** has pre-soldered headers for jumper wires. The Zero has no headers and requires soldering. Do not accidentally buy the ESP32-S3-Zero-M or another board. |
| 2.54 mm female-to-female Dupont wires | At least 4 | Both ends must be female. Choose a length that suits the mounting location and cable routing; a few spares are useful. |
| USB-C data cable | 1 | It must support data transfer for the initial flash from a computer. Choose the computer-side connector to suit your computer; a charge-only cable may not work. |
| Separate 5V USB power supply | 1 | Use a stable 5V USB supply compatible with the cable. It powers the board continuously in normal use. Complete flashing and checks before disconnecting the computer. |
| Non-metallic project enclosure and insulating mounting materials | As needed | Choose an ABS or other plastic enclosure, plus insulating pads, tape or plastic mounting hardware. Measure the boards, headers and bends in the wire ends before selecting the size. |

**Official documentation and purchase links (checked 2026-10-29):**

- [Hi-Link LD2410C official product and purchase page](https://www.hlktech.com/Goods-239.html): links to the manufacturer's Taobao, Tmall and JD stores; the specification lists 5V power and 3.3V serial logic.
- [Waveshare ESP32-C3-Zero-M official store](https://www.waveshare.net/shop/ESP32-C3-Zero-M.htm): check that the selected model is the Zero-M with pre-soldered headers. The [Waveshare series documentation](https://docs.waveshare.com/ESP32-C3-Zero) distinguishes the headerless Zero from the pre-soldered Zero-M.
- On Taobao or JD, you can also search for **`海凌科 HLK-LD2410C`** or **`微雪 ESP32-C3-Zero-M 已焊排针`**. Verify the exact model, header installation and included parts in each listing; do not rely only on its title or pictures.

## Wire with power disconnected

Unplug the controller's USB cable before connecting the four wires. TX and RX refer to each module's own transmit and receive directions: **radar TX goes to controller RX, and radar RX goes to controller TX**.

| LD2410C radar | ESP32-C3-Zero-M controller | Purpose |
| --- | --- | --- |
| VCC | 5V | Radar power; **do not connect to 3V3** |
| GND | GND | Common ground |
| TX | RX / GPIO20 | Radar transmits, controller receives |
| RX | TX / GPIO21 | Controller transmits, radar receives |
| OUT | Not connected | The project uses UART; leave OUT disconnected |

![Logical connections from the LD2410C to the ESP32-C3-Zero-M](../assets/wiring-guide.png)

The diagram is in Chinese and shows **logical connections, not the physical header layout**. Use the table above, the markings on each board and the [Waveshare pin documentation](https://docs.waveshare.com/ESP32-C3-Zero) to identify each pin. Do not count pins by the order shown in the diagram or rely on wire colours. The diagram's final request for photos was part of the original guided setup: check clear photos against the board markings yourself, and optionally ask an AI assistant to help. This project does not promise individual wiring support.

The radar serial connection uses **256000 baud, 8 data bits, no parity and 1 stop bit (8N1)**. Serial signals use 3.3V logic; 5V is for VCC power only. Check that all four connections are secure and adjacent pins are not shorted before reconnecting USB. Disconnect power immediately if the hardware overheats, smells unusual or is wired incorrectly.

Follow [Getting started](getting-started.md) to flash first, then inspect radar data in the web page and USB logs. A computer recognising the board, or an LED lighting up or changing colour, does not prove that the radar is wired or detecting correctly.

## Range and practical limits

The default software near-distance threshold is **1.5 m**, with **3 seconds** of approach confirmation. The radar's no-target delay is **1 second**, followed by **1 second** of application recovery confirmation; TV communication and readback take additional time. Hardware observation uses moving and still gate 8, with a manufacturer-stated nominal maximum of about 6 m. That is not a guaranteed effective range and is separate from the 1.5 m software near-distance threshold. The software allows 0.5–3.0 m, but the manufacturer specifies a detection range of approximately **0.75–6 m**; detection below 0.75 m is especially uncertain and cannot be guaranteed.

The radar reports target presence and auxiliary distance, not a child's identity. Very close or screen-adjacent positions, side edges, stillness, multiple-target occlusion and reflections can cause blind spots or false detections. This is not a certified child-safety device and does not replace supervision. After installation, have a person test the centre, left and right in front of the TV: approach naturally from farther away, remain still, crouch, move very close and leave. Adjust placement and thresholds to the actual room; see [Usage and calibration](usage.md).
