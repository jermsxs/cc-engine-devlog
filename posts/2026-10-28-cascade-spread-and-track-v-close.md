---
title: Spreading shadow cascade redraws over frames, and closing the visibility track
date: 2026-10-28
order: 2
summary: A moved sun cascade is redrawn in slices over up to six frames, the rain maps stop landing together, and Track V closes with one optimisation dropped after measuring.
tags: performance, shadows, renderer
cover: /images/2026-10-28-cascade-spread-and-track-v-close/day-path_start-before-after.jpg
---

After the shadow-run fix, walking the day woods still showed a frame with 2 to 2.5 ms of shadow work every second or so, and each lightning flash at night had one or two. Each of those frames was one sun cascade moving and being redrawn in full. The plan for the day was to stop a cascade's redraw from landing on a single frame, then tidy what that work left open, and then close Track V with a before and after measurement of the whole track.

## Sun cascades and what makes them move

### Background: cascaded shadow maps

A sun lights the whole level, and one shadow map cannot cover a level and still give sharp shadows near the camera. A shadow map has a fixed number of texels, and if it spans 60 m, each texel is several centimetres wide, which is too coarse for the shadow of a branch a few metres away.

Cascaded shadow maps divide the camera's view into slices by distance and give each slice its own orthographic map along the light's direction. The near slice is small, so its texels are fine. The far slice is large and its texels are coarse, which is acceptable because the eye cannot see detail far away. A pixel looks up the first cascade that contains it. Three rules decide the quality:

- **The split.** Where the slices begin and end. A linear split makes even slices and wastes resolution far away. A logarithmic split gives each slice about the same number of texels per metre of view, over an ever larger range. The usual compromise is a mix of the two, and mine is 0.75 logarithmic.
- **The fit.** Each cascade's map is fitted to a bounding sphere around its slice, so turning the camera does not change the size of the texels, which would make the shadow edges shimmer.
- **The snap.** A cascade's map origin moves only in whole-texel steps, so the shadow edges do not crawl as the camera walks.

The engine allows up to four cascades, each on a 2048 by 2048 tile of the shadow atlas. A cascade's origin moves in steps of one sixteenth of its tile. Between moves its cached shadow map is reused, and it costs nothing.

That caching is what makes the redraws arrive in lumps. A cascade that has not moved costs nothing. When it moves, its whole map is drawn again: every caster in a slice that can hold thousands of plants. In the day woods one such move was about 13 million triangles, which took 2.4 ms after the previous day's fix.

### Background: spreading shadow updates over frames

Shadow work is often reduced by updating the maps less often than the frame rate. This is called amortising the cost: instead of paying a large amount in one frame, an engine pays a small amount in many.

The two common tools are:

- **Update rates per cascade.** The near cascade is redrawn every frame or whenever the camera moves, because small camera moves are visible in its fine texels. A far cascade can be redrawn every few frames, or only when the camera has moved far enough, because its texels are coarse and its shadows are soft, so a slightly old map shows no difference.
- **Staggering.** Two cascades that are due at the same frame are redrawn on different frames, so their costs never add up.

Both tools reduce the average cost of shadows. Neither helps with the worst frame if a single cascade's redraw is itself large, which was my case. The cost of one move was 2.4 ms, and no schedule between cascades could make that cost smaller. A third tool is needed to cut the redraw of a single map into pieces.

My engine has no fixed update rate for each cascade. A cascade moves only when the camera has gone a step, and a step is a fixed fraction of the tile, so a far cascade, whose tile covers more metres, moves less often than a near one. That gives each cascade a different effective rate without a table of rates. The earlier rule already staggered the moves: at most one cascade moves in a frame. What V7 adds is a way to split the move itself.

## V7: a move drawn over several frames

### Drawing nearest the light first

I started with a change that makes every redraw cheaper without changing its result. A face draws its casters in runs, and the runs were drawn in scene order.

The trees' leaf cards are alpha-tested, so they cannot write depth before their pixel shader runs: the shader has to read the texture to decide whether the pixel is a hole. They are still tested against depth that is already in the map. If a canopy is drawn first, its depth hides every leaf layer below it, and those layers fail the depth test and are never shaded. If the lower layers are drawn first, they are shaded and then covered.

Runs are now sorted by their nearest point to the light. The image is the same, with fewer shaded pixels. A near cascade went from 1.46 to 0.95 ms and the next from 2.32 to 1.59 ms.

### The slices

When a cascade has to move, it keeps its old face and the old map stays valid. The new face is drawn in slices into a separate 2048 by 2048 staging map, one slice per frame. On the last slice, a full-screen depth copy (`ShadowCopy.hlsl`) moves the staging map into the atlas tile, and the cascade takes its new face.

![One cascade move before and after, as shadow time per frame](/images/2026-10-28-cascade-spread-and-track-v-close/cascade-spread.svg "A move redrawn in one frame, about 2.4 ms, against the same move drawn in slices of about 0.4 ms over up to six frames.")

The rules, from the source:

- **Slices are balanced by estimated cost.** A run's cost is its triangles, plus for alpha-tested runs a share of the texels it covers, because a masked draw is paid per texel as well. One slice is planned at about 3 million triangles, which is about 0.4 ms on my RTX 4070.
- **At most 6 slices**, so a move takes at most 6 frames, which is 0.06 s at 100 frames a second.
- **While a move is in progress, no other cascade moves.**
- **A camera cut moves cascades at once.** If the camera moves more than 1.5 m in a frame, which a teleport, a bench pose or a capture does, the cascades move whole for 8 frames, as before. The same applies to a cascade on a new tile, which has no old map to keep.
- `--no-cascade-spread` turns the spreading off, so I can compare.

The staging map is a texture of its own because the atlas is full at night. It takes 16 MB of VRAM.

The old map is used for up to six frames longer than before. The cascades' shadows are soft and coarse, and the move is one step of a sixteenth of the tile, so a map that is a few frames old shows no difference.

### Lightning drawn ahead

At night the sun has no cascades between flashes, because the moon casts nothing. When lightning begins, four cascades appear at once and have to be drawn whole.

The engine knows about a second ahead when the next flash will come. In that second the dark sun is treated as the sun: its cascades follow the camera and are spread in like the day's. The flash then finds them in place.

The final check found a bug. The test for a camera cut only ran while the sun had cascades. At night it has none between flashes, so each prewarm saw the whole walk since the last flash as one large jump. It then drew all four cascades whole, one a frame, at 1.3 to 2.3 ms each. The check now runs every frame.

### Results

A new test, `CascadeSlicesCoverEveryRunOnce`, checks that a move's slices draw every run exactly once and that the last frame draws what is left. `ctest` passes 117 of 117.

Walks at 1440p, uncapped, 1,880 frames each, on the RTX 4070:

| Walk | Mean | 99th percentile | Worst | Spikes | Shadow GPU p99 / max |
|---|---|---|---|---|---|
| day, before | 9.78 ms | 11.91 ms | 12.90 ms | 0 | 2.38 / 3.34 ms |
| day, after | 9.78 ms | 10.76 ms | 13.06 ms* | 1* | 0.41 / 0.49 ms |
| night, before | 10.09 ms | 12.02 ms | 16.61 ms* | 1* | 0.44 / 2.33 ms |
| night, after | 10.10 ms | 12.11 ms | 12.70 ms | 0 | 0.74 / 0.90 ms |

The rows marked with an asterisk are Present stalls where the GPU's own time stayed normal at 9.4 ms. They have the same outside cause as before, which is that the GPU sits at its power cap. An earlier run of the same build had a day worst of 11.62 ms and no spikes.

The shadow pass at its worst went from 3.34 to 0.49 ms in the day woods and from 2.33 to 0.90 ms at night, and the mean frame time did not change. That is the intended result: the total work is the same and the lumps are gone.

![Frame time and shadow GPU time over the day and night walks, before and after V7](/images/2026-10-28-cascade-spread-and-track-v-close/walk-before-after.jpg "Left: frame time over frames 200 to 2000. Right: the shadow pass's GPU time. Orange is before V7, blue after. The shadow spikes of 2 to 3 ms in the day walk and at the two flashes at night are gone.")

The images are unchanged to within noise. Night bench poses against the build before differ in 0 to 3 pixels. Day bench poses with spreading on and off differ in 0 to 1 pixels. A walk with it on and off, compared at a settled frame, differs in 0 pixels. The hallway and the house are identical with the new draw order, and the kitchen's differences equal its run-to-run noise. The steady night shadow pass costs about 0.03 ms more.

## V7 follow-ups

### Rain maps that moved together

The V7 work left two problems open. The first was a frame that came about every 200 to 400 frames at night, in which three shadow faces redrew together: the flashlight's, which redraws every frame because it moves with my hand, the rain's shelter map and the canopy map. Together they took 0.80 to 0.90 ms of shadows. The shelter map and the canopy map both follow the player and snap to the same 6.4 m grid, so they always moved on the same frame.

This is the staggering tool from the background section. The canopy map, which records where leaves hang over a drop for drips, now has its own view in the rain constants. When the shelter map moves, the canopy keeps its old view for one frame and moves on the next. A one-frame lag of a single step over a 51.2 m map changes nothing visible.

The canopy map's own redraw was the expensive one, at about 0.35 ms, so its tile is now 512 by 512, which is 10 cm texels, and no longer 1024 by 1024. Its leaves are thinned to 1% and the kept ones are grown about 10 times, to about 1.2 m, so 10 cm texels still see the same cover.

In the night walk, with five moves in each walk, the frames where these maps move:

| | Shelter frame | Canopy frame |
|---|---|---|
| before (one frame for both) | 0.80 to 0.90 ms | |
| staggered, canopy 1024 | 0.49 to 0.54 ms | 0.71 to 0.80 ms |
| staggered, canopy 512 | 0.49 to 0.51 ms | 0.61 to 0.67 ms |

### Leaves baked once

The second problem was stale probes. Since the tiny twin changed the leaf meshes, both woods scenes logged the irradiance and reflection probes as stale, so I rebaked them. A bake takes about 6 minutes for each scene.

The rebake exposed a bug in the light baker. It traced every submesh of a plant, so each leaf went in up to three times: the full leaf, its far twin and its tiny twin, which is widened to keep the leaf's area. The game only draws one of them at a time. The baker now skips the twins, and the woods bake traces 100 million triangles instead of 146 million. A new test, `LeafTwinsAreNotBaked`, covers it.

The look changed, and I measured it. The new day bake is darker at the path start, with a mean brightness of 70 against 77, with less glow in the distant haze and deeper shade under the trees. At the bank it is a little brighter, 19.9 against 17.7. The night is unchanged, at 17.6. The twins explain little of it, with 69.6 when they are baked and 70.0 when they are not. The rest comes from the leaf meshes having changed since the last bake.

![The day woods at the path start under three bakes](/images/2026-10-28-cascade-spread-and-track-v-close/day-bake-old-twins-fixed.jpg "Left: the old bake. Middle: the rebake with the twins in it. Right: the rebake with the twins skipped. The old bake has more glow in the distant haze.")

I had tuned the day woods' haze with the old bake. If I decide I prefer the old brightness, I can lift the fog's ambient or the exposure to match, and I have not done that yet.

I thought the frames looked worse after the rebake, so I rechecked in the evening with the machine quiet. Earlier in the day Chrome, Edge, Discord and Steam had all been running, and the walks showed 13 to 23 ms frames where Present and CPU record time jumped while the GPU's own time stayed at 9 to 12 ms. The values are CPU frame times in ms:

| Walk or bench | V7 master | Old bake, this branch | New bake, this branch |
|---|---|---|---|
| day walk, mean / p99 / worst / spikes | 9.78 / 10.76 / 13.06 / 1 | 9.79 / 10.75 / 11.45 / 0 | 9.78 / 10.72 / 11.03 / 0 |
| night walk, mean / p99 / worst / spikes | 10.10 / 12.11 / 12.70 / 0 | 10.11 / 12.12 / 13.14 / 0 | 10.12 / 12.19 / 13.35 / 0 |
| day bench, path start GPU | 9.43 | 9.41 | 9.46 |

The bake changes the light and not the cost. With TAA off, every day bench pose is within 0.3% of the V7 bench. The day benches in the V7 entry ran with TAA off, which is 0.25 ms lower than with it on, so that difference is not a regression. The game loads both bakes as current, with no stale warnings.

## Closing Track V

### Background: why measure before building an optimisation

An optimisation has a ceiling, which is the time the thing it removes takes today, and a price, which is the time the machinery that does the removal takes. It is worth building only if the ceiling is clearly above the price, and both can be estimated before the work is done by building the first piece and measuring it.

V5 was occlusion culling for the depth prepass. The general technique is as follows. Draw the large occluders first and build a depth image from them, usually reduced to a pyramid of conservative depths. For each object, test its bounding box against the pyramid. Objects that lie behind an occluder are not drawn. The test can run on the GPU, and the surviving objects are written into an indirect draw buffer, which is how the visible-triangle compaction from the day before already draws.

The method has a structural requirement. The culling needs the occluders' depth before it can decide, so the prepass has to be split: all opaque geometry first, the alpha-tested leaves after. That split is itself a cost, and each leaf draw that is culled becomes an indirect draw command, which has a cost per command.

### What I measured

I built the first piece, the split prepass, and ran the night woods bench. Drawing every opaque submesh before the alpha-tested ones already cost 0.10 to 0.24 ms per pose. The GPU mean went from 9.07 and 9.14 ms to 9.25 and 9.25 ms, two runs each. Each culled leaf draw would also become an indirect draw at about 4 µs each, for some 180 draws. Earlier I had measured the ceiling: perfect culling would save 0.1 to 0.9 ms of the night woods' prepass, and about 0.3 ms typically.

The price was above the ceiling before any culling had been built. I reverted the split and dropped V5. V6, ranked clusters of leaves, needs one indirect draw per cluster, which has the same per-command overhead, so I removed it from the plan too. Because I chose V7 over V5 on the same ceiling measurement, the order of the track followed from the numbers.

### V8: the track's before and after

To measure the whole track I built the master from before Track V (`7d790ff`) in a separate worktree and benched both builds on every scene, one after the other.

| Scene (GPU mean, ms) | Before Track V | Now |
|---|---|---|
| Day woods (7 poses) | 9.43 (slowest 10.78) | 8.90 (slowest 9.79) |
| Night woods (11 poses) | 9.61 (slowest 11.71) | 9.31 (slowest 10.89) |
| Hallway (TAA off) | 3.73 | 3.67, image-identical |
| House (TAA off, three runs each, alternated) | 3.64, 3.43, 3.44 | 3.46, 3.45, 3.45, image-identical |
| Kitchen (TAA off) | 3.06 | 3.06, image-identical |

The walks with `Check-FrameSpikes.ps1` have no spikes: the day walk's mean is 9.83 ms, 99th percentile 10.86 and worst 11.78, and the night walk's is 10.15, 12.17 and 13.04. `ctest` passes 117 of 117.

![The day woods at the path start before Track V and now](/images/2026-10-28-cascade-spread-and-track-v-close/day-path_start-before-after.jpg "Left: before Track V. Right: now. The light differs because of the rebake and the new leaf meshes.")

![The night woods, into the bank, before Track V and now](/images/2026-10-28-cascade-spread-and-track-v-close/night-into_the_bank-before-after.jpg "Left: before Track V. Right: now.")

### A bug the benches found

The house was 9% to 16% slower at seven poses, with identical images. The compaction from the first day of the track picked every draw above 16,384 triangles, not only foliage, so a few heavy house props went through `ExecuteIndirect`. That cost the lit pass 0.18 ms.

Compaction now picks only plants, which I define as meshes with a cut-out submesh. Their trunks and twigs still count, because they hide inside the leaves, and compacting the leaves alone lost 0.14 ms in the woods. I compared three rules in one build, alternated twice:

| Rule | Day woods mean | House mean |
|---|---|---|
| every draw | 8.79, 8.87 | 3.65, 3.64 |
| cut-out submeshes only | 8.95, 8.94 | 3.46, 3.57 |
| plants | 8.81, 8.80 | 3.67, 3.45 |

With the plants rule the house compacts nothing, so its spread is run-to-run noise, which shows on both builds.

## Open issues

- The flashlight's shadow face redraws every frame, at about 0.4 ms at night. It is the largest steady cost left from this track's measurements. Drawing only what is near the beam, or caching the far part, could halve it.
- The day woods' haze and exposure need to be compared against reference 2 again with the new bake, in case I want the old brightness back.
- At the end of the day the branches `fix/v7-followups` and `render/track-v-close` are not merged into master, and nothing is pushed.
