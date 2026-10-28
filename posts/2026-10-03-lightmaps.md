---
title: Lightmaps, from walls to furniture
date: 2026-10-03
order: 1
summary: Baking bounce light into textures for walls, then furniture, with directions, stitched seams, fixes for leaks under walls, and a bake that got 40 times faster.
tags: lighting, renderer, performance
cover: /images/2026-10-03-lightmaps/hallway.jpg
---

Bounce light is the light that reaches a surface after bouncing off other surfaces, not straight from a lamp. In a dark house it is most of what you see in the shadows, and it is what makes a corner darker than the middle of a wall. Until today every surface got it from a grid of probes (points in space that store the light around them) spaced 60 cm apart and blended. A probe grid cannot show the darkening where a wall meets the floor, and near walls the probes partly sit *inside* the wall, so light smears through. The result was bright blobs on floors and walls that the lamps did not explain.

Today's plan: stop guessing. Bake the real answer onto the surfaces themselves.

## What baking is

> **Concept: Baking.** Some lighting is too expensive to work out 60 times a second but does not change much: a lamp's light bouncing around a room does not care what the camera is doing. So you work it out once, ahead of time, store the result in a texture, and just look it up while playing. Doing that work is called *baking*, and the texture is a *lightmap*. Lamps and the flashlight still light everything live, so flicker and scripts keep working. Only the soft bounce light is baked.

A lightmap texture is made of *texels*, the pixels of a texture. At 10 texels per metre, one texel covers a 10 cm square of wall. For each texel, the baker sends 256 rays out over the hemisphere above it. Whatever a ray hits brings back the light that surface has: its direct light from the lamps (with shadows), plus the probes standing in for light that has bounced one more time.

## Walls first

The first version covers the walls, floors and ceilings, which in this engine are simple boxes. Each face of each box gets its own rectangle in one big texture, an *atlas*, and the texel grid runs to the face's edges so a face never borrows a neighbour's light.

The house is dark, and nearly all its bounce light comes from a few lamp-lit patches of wall, which a texel's rays find only now and then. That left blotches. I tried two things that did not work: giving all the texels on a face the same ray pattern (it turned blotches into streaks) and clipping very bright rays (barely helped). What worked was a smoothing filter that is wide where a texel is out in the open and narrow near walls and corners, which keeps the darkening where surfaces meet.

![The hallway lit by probes versus lightmaps](/images/2026-10-03-lightmaps/hallway.jpg "Top row, indirect light only: probes on the left, lightmap on the right. Bottom row, the final image. With a lightmap the floor darkens along the walls and the bright smear at the far end is gone.")

![The atlas of baked texels](/images/2026-10-03-lightmaps/atlas.jpg "The house's atlas, brightened: 205 boxes, six rectangles each, packed into one texture.")

A bug on the way: that filter first turned filled-in texels (the ones inside other geometry) black or huge, because their neighbours' weights underflowed to zero. They now keep their filled value.

## Baking 40 times faster

The first version of the house's bake took six minutes. A first round of tricks brought it to about 100 seconds: each texel works out the light it gives off once, texels buried inside walls (a third of them) are found with 16 rays and skipped, and so on. But the house's whole lighting bake still took 263 seconds even in a Release build, and many minutes in Debug, which is what my MCP server uses.

Before changing anything I made the bake report how long each stage took, and added a command that times the ray tracer on its own, along with how much work each ray does. That showed the real problem: **each ray tested about 2,400 triangles.** A sound spatial tree tests a handful.

> **Concept: Bounding volume hierarchies.** To find what a ray hits among 100,000 triangles, you do not test all of them. You group the triangles into boxes, group those boxes into bigger boxes, and so on, building a tree. A ray tests the big box first; if it misses, everything inside is skipped. A good tree turns 100,000 tests into a few dozen.

The tree was built by sorting triangles into bins along one axis. When all of a node's triangles fell into one bin (thousands of tiny triangles of a vase and dried flowers next to one long wall triangle), the builder gave up and made the node a single leaf of thousands of triangles. Every ray passing nearby tested them all, and my 24 threads ran only 4.5 times faster than one because they were waiting on memory.

The fixes:

- **The tree.** Try all three axes, split nodes binning cannot separate at the median, and keep only small nodes (8 triangles at most) as leaves.
- **The traversal.** Each node's box was tested twice; now once. Triangles are stored in tree order with their edges precomputed, so a test reads one small record.
- **The bake itself.** Lamps are clipped to their rooms in the renderer but the baker ignored that and traced shadow rays to lamps in other rooms. It now honours the boxes, so the bake matches what is drawn. A texel also stops tracing once its result has settled (64 rays at a time, up to 256), which saved a third of the rays.

| | Before | After |
|---|---|---|
| Triangles tested per ray | 2,369 | 4.5 |
| Rays per second (24 threads) | 0.6 M | 14.3 M |
| House bake, Release | 263 s | 6.5 s |
| House bake, Debug | many minutes | 55 s |
| Hallway bake, Release | 11.5 s | 1.6 s |

## Furniture, without a second set of UVs

Walls were done, but furniture, door frames and trim still used the probes, so a bed frame did not darken where it met the floor.

> **Concept: UV unwrapping.** To put a texture on a 3D model, every point on the model needs a 2D coordinate saying where in the texture it lives. Giving a model those coordinates is *unwrapping*: you cut the surface into flat pieces (*charts*) and lay them out in the texture, like peeling an orange. A lightmap needs a second set of coordinates where no two pieces overlap, because each spot needs its own stored light.

The usual route is to unwrap every mesh. I avoided it. Instead, each mesh is cut into charts at load time: triangles that face the same way and touch, each flattened along that direction into its own rectangle of the atlas. Every triangle knows its chart, and the shader finds its triangle from the GPU's triangle number, so the meshes themselves do not change. One mesh can be placed many times at different sizes (trim runs), and each placement gets its own charts. Door leaves move, so they keep the probes, as do glass and double-sided parts.

Curved furniture was a problem. My first version put the armchair's rounded cushions in lightmaps and they came out in jagged steps.

![An armchair's lightmapped cushions with jagged steps](/images/2026-10-03-lightmaps/armchair-steps.jpg "What went wrong: stepped patches on the armchair, where the cushion's curve crosses from one chart to the next.")

Why? A 10 cm texel stores light for one direction, and a cushion's 3 cm curve turns from facing up to facing forward inside a single texel, crossing from one chart to another where each side has its own value. Probes shade a curve with each pixel's own normal, which is right. So a mesh gets a lightmap only if it is boxy: at least three-quarters of its surface facing within 15 degrees of one of its own axes. 134 of the house's meshes qualified. Armchairs, vases and turned parts kept the probes for now.

Two more details. Charts were first flattened along the world's axes, which fails for a chair turned 53 degrees, so they follow each object's own axes. And furniture already has baked occlusion in its vertices, which the lightmap also holds, so lightmapped furniture came out too dark. On lightmapped surfaces the vertex occlusion is now taken back out.

![The bedroom with and without lightmaps on furniture](/images/2026-10-03-lightmaps/bedroom.jpg "Top: the bounce light only. Bottom: the final image. The bed frame and wardrobe darken in their recesses; the armchair keeps the probes.")

## Directions

Until now a texel stored one colour: the light reaching a surface facing one way. So bumps from normal maps (plaster pits, floorboard grain) reacted to the lamps but not to bounce light. Most engines store a bit of direction too (Source's radiosity normal mapping, for example).

A texel now also keeps the direction most of its light comes from, weighted by brightness: straight up under an even sky, tilted toward the open side next to a wall. A pixel whose bumped normal tilts toward that direction gets more of the texel's light, and one tilting away gets less. The cost was supposed to be nothing, but the first version cost 0.18 ms per frame, about 10 percent of the scene pass. Reading the texture at the start of the shader meant its values were held in registers through the whole light loop. Moving the read to after the loop made the cost unmeasurable.

## Seams and leaks

Three problems were left.

**Seams between charts.** Where two charts meet along a curve, each holds its own texels, and a pixel reads whichever chart its triangle belongs to, so the border zigzagged along the triangles. After the bake, I now read every smooth edge from both sides and nudge the texels on both sides, by a least-squares solve, until they agree. The armchair's seams went from 41 percent apart to 1.4 percent. With the seams fixed, rounded furniture joins the lightmap too: 205 meshes in the house, up from 134.

![The armchair's indirect light: probes, jagged seam, and stitched](/images/2026-10-03-lightmaps/armchair-stitched.jpg "Left: probes. Middle: lightmap with a jagged seam down the arm. Right: stitched, smooth and with contact shading.")

**Light leaking under walls.** The smoothing filter works on one face at a time, and a floor that runs under a wall is one face, so the filter carried light from one side to the other. A floor roofed over next to a wall came out 47 percent brighter right beside it than further in. The filter now also checks that a neighbour's light comes from a similar direction, which it does not across a wall.

**Probes brighter than lightmaps.** I rendered the house's ten bench views with the lightmap on and off. The probes gave 1.34 times the lightmap's light on the same surfaces, up to 1.85 in the nursery, because they sit in open air and cannot see the wall right beside a surface. Now every lightmap texel tells the probes near it what light it really has, and each probe is scaled to match. The same measurement now gives 1.01. Door leaves and glass, which stay on probes, now sit in the room at the right brightness.

I also followed a wrong guess along the way. The basin and toilet went nearly black in the indirect view, and I suspected folded geometry and wrote a check for it. It found nothing; the numbers showed the texels gather real light, just very little, which is right for a bowl under a basin. I removed the check.

## Where it ended

Bakes now take 2.7 s for the hallway and 9.9 s for the house, and the bench numbers stayed within noise, at most +0.03 ms per pose. The changes are subtle in a house this dark, where bounce light is a small part of the picture, but contact darkening grounds objects in a way probes could not.

Still open: baking on the GPU would make bakes interactive, and one room cannot yet be rebaked on its own when only it changes.
