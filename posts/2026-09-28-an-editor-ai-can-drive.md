---
title: An editor core without UI, a component schema and an MCP server for the editor
date: 2026-09-28
order: 2
summary: I moved editing into a UI-free EditorSession with a component schema, built an MCP server for a live or headless editor, and fixed input handling.
tags: ai-tooling, editor, tools
cover: /images/2026-09-28-an-editor-ai-can-drive/live-editor-crate.jpg
---

My goal for 28 September was an editor that I can use and that an AI agent can use in the same way. To be able to use it, an agent has to be able to look at a scene, change it, take a screenshot to see the result and undo the change if it is wrong. The Model Context Protocol (MCP) is the standard way for an agent to discover and call tools like that. I did this in three steps, in this order: an editing core that does not depend on the UI, an MCP server on top of it, and fixes to the editor's input handling.

## Moving editing out of the UI

Every editing action in the editor lived in the code of the editor window, where the buttons were drawn, so only someone clicking the interface could change a scene. For a tool server, each action had to be callable without any UI and had to give the same result as it does from the UI.

### EditorSession

I created `EditorSession`, which owns the scene, the undo history, the "unsaved changes" flag and the file path. Every change goes through it as one operation that is validated, clamped to safe values and recorded as one undo step:

- set any fields of an entity;
- add or remove a component;
- create an entity from a template: empty, box, point light, trigger volume, imported mesh or door;
- delete or duplicate an entity with its children;
- move an entity under a new parent;
- save and load.

It also answers questions as JSON: it describes an entity, lists entities by name or component, summarises the scene and validates it.

### One table that describes every component

The inspector needed a hand-written section for each component type, and an agent would need the same knowledge in another form. C++ cannot list the fields of a struct at run time, so I wrote that knowledge once, as data. `ComponentSchema` is a table with one entry for each component, and each entry lists its fields.

> **Background: schema-driven editing**
>
> Reflection is the ability of a program to ask what fields a struct has, what their types are and how to read and write them. Without it, every feature that touches fields, such as an inspector or serialisation, repeats the list of fields by hand, and the copies drift apart. One approach is a single table that describes the fields, with each feature written against the table. Adding a field means adding one line.

Each field in my table records:

- a JSON key such as `intensity` or `post.exposure`;
- a type from a fixed set (bool, float, int, float2, float3, colour, text, enum, entity reference, string list);
- a suggested range for the UI, the allowed values for an enum, the default, and a read-only flag;
- a getter and a setter that work on an `EntitySnapshot`, which is a copy of all components of one entity.

Each component also has an `add`, a `remove` and a `sanitize` function. The sanitizer clamps values to what the engine can accept and returns notes about anything it changed. A setter does not clamp. It reports a wrong type or an unknown enum value as an error and leaves the range to the sanitizer. Edits are applied to a snapshot first, so the session can validate them and record them as an undo step before the scene is touched.

The inspector, the JSON form of an entity and the MCP tools all use this table. The inspector walks the table and draws a generic widget for each field. About 430 lines of hand-written inspector code became one generic field drawer. The scene's render settings went from 6 visible controls to more than 40, because the table already listed all of them. Every component now has Remove and Add buttons, where before only colliders had them.

![The inspector, generated from the schema, showing a long list of render settings](/images/2026-09-28-an-editor-ai-can-drive/schema-inspector.jpg "The inspector generated from the component schema. Every render setting is editable.")

### Undo with whole-entity snapshots

The June editor stored undo steps as one command type for each component, with its own before and after copy. In this change I replaced twelve of those types with one: a whole-entity edit that holds the `EntitySnapshot` before and after. Undo restores the "before" snapshot and redo restores the "after" snapshot. Consecutive edits that belong together merge into one step, so that dragging a slider is one undo. The change removed a net 435 lines.

![Three views of the same inspector: Exposure at 0.420, then 0.718 after a slider edit, then 0.420 again after Ctrl+Z](/images/2026-09-28-an-editor-ai-can-drive/inspector-edit-and-undo.jpg "Real mouse input on the Exposure slider, followed by Ctrl+Z.")

### Two bugs in the hierarchy

Moving an entity under a new parent made it jump, and Create Child placed the new entity at double the parent's offset. Both were mistakes about spaces. A transform is stored relative to its parent, so changing the parent without changing the stored transform moves the object in the world. The correct operation is to compute the entity's world transform first and then store `world * inverse(newParentWorld)` as the new local transform. Reparenting now keeps the world position. A new child gets the parent's origin as its position.

## An MCP server

`CCMcp.exe` is a small MCP server. Claude Code starts it by itself from the `.mcp.json` file at the root of the repository. The server answers an agent's tool calls in one of two ways, shown in the diagram.

![An agent talks to CCMcp.exe over stdio. CCMcp sends the call to a running editor over a named pipe, or, when no editor runs, to a headless session](/images/2026-09-28-an-editor-ai-can-drive/mcp-paths.svg "The two paths. Both use the same EditorSession and the same schema.")

> **Background: what MCP is**
>
> MCP is a protocol between a client, usually an AI application, and a server that offers tools. The messages are JSON-RPC 2.0, one JSON object per line, sent over the standard input and output of the server process.
>
> A session starts with `initialize`. The client states the protocol version it supports, and the server answers with the version it will use and a list of its capabilities. The client then sends a `notifications/initialized` message. A notification has no `id` and gets no reply. After that the client sends `tools/list`, and the server replies with its tools. Each tool has a name, a description and a JSON Schema for its arguments, which lets the client check and explain the call. `tools/call` runs a tool by name. The result is a list of content blocks, text or image, and a flag that says whether the call failed. A failed tool call is a normal result with the flag set, so the agent can read the message and correct itself. Problems in the protocol itself use the standard JSON-RPC error codes: -32700 for a message that cannot be parsed, -32600 for an invalid request, -32601 for an unknown method and -32602 for invalid parameters.

My server implements `initialize` with version negotiation, `ping`, `tools/list` and `tools/call`, answers the empty lists for resources and prompts, and ignores notifications. It has 26 tools:

- **Scene:** info, load, save, validate.
- **Entities:** list, get, create, delete, duplicate, reparent.
- **Components and fields:** add or remove a component, set any fields, describe the schema.
- **History and commands:** undo, redo, and any command-palette command by name.
- **Viewing:** get or set the camera, including a "look at this point" form, take a screenshot, and read the render timings.
- **Other:** list assets, get or set the look (the render settings) and select entities in the editor.
- **`game_capture`:** runs the real game briefly from a chosen spawn point and returns the final frame, any warnings and the end of the game's log.

Almost every tool is a thin layer over `EditorSession` and the schema, so an agent's edit gets the same validation and undo as an edit from the inspector.

### Live mode and the named pipe

When the editor is running, each tool call goes to it. The two programs run in different processes, so they need a way to talk. I used a named pipe.

> **Background: named pipes**
>
> A named pipe is a Windows mechanism for communication between processes on one machine. One process creates the pipe under a name such as `\\.\pipe\cc_editor` and waits. Another opens that name the way it would open a file, and from then on both can read and write a stream of bytes. A pipe is local, it can be limited to one user, and it has no network port to open. Only one process can own a given name, so a second editor that tries to create the same pipe fails, which is the behaviour I want.

The editor creates the pipe and starts a background thread that accepts a client and reads one line of JSON per request. The thread does not touch the scene. It places each request in a queue. The editor's main loop calls `Poll` once per frame, between frames, and runs every queued request on the main thread. This matters because the scene is not thread-safe. If the pipe thread edited it while the UI was drawing it, the result would be a crash or a corrupt scene. Running requests between frames on the main thread means tool edits can never race with the UI.

In live mode I can watch an agent work. The change appears in the viewport, the outliner and the inspector, the status line says that an MCP edit was made, and Ctrl+Z undoes it like any other edit, because the edit is in the same history.

### Headless mode and offscreen rendering

When no editor is running, `CCMcp` loads the startup scene itself, creates an `EditorSession` and renders screenshots without a window.

> **Background: offscreen rendering**
>
> A window is needed to show an image, but not to create one. Direct3D 12 can render into any texture, and the window is needed only for the swap chain, the set of back buffers that the display presents. An offscreen renderer skips the swap chain. It creates its own colour target at a chosen size, draws into it, copies it to a buffer that the CPU can read and encodes that as an image. It never presents a frame.

I added an offscreen mode to the renderer, `InitializeOffscreen`, for this. In headless mode a screenshot can have a size that I choose. An offscreen frame at 720p took 1.94 ms of GPU time in a Debug build.

### Screenshots, so that the agent can see

A screenshot comes back from a tool as an image that the agent can look at. The default is JPEG, to keep the size small, and a lossless PNG is also saved to `Saved/Mcp/`. In live mode the capture is taken right after post-processing and before the editor UI is drawn, so it shows only the scene. The option `include_ui` captures the whole window instead.

![A plain tan box on the hallway floor between two walls, rendered headlessly](/images/2026-09-28-an-editor-ai-can-drive/headless-crate.jpg "Headless, with no editor open. entity_create placed a box, field_set gave it a wood colour, camera_set with look_at aimed the camera and render_screenshot returned this frame.")

![The editor with the crate selected and the status line reporting an MCP edit](/images/2026-09-28-an-editor-ai-can-drive/live-editor-crate.jpg "Live mode. The same calls went to the running editor. The crate is selected, the inspector shows its transform and the status line reports an MCP edit.")

The plain box looks flat because the lighting is still the old lighting. That is the work of the next track.

![The editor after Ctrl+Z pressed twice, with the crate gone and the profiler panel showing two steps available to redo](/images/2026-09-28-an-editor-ai-can-drive/live-editor-ctrl-z.jpg "Ctrl+Z pressed twice in the editor removed the crate. The agent's edits are in the same undo history as mine, and the panel shows two steps available to redo.")

### How I checked it

- The suite ran 36 of 36 tests. The new `EditorToolHostTests` check that every tool has a valid input schema, create, edit and undo by name, the error cases (missing entities, bad patches, absolute paths and `..` in paths, edits while the game is in play preview), a real named-pipe round trip including the refusal of a second server on the same pipe, and the protocol itself, with tool errors returned as results and the correct JSON-RPC error codes.
- `Validate-Engine.ps1` passed. It now includes a headless smoke test that calls `scene_info`, `look_set`, `history_undo` and takes a 640 by 360 screenshot.
- By hand, through `Scripts/Invoke-Mcp.ps1`, which calls the same tools from PowerShell, I did headless edits, camera moves, look changes, undo and render stats, and live creation, field edits, selection and screenshots in the running editor, followed by Ctrl+Z pressed with real keyboard input.

### Known limits

In live mode a screenshot is the viewport at its current size, and only headless mode can render at a chosen resolution. The pipe serves one client at a time. `game_capture` opens a visible game window for a few seconds. I had not yet checked that a fresh Claude Code session picks up the server. Tests and `Invoke-Mcp.ps1` covered the handshake.

## Making the editor usable

With tool access working, I went back to the editor's own input, and I used the MCP tools to check each fix in the running editor.

### Shortcuts that fired while typing

Typing "lamp f" into the outliner search toggled the flashlight, with L, and moved the camera, with F. Delete, W, E or R could fire in the middle of a word. The UI now reports whether a text field, a slider edit or the command palette has the keyboard. While one does, only chords with Ctrl or Alt count as shortcuts.

### Typed characters that were dropped

The input state in the June UI library held a single typed character per frame, so fast typing lost letters. The window now keeps every character in order, backspaces included.
### Typing exact numbers into sliders

Ctrl+click on a slider opens it for typing. The first key replaces the shown value, Esc cancels, and a click elsewhere applies it. Values outside the slider's range are accepted, and the component's own limits then clamp them. A first version appended the digits to the current value, giving "0.420.55". I fixed it so that the first key replaces the value.

### Clicks that belong to the editor

Mouse buttons were read from the global mouse state, so a click in another window could register in the editor. They now come from the editor window's own messages. A click on the command palette or the Create menu no longer reaches the panels behind it.

### A command palette for the keyboard

Ctrl+P opens the palette with its filter focused. Up and Down choose a command, Enter runs it, and Esc closes it. Each typed word is matched separately and the results are ranked, so "view t" puts Viewport Camera: Top first. Before, "view top" found nothing. My first ranking scored "Toggle Viewport Grid" as high as the top view for "view t", so matches in the typed order now score higher.

![The command palette open over the viewport, with Viewport Camera: Top highlighted first for the filter "view t"](/images/2026-09-28-an-editor-ai-can-drive/palette.jpg "Ctrl+P, then 'view t'. The filter is focused straight away and the best match is first.")

### Creating and placing things

The Create menu makes an empty entity, a box, a point light, a trigger volume, a door, or the glTF selected in the Assets panel. The new entity lands on the floor at the centre of the view and is one undo step. A `.gltf` dragged from the Assets panel into the viewport is placed on the floor where it is dropped, and a mesh dropped next to a wall steps back into the room, because it first landed inside the baseboard. `CCEditor --scene=path` opens a scene and Ctrl+S saves back to it.

### Rebuilding while a server is running

While Claude Code ran `CCMcp.exe`, every full build failed, because the linker could not overwrite the running executable. Windows does not allow a running executable to be overwritten, but it does allow it to be renamed. A pre-link step now renames the old executable out of the way, and the server keeps running. The server has to be reconnected to pick up a new build.

I checked these in the running editor with real mouse and keyboard input and read the results back through the MCP tools. "lamp f" in the outliner search left the flashlight and the camera alone, and Ctrl+click on Exposure, typing 0.55 and Enter gave exactly 0.55, with Ctrl+Z restoring 0.42. The UI tests gained a keyboard test, a diagnostics test covers the palette matching, and the suite reached 36 of 36.

## Results and what comes next

The editor now works through one core that does not depend on the UI, and an agent or a script can do everything that a person can do in the editor, with the same checks and the same undo. The next track is the renderer. Its first step is a list of clean-ups that must not change the picture, such as shared constant-buffer layouts, back-face culling and frustum culling, and each one will be measured with the benchmark from the previous post.
