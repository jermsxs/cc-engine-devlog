---
title: The Animator, from bounds to C#
date: 2026-10-13
order: 1
summary: Posed meshes get correct bounds and motion vectors, scenes gain an Animator component, and the viewer, MCP tools and C# scripts all learn to work with clips.
tags: animation, ai-tooling, scripting
cover: /images/2026-10-13-the-animator/play-sequence.jpg
---

A mesh could bend on the GPU, but nothing in a scene could tell it to. Today I built everything around that: the checks that keep a moving mesh correct, the component that plays clips in a scene, the editor tools to prepare them, the tools that let an AI agent do the same, and finally the C# hooks for gameplay scripts. The enemy needs all of it.

## Moving meshes go wrong in three ways

**Culled while still on screen.** To save work, the renderer skips any object whose bounding box is outside the view. A skinned mesh's box used to be its rest pose's. An arm swinging out past that box could vanish while you could still see it.

> **Concept: Bounds and culling.** Every object has a simple box around it. Before drawing, the renderer tests that box against the camera's view volume, and skips the object if the box is entirely outside. It is a very cheap test, so it works only if the box really contains the object.

Now each bone remembers the box around the vertices it moves. Each frame those boxes are moved with their bones and joined into one. A vertex is always a blend of its bones' movements, so the joined box always contains the posed mesh. That costs a few dozen multiplications per object, not a pass over every vertex.

**Smearing.** TAA smooths the picture by reusing the previous frames, shifted by how each pixel moved.

> **Concept: Motion vectors.** For every pixel the renderer can write a small arrow: where this pixel was last frame. TAA follows the arrow back to find the right history pixel. If an object moves but its arrows say it stood still, the old picture is blended in the wrong place, and you get ghost trails.

I already sent last frame's pose, so the GPU knows how each vertex of a bending mesh moved. What was missing was the case where it must *not* work: a teleport. When an object jumps (a respawn, or a hard cut to another clip), last frame's position is meaningless, and blending across the jump would smear the old picture into the new one. An object now restarts its motion when the game asks, or by itself when it moves more than 2 m in a frame.

I tested it by rendering a bending tube for 24 frames and comparing with the same pose held until TAA settled. With skinned motion vectors, 0.14% of pixels differ. If every frame restarted its motion, the way it would without them, 0.63% do.

![Motion vectors and TAA over a sequence](/images/2026-10-13-the-animator/motion-vectors-and-taa-sequence.jpg "Top: the motion-vector view with the pose held, changed, reset and teleported. Only a change shows motion. Bottom: TAA while the tube bends.")

**Sliced in the viewer.** While testing, I noticed that when the tube bends, part of it disappears as I orbit the Model Viewer. The viewer's camera draws only what lies between a near and a far distance, and it sized them from the straight rest pose. The Bend clip stretches and scales the tube, so its arm reaches 3 m from the centre, past the 2.3 m the rest pose allowed. Looking along the arm, the nearest end was sliced off. The viewer now sizes those distances from the posed box. I tested 80 views (two poses, five heights, eight sides, two zooms) against a CPU drawing that has no near or far limit. Before the fix, up to 51% of the tube was missing from the worst view. After it, at most 0.16% differs, which is edge smoothing.

![Before and after the clip-plane fix](/images/2026-10-13-the-animator/preview-clip-before-after.jpg "The worst view, close in above the half bend. Left: the arm toward the camera is cut away into an open cup. Right: whole.")

## The Animator in the scene

An Animator is a component you add to an entity that has a skinned mesh. Its fields are the clip, a speed, whether it loops, whether it plays on start, a crossfade time, and whether root motion is on. It saves with the scene and undoes like any other edit, and the MCP tools handle it through the component schema.

In the editor, the Inspector lists the mesh's own clips and warns when the mesh has none or the chosen clip is unknown. In edit mode the mesh shows the clip's first frame, so what I place is what starts playing.

In the game, a new animation system runs each step, after scripts. It advances every playing clip, fires the clip's events, and blends between clips on a crossfade.

> **Concept: Crossfade.** Cutting from "idle" straight to "walk" makes the character pop. A crossfade runs both clips for a short time and gradually shifts the weight from the old pose to the new one, so the body flows between them.

**Root motion.** With it on, the walk in the clip moves the *entity* instead of the mesh drifting away from it. The clip plays in place, and its forward movement and turning are applied to the entity's transform, scaled with it. If the entity also has a solid capsule collider, that movement goes through the same character controller the player uses, so an animated character stops at walls and stays on the floor.

I tested it with three tubes in the hallway: one idling, one walking, and the old bend tube. In Play, the walker set off down the corridor and stopped at the end wall, 7.9 m on. Stopping Play put it back where it started.

![Three animated tubes a second apart](/images/2026-10-13-the-animator/play-sequence.jpg "The idle tube nods, the bend tube bends, and the walker heads off down the hall.")

![The Inspector on the walking tube](/images/2026-10-13-the-animator/editor-inspector.jpg "The Animator component on the walker: clip Walk, root motion on, and a capsule collider.")

One thing to remember for later: glTF's Z axis is mirrored into my left-handed space, so a character that walks toward +Z in Blender walks toward -Z in the engine at rotation 0. The tests pin that down.

## Animation tools in the Model Viewer

The Model Viewer is now where I inspect and prepare clips before a character goes into a scene.

- **A clip list** with each clip's length and event count; click one to play it.
- **A timeline** under the picture with transport buttons and a ruler. Click or drag to scrub.
- **Events** as diamonds on the timeline. Double-click to add one, drag to move it (it snaps to the 30 Hz frames, or hold Shift to go between), select to rename or delete. Each change goes straight into the asset's sidecar.
- **A crossfade preview:** pick a clip and a fade time, and the viewer runs the first clip for half a second, then fades.
- **A root-motion trail** drawn on the floor, with dots for events and a ring for where the character is now.
- **Joints:** click one in the image or pick it from the Skeleton section, and it shows its parent, children and how many vertices it moves.
- **Skin weights:** a view mode colouring the mesh by how much it follows the selected joint, blue for none through green and yellow to red for fully.

![Crossfade and root-motion trail](/images/2026-10-13-the-animator/crossfade-and-trail.jpg "Left three: Walk fading into another clip at weights 0, 0.5 and 1. Right: the root-motion trail with its event dots.")

![The skin-weight view in the editor](/images/2026-10-13-the-animator/editor-skin-weights.jpg "The walker in the skin-weight view with the Mid joint selected. The heat map shows which vertices that joint moves.")

The skin-weight view is just one more branch in the preview shader. A test draws the bend tube with the tip selected, and the top fifth comes out red and the foot blue; select the root and it flips.

## Tools for AI agents

An AI agent connected through MCP could already move entities and change materials. When the enemy arrives, I want it to be able to import it, check the clips and play them in the scene without anyone clicking. So six new tools give the same reach as the viewer:

- **asset_info** reports everything about a mesh: counts, bounds, material slots, the skeleton, each clip's length and root travel, collision, and the sidecar.
- **asset_import_set** rewrites the sidecar (scale, material remap, events, source) with validation, and the mesh re-cooks at once.
- **viewer_capture** renders a mesh through the preview renderer, even headless: any clip at any time, any view mode, either light rig, with the skeleton drawn over it. The view frames the *posed* mesh, which fixes the viewer's old habit of letting a walking clip leave the frame.
- **viewer_open** opens the live Model Viewer with chosen settings.
- **animation_list** lists a mesh's clips or every Animator in the scene.
- **animator_play** plays a clip on an entity, live in Play mode or as one undo step in edit mode.

Downloading assets is deliberately still not a tool. It stays an explicit command run by a person.

## Animators from C#

Gameplay code could touch neither the Animator nor events. Now an entity's `Animator` exposes `Clip`, `IsPlaying`, `Time`, `Speed`, `Loop` and `ClipLength(name)`, and has `Play(name)`, `CrossFade(name, seconds)`, `Restart()`, `Pause()` and `Resume()`. Setting `Time` is a cut: any blend ends, no events fire and the root does not move.

A script also gets `OnAnimationEvent(name)` whenever its entity's clip passes a sidecar event, such as a footstep, right after the clip advances so the script can change clip in response. The native side refuses entities without a playable animator, unknown clips and non-finite numbers, and the C# side returns neutral values, so a bad call cannot crash anything.

```csharp
public override void OnAnimationEvent(string name)
{
    if (name == "step_left")
        Self.Animator.CrossFade("Turn", 0.2f);
}
```

I checked it live in the editor: a walker with a script that shows each event, and the HUD printed `p17_walker: step_left (Walk)` during Play.

## Where it ended up

Clips now play in a scene, in the viewer, and from scripts and agents. A few rough edges are known: events do not fire for the clip that is fading out; editor picking still uses the rest-pose box; sidecar edits cannot be undone; and an entity can carry only one script, so that script handles all of its events. The test tube is only a stand-in, so next came the part I was waiting for: building a character in Blender.
