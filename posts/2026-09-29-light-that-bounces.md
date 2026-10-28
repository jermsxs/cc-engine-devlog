---
title: Baked irradiance probes and reflection probes for bounce light
date: 2026-09-29
order: 3
summary: Baked irradiance probes and reflection probes for the hallway: the theory of spherical harmonics, cube maps and box projection, and the cost of each.
tags: lighting, renderer
cover: /images/2026-09-29-light-that-bounces/bench-after.jpg
---

With the editor in better shape, I returned to the picture. Looking again at the reference, the thing my hallway lacked most was light that bounces. In the reference the ceiling, the far walls and the end of the corridor all glow softly from the lamps. In my render each lamp made a bright pool and every other surface received the same flat grey "ambient" term, whether it sat in a lit corner or in a closet with the door shut.

I did the work in two steps. The first was diffuse indirect light, which lights surfaces from the light that other surfaces scatter. The second was specular indirect light, which gives shiny surfaces a reflection of the room around them.

![The six benchmark views before the bake](/images/2026-09-29-light-that-bounces/bench-before.jpg "Before: bright pools around the lamps and a uniform dark grey everywhere else.")

## Why direct light alone looks wrong

A direct light model computes, for each pixel, the light that travels straight from a lamp to the surface, multiplied by the material's response. In a real room most surfaces receive far more light that has already bounced off something else. A white ceiling above a lamp that points at the floor is lit by the floor. A shadow is never black, because the rest of the room still lights it.

Formally, the diffuse light arriving at a surface point with normal `n` is the *irradiance*:

```text
E(n) = integral over the sphere of  L(w) * max(0, n . w)  dw
```

`L(w)` is the radiance arriving from direction `w`. The `max(0, n . w)` term is Lambert's cosine law: light arriving at a grazing angle is spread over more surface and counts for less. For a Lambertian surface the light leaving is `albedo / pi * E(n)`. Computing `L` needs every other surface's lit appearance, and every surface lights every other one, so the exact answer is a very large problem.

A game engine has two ways to approximate it. It can estimate it every frame in screen space or with a voxel structure, at a cost per frame. Or it can compute it once for a scene that does not change and store the result. My hallway is static, and the GPU frame was already under 3 ms with a budget of about 0.3 ms for this one effect, so I chose to bake.

## Step one: irradiance probes

### What a probe stores

A probe is a sample point in space that stores the irradiance for every direction `n`. A surface looks up the probes near it and blends them.

> **Background: Spherical harmonics.** Spherical harmonics (SH) are to functions on a sphere what a Fourier series is to functions on a line. A function of direction is written as a sum of basis functions grouped into *bands*. Band 0 is one constant. Band 1 has three functions that vary linearly with direction. Band 2 has five. Three bands give nine coefficients per colour channel, 27 numbers for an RGB probe. The basis functions in each band are smoother than those in the next, so truncating the sum keeps the large, slow features of the function and drops the detail.
>
> Truncation is safe for irradiance because irradiance is radiance *convolved* with the cosine lobe `max(0, n . w)`, and that lobe is very smooth. In SH, convolution is a per-band multiplication, and the cosine lobe's band factors fall off quickly (pi, then 2pi/3, then pi/4, then zero for band 3). Ramamoorthi and Hanrahan showed in 2001 that nine coefficients reproduce diffuse lighting within a few percent for typical environments. That is why low-order SH is a standard way to store diffuse light: the cosine lobe removes the detail that a low order cannot hold. Its weakness is very high contrast. A bright lamp beside a dark wall makes the truncated series ring, producing negative lobes and a wrong glow on the far side.

I did not use SH. My probes store the irradiance as a small 6 by 6 *octahedral map*: the sphere of directions is projected onto an octahedron, unfolded into a square and stored as a texture, and each of the 36 texels holds the already cosine-convolved light for the direction it represents (divided by pi, so a surface's indirect light is simply `albedo * value`). The engine's probe code follows the DDGI approach. I chose it for three reasons:

- The GPU can filter it with ordinary bilinear sampling. A one-texel border around each tile copies the opposite edge of the octahedron's fold, so filtering across the seams is correct.
- The shader reads a value and does not evaluate basis functions.
- It holds more directional contrast than nine coefficients, at a similar storage cost (36 RGB texels against 27 numbers).

### Baking

The bake places probes on a 3D grid through the whole house, 0.6 m apart, which gives 6,144 of them. For each probe, a ray tracer I wrote on the CPU shoots 192 rays, spread evenly over the sphere with a spherical Fibonacci sequence. For each ray:

1. It finds the first surface hit, using a bounding volume hierarchy over the scene's triangles.
2. It lights that point with all 12 lamps, casting a shadow ray toward each, and takes the surface's average colour from its material.
3. For later bounces, it adds the light that the probes already computed would give that point.

The cosine convolution is then a Monte Carlo sum for each texel direction `t`: the sum of `max(0, t . d) * L` over the rays `d`, scaled so that equal solid angles are weighted equally. Each probe also stores, for 8 by 8 directions, the mean and the mean of the square of the distance to the nearest surface.

I checked the baker against physics. A probe above a lit floor matches a numerical integral of the same setup (0.06290 against 0.06290). A wall between the light and the probe leaves it dark. Extra bounces add less each time, at the rate the albedo predicts. A BVH answers exactly like testing every triangle over 3,000 random rays, and 1 or 6 threads give identical bytes. The demo bakes in 2.6 s in a Debug build and the file is about 4 MB.

### Looking up the light without leaks

At run time, each pixel finds the eight probes of the grid cell around it and blends them trilinearly. A probe on the other side of a wall would pour light through it, so each of the eight weights is multiplied by a visibility term built from the stored distances.

> **Background: Chebyshev visibility.** Given the mean `m` and mean of the square `s` of the distance to the nearest surface along a direction, the variance is `s - m*m`. If the shaded point is farther from the probe than `m`, Chebyshev's inequality gives an upper bound on the chance that the point is visible: `p = var / (var + d*d)`, with `d` the excess distance. A point nearer than the surface is fully visible. I use `p` cubed to make the cut-off sharper. A second weight reduces probes that lie behind the surface, `((cos + 1) / 2)^2 + 0.2`, so a thin feature does not lose all its light.

Probes that fall inside a wall are marked invalid, and their distance maps are zeroed, which makes their visibility zero.

![The bounce light alone](/images/2026-09-29-light-that-bounces/indirect-only.jpg "Debug view 16, the bounce light on its own. Light gathers near the lamps and on the floor and fades into the far end.")

### Cost

My first version looked up eight probes for every pixel at full resolution and cost 0.7 ms at 1440p, against a budget of 0.3 ms. Indirect diffuse light is smooth, so it does not need full resolution. It now runs in a compute pass at half resolution, and the scene pass upsamples it with weights that compare depths, so the edge between a near and a far surface stays sharp. The pass costs 0.09 ms, plus 0.05 ms in the fog, which now takes its glow from the probes as well, so the haze brightens near lit walls and stays dark in dark corners.

### Mistakes and limits

The first run crashed straight after uploading the probe textures. The renderer waited for the GPU in the middle of building a frame, which confused its deferred-release bookkeeping, so it freed a texture that the GPU still used. D3D12's debug-layer messages normally go only to an attached debugger, so I had never seen them. I now route them into the engine log in Debug builds, and the probe textures retire after a few frames.

Baked light is frozen. If a script switches a lamp off, its direct light disappears but the glow it left on the ceiling stays. The bake file already stores light in layers with a brightness the game can change, and this bake writes one layer holding every lamp. Baking one layer per lamp is planned for when scripting arrives. A bake is also valid only for the scene that produced it, so it records a fingerprint of the walls, props, materials, lamps, ambient and volume, and the status bar shows "Lighting stale" when the scene no longer matches. Camera and post-processing changes do not count.

With real bounce light the materials started to matter. The plaster reflected about 15% of the light and the floor's tint made the wood reflect about 0.5%. I changed the plaster tint to (0.62, 0.62, 0.56) and the floor to (1.0, 0.8, 0.6), made the lamps warm white with a reach of 8 m instead of 4.7 m at twice the intensity, and moved exposure compensation from -2.5 to -2.0 EV. Across the four benchmark poses, the 5th percentile of pixel brightness rose from 0.007–0.012 to 0.019–0.040 (the reference measures 0.048), and the median from 0.055–0.066 to 0.078–0.085. The shadowed walls became readable.

![The probe volume in the editor](/images/2026-09-29-light-that-bounces/editor-probe-volume.jpg "The probe volume selected in the editor: each dot is a probe tinted by its stored light. Red probes are inside walls or outside the building and are ignored.")

![The six benchmark views after the bake](/images/2026-09-29-light-that-bounces/bench-after.jpg "After: the corridor reads as one connected space and the shadowed walls are no longer flat.")

## Step two: reflection probes

A shiny surface also reflects its surroundings, and that is specular indirect light. I already had screen-space reflections (SSR), which trace the depth buffer and can only reflect what is on screen. Looking down at the floor, the lamps behind the camera vanished from it. The fallback was the soft bounce light, as if the room were an evenly lit fog.

> **Background: Cube maps and roughness mips.** A *cube map* is six square images, taken from one point in the directions +X, -X, +Y, -Y, +Z and -Z. Together they form a picture of the whole environment. A perfectly smooth surface reflects the environment in the mirror direction `R = reflect(-view, normal)`, so it reads the cube map along `R`. A rough surface scatters light into a lobe around `R` whose width grows with roughness, so it should read a *blurred* version of the environment. Prefiltering stores the cube map several times, each copy convolved with the lobe of the GGX distribution for one roughness. These are the mip levels, with the sharpest at mip 0. At run time the shader picks the mip from the surface's roughness and interpolates between two. Each mip is smaller than the last, because blurred images need fewer texels.

My probes are 128 by 128 per face. They have six mips (128, 64, 32, 16, 8, 4) and mip `m` holds roughness `m / 5`. I bake them on the CPU with the same ray tracer: each of the six probes traces its six faces, lights each surface with all 12 lamps with shadows plus the baked bounce light, then filters the mips by importance-sampling the GGX lobe. The lamp shades appear in the picture as glowing geometry that is visible to the camera rays but casts no shadow, otherwise they would block their own light. Six cubes bake in 3.6 s in a Debug build and the file is 3.1 MB. The demo has one probe for each corridor leg, one for the bedroom and one for the closet.

### Box projection

A cube map is only correct at the point where it was captured. My hallway is 17 m long, so a probe in the middle would show the wrong thing everywhere else.

> **Background: Parallax-corrected (box) projection.** Give each probe the box of its room. For a shaded point `P` and reflection direction `R`, find where the ray from `P` along `R` leaves the box, call it `H`, and read the cube map in the direction from the capture point `C` to `H`. The cube map was captured at `C`, so this is the direction in which `C` would see that part of the wall. The reflection then shifts correctly as the viewer moves along the corridor. The method is exact when the room really is a box and the surface seen is on its faces, and approximate otherwise.

![Box projection](/images/2026-09-29-light-that-bounces/box-projection.svg "Reading the cube map along the reflected ray gives the wrong wall. Reading it toward the ray's exit point H gives the right one.")

```text
t = min over the three axes of the distance along R to the box face
H = P + R * t
lookup = normalize(H - C)
```

Where probe boxes overlap, such as at the corridor corners, the smaller box wins, and each probe fades out over 0.4 m past its box. SSR still has priority. Where it finds the reflection on screen it replaces the probe, and the probe fills in everywhere SSR cannot see: behind the camera, at the screen edges and off screen.

![The reflections alone](/images/2026-09-29-light-that-bounces/reflections-view17.jpg "Debug view 17, the ambient specular on its own. Left: the old even stand-in. Right: the probes. The corridor, its trim and the lamps are mirrored in the floor where they belong.")

My first version barely changed the picture. View 17 showed the reason: only the brass sconces had changed. A probe's influence fell to zero at the edge of its box, and a corridor's box is its walls, floor and ceiling, so every wall and floor pixel sat exactly on the edge. Influence is now full inside and on the box and fades only beyond it.

![A reflection probe in the editor](/images/2026-09-29-light-that-bounces/editor-reflection-probes.jpg "The south corridor's probe selected: its box follows the corridor's walls, floor and ceiling.")

The effect is subtle on rough plaster and a satin floor, because a non-metal reflects about 4% of light head-on (its Fresnel reflectance at normal incidence). It cost 0.135 ms per frame, all in the scene pass. The captured surfaces are diffuse only, so highlights on the captured walls are not in the picture. The lamps' own highlights still come from the lights, live. I expect the probes to show more once the floor has a lacquered finish.

## Workflow and results

Both bakes use one workflow. I add a Probe Volume or a Reflection Probe in the editor and choose Render > Bake Lighting (an MCP tool and a command-line tool run the same bake), and the files are written next to the scene. The measured GPU cost at 1440p over six poses, taken back to back because other applications kept the GPU busy:

| | GPU frame |
|---|---|
| Probes off | 2.23 ms |
| Irradiance probes at full resolution, first version | 2.96 ms |
| Irradiance probes at half resolution | 2.37 ms |

Compared with the previous benchmark the frame is 0.36–0.44 ms slower. The irradiance probes account for 0.14 ms, and the lamps' longer reach adds overlapping light in the scene pass and the fog.

It still does not match the reference, and I know why. Bounce light cannot add bare bulbs, a narrow corridor, lit trim, props or a herringbone floor. That is content, so materials came next.
