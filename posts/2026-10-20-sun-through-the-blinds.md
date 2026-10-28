---
title: A sunlit kitchen with a directional light, blind shadows and light shafts
date: 2026-10-20
order: 2
summary: A kitchen lit only by the sun through venetian blinds: a directional light with its own shadow map, ray-marched light shafts and a rebuild at real-world scale.
tags: lighting, shadows, scene
cover: /images/2026-10-20-sun-through-the-blinds/s8-game-table.jpg
---

Every light in my engine so far was a bulb, a spot or a glowing panel inside a room. The next job was different. I wanted a separate scene, a decayed farmhouse kitchen lit only by the sun coming through the slats of a venetian blind. My target was a single image from Resident Evil 7, the Bakers' kitchen. I do not publish that image, so I describe it. It is a dim, grimy room where long hard bars of daylight from a window blind lie across the floor and walls, and the beams themselves show in the dusty air as pale striped shafts. In my version a suspended ceiling is coming down, a 1950s fridge stands in a corner, and everything outside the sunlight sits in deep warm shadow.

The hallway and the house are untouched. This is a scene of its own, with strong shafts in this scene only, full decay and every prop authored by me. I built the scene entirely through the editor's MCP tools with `Tools/LevelAuthoring/build_kitchen.py`, the same tools an agent would use, and the props with scripts in `Tools/AssetAuthoring`.

## A sun is not a bright bulb

> **Background: directional lights and orthographic shadow maps.** A lamp is a point in space. Its rays fan out, light falls off with the square of the distance, and the shadow of a slat grows and spreads with distance from the light. The sun is so far away that its rays are effectively parallel. It has no position and no falloff, only a direction, and the shadow of a slat keeps its width. A shadow map is a depth image rendered from the light's point of view. When a pixel is shaded, its position is transformed into the light's space and its depth is compared with the stored depth. If the stored depth is nearer, something blocks the light. For a point light the map needs a perspective projection. For parallel rays it is orthographic, so each texel covers a fixed width of the world. The usual faults are acne, where a surface shadows itself because of limited depth precision, which a depth bias hides, and peter-panning, where too much bias detaches shadows from their casters.

The engine's sun differs from its lamps in four ways.

- **Parallel light.** The blind's slats cast parallel bars and not bars that fan out.
- **Clipped to a box.** It lights only the volume I give it, which is the room and the window reveal.
- **Its own shadow map.** A 2048-pixel orthographic map is fitted to that box. In a 6 m room each texel is about 3 mm, which is fine enough to draw a slat 5 cm deep.
- **Soft edges that grow with distance.** The sun is a disc about 0.53 degrees across, so a shadow edge has a penumbra of roughly `distance * tan(0.53 degrees)`, about 0.9 cm for each metre between the occluder and the surface. Near the slats the bars are crisp, and across the room they soften. My shadow filter widens the edge with the distance from the slat to the wall in the same way.

The bakers trace the sun as well, with one shadow ray per sample. The light that bounces around the room is therefore striped and framed by the same blind and window as the direct light.

![The first sun test: bars of light on the floor of an empty room](/images/2026-10-20-sun-through-the-blinds/s1-sun-through-slats.jpg "An early test of the sun in an empty room: parallel bars of light on the floor.")

## Light shafts

The shafts are the same physics as the fog in the previous days' posts. Air contains particles that scatter light, and where sunlight crosses air, a viewer sees the scattered part. A shaft appears where lit air lies next to air in shadow. For a view ray, the amount gathered is the sum over points along the ray of `transmittance * extinction * visibility * phase`. `visibility` is 1 where the sun reaches the point and 0 where something blocks it, and the shadow map answers it. The slats make visibility alternate between 1 and 0 across the room, which gives the stripes.

The fog grid cannot show this. The blind's slats repeat every 42 mm. To capture a stripe pattern the samples must be denser than two per period, and a fog cell is a few centimetres across near the camera and tens of centimetres deep. The grid smears the bars into one glow. So the sun is taken out of the grid and handled by a separate pass.

![A view ray marched through the sun's shadow map](/images/2026-10-20-sun-through-the-blinds/shaft-march.svg "The shaft pass: each pixel marches a view ray and asks the sun's shadow map at every step whether the air there is lit.")

In the pass, each pixel of a half-resolution image marches its view ray in 24 steps, clipped to the sun's box. At each step it asks the shadow map for the sun's visibility. The step's contribution follows the Beer-Lambert law. With `sigma` the fog's extinction and `dt` the step length, it adds `transmittance * (1 - exp(-sigma * dt)) * visibility` and then multiplies the transmittance by `exp(-sigma * dt)`. The total is multiplied by the sun's colour and intensity, a scene strength setting, and a Henyey-Greenstein phase value, which brightens the shaft when I look towards the sun.

Two details keep the result stable. The start of each ray is jittered every frame, and so is the point inside the 2 by 2 pixel block it represents, using a low-discrepancy sequence. The result is blended with the previous frame's, reprojected, which averages the steps into a smooth image. A depth-weighted upsample then adds the result to the scene before anti-aliasing. Together, the fog and the shafts cost 0.47 to 0.53 ms of GPU time at 1440p. Each light also has its own fog scatter, so the sun scatters strongly while lamps elsewhere stay as faint as I wanted after the fog work.

## The first look, and a sparkle

The first shell of a room showed the bars and shafts working. It also showed bright specks all over the ceiling.

![The first shell with shafts and sparkles on the ceiling](/images/2026-10-20-sun-through-the-blinds/s5-first-shell.jpg "The first furnished room. The shafts work, and the ceiling is covered in bright specks.")

> **Background: shading normals and geometric normals.** A normal map perturbs the normal used for lighting so that a flat surface shades as if it were bumpy. The lighting term `N dot L` uses that perturbed normal. A bump can tilt the shading normal towards a light even when the real surface faces away from it, so that the surface is lit when it should be in shadow. Shadow maps do not catch this, because they test the geometry and not the shading normal.

The sun was lighting the ceiling from behind, and the ceiling's normal map tilted bumps towards it. The rule now is that a surface facing away from the sun, by its geometric normal, receives none of it, whatever its bumps say.

## Matching the reference

I laid my view next to the reference and measured both: the median luma, the luma at the 95th percentile, which is where the brightest 5% of the picture starts, and the colour saturation. The room was far too dark and the bars were too thin. I changed two things.

- **Thin slits.** The blind's slats were tilted 28 degrees. At that angle the sun passed through only 5 mm in every 42 mm, so the bars were slits and the shafts were thin sheets. At 10 degrees the bars and gaps are about equal, as in the reference. That also removed a ripple in the dim shafts, and 48 march steps now look the same as 24.
- **The fill.** I first raised the bounce light a lot, which looked right and was misleading. Most of the room's baked bounce comes from the soft sky light at the window and not from the sun's stripes. With the sky light kept, the bounce raised to the editor's maximum of 4, the sun lowered to 20 and the shaft scattering at 1.5, the room reads like the reference.

| | Before | After | Reference |
|---|---|---|---|
| Luma median | 0.011 | 0.024 | 0.036 |
| Luma 95th percentile | 0.419 | 0.438 | 0.261 |
| Saturation | 0.330 | 0.360 | 0.406 |

![The kitchen from the reference's camera pose](/images/2026-10-20-sun-through-the-blinds/s6-reference-pose-after.jpg "My kitchen from the reference's camera pose after the first balance pass: a fan, a damaged ceiling, wainscot on the left, a torn-out blind and shafts across the room.")

### Sun through a wall

A thin bright line glowed along the back of the sink counter even with the sky light off.

> **Background: which depth a shadow map stores.** Rendering the back faces of objects into a shadow map, instead of the front faces, moves the stored depth behind the lit surface, so a surface does not shadow itself and acne is reduced. The price is that a thin wall now stores only its far face. A surface that touches that face is within the bias tolerance of the stored depth, and it is treated as lit even though the wall is in between.

My lamps store back faces, so that a lamp on a wall is not shadowed by its own wall. For the sun that stored the window wall's inner face. The counter touches that face, so it sat within the shadow's tolerance and was lit straight through 12 cm of wall. The sun's map now keeps whichever face is nearest. Lamps and the flashlight are unchanged.

![The sun leaking through the wall onto the sink counter](/images/2026-10-20-sun-through-the-blinds/s6-counter-leak-before.jpg "Before the fix: a bright line along the back of the counter, which the sun reached through the window wall.")

## Real-world scale

I walked the kitchen and it looked good, but the room felt small and I felt very tall in it. The player's eye is at 1.62 m, which is right. The room was not. It was 4.25 by 6.7 m, the ceiling grid was at 2.5 m, the window was 1.10 m tall and the table was a two-seater.

> **Background: why scale reads in first person.** A viewer judges the size of a space from familiar objects, such as a door, a counter and a table, and from the ratio between those objects and the eye's height. Engine units are metres, and the camera is at a real eye height, so a room built at the wrong scale is read as a model. Scale also matters to lighting. A 42 mm slat pitch, the sun's 0.53 degree disc and a shadow map's millimetre texels only produce the right look at the right size, and the exposure and falloff are tuned against rooms that are real in size.

I rebuilt the kitchen to scale. The room is now 5.6 by 8.4 m, with the joists at 3.25 m and the suspended grid at 2.9 m, so that I look up at the ceiling. Doors are 0.94 by 2.09 m and counters are 0.9 m. The dinette is 1.44 by 0.90 m with four chairs pulled about. The window is 1.20 by 1.50 m with its sill at 1.2 m and a 35-slat blind. Two doorways open onto short dark passages, and along the far wall stand a cast-iron range, two wall cabinets and the fridge. The ceiling damage is picked from a seed and is worst towards the window, with authored debris under the holes where it would have fallen: a heap of broken tiles, plaster chunks with lath, and a cable hanging 3 m across the room.

A bigger room needed rebalancing. I lowered the sun from 20 to 12 so that the bars stop clipping white, raised the window's sky fill from 1.2 to 1.8, lowered the exposure by 0.1 EV, set the warm grade to 0.75, painted the walls a smoke-yellowed plaster and reduced the shafts' scattering to 1.2.

| | Small room | To scale | Reference |
|---|---|---|---|
| Luma median | 0.024 | 0.028 | 0.036 |
| Luma 95th percentile | 0.438 | 0.282 | 0.261 |
| Saturation | 0.360 | 0.394 | 0.406 |

![The kitchen from the table, toward the range and window](/images/2026-10-20-sun-through-the-blinds/s8-game-table.jpg "In the game, from the player's eye: the dinette in the foreground, the range, cabinets and fridge beyond, and the window's shafts.")

Bright dots appeared in the grooves of the beadboard wall. Those grooves are edge-on to the sun. A shadow map's depth bias is usually scaled by the slope of the surface relative to the light, because a tilted surface covers a range of depths within one texel. At grazing angles the slope grows without limit. For the sun the bias reached 10 cm across a few of the 3 mm texels, enough for the side of a groove to see past the 12 cm wall behind it. Capping the sun's slope bias at a tangent of 4, with a floor at 14 degrees under the light, cleared the dots with no acne on the floor. The lamps keep their own limit.

## Fixes from a walkthrough

After walking the to-scale kitchen I listed six problems.

1. **The sun was too bright where it lands.** The bars burned the hutch and the floor white. I halved the sun from 12 to 6 and rebaked. The bars remain the brightest thing in the room, but the paint and wood under them are readable. The 95th percentile fell from 0.282 to 0.230, against 0.261 in the reference.
2. **Walking through the beam distorted the view.** There were two causes. Standing in a beam, the light scattered by the first few centimetres of air in front of my eyes was added across the whole view, a bright veil that swam as the bars swept past. Air that near now scatters nothing and fades in to full by 2 m. And the temporal blend kept about ten frames of history, so walking left the bars lagging and smeared behind the room. The blend now lets the new frame through faster as the camera moves.
3. **I could walk into the cabinets.** The two wall cabinets had no collider, and neither did the cans, crate and boxes. All are solid now.
4. **Cans stuck through the floor.** A can's origin is the middle of its base, so one lying on its side sank halfway. It now lies one radius up.
5. **I could not pick anything up.** The kitchen's props were only meshes. They are now rigid bodies like the house's, asleep until touched, so I can push, carry, inspect and throw them.
6. **The hanging webs looked poor and the planks floated.** The drapes off the fan and beams are gone, and only the corner webs remain. The planks were tipped away from the wall and stood in mid-air, so each is now tipped back by the angle that puts its top against the wall.

![Walking into the beam, before and after](/images/2026-10-20-sun-through-the-blinds/s9-beam-walk-before-after.jpg "Three frames walking into the beam. Left column: before, with a veil and smeared bars. Right column: after.")

## Results and open items

On the benchmark at 2560 by 1440 on an RTX 4070 the kitchen costs 2.84 to 3.55 ms of GPU time a frame. The sun's shadow map is rendered once and cached, so it costs 0.000 ms a frame, since the scene is static. A 3060 is roughly half as fast, which suggests about 7 ms, an estimate and not a measurement, and still well inside 60 frames per second. 106 of 106 tests pass, including new `KitchenSceneTests` for walking under a cabinet, rigid-body props and picking up a can. The hallway and the house have no sun, so none of the new code runs there.

Open items:

- The `DullChrome` material on the dinette legs and the cart frame, metallic at roughness 0.45, is the one glossy material in the kitchen. I kept it separate on purpose and have not decided whether it should be duller.
- Looking straight down a beam towards the window, the shafts wash out the view, with a dark band where the sash's meeting rail shades them. A real beam looks like that against the light, but it is strong.
- The bounce light sits at the editor's maximum of 4, and it stands in for a whole afternoon sky coming through the blind. A sky term in the bake would be the correct fix.
