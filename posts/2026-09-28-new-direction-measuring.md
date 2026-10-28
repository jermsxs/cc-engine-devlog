---
title: A new direction, and measuring first
date: 2026-09-28
order: 1
summary: A new plan for an RE7 look and an AI-drivable editor, then honest measurement first, with GPU timings, uncapped frames, a benchmark and screenshots.
tags: performance, tools, renderer
cover: /images/2026-09-28-new-direction-measuring/baseline-1440p-bench-poses.jpg
---

After the restart, the engine did what the first demo needed in rough form: a hallway you could walk, with doors and lamps. 28 September was the day I sat down and asked where it was going. I changed the plan, and then I built the thing I would need before I could follow it: a way to measure.

## The new plan

I put the long list of grand features (C# gameplay, audio, enemies) on hold and chose two tracks, in this order.

**1. Tooling.** I want the editor to be easy for a person to use, and also usable by an AI agent. That means an agent should be able to open a scene, change it, take a screenshot to see the result, and undo it if it looks wrong. The standard way to give an agent that ability is the **Model Context Protocol (MCP)**, which I cover in the next post.

**2. Graphics tuned toward Resident Evil 7 and Village.** That look is grimy interiors, small pools of lamp light, glossy floors, very deep blacks, film grain and dust hanging in light beams. It has to be efficient: my budget is 1440p at 60 frames per second on a mid-range graphics card (an RTX 3060 class), which is about 12 milliseconds per frame with a little headroom.

I put tooling first on purpose. If the engine can measure its own speed, take its own screenshots and be driven without a mouse, then every graphics change after that can be checked, compared and undone.

## What was wrong with the renderer

Before planning I read through my own renderer with a critical eye. What I found shaped the whole plan:

- Lighting was an old-fashioned model (Blinn-Phong) with lots of shortcuts specific to this one corridor.
- Every pixel looped over all the lights about eight times.
- Only one of the twelve lamps cast a shadow.
- The glossy floor reflections were faked.
- Bloom was one small blur.
- Textures were stored uncompressed, using about 210 MB of video memory.

None of that is a disaster for a first demo, but all of it would stop me getting the look. The plan became a list of steps, with a time budget for each, in a roadmap document.

## Why measure before optimizing

> **Note: The rule I am following.** Do not guess where the time goes. Programmers are famously bad at it. The slow part is often not the part that looks complicated. So before changing any graphics code I want a number for every pass, a way to repeat the measurement exactly, and a picture to compare against.

The danger of skipping this is real. You can spend a week making a shader twice as fast and gain nothing, because the frame was waiting on something else. Or you can make a change that looks harmless and quietly ruins the image. Numbers and screenshots protect against both.

There were four pieces to build.

## 1. An uncapped frame rate

Until now my frame times were capped by *vsync*, which makes the program wait for the monitor's refresh. If the GPU needs 3 ms but the monitor wants a frame every 6.9 ms, you read "6.9 ms" and learn nothing about the 3.

So I added a switch to present frames without waiting for the display, using screen tearing when the graphics card and driver allow it. Both the game and the editor have it, and now the frame rate tells the truth.

## 2. GPU time for every pass

A normal timer in the program measures the CPU. But the CPU does not draw anything. It records a list of commands, hands them to the GPU, and moves on. The GPU runs them later and on its own schedule. A stopwatch around the "draw" call measures how long it took to *record* the commands, not how long the GPU took to run them.

> **Theory: GPU timestamp queries.** The GPU has its own clock. You can put a "write the current time here" instruction into the command list, between passes. When the GPU reaches that instruction it records its own clock reading. Take two readings and subtract: the difference, divided by the clock's rate, is how long the GPU spent between them. You read the results back once the GPU has finished with them.

![The four passes laid out in a row with timestamps T0 to T4 between them](/images/2026-09-28-new-direction-measuring/timestamps.svg "Timestamps at the boundaries of each pass. The difference between two neighbours is that pass's cost.")

My frame is made of four passes (shadow, scene, post-process and UI), so there are timestamps around each. Every few seconds the engine writes the average time and the worst-case time, for both CPU and GPU, per pass, to the log. The game's title bar shows them live.

Why report the worst-case as well as the average? A game that averages 5 ms but hitches to 30 ms every second feels terrible. I report the 95th percentile, the time that 95% of frames beat, to see the bad frames.

## 3. Screenshots from inside the engine

I had been capturing screenshots from outside the program by grabbing the window. That fails whenever another window is on top of the game. So the engine now captures its own picture. It copies the finished frame into memory and writes it out as a PNG using the Windows image library. You get exactly what was shown (3D view, post effects and UI) whatever is in front of it.

A second flag exits the program after a given number of frames, so scripts can start it, wait, capture and close it with no one watching.

![The editor, captured by the engine itself, with the panels and viewport all visible](/images/2026-09-28-new-direction-measuring/editor-in-engine-capture.jpg "The editor captured from inside the engine, at 2560 by 1392, with no window tricks.")

## 4. A benchmark mode

The last piece makes the numbers repeatable. Benchmark mode loads a file listing six fixed camera spots: the start view, the closet door, the glossy floor, a lamp close-up, a long corridor, the locked door. At each one it warms up, measures 300 frames, takes a screenshot, and writes a report. A small script then compares two reports side by side: the change in each timing, plus how much each screenshot changed.

![Six benchmark views of the hallway arranged in a contact sheet](/images/2026-09-28-new-direction-measuring/baseline-1440p-bench-poses.jpg "The six benchmark poses at 1440p. It is very dark, and the floor that is meant to be glossy barely reads. That is the problem the lighting work has to solve.")

Before trusting it, I measured the measurement. Two runs of the same build agree on GPU time within about 0.5%, and on CPU time within about 3%. The screenshots of the two runs differ only by film grain, with the largest difference in any pixel being 2 out of 255.

## The baseline

Here is the first honest number set, from a debug build on an RTX 4070, uncapped:

| Camera spot | GPU, 1600x900 | GPU, 1440p | Scene pass, 1440p |
|---|---|---|---|
| Start view | 2.53 ms | 5.90 ms | 5.58 ms |
| Closet door | 2.09 ms | 4.69 ms | 4.34 ms |
| Long corridor | 2.44 ms | 5.83 ms | 5.51 ms |
| Floor gloss | 2.13 ms | 5.17 ms | 4.85 ms |
| Lamp close-up | 2.12 ms | 5.49 ms | 5.13 ms |
| Locked door | 2.23 ms | 5.00 ms | 4.66 ms |

What the numbers say:

- **The scene pass is nearly everything.** At 1440p it takes 4.3 to 5.6 ms, which is already above the 4 ms I had planned for lighting, with simple lighting. That confirms the code review: looping every pixel over all twelve lights is the big cost.
- **Shadows cost almost nothing (0.01 ms),** but only because the walls do not cast shadows and only one lamp has a map. That will change.
- **Post-processing is about 0.3 ms.**
- **The editor is bound by the CPU,** at about 7.3 ms a frame, mostly building the UI. A job for later.

So the biggest gain available is the lighting rewrite, and now I have a number to beat.

## Where it stood

I did not change how anything looks today. I wrote a JSON writer for the reports, which the next tool also needs, and an option to set the game window size. Everything that follows, the lighting, shadows, reflections and fog, gets a before and after from these tools.

The next step was to make the editor drivable without a mouse.
