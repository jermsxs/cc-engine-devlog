---
title: Visible-triangle compaction, a steadier shadow cache and an automated pop test
date: 2026-10-27
order: 3
summary: I measure where the foliage time goes, draw only the triangles that won a pixel with an indirect draw, fix a shadow cache that redrew everything, and add a test that detects popping.
tags: performance, renderer, foliage
cover: /images/2026-10-27-only-what-can-be-seen/into-the-bank.jpg
---

After the leaf work, the night woods ran at 11.4 ms at the path start on my RTX 4070 at 1440p. My target is about 8 ms on a GPU of RTX 3060 class. The foliage is the largest part of the frame, and thinning leaves further would eventually change the picture. I wanted to find out how much of the work was wasted before reducing anything visible, so I started a new track (`Docs/TrackV-Plan.md`) with measurement.

## Measuring first

The renderer now counts, for the depth prepass, the lit pass and the shadow pass, the triangles submitted, the triangles that survive clipping and the pixels shaded. The counters are D3D12 pipeline statistics queries (input-assembler primitives, clipper primitives and pixel-shader invocations), and the results go into the benchmark's JSON.

At the path start, the prepass and the lit pass each submitted 11.0 million triangles. The prepass shaded every screen pixel 10.5 times on average. Only 4% to 9% of the foliage triangles ended up winning a pixel.

### Background: overdraw and the depth prepass

A typical opaque pipeline draws all geometry twice. A depth prepass writes only depth, which is cheap because it runs no expensive shading. The lit pass then draws the same geometry with the depth test set to EQUAL, so the pixel shader runs only for the one surface that is nearest at each pixel. This avoids shading hidden pixels, which is the largest cost for complex materials.

What it does not avoid is the triangle work. Every triangle submitted to the lit pass is still fetched, transformed and set up for rasterisation, and then fails the depth test per pixel. Dense foliage is the worst case: thousands of leaves overlap, and most of them are hidden behind others. Overdraw (how many times a pixel is covered) was 10.5 in the prepass, so for nearly every leaf triangle the lit pass paid setup cost to produce nothing.

Since the lit pass tests EQUAL against the prepass, drawing only the triangles that won a pixel in the prepass changes no pixel: every other triangle would fail the test. That is a lossless optimisation, and the measurement said it could remove more than 90% of the lit pass's triangles.

## Drawing only the triangles that won a pixel

### The idea: a triangle ID per pixel

A visibility buffer, as described by Burns and Hunt, stores for each pixel the identity of the triangle that covers it, instead of shading attributes. Shading is deferred to a later pass that looks the triangle up. I do not defer shading. I use the visibility information only to decide what the lit pass draws.

The method has four steps (diagram below).

![The four passes of visible-triangle compaction](/images/2026-10-27-only-what-can-be-seen/compaction.svg "The depth prepass writes the winning triangle's id, two compute passes build a list of visible triangles, and the lit pass draws that list with indirect draws.")

1. **Prepass.** For each foliage pixel, the prepass writes an ID made of the draw, the instance and the triangle. In my engine this is a single value, the triangle's bit index plus 1, where 0 means no triangle.
2. **Mark.** A compute pass reads the ID target and sets one bit in a bitset for each ID it finds, using an atomic OR. After the pass, the bitset has a 1 for each triangle that won at least one pixel.
3. **Compact.** A second compute pass handles each instance of a foliage draw. It counts the set bits in the instance's range, using `countbits` on 32-bit words, copies just those triangles' indices into one shared index buffer, and writes an indirect draw command for the instance.
4. **Draw.** The lit pass draws the shared index buffer with `ExecuteIndirect`.

### Background: ExecuteIndirect

In D3D12, `ExecuteIndirect` runs a number of draw commands whose arguments are stored in a GPU buffer, according to a command signature that says what each command contains (for a plain indexed draw: index count, instance count, first index, base vertex, start instance). The CPU does not need to know the arguments, so a compute shader can generate them. That is what makes compaction possible without reading anything back to the CPU. An optional count buffer limits how many commands run.

One restriction affected the design. A draw's `SV_InstanceID` always counts from 0 within the draw and does not include the start instance. My scene vertex shader used `SV_InstanceID` to pick an object's data, so it could not tell instances apart in a command whose start instance is non-zero. The vertex shader now reads its instance number from a small per-instance vertex stream (0, 1, 2, ...), which the start instance offsets.

### What the GPU taught me

The first version was correct but no faster. I benchmarked variations to find why. On the RTX 4070, an indirect call costs about 10 µs, and every command inside it costs about 0.13 µs whether it draws anything or not. A frame with thousands of mostly empty instance commands spent its saving on the commands. Two changes fixed it:

- **Only instances with a visible triangle get a command.** The compute pass packs the non-empty instances first and writes a count per draw, so the GPU never walks the empty ones.
- **Only draws with at least 16,384 triangles (over all their instances) are compacted.** Below that the call costs more than it saves. I benchmarked thresholds from 4,096 to 262,144 to choose it.

Each command is a plain indexed draw with no root constant, because per-command root constants run far slower on NVIDIA hardware.

The visibility buffer I had planned for a later step turned out not to be needed. Compaction gets the benefit, that the lit pass no longer pays for hidden triangles, at a fraction of the work. The prepass is now the largest pass at 2 to 4.4 ms, with an overdraw of 10 times, so occlusion culling moves to the prepass.

### Results

GPU time at 1440p, TAA off, night woods, compaction off against on:

| Pose | Off (ms) | On (ms) | Change | Lit pass (ms) | Compaction (ms) | Lit-pass triangles |
|---|---|---|---|---|---|---|
| path start | 11.65 | 10.31 | -1.34 | 5.55 to 4.00 | 0.12 | 11.0 to 2.6 M |
| fallen tree | 9.97 | 9.29 | -0.68 | 4.79 to 3.84 | 0.21 | 8.7 to 2.6 M |
| into the bank | 10.69 | 9.53 | -1.16 | 5.03 to 3.70 | 0.18 | 8.9 to 1.8 M |
| up at the canopy | 7.05 | 6.83 | -0.22 | 2.58 to 2.25 | 0.20 | 3.6 to 1.2 M |
| gate far | 8.76 | 8.39 | -0.37 | 4.18 to 3.66 | 0.18 | 5.3 to 1.9 M |

All 11 poses are faster, by 0.13 to 1.34 ms. Walking the path with a quick turn, the GPU mean goes from 11.7 to 10.45 ms, and the worst second from 13.4 to 12.1 ms. The worst frame is a lightning flash, 22.3 against 21.0 ms. There is no hitch on a quick turn, because the compaction follows the prepass of the same frame, so no triangle can be missing.

![The path start with compaction off and on, and the pixels that differ](/images/2026-10-27-only-what-can-be-seen/compaction-diff.jpg "Left: compaction off. Middle: on. Right: the pixels that differ (red, enlarged ninefold). The differences are scattered single pixels.")

The image is expected to be identical. The hallway (6 poses), house (10) and kitchen (5) are identical in every pixel. In the night woods, 11 to 84 pixels out of 3.7 million differ by more than 2 levels, which I attribute to ties in depth. The day woods differ by 73 to 271 pixels. GPU-based validation in a Debug build (`CC_GPU_VALIDATION=1`) over 8 night-woods poses reported no errors or warnings. `DrawBatchingTests` checks the compaction plan: the bit ranges, the command order, the per-draw slot and the limits at which a draw is drawn whole instead.

The lit pass still takes 3 to 4 ms for 2.6 million triangles. The remaining cost is the smaller draws that are not compacted and the per-call overhead. My next idea there is to merge a batch's runs into one indirect call.

## A shadow cache that redrew everything

### The problem

I saw the frame rate swing more than before, with dips into the 70s. A per-frame trace of the night walk showed two causes. Neither was the compaction.

### Background: shadow map caching

A shadow map is rendered from the light's point of view. If neither the light nor any caster has changed since the last frame, the map is the same, so engines keep a cache of shadow tiles and redraw a tile only when its content changes. To detect changes, each tile has a signature: a hash of the light and its list of casters. The cache is only effective if the signature is stable when nothing really changed.

### Two bugs

**The order.** Each shadow tile's key hashed its casters in list order. The list is sorted by mesh batch, so when any plant anywhere switched level of detail, the order shifted. Every tile then looked changed and redrew, including the far face that covers the whole level with its 4,555 unchanged casters. I now hash each caster on its own and sum the hashes, so the order does not matter.

**The cascades during a flash.** Between flashes the moon casts nothing. During a flash, all four sun cascades redrew every frame, costing 5 to 8 ms of shadows for about 15 frames, which is roughly 50 fps for a quarter of a second. With thousands of plants in each cascade, some plant changed its level or its thinning step on every frame the player walked. Three changes fix it:

- A cascade keeps the levels and thinning it was drawn with until it actually moves, and at most one cascade moves per frame. Its shadows are soft and coarse, so this does not show.
- In a flash each cascade moves at most once.
- A cascade whose view stayed put and whose casters changed waits a frame when another cascade redraws.

The torch and the lamps keep redrawing on every change.

### Results

Night woods walk with a quick turn, 1440p, TAA on, per-frame trace over 1,100 frames:

| | Before | After |
|---|---|---|
| mean frame time | 10.76 ms | 10.37 ms |
| 99th percentile | 19.03 ms | 12.16 ms |
| frames over 16.7 ms | 16 | 0 |
| frames over 13.3 ms | 19 | 4 |
| typical frame-to-frame change | 0.36 ms | 0.13 ms |

Per second, the worst frame in the night walk went from 24.6 ms (6 of 13 seconds holding a frame over 16.7 ms) to 16.1 and 15.5 ms in two runs, with none of 12 seconds over. The day woods give 15.2 and 14.8 ms. What remains of a flash is one frame of about 15 to 16 ms when the far cascade redraws and three frames of about 13 ms. A few lone frames of 14 to 16 ms remain in the walk, each one cascade's move.

I checked the images against the build before the fix with TAA off. The hallway, house and kitchen are identical (the house differs in two pixels by one level). The night woods are within run-to-run noise (0 to 47 pixels in 3.6 million). The day woods differ in 19 to 153 single pixels, which are scattered leaf-shadow edges from a level or thinning that is a few frames old, with run-to-run noise there of 6 to 13.

## A test that catches popping

### The problem

My rule since the leaf work is that nothing may pop, appear or thin visibly as I walk. I had checked it by eye. The next steps (a cheaper far leaf, culling the prepass, clusters) all change which leaves are drawn, and they need a measure that fails when they make it worse.

### How to measure a pop

A pop is a visible change between consecutive frames that is not motion. It is hard to define on its own, but it can be measured against a reference: render each frame twice, once as the engine draws it and once with every leaf at full detail (`leafFullDetail`), and compare. If the difference changes smoothly with distance, nothing pops. If it jumps between neighbouring distances, something switches.

The comparison must measure what the eye notices, which is not the pixel-exact difference. A bush that is slightly lighter, darker or thinner is visible. Which leaf landed on which pixel is not. So I use three measures per distance:

1. The difference of 8 by 8 pixel block averages, which removes pixel-level noise and keeps changes of overall brightness and density.
2. The share of plant pixels that change by more than 24 levels.
3. The gap in how much of the screen the plants cover.

### The test

`LeafPopTests` renders two of the woods' bushes and a sapling offscreen at nine distances on a straight walk in, from 40 m to 4 m (720p, 60° view, a low sun from behind). Each distance has its own limits, which are today's numbers plus a margin, so a detail change that does worse fails the test. The test takes about 2 s.

Getting a clean measure took one fix. The first run counted 90% of the screen as plant, because film grain and vignette made the background vary pixel by pixel. With grain and lens effects off, the background is one flat colour and the runs repeat exactly.

| Distance | Block difference (levels) | Pixels changed > 24 | Coverage gap |
|---|---|---|---|
| 40 m | 1.67 | 21% | 4.8% |
| 30 m | 2.04 | 21% | 4.4% |
| 22 m | 2.56 | 23% | 3.1% |
| 16 m | 2.30 | 19% | 9.0% |
| 12 m | 2.26 | 18% | 12.7% |
| 9 m | 1.65 | 12% | 8.7% |
| 7 m | 0.29 | 1.4% | 2.4% |
| 5.5 m | 0.11 | 0.4% | 1.1% |
| 4 m | 0 | 0 | 0 |

![The test's frames at 22, 12, 9 and 7 m](/images/2026-10-27-only-what-can-be-seen/pop-check.jpg "The engine's thinned plants (left of each pair) against every leaf at full detail (right) at four distances.")

What it showed:

- **Nothing pops.** The change spreads smoothly over distance, with no step between neighbouring distances. Full detail ends at 6.2 m and the difference grows gradually past it.
- **The plants are a little sparser at 9 to 16 m.** The thinned plants cover 9% to 13% less screen than every leaf would. The kept leaves grow to make up the area, but sprays and overlaps do not make all of it back.
- **Far plants look clumpy.** From about 20 m the fewer, larger leaves read as clumps rather than a fine scatter, which is visible in the 22 m pair.

To confirm the test can fail, I made a deliberate regression: thinning sooner, at 16-pixel leaves instead of 12. It fails at five distances (30, 12, 9, 7 and 5.5 m). I then restored the constant. The frames are identical from run to run.

## Open issues

- The sparse and clumpy results are now the baseline to beat. The next step is a two-triangle leaf for far plants, which should bring back the 9 to 16 m coverage and soften the far clumps, and then the limits can be tightened.
- The prepass is the largest pass. Occlusion culling there is the next major item.
- The pop check is a single sunlit view. A night view with the torch would add a case where leaves and their own shadows change together.
- The lit pass still takes 3 to 4 ms. Merging a batch's runs into one indirect call is the next idea.
- `ctest` passes 117 of 117 with the new test. I merged the compaction and the shadow cache fix into master after a Release build and `ctest` run (116 of 116 at that point); it is not pushed.
