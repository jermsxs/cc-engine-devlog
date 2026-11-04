---
title: Raising the sun so dappled light reaches the woods path
date: 2026-11-03
order: 1
summary: The woods path got no direct sun, so I raised the sun from 18 to 66 degrees, retuned exposure, and corrected a local exposure setting that lifted the shade instead of deepening it.
tags: lighting, outdoors, post-processing
cover: /images/2026-11-03-sun-dapple/fallen-tree-after.jpg
---

After the ground and puddle work on the woods, I went through the list of what still separates my woods from the two reference frames I compare against. I took sun dapple next. In the references, patches of warm sunlight lie on the path between areas of shade. In my woods the path was lit evenly, and the ground read 0.03 to 0.05 too bright in luma. This entry covers why there was no dapple, how I found the sun angle that produces it, and a mistake I made with local exposure while retuning the image.

## What was wrong: no direct sun on the path

The sun stood 18 degrees above the horizon. The sun-visibility debug view (debug view 9) shows, per pixel, how much of the sun's light reaches that surface. In that view, the sun appeared only on distant trunks near the horizon, at every one of my 12 benchmark poses. The light on the ground was entirely flat ambient light from the light probes.

![Sun visibility before, with sun only on far trunks](/images/2026-11-03-sun-dapple/sun-visibility-before.jpg "Sun visibility before. Dark blue is shadowed, bright is sunlit. Only far trunks near the horizon receive direct sun.")

Looking at the canopy from above explained it. A 12 by 12 m box around the reference 4 pose holds only four trees, but their crowns are wide, and the canopy over the path is nearly closed.

> **Background: how dappled light forms.** Direct sunlight is a nearly parallel beam. A leaf blocks it, and the region behind the leaf is in shadow. A canopy contains thousands of leaves at different heights, so most paths through it are blocked. The light that reaches the ground has passed through a gap that stays open along the whole slanted line from the ground up to the sky. Each such line is a small tunnel, and the patch of sun it throws is the tunnel's cross-section, which is why dapples are irregular and often shaped like the gaps between leaves.
>
> Two things set how many tunnels are open. The first is the canopy's coverage, the share of the sky a leaf layer hides. The second is the sun's elevation. A beam descending at elevation e travels through a layer of thickness t over a slanted length of about t divided by sin(e). For a layer 10 m thick, that is about 32 m of slant at 18 degrees and about 11 m at 66 degrees. The longer the slant, the more leaves it meets, and the chance that all of them leave a gap shrinks quickly. A low sun is blocked by a bush wall at the edge of the path before it ever reaches it. A high sun has a short way through the foliage and finds gaps.
>
> The same sun elevation also moves the dapples. A change in azimuth, the compass direction of the sun, changes which trees cast shadows onto the path and which gaps line up.

## Shadow maps through leaves

In my renderer the sun's shadow comes from cascaded shadow maps, the technique described in earlier entries: the scene is rendered from the sun's point of view into depth textures, and when a pixel is shaded, its position is transformed into that view and compared with the stored depth. If something nearer to the sun is stored there, the pixel is in shadow.

Leaves are cut out to their outline, so the shadow map has holes where there is no leaf, and sunlight passes through those holes. That is what produces dapple without any special code. The shape of a patch comes from the leaves that cut the beam, and its edge is softened by the shadow filter. No dapple texture is painted. If the sun is too low, the holes never line up through the whole canopy depth, and the map holds shadow almost everywhere.

## Finding an angle that works

I did not pick the angle by eye. I swept the sun's elevation and azimuth, and for each candidate I ran the benchmark with the sun-visibility view at all 12 poses.

- At 46 degrees nothing reached the ground.
- At 57 degrees one spot did.
- At 66 degrees, with the azimuth turned, sun patches broken up by the crowns lay along most of the path. They showed at the first bend, the long stretch, the third bend, the last stretch, the path start, the clearing and the fallen tree.

![Sun visibility after, at the reference 4 pose](/images/2026-11-03-sun-dapple/sun-visibility-after.jpg "Sun visibility after. Irregular patches of sun cross the path, with their edges following the crowns above.")

I made these changes in the editor, over the MCP tools, in the woods scene.

- **Sun direction:** elevation from 18 to 66 degrees (rotation x from 0.314 to 1.15 rad), and the azimuth turned by 34 degrees (rotation y from −2.79 to −2.2 rad).
- **Sun intensity:** 0.4 to 0.5.
- **Sun colour:** (1, 0.84, 0.62) to (1, 0.94, 0.84), slightly less orange.
- **Sun fog scatter:** 0.6 to 0.45. A stronger, higher sun lights the haze more. At 0.45 the haze stays as it was. My first try with the sun at 0.8 laid a grey veil over the image.
- **No rebake.** The sun is not part of the light bake (`bakeIntensity` is 0), so the probes are unchanged and the shadow pass stays cached.

## Auto-exposure and local exposure

Raising the sun changed the brightness balance of the whole frame, so I retuned exposure. Two mechanisms are involved, and both are easy to confuse.

> **Background: global and local exposure.** A camera sensor, or a display, covers a limited range of brightness, while a scene covers far more. Exposure picks the window. In my renderer the scene is rendered in linear HDR, then a global exposure multiplies every pixel by the same number before the tone curve compresses the result into the display's range. Auto-exposure chooses that number from the average brightness of the frame, so a dark scene is brightened and a bright one is dimmed. An exposure compensation value in stops (EV) shifts the result up or down after that. `compensationEv` 0.2 means a fifth of a stop brighter than the average-based choice.
>
> A global number cannot treat a sunlit patch and a shaded patch differently, and in a woods they differ by a factor of several. Local exposure fixes that. It estimates a local brightness for each pixel, in log space, and then scales each pixel's distance from the frame's key (its target mid brightness) by a factor. In my settings there are two factors. `localHighlights` applies to pixels brighter than the key, and `localShadows` applies to pixels darker than the key. A factor of 1 leaves the pixel where it is. A factor below 1 pulls the pixel toward the key. A highlight factor of 0.6 compresses bright regions toward the key. A shadow factor of 0.6 raises dark regions toward the key.

I set `compensationEv` from 0.2 to −0.15 and `localHighlights` from 0.6 to 0.65. `localShadows` stays at 1.

### A mistake with local exposure

I wanted deeper shade, so my first attempt lowered `localShadows`. I had the meaning backwards. A shadow factor below 1 brings dark pixels closer to the key, which lifts the shade and flattens the contrast I was adding. I then lowered `localHighlights` further, which squashed the sun patches. I saw the effect in the ratio between sunlit and shaded ground at the reference 4 pose: 1.7 with both settings wrong, and 2.8 with `localShadows` restored to 1. The measured ratio at the finished setting is 2.1, against about 2.7 in the reference.

## Results at the reference 4 pose

These figures are luma on a 0 to 1 scale, measured with the editor's preview flashlight off, because it adds light to every comparison.

| | Before | After | Reference |
|---|---|---|---|
| Mean | 0.207 | 0.198 | 0.176 |
| Median | 0.199 | 0.158 | 0.157 |
| Sunlit ground | none | 0.36 | about 0.40 |
| Shaded ground | 0.17 (all of it) | 0.17 | about 0.14 |
| Sun to shade ratio | none | 2.1 | 2.7 |
| Thirds (top, middle, bottom) | 0.21, 0.21, 0.21 | 0.15, 0.16, 0.28 | 0.19, 0.17, 0.16 |

The median now matches. The bottom third is brighter than the reference because about 60% of the near ground at this pose is in a sun patch, against about 30% in the reference. The top is darker than the reference's sunlit canopy and sky gaps. That gap existed before this change, and it comes from the canopy's content, not from exposure.

Across the 12 benchmark poses, the shade became 0.02 to 0.03 darker, which was the "ground too bright" half of the goal.

![Poses 1 to 6, before on the left, after on the right](/images/2026-11-03-sun-dapple/poses-1-before-after.jpg "Mean luma, before and after: clearing 0.209 to 0.184, fallen tree 0.141 to 0.119, first bend 0.202 to 0.197, gate close 0.254 to 0.224, gate far 0.203 to 0.177, into the bank 0.107 to 0.088.")

![Poses 7 to 12, before on the left, after on the right](/images/2026-11-03-sun-dapple/poses-2-before-after.jpg "Mean luma, before and after: last stretch 0.177 to 0.171, long stretch 0.155 to 0.130, path start 0.215 to 0.216, start back 0.204 to 0.170, third bend 0.162 to 0.137, up at the canopy 0.289 to 0.260.")

Looking back along the path toward the start (the reference 5 view) also became darker, from 0.20 to 0.17, against 0.26 in that reference. This widens a gap that was already open. My canopy closes over the start, and the reference opens to pale sky.

## Cost and verification

- I ran the benchmark over the 12 woods poses with the editor closed, as two before and after pairs. The first pair read +1 to +4%, and the second read −2 to +1%. The first run in a batch of benchmarks runs slow, so I count the change as costing nothing measurable. The shadow pass stays cached at 0.01 ms.
- The frame-spike walk gave a mean of 10.48 ms and a worst frame of 13.05 ms, with no spikes.
- `WoodsSceneTests`, `PathToolTests` and `WaterSplashesTests` pass.

## Open issues

- The sunlit ground is a little bright and yellow, and the shade is 0.03 lighter than the reference. A darker, more mottled dirt, with leaf litter in the sun, would address both.
- The canopy top is dark. Reference 4 and 5 show sunlit leaves and sky gaps up high. My start view is now 0.09 under reference 5.
- The night woods are a separate scene. I did not change them.
