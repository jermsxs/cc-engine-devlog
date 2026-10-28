---
title: Texture streaming, scanned decals and reflections scaled to local light
date: 2026-10-19
order: 2
summary: Streaming only the texture mips the camera needs, decals cut from photo scans, a comparison against my reference, and a fix for a matte wall that mirrored a lamp.
tags: materials, performance, renderer
cover: /images/2026-10-19-streaming-and-scanned-decals/torn-plaster.jpg
---

The first half of Track M put photo scans on the house. That created a memory problem and an opportunity. A house dressed in 2K and 4K scans would soon run out of video memory. And if the base surfaces come from photographs, the stains and marks on top of them should come from photographs too. This post covers texture streaming, scanned decals, the end of the track compared with my reference, and a fix I made the next day for a wall that looked glossy under a lamp.

## Texture streaming

Until now every material texture was loaded with all its detail levels and kept for the whole session. That was acceptable for a corridor. Resident Evil 7 and Village stream textures, so that a texture keeps on the GPU only the detail the camera can see. I built the same thing.

### How mip selection works

> **Background: mip chains and level-of-detail selection.** A mip chain stores a texture at full size, then at half size, a quarter and so on, down to one pixel. The whole chain costs about 4/3 of the top level, and the top level is three quarters of that. When a pixel is shaded, the GPU measures how fast the texture coordinates change across neighbouring pixels, the screen-space derivatives, and computes `lod = log2(texels per pixel)`. A far wall covers few pixels, so many texels fall on each one, the level is high, and a small mip is used. This avoids shimmering and keeps memory access local. Trilinear filtering blends the two levels on either side of `lod`. Nothing finer than `floor(lod)` is ever read, so the finest levels of a texture that is never seen close up are wasted memory.

Streaming systems differ in how they learn which levels are needed. Sampler feedback, or a feedback render pass, records the levels the GPU actually sampled and reads them back a frame or more later. A cheaper approach estimates the level from geometry on the CPU. I use the estimate, which needs no GPU readback.

### How my implementation works

For every visible draw I compute how many texels of each of its textures fall on one screen pixel at the draw's nearest point. That is the world size of a pixel at that distance multiplied by the surface's texel density. Density comes from the material's tiling for walls and floors, or from the mesh's own UV density for props, per submesh. The finest level needed is `floor(log2(texelsPerPixel))`, clamped to the chain. The floor is deliberate, because trilinear filtering reads `floor(lod)` and the level after it, so `floor(lod)` has to be resident. A far wall asks for a 256-pixel level, and the wall that I press my face against asks for the full 2K.

The rest of the system has four parts.

- **Residency.** Every texture always keeps its small levels, 128 pixels and under, so that something sensible shows while finer levels load. Finer levels are read from the cooked `.cctex` file on a background thread, one seek per texture, and uploaded into a new GPU texture. The rest of the chain is copied over on the GPU.
- **Safe swapping.** The GPU is still drawing the previous frame while the next is recorded, so a texture cannot be replaced under it. Each material's descriptors move to a fresh block, and the old texture and block are freed only after the GPU has finished with them.
- **Budget.** The default is 1.5 GB, set by `--texture-budget=<MB>`. When it is full, textures that nothing has asked for in two seconds give back their fine levels first, oldest first. If that is not enough, every request becomes one level coarser until there is room.
- **No blurry first frame.** The frame that first loads a scene, the benchmark and headless screenshots all load what they need in that same frame. Only levels needed while moving around arrive in the background.

### Results

The test I cared about was whether the difference could be seen. Here the kitchen is shown with everything loaded whole, streamed, and squeezed into a 128 MB budget.

![The kitchen with textures loaded whole, streamed and under a 128 MB budget](/images/2026-10-19-streaming-and-scanned-decals/kitchen-whole-streamed-budget.jpg "Left: every texture loaded whole (252.8 MB). Middle: streamed (222.7 MB). Right: forced into a 128 MB budget (123.4 MB), where the textures are only slightly softer.")

Streaming is visually identical. No pixel differs by more than 12/255 at any camera pose, the mean difference is 0.00 to 0.01, and GPU time is unchanged at -2% to +0.4% per pose. After ten poses 32 of 100 textures are partial, texture memory is 223 MB instead of 253 MB and video memory is 557 MB instead of 587 MB. Under the 128 MB budget, textures stay at 123 MB with 70 partial, and the images are only slightly softer, with a mean difference of 0.07 to 1.5. A game run with a 96 MB budget and the camera panning at 60 degrees a second for 600 frames showed no errors, and the wallpaper in a close-up stayed sharp.

The saving is modest today because the house's textures are only 253 MB once compressed. It grows with every larger scan I add. The budget is a command-line switch and not a scene setting, because it belongs to the machine and not to the scene.

## Scanned decals

My decals used to be drawn by script: soft noise blobs for stains and damp, and dark bands for grime. From a distance they were fine. Up close they looked painted on. The houses in RE7 are dirty in specific ways, in the places where hands, water and feet go.

> **Background: projected decals.** A decal is an image projected onto existing surfaces from a box. For each pixel the shader transforms the pixel's world position into the decal's local space. If the position is inside the box, it samples the decal's image at the projected coordinates and blends it into the surface. This lets a stain or a handprint be placed on any wall without editing the wall's texture, and it wraps over relief. A decal needs a rule for surfaces it should not reach, usually a limit on the angle between the surface normal and the box's axis, so that it does not smear around a corner. A decal can change colour, normal and roughness, which is how a wet patch is darker, smoother and glossier than its surroundings.

My decals are applied in the object's own shading. Each object receives a list of the decals whose boxes overlap it, and each decal has a blend mode: replace the colour, multiply it, add only relief, or wet. Colour and coverage, normals, and roughness are stored in three atlases.

### From scans

Eleven CC0 scans from ambientCG, cut into decal sets, now provide leaks, rising damp, mould, peeling paint, torn plaster, handprints, smudges, scratches and dust. `ingest.py` keeps the opacity map that those sets provide. A script, `build_decals.py`, crops, masks, tints and makes a normal map for each, and keeps everything matte. The procedural decals that still work, such as cracks, scuffs and wet puddles, stay.

Two renderer changes went with this. The atlases went from 2048 to 4096 pixels, 8 by 8 cells, and a decal can take several cells, so a grime band is 4 by 1 cells, a leak 2 by 1, and mould 2 by 2. Long decals are no longer squeezed into a square, and the scans keep their detail. And the house now has 268 decals, more than the old cap of 256 per frame, so decals outside the view are skipped and, past 512, the nearest 512 are drawn. A room view draws a handful, 9 in the kitchen corner.

I did not place them by hand. `build_house.py --decals-only` reads the room rectangles, doors, switches and windows, and places 95 decals where dirt would gather:

- rising damp on the ground floor and grime upstairs, along the two longest clear stretches of wall in each room;
- smudges round every light switch, with a handprint beside a few;
- smudges beside each door's latch, on both faces;
- mould on both walls of the damp ceiling corners;
- leaks from the ceiling, and drips under each window sill;
- four patches of torn plaster;
- scratches on the floor in front of doors, on the hall side of the locked ones, since whatever is behind them never opened them;
- dust in two floor corners of each room.

I redid two. The peeling paint was nearly invisible at first and was redone so that it reads as pale plaster with a torn, darker edge. The first corner mould was a single decal facing the corner, which cut both walls off along straight lines, so it became one decal per wall.

![The nursery before and after the scanned decals](/images/2026-10-19-streaming-and-scanned-decals/nursery-before-after.jpg "The nursery, before (left) and after (right): mould in the ceiling corner and water running down from the window sill.")

![A torn patch of wallpaper with plaster beneath](/images/2026-10-19-streaming-and-scanned-decals/torn-plaster.jpg "A torn patch of wallpaper with plaster showing underneath. Up close it is photographic detail and not a noise blob.")

The decals cost 0.0 to 2.6% of GPU time per pose, at most 0.05 ms, and 50 MB of texture memory for the 4096 atlases (223 to 271 MB, video memory 557 to 605 MB). At most 1.6% of pixels changed, in the nursery. The light bakes still ignore decals, and doors and props receive none.

## The end of Track M, compared with the reference

M7 finished the job. The trim, which is the most-used surface in both scenes, and the original hallway were still procedural. Every scanned painted-wood set I looked at was a plank board, and its grooves would read as joints every few centimetres along a baseboard. ambientCG's PaintedWood009C has no seams: worn off-white paint over grain, with cracks. I tinted it back to the old trim's brightness, kept it matte at 0.96, and let wood show through the paint where the mesh's wear mask says hands and feet have rubbed it. The first set I downloaded, 008C, was brown stained wood, so I removed it without committing it. All 157 trim meshes in the house use the scan. The hallway's walls, ceilings and parquet moved to the same scans as the house, and they already landed on the old colours. The grey plaster's tint gives the hallway's green-grey, and the parquet's tint gives the old floor's brown almost exactly. The hallway also got storeys, so that the damp and stain layers know where its floor and ceiling are, and the ceiling stains went from 0.45 to 0.75, because the scanned ceiling had lost the old ones.

I compared the hallway against my reference with the rules I set for the project. I describe the reference in words, since I do not publish it.

- **Cleanliness.** The hallway is not too clean. The walls are mottled, stained plaster with damp at the foot and peeling near the top.
- **Brightness.** It is not too bright. Mean luma is 0.131 against the reference's 0.126.
- **Lamps.** They read, as pockets of light with dark between.
- **Floor.** It does not catch enough light. The reference's herringbone is lighter and picks up the lamps. Mine stays near black, with a bottom-third luma of 0.08 against 0.12. This comes from the matte, dark floor tuning I did in step M3. I left it open as my decision to make, and I have not changed it.

![Four house rooms before Track M and after M7](/images/2026-10-19-streaming-and-scanned-decals/rooms-before-track-m-and-after.jpg "The parlor, kitchen, nursery and master bedroom before Track M (left) and after M7 (right). The plaster has relief, and damp, mould and stains sit where water and dirt would be.")

Over the whole track, measured on the ten house poses at 1600 by 900, GPU time rose by 6 to 15% per pose (0.10 to 0.20 ms), texture memory from 143 to 286 MB, streamed under the 1.5 GB budget, and video memory from 476 to 620 MB. The hallway's change was 3.5% to 9% (at most 0.15 ms), and every hallway pose stays under 1.9 ms. That is well inside my target of 1440p at 60 frames per second on an RTX 3060.

## The next day: a matte wall that mirrored a lamp

On the 20th I noticed a problem in the dining room. With the flashlight off and only the dining lamp lit, the dining room's far wallpaper looked glossy. The damask looked embossed and metallic. The debug views narrowed it down. With reflection probes off, the wall went almost black, so the sheen was the probes' ambient specular and not the lamp's direct light.

The numbers were odd. A wall of 0.95 roughness reflects about 2% of what a reflection cube holds, which is normally far less than its diffuse light. Here the reflection was about three times more. The dining room's cube is captured once, from the middle of the room near the lamp, and every point in the room reads it. The far wall is about 6.8 m from the lamp and gets very little light, yet it was mirroring the brightly lit near end of the room. Its normal map then swept that reflection across the damask's bumps.

> **Background: specular occlusion and scaling a baked reflection by local irradiance.** A baked reflection cube records the radiance seen from its capture point. It cannot know how much light reaches any other point in the room. Specular occlusion is the family of techniques that reduce ambient specular where light cannot reach, usually with an occlusion term computed from geometry. Here the missing information is brightness and not shape. I take the diffuse indirect light the surface actually receives, from its lightmap or from the irradiance probes, and divide it by the irradiance of the cube along the same normal, which is the cube's roughest mip. Both measure the same thing, the light bouncing in from the room, one at the surface and one at the capture point. The ratio, clamped to 1, scales the reflection, so a surface dimmer than the capture point reflects less, and one as bright or brighter keeps its reflection as baked.

The change costs one more cube sample per probe. I had a second theory at first, that hot texels beside the bulb were the cause, since the walls next to a bulb were captured far brighter than the room. So the bake now caps a captured surface at luminance 2, as the lightmap's rays do. The rebake showed that the house's cubes peaked at about 10, not hundreds, and that the lamp globes were already capped at 4, so the cap on its own changed almost nothing. I kept it for consistency with the lightmap.

![The dining room wall before the fix](/images/2026-10-19-streaming-and-scanned-decals/dining-before.jpg "Before, lit only by the dining lamp: the far wall around the doorway glows with a metallic sheen, a reflection of the lit end of the room.")

![The dining room wall after the fix](/images/2026-10-19-streaming-and-scanned-decals/dining-after.jpg "After: the far wall is as dark as the light reaching it.")

On a patch of the far wall the reflection-cube term fell from 0.253 to 0.003, and the ambient light's variation across the pattern fell from 0.034 to 0.020. GPU time moved by less than 1.6% either way, and `ReflectionProbesTests` checks that the scaling dims and never brightens. The bench runs with the flashlight on, and the flashlight's direct light hid this problem, so the bench images barely move. A flashlight-off pose is on my list so that lamp-only looks are measured too, and I still need to check the study and nursery by eye, since they are lit by a single lamp at one end.

## Open items

- The herringbone floor is darker than my reference's, and I have not decided whether to change it.
- The bathroom and kitchen tiles, whose layouts are authored, and the wallpaper's damask print are still procedural.
- If the hallway is ever regenerated from its source scene, I must rerun `apply_scan_materials.py --scene hallway`.
- The next job was a bug and speed sweep over everything that had piled up.
