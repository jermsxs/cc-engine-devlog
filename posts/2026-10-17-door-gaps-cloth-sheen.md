---
title: Door gaps, matte wood and the look of velvet
date: 2026-10-17
order: 1
summary: Three causes of light creeping round closed doors, furniture that stops looking varnished, a cloth shading model for velvet, and props that no longer escape the house.
tags: lighting, materials, physics
cover: /images/2026-10-17-door-gaps-cloth-sheen/armchair-flashlight.jpg
---

After the previous day's leak hunt I played the house again and noticed two more things. Light still crept in round the sides of closed doors, and the furniture looked hard and glossy, as if everything had been freshly lacquered. Neither belongs in a decayed old house. This post is about both, then about the velvet that those matte changes left looking wrong, and a bug report about thrown objects.

## Light round the doors: three causes in a row

The method was the same as the day before: switch the room off, freeze the camera on its closed door, and boost the image eight times so that anything faint shows. Pixels brighter than a very low threshold gave me a number to push down. Around the parlor door there were 9,465 of them.

It turned out there were three separate causes, one hiding behind the other.

**One: a slot through the wall.** The door frame's opening was 4 cm wider than the door leaf, a 2 cm gap each side. The stops that the closed door rests against were only 12 mm wide, so 8 mm of clear air remained beside and above every closed door. The fix is what a real carpenter does: the stops now reach 1 cm behind the leaf's edge.

**Two: the corridor lamps lit the inside of the gap.** The stops sit on the corridor side, so from the room you still look down a 2 cm channel to the stop. The corridor lamps' light boxes and their soft fade carried 4.2 cm into the 8 cm wall, enough to light the far half of that channel. The tools that fit a lamp to its room now end the fade a fifth of the way into the wall, before a closed door's stop.

**Three: the lightmap.** With the first two fixed, a soft glow remained on the casing beside the hinge. An ambient-only view showed it was baked light.

> **Concept: Texel density and thin surfaces.** A lightmap is a texture that stores light on surfaces, and its pixels are called *texels*. In the house a texel covers 10 cm of wall. The inside lining of a door frame is only 8.8 cm deep, so it was given two texels across it: one on its corridor edge, and the next 1.2 cm past its room edge. Each texel stores the light at its own spot, and the surface between them is a blend. So the corridor's light covered the whole face and bled onto the casing next to it.

The fix is a rule: any narrow face gets at least three texels across, at its two edges and its middle. That reads light from the middle of the face rather than from one edge. It applies to every thin face of every model, such as trim edges and frame mouldings. The lightmap grew about 10%, from 18.1 to 19.9 MB.

Pixels brighter than the threshold around the parlor door fell from 9,465 to 316, and with every circuit off the scene has 264 anyway, so the rest is noise.

![Light round the closed parlor door, before and after](/images/2026-10-17-door-gaps-cloth-sheen/door-gap-before-after.jpg "The parlor door from inside, room dark, boosted eight times. Before (left): thin lines of light round the edge. After (right): nothing.")

## Furniture that didn't look old

The shine on the furniture was real. When I made the furniture I gave the mahogany a roughness between 0.32 and 0.72, a varnished finish. At a low angle the dining lamp drew a lacquer streak across the table.

> **Concept: Roughness.** In physically based rendering, *roughness* describes how scattered a surface's reflection is. At 0 the surface is a mirror and a lamp gives a sharp highlight. At 1 the surface scatters light in every direction and there is no highlight at all, only an even, flat look. Real old wood, worn and dusty, sits near the top of that scale.

The week before I had only checked the walls (0.94). Now I pushed the old finishes towards dull: mahogany 0.72 to 0.94, door wood 0.68 to 0.92, trim 0.72 to 0.92. The bath's enamel, the mirror and the brass stay glossy, since that is what they are. This is a taste I will keep coming back to. I like dark, grimy surfaces in this engine, not a showroom.

![The dining table with the lamp lit, before and after](/images/2026-10-17-door-gaps-cloth-sheen/table-sheen-before-after.jpg "From table height with the lamp lit. Left: a varnish sheen across the table top. Right: matte, with the shine gone.")

## Why velvet looks like velvet

Once the furniture was matte, the velvet armchairs looked like smooth painted cloth. A real velvet works the other way round from a shiny surface. Its fibres stand up from the weave. So:

- looking straight at it, you see down between the fibres into shadow, and it reads *dark*;
- at its edges and folds you see the fibres side-on, and they catch the light, giving a pale rim.

There is no highlight at all, and the brightness goes up at grazing angles, the opposite of normal shiny reflections.

> **Theory: The sheen lobe.** A normal specular highlight peaks when the view mirrors the light. A cloth *sheen* lobe peaks the other way: it reflects most at grazing angles and almost nothing head-on. The glTF format has a standard extension for it, built on a model by Estevez and Kulla (2017). It adds a soft layer on top of the base material. The base gives up the light the layer takes, so the cloth never reflects more light than arrives. A small fitted curve gives how much the layer takes at each angle, and I checked it against the fully integrated lobe to within 0.025.

In practice the sheen is a handful of numbers read from the model file: a colour and a roughness. Blender can export the same extension, so cloth modelled there carries over. Materials without it skip the code entirely. It lives in its own shader file, because my main scene shader has a strict 400-line budget.

My first values were too strong. Under the flashlight they washed the whole armchair pink, including the faces turned towards me. I halved the colour and narrowed the lobe, so the change now sits at the edges. Linen and wool use the same model, more weakly.

![A velvet armchair under the flashlight, before and after](/images/2026-10-17-door-gaps-cloth-sheen/armchair-flashlight.jpg "The master bedroom armchair under the flashlight. Left: smooth cloth. Right: the same chair with a faint pale rim at its edges and arms.")

A difference map shows exactly where the change landed: not on the back facing the camera, but along the silhouette and the tops of the arms.

![The change, after minus before](/images/2026-10-17-door-gaps-cloth-sheen/sheen-difference.jpg "The sheen's contribution, boosted six times. It is dark on faces that look at the camera and bright along the edges.")

Under the room's own lamp the change is much smaller. The lamp is behind and above the chair, so the faces I see are lit nearly head-on, where velvet barely sheens at all. That is physically right, and it also means this is a subtle effect I should not oversell.

## Switches checked, and props that stay in the house

A report from play came in: the hall switch didn't turn the hall lights off. I could not reproduce it. A real press of the corridor switch puts out all twelve lamps, and the same press in the editor's Play mode flips the toggle and prompt. A new test aims at every switch from 0.6 to 2 m away and up to 60 degrees off its face, and each one takes the focus. My best guess is a mix-up: the corridor switch and the foyer switch sit back to back at the foyer doorway, and the foyer one only runs the foyer lamp.

![The corridor switch pressed, on and off](/images/2026-10-17-door-gaps-cloth-sheen/corridor-switch.jpg "The ground corridor with its lamps on (left), and after the press (right). Only the far window stays lit, by design.")

The second report was that a ball thrown at a wall or into a corner sometimes left the map. So I wrote a test that throws six kinds of prop from eleven spots, in 24 directions at three pitches, hard and soft, and fails if anything crosses a solid surface. It found three different faults:

1. **Tins and bottles through walls.** A tilted cylinder touching a wall kept only one contact point, so a spinning tin pivoted on it and swung its far end through an 8 cm wall. It now keeps both ends of its side. Before: 6 of 30 tins and 21 of 30 bottles went through. After: none.
2. **A book sinking through the floor.** A book lying flat had edges almost exactly parallel to the floor's. I use the cross product of two edges as a test direction, but for nearly parallel edges it is mostly rounding error, and on one frame it said "apart". Edge pairs within about 0.06 degrees of parallel are now skipped, because the face tests already cover them.
3. **A book spinning through a stair rail.** Contacts are found once per sixtieth of a second, and a book tumbling at 30 radians a second turned almost 30 degrees between checks. As a last guard, if a body's centre would have crossed a static surface in a step, it goes back, loses its speed into that surface and half its spin. In the house this fires in 13 throws of 9,504, so real contacts do the work.

## Where it stood

The doors sealed, the wood looked old, and the velvet had a rim. Two follow-ups stayed open: a closed door still leaves a 2 mm gap at the threshold, so a lit corridor shows a hairline under it, which is realistic; and the cloth sheen is deliberately faint, since I would rather it be too quiet than make the house look plush.
