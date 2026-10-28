---
title: Matte walls, Blender, and a pipeline for real assets
date: 2026-10-08
order: 1
summary: Rougher walls and floors fix the wet look, Blender joins the toolchain, and a new track starts on a mesh cache, sidecars, importer fixes and material slots.
tags: materials, assets, tools
cover: /images/2026-10-08-production-assets/hallway-floor.jpg
---

Until now, every prop in the hallway came from a Python script in my own tools folder: boxes, lathes and hand-placed vertices. That got me a clean baseline, but it will never give me a convincing chair or a carved console table. Today Blender 5.2 joined the toolchain, and by the end of the day I had written a plan for getting real assets into the engine. First, though, there was a look problem to fix.

## Why everything looked wet

I had noticed that wherever a lamp's light landed, the walls and floor looked shiny. It looked bad: plaster should look like plaster, not like a varnished table.

I switched each part of the lighting off in turn and compared the images. It was not the screen-space reflections, and it was not the new brighter lamp globes. It was the *ambient specular*: the glossy reflections of the room that come from the baked reflection probes. In the ambient-only debug view, the walls looked like wet plaster and the parquet like polished glass. With that term off, both went matte.

> **Concept: Roughness.** A PBR (physically based rendering) material has a roughness value from 0 to 1. At 0 the surface is a mirror: light bounces off in one tight direction, so you see sharp reflections. At 1 it is chalk: microscopic bumps scatter light every way, so reflections smear into a faint, wide glow. Real plaster and old matte paint are around 0.9 or above. Mine sat at 0.65 to 0.81 for plaster, and 0.48 for the parquet, so a lamp's light skated off them like it would off lacquer.

The fix was to raise roughness. Plaster and wallpaper went to about 0.95, parquet to 0.88, dark wood floor to 0.92. The tile kept its gloss, because tile is glossy. I rebaked both scenes, since the bake key covers the materials.

![The hallway parquet before and after](/images/2026-10-08-production-assets/hallway-floor.jpg "Brightened 2x. Left: wet glints on the parquet. Right: the glints are gone and the wood grain carries the look.")

![A house corridor before and after](/images/2026-10-08-production-assets/house-wall.jpg "Left: a sheen around the lamp on the wallpaper. Right: matte.")

An editor bug turned up on the way. The material panel clamped a roughness *factor* to 1, so touching a floor that already sat at 1.4 would have made it glossier. A factor above 1 is how you make a glossy roughness map matte, because the shader caps the final result at 1. The limit is now 4.

Then I spotted something else: a soft bright ball on the wall facing a lamp. The reflection probes had stored the lamp's glowing globe at full strength (40, since the day before), and a rough wall blurs that reflection into a blob. But that light was counted twice, because the lamp already lights that wall directly. So the reflection captures now cap any glowing surface at a luminance of 4. A polished surface still mirrors a lit globe; a rough wall no longer shows a ghost of it.

## Blender joins the toolchain

I installed the Blender MCP add-on, and my project config now starts a Blender server beside the editor server, so an AI agent can drive Blender the way it already drives the editor. A small export script writes the glTF files my importer expects. (glTF is the open interchange format for 3D models.) It writes the "separate" variant, with `.gltf`, `.bin` and PNG files side by side, because at that point the importer ignored textures packed inside a single `.glb`. It exports tangents, applies modifiers, and avoids Draco compression, which my importer would refuse. Afterward it checks the file and warns about anything the engine would drop.

My first test was a bevelled cube with a colour-grid texture. It came through with bevel, texture and tangents.

![A test crate exported from Blender](/images/2026-10-08-production-assets/engine-matches-blender.jpg "Later in the day, three test panels from Blender rendered in the engine. The middle one has a rotated, scaled texture and matches Blender's own render.")

## A plan for real assets

With Blender connected, I wrote a twenty-step plan I call Track P: a static asset pipeline, a model viewer, skeletal animation, editor and script integration, and finally a first enemy made in Blender. Ground rules: outside assets only as CC0 (public domain) from Poly Haven and ambientCG, each with its source recorded; animation authored in Blender, no outside animation library; and this track before audio work.

### One mesh cache

Half a dozen parts of the engine read imported meshes: the renderer, the lightmap baker, the reflection-probe baker, physics hulls and the asset browser. Each parsed the glTF itself, and the renderer also baked ambient occlusion and wear masks for every mesh on every launch.

Now a mesh is imported and baked once, and the result is saved in a cache folder. Later launches read it back, and while any part of the engine holds a mesh, the others share it. An entry is trusted only while the `.gltf` and every `.bin` it read are unchanged, and only for the importer version that made it. A truncated or corrupt entry is never handed to the GPU. In the debug build, loading the house fell from 31.5 s to 25.6 s, with 5.1 s of baking gone.

One side effect worth noting: a warm launch loads faster, so the animated fog is in a different state at frame 120, and screenshots differed slightly. With fog and post-processing off, cold and warm runs matched to within noise.

### Sidecars

Every asset should say where it came from, under what licence, and how to import it. I give each asset a small *sidecar* file beside it: `chair.asset.json` next to `chair.gltf`. It records the source, author, licence and download date, plus import settings such as a scale (for a model made in centimetres). The settings are part of the cache key, so changing one re-cooks the mesh. In the running editor, writing a scale of 1.5 into a crate's sidecar made it grow within a few seconds, with no restart.

The editor's validation panel now audits licences: anything under the third-party folder without a CC0 sidecar is an error. Testing this caught a real bug: a mesh already held with the old settings was handed back after its sidecar changed. Now the share step compares settings too.

### Gaps real files hit

Files from Blender and asset libraries use features my importer had skipped. Three mattered most:

- **Textures packed inside a `.glb`.** This is Blender's default export. The cook now writes each image out into the cache and the normal texture loader takes over.
- **A second UV map.** A material can read its texture from the second set of texture coordinates.
- **Texture transforms.** Blender writes an offset, rotation and scale per texture whenever a material has a Mapping node. My renderer draws one UV set per vertex, so the import now bakes the transform into the UVs and remakes the tangents.

The rotation was the trap. The extension's reference code, read literally, turned a Blender rotation the wrong way, so stripes slanted up instead of down. Blender's Mapping node rotates with V pointing up, and the exporter converts to glTF's V-down space. Working that through gives a matrix that is the spec's matrix read as rows rather than columns. I checked it by rendering three test panels in Blender's Cycles and in the engine side by side. The first try turned the middle panel the wrong way. After the fix, all three matched.

Anything the importer cannot honour exactly now becomes a note, shown in the Assets panel and the validation panel, instead of failing silently.

### Material slots

A downloaded chair arrives with its own colours, not the matte, grimy look the hallway is tuned for. I already had library materials (plaster, dark wood, wallpaper, tile), but they were projected from the world, which suits trim and rails, not a chair.

Each material of a mesh is now a named *slot*. Any slot can be drawn with a library material on the mesh's own UVs, in three layers: the file's material, a default in the sidecar, and an override on one placed entity. The entity wins. The Inspector lists the slots with a picker each.

![An armchair with its own materials](/images/2026-10-08-production-assets/armchair-own-materials.jpg "The test armchair as exported, with its own velvet and wood.")

![The same armchair with library materials](/images/2026-10-08-production-assets/armchair-slots-wallpaper-dark-wood.jpg "The velvet slot now uses the library wallpaper and the legs use dark wood, tiled twice.")

I stopped halfway through compiling at one point, which left object files from the old struct layout around, and a scene test suddenly aborted in code I had not touched. A clean rebuild fixed it. A good reminder that a crash in untouched code usually means stale objects.

## Where it ended up

By the end of the day the floors and walls were matte, Blender and the engine could exchange files, and a mesh knew where it came from. Next up were crash reports, collision built from the mesh itself, and downloading real assets.
