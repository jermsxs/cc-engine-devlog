---
title: Water running down trunks, and a cheaper wet world
date: 2026-10-26
order: 2
summary: Rivulets run down wet trunks and walls, then I measure what the wet world costs pass by pass and cut that cost roughly in half.
tags: weather, performance, renderer
cover: /images/2026-10-26-running-water/pier-torch.jpg
---

By evening the woods were wet: darker mud, puddles in the ruts, soaked leaves. But a trunk looked the same as the ground. It had the same even film of water. Real vertical surfaces don't hold water like that. A wall or trunk sheds it. Water runs down in thin channels and leaves the surface between them only damp. Then, because I had added a lot of wet work in one day, I stopped to measure what it all cost.

## Rivulets

> **Concept: Rivulets.** A *rivulet* is a thin stream of water running down a surface. Gravity pulls water down a steep face, and surface tension gathers it into narrow channels rather than a smooth sheet. The result is vertical streaks: a smooth, shiny core where water flows, with a darker wet trail either side, and drier surface between.

I laid rivulets out in world space, as columns about 6 cm apart. A face looking down the z axis runs its columns along x, a face looking down x runs along z, and the two are blended by which way the surface faces. So a round trunk turns smoothly from one to the other without a seam.

- About half the columns carry water.
- Each meanders a little, breaks into stretches along its length, and flows down at its own speed, from 0.5 to 1.2 m/s.
- A rivulet has a smooth core, as smooth as my cap on gloss allows, and rounded, so a light draws a thin line down it. Either side of the core is a darker wet trail.
- They only appear where the surface is steep, open to the rain and soaked through. Leaves, the ground and covered walls get none.

There was one surprise. While testing, I found that wet bark read almost entirely by the film's shine: the trunk looked the same whatever its colour, so no rivulet could show. The even film on steep faces now drops to a quarter, and the shine moves into the rivulets.

![A wet trunk by torchlight, before on the left and with running water on the right](/images/2026-10-26-running-water/trunk-torch.jpg "Left: before. Right: dark streaks run down the trunk, with sheen in their cores.")

The effect shows on trunks a few metres away, as dark streaks with sheen in the cores, and clearly on the gate's brick piers:

![The gate's west pier by torchlight, before and with running water](/images/2026-10-26-running-water/pier-torch.jpg "The brick pier of the gate. On the right, vertical rivulets run down the corner.")

It is faint on the trunk right in front of the torch. That trunk is lit nearly to white, where the tone curve squeezes any change: a colour drop to a quarter only moves it from 215 to 180 out of 255. That is a limit of the torch, not of the water.

I checked the cost against a build without it: within run-to-run noise, at most about 0.1 ms. The day woods are pixel-identical, because the code runs only while the world is wet.

## What does the wet world cost?

This is what I mean by a measuring step. I added a report to my benchmark that shows the wet world's cost pass by pass, soaked against dry. And it showed where the time was really going.

> **Theory: Why one pass can cost twice.** A *depth prepass* draws the scene once, cheaply, to fill the depth buffer before the expensive lit pass. My prepass also hands normals and roughness to the screen-space passes, such as reflections and ambient occlusion. Because those need roughness, my prepass ran the whole wet shader too. So the wet work was done twice per pixel.

Two problems, two fixes:

**The prepass did the wet work twice.** Shelter lookups, film, rivulets and puddles all ran in the prepass. That cost +0.15 to +0.31 ms by itself, more than the lit pass's share. But screen-space reflections only trace below roughness 0.2, and the film never gets that smooth. Only the puddles matter there. So the prepass now runs only the puddles, on level ground. It also had no relief, so its puddles sat where the noise alone put them, not where the lit pass draws water. It now takes the same height map tap, so reflections are traced where the water actually is. The puddle maths is shared between the two passes so they can't drift apart.

**Five lookups for a covered pixel.** Only broad cover keeps the ground dry, so a point the shelter map called covered asked again at four points 0.6 m round it. Under the canopy that is most of the ground, and those four extra lookups cost about 0.15 ms. But the "erosion" is the same for every pixel over a map texel. So a small compute pass now bakes it: each texel takes the deepest of itself and the texels 0.6 m away, which is exactly "open if any of the five is open". It only runs when a shelter map is redrawn (the near one every 6.4 m walked, the level's every 64 m). A covered pixel now asks once.

| | Before | After |
|---|---|---|
| Whole frame, soaked against dry | +0.20 to +0.58 ms (about +0.45 typical) | +0.08 to +0.46 ms (about +0.24 typical) |
| Prepass | +0.15 to +0.31 ms | +0.03 to +0.12 ms |
| Lit pass | +0.07 to +0.32 ms | +0.03 to +0.30 ms |

Walking the path with a quick turn, the wet world costs +0.14 to +0.18 ms in the mean (it was +0.28 ms before). Against the start of the day, with the scene's rain on, every bench pose is 0.2 to 0.45 ms faster, and the image hardly changed: at most 0.1% of pixels differ by more than 12/255. The bake alone, against the five lookups, changed no pixel by more than 12 levels and was 0.1 to 0.19 ms faster.

## What it looks like

The soaked ground is darker in the torch, and in a flash the puddles mirror the lightning. The frame's mean brightness in torchlight goes from 25.2 dry to 19.0 soaked at the path's start.

![The path's start, dry and then soaked in rain](/images/2026-10-26-running-water/path-dry-wet.jpg "Left: dry. Right: soaked. The wet ground is darker and the rain streaks are fainter.")

![The clearing in a flash, dry and soaked](/images/2026-10-26-running-water/clearing-flash-dry-wet.jpg "In a flash the soaked clearing (right) shows bright puddles and glistening patches that the dry one (left) doesn't.")

## What I still don't know

- The lit pass's wet share, +0.03 to +0.30 ms, is most of what is left. If I need more, the next things to measure are the ripples (two layers of hashed noise) and the rivulets.
- I haven't checked in motion whether temporal anti-aliasing smears the flowing cores while the player walks. My motion check ended at a trunk the torch lights near white, so it was a limited test.
- Roofs have no dripping edges yet. Drips from roof edges was an optional part of this step.

I had also seen faint grey rectangles in a debug view of the puddles' reflections. I haven't proved they are real. Next came the leaves, which turned out to be the biggest part of the whole weather track.
