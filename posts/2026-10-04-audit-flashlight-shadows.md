---
title: A renderer audit, a faster frame and a new origin for the flashlight's shadow
date: 2026-10-04
order: 1
summary: I audited the recent renderer and baker code and fixed about 20 bugs, made the house frame 12 to 20 percent faster, tied lamp globes and reflections to their lamps and moved the flashlight's shadow origin.
tags: performance, renderer, shadows
cover: /images/2026-10-04-audit-flashlight-shadows/shadow-origin.jpg
---

In four days I had added parallax mapping, lightmaps, clustered lighting and switchable lamps. Before starting on physics I stopped to check that work for bugs, to measure where the frame time goes, and to deal with two problems left open by the previous post. Later the same day I fixed a flashlight shadow that looked like part of the furniture.

## Finding bugs

I split the review into four reads: the lighting bakers, the shaders, the renderer's C++, and the scene, editor and runtime code that connects them. I also made the Debug build able to run with D3D12's GPU-based validation, switched on by an environment variable.

> **Background: GPU-based validation.** The D3D12 debug layer normally checks the calls the CPU makes: a wrong resource state, a missing barrier, a bad descriptor. It cannot see what a shader reads while it runs, because that happens on the GPU. GPU-based validation instruments the shaders so that they report out-of-range reads and descriptors that point at the wrong kind of resource or one in the wrong state. It runs far slower, so it is for tests and not for play.

It found one real problem: the light-cookie texture was in the wrong state when the fog's compute pass read it. In all, I fixed about 20 bugs. The ones that mattered:

- **Uploads freed too early.** A texture or mesh is copied to the GPU from a staging buffer, and the CPU may free that buffer only after the GPU has finished the copy. The renderer waited for the GPU in the middle of a frame in a few places, such as when the UI's buffers grew and when a colour lookup table loaded. After such a wait, the next frame could free the staging buffers of meshes and textures while the GPU was still copying from them.
- **Bake descriptors rewritten while in use.** A descriptor is a small record that tells the GPU where a texture is. A new bake rewrote the descriptors for probes, lightmaps and reflections while the previous frame, still running on the GPU, was reading them. The result was a one-frame flash.
- **Bakes not marked stale.** Editing a light's clip box, re-exporting a mesh or saving a material left the bakes reported as current. The bake's key now covers all three.
- **Later bounces scaled twice.** The lightmap's later bounces were multiplied by the probe volume's intensity once in the bake and again at run time.
- **Probe volumes matched by position and not by id.** Switching one volume off handed its intensity to another.
- **A corrupt bake file could crash the loader** by claiming a size of gigabytes. Files are now checked against their length.
- **Scripts could pass infinity or NaN** to a light or a transform.

> **Background: NaN.** NaN, "not a number", is what a floating-point value becomes after an operation such as 0/0 or infinity minus infinity. Any arithmetic that touches a NaN gives a NaN, and comparisons with it are false. Temporal anti-aliasing blends each frame with the previous ones, so one NaN pixel is blended back in every frame and does not leave. Bloom blurs each pixel into its neighbours, so one NaN spreads across a patch. In the bake it poisons the bounce layers. A script that sets a light's intensity to NaN could therefore leave a permanent dark patch on screen. The fix is to clean values where they enter the engine, because finding the source from a black patch on screen is far slower.

Smaller fixes included an out-of-range read in the exposure histogram, a NaN at the screen's edge in the contact shadows, a motion-vector smear after reloading a scene and the post-processing pass's scissor rectangle.

## Making the frame faster

I started by measuring. I added GPU timers that split the 3 to 4 ms scene pass into the depth prepass, the light clusters and the opaque shading, and a CPU timer for recording the frame.

> **Background: measuring by ablation.** A GPU profiler tells you which pass is slow, but inside one large shader it cannot easily say which lines are. A simple method is to switch one feature off at a time, with a shader constant that skips it, and see how much the pass time falls. It is crude, because removing one part changes the cost of the others, but it ranks the parts.

Switching parts of the opaque shader off in turn showed that direct lighting is about 60 percent of its time, shadow-map lookups alone 27 to 41 percent and reflection probes 8 to 15 percent. Then I changed four things.

**Shadow loops.** Using fewer shadow taps saved nothing, so the number of reads was not the cost. The cost was registers, the same effect I found in the rectangle-light shader: the unrolled 12-tap filter kept every tap's coordinates alive at once, which took 42 registers, and with fewer registers per pixel the GPU can keep more pixels in flight. The loops stay rolled now and the filter needs 31. The image is identical and the opaque pass is 3 to 5.5 percent faster.

**Fog and contact shadows read the light clusters.** Both looped over every light in the scene, 26 in the house, for each fog cell or pixel, although the per-cluster lists built earlier in the frame already say which lights matter. Using the lists made the fog 38 percent faster in the house, and the contact shadows 2 times faster in the hallway and 4 times faster in the house.

**A front-to-back depth prepass.**

> **Background: the depth prepass and early depth testing.** Before shading anything, the renderer draws all geometry once and writes only depth. The main pass then shades a pixel only where its surface matches the stored depth, so each pixel is shaded once, however many surfaces overlap it. The prepass is cheaper than shading, but not free: its pixel shader still reads material textures, for example for cut-out edges, and the GPU can skip that work for a pixel whose depth already fails the test. That depends on drawing order. If a far wall is drawn first and a near wall after it, the far wall's pixels are all processed and then replaced. Drawn nearest first, the far wall's pixels fail the test and are rejected early.

My prepass drew objects in scene order, so the far rooms of the house were drawn and then covered. Sorting by distance to each object's nearest point, with instances inside a batch following the same order, made the house prepass 52 percent faster.

**Debug views in their own pipelines.** This halved the shipping shader's code. It saved little time, since the driver already removes unused code, but debug views can now grow without slowing the game.

Benchmark repeatability needed one change. Temporal anti-aliasing and the fog both keep history from earlier frames, so a pose's result depended on the poses before it. Each pose now starts its histories over, and the hallway benchmark became repeatable. Anti-aliasing can still leave about 1/255 of difference along edges between runs, so I checked each speed change with it off, where two runs agree exactly.

| | Before (summed over poses) | After | Per pose |
|---|---|---|---|
| House, frame | 37.9 ms | 31.1 ms | -0.46 to -0.89 ms (-12% to -20%) |
| House, slowest pose (landing) | 4.63 ms | 3.74 ms | |
| Hallway, frame | 21.8 ms | 20.8 ms | -0.10 to -0.32 ms (-2.5% to -8%) |

The benchmark ran in Release at 1440p on an RTX 4070. On a GPU 1.7 times slower, the house's slowest pose would take about 6.4 ms, well inside the 16.6 ms budget for 60 frames per second. The CPU spends 0.4 to 0.9 ms recording a frame.

## Lamp globes and reflections that follow their lamp

The previous post ended with two open problems.

**Bulb glow.** A lamp's glass globe is a separate mesh with an emissive material, so it glowed at full strength while the lamp's light guttered or was off. Meshes under a lamp entity now glow in proportion to their light: the game scales their emissive value by the light's intensity now divided by its authored intensity. This works for every lamp, not only switchable ones.

![The wall lamp's globe before and after, as the lamp gutters](/images/2026-10-04-audit-flashlight-shadows/bulb-glow.jpg "The closet scare makes two lamps gutter. Before (left), their globes stay fully lit. After (right), the globes dim with their light.")

**Reflections.** The baked reflection cubes are small environment maps captured at points in the house, and glossy surfaces read them. They had been captured with every lamp lit, so a lamp that was off still appeared in them. The bake now records, for each cube, how much of its light comes from each switchable lamp, using small extra captures with only that lamp on. At run time the cube's brightness is multiplied by `1 + share * (scale - 1)`, where `scale` is the lamp's current brightness relative to the baked brightness. A lamp that supplies 70 percent of a cube's light, switched off, leaves the cube at 30 percent. The multiplier is applied when the cube's weight is computed, so it costs nothing on the GPU.

![The reflection probes beside a lamp, on and off](/images/2026-10-04-audit-flashlight-shadows/reflections-lamp-off.jpg "The reflection probes alone beside a lamp, with the lamp on (left) and off (right). The mean brightness falls from 27.7 to 8.1; the other lamps' reflections remain.")

This dims the whole cube, not only the region where the lamp's light falls. A separate cube for each lamp would be exact, at up to four times the memory.

## The flashlight shadow that looked like part of the chair

I noticed shadows that looked like part of the object casting them. Behind a dining chair, a dark slab stuck out above and to the left of the chair's back, as if the chair were larger than it is.

I found the cause with debug views. It was not in the fog, the ambient occlusion or the indirect light, because it was in the lighting-only view, which makes it direct light. Switching the flashlight off removed it, and holding the flashlight at the eye hid it behind the chair. So it was the flashlight's shadow.

The shadow was geometrically correct, which is why it looked wrong. I hold the torch at the hip, 26 cm right of the eye and 28 cm below it. I had chosen that on purpose, because a light at the eye hides every shadow behind the object that casts it. From the hip, every shadow falls up and to the left of its caster. The torch was also close to a point, a fixed 3 cm source, so the shadow was a hard, almost black outline, the same tone as the dark wood it touched.

### First pass: position and lens

I changed three things:

- The torch is held at the shoulder, 18 cm right and 14 cm below the eye.
- The lens became a setting, `flashlight.sourceRadius`, at 8 cm. Contact-hardening shadows then keep the shadow sharp where it meets the chair and soften it with distance. The penumbra is `lightRadius * (receiver - blocker) / blocker`, so a larger lens makes it wider.
- The flashlight gets twice the soft-shadow limit that lamps have. The limit in texels, `shadow.maxPenumbraTexels`, clamped the softness away, and raising it for everything would soften every wall lamp's shadow too. The flashlight is the only light with a single shadow face, since lamps use six, which is how the shader tells it apart.

![The chair's shadow before and after the first change](/images/2026-10-04-audit-flashlight-shadows/chair-shadow-before-after.jpg "Before (left): a hard slab above the chair back. After (right): a soft shadow close behind it.")

![Torch position and lens size variants](/images/2026-10-04-audit-flashlight-shadows/torch-variants.jpg "Variants at the same pose. Top left: as it was. Top right: at the shoulder. Bottom left: at the shoulder with an 8 cm lens, the one I kept. Bottom right: a 15 cm lens, too soft; the shadow almost disappears.")

### Second pass: where the shadow map is rendered from

A closer view, looking down at a chair, showed the shadow still sticking out beside the chair back like a fin. This follows from holding a light away from the eye, and the geometry shows why.

![Why a torch held below the eye shows a shadow beside the object](/images/2026-10-04-audit-flashlight-shadows/shadow-geometry.svg "A top view. The eye cannot see the wall behind the object (grey). The torch's shadow (gold) falls beside that strip, so all of it is visible.")

The eye sees the wall except for the strip the object hides, and that strip is exactly where a light at the eye would cast its shadow. A light at a different point casts its shadow somewhere else, and any part of the shadow outside the hidden strip is visible. The visible part is a strip along one side of the object's outline, about as wide as the torch is far from the eye. Softening its edge does not change that; you still see a dark band.

The fix is one that games use. The light still comes from the hand, but the shadow map is rendered from a point 35 percent of the way from the eye to the torch (`flashlight.shadowOffsetScale`, 0.35). In the diagram's geometry, that point leaves about half of the shadow visible, a thin rim, enough to show that a shadow exists. At 0 the shadows hide entirely and the scene looks flat, and at 1 the fin is back. The cost is nothing, since two benchmarks were within 0.01 ms per pose.

The trade-off is that the shadow is slightly wrong: it is not the shadow of the light as placed. I judged that a better trade than a shadow that reads as geometry.

![The shadow origin at the hand, at 0.35 of the way and at the eye](/images/2026-10-04-audit-flashlight-shadows/shadow-origin.jpg "Looking down at a chair. Left: shadows from the hand, with the fin. Middle: from 0.35 of the way, the one I kept. Right: from the eye, with no visible shadow.")

## Results and open issues

The shoulder torch with the larger lens costs 0.04 to 0.09 ms a frame (1 to 2 percent), because more pixels fall in a soft edge and run the full shadow filter, where before they stopped early as fully lit. The audit had saved 0.5 to 0.9 ms per pose just before, so the frame is still well ahead.

Issues from the reviews that I did not fix:

- The lightmap bake is not exactly repeatable, because of thread timing, so each bake rewrites the committed files slightly.
- Every switchable layer re-traces the probes' primary rays and reloads the meshes, which adds to the bake time.
- Glass picks up the occlusion and probe light of the surface behind it.
- With more than 127 lights, which lamps get shadow maps becomes ambiguous.
- The CPU shadow pass re-tests every caster against every face each frame, even when everything is cached. At 0.4 to 0.9 ms for the whole frame it is acceptable, but I should fix it before scenes grow.

Next up was physics.
