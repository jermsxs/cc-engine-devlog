---
title: A bug and speed sweep, and measuring what the machine is busy with
date: 2026-10-20
order: 1
summary: A review pass over everything written since the last sweep, and a CPU and GPU load readout that lets me judge benchmark results against the machine's conditions.
tags: performance, tools, retrospective
cover: /images/2026-10-20-sweeps-and-machine-load/bathroom-after.jpg
---

Track M added a large amount of code in a few days: texture streaming, decals, material layers and a new bake key system. Code written quickly is wrong in ways I have not noticed yet. I run a sweep, a pass whose only goal is to find bugs and slow spots in everything written since the previous one. The sweep also raised a question about how far I can trust my own benchmark numbers, so the second half of the day went on making the engine report what the machine itself was busy with.

## How the sweep ran

The sweep covered everything since the last one and had three steps. I ran the reading steps with AI agents and I verified every result myself.

1. **Review.** One review per area read the new code: textures and streaming, shaders and decals, baking, the runtime (flashlight, switches, throws) and the editor and MCP tools. Each review listed bugs and slow spots with the evidence and a failure scenario.
2. **Verification.** A second review per area tried to refute each finding by tracing the code. It marked each one confirmed, plausible or refuted, corrected the suggested fix where it was wrong, and listed what the first review had missed. Two of the bake findings came from that list.
3. **Independent review of the fixes.** A fresh review read all the fix commits against the previous version. It found nothing wrong in three of them, and four problems in the others.

I checked each fix in the code before keeping it, and two suggested fixes were wrong. The bake review said that switch layers could skip their depth moments. They cannot, because a layer's bounce passes read the probes through those moments, so skipping them would have broken the bounce light. The layers now take the base layer's depth, which comes from the same rays and is identical. My own first fix for the editor's images decoded every picture from its PNG. That is quick in Release, but it made the Debug editor's smoke test take 99 seconds against a limit of 60. The full validation caught it. The final version reads the small mips from the texture cache when it has them, and the test takes 26 seconds. A suggested fix is a hypothesis until a test supports it.

## What the sweep found

### The editor and the tool server

- **A 6.9 second freeze.** Opening a panel that showed the 4096-pixel decal atlas compressed the whole atlas on the main thread. Images for the interface are now read on a worker thread and keep only mips of 512 pixels and under, since the interface never draws anything larger. The editor smoothness check went from 4 hitches to 0.
- **A crash on one bad tool call.** A headless tool that threw an exception took down the whole tool server. It now fails only that call.
- **A half-made material.** A create with a bad field added the material and then reported an error. A create and its fields are now one step, and map paths that are absolute or climb out of the project are refused.
- **A wiped library.** A `materials.json` with a JSON mistake loaded as an empty library, and the next save overwrote the file with nothing. Saving now refuses.

### The renderer and streaming

- Material layers treated every world-projected object as a plain box, so an imported trim mesh got its floor band from a box it was not. A new object flag tells the shader which objects really are boxes.
- With more than 512 decals in view, the nearest 512 were sent in distance order, so overlapping decals swapped their stacking order as the camera moved. They now keep scene order.
- The depth prepass sampled the decal colour atlas for every decal, though only wet decals need it there. Dropping that saves 0.5 to 2.5% of the house's GPU frame.
- Reads in flight were not counted against the texture budget, so loading could overshoot and then evict. A texture's first load read its whole file, up to 21 MB for a 4K BC7 set, and kept only the 128-pixel tail. It now reads the tail alone.
- BC7 encoding threads took fixed chunks of rows. They now take rows as they go, because a flat row costs much less than a detailed one.

### Baking

The most important bugs were in the bake, because a stale bake can report that it is current.

> **Background: cache keys and staleness.** A bake takes a minute or more and produces files. To avoid repeating it, I compute a key, a fingerprint of every input the bake reads, and store it with the result. If the current key equals the stored one, the bake is current. The failure mode is a key that misses an input. Something changes, the key stays the same, and the lighting is wrong while every check says it is fine. A second failure mode is taking the key at the wrong time. A key computed after the bake has read the files can record a state that the bake never saw.

The keys missed a mesh's `.bin` buffers and its import sidecar, which matters because a rescale moves every triangle. They missed slot-override libraries and `lights.json`. They also missed the entity IDs that the runtime uses to match lightmaps and probe volumes to objects. If I duplicated a lightmapped wall and deleted the original, the copy silently lost its lightmap. And the keys were taken after the multi-minute bake had read the files, so a mesh saved mid-bake was recorded as baked. The keys are now taken before the bake. They come from a per-file digest cache that is read again only when a file's size or write time changes, which also stopped the editor from re-reading every glTF and library on each scene rebuild during a drag.

Bakes now repeat. A lightmap triangle whose corners another thread was still working out used its centre instead, so two bakes of the same scene differed slightly. It now waits. Two hallway bakes in a row came out byte for byte the same, and the house baked again produced no change in git. The progress bar had a related fault: the reflection stage's dark cubes and share captures had no progress or cancel, so the bar sat at 100% through a second full bake and Cancel did nothing until it ended. One more fix concerned albedo averages, which read only a few columns of a power-of-two texture, so that a stripe could tint the bounce light. They now walk every column.

### The runtime

The held torch only ever swayed to one side, because of a half-rate sine on a phase that wrapped too early. Each wall switch's circuit check built a list of every light in the scene every frame. Saving renumbered storey slots, so a field path such as `storeys.2` changed after a reload.

### What the independent review found

The fresh review of the fixes found four problems.

- **A real bug.** The cap on interface uploads per frame was off by one, so every image past the fifth got through in the same frame.
- **A reused interface slot** kept its old image on the GPU, and its queued read still ran.
- **A cached glTF digest** was checked against the glTF file's time stamp only and not against its buffers. `%XX` escapes in buffer names were not decoded either.
- **A preview that was settling its mips** loaded every texture waiting in the queue and moved the budget bias as if a frame had passed.

### The look did not change

The sweep fixed bugs and saved time, and the pictures match. The house's GPU time moved from -2.7% to 0% after a cool-down, and no pixel changed by more than 15/255. Texture memory is unchanged at 286 MB in the house and 178 MB in the hallway.

![The house bathroom before the sweep](/images/2026-10-20-sweeps-and-machine-load/bathroom-before.jpg "The house bathroom on master, before the sweep.")

![The house bathroom after the sweep](/images/2026-10-20-sweeps-and-machine-load/bathroom-after.jpg "The same view after the sweep. The images match, as a sweep should produce.")

![The editor's asset grid with images read on a worker thread](/images/2026-10-20-sweeps-and-machine-load/editor-assets-grid.jpg "The editor with the Assets panel open. Thumbnails fill in off the main thread, so a panel that shows a large atlas no longer freezes the editor.")

## Benchmark noise and machine load

### Why a benchmark number moves

> **Background: sources of benchmark noise.** A frame time measured on a PC depends on more than the code. A GPU raises and lowers its clock continuously. GPU Boost increases the clock until it reaches a temperature or power limit, so a card that has just been run hard is hotter and may run slower than a cool one. Other programs use CPU time and some GPU time. Vsync quantises frame times to the display's refresh. CPU frame time and GPU frame time are different quantities, and only the second is a property of the rendering work. The practical rules are to measure GPU pass times with timestamp queries, to repeat each run, to record the clock, temperature and competing load beside each result, and to treat any difference smaller than the repeat-to-repeat spread as noise.

During the sweep I ran two house benchmarks back to back while the machine was hot. They read up to 7.9% slower than master, with p95 spikes in every pose. After a cool-down the same code was between 2.7% faster and unchanged. That was noise from the machine and not from the sweep, but it showed that a number without the machine's state next to it means little.

### What the engine now measures

About once a second, a sampler records:

- **CPU:** the whole machine's usage, this program's share, and the cores' speed against their base clock, from the Windows performance counters through PDH.
- **GPU:** how busy it is, as Task Manager shows it, and this program's share, from the per-process "GPU Engine" counters, which I reduce to the adapter's busiest engine.
- **The NVIDIA card,** read from its driver through NVML, which the engine loads at run time: clock speed, temperature, power and its limit, memory, and the reason the clock is held down.
- **The busiest other programs.**

The values show in the Renderer panel's new Machine section, in `render_stats.machine` over MCP, in a line after each performance log entry, and with every benchmark pose. `Compare-Bench.ps1` now warns when two runs are not comparable: another program is using the GPU, the card is hot or throttled, or the clocks differ between runs. `Scripts/Watch-MachineLoad.ps1` shows the same picture with the engine closed. Without an NVIDIA card the engine shows only the Windows counters, and the GPU's clock and heat would need each vendor's library.

![The Renderer panel's Machine section](/images/2026-10-20-sweeps-and-machine-load/machine-panel.jpg "Machine load in the editor: 8% CPU in total (5% from the editor), 46% GPU, the card at 1,575 of 3,150 MHz, 47 degrees and 56 of 215 W, and nothing slowing it down.")

### What it showed about my machine

At idle the GPU sits at 210 MHz and 41 degrees. The editor at 144 Hz with vsync uses about 46% of the GPU, at around 1.6 GHz. During a benchmark the card runs at 2.8 GHz and 61 to 64 degrees, at about 180 of its 215 W. The "power cap" reason that shows then is GPU Boost holding the card at its power limit, which is normal and not a fault. Other programs use 3 to 9% of the CPU and about 1% of the GPU. That accounts for the small run-to-run noise I see, and it gives me a threshold: differences of a few percent between two runs are not evidence of anything.

## The sweep's open items

I closed the follow-ups that the sweep had left.

- **Sharper small parts.** Streaming used one UV density per mesh, averaged over the whole mesh, so a small part mapped more densely than the rest, such as a label or a handle, stayed blurry. Each submesh now uses its own.
- **Fewer needless rebakes.** The bake key hashed whole material libraries, so changing any material's roughness marked every scene's lighting stale, although a bake never reads roughness. It also missed what the bake does read, so a repainted albedo texture left the bake looking current. The key now covers, for each material a scene uses, its colour factor and its albedo texture's content, and for meshes their base-colour and emissive images. A test checks each case, and both scenes were rebaked once for the new keys.
- **Decals per object.** Each drawn object tested every decal in the frame, which is 274 objects against 137 decals in the house's busiest view. The decals now go into a 2 m grid on the floor plan and each object tests only the decals near it. The lists come out the same and in the same order, and a randomised test checks that against the old method. CPU time went from 0.19 to 0.10 ms a frame in the corridor and from 0.09 to 0.06 ms on the stairs.
- **Asset scan.** The Assets panel's first scan decoded all 205 textures to read their width and height. It now reads each size from the file header, and it fell from 6.95 to 0.13 seconds.

### Thumbnails and colour conversion

An image the renderer has not cooked yet, such as a normal or roughness map, took 1.33 seconds to become a thumbnail on the editor's single image thread. Reading the PNG was only 0.18 seconds of that. The rest was building the colour mips.

> **Background: why mips are generated in linear light.** Colour textures are stored in sRGB, a non-linear encoding. Averaging four sRGB values to make a smaller mip gives a result that is too dark, because the average of encoded values is not the encoded average. The correct procedure converts each texel to linear light, averages, and converts back. The sRGB conversion uses a power function with exponent 2.4 above a small threshold. A power function evaluated three times for every pixel of a 4096 by 4096 image is a large share of the work.

Two lookup tables now do the conversions. Into linear light there are 256 values, one for each byte. Back to sRGB there is a table with one byte for each range of float values, followed by one threshold check. Before using them I compared them with the `pow`-based version for every float between 0 and 1, all 1,065,353,217 of them, and found no differences. A test also compares the mips byte for byte, so cooked texture caches stay valid. A 4096 colour mip chain fell from 1.15 to 0.19 seconds, and a whole uncooked thumbnail from 1.33 to 0.38 seconds. Interface images now load on up to three threads instead of one, and the renderer's own texture cooking uses the same mip code, so it speeds up as well.

## Results and open items

103 of 103 tests pass in Release, and the validation script passes. The Release smoothness check has 0 hitches over 1,500 frames with a typical frame of 0.8 ms, and the Debug check has 2, which is its limit. Against master, the house bench shows GPU time between -1.4% and +0.7% and CPU time between -2.4% and +2.2%, and the hallway shows GPU time between -1.9% and +1.0%. Every pose ran at 2.79 to 2.84 GHz and 61 to 64 degrees with other programs at 3 to 9% CPU and 1% GPU, and no pixel in either scene differs from master by more than 12/255.

Items still open:

- Probe calibration sums depend on the thread count, so bakes made on machines with different core counts can differ slightly.
- BC7 still ranks partitions for blocks that mode 6 already encodes almost losslessly.
- A preview capture can still draw, at its tail, a texture whose read is already in flight.
- Decoding a 4096 PNG takes 0.18 seconds and is now most of an uncooked thumbnail. Cooking the asset folder's maps once would remove it.

Next came a different job: a kitchen lit only by the sun.
