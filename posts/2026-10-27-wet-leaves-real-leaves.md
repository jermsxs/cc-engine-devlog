---
title: Wet leaves, and leaves that are really leaves
date: 2026-10-27
order: 1
summary: Rain starts to move and gloss the foliage, then bushes get real 3D leaves up close, with shadows that match and a cross-fade instead of a visible pop.
tags: foliage, weather, renderer
cover: /images/2026-10-27-wet-leaves-real-leaves/cards-vs-leaves.jpg
---

The wet world was convincing on the ground, but I noticed something wrong with the leaves. In the rain they sat there like statues. A raindrop hitting a leaf should knock it. And when I looked closely at what the leaves actually were, there was a bigger problem: they were paper thin. A picture of a leaf on a flat card, with nothing behind it. Today I fixed both.

## Making the leaves react

Games don't author separate "wet leaves". The shaders make leaves respond to the weather. I added four reactions, all driven by the rain falling right now, so dry scenes don't change.

**Rain strikes the leaves.** Each 20 cm patch of a crown is struck at a random moment in each half second, with a chance equal to the rain's amount. A strike knocks the patch's leaves down by up to 4 cm at the tips, and they spring back within the half second. It reuses the leaf weight already painted for the wind, and the motion vectors follow it. I also raised the night woods' wind from a day breeze to a storm, with stronger gusts and faster flutter.

**Wet leaves catch the light.** A wet leaf now goes most of the way to my gloss cap, roughness 0.35, so the torch and the flashes pick out wet leaves and blades. Within a few metres, small domed beads of water sit on them, on a grid fixed to the leaf so they ride it in the wind. Further off, the beads fade out before they shrink below a pixel, so they never sparkle or crawl. My first try put the beads in world space at 1.5 cm. They were mostly sub-pixel and would have slid over moving leaves, so I moved the grid onto the object.

**Drips under the trees.** The rain used to fall straight through the canopy, because the shelter map leaves leaf cards out on purpose, so the wet ground isn't patterned by leaves. Now a second top-down map of the same area draws the leaves too: a canopy map. Under leaves, 85% of the rain and its splashes are caught. A few drops fall on as drips: straight down, 8 mm wide, a bit slower. Walking from open ground into the trees, the rain thins to scattered heavy drips.

![The clearing in a flash, before and after the wet foliage](/images/2026-10-27-wet-leaves-real-leaves/wet-foliage-flash.jpg "Left: before. Right: wet leaves catch the flash, and the rain thins under the canopy.")

![Grass in the torch, before and after](/images/2026-10-27-wet-leaves-real-leaves/grass-close.jpg "Close up: wet blades and a sheen where the torch hits them.")

The cost is small: +0.04 to +0.17 ms on the bench poses. The one thing a still image can't prove is the motion. I checked frame differences with and without the strikes. They differ only in patches of leaves, about 1% of pixels per frame.

## Real 3D leaves

> **Concept: Cards versus geometry.** A *card* (or billboard) is a flat quad with a picture of foliage on it, where the picture's empty areas are see-through. It's very cheap and it is how nearly every game draws far foliage. But it is flat. Light, shadow and rain treat it as one flat sheet, so a raindrop bounces the whole card, and the leaves can't shade each other. *Geometry* is a real 3D shape, a leaf as a little folded surface, which a light can hit from any side.

Up close, geometry is better. The bushes and saplings now have real leaves.

- A tool finds each single leaf in the plant texture scan by its transparency and turns it into a template: a stem-to-tip axis, plus the leaf's width on both sides of the midrib at four stations.
- A leaf mesh follows that outline in just 12 triangles, folded along the midrib, drooping and a little twisted. It draws few see-through texels.
- The bush-building script grows a spray where each pair of crossed cards used to stand: a thin stem with side shoots and alternate leaves facing mostly up. Each leaf carries its own number in the vertex colour, so the rain now strikes each leaf on its own: it is flicked down about its stem and springs back, instead of a patch of 20 cm moving as one.
- The leaves keep the scan's own colour, normal and roughness maps, and are matte (the scan's roughness times 1.4).

![A bush as cards on the left and as real leaves on the right](/images/2026-10-27-wet-leaves-real-leaves/cards-vs-leaves.jpg "Same pose and torch. The old card bush (left) is a bright blob. The real leaves (right) have gaps and cast their own shadows on the ground.")

## Three things were wrong

I was not done. The first real leaves had three problems.

### They were dark

Real leaves looked dark and blotchy in the torch. I tried vertex ambient occlusion as the cause. It was not. The real cause was shadows: every shadow face cast the bushes with their *card* level, so the real leaves were shaded by blotches from cards that were not even drawn. Now the shadow faces near the player (sun cascades, torch, lamps) cast each object with the level the camera draws. Real leaves shadow as themselves. The fixed faces, like the far sun face and the rain's shelter maps, keep the first level and stay cached, so they never re-render as the player walks.

![A bush in the torch, with the cards' shadows and then the leaves' own](/images/2026-10-27-wet-leaves-real-leaves/shadow-fix.jpg "Left: dark blotches from card shadows. Right: the leaves shade themselves. The mean brightness of the bush region rose from 50.5 to 65.7.")

### The change popped

> **Concept: LOD popping and cross-fading.** *LOD* (level of detail) means keeping several versions of an object, detailed near and cheap far, and swapping between them by distance. If the swap is instant, you can see it: the bush visibly "pops" as you step toward it. A *cross-fade* draws both versions for a short distance, and fades one out while the other fades in. Fading with real transparency is expensive and messy for foliage, so engines use a *dither*: a screen-door pattern where some pixels show one version and the rest show the other. The outgoing level dissolves on a pattern while the incoming one dissolves in on exactly the opposite pixels. Temporal anti-aliasing then smooths the pattern into a soft blend.

A level no longer switches at one distance. Over the last 20% of the reach before the next level (at least 0.75 m), both are drawn. Stepping back runs it in reverse, so nothing snaps. It costs a second draw only for objects inside a band. I wrote a test that the cross-fade starts in the band, is nearly complete at the distance, and never changes by more than 0.02 per centimetre walked. I also captured a 420-frame walk across a switch, frame by frame, and found no pops.

### The cards were stale

The distant cards still needed rebaking. The twig card is now rendered in Cycles (Blender's path-traced renderer) from two 3D sprays of the same leaves, 200 leaves on 9 shoots, with a tangent-space normal map and a roughness map along with the colour. Cards a few metres off now shade per leaf like the real ones. I also gave brown scanned leaves a low weight, because the first bake had too many of them.

![The rebaked twig card, colour pass](/images/2026-10-27-wet-leaves-real-leaves/twig-card.jpg "The twig card, rendered from two 3D leaf sprays in Blender, so each leaf shades like a real one.")

To pay for the shadows, I also made leaves lighter: 8 triangles a leaf instead of 12, 48 leaves on a bush spray instead of 60, and bushes switch to cards at 7 m times their scale instead of 10.

![Into the bank: a view of the woods with real leaves](/images/2026-10-27-wet-leaves-real-leaves/into-the-bank.jpg "The woods in the torch with real leaves on the bushes and saplings. The trunks and fern are lit from the front by the torch.")

## The bill

This was over budget, and I'll be honest about it. In the densest poses, the frame costs +1.2 to +1.3 ms over the base, and the walk is +1.5 ms (mean GPU 10.56 ms against 9.05 ms). The shadow pass is 0.57 ms against 0.23 ms, the price of real leaves casting shadows. My plan allowed about 1 ms. The worst frame was 18.4 ms against 13.7 ms, in one second with a shadow spike.

Next: cut the cost, check the rain strikes in motion, and decide where to put the large tree mesh files. And one more thing was still bothering me: the cards were still there at a distance, and I could see them swap.
