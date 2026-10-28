---
title: Collision, a walking player, doors and triggers
date: 2026-09-27
order: 3
summary: I wrote collision from scratch, gave the player a walking capsule, and added raycast interaction, trigger volumes and doors that open or stay locked.
tags: physics, gameplay, scene
cover: /images/2026-09-27-collision-doors-triggers/closet-door.jpg
---

Until today, "the player" was a camera with a rule: stay between these hard-coded corridor bounds. It could not be stopped by a door, a trim board or anything else that was not on that list. That is fine for a camera fly-through and useless for a game. The main job of the day was to make the world solid, and then to put things in it that you can touch.

## Collision, from scratch

The usual route is to add a physics library. I am not using one, so I wrote a small collision library. It has three layers, each built on the one below.

**Shape tests.** The basic questions you can ask of geometry: does this *ray* hit this box? Do these two boxes overlap? Does this *capsule* touch this box?

**A world.** A collection of colliders that can answer two questions: "what does this ray hit first?" and "what does this capsule overlap?" The hallway's walls, floor, ceiling, trim and doors are all colliders in it.

**A character controller.** The part that makes walking feel like walking, which is far more than "don't go through walls". Mine does four things:

- It **slides** along walls instead of stopping dead.
- It **steps up** small ledges, such as a door threshold.
- It **falls** with gravity when there is nothing under it.
- It **stays glued to the floor** over small drops, so going down a slight step does not make you hover for a moment.

> **Concept: Why a capsule.** A player is shaped something like a tall pill: a cylinder with a half-sphere on each end. That shape is a good compromise. It is cheap to test, it has no corners to catch on, and its round bottom lets it ride up small steps. A box would snag on every edge of a door frame. Collision code uses capsules for people for this reason.

![Top view: a circle pushes diagonally into a wall and ends up sliding along it](/images/2026-09-27-collision-doors-triggers/capsule-slide.svg "Slide response. The part of the push that goes into the wall is removed. The part along the wall is kept.")

The sliding rule is the thing that makes it feel good, and it is simple. When you push into a wall at an angle, the movement can be split into two parts: the part that goes *into* the wall and the part that goes *along* it. Throw away the first, keep the second. You glide along the wall instead of sticking to it. In a corner, where two walls stop two directions, you slide into the corner and stop, which is exactly what a person would expect.

![Close to a plaster wall, the screen filled by the grimy wall surface](/images/2026-09-27-collision-doors-triggers/player-against-wall.jpg "Pushing into a wall at point-blank range. The capsule stops short of the surface, so the camera never clips through it.")

Collision is also why the camera cannot clip through a wall any more. The camera sits at the capsule's eye height, and the capsule's radius keeps it a little way from any surface.

## Looking at things

Interaction now works with a real **ray**. It leaves the player's eyes straight forward and asks the collision world what it hits first. If a wall is in the way, you cannot use the thing behind it.

## Trigger volumes

A *trigger volume* is an invisible box that does not block you, but reports when you walk into it and when you walk out. It is the hook for anything that should happen at a place: a light that flickers when you reach a corner, a sound that starts at a door. I did not use them for scares today, as I want those to be scripted properly later, but the machinery now exists and is tested.

## Doors

I wanted proper doors, not a painted rectangle on a wall. I wrote another generator script, like the one for the sconce, that builds a four-panel stained-wood door with brass knobs and a painted frame, saved as glTF.

Then the level builder needed to learn to use it. It now cuts real doorways into the walls, fits the frame and leaf, and puts a small dark room behind each door so there is something to find.

![A closed dark wooden door in a white frame, set in a green-grey plaster wall with a wall lamp to its left](/images/2026-09-27-collision-doors-triggers/closet-door.jpg "The closet door in its frame, lit by the flashlight and the neighbouring wall lamp.")

There are two doors to try:

- The **bedroom door is locked.** Press E and it jolts against the latch and rattles. It is a small thing, but a locked door that responds is already a bit of a scare.
- The **closet door opens.** It swings on its hinges, and you can walk in.

![The closet door swung open, showing a dark room and the prompt letter E on screen](/images/2026-09-27-collision-doors-triggers/closet-door-open.jpg "The closet door open after pressing E. The leaf has swung into the dark room, and the prompt shows while you look at the door.")

The door leaf is a collider, too. A closed door is solid and blocks you, and once it is open the doorway is free and you can walk through it.

## Seeing collision in the editor

An invisible system is hard to debug. So the editor gained a **Collider** section in the inspector (with undo like every other edit), an outline around the selected object's collider, and a switch to show every collider in the scene at once. Solid colliders draw in amber, and triggers draw in green.

![The editor viewport showing orange wireframe boxes around the walls and a green trigger volume](/images/2026-09-27-collision-doors-triggers/editor-collider-wireframes.jpg "Every collider in the scene: amber for solid things, green for a trigger volume.")

A gap between two wall colliders, or a door frame whose collider is too thin, is obvious in wireframe and invisible otherwise.

## Two repository bugs

While I was in there I found two problems with the project itself:

- A rule in the ignore file for build folders called `Debug/` was also matching the source files for the debug overlay, which had never been committed to git at all. They are tracked now.
- The build was re-copying every asset on every rebuild (the cache story from earlier in the day). It now copies only what changed.

## How I checked it

There are unit tests for the shape tests, the world, the character controller, doors and triggers. All 34 tests in the project passed, along with the validation script.

For the feel, I ran the real game and drove it with real key presses: walk into a wall, slide into a corner, open and close the closet door, try the locked one. Each time I checked the log for the message I expected. A passing unit test tells you the maths is right. Only walking into the wall tells you it feels right.

## Still open

- Doors make no sound yet.
- Nothing moves under physics. The world is solid, but static.
- In the editor's command palette, Enter does not run the highlighted command yet. That gets fixed in the editor usability work.

The corridor was still dark and the lighting was still a pile of hacks, but you could finally walk through it like a person.
