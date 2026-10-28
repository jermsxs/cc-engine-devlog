---
title: A sweep, and knowing what the machine is doing
date: 2026-10-20
order: 1
summary: A bug and speed sweep over everything since the last one, using reviewer agents, plus a live view of CPU and GPU load so benchmarks can be trusted.
tags: performance, tools, retrospective
cover: /images/2026-10-20-sweeps-and-machine-load/editor-assets-grid.jpg
---

Track M had added a lot of code in a few days: texture streaming, decals, layers, a new bake system. When you build fast, some of it is wrong in ways you have not noticed yet. So I do what I call a sweep, a pass whose only goal is to find bugs and slow spots in everything written since the last one. Then, because the sweep surfaced questions about how reliable my own benchmark numbers are, I made the engine tell me what the machine itself was busy with.

## How a sweep runs

The sweep ran in three steps, and I used AI agents for much of it, the same way the engine's editor can be driven by them.

1. **Reviewers.** One agent per area read the new code: textures and streaming, shaders and decals, baking, the runtime (flashlight, switches, throws), and the editor tools. Each listed bugs and slow spots with the evidence and a failure scenario.
2. **Verifiers.** A second agent per area tried to *refute* each finding by tracing the code, marked it confirmed, plausible or refuted, corrected the suggested fix where it was wrong, and listed what the first had missed. Two of the bake findings came from that "missed" list.
3. **An independent review of the fixes.** A fresh agent read all the fix commits against the old version of the code. It found nothing wrong in three of them, and four problems in the rest.

I checked each fix in the code myself before keeping it, and twice the suggested fix was wrong. One said switch layers could skip a depth step in the bake. They cannot: a layer's bounce passes read the probes through those depth values, so skipping them would have broken the bounce light. And my own first fix for the editor's images decoded every picture from its PNG, which was quick in Release but made the Debug editor's smoke test take 99 seconds when its limit is 60. The full validation caught it, and the final version reads small mips from the texture cache instead and takes 26 seconds.

This is a lesson I keep relearning: an agent's confident fix is a hypothesis, not a result.

## What the sweep found

### The editor

- **A 6.9-second freeze.** Opening a panel that showed the 4096-pixel decal atlas compressed the whole atlas on the main thread. Images for the interface are now read on a worker thread and keep only the levels of 512 pixels and under, since the interface never draws anything bigger. The smoothness check went from four hitches to zero.
- **A crash on one bad tool call.** A headless tool that threw an exception took down the whole tool server. It now fails only that call.
- **A half-made material.** A create with a bad field added the material and then reported an error. A create and its fields are now one step.
- **A wiped library.** A material file with a JSON mistake loaded as an empty library, and the next save overwrote it with nothing. Saving now refuses.

### The renderer and streaming

- Material layers treated every world-projected object as a plain box, so an imported trim mesh got its floor band from a box it was not.
- With more than 512 decals in view, I sent the nearest 512 in distance order, so overlapping decals swapped stacking order as the camera moved. They now keep scene order.
- The depth prepass sampled the decal colour atlas for every decal, though only wet ones need it there. Dropping that saves 0.5 to 2.5% of the house's GPU frame.
- Reads in flight were not counted against the texture budget, so loading could overshoot and then evict. And a texture's first load read its whole file, up to 21 MB, only to keep the small tail.

### Baking

The most interesting bugs were in the bake, because a stale bake can *say* it is current.

> **Concept: Cache keys and staleness.** A bake takes a minute and produces files. To avoid redoing it, I compute a *key*: a fingerprint of every input the bake reads. If the key matches the saved one, the bake is current. The danger is a key that misses an input. Then something changes and the bake quietly stays "current" while the light is wrong.

The keys missed a mesh's buffers and its import settings (a rescale moves every triangle), slot-override libraries, the lights file, and the entity IDs that the runtime uses to match lightmaps. Duplicate a lightmapped wall, delete the original, and the copy silently lost its lightmap. The keys were also taken *after* the multi-minute bake had read the files, so a mesh saved mid-bake was recorded as baked. Now the keys are taken first, from a per-file fingerprint cache that is only re-read when a file's size or write time changes.

Bakes now repeat. A lightmap triangle whose corners another thread was still computing used its centre instead, so two bakes of the same scene differed slightly. It now waits. Two hallway bakes in a row came out byte for byte the same.

### Small fixes in play

The held torch only ever swayed to one side, because of a half-rate sine on a phase that wrapped too early. Each switch's circuit check built a list of every light in the scene, every frame.

### The look didn't change

The sweep fixed bugs and saved time, and the pictures match. House GPU time moved from -2.7% to 0% after a cool-down, and no pixel changed by more than 15 out of 255.

![The bathroom after the sweep](/images/2026-10-20-sweeps-and-machine-load/bathroom-after.jpg "The bathroom after the sweep, identical to before. The point of a sweep is that you should see nothing.")

![The editor's asset grid, with UI images read on a worker thread](/images/2026-10-20-sweeps-and-machine-load/editor-assets-grid.jpg "The editor with the Assets panel open. Thumbnails now fill in off the main thread, so the editor no longer freezes when a panel shows a big atlas.")

## What the machine is busy with

During the sweep I ran back-to-back benchmarks while the machine was hot and saw house times up to 7.9% *slower*, with spikes in every pose. After a cool-down the same code was faster. That was noise from my machine, not from the sweep, but it showed that a benchmark number means little without knowing what else the machine was doing.

So the engine now measures it, about once a second:

- **CPU:** the whole machine's usage, this program's share, and its speed against base clock.
- **GPU:** how busy it is, as Task Manager shows it, and this program's share.
- **The NVIDIA card**, read from its driver: clock speed, temperature, power and its limit, and what is holding the clock down.
- **The busiest other programs.**

It shows in the Renderer panel's new Machine section, over the editor's tool interface, in a line after each performance log entry, and with every benchmark pose. The comparison script now *warns* when a run is not comparable: another program is using the GPU, the card is hot or throttled, or the clocks differ between runs. A small script also shows the same picture with the engine closed.

![The Renderer panel's Machine section](/images/2026-10-20-sweeps-and-machine-load/machine-panel.jpg "Machine load in the editor: 8% CPU in total (5% mine), 46% GPU, the card at 1.6 GHz of 3.15, 47 degrees and 56 of 215 watts, nothing slowing it down.")

> **In practice: What it told me about my own machine.** Idle, the GPU sits at 210 MHz and 41 degrees. The editor at 144 Hz with vsync uses about 46% of the GPU. During a benchmark the card runs at 2.8 GHz and 61 to 64 degrees, at about 180 of its 215 watts. The "power cap" reason that shows then is just GPU Boost holding the card at its limit, which is normal, not a fault. Other programs use 3 to 9% of the CPU and about 1% of the GPU, which explains the small run-to-run noise.

## The sweep's open items

I closed the follow-ups the sweep had left open:

- **Sharper small parts.** Streaming had used one UV density per mesh, averaged over the whole mesh, so a small part mapped denser than the rest (a label, a handle) stayed blurry. Each part now uses its own.
- **Fewer needless rebakes.** The bake key hashed whole material libraries, so changing any material's roughness marked every scene's lighting stale, even though a bake never reads roughness. The key now covers, for each material a scene uses, its colour, its albedo texture's *content*, and for meshes their base-colour and emissive images.
- **Decals per object.** Each drawn object tested every decal in the frame, 274 objects times 137 decals in the busiest view. They now go into a 2 m grid on the floor plan, and each object tests only the nearby ones. A randomized test checks the lists come out the same. CPU time went from 0.19 to 0.10 ms in the corridor.
- **Thumbnails.** An image the renderer had not cooked yet took 1.33 seconds to become a thumbnail, and only 0.18 of that was reading the PNG. The rest was converting colours to and from linear light with an expensive power function, three times a pixel. Two lookup tables now give exactly the same bytes. Before using them I checked them against the real function for every float between 0 and 1, all 1,065,353,217 of them, with no differences. A whole uncooked thumbnail fell from 1.33 to 0.38 seconds.
- **The asset scan.** The Assets panel's first scan decoded all 205 textures just to read their sizes. It now reads each size from the file header: 6.95 seconds down to 0.13.

## Where it stood

The tests pass, the editor shows no hitches in 1500 frames, and the pictures are unchanged. Still open: bake sums that depend on the thread count, BC7 still ranking partitions for blocks it could skip, and machines without an NVIDIA card, which show only Windows' counters. Next came a very different job: a kitchen lit by the sun.
