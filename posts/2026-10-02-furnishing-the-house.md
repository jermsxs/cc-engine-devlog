---
title: Furnishing the house, and chasing flicker
date: 2026-10-02
order: 1
summary: Furniture, wallpaper, tile and fixtures fill the empty rooms, assets reload without a restart, and z-fighting gets hunted down by a script.
tags: assets, scene, tools
cover: /images/2026-10-02-furnishing-the-house/kitchen-after.jpg
---

The house had walls, doors, lamps and a few frames, but no bed in the bedroom, no table in the dining room, no bath in the bathroom. Every wall was the same grimy plaster in a different tint. Against the question I keep asking of this project ("is it too clean?"), the rooms failed: nothing said that someone had lived here.

So the day went to furnishing. Along the way I hit two tooling problems worth writing about: the editor could not reload an asset after it changed, and a flickering artifact called z-fighting.

## Furniture, made from nothing

Everything here is authored from scratch with scripts that write glTF files (a standard 3D model format). No outside assets. Seven pieces came first:

- a mahogany double bed, made up and slept in, with a turned-down sheet and dented pillows;
- a painted pine cot with one slat missing and another snapped;
- a dining chair with turned front legs and a velvet seat;
- an armchair in faded oxblood velvet;
- a heavy dining table;
- a wardrobe with one door standing ajar on a dark inside;
- a cast-iron claw-foot bath with a rust run under the taps.

To make cloth and cushions, the mesh builder got a cushion shape: a box with rounded edges, subdivided densely near the edges, rumpled by smooth noise and sagging in the middle. The bath is a shell swept through rings of rounded rectangles, rolling over the rim and down the inside.

Looking at the first results caught plenty. The first wallpaper pattern read like a cartoon and was redrawn as a proper mirrored damask. The velvet had camouflage blotches. The cot's chips looked like leopard spots. The bath's inside faced the wrong way, because each normal was oriented on its own, so the shell now keeps one orientation along the sweep. The pillows were boxy, so they became rounder.

## Wallpaper and tile on one side of a wall

New materials were next: crazed off-white wall tile with grey-green grout, a worn black-and-white checkerboard floor, and faded damask wallpaper on half-metre rolls with water stains and lifting seams.

There was a catch. The house's walls are single boxes shared by two rooms. If you set a wall to wallpaper, you paper both sides, and the dining room's pattern shows in the kitchen. So the editor got a new compound, `wall_finish`, that takes a *room box* instead. It finds the walls whose faces bound the room and lays thin panels on that side only. Doorways have already split their walls into pieces, so the panels stop at them, and windows get a hole.

Then the second round of fixtures: a cast-iron kitchen range with a kettle on the hob, a run of green cupboards with a butler sink and brass taps, a pedestal basin, and a high-cistern toilet with a pull chain. Ceramics first came out bright clean white and glowed against the grimy tile, so the glaze got a tint. The first cast iron was covered in big rust blotches (the velvet's mistake again), so it is now mostly black with fine, dull rust.

![The kitchen with a tiled splashback, butler sink and checkerboard floor](/images/2026-10-02-furnishing-the-house/kitchen-after.jpg "The kitchen after the fixtures: cupboards and butler sink under a tiled splashback, a checkerboard floor, and the dining table moved between them.")

## Hot reload

Authoring all of this exposed the editor's worst habit. Once it had loaded a mesh or texture, it kept that copy until it closed. Every round of "too bright, darker please" meant regenerating the file, restarting the editor, reloading the scene and finding the camera again. Furnishing took about half a dozen restarts.

> **Concept: Hot reload.** The editor watches files on disk. When one changes, it throws away the stale copy it has in memory (and, for a game, on the graphics card) and loads the new one, while the program keeps running. The GPU side is the fiddly part: a mesh lives in GPU buffers, and a texture lives in a *descriptor*, a small table entry the shader looks up. You cannot free either while a frame in flight is still using it.

In this engine there were three separate caches to get past: the mesh registry (geometry per file), the material registry (textures shared by path), and the decal atlases.

- **Noticing changes.** A small watcher polls the assets folder once a second (150 files, about 1 ms). It only reports a file once its size and timestamp have held for a poll, so it never reads a half-written PNG, and only if the *content* actually changed. My furniture script rewrites all sixty-odd outputs every run; reloading all of them to pick up one cot would be wasteful. The first poll's content hashes are taken on a worker thread, so 190 MB of assets do not slow the start.
- **Meshes.** A changed glTF's mesh is dropped and imported again on the next frame. Its material slots go to a free list so repeated reloads do not run the descriptor heap dry.
- **Textures.** The registry remembers which material sits in which descriptor block. A changed texture is dropped, and every material using it is rewritten in the block it already has. Nothing else has to be re-created.
- The shadow cache is redrawn too. My first test showed it was needed: the new shape still cast the old outline.

There is also an MCP tool that checks right now and lists what changed, so an agent can regenerate a piece and screenshot it in the next call.

To test it I left the editor open on the nursery, edited the cot's script to paint it red and stretch its posts, and ran it. Two seconds later the editor showed the tall red cot with the shadows following. Running the original script put it back.

![The red, tall cot in the nursery after hot reload](/images/2026-10-02-furnishing-the-house/cot-changed.jpg "The regenerated cot appears with no restart: new texture, new mesh, shadows redrawn.")

## Z-fighting

Walking the finished house, two glitches stood out: the bottom of the walls shimmered, and the inside of the toilet looked broken. Both were the same fault.

> **Theory: Depth precision and z-fighting.** To decide which surface is in front, the GPU stores a depth value per pixel and keeps the nearest. That value has limited precision (and less the further away you look). When two surfaces sit on exactly the same plane and face the same way, their depths are equal or differ only by rounding noise, so each pixel picks one or the other, and which one changes as the camera moves. You see a flickering sawtooth. The cure is never to put two visible surfaces on the same plane: sink one in or stand it out by a few millimetres.

The toilet was a clean example. The top of the pedestal sat exactly at the water's height, so glaze and water fought in a sawtooth, and the box modelling the trap rose 6 cm into the bowl and showed through the water.

![The toilet bowl before the fix, with a jagged edge where surfaces fight](/images/2026-10-02-furnishing-the-house/toilet-before.jpg "Before: glaze and water on the same plane make a jagged sawtooth, and the trap pokes through.")

![The toilet bowl after the fix](/images/2026-10-02-furnishing-the-house/toilet-after.jpg "After: the pedestal and trap stop under the bowl, and the bowl has a bottom.")

The bigger one was on every papered wall. A wall-finish panel is a box, and a box cannot be thinner than its two faces, so the paper's face stood 1 cm out from the wall. The baseboard's flat face is also 1 cm out. Same plane, so the wallpaper pattern printed straight through every baseboard. A finish's `thickness` now means how far its face stands out of the wall: the box keeps its 1 cm and the rest sinks into the wall. Paper sits 4 mm out and tile 8 mm, both safely behind the baseboards' 10 and 12 mm faces.

![The baseboard before: the wallpaper pattern prints through it](/images/2026-10-02-furnishing-the-house/baseboard-before.jpg "Before: at a low angle, the paper's motif runs across the baseboard.")

![The baseboard after: the board is solid](/images/2026-10-02-furnishing-the-house/baseboard-after.jpg "After: the same build with the paper sunk behind the board.")

The same fault turned up in many smaller places: tile floors flush with doorway thresholds, the upper floor's slab lying on the faces of the hall walls, the door leaf's core on the stiles' edges, the wardrobe's back running over its sides, and the stairs' bottom post lying on the first riser. Each part is now set in or out by 1 to 5 mm. The bathroom's grime bands, stretched over 3 m, smeared into streaks that also looked like a glitch, so they are 1.2 m pieces now.

## Finding them all

Two faults showed up on screen, but I did not want to rely on spotting the rest by eye. I wrote a small script that places every box and glTF mesh as the engine does, then lists any triangles that share a plane (within 1.5 mm), face the same way and overlap. It skips faces buried inside a solid, since nobody sees those. On the house it found 1,300 pairs. Most were buried. The real ones led to every fix above, and afterwards only buried faces and slivers under 1 cm remain.

The costs were small: the bench stayed within run-to-run noise, from -4.5% to +6.2% GPU time per pose. Still open: the tile grime is a horizontal band that wants a decal drawn for tile, and the script cannot see faces buried inside a glTF, so it is not yet a test that can fail a build.

By the end of the day every room had something in it, and the rooms I had been calling empty finally felt lived in. The next step was making the surfaces themselves hold up at close range.
