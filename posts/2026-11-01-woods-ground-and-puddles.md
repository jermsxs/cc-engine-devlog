---
title: Dry ground, stones and puddles that read as water
date: 2026-11-01
order: 3
summary: I remove the wet film that greyed the woods path, scatter stones along it, and find why the puddles looked like pale blobs instead of water that reflects.
tags: materials, outdoors, renderer
cover: /images/2026-11-01-woods-ground-and-puddles/after-close.jpg
---

After the walled path was in place, I compared the woods to my reference frames again and listed what separated them. The ground came first. In the references the path is dark brown earth with mossy stones, and in my scene it was a pale grey ribbon. The puddles on it were the second problem: they looked like pale blobs with the leaf litter showing through, where in the references water lies dark in the path and mirrors the trees. This entry covers the two fixes in the order I made them: dry earth with stones, then puddles that behave like water.

## Why the path was grey

The brightness of the ground was close to the reference. The colour was not. I measured the reference 4 pose with the editor flashlight off.

| | Mean luma | Saturation |
|---|---|---|
| Reference | 0.176 | 0.354 |
| Before | 0.202 | 0.315 |

The cause was a setting left over from the weather work. The day woods still had `rain.wetness` at 0.6.

> **Background: what a wet film does to a surface.** Water on a porous surface such as earth does two things. It fills the gaps between grains and reduces the light that scatters back out of the surface, so the colour gets darker and more saturated. It also lays a thin smooth layer on top, which reflects the environment like a weak mirror. A real-time renderer models both. The albedo is darkened, and the roughness is lowered, so that the specular reflection becomes sharper and stronger. The reflection comes from the environment around the surface, in my engine from the reflection probes and from the sky.

That last step is where the path went wrong. A reflection probe stores the light arriving from all directions at one point. For a rough surface the specular lookup falls back to the irradiance around the surface normal, which is a blurred average of everything above the surface. Over the path the normal points up, and straight up is open sky. The wet film therefore added a pale sky-coloured sheen on top of the darkened earth. The mud lost its own colour under that sheen and read like concrete. The overall brightness hardly changed, which is why the mean luma looked fine and the image still looked wrong.

I first tried to fix this in the renderer. Instead of sampling the irradiance around the normal, I sampled it toward the reflected direction, which needed a new probe slot and a blend toward the dominant direction. It made the path 2.5% darker and no more. That is too little for the added complexity, so I reverted it and kept the renderer as it was.

The scene was the real problem. With `rain.wetness` set to 0 through the editor, the earth shows its own brown. The colour now matches the reference closely: saturation is 0.343 against 0.354, and the bottom third of the frame is 0.385 against 0.396. Brightness is still not right. The ground measures 0.208 mean luma against 0.176, and it is too even. It needs patches of sun and shade, which is a separate item.

## Stones along the path

The references also have stones along and partly on the path. I added them as a second scatter layer under the path, `pathScatter`, built in the editor with the path tool. It uses six rock templates, from 1 m outside the path edge to 0.5 m inside it, so some stones sit on the path. The density is 0.5 per square metre with at least 0.35 m between stones. Scale runs from 0.6 to 1.4 and each stone is sunk 3 cm into the ground, so it reads as part of the surface and not as an object lying on top of it. Rebuild Paths placed 316 stones, and I rebaked the lighting. The light change was 0%.

The stones cost nothing I could measure. The 1440p bench over 12 woods poses moved between -2.8% and +1.5%, which is within noise.

## How layered ground is combined

> **Background: blending layers on terrain.** A ground surface is rarely one material. Real earth has bare soil, leaf litter, moss, gravel and water, and the amount of each changes across a few centimetres. Renderers usually keep each layer as its own set of values (albedo, normal, roughness) and blend them with a weight per pixel. The weight can come from a painted mask on the terrain, from a decal projected onto it, or from the surface height, so that the lower hollows fill with mud or water first. Blending has to treat each channel differently. Albedo mixes linearly, roughness mixes linearly toward the layer's own value, and normals must be mixed as vectors and renormalised. Mixing all of them with one weight is what makes the transitions look physical, because a puddle's edge changes colour, gloss and surface angle together.

In my engine, standing water is one such layer. A wet decal supplies a water amount, which is the decal's coverage multiplied by its opacity, raised the way the shader raises it so that the water settles into the lowest part of the relief. That amount then blends the pixel toward water. The roughness goes to a water value of 0.06, the albedo goes toward a dark mud brown, and the normal turns toward the flat geometric normal, because water lies level whatever the mud under it looks like. The stones are different. They are ordinary meshes placed by a scatter layer, so they are not blended into the surface at all, and the 3 cm sink is what hides the seam.

## Why the puddles looked like blobs

With the ground fixed, the puddles were the next visible fault. I traced three separate causes, one at a time.

### The probes were somewhere else

The woods had six reflection probes, placed for the first six puddles, in boxes 3 to 4 m across. The path tool had since scattered 17 puddles, and they lay outside every box. A smooth surface outside all probes falls back to the irradiance around its normal, which over the path is open sky. That gave a uniform cream sheen, which is the grey I had seen. Debug view 17 showed it on every puddle.

> **Background: how water reflects.** The strength of a reflection depends on the viewing angle through the Fresnel effect. Looking straight down at water, only about 2% of the light is reflected and the rest enters the water, so you see the bottom. Looking along the surface at a grazing angle, nearly all of it is reflected and the water becomes a mirror. A common approximation is Schlick's: `F = F0 + (1 - F0) * (1 - cos(theta))^5`, where `F0` is the head-on reflectance and `theta` is the angle between the view direction and the normal. For water the refractive index is 1.33, which gives an `F0` of about 0.02.
>
> A renderer then has to supply what the mirror shows. There are two common sources, and each fails somewhere. A **reflection probe** is a cube map captured from a point in the scene. Looking it up is cheap and it can show anything the capture saw, but it is captured from one position, so reflections of nearby objects are wrong in position and parallax unless the probe is placed close to the surface. **Screen-space reflections** (SSR) march a ray through the depth buffer from each pixel in the reflected direction and use whatever the screen shows at the hit. They are exact for what is visible and track the real geometry, but they cannot show anything that is off screen or hidden behind another object. A ray that leaves the screen finds nothing and has to fall back to a probe. Low, grazing views are the hard case for both, because the rays travel far across the screen.

For standing water, probes are the main source and need to be near the water.

### SSR never traced the puddles

SSR reads the roughness stored by the depth prepass and only traces pixels below a cut-off. The woods' cut-off is 0.12. The prepass has no relief, so a decal's water there stopped at its opacity of 0.85, and the stored roughness came out about 0.2, above the cut-off. In the lit pass the relief floods the puddle and the roughness is 0.06. So the pass that decided what to trace and the pass that shaded the pixel disagreed. I confirmed this with a temporary debug colour in the composite, with the cut-off raised: the rays did hit, and I reverted the test.

### Specular anti-aliasing roughened the mirror

> **Background: specular aliasing.** A normal map or a bumpy surface can have detail finer than a pixel. Shading one sample per pixel then aliases: the highlight sparkles and crawls, because the sample sometimes lands on a facet facing the light and sometimes does not. The standard remedy is to treat the unresolved detail as roughness. If the normals vary a lot across a pixel's footprint, the pixel as a whole behaves like a rougher surface, so the shader raises the roughness by an amount that depends on that variation. The highlight widens and stops flickering. It is correct for rough ground and wrong for a mirror, which should stay sharp.

At the water's edge, the normal blends from the earth's bumpy normal to the flat water normal over a short distance. That variation looked like detail to the filter, and it lifted the water's 0.06 roughness to between 0.12 and 0.3, which blurred the mirror and also put it above the SSR cut-off.

## The fixes

- **Standing water is excluded from specular anti-aliasing.** A flag, `sStandingWater`, is set by a wet decal's water and by rain puddles. Surfaces with it keep their own roughness.
- **The prepass fills the water.** In the prepass, a wet decal's water now reaches the relief's deepest point, so SSR traces all of it. The weight in the lit pass still decides what shows.
- **Water-only probes.** Each puddle now carries a `reflectionProbe`: a box 1.8 by 3 by 1.8 m, captured 0.1 m above the water, so low-angle reflections still look out at the trunks. A first attempt with 5 m boxes put a sheen on the matte earth around each puddle, about 6% brighter. I don't want shiny ground, so I added `waterOnly` to the component. Only standing water takes such a probe, and the ground keeps the light of the probe volume it was already in. Water-only probes are listed last, so a dry pixel loops over none of them, not all 40.
- **Silty water.** Under standing water in relief, the albedo goes 85% of the way to a dark mud brown. My first value, 0.055, was lighter than the darkened bottom it replaced and made the puddle paler. The second, 0.024, was right.

The water-only probes exposed a smaller problem in the editor. Probes are baked per entity id, and every Rebuild Paths made the puddles under new ids. One rebuild silently dropped 17 of 23 probes. `ReplaceEntities` now reuses an id that it is removing in the same step, so a copy made again under its name keeps its id. Undo restores it, and `PathToolTests` covers it. A rebuild that moves a copy still needs a rebake, and `render_stats` says so.

In the scene I put probes on the template puddle and on the hand-placed ones, and deleted the old probe entities. Puddle density went from 0.05 to 0.1 per square metre, a spacing of 2.2 m. The water level went to opacity 0.65. A long puddle, `decal_puddle_ref4`, went 5 m ahead of the reference 4 pose, and I rebaked with a light change of 0%.

## Results

![The puddle before](/images/2026-11-01-woods-ground-and-puddles/before-close.jpg "Before: a pale grey blob with the leaf litter showing through.")

![The puddle after](/images/2026-11-01-woods-ground-and-puddles/after-close.jpg "After: dark water that mirrors the trunks, with matte earth around it.")

I measured the puddle by the reference 4 pose in a close view, editor flashlight off.

| Region | Before | After |
|---|---|---|
| Puddle (luma) | 0.287, paler than the ground | 0.167 |
| Ground beside it (luma) | 0.172 | 0.169 |

The puddle is now darker than the earth around it, and the earth did not change. The reference 4 pose has a mean luma of 0.207 against the reference's 0.176, and a saturation of 0.342 against 0.354.

![Puddles along the path, enlarged](/images/2026-11-01-woods-ground-and-puddles/after-puddles-ahead.jpg "The puddles ahead on the path, enlarged. The bright specks are sky gaps in the canopy reflected in the water.")

The full `ctest` passed 120 of 120. The 1440p bench over 12 woods poses was 0.8% to 3.8% faster than the previous run at every pose. That includes poses with no puddles, so I count it as noise. Nothing got slower. The frame-spike walk showed a mean of 10.81 ms and one spike, the known hitch at frame 235 of 15.9 ms, which still fails the 15 ms limit as it did before. I did not check the night woods, which share the shader changes.

## Open issues

- The puddle outlines are still the decal's blob shape. Water in ruts, such as the painted rut puddles from the weather work, or a long thin decal, would match the reference's long stretch better.
- The reflections are darker than in the reference. My canopy closes over the path, and the reference opens to pale sky.
- Each puddle costs a probe, and 40 of 64 are used. Many more puddles would need one shared probe for each stretch of path.
- The stones read paler and greyer than the reference's dark mossy ones. That is a material tint.
- The ground is still too bright and too even. There are no roots or fallen branches yet, since they need authoring in Blender.
