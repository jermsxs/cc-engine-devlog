---
title: Temporal anti-aliasing and volumetric fog
date: 2026-09-28
order: 7
summary: Jittered TAA with motion vectors and history clipping, then a froxel fog volume lit by the lamps and flashlight and smoothed over time.
tags: renderer, post-processing, lighting
cover: /images/2026-09-28-taa-volumetric-fog/fog-final-and-fog-only.jpg
---

Two problems remained after ambient occlusion and reflections. Every edge in the hallway was a staircase: the trim, the door frames, the sconce shades. The shadow filter, the AO and the reflection rays also used fixed noise patterns that could not be averaged away. The air was empty too. The old fog mixed every pixel toward one dark colour by distance and knew nothing about lights, so it could not produce the look of a Resident Evil room, where lamps glow in the air and the flashlight lights the dust in front of you.

Both fixes use the same idea. Spend a small amount of work on each frame and combine the results over time.

## Temporal anti-aliasing

### Why edges alias

The renderer takes one sample per pixel, the colour at the pixel's centre. An edge that crosses a pixel gets rounded to one side, and a diagonal line becomes a staircase. The cure is to ask more questions per pixel and average. Supersampling does that by rendering at a higher resolution, which is too expensive. Multisampling smooths only geometric edges and does nothing for specular shimmer or the noise from my shadow and AO filters. Temporal anti-aliasing (TAA) takes the extra samples over several frames.

### Jitter

Each frame the camera's projection is shifted by less than one pixel, following eight offsets from a Halton sequence in bases 2 and 3. The shift is applied as a translation in clip space, `clip.xy += offset · clip.w`, which moves everything on screen but leaves depth untouched. Over eight frames every pixel has been sampled at eight different positions inside its area. Averaging them gives the anti-aliased value.

### Motion vectors and reprojection

The average has to survive movement, so the renderer needs to know where each surface was in the previous frame. A *motion vector* is the difference between a surface point's screen position now and last frame. The depth prepass writes one per pixel. It is computed from the camera's previous un-jittered view-projection matrix and, for moving objects such as doors, from each object's previous world matrix, which the renderer remembers per entity. Tests check the cases: zero for a static scene under jitter, the exact projected difference for a sideways camera move, and the expected distance for an object moving down.

The resolve pass then fetches the history at `uv − motion`, which is *reprojection*, and blends it with the current frame. A new-frame weight of 0.1 gives an exponential moving average. For independent noise that reduces variance as much as averaging about 19 frames.

### Why TAA goes wrong

Reprojection assumes that the history at the old position shows the same surface. Where it does not, the result is wrong:

- **Ghosting.** An object moves and its old colour stays behind as a trail, because the history there was not replaced.
- **Disocclusion.** Surface that was hidden last frame has no valid history at all.
- **Blur.** The history is resampled with a filter each frame, and small blurs add up when the image moves.
- **Flicker.** A very bright pixel next to a dark one dominates any average.

### My resolve pass

The resolve works at full resolution after the reflections are composited and before exposure and bloom. For each pixel:

1. **Nearest-surface motion.** It looks at the 3 × 3 neighbourhood and uses the motion of the nearest surface, so that an edge moves with the foreground object and not the background.
2. **History fetch.** It reads the history with a 5-tap Catmull-Rom filter, which stays sharp under sub-pixel motion.
3. **Rejection.** The history alpha stores the view depth. If last frame's depth at the reprojected position differs from this pixel's by more than 10% plus 10 cm, or the position is off screen, the history is discarded.
4. **Neighbourhood clipping.** It computes the mean and standard deviation of the 3 × 3 neighbourhood of the current frame, in YCoCg colour space. It then pulls the history toward the mean until it lies inside a box of 1.25 standard deviations. Colours the current frame can no longer justify fade within a frame or two. YCoCg separates brightness from colour, so the box is tight around both.
5. **Tone-weighted blending.** Colours are blended as `c / (1 + luma)`, so a bright lamp next to a dark wall neither smears nor flickers.
6. **Sharpen.** A light cross-shaped sharpen in the final pass gives back some of the crispness the averaging removes.

Each 16 × 16 thread group loads its pixels plus a one-pixel border once into on-chip memory and shares them, so the 3 × 3 neighbourhood costs no extra reads. That changed the resolve from 0.245 to 0.195 ms with an identical result. I had hoped for half, but most of the remaining time is the history read.

![The baseboard at 3 times zoom, jagged without TAA and clean with it](/images/2026-09-28-taa-volumetric-fog/edges-before-after.jpg "Left: without TAA, a staircase edge. Right: with TAA, a clean edge, and the plaster keeps its texture.")

### Noise that moves

Once frames are averaged, other effects can use that. The shadow filter, the AO sampling and the reflection rays now take a new random pattern each frame, from interleaved gradient noise shifted by 5.588 pixels per frame, and TAA averages it out. Reflection rays now scatter across the floor's gloss in proportion to its roughness, as light does, instead of being blurred afterwards. I did not build separate histories for AO and reflections. Their noise moves every frame, and the main history averages it along the same motion vectors.

The history resets whenever the camera jumps. Each benchmark pose therefore sees the same frames on every run, and two runs gave identical screenshots.

### Testing ghosts and blur

TAA is tested by moving. I opened the closet door while panning the camera at 25° per second, with and without TAA. There are no trails behind the door frame or the lamps.

Softness in motion was the other weakness. I measured it on the plaster beside a lamp, with grain off, as mean edge strength:

| Setup | Still | 20°/s pan |
|---|---|---|
| No TAA | 0.122 | 0.132 |
| TAA, first version | 0.113 | 0.100 |
| TAA, after the fix | 0.113 | 0.119 |

Raising the sharpen only over-sharpened still images first. The fix was to give the current frame more weight where pixels move: from 0.1 to 0.35, reached at 3 pixels of motion per frame. Still images are unchanged and edges stay smooth in motion. The tuning trades ghosting against blur. More history is smoother and blurrier, and a tighter clip box reduces ghosts but lets more flicker through.

![Plaster during a 20 degree per second pan: no TAA, TAA before, TAA after](/images/2026-09-28-taa-volumetric-fog/taa-motion-sharpness.jpg "Plaster during a pan, zoomed. Left: no TAA. Middle: the soft first version. Right: close to the left one's detail, without its jagged edges.")

One more fix concerned pixels with no geometry, such as the empty void around a level in the editor. They had no motion vector, so their history stayed in place while the camera turned. They now reproject the far-plane point behind them. The hallway has no such pixels, so its benchmark did not change.

## Volumetric fog

### How light moves through fog

Air with dust or mist contains particles that interact with light. A ray crossing a *participating medium* loses some light by absorption and some by scattering out of the ray. Together that is the *extinction* `σt`, per metre. For a uniform medium the fraction that survives a distance `d` follows the Beer–Lambert law:

```
transmittance = exp(−σt · d)
```

Scattering also adds light, because particles scatter light from lamps toward the eye. That is the glow around a lamp and the visible flashlight beam. At each point along the view ray, the added light is the scattering coefficient times the light that arrives there, weighted by a *phase function* that says how much is scattered at each angle. I use the Henyey–Greenstein function:

```
p(θ) = (1 − g²) / ( 4π · (1 + g² − 2g·cosθ)^1.5 )
```

Here `g` is the anisotropy. It is 0 for scattering equally in all directions, and positive when scattering mostly continues forward. A test confirms that it integrates to 1 over the sphere. Total fog light for a pixel is the sum over the ray of the scattered light at each point times the transmittance back to the eye, and the surface behind is dimmed by the transmittance of the whole ray.

### A grid in front of the camera

To evaluate that I need the density and the light at many points on every view ray. A 3D grid aligned to the screen does this well. Its cells are called *froxels*, frustum voxels.

![The fog volume from above, with depth slices that get thicker with distance](/images/2026-09-28-taa-volumetric-fog/froxel-slices.svg "Slices are spaced exponentially in depth, so detail is spent near the camera.")

My grid is 160 × 90 × 64 cells, 921,600 in all. Each is about 16 × 16 pixels at 2560 × 1440. Slice boundaries lie at `0.1 m · (30 / 0.1)^(k/64)`, so each slice is about 9.3% deeper than the one before, out to 30 m. At 1 m a cell is 9 cm deep and at 10 m about 93 cm. Low quality uses 80 × 45 × 32 cells in a corner of the same textures, so switching quality never reallocates memory. The textures cost 22 MB.

### The three passes

1. **Injection.** One thread per cell computes the density at a sample position inside the cell and the light scattered toward the eye there. Density is a constant, plus height fog that is thickest at the floor and decays with height, plus dust: two octaves of drifting 3D noise, so the haze is patchy. The light is the ambient term plus every lamp and the flashlight in range. Each uses the same windowed falloff and spot cone as the surface shader, the same shadow maps, and the phase function. The result is stored as RGBA16F: scattered light in RGB and extinction in alpha.
2. **Temporal blend.** The sample position moves inside the cell every frame. The new value is blended into last frame's cells, reprojected with the previous view-projection matrix, at 8% per frame. Over several frames each cell averages its whole volume. A coarse grid turns into smooth haze without banding. It is the TAA idea applied to a 3D grid.
3. **Integration.** One thread per screen column walks the slices from the camera outward and accumulates `scattered += T · light · (1 − exp(−σ·d)) / σ`, then `T *= exp(−σ·d)`. The integral is solved exactly inside each cell, so a constant fog is right whatever the slice depth is. A test compares constant fog with the closed-form answer at three densities and on off-centre rays.

The scene shader then reads the result at each pixel's depth, with trilinear filtering, and computes `colour = colour · T + scattered`. Shadows inside the fog use one comparison tap per light, with no soft filter. A froxel is much larger than a shadow texel, and the temporal blend of jittered samples does the filtering.

![The final image on two corridor poses, and below it the fog alone](/images/2026-09-28-taa-volumetric-fog/fog-final-and-fog-only.jpg "Top: the final image. Bottom: the fog alone, with a halo around each sconce and the corridor falling into haze.")

### Choosing the look

My plan called for strongly forward-scattering dust, `g = 0.6`. The flashlight beam then disappeared. The flashlight sits almost at the eye, so its light has to scatter nearly straight back to reach the camera, at an angle of 180°. Setting `cosθ = −1` in the phase function gives `(1 − g) / (1 + g)²` times the isotropic value. That is 0.16 for `g = 0.6`, under a sixth of what an even scatterer returns, and 0.26 for `g = 0.45`. At 0.45 the beam reads, and the sconces still get a forward glow.

Denser fog looked more atmospheric in a still image but lifted the blacks toward grey and washed out the floor's reflections. I settled on a light haze: a constant density of 0.025 per metre, dust at 0.1, height fog at 0.03 and an ambient share of 0.4. The constant part alone still lets 78% of the light through over 10 m (`exp(−0.25)`). The old distance-fog settings still load from older scenes, with one log line, and are dropped on the next save.

![The six benchmark poses with volumetric fog](/images/2026-09-28-taa-volumetric-fog/bench-after.jpg "The six poses after the fog: lamps glow in the air, the far end of the corridor falls into haze, and the blacks stay black.")

## Results

The fog passes take 0.1 ms on an RTX 4070: density 0.02, lighting 0.06 and integration 0.02. That is about 0.2 ms on an RTX 3060 by my estimate, far inside the 1.5 ms budget. The rest of the extra time is in the scene pass, which now reads the fog volume at every pixel. The TAA resolve is cheaper than before, even with the background fix.

| Pose | GPU frame before fog | after | TAA resolve before | after |
|---|---|---|---|---|
| south_start | 1.96 ms | 2.15 ms | 0.25 ms | 0.21 ms |
| north_corridor_long | 1.90 ms | 2.08 ms | 0.24 ms | 0.22 ms |
| north_locked_door | 1.78 ms | 1.88 ms | 0.22 ms | 0.18 ms |

All numbers are from a Debug build at 1440p. The TAA work adds about 0.4 ms to the frame before the fog.

## Open issues

- The fog is patchy haze and not individual specks. Cells are about 16 pixels wide, so single motes would need a particle system, which is a later job for the GPU compute side.
- The fog history reprojects by camera motion only. A door swinging through a beam would update its shadow in the fog a frame or two late. At this density I cannot see it.
- A cell behind a wall can be lit by a lamp on the other side if that lamp has no shadow map. The composite reads only up to the visible surface, so it has not appeared.

The renderer now has shadows, AO, reflections, TAA, fog and a camera chain, all inside the time budget. The next constraint is memory.
