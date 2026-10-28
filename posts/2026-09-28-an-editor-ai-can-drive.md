---
title: An editor an AI can drive
date: 2026-09-28
order: 2
summary: I split the editor core from its UI, described every component in a schema, added an MCP server an AI agent can call, and fixed the usability bugs.
tags: ai-tooling, editor, tools
cover: /images/2026-09-28-an-editor-ai-can-drive/headless-crate.jpg
---

The measuring tools were in place. The next goal was the one in the plan's first line: an editor that an AI agent can use the way a developer does. Look at the scene, change something, take a screenshot to check, undo it if it is wrong. Three pieces of work followed. The first two made it possible, and the third made the editor nicer for people too.

## Step 1: an editor core without a UI

The problem was simple. Every editing action lived inside the code of the editor window. Moving an object, adding a component, deleting an entity: all of it was tied to buttons and mouse clicks. So only a person clicking could change a scene. An agent cannot click.

The fix is to separate *what an edit does* from *the button that asks for it*. I created a library called `EditorSession`. It owns the scene, the undo history, the "unsaved changes" flag and the file path. Every change goes through it as one step that is checked, limited to safe values, and undoable:

- set any fields on a component;
- add or remove a component;
- create an entity from a template (empty, box, point light, trigger volume, imported mesh, door);
- delete or duplicate an entity with its children;
- move an entity under a new parent;
- save and load.

It also answers questions as JSON: describe an entity, list entities by name or component, summarise the scene, validate it. The editor window is now one client of this library. It does not have to be the only one.

> **Concept: Separating the model from the view.** When logic lives inside the UI, the UI is the only way to drive it. When the logic lives in its own library and the UI only calls it, you can test the library without a window, script it from the command line, or hand it to a program that has no hands. That is the oldest idea in software architecture, and it turned out to be the whole foundation for what followed.

### One table that describes every component

To let an agent edit "any field", the library has to know what the fields are. I wrote a **component schema**: one table that lists, for every component, each field's type, its sensible range, the allowed values for choice fields, its default, and how to clamp it.

Then I used that table everywhere:

- the **inspector** is now generated from it. I deleted about 430 lines of hand-written inspector code, replaced by one generic field drawer. The render settings went from 6 visible controls to more than 40, and every component got **Remove** and **+ Add** buttons;
- the **JSON form** of every component comes from it;
- the **MCP tools** use it to check what an agent sends.

![The inspector showing a long list of render settings, generated from the schema](/images/2026-09-28-an-editor-ai-can-drive/schema-inspector.jpg "The inspector built from the schema: exposure, fog, bloom, grain, vignette, lens distortion, grade and more, all editable.")

Adding a new field to a component is now one line in the table, and it appears in the inspector, the saved file and the agent's tools at once.

The undo system got the same treatment. Twelve separate undo types, one per component, became one generic "whole entity" undo, and I removed a net 435 lines.

I also fixed two bugs found while testing. Reparenting in the outliner used to make objects jump, and now keeps their world position. And "Create child" put the new entity at double the parent's offset; now it lands at the parent's origin.

## Step 2: the MCP server

> **Concept: MCP.** The Model Context Protocol is a standard way for an AI assistant to discover and use tools in another program. The program publishes a list: "here are the actions I offer, here is what each one takes, here is what it returns". The assistant reads the list and calls the actions as needed. You can think of it as a menu that a program hands to an AI, written in a language both understand (the messages are JSON).

I built a small server, `CCMcp.exe`, that Claude Code starts by itself from a config file in the project folder. It offers 26 tools, and nearly all of them sit directly on the `EditorSession`, so an agent's edit goes through the same checks, clamping and undo as one made with the mouse.

![An agent talks to the MCP server, which edits either a running editor over a named pipe or a headless scene](/images/2026-09-28-an-editor-ai-can-drive/mcp-paths.svg "The server works in two ways, and the agent does not have to care which.")

It works in two modes.

**Live.** If the editor is running, each tool call goes to it over a *named pipe*, a private channel between two programs on the same machine. The editor runs the request between frames, on its main thread. I can watch the change happen. It shows in the outliner and the inspector, and Ctrl+Z undoes it as if I had done it.

**Headless.** If no editor is open, the server loads the scene itself and renders offscreen: a new renderer mode that needs no window and never shows a frame.

The tools cover the whole loop:

- **scene:** info, load, save, validate;
- **entities:** list, get, create, delete, duplicate, reparent;
- **components:** add, remove, set fields, describe the schema;
- **history:** undo, redo, run any command by name;
- **viewing:** get or set the camera (including "look at this point"), take a screenshot, read render timings;
- **the look:** get or set render settings;
- **play:** run the real game for a few seconds from a chosen spot and return the last frame and the log.

Screenshots come back as images the agent can look at, as small JPEGs by default with a lossless PNG saved to disk. In the live editor, the capture is taken right after post-processing and before the editor UI is drawn, so it shows only the scene.

Here is headless mode. With no editor open, the agent created a box, gave it a wood colour, pointed the camera at it and took this picture. The flat look is the plain, unlit box. That is exactly what the lighting work is going to fix.

![A plain tan box on the dark hallway floor between two walls](/images/2026-09-28-an-editor-ai-can-drive/headless-crate.jpg "Headless: one box created, recoloured and photographed with four tool calls and no editor open.")

And here are the same edits made live. The crate is selected, the inspector shows its transform, and the status line reads that the change came from MCP:

![The editor with the crate selected, its move gizmo visible, and the status line mentioning an MCP edit](/images/2026-09-28-an-editor-ai-can-drive/live-editor-crate.jpg "Live: the agent's changes appear in the running editor, in the same undo history as mine.")

## How I tested it

The tool host has tests for: every tool having a valid input schema, create-edit-undo by name, the error cases (missing entities, bad values, absolute or `..` paths, edits blocked during play), the named-pipe round trip (including refusing a second server on the same pipe), and the protocol itself, with the right error codes. The validation script now runs a headless smoke test as well: scene info, a look change, an undo, and a small screenshot.

I also drove it by hand, and pressed Ctrl+Z with real keyboard input to confirm it removed the crate the agent had added.

A few limits are honest to mention. In live mode, a screenshot is the viewport at its current size, so only headless mode can render at a chosen resolution. Only one client can use the pipe at a time. The "play" tool opens a visible game window for a few seconds. And I had not yet checked that a fresh Claude Code session picks up the server on its own. The protocol is covered by tests, and the next session would be the real check.

## Step 3: the editor stops fighting you

With an agent using the editor and me using it too, I kept hitting small annoyances that made the editor feel hostile. A day of fixing them made it nicer for everyone.

**Typing triggered shortcuts.** Typing "lamp f" into the outliner's search box toggled the flashlight (the L key) and moved the camera (F). Now the UI reports when a text field, a slider edit or the command palette owns the keyboard. While it does, only Ctrl and Alt combinations count as shortcuts.

**Fast typing dropped letters.** The window kept only the last character per frame. It now keeps all of them, in order, backspaces included.

**You can type exact numbers.** Ctrl+click any slider, type a value, press Enter. You can go outside the slider's range if you want; the component's own limits still apply.

**Clicks belong to the editor.** The mouse buttons were being read from the system-wide state, so a click in another window could register in the editor. They now come from the editor window's own messages. The click that only brings the window to the front does not select anything. Clicking the command palette or a menu no longer reaches the panels behind it.

**A command palette you can drive with the keyboard.** Ctrl+P opens it with the filter ready. Up and Down choose, Enter runs, Esc closes. Each typed word is matched separately and results are ranked, so "view t" puts "Viewport Camera: Top" first. Before, "view top" found nothing.

![The command palette open over the viewport, listing results with Viewport Camera: Top highlighted first](/images/2026-09-28-an-editor-ai-can-drive/palette.jpg "Ctrl+P, then 'view t': the best match is first, and Enter runs it.")

**A Create menu, and drag-to-place.** A new Create button adds an empty entity, a box, a point light, a trigger volume or a door, placed on the floor at the centre of your view and selected, all as one undo step. You can also drag a glTF file from the Assets panel into the viewport. It lands on the floor where you drop it, and near a wall it steps back into the room rather than sinking into the wall.

![A door leaf dropped into the hallway, selected, with its position shown in the inspector](/images/2026-09-28-an-editor-ai-can-drive/placed.jpg "A door leaf dragged in from the Assets panel and standing on the floor.")

**Rebuilding while an agent is connected.** With Claude Code running the server, every full build failed because the linker could not overwrite a running program. Windows does let you *rename* a running program, so a build step now moves the old file aside first. The server keeps running, and I reconnect it when I want the new build.

## What went wrong on the way

Three bugs were worth the story. My first typed-number version appended the new digits to the current value, so I got "0.420.55" instead of 0.55. A mesh dropped near a wall landed inside the baseboard. And my first command-palette ranking put "Toggle Viewport Grid" as high as the top view for "view t", until I made matches in the typed order score higher.

## Where it stood

The whole path now works. An agent can look at the scene, change it, see the result and undo it, and every edit shares one history with mine. All 36 tests passed. The honest summary is that this is tooling, not an image, and the best proof is that I used it directly, through the new tools, for the checks in the usability work.

Next was the graphics work. It starts with trimming the renderer's waste, one measured change at a time.
