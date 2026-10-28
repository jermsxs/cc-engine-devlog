---
title: Foliage that reacts to rain, and replacing leaf cards with leaf geometry
date: 2026-10-27
order: 1
summary: Rain strikes the leaves and makes them glossy, then bushes get real 3D leaves up close, with matching shadows and a dithered cross-fade between detail levels.
tags: foliage, weather, renderer
cover: /images/2026-10-27-wet-leaves-real-leaves/cards-vs-leaves.jpg
---

After the wet ground and the running water, the foliage looked wrong. In the rain the leaves hung still and dry, and as soon as I got close to a bush I could see that each leaf cluster was one flat textured card. This post covers the two changes: leaves that react to rain, and real leaf geometry near the player.

## Leaves that react to the rain

### The approach

Engines do not usually author a separate wet version of foliage. The shaders make the existing foliage respond to the weather, driven by the same state that drives everything else. Four reactions came out of that, all driven by the rain that is falling now, so dry scenes do not change.

**Rain striking leaves.** Wind in my engine is a vertex-shader displacement. Each vertex moves along its normal by a small amount that depends on a sine of time and position, scaled by a leaf weight that I painted into the vertex colour. A drop hitting a leaf is a different motion: an impulse that knocks the leaf down and lets it spring back. I add it in the same shader (`RainHitOffset`). The crown is divided into 20 cm patches. In each half-second slot, a patch is struck with a probability equal to the rain's amount, at a hashed moment. A strike displaces the leaf tips downward by up to 4 cm, and a damped spring brings them back:

```
spring = exp(-age * 10) * sin(age * 30)
offset = -struck * spring * leafWeight * 0.04
```

The motion does not need the wind, it uses the leaf weight already painted for the wind, and the previous frame's position is displaced with last frame's time, so the motion vectors that TAA uses follow it.

**A storm's wind.** The night woods' wind goes from the day's breeze (strength 0.35, gust 0.5) to a strength of 0.8 with gusts of 0.8 and a faster flutter.

**Wet leaves catch the light.** A dry leaf is matte. A wet leaf has a thin water film on its waxy surface, which is smoother and reflects the torch and the lightning. A wet leaf now goes most of the way to my gloss cap (roughness 0.35, where it used to stop at 0.5), so the torch and the flashes pick out wet leaves and grass blades. Within a few metres, beads of water sit on the leaves. A bead is a small domed drop, as smooth as the cap allows, so a light draws a point on the side facing it while the leaf stays matte between beads. My first try placed beads in world space at 1.5 cm, but they were mostly sub-pixel and they would have slid over leaves moving in the wind, so the grid moved to the object, which keeps each bead on its leaf. Beyond a few metres, beads fade out before they shrink below a pixel, so they never sparkle or crawl. A debug colour showed they only cover a pixel or two at 4 to 5 m, so the wet sheen carries the look at a distance and the beads are for close views.

**Drips under the trees.** The shelter map leaves leaf cards out on purpose, so the wet ground is not patterned by leaves, and the rain used to fall straight through the canopy. A second top-down map of the same area now draws the leaves as well (the canopy map). It is cached like the shelter map and only drawn while it rains. Under leaves, 85% of the rain and its splashes are caught, and a few drops fall on as drips, straight down, 8 mm wide and a little slower. Walking from the open into the trees, the rain thins to scattered heavy drips.

![The clearing in a flash before and after the foliage changes](/images/2026-10-27-wet-leaves-real-leaves/wet-foliage-flash.jpg "Left: before. Right: wet leaves catch the flash, and the rain thins under the canopy.")

![Grass in the torch before and after](/images/2026-10-27-wet-leaves-real-leaves/grass-close.jpg "Left: dry grass blades. Right: wet blades with bright highlights where the torch catches the water.")

Cost at 1440p, no TAA, two rounds averaged: +0.04 to +0.17 ms over the bench poses, of which the lit pass accounts for +0.06 to +0.10. Walking, the GPU mean is 9.13 to 9.14 ms against 9.06 to 9.10. The frames are slightly darker because fewer streaks fall under the canopy (the clearing in the torch goes from 12.9 to 12.3 mean luma).

I checked the strikes in fixed-step frames (`--fixed-dt`) with and without them, looking up into a crown. They differ only in patches of leaves, about 1% of pixels per frame by more than 6 of 255. A still image cannot show the motion itself, so I still need to judge it in the game. `FoliageRenderTests` checks a CPU mirror of the strike: none when dry or at a leaf's base, a downpour knocks a leaf by up to its reach, and no frame moves it more than half of that.

## From cards to real leaves

### The problem

A foliage card is a flat quad with a photograph of a twig or a bush spray on it and an alpha channel that cuts out the shape. It is the standard way to draw foliage in real time, because one card, two triangles, stands for dozens of leaves. Its limits show up close:

- It is flat. Each leaf has no depth, so the lighting across the card is one flat surface (a baked normal map can only fake it).
- Its silhouette is fixed. Turn around it and the shape does not change.
- It moves as one piece. A raindrop that hits it can only bounce the whole card, which defeats the leaf strikes above.

The alternative is real geometry: each leaf a small mesh. It costs triangles, vertex work, shadow-pass work and, with alpha-tested edges, overdraw. So it makes sense only near the player, with cards for the distance. That means two levels of detail (LOD), and a switch between them that must not be visible.

### Building the leaves

`Tools/AssetAuthoring/leaf_shapes.py` finds each single leaf in the scanned shrub texture by its alpha channel. Each becomes a template: a stem-to-tip axis plus the leaf's width on both sides of the midrib at four stations. A leaf mesh follows that outline in 12 triangles, folded along the midrib, drooping and slightly twisted, so few transparent texels are drawn. `build_trees.py` grows a spray where each crossed pair of cards stood: a thin stem with side shoots and alternate leaves facing mostly up. A bush spray has 60 leaves and a sapling up to 30, with a cap of 3,300 leaves a mesh so each stays under the 50,000-triangle prop budget. The leaves use the scan's own colour, normal and roughness maps, and they are matte: the scan's roughness times 1.4.

Each leaf carries its own number in the low bits of the red vertex colour, which lets the rain strike each leaf on its own: a leaf is flicked down about its stem and springs back, instead of a 20 cm patch moving as one. Meshes without numbers keep the patches. The cards stay as the second level of detail: bushes switch at 6 m times their scale, and saplings keep 12 m.

### Problems after the first version

The first real leaves worked, but I found three problems.

**1. The leaves were dark.** I compared the torch close-up with a cards-against-leaves view and found the cause in the shadows. Every shadow face cast the bushes with their card level, so the real leaves were shaded by blotches from cards that were not even drawn. Vertex ambient occlusion was not the cause. A shadow caster and the camera must agree on the geometry, or a surface is shadowed by something that is not visible. The faces near the player (sun cascades, torch, lamps) now cast each object with the level the camera draws, so real leaves shadow as themselves. The fixed faces (the far sun face, the rain and level shelter maps, the canopy map) keep the first level and stay cached, so they never re-render as the player walks.

![A bush in the torch with the card shadows and with matching shadows](/images/2026-10-27-wet-leaves-real-leaves/shadow-fix.jpg "Left: leaves shaded by the cards' shadows, which are blotchy and dark. Right: the leaves cast their own shadows.")

The mean luma in the bush region of the torch close-up rose from 50.5 to 65.7.

**2. The change from cards to leaves popped.** A level of detail that switches at one distance shows a visible jump when the player steps back and forth across it. Two standard ways to hide it are alpha blending the two levels, which needs sorted transparency and fills the depth buffer wrongly for alpha-tested foliage, and a dithered cross-fade, also called screen-door transparency. I used the second.

Each pixel has a threshold from a noise pattern, between 0 and 1. The outgoing level draws only the pixels where its fade value is above the threshold. The incoming level draws the pixels where the threshold is above that same value, which are exactly the pixels the outgoing level dropped. Together the two levels cover each pixel once. As the outgoing level's fade falls from 1 to 0, a growing share of pixels changes from one level to the other. TAA then averages the dither pattern over frames, so the pattern is not visible. The shader's entire contribution is a `clip`:

```
clip(fade >= 0.0 ? fade - threshold : threshold + fade);
```

A positive fade is the level dissolving out, and the same value negated is the level dissolving in. The cross-fade runs over the last 20% of the reach before the next level (at least 0.75 m). It costs a second draw only for objects inside that band. Stepping back runs the fade in reverse, so nothing snaps. `DrawBatchingTests` checks that there is no fade well before a switch, that it starts in the band and is nearly complete at the distance, and that it never changes by more than 0.02 per centimetre walked. I also captured a 420-frame walk across a switch frame by frame and saw no pops.

**3. The cards needed rebaking.** The twig card that stands in at distance was still the old image. I rendered a new one in Cycles from two 3D sprays of the same leaves (200 leaves, 9 shoots), with a tangent-space normal map and a roughness map as well as the colour. Cards a few metres off now shade per leaf like the real ones. Brown scanned leaves are picked rarely (weight 0.1), since the first bake had too many.

![The rebaked twig card](/images/2026-10-27-wet-leaves-real-leaves/twig-card.jpg "Two of the rebaked twig card's colour images, rendered from the 3D leaf sprays.")

### Paying for it

The shadows now cost more because the leaves cast. To compensate, a leaf is 8 triangles instead of 12, a bush spray is 48 leaves instead of 60, and bushes switch to cards at 7 m times their scale instead of 10.

![A bush with cards and with real leaves](/images/2026-10-27-wet-leaves-real-leaves/cards-vs-leaves.jpg "Same pose and torch. Left: the cards, a flat white mass. Right: real leaves with individual shading, and a shadow on the ground.")

Cost at 1440p, no TAA, night woods against the previous base, two rounds:

| Pose | Frame (ms) | Change | Opaque pass change | Prepass change |
|---|---|---|---|---|
| path start | 10.22 | +0.84 | +0.45 | +0.38 |
| first bend | 7.93 | +0.72 | +0.35 | +0.38 |
| into the bank | 9.67 | +1.33 | +0.70 | +0.66 |
| clearing | 9.55 | +1.23 | +0.63 | +0.66 |
| up at the canopy | 7.49 | +0.54 | +0.12 | +0.44 |
| gate far | 8.26 | +1.11 | +0.47 | +0.73 |

Walking with a quick turn, the GPU mean is 10.56 ms against 9.05 ms, and the shadow pass is 0.57 ms against 0.23. The worst frame is 18.4 ms against 13.7 ms. I traced the worst frame to a second with a shadow spike of 1.56 ms, and typical seconds' worst is about 12 ms. There were no game hitches over 1,300 frames.

This is over the 1 ms the plan allowed. The densest poses are at +1.2 to +1.3 ms.

Tests: `ctest` passes 116 of 116. The prop-budget check in `EditorDiagnosticsTests` first failed with two saplings at 53,000 and 72,000 triangles, and the leaf budget fixed that. `FoliageRenderTests` gains a check that two numbered leaves side by side are struck apart.

## Open issues

- The cost is above the budget. Candidates: a shorter real-leaf reach for shadows than for the camera, and fewer sapling leaves.
- In the torch the leaves still burn out near white, as the cards did.
- I have not looked at the strikes and the storm wind in the game while walking. Their amount (4 cm, 20 cm patches) is judged from frame differences only.
- The switch from leaves to cards is hidden but still exists. The next post removes it.
