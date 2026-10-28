---
title: Soft shadows and light shapes
date: 2026-10-02
order: 3
summary: Shadows soften with distance from what casts them, windows become glowing rectangles, lamps get caps, and a moonbeam throws window panes on the floor.
tags: lighting, shadows, renderer
cover: /images/2026-10-02-soft-shadows-light-shapes/window-glow.jpg
---

With the surfaces in better shape, the second half of the day went to light. Two things bothered me. A chair's shadow on the wall behind it was as crisp at its far edge as where the chair touched the floor, and every light was a point or a cone, equally bright in every direction. Real lamps have size and shape, and a lot of a horror room's mood comes from that: the pale rectangle of a window, the bars of its panes on the floor, a lamp that lights the wall below it and leaves the ceiling dark.

## Contact-hardening shadows

> **Concept: Why shadows have soft edges.** A point of light makes a perfectly sharp shadow. A real lamp is a blob, so some parts of it see around the edge of an object and others do not, and the edge gets a gradient called the *penumbra*. The effect is strongest when the caster is far from the surface it shadows, and zero where they touch. That is why a shadow is crisp at the foot of a chair and loose on the wall behind it.

The engine draws shadows with *shadow maps*: a picture, from the light's point of view, of how far away the nearest surface is. A pixel is in shadow if it is further from the light than the map says. Until now I filtered those lookups with one fixed width everywhere. The technique that fixes it is called PCSS, percentage-closer soft shadows, and it adds two steps before the filter.

- **Blocker search.** Each shadowed pixel looks in the shadow map around itself for anything in front of it and averages how far away those casters are. If there is nothing, the pixel is lit and the filter is skipped entirely.
- **Penumbra estimate.** By similar triangles, the soft edge's width is the light's radius times the gap between caster and surface, divided by the caster's distance from the light. That is converted into shadow-map texels and clamped between the existing filter width (the narrowest) and a new maximum (8 texels by default). The filter then runs at that width.

Every lamp already had a `sourceRadius` (0.15 m, or 0.3 m for big ones) that only shaped highlights. Now it shapes shadows as well. The flashlight is a 3 cm bulb, so its shadows stay nearly as sharp as before, which is right.

The first version searched with 12 taps and cost up to 0.22 ms in the hallway. Six taps, rotated every frame like the filter and averaged by temporal anti-aliasing, cut that to at most 0.08 ms with no visible noise.

![An armchair's shadow on the wall with a fixed filter and with contact hardening](/images/2026-10-02-soft-shadows-light-shapes/armchair.jpg "Left: a fixed filter. Right: contact hardening. The shadow is tight where the chair's back meets the wall and loosens as it falls away.")

The effect is subtle in this house, because the lamps are dim and most shadows land close to their casters. It will matter more with brighter practical lights.

## Light shapes

Then the shapes themselves.

**Rectangle area lights.** A window, or any glowing panel, can now be a lit rectangle. Its diffuse light is computed analytically from the rectangle's solid angle, clipped where it dips below the surface's horizon, so a sill right under the window catches it strongly and the far wall gently. Highlights use the point on the rectangle that the reflection points at.

> **Concept: Solid angle.** Hold a coin at arm's length and then at your nose: the coin covers a larger patch of your vision. That patch, measured as a fraction of the sphere around you, is its solid angle. A light's contribution to a surface depends on how much of the surface's sky the light fills, so for a rectangle you calculate that directly instead of pretending the window is one dot.

![The nursery window with and without a rectangle light](/images/2026-10-02-soft-shadows-light-shapes/window-glow.jpg "Left: no rect light. Right: the window as a rect light, with the sill and the sash's inner faces catching its glow.")

**Profiles.** A light can carry a curve of brightness by angle. The house's globe lamps now throw less light up past their brass caps, so the lit patch on the wall sits lower and the ceiling stays dark.

![A lamp with no profile and with a frosted-globe profile](/images/2026-10-02-soft-shadows-light-shapes/lamp.jpg "Left: no profile. Right: less light goes up past the cap.")

**Cookies.** A spot light can project a pattern, called a *cookie*. The flashlight got a lens cookie, and each moonlit window got a moonbeam: a narrow spot outside the window, aimed through the opening at the floor, projecting the sash's six-over-six panes. My first try put the cookie on the existing moonlight, which sits inside the room with a 70 degree cone, and the panes were stretched across the whole floor and too faint to see. A separate narrow beam with its cone fitted to the opening lands them as a patch.

![The nursery floor with a moonbeam without and with the window sash cookie](/images/2026-10-02-soft-shadows-light-shapes/moonbeam.jpg "Right: with the sash cookie, the moonlight throws pane shadows across the floorboards. Flashlight off.")

## Finding what the shapes cost

The first version cost 8 to 20 percent of the scene pass everywhere, even in the hallway, which has no rect lights. Timing experiments were too noisy to pin down, so I compiled the shader offline with the Windows SDK's compiler and compared register counts. Before, the light loop used 52 temporaries; mine used 65.

> **Concept: Registers and occupancy.** A GPU runs thousands of pixels at once, but every pixel needs registers (tiny fast storage) for its variables. If one pixel's shader needs more registers, fewer pixels fit on the chip at a time, and less work hides memory delays. So a few extra lines of code can slow every pixel, even those that never run them.

The rect light's code was most of the increase. I moved it into a second set of pipelines used only for objects that actually have a rect light, and the others dropped back to 54 temporaries.

## The bug check before merging

Before merging the light shapes, I spent a session checking them. A code review of everything that changed turned up six real problems.

- **The moonbeam went through the wall.** It was aimed at the floor 1 m inside the room, but its cone was sized as if it pointed at the middle of the window. The cone's bottom passed under the sill, and spot lights cast no shadow maps, so it went straight through the wall. It now points through the window's centre.
- **Changing a light's shape did not mark the bake stale.** The fingerprint of the baked lighting ignored a rect's size and a light's profile, so resizing a window light left old baked light in place with "Lighting current" in the status bar.
- **Lights behind a window panel still counted.** A rect light only emits forwards, but objects behind it still spent one of their eight light slots on it.
- **Glass ignored rect lights**, because blended glass is drawn by its own pipeline that had no rect variant.
- **Profiles on a rect light were half applied,** used by the fog and the bake but not the main lighting.
- **Small ones:** the undo history's light comparison ignored the new fields, validation did not warn about a missing cookie id, and a cookie on a point light silently did nothing, which is now a warning.

I also made a rect light live in the editor, switched it to a spot with a blinds cookie, typed a bad id and a negative width, then undid and redid every step. Every field came back exactly.

A playtest brought one follow-up. The flashlight threw a faint dark ring around its hotspot. That was the lens cookie doing what I had authored: a 42 percent dip at half the cone's radius. On a wall it read as a black circle, not a lens. It is now a smooth falloff from a full hotspot to a dimmer spill, with faint dust and no rings.

## Where it ended

In the final bench the shapes cost +0.03 to +0.07 ms in the hallway and +0.06 to +0.29 ms in the house (4 to 21 percent), most in the nursery and on the landing, which gained lights. The moonbeams are dim, as moonlight should be. Still open: the viewport draws no outline for a spot's cone or a rect light's panel, and only the four lamps nearest the camera cast shadows, so the rest still light through furniture. The next step was a bigger one: baking the bounce light into lightmaps.
