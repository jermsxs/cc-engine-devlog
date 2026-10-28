---
title: Block-compressed textures, Toksvig roughness and measuring the look
date: 2026-09-29
order: 1
summary: Textures cut to a sixth of their memory with BC1, BC4 and BC5 encoders, Toksvig roughness for distant bumps, and a look panel that measures the hallway.
tags: renderer, materials, tools
cover: /images/2026-09-29-compression-and-reference/bench-after-look.jpg
---

By this point the renderer had shadows, ambient occlusion, reflections, anti-aliasing, fog and a full camera chain, all inside its time budget. Two problems were left. Texture memory was heavy, and I had no way to say whether the hallway looked like Resident Evil 7 other than judging it by eye. This entry covers three pieces of work: block-compressed textures, a fix for distant bumpy surfaces that keep glints they should not have, and a set of tools that turn "does it look right" into numbers.

## Block compression

### Why textures are compressed

Every material texture was stored on the GPU as 8-bit RGBA, four bytes per pixel. A 2048 × 2048 map with its mip levels (the chain of half-size copies used for distant surfaces) takes 2048 × 2048 × 4 × 4/3 bytes, about 21 MB. The demo loaded 134 MB of material textures. Memory is only part of the cost. Every frame the GPU reads those bytes from video memory, so a smaller texture also uses less bandwidth.

A general image codec such as PNG or JPEG does not help, because the GPU must read any texel at any time, in any order, without decoding a whole image first. Texture formats therefore use a fixed compression ratio and a layout in which the address of any texel's data is a simple calculation. The BC family (block compression, also called DXT or S3TC) does this. The image is cut into 4 × 4 blocks of pixels, and every block is stored in the same fixed number of bytes, 8 or 16. To read a texel, the hardware finds the block by dividing the coordinates by four, decodes that one block, and returns the colour. The shader does no extra work.

The compression is lossy, because 16 arbitrary colours cannot fit in 8 bytes. The format assumes that the colours inside a small block are related, and stores a compact description of the relationship.

### BC1, step by step

BC1 stores opaque colour in 8 bytes per block, which is 4 bits per pixel against 32, an eighth of the size.

1. The block holds two *endpoint* colours, each a 16-bit value with 5 bits for red, 6 for green and 5 for blue.
2. The hardware builds a four-colour palette on the line between the endpoints: the two endpoints, one third of the way along, and two thirds of the way along.
3. Each of the 16 pixels stores a 2-bit index into that palette. The indices take 4 bytes and the endpoints another 4.

![A 4 by 4 block, its palette on a line through colour space, and the sixteen indices](/images/2026-09-29-compression-and-reference/bc1-block.svg "BC1 in one block: two stored endpoints, two interpolated palette colours and sixteen 2-bit indices.")

The format works well for a surface texture because the pixels of a small patch of plaster or wood usually lie close to a line in colour space, going from a darker to a lighter shade of the same colour. It fails when a block contains two unrelated colours, such as a red edge beside a green one, because four points on one line cannot represent both. The endpoints themselves are also coarse, 5 and 6 bits per channel, which matters for the dark, smooth gradients in this scene. I come back to that at the end of this section.

### The other formats

BC4 stores a single channel. It has two 8-bit endpoints, a palette between them and a 3-bit index per pixel: 2 bytes of endpoints plus 6 bytes of indices, so 8 bytes per block and one byte per 2 pixels. It has two modes, chosen by the order of the endpoints. If the first is larger, the palette is the endpoints plus six values evenly spaced between them, eight values in all. If it is smaller, the palette is the endpoints plus four values between them and the two fixed values 0 and 255. The second mode is useful for blocks that contain exact black or white.

BC5 is two BC4 blocks side by side, 16 bytes per block. It stores the x and y of a normal map. A tangent-space normal has length one and points out of the surface, so `z = sqrt(1 − x² − y²)`, and the shader rebuilds z. BC1 would tie the three channels to one line, so BC5 compresses x and y independently. BC3 is a BC4 alpha block followed by a BC1 colour block, 16 bytes, for colour with transparency.

## My encoders

The hardware defines how a block is decoded. How an encoder chooses the endpoints and indices is up to the author, and that choice decides the quality. I wrote all four encoders from scratch, and each image is encoded on all CPU cores.

**BC1.** For each block, in order:

1. If all 16 pixels are identical, a precomputed table gives the best pair of 5-6-5 endpoints for each 8-bit value, so flat areas decode almost exactly.
2. Otherwise, the encoder computes the mean colour and the covariance of the 16 pixels and finds the *principal axis*, the direction in which the colours vary most, by eight rounds of power iteration.
3. It projects every pixel onto that axis and takes the extreme projections as the first guess for the endpoints, rounded to 5-6-5.
4. It assigns each pixel to the nearest of the four palette colours and measures the squared error.
5. It then refines the endpoints. For the chosen indices, the best endpoints are the solution of a small least-squares problem, which gives two new endpoints directly. If the new pair gives a lower error after rounding, it is kept. This repeats up to two times.
6. The encoder orders the endpoints so the hardware uses the four-colour mode, which requires the first endpoint to be larger than the second, and swaps the indices to match.

**BC4.** A full search of all 65,536 endpoint pairs per block is too slow. The encoder tries 25 pairs around the block's minimum and maximum in the eight-value mode and 9 in the six-value mode, fits the best index for each pixel, and keeps the lowest error. On the demo's plaster roughness map the result is 51.8 dB, and a Debug-build cook that searched everything would have taken minutes.

**BC5** is two BC4 encodes. **BC3** is the BC4 encode for alpha and the BC1 encode for colour.

### Which format each texture gets

The cooking step chooses the format from what the texture is for:

- colour is BC1, or BC3 if it has any transparency;
- normal maps are BC5;
- glTF metal-and-roughness maps are BC5 of roughness and metalness, or BC4 if the map is a single grey channel, which is the case for the wood and plaster roughness maps;
- occlusion is BC4.

The GPU view moves the channels back to where the shader expects them, so the only shader change was rebuilding the normal's z. Colour textures are viewed as sRGB, so the hardware converts to linear light before filtering.

The mip chain is built before compression, and the averaging matters. Colour mips are averaged in linear light and converted back, since averaging sRGB values makes distant bright and dark detail too dark. Normal mips are averaged as vectors and renormalised to unit length. The compressed mips go into the existing texture cache. The cache key includes the encoder version, so changing an encoder recooks everything. The first cold start in a Debug build takes 10.2 seconds, and later starts take 1.30 seconds, the same as before.

### Quality

I measure quality with the peak signal-to-noise ratio, `10 · log10(255² / MSE)`, in decibels, where MSE is the mean squared difference from the original over all channel values. 40 dB corresponds to an RMS error of about 2.5 levels out of 255, which is invisible in these textures. 26 dB is an error of about 13 levels.

| Demo map | Format | Quality |
|---|---|---|
| Plaster roughness | BC4 | 51.8 dB |
| Wood normals | BC5 | 46.8 dB |
| Wood colour | BC1 | 43.8 dB |
| Plaster colour | BC1 | 40.5 dB |

Synthetic tests add flat BC4 blocks and two-value blocks decoding exactly, flat BC1 colours within 2 levels per channel, gradients above 40 dB, white noise above 26 dB and normals within 3 degrees after the z rebuild. The plaster colour at 40.5 dB sits closest to the threshold, which matters for what happened later.

### What it saved

| | Before | After |
|---|---|---|
| Material textures | 134.0 MB | 22.6 MB |
| Process video memory | 472 MB | 360 MB |
| GPU scene pass | 1.39–1.62 ms | 1.39–1.56 ms |
| Warm startup | 1.30 s | 1.30 s |

Texture memory fell to a sixth. My plan had expected 210 MB falling to 55 MB, and both numbers were wrong in the same direction, because the demo uploads 134 MB of material textures to begin with (height maps are never uploaded). A 2K colour map with mips is 2.7 MB as BC1 and a 2K normal map is 5.3 MB as BC5, against 21 MB uncompressed. The scene pass is up to 9% faster, since the same texels are a sixth of the bytes to fetch. Against the same build with compression off, the images differ by an average of 0.04 to 0.17 levels out of 255, and no pixel differs by more than 12.

![The wood floor's highlights at 3 times zoom, uncompressed and compressed](/images/2026-09-29-compression-and-reference/floor-rgba-vs-bc.jpg "The largest difference anywhere: the floor's highlights at 3x zoom. Left: uncompressed. Right: compressed. The same streaks, with a few speckles moved.")

BC1 gives a block only four colours, so dark, smooth surfaces such as the house's plaster band visibly. On 2 October I added a BC7 encoder for colour: 16 bytes per block, 16 levels per pixel in its mode 6, and the plaster scan went from 40.5 dB to 51.4 dB at twice the colour memory.

## Normal maps and mip levels

### What goes wrong at a distance

A surface far from the camera uses a small mip, in which one texel stands for many texels of the full-size map. For colour, averaging is the right operation. For normals it is not. A normal map is a field of tiny bumps whose normals point in different directions. Averaging the normals of a patch gives one nearly flat normal, as if the patch were smooth, yet the bumps still exist at their true size. They are only too small to resolve.

This matters for specular light. A glossy surface with many tiny bumps scatters a highlight over a wide range of angles, because different bumps reflect it in different directions. A smooth surface keeps the highlight narrow and bright. If the mip averages the bumps away and the roughness stays the same, the distant floor reflects like a smooth mirror and shows tiny, bright glints that flicker as the camera moves.

### Toksvig's method

The length of the average normal measures how much the normals disagreed. If they all point one way, the average of unit vectors still has length 1. If they scatter, the average is shorter. Toksvig (2005) uses that shrinkage to increase the roughness of the mip, so that the variation the averaging removed returns as a wider highlight.

I use the form from Neubelt and Pettineo (2013), which treats the normals under a texel as a von Mises–Fisher distribution, the spherical analogue of a Gaussian. With `r` the length of the average normal, the concentration `κ` is approximately:

```
κ = (3r − r³) / (1 − r²)
```

A large `κ` means tightly clustered normals. Roughness in the shader is perceptual, `alpha = roughness²`, and the GGX lobe of the surface becomes wider by the spread of the normals:

```
alpha'² = alpha² + 2 / κ
roughness' = sqrt(alpha')
```

For a base roughness of 0.3, the new roughness depends on `r` as follows:

| Average normal length `r` | κ | New roughness |
|---|---|---|
| 0.999 | 1000 | 0.32 |
| 0.99 | 100 | 0.41 |
| 0.95 | 20 | 0.57 |
| 0.9 | 10 | 0.67 |

Other methods exist. LEAN and LEADR mapping store second moments of the slope per texel, which also capture a bump's direction, but they need extra channels and extra reads in the shader. Toksvig changes one scalar per mip texel in the roughness map and leaves the shader alone, which is enough for this scene's floor and plaster.

### In the cook

Roughness and normals live in different textures, so the cook reads the material's normal map together with its roughness map. It starts from the unit normals of the full-size map and averages them in 2 × 2 groups down the chain, without renormalising, so the vector length is kept at each level. For every roughness mip it applies the formula above to the stored roughness. Mip 0 is unchanged. The roughness is only ever widened, and stays below 1. The normal map is part of the roughness cook's cache key, so editing the normal map recooks the roughness. Maps whose sizes do not match, or that are not powers of two, are skipped.

A test with a checkerboard of tilted normals widens mip 1 by exactly the predicted amount. Flat maps change nothing.

![Plaster at a grazing angle near a lamp, without and with Toksvig](/images/2026-09-29-compression-and-reference/plaster-toksvig.jpg "Toksvig at 3x zoom. Left: without it, bright single-texel glints. Right: with it, the glints become a soft sheen and the colour detail is unchanged.")

One approximation remains. The cook ignores the per-object normal strength. The floor draws its normals at 0.55 strength, so its mips are widened slightly more than needed. At the distances I benchmark the difference is small.

## Measuring the look

### Image statistics

Until now, whether the hallway looked like Resident Evil 7 was a judgement by eye. I have a reference frame: a narrow hallway lit by one warm sconce, mostly dark, with lit yellow-olive plaster, a light-grey door frame and a warm brown wood floor. I wanted the comparison to be numbers, so that I could tune quickly and so that an AI agent driving the editor through its tool server could do the same by feedback. What the look should be remains my decision.

I wrote a small library that takes any image and reports:

- **Brightness.** The mean, the median, the 5th and 95th percentiles and a 32-bin histogram. The measure is luma, `0.2126 R + 0.7152 G + 0.0722 B` on display values, which is how bright a pixel looks on screen. Linear light would give the lamp bulbs so much weight that they would hide the differences in the dark end, which is what matters in this look.
- **Colour.** The mean saturation, and for each horizontal third of the frame (ceiling, middle, floor) its brightness, saturation and average hue. Hue is averaged as a chroma-weighted unit vector, so grey pixels do not vote and hues on either side of red average to red, not to cyan.

The reference reads as a very dark frame. Half its pixels are below about 5% brightness (median 0.052), and the 95th percentile of 0.433 is where the lamp-lit plaster sits. It is muted, with a saturation of 0.29, and warm: a hue of about 59 degrees at the top, 52 in the middle and 42 at the floor.

### look_compare and the Look panel

The `look_compare` tool renders the current view, live in the editor or headless, and sets it beside the reference. It returns the side-by-side image, both sets of statistics and the differences. A change with `look_set` followed by another `look_compare` is one iteration.

A *look* is the 56 render settings that shape the image: exposure, tone and grade, bloom, lens, ambient light, fog, shadows, AO, reflections and TAA. It can be saved as a JSON preset, and loading one is a single undo step. The editor's Look panel groups the same settings by purpose. *Snapshot* stores the current look, and *Show B* and *Show A* flip between it and my edits. A test fails if a render setting is neither in a Look group nor deliberately left out.

![The editor with the Look panel in the bottom dock](/images/2026-09-29-compression-and-reference/look-panel.jpg "The Look panel in the bottom dock, after flipping to a snapshot. The Exposure group is open underneath.")

### What the numbers showed

The first comparison showed large gaps. In the mid-tones the hallway was about three times too dark, about twice as saturated as the reference, and the floor was green: its hue was 96 to 138 degrees where the reference is 42.

Swapping in the neutral LUT alone moved every third of the frame to between 36 and 54 degrees and doubled the median brightness. So the cause was my own `re7_hallway` grade from the day before. It added fixed colour offsets, such as subtracting 0.02 from red in the shadows, and it crushed the toe. The hallway's typical display values are about 0.03, so taking 0.02 from red removed two thirds of it. Fixed offsets are large relative to dark values and small relative to bright ones, and in a scene this dark they turned the darks green and pushed them to black.

I reworked the grade in its generating script:

- stronger desaturation, keeping 40% of the colour in shadows and 60% in highlights;
- a multiplicative olive lean, with less blue, instead of fixed offsets, so the tint scales with brightness;
- warmer highlights, and a gentle toe that sends only the bottom 0.4% to black.

Three scene settings moved: exposure compensation from −3.3 to −2.5 EV, the older tint strength from 0.52 to 0.25, and bloom from 0.38 to 0.5, because the reference's bulb has a larger glow. Ambient intensity did not matter, since auto-exposure renormalises the frame. The contrast comes from the lights.

| | Median | 5th pct | 95th pct | Saturation | Floor hue |
|---|---|---|---|---|---|
| Reference | 0.052 | 0.008 | 0.433 | 0.29 | 42° |
| Before | 0.009–0.019 | 0.000–0.002 | 0.11–0.27 | 0.54–0.63 | 96–138° |
| After | 0.046–0.063 | 0.007–0.012 | 0.22–0.45 | 0.30–0.33 | 48–56° |

The ranges cover the six benchmark poses.

![The six benchmark poses before the look pass](/images/2026-09-29-compression-and-reference/bench-before-look.jpg "Before: dark, and green in the shadows.")

![The six benchmark poses after the look pass](/images/2026-09-29-compression-and-reference/bench-after-look.jpg "After: warm olive plaster and brightness in the reference's range, with the lamps still pooling light.")

Median, dark end, saturation and hue now sit on the reference. The bright end is still lower at most poses. The reference frame is filled by a lit wall, a pale door frame and a lit floor, while most of my views are a long dark corridor. That is a content gap and not a camera-setting gap. It needs lighter plaster, broader pools of light and furniture, and no amount of exposure tuning replaces them.

## Where this leaves the graphics work

The look pass changed no rendering work, so its timings match the previous entry within noise. Over the whole graphics block the GPU frame fell by about a third, from 2.75–3.45 ms at the first 1440p benchmark to 1.83–1.94 ms, in a Debug build on an RTX 4070. An RTX 3060 has roughly 45% of its shader throughput and 70% of its memory bandwidth. Scaling each pass by the worse of the two puts the frame at about 4 to 4.5 ms against an 11 ms budget. That is an estimate and not a measurement.

The next work is content, not shaders: a herringbone floor, a chair and side table, frames with art and a lit door, the things that fill the reference frame. The authored door's wood grain also shows wavy stripes at one pose, and the brighter look makes them easier to see. That needs a fix.
