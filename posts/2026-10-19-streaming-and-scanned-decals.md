---
title: Streaming textures, scanned dirt and a matte wall fix
date: 2026-10-19
order: 2
summary: Loading only the texture detail the camera needs, decals cut from photo scans, how the whole materials track compared, and a fix for matte walls that mirrored a lamp.
tags: materials, performance, renderer
cover: /images/2026-10-19-streaming-and-scanned-decals/torn-plaster.jpg
---

The first half of Track M put real scans on the house. That created a problem and an opportunity. The problem is memory: scans are big, and a house dressed in 2K and 4K images would soon run out of room. The opportunity is dirt. If the base surfaces come from photographs, the stains and marks on top should too. This post covers streaming, scanned decals, the track so far compared with before, and a fix I made the next day.

## Streaming: only the detail the camera needs

Until now every material texture was loaded with all its detail levels and kept forever. That was fine for a corridor. Resident Evil 7 and Village stream instead: a texture keeps on the GPU only the detail the camera can actually see.

> **Concept: Mip levels.** A *mip chain* is a texture stored at its full size, then at half size, then a quarter, and so on down to one pixel. Each smaller version is called a *mip level*. The GPU picks the level whose pixels roughly match the screen's pixels, so a far wall uses a small, cheap level and avoids shimmering, while the wall you press your face against uses the full-size level. If the camera never gets close to something, its biggest levels are never used, and keeping them in memory is pure waste.

So the engine works out what each draw needs.

**Requests.** Every visible draw works out how many texels of each texture land on a single screen pixel at its nearest point, and from that the finest level it needs. Density comes from the material's tiling for walls and floors, or from the mesh's own UV density for props. A far wall asks for a 256-pixel level, and the wall you stand against asks for the full 2K.

**Loading.** Every texture always keeps its small levels (128 pixels and under), so something sensible shows at once. Finer levels are read from the cooked file on a background thread, one seek per texture, and uploaded into a new GPU texture. The rest of the chain is copied over on the GPU.

**Swapping safely.** The GPU is still drawing the previous frame while I record the next, so I cannot replace a texture underneath it. Each material's descriptors, the little table entries that point to textures, move to a fresh block, and the old texture and block are freed only after the GPU has finished with them.

**Budget.** The default is 1.5 GB. When it is full, textures nobody has looked at for two seconds give back their fine levels first. If that is not enough, every request drops one level until there is room.

And no blurry first frame: the frame that first loads a scene, the benchmark and headless screenshots all load what they need in that same frame. Only levels needed while moving around arrive in the background.

The test I cared most about was whether you could tell. Whole, streamed, and squeezed into a 128 MB budget:

![The kitchen with textures loaded whole, streamed, and under a 128 MB budget](/images/2026-10-19-streaming-and-scanned-decals/kitchen-whole-streamed-budget.jpg "Left: every texture loaded whole (253 MB). Middle: streamed (223 MB). Right: forced into a 128 MB budget, where textures are only slightly softer.")

Streaming looked identical. No pixel differed by more than 12 out of 255 at any camera pose, GPU time was unchanged, and texture memory fell from 253 to 223 MB. Honest note: the saving is modest today, because the house's textures are only 253 MB once compressed. It grows with every larger scan I add.

## Scanned decals: the dirt of a lived-in house

> **Concept: Decals.** A *decal* is a picture projected onto a surface from a box, like a sticker that wraps over bumps. It lets you add a stain, a handprint or a crack to a wall without painting the wall's own texture. You can have hundreds of them, each in a specific spot.

My decals used to be drawn by script: soft noise blobs for stains and damp, dark bands for grime. From far away they were fine. Up close they looked painted on. RE7's houses are dirty in specific ways, in the places hands, water and feet go. So eleven public-domain scans, cut into decal sets, now provide leaks, rising damp, mould, peeling paint, torn plaster, handprints, smudges, floor scratches and dust. The cutting happens in a script: crop, mask, tint, make a normal map, keep everything matte.

Two renderer changes came with that. The decal atlases, the big sheets that hold every decal image, went from 2048 to 4096 pixels, and a decal can now span several cells so a long grime band is not squeezed into a square. And with a house of 268 decals, more than the old cap of 256 a frame, the engine now skips decals outside the view and, past 512, draws the nearest.

### Placed from the plan

I did not hand-place them. A script reads the house plan, meaning the room rectangles, doors, switches and windows, and places 95 decals where dirt would gather:

- rising damp or grime along the longest clear stretches of wall in each room;
- smudges round every light switch, with a handprint beside a few;
- smudges by each door's latch, on both faces;
- mould on both walls of the damp ceiling corners;
- leaks from the ceiling, and drips under each window sill;
- four patches of torn plaster;
- scratches on the floor in front of doors, on the hall side of the locked ones, since whatever is behind them never opened them;
- dust in two floor corners of each room.

![The nursery before and after the scanned decals](/images/2026-10-19-streaming-and-scanned-decals/nursery-before-after.jpg "The nursery, before (left) and after (right): mould in the ceiling corner and water run down from the sill.")

![A patch of torn plaster showing the layer beneath the wallpaper](/images/2026-10-19-streaming-and-scanned-decals/torn-plaster.jpg "A torn patch of wallpaper, with plaster showing underneath. Up close, it is a photograph, not a noise blob.")

I redid a few: the peeling paint was nearly invisible at first, and the first corner mould was a single decal facing the corner that cut both walls off along straight lines, so it became one decal per wall. Cost: GPU frame 0.0 to 2.6% slower per pose, at most 0.05 ms, and texture memory up about 50 MB for the 4096 atlases. The light bakes still ignore decals, and doors and props get none.

## The track compared

At the end, I lined up four house rooms before Track M and after, and checked the hallway against my own reference rules: Too clean? Too bright? Do the lamps read? Does the floor catch light? Walls are mottled, stained plaster with damp at the foot. Brightness matches the reference's. Lamps read as pockets of light with dark between. The floor is the honest failure: the reference's herringbone is lighter and picks up the lamps, while mine stays near black. That comes from the matte, dark floor tuning I chose earlier, and I flagged it as an open question rather than quietly changing it.

![Four house rooms before Track M and now](/images/2026-10-19-streaming-and-scanned-decals/rooms-before-track-m-and-after.jpg "Parlor, kitchen, nursery and master bedroom, before Track M (left) and after (right). The plaster has real relief; the damp, mould and stains sit where water and dirt would be.")

The cost over the whole track, from before the first step to now: GPU time up 6 to 15% per pose (0.10 to 0.20 ms), texture memory 143 to 286 MB (streamed, under a 1.5 GB budget), and video memory 476 to 620 MB. That is well inside my target of 1440p at 60 fps on an RTX 3060.

## The next day: a matte wall that mirrored a lamp

On the 20th I found a problem that scans made easier to see. With the flashlight off and only the dining lamp lit, the dining room's far wallpaper looked glossy: the damask looked embossed and metallic. The debug views told the story. With reflection probes off, the wall went almost black. So the sheen came from the probes' ambient reflection, not the lamp's direct light.

The numbers were odd. A 0.95-rough wall reflects only about 2% of what a reflection cube holds, normally far less than its diffuse light. Here the reflection was about three times *more*. The reason is that the dining room's cube is a photograph taken once, from the middle of the room near the lamp, and every point in the room reads it. The far wall, 6.8 m from the lamp, gets very little light, yet it was mirroring the brightly lit near end of the room. The normal map then swept that reflection across the damask's bumps.

> **Theory: Scale a baked reflection by how lit the surface really is.** A reflection cube only knows what the room looked like from its centre. A point far from the lamp shouldn't reflect a lamp-lit scene at full strength. So for each surface I compare its own indirect light (from the lightmap or irradiance probes) with the cube's irradiance along the same normal, its roughest level. The ratio scales the reflection. It only ever darkens. A wall as lit as the capture keeps its reflection as baked.

It costs one more cube sample per probe. I also capped captured surface brightness at 2, matching the lightmap, after I guessed hot texels beside the bulb were the cause. The rebake showed the cubes peaked at about 10, not hundreds, so the cap alone changed almost nothing, but I kept it for consistency.

![The dining room wall before](/images/2026-10-19-streaming-and-scanned-decals/dining-before.jpg "Before: lit only by the dining lamp, the far wall (right, around the doorway) glows with a metallic sheen, a reflection of the lit end of the room.")

![The dining room wall after](/images/2026-10-19-streaming-and-scanned-decals/dining-after.jpg "After: the far wall is as dark as the light reaching it.")

On the wall's patch the reflection cube term fell from 0.253 to 0.003. GPU time moved by less than 1.6% either way. One lesson: the benchmark runs with the flashlight on, which hid this, because the flashlight's direct light drowned the wall's reflections. A flashlight-off pose is on the to-do list so lamp-only looks are measured too.

## Where it stood

Track M was complete: a better compression mode, richer library materials, scans on every surface, layers of grime, streaming and scanned decals. What was still procedural: the bathroom and kitchen tiles (their layouts are authored) and the wallpaper's damask print. The floor question stayed open, and the next job was a bug and speed sweep over everything that had piled up.
