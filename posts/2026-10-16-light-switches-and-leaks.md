---
title: Light switches that cut baked light, and light leaking through thin walls
date: 2026-10-16
order: 1
summary: Switchable lamps that remove their baked bounce light, editor screenshots that no longer stall the frame, and two causes of light leaking through 7 cm walls.
tags: lighting, tools, renderer
cover: /images/2026-10-16-light-switches-and-leaks/corridor.jpg
---

The house had two storeys, a flashlight held in the player's hand, and an editor that an AI agent can drive over a named pipe. It still behaved like a painting, because the wall lamps were on and could not be turned off. This post covers the work that changed that: a fix to the editor's screenshot path on the 15th, then light switches and a search for light leaking through walls on the 16th.

## Editor screenshots without a stall

When an agent edits a scene through my MCP server, it takes a screenshot after almost every change. The editor log filled with warnings such as `Editor hitch: 301 ms`. Each screenshot froze the editor for about a third of a second.

I timed each stage of one capture in the Release editor, with a 1540 by 966 viewport:

| Stage | Time |
|---|---|
| Render an extra frame and wait for the GPU to finish it | 16.5 ms |
| Encode the PNG | 136 ms |
| Save a copy of the PNG, which encoded it a second time | 138 ms |
| Encode the JPEG reply | 6 ms |
| Base64 and JSON | 1.4 ms |

All of it ran on the main thread, inside the frame. I made three changes.

1. **Encode once.** The saved copy is now the bytes of the PNG that was just encoded. That halves the cost.
2. **Encode off the main thread.** The pipe already has a background thread that waits to send each reply. A tool can now return a "finish" step, slow work that needs nothing from the scene, and that thread runs it before sending the response.
3. **Do not render an extra frame.** This one needs some background.

> **Background: why waiting for the GPU is expensive.** The CPU records commands and submits them. The GPU executes them later, and with vsync on there are usually a couple of frames queued. If the CPU asks for a picture and blocks until it exists, it waits behind every frame already in the queue. The alternative is to avoid waiting. The CPU asks the GPU to copy the finished frame into a readback buffer as part of a normal frame and carries on. The GPU signals a fence when the copy is done, and the CPU reads the pixels a frame or two later.

My first screenshot rendered an extra frame and waited for it, which meant waiting behind the vsync queue. After the first two changes it still cost 16 to 20 ms, just over the 20 ms hitch threshold for full-window captures. Now the renderer records the copy into its readback buffer during the next ordinary frame, and nothing waits. The pending reply is completed when the fence has passed. If the editor closes mid-capture, the reply fails cleanly. If the pixels never arrive, it gives up with an error after 10 seconds.

In the Release editor, eight screenshots covering the viewport and the full window, as PNG and JPEG, plus a debug-view capture, logged no hitch at all. Before the change each one logged 299 to 302 ms. An agent still waits 0.2 to 0.7 seconds for its reply, mostly the PNG encoding, which takes about 136 ms for 1.5 megapixels. The editor no longer freezes while it waits.

![A live capture of the house's corridor](/images/2026-10-16-light-switches-and-leaks/live-viewport-jpeg.jpg "A live viewport capture taken over the pipe while the editor kept running at full speed.")

## Switches that cut baked light

I wanted a switch in every room with a lamp and switches for the hall lights. The requirement that shaped the work was that a room must go truly dark when its lamp is off.

### Why a switched-off lamp was not dark

The house is lit with baked light. A bake is an offline calculation that traces rays from every lamp, bounces them around the rooms and stores the result. Two stores matter here. A lightmap is a texture on the surfaces that holds the light arriving at each texel. Irradiance probes are a grid of samples in the air that hold the light arriving from around that point, and moving objects and the fog read them. At runtime the engine only reads these. That is cheap, and it gives soft, believable bounce light.

The bounce light is frozen at bake time. A script could switch a lamp off and its direct light disappeared, but the soft glow it had already poured into the lightmap stayed. A room kept the light of a lamp that was off.

> **Background: light adds up.** For a static scene, light transport is linear in the light sources. The lightmap you get from lamps A and B together equals the lightmap from A alone plus the lightmap from B alone. This is why baked light can be split. If each switchable group of lamps gets its own bake layer, the runtime can show `base + power_A * layerA + power_B * layerB`. Setting a power to zero removes exactly that group's contribution, direct and bounced, and leaves everything else as it was.

### Circuits as bake layers

A light now has a `circuit` name, and every light on one circuit shares one bake layer. The ground corridor's twelve lamps are a single circuit and therefore a single layer. The layer limit went from 3 to 15, and the house uses 8 plus the base layer for lights that never switch, such as the moonlit window.

Layers are mostly zero, because a lamp's light stays in its room. I store them as runs of zeros. The eight layers added 5.8 MB to the lightmap file (12.3 to 18.1 MB) and 3.5 MB to the probe file (6.8 to 10.3 MB). Stored in full they would have added about 65 MB. The bake takes 47 seconds.

The runtime cost is limited to rooms that are actually dark. Each frame the renderer lists the layers that are not at full power, each with a box around its lamps grown by 1.5 m so that bounce through a doorway is covered. A pixel reads a layer only if it is inside that layer's box. With every lamp on, the list is empty and the cost is zero. VRAM went from 401 to 469 MB for the layers. With every circuit off, a frame costs 0.07 to 0.21 ms more on the GPU.

### Power belongs to the session

The game session keeps the set of circuits that are off. A light's drawn intensity is its own intensity multiplied by its circuit's power, and the intensity stored in the scene stays whatever scripts set. A flickering lamp that is switched off therefore stays off, and when power returns the flicker resumes. The lamp, its globe glow, its shadows and its bounce light all go out together, and stay out when the view is rebuilt.

### The switch

I modelled the switch in Blender with a script, so that it can be rebuilt: a 7.5 by 12 cm aged-brass plate with two slotted dome screws and a bat toggle. In the editor it is a compound. The plate is an interactable with a thin collider so the interaction ray finds it, and the toggle is a separate moving part. A press flips the toggle, cuts the circuit and changes the prompt from "Turn off the light" to "Turn on the light". A click sound is queued but silent until I build the audio system.

![The brass light switch in Blender](/images/2026-10-16-light-switches-and-leaks/blender-switch.jpg "The switch as modelled in Blender: brass plate, two slotted screws and a bat toggle.")

Each switch sits 1.2 m above the floor on the latch side of its room's door. The ground corridor's switch is beside the foyer entry, the landing's is at the head of the stairs, and the bathroom's is in the hall because the latch side inside runs into the nursery wall. Pressing interact used to rebuild the whole render view. It now patches the one interaction in place.

![The ground corridor lit and switched off](/images/2026-10-16-light-switches-and-leaks/corridor.jpg "The ground corridor, lit (left) and after switching off its twelve-lamp circuit (right). Only the far window remains lit.")

Testing found two faults. The toggle moved 0.6 degrees instead of 34, because my script passed radians to a rotation that is in degrees. In three papered rooms only the screws and toggle showed, because the wallpaper stands 4 mm out from the wall and the plate is 3.5 mm thick, so the paper covered it. Those three switches now sit on the paper.

## Light leaking through walls

With switches working, I could see a problem that had been present for weeks. In a dark room, light seemed to arrive through the walls from the corridor, especially at corners, and the walls looked glossy. While a room's own lamp was on it drowned out the leaks. Switched off, they showed.

To measure them I rendered each room twice at a fixed exposure, once with only its own circuit off and once with every circuit off. The difference is light from other circuits, and it should only arrive through doorways.

> **Background: why baked and volumetric light leaks.** Every way of storing or limiting light in a real-time engine has a width. A light's clipping box fades over some distance, a lightmap texel covers a patch of surface, a probe stands for a region of air, and a fog cell covers a slab of the view frustum. A wall has a thickness. If that thickness is smaller than the width of the representation, a sample or the interpolation between two samples straddles the wall and picks up light from the other side. The usual defences are to clip lights to their rooms, to make soft edges smaller than the geometry that stops light, and to keep samples on the right side of surfaces. The house has 7 cm inner walls, so all of these widths matter.

### Cause one: a fade wider than the wall

Each lamp is clipped to a box around its room so it does not light the next one. Past the box edge its light falls to zero linearly over a fade distance, which avoids a hard line. In the shader the factor is `1 - outsideDistance / fade`. The fade was 15 cm for every lamp.

A corridor lamp's box ended at the corridor face of the parlor wall. The parlor face is 7 cm further, so the parlor wall received `1 - 7/15`, about 53% of the corridor lamp's light. The chair rail and baseboard, which stand out from the wall's parlor face and so lie further from the box edge, received about 40%. That is the thin lit line along the trim, and the soft glow on a wall where a lamp hangs on the other side. The bake used the same fade, so the leak was baked in.

![A cross-section of a 7 cm wall with two fade lengths](/images/2026-10-16-light-switches-and-leaks/leak-geometry.svg "Light factor across the wall for a 15 cm fade and a 4 cm fade. The lamp's box ends at the corridor face.")

A light now has its own `boundsFade`. The room-fitting tools, the `wall_lamp` and `window` compounds and `light_fit_bounds`, measure the wall behind each face of the box and set the fade to 80% of the thinnest. In the house that is about 4 cm. At open faces such as doorways nothing changes visibly, because the lamp's light has already fallen to almost nothing there. The default stays 15 cm so the hallway and other scenes are unchanged until I refit them.

### Cause two: the fog's grid

After that a faint glow remained, and a fog-only debug view showed that it was the volumetric fog. The fog is stored in a grid of view-aligned cells, 160 by 90 by 64 at high quality, with slices spaced exponentially in depth. At 1 m from the camera one cell is about 10 cm deep, which is deeper than the wall. A pixel on the wall read the fog integrated up to its own depth, and the interpolation reached into the cell the wall stands in. That cell has samples behind the wall, and those had gathered the corridor lamp.

![The fog-only view of the parlor wall](/images/2026-10-16-light-switches-and-leaks/fog-glow-before.jpg "The fog-only view with other circuits boosted 16 times, before the fix. A glow from the corridor lamp sits on the wall of the room behind it.")

A surface now reads the fog one slice nearer. That takes only cells that end in front of the surface. The fog in front of every surface becomes one slice thinner, which I cannot see. In the bench images the only visible change is slightly less haze beside the stair rail.

### Results

In the parlor, light from other circuits at the east wall fell from 0.70 to 0.49 on average (out of 255), and at the south-east corner from 0.76 to 0.59. What remains is the corridor seen through the open doorway, which is correct. The lit chair rail, the lit baseboard and the wall glow are gone.

![The parlor east wall before and after the leak fixes](/images/2026-10-16-light-switches-and-leaks/parlor-east-leak.jpg "Top row before, bottom row after. Left: the parlor with only its own lamp off. Right: light from other circuits boosted 8 times. The lit trim line is gone; the doorway is the corridor itself.")

## The gloss I could not attribute

I checked every source of shine in a dark room. The reflection probes go out with the room, falling 98 to 100% like the diffuse bounce. Screen-space reflections add almost nothing. Switching off the flashlight's bounce barely changes the image. The walls work out at about 0.94 roughness, and the flashlight's specular on them is about 3% of its diffuse. The moonlight grazing the dark corridor's side walls leaves no streaks.

I found no separate cause. My judgement is that the leaks themselves read as gloss, since a thin lit line along trim and a soft glow on a dark wall both look like sheen. If walls still look glossy after these fixes, I need the exact place to look.

## Results and open items

The house has eight switches on eight circuits. A real press at each one, through the real C# scripts, flips the toggle, puts the lamp out and brings it back, and `LightSwitchTests` covers placement, the bake's layer split, per-circuit power and the flicker case. With lamps on, the bench shows no change against master: GPU time within -1.2% to +4.1% per pose and identical images. The leak fixes cost nothing measurable either, with GPU time within -3.4% to +0.8%.

Open items:

- The hallway scene keeps the 15 cm fade until I refit it with `light_fit_bounds` and rebake.
- The switch click is queued but silent until audio work begins.
- Auto-exposure brightens a dark room over a second or two, as the eye does. I need to judge in play whether the rooms stay dark enough.
- The full house build script copies the hallway's enemy into the house. I either keep it there or make the builder leave it out.
- The next day showed there was more leakage to find around the doors.
