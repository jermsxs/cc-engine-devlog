---
title: Finding flashes and popping shadows while walking the woods
date: 2026-11-03
order: 3
summary: I replay a fixed walk and detect single-frame artifacts, then fix sky specks that slipped through TAA and sun cascade redraws that left plants out of the new shadow map.
tags: renderer, post-processing, shadows
cover: /images/2026-11-03-walk-flashes/speck-before-after.jpg
---

While I walked through the woods, a brief light sometimes appeared in a random spot on the floor or on the trees and then disappeared. After I fixed that, a second effect remained. A patch of ground showed sunlight for a moment, and then its shadow appeared. Both were too short to capture in a screenshot. This entry describes the method I used to find them, and then the two causes, which were unrelated: one in temporal anti-aliasing and one in the cascaded shadow map redraw.

## The method: a replay and a detector

An artifact that lasts one frame cannot be examined by playing the game and watching. I needed a run that repeats exactly, and a program that finds the frames where something happened.

- **A replay.** The engine can record a walk with a fixed time step (`--fixed-dt`) and write every frame (`--capture-count`). I recorded 500 frames. Because the step is fixed, the walk replays exactly, so any frame, such as frame 342, can be rendered again later with a different debug view.
- **A detector.** A small script looks for a pixel that is much brighter than anything within 2 px of it, both in the frame before and in the frame after. A pixel that is bright for one frame only, and surrounded by dark neighbours in time, is a blip. Real motion does not satisfy this, because a moving object stays bright on the next frame.
- **Debug views.** For a blip frame, I captured it again in several views, such as base colour and sun visibility. If a speck has the same colour in every view, it is not a lit surface. If it appears only in the lighting views, it is a lighting problem.
- **Switching features off.** To find which system causes a blip, I turned systems off one at a time and counted blips in each run.

## Flashes: sky seen through a one-pixel gap

The worst blips were specks of 1 to 4 pixels that jumped from about 0.1 to 0.9 brightness for a single frame. At frame 342, the speck's colour was (213, 197, 159) in base colour and in sun visibility alike. A lit surface would differ between those views. This colour is the pale sky, seen through a gap of a pixel or two in the far canopy. The gap opens for a frame as the leaves sway, the camera moves and the sub-pixel jitter changes. With `--leaf-full-detail` the speck went away, because more leaves close the gap. The light, the shadows and the compaction had nothing to do with it.

![The speck at frame 342, before and after the fix](/images/2026-11-03-walk-flashes/speck-before-after.jpg "The speck at frame 342. The middle row of the strip shows the earlier build, with a bright pixel at the centre of frame 342. The bottom row shows the fix, with no speck in frames 341 to 343.")

### Why TAA let it through

I described TAA's history blend and its clamp in the entry on canopy flicker, so here is only the part that matters for specks.

> **Background: neighbourhood clamping.** TAA blends the current frame into a history. The history can be wrong, for example after something moves, so it is clamped to the range of colours in the current frame's 3 by 3 neighbourhood around the pixel. History that lies outside that range is moved to the nearest value inside it. This rejects stale colours.
>
> The clamp constrains the history. It does not constrain the current sample. The current sample is blended in with a weight, and whatever the sample contains goes into the result in proportion to that weight. A sample that is far brighter than the history can therefore show in the output. When the camera moves, the weight for the current frame is raised, so that moving detail does not smear. In my woods that moving weight is 0.35.
>
> A bright speck defeats the usual neighbourhood range for a second reason. The range is a min and max over the 3 by 3 pixels, and the speck is one of those pixels. The speck itself sets the maximum, so the range expands to contain it, and nothing is clamped.

Two cases produced the flash.

- **No history.** A gap that has just opened has no history, so TAA shows the raw sample.
- **With history.** The moving weight of 0.35 applied to a sky sample tens of times brighter than the shaded woods is still a white speck.

### The speck clamp

In `Taa.hlsl`, a speck of one or two pixels, brighter (or darker) than all but one of its 8 neighbours, is held to the second brightest (or second darkest) of them.

```hlsl
float3 speck = clamp(center, low2, high2);   // second lowest, second highest of the 8
result = lerp(history, lerp(center, speck, saturate(cameraSpeed * 4.0)), currentWeight);
```

It applies in two ways.

- Always where there is no history.
- In proportion to the camera's movement where there is history, reaching the full effect at a quarter of a pixel per frame.

Using the second brightest neighbour, not the brightest, matters. A line one pixel wide, such as a thin branch or a blade of grass, has a neighbour of similar brightness on each side along its length. It is not brighter than all but one of its 8 neighbours, so it is left alone. An isolated pixel has no similar neighbour, so it is held. With the camera still, `cameraSpeed` is zero, so nothing changes, and a steady gap of sky in the canopy builds up as before.

I tried two other things and dropped them.

- **A leaf thinned away collapses to one point, which the wind spreads into a tiny triangle.** This is plausible in theory. Making those vertices exactly one point changed nothing here.
- **Tone weighting by the frame's exposure.** In a dim scene, the weighting `c / (1 + luma)` barely compresses anything. Scaling it by the exposure, about 10 times in the woods, halved the last strong blips, from 6 to 3. It also made the converged canopy's sky gaps 1.8 levels darker in still frames, and the canopy top is already darker than the references. I dropped it.

### Result

I counted blips of up to 12 pixels over the 500-frame walk at 1280 by 720, leaving out the scripted turn, where the detector cannot tell motion from a blip.

| Jump in brightness | Before | After |
|---|---|---|
| over 0.4 | 750 | 427 |
| over 0.5 | 234 | 38 |
| over 0.6 | 62 | 6 |

The TAA pass costs 0.003 ms more. Woods, night woods, house, kitchen and hallway frames are within noise. In still frames the woods change in at most 0.6% of pixels, at `gate_far` and `path_start`. The top third is within 0.25 levels of before. With the camera still at `gate_far`, canopy flicker over 40 frames is identical before and after, at 0.12, 0.20 and 0.10% of reversals per third. `TaaTests` passes and so does the full `ctest`, 121 of 121.

Specks of three or more pixels, bigger sky gaps that open on alternate frames, still blink, more softly. Reaching them would take a bigger kernel or the exposure weighting, at the cost of the canopy's sky gaps.

## Shadows popping in

After the speck fix, the other effect remained. A patch of light showed for a moment, and its shadow then appeared in random places while walking. I recorded the same walk in the sun-visibility view and counted pixels that are lit for exactly one frame. Turning features off one at a time gave this:

| Run (120 frames, game frames 420 to 540) | One-frame lit pixels |
|---|---|
| As it was | 17,534 |
| `--no-shadow-cache` (every shadow redrawn every frame) | 829 |
| `--no-cascade-spread` | 820 |
| Shadow filter rotation frozen | 17,405 |
| `--freeze-time` (no wind) | 18,893 |

Redrawing every shadow every frame removed the problem, and so did turning off the cascade spread. Freezing wind or the filter rotation did not. The cause was the cascade spread.

### How cascade redraws are spread

I covered the cascade spread in the entry on Track V. In short, the sun's cascaded shadow maps are cached. When the camera moves far enough that a cascade has to be redrawn, redrawing every caster in one frame would cause a spike. The spread draws the new map into a staging map a slice a frame, and swaps it in when it is complete. For a few frames the old map is in use while the new one is built.

> **Background: stale shadow regions.** A cached or incrementally built shadow map is correct only if every caster that belongs in it is drawn into it. If a caster is missed, the map contains no shadow there. The shading code cannot tell the difference between "nothing casts a shadow here" and "something should, but was not drawn". The pixel is lit. The error stays until the map is next rebuilt, and when it is rebuilt with the caster present, the shadow appears. Seen from the camera, that is a patch of light that turns dark by itself, which is the symptom I had.

### The cause

The slices were cut from that frame's list of draw runs, by position in the list. The list is rebuilt every frame. As the player walks, plants switch level of detail and distance band, so runs regroup and shift. A plant that moved into a slice that had already been drawn was never drawn at all. Its canopy was missing from the new map, so the bushes and the ground under it were sunlit until the cascade's next move, about half a second later. Then the shadow appeared.

The frame log showed it. The wrong light began on the frame a spread completed and ended on the next one.

### The fix

On the first frame of a spread, the slice boundaries are fixed as depths along the sun's direction, balanced by cost as before (`CascadeSliceStarts`). Every caster then belongs to the slice of its own depth (`CascadeSliceOfDepth`) for the whole spread, whatever its run looks like on a given frame. Each caster is drawn exactly once. Skinned casters, such as the enemy, go in the last slice and are drawn as they stand when the map is swapped in.

The assignment no longer depends on how the list is arranged on any frame, so a regrouped list cannot move a caster into a slice that is already finished.

![A canopy shadow missing before the fix and in place after, with the sun visibility below](/images/2026-11-03-walk-flashes/shadow-gap-before-after.jpg "Top row: the scene before and after. Bottom row: sun visibility. Before the fix, sun reaches bushes under a canopy whose shadow is missing from the new map. After, those areas are in shadow.")

### Result

I used `--no-shadow-cache` as the reference, with the same camera and every shadow redrawn every frame. Over the full 500-frame walk:

| | Lit but should be shadowed (pixels) | Frames over 500 |
|---|---|---|
| Before | 72,059 | 57 |
| After | 21,236 | 0 |

In the 120-frame window, one-frame lit pixels went from 17,534 to 823, which is the same as redrawing everything (829). The remaining difference is a few near leaves held at the level of detail their cascade was drawn with. That is accepted by design, and it does not flash.

## Verification

- `ShadowLightsTests` has a new check: every depth has one slice, in order, and the first frame's runs land in their slices.
- The full `ctest` run passes, 121 of 121.
- In the woods benchmark, before and after, two runs each, every pose was within 0.02 ms.
- The frame-spike walk at 1440p gave a mean of 9.85 ms (9.77 before), a worst frame of 12.27 ms and no spikes. Shadow GPU time in the spread frames was 0.193 ms (0.194 before). The mean's +0.06 ms is in other passes, which I count as noise.

## Open issues

- The speck finder still counts the same small specks, 6 strong ones over the walk. They are the sky gaps of three or more pixels described above.
- Near leaves keep the level of detail their cascade was drawn with. I left that as it is.
