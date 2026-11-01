---
title: A two-triangle leaf for distant plants, and a check for frame-time spikes
date: 2026-10-28
order: 1
summary: I add a third, two-triangle version of every leaf for far plants, find why shadow redraws caused random frame drops, and add a per-frame check that catches them.
tags: performance, foliage, shadows
cover: /images/2026-10-28-two-triangle-leaf-shadow-runs/far-tiny-full.jpg
---

The previous day ended with the lit pass drawing only the leaf triangles that won a pixel, and with a test that fails when plants pop. The pop test gave me a baseline: far plants were a little sparse and clumpy, and the next planned step in Track V was a cheaper leaf for plants that are only a few pixels across. That step is V4, a leaf with two triangles.

While walking the woods afterwards I also saw frames drop at random. The per-second frame-rate log and my static benchmarks both looked fine, so that problem needed a different kind of measurement before I could fix it. This post covers both: the cheaper leaf, and the hunt for the frame drops.

## Levels of detail for a single leaf

### Background: geometric level of detail

A level of detail (LOD) is a cheaper version of an object that is drawn when the object is far away. The usual unit is a whole model: a tree at 10 m uses a mesh of 20,000 triangles and at 100 m a mesh of 2,000. Two things decide how well it works.

1. **The switch distance.** The cheaper version must be indistinguishable at the distance where it takes over. A common rule is to switch when the detail being removed is smaller than a pixel on screen, so the decision comes from screen size and not from a fixed number of metres.
2. **The transition.** If the switch is visible, the object pops. Engines hide it with a cross-fade, with a dither, or by choosing the switch distance so that the difference stays under a pixel.

Leaf-level LOD applies the same idea at a smaller scale. A tree or a bush has thousands of leaves, and each leaf is a small mesh. A leaf that is 12 cm long spans many pixels when the player stands next to it, and 6 pixels at 25 m at 1440p. Drawing it with the same triangles in both cases spends geometry the eye cannot see.

### Background: triangle count against pixel coverage

The cost of a triangle has two parts that scale differently.

- **Per-triangle work.** The GPU fetches the indices, transforms three vertices, assembles the triangle, clips it and sets it up for rasterisation. This cost is the same for a triangle that covers 5,000 pixels and one that covers one pixel.
- **Per-pixel work.** The rasteriser finds which pixels the triangle covers, the depth test runs, and the pixel shader runs for the pixels that pass.

For large triangles the second part dominates, which is why overdraw and shader cost get most of the attention. For leaves at a distance the balance reverses. A leaf that is 6 pixels long covers perhaps a few tens of pixels. If it is built from 8 triangles, each triangle covers a couple of pixels at most, which is my own arithmetic from the leaf size and not a measurement.

Triangles that small are expensive for two reasons that come from how GPUs are built.

1. **Pixel shaders run in 2 by 2 quads.** The hardware shades neighbouring pixels together so that it can compute screen-space derivatives by subtracting neighbours, and texture filtering needs those derivatives to choose a mip level. If a triangle covers only one pixel of a quad, the other three invocations still run and their results are thrown away. A triangle that covers one pixel can cost four pixels of shading. My leaves are alpha-tested, so their pixel shader samples a texture and may discard, which makes every wasted invocation a texture fetch.
2. **The rasteriser is built for many pixels per triangle.** Its fixed-function hardware converts a triangle into a block of pixels per clock. A triangle that yields two or three pixels leaves most of that capacity idle, and the time is then set by the number of triangles and not by the number of pixels.

The lesson for foliage is that halving the triangle count of a far leaf can matter more than halving its pixel count, because the pixel count is already close to the floor.

### What I already had

From the earlier leaf work, each leaf has two versions. The full leaf is 9 vertices and 8 triangles, with a fold along the midrib. The far twin uses the same vertices as 4 triangles from the edge vertices, which flattens the fold and keeps the outline. The far twin is drawn where a leaf is 12 pixels long or less, and it is used in every shadow, because a shadow only needs the outline.

Far leaves are a few pixels long, yet each still had 4 triangles. V4 adds a third version, the tiny twin, with 2 triangles a leaf. It is drawn where a leaf is 6 pixels long or less. In the source, the switch distances come from the leaf's typical length (12 cm), the screen's pixels per metre and the pixel thresholds, so the tiny twin starts at twice the distance of the far twin: about 25 m at 1440p and 12.5 m at 720p. Shadows keep using the far twin.

![Which version of a leaf is drawn at each distance](/images/2026-10-28-two-triangle-leaf-shadow-runs/leaf-levels.svg "The full leaf, the 4-triangle far twin and the 2-triangle tiny twin, with the distances where each takes over at 1440p.")

## Choosing the shape of a two-triangle leaf

Two triangles make a quad or a diamond. The choice changes how much light and screen area the leaf gets, so I measured three shapes with the pop check, which compares the engine's frames against every leaf at full detail.

- **A diamond from the stem through the widest points to the tip.** This was the plan. It looked darker, with a fifth more dim pixels than the full-detail reference. The reason is that the diamond dips along the midrib, below the far twin's flat plane, and that plane is what casts every leaf's shadow. At a distance the engine grows the kept leaves, up to five times, so the dip falls inside the leaf's own shadow.
- **A quad on the existing edge vertices.** It is flat, but it cuts off each leaf's widest part. The plants covered 13% to 26% less of the screen.
- **A flat quad on four vertices of its own.** I kept this one. It sits in the far twin's plane, and each quad is widened so that its area matches the far twin's. Over a whole bush the area is within 1.5% of the far twin's.

The kept shape costs four extra vertices a leaf, which is about 35% more vertices in the six bush and sapling meshes. Rerunning the leaf ranking script gives the same bytes as before, and the near and far data are unchanged.

The asset audit needed a fix. It counted every triangle in a mesh, including the far twins, so one sapling went over the 50,000-triangle prop budget once the tiny twin was added. It now counts only the triangles that are drawn together, which means the full leaves and not their stand-ins.

### Results

`DrawBatchingTests` checks that exactly one of the three leaf versions is drawn at any distance, in the right order, and that a mesh without a tiny twin keeps the far one. `ctest` passes 117 of 117.

The pop check improved. The block difference is better at 40, 22, 16 and 12 m, and the share of changed pixels is better at every far distance. Coverage is within 2 to 3 points of before: worse at 40, 22 and 16 m, better at 30 m. I rebaselined the limits to the new numbers. Most became tighter, and coverage at 40, 22 and 16 m became 2 to 3 points looser.

Night woods, 1440p, TAA off, without the tiny twins and then twice with them:

| Pose | Without (ms) | With (ms, two runs) | Prepass triangles |
|---|---|---|---|
| path start | 10.30 | 10.20, 10.23 | 11.00 to 10.26 M |
| fallen tree | 9.19 | 9.30, 9.17 | 8.66 to 8.17 M |
| into the bank | 9.45 | 9.47, 9.41 | 8.86 to 8.25 M |
| gate close | 6.92 | 6.97, 6.89 | 3.20 to 3.00 M |
| mean of 11 poses | 8.75 | 8.78, 8.73 | 1% to 7% fewer |

The gain is within noise. The reason is where the triangles are. Most leaf triangles belong to leaves near the player, which are still drawn in full, and plants beyond 25 m were already thinned to a few leaves each. The tiny twin removes 1% to 7% of the prepass triangles and that is too little to see in the frame time. In the images only single far leaves against the sky move by a pixel, with 0.01% to 0.17% of pixels changing by more than 24 levels. A walk with a quick turn at night gave a GPU mean of 10.37 and 10.43 ms and a worst frame of 15.9 and 16.1 ms, against 16.1 and 15.5 ms before. That is the same within noise.

![Far leaves at 30 m with each level of detail, and the night woods' far canopy](/images/2026-10-28-two-triangle-leaf-shadow-runs/far-tiny-full.jpg "Top: at 30 m, the far twin, the tiny twin and every leaf at full detail. Bottom: the night woods' far canopy with far twins and with tiny twins, enlarged three times.")

The far clumps and the 9 to 16 m coverage gap that the pop check showed do not come from the leaf shape. They come from the thinning, which keeps fewer leaves and grows them. The tiny twin does not change that, so those remain open.

## Frame drops that no average showed

### Background: spikes against averages

A frame-time average describes the typical frame. A walk through the woods averaged 10 ms a frame, and 1,880 frames of it hid 21 frames of 13 to 15 ms. That is about 1% of the frames, so it barely moves the mean. It also barely moves the 99th percentile, which is the frame time that 99% of frames stay under: 19 slow frames fit inside the worst 1%.

The eye does not judge smoothness by the mean. Motion looks smooth when each frame takes about as long as the one before it. A single frame that takes 4 ms longer than its neighbours is a visible hitch even when the average is far below the display's 16.7 ms. Two kinds of measurement are therefore wrong for this problem:

- **A per-second average** divides a hitch by about a hundred frames.
- **A static benchmark** stands still. The engine caches shadow tiles whose content has not changed, so a benchmark pose does almost no shadow work after the first frame, and a hitch that comes from redrawing shadows never appears.

The game also has a hitch warning, but it only fires for a frame three times the typical one. A frame of 14 ms against 10 ms is far below that.

### How shadow redraws land on one frame

The sun's shadows come from four cascades, each an orthographic shadow map covering a slice of the camera's view. A cascade is cached. It stays put until the camera has moved a step, and then it moves and its map is redrawn in one go.

A redraw is a large piece of work. The day woods have about 5,000 shadow casters in a cascade, and a redraw sends 35 to 40 million triangles through the GPU, which took 4 ms of shadow time. On every frame where nothing moves, the shadow pass costs nothing. On the frame where one cascade moves, the pass costs 4 ms on top of a 10 ms frame. The work is steady in total and arrives in lumps, and a lump is a hitch.

To see this I added `--frame-log`, which writes every frame of a run to a CSV with its CPU time, GPU pass times and shadow triangle counts. I recorded a walk with five quick turns in each woods scene. The day woods showed a frame of 13 to 15 ms every 3 to 5 seconds, 21 of them in 31 seconds. Each was one cascade moving and redrawing.

The night woods have the same redraw when lightning lights the cascades. At night the sun casts no shadow between flashes. Flashes come every 8 to 25 seconds, which is why the drops looked random.

### Why a redraw was bigger than it needed to be

A redraw of 35 to 40 million triangles was more than the plants in the cascade needed. A shadow face draws its casters in instanced runs: one draw call per mesh, with one instance for each caster that uses the mesh. All instances in a draw call draw the same number of triangles.

The leaves are thinned with distance. A near plant keeps all its leaves and a far plant keeps a few. A run draws its leaf triangles as far as its least thinned caster needs. The vertex shader then collapses the extra leaves of each farther plant to nothing, which makes them zero-area triangles. They still go through the GPU, because fetching and setting up a triangle happens before the rasteriser can discard a degenerate one. The cost of a run is therefore the number of casters times the triangles of the least thinned one.

One run held a sapling from 3 m to 100 m away. Every far sapling in it paid for all of its leaves.

The camera's own passes already avoid this by splitting runs into half-octave distance bands, where each band spans a distance ratio of about 1.4 (the square root of 2). Within a band the thinning varies little, so a run's waste stays small. The shadow runs did not use the bands. I applied the same split to them (`ShadowCaster::band`) and left the faces that are cached over the whole level as they were.

The shadows are identical. The day woods bench poses with and without the change differ by 0 to 5 pixels. The worst redraw dropped from 4.37 to 2.40 ms of shadow time, the 99th percentile of the shadow pass from 3.52 to 2.27 ms, and the largest redraw from 40.6 to 13.2 million triangles.

I also tried to cap the leaves for each cascade by its texel size, since a coarse cascade cannot resolve small leaves. It cut a redraw's triangles by a fifth, from 13.2 to 10.8 million, but the redraw still took 2.4 ms and it changed up to 2,837 pixels at one pose. I dropped it. The remaining cost is probably not leaf triangles but the trees' alpha-tested cards filling the 2048 by 2048 tiles, which I address the same day in the next post.

### A check that catches spikes

The fix needed a measurement that would have caught the problem and that I could run again. `Scripts/Check-FrameSpikes.ps1` walks both woods at 1440p, uncapped, from the path start, with five quick turns, over frames 200 to 2000. It writes the frame log and fails a walk for any of these reasons:

- a frame over 15 ms;
- more than 3 spikes, where a spike is a frame over 12 ms and over 1.3 times the median of the 60 frames around it;
- a window of the wrong size. Once, a window opened just as the last one closed came up at 1600 by 900, which would have made the numbers incomparable.

The second rule is the important one. Comparing a frame with its own neighbourhood finds a hitch wherever the baseline sits, and the absolute limit of 12 ms keeps small variations out. GPU times are read back two frames late, so the script reports the shadow time from two rows after a spike, which is the spike's own passes.

Every change that affects what is drawn now runs this check before and after.

![Frame time over the walk before and after the shadow-run fix](/images/2026-10-28-two-triangle-leaf-shadow-runs/walk-frametimes-before-after.jpg "Frame time over the day and night walks, uncapped at 1440p, before (grey) and after (blue). The tall single-frame peaks of the day walk are mostly gone.")

### Results

Walks at 1440p, uncapped, 1,880 frames each:

| Walk | Mean | 99th percentile | Worst | Spikes |
|---|---|---|---|---|
| day, before | 10.06 ms | 13.00 ms | 14.87 ms | 21 |
| day, after (three runs) | 9.84 to 10.04 ms | 11.93 to 12.48 ms | 12.5 to 13.6 ms | 0 to 1 |
| night, before | 10.09 ms | 12.09 ms | 15.63 ms | 2 |
| night, after (three runs) | 10.04 to 10.09 ms | 11.93 to 11.98 ms | 13.4 to 13.8 ms | 0 |

The mean barely changed, which is the point of the section above. The 99th percentile fell by about a millisecond and the spikes in the day woods went from 21 to at most one.

One day walk had a single frame of 51 ms, where Present blocked for 43 ms and the GPU's own timestamps said 50 ms. It did not repeat in two reruns, and nothing in the engine's work changed on that frame, with the same tiles and no uploads. I treat it as an outside cause. The check will flag it again if it returns.

## Open issues

- A cascade that moves is still redrawn in one frame, at 2.4 ms. The next flash is known in advance, so a moved cascade could be redrawn in parts in the dark frames before it. That is V7 and the subject of the next post.
- The woods' light probes report as stale since the tiny twin changed the leaf meshes. Lighting still uses them, and a rebake clears the warning.
- Occlusion culling in the prepass (V5) is the next idea for the near leaves, where the time is.
- The far clumps and the 9 to 16 m coverage gap come from the thinning and remain.
