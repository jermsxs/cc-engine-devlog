---
title: Roughness for old surfaces, Blender, and the start of an asset pipeline
date: 2026-10-08
order: 1
summary: Raising roughness removes the wet look from walls and floors, then Blender joins the toolchain and the asset pipeline gets a mesh cache, sidecars, importer fixes and material slots.
tags: materials, assets, tools
cover: /images/2026-10-08-production-assets/hallway-floor.jpg
---

Every prop in the hallway so far came from a Python script in my tools folder: boxes, lathes and hand-placed vertices. That produced a clean baseline, but it cannot produce a convincing armchair or a carved console table. Today Blender 5.2 joined the toolchain, and I wrote a twenty-step plan for bringing authored assets into the engine. Before that, there was a look problem. Wherever a lamp's light fell on a wall or the floor, the surface looked wet.

## Why the walls and floor looked wet

I disliked the sheen at once. Old plaster and dry parquet do not shine. I switched each part of the lighting off in turn and compared the images:

- Screen-space reflections were not the cause. Their own debug view added almost nothing.
- The new, brighter lamp globes were not the cause. Swapping the old reflection bake back in looked the same.
- The ambient specular was the cause. That is the glossy reflection of the room that comes from the baked reflection probes. In the ambient-only debug view the walls looked like wet plaster and the parquet like polished glass. With that term switched off, both went matte.

![Ambient lighting only, with specular](/images/2026-10-08-production-assets/ambient-only.jpg "Ambient-only debug view with the probes' glossy reflections: the left wall shows a wet sheen and the parquet reflects the lamps.")

![Ambient lighting only, without specular](/images/2026-10-08-production-assets/ambient-no-specular.jpg "The same view with the ambient specular switched off: both surfaces are matte.")

### How roughness works

A physically based material describes a surface with a roughness value from 0 to 1. The model behind it is the microfacet theory: a surface that looks flat is covered with microscopic facets, each a tiny mirror. Light reflects off a facet in the mirror direction, but the facets point in slightly different directions. Roughness is the spread of those directions.

- At roughness 0 all facets agree. A light reflects in one tight direction and the viewer sees a sharp, bright mirror image of it.
- At roughness 1 the facets point everywhere. The same energy leaves in a wide lobe, so the reflection becomes a faint, broad glow with no distinct shape.

The renderer evaluates this with the GGX normal distribution. Its value for facets aligned exactly with the half vector between light and view is:

```text
alpha = roughness^2
D_peak = 1 / (pi * alpha^2)
```

The squaring in the first line is a common remapping that spreads the useful range over the slider. The peak is the brightness of the highlight, so it shows how fast a highlight dims as roughness rises. For roughness 0.48, where my parquet was, `D_peak` is about 6.0. At 0.88 it is about 0.53, a factor of 11 lower, and the highlight is spread over a much larger angle. At 0.95 the peak is about 0.39.

Probe reflections follow the same rule by a different route. A reflection probe is a cube map of the room, prefiltered into mip levels, where each mip is the room blurred as a surface of a given roughness would blur it. A shader reads the mip that matches the surface's roughness. Low roughness reads a sharp mip, so the lamp appears as a crisp image on the floor. High roughness reads a blurred mip, so the lamp contributes a dim wash.

### Why matte reads as old

Roughness is also information about age and condition. A new varnished floor and fresh gloss paint are smooth films. Years of foot traffic, dust, grime and moisture wear the film down and roughen the surface at the microscopic scale. Wet surfaces do the opposite: water fills the microscopic valleys and the surface becomes smoother and darker. A wall that shines where a lamp lights it therefore reads as new or wet, and the reference is neither. Real plaster and old matte paint sit at about 0.9 or above.

My surfaces were too smooth for what they were. Plaster and wallpaper were at roughness 0.65 to 0.81, and the herringbone parquet was at 0.48. Lamp light skated off them in the way it does off a varnished table.

### What I changed

I raised the roughness factors in `Demo/Hallway/materials.json`, which both scenes use:

| Material | Factor | Resulting roughness |
|---|---|---|
| Dirty plaster | 1.45 | about 0.95 |
| Grimy plaster | 1.22 | about 0.95 |
| Wallpaper | 1.17 | about 0.95 |
| Herringbone parquet | 2.6 | about 0.88 |
| Dark wood floor | 1.7 | about 0.92 |
| Painted trim | 1.9 | about 0.87 |

Tiles keep their gloss, because tile is glossy. A shared material cannot serve every floor. If I want a polished floor, it will be its own material and I will decide that deliberately. Both scenes had to be rebaked, because the bake key covers the materials.

![The hallway parquet before and after](/images/2026-10-08-production-assets/hallway-floor.jpg "Brightened 2x. Left: wet glints on the parquet. Right: the glints are gone and the wood grain carries the look.")

Two related fixes came with it.

**The material panel clamped roughness factors to 1.** The factor multiplies the roughness map's value, and the shader caps the product at 1. A factor above 1 is therefore how a glossy map is made matte, and touching a floor that already sat at 1.4 would have made it glossier. The limit is now 4.

**A ghost of the lamp on the wall opposite it.** A soft bright ball appeared on the wall facing each lamp. The reflection probes had stored the lamp's globe at full strength (40, since the day before), and a rough wall blurs that reflection into a blob. The light was counted twice, because the lamp already lights that wall directly. The reflection captures now cap any glowing surface at a luminance of 4 and keep its colour. A polished surface still mirrors a lit globe, and a rough wall no longer shows a ghost of it.

## Blender joins the toolchain

I installed the Blender MCP add-on. My project configuration now starts a Blender server next to the editor server, so an AI agent can drive Blender the way it can already drive the editor. A small script, `blender_export.py`, writes glTF files with the settings my importer reads. glTF is the open interchange format for 3D models.

- It writes the separate variant: a `.gltf` file with `.bin` and PNG files beside it, because the importer ignored textures packed inside a single `.glb` at that point.
- It exports tangents and applies modifiers.
- It leaves out Draco compression, which the importer refuses.
- After exporting, it checks the file and warns about anything the engine would drop.

The first test was a bevelled cube with a colour-grid texture. It came through with its bevel, texture and tangents.

## Track P: a plan for authored assets

With Blender connected, I wrote `Docs/TrackP-Plan.md`. It has twenty steps in five phases: a static asset pipeline, a model viewer, skeletal animation, editor and script integration, and a first enemy made in Blender. Three rules apply throughout. Outside assets are CC0 only, from Poly Haven and ambientCG, each with its source and licence recorded. Animation is authored in Blender, with no outside animation library. This track goes before audio work.

## One mesh cache for every reader

### How an import pipeline works

A glTF file is an interchange format, written for exchange and not for fast loading. Before the renderer can draw it, the engine does a series of steps, called cooking:

1. Parse the JSON, read the binary buffers and follow the node hierarchy.
2. Convert the vertex attributes to the engine's layout and generate missing tangents.
3. Run bakes that depend only on the mesh. Mine bake vertex occlusion, which darkens creases, and wear masks, which mark edges that would be scuffed.
4. Hand the result to its consumers.

Cooking is deterministic, so its result can be stored. A cache stores the cooked output and has to decide on each launch whether the stored result is still valid. The usual method is a key made of everything the result depends on.

### What I had

Six places read imported meshes: the renderer, the lightmap baker, the probe bakes' scene geometry, physics hulls and the asset browser. Each parsed the glTF itself, and the renderer also baked occlusion and wear for every mesh on every launch.

### What I built

`Lighting::LoadCookedMesh` imports and bakes a mesh once, then writes the result to `Saved\MeshCache\<16 hex>.ccmesh`. The file name is a hash of the source path and the cook version. While any part of the engine holds a mesh, the others share it.

An entry is trusted only while three conditions hold:

- the `.gltf` and every `.bin` it read still have the size and write time recorded in the entry;
- the entry was made with the current cook version, which is built from the importer version, the occlusion bake version and the wear bake version;
- the file is intact. A truncated entry, or one with indices out of range, is never handed to the GPU.

The file states are taken before the import reads them. If a file is rewritten during the import, the stored state no longer matches and the entry is stale. This closes the window in which a half-written source could produce an entry that looks valid.

| Scene, Debug build, run to frame 120 | Before | Warm cache | Baking removed |
|---|---|---|---|
| Hallway | 16.2 s | 14.3 s | 1.4 s |
| House (36 meshes) | 31.5 s | 25.6 s | 5.1 s |

All 37 demo meshes read back byte-identical to a fresh cook. A side effect appeared in the screenshots: a faster load reaches frame 120 at a different moment, and the animated fog is in a different state there. With fog and post-processing off, cold and warm runs differ by 0.034 out of 255, below the run-to-run noise of 0.046.

## Sidecars: where an asset came from and how it is imported

Each asset should record its source, its licence and its import settings. I give each asset a small file beside it, called a sidecar: `chair.asset.json` next to `chair.gltf`. A texture folder gets one too.

A sidecar holds:

- the source (made in the engine's scripts, made in Blender, Poly Haven or ambientCG), the URL, the author, the licence and the download date;
- for a mesh, import settings such as a scale, for a model made in centimetres, and switches for the occlusion and wear bakes.

The settings are part of the cook key, so changing one re-cooks the mesh. A mesh without a sidecar keeps the key it had, so existing caches stay valid. In the running editor, writing a scale of 1.5 into a crate's sidecar made the crate 1.5 times larger within a few seconds, with no restart. The Assets panel also has **Save**, which writes the sidecar and reloads the mesh, and **Reimport**, which deletes the cached copy and imports and bakes the mesh again.

The Validation panel audits licences. Anything under `Game/Assets/ThirdParty/` without a CC0 sidecar is an error. Writing the tests caught a bug: a mesh still held with the old settings was handed back after its sidecar changed. The share step now compares settings as well as paths.

## Importer gaps that real files hit

Files from Blender and asset libraries use glTF features that my importer had skipped. Three mattered:

- **Textures packed inside a `.glb`.** This is Blender's default export. The cook now writes each image unchanged into the mesh cache, under a name made from its bytes, and the normal texture loader takes over. An unchanged image is never rewritten, so its texture is not cooked again.
- **A second UV map.** A material can read its texture from the second set of texture coordinates.
- **Texture transforms.** Blender writes an offset, rotation and scale per texture whenever a material has a Mapping node. The renderer draws one UV set per vertex, so the import bakes the transform into the UVs of the parts that use it and rebuilds the tangents when the UVs turn.

The rotation needed care. The extension's reference code, read literally, turned a Blender rotation the wrong way, so stripes slanted up instead of down. Blender's Mapping node rotates with V pointing up, and the exporter converts to glTF's V-down space. Working that through gives `u' = cos * u + sin * v` and `v' = -sin * u + cos * v`, which is the specification's matrix read as rows. I checked it by rendering three test panels in Blender's Cycles renderer and in the engine. My first attempt turned the middle panel the wrong way. After the fix all three matched.

![Three test panels with transformed textures in the engine](/images/2026-10-08-production-assets/engine-matches-blender.jpg "The three test panels after the fix, in the engine: plain, a Mapping node rotated 30 degrees at scale 2, and a second UV map turned a quarter. They match Blender's render.")

Anything the importer cannot honour exactly now becomes a note, shown in the Assets and Validation panels, instead of failing silently. Examples are a clamped sampler, an ignored optional extension and an image format the engine cannot read.

## Material slots

### The problem

A downloaded chair arrives with its own colours, not the matte, grimy look the hallway is tuned for. The library materials (plaster, dark wood, wallpaper, tile) could already be put on a mesh, but only as one material projected from world space. A world projection suits trim and rails. It does not suit a chair, whose texture should follow its own surface.

### How it works

A glTF mesh is split into primitives, and each primitive refers to a material. In my engine each of a mesh's materials is a named slot: the name Blender gave it (`Mahogany`, `Velvet`), or `#2` when it has none. Any slot can be drawn with a library material on the mesh's own UVs, tiled by the entity's Texture Scale.

The choice of material for a slot has three layers, and the nearest layer wins:

1. the material in the file;
2. a default for every placement of the mesh, stored in its sidecar (`"materials": {"Velvet": "demo.material.wall.tile"}`);
3. an override on one placed entity.

The Inspector lists the slots, each with a swatch and a picker, and shows the sidecar's default as "(asset default)". The same override can be set through MCP with `field_set`, and a value of `null` clears it. An overridden slot's colour feeds the baked bounce light, and the bake keys notice the change, while scenes without overrides keep their keys.

One limit is deliberate. Texture Rotation does not turn a slot's texture. Rotating UVs without rotating the mesh's tangents would light normal maps from the wrong side, so the UVs are rotated in Blender instead.

![The test armchair with its own materials](/images/2026-10-08-production-assets/armchair-own-materials.jpg "The test armchair as exported, with its own velvet and wood.")

![The armchair with library materials](/images/2026-10-08-production-assets/armchair-slots-wallpaper-dark-wood.jpg "The velvet slot uses the library wallpaper and the legs use dark wood, tiled twice.")

While working on this I stopped a build halfway through compiling. That left object files from the old struct layout behind, and a scene test aborted in code I had not touched. A clean rebuild fixed it. A crash in untouched code usually means stale objects.

## Results and next steps

The floors and walls are matte, Blender and the engine exchange files, a mesh records where it came from, and its materials can be replaced slot by slot. All 83 test suites pass, and the editor smoothness check shows 0 hitches. Next are crash reports, collision built from the mesh itself, and downloading real assets.
