---
title: Why build a horror engine from scratch
date: 2026-06-06
order: 1
summary: Why I am building a horror engine in C++20 and DirectX 12 with no libraries, what an engine is, and what the first commit held.
tags: architecture, retrospective
cover: /images/2026-06-06-starting-from-scratch/game-loop.svg
---

This is the first entry in the dev diary of my horror engine. The git history starts on 6 June 2026, so that is where the diary starts too. Today the engine was a window, a Direct3D 12 renderer and a corridor that was not much to look at. The plan around it was already big, though, so this post is about the plan.

## The target

I am building an engine for one kind of game: slow, quiet survival horror, in the spirit of Resident Evil 7 and Village. Not enemies and explosions. Dread. A house where the light is wrong and you do not want to turn the corner.

The first goal is one small demo, a hallway. I carry a reference picture in my head (and in the project notes) of exactly what it should be:

- A narrow residential corridor, with muted green-grey walls and white baseboards.
- A dark, glossy wooden floor that catches a little light.
- Dark framed paintings on both walls, and old wall lamps with a strong glow around the bulb.
- Deep shadow toward the far end, where a faint window is the only hint of the outside.
- Grimy plaster, stains, a slightly crooked picture. Old, lived in, and not clean.

The demo is meant to last three to five minutes. You walk slowly, look at things, try a locked door. One small thing goes wrong, and the sound changes as you get near the end. That is the whole game. A rule I wrote into the project notes on day one is that every feature has to move the engine closer to that hallway. If a system has no visible payoff in the demo, it waits.

## Why not use an existing engine?

Unity and Unreal can already make this hallway. That is true, and I am not claiming otherwise.

I am doing this to learn how the whole thing works, and to end up with something shaped exactly for this job. An engine built around "dark interiors with a few important lights" can make different choices from an engine built for everything. It can also stay small enough that I understand every line.

So the rule is: **no third-party libraries.** The engine uses the Windows SDK and nothing else. The JSON reader, the 3D file importer, the user interface, collision, the texture compression: I write them. (Later, the engine will host Microsoft's .NET runtime so that gameplay can be scripted in C#, but that is for another day.) Art is the one exception. I will use freely licensed textures and models, as plain data files, never as code linked into the engine.

## C++20 and DirectX 12

The runtime is written in **C++20**. Games need to control memory and timing precisely, and C++ is what the graphics APIs and the industry expect.

For graphics I picked **DirectX 12**. It is a low-level API: you describe the GPU's work in detail and it does exactly that. That makes it more work than older APIs, but it also means nothing is hidden. If a frame is slow I can find out why. It also leaves the door open for ray tracing later, and my own graphics card (an NVIDIA RTX 4070) supports it well.

The code is organised in modules, so that the renderer, the scene, the platform layer and the rest can be understood on their own. I also plan to use **C# for gameplay** (doors, puzzles, scares), while all the heavy lifting stays in C++. That is deferred, so I will not say more here.

## What an engine actually is

If you have never looked inside one, here is the shortest honest description. A game engine is a program that runs one loop, over and over:

![A loop with four boxes: read input, update the world, draw the frame, present](/images/2026-06-06-starting-from-scratch/game-loop.svg "A game engine is mostly this loop. One trip around it is one frame.")

> **Concept: The game loop.** A game is a simulation shown 60 or more times a second. Each time round the loop, the engine reads the keyboard and mouse, moves things in the world by the amount of time that has passed (the *delta time*), asks the renderer to draw everything, and shows the finished picture on screen. Using delta time instead of "one step per frame" is what makes a player walk at the same real speed on a fast machine and a slow one.

My first version of that loop does exactly this, with a small safeguard: delta time is capped at 50 milliseconds, so if the program stalls for a second, the player does not teleport through a wall when it wakes up.

Around the loop there are three big pieces.

**The renderer** turns a description of a scene into pixels. In practice it is a pile of triangles, the lights that shine on them, and some small programs that run on the GPU, called *shaders*, which decide the colour of each pixel. The renderer owns the GPU, the memory on it, and the extra passes that make the image look like film rather than a computer: bloom, grain, vignette and tone mapping.

**The scene** is what exists in the world: walls, floor, lamps, doors, the camera. If the renderer is the painter, the scene is the room. I keep it as a list of *entities*, each one a bundle of small *components*: a transform (where it is), a mesh (what it looks like), a light (what it emits), and so on. That is the "entity component" pattern, and it matters because an editor can only edit things that are described as data.

**The platform layer** is the dull but essential part: opening the window, reading input, timing, and writing a log file so I can find out what happened.

## The first commits

The first commit is simply called "starting". It dropped about 8,700 lines in 94 files, so the project did not begin from an empty folder. What it contained is a fair picture of where I started:

- the window and input code, and the loop above;
- a DX12 renderer split into small files (device, pipeline, shadows, textures);
- shaders for the hallway, for the shadow map and for the post-processing pass;
- an entity scene with JSON save and load;
- a hallway built in code from boxes: floor, ceiling, walls, trim;
- two textures to go with them, a plaster and a dark wood;
- a first audio module and a small check that asks whether CUDA, NVIDIA's compute platform, is available;
- the project vision document, which is longer than some of the code.

A second commit followed two days later with more scene work, a validation script and a command-line tool that lists what is in a scene. That tool turned out to be useful, because I could check the data without starting the game.

It is not impressive to look at yet. A dark box with a few lights in it. But it ran, it had the right shape, and the next post is about turning it into something that looks like a hallway.
