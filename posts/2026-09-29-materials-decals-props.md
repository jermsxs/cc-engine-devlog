---
title: Grime, mouldings and things on the walls
date: 2026-09-29
order: 4
summary: A parquet floor, plaster and painted wood made by script, projected decals for dirt, then mouldings, a window, lamps and furniture.
tags: materials, assets
cover: /images/2026-09-29-materials-decals-props/before-after.jpg
---

After the lighting work, the hallway was lit correctly but still looked like a model of a hallway. The reference is full of *surface*: a herringbone floor with worn lacquer, grey-green plaster with damp patches and cracks, chipped white trim, and dirt collecting where walls meet the floor. Mine had two stock texture scans stretched over everything, and flat boxes where trim should be.

I did two passes. First the surfaces, then the shapes.

## Materials, made by a script

Three new materials, all produced by one deterministic Python script. Run it twice and you get the same pixels. There are no hand-painted files to lose.

> **Concept: A PBR material is a set of maps.** Physically based rendering describes a surface with a few textures: *albedo* (the colour), a *normal map* (fake small bumps, by tilting the normal), *roughness* (how blurry the highlights are) and, for metal, a *metallic* value. The shader combines them with the lights. Change the maps and the same geometry looks like a different substance.

- **Herringbone parquet.** Planks 7 by 35 cm, laid at 45 degrees. Each plank is cut from a wood scan at its own offset, with its own tone and gloss, a few darker replacement boards, and bevelled, dirty seams. The pattern repeats exactly every 0.99 m, so you cannot see where the texture tiles. A new *texture rotation* setting turns it 90 degrees in the north and south corridors, so the chevrons always point down the hall.
- **Grimy plaster.** A plaster scan, graded to the reference's grey-green, with damp blotches, mottling, faint vertical runs, pits and bubbled relief in the damp areas.
- **Painted wood.** Aged off-white satin paint with horizontal brush strokes over faint grain. Small chips show an older coat, and the deepest show bare wood.

![The three materials](/images/2026-09-29-materials-decals-props/materials.jpg "Herringbone parquet (tiled 2 by 2 to check the seams), grimy plaster, painted wood.")

## Decals: dirt that goes where it belongs

A repeating texture cannot put grime above a skirting board or a stain under a leak. It repeats everywhere the same. What I need is dirt that I can *place*.

> **Concept: Projected decals.** A decal is a sticker, but one that is projected, not wrapped. You place an invisible box in the scene. Every pixel of the scene that falls inside the box gets painted with the decal texture, as if a projector inside the box were shining the picture onto whatever surface it hits. It works on any shape, bends round corners and needs no special geometry.

In this engine the work happens at the point where a wall pixel's surface is described, before lighting. For each pixel of a wall, floor or ceiling, the shader takes its world position, converts it into each nearby decal box's own space, and checks whether it is inside. If so, it looks up the decal texture at the position's X and Y inside the box and blends it into the surface. Because the decal changes the surface's *data* (colour, roughness, bumps) and not the final image, the dirt is lit properly, so a peeling patch catches light on its raised edges. It runs in the same code as the depth prepass, so reflections and ambient occlusion see the dirt too.

I painted 11 decals, again by script, into one atlas: a damp patch, water-stain rings, a grime band, drip streaks, peeled paint with raised flakes, a crack, mould, scuffs, floor wear, dust and a dark splatter. Stains darken what is under them. Peeling, dust and wear replace the colour. Each can also change roughness and bump.

![The decal atlas](/images/2026-09-29-materials-decals-props/decal-atlas.jpg "The atlas on grey: damp, water stain, grime band, drips, peeling paint, crack, mould, scuffs, floor wear, dust, splatter.")

The demo ended up with 131 decals, placed by a script that talked to the editor: grime along every baseboard, damp and drips under the crown, a worn lane down each corridor, dust in the corners, and one faint stain in front of the locked door.

![Decals off and on, showing surface colour only](/images/2026-09-29-materials-decals-props/decals-albedo.jpg "Surface colour only, decals off and on: grime along the baseboards, peeling and damp high up, a crack by the lamp, a worn lane on the floor.")

### Two things that went wrong

**Decals on walls did not show, while decals on the floor did.** The cause was that when I read an object's rotation back from the scene, I used a different order of axes than the one I use to build it. A wall turned minus 90 degrees came back as a different set of angles describing the same box, but facing the other way. A symmetrical box never shows that, but a decal that only paints the side it faces does. I fixed the read-back and added a test that round-trips six arbitrary rotations. Four of the six failed before the fix.

**Decals were slow.** The first version cost 0.44 ms. A 17 m wall's pixels each checked every decal on that wall and loaded each one whole. Two changes brought it to 0.11 ms: each check stops at the first axis where the pixel is outside the box, and long walls split their decal list into 2 m segments, so a pixel only considers the decals near it. The segmented lists render pixel-identical to the flat ones.

Decals only paint the built-in architecture: walls, floors, ceilings and trim. Doors swing and props stand proud of the wall, so a decal fixed in space would slide over them.

## Shapes: mouldings, a window and things on the walls

Then the geometry. Everything is authored by script again, as glTF files, with helper functions I added to extrude a profile along a line, mitre a moulding around a corner, and sweep a profile into a rectangular frame.

- **Trim that fits any wall.** A baseboard (quarter-round, flat board, bead, rounded top), a chair rail and a deep cove crown are each a 1 m extrusion that the scene stretches to the wall's length. Stretching a mesh stretches its texture, though. So I made one engine change: a mesh set to *world-projected* UVs takes its texture coordinates from its place in the world, the same way my built-in boxes do. The painted wood then stays at true scale however long the trim is, and decals paint it like the walls. The light baker does the same, so the bounce light matches.
- **Corners.** At an inside corner the two runs extend to meet and cut each other into a mitre. The four outside corners get a small mitred piece.
- **Doors.** Casings on plinth blocks with rosette corner blocks (so there are no mitres to open up), and a louvered closet door with two banks of 45 degree slats.
- **A globe-bulb sconce** on all twelve lamps: an oval brass backplate, a scrolled arm and a frosted opal globe centred on the light.
- **A window at the end of the hall**, which the brief called "a faint light at the far end". It is mounted on the wall face, not cut into it, with casing, stool and apron, two six-pane sashes, and night glass showing dirt and rain runs. A dim cold spot light in front of it makes it glow.
- **Pictures and furniture.** Three paintings made from noise and aged with yellowed varnish and cracks, and a mirror whose silvering is eaten away in blotches. Nine pictures hang round the loop, each a degree or two crooked. A mahogany hall table with a drawer and a vase of dried stems sits under the mirror.

![Trim](/images/2026-09-29-materials-decals-props/trim.jpg "An outside corner, an inside crown corner, and the chair rail dying into a door casing.")

![Props](/images/2026-09-29-materials-decals-props/props.jpg "The window, the globe sconce, the mirror over the table, the seascape, the louvered closet door and the portrait.")

While building the new corners I found an older bug: the inner walls stopped 4 cm short of the corners, leaving a notch you could see into. They reach the corner now. The old trim boxes had colliders, but the new mouldings do not need any, since the walls behind them collide. The count of solid colliders fell from 56 to 34.

## Where it stood that evening

![The hallway before and after the architecture pass](/images/2026-09-29-materials-decals-props/before-after.jpg "From where the game starts, before (left) and after (right): mouldings, a chair rail, a globe sconce, pictures and a window at the end.")

The whole pass costs very little. The frame went from 2.68 to 2.78 ms on the GPU, 39 more meshes and one more light included. Baking the light for the bigger scene takes 10.6 seconds, up from a few seconds earlier in the day, because the scene went from about 4,000 to 24,000 triangles. Many of the new details sink into the dark right now. The camera and exposure pass will decide how much of them reads.

Some of it is rough. The noise-painted portrait reads as a silhouette more than as a painting. The window is a frame on the wall, not a hole in it. The mirror reflects through the probes and not a true planar reflection, so it shows the lamp but not the player. And the bakes ignore decals, so a damp stain does not darken the bounce light. These are all things I know about and can come back to.
