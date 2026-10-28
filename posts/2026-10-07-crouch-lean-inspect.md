---
title: A first-person camera rig with crouch, lean and inspect, and a lighting sweep
date: 2026-10-07
order: 1
summary: Crouch, lean and inspect for the first-person camera, then a bug and speed sweep that removes the haze around far lamps and makes the bulbs brighter than the plaster.
tags: gameplay, lighting, performance
cover: /images/2026-10-07-crouch-lean-inspect/close-after.jpg
---

The hallway and the house were walkable, lit, and full of objects I could pick up and throw. The player was still a camera on a pole: it could walk and turn, and nothing else. A horror game depends on small, vulnerable movements: ducking under a low beam, looking round a door frame without stepping into the room, turning a strange object over in my hands. The first task of the day was finishing the first-person camera rig. The second was a bug and speed sweep over the engine and editor, which also showed that my wall lamps were lit wrongly.

## How a first-person camera rig works

A first-person camera is not the player. The player is a collision body, here a capsule 0.3 m in radius and 1.9 m tall, driven by the physics world. The camera is a separate point that follows the capsule. Keeping the two apart is what allows the camera to do things the body cannot, such as leaning or dipping.

The rule I follow is that the body decides where the player can be, and the camera is placed relative to the body with its own smoothing and its own collision check. Every feature below is a different offset from the body to the eye:

```text
eye = feet + (view height above the feet) + head bob + landing dip + lean offset
```

Each term is eased over time. I ease with an exponential approach, `value += (target - value) * (1 - exp(-rate * dt))`. The `exp` form gives the same motion at 30 fps and at 240 fps, which a plain `value += (target - value) * rate * dt` does not at large time steps.

### Crouching

Crouching changes two things, and they change at different speeds.

1. **The collision capsule changes at once.** On the frame crouch starts, the capsule shrinks from 1.9 m to 1.15 m with the feet kept where they are. Shrinking always succeeds because it only removes volume.
2. **The eye height eases.** The eye drops by the same 0.75 m, from 1.62 m to 0.87 m, with a rate of 9 per second. That is a time constant of about 0.11 s, so the view is mostly down after a third of a second. If the camera followed the capsule instantly, the view would jump.

Standing up is the harder direction. If crouch is released under a low ceiling, growing the capsule would push it into the geometry. Before the capsule grows, I test whether the extra volume is free. The test is an overlap query with a capsule that covers only the added height, with its radius reduced by 2 cm so that touching a wall does not count as overlap. If the space is blocked, the player stays crouched and tries again each frame, so the capsule grows and the eyes rise as soon as there is room. Crouched movement is capped at 0.8 m/s, against 1.65 m/s walking.

### Leaning

Leaning moves only the head. The feet do not move, and the capsule does not change. Q leans left and R leans right, because E is already the interact key. At full lean the eye moves 32 cm sideways and 5 cm down, and the view rolls by 8 degrees. The lean eases at a rate of 7 per second.

The difficulty is walls. A head that moves 32 cm sideways beside a wall ends up inside it. The camera then sees the inside of the wall, or the near clip plane cuts through the surface and the view shows the room behind it. A camera that can leave the level geometry breaks the picture.

The standard remedy is a sweep, and that is what I do:

1. Take the upright eye position, the point the eye would occupy without a lean.
2. Sweep a sphere of radius 0.13 m, a rough head, along the lean vector. The physics world returns the fraction of the path completed before a hit.
3. Scale the offset by that fraction, so the head stops a head's width short of the wall.
4. Scale the roll by the same fraction. A tilt with no sideways movement looks wrong, so the two always agree.

If the sweep starts already touching something, the lean is zero. The roll is applied only to the rendered view and not to the aim ray, so interacting with something remains accurate while leaning.

Leaning also broke two lighting structures, covered below. They had assumed the camera's up axis was always world up.

![Leaning round a doorway: upright, left, then right toward the wall](/images/2026-10-07-crouch-lean-inspect/lean.jpg "Three frames at one doorway: the head moves sideways and the view rolls while the feet stay put. Leaning toward the wall, the sphere sweep stops the head short of it.")

### Landing and stairs

Dropping from a height dips the view by a few centimetres and lets it spring back. The dip is a critically damped spring, which returns to rest without overshooting. Its depth is 2.5 cm per m/s of fall speed above 2 m/s, capped at 12 cm.

Adding it exposed an older problem. The view already used a critically damped spring so that climbing stairs reads as one glide and not as a jolt per riser. That spring lags the body on purpose. When the player fell, the same lag held the view above the body, so the view floated after the fall and then sank. I changed it to follow the body in a fall. The fall is detected by air time: more than 0.25 s off the ground. My first version treated any time in the air as a fall, and stairs broke: stepping off each riser counted as a fall and produced 13.5 cm of bounce going down. The air time rule keeps the stairs at 0.3 cm of ripple going up and 0.7 cm going down in the house test.

I also tried a breathing sway, the view rising and falling slightly while standing still. It was too strong at 8 mm, and I did not want it at a quarter of that either, so I removed it. Standing still now holds the view still, and a test keeps it that way.

## Inspecting an object

If I carry something light, up to 5 kg, pressing E brings it up close to my face, as near as its size allows. The mouse then rotates the object and the camera stays fixed. Pressing E again returns the object to my hands, and the right button sets it down.

Two rendering problems had to be solved for this to look right: the background and the light.

### How depth of field works

A real lens focuses on one distance. A point at another distance is projected onto the sensor as a disc, the circle of confusion, and the disc grows with the distance from the focus plane. The image is the sum of all those discs, which is a blur whose size depends on depth.

A real-time renderer approximates this as a post-process:

1. Read the depth buffer and convert each pixel's depth to a distance from the camera.
2. Compute a circle of confusion for that distance: zero at the focus distance, growing beyond it.
3. For each pixel, gather colour from taps spread over a disc whose radius is the circle of confusion.

Gathering has a known failure. A sharp object in front of a blurred background must not bleed into the background, or it leaves a halo. The usual correction is to weight each tap by its own circle of confusion, so that sharp pixels contribute little to the blur of a pixel that is out of focus.

### My implementation

The focus distance is the distance to the held object. My circle of confusion is `saturate((depth - focus) / max(focus * 0.75, 0.15))`. It is zero at or in front of the focus and reaches 1 at 1.75 times the focus distance. The largest blur radius is a fraction of the image height. Each blurred pixel takes 24 taps. They are placed on the golden angle spiral, which spreads them evenly over the disc, and each tap's weight is `saturate(2 * tapCoC / coc)`. The held object has a circle of confusion of zero, so it adds nothing to the background's blur, and no halo forms.

This is the engine's first depth of field. The pass returns immediately when the circle of confusion is zero, and nothing is inspected most of the time, so the benchmark poses did not change. Their images are identical to the previous build.

### Lighting the held object

The flashlight is held at hip height. Its beam passed beside an object held close to my eyes, and the object came out almost black. I turned the beam onto the object. That caused the opposite problem. Light intensity falls with the square of distance, and the object was 0.4 m from the light instead of the 1.5 to 3 m typical for the flashlight. The ratio is (1.5 / 0.4)^2, about 14, so the object was washed out. While inspecting, I dim the beam as if the light were 1.5 m away.

![Inspecting a mug: carried, brought close with the corridor blurred, then turned](/images/2026-10-07-crouch-lean-inspect/inspect.jpg "Frames 50, 90 and 135 of an inspect run. The mug is carried with its prompt, brought close with the corridor out of focus, and then rotated with the mouse.")

## The bug and speed sweep

I ran three read-only reviews, one on the haze I had noticed around far lamps, one on the engine and one on the editor. They found about 50 issues. I fixed every serious one, the largest speed costs and the haze.

### Haze around far lamps

A door seen from the far end of the hallway, next to a lamp, looked foggy. The debug views (bloom only, and fog only) showed two separate causes.

> **Background: bloom and its threshold.** Bloom models light scattering inside a camera lens and eye, which makes very bright things glow beyond their edges. The renderer finds the pixels above a brightness threshold, blurs them at several sizes and adds the result back to the image. The threshold decides what counts as a light source. A soft knee blends the transition so that pixels just below the threshold contribute a little and the glow does not switch on at a hard edge. If the threshold is too low, ordinary lit surfaces glow as well, and a glow on a surface reads as fog in the air.

My threshold was 0.36, about twice mid grey. The plaster next to each sconce is lit from 23 cm away, which makes it very bright, so it passed the threshold. The bloom around each lamp came mostly from the wall, and its halo spread over the door in the distance. I raised the threshold to 1.2, widened the knee to 0.6, reduced the blur radius to 1.2 and set the strength to 0.45. Bulbs and hot highlights still bloom. Lit walls do not.

> **Background: volumetric fog and the inverse-square singularity.** The fog divides the view frustum into a 3D grid of cells, takes one light sample in each cell, and accumulates the scattered light along each pixel's ray. Cells are thin near the camera and deep far away. A point light's intensity is proportional to 1 / d^2, where d is the distance to the light. That grows without limit as d approaches zero, so a cell whose sample point lies very near a lamp receives a huge value. The accumulated history then spreads that value over the whole cell.

At the far end of the hallway a cell is about 1.4 m deep, and a sample 5 cm from a lamp is 400 times brighter than one 1 m away. The result was a glowing blob as large as the door. My change treats a lamp as at least half a cell's depth away when the fog samples it. Near the camera, where the cells are thin, the lamp's own radius still decides. I also made three smaller changes:

- A shadowed lamp no longer lights fog behind a wall. The shadow strength setting lifts lit surfaces, and it had been lifting the air as well, so 8% of the light reached behind walls.
- The fog's forward scattering (the anisotropy) went from 0.45 to 0.3. The engine default is 0.6.
- The values apply to the house, the hallway and all four looks.

![The far corridor before the sweep](/images/2026-10-07-crouch-lean-inspect/haze-before.jpg "Before: halos around the far lamps and a milky patch over the door between them.")

![The far corridor after the sweep](/images/2026-10-07-crouch-lean-inspect/haze-after.jpg "After: the halos are smaller and the door is readable. The bulbs still glow.")

### Other fixes

- **Leaning broke the light grid.** The light clusters and the fog grid ignored camera roll, so lights were cut off at tile edges and fog shafts moved. Both now use the view's own axes, which also holds at plus or minus 90 degrees of pitch.
- **Glass disappeared.** Blended glass was drawn with the alpha-test shaders and the glTF default cutoff of 0.5, so anything fainter than half opacity was discarded. Blended materials have no cutoff now.
- **Mirrored props.** Casters with a negative scale wrote the wrong faces into shadow maps. They get their own culling.

### Speed

- **Entity lookups.** Finding the component that belongs to an entity was a scan through every component. The render-scene build, the editor's validation and the scene tools each did it once per entity, which is quadratic over the 1,600 entities of the house. Each component list now keeps an index.
- **Swinging doors.** A door rebuilt all 918 meshes of the render view on every frame of its swing. Now only the moved entity's objects are patched.
- **Shadow pass.** It no longer allocates each frame, and it recognises casters by entity, so adding one prop re-renders only the shadow tiles it reaches.

The static benchmark poses did not move, since they never swing a door or drag a gizmo. The savings are in the interactions that used to hitch. The editor smoothness check ran 1,500 frames with 0 hitches at 8.1 ms typical.

## Lamps that outshine what they light

With the haze gone I could see that the wall beside each sconce was brighter than the bulb. A real bulb is far brighter than the plaster it lights. In my scene the globe looked like a matte white ball inside a bright patch of wall.

The numbers showed why. Each sconce is a point light of about 10 at the globe's centre, 0.23 m from the wall. The plaster nearby received about 20. The globe's emissive value was 3.2. Spreading that much light over a globe 6 cm across would call for roughly 850.

> **Background: emissive values in HDR.** In a high dynamic range renderer, pixel values are not limited to 1. A surface can emit at 40 or 60, and the exposure and tone mapping stage later maps the whole range to what a display can show. That headroom lets a light source be orders of magnitude brighter than a surface that is only lit. If the source has the same brightness as the lit surface, the picture has no way to tell them apart.

I set the emissive values in the sconce authoring script as named constants: 40 for the opal globe (was 3.2), 60 for the tulip sconce's bulb (was 6) and 4 for its frosted glass (was 0.55). The bloom now starts at the bulb and is centred on it, which matches the reference. Far corridors gain no haze, since the higher threshold excludes lit walls.

The reflection probes capture glowing surfaces, so they stored the old dim globes. The bake's freshness check hashes the scene's emissive multiplier and not the glTF's own value, so nothing reported them as stale. I rebaked both scenes, which took 7.0 s for the hallway and 9.7 s for the house.

I also tried shrinking the light's source size from 0.15 m to 0.07 m to match the globe. It looked the same on the glossy floor and in the close-up, so I kept 0.15.

![A sconce before the change](/images/2026-10-07-crouch-lean-inspect/close-before.jpg "Before: the globe is a matte ball in a brighter patch of wall.")

![A sconce after the change](/images/2026-10-07-crouch-lean-inspect/close-after.jpg "After: the globe is the brightest object in view and the wall reads as lit by it.")

## Results and open issues

The player can crouch, lean, land and inspect objects, with the camera kept out of walls. All 81 test suites pass. The benchmarks in both scenes are within noise of master, in the hallway and the house, so the lamp glow costs nothing measurable.

Two items remain. The glow is part of the asset, so a lamp whose light I dim in a scene keeps a bright globe. The glow should follow the light's intensity, as it already does for flicker. Bloom strength may also need raising now that it comes from the bulbs and not from the walls. Footsteps by surface come with the audio work.
