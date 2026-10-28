---
title: Crash reports, mesh collision, and downloads with Git LFS
date: 2026-10-09
order: 1
summary: Crashes now say what died and where, props collide with their real shape, and the first CC0 downloads arrive through a checked pipeline backed by Git LFS.
tags: tools, physics, assets
cover: /images/2026-10-09-crash-reports-mesh-collision/after-console-frame-lamp-runner.jpg
---

Three things happened today, and they came in a deliberate order. Before building collision from meshes, I wanted to be able to understand a crash. Then I built the collision. Then I used the assets pipeline for the first time with real downloads, which meant deciding where big art files live.

## Crashes that explain themselves

While working on the previous step, a test crashed and all it told me was "exit code 3". Finding where meant adding print statements by hand. That is a slow way to spend an afternoon, so I fixed it first.

Now every way a program can die says why and where. That covers an access violation (reading memory that isn't yours), a divide by zero, a stack overflow, a failed Debug assertion like "vector subscript out of range", `abort()`, a C++ exception nobody caught (with its type and message), a bad argument to a C runtime function, and a pure virtual call. Each prints its cause and the call stack, then exits without waiting on a dialog box.

> **Concept: Call stack and symbols.** When code crashes, the computer only knows memory addresses, something like `0x7ff6a2c41b80`. The *call stack* is the chain of functions that were running, innermost first: "crashed in `ReadSceneFile`, called by `LoadLevel`, called by `main`". To turn addresses back into names and line numbers, you need *symbols*, a side file that the compiler writes. Matching addresses against that file is called *symbolication*. Without symbols, you get bare numbers.

The game, editor, MCP server and inspection tool also write a **minidump**, a small snapshot of the program's memory and threads at the moment of the crash. Opening it in Visual Studio takes you straight to the crashing line, as if you had been debugging live. Reports land in a `Saved\Crashes` folder, and my validation script prints any report written during a run and fails on one, even if every step passed.

Testing it caught a gap. An uncaught `throw` arrives as a raw Windows exception before C++'s own handler sees it, so the first report only said "C++ exception not caught". The handler now reads the thrown object's type and message from the exception record, so a report might say "uncaught C++ exception std::runtime_error: ..." instead. I tested all this by making child copies of a test crash seven different ways, and by crashing a real engine tool on purpose and checking that the report named the right function and source line.

One more rule is written down in the docs. If something crashes in code nobody touched, suspect stale object files from a build you interrupted, and rebuild clean.

## Collision from the mesh itself

Collision shapes are what the physics engine sees, and they are usually much simpler than what you see. My props used a single *convex hull*: imagine stretching shrink-wrap around the mesh. That is fast, but it fills in anything hollow. An open box, a shelf or a chair collides as if it were a solid lump.

The fix borrows a convention from Unreal. In Blender, you add convex boxes named `UCX_...` next to the drawn mesh. The importer keeps those apart from the visible geometry, and a new collider shape gives one convex hull per piece. Rays and the player meet each piece, and a rigid prop built this way becomes a compound body made of its pieces. The editor's collider overlay now draws hulls too. Before, it drew hull and cylinder colliders as empty capsules, so they never showed.

I tested it with an open box, 0.6 by 0.3 by 0.4 m, built in the live Blender: one drawn mesh and five collision slabs. The export showed two bugs in my script. It grabbed the default cube from another scene, and it asked the collision pieces for tangents. Both are fixed. Then I dropped a crate onto it:

![The crate fell into the box](/images/2026-10-09-crash-reports-mesh-collision/pieces-crate-inside-box.jpg "With per-slab collision, the crate falls inside the open box and rests on its floor.")

![The crate rests on the box with a single hull](/images/2026-10-09-crash-reports-mesh-collision/single-hull-crate-on-invisible-lid.jpg "Same scene with a single convex hull: the crate sits on an invisible lid.")

A ray down the middle of a tray now stops on its floor at 10 cm, where a single hull stops it at the top, 1 m up. There is no automatic splitting into pieces yet. They are authored by hand, and boxes and slabs cover most interiors.

## Downloads, and what Git LFS is

The next step was bringing in real assets. First I had to decide where large art files live.

> **Concept: Git LFS.** Git stores every version of every file forever. That is perfect for code and awful for 50 MB texture sets, because each edit adds another full copy to the repository. *Git Large File Storage* (LFS) fixes that by committing a tiny text *pointer* in place of the big file, and keeping the real bytes on a separate server that is fetched on demand. The repository stays small and fast, but you must run `git lfs pull` to get the real files. Without it, you get pointer files where images should be.

I chose LFS for Blender `.blend` sources, layered and HDR paintings, and everything downloaded under a third-party folder. Code, scenes, glTF text, sidecars and my own generated textures stay ordinary git, so they still show diffs. A clone that forgot `git lfs pull` would otherwise show blank materials, so the editor's validation panel now names any file that is still a pointer, and the log does too when the engine tries to load one.

I also cleaned up two old ambientCG texture sets. They moved to the third-party folder with their CC0 records, and only the four maps the engine reads are kept. About 50 MB of GL normals, `.blend`, `.usdc` and preview files are gone. The lighting had to be rebaked, because the bake's freshness check reads the material library's text, and the paths in it had changed. The baked data came out identical.

### A script that fetches carefully

`ingest.py` fetches one Poly Haven model or one ambientCG material, keeps only what the engine uses, and writes a record of where it came from. Downloads are untrusted, so each goes into a fresh folder, only those two hosts are contacted, archives are never unpacked wholesale, no path may escape its folder, and every texture must really be a PNG or JPEG. A dry-run flag shows the files and sizes first. Downloading stays a command a person runs. It is not something an AI agent can do on its own.

A shared glTF checker runs from the Blender exporter, the ingest script and the tests. It catches what the engine would reject or draw wrong, and flags props over 50,000 triangles, since interiors have no level-of-detail meshes.

### The first real props

After I approved about 20 MB of downloads, three Poly Haven props came in (a hall console, a hanging picture frame and an oil lamp) plus a dark dirty carpet. I placed them in the hallway's south leg to look.

The first look found a real problem. The painting in the frame was black, and the lamp's glass chimney was a dark rod.

![The first ingest, with opaque glass](/images/2026-10-09-crash-reports-mesh-collision/first-ingest-opaque-glass.jpg "The frame's glass hides the painting completely, and the lamp's chimney is a dark rod.")

The cause was not my renderer. Blender's glTF exporter turns "transmission" glass into blended glass with an alpha of 1, and under the glTF rules an alpha of 1 is fully opaque. So the engine was drawing it correctly. The checker now reports such materials, and the ingest script gives them a see-through alpha and records the edit in the asset's sidecar.

![After the fix: console, oil lamp, framed painting and runner](/images/2026-10-09-crash-reports-mesh-collision/after-console-frame-lamp-runner.jpg "The painting shows through clear glass. The runner is the Fabric029 carpet over the herringbone floor.")

![Close-up of the lamp and frame](/images/2026-10-09-crash-reports-mesh-collision/glass-fixed-closeup.jpg "Up close, the painting sits behind clear glass and the porcelain lamp has real material detail.")

All four props cost about 0.07 ms of GPU time together (1.28 to 1.35 ms at 1280 by 720, headless). The props are not saved into the demo, which stays a clean baseline; today they are only in the library.

## Where it ended up

Crashes are now readable, hollow props collide hollow, and real CC0 assets can come in with a checked paper trail. Still open: the oil lamp's flame is faint, there is no remote repository yet (it will need an LFS-capable host), and the preview renderer is next, so a prop can be judged on its own before it goes into a scene.
