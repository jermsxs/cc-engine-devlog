---
title: Walking the woods to the gate
date: 2026-10-21
order: 3
summary: Triangle-mesh colliders let the player walk on bumpy ground, then the path got an iron gate and a house at its end, and the whole look got tuned toward photoreal.
tags: outdoors, physics, assets
cover: /images/2026-10-21-walking-the-woods/gate-and-house.jpg
---

The woods looked better, but I could only look at them from fixed cameras. The physics knew boxes, capsules, spheres and convex hulls, and none of those can describe a bumpy forest floor, so the player fell straight through the ground. That day had three jobs: make the woods walkable, give the path somewhere to go, and keep pushing the look toward photoreal.

## A collider made of the real triangles

> **Concept: Triangle-mesh collider.** Boxes and spheres are simple shapes the physics code can test with a few lines of maths. A terrain is neither. A *triangle mesh* collider uses the model's actual triangles: a bumpy hill collides like a bumpy hill. The trade-off is that you have thousands of triangles to test, so it needs a fast way to skip most of them.

The woods ground has 38 thousand triangles, but the player's capsule only touches a few dozen at a time. To find them quickly, the mesh is sorted once into a tree of boxes: split the triangles in half along their longest spread, again and again, until each box holds at most four. A query walks down the tree and only looks at the boxes near it.

Everything the player does already worked on top of it. Standing and walking push the capsule out of the deepest triangle it overlaps. Rays (the interact ray, a script's raycast), sweeps and box queries all go through the same tree.

### Thrown props and the seam problem

Colliders for static things were the easy half. I also wanted thrown props to land on the ground. Rigid bodies meet each triangle as a thin wedge, a quarter of a metre deep under its face, so the usual collision code works on it unchanged.

Then came the hard part: seams. A rolling ball hopped about 5 cm whenever it crossed from one triangle to the next, because it caught the edge of the neighbour's wedge. A sliding box tripped on the side of the next wedge. Three rules fixed it:

- Contacts with the sides of a wedge are dropped.
- A contact that leans toward the face takes the face's normal.
- A ball keeps one contact, at its deepest point, and only when that point lies over the triangle.

Now a ball rolled over a mesh cut into small triangles follows the same path as on one flat floor, within 4 mm. A box slid across it within 0.1 mm.

### In the woods

A script gives the ground, every tree and every sapling (trunks and branches) a triangle-mesh collider, and the stumps a convex hull. Bushes, undergrowth, stones and the thick border band stay walk-through, as a player would push through them. Four invisible walls keep the player inside the slice. Copies of a tree at different uniform sizes share one mesh, so 520 meshed colliders do not carry 520 copies of the triangles.

A test plays the real woods scene without a window. The player stands with their eye 1.62 m above the ground, walks eight seconds down the path keeping that height within 15 cm, and walks straight at a tree and gets turned aside, never nearer than 0.35 m to the bark (the capsule is 0.3 m wide). Rendering was unchanged: every bench pose is image-identical and GPU time did not move.

![Eye-level view on the path after a short walk](/images/2026-10-21-walking-the-woods/after-the-walk.jpg "The player after walking down the path: eye at standing height on the damp ground.")

## An iron gate at the end of the path

The path had been ending in a wall of bushes. I had a new reference frame: a wrought-iron double gate, with an old two-storey house behind it. Grey clapboard, a steep front gable with a round vent, brick chimneys, a porch with lattice, all in shade against a hazy low sun, and a weathered boardwalk curving up to the gate. Now the path ends there.

Everything was made from scratch as real models, not boxes.

- **The gate and fence.** A Blender script builds one gate leaf (stiles, rails, spear pickets, a crest of S-scrolls, an oval of mirrored C-scrolls around a ring), a pillar with a ball finial, a fence panel with 19 spears, a post, and boardwalk sections. My first scrolls had curls too big and a bar straight across the middle; I redrew them as small curls joined by a smooth curve.
- **The house.** Eight thousand triangles: a brick foundation, a side-gabled block, a front wing with a 56 degree gable holding a spoked round vent, windows, a double door with a transom, three chimneys, and the two-storey porch with columns, railings and lattice cut to fit under the roof.
- **Materials.** Five CC0 scans (painted planks for the siding, roof slates, weathered brick, rusty metal darkened to near black for the iron, brown planks for the boardwalk), each checked before download.
- **The yard.** A second terrain mesh that matches the path's ground vertex for vertex at the fence line, where the banks flatten out.

![The gate, fence, pillar and post as plain models in Blender](/images/2026-10-21-walking-the-woods/gate-and-fence-pieces.jpg "The gate and fence parts in Blender, before materials.")

![The house's model in Blender](/images/2026-10-21-walking-the-woods/house-exterior-model.jpg "The house: a shell with a real porch, vent, columns, lattice and chimneys.")

The gate leaves do not open and the house is a shell, but the player is held at the locked gate and at the fence six metres either side. A test walks from 4 m short of the gate and checks it.

### Tuning it by the numbers

The first render was wrong in a loud way: the house lit full-on and washed out (mean brightness 76 against the reference's 58). I rebuilt the scene and measured three poses after every change. The final steps mattered more than the first guesses:

- The sun, tuned earlier for the path, shines from behind the player's right, so the house's front faced it. In the reference the house is backlit, in shade against the sky. Rather than turn the sun and lose the path's look, I planted a grove of tall trees on the yard's sunny side to shade the front.
- I scaled the house up 1.2 times, because the reference's house is grander than my 3.3 m storeys.
- Crowns that roofed the gate's sky moved aside.

![First pass and tuned pass of the gate view](/images/2026-10-21-walking-the-woods/gate-close-first-pass-and-tuned.jpg "Left: the first pass, a washed-out house under bright haze. Right: after tuning, a boardwalk, a house in shade and a framed gate.")

> **Note: A stale copy.** The game reads its assets from the build folder, and the house's new material map had not been copied there. I lost time wondering why a change did nothing. The trial script now copies the asset folders every run.

Brightness at the gate pose came to 61.5 against 58.2. Another view, from further back, stayed a miss: 36 against the reference's 66. That reference is sunlit and backlit with glowing leaves, while my woods keep the dim light I tuned for the path.

## Fine-tuning toward photoreal

I asked for two things at once: keep tuning toward a photographic look, and keep the scene fast and quick to load. Each change was measured against the three reference views (mean brightness, a ten-row profile, blue/green balance and colour by brightness band).

**The leaf fringes.** Every leaf card had a thin pale-yellow rim: edge texels measured about 232, 227, 183 against a leaf colour of 126, 117, 64. The twig card was being un-premultiplied after rendering, which blows up the colour of nearly clear texels. The tree script now grows the solid texels' colour out over the soft edges and the clear texels instead. The glowing outlines are gone, and the canopy got darker too, since the rims had been lifting it.

![A bush before and after the fringe fix](/images/2026-10-21-walking-the-woods/leaf-fringe-fix.jpg "Left: leaves with pale rims. Right: the rims are gone.")

**Sky and sun patches in the grade.** The woods' colour lookup table tinted the sky amber too. It now fades bright tones back toward cream. The first version also greyed out the sunlit dirt, so sun patches went white-grey. The fade now skips warm colours (red well over blue), and warm tones get a push toward gold.

**Exposure and bloom.** The woods' auto exposure sat on its floor at every pose, so it behaved like a fixed film exposure. I wrote the floor into the scene and nudged compensation up. The house read cream and glowing where the references show dark grey against the sky. With the sun off it still measured 100, so the sun was not the cause. With bloom off it fell to 85: the wide bloom off the open sky was veiling it. Bloom is now 0.1 from a threshold of 2.0 (it was 0.3 from 1.2). The siding became a darker cool grey with damp climbing the brick and water stains under the eaves, and each window got a yellowed blind drawn at a different height.

**The approach.** The path's dirt now fades into leaf litter over the last metres before the gate, because the reference's ground there is leaves and boards.

Some things I tried and dropped: a brighter sky cap (brighter everywhere, no more contrast), big trees on the sun's side (frame dropped to 32 because the exposure floor will not lift it), and more light through the leaves (no measurable change).

![The gate and the house from just outside it](/images/2026-10-21-walking-the-woods/gate-and-house.jpg "The gate and house from just outside the fence.")

| Pose | Reference | Before | After |
|---|---|---|---|
| The path | 36.7 | 38.0 | 36.8 |
| At the gate | 58.2 | 61.5 | 57.8 |
| Farther back | 66.1 | 36.1 | 33.6 |

GPU time stayed the same or dropped slightly (reference pose 5.54 to 5.58 ms, gate close 4.63 to 4.51 ms). Loading to the second frame took 2.46 s warm.

## Still open

The farther-back view is half as bright as the reference, and my sun patches are still small round coins where the reference has broad irregular ones. The path is flat where the reference's is lumpy, with puddles and loose leaves. Up close the house's trim still reads a bit like concrete. The gate does not open yet.
