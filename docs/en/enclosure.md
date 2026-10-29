[English](enclosure.md) | [简体中文](../enclosure.md)

# Enclosure and installation

A ready-made **ABS or other non-metallic plastic project box** is the preferred option; a 3D printer is not required. The following assembly method and conceptual layout **are not a physically fitted enclosure design or a manufacturing drawing**.

![Conceptual layout and side view of a plastic project box](../assets/enclosure-layout.svg)

## Choose a box and test the layout

1. Disconnect USB power while leaving the two boards wired. Lay out the controller, radar and four wires. Point the radar's antenna face towards the room to be monitored and orient the controller's USB-C port towards an accessible side.
2. Measure the **overall length, width and maximum height** of both boards together with the headers, female connectors and naturally bent wires. Allow extra room for the enclosure walls, mounting hardware, plugging and unplugging, and cable routing. A plastic box with a nominal internal size around **100 × 70 × 35 mm** is a starting point for shopping, not a verified fit. External dimensions, internal dimensions, screw posts and actual connector sizes can differ substantially; check before buying.
3. Test-fit without sharply bending or crushing wires. Keep pins, solder joints and board backs from touching one another. The USB-C plug must insert fully and be easy to remove, and the lid must not press on wires or boards.

## Mounting and cable exit

1. With power disconnected, locate the USB-C opening or cable slot using the actual hardware. Remove boards and wires before cutting; remove burrs and debris before reinstalling them. Size the opening for your actual USB plug rather than measuring from the illustration.
2. Secure the backs of the boards with insulating pads, plastic standoffs or suitable mounting hardware. Keep solder joints and headers insulated from the other parts; do not press conductive materials onto the circuits. When fixing the radar, leave its antenna face unobstructed and do not cover it with tape or metal fasteners.
3. Leave a natural bend in the Dupont wires and secure them so pulling the USB cable cannot pull the connectors loose. Protect the edges of the cable slot with insulation. Before closing the lid, recheck the four connections and the unused OUT pin against the [wiring table](hardware.md#wire-with-power-disconnected).
4. Close the lid, reconnect power, and follow [Getting started](getting-started.md) and [Usage and calibration](usage.md) to verify the radar and web page. The controller LED alone is not a sufficient check.

## Placement and verification

- Point the radar's antenna face towards the area to be observed, ideally facing the centre in front of the TV. Identify the module's face using the [official Hi-Link product information](https://www.hlktech.com/Goods-239.html) and the actual module; do not infer pin orientation from the illustration.
- Do not use a metal enclosure or obstruct the antenna with the TV's metal back, metal brackets or thick objects. A non-metallic box does not guarantee unchanged radio performance: material, wall thickness, internal wiring and placement may all affect detection. Test with the lid closed.
- Do not let exposed boards or solder joints touch the TV's metal case. Secure the box against falling and cable strain, and do not block the TV's own ventilation.
- Test the centre and left and right edges by approaching from farther away and leaving. Also test stillness, multiple people, crouching and moving close to the screen, paying particular attention to very-close and edge blind spots. The radar cannot identify a child; the on-screen figure only represents a target and is not certified safety protection.
- Hardware observation gate 8 has a nominal maximum range of about 6 m; the software near-distance threshold defaults to 1.5 m. Actual coverage depends on the environment. Do not treat nominal values as measured boundaries; see [Hardware and practical limits](hardware.md#range-and-practical-limits).

This illustration has not been prototyped, physically fitted into an enclosure or 3D printed. Adapt it to the box and cables you actually purchase. Make both wiring and enclosure removable for future USB recovery and maintenance.
