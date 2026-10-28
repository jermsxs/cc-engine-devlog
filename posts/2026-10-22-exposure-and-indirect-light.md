---
title: Partial eye adaptation, local tone mapping and screen-space indirect light
date: 2026-10-22
order: 1
summary: One exposure for a whole frame fails in a forest. I added partial adaptation, local tone mapping on a bilateral grid and a one-bounce screen-space indirect light.
tags: post-processing, lighting, outdoors
cover: /images/2026-10-22-exposure-and-indirect-light/game-after-walk.jpg
---

The woods were close to the reference in average brightness, but their shade was wrong in a specific way. It was either crushed to black or flat and grey-brown. I keep a numbered list of what separates the outdoor scene from the reference, and the first two items were exposure, meaning how the engine decides which scene brightness becomes which screen brightness, and indirect light, the light that bounces from one surface onto another.

## Why one exposure fails

### Exposure and auto-exposure

A forest scene spans a huge range of luminance. Open sky can be a thousand times brighter than shade under the trees, and a display shows only a narrow slice of that range. Exposure is the choice of which slice. The renderer keeps luminance in linear, scene-referred units and multiplies by an exposure factor before tone mapping.

Auto-exposure chooses that factor from the frame itself:

1. A compute pass builds a histogram of log2 luminance over the frame. Mine has 64 bins covering log2 luminance from -12 to 4.
2. It averages the log luminance between two percentiles, so that a few very bright or very dark pixels do not dominate.
3. It converts the average to an exposure value, `EV100 = log2(L) + log2(100 / 12.5)`, where 12.5 is the usual reflected-light calibration constant, so that the average lands on mid grey.
4. The multiplier is `1 / (1.2 * 2^EV)`.
5. The current EV moves toward the target by exponential smoothing, `current += (target - current) * (1 - exp(-dt * speed))`, with separate speeds for brightening and darkening, like an iris. The result is clamped to a minimum and maximum EV.

The weakness is that this picks one number for the whole frame. Choose it for the shade and the sky burns to white. Choose it for the sky and the shade drops to black. A photographer would dodge and burn, and the eye itself adapts locally.

![One exposure window against local exposure](/images/2026-10-22-exposure-and-indirect-light/exposure.svg "With one exposure, the shade falls outside the range the screen can show. Local exposure lifts the shade into range and leaves the sky where it was.")

## What my meter said

Before changing anything I read what the meter reported. Every woods pose metered between EV100 -5.5 and -6.6, below the woods' floor of -3. Auto-exposure was doing nothing there. All seven poses sat on the floor, so the exposure behaved like a fixed film exposure. The kitchen also sat on its floor, the house was partly pinned there, and the hallway was not pinned at all.

### Partial adaptation

If adaptation were complete, every scene would be exposed so that its average becomes mid grey. A dark forest would then be as bright as a sunlit field, and the scene would be flat, with no sense that it is dark. An eye does not compensate fully either, and a dark place keeps looking a little darker.

I added two settings, `adaptation` and `anchorEv100`. The target EV moves only part of the way from an anchor toward the metered value:

```
target = anchor + adaptation * (metered - anchor)
```

An adaptation of 1 meters every scene to mid grey, and 0 holds the anchor as a fixed exposure. At half the way, the gate pose (reference 3) fell from a mean of 58 to 53 against the reference's 58. The woods therefore use a fifth, 0.2, with an anchor of -2.2.

### Local exposure on a bilateral grid

Local tone mapping adjusts the brightness of regions separately, so that shade can be lifted without lifting the sky. The simple way is to blur the image, treat the blur as each pixel's local brightness, and compress the difference from it. A plain blur averages across the edge between bright sky and dark trunks, and the result is a halo around every edge.

A bilateral filter weights neighbours by their distance and also by how similar their brightness is, so it does not blur across strong edges. A bilateral grid makes that cheap. The image is splatted into a small 3D grid. Two axes are screen position. The third is luminance, so each cell holds only pixels of similar brightness. The grid is blurred, which is inexpensive because it is small, and then read back at a pixel's own position and luminance. That returns the brightness of the region the pixel belongs to, and a pixel in the sky never contributes to a pixel in the trees.

My grid is 64 by 36 cells with 32 luminance slices, covering 16 stops at half a stop per slice. Each slice stores the mean log luminance of the pixels that fell in it, with their share of the cell as the weight. The post-process pass then rewrites each pixel's log luminance:

```
offset = base - key
scale  = highlights if offset > 0, otherwise shadows
result = key + offset * scale + (logL - base) * detail
```

`logL` is the pixel's own log luminance, `base` is the region's brightness from the grid and `key` is the pivot. A `shadows` value of 0.6 scales the distance of dark regions below the key by 0.6, which lifts them toward it. `detail` scales the difference between the pixel and its region, so it controls fine contrast independently of the region's level. `highlights` is left at 1, because the references' skies are bright.

My first version pivoted on mid grey. That brightened every woods pose at once, because the woods sit far below mid grey. The pivot is now the frame's own metered average, so the overall level holds and only the regions move toward one another: the shade opens up and the average stays where it was. The woods use `localShadows` 0.6 and `localDetail` 1.1.

At 1440p on a 0 to 255 scale:

| Pose | Mean, before to after (reference) | Darkest 5%, before to after (reference) | Median, before to after (reference) |
|---|---|---|---|
| Gate close (reference 3) | 57.8 to 58.6 (58.2) | 3 to 9 (10) | 35 to 35 (31) |
| Gate far (reference 1) | 33.6 to 36.9 (66.1) | 2 to 6 (16) | 18 to 20 (50) |
| Path (reference 2) | 36.8 to 38.3 (36.7) | 4 to 9 (15) | 28 to 29 (31) |

The change is meant to be small. The darkest 5% of pixels in the gate pose rise from 3 to 9, close to the reference's 10, while the mean stays within a point.

![The gate view before and after local exposure](/images/2026-10-22-exposure-and-indirect-light/exposure-gate-before-after.jpg "Cropped from my own render of the gate pose. Left: before. Right: after local exposure. The shade under the trees opens slightly and the sky is unchanged.")

The gate-far pose is still about half as bright as its reference. The meter shows why. That pose meters only 0.46 EV darker than the path pose, while its reference is 1.8 times brighter. The gap is in the light and the content, with open sky and haze over the house and a sunlit bank, and not in the exposure. Post-processing costs 0.06 to 0.08 ms a pose for the grid build and blur. With the new settings at their defaults, every hallway, house, kitchen and woods bench pose is image-identical to before, so the interiors keep the defaults.

## Screen-space indirect light

### The problem

Under the canopy everything is lit by the probes and the sky. The light that bounces off a sunlit bush onto its neighbour was missing, so the shade looked flat and grey-brown where it should pick up the colour of what surrounds it.

### How it works in general

Indirect diffuse light is light that has bounced at least once. My probes supply a low-frequency version baked offline. Screen-space global illumination (SSGI) adds a high-frequency local part at run time, using only what the camera already has: the depth buffer and the previous frame's lit image. For each pixel it samples nearby screen positions, treats each sample as a small surface that reflects its colour, and adds the light from the samples that are above the pixel's horizon and facing it. It has known limits. It can only use what is on screen, so a lit bush behind the camera lights nothing. A depth buffer holds only the front surface, so thickness has to be assumed. And it is noisy, so it needs denoising.

It pairs naturally with ambient occlusion. Ground-truth ambient occlusion (GTAO) marches across the screen in a few directions around each pixel and records, for each direction, the highest horizon angle blocked by geometry. The unblocked arc gives the visibility. A pure horizon search treats everything behind a depth sample as solid, so a thin branch blocks the whole hemisphere behind it, and the occlusion in a leafy scene is too strong.

Bitmask GTAO (Therrien et al., 2023) fixes that. Each slice of the hemisphere is cut into 32 sectors and stored as a 32-bit mask. A sample sets the bits between its front surface and a back surface a fixed thickness behind it, so a thin branch blocks only its own sectors and light still passes behind it. The visibility is the share of bits left unset. The same masks identify new light. When a sample sets sectors that nothing set before it, those sectors take that sample's colour as bounce light.

### My implementation

The ambient-occlusion pass already marched two slices per pixel. It now splits each slice into 32 sectors of equal cosine-weighted share and gives each sample a thickness of 0.5 m behind what the depth buffer shows. When a sample sets new sectors, they take its colour from the previous frame, reprojected, after TAA, at half resolution, and weighted by whether the sample's lit side faces the pixel. The result is denoised together with the visibility and added to the ambient light in the scene pass.

The old multi-bounce approximation, which faked this light, is dropped where the real bounce is on. Lightmapped surfaces skip the bounce, because their lightmap already holds it. The feature is off by default, so the hallway, house and kitchen are unchanged. The woods use these values:

- Radius 2 m (it was 0.55).
- `indirect` at 1, which is physically based.
- AO strength 1.0 (it was 1.4). With the bounce in, the old strength darkened every pose by 3 to 4 levels.

The bounce is about 5% of the indirect light on average and up to 20% in the hollows of bushes. The change is more in the shape of the shade than in the level: the bushes and the bank under the trees gain volume and contact.

| Pose (1440p) | Mean, before to after (reference) | Darkest 5% | Median |
|---|---|---|---|
| Gate close | 58.6 to 56.9 (58.2) | 9 to 8 | 35 to 32 |
| Gate far | 36.9 to 35.1 (66.1) | 6 to 5 | 20 to 18 |
| Path | 38.3 to 36.8 (36.7) | 9 to 8 | 29 to 27 |

The path pose now matches its reference's mean. The gate-far gap stays open, because this light is local and does not reach that far.

![Indirect light only, before and after](/images/2026-10-22-exposure-and-indirect-light/indirect-only-view.jpg "The indirect-light debug view. Left: before the bounce. Right: with it. The foliage picks up the colour of its neighbours.")

On the RTX 4070 at 1440p the ambient-occlusion pass went from 0.18 ms to between 0.53 and 0.82 ms, and the GPU frame grew by 0.0 to 0.8 ms. The slowest pose is 6.3 ms, about 12.6 ms on a 3060-class GPU. Hoisting the slice's trigonometry and using 6 steps instead of 8 saved about 0.04 ms.

![The path in the game after walking down it](/images/2026-10-22-exposure-and-indirect-light/game-after-walk.jpg "The game after walking the path. Capturing afterwards shows no smearing and no stale bounce, with a mean of 36.5.")

## Two problems found by re-checking

Before starting the second item, a review and a run through the game and editor turned up two problems in the exposure work.

- **Manual mode.** Local exposure pivots on the frame's metered brightness. In manual exposure mode the histogram was skipped, so that value went stale. It now meters whenever local exposure is on, and stores the average before manual mode returns.
- **Editor hitches in the woods.** After each edit, the editor checked whether the light bake was stale by hashing every object and file on the edit frame. That check now runs on a worker thread, and file stamps take one system call each. `--smoothness-check` passes on the woods with 1500 frames and no hitches at a typical 3.4 ms, and on the house with no hitches at 1.3 ms.

## Open issues

- A dark smudge on the path in the indirect-only view. It is also there without the bounce, so I suspect the probe bake, with a probe buried in the ground.
- Bent normals for the probe lookup, the rest of this item, are not done.
- The bounce reads only what is on screen.
- Local exposure could help the house's dark rooms that have a lamp in frame. I have not tried it, since I left the interiors as they are.
- Gate far is still about half as bright as its reference, which is a lighting job for the aerial perspective and sun work that follows.

114 of 114 tests pass, including new shader-compile entries and descriptor-layout checks for the added slots, and `LocalExposureTests` for the identity at defaults, the highlights, shadows and detail terms, the key pivot, and `TargetEv100`.
