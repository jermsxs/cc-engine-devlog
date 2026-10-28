---
title: A new editor, and a UI library to build it
date: 2026-09-29
order: 2
summary: I rebuilt the editor around menus, tabbed docks and a free camera, on a UI library I wrote myself, and fixed three things I saw while play-testing.
tags: editor, tools
cover: /images/2026-09-29-a-new-editor/after-default.jpg
---

By the end of September the engine could render a convincing dark hallway, but the tool I used to build it looked like a debug screen. It was a row of seventeen text buttons, panels with tiny `L R B F X` buttons, and a "Profiler" panel that held everything that had no other home. Some features could only be reached by remembering a hotkey.

I wanted an editor I would be happy to hand to someone else. So I spent the day rebuilding it, and I started with the thing underneath it: the UI library.

![The old editor, a grid of text buttons and plain panels](/images/2026-09-29-a-new-editor/before-baseline.jpg "Before: text buttons, estimated text widths, panels that scroll off the screen.")

## Drawing a UI without a UI library

The engine has no ImGui or any other UI dependency. Everything is written from scratch, and the editor draws itself with the same GPU the game uses. That sounds scary, but an *immediate-mode* UI is a simple idea.

> **Concept: Immediate-mode UI.** In a classic ("retained") UI you create a button object once, keep it around, and wire up events. In an immediate-mode UI there are no objects. Every frame, your code simply runs `if (Button("Save")) { save(); }`. The call both draws the button *and* tells you whether it was clicked this frame. The UI is rebuilt from scratch sixty times a second, so it can never get out of sync with your data.

Behind that friendly call, each frame the library does three things:

1. **Layout and logic.** Widgets work out where they are, check the mouse and keyboard, and return results.
2. **A draw list.** Instead of drawing right away, each widget appends *shapes* (rectangles, text quads, images) to one big list.
3. **One GPU pass.** At the end of the frame the list becomes vertex data and goes to the GPU in a handful of draw calls.

### Text

Drawing words is the part that surprises people. A GPU does not know what a letter is. It only draws triangles with textures on them. So the library turns text into textured quads.

> **In practice: The glyph atlas.** At startup the editor asks Windows (DirectWrite) to render every character it might need in Segoe UI into one texture, called an *atlas*, and remembers where each letter sits in it. To draw "Save", it adds four small quads, each one cropping its own letter out of the atlas. Because the same engine measures the glyphs, the widths are *real*. Before this, I estimated how wide text would be, and the estimate never matched what was drawn.

### Icons

The editor has 76 icons, and none of them are image files. Each one is a vector path written as a short string in code, much like an SVG path ("move here, curve there, line to this point"). At startup, Direct2D draws every path into the same atlas texture as the letters. So an icon is just another cropped quad, and icons and text share one texture and batch into the same draw call.

### Rounded shapes

Rounded corners, borders and soft drop shadows come from the pixel shader, not from geometry. A button is a single rectangle, and for each pixel the shader computes the distance to a rounded box and uses it to fade the edge. This keeps the vertex count tiny and removed an old cap of 65,536 vertices. Clipping (a scrolling list cutting off its rows) is done with the GPU's scissor rectangle.

![The widget gallery](/images/2026-09-29-a-new-editor/gallery.jpg "The gallery screen shows every widget at once: fields, tree lists, colour swatches, the 76 icons and the text styles.")

The library also follows the monitor's DPI, so text is sharp at any scale. A `--ui-gallery` mode shows every widget on one screen, which is how I tested the look.

## The workspace

With real widgets, the layout is a normal desktop application: a title bar that holds the menus, a toolbar, three docks that hold tabbed panels, and a status bar. Tabs can be dragged between docks, and the layout is remembered. The window frame is the editor's own, but it still snaps, resizes and maximises like a normal window.

![The redesigned editor](/images/2026-09-29-a-new-editor/after-default.jpg "After: menus, toolbar, Outliner on the left, Inspector and Look on the right, Assets, Console, Validation, Materials and Renderer tabs at the bottom.")

Every command now has a home. Each one lives in exactly one menu, and a test checks that. It is also in the command palette (Ctrl+P) and can be given a shortcut. A new **Renderer** panel replaced the old Profiler. It lists the 16 debug views by name, the pass toggles, a frame-time plot, and GPU and CPU time per pass.

## A camera that behaves

The old editor camera was locked to one height and to the corridor, and a click could start dragging an object. The rules are now the ones people expect from other tools:

| Before | After |
|---|---|
| Camera locked to the corridor | Hold the right mouse button to fly, Alt-drag to orbit, middle button to pan |
| A sticky mouse capture toggled by F1 | The mouse is captured only while a button is held |
| Only meshes could be picked | Lights, cameras, triggers and colliders are picked by their icons |
| A click started moving the object | A click only selects. Moving needs a drag on a handle |
| Top, Front and Side were perspective views | They are true orthographic views that slice the scene, so the ceiling does not hide the room |

I also made every edit go through one session object, so undo is reliable, and so the MCP server (the way AI agents drive the editor) sees the same history as I do. Quitting with unsaved work now asks, instead of silently losing it.

I tested all of this by sending real mouse and keyboard input to the running editor and reading the results back through the tool interface. That caught a few bugs. The palette's search box did not get the keyboard, pressing the edge of a splitter started a selection box, and "Focus" on a group framed its origin instead of its contents.

A frame in the Debug build still costs about 6 ms, of which the UI is 4.6 ms. I had hoped for 1.5 ms, and missed. The cost is spread evenly over every panel and it is the cost of unoptimised code: in the Release build the same UI takes 0.31 ms.

## Play-test fixes the same day

Later that day I walked around the demo and noticed three problems.

**Smeared screen edges.** Standing against a wall, a strip along the edge of the screen looked like streaks. The cause was *lens distortion*. The post-processing pass bends the image outwards by moving each pixel's lookup point toward the edge. At my setting, the corner lookups landed about 54 pixels *outside* the picture, and the texture sampler repeats the last row and column when it runs out of image, which makes streaks. Now the warped image is scaled so its corners land just inside the border. The price is a 2.8% crop, which is normal for lens distortion in games. I also made chromatic aberration (colour fringing) grow from nothing at the centre to full strength at the edges, like a real lens, instead of shifting the whole frame sideways.

![A screen corner before and after](/images/2026-09-29-a-new-editor/edge-corner.jpg "The top-left corner, zoomed in and brightened. Left: repeated pixels smeared into streaks. Right: clean.")

**A floor that looked wet.** There were three causes, in order of size:

- The floor's roughness setting is a *multiplier* on the wood texture's own roughness, and I had set it so low that the floor was close to a mirror.
- Screen-space reflections followed the wood grain, bending the lamp's reflection into ripples like water.
- Distant grain changed so fast between pixels that highlights flickered from frame to frame.

I raised the roughness to a satin varnish, made the reflection passes see a calmer normal on very glossy surfaces, and added *specular anti-aliasing*, which makes a pixel rougher when its surface normal changes quickly across it. In a six-frame walk test, 0.78% of floor pixels flickered before and 0.02% after.

![The floor before and after](/images/2026-09-29-a-new-editor/floor.jpg "Left: lamps broken into a rippling streak. Right: a soft satin sheen.")

**Gaps at the corners.** While checking the floor I found that the builder had cut the floors and ceilings 4 cm short at each end, leaving an 8 cm crack at all four corners of the loop. A new test checks a 2 cm grid across the whole loop to confirm there is a floor and a ceiling under every point.

![The gap in the corner, before and after](/images/2026-09-29-a-new-editor/corner-gap.jpg "Looking into the south-west corner. Left: the crack. Right: closed.")

## Where it ended

The editor now looks like a tool and not a prototype, and every button in it does something. It is still missing a few things: a New Scene command, a proper silhouette outline for the selection, and picking that is accurate to the triangle. Icons also draw through walls for now. The floor itself is still one continuous slab of wood grain, which no amount of shader work will turn into a real parquet floor. That became the plan for the materials work a little later.
