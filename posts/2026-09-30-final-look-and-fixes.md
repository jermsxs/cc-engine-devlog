---
title: The camera, contact shadows and a hunt for hitches
date: 2026-09-30
order: 2
summary: I measured the camera from the reference, added contact shadows, fixed close-up problems, found a rare editor stutter, and started a proper HUD.
tags: renderer, lighting, performance
cover: /images/2026-09-30-final-look-and-fixes/look-fixes.jpg
---

The last step on my list for the look was the camera and the final grade. After it, I spent the rest of the day on things I noticed when walking up close to walls, on an editor stutter that had come back, and on the door prompt, which I had never liked.

## Measuring the camera

My plan said "a wider field of view". The reference said the opposite.

How do you measure a field of view from a photograph? The herringbone planks in the reference run at exactly 45 degrees to the corridor. Lines on the floor at 45 degrees meet the horizon at points one *focal length* to either side of the corridor's own vanishing point. Measure those distances in the image and you get the focal length, and therefore the field of view. It comes out at about 35 degrees vertical (59 horizontal). Mine was 58 vertical, which is 89 horizontal, a fisheye by comparison.

I chose 46 degrees vertical, about 74 horizontal. It is far closer to the reference's long, compressed view and still comfortable to walk around in. The eye height was also wrong. My camera sat at 1.83 m in a 3.3 m room. In the reference, the horizon sits about 60% of the way up a 2.7 m room, so the eye is now at 1.62 m.

![The same view at three fields of view](/images/2026-09-30-final-look-and-fixes/fov.jpg "The start view at 36, 46 and 58 degrees vertical. The reference measures about 35. The game now uses 46.")

## Contact shadows

Shadow maps are low resolution pictures, so they cannot resolve a sconce's arm against the wall, a frame's edge or a table's legs. Most of the lamps have no shadow map at all, since the shadow maps only cover the nearest few lights.

> **Concept: Contact shadows.** For each pixel, march a very short ray from the surface toward the light, stepping through the depth buffer. If the depth buffer shows something in the way, the pixel is darkened. The ray is short (here 12 cm), so it only catches the small, close-up shadows that a shadow map misses. It is cheap, because it needs no extra rendering.

Making it affordable took three tries.

| Version | Cost at 1440p |
|---|---|
| Every light at every pixel, in the scene shader | +1.53 ms |
| Only the strongest light, still per pixel | +0.28–0.34 ms |
| A half-resolution compute pass, upsampled by depth | 0.16 ms (0.10 for the pass) |

The final pass works like my ambient occlusion pass. Each half-resolution texel picks the strongest light that reaches it, marches toward it, and stores the result together with the light's index. The scene pass darkens only that light. The march is jittered per pixel and frame so the temporal anti-aliasing smooths it out.

![Contact shadows off and on](/images/2026-09-30-final-look-and-fixes/contact-shadows.jpg "Off (left) and on (right). The sconce's arm and scroll now shadow the wall, the frame's edge darkens the plaster, and the shadow-visibility view (yellow) shows them in purple.")

## The look against the reference

I compared the start view to both of my references using brightness statistics: median brightness, how dark the darkest 5% of pixels are, and saturation. The first reference is quite dark (median about 0.05) and the second quite bright (about 0.12). I put the exposure between them, thinned the fog by half (the grey veil was flattening everything, while the references are clear), made the floor lacquer glossier, and warmed the colour grade. The median came out at 0.098.

The comparison also showed what settings cannot fix. My highlights are still low, the ceiling is too dark, and the floor stays dark whatever I do. The reason is the room's shape. My corridor is about 2.7 m wide and 3.3 m tall, while the reference's is about 1.5 m by 2.7 m. The lamps are two metres up the wall, a long way from the middle of the floor and from the ceiling, and auto-exposure evens out whatever the settings change. The next big step toward the reference is architecture: a narrower, lower corridor.

![The game's first frame after the look pass](/images/2026-09-30-final-look-and-fixes/game-start.jpg "The first frame of the game: warmer, clearer air, a window at the end of the hall. The room is still too wide and too tall.")

## Close-up fixes

Walking right up to a lamp, I spotted three problems. I took each apart in a debug view before changing anything.

**Grainy, smeared shadows under the sconces.** The contact shadows drew the scroll's shadow as a 40 cm streak down the wall, grainy and jumping. The march started from the normal-mapped normal, so on bumpy plaster every ray set off in a slightly different place. And 30 cm is a long way for something called a contact shadow. The pass now rebuilds the surface's flat normal from the depth of neighbouring pixels, and reaches 12 cm.

**Walls that looked wet.** The roughness view showed the plaster was already almost fully rough, so it was not gloss. The cause was its strong normal map. Lit from a lamp a few centimetres away at a grazing angle, every bump caught a bright highlight. Switching the reflection probes off changed almost nothing, but halving the normal map strength took the wet look away.

**Streaks on the floor.** The roughness view showed them to be the floor-wear decals. Their noise was stretched ten times along the lane, so on the glossier floor it became lines running down the hall. The decal is now soft, even dulling.

![Lamp, wall and floor before and after](/images/2026-09-30-final-look-and-fixes/look-fixes.jpg "Before on the left, after on the right: the sconce's shadow, the wall's wet look, and the streaked floor.")

## The editor stutters again

Moving around the editor viewport felt uneven again after the day's changes, yet the per-second numbers looked fine: about 1.8 ms a frame in Release, with 95% of frames under 2 ms. That is exactly how averages hide the problem. A single 60 ms frame every few seconds does not move an average much, but you feel it.

> **Note: Averages hide hitches.** If you want to find stutter, look at the *worst* frame, not the mean. In a few one-second windows the average was *higher* than the 95th percentile, which only happens when a handful of frames are far slower than the rest.

So I made the editor split every frame into named parts, and log any frame that stalls, with the parts that took the time. The log said `models.validation 44.6, models.log 10.5` every few seconds. There were three causes, feeding each other:

1. The editor writes its timing lines to the log file every few seconds.
2. The Console noticed the file changed and *re-read the whole file*. The file is shared by the game, the editor and the tests, and every run appends to it, so the re-read got slower the more I ran the engine. This is why the stutter seemed to come back whenever I tweaked something.
3. A log change also rebuilt the entire validation model, though only one check reads the log. That check built the full Inspector for all 283 entities just to count its sections.

Now the Console reads only what was appended since it last looked, a log change updates only the log check, and the Inspector check counts from the schema. In a Debug build the worst frame fell from 58–66 ms to 7–8 ms, and the validation rebuild from 44 ms to 5–7 ms.

To keep it fixed, the hitch log is always on, and the editor has a `--smoothness-check` mode. It does what a person does: flies the camera up and down the corridor, turns, edits a light and undoes it every 45 frames. It exits with an error if the editor hitches. My validation script runs it every time, so a stutter now fails validation like a broken test. With the old slow code put back for one build, it failed with 32 hitches, each one naming the 44 ms validation rebuild.

![The Console showing the worst frame of every second](/images/2026-09-30-final-look-and-fixes/console-worst-frame.jpg "Each second: the worst frame and what it was made of.")

### The check that cried wolf

The next day, the check itself failed in 2 of 5 validation runs, then passed when I reran it with nothing changed. The check edits a light every 45 frames, and an edit frame already does about 16 ms of work against a hitch threshold of about 22 ms, so a 7 ms spike from outside the editor tipped it over. Worse, it counted two hitches but logged one, because hitch lines are rate limited so the Console does not flood, so it could not explain itself.

I could not reproduce it in 14 deliberate runs, so it was a rare external spike. One suspect I removed anyway: the .NET build tool left a build server running after each C# build, right when validation starts timing frames. Now the check forgives two one-off spikes (a real stall repeats on every edit, about 33 times a run, so it still fails by a wide margin), lists every hitch it counted, and names the renderer stage that spiked. An injected 30 ms stall still failed it with 17 hitches, and three full runs in a row then passed with none.

## A quieter prompt

The last thing was the door prompt. Looking at a door put a pale dot the size of a coin in the middle of the screen, and a large pulsing **E** box near the bottom, about a ninth of the screen tall. It was drawn inside the post-processing shader from rectangles, so it could not show words.

Now it uses the engine's own UI library, the one the editor uses, after the image is finished, so it picks up no grain, bloom or grading. While you look at something usable there is a 4-pixel dot and, just under it, one short line, like `[E] Open` or `[E] Try the door`. After you try a locked door, "It's locked." fades in low on the screen for two seconds. Nothing pulses. It scales with the window height, so it is the same size at 1080p and 1440p.

![The door prompt before and after](/images/2026-09-30-final-look-and-fixes/hud-before-after.jpg "Left: the old dot and glowing E box. Right: the new prompt and the locked message.")

The HUD is a small model (a prompt, a message and their fades) that notes, item inspection and subtitles can grow into. Its style is scene data. The benchmark leaves it out, and the frame time did not change.

## Where it ended

The look pass is as far as settings can take it. The room's proportions are the main difference left from the reference. Close up, a sconce's globe still looks like a flat off-white disc, because it sits at the top of the tone curve. And in the screenshots of the locked door, its wood grain looks wavy up close, which is a job for a later materials pass.
