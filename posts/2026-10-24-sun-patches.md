---
title: Sun patches along the path, and shadows that no longer appear late
date: 2026-10-24
order: 2
summary: Why my path had round coins of sun, how a sun along the corridor fixed it, a fixed far shadow face that stops shadows switching on, and olive leaves.
tags: outdoors, lighting, shadows
cover: /images/2026-10-24-sun-patches/patches-after.jpg
---

Item 5 of my list of differences from the reference was sun patches. In the reference the path is crossed by broad, irregular patches of sunlight, cut across by the shadows of limbs. In mine, the ground was spotted with small round coins. I had already worked out that round coins are pinhole images of the sun, and making the gaps in the canopy larger was not enough. This time I measured what the sun was doing.

## Looking at the sun's own view

The engine has a debug view that colours each pixel by how much of the sun it can see, which is the sun's shadow visibility. This is the path at the reference pose before the change.

![Sun visibility at the reference pose before the change](/images/2026-10-24-sun-patches/sun_visibility_before.jpg "Sun visibility before the change. Almost everything is dark. Only leaves in the crowns and a few coins on the ground see the sun.")

Only 0.3% of the ground in that pose saw the sun at all. The sun came across the woods at an azimuth of 115 degrees and 35 degrees up, and its light crossed so many crowns that it reached the ground only through pinholes. The rest of the ground's brightness was sky light. I had tinted the ground brighter to make up for it, which hid the problem and did not solve it.

### Why the angle matters

> **Background: light through a canopy.** Foliage attenuates light in the way any absorbing medium does. If the canopy has leaf density `k` per metre and a ray crosses a thickness `T` of it, the fraction of light that passes is about `exp(-k * T)`. A ray that comes in at elevation `e` above the horizon crosses a vertical thickness `T` over a path of length `T / sin(e)`. At 90 degrees that factor is 1, at 45 degrees it is 1.41, and at 35 degrees it is 1.74. Because the transmitted fraction falls exponentially with path length, the surviving light drops quickly as the sun gets lower. The surviving light also arrives through small, scattered gaps, and each small gap throws a round image of the sun. Broad patches need gaps that line up along the ray, and that happens where there are few plants along it, for instance along a corridor.

I measured the share of the ground in the sun for different sun directions and plant changes, at the reference pose:

- Across the woods it stayed under 1% at elevations from 35 to 50 degrees.
- Removing all the big trees reached only 19%.
- Leaving 25 to 60% of the trees' limbs bare, a trial option in the tree builder that I did not keep, reached only 1 to 8%.
- Down the path's corridor it opened up. An azimuth of 155 degrees at 45 degrees up gave 21% at the reference pose and 12% at the path start, with the trees unchanged.

![A sun across the woods against a sun along the path](/images/2026-10-24-sun-patches/sun-direction.svg "A schematic from above, not to scale. Across the woods, rays meet trunks and crowns. Along the path, they run down the opening in the canopy.")

The woods keep all their plants. The sun now comes from behind the player, a little to the right, through the opening that the path makes in the canopy.

### Re-tuning around it

With real patches the old tuning was wrong in three ways:

- **Sun strength.** At an intensity of 3, the patches were four times as bright as the shade, so the sun came down to 0.4.
- **Ground tints.** The tints I had added to compensate for the missing sun are about halved.
- **Exposure.** It went up to +1.4 EV.

I measured at the reference pose. The ground is the lower 45% of the frame, and a patch is a region brighter than 1.8 times the ground's 35th percentile.

| | Ground | Shade | In sun | Patch / shade | Patches (count, mean size) | Frame mean |
|---|---|---|---|---|---|---|
| Reference | 39.5 | 24.2 | 30.4% | 2.74 | 124, 442 px | 36.6 |
| Before | 41.3 | 24.5 | 36.2% | 2.64 | 139, 435 px | 36.0 |
| After | 42.9 | 24.3 | 35.3% | 2.85 | 149, 397 px | 37.7 |

The "in sun" column looks the same before and after because the metric was being fooled. Before the change it counted ground that was only lit by the sky. The sun's actual visibility went from 0.3% to about 21%.

![The path before the change](/images/2026-10-24-sun-patches/patches-before.jpg "The reference pose before: small round coins and sky-lit ground.")

![The path after the change](/images/2026-10-24-sun-patches/patches-after.jpg "The reference pose after: the sun comes down the corridor, and the patches are broader and cut by the shadows of limbs.")

The other poses moved as well:

- Gate close went from 63.5 to 57.6 against the reference's 58.2. The house front now stands in shade under a bright sky, as in the reference.
- Gate far went from 38.1 to 31.1 against 66.1, which has been a gap for some time.
- Toward the end went from 33.6 to 26.0, and into the bank from 37.7 to 30.4. The sun now falls along the path, not into the banks.

The hallway and house benches are identical. The kitchen differs by at most 1/255. On the woods, GPU time rose by 0.1 to 0.2 ms at most poses, because more sunlit pixels now run the shadow filter. The walk test is unchanged at 7.63 ms against 7.56 ms, with the worst second's p95 at 9.96 ms against 12.87 ms. The quick-turn test is unchanged, with a worst frame of 10.27 ms against 10.25 ms.

## Shadows that appeared on approach

Walking toward the house, I noticed that its shadow seemed to appear from nowhere. It did. The sun's four cascades reach 50 m from the camera, and past them every point counted as fully lit. The house's shadow and the far trees' shadows switched on as each came within 50 m.

### Why shadows pop

Any shadow system covers a finite region, and the boundary of that region is a place where a surface is either shadowed or not. A surface that crosses the boundary changes from one to the other, and the eye sees it as a pop. Several kinds of boundary can do this:

- The edge of the last cascade, which is the case here.
- The seam between two cascades, which is why cascades blend over the outer tenth of their tile.
- A caster that changes its level of detail or reaches its cull distance, because its shadow changes shape or disappears.

There are four common remedies. The range can be extended at a coarser resolution. The shadow strength can be faded to nothing over the last part of the range, which hides the pop but loses the far shadows. Casters can be dissolved instead of cut. Or a separate, coarse shadow map can cover everything that never moves, drawn once and cached. I used the last.

### A fixed face behind the cascades

One more face now sits behind the cascades. It is a 1024 tile over the whole woods, fitted to every caster that never moves and has no cull distance. It does not follow the camera, so it is drawn once and reused from the cache. The last cascade fades into it exactly as cascades fade into each other, over the outer tenth of its tile, so that nothing switches on. Doors, bodies, the enemy and the small plants that come and go with distance stay out of it, or it would have to be redrawn.

It also helps the turning fix from earlier the same day. With something standing behind it, the last cascade can wait its turn during a quick turn like the others.

`ShadowLightsTests` gained a case for it: a last cascade with a far face behind it is held during a turn. The full suite passes at 114 of 114. Renders made while walking toward the house from 20 to 44 m, with the old and new builds, differ only by noise. From the path, the foliage hides almost everything past 50 m. Seen from 45 m up, the crowns past 50 m are shadowed now, where the old build lit everything past the last cascade. Hallway, house and kitchen benches are image-identical, apart from one kitchen pixel that differs by 1. Woods GPU time is unchanged or lower, from 7.07 to 7.07 ms at the reference pose and from 5.82 to 5.46 ms at gate close. In the walk test the GPU time went from 7.63 to 7.68 ms with no hitches. In the quick-turn test the shadow time fell from 0.40 to 0.22 ms, the average frame from 7.28 to 7.12 ms, and the worst frame from 10.27 to 10.13 ms on average, with one at 11.66 ms.

## Olive leaves and haze

The items left from the sun-patch work were about colour.

### Sunlit bushes were too bright and too yellow

Sunlit leaves measured a luma of 153 against the reference's 95, and were yellower, with blue to red at 0.42 against 0.55. I suspected the scanned plants and the light through the leaves, but measuring the bright region showed that the source was my own `bush_a`, `bush_b` and `bush_c`. There are two causes. The leaf atlas is a saturated yellow-green, and a leaf that faces the sun takes the light in full. Every tree and bush is now shifted toward olive, and the bushes are darkened further, because they stand in the sun at eye height. The trees are darkened less, or the already dark canopy would go down with them. Sunlit leaves are now at 125 against 95, so still a little bright.

### The top of the frame was too dark

The top rows measured 26 to 30 against 36. In the reference, the top of the frame is distant trees seen through bright haze.

> **Background: haze.** Air between the camera and an object does two things. It absorbs some of the object's light, with transmittance `T = exp(-s * d)` for a density `s` and a distance `d`. It also scatters light from the sun and the sky toward the camera. The colour that reaches the eye is `C = C0 * T + Lair * (1 - T)`, a blend from the object's own colour toward the colour of the air. Distant things therefore lose contrast and take on the air's tone, which is how a viewer reads depth.

I raised the fog's ambient glow, `ambientStrength`, from 0.15 to 0.6, so that things tens of metres away lift toward the air's colour and the far banks separate in depth. Exposure came down by 0.15 EV to hold the frame's mean, and the final exposure is +1.25 EV.

![Before and after the olive leaves and haze](/images/2026-10-24-sun-patches/olive-before-after.jpg "Cropped from my own renders at the reference pose. Left: yellow sunlit bushes and a dark far end. Right: olive bushes, and haze that separates the far banks.")

| Reference pose | Frame mean | Top rows | Sunlit leaves (luma, blue/red) | In sun | Patch / shade |
|---|---|---|---|---|---|
| Reference | 36.6 | 36, 35, 39 | 95, 0.55 | 30.4% | 2.74 |
| Before | 36.2 | 26, 30, 27 | 153, 0.42 | 35.3% | 2.85 |
| After | 37.5 | 30, 35, 33 | 125, 0.49 | 31.5% | 2.63 |

Gate close is at 62.6 against the reference's 58.1, and gate far is at 35.0 against 66.2.

## What I tried and dropped

- **Thinning the crowns out to 62 m.** The share of sunlit ground went from 14.5% to only 15.6%, so I did not keep it. With the sun ahead, that stretch is shaded by the big trees and bushes at 57 to 70 m that I placed to close the view in dark trunks, as the path reference does. Opening it means undoing that.
- **More local exposure for the gate-far view.** Lowering `localShadows` from 0.6 to 0.4 gave +0.9. That pose looks straight into the sun, its foreground lies in the shade of the bushes ahead, and the bright house and sky set the exposure. In the reference the sun falls on the foreground from the side and there is open sky at the top left. That needs a layout or sun change at the gate, not a tint.

## Open issues

- The gate-far pose is still far from its reference, at 35 against 66. Its foreground needs light, either a sun from the side there or an opening in the yard's border toward the sky at the top left.
- Patches farther than 45 m down the path would need openings there too. I have to decide whether the dark end of the path stays.
- Sunlit leaves are still brighter than the reference's, at 125 against 95.
