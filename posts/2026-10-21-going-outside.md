---
title: A sky, cascaded sun shadows, leaf shadows and wind for the outdoor scene
date: 2026-10-21
order: 1
summary: The first outdoor steps. An HDRI sky, cascaded shadow maps for the sun, alpha-tested leaf shadows, light through leaves and wind in the vertex shader.
tags: outdoors, shadows, foliage
cover: /images/2026-10-21-going-outside/o2-box-woods-four-cascades.jpg
---

Until this point the engine had only rendered interiors: a hallway, a two-storey house and a kitchen with a sunlit window. Every pixel that no object covered was a hard-coded near-black, and "sky" meant one flat ambient colour. That is enough for a corridor and unusable for a forest.

The next stretch of work takes the kitchen's back door and opens it onto a path through woods that ends at an old iron gate. The first three steps are renderer work, not content. The renderer needs a sky, a sun whose shadows reach across a whole forest, and leaves that behave like leaves. I tested each step on cheap stand-in scenes, sixty box trees and a single test bush, so that the new feature is visible without any art in the way. These are renderer tests and I label them as such.

## The sky

### How a sky is modelled

Sunlight enters the atmosphere as nearly white light. Air molecules scatter short wavelengths far more strongly than long ones; the strength falls with the fourth power of the wavelength (Rayleigh scattering). That is why the daytime sky is blue and why a low sun, whose light crosses much more air, turns orange and red. Larger particles such as dust and water droplets scatter all wavelengths about equally and mostly forward, which produces the pale glow around the sun and the haze near the horizon (Mie scattering).

Real-time renderers reproduce this in one of two ways:

- **A procedural model.** For each view direction, march a ray through the atmosphere and integrate scattering along it. At each step the light that reaches the point has already been dimmed on its way down from the sun, by the Beer-Lambert law, `transmittance = exp(-density * distance)`. Production systems precompute this into lookup tables, and cheaper analytic models fit a closed-form function to the sun's angle and the air's turbidity. The result changes with the time of day.
- **A captured sky.** A photographed panorama stored as linear radiance, an HDR image, already contains all of that scattering as it was measured. It can be drawn behind the scene, and it can also act as a light source, because for any direction it says how much light arrives from there.

I used the second approach. The woods have one specific hazy look to match, and a photograph reaches a plausible sky faster than tuning a model. The cost is a fixed time of day, with the sun's position baked into the picture. I have not built a procedural sky for this scene.

### My implementation

I took a CC0 sky from Poly Haven, a hazy afternoon with no ground or tree line in it, so that the trees I author will not compete with a photographed horizon. It is a Radiance `.hdr` file. The format stores each pixel as three 8-bit mantissas with one shared exponent (RGBE), compressed with run-length encoding per scanline. I wrote the loader from scratch, with an encoder for tests.

The sky pass draws a full-screen triangle at the far plane of the depth buffer. Anything closer hides it, glass draws over it, and it fades into the fog at the volume's far edge. The map is stored as RGBA16F.

Two details decide how it behaves as a light:

- **The sun in the photograph is clamped.** The scene has its own sun, a directional light with its own shadows. If the photograph's sun disc kept its full brightness, it would be a second, shadowless sun in every bake. `sky.maxRadiance` caps the map, so the real sun comes only from the directional light.
- **Rays and normals are different queries.** For baked lighting, rays that leave the scene sample the map in their own direction. For a surface where no probe reaches, the ambient fallback is the mean radiance of the map's upper and lower hemispheres. A surface normal is not a ray, and the fallback has to be a smooth average, so the code keeps the two cases apart.

A test sky made of coloured quadrants (green above, red below, blue to the west) gave the expected colour when looking up, down, west, turned round and from behind a wall. The hallway, house and kitchen benches stayed image-identical, since none of them sets a sky. The sky seen through the kitchen window is dim, and I have left its tuning for later.

## Cascaded shadow maps for the sun

### The problem

In a room, one shadow map can cover the whole volume the sun lights. A forest is different. A 20 m oak has to shadow a path 60 m away, and the player also needs a crisp shadow at their feet. One map cannot do both.

### How shadow maps and cascades work

A shadow map is a depth image rendered from the light's point of view. To shade a pixel, the renderer transforms its position into the light's space and compares its depth with the stored value. If something nearer to the light was recorded there, the pixel is in shadow.

The map has a fixed number of texels, so its resolution depends on the area it covers:

```
texel size = area covered / map resolution
```

A 2048 map spread over 120 m has texels of about 6 cm. Spread over 9 m, the texels are about 4 mm. A shadow edge can only be as sharp as one texel.

A perspective camera shows near things large and far things small, so near surfaces need much finer texels than far ones. Cascaded shadow maps cut the camera's view into depth slices and give each slice its own orthographic map, fitted to the slice. Near slices are small with fine texels, and far slices are large and coarse, where the coarseness is hidden by distance. The renderer picks the slice for each pixel from the pixel's position.

![A top-down view of the camera's view split into four distance slices](/images/2026-10-21-going-outside/cascades.svg "Four cascades. Each slice has its own shadow map, so shadow detail is fine near the camera and coarse far away.")

Three decisions determine the quality:

**Where to put the splits.** Even slices waste resolution on the far field, where texels are too fine for what is on screen, and starve the foreground. Logarithmic slices, `n * (f / n)^(i / N)`, give every slice the same ratio of far to near depth, which matches how perspective shrinks things. Pure logarithmic splits make the first slice absurdly thin, so the usual compromise mixes the two with a factor lambda:

```
split(i) = lambda * n * (f / n)^(i/N)  +  (1 - lambda) * (n + (f - n) * i/N)
```

I use lambda 0.75, four slices and a 60 m range. For a 0.05 m near plane that puts the boundaries near 4, 9, 19 and 60 m, which I computed from the formula.

**How to stop the edges shimmering.** Each cascade is an orthographic box in light space. If I fit the tightest box around the slice's frustum, its size changes as the camera turns, so the texel size changes and every shadow edge swims. I fit a bounding sphere to the slice instead. A sphere's radius does not depend on the camera's rotation, so the texel size is constant. The cost is a little wasted area compared with a tight box. The second source of shimmer is translation. If the map moves by a fraction of a texel, every texel samples slightly different geometry and the edges crawl. Each cascade's origin is therefore snapped to whole texels.

**How to hide the seams.** At the border between two cascades the texel size and the biases differ, so the shadow visibly jumps. The shader takes the first cascade whose tile contains the pixel clear of its guard band. Over the outer tenth of that tile it blends toward the next cascade:

```
visibility = lerp(next, current, edge / 0.1)
```

Each face also reaches up-light as far as the nearest shadow caster's bounds, so a tall tree outside a slice still casts into it.

### In the engine

`shadow.sunCascades` (0 to 4), `shadow.sunCascadeDistance` (60 m) and `shadow.sunCascadeTileSize` (2048, with the third and fourth cascades taking half) control it. A bounded sun, as in the kitchen, keeps its box face in front of the cascades, so the kitchen keeps its millimetre texels. An unbounded sun, allowed now when cascades are requested, has the cascades alone.

The shadow atlas has sixteen 1024-blocks. Two 2048 tiles and two 1024 tiles take ten of them. With the kitchen's box face (four) and the flashlight (one), one block is left and the lamps would lose their shadows. A cascade that finds no tile is dropped together with those after it, and the frame statistics report how many were drawn. The combined kitchen-and-woods scene will have to use 1024 cascades or fewer of them.

The first test is sixty box trees over a flat plane, with four cascades and then with none.

![Box trees casting long shadows across the ground](/images/2026-10-21-going-outside/o2-box-woods-four-cascades.jpg "Four cascades: each tree's shadow reaches the ground, including the far ones.")

![The same box trees without shadows](/images/2026-10-21-going-outside/o2-box-woods-no-cascades.jpg "No cascades: an unbounded sun cast nothing before this change.")

On the RTX 4070 at 1080p, four cascades cost 0.12 to 0.15 ms in the opaque pass, for the cascade pick and the soft-shadow filter. They cost another 0.45 ms in the volumetric fog, because the sun's light shafts march through 80 m of air and query the cascades at every step. The shadow pass itself costs nothing here, since its faces are cached while nothing moves. The shafts are what I will tune later: fewer steps, a shorter distance, or one coarse cascade for the air.

## Shadows with the shape of a leaf

A leaf in real-time graphics is usually a flat card of two triangles with a picture of leaves on it, and the transparent parts are cut away. The camera sees the cut-out. A shadow pass that ignores it renders the whole card, so each leaf casts a square and a canopy of squares reads as a roof.

### Alpha testing

Alpha testing samples the texture's alpha at each pixel and discards the pixel if alpha is below a cutoff. The shadow pass now draws masked submeshes (glTF `alphaMode: MASK`) with a pixel shader that clips at the material's cutoff. A card is one triangle thick, so both faces draw. The bakers (probes, lightmaps, reflection captures) get the same cut-out: masked surfaces keep their alpha channel and uvs, and the BVH continues a ray through clear texels.

I tested with a glTF quad written at test time, opaque on one half and clear on the other, over a floor.

![A masked card and its shadow](/images/2026-10-21-going-outside/o2-test-leaf-card-masked.jpg "A test card, opaque on the left half only. The shadow on the right is half the width of a solid card's.")

The floor under the opaque half measured 72. Under the clear half it measured 210, against 180 for open floor. With a fully opaque card the same spot measured 69. The bake rays agree.

### Everything that reads depth

After the shadow pass, a second problem remained. Ambient occlusion, reflections and anti-aliasing all read the depth prepass, which still drew each card as a solid square. The prepass now cuts leaves out in the same way. Masked submeshes go through a prepass pipeline that clips at the cutoff, and the lit pass tests against the prepass's depth without writing its own.

A third problem appears with distance. A mipmap is a half-size copy of a texture that is used when it covers few pixels. A box filter averages a leaf's alpha with the clear texels around it, so a leaf that is half opaque at full size is a quarter opaque at the fourth mip. The cutoff then removes it, and distant trees go bald. The mip generator now scales each mip's alpha by the smallest factor (between 1 and 8) at which the share of texels above the cutoff equals the full-size image's. Every mip then covers as much as the first.

### Anti-aliasing

The standard fix for the jagged edge of an alpha-tested cutout is alpha-to-coverage: the shader outputs alpha as a multisample coverage mask and the hardware resolve averages it. My render targets are single-sample, and the engine's anti-aliasing is temporal. Under TAA a masked foliage material therefore dithers its cutoff:

```
cutoff = saturate(cutoff + (noise(pixel, frame) - 0.5) * 0.5)
```

The noise changes every frame, so a pixel on a leaf's edge is inside on some frames and outside on others, and the temporal resolve averages it into a soft edge. The prepass dithers the same pixel the same way, so the lit pass's depth test still holds.

## Light through the leaves

### Translucency

Standing under a tree and looking toward the sun, the leaves are not dark. They glow green, because a leaf is thin enough for some of the light that hits its back to scatter out through its front, tinted by the leaf's own colour. Full subsurface scattering is expensive. Foliage uses a thin-surface approximation.

An ordinary diffuse term, `max(N·L, 0)`, is zero for a surface lit from behind. A thin surface adds a back-lit term, `max(-N·L, 0)`, scaled by the leaf colour and a transmission factor. The scattered light is brightest when the viewer looks toward the light, so my shader weights it by the view direction `v`:

```
through = 0.25 + 0.75 * pow(saturate(dot(v, -l)), 4)
```

The shadow lookup for that term uses the normal flipped toward the light, because the leaf's own depth is the face the light actually lands on.

A pile of flat cards also reads as a heap of planes. The second part of the foliage shading bends each card's shading normal toward the direction pointing out from the centre of its object, a little above the middle, where a crown sits. A cluster of cards then shades like a rounded crown. For this every object now carries its world bounds in a spare constant.

A glTF material marks itself as foliage through its extras. `foliage: true` sets transmission 0.5, normal bend 0.5, flutter 1 and no grime, and the individual values can be set by name. A card lit from behind by the sun came out well over twice as bright as the same card with a plain material.

![A card lit from behind as a foliage material](/images/2026-10-21-going-outside/o3-test-leaf-card-backlit-foliage.jpg "FoliageRenderTests at 320 by 180: the sun comes through the leaf card.")

![The same card as a plain material](/images/2026-10-21-going-outside/o3-test-leaf-card-backlit-plain.jpg "The same card with a plain material: nearly black.")

![A test bush with its shadow cut out leaf by leaf](/images/2026-10-21-going-outside/o3-cluster-and-its-shadow.jpg "A test bush in the sun. The shadow follows the individual leaves.")

## Wind in the vertex shader

Wind is a vertex shader job. A vertex shader can displace each vertex as a function of its position, the time and a few per-vertex weights, with no CPU work per frame. A tree has motion at several scales: the whole trunk leans slowly, branches swing faster, and individual leaves flutter quickly. The GPU cannot tell branch from leaf, so the weights are painted into the mesh's vertex colour.

My shader has three terms:

- **Sway** bends the whole mesh with the wind. The displacement grows with the square of the height up the object's bounds, so the base stays rigid. It is 8 cm at strength 1.
- **Branch flutter** moves vertices sideways by a phase painted in the red channel and a weight in blue. It is 3 cm at strength 1.
- **Leaf flutter** moves vertices along their normal by the weight in green. It is 1.5 cm at strength 1.

Each object gets its own phase from where it stands, so a wood does not move as one body. The gust multiplies the strength by a slow sum of two sine waves, so it swells over seconds.

TAA needs motion vectors, which come from how each pixel moved since the last frame. A swaying leaf moves in the vertex shader, so the shader also computes where each vertex was a frame ago, using the previous frame's time. Without that, the leaves smear and ghost.

`renderSettings.wind` holds direction, strength, gust and speed, and is saved only when the strength is not zero. Materials without sway or flutter branch out of all of this, so the interiors do not pay for it. A test confirmed that a card's top row moves at least two pixels in the wind while its bottom row moves less than one.

## Results and open issues

The renderer now has a sky, a sun that shadows near and far, leaf-shaped shadows, light through leaves and wind. The hallway, house and kitchen benches stayed image-identical after each step, with timings inside the noise, and the full test suite passed at 108, 109 and then 110 tests.

Every test scene was still a box wood or a single bush, and it looked like one. The shadows of swaying trees also stand still, because the shadow cache redraws only when something moves. The next step was to compare the woods with a reference and see how much of this survived contact with a real forest.
