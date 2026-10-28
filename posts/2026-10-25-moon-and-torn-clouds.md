---
title: A real moon, and clouds the wind has torn
date: 2026-10-25
order: 2
summary: I build a proper moon, fix clouds that looked wrong next to a reference, remove their black spots, and add wind-torn edges and a fast low layer of scud.
tags: weather, renderer, outdoors
cover: /images/2026-10-25-moon-and-torn-clouds/veiled-and-clear.jpg
---

The volumetric clouds were in, and they were a big step up from a flat painted layer. But "better than before" is not the same as "looks like a storm". Over the rest of the day I kept comparing the sky to a night reference from a horror game: big ragged dark clouds, edged in silver by a moon you can't quite see, over a teal sky. I describe it in words here because it's someone else's picture, but I had it open next to my own render for every change, and mine kept losing.

## The moon

My moon was a small plain circle, and it still showed through thick cloud. A real moon never does that.

There were two causes. The first was how the cloud march ends. It stops once a ray is 99% blocked, but the leftover 1% still let the disc through, and the disc was so bright that 1% read as a pale circle. Now, a ray that stops there counts as fully blocked. The second was that the disc was drawn inside the cloud pass at half resolution: a few blurry pixels, 0.6 degrees across.

The new moon is drawn by the sky pass at full resolution, behind the clouds. That ordering is the trick: only the light the clouds let through gets to your eye. Thin cloud veils the moon, thick cloud hides it, and gaps reveal it as they drift past. I shaded the face as a sphere, with dark joined "seas" on the upper left like the real near side, finer mottling for the highlands, a slightly darker rim and a crisp antialiased edge. It is 1.8 degrees across, about 3.5 times the real moon. Films and games do that too, because at the true size the seas are invisible.

Getting it to read took a few tries. At a quarter of the moon's light, the disc washed out against its own glow. A tighter glow, bright close to the disc and soft further away, and a brighter disc fixed it. Placing it was its own puzzle. From the gate, it vanished behind the canopy at 30 degrees up, and sat behind the chimney at 21 and 24. At 25 degrees up and a bit left of straight ahead, it sits in the gap just above the roof.

![The gate at night before and after the new moon](/images/2026-10-25-moon-and-torn-clouds/moon-before-after.jpg "Before (left): a faint dot in a glow. After (right): the moon above the chimney, veiled by thin cloud.")

![The moon, veiled by cloud on the left and in a clear patch on the right](/images/2026-10-25-moon-and-torn-clouds/veiled-and-clear.jpg "Close up at the gate. Left: thin cloud softens the disc. Right: in a clear patch (a preview with less cloud) you can see the seas and the glow.")

I wrote a test for it: look straight at the moon in a near-empty sky and the disc stands 33 levels above its surround. Put a thick cloud deck in front of it, and the difference is -0.6, so nothing shows.

## Making the clouds match

Side by side with the reference, mine were the reverse of it. In the reference, dark ragged storm clouds sit in front of a lighter, moonlit overcast. Mine were bright soft blobs in front of a dark sky. Four causes:

- **Inverted.** The moon lit the cloud bodies as brightly as its own glow, so the clouds were the brightest thing in the sky. I gave the moon's share of the bodies' light its own small constant. Behind the clouds I added a thin, high, faint veil of overcast, mottled by broad noise and warm round the moon, so the dark bodies stand out against it.
- **Blurry.** The density was so low that each ray averaged the fine noise over hundreds of metres, washing the detail out. I raised density and shrank the noise scale.
- **Flat slabs.** Denser clouds turned into flat cut-outs with straight edges. Two fixes: an ambient shadow, where the cloud above a point dims the sky light it gets, and edges that ramp from thin to solid with a second finer noise to fray them.
- **One giant clearing.** The weather noise swung the coverage too far, so I narrowed its range.

I also made a mistake that cost time: I tuned from views above the canopy, where the clouds looked fine. From the ground, the same clouds looked flat and washed out. All tuning moved to ground views, which is what the player sees.

## No more black spots

Then I looked up through the trees and saw a black cloud like a spot, flat, with a crisp outline against the soft grey. I had been happy with the rest, so this one stood out.

![The gate with a hard-edged dark cloud sitting under the moon](/images/2026-10-25-moon-and-torn-clouds/dark-blob-gate.jpg "The problem: a flat, dark cloud with a cut-out outline sitting in front of softer cloud.")

> **Concept: A hard threshold in a soft process.** A ray-march that stops early is a performance trick, but the point where it stops must not change what you see. If a pixel just short of the cutoff shows a third of the moon's glow and its neighbour past the cutoff shows none, you get a crisp outline round every dense cloud. Anything that is switched off at a threshold must first be faded to zero before it.

That was exactly the bug. When I made the moon hide behind thick cloud, I set the light that gets through to exactly zero at the cutoff. But the moon's glow came through as the fourth root of that value, so just short of the cutoff it was still about a third. That jump drew the outline. The fix was to rescale what gets through so that it falls smoothly to zero at the cutoff, and to let the glow come through as a square root, which fades smoothly too. Thick cloud still hides the moon completely.

Two other things made clouds look like black pills. The undersides were flat: every opaque underside got the same light, because the shading sampled the cloud above at one fixed height. Now the light at each point is shaded by the cloud between it and the top, so thin cloud stays bright and thick cores darken gradually. And the bodies were a touch too black, so I lit them a little more and let their fringes thin over a wider range.

Some ideas didn't work. Brightening the bodies to the veil's level made a flat overcast. Thinning clouds wherever the weather noise was low thinned nearly the whole sky and left dark pills. Bigger cloud cells made the ground views look at a clearing.

![Overhead, toward the moon, and high by the moon, before and after](/images/2026-10-25-moon-and-torn-clouds/spots-before-after.jpg "Left: before. Right: after. The cut-out outlines and the small floating specks are gone.")

## Torn clouds and scud

Now the clouds were dark and soft, and I liked them, but they still did not look like real clouds. Looking hard, I saw why. Everything had soft edges, like fog. The shapes were rounded cells that turned into a polka-dot field near the horizon. And the whole sky was one layer moving at one speed. Real storm clouds are torn by wind, drawn out into streets and sheets, with ragged scud racing underneath.

Three changes:

- **Curl noise for torn edges.** Before the fine detail noise erodes the cloud, I push it along a *curl noise*. That is a swirling flow field with no sources or sinks, so it moves the noise around without bunching it up. Edges tear and curl instead of billowing into round lumps. This is a technique from *Horizon Zero Dawn* too. The undersides tear the most.
- **Wind-drawn shapes.** I stretch the cloud's own space along the wind and shear it downwind with height, so the tops sit 600 m ahead of the undersides. Round cells turn into rows and sheets, and the polka dots near the horizon become stratocumulus rows.
- **Scud.** A second thin layer of ragged scraps sits under the main deck, with smaller, more drawn-out shapes that race by 1.7 times faster. Two layers at different speeds give the sky real depth. It is a 12-step march, only its thin fringes catch the moon, and it is a scene setting, so other scenes are unchanged.

Tuning mattered. At full strength the sky turned into brush strokes, so I backed it off until it still looked like clouds. The scud first came out invisible, because I multiplied its density by its coverage and the soft-edge ramp squared that down to nothing. At full opacity it formed dark lenses overhead, so it is now translucent and lit nearly like the deck.

![Toward the moon, overhead, and high by the moon, before and after the torn clouds](/images/2026-10-25-moon-and-torn-clouds/torn-before-after.jpg "Left: before. Right: after. The clouds stretch into streets with ragged undersides instead of round lumps.")

It costs almost nothing: the curl and stretch are free within noise, and the scud adds 0.01 to 0.08 ms.

## What was left

The sky was now much closer to the reference: it matched its average brightness and colour, though mine still has wider contrast (darker clouds and a bright patch round the moon). The flash doesn't light the scud yet. The scud moves fast against the history blend, so stills look clean but I want to check it in motion. And the question I keep coming back to: should the whole night be brighter, and moonlit on the ground? That is my call, and I haven't made it. Next came the thing the sky was for: lightning.
