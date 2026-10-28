---
title: Building surfaces the RE7 way
date: 2026-10-19
order: 1
summary: Sharper compressed textures, library materials with wear and grime, a house dressed in photo-scanned surfaces, and damp and stains laid on as material layers.
tags: materials, renderer, assets
cover: /images/2026-10-19-re-style-materials/rising-damp.jpg
---

A new track started on the 19th, and I called it Track M, for materials. Up to now the house's walls and floors were textures that a script generated, and the result was readable but a little flat. Resident Evil 7 and Village do it differently. Every surface starts as a photograph of a real surface, and the grime is layered on top in the places where hands, water and feet actually go. This post is the first half of that day: four steps that changed how a surface is stored, described and dressed.

## Sharper colour textures: BC7 with two colours per block

Photo scans are full of small, sharp detail: the edge of a stain, a crack, the dark gap between planks, tile grout. Before I brought scans in, I wanted my texture compression to handle edges.

> **Concept: Block compression.** A graphics card cannot afford to keep every texture as raw pixels, so textures are stored in a *block-compressed* format that the GPU reads directly. BC7 cuts the image into 4x4-pixel blocks, and each block is stored as a small recipe: a pair of colours (endpoints) and, for each of the 16 pixels, an index saying how far along the line between those colours it sits. Decoding is trivial, so the GPU does it on the fly.

My encoder only wrote one BC7 recipe, called mode 6. It gives each block a *single* line through colour space with 16 steps along it. That is perfect for a smooth gradient, but a block that holds two different things, say light plaster beside a dark crack, gets smeared between them.

BC7 has other recipes that *split the block into two halves*, each with its own pair of colours. There are 64 ways to draw that split, called partitions. The encoder now ranks all 64 by how well two straight lines fit the two halves, fully encodes the best three in two split modes (one with finer steps per half, one with more precise endpoints), and keeps whichever of those and mode 6 is closest to the original.

To trust it, I wrote a test that builds thousands of random blocks and decodes them two ways: with the engine's own decoder, and with Windows' software GPU, which follows the BC7 specification exactly. They match bit for bit. To check that the test could fail, I broke one entry of the partition table on purpose, and 22 blocks differed.

The gain is on textures with edges, and little on smooth ones:

| Texture | Before | After | Blocks using a split mode |
|---|---|---|---|
| Woven fabric scan | 45.91 dB | 47.05 dB | 67% |
| Wallpaper | 55.50 dB | 56.40 dB | 54% |
| Wall tile | 53.68 dB | 53.92 dB | 73% |
| Smooth plaster scan | 51.41 dB | 51.42 dB | 2% |

![Bathroom tile grout at four times zoom, before and after](/images/2026-10-19-re-style-materials/bathroom-tiles-before-after.jpg "Tile grout at 4x zoom. Before (left) and after (right): the grout lines are slightly cleaner. At normal size you would hardly see it.")

GPU time did not change. The honest note: at normal size this is hard to see, and it matters more once scans arrive.

## Library materials get wear, grime and sheen

The house's walls and floors use a *material library*, one file listing each surface's textures and numbers. Imported 3D models could already carry three extra surface layers: worn edges (paint chipped to the wood), grime in crevices and near the floor, and cloth sheen. Library materials could not set any of them, and now they can, in the file, in the Materials panel, and over the editor's tool interface.

I found something worth being honest about. Wear and grime can't show on walls or floors this way. Those two layers are driven by masks baked into a mesh's vertices: where its edges are, where its crevices are. Walls, floors and ceilings are plain boxes, and their masks are all zero. So on library materials these layers matter only when the material dresses an imported mesh. Grime on walls needed a different approach, which came two steps later.

## The house on photo scans

> **Concept: Photogrammetry and scanned materials.** A *scan* is made by photographing a real surface from many angles, or under controlled light, and having software work out its colour, its fine relief (a normal map) and how rough it is. Instead of an artist painting plaster, you get actual trowel marks and stains. I use free, public-domain CC0 scans from Poly Haven and ambientCG. Each scan has a known real-world size, which matters: you want the plaster's marks to appear at plaster size, not stretched across a wall.

Six scans now dress the house:

| Surface | Scan | Real size |
|---|---|---|
| Ground-floor walls | white plaster | 1 m |
| Upstairs walls | grey plaster | 1 m |
| Ceilings | interior ceiling | 2 m |
| Study, kitchen, upstairs floors | old wood floor, separate planks | 3 m |
| Corridor, foyer, parlor, dining floors | herringbone parquet | 3.4 m |
| Parlor, dining, master, nursery | decrepit wallpaper under the damask | 2.5 m |

Each surface repeats at the scan's real size, and the one-metre plasters repeat only every two metres, so the repeat is harder to spot. Walls get around 1,000 pixels per metre, and floors 600 to 680. I also set each material's colour so its rooms are as bright on average as they were before. Only the detail changed, not the exposure.

Two details are worth the space. First, the parquet scan's own roughness map is varnished and averages 0.10, which is mirror-like. I left that map out and gave the floor a flat 0.92, since I do not want shiny floors. Second, none of the free wallpapers carries my damask pattern. So I print the existing damask over the decrepit-wallpaper scan: the scan's stains, tears, streaks and paper relief age the print, replacing my generated ageing.

![Close-ups of the corridor floor, foyer floor, parlor wallpaper and an upstairs wall](/images/2026-10-19-re-style-materials/close-ups.jpg "Close-ups of scanned surfaces: parquet (top row), aged wallpaper (bottom left) and plaster with real cracks and trowel relief (bottom right).")

![A set of house views after the move to scans](/images/2026-10-19-re-style-materials/house-after.jpg "Six house views on scanned materials.")

A useful failure turned up on the way. One of my tests checks that a scene's baked lighting is current, and it failed. The bake key covers the whole material library, so adding six materials marked the hallway's bakes stale. I rebaked both scenes. The cost was small: GPU time up 1.0 to 4.2% per view, about 0.03 ms.

## Damp, stains and dirt as material layers

RE7 and Village rarely show a clean surface. Their plaster has a damp layer creeping up from the floor and a stain hanging from the ceiling, and their floors hold dirt in the grooves. The dirt is blended through the base material's height, so it fills the pits first and its edge follows the relief instead of running in a straight line.

> **Theory: Height blending.** If you simply fade a dirt texture in over a wall, you get a smooth gradient that looks like a printed pattern. In real life dirt gathers in low spots first. So the blend mask is not just "how high up the wall are we", it is "how high up the wall are we, *plus a bonus for pits*". Noise in world space ruffles the edge, and the base's height map lets the pits take the dirt first. The result is a border that follows the material's own bumps.

A library material can now lay up to two other library materials over itself, each with its own colour, roughness and normal map. Each layer says where it gathers: a band rising from the floor, a band hanging from the ceiling, along a floor's or ceiling's borders, or in patches of noise anywhere.

There was a practical problem. A plain box does not know where its room's floor is: walls run down into the floor slab, and the foyer's wall runs through both storeys. So the scene's render settings now hold each storey's floor and ceiling heights. A box's own bottom and top count only if they reach one of them. A lintel over a door gets no "rising damp", and a two-storey wall has no stripe halfway up.

In the house, plaster and wallpaper get damp 25 to 30 cm up from the floor and a tea-coloured tide mark under the ceiling, ceilings get stained along their edges and in blotches, and floors get dark dirt patches that settle into the grooves. Everything stays matte.

My first try was too loud. A cracked-plaster scan on the ceilings drew a dark reptile-skin band round every room. Floor dirt covered whole stair risers. And the height blend let deep pits in the middle of a floor pick up dirt where no mask existed at all. I swapped the stain for a damp scan, tinted and nearly flat, restricted "edges" to a box's top or bottom face, and made the height blend only able to move a border, never start one.

![Rooms before and after the layers](/images/2026-10-19-re-style-materials/rooms-before-after.jpg "Stairs, parlor, dining room and landing, before (left) and after (right). The stains under the ceilings and the darker gallery underside are the visible part; the rest is subtle on purpose.")

![A parlor floor without and with dirt](/images/2026-10-19-re-style-materials/floor-dirt-before-after.jpg "Dark patches now settle into the parquet's grooves. The pale patch is an older dust decal.")

![Rising damp at the foot of a corridor wall](/images/2026-10-19-re-style-materials/rising-damp.jpg "Rising damp at the base of a corridor wall, with a worn door casing beside the light switch.")

The cost: GPU time up by 0.07 to 0.12 ms per view, inside the 0.3 ms I had planned for.

## Where it stood

By the end of this part the house's walls, floors and wallpaper were on real scans, layered with damp and dirt. Two things were left open: floor grime along the walls does not show, because the floor boxes run under the walls and hide their own edges, and the trim, tile and fabric were still the old surfaces. Next up was streaming, so the bigger textures would not eat all the memory.
