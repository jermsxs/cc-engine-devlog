---
title: Thinning real leaves by screen size instead of switching to cards
date: 2026-10-27
order: 2
summary: I draw every bush and sapling with its real leaves at all distances and thin them leaf by leaf, by how large a leaf appears on screen, so no level-of-detail switch remains.
tags: foliage, performance, renderer
cover: /images/2026-10-27-leaves-at-every-distance/thinning-by-pixels.jpg
---

The dithered cross-fade from the previous post removed the visible jump between leaf cards and leaf geometry. I could still see the switch, though. A bush a few metres ahead was a card, and as I walked up to it the leaves appeared and the bush changed colour and density. The fade hides the exact moment of the swap, but it cannot hide that two different representations exist.

I decided to stop switching. Bushes and saplings are now drawn with their real 3D leaves at every distance, and far plants draw fewer of them. This post covers how that works and what it cost.

## Why a level-of-detail switch is visible

A level of detail (LOD) replaces an object with a cheaper one when it is far enough that the difference should not be visible. The assumption fails for foliage in two ways.

1. The cheaper version is a different kind of thing. A card is a flat texture, a leaf mesh is geometry. Their colour, density, lighting response and silhouette never match exactly, so any switch changes the picture a little. The change is small, but the eye follows a bush as you approach.
2. A switch at a fixed distance is a switch at a fixed number of pixels per leaf only for one screen resolution and one field of view. On a different monitor the same switch happens at a different apparent size.

Cross-fading reduces the first problem to a few frames of dither. Removing the switch removes the problem.

## Leaf-by-leaf thinning

### Ranked leaves

The cost of drawing real leaves at distance is triangles. A bush that covers 40 pixels still has the same hundreds of leaves as one that covers 400 pixels. The remedy is to draw fewer leaves, but there must be no visible event when the number changes.

I use stochastic simplification, the method described by Cook, Halstead and others in 2007 for dense natural scenes. A plant has `N` leaves. At distance, the plant keeps a share `s` of them, chosen at random, and enlarges each kept leaf so that the total coverage stays about constant. The plant then looks as full as before, while it costs `s` times as much. A leaf's area is scaled by `1/s`, which is a linear scale of `1/sqrt(s)`.

I implement it like this.

- **Ranking in the mesh.** `leaf_rank.py` gives every leaf of a plant a rank and sorts the index buffer by rank, so that the first `s·N` leaves' triangles are a contiguous prefix of the buffer. A draw call can take just that prefix, so far bushes really cost fewer triangles and no vertex work is wasted on the rest.
- **Leaf offsets in the vertex.** Each leaf's vertices carry the leaf's offset from its stem point, packed into the vertex colour next to the baked occlusion (`LeafPacking.h`). That lets the vertex shader scale the leaf about its own stem.
- **A smooth edge for the share.** A leaf at the boundary of the share does not vanish. It shrinks to its stem over a short band, 15% of the share. A leaf that has shrunk to a point draws nothing. Walking in or out then changes nothing visible, because only a few leaves grow or shrink a little with each step. In the shader, with `rank` between 0 and 1:

```
shown = saturate((keep * (1 + 0.15) - rank) / (0.15 * keep));
pos   = stem + offset * (grow * shown);   // grow = 1/sqrt(keep)
```

- **Stems.** Spray stems and the finest branches have their own mesh slot, `stems3d`. It thins the same way but only shrinks, so that far bushes do not become a tangle of bare twigs.
- **No card levels.** The cards' `_lod` files for bushes and saplings are gone. Trees keep their levels, because their crowns are far overhead.

### Shadows

The shadow faces near the player use the camera's share, stepped in 64ths so that the cached torch and lamp shadow tiles re-render only when the share really changes. The sun's cascades follow the view and are soft, so they use the share squared: fewer, larger leaves cast the same shade. The fixed faces (the far sun face, the shelter maps, the canopy map) take the floor share and skip the stems, so they stay cached.

### The first schedule: distance

The first version drew every leaf within 3 m. Beyond that the share fell as the square of the distance, down to a floor of 1 in 36. The square follows from the geometry: the on-screen area of a plant falls as `1/d²`, so keeping `1/d²` of the leaves keeps the number of leaves per screen pixel about constant.

Walking in towards a bush at 7, 5, 3.5 and 2.5 m, I saw no switch.

![The woods walking in toward a bush](/images/2026-10-27-leaves-at-every-distance/walk-in.jpg "Day woods walking in toward a bush at 7, 5, 3.5 and 2.5 m (top left to bottom right). The bush does not change character at any step.")

Against the old cards, the far bushes read slightly sparser, because the cards were denser than the real sprays (200 leaves for a card spray against 48 real).

## Thinning by size on screen

I walked up to bushes again, and I could still see leaves appear a few steps before I reached them. The reason was the schedule. Thinning started at a fixed 3 m, where a leaf is about 50 pixels long. At that size each leaf that was added or taken away was individually visible, and by 6 m the leaves that remained were already scaled to twice their size.

The correct variable is not a distance in metres but the leaf's size in pixels. I changed the schedule to full detail out to where a leaf is 12 pixels long. That is about 12.5 m at 1440p, and nearer at a lower resolution, where the leaves are smaller on screen too. Past that point, the share still falls as distance squared, so the leaves that remain stay about 12 pixels long.

One more change makes the thinning harder to see:

- **Inner leaves first.** `leaf_rank.py` now ranks a plant's leaves by how deep in the crown they sit (75% weight), with some randomness (25%). The hidden inner leaves are thinned first and the outer shell, which the eye follows, goes last. The ranks are spread evenly, so a draw's prefix is exactly the share kept.

I measured it with walk-in frames at 24, 18, 14, 11, 8 and 6 m against the same frames with every leaf drawn, using the mean absolute difference over 8-bit pixels:

| Thinning starts | Mean absolute difference |
|---|---|
| at 3 m | 0.49 to 1.50 |
| at 16 pixels | 0.12 to 0.15 |
| at 12 pixels | 0.06 to 0.10 |
| at 8 pixels | 0.03 to 0.07 |

![Walking in at 18, 11 and 8 m with three schedules](/images/2026-10-27-leaves-at-every-distance/thinning-by-pixels.jpg "Each row is one distance. Left: thinned from 3 m. Middle: thinned from 12 pixels. Right: every leaf.")

![A bush at mid distance with cards, every leaf and thinned leaves](/images/2026-10-27-leaves-at-every-distance/cards-full-thinned.jpg "Left: the old cards. Middle: every real leaf. Right: thinned. The thinned bush reads close to the full one.")

## Paying for it

Drawing every leaf out to 12.5 m costs more than the frame can take. With every leaf drawn everywhere, the frame took 25 ms. Three measures bring it back.

**The lit pass reuses the prepass's cut-out.** The depth prepass renders the scene's depth first, and the lit (shading) pass then draws with a depth test of EQUAL, so each pixel is shaded only by the surface that won it. For alpha-tested foliage, the prepass discards the transparent pixels of a leaf, and the lit pass was repeating the same alpha test and discarding too. A shader that can discard makes early depth rejection less effective, so hidden leaf pixels were still shaded. The lit pass for foliage now takes the prepass's cut-out: depth EQUAL and no discard, so hidden leaf pixels never run the shader. The image is unchanged, and three poses are identical to within rain noise (at most 3 pixels over 8 levels).

**A far twin of each leaf.** A leaf mesh is 9 vertices and 8 triangles, folded along the midrib. The far twin uses the same 9 vertices and draws 4 triangles from the edge vertices. The outline is identical. Only the fold along the midrib is flattened. It is used from where a leaf is 12 pixels long, where the fold is smaller than a pixel, and in every shadow, since a shadow needs only the outline. Exactly one of a near and far pair is drawn at any distance.

**Something I tried and dropped.** A lit-pass vertex shader without last frame's position (it is only needed for motion vectors) gave a bit-identical image and was no faster. The cost is the triangles, not the vertex work. A quarter of the pixels (720p) still kept about 75% of the extra cost, which also points at triangle count rather than pixel work.

Bench at 1440p, TAA off, night woods, frame time in ms with thinning from 3 m and from 12 pixels in the same build:

| Pose | From 3 m | From 12 px | Change | First schedule |
|---|---|---|---|---|
| path start | 9.77 | 11.40 | +1.63 | 10.63 |
| first bend | 7.27 | 8.34 | +1.07 | 7.76 |
| into the bank | 8.67 | 10.42 | +1.75 | 9.41 |
| clearing | 8.66 | 9.73 | +1.07 | 9.45 |
| up at the canopy | 5.81 | 6.75 | +0.94 | 6.95 |
| third bend | 7.98 | 9.65 | +1.67 | 8.44 |
| gate close | 6.22 | 7.06 | +0.84 | 7.07 |
| gate far | 7.32 | 8.61 | +1.29 | 7.98 |

Walking with a quick turn, the GPU mean is 11.47 ms (9.86 with thinning from 3 m in the same build; 10.54 for the first schedule). The shadow pass is 0.60 ms and the worst frame 22.0 ms, which is a lightning flash. A flash redraws every sun cascade and the far fixed face, about 4,500 to 5,000 casters each. With no leaves in the shadows at all, that second still costs 1.19 ms of shadows against 0.38 for the base, so most of that spike predates the leaf work. Thinning from 16 pixels would cost about 0.3 ms less, with twice the difference from every leaf.

![Into the bank with real leaves at every distance](/images/2026-10-27-leaves-at-every-distance/into-the-bank.jpg "Saplings and bushes in the night woods, with real leaves out to the distance where thinning starts.")

## Tests

`DrawBatchingTests` checks that the full-detail distance follows the view's pixels, that exactly one of a near and far pair is drawn at any distance, and that the share changes by no more than 0.01 per centimetre walked. `VertexOcclusionTests` checks the packing round trip and that the occlusion bake writes only its own bits. `ctest` passes 116 of 116, the day woods have no holes, and I merged the weather track (98 commits, W1 to W5h) into master after a Release build and `ctest` run on the merged tree. It is not pushed.

## Open issues

- The woods are over the frame budget. The night woods take 11.4 ms at the path start on my RTX 4070, and the target is about 8 ms on an RTX 3060-class GPU. More cuts: a 2-triangle twin past a larger distance, or fewer triangles in the near leaf.
- The lightning flash's shadow spike of 22 ms worst frame. I can spread the flash's cascade redraws over frames, or keep the flash on the cached faces.
- Rain and thunder sound remain.
