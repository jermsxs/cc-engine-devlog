---
title: Furniture, asset hot reload and removing z-fighting
date: 2026-10-02
order: 1
summary: I authored furniture, wallpaper and tile for the empty house, made assets reload without restarting the editor, and removed z-fighting with a script that finds coplanar faces.
tags: assets, scene, tools
cover: /images/2026-10-02-furnishing-the-house/kitchen-after.jpg
---

The house had walls, doors, lamps and a few picture frames, but no bed in the bedroom, no table in the dining room and no bath in the bathroom. Every wall was the same grimy plaster in a different tint. The question I ask of every milestone is whether the scene is too clean, and the rooms failed it: nothing in them said that someone had lived there.

I spent the day furnishing them. Two tooling problems came up on the way and each needed a proper fix: the editor could not reload an asset after it changed on disk, and several surfaces flickered because they shared a plane.

## Authoring furniture

All of it is authored from scratch. A Python script, `build_furniture.py`, writes glTF files and their textures, with no outside assets. The first set was a mahogany double bed, a painted pine cot, a dining chair, an armchair, a dining table, a wardrobe with one door ajar and a cast-iron claw-foot bath.

Two shapes had to be added to my mesh builder. Cloth needed a cushion: a box with rounded edges, subdivided densely near the edges, displaced by smooth noise and sagging in the middle. The bath needed a shell: a sweep through rings of rounded rectangles that rolls over the rim and down the inside.

Looking at the first renders caught several mistakes, which I fixed in the generators:

- The first wallpaper motif read as a cartoon. I redrew it as a mirrored damask.
- The velvet had large camouflage-like blotches of wear, so I made the worn patches subtler.
- The cot's paint chips looked like leopard spots, so they became smaller and sparser.
- The bath's inside faced the wrong way. Each ring of the sweep oriented its normals independently, so some flipped. The shell now keeps one orientation along the whole sweep.
- The wardrobe's grain read as huge waves on large panels, so the grain is finer there.

A second round added a cast-iron kitchen range with a kettle on the hob, a run of green cupboards with a butler sink and brass taps, a pedestal basin and a high-cistern toilet with a pull chain. The ceramics first came out bright white and glowed against the grimy tile, so the glaze got a tint option and is aged to a grey cream. The first cast iron repeated the velvet's mistake with large rust blotches. It is now mostly black with fine, dull rust.

![The kitchen with a tiled splashback, butler sink and checkerboard floor](/images/2026-10-02-furnishing-the-house/kitchen-after.jpg "The kitchen after the second round of fixtures: cupboards and a butler sink under a tiled splashback, a checkerboard floor, and the dining table moved between them.")

## Papering one side of a wall

I also wrote three materials: crazed off-white wall tile with grey-green grout, a worn black-and-white checkerboard floor, and faded damask wallpaper on half-metre rolls with water stains and lifting seams. The wallpaper is printed in neutral cream so each room can tint it.

The house's walls are single boxes shared by two rooms. Setting a wall's material to wallpaper would paper both sides, so the dining room's pattern would show in the kitchen. I added a `wall_finish` compound that takes a room box instead. It finds the walls whose faces bound the room and lays thin panels on the room's side only. Doorways have already split their walls into pieces, so the panels stop at them, and windows get a hole. The bathroom's tile is the same compound with a shallower room box and a thicker panel.

## Hot reload

Authoring all of this showed the editor's worst habit for asset work. Once it had loaded a mesh or a texture it kept that copy until it closed. Every round of "too bright, make it darker" meant regenerating the file, restarting the editor, reloading the scene and finding the camera again. The two furnishing sessions took about half a dozen restarts.

> **Background: file watching and GPU resource reload.** Reloading has two halves. The first is noticing that a file changed. Operating systems offer change notifications (on Windows, `ReadDirectoryChangesW`), or a program can poll: list the folder periodically and compare timestamps and sizes. Both have a problem with files that are still being written, because a notification can arrive while a generator has only half of a PNG on disk. The second half is replacing the resource. A mesh lives in GPU buffers and a texture lives in GPU memory, referenced through a descriptor, a small table entry that a shader looks up. The GPU may still be executing earlier frames that read the old resource, so it cannot be freed or overwritten until those frames have finished.

I chose polling. A small watcher in `AssetWatch` lists the asset root once a second: about 150 files, roughly 1 ms. Three rules keep it from doing wasted work:

- A changed file is reported only after its size and timestamp have stayed the same for one more poll, so a half-written file is never read.
- A file is reported only if its content digest changed. My furniture script rewrites all sixty-odd outputs on every run, and reloading all of them to pick up one cot would be slow.
- The digests for the first poll are taken on a worker thread, so 190 MB of assets do not delay the editor's start.

For the second half I chose the simplest safe rule. When the renderer applies a reload, it first waits for the GPU to finish the frames in flight, and then replaces resources in place. A reload is a rare, user-initiated event, so one short stall costs less than tracking the lifetime of every old resource. There were three caches to deal with:

- **The mesh registry**, which holds geometry per glTF file. A changed mesh is dropped and imported again on the next frame. Its material slots return to a free list, so repeated reloads do not exhaust the descriptor heap.
- **The material registry**, which shares textures by path. It remembers which material sits in which descriptor block, so a changed texture is dropped from the cache and every material that uses it is rewritten in the block it already has. Nothing else has to be re-created.
- **The decal atlases**, plus the asset browser's thumbnails and the decal picker, which reload for the same reason.

My first test showed one more requirement. The shadow cache kept the old outline of a regenerated shape, so it is invalidated and redrawn as part of a reload.

An MCP tool, `assets_reload`, checks immediately and lists what changed, so an agent can regenerate a piece and take a screenshot in the next call, in the live editor or headless.

To test it I left the editor open on the nursery, edited the cot's script to paint it red and stretch its posts to 1.4 m, and ran it. Two seconds later the editor showed the tall red cot with its shadows following. Running the original script put it back, and the files on disk came back byte-identical. The log showed the content check working: the script rewrote every furniture file, and the editor reloaded one material and one mesh.

![The red, tall cot in the nursery after a reload](/images/2026-10-02-furnishing-the-house/cot-changed.jpg "The regenerated cot appears without a restart: new texture, new mesh, shadows redrawn.")

The poll shows in the frame profile as `update.assets` at no more than 1.3 ms, once a second, and the smoothness check still passes. Two limits remain. A mesh whose shape changes does not mark the lighting bake stale, because the bake key covers a mesh's id and not its file, so I rebake after a large change. And `materials.json` is not watched, because the material panel edits it.

## Z-fighting

Walking the furnished house, I noticed two glitches. The bottom of the walls shimmered, and the inside of the toilet looked broken. Both were the same fault.

> **Background: depth precision and z-fighting.** To decide which surface is nearest, the GPU stores a depth value per pixel and keeps the smaller one. With a standard perspective projection that value is not linear in distance. For near plane `n` and far plane `f`, a surface at view distance `z` stores `d = f / (f - n) * (1 - n / z)`. Nearby space gets most of the range: with `n = 0.05 m` and `f = 80 m`, half of the range is used up by 0.1 m. The buffer holds 32-bit floats, so the smallest step it can represent depends on where the value sits.
>
> When two surfaces lie on the same plane and face the same way, their true depths are equal. The depth values the rasterizer computes for each triangle differ by rounding noise, because each triangle's vertices went through slightly different arithmetic. Which triangle wins therefore changes from pixel to pixel and from frame to frame as the camera moves, and the result is a flickering sawtooth. The cure is to never put two visible surfaces on the same plane: sink one in or stand it out by several depth steps.

I computed the size of one depth step from that formula, using my camera component's default planes of 0.05 m and 80 m. The renderer uses the standard mapping, not reversed depth: a 32-bit float buffer cleared to 1.0 with a less-than comparison.

| View distance | Stored depth | Smallest depth step |
|---|---|---|
| 0.5 m | 0.9006 | 0.0003 mm |
| 2 m | 0.9756 | 0.005 mm |
| 5 m | 0.9906 | 0.03 mm |
| 20 m | 0.9981 | 0.5 mm |
| 80 m | 1.0 | 7.6 mm |

These are the steps the format can represent, and the real error in interpolated depth can be larger. In a house, where sight lines are short, a separation of 1 to 5 mm is many steps, which is why the fixes below move surfaces by that amount.

I found these cases and fixed each in the generator or compound that produced it.

**The toilet.** The top of the pedestal sat exactly at the water's height, so glaze and water fought in a sawtooth. Under them, the box modelling the trap rose 6 cm into the bowl and showed through the water. The pedestal and the trap now both stop under the bowl's floor, and the bowl has a bottom.

![The toilet bowl before the fix, with a jagged edge where surfaces fight](/images/2026-10-02-furnishing-the-house/toilet-before.jpg "Before: glaze and water on one plane make a jagged edge inside the bowl.")

![The toilet bowl after the fix](/images/2026-10-02-furnishing-the-house/toilet-after.jpg "After: the pedestal and trap stop under the bowl and the water is a clean surface.")

**Every papered wall.** This was the larger case. A wall-finish panel is a box, and a box cannot be thinner than its two faces, so the paper's face stood 1 cm out from the wall. The baseboard's flat face is also 1 cm out. Same plane, so the wallpaper pattern printed straight through every baseboard. A finish's `thickness` now means how far its face stands out of the wall. The box keeps its 1 cm and the rest sinks into the wall. Paper sits 4 mm out and tile 8 mm, both behind the baseboards' 10 and 12 mm faces.

![The baseboard before the fix: the wallpaper pattern prints through it](/images/2026-10-02-furnishing-the-house/baseboard-before.jpg "Before: at a low angle the paper's motif runs across the baseboard.")

![The baseboard after the fix](/images/2026-10-02-furnishing-the-house/baseboard-after.jpg "After: the same build with the paper sunk behind the board.")

**Smaller cases of the same fault.**

- The kitchen and bathroom tile floors were 4 mm above the boards, exactly flush with the doorway thresholds. The tile is now 2 mm up and the thresholds lap over it.
- The upper slab's cut edges lay on the faces of the hall walls that run down past them, and the landing fascia shared its top with the floor. The slab now stops 2 cm inside the walls, the upper walls start inside the slab, and the fascia stands 1 cm proud.
- Parts of furniture and joinery lay on each other's faces: the door leaf's core on the stiles' edges, the wardrobe's back over its sides, the chair's seat frame on the legs, the bottom newel on the first riser. Each part is set in or out by 1 to 5 mm.
- The bathroom's grime bands were stretched over 3 to 3.6 m, so their texture smeared into streaks that read as another glitch. They are now 1.2 m pieces.

## Finding the rest

Two faults showed up on screen, and I did not want to depend on spotting the others by eye. `Tools/LevelAuthoring/find_zfighting.py` places every box and glTF mesh as the engine does. It then lists every pair of triangles that lie in one plane within 1.5 mm, face the same way and overlap. It skips faces buried inside a solid, because nobody sees them, such as a wall's end inside the next wall.

On the house it first found 1,300 pairs. Most were buried. The real ones led to every fix above. Afterwards it lists only faces buried inside meshes and slivers under 1 cm squared, such as the mitred corners of the chair rails.

## Results and open issues

Every room has furniture, paper or tile, and the bench stayed within run-to-run noise: GPU time per pose moved from -4.5 percent to +6.2 percent after the z-fighting fixes, with the largest move on a noisy 95th-percentile pose. The furniture itself added at most 0.05 ms per pose, and every pose stays at 1.2 to 1.6 ms.

Open items:

- The tile's grime is still a horizontal band. A grime decal made for tile, darker in the grout, would read better.
- `find_zfighting.py` cannot see faces buried inside a glTF, so it cannot yet run as a test that fails a build. Checking each point against the mesh's own closed parts would fix that.
- A rug and curtains are still missing.
- Material variants in the library, so that a tint is set once and not on every entity, and prefabs for furnished rooms.
