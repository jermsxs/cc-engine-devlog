---
title: Bloom, auto-exposure, LUT grading and sRGB output
date: 2026-09-28
order: 5
summary: A post-processing chain built for a dark scene with mip-chain bloom, histogram auto-exposure with limits, a 32-cube colour LUT, film grain and exact sRGB output.
tags: renderer, post-processing
cover: /images/2026-09-28-the-camera/bloom-sconce.jpg
---

Everything that happens after the 3D scene is drawn decides whether the image reads as a photograph. It controls how bright lights glow, how the camera copes when the view moves from a dark room to a lit one, the colour palette and the grain. Until this point all of that was one pass with a hand-made blur and a fixed exposure. I replaced it with a chain of separate steps, in this order:

1. The scene is rendered in linear HDR into a 16-bit float target.
2. A compute pass meters the image and chooses an exposure.
3. A bloom chain builds the glow from the exposed bright areas.
4. The final pass applies exposure, adds the bloom, tone maps, converts to sRGB, grades with a LUT, applies vignette, grain and dither, and writes the screen image.

## Linear light, HDR and the display

A lamp is thousands of times brighter than a wall in shadow. The renderer keeps those real ratios as high dynamic range (HDR) numbers. My scene target stores 16-bit floating point per channel, so a bulb can be several hundred in arbitrary units while a dark corner is a few thousandths. A screen shows 256 levels per channel between black and white. Two decisions turn the HDR image into the screen image. *Exposure* chooses which part of the range becomes visible, and *tone mapping* decides how to compress everything above it.

The second issue is how numbers relate to brightness. Light adds linearly, since two equal lamps give twice the light, so lighting, blending and blurring must all run on linear values. Screens and 8-bit images are not linear. Human vision is more sensitive to differences in dark tones, so the sRGB transfer function spends more of its 256 codes on the darks:

```
encoded = 12.92 · c                      for c ≤ 0.0031308
encoded = 1.055 · c^(1/2.4) − 0.055      otherwise
```

If the encoding is applied twice, or skipped, mid-tones look washed out or crushed. I had been using a power of 2.2 as an approximation, which is close but differs near black. The power curve rises steeply from zero, while the sRGB curve has a short straight segment there. A linear value of 0.002 becomes level 15 of 255 with the 2.2 power and level 6.6 with sRGB. In a scene as dark as this one that matters.

The back buffer now has an `_SRGB` view, so the graphics hardware applies the exact curve when the pixel is written. The editor's interface is drawn into the same buffer. Its palette and see-through panels were designed for plain bytes, so the interface draws through a second, non-sRGB view of the same memory and its pixels are byte-for-byte what they were. An editor capture before and after changed no pixel outside the scene viewport. The scene itself gets deeper blacks, by up to 9 of 255 levels in the darkest tones, which is the intended effect of using the correct curve.

The grade, vignette and grain are defined on display values, so my final shader converts to sRGB itself, applies those steps, and converts back to linear on output. The hardware's encode then restores the display value I computed.

## Exposure

Photographers measure light in stops, where one stop is a factor of two. An exposure value (EV) counts stops. A scene whose average luminance is `L` corresponds to an EV100 of:

```
EV100    = log2( L · 100 / K )          K = 12.5, a standard calibration constant
exposure = 1 / ( 1.2 · 2^EV100 )
```

Doubling the scene's brightness raises EV100 by one and halves the exposure multiplier. For example, an average luminance of 0.1 gives an EV100 of −0.32 and a multiplier of about 1.04.

### Choosing L

The obvious choice is the average of all pixel luminances. That fails here, because a few very bright pixels dominate it: a bulb at 500 across 50 pixels outweighs a million pixels at 0.01. Averaging in the log domain gives every stop equal weight, and that is what a histogram of log luminance provides.

- A compute pass bins each pixel's log2 luminance into 64 bins covering 2^−12 to 2^4, which is 16 stops at about a quarter stop per bin. It samples every second pixel in each direction, and bin 0 collects black.
- A second pass runs on a single GPU thread. It averages the bins between the 5th and 95th percentiles and ignores the darkest and brightest 5%, so one lamp or one black corner cannot decide the exposure.
- The result becomes a target EV100, clamped to the scene's limits. The camera then moves toward it with an exponential approach, `adapted += (target − adapted) · (1 − exp(−dt · speed))`, which behaves the same at any frame rate. The speed is 1.2 per second when the scene gets darker and 3.0 when it gets brighter, because the eye opens more slowly than it closes.
- When the clock is frozen or the camera jumps, the exposure snaps to the target, the same rule I used for shadow fades, so screenshots never catch it mid-adjustment.

### Limits for a horror scene

A normal camera metering a nearly black room would open up until the average looked mid-grey, which lifts the darkness to a comfortable grey. That is the opposite of the look I want. The scene therefore sets a minimum EV100 of −3 and a compensation of −3.3 EV, which enters the formula as `2^(EV100 − compensation)`. The highest exposure the camera can reach is then `1 / (1.2 · 2^(−3 + 3.3)) = 0.68`, up from the fixed value of 0.5 I used before. Dark views stay dark. Looking into a lamp or pointing the flashlight at a close door raises the metered EV and lowers the exposure, so the picture is not blown out.

I moved exposure out of the scene shader into the post pass, so the metered value applies to everything. Bloom reads the same value, so its threshold means "as bright as the camera sees it".

![Fixed exposure in the upper six views, metered auto-exposure in the lower six](/images/2026-09-28-the-camera/exposure-manual-vs-auto.jpg "Top: fixed exposure 0.5. Bottom: the metered camera with the horror limits. Dark views are unchanged, and the bright door and lamp views close down.")

## Bloom

A real lens or eye scatters a small share of the light from a very bright source into a glow around it. The screen cannot be brighter than white, but the glow tells the viewer that the source is much brighter than its surroundings. A bloom effect copies the bright parts of the image, blurs them and adds them back.

The problem is the blur radius. A glow around a lamp needs a radius of many pixels at 1440p, and the cost of a separable blur grows with the radius. My old pass took a handful of samples around each pixel and produced blocky squares around the sconce glass. The new one uses a mip chain, following Jimenez's method from *Call of Duty: Advanced Warfare*.

1. **Shrink** the exposed image six times, to 1/64 of its width, each step with a 13-tap filter.
2. **Grow** it back. Each level is upsampled with a 3 × 3 tent filter and added into the next larger level, so the largest level ends up holding the sum of all six.

A small kernel on a small image covers a large area of the full image, so each level doubles the effective radius. The sum is tight near the bulb and wide and soft far from it, which resembles a real lens glow. The levels together are 1/4 + 1/16 + … of the pixels, about a third of one full-resolution pass, and the whole bloom costs 0.09 ms. The final pass averages the six levels and adds them with a strength of 0.38 in the demo scene. The first downsample also applies a soft-knee threshold to the brightest channel, so only pixels above a threshold glow.

### Fireflies

The sconce's bulb is a few centimetres behind its glass, so the glass pixels receive HDR values hundreds of times brighter than the wall. If a 2 × 2 group contains one such pixel, the group average is a quarter of an enormous value. After more downsampling and bilinear upsampling, that single pixel becomes a bright block. As the camera moves, the pixel enters and leaves the group and the block flickers.

The first downsample therefore uses a *Karis average*. Each sample is weighted by `1 / (1 + luma)`. A sample's contribution then grows as `L / (1 + L)`, which approaches 1 instead of growing without limit, so one extreme pixel counts for little more than a bright one. The blocky squares I noted after the lighting rewrite are gone.

![A wall sconce, with the old bloom on the left and the new mip chain on the right](/images/2026-09-28-the-camera/bloom-sconce.jpg "Left: the old single-pass bloom. Right: the mip chain wraps a smooth glow over the glass and collar.")

## Tone mapping

After exposure and bloom, values still range far above 1. A hard clamp turns everything above 1 into flat white, with an abrupt edge, and it clips each colour channel separately so bright colours shift hue. A *tone-mapping curve* maps the whole range into 0 to 1 smoothly. It has three parts: a toe that deepens the darks, a middle section close to linear, and a shoulder that compresses highlights so they approach white without a hard edge.

I use the ACES filmic fit published by Narkowicz, per channel:

```
y = x · (2.51 x + 0.03) / ( x · (2.43 x + 0.59) + 0.14 )
```

![The ACES fit compared with a hard clip](/images/2026-09-28-the-camera/tone-curve.svg "The curve rises faster than linear in the shadows, then flattens. An input of 1 maps to 0.80 and an input of 4 to 0.97.")

Between 0.05 and 0.1 the output rises from 0.044 to 0.126, a steeper slope than linear. That is the toe adding contrast in the dark tones. Above 1 the slope falls, so a lamp-lit wall at 4 still keeps some gradation at 0.97 instead of clipping. I added a white-point setting: the curve is divided by its own value at the chosen white point. The default of 7.24 gives a divisor of 0.99999, so it leaves the old curve unchanged.

## Colour grading with a LUT

A colour look-up table (LUT) is a 3D cube. The input colour selects a position in the cube, and the entry there is the new colour. Colourists use LUTs to give a film its palette, such as green-grey shadows, warm highlights and crushed blacks. The whole grade is a small image, and applying it costs two texture reads per pixel.

Mine is 32 × 32 × 32, stored as a 1024 × 32 strip of 32 slices. The shader scales the colour to the 0 to 31 range. The blue channel picks the slice. A bilinear read in each of the two nearest slices handles red and green, and a linear blend between them handles blue. A script, `build_luts.py`, writes two LUTs. The *neutral* one changes nothing. `re7_hallway` is desaturated, with cool green-grey shadows, slightly warm highlights and crushed blacks.

A test shows that the neutral LUT, both in code and as the shipped PNG, moves no colour by more than 1/255 (the worst case was 0.42/255). On a real frame it changed pixels by at most 1/255, so the machinery adds no tint of its own. The grade runs after tone mapping and sRGB encoding, since the LUT's domain is the display range of 0 to 1. The older tint controls still run before tone mapping and overlap with the LUT, so they are candidates for retirement.

![The neutral LUT above and the re7_hallway LUT below, applied to the same views](/images/2026-09-28-the-camera/lut-neutral-vs-re7.jpg "Top: the neutral LUT. Bottom: the tuned grade, colder and greener in the shadows with warmer lamp light.")

## Vignette, grain and dither

The vignette darkens the corners with a smooth falloff on the distance from the image centre. Film grain is per-pixel noise added to the display image. Its amplitude is scaled by `4 · L · (1 − L)`, where `L` is the display luminance, so it is strongest in the midtones and zero at pure black and white. That keeps dark gradients from turning noisy. The strength is 0.04 and the vignette is 0.62 in the demo scene. The noise pattern changes with a frame counter, and the counter stops when the clock stops. Two benchmark runs therefore give identical screenshots, which I checked: they differ by 0.

An 8-bit image has only 256 levels per channel, and a slow dark gradient covers only a few of them, so each step is wide enough to see as a band. A *dither* adds a small noise before the value is rounded. I add triangular noise of one level, the sum of two uniform noises minus one, so the rounding error no longer follows the image content.

## Results

The post chain got cheaper while doing more. Bloom is 0.09 ms and the exposure meter 0.03 ms. The whole post stage was about 0.25 ms, down from 0.32 ms, well under its 1 ms budget for an RTX 3060-class card. The measurements are from a Debug build on an RTX 4070 at 1440p.

| Pose | GPU frame before | after | Post before | after |
|---|---|---|---|---|
| south_start | 1.04 ms | 0.97 ms | 0.32 ms | 0.25 ms |
| north_corridor_long | 1.00 ms | 0.92 ms | 0.32 ms | 0.25 ms |
| west_lamp_closeup | 1.05 ms | 0.97 ms | 0.32 ms | 0.25 ms |

![The six benchmark poses with the new camera chain](/images/2026-09-28-the-camera/bench-after.jpg "The six poses after the camera work: metered exposure, the new grade, mip-chain bloom and grain.")

Two things remain open. Metering averages the whole frame. A centre-weighted meter would probably suit the flashlight better, once there is gameplay to judge it by. Exposure compensation and the white point are only in the inspector and the MCP tools, not yet on the in-game tuning list. The next step is ambient occlusion and real floor reflections.
