---
title: A night scene and ray-marched volumetric clouds
date: 2026-10-25
order: 1
summary: I build the woods at night, lit by a hand torch, and replace a flat painted sky with volumetric clouds that are ray-marched, lit by a moon and smoothed over time.
tags: outdoors, weather, renderer
cover: /images/2026-10-25-woods-at-night/gate-close.jpg
---

The woods were finished as a day scene: a muddy path, several hundred trees and bushes, a wrought-iron gate and a large house behind it, all in low afternoon light. I wanted to try weather next. The target is a stormy night with rain, with lightning that flashes inside the clouds and lights the trees, and a player who has only a torch.

I split the idea into seven steps in a plan (`Docs/TrackW-Plan.md`): the night, the clouds, the lightning, the rain, wet surfaces, sound and a final pass. This post covers the first two. The second took two attempts.

## The night scene

The night is its own scene file, `Demo/Woods/woods_night.entity_scene.json`, built by the same Python script as the day woods with a `--night` switch. The same seeds place every tree, so the path, the gate and the house are identical. It has its own light bake and its own benchmark file, which keeps the day scene's numbers unchanged.

What I changed from the day scene:

- **Sky.** There is no sky map. The sky is the dark clear colour seen through a cold haze, until the clouds exist. With no sky map, the probe bake that supplies ambient light falls back to the scene's ambient colours, which I set to a very dim blue-grey. Away from the torch, the woods are lit by almost nothing.
- **Sun.** It stays in the scene at intensity 0. In the lightning step it becomes the light source for a flash. It keeps its shadow cascades, so a flash will cast the trees' shadows across the path without an extra shadow pass.
- **Torch and air.** The player's hand torch is on and reaches 22 m. The fog is thicker and cold, with a blue-grey albedo.
- **Window.** One upstairs window of the house glows as if a lamp were on in the room. It gives the eye a destination beyond the gate. It is a new material on the house model with an emissive colour; the day scene sets the emissive to 0, so the window is only lit at night. A weak warm point light sits just outside the glass.
- **Colour grade.** A new look-up table, `re7_woods_night`, described below.

### How exposure works

A camera does not show scene luminance directly. It scales it by an exposure multiplier first. A physically based renderer expresses the setting as EV100, the exposure value at ISO 100, and converts it:

```
exposure = 1 / (1.2 * 2^(EV100 - compensation))
```

A lower EV100 means a more sensitive camera: the multiplier grows by a factor of two for each step down. Auto-exposure measures the frame and picks an EV100 so the average lands on a middle brightness. My implementation builds a histogram of log luminance on the GPU (64 bins), averages the bins between two percentiles so a few very bright or very dark pixels do not dominate, converts that average to an EV100 using a metering constant (K = 12.5), and moves the adapted value towards it over time. The result is clamped between a minimum and a maximum EV100.

The clamp matters at night. A metered average of a dark forest asks for a very sensitive camera, and an unclamped camera obeys, lifting near-black woods towards mid grey. A night scene should stay dark, so the lower clamp decides how dark the frame can be.

### What I saw and what I set

My first night render averaged a luma of 33 to 49 and read as dusk. Two causes:

1. The exposure floor allowed EV100 down to -6, so the camera brightened the woods.
2. The day scene's amber colour grade turned the haze tan.

![The first night render, too bright and yellow](/images/2026-10-25-woods-at-night/first-try-too-bright.jpg "The first attempt: the exposure floor lets the camera lift the woods, and the amber grade tints the haze.")

At -3, the value I use in the house, the torch spot peaked at only 93 of 255. I settled on -4.25. The exposure multiplier there is 1 / (1.2 × 2^-4.25), about 16. That figure explains the second problem I hit, the window. An emissive value that is invisible by day is multiplied by 16 at night, and an emissive of 0.15 clipped to white. I lowered it to 0.04, which gives a dim cream-amber.

### How a colour look-up table works

Colour grading is done at the end of the pipeline with a 3D look-up table. The table is a small colour cube, 32 entries on each axis in my case (stored as a 1024 by 32 strip image), indexed by the red, green and blue of the tone-mapped pixel. Each entry stores the colour the pixel should become. The shader samples the cube with trilinear filtering. Any colour transform that is a function of one pixel's colour (desaturation, a tint in the shadows, a shift of the highlights) can be baked into one table and applied for the cost of one texture sample.

The night table keeps about a quarter of the colour, leans the dark tones cold, and turns the torch's white towards a cold white instead of the day's amber. Letting warm tones keep their colour also caught the torch-lit bricks and turned them orange, so it now applies only to the brightest warm tones.

### Results

![The day scene against the night scene from the same three positions](/images/2026-10-25-woods-at-night/day-vs-night.jpg "The day scene (left) and the night scene (right) from the same three positions. The torch is the main light.")

| Pose | Day mean luma | Night mean luma | Night rows (top to bottom) | Night pixels under 20 |
|---|---|---|---|---|
| path start | 82.3 | 24.6 | 6 / 17 / 33 / 44 / 23 | 68% |
| gate close | 71.2 | 16.6 | 19 / 15 / 23 / 17 / 10 | 73% |
| gate far | 52.2 | 25.6 | 17 / 41 / 30 / 27 / 14 | 72% |

The night is also cheaper than the day at every one of the 11 benchmark poses (GPU time at 1440p, no TAA, RTX 4070): path start 9.50 ms against 8.93 ms, gate close 6.33 against 5.89, up at the canopy 7.24 against 6.09. Almost all of the saving is the fog, which falls from 0.8 ms to 0.16 ms because a sun of intensity 0 has no light shafts to march.

![The start of the path lit by the torch](/images/2026-10-25-woods-at-night/night-path-start.jpg "The torch at the start of the path. Everything outside its cone is close to black.")

## Clouds, first attempt: a flat layer

A storm needs clouds, and the lightning step needs something for a flash to light from inside. My first version used the sky pass the woods already had, with no ray marching. Each sky pixel's view ray was intersected with a flat plane 1500 m up, and layered noise at that point gave the cloud shapes, with finer noise for lumps on the undersides. The clouds drifted with the scene's wind at 12 m/s. A flash was a soft patch of extra light around a direction.

After fixing a double division by the ray's height that smeared everything towards the zenith, and reducing the cloud size from 3000 m to 900 m, the result still looked like a texture on a ceiling. I compared it to a night reference frame I had picked from Resident Evil 7: large dark storm clouds with silver edges, a moon behind them, its glow showing through thin parts, over a teal sky. A flat noise pattern cannot do this for three reasons. It has no thickness, so it cannot be lit from behind. Its brightness has no relationship to how much cloud the light passes through. And it can only slide sideways, never change shape. I replaced it with a volume.

## How volumetric clouds work

### The cloud as a density field

A cloud is not a surface. It is a region of space where water droplets are suspended, and the quantity that matters is how many droplets there are per unit volume at each point. A renderer represents this as a density function `d(p)`, a number from 0 (clear air) to 1 (the densest cloud), defined for every point `p` in a layer of sky.

The function comes from noise. Perlin noise is smooth and gives soft, rounded lumps. Worley noise (also called cellular noise) assigns a random feature point to each cell of a grid and returns the distance from a point to the nearest feature. Inverted, it gives bumps with rounded tops and sharp valleys between them, which looks like the billows on a cumulus cloud. The standard shape noise, used for example in Horizon Zero Dawn's clouds, is Perlin-Worley noise: Perlin noise remapped so that Worley cells carve into it. A second, finer noise erodes the edges, which gives wisps under a cloud and billows on top. Both are 3D textures that tile, so the cloud can be sampled anywhere without a visible repeat.

A coverage value remaps the noise so that more or less of the sky is above the threshold at which density becomes non-zero, and a height profile fades the density to zero at the bottom and top of the layer, which gives flat bases and rounded tops.

### Ray marching

To draw the cloud, the renderer fires a ray from the eye through each pixel, finds where the ray enters and leaves the cloud layer, and walks along that segment in steps. At each step it samples the density and accumulates light. This is ray marching. The cost is the number of pixels times the number of steps times the cost of one density sample, which is why clouds are a heavy effect and why most implementations trace them at reduced resolution.

### Absorption: the Beer-Lambert law

Light travelling through a medium is attenuated exponentially with the amount of medium it crosses:

```
T = exp(-sigma * d * length)
```

`T` is the transmittance, the fraction of light that gets through. `sigma` is the extinction per metre at density 1, `d` is the density, and `length` is the distance travelled. Doubling the thickness squares the transmittance rather than halving it, which is why a thin cloud edge is translucent and a thick core is opaque.

In the march, each step has its own transmittance, and a running total is multiplied by it. The light scattered towards the eye in that step is added in proportion to how much the step absorbed, scaled by the transmittance that survived to reach it:

```
scattered += transmittance * light * (1 - stepTransmittance)
transmittance *= stepTransmittance
```

When the running transmittance falls below a small threshold the march stops, since nothing further back can show through.

### Lighting each step: phase function, light marching and powder

At each sample the renderer must decide how much light scatters towards the eye. Three pieces make up that estimate.

**The phase function** describes in which direction a droplet scatters light. Cloud droplets are strongly forward scattering: most light continues close to its original direction. The Henyey-Greenstein function is the usual approximation:

```
phase(cos) = (1 - g^2) / (4 * pi * (1 + g^2 - 2 * g * cos)^1.5)
```

`cos` is the cosine of the angle between the light's direction and the view direction, and `g` between -1 and 1 sets the shape. With `g` near 0.8 almost all the light goes forward, so looking towards the moon through a cloud's edge, the edge glows. That is the silver lining visible in the reference frame. I mix a forward lobe (g = 0.8) with a weak backward lobe (g = -0.25) at a 30% share.

**Light marching** estimates how much light reaches the sample at all. From the sample, a second short march goes towards the light and accumulates density, which gives the optical depth between the sample and the light. The Beer-Lambert law turns that into a transmittance. This is what gives a cloud self-shadowing: the side facing the light is bright, and a thick core is dark. I use five light steps, with segments that start at 6% of the layer's thickness and grow by a factor of 1.8, and I sample only the coarse density, without the fine detail, because the light march needs the overall thickness rather than the edges.

**Multiple scattering and powder.** Light in a real cloud bounces many times. With only single scattering, thick clouds come out too dark. A cheap approximation (from Wrenninge's work) sums a few octaves, each with half the extinction and half the phase anisotropy of the last, and each contributing a fraction of the previous one's weight. I use three. The powder effect handles a related darkening: a thin edge seen from the side facing away from the light has not had much light scattered into it yet, so it looks darker than the single-scattering model predicts. I apply a factor that darkens low-depth samples when the view is not towards the moon, and leave it off when looking at the moon so the silver lining stays.

### Making it affordable: low resolution and temporal reprojection

A march of dozens of steps per pixel with a light march at each step is too expensive at full resolution. Two measures bring it down.

1. The march runs at half resolution.
2. Each pixel's start position along the ray is jittered by a different amount every frame, and the result is blended into the previous frame's result. Jitter turns the banding of a fixed step count into noise, and the blend averages that noise away over several frames.

The blend needs the previous frame's value for the same part of the sky. For clouds this is simple, because they are so far away that the camera's steps do not move them; only its rotation does. The shader takes the view direction, transforms it with the previous frame's view-projection matrix as a direction (no translation), and reads the history texture there. In my implementation, 12% of each frame's result is blended in and 88% comes from history. This makes the image smooth, and it is also the reason that anything that changes quickly, like a lightning flash, needs a higher weight (I use 0.6 while a flash is active) or it lags.

## My implementation

The code is in `Clouds.hlsl` and `DX12Renderer.Clouds.cpp`.

- **Noise.** Two tiling 3D textures, generated on the GPU the first time clouds are drawn: shape (128³, with Perlin-Worley in one channel and three Worley octaves in the others) and detail (64³).
- **Layer.** A shell 1.5 km deep wrapped around a planet of radius 6360 km, so the layer curves away to the horizon. Each ray is intersected with the two spheres. The march uses 56 steps.
- **Skipping covered pixels.** Where trees fill the pixel, nothing is marched and the pixel keeps last frame's value. The woods hide most of the sky, so this saves most of the cost.
- **Movement.** The shapes drift with the wind. The noise also scrolls up through itself (`cloudEvolve`), so the clouds swell, split and dissolve as they move. A wider, slower "weather" noise decides where clouds gather, which opens and closes gaps.
- **Lighting.** The moon (`sky.moon*`) lights each step through the light march. The sky above lights the tops more than the undersides. A flash is a point light inside the layer, dimmed by the cloud between it and the sample.
- **Horizon.** In the distance the clouds fade into haze, and the horizon itself is haze.
- **Composition.** The march writes light and transmittance into a texture, and the sky pass composites the clouds over the sky with it.

## Tuning

The sequence of mistakes was useful.

- **First render.** Real cumulus, but white and lit like an overcast afternoon. Light bouncing around inside the clouds was too strong. Weaker scattering and twice the density gave dark bodies with bright edges.
- **Colour.** The night LUT kept a quarter of the colour and leaned blue, so no setting could make the sky teal. It now leans teal, with red reduced and green and blue raised, and cold tones keep more of their colour. The torch stays near white.
- **Stale history in tests.** Each test capture was 88% the previous capture's clouds. A change to any cloud or moon setting now resets the history.

![Two early attempts viewed from above the trees](/images/2026-10-25-woods-at-night/cloud-tuning.jpg "Left: clouds lit like daytime overcast. Right: dark bodies, but speckled edges.")

## Results

Against the reference frame, measuring only the sky in the upper middle of a 960 by 540 crop:

| | Mean luma | 5th percentile | 95th percentile | Mean RGB |
|---|---|---|---|---|
| Reference frame | 99 | 64 | 166 | 79, 104, 112 |
| My render, above the trees | 115 | 65 | 181 | 87, 121, 134 |

The brightness distribution is close, and the sky is slightly brighter and bluer than the reference. The renders below show the old flat layer on the left and the volumetric clouds on the right, at the gate and looking up through the canopy.

![The flat cloud layer (left) and the volumetric clouds (right)](/images/2026-10-25-woods-at-night/flat-vs-volumetric.jpg "Top: the gate. Bottom: looking up through the canopy. The volumetric clouds are darker and have structure.")

![The gate with the volumetric clouds and the lit window](/images/2026-10-25-woods-at-night/gate-close.jpg "The gate at night with clouds, a first version of the moon's glow and the lamp lit upstairs window.")

Cost, at 1440p, no TAA, RTX 4070:

- The cloud pass costs 0.08 to 0.35 ms. The highest value is at the pose looking up at the canopy, where most of the frame is sky.
- The night woods with the clouds against the same scene without them differ by 0 to 0.7 ms. Two runs of the same build varied by up to 0.5 ms with the GPU at its power cap.
- The day woods are pixel-identical to before, because the pass does not run without clouds.

Verification: `ctest` passes 114 of 114. `SkyRenderTests` covers clouds without a sky map, a flash ahead against a flash behind (123 against 114 mean luma), a moon ahead against a moon behind (60 against 29) and unchanged bakes.

## Open issues

- The woods hide most of the sky. The clouds show best at the gate and in clearings.
- The ground is not moonlit. In the reference it is, faintly teal. My frame mean is 15 to 27 against 56 for the reference, and whether to raise the whole night is a decision I have not made.
- The moon is still a small dot in the cloud pass. It is replaced in the next post.
