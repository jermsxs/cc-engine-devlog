---
title: Every light that reaches a pixel
date: 2026-10-03
order: 2
summary: Clustered lighting removes the eight-lights-per-object limit, the flashlight now bounces light off what it hits, and lamps take their baked bounce light with them when they go out.
tags: lighting, renderer
cover: /images/2026-10-03-clustered-lighting/bounce-corridor.jpg
---

After lightmaps, two things in my lighting still felt wrong. A long wall or a big floor that several lamps reach could miss some of them, because each object only used its eight strongest lights. And when the hallway scare made nearby lamps gutter, the walls kept the soft light those lamps had been bouncing around, so the room never really went dark. Both got fixed on the same afternoon.

## The eight-lights problem

Every frame, the CPU picked up to eight lights per object and the shader looped over just those. That was cheap, but it has an ugly failure mode: a big floor has to pick *one* list of eight for all of its pixels, even if the lights near one end are different from those at the other. And as the camera moved, lights that scored close would swap in and out of the list, which a "keep your slot unless clearly beaten" rule only hid.

> **Concept: Clustered lighting.** Instead of choosing lights per object, divide the *view* into a 3D grid of small boxes, called *clusters* (or *froxels*: frustum voxels, because they fill the camera's view cone). A compute shader first works out, for each cluster, a short list of lights whose reach overlaps it. Then when a pixel is shaded it finds the cluster it sits in and loops over only that cluster's list. Every light that can touch the pixel is included, and the cost scales with how many lights are nearby, not how many exist.

In my version the grid is 24 by 14 tiles across the screen and 24 slices into the distance, each slice thicker than the one before (nearby space is cut finely, far space coarsely, because distant detail is small on screen). A compute pass lists the lights per cell. It checks the shape of each light, not just distance: spot cones, which side a window light faces, and lights clipped to a room box.

The results:

- **No limit of eight.** Every light that reaches a pixel is shaded, and nothing pops as you move.
- **More lights per scene.** A scene can now have 127 lights plus the flashlight, up from 63. Each pixel only pays for the lights near it, so a lamp costs mainly where it shines.
- **No visible change to the final image,** which is the point of a change like this. The mean difference from the old renderer was 0.05 to 0.2 out of 255.

![Lights per pixel, per object and per cluster](/images/2026-10-03-clustered-lighting/lights-per-cluster.jpg "A debug view of how many lights each pixel shades (brighter is more) in the foyer. Left: per object, where a whole object takes the same eight. Right: per cluster, where each part of the screen only pays for the lights that reach it.")

I tested it by brute force. 300 random lights of every kind were checked against 400 random visible points, from two cameras. Every time a light reaches a point, that point's cell lists it, and not one was missed. The cost was a wash on the bench (-0.06 to +0.07 ms per pose, within noise) and 1 MB of video memory for the lists.

## A flashlight that bounces

When you shine a torch at a wall in the real world, the room around you picks up a faint glow in the wall's colour. In my renderer the torch lit only what it hit. I wanted a cheap fake.

After each frame, a tiny compute pass looks at the spot where the beam lands: how bright it is, which way the surface faces and how far away it is. The engine then places a soft, dim light just off that spot, facing out of the surface, about as bright as that patch of wall would be if it glowed. It goes through the same clusters as every other light, so it costs nothing special to shade. It eases in and out over a tenth of a second, so the flicker of the torch and the frame or two before a reading arrives don't show.

![The corridor with the flashlight's bounce off and on](/images/2026-10-03-clustered-lighting/bounce-corridor.jpg "The same view with the flashlight bounce off and on, exposure held fixed. The difference is subtle: it shows on the door frame and on the floor near the lit wall.")

At first the bounce never appeared at all: the pass found no surfaces. My depth formula had a guard against dividing by zero, but with this projection the denominator is always negative in front of the camera, so the guard turned every distance into a huge negative number. A reminder that a "safe" check can be the bug.

## Lamps that take their light with them

The second problem: baked bounce light is fixed. When a script made a lamp gutter or switched it off, the walls still glowed with what it had bounced.

The fix is to bake bounce light in *layers*. A lamp can be marked switchable, and its bounce is baked separately, into a layer of its own, both in the lightmap and in the probe grid. At run time the engine scales that layer by the lamp's brightness now compared with when it was baked: half as bright means half the bounce, off means none. The limit is three switchable lamps per scene, since each costs a bake pass and some memory. In the hallway, the three lamps nearest the closet scare are switchable.

> **Theory: Light is additive.** Two lamps lit together give exactly the sum of each lit alone. That is why this works: a base bake with all the steady lamps plus one layer per switchable lamp must add up to a bake with everything on. A new test bakes the same room both ways and compares them (within 6 percent for the lightmap and 10 percent for the probes).

![The hallway's indirect light with a lamp on and off](/images/2026-10-03-clustered-lighting/indirect-on-off.jpg "The indirect light (x3) beside a lamp: on (left) and switched off by a script (right). Its bounce leaves with it; the other lamps' bounce stays.")

On screen the indirect light in view fell 23.4, 15.9, 7.8 as the lamp went on, half, then off. The remainder is the other lamps.

### Making it free when nothing switches

The first version cost up to 0.14 ms per frame in the hallway, even with every lamp steady. Three things were behind that:

- The fog and the probes read every layer every frame. The shader compiler flattened my "skip this layer" test into "read it, then multiply by zero".
- A lamp at exactly its baked brightness came out at 0.9999999 of it, because the bake multiplies colour and intensity in a different order. That alone made the shader read the extra layers every frame.
- The structure itself: the GPU now keeps the whole bake as the first layer and adds a lamp's layer only while that lamp is away from its baked brightness, behind one test the compiler keeps. Within 0.1 percent counts as unchanged.

With the lamps steady, it costs nothing measurable.

## Two bugs I introduced earlier

Building the layers uncovered two bugs from the clustered work. Switching the flashlight off hung the GPU. The cluster shader asked "is there a flashlight, and does it reach this cell?" HLSL evaluates both halves of that condition, so with the flashlight off it read light number -1, outside the buffer. The GPU stalled and Windows reset it. It is now an explicit branch.

The second: the flashlight's bounce light started life as a full-brightness light at the world's origin, which is in the house's foyer. In play it faded within a tenth of a second, but my benchmark freezes the clock, so for the whole run every foyer frame was lit by a light that should not exist. That also meant the earlier benchmark under-measured the bounce's real cost. With the clock frozen the bounce now snaps to where the beam lands.

## Where it ended

Hallway cost with the layers is -0.02 to +0.05 ms per pose and 8 MB of video memory; the house shows -0.01 to +0.07 ms, which is the flashlight bounce's real cost now that its light is no longer frozen at the first pose. That closes the light phase of my realism plan. What I still noticed: a lamp's glowing glass globe stayed lit after its lamp went out, and the baked reflections still held a switched-off lamp's light. Those came next, in the audit.
