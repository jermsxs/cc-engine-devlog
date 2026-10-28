---
title: A forest that fits the frame
date: 2026-10-21
order: 2
summary: I checked my woods against a reference, found them amateurish, and rebuilt a slice of path with real plants, instancing, levels of detail, cull distance and proper light.
tags: outdoors, foliage, performance
cover: /images/2026-10-21-a-forest-that-fits/path-start.jpg
---

By the end of the first outdoor steps, the engine could draw a sky, cascaded shadows and moving leaves. So I looked at the woods properly: I put frames from my own scene next to the reference frames I am aiming for, from matching camera positions, and measured both.

It was not flattering. Every outdoor picture I had made so far was a renderer test: box trunks, a few giant leaf cards per crown, one flat floor. The reference frames show foliage filling nearly the whole picture in three layers (foreground bushes, mid-distance trees, a dense back wall), a rough path of dirt and roots, and a canopy that blocks most of the sun, so light lands in small patches. Mine was a bright flat plane and grey sky. The numbers agreed: the mean brightness of my frame was 65 against the reference's 37, and my colours were far less saturated.

Almost none of that gap was a missing shader feature. It was content, light and grade. So from here on, every visual step gets judged next to the reference with numbers, and the plan changed: build one small, reference-quality slice of path first, then make it fast enough to scale.

## One slice of path

The slice is a 28 by 76 metre stretch of woods, built from a script so I can rebuild and tweak it in one command.

- **Ground.** A terrain mesh with a rough path, banks and hollows. Its vertex colours blend scans of dirt, mud and leaf litter (CC0 scans from Poly Haven).
- **Trees.** Three broadleaf trees, saplings and bushes authored in Blender by a script. Real leaves are a few centimetres wide, so the crowns use *twig cards*: a branched spray of many small leaves cut from a leaf atlas, placed on cards. My test cards had been 70 cm leaves, which read as a potted tropical plant.
- **Undergrowth.** Ferns, shrubs, nettles, weeds, stumps and mossy rocks, split into one model per plant.
- **Layering.** Trees leave the path open but close into a dense band around it, and bushes crowd the edges.
- **Grade.** A new colour lookup table pulls everything to the olive-brown of the reference.

![A twig card: a branched spray of small leaves](/images/2026-10-21-a-forest-that-fits/twig-card.jpg "Two of the twig cards. Each one is a spray of leaves, so a crown reads as many small leaves and not a few big ones.")

One shadow bug turned up here. The shadow filter takes a ring of samples around each pixel to soften edges. On a small sun dapple, that ring turned every little patch of light into a doughnut. Replacing the ring with a disc of samples fixed it, and the interiors only changed at shadow edges.

The slice came to about 2,570 draws and 7.7 million triangles, and ran in 6.2 ms on a 4070 at 1440p.

![The woods path at its start](/images/2026-10-21-a-forest-that-fits/path-start.jpg "The path at the start of the slice: undergrowth on both banks, coin-shaped sun dapples on the ground, a glow where the path ends.")

## Making copies cheap

Most of those 2,570 objects are copies of a few plants. Drawing each one with its own call wastes work, so there are three tools that all do the same job: spend the triangles where the player can see them.

> **Concept: Instancing.** If a hundred objects share the same mesh and materials, you do not need a hundred draw calls. You send the mesh once plus a small list of per-object data (position, tint) and say "draw it a hundred times". The GPU does the rest.

Per-object data used to sit in one constant buffer per draw. It moved into a structured buffer indexed by the instance number, and objects with the same mesh, materials and pipeline now draw as one instanced run. I group them in distance bands too, so the depth prepass still goes roughly front to back. My first version, without bands, made the prepass slower under the canopy (1.45 ms to 2.33 ms). The bands brought it to 1.57 ms.

> **Concept: Levels of detail (LOD).** A plant 30 metres away covers a few pixels, so it does not need 5,000 triangles. A LOD is a simpler copy of a mesh that takes over past a set distance. The art is picking distances where nobody can tell.

A Blender script makes the simpler copies and keeps the original's materials. Nettles and weeds keep 30% of their triangles from 7 m and 10% from 16 m. Rocks keep 20% from 4 m and 5% from 12 m. The shadow pass uses the same copy the camera sees, so a plant never shadows itself with a different shape. Switching LODs on a test frame changed 0.1% of the pixels, none you could pick out.

> **Concept: Cull distance.** Past a certain distance you can stop drawing a thing altogether, because other things hide it anyway. To avoid a visible pop, it dithers away over the last 15% of the range.

Weeds stop at 20 m, stones at 25 m, nettles and ferns at 30 m, small shrubs at 35 m.

Together this took GPU time from 5.74 to 4.92 ms at the reference pose, and the slowest pose from 5.95 to 5.27 ms. That is 11 to 16% less GPU time and 12 to 20% less CPU time. On a 3060-class card that is roughly 10 ms, inside my 16.6 ms budget for 60 fps.

## The woods' light

With the slice fast, I went back to the reference and fixed what the numbers said was wrong.

**The far end glowed.** The path's end was a bright opening, but the reference ends in dim trunks. I took the scene apart pose by pose: halving the fog, dropping the haze and turning the sun off did not remove it. It was sky seen under the far crowns, past the end of the slice. Three rows of bushes, three of saplings and four more trees now close the end. They are placed from their own random seed so the rest of the woods stays where it was.

![The far end of the path, before and after](/images/2026-10-21-a-forest-that-fits/far-end-before-after.jpg "Left: sky shining under the far crowns. Right: dim trunks with a little sun on them.")

**Round dapples.** Small holes in a canopy act like pinholes, and a pinhole projects a round image of the sun. So my path was covered in even coins of light, where the reference has large irregular patches with deep shade between them.

> **Theory: Pinhole dapples.** Sunlight under a leaf canopy is not blurry bits of light. Each gap acts like a pinhole camera and throws a small, round picture of the sun on the ground. Bigger gaps make bigger, irregular patches. To get irregular patches you need bigger gaps, not softer shadows.

I lowered and rotated the sun, made it stronger over a dimmer sky, thinned the plants on the sun's side of the path by 45%, and made the shadow tiles sharper (2048 texels, up from 1024) so patch edges look leaf-shaped, not blurred.

![The foreground, before and after](/images/2026-10-21-a-forest-that-fits/foreground-before-after.jpg "Left: before, with a few small round dapples. Right: now, with shade and larger sun patches. Round coins were still a problem, and I came back to them later.")

**The canopy went too dark.** After that change the canopy was too dark and the sun patches too hot. A brightness profile of ten rows from top to bottom showed the shape: the reference is nearly flat (30 to 42 all the way down), while mine climbed from 21 at the top to 75 just below the middle. Raising exposure only lifted the path. Four changes together fixed the shape:

- The vignette was inherited from the kitchen (0.8) and ate half the light at the top and sides. In the woods it is 0.45.
- The path used the dirt scan at full brightness. It is pale, dry earth and outshone everything. The reference's path is dark, damp earth under leaves, so the path layers are tinted darker.
- The sun was thirteen times the sky. It is now three times, so the canopy gets lit mostly by the sky and not just by pinholes.
- The sky's radiance is clamped at 2 (was 6), so gaps in the crowns are no longer white specks.

![The ground, before and after](/images/2026-10-21-a-forest-that-fits/ground-before-after.jpg "Top: the pale dry path and hot patches. Bottom: darker damp earth and softer patches.")

![Looking up at the canopy](/images/2026-10-21-a-forest-that-fits/up-at-the-canopy.jpg "Looking straight up: the canopy is olive against a bright sky, and no longer black.")

Mean brightness at the reference pose ended at 37.1 against the reference's 36.7. The red/green and blue/green balance matched within a few percent.

## What was still wrong

- The middle of the frame (the open path and lit banks) is still brighter than the reference. Its canopy closes over the path, and mine is open above it.
- Pixels above 150 are 1.4% of the frame against 0.3%.
- No tall grass, and no puddles yet.
- Trees have no levels of detail. Leaf cards fall apart under plain decimation, so they need fewer, larger cards from the tree script.

Next: make the ground walkable, so I can judge the slice by walking through it instead of from frozen cameras.
