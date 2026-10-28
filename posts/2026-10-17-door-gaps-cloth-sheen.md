---
title: Door gaps, matte furniture and a sheen model for velvet
date: 2026-10-17
order: 1
summary: Three causes of light around closed doors, matte finishes for old furniture, a cloth sheen BRDF for velvet, and three collision faults found by a throw test.
tags: lighting, materials, physics
cover: /images/2026-10-17-door-gaps-cloth-sheen/armchair-flashlight.jpg
---

The previous day's leak fixes removed most of the light passing through walls. Playing the house again, I saw two more problems. Light still showed along the sides of closed doors, and the furniture had a hard, glossy look under the lamps, as if it had just been lacquered. Neither belongs in a decayed house. This post covers both, then the velvet that the matte change left looking like smooth painted cloth, and a short section on props leaving the map.

## Light around closed doors

I used the same method as the day before. I switched the room off, froze the camera on its closed door and boosted the image eight times so that anything faint shows. Counting pixels above a low threshold gave me a number to reduce. Around the parlor door there were 9,465 of them. Three separate causes were stacked on top of each other.

### Cause one: a slot through the wall

The door frame's opening is 4 cm wider than the leaf, which leaves a 2 cm gap on each side. The stops that the closed leaf rests against were 12 mm wide, so 8 mm of clear air remained beside and above every closed door. A carpenter's stop overlaps the leaf. Mine now reach 1 cm behind the leaf's edges. The lines of light did not go away, so this was not the whole explanation.

### Cause two: the corridor lamps lit the inside of the gap

The stops sit on the corridor side. From inside a room you still look down a 2 cm channel to the stop. The corridor lamps' light boxes ended 1 cm inside the 8 cm wall, and their 3.2 cm fade carried light 4.2 cm in, which lit the far half of the jamb and the leaf edge in the channel. The fitting tools now end a light's fade a fifth of the way into the wall, 1 to 1.6 cm here, which is before a closed door's stop at 1.75 cm. The corridor lamps are fitted to the wall faces with no padding. The thin lines went, but a soft glow remained on the casing beside the hinge.

### Cause three: the lightmap

An ambient-only view showed that the remaining glow was baked light.

> **Background: texel density and thin surfaces.** A lightmap is a texture laid over the surfaces, and its pixels are called texels. Each texel stores the light at one position, and the renderer interpolates between texels. A feature of the light can only be represented if the texels are denser than the feature. This is the sampling rule that applies to any signal: at least two samples across the smallest variation you want to keep. Thin geometry such as a door lining or a moulding is narrower than a coarse texel, so it gets very few samples, and each sample can be dominated by whatever light happens to reach it.

The house's lightmaps use 10 texels per metre, so one texel is 10 cm. The inside lining of the door frame runs 8.8 cm through the wall. Its chart had two texels across: one on its corridor edge and the next 1.2 cm past its room edge. Every point on the face was a blend of those two samples, and the corridor edge's sample carried the corridor lamps' light. The corridor's light covered the whole face and bled onto the casing next to it.

![The casing beside the hinge with the corridor circuit's baked light in red](/images/2026-10-17-door-gaps-cloth-sheen/door-casing-bake-glow.jpg "A debug view of the casing beside the hinge. The red is the corridor circuit's baked light, coming from the lining's single corridor-edge texel.")

The rule I added is that any chart axis narrower than two texels gets three, on its two edges and in its middle, using a per-axis density on each chart. The middle sample means the face reads light from its centre rather than from one edge. The rule applies to every thin face of every glTF, including trim edges, frame mouldings and stops. The house's lightmap grew about 10%, from 18.1 to 19.9 MB, and the hallway's from 348 thousand to 391 thousand texels.

### Results

With the parlor dark, the flashlight off and the image boosted eight times, the pixels brighter than 4/255 around the door fell from 9,465 to 316. With every circuit off the scene has 264, so the rest is noise. The 99.9th percentile fell from 31 to 3. The dining room's door shows zero pixels. The corridor side of the parlor door, with the corridor dark and the parlor lit, is unchanged at the floor. GPU time moved by +0.3% to +3% per bench pose, 0.01 to 0.04 ms.

![Light around the closed parlor door before and after](/images/2026-10-17-door-gaps-cloth-sheen/door-gap-before-after.jpg "The parlor door from inside with the room dark and the image boosted eight times. Before (left): thin lines of light along the door's edges. After (right): none.")

## Furniture that did not look old

The shine on the furniture was real. When I made the furniture I gave the mahogany a roughness between 0.32 and 0.72, a varnished finish. At a low angle the dining lamp drew a lacquer streak across the table top. The week before I had checked only the walls, at 0.94, and not the furniture.

> **Background: roughness, GGX and Fresnel.** In physically based rendering a surface's specular reflection comes from microscopic facets. Roughness describes how widely their normals scatter. My shader converts perceptual roughness to `alpha = roughness^2` and uses the GGX distribution, `D = alpha^2 / (pi * ((n.h)^2 * (alpha^2 - 1) + 1)^2)`, where `h` is the vector halfway between the view and the light. `D` is largest when `h` equals the surface normal. Its peak value is `1 / (pi * alpha^2)`, which is about 30 at roughness 0.32 and about 0.5 at roughness 0.9. A rough surface spreads the same light over a much wider range of angles, so the highlight is wide and dim. The Fresnel term, Schlick's approximation `F = F0 + (1 - F0)(1 - v.h)^5`, rises towards 1 at grazing angles for every material. A low lamp, a table top and a viewer at table height are the grazing case. A moderately rough finish still produces a long bright streak there.

I made the old finishes dull, as an old house's would be.

| Material | Roughness |
|---|---|
| Mahogany | 0.72 to 0.94 |
| Velvet | 0.88 to 0.96 (was 0.70 to 0.90) |
| Door wood | 0.68 to 0.92 (was 0.42 to 0.75) |
| Painted trim | 0.72 to 0.92 |
| Picture-frame wood | 0.70 to 0.88 |
| Cot and kitchen paint | 0.78 to 0.88 |

The bath's enamel, the mirror and the brass stay glossy, since that is what they are. This is a preference I intend to keep. I do not want showroom surfaces in this engine.

![The dining table with the lamp lit, before and after](/images/2026-10-17-door-gaps-cloth-sheen/table-sheen-before-after.jpg "The dining table from table height with the lamp lit. Left: a varnish sheen across the top. Right: matte.")

From above under the flashlight, the brightest highlight on the table top fell from 207 to 190 at the 99.5th percentile.
## A sheen model for velvet

With the furniture matte, the velvet armchairs read as smooth painted cloth. Velvet does not behave like a varnished surface.

### The phenomenon

Velvet, and to a lesser degree linen and wool, has short fibres that stand up from the weave. Looking straight at it, you see down between the fibres into shadow, so the surface reads dark. At the edges and folds you look across the sides of the fibres, which catch the light, and the surface reads lighter. The effect is a pale rim around the silhouette with no highlight. Fibres standing steeply out of the surface scatter light back towards the direction it came from, and the area of fibre side that faces the viewer grows at grazing angles. The effect is strongest when both the light and the viewer are at grazing angles.

### The model

A normal specular lobe peaks when the half vector `h` equals the normal, which is a mirror-like geometry. A cloth lobe must peak the other way. The glTF extension `KHR_materials_sheen` specifies the Charlie distribution from Estevez and Kulla (2017), whose shape is inverted compared with GGX:

```hlsl
D_Charlie = (2 + 1/alpha) * pow(sin(theta_h), 1/alpha) / (2*pi)   // alpha = roughness^2
```

Here `theta_h` is the angle between `h` and the normal. The term is zero when `h` equals the normal and largest when `h` lies in the surface plane, which happens when the view and the light are both near grazing. A smaller roughness makes the lobe narrower. A fitted visibility function replaces the usual shadowing term. The five coefficients of its exponent are fitted at the two extremes of roughness and blended between them.

The sheen is a layer on top of the base material. The layer takes some of the light, so the base must give that light up, or the cloth would reflect more than it receives. The shader scales the base by `1 - max(sheenColor) * albedo(NoV)`, where `albedo` is the fraction of light the white sheen lobe reflects from a given view angle. I use a polynomial and exponential fit of that integrated value, valid for roughness 0.2 to 1. The same albedo lets ambient light light the sheen, which keeps the rim visible on cloth in a dark room.

The input is two numbers from the model file, `sheenColorFactor` and `sheenRoughnessFactor`. Blender exports the same extension, so cloth modelled there carries over. Materials without sheen skip the code. The code lives in its own include, `Sheen.hlsli`, because the scene shader has a 400-line budget, and the Model Viewer uses the same shading.

My first values were too strong. Under the flashlight they washed the whole armchair pink, including the faces turned toward me. I halved the colour and narrowed the velvet's lobe from roughness 0.45 to 0.35 so that the change sits at the edges.

| Cloth | Sheen colour | Sheen roughness |
|---|---|---|
| Velvet (armchairs, chair seats) | 0.15, 0.065, 0.045 | 0.35 |
| Linen (sheets, pillows, kitchen curtain) | 0.05 | 0.6 |
| Wool blanket | 0.035 to 0.04 | 0.7 |

### Results

`BrdfTests` checks the model. The fitted albedo is within 0.035 of a numerically integrated lobe at roughness 0.2 to 1 and five view angles. A white surface under a white sheen reflects at most 1.06, which is the base BRDF's own fit error. The lobe is reciprocal, and it reflects more than four times as much near grazing as near head-on.

![A velvet armchair under the flashlight, before and after](/images/2026-10-17-door-gaps-cloth-sheen/armchair-flashlight.jpg "The master bedroom armchair under the flashlight. Left: smooth cloth. Right: the same chair with a faint pale rim along its edges and arms.")

A difference map, after minus before and boosted six times, shows where the change landed. It is smallest on the back facing the camera and largest along the silhouette and the arm tops. Under the flashlight the chair's mean brightness rose by 2.1/255.

![The sheen's contribution as a difference map](/images/2026-10-17-door-gaps-cloth-sheen/sheen-difference.jpg "After minus before, boosted six times. The change is dark on faces that look at the camera and bright along the edges.")

Under the room's own lamp the change is very small, a mean of 0.07/255. The lamp is behind and above the chair, so the faces I see are lit almost head-on, where velvet barely shows sheen. The bed changes little too, because linen and wool are faint by design. This is a subtle effect, and I am keeping it that way.

## Switches checked, and props that stayed in the house

In play, the hall light switch did not seem to turn the hall lights off. I could not reproduce it. A real press of the corridor switch puts out all twelve lamps with their globes and bounce light, and the same press in the editor's Play mode flips the toggle and prompt. A new test aims at every switch from 0.6 to 2 m away and up to 60 degrees off its face, and each one takes the interaction focus. The corridor switch and the foyer switch sit back to back at the foyer doorway, and the foyer one runs only the foyer lamp. That is the likely mix-up, but I have not confirmed which switch it was.

In play I also saw a thrown ball leave the map at a wall or corner. I wrote a test that throws six props, a ball, tin, mug, bottle, book and crate, from 11 places on both floors in 24 directions at three pitches, at 12 m/s and at 7 m/s while spinning. It fails if a prop's centre crosses a solid surface between frames or if a prop ends outside the house. That is 1,584 throws per prop and 9,504 in total. It found three faults.

> **Background: tunnelling and discrete contacts.** My physics steps at 1/60 s and finds contacts once per step. A fast or fast-spinning body can move through a thin obstacle between two steps, which is called tunnelling. The collision test between boxes uses a set of separating axes, including the cross products of pairs of edges. If two edges are nearly parallel, the cross product is close to zero and mostly rounding error, so the axis can wrongly report that the shapes are apart.

1. **Tins and bottles through walls.** When a tilted cylinder touched a wall, the contact code kept only the nearest point, so a spinning tin pivoted on it and its far end swung through an 8 cm wall. It now keeps both ends of the line along its side. In an isolated test, 6 of 30 tins and 21 of 30 bottles went through before the fix, and none after.
2. **A book sinking through the floor.** A book lying flat had edges almost exactly parallel to the floor's, and on one frame the edge-cross axis said the shapes were apart. Edge pairs within about 0.06 degrees of parallel are now skipped, because the face tests cover them.
3. **A book spinning through the stair rail.** A book tumbling at about 30 rad/s turned almost 30 degrees between contact checks and passed through a 6 cm handrail. As a last guard, if a body's centre would have crossed a static surface during a step, it goes back to where it was, loses its speed into that surface and half its spin. In the house the guard acts in 13 of the 9,504 throws, so the contacts do the real work. The test fails if it acts in more than 1%.

## Results and open items

The doors are sealed against light, the furniture reads as old, and the velvet has a rim. Each change passed the full test suite (98 to 99 tests, in Release and in Debug) and the validation script. Open items:

- A closed door still leaves a 2 mm gap over its threshold, so a lit corridor shows a hairline under it. That is realistic, and I may close it later.
- The sheen is deliberately faint. If the velvet should read more strongly, I raise `VELVET_SHEEN` in the furniture script, regenerate and rebake.
- Rect lights add no sheen, sheen textures are not read, and library materials have no sheen field yet.
- The hallway scene still has the old fades. I will refit its lamps with `light_fit_bounds` the next time I work on it.
