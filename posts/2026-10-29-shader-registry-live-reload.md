---
title: A registry for every shader program and live shader reload in the editor
date: 2026-10-29
order: 2
summary: Every shader program is now declared once, and the editor recompiles and swaps in the programs affected by a saved shader file without a restart.
tags: renderer, tools, editor
cover: /images/2026-10-29-shader-registry-live-reload/live-tinted.jpg
---

After G3, the engine compiled with DXC and compiled in parallel, but two things still got in my way. Which shaders existed, and in which variants, was written down in 25 loader functions and in `#define` strings scattered across the renderer. And every shader edit still needed a restart of the editor. This post covers G4, a registry that declares every shader program once, and G5, live reload, which recompiles only the programs that an edit affects and swaps them into the running editor.

## Shader permutations and how I declared them

> **Background: shader permutations**
>
> One HLSL file often has to produce several shaders. Foliage needs a pixel shader that discards pixels below an alpha threshold. Opaque walls do not. A debug view needs extra output. The usual tool is the preprocessor: the file contains `#if ALPHA_TEST` blocks, and the build compiles the file once for each combination of switches it needs. Each combination is a *permutation*, with its own bytecode.
>
> The alternative is one large shader that tests a flag at run time. That costs registers and branches on every pixel, even when the feature is off. Permutations remove the unused code, so each one is smaller and faster, but they have costs of their own. Every new switch can double the number of combinations, compile time and cache size grow with that number, and someone has to know which combinations the game really uses. Compiling every possible combination is wasteful, so the engine has to know the used ones.

Before G4, my engine made permutations at each call site by putting `#define` lines in front of the source string. The scene pixel shader, for example, existed in seven variants, each written out by hand where it was compiled. Nothing listed them in one place.

### One table row per program

`Engine/Renderer/ShaderPrograms.cpp` now has one row for each program, 70 in all. A program is one entry point of one file, compiled for one stage with a set of variant defines, and bound with one root signature. A row holds its name, file, entry point, stage, defines and root signature:

```cpp
{ SP::ScenePSFoliage, "ScenePSFoliage", "Scene.hlsl", "PSMain", SS::Pixel,
  "ALPHA_TEST FOLIAGE MASK_IN_PREPASS", RS::Scene },
```

The renderer asks for a program by name, for example `CompileProgram(ShaderProgram::ScenePSFoliage)`. The registry turns the defines into `#define NAME 1` lines in front of the source, compiles through the same cached call as before, and records what the compile cost.

This replaced the 25 loader functions and the hand-written define strings. `DX12Shaders.cpp` no longer exists. Adding a variant is now one enum value and one table row. A compile-time check keeps the enum and the table in the same order, so a missing or misplaced row is a build error. `ShaderCompileTests` compiles every program on both compilers and no longer keeps a list of its own.

## Includes, dependencies and error locations

The registry also has to know which files a program reads. That information is needed for error messages now, and for live reload next.

> **Background: includes and the `#line` directive**
>
> An HLSL file pulls in shared code with `#include`. Before the compiler sees the source, the includes are expanded into one long string. If an error is reported against that string, the line number refers to the expanded text. An error at "line 2,000" tells me nothing about which file is wrong.
>
> The `#line` directive fixes this. `#line 120 "Shadows.hlsli"` tells the compiler that the next line should be reported as line 120 of that file. If the expander writes a `#line` at the start of each file and another after each include returns, the compiler's messages name the real file and the real line.
>
> The expansion also gives a program's *dependency list*: every file that went into its source.

My expander follows each `#include "..."` itself. For every file it writes `#line 1 "name"` first, and after an include it writes `#line N "name"` for the line after the `#include` in the including file. An include inside a `//` comment stays text, so documentation may quote one. Includes can nest to a depth of eight, and a missing include stops the compile with the name of the includer and the line.

An error in an include now reads like `Shadows.hlsli(120)`, not a line of one long string. A test checks this with a deliberately broken include. The expander also records every file it reads, so each program carries its own dependency list: its own file plus each include, at any depth. Live reload uses that list.

## Startup compiles from the registry

In G3, programs compiled in parallel only if the previous run had written them into `programs.txt`. A fresh checkout, or a new variant, still compiled one at a time. The registry already knows every program, so the list is no longer needed. As soon as the GPU device exists, the registry starts every program that is not in the cache on worker threads. The list file is gone.

Startup now logs one line:

```
Shader programs: 67 used of 70 declared, 0 from the cache, 67 compiled
(65 on startup workers, 11227 ms of compiling; slowest ScenePSDebugViews 1404 ms),
1246 KB of bytecode.
```

The 11.2 seconds of compiling is the sum of the compile times across workers. The time from start to the first frame is in the table below, and it is much shorter because the compiles overlap. Two of the 67 compiles were not made by workers.

First frame with the shader cache emptied and no program list, two runs each:

| | G3 without a list, one at a time | G4 | Warm cache |
|---|---|---|---|
| Game | 10.6 s | 3.3 s and 3.5 s | 1.9 s |
| Editor | 10.3 s | 3.1 s and 3.2 s | 1.8 s |

Even the first run of a fresh checkout now has the parallel time that G3 reached only after a list existed. The game uses 67 of the 70 programs. The editor adds the model preview's.

## Seeing what was compiled

The registry keeps what each program's last compile cost, and I made that visible in three places.

- The log line above.
- A Shaders section in the Renderer panel. It shows the compiler and model, the number of programs and their size, how many came from the cache, and the slowest compiles.
- A new MCP tool, `shader_list`, with an optional filter. It lists each program with its file, defines, root signature, target, source (cache, startup worker or compiled), time and size.

![The Renderer panel's Shaders section: DXC with Shader Model 6.5, 69 of 70 programs, all from the cache](/images/2026-10-29-shader-registry-live-reload/renderer-shaders.jpg "A crop of the Renderer panel with a warm cache. The compiler is DXC at Shader Model 6.5, 69 of 70 programs are in use, 1271 KB, and all 69 came from the cache.")

I checked `shader_list` headless with the filter `Sun`. It listed four programs, and the totals still covered all of them.

### Results of G4

The images are identical to G3's in all five scenes, with a mean difference of 0.000 under `--no-taa`. The hallway and the house are exact, and the woods' few-pixel maxima are rain and wind. That is expected, because `#line` changes only the debug information and not the code. Mean GPU time over each scene's poses in milliseconds, from G3 to G4:

| Scene | Default | `--no-taa` |
|---|---|---|
| Hallway | 3.976 to 3.862 | 3.709 to 3.677 |
| House | 3.703 to 3.690 | 3.621 to 3.505 |
| Kitchen | 3.275 to 3.317 | 3.073 to 3.095 |
| Woods | 8.619 to 8.596 | 8.235 to 8.294 |
| Woods at night | 8.858 to 8.931 | 8.674 to 8.626 |

All of these are within noise, since the compiled code is the same. A Debug editor under the D3D12 debug layer starts with no errors, and all 67 programs compile on workers. The Release build is clean, and `ctest` passes 117 of 117. A walk through the woods had a mean of 9.56 ms and a worst frame of 11.63 ms, and the night woods had a mean of 9.94 ms and a worst frame of 12.91 ms, with no spikes in either.

## How live reload works

Live reload has three problems to solve: noticing that a file changed, building new shaders from it, and putting them into a running renderer without breaking the frame that is being drawn.

> **Background: pipeline state objects and frames in flight**
>
> In D3D12, a draw call does not use a shader directly. It uses a *pipeline state object*, a PSO. A PSO bundles the shaders with the root signature, the vertex layout, and the blend, depth and raster state. It is immutable. Creating one is where the driver translates the bytecode into GPU code, which makes it expensive. To change a shader, I have to create a new PSO, and I cannot edit the old one.
>
> The CPU and the GPU also work at different times. The CPU records a frame's commands into a command list, and the GPU runs them later. At any moment, the GPU may still be executing commands from one or two frames that the CPU has already finished with. Those commands may refer to the old PSO. If I release or replace it too early, the GPU reads freed memory.
>
> There are two usual answers. One is to retire the old object, keep it alive, and release it after a fence shows that the GPU has passed the frames that could use it. The other is to wait for the GPU to finish all queued work before swapping. The wait is a small stall, but it is simple and it is correct.

> **Background: noticing that a file changed**
>
> An operating system can notify a program when a file changes, and a program can also read the folder's file times on a timer. A save is rarely one instant. An editor may truncate a file and then write it, and a compile that starts between those two steps would read half a file. A watcher therefore has to wait for the file to settle. It also helps to compare content, because some tools rewrite a file with the same bytes.

### Watching the folder

The editor polls `Engine/Renderer/Shaders` twice a second, including its `Shared/` headers. A file is handed over only after it has held still for one poll and its content has changed. The folder is the one the registry reads, which is the source tree when I start the editor from the repository root.

### Which programs, and how the pipelines are made again

When a file changes, the registry looks up which programs read it, directly or through an include. Only those are recompiled. A save to `PostProcess.hlsl` reloads two programs. A save to `Shadows.hlsli`, which every scene shader includes, reloads 21.

Every pipeline in the renderer is now created through one of two helpers, one for graphics and one for compute. Each helper remembers the pipeline's description and the registry programs its shaders came from. The registry gives the same bytecode object for a program until a reload commits a new one, and it keeps a table from bytecode address to program, so a description's bytecode pointer identifies its program. With that record, a pipeline can be made again from new bytecode with everything else unchanged.

The reload runs in the background.

1. A worker thread recompiles the affected programs in parallel, through the cache, and then creates the new pipelines from the new bytecode. D3D12 devices are free-threaded, so creating pipelines on a worker is allowed, and the editor keeps drawing meanwhile.
2. Before the next frame's command list is opened, the frame thread checks whether the reload has finished. If it has, it waits for the GPU once and swaps the new pipelines in. This engine uses the wait and does not retire old objects. The wait happens once for each finished reload, and only in the editor.
3. Skinned-mesh twins, which are made from a pipeline's description, are registered again and rebuilt the next time a skinned mesh is drawn.
4. Cached shadow tiles are redrawn, since the shadow shaders may have changed.

Files saved while a reload is running start the next reload when the first finishes.

![A worker thread finds the affected programs, recompiles them and creates pipelines; the frame thread waits for the GPU once and swaps them in](/images/2026-10-29-shader-registry-live-reload/reload-flow.svg "The reload path. The slow work happens on a worker thread. The frame thread only waits once and swaps pointers.")

### When a shader fails

A reload either swaps everything or nothing. If a compile fails, or the GPU refuses a pipeline, for example because the bindings no longer match the root signature, every old pipeline stays in use.

The error reaches me in two places. The status bar shows the first error with its file, line and column, which the `#line` work from G4 makes possible. The full messages are in the Console. When I fix the file and save again, the reload goes through.

The reload itself is also an MCP tool. `shader_reload`, with an optional `file`, recompiles, waits, and returns the programs, the pipelines, the times or the errors. It works in the live editor and headless, so an agent that drives the editor can edit a shader file and see the result.

The game does not watch shader files. It loads from the cache as before.

## Results of G5

Reload times in the live editor on the RTX 4070:

| Edit | Programs | Pipelines | Time |
|---|---|---|---|
| `PostProcess.hlsl`, new code | 2 | 1 | 95 ms |
| `Shadows.hlsli`, read by every scene shader, a comment added | 21 | 28 | 1.4 s, in the background |
| A file restored to content already in the cache | 2 to 21 | 1 to 28 | 9 to 40 ms |
| Every compiled program, all cached (test) | 67 | 72 | 39 ms |

The first screenshot is the hallway with the last line of the post shader tinted red, live, without a restart. The status bar at the bottom reads "Shaders reloaded: 2 program(s), 1 pipeline(s), 95 ms."

![The hallway tinted red after a live edit of the post shader](/images/2026-10-29-shader-registry-live-reload/live-tinted.jpg "The editor after saving a one-line change to PostProcess.hlsl. The frame is tinted, and the status bar reports 2 programs and 1 pipeline in 95 ms.")

I then broke the same line on purpose. The tinted shaders stay in use, and the status bar names `PostProcess.hlsl:194:51`.

![The same view after a broken edit, with the old shaders still drawing](/images/2026-10-29-shader-registry-live-reload/live-error.jpg "A broken edit. The tinted frame stays, and the status bar says the old shaders stay, with the file, line and column of the error.")

Restoring the file with git brought the original image back in 9 ms, because the shader was still in the cache.

### Images and speed

The images are identical to G4's in all five scenes, with a mean difference of 0.000 under `--no-taa`. The only per-frame addition is one check of whether a reload has finished. Mean GPU time in milliseconds, from G4 to G5:

| Scene | G4 | G5 |
|---|---|---|
| Hallway | 3.862 | 3.911 |
| House | 3.690 | 3.807 |
| Kitchen | 3.317 | 3.223 |
| Woods | 8.596 | 8.586 |
| Woods at night | 8.931 | 8.896 |

All of these are within noise.

### Tests

A new GPU test, `ShaderReloadTests`, works on a copy of the shader folder. It checks that an include reloads exactly the programs that read it, and that an edited post shader turns the next frame magenta. It checks that a broken include keeps the magenta frame and names `Tonemap.hlsli` and its line, that restoring the files restores the original frame, and that reloading all 67 programs draws the same frame. I also ran tint, error and restore in the live editor, as in the screenshots. The Release build is clean, and `ctest` passes 118 of 118.

### A frame-spike walk with a noisy result

I ran the frame-spike walk four times. The means were equal to G4's: 9.57 to 9.60 ms in the day woods and 9.89 to 9.95 ms at night.

- Two runs passed cleanly, with worst frames of 11.0 ms in the day woods and 13.3 ms at night in one, and 11.2 ms and 14.7 ms in the other.
- The other two each failed on one frame that did not repeat: 17.8 ms in the day woods and 15.2 ms at night.
- In those frames the GPU time and the recording time were normal, at 9.6 and 6.7 ms in one and 10.8 and 6.4 ms in the other. The same frames in the other three runs took 9.7 to 11.3 ms.

I read these as stalls from the machine and not as shader work. The GPU was at its power cap after the bench sweep. I cannot prove that, but the only work that reload adds to a frame is one check of whether a reload has finished.

## Open issues

- Reload does not rebuild root signatures. An edit that changes a shader's bindings is refused with a message until G7 builds root signatures from the registry.
- The watcher reports file names in lower case, because the asset watcher's keys are lower case. This is only cosmetic.
- The decision about an integer hash for the wear patterns is still open.
- G6 is next: one header for C++ and HLSL constants, so that the hand-written mirrors go away.
