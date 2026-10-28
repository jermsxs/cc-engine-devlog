---
title: Crash reports, collision from the mesh and Git LFS for assets
date: 2026-10-09
order: 1
summary: Every crash now prints its cause and call stack and writes a minidump, props collide with authored convex pieces, and downloaded assets go in through a checked script and Git LFS.
tags: tools, physics, assets
cover: /images/2026-10-09-crash-reports-mesh-collision/after-console-frame-lamp-runner.jpg
---

Three pieces of work came in a deliberate order. I wanted to build collision from imported meshes, and while finishing the previous step a test had died with nothing but "exit code 3". Finding the failure meant adding print statements by hand. Before writing more code that could crash in new ways, I made crashes explain themselves. Then I built the collision. Then I used the asset pipeline for the first time with real downloads, which meant deciding where large art files live.

## Crash reports

### What a crash is, and how a debugger finds the line

When code does something the processor cannot continue with, such as reading an unmapped address or dividing by zero, the CPU raises an exception. Windows passes it through a chain of handlers. If none handles it, the process is terminated, and all that is left is a bare exit code.

At the moment of the exception the processor state is available: the instruction pointer (the address of the faulting instruction) and the stack pointer. From them a program can reconstruct how it got there.

> **Background: call stacks, symbols and minidumps.**
> The **call stack** is the chain of functions that were executing, innermost first: crashed in `ReadSceneFile`, called by `LoadLevel`, called by `main`. Each caller left a return address on the stack. On 64-bit Windows the frames are not found by following a frame pointer. The compiler emits unwind data for every function, and a stack walker reads that data to learn each function's frame size and where its return address is.
>
> The walker produces raw addresses such as `0x7ff6a2c41b80`. **Symbols** turn them into names. The compiler writes a separate program database (a PDB file) that maps address ranges to function names and source lines. Looking an address up in it is called symbolication. One detail matters: a return address points to the instruction after the call, so to report the line of the call itself the lookup uses the address minus one.
>
> A **minidump** is a snapshot of the process at the crash: the threads, their stacks, the loaded modules and some referenced memory. A debugger that has the matching PDB opens it at the crashing line, as if the program had been under the debugger live.

### How my handler works

A program can die through several different channels, and each one needs its own hook. My handler installs all of them once, early in `main`:

- `SetUnhandledExceptionFilter` for hardware exceptions: access violation, divide by zero, stack overflow;
- `std::set_terminate` for a C++ exception that nothing caught;
- a `SIGABRT` handler for `abort()`;
- the CRT's invalid-parameter and pure-virtual-call handlers;
- a CRT report hook, which catches Debug assertions such as "vector subscript out of range".

Each hook prints the cause, walks the stack with `StackWalk64` and the dbghelp symbol functions, and exits without waiting on a dialog box. The frames that belong to the handler itself are removed, so the first line of the report is the line where the program went wrong. A report looks like this:

```text
=== CRASH: EntitySceneTests.exe: access violation writing 0x0000000000000000 (exception 0xC0000005) ===
  #0  BuildRenderSceneViewFromEntityScene  Engine\ECS\EntityRenderSceneBridge.cpp:101
  #1  TestMaterialSlotOverrides            Tests\EntitySceneTests.cpp:1830
```

Every test program installs it, so a crashing test shows its line under `ctest`. The game, the editor, the MCP server and my scene inspection tool also write the text report and a minidump to `Saved\Crashes`, and old reports are pruned. The validation script prints any report written during a run, and it fails on one even if every step passed. I checked that by planting a fake report halfway through a run.

### What testing found

`CrashHandlerTests` starts child copies of a test crash seven different ways. Each report has to name the cause, the crashing function and its source line, without the handler's own frames. The first run found a gap. An uncaught `throw` arrives at Windows as a raw exception before C++'s own handler sees it, so the report said only "C++ exception not caught". The handler now reads the thrown object's type and message from the exception record, so a report reads "uncaught C++ exception std::runtime_error: ...".

I also crashed a real engine tool on purpose and checked that the report named the right function and that a minidump was written. One rule is now in the developer documentation. A crash in code nobody touched usually means stale object files from an interrupted build, and the response is a clean rebuild.

## Collision from the mesh

### Convex shapes and triangle meshes

A physics engine does not use the mesh that is drawn. It uses collision shapes, and the choice of shape decides what is possible. There are two families.

**Convex shapes.** A shape is convex when the segment between any two points of it stays inside it. Boxes, spheres, capsules and convex hulls qualify. A convex hull is the shrink-wrap around a set of points. Convex shapes are what rigid-body physics is built on, for three reasons:

- they have a well-defined inside, so mass, centre of mass and inertia can be computed;
- the closest points between two of them can be found with the GJK algorithm, and overlap between two polyhedra can be tested with the separating axis theorem, which looks for a plane that separates them;
- contacts between them are a small, stable manifold: four points for two boxes resting on each other.

**Triangle meshes.** A triangle soup can describe any shape, including a hollow one. It has no inside. A point has no signed depth in it, a thin or fast object can pass through between two frames, and there is no volume from which to derive mass. So a triangle mesh is used for static surfaces such as terrain, and a dynamic body is built from convex parts.

An object that is not convex is made of several convex pieces, which is called a compound. The accuracy of the compound is the accuracy of the pieces.

### The problem

My props used one convex hull each. A convex hull of an open box is a solid box, because the hull has to fill in everything between the walls. An open box, a shelf or a chair collided as if it were a solid lump.

### What I built

I borrowed Unreal's convention. In Blender I add convex boxes named `UCX_...` next to the drawn mesh. The importer keeps them apart from the visible geometry, so they never appear in the drawing or the bounds, and it places and mirrors them as it does vertices. A new collider shape, `meshPieces`, gives one convex hull per piece. Rays and the player meet each piece, and a rigid prop built this way becomes a compound body made of its pieces. My hull builder caps each hull at 32 vertices and merges coplanar faces, so a box piece is six quads.

The editor's collider overlay also draws hulls now. Before, it drew hull and cylinder colliders as empty capsules, so they were never visible.

![The editor showing the five collision slabs of the open box](/images/2026-10-09-crash-reports-mesh-collision/editor-collision-pieces.jpg "The test box in the editor with its collision overlay: five slabs, one for each wall and one for the floor.")

### Testing with an open box

I built a test box, 0.6 by 0.3 by 0.4 m, in the live Blender: one drawn mesh and five collision slabs. The export exposed two bugs in my export script. It took the default cube from another Blender scene, and it asked the collision pieces for tangents. Both are fixed. Then I dropped a crate onto the box in the game.

![The crate fell inside the box](/images/2026-10-09-crash-reports-mesh-collision/pieces-crate-inside-box.jpg "With one hull per slab, the crate falls inside the open box and rests on its floor.")

![The crate rests on the box with a single hull](/images/2026-10-09-crash-reports-mesh-collision/single-hull-crate-on-invisible-lid.jpg "The same scene with a single convex hull: the crate rests on an invisible lid.")

A ray cast down the middle of the tray now stops on its floor, 10 cm down. With a single hull it stops at the top. A dynamic tray is a three-part compound and lands flat, and a sidecar scale of 2 doubles the floor along with the drawn mesh. The pieces are authored by hand. I have not added automatic convex decomposition, and boxes and slabs cover most interiors.

## Downloads, and where large files live

### How Git LFS works

Git stores every version of every file in the repository history. That suits source code and does not suit a 50 MB texture set, because each edit adds another full copy that every clone must download.

Git Large File Storage replaces the large file in the repository with a small text pointer, in this format (the values are an example):

```text
version https://git-lfs.github.com/spec/v1
oid sha256:4d7a2146...
size 52428800
```

The file's content lives on a separate server and are fetched by their hash. The substitution is done by filters that `.gitattributes` assigns to file patterns: on commit, the large file is replaced by its pointer, and on checkout, the pointer is replaced by the file. The repository stays small and fast. The cost is that a clone made without `git lfs pull` contains pointer files where images should be, and the engine then tries to read a text file as a PNG.

### What I put in LFS

My patterns cover Blender `.blend` sources, layered and HDR images, and everything downloaded under `Game/Assets/ThirdParty/`. Code, scenes, glTF text, sidecars and the engine's own generated textures stay in ordinary git, so they still produce readable diffs. A new `Art/` folder holds working files that the engine never reads.

A forgotten `git lfs pull` would otherwise show up as blank materials. The Validation panel now names any file that is still a pointer, and the log does the same when the engine tries to load one.

I also cleaned up two ambientCG texture sets from June. Wood051 and Plaster004 moved to the third-party folder with CC0 records, and only the four maps the engine reads are kept. About 50 MB of GL normals, `.blend`, `.usdc` and preview files are gone. The lighting had to be rebaked, because the bake's freshness check reads the material library's text and the paths in it had changed. The baked data came out identical.

### A script that fetches with checks

`ingest.py` fetches one Poly Haven model or one ambientCG material, keeps only what the engine uses, and writes a record of the source, author, licence and date. Downloads are untrusted, so the script limits what they can do:

- each download goes into a fresh folder;
- only those two hosts are contacted;
- archives are never unpacked wholesale, and no path may leave its folder;
- every texture must really be a PNG or JPEG;
- `--dry-run` lists the files and sizes first.

Downloading is a command I run myself. It is not an MCP tool.

A shared checker, `gltf_check.py`, runs from the Blender exporter, the ingest script and the tests. It reports what the engine would reject or draw wrongly, and it flags props over 50,000 triangles or textures over 2048 pixels. Interiors have no level-of-detail meshes, so a heavy prop has a direct cost.

### The first real props

After I approved about 20 MB of downloads, three Poly Haven props came in (a hall console, a hanging picture frame and an oil lamp) with a dark dirty carpet from ambientCG. I placed them in the hallway's south leg through the headless MCP server to look at them.

The first look showed a fault. The painting in the frame was black, and the lamp's glass chimney was a dark rod.

![The first ingest, with opaque glass](/images/2026-10-09-crash-reports-mesh-collision/first-ingest-opaque-glass.jpg "The first ingest: the frame's glass hides the painting completely, and the lamp's chimney is a dark rod.")

The renderer was correct. Blender's glTF exporter turns transmission glass into a blended material with an alpha of 1, and under the glTF rules an alpha of 1 is fully opaque. The checker now reports such materials, and the ingest script gives them a see-through alpha and records the edit in the asset's sidecar.

![After the fix: console, oil lamp, framed painting and runner](/images/2026-10-09-crash-reports-mesh-collision/after-console-frame-lamp-runner.jpg "The painting shows through clear glass. The runner is the Fabric029 carpet over the herringbone floor.")

![Close-up of the lamp and frame](/images/2026-10-09-crash-reports-mesh-collision/glass-fixed-closeup.jpg "Up close, the painting sits behind clear glass and the porcelain lamp has real material detail.")

All four props together cost about 0.07 ms of GPU time: 1.28 ms became 1.35 ms at 1280 by 720, headless, in a Release build. I did not save them into the demo, which stays a clean baseline. Today they exist only in the library.

## Results and open issues

All 87 test suites pass, the validation script reports no crash reports, and the editor smoothness check shows 0 hitches. Crashes name their cause and line, hollow props collide as hollow, and downloaded assets arrive with a licence record.

Three items are open. The oil lamp's flame is now faint, and a lit lamp needs an emissive or additive flame. The runner's 2 mm height scale is untuned. There is no remote repository yet, and pushing will need a host that supports LFS. Next is the preview renderer, so I can judge a prop on its own before it goes into a scene.
