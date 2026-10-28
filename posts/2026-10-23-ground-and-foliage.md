---
title: Ground relief, pooling puddles and steadier foliage under TAA
date: 2026-10-23
order: 1
summary: The path got parallax relief and puddles that pool in the hollows. I then fixed distant leaf flicker by changing TAA's history test and made the foliage finer and more varied.
tags: outdoors, foliage, materials
cover: /images/2026-10-23-ground-and-foliage/game-after-walk.jpg
---

Items 3 and 4 of my list of differences between the woods and the reference were ground detail and foliage. In the reference, the path is trampled wet mud with clods, footprints and a puddle of dark muddy water, and the canopy is a mass of small leaves. Mine was a flat, dry, cracked dirt texture with no water, under big uniform leaf cut-outs that flickered at a distance.

## Ground with depth

### How parallax relief works

A normal map changes how light shades a flat surface, but the silhouette stays flat and nothing moves relative to anything else as the viewpoint changes. Parallax occlusion mapping adds that missing effect by ray-marching through a height map:

1. For a pixel on the surface, take the view ray into the surface in tangent space.
2. Step along it in small increments, comparing the ray's height with the height map's height at each step.
3. At the first step where the ray falls below the stored height, use that texture coordinate to read the colour, normal and roughness.

The surface then shows parallax, with raised clods covering what is behind them. A second march from the surface toward the light can test whether another part of the height field blocks the sun, which gives the clods small self-shadows. The cost is the number of steps times the texture reads per pixel, and the effect breaks down at grazing angles, so it fades out with distance.

### What I changed

The renderer's parallax used to march only the base material's height map. Under the path, that map was the leaf litter, not the mud. A material layer can now declare `"relief": true`. Its own height map then joins the march, blended by where the layer lies, so the path has 4 cm clods and the leaves around it keep their shallow relief. Depths are measured against the deepest map, so a material with no layer relief marches exactly as before, and the hallway, house and kitchen stayed image-identical.

In a sun patch, each pixel also marches 8 steps toward the sun through the relief (`relief.sunShadow`), so the clods throw small shadows. Parallax now reaches 14 m in the woods instead of 6 (`relief.fadeDistance`), because clods of a few centimetres still read at that distance.

The mud is Poly Haven's `brown_mud_03`, a CC0 scan at 2k resolution and 16 MB that I approved before downloading. It replaces the dry dirt on the path's painted mask. Its tint is warmed to (1.45, 1.15, 0.8) toward the reference's earth, and its roughness is multiplied by 1.5 so that it stays matte. I prefer matte surfaces, and the reference's mud is wetter and glossier in its ruts than mine. Only the puddles are allowed to be smooth.

### Puddles that pool

Water follows the height field. It collects in the low ground and its surface is flat. Standing water is also darker than the dry surface around it, because it fills the pores that scatter light, and it acts as a mirror and shows what is above it.

I model that with the wet decal that was already in the engine. On a surface with relief, a wet decal now raises a water level through the height field, and a pixel holds water where the ground height lies below that level. A faint decal leaves water only in the lowest ground, and a strong one floods every hollow below its level (`relief.puddles`, `WetWater`). The water inside is darker and perfectly flat. The diagram shows the principle.

![Ground height with water poured to two levels](/images/2026-10-23-ground-and-foliage/pooling.svg "A water level poured into a height profile. A low level fills only the deepest hollow, and a higher level fills every hollow beneath it.")

There are three puddles in the terrain's hollows and nine faint damp patches along the path. The ground mesh had to opt in to decals with `receivesDecals`, because decals had only been drawn on boxes.

The first puddles came out pale grey, like patches of frost.

![The first puddles: pale grey patches on the path](/images/2026-10-23-ground-and-foliage/puddle-pale-first-try.jpg "My first puddles. They reflected the probes' light, which over the path is the open sky.")

The woods had no reflection captures, so the water reflected the probes' light, and over the path that light comes from the open sky. A reflection capture, a cube map of the surroundings that is baked for a region, now sits low over each puddle, so the water shows the dark canopy with the occasional glint of sky. Screen-space reflections added almost nothing on top of that, at about 0.4 ms every frame, so I left them off. My first version used seven 8 m capture boxes along the path and cost about 0.3 ms, because every pixel inside a box pays the cost, leaves included. Each capture now hugs its puddle.

![A puddle before and after](/images/2026-10-23-ground-and-foliage/puddle-before-after.jpg "Left: the old flat path. Right: damp mud with relief and a dark puddle in the hollow.")

At first the mud did not show at all. The game reads the material library copied into the build folder, and that copy was stale. My build script updates the repository's library, and a CMake build copies it.

### Results

At the reference pose, the mean went from 36.8 to 34.6 against the reference's 36.7. In the five rows of the frame's lower half, the brightness profile moved from 46, 45, 41, 41, 39 to 42, 36, 37, 39, 37, where the reference has 32, 42, 36, 39, 30. The over-bright dry dirt in the first rows became damp mud. The mean is now 2 below the reference, and the canopy rows (28 to 31 against 35 to 40) were already the darker part before this change.

I measured the cost by switching each piece off in copies of the scene on the RTX 4070 at 1440p. The relief, sun shadow and decals together cost about 0.2 ms. Where the path fills the view, the opaque pass takes 3.0 to 3.3 ms against 2.67 ms with everything off. Elsewhere the difference is inside the noise, since identical runs differed by up to 0.7 ms at the gate. The slowest pose is 6.6 ms, about 13 ms on a 3060-class card. Walking the path shows the relief steady, with no swimming or shimmer, and the editor smoothness check passes with 1500 frames and one hitch from asset loading, against two allowed.

![The game after walking down the path](/images/2026-10-23-ground-and-foliage/game-after-walk.jpg "The game after a walk down the path. The mud relief is steady and the puddle sits dark in its hollow.")

## Leaves that hold still

### The problem

Distant leaves flickered against the light. It was a rendering problem, not a lighting one. To measure it, the game can now save 16 consecutive frames (`--capture-count`). With the wind off, 3.3% of the canopy's pixels changed by more than 24/255 from one frame to the next.

### How TAA keeps a pixel stable

Temporal anti-aliasing (TAA) gets its extra samples from time. Each frame the camera is shifted by a sub-pixel jitter, so each pixel samples a slightly different point. The resolve pass takes last frame's result, finds where each pixel was using the motion vectors, and blends a small share of the new frame into that history. Over several frames the history converges on an anti-aliased image.

The history is only valid if it came from the same surface. If the surface has changed, a door has opened or something has stepped out, the history is wrong and must be thrown away, or it shows as ghosting. The resolve checks for that by comparing the depth stored last frame with the depth now.

A distant leaf is thinner than a pixel. On some jitter positions it covers the pixel, and on others the sky does. The pixel's depth therefore jumps between about 20 m and infinity from frame to frame.

### The cause and the fix

I turned things off one at a time. Without TAA the flicker went away. The leaf edge dither and the shadow filter's rotation hardly mattered. The cause was the history test. TAA threw a pixel's history away whenever last frame's depth at that pixel differed from this frame's. For thin leaves that was nearly every frame, so each frame showed the raw, aliased result.

History is now kept when last frame's depth lies anywhere within the range of depths in the pixel's 3 by 3 neighbourhood. A leaf against the sky keeps its history, because the leaf's depth is in the neighbourhood range. A surface that really is new falls outside the range and is rejected.

![Flicker before and after: the frame and the change between frames](/images/2026-10-23-ground-and-foliage/flicker-before-after.jpg "Each pair shows a frame and the per-pixel change between consecutive frames. Left: before, with the leaves flickering white. Right: after, nearly black.")

With the wind off, 0.5% of the pixels flicker, against 3.3% before, and TAA off gives 0%. With the wind on, the figure fell from 3.7% to 1.5%. Moving leaves still change a little, as they should. Panning in the woods and in the house shows no ghosting. The benchmarks run with TAA off, so I checked the change by panning the house with TAA on.

## Light through the shade, and finer leaves

Against the reference, my canopy was too much deep shade. 63% of the top of the image counted as shade (luminance under 30), against 39% in the reference. Its fine-scale contrast was also too high, 3.15 against 1.28, because the leaves read as big, uniform cut-outs.

### Ambient light through the leaf

A leaf already let the sun through from behind. Under a canopy, most light comes from every side, from the sky and from other leaves, so a shaded leaf transmits that too. The foliage shader now adds the probes' diffuse light multiplied by `(1 + transmission)`. A shaded leaf glows faintly where it used to go black, and the shade share fell from 63% to 50%.

### Finer and not all alike

The twig card shared by every tree and bush was re-rendered with leaves at 0.6 times their size and 1 / 0.6 times as many. It covers the same area but reads as foliage and not as paper cut-outs from a distance (`LEAF_SCALE`, and `--card-only` rebuilds just the card).

![The twig card before and after](/images/2026-10-23-ground-and-foliage/twig-card-before-after.jpg "The twig card. The two earlier cards are on the left and the two finer ones on the right.")

No two plants look alike either. Each tree, sapling and bush gets its own tint from its name: a brightness between 82% and 100%, 16% of plants yellowing, 6% dead and rust-brown, and the rest with a slight green or yellow shift. The tint goes through `material.albedo`, so instanced drawing still batches the plants.

![Canopy close-up before and after](/images/2026-10-23-ground-and-foliage/canopy-zoom.jpg "The canopy up close. Left: before. Right: after, with finer leaves and more variation.")

I also tried softening the image's grain, TAA sharpening and lens softness, which together moved the fine-contrast figure only from 3.15 to 2.51. They stay as they are. Most of the gap is the reference's denser, smaller leaves at a distance and its haze.

| Pose | Mean, before to after (reference) | Canopy shade / mid, before to after (reference) |
|---|---|---|
| Path | 34.6 to 37.3 (36.7) | 63% / 33% to 53% / 43% (39% / 60%) |
| Gate close | 56.9 to 59.1 (58.2) | shade 35% (36%) |
| Gate far | 34.9 to 36.7 (66.1) | still limited by light |

The full suite passes at 114 of 114. The editor smoothness check passes with no hitches at a typical 4.9 ms. The hallway, house and kitchen benches are image-identical to the previous step, with a maximum of 1/255 in three kitchen poses. On the woods, GPU time moved by -0.1 to +0.3 ms a pose, inside the benchmark's noise of up to 0.7 ms, and the slowest pose is 6.67 ms, about 13.3 ms on a 3060-class card.

## Open issues

- Ground decals beyond water, such as leaf drifts, footprints and ruts. The material atlas has no CC0 decal scans for them yet.
- A wet surface outside a reflection capture still reflects the sky's light and reads pale if it holds much water. Specular occlusion from the probes, or captures placed automatically over wet decals, would cover it.
- The reference's undergrowth has thin sapling stems and vines between the bushes. Mine is bushes and ferns.
- The canopy's fine contrast is still about 2.7 times the reference's. Cheaper leaves at a distance, or a haze in the canopy, would soften it.
- The gate-far pose is still about half as bright as its reference. That is the light at the gate, not the foliage.
