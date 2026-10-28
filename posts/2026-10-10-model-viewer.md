---
title: A model on its own, and a viewer to turn it over
date: 2026-10-10
order: 1
summary: A separate preview renderer draws one mesh with the game's own lighting, and the Model Viewer panel lets me orbit, measure and check a prop before using it.
tags: editor, renderer, assets
cover: /images/2026-10-10-model-viewer/oil-lamp-view-modes.jpg
---

Once real props started arriving, I hit an annoying workflow gap. The only way to look at a prop was to place it in the hallway and walk up to it. Is it the right size? Is the texture stretched? Does the back look as good as the front? Each question meant editing a scene. What I wanted was a small window where one asset sits on its own and I can turn it over in my hands.

That took two steps: a renderer that can draw a single mesh by itself, and a panel that puts it in the editor.

## A renderer for one mesh

The preview renderer draws one imported mesh into its own small image. The editor shows that image like any other picture, and tests can read the pixels straight back.

> **Concept: Render target.** A GPU does not have to draw to the screen. It can draw into a texture instead, called a *render target*, and the result can then be used as an image: in a UI panel, as a thumbnail, or as input to another pass. The preview is just a second, tiny frame rendered into its own texture.

Three decisions shaped it.

**Same look as the game.** It uses the game's own materials, lighting model, wear and grime layers, and tone curve. A prop should look in the viewer the way it will look in the hallway. It also uses 4x multisample anti-aliasing (MSAA, which samples each edge several times) so edges are clean at a small size.

**None of the scene's machinery.** No temporal anti-aliasing, light lists, baked probes or shadow maps. Showing a preview therefore cannot change or slow the game's picture. I checked that: a 1440p benchmark of the hallway, before and after, had GPU frame times within 0.6% at all six poses, and the screenshots were identical, 0.0% of pixels changed. The preview itself costs about 0.02 ms of GPU time for the 20,000-triangle oil lamp.

**Two lighting setups.** *Studio* is a warm key light, a cool fill and a rim light from behind, and they turn with the camera, so whichever side you look at is lit. *Dim hallway* is one warm lamp above and to the side with almost no ambient light. It is a way to judge a prop in the light it will actually live in: most of the object sits in shadow, which is the look I am after.

Framing is automatic. Given a mesh's bounds, the camera backs off until the whole model fits, at a three-quarter angle from the front and slightly above.

### Seven ways to look at a model

The viewer is also a debugging tool, so it can show the data underneath the picture:

- **Lit**, the finished look.
- **Albedo**, the colour alone with no lighting.
- **Roughness**, **normals** and **baked occlusion**, the raw data.
- **UV checker**, a checkerboard texture that shows stretched, seamed or flipped texture layouts.
- **Wireframe**, the triangle edges over the lit model.

> **Concept: UVs.** A mesh is a surface made of triangles. To paint it with an image, each vertex gets a coordinate pair called *UV* that says which spot of the image it samples. Unfold a cube into a cross shape and flatten it: that is a UV layout. If squares of the checker look stretched or squashed on the model, the layout is distorting the texture.

![The oil lamp in eight views](/images/2026-10-10-model-viewer/oil-lamp-view-modes.jpg "The Poly Haven oil lamp in studio light, dim hallway light, albedo, roughness, normals, UV checker, wireframe and occlusion.")

On a dense mesh the wireframe turned out too busy: at 384 pixels, 20,000 triangles are mostly edges, so the panel got a slider to fade it.

## The Model Viewer panel

The panel docks on the right, beside the Inspector and Look panels. Double-click a mesh in the Assets panel, use the Open In Model Viewer button, or the command palette, and it opens.

**Moving around.** Drag to spin it like a turntable; drag down to look from above. Middle or right drag pans, and the model follows the mouse exactly. The wheel zooms. Double-click fits the model to the view again.

**Size.** Width, height and depth are shown under the picture. A person button stands a 1.8 m figure beside the model and frames both, so an 80 cm lamp reads as "knee to hip height" at a glance. For a prop that is going to sit in a corridor, that scale check is worth the whole panel.

**Collision.** The shape the physics would use is drawn in green: the hand-made collision pieces when the file has them, or else one hull around everything.

**Numbers.** Triangles (flagged over a 50,000 budget), vertices, submeshes, materials, textures, and what the preview costs on the GPU.

**Material slots.** Each slot can take a library material, and the choice is saved into the asset's sidecar, so every placed copy changes. A single copy can still be overridden in the Inspector.

**Provenance.** Where the asset came from, who made it, when it was downloaded and its licence. CC0 shows green; anything else shows red.

![Four views of two assets in the Model Viewer](/images/2026-10-10-model-viewer/viewer-four-views.jpg "The lamp with a person for scale, under the dim hallway rig, as wireframe with its collision hull in green, and the door leaf in the UV checker.")

![The Model Viewer in the editor, showing the door](/images/2026-10-10-model-viewer/editor-door-viewer.jpg "The whole editor with the door leaf open in the viewer on the right. Provenance reads authored, made in this project.")

I drove the real mouse through the panel to check it: drag, wheel, right drag. The lamp moved as expected each time.

![Orbit, zoom and pan](/images/2026-10-10-model-viewer/viewer-orbit-zoom-pan.jpg "As opened, orbited, zoomed in, then panned.")

A test covers the maths so that I do not have to trust my eyes: where points land in the image, that dragging spins and tilts the right way, that panning keeps the model under the mouse to the pixel, the zoom limits, that the figure is 1.8 m tall and faces the camera from any angle, and that framing with the figure holds both.

## A bug-check before moving on

Before building on this, I went looking for trouble and found two problems.

**Resizing.** Each new panel size made the preview wait for the GPU and reallocate its target. Dragging a splitter would do that on every frame. Now the viewer keeps its last image, stretched, until the size has held for a quarter second with no mouse button down. That makes one reallocation per drag.

**Release crashes had no names.** Since the crash reporter landed, Release builds carried no symbols, so a crash in the Release editor, which is what I actually run day to day, gave bare addresses. Two crash tests also failed in Release. Release now writes symbols (the generated code is the same), and one test helper that the optimizer had inlined away is kept as its own frame.

I also found two problems that predate this work and left them alone for the moment. Dragging a dock splitter gives 17 to 30 ms frames even without the viewer, because the 3D viewport rebuilds its render targets at every new size. And two back-to-back runs of the same benchmark differed by up to 0.7% of pixels, a faint speckle on lit plaster, so something at startup sometimes differs.

## Where it ended up

I can now open any mesh, see it in either lighting rig, check its size against a person, see its collision shape and licence, and remap its materials. The game's picture is untouched. Still open: the overlays draw over the model rather than behind it, because depth-testing them would mean drawing them inside the preview pass; sidecar edits cannot be undone; and I want thumbnails for the asset browser, which can reuse this renderer. The two older problems, the splitter stutter and the benchmark mismatch, are on the list for the next day.
