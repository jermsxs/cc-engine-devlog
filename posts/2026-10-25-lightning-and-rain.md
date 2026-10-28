---
title: Lightning in the clouds, and the first rain
date: 2026-10-25
order: 3
summary: The storm starts flashing inside the clouds and lighting the woods through a baked bounce, then rain falls round the player, lit like fog and kept off by roofs.
tags: weather, lighting, scripting
cover: /images/2026-10-25-lightning-and-rain/flash-clearing.jpg
---

With a believable night sky in place, I could build the reason I wanted it: lightning. The storm now flashes inside the clouds every few seconds, and for a moment the whole forest is lit a cold blue-white. Later the same day, rain started to fall. This post covers both: a flash you can feel in the dark, and the first version of the rain. (The first version of the rain was not good. I'll get to that.)

## Lightning that lights the woods

Every 8 to 25 seconds, the storm now flashes: two to four quick pulses over a fifth to three-fifths of a second. The first pulse is the strongest. Each pulse is a 12 ms rise and a quick decay. In that moment the woods are lit from above, the clouds glow round the flash's cell, and the image does not pump darker afterwards.

![Between flashes, in a flash and six frames later at the clearing](/images/2026-10-25-lightning-and-rain/flash-clearing.jpg "The clearing between flashes (left), one frame into a flash (middle), and six frames later (right). The open ground brightens most.")

**The light.** In the night scene I kept the day's sun with an intensity of 0, so it keeps its cascaded shadows. A flash raises it to a peak and back. It comes from 40 degrees up, so it reaches down through gaps in the canopy.

**The bounce.** A flash should light more than what the sun sees directly. Under the trees, where the sun can't reach, the flash did nothing. In real life lightning lights the whole cloud deck, and that glowing deck lights everything beneath it, including under trees and porches.

> **Concept: Baked bounce light.** Light that has bounced around is expensive to compute live, so many engines *bake* it: they calculate it ahead of time and store it, for example in *light probes* (small samples of "how bright is the light coming from each direction, at this point in space"). The catch is that a baked result is for one fixed lighting condition. My answer is to bake the lightning separately, in a layer of its own, *as if lit*. At rest the layer costs nothing and is not added. During a flash it is faded in along the flash's envelope, so its stored bounce appears and disappears in time with the light.

That layer also bakes a sky the colour of the flash, since a flash lights the whole cloud deck, not just the point of the bolt.

**The exposure.** The camera's exposure is held through the flash and for 0.3 s after it. Without that, the exposure adjusts as the light spikes, and a flash reads as the picture dimming once it is over. Held, it reads as light.

**The clouds.** The glow sits on the flash's cell and falls off quickly, with a faint floor over the whole deck, so a flash out of view still lifts the sky a little.

**No beams.** A flash is the whole cloud deck, not a sun, so it draws no crisp light shafts. The fog scatters it through the volume instead. Side by side, the beams were a few faint streaks, so I skipped the shaft march (about 0.5 ms) while a flash lasts.

![A cloud flash previewed in the sky above the trees](/images/2026-10-25-lightning-and-rain/cloud-flash-preview.jpg "Looking up through the canopy: the clouds with no flash (top) and with a previewed flash (bottom). The glow lights the clouds' billows rather than showing a white blob.")

### Scripts can feel it

C# scripts can call `Weather.Flash()` to make one, set `Weather.Lightning` to switch the schedule on or off, and implement `OnLightning(strength)`, which tells every script when a flash starts. That last one is for thunder and scares later. A flash was also a good test of the engine's seeds: the same random seed gives the same flashes, so my tests can check the timing.

### What went wrong

- **Too bright.** At an intensity of 3, a flash looked like daylight on snow. It is now 0.5, plus the baked sky.
- **Speckled shafts.** The first frame of a flash was noisy and got frozen into the shafts' history. That is another reason I dropped shafts for lightning.
- **A flat pale sky.** The glow's long tail washed the whole deck. I first blamed bloom, but turning bloom off gave identical frames. The glow now falls off as the square, with a small floor.
- **A 15 ms frame on the first flash.** Every shadow cascade and the far shadow face were drawn at once. A dark sun's faces now get drawn once, at load, and a flash redraws only what moved. The first flash dropped from 14.9 ms to 11.3 ms.
- **A dark light in every cluster.** Giving the dark sun shadows added 1.3 ms at rest, because every pixel looked up its cascades for a light at zero. Lights at intensity 0 are now in no light cluster at all, which also took the lightning out of every cluster at rest.

## The first rain

Then the rain. Thin streaks fall round the player, lean a little with the wind, show up bright where the torch or a flash catches them and nearly vanish in the dark, with faint splashes on the ground. Roofs keep it off.

**Drops without a simulation.** Up to 32,768 drops live in a 28 × 16 × 28 m box that follows the camera. Each drop's place comes from a hash of its number and the time, wrapped round the box. So the rain stays put in the world as the player walks, and nothing is stored between frames. A hash is just a function that scrambles numbers into random-looking ones, and it is cheap.

**Lit like the fog.** A compute pass places every drop and lights it the way the fog is lit at that spot: the ambient light, the baked probes, the lamps with their shadows, the lightning and the torch. The fog in front dims it. So rain shows in the torch beam and flashes with the lightning without any special case.

**Drawn after anti-aliasing.** TAA (temporal anti-aliasing) blends each frame with the previous one. A streak moves so far every frame that TAA averaged it to nothing. So the streaks go into their own target and are added in the post pass, after TAA. A drop thinner than a pixel is drawn a pixel wide and dimmer, so far rain doesn't crawl.

> **In practice: Roofs keep the rain off.** The scene's fixed solid objects, seen from straight above, are drawn once into a 1024² tile of the shadow atlas: a *shelter map*. If a drop is below what that map sees, it is hidden. It is the same idea as a shadow map, with the "light" pointing straight down. Leaf cards are left out of it, so rain falls through the canopy, while bark and branches still shelter what is under them. The map is redrawn only when the player crosses a 6.4 m step.

![The shelter map debug view](/images/2026-10-25-lightning-and-rain/shelter-debug.jpg "A debug view. Green drops have already gone into the ground, which is correct. Red ones are under a crown's branches.")

I made a test for the shelter: a black roof over half a black floor, lit only by the ambient. The rain adds over a million levels on the open side and nothing under the roof, and splashes show on the open floor only.

### The first try

My first frame worked and looked bad. The streaks were solid white lines and the splashes were bright rings, like stickers. I toned them down: brightness 0.4, soft ends on the streaks, and smaller, softer, dimmer splashes. A few splashes also sat up in a tree's crown, on branches the shelter map sees, so splashes now land only below eye level. Over 40 m, most drops were out of view, so I made the box narrower and denser.

![The first rain at the clearing: white wire streaks and bright rings](/images/2026-10-25-lightning-and-rain/rain-first-try.jpg "The first try: thin white wires and sticker-like rings on the ground.")

![The clearing with no rain, with rain, and with rain in a flash](/images/2026-10-25-lightning-and-rain/rain-clearing.jpg "The same spot with no rain (left), rain (middle), and rain in a lightning flash (right).")

## The cost

The lightning is cheap: the night woods are the same at rest, and a flash costs at most a millisecond or so for under a second. The rain costs about 0.07 ms typical (+0.03 to +0.23 ms) at 1440p. The hallway, kitchen and house are image-identical, since none of them has weather.

I also hit a funny infrastructure problem while measuring. My comparison build crashed on start (stale compiled objects), then rendered a different house, because its large asset files were still placeholder stubs. Cleaning the build and fetching the real files fixed it.

## Where it stood

I had lightning that lit the woods and rain that fell through them. But looking at the rain, I wasn't happy: it was too visible, and the splashes slid along with me as I walked. That was tomorrow's job.
