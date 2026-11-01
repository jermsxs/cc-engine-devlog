---
title: Why the canopy flickered under TAA, and fixing the sky and the wind
date: 2026-11-01
order: 2
summary: I measure canopy flicker, trace it to temporal anti-aliasing and sub-pixel wind motion, fix the TAA, compress the blown-out sky, and stop animating wind nobody can see.
tags: post-processing, foliage, renderer
cover: /images/2026-11-01-canopy-flicker-and-sky/sky-after.jpg
---

After I walked the woods path, I noticed that the leaves at the top of the frame were noisy and flickered, and that everything around them shimmered slightly. I could not tell whether it was lighting or shadows. That started a day of measurement in three rounds. After each round I could still see some of it, so I measured again and changed the next thing. This entry follows the flicker from a still camera to its cause in the temporal anti-aliasing, then to the sky behind the leaves, and last to wind that moves leaves by less than a pixel.

## Measuring flicker before changing anything

A frame is hard to judge by eye, and a screenshot cannot show flicker at all, because flicker exists only between frames. I needed a number.

> **Background: flicker and motion are different things.** A leaf swaying in the wind changes the pixels it covers from one frame to the next, and that is correct. Flicker is a pixel that changes when nothing visible has changed. The two can be told apart by direction. A real movement changes a pixel in one direction over several frames: it gets brighter as a leaf leaves, then stays bright. Flicker goes up, then down, then up again. Counting a pixel as a reversal when its change flips direction by more than a small threshold on two consecutive frames gives a measure that largely ignores genuine motion. Comparing the count across thirds of the frame shows where it concentrates.

For the first round I used a still camera at the long stretch, looking slightly up, and captured 12 frames in a row with `--capture-count=12`. `Scripts/Measure-Flicker.ps1` reports, for each third of the image, the mean luma and the share of pixels that change by more than 0.03 from one frame to the next. `Scripts/Map-Flicker.ps1` paints those pixels red. Later I extended the first script to count reversals.

Isolating the cause meant removing parts of the renderer one at a time.

- **The mean luma was flat to 0.001.** So the exposure was not pumping. After the stronger adaptation of the day before, that had been my first suspect.
- **A new `--freeze-time` flag** holds shader time still, so there is no wind and no grain. About 4% of pixels still changed by more than 0.03 every frame. That is the renderer's own flicker, with nothing in the scene moving.
- **With TAA off as well, nothing changed**, under 0.01%. Shadows and lighting are steady on their own. The flicker came from the temporal anti-aliasing.

## How TAA works, and why thin leaves defeat it

> **Background: temporal anti-aliasing.** One sample per pixel gives hard, crawling edges. TAA gets more samples by spreading them over time. Each frame the camera's projection is offset by a different sub-pixel amount, the jitter, usually along a low-discrepancy sequence. My engine cycles through 8 positions. The resolve pass then blends the current frame into a history buffer:
>
> `result = lerp(history, current, w)`
>
> A small `w` such as 0.05 means the history is an average of roughly the last 20 frames, so the image converges toward a supersampled one. Three problems must be solved for this to work on a moving image. The history must be moved to where each pixel was last frame, which uses a per-pixel motion vector (reprojection). The history can be wrong, because a surface was hidden last frame or has changed, so it is clipped into the colour range of the current frame's 3 by 3 neighbourhood, and rejected if its stored depth shows it belonged to another surface. And the blend weight must be larger where things move, or moving texture smears. Each of these protects against ghosting, and each one trades against stability.

A leaf narrower than a pixel breaks the assumptions. Whether a pixel's sample lands on the leaf or on the sky behind it depends on where the jitter put the sample, so the answer changes on every frame even though nothing moved.

![One pixel under three frames of jitter](/images/2026-11-01-canopy-flicker-and-sky/jitter.svg "A thin leaf and one pixel. The sample position changes with the jitter, so the pixel alternates between leaf and sky while the leaf stays where it is.")

The neighbourhood used to clip the history changes with it, so the clip box moves every frame and drags the history along. A resolve that works well on solid surfaces never settles on a canopy.

### Three fixes in the resolve

1. **The history clip box was too tight.**
   - **Cause:** it was 1.25 standard deviations of the current 3 by 3. When a speck of sky comes and goes between leaves, that box moves every frame and pulls the history with it.
   - **Fix:** the box is 2.0 deviations while the image is still, and narrows to 1.25 as pixels move. Moving is where ghosting shows, so the old box stays there. Wind-blown leaves have motion vectors, so they get the tight box.
2. **The post sharpen overshot on bright specks.**
   - **Cause:** the sharpen ran in linear HDR. A sky pixel between dark leaves is many times brighter than its neighbours, so the cross-shaped sharpen pushed it far over, and the overshoot jumped about with the jitter.
   - **Fix:** it now sharpens exposed, tone-weighted colour, `c / (1 + luma)`, which is the space the TAA already blends in. The strength stays at 0.25, and the edges are as crisp as before.
3. **The woods weighted the current frame at 10%,** so each of the 8 jitter positions showed through. It now weights it at 5% (`taa.currentWeight`) while the image is still. Moving pixels still get 35% (`motionWeight`), so walking does not smear.

Film grain also mattered. In real play, with time running, grain was about half of all the frame-to-frame change, and that is the subtle shimmer I had noticed everywhere. The woods' `post.grainStrength` went from 0.04 to 0.025. The grain is still there and quieter, and it is one setting if I want it back.

Pixels changing by more than 0.03 per frame, for the top, middle and bottom thirds:

| | Before | After |
|---|---|---|
| Time frozen (the renderer alone) | 4.0%, 3.9%, 2.7% | 1.6%, 1.7%, 0.8% |
| Real play (wind and grain) | 8.3%, 6.5%, 6.7% | 3.4%, 2.8%, 3.5% |

![Where a still frame flickers, before](/images/2026-11-01-canopy-flicker-and-sky/flicker-map-before.jpg "Time frozen, before. Red marks pixels that changed by more than 0.03 between frames. The whole canopy glitters.")

![Where a still frame flickers, after](/images/2026-11-01-canopy-flicker-and-sky/flicker-map-after.jpg "The same view after the three fixes. What remains is mostly bright sky specks through the leaves.")

Walking frames before and after show the same detail and no smear. The hallway shares the TAA and post shaders and renders as before. In the 1440p woods bench against the previous run, the TAA pass is unchanged at 0.26 to 0.28 ms and post costs 0.01 ms more. Total GPU time moved +0.6% to +2.2%, all in scene passes that this change does not touch, so I count it as noise. The full `ctest` passed 120 of 120.

## The second round: motion vectors and a sky that clips

After this I still saw it. It is hard to capture in an image, because in a single frame you cannot see it. I also thought the sky was too bright, and in the distance I could see the light and haze flickering.

### A better measure first

The first measure counted every pixel that changed, and a leaf that really sways against the sky changes pixels without flickering. So I made `Measure-Flicker.ps1` count reversals, pixels whose change flips direction by more than 0.03 on two frames running. Looking up into the canopy, 0.61% of pixels did that. Each test below is a 12-frame still-camera capture, and the figures are for the top third.

| Test | Reversals |
|---|---|
| As it was | 0.61% |
| Time frozen (no wind, no grain) | 0.29% |
| Wind off (grain on) | 0.31% |
| Fog off | about the same |
| Local exposure off | about the same |
| Wider clip, no clip, no depth reject, no motion ramp | about the same |
| TAA ignoring motion vectors | 0.23% |

The wind was the cause, and it reached the image through the motion vectors. The flickering leaves had motion of 0.15 to 0.5 px per frame. Ignoring object motion under 0.5 px gave the whole gain, and ignoring it under 0.15 px gave almost none.

The reason is in how TAA picks a motion vector for a pixel. It takes the motion of the nearest surface in the pixel's 3 by 3 neighbourhood, so that edges follow the object in front. A leaf smaller than a pixel therefore lends its motion to the sky pixels round it. As the leaf swayed, the sky's history slid to and fro with it, and the canopy shimmered against the sky. Shadows stayed steady, since the shadow-visibility view barely changed.

### The resolve changes

- **Object motion under half a pixel per frame is dropped.** The camera's own motion is computed exactly, for the pixel's depth, from the same reprojection matrix the background already used, and it is always kept. What an object adds on top of it counts only from 0.4 to 0.6 px per frame, with a smooth ramp. A slow pan stays exact. A 2 degree per second pan shows no smear, with the mean edge gradient going from 10.97 to 10.65, which is 3% softer.
- **Anti-flicker weighting.** While the image is still, where the 3 by 3's contrast is high for its brightness (leaf against sky), the current frame gets down to 40% of its weight.
- **The history read is clamped** to the four texels it lies between, because Catmull-Rom filtering overshoots at hard edges.

Measured on their own, the last two gave little: 0.61% went to 0.48%, and the clamp added nothing more. Dropping the sub-pixel object motion gave the rest. They are cheap and stay.

### The sky

The sky was drawn at 2.5 times its light (`sky.drawnIntensity`), and it was still blown white. About 5% of the frame clipped when looking up. Cutting the drawn intensity to 0.6 hardly helped, since the brightest 10% of pixels only went from 229 to 224. Turning off fog made no difference either.

> **Background: why the sky clips under a canopy.** Exposure is chosen for the scene's average. Under a canopy the average is low, so the exposure is high, and a patch of open sky that is far brighter than the shade lands past the shoulder of the tone curve. The tone curve compresses highlights smoothly, but there is a limit to how much range it can hold, and anything beyond it clips to white. Lowering the sky's intensity moves it only slightly in log terms. The tool that fits is local exposure. It estimates a local base luminance for each pixel in log space and moves the pixel toward the frame's key by a factor that depends on whether it is above or below the key. In log terms, the pixel's offset from the key is multiplied by the highlight setting if it is above, and by the shadow setting if it is below. A highlight setting of 0.6 compresses the bright regions toward the key without dimming the leaves or the path.

I set the woods' local highlights to 0.6, and I drew the sky at 0.6 too, because a dimmer sky also narrows the leaf and sky gap that flickers.

![Looking up into the canopy, before](/images/2026-11-01-canopy-flicker-and-sky/sky-before.jpg "Before: the sky and the sun through the leaves are blown to white.")

![Looking up into the canopy, after](/images/2026-11-01-canopy-flicker-and-sky/sky-after.jpg "After: the sky is a cream colour and nothing is clipped.")

| Looking up | Before | After |
|---|---|---|
| Pixels clipped (245 and over) | 4.8% | 0.0% |
| Brightest 10% of pixels (p90) | 229 | 199 |

| Reversals (top, middle, bottom) | Before | After |
|---|---|---|
| Looking up into the canopy | 0.61%, 0.53%, 0.39% | 0.18%, 0.17%, 0.15% |
| The clearing's distance (light and haze) | 0.42%, 0.58%, 0.45% | 0.20%, 0.31%, 0.22% |
| Long stretch, looking slightly up | 0.53%, 0.48%, 0.34% | 0.18%, 0.27%, 0.15% |

That is lower than the renderer alone, with time frozen, managed that morning. Mean luma in the game moved as well. The reference 4 pose went from 0.209 to 0.205, against the reference's 0.176, and the long stretch went from 0.148 to 0.155. Compressing highlights makes the sun patches a little less punchy.

I checked the result with the full `ctest`, which passed 120 of 120, and the hallway rendered as before. The 1440p woods bench stayed within 0.6% of total GPU time per pose, with TAA +0.04 ms and post +0.02 ms. A first run read +3% to +8%, because a browser was busy on the GPU, and the second run was clean.

## Wind you cannot see does not move

I still saw it a bit in some leaves, though not as much as before, and I asked for further tuning of the wind movement that would not damage the quality.

> **Background: sub-pixel motion is invisible and still costs stability.** Vertex animation moves a leaf by some distance in metres. What the eye sees is that distance divided by the size of a pixel at the leaf's depth. A flutter of 1.5 cm on a leaf close to the camera is many pixels. The same flutter on a crown 60 m away is a fraction of a pixel. Nobody can see it as movement, but it still changes which pixels the leaf's edge covers from frame to frame, and with TAA that becomes flicker. This is the same idea as level of detail for geometry, applied to animation. Animation that cannot be resolved at the current distance carries no visual information, so it can be removed at no visual cost.

Measured with reversals, the canopy view was down to about 0.2% of pixels. With time frozen the figure was the same, so the wind itself no longer added much near the camera. What remained was far away and at hard edges between leaf and sky. Turning things off one at a time, frozen, in the canopy view gave the following.

- Ambient occlusion off: 0.19% to 0.15%.
- Bounce light off: no change.
- Contact shadows off: no change.
- Fog off: worse.
- Post sharpen off: 0.19% to 0.15%.

### Wind detail by pixel size

I added `WindDetail` to `Wind.hlsli`. For each of the three motions (sway, branch flutter and leaf flutter) the vertex shader takes the widest swing the motion can make at full gust and divides it by the size of a pixel at that vertex's depth.

```hlsl
float WindDetail(float amplitude, float metresPerPixel)
{
    return smoothstep(1.0, 3.0, amplitude / metresPerPixel);
}
```

Under 1 px of swing, the motion is not shown at all. From 3 px it is shown in full, with a smooth ramp between. Near the player every leaf moves as before, and distant crowns move only as much as can be seen. This frame and the last frame use the same scale, so the motion vectors stay true. The C++ mirror, `Wind::Detail`, is tested.

### An adaptive sharpen

The other half was the post sharpen. It now backs off where its cross of neighbours already spans a wide range, as AMD's contrast adaptive sharpening does. Texture stays sharp, with mean gradient going from 10.73 to 10.34, against 9.81 with no sharpen at all. Leaf edges against the sky are no longer amplified. The TAA anti-flicker weight now goes down to a quarter of the current frame's weight on high-contrast still neighbourhoods, where it was 40%, which is a small gain. Ambient occlusion and bounce light stay, because they cost a little flicker but carry the look.

Reversals in frozen-time captures of 24 frames at 1280 by 720, for the top, middle and bottom thirds:

| Pose | Before | After |
|---|---|---|
| Looking up at the canopy | 0.19%, 0.17%, 0.13% | 0.19%, 0.16%, 0.12% |
| Long view down the path | 0.18%, 0.26%, 0.10% | 0.16%, 0.23%, 0.07% |
| Clearing, far | bottom 0.22% | 0.12%, 0.25%, 0.11% |

![The long view's flicker map, before](/images/2026-11-01-canopy-flicker-and-sky/wind-detail-before.jpg "The long view down the path, before. Red marks pixels that reversed.")

![The long view's flicker map, after](/images/2026-11-01-canopy-flicker-and-sky/wind-detail-after.jpg "After: fewer red pixels in the far canopy, and the leaf edges against the sky are quieter.")

`ctest` passed 120 of 120. At 1440p against the previous bench, GPU frame time moved between 0% and +0.6%, which is noise, and post cost +0.005 ms. The images differ by 1 to 2 levels on average, and the hallway is unchanged to the eye. The frame-spike walk showed only the known hitch at frames 233 and 234, which was there before these changes.

## Results and open issues

Looking up into the canopy, reversals went from 0.61% to under 0.2%, clipped sky went from 4.8% to none, and the frame-to-frame change in real play roughly halved. Total GPU cost moved by 2.2% at most, which I count as noise.

- The hitch of about 16 ms at frames 233 and 234 of the woods walk is still open. It looks like a shadow redraw.
- What flicker remains is mostly ambient occlusion noise and leaf edges. The next step would be a temporal filter for the ambient occlusion.
- Sky specks seen through the canopy could improve further with a coverage-aware leaf alpha.
- Only the woods use the lower TAA weight. The other scenes keep 0.1.
- I have not checked whether the brighter scenes, the kitchen and the house, want the same sky and highlight treatment.
- The bench's GPU-busy check could fail a run outright when another program is using the GPU, instead of leaving me to notice.
