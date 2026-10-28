---
title: Mud with depth, leaves that hold still
date: 2026-10-23
order: 1
summary: The path got relief, puddles that pool in the hollows and reflect the canopy, then I fixed flickering distant leaves and made the foliage finer and less uniform.
tags: outdoors, foliage, materials
cover: /images/2026-10-23-ground-and-foliage/game-after-walk.jpg
---

Two more items from my look list for the woods today: item 3, ground detail, and item 4, foliage. In my reference, the path is trampled wet mud with clods, footprints and a puddle of dark muddy water. Mine was a flat, dry, cracked dirt texture with no water at all. And the canopy was too much deep shade with leaves that read as big, uniform cut-outs.

## Ground with depth

I swapped the dry dirt for a real mud scan (Poly Haven's `brown_mud_03`, CC0, 16 MB at 2k), tinted warmer toward the reference's earth and with its roughness raised so it stays matte. But a flat texture, however good, still looks like a picture of mud. Mud needs depth.

> **Concept: Parallax.** A texture is flat, but a *height map* says how far each point sits above or below the surface. Parallax mapping uses it to shift the texture lookup depending on your viewing angle, by walking along the view ray through the height field until it hits the "ground". Clods then really appear to stand up and hide what is behind them, and the effect changes as you move.

The engine already marched a height map, but only the base material's: under the path that was the leaf litter, not the mud. So a layer can now say it has relief. Its own height map joins the march, blended by where the layer lies, so the path has 4 cm clods and the leaves around it keep their shallow relief. Depths are measured against the deepest map, so a material without layer relief marches exactly as before, and the hallway, house and kitchen are image-identical.

Two more touches make the relief readable:

- **Self-shadowing.** In a sun patch, each pixel marches 8 steps toward the sun through the relief, so clods throw small shadows.
- **Longer reach.** Parallax now reaches 14 m in the woods (it was 6), because centimetre clods still read at that distance.

### Puddles that pool

> **Theory: Why water collects.** Water does not lie on a surface like paint. It runs downhill and fills the low points. So a wet patch should be a *water level* through the relief: a faint wetness leaves water only in the lowest spots, and a strong one floods them.

A wet decal on relief now raises a water level through the height field. Standing water is darker and perfectly flat, since a puddle's surface has no clods. Three puddles sit in the terrain's hollows, plus nine faint damp patches along the path. (The terrain mesh had to opt in to receiving decals, since they were only for boxes before.)

![A puddle's first try: pale grey patches on the path](/images/2026-10-23-ground-and-foliage/puddle-pale-first-try.jpg "My first puddles came out pale grey, like patches of frost.")

The first puddles were the wrong colour entirely. A puddle is mostly a mirror, and what mine was mirroring was the probes' light, which over the path is the open sky. The woods had no reflection captures at all. The fix was a low reflection capture right over each puddle, so the water shows the dark canopy with the odd glint of sky.

A first version with seven 8 m capture boxes along the path cost about 0.3 ms, because every pixel inside a box pays for it, leaves included. Each capture now hugs its puddle. Screen-space reflections added almost nothing on top at about 0.4 ms a frame, so they stay off.

![The path before and after relief, with a puddle](/images/2026-10-23-ground-and-foliage/puddle-before-after.jpg "Left: the old flat path. Right: damp mud with relief, and a dark puddle in the hollow.")

![In the game after walking down the path](/images/2026-10-23-ground-and-foliage/game-after-walk.jpg "In the game after a walk: the relief holds steady, with no swimming or shimmer.")

One bug on the way: at first the mud did not show at all. The game reads the material library copied into the build folder, and that copy was stale.

The relief, sun shadow and decals together cost about 0.2 ms. The slowest pose is 6.6 ms on the 4070 (about 13 ms on a 3060-class card). I kept the mud matte even though the reference's is wetter in its ruts, since I dislike shiny ground; only the puddles are glossy.

## Leaves that hold still

Then foliage. The first thing I noticed was something I had seen for a while: distant leaves flickered against the light. It was a rendering problem, not a lighting one, and I had no good way to measure it, so I added a way for the game to save 16 frames in a row. With the wind off, 3.3% of the canopy's pixels changed by more than 24/255 every frame.

Turning things off one by one found it: without anti-aliasing the flicker went away. The leaf-edge dither and the shadow filter's rotation hardly mattered.

> **Concept: TAA history.** Temporal anti-aliasing blends each frame with the previous ones, nudging the camera by a sub-pixel jitter every frame so that, over several frames, it has sampled each pixel at many places. To blend safely it must reject old samples that no longer match, usually by comparing depths.

My TAA threw away a pixel's history whenever last frame's depth there differed from this frame's. But a distant leaf thinner than a pixel covers it on some jitter positions and misses it on others, so the depth at that pixel jumps between 20 metres and infinity (sky). The history was discarded nearly every frame, and every frame showed the raw, aliased result.

The fix: keep the history when last frame's depth lies anywhere within the depth range of the pixel's 3 by 3 neighbourhood. Leaves against the sky keep their history, while a surface that really is new (a door opening) falls outside the range and is rejected. With the wind off, 0.5% of pixels flicker (TAA off gives 0%). With the wind on, it fell from 3.7% to 1.5%, since moving leaves should change a little. Panning in the woods and the house shows no ghosting.

![Per-frame change before and after the TAA fix](/images/2026-10-23-ground-and-foliage/flicker-before-after.jpg "Each pair shows the frame and the per-pixel change between frames. Left: before, with leaves flickering white. Right: after, nearly black.")

### Light through the shade

Against my reference, the canopy was too deep a shade (63% of the top of the image, against 39%) and too contrasty in fine detail (3.15 against 1.28). A leaf already let the sun through from behind. Now it also lets the *ambient* light through: the probes' diffuse light times (1 + transmission). Under a canopy that light comes from every side, so a shaded leaf glows faintly instead of going black. Shade fell from 63% to 50%.

### Finer, and not all alike

The twig card shared by every tree and bush was re-rendered with leaves at 0.6 times their size and 1/0.6 times as many. It covers the same area, but from a distance it reads as foliage and not paper cut-outs.

![The twig card before and after](/images/2026-10-23-ground-and-foliage/twig-card-before-after.jpg "The twig card: two earlier cards on the left, two finer ones on the right.")

Also, no two plants should match. Each tree, sapling and bush now gets its own tint from its name: brightness 82 to 100%, 16% of them yellowing, 6% dead rust-brown, the rest a slight green or yellow shift. It goes through the material's albedo, so instancing still batches them.

![Canopy close-up before and after](/images/2026-10-23-ground-and-foliage/canopy-zoom.jpg "The canopy up close. Left: before. Right: after, with finer leaves and more variation.")

Mean brightness at the path pose went 34.6 to 37.3 (reference 36.7). Grain, TAA sharpening and lens softness account for little of the fine-detail gap (3.15 to 2.51 with all three softened), so I left them. Most of the remaining gap is the reference's denser, smaller leaves in the distance, and its haze. GPU time moved by -0.1 to +0.3 ms, inside the bench's noise.

## Still open

The reference's undergrowth has thin sapling stems and vines between bushes, where mine is bushes and ferns. The far gate view is still half as bright as its reference, which is a light problem, not a foliage one. The canopy's fine contrast is still about 2.7 times the reference's; distant tree LODs, or haze, would soften it. And there are no ground decals for leaf drifts or footprints, because no CC0 scans exist for them in my atlas yet.
