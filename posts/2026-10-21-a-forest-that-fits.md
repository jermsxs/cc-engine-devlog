---
title: A path slice of the woods, with instancing and levels of detail
date: 2026-10-21
order: 2
summary: I measured the woods against a reference, rebuilt a slice of path with real plants, then added instancing, levels of detail, cull distance and lighting changes.
tags: outdoors, foliage, performance
cover: /images/2026-10-21-a-forest-that-fits/path-start.jpg
---

After the sky, the cascaded shadows and the foliage shading, the engine could draw a forest in principle. Before building on it, I put frames of my scene next to the reference frames I am aiming for, from matching camera positions, and measured both. I had never done that for the outdoor work, and I did not like the result.

Every outdoor image I had produced was a renderer test: box trunks, seven giant leaf cards per crown, a flat floor. The two references show foliage filling nearly the whole frame in three layers (foreground bushes, mid-distance trees, a dense back wall), a rough path of dirt, roots and puddles, and a canopy that blocks most of the sun. I measured the first reference pose and the second, a view toward a gate and house:

| Measure | Reference, path | My scene | Reference, gate | My scene |
|---|---|---|---|---|
| Mean luma (0 to 255) | 37 | 65 | 66 | 66 |
| Saturation | 110 | 63 | 89 | 57 |
| Top / middle / bottom thirds | 37 / 37 / 36 | 49 / 72 / 74 | 85 / 62 / 52 | 51 / 68 / 79 |

Almost none of that gap was a missing shader feature. It was content, light and grade. My cards were 70 cm leaves, which read as a potted tropical plant. The floor was fully sunlit and the brightest part of the frame, where in the reference the bottom of the frame is as dark as the top. The grade was neutral grey where the reference is a saturated olive-brown.

From then on I judged every visual step side by side with the reference, from matching poses, with these numbers. I also decided to change the order of work: build one small slice of path to reference quality first, then make it fast enough to scale.

## One slice of path

The slice is a 28 by 76 metre stretch of woods built by a script, `build_path_slice.py`, so that any change is one command and a rebuild.

- **Ground.** A terrain mesh with a rough path, banks and hollows. Its vertex colours blend CC0 scans of dirt, mud and leaf litter through a vertex-colour layer mask.
- **Trees.** Three broadleaf trees, saplings and three bushes, authored in Blender by `build_trees.py`.
- **Undergrowth.** Ferns, shrubs, nettles, weeds, stumps and mossy rocks from Poly Haven, split into one model per plant.
- **Layering.** The trees leave the path open but close into a dense border band, and bushes crowd the edges, so no gap in the middle layer shows bare sky.
- **Grade.** A new colour lookup table, `re7_woods`, pulls the image to olive-brown.

> **Background: leaf cards.** A real tree has tens of thousands of leaves, far more than a scene can afford as geometry. The standard real-time answer is the leaf card: a flat quad carrying a texture of many leaves, with the empty texels cut away by an alpha test. What the reader sees depends on how many leaves one card holds. A card with one large leaf reads as a paper cut-out. A card holding a branched spray of small leaves reads as foliage. Cards also have a cost: where they overlap, the GPU shades several layers of the same pixel, and that overdraw is where foliage spends most of its time.

My leaf cards are now branched twig sprays cut from a CC0 leaf atlas, so a crown reads as many small leaves.

![Two twig cards, each a branched spray of small leaves](/images/2026-10-21-a-forest-that-fits/twig-card.jpg "Two twig cards. Each is a spray of small leaves, so a crown reads as many leaves and not a few large ones.")

### A shadow filter that drew doughnuts

Building the slice exposed a bug in the shadow filter. A soft shadow edge comes from percentage-closer filtering: the shader takes several shadow-map samples around the lookup point, each one a lit-or-shadowed comparison, and averages them. The spread of the samples sets the penumbra width.

My sample pattern was a Poisson set in which every tap lay between half and full radius. Averaged, it behaved like a ring. A small spot of sun that came through a gap in the canopy, smaller than the filter radius, was sampled only by taps that fell outside the spot, so the centre read as shadow while the surrounding ring read as lit. Every small dapple became a doughnut.

The replacement is a golden-angle (Vogel) disc. Tap `i` sits at angle `i * 2.39996` radians, and radius `sqrt((i + 0.5) / 12)`, so the 12 taps are spread evenly by area over a filled disc. The kernel is also rotated each frame and averaged by TAA. Interiors changed only at penumbra edges, and by at most 0.2% of their pixels.

![The woods path at its start](/images/2026-10-21-a-forest-that-fits/path-start.jpg "The start of the slice: undergrowth on both banks, round sun dapples on the ground, and a glow where the path ends.")

The slice came to about 2,570 draws and 7.7 million triangles, and ran in 6.2 ms on the RTX 4070 at 1440p. By doubling that, I estimate about 12.4 ms on a 3060-class card, inside my 16.6 ms budget before any optimisation.

## Instancing, levels of detail and cull distance

Most of those 2,570 objects are copies of a few plants. Three techniques spend triangles only where the player can see them.

### Instancing

> **Background: GPU instancing.** Each draw call costs the CPU driver and command-processing time, however few triangles it carries. If a hundred objects share the same mesh, material and pipeline state, they can be sent as one call: the mesh once, and a count of instances. The vertex shader receives an instance index and uses it to read that object's own data (its transform, its tint) from a buffer. The GPU does the repetition.

The engine used to bind one constant buffer of per-object data for every draw. That data moved into a structured buffer, `gObjects`, indexed by the instance id. Objects with the same mesh, materials and pipeline now draw as one instanced run.

I group runs by distance bands as well. The depth prepass works best when it draws near objects first: a near surface writes depth, and the hardware then rejects the hidden pixels of farther surfaces before they are shaded. An early version of instancing with no bands drew in an arbitrary order and made the prepass slower under the canopy, from 1.45 ms to 2.33 ms. With bands it came back to 1.57 ms.

### Levels of detail

> **Background: levels of detail (LOD).** A plant 30 metres away covers a few pixels. Drawing it with thousands of triangles wastes vertex work and, worse, GPU efficiency: the GPU shades pixels in 2 by 2 quads, so triangles smaller than a pixel leave most of each quad's lanes idle. A level of detail is a simpler copy of a mesh that takes over past a set distance. The selection rule is usually distance or projected screen size, and the work is choosing thresholds at which nobody can tell.

`build_lods.py` makes the simpler copies in Blender and keeps the original's materials and textures. The source's sidecar file lists each copy with the distance at which it takes over. Nettles and weeds keep 30% of their triangles from 7 m and 10% from 16 m. Rocks keep 20% from 4 m and 5% from 12 m, scaled by their size. At that stage the shadow pass used the same copy the camera saw, so a plant never shadowed itself with a different shape. I changed that rule later. Switching levels on a test frame changed 0.1% of the pixels, and none that could be picked out in a crop.

![The middle of the reference pose with full meshes and with levels of detail](/images/2026-10-21-a-forest-that-fits/full-meshes-vs-lods.jpg "The reference pose with full meshes on the left and levels of detail on the right. The two cannot be told apart at this size.")

Trees have no levels of detail yet. Their leaf cards fall apart under plain decimation, so they need fewer, larger cards from the tree script.

### Cull distance

> **Background: cull distance.** Beyond some distance a small object contributes almost nothing and is hidden by nearer foliage anyway, so it can stop drawing altogether. Switching it off abruptly makes it pop. A fade avoids that.

A mesh can now set a distance past which it stops drawing, and it dithers away over the last 15% of the range: each pixel is kept only if the fade value exceeds a per-pixel noise threshold. Weeds stop at 20 m, stones at 25 m, nettles and ferns at 30 m, and small shrubs at 35 m.

### Measured effect

| Pose (1440p, RTX 4070, TAA off) | GPU before | GPU after |
|---|---|---|
| reference | 5.74 ms | 4.92 ms |
| path start | 6.06 ms | 5.15 ms |
| toward the end | 5.27 ms | 4.41 ms |
| into the bank | 4.52 ms | 4.00 ms |
| up at the canopy | 5.95 ms | 5.27 ms |

That is 11 to 16% less GPU time and 12 to 20% less CPU time, which puts the slowest pose near 10 ms on a 3060-class card. The hallway, house and kitchen benches at 1080p were image-identical, with no pixel changing by more than 12/255 and GPU time 0 to 9% lower. A new `DrawBatchingTests` suite covers batch signatures, distance bands, instanced runs and the LOD pick. The full test suite passed at 111 of 111.

## The woods' light

With the slice fast, I returned to the reference and fixed what the numbers said was wrong.

### The far end glowed

The end of the path was a bright opening, and the reference ends in dim trunks. I took the scene apart pose by pose. Halving the fog, dropping the haze and moving the cascades did not remove the glow, and turning the sun off did not either. It was sky, seen under the far crowns, past the end of the slice at z = 72. Three rows of bushes, three rows of saplings and four more trees now close the far end between z = 63 and 71. They are tagged `backdrop` and placed from their own random seed, so the rest of the woods stays where it was.

![The far end of the path, before and after](/images/2026-10-21-a-forest-that-fits/far-end-before-after.jpg "Left: sky showing under the far crowns. Right: dim trunks with a little sun on them.")

### Round dapples

> **Background: pinhole dapples.** A small gap in a leaf canopy acts as an aperture, like the hole in a pinhole camera, and it projects an image of the sun onto the ground. The sun's disc spans about 0.53 degrees, which is 0.0093 radians. At 10 m below a gap, that is a disc about 9 cm across, plus the gap's own width. A small gap therefore throws a round coin regardless of its shape. A large gap throws the shape of the gap itself. The broad, irregular patches in the reference come from large gaps and not from softer shadow edges.

My path was covered in evenly sized coins, so the canopy had too many small holes. Three changes address that:

- The sun is lower and to the right, slightly behind the camera (azimuth 115 degrees, elevation 35 degrees). It is stronger, at 6 over a sky of 0.45.
- The saplings and bushes in a band on the sun's side of the path, between z = 19 and 45 and up to 12 m from it, are thinned by 45%. The thinning draws its own random numbers and still consumes the main seed's, so every other plant keeps its place.
- The cascade tiles are 2048 texels (they were 1024) with a softness of 1.5 and a penumbra cap of 6 texels, so that a patch has leaf-shaped edges and not blurred ones.

The scene script reads its tuning values from environment variables (`WOODS_SUN_AZ`, `WOODS_GAP_W`, `WOODS_EV` and others), so trying a variant is one command and the defaults are the committed look.

![The foreground, before and after](/images/2026-10-21-a-forest-that-fits/foreground-before-after.jpg "Left: before, with small round dapples. Right: shade with larger, irregular sun patches. Round coins remained a problem, and I returned to them on 24 October.")

### The canopy went too dark

After that change the canopy was too dark and the sun patches were too hot. I measured a brightness profile in ten rows from the top of the frame to the bottom. The reference is nearly flat: 36, 35, 39, 40, 37, 32, 42, 36, 39 and 30. Mine climbed from 21 at the top to about 75 just below the middle. Raising the exposure only lifted the path, so four changes altered the shape instead:

- **Vignette.** The woods had inherited the kitchen's value of 0.8, which removed about half the light from the top row and the left column. The reference is barely darker at its edges. It is now 0.45.
- **Ground.** The path used the dirt scan at full brightness. It is pale, dry, cracked earth, and in sunlight it outshone everything. The reference path is dark, damp earth under leaves, so the path's ground layers are tinted darker, in the woods only.
- **Sun against sky.** The sun was thirteen times the sky, 6 over 0.45. The patches burned out and the canopy, lit mostly by the sky, went black. It is now three times the sky, 3 over 1.0.
- **Sky clamp.** The sky's radiance is clamped at 2 and not 6, so gaps in the crowns no longer show as white specks.

The colour of the bright pixels already matched the reference, with red to green at 1.12 to 1.27 and blue to green at 0.6 to 0.7 in both. The problem was how many bright pixels there were, not their hue.

![The ground, before and after](/images/2026-10-21-a-forest-that-fits/ground-before-after.jpg "Top: the pale dry path and hot patches. Bottom: darker damp earth and softer patches.")

At the reference pose, with TAA on at 1440p:

| Measure | Reference | Before | After |
|---|---|---|---|
| Mean luma | 36.7 | 34.3 | 37.1 |
| Saturation | 110 | 131 | 119 |
| Top / middle / bottom thirds | 37 / 37 / 36 | 21 / 38 / 44 | 33 / 43 / 35 |
| Pixels over 150 | 0.3% | 2.0% | 1.4% |

I also tried and dropped three things: a higher tone-map white point (8 and 16), which changed nothing because the ACES curve is already flat past about 7; softer penumbrae; and a brighter sky without the clamp, which flooded the whole path to a mean of 53.

## Open issues

- The middle of the frame, the open path and the lit banks, is still brighter than the reference: 42 to 48 against 32 to 42. The reference's canopy closes over its path and mine is open above it.
- Pixels over 150 are 1.4% of the frame against 0.3%, mostly sky and sunlit leaves seen through the crowns.
- There is no tall grass and there are no puddles yet.
- The asset browser lists the `_lodN` files as ordinary meshes. They should be hidden, as split packs are.

The next step was making the ground walkable, so that I could judge the slice by walking through it and not from frozen cameras.
