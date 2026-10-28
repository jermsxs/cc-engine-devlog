---
title: A house built by an AI agent
date: 2026-10-01
order: 2
summary: The hallway grows into a two-storey house, built entirely through the editor's AI tools, and the experiment shows exactly where those tools were too small.
tags: ai-tooling, scene, tools
cover: /images/2026-10-01-a-house-built-by-ai/corridor-to-foyer.jpg
---

Until today, everything I had made lived in one loop of corridor around a solid block. It looks right, but it only proves the engine can draw a hallway. I wanted to know something bigger: can the engine, and the editor I built for it, make a real house? Rooms, doors between them, a staircase, an upstairs.

I added a twist. The editor has a built-in server (using a protocol called MCP) that lets an AI agent drive it with tool calls, like "create an entity", "set this field", "take a screenshot". So I designed the house the way a level designer would, and then built it only through those tools. Every time something got in the way, I wrote it down. The house is the test, and the list of complaints is the real output.

## The house itself

The ground floor keeps the old corridor loop exactly as it was: the lamps, the paintings, the faint window at the far end, the locked bedroom and the closet scare. The solid block in the middle became six rooms:

- a foyer you step into from the corridor through an open doorway;
- a parlor and a study behind it;
- a dining room with a lamp that keeps stuttering;
- a kitchen with no light at all, so it is flashlight territory;
- a storage room under the landing, wedged shut.

A straight run of 19 steps climbs one side of the foyer into a double-height stairwell, and at the top a gallery landing looks back down over a rail. Upstairs there is a master bedroom, a bathroom whose bulb gutters every few seconds, a nursery lit only by cold moonlight, and an attic door that is locked from the other side. A trigger at the top of the stairs runs the same scripted scare as the closet: the lamps gutter and something knocks below and behind you.

![Looking from the corridor through a new doorway into the foyer](/images/2026-10-01-a-house-built-by-ai/corridor-to-foyer.jpg "The new opening in the corridor wall: a lamp in the foyer, the storage door at the back and the gallery rail high above.")

![The upstairs landing seen from the top of the stairs](/images/2026-10-01-a-house-built-by-ai/landing-gallery.jpg "Upstairs: the gallery rail over the stairwell, with the bathroom door on the left and the master bedroom on the right.")

## What the first build showed

The first version of the build script made 727 separate tool calls and 314 entities in about ten seconds. That is fine for a script, but an AI agent in a chat can't make 727 calls and keep its head. The script needed its own little client, which defeats the idea of a tool an agent can simply pick up.

The report I wrote from that run listed what was missing. The big items:

- **No batch tool.** Everything was one entity per call.
- **No whole fixtures.** A wall lamp took seven calls (the globe, the light, the lamp component and so on). A door took four or five.
- **No spatial search.** To trim the grime decals that crossed a new doorway I had to read the scene file by eye.
- **A real engine bug.** More on that below.
- **Rooms that read empty.** No bed, no table, no tile. That became the next day's work.

Two engine changes were needed for the house itself. A light can now be clipped to a box (its room), so a lamp upstairs stops at the floor instead of lighting the room below. And a scene with more than 63 lights no longer loses lights silently: the renderer keeps the 63 nearest the camera and says so. I measured honestly, and with every box switched off the leak was under one grey level, because the shadow-casting lamps already block their own light. The box still earns its place: it is cheap, it keeps each object's eight light slots for nearby lamps, and it stops fog glowing through walls in bigger levels.

## One call, one undo step

The first fix was the batch tool. Two ideas make it work.

> **Concept: Undo as a single step.** An editor records every change so you can press Ctrl+Z. If a script makes 600 edits, you do not want 600 undo steps. A *transaction* groups many edits into one entry, and if any edit in the group fails, all the others are rolled back too, so you never end up with half a lamp.

In the editor, a batch remembers each touched entity as it was before and after. One undo removes the whole batch and redo puts it back with the same ids. Operations inside a batch can also name what they make (`"ref": "light"`) and refer to it later (`"$light"`), so a lamp's component can point at the light created two operations earlier.

![The editor after a batch call](/images/2026-10-01-a-house-built-by-ai/editor-batch.jpg "One batch call made a crate and duplicated it five times, each copy offset from the last. The status bar shows it as a single undo step.")

The numbers tell the story.

| | Calls | Undo steps | Edit time |
|---|---|---|---|
| One call per edit | 727 | 685 | 5.1 s |
| One batch per pass | 48 | 7 | 0.56 s |

The resulting scene was byte-for-byte identical. I also added a spatial query, so "find everything in this box" is one call. A bug I hit on the way was in my script, not the engine: folding a patch into an entity's creation ran it before later entities existed, so a lamp's link to its own light failed. The batch rolled back cleanly and the error named the exact operation, which is what it is supposed to do.

## Whole fixtures in one call

Even with batches, an agent still had to know how a doorway is built. So I moved that knowledge into the editor as *compounds*: one call that makes a whole fixture.

- **Doorway.** Point at a spot inside a wall and say which way the door opens. The editor finds the wall, splits it into left, right and header pieces (keeping its material and collider), cuts the baseboard and chair rail so they stop at the casing, shortens the grime bands that ran across the opening, removes stains that sat in it, and adds the frame and a leaf, locked with a message if you want.
- **Stairs.** Give the foot, direction and height. The editor works out risers a player can climb, adds colliders, handrails, newels and a baluster per step, and refuses a flight whose steps would be too tall.
- **Wall lamp and window.** The globe, light and lamp component, or the window frame with glowing glass and optional moonlight.
- **Light boxes that fit a room.** Rays go from the light to the nearest wall, floor and ceiling.

That last one had a flaw the house exposed at once. Two corridor lamps sat exactly in line with the new dining room and kitchen doors, so their rays went through the open doorways and the boxes swallowed the rooms behind. The fix was to cast nine parallel rays per direction, 0.6 m apart, and take the nearest wall. A test now fails without it.

A full live rebuild of the house became 28 calls in 5.5 seconds, and the handwritten list of decals to trim around doorways disappeared, because the doorways did it themselves.

## A bug about decimal places

The scene file wrote every float with six decimals. That sounds tidy, but it throws bits away. The editor fitted a light box at `-0.9949999`, saved it as `-0.995000`, and the game then read back a different float. The lighting bake is stamped with a fingerprint of the scene, so the game decided the editor's fresh bake was stale.

> **Concept: Shortest exact floats.** A 32-bit float has about seven decimal digits of precision, and many different decimal strings can name the same float. The trick is to print the *shortest* decimal that reads back to exactly the same float. Round numbers get shorter (`0` instead of `0.000000`) and awkward ones keep the digits they need. Nothing is lost, and the file got smaller (640 KB to 577 KB).

The fix was one change to how the writer prints numbers. A test checks 200,000 floats across the whole range, plus nasty cases like `0.1 + 0.2`, and every one comes back bit-for-bit. After that the house script no longer needs to save, reload and then bake.

## Stairs and probe volumes

Walking the house turned up three more problems, and each was fixed in the tool that caused it.

**The stairs stood away from their wall,** leaving a strip of floor, with the chair rail running into the steps. A flight now looks for a wall within 45 cm on a side with no rail, runs to the wall's face, adds a skirt board climbing the wall, and stops the wall's trim where the skirt reaches it.

![The stairs meeting the wall under a skirt board](/images/2026-10-01-a-house-built-by-ai/stairs-wall-after.jpg "After the fix: the steps meet the wall under a painted skirt board that climbs with them.")

**A black slot under the doors.** A doorway cut the wall down to its base, and the rooms' floors stopped at the wall faces, so each opening showed an 8 cm black slot. Now the wall always stays below the floor and a wooden threshold board is laid across the opening.

![A black slot across the doorway](/images/2026-10-01-a-house-built-by-ai/threshold-before.jpg "Before: a black slot where the wall was cut away.")

![A threshold board across the doorway](/images/2026-10-01-a-house-built-by-ai/threshold-after.jpg "After: a threshold board laps onto both floors.")

**The camera shook on the stairs.** The view followed the feet with a quick catch-up. Each riser lifts the feet 19 cm at once, and at walking pace a new riser comes every 0.16 s, so the eye jumped and settled about six times a second. I replaced the catch-up with a critically damped spring on the view's height, which glides instead of snapping. In a new test, the largest frame-to-frame change in vertical speed going up fell from 0.56 to 0.04 m/s.

Bounce light was the last thing. It came from one grid of probes (points that store the light around them) stretched over both floors, so some sat inside the slab between storeys and the stairwell got the same coarse 0.6 m spacing as everything else. A scene can now have up to eight probe volumes, each baked on its own grid. Where they overlap, the smallest box wins and fades out one spacing past its edge. The house uses three: ground floor, upper floor, and a finer 0.45 m grid over the stairwell. That is 10,299 probes instead of 12,288, with none straddling the slab. The reflection-probe limit went from 16 to 64.

## Where it ended

The house builds from a script in under ten seconds through the same tools an agent uses, every edit is undoable, and the hallway still renders the same as before, within a few grey levels. It is still bare: the rooms are plaster boxes with doors. Furniture, wallpaper and tile came next, and the agent-facing tools now feel like tools rather than a wall of one-entity calls.
