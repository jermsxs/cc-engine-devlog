---
title: A wet world, and rain you feel more than see
date: 2026-10-26
order: 1
summary: Rain that refracts like real drops, then a wetness system that darkens porous ground, builds puddles along the ruts, and lets the rain fade into the background.
tags: weather, materials, renderer
cover: /images/2026-10-26-a-wet-world/flash-puddles.jpg
---

Yesterday's rain was a start, but it looked like white wires falling past the camera. And when I walked, the splashes on the ground slid along with me. A good rainy scene does not feel like rain because of the streaks. It feels like rain because *everything is wet*. So today I rewrote the falling rain, then made the whole woods react to it. I even wrote the plan down first, with how modern engines handle rain and water in mind, and worked through it in order.

## Rain, fixed

**Splashes stay put.** Before, each splash slot picked a random point round the camera, so the whole field of splashes travelled with the player. Now the ground is a grid of 25 cm cells. Each slot looks after one cell of a square round the camera, and a cell splashes at a spot that depends only on the cell and the moment. Walking only changes which cells are looked at, never where a splash is. To prove it, I rendered the same moment from two spots 0.6 m apart, looking straight down. Shifted by the ground's movement, the crowns land on the same spots.

**Drops you see through.** A real raindrop is a tiny lens. It mostly shows what is behind it, bent upside down, plus a glint where a light catches it.

> **Concept: Refraction.** When light passes from air into water, it bends. A drop shaped like a ball bends light so strongly that it acts like a little lens and shows a squeezed, flipped picture of what is behind it. You don't need to simulate the drop to get the look: for each streak, take the picture of the scene a few pixels to the side, and draw that where the streak is.

Each streak now samples the lit scene a few pixels to the side (more when it is near, up to 24 px), and adds the glint of the torch, the lamps and the lightning, plus a little of the sky. A drop over leaves looks like wavy glass, and only lit drops are bright. The rain's target now holds signed values, so a drop over a bright spot can even darken it.

**Near drops out of focus.** A camera lens blurs things very close to it. Drops closer than 1.5 m now spread their light over a wider streak, up to 4 pixels at 0.75 m, so the nearest drops are no longer the brightest white wires in the frame.

**Splash crowns instead of rings.** The flat white rings are gone. A splash now throws six droplets up and out on short arcs, 1 to 5 cm high, down again within a fifth of a second. Each is a 2 mm streak, blurred over a sixtieth of a second, at half the drop's light.

![Ground splashes, old rings on the left and new crowns on the right](/images/2026-10-26-a-wet-world/splashes-close.jpg "Left: the rings from the first rain. Right: crowns of tiny droplets. Look near the grass.")

**Rain sheets.** Past the 28 m box that holds the drops, there was only fog. Four cylinders of falling streak columns, at 16, 23, 33 and 47 m round the camera, fill the gap. They sit behind whatever is in front, stop under roofs, fade with the fog, and light up in a flash. In the dark they barely show. In a flash, the gaps between trees fill with rain.

One reproducibility problem along the way: my screenshots of the rain would not repeat. My fixed-timestep mode stepped the world by frames, but the shaders still read the real clock. It now steps their clock too.

## A world that gets wet

> **Theory: Porous and non-porous.** Pour water on dry soil and the soil goes dark. The water has soaked into tiny gaps between the grains. Pour it on a metal gate and it just beads up and runs off. Wetness is not one effect, it is two. First, *porous* materials (soil, wood, plaster) soak water up and get darker, because light that enters wet pores bounces around and is more likely to be absorbed. Second, whatever water stays on the surface forms a thin film. A film is smooth, so it is shinier (lower *roughness*), and it reflects more like a mirror.

Every material now has a *porosity* from 0 to 1. Earth is 0.9, bark 0.8, plaster 0.7, tile 0.05 and painted iron 0.1. Materials without a value get one by kind: metal and glass 0, leaves 0.3, everything else 0.6.

- **How wet the world is** is one number, 0 to 1. It rises while it rains (dry to soaked in 5 minutes at full rain) and falls once the rain stops (half an hour). Scripts can read or set it: `Weather.Wetness = 1` soaks everything at once.
- **What the rain reaches** comes from the shelter map the rain already uses, plus a coarse second map covering 256 m round the player. Tops get fully wet, walls a little less, and anything under a roof stays dry.
- **Porous surfaces** darken first, to about half their colour. Then the water film forms, first where water collects: the low spots in the material's relief and patches a metre or two across. On stone or iron the film soon covers everything. On earth it covers only patches. Under the film, the surface gets smoother, but never glossier than roughness 0.35 (0.55 on earth). That cap is deliberate: I dislike shiny walls and floors, and I want the matte look to survive even when wet.

Scenes without rain are untouched: at wetness 0 the shader returns at once, and the hallway, house and kitchen render exactly as before.

![Mud in the torch, dry on the left and soaked on the right](/images/2026-10-26-a-wet-world/dry-vs-soaked.jpg "Dry (left) and soaked (right). The wet ground is darker, with a faint sheen on the patches of water.")

My first film was a disaster. It covered the whole ground with a smooth layer that caught a flash on every grain of the relief. In a lightning flash, the woods looked *frosted*, like a snowy field. With the film off, the darkening alone looked right, so the film was the culprit. On porous ground it now reaches only patches, it is less smooth, and it flattens the normal map under it, so a flash shows broad wet patches instead of glitter.

![A flash over the ground, with the frosted film and then fixed](/images/2026-10-26-a-wet-world/frost-fixed.jpg "Left: the frosted look. Right: the film limited to patches, with a flatter normal map.")

## Rain like the reference

I had a reference image of a city street in heavy rain. In it, the rain is many short, thin, soft grey streaks. Mine were fewer, longer and brighter. I found two reasons:

- **A sign bug.** A drop's light is weighted by a *phase function*, the same one the fog uses, which says how much light scatters towards you from a given angle. Its sign was flipped compared to the fog's. So the torch, which shines from behind the eye, counted as light scattered forward, the strongest case. Torch-lit drops came out about nine times too bright, while lamps beyond the rain, which should make drops glint, were dimmed.
- **Wrong streak shape.** Real cameras see rain as short streaks, a 1/60 s shutter at 9 m/s. I made each streak 0.14 m long and soft across, and quadrupled the number of drops to 131,072.

![Rain before and after the camera-like streaks](/images/2026-10-26-a-wet-world/rain-before-after.jpg "Left: fewer long white streaks. Right: many short, soft grey ones.")

I then found the rain was still "way too visible". Two more references showed wet asphalt, sheets of water, and a night street where you barely see the rain at all. In those, you know it rains from how wet everything is. So I cut the drop count from 131k to 65k, and made the post pass ease a streak's brightness lift harder. A torch-lit drop reads as a faint grey thread. I measured it: the rain now covers about half as much of the frame, and a typical streak lifts a pixel about half as much.

Everything else moved to the ground. Water lies in the ruts and dips of the path, led more by the relief than by noise, and wet earth darkens more, so mud looks soaked and the gate's bricks go dark. One bug also hid in the logic: the shelter map treated every thin branch overhead as a roof, which left blocky dry stripes under the trees. Now a covered point also checks 0.6 m to each side. If the sky is open anywhere that close, the rain reaches it. Only solid cover, like a dense crown or a roof, keeps the ground dry.

## Puddles painted along the ruts

Near-mirror puddles collect in the deepest middles of the wet patches on level ground, with rings spreading across them from where drops land. I allowed myself mirror water on the ground only, and screen-space reflections are on in the night woods, but only for that near-mirror water.

But water in a real forest does not sit where a noise pattern says. It sits in tyre ruts and hollows. So the level script now *paints* the puddle areas into the terrain's vertex colour: blue means "water gathers here". Heavy-rain systems in shipping games work the same way: vertex paint, so an artist can say "water here". The two wheel ruts run 0.62 m either side of the path's middle, switched on and off in stretches a few metres long, and the hollows are painted fully. In all, 42% of the path's vertices carry paint.

I almost didn't get paint onto the screen at all. My first bands were narrower than the ground's 0.4 m grid, so only about 1,200 of 72,000 vertices carried any. Widening them fixed it.

![The clearing in a lightning flash, dry against soaked with puddles](/images/2026-10-26-a-wet-world/flash-puddles.jpg "A flash at the clearing. Left: before the rework. Right: water sheets in the ruts mirror the sky as crisp white shapes.")

![The path's ruts in a flash, without and with painted puddles](/images/2026-10-26-a-wet-world/ruts-flash.jpg "Left: no paint. Right: painted ruts. It shows most in a flash, when the water mirrors the sky.")

## Honest limits

A torch shines from the eye, so wet ground reflects it back only where the surface faces the eye, right underfoot. That is physics, not a bug. In torchlight the wet look comes from darker ground, puddles and ripples. The glints come from lightning and the lamplit window. A lamp near wet ground, like a porch light by the gate, would show the street-at-night look of my reference best, but I haven't decided whether to add one.

Cost, GPU at 1440p: the rain itself is about +0.15 ms, and wet versus dry about +0.3 to +0.4 ms, above the 0.1 ms I had budgeted. That is where tomorrow started.
