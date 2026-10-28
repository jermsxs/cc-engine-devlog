---
title: Draw only what can be seen
date: 2026-10-27
order: 3
summary: A new track to make the leafy woods cheaper, with per-pass counters, a lit pass that draws only the leaf triangles that won a pixel, steadier frames, and a test that catches popping.
tags: performance, renderer, foliage
cover: /images/2026-10-27-only-what-can-be-seen/into-the-bank.jpg
---

After the leaves, the night woods ran at 11.4 ms a frame on my RTX 4070 at 1440p. That is fine for a fast card, but my target is a mid-range RTX 3060, and about 8 ms on mine. I had two ways to cut the cost. I could make each leaf cheaper, or draw fewer leaves. Before choosing, I wanted to know where the time was going. So I opened a new track, which I call V for visibility, whose whole job is drawing only what you can see.

## First, measure

The engine now counts, for the prepass, the lit pass and the shadow pass, how many triangles are drawn, how many are rasterized and how many pixels are shaded. The numbers go into the benchmark's output.

At the path start, the prepass and the lit pass both drew 11 million triangles. The prepass shaded every screen pixel about 10.5 times (that is *overdraw*: many leaves stacked in the same pixel). And only 4 to 9% of the foliage triangles ended up winning a pixel.

> **Concept: The prepass and the "EQUAL" trick.** The engine first draws the whole scene cheaply into a depth buffer: the *prepass*. Then the expensive lit pass draws everything again, with shading, but a pixel is shaded only if its depth is *equal* to the one the prepass stored. The hidden stuff fails the test and isn't shaded. That saves shading work. But it does *not* save the cost of sending the triangle through the GPU: setting it up and testing its pixels. With 11 million leaf triangles and 90% of them hidden, the lit pass was paying for triangle setup, not shading.

That was good news. It made the lit pass something I could fix exactly, with no change to the picture.

## Draw only the winners

The idea is borrowed from a *visibility buffer*. Instead of storing colours, you store, for each pixel, *which triangle* is in front. Then you know exactly which triangles are visible, and everything else can be thrown away.

My version has three steps:

1. **The prepass writes an id for each pixel.** The id is made of the draw call, the instance (which copy of the mesh) and the triangle number.
2. **A small compute pass reads those ids.** A *compute shader* is a program that runs on the GPU outside of drawing, good for bookkeeping over lots of data. It sets a bit for every triangle that won a pixel. Then, for each instance, it copies just those triangles' indices into one shared index buffer, and writes an indirect draw command for each instance that has any visible triangle.
3. **The lit pass draws those with `ExecuteIndirect`.**

> **Concept: Indirect drawing.** Normally the CPU tells the GPU "draw this mesh, this many triangles". With *indirect* drawing, the draw commands live in a GPU buffer. The CPU just says "execute whatever is in that buffer". That lets a GPU program, here my compute pass, decide what to draw without the CPU ever learning the answer. That matters because reading the answer back to the CPU would stall the whole pipeline.

To let an indirect draw pick its object, the scene's vertex shader now reads its instance from a small per-instance stream (0, 1, 2, …) instead of the built-in instance id.

### What the GPU taught me

My first version was correct, and no faster at all. I ran experiments to isolate why, and found two things on the 4070: an indirect call costs about 10 microseconds, and each *command* inside it costs about 0.13 microseconds, whether it draws anything or not. With thousands of instances, almost all empty, that adds up. Two changes fixed it:

- **Only instances with a visible triangle get a command.** The compute pass packs them first and writes a count per draw, so the GPU never walks the empty ones.
- **Only big draws are compacted.** A draw needs at least 16,384 triangles over all its instances. Below that, the indirect call costs more than it saves. I benched thresholds from 4,096 to 262,144 to find it.

The result, at 1440p, no TAA:

| pose | before | after | lit-pass triangles |
|---|---|---|---|
| path_start | 11.65 ms | 10.31 ms | 11.0 M → 2.6 M |
| into_the_bank | 10.69 ms | 9.53 ms | 8.9 M → 1.8 M |
| clearing | 10.03 ms | 9.33 ms | 6.7 M → 2.5 M |
| up_at_the_canopy | 7.05 ms | 6.83 ms | 3.6 M → 1.2 M |

The compaction itself costs 0.1 to 0.2 ms. Walking with a quick turn, the mean GPU time fell from 11.7 ms to 10.45 ms. There is no hitch when you turn quickly, because the compaction follows the prepass of the *same* frame, so no triangle can be missing.

Was the picture the same? In the hallway, house and kitchen, every pixel is identical. In the night woods, 11 to 84 pixels out of 3.7 million differ by more than 2 levels, and in the day woods 73 to 271. Those come from depth ties, where two triangles are at the same depth and either can win. I also ran GPU validation, a debug layer that checks every command against the rules, over eight poses. It found no errors or warnings.

![The path start with compaction off, on, and the pixels that differ in red](/images/2026-10-27-only-what-can-be-seen/compaction-diff.jpg "Left: compaction off. Middle: compaction on. Right: the pixels that differ, marked in red and enlarged ninefold so they can be seen at all.")

It also changed my plan. I had planned a full visibility-buffer renderer. This got most of its benefit, the lit pass no longer pays for hidden triangles, with a fraction of the work. The prepass is now the biggest pass at 2 to 4.4 ms, with 10 times overdraw, so the next step is culling there.

## Steady frames

Around then I noticed the frame rate swinging more than before, dipping into the 70s. I recorded a frame-by-frame trace of the walk and found two causes. Neither was the new compaction.

**The order bug.** Each shadow tile has a *cache key*: a hash that says "nothing that casts into this tile has changed, so keep the old picture". My key hashed the tile's casters in list order. That list is sorted by mesh batch. So when any plant anywhere changed its level of detail, the order shifted, and *every* face looked changed and redrew. Even the far face over the whole level, with its 4,555 unchanged casters. Now each caster is hashed on its own and the hashes are summed, so the order doesn't matter.

**The cascades in a flash.** Between flashes the moon casts no shadows. But during a lightning flash, all four sun cascades redrew every frame: 5 to 8 ms of shadows for about 15 frames, roughly 50 fps for a quarter of a second. With thousands of plants in each cascade, some plant changed its thinning step every frame the player walked. Three changes fixed it:

- A cascade keeps the levels and thinning it was drawn with until it actually moves. Its shadows are soft and coarse, so this doesn't show.
- In a flash, each cascade moves at most once, and at most one cascade moves in a frame.
- A cascade whose view stayed put and whose casters changed waits a frame when another one redraws.

The torch's and lamps' shadows are unchanged, and still redraw on every change.

![Frame time over the night walk, before and after the shadow cache fix](/images/2026-10-27-only-what-can-be-seen/frametimes.jpg "Orange: before. Blue: after. The tall spike from the lightning flash (around frame 730) is gone, and the small ones are fewer.")

| | before | after |
|---|---|---|
| mean | 10.76 ms | 10.37 ms |
| 99th percentile | 19.03 ms | 12.16 ms |
| frames over 16.7 ms (60 fps) | 16 | 0 |
| typical frame-to-frame change | 0.36 ms | 0.13 ms |

The images were within noise: the hallway, house and kitchen were identical, and the woods differed by a few scattered pixels. What remains of a flash is one frame of about 15 to 16 ms, when the far cascade redraws, and three frames of about 13 ms. Then I asked for the branch to be merged. There were no conflicts, and I ran the tests again on the main branch: 116 of 116 passed.

## A test that catches popping

My rule since the leaf work is that nothing may pop, appear or thin visibly as you walk. Until now, I checked it by eye. But the next steps (a cheaper two-triangle leaf, culling the prepass, clusters) all change which leaves get drawn, and they need a measure that fails when they make things worse.

The test renders two of the woods' bushes and a sapling offscreen at nine distances on a straight walk in, from 40 m to 4 m, 720p, with a low sun behind. Each frame is rendered twice: once as the game draws it, and once with every leaf at full detail. Then it measures three things per distance:

- The difference of 8×8-pixel block averages. This is what the eye notices: a bush getting lighter, darker or thinner, not which leaf landed on which pixel.
- The share of plant pixels that change by more than 24 levels.
- The gap in how much of the screen the plants cover.

Each distance has its own limit: today's numbers plus a margin. A detail change that does worse fails the test.

The first run counted 90% of the screen as plant, because film grain and the vignette made the background vary pixel by pixel. With grain and lens effects off, the background is one flat colour and the runs repeat exactly.

![The game against every leaf at full detail, at 22, 12, 9 and 7 m](/images/2026-10-27-only-what-can-be-seen/pop-check.jpg "Left: the game at each distance. Right: every leaf at full detail. The far plants look clumpy, and the near ones are nearly identical.")

What did it find? Good news, then two weaknesses:

- **Nothing pops.** The change is spread smoothly over distance with no step between neighbouring distances. Full detail ends at 6.2 m, and the difference grows gradually past it.
- **The plants are a little sparser at 9 to 16 m.** The thinned plants cover 9 to 13% less screen than every leaf would. The kept leaves grow to make up the area, but sprays and overlaps don't make it all back.
- **Far plants look clumpy.** From about 20 m, fewer, larger leaves read as clumps rather than a fine scatter.

To prove the test works, I made a deliberate mistake: I thinned sooner (12-pixel leaves became 16). The test failed at five distances. I restored the constant.

## What's next

The sparse and clumpy results are now the baseline to beat. The next step is a two-triangle leaf, which should bring back the 9 to 16 m coverage and soften the far clumps. Then the prepass culling. The pop check is only a single sunlit view, so a night view with the torch would add a case where leaves and their own shadows change together. And the lit pass still takes 3 to 4 ms for 2.6 million triangles, so merging a batch's draws into one indirect call is my next idea there.
