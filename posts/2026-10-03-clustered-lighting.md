---
title: Clustered lighting, a bouncing flashlight and layered lamp bounce
date: 2026-10-03
order: 2
summary: I replaced the eight-lights-per-object limit with clustered lighting, added a faked bounce light for the flashlight and baked switchable lamps into layers so their bounce light leaves with them.
tags: lighting, renderer, performance
cover: /images/2026-10-03-clustered-lighting/bounce-corridor.jpg
---

After the lightmaps, three things in my lighting still did not behave like light. A long wall or a large floor that several lamps reach could miss some of them, because each object only used its eight strongest lights. The flashlight lit what its beam hit and nothing around it. And when the hallway scare made nearby lamps gutter, the walls kept the soft light those lamps had been bouncing, so the corridor never went properly dark. I fixed all three in the afternoon, starting with the light limit.

## Why eight lights per object was a problem

Every frame, the CPU chose up to eight lights for each object, and the pixel shader looped over only those. That is cheap, but an object has one list for all its pixels. A floor that runs the length of the hallway needs one list of eight, even though the lamps near one end are different from the lamps near the other. And as the camera moved, lights whose scores were close swapped places in the list. I had hidden that with a rule that a light keeps its slot unless another beats it clearly, but the limit itself was still there.

> **Background: three ways to light a pixel with many lights.** A pixel's light is the sum of the contribution of every light that reaches it. The question is how a pixel learns which lights those are.
>
> - **Naive forward rendering** loops over every light in the scene for every pixel. It is simple and exact, but the cost is the number of pixels times the number of lights, and most of those tests are for lights too far away to matter.
> - **Tiled forward rendering** divides the screen into 2D tiles, such as 16 by 16 pixels. A compute shader builds one list of lights per tile, and the pixels in a tile loop over that list. This removes most of the waste, but a tile is a column that runs from the camera to infinity. If a tile contains a nearby wall and, through a doorway, the far end of the hallway, its list contains every light along that whole depth range, and every pixel in the tile pays for all of them. Tiles that use the depth range actually present in the tile narrow this, but a depth discontinuity in the tile defeats it.
> - **Clustered forward rendering** divides the view into a 3D grid, adding slices along the depth axis. Each cell, called a cluster or a froxel (a voxel shaped like a piece of the frustum), has its own list. A tile that contains a near wall and a far doorway now maps to different cells for the two, so each takes only the lights near it.

In my version the grid is 24 tiles across the screen, 14 down and 24 slices deep, 8,064 clusters in all. The slices are not equal in thickness. Slice boundaries are placed at

```text
depth(k) = near * (far / near)^(k / 24)      near = 0.1 m, far = at most 50 m
```

so each boundary is the same multiple of the one before it, about 1.3 times with a 50 m range. A cell near the camera is a thin slab and a distant one is a thick slab. This matches the way tiles widen with distance: the width of a tile on screen grows in proportion to depth, so making slice thickness grow in proportion to depth keeps every cell the same shape. Equal-thickness slices would waste almost all of their cells on the distant view, where a pixel covers a large area of the world.

![A camera frustum cut into tiles and slices](/images/2026-10-03-clustered-lighting/cluster-slices.svg "A top view of the grid. A light's range overlaps three cells and is listed in only those. Slices are thin near the camera and thick far away.")

## Building the lists

A compute shader runs once per frame with one thread for each cluster. Each thread:

1. Computes the cluster's eight corners from its tile and slice, takes the box around them, and builds the sphere around that box. The sphere is slightly larger than the cell, which makes the test conservative: a light may be listed for a cell it does not quite reach, but a light is never left out of a cell it reaches.
2. Tests every light against the sphere. A light is rejected if its range sphere does not overlap the cell's sphere, if it is switched off, or if the light is clipped to a room box and the cell is outside it. A rectangle light is rejected when the cell is behind its panel, because a panel emits only forwards. A spot is rejected when the cell's sphere lies outside its cone. For the cone I use the distance from the sphere's centre to the cone's surface, `cos(outer) * across - sin(outer) * along`, where `along` is the distance along the cone's axis and `across` is the perpendicular distance from it. If that distance is greater than the sphere's radius, the sphere is outside the cone.
3. Writes the surviving lights' indices into a fixed slot of a list buffer, with the count first. A cluster holds at most 32 lights. If more reach it, the count still goes up, so a debug view can show that the list overflowed, and the extra lights are dropped.

The flashlight is tested first, so a full cluster never drops it. In the pixel shader, a pixel finds its cluster from its position on screen and its view depth:

```text
tile  = floor(pixel / screenSize * (24, 14))
slice = floor(log(viewDepth / near) * 24 / log(far / near))
```

and loops over that cluster's list. Every light that can reach a pixel is shaded, and the cost follows the number of lights near each pixel and not the number in the scene. A scene can now hold 127 lights plus the flashlight, up from 63. A lamp in a closed room costs only where it shines.

![Lights per pixel with per-object and per-cluster selection](/images/2026-10-03-clustered-lighting/lights-per-cluster.jpg "A debug view of how many lights each pixel shades in the foyer, brighter meaning more. Left: per object, where a whole object takes the same lights and the regions follow object outlines. Right: per cluster, where the regions follow the grid.")

The final image does not change, which is the intention for this kind of change. The mean difference from the old renderer was 0.05 to 0.2 out of 255. I tested the culling by brute force: 300 random lights of every kind were checked against 400 random visible points from two cameras, and every time a light reached a point, that point's cell listed it. None was missed. Separate tests check that slice depths map back to their slice and that each kind of rejection happens when it should. On the bench the cost was within noise, at -0.06 to +0.07 ms per pose, and the lists use 1 MB of video memory (8,064 clusters of 33 four-byte entries).

## A flashlight that bounces

When you shine a torch at a wall in a dark room, the wall glows and lights the space around it faintly in its own colour. In the renderer the torch lit only the surface it hit.

> **Background: indirect light from a single bounce.** Light that reaches a point after reflecting off another surface is indirect light. Computing it exactly means following light through many reflections, which I do for the lamps in the offline bake. The torch moves, so it cannot be baked. A cheaper approximation, used in several engines, is to treat the lit patch as a new light source, a virtual light, placed where the beam lands. A diffuse patch scatters light evenly, so a small area `A` of radiance `L` acts like a source of intensity about `L * A` facing away from the surface.

My version works in two steps.

**Measuring.** After the scene is drawn, a compute shader samples the lit image around the point where the beam lands on screen: a disc as wide as the beam's inner cone, about 200 samples. It averages the light leaving the surface (before exposure), the surface normal from the depth prepass, and the view depth, using a parallel reduction in group memory, where each pass adds the upper half of the array into the lower half. It also counts how many samples hit a surface within the beam's reach, as a coverage value. The CPU reads the result back a couple of frames later.

**Placing a light.** From the reading, the engine creates a spot light 5 cm off the surface, facing along the normal. Its intensity is the measured radiance times the area of the beam's footprint (`pi * r^2` times the coverage), its colour is the surface's colour, so a red wall glows red, and its cone is open to 88 degrees so it spreads like a flat patch. Its range ends where the light it gives falls to 0.002, which is `sqrt(intensity / 0.002)` metres, clamped between 0.5 m and 8 m. It casts no shadow. It goes through the clusters like any other light, so it costs nothing special to shade. It eases in and out over a tenth of a second, so the torch's flicker and the frame or two before a reading arrives do not show. A setting, `flashlight.bounce`, scales it and 0 turns it off.

![The corridor with the flashlight bounce off and on](/images/2026-10-03-clustered-lighting/bounce-corridor.jpg "The same view with the bounce off and on, exposure held fixed. The change is slight: the door frame and the floor beside the lit wall pick up some light.")

At first the bounce never appeared, because the measuring pass found no surfaces. To turn a device depth value back into a distance in metres, the shader computes `P43 / (depth - P33)`. I had added a guard that treated a non-positive denominator as invalid, but with my projection the denominator is always negative in front of the camera, so the guard rejected every pixel. A test for a division by zero had become the bug.

## Lamps that take their bounce light with them

Baked light is fixed in the texture. When a script made a lamp gutter or switched it off, the walls kept the soft light that lamp had bounced into them.

> **Background: light adds up.** Light transport is linear in the sources: the light in a scene lit by lamps A and B is exactly the light with only A plus the light with only B. That is what allows a bake to be split. The steady lamps go into a base bake, and each lamp that a script may change gets a bake of its own, a layer. Scaling a layer by a factor scales that lamp's contribution by the same factor.

I can mark a lamp as switchable. Its bounce is then baked separately, into a layer, for both the lightmap and the probe grid. While the game runs, the layer is multiplied by the lamp's brightness now divided by its brightness when it was baked: half as bright gives half the bounce, and off gives none. A scene can have three switchable lamps, because each costs a bake pass and memory. In the hallway, the three lamps nearest the closet scare are switchable, and the bake takes 7 s for four passes, the base and the three lamps.

A test bakes one room twice: once with a lamp in the base, once with the lamp as a layer. Base plus layer must give the whole bake, within 6 percent for the lightmap and 10 percent for the probes, and the scale must be 1 as baked, 0.5 at half brightness and 0 when off. The two bakes are estimates from random rays, so they cannot match exactly, which is why the test has a tolerance.

![The hallway's indirect light with a lamp on and off](/images/2026-10-03-clustered-lighting/indirect-on-off.jpg "Indirect light, times 3, beside one wall lamp: on (left) and switched off by a script (right). The lamp's bounce leaves with it; the other lamps' bounce stays.")

![The wall lamp on and off in the final image](/images/2026-10-03-clustered-lighting/lamp-on-off.jpg "The final image with the same lamp on and off, exposure held fixed. With the lamp off, the wall goes dark, and only the globe, which still glows, is left lit.")

On screen, the indirect light in view went from 23.4 to 15.9 to 7.8 as the lamp went from on to half brightness to off. The remainder is the other lamps' bounce. The globe in the second image still glows, which was a separate problem that I dealt with in the audit the next day.

### Making it free when nothing switches

The first version cost up to 0.14 ms per frame in the hallway even though every lamp was at its baked brightness. Three things caused that.

- **The compiler did not skip the layers.** The fog and the probes added each layer after testing whether the layer's scale was zero. On a GPU, threads run in groups that all execute the same instruction, so a branch is cheap only if the whole group takes the same side, and the compiler may replace a branch with executing both sides and selecting the result. That is what happened: it read the layer and multiplied it by zero.
- **A lamp at its baked brightness was not at its baked brightness.** The bake multiplies a light's colour and intensity in a different order than the renderer does, and a lamp at its baked brightness came out at 0.9999999 of it. That alone meant the extra layers were read every frame.
- **The structure.** The GPU now keeps the whole bake as its first layer and adds a lamp's layer only while that lamp is away from its baked brightness, behind a single test the compiler keeps. Within 0.1 percent counts as unchanged.

With the lamps steady, the layers cost nothing I can measure.

## Two bugs from the clustering work

Building the layers exposed two bugs I had introduced earlier.

Switching the flashlight off hung the GPU. The culling shader combined "a flashlight exists" and "it reaches this cluster" in one condition, and HLSL evaluates both halves. With the flashlight off, its index was -1, and the second half read light number -1, outside the light buffer. A buffer bound as a root descriptor has no bounds check, so the read hung the GPU and Windows reset it. The test is now an explicit branch.

The flashlight's bounce light began life at full brightness at the world's origin, which is in the foyer of the house. In play, it faded within a tenth of a second, but my benchmark freezes the clock, so for the whole run every foyer frame was lit by a light that should not exist. That also meant my earlier bench under-measured the bounce's real cost, and the bounce never moved after the first pose. With the clock frozen, the bounce now snaps to where the beam lands.

## Results

With the layers, the hallway costs -0.02 to +0.05 ms per pose and 8 MB of video memory. The house, which has no switchable lamps, shows -0.01 to +0.07 ms. That is the flashlight bounce's real cost now that its light is not frozen at the first pose. The house bake stays at 10 s.

This finished the light phase of my realism plan. Two problems remained: the globe of a lamp that had gone out still glowed, and the baked reflections still held its light. I dealt with both in the audit that came next.
