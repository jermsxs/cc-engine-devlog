---
title: Parallax, triplanar projection, baked occlusion and procedural wear
date: 2026-10-02
order: 2
summary: Five steps that give surfaces depth at close range: parallax occlusion mapping, triplanar blending, vertex occlusion with BC7 textures, edge and crevice wear masks, and new decal blends.
tags: materials, renderer
cover: /images/2026-10-02-surfaces-with-depth/wear-counter.jpg
---

With the house furnished, I started a realism plan and began with surfaces, because in a first-person game they are what the player looks at most closely. Up close, my floors and walls were still flat pictures. The normal maps bent the light correctly, but a groove never hid anything: from a low angle, tile grout and the seams between boards looked painted on. The furniture looked new, with every edge crisp and every joint clean.

I worked through five steps in one day. Each changes how a surface responds when the camera gets close.

## Parallax occlusion mapping

**The problem.** A normal map changes the direction a surface reports to the lighting, but it does not change where the surface is. Looking at tile from a low angle, the grout lines should be sunk below the tile faces, with the near edge of each groove hiding part of its far wall. A flat polygon cannot do that, so the grout read as a drawing.

> **Background: parallax and height maps.** Hold a finger in front of you and move your head: near things shift against far things. A flat polygon has no such shift. Parallax mapping reintroduces it using a height map, a greyscale image that says how far below the polygon's surface each texel lies. A view ray enters the polygon's plane at some point, but if the real surface is deeper there, the ray travels on and meets the surface further along. The point to read the textures from is where the ray meets the height field, not where it crossed the polygon.
>
> The cheapest version offsets the texture coordinate by the height at the entry point, which is wrong wherever the height changes quickly. Parallax occlusion mapping (POM) marches the ray instead. In tangent space, the ray's travel across the surface is `-v.xy / v.z * depth` for a ray that goes a full `depth` down, where `v` is the unit vector to the eye. The march splits that travel into equal depth steps. At each step it compares the ray's depth with the depth stored in the height map. It stops at the first step where the ray is below the surface, then interpolates between the last two steps to estimate the crossing. Colour, normal and roughness are then sampled at the shifted coordinate.
>
> Its limits are well known. The polygon's silhouette stays flat. With too few steps the result shows terraces at grazing angles. The cost is one height-map read per step, per pixel.

![A view ray stepping through a height map](/images/2026-10-02-surfaces-with-depth/parallax-march.svg "The ray enters the polygon's surface at the first marker but meets the far wall of the groove. The shader reads the textures at the hit and the difference between the two points is the uv shift.")

**My implementation.** The engine already had height maps in its material library that nothing sampled. Each material's descriptor block now holds a sixth texture, its height map, bound at a new register (`t27`) so none of the later registers had to move. A new material value, `heightScale`, gives the depth of the darkest texel in metres. Its default of 0 keeps parallax off, so every other material is unchanged.

The march lives in a small shader include. A simplified version of the loop:

```hlsl
float steps = round(lerp(16.0, 6.0, saturate(vt.z)));  // more steps at grazing angles
float2 stepUv = reach / steps;                         // uv travel per step
float stepDepth = 1.0 / steps;
for (int i = 0; i < 16 && rayDepth < surfaceDepth; ++i)
{
    current += stepUv;
    rayDepth += stepDepth;
    surfaceDepth = ReliefDepthAt(current);             // the height map, as depth below the surface
}
// then interpolate between the last step above the surface and the first below it
```

It takes 6 steps when looking straight at a surface and up to 16 at a grazing angle. It fades out completely by 6 m, where 3 mm of relief is under a pixel at 1440p, and also at very grazing angles, where it would need too many steps. It works on built-in boxes, whose coordinates are projected from the world, and on authored meshes, whose texture scale comes from screen-space derivatives.

I wrote height maps for the parquet (sunk seams, bevels, a slight cup per board, boards not quite level), the plaster and the two tiles (recessed grout). Depths are 4 mm for parquet and 3 mm for plaster and tile.

The first version cost up to 1.1 ms of GPU time per frame at 1440p, 10 to 30 percent, which is far too much for millimetre detail. Three changes brought it to 0.05 to 0.21 ms. The depth prepass no longer runs parallax, since its normals barely change. The fade distance went from 11 m to 6 m. The step counts went from 8 to 28 down to 6 to 16. The dark wood floor, used on 68 surfaces in the house, gets no parallax because its grain relief was too soft to be worth paying for.

The plaster's first height map also had broad swells half a metre across. Parallax shifts the texture lookup in proportion to depth, so broad height differences make a whole patch of wall appear to slide as the player walks. The generator now removes everything broader than a twelfth of the texture and keeps trowel marks, pits and bubbles.

![Wall tile at a low angle, with parallax off on the left and on the right](/images/2026-10-02-surfaces-with-depth/tile-zoom.jpg "Left: the grout is painted flat. Right: it sinks behind the tile edges and the lit rims of the tiles show.")

## Triplanar projection

**The problem.** Most of the house has no texture coordinates of its own. Walls, floors and stairs are boxes, and baseboards and rails are authored mouldings. For these the shader derives coordinates from the world position: for each pixel it picks the axis the surface faces most and projects the texture along it, so floors take it from above and walls from the side. On a flat, axis-aligned face that is exact. Where the surface turns, it fails. Along the rounded bead of a baseboard the facing direction swings through 90 degrees, so the projection jumped from side to top partway round the curve. The grain jumped there, and on the slope next to the jump it stretched into bands, because projecting along an axis nearly parallel to the surface stretches the texture. The result was a sawtooth along the top of every baseboard.

> **Background: triplanar mapping.** Project the texture along all three axes and blend the three results by how much the surface faces each axis. The weights come from the normal: `w = |n|^k`, normalised so they sum to 1. On a flat face one weight is 1, and where the surface turns the projections cross-fade, so no jump occurs. The exponent `k` sets the width of the blend. At `k = 1` surfaces blur together over a wide range of angles, which hides detail and costs three samples almost everywhere. A larger `k` keeps one axis dominant over most angles and narrows the blend to the region where it is needed. Normal maps need care: each axis has its own tangent frame, so each projection's normal-map offset is converted to a world-space bend and the bends are added before the normal is renormalised.

I use `pow(|n|, 8)`. Flat faces and gently turned ones still take a single axis at the old cost, with parallax. A face counts as flat when one weight is at least 0.98, and axes with a weight under 0.01 are skipped. Only real curves, such as the bead of a baseboard, and rotated boxes pay for three taps. The depth prepass uses one axis.

Checking the normals view to verify the blend turned up two older bugs. First, on walls the texture's v ran up the wall, so every image was upside down. Nobody noticed on plaster, but the damask's flowers pointed down and its water stains ran upward from the baseboard. Second, normal maps in the DirectX convention (green channel points down the image) had their vertical component flipped on world-projected surfaces, so every bump was lit as if it were a dent. Tile edges above the grout faced up instead of down. The flip now depends on the projection. On world projection the bitangent runs down the image, so DirectX maps need no flip. On authored UVs it runs up the image, so they still do.

The blend costs +0.01 to +0.20 ms in the hallway, whose corridors are lined with trim, and -0.04 to +0.05 ms in the house.

![A baseboard before and after triplanar blending](/images/2026-10-02-surfaces-with-depth/trim-zoom.jpg "Left: a sawtooth of stretched grain along the cap. Right: the bead and cove read as one continuous profile.")

## Baked occlusion and BC7 textures

**The problem.** A drawer under a worktop, a curtain tucked under a sink and the bead of a moulding should all be a little darker, because less light reaches them. My screen-space ambient occlusion catches some of that, but it works at half resolution and only from what the camera currently sees.

> **Background: ambient occlusion.** Ambient occlusion is the fraction of the hemisphere above a point that is open to the sky, within some distance. A point in a corner sees less of the sky and receives less ambient light. It can be estimated at run time from the depth buffer, which is cheap but approximate, or computed offline by casting rays against the geometry and storing the result.

The plan suggested baking into textures. My authored meshes use tiling UVs, so a texture cannot hold values that differ from place to place. Instead the engine bakes occlusion into the vertices when a mesh is imported. Each vertex casts 48 cosine-weighted rays into the open hemisphere above it. A hit within the reach counts as occlusion, fully when near and hardly at all at the edge of the reach, so shading fades smoothly. The reach is 0.35 of the mesh's diagonal, between 2 cm and 25 cm. The rays use the probe baker's BVH on every core, the house's 30 meshes take about 0.4 s in all, and it works for any mesh, including future Blender imports. The value goes into the vertex's red colour channel.

The first look showed almost nothing. The cause was vertex density. Occlusion is stored per vertex and interpolated across a triangle, and my box faces had vertices only at their four corners, so where a worktop meets a cupboard there was no vertex along the joint to darken. The mesh builder now splits box faces into cells of at most 6 cm. The wardrobe went from about 600 triangles to 15,900, which the GPU does not notice.

![The butler sink cupboard with baked occlusion off and on](/images/2026-10-02-surfaces-with-depth/ao-zoom.jpg "Left: no baked occlusion. Right: the curtain darkens where it tucks under the sink frame, and the joints around the posts pick up contact shading.")

Textures got two upgrades in the same step.

> **Background: block compression.** GPUs store textures in fixed 4 by 4 pixel blocks that the hardware decodes on read. BC1 spends 8 bytes per block: two 16-bit endpoint colours and a 2-bit index per pixel, so a block has only four colours. BC7 mode 6 spends 16 bytes: two 8-bit endpoints and a 4-bit index per pixel, so a block has 16 levels between them. Smooth dark gradients, which describe most of this house, turn into visible bands with BC1.

I wrote a BC7 encoder from scratch: principal-axis endpoints, least-squares refinement, and all four p-bit pairs tried. On the plaster scan it scores 51.4 dB against BC1's 40.5 dB, at one byte per pixel instead of half a byte. The furniture, door and frame textures were baked at 256 to 512 px with grain running at two pixels per cycle, which aliased into blotches up close, so they are now baked at twice the size.

## Wear and grime from the shape

**The problem.** Old things wear where hands and feet touch them and collect dirt where a cloth never reaches. Painting that on every piece by hand does not scale, and my pieces are generated by scripts. The shape already says where wear belongs.

> **Background: edge, cavity and floor masks.** Material authoring tools bake a curvature map from a mesh. Convex edges, where paint chips and metal shows through, are positive curvature. Concave corners and joints, where dust and grime collect, are negative curvature, often called a cavity mask. A third useful signal is height above the floor, which marks the places feet and cleaning cloths affect. A mask is then used to blend a worn or dirty layer over the clean material.

The engine computes the masks per vertex when a mesh loads, next to the occlusion, using ray queries against the mesh:

- **Edge.** From each vertex it shoots short rays along the surface from just under it. A convex edge is a place where such a ray leaves the solid within a short reach, and gentle curves do not count.
- **Crevice.** Rays from just over the surface that meet a face turned back at them, or that pass from one part of the mesh into the next, mark a concave corner or a joint. Two boxes butted flush therefore make a grimy joint and not a worn edge.
- **Floor.** For meshes that stand on the floor, how close the vertex is to the bottom of the mesh.

The masks go into the remaining colour channels, and a glTF can bring its own painted masks in `COLOR_0` instead.

Each material then says what shows through. Painted trim chips down to bare wood, brass and nickel rub bright, cast iron wears to metal, enamel chips to black and mahogany polishes at the arrises. Grime darkens and roughens joints, crevices, feet and the darkest baked-occlusion corners. Glass, water, mirrors and bulbs stay clean.

Smooth vertex masks would make every edge wear identically, so the shader thresholds each mask against noise that is fixed to the object, which keeps it attached when a door swings. A broad second noise leaves whole stretches of an edge untouched. My first try outlined the hallway door's panels in bright lines, and a broader noise with softer wood colours fixed that. Box faces also gained a row of vertices 8 mm in from every edge, so the worn band stays narrow and does not fade across a 6 cm cell.

![The wear masks shown as a debug view](/images/2026-10-02-surfaces-with-depth/wear-masks.jpg "The mask view: edges red, crevices and joints green, the floor blue.")

![The kitchen cupboard with wear off on the left and on the right](/images/2026-10-02-surfaces-with-depth/wear-counter.jpg "Left: new paint. Right: the paint chips to wood along the stiles and drawer edges, and the panel joints, drawer gaps and plinth gather grime.")

**Detail normal maps.** Up close, a base normal map's texels grow larger than pixels and the surface looks soft. A second, finely tiling normal map over the material adds its bumps to the base map's. I generated three: stucco grain for plasters and wallpaper, fine scratches for floors, trim and polished wood, and wood pores for later use.

## Decals that do more than colour

Decals project a texture onto the surfaces inside a box. Mine could only recolour a surface, with a little relief on the crack and peeling-paint decals. Two things were missing that matter in an old house: damage visible only through its shading, and water. I added two blends.

- **Relief only.** A `normal` decal leaves the colour alone and adds only bumps and roughness. Hairline cracks in a ceiling show as shading under a lamp, not as drawn grey lines, and gouges in a floor catch light along their edges.
- **Wet.** A `wet` decal darkens what it covers, makes it glossy and smooths most of its relief away. Porous materials look darker when wet because water fills the pores and changes how light scatters near the surface, and a smooth film of water has low roughness. The depth prepass sees the low roughness as well, so screen-space reflections show the toilet's pedestal in the puddle at its foot. Water is applied after every other decal, so a puddle over a dust patch is still wet.

Each decal now has its own angle fade. Decals used to stop on surfaces turned 70 degrees from them, which keeps a wall stain off the top of a baseboard. The puddles use 100 degrees so the water reaches the foot of the toilet's pedestal, and the wet runs on the bathroom tile use 120. My first hairline cracks were 1.5 px lines broken up by noise and read as scattered fragments. Wider lines with fewer breaks made them a network.

![The bathroom with a wet puddle at the toilet and wet runs on the tile](/images/2026-10-02-surfaces-with-depth/bath.jpg "The puddle reflects the toilet's pedestal, and wet runs streak the tile behind it.")

## Results and open issues

Each step cost a little GPU time. Parallax added 0.04 to 0.21 ms per pose in the hallway, the wear and grime layers 0.04 to 0.08 ms per pose in the house, and the decal blends stayed within run-to-run noise. Every pose stays under 3.7 ms at 1440p.

Open issues:

- The library's walls and floors are built-in boxes with no vertex masks, so they receive the detail maps but no wear. Their dirt still comes from decals.
- Wear on lathes and sweeps follows their own vertex density, so coarse rings wear in wider bands.
- Wet decals read through reflections, so they fade in dim, flat light.
- Parallax has no self-shadowing yet, so a groove does not shadow itself under a low lamp.

The next phase moved from surfaces to light.
