---
title: The moon behind the clouds, and tearing the cloud shapes
date: 2026-10-25
order: 2
summary: I draw the moon as a disc composited behind the cloud transmittance, fix three cloud problems found against a reference, and add curl-noise tearing, wind shear and a fast low layer of scud.
tags: weather, renderer, outdoors
cover: /images/2026-10-25-moon-and-torn-clouds/veiled-and-clear.jpg
---

The volumetric clouds from the first post worked, but four things in the night sky were wrong. The moon was a small plain circle that still showed through thick cloud. Next to my reference frame the clouds were bright blobs in front of a dark sky, where the reference has dark masses in front of a lighter one. Some clouds had hard black outlines. And the shapes were soft, round and uniform, where wind-driven storm cloud is torn into streets and ragged scraps.

I took these one at a time, and each exposed something about how the pieces of a cloud renderer depend on each other.

## The moon as a disc behind the clouds

### The problem

The moon was drawn inside the cloud pass at half resolution, 0.6° across, so it covered a few blurry pixels. It also showed through thick cloud as a pale circle, which a real moon never does.

### How compositing a bright object behind a volume works

The cloud march returns two things for each pixel: `scattered`, the light the cloud adds toward the eye, and `T`, the transmittance, the fraction of light from behind the cloud that survives the trip through it (the Beer-Lambert product from the previous post). Anything behind the clouds is composited with the standard volume equation:

```
final = behind * T + scattered
```

`behind` is the sky and the moon. Where `T` is 1 there is no cloud and the moon shows fully. Where `T` is 0 the cloud is opaque and the moon is gone. Between those, thin cloud veils it.

The moon makes this equation unforgiving, because its disc is far brighter than the rest of the sky. A residue of transmittance that is invisible for a dim sky is visible for the moon. The ray march stops once `T` falls below 0.01 (the ray is 99% blocked) to save steps. The first version kept that leftover 0.01, and 1% of a very bright disc was still a pale circle. A ray that stops at the cutoff now counts as fully blocked.

### The new moon

The sky pass now draws the disc at full resolution, behind the clouds, and multiplies it by the transmittance. Thin cloud veils the disc, thick cloud hides it, and gaps reveal it as they drift past.

- **Face.** It is shaded as a sphere. Dark, joined "seas" on the upper left follow the real near side, finer mottling stands for the cratered highlands, the rim is slightly darker, and the edge is antialiased.
- **Size.** It is 1.8° across, about 3.5 times the real moon (0.52°), which is how films and games draw it, so that the seas can be read. It sits just above the house's chimney as seen from the gate, at 25° elevation.
- **Glow.** The glow around it is a tight corona close to the disc plus a soft wide halo. Before, the corona outshone the disc and the disc disappeared into it.

Placing it took several tries. At a quarter of the moon's light the disc washed out against its own glow, with disc and surround both near 200 of 255. Lowering the glow and raising the disc to 0.45 gave a disc of 179 to 245 against a surround of 157. At 30° elevation the moon hid behind the tree canopy from every gate pose. 21° and 24° put it behind the chimney. 25° elevation and 17° left of straight ahead put it in the gap above the roof.

![The gate before and after the new moon](/images/2026-10-25-moon-and-torn-clouds/moon-before-after.jpg "Left: a faint dot in the glow. Right: the moon above the chimney, veiled by thin cloud.")

![The moon veiled by thin cloud and in a clear patch](/images/2026-10-25-moon-and-torn-clouds/veiled-and-clear.jpg "Left: veiled by thin cloud. Right: in a clear patch, with its seas and glow (a preview with less cloud).")

A new test in `SkyRenderTests` looks straight at the moon. In a nearly empty sky the disc stands 33 levels above its surround. Under a thick deck the difference is -0.6, so nothing shows.

![The two captures from the moon test](/images/2026-10-25-moon-and-torn-clouds/test-clear-covered.jpg "The test's captures: the clear sky shows the disc (left), a thick deck hides it (right).")

The cost is within noise. At the gate close the frame went from 5.85 to 5.97 ms, at the gate far from 6.98 to 6.60 ms, and the cloud pass stayed at 0.22 to 0.45 ms. The day woods are pixel-identical, because the disc is only drawn with clouds.

## Matching the reference: tone, detail and the veil

### What I saw

Side by side with the night reference frame, my sky was the reverse of it. In the reference the storm clouds are dark, ragged masses in front of a lighter, moonlit overcast. Mine were bright, soft blobs in front of a dark sky. Four causes:

- **The brightness was inverted.** The moon lit the cloud bodies as brightly as it lit its own glow, so the clouds were the brightest thing in the sky.
- **The detail was washed out.** The density was so low that each ray averaged the fine noise over hundreds of metres.
- **Denser clouds became flat cut-outs** with straight edges.
- **One giant clearing.** The weather noise swung coverage too far.

### How this works in a cloud model

A cloud body at night receives light from a few sources: the moon, scattered through the cloud, and the diffuse sky glow above. Behind and between the dense masses there is a thin, high cloud, an overcast veil, lit by the moon. The dense masses read as dark because they sit in front of that bright veil and let almost no light through, and because their own lit side faces the moon, which is behind them. If the moon's light on the bodies is too strong, the contrast reverses.

The detail problem is a sampling one. A ray marches through a noise field and the result for the pixel is the average of the samples. When the density is too low, the sum of many low samples converges towards a smooth average and the structure is lost. Raising the density makes each sample count, and reducing the noise scale puts more of the noise features inside each step.

### What I changed

- **Moon share.** The moon's share of the bodies' light is now its own constant, `CloudMoonLight`, at 0.13. The rest stays in the disc, the corona and the veil.
- **Veil.** Behind the clouds there is now a high, faint overcast lit by the sky light, mottled by broad noise, and warm round the moon. The dark bodies stand against it.
- **Density and scale.** Density up from 0.06 to 0.08, noise scale down from 9000 m to 5500 m.
- **Ambient shadow.** The cloud above a point now dims the sky light that the point receives. This is an approximation of the light that does not reach the lower parts of a thick cloud. It samples once, at half the distance to the top of the layer. A two-sample version cost 0.65 ms and looked the same.
- **Edge ramp.** Below a density of `EdgeRamp` (0.4) the fringes thin quadratically, so edges go from see-through to solid, and a second finer detail octave frays them.
- **Weather range.** The coverage multiplier's range is 0.8 to 1.15 (it was 0.55 to 1.35).

### Dead ends

- I first tuned from views above the canopy. Toward the moon the clouds looked fine there, while from the ground the same clouds looked flat and washed out. All tuning moved to the ground views.
- The fine octave in the veil drew radial streaks on the flat layer, and the shape noise's red channel banded. The veil uses only the broad green channel.
- A plain power curve on the edges thinned every cloud, not just the fringes.

Sky above the trees from the gate (luma):

| | Mean | 5th percentile | 95th percentile | Standard deviation | Mean RGB |
|---|---|---|---|---|---|
| Reference frame | 115 | 76 | 175 | 31 | 92, 120, 128 |
| Before | 125 | 51 | 234 | 58 | 106, 130, 133 |
| After | 113 | 47 | 239 | 58 | 101, 116, 117 |

The mean and colour moved closer to the reference. My contrast is still wider (standard deviation 58 against 31): darker clouds and a brighter patch round the moon.

## Removing the black spots

### The problem

Looking up through the canopy, I saw a black cloud floating in the sky like a spot: flat, with a crisp outline against soft grey cloud.

![Looking up with a hard-edged dark cloud](/images/2026-10-25-moon-and-torn-clouds/high-view.jpg "From 80 m looking up before the fix: the dark cloud left of centre has a crisp outline, and a small dark speck floats above it.")

### Causes

The main cause was a hard outline, and it came from the moon fix above. The march stops at `T = 0.01`, and the fix set the transmittance to exactly 0 there. But the moon's glow behind the clouds was multiplied by the fourth root of `T`. At the cutoff, `0.01^(1/4)` is about 0.32, so a pixel just before the cutoff showed a third of the glow, and its neighbour, just past the cutoff, showed none. That jump drew a crisp outline round every dense cloud and made them look like cut-outs.

The fix has two parts. `T` is rescaled so it reaches 0 continuously at the cutoff:

```
T = saturate((T - 0.01) / (1 - 0.01))
```

and the glow now comes through as the square root of `T` instead of the fourth root. The square root is the right shape for light that is scattered forward many times in a thin cloud: it spreads the glow into a soft patch rather than hiding it. Thick cloud still hides the moon completely.

Two lesser causes:

- **Flat undersides.** Seen from below, every opaque underside got the same light, because the shading sampled the cloud above at a fixed height. A cloud from underneath was a uniform dark disc. Now the sky light at each point is attenuated by the optical depth between that point and the top of the layer, so thin cloud stays bright and thick cores darken gradually.
- **Too black.** The sky light on the bodies is raised by a factor of 1.15, the undersides receive 60% of the tops' light instead of 50%, and the fringes thin over a wider range (`EdgeRamp` 0.25 to 0.4).

Dead ends: brightening the bodies to the veil's level washed the sky into a flat overcast. Thinning the clouds wherever the weather noise is low thinned almost the whole sky, and the remaining clouds were still dark. Bigger cloud cells (8000 m) left the ground views looking at a clearing.

![Overhead, toward the moon, and high by the moon, before and after](/images/2026-10-25-moon-and-torn-clouds/spots-before-after.jpg "Before (left) and after (right). The cut-out outlines and the small floating specks are gone.")

From 80 m looking up, the darkest 5% of the sky rise by 8 to 15 levels (for example 34 to 42 and 47 to 62), and the middle stays about the same. The cloud pass stays within 0.03 ms at every pose.

## Tearing the shapes: curl noise, wind shear and scud

### The problem

I looked at the clouds again and found three things that identified them as computed:

- the edges were soft everywhere, like fog;
- the shapes were rounded cells, which near the horizon turned into a polka-dot field;
- everything was one layer moving at one speed.

### How the three fixes work

**Curl noise.** Real cloud edges are eroded by turbulence. Adding fine noise erodes density but leaves the lumps round. To make edges tear and curl, the lookup position of the fine noise is displaced before sampling, using a vector field. The field must not bunch the noise up in some places and leave gaps in others, which means it must be divergence-free, a flow with no sources or sinks. The curl of any vector field is divergence-free, so the standard way to generate one is to take three noise functions as a vector potential `P` and use `curl(P)`. Horizon Zero Dawn's clouds use this. In my implementation the potential is three Perlin noises with two octaves each, the curl is computed by finite differences, and the result is stored in the three spare channels of the detail texture while the erosion noise sits in the fourth. The detail texture grew from 32³ to 64³ (1 MB, generated once), so the fine detail no longer blurs. The displacement is 150 m, and it is weaker at the tops (0.4 of the value at the bases), so the undersides tear most.

**Wind stretch and shear.** Storm clouds are drawn out downwind into streets and sheets, and the tops lean over the bases. I apply this to the coordinates the noise is sampled at. The cloud's own space is scaled by 0.75 along the wind, and sheared with height so the tops sit 600 m downwind of the undersides. Stretched cells line up into rows, so the polka-dot pattern near the horizon becomes stratocumulus rows.

**Scud.** Beneath the main deck, ragged low clouds move quickly. I added a second layer under the deck, at 45% of its height and 350 m deep, with smaller shapes (30% of the deck's scale), more stretched along the wind, drifting 1.7 times as fast, and marched in 12 steps before the deck. Two layers moving at different speeds give a parallax cue: the eye reads the faster one as nearer, which gives the sky depth. It is a scene field, `sky.cloudScud`, and 0 means none, so other scenes are unchanged.

### Tuning

- At full strength (stretch 0.6, curl 250 m) the sky turned into brush strokes. Stretch 0.75 and curl 150 m kept it looking like cloud.
- The scud first came out invisible. Its density was multiplied by its coverage, and the soft-edge ramp squared that down to nothing.
- At full opacity it formed dark lenses overhead, so it is translucent (35% of the deck's density) and lit nearly like the deck.
- Whole scraps glowed white near the moon, because their moonlight was not dimmed by their own thickness. It now falls off with density, so only thin fringes catch the moon.

![Toward the moon, overhead and high by the moon, before and after](/images/2026-10-25-moon-and-torn-clouds/torn-before-after.jpg "Before (left) and after (right). The shapes are drawn out into rows, the edges are ragged, and scud passes under the deck.")

Sky above the trees, mean luma, from the gate against the reference frame (115): before 118, after 125; looking up, 129 before and 116 after; to the left, 95 before and 89 after.

### Cost

I measured the night woods at 1440p, back to back, with the committed shader, the new shader without scud, the new shader with scud, and the committed shader again. The curl and the stretch are within noise. The scud adds 0.01 to 0.08 ms of clouds plus volumetrics (at the canopy 0.62 to 0.68 ms). Frame times are within noise: gate far 6.85, 6.81, 6.81 and 6.86 ms. Scenes without clouds do not run the pass.

## Verification

- Full `ctest`: 114 of 114 pass. `EntitySceneTests` round-trips `cloudScud`. A new `SkyRenderTests` check shows that scud under a near-empty deck darkens the sky from 96 to 80.
- `SkyRenderTests` runs with a night's sky light. At the older test-scale light, the veil washed out every difference those checks look for. The flash check gives 118.6 ahead against 108.1 behind, the moon check 37.9 against 17.0, and the disc stands 55.2 above its surround when clear and -0.25 when covered.
- Renders at 1200, 2400 and 3600 frames show the clouds drifting and changing shape.
- The day woods are pixel-identical at all 11 poses.

## Open issues

- The sky still has more contrast than the reference.
- A flash does not light the scud yet.
- The scud moves quickly against the 12% history blend. Stills look clean, but it needs checking in motion.
- I want a CC0 photographed night sky as the far veil, and I have not sourced one.
- I have not decided whether the whole night should be brighter, or the ground moonlit.
