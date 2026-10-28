---
title: An immediate-mode editor with undo, and the pause in June
date: 2026-06-15
order: 1
summary: I built the first editor on my own immediate-mode UI library, with gizmos and command-based undo, and stopped on 15 June in the middle of a restyle.
tags: editor, tools
cover: /images/2026-06-15-an-editor-then-a-pause/editor-june.jpg
---

With the hallway stored as an entity scene, I needed a way to change it that was faster than editing JSON by hand. Between 10 and 15 June I built an editor: a second executable that shares the engine's renderer and lets me select entities, move them, change their components and undo the changes. The work is in two commits. The first, `45dfe71` on 10 June, added 63 files and about 11,800 lines. The second, `10af3c2` on 15 June, touched 43 files and added about 5,800 lines. It was the last commit before a three-month pause.

![The June editor with an outliner on the left, the corridor in the centre, an inspector on the right and tabs for Assets, Console, Validate, Profile and Mats at the bottom](/images/2026-06-15-an-editor-then-a-pause/editor-june.jpg "The editor on the last day of June work. The toolbar is a row of abbreviations (MOV, ROT, SCL, TOP, CMD). The notice at the upper right is an overlay message from the NVIDIA software on my machine and is not part of the editor.")

## Why I wrote my own UI library

An editor needs buttons, sliders, text fields, tree views and scrolling lists. The usual choice is a third-party UI library. I do not vendor third-party code in this project, so the editor uses a UI library of my own. It started at about 600 lines in `Engine/UI/UI.cpp` and a 167-line header.

The design question was whether to keep UI objects between frames or not.

> **Background: retained-mode and immediate-mode UI**
>
> In a retained-mode UI, which is how most desktop toolkits work, the program creates a widget object once and the toolkit stores it in a tree. The program changes the object when its data changes and registers a callback to hear about clicks. The toolkit owns the widgets, lays them out and redraws them when needed. This works well for applications with fixed forms, but the application has to keep the widgets and its own data in step. A slider that shows the exposure holds a copy of the exposure, and a change from another source has to be pushed into the slider.
>
> In an immediate-mode UI there are no stored widget objects. In each frame, the code that wants a button calls a function:
>
> ```cpp
> if (ui.Button(L"Save")) { SaveScene(); }
> ```
>
> The call reserves a rectangle, finds out whether the mouse is over it and was released over it in this frame, records how to draw it, and returns true or false. At the end of the frame the library discards everything. The next frame asks again. The UI can never disagree with the data, because the slider reads the real exposure value in every frame. The cost is that all of the UI code runs every frame, so long lists need care.

![Two columns comparing retained mode, where widget objects live in a tree, with immediate mode, where a function call per frame draws and tests each widget](/images/2026-06-15-an-editor-then-a-pause/immediate-vs-retained.svg "The same button in both models. Retained mode stores state in the widget. Immediate mode stores it in the application.")

### How my context works

The central class is `UI::Context`. At the start of a frame I give it the mouse and keyboard state and the window size. The application then calls widget functions: `Button`, `Checkbox`, `SliderFloat`, `DragFloat3`, `TextInput`, `TreeNode`, `Selectable` and `ColorEdit3`, plus layout calls such as `BeginPanel`, `Row` and `BeginHorizontal`. Each widget does three things.

1. **It reserves a rectangle.** A layout cursor moves down the current panel by the row height. A panel keeps its own cursor, content width and scroll offset.
2. **It identifies itself and tests the mouse.** The widget needs an identity so that the library can remember that "this slider is being dragged" from one frame to the next without keeping an object. The identity is a 64-bit FNV-style hash of the label, chained with a seed that changes after every widget. Two widgets with the same label therefore get different identifiers as long as their order is the same each frame, and the seed is reset at the start of every frame. A click is a mouse press that made the widget active, followed by a release while the mouse is still over it.
3. **It records draw commands.** The commands are plain structs: rectangle, line, text, image, push clip and pop clip. Nothing is drawn yet.

At the end of the frame the renderer converts the list of commands to triangles on the CPU. Clipping to scroll areas happens in that conversion, so a panel that is scrolled does not draw rows outside its bounds. The vertices go into one buffer per frame in flight, and the whole UI is a single draw call with a small shader. The buffer holds at most 65,536 vertices, and primitives beyond that are dropped. The font is an atlas of 256 glyphs in a 16 by 16 grid of 24 by 24 pixel cells, rasterised from Arial with GDI at startup.

### Long lists

Immediate mode means that an outliner with a thousand entities would build a thousand rows in every frame. Most of those rows are outside the visible area. I wrote a function for this, `CalculateVirtualListRange`. It takes the item count, the row height, the scroll offset and the height of the viewport. It returns the first and last row to build, with a margin of four rows on both sides, and the heights of the two empty spacers that stand in for the rows above and below. For 1,000 entities in a 400-pixel panel with 22-pixel rows, it builds 29 rows. The cost of the list depends on the size of the viewport and not on the size of the scene.

### What the first version got wrong

The input state held one typed character per frame. Fast typing lost letters, and a typed letter could also fire a keyboard shortcut. I did not fix that in June. It is part of the usability work in the last post of this series.

## What the editor could do

The screenshot shows the layout. From the code and the screenshot, the editor had:

- **A scene hierarchy** with search and buttons for add, copy, delete and reparent. In the screenshot it lists the loop's trim runs and lamp instances.
- **An inspector** with one section per component of the selected entity, and sliders for position, rotation, scale, material response and similar values.
- **Viewport tools.** Move, rotate and scale gizmos, local or world space, a grid, snapping, and camera modes for perspective, top, front and side views.
- **Undo and redo**, described below.
- **A command palette** and a toolbar, the row of abbreviations at the top of the screenshot.
- **Bottom tabs** for the asset browser, the console, a validation panel, performance statistics and materials. The validation panel checks the scene and reports what is wrong with it.
- **Scene saving and loading**, so that a change in the editor becomes a file.

Behind this sits a large amount of tested code. The test file for the editor's diagnostics and models grew to about 1,500 lines in the first commit and by roughly another 1,200 in the second, and the UI library has its own tests. Most of the editor's behaviour is testable without opening a window, because the models for selection, scene files, validation and command history are separate from the drawing code.

## Undo as stored commands

Undo needs to restore the scene exactly. I used the command pattern: each edit is stored as an object that knows how to apply and how to reverse itself.

> **Background: undo with before and after snapshots**
>
> One way to build undo is to write an inverse operation for every operation: "move by +1" is undone by "move by -1". It is easy to get wrong when an edit has side effects. A more robust way is to record state. When a field is edited, the command stores the component as it was before the edit and as it is after. Undo writes the "before" copy back, and redo writes the "after" copy.
>
> Two rules make the history usable. First, a drag produces many small edits, one per frame. Pressing Ctrl+Z forty times to undo one drag would be unusable, so consecutive edits of the same thing are merged. Second, when a new edit is made after an undo, the redo history no longer applies and is cleared.

In my `EditorCommandHistory`, a command carries an entity identifier, a kind, a label, and a before and after copy of the relevant component. Pushing a command first checks whether it can merge with the previous one. That is allowed when the entity, the kind and the label are all the same. The merged command keeps the original "before" and takes the new "after". If the result is a no-op, with before equal to after, the entry is removed. Every push clears the redo stack. Creating or deleting an entity, or a whole subtree of children, stores an `EntitySnapshot` of the affected entities, so that undo can bring them back with their identifiers.

This worked, but it did not scale well. The command struct had nineteen kinds and a before and after field for each component type. Every new component meant new fields, a new case in the merge check and a new case in the apply code. In September I replaced it with one generic whole-entity snapshot, which I describe in the last post of this series, in the section on the editor core.

## The pause

On 15 June I committed "editor work", and the history has no commit after it until 27 September. The commit was in the middle of a restyle. The screenshot shows it: buttons labelled with abbreviations, a tab strip at the bottom, panels that overlap, and a layout that was not finished. I did not write down why I stopped, so I will not give a reason here.

At that point the project had:

- a DirectX 12 renderer with an HDR target, one shadow map and a post-process pass;
- an entity scene with 14 component types, saved as JSON;
- a glTF importer for static meshes;
- an editor that mostly worked.

It did not have the look I was after. The lighting depended on shader code written for one corridor, the hallway had no authored props, and the player was kept inside hard-coded corridor bounds instead of colliding with real geometry. The next post covers the restart on 27 September, which began by finishing this reskin.
