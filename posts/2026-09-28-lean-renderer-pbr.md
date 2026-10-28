---
title: A leaner renderer and one physically based lighting model
date: 2026-09-28
order: 3
summary: I cut GPU time by about 45% with no visible change, then replaced the hallway-specific shader code with one GGX lighting model.
tags: renderer, lighting, performance
cover: /images/2026-09-28-lean-renderer-pbr/closet-door.jpg
---

By 28 September the engine drew a convincing dark hallway, but the scene shader knew which hallway it was drawing. It contained the corridor's coordinates, its floor and ceiling heights, reflection streaks painted onto the floor, lamp pools painted onto the walls, contact darkness at known seams and a hand-built flashlight. The result looked right from the angles I had tuned and would not work in any other room. The editor I am building has to light any room, so the shader had to stop depending on this one.

I started a block of work toward the Resident Evil 7 and Village look, with a budget of about 11 ms per frame at 1440p on an RTX 3060-class GPU. It had two steps. The first made the renderer cheaper without changing the picture. The second removed the hallway-specific code and lit every surface with one physically based model.

## Measuring first

Film grain and the flashlight flicker both read the clock, so two runs of the same build never produced the same image. I changed the benchmark to freeze shader time. Two runs of one build now match pixel for pixel, and timings repeat within about 1%. Every change below was compared against the previous commit for GPU time and for pixel differences. The numbers in this post come from a Debug build on an RTX 4070 at 1440p, rendering six fixed camera poses.

## Where the time went

The cost of a forward renderer is roughly the vertices it transforms plus the pixels it shades, and the pixel shader here was the expensive part. Most of the gain came from shading fewer pixels and submitting less geometry.

> **Background: Culling and the depth test.** A triangle has a front and a back, decided by the winding order of its vertices on screen. The back faces of a closed mesh point away from the camera and are always covered by front faces, so rasterising them wastes work. *Back-face culling* drops them before shading. *Frustum culling* works on whole objects: each object's bounding box is tested against the six planes of the camera's view volume, and an object entirely outside is never submitted. Last, the GPU can run the *early depth test*: if a nearer surface is already stored at a pixel, the new fragment is rejected before its pixel shader runs. That only works if the shader cannot change the outcome. A shader containing `discard` may throw the pixel away, so the hardware cannot write depth early and the optimisation is lost for everything drawn with that shader.

**Back-face culling.** Every triangle was being drawn from both sides. The old shader also discarded some floor and wall faces per pixel, which disabled the early depth test for all of them. Those discards depended only on which face was being drawn, so the CPU now skips those faces instead, and the picture stays identical. Opaque draws cull back faces. Double-sided glTF materials and mirrored objects use a separate two-sided pipeline, and a separate alpha-tested pipeline is the only one that may discard. This was the largest single gain: the scene pass became 28 to 50% faster.

**Frustum culling.** At the starting pose, 25 of the 70 objects are drawn. Shadow casters get the same test against each light's frustum. The counts appear in the window title, the editor's Profile panel and the MCP `render_stats` tool.

**A depth prepass.** In a forward renderer a pixel can be shaded several times: a far wall is shaded, then a nearer door is drawn over it. This is overdraw. A depth prepass draws all opaque geometry once with a vertex shader only, which fills the depth buffer. The lighting pass then runs with the depth known, and each visible pixel is shaded once. The cost is submitting the geometry twice, and the prepass has to use the same vertex shader as the main pass so the depths match exactly. The roadmap said to add it only if it measured faster. It did, by another 3 to 26%, mostly in the long corridor views where many surfaces line up behind each other.

The remaining changes were smaller:

- Mesh names are turned into small integer handles once, when the scene changes. The renderer had been building a list with a quadratic search and looking up each object's mesh by name two or three times a frame.
- A material or buffer bind is skipped when nothing changed.
- The shadow map is redrawn only when a light or a shadow caster moves.
- The per-object constant buffer ring used to drop objects past 512 without a message. It now waits for the GPU, grows and logs a warning.
- The "Light Scale" slider did nothing, because the value reached the shader but only inside a check that never passed. I had tuned the demo at 0.06 while that was true, so I set the scene to 1.0, which gives the same picture. The engine now multiplies every lamp by it.

![Light Scale at 1.0 and at 0.4](/images/2026-09-28-lean-renderer-pbr/light-scale.jpg "Light Scale 1.0 on the left, 0.4 on the right. Before the fix, both looked like the left one.")

| Pose | GPU frame before | after |
|---|---|---|
| south_start | 5.93 ms | 2.88 ms (−51%) |
| east_closet_door | 4.70 ms | 2.96 ms (−37%) |
| north_corridor_long | 5.87 ms | 2.98 ms (−49%) |
| north_locked_door | 5.02 ms | 2.78 ms (−45%) |

The picture changed very little. At most 196 of 3.7 million pixels differ per pose, all at seams where two coplanar faces tie in depth and the later one now wins. I confirmed that by turning culling off again: the images then matched exactly.

## How physically based shading works

After the culling work, the scene shader was still the old one. To replace it I needed a model that behaves correctly for any light and any material. This section covers the theory, then my implementation.

### Light leaving a surface

For each pixel the renderer computes radiance: the light travelling from the surface point toward the eye. The rendering equation describes it in words as the light the surface emits, plus, summed over every direction `l` in the hemisphere above the surface, the radiance arriving from `l` times the surface's reflectance for that pair of directions times the cosine of the angle between `l` and the normal `n`.

```
Lo(v) = Le(v) + ∫ f(l, v) · Li(l) · (n·l) dl
```

The cosine term exists because light arriving at a grazing angle is spread over a larger area of surface. A point light or spot light arrives from a single direction, so the integral reduces to a sum with one term per light. For each light I compute how much light arrives (intensity, falloff, cone, shadow) and evaluate the reflectance function `f` once. The forward pass is that loop.

### The BRDF

`f` is the bidirectional reflectance distribution function (BRDF). For light arriving from direction `l`, it gives the share that leaves toward direction `v`. A plausible BRDF obeys two rules. Reciprocity means swapping `l` and `v` gives the same value. Energy conservation means the integral of `f · (n·l)` over all `l` is at most 1, because a surface cannot return more light than it receives. My tests check both.

I split `f` into a diffuse part and a specular part.

**Diffuse** light enters the material, scatters and leaves in an effectively random direction, so the surface looks the same from every angle. I use the Lambert model, `albedo / π`. The `π` normalises it: the cosine-weighted integral of a constant over the hemisphere is `π`, so an albedo of 1 returns exactly the light that arrived.

**Specular** light bounces off the surface itself. At microscopic scale even a smooth-looking surface is made of tiny facets, each a perfect mirror. A facet reflects light from `l` toward `v` only if its normal points along the half vector `h`, the normalised sum of `l` and `v`.

![The vectors n, l, v and h at a surface made of microscopic facets](/images/2026-09-28-lean-renderer-pbr/microfacet.svg "Only the facets whose normal equals the half vector h send light from l toward v.")

The standard microfacet form, due to Cook and Torrance, multiplies three terms:

```
f_spec = D(h) · F(v, h) · G(l, v) / (4 (n·l) (n·v))
```

- **D, the normal distribution**, is the share of facets whose normal is `h`. A rough surface has facets pointing in many directions, so `D` is wide and low. A smooth surface has a narrow, tall `D`.
- **F, Fresnel**, is the share of light reflected instead of absorbed, and it depends on the angle.
- **G, geometry**, is the share of those facets that are actually visible to both the eye and the light, rather than hidden behind neighbouring facets.

**GGX** is the `D` I use:

```
D(h) = α² / ( π · ((n·h)² (α² − 1) + 1)² )     with α = roughness²
```

Squaring the artist-facing roughness spreads the visible change evenly across the slider. What matters about GGX is its shape. It has a sharp core and a long, slowly falling tail, which matches measured highlights better than a Gaussian-like lobe. A lamp reflected in a glossy floor shows a bright centre inside a wide faint halo. I clamp roughness to 0.045 so the highlight never collapses to a single-pixel spike.

**Schlick's approximation** gives Fresnel cheaply:

```
F = F0 + (1 − F0) · (1 − v·h)^5
```

`F0` is the reflectance when looking straight at the surface. Every material tends toward full reflectance at grazing angles. Looking down at a wooden floor shows wood, and looking along it toward the far end of a hallway shows the lamps. In a long corridor that effect is large.

**Smith's `G`** accounts for facets masking each other. I use the height-correlated form, and I fold the `4 (n·l)(n·v)` denominator into it as a single visibility term, so the code evaluates `D · V · F`.

**Metalness** decides what colour the specular reflection has. Paint, plaster and wood are dielectrics: they reflect about 4% of light, untinted (`F0 ≈ 0.04`), and the rest becomes diffuse. A metal has no diffuse part, because the light that enters is absorbed, and it reflects with `F0` equal to its own colour. A material stores a metalness value, and the shader blends:

```
f0           = lerp(0.04, baseColor, metallic);
diffuseColor = baseColor * (1.0 - metallic);
```

The hallway has few metal parts, the lamp fittings and door knobs, but the same two lines cover them.

### Energy conservation in practice

Diffuse and specular share one budget of incoming light, and light the specular lobe reflects is not available to the diffuse lobe. A common approximation scales the diffuse term by `1 − F` for each light.

I wrote the BRDF once in HLSL and once in C++ so that I could test it. One test is a white furnace: a surface sits in a uniform environment of radiance 1, and the integrated reflection must not exceed 1 for any view angle. It uses GGX importance sampling to integrate the specular lobe. The test showed that the `1 − F` weighting let a white dielectric reflect up to 128% of the light it received at grazing angles. That factor describes one light direction, while the diffuse term has to leave room for the specular lobe's total reflectance at the current view angle. I now weight the diffuse term by `1 − EnvBRDF(F0, roughness, n·v)`, where `EnvBRDF` is Karis's analytic fit of the lobe's total directional reflectance. The worst case is now 105%, which is the error of the fit itself. I would not have found this without the test.

### Lights

Brightness follows the inverse square law, because a light's energy spreads over the surface of a sphere whose area grows with `d²`. I use a windowed form:

```
attenuation = saturate(1 − (d / range)^4)² / max(d², radius²)
```

The window forces the light to exactly zero at its range, so it has a finite reach with no visible edge. This is what allows a per-object light list and a finite shadow far plane. The `max` with the bulb radius stops the result going to infinity next to the lamp. Spot lights multiply by a smooth cone between an inner and an outer angle. A light with a physical radius also widens the highlight, by adding `radius / (2d)` to `α`, so a small bulb on a smooth floor stays a highlight instead of flickering as a one-pixel speck.

Up to 64 lights go to the GPU each frame. For each object the CPU chooses the 8 that matter most, ranked by brightness at the object's nearest point, with the flashlight always included. A light keeps its slot unless a newcomer is at least 10% stronger, so lights do not flicker in and out as the camera moves. The flashlight is an ordinary spot light in the same loop as the lamps. The ambient term is a two-colour hemisphere, sky for upward-facing normals and ground for downward-facing, run through the same diffuse and specular split, as a stand-in until baked indirect light exists.

## What I removed

Floors and walls became ordinary library materials. The Wood051 and Plaster004 textures now go through the same path as the glTF door and lamp, and box faces without authored UVs project the texture from the world axis they face. The scene shader went from 886 lines to about 250, and about 20 hallway-specific functions are gone. Eight render settings and the per-object `materialTuning` component no longer did anything and were retired. Old scene files still load, with a one-line log note, and saving drops the old keys. A shader test now fails if the retired hallway terms come back.

## A shadow problem the new model exposed

Once walls could cast shadows, the wall around each lamp darkened in a hard wedge. The wall was shadowing its own lit side: its front face sat at almost exactly the depth stored in the shadow map. I fixed it by drawing back faces into the shadow map. A wall is a closed box, so its back face lies 8 cm behind the lit face, and the lit surface now passes the depth comparison. The next post covers shadow maps in detail.

![A hard shadow wedge on the wall, and the same wall fixed](/images/2026-09-28-lean-renderer-pbr/shadow-wedge.jpg "Left: the lamp's own wall shadowing itself in a wedge. Right: the fixed, smooth pool.")

## Results

![The six hallway poses before the physically based shader](/images/2026-09-28-lean-renderer-pbr/lean-bench-after.jpg "The six bench poses with the hand-tuned shader, after the lean-out work: a flat flashlight disc and painted-on effects.")

![The same poses after the physically based shader](/images/2026-09-28-lean-renderer-pbr/pbr-bench-after.jpg "After the switch: the plaster and wood read, and the lamps make real pools of light.")

| Pose | GPU frame before | after | Scene pass before | after |
|---|---|---|---|---|
| south_start | 2.87 ms | 0.70 ms | 2.56 ms | 0.38 ms |
| east_closet_door | 2.94 ms | 0.66 ms | 2.63 ms | 0.35 ms |
| north_corridor_long | 2.95 ms | 0.68 ms | 2.63 ms | 0.36 ms |
| north_locked_door | 2.76 ms | 0.61 ms | 2.44 ms | 0.28 ms |

Together with the lean-out work, the start pose went from 5.93 ms to 0.70 ms. The forward pass now sits well inside its 2.5 ms budget on this card, which leaves room for shadows, ambient occlusion, reflections and fog. Every commit meant to keep the image unchanged was pixel-identical on the benchmark.

![A wall lamp grazing the plaster beside a closet door](/images/2026-09-28-lean-renderer-pbr/closet-door.jpg "Lamp light skimming the plaster brings out its relief, while the door and frame sit in the gloom.")

The picture is not finished. With the painted tricks gone, the floor lost its fake gloss, and the space between the lamps is flat and very dark. That was expected. Real shadows, ambient occlusion and reflections are the next steps, and the sconce glass still produces blocky bloom squares that the camera work has to address.
