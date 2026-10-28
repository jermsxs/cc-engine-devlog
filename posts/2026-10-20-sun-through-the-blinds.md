---
title: The sun through the blinds
date: 2026-10-20
order: 2
summary: "A new scene lit by the sun instead of lamps: a decayed kitchen with light cutting through venetian blinds, matched to a reference, scaled up, then fixed after a play-test."
tags: lighting, shadows, scene
cover: /images/2026-10-20-sun-through-the-blinds/s8-game-table.jpg
---

Every light in my engine so far was a bulb, a spot, or a glowing panel inside a room. The next job was different. I wanted a new, separate scene: a decayed farmhouse kitchen where the only light is the sun, coming through the slats of a venetian blind. My target was a single image from Resident Evil 7, the Baker family's kitchen: a dim, grimy room where long, hard bars of daylight from a window blind lie across the floor and walls, and in the dusty air the beams themselves show as pale, striped shafts. I will not show that image here. Instead I describe it, build toward it, and measure against it. In my version a suspended ceiling is coming down, a 1950s fridge stands in a corner, and everything outside the sunlight sits in deep, warm shadow.

The hallway and the house stayed untouched. This is a scene of its own, with strong shafts in this scene only, full decay, and every prop authored by me.

## A sun the engine did not have

A sun is not just a very bright bulb. Three things make it different.

> **Concept: A directional light.** A lamp is a point in space and its rays fan out, so the shadow of a slat grows and fans with distance. The sun is so far away that its rays run essentially *parallel*. The shadows of the blind's slats stay as parallel bars instead of fanning out, and there is no position, only a direction.

- **Clipped to a box.** The sun lights only the volume you give it: the room and the window reveal. Everything outside that box is left alone.
- **Its own shadow map.** A *shadow map* is a depth picture taken from the light's point of view. For the sun it is *orthographic*, with no perspective, and fitted to the box. At 2048 pixels across a 6 m room, each texel is about 3 mm. That is small enough to draw a slat 5 cm deep.
- **Soft edges, like the real sun.** Edges blur with the distance from the slat to the wall, as the sun's 0.53-degree disc would. Close to the slats the bars are crisp; far across the room they soften. That is why a sunbeam on the floor has a hard edge near the window and a soft one far away.

The bake traces the sun too, one shadow ray per sample, so the light that bounces around the room is striped and framed by the same blind and window.

## Shafts: a separate march

The fog grid I use for lamps is far too coarse for gaps a few centimetres wide between slats. It smears them into one glow. So the sun is taken out of the grid and handled by its own pass.

> **Concept: Ray marching a shadow map.** For every pixel, I walk a ray from the eye into the scene in small steps. At each step I ask the sun's shadow map, "is this point in the air lit or in shadow?" and add up the lit samples. Where a beam passes between two slats, those steps are lit, and the pixel gets brighter. The result is the striped, visible shaft. The cost is the number of steps: I use 24, jittered a little each frame and blended with the previous frame so it comes out smooth, and I do it at half resolution.

Each light now also says how much the fog scatters it. The sun scatters strongly, while lamps elsewhere stay as faint as I wanted after the fog work.

## The first look, and a sparkle

The first shell of a room showed the bars and shafts working. It also showed bright specks across the ceiling.

![The first look: bars, shafts, and sparkles on the ceiling](/images/2026-10-20-sun-through-the-blinds/s5-first-shell.jpg "The first furnished room. The shafts work; the ceiling is covered in bright specks.")

Those were bumps in the ceiling's normal map tilting toward a sun that was lighting the ceiling from *behind*. A bump can tilt a surface's shading normal toward a light even when the real surface faces away, and shading then says "lit". The rule now: surfaces facing away from the sun get none of it, whatever their bumps say.

## Matching the reference

I laid my view next to the reference and measured both: the median brightness, the brightest 5% of the picture, and the colour saturation. At first the room was far too dark and the bars too thin.

- **Thin slits.** The blind's slats were tilted 28 degrees. At that angle the sun got through only 5 mm in every 42, so the bars were slits and the shafts thin sheets. At 10 degrees, bars and gaps are about equal, as in the reference. That also removed a ripple in the dim shafts.
- **The fill.** I first raised the bounce a lot, which looked right but was misleading. Most of the room's bounce comes from the soft sky light at the window, not from the sun's stripes. With the sky light kept, the bounce at the editor's maximum, and the sun lowered, the room read much closer to the reference.

| | Before | After | Reference |
|---|---|---|---|
| Luma median | 0.011 | 0.024 | 0.036 |
| Luma 95th percentile | 0.419 | 0.438 | 0.261 |
| Saturation | 0.330 | 0.360 | 0.406 |

![The reference camera pose after the first balance pass](/images/2026-10-20-sun-through-the-blinds/s6-reference-pose-after.jpg "The kitchen from the reference's camera pose: a fan, a damaged ceiling, wainscot on the left wall, a torn-out blind and shafts across the room.")

One more bug on the way: a thin bright line glowed along the back of the sink counter even with the sky light off. Shadow maps here store the *back* faces of things, so that a lamp on a wall is not shadowed by its own wall. For the sun that stored the window wall's inner face, and the counter touches that face, so it sat within the shadow's tolerance and was lit straight through 12 cm of wall. The sun's map now keeps whichever face is nearest. Lamps and the flashlight are unchanged.

## The kitchen to scale

I walked it and it looked good, but the room felt small, and I felt very tall in it. The player's eye is 1.62 m, which is right. The room was not: it was 4.25 by 6.7 m, with the ceiling grid at 2.5 m, a 1.10 m window and a table for two. Next to a real-size eye, everything read like a doll's house.

So I rebuilt it. The room is now 5.6 by 8.4 m, with joists at 3.25 m and the suspended grid at 2.9 m, so you look up at the ceiling. Fixtures are real sizes: doors 0.94 by 2.09 m, counters 0.9 m, a 1.44 by 0.90 m four-seat dinette with four chairs pulled about, and a 1.20 by 1.50 m window with a 35-slat blind. Two doorways open onto short dark passages. Along the far wall sit a cast-iron range, two wall cabinets and the fridge.

The ceiling damage is now picked from a seed and worst toward the window, with authored debris under the holes where it would have fallen: a heap of broken tiles, plaster chunks with lath, and a cable hanging 3 m across the room. A bigger room needed rebalancing too: the sun down from 20 to 12, the window's sky fill up, the exposure a little lower.

![From the table, toward the range and window](/images/2026-10-20-sun-through-the-blinds/s8-game-table.jpg "In the game from the player's eye: a dinette table in the foreground, the range and cabinets beyond, and the window's shafts.")

One small renderer detail came out of this: bright dots appeared in the grooves of the beadboard wall, because those grooves are edge-on to the sun. A shadow's *bias*, the small offset that prevents surfaces from shadowing themselves, grows as a surface turns away from the light, and for the sun it reached 10 cm across a few of its 3 mm texels. That was enough for a groove side to see past the 12 cm wall behind it. Capping the sun's bias cleared the dots with no shadow acne on the floor.

## Play-test fixes

Then I walked the to-scale kitchen and listed six things.

**1. The sun was too bright where it lands.** The bars burned the hutch and the floor white. I halved the sun from 12 to 6 and rebaked. The bars are still the brightest thing in the room, but you can see the paint and wood under them. The brightest 5% of the image went from starting at 0.282 to 0.230, against 0.261 in the reference.

![The hutch, before: the bars burn it white](/images/2026-10-20-sun-through-the-blinds/s9-hutch-bright-before.jpg "Before: the sun's bars blow out the hutch and floor.")

![The hutch, after](/images/2026-10-20-sun-through-the-blinds/s9-hutch-after.jpg "After: the same pose with the sun halved. You can read the paint and wood under the light.")

**2. Walking through a beam distorted the view.** There were two causes. Standing in a beam, the light scattered by the first few centimetres of air in front of my eyes was added across the whole view, a bright veil that swam as the bars swept past my head. That nearby air now scatters nothing, fading in to full at 2 m. And the smoothing over time kept about ten frames of history, so walking left the bars lagging and smeared behind the room. The smoothing now lets the new frame through faster when the camera moves.

**3. You could walk into the cabinets.** The two wall cabinets had no collider, so your head went into them. The cans, crate and boxes had none either, so they were ghosts too. All are solid now.

**4. Cans stuck through the floor.** A can's origin is the middle of its base, so one lying on its side sank halfway. It now lies one radius up.

**5. You could not pick anything up.** The kitchen's props were only meshes. They are rigid bodies now, like the house's, asleep until touched, so you can push, carry, inspect and throw them: cans, bottles, the mug, the stock pot, newspapers, crate, boxes, planks. The four chairs can be shoved about.

![Carrying a can off the table](/images/2026-10-20-sun-through-the-blinds/s9-carry-can.jpg "Carrying the can off the table, with the hint 'Release to throw'. The range and the fridge stand in the shafts behind.")

**6. The hanging webs looked bad, and the planks floated.** The drapes off the fan and beams are gone; only the corner webs remain. The planks were tipped the wrong way and stood in mid-air, so each is now tipped back by exactly the angle that puts its top against the wall from where its foot stands.

A validator bug turned up on the way: my scene checker applied the capsule rule, which wants a collider at least twice as tall as wide, to cylinders, and rejected the stock pot, a short wide cylinder.

## The numbers

On the benchmark (2560 by 1440, RTX 4070) the kitchen costs 2.84 to 3.55 ms of GPU time a frame. Fog and shafts together take about 0.5 ms, and the sun's shadow is rendered once and then cached, at 0.000 ms a frame. A 3060 is roughly half as fast, so around 7 ms, well inside 60 frames per second.

## Where it stood

The kitchen looked like the reference in light and structure, and you could walk it and move things. Still open: one glossy material (chrome on the dinette legs) that I kept separate on purpose and want a verdict on; looking straight down a beam toward the window washes out the view, which is how a real beam looks but is strong; and the bounce light is at the editor's maximum, standing in for a whole afternoon sky. A proper sky term in the bake would be the honest fix.
