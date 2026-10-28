---
title: Making the editor usable for daily work
date: 2026-09-30
order: 1
summary: Fixing render-target thrashing, running the real game in the editor, live material and decal editing, and a viewport that tests overlays against depth.
tags: editor, tools, performance
cover: /images/2026-09-30-editor-in-daily-use/play-closet-door.jpg
---

The editor had a new interface, and the engine had decals, probe bakes and a material library. After the look work, though, the scene had 283 entities, 131 of them decals, and the editor was unpleasant to use. The viewport hitched when I moved the camera. The Play button only locked the scene and never ran the game. Decals, probes and materials could only be changed by editing files by hand and restarting.

I wrote a short plan, Track F, with seven steps (F0 to F6), and worked through it in one day. This post covers the changes that needed the most explanation: the hitching, Play, the live material library and the depth-aware viewport.

## Finding the hitch

I measured before changing anything, with a script that flies the camera with pauses, on the build I actually ran (Debug, 2560 by 1392). While flying, the 95th percentile frame time was 17 ms. At rest it was 7 ms.

> **Background: Mean and percentile frame times.** The mean frame time hides rare slow frames, and a slow frame is what a person feels as stutter. The 95th percentile is the time that 95% of frames beat, so it shows what the slower frames look like. When the average sits near the median but the 95th percentile is far above it, a small share of frames does extra work that the rest do not. The next post covers a stricter way to find single spikes.

The extra work was in the viewport's *render scale*. The editor could draw the scene at lower resolution while the mouse was moving, to save time. The scale flipped between 1.0 and 0.67 on every frame in which the mouse moved or did not.

> **Background: Why resizing render targets is expensive.** Screen-space passes such as ambient occlusion, reflections, bloom and temporal anti-aliasing each own textures sized to the render resolution. Changing the resolution means creating new ones. D3D12 does not let a resource be released while the GPU might still read it, so the renderer must wait until the GPU has finished its queued work. That wait is a pipeline stall, and the GPU sits idle while the CPU rebuilds the targets. Temporal anti-aliasing also keeps a history of earlier frames at the old size. A new size discards it, so the first new frame has no history and shows more noise.

Each flip recreated about twenty targets (colour, depth, the prepass targets, the bloom chain, Hi-Z, AO, SSR, the probe target, the TAA history), up to 21 times a second, and restarted the TAA history each time.

Three other costs were adding to the 17 ms:

- The editor ran in Debug. My launch script only knew the Debug build, where the UI alone costs 5–6 ms a frame, against 0.3 ms in Release.
- The validation model, which checks the scene for problems, was rebuilt every second and whenever the log file changed. It walks every entity with linear lookups, so it had grown about six-fold with the decals and props.
- The overlay (grid, icons, gizmos) rebuilt its camera matrix for every line and point, searched every entity for an icon each frame, and drew about 170 icons, one per decal.

My fixes: the render scale changes once when a flight, orbit, pan or gizmo drag starts, and once 0.35 s after it ends, and only if the preference "Lower resolution while moving" asks for it. That preference is off by default. The validation model rebuilds only when the scene revision, the asset scan or the log changed, at most four times a second, and never during a drag. The overlay computes its matrix once per frame and gathers its icons once per scene change. Decals have a small icon that shows only when I turn on View > Decal Icons or select the decal. And `Launch-Editor.ps1` now runs the Release build.

| Measure | Before | After |
|---|---|---|
| Debug, flying: CPU mean / p95 | 8.7–10.1 / 16–17 ms | 7.0–7.4 / 7.1 ms |
| Release, flying: CPU mean / p95 | 1.1–2.2 / 6.2 ms | 1.7 / 1.8–2.1 ms |
| Scene targets recreated while flying | up to 21 per second | 0 |

The Debug frame is still CPU-bound, with the UI build taking 4.6 to 5 ms of it, and my 6 ms target for Debug was not quite reached. Release is the build to work in.

## Play runs the game in the viewport

The Play button locked the scene because the game's frame lived in `Runtime::Application`, which compiles only into the game executable. Its parts (the player controller, doors, interaction queries, the physics world and trigger tracking) were already in a library that the editor links. I moved the frame into `Runtime::GameSession`, with three entry points:

- **Start.** Find the player start by tag, name or first camera, set up doors and physics, and settle the player's capsule onto the floor.
- **Step**, once per frame. Walk and look, update triggers, doors and focus, handle the E key, and build the render view.
- **Events out.** Sounds are events that the host plays, so a session has no dependency on an audio device.

`Application` shrank from about 890 lines to 600 lines. It hosts a session, and every command-line flag and the title overlay behave as before. The editor's Play button starts a session on a copy of the working scene. In the viewport I click to take the mouse, walk with W A S D, hold Shift to go slowly, press E to interact and press Esc to release the mouse. The editor keeps a snapshot of the scene, its path, kind and dirty flag, and Stop restores it, so playing never leaves the scene modified. While playing, plain keys belong to the game through a separate shortcut context, editing is locked, and MCP edits are refused with a message that names the command that stops Play. "Play From Here" starts from the editor camera.

![Playing in the viewport](/images/2026-09-30-editor-in-daily-use/play-closet-door.jpg "Play From Here at the closet door: the focus cue, the E prompt and the door leaf swinging open in the editor's viewport.")

## Decals, probes and bakes from the editor

The UI could draw only shapes, text and icons, so a decal or a material map could be named but not seen. I added image quads to the draw list. Each draw command carries the texture its image quads sample, and the renderer loads a file once through the same cache as material textures, into one of 64 UI slots. Colour textures are re-encoded for the UI's sRGB target and data textures are shown as stored.

That made three features possible:

- **A decal picker** that shows each library decal as its atlas cell. The Assets panel has a Decals view with tiles and use counts. Dragging a tile onto a wall places it there.
- **Placing decals on surfaces.** Create > Decal casts a ray through the collider world and puts the decal on the surface it hits, with its +Z along the surface normal. On floors, the camera's yaw keeps it upright on screen. Surface Snap does the same during a drag. Surfaces are found through colliders, so a prop without one cannot be snapped onto.
- **Baking without guessing.** The bake already ran on a worker thread, but nothing showed progress or allowed cancelling. The status bar now has a progress bar with Cancel, and a stale or missing bake gets a Bake button. Because the bake lands next to the scene file but describes the scene in memory, Bake asks first when there are unsaved changes. The MCP `lighting_bake` tool no longer freezes the editor: it starts the same worker-thread bake and returns at once.

![The Assets panel's Decals view](/images/2026-09-30-editor-in-daily-use/assets-decals.jpg "Tiles with how many scene decals use each one (Damp patch 21, Peeling paint 12), the hovered tile's tooltip and the selected decal's preview.")

Driving this by hand found two bugs. The UI shader used a register space, which shader model 5.0 does not have, so the editor failed to start. And the script that rebuilds the decal atlas was given a relative path, so its working directory was empty.

## The material library, live

Materials were read-only in the editor. The file `materials.json` defines the plaster, parquet and painted wood, and changing a wall's roughness meant editing JSON and restarting.

The library is now a document owned by `EditorSession`, next to the scene, so the editor, the command line and MCP share it. Its edits go on the same undo stack as scene edits, as a different kind of history entry. Undoing a roughness drag restores the roughness without marking the scene as modified, and the library tracks its own unsaved state. Saving writes the library back in its own order and keeps what it does not understand: unknown keys survive, aliases become canonical keys, and 0.9 is written as 0.9, not 0.8999999761.

The Materials panel previews albedo times colour, roughness times its factor, and the normal map. The first previews showed roughness pink and normals olive. The GPU stores roughness in the green channel with red forced to 1, and normals as two channels, so raw display looks wrong. The UI image modes gained "green as grey", "red as grey" and "normal with blue filled in".

> **Background: Updating a material while the GPU is drawing.** A D3D12 material is a set of texture *descriptors* (small records the shader reads that point at textures) plus a constant buffer. A draw that is in flight reads them, so changing them freely would corrupt a frame. The safe route is to wait for the GPU once and then rewrite each descriptor and constant in place. Rewriting in place matters because a slider drag produces many edits, and creating new descriptors for each one would use new memory every time.

The renderer takes the editor's working copy before the next frame, waits for the GPU once and rewrites each loaded material's five texture descriptors and constants. It also keeps the copy for materials that load later. That last part came from a test: in the headless MCP renderer nothing was loaded when the first edit arrived, and the material then loaded from disk unedited.

![Roughness dragged to zero](/images/2026-09-30-editor-in-daily-use/materials-roughness-zero.jpg "The plaster's roughness dragged to 0 in the Materials panel: the walls and ceiling turn glossy in the viewport at once. I undid it afterwards.")

Dragging the panel's roughness slider to 0 made the walls and ceiling glossy as one undo step, with the scene not dirty, and Ctrl+Z restored them. The light bakes still read the saved file, and their key does not cover material values, so a colour change does not mark the lighting stale. Covering it would change the key of the committed bakes.

## A viewport that reads depth

Two problems made the viewport hard to read. The overlay ignored the scene, so in a furnished corridor the collider boxes and lamp icons of rooms behind walls drew on top of everything. And a selected picture showed a bounding box that stood off the wall and hid what it outlined.

> **Background: Perspective-correct depth for overlay lines.** To test an overlay line against the scene, the shader needs the line's distance from the camera at each pixel. Linear interpolation of depth across the screen is wrong for a line that recedes in perspective, because depth is not linear in screen space. Its reciprocal is. So each vertex carries `1 / depth`, the rasteriser interpolates that linearly, and the pixel shader inverts it.

The editor draws its overlay with its own UI, so instead of writing a second line renderer I let UI quads carry a distance from the camera. The UI pass compares it with the scene's depth (the first level of the Hi-Z pyramid, which holds the prepass depth) and draws whatever is behind a surface at a fifth of its strength. Lines lying on a surface, such as the grid on the floor, get a small slack that grows with distance so they still show. The gizmo and selected icons always show in full, and View > Overlay Through Walls restores the old behaviour.

![Overlay lines fade behind walls](/images/2026-09-30-editor-in-daily-use/overlay-fades-behind-walls.jpg "Collider wireframes: edges on the corridor's walls are full, the boxes of the rooms behind them are faint.")

![Overlay through walls](/images/2026-09-30-editor-in-daily-use/overlay-through-walls.jpg "The same view with View > Overlay Through Walls: everything in full strength.")

For selection, the renderer draws the selected meshes again after the depth prepass into a small mask, with value 1 where they are the nearest surface and 0.35 where something is in front. The UI pass then finds the mask's edge. For each pixel it reads the mask at the pixel and at 12 taps around it (a cross one pixel out and a ring two pixels out), and where a neighbour has a higher value than the pixel itself, it draws the outline colour. The result is an outline two pixels wide, full where the object is visible and faint where it is hidden. My first version sampled 25 texels per pixel and cost 0.16 ms, and 12 are enough. The whole UI pass with an outline costs 0.065 ms.

![The selection outline](/images/2026-09-30-editor-in-daily-use/selection-outline.jpg "Two pictures selected, outlined along their frames in place of a box.")

The outline is drawn after post-processing, so near the frame edges the lens distortion can put it a pixel or two away from the object.

## Smaller changes

- **Undo back to saved.** After undoing a change the editor still asked to save a scene that matched its file. Each history step now has an id, the session remembers the id at which it was saved, and undo or redo compare against it.
- **New Scene** (Ctrl+N) creates an untitled scene with the open scene's look, a player start, a 10 m floor with a collider and a light, so Play works at once.
- **Texture thumbnails** in the Assets panel. The UI had 64 image slots and stopped showing images once they were taken, and with 51 textures plus the Materials panel and decal picker that would run out. A slot unused for a few frames is now handed to the next image, after no frame in flight can still read it.
- **Placement.** A mesh created on a wall now hangs on it with its back against the wall, and while dragging, the hint reads out the move and whether it snaps. Ctrl turns snapping over.
- **The asset browser kept only the first 32 of the project's 98 files**, so most meshes could not be found or dragged. It now keeps them all.

## Results and open issues

The test suite passes (66 of 66), the validation script passes, and I checked each feature by hand with real mouse and keyboard input, reading results back through MCP. The Debug editor still sits at about 7 ms a frame because the UI build is the cost. Mesh thumbnails need a small offscreen render per mesh. The first view of a texture that no material uses cooks it on the main thread, a one-time pause. Editing one property across several selected entities and triangle-accurate picking are still missing. A different stutter appeared later the same day, which is the subject of the next post.
