---
title: The engine after five months
date: 2026-10-28
order: 1
summary: A review of where the engine stands, what the main systems are, the working methods that held up, and what is still missing before the first demo.
tags: retrospective
cover: /images/2026-10-28-five-months-in/night-path-start.jpg
---

I started this engine on June 6 with a single reference picture: a narrow residential hallway with wall lamps, dark framed paintings and a worn wooden floor. The goal was a short first-person horror demo with the restrained, realistic lighting of Resident Evil 7 and Village, built on an engine I write myself. This entry steps back from the daily posts to record where the project stands, what I learned about working on it, and what is left.

## Scope and size

- **883 commits** in two periods: June 6 to June 15, then a pause over the summer, then daily work from September 27 to today.
- **About 127,000 lines of C++**, 7,000 lines of HLSL and 2,000 lines of C# gameplay code.
- **No third-party libraries.** The DirectX 12 renderer, the UI toolkit, the physics, the glTF importer, the texture compressor and the C# host are all written against the Windows SDK. The only external runtime is .NET, which the engine hosts for gameplay scripts.
- **A fixed budget:** 1440p at 60 fps on an RTX 3060-class GPU. Every rendering change is benchmarked before and after against that target.

## How the image changed

![The hallway on September 27: a dark corridor lit by one wall sconce, with a strong vignette](/images/2026-10-28-five-months-in/hallway-runtime.jpg "September 27. Real meshes and lamps, but no bounce light, no shadows from the lamps and no reflections; most of the mood came from darkness and the vignette.")

When I resumed work in September, the hallway rendered correctly but the lighting model was minimal. Each lamp lit only what it faced directly, the floor had no reflections, and the walls were a flat colour. The image read as dark rather than lit.

![The same hallway on September 30, with mouldings, a window, a lit sconce and framed paintings](/images/2026-10-28-five-months-in/game-start.jpg "September 30. Physically based shading, shadow maps, baked irradiance and reflection probes, authored materials with decals, and a camera pipeline with exposure, bloom and grading.")

Three days of rendering work changed most of that. I replaced the hallway-specific shading with one physically based lighting model, added shadow maps for the lights that affect the view, ground-truth ambient occlusion, screen-space reflections, temporal anti-aliasing, volumetric fog, and a camera model with auto-exposure, bloom, colour grading and film grain. Baked probes then supplied the bounce light that direct lighting alone cannot.

![A ruined kitchen with sunlight through venetian blinds and visible light shafts](/images/2026-10-28-five-months-in/s8-game-start.jpg "October 20. A directional sun through blinds, volumetric light shafts, scanned materials and a flashlight held in the player's hand.")

The following weeks broadened the engine rather than refining one scene. I built a two-storey house through the editor's own scripting interface. After that came lightmaps, clustered lighting, rigid-body physics, carrying and throwing objects, skeletal animation and an enemy, scanned materials with layered wear, and finally outdoor scenes with cascaded shadows, foliage, volumetric clouds and rain.

![The night forest lit only by a flashlight](/images/2026-10-28-five-months-in/night-path-start.jpg "October 25. The forest at night: individual leaves, a ground surface with relief, and the flashlight as the main light source.")

## Working methods that held up

**Measure before changing anything.** The most useful tools I built are the benchmark mode, GPU pass timings and in-engine screenshots from fixed camera poses. Each change is judged by numbers and a before/after image, not by impression. Several changes that looked like improvements turned out to cost more than they were worth, and the measurements are what showed it.

**Compare against the reference, not against the previous day.** An image can improve every day and still be far from the target. Placing my frame next to the reference and comparing brightness, contrast and where the dark values sit did more for the look than any individual feature.

**Treat tools as part of the product.** I made the editor fully drivable through an MCP server, with every edit undoable and headless rendering available. That allowed large scene edits to be scripted and checked with screenshots. It also exposed weaknesses in the editor's interfaces, since a scripted client cannot work around a bad tool the way a person can.

**Writing from scratch costs time but gives understanding.** When leaves flickered or lamps looked hazy, I could trace the problem through every pass from the light source to the pixel, because I had written each one. That understanding is a main reason for the project.

**Schedule cleanup.** After every few feature tracks I stopped adding features and ran a bug and performance sweep. Each sweep found real defects: caches that never invalidated, shadow maps redrawn every frame, and a stutter caused by re-reading a log file. Fast feature work leaves problems behind, and regular sweeps keep the engine reliable.

## What is missing

- **Audio.** Sound has been planned and then postponed while the rendering caught up. For a horror engine this is the largest gap, since much of the tension in the genre comes from sound.
- **The demo itself.** The pieces of the 3–5 minute hallway sequence exist: walking, interaction, a scripted scare in C# and an enemy. They have not yet been assembled and paced into one sequence.
- **Outdoor performance.** The night forest is the heaviest scene and still exceeds the frame budget in its worst views. The current work is about drawing only the geometry that is actually visible.

## Next

The order of work from here is to bring the forest within the frame budget, then implement the audio system, then assemble the hallway demo from the systems that already exist.
