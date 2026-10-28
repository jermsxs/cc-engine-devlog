---
title: Lamp falloff, a shadow map, a flashlight and a scene stored as data
date: 2026-06-09
order: 1
summary: On 8 and 9 June I added windowed lamp falloff, a shadow map with filtering, a flashlight, an entity scene that drives the runtime and glTF import.
tags: renderer, lighting, scene
cover: /images/2026-06-09-first-hallway/lamp-pool-flashlight.jpg
---

After the first commit the engine could draw a lit, textured corridor. Over 8 and 9 June I made fourteen commits that changed what that corridor was made of. Lamp light got a falloff curve with a defined radius, the scene description became the data that the running game reads, a flashlight was added, the hallway became a loop, and a glTF importer made it possible to load authored meshes.

I did not take screenshots on those two days. The image below is the June editor viewport from a week later. A later image, from 27 September, appears in the flashlight section and shows what the same lamp, shadow and flashlight code produces on a wall with a door.

![The June editor viewport showing a dark corridor with an editor grid on the floor](/images/2026-06-09-first-hallway/june-hallway.jpg "The viewport on 15 June, in the editor I describe in the next post. The grid is an editor overlay.")

## How a frame is drawn

My renderer is a forward renderer. This section explains what that means and why the colour target is in floating point.

> **Background: forward rendering and HDR**
>
> A forward renderer draws each mesh once. For every pixel that a triangle covers, the pixel shader computes the final colour on the spot. It reads the material, loops over the lights that can reach the pixel, adds up their contributions and writes the result. The alternative, deferred rendering, first writes surface properties into several full-screen images and lights those images in a second step. It handles many lights well but needs more memory bandwidth and is harder to use with transparent surfaces. For a narrow corridor with a dozen lamps, a forward renderer is simpler and fast enough.
>
> The shader does not write to the screen directly. It writes to an off-screen image in a floating-point format, `R16G16B16A16_FLOAT`, so a pixel can hold values above 1.0. This is high dynamic range, or HDR. It matters here because a bare bulb is hundreds of times brighter than a wall in shadow. If the target stored values from 0 to 1 only, the bulb and a lit wall would both clip to white and the contrast between them would be lost before any post effect could use it.
>
> A display can show only 0 to 1. The last step of the frame, tone mapping, compresses the HDR values into that range. My post shader uses a simple curve and then a gamma encode:
>
> ```hlsl
> color = color / (color + 1.0);
> return float4(pow(saturate(color), 1.0 / 2.2), 1);
> ```
>
> The first line is the Reinhard curve. It leaves small values almost unchanged, maps 1.0 to 0.5, and approaches 1.0 only for very large inputs.
>
> | HDR value | After the curve | After the 1/2.2 gamma |
> |---|---|---|
> | 0.02 | 0.020 | 0.17 |
> | 0.1 | 0.091 | 0.34 |
> | 0.5 | 0.333 | 0.61 |
> | 1 | 0.500 | 0.73 |
> | 4 | 0.800 | 0.90 |
> | 16 | 0.941 | 0.97 |
> | 100 | 0.990 | 1.00 |
>
> The gamma step exists because displays do not respond linearly to the values they receive, while lighting maths is done in linear units. The table shows why HDR helps: a lamp at 100 and a lamp at 16 still end at distinct values, 0.995 and 0.973. In a clamped 0-to-1 target both would be white.

A frame has three passes, shown in the diagram.

![Three passes: a shadow pass writing a depth map, a scene pass writing an HDR image, and a post pass writing the screen](/images/2026-06-09-first-hallway/frame-passes.svg "The three passes of one frame and what each one writes.")

1. The **shadow pass** draws the scene's depth from the point of view of a light into a 2048 by 2048 depth texture.
2. The **scene pass** draws every mesh with lighting and shadows into the HDR target. Exposure is a single multiplier applied to the colour at the end of the scene shader.
3. The **post pass** reads the HDR image with one full-screen triangle and produces the picture that is presented.

## Lamp falloff with a defined radius

A lamp has to get dimmer with distance, and the shape of that decline decides whether a room reads as lit by lamps. On 8 June I replaced my first attenuation with a function that has controls for this shape, stored per lamp.

> **Background: why light falls off with the square of distance**
>
> A small bulb emits a fixed amount of light in all directions. At distance `d` that light is spread over a sphere of area `4 * pi * d^2`. The light per unit area is the total divided by that area, so it falls with `1 / d^2`. Doubling the distance leaves a quarter of the light on each patch of wall. This is the inverse-square law.
>
> A renderer cannot use it unchanged, for two reasons. At `d = 0` the value is infinite, and a pixel next to a bulb would be far brighter than anything else. And the value never reaches zero, so every light affects every pixel in the scene. A shader loops over every light that reaches a pixel, so a renderer wants each lamp to have a finite reach. Real bulbs are also not points. A glass shade has a size, and near it the light does not diverge as `1 / d^2` predicts.

My attenuation has three parts. With `d` the distance from the lamp to the surface, `s` the lamp's source radius and `R` its range, the shader computes:

```hlsl
e       = max(d - s, 0);                       // distance from the edge of the source
range   = pow(saturate(1 - e / R), p);         // eases to zero at R
inverse = 1 / (1 + e * e * k);                 // finite at the lamp, ~1/e^2 far away
atten   = range * lerp(1, range, 0.8) * inverse * shaping;
```

- Measuring from the edge of the source (`e`) removes the infinity. The surface of a lamp shade is already at `e = 0`.
- The term `1 / (1 + k * e^2)` is the inverse-square law with a constant added, so it equals 1 at the source and behaves like `1 / (k * e^2)` at a distance. The factor `k` sets how quickly it starts to fall.
- The range window `(1 - e / R)^p` is zero at `R` and brings every lamp to a stop at a known distance. The second factor, `lerp(1, range, 0.8)`, applies the window a second time at reduced strength, which makes the pool of light more compact.
- `shaping` stands for terms that give a wall-mounted lamp its pool shape and ground that pool against the wall and the floor.

The values in the June scene file are `p = 2.78`, `k = 0.90`, `s = 0.10 m` and `R` about 4.7 m. Leaving out `shaping`, the result relative to the light at 0.5 m is:

| Distance from lamp | Inverse square only | My function |
|---|---|---|
| 0.5 m | 1.000 | 1.000 |
| 1 m | 0.250 | 0.366 |
| 2 m | 0.063 | 0.039 |
| 3 m | 0.028 | 0.004 |
| 4 m | 0.016 | 0.0002 |

Within about a metre of the lamp the curve is flatter than the physical law, which keeps the area around the shade from blowing out. Beyond two metres it is much steeper, because the range window pulls it to zero. I wanted separate pools of warm light with dark between them, and I wanted each lamp to be skippable beyond 4.7 m. The cost is that the curve is a tuned look and not a physical measurement, which is why the constants are scene data and not shader constants.

## One shadow map

A shadow tells the eye where a surface is and what lies between it and the light. I added a single shadow map early, because a lit scene without any occlusion looks flat.

> **Background: how a shadow map works**
>
> The scene is first rendered from the light's point of view, storing only depth. The result, the shadow map, records for each direction the distance to the nearest surface. When the camera later draws a pixel, the shader transforms that pixel's position into the light's view and looks up the stored depth. If the pixel is farther from the light than the stored value, something closer blocks the light, and the pixel is in shadow.
>
> The map has a finite resolution, which causes two well-known artifacts. Shadow acne appears when a surface compares its own depth against a texel that covers a sloped area, so parts of it fall just behind the stored depth and shadow themselves. The remedy is a bias that moves the receiver slightly toward the light before comparing, and it has to grow with the slope of the surface. A bias that is too large causes peter-panning, where the shadow detaches from the base of the object.
>
> A single comparison gives a hard on-or-off edge that shows the texel grid. Percentage-closer filtering (PCF) compares several neighbouring texels, averages the results, and gives a soft edge. The cost is one texture read per tap.

My implementation uses a 2048 by 2048 depth map. The shadow camera is a perspective camera whose target, height, back offset and field of view (78 degrees) are scene settings. The comparison is:

```hlsl
float slope = 1.0 - saturate(receiverNoL);
float bias  = gShadowSettings.y * (1.0 + slope * 1.85);   // base 0.006
visible     = (receiverDepth - bias > mapDepth) ? 0.0 : 1.0;
```

The filter takes 13 taps: the centre with a weight of 0.16, four neighbours at one step with 0.105, four diagonals with 0.06 and four at two steps with 0.045. The weights add up to 1. The step is the softness setting, 3 texels, times the texel size. The final value is `lerp(1 - strength, 1, visibility)` with a strength of 0.72, so a shadowed pixel keeps 28 percent of its light instead of going black.

Only one light has a shadow map. Each shadow map costs a depth pass over the scene, and each shadowed light needs its own map. I started with the one that matters most and left the rest for after the basics looked right.

## The post-process pass

The post shader runs once over the whole HDR image. It was already in the first commit, and this is the order of its steps:

- **Lens distortion.** The sample position is pushed outward in proportion to the square of the distance from the centre, a slight barrel warp near the edges.
- **Chromatic aberration.** Red and blue are sampled at positions shifted slightly in opposite horizontal directions, as a cheap lens would do.
- **Bloom.** A thresholded blur of the brightest pixels is added back on top. Lenses and eyes scatter a little of very bright light, so a bulb appears to glow. Because the input is HDR, the threshold picks out bulbs and shades but not lit walls. My first version is 13 taps of one small blur.
- **Vignette, grain, grade and tone mapping.** Darker corners from a smoothstep of the distance from the centre, a per-frame hash noise, and the tone curve above.

## A flashlight

The flashlight was added on 9 June in commit `ad51174`, with the L key to toggle it. It is a spot light attached to the camera. Its parameters are in the scene file: range 9.2 m, inner cone 13 degrees, outer cone 33 degrees, edge softness 0.82, a cool white colour and a small flicker.

> **Background: a spot light**
>
> A spot light is a point light restricted to a cone. For a pixel, the shader takes the angle between the beam's axis and the direction to the pixel, using a dot product. Inside the inner cone the light is at full strength, outside the outer cone it is zero, and between them it blends. Real torches have a soft edge, so the blend uses a smooth curve and not a linear ramp.

My version computes `cone = smoothstep(outerCone, innerCone, coneDot)` on the cosines of the two angles and raises it to the edge-softness exponent. Distance is handled by a separate range term, `pow(1 - distance / range, 1.65)`. The flicker multiplies the beam by a noise value that changes with time and position.

The commit that followed, `3c0e5df`, was about what the beam shows. A first version lit walls into a flat bright disc, which removed the plaster pattern exactly where the player is looking. I changed the diffuse term to multiply the actual material colour, scaled by the ambient-occlusion value, so that the wall texture stays readable inside the cone.

![A green-grey plaster wall with a wall lamp and a closed wooden door, lit inside a round flashlight cone](/images/2026-06-09-first-hallway/lamp-pool-flashlight.jpg "A later render from 27 September. The warm pool next to the lamp, the circular flashlight cone and the darkness outside both come from the June lighting code. The door was added in September.")

## The scene becomes data

The largest structural change on 8 June had no visible effect. The hallway had been built in C++ from a descriptor. It needed to become data that the game reads and that an editor can change.

> **Background: entity-component systems**
>
> A game object such as a lamp has a position, a mesh, a light and a name. A common first design is an inheritance tree, in which `Lamp` derives from `Light`, which derives from `Object`. The tree is hard to extend: a lamp that is also a switch has to choose a parent.
>
> An entity-component design separates identity from behaviour. An entity is only an integer identifier. A component is a plain struct of data, such as a transform or a light, that belongs to an entity by holding its identifier. A lamp is an entity that has a transform, a mesh renderer and a light. Adding a switch means adding an interactable component, with no change to a class hierarchy. Systems then work on the components they care about: the renderer reads meshes and lights, and the interaction system reads interactables.

My entity is a `uint32_t`. Each component type lives in its own `std::vector`, with the entity identifier stored in each element and a linear search to find the component of an entity. That is not a cache-optimised ECS, and a scene of this size does not need one. There were 14 component types in June: name, transform, mesh renderer, material tuning, render settings, light, lamp, interactable, camera, trigger, door, audio source, decal and tag.

The scene can be written to and read from JSON under a schema marker, `CC.EntityScene.v1`, with stable identifiers, so that an object keeps its identity between saves. The first commit already had this export. What changed on 8 June, in `f8f5e88`, is who owns the data at runtime. The file the game loaded was still the hallway descriptor, from which the entity scene was built at every launch. An authored entity-scene file replaced that on 27 September. The application now builds the render scene from the entity scene, and the runtime's changes (interaction activation, lamp flicker, the far door's movement) are made on the entity scene, not on a second hard-coded structure.

This is the groundwork for an editor, because an editor can only edit data. It also gave me tests that run without a GPU: the hallway's boxes, lights and interactions must all be present as entities.

## Real meshes, the loop, and removing the stand-ins

Until 9 June every object in the hallway was a box, including the picture frames, lamp fixtures, grime strips and floor scuffs. In `26e228c` I added a glTF static mesh importer, which reads a mesh from a file. The next post explains the format. I then removed the box stand-ins in `5bba728` and `ebb6a3f`, about 230 lines of code, tests and scripts, because they hid that no authored props existed yet. I also decided that the renderer should not trigger scares by itself. A scare belongs in a trigger and a script, so I left it out of the baseline.

The hallway also changed shape. In `ad51174` the descriptor became a loop, a square corridor with an outer half-extent of 8.6 m and an inner one of 5.85 m and lamps along four sides, which gives a longer route in the same footprint. It took three commits: one to build it, one to fix its geometry and one to restore the walls and the flashlight look.

## Results and open issues

By the evening of 9 June I had a dark loop corridor with lamp pools of a defined radius, one shadow map, a flashlight that keeps the wall material readable, post effects and a scene stored as entities. I verified it with tests and by running the game. I have no measurements from those days.

Several things were still wrong: the lighting contains terms written for this one corridor, the floor reflection is a fake that depends on lamp positions, only one light casts a shadow, there are no authored props, and I had no frame-time measurements. The next post covers the editor I wrote on top of the entity scene.
