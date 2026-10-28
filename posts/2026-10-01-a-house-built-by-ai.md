---
title: Building a two-storey house through the editor's MCP tools
date: 2026-10-01
order: 2
summary: I built a two-storey house using only the editor's MCP tools. The gaps it showed led to batch undo, compound fixtures, exact float output and several probe volumes.
tags: ai-tooling, scene, tools
cover: /images/2026-10-01-a-house-built-by-ai/corridor-to-foyer.jpg
---

Until this point every scene I had made was one loop of corridor around a solid block. That proved the renderer could draw a hallway. It did not prove that the editor could build anything larger, and the editor is meant to be a tool that people and AI agents can both use.

So I set a test. I designed a house the way a level designer would: six rooms and a stairwell on the ground floor, four rooms and a landing above. Then I built it using only the editor's MCP tools, the same operations an agent would call. Whenever a tool got in the way, I wrote it down in `Docs/HouseBuild-ToolingReport.md`. The house is the test case, and the report is what I took from it.

> **Background: MCP and my editor.** The Model Context Protocol lets a program expose named operations with typed arguments, which an AI agent can call like functions. My server (`Tools/CCMcp`) exposes editor operations such as `entity_create`, `field_set`, `render_screenshot` and `scene_validate`. When the editor is running, calls travel over a named pipe to the live editor, and every edit lands on its undo stack. With no editor running, the same tools work on a headless copy of the scene with offscreen rendering. Because the tools are the same in both cases, a Python script can drive them, and that is how I built the house.

## The house and two engine changes

The ground floor keeps the original corridor loop: the lamps, the paintings, the far window and the locked bedroom with its scripted scare. The solid block in the middle became a foyer, a parlor, a study, a dining room, a kitchen and a storage room. A straight run of 19 steps climbs the foyer's east side into a double-height stairwell. Upstairs, a gallery landing leads to a master bedroom, a bathroom, a nursery and an attic door that is locked from the far side.

![The corridor looking through a new doorway into the foyer](/images/2026-10-01-a-house-built-by-ai/corridor-to-foyer.jpg "The new opening in the corridor's inner wall: a lamp in the foyer, the storage door at the back and the gallery rail above.")

Two engine changes were needed before the rooms could behave.

**Lights clipped to a box.** In my renderer a lamp lights every surface inside its range unless a shadow map blocks it, and only the four lamps nearest the camera have shadow maps. An upstairs lamp would therefore light the room below through the floor slab. A light can now carry a box (`boundsEnabled`, `boundsMin`, `boundsMax`) and fades out past it. Every lamp in the house, including the 13 corridor lamps, is clipped to its room.

With every box switched off, the leak measured under one grey level, because the shadowed lamps already block their own light and the new lamps have short ranges. I kept the boxes anyway. They are cheap, they keep each object's eight light slots for nearby lamps, and they stop fog from glowing through walls in larger levels.

**A reported light budget.** A scene with more than 63 lights used to lose lights without a message. The renderer now keeps the 63 nearest the camera, warns once and reports how many it dropped.

## What the first build showed

The first version of the build script made 727 tool calls, created 314 entities and took about ten seconds. The editor handled that easily. The problem was on the calling side: an agent in a chat session cannot make 727 round trips. The build worked only because I had written my own client and a geometry script, which defeats the point of tools an agent can pick up directly.

The list I wrote from that run:

- There was no batch operation. Every entity was one call.
- There were no whole fixtures. A wall lamp took seven calls (globe, light, lamp component and so on) and a door four or five.
- There was no spatial query. To trim the grime decals that crossed a new doorway I read the scene file by eye.
- The scene writer lost float precision, described below.
- The rooms read as empty, which became the next day's work.

## Batches: one call, one undo step

> **Background: how an editor undoes things.** Most editors use the command pattern. Each edit pushes a record onto a stack that holds enough information to reverse it, and undo pops the record and applies the reverse. This works for a person clicking, where one gesture is one edit. A script that makes 600 edits would leave 600 entries, and a failure halfway through would leave half a lamp in the scene. A transaction fixes both: it groups edits into one undo entry and, if any edit fails, reverses the ones already made.

`EditorSession::RunBatch` is my transaction. The edits inside it go through the normal path, so each one records its own step. When the batch body finishes, I take those steps back off the history and fold them into one scene-batch step. For each entity the batch touched, that step stores its state before the first change and its state after the last. Three consequences follow from storing net states instead of a list of operations:

- An entity created and deleted inside the batch leaves no trace.
- An entity that ends up unchanged is dropped from the step.
- Undo restores every entity to its earlier state, and redo brings back the same entity ids, so later references stay valid.

If any edit fails, the steps already recorded are reversed in reverse order, nothing is added to the history and the error names the failing operation.

The `entity_batch` tool sends a list of operations in one MCP call. An operation can name what it creates (`"ref": "light"`), and later operations can refer to it as `"$light"`, as an entity, a parent or a field value. That lets a lamp's component point at the light created two operations earlier. A separate `entity_query` tool finds entities by world-space box, component, tag or name, which replaced my manual search for doorway decals.

![The editor after one batch call](/images/2026-10-01-a-house-built-by-ai/editor-batch.jpg "One entity_batch call created a crate and duplicated it five times, each copy offset from the last. The status bar shows it as a single step, 'MCP: six crates'.")

| | Calls | Undo steps | Edit time in the live editor | Resulting scene |
|---|---|---|---|---|
| One call per edit | 727 | 685 | 5.1 s across the passes | |
| One batch per pass | 48 | 7 | 0.56 s across the passes | byte-identical |

The batched build produces a scene byte-identical to the one from single calls, so batching changes how edits are submitted and recorded, not what they produce.

One failure along the way was a bug in my script, not the engine. Folding a patch into an entity's create operation ran it before later entities existed, so a lamp's link to its own light failed. The batch rolled back cleanly and the error named the operation, which is what the transaction is for. The script now folds a patch only into a create it has just queued.

## Compounds: whole fixtures in one call

Even with batches, whoever calls the tools still has to know how a doorway is built. I moved that knowledge into the editor as compounds, so a caller states intent and the editor produces the geometry.

- **Doorway.** The caller gives a point on the floor inside a wall and the side the door opens into. The editor finds the wall and splits it into left, right and header pieces that keep its material and collider. It cuts the baseboard and chair rail on both faces so they stop at the casing, shortens grime bands that crossed the opening, removes stains inside it, and adds the frame and, if requested, a panel or louvered leaf with a lock and a message.
- **Stairs.** The caller gives the foot, the direction and the total height. The editor chooses a riser count and height the player can climb and refuses a flight whose risers would be too tall: five risers of 0.52 m are rejected. It adds colliders, handrails, newels and a baluster on every tread.
- **Wall lamp and window.** The globe, the light and the lamp component, or the window frame with glowing glass and optional moonlight.
- **Light boxes fitted to the room.** The editor casts rays from the light toward the nearest wall, floor and ceiling and sizes the clipping box from the hits. Stair steps, door headers and furniture do not count as walls. Door leaves do, because doors start closed.

The light fitting had a flaw that the house showed at once. Two corridor lamps sat exactly in line with the new dining room and kitchen doors. A single ray per direction passed through the open doorway, so their boxes swallowed the rooms behind them. Each direction now casts nine parallel rays 0.6 m apart and takes the nearest wall. A test fails without that change.

A full rebuild is now 28 calls in 5.5 seconds. The hand-written list of decals to trim disappeared, because the doorways trim their own. Doorways in upstairs walls also keep a slab-level piece under the door, so the scene grew to 592 entities.

![A doorway cut into the corridor wall by one compound](/images/2026-10-01-a-house-built-by-ai/corridor-doorway.jpg "The foyer doorway cut into the corridor's inner wall by one doorway compound. The baseboard and chair rail stop at the casing, and the grime band ends at the opening.")

## Writing floats exactly

> **Background: how many digits a float holds.** A 32-bit float has a 24-bit significand, which is about 7.2 significant decimal digits. Near 1.0 neighbouring floats are about 1.2e-7 apart, so a decimal string printed with six places can land between two floats and name a different one. The reverse also holds: many decimal strings name the same float. The shortest decimal that reads back as exactly the same float is well defined, and `std::to_chars` produces it.

My scene writer printed every number with six fixed decimals. That looks tidy but discards bits. The editor fitted a light box at `-0.9949999`, the writer saved it as `-0.995000`, and that is a different float. My lighting bakes are stamped with a fingerprint, a hash of the scene values the bake depends on. The editor hashed the floats in memory, the game hashed the floats it read back from the file, and the two never matched, so the game reported the editor's fresh bake as stale. The house script worked around it by saving, reloading and only then baking.

I replaced the number output with the shortest exact form. It is one stream facet in `EntitySceneSerialization.cpp`, so every float the writer emits is covered, including ones I add later.

```text
before: "boundsMin": [-8.570001, -0.995000, -8.570001],   "position": [0.000000, 0.000000, 0.000000]
after:  "boundsMin": [-8.570001, -0.9949999, -8.570001],  "position": [0, 0, 0]
```

Round values became shorter and computed values kept the digits they need, so the house file shrank from 640 KB to 577 KB. Files saved by older builds still load, and saving them again changes only how the numbers look.

The test checks 200,000 floats sampled across the whole range, negatives and subnormals included. Each is written in the shortest form, read back through the engine's JSON parser as a double and narrowed, and compared bit for bit. It also checks awkward values such as `0.1 + 0.2`, the largest float and fitted light bounds, and it confirms the real house keeps its bake keys through a save and load. The old writer fails the exactness checks and the new one passes. The house script no longer reloads before baking.

## Walking the house: stairs, thresholds and the view

Walking through the finished house turned up three more problems. I fixed each in the tool that caused it, not by hand in the scene.

**Stairs away from the wall.** The stairs compound built the flight at the width it was given. In the foyer that left a 26 cm strip of floor between the step ends and the wall, and the wall's chair rail ran straight into the steps. A side of the flight with no rail now looks for a wall within 45 cm. If it finds one, the steps run to the wall's face, a painted skirt board climbs the wall along the nosings, the wall's baseboard and chair rail stop where the skirt reaches them, and decals the flight would cover are removed.

![The flight meeting its wall under a skirt board](/images/2026-10-01-a-house-built-by-ai/stairs-wall-after.jpg "After the change: the steps meet the wall under a painted skirt board that climbs with them.")

**A black slot under the doors.** A doorway cut the wall away down to its base, and the rooms' floors stop at the wall faces. Each opening on the ground floor therefore showed an 8 cm black slot, the depth of the wall. The doorway now keeps the wall below floor level and lays a dark wooden threshold board across the opening, lapping onto both floors.

![A black slot across a doorway](/images/2026-10-01-a-house-built-by-ai/threshold-before.jpg "Before: an 8 cm slot where the wall was cut away.")

![A threshold board across the doorway](/images/2026-10-01-a-house-built-by-ai/threshold-after.jpg "After: the threshold board laps onto both floors.")

**The view shook on the stairs.** The camera followed the feet with an exponential catch-up. That rule moves the view by a fixed fraction of its remaining error each frame, so when the target jumps, the view's vertical speed jumps from zero to its maximum in a single frame. Each riser lifts the feet 19 cm at once, and at walking pace a new riser arrives every 0.16 s, so the eye jumped and settled about six times a second.

A critically damped spring removes the discontinuity. Its acceleration is `-w^2 * offset - 2 * w * velocity`, where `offset` is how far the view is from the feet and `w` is the natural frequency. The damping is exactly enough to return to the target as fast as possible without overshooting. Because velocity is part of the state, it can only change gradually, so a step in the target produces a smooth glide. I integrate it once per frame in `PlayerController.cpp` with `eyeFollowRate` as `w`, which is 8 per second in the current source. If the view ever lags the feet by more than a set distance, it is clamped, which handles falls.

I measured it in a new test over the middle of the flight:

| | Up the stairs | Down the stairs |
|---|---|---|
| Ripple around the eye's own 0.33 s average | 1.5 cm to 0.3 cm | 1.9 cm to 0.7 cm (mostly head bob) |
| Largest frame-to-frame change in vertical speed | 0.56 to 0.04 m/s | 0.34 to 0.09 m/s |

The test fails with the old smoothing.

## Probe volumes

> **Background: irradiance probes.** A probe is a point in the scene that stores the light arriving there from every direction. Mine store it as a small octahedral map, together with the distance to the nearest surface in each direction, which the shader uses to stop light from leaking through walls. A surface samples the eight probes around it and blends them. The spacing of the grid sets how fine the lighting can be, and a probe that sits inside solid geometry stores light that does not belong to the room beside it.

The house's bounce light came from one probe grid stretched over both storeys at 0.6 m spacing. Some probes sat inside the slab between the floors, and the stairwell got the same coarse spacing as everything else.

A scene can now hold up to 8 probe volumes, each baked on its own grid into the same file. On the GPU their atlases are stacked, the frame constants list the volumes smallest first, and the shaders loop over them as they already do for reflection probes. Where volumes overlap, the smallest box wins and fades out one spacing past its edge, and at most two are sampled at any point. The house has three: the ground floor, the upper floor above the slab, and a 0.45 m grid over the stairwell that joins them. That is 10,299 probes instead of 12,288, none of them straddling the slab. A scene with one volume keeps its old bake key, so the hallway's committed bake stayed valid. The reflection-probe limit went from 16 to 64, and the house uses 17.

## Results and open issues

The house builds in under ten seconds through the editor's tools, every edit is undoable, and `scene_validate` reports 0 errors. All 74 tests pass. In the hallway, no pixel moves by more than 6/255 and GPU time is within noise. The house costs 3 to 4 percent more GPU time than before the stairs and probe changes, 0.04 to 0.06 ms, with every pose at 1.2 to 1.6 ms.

Open items from the report:

- Prefabs, meaning reusable entity sets authored in the editor, would extend the four built-in compounds. The Create menu does not offer the compounds yet; they exist only over MCP and in the session.
- Probe volumes blend only by box size. A volume per room with blending stopped by walls would need portals.
- The skirt board is a plain painted box and should be an authored moulding like the baseboards.
- The rooms are still empty of furniture. That is the next post.
