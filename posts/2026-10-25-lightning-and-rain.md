---
title: Lightning as a baked area light, and rain without a particle simulation
date: 2026-10-25
order: 3
summary: Lightning flashes inside the clouds and lights the woods through a baked bounce layer, and rain falls round the player as lit streaks that roofs keep out.
tags: weather, lighting, renderer
cover: /images/2026-10-25-lightning-and-rain/flash-clearing.jpg
---

With the night, the clouds and the moon in place, the next two steps of the weather plan were lightning and rain. They share a requirement: both have to read as light in a dark scene. A flash that lights only what a sun would light directly looks wrong under a tree canopy, and rain is invisible unless something lights it.

## Lightning

### What a flash does to a scene

A lightning discharge inside or between clouds lights the whole cloud deck. The deck acts as one very large, soft, cold-coloured light source above the scene. Three consequences follow:

- The light is soft and comes from a wide area of sky, not from a point. A flash casts soft, wide shadows, and a puddle reflects a broad patch of sky rather than a point of light.
- It reaches places a sun would not. Light from the deck scatters off the trees and the ground and fills the shadows, so even under a canopy there is a general lift in brightness.
- It is short and flickers. A flash is a return stroke followed by restrikes, which read as two to four quick pulses.

A renderer has to reproduce each of these, and the first two are the harder ones.

### How I light it

**The source.** The night scene keeps the day scene's directional sun at intensity 0. A flash raises that intensity to a peak and back down. Keeping the sun object means keeping its cascaded shadow maps, so a flash casts the trees' shadows across the path without a separate shadow system. The light comes from 40° elevation, which is high enough to reach down through the canopy.

**The envelope.** A scheduler seeded per scene fires a flash every 8 to 25 seconds. Each flash has two to four pulses, each starting 50 to 130 ms after the previous one. A pulse rises in 12 ms and decays exponentially with a time constant of 25 to 50 ms, cut off where it reaches 4 time constants so that it ends at exactly 0. The first pulse is usually the strongest. The whole flash lasts between a fifth and three-fifths of a second.

**The bounce.** Direct sunlight on its own did nothing under the trees. Indirect light in my engine comes from baked lighting: probes and lightmaps that store how light bounces around the static scene. The sun at intensity 0 contributes nothing to a normal bake, so there was nothing to scale up during a flash.

I solved it with a bake layer. The engine already bakes switchable lights into layers of their own, which are added to the base bake when the light is on. The sun is now such a light. Its layer is baked as if the sun were lit, at `bakeIntensity`, and the layer also bakes a sky of the flash's colour (`bakeSky`), because a flash lights the whole cloud deck, which reaches under trees and porches. At rest, the layer costs nothing and is not added. While a flash is active it is added with a weight that follows the flash's envelope, so the bounce rises and falls with the pulses.

**Exposure.** Auto-exposure reacts to a bright frame by lowering the exposure, which would make a flash look as if the picture dims at the peak and then brightens after. I hold the meter through the flash and 0.3 s after it, so a flash reads as light and not as an exposure change.

**The clouds.** The flash is also a point of light inside the cloud layer (see the first post), which lights the cloud around it, dimmed by the cloud between. The glow sits on the flash's cell and falls off quickly, with a faint floor over the whole deck, so a flash out of view still lifts the sky a little.

**No light shafts.** The fog pass can march crisp shafts from a sun. A flash is the whole deck and not a sun, so I skip the shaft march while it lasts (about 0.5 ms) and let the fog's froxel volume scatter the flash instead. Side by side, the shafts were only a few faint streaks (clearing 31.9 against 28.3 mean luma).

**Scripts.** `Weather.Flash()` triggers one, `Weather.Lightning` switches the schedule, and `OnLightning(strength)` is raised on every script when a flash starts, which is the hook that thunder and scripted scares will use.

![The clearing between flashes, in a flash and six frames later](/images/2026-10-25-lightning-and-rain/flash-clearing.jpg "Left: between flashes, the torch only. Middle: one frame into a flash. Right: six frames later.")

![The clouds without and with a previewed flash](/images/2026-10-25-lightning-and-rain/cloud-flash-preview.jpg "Looking up through the canopy: no flash (top) and a previewed flash (bottom). The flash lights the cloud deck from inside.")

| Pose | Between flashes (mean luma) | Flash | Six frames later |
|---|---|---|---|
| path start | 25.2 | 32.2 (×1.28) | 30.1 |
| clearing | 16.4 | 28.2 (×1.72) | 23.7 |
| up at the canopy | 21.9 | 36.4 (×1.66) | 31.3 |
| gate close | 20.0 | 26.7 (×1.33) | 24.1 |
| gate far | 27.6 | 31.1 (×1.13) | 29.8 |

Open ground under the sky brightens most, and the deep path less. The picture is back to normal after about 40 frames.

### Problems on the way

- **Too bright.** At an intensity of 3 a flash looked like daylight on snow. It is now 0.5 plus the baked sky.
- **Nothing under the trees.** The direct light barely got through the canopy. The baked sky layer fixed that.
- **Speckled shafts.** The first frame of a flash was noisy and was frozen into the shafts' temporal history. Their history now follows the light's intensity and averages over the first frames. Later I removed the shafts for lightning altogether.
- **A flat pale sky.** The cloud glow's long tail washed the whole deck. I first suspected bloom, but bloom on or off gave identical frames. The glow now falls off as the square of the distance term, with a small floor.
- **A 15 ms frame on the first flash.** The first flash drew every shadow cascade and the far face at once. Keeping a dark sun's faces following the camera fixed that, but walking then cost 0.5 to 1 ms more at the 95th percentile all the time. Now a dark sun's shadow faces are selected only until they have been drawn once at load, and a flash redraws only what moved. The first flash costs 11.3 ms (it was 14.9) and later ones about 10.
- **A dark light in every cluster.** Giving the dark sun shadows added 1.3 ms at rest, because every pixel looked up the cascades for a light at 0. Lights at intensity 0 are now in no light cluster. That also took the lightning light out of every cluster at rest, where it had cost a little all along.

### Cost

At rest the night woods are image-identical and 0 to 0.5 ms faster at every pose over two rounds (clearing 8.18 to 7.87 ms, gate far 7.07 to 6.74 ms). During a flash, tested with a flash every 20 frames as a worst case, the clearing goes from 8.19 to 9.15 ms and the path start from 9.39 to 10.04 ms. A real flash lasts at most 0.6 s. The shadow pass is unchanged while walking (0.19 to 0.23 ms). The hallway, house and kitchen are image-identical.

Tests (`ctest` 115 of 115): `WeatherTests` covers the envelope over 300 seeds, that a seed gives the same flashes 8 to 25 s apart (and none with the schedule off), the exposure hold, the baked layer following the envelope, and a session driving the light, the glow, the hold and the shafts and then restoring them. `ScriptingTests` checks `OnLightning` and `Weather` from C#, and `ShadowLightsTests` covers the dark sun.

## Rain

### The problem

Rain needs to be visible in the torch beam, flash with the lightning and be nearly invisible in the dark. It should fall round the player at any position, stay in place in the world when the player walks, and stop under roofs. And it has to be cheap enough that it fits in the frame budget, which I set at 0.5 ms for the rain.

### How real-time rain works

A raindrop is a small transparent sphere that falls at about 9 m/s. Two effects decide how it looks in a photograph or a game. First, a drop moves several centimetres while the shutter is open, so the camera records it as a streak and not as a dot. At 9 m/s and a shutter of 1/60 s the streak is about 15 cm long. Second, a drop is almost transparent, so it is only visible where it catches light, which is why rain shows in a torch beam, against a bright background and in a flash, and not elsewhere.

The standard real-time approaches are:

1. Particles, one per drop, simulated and rendered as streak billboards.
2. A screen-space or camera-attached texture of scrolling streaks.
3. Instanced streaks whose positions are a pure function of time.

The first needs state and a simulation. The second does not move correctly in 3D when the camera moves. I took the third.

### Drops without a simulation

Up to 32,768 drops live in a 28 × 16 × 28 m box that follows the camera. A drop's position comes from a hash of its number and the time, wrapped around the box. With a hash there is nothing to store between frames, and wrapping at the box's edges means a drop leaving at the bottom reappears at the top. The rain stays put in the world when the player walks, because a drop's position is a function of world coordinates and time, and not of the camera.

### Lit like the fog

A compute pass runs after the fog pass. It places every drop and lights it the way the fog is lit at that spot: the ambient light and the baked probes, the lamps with their shadows, the lightning and the torch. The fog in front of the drop dims it. So the rain shows in the torch and flashes with the lightning without any special case for either.

### Drawn after temporal anti-aliasing

TAA accumulates samples over frames by reprojecting last frame's image with motion vectors. A streak moves a long way every frame and has no meaningful motion vector, so TAA averaged it into nothing. I draw the streaks into their own render target and add them in the post pass, after TAA. A drop thinner than a pixel is drawn one pixel wide and dimmer in proportion, so far rain does not crawl or flicker.

### Keeping rain off the ground under roofs: the shelter map

A drop should disappear when it reaches a surface, and it should not be visible under a roof. I handle both with a height map, drawn the same way as a shadow map. The scene's fixed solid objects are rendered from straight above, once, into a 1024² tile of the shadow atlas. Each texel holds the height of the highest surface at that position. A drop below that height is under cover and is hidden. Leaf cards are left out of this pass, so rain falls through the canopy, while bark and branches still shelter what is under them. The map is redrawn only when the player crosses a 6.4 m step.

This is an occlusion approximation. It has one layer, so it cannot represent a floor under another floor, and it cannot express anything that moves. For the woods and for the house's roof it is enough.

### Splashes

Faint rings grow and fade over 0.3 s on the first surface under the sky, only below eye level. Splash positions come from the same kind of hash as the drops.

### Results and problems

![The first rain, with bright white streaks and sticker-like rings](/images/2026-10-25-lightning-and-rain/rain-first-try.jpg "The first rain at the clearing. The streaks are solid white lines and the splashes are flat bright rings.")

- **Bright white wires and sticker rings.** The first frame worked, but the streaks were solid white lines and the splashes bright rings. I lowered the brightness to 0.4, gave the streaks soft ends (brightest a third from the drop and fading towards the tail), and made the splashes smaller, softer and a third as bright.
- **Rings in the trees.** A few splashes sat in a tree crown, on branches the shelter map sees. Splashes now land only below the eye.
- **Too sparse.** Over 40 m most drops were out of view. The box is 28 m wide so the same drops fall closer.
- **Checking whether the shelter map hides too much.** Tinted debug colours showed it. Green drops have gone into the ground and are correctly hidden, and red ones are under a crown's branches.

![Debug colours on the rain drops](/images/2026-10-25-lightning-and-rain/shelter-debug.jpg "Green drops have reached the ground. Red drops are under a tree crown's branches.")

![No rain, rain, and rain in a flash at the clearing](/images/2026-10-25-lightning-and-rain/rain-clearing.jpg "Left: no rain. Middle: rain lit by the torch. Right: rain in a lightning flash.")

| Pose | No rain (mean luma) | Rain | Rain in a flash |
|---|---|---|---|
| path start | 25.1 | 26.7 | 33.9 |
| clearing | 16.4 | 18.5 | 30.7 |
| up at the canopy | 21.9 | 22.6 | 37.1 |
| gate close | 20.1 | 21.5 | 28.1 |

The rain lifts the frame by 0.7 to 2 levels. The fog is 0.016 instead of 0.012 in the rain column.

Cost, GPU at 1440p without TAA, same build, rain 0.8 against 0, two rounds over the 11 woods poses: +0.03 to +0.23 ms, typically +0.07 ms. Walking the path with a quick turn over 1100 frames: GPU mean 8.59 and 8.71 ms with rain against 8.57 and 8.63 without. The shadow pass stays at 0.23 ms, so the shelter map's redraws do not show. The hallway, house and kitchen are image-identical.

`RainRenderTests` uses a black roof over half a black floor, lit only by the ambient. The rain adds 1.15 million levels on the open side and -7 under the roof. Splashes show on the open floor and none under the roof, and amount 0 draws nothing.

![The roof test](/images/2026-10-25-lightning-and-rain/test-roof.jpg "The test scene: the right half of the floor is open and the rain falls on it. The left half is under the roof and stays dry.")

One baseline problem took time. A checkout of the previous commit crashed on start because of stale object files, which a clean build fixed. It then rendered a different house, because its Git LFS files were pointer stubs. `git lfs checkout` and refreshing the build folder's copy of `Game/` fixed that.

## Open issues

- The fainter streak noise in the far fog is not done. The far rain is the denser fog alone.
- A C# `Weather.Rain` to change rain from scripts is not done.
- Drops stop on bark and roofs but not on leaves, on purpose, because they fall through the canopy.
- Thunder is the next sound step and will hook to `OnLightning`. The flash does not light the scud yet.
- The rain still reads as lit white lines, not as soft grey rain. That is the subject of the next post.
