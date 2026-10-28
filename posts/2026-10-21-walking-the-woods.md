---
title: Walking the woods on triangle-mesh colliders, and the gate and house
date: 2026-10-21
order: 3
summary: Triangle-mesh colliders let the player walk on uneven ground. I then built an iron gate and a house at the path's end and tuned the whole look against references.
tags: outdoors, physics, assets
cover: /images/2026-10-21-walking-the-woods/gate-and-house.jpg
---

The woods looked better, but I could only judge them from fixed cameras. The physics code knew boxes, capsules, spheres and convex hulls. None of those can describe a bumpy forest floor, so the player fell straight through the ground. That day had three jobs: make the woods walkable, give the path a destination, and keep tuning the look against the references.

## Triangle-mesh colliders

### How collision shapes differ

Collision detection between two shapes is cheap when the shapes are convex. A convex shape has a simple support function (the farthest point in a given direction), and algorithms such as GJK and the separating-axis test work from that alone. Boxes, spheres, capsules and convex hulls are all convex. A terrain is not. A hill with a hollow in it cannot be wrapped by one convex shape without filling the hollow.

A triangle-mesh collider uses the model's actual triangles, so a bumpy hill collides like a bumpy hill. The cost is that the mesh can have tens of thousands of triangles, and testing all of them for every query is far too slow. The standard remedy is a bounding volume hierarchy (BVH): a tree of boxes over the triangles, where a query descends only into boxes that overlap it and skips the rest.

A triangle mesh also has no volume. It cannot be a dynamic body, because it has no mass or inertia to compute, so it is a collider for static things.

### My implementation

The mesh is sorted once into a tree of boxes. At each level the triangles are split in half along the axis of their longest spread, until a box holds at most four. The woods ground has 38 thousand triangles, and the player's capsule touches only a few dozen of them each frame.

Everything the player does already worked on top of it:

- Standing and walking push the capsule out of the deepest triangle it overlaps.
- Rays, for the interact ray and for scripts' raycasts.
- Sweeps and box queries.

On an entity, a collider can now take the shape `triangleMesh`. It uses only the model's opaque triangles, so leaf cards never block. Copies of a tree at different uniform scales share one mesh, so the woods' 520 meshed colliders do not hold 520 copies of the triangles. A rigid body that asks for a triangle mesh gets its convex hull instead, and validation warns about it.

### Thrown props and the seam problem

Static colliders were the easy half. I also wanted thrown props to land on the ground. A rigid body meets each triangle as a thin wedge, a quarter of a metre deep under the triangle's face, so the existing convex collision code works on it unchanged.

![Cross-section of two neighbouring triangles, each with its wedge](/images/2026-10-21-walking-the-woods/wedges.svg "Each triangle becomes a wedge a quarter of a metre deep. Where two wedges meet, contacts with their shared side face have to be ignored.")

That produced a known problem in physics engines, usually called ghost collisions. A rolling ball hopped about 5 cm whenever it crossed from one triangle to the next, because it touched the edge of the neighbouring wedge instead of its face. A sliding box tripped on the side of the next wedge. Three rules fix it:

- Contacts with a wedge's side faces are dropped.
- A contact that leans toward the face takes the face's normal.
- A ball keeps one contact, at its deepest point, and only when that point lies over the triangle.

A ball rolled across a mesh cut into small triangles now follows the same path as on one flat box floor, within 4 mm. A box slid across it follows the flat path within 0.1 mm.

### The woods and the tests

`build_path_slice.py` gives the ground, every tree and every sapling (trunks and branches) a triangle-mesh collider, and gives the stumps a convex hull. Bushes, undergrowth, stones and the thick border band stay walk-through, as a player would push through them. Four invisible walls keep the player inside the slice. That makes 526 solid colliders. The probe bake is unchanged by them.

`TriangleMeshTests` covers building and queries; a player walking a 25 m bumpy slope, grounded with the feet within 6 cm of the surface; a steep 70 degree bank that blocks; a box that settles and sleeps on a mesh; a moved and turned mesh; and the seam cases above. `MeshCollisionTests` gained the entity side: scaled meshes, a ray from inside a hollow mesh, a collider that follows a moved entity, copies sharing one mesh, and the hull fallback.

`WoodsSceneTests` plays the real scene without a window. The player stands at the reference pose with the eye 1.62 m above the ground, walks 8 s down the path while keeping that height within 15 cm, and stays grounded. Walking straight at a tree turns the player aside, never nearer than 0.35 m to the bark, where the capsule's radius is 0.3 m. The edges hold with no respawns. The full Release suite passed at 113 of 113.

In the game, `CCHorror.exe --scene=Demo/Woods/path_slice.entity_scene.json --walk-frames=60:420` spawns the player grounded at the reference pose, and the player walks about 6 m down the path with the camera at standing height. Every benchmark pose was image-identical to the run before, within 1/255 on a pixel, and the GPU time did not move.

![Eye-level view on the path after a short walk](/images/2026-10-21-walking-the-woods/after-the-walk.jpg "The game after walking six metres down the path: the eye at standing height over the damp ground.")

Two limits remain. The viewport's collider overlay does not draw triangle meshes yet. Thin saplings are walls to the player but not to the eye, because their leafy crowns are walk-through and only the stems block.

## An iron gate at the end of the path

The path ended in a wall of bushes. I had a third reference frame, a close view of a wrought-iron double gate with an old two-storey house behind it. The house has grey clapboard, a steep front gable with a round vent, brick chimneys, and a porch with columns and lattice. It stands in shade against a hazy low sun, and a weathered boardwalk curves up to the gate. The path now ends there, and everything is a real model built for it, not boxes.

- **Materials.** Five CC0 scans, each approved by name and size before download: painted planks for the siding, roof slates, weathered brick, rusty metal darkened to near black for the iron, and brown planks for the boardwalk. A greyed copy of the interiors' painted trim covers the house trim, so the interiors are untouched.
- **Gate and fence.** `build_gate.py` in Blender builds one gate leaf (stiles, rails, spear pickets, a crest of S-scrolls, and an oval of mirrored C-scrolls around a ring), a pillar with a ball finial, a fence panel with 19 spears, a post and three boardwalk sections. My first scrolls had curls that were too large and a bar straight across the middle. I redrew them as small curls joined by a smooth curve.
- **The house.** `build_house_exterior.py` builds an 8-thousand-triangle model: a brick foundation, a side-gabled main block, a front wing whose 56 degree gable holds a spoked round vent, windows, a double door with a transom, three chimneys, and the two-storey porch with columns, railings, lattice cut to fit under the porch roof, and a lattice skirt.
- **The yard.** A second terrain mesh that continues the path's ground and matches it vertex for vertex at the fence line, where the banks flatten and the dirt fades out.

![The gate, a pillar, a fence panel and a post as plain models in Blender](/images/2026-10-21-walking-the-woods/gate-and-fence-pieces.jpg "The gate and fence parts in Blender, before materials.")

![The house model in Blender before its materials](/images/2026-10-21-walking-the-woods/house-exterior-model.jpg "The house: a shell with a real porch, round vent, columns, lattice and chimneys.")

`build_path_slice.py` places the fence across the slice with the two gate leaves shut between their pillars, an invisible wall over the gate and each run of fence, the boardwalk from 7 m before the gate in a long S, weeds, ferns and nettles along its last stretch, and the house 13 m past the gate, scaled 1.2 times because the reference's house is grander than my 3.3 m storeys. The old wall at z = 62 is gone. The woods before the gate keep their exact layout: every random number they drew is still drawn, and only placements inside the new corridor are skipped. A test walks from 4 m short of the gate and checks that the player is held at the gate and at the fence 6 m to either side. The scene has 3,304 entities and validates with no errors.

### Tuning against the numbers

The first render was wrong in an obvious way: the house was lit full on and washed out, at a mean brightness of 76 against the reference's 58. After every change I rebuilt the scene and measured three poses, using the mean brightness on a 0 to 255 scale.

| Step | Gate pose (reference 58.2) | Far pose (reference 66.1) | Path pose (reference 36.7) |
|---|---|---|---|
| First pass | 76.3, washed out | 17.3, a dark tunnel | not measured |
| Camera back to 10 m, siding darkened | 36.5 | 26.2 | 37.9 |
| Crowns moved off the gate's sky | 56.0 | 37.3 | 38.0 |
| West flank lowered, undergrowth at the gate | 67.1 | 38.1 | 38.0 |
| A grove on the yard's sunny side | 41.8 | 25.6 | 37.9 |
| House scaled 1.2 times, last near trees moved | 61.5 | 36.1 | 38.0 |

Three things decided the look.

- **The sun.** The woods' sun, tuned for the path, shines from behind the player's right, so the house's front faced it. In the reference the house is backlit and in shade against the sky. Turning the sun would have broken the path's match, so a grove of tall trees on the yard's east side now shades the front. The house went from cream to grey.
- **A stale copy.** The game reads its assets from the build folder, and the house's changed material map had not been copied there, so a change appeared to do nothing. The trial script now copies the asset folders on every run.
- **The crowns.** The far trees' crowns roofed the gate and the house. Moving them aside opened the sky that the references show.

![First pass and tuned pass of the gate view](/images/2026-10-21-walking-the-woods/gate-close-first-pass-and-tuned.jpg "Left: the first pass, a washed-out house under bright haze. Right: after tuning, with the boardwalk, a house in shade and the gate in frame.")

At the gate pose the brightness matched (61.5 against 58.2), as did the dark share (66% under 64 against 77%) and the bright share (12.5% over 150 against 12.2%). The reference's top rows are open sky at 129 and 117 where mine are haze seen through crowns at 79 and 90, and my bottom rows are lighter at 44 against 31. The grade is one for the whole scene, so my image is also warmer, with blue to green at 0.67 against 0.81. The far pose is the real miss, 36 against 66. The reference has sunlit, backlit woods with glowing leaves, and mine keep the dim light tuned for the path. It needs light of its own.

## Fine-tuning toward a photographic look

I wanted the look to move toward photographic while the scene stayed fast and quick to load. Each change was measured against the three references with the mean brightness, a ten-row profile, blue to green, and colour by brightness band.

### Pale leaf fringes

Every leaf card had a thin pale-yellow rim. The edge texels measured about 232, 227, 183 where the leaf colour is 126, 117, 64.

The cause is in how the twig card was prepared. A texture with transparent regions stores some colour in its transparent texels, and bilinear filtering blends that colour into a leaf's edge. To avoid it, the card must carry sensible colour right up to and beyond the edge. The card had been un-premultiplied after rendering, which divides colour by alpha. For a nearly clear texel the alpha is tiny, so the division blows up whatever error is in the colour. The tree script now grows the solid texels' colour outward over the soft edges and the clear texels. The glowing outlines are gone, and the canopy also got darker, since the rims had been lifting it.

![A bush before and after the fringe fix](/images/2026-10-21-walking-the-woods/leaf-fringe-fix.jpg "Left: leaves with pale rims. Right: the rims are gone.")

### Sky, grade and exposure

The references' skies are nearly neutral, with blue about 0.9 to 0.95 times green, over amber woods. My `re7_woods` lookup table tinted the sky amber as well. It now fades bright tones back toward cream. The first version also faded the sunlit dirt, and the sun patches went grey-white, so the fade skips warm colours (red well over blue) and gives warm sunlit tones an extra push toward gold.

| Bright ground, path pose | Band 100 to 140 (r/g, b/g) | Band 140 and up (r/g, b/g) |
|---|---|---|
| Reference | 1.33, 0.54 | 1.25, 0.58 |
| Before | 1.25, 0.60 | 1.17, 0.63 |
| After | 1.29, 0.53 | 1.21, 0.54 |

The woods' auto-exposure sat on its floor (`minEv100` -3) at every pose, so it behaved like a fixed film exposure. I wrote that floor into the scene and raised the compensation from +1.3 to +1.5 EV to bring the canopy back after the fringe fix.

### The house read cream

The house showed cream and glowing where the references show a dark grey house against the sky. At the balcony it measured 133 against about 64. With the sun off it still measured 100, so the sun was not the cause. With bloom off it dropped to 85. Bloom spreads the light of bright pixels over their neighbours, and the wide bloom from the open sky was veiling the house. Bloom is now 0.1 from a threshold of 2.0, where it was 0.3 from 1.2.

The siding and trim are a darker cool grey. Damp climbs the brick and the bottom boards, and water stains run under the eaves. The windows had flat black panes. Each sash now has a yellowed blind drawn at a different height, and the glass is a little glossier. Under the 4 m porch they sit in deep shade, as in the references. The first blinds produced a z-fighting pair against the window trim, and I inset them by 5 mm.

The dirt of the approach fades into leaf litter over the last metres before the gate, because the reference's ground there is leaves and boards.

I tried and dropped three changes: a brighter sky cap of 4, which brightened everything with no more contrast; big trees on the sun's side before the gate, which dropped the frame to 32 because the exposure floor will not lift it; and more light through the leaves with transmission at 0.85, which changed nothing measurable.

![The gate and the house from just outside the fence](/images/2026-10-21-walking-the-woods/gate-and-house.jpg "The gate and house from just outside the fence.")

| Pose (mean, 0 to 255) | Reference | Before | After |
|---|---|---|---|
| The path | 36.7 | 38.0 | 36.8 |
| At the gate | 58.2 | 61.5 | 57.8 |
| Farther back | 66.1 | 36.1 | 33.6 |

GPU time was the same or slightly lower at every pose: 5.54 to 5.58 ms at the reference pose, 4.63 to 4.51 ms at the gate and 5.11 to 4.90 ms farther back, on the RTX 4070 at 1440p. Loading to the second frame, warm, took 2.46 s, against 2.4 s before.

## Open issues

- The far pose is half as bright as the reference. It needs the woods near the gate sunlit and backlit, without undoing the path's match.
- My sun patches are still small round coins where the reference has broad, irregular patches.
- The path is flat where the reference's is lumpy, with puddles and loose leaves.
- The grade is one for the whole scene.
- The gate does not open, the house is a shell, and its trim still reads a little like concrete up close.
