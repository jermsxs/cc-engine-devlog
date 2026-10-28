---
title: Going outside, into the woods
date: 2026-10-21
order: 1
summary: The engine had only ever lived in rooms. I gave it a sky, sun shadows that reach across a forest, leaf-shaped shadows, light through leaves, and wind.
tags: outdoors, shadows, foliage
cover: /images/2026-10-21-going-outside/o2-box-woods-four-cascades.jpg
---

Until now this engine has lived indoors. A hallway, a two-storey house, a kitchen with a sunny window. Every pixel that no object covered was a hard-coded near-black, and "sky" meant one flat ambient colour. Good enough for corridors, useless for a forest.

The next stretch of work takes the kitchen's back door and opens it onto a path through the woods, ending at an old iron gate. That sounds like a content job, but the first three steps were all renderer work. I needed a sky, a sun whose shadows reach across a whole forest, and leaves that behave like leaves. I tested each step on cheap stand-in scenes (box trees, a test bush) so I could see the new feature without art getting in the way.

## A real sky

I picked a CC0 sky photo from Poly Haven: a hazy afternoon with no horizon or tree line in it, so the trees I build will not fight a photographed one. It is a *HDR image*, which means it stores real brightness values and not just 0-255 colours. The sun in it is thousands of times brighter than the blue next to it, and that range matters for lighting.

> **Concept: HDRI sky.** An HDRI is a panorama of the sky stored as light, not as a picture. You can draw it behind the scene, but you can also treat it as a light source: for any direction, it tells you how much light arrives from there. One image gives you the background and the ambient light.

I wrote the loader for the `.hdr` file format from scratch (it is a simple run-length-encoded format), plus a sky pass that draws the panorama at the far plane of the depth buffer. Anything closer simply hides it. Two details were more interesting than the drawing:

- **The sun in the picture is clamped.** The scene will have its own sun light, with its own shadows. If the photo's sun disc stayed at full brightness it would be a second, shadowless sun in the bake. So the sky's brightness is capped, and the real sun comes from a directional light.
- **Light from the sky comes in two flavours.** For the baked lighting, rays that escape the scene read the sky map directly. For a surface with no probe nearby, the engine falls back to an average of the sky's upper and lower halves. A surface normal is not a ray, and that fallback has to be a smooth average. Keeping the two cases separate was the one subtle part.

It checked out with a test sky made of coloured quadrants (green above, red below, blue to the west): looking up, down, west, spun round, and behind a wall all gave the expected colours. The hallway, house and kitchen rendered identically afterwards.

## A sun that reaches across a forest

In a room, a single shadow map covers the sun's whole view of the room. In a forest, a 20 metre oak has to shadow a path 60 metres away, but the player also wants crisp shadows right at their feet. One map cannot do both.

> **Concept: Shadow map.** A shadow map is a depth picture taken from the light's point of view. When shading a pixel, the renderer asks "is something closer to the light along this line?" If so, the pixel is in shadow. The map has a fixed number of texels, so spreading it over a bigger area makes each texel coarser and shadow edges blurrier.

The classic answer is *cascaded shadow maps*. Cut the camera's view into slices by distance, and give each slice its own shadow map. Near slices are small, so their texels are small and shadows are sharp. Far slices are big and coarse, but far things are small on screen anyway, so nobody notices.

![A top-down view of the camera's view split into four distance slices](/images/2026-10-21-going-outside/cascades.svg "Four cascades: each slice of the view gets its own shadow map, so detail is sharp near the camera and coarse far away.")

How this engine does it:

- The camera's view is cut into up to four slices with the usual blend of even and logarithmic spacing, over the first 60 metres by default.
- Each slice gets an orthographic shadow face fitted to a sphere around the slice. A sphere does not change size when the camera turns, so the texels do not shimmer when you look around.
- Each face's origin is snapped to whole texels, so moving does not make the shadow edges crawl.
- The shader takes the first cascade that contains the pixel and blends to the next one over the outer tenth of the tile, hiding the seams.

Here is the first test: sixty box trees over a flat plane with four cascades, then the same view with none.

![Box trees casting long shadows across the ground](/images/2026-10-21-going-outside/o2-box-woods-four-cascades.jpg "Four cascades: every tree's shadow reaches the ground, the far ones included.")

![The same box trees with no shadows](/images/2026-10-21-going-outside/o2-box-woods-no-cascades.jpg "No cascades: an unbounded sun cast nothing before this change.")

The price is real. Four cascades cost about 0.12 to 0.15 ms extra in the main pass, and 0.45 ms in the volumetric fog, because the sun's light shafts march through 80 metres of air and ask the cascades at every step. That is fine for the budget, but the shafts are the thing I will tune later. The kitchen, which has its own bounded sun, kept its single detailed shadow face and looked identical.

## Shadows shaped like leaves

A leaf in a game is usually a flat card (two triangles) with a picture of leaves on it, and the transparent parts are cut away. Seen from the camera that looks fine. But a card with the cut-out ignored casts a square shadow, and a canopy of squares looks like a roof, not a tree.

So the shadow pass now draws masked materials through a shader that tests the texture's alpha and discards the cut-away pixels. A card is only one triangle thick, so both faces draw. The baking tools (probes, lightmaps, reflection captures) get the same treatment: a ray that hits a clear texel carries on through the leaf.

![A bush with its shadow cut out leaf by leaf](/images/2026-10-21-going-outside/o3-cluster-and-its-shadow.jpg "A test bush in the sun: its shadow is cut out leaf by leaf, not a block.")

A test card, half opaque and half clear, over a floor confirmed it: the floor under the opaque half read dark, under the clear half it was as bright as open ground.

## Leaves that glow from behind

If you stand under a tree and look up at the sun, the leaves are not dark. They glow, because light passes through them. In graphics this is *translucency* (the cheap cousin of subsurface scattering).

> **Theory: Translucency.** A thin leaf lets some of the light on its back surface scatter out through its front, tinted by the leaf's own colour. So a leaf lit from behind is bright and green, while the same leaf lit from the front just looks like a leaf.

For foliage materials, the shader adds the light that arrives at the leaf's *back*, as if scattered through the leaf's colour. It is strongest when you look toward the light and is shadowed by the same shadow map, with the normal flipped. A test card lit from behind came out more than twice as bright as the plain one.

A second trick: a pile of flat cards looks like a heap of planes. The shader bends each card's shading normal toward the direction pointing out from the centre of its object, so a cluster shades like a round crown.

I also had to fix three things that would have broken leaves from far away:

- **The depth prepass cuts leaves out too.** Ambient occlusion, reflections and the anti-aliasing all read the prepass. Without the cut-out, they saw square cards.
- **Mipmaps keep their coverage.** A mip is a shrunken copy of a texture used at a distance. Averaging a leaf's alpha with the clear texels around it makes it fade, so far trees go bald. The mip generator now scales alpha up so each mip covers as much as the full image.
- **Anti-aliasing softens the edge.** Under TAA the cut-off threshold is dithered over time, so leaf edges resolve smoothly.

## Wind

Last, the leaves move. A material can ask for *sway*, which bends the whole mesh with the wind (more the higher up it is), and for *flutter*, which wiggles branches and leaves by weights painted into the mesh's vertex colours. Each object gets its own phase from where it stands, and gusts swell the strength over seconds.

The subtle part is anti-aliasing. TAA looks at how pixels moved since last frame, so the vertex shader also computes where each vertex *was* a frame ago, using the previous frame's time. Otherwise the leaves smear and ghost.

![Under a cluster of leaves, looking toward the sun](/images/2026-10-21-going-outside/o3-leaves-against-the-sun-wind-a.jpg "Looking up into the sun from under a test cluster: the backs of the leaves are lit through, and the wind is moving them.")

## Where this stood

The renderer now has what a forest needs: a sky, a sun that shadows near and far, leaf-shaped shadows, light through leaves, and wind. Every test scene was a box wood and a test bush, though, and it looked like it. The shadows of swaying trees also stand still for now, since the shadow cache only redraws when something moves. Next I had to find out whether any of this survived contact with a real forest.
