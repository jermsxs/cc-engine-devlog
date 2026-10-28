---
title: Lightmaps for walls and furniture, and a baker 40 times faster
date: 2026-10-03
order: 1
summary: I baked bounce light into lightmaps for walls and furniture, stored the direction of the light, stitched chart seams, fixed leaks under walls and made the baker 40 times faster.
tags: lighting, renderer, performance
cover: /images/2026-10-03-lightmaps/hallway.jpg
---

Bounce light is the light that reaches a surface after bouncing off other surfaces, not straight from a lamp. In a dark house it is most of what is visible in the shadows, and it is what makes a corner darker than the middle of a wall. Until today every surface took it from a grid of probes, points in space that store the light around them, spaced 60 cm apart and blended. A grid that coarse cannot show the darkening where a wall meets the floor, and near walls some probes sit partly inside the wall, so light smears through. The result was bright blobs on floors and walls that no lamp explained.

The plan for the day was to stop interpolating a coarse guess and bake the answer onto the surfaces themselves.

## How a lightmap works

> **Background: baking and lightmaps.** Some lighting is too expensive to compute 60 times a second but does not change while the player moves: a lamp's light bouncing around a room does not depend on the camera. So it is computed once, ahead of time, and stored in a texture, the lightmap. A lightmap is made of texels, the pixels of a texture, and each texel holds the light arriving at one small patch of a surface. At run time the shader reads the texel for the surface point instead of computing the light. Lamps and the flashlight still light everything live, so flicker and scripts keep working. Only the soft bounce light is baked.
>
> A model needs a second set of texture coordinates for this, because every point must own a unique spot in the lightmap, with no overlaps and no tiling. These come from unwrapping: cutting the surface into flat pieces called charts and packing them into one texture called an atlas.

Each texel stores diffuse irradiance, written as `E / pi`, the same unit my probes use, so the shader can swap one for the other on a surface. My bake is a gather. For each texel, the baker sends up to 256 rays out over the hemisphere above it, weighted by cosine. A ray that hits a surface brings back that surface's albedo times the direct light there, computed with shadow rays to the lamps. It also adds the probe grid's bounce light at the hit, which stands in for light that has bounced more than once. A ray that escapes sees the hemisphere ambient. This is not a full path tracer, which would follow every ray through many bounces. It traces one bounce and reads cached light for the rest, which is much cheaper and is adequate in a house this dark.

Because rays are random, each texel's result is noisy. The error shrinks with the square root of the ray count, so a texel stops early once its standard error is under 4 percent of its mean (rays go out in batches of 64). A single ray's radiance is capped at 2.0 so rare bright hits do not leave isolated white pixels.

## Walls first

The first version covers the walls, floors and ceilings, which are simple boxes in my scenes. Each face of each box gets its own rectangle of texels in one atlas, at 10 texels per metre, so a texel covers 10 cm. The texel lattice runs to the face's edges, so bilinear sampling of a face never reads a neighbour's texels.

Texels inside other geometry, such as where a wall meets the floor, have nothing meaningful to compute. A texel sends 16 rays first, and if at least a fifth of them hit back faces it is marked invalid and filled from its valid neighbours. This dilation also serves the padding around each chart: bilinear filtering reads four texels, so the border texels must hold plausible values and not black. About a third of a typical scene's texels are buried this way, and skipping them saves much of the work.

The house is dark, and nearly all of its bounce light comes from a few lamp-lit patches of wall, which a texel's rays find only occasionally. That left blotches. Two things did not work. Giving all the texels on a face the same ray pattern turned blotches into streaks. Clipping very bright rays barely helped. What worked was a smoothing filter that is wide where a texel is out in the open and narrow near walls and corners, so it keeps the darkening where surfaces meet. A bug in that filter first turned filled-in texels black or huge, because their neighbours' weights underflowed to zero. They now keep their filled value.

At first only walls qualified for lightmaps. The probe volumes end a few centimetres short of the floor and ceiling slabs, so those boxes were missed. A box now counts if it comes within one probe spacing of a volume.

![The hallway lit by probes versus lightmaps](/images/2026-10-03-lightmaps/hallway.jpg "Top row, indirect light only: probes on the left, lightmap on the right. Bottom row, the final image. The floor darkens along the walls and the bright smear at the far end is gone.")

![The atlas of baked texels](/images/2026-10-03-lightmaps/atlas.jpg "The house's atlas, brightened: 205 boxes with six rectangles each, packed into one texture.")

## Baking 40 times faster

The first version of the house bake took six minutes. Skipping buried texels and letting each texel compute the light it gives off only once, so that rays hitting it read a cached value, brought that to about 100 seconds. The whole lighting bake still took 263 seconds even in a Release build, and many minutes in Debug, which is what my MCP server runs.

Before changing anything I made the bake report each stage's time and added a `SceneInspect trace-bench` command that times the ray tracer on its own and counts the work each ray does. That showed the cause: each ray tested about 2,400 triangles.

> **Background: bounding volume hierarchies.** To find what a ray hits among 100,000 triangles, you do not test all of them. The triangles are grouped into boxes, those boxes into larger boxes, and so on up to one root, forming a tree. A ray tests the root box first, and if it misses, everything inside is skipped. A good tree reduces 100,000 tests to a few dozen. Builders choose where to split a node with the surface area heuristic (SAH), which estimates the expected cost of a ray crossing each candidate split. A fast approximation sorts triangles into a few bins along one axis and evaluates splits at the bin boundaries.

My builder used binned SAH along one axis. When all of a node's triangles fell into a single bin, as happens with thousands of small triangles from a vase and dried flowers beside one long wall triangle, it gave up and made the node a single leaf of thousands of triangles. Every ray passing nearby tested all of them. The 24 threads ran only 4.5 times faster than one, because they spent their time waiting on memory.

The fixes:

- **The tree.** Try all three axes, split nodes that binning cannot separate at the median, and keep only small nodes, at most 8 triangles, as leaves.
- **The traversal.** Each node's box was tested twice, once when its parent looked at it and again when it came off the stack. It is now tested once. Triangles are stored in tree order with their edges precomputed, so one test reads one small record.
- **The bake itself.** Lamps are clipped to their room in the renderer, but the baker ignored that and traced shadow rays to lamps in other rooms. It now honours the boxes, so the bake matches what is drawn. Texels buried inside walls no longer compute their own light.

| | Before | After |
|---|---|---|
| Triangles tested per ray | 2,369 | 4.5 |
| Boxes tested per ray | 144 | 61 |
| Rays per second (24 threads) | 0.6 M | 14.3 M |
| House bake, Release | 263 s | 6.5 s |
| House bake, Debug | many minutes | 55 s |
| Hallway bake, Release | 11.5 s | 1.6 s |

## Furniture without a second set of coordinates

Walls were done, but furniture, door frames and trim still took the probes, so a bed frame did not darken where it met the floor. The usual route is to unwrap every mesh into a second UV set. I avoided that. When a mesh is loaded, it is cut into charts: groups of triangles that face the same way, each flattened along that direction into its own rectangle of the atlas. Every triangle records its chart, and the shader finds the triangle from the GPU's primitive number, so the meshes themselves do not change. A mesh placed many times at different sizes, such as a run of trim, gets its own charts for each placement. Door leaves move, so they keep the probes, as do glass and double-sided parts.

Curved furniture was the problem. My first version put the armchair's rounded cushions in lightmaps, and they came out in jagged steps. A 10 cm texel stores light for one direction, and a cushion's 3 cm curve turns from facing up to facing forward inside a single texel, crossing from one chart to another, where each side has its own value. Probes shade a curve with each pixel's own normal, which handles this well. So a mesh got a lightmap only if it was boxy: at least three quarters of its surface facing within 15 degrees of one of its own axes. 134 of the house's meshes qualified.

Two details followed. Charts were first flattened along the world's axes, which fails for a chair turned 53 degrees, so they follow each object's own axes. And furniture already has occlusion baked into its vertices, which the lightmap also contains, so lightmapped furniture came out too dark. On lightmapped surfaces the vertex occlusion is now taken back out.

![The bedroom with and without lightmaps on furniture](/images/2026-10-03-lightmaps/bedroom.jpg "Top: bounce light only, the walls lightmapped on the left and the furniture too on the right. Bottom: the final image. The bed frame and wardrobe darken in their recesses; the armchair keeps the probes.")

![The armchair's lightmapped cushions with jagged steps](/images/2026-10-03-lightmaps/armchair-steps.jpg "What went wrong: stepped patches on the armchair where the cushion's curve crosses from one chart to the next.")

## Storing the direction of the light

Until this point a texel held one colour: the light arriving at a surface facing one way. Bumps from normal maps, such as plaster pits, floorboard grain and scratches, reacted to the lamps but not to bounce light, so in a room lit mostly by bounce they looked flatter than they should.

> **Background: directional lightmaps.** To shade a bump you need to know where the light comes from. Several engines store a little directional information per texel: Source's radiosity normal mapping stores light for three directions, and Unreal and Unity store a dominant direction. A single dominant direction is the cheapest version. A pixel whose normal leans toward that direction receives more of the texel's light, and one leaning away receives less.

Each texel now also keeps `d`, the luminance-weighted mean direction of its gather rays. Under an even sky `d` is two thirds of the normal, and beside a wall it leans toward the open side. The texel also records `w = 0.5 + dot(d, n)` at its own normal. The shader shades a pixel with normal `N` as `E * (0.5 + dot(d, N)) / w`. That is a soft, half-Lambert falloff, exact at the texel's own normal. Under an even sky a surface tilted 60 degrees gets 71 percent of the light, close to the 75 percent a real tilted plane sees. It costs four extra bytes per texel.

My first filter did not respect directions. The floor on either side of a wall that stands on it sees its light from opposite sides, and the smoothing filter, which reaches under the wall, averaged the two into no direction at all. Directions are now smoothed only among neighbours whose directions are alike.

The first version cost 0.18 ms per frame, about 10 percent of the scene pass, for a texture read that should cost almost nothing. Reading the lightmap at the top of the pixel shader meant its values were held in registers through the whole direct-light loop, which already uses the most registers. The shader now computes where to read at the start and reads the textures after the loop. The cost dropped to nothing measurable.

![The landing's indirect light before and after, and their difference](/images/2026-10-03-lightmaps/landing-relief.jpg "Indirect light of the landing brightened 4 times: without directions (left), with them (middle), and the difference multiplied by 20 (right). The floor's gouges, the baseboard and door-frame bevels and the herringbone now respond to bounce light.")

## Seams and leaks

Three problems were left.

**Seams between charts.** Where two charts meet along a curve, each holds its own texels, and a pixel reads the chart its triangle belongs to, so the border zigzags along the triangles. That was the jagged line down the armchair's arm. After the bake, every smooth edge where two charts meet is read from both sides, and the texels on both sides are adjusted by a least-squares solve until they agree. The solve compares what the shader would compute, the light and its direction, so the seams also agree on bumpy, normal-mapped surfaces. The armchair's seams went from 41 percent apart to 1.4 percent. Rounded furniture can now join the lightmap: 205 meshes in the house, up from 134, and 64 in the hallway, up from 31.

**Light leaking under walls.** The smoothing filter works on one face at a time, and a floor that runs under a wall is one face, so the filter carried light from one side of the wall to the other. A floor roofed over next to a wall came out 47 percent brighter beside it than a little further in. The filter now also checks that a neighbour's light comes from a similar direction, which it does not across a wall. A test fails without the check: 0.075 beside the wall against 0.051 further in.

**Probes brighter than lightmaps.** I rendered the house's ten bench views with the lightmap on and off. The probes gave 1.34 times the lightmap's light on the same surfaces, and up to 1.85 times in the nursery. They sit in open air 0.6 m apart and cannot see the wall right beside a surface. Now every lightmap texel tells the probes near it what light it really has, and each probe is scaled to match, read exactly as the renderer reads it. The same measurement gives 1.01. Door leaves and glass, which stay on probes, now sit in the room at the right brightness.

![The armchair's indirect light with probes, with a jagged seam and stitched](/images/2026-10-03-lightmaps/armchair-stitched.jpg "Indirect light times 3. Left: probes. Middle: lightmap with a jagged seam down the arm. Right: stitched, smooth, with contact shading.")

I also followed a wrong guess. In the indirect view the basin and toilet went nearly black once lightmapped. I suspected lathe-turned shapes folding over themselves and wrote a check, which found nothing. The numbers showed the texels gather real light, just very little, which is correct for a bowl under a basin. The probes had been overestimating. I removed the check.

## Results and open issues

Bakes take 2.7 s for the hallway and 9.9 s for the house in Release, including 0.75 s for stitching and filtering. The bench stays within noise, at most +0.03 ms per pose, and video memory grows by 1 MB. The change is subtle in a house this dark, where bounce light is a small part of the picture, but contact darkening grounds objects in a way the probes could not.

Open items:

- A 4-wide SIMD tree would roughly double the tracer, and baking on the GPU would make bakes interactive.
- One room cannot yet be rebaked alone when only it changes.
- Rounded meshes still depend on stitching. Charts that bend around curves would need a real unwrap.
