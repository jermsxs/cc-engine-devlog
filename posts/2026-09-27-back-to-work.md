---
title: Back to work
date: 2026-09-27
order: 1
summary: After a three-month pause I finished the editor reskin, taught the engine real glTF meshes and materials, and unified the editor and game scene.
tags: editor, assets, scene
cover: /images/2026-09-27-back-to-work/editor-reskin-with-fixtures.jpg
---

The last commit before the pause was on 15 June. On 27 September I picked the project up again. The first thing I did was not exciting: I looked at what I had left, wrote a plan, and worked through it in phases. Today covered three of them. The editor got its half-finished reskin completed, the engine got a real content pipeline for 3D models and materials, and the editor and the game finally agreed on what "the hallway" is.

## Phase 0: finishing the editor

The editor was usable but unfinished and a bit fiddly. I finished the dark restyle and fixed the things that irritated me most:

- a command bar across the top and full-height panels at the sides;
- a Materials panel;
- panels docked to the same side now stack on top of each other instead of overlapping;
- a borderless, resizable window, with Quit on Ctrl+Q and a borderless toggle on F11;
- keyboard shortcuts that actually worked.

Here is the editor in June next to the editor after the work.

![The June editor with a text-only toolbar of abbreviations](/images/2026-09-27-back-to-work/editor-june.jpg "June: a toolbar of abbreviations (MOV, ROT, SCL), and a layout that was still being decided.")

![The September editor with a full command bar, wider panels and a lamp in the viewport](/images/2026-09-27-back-to-work/editor-reskin-with-fixtures.jpg "September: named buttons, stacked panels, and an authored lamp on the wall in the viewport.")

It is still a very plain, text-based editor. A much more thorough redesign comes later. But it stopped getting in my way, which was the goal for this day.

## Phase 1: real meshes and real materials

Until now the hallway was built out of stretched boxes and one-off shader tricks. To get anywhere near the look I want, the engine has to draw models made in a proper modelling tool, with proper materials. That meant a pipeline from file to screen.

**One JSON parser.** I had three hand-written JSON readers in different parts of the code, each slightly different. I replaced them with one shared parser. It was dull, but the next steps all lean on it, and three readers means three sets of bugs.

**A better glTF importer.** The importer I wrote in June read simple meshes. Now it also reads `.glb` files (the single-file version), models made of a hierarchy of parts, materials, and it *generates tangents* when a file does not have them.

> **Concept: Tangents and normal maps.** A *normal map* is a texture that fakes small bumps: instead of colours, each pixel stores a direction the surface should appear to face, so light catches a scratch or a plaster ripple without any extra geometry. But those directions are stored relative to the surface (the surface's "up" is the blue channel). To use them the shader needs two more directions lying along the surface, the *tangent* and the *bitangent*, to build a little coordinate system at every point. If a model does not include tangents, the importer has to compute them from how the texture is laid out across each triangle.

**Materials per part.** A model is usually several parts with different materials: a lamp has a brass arm and a glass shade. So the renderer now draws each part with its own material, and a material is more than a colour:

- base colour,
- how metallic it is, and how rough,
- a normal map,
- an occlusion map (baked darkness in crevices),
- emissive (the surface glows),
- and a glass setting.

**The first authored asset.** I wrote a Python script that generates a wall sconce: an aged brass arm and a frosted glass shade, saved as glTF. I placed it at all twelve lamp positions in the hallway. This is the pattern for every prop from here on: no more boxes pretending to be lamps. A script (or Blender) makes the model, the engine imports it, and the scene refers to it.

![A close-up of a brass wall sconce with a glowing frosted shade, zoomed in so the pixels are visible](/images/2026-09-27-back-to-work/wall-sconce-closeup.jpg "The sconce at close range. The shot is enlarged from a small capture, hence the blockiness.")

## Phase 2: one source of truth

There was a quiet problem I had been living with. The game and the editor did not share one description of the hallway, so a change made in the editor was not guaranteed to reach the game.

> **Concept: Single source of truth.** When two programs both think they know what is in the world, they will drift apart. The fix is to keep that knowledge in exactly one place, and make everything else read it. Here that place is a file, `hallway.entity_scene.json`.

Now both the game and the editor load that same scene. Saving in the editor changes what the game plays. Editor and game stopped being two descriptions of one hallway and became two ways of looking at one.

I also added a debug option that freezes the camera at a given position and angle when the game starts. That sounds minor, but it is how I take repeatable close-ups of one spot, which I need whenever I want to compare a change before and after.

## How I checked

I took screenshots after each step and compared them, because a renderer can break in ways that no unit test will notice: the code runs, the numbers are fine, and the picture is wrong. Alongside that went unit tests for the JSON reader, the glTF importer, meshes, materials and scene loading.

## Where it stood at the end of the day

- the editor looked finished enough to use;
- the engine could draw imported models, with several materials each;
- the hallway had one real prop, and twelve of it;
- editor and game shared a scene.

It still looked dark and plain. But the bones were right. The next entries are about two problems I had been putting off: how slow it was to start, and how the player walks.
