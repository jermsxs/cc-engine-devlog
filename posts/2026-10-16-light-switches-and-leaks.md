---
title: Light switches, and the light that leaked through walls
date: 2026-10-16
order: 1
summary: A live screenshot tool that no longer freezes the editor, working light switches that make rooms truly dark, and hunting down light seeping through thin walls.
tags: lighting, tools, gameplay
cover: /images/2026-10-16-light-switches-and-leaks/press-corridor.jpg
---

By now the engine had a two-storey house to walk around in, a flashlight you hold in your hand, and an editor that an AI agent can drive over a pipe. The house felt like a place, but it still behaved like a painting. The lamps were on and could not be turned off. This was the day I made them switchable, and then found out how badly my light was leaking.

Two days of work sit in this post: a small fix to the screenshot tool on the 15th, then the switches and the leaks on the 16th.

## A screenshot that doesn't freeze the editor

When an agent edits a scene, it takes a screenshot after almost every change to see what happened. I noticed the editor log filling up with warnings like "hitch: 301 ms". Every screenshot froze the editor for a third of a second while I watched.

I timed each stage of one capture:

| Stage | Time |
|---|---|
| Render an extra frame and wait for the GPU | 16.5 ms |
| Encode the PNG | 136 ms |
| Save a copy (which encoded the PNG *again*) | 138 ms |
| Encode the JPEG reply | 6 ms |

All of it ran on the main thread, in the middle of the frame. There were three fixes, and the first was embarrassing: encode once, not twice. The second was to move the slow encoding to the thread that already waits on the pipe to send replies, so the editor's frame carries on without it.

The third needed a little theory.

> **Concept: Why waiting for the GPU is expensive.** A GPU does not draw "now". The CPU records commands and hands them over, and the GPU works through a queue that is usually a couple of frames deep. If the CPU says "give me that picture, I'll wait", it has to wait behind everything already in the queue. The fix is to never wait: ask the GPU to copy the frame into a buffer as part of a normal frame, carry on, and collect the pixels a frame or two later once the GPU signals it has finished.

That is what the screenshot does now. It rides on the next ordinary frame, and the reply is filled in when the pixels arrive. In the Release editor, eight screenshots of every kind logged no hitch at all, where before each one cost 300 ms. An agent still waits about half a second for its reply, but now the editor does not freeze while it does.

![A live capture of the house corridor taken over the pipe](/images/2026-10-16-light-switches-and-leaks/live-viewport-jpeg.jpg "A live capture of the house's upstairs corridor, taken while the editor kept running at full speed.")

## Light switches that really switch

I wanted a switch in each room with a lamp, and a switch for the hall lights too. The key decision was that rooms should go truly dark. That sounds obvious, but it was the hard part.

### Why "off" wasn't dark

The house is lit with *baked* light. A bake is a slow, offline calculation: I shoot rays from every lamp, bounce them around the rooms, and store the result in textures (a *lightmap* on surfaces) and in a grid of small samples in the air (*probes*, which light moving things and the fog). At runtime the engine just reads these. It is cheap, and it looks soft and real.

The problem is that the baked bounce light is *frozen*. A script could switch a lamp off and its direct light would vanish, but the soft glow it had already poured into the lightmap stayed, so the room kept a ghost of a lamp that was off.

The fix is to bake each switchable lamp's light into a **layer** of its own, separate from the rest. Lamps that share a switch share a layer, which I call a *circuit*. The ground corridor's twelve lamps are one circuit, so that is one layer, not twelve. At runtime a layer is simply multiplied by that circuit's power. Turn the power to zero and both the lamp and its bounce light go out together.

Layers are mostly zeros, because a lamp's light stays in its room. So I store them as runs of zeros. The house's eight layers added only 5.8 MB to the lightmap file. Stored in full they would have added about 65 MB.

> **In practice: only pay where it's dark.** Each frame the renderer lists the layers that are not at full brightness, with a box around each layer's lamps. A pixel reads a layer only if it is inside that box. With every lamp on, the list is empty and the cost is nothing. With every circuit off, a frame costs about 0.1 to 0.2 ms more.

### The switch itself

I modelled a small brass plate with two slotted screws and a bat-shaped toggle in Blender, using a script so it can be rebuilt. In the editor it comes as a ready-made object: the plate is something you can aim at, and the toggle is a separate moving part. Pressing it flips the toggle, cuts the circuit, and changes the on-screen prompt from "Turn off the light" to "Turn on the light". A click sound is queued, but it stays silent until I build the audio system.

Power belongs to the game session, not to the scripts. A lamp's drawn brightness is its own brightness times its power. That means a flickering lamp that is switched off stays off, and when you switch it back on it flickers again, which is what I asked for.

![The corridor's brass light switch with its prompt](/images/2026-10-16-light-switches-and-leaks/press-corridor.jpg "The brass switch beside the foyer entry, with its interaction prompt.")

### Two bugs found while testing

- **The toggle barely moved.** The test measured a 0.6 degree tip instead of 34. My script gave the engine radians, and the engine expected degrees.
- **No plate in three rooms.** Only screws and a toggle showed. The wallpaper sits 4 mm out from the wall and the plate is 3.5 mm thick, so the paper covered it. Those three switches now sit on the paper.

![The parlor lit and switched off](/images/2026-10-16-light-switches-and-leaks/parlor.jpg "The parlor with its lamp on (left) and off (right). Only the moonlit window and light from neighbouring rooms remain.")

## Light seeping through walls

With switches, I could finally see a problem that had been hidden for weeks. In a dark room, light seemed to leak through the walls from the corridor outside, especially at corners. Walls also looked glossy. While a room's own lamp was lit it drowned out the leaks. Switched off, they showed.

To find them I rendered each room twice at a fixed exposure: once with only its own circuit off, once with every circuit off. The difference is light that came from other circuits, and it should only arrive through doorways.

### Cause one: a fade that was wider than the wall

Each lamp is clipped to a box around its room so it does not light the next room. At the box's edge the light fades out over 15 cm instead of stopping dead, which avoids a harsh line. That 15 cm was the same for every lamp, but the house's inner walls are only 7 cm thick. A corridor lamp's box ended at the corridor face of the parlor wall, and the 15 cm fade carried on through the wall and out the other side, lighting the parlor's wall and the trim standing out from it. The bake used the same fade, so the leak was baked in.

> **Theory: Fade distance has to be smaller than the thing blocking the light.** A soft edge is good, but it is a promise that light continues past the box. If the next surface is closer than the fade is long, that surface gets lit through the wall. The fix is to make the fade depend on what is actually behind the box.

Now each light has its own fade. The room-fitting tools measure the wall behind each face of the box and set the fade to 80% of the thinnest, about 4 cm in the house.

### Cause two: the fog's grid

After that fix a faint glow remained, and a fog-only debug view showed where it came from. The volumetric fog lives in a 3D grid of cells. Near the camera a cell can be 10 cm deep, deeper than a wall. A pixel on the wall interpolated between its own cell and the cell behind it, and that cell, on the corridor side, had gathered the corridor lamp's light.

![The corridor lamp's fog glow on the parlor wall](/images/2026-10-16-light-switches-and-leaks/fog-glow-before.jpg "The fog-only view, boosted 16 times. The corridor lamp's glow sits on the parlor wall because a fog cell reached through it.")

The fix is that surfaces now read the fog one slice nearer, which only takes cells that end in front of the surface. The fog in front of every surface is one slice thinner, which you cannot see.

The numbers: in the parlor, light from other circuits fell from 0.70 to 0.49 on average (out of 255) at the east wall and from 0.76 to 0.59 at the corner. What is left is the corridor seen through the open doorway, which is correct.

![The parlor east wall, leak before and after](/images/2026-10-16-light-switches-and-leaks/parlor-east-leak.jpg "Top row before, bottom row after. Left: the room with only its own lamp off. Right: the same view with other circuits' light boosted eight times. The bright line along the trim is gone.")

### The gloss I couldn't find

I also checked everything that could make a dark room look shiny: reflection probes, screen-space reflections, the flashlight's bounce, the materials. None of them was the cause. My best explanation is that the leaks themselves were what read as gloss. A thin lit line along trim and a soft glow on a dark wall both look like sheen. If it still looks glossy, I will need to see exactly where.

## Where it stood

The house now has eight switches on eight circuits. A real press at each one, using the real scripts, flips the toggle, puts the lamp out and brings it back. The leaks are quieter, though the next day showed there was more of them to find around the doors.
