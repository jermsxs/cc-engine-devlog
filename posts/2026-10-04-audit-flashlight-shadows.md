---
title: An audit, and shadows that read as shadows
date: 2026-10-04
order: 1
summary: A bug hunt across the renderer and bakers, a frame 12 to 20 percent faster, and a flashlight whose shadows stop looking like part of the furniture.
tags: performance, renderer, shadows
cover: /images/2026-10-04-audit-flashlight-shadows/shadow-origin.jpg
---

A lot of code had gone into the renderer and the bakers in a few days: parallax, lightmaps, clustered lighting, switchable lamps. Before starting the next phase (physics), I stopped to check all of it for bugs, measure where the frame time goes, and tackle two problems the last post left open. Later the same day, I fixed a flashlight shadow that bothered me.

## Finding bugs

Four reviews read the recent code, one each for the lighting bakers, the shaders, the renderer's C++, and the scene, editor and runtime glue. I also made the Debug build able to run with D3D12's GPU-based validation, which checks what shaders actually read from memory. It found one real problem: the light-cookie texture was in the wrong state for the fog's compute pass.

About 20 bugs got fixed. The ones that mattered:

- **Uploads freed too early.** When the renderer waited for the GPU in the middle of a frame, the next frame could free the staging buffers of meshes and textures while the GPU was still copying from them.
- **Bake descriptors rewritten while in use.** A new bake rewrote the probe, lightmap and reflection descriptors while the previous frame was still reading them. That is a one-frame flash.
- **Bakes not marked stale.** Editing a light's clip box, re-exporting a mesh or saving a material left the bakes reported as current.
- **Later bounces scaled twice** by the probe volume's intensity, once in the bake and once at run time.
- **Probe volumes matched by position, not id,** so switching one volume off handed its intensity to another.
- **A corrupt bake file could crash loading** by asking for gigabytes. Files are now checked against their length.
- **Scripts could pass infinity or NaN** to a light or a transform, which poisoned the bounce layers, bloom and temporal anti-aliasing.

> **Note: What "NaN" does to a renderer.** NaN ("not a number") is what a float becomes after something like 0/0. It is contagious: any arithmetic that touches it gives NaN. In a renderer that blends frames over time, one NaN pixel can smear across the screen and never leave, because every later frame blends it back in. Cleaning inputs at the door is cheaper than hunting black holes later.

## Making the frame faster

New GPU timers split the 3 to 4 ms scene pass into the depth prepass, the light clusters and the opaque shading. Switching parts of the opaque shader off one at a time showed where its time goes: direct lighting about 60 percent, shadow-map lookups alone 27 to 41 percent, reflection probes 8 to 15.

- **Shadow loops.** Using fewer shadow taps saved nothing. What cost was registers: the unrolled 12-tap filter kept every tap's coordinates alive at once (42 registers; 31 now). The image is identical and the opaque pass is 3 to 5.5 percent faster.
- **Fog and contact shadows read the light clusters.** Both looped over every light in the scene (26 in the house) for every cell or pixel, though the per-cluster lists already existed. The fog is 38 percent faster in the house, and contact shadows 2 times faster in the hallway and 4 times in the house.
- **Front-to-back prepass.** The depth prepass drew objects in scene order, so far rooms were shaded and then covered. Drawn nearest first, the later, hidden objects fail the depth test cheaply and the house prepass is 52 percent faster.

> **Concept: The depth prepass.** Before shading anything, the renderer draws all geometry once, writing only depth. Then the expensive shading pass runs only for the surface that ended up in front at each pixel. Drawing the nearest objects first makes the prepass itself cheaper, because the GPU can reject hidden pixels early.

Debug views moved into their own pipelines, which halved the shipping shader's code. That saved little time (the driver already strips most of it), but views can now grow freely.

Each benchmark pose also now starts its temporal histories over. That made the hallway benchmark repeatable. Temporal anti-aliasing can still leave about 1/255 of difference along edges between runs, so each speed change was checked with it off, where benchmarks repeat exactly.

| | Before (summed over poses) | After | Per pose |
|---|---|---|---|
| House, frame | 37.9 ms | 31.1 ms | -0.46 to -0.89 ms (-12% to -20%) |
| House, slowest pose (landing) | 4.63 ms | 3.74 ms | |
| Hallway, frame | 21.8 ms | 20.8 ms | -0.10 to -0.32 ms (-2.5% to -8%) |

On a GPU roughly 1.7 times slower than mine, the slowest pose would be about 6.4 ms, well within a 60 fps budget of 16.6 ms.

## The two open problems

**Bulb glow.** A lamp's glass globe glowed at full strength while its light guttered or was off. Meshes under a lamp entity now glow with their light: the game scales their emissive by the light's intensity now compared with the scene's. That applies to every lamp.

**Reflections.** The baked reflection cubes kept a switched-off lamp's light. The bake now records how much of each cube's light comes from each switchable lamp (from small extra captures), and the renderer dims the cube by that share when the lamp dims, at no GPU cost. It dims the whole cube rather than only where the lamp's light falls, so a per-lamp cube would be more exact at up to four times the memory.

![The reflection probes beside a lamp, on and off](/images/2026-10-04-audit-flashlight-shadows/reflections-lamp-off.jpg "The reflection probes alone beside a lamp, lamp on (left) and off (right). The average brightness drops from 27.7 to 8.1; the other lamps' reflections stay.")

## The flashlight shadow that looked like part of the chair

I noticed shadows that looked like part of the object casting them. Behind a dining chair, a dark slab stuck out above and to the left of the chair's back, as if the chair were bigger than it is.

Finding it, one debug view at a time: it was not in the fog, the ambient occlusion or the indirect light. It was in the lighting-only view, so it was direct light. Turning the flashlight off removed it, and holding the flashlight at the eye hid it behind the chair. So it was the flashlight's shadow.

It was geometrically *right*, which is why it looked so wrong. The torch is held at the hip, 26 cm right of the eye and 28 cm below it. I did that deliberately, because a light at the eye hides every shadow behind its object. But from the hip every shadow falls up and to the left of what casts it. And the torch was nearly a point (a fixed 3 cm source), so the shadow was a hard, near-black outline the same tone as the dark wood touching it.

The first fix had three parts:

- hold the torch at the shoulder (18 cm right, 14 cm down);
- make the lens a setting, `flashlight.sourceRadius`, at 8 cm, so contact hardening (from the previous days) keeps shadows sharp where they meet the chair and softens them with distance;
- give the flashlight alone twice the soft-shadow limit. Raising the limit for everything would soften every wall lamp's shadow, and the flashlight is the only light with a single shadow face (lamps use six), which is how the shader tells it apart.

![Chair shadow before and after the first fix](/images/2026-10-04-audit-flashlight-shadows/chair-shadow-before-after.jpg "Before (left): a hard slab above the chair back. After (right): a soft shadow close behind it.")

![The torch's position and lens size variants](/images/2026-10-04-audit-flashlight-shadows/torch-variants.jpg "What I tried at the same pose. Top left: as it was. Top right: at the shoulder. Bottom left: at the shoulder with an 8 cm lens (chosen). Bottom right: a 15 cm lens, too soft; the shadow almost disappears.")

### The second pass

A closer look, down at a chair, showed the shadow still sticking out beside the chair back like a fin. That is inherent to a torch held away from the eye.

> **Theory: What part of a shadow can you see?** From the eye, you only see the strip of shadow that the object does not cover, and that strip always hugs one side of the object's outline. It is as wide as the torch is far from the eye. Softening its edge does not change that: you still see a dark band beside the object.

The fix is a trick common in games. The light still *comes from* the hand, but the shadow map is rendered from a point a third of the way from the eye to the torch (`flashlight.shadowOffsetScale`, 0.35). Shadows keep a thin, soft rim, enough to show they exist, and stop reading as part of the object. At 0 they hide entirely and the scene looks flat; at 1 the fin is back. It costs nothing (two benches within 0.01 ms per pose).

![The shadow origin at the hand, at 0.35 of the way and at the eye](/images/2026-10-04-audit-flashlight-shadows/shadow-origin.jpg "Looking down at a chair. Left: shadows cast from the hand, with the fin. Middle: from 0.35 of the way (chosen). Right: from the eye, with no visible shadow.")

## Where it ended

The shoulder torch with a bigger lens costs about 0.04 to 0.09 ms a frame (1 to 2 percent), because more pixels now fall in a soft edge and run the full shadow filter. The audit had saved 0.5 to 0.9 ms per pose just before, so I am well ahead.

Not fixed yet, from the reviews: the lightmap bake is not exactly repeatable because of thread timing, every switchable layer re-traces the probes' primary rays, glass picks up the occlusion and probe light of the surface behind it, and more than 127 lights confuses which lamps get shadow maps. The CPU shadow pass also re-tests every caster against every face each frame, even when everything is cached. That is fine at 0.4 to 0.9 ms for the whole frame, but worth fixing before scenes grow. Next up: physics.
