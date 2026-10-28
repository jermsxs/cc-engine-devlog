---
title: Closing the asset track, and a modelled flashlight held in the player's hand
date: 2026-10-14
order: 1
summary: A review and a sweep close the asset and animation track, then the player gets a modelled flashlight whose beam leaves its lens, with follow-up fixes from the next day.
tags: gameplay, assets, lighting
cover: /images/2026-10-14-a-flashlight-in-hand/after-closet.jpg
---

Nineteen of the twenty steps of the asset and animation track were done. Before calling the track finished I wanted to know that the new code was correct and not only working on my test files, so the day started with a review and a sweep for bugs and speed. The afternoon went to something I could see on screen: a flashlight that the player holds in a hand, with the beam coming out of its lens.

## Reviewing the track

The last step of the plan is a review of the code most likely to hide bugs. I ran three read-only reviews over every change in the track: cache invalidation (the mesh cache, sidecars, thumbnails and hot reload), the skinned GPU path, and the animation runtime with its APIs. I traced each suspect to the code before accepting it, and each fix has a test that failed before the fix.

### A race in the mesh cache

The most instructive fault was in the cache. An entry is valid only if the source files still have the size and write time recorded when it was made. The cache recorded those values after the import had read the files. If a file was re-exported while a cook was running, and the bakes take seconds, the new file's size and time were recorded against content that was read before the change. The entry was stored as current with the old content, and it was served until the file changed again.

This is a check-then-act race. The rule that closes it is to record the state before reading and to compare it afterwards. A cook is now stored only if every file it read was written before the cook began and is unchanged at the end. The test writes a `.bin` during a cook.

### Other findings

- **The enemy lunged twice.** An Animator loops its clips, so Lurch played again while the enemy stood after it, and it crept another 0.7 m toward the player. The script now plays Lurch once and loops Idle and Walk again. A test counts the lunges and failed on the old script with two.
- **Thumbnails missed shared textures,** because meshes can share textures from other folders. The key and the reload now follow every folder a `.gltf` reads from.
- **Runaway animation input.** A script that set `Speed = 1e9` made one frame walk the clip millions of times to collect events. Loop passes per step are now capped at 64 and crossfades at 10 s. The game's event queue was never emptied and grew with every footfall, and it now keeps the latest 1,024 events.
- **A first-appearance stall.** The skinned pipelines were compiled the first time each pass drew a character, in the middle of a frame, which could stall the ambush at the worst moment. All 21 are now created on the frame a character first enters the scene, in 6 ms with the shader cache warm.

The review of the skinned GPU path found no correctness faults. The palettes, previous palettes, shadow invalidation, bounds and skinning arithmetic all checked out. The pipeline from Blender to a script that drives a character is now written down in one document.

## A sweep for bugs and speed

I then ran one more check of everything the track added. Two measurements came first so that the speed work could be judged: a test that runs 16 patrolling enemies for 600 frames, and a test that times the editor's render-view rebuild, which every gizmo drag and Inspector drag frame pays.

**A scaled character fell apart when it moved.** A sidecar scale scaled the vertices only. A character authored in centimetres looked right at rest, but when a clip played, the joints pulled the mesh back to its old size, because the clip's translations and the skeleton were still in the old units. The scale now applies to the skeleton (rest pose, parent offsets and inverse bind matrices) and to the clip translations, so root motion covers the scaled distance too. The test poses the walker at scale 2 against the plain one. The worst error was 0.75 m before and is under 0.1 mm now.

**Hostile glTF files.** A zero `byteStride` made any count fit its buffer. A huge count could wrap around to a small size. A node that listed the same child twice was walked 2^depth times, and a clip hours long was resampled at 30 Hz. Each now fails at once with a message.

**Sidecar editing and tools.** Saving an invalid sidecar from the Assets panel dropped the parts it could not read, and it now asks me to fix the file by hand. `ingest.py --force` used to delete the old asset before checking the new download, so a bad archive lost it. New files now fill a temporary folder and replace the asset only after every check passes. The Blender exporter also never exported custom properties, so the material extras the engine reads could not come from Blender. They do now.

The speed work removed repeated work. The render-view rebuild had been resolving, checking and parsing every imported mesh's sidecar and binding every animator again each time.

| Measurement | Before | After |
|---|---|---|
| Render-view rebuild, 110 objects (Release) | 1.64 ms | 0.18 ms |
| Render-view rebuild (Debug) | 5.72 ms | 2.58 ms |
| 16 enemies, game step (Release) | 0.23 ms | 0.19 ms |
| 16 enemies, game step (Debug) | 4.02 ms | 2.49 ms |

Sidecars are cached by size and write time, and slot remaps and animator bindings are kept until an asset file changes. Animation keeps its scratch poses and skips rebuilding a pose that cannot have changed. The poses for 16 enemies cost 0.065 ms, and the rest of the step is the capsules' physics. Rendered output was unaffected: every pose's frame time was within 1% and the images within 4 out of 255 of the previous day.

## A flashlight in the hand

Until this point the flashlight was a spot light that the renderer placed at a fixed offset from the eye. Nothing was drawn, the light never moved separately from the view, and only a debug key switched it. I wanted what first-person horror games do: a torch I can see in my hand, a beam that leaves it, and a click to turn it off.

I modelled the torch in Blender. It is about 22 cm long, with a rubber tail cap, a ribbed grip, a flared head with a reflector cup, an emissive lens, a thumb switch and a lanyard loop. Its materials carry the wear and grime layers. The origin is at the grip and the beam axis is the engine's +Z.

### How a held item is attached to the view

A first-person game shows an item in the player's hand, usually called the view model. There are two common ways to draw one.

1. **A separate view-model pass.** The item is drawn with its own camera, often with a narrower field of view and a separate depth range, and its depth is cleared or squeezed so that it can never intersect a wall. The item always looks the same size on screen, but it does not receive the scene's lighting and shadows without extra work, and the cost is a second set of render state.
2. **A world object that follows the camera.** The item is an ordinary object whose transform is recomputed every frame from the eye position and orientation. It is lit and shadowed by the scene like anything else. It can intersect a wall, so the code has to prevent that.

I use the second. My torch is a normal render object in the world. The transform is built every frame from the player's eye, by a chain of offsets:

```text
model pose = eye pose
           + a fixed offset low and to the right of the view
           + lag behind the view's turn
           + sway from the steps
           + tilt from a lean
           + a click dip
           - a pull back from walls
```

Each term is small and smoothed:

- **Lag.** The torch trails a turn by up to 6 degrees and then catches up, so it feels like it has mass.
- **Sway.** It moves 7 mm side to side at half the head bob's rate and 4 mm up and down at the bob's rate, scaled by the same walking weight as the bob so it stops when I stand still.
- **Lean.** It tilts with the head when I lean.
- **Click.** It dips 6 mm for 0.12 s when I press F.

The beam is a spot light that starts at the lens and points along the torch. It is attached in the torch's own space, so it follows every term of the chain, and its shadows move with the hand. The torch model casts no shadow and is never saved with the scene.

### Walls

Walls were the difficult part. Because the torch is an object in the world, pressing against a wall pushed it through the wall. A ray from the eye to the lens now pulls the torch back toward the shoulder by up to 22 cm, so the model never goes through.

The screen still went black against a wall. My first fix tipped the torch downward. That was not enough, because turning the whole model onto the wall swung its body across the view. What worked was to turn only the beam. As the torch is pulled back, the beam turns toward the spot the view rests on, completely once the torch has been pulled back by 6 cm. The wall at my face stays lit and the model holds still.

![The held torch at the closet door](/images/2026-10-14-a-flashlight-in-hand/after-closet.jpg "The held torch at the bottom of the frame as I approach the closet door. The beam leaves from the lens.")

### Switching it

F clicks the torch on and off in the game and in the editor's Play, and the lens glows only while the torch is on. C# scripts can switch it with `Flashlight.On = false;`, which I will use for scares that put the light out. Benchmarks showed no measurable cost: the GPU frames were 3 to 5% faster after the change, which is within noise.

### Hiding it while inspecting

When I picked up an object and inspected it, the torch stayed in view and covered the object. Only the object should be visible. While inspecting, the model now eases down 30 cm, back 8 cm and tips 35 degrees down, using the same smoothed blend as the inspect itself. By the time the object is close, the torch is below the bottom edge of the screen. The light stays in the hand. The beam still starts where the lens was and turns onto the object, so the object is lit from just below the eyes.

Building this showed a second fault. I computed the beam's aim before the torch turned, but turning moves the lens. With an object 0.3 to 0.75 m away, the beam missed it. The beam is now aimed from where the lens ends up. A test checks that the torch's grip and lens are more than 50 degrees below the view and that the beam points at the object.

![Inspecting a book, before](/images/2026-10-14-a-flashlight-in-hand/inspect-before.jpg "Before: the torch covers the corner of the book, and the lit patch is up and to the left of it.")

![Inspecting a book, after](/images/2026-10-14-a-flashlight-in-hand/inspect-after.jpg "After: only the book is in view, lit by the beam.")

## Follow-ups the next day

**A wall at my face glared white.** Light falls off with the square of the distance. With the lens 20 cm from a wall, the patch is (1.2 / 0.2)^2 = 36 times brighter than at 1.2 m and it blows out to pure white. A ray from the lens along the beam now finds the nearest surface. A surface closer than 1.2 m is lit as if it were 1.2 m away, with the dimming eased at 12 per second so the beam does not flash as it sweeps over an edge. The plaster texture shows in the patch. The inspect case uses the same rule, and the dimmer of the two wins.

![A wall at close range, before](/images/2026-10-14-a-flashlight-in-hand/wall-before.jpg "Before: the patch glares to white.")

![A wall at close range, after](/images/2026-10-14-a-flashlight-in-hand/wall-after.jpg "After: the plaster texture shows through the patch.")

**The torch read as a hole.** Its body and grip were near-black metal.

> **Background: metals and dielectrics.** A dielectric is any non-metal, such as plastic, paint or rubber. It reflects a small, roughly fixed share of light, about 4% at normal incidence and more at grazing angles, as a white sheen, and it shows its own colour from light that scatters inside the material. A metal has no inside scattering and reflects its own colour. A near-black metal therefore reflects almost nothing and looks like a hole, while a near-black dielectric still catches a faint sheen on its edges.

Black anodising is a dyed oxide coat, which is a dielectric. I changed the coat to a satin dielectric with the 4% sheen, and the grip's ribs, the rounded head and the worn collar now show in lamp light. The bare-metal wear on the edges is unchanged.

![The held torch in the corridor after the change](/images/2026-10-14-a-flashlight-in-hand/corridor-after.jpg "After the change, the satin coat shows the torch's shape against the floor. Before, it was a black silhouette.")

**The thumb switch did not move.** It is now its own small model, drawn just before the torch. F pushes it 2.5 mm into the body at the peak of the click, and it rests 1 mm in while the torch is on. I changed it from black to grey rubber so that it shows against the collar.

**Editor Play.** The palette's Toggle Flashlight changed the renderer's master flashlight and not the player's torch, so the beam went out while the lens kept glowing. In Play it now clicks the torch as F does.

I also fixed a build fault. The validation script failed its Debug build because the MCP server, which an AI agent keeps open, loads a managed DLL that MSBuild then could not overwrite. The build already moved the server's executable aside before relinking, and the DLL now gets the same treatment.

## Results and open issues

The asset and animation track is closed, and the enemy and the torch are both in the game. All 97 test suites pass in Release. The torch's click sound waits for the audio work, which is next. One cost remains. Each MCP screenshot of the live editor holds its frame for about 300 ms, because encoding a 2560 by 1392 image happens on the main thread. It is harmless for a single screenshot, but a worker thread would remove it.
