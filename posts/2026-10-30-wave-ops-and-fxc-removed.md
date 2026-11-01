---
title: Wave operations in the foliage compaction, FXC removed and Track G closed
date: 2026-10-30
order: 1
summary: Wave operations cut the woods' visibility pass from 0.36 to 0.10 ms, FXC is removed, cold start is 3.7 s instead of 73 s, and a review sweep closes Track G.
tags: performance, renderer
cover: /images/2026-10-30-wave-ops-and-fxc-removed/into-the-bank-g8.jpg
---

Track G moved my shaders to Shader Model 6 in G3, but so far no shader used anything that Shader Model 6 adds. G8 asks whether it pays, with one measured use. G9 removes the old compiler, measures the whole track against its start and closes it. A bug and speed sweep over the branch follows before the merge.

## How a GPU runs threads in waves

A GPU does not run its threads independently. It groups them into fixed-size bundles, called waves in HLSL (warps on NVIDIA), and executes each bundle in lockstep: one instruction stream, with each thread, called a lane, applying that instruction to its own data. A wave has 32 lanes on NVIDIA hardware. Other vendors use 32 or 64, and D3D12 reports the range the device supports.

Two consequences matter here.

First, **divergence**. If a branch is taken by some lanes and not others, the wave runs both sides one after the other, with the lanes that do not belong switched off. The lanes that are switched on at a given point are called the active lanes.

Second, **the lanes of a wave can exchange values without going through memory**. Shader Model 6 exposes this as wave intrinsics, which operate across the active lanes of the current wave:

- `WaveActiveSum(x)` and `WaveActiveBitOr(x)` combine a value from every active lane and give the result to all of them.
- `WavePrefixSum(x)` gives each lane the sum of the values held by the active lanes before it. This is an exclusive prefix sum.
- `WaveReadLaneFirst(x)` gives every lane the value held by the first active lane. `WaveIsFirstLane()` is true for that lane.
- `WaveActiveCountBits(b)` counts the active lanes where `b` is true. `WavePrefixCountBits(b)` counts, for each lane, the lanes before it where `b` is true.

### Background: stream compaction with a prefix count

Stream compaction means copying only the elements that pass a test into a dense output array. In parallel, each thread has one element and needs to know its output position. The position is the number of passing elements before it, which is a prefix count.

A direct way to build it is one atomic add per passing thread on a shared counter. The atomic returns the thread's slot. That is correct, but atomics on one address are serialised by the hardware. When thousands of threads add to the same few addresses, they queue.

With wave intrinsics the work divides in two. Within a wave, `WavePrefixCountBits` gives each lane its position among the wave's passing lanes, and `WaveActiveCountBits` gives the wave's total. One lane then performs a single atomic add of that total and shares the returned base slot with `WaveReadLaneFirst`. Each passing lane writes at `base + prefix`. The number of atomics falls from one per passing thread to one per wave.

![Eight lanes, four of them visible, and the slots they write to](/images/2026-10-30-wave-ops-and-fxc-removed/wave-compaction.svg "A wave of eight lanes for illustration. One atomic add reserves four slots and each visible lane writes at the base plus its own prefix count.")

The method does not change the result, only how many threads touch memory.

## Where the foliage compaction spent its time

The foliage compaction from Track V picks the leaf triangles that won a pixel in the depth prepass, so the lit pass draws only those. It has two compute steps:

- `CSMark`: one thread per pixel sets the bit of the triangle that won that pixel in a bitset.
- `CSCompact`: for each plant instance it counts the set bits and copies those triangles' indices into one shared index buffer.

My plan had pointed at `CSCompact`, which counts bits and allocates output, a textbook use of prefix sums. I measured first, turning each step off in turn on the day woods. `CSMark` took 0.29 ms of the pass's 0.37 ms, and `CSCompact` only 0.06 ms. A wave version of `CSCompact` alone saved nothing measurable.

The reason `CSMark` was slow is in its memory access. Every foliage pixel did an atomic OR into the bit buffer. Neighbouring pixels mostly hold the same few triangles, so thousands of threads queued on the same few 32-bit words.

## The wave version

In `CSMark` the lanes of a wave now group themselves by word. Each round takes the first remaining lane's word, ORs together the bits of every lane that has that word, and one lane writes the result:

```hlsl
bool done = false;
while (!done)
{
    const uint first = WaveReadLaneFirst(word);
    if (word == first)
    {
        const uint bits = WaveActiveBitOr(mask);
        if (WaveIsFirstLane()) gVisibleBits.InterlockedOr(first * 4, bits);
        done = true;
    }
}
```

In each round, the lanes that share the first lane's word are the only active ones inside the `if`. They combine their masks, one atomic is issued, and they leave. The loop runs as many rounds as the wave has distinct words. Neighbouring pixels mostly hold the same few triangles, so a wave usually has only a few distinct words and the pass issues one atomic per distinct word in the wave instead of one per pixel. In the worst case, every lane has its own word and the cost is as it was.

`CSCompact` sums the per-instance counts across the wave and takes each lane's place in the output from a prefix sum, with one atomic on group-shared memory per wave instead of one per thread. My lanes hold a whole word of up to 32 visibility flags rather than one flag each, so I use `WaveActiveSum` and `WavePrefixSum` over `countbits(bits)`, not the single-flag `CountBits` forms. The arithmetic is the same.

### A bug in the first version

My first version of the `CSMark` loop left with `break` instead of a flag. The images showed leaves missing from the canopy: the background shows through in the lower half of the image below. Which lanes are active at a wave intrinsic is decided by the compiler's control flow, and DXC had moved the wave operations on the `break` path to after the loop. Lanes that left in different rounds then ran them together and ORed bits into the wrong words. Ending the loop with a flag instead fixed it, and I checked the images against G7 afterwards.

![The compaction with the flag loop above and the broken break loop below](/images/2026-10-30-wave-ops-and-fxc-removed/broken-break-vs-fixed.jpg "The far gate pose. Top: the fixed version. Bottom: the version that left the loop with break, where leaves are missing and the background shows through the canopy.")

### Results of G8

The images match G7's in all five scenes (`--no-taa`, mean difference 0.000). The hallway and the house are bit-identical. In the woods a few hundred pixels out of 3.7 million differ, nearly all by a few levels (`into_the_bank`: 133 changed, 5 by more than 12). These are coplanar leaves at exactly the same depth. Which one wins depends on the order in which the compaction writes them, and that order was never fixed. Two G7 runs differ from each other in the same way.

The pose that cost the most before, into the bank, has the same image as G7.

![The woods at the into-the-bank pose after G8](/images/2026-10-30-wave-ops-and-fxc-removed/into-the-bank-g8.jpg "Into the bank, G8. The visibility pass for this pose went from 1.030 to 0.124 ms.")

Mean GPU milliseconds, TAA on:

| Scene | Visibility pass, G7 | G8 | Frame, G7 | G8 |
|---|---|---|---|---|
| Hallway | not used | not used | 3.991 | 3.910 |
| House | not used | not used | 3.690 | 3.652 |
| Kitchen | not used | not used | 3.255 | 3.247 |
| Woods | 0.363 | 0.098 | 8.584 | 8.350 |
| Night woods | 0.148 | 0.106 | 8.941 | 8.891 |

The hallway, the house and the kitchen compact nothing, so their changes are noise. In the woods, one small loop removed about a quarter of a millisecond from the frame. I measured it by alternating the old and the new shader in the same build, two rounds each, to separate the change from run-to-run noise. My verdict is that Shader Model 6 pays. The larger steps it allows, mesh shaders and bindless resources, each need a track of their own.

## Removing FXC

FXC is Microsoft's older shader compiler (Shader Model 5). I had kept it since G3 for comparisons and as a fallback. That meant two of everything: two code paths in the compiler, FXC halves in every shader test, and `#if` branches in the shaders, such as the loop style of the shadow taps and the wave operations in the compaction, which FXC cannot compile.

G9 removes it. The `--shader-compiler=fxc` flag and `--fxc-files` are gone (`dxc` is still accepted so that old scripts run), as are the FXC compile path, the DXBC reflection in the binding check and the FXC cases in the tests. The shaders now have one form: the shadow taps are always unrolled and the compaction always uses wave operations. `d3dcompiler` stays linked for one helper, `D3DCreateBlob`, not for compiling.

There is also no silent fallback now. If `dxcompiler.dll` or its signer `dxil.dll` is missing, or the GPU cannot run Shader Model 6, the renderer stops and says why. With `dxil.dll` moved away, the game logs: "DX12 renderer cannot start: dxil.dll was not found next to the executable, so DXIL could not be signed". Before this, it switched to FXC without saying so. The build also stops if the Windows SDK has no DXC.

### Why cold start fell from 73 s to 3.7 s

A cold start is the first run with an empty shader cache. The engine compiles each shader to bytecode and stores the result under a key made from the source, its defines and the compiler's version. A warm start loads the bytecode from the cache. A cold start must compile everything before the first frame, so it measures compile cost directly.

The fall from 73 s was not caused by deleting FXC. It came from three earlier steps, each measured when I made it:

- **A faster compiler.** At G0, 67 programs compiled with FXC one after another took 69.7 s. DXC compiled the same programs about nine times faster. Its scene pixel shaders took 0.4 to 1.0 s each against 3 to 17 s on FXC. The first cold start measured with DXC was 17.0 s, because the driver also had to translate the new bytecode once. With the driver's own cache warm, DXC compiling one program at a time gave 10.6 s. This was G3.
- **Parallel compiles.** Shader compilation is CPU work and each program is independent. At startup the registry starts every program that is not in the cache on worker threads, one per core minus one for the renderer, up to 16. The renderer creates its other resources meanwhile and waits for a program only when it reaches it. This took the first frame from 10.6 s to 3.2 s.
- **The registry (G4).** Parallel compiles first depended on a list written by the previous run. With the registry declaring all 70 programs up front, even a first run gets the parallel time.

Removing FXC did not change any of that. The GPU frame times are identical between G8 and G9, as they should be, because the game had not used FXC since G3. What deleting the second path changed was in the tests and the maintenance. `ShaderCompileTests` had compiled all 70 programs twice, and its FXC half took most of its 78 s. It now takes about 9 s, and the whole suite about 20 s instead of 85 s.

## Track G measured against its start

Cold start, with the shader cache emptied (two runs each for G9, so the game averages 3.7 s):

| | G0 (FXC, one at a time) | G9 |
|---|---|---|
| Game, empty cache | 73.1 s | 3.6 s / 3.8 s |
| Editor, empty cache | 78.4 s | 3.5 s / 3.2 s |
| Game, warm cache | 2.95 s | 2.0 s / 2.3 s |
| Editor, warm cache | 1.7 s | 2.1 s / 1.9 s |

The warm starts are within run-to-run variation of G0. The editor's has varied between 1.7 and 2.1 s across the track. Loading the shaders from the cache costs 29 ms, against 33 ms at G0.

Mean GPU milliseconds over each scene's bench poses, TAA on:

| Scene | G0 | G8 | G9 |
|---|---|---|---|
| Hallway | 3.995 | 3.910 | 3.882 |
| House | 3.721 | 3.652 | 3.664 |
| Kitchen | 3.339 | 3.247 | 3.246 |
| Woods | 8.791 | 8.350 | 8.333 |
| Night woods | 9.153 | 8.891 | 8.833 |

Every scene is 2 to 5 percent faster than at G0.

G9 is identical to G8 in all five scenes (`--no-taa`, mean difference 0.000). Against G0 the mean differences are 0.02 to 0.10 out of 255. The hallway shows where they come from:

- G0 to G2's FXC build: 0.102. That is G2's `precise` fix to the stain and wear hashes, which moved FXC's stains a little to where DXC draws them.
- G2's FXC to G2's DXC: 0.002.
- G2's DXC to G9: 0.000.

So the compiler change is invisible, and the only image change in the track was deliberate.

![The night woods at the path's start, as G9 draws them](/images/2026-10-30-wave-ops-and-fxc-removed/woods-night-g9.jpg "The night woods at the path's start in G9, drawn with DXC only.")

Track G leaves behind DXC at Shader Model 6.5 with parallel startup compiles, one registry of all 70 programs, live shader reload, structs and functions shared by C++ and HLSL, 27 root signatures written as data with every binding checked, and one measured use of Shader Model 6.

The developer guide has a new "Shaders (Track G)" section that maps this layer and says how to add a shader.

## The bug and speed sweep

Before merging the branch, I had all of it (121 files, about 5,300 lines) reviewed in three parts: the compiler and startup, live reload, and root signatures with the shaders. I checked each finding against the code before fixing it. None was a crash or a wrong image in normal use. These are the problems that were found:

- **The shader cache could reuse old shaders after a DXC update.** The cache key packed the compiler's and the signer's versions into one number, and the two overlapped, so two different DXC builds could produce the same key. The versions are now hashed together. Every cached shader compiles once more on the next start, about 3.5 s.
- **Exceptions on worker threads.** A failure on a startup compile thread would have ended the program, and one on the reload worker would have surfaced in the middle of an editor frame. Both are now reported as a failed compile or reload, and nothing is swapped.
- **After a reload, the binding check looked at the old shaders.** The record of each pipeline's description kept pointing at the shaders from before the edit. It now takes the new ones.
- **A reloaded effect could take a while to show.** The rain's shelter map and the TAA, fog, sun-shaft and cloud histories survived a reload, so a new shader's result blended in over a second or so. They are cleared on reload now.
- **Garbled non-ASCII compiler messages.** DXC writes UTF-8 and the log read it byte by byte. It now decodes it.

One finding concerned the wave operations themselves. In `CSCompact`, each pass of the index loop ran wave operations with whichever lanes were still in the loop. Lanes left the loop on different passes, and Shader Model 6 does not guarantee that they line up again for the next wave operation. It worked on my GPU, but it might not on another. Every lane now makes the same number of passes, and a lane with no work carries empty bits, so the wave operations always run with the whole wave. Images and speed did not change.

### A test for the compaction

The broken first version of G8 had been caught only by looking at bench images. `LeafPopTests` now renders the plants at 4 m and 6 m with and without the compaction and fails if the results differ beyond depth ties. Today they differ in 2 to 3 pixels out of 100,000. The broken G8 version was missing 17 to 20 percent of the plant pixels, so the test fails it at once. I checked that by putting the broken loop back for one run.

![The plants at 4 m, compacted and drawn whole](/images/2026-10-30-wave-ops-and-fxc-removed/compacted-vs-whole.jpg "The plants at 4 m. Left: compacted. Right: drawn whole. The same leaves.")

### Checked and left alone

I compared all 27 root signatures with the hand-written code they replaced, parameter by parameter, and found them identical, including samplers, visibility and flags. The shared layouts pack the same in both languages, and live reload swaps only between frames, after waiting for the GPU. Three minor items stay as they are, among them `shader_list` keeping a program's first compile time after a reload.

### Sweep results

Images are identical to G9 in all five scenes (`--no-taa`, mean difference 0.000). Speed is within noise. Mean GPU milliseconds, TAA on:

| Scene | G9 | Sweep |
|---|---|---|
| Hallway | 3.882 | 3.894 |
| House | 3.664 | 3.649 |
| Kitchen | 3.246 | 3.233 |
| Woods | 8.333 | 8.350 |
| Night woods | 8.833 | 8.832 |

`ctest` passes 118 of 118 in Release, and `Validate-Engine.ps1` passed before and after the fixes: 118 of 118 Debug tests, the editor smoke test, and the smoothness check (1,500 frames, no hitches, typical 9.2 ms).

The frame-spike walk passed. The woods had a mean of 9.45 ms, a worst frame of 11.21 ms and no spikes. The night woods had a mean of 9.87 ms, a worst of 13.58 ms and two spikes against a limit of three. Both spikes had a normal GPU time of about 10 ms and a normal record time, with the wait in `Present`, which points to the machine and not the renderer.

## Open issues

- The compaction's output order is not deterministic, so tied leaf pixels can differ from run to run. A sort or a stable placement would fix it at some cost. It was like this before G8.
- Static samplers with `MaxLOD` 0, the per-pass root-constant blocks and a few other items carried over from G7 are still open.
- Three decisions of mine remain: the integer hash from G2, which would re-roll every stain, wear patch and rain pattern, HLSL 2021, and `nvcc` in the build for the CUDA branch of the shared headers. The integer hash is next, on its own branch after the merge.
- Mesh shaders with meshlet culling, bindless resources and async compute each need a track of their own. Mesh shaders are the likely answer to what stopped V5 and V6 in Track V.
