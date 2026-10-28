---
title: Field of view, contact shadows and hunting editor hitches
date: 2026-09-30
order: 2
summary: Measuring the field of view, adding contact shadows, fixing close-up faults, tracing editor stutter through frame-time spikes, and redoing the door prompt.
tags: renderer, lighting, performance
cover: /images/2026-09-30-final-look-and-fixes/game-start.jpg
---

The last step on my list for the look was the camera and the final grade. After it I spent the rest of the day on faults I saw when walking up to walls, on an editor stutter that had come back, and on the door prompt.

## Choosing the field of view

My plan said "a wider field of view". The reference suggested the opposite, so I measured it.

> **Background: Field of view and focal length.** A perspective camera projects the scene onto an image plane at a distance `f` (the focal length, in pixels) from the eye. The vertical field of view follows from the image height `H`: `tan(v / 2) = H / (2 f)`. The horizontal field of view is wider by the aspect ratio: `tan(h / 2) = aspect * tan(v / 2)`. A narrow field of view, like a long lens, compresses distances, so a corridor looks long and deep and objects keep their proportions. A wide one stretches the edges and exaggerates depth.
>
> A photograph's focal length can be recovered from vanishing points. Parallel lines in the scene meet at one point on the horizon. Lines running at 45 degrees to the camera's view direction meet at points one focal length to either side of the central vanishing point, because `tan(45 deg) = 1`.

The herringbone planks in the reference run at exactly 45 degrees to the corridor, so the distance in the image between the corridor's vanishing point and the planks' two vanishing points is `f`. That gives a vertical field of view of about 35 degrees (59 horizontal). Mine was 58 vertical, which is 89 horizontal and looks like a fisheye in comparison.

I chose 46 degrees vertical, about 74 horizontal. It is much closer to the reference's long, compressed view and still comfortable to walk around in. The eye height was also wrong. My camera was at 1.83 m in a 3.3 m room. In the reference the horizon sits about 60% of the way up a 2.7 m room, so the eye is now at 1.62 m.

![The same view at three fields of view](/images/2026-09-30-final-look-and-fixes/fov.jpg "The start view at 36, 46 and 58 degrees vertical. The reference measures about 35. The game now uses 46.")

## Contact shadows

My shadow maps are low-resolution depth images rendered from a light, and they cover only the nearest few lights. They cannot resolve the sconce's arm against the wall, a frame's edge or a table's legs, and most lamps have no map at all.

> **Background: Screen-space contact shadows.** For each pixel, start at its surface point and step a short distance toward the light. At each step, project the position into the depth buffer and compare it with the stored depth. If the ray is *behind* the stored surface, something between the point and the light blocks it, and the pixel is darkened. The method uses only data the frame already has, so it needs no extra rendering, and it catches small, close occluders that a shadow map blurs away.
>
> It has built-in limits. The depth buffer is a height field: it has the front of an object but not its back, so the march needs an assumed *thickness* beyond which a stored surface no longer blocks. It cannot see occluders that are off screen or hidden. A ray that starts exactly on the surface can hit that surface because of depth precision, which gives noisy self-shadowing, so the start is offset and a depth bias is applied. Each step costs a depth read per pixel and per light, so a short ray with few steps is what makes it affordable. The ray's samples are usually jittered per pixel and per frame so that temporal anti-aliasing can average the banding away.

![Contact shadow march](/images/2026-09-30-final-look-and-fixes/contact-shadow-march.svg "From P, six samples step toward the light through the depth buffer. The second one lies behind the sconce arm, so P is shadowed.")

My version marches 12 cm toward the light with 6 samples, treats a depth-buffer surface as 5 cm thick, starts 4 mm off the surface along its geometric normal (plus 2 mm per metre of view depth), and darkens by `strength * (1 - t*t)` where `t` is the fraction of the way along the ray. The fade is a cheap stand-in for the way a shadow's edge softens with distance from the occluder. The ray is also limited to half the distance to the light, so a lamp's own glass never shadows the wall around it.

Making it affordable took three attempts:

| Version | Cost at 1440p |
|---|---|
| Every light at every pixel, in the scene shader | +1.53 ms |
| Only the strongest light, still per pixel | +0.28–0.34 ms |
| A half-resolution compute pass, upsampled by depth in the scene pass | 0.16 ms (0.10 for the pass) |

The second version also failed to improve when I unrolled the loads or used half-resolution depth. The final pass is built like my ambient occlusion pass. Each half-resolution texel picks the light that lights it most, marches toward it and stores the visibility with that light's index. The scene pass upsamples it with depth-aware weights and darkens only that light. Darkening one light per pixel is an approximation. Marching every light cost ten times as much for little visible difference.

![Contact shadows off and on](/images/2026-09-30-final-look-and-fixes/contact-shadows.jpg "Off on the left, on the right. The sconce's arm and scroll now shadow the wall and the frame's edge darkens the plaster. The yellow shadow-visibility view shows the new occlusion in purple.")

## The look pass

I compared the start view with both of my references using brightness statistics. The first reference is dark (median about 0.05) and the second bright (about 0.12). I set exposure compensation to -1.8 EV, between them, halved the fog density and dust because the grey veil flattened everything while the references are clear, made the floor lacquer glossier, and warmed the grade. The median came out at 0.098.

The comparison also showed what settings cannot fix. The 95th percentile is 0.31 against 0.43–0.45, the ceiling band is 0.12 against 0.23, and the floor stays dark whatever I do. The cause is the shape of my room. The corridor is about 2.7 m wide and 3.3 m tall, while the reference's is about 1.5 m by 2.7 m. My lamps are 2 m up the wall, a long way from the middle of the floor and from the ceiling, and auto-exposure evens out whatever the settings change. The next large step is architecture, a narrower and lower corridor.

![The game's first frame after the look pass](/images/2026-09-30-final-look-and-fixes/game-start.jpg "The first frame of the game: warmer, clearer air and a window at the end of the hall. The room is still too wide and too tall.")

## Close-up fixes

Walking up to a lamp, I found three problems. I took each apart in a debug view before changing anything.

**Grainy, smeared shadows under the sconces.** The contact shadow drew the scroll's shadow as a streak about 40 cm down the wall, grainy and jumping. The march started from the normal-mapped normal, so on bumpy plaster each ray set off from a slightly different place. A 30 cm ray is also far too long for a contact shadow, and the 12 cm opal globe would soften the real shadow almost away. The pass now rebuilds the surface's flat normal from the depth of its neighbours and reaches 12 cm.

**Walls that looked wet.** The roughness view showed the plaster was already almost fully rough, so it was not gloss. The cause was its strong normal map. Lit from a lamp a few centimetres away at a grazing angle, every bump caught a bright highlight. Turning off the reflection probes changed almost nothing, and halving the normal strength removed the wet look. The plaster's normal strength is now 0.55.

**Streaks on the floor.** The roughness view showed them to be the floor-wear decals. Their noise was stretched ten times along the lane, so on the glossier floor it became lines running down the hall. The decal is now soft, isotropic dulling.

![Lamp, wall and floor before and after](/images/2026-09-30-final-look-and-fixes/look-fixes.jpg "Before on the left, after on the right: the sconce's shadow, the wet look of the wall and the streaked floor.")

## Hunting an editor hitch

Moving around the editor viewport felt uneven again after these changes, yet the per-second numbers looked fine. In Release the frame took about 1.8 ms and 95% of frames were under 2 ms. That is how averages hide the problem. A single 60 ms frame every few seconds hardly moves a mean, and it is exactly what a person notices. In a few one-second windows the mean was *higher* than the 95th percentile, which can only happen when a few frames are far slower than the rest.

> **Background: Finding spikes with a frame profiler.** A summary statistic over a window cannot name a cause. To find a spike I need, for every frame, the time of each named part of its work, and a rule that decides which frames count as spikes. The rule has to adapt. A fixed threshold either misses short stalls in a fast Release build or fires constantly in a slow Debug build. A good rule compares each frame with the *typical* frame, measured only from the frames that were not spikes, so a run of stalls does not raise the bar.

The editor now splits every frame into named parts (`models.validation`, `models.log`, `ui`, `render` and so on). A frame is a hitch when its CPU work exceeds `max(20 ms, 3 x typical)`. The typical frame is a moving average of non-hitch frames, the first 30 frames are ignored because they load the scene, and at most one hitch line is logged every two seconds so the log, which the editor itself watches, is not flooded. Flying in the Debug editor it logged this every few seconds:

```text
Editor hitch: 62.4 ms (typical 7.0 ms): models.validation 44.6, models.log 10.5, ...
```

Three things were feeding each other:

1. The editor writes timing lines to the log file every five seconds.
2. The Console noticed the file had changed and re-read all of it. That file is shared by the game, the editor and the tests, and every run appends to it, so the re-read got slower the more I ran the engine. That is why the stutter seemed to return whenever I tweaked something.
3. A log change also rebuilt the whole validation model, although only one check reads the log. That check built the full Inspector, every formatted field, for all 283 entities just to count its sections. It was 41 of the 44 ms.

Now the Console reads only what was appended since it last looked. A log change updates only the log check. The Inspector check counts from the component schema and the scene's component lists. In a Debug build the worst frame while flying fell from 58–66 ms to 7–8 ms, and the validation rebuild from 44 ms to 5–7 ms.

![The Console reporting the worst frame each second](/images/2026-09-30-final-look-and-fixes/console-worst-frame.jpg "With timing logged every second: each line gives the worst frame and what it was made of.")

To keep it fixed, the hitch log is always on. `CCEditor --smoothness-check` does what a person does: it flies the camera up and down the corridor while turning, edits a light and undoes it every 45 frames, and writes the log every second, for 1,500 frames. It exits with an error if the editor hitches, and my validation script runs it every time. With the old code put back for one build, it failed with 32 hitches, each naming the 44 ms validation rebuild.

The next day the check itself failed in 2 of 5 validation runs, then passed when I reran it unchanged. An edit frame already does about 16 ms of work against a hitch threshold of about 22 ms, so a 7 ms spike from outside the editor tipped it over. It also counted two hitches but logged one, because of the rate limit, so it could not explain itself. I could not reproduce it in 14 deliberate runs, so I treated it as a rare external spike. I did remove one suspect: the .NET build tool left a build server running after each C# build, right when validation starts timing frames. Builds now run with `--disable-build-servers`. The check forgives two one-off spikes, because a stall the editor causes repeats with every edit (about 33 per run) or every log write (about 12), and it lists every hitch it counted with the stage that took the time. An injected 30 ms stall on each edit still failed it with 17 hitches, and three full validation runs in a row passed with none.

## A quieter door prompt

Looking at a door put a pale dot the size of a coin at the centre of the screen and a large pulsing **E** box near the bottom, about a ninth of the screen tall. It was drawn inside the post-processing shader from rectangles, so it could not show words, and the door's own description only reached the log.

The HUD is now drawn with my UI library after the image is finished, so it picks up no grain, bloom or grading. Looking at something usable shows a 4-pixel dot and, just under it, one short line such as `[E] Open` or `[E] Try the door`, with the key drawn as a thin outline in a light 15 px face with a soft shadow. After trying a locked door, "It's locked." fades in low on the screen for two seconds. Everything fades in over 0.15 s and out over 0.25 s and nothing pulses. It scales with the window height, so it is the same size at 1080p and 1440p. A small model holds the prompt, the message and their fades, and its style is scene data, so notes, item inspection and subtitles can use it later. The benchmark leaves it out and the frame time did not change.

![The door prompt before and after](/images/2026-09-30-final-look-and-fixes/hud-before-after.jpg "Left: the old dot and glowing E box. Right: the new prompt and the locked message.")

## Results and open issues

The look pass is as far as settings can take it, and the room's proportions are the main difference left. A sconce's globe still looks like a flat off-white disc up close, because it sits at the top of the tone curve and raising its emission six times changed nothing visible. In the door close-ups the wood grain looks wavy, which is a job for a later materials pass.
