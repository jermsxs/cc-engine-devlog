---
title: Every leaf, at every distance
date: 2026-10-27
order: 2
summary: Instead of swapping bushes for cards, I draw their real leaves everywhere and thin them leaf by leaf, by how big a leaf looks on screen, and merge the weather track.
tags: foliage, performance, renderer
cover: /images/2026-10-27-leaves-at-every-distance/thinning-by-pixels.jpg
---

Yesterday's cross-fade hid the pop when a bush switched from a flat card to real leaves. But I could still see it. A far bush was a card. A near bush was real leaves. And somewhere in between, a few steps in front of me, the bush visibly changed. A fade hides a switch, but a switch is still a switch. Today I removed the switch altogether.

## Stop switching, start thinning

The idea: bushes and saplings are drawn with their real 3D leaves at *every* distance. Far ones simply draw fewer of them.

> **Concept: Stochastic simplification.** Imagine a bush with 48 leaves. At 40 m, each leaf is a speck smaller than a pixel. Drawing all 48 is a waste, since many pile up in the same pixels. Instead, draw a random fraction of the leaves, say one in four, and make each remaining leaf a bit larger so the bush still covers about the same area and keeps its colour and density. Do this smoothly with distance and no one-time swap exists to notice. This is the stochastic simplification of foliage described by Cook, Halstead and others in 2007.

**Ranked leaves.** A tool gives every leaf of a plant a random rank and sorts the index buffer by it. The first N% of the indices is then an even sample of the whole plant. So a draw call can take "the first 25%" and really draw a quarter of the leaves, so far bushes genuinely cost less. Each leaf's vertices also carry an offset from its stem point, packed into the vertex colour.

**Growing the leaves that stay.** The leaves that survive grow about their stems by the inverse square root of the share kept, so the plant covers the same area from afar. Leaves at the edge of the share shrink to their stem over a short band instead of vanishing, so walking in or out changes nothing visible. A few leaves grow or shrink a little with every step.

**Stems.** Spray stems and the finest branches moved to their own slot, which thins the same way but only shrinks, so far bushes are not a tangle of bare twigs.

**Shadows.** The shadow faces near the player cast with the camera's share, in steps of 1/64th so the cached torch and lamp shadows only re-render on a real change. The sun's cascades are soft, so they take the share *squared*: fewer, larger leaves cast the same shade. The fixed faces (far sun face, shelters, canopy map) take the floor share and skip the stems, so they stay cached.

The card levels for bushes and saplings are gone. Trees keep theirs, since their crowns are far overhead.

The first version thinned the leaves from 3 m: within 3 m, every leaf. Past that, the share fell as the distance squared (so leaves per pixel of screen stay about the same), to a floor of 1 in 36. That was cheaper than the cross-fade at every pose, but it was not enough.

## A leaf's size on screen, not a distance in metres

I still saw leaves appear on a bush a few steps before reaching it. The reason was obvious once I thought about it. At 3 m, a leaf is about 50 pixels long. Each leaf added or taken away can be seen. And the leaves kept were grown to twice their size by 6 m.

So I changed what drives the thinning. It no longer starts at 3 m. It starts when a leaf is about **12 pixels long** on screen. At 1440p that is about 12.5 m, nearer at a lower resolution, where the leaves are smaller on screen too. Past that, the share still falls as distance squared, so the leaves kept stay about 12 pixels.

I also changed *which* leaves go first. Ranks now prefer the inside of a plant: a leaf's rank blends how deep in the crown it sits (75%) with some chance (25%). The hidden inner leaves are thinned first, and the outer shell that your eye follows goes last. The ranks are spread evenly, so the prefix a draw takes is exactly the share kept.

![Walking in at 18, 11 and 8 m with thinning from 3 m, from 12 pixels, and every leaf](/images/2026-10-27-leaves-at-every-distance/thinning-by-pixels.jpg "Each row is a distance. Left: thinned from 3 m. Middle: thinned from 12 pixels. Right: every leaf drawn. The middle column is the hard one to tell from the right.")

I measured it with walk-in frames at 24, 18, 14, 11, 8 and 6 m, against every leaf drawn. The mean absolute difference was 0.49 to 1.50 levels thinning from 3 m, 0.12 to 0.15 from 16 pixels, 0.06 to 0.10 from 12 pixels, and 0.03 to 0.07 from 8 pixels.

## Paying for it

Of course, drawing every leaf out to 12.5 m costs a lot more. Every leaf everywhere measured 25 ms, far over budget. I found three savings:

- **A lighter lit pass for foliage.** The depth prepass already cut out the see-through parts of each leaf. The lit pass for foliage repeated that test. Now it tests that depth is *equal* to the prepass's, and never discards, so hidden leaf pixels are skipped before shading. The image is unchanged.
- **A far twin for each leaf.** A leaf is nine vertices drawn as eight triangles. The far twin uses the same nine vertices but draws only four triangles, from the edge vertices. The outline is identical. Only the fold along the midrib is flattened, and that is under a pixel by the time you see the twin. It is drawn from where a leaf is 12 pixels long, and in every shadow, since a shadow only needs the outline.
- **A dead end.** I tried a lit-pass vertex shader that skipped last frame's position. It was bit-identical but no faster: the cost is the triangles, not the vertex work. Even at a quarter of the pixels (720p), about 75% of the extra cost remained.

| pose | thinned from 3 m | from 12 px | Δ |
|---|---|---|---|
| path_start | 9.77 ms | 11.40 ms | +1.63 |
| clearing | 8.66 ms | 9.73 ms | +1.07 |
| gate_close | 6.22 ms | 7.06 ms | +0.84 |
| gate_far | 7.32 ms | 8.61 ms | +1.29 |

That is the real price of keeping every leaf. Walking with a quick turn, GPU mean was 11.47 ms (9.86 for thinning from 3 m). Going to 16 pixels would save about 0.3 ms, at twice the difference from every leaf.

![A bush at mid distance in the day woods: old cards, every real leaf, and thinned leaves](/images/2026-10-27-leaves-at-every-distance/cards-full-thinned.jpg "Left: cards past 7 m. Middle: every leaf drawn. Right: thinned. The cards were denser than the real sprays, so far bushes now read slightly sparser than before.")

![Walking towards a bush in the day woods, at 7, 5, 3.5 and 2.5 m](/images/2026-10-27-leaves-at-every-distance/walk-in.jpg "Frames while walking in. There is no moment where the bush switches.")

![The woods in the torch, with the real leaves at every distance](/images/2026-10-27-leaves-at-every-distance/into-the-bank.jpg "The same view as yesterday, now with real leaves all the way back to the trees.")

## Merging the weather track

I was happy with the leaves after this second part, and asked for the weather branch to be merged. It had 98 commits covering the night, the clouds, the moon, lightning, rain, wet surfaces, puddles, running water and now the leaves. There were no conflicts, since the main branch hadn't moved since my last merge. After the merge, I built a release version and the whole test suite passed: 116 of 116.

## Still open

- **The woods are over budget.** At 11.4 ms at the path's start on my RTX 4070, against a target of about 8 ms for a mid-range card. The next cuts would be a two-triangle twin for leaves past 25 pixels' distance, or fewer triangles in the near leaf.
- **The lightning-flash shadow spike.** The worst frame was 22 ms, a flash, and it needed its own fix.
- **Far bushes** could use more leaves a spray, if they should read as dense as the old cards.
- **Sound** of the rain and the thunder is still waiting.

That frame budget was a bigger problem than the leaves, so it got its own track.
