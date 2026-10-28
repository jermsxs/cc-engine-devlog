---
title: Capsule collision, interaction raycasts, trigger volumes and doors
date: 2026-09-27
order: 3
summary: I wrote collision from scratch, with a capsule player that slides along walls and climbs steps, then raycast interaction, triggers and hinged doors.
tags: physics, gameplay, scene
cover: /images/2026-09-27-collision-doors-triggers/closet-door.jpg
---

Until 27 September the player was a camera. Its position was clamped to hard-coded corridor bounds, so walls and doors did not stop it, and the hallway could not contain anything that the player could not walk through. Eleven commits on the branch `physics/phase3-collision` replaced that. The player is now a capsule that collides with the scene, interaction uses a ray from the eyes, trigger volumes report when the player enters and leaves them, and doors swing on hinges or rattle when locked.

I wrote all of it myself, without a physics library. The project's rule is to use no third-party code, and the needs at this stage are small: a static world made of boxes and one moving capsule. A general rigid-body engine would add a large dependency for features I do not use yet. When moving objects become necessary, the choice can be revisited.

## Colliders and the physics world

The world is a list of colliders. Each collider is a box or a capsule, with a flag that marks it as a trigger and a user ID that holds the owning entity. A box is an oriented bounding box, or OBB: a centre, three orthogonal axes and three half-extents. An OBB can be rotated, which matters for walls that are not aligned to the axes and for door leaves that swing.

The scene describes colliders with a `ColliderComponent`. A bridge, `EntityPhysicsBridge`, turns the components into the physics world when the scene loads, using each entity's world transform. The hallway's architecture got box colliders for floors, walls, ceilings and trim. A scene without any solid colliders falls back to a logged no-clip mode, so that an empty scene can still be explored.

The world answers three questions: which collider does a ray hit first, which colliders does a capsule overlap, and how far can a capsule move before it touches something. It has no spatial acceleration structure. Each query first compares the query's bounding box with the stored box of every collider and then runs the exact test on the few that pass. The hallway has tens of colliders, so a broadphase structure would cost more than it saves.

## Why the player is a capsule

A capsule is a line segment with a radius, the shape that remains when a sphere is swept along the segment. For the player it has a height of 1.85 m and a radius of 0.3 m. A capsule has no corners. A box-shaped player would catch on the edge of a door frame, and a capsule slides past it. The test between a capsule and another shape reduces to a question about distance from a segment, which is cheap.

### Detecting an overlap

The core test is capsule against box. I do it in the box's local space, where the box is axis-aligned. The question is how close the capsule's core segment comes to the box. The squared distance from a point on the segment to a convex box is a convex function of the position along the segment. A convex function with one minimum can be searched with a golden-section search, which narrows an interval by the golden ratio on each step and reuses one of its two evaluations. I run 40 steps and then compare the result with the two endpoints, which the interval never contains exactly.

With the closest distance `d` and the capsule radius `r`:

- if `d >= r`, the shapes are apart;
- otherwise they overlap by `r - d`, and the direction to push the capsule out is from the closest box point toward the closest segment point;
- if the core segment is inside the box, `d` is zero and there is no such direction, so the push goes out through the nearest face.

The result is a penetration: a normal and a depth. Moving the capsule by `normal * depth` separates it from the box.

## Collide and slide

If the controller moved the player and then stopped at the first wall, walking along a wall by pushing diagonally into it would stop the player dead. The movement that feels right is to slide. The part of the motion that goes into the wall is removed, and the part along the wall is kept.

> **Background: collide and slide**
>
> For a wall with a unit normal `n` and a desired move `v`, the component of `v` that goes into the wall is `dot(v, n)`, which is negative when the move points against the normal. The slide move is `v - n * dot(v, n)`. It is the move projected onto the wall's plane. In a corner, two walls remove two components, and the player stops, which is the correct behaviour.
>
> Two problems appear in practice. The first is tunnelling. A moving capsule that steps farther than a wall is thick can end up on the other side without ever overlapping it. The step has to be small compared with the thinnest collider. The second is accumulated error. After a step the capsule may overlap a surface by a small amount, and the position has to be repaired.

![Top view: a capsule pushes diagonally into a wall; the component into the wall is removed and the component along it is kept](/images/2026-09-27-collision-doors-triggers/capsule-slide.svg "The slide response. Only the part of the move that points into the wall is removed.")

My controller works in these steps for every call to `Move`, with `dt` capped at 50 ms by the main loop:

1. **Sub-steps.** The horizontal move is divided into steps of at most half the capsule radius, which is 0.15 m. This keeps the capsule from skipping through a thin collider.
2. **Move, then depenetrate.** After each sub-step the capsule is moved by its share of the motion. Then it is tested for overlaps. While it overlaps something, it is pushed out along the normal of the deepest contact, up to six times. A small skin of 2 mm is kept so that the capsule does not rest exactly on a surface.
3. **Remove the motion into the wall.** For each wall contact the remaining horizontal motion has its component along the horizontal normal removed. This is the formula above, applied to the part of the move that is still to be made.
4. **Walls push horizontally only.** A wall or the lip of a step pushes the capsule back horizontally and not up. Otherwise bumping the lip of a ledge would lift the player off the floor.

### Steps, gravity and the ground

The same controller handles vertical movement.

- **Step-up.** When a grounded player is blocked by a wall, the controller retries. It raises the capsule by the step height of 0.28 m, or less if a ceiling is in the way, repeats the slide, and then drops the capsule back down onto whatever is below. The result is accepted only if the player made more horizontal progress than before and landed on walkable ground that is higher than the starting point. A low ledge of up to 28 cm is climbed without a jump.
- **Gravity.** Vertical speed accumulates at -9.81 m/s² up to a terminal speed of 20 m/s.
- **Walkable ground.** A surface counts as ground when its normal's `y` component is at least the cosine of the maximum slope, which is 50 degrees, or 0.64. Steeper surfaces behave as walls. A capsule resting on a box edge reports a tilted normal even over flat ground, so the controller also accepts an edge contact if a short ray just past the contact point finds walkable floor.
- **Ground snap.** If the player was on the ground in the previous frame and is not now, the controller probes 0.12 m down and snaps to the floor if it finds some. This keeps the player on the floor over small drops such as stair edges and ramps instead of falling for a frame.

Moving the player this way replaced the clamp to hard-coded bounds. The image below shows the result at point-blank range: the player stops at the wall, and the capsule radius keeps the eye 0.3 m from the surface.

![A grey-green plaster wall filling the screen at close range](/images/2026-09-27-collision-doors-triggers/player-against-wall.jpg "Pushing into a wall at point-blank range. The capsule stops at the surface.")

## Interaction with a ray from the eyes

Interaction did not check whether a wall was in the way, so an object could be used through it. It now casts a ray from the eye along the view direction, with a reach of 2.65 m, against the solid colliders.

1. The nearest solid hit decides what is in front of the player. If the collider belongs to an entity that has an interactable component, or to a child of one, that entity is focused. The code walks up the parent chain, up to 16 levels, to find the interactable entity.
2. If the nearest hit is anything else, such as a wall, its distance becomes the limit for the rest of the search, so a wall hides what is behind it.
3. Interactables without a collider of their own use a small focus sphere with a radius derived from their own radius, scaled by 0.55 and capped at 0.62 m. The ray is tested against these spheres up to the blocking distance.

The focused entity's prompt appears on screen, and E activates it.

## Trigger volumes

A trigger is a collider that does not block movement. It reports when something overlaps it. Triggers are the hook for events that happen because of where the player is, such as a sound that plays when the player enters a room or a scripted scare. I removed the automatic position-based scare from the renderer baseline in June, and I want scares to come from explicit triggers and scripts.

The player capsule is tested against the triggers once per frame. The reporting rule is a comparison of two sets:

- the set of triggers the capsule overlaps now;
- the set it overlapped in the previous frame.

A trigger in the new set and not in the old one produces an enter event. A trigger in the old set and not in the new one produces an exit event. The tracker keeps both sets as sorted vectors of user IDs, so the comparison is a binary search per element. Each event carries the collider's ID, which is the entity it belongs to, and the runtime logs them, honours the one-shot flag on the trigger component, runs the one event the engine knows natively, `hallway_scare`, and reports any other event name so that scripting can use it later. I have not built the scripting layer yet.

## Doors

I authored a four-panel stained-wood door leaf with brass knobs and a painted frame with a Python script, in the same way as the wall sconce. The level builder cuts real doorways into the hallway walls and puts a small room behind each door. The hallway has a bedroom door and a closet door. The bedroom door is locked and the closet door opens.

A `DoorSystem` runs each door as a small state machine. Each door has an open amount between 0 and 1 and a target. When the player activates a door, the target flips between 0 and 1, and the amount moves toward it at a rate set by the door's swing time, 1.8 s by default. The door's yaw is its closed yaw plus the open angle times a smoothstep of the amount:

```cpp
degrees = openAngleDegrees * SmoothStep(amount);   // t*t*(3 - 2*t)
```

The smoothstep curve has a slope of zero at both ends, so the door starts and stops gently and does not move at constant speed. The door's entity origin is the hinge, so changing the yaw swings the leaf around it. The system also updates the leaf's collider on each frame. A closed door blocks the player, and an open door lets the player through.

A locked door does not open. Activating it starts a rattle. For the rattle's duration, 0.75 s by default, the yaw gets an added offset of the absolute value of a 7 Hz sine wave, scaled by a factor that falls linearly to zero. The result is a few knocks against the latch that die away. The offset always points toward the opening side, since the door cannot move through its frame.

The leaf's collider moves with it, so an open door's doorway keeps a focus volume where the closed leaf stood, and the player can still aim at it to close the door.

![A closed wooden door in a white frame set in a green-grey plaster wall, with a wall lamp to its left](/images/2026-09-27-collision-doors-triggers/closet-door.jpg "The closet door in its frame.")

![The closet door after pressing E, with the leaf swung inward and the prompt letter E on screen](/images/2026-09-27-collision-doors-triggers/closet-door-open.jpg "After pressing E. The leaf has swung about its hinge, and the player can walk into the doorway.")

## Editor support

I added a Collider section to the inspector, with undo. The selected object's collider is outlined in the viewport, and a toggle outlines all of them: solid colliders in amber and triggers in green. Wireframes are the quickest way to see where invisible geometry is, for example a collider that is a centimetre too thick.

![The editor viewport with amber wireframe boxes around walls and door openings and a green outline for a trigger volume](/images/2026-09-27-collision-doors-triggers/editor-collider-wireframes.jpg "All colliders in the scene. Solid colliders are amber and triggers are green.")

## Two repository fixes found along the way

- The build copied every asset on every build, which gave the files new write times and emptied the texture cache each time. It now copies only the files that changed. The previous post explains why this mattered.
- The source files of the debug overlay had never been committed. An ignore rule for `Debug/` build folders also matched my `Engine/Debug` source folder. They are tracked now.

## Verification and open issues

The test suite had 34 of 34 tests passing, including new tests for the geometry queries, the player controller, doors and triggers, and `Validate-Engine.ps1` passed. I also ran walk tests that pressed real keys in the running game: walking into walls, sliding into corners, opening and closing the closet door and trying the locked door. The expected messages appeared in the log.

Open issues:

- There is no door creak yet, because there is no audio system.
- Nothing in the world moves under physics. The controller handles a moving player against a static world, and doors move by script.
- The editor's command palette does not run the selected command on Enter yet. I fixed that the next day.
