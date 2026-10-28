---
title: Finer foliage, steadier shadows
date: 2026-10-24
order: 1
summary: Finer crowns, poles and grass, then two performance fixes for walking and turning, found by measuring a scripted walk and caching shadows instead of redrawing them.
tags: foliage, shadows, performance
cover: /images/2026-10-24-foliage-and-steady-shadows/grass-at-the-path-edge.jpg
---

Today started as an art task and became a performance hunt. I asked the woods' foliage to look picture-perfect and be efficient, and measured against my reference there were three things missing: whole sprays still read as big cut-out fronds a few metres away, the reference's thin upright young trees were absent, and its path edges are lined with tall grass where mine had bare dirt. Then I noticed that after the changes, the frame rate dipped while walking. That turned out to be the more interesting story.

## Finer crowns, poles and grass

**Where the time goes.** Before adding anything, I removed each kind of plant in turn to see what it cost. The trees are the cost: about 2.3 ms looking up into the canopy and 1.1 ms at the gate, mostly the depth prepass laying down overlapping leaf cards. Bushes cost 0.15 to 0.8 ms; weeds and nettles almost nothing.

**Cheaper cut-outs.** A leaf card's pixel used to sample five textures (colour, normal, roughness, occlusion, emissive) before testing whether it was cut away, and most of a card is cut away. It now tests the colour map's alpha first and stops there. That made the prepass 0.1 to 0.15 ms faster where leaves fill the view.

**Finer crowns.** Every tree's, sapling's and pole's cards are now 0.7 times the size and about twice as many, and the leaves deeper in a spray are darker and drawn under the others. That depth shading is what makes a spray look like a cluster of leaves and not a flat sticker.

![Twig cards with depth shading](/images/2026-10-24-foliage-and-steady-shadows/twig-card-depth.jpg "The finer twig cards. Leaves deeper in the spray are darker and sit under the others.")

My first try reshaped every tree. The tree's skeleton (trunk and limbs) and the card placement shared one random number generator, so more cards meant different limbs. The gate view then came out 13 levels too bright: a big dark trunk had gone, and auto-exposure brightened the whole picture. The cards now draw from a generator of their own, and the bark is the previously committed trees' to the triangle.

![The gate view before, after and the brightening between them](/images/2026-10-24-foliage-and-steady-shadows/reshaped-trees-exposure-diff.jpg "Left and middle: before and after reshaping the trees. Right: a map of where the picture got brighter.")

**Poles.** Seven to eleven metre young trees, 4 to 6.5 cm thick, bare up to a small crown. 102 of them stand between the trees. They are mostly bark, so they cost little.

**Grass.** Tufts of 70 to 110 blades as real geometry on a small straw-to-olive texture, lit through by the sun and moving in the wind. The first version fanned out evenly like spiky stars and sat in the middle of the path, which looked absurd. The blades now flop one way per tuft, some bend right over, and about 400 tufts line the path's open edge. As a masked material the grass costs about 0.2 ms in view. As opaque it measured slower, so it stays masked.

![Grass at the edge of the path](/images/2026-10-24-foliage-and-steady-shadows/grass-at-the-path-edge.jpg "Tufts of grass at the path's edge, with sun patches on the mud.")

**Levels of detail for trees** came in too. The first version of them had a bug, which comes up below.

At the end of this part the average GPU time was 6.27 to 6.19 ms with 102 poles and about 400 grass tufts more. The slowest pose was 7.08 ms, about 14 ms on a 3060-class card, still inside the 16.6 ms budget.

## Why walking got slower

I noticed that after the changes the frame rate dipped more while walking, and that leaves and trees seemed to change places as they got close. Measuring beats guessing, so I scripted a walk down the path (2,600 frames, uncapped, 1440p) and logged the timings before touching anything.

| Walk down the path | GPU average | Shadow pass | Worst second's p95 (CPU) |
|---|---|---|---|
| Before part 2 | 9.24 ms | 2.71 ms | 13.9 ms |
| Part 2 as committed | 10.01 ms | 3.26 ms | 13.9 ms |
| Part 2, levels of detail off | 10.27 ms | 3.28 ms | 13.7 ms |
| After the fix | 7.59 ms | 0.08 ms | 11.2 ms |

There were no single long frames. The dips came from the sun's shadow, and the clue was that standing still never showed it.

> **Concept: Shadow caching.** A shadow map only changes when something in it moves. So the engine keeps each tile and reuses it frame after frame, redrawing only when a caster moves or the light's view changes. A standing player pays nothing for shadows.

The sun's four cascades follow the camera, and each cascade's origin moved by a texel almost every frame the player walked. So every cascade was redrawn every frame, with thousands of trees and plants inside. Standing still, those tiles are cached and cost nothing, which is why the bench never showed it. Part 2 made it worse with more and finer cards.

Three fixes:

- **Cascades move in steps.** Each tile is a sixteenth larger than the slice it covers, and its origin moves in steps of that sixteenth (0.5 m for the nearest). Until the camera has gone a full step, the tile is reused. Shadow time while walking fell from 3.3 ms to 0.08 ms. The cost is a sixteenth of each cascade's resolution.
- **Casters cast with their full mesh.** A tree used to cast its shadow with the level of detail the camera saw. Every time one switched level, every tile it was in was redrawn. Plants with a cull distance (about 2,500 nettles, weeds, ferns, rocks and shrubs) dropped in and out of the shadow as the player walked, so their tiles were redrawn too. Now the full mesh always casts, and shadow cull distances are measured from the camera's position rounded to a 4 m cell.
- **Levels of detail keep every leaf.** This is the "leaves appear in different places" bug. Part 2's far levels kept every second, then every fourth pair of leaf cards, made larger, so the crown's leaves were literally different at different distances. Now the levels only simplify the bark: twig bark dropped, fewer sides on trunks and limbs (one tree went from 11.1 k to 7.0 k to 6.1 k triangles). The leaves are the same at every distance. A render with levels against one with full meshes differs by 2.8 at the path start (run-to-run noise is 2.0), and 1.0 further down.

Walking now costs 2.4 ms less. Standing costs 0.1 to 0.7 ms more, because far trees now keep all their leaves. It is the right trade: standing in a forest has slack, and walking through one is where the hitch was.

![The path's start after the fix](/images/2026-10-24-foliage-and-steady-shadows/after_path_start.jpg "The path's start after the fix, with grass, poles and finer crowns.")

## Turning quickly

After walking was fixed, I noticed a smaller dip when turning quickly. When you turn, each cascade's slice swings round with the view, so all four cascades moved in the same frame and all four were redrawn at once. That single redraw cost 3 to 4 ms.

> **Concept: Amortising.** If a job is too big to do in one frame, do a bit of it each frame. Nobody sees which frame a shadow tile was redrawn in, but everybody feels one long frame. Spreading the work out trades a tiny delay in one corner of the image for an even frame time.

Now, on a frame where several cascades want to move, only the last one (the farthest, with nothing coarser behind it) and one other move. The others keep the face they were last drawn with, and its cached tile, until their turn: the one that has waited longest goes first, then the nearest. After a turn, all four are in place within three frames.

It costs no quality that I can see. The shader uses the first cascade whose tile holds a point, so where a held cascade no longer reaches, the next, coarser one shadows it for a frame or two. A sun that turns, or a new tile, still moves them all at once.

I measured with a new quick-turn test that stands at the path start and whips the view left and right 20 times (30 frames each, uncapped, 1440p). The timing log now also names each second's worst frame.

| Quick turns | Average | p95 | Worst frame (average of seconds) |
|---|---|---|---|
| Before | 7.39 ms | 10.01 ms | 12.27 ms |
| After | 7.14 ms | 9.31 ms | 10.25 ms |
| Standing still there | 8.18 ms | 8.54 ms | 9.60 ms |

A turning frame's worst is now within about 0.6 ms of a standing frame's worst. What is left comes from the view itself: looking into the denser banks costs more than looking down the path.

![Difference between two frames after a turn and the settled frame](/images/2026-10-24-foliage-and-steady-shadows/difference_from_settled.jpg "Top: the view two frames after a turn ends. Bottom: its difference from the settled frame 20 frames later. Only leaves moving in the wind differ; there is no blocky shadow change on the ground.")

## Open

The last cascade still redraws in the same frame it moves, and it holds the most casters, so a wider margin there would trim the rest. Distant trees could use cheaper leaves, such as a merged card cloud or an impostor that looks the same from where it switches; thinning the cards was not that. The reference's broad-leaved undergrowth (large single leaves on stalks) is still missing. And one puzzle remains: opaque two-sided foliage cost about 0.5 ms even out of view, and I do not yet know why.
