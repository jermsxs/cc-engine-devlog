---
title: A Path tool, and a woods path that the bushes keep you on
date: 2026-11-01
order: 1
summary: I add a spline Path tool to the editor that builds walls and scatters plants along a path, then close its start with forest and keep the plants out of the camera's face.
tags: outdoors, foliage, editor
cover: /images/2026-11-01-a-walled-woods-path/first-bend-after.jpg
---

I added two more references of a forest path to the folder I compare against. In both, the player is held on a directed path where the puddles are, and the bushes on each side are too dense to walk into. In my woods the ground was open, and the player could wander anywhere between the trees. I wanted my path to do what the references do. When I considered how to build it, I chose a Path tool in the editor over placing plants by hand, because with a tool I can move a point and have the walls and the plants follow. This entry follows that tool through three changes made over the day: the tool and the first walled path, a closed start with a forest behind it, and a placement rule that keeps bushes out of the camera.

## How a path tool places a wall of plants

> **Background: splines and scattering.** A path in a level is described by a few control points and a curve through them. The common choice is a Catmull-Rom spline, which passes through every control point and takes its tangent at a point from its two neighbours. In its standard uniform form, for four consecutive points `P0..P3` and a parameter `t` from 0 to 1, the position between `P1` and `P2` is
>
> `0.5 * ( 2*P1 + (P2 - P0)*t + (2*P0 - 5*P1 + 4*P2 - P3)*t^2 + (3*P1 - P0 - 3*P2 + P3)*t^3 )`
>
> Sampling the curve at small steps gives a centre line. At each sample the tangent gives the direction of travel, and the perpendicular to it in the ground plane gives the direction across the path. Everything else is an offset along that perpendicular: the edge of the path at plus and minus half its width, a wall just outside it, a band beside it in which to place plants.
>
> Placing plants in a band is a sampling problem. Each layer has a density in copies per square metre, a minimum spacing, a range of scale and a random seed. The number of copies is the band's area times the density. To avoid clustering near the centre line, positions are drawn uniformly by area, not by distance. Each copy is stood on the ground by a ray cast, sunk a little if needed, and given a random rotation and scale. Because the seed is stored, a rebuild gives the same result, and a change to the curve moves the copies without reshuffling them.

### My implementation

In my engine a path is an entity with point entities as its children. The centre line is a Catmull-Rom curve through the points. A point's X scale widens the path there, so a clearing is made by scaling a point. The scene has two components for it, `path` and `pathScatter`.

**Rebuild Paths**, in the Edit menu, does three things.

- It puts invisible box walls along both edges of the curve.
- It copies template entities, which can be any entity found by name, into each `pathScatter` layer's band beside or on the path. A layer sets density, spacing, scale, sink and seed.
- It stands each copy on the ground colliders.

Everything it generates replaces the previous result as a single undo step. A scene of this size has thousands of generated entities, so I added `EditorSession::ReplaceEntities` and `EntityScene::DestroyEntities`, which swap about 2,400 entities in one compaction pass rather than 2,400. The path also knows when it is out of date. Moving a point, or editing a template, turns the path's line red in the viewport, and validation then says "run Rebuild Paths". The MCP server has a matching `path_rebuild` tool, so an agent can use the same operation.

The woods' path has 19 points on the old layout's control points and is 208 m long. Its layers are:

- edge plants (nettle, weed, fern, grass, small shrub);
- bush walls, with three bushes and two large shrubs, 0.4 to 3.2 m from the edge;
- saplings;
- a few trees close in;
- puddle decals on the path.

For the look, rain wetness of 0.6 fills the painted ruts. Screen-space reflections are on below roughness 0.12, which gives the water a reflection, and exposure is -0.75 EV.

![The first bend before the Path tool](/images/2026-11-01-a-walled-woods-path/first-bend-before.jpg "The first bend before: open woods, with the ground visible in every direction.")

![The first bend after the Path tool](/images/2026-11-01-a-walled-woods-path/first-bend-after.jpg "The same pose after: bushes and plants wall the path in on both sides.")

### Checking it

I compared the first poses with reference 4 using `look_compare`. At the pose I set from that reference, mean luma was 0.20 against 0.18 and saturation 0.33 against 0.35. By thirds of the frame the top was 0.15 against 0.19, the middle 0.22 against 0.17 and the bottom 0.24 against 0.16. The bush walls read like the reference. My ground is too bright, and the wet patches mirror a grey sky where the reference's dark pools mirror trees.

Reference 5 is a harder case. At the long stretch my mean was 0.10 against 0.26, and my top third was 0.10 against 0.35. The reference has open sky over the path and sunlit golden leaves close by. Mine was a dark tunnel under the old woods' canopy. Removing the path's tree layer or the two nearest old trees changed the mean by less than 0.01, because the canopy is many trees deep, so I did not fix it that day.

In tests, `PathToolTests` covers the curve, the bands and ground height, walls that stop a ray 1.75 m from the middle, a path going stale after a move, a rebuild that replaces rather than adds, undo and redo, and save and load. `EditorSessionTests` was updated for 21 components.

I also checked the walls in the game, with scripted walks that use `--spawn` and `--walk-frames`. The game now logs the player's eye position when an automated run exits, so these walks can assert on collision. Walking straight at the bushes from the middle, on both sides and at two places, the player stopped 1.48 to 1.60 m from the centre line. From the kitchen side the player walked 11.8 m onto the path, and at the far end the gate stopped them at z 125.7.

The cost was real. The editor's Cost Check showed +13% to +26% per view, mostly in the depth prepass (+0.5 to +1.0 ms), and it warned. Thinning the hidden bush rows and edge plants won back 0.1 to 0.2 ms. In the 1440p bench on an RTX 4070, against the commit before, GPU time rose 0.5 to 1.7 ms per pose, +5% to +16%. The prepass at the path start went from 3.97 to 5.3 ms, with SSR +0.16 ms and ambient occlusion +0.12 ms. Path start went from 10.31 to 11.57 ms, first bend from 8.99 to 10.47 and long stretch from 10.33 to 12.01. A 60 m cull distance on the bush copies won back up to 0.4 ms. The frame-spike walk reported a worst frame of 14.71 ms against a limit of 15, with no spikes. That walk had started from the pose in `bench.json`, which was now inside the bushes, so it uses `woods_bench.json` instead.

## Closing the path's start with forest

I turned around at the start of the path. Behind me it simply stopped. The ground was open, and past it stood the outer bank's row of curved trunks on a bare, sunlit slope. That did not match the woods the path runs through. Reference 5 shows what the back should be: a dark mass of bushes and trunks, with sun on a few near leaves.

![Looking back from the start, before](/images/2026-11-01-a-walled-woods-path/back-before.jpg "Before: the path ends in open ground, and the bank's curved trunks stand on a bare slope.")

![Looking back from the start, after](/images/2026-11-01-a-walled-woods-path/back-after.jpg "After: a backdrop of bushes, saplings and trunks fills the view behind the start.")

> **Background: closing a dead end.** A walled path has two ends, and the ends are where a level most often shows its seams. If the walls stop at the end of the path, the player sees the open space beyond. The solution is the same one used for the outer edge of a level. Close the end with collision, so the player cannot leave, and put dense geometry behind it, deep enough that no gap lets the eye through. The geometry needs depth in the third dimension and not only a front row, because a single row of bushes shows what is behind it wherever the leaves are thin. A deep backdrop costs more the deeper it goes, so its density and its scale are the two things to tune.

### Closed ends in the tool

I added `path.closeStart` and `closeEnd`. Rebuild Paths then puts a half circle of wall boxes around that end, joining the two side walls. Every scatter layer's band also wraps around the end as a half ring, filled as densely as the sides, uniformly by area. A second field, `pathScatter.endsOnly`, makes a layer fill only those half rings. A deep backdrop where the path stops then costs nothing along the other 208 m. If a layer is set to ends only on a path with no closed end, the rebuild summary says so.

`woods_path` has `closeStart` on, and two ends-only layers.

- `woods_path_backdrop`: bushes and saplings, 2.8 to 22 m from the edge, 0.3 per square metre, scale 1.3 to 2.2.
- `woods_path_backdrop_trees`: trees, 3 to 24 m, 0.1 per square metre.

The first version was not enough. The closed end hid the ground, but the bank still showed over and through the bushes. I made the backdrop deeper, from 14 to 22 m, and then thinned it to half the copies at a larger scale. That looks the same and costs 1 ms less.

`PathToolTests` gained a `ClosedEnd` case for the extra walls and the copies behind the start. A ray back from the path meets the wall about 1.75 m past the start. It also covers save and load, and an ends-only layer putting every copy behind the start. In the game, walking back, back-left and back-right from the spawn stops the player 1.5 m past the start point. Forward is open.

I rebaked the lighting after each change. The light check from the previous day flagged the spots behind the start at -66%, then -53%, then -12% as the backdrop changed. That is where growth is meant to darken things. The woods volume as a whole stayed within 1% on the last bake.

### The editor's flashlight had been in my comparisons

While tuning exposure I noticed that the game's frame was much darker than the editor's at the same pose: 0.113 against 0.204 at reference 4's pose. The editor meters the scene 0.9 EV brighter, with EV100 at -5.36 against -6.25, because its preview flashlight is on by default and the game starts with it off. Every editor comparison against reference 4 up to then had been made with the flashlight on. With the flashlight off, the editor reads 0.108, the same as the game.

I made two changes. `look_compare` now returns `previewFlashlight` and leads its summary with a warning when the flashlight is on. And I retuned exposure without it, with `exposure.compensationEv` going from 1.1 to 1.8.

Luma against the references with the flashlight off, mine against the reference:

| View | Mean | Median | Thirds (top, middle, bottom) |
|---|---|---|---|
| Reference 4 pose | 0.185 against 0.176 | 0.147 against 0.157 | 0.19, 0.18, 0.18 against 0.19, 0.17, 0.16 |
| Looking back (reference 5) | 0.184 against 0.259 | 0.146 against 0.189 | 0.12, 0.20, 0.23 against 0.35, 0.20, 0.22 |

Looking back, the middle and bottom match. The top lacks reference 5's sky over the trees, and my saturation is 0.31 against 0.36. The game's own frames read 0.18 at reference 4's pose and 0.19 looking back.

The new bench pose, `start_back`, went from 6.75 to 9.23 ms of GPU time, because it had been open ground. The woods' other poses are 8.7 to 12 ms. The denser first version of the backdrop cost 10.28 ms. The other eleven poses moved by 0 to 1.5%. The frame-spike walk's worst frame was 14.0 ms with no spikes, and Release `ctest` passed 120 of 120.

## Keeping bushes out of the camera, and light in the shade

I walked the path and had two complaints. It was too dark. I like that the trees block the sun, but I wanted some light still reaching the path. And the long bushes poked out into the path, large bushes in my face.

### Placing by the trunk or by the crown

> **Background: where a plant is, and how far it reaches.** A scattered plant has an origin, usually its base, and a crown that spreads around the origin. If the placement rule measures the distance from the path to the origin, a plant at 0.4 m with a 1.5 m crown overhangs the path by about a metre. Scaling it up by 1.5 makes it worse, because the crown grows and the origin stays where it was. The correct rule measures to the edge of the crown. The crown's reach is the template mesh's widest horizontal extent from its origin, multiplied by the template's own scale and the copy's random scale.

![A plant placed by its trunk and by its crown edge](/images/2026-11-01-a-walled-woods-path/crown-band.svg "Seen from above. Left: a plant placed by its trunk, with its crown overhanging the path. Right: a plant placed by its crown edge, which stops at the near-offset line.")

My layers measured by trunk. A bush 0.4 m from the edge with a 1.5 m crown, scaled to 1.5, leaned up to 1.8 m over a 2.5 m path. I added `pathScatter.clearCrowns`. With it, a layer's band is measured from each copy's crown edge, so no leaf comes nearer the path than `nearOffset`. Rebuild Paths and the MCP `path_rebuild` take the mesh sizes from the renderer. Where no meshes are loaded, as in a headless run, the layer reports "crown sizes unknown" and places by trunk, rather than silently using a guess.

`PathToolTests` gained a `ClearCrowns` case. It checks the schema field and the stale hash, the "unknown" problem, every crown edge inside the band using a fake mesh-size lookup, and save and load.

In the woods:

- bushes use clear crowns, a band of 0.2 to 2.6 m and scale up to 1.35;
- saplings use clear crowns, 0.5 to 5 m;
- edge plants use clear crowns, -0.1 to 1 m, so grass may lean 10 cm onto the path edge;
- trees are left alone, because their canopy over the path is what blocks the sun, and I like that.

### Light under a canopy

> **Background: exposure under a canopy.** Under a closed canopy most of the sun is blocked, and the light that reaches the ground is sky light through gaps and light scattered between leaves. The scene's luminance is a few stops lower than in an open clearing. A camera, and the eye, compensates by exposing for the scene it sees. An automatic exposure system meters the frame's average luminance, converts it to an exposure value (EV100), and moves the camera's exposure toward the metered value. Moving it all the way makes every frame the same average brightness, which removes the difference between a sunlit clearing and a dark stretch. Real cameras and games both stop short of that. The target is a fraction of the way from a fixed anchor to the metered value:
>
> `target EV100 = anchor + adaptation * (metered EV100 - anchor)`
>
> With adaptation at 1 every view is metered to mid grey. With adaptation near 0 the exposure stays at the anchor. The choice sets how dark the shade is allowed to read next to the sun.

The shade was dark because auto exposure barely adapted. An adaptation of 0.2 held every view near the anchor, so the sunlit start and the shaded stretches got almost the same exposure. I changed three settings.

- Adaptation went from 0.2 to 0.65, so shade gets more exposure and sun gets less.
- Local shadows went from 0.6 to 1.0.
- Exposure compensation went from 1.8 to 0.2, which brings the sunlit poses back near reference 4.

I measured all of it in the game with no flashlight. Mean luma, before and after:

| Pose | Before | After |
|---|---|---|
| Reference 4 pose (reference 0.176) | 0.180 | 0.209 |
| Looking back (reference 0.259) | 0.190 | 0.194 |
| Long stretch | 0.079 | 0.148 |
| Fallen tree | 0.092 | 0.152 |
| Last stretch | 0.113 | 0.175 |

The shade nearly doubled, and the sunlit views moved only about 0.03. The reference 4 pose is now 0.03 above the reference.

![The long stretch before](/images/2026-11-01-a-walled-woods-path/long-stretch-before.jpg "The long stretch before: the shaded path reads almost black, and bushes lean over its edges.")

![The long stretch after](/images/2026-11-01-a-walled-woods-path/long-stretch-after.jpg "After: the shade holds detail, and the bush walls stand back from the path.")

The bake's light-change check flagged one spot at +76% at (14, 112), on the last stretch, where the bushes left the path. The volume overall changed +1%. The Cost Check read -6%, -4%, -1% and -0% across its views, and the 1440p bench moved GPU time between -3.0% and +2.0% per pose.

## Results and open issues

The path is now a tool and not a layout. I can move a point and rebuild the walls, the plants, the closed start and the crown clearance, in one undo step, and the player is held on the path. The shade reads at about twice its former brightness without moving the sunlit views much.

- The frame-spike walk still has a hitch of 16 to 23 ms around frames 213 to 234 and 684. The worst frame was 16.2 ms at frame 234, which fails the 15 ms limit. The build from before this change fails the same walk worse, at 23.2 ms, so the hitch was already there. It looks like shadow cascade redraws.
- Reference 5's sky over the canopy is still missing. Its top third is open sky, and mine is leaves.
- The wet path reads pale grey because it reflects the sky. It needs reflection captures along the new path, or darker water.
- My saturation is about 0.05 low.
- The prepass cost of the bush walls could come down with hi-Z culling of the hidden rows behind the front bushes.
- I have not decided whether the night woods get the same path.
