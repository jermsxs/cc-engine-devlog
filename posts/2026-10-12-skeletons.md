---
title: Skeleton import, a pose runtime and GPU skinning
date: 2026-10-12
order: 1
summary: Skeletons, skin weights and clips come in from glTF, a pose runtime samples and blends them, and the GPU skins the mesh. Mesh thumbnails and a repeatable benchmark came first.
tags: animation, assets, editor
cover: /images/2026-10-12-skeletons/scene-rest-vs-posed.jpg
---

Everything in the engine had been static. The day had two parts. The first part cleaned up two problems left over from the Model Viewer, a stuttering splitter and a benchmark that did not repeat, and gave the asset browser pictures of its meshes. The second part started skeletal animation: the importer learned to keep a skeleton, a runtime learned to pose it, and the GPU learned to bend a mesh around it.

## Two fixes and one measurement problem

**The splitter.** Dragging a dock splitter gave frames of 17 to 30 ms. Each pixel the 3D viewport grew or shrank made the renderer wait for the GPU and rebuild all of its scene targets, about 32 times a second. While the size is changing, the editor now keeps the old targets and stretches them over the new rectangle, and it rebuilds them once after the size has held for a quarter of a second. Dragging the real splitter with the real mouse, the worst frames fell from 17 to 30 ms to about 1.1 ms, with one 17 ms rebuild when the drag stops. The cost is a slightly soft picture during the drag.

**The benchmark.** My benchmark mode flies the camera through fixed poses and records timings and a screenshot. Two runs of the same build differed by up to 149 out of 255 in places, so the picture flipped between a sharp state and a smeared one. A comparison tool that disagrees with itself cannot measure anything. The cause was a feedback loop. The flashlight's bounce light reads the lit picture back and turns it into a light. In bench mode it followed that reading without smoothing, so a tiny difference in one GPU frame grew into a visible difference, and TAA, fog and auto-exposure kept it for about 100 frames. I pinned the sources of variation: the world advances a fixed 1/60 s per frame, each pose clears the bounce, its pending readbacks, the cached shadow tiles and the TAA and fog histories, and the screenshot comes from 128 extra untimed frames in which the GPU finishes each frame before the next. Over five runs the screenshots now differ by at most 3 out of 255, and the timings did not change. A small residual remains and I have not found its source.

![The old bench in two states](/images/2026-10-12-skeletons/bench-old-two-states.jpg "The same frame of the same build in two runs, sharp (top) and smeared (middle), and the difference between them (bottom).")

**BC7 textures.** The texture cache could not read BC7 entries back, because one value was missing from its list of known encodings. Every BC7 cache file was discarded as unreadable, and about 20 MB of base colours were compressed again on every launch. A round-trip test now covers it.

## Thumbnails

A mesh in the Assets panel had been a blue cube and a file name. Each `.gltf` now shows a 160 by 160 picture in the list and in a new grid view. The picture is the mesh alone, framed from its own size, from the front and slightly above, in the Model Viewer's studio light with the materials its sidecar gives it. It uses the second preview target from the previous step.

### How a thumbnail cache works

A thumbnail is a render-to-texture result that is read back to the CPU and stored. Two decisions make it practical:

- **Make it once, key it by content.** A thumbnail is made the first time a mesh is shown, so a large library costs nothing until it is browsed. It is stored as a PNG named by a hash of every file in the mesh's folder: the mesh, its buffers, its textures and its sidecar. When any of them changes, the name changes and a new picture is made. Nothing has to remember to delete the old one.
- **Never stall the frame.** Reading pixels from the GPU is slow if the CPU waits for the GPU to finish. The renderer copies the image into a readback buffer and the CPU collects it a frame or two later, after a fence says the copy is complete.

### The first version stalled the editor

The first version froze the editor for up to half a second per mesh. The picture itself is cheap, about 0.02 ms of GPU time. The stall was the mesh's textures being block-compressed on the frame the mesh was first drawn. Each thumbnail now passes through three stages:

1. Warm-up on a worker thread: load the mesh and compress its textures into the texture cache.
2. Render on the frame, at most two per frame, with the readback collected later.
3. Store on a worker thread: write the PNG and prepare it for the UI.

With the furniture folder in the grid and empty caches, the first version had a 477 ms frame and nine hitches. The final version has one 26 ms frame, when the first two thumbnails upload together, and on the second launch nothing is rendered. Folder listings are shared between meshes in the same folder, because listing the 60-file furniture folder once per mesh had cost a 20 ms frame.

![Mesh thumbnails in the grid view](/images/2026-10-12-skeletons/assets-grid.jpg "The furniture folder as tiles: armchair, bathtub and bed, between their textures.")

## How a skinned character is stored

An animated character is a mesh plus a hidden structure that tells the mesh how to move. Until now my importer threw that structure away. These are the parts.

> **Background: skeleton, bind pose and skin weights.**
> A **skeleton** is a tree of joints. Each joint has a translation, a rotation and a scale relative to its parent, so moving a hip moves the leg, the foot and the toes with it. Walking down the tree and multiplying the local matrices gives each joint's matrix in model space.
>
> The **bind pose** is the pose the skeleton was in when the artist attached the skin to it, often a T-pose. In the bind pose each joint has a model-space matrix B. The **inverse bind matrix** is its inverse, B^-1. It takes a vertex from model space into the joint's own space, so the joint's position and orientation at bind time are cancelled out.
>
> **Skin weights** state, for every vertex, which joints it follows and how strongly. A vertex on the elbow might be 60% forearm and 40% upper arm. Four joints per vertex is the usual limit, and the weights add up to 1.

### How skinning is computed

To pose the mesh, the runtime computes the joint's current model-space matrix M for each joint. A vertex that follows one joint then moves like this:

```text
v_posed = v_bind * inverseBind_j * M_j
```

Read it left to right. The inverse bind matrix takes the vertex from model space into the joint's local space, where it is a fixed offset from the joint. The current matrix M puts that offset onto the joint's new position and orientation. The product `inverseBind * M` is the **skinning matrix** of the joint. In the bind pose M equals B, the product is the identity, and every vertex stays where it was imported. My test checks exactly that.

For a vertex that follows several joints, the engine blends the skinning matrices by weight and applies the result:

```text
S = w0*S_j0 + w1*S_j1 + w2*S_j2 + w3*S_j3
v_posed = v_bind * S
```

This is linear blend skinning. The diagram shows one vertex near the elbow of a two-bone chain. If it followed only bone A it would stay put, and if it followed only bone B it would swing round with it. At 50% and 50% it lands halfway between the two.

![Linear blend skinning with two bones and one vertex](/images/2026-10-12-skeletons/skinning.svg "One vertex near a joint: where it lands under each bone alone (hollow) and under equal weights (filled).")

### The limit of linear blend skinning

Linear blending averages matrices, and the average of two rotations is not a rotation. Take two bones that differ by a twist of angle θ about their shared axis, with a vertex at distance r from the axis and weights of 50%. The blended position is halfway between the two rotated positions, and its distance from the axis is `r * cos(θ/2)`. At a 90-degree twist the cross section has shrunk to 71% of its radius. At 180 degrees it has collapsed to the axis. This artifact is called the candy-wrapper effect, because a forearm twisted far enough pinches shut like the end of a wrapped sweet.

Production characters hide it with extra helper joints that share the twist along the limb, with dual quaternion skinning, which blends rotations properly, or with corrective shapes. My skinning is plain linear blending. My test tube bends but does not twist, so I have not seen the artifact yet. I expect it at the shoulders and forearms of a character, and I will handle it with twist joints in the rig if it shows.

### What the importer keeps

The importer keeps all three parts of the structure:

- **The skeleton.** The joints are stored in an order where a parent always comes before its children, each with its rest translation, rotation and scale and its inverse bind matrix. A node that sits between joints without being one, such as Blender's armature object above the root bone, is folded into the joint below it.
- **The skin.** Each vertex stores up to four joints and four weights. Files that give more keep the strongest four, and the importer says so.
- **The clips.** Each animation is resampled to 30 frames a second, whatever rate the file used. All three of glTF's interpolation modes work: step, linear, and cubic spline.

Handedness needed care. glTF is right-handed and my engine is left-handed. A static mesh only has to flip each vertex. A skeleton needs every joint's translation, rotation and matrix mirrored consistently, or a bending arm bends the wrong way. A test checks a whole bent pose against an answer worked out by hand.

Clips can also come from files that hold only a skeleton, and they attach to a character by bone name. Tests should not need Blender, so a small Python script builds a skinned test asset: a 3 m tube on a three-bone chain, with a "Bend" clip that uses all three interpolation modes. The Model Viewer draws the skeleton over the model as a line per bone and a cross at each joint.

![The test tube with its skeleton drawn over it](/images/2026-10-12-skeletons/viewer-bones.jpg "Three joints, one metre apart, inside the 3 m tube. The panel lists the three joints and the one-second Bend clip.")

## The pose runtime

Stored frames are not motion. The pose runtime turns them into a pose at any time. It is plain CPU code with no GPU in it, which makes it easy to test.

### Sampling and interpolation

A clip is a set of tracks, one per joint, each holding a translation, a rotation and a scale at every frame. To pose the skeleton at time t, the runtime finds the two stored frames around t and blends them. A pose at 0.517 s is the frames at 0.500 s and 0.533 s with the weight `(0.517 - 0.500) / (0.533 - 0.500)`. Because the clip is stored at 30 frames a second and played back at any rate, this keeps slow motion and odd frame rates smooth.

Translations and scales blend with a linear interpolation, `a + (b - a) * u`. Rotations need more care. A rotation is a unit quaternion, and the correct interpolation between two of them is spherical, slerp, which moves along the arc at constant angular speed. Slerp needs trigonometric functions. The cheaper alternative, normalised lerp, blends the four components linearly and renormalises. For rotations a few degrees apart, such as two neighbouring frames at 30 Hz, the two are nearly identical. For rotations far apart nlerp changes speed along the arc, which is visible only in a long blend. I use nlerp, and it takes the short way round: a quaternion and its negative are the same rotation, so if the dot product of the two is negative, one of them is negated first.

The same blend works between two poses, which is the base for crossfades. Playback loops or plays once and holds the last frame, and each step reports how many times it went around the loop, so everything that depends on time agrees about it.

### Root motion and events

A walk clip moves the character forward by itself. The runtime measures how far the root joint moved and turned over a step, even across a loop. The game can then move the character by exactly that much, or remove that movement from the pose so the character walks on the spot. Height and lean stay in the pose. Only position on the ground and heading are removed.

A mesh's sidecar can also mark moments in a clip, such as a footstep at 0.42 s of "walk". An event fires once each time playback passes it, in order, even when one long frame passes several. They will drive footstep sounds when audio arrives.

## Skinning on the GPU

After this the skeleton played its clips in the viewer, but the mesh stood still. The CPU now computes one skinning matrix per joint, a few dozen matrices per character. The GPU applies them. A character has tens of thousands of vertices, and each vertex's work is independent, which is what a GPU is built for. Skinning on the CPU would mean moving every vertex and uploading the whole mesh again every frame.

### Where the skinning runs

There are two common places to run it. A **compute pass** can skin all vertices once per frame and write the result to a new vertex buffer, which every later pass then draws as an ordinary static mesh. That is the better choice when many passes draw the same character, or when ray tracing needs the posed geometry. A **vertex shader** can skin each vertex as it is drawn. It needs no extra buffer and no extra dispatch, but every pass that draws the mesh repeats the blend.

I chose the vertex shader. A skinned vertex costs four matrix fetches and a weighted sum, a character has a few thousand to a few tens of thousands of vertices, and my scene has a handful of characters. The repeated blend in the depth prepass, the main pass and the shadow tiles is cheap, and the engine does not need the extra buffer. If I add ray tracing, or if the passes multiply, pre-skinning in a compute pass is what I would change.

### How it is built

The rule from my plan was that nothing static should pay for animation.

- **A separate stream.** A skinned mesh carries its joint indices and weights in a second vertex stream of 16 bytes per vertex: four 16-bit joint indices and four 16-bit weights. The ordinary vertex format is untouched, so static meshes, lightmaps and shadows read what they did before. A test checks that the weights, packed to 16 bits, still add up to exactly one.
- **Skinned twins of the pipelines.** The opaque pass, depth prepass, glass, shadows, debug views, selection outline and preview each get a skinned twin. A twin is built the first time a skinned mesh is drawn with it, so a scene with no skinned meshes builds none.
- **A palette per object.** The skinning matrices are stored as `float3x4`, three `float4` rows per joint. One row or column of an affine matrix is always the constant (0, 0, 0, 1), so 48 bytes describe it instead of 64. They are uploaded as a structured buffer, one for this frame and one for the last. The vertex shader blends four of them and transforms the position, the normal and the tangent.
- **Two poses.** Each object sends this frame's palette and last frame's. The previous palette gives each vertex's previous position, which the temporal anti-aliasing pass needs to follow a moving arm. The next day's work checks this.
- **Probe lighting.** A lightmap baked in one pose cannot hold a body in another, so skinned objects are lit by the light probes, like doors and thrown props. A new pose also re-renders the shadow tiles that see it, so shadows follow the body.

### Checking the GPU against the CPU

The question is whether the GPU puts every vertex where my CPU skinning code does. The test takes the bend tube halfway through its clip and draws it with the GPU preview. It then skins the same vertices on the CPU, fills the same triangles through the same camera and compares the two outlines. Zero pixels differ by more than the width of a pixel, posed and at rest.

The first run reported 8% of pixels wrong. The difference image showed the reason: the tube is open at its tip, the GPU skips the back faces you would see through the opening, and my test filled every triangle. The test was wrong. With back faces skipped in the same way, the match is exact.

![The Model Viewer with the tube bent](/images/2026-10-12-skeletons/model-viewer-bend-skinned.jpg "The Model Viewer at 0.5 s of the Bend clip. The tube bends with its bones drawn over it.")

![A tube in the full frame, at rest and posed](/images/2026-10-12-skeletons/scene-rest-vs-posed.jpg "In the full lit frame, the tube at rest (left) and posed (right). Its shadow follows the bend.")

The static hallway's GPU time is within 1% at all six poses, and the images are identical.

## Results and open issues

A bone-driven mesh now bends in the viewer and in a lit scene. All 93 test suites pass in Debug and Release. Three things are missing. The mesh's bounds still come from the bind pose, so a swinging arm could be culled while on screen. Motion vectors need a check, including teleports. And nothing plays clips in a scene yet, because that is the job of an Animator component. All three are next.
