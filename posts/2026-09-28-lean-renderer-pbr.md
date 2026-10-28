---
title: A leaner renderer and one honest lighting model
date: 2026-09-28
order: 3
summary: I cut about 45% of the GPU time with no visible change, then replaced my hallway-specific shader hacks with physically based lighting that works for any room.
tags: renderer, lighting, performance
cover: /images/2026-09-28-lean-renderer-pbr/closet-door.jpg
---

By this point the engine could already draw a convincing dark hallway. The trouble was how it did it. The scene shader knew it was drawing *that* hallway. It had the corridor's coordinates baked in, painted fake reflection streaks onto the floor and faked pools of lamp light on the walls. It looked fine from the angles I had tuned for and would fall apart in any other room.

I'm aiming for the look of Resident Evil 7 and Village, and I want to get there with a renderer that is both fast and honest. So I started a new stretch of work in two parts. First, make the renderer lean without changing the picture. Second, throw out the hacks and light everything with one physically based model.

## Making the renderer lean

You can't optimise what you can't measure, so the first job was a benchmark I could trust. Film grain and the flashlight flicker both read the clock, which meant two runs of the same build never produced the same image. I made the benchmark freeze time. Now two runs match pixel for pixel, and timings repeat within about 1%. After that, every change was checked against the one before it.

Here is what came out, roughly in order of payoff.

**Back-face culling.** A triangle has a front and a back. Every triangle was being drawn from both sides, even though the back of a wall facing away from you is never visible. Worse, the old shader threw away some floor and wall pixels with a `discard` instruction, and a shader that can discard switches off the GPU's *early depth test*, the trick where a pixel is rejected before the expensive shading runs. Those discards turned out to depend only on which face was being drawn, so the CPU now simply skips those faces. Opaque draws cull back faces, and only a separate alpha-tested pipeline is allowed to discard. This was the single biggest win, making the main scene pass 28 to 50% faster.

**Frustum culling.** Each object has a bounding box. If that box is entirely outside the camera's view volume (the *frustum*), there's no point sending the object to the GPU. At the starting pose, 25 of 70 objects are drawn. Shadow casters get the same test against the light's view.

**A depth prepass.** The roadmap said to add one only if it measured faster, and it did. The idea is to draw all opaque geometry once with a trivial depth-only shader. Then, when the expensive lighting shader runs, the GPU already knows the nearest surface at every pixel and shades each pixel exactly once. Overdraw (shading something that a wall then covers) goes away. It bought another 3 to 26%, mostly in the long corridor views where lots of surfaces line up behind each other.

**Less bookkeeping.** Each frame the renderer was looking up meshes by name, sometimes two or three times per object, and building a list with a quadratic search. Names are now turned into small numbers once, when the scene changes. Material and buffer binds are skipped when nothing has changed. The shadow map is only redrawn when a light or a shadow caster moves.

Two smaller fixes are worth a mention. A constant-buffer ring used to silently drop objects past 512 of them. It now waits for the GPU, grows, and logs a warning. And the "Light Scale" slider turned out to do nothing, because the value reached the shader but was only used in a check that never tripped. The demo had been tuned at 0.06 while that was true, so I changed it to 1.0, which gives exactly the same picture.

![Light Scale at 1.0 and at 0.4](/images/2026-09-28-lean-renderer-pbr/light-scale.jpg "Light Scale 1.0 on the left, 0.4 on the right. Before the fix, both looked like the left one.")

| Pose | GPU frame before | after |
|---|---|---|
| south_start | 5.93 ms | 2.88 ms (−51%) |
| east_closet_door | 4.70 ms | 2.96 ms (−37%) |
| north_corridor_long | 5.87 ms | 2.98 ms (−49%) |
| north_locked_door | 5.02 ms | 2.78 ms (−45%) |

Those are Debug-build numbers on an RTX 4070 at 1440p. The picture barely changed: at most 196 of 3.6 million pixels differed per pose, all at seams where two faces share a plane and the depth test picks a winner. I turned culling off again to confirm that was the cause, and the image matched exactly.

> **Note: Why the benchmark came first.** Optimising by eye is how you "speed up" a renderer by breaking it. A frozen-time benchmark that can say "0 pixels differ" turns each change into a small, checkable claim, and every step in this post was held to it.

## One lighting model for everything

With the renderer lean, I had room to replace the hacks. The goal: lights, materials and the camera make the image, and the shader knows nothing about hallways.

> **Theory: What a BRDF is.** When light hits a surface, some of it bounces off, and *how much goes in which direction* depends on the surface. A *BRDF* (bidirectional reflectance distribution function) is a formula that answers: for light arriving from this direction, how much leaves toward the viewer? Every PBR renderer is, at heart, one BRDF evaluated for each light at each pixel.

The BRDF I used is the standard real-time one. It splits reflected light into two parts.

**Diffuse** is light that goes into the material, scatters around and comes back out in all directions, so the surface looks the same from any angle. Matte plaster is mostly diffuse. I use the simple Lambert model: brightness follows the angle between the surface and the light.

**Specular** is light that bounces straight off the top surface, like a mirror but blurred. The blur is controlled by *roughness*. A glossy floor has a tight, bright highlight, and rough plaster has a wide, dim one. I use the **GGX** distribution to describe how the tiny microscopic facets on the surface are oriented. It gives a sharp core and a long soft tail, which is what real highlights look like. Two other terms complete the specular part: *Smith masking*, which accounts for facets hiding each other, and *Fresnel*.

**Fresnel** is the observation that every surface becomes more mirror-like at grazing angles. Look straight down at a wooden floor and you see wood. Look along it, toward the far end of a hallway, and you see the lamps reflected. Schlick's approximation captures this cheaply, and it matters a lot in a long corridor.

**Metalness** decides what colour the specular reflection is. A plastic or painted surface reflects white-ish light, at around 4% strength head-on. A metal reflects light tinted by its own colour and has almost no diffuse part. The demo has few metals, such as the lamp fittings and door knobs, but the same formula covers them.

> **Concept: Energy conservation.** A surface can't send out more light than it receives. In a PBR model, light that was reflected by the specular part is no longer available to be scattered by the diffuse part. This is what stops a white wall from glowing brighter than the lamp shining on it.

I wrote the BRDF once in HLSL and once in C++, so I could test it. One test is a "white furnace": integrate the highlight over the whole hemisphere and check that a surface never reflects more than it receives. That test caught something. The textbook way of dimming the diffuse part, multiplying by `1 − F` per light, let a white wall reflect up to 128% of the light at grazing angles. I now weight the diffuse by what the highlight *doesn't* take for that view angle. The worst case is 105%, which is the error of the approximation itself. Without the test I would never have seen it.

## Lights that behave like lights

Brightness now falls with the square of the distance, and fades smoothly to zero at the light's range so it can be cut off without a visible edge. Lights can be spot lights with inner and outer cone angles. The flashlight is simply a spot light in the same loop as the lamps, with no special code.

The GPU receives up to 64 lights per frame. For each object, the CPU picks the 8 that matter most: the brightest at that object's nearest point, with the flashlight always included. To stop lights popping in and out as you walk, a light keeps its slot unless a newcomer is at least 10% stronger.

Walls and floors became ordinary library materials too, going through the same path as the glTF door and lamp. And I deleted a lot of code: the scene shader dropped from 886 lines to about 250, with around 20 hallway-specific functions gone. Eight settings that no longer did anything were retired, and old scene files still load with a one-line note.

![The hallway before and after physically based lighting, six poses](/images/2026-09-28-lean-renderer-pbr/pbr-bench-after.jpg "After the switch to physically based lighting: the plaster and wood read at last, and the lamps make real pools of light.")

## What went wrong

Making walls cast shadows exposed real problems. A lamp's own wall darkened in hard wedges, because the wall was shadowing its own lit side. The fix was to draw back faces into the shadow map, so a wall can't shadow the side facing the light.

![A hard shadow wedge on the wall, and the same wall fixed](/images/2026-09-28-lean-renderer-pbr/shadow-wedge.jpg "Left: the lamp's own wall shadowing itself in a wedge. Right: the fixed, smooth pool.")

I'll be honest about the interim look as well. With the painted tricks gone, the floor lost its fake gloss and the space between the lamps went flat and very dark. That was expected. Real shadows, ambient occlusion and screen-space reflections were next, and they are what fill that gap properly.

## Where it ended up

The main scene pass dropped from roughly 2.5 ms to about 0.4 ms at the start pose, because the new shader is so much simpler than the old pile of special cases. The wall plaster's relief now shows under raking lamp light, the lamps cast believable pools, and the flashlight behaves like a light.

![A wall lamp grazing the plaster beside a closet door](/images/2026-09-28-lean-renderer-pbr/closet-door.jpg "Lamp light skimming the plaster brings out its relief, while the door and frame sit in the gloom.")

All that leftover time is the point. It's headroom for shadows, ambient occlusion, reflections, fog and the camera effects I'm about to build.
