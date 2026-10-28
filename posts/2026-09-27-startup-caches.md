---
title: Startup from 9.7 seconds to 1.3
date: 2026-09-27
order: 2
summary: Compiling shaders and building mipmaps on every launch made startup take nine seconds. Caches fixed it, and keeping them honest was the real work.
tags: performance, assets
cover: /images/2026-09-27-startup-caches/after-caches.jpg
---

Every time I launched the game in a debug build, I waited about nine and a half seconds before I saw anything. A change-run-look loop that slow is miserable, and I was going to be doing a lot of it. So before building anything else that day, I found out where the time went.

It went to two places: compiling shaders, and preparing textures. Both of them were redoing, on every single launch, work whose answer never changed.

## What was slow, and why

**Shaders.** A shader is written in a language called HLSL, a text file that the GPU cannot run. Before use it has to be *compiled* into low-level instructions for the graphics driver. Compilation is slow, and the engine was doing it for every shader at startup, even though the text had not changed since the last launch.

**Textures.** A texture is an image, and the renderer wants more than the image. It wants a full set of smaller copies of it, called *mipmaps*.

> **Concept: Mipmaps.** When a textured wall is far from the camera, one screen pixel covers many texture pixels. If the GPU just picks one, the wall shimmers and sparkles as you move. A mipmap chain stores the image at half size, quarter size, and so on down to one pixel. The GPU picks the level that matches the distance, and the sparkle goes away. Building the chain means reading every pixel and averaging, which is easy but not free, and the textures in the hallway are large.

Again, same input, same output, every launch.

## The idea: cache the answer

If a calculation is slow and always gives the same answer for the same input, do it once, store the answer on disk, and next time load it. That is a *cache*. The speed-up is easy. The hard part is the rule for when a stored answer is still valid.

![Flow: build a key from source, settings and tool version; if it matches the stored entry load it, otherwise rebuild and store](/images/2026-09-27-startup-caches/cache-flow.svg "A cache lookup. The key is the whole trick.")

> **Theory: Cache invalidation.** A cache is only correct if its key includes everything the answer depends on. Leave something out and you will serve stale results that look right until they very much do not. The old joke is that cache invalidation is one of the two hard problems in computer science, and it is true enough that I treated it as the main task.

## What went into the keys

**Compiled shaders** are stored under a cache folder. An entry is used only if three things all match: the shader's source text, the name of its entry point (the function the GPU starts running), and the version of the compiler. If I edit a shader, its source changes, the key no longer matches, and it is rebuilt. If Windows updates its compiler, the version changes and everything is rebuilt, which is what I want, because compiled output from a different compiler might be different.

**Textures, mipmaps included,** are stored the same way, tied to the source image. Change the image and the cached version is rebuilt next time automatically.

## Keeping the cache safe

A cache is a place where bad data can hide, so there are two protections:

- **Entries are checked when they are read.** If an entry fails its checks, the engine ignores it and rebuilds, rather than loading garbage into the GPU.
- **Files are written so that a crash in the middle cannot leave a half-written entry that looks valid.** The worst case of a crash is one entry being rebuilt.

The principle is that the cache must never be able to make the program *wrong*. It is allowed to be missing. It is allowed to be damaged. When it is, the program just becomes slower for one launch.

## The numbers

| Launch | Time to start (debug build) |
|---|---|
| Before caches | about 9.4 s |
| First launch with caches (builds them) | 9.7 s |
| Every launch after that | about 1.3 s (editor 1.4 s) |

The first launch is slightly slower than before, because it does the same work and then also writes the cache. Every launch after that is about seven times faster.

I also checked that the cache had not changed what the game draws. I took a screenshot before and after and compared them pixel by pixel. They differ only by film grain, which is random every frame. The biggest difference in any pixel was 2 out of 255.

![The hallway as drawn with the caches turned on](/images/2026-09-27-startup-caches/after-caches.jpg "With caches. The one from before looks identical: the largest per-pixel difference was 2 in 255, which is grain.")

## A cache that kept being thrown away

Later the same day, while working on collision, I hit a related bug that shows why invalidation matters. After every rebuild of the project, the texture cache was empty again. The build step re-copied *every* asset into the output folder on every build, and a freshly copied file looks like a changed file. So the cache was doing its job, noticing that its sources had changed, when nothing had changed in any way I cared about.

The fix was on the build side: the build now copies only files that really changed. The cache logic was right; the thing feeding it was noisy. It was a useful reminder that a cache is only as good as the signal it keys on.

## Where it stood

A debug launch takes 1.3 seconds, and I stopped dreading the run step. This is not a graphics feature and there is nothing to see in the screenshot, which is the point. Speed work like this is invisible when it is done well.

Next: the player walks through a corridor with no real collision, which is about to change.
