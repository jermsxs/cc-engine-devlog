---
title: Making the editor usable every day
date: 2026-09-30
order: 1
summary: No more hitching, Play runs the real game inside the editor, decals, bakes and materials are editable, and the viewport finally understands depth.
tags: editor, tools, performance
cover: /images/2026-09-30-editor-in-daily-use/play-closet-door.jpg
---

The editor had a new face, and the engine had decals, probe bakes and a material library. But after the look work, the scene had 283 entities, 131 of them decals, and the editor felt bad to use. It lagged when I moved the camera. The Play button only locked the scene and never ran the game. Decals, probes and materials could only be changed by hand-editing files. I made a short plan I called Track F, for "the editor in daily use", and worked through it in one day.

## No more hitching

I measured with a script that flew the camera with pauses, so I was not guessing. The numbers were clear: while flying, the frame time's 95th percentile was 17 ms, against 7 ms at rest. Something happened on some frames and not others.

The cause was the viewport's *render scale*. The editor could draw the scene at lower resolution while the mouse was moving, to save time. But it flipped between 1.0 and 0.67 on every frame where the mouse did or did not move. Each flip made the renderer wait for the GPU and then recreate about twenty render targets (colour, depth, the bloom chain, ambient occlusion, the TAA history and so on). That happened up to 21 times a second, and the anti-aliasing history restarted every time.

Three other things were adding to it:

- The validation model, which checks the scene for problems, was rebuilt every second, and it walks every entity with linear lookups.
- The overlay (the grid, icons and gizmos) rebuilt its camera matrix for every line.
- It drew about 170 icons, one for each decal.

The fixes were simple once I could see them. The scale now changes once when a flight starts and once 0.35 s after it ends, and only if a preference asks for it. It is off by default. Validation rebuilds only when the scene changed, at most four times a second. Decals get a small icon that shows only when selected or when I turn it on.

| Flying, Release build | Before | After |
|---|---|---|
| CPU frame, average / 95th percentile | 1.1–2.2 / 6.2 ms | 1.7 / 1.8–2.1 ms |
| Scene targets recreated per second | up to 21 | 0 |

The launch script also ran the Debug build, where the UI alone costs 5–6 ms a frame, so it now runs Release.

## Play runs the game

All the game's frame logic lived inside the game's own executable, though almost every part of it (the player controller, doors, interaction, physics, triggers) was already in a library the editor links. I moved the frame into a `GameSession` object that both the game and the editor can drive. The game executable shrank by a third, and a test suite now exercises the session without a window.

![Playing inside the editor](/images/2026-09-30-editor-in-daily-use/play-closet-door.jpg "Play From Here: walking up to the closet door in the editor's viewport, with the focus cue, the prompt and the door ready to swing.")

Play (Ctrl+Enter) starts a session on the working scene. Click the viewport to take the mouse, walk with W A S D, press E to interact, and Esc gives the mouse back. The viewport renders the player's camera, with all its effects. **Play From Here** starts from wherever the editor camera is. Stop puts the scene back exactly as it was, because the editor keeps a snapshot. While playing, editing is locked and tool edits from the MCP server are refused with a message that says how to stop.

A bug found on the way: stopping through the tool interface marked the scene as changed, because the tool host treats any revision change during a call as an edit.

## Decals, probes and bakes from the editor

Until then the editor could not *show* a decal or a texture. Its UI drew only shapes, text and icons. So I added image quads to the draw list. Each draw command now carries the texture its images sample from, and a texture is loaded once and shared with the renderer, so the decal atlas costs no extra memory.

With images, a decal picker became possible. It shows every library decal as its picture on a plaster-coloured background. Before, the field was a free-text id with a note beside it that said "not used by the game yet". That note had been wrong since decals shipped.

![The Assets panel's decal view](/images/2026-09-30-editor-in-daily-use/assets-decals.jpg "Decals as tiles, with how many are used in the scene (Damp patch 21, Peeling paint 12). Drag one onto a wall to place it.")

Several smaller tools came with it:

- **Decals land on surfaces.** Creating a decal raycasts through the middle of the view and stands the box on whatever it hits, turned to face out of the surface. **Surface Snap** does the same while dragging.
- **Probes from the Create menu**, for both probe types.
- **Baking with feedback.** Bake Lighting runs on a worker thread. The status bar now shows a progress bar and a Cancel button, and offers a Bake button when the bake is stale. The bake lands next to the scene file but describes the scene in memory, so with unsaved changes it asks first. An agent starting a bake through MCP also returns at once instead of freezing the editor.

## The material library

The plaster, parquet and painted wood are defined in one JSON file, and until now the editor could only list which maps existed. Changing a wall's roughness meant editing JSON and restarting.

The library is now a document owned by the editing session, next to the scene. Its edits go on the same undo stack: Ctrl+Z after a roughness drag puts the roughness back without marking the scene unsaved. The Materials panel is a real editor: a list with swatches and use counts, a preview of colour, roughness and normal map, and fields for each value and each map.

The viewport follows at once. The renderer waits for the GPU one time, then rewrites each loaded material in place: its five texture descriptors and its constants. A slider drag therefore allocates nothing.

![The Materials panel](/images/2026-09-30-editor-in-daily-use/materials-panel.jpg "The grimy plaster selected: swatches in the list, how many meshes use each, and previews of albedo, roughness and the normal map.")

The first previews were wrong in a way that taught me something. Roughness showed pink and normal maps olive, because the GPU stores roughness in the green channel (with red forced to 1) and normals as two channels. The preview now offers "green as grey" and "normal with blue filled in" modes. In the headless renderer, a test also caught a first edit being lost, because the material was loaded from disk *after* the edit arrived. Now the renderer keeps the edited copy for materials that load later too.

## A viewport that reads depth

With everything visible, the overlay was a mess. Grid lines, collider boxes and the icons of lamps in other rooms all drew on top of the scene, so a furnished corridor was a tangle of lines from rooms I could not see.

> **Concept: Depth testing an overlay.** The scene already has a *depth buffer*: for every pixel, how far away the nearest surface is. To hide something behind a wall, you compare its distance to the depth buffer at that pixel. If something is nearer, it is hidden.

Instead of writing a second line renderer, I let the UI's own quads carry a distance from the camera. The UI pass compares it with the depth buffer and draws what is behind a surface at a fifth of its strength. Lines that lie *on* a surface, like the grid on the floor or a collider on its wall, get a little slack so they still show. The gizmo and the selected item always draw in full. A View menu option shows everything through walls, as before.

![The overlay fading behind walls](/images/2026-09-30-editor-in-daily-use/overlay-fades-behind-walls.jpg "Collider wireframes on: the corridor's edges are full, the rooms behind them faint, and the lamp icons behind the left wall are faded.")

Selection had a similar problem. A selected picture got a bounding box that stood off the wall and hid what it outlined. Now the renderer draws the selected meshes again, after the depth prepass, into a small mask, full where they are the nearest surface and faint where something is in front. The UI pass outlines that mask two pixels wide in the accent colour.

![Two pictures selected, outlined along their frames](/images/2026-09-30-editor-in-daily-use/selection-outline.jpg "The pictures are outlined along their frames, not boxed. The whole UI pass costs 0.065 ms.")

A mesh created on a wall now hangs on it, with its back against the wall. My first try hung a frame on the wall back to front, because the authored frames all face their local minus Z. Hovering a drag now reads out the move so far and whether it is snapping, and holding Ctrl flips snapping for that drag.

I also found that the Assets panel's file list had only ever kept the first 32 of the project's 98 files. That is why most meshes could not be found by search.

## Saved state, New Scene and thumbnails

The last step was a list of rough edges:

- **Undo back to saved.** Change a light, undo it, and the editor still said there were unsaved changes. Each history step now has its own id and the session remembers which one it was saved at, so undoing back to it makes the scene clean again.
- **New Scene** (Ctrl+N). Before, starting from nothing meant deleting 283 entities. It now gives an untitled scene with the open scene's look, a player start, a floor and a light, so Play works at once.
- **Texture thumbnails.** The Assets panel shows the images themselves, with the details pane showing a preview and size. The UI image system had only 64 slots and quietly stopped showing pictures once they were all used. A slot not used for a few frames is now handed to the next image, once no frame in flight can still read it.

![Texture thumbnails in the Assets panel](/images/2026-09-30-editor-in-daily-use/texture-thumbnails-close.jpg "Normal maps shown as XY, roughness as grey, and the lookup tables for colour grading.")

## Where it ended

I tested each step by driving the editor with real mouse and keyboard input and reading the results back through MCP. To check slot reuse, I cut the slot count to 8 for one build and scrolled the list up and down. It still showed the right pictures. At the end of the day, 66 of 66 tests passed.

Still open: mesh thumbnails (they need a small offscreen render each), cooking textures on a worker thread, editing one property across several selected objects, and picking that is accurate to the triangle. The Debug editor also still costs about 7 ms a frame, which is down to the UI build itself.
