---
title: Why I am building a horror engine from scratch
date: 2026-06-06
order: 1
summary: Why I am writing a horror engine in C++20 and DirectX 12 without third-party libraries, and what the frame loop and the first commit contained.
tags: architecture, retrospective
cover: /images/2026-06-06-starting-from-scratch/june-hallway.jpg
---

The git history of this project starts on 6 June 2026, so this is where the diary starts. On that day the engine was a window, a Direct3D 12 renderer and an empty corridor. The plan around it was much larger than the code. This post explains the plan, the constraints I set myself, and the two ideas that the rest of the engine is built on: the frame loop and an explicit graphics API.

## The target

I want to make a first-person survival-horror game that looks like Resident Evil 7 and Village. That means dim residential interiors, pools of warm lamp light, deep shadow, wet-looking floors, grime on the walls, film grain and dust in light beams. The look comes from a few well-controlled techniques, not from high polygon counts, and that makes it realistic for one developer to approach.

The first milestone is one hallway. It is narrow, with a dark wooden floor, green-grey plaster walls, white trim, wall lamps with a warm glow, and darkness at the far end. A player can walk it, interact with a door, and see a small scripted event. I want this slice to run at 60 frames per second on an NVIDIA GPU, and I want to build it in small steps so that every step can be checked against the target.

The picture below is the editor viewport on 15 June, the last day of work before a pause. It is nearly black and shows a grid and unlit walls. It is where the engine stood at the end of its first stretch, and the later posts show how it changed.

![A dark corridor in the editor viewport with grey walls, a grid on the floor and a lighter ceiling](/images/2026-06-06-starting-from-scratch/june-hallway.jpg "The hallway in the editor viewport on 15 June. Walls and ceiling are barely lit, the floor shows only the editor grid.")

## Why from scratch

There are mature engines that would give me a hallway like this in a week. I chose to write my own for three reasons.

1. **I want to know the cost of every pixel.** The target is a fixed frame budget: 16.7 ms per frame for 60 frames per second. If I write every pass myself, I can say exactly what each one costs and why. With a large engine, part of that cost is hidden behind features I did not choose.
2. **The look depends on details of the pipeline.** Light falloff, how bloom is built, how exposure is applied and how the floor reflects light decide whether a hallway looks like a horror game or like a render test. I want direct control of those.
3. **A narrow scope is achievable.** I am not trying to build a general engine. I am building what one hallway needs, then what the next scene needs. Each system is small because it only has to do one job.

The rule I follow is to use only what ships with the Windows SDK: Direct3D 12 and DXGI for graphics, the Windows Imaging Component for decoding images, and, when I reach audio, XAudio2. The engine does not vendor any third-party library. The costs are real. I write my own JSON parser, image pipeline, physics and UI, and each of them will have bugs that a mature library would not. I accept that in exchange for knowing the whole code base.

The development machine has an RTX 4070. The engine is written in C++20 and built with CMake.

## What an engine is

An engine is the code that every game of a kind needs, separated from the code that is specific to one game. For a first-person game that code covers opening a window, reading the keyboard and mouse, loading meshes and textures, moving the player, drawing the scene and playing sound. The game-specific part is the hallway itself: where the walls are and what happens at the door.

All of this runs inside one loop.

> **Background: the game loop**
>
> A program that draws moving images has to produce a new picture many times a second. It does that in a loop. Each trip around the loop is one frame, and it has four steps:
>
> 1. **Read input.** Collect the keys pressed and the mouse movement since the last frame.
> 2. **Update.** Advance the world: move the player, run doors and timers, resolve collisions.
> 3. **Render.** Describe the scene to the GPU as a list of commands.
> 4. **Present.** Show the finished image and start the next frame.
>
> The loop has to know how much real time passed since the previous frame. That value is the delta time, written `dt`. Movement is computed as `position += velocity * dt`. If the loop took 10 ms, the player moves a tenth of the distance that a 100 ms frame would give, so the walking speed in metres per second does not depend on the frame rate.
>
> `dt` has to be limited. If the process stalls for half a second, for example while the window is dragged, an uncapped `dt` would move the player half a second of distance in one step and could carry them through a wall. My loop reads the clock with `QueryPerformanceCounter`, a high-resolution counter whose tick rate comes from `QueryPerformanceFrequency`, and clamps the result:
>
> ```cpp
> const float dt = std::min(m_timer.Tick(), 0.05f);
> ```
>
> The cap is 50 ms. A frame slower than that is simulated as if it took 50 ms, so the game slows down for a moment instead of jumping.

![A loop of four boxes: read input, update, render, present, with dt measured on each trip](/images/2026-06-06-starting-from-scratch/game-loop.svg "The loop that every later feature plugs into. The 16.7 ms budget at 60 frames per second covers all four steps.")

Everything I add later fits into one of these four steps. The collision system I describe in a later post is part of update. Lights, shadows and bloom are part of render. A bug in the loop's structure would affect all of them, so I wrote this part first and kept it plain.

## Why Direct3D 12

The render step is where most of the engine's work goes, and it depends on the graphics API. Older APIs such as OpenGL and Direct3D 11 hide a lot from the programmer. The driver tracks what state each resource is in, decides when to wait for the GPU, and manages memory behind the scenes. That makes programs shorter, but it also means the cost of a call is not visible and can change between drivers.

Direct3D 12 moves that work to the application. The main ideas are these.

- **Command lists.** The CPU does not draw anything directly. It records commands such as "set this pipeline, bind these resources, draw this mesh" into a command list, then submits the list to a command queue. The GPU executes it later, in parallel with the CPU.
- **Command allocators.** The memory behind a command list belongs to an allocator, and it cannot be reused until the GPU has finished with the commands inside it.
- **Fences.** A fence is a counter that the GPU sets when it reaches a point in the queue. The CPU compares the counter with the value it expects to decide whether the GPU is done with a frame.
- **Resource barriers.** A texture is used for different purposes in a frame. It is a render target when written and a shader resource when read. The application states each transition explicitly.
- **Descriptor heaps.** Shaders find textures and buffers through descriptors, which are small records stored in heaps that the application manages.

The cost is a large amount of setup code. A triangle takes hundreds of lines. The benefit is that nothing happens implicitly. When the frame is slow, I can reason about which pass and which resource caused it, and the timings I added later map directly onto the structure of the code.

My renderer keeps two frames in flight (`FrameCount = 2`). While the GPU draws frame N, the CPU records frame N+1 into a second command allocator. Before it reuses an allocator, the CPU waits on that frame's fence. Without this overlap, the CPU and the GPU would take turns instead of working at the same time, and the frame time would be the sum of the two instead of the larger of them. The swap chain uses the flip-discard model, which is the one that supports presenting without waiting for vsync, and I use that later for uncapped measurements.

## What the first commit contained

The first commit, `48619ad`, added 94 files and about 8,700 lines. It contained the following.

- **A window and the application loop**, with the timer and the `dt` cap shown above.
- **A Direct3D 12 renderer.** It draws the hallway with one forward-rendering pass into a floating-point HDR target, a depth-only pass for a shadow map, and a full-screen post-process pass. A later post covers how those fit together.
- **A shader compiler wrapper and the HLSL for three shaders:** the scene shader (361 lines), the post-process shader (121 lines) and the shadow depth shader (13 lines).
- **A texture path.** A decoder loads images through the Windows Imaging Component, a mip generator builds the smaller levels, and an upload step copies them to the GPU. Two 2K material sets came with it, Plaster004 for the walls and Wood051 for the floor, each with colour, normal, roughness and displacement maps.
- **A procedural hallway.** A descriptor with the dimensions, lamp positions and material choices is turned into boxes by a builder, so the hallway can be changed by editing numbers.
- **A graphics capability report.** At startup the engine logs the GPU and which optional NVIDIA SDK files are present. This only detects them. Nothing uses them yet.
- **An entity scene.** Entities and their components could already be exported to JSON, and the tests for that were in the first commit. At this point it was a description of the scene, not the data that drove the game. That change came two days later and is the subject of the next post.
- **Tests.** Eleven test files covered the file system, image loading, texture assets, mip generation, the material manifest, shader compilation, the descriptor layout, the hallway builder, the hallway descriptor, demo asset validation and the entity scene.

The tests are not a detail. A from-scratch engine has no library behind it to trust, so every system needs a check I can run. The set of tests grew with the code from the first commit, and later posts use them as part of how each change is verified.

## Results and what comes next

At the end of 6 June the engine opened a window and drew a lit, textured corridor through a DirectX 12 renderer that I understood line by line. It was not yet a horror scene. The lighting was simple, the floor looked like a flat dark surface, and the only way to change anything was to edit code.

The next steps follow the target. The next post covers 8 and 9 June, when I rewrote the lamp falloff, added the shadow map, the post pass and the flashlight, and made the entity scene the runtime source of truth. After that I built an editor, and then I stopped for three months.
