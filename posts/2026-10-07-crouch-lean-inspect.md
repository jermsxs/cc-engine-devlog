---
title: Crouch, lean, inspect, and lamps that outshine the wall
date: 2026-10-07
order: 1
summary: The player learns to crouch, lean and inspect, then a bug and speed sweep clears the haze around far lamps and makes bulbs outshine the plaster.
tags: gameplay, lighting, performance
cover: /images/2026-10-07-crouch-lean-inspect/close-after.jpg
---

By this point the hallway was walkable, lit, and full of things you could pick up and throw. But the player still moved like a camera on a pole. You could walk and turn, and that was it. A horror game lives on small, vulnerable movements: ducking under something, peeking round a doorframe, turning a strange object over in your hands. So the first job of the day was giving the player a body.

The second job was a cleanup. I asked for a bug and speed sweep over the whole engine and editor, and while that ran I noticed two things about my lamps that looked wrong. Both got fixed before the day ended.

## Crouch, lean and look

**Crouch.** C toggles it and Ctrl holds it. The collision body shrinks to a 1.15 m capsule right away, but the camera eases down over a fraction of a second, so it feels like bending your knees rather than teleporting. Moving crouched is slow, 0.8 m/s. If you let go of crouch under a low ceiling, the game keeps you down and stands you up by itself once there is room. Before growing back, the body checks the space above its head.

**Lean.** Q leans left and R leans right (E is already "interact"). The head slides 32 cm sideways and dips a little, and the view tilts 8 degrees. The feet do not move. The tricky part is walls: if you lean toward one, the head must not poke through it. So the engine sweeps a small sphere from the upright head position to the leaned one, and if it hits something, the head stops a head's width short and the tilt shrinks to match.

**Landing.** Dropping from a height now dips the view a few centimetres and lets it spring back. While adding it I found an older problem. The camera has a smoothing spring so that climbing stairs glides instead of jerking. But when you *fell*, that same spring made the camera trail behind the body, so after a drop the view floated and then sank. Now the view falls with the body, and only a genuine fall counts: about a quarter of a second in the air. A single stair step is a much shorter drop, so stairs keep their smooth glide. My first version broke the stairs (13 cm of bounce going down); the quarter-second rule fixed it.

I also tried a breathing sway, the view slowly rising and falling when you stand still. It sounded atmospheric. It was too much even at 8 mm, and still unwanted at a quarter of that, so I took it out. Standing still now holds perfectly still, and a test keeps it that way.

![Leaning round a doorway: upright, left, then right toward the wall](/images/2026-10-07-crouch-lean-inspect/lean.jpg "Three frames of leaning round a doorway. The head moves sideways and the view tilts; the feet stay put.")

## Inspecting what you hold

If you carry something light (up to 5 kg) and press E, it floats up close to your face, as near as its size allows. The mouse now turns the object instead of the camera, and the player stands still.

The second half of that effect is what sells it: everything behind the object goes soft.

> **Concept: Depth of field.** A real camera lens only keeps one distance sharp. Things nearer or farther are blurred, and the blur grows with how far they are from the focus plane. Games fake this by reading the *depth buffer* (a picture that stores how far away each pixel is) and blurring pixels whose depth is past the focus distance.

This was the engine's first depth of field. The post-processing pass now reads depth and blurs only what lies beyond the held item. One detail matters: the item's own pixels are left out of the background blur. Otherwise the blur would smear the item's colour outward and leave a halo around it.

Lighting needed care too. The torch was held at the hip, so its beam passed the item and left it almost black. I aimed the beam at the item. But a full-strength beam only 40 cm away washed it out, because light falls off with the square of distance. So while inspecting, the beam is dimmed as if it were lit from 1.5 m away.

![Inspecting a mug: carried, brought close with the corridor blurred, then turned](/images/2026-10-07-crouch-lean-inspect/inspect.jpg "Three moments: carried with its prompt, brought up close with the background out of focus, and turned with the mouse.")

## The bug and speed sweep

I asked three read-only reviews (the haze, the engine, the editor) to hunt for problems. They found about 50. I picked every serious one, the biggest speed wins, and the haze.

**The haze around far lamps.** A door seen from far away with a lamp beside it looked foggy. Two causes showed up in the debug views:

- **Bloom started too low.** Bloom is the glow around bright things.

  > **Concept: Bloom threshold.** Bloom works by picking out the pixels brighter than a threshold, blurring them, and adding them back on top. If the threshold is low, ordinary lit surfaces glow too. Mine started at 0.36, about twice mid grey, so the plaster right beside each sconce, lit at close range, glowed as brightly as the bulb. That halo spread across the far door. The threshold is now 1.2, with a softer knee, so only bulbs and hot highlights bloom.

- **Fog cells were too coarse.** The volumetric fog divides the view into cells, and far cells are about 1.4 m deep. A lamp sitting close to a cell's sample point gives a huge value, because light strength goes up with the inverse square of distance. The fog's history then smeared that spike over the whole cell, producing a glowing blob as big as the door. The fix is to treat a lamp as at least half a cell's depth away. I also lowered the fog's forward scattering a bit, and shadowed lamps no longer leak light into air behind walls.

![The far corridor before the sweep](/images/2026-10-07-crouch-lean-inspect/haze-before.jpg "Before: halos around the far lamps and a milky patch over the door between them.")

![The far corridor after the sweep](/images/2026-10-07-crouch-lean-inspect/haze-after.jpg "After: the halos are smaller and the door is readable. The bulbs still glow.")

**Real bugs.** Leaning had broken the light grid, because it ignored camera roll and cut small lights off at tile edges. Glass had been throwing away anything fainter than half opacity. Mirrored props wrote the wrong faces into shadow maps. A graphics-device failure used to just die silently; now it names its error before exiting.

**Speed.** Looking up "which component belongs to this entity" had been a scan through every component, and the render build, editor validation and scene tools did it once per entity. In the 1600-entity house that is quadratic. Each list now keeps an index. A swinging door rebuilt all 918 meshes of the render view every frame of its swing; now only the moved entity is patched. The shadow pass stopped allocating memory each frame. The editor now sleeps while minimised.

The frame times of my static benchmark poses did not move, since those poses never swing a door or drag a gizmo. The savings are in the moments that used to hitch.

## Lamps that outshine what they light

The haze fix exposed something odd. The wall beside each sconce was *brighter than the bulb*. A real bulb is far brighter than the plaster it lights. Mine read as a matte white ball with the glow coming from the wall.

The numbers explained it. Each sconce is a point light of about 10 at the globe's centre, 0.23 m from the wall, so the plaster nearby reached around 20. The globe itself glowed at 3.2. If you spread that much light over a 6 cm globe, the globe should be roughly 850.

> **Theory: Emissive in HDR.** In an HDR renderer, brightness is not capped at 1. A surface can be emissive at 40 or 60, and the camera stage later brings it back into the displayable range. That headroom is what lets a bulb look like a light source and a wall merely lit.

I raised the opal globe to 40, the tulip sconce's bulb to 60, and its frosted glass to 4. The bloom now comes from the bulb, centred on it, which is what the reference shows. The far corridor gets no new haze, because the higher bloom threshold keeps lit walls out of the glow.

One catch: the reflection probes capture glowing surfaces, so the stored globes were still the dim ones. The bake's freshness check hashes the scene's emissive multiplier, not the model's own value, so nothing flagged them as stale. I rebaked both scenes, which took seven to ten seconds each.

![A sconce before the change](/images/2026-10-07-crouch-lean-inspect/close-before.jpg "Before: the globe is a matte ball sitting in a brighter patch of wall.")

![A sconce after the change](/images/2026-10-07-crouch-lean-inspect/close-after.jpg "After: the globe is the brightest thing in view, and the wall is clearly just lit by it.")

I also tried shrinking the light's source size to match the 6 cm globe. It looked identical on the glossy floor and in the close-up, so I dropped the change.

## Where it ended up

The player can now crouch, lean, land and examine objects. The far corridor is cleaner, and the lamps look like lamps. Still open: the glow is baked into the asset, so a lamp whose light is dimmed in a scene keeps a bright globe. The glow should follow the light's intensity. And bloom might want turning up a touch now that it comes from the bulbs. Footsteps by surface come when audio arrives.
