---
title: Replacing the float hashes in every shader with an integer hash
date: 2026-10-30
order: 2
summary: Every random-looking value in my shaders now comes from an integer hash, so a stain or a rain strike lands in the same place on every compiler and GPU.
tags: renderer, performance
cover: /images/2026-10-30-integer-hash/hallway-before-after.jpg
---

When I fixed the stain placement in G2, FXC and DXC were drawing the wall stains in different places. The cause was a small float hash, and I pinned it with `precise` so that both compilers multiplied in the same order. That worked, but it left a decision open: keep the pinned float hash, or move the shaders to an integer hash, which is exact and cheaper but moves every stain, wear patch and rain pattern once. Track G was finished, so I made the change on its own branch after its merge. I decided that placing things identically on every GPU was worth re-rolling every pattern once.

## Why shaders need random-looking numbers

Much of what makes the engine's surfaces look used comes from noise that has no source texture. The wear and grime layers place stains and scuffs on walls. The wet world decides which patch of ground is wet, where a ripple lands and which leaf a raindrop strikes. The sky has the moon's face. The post-process adds film grain and a dither.

A shader cannot call a random number generator the way a CPU program does. A generator keeps state between calls, and thousands of GPU threads would have to share it. Shaders use a hash instead: a function that maps a key to a value that looks random. The key is whatever identifies the place: a grid cell on a wall, a pixel and a frame, a raindrop's column. The same key always gives the same value, which is what is needed. A stain must stay where it is from one frame to the next and between two runs.

A hash for this job has to meet four requirements:

- **Deterministic.** The same key gives the same bits, every frame, on every machine.
- **Uniform.** The values spread evenly over the range, so a threshold of 0.3 selects 30 percent of the cells.
- **Uncorrelated.** Neighbouring keys give unrelated values, with no visible stripes or lattice.
- **Cheap.** Some of these hashes run for every pixel of every wall.

## The classic float hash and where it fails

The hash most shader code starts from looks like this:

```hlsl
float h = frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
```

It takes the sine of a dot product, multiplies by a large number and keeps the fractional part. The multiplication is meant to amplify tiny differences in the sine so that neighbouring inputs land far apart.

That amplification is also its weakness.

- **It uses the low bits of a float.** A 32-bit float has 24 bits of precision. Multiplying a value near 1 by 43,758 uses about 15 of those bits for the integer part, and the fractional part keeps what is left. Near 40,000 a float steps by about 0.004, so the hash can return only about 256 distinct values, and its last bits come from the last bits of `sin`.
- **The last bits of `sin` are not specified exactly.** For large arguments the function first has to reduce the angle, and hardware sine units trade accuracy for speed. Two GPUs, or two drivers, can return slightly different values. After the multiplication, a difference in the last bit of the sine becomes a visible difference in the result.
- **Compilers reorder arithmetic.** A multiply and an add may be fused or reordered, and a float result depends on the order. This is what I met in G2. The wear hash multiplied four numbers whose product reached about 250,000. At that size a float can only step by about 0.02, so a change of order moved the hash's last digits and with them the pattern. FXC and DXC multiplied in different orders, and the ceiling's water stains covered different spots.
- **It can show structure.** The sine is periodic and the dot product is linear, so for some inputs the output forms lines or a lattice, and the quality gets worse as coordinates grow.

I did not measure the structure problem in my own scenes. The reason for the change is the first three points: the answers depend on rounding, and compilers and GPU makers round differently. An AMD or Intel GPU, or a future driver, could still have moved my stains after the `precise` fix.

## How an integer hash works

Integer arithmetic does not have this problem. On unsigned integers, addition, multiplication and shifts wrap around modulo 2 to the power 32 in both HLSL and C++, as the language rules define them, so a key gives the same bits on every compiler and GPU. A float's value depends on how it was computed. An integer's does not.

A good integer hash has to make every output bit depend on every input bit. A change in one input bit should flip about half of the output bits, which is called avalanche. Two building blocks achieve this:

- **Multiplication by a large odd constant** spreads each input bit upward, into the higher bits. It does nothing for the low bits.
- **A shift and XOR** (`x ^= x >> 16`) folds the high bits back down into the low ones.

Alternating the two a few times gives a hash. A linear congruential generator, `x * a + c`, uses multiplication only, and its low bits repeat with a short period. That is why its output is not used directly.

The hash I chose is PCG3D, from "Hash Functions for GPU Rendering" by Jarzynski and Olano (2020), the paper that compares such hashes for shaders and recommends it. It takes three 32-bit words and returns three. My shared header holds it like this:

```hlsl
x = x * 1664525u + 1013904223u;   // the same for y and z: a linear congruential step
x += y * z; y += z * x; z += x * y;   // mix the three words into each other
x ^= x >> 16u; y ^= y >> 16u; z ^= z >> 16u;   // fold the high bits down
x += y * z; y += z * x; z += x * y;   // mix again
```

The first line gives each word a good spread in its high bits. The two mixing lines make each word depend on the other two, and the shift between them fixes the low bits. Other well-known integer hashes, such as Wang's and the finaliser of MurmurHash3, follow the same pattern with different constants.

The output is a word. To use it as a number in [0, 1), I take the top 24 bits and divide by 2 to the power 24. A float holds 24 bits exactly, so the result is exact and uniform over 16,777,216 values.

The key has to be an integer too. A grid cell is the result of `floor()`, which is already a whole number, so converting it to an integer is exact for the cell numbers I use. So the keys follow the same rule: a grid cell, a pixel, a frame or a column, and none of them comes out of a float computation.

![The path from a whole-number key to a float](/images/2026-10-30-integer-hash/hash-pipeline.svg "A whole-number key goes through PCG3D, and the top 24 bits of a word become a float in the range 0 to 1.")

## What I changed

Every hash in the shaders is now an integer hash, the same on every GPU and compiler.

- **One copy.** The hash lives in a shared C++ and HLSL header, `Shaders/Shared/Hash.h`, using the mechanism from G6. The shaders reach it through `Hash.hlsli`. The CPU copy of the rain strikes on leaves (`Wind::RainHitDrop`, which the foliage tests check) runs the same code. The clouds and the rain each had their own copy of PCG3D, and they now share this one, with the same results.
- **The rivulets' keys.** They were built from a float multiply-add. They are now whole numbers: column, cell and which value.
- **Grain and dither.** One hash per pixel per frame now gives the grain and both dither values. Before, they came from three sine hashes.
- **A lighter hash for the wear noise.** The wear noise hashes eight grid corners for every pixel of every wall. With PCG3D there, the interiors' opaque pass was 0.04 to 0.06 ms slower, from 1.5 to 4.5 percent, in every run. That noise now uses a cheaper hash, `HashWordFast`. It mixes the three coordinates with multiplications by large odd constants and XORs them, then applies MurmurHash3's finaliser. It needs 5 multiplications where PCG3D needs 7. The cost is back inside the noise of the benchmark. Rain, beads, the moon and grain stay on PCG3D, because they hash far less often.

## What it looks like

Every stain, scuff, wet patch, ripple, rivulet, bead and leaf strike, as well as the moon's detail and the grain, rolled again. They fall in new places, and how much of each there is stays the same. Both hashes spread their values evenly. The old one measured a mean of 0.498 and a standard deviation of 0.289, against 0.5 and 0.289 for an even spread. Mean brightness and fine detail barely move:

| Scene | Mean brightness | Fine detail (deviation) | Pixel difference (mean / 255) |
|---|---|---|---|
| Hallway | 37.37 to 37.39 | 9.11 to 8.99 | 1.99 |
| House | 36.55 to 36.61 | 9.75 to 9.74 | 1.81 |
| Kitchen | 29.97 to 30.02 | 14.24 to 14.24 | 1.43 |
| Woods | 10.07 to 10.10 | 13.28 to 13.28 | 0.73 |
| Night woods | 13.20 to 13.14 | 13.41 to 13.44 | 1.83 |

Part of every difference is the new grain and dither pattern, which is one step up or down on every pixel. In the hallway's first pose, the dark streaks low on the left wall moved elsewhere, so this view is slightly cleaner.

In each pair below, the left image is before (master, float hash) and the right is after. The region marked in yellow is enlarged underneath.

![The hallway before and after](/images/2026-10-30-integer-hash/hallway-before-after.jpg "The hallway. The region enlarged below each image is the ceiling's wear texture.")

![The house before and after](/images/2026-10-30-integer-hash/house-before-after.jpg "The house, a wallpapered room. The region enlarged below each image is the wallpaper near the ceiling edge.")

![The kitchen before and after](/images/2026-10-30-integer-hash/kitchen-before-after.jpg "The kitchen. The region enlarged below each image is the sink basin.")

![The night woods before and after](/images/2026-10-30-integer-hash/woods_night-before-after.jpg "The night woods. The region enlarged below each image is the wet ground with rain streaks.")

## A test that measured its own noise

`LeafPopTests` failed at 30 m and 40 m after the change, though nothing about the leaves had changed. The test decides which pixels are plants by comparing them with the background colour. It took that colour from one pixel, and that pixel carries the output's dither, so its random one-step difference moved the threshold for the whole image.

I proved this by putting the old dither back for one run, and the test passed again. The background is now each channel's median along the top row of the image. Measured that way, master fails the test too: the 30 m coverage gap is really 5 percent, not the 0.4 percent its limit had been tuned to. I measured the 30 m and 40 m coverage limits again (0.053 and 0.105, with limits of 0.071 and 0.131) and left a comment saying why.

## Speed

Mean GPU milliseconds, master to the integer hash, with TAA on and off:

| Scene | TAA on | TAA off |
|---|---|---|
| Hallway | 3.894 to 3.936 | 3.686 to 3.599 |
| House | 3.649 to 3.671 | 3.416 to 3.389 |
| Kitchen | 3.233 to 3.255 | 2.996 to 3.014 |
| Woods | 8.350 to 8.341 | 8.058 to 8.017 |
| Night woods | 8.832 to 8.884 | 8.555 to 8.510 |

All of these are within noise: a single run moves by 1 to 2 percent. `ctest` in Release passes 118 of 118. The frame-spike walk had no spikes, with a 99th-percentile frame time of 10.39 ms in the woods and 11.77 ms in the night woods.

The measurements in this post come from one GPU, an RTX 4070. The guarantee that every GPU gives the same placement rests on the arithmetic, not on tests with other hardware.

## Open issues

- The flashlight's flicker, computed on the CPU in `RenderSceneView.cpp`, still uses a sine hash. It runs once per frame on one machine, so it cannot disagree with itself.
