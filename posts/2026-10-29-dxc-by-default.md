---
title: Matching FXC on DXC, then making DXC the default at Shader Model 6.5
date: 2026-10-29
order: 1
summary: DXC now draws the same images as FXC and runs faster. I found two causes, made DXC the default at Shader Model 6.5, and cut a cold start from 10.6 s to 3.2 s.
tags: renderer, performance
cover: /images/2026-10-29-dxc-by-default/ceiling-normals-fxc-dxc.jpg
---

The day before, DXC compiled every shader in the engine unchanged, but it left two open questions. The hallway's scene pass was about 0.2 ms slower on DXC than on FXC, and DXC's images differed slightly from FXC's. I did not want to make DXC the default while I could not explain either. This post covers G2, where I found both causes, and G3, where DXC became the default compiler at Shader Model 6.5 and the startup compiles moved onto worker threads.

## Comparing two compilers by their images

> **Background: what "the same image" means after a compiler switch**
>
> Two compilers can produce different machine code for the same HLSL and still be correct. Floating-point arithmetic is the reason. A 32-bit float has a 24-bit significand, so every addition or multiplication rounds its result. Rounding makes the operations non-associative: `(a * b) * c` and `a * (b * c)` can differ in the last digits. A compiler is allowed to reorder operations when it thinks the result is close enough, and different compilers make different choices. Most shaders never show the difference. A shader that amplifies the last digits, such as a hash, does.
>
> So I do not require every pixel to be identical. I measure three things per pose, with temporal anti-aliasing off: the mean difference out of 255, the maximum difference, and the share of pixels that differ by more than a small threshold. A very small mean with scattered pixels is rounding. A difference concentrated on one surface needs an explanation, and I look for its cause: it may be rounding that a shader amplifies, or it may be a bug. To see the pattern, I amplify the difference image by a factor, usually 8 or 16, so that a difference of one or two levels becomes visible.

I used three tools for the search.

- A switch, `--fxc-files=Scene.hlsl,...`, which I added. It keeps the named shader files on FXC while the rest compile with DXC, so I can bisect by file.
- The engine's debug views, which draw one quantity at a time: normals, roughness, lighting only, shadow visibility and reflections.
- `Compare-Bench.ps1`, which compares two benchmark runs pose by pose and reports the mean and maximum difference and the share of pixels that changed by more than 12 out of 255.

## The slowdown: a constant array read by an index

The soft-shadow filter walks 12 sample offsets in a loop. The offsets are an array of constants, `kShadowTaps`, in `Shadows.hlsli`. Each tap reads one offset and samples the shadow map.

> **Background: constant data inside a shader**
>
> A constant that appears in the instruction stream, an immediate, costs nothing to fetch. A constant array that is read with an index the compiler cannot resolve has to live in memory, and each read is a load. When a loop is unrolled, the index of each iteration is known at compile time, so every element can become an immediate again. Unrolling has a price: the code gets longer, and a longer shader can use more registers. A compiler decides between the two forms with its own rules.

FXC turned the array into immediates. DXC kept it as a real array and read it with a computed index on every tap, for every light, on every pixel. That is the 0.2 ms.

I unrolled the two 12-tap loops on DXC with a macro, `SHADOW_TAP_LOOP`, so that every offset is a constant again. FXC keeps the loop, which is the form it already handled well. The hallway's scene pass went from 2.61–2.64 ms to 2.46 ms on DXC, which is faster than FXC's 2.52 ms.

## The image difference: a hash that depended on multiply order

The hallway's north corridor was the largest difference, with a mean of 0.64 out of 255 in G1. I bisected it in three steps.

1. With only `Scene.hlsl` on FXC and everything else on DXC, the images matched exactly, with a mean of 0.000. The difference was in the scene shader.
2. The debug views showed it on the ceiling's normals only, not on roughness, lighting, shadows or reflections.
3. Turning off parallax relief did not remove it, so relief was not the cause. Pinning one hash did.

The stains, wear patches and water marks are placed by a small hash, `WearHash`, in `SurfaceWear.hlsli`. It multiplies four numbers. The product reaches about 250,000, and at that size a float can only step by about 0.02. FXC and DXC multiplied the four numbers in a different order, which moved the hash's last digits, and with them the pattern. The ceiling's water-stain layer covered slightly different spots, so the ceiling's normals and the light catching them were slightly different.

The fix is the `precise` qualifier on the line that forms the product. It tells both compilers to keep the order that I wrote. The sky's `MoonHash` is the same function and got the same fix. I tried `precise` on the line before as well. It changed nothing and only cost more, so it is not there.

Top row, before: FXC, DXC and the difference multiplied by 8. Bottom row, after the fix. Before, the stain layer's bumps landed in different places. After, the mean difference is 0.0008 out of 255.

![The hallway ceiling's normals, FXC and DXC, before and after the precise hash](/images/2026-10-29-dxc-by-default/ceiling-normals-fxc-dxc.jpg "Ceiling normals in the north corridor. Top: FXC, DXC and the difference times 8 before the fix. Bottom: the same after the fix, with a difference that is black.")

### A warning on the way

One more small fix came out of the same work. DXC reported a warning in `Visibility.hlsl`. Under HLSL 2018 a loop variable stays in scope after its loop, so the `word` in a second loop hid the one in the first. I renamed it `bitWord`, and every shader now compiles on DXC without a warning.

### What the fix costs

`precise` keeps FXC from reordering the hash, and that costs FXC about 0.1 to 0.2 ms in the scene pass: the hallway went from 2.40 to 2.52 ms. That cost goes away for players once DXC is the default. On DXC the cost is about 0.03 ms.

The stain and wear patterns moved slightly on FXC as well, because FXC now follows DXC's order. Against G0, the `--no-taa` images differ by a mean of 0.04 to 0.10 out of 255 indoors. It is the same pattern placed a few millimetres differently, not a change of look.

A cheaper exact option exists: an integer hash. It would re-roll every stain, wear and rain pattern in every scene, so I treated it as a separate decision and did not make it here.

## Results of G2

Mean GPU time over each scene's poses at 2560×1440, with the default settings, in milliseconds:

| Scene | G0, FXC | G1, DXC | G2, FXC | G2, DXC |
|---|---|---|---|---|
| Hallway | 3.995 | 4.197 | 4.003 | 3.947 |
| House | 3.721 | 3.716 | 3.799 | 3.656 |
| Kitchen | 3.339 | 3.341 | 3.349 | 3.226 |
| Woods | 8.791 | 8.867 | 9.020 | 8.589 |
| Woods at night | 9.153 | 9.135 | 9.331 | 8.924 |

The opaque scene pass went from 2.496 to 2.457 ms in the hallway, from 2.806 to 2.642 ms in the woods, and from 3.742 to 3.545 ms in the night woods. DXC is now as fast as G0 or faster in every scene, and the night woods gain 0.23 ms.

The image comparison, with `--no-taa`, as the mean difference per pose out of 255:

| Scene | G2 FXC against G2 DXC | G0 FXC against G2 FXC |
|---|---|---|
| Hallway | 0.002 | 0.102 |
| House | 0.005 | 0.080 |
| Kitchen | 0.003 | 0.043 |
| Woods | 0.019 | 0.002 |
| Woods at night | 0.011 | 0.067 |

What remains in the woods is a few scattered leaf-edge pixels. The picture shows the gate pose: FXC, DXC and the difference multiplied by 8.

![The woods near the gate: FXC, DXC and the difference multiplied by 8](/images/2026-10-29-dxc-by-default/woods-gate-fxc-dxc.jpg "Woods, gate close, without TAA. The two renders match, and the difference panel is almost black apart from a few leaf-edge pixels.")

I also walked the woods and the night woods for 1,880 frames each. On DXC the woods had a mean of 9.60 ms and a worst frame of 11.06 ms, and the night woods a mean of 9.97 ms and a worst frame of 12.89 ms, with no spikes. On FXC the woods had a mean of 10.06 ms, and one run had a single 17.30 ms frame three frames before exit that did not return in a second run.

## G3: DXC by default, at Shader Model 6.5

After G2, DXC drew the same images and was as fast or faster everywhere, so it no longer needed a flag. FXC stays available through `--shader-compiler=fxc` until G9, for comparisons.

### What a shader model adds

> **Background: what Shader Model 6.x adds**
>
> Shader Model 6.0 is the first model compiled to DXIL, and it adds wave operations: instructions that let the lanes of one hardware wave, the group of threads that run in lockstep, exchange values or combine them without going through memory. Later minor versions add more. 6.5 brings mesh shaders and inline ray queries. 6.6 brings indexing into the descriptor heap from the shader, which is how bindless resources are written, and 64-bit atomics.
>
> A higher model is not free to adopt. The compiler may change how it encodes things that the shader does not use. The only reliable test is to compile at each model and measure.

I had planned to move to 6.6. I added a flag, `--shader-model=6.N`, so that I could test each step, and measured the night woods' scene pass with `--no-taa`, two runs each:

| Shader model | Scene pass (ms) |
|---|---|
| 6.0 | 3.529 and 3.531 |
| 6.1 | 3.534 and 3.531 |
| 6.2 | 3.519 and 3.524 |
| 6.5 | 3.528 and 3.518 |
| 6.6 | 3.743 and 3.740 |

Models 6.0, 6.1, 6.2 and 6.5 are equal. Model 6.6 draws identical images but is 0.21 ms, or 6 percent, slower on every pose, in two separate runs. The compiled code shows the reason. The only change that 6.6 makes is the way a shader names its textures and buffers. It requires a newer form, a "create handle from binding" operation plus an annotation. The arithmetic is the same, if anything slightly leaner. So the cost comes from how NVIDIA's driver treats that form, not from my shaders.

No shader uses a 6.6 feature yet, and 6.5 already includes mesh shaders and DXR 1.1. I made 6.5 the default. A device below 6.5 gets the highest model it supports, and below 6.0 the engine uses FXC. Model 6.6 stays one flag away for the programs that will need bindless resources or 64-bit atomics. I will look at it again with a newer driver, or with root signatures that index the descriptor heap, which is where the handle form should pay off.

## Compiling at startup in parallel

With a cold cache, startup was still a queue of compiles on one thread. DXC compiles faster than FXC, but a cold start took 10.6 seconds, because every program waited for the one before it. This matters after any shader edit. Changing a shared include such as `Shadows.hlsli` invalidates almost every program at once.

> **Background: compiling with a thread pool**
>
> Each compile reads its own source and produces its own bytecode, so compiles are independent jobs. A thread pool runs them in parallel: a fixed number of worker threads take jobs from a shared queue. The shared state is small. A mutex protects the queue and each job's state, and a condition variable lets a thread sleep until a job it needs is finished.
>
> The speed-up has limits. It cannot exceed the number of cores, and if the renderer thread is busy creating pipelines at the same time, it needs a core of its own. A run cannot be shorter than its slowest single job. Memory use grows with the number of compilers running together. And parallel compiles only shorten the compile stage. They do nothing for the driver's translation of DXIL into GPU code, which happens later.

![A queue of uncached programs feeding worker threads, with the renderer thread taking each finished job by its key](/images/2026-10-29-dxc-by-default/parallel-compile.svg "Startup compiles. The renderer takes a finished job, waits for a running one, or compiles a job that no worker has started.")

### How I implemented it

- **A list of programs.** Every program the renderer compiles from a shader file is written to a list, `Saved/ShaderCache/programs.txt`, with its file, entry point, target and variant defines.
- **Workers at startup.** At the next start, as soon as the GPU device exists, every listed program that is not in the cache is compiled on worker threads. The number is one per core, minus one for the renderer, up to 16. Each worker creates its own compiler instance.
- **The renderer keeps working.** While the workers compile, the renderer creates its buffers and pipelines in its usual order. When it reaches a program, it looks up the job by its cache-key digest. If the job is finished, it takes the bytecode. If it is running, it waits for that job and does not start another compile. If it has not started, the renderer compiles it itself, and the queue skips it.
- **Unused jobs are dropped.** Programs the list names that this run never asks for are dropped once the renderer is up.

The list is temporary. The registry that I describe in the next post replaces it.

### A bug found while measuring

The list was written once, when the renderer finished starting. The two skinned-mesh vertex shaders are compiled later, the first time a skinned mesh is drawn, so they never reached the list. I changed it so that a program first requested after startup writes the list itself. All 69 programs are now listed and all 69 compile on workers.

### Results of G3

First frame with an empty shader cache, two runs each, with the driver's own cache warm:

| | One at a time | In parallel | Warm cache |
|---|---|---|---|
| Game | 10.6 s and 10.8 s | 3.2 s and 3.2 s | 1.8 s |
| Editor | 10.3 s and 10.4 s | 3.2 s and 3.2 s | 1.75 s |

From G0 to G3, a start with an empty shader cache went from 73 seconds, with FXC one at a time, to 3.2 seconds. The renderer waited about 1.5 seconds in total for workers. The rest of the startup ran beside them, so the parallel start is about the warm start plus that wait. When the driver's cache is cold as well, for example on the first run after a driver update, its one-time translation of the new shaders comes on top. The editor's first run in that state took 16.9 seconds compiling one at a time.

Mean GPU time over each scene's poses, from G2 on DXC at 6.0 to G3 at 6.5, in milliseconds:

| Scene | Default | `--no-taa` |
|---|---|---|
| Hallway | 3.947 to 3.976 | 3.702 to 3.709 |
| House | 3.656 to 3.703 | 3.600 to 3.621 |
| Kitchen | 3.226 to 3.275 | 2.994 to 3.073 |
| Woods | 8.589 to 8.619 | 8.302 to 8.235 |
| Woods at night | 8.924 to 8.858 | 8.580 to 8.674 |

All of these are within run-to-run noise. The images are identical to G2's DXC images in all five scenes, with a mean difference of 0.000 and a hallway maximum of 0. I took no new screenshots, because nothing on screen changed.

## Verification

- The Release build is clean, and `ctest` passes 117 of 117. `--shader-compiler=fxc` still starts and renders.
- The `--shader-report` files from the parallel runs show workers compiling 67 programs that startup used, and two skinned programs that the startup reached later as cache hits. The warm runs have none.
- A walk through the woods on the new default had a mean of 9.56 ms and a worst frame of 11.85 ms with no spikes. The night woods had a mean of 9.94 ms and a worst frame of 14.16 ms, with one spike at frame 288, within the limit of three that the check allows. The DXC walk from G2 had means of 9.60 and 9.97.

## Open issues

- Parallel compiles depend on last run's list, so a fresh checkout or a new variant still compiles one at a time. The registry in G4 replaces the list.
- Model 6.6 needs a second look with a newer driver.
- The decision on an integer hash, which would remove the need for `precise`, is still open.
