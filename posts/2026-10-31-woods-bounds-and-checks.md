---
title: Outer bounds for the woods, and checks for baked light and draw cost
date: 2026-10-31
order: 1
summary: I close the woods' edges with a skirt, a bank and impostors, then add a light-change report to every bake and a Cost Check to the editor.
tags: outdoors, lighting, tools
cover: /images/2026-10-31-woods-bounds-and-checks/edge-east.jpg
---

I could walk to the edge of the woods and see past it. The invisible walls stop the player, but they do not hide anything, so beyond them the ground simply ended in white haze. I wanted every side of the woods closed. The work was straightforward in outline. Adding the surroundings then took a stop of light off the woods without anything looking wrong in the editor, and I only found it hours later in benchmark images. That decided the second half of the day: I changed the editor so that a bake reports how much the light moved, and so that it reports what an edit costs to draw.

## Closing the edges of a scene

> **Background: hiding the edge of a level.** A playable area is finite, and the renderer has to draw something at its border. Games do not extend the playable area. They put geometry around it that can be seen but never reached, and they arrange that geometry so that every line of sight from inside the area ends on something solid. Four ingredients are common. Terrain continues past the boundary and rises, so the horizon is a ridge and not an open plane. Dense objects such as trunks or buildings stand along the boundary, so the player meets them before any open space. A mass of foliage or distant buildings covers the crest of the ridge, so no sky shows between the ridge and the objects on it. And everything out there is cheap, because the player never gets close: it has no collision, it uses low levels of detail, and the farthest objects are replaced by impostors.

An impostor is a flat stand-in for a 3D object. The object is rendered once, from several directions, into a texture, and the engine draws a few textured cards that show that picture instead of the full mesh. Crossing several cards at angles makes the stand-in readable from any side. The saving is in triangles: the card version has a few dozen, where a tree's last level of detail has thousands. The limits are that the picture is fixed, so lighting and parallax are wrong when seen up close, and that the switch from mesh to cards must happen far enough away that nobody sees it. The transparent parts of a card still cost depth-test work, so cards cut to the object's outline cost less than full rectangles.

### What I built

![The edge of the woods in side view](/images/2026-10-31-woods-bounds-and-checks/edge-section.svg "A side view, not to scale. The walkable ground ends at the invisible wall. Beyond it the skirt runs on, rises into a bank, and is covered by trunks.")

The woods now close on every side with four pieces.

- **The skirt.** The ground carries on 60 m past every wall, in 8 coarse tiles on a 2 m grid, about 22,000 triangles in all. Within about 25 m it rises into a bank 6 to 7 m high. It tucks 2 m under the woods' own ground tiles and sits 0.3 m lower, so no crack shows where the two grids meet.
- **The trunk line.** A row of trees and poles stands 0.6 to 2.4 m outside every wall, about 1.5 m apart. Along the wall the player meets trunks, not open ground.
- **The wooded bank.** About 2,400 trees climb the bank. They are close together at its foot, thinner up the slope and close again at the back, where all of them have broad crowns to shut the view.
- **The undergrowth.** From 12 m out, about 3,400 bushes and saplings fill the gaps between the far trunks, where sky had shown through. No tree stands where it would rise over the house's roof as seen from the gate, because the reference photographs show open sky above the house.

Nothing out there has a collider. The walls stop the player, so the bank only has to be seen.

The cost control is in the impostors. Each tree and pole is rendered by Cycles onto four crossed cards, 24 triangles, and drawn from 60 m (42 m for poles) in place of the roughly 6,000 triangles its last level still has. The cards are cut to the object's outline. Bank trees more than 16 m out are only their impostors. The undergrowth is only impostors of the bushes and saplings, which inside the woods keep their real leaves. The bank's trees and undergrowth stop drawing at 70 m and 50 m, since from deeper inside the woods hide them.

Before is on the left of each pair below, after on the right, both from the same pose with the same build.

![At the east wall, before and after](/images/2026-10-31-woods-bounds-and-checks/edge-east.jpg "East wall. Left: white haze past the edge. Right: ground, trunks and undergrowth.")

![The yard's far end, before and after](/images/2026-10-31-woods-bounds-and-checks/edge-yard-far.jpg "The yard's far end. The empty haze becomes a floor of leaves with trunks standing on it.")

![The west wall looking up, before and after](/images/2026-10-31-woods-bounds-and-checks/edge-west-up.jpg "West wall, looking up the slope. The bank now carries trees to the top of the frame.")

## Why geometry in a lighting bake changes the light

Three things had to be fixed along the way. Two were about the probe volume and the sky band. The third, the darker woods, is the one that needs explaining.

> **Background: occlusion of sky light in a bake.** The woods' bounce and sky light is baked into a grid of irradiance probes. A bake works by shooting rays from each probe in many directions. A ray that hits a surface sees that surface lit by the scene's lights, and from the second bounce on, by the previous bounce's probes. A ray that escapes the scene sees the sky. The probe stores the result averaged over the hemisphere with a cosine weight:
>
> `E = integral over the hemisphere of  L(w) * cos(theta) dw`
>
> For an unoccluded uniform sky of radiance `L` this is `pi * L`. Anything that blocks part of the sky replaces `L` in those directions with the radiance of whatever the ray hit, which is almost always darker. So the more geometry the bake can see around a probe, the lower its sky term, in proportion to the cosine-weighted share of the hemisphere it covers. This is why including or excluding a mesh from a bake is a lighting decision and not only a performance one: a mesh in the bake is an occluder and a bounce surface, and a mesh left out is invisible to the light.

In the woods, rays that used to escape toward the horizon now hit the bank and its trees. With the surroundings in the bake, `path_start` fell from 21.0 to 9.6 in mean brightness out of 255, and the exposure meter fell a whole stop with it. Even the bare skirt alone, without any trees, took the view to 15.2.

The geometry out there is not what lights the woods in the finished look. It only has to be seen. So mesh renderers now have an **In Lighting Bake** field (`inLightingBake`, on by default), and the surroundings have it switched off. The bake sees the woods as it always did, and the woods' bake stays what it was. There are two consequences.

- The bank's own probes now see open ground, since the bank cannot see itself, so their volume is turned down to an intensity of 0.4.
- The bank's trees cast real-time sun shadows onto it, because their shadows are not in the bake.

The intensity of 0.4 stands in for occlusion that the bank's bake cannot see. A per-volume choice of which geometry each volume's bake sees would be the correct fix, and I have not built it.

The two smaller problems were these.

- **A probe volume capped at 100 m.** A coarse probe volume now covers the surroundings, at 6 m spacing and 34 by 6 by 50 probes. Without it the bank had no bounce light and glowed. The renderer clamped every probe volume's half-size to 100 m, which cut this one short and left a bright band 25 to 30 m out. The limit is 250 m now. The grid builder already caps the probe count.
- **The sky band.** With the bank only 6.5 m high, a strip of sky glowed at eye level between the crest and the crowns. Raising the bank to a 16 m ridge did not help, because the band moved up with it and the higher ridge shaded the woods. The undergrowth was what closed it.

Inside the woods nothing else moves. Mean brightness out of 255 at the bench poses, before and after:

| Day pose | Before | After | Night pose | Before | After |
|---|---|---|---|---|---|
| path_start | 21.0 | 20.9 | path_start | 15.4 | 15.3 |
| toward_the_end | 5.1 | 4.9 | long_stretch | 8.2 | 8.0 |
| up_at_the_canopy | 10.2 | 10.2 | into_the_bank | 17.3 | 17.3 |
| into_the_bank | 16.2 | 13.2 | up_at_the_canopy | 19.4 | 17.3 |
| gate_far | 4.9 | 4.3 | first_bend | 10.8 | 8.5 |

The poses that changed look out at the edge. They now see trunks where they saw bright haze.

Speed was close to flat. Mean GPU time at 1440p, before and after:

| Scene | TAA on | TAA off |
|---|---|---|
| Hallway | 3.936 to 3.918 ms | 3.599 to 3.578 ms, pixel-identical |
| House | 3.671 to 3.649 ms | 3.389 to 3.394 ms, pixel-identical |
| Kitchen | 3.255 to 3.234 ms | 3.014 to 2.981 ms, within 1/255 |
| Woods | 8.341 to 8.317 ms | |
| Night woods | 8.884 to 9.185 ms | |

The day woods break even, because the impostors on the woods' own far trees pay for the bank (`path_start` went from 9.15 to 8.75 ms). The night woods cost 0.30 ms more, about 3%. Poses that look toward an edge now draw the trunk line and the foot of the bank where they used to see empty sky. At the gate that is about one million more triangles and 11 to 15 million more prepass pixels. The woods were already over my budget for a GPU of RTX 3060 class, so this is open.

For verification, `ctest` in Release passed 118 of 118. `WoodsSceneTests` has a new check in which the player walks at each of the four walls for 5 s and has to stay inside with no respawns. The frame-spike walk passed on both woods scenes and matched the runs before, and `scene_validate` reported 0 errors on both.

## Every bake says how much the light moved

> **Background: regression checks for baked lighting.** Code regressions are caught by tests, and image regressions by comparing renders. Baked data is awkward because it sits between the two. It is produced by a slow offline process, it is consumed by every frame, and a bad bake does not crash or fail validation. It only makes the picture slightly different. The usual defence is to treat the bake's output as a number to compare. Keep the previous result, produce the new one, reduce both to a few statistics that capture what matters (here, how much bounce light each volume holds), and flag a change past a threshold. Two conditions make this useful. The bake has to be deterministic, so that a change in the statistic means a change in the scene and not run-to-run noise. And the report has to appear at the moment of the edit, because the cost of a side effect grows with the time between cause and discovery.

What I wanted was for the editor to be the place where a scene is built and where side effects show at once. From that day I build and change scenes through the editor and its MCP tools only, and I use Python only inside Blender.

### How it works

Before a bake overwrites `<scene>.probes.bin`, it reads the old file. For each probe volume it compares the mean light of the probes, old against new, in `Lighting::CompareProbeLight`. The mean is the average over each probe's interior texels and then over the probes, on the base layer, as luminance `E / pi`. Probes that sit inside walls do not count.

- **In the editor.** The Bake Lighting status line now ends with a line such as "Light change: woods +2%". Past 15% the warning comes first ("Light changed a lot since the last bake: ..."), shows as a warning toast and goes to the log. My first version put it at the end of the status line, where the status bar cut it off. I saw that in a screenshot and moved it to the front.
- **For tools.** The headless `lighting_bake` returns `lightChange`, and live bakes add `render_stats.probes.lastBakeLightChange`. Each volume reports before, after, changePercent and whether it warns. The `bake-probes` command of SceneInspect prints the same line.

### Checking it by making the mistake again

I opened the Release editor on the woods. Through MCP only, I put the eight skirt tiles back into the bake, as one undo step, and baked.

![The warning in the editor's status bar](/images/2026-10-31-woods-bounds-and-checks/bake-warning.jpg "After putting the skirt back in the bake, the status bar leads with the warning: probe_volume_woods -16%, probe_volume_surroundings -23%.")

The result was "probe_volume_woods -16%, probe_volume_surroundings -23%", with the warning, the log line and `warns: true` in `render_stats`. I then undid the change and rebaked, which gave +19% and +29% back. The bake files came out byte-identical to the committed ones. That confirms the bake is deterministic and that nothing of the test remained in the scene.

One result shaped the threshold. The volume's mean moved 16% where the pixels on the path moved about 28%. The mean covers the whole volume, shade and open ground together, so it dilutes a local change. A line of 15% is therefore about the smallest step that matters.

`ProbeBakeFileTests` gained a `LightChange` case. It covers uniform volumes, probes inside walls being left out, -50% warning and +10% not warning, a new volume having nothing to compare with, and the status line text. There was no renderer change, so no benchmark.

## The light check looks at every spot

The 16% result pointed at a weakness. An average can stay under its line while one place goes dark. I changed the bake to cut every probe volume into 8 m columns and compare each column with the last bake. It reports the spot that moved most and warns past 30%. Spots darker than a quarter of the volume's mean are not judged, because their relative change is noise, and neither are spots with fewer than four valid probes before or after.

To test it I put the skirt back in the bake again. The woods' average fell 16%, but the worst spot fell 47%, at (40, 76). That is the east wall, where the skirt meets the woods. The average had only just crossed its line, and the spot shows where to look.

## A Cost Check in the editor

> **Background: per-scene cost budgets.** A frame budget is a target, such as 60 frames a second, which leaves 16.7 ms for the whole frame, and my target is about 8 ms for the GPU part on a 3060-class card. A budget only helps if the cost of each change is visible when it is made. Measuring the frame once at the end tells you that you are over, and nothing about which edit did it. The approach is a fixed set of camera views per scene, timed by the GPU's own timestamps over many frames, compared with the last accepted run. Four details matter. The views have to settle first, since shadows, streaming and the temporal anti-aliasing history all change the cost during the first frames. The comparison has to use both a relative and an absolute threshold, so a 10% change on a very cheap view does not warn. Timing has to run with vsync off, or every result reads as the refresh rate. And two runs are only comparable on the same GPU at the same resolution.

### How it works

The scene keeps a few camera views next to it, in `woods.cost.json`. Render > Add Current View to Cost Check adds the viewport camera. Cost Check, in the same menu, flies the viewport through the views. At each one it waits 40 frames for things to settle, then times the GPU over 90 frames with vsync off. That takes about 1.5 s per view. Each view is compared with the last check, and the passes that grew are named.

A view warns when it grows by more than 5% and by more than 0.25 ms. The status bar then leads with "Slower to draw since the last Cost Check", with a warning toast and a log line. An agent gets the same through `command_run CostCheck` and `render_stats.costCheck`.

The check refuses to compare when the GPU or the viewport size differs from the last check, and says so. This happened to me by accident. My screenshot step un-maximized the window, and the check correctly reported "the viewport is 580x474, the last check's was 1540x966".

### Choosing the line

I gave the woods four views from the bench poses: the path start, toward the end, into the bank and the gate from afar. Two checks with no change in between agreed within 0.02 ms, under 1%. That noise floor is why I tightened the line from 10% and 0.3 ms to 5% and 0.25 ms.

Then I changed something on purpose. Turning screen-space reflections on for every surface added about 7% in every view, and the check named the cause as "ssr +0.31". Under the first 10% line it would not have warned. With the new line it does.

![The Cost Check warning after turning reflections on](/images/2026-10-31-woods-bounds-and-checks/cost-warning.jpg "The status bar after turning screen-space reflections on for every surface: view 1 5.15 to 5.51 ms (+7%, ssr +0.31), view 2 4.18 to 4.45 ms (+6%).")

I then undid the change, and the baseline check read 5.14, 4.17, 4.70 and 4.89 ms.

`EditorCostCheckTests` covers the file round trip, the warn line, a faster view never warning, small views under 0.25 ms not warning, and no comparison across GPUs, viewport sizes or new views. `ProbeBakeFileTests` gained a `SpotChange` case, in which one dark spot leaves the average under its line but warns as a spot. The full Release `ctest` passed 119 of 119.

## Results and open issues

The woods are closed on all sides, the playable area renders as it did, and the editor now says so when a bake moves the light or an edit adds draw cost. The night woods are 0.3 ms slower for it.

- The night woods' extra 0.3 ms needs cheaper levels for the trunk line and the foot of the bank, or fewer trees.
- The bank's probe intensity of 0.4 should be replaced by a per-volume choice of what each bake sees.
- Cost Check views are named "view N", and the editor has no rename yet. The check does not run by itself, and it could run after Save or after Bake.
- A woods bake spends minutes gathering the scene's triangles on about one core before it traces anything. Speeding that up would keep baking quick to repeat.
- The `.mcp.json` server is still the old Debug `CCMcp.exe`, which cannot load the woods headless. A live editor works around it.
