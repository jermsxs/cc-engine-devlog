---
title: A flashlight in the player's hand
date: 2026-10-14
order: 1
summary: Wrapping up the production-assets track with a review and a sweep, then giving the player a modelled flashlight to hold, with follow-up fixes the next day.
tags: gameplay, assets, lighting
cover: /images/2026-10-14-a-flashlight-in-hand/after-closet.jpg
---

The production-assets track was meant to have twenty steps, and by now nineteen of them were done. Before calling it finished, I wanted to be sure the new code was right and not just working on my test files. So the day started with reviews, then a sweep for speed, and then I spent the afternoon on something I could finally see: a flashlight you hold.

## Reviewing the track

The last step was a review of the code most likely to hide bugs. Three read-only reviews read every change from the whole track: the cache invalidation (mesh cache, sidecars, thumbnails, hot reload), the skinned GPU path, and the animation runtime and its APIs. Each suspect was traced to the code before I accepted it. The fixes, each with a test that failed first:

- **The enemy lunged twice.** An Animator loops its clips, so Lurch played again while the enemy stood after it, and it crept another 0.7 m toward the player. The script now plays Lurch once and loops Idle and Walk again. A test counts lunges, and failed on the old script with two.
- **A stale mesh could be cached.** The mesh cache recorded a `.bin`'s size and time *after* the import read it. A file re-exported while a cook ran (the bakes take seconds) was stored as current with the old content, and kept being served. A cook is now stored only if every file it read was written before it began and is unchanged at the end.
- **Thumbnails missed shared textures,** because meshes can share textures from other folders. The key and the reload now follow every folder a `.gltf` reads from.
- **Runaway animation input.** A script setting `Speed = 1e9` made a frame walk the clip millions of times to collect events. Loop passes per step are capped at 64, crossfades at 10 s, and the game's event queue (which was never emptied and grew with every footfall) keeps the latest 1024.
- **A first-appearance stall.** The skinned pipelines were compiled the first time each pass drew a character, mid-frame, which could stall the ambush at the worst moment. Now all 21 are made the frame a character first enters the scene, in 6 ms with the shader cache warm.

The skinned GPU review found no correctness bugs: palettes, previous palettes, shadow invalidation, bounds and the skinning maths all checked out. The asset pipeline now has one document that covers a character from Blender to a script driving it.

## A sweep for bugs and speed

Before moving on to audio, I asked for one more check that everything the track added works as intended and runs efficiently. Two new measurements came first, so the speed work could be judged: a test that runs 16 patrolling enemies for 600 frames, and a test that times the editor's render-view rebuild, which every gizmo or Inspector drag frame pays for.

The bugs it found were good ones.

**A scaled character fell apart when it moved.** A sidecar scale scaled the vertices only. A character made in centimetres looked right at rest, but the moment a clip played, its joints pulled the mesh back to the old size. The scale now applies to the skeleton (rest pose, parent offsets, inverse bind matrices) and to the clip translations, so root motion covers the scaled distance too. The test poses the walker at scale 2 against the plain one: the worst error was 0.75 m before, and is under 0.1 mm now.

**Hostile glTF files.** A zero `byteStride` made any count fit its buffer. A huge count could wrap around to a small size. A node listing the same child twice was walked 2^depth times, and a clip hours long was resampled at 30 Hz. Each now fails immediately with a message instead of hanging or running out of memory.

**Sidecar editing.** Saving an invalid sidecar from the Assets panel dropped the parts it could not read; it now tells me to fix the file by hand. The panel re-reads when the file changes elsewhere. The Model Viewer no longer saves while the game runs. And the editor's own save is no longer reloaded a second time when the file watcher sees it two seconds later.

Two tools were also made safer. `ingest.py --force` used to delete the old asset before the new download was checked, so a bad archive lost it; now new files fill a temporary folder and replace the asset only when every check passed. And the Blender exporter never exported custom properties, so material extras the engine reads (wear colour, grime amount, detail normal) could not come from Blender. They do now.

Speed mostly came from not repeating work:

| Measurement | Before | After |
|---|---|---|
| Render-view rebuild, 110 objects (Release) | 1.64 ms | 0.18 ms |
| Render-view rebuild (Debug) | 5.72 ms | 2.58 ms |
| 16 enemies, game step (Release) | 0.23 ms | 0.19 ms |
| 16 enemies, game step (Debug) | 4.02 ms | 2.49 ms |

The rebuild had been resolving, checking and parsing every imported mesh's sidecar and binding every animator again, each time. Sidecars are now cached by size and write time, and slot remaps and animator bindings are kept until an asset file changes. Animation keeps its scratch poses and skips rebuilding a pose that cannot have changed. The poses alone for 16 enemies cost 0.065 ms; the rest of the step is the capsules' physics.

Rendered output was unaffected: every pose's frame time was within 1% and images within 4/255 of the day before.

## A torch you can see

Now the part I had been looking forward to. Until now, the flashlight was a spot light that the renderer placed at a fixed offset from the eye. Nothing was drawn, it never moved apart from the view, and only a debug key switched it. I wanted it to feel like a horror game: a torch in your hand, a beam that comes out of it, and a click to turn it off.

I modelled it in Blender: about 22 cm long, with a rubber tail cap, a ribbed grip, a flared head with a reflector cup, an emissive lens, a thumb switch and a lanyard loop. Its materials carry wear and grime. Its origin is at the grip and its beam axis is the engine's +Z.

![The flashlight in Blender](/images/2026-10-14-a-flashlight-in-hand/blender-views.jpg "The torch from four angles in Blender: three-quarter, side, front with the glowing lens, and top.")

The hand holds it low and to the right of the view. It trails a turn by up to 6 degrees and then catches up, sways side to side with your steps, dips a moment when clicked, and tilts when you lean.

**Walls were the hard part.** Pressing against a wall poked the torch through it. A ray from the eye to the lens now pulls the torch back toward the shoulder, so it never goes through. But the screen still went black against a wall. My first fix, tipping the torch down, was not enough. Turning the whole model onto the wall swung its body across the view. What worked: only the *beam* turns onto the spot the view rests on, so the wall at your face stays lit and the model holds still.

![The held torch at the closet door](/images/2026-10-14-a-flashlight-in-hand/after-closet.jpg "The held torch at the bottom of the frame as I approach the closet door. The beam leaves from the lens.")

The beam starts at the lens and points where the torch points, so its shadows move with the hand. The torch itself casts no shadow and is never saved with the scene. F clicks it on and off in the game and in the editor's Play, and the lens glows only when it is on. C# scripts can do the same with `Flashlight.On = false;`, which is ready for scares that kill the light.

Benchmarks showed no measurable cost: GPU frames were 3 to 5% faster after, which is noise.

### Hiding it while inspecting

When I picked up an item and inspected it, the torch stayed in view and covered the item. Only the item should be seen. So the model eases down 30 cm, back 8 cm and tips 35 degrees down as the item rises, using the same smoothed blend as the inspect itself. By the time the item is close, the torch is well below the screen's bottom edge. The *light* stays in the hand: the beam still starts at the lens and turns onto the item, so it is lit from just below the eyes.

Making it showed a second bug. The beam's aim was worked out before the torch turned, but turning swings the lens. With an item 0.3 to 0.75 m away, the beam missed it. The beam is now aimed from where the lens ends up.

![Inspecting a book, before](/images/2026-10-14-a-flashlight-in-hand/inspect-before.jpg "Before: the torch covers the corner of the book, and the lit patch is up and to the left of it.")

![Inspecting a book, after](/images/2026-10-14-a-flashlight-in-hand/inspect-after.jpg "After: only the book is in view, lit by the beam.")

## The next day's follow-ups

The flashlight's open problems got fixed the day after.

**A wall at your face glared white.** Light falls off with distance squared, so with the lens 20 cm from a wall the patch blew out to pure white. A ray from the lens along the beam now finds the nearest surface. Anything closer than 1.2 m is lit as if it were 1.2 m away, eased so the beam does not flash as it sweeps over an edge. The plaster shows in the patch now.

![A wall at close range, before](/images/2026-10-14-a-flashlight-in-hand/wall-before.jpg "Before: the patch glares to white.")

![A wall at close range, after](/images/2026-10-14-a-flashlight-in-hand/wall-after.jpg "After: the plaster texture shows through the patch.")

**The torch read as a hole.** Its body and grip were near-black *metal*.

> **Concept: Metals and dielectrics.** A dielectric, which is any non-metal like plastic, paint or rubber, reflects a small, fixed amount of light (about 4%) as a white-ish sheen at every angle, and shows its colour from light that scatters inside. A metal has no inside scattering; it reflects its own colour. So a near-black *metal* reflects almost nothing, and a near-black *dielectric* still catches a faint sheen on its edges.

Black anodising is a dyed oxide coat, a dielectric, so the coat now has a satin 4% sheen. The grip's ribs, rounded head and worn collar show in lamp light.

**The thumb switch did not move.** It is now its own small model, drawn just before the torch. F pushes it 2.5 mm into the body at the click's peak, and it rests 1 mm in while the torch is on. I changed it from black to grey rubber so it shows against the collar.

**Editor Play.** The palette's Toggle Flashlight was flipping the renderer's master flashlight instead of the player's torch, so the beam went out while the lens kept glowing. In Play it now clicks the torch the way F does.

I also ran into a build bug on the way. The validation script failed its Debug build because the MCP server (which an AI agent keeps open) loads a managed DLL that MSBuild then could not overwrite. The build already moved the server's executable aside before relinking, and the DLL now gets the same treatment.

## Where it ended up

Track P is closed, and the enemy and the torch are both in the game. The click sound waits for audio work, which is next. One cost I noticed: each MCP screenshot of the live editor holds its frame for about 300 ms, since encoding a 2560 by 1392 image happens on the main thread. That is harmless for one screenshot, but a worker thread would remove it.
