---
title: Clearing the air
date: 2026-10-18
order: 1
summary: Why my volumetric fog made lamps and the flashlight look hazy, a wall spot that came from a reflection probe, and how I turned the fog down until it nearly vanished.
tags: lighting, renderer, performance
cover: /images/2026-10-18-clearing-the-air/torch-after.jpg
---

For two days I played the house with the corridor lights off and a flashlight in my hand, and the same complaints kept coming back. A bright spot flashed on a wall across from where a lamp would be. The flashlight looked foggy, and when I turned, its light seemed to drag behind. And even with the lamps on, bulbs and windows sat in a glowing haze, when they should simply look like bulbs and windows. This post covers four small passes, over the 18th and 19th, that cleared the air.

## A glow behind a dark wall

With the corridor lights off, a bright spot flickered on a wall. I first suspected the corridor lamp, but it was something else: the dining room's reflection probe.

> **Concept: Reflection probes.** A *reflection probe* is a small 360-degree photograph of a room, baked ahead of time and stored as a cube of six images. Shiny and slightly shiny surfaces inside the room look things up in it to show what they would reflect. It is cheap, but it is a photograph taken from one point, so it only makes sense inside its room. To avoid a hard edge, a probe's influence fades out over 0.5 m past its box.

The dining room's box ended 8 cm behind the corridor wall, so the probe's half-metre fade carried it through the wall. The corridor face of that wall picked up the dining room's reflection and showed the dining room's lit wall, and since the dining lamp flickers, so did the spot.

![A bright spot on a dark corridor wall](/images/2026-10-18-clearing-the-air/wall-spot-before.jpg "With the corridor lamps off, a spot of light glowed on the wall. It came from the neighbouring room's reflection probe, through the wall.")

The fix: outside its box, a probe gives nothing to a surface that faces *away* from the box, because that surface is on the far side of the box's wall. A floor in a doorway faces neither way, so it still blends. The spot is gone.

While I was there I changed how reflections go dark. Switching lamps off used to scale a probe's whole reflection down, so a dark corridor lost its moonlit window in the reflections too. Now each probe is baked a second time with every switchable lamp out, a "dark cube", and the renderer blends towards it as the lamps go off. The price is that reflection files double in size, from 8.9 to 17.8 MB for the house.

## Why the flashlight looked foggy

Three things were stacked up.

**History.** The fog is expensive, so it is smoothed over time. Each frame keeps about 92% of the light from the last frame, reprojected by world position. That works when the light stays still. A flashlight moves with the camera, so every turn left a trail of where the beam had been, fading over a dozen frames. That was the "emits weirdly when moving".

**Near the lens.** Fog cells close to the camera are much wider than the beam is at that distance, so they spread it into a glowing cloud over the lower right of the screen.

**Strength.** At full strength the house's dusty air scattered the beam into a wash that hid what it lit.

> **Concept: Volumetric fog.** To show shafts of light in air, I split the view into a 3D grid of cells that fan out from the camera. For each cell I ask how much light reaches it, then add up the cells along each pixel's line of sight. It is a real effect, not a smoke sprite: the air really is lit by lamps, and a lamp's glow in the dust is what makes a beam visible. The trade-off is that fog scatters *everything* toward your eye. A clear scene wants to see surfaces, not haze, and any fog bright enough to show a beam also lays a veil over everything behind it.

The fixes were mostly about leaving things out. The flashlight and its bounce are left out of the history pass entirely, and lit fresh each frame. Relative to the camera they hardly change from one frame to the next, so they need no history. The beam fades in over its first 1.5 m, so the cloud at the lens is gone. And there is a new setting, how much of the beam the fog shows.

Before and after, corridor lights off:

![The flashlight before: a thick fog fills the corridor](/images/2026-10-18-clearing-the-air/torch-before.jpg "Before: the beam is a wash of fog that hides the floor and the far window frame.")

![The flashlight after: the same view with a clear beam](/images/2026-10-18-clearing-the-air/torch-after.jpg "After: the corridor is dark and readable, and the light just lands on things.")

## Lamps and windows should just be clear

The flashlight now looked right. The same foggy glow still hung round the lamp bulbs and the windows. The fog scattered the *full* light of every lamp and window towards the eye, which put each one in a halo.

The flashlight already had its own strength control. I gave scene lights a matching one, `lightScatter`, from 0 to 1, with a default of 1 so other scenes do not change. The house and hallway use 0.35, then later 0.1. The fog's ambient part and its density are unchanged; only how much lamp and window light the fog scatters changed. The bloom on the bulbs stays, because that is a separate effect.

## Still too visible: measuring what the fog adds

It was better, but the fog was still slightly visible in places, especially when moving. So I rendered six places with the fog on, with it off, and with each part removed, and compared. The numbers are the mean change per pixel out of 255.

| Part of the fog | What it added |
|---|---|
| Lamp and window light scattered by the fog | 0.1 to 4.3, the most in the corridor and foyer |
| Drifting dust (noise that moves through the air) | 0.7 to 1.6 everywhere |
| Ambient light scattered by the fog | 0.1 to 1.2 |
| The flashlight | under 1 |

So it was not the flashlight any more. The lamps' glow was the largest part, and the dust is the part that moves. Its patches slide past as you walk, which is why the fog showed most in motion. I changed scene values only: lamp scatter 0.35 to 0.1, drifting dust to 0, ambient fog scatter 0.4 to 0.2. The fog's total effect dropped from 1.8 to 5.5 down to 0.2 to 2.1. What is left is mostly the fog darkening distant surfaces, which keeps the sense of depth.

## The beam, at a distance

The last piece was about the beam at medium and long range. Looking down a corridor, every pixel's line of sight passes through the lit shaft just in front of the torch. At the old strength that shaft laid a grey veil over everything the beam reached.

I first tried fading out only the distant part of the beam, and it was not enough: the near shaft alone still veiled the far end. So I did two things. The beam's fog now fades out between 2 and 4 m from the lens, after fading in over the first 1.5 m, and beyond 4 m those cells skip the flashlight entirely, which makes the frame a hair faster. And its strength dropped from 0.35 to 0.1.

![Down the corridor with all lights off, before](/images/2026-10-18-clearing-the-air/long-before.jpg "Before (strength 0.35): the shaft in front of the torch veils the whole corridor in grey.")

![Down the corridor with all lights off, after](/images/2026-10-18-clearing-the-air/long-after.jpg "After (0.1, fading out by 4 m): the far end reads as dark, clear space.")

## The trade-off

This is the honest cost. Fog is what makes a flashlight beam *look* like a beam, and a lot of horror imagery leans on it. Every step I took trades some of that "visible shaft" for a clearer picture. I keep a single setting for each part in Render Settings, so the choice stays easy to change: Fog Light Scatter, Fog Ambient, the dust density and the flashlight's own strength. Setting quality to off removes the fog entirely, darkening included. For now the fog is nearly invisible and the beam is a clear pool of light, which is what I wanted for playing the house.
