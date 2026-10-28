---
title: Bones under the skin, and a mesh that bends on the GPU
date: 2026-10-12
order: 1
summary: A smooth splitter, a repeatable benchmark and mesh thumbnails, then the first animation steps, from skeleton import to a pose runtime and GPU skinning.
tags: animation, assets, editor
cover: /images/2026-10-12-skeletons/scene-rest-vs-posed.jpg
---

This was a long day, and it had two halves. The first half cleaned up two problems left over from the Model Viewer: a stuttering splitter and a benchmark that would not repeat itself. I also gave the asset browser pictures. The second half was the start of something big. Everything in the engine so far was static. Today a mesh learned to bend.

## A splitter that doesn't stutter

When I dragged a dock splitter, the frames took 17 to 30 ms. The cause was that every pixel the 3D viewport grew or shrank made the renderer wait for the GPU and rebuild all its scene targets. That was happening about 32 times a second.

The fix: while the size is still changing, keep the old targets and stretch them over the new rectangle. The projection follows the new shape, so picking and gizmos stay lined up. After the size has been still for a quarter of a second, rebuild once at the real size. The cost is a slightly soft picture during the drag. I tested it by dragging the real splitter with a real mouse: worst frames dropped from 17 to 30 ms down to about 1.1 ms, plus one 17 ms rebuild when the drag stops.

## A benchmark that repeats itself

My benchmark mode flies the camera through fixed poses and records timings and a screenshot. But two runs of the same build could differ by up to 149 out of 255 in places. A comparison tool is useless if it disagrees with itself.

The cause was a feedback loop. The flashlight's bounce light reads the lit picture back and turns it into a light. In bench mode it followed that reading with no smoothing, so a tiny difference in one GPU frame grew into a visibly different picture. Temporal anti-aliasing (TAA), fog and auto-exposure then carried the difference for about 100 frames.

> **Concept: Determinism.** A renderer is deterministic if the same inputs always produce the same pixels. To measure honestly you want that, so every source of variation has to be pinned: time, random jitter, noise, exposure, and, as I found out, anything that feeds on its own output.

Fixes: the bench moves the world a fixed 1/60 s per frame; each pose clears the bounce, its pending readbacks, the cached shadow tiles and the TAA and fog histories; and the screenshot now comes from 128 extra untimed frames after the measured ones, with the GPU finishing each before the next begins. Over five runs, screenshots differ by at most 3/255 now, and timings are unchanged. A tiny residual remains, and I did not find where it comes from.

A third problem surfaced on the way. The texture cache could not read back BC7 entries, because one value was missing from its list of known encodings. So every BC7 cache file was thrown away as unreadable, and about 20 MB of base colours was compressed again on every launch.

![The old bench in two states](/images/2026-10-12-skeletons/bench-old-two-states.jpg "The same frame of the same build in two runs, sharp and smeared, and their difference.")

## Thumbnails

A mesh in the Assets panel was a blue cube and a file name. Now each `.gltf` shows a 160 by 160 picture, framed from its own size under the Model Viewer's studio lights, in the list and in a new grid view.

![Mesh thumbnails in the grid view](/images/2026-10-12-skeletons/assets-grid.jpg "The furniture folder as tiles: armchair, bathtub and bed, between their textures.")

A thumbnail is made only the first time a mesh is shown, then saved as a PNG named by a hash of the files it depends on. Change any of them and the name changes, so a new picture is made, and nothing has to remember to delete the old one.

My first version stalled the editor for up to half a second per mesh. The picture itself is cheap; the stall was the mesh's textures being compressed on the frame they were first drawn. So each thumbnail now goes through three stages: warm up on a worker thread (load the mesh and compress its textures), render with a frame (two at most, read back without waiting for the GPU), then store on a worker thread. The first version had a 477 ms frame and nine hitches. The final one has a single 26 ms frame, when the first two thumbnails upload together. On the second launch, nothing is rendered at all.

## Getting a skeleton in

This is where the real work began. An animated character is not stored as a mesh that moves. It is a mesh plus a hidden structure that tells the mesh how to move. Until now my importer threw all of that away.

> **Concept: How a character is animated.** A *skeleton* is a tree of bones (also called joints), each with a position and rotation relative to its parent. Move the hip and the leg, foot and toes follow. The *bind pose* is the pose the skeleton was in when the artist attached the skin, typically a T-pose. *Skin weights* say, for every vertex, which bones it follows and how strongly: a vertex on the elbow may be 60% forearm and 40% upper arm. An *animation clip* is a list of poses over time. To draw a frame, you pose the skeleton from the clip and then move every vertex to where its bones say it should be. The blend of the bones' movements, weighted per vertex, is called *linear blend skinning*.

![Two bones and one vertex](/images/2026-10-12-skeletons/skinning.svg "Linear blend skinning in one picture: a vertex near the elbow follows a weighted average of what each bone alone would do.")

The importer now keeps all three parts. For the skeleton it stores the joints in an order where parents come before children, each with its rest position, rotation and scale. Blender's armature object, which sits above the root bone, is folded into the joint below it. For the skin it stores up to four joints per vertex and their strengths; files with more keep the strongest four and say so. Each clip is resampled to 30 frames a second, whatever the file used, and all three of glTF's interpolation modes work: step, linear, and cubic spline.

Handedness mattered. glTF is right-handed and my engine is left-handed. A static mesh just flips each vertex, but a skeleton needs every joint's position, rotation and matrix mirrored consistently, or a bending arm bends the wrong way. A test checks a whole bent pose against an answer worked out by hand.

Clips can also come from separate files that hold only a skeleton, and they attach by bone name. If a clip moves a bone the character does not have, the error names the clip and the bone. Since tests should not need Blender, I wrote a small Python script that builds a skinned test asset: a 3 m tube on a three-bone chain with a "Bend" clip. In the Model Viewer the skeleton shows over the model, a line per bone and a cross at each joint.

![The test tube with its skeleton drawn over it](/images/2026-10-12-skeletons/viewer-bones.jpg "Three joints, one metre apart, inside the 3 m tube. The panel lists the joints and the Bend clip.")

## The pose runtime

Stored frames are not motion. The pose runtime is the code that turns them into a pose at any moment. It is plain CPU code with no GPU in it, which makes it easy to test.

- **Between frames:** a pose at 0.517 s blends the frames at 0.500 and 0.533, so slow motion and odd frame rates stay smooth. Rotations blend the short way round.
- **Blending two poses**, the base for crossfading idle into walk.
- **Playing:** a clip loops, or plays once and holds its last frame.
- **Root motion:** a walk clip moves the character forward by itself. The runtime measures how far the root moved and turned over a step, even across a loop, so the game can move the character by exactly that much, or strip it out so the character walks on the spot. Height and lean stay in the pose.
- **Events:** a sidecar can mark moments in a clip, such as a footstep at 0.42 s of "walk". They fire once each time playback passes them, in order.

One test relied on luck. It played exactly 1.5 s of frames, which ends exactly on an event's time, and Release rounded one way while Debug rounded the other. It now plays 1.33 s.

## Bending on the GPU

After this the skeleton played its clips in the viewer, but the mesh stood still. Now the graphics card bends it.

> **In practice: Why on the GPU.** The CPU computes one matrix per bone, a few dozen numbers per character. The GPU then moves every vertex by blending the matrices of the (up to) four bones it follows. A character has tens of thousands of vertices, and each one's work is independent of the others. That is exactly what a GPU is for. Doing it on the CPU would mean moving all those vertices and then uploading the whole mesh again every frame.

I did not want static meshes to pay for this, and the rule from my plan was that nothing in the hallway should change. A skinned mesh carries its bone weights in a separate 16-byte-per-vertex stream, so the ordinary vertex format is untouched. Each drawing setup (opaque, depth prepass, glass, shadows, debug views, selection outline, preview) gets a skinned twin, built only the first time a skinned mesh is drawn. A scene with none builds none.

Each skinned object sends both this frame's pose and last frame's. The previous pose lets the engine work out how each pixel moved, which TAA needs to keep a moving arm from smearing. A baked lightmap cannot hold a body in some other pose, so skinned objects are lit by the light probes, like doors and thrown props. A new pose also re-renders the shadow tiles that see it.

![The Model Viewer with the tube bent](/images/2026-10-12-skeletons/model-viewer-bend-skinned.jpg "At 0.5 s of the Bend clip the tube now bends with its bones.")

How do I know the GPU puts every vertex in the right place? The test takes the bend tube halfway through its clip, draws it with the GPU preview, then skins the same vertices on the CPU with the code from the import step, fills the same triangles itself and compares outlines. Zero pixels differ by more than a pixel's width. The first run reported 8% of pixels wrong. The difference image showed why: the tube is open at its tip, and the GPU skips the back faces you would see through the opening while my test filled every triangle. It was my test that was wrong. With back faces skipped the same way, the match is exact.

![A tube in the full frame, at rest and posed](/images/2026-10-12-skeletons/scene-rest-vs-posed.jpg "In the full lit frame, the tube at rest (left) and posed (right), with its shadow following the bend.")

The static hallway's GPU time is within 1% at all six poses, and the images are identical.

## Where it ended up

By evening, a bone-driven mesh bends in the viewer and in a lit scene. What is still missing: bounds that follow the pose, so a swinging arm cannot be culled while still on screen; motion vectors that handle teleports; and an Animator component that plays clips in the game. That is tomorrow.
