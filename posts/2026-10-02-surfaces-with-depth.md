---
title: Surfaces that have depth
date: 2026-10-02
order: 2
summary: Parallax occlusion mapping, triplanar projection, baked occlusion, BC7 textures, wear and grime, and relief-only and wet decals make flat pictures read as real materials.
tags: materials, renderer
cover: /images/2026-10-02-surfaces-with-depth/wear-counter.jpg
---

With the house furnished, I started a long realism plan, beginning with surfaces, because in a first-person horror game they are what you look at most closely. Up close, my floors and walls were still flat pictures. The normal maps bent the light correctly, but a groove never hid anything: from a low angle the tile grout and the seams between boards looked painted on. The furniture looked new, every edge crisp and every joint clean.

I fixed this in five steps in one day. Each one changes how a surface responds when you get close.

## Parallax: depth without geometry

> **Concept: Parallax occlusion mapping.** Hold a finger up and move your head: near things shift more than far things. A flat texture has no such shift, which is why it looks painted on. Parallax mapping fakes it. For each pixel, the shader follows the line of sight down into a *height map* (a grey image saying how deep each point is), steps along it until it would hit the real surface, and reads the colour texture *there* instead of at the spot on the flat polygon. Grout sits behind the tile edges, and the edges hide part of it, with no extra triangles.

The engine already had height maps in its material library that nothing used. I gave every material a sixth texture slot for its height map and a value, `heightScale`, saying how deep the darkest part sits (zero keeps it off, so nothing else changes). The march takes 6 steps looking straight at a surface and up to 16 at a grazing angle, then interpolates between the last two steps. It fades out by 6 m, where 3 mm of relief is under a pixel at 1440p, and at very grazing angles.

I wrote new height maps for the parquet (boards at full height, seams sunk, bevels, a slight cup per board), the plaster and the two tiles. Parquet is 4 mm deep and the rest 3 mm.

The first version cost up to 1.1 ms per frame at 1440p, 10 to 30 percent of the frame, far too much for millimetre detail. Three changes brought it to 0.05 to 0.21 ms: the depth prepass no longer runs parallax, the fade distance went from 11 m to 6 m, and the step counts dropped from 8 to 28 to 6 to 16. The plaster's first height map also had half-metre swells that would have made whole patches of wall slide as you walked, so the script now removes everything broader than a twelfth of the texture and keeps trowel marks, pits and bubbles.

![Wall tile at a low angle, parallax off on the left and on the right](/images/2026-10-02-surfaces-with-depth/tile-zoom.jpg "Left: grout painted flat. Right: the grout sinks behind the tile edges and the tiles' lit rims show.")

## Triplanar: no more seams where a surface turns

Most of the house has no texture coordinates of its own. Walls, floors and stairs are boxes, and the baseboards and rails are authored mouldings. The shader projects textures from the world, using for each pixel the one axis the surface faces most: floors from above, walls from the side.

That is exact on a flat, axis-aligned face. It fails where a surface curves. Along a baseboard's rounded bead, the facing direction swings through 90 degrees, so the projection jumped from "from the side" to "from above" part way round, and the grain smeared into stretched bands: a sawtooth along the top of every baseboard.

> **Concept: Triplanar mapping.** Project the texture along all three axes (X, Y and Z), and blend the three results by how much the surface faces each axis. Where the surface is flat the blend is all one axis, and where it turns the projections cross-fade smoothly, so there is no jump.

I sharpened the blend weights (`pow(|n|, 8)`) so flat faces still take one axis at the old cost, and only genuine curves pay for three samples. The bumps from each axis are turned into a world-space bend and added, so lighting stays continuous.

Checking the normals view turned up two older bugs. Wall textures ran upside down (nobody noticed on plaster, but the damask's flowers pointed down and its water stains ran up). And the DirectX-convention normal maps on world-projected surfaces had their vertical component flipped, so every bump on a wall or floor was lit as if it were a dent. Tile edges above the grout faced up instead of down. Both are fixed.

![A baseboard before and after triplanar blending](/images/2026-10-02-surfaces-with-depth/trim-zoom.jpg "Left: the cap's sawtooth of stretched grain. Right: the bead and cove read as one continuous profile.")

## Baked occlusion and sharper textures

A drawer under a worktop, a curtain tucked under a sink, the bead of a moulding: these corners should be a little darker, because less light reaches them. Screen-space ambient occlusion catches some of that, but at half resolution and only from what the camera sees. I wanted it baked.

The obvious plan was to bake into textures, but my authored meshes use tiling UVs, so a texture cannot hold per-place values. Instead, when a mesh is imported, the engine bakes occlusion into its *vertices*. Each vertex casts 48 rays into the open half-sphere above it and counts how many hit the mesh within a short reach. It reuses the probe baker's tree for finding ray hits, on every core, and the house's 30 meshes take about 0.4 s in all. It works for any mesh, including future Blender imports.

The first look showed almost nothing. My furniture is built from boxes whose faces had vertices only at the corners, so where a worktop meets a cupboard there was no vertex along the joint to darken. The mesh builder now splits box faces into cells of at most 6 cm. The wardrobe went from about 600 triangles to 15,900, which the GPU does not notice.

Textures got two upgrades. Colour textures were block-compressed as BC1, which gives each 4 by 4 block only four colours. Smooth, dark gradients, which describe most of my house, turn into bands.

> **Concept: Block compression.** GPUs store textures compressed in fixed 4 by 4 pixel blocks and decode them on the fly, so they take a fraction of the memory. BC1 spends 8 bytes per block: two endpoint colours and four shades between them. BC7 spends 16 bytes and gets much closer to the original by choosing its mode and endpoints more carefully.

I wrote a BC7 encoder from scratch: principal-axis endpoints, least-squares refinement, and all four p-bit pairs tried. On the plaster scan it scores 51.4 dB (a measure of closeness to the original, higher is better) against BC1's 40.5. The cost is twice the memory for colour textures. I also baked the furniture textures at twice the size, because their finest grain ran at two pixels per cycle and aliased into blotches up close.

![The butler sink cupboard with baked occlusion off and on](/images/2026-10-02-surfaces-with-depth/ao-zoom.jpg "Left: no baked occlusion. Right: the curtain darkens where it tucks under the sink frame, and the joints around the posts pick up contact shading.")

## Wear, grime and detail

Old things wear where hands and feet touch them and gather dirt where a cloth never reaches. I did not want to paint each piece, so the engine works it out from shape. When a mesh loads, it computes, per vertex, three masks next to the occlusion:

- how close the vertex is to a *convex edge* (short rays along the surface from just under it that leave the solid);
- whether it sits in a *crevice or joint*;
- how near it is to the floor.

Each material then says what shows through. Painted trim chips down to bare wood, brass rubs bright, cast iron wears to metal, mahogany polishes at its edges, and grime darkens joints and feet. On their own the smooth vertex masks would make every edge wear identically, so the shader thresholds them against noise fixed to the object, plus a broad noise that leaves whole stretches untouched. My first try outlined the hallway door's panels in bright lines, and softer wood colours fixed that. I also added fine detail normal maps that tile over a material for close-ups: stucco grain, scratches and wood pores.

![The kitchen cupboard with wear off and on](/images/2026-10-02-surfaces-with-depth/wear-counter.jpg "Left: new paint. Right: the paint chips to wood along the stiles and drawer edges, and the panel joints and plinth gather grime.")

![The wear masks as a debug view](/images/2026-10-02-surfaces-with-depth/wear-masks.jpg "The mask view: edges red, crevices and joints green, the floor blue.")

## Decals that do more than colour

Decals are textures projected onto surfaces to add stains and damage. Mine could only recolour a surface. Old houses have damage that you see only by its shading, and water. So I added two blends:

- **Relief-only.** A `normal` decal leaves the colour alone and adds only bumps and roughness. Hairline cracks in a ceiling show as shading under a lamp instead of drawn grey lines, and gouges in a floor catch light along their edges.
- **Wet.** A `wet` decal darkens what it covers (porous things go darker when wet), makes it glossy, and smooths most of its relief away, as a film of water does. Because the depth prepass sees the low roughness too, screen-space reflections show the toilet in the puddle at its foot. Water is applied after every other decal, so a puddle over a dust patch is still wet.

I also gave each decal its own angle fade, because decals used to stop on surfaces turned 70 degrees from them. The puddles use 100 degrees so the water reaches the foot of the toilet's pedestal. Along the way, my first hairline cracks were 1.5 px lines broken up by noise and read as scattered fragments; wider lines and fewer breaks made them a network.

![The bathroom with a wet puddle at the toilet and wet runs on the tile](/images/2026-10-02-surfaces-with-depth/bath.jpg "The puddle reflects the toilet's pedestal, with wet runs on the tile behind.")

## Cost and what is left

Each step cost a little. The wear and grime layers added 0.04 to 0.08 ms of GPU time per pose in the house (2 to 5 percent), parallax 0.05 to 0.21 ms in the hallway, and the others stayed inside run-to-run noise. Every pose stays under 3.7 ms.

Open items: the walls and floors of the library are built-in boxes with no vertex masks, so their dirt still comes from decals; wet decals read through reflections, so they fade in dim, flat light; and only one slot in the decal atlas is left free. The next phase moved from surfaces to light.
