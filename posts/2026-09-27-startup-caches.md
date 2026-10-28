---
title: Caching compiled shaders and prepared textures to cut startup from 9.7 s to 1.3 s
date: 2026-09-27
order: 2
summary: A Debug build took 9.4 seconds to start. Caching compiled shaders and prepared textures brought warm starts down to about 1.3 seconds.
tags: performance, assets
cover: /images/2026-09-27-startup-caches/after-caches.jpg
---

A Debug build of the engine took about 9.4 seconds to reach the first frame. I start the game and the editor many times a day, for every capture, every test of a visual change and every benchmark run, so this was the largest delay in my work. I measured where the time went and found that most of it was spent doing the same two jobs on every launch: compiling shaders and preparing textures. This post describes the caches I added for both jobs, `Saved/ShaderCache/` and `Saved/TextureCache/`, and the way I made sure they never return a wrong result.

## What the engine did on every launch

### Shader compilation

> **Background: shader compilation**
>
> A shader is written in a high-level language, HLSL in my case. The GPU cannot run that text. A compiler translates it into bytecode, and the graphics driver later translates the bytecode into the instructions of the specific GPU. The first step is done by `D3DCompile` in the Windows SDK, and its cost depends on the length and complexity of the source. My scene shader is hundreds of lines long and includes a shared header, and each entry point is compiled separately.
>
> The result of a compile depends on a fixed set of inputs: the source text after includes are expanded, the entry point name, the target profile, such as a pixel-shader profile, the compile flags, and the version of the compiler. If all of those are the same, the output is the same, so it can be stored and reused.

I measured about 4.4 seconds of compilation in a warm Debug start, from the log of the compile times.

### Texture preparation

> **Background: mipmaps**
>
> When a textured surface is far away, many texels fall inside one screen pixel. If the sampler reads only the full-size image, the result shimmers and aliases as the camera moves. A mip chain is a series of copies of the texture, each half the width and height of the previous one. The GPU chooses the level whose texel size matches the pixel size, and with trilinear filtering it blends two levels. The cost is memory. A 2048 by 2048 image with four 8-bit channels is 16 MiB, and the whole chain is 4/3 of that, about 21.3 MiB.
>
> How the chain is built matters. My generator averages each 2 by 2 block of texels into one. Colour textures are stored in the sRGB curve, which is not linear, so the generator converts each texel to linear light, averages, and converts back. A normal map holds vectors, so it averages the vectors and not the stored values. A data texture such as roughness is averaged directly. This is why the generator takes a texture kind (colour, data or normal) as an input.

The hallway uses two 2K material sets, and the files are PNG images that Windows has to decode. Decoding a 2K PNG, converting it to RGBA, and building the mip chain took about 3.8 seconds in total on every launch. That is where my second block of lost time was. Together with the shader compile, about 8.2 of the 9.4 seconds went on work whose result had not changed since the last run.

## How a cache stays correct

The idea of a cache is simple. Before doing the work, compute a key from the inputs, and look for a stored result under that key. If there is one, use it. If there is not, do the work and store the result.

![Inputs are hashed into a key; if an entry exists and its header matches it is loaded, otherwise the result is rebuilt and written with a temporary file and a rename](/images/2026-09-27-startup-caches/cache-flow.svg "A cache lookup. Anything that changes the output has to be part of the key.")

The difficulty is in the key and in the failure cases. A cache that returns a stale result is worse than no cache, because the error is hard to see. I applied four rules.

1. **The key contains every input that changes the output.** If I leave one out, the cache returns the output for the old value after the input changes. The compiler version is part of the shader key for this reason. The generator version is part of the texture key. A comment next to the generator version says to bump it whenever the mip output changes.
2. **The key is verified when the entry is read.** The file name is a hash of the key, but a hash can collide. So the file also stores the full key as a header, and I compare the header with the key I looked for. A mismatch counts as a miss.
3. **Damage counts as a miss.** The reader checks the sizes in the header against the size of the file. A truncated or corrupt file is rejected, and the entry is rebuilt.
4. **Writes are atomic.** I write the entry to a temporary file whose name includes the process ID, and then rename it over the final name. A rename is atomic on the same volume, so a crash during a write leaves either the old file or the new file and never half of one. Two processes that write the same entry at the same time do not overwrite each other's temporary files.

The hash is 64-bit FNV-1a, a short loop that xors each byte into the state and multiplies by a prime. It is fast and gives the same result on every run and every build. It is not a cryptographic hash and I do not need one, because rule 2 catches collisions.

## The shader cache

The key for a shader has these fields: the length of the include-expanded source, two 64-bit hashes of that source (FNV-1a with two different seeds, to make an accidental collision very unlikely), the entry point, the target profile, the compile flags and `D3D_COMPILER_VERSION`. The cache directory is `Saved/ShaderCache/` next to the executable, and each entry is `<digest>.cso`.

Because the key contains a hash of the source text, the cache follows content and not file dates. If I edit a shader, its hash changes, and the next launch compiles it and stores a new entry. The old entry stays on disk and is never looked up again.

Each lookup is logged with the entry point, the profile and the digest, as a hit, or as a miss with the time that the compile took. A compile that fails is reported as an error and is not cached.

## The texture cache

The texture cache stores the prepared result: the RGBA mip chain, ready to upload to the GPU. An entry is used when it matches the source file's normalised path (absolute, lower-case, with backslashes), its size in bytes, its last write time, the texture kind and the mip generator version. The header also carries a magic number and a format version for the file itself, and the reader accepts only dimensions and mip counts within fixed limits.

I chose file size and write time for this key and not a hash of the file contents. That avoids reading every source image at startup. The cost is a weakness that I had to deal with immediately.

### A build step that invalidated the cache

After the first version, the texture cache missed on every launch after a rebuild, although I had not changed any texture. The build copied the game's asset folder next to the executable with CMake's `copy_directory`, which writes every file again on every build. Each copy gets a new write time. Since the write time is part of the key, every texture looked like a new file. The cache worked only when I launched twice without rebuilding.

The fix was to switch to `copy_directory_if_different`, available from CMake 3.26, which leaves files alone when their contents are identical. Their write times then stay the same, and the cache survives rebuilds. A key that uses metadata is only as stable as the process that touches the metadata.

## Results

On a Debug build with an RTX 4070:

| | Time to first frame |
|---|---|
| Before the caches | about 9.4 s |
| First launch with caches (fills them) | 9.7 s |
| Every launch after that, game | about 1.3 s |
| Every launch after that, editor | about 1.4 s |

The first launch takes 0.3 s longer than before, which I attribute to writing the entries. The shader cache removes about 4.4 s and the texture cache about 3.8 s from a warm start, according to the logs of each stage.

The cache must not change the picture. I took a screenshot of the hallway before and after, with the same camera, and compared them pixel by pixel. The largest difference in any channel is 2 out of 255. The film grain is random from frame to frame, and that accounts for it.

![The hallway rendered before the caches were added](/images/2026-09-27-startup-caches/before-caches.jpg "Before: a freshly compiled and freshly mipped frame.")

![The hallway rendered with the caches filled](/images/2026-09-27-startup-caches/after-caches.jpg "After: shaders and textures loaded from the caches. The two frames differ by at most 2 in 255 per channel.")

## Open issues

- I have not broken down the remaining 1.3 seconds. The driver still turns bytecode into GPU code when the pipeline states are created, and I do not cache that.
- I have not added cleanup of entries that are no longer used.
- The key for textures depends on file metadata. Moving the repository to another drive or restoring files from a backup changes the write times and rebuilds the cache once. It is correct, but it costs one slow start.
