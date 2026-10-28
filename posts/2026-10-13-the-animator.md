---
title: Posed bounds, skinned motion vectors, and the Animator component
date: 2026-10-13
order: 1
summary: Skinned meshes get bounds that follow the pose and motion vectors that TAA can use, then an Animator component, Model Viewer animation tools, six MCP tools and a C# animator API.
tags: animation, ai-tooling, scripting
cover: /images/2026-10-13-the-animator/play-sequence.jpg
---

A mesh could bend on the GPU, but nothing in a scene could tell it to, and the renderer's checks all assumed a mesh does not move. The day went in this order: first the renderer's assumptions about static meshes, then the component that plays clips in a scene, then the editor tools to prepare clips, the agent tools for the same work, and last the C# hooks for gameplay. The enemy I am going to build needs all of it.

## Two renderer assumptions that fail for a moving mesh

### Bounds and culling

Before drawing an object, the renderer tests a box around it, its bounds, against the camera's view volume. If the box is entirely outside, the object is skipped. The test is cheap, which is why it is done for every object. It is only correct if the box contains the whole object.

A skinned mesh's box had been the box of its rest pose. An arm swinging out past that box could be culled while it was still on screen.

The exact box of a posed mesh would need a pass over every vertex each frame. Instead, each joint remembers the box around the vertices it moves, in the joint's own space. Each frame those boxes are transformed by the joints' skinning matrices and joined into one. A posed vertex is a weighted blend of its joints' transforms, so it always lies within the joined box. The joined box is conservative, a little larger than necessary, and it costs a few dozen matrix multiplications per object. A test scales the tube up and views it from above with only its bent tip on screen. Bent, it is drawn. In its rest pose it is correctly skipped, and before this change the bent tube would have been skipped too.

### Motion vectors and temporal anti-aliasing

> **Background: how TAA uses motion vectors.**
> Temporal anti-aliasing gets extra samples per pixel by spreading them over time. Each frame the projection is shifted by a sub-pixel jitter, so the same pixel samples slightly different positions on successive frames. The renderer then blends the new frame with an accumulated history. That blend is only valid if the history pixel corresponds to the same surface point as the new pixel.
>
> If the camera or an object moved, the surface point that is at pixel p now was at a different pixel last frame. The **motion vector** is that difference. For every pixel the renderer writes where that pixel was last frame, and TAA reads the history at the shifted position. With correct vectors a moving object stays sharp. With wrong ones, such as zero for an object that moved, the history is blended in the wrong place and the object leaves ghost trails.

A motion vector comes from transforming the same vertex twice, once with this frame's transforms and once with last frame's, and subtracting the two clip-space positions. In my depth prepass the vertex shader computes `currentClip` and `previousClip`, and the pixel shader writes `(current - previous) * (0.5, -0.5)` to a two-channel motion target, in texture space, with this frame's jitter removed so that the jitter does not appear as motion.

For a skinned mesh, "last frame's transform" includes last frame's pose. That is why each skinned object uploads two joint palettes, the current one and the previous one. The skinned vertex shader blends both and keeps `previousPos` beside `pos`. This was in place the day before. What was missing was a check, and the case where it must not work.

A teleport has no valid previous position. When an object respawns or cuts to a different clip, last frame's position is meaningless, and blending across the jump smears the old picture into the new one. An object now restarts its motion when the game asks for it, or by itself when it moves more than 2 m in one frame. That applies to every moving object and not only to skinned ones.

I tested it by rendering a bending tube for 24 frames and comparing the last frame with the same pose held still until TAA settled. With skinned motion vectors, 0.14% of pixels differ. If every frame restarted its motion, which is what you would get without correct vectors, 0.63% differ. In the debug view only a pose change shows motion, and a reset or a 3 m teleport looks exactly like standing still.

![Motion vectors and TAA over a sequence](/images/2026-10-13-the-animator/motion-vectors-and-taa-sequence.jpg "Top: the motion-vector view with the pose held, changed, reset and teleported. Only a changed pose shows motion. Bottom: TAA while the tube bends, at frames 5, 11, 17 and 23.")

### A clipping bug found while testing

While testing, I saw part of the tube disappear as I orbited it in the Model Viewer. The viewer's camera draws only what lies between a near and a far distance, and it sized them from the straight rest pose. The Bend clip also stretches and scales the tube, so its arm reaches 3 m from the centre, past the 2.3 m the rest pose allowed. Looking along the arm, the nearest end was sliced off. The viewer now sizes those distances from the posed bounds. I tested 80 views, two poses at five heights from eight sides at two zoom levels, against a CPU drawing that has no near or far limit. Before the fix, up to 51% of the tube was missing from the worst view. After it, at most 0.16% differs, which is edge smoothing.

![Before and after the clip-plane fix](/images/2026-10-13-the-animator/preview-clip-before-after.jpg "The worst view, close in above the half bend. Left: the arm toward the camera is cut away into an open cup. Right: whole.")

## The Animator component

An Animator is a component for an entity that has a skinned mesh. Its fields are the clip (empty means the mesh's first), a speed from 0 to 4, whether it loops, whether it plays on start, a crossfade time and whether root motion is on. It saves with the scene and undoes like any other edit, and the MCP tools handle it through the component schema.

In the editor, the Inspector lists the mesh's own clips and warns when the mesh has none or the chosen clip is unknown. The validation panel lists every animator that cannot play and says why. In edit mode the mesh shows the clip's first frame, so what I place is what starts playing.

![The Inspector on the walking tube](/images/2026-10-13-the-animator/editor-inspector.jpg "The Animator component on the walker: clip Walk, root motion on, and a capsule collider.")

In the game, an `AnimationSystem` runs each step after scripts. It advances every playing clip, collects the events the clip passed, blends between clips, and builds the skinning palette for each entity's render object.

### Crossfades

Cutting from idle to walk makes a character pop, because the pose changes in one frame. A crossfade runs both clips for a short time. During the fade the system samples the clip being left and the clip being entered, each at its own time, and blends the two poses with a weight that rises from 0 to 1 over the fade time. The blend uses the same per-joint interpolation as sampling: linear for translation and scale, normalised lerp on the short arc for rotation. When the weight reaches 1 the old clip is dropped. A fade of 0 is a cut, and a cut also restarts the motion vectors.

### State machines

A character usually needs rules for which clip plays when: idle until a target is seen, then walk, then attack, then back to idle. This is an animation state machine. Each state is a clip or a blend, and each transition has a condition and a fade time. The engine's Animator is deliberately not a state machine. It is the layer under one. It plays one clip, crossfades to another when told to, and reports events. The decision logic lives in a C# script, which is where gameplay belongs, and I describe the hooks below. I have not built a graph editor for state machines.

### Root motion

With root motion on, the walk in the clip moves the entity instead of the mesh drifting away from it. The clip plays in place, and its forward movement and turning are applied to the entity's transform, scaled with it. If the entity also has a capsule collider, the movement goes through the same character controller that the player uses, so an animated character stops at walls and stays on the floor. The controller ignores the entity's own collider.

I tested it with three tubes in the hallway: one idling, one walking and the bend tube. In Play, the walker set off down the corridor and stopped at the end wall, 7.9 m on. Stopping Play put it back where it started. In a test, walking at a wall 1.9 m away stops 1.6 m out, which is the wall minus the capsule's radius.

![Three animated tubes a second apart](/images/2026-10-13-the-animator/play-sequence.jpg "Three frames a second apart: the idle tube nods, the bend tube bends and the walker heads off down the hall.")

One point to remember: glTF's Z axis is mirrored into my left-handed space, so a character that walks toward +Z in Blender walks toward -Z in the engine at rotation 0. The tests pin that down.

## Animation tools in the Model Viewer

The Model Viewer is where I inspect and prepare clips before a character goes into a scene. It has:

- a clip list with each clip's length and event count;
- a timeline with transport buttons and a ruler, where a click or drag scrubs;
- events shown as diamonds on the timeline, which I add by double-clicking, move by dragging with a snap to the 30 Hz frames, and rename or delete, with every change written to the asset's sidecar;
- a crossfade preview: the first clip runs for half a second, then fades into the chosen one over the chosen time;
- a root-motion trail on the floor with dots for events and a ring for the current position;
- joint selection by clicking in the image, which shows the joint's parent, children and how many vertices it moves.

The skin-weight view is a view mode that colours the mesh by how much each vertex follows the selected joint, from blue for none through green and yellow to red for fully. It is one more branch in the preview shader. A test draws the bend tube with the tip selected, and the top fifth comes out red and the foot blue. With the root selected, it flips.

![Crossfade preview and root-motion trail](/images/2026-10-13-the-animator/crossfade-and-trail.jpg "Left three: the Walk clip fading into another clip at weights 0, 0.5 and 1. Right: the root-motion trail with its event dots.")

![The skin-weight view in the editor](/images/2026-10-13-the-animator/editor-skin-weights.jpg "The walker in the skin-weight view with the Mid joint selected. The heat map shows which vertices that joint moves.")

## Tools for AI agents

An agent connected through MCP could already move entities and change materials. I want it to be able to import the enemy, check its clips and play them in a scene without anyone clicking. Six new tools give the same reach as the viewer:

- `asset_info` reports a mesh's counts, bounds, material slots, skeleton, each clip's length and root travel, collision and sidecar.
- `asset_import_set` rewrites the sidecar, with validation, and the mesh re-cooks at once.
- `viewer_capture` renders a mesh through the preview renderer, even headless, with any clip at any time, any view mode, either light rig and an optional skeleton overlay. It frames the posed mesh, which also fixes the viewer's habit of letting a walking clip leave the frame.
- `viewer_open` opens the live Model Viewer with chosen settings.
- `animation_list` lists a mesh's clips or every Animator in the scene.
- `animator_play` plays a clip on an entity, live in Play mode or as one undo step in edit mode.

Downloading assets is still not a tool. It stays a command that I run.

## Animators from C#

Gameplay code could touch neither the Animator nor its events. An entity's `Animator` now exposes `Clip`, `IsPlaying`, `Time`, `Speed`, `Loop` and `ClipLength(name)`, and has `Play(name)`, `CrossFade(name, seconds)`, `Restart()`, `Pause()` and `Resume()`. Setting `Time` is a cut: any blend ends, no events fire and the root does not move.

A script also receives `OnAnimationEvent(name)` when its entity's clip passes a sidecar event, such as a footstep. It runs right after the clip advances, so the script can change clips in response. This is where a state machine sits:

```csharp
public override void OnAnimationEvent(string name)
{
    if (name == "step_left")
        Self.Animator.CrossFade("Turn", 0.2f);
}
```

The native side refuses entities without a playable animator, unknown clips and non-finite numbers, and the C# side returns neutral values, so a bad call cannot crash the engine. I checked it live in the editor: a walker with a script that shows each event, and the HUD printed `p17_walker: step_left (Walk)` during Play. A game-session test covers the same path, including the event staying queued for the session's own listeners, which footstep sounds will read.

## Results and open issues

Clips now play in a scene, in the viewer, and from scripts and agents. All 96 test suites pass in Debug and Release. The static hallway's GPU time stayed within 0.4% at every position, and the images are identical.

Known gaps:

- Events do not fire for the clip that is fading out.
- Editor picking still uses the rest-pose box.
- Sidecar edits cannot be undone.
- An entity carries one script, so that script handles all of its events.
- The test tube is only a stand-in. Next is the part I was waiting for: building a character in Blender.
