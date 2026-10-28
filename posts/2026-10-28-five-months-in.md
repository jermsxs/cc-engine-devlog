---
title: Five months in, looking back
date: 2026-10-28
order: 1
summary: From a black box with one lamp to a storm in the woods. What the engine can do today, what I learned building it, and what's still missing.
tags: retrospective
cover: /images/2026-10-28-five-months-in/night-path-start.jpg
---

I started this engine on June 6 with one reference picture: a narrow, dim hallway with wall lamps, dark paintings and a glossy wooden floor. Today the engine renders a sunlit, ruined kitchen, a two-storey house you can walk through and throw things around in, and a forest at night in a thunderstorm, with rain that soaks the ground over minutes and leaves that drip.

This post steps back from the daily entries to look at the whole thing.

## The numbers

- **883 commits** across two stretches: ten days in June, then a long summer pause, then every day from September 27 onward.
- **About 127,000 lines of C++**, plus around 7,000 lines of HLSL shaders and 2,000 of C# gameplay code.
- **Zero third-party libraries.** Everything (the DirectX 12 renderer, the UI toolkit, the physics, the glTF importer, the texture compressor, the C# host) is written from scratch on top of the Windows SDK. The only outside runtime is .NET, which the engine hosts for scripts.
- **A frame budget** of 1440p at 60 fps on an RTX 3060-class card, measured before and after every graphics change.

## Where it started, where it is

![The hallway at the end of September: a dark box with a single sconce and a heavy vignette](/images/2026-10-28-five-months-in/hallway-runtime.jpg "September 27: the hallway after the summer pause. Real meshes and lamps, but flat light and a vignette doing most of the mood.")

When I came back to the project in late September, the hallway rendered, but most of its mood came from darkness and a vignette. Light didn't bounce, the floor didn't reflect, and the walls were one flat colour.

![The same hallway three days later, with mouldings, a window, a lamp casting soft light on plaster, and framed paintings](/images/2026-10-28-five-months-in/game-start.jpg "September 30: physically based lighting, shadows, baked bounce light, authored materials and decals, and a real camera pipeline.")

Three days of graphics work changed that: one physically based lighting model for every surface, shadows from the lamps that matter, ambient occlusion, floor reflections, baked bounce light, a bloom and exposure pipeline that behaves like a camera, and materials with grime and wear.

![A sunlit kitchen with light shafts through venetian blinds, a table with a pot and bottle, and a flashlight in hand](/images/2026-10-28-five-months-in/s8-game-start.jpg "October 20: the kitchen. Sun through the blinds, light shafts in dusty air, scanned materials, and a flashlight the player actually holds.")

Then the engine grew outward: a house built by an AI agent through the editor's own tools, lightmaps, clustered lighting, physics, carrying and throwing, skeletal animation and an enemy, scanned materials, and finally the outdoors.

![The night woods lit only by a flashlight: grass, bushes and a tree trunk at the edge of the beam](/images/2026-10-28-five-months-in/night-path-start.jpg "October 25: the woods at night. Real leaves, a wet ground with relief, and only the torch to see by.")

## What I learned

**Measure first, always.** The single most useful thing I built wasn't a graphics feature. It was the benchmark mode and the in-engine screenshots. Every claim that something got faster or better-looking had to show numbers and a before/after picture. Several "improvements" turned out to cost more than they gave, and I only knew because the numbers said so.

**Compare against the reference, not against yesterday.** It's easy to make something look better than it did the day before and still be far from the target. Putting my frame next to the reference with numbers (brightness, contrast, where the darks sit) is what moved the look the most.

**Tools are the product.** Halfway through, I made the editor drivable by AI agents through an MCP server, with every edit undoable. That changed how fast I could build: an agent could lay out a whole house, take screenshots and report what looked wrong. It also exposed every rough edge in the editor, because an agent can't work around a bad tool the way a person can.

**From scratch is slower, but you understand everything.** When the leaves flickered, I knew exactly which pass to look at. When the fog hazed the lamps, I could follow the light from the bulb to the pixel. That understanding is the point of the project.

**Sweeps matter.** Every few tracks I stopped adding features and did a bug and speed sweep. Each one found real bugs: caches that never invalidated, shadows redrawn every frame, a stutter from re-reading a log file. Building fast leaves debris; sweeping it up keeps the engine trustworthy.

## What's still missing

Being honest about the gaps:

- **Sound.** Audio has been planned and then put on hold while the visuals caught up. For a horror engine that's the biggest hole: dread is half sound.
- **The demo itself.** All the pieces of the 3–5 minute hallway experience exist (the walk, the interactions, a scripted scare in C#, an enemy), but they haven't been assembled and paced into one sequence yet.
- **Performance in the woods.** The night forest is the heaviest scene and still over budget in its worst views. The current work is about drawing only what can be seen.

## What's next

Finish making the woods fit the frame budget, bring sound back, and then put the demo together: start at one end of the hallway, end with something quietly wrong. Thanks for reading along.
