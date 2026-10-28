---
title: Contact-hardening shadows and shaped lights
date: 2026-10-02
order: 3
summary: I replaced the fixed shadow filter with contact-hardening soft shadows, then added rectangle area lights, angular profiles and projected cookies for windows and lamps.
tags: lighting, shadows, renderer
cover: /images/2026-10-02-soft-shadows-light-shapes/window-glow.jpg
---

With the surfaces in better shape, the second half of the day went to light. Two things bothered me. A chair's shadow on the wall behind it was as crisp at its far edge as at the point where the chair touched the floor. And every light was a point or a cone that was equally bright in every direction it reached. Real fixtures have size and shape, and much of a dim room's mood depends on them: the pale rectangle of a window, the bars of its panes on the floor, a lamp that lights the wall below it and leaves the ceiling dark.

## Why shadow edges are soft

> **Background: shadow maps.** The renderer draws the scene's depth from the light's point of view into a texture, which is the shadow map. In my engine every shadowed light owns tiles of one 4096 by 4096 atlas: one tile for a spot light such as the flashlight and six for a point light, one per cube face. To shade a pixel, the shader transforms its position into the light's view and compares its distance with the stored depth. If the stored depth is smaller, something is in front, and the pixel is in shadow. The usual artifacts come from limited precision. Self-shadowing acne appears when a surface compares against its own depth, and is fixed by biasing the compared depth toward the light. Too much bias detaches shadows from their casters (peter-panning), so my bias scales with the surface's slope relative to the light and with the size of a shadow texel at that distance.
>
> One comparison gives a hard edge that steps with the map's resolution. Percentage-closer filtering (PCF) takes several comparisons around the pixel and averages the results, which turns the edge into a gradient of a fixed width.

A fixed width is not what a lamp produces. A point of light makes a perfectly sharp shadow. A real lamp has size, so some parts of it can see around the edge of an object and others cannot, and the edge gets a gradient called the penumbra. By similar triangles, its width depends on three distances: the size of the light, the distance from the light to the object casting the shadow (the blocker), and the distance from the light to the surface receiving it.

![Geometry of a penumbra](/images/2026-10-02-soft-shadows-light-shapes/penumbra.svg "Rays from the top and bottom of the light graze the blocker's edge and land at different points on the receiver. The gap between them is the penumbra. It is zero where blocker and receiver touch and grows as they separate.")

The penumbra is wide when the blocker is far in front of the receiver and zero where they touch. That is why a shadow is sharp at the foot of a chair and loose on the wall behind it.

## Percentage-closer soft shadows

Percentage-closer soft shadows (PCSS) turn that relation into two extra steps before the filter:

1. **Blocker search.** The pixel looks around itself in the shadow map for texels in front of it and averages their distance from the light. If it finds none, the pixel is fully lit and the filter is skipped.
2. **Penumbra estimate.** The filter's width is computed from the formula in the figure, then used as the radius of an ordinary PCF filter.

In my shader the filter radius is `lightRadius * (receiver - blocker) / blocker`, converted into shadow-map texels. I use the light's radius, not its width, because the filter takes a radius. The result is clamped between the existing filter width, which is the narrowest, and a new setting, `shadow.maxPenumbraTexels`, which is 8 texels by default. The blocker search reads six taps and the filter twelve, in a pattern that is rotated per pixel and per frame, so temporal anti-aliasing averages the noise away.

Every light already had a `sourceRadius`, 0.15 m or 0.3 m for the larger lamps, which had only shaped highlights. It now shapes shadows as well. The flashlight is modelled as a 3 cm bulb, so its shadows stay nearly as sharp as before, which is correct for a small torch.

The first version searched with 12 taps and cost up to 0.22 ms in the hallway. Six taps, rotated each frame like the filter, brought that to at most 0.08 ms with no visible noise. The bench shows +0.01 to +0.04 ms per pose in the house and +0.01 to +0.08 ms in the hallway, where lamp shadows cover most of the view.

![An armchair's shadow on the wall with a fixed filter and with contact hardening](/images/2026-10-02-soft-shadows-light-shapes/armchair.jpg "Left: a fixed filter. Right: contact hardening. The shadow is tight where the chair's back meets the wall and loosens as it falls away.")

The effect is subtle in this house, because the lamps are dim and most shadows land close to their casters. It matters more with brighter lights and with the area lights below.

## Rectangle area lights

A window, or any glowing panel, can now be a lit rectangle.

> **Background: solid angle and area lights.** A point light's contribution to a diffuse surface is `intensity * cos(angle) / distance^2`. A lit rectangle is the sum of that over every point on it. What matters is how much of the surface's view of the sky the rectangle fills, which is its solid angle: a coin held at arm's length covers a small solid angle and the same coin at your nose covers a large one. For a diffuse surface, the cosine-weighted solid angle of a polygon has a closed form (Lambert's polygon formula). For each edge, take the two unit vectors from the surface point to the edge's end corners, multiply the angle between them by the component of their unit cross product along the surface normal, and sum over the edges. Half the absolute value of that sum, times the panel's radiance, is the irradiance.

The shader first clips the rectangle where it dips below the surface's horizon, so a sill just under a window catches it strongly and the far wall gently. A rectangle that fills the whole sky gives pi, which one of my tests checks, and a small distant one matches `area / d^2`. Highlights use the point on the rectangle that the reflection ray points at, which is a cheap approximation to specular area lighting.

![The nursery window with and without a rectangle light](/images/2026-10-02-soft-shadows-light-shapes/window-glow.jpg "Left: no rect light. Right: the window as a rect light. The sill and the sash's inner faces catch its glow.")

## Angular profiles

A real fixture sends light in a pattern: a bare bulb lights everything, a frosted globe under a brass cap sends little upward. Photometric files record this as a table of intensity by angle. Each of my lights can carry a profile of 16 samples, 12 degrees apart from the light's axis, packed as half floats and linearly interpolated. The house's globe lamps now throw less light up past their brass caps, so the lit patch on the wall sits lower and the ceiling stays darker. A fabric-shade profile for the scallops that shades throw is ready in the library.

![A lamp with no profile and with a frosted-globe profile](/images/2026-10-02-soft-shadows-light-shapes/lamp.jpg "Left: no profile. Right: less light goes up past the cap.")

## Cookies

A spot light can project a texture, called a cookie, which multiplies its intensity. The shader intersects the direction from the light to the surface with a plane in front of the light, scales it by the cone's tangent so the edge of the cone is at 1, and reads the cookie atlas there:

```text
p = (dot(l, right), dot(l, up)) / (dot(l, axis) * tan(outerAngle))   // -1..1 across the cone
```

The flashlight got a lens cookie, and each of the two moonlit windows got a moonbeam: a narrow spot outside the window, aimed through the opening at the floor, projecting the sash's six-over-six panes. My first try put the cookie on the existing moonlight, which sits inside the room with a 70 degree cone, and the panes were stretched across the whole floor and too faint to see. A separate narrow beam with its cone fitted to the opening lands them as a patch. The wall's inner faces point away from it, so nothing else is lit.

![The nursery floor with a moonbeam without and with the window sash cookie](/images/2026-10-02-soft-shadows-light-shapes/moonbeam.jpg "Right: with the sash cookie, the moonlight throws pane shadows across the floorboards. Flashlight off; the moonbeam is dim, as moonlight should be.")

## Finding what the shapes cost

The first version cost 8 to 20 percent of the scene pass everywhere, even in the hallway, which has no rectangle lights. Timing experiments were too noisy to isolate it, so I compiled the shader offline with the Windows SDK compiler and compared register counts. Before, the light loop used 52 temporaries. Mine used 65.

> **Background: registers and occupancy.** A GPU keeps thousands of pixels in flight so that while one waits for memory, others compute. Each pixel's shader needs registers, small fast storage for its variables, and a core has a fixed number of them. A shader that needs more registers leaves room for fewer pixels in flight, and less work hides memory delays. A few extra lines can therefore slow every pixel, including those that never execute them.

The rectangle code was most of the increase. It now lives in a second set of pipelines used only for objects with a rectangle light in their list, and the default pipeline is back to 54 temporaries (the rectangle pipeline uses 66).

## Checking the new light code before merging

Before merging the light shapes I reviewed everything that changed: the GPU light layout in C++ against HLSL, descriptor slots, root signatures, which pipelines exist in rectangle variants, hot reload, the rectangle maths, serialization, undo and the compounds. The layouts, slots and maths were right. Six real problems turned up, and I fixed all of them.

- **The moonbeam went through the wall.** It was aimed at the floor 1 m inside the room, but its cone was sized as if it pointed at the middle of the window. The axis passed just over the sill, and spot lights have no shadow maps, so the bottom of the cone went straight through the wall under the window. The baked light, which does trace walls, disagreed with it. The beam now points through the window's centre and lands where that line meets the floor.
- **Changing a light's shape did not mark the bake stale.** The bake's fingerprint ignored a rectangle's size and orientation and a light's profile, so resizing a window light left old baked light in place under a status bar that said "Lighting current". They are in the fingerprint now, only when set, so scenes without them keep their bakes.
- **Lights behind a window panel still counted.** Each object lights itself with its eight strongest lights. A rectangle emits only forwards, but objects behind it still spent a slot on it and were drawn with the more expensive rectangle pipeline. They now skip it.
- **Glass ignored rectangle lights**, because blended glass is drawn by its own pipeline with no rectangle variant. It has one now.
- **Profiles on a rectangle were half applied.** The fog, the contact shadows and the bake used the profile, and the main lighting did not.
- **Small ones.** The undo history's light comparison ignored the new fields, so a change to only those could be dropped as "no change". Validation did not warn about a missing cookie id or a negative size, and a cookie on a point light silently did nothing, which is now a warning.

I also made a rectangle light live in the editor, switched it to a spot with the blinds cookie, typed a bad cookie id and a negative width, then undid and redid every step. Every field came back exactly. The negative width was clamped to 1 cm.

Playing the build gave one follow-up. The flashlight threw a faint dark ring around its hotspot, which was the lens cookie doing what I had authored: a 42 percent dip at half the cone's radius. On a wall it read as a black circle and not as a lens. The cookie is now a smooth falloff from a full hotspot to a spill that is 35 percent dimmer at the edge, with no rings.

## Results and open issues

Measured against `master`, the light shapes cost +0.03 to +0.07 ms in the hallway and +0.06 to +0.29 ms in the house, 4 to 21 percent, mostly in the nursery and on the landing, which gained lights and around the frosted-globe lamps, whose profile is read for every lit pixel. The fixes from the review measure neutral, so the gap to the earlier +0.09 to +0.23 ms is run-to-run noise.

Open items:

- The viewport draws no outline for a spot's cone or a rectangle light's panel, so aim and size can only be read from the Inspector.
- Only the four lamps nearest the camera cast shadows, so the others still light through furniture.
- Cookies are not baked into the probes, and glass skips them.
- Editing a profile in `lights.json` does not mark the bakes stale; only changing a light's profile id does.

The next step was larger: baking the bounce light into lightmaps.
