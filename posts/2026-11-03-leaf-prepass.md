---
title: Splitting the leaf prepass into visibility and attributes
date: 2026-11-03
order: 2
summary: The depth prepass was the largest cost in the woods. I split it into a visibility-only pass and an attribute pass that draws only the winning triangles, saving 3 to 10 percent of the frame.
tags: performance, foliage, renderer
cover: /images/2026-11-03-leaf-prepass/long_stretch-after.jpg
---

After the sun dapple change merged, I turned to leaf performance. In the woods, the depth prepass was the largest single cost. At the path start, at 1600 by 900, it took 2.7 ms of a frame that was about 6 ms. This entry explains what a depth prepass is, why foliage makes it expensive, and how I split it so that the expensive part runs once per visible pixel instead of once per covered pixel.

## The problem: overdraw on foliage

> **Background: depth prepasses and overdraw.** A pixel on screen is often covered by many surfaces, one behind another. If a renderer shades surfaces in arbitrary order, it may run the full pixel shader for a surface and then overwrite the result with a nearer one. The wasted work is called overdraw. A depth prepass avoids most of it. The scene is first drawn with a trivial shader that only writes depth, so that the depth buffer ends up holding the nearest surface at every pixel. The scene is then drawn again with the expensive shader, and the depth test rejects every fragment that is not at the stored depth. Each pixel is then shaded once.
>
> The prepass is not free. Every triangle is transformed again, and every covered pixel still runs a depth-writing pixel shader. The technique pays off when the main shader is expensive enough that skipping its overdraw saves more than the prepass costs.

Foliage is the worst case for overdraw. A bush is hundreds of small leaves stacked in depth, and a view down the path looks through dozens of them at every pixel. Foliage also needs an alpha test, because a leaf is not a rectangle. A cut-out pixel shader has to sample the leaf's alpha and discard where the leaf is absent, so it cannot be skipped, and it turns off the hardware's early depth optimisations that would otherwise reject hidden pixels before the shader runs.

I had already cut my leaves to their outline, with 8 triangles each, so the empty texels of a card are mostly gone. What remained in the measurement was real depth overdraw. At the path start the prepass drew 10.3 M triangles and ran the pixel shader 19.7 M times. That is 13.7 times the pixel count of the screen. Each of those runs sampled the material and wrote four render targets: the normal, roughness and metalness, motion vectors, and the visibility id.

Most of that work was thrown away. Of the 13.7 layers drawn on average, only the nearest one matters to the final image.

## How the pass was organised before

My renderer has a visible-triangle compaction step for plants. After the prepass writes a visibility id per pixel, the compaction finds which triangles own at least one pixel, and the later passes draw only those. Compaction was already in place and works well. The prepass in front of it was the remaining cost, because it still ran the full attribute work for every covered pixel, including those that were overwritten a moment later.

## The split

For plants, which are the draws that compaction already handles, the prepass now has two parts.

1. **Visibility prepass.** It writes depth and the visibility id only. It still runs the cut-out tests, the leaf's alpha and the distance fade, because those decide whether a pixel exists. It skips the material taps and the roughness and motion outputs.
2. **Attribute pass.** It runs after compaction. It draws only the triangles that won a pixel, and it fills in normal, roughness and metalness, and motion. This pass tests depth for equality, with no discard and no depth write.

The result is one fully shaded pixel per visible leaf pixel, where it was one per covered pixel. Everything that is not a compacted plant keeps the old prepass. I moved the prepass shader out of `Scene.hlsl` into `ScenePrepass.hlsli`, which leaves the general shader at 334 lines.

> **Background: the depth EQUAL technique.** Normally a depth test passes a fragment that is nearer than or equal to the stored depth (LESS_EQUAL). If a second pass draws the same geometry and the first pass already stored the nearest depth, changing the test to EQUAL makes only the fragment that is exactly the nearest one pass. All others, which are hidden, fail without running the pixel shader, and no depth needs to be written.
>
> EQUAL is only safe when both passes compute exactly the same depth value for the same triangle. Depth is a floating-point number produced by the vertex shader's position maths and the rasteriser. If the two passes use shaders compiled differently, the compiler may reorder floating-point operations, and the results can differ in the last bits. A triangle then fails the test against itself and disappears. This is why graphics code that uses EQUAL often marks position calculations `precise`, or invariant, or shares one compiled function between passes.

## Two things that went wrong first

**A cheaper vertex shader broke the depth match.** One of my vertex shader variants, the `CURRENT_ONLY` variant, computes both this frame's and last frame's position, the latter for motion vectors. I made it skip last frame's position, which should be a pure saving. The compiled maths for this frame's position changed enough that the leaves' depth no longer matched the visibility prepass. The EQUAL test then discarded most leaves. I reverted it. That variant is still identical to the normal one. This is the problem described above, and the follow-up at the end of this entry records the conditions under which it could be revisited.

**The driver ignored the id target.** In the visibility prepass, I switched off the write mask of render target 0, because the pass no longer produces a normal. With that mask off, the visibility id target was not written either, and `LeafPopTests` lost 68% of the compacted leaves. I found it by toggling the pixel shader, the vertex shader and the masks one at a time until the loss followed the mask. The pass now writes a zero normal to target 0, and the attribute pass overwrites it for the winners. I treat this as a quirk to be aware of in this pipeline: a write mask on target 0 changes what lands in the other targets.

## Results

I ran the benchmark on an RTX 4070, with the editor closed, as two before and after pairs that agreed within 0.02 ms. Times are GPU frame time in milliseconds.

| Scene | Poses | Frame, before to after | Prepass | Attribute pass and compaction |
|---|---|---|---|---|
| Day woods (1600 by 900) | 12 | −0.22 to −0.45 (−3 to −7%) | −0.27 to −0.51 | +0.08 to +0.14 |
| Night woods | 11 | −0.24 to −0.56 (−5 to −10%) | | |
| House, kitchen | 15 | within noise | | |

At the path start in the day woods the frame went from 6.11 to 5.76 ms, and the prepass from 2.70 to 2.28 ms. The attribute pass adds back part of the saving, since it still shades the winning pixels, so the gain is smaller than the work removed from the prepass.

The images did not change. No pixel in any scene differed by more than 12 levels, and the mean difference was 0.00 to 0.03. The few single-pixel peaks are depth ties.

![Path start after the change](/images/2026-11-03-leaf-prepass/path_start-after.jpg "The path start after the split. It is visually identical to the render before the change.")

![Long stretch after the change](/images/2026-11-03-leaf-prepass/long_stretch-after.jpg "The long stretch after the split. No pixel differs by more than 12 levels from the render before.")

### Verification

- `LeafPopTests` passes with the same numbers as before: the compacted result against whole draws differs by 0.00002 at 4 m and at 6 m.
- The frame-spike walk at 1440p gave a mean of 9.79 ms, against 10.48 ms at the sun dapple merge, a worst frame of 12.13 ms and no spikes.
- The full `ctest` run passes, 121 of 121.
- Run on its own, `ShaderCompileTests.exe` reports four failures that master also has. They are source-text checks about light packing, embedded shaders and the F8 material views. They do not come from this change.

## Open issues

- The prepass still takes 2.3 ms at the path start. The vertex work for 10 M triangles and the depth overdraw remain. A vertex shader without last frame's position would only work if every pass that tests EQUAL uses the same compiled position maths, through `precise` or one shared function compiled once.
- The four stale `ShaderCompileTests` checks need updating to the current code.
