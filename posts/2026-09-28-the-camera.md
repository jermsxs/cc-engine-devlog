---
title: Building the camera
date: 2026-09-28
order: 5
summary: Bloom that behaves like a lens, a light meter that stops the dark from going grey, a colour-grade cube, film grain and exact sRGB output.
tags: renderer, post-processing
cover: /images/2026-09-28-the-camera/bloom-sconce.jpg
---

Everything that happens after the 3D scene is drawn is what makes an image feel like it came through a camera. How bright lights glow. How the camera copes when you walk from a dark room into a lit one. The colour grade. The grain. Until now, all of that was a single pass with a hand-made blur and a fixed exposure.

Today I replaced it with a proper chain. To follow why each step exists, you need to know one idea first: the scene and the screen speak different languages.

## HDR, display values and sRGB

> **Concept: HDR versus the display.** A lamp is thousands of times brighter than a wall in shadow. The renderer keeps those real ratios in *high dynamic range* (HDR) numbers, where a bulb might be 500 and a dark corner 0.002. A screen can only show 0 to 1 per channel, so before the image goes to the screen something has to decide how to squeeze that huge range into the small one. That decision is *exposure* (how bright overall) plus *tone mapping* (how to roll off the highlights so they don't just clip to flat white).

There's a second language problem. Light adds up *linearly*: two equal lamps give twice the light. But screens, and the 8-bit numbers stored for them, are not linear. Our eyes are much more sensitive to differences in dark tones than in bright ones, so image formats spend more of their 256 levels on the darks. The standard way to do that is the *sRGB curve*.

> **Theory: Why linear versus sRGB matters.** Lighting maths must be done in linear values, or blending and glow come out wrong. Only at the very end do you convert to sRGB for display. If you convert too early or twice, mid-tones look washed out. If you get the curve slightly wrong, every dark gradient shifts.

I had been approximating the final conversion with a power of 2.2, which is close but not the same thing. The real sRGB curve has a short straight segment near black. The change is small to describe but visible in this very dark scene. The screen now gets the exact curve from the graphics hardware itself, through an sRGB view of the back buffer. The scene gets slightly deeper blacks, by up to 9 of 255 levels in the darkest tones.

One wrinkle: the editor's interface is drawn into the same buffer. If it went through the same view its colours and see-through panels would change. So the UI draws through a second, plain view of the same memory, and its pixels are byte-for-byte what they were. I checked with an editor capture before and after.

## Bloom like a lens

When a very bright light hits a real lens or your eye, it scatters a little, leaving a soft glow around the bulb. That's *bloom*. It's also what tells your brain "that's really bright", even though the screen can't be any brighter than white.

The old approach took a handful of samples around each pixel, which gave blocky squares around the sconce glass. The new one works like this.

1. **Shrink the image six times**, each time to half the size, down to 1/64 across.
2. **Grow it back**, adding each level on the way up.

A small blur on a small image is a wide blur on the full image. Stacking the levels gives a halo that is tight near the bulb and soft far from it, at any size, for 0.09 ms.

> **In practice: Firefly control.** The sconce's bulb is a few centimetres behind its glass, so the glass pixels get enormous HDR values. One such pixel can smear into a bright square or flicker from frame to frame. The first shrink step weights each pixel by how *un*bright it is (a "Karis average", named after the graphics programmer who proposed it). A single blazing pixel can no longer dominate its neighbours.

![A wall sconce, with the old bloom on the left and the new mip chain on the right](/images/2026-09-28-the-camera/bloom-sconce.jpg "Left: the old single-pass bloom. Right: the mip chain wraps a smooth glow over the glass and collar.")

## A camera that meters the room

Without exposure control, you have to pick one brightness for the whole game. That doesn't work when the flashlight is pointed at a close door, or you look straight into a lamp.

Real cameras and eyes adapt. I built the same. A small compute shader sorts the image's brightness into 64 bins (a histogram), ignores the darkest and brightest 5%, and averages the rest. This is the same idea as a camera's light meter, and ignoring the extremes keeps one bulb or one black corner from deciding the whole exposure. The exposure then drifts toward the reading, faster when a room gets brighter than when it gets darker, like an eye.

For horror I clamped it hard. In a nearly black room a normal camera would open up and lift the scene to a comfortable grey, and that is the opposite of what I want. My meter may open up only a little, to about 0.68 from 0.5, so darkness stays dark. Looking into a lamp, or pointing the flashlight at a nearby door, closes the camera down instead of blowing the picture out.

Auto-exposure also snaps instantly when the camera jumps, for the same reason the shadow fades do: so screenshots never catch it mid-adjustment. Exposure moved out of the scene shader and into the post-process, so that the metered value applies to everything. Bloom reads the same value, so its threshold still means "as bright as the camera sees it".

![Fixed exposure in the upper six views, metered auto-exposure in the lower six](/images/2026-09-28-the-camera/exposure-manual-vs-auto.jpg "Top: fixed exposure 0.5. Bottom: the metered camera with horror clamps. Dark views are unchanged, bright ones close down so the door and lamp are no longer blown out.")

## A colour grade from a cube

> **Concept: LUT colour grading.** A *LUT* (look-up table) for colour is a 3D cube: you feed in a colour, and the cube hands back a new one. Film colourists use them to give a movie its palette: green-grey shadows, warm highlights, crushed blacks. The whole look is one small image, and applying it costs one texture lookup per pixel.

Mine is a 32 × 32 × 32 cube stored as a strip image. A script writes two of them: a *neutral* one that changes nothing, and `re7_hallway`, which is desaturated with cool green-grey shadows, slightly warm highlights and crushed blacks. A test proves the neutral cube moves no colour by more than 1/255 (the worst was 0.42/255), so I know that the machinery itself adds no tint.

The grade is applied after tone mapping, because a LUT expects the 0 to 1 values the screen will see. Tone mapping also gained a white-point setting, whose default reproduces the old curve exactly.

![The neutral LUT above and the re7_hallway LUT below, applied to the same image](/images/2026-09-28-the-camera/lut-neutral-vs-re7.jpg "Top: neutral LUT. Bottom: the tuned grade, colder and greener in the shadows with warmer lamp light.")

## Grain, vignette and a touch of dither

Film grain is now added to the final display image, strongest in the midtones and faint in the blacks and whites, so dark gradients don't look noisy-flat. Its pattern changes with a frame counter, which stops when the clock stops. That keeps my benchmark's screenshots identical from run to run (I checked: two runs differ by 0). A tiny dither stops dark gradients from showing 8-bit stripes.

## What it cost

Post-processing got cheaper while doing more. The bloom is 0.09 ms and the exposure meter 0.03 ms. The whole post chain at the end was about 0.25 ms, down from 0.32 ms, far under its 1 ms budget for an RTX 3060-class card. Numbers are from a Debug build on an RTX 4070 at 1440p.

![The six bench poses with the new camera chain](/images/2026-09-28-the-camera/bench-after.jpg "The six bench poses after the camera work: metered exposure, the new grade, mip-chain bloom and grain.")

## Still rough

Metering averages the whole frame. A centre-weighted meter would probably suit the flashlight better, once there's gameplay to judge it with. The older tint settings now overlap with the LUT and are candidates for retirement. And I haven't yet put exposure compensation on the in-game tuning list. It is only in the inspector and the tool server for now. Next up: ambient occlusion and real floor reflections.
