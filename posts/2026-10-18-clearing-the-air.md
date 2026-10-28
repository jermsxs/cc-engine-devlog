---
title: Reducing volumetric fog until lamps and the flashlight read clearly
date: 2026-10-18
order: 1
summary: How my froxel fog hazed the flashlight and the lamps, a reflection probe that lit a wall through its neighbour, and my decision to make the fog nearly invisible.
tags: lighting, renderer, performance
cover: /images/2026-10-18-clearing-the-air/torch-turning-after.jpg
---

For two days I played the house with the corridor lights off and the flashlight in my hand, and I kept noticing the same things. A bright spot flickered on a wall across from where a lamp would be. The flashlight looked foggy, and when I turned, its light seemed to drag behind the camera. With the lamps on, the bulbs and the windows sat in a glowing haze. I want to see surfaces lit by light, not air lit by light. This post covers four passes over the 18th and 19th that ended with the fog nearly invisible, which was a decision I made deliberately and which has a cost in the look of the beam.

## A bright spot behind a dark wall

With the corridor lamps off, a spot of light flickered on the corridor wall. My first suspicion was the corridor lamp. It was the dining room's reflection probe.

> **Background: reflection probes.** A reflection probe is a 360-degree image of a room captured once, from one point, and stored as a cube map with a chain of blurred mip levels. A surface inside the room finds what it should reflect by computing the reflection vector, looking up the cube in that direction, and choosing a blurrier mip for rougher materials. Looking up the cube directly assumes the room is infinitely far away, so a probe usually corrects the lookup by intersecting the reflection ray with a box that approximates the room (box projection). Because the capture is from one point, it is only meaningful inside the room. To avoid a hard edge, a probe's influence fades out over some distance beyond its box.

The dining room's box ended 8 cm behind the corridor wall, and the probe's influence fades over 0.5 m past its box. The fade therefore carried through the wall. The corridor face of that wall picked up the dining room's cube, projected onto the same spot, which showed the dining room's lit wall. The spot flickered because the dining lamp flickers.

![A bright spot on a dark corridor wall](/images/2026-10-18-clearing-the-air/wall-spot-before.jpg "With the corridor lamps off, a spot of light on the corridor wall. It came from the neighbouring room's reflection probe, through the wall.")

The fix is to make the influence depend on orientation. Outside its box, a probe now gives nothing to a surface that faces away from the box, because that surface is on the far side of the box's wall. A floor in a doorway faces neither way, so it still blends.

While I was in the reflection code I changed how reflections go dark. Switching lamps off used to scale a probe's whole reflection down, so a dark corridor lost the moonlit window from its reflections as well. Each probe is now baked a second time with every switchable lamp out, which I call the dark cube, and the renderer blends towards it as the lamps go off. The price is that the reflection files and the reflection VRAM double: the house's reflection data went from 8.9 to 17.8 MB.

## Why the flashlight looked foggy

### How volumetric fog works

> **Background: participating media and single scattering.** Air with dust or moisture absorbs and scatters light. The fraction of light that survives a path of length `d` through a medium with extinction coefficient `sigma` is `T = exp(-sigma * d)`, the Beer-Lambert law. Light that is scattered towards the eye is what makes a beam visible. The simplest model, single scattering, considers light that comes from a source, scatters once at a point in the medium, and travels to the eye. For a view ray the amount gathered is the sum over points along the ray of `T(eye, point) * sigma_s * L_in(point) * phase(theta)`. `L_in` is the light arriving at that point from all lights, including its distance falloff and shadows. The phase function says how much is scattered through the angle `theta` between the light's direction and the direction to the eye. I use Henyey-Greenstein, `p = (1 - g^2) / (4 * pi * (1 + g^2 - 2 * g * cos(theta))^1.5)`, where `g` above zero favours forward scattering, so a lamp is brighter when you look towards it.

The sum is evaluated over a grid. I use view-aligned cells called froxels, 160 by 90 by 64 at high quality, with the slices spaced exponentially in view depth so that cells near the camera are thin. Each frame has three steps.

1. An inject pass fills every cell with its extinction and with the light it scatters towards the eye: the ambient light plus the scene lights, each with its shadow. The sample position inside the cell is jittered every frame and blended with last frame's cells, reprojected, so that the history averages the whole cell.
2. An integrate pass marches each column of cells from the camera. It stores, for each cell boundary, the light gathered and the transmittance left up to that boundary.
3. The scene pass reads that table at the pixel's depth and adds the gathered light to the surface colour multiplied by the transmittance.

![Single scattering along a view ray](/images/2026-10-18-clearing-the-air/single-scattering.svg "Single scattering along one view ray: each sample receives light from the lamp and scatters a share towards the eye.")

The cost scales with the number of cells and with the lights each cell reads, which light clusters keep small. The usual faults are visible in the pictures that follow: a trail behind moving lights where the history lags, coarse cells near the camera, and a grey veil, because any fog bright enough to show a beam also scatters light from everything the beam crosses.

### What I saw in the house

Three things made the flashlight foggy and unsteady.

1. **History.** The fog keeps about 92% of each frame's light from the frame before, reprojected by world position. That works for lamps, which do not move. The flashlight moves with the camera, so every turn left a trail of where the beam had been, fading over about a dozen frames. That was the way the light "dragged" when I moved.
2. **Cells near the lens.** A cell close to the camera is much wider than the beam is at that distance. It spreads the beam into a glowing cloud over the lower right of the screen.
3. **Strength.** At full strength the house's dusty air scattered the beam into a wash that hid what it lit.

The fixes are mostly about leaving things out. The flashlight and its bounce light are removed from the history pass. The integrate pass lights them at each cell's centre every frame, because relative to the camera they hardly change between frames and need no history. The beam's fog fades in over its first 1.5 m, which removes the cloud at the lens. A new setting, `flashlight.fogScatter` from 0 to 1, sets how much of the beam the fog shows. It started at 0.35.

I captured both versions mid-turn, with the mouse moving right for 50 frames before the picture, because that is where the history trail shows.

![The flashlight during a turn, before](/images/2026-10-18-clearing-the-air/torch-turning-before.jpg "Before, corridor lamps off and mid-turn: the beam is a wash of fog that hides the floor and washes out the far window.")

![The flashlight during a turn, after](/images/2026-10-18-clearing-the-air/torch-turning-after.jpg "After, same view: the corridor is dark and readable, and the light lands on surfaces.")

Together, the second reflection sample from the probe change and the flashlight's extra work in the integrate pass cost 0.01 to 0.04 ms of GPU time per bench pose.

## Lamps and windows

The flashlight read correctly, but the lamp bulbs and windows still sat in a haze. The fog scattered the full light of every lamp and window towards the eye. The light arriving at a point near a bulb follows the inverse-square law, so the cells next to a bulb are very bright, and a view ray that passes near it gathers a large amount of scattered light. That is a halo, and it is a different effect from bloom, which is a screen-space filter on the bright pixels themselves.

The flashlight already had its own strength control. I added a matching one for scene lights, `volumetrics.lightScatter`, from 0 to 1, with a default of 1 so other scenes do not change. The house and the hallway used 0.35. The fog's ambient part and its density were not changed, and the bloom on the bulbs stays.

## Measuring what the fog adds, and my decision

The fog was better, but I could still see it in some places, mainly while moving. I rendered six places with the fog on, with it off, and with each part of it removed, and compared the images. The numbers are the mean change per pixel out of 255. A repeat run differs by less than 0.1.

| Part of the fog | What it added |
|---|---|
| Lamp and window light scattered by the fog | 0.1 to 4.3, the most in the corridor and foyer |
| Drifting dust (noise that moves through the air) | 0.7 to 1.6 everywhere |
| Ambient light scattered by the fog | 0.1 to 1.2 |
| The flashlight | under 1 |

The flashlight was no longer the main cause. The lamps' glow was the largest part. The dust matters for a different reason. The fog's density is a sum of three terms: a constant, a height fog that thins with altitude, and the dust, which is noise that drifts through the air. The dust patches slide past as I walk, so the fog shows most in motion.

I decided that the fog should be nearly invisible in this house. I set `lightScatter` from 0.35 to 0.1, the same as the flashlight, `dustDensity` from 0.05 to 0, and `ambientStrength` from 0.4 to 0.2. These are scene values only, in both the house and the hallway. The fog's total effect fell from 1.8 to 5.5 down to 0.2 to 2.1. What remains is mostly the fog darkening distant surfaces, which keeps the sense of depth, and not a visible glow.

## The beam at a distance

The last piece was the beam at medium and long range. Looking down a corridor, every pixel's view ray passes through the lit shaft just in front of the torch, so at 0.35 that shaft laid a grey veil over everything the beam reached. This is the veil problem described above, applied to the beam itself.

I first tried fading out only the distant part of the beam. It was not enough, because the near shaft alone still veiled the far end. So I changed two things. The beam's fog, and its bounce's, now fades out between 2 and 4 m from the lens after fading in over the first 1.5 m, and beyond 4 m those cells skip the flashlight entirely. That made the house's GPU frame 0.01 to 0.07 ms faster. And `flashlight.fogScatter` dropped from 0.35 to 0.1.

![Down the south corridor with all lights off, before](/images/2026-10-18-clearing-the-air/long-before.jpg "Before, at strength 0.35: the shaft in front of the torch veils the corridor in grey.")

![Down the south corridor with all lights off, after](/images/2026-10-18-clearing-the-air/long-after.jpg "After, at 0.1 and fading out by 4 m: the far end reads as dark, clear space.")

## Results and the trade-off

Fog is what makes a flashlight beam look like a beam, and a lot of horror imagery relies on it. Each change above gives up some visible shaft for a clearer picture, and I accept that for the house. The beam is now a pool of light on surfaces, with a hint of fog near the torch.

Each part has one setting in Render Settings: Fog Light Scatter, Fog Ambient, the dust density and Flashlight Fog Scatter. Setting Quality to off removes the fog entirely, including the darkening of distant surfaces. If I want a more visible shaft, I raise Flashlight Fog Scatter. The tests pass, with `VolumetricsTests` covering the fade-out and `EntitySceneTests` covering the saved settings, and the bench shows no cost change beyond noise. The sun's shafts in a later scene are a separate mechanism, because blind slats are far too fine for this grid.
