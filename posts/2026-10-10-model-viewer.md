---
title: A preview renderer and a Model Viewer panel for checking one asset
date: 2026-10-10
order: 1
summary: A separate preview renderer draws one mesh with the game's materials into its own texture, and a Model Viewer panel uses it to check a prop's look, size, collision and licence.
tags: editor, renderer, assets
cover: /images/2026-10-10-model-viewer/oil-lamp-view-modes.jpg
---

Real props had started to arrive, and I had no good way to check one. The only method was to place the prop in the hallway and walk up to it. Whether the prop had the right size, whether its texture was stretched and whether its back looked as good as its front were all questions that meant editing a scene and judging the result through the game's full lighting. I wanted a small window where a single asset sits on its own and I can turn it over and inspect the data behind its picture.

That took two steps. The first was a renderer that can draw a single mesh by itself. The second was a panel that puts it in the editor.

## A renderer for one mesh

### How render-to-texture works

A GPU does not have to draw to the screen. It draws into a texture that is bound as a render target, and the result can then be read like any other texture: as a picture in a UI panel, as a thumbnail, or as the input to another pass. The preview is a second, small frame rendered into its own texture.

A render target in DirectX 12 is created with a flag that allows rendering to it, and it moves through states. It is in the render-target state while the GPU draws into it, and the renderer inserts a resource barrier to move it to a readable state before the UI samples it. The barriers matter because the GPU may otherwise read a half-written image.

A render target can also be multisampled. With 4x MSAA each pixel stores four samples, and a triangle edge covers some of them and not others. A multisampled texture cannot be shown directly, so the frame ends with a resolve, which averages the four samples of each pixel into a single-sample texture. Edges come out smooth, even at the small size of a preview.

### How mine is built

The preview renderer draws one imported mesh into a 4x multisampled target, then resolves it to a single-sample image. The editor's UI shows the image like any other picture, and tests can copy its pixels back to the CPU. The format is `R8G8B8A8_UNORM_SRGB`: the shader tone-maps the colour, and the hardware encodes it to sRGB on write. Two previews can exist at once, one for the viewer and a spare that will be used for asset thumbnails.

Three decisions shaped it.

**It uses the game's look.** The preview uses the game's own material model, lighting model, wear and grime layers and tone curve, and the tone-mapping code is shared with the scene shader. A prop should look in the viewer as it will in the hallway.

**It uses none of the scene's machinery.** There is no temporal anti-aliasing, light lists, baked probes or shadow maps. The preview has its own shader, its own constants and its own descriptors, and a shader test checks that it never reads the scene's per-frame data. Showing a preview therefore cannot change or slow the game's picture. I checked it. A 1440p hallway benchmark before and after had GPU frame times within 0.6% at all six poses, and the screenshots were identical, with 0.0% of pixels changed. The preview itself costs about 0.02 ms of GPU time for the 20,000-triangle oil lamp at 384 by 384.

**It has two lighting setups.**

- *Studio* is a warm key light, a cool fill and a rim light from behind. The lights turn with the camera, so whichever side I look at is lit.
- *Dim hallway* is one warm lamp above and to the side, with almost no ambient light. It shows a prop in the light it will live in, with most of the object in shadow, which is the look I am after. A test checks that this rig is far darker than the studio rig.

### Framing the camera

The camera is an orbit around a target, defined by a yaw, a pitch and a distance. Given a mesh's bounds, the preview computes the distance at which the whole model fits. It takes the bounding sphere's radius and the narrower of the vertical and horizontal half-angles of the view, because a wide panel is limited by height and a tall one by width:

```text
distance = radius / sin(halfAngle * (1 - margin))
```

A sphere of radius r fits inside a cone of half-angle a when the camera is r / sin(a) from its centre. The camera sits at a three-quarter angle from the front and a little above. The front is the side wall props face. The near and far planes are set from the same distance, so a small prop and a door both keep their depth precision. Tests check that every bounding-box corner stays in view at three image shapes and several angles.

### Seven ways to look at a model

The viewer is also a debugging tool, so it shows the data under the picture:

- **Lit**, the finished look.
- **Albedo**, the colour with no lighting.
- **Roughness**, **normals** and **baked occlusion**, the stored values.
- **UV checker**, a checkerboard on the first UV set.
- **Wireframe**, the triangle edges over the lit model, drawn in a second pass with the wireframe fill mode and a small depth bias so the lines do not fight with the surface.

> **Background: UVs.** A mesh is a surface of triangles. To paint it with an image, each vertex stores a coordinate pair, called UV, which says which point of the image it samples. A UV layout is the surface unfolded flat, like a cube opened into a cross. The UV checker draws an 8 by 8 checkerboard on every UV unit. Squares of equal size and shape mean an even layout. Stretched squares mean the texture will smear, a visible seam means two parts of the layout meet, and a mirrored letter or pattern means flipped UVs.

![The oil lamp in eight views](/images/2026-10-10-model-viewer/oil-lamp-view-modes.jpg "The Poly Haven oil lamp in studio light, dim hallway light, albedo, roughness, normals, UV checker, wireframe and occlusion.")

On a dense mesh the wireframe was too busy. At 384 pixels, the lamp's 20,000 triangles are mostly edges. The panel therefore has a slider that fades it.

## The Model Viewer panel

The panel docks on the right beside the Inspector and Look panels. I open it by double-clicking a mesh in the Assets panel, with an Open In Model Viewer button, from the command palette or the Window menu, or by starting the editor with `--model-viewer=<asset>`.

**Moving around.** Dragging spins the model like a turntable, and dragging down looks from above. A middle or right drag pans, and the model follows the mouse exactly. The wheel zooms. A double-click fits the model to the view again.

**Size.** Width, height and depth are shown under the picture. A person button stands a 1.8 m figure beside the model and frames both, so an 80 cm lamp reads at once as knee to hip height. For a prop that will sit in a corridor, that scale check is the most useful part of the panel.

**Collision.** The shape the physics would use is drawn in green: the hand-made collision pieces when the file has them, otherwise one hull around the whole mesh.

**Numbers.** The panel lists triangles, flagged over the 50,000 budget, vertices, submeshes, materials, textures and the preview's GPU cost.

**Material slots.** Each slot can take a library material. The choice is saved into the asset's sidecar, so every placed copy changes. A single copy can still be overridden in the Inspector.

**Provenance.** The panel shows where the asset came from, who made it, when it was downloaded and its licence. CC0 shows green, and any other licence on a third-party asset shows red.

![Four views of two assets in the Model Viewer](/images/2026-10-10-model-viewer/viewer-four-views.jpg "From left: the lamp with a person for scale, the lamp under the dim hallway rig, the lamp as wireframe with its collision hull in green, and the door leaf in the UV checker.")

![The Model Viewer in the editor, showing the door](/images/2026-10-10-model-viewer/editor-door-viewer.jpg "The whole editor with the door leaf open in the viewer on the right. Provenance reads authored, made in this project.")

I drove the real mouse through the panel to check it. Drag, wheel and right drag each moved the lamp as expected.

![Orbit, zoom and pan](/images/2026-10-10-model-viewer/viewer-orbit-zoom-pan.jpg "The lamp as opened, orbited, zoomed in, then panned.")

I did not want to trust my eyes for the arithmetic, so `EditorModelViewerTests` checks where points land in the image, that dragging spins and tilts the right way, that panning keeps the model under the mouse to the pixel, the zoom limits, that the figure is 1.8 m tall, on the floor and facing the camera from any angle, and that framing with the figure holds both. The lamp's 344 by 292 preview costs 0.03 ms of GPU time and the door's costs 0.04 ms.

## A bug check before moving on

Before building thumbnails on this, I looked for problems and found two.

**Resizing.** Each new panel size made the preview wait for the GPU and reallocate its target. A render target cannot be freed while the GPU may still be drawing into it, so reallocation means waiting for the GPU to go idle. Dragging a splitter would have done that on every frame. The viewer now keeps its last image, stretched, until the size has held for a quarter second with no mouse button down. That makes one reallocation per drag. I ran the smoothness check for 1,500 frames with the viewer open and redrawing every frame. Release had 0 hitches at 1.0 ms typical, and Debug had 0 hitches at 7.9 ms.

**Release crash reports had no names.** Since the crash reporter landed, Release builds carried no symbols, so a crash in the Release editor, which is what I run every day, produced bare addresses. Two crash tests also failed in Release. Release now writes symbols, and the generated code is the same. One test helper that the optimiser had inlined is kept as its own frame.

I also found two older problems and left them for the next day. Dragging a dock splitter gives frames of 17 to 30 ms even without the viewer, because the 3D viewport rebuilds its render targets at every new size, about 32 times a second. And two back-to-back runs of the same benchmark differed by up to 0.7% of pixels, a faint speckle on lit plaster, so something at startup sometimes differs.

## Results and open issues

I can open any mesh, see it in either lighting rig, compare it with a person, see its collision shape and licence, and remap its materials. All 90 test suites pass in Debug and Release, and the game's picture is unchanged.

Four items are open:

- The overlays draw over the model and not behind it. Depth-testing them would mean drawing them inside the preview pass.
- Edits to a sidecar cannot be undone.
- The splitter stutter and the benchmark mismatch are on the list for the next session.
- Asset thumbnails come next, and they will use the second preview target.
