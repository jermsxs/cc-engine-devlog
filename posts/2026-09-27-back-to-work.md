---
title: Finishing the editor, loading glTF meshes and sharing one scene file
date: 2026-09-27
order: 1
summary: After the June pause I finished the editor restyle, extended the glTF importer, and made the game and the editor load one scene file.
tags: editor, assets, scene
cover: /images/2026-09-27-back-to-work/editor-reskin-with-fixtures.jpg
---

My last commit before the pause was on 15 June, in the middle of an editor restyle. I came back on 27 September with a plan for the day in three parts. First, finish the editor so that it was usable. Second, make the engine load authored 3D models with their materials. Third, make the game and the editor read the same scene file, so that a change made in the editor is a change to the game. Thirteen commits on the branch `editor/phase0-stabilize` covered all three, from `551e193` to `1786954`.

The order followed a rule I had set in June. I had removed the box stand-ins from the hallway and decided that props would be authored models, so the engine needed a content pipeline before the hallway could get lamps and doors back. The editor needed to work well enough to place them.

![The June editor, with abbreviations as buttons and a layout that is still changing](/images/2026-09-27-back-to-work/editor-june.jpg "15 June. The toolbar is a row of abbreviations and the docks overlap in places.")

![The September editor with named toolbar buttons, a full-height outliner and inspector, and a wall lamp visible in the viewport](/images/2026-09-27-back-to-work/editor-reskin-with-fixtures.jpg "27 September. Named buttons, full-height side docks, bottom tabs, and a wall lamp in the viewport. The scene now has 75 entities.")

## Finishing the editor reskin

The visible changes were a top command bar with named buttons, side docks that run the full height of the window, a Materials panel, a darker theme with accent borders, and a borderless window that can be resized, closed with Ctrl+Q and toggled with F11. Docks placed on the same side now stack instead of drawing over each other.

Resizing a borderless window needs the swap chain to follow it. The back buffers belong to the swap chain and have a fixed size, so when the window changes size the program has to wait for the GPU to finish with them, release them, ask DXGI to resize the buffers and create new views. Every render target that depends on the window size, such as the depth buffer and the HDR target, has to be recreated as well.

### Keyboard shortcuts that did not fire

The more important fix was in input. Ctrl+S, Ctrl+Z, Ctrl+Y, the command palette, Enter and Backspace in text fields, and the game's interact key E almost never worked.

> **Background: level input and edge input**
>
> A key has a level, which is whether it is down now, and an edge, which is the moment it went from up to down. A shortcut such as Ctrl+S should fire once per press, so it needs the edge. The Win32 function `GetAsyncKeyState` returns both pieces: the high bit is the level, and the low bit means that the key was pressed since the previous call. That low bit is consumed by whichever code calls the function first.

My window code polled all 256 keys once per frame to fill the level array. That loop consumed the "pressed since last call" bit before the shortcut code asked for it, so the shortcut code nearly always saw nothing. The fix was to compute edges myself, once per frame, by comparing the current key state with the state of the previous frame:

```cpp
input.keys[i]        = focused && (GetAsyncKeyState(i) & 0x8000) != 0;
input.keysPressed[i] = input.keys[i] && !m_previousKeys[i];
m_previousKeys[i]    = input.keys[i];
```

Keyboard state is also reported only while the window has the focus, and the toggles for debug views and the flashlight now come from `WM_KEYDOWN` messages, so that one press changes them exactly once.

## Loading real meshes with glTF

I had added a glTF importer on 9 June. On 27 September I rewrote it to handle what a real asset contains. First, a short explanation of the format.

> **Background: how a glTF file is organised**
>
> glTF is an open format for 3D assets. It separates the description of a model from its data. The description is JSON, and it holds only indices and sizes. The data is a set of raw binary buffers.
>
> A mesh in the JSON has one or more primitives. A primitive names a set of vertex attributes (`POSITION`, `NORMAL`, `TEXCOORD_0` and so on), an index accessor and a material. Each attribute is an accessor, which says what the numbers are: the component type (float, unsigned short and so on), the element type (`VEC3` for three components), the count, and whether integers are normalised to 0 to 1. An accessor points to a buffer view, which gives a byte offset, a length and optionally a byte stride into a buffer. The buffer is the actual bytes, stored in a separate `.bin` file, embedded as a base64 `data:` URI, or, in the single-file `.glb` form, in a binary chunk.
>
> A `.glb` file is a 12-byte header (the magic number `glTF`, a version and the total length) followed by chunks. Each chunk has a length, a type and its data. The first chunk is the JSON and the second is the binary buffer.
>
> The scene itself is a tree of nodes. Each node has a transform, given either as a matrix or as translation, rotation and scale, and may refer to a mesh. A mesh's world transform is the product of the transforms from the root down to its node.

![Boxes from mesh primitive to accessor to buffer view to buffer, with the JSON part holding indices and sizes and the buffer holding the bytes](/images/2026-09-27-back-to-work/gltf-layout.svg "The chain of references in a glTF file. The numbers are examples.")

My importer reads this in these steps.

1. **Parse the JSON** with the engine's JSON parser, and read the buffers. For a `.glb`, it checks the magic number and the chunk types `JSON` and `BIN`.
2. **Walk the node graph** from the scene's root nodes, multiplying each node's local matrix by its parent's world matrix. The depth is limited to 64 levels, so that a cyclic hierarchy in a damaged file produces an error and not an endless loop.
3. **For each mesh node, read the accessors.** The reader respects the component type, the normalised flag and the byte stride, because exporters often interleave attributes.
4. **Convert to engine space and bake the node transform** into the vertices, so that the engine receives a flat list of vertices, an index list, a list of submeshes and a list of materials.
5. **Generate normals and tangents** when the file does not provide them.

One of the commits in this group, `9ce9114`, also replaced three hand-written JSON parsers in the code base with one shared parser, and split the engine into static libraries. The glTF importer, the scene loader and the material manifest all use the shared parser now.

### Converting between coordinate systems

> **Background: handedness**
>
> A coordinate system is either right-handed or left-handed. If x points right and y points up, then the z axis points toward the viewer in a right-handed system and away from the viewer in a left-handed system. glTF is right-handed. My engine, like Direct3D, is left-handed with +Y up.
>
> The conversion is a mirror. Negating z turns one system into the other, so the importer multiplies every node's world matrix by a scale of (1, 1, -1). A mirror also reverses the meaning of triangle winding. The rasteriser decides which side of a triangle is its front by the order of its vertices on screen. A mirrored model looks the same on screen, so a face that glTF defines as counter-clockwise is still counter-clockwise on screen, but my renderer treats clockwise as the front. The index order of every triangle therefore has to be swapped.

In the importer this is implemented by checking the sign of the determinant of the combined matrix. The Z mirror alone gives a negative determinant. Whenever it is negative, the importer swaps the second and third index of every triangle, and flips the sign of the tangent's handedness value. The same test covers models whose nodes already contain a negative scale. Normals are transformed by the inverse transpose of the matrix, so that they stay perpendicular to the surface when the scale is not uniform.

### Tangents and normal maps

> **Background: tangent space**
>
> A normal map stores a surface normal in each texel, but not in world coordinates. If it did, the map could not be used on a wall and a floor, or on a mesh that is turned or bent. Instead each normal is stored in tangent space, a coordinate frame fixed to the surface at that point. The frame has three axes: the normal `N`, the tangent `T`, which points along the direction in which the texture's u coordinate increases, and the bitangent `B`, which points along v. A texel that contains (0, 0, 1) means "no change". The shader rebuilds the world normal as `normalize(T * x + B * y + N * z)`.
>
> A mesh therefore needs a tangent per vertex. If the file has none, they can be computed from the texture coordinates. For a triangle with edge vectors `e1`, `e2` and texture coordinate differences `(du1, dv1)`, `(du2, dv2)`, the tangent is the direction in space along which u grows. This is solved as a small linear system. The per-triangle results are summed at each vertex, the sum is made perpendicular to the normal (Gram-Schmidt), and the sign of the bitangent is stored in the fourth component, `w`. This is the method described by Eric Lengyel, and it is widely used.

My importer uses the tangents from the file when it has them and generates them in the way described when it does not. The vertex layout that results is position, normal, one texture coordinate set and a four-component tangent. The bitangent is rebuilt in the shader as `cross(normal, tangent.xyz) * tangent.w`.

## Materials per submesh

A glTF primitive refers to one material, so each primitive becomes a submesh: a range of the index buffer that is drawn with its own material. The importer reads the metallic-roughness model: a base colour factor and texture, metallic and roughness factors with one combined texture, a normal map with a scale, an occlusion map with a strength, and an emissive colour with an optional texture. It also reads the alpha mode and the double-sided flag.

The renderer binds the textures of a submesh when it draws it. For imported meshes the shader reads the combined texture the way the glTF specification defines it: roughness from the green channel and metalness from the blue channel, each multiplied by its factor. Roughness is clamped to at least 0.03, so that the specular highlight never becomes infinitely sharp. Emissive light is added to the result. It is not multiplied by the lighting.

Emissive values can exceed 1. The extension `KHR_materials_emissive_strength` multiplies the colour by a strength factor, and the importer reads it. This matters because the scene target is HDR, and the bloom pass thresholds on brightness. A glowing bulb with an emissive value of 1.0 would not stand out from a lit wall. With a larger value it is the brightest object in the frame, and the bloom pass picks it out.

## An authored asset: the wall sconce

The first model to go through this pipeline is a wall sconce. I did not model it in an external program. It is generated by a Python script, `Tools/AssetAuthoring/build_wall_sconce.py`, with a helper module that builds meshes and writes glTF. The script produces an aged brass single-arm sconce with a frosted glass shade. The brass textures are also generated by code: a base colour with tarnish, a metallic-roughness map, and a normal map with faint hammered dimples.

Generating the model from a script means that the asset can be rebuilt after a change to its dimensions, and its shape is defined in code that I can review. The sconce is placed at every lamp position in the hallway. The image below shows it at close range. I magnified it so the pixels are visible, and the debug option `--camera=` froze the viewpoint for the capture.

![A brass wall sconce with a frosted glass shade and a bright bulb, seen at close range against a dark wall, with visible pixel blocks](/images/2026-09-27-back-to-work/wall-sconce-closeup.jpg "The sconce at close range, magnified. The shade and the bulb are emissive, so they are the brightest things in the frame.")

## One scene file for the editor and the game

Until this point the game and the editor had different starting points. The game read the hallway descriptor, `hallway.scene.json`, and built the entity scene from it at every launch. The editor opened the same descriptor and saved to a private file under `Saved/Editor`. A change saved in the editor did not change the game.

I replaced this with a single authored scene file, `Demo/Hallway/hallway.entity_scene.json`, about 2,500 lines of JSON. Both programs now call one function, `ECS::LoadScene`, with a path. The runtime accepts a `--scene=` option to load a different file. If loading fails, it logs the error and falls back to the old descriptor, so that a damaged scene cannot leave the game without a level. The editor's saved settings from before the change pointed at the descriptor, so on load I migrate exactly those old defaults to the new scene.

This is the data-driven design that the entity scene in June was meant to enable. The scene file is the single source of truth, and the code that builds the hallway from a descriptor is now a fallback and a way to generate a new scene. Saving in the editor changes what the game plays.

## Results and open issues

I checked each step by running the engine and looking at a screenshot, and by adding unit tests for the JSON parser, the glTF importer, meshes, materials and scene loading. The result is an editor that I can use, a pipeline that takes an authored model with materials from a file to the screen, and a scene file that both programs share.

The lighting model was unchanged on this day. The hallway was still dark, and the floor reflection was still a fake. The screenshot of the sconce also shows that texture and lighting detail on small objects was coarse. The next post covers the other work that day: startup caches, then collision.
