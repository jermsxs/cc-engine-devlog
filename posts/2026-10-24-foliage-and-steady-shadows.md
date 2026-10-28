---
title: Tree levels of detail, grass, and shadow caching while walking and turning
date: 2026-10-24
order: 1
summary: Finer crowns, poles and grass, then two frame-time fixes found by measuring a scripted walk. Cascades now move in steps, and redraws after a turn are spread over frames.
tags: foliage, shadows, performance
cover: /images/2026-10-24-foliage-and-steady-shadows/grass-at-the-path-edge.jpg
---

Measured against the second reference, three things still separated my woods from it. Whole sprays read as big cut-out fronds from a few metres away. The reference's thin, upright young trees were missing. And its path edges are lined with tall grass where mine had bare dirt. I also wanted the foliage to stay cheap, so I started by measuring where the frame time went. After the changes below, I noticed that the frame rate dipped while walking and that leaves seemed to change places as they came closer, and I measured that before touching anything.

## Where the time went

Removing each kind of plant in turn showed that the trees are the cost. They take about 2.3 ms when looking up into the canopy and 1.1 ms at the gate, mostly in the depth prepass, where overlapping leaf cards are laid down one over another. Bushes cost 0.15 to 0.8 ms, and weeds and nettles almost nothing.

### Testing alpha before anything else

A leaf card's pixel used to sample five textures (colour, normal, roughness, occlusion, emissive) and only then test whether the pixel was cut away. Most of a card is cut away. An alpha-tested pixel shader should read the colour map's alpha first and discard immediately, so that a pixel that fails never reaches the other four reads. Masked pixels now do that. The prepass is 0.1 to 0.15 ms faster where leaves fill the view.

## Finer crowns, poles and grass

### Smaller cards, more of them

Every tree's, sapling's and pole's cards are now 0.7 times the size and about twice as many, so a spray reads as a cluster of leaves and not as a frond. Inside a card, leaves deeper in a spray are darker and drawn under the others, which gives the spray depth.

![Twig cards with depth shading](/images/2026-10-24-foliage-and-steady-shadows/twig-card-depth.jpg "The finer twig cards. Leaves deeper in the spray are darker and sit under the others.")

My first attempt reshaped every tree. The skeleton of a tree and the placement of its cards shared one random generator, so asking for more cards produced different limbs. The gate pose came out 13 levels too bright: a large dark trunk had gone, and auto-exposure then brightened the whole view. The difference map below shows it. The cards now draw from a generator of their own, and the bark is identical to the committed trees' to the triangle.

![The gate view before and after reshaping, and the brightening between them](/images/2026-10-24-foliage-and-steady-shadows/reshaped-trees-exposure-diff.jpg "Left and middle: the gate view before and after reshaping the trees. Right: a map of where the image got brighter.")

Smaller cards overlap less and let more sun through. I matched the card count at the second reference's pose, with 5% more than equal leaf area. The bushes kept their full-size cards.

### Poles and grass

`pole_a` to `pole_c` are young trees 7 to 11 m tall and 4 to 6.5 cm thick, bare up to a small crown. 102 of them stand between the trees, and since they are mostly bark they cost little.

`grass_a` to `grass_c` are tufts of 70 to 110 blades, built as real geometry on a small straw-to-olive texture. They move in the wind and the sun lights them from behind. The first version fanned out evenly, like spiky stars, and sat in the middle of the path. The blades now flop one way per tuft, some bend right over, and about 400 tufts line the path's open edge. As a masked material the grass costs about 0.2 ms when in view. Drawn as an opaque material it measured slower, so it stays masked.

![Grass at the edge of the path](/images/2026-10-24-foliage-and-steady-shadows/grass-at-the-path-edge.jpg "Tufts of grass at the path's edge, with sun patches on the mud.")

### Levels of detail for trees

Trees now switch levels at 20 and 45 m, and saplings and poles at 14 and 32 m. The far levels kept every second, then every fourth, pair of cards at a larger size, so that the crown keeps its leaf area, and dropped the twigs' bark. `tree_a` went from 11.1 thousand triangles to 4.6 thousand and 2.6 thousand. This choice caused a problem that I describe below.

At the reference pose the mean was 37.3 before and 34.7 after, against the reference's 36.7. The gate close pose is 6 levels brighter than its reference, at 64.0 against 58.2, because its right-hand bush and the yard catch more sun through the finer crowns.

| Pose (RTX 4070, 1440p, TAA off) | GPU before | GPU after |
|---|---|---|
| reference | 6.65 ms | 6.83 ms |
| path start | 6.61 ms | 7.08 ms |
| toward the end | 6.16 ms | 6.41 ms |
| into the bank | 5.22 ms | 5.16 ms |
| up at the canopy | 6.67 ms | 6.41 ms |
| gate close | 6.02 ms | 5.26 ms |
| gate far | 6.57 ms | 6.19 ms |

The average went from 6.27 to 6.19 ms with 102 poles and about 400 grass tufts added. The slowest pose, 7.08 ms, is about 14 ms on a 3060-class card. With the wind on, 0.9% of the canopy's pixels change by more than 24/255 per frame at the reference pose and 0.7% at the gate.

## Why walking got slower

I measured a scripted walk down the path, 2,600 frames at 1440p with the frame rate uncapped, before changing anything.

| Walk down the path | GPU average | Shadow | Worst second's p95 (CPU) |
|---|---|---|---|
| Foliage part 1 | 9.24 ms | 2.71 ms | 13.9 ms |
| Part 2 as first committed | 10.01 ms | 3.26 ms | 13.9 ms |
| Part 2 with levels of detail off | 10.27 ms | 3.28 ms | 13.7 ms |
| After the fix | 7.59 ms | 0.08 ms | 11.2 ms |

There were no single long frames. A new `--perf-log-seconds` option warns about hitches and counts them at exit, and it found none before or after. The dips came from the sun's shadow.

### How a shadow cache works

A shadow map depends on three things: the light, the casters' geometry, and the volume the map is fitted to. If none of them changes, the next frame's map would be identical, so the tile can be kept and the draw skipped. That is a shadow cache. Redrawing a tile submits every caster inside its volume again, which here means thousands of trees and plants.

Anything that changes one of the three inputs invalidates the tile. A cascade is fitted to a slice of the camera's view, so in principle every camera movement does. Snapping the origin to whole texels, which I added to stop edges crawling, still moves the tile each time the camera has moved one texel. For the nearest cascades, a texel is millimetres to centimetres, so the tile changed on almost every frame of a walk. Standing still, the tiles are cached and cost nothing, which is why the benchmark never showed the problem. Part 2 made it worse, with more and finer cards and the poles, by about 0.8 ms.

### Moving cascades in steps

Each cascade's tile is now a sixteenth larger than the slice it covers, and its origin moves in steps of that sixteenth, 0.5 m for the nearest cascade. Until the camera has moved a step, the tile is reused. The cost is a sixteenth of each cascade's resolution. Shadow time while walking fell from 3.3 ms to 0.08 ms.

![The origin of a cascade tile against the camera's position](/images/2026-10-24-foliage-and-steady-shadows/tile-steps.svg "A tile fitted to the camera's position every frame would be redrawn every frame. A tile whose origin moves in whole steps is redrawn only when a step is reached.")

### Casters that change the cache

Two more things invalidated tiles.

- **A tree cast its shadow with the level of detail the camera saw.** Each time one switched level, every tile it was in was redrawn. Now the full mesh always casts.
- **About 2,500 plants with a cull distance** (nettles, weeds, ferns, rocks and shrubs) dropped in and out of the shadow as the player walked. Cull distances for shadows are now measured from the camera's position rounded to a 4 m cell, so the set of casters changes only when the player crosses a cell.

The general rule is that the set of casters in a cached tile must depend only on coarse state. Anything that changes with every metre of camera motion defeats the cache.

### The leaves that changed places

The second problem was the one I could see. The far levels of detail kept every second, then every fourth, pair of twig cards, made larger. Moving toward a tree swapped one arrangement of leaves for a different one, and leaves seemed to appear in new places. A level of detail that changes the silhouette or the density of an object is visible as a pop, because the eye can resolve the change.

The levels now simplify only the bark. Twig bark is dropped and trunks and limbs get fewer sides, so `tree_a` goes from 11.1 thousand triangles to 7.0 thousand and then 6.1 thousand. The leaves are the same at every distance. A render with the levels, against one with full meshes, differs by 2.8 at the path start, where run-to-run noise is 2.0, and by 1.0 further down, below the noise.

![The path's start after the fix](/images/2026-10-24-foliage-and-steady-shadows/after_path_start.jpg "The start of the path after the fix, with grass, poles and the finer crowns.")

Standing still, the poses now cost 0.1 to 0.7 ms more, because the far trees keep all their leaves: the reference pose went from 6.83 to 6.96 ms, the path start from 7.08 to 7.25 and up at the canopy from 6.41 to 6.94. Walking costs 2.4 ms less. Every pose is well under the 3060 budget, about 14 ms there against 16.6. The reference pose's brightness is unchanged, at a luma of 36.0 against 35.8.

The hallway, house and kitchen benches are pixel-identical to part 2, because those scenes have no cascades, cull distances or levels of detail. The full suite passes at 114 of 114, with a new `CascadeStaysPutForSmallMoves` test.

## Turning quickly

After that fix, the four cascades stay put while I walk. Turning is different. A turn swings every cascade's slice of the view around, so all four wanted to move in the same frame, and the redraw of thousands of casters cost 3 to 4 ms in a single frame. I could feel it as a small dip.

### Spreading a cost over frames

A periodic cost that arrives all at once appears as a spike, even if its average is small. The remedy is to give the work a budget per frame and to let the rest wait. Waiting is only acceptable if the stale result is still usable.

On a frame where several cascades want to move, only the last one, the farthest, which has nothing coarser behind it, moves together with one other. The others keep the face they were last drawn with, and its cached tile, until their turn. The one that has waited longest goes first, then the nearest. After a turn, all four are in place within three frames.

This costs no quality. The shader uses the first cascade whose tile holds a point, so where a held cascade no longer reaches, the next, coarser cascade shadows that point for a frame or two. A sun that turns, or a new tile, still moves all of them at once.

I added a quick-turn test that stands at the path start and whips the view left and right 20 times, 30 frames each, uncapped at 1440p. The timing log now names each second's worst frame and the shadow tiles it redrew.

| Quick turns | Average | p95 | Worst frame, averaged over the seconds | Worst frame overall |
|---|---|---|---|---|
| Before | 7.39 ms | 10.01 ms | 12.27 ms | 13.20 ms |
| After | 7.14 ms | 9.31 ms | 10.25 ms | 11.02 ms |
| Standing still there | 8.18 ms | 8.54 ms | 9.60 ms | not measured |

A turning frame's worst case is now within about 0.6 ms of a standing frame's worst. The remainder comes from the view itself, since looking into the denser banks costs more than looking down the path. A new `CascadeMovesSpreadOverFrames` test checks that a turn moves the nearest and last cascades first, that all are placed within three frames, that a waiting cascade keeps its face exactly, and that a new tile moves at once. The woods bench images are pixel-identical to before and walking the path is unchanged at 7.56 ms against 7.59 ms.

![Two frames after a turn and the difference from the settled frame](/images/2026-10-24-foliage-and-steady-shadows/difference_from_settled.jpg "Top: the view two frames after a turn ends. Bottom: its difference from the settled frame 20 frames later. Only leaves moving in the wind differ, and there is no blocky shadow change on the ground.")

## Open issues

- The last cascade still redraws in the same frame it moves, and it holds the most casters. A wider margin, so that it moves less often, would trim the rest.
- A caster crossing a cull-distance cell still redraws the cascades it touches in one frame.
- Opaque two-sided foliage, the grass drawn as an opaque material, cost about 0.5 ms even out of view. I do not know why yet.
- The reference's broad-leaved undergrowth, with large single leaves on stalks, and the haze that softens its distance are not done.
- Bushes have no levels of detail. Their cards are full size, which would make far ones read as fronds if they were shrunk.
- Trees far off could use cheaper leaves, a merged card cloud or an impostor, that look the same from where they switch. Thinning the cards was not that.
