---
title: A new editor, built on my own UI library
date: 2026-09-29
order: 2
summary: How my immediate-mode UI draws text from a glyph atlas, icons from paths and shapes in the pixel shader, plus three rendering faults I fixed.
tags: editor, tools
cover: /images/2026-09-29-a-new-editor/after-default.jpg
---

At the end of September the engine could render a believable dark hallway, but the tool I used to build it was still a prototype. It had a row of 17 text buttons, panels with small `L R B F X` buttons, and a "Profiler" panel that held everything with no other home. Some features could only be reached by remembering a hotkey. Text widths were estimated, so labels never lined up with what was drawn.

I decided to rebuild the editor so that every implemented feature had a menu entry, a panel or a command, and I started with the layer underneath it, the UI library. The same day I play-tested the demo and fixed three rendering faults that I noticed, so those are in this post too.

![The old editor](/images/2026-09-29-a-new-editor/before-baseline.jpg "Before: text buttons, estimated text widths and panels with their own mini toolbars.")

## How an immediate-mode UI builds a frame

The engine has no ImGui or other UI dependency. The editor draws itself with the same D3D12 device as the game, using a library in `Engine/UI` that depends only on the Windows SDK.

> **Background: Immediate-mode and retained-mode UI.** A retained-mode UI creates widget objects once, keeps them in a tree and updates them through events. An immediate-mode UI keeps no widget objects. Each frame the program calls functions such as `if (Button("Save")) { Save(); }`. The call does three things at once: it computes the widget's rectangle, it checks the mouse against that rectangle, and it records what to draw. It returns true on the frame the button was clicked. The UI is rebuilt every frame from the program's own data, so it cannot disagree with that data. The cost is that layout and hit-testing run every frame, so the code must stay cheap.

My library follows that model, with four pieces that matter for how it behaves.

1. **Identity.** A widget that must keep state between frames, such as a pressed button or a scroll position, needs a stable identity without an object to hold it. The library hashes the stack of enclosing names and the widget's label into a 64-bit id. Text after `##` in a label is part of the hash but is not shown, so two buttons can both read "Delete". Ids do not depend on what was drawn earlier in the frame.
2. **Interaction.** The context remembers a hovered id and an active id. A click is a press and a release on the same active widget over the same rectangle, which is what lets a drag leave a button without clicking it.
3. **Layout.** Layout is a cursor. A column hands out the next full-width row with `NextRow()`, and a scroll area clips its rows and remembers its offset by id. Long lists only submit the rows in view.
4. **A draw list.** Widgets do not draw. They append rectangles, glyph quads and image quads to a list, in three layers (base, floating, tooltip) so popups draw over everything regardless of call order. At the end of the frame the list becomes one vertex buffer and one index buffer, and the renderer issues one draw call for each run of quads that share a clip rectangle and a texture.

The last point is why the UI costs little on the GPU. In the final editor the UI pass takes 0.02 to 0.04 ms.

## Text: a glyph atlas

A GPU draws triangles. It has no concept of a letter, so text has to become triangles with a texture on them.

> **Background: Glyph atlases.** Rasterising a glyph from a font outline is expensive and the result never changes for a given font, size and weight. So the usual approach is to rasterise every character that might be needed once, pack the bitmaps into one texture (the *atlas*) and record, for each character, its rectangle in the atlas, its *advance* (how far to move the pen afterwards) and its offsets from the pen position. To draw a string, the code walks the characters, adds one textured quad per glyph at the pen position and moves the pen by each advance. The atlas stores only coverage, a single value from 0 to 1 per texel, and the pixel shader multiplies the text colour by it. Because the same table that draws the text also measures it, widths are exact.

![How "Save" becomes four textured quads](/images/2026-09-29-a-new-editor/ui-text-atlas.svg "Each glyph is a quad whose UV rectangle crops one cell out of the atlas.")

My implementation does this at startup in `UIAtlasBuilder`:

- **Rasterising.** DirectWrite supplies Segoe UI at five faces: 12 px, 13 px, 13 px semibold, 15 px semibold (dialog titles) and 15 px semilight (the game's HUD). Direct2D draws each glyph into a WIC bitmap with grayscale anti-aliasing, and I keep the alpha channel as the coverage byte. I use grayscale anti-aliasing because the atlas holds one coverage value per texel, and sub-pixel (ClearType) rendering needs three values per pixel and assumes a particular pixel layout.
- **Packing.** A shelf packer fills rows of a 1,024-texel-wide atlas, one texel apart. Each glyph cell is padded by 30% of the font size so soft edges are not clipped, and a pass afterwards tightens each glyph to its non-empty pixels.
- **Coverage.** The atlas covers Latin-1 plus the ellipsis and bullet characters. Advances are rounded to whole pixels, so every glyph lands on a pixel boundary and stays sharp. The cost is that spacing is slightly coarser than a font's design metrics, and text outside Latin-1 cannot be shown.
- **Measurement.** `TextWidth`, `FitCharacters`, `Ellipsize` and `Wrap` all read the atlas's own advances. Before this, I estimated widths with a fixed average and the estimate never matched what was drawn.
- **Scale.** The atlas is built for the monitor's DPI scale, and all layout is in logical pixels that the draw list multiplies by the scale and snaps to the physical pixel grid. `--ui-scale` sets it by hand.

## Icons: vector paths in the same atlas

The editor has 76 icons and none is an image file. Each is a short string in code, written in SVG path syntax on a 16 by 16 grid, for example `M`, `L`, `Q`, `C`, `A` and `Z` commands plus two shorthands for circles and rounded rectangles. An icon is a stroked outline, a filled shape or both. At startup Direct2D rasterises every path with a 1.35-unit round stroke, at two sizes (16 and 20 logical pixels) and at the physical size for the current DPI, into the same atlas as the text.

This choice has three consequences. Icons are crisp at any scale because they are rasterised for it. They are single-colour coverage masks, so the shader can tint them with the theme or the state, but they cannot be multi-coloured. And an icon is drawn exactly as a glyph is, so icons and text share a texture and batch into one draw call.

## Rounded shapes in the pixel shader

Rounded corners, borders and soft shadows are not geometry. Every shape is one quad, and the pixel shader works out the shape from a signed distance.

> **Background: Signed distance shapes.** A signed distance function returns, for any point, the distance to a shape's edge: negative inside, positive outside. For a rounded box it has a closed form. Take the point's offset from the centre, fold it into one quadrant with `abs`, subtract the half-size minus the corner radius, and measure the length of what remains. Coverage for anti-aliasing is then `saturate(0.5 - distance)`, a one-pixel ramp across the edge that is correct at any size. A border is the same distance compared against the stroke width. A shadow is a wider ramp of the same distance with a smooth falloff.

```hlsl
float2 q = abs(position) - halfSize + radius;
float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
float inside = saturate(0.5 - distance);
```

Each vertex carries its position from the shape's centre, its half-size, its radius and the stroke or blur, so the shader needs no per-shape constants. The same shader handles text, icons, images, gradients and the colour-picker square, selected by a `kind` field in each vertex. A vertex is 56 bytes and indices are 32-bit, which removed an earlier cap of 65,536 vertices. Clipping, for a scrolling list that cuts its rows off, uses the GPU's scissor rectangle per draw command, not per-pixel tests.

![The UI gallery](/images/2026-09-29-a-new-editor/gallery.jpg "The `--ui-gallery` screen shows every widget at once: fields, tree lists, colour swatches, 76 icons and the text faces.")

I added a `--ui-gallery` mode that shows every widget on one screen, and I used it to check each widget at scale 1.0 and 1.5 before building the editor on it.

## The workspace

With real widgets, the editor is a normal desktop application: a title bar that holds the menus, a toolbar, three docks with tabbed panels, and a status bar. Tabs drag between docks and the layout is saved. The window frame is the editor's own, and it still snaps, resizes and maximises.

![The redesigned editor](/images/2026-09-29-a-new-editor/after-default.jpg "After: menus, toolbar, Outliner on the left, Inspector and Look on the right, and Assets, Console, Validation, Materials and Renderer along the bottom.")

Every command lives in exactly one menu, and a test checks that. It is also in the command palette (Ctrl+P) and can be given a shortcut. A new Renderer panel replaced the Profiler. It lists the 16 debug views by name, the pass toggles, a frame-time plot, and GPU and CPU time per pass.

I also changed how the camera behaves:

| Before | After |
|---|---|
| Camera locked to the corridor | Hold the right button to fly, Alt-drag to orbit, middle button to pan |
| Sticky mouse capture toggled by F1 | The mouse is captured only while a button is held |
| Only meshes could be picked | Lights, cameras, triggers and colliders are picked by their icons |
| A click on an object started moving it | A click selects; moving needs a drag on a handle |
| Top, Front and Side were perspective views | They are orthographic and cut through the scene, so the ceiling does not hide the room |

Every edit now goes through one session object, so undo is reliable and the MCP server sees the same history I do. Quitting with unsaved work asks first.

To test it I sent real mouse and keyboard input to the running editor and read the results back through the tool interface. That found four bugs: the palette's search box did not receive the keyboard, pressing the edge of a splitter started a selection box, Focus on a group framed its origin instead of its contents, and the Assets panel was empty when the editor started from another folder.

The timings, at 2560 by 1392 on an RTX 4070:

| | Before (Debug) | After (Debug) | After (Release) |
|---|---|---|---|
| Whole frame, CPU | 8.4–9.2 ms | 6.2 ms | 1.3 ms |
| UI build | 5.3 ms | 4.6 ms | 0.31 ms |
| UI to vertices and draw calls | 1.6 ms | 0.17 ms | 0.03 ms |

My target was 1.5 ms of UI time in a Debug build, and I did not reach it. The 4.6 ms is spread evenly over the panels (left dock 1.0, right 1.3, bottom 0.7, the rest 1.6), so no single widget is responsible. It is the cost of unoptimised code, and the Release build runs the same work about fifteen times faster.

## Three faults from play-testing

### Smeared screen edges

Standing against a wall, a strip along the edge of the screen looked streaked.

> **Background: Lens distortion.** A barrel-distortion pass simulates a wide lens by moving each output pixel's lookup point outward from the centre by an amount that grows with the square of its distance from the centre. The picture bows outward, like a photograph taken through a fisheye. Because the lookups are pushed outward, those near the corners can land outside the source image. A sampler set to clamp returns the nearest edge texel for such lookups, so a whole row of output pixels repeats the last row of the image. That repetition shows as streaks, and a bright wall close to the camera makes them obvious.

At my setting (0.014) the corner lookups landed 2.8% beyond the image, about 54 pixels at 1920 wide. My fix is to scale the warped image about its centre so that the corners land just inside the border. In the shader the lookup is:

```hlsl
scale = (1 + k * r2) / (1 + 2 * k) * (1 - 2 * margin);   // r2 = cx*cx + cy*cy, 2 at a corner
```

At a corner `r2` is 2, so the scale reduces to `1 - 2 * margin`: the corner lands exactly `margin` inside the image. The margin leaves room for the colour-fringe taps and the blur taps, so no sample reads outside the image at any setting. The price is a 2.8% crop at the demo's setting, which is the usual trade in games. I also changed chromatic aberration, which splits the red and blue lookups. It used to shift the whole frame sideways by a constant. It now grows with distance from the centre and is zero at the centre, as it is in a real lens. A new test checks, for every setting the schema allows, that every border pixel's lookups stay inside the image.

![A screen corner before and after](/images/2026-09-29-a-new-editor/edge-corner.jpg "The top-left corner, enlarged and brightened. Left: repeated pixels smear into streaks. Right: clean.")

### A floor that looked wet

The floor under the lamps looked like liquid. I found three causes, in order of size.

The floor's roughness setting is a *multiplier* on the wood texture's own roughness. I had set 0.135 on a texture of about 0.55, so the real roughness was about 0.07, nearly a mirror. I raised the multiplier to 0.55, an effective roughness of about 0.30 (a satin varnish), and relabelled the Inspector field "Roughness (multiplier)".

Second, screen-space reflections followed the normal-mapped grain. On a mirror-like surface the grain tilts the reflected ray by about 16 degrees either way, which bends a lamp's reflection into ripples. The normal that the screen-space passes read now fades toward the flat surface normal on surfaces with roughness below 0.3. The lighting itself still uses the full normal map. I also made the blur of glossy reflections use a *Karis average*, which weights each tap by `1 / (1 + luma)`, so a single very bright bulb pixel cannot dominate the average and flicker.

Third, distant grain changed faster than a pixel can resolve, so each frame picked a different glint. This is specular aliasing. My fix is specular anti-aliasing after Tokuyoshi and Kaplanyan: the roughness of each pixel widens by the screen-space variance of its normal, estimated from the derivatives across the pixel. Rapidly changing normals therefore give a broader highlight instead of a noisy one. The strength is a scene setting (variance 0.25, threshold 0.18).

I measured the flicker over six headless frames walking at 2.75 cm per frame, counting the share of floor pixels whose brightness jumped by more than 12 of 255 between frames:

| | Pixels flickering | 99th percentile change |
|---|---|---|
| Before | 0.78% | 9.0 |
| After | 0.02% | 5.9 |
| Old mirror floor with the new engine changes | 0.63% | 8.1 |

Most of the gain comes from the roughness. The engine changes are safety nets for glossy materials, and on a true mirror a lamp's own highlight still ripples along the grain.

![The floor before and after](/images/2026-09-29-a-new-editor/floor.jpg "Left: lamps broken into a rippling streak. Right: a soft satin sheen.")

### Gaps at the corners

While checking the floor I found that the hallway builder cut the north-south floors and ceilings 4 cm short at each end, leaving an 8 cm crack at all four corners of the loop. They now meet the east-west pieces exactly. A new test samples a 2 cm grid over the whole loop and checks that every point has a floor and a ceiling above and below it. It fails on the old builder.

![The gap in the corner, before and after](/images/2026-09-29-a-new-editor/corner-gap.jpg "Looking into the south-west corner. Left: the crack. Right: closed.")

## Results and open issues

The editor now looks like a tool, and every control in it does something. The UI library costs 0.31 ms of CPU per frame in Release.

Still missing: a New Scene command, a silhouette outline for the selection (a bounding box is drawn for now), editing one property across several selected entities, and triangle-accurate picking. Icons and the gizmo draw through walls. Undoing back to the saved state still counts as a change. The floor is still one continuous slab of wood grain with no plank seams, and no shader work will turn that into a parquet floor, so the next materials pass authors one.
