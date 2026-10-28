---
title: Sun patches, and shadows that stop popping in
date: 2026-10-24
order: 2
summary: Why my woods had round coins of sun instead of broad patches, how aiming the sun down the path fixed it, a far shadow that stops the house appearing, and olive leaves.
tags: outdoors, lighting, shadows
cover: /images/2026-10-24-sun-patches/after_reference.jpg
---

Later the same day I took on item 5 of my woods look list: sun patches. In my reference, the path is crossed by broad, irregular patches of sunlight, cut by the shadows of limbs. In mine, the ground was spotted with small round coins. Earlier I had already worked out that round coins are pinhole images of the sun, but making the gaps bigger was not enough. This time I wanted to find out what was really going on.

![The path with small round sun coins](/images/2026-10-24-sun-patches/after_reference.jpg "The path at the reference pose just before the sun changed: sun reaches the ground in small round coins, and the rest is sky light.")

## Looking at the sun's own view

The engine has a debug view that colours each pixel by how much of the sun it can see (it is the shadow visibility, one of the function keys). Here it is for the path before this change:

![Sun visibility at the reference pose before the change](/images/2026-10-24-sun-patches/sun_visibility_before.jpg "The sun's visibility: nearly everything is dark. Only the leaves in the crowns and a few coins on the ground see the sun.")

Only 0.3% of the ground in this pose saw the sun at all. The sun came across the woods at 35 degrees up, and its light crossed so many crowns that it reached the ground only through pinholes. Pinholes throw round images of the sun, so: coins. The rest of the ground's brightness was sky light, and I had tinted the ground brighter to make up for it. That was hiding the problem, not fixing it.

> **Theory: Why patch shape follows the angle.** Light reaches the ground through gaps in the canopy. If the sun comes in low across thick woods, the gaps along its line of sight are tiny, so a patch is a tiny round pinhole image. If the sun looks down a corridor with fewer trees along its path, the gaps line up and the patches are wide.

I measured the share of ground that sees the sun for different sun directions and plant changes:

- Across the woods, it stayed under 1% at elevations of 35 to 50 degrees.
- Removing all the big trees only reached 19%.
- Leaving 25 to 60% of the trees' limbs bare (a trial option in the tree builder, which I did not keep) reached only 1 to 8%.
- Down the path's corridor it opened up: azimuth 155 degrees, 45 up gave 21% at the reference pose and 12% at the path start, with the trees unchanged.

So the woods keep their plants, and the sun now comes from behind the player, a little to the right, through the opening the path makes in the canopy.

### Re-tuning around it

With patches now real, the old tuning was wrong in three ways:

- **Sun strength.** At the old strength its patches were four times the shade, so it came down.
- **Ground tint.** The tints I had added to compensate were about halved.
- **Exposure.** It went up to +1.4 EV.

| At the reference pose | Ground | Shade | In sun | Patch / shade | Frame mean |
|---|---|---|---|---|---|
| Reference | 39.5 | 24.2 | 30.4% | 2.74 | 36.6 |
| Before | 41.3 | 24.5 | 36.2% (mostly sky-lit ground) | 2.64 | 36.0 |
| After | 42.9 | 24.3 | 35.3% | 2.85 | 37.7 |

The "in sun" share looks the same before and after, but that is the metric being fooled: before, it counted ground that was only sky-lit. The sun's real visibility went from 0.3% to about 21%.

The gate's close view moved from 63.5 to 57.6 (reference 58.2), and the house front now stands in shade under a bright sky, as in the reference. The gate's far view fell from 38.1 to 31.1 (reference 66.1), a long-standing gap. Cost: up to +0.1 to 0.2 ms at most poses, since more sunlit pixels run the shadow filter. The walk and quick-turn tests did not change.

## The house that appeared out of nowhere

A bug I noticed myself while walking toward the house: its shadow just appeared. It did. The sun's four cascades reach 50 m from the camera, and past them, every point counted as fully lit. So the house's shadow and the far trees' shadows switched on as each came within 50 m.

> **Concept: A far shadow face.** A cascade is only as far-reaching as you can afford, and beyond the last one there is nothing. A common fix is a big, coarse shadow map of everything that never moves, drawn once and cached. Here it is the last layer of the stack, and the fade between cascades is reused so there is no switch.

Now one more face sits behind the cascades: a 1024 tile over the whole woods, fitted to every caster that never moves and has no cull distance. It does not follow the camera, so it is drawn once and then reused from the cache. The last cascade fades into it exactly the way cascades fade into each other, so nothing switches on any more. Doors, bodies, the enemy and the small plants that come and go with distance stay out of it, or it would redraw. As a bonus, the last cascade can now wait its turn during a quick turn like the others, since something stands behind it.

Walking toward the house from 20 to 44 m looks the same with the old and new builds, apart from noise: from the path, the foliage hides almost everything past 50 m. In an overhead view the crowns past 50 m are shadowed now, where the old build lit everything past the last cascade. In the quick-turn test, shadow time fell from 0.40 to 0.22 ms.

## Olive leaves and haze

The remaining items from the sun-patch work were about colour.

**Sunlit bushes too bright and yellow.** Their leaves came out at brightness 153 against reference 95, and yellower (blue/red 0.42 against 0.55). I first suspected the scanned plants and the light through the leaves. Measuring the bright region showed it was my own bush models: the leaf atlas is a saturated yellow-green, and a leaf facing the sun takes the light fully. Now every tree and bush is shifted toward olive, and the bushes are darkened further, since they stand in the sun at eye height. The trees are darkened less, or the already dark canopy would darken with them. Sunlit leaves are down to 125 against 95, so still a bit bright.

**The canopy at the top too dark** (26 to 30 against 36). In the reference the top of the frame is distant trees in bright haze. I raised the fog's ambient glow (0.15 to 0.6), which lifts what stands tens of metres off, so the far banks now separate in depth. Exposure came down 0.15 EV to keep the frame's mean.

| At the reference pose | Frame mean | Top rows | Sunlit leaves | In sun | Patch / shade |
|---|---|---|---|---|---|
| Reference | 36.6 | 36, 35, 39 | 95 | 30.4% | 2.74 |
| Before | 36.2 | 26, 30, 27 | 153 | 35.3% | 2.85 |
| Now | 37.5 | 30, 35, 33 | 125 | 31.5% | 2.63 |

## What I tried and dropped

- **Thinning the crowns out to 62 m.** The share of sunlit ground went from 14.5% to only 15.6%, so not kept. With the sun ahead, that stretch is shaded by big trees and bushes at 57 to 70 m that I placed to close the view in dark trunks, as my path reference does. Opening it would mean undoing that, and it is my call.
- **Lifting the gate-far view with more local exposure** (0.6 to 0.4): +0.9 only. The pose looks straight into the sun, its foreground lies in the shade of the bushes ahead, and the bright house and sky set the exposure. In the reference the sun falls on the foreground from the side and there is open sky at the top left. That needs a layout or sun change at the gate, not a tint.

## Where it stands

The path now has real patches crossed by shadows, reference-matching brightness, and no shadows popping in on approach. The gate's far view is still the honest miss: 35 against 66. Sunlit leaves are still brighter than the reference's, and the path's patches fade out past 45 m. Next up are the open questions about the gate's foreground and whether the dark end of the path stays.
