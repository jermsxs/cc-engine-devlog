---
title: A new plan, then GPU timings, uncapped frames, screenshots and a benchmark
date: 2026-09-28
order: 1
summary: I set a plan for an RE7-style look and an editor that agents can drive, and started with GPU timestamps, uncapped frames, screenshots and a benchmark.
tags: performance, tools, renderer
cover: /images/2026-09-28-new-direction-measuring/baseline-1440p-bench-poses.jpg
---

By the end of 27 September the engine had a usable editor, real meshes, collision and doors, and fast startup. The hallway still did not look like the reference. It was very dark, the floor did not read as glossy, and the lighting was written for one corridor. I decided to change the plan. This post covers the new plan and the first step of it, which was to measure the renderer and to capture images from inside the engine, so that every later change can be judged by numbers and screenshots.

## The new plan

I set two goals.

1. **A look close to Resident Evil 7 and Village.** That means grimy interiors, pools of lamp light, wet-looking floors, deep blacks, film grain and dust in light beams. The renderer has to be efficient as well. The budget is 1440p at 60 frames per second on an RTX 3060-class GPU.
2. **An editor that is easy to use and that an AI agent can drive.** A small server speaking the Model Context Protocol (MCP) will connect to a running editor over a named pipe, so that edits appear live and can be undone. When no editor is running, it will load the scene on its own and render screenshots offscreen.

C# scripting, audio and gameplay assembly are on hold while these two are done. I put tooling first, because with timings, screenshots and tool access in place, every graphics change that follows can be measured, captured and compared.

Before planning I read through the renderer. What I found shaped the plan:

- Lighting was Blinn-Phong with many corridor-specific shortcuts.
- Each pixel looped over the lights about eight times.
- Only one of the twelve lamps cast a shadow.
- The floor reflections were faked.
- Bloom was one small blur.
- Textures were uncompressed and took about 210 MB of video memory.

I wrote the plan to `Docs/Roadmap.md`, with a frame-time budget. At 60 frames per second a frame has 16.7 ms. I aim for about 11 ms to leave headroom:

| Pass | Budget at 1440p |
|---|---|
| Shadows | 1.5 ms |
| Depth prepass | 0.5 ms |
| Forward lighting | 4 ms |
| Ambient occlusion | 0.7 ms |
| Screen-space reflections | 1 ms |
| Volumetric fog | 1.5 ms |
| Bloom and post | 1 ms |
| Temporal anti-aliasing | 0.5 ms |
| UI | 0.3 ms |
| **Total** | **about 11 ms** |

I develop on an RTX 4070, which is faster than the 3060-class target, so a number measured here is optimistic for the target hardware.

## Why frame time and not frame rate

> **Background: frame time, percentiles and vsync**
>
> Frame rate is the inverse of frame time, and the inverse hides cost. Going from 60 to 50 frames per second is a loss of 3.3 ms per frame. Going from 144 to 120 is a loss of 1.4 ms. The same amount of added work looks very different in frames per second depending on where you start. A budget is a sum of milliseconds, so I measure in milliseconds.
>
> An average hides spikes. A game that renders every frame in 6 ms but hitches to 40 ms every second looks bad with a good average. The 95th percentile (p95) is the time that 95 percent of frames stay below, and it shows spikes that an average does not. I report both.
>
> Vertical sync, vsync, makes the swap chain wait for the display's refresh before it presents a frame. The program then runs at the refresh rate or an exact fraction of it, and the GPU sits idle for the rest of each interval. A measurement taken that way tells me nothing about how much headroom there is. To see the true cost, the engine has to present without waiting. On Windows this is done with a flip-model swap chain, created with `DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING` after checking `DXGI_FEATURE_PRESENT_ALLOW_TEARING`, and presenting with sync interval 0 and the `DXGI_PRESENT_ALLOW_TEARING` flag. The image can tear on screen, which is acceptable for a benchmark.

I added a `--no-vsync` option to the game and the editor. It presents with interval 0 and the tearing flag when the driver supports it.

## Timing work on the GPU

A timer on the CPU cannot measure the cost of a render pass. The CPU does not draw anything. It records commands into a command list and submits the list, and the GPU runs it later and in parallel. A CPU clock around the draw calls measures how long it took to record them, which is usually a small fraction of the GPU's time. A CPU clock placed after the present call would include waiting for the GPU, but it cannot tell which pass was slow.

> **Background: GPU timestamp queries**
>
> The GPU has its own clock. A timestamp query asks the GPU to write the current value of that clock into a query heap when execution reaches that point in the command stream. In Direct3D 12 the steps are:
>
> 1. Create a query heap of type `TIMESTAMP` with room for the number of timestamps in a frame.
> 2. At each point of interest, call `EndQuery` on the command list with the slot number. Nothing is written when the call is recorded. The write happens when the GPU gets there.
> 3. At the end of the frame, call `ResolveQueryData` to copy the raw values into a buffer. The buffer is in a readback heap, which the CPU can map.
> 4. After the GPU has finished the frame, which a fence tells the CPU, map the buffer and read the values.
> 5. Subtract the earlier value from the later one to get ticks, and divide by the timestamp frequency of the queue, which comes from `GetTimestampFrequency`, to get seconds.
>
> The result is the time the GPU spent between two points, and it includes everything the GPU did between them. Reading the results for the current frame would force the CPU to wait for the GPU. To avoid that, each frame in flight has its own block of slots, and the CPU reads a block when it comes back to that frame slot, after the fence for it has been passed. The numbers lag by about two frames, which does not matter for averages.

![Four passes in a row, Shadow, Scene, Post and UI, with timestamps T0 to T4 at their boundaries](/images/2026-09-28-new-direction-measuring/timestamps.svg "Timestamps at the pass boundaries. A pass's time is the difference of two neighbouring values divided by the tick frequency.")

The June editor already had this mechanism for its profiler panel: eight slots per frame, a begin and an end for the shadow, scene, post and UI passes, and a readback of the block belonging to the current frame index. What I added on 28 September was the use of it everywhere:

- The total GPU time of a frame is now computed from the first to the last timestamp and is available in the frame statistics.
- Both programs log the average and the p95 of the CPU frame time and of the GPU time per pass every few seconds. The interval is set with `--perf-log-seconds`, and it is 5 seconds by default.
- The game's title bar shows the same numbers live.

## Screenshots from inside the engine

My screenshots had been taken from outside the program by capturing the window region. That failed whenever another window was on top of the engine. It also included whatever else was on the screen. An image taken by the renderer itself shows exactly what the renderer produced.

The capture works in four steps. When a capture is requested, the renderer copies the finished back buffer into a buffer in a readback heap before it presents. A texture copy into a buffer uses a layout that `GetCopyableFootprints` supplies, and its rows are padded to a pitch that is a multiple of 256 bytes, so the code reads the rows with that pitch and not with the image width. The GPU is flushed on that one frame so that the data is ready. Then the pixels are encoded as a PNG with the Windows Imaging Component. The writer writes to a temporary file and renames it, and it creates the folders that are missing. `--screenshot=file.png` saves the image, `--capture-frame=N` chooses which frame, and `--exit-after-frames=N` lets a script run the program without attention. `--window=WIDTHxHEIGHT` sets the size of the game window.

The capture includes the 3D view, the post effects and the UI, as it appears on screen. The image below is the editor captured this way.

![The editor with its outliner, inspector, viewport and bottom tabs, captured by the engine itself at 2560 by 1392 pixels](/images/2026-09-28-new-direction-measuring/editor-in-engine-capture.jpg "The editor, captured by the engine itself with no dependence on the window being in front.")

## A repeatable benchmark

A single frame time is not enough to judge a change. The scene should be the same each time, the camera should be in the same place, and the first frames of a run, in which the GPU is still warming up and resources are still loading, should not count. I wrote a benchmark mode for this: `--bench=Demo/Hallway/bench.json`.

The file lists six fixed camera poses: the start view, the closet door, the long north corridor, the floor seen at a low angle, a close view of a lamp and the locked door. At each pose the program waits 60 warm-up frames, measures 300 frames and takes a screenshot. When it has visited all six, it writes `report.json` with the average and p95 CPU frame time and the GPU time per pass for each pose.

`Scripts/Compare-Bench.ps1` compares two reports and prints the timings side by side with percentage change. It also reports how much each screenshot changed. This matters because a performance change that alters the picture by accident is a regression. A second script, `Scripts/Make-ContactSheet.ps1`, tiles the screenshots into one image for review, and I used it for the image below.

To find out how much the benchmark varies, I ran the same build twice. GPU time agreed within about 0.5 percent and CPU time within about 3 percent. The screenshots differed by at most 2 out of 255 in any channel, which is the film grain. A change smaller than those margins is not distinguishable from noise.

![Six benchmark views of the hallway tiled in a contact sheet, each labelled with its pose name](/images/2026-09-28-new-direction-measuring/baseline-1440p-bench-poses.jpg "The six benchmark poses at 1440p. The image is very dark and the glossy floor barely reads, which is the main thing the look work has to fix.")

## Baseline results

These are the first numbers. The build is Debug, the GPU is an RTX 4070 and presents are uncapped. The 1440p runs use a 2560 by 1421 window. Times are in milliseconds, as average and p95 for the 1440p GPU time.

| Pose | 1600 by 900 GPU | 1440p GPU | 1440p scene pass |
|---|---|---|---|
| south_start | 2.53 | 5.90 / 6.05 | 5.58 |
| east_closet_door | 2.09 | 4.69 / 4.90 | 4.34 |
| north_corridor_long | 2.44 | 5.83 / 6.06 | 5.51 |
| east_floor_gloss | 2.13 | 5.17 / 5.44 | 4.85 |
| west_lamp_closeup | 2.12 | 5.49 / 5.64 | 5.13 |
| north_locked_door | 2.23 | 5.00 / 5.19 | 4.66 |

What the numbers show:

- **The scene pass takes almost all of the GPU time.** At 1440p it takes 4.3 to 5.6 ms, which is already more than the 4 ms I planned for forward lighting, with the lighting still simple. This agrees with what I saw in the code, where each pixel runs the light loop several times. The lighting rewrite is the largest saving available.
- **The cost scales with the number of pixels.** The 1440p window has about 2.5 times as many pixels as the 1600 by 900 one. The GPU time grows by a factor of 2.2 to 2.6. A pass whose cost follows the pixel count is limited by work done per pixel, which points to the pixel shader.
- **Shadows cost 0.01 ms.** That is low only because the walls do not cast shadows and only one lamp has a shadow map. It does not mean that shadows are cheap.
- **Post-processing costs about 0.3 ms.**
- **The editor is limited by the CPU.** A frame takes about 7.3 ms on the CPU, mostly because it rebuilds the UI. That is worth optimising later.

The full report is stored with the diary. At 1440p the engine already uses the whole 4 ms of lighting budget and more, and it has none of the passes that the look needs: ambient occlusion, reflections, volumetric fog and anti-aliasing. The budget has to be won back from the scene pass.

## Open issues

- A capture reads the presented back buffer, so its size is the size of the window.
- The numbers are from a Debug build on one machine. I have not repeated the baseline on a release build.
- The next step is the editor core that works without the UI, which is the base for the MCP server.
