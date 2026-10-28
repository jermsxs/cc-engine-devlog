---
title: The woods at night, and clouds you can march through
date: 2026-10-25
order: 1
summary: I turn the sunny woods into a night scene lit by a hand torch, then replace a flat painted sky with real volumetric storm clouds.
tags: outdoors, weather, renderer
cover: /images/2026-10-25-woods-at-night/gate-close.jpg
---

The woods were done: a muddy path, hundreds of trees and bushes, a wrought-iron gate and a big old house behind it, all in warm afternoon light. That was the day scene. I wanted to try something harder. Weather. Specifically a stormy night, with rain, with lightning flashing inside the clouds and lighting the trees, and the player walking through it with only a torch.

I broke the idea into seven steps and wrote them down in a plan: the night, the clouds, the lightning, the rain, wet surfaces, sound, and a final pass. Today was the first two steps. The second one I had to do twice.

## First, make it dark

The night is its own scene file, built by the same script as the day woods with a `--night` switch. The same random seeds place every tree, so the gate, the path and the house are identical. Only the light changed.

- **No sky picture.** What you see is a dark clear colour seen through cold haze. Without a sky picture to light things from, the engine falls back to a very dim blue-grey ambient colour. So away from the torch, the woods are lit by almost nothing, which is how a real forest at night is.
- **The sun stays, at zero.** I kept the sun in the scene with an intensity of 0. Later it becomes the lightning, and because it keeps its shadow maps, a flash will throw the trees' shadows across the path for free.
- **A new colour grade.** A *LUT* (look-up table) is a small 3D colour chart that the final image is passed through to give it a "look". The night LUT keeps about a quarter of the colour, tints the darks cold, and turns the torch's beam cold white instead of the day's amber.
- **One lit window.** An upstairs window of the house glows as if someone left a lamp on. It gives the eye somewhere to go through the gate.

My first try was far too bright and yellow, more like dusk than night. Two things caused it. The camera's *auto-exposure* (the engine's version of a camera adjusting to the light) was allowed to brighten a near-black forest up towards mid grey. And the day's amber colour grade turned the haze tan. I fixed the first by lowering how bright the exposure may go, and the second with the new LUT. The window also read as a white square at first, because exposure multiplies light so much at night that even a tiny glow clipped to white. Turning it down to a dim cream let it look like a lamp.

![The day woods on the left against the night on the right, at three places](/images/2026-10-25-woods-at-night/day-vs-night.jpg "The day scene (left) and the night scene (right) from the same three spots. The frame's average brightness falls from about 80 to about 20.")

A nice surprise: the night is cheaper to render than the day. Most of the saving is the fog, which dropped from 0.8 ms to 0.16 ms a frame because a dark sun has no light shafts to march through.

## Clouds, attempt one: a flat layer

A flat blue-grey sky is boring, and lightning needs something to flash inside. My first clouds were drawn by the sky pass the woods already had. Each pixel's view ray hit a flat layer 1,500 m up, and noise there decided where the clouds were. It was cheap and it worked, but when I looked at it, it was stale and static. A picture on a plane has no depth. It can slide sideways, but it can't be lit from behind, and a cloud edged in silver by a hidden moon is the whole point of a storm sky.

## Clouds, attempt two: a real volume

So I threw the layer away and made clouds that are actual volumes of fog-like material that the renderer marches through.

> **Concept: Ray-marching a density field.** Imagine the cloud as a huge box of "thickness" values: each point in space has a number saying how dense the cloud is there. To draw a pixel, you shoot a ray from the camera through that pixel and walk along it in small steps. At each step you look up the density, and you add up how much light the cloud there sends towards you. This walking is called *ray-marching*. It costs one sample per step, so you keep the step count small and the image half-size.

> **Theory: Beer's law.** How much light survives a trip through a cloud falls off exponentially with the thickness it passes through. Light that has gone through thin cloud mostly gets out. Light that has gone through twice as much cloud is not half as bright but *much* dimmer. Written down: transmittance = e^(-density × distance). The march keeps a running "how much light still gets through" number. Each step multiplies it down by Beer's law. Once it is almost zero, nothing behind can be seen, so the march stops early.

Where does the density come from? Two small 3D noise textures, made on the GPU the first time clouds are drawn. A big one gives billowy lumps carved into cells, which is the method behind the clouds in *Horizon Zero Dawn*. A small one frays the edges: wisps underneath, billows on top. A third, wider "weather" noise scrolls slowly and decides where clouds gather, so gaps open and close as the sky moves.

In practice:

- Every frame, at half resolution, each sky pixel's ray crosses a shell of cloud 1.5 km deep that wraps round the planet, in 56 steps.
- Where trees cover the sky nothing is marched at all.
- The result is blended with last frame's, which smooths out the march's noise.
- The moon lights each step through a short second march towards it. Thin edges facing the moon glow silver. Thick parts stay dark. The sky above lights the tops more than the undersides.
- The clouds also scroll up through their own noise, so they swell, split and dissolve instead of just sliding.
- Beyond 4 km they fade into haze, and the horizon itself is haze.

I put a "flash" into the clouds' lighting too: a point of light inside the cloud that lights the cloud around it, dimmed by whatever cloud lies between. It is unused today, but the lightning will drive it.

## Getting the look

My first try was real cumulus, but white and lit like a grey afternoon. Light bouncing around inside the clouds was too strong. Weaker scattering and twice the density gave dark bodies with bright edges, the right way round. Then the fine detail at 24 repeats per tile left popcorn blobs in the thin parts, so I dropped it to 14.

![Two early attempts at the volumetric clouds from above the trees](/images/2026-10-25-woods-at-night/cloud-tuning.jpg "Left: real cumulus, but lit like a grey afternoon. Right: dark bodies, but the edges are speckled.")

The colour was a stubborn problem. My night LUT kept a quarter of the colour and leaned blue, so no cloud setting could make the sky teal. I rebuilt it to lean teal, letting cold tones keep more of their colour while the torch stayed near white. I also caught a bug in my own tests: each test capture was 88% the previous capture's clouds, because of the history blend. A change to any cloud or moon setting now resets the history.

Here is the old flat layer against the new volume, at the gate and looking straight up through the canopy:

![Before and after: the flat cloud layer (left) and the volumetric clouds (right)](/images/2026-10-25-woods-at-night/flat-vs-volumetric.jpg "Top: the gate. Bottom: looking up through the trees. The new sky has a teal tint, darker bodies and real depth.")

![The gate at night with a moonlit, cloudy sky and the lit upstairs window](/images/2026-10-25-woods-at-night/gate-close.jpg "The gate from the path. The storm sky now sits behind the house, and the one lit window gives the eye a place to go.")

The cloud pass costs 0.08 to 0.35 ms, most of it when the view is mostly sky. The day woods, which have no clouds, are pixel-identical because the pass doesn't run there.

## Where it stood

I had a believable night, a torch, and a sky that looked like it could hold a storm. What was still wrong: the woods hide most of the sky, so the clouds show best at the gate and in clearings. The ground isn't moonlit, and whether the whole night should be brighter is a question I haven't settled. The torch also blows out any pale bush right in front of it. Next up: the moon, and making the clouds look less like cotton wool.

![The path's start by torchlight](/images/2026-10-25-woods-at-night/night-path-start.jpg "The start of the path at night. The torch lights a pool of mud and grass; the rest is almost black.")
