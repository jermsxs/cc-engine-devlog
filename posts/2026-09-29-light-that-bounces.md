---
title: Light that bounces
date: 2026-09-29
order: 3
summary: Baked irradiance probes give the hallway soft bounce light, and baked reflection probes give its surfaces a sense of the room around them.
tags: lighting, renderer
cover: /images/2026-09-29-light-that-bounces/bench-after.jpg
---

With the editor in better shape, I went back to the picture. My second look at the reference for the hallway showed me what the engine lacked most. In the reference, the ceiling, the far walls and the end of the corridor all glow softly from the lamps. In mine, each lamp made a bright pool and everything else got the same flat grey "ambient" glow, no matter whether it was in a lit corner or a dark closet.

What was missing is called *indirect light*: light that has already bounced off something before it reaches your eye. I did this in two steps that day. The first was light that bounces, the second was reflections that know the room.

## Step one: baked bounce light

> **Concept: Direct and indirect light.** Direct light travels from a lamp to a surface. Indirect light travels from a lamp to a wall, bounces, and then lights something else. It is the reason a white ceiling glows above a lamp that points at the floor, and the reason a shadow is never perfectly black. It is also expensive: every surface lights every other surface, so the problem is huge.

Real-time engines cheat in two ways. They can approximate it every frame, or they can work it out ahead of time and save the answer. A hallway that does not move is a good fit for the second, which is called *baking*.

### Probes

The bake puts a 3D grid of invisible sample points, called **probes**, through the whole house. They sit 0.6 m apart, which gives 6,144 of them. For each probe, a ray tracer I wrote on the CPU shoots 192 rays in all directions and asks what light comes back from each one:

1. The lamps' light lands on walls, floor and ceiling, with shadows.
2. That lit surface is bounced a second time.

Each probe stores the answer as a tiny map of "light arriving from this direction", just 6 by 6 texels. It is a compact summary of the colour and brightness of the light that reaches that point in space, from everywhere.

![The probe volume in the editor](/images/2026-09-29-light-that-bounces/editor-probe-volume.jpg "The probe volume selected in the editor. Every dot is a probe, tinted by its light. Red dots are inside walls or outside the building and are ignored.")

> **Theory: Why a small map is enough.** The light arriving at a point on a matte surface is a very smooth function of direction. The surface adds up everything coming from the hemisphere around its normal, weighted by the angle (a *cosine-weighted* sum). That sum throws away detail, so a few numbers per probe are enough. Some engines store these as *spherical harmonics* (a handful of coefficients, like a very blurry spherical Fourier series). I store a small octahedral map instead. It is a sphere unfolded into a square that the GPU can filter. I pre-compute the cosine sum so the shader just reads it.

### Looking up the light

While the game runs, each pixel on screen finds the eight probes that surround it, in the same way that a texture filter blends four texels. It blends their stored light. That would leak light through walls (a probe on the far side of a wall knows nothing about it), so each probe also stores how far it is from the nearest surface in each direction. A probe that cannot "see" the point is given less weight.

![The bounce light alone](/images/2026-09-29-light-that-bounces/indirect-only.jpg "The bounce light on its own: it gathers near the lamps and on the floor, and fades into the far end.")

### What it costs

My first version looked up eight probes for every pixel at full resolution, and cost 0.7 ms at 1440p, more than twice my 0.3 ms budget. Indirect light is soft by nature, so there is no need for full resolution. It now runs in a compute pass at half resolution, and the scene pass upsamples it using depth-aware weights, so edges between near and far things stay sharp. That cost fell to 0.09 ms.

The same idea fed the fog, whose own glow now comes from the probes. The haze lights up next to lit walls and stays dark in dark corners, instead of being an even grey everywhere.

![The fog, lit by even ambient and then by the probes](/images/2026-09-29-light-that-bounces/fog-probes.jpg "The fog alone, brightened. Left: even ambient haze. Right: probe light, dark away from the lamps.")

### Mistakes and limits

The first run crashed straight after uploading the probes. The renderer waited for the GPU in the middle of building a frame, which confused its "free this later" bookkeeping, so it released a texture the GPU was still reading. I found it by sending D3D12's debug-layer messages to the engine's own log. They normally only go to an attached debugger, so I had never seen them.

Baked light is frozen. If a script later switches a lamp off, its glow on the ceiling would stay. The bake file already stores light in *layers* that the game can scale, so baking one layer per lamp is planned for when scripting arrives. Also, a bake is only valid for the scene it came from, so the bake records a fingerprint of everything it depends on, and the status bar shows "Lighting stale" when the scene no longer matches.

With real bounce light, the materials suddenly mattered. The plaster was only reflecting about 15% of the light, and the wood almost nothing, so I lightened both and made the lamps a warmer white with a longer reach. In the four test views, the darkest 5% of pixels rose from 0.007–0.012 to 0.019–0.040 (the reference has 0.048). That meant the shadowed walls were finally readable, as they are in the reference.

## Step two: reflection probes

Surfaces have a second kind of indirect light: *specular* light, the sheen of reflections. A shiny surface shows what is around it. I already had screen-space reflections, but they only know what is currently on screen. Look down at the floor and the lamps behind you vanish from it. The fallback I used was the soft bounce light, as if the room were an evenly lit fog.

> **Concept: Reflection probe and cube map.** Put a camera in the middle of a room and take six photos, up, down, left, right, front and back. Together they are a *cube map*: a picture of the whole room from that spot. A shiny point can then look up the cube map in the direction its reflection points. For rougher surfaces, the picture is also stored blurred, a few times over, and rougher materials read the blurrier copies.

The catch is that a cube map is only right from the spot where it was taken. My hallway is 17 m long, so a probe in the middle would show the wrong thing everywhere else. The fix is *parallax correction*, also known as **box projection**. Each probe knows the box of its room. The shader works out where the reflected ray hits that box, and looks up the picture in the direction from the probe *to that hit point*. The reflection then lines up all along the corridor.

I bake the pictures with the same CPU ray tracer. Each probe sees surfaces lit by all 12 lamps, with shadows, plus the bounce light from step one. The lamp shades are in the picture too, as glowing geometry that is visible but never casts a shadow (otherwise they would block their own light). Six cubes at 128 by 128 bake in 3.6 seconds in a Debug build, and the file is 3.1 MB. The demo has one probe for each corridor, plus the bedroom and the closet. Where boxes overlap, the smaller one wins and each one fades out over 0.4 m. Screen-space reflections still win where they find something on screen, and the probe fills in everywhere else.

![The reflections alone](/images/2026-09-29-light-that-bounces/reflections-view17.jpg "The ambient specular on its own. Left: the old even stand-in. Right: the probes. The corridor, its trim and the lamps are mirrored in the floor where they belong.")

My first version barely changed the picture. The debug view showed why. A probe's influence faded to zero *at* the edge of its box, but a corridor's box is its walls and floor, so every wall and floor pixel sat on the edge. Influence is now full inside and on the box and only fades beyond it.

![Looking down at the floor, without and with the probe](/images/2026-09-29-light-that-bounces/floor-sheen.jpg "Looking down with the lamp off screen: without, with, and the difference multiplied by six. Screen-space reflections cannot see the lamp from here, but the probe adds its glow.")

The effect is honestly subtle on rough plaster and a satin floor, since a non-metal reflects only about 4% head-on. It cost 0.135 ms. It should show more once the floor gets real lacquer.

## At the end of the day

Both bakes use one workflow. You place a Probe Volume or Reflection Probe in the editor, choose Render > Bake Lighting (or let an AI agent call the same command), and the files are saved next to the scene. Together they cost about 0.3 ms in a frame that is still under 3 ms.

![The six benchmark views after the bake](/images/2026-09-29-light-that-bounces/bench-after.jpg "The six benchmark views after baking: the corridor reads as one connected space, and the shadowed walls are no longer flat black.")

It still does not match the reference, and I know why. Bounce light cannot add bare bulbs, a narrow corridor, lit trim, props or a herringbone floor. That is content. So next was materials.
