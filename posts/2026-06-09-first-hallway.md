---
title: The first hallway
date: 2026-06-09
order: 1
summary: Two days of June commits that gave the hallway real lamp falloff, a shadow map, a post pass, a flashlight and a scene stored as data.
tags: renderer, lighting, scene
cover: /images/2026-06-09-first-hallway/falloff.svg
---

By the second week of June the engine could open a window and draw a corridor built from boxes. Over 8 and 9 June I made a run of small commits to turn that into something I could believe was a hallway: lights that behaved like lights, a floor and walls that took them, a flashlight, a scene stored as a file, and a way to bring in real 3D models. I also spent a good part of those two days taking things out.

I did not record screenshots of this period, so I have nothing honest to show you from the day itself. The picture below is the same hallway as it looks in late September, after the lamp was replaced with an authored model. The structure is the one I describe here.

![A dark hallway with a single glowing wall lamp on the right](/images/2026-06-09-first-hallway/hallway-runtime.jpg "The same hallway a few months later. The long dark corridor, one pool of light and a vignette are all from the June renderer.")

## How the frame is drawn

The renderer is a *forward renderer*. For every object, one shader runs on every pixel it covers and works out the final colour right there: it looks at the surface, loops over the lights and adds up their contributions. That is simpler than the alternatives and plenty for a few dozen lights in a small space.

The shader does not write to the screen directly. It draws into an off-screen picture stored in floating point, an *HDR* target. HDR means "high dynamic range": a pixel can hold a value brighter than white. That matters in horror, because a bare bulb really is hundreds of times brighter than a wall in shadow, and I want to keep that gap until the very end.

Each frame has three passes:

1. **Shadow pass.** Draw the scene's depth from the point of view of the light.
2. **Scene pass.** Draw everything with lighting and shadows into the HDR target.
3. **Post pass.** Take that image and turn it into the one you see.

## Lamps with real falloff

A big part of 8 June was lamps. A lamp has to get dimmer with distance, and how it does so decides whether a room feels real.

> **Theory: Inverse-square falloff.** A bulb sends out a fixed amount of light in all directions. At distance *d* that light is spread over the surface of a sphere, and the area of a sphere grows with *d* squared. So double the distance and each patch of wall gets a quarter of the light. That is the *inverse-square law*. It is why a lamp lights the wall next to it brightly, and the far end of the hall hardly at all.

Pure inverse-square has two problems for a renderer. At distance zero it divides by zero and goes to infinity. And it never quite reaches zero, so in theory every lamp would touch every pixel in the house, which means you can never skip a light as too far away.

My lamp function fixes both. It is the product of two pieces:

- a softened inverse-square term, roughly `1 / (1 + d² × k)`, which is finite at the bulb and falls off like the real thing as you move away;
- a *range window* that eases to exactly zero at the lamp's chosen radius, so each lamp lights a limited area.

![A graph of brightness against distance: one curve never reaches zero, the other drops to zero at the lamp radius](/images/2026-06-09-first-hallway/falloff.svg "Pure inverse-square (grey) against my windowed version (gold). Schematic, not measured values.")

A real bulb is also not a point. It is a glowing glass shade with some size, so the function takes a *source radius*: distance is measured from the edge of the lamp rather than its centre, and a larger source gets a slightly softer look. Each lamp has its radius, falloff exponent and source size stored on its light component, so I can tune them without touching shader code.

On the first day I also set up a "lights-only" baseline: the hallway is lit by its lamps and nothing else, so that I could judge what the lamps were doing.

## One shadow map

A *shadow map* is a depth picture taken from the light's point of view. When I later draw a pixel for the camera, I ask: from the light, is there something closer than this point? If so, this point is in shadow. It is cheap, and one picture covers the whole scene.

I have exactly one for now. Shadows are costly, so only the light that matters most casts them. Anything fancier can wait until the basics look right.

## The post-process pass

The post shader is where the HDR image becomes a film frame. It runs once over the whole picture and does, in order:

- **Lens distortion:** a very slight barrel warp near the edges.
- **Chromatic aberration:** red, green and blue are sampled from slightly different positions, as a cheap lens would.
- **Bloom:** a cheap blur of only the brightest pixels, added back on top, so a lamp looks like it glows into the dark.
- **Vignette** and **film grain**: darker corners and a little noise that changes every frame.
- **Colour grade** and **tone mapping.**

Tone mapping is the last step, and the one that makes HDR work. The screen cannot show "800 times brighter than white", so a curve squeezes the range into 0 to 1. The one I used is as simple as it gets:

```hlsl
color = color / (color + 1.0);        // bright values flatten, darks stay
return float4(pow(saturate(color), 1.0 / 2.2), 1);   // gamma for the display
```

## A flashlight

A horror game needs one. The flashlight is a spot light that follows the camera. The detail I spent a commit on was making sure the material still shows inside the beam. A flashlight that lights a wall into a flat white disc is no good for horror: the plaster and grime pattern should stay readable exactly where you are looking.

## The scene becomes data

The most important structural change was not visible. Until now the hallway lived in C++ code. I moved it into an **entity scene**: a list of entities, each with components for name, transform, mesh, material, light, camera, interaction, trigger and door (about 14 kinds in all). The scene saves to JSON and loads back, and a bridge hands it to the renderer, so that the entity scene, not the old hard-coded structure, is the authority on what exists.

That is the groundwork for an editor, since an editor can only edit what is data. I added checks too: audits for materials and transforms, and tests that the hallway's boxes, lights and interactions are all present as entities.

## Real meshes, and taking out the fakes

Until now everything was a stretched box. On 9 June I added an importer for **glTF**, a standard 3D file format (think of it as the JPEG of 3D models). It reads a mesh from disk so the engine can draw something that was modelled rather than computed.

With a proper path for real models, I went back and removed the stand-ins. The hallway had picture frames, lamp fixtures, grime strips and floor scuffs, all built out of boxes. They were fakes, and they were hiding that the real work was undone. I deleted them. I also decided that scares should not be baked into the renderer's baseline, with a camera shake that fires when you reach a certain spot. A clean, honest hallway is a better base than a cluttered fake one. The props should come back as authored models, and the scares as triggers and scripts.

## The loop

The last piece was the shape of the level. The first hallway was a straight tunnel. I changed it to a **loop**, a square corridor you can walk around, which gives a lot more to look at in the same space. It took three tries: one commit to build it, another to fix its geometry, and a third to restore the walls and the flashlight mood.

## Where it stood

By the evening of 9 June I had a dark, loopable corridor with lamp pools, a flashlight, a shadow, film-style post effects, and a scene that was data, not code. It was still a plain box with a good mood. There were no props, the walls were flat, and the lighting was a pile of shader tricks specific to this one hallway. But it had a structure I could build on, and the next step was an editor.
