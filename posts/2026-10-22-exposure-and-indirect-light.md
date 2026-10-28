---
title: Opening up the shade
date: 2026-10-22
order: 1
summary: One exposure for a whole frame fails in a forest, so I added partial eye adaptation, local tone mapping on a bilateral grid, and screen-space bounce light under the canopy.
tags: post-processing, lighting, outdoors
cover: /images/2026-10-22-exposure-and-indirect-light/game-after-walk.jpg
---

The woods were close to the reference in brightness, but they looked wrong in a particular way: the shade was either crushed to black or flat and grey-brown. That day I worked on the first two items of a list I had drawn up for the "look" of the outdoors. Item 1 was exposure, how the engine decides what brightness becomes what on screen. Item 2 was indirect light: the light that bounces from one surface to another.

## Why one exposure fails

A camera, and the eye, has to squeeze a huge range of real-world brightness into what a screen can show. The sky in a forest scene can be a thousand times brighter than the shade under the trees. *Exposure* is the choice of which slice of that range gets mapped to the screen.

> **Concept: Auto-exposure.** The engine builds a *histogram* of how bright every pixel is, works out the frame's average, and sets the exposure so that average lands at a pleasant mid-brightness. Like the iris of an eye, it adapts over time as you move between bright and dark places.

The trouble is that it picks one number for the whole frame. Pick it for the shade and the sky burns to white; pick it for the sky and the shade drops into black. A real photographer would dodge and burn, and the eye itself does a lot of local adaptation.

![Exposure diagram: one window versus local exposure](/images/2026-10-22-exposure-and-indirect-light/exposure.svg "With one exposure, shade falls outside what the screen can show. Local exposure lifts it into range and leaves the sky where it was.")

## What my meter said

I first measured what the auto-exposure actually did in the woods. Every woods pose metered below the woods' floor setting (EV100 of -5.5 to -6.6, against a floor of -3). So the "auto" part did nothing: all seven poses sat on the floor, like a fixed film exposure. The kitchen was the same, the house partly, and only the hallway moved freely.

### Partial adaptation

Real dark places stay a little darker to the eye. So I added two settings: an *anchor* exposure and an *adaptation* amount. The target now moves only part of the way from the anchor toward what the meter reports. At half the way, the gate view fell from 58 to 53 against the reference's 58, so the woods use a fifth (adaptation 0.2, anchor -2.2). The dark woods stay dark, but not stuck.

### Local exposure on a bilateral grid

> **Theory: Local tone mapping.** Instead of one exposure for the frame, give each region its own. Lift the dark regions toward the frame's average, leave the bright ones alone, and keep each pixel's fine detail on top. The catch: you need a *smooth* map of local brightness, and a blur smears across edges, so a bright sky leaks into the dark tree trunk beside it and makes a halo.

The classic answer is a *bilateral grid*. It is a small 3D grid: two axes are position on the screen, and the third is brightness. Each pixel drops its value into the cell for where it is and how bright it is. Blurring that grid smooths a region with similar brightness but not across a bright/dark edge, because the two sides land in different slices.

Mine is 64 by 36 cells with 32 brightness slices. The post-process reads it per pixel and applies two controls: *local shadows* lifts dark regions toward the average, and *local detail* keeps each pixel's contrast.

My first version pivoted on mid grey, and it brightened every woods pose at once, because the woods sit far below mid grey. I changed the pivot to the frame's own metered average. That way the overall level holds and only the shade opens up. The woods use local shadows 0.6 and detail 1.1, with highlights untouched because the reference skies are bright.

| Pose | Mean before to after (reference) | Darkest 5% before to after (reference) |
|---|---|---|
| Gate close | 57.8 to 58.6 (58.2) | 3 to 9 (10) |
| Gate far | 33.6 to 36.9 (66.1) | 2 to 6 (16) |
| Path | 36.8 to 38.3 (36.7) | 4 to 9 (15) |

The far gate view is still half as bright as its reference. The meter shows why: that pose is only 0.46 EV darker than the path's, while the reference is 1.8 times brighter. That gap is light and content (open sky and haze over the house, a sunlit bank), not exposure. Cost: 0.06 to 0.08 ms per pose, and with the new settings at their defaults every interior and woods pose is image-identical to before.

## Light that bounces

Item 2 is outdoor indirect light. Under the canopy, everything is lit by the baked probes and the sky. But light that bounces off a sunlit bush onto its neighbour was missing, so shade looked flat instead of picking up the colour around it.

> **Concept: Indirect light.** Direct light goes from a lamp or the sun straight to a surface. Indirect light has bounced at least once: sun on a green leaf, then onto the dirt below it, which now glows slightly green. It is what makes shade look like it lives in the same world as the sunlit parts.

I already had ambient occlusion: a pass that marches across the depth buffer around each pixel and darkens spots with lots of nearby geometry. I extended it in two ways.

- **Bitmask occlusion.** The old pass said, per direction, "how high is the horizon here?" The new one splits each slice into 32 sectors of equal weight and gives every sample a *thickness*, 0.5 m behind what the depth buffer shows. A thin branch now blocks only its own sectors, not everything behind it. This follows a recent paper on bitmask GTAO.
- **One bounce.** When a sample hides sectors that nothing hid before, those sectors take that sample's colour from last frame (reprojected, after anti-aliasing, at half resolution), weighted by whether its lit side faces the pixel. The result is denoised along with the visibility and added to the ambient light.

It is off wherever it does not belong. The older multi-bounce fudge it replaces is dropped where the real bounce is on. Lightmapped surfaces skip it, since the lightmap already contains bounce. It is off by default, so the hallway, house and kitchen did not change.

The woods use a radius of 2 m (it was 0.55) and ambient occlusion strength 1.0 (it was 1.4; with the bounce in, the old strength darkened every pose by 3 to 4 levels).

![Indirect light only, before and after](/images/2026-10-22-exposure-and-indirect-light/indirect-only-view.jpg "Debug view of the indirect light alone. Left: before the bounce. Right: after.")

The bounce is about 5% of the indirect light on average and up to 20% in the hollows of bushes. The change is in shape more than level: bushes and the bank under the trees gain volume and contact.

Cost on the 4070 at 1440p: the occlusion pass went from 0.18 ms to 0.53 to 0.82 ms, and the GPU frame grew by up to 0.8 ms. The slowest pose is 6.3 ms, about 12.6 ms on a 3060-class card, still under budget. Hoisting the slice's trigonometry out of the loop and using 6 steps instead of 8 saved a little.

![The woods path after a walk](/images/2026-10-22-exposure-and-indirect-light/game-after-walk.jpg "In the game after walking down the path: no smearing or stale bounce.")

## Two things the re-check caught

Before starting item 2, a review plus a play-through of the game and editor found two bugs in the exposure work.

- **Manual mode went stale.** Local exposure pivots on the frame's metered brightness, but in manual exposure mode the histogram was skipped, so the pivot never updated. It now meters whenever local exposure is on.
- **Editor hitches in the woods.** After every edit, the editor checked whether the light bake was stale by hashing every object and file, on the edit frame itself. That check now runs on a worker thread, and file stamps take one system call each. A smoothness check over 1,500 frames shows no hitches on the woods (typical 3.4 ms) or the house.

## What is open

There is a dark smudge on the path in the indirect-only view. It is there without the bounce too, so it comes from the probe bake, probably a probe buried in the ground. Bent normals for the probe lookup are not done. And the bounce can only read what is on screen: a lit bush behind the camera lights nothing.
