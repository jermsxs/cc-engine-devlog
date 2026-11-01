---
title: A baseline for the shader layer, then DXC behind the existing compile call
date: 2026-10-28
order: 3
summary: I planned my own shader layer over Microsoft's DXC, measured the FXC baseline, and put DXC behind the existing compile call, cutting a cold start from 73 s to 17 s.
tags: renderer, performance, architecture
cover: /images/2026-10-28-a-shader-layer-over-dxc/hallway-fxc-dxc-diff.jpg
---

The visibility track had just closed, and my next speed-ups needed features that the engine's shader compiler cannot produce. Every shader in the engine was compiled by FXC, Microsoft's old compiler, for Shader Model 5. Wave operations, mesh shaders, bindless resources and inline ray tracing all need Shader Model 6, and Shader Model 6 needs a different compiler. I decided to start a new track for shaders, and to put audio aside for it so that I can keep working on graphics and low-level speed. I also want to use the NVIDIA card fully, eventually including CUDA, and a clean shader layer is the base for that.

This post covers the plan, the baseline I measured before changing anything (step G0), and the first change, DXC behind the existing compile call (step G1).

## What a shader compiler does

> **Background: from HLSL to GPU code**
>
> A shader is written in HLSL, a C-like language. A GPU cannot run that text, so it goes through two translations. A compiler turns the text into bytecode: an intermediate form that is independent of any particular GPU. The graphics driver later turns the bytecode into the machine instructions of the specific GPU in the machine that runs the game. The driver step happens when a pipeline state object that uses the shader is created.
>
> Microsoft has shipped two compilers for HLSL. **FXC** is the older one. It emits **DXBC**, the bytecode format of DirectX 10 and 11, and it stops at Shader Model 5. **DXC** is the newer one. It is built on the LLVM compiler project and emits **DXIL**, a bytecode based on LLVM's intermediate representation. DXC supports Shader Model 6 and later. D3D12 accepts only signed DXIL: a separate library, `dxil.dll`, validates the bytecode and signs it.
>
> A **shader model** is a versioned set of capabilities: which instructions, data types and resource rules a shader may use. The compile target names it together with the stage, so `ps_5_0` is a pixel shader for Shader Model 5.0 and `ps_6_5` is one for 6.5. The device reports the highest model it runs. Mine reports 6.7.

![HLSL source going through FXC to DXBC or through DXC to signed DXIL, then through the driver to GPU code](/images/2026-10-28-a-shader-layer-over-dxc/compile-path.svg "Two compile paths. The compiler output is bytecode in both cases, and the driver produces the final GPU code.")

## What the engine had

Before planning anything I surveyed the shader code. The numbers below come from the source and from the installed Windows SDK.

- **Compiler.** `ShaderCompiler.cpp` called `D3DCompile`, which is FXC, through one function, `CompileShaderOrThrow(source, entry, target)`. A disk cache from my earlier caching work keys on the expanded source, the entry point, the target, the flags and the compiler version.
- **Sources.** The shader folder has 52 files. Twenty-five functions named `XShaderSource()` each load one file and expand its `#include` lines by hand.
- **Compile calls.** There are 64 calls to `CompileShaderOrThrow` in 16 renderer files: 26 compute shaders, 24 pixel shaders and 14 vertex shaders, all at Shader Model 5.0. All of them ran one after another at startup.
- **Variants.** A variant is made by putting `#define` lines in front of the source string at the call site. The scene pixel shader exists in several variants for alpha testing, foliage, rectangular lights and debug views, and each one was written out by hand.
- **Root signatures.** There are 27, built in C++. A root signature tells the GPU how a shader's registers map to the resources the CPU binds. Nothing checked that a shader's registers matched one.
- **Copies kept in step by hand.** `ShaderConstants.h` mirrors 17 HLSL structs. About 39 more comments mark constants and functions that exist in both HLSL and C++.
- **Reload.** A shader edit needed a restart.
- **Cost of a cold cache.** The scene pixel shader variants took 3 to 17 seconds each with FXC.

The device already reports Shader Model 6.7 through the Windows 11 D3D12 runtime, so Shader Model 6.6 needs no Agility SDK. DXC is also already installed with the Windows SDK, as `dxcompiler.dll` and `dxil.dll`. It is a dependency of the same kind as FXC and the D3D12 headers.

## Why a layer of my own, and not a compiler of my own

I looked at what other engines do. Unreal, Unity and Godot all use the vendor's compiler for each platform: DXC, glslang, or the console makers' own tools. They put their effort into the layer above it: managing permutations, caching, reflection and cross-compiling.

Writing my own compiler would not give me a faster GPU program. D3D12 accepts only DXIL that Microsoft's validator has signed, so a compiler of mine would still have to emit valid DXIL. The NVIDIA driver then re-optimises that bytecode into machine code anyway. It would cost years and return no speed.

So the plan follows the same split. Microsoft's DXC compiles HLSL into DXIL, and everything above it is mine:

- one place that declares every shader program and its variants;
- one source of truth for structures shared by C++, HLSL and later CUDA, in place of hand-kept copies;
- checks of every shader's bindings against the engine's root signatures;
- fast iteration, through parallel compiles and live reload in the editor.

The plan has ten steps, G0 to G9. Each step is measured, and the game keeps running after each one. Images stay identical unless a step says otherwise.

## G0: measuring before changing anything

> **Background: why baseline before switching**
>
> A compiler switch changes the machine code of every shader at once. Three things can change: how long compiling takes, how fast the shaders run, and what they draw. Floating-point results can differ in the last digits when a compiler orders operations differently. If I switch first and measure afterwards, I have nothing to compare against, and I cannot tell a real regression from a difference in how I measured.
>
> So the baseline has to be recorded with the old compiler, with the same scenes, poses and settings that I will use later. A benchmark number also needs a noise estimate, which means repeating the run.

I added one flag, `--shader-report=path.csv`. At exit it writes one row for every shader compile: the file, the variant defines, the entry point, the target, the cache digest, whether the cache answered, the time and the size of the bytecode. The first line of the file gives the totals and the time from process start to the first presented frame. The compile call itself did not change, so the cache keys and the images stayed the same.

I also wrote an inventory, `Docs/ShaderInventory.md`. It lists all 69 programs from 24 files, the variants of each and the root signature each one uses. It is the checklist for the later steps.

### Startup

I ran the game and the editor with the shader cache moved aside, and then twice with it filled. These are Release builds on an RTX 4070.

| Run | Compiles | Compiling or loading | First frame |
|---|---|---|---|
| Game, cold cache | 67 misses | 69.7 s | 73.1 s |
| Game, warm cache (two runs) | 67 hits | 33 ms | 2.95 s and 2.90 s |
| Editor, cold cache | 69 misses | 67.3 s | 78.4 s |
| Editor, warm cache (two runs) | 69 hits | 34 ms and 33 ms | 1.70 s and 1.79 s |

On a cold cache the compiles are serial and run on the render thread. In the editor run, seven pixel-shader variants of the scene shader took 49.8 of the 67.3 seconds, and the variant with the debug views alone took 16.7 seconds. The cloud noise shaders took another 11 seconds. Everything else together took about 6.5 seconds.

With a warm cache, shaders cost nothing worth noting at startup. The slow case is the first run after a shader change, which is what parallel compiles and live reload are for.

### GPU time

The second half of the baseline is the GPU time of every pass in the five scenes: the hallway, the house, the kitchen, and the two woods scenes. I measured at 1440p and took the mean over each scene's camera poses. I ran each scene twice, once with the default settings and once with `--no-taa`. Timings use the default. Image comparisons use `--no-taa`, because temporal anti-aliasing blends each frame with earlier ones, and a frame that depends on history cannot be compared pixel by pixel.

| Scene | Default (ms) | `--no-taa` (ms) |
|---|---|---|
| Hallway | 3.995 | 3.649 |
| House | 3.721 | 3.779 |
| Kitchen | 3.339 | 3.069 |
| Woods | 8.791 | 8.523 |
| Woods at night | 9.153 | 8.855 |

The house is about the same with and without TAA. Its runs vary by 0.1 to 0.2 ms, which is more than TAA's cost of about 0.2 ms, so I treat differences below that as noise.

## G1: DXC behind the existing call

The goal of G1 was small. I wanted the engine to be able to compile any shader with DXC, with nothing else changed, so that I could look at what DXC does to the images and the timings before committing to it.

### How I set it up

- **One call, two back ends.** Every shader still goes through `CompileShaderOrThrow`. Behind it there are now two compilers: FXC, which stays the default for this step, and DXC. A flag, `--shader-compiler=fxc|dxc`, selects one.
- **Loading DXC at run time.** The build copies `dxcompiler.dll` and `dxil.dll` from the installed Windows SDK next to the executables. Nothing is vendored or committed. The engine loads them with `LoadLibrary` and `DxcCreateInstance`, the same way it already loads the .NET host for C# scripting. If either DLL is missing, the log says which one, and the engine falls back to FXC.
- **Language rules.** DXC compiles with HLSL 2018, the language version closest to FXC's. The same code then means the same thing. A newer language version waits until every shader is on DXC.
- **Target.** The 64 call sites keep their `_5_0` target strings. The DXC back end raises the model, so `ps_5_0` becomes `ps_6_0`. I chose Shader Model 6.0 as the first target because it is the smallest step away from what FXC compiled.
- **The cache.** The cache key holds the compiler's version. FXC's keys did not change, so the existing cache stayed valid, and the results of the two compilers sit side by side. Switching between them costs nothing.
- **The test.** `ShaderCompileTests` now compiles every case with both compilers and checks the results against the C++ copies of the constant buffers.

That last point needs a short explanation. *Shader reflection* lets a program ask a compiled shader what it uses: which constant buffers it reads, how each buffer is laid out, and which resources it binds. My test uses reflection to compare 10 constant buffers and 2 structured buffers, field by field, with the C++ tables that mirror them. If someone changes a struct on one side only, the test fails. FXC's DXBC is read with the D3D11 reflection interface. DXIL cannot be read that way, so the DXC side reflects through `IDxcUtils::CreateReflection`, which returns the D3D12 reflection interface.

## Results

### Every shader compiles on DXC unchanged

All 54 test cases compile on DXC without edits, and every buffer layout matches. The only message was a warning about a loop variable that hides another one in `Visibility.hlsl`. So the work I had planned for G2, which was making the shaders compile, is not needed. G2 becomes a step to explain differences in speed and in images.

### Compile time

DXC compiles about nine times faster on a cold cache.

| | FXC (G0) | DXC (G1) |
|---|---|---|
| Game, time compiling | 69.7 s | 8.0 s |
| Game, first frame | 73.1 s | 17.0 s |
| Editor, first frame | 78.4 s | 15.7 s |

The scene pixel shaders take 0.4 to 1.0 seconds each on DXC, against 3 to 17 seconds on FXC. Most of the remaining cold start is the driver translating the new DXIL once. Warm starts are unchanged: 2.9 s for the game and 1.7 s for the editor.

### Images

The images are close but not bit-identical. I compared each pose of each scene with `--no-taa`. The measures are the mean difference per pose out of 255, and the share of pixels that differ by more than 12.

- FXC compared with its own G0 run is pixel-identical. The hallway's maximum difference is 0. The woods' maximum is at most 7, with every mean at 0.00. The woods have moving rain and wind, which account for the few pixels that change.
- DXC differs from FXC by a mean of 0.01 to 0.13 out of 255 per pose. At most 0.2 percent of the pixels change by more than 12.
- The largest case is the hallway's north corridor, with a mean of 0.64. The difference is on the near ceiling and around the nearest lamp.

The first image is the north corridor: FXC on the left, DXC in the middle, and the difference multiplied by 16 on the right. The second is the night woods looking into the bank, in the same order.

![Hallway north corridor: FXC, DXC and the difference multiplied by 16](/images/2026-10-28-a-shader-layer-over-dxc/hallway-fxc-dxc-diff.jpg "FXC, DXC and the difference multiplied by 16. The two frames look the same. The difference concentrates on the near ceiling and around the nearest lamp.")

![Night woods: FXC, DXC and the difference multiplied by 16](/images/2026-10-28-a-shader-layer-over-dxc/woods-night-fxc-dxc-diff.jpg "FXC, DXC and the difference multiplied by 16. In the difference panel the brightest pixels lie along the trunk edges.")

A pattern concentrated on one surface points to a lighting term that is rounded differently, not to a wrong result. I did not find the cause in G1. It is the subject of the next post.

### Speed

Mean GPU time over each scene's poses, in milliseconds:

| Scene | Default, FXC | Default, DXC | `--no-taa`, FXC | `--no-taa`, DXC |
|---|---|---|---|---|
| Hallway | 3.995 | 4.197 | 3.649 | 3.879 |
| House | 3.721 | 3.716 | 3.779 | 3.601 |
| Kitchen | 3.339 | 3.341 | 3.069 | 3.106 |
| Woods | 8.791 | 8.867 | 8.523 | 8.592 |
| Woods at night | 9.153 | 9.135 | 8.855 | 8.768 |

Every scene except the hallway is within run-to-run noise. To measure the noise I ran the hallway and the night woods again on FXC. The hallway's scene pass is about 0.2 ms, or 5 to 6 percent, slower on DXC, and it is slower consistently across the hallway's poses. That is the first thing G2 looks at.

## Verification

- `ShaderCompileTests` builds and reflects all 54 cases with both compilers. DXC adds about 2 seconds to the test.
- I ran the game and the editor cold and warm with `--shader-report`.
- I benched all five scenes on DXC, with the default settings and with `--no-taa`, and compared them with G0 using `Compare-Bench.ps1`.
- The Release build is clean, and `ctest` passes 117 of 117.

## Open issues

- The hallway's scene pass is 0.2 ms slower on DXC. I have not looked at the DXIL to see why.
- DXC's images differ slightly from FXC's, and I have not yet found which pass makes the ceiling and lamp differences.
- FXC stays the default until G3, so no player-facing build has changed yet.
- I corrected the plan's wording for G2. DXC's images cannot be assumed to be bit-identical to FXC's, so each difference has to be explained and not simply required to be zero.
