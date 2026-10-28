---
title: Smaller textures and matching the reference
date: 2026-09-29
order: 1
summary: Block-compressed textures that use a sixth of the memory, Toksvig roughness for distant bumps, and a look panel that measures the hallway against a reference.
tags: renderer, materials, tools
cover: /images/2026-09-29-compression-and-reference/bench-after-look.jpg
---

By now the renderer had shadows, ambient occlusion, reflections, anti-aliasing, fog and a full camera chain, and it was all well inside its time budget. Two things were still bothering me. Texture memory was heavy, and I had no way to say whether the hallway looked like Resident Evil 7 other than squinting at it. Today I fixed both.

## Texture compression

Every material texture sat on the GPU as plain 8-bit RGBA: four bytes per pixel. For the demo's six 2K maps, plus their mip levels (the chain of smaller copies used for distant surfaces), that came to 21 MB each. Memory costs more than space. Every frame the GPU has to *read* those bytes, so smaller textures are also faster.

> **Concept: Block compression.** GPUs can read special compressed texture formats directly. The texture is cut into 4 × 4 blocks of pixels, and each block is stored in just 8 or 16 bytes. The texture hardware decodes a block as it fetches it, so there's no extra work for the shader. A 4 × 4 block of RGBA pixels is 64 bytes, so 8 bytes is an eighth of the size, and 16 bytes is a quarter.

The compression is *lossy*. Each block can't store 16 arbitrary colours. The simplest format, BC1, stores two endpoint colours per block and gives each pixel a 2-bit choice among four colours interpolated between them. That works well when a block's colours roughly lie along a line in colour space, and most surface texture does.

### Four formats, four jobs

I wrote the encoders from scratch, and every image is encoded on all CPU cores.

| Format | Used for | Size vs RGBA8 | Idea |
|---|---|---|---|
| BC1 | Opaque colour | 1/8 | Fit a line through the block's colours, then nudge the two end colours to match the four-step palette best. |
| BC3 | Colour with alpha | 1/4 | BC1 colour plus a separate alpha channel. |
| BC4 | One channel (roughness, AO) | 1/8 | Two end values and a palette between them, searched around the block's min and max. |
| BC5 | Normal maps | 1/4 | Two BC4 channels (x and y). The shader rebuilds z. |

The cooking step picks the format from what the texture is *for*. Colour is BC1, or BC3 if it has any transparency. Normals are BC5. Roughness and metalness maps from glTF go to BC5, or BC4 if the map is a single grey channel. Occlusion is BC4. The GPU view then moves the channels back to where the shader expects them. The only shader change was rebuilding the normal's z from x and y, which is possible because a normal has length one.

### Is it any good?

I measured quality with signal-to-noise ratios, in decibels. Above roughly 40 dB the difference is invisible to the eye.

| Demo map | Format | Quality |
|---|---|---|
| Plaster roughness | BC4 | 51.8 dB |
| Wood normals | BC5 | 46.8 dB |
| Wood colour | BC1 | 43.8 dB |
| Plaster colour | BC1 | 40.5 dB |

Normals decoded within 3 degrees after rebuilding z. Flat blocks are exact or within 2 levels. White noise, which nothing can compress well, stays above 26 dB. I made one compromise: the BC4 encoder searches 25 end-value pairs around each block's min and max instead of all 65,536. An exhaustive search would make the Debug cook take minutes, and the local search already gets 51.8 dB.

The compressed mips go into the existing texture cache. The cache key includes the encoder version, so changing an encoder recooks everything. The first cold start in a Debug build takes 10.2 seconds to cook, and every start after that is 1.30 seconds, the same as before.

### What it saved

| | Before | After |
|---|---|---|
| Material textures | 134.0 MB | 22.6 MB |
| Process video memory | 472 MB | 360 MB |
| GPU scene pass | 1.39–1.62 ms | 1.39–1.56 ms |

That is a sixth of the texture memory. My plan had predicted 210 MB falling to 55 MB. The reality was smaller on both ends, because the demo only uploads 134 MB of material textures to begin with (height maps are never uploaded). The scene pass is up to 9% faster since the same texels are a sixth of the bytes to fetch. Compared with the same build with compression off, the images differ by an average of 0.04 to 0.17 out of 255, and no pixel by more than 12.

![Wood floor highlights at 3x zoom, uncompressed and compressed](/images/2026-09-29-compression-and-reference/floor-rgba-vs-bc.jpg "The largest difference anywhere: the floor's highlights at 3x zoom. Left: uncompressed. Right: compressed. The same streaks, with a few speckles moved.")

## Toksvig: keeping far-away bumps honest

There was a second, subtler problem with textures, and it is about mip-mapping.

When a surface is far away, one texel of a smaller mip level covers many texels of the original. For colour, averaging is fine. For a normal map it isn't. A normal map is full of tiny bumps pointing different ways. Averaging them gives one smooth, flat-looking normal. But physically the bumps are still there, they just got too small to see. A glossy surface with a smoothed normal then keeps a tight, flickering highlight it shouldn't have, because the real microscopic bumps would have spread that highlight out.

> **Concept: Toksvig roughness.** When you average normals, the length of the average tells you how much they disagreed. If they all point the same way, the average still has length 1. If they scatter, it shrinks. *Toksvig's method* turns that shrinkage into extra roughness: the more the normals under a texel disagreed, the rougher the mip should be. Roughness is a stand-in for "how scattered are the microscopic bumps", so the bumps lost to averaging come back as blur.

The cook now reads the material's normal map alongside its roughness map. For every roughness mip it measures how much the normals underneath disagree and widens the roughness to match. It only ever widens, never narrows, and it stays bounded. The normal map is part of the roughness cook's cache key, so editing the normal map recooks the roughness. A checkerboard test of tilted normals widens mip 1 by exactly the predicted amount.

![Plaster at a grazing angle near a lamp, without and with Toksvig](/images/2026-09-29-compression-and-reference/plaster-toksvig.jpg "Toksvig at 3x zoom. Left: without it, bright single-texel glints. Right: with it, the glints become a soft sheen and the colour detail is unchanged.")

One caveat: it ignores the per-object normal strength. The floor draws its normals at 0.55 strength, so its mips are widened slightly more than needed. At bench distances the difference is small.

The Profile panel, the tool server and every bench report now show video memory and the share used by material textures.

## Matching the reference

Now the other problem. Until now, "does it look like Resident Evil 7?" was a judgement by eye. I have a reference frame: a narrow hallway lit by a warm sconce, mostly dark, with lit yellow-olive plaster, a light-grey door frame and a warm brown wood floor. I wanted that comparison to be a measurement, so that both I and an AI agent working through the editor's tool server could tune the look by feedback and not by guessing.

### Image statistics

I wrote a small library that takes any image and reports:

- **Brightness**: mean, median, the 5th and 95th percentiles, and a 32-step histogram. The measure is *luma*, how bright a pixel looks on screen, not its linear light value. Linear values would weight the lamp bulbs so heavily that they would hide the differences in the dark end, which is what matters in this look.
- **Colour**: mean saturation, plus brightness, saturation and average hue for each horizontal third of the frame (ceiling, middle, floor). Hue is weighted by how coloured each pixel is, so grey pixels don't vote.

The reference reads as a very dark frame. Half its pixels are below about 5% brightness (median 0.052), with a 95th percentile of 0.433 where the lamp-lit plaster sits. It's muted, with a saturation of 0.29, and warm: hue about 59 degrees at the top, 52 in the middle and 42 at the floor, which is yellow-olive walls over a brown floor.

### look_compare and the Look panel

A new tool, `look_compare`, renders the current view (live in the editor, or headless) and puts it next to the reference. It returns the side-by-side image, both sets of statistics, and the differences. An agent changes a setting, calls it again, and repeats until the numbers are close. That is exactly how this day's look pass was done.

A *look* is the 56 render settings that shape the image: exposure, tone and grade, bloom, lens, ambient light, fog, shadows, AO, reflections and TAA. It can be saved as a preset, and loading one is a single undo step. The editor gained a Look panel with the same settings grouped by purpose and an A/B feature: *Snapshot* stores the current look, and *Show B* and *Show A* flip between it and your edits. A test makes sure every render setting is either in a Look group or deliberately left out, so new settings can't silently miss the panel.

![The editor with the Look panel in the bottom dock](/images/2026-09-29-compression-and-reference/look-panel.jpg "The Look panel in the bottom dock, after flipping to a snapshot. The Exposure group is open underneath.")

### What the numbers said

The first comparison was humbling. In the mid-tones the hallway was about three times too dark, about twice as saturated as the reference, and the floor was **green**: its hue was 96 to 138 degrees where the reference is 42.

Swapping in the neutral colour grade alone moved every third of the frame to between 36 and 54 degrees and doubled the median brightness. So the culprit was my own `re7_hallway` grade from a few days earlier. It added fixed colour offsets, such as a small subtraction of red in the shadows and a crushed toe. At the hallway's typical display values of about 0.03, those offsets are enormous in proportion. They turned the darks green and pushed them to black.

I reworked the grade in its generating script:

- stronger desaturation, keeping 40% of the colour in shadows and 60% in highlights;
- a multiplicative warm-olive lean (less blue) instead of fixed offsets, so it scales with brightness;
- warmer highlights and a gentle toe.

Then three scene settings moved: exposure compensation from −3.3 to −2.5 EV, the old grade tint strength from 0.52 to 0.25, and bloom from 0.38 to 0.5, because the reference's bulb has a bigger glow. Ambient intensity turned out not to matter, since auto-exposure renormalises the frame. The contrast comes from the lights.

| | Median | 5th pct | 95th pct | Saturation | Floor hue |
|---|---|---|---|---|---|
| Reference | 0.052 | 0.008 | 0.433 | 0.29 | 42° |
| Before | 0.009–0.019 | 0.000–0.002 | 0.11–0.27 | 0.54–0.63 | 96–138° |
| After | 0.046–0.063 | 0.007–0.012 | 0.22–0.45 | 0.30–0.33 | 48–56° |

![The six bench poses before the look pass](/images/2026-09-29-compression-and-reference/bench-before-look.jpg "Before: dark, and green in the shadows.")

![The six bench poses after the look pass](/images/2026-09-29-compression-and-reference/bench-after-look.jpg "After: warm olive plaster and brightness in the reference's range, with the lamps still pooling light.")

Median, dark end, saturation and hue now sit on the reference. The bright end is still lower at most poses, and I'm honest about why. The reference frame is filled with a lit wall, a pale door frame and a lit floor, while most of my views are a long dark corridor. That is a content gap (props, lighter paint, broader pools of light), not a camera-setting gap, and no amount of tuning exposure fixes missing furniture.

## Where Track B ended up

This closed the graphics block. Across it, the GPU frame fell by about a third in a Debug build on an RTX 4070 at 1440p (from 2.75–3.45 ms to 1.83–1.94 ms), while the renderer gained soft shadows for the flashlight and four lamps, GTAO, floor reflections, a bloom chain, auto-exposure, LUT grading, TAA, volumetric fog and compressed textures. Scaling by the 3060's shader throughput and memory bandwidth, I estimate about 4 to 4.5 ms there against an 11 ms budget. That's an estimate, not a measurement.

What's next is content, not shaders. A lighter plaster, a herringbone floor, a chair and side table, frames with art and a lit door: the things that fill the reference frame. The authored door's wood grain also shows wavy stripes at one pose, and the brighter look makes them easier to see. I'll have to fix that.
