---
title: Rivulets on vertical surfaces, and halving the wet pass cost
date: 2026-10-26
order: 2
summary: I add procedural water channels running down wet trunks and walls, then measure the wet world pass by pass and remove duplicated work from the depth prepass and the shelter lookups.
tags: weather, performance, renderer
cover: /images/2026-10-26-running-water/pier-torch.jpg
---

The wetness model from the previous post treated every surface alike. A trunk or a wall got the same even water film as the ground, and the film only changed the roughness. It did not look wet. Next I added water running down vertical surfaces, then measured what the whole wet system cost and brought that cost down.

## Water running down trunks and walls

### What happens on a real vertical surface

Water on a horizontal surface can lie as an even film or in puddles. On a vertical or steep surface it cannot. Gravity pulls the water down faster than surface tension can hold a film together, so the film breaks into narrow channels, rivulets, which run down at different speeds and meander around texture in the surface. The faces between the channels are left damp, but they carry no film of their own. A wet tree trunk or brick pier therefore looks like a darker surface crossed by vertical streaks. Each streak is smooth and shiny along its core, and has a darker wet trail on either side.

### Ways to render this

An artist-driven method scrolls a flow texture down the UVs. It needs unwrapped geometry with consistent UV direction, and on a trunk where the UVs wrap around the cylinder the pattern would repeat or seam. A procedural method computes the rivulets from the world position in the pixel shader. It works on every mesh, at the cost of a few hashes per pixel. I used the procedural method because the woods have hundreds of trunks and I did not want to author flow maps for each.

### How my rivulets work

The code is `WetRivulets` in `Wet.hlsli`.

- **Columns in world space.** The surface is divided into vertical columns about 6 cm wide. A face looking along z runs its columns along x, and a face looking along x runs them along z. The two sets are blended by which way the surface faces, so a round trunk turns smoothly from one to the other.
- **Which columns run.** About half of the columns carry water. Each is displaced a little by two sine waves so that it meanders.
- **Flow.** Along its length each column is broken into stretches by a hashed value that is interpolated and smoothed. The coordinate that is hashed advances with time at the column's own speed, from 0.5 to 1.2 m/s, so the stretches slide downward.
- **Core and trail.** Inside a column, a parabolic profile gives a core (`1 - d²`, smooth water) and a much wider trail (`1 - 0.06·d²`, damp). The core uses the same roughness cap as the film, so it is as smooth as I allow water to be on a surface, and its cross-section is rounded: the normal is tilted by an amount that varies across the column, so a light draws a thin line down the middle. The trail only darkens the albedo (to 45%) and lowers the roughness a little.
- **Where it applies.** Only where the surface is steep, open to the rain and soaked through, using the same wetness and shelter lookups as the film. Leaves, ground and covered walls get none.
- **Less film on steep faces.** The even film on walls and trunks drops to a quarter. While testing, I found that wet bark was reading almost entirely through the film's shine. The trunk looked the same whatever its colour, so the rivulets could not show. With the film thinned, the shine moves into the rivulets.

### Result

The effect shows on trunks a few metres away, as dark streaks running down with sheen in their cores, and on the gate's brick piers.

![A trunk in torchlight, before and after](/images/2026-10-26-running-water/trunk-torch.jpg "Left: an even wet film. Right: dark streaks with shiny cores run down the trunk.")

![The gate's pier in torchlight, before and after](/images/2026-10-26-running-water/pier-torch.jpg "Left: the pier with an even film. Right: water trails down the right-hand face.")

The trunk directly in front of the torch is lit nearly white. The tone curve compresses bright values, so a colour change to a quarter moves a pixel only from 215 to 180 out of 255, and the effect is faint there. That is a property of the display transform and not a bug in the shader.

A debug view of the core, the trail and the steepness showed streaks over every trunk in view and none on the ground or on leaves. The change costs between 0.1 ms faster and 0.16 ms slower in two rounds at 1440p, within run-to-run noise. The poses facing trunks and piers changed about 2.3% of their pixels, and the others less than 0.2%. The day woods are identical, because the code runs only while the world is wet.

## Measuring the cost

At this point the wet system cost about 0.33 ms per frame on average against a plan that allowed 0.1 ms. I had only measured the total, so I extended the benchmark to report the wet world's cost pass by pass, soaked against dry (`wetcost.py`), and to run a walk with a quick turn (`walkwet.py`). Per-pass GPU timings come from timestamp queries around each pass in the frame. Comparing the soaked and the dry runs of the same build, with TAA off and two rounds averaged, shows which pass moves.

### The depth prepass did the wet work twice

A depth prepass renders the scene's depth, and in my engine it also writes normals and roughness for the screen-space passes that need them: screen-space reflections (SSR) and ambient occlusion (GTAO). Because it shares the material code with the lit pass, it was running the whole wet function: shelter lookups, the film, the rivulets and the puddles. That cost +0.15 to +0.31 ms by itself, more than the lit pass's share of the wet cost.

Most of that work was pointless. SSR traces rays only for surfaces smoother than roughness 0.2, and the water film never gets that smooth. Only the puddles do. GTAO barely notices the normal changes of a film. So the prepass now runs only the puddles, and only on level ground (`ApplyWetnessPrepass`).

This also fixed a mismatch. The prepass had no relief height, so its puddles sat where the noise alone put them, not where the lit pass drew water. It now reads the height map's unshifted tap, so the reflections are traced where the water is. The puddle maths is shared between the two passes (`ApplyPuddle`, `WetPatches`) so they cannot drift apart.

### Five lookups for each covered pixel

The shelter test from the previous post is eroded: a point the map calls covered asks again at four points 0.6 m round it. Under the canopy most of the ground is covered, so most pixels there were doing five lookups. With the erosion left out, those four extra lookups cost about 0.15 ms.

The erosion depends only on the map, not on the pixel, so it is the same for every pixel over a texel. A small compute pass now bakes it. Each texel stores the deepest of itself and the texels 0.6 m away, which is exactly "open if any of the five is open". It runs only when a shelter map is redrawn: the near map every 6.4 m walked and the level's map every 64 m. Both maps go into one 2048 × 1024 float texture, and the scene shader samples it once per map. A covered pixel now makes one lookup per map instead of five. The bake changes nothing in the image: mean difference 0.00 and no pixel off by more than 12 of 255.

### Results

Soaked against dry, at 1440p, TAA off, two rounds averaged:

| | Before | After |
|---|---|---|
| Whole frame | +0.20 to +0.58 ms, about +0.45 typical | +0.08 to +0.46 ms, about +0.24 typical |
| Depth prepass | +0.15 to +0.31 ms | +0.03 to +0.12 ms |
| Lit pass | +0.07 to +0.32 ms | +0.03 to +0.30 ms |
| SSR | +0.00 to +0.07 ms | unchanged |

Walking the path with a quick turn, soaked against dry in two rounds, the GPU mean is now +0.14 to +0.18 ms (it was +0.28 ms). The shadow pass, which now includes the bake, is unchanged at 0.23 ms. The worst frame is 13.0 ms soaked against 13.7 to 13.8 ms dry, apart from one first-round frame at 17.1 ms. Against the start of the day, with the scene's rain on, each benchmark pose is 0.2 to 0.45 ms faster (2.6% to 6.7%), and the image hardly changed (mean difference 0.06 or less, at most 0.1% of pixels off by more than 12 of 255).

Mean frame brightness, dry against soaked, torch only:

| Pose | Dry | Soaked |
|---|---|---|
| path start | 25.2 | 19.0 |
| long stretch | 14.5 | 9.8 |
| clearing | 16.6 | 13.1 |
| gate close | 19.4 | 18.5 |

![The path start, dry and soaked](/images/2026-10-26-running-water/path-dry-wet.jpg "Left: dry. Right: soaked and raining. The ground is darker and there are rain streaks.")

In a flash at the clearing, the mean goes from 27.9 to 29.4 and the 99th percentile from 146 to 176, because the soaked ground is darker and the puddles mirror the flash.

![The clearing in a flash, dry and soaked](/images/2026-10-26-running-water/clearing-flash-dry-wet.jpg "Left: dry ground in a flash. Right: soaked ground with bright puddles mirroring the sky.")

### Checks

- The hallway, house and kitchen benchmarks, rendered with a clean build of an earlier commit and with this one, show no changed pixel in any pose, and timings within noise. The day woods are unchanged, because the bake and the wet code run only while the world is wet.
- To check the rivulets in motion I walked towards a trunk and took screenshots with TAA on and off. There was no smearing, but the walk ends at a trunk the torch lights nearly white, so this check is limited.
- `ctest` passes 116 of 116. The descriptor layout test now also checks the new slots and register t48.

## Open issues

- The lit pass's wet share (+0.03 to +0.30 ms) is now most of what remains. If I need more, I will measure the ripples (two hashed layers) and the rivulets next.
- I have not checked whether TAA smears the flowing cores while walking.
- Drips from roof edges, where the shelter map's height jumps, are not done.
- The faint grey rectangles I once saw in a debug view of the puddles' reflections are still not verified.
- Rain and thunder sound are the next step of the weather plan.
