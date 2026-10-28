---
title: A steady image and heavy air
date: 2026-09-28
order: 7
summary: Temporal anti-aliasing to smooth edges and noise across frames, then volumetric fog so lamps glow in the air and the flashlight lights the dust.
tags: renderer, post-processing, lighting
cover: /images/2026-09-28-taa-volumetric-fog/fog-final-and-fog-only.jpg
---

Two problems were left in the hallway after ambient occlusion and reflections. Every edge was a staircase: trim, door frames, the sconce shades. And the air was empty. A flat fog that fades everything toward one dark colour doesn't look like the thick haze in a Resident Evil room, where lamps glow in the air and your flashlight lights up the dust in front of you.

Both of today's features share a theme: spreading work across *time* and *space* so a modest amount of computation looks like a lot.

## Temporal anti-aliasing

> **Concept: Aliasing.** A screen is a grid of pixels. Each pixel is coloured by asking one question at its centre: "what's here?" An edge that cuts across a pixel gets rounded to one side or the other, and a diagonal line becomes a staircase. The cure is to ask more questions per pixel and average, but doing that every frame is expensive.

*Temporal anti-aliasing* (TAA) gets the extra questions for free by asking them over several frames.

### Jitter

Each frame, the camera is nudged by less than one pixel, following an 8-step pattern called a Halton sequence. The shader is effectively asking its question at a slightly different spot inside every pixel each frame. Averaged over several frames, each pixel has seen its whole area, which is exactly what anti-aliasing is.

### History and motion vectors

The average has to survive the camera and objects moving. For that, the renderer needs to know where every pixel was last frame.

> **Concept: Motion vectors and reprojection.** A *motion vector* says "this pixel's surface was over *there* in the previous frame". Using it, the resolve step can fetch last frame's colour from the right place (*reprojection*) and blend it with the new one. The depth prepass now also writes each pixel's screen movement. It uses the camera's previous position and, for moving things like doors, each object's previous placement, remembered per entity.

The resolve pass blends about 10% of the new frame into the running history. The tricky part is not smearing, and this is where TAA implementations live or die.

- **Follow the nearest surface.** The history is fetched following the motion of the closest surface around the pixel, so edges move with the foreground, not the background.
- **Clamp the history.** The history colour is forced to stay close to what the current frame shows around that pixel, inside a colour "box" built from the neighbourhood. Anything the camera no longer sees fades within a frame or two instead of leaving a ghost.
- **Reject bad history.** If the history came from a different surface (its stored depth doesn't match) or from off screen, it is dropped.
- **Blend in a compressed range.** Bright lamps next to dark walls can ruin averages, because one extreme value dominates. Blending in a compressed brightness range means a lamp neither smears nor flickers.
- **A light sharpen** afterwards gives back the crispness that averaging takes away.

![A baseboard edge at 3x zoom, jagged without TAA and clean with it](/images/2026-09-28-taa-volumetric-fog/edges-before-after.jpg "Left: without TAA, a staircase edge. Right: with TAA, a clean edge, and the plaster keeps its texture.")

### A bonus: noise that moves

Because TAA averages frames, other effects can use that. The shadow filter, the AO sampling and the reflection rays now use a new random pattern every frame, and TAA averages it away into smooth results. Reflection rays now genuinely scatter across the floor's gloss, the way light does, instead of being blurred afterwards. I skipped building separate histories for AO and reflections: their noise moves every frame, and the main history averages it along the same motion vectors.

The history starts over whenever the camera jumps. Each benchmark pose therefore sees exactly the same frames every run, and two runs produce identical screenshots.

### Fighting ghosts and blur

The test for TAA is panning. I swung the closet door open while turning the camera at 25 degrees per second and compared with and without TAA. No trails behind the door frame or the lamps, which is the thing to look for.

TAA's other known weakness is softness in motion, because each frame of history gets resampled once more and the small blurs add up. I measured it on the plaster by a lamp, with grain off, as mean edge strength:

| Setup | Still | 20°/s pan |
|---|---|---|
| No TAA | 0.122 | 0.132 |
| TAA, first version | 0.113 | 0.100 |
| TAA, after the fix | 0.113 | 0.119 |

Raising the sharpen just over-sharpened still images first. The fix was to give the current frame more weight where pixels move (more weight reached at 3 pixels of motion per frame). Still images are unchanged and edges stay smooth in motion.

![Plaster during a 20 degree per second pan: no TAA, TAA before, TAA after](/images/2026-09-28-taa-volumetric-fog/taa-motion-sharpness.jpg "The plaster during a pan, zoomed. Left: no TAA. Middle: the soft first version. Right: close to the left one's detail without its jagged edges.")

Two cost fixes followed. The resolve was the most expensive post step because it read nine colours and nine depths per pixel. Each 16 × 16 group of pixels now loads its tile plus a border once into on-chip memory and shares it. The result is pixel-identical and went from 0.245 to 0.195 ms. I'd hoped for half, but most of what remains is the history read. I also fixed empty background pixels, which had no motion vector and so never moved with the camera. They now reproject the far-plane point behind them. The hallway has no such pixels, but the editor's empty void does.

## Heavy air: volumetric fog

Now the fog. The old fog mixed each pixel toward a dark colour based on distance. It knew nothing about lights. I wanted a fog that lamps *shine in*.

> **Concept: Light scattering.** Air isn't empty. It has dust and water droplets, and each particle scatters a bit of light. When a ray of light passes through fog, some is absorbed, some is bounced toward your eye (that is the visible glow around a lamp), and the rest carries on. This is why you can see a flashlight beam in a dusty room.

To simulate this you need to know, at many points along every view ray, *how much fog is there* and *how much light reaches that point*. That's a 3D problem, and the usual answer is a 3D grid.

### A grid of little boxes

The view is divided into 160 × 90 × 64 cells in front of the camera. These are called *froxels*: frustum-shaped voxels (voxel being a 3D pixel). They're thin near the camera and deeper far away: each slice is about 9% deeper than the one before, out to 30 metres. So at 1 metre a cell is about 9 cm deep, and at 10 metres about 90 cm. That spends the detail where you can see it.

Each cell gets three things:

1. **How much fog it holds.** A constant density, plus height fog that is thickest at floor level, plus dust: two layers of slowly drifting 3D noise so the haze is patchy rather than even.
2. **How much light reaches it.** Every lamp and the flashlight in range adds its light to the cell, with the same falloff and spot cone as surfaces, and cut by the same shadow maps. So a door frame casts a shadow into the beam.
3. **How that light scatters toward the eye.** A *phase function* says dust scatters mostly forward, a little back. The ambient light adds a faint base glow so the dark isn't a hole.

### Smoothing over time, again

At about 16 pixels wide, a cell is coarse. So each frame samples a different point inside every cell and blends it into last frame's result, reprojected for camera movement. The coarse grid becomes smooth haze without banding. It is the same trick as TAA, applied to a 3D grid.

### Adding it up

A second pass walks each column of cells from the camera outward. At every depth it records how much light the fog has added so far and how much of the scene behind still gets through (*transmittance*, from the Beer-Lambert law, which says light fades exponentially with the amount of fog crossed). A test checks this against the closed-form answer for constant fog at three densities.

The scene shader then reads the result at each pixel's depth: the surface is dimmed by what gets through, and the fog's glow is added on top.

![A corridor and a pose near a lamp, final image on top, fog alone below](/images/2026-09-28-taa-volumetric-fog/fog-final-and-fog-only.jpg "Top: the final image. Bottom: the fog on its own, showing a halo around each sconce and the corridor falling into haze.")

### The look, and a wrong guess

My plan called for strongly forward-scattering dust, an anisotropy of around 0.6. In practice the beam from the flashlight disappeared. The flashlight is held at the eye, so its light has to bounce almost straight *back* to be seen, and at 0.6 that is under a sixth of what an even scatterer returns. At 0.45 the beam reads, and the sconces still get their forward glow.

Denser fog looked more atmospheric in a still image but lifted the blacks toward grey and washed out the floor's reflections, so I settled on a light haze: density 0.025 per metre, dust 0.1, height fog 0.03, anisotropy 0.45. I kept the blacks black. The old distance-fog settings still load from older scenes, with one log line, and are dropped on the next save.

![The six bench poses with volumetric fog](/images/2026-09-28-taa-volumetric-fog/bench-after.jpg "The six bench poses after the fog: lamps glow in the air, the corridor's far end falls into haze, and the blacks stay black.")

## What it cost

The fog passes take 0.1 ms in total on an RTX 4070 (density 0.02, lighting 0.06, integration 0.02). That's about 0.2 ms on a 3060, far inside the 1.5 ms I had set aside. The rest of the extra time in the scene pass comes from reading the fog volume at every pixel. The whole frame went from about 1.9 ms to about 2.1 ms in a Debug build at 1440p, and TAA's resolve got cheaper even with the background fix.

## Still rough

- The fog is patchy haze rather than individual drifting specks. Single motes would need a particle system, and that's a later job for the GPU compute side.
- The fog history reprojects by camera movement only, so a door swinging through a beam would update its shadow in the fog a frame or two late. At this density I can't see it.
- A cell behind a wall can be lit by a lamp on the other side if that lamp has no shadow map. The composite only reads up to the visible surface, so it hasn't shown.

The renderer had by now grown shadows, AO, reflections, TAA, fog and a camera chain, and it was all still well inside its time budget. The next problem was memory.
