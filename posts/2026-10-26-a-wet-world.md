---
title: Rain as a camera sees it, and a wetness model for porous ground
date: 2026-10-26
order: 1
summary: I rebuild the rain as short soft streaks that refract the scene, then add wetness that darkens porous surfaces, a water film, and puddles that follow the ground's relief and painted ruts.
tags: weather, materials, renderer
cover: /images/2026-10-26-a-wet-world/flash-puddles.jpg
---

The first rain from the previous post worked technically, but it did not look like rain. The drops were white lines. The splashes on the ground moved with the player as I walked. And the ground stayed dry under the water falling on it. I compared the result with three rain reference frames: a city street in heavy rain, wet asphalt at ground level, and a night street whose pavements mirror the lights. In all three you know it is raining because everything is wet. The streaks themselves are faint and short and easy to miss.

I rewrote the plan in `Docs/TrackW-Plan.md` around that observation. This post covers the falling rain first, then the wet surfaces.

## Rain that looks like a camera recorded it

### What a camera does to a raindrop

Two optical facts decide how rain looks in a photograph.

**Motion blur.** A drop falls at about 9 m/s. In a 1/60 s exposure it moves 15 cm, so the sensor records a streak, and its brightness is the drop's brightness spread along that length. A short exposure gives a short faint streak, and a long one a longer streak. The streak's brightness is not that of a point: the same light is smeared over many pixels, so it is faint.

**Refraction.** A drop is a tiny lens. Light from behind it is refracted through the water, so the drop shows the scene behind it, bent and inverted, rather than a flat white mark. It also reflects the lights and the sky, which gives a glint where a light is in the right place. A drop in front of dark foliage is nearly invisible. A drop in front of a bright lamp shows the dark beside it.

**Depth of field.** A real lens has a focus distance. A drop much closer than that is out of focus: its light spreads over a wider area, so the nearest drops are wide and faint, not the sharpest and brightest marks in the frame.

My first version had none of this. Each streak was a bright additive line, and the nearest ones were the brightest.

### What I changed

- **A bug in the phase function.** A drop's light is weighted by a phase function, the same way the fog's is. Its sign was flipped relative to the fog's. The torch shines from behind the eye, which counted as light scattered forward, the strongest case. Torch-lit drops came out about nine times too bright, while lamps beyond the rain, which should make drops glint, were dimmed.
- **Streaks as the camera records them.** There are four times as many drops (131,072 in the box round the player), and each streak is short: 0.14 m, about a 1/60 s shutter at 9 m/s. Each is soft, a bell-shaped profile across and an even brightness along, with soft ends. The post pass eases how much one streak can lift a pixel, so a drop in the torch beam reads as a grey line instead of a white wire.
- **Refraction.** The streak quad is drawn at least one pixel wide. In its pixel shader, each side of a streak samples the lit scene a few pixels toward its other side, which is the lens effect, plus a little of what is above it, since a drop shows the sky upside down. The bend is larger for near drops (up to 24 px). The shader adds the glint of the torch, lamps and lightning on top. The target therefore stores what the rain changes, not what it adds, and can be negative: a drop over a bright spot can darken it. The rain target is RGBA16F.
- **Defocus.** Drops closer than 1.5 m spread their light over a wider streak, up to 4 px at 0.75 m. The brightness is divided over the larger area, so near streaks are soft and faint.
- **Rain sheets.** Beyond the drops' 28 m box there was only fog. Four cylinders of falling streak columns, at 16, 23, 33 and 47 m, fill the gap. They sit behind whatever is in front of them, test the shelter map so that they stop under roofs, fade with the fog, and light up with the lightning. In the dark they barely show. In a flash the gaps between the trees fill with rain.
- **Brightness.** With refraction carrying the look, the scene's rain brightness went from 0.4 to 0.25.

![The rain before and after the streak changes](/images/2026-10-26-a-wet-world/rain-before-after.jpg "Left: long bright streaks. Right: four times as many drops, short, soft and fainter.")

### Splashes that stay in the world

Each splash slot used to pick a random point round the camera, so the whole field of splashes moved with the player. Now the ground is a grid of 25 cm cells. Each slot is responsible for one cell of a square round the camera, and a cell splashes at a spot that depends only on the cell and the moment. Walking changes which cells are looked at and never where a splash is. The droplets in a splash take their directions from the splash's position and not from its slot, so a crown does not reshuffle when its cell changes slot.

A splash is a crown of six droplets thrown up and out on short arcs, 1 to 5 cm high and down again within a fifth of a second. Each droplet is a 2 mm streak blurred over a sixtieth of a second, at half the drop's light. These replaced the flat white rings.

To prove that splashes stay put I rendered the same moment from two positions 0.6 m apart, looking straight down, lit by a flash, with the torch and post effects off. I rendered once with splashes and once without, so the difference is the splashes alone. Shifting the second image by the ground's movement lays the same crowns on the same spots.

![Splash rings before and crowns after](/images/2026-10-26-a-wet-world/splashes-close.jpg "Left: flat white rings. Right: small droplet crowns.")

The first pinning test gave different rain in two runs that should have matched, because `--fixed-dt` stepped the world by frames but the shaders still read the wall clock. It now steps their clock by frames too.

### Fainter rain

My next pass against the references showed that the streaks were still too visible. I lowered the night woods' rain amount from 0.8 to 0.5 (65,536 drops instead of about 105,000) and made the post pass ease a streak's lift above 0.06 instead of 0.15. I measured the lift with and without rain at each pose, with TAA:

| Pose | Before: covered, p95 lift | After: covered, median, p95, max |
|---|---|---|
| path start | 5.0%, 83 | 2.2%, 25, 43, 98 |
| clearing | 5.5%, 84 | 3.4%, 19, 43, 161 |
| gate close | 5.3%, 83 | 3.4%, 20, 43, 91 |

The rain covers about half as much of the frame and a typical streak lifts a pixel about half as much. Easing too hard made the rain vanish (0.04 was too low).

The rain itself costs +0.14 to +0.41 ms at 1440p on an RTX 4070, about +0.18 ms typical.

## How wet surfaces look, and how the model works

### The physics

A dry porous surface, such as soil, bark or plaster, scatters light diffusely from a micro-structured surface. When water soaks into the pores it fills the gaps. Light entering the wet material is trapped more effectively: at the boundary between the material and air above the water, much of it is reflected back inward and absorbed on its way out. The surface looks darker, more saturated and less diffuse. This is the darkening in a wet road or a wet beach.

If the surface is wet enough for water to lie on top, a second effect appears. The water forms a thin smooth film. Its top face is optically smooth, so it reflects light specularly. With a refractive index of about 1.33, a smooth water surface reflects roughly 2% of the light at normal incidence (the Fresnel reflectance F0 ≈ 0.02) and almost all of it at grazing angles. A road at night mirrors lights at a distance because it is seen at a grazing angle. Under the film, the underlying surface also looks smoother, because the water fills the roughness of the surface.

A third effect is where water collects. It lies in the lowest places, in the ruts, hollows and gaps between stones, and runs off higher ground, so a wet surface is patchy, and standing water has crisp edges where the water level meets the ground.

### My model

For the physically based shading, a wet point changes three of the material inputs: albedo, roughness and the normal. The shader (`Wet.hlsli`) works out how wet the point is and then how the material responds.

**How wet the world is.** One number from 0 to 1. It rises while it rains (from dry to soaked in 5 minutes at full rain, slower in light rain) and falls once the rain stops (half an hour). Scripts can read and set it: `Weather.Wetness = 1` soaks everything at once. The night woods start soaked.

**Which points the rain reaches.** The shelter map the rain already uses (the fixed scene seen from straight above, near the player) says what is under cover. A second, coarser map covers 256 m round the player. Tops get the full wetness, walls a little less, and a point under a roof stays dry.

My first shelter lookup treated every thin branch overhead as a roof, which left blocky dry stripes under the trees. Rain drips off a branch and blows in under a roof's edge, so only broad cover should keep a surface dry. A covered point now also tests four points 0.6 m to each side, and counts as open if any of them is. Computing this on every pixel was expensive, so a small compute pass bakes the erosion (each texel takes the deepest of itself and the texels 0.6 m away) whenever a map is redrawn.

**Porosity.** Each material has a value from 0 to 1 for how much water soaks in: earth 0.9, bark 0.8, plaster 0.7, tile 0.05, painted iron 0.1. Materials without a value get one by kind (metal and glass 0, leaves 0.3, everything else 0.6). It is stored in the material library and as a glTF extra.

**Darker albedo.** Albedo is multiplied by `lerp(1, WetDarkening, wet × 1.5 × porosity)`. `WetDarkening` is 0.4, so fully soaked porous ground drops to 40% of its dry colour. The pores fill first, so this happens early as the wetness rises.

**The water film.** After the pores are full, a film forms. Where it forms is decided by a "collect" value, a mix of how low the point lies in the material's relief and a patch noise a metre or two across:

```
collect = 0.3 * low + 0.7 * patchNoise
film = saturate((wet * reach - collect) * 4)
roughness = lerp(roughness, min(roughness, smoothest), film)
normal    = normalize(lerp(normal, geometricNormal, film * flatten))
```

On stone or iron, which soak up nothing, the film soon covers everything. On earth it covers only patches. Under the film the roughness drops but never below a cap: 0.35 on non-porous surfaces and about 0.5 on earth. The cap is mine. I prefer matte surfaces and I do not want wet ground to look like plastic. The film also blends the normal towards the geometric normal, which flattens the grain of the normal map.

**Puddles.** Where the water is deeper, in the lowest places of level ground, it stands. The water level rises with the wetness, and a point is under water if the level is above the point's "pool" height:

```
level  = wet * puddleLevel
pool   = 0.65 * low + 0.35 * noise
puddle = saturate((level - pool) * 12) * levelGroundMask
```

The multiplier of 12 makes the edge crisp. In a puddle the roughness is 0.04, which makes the water near-mirror, and the normal is the flat water surface plus ripples while it rains. Mirror water is the one exception to my matte preference, and I allow it on level ground only. Screen-space reflections are enabled in the night woods, but only for this near-mirror water (`maxRoughness` 0.2).

**Ripples.** In each 25 cm cell of the ground, a drop lands now and then at a hashed spot and a ring runs out from it, fading as it spreads. Two offset layers let the rings overlap. A ring's slope, the derivative of a narrow bump, tilts the water's normal.

**Leaves** only darken and, later, carry beads (a later post). Scenes without rain are unchanged: at wetness 0 the function returns at once, and the hallway, house and kitchen render exactly as before.

### Problems on the way

**Frost, not water.** My first film covered all the ground with a smooth layer that caught a flash on every grain of the relief. In a flash the woods looked frosted. With the film turned off, the darkening alone looked right, so the film was the cause. The film now reaches only patches on porous ground, is less smooth, and flattens the normal map under it, so a flash shows broad wet patches instead of glitter.

![A flash on the ground, with the first film and with the corrected film](/images/2026-10-26-a-wet-world/frost-fixed.jpg "Left: the first film glitters on every grain, like frost. Right: broad wet patches.")

**Snow in a flash.** The first puddles were dark and the film covered almost all the ground. In a flash the film's reflection of the lightning turned the clearing white, and with the canopy's dappled shadow it looked like snow. Making the lightning's source wider (up to 90 degrees, with 30 degrees for the night's lightning) was not enough alone. The film covers patches on porous ground, the puddles darken the ground less (0.75), and a flash shows glistening patches and bright puddles.

**Cost.** The first version cost 0.6 to 1.1 ms. Switching parts off showed that the shelter maps cost nothing measurable. The cost was the film's two 3D noises, paid on every pixel of a frame full of leaves. The film now uses one 2D noise over the ground, leaves return before it, and the shelter lookup is one hardware comparison sample per map instead of four taps.

![The path ground, dry and soaked](/images/2026-10-26-a-wet-world/dry-vs-soaked.jpg "Torch light on the path: dry (left) and soaked (right). The soaked ground is darker with a faint sheen.")

### Painted puddles and the physics of the torch

Until now, water stood wherever the mud's relief and a noise pattern happened to dip. Real tracks hold water in their ruts and hollows, where wheels and feet have pressed the ground down. The level script now paints those places into the terrain's vertex colour. Red and green were already the dirt and mud layers. Blue marks where water gathers, and a material flag, `vertexPuddles`, tells the shader to read it as puddle paint (on imported meshes, blue means grime, which ignores it). There, puddles fill almost to the brim (level 0.95 instead of 0.5). The relief and the patch noise still break up the edges. Shipping games with heavy rain use vertex paint in the same way, so that an artist can say "water here".

The ruts run 0.62 m either side of the path's middle. A noise turns them on and off in stretches a few metres long and wobbles their edges. The ground's grid is 0.4 m, so a rut is painted 0.5 m wide and fades over as much again. In all, 42% of the path's vertices are painted. My first version painted bands narrower than the grid, so only about 1,200 of 72,000 vertices carried any paint and nothing reached the screen. A debug view (red for paint, green for open to the rain, blue for level ground) made that visible.

![Ruts in a flash, without and with paint](/images/2026-10-26-a-wet-world/ruts-flash.jpg "Left: no puddle paint. Right: painted ruts hold water that mirrors the sky.")

By torchlight, water and soaked mud are both dark. In a flash the ruts mirror the sky.

The torch shows little sheen on wet ground, which is correct. For a point light at the eye, the specular highlight needs a surface normal pointing at the eye. Level ground seen from head height faces up, so the reflection of the torch goes away from the camera. Wet ground in torchlight alone looks darker and dull. Glints come from the lightning, the lamplit window and what the puddles mirror. A lamp near the ground, such as a porch light, would show wet ground best.

![A flash on the clearing before and after the wetness changes](/images/2026-10-26-a-wet-world/flash-puddles.jpg "Left: a bright film over most of the ground. Right: darker mud with water sheets in the ruts and dips mirroring the sky.")

## Results

Soaked ground is darker in the torch at every pose. At the path start the mean frame brightness goes from 25.2 dry to 19.0 soaked, and at the clearing from 16.6 to 13.1. The gate's view is mostly sky and foliage, which change little (19.4 to 18.5). In a flash at the clearing the 99th percentile goes from 146 to 176, because the puddles mirror the flash.

Cost on the GPU at 1440p, no TAA:

- **Rain against none:** +0.09 to +0.37 ms in the earlier rain pass, with four times the drops.
- **Soaked against dry:** about +0.33 ms typical after the second pass, with the plan allowing 0.1 ms. Cutting it is the subject of the next post.
- **Walking with a quick turn:** soaked 9.10 ms against 8.82 dry, worst frame 14.0 against 13.8 ms.
- **Painted puddles:** every pose within noise, from -0.8 to +0.9 ms, because the paint is one extra lerp.

Tests (`ctest` 116 of 116): `RainRenderTests` shows the open side of a roof test gaining 2.06 million levels against 105 under the roof, with splashes on the open floor and none under the roof, and the soaked open floor darkening by 15.8% against 0.008% under the roof. `WeatherTests` covers the wetness rising, drying and clamping, and further tests cover porosity and `vertexPuddles`.

## Open issues

- The wet pass costs about 0.33 ms, over its budget.
- A faint grey rectangle that showed in the puddles' reflections in one debug view is not verified as real. I will check it at the edges of the screen-space reflection.
- Water running down trunks and walls is not done.
