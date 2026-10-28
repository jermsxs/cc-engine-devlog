---
title: Authored materials, projected decals and architectural props
date: 2026-09-29
order: 4
summary: A parquet floor, plaster and painted wood made by script, projected decals for dirt, and mouldings, a window and furniture, with the theory behind them.
tags: materials, assets
cover: /images/2026-09-29-materials-decals-props/before-after.jpg
---

After the lighting work the hallway was lit plausibly, but it still looked like a model of a hallway. The reference is full of surface. It has a herringbone floor with worn lacquer, grey-green plaster with damp patches and cracks, chipped white trim and dirt where the walls meet the floor. My scene had two stock texture scans stretched over everything and plain boxes where trim should be.

I worked in two passes on the same day. The first replaced the surfaces and added a way to place dirt. The second replaced the geometry.

## PBR materials: what the maps mean

> **Background: Physically based material maps.** A physically based shader describes a surface with a few quantities and combines them with the lights using one lighting model. Mine uses these:
>
> - **Albedo** is the colour of the light the surface scatters diffusely. It must not contain baked lighting or shadows, because the renderer supplies those. For a metal, the same colour tints the reflection.
> - **The normal map** stores a surface direction in each texel, in the surface's own tangent space. The red and green channels hold the x and y of the normal, remapped from -1..1 to 0..1, and the third component is reconstructed. The shader tilts the shading normal by it, so light catches bumps and cracks that the triangles do not have. It cannot change a silhouette. The map's green channel can point up or down depending on the authoring convention, so the material records which one it uses.
> - **Roughness** is how much the microscopic surface scatters the reflection. It controls the width of the GGX distribution that shapes highlights. Low values give a tight bright highlight and sharp reflections, high values a wide dim one.
> - **Metallic** selects between a dielectric, which reflects about 4% of light at normal incidence with a white reflection and scatters the rest diffusely, and a metal, which has no diffuse term and reflects with its albedo as the colour. In my library it is a single number per material, not a map.
> - **Ambient occlusion** darkens crevices that ambient light cannot reach. I do not author an AO map for these materials. The renderer computes ambient occlusion from the depth buffer every frame.
>
> Changing the maps changes what the same geometry looks like, and no shader code changes.

My materials use albedo, normal and roughness maps, with an optional height map that nothing samples yet. On the GPU, roughness is stored in the green channel and normals as two channels, which matters later when the editor has to display them.

### Three materials made by a script

I produce the three new materials with one deterministic Python script, `build_materials.py`. Running it twice gives the same pixels, so no hand-painted files exist to lose.

- **Herringbone parquet.** Planks of 7 by 35 cm laid at 45 degrees. Each plank is cut from the Wood051 wood scan at its own offset, and its normals are rotated with the plank, since a tangent-space normal turned by the plank's angle has to be turned too. Each plank has its own tone and lacquer gloss, a few darker replacement boards, and bevelled, dirty seams. The pattern repeats exactly every 0.99 m, so tiling shows no seam. A new texture-rotation setting turns it 90 degrees in the north and south corridors, so the chevrons always point down the hall.
- **Grimy plaster.** The Plaster004 scan graded to the reference's grey-green at the brightness the previous lighting pass chose, with damp blotches, mottling, faint vertical runs, pits and raised relief in the damp areas.
- **Painted wood.** Aged off-white satin paint with horizontal brush strokes over faint grain. Small chips show an older coat and the deepest ones show bare wood. The trim uses it.

![The three materials](/images/2026-09-29-materials-decals-props/materials.jpg "Herringbone parquet (tiled 2 by 2 to check the seams), grimy plaster and painted wood.")

## Decals: dirt that goes where it belongs

A repeating texture cannot put grime above a skirting board or a stain under a leak, because it repeats everywhere. I needed dirt that I could place.

> **Background: Projected decals.** A decal is a texture applied to whatever surface lies inside a volume. In the scene there is a box. For each pixel of an ordinary surface, the shader takes the pixel's world position and converts it into the box's local space. If the point is inside the box, it reads the decal texture at the point's local X and Y, as if a projector inside the box were shining the picture along the box's depth axis, and blends the result into the surface. Nothing about the underlying geometry changes, so the decal follows any shape and wraps corners.
>
> Three rules keep it clean. The *depth fade* reduces coverage near the box's front and back faces, so the edge of the volume does not show a hard cut. The *angle fade* reduces coverage on surfaces turned away from the projection axis, because a texture projected onto a surface that is almost parallel to the projection smears. And the *blend mode* decides what the texture does: a stain multiplies the albedo, so it darkens whatever is below, while peeled paint or dust replaces it.

![A projected decal](/images/2026-09-29-materials-decals-props/decal-projection.svg "The box selects which surface pixels the decal paints, and its coverage fades near the front and back faces.")

My implementation follows that description. A decal is an entity whose transform is the box: its position and rotation place it, its scale is its size, and it faces +Z, out of the surface it sits on. The shader maps a world position into the box with a precomputed inverse transform, so the inside test is a comparison of three coordinates against 0.5. The depth fade is a smoothstep over the outer 30% of the depth. The angle fade runs from no coverage when the surface normal is 70 degrees or more from the decal's axis to full coverage at about 46 degrees. Two blend modes exist: multiply (`albedo *= lerp(1, colour, coverage)`) and alpha (`albedo = lerp(albedo, colour, coverage)`). A second texture in the atlas changes roughness and bumps, and the decal's opacity and tint are editable.

The decals change the surface's data (colour, roughness and normal) in the same code that the depth prepass runs, before any lighting. Because of that, the dirt is lit like the surface. A peeling patch catches light on its raised edges, and the reflections and ambient occlusion see the dirt too. The alternative, painting the decal over the finished image, would give a flat sticker that ignores the lights.

I painted 11 decals, by script, into one atlas: a damp patch, water-stain rings, a grime band, drip streaks, peeled paint with raised flakes, a crack, mould, scuffs, floor wear, dust and a dark splatter.

![The decal atlas](/images/2026-09-29-materials-decals-props/decal-atlas.jpg "The atlas on grey: damp, water stain, grime band, drips, peeling paint, crack, mould, scuffs, floor wear, dust and splatter.")

The demo has 131 decals. A script placed them through the editor's MCP tools: grime along every baseboard, damp and drips under the crown, a worn lane down each corridor, dust in the corners, and one faint stain in front of the locked door.

![Decals off and on, showing surface colour only](/images/2026-09-29-materials-decals-props/decals-albedo.jpg "Surface colour only, with decals off (left) and on (right): grime along the baseboards, peeling and damp high up, a crack by the lamp, and a worn lane and dust on the floor.")

Decals paint only the built-in architecture: walls, floors, ceilings and trim. Doors swing and props stand away from the wall, so a decal fixed in space would slide over them.

### Two problems

**Decals on walls did not show while decals on the floor did.** When I read an object's rotation back from the scene, I used a different order of axes from the one used to build it. A wall turned -90 degrees came back as (180, -90, 180), which describes the same box facing the other way. A symmetrical box hides that. A decal that paints only the side it faces does not. I fixed the read-back and added a test that round-trips six arbitrary rotations. Four of the six failed before the fix.

**Decals were slow.** The first version cost 0.44 ms at 1440p. Each pixel of a 17 m wall tested every decal on that wall and loaded each record whole. Two changes brought it to 0.11 ms. Each test stops at the first axis where the point is outside the box, before reading the rest of the record. And long objects now split their decal list into 2 m segments, so a pixel only considers the decals near it. The segmented lists render pixel-identical to the flat ones.

## Shapes: mouldings, a window and props

The geometry is authored by script as glTF files. I added helpers for extruding a profile along a line, mitring a moulding around a corner, closing the ends of a profile with flat caps (ear clipping, since the profiles are not convex), and sweeping a profile into a rectangular frame.

**Trim that fits any wall.** The baseboard is 0.19 m (a quarter-round shoe, a flat board, a bead and a rounded top). The chair rail sits 1 m up. The crown is a 0.17 m cove. Each is a 1 m extrusion that the scene stretches to the length of the wall. Stretching a mesh stretches its texture, so I made one engine change. A mesh whose UV set is `world_projected` takes its texture coordinates from its position in the world, as my built-in boxes do. The painted wood stays at true scale however long a run is, decals paint the trim like the walls, and the light baker follows the same rule so the bounce light matches. At an inside corner the two runs extend into each other and cut a mitre. The four outside corners get a small mitred piece.

![Trim](/images/2026-09-29-materials-decals-props/trim.jpg "An outside corner, an inside crown corner, and the chair rail ending at a door casing.")

**Doors and lamps.** The door casings have moulded legs on plinth blocks, so the baseboards end against them, and rosette blocks at the top corners, which avoids mitres that could open up. The closet door is a painted louvered door with two banks of overlapping 45 degree slats, so the closet stays hidden. All 12 lamps now use a globe-bulb sconce, with an oval brass backplate, a scrolled arm and a frosted opal globe 12 cm across, centred on the light.

**A window at the end of the hall.** My brief called for a faint light there. The window is mounted on the wall face, not cut through it, with casing, stool and apron and two six-pane sashes. The glass has a night texture seen through dirt and rain runs and glows faintly, and a dim cold spot light in front of it adds to that. The sconces reflect in the glass.

**Pictures and furniture.** Three paintings, made from noise and aged with yellowed varnish, darkened edges and fine cracks, and a mirror whose silvering is eaten away in blotches. Nine pictures hang around the loop, each a degree or two crooked. A mahogany hall table with a drawer and a vase of dried stems stands under the mirror, and a second one by the window.

![Props](/images/2026-09-29-materials-decals-props/props.jpg "The window, the globe sconce, the mirror over the table, the seascape, the louvered closet door and the portrait.")

The new corners also exposed an older fault. The inner walls running along Z stopped 4 cm short of the corners, leaving a notch that you could see into. They now reach the corner. The old trim boxes had colliders, but the mouldings need none because the walls behind them already collide, so the number of solid colliders fell from 56 to 34.

## Results

![The hallway before and after the architecture pass](/images/2026-09-29-materials-decals-props/before-after.jpg "From where the game starts, before (left) and after (right): mouldings, a chair rail, a globe sconce, pictures and a window at the end.")

The pass costs little on the GPU. At 1440p the frame went from 2.676 ms to 2.775 ms, with 39 more meshes and one more light. The start pose, which sees the most, costs 0.15 ms more. The new textures cost 0.04 ms and the decals 0.11 ms. Baking the light for the larger scene takes 10.6 s, up from a few seconds, because the scene went from 4,264 to 24,030 triangles. At the start pose the median brightness is 0.083 (the reference measures 0.118), the darkest 5% is 0.040 (0.048) and the saturation 0.31 (0.35). Those are about where the lighting pass left them, since this pass added shape and not light.

Several things are still rough. The noise-painted portrait reads as a silhouette more than as a painting. The window is a frame on the wall, not an opening. The mirror is a glossy metal that reflects through the probes and screen-space reflections, so it shows a lamp but not the player. And the light bakes ignore decals, because they use each material's average colour, so a damp stain does not darken the bounce light. Much of the new detail also sinks into the dark at the current exposure, so the camera and the final look came next.
