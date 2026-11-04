---
title: Duller puddles, footstep splashes and a CPU sweep of the woods frame
date: 2026-11-02
order: 1
summary: I tone down the puddle reflection, add splashes when the player walks through water, and cut the woods' CPU frame work from about 9.2 ms to 5.5 ms.
tags: outdoors, performance, renderer
cover: /images/2026-11-02-puddle-splashes-and-sweep/after-shine-game.jpg
---

The puddles from the previous entry looked like water, but in play I found them too shiny, and I wanted them to react when I walked through them. I did both. Before merging the branch I then ran a bug and speed pass over everything it had added: the ground, the puddles and the splashes. This entry covers the reflection fix, how the splashes work, and what the sweep found.

## Why the puddles were too shiny

The first thing I tried was the obvious one. Water had been using the default `F0` of 0.04, the reflectance seen head-on. Water's real value is about 0.02, from its refractive index of 1.33. I changed it and roughened the water slightly, and the image barely changed.

Most of the shine came from two other places.

- **Fresnel at grazing angles.** On the path I see the puddles from low down and at a long distance, so the view direction is nearly parallel to the surface. At that angle every surface reflects almost everything, whatever its `F0` is. I covered the formula in the previous entry. A lower `F0` moves the head-on reflection and leaves the grazing end almost where it was.
- **Bright sky gaps in the reflection probes.** A probe captured under a canopy contains a few very bright patches where the sky shows through. Seen at the steeper angles that appear when walking close to a puddle, these become white patches on the water.

So I added a scene setting, `relief.waterReflection`, from 0 to 1. It scales three things together: standing water's direct specular, its ambient specular from the probes, and its SSR weight. A value of 1 leaves everything as it was, and the editor shows it as Water Reflection. The woods use 0.4. Dry ground does not use the setting, so it does not change.

| Close view, editor flashlight off | Before | After |
|---|---|---|
| Near puddle: share of pixels with luma above 0.5 | 0.0099 | 0.0059 |
| Far puddle: share of pixels with luma above 0.5 | 0.0242 | 0.0097 |
| Ground beside them, mean luma | 0.208 | 0.210 |

![The puddle in game with full reflection](/images/2026-11-02-puddle-splashes-and-sweep/before-shine-game.jpg "Before, with the reflection at 1.0. The water shows bright patches where the probe sees sky.")

![The same view with the reflection at 0.4](/images/2026-11-02-puddle-splashes-and-sweep/after-shine-game.jpg "After, with the reflection at 0.4. The water is still dark and mirror-smooth and the bright patches are weaker.")

## Footstep splashes

The puddles had no response to the player. A static puddle that does not move when I walk through it reads as a decal. I wanted three things: a ring that spreads out over the water, a few droplets thrown up, and no splash on dry ground.

### Knowing where the water is

The shader knows where the water is, because it computes it per pixel from the wet decal. The CPU does not, and a splash has to be decided on the CPU, where the player's feet are tracked. I did not want a second description of the puddle that could disagree with the first.

`Engine/Runtime/WaterSplashes` therefore builds a 64 by 64 coverage mask for each wet decal, box-filtered from the alpha of the decal atlas. A worker thread decodes the atlas, which takes about 0.2 s, when the first wet decal appears. A point's standing water is the decal's coverage multiplied by its opacity, raised the way the shader raises it (`WetWater`). Because it uses the same formula, a splash lands only where I can see water and never on dry mud.

### Footfalls

The player's walk produces a footfall every 0.75 m. The feet alternate, 0.11 m to each side and 0.1 m ahead of the camera position. There is none while standing still or in the air. A foot splashes when it lands in water of at least 0.2, and the strength follows walking speed. At most four splashes are alive at once, and the newest take priority.

### Ripples as a normal perturbation

> **Background: ripples without geometry.** A ripple on still water is a few millimetres high. Modelling it as geometry would need a mesh far finer than anything in this scene. The usual approach is to leave the surface flat and change only its normal. The reflection, the specular highlight and the refraction all depend on the normal, so a tilted normal gives a visible ripple at no vertex cost. For a circular wave spreading from a point, the surface height is a function of the distance from the centre minus the distance the front has travelled, `h(d - c*t)`. The normal's tilt is the slope of that height, so the shader needs the derivative, `dh/dd`, and the direction away from the centre. The tilt then points outward along the ring, and it is added to the surface normal before shading. Ripples should fade with time and with distance, because the energy of a ring spreads along a longer circle.

`StepRipples` in `Decals.hlsli` does exactly this. It loops over the four ripples that are alive, with the newest first, and stops at the first empty one. For each pixel it measures the distance `d` from the footfall and the distance `front` the ring has reached, which is `age * speed`. The slope is a cosine of `(d - front)` at the wavelength, multiplied by a Gaussian window, so that three or four crests follow the front and the first is the highest. It fades with `life * life` and with `1 / (1 + d * 4)`. The result is a 2D tilt that is added to the normal. A ripple runs for 1.6 s at 0.35 m/s with a wavelength of 4.5 cm. It applies to wet decals and to rain puddles. Nothing is stored in a texture. Each ripple is a position and an age in a small constant buffer, and the cost is four iterations of the loop for pixels on water.

![A footstep's rings, enlarged](/images/2026-11-02-puddle-splashes-and-sweep/splash-rings.jpg "A footstep in the puddle, enlarged. Faint concentric rings run out over the dark water.")

### Droplets

The droplets use the rain's pass, so they are lit and fogged like rain. Each splash throws 32 droplets, drawn as 1 cm round blobs on ballistic arcs over 0.5 s. The rain pass now also runs when there is no rain but there are footsteps, and it skips the rain sheets when there are no raindrops.

> **Background: particles on a ballistic arc.** A thrown droplet follows `p(t) = p0 + v0*t + 0.5*g*t^2`. Gravity is the only force, so the position is a function of the start point, the start velocity and the age. A particle that follows such an arc needs no per-frame integration. This is why a short-lived effect of this kind can be cheap: the cost is the draw of 32 small blobs, and nothing is simulated step by step.

![The droplets a frame earlier, enlarged](/images/2026-11-02-puddle-splashes-and-sweep/splash-droplets.jpg "The droplets a frame earlier, enlarged. Small pale blobs lift above the rings.")

### Verification

`WaterSplashesTests` is new. It checks that masks are built only for wet decals, that standing water is found inside the disc and not outside it, above it, in a faint decal or in a stain, and that a walk through a puddle splashes only in the water, once per stride. It also checks that nothing splashes while standing or airborne, that splashes expire, and that there are never more than four, newest first. In game I walked a puddle with `--spawn=20.0,1.5,16.6,33,-75 --walk-frames=60:120`. The exit log counts the splashes, and the frames show the rings and a faint crown of droplets.

The 1440p bench over 12 woods poses was 2.6% to 3.0% faster than the run before at every pose. That is noise, and nothing got slower. The frame-spike walk still failed on the known hitch, which had moved to frame 236 at about 16 ms and involved no shadow work. The frame with the splash caused no spike.

## The bug and speed sweep

Before merging the branch, I wanted a pass for bugs and speed. I read the diff of everything since master: the ground, the puddles and the splashes. A review of the same diff, done without my notes, read it separately. Then I timed the woods frame by GPU pass and, with temporary timers, by CPU section. I benched every change with an image diff.

### Bugs

- **Water-only probes could be skipped.** Probes blend front to back, and water-only ones were listed last. A puddle inside a full-weight room probe was already fully covered before its own probe came up, so it showed the room's reflection. They are now listed first and scaled by the water, and dry pixels start after them. The woods have no room probes over the puddles, so they look the same. The review found this.
- **The rain pass ran 1.6 s per footstep.** That is the ripples' life, but the pass draws only the droplets, which fly for 0.5 s. It now runs only while a splash's droplets are in the air. I found this one, and so did the review.
- **The decal library could be re-read every frame.** In a scene without a decal library, `WaterSplashes` re-read it every frame. In scenes with decals but none wet, such as the hallway and the house, it scanned every decal every frame. It now reads the library once and rescans only when the decal count changes.
- **The splash count carried over.** It was not cleared between play sessions, so the exit log's count was wrong after the first play in the editor.
- **`ReplaceEntities` could half-apply.** If two new entities claimed the same removed id, for example two rebuilt copies with one name, the second failed after the old entities were already gone, and there was no undo step. The first now takes the id and the second gets a new one. A new `PathToolTests` case covers it.

### Where the woods frame went

I measured the `path_start` pose at 1440p on an RTX 4070.

| GPU pass | ms |
|---|---|
| Depth prepass | 4.54 |
| Lit (opaque) | 3.87 |
| Volumetrics | 0.81 |
| Post | 0.65 |
| GTAO | 0.56 |

The prepass is the largest pass. It draws about 13 million triangles, nearly all of them leaves, and runs the pixel shader 44 million times, which is 12 times per screen pixel. The objects are already drawn nearest first. I tried several changes.

- **Wind off:** -0.05 ms. The vertex shader is not the cost.
- **Stopping the leaves' prepass pixel shader after the alpha cut-out:** -1.45 ms. But then it writes no normals, which GTAO needs.
- **A geometric normal instead of the normal map:** -0.6 ms. It changed GTAO on leaves everywhere, on 0.5% of pixels. I rejected it.
- **Only the two texture taps that leaves need (`MaskedPrepassSurface`):** -0.2 ms with an identical image. I kept it.

![The rejected change](/images/2026-11-02-puddle-splashes-and-sweep/rejected-geometric-normal-diff.jpg "Rejected: geometric normals for leaves in the prepass. Top: the frame. Bottom: the difference from before, multiplied by 8. The change is spread over the leaves' ambient occlusion.")

### The CPU was nearly as slow as the GPU

The bench reported the "record" phase at 10.4 ms against 11.0 ms on the GPU. Part of that number is the bench's serial submission waiting for the GPU, so it did not tell me where the CPU time went. I timed each section with temporary timers, which I removed afterwards.

| CPU section (ms) | Before | After |
|---|---|---|
| Cascade fit (every caster's bounds) | 0.65 | 0.17 |
| Shadow casters built (18,831 objects, 7.7k casters) | 1.23 | 0.90 |
| Shadow casters sorted | 0.68 | 0.49 |
| 5 faces' casters collected and hashed | 1.47 | 0.64 |
| Camera's object loop | 2.80 | 1.05 |
| Camera's draws sorted | 1.20 | 0.20 |
| Placements updated (new) | not present | 0.35 |
| Everything before Present (sum) | about 9.2 | about 5.5 |

> **Background: why caching saves CPU time.** A frame renderer works out the same facts about every object on every frame: its world matrix, the inverse-transpose used for normals, its bounding box in world space. For a static object these are the same every frame, so recomputing them is wasted work. The cost is proportional to the object count, and the woods have 18,831 objects. A matrix inverse is not cheap, and recomputing three times a frame for each of them adds up to milliseconds. The standard remedy is to cache the result next to the object and invalidate it when its transform or box changes. The trade-off is correctness. The cache must be invalidated in every place where the input can change, otherwise a stale value is drawn, and that bug is hard to see.

Three changes account for most of the saving.

- **Placements.** Each object's world matrix, normal matrix and bounds were built three times a frame, for all 18,831 objects. They are now kept and rebuilt only when the object's transform or box changes. Last frame's matrix, which the motion vectors need, comes from the same cache, and only moving objects still write the hash map.
- **Sort keys.** The camera's sort recomputed both run keys, with a log2 each, inside every comparison. It now sorts precomputed integer keys. The shadow casters are structs of about 120 bytes, so they are sorted as keys and laid out once, and the structs are not moved during the sort.
- **Per-face hashing.** Each caster's own part of the shadow signature, and its meshes' upload state, which is a map lookup, were worked out once for each of the five faces. They are now worked out once per frame.

### How I measure spikes

A mean frame time hides hitches. A frame that takes 16 ms once in a few hundred frames is noticeable as a stutter and barely moves the average. The frame-spike walk, `Scripts/Check-FrameSpikes.ps1`, replays a fixed walk and records the time of every frame. It reports the mean, the 99th percentile, the worst frame and the number of spikes, and it fails above a limit of 15 ms. The bench measures a still pose, so it cannot show this kind of fault.

On this track the walk had failed every time on a hitch of about 16 ms at frame 235 or 236. After the sweep it passed for the first time.

| Frame-spike walk | Before | After |
|---|---|---|
| Mean | 10.81 ms | 10.27 ms |
| 99th percentile | not recorded | 11.51 ms |
| Worst frame | 15.9 ms | 12.79 ms |
| Spikes | 1 | 0 |

The walk still includes a splash, once. I did not trace the hitch to one specific change.

### Verification

The full `ctest` passed 121 of 121, plus the new cases. In the 12-pose woods bench against the previous run, the GPU was 2.1% to 4.1% faster at 11 poses and 0.3% slower at the `fallen_tree` pose. The images were identical, with a mean difference under 0.03 of 255, which is the TAA noise between two identical runs. I also rendered the house, the hallway and the kitchen against a build from before the sweep, made in a separate worktree. The images were identical at every pose, and the GPU time was within 1.6%.

![Before and after the sweep, long stretch](/images/2026-11-02-puddle-splashes-and-sweep/long-stretch-before-after.jpg "The long stretch before and after the sweep. The two frames are identical.")

## Open issues

- The leaf prepass is still the woods' largest pass. The real remedy is fewer leaf pixels, either by cutting the leaf geometry tighter around the alpha, or by writing only depth and a leaf id in the prepass and rebuilding normals for the winning pixels from the id. Both are larger than a sweep.
- The CPU still builds 7.7k shadow casters each frame and interns two batch keys for each, about 0.9 ms. Caching casters per object, as I did for placements, would remove most of it.
- `StandingWaterAt` decides splashes at mid relief height, so it can disagree with the shader at a puddle's edge. I accepted this for now.
- The droplets are faint, because the rain's lift cap of 0.06 holds them to glints. A cap for splashes only would make them stronger.
- A splash is visible only when I look down, because the foot is below the eye. A first-person body or a shadow would help.
- There is no sound yet, since audio is parked.
- Rain puddles show ripples but do not trigger a splash. Only wet decals do. Without volumetrics there are no droplets, since the rain pass needs the froxels, but the rings still show.
- There are no splashes for the enemy or for thrown props.
