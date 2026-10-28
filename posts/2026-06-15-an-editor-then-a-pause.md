---
title: An editor, then a pause
date: 2026-06-15
order: 1
summary: I wrote my own editor on an immediate-mode UI, with undo, gizmos and a profiler, then stopped on 15 June in the middle of a reskin.
tags: editor, tools
cover: /images/2026-06-15-an-editor-then-a-pause/editor-june.jpg
---

With the hallway stored as an entity scene, the obvious next question was how to change it. Editing JSON by hand works for about a day. Between 10 and 15 June I built an editor: a second program that shares the engine's renderer and lets you select things, move them, tweak them and undo it all. Then, on 15 June, I stopped. This post is about the editor, and about the stop.

![The editor in June: a dark hallway viewport between an outliner on the left and an inspector on the right](/images/2026-06-15-an-editor-then-a-pause/editor-june.jpg "The editor as it was on the last day of June work. The reskin was half done: text-only buttons, bracketed tags, and a stray graphics-driver popup in the corner.")

## Why my own UI library

An editor needs buttons, sliders, text boxes, tree views and scrolling lists. The usual answer is to download a UI library. My rule is no third-party code, so the editor has its own UI library, about 600 lines to begin with. It is not a toy, though, and it taught me a different way to think about interfaces.

> **Concept: Immediate-mode UI.** There are two ways to build a user interface. In a *retained-mode* UI (the way most desktop apps work) you create a button object once, keep it, and change it when things happen: you register a click handler and update the object. In an *immediate-mode* UI there are no button objects. Every frame, your code just says `if (Button("Save")) { Save(); }`. The call draws the button at the current position, checks whether the mouse is over it and was clicked this frame, and returns true or false. When the frame is over, everything is forgotten and the next frame asks again.

![Two columns: retained mode creates and keeps objects, immediate mode asks for each widget every frame](/images/2026-06-15-an-editor-then-a-pause/immediate-vs-retained.svg "Same button, two philosophies.")

The appeal is that the UI can never be out of sync with the data. The slider is not holding a copy of the exposure value, it is reading the real one this frame. The cost is that you redo the work each frame, so you have to be careful with long lists.

In practice my UI context takes the mouse and keyboard state at the start of a frame, and each widget call (`Button`, `Checkbox`, `SliderFloat`, `DragFloat3`, `TextInput`, `TreeNode`, `Selectable`, `ColorEdit3`) does three things: it reserves a rectangle by moving a layout cursor down the panel, works out whether the mouse is interacting with it, and records what to draw. The drawing is not done on the spot. It is appended to a list of simple draw commands: a rectangle, a line, a piece of text, an image, "start clipping here", "stop clipping". At the end of the frame, one small shader draws the whole list over the 3D view, using a font stored in a texture.

Two details were worth the effort. Every widget gets an *ID* made by hashing its label, which is how the library knows "this is the same slider as last frame" without keeping objects. And long lists, such as the outliner with a hundred entities in it, use a *virtual list*: it works out which rows are actually visible and only builds those, so a thousand entities cost about the same as a screenful.

## What the editor could do

The first big commit was about 12,000 lines. The second, five days later, added about 6,000 more. Together they gave me:

- **Outliner.** A tree of everything in the scene, with search, and buttons to add, copy, delete and reparent entities.
- **Inspector.** For the selected entity, one section per component, with sliders and fields you can edit: transform, mesh and material, light, camera, door, trigger.
- **Gizmos.** Move, rotate and scale handles in the 3D view, and viewport camera modes (perspective, top, front, side), plus a "focus" command.
- **Undo and redo.** More on this in a moment.
- **Asset browser.** It scans the game's asset folders, lists textures and models, validates them, and re-imports them when they change on disk.
- **Command palette.** One searchable list of every command.
- **Console, validator and profiler.** The log, a set of checks that tell you what is wrong with the scene, and a panel with frame timings.
- **Save, load, and play.** Open the hallway from a file, change it, save it, or press Play to try it.

All of that is about 40 files of editor code. A lot of it is plumbing, such as keeping preferences and project settings, but the plumbing is what makes it feel like a tool.

## Undo is a data problem

Undo sounds simple until you try it. The way I did it: every edit is stored as a *command* that holds a copy of the component **before** and **after** the change. Undo writes back the "before" copy, redo writes the "after" copy. Dragging a slider produces dozens of changes, so consecutive edits to the same field are merged into one step, otherwise you would press Ctrl+Z forty times to take back a single drag.

This worked, but it was heavy: each kind of component had its own command type with its own pair of copies. It was fine for a dozen components. It is also exactly the kind of thing that, three months later, I would replace.

## The reskin, and the stop

The screenshot at the top shows where the work ended. The editor was in the middle of a dark restyle: a command bar across the top, tabs at the bottom, the panels full height. The old look was functional and ugly, and I wanted a dark theme that matched the engine.

On 15 June there was a last commit, called "editor work", and then the history goes quiet. The next commit is dated 27 September.

I want to be straightforward about that. The engine paused for about three and a half months. My notes do not give a reason, and there was no clean ending: a half-finished reskin, a working editor with rough edges, and a renderer full of hallway-specific tricks. What I had at that point:

- a DirectX 12 renderer with a shadow map and post effects;
- an entity scene saved as JSON;
- a glTF importer for static meshes;
- an editor that mostly worked.

What I did not have was anything that looked like the reference. The lighting was a pile of shader tricks, there were no props, and nothing in the game could be touched.

The next entry is the restart. When I came back, the first job was the unglamorous one: finish the reskin I had left half done.
