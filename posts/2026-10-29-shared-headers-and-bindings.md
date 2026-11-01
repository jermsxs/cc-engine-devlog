---
title: One header for C++ and HLSL, and root signatures written as data
date: 2026-10-29
order: 3
summary: I declare each constant buffer once for both languages, and describe all 27 root signatures as data so every shader's bindings can be checked against them.
tags: renderer, architecture
cover: /images/2026-10-29-shared-headers-and-bindings/live-shared-header.jpg
---

Track G is my work on the shader layer: the compiler, the cache, the program registry and live reload. By the end of the previous day the engine compiled its HLSL with DXC at Shader Model 6.5, started 70 programs through one registry, and reloaded edited shaders while the editor ran. What it still had were two hand-maintained agreements between C++ and the shaders. The first was the layout of every constant buffer. The second was the set of inputs each shader expects, which the C++ side had to match when it built a root signature. Both agreements were checked only by hand or by luck. Today's two steps, G6 and G7, move each one into a single place and make the second one checkable by a program.

## Two copies of every constant buffer

Before G6, every constant buffer the renderer fills was declared twice: in HLSL, for the shader, and in C++ (`ShaderConstants.h`), for the code that writes the bytes. A test compared the two and caught drift, but every new field still meant editing two files in step.

### Background: how a constant buffer is laid out

A constant buffer is a block of bytes. The CPU fills it and the GPU reads fields out of it at byte offsets. The shader compiler decides those offsets, and the C++ code has to arrive at the same ones by its own rules. HLSL's rules are these:

- Memory is divided into 16-byte rows, the size of a `float4`. This is called packing.
- A member is placed in the current row if it fits entirely. If it would cross into the next row, it starts at the next row instead. A `float3` followed by a `float` fits in one row. A `float3` followed by a `float2` does not, because 12 + 8 is more than 16, so the `float2` moves to the next row.
- Every array element starts on a new row. `float weights[4]` occupies 64 bytes, not 16.
- A matrix is stored by rows or by columns depending on a declaration, and the CPU has to write it the same way.

C++ aligns each member to its own size and does not care about 16-byte rows. A struct with a `float3` and a `float2` puts the `float2` at byte 12:

```hlsl
cbuffer Example { float3 a; float2 b; }   // b at byte 16
```

```cpp
struct Example { float3 a; float2 b; };   // b at byte 12
```

![The same two members laid out by HLSL and by C++](/images/2026-10-29-shared-headers-and-bindings/packing.svg "HLSL starts b in the next 16-byte row, byte 16. C++ places it at byte 12. The shader reads four bytes of padding and half of b.")

Nothing reports this. Both sides compile, the GPU reads whatever is at the offset the shader expects, and the values are wrong: a light intensity read from the middle of a position, a roughness read from padding. The picture is slightly off rather than visibly broken, which makes the fault hard to find. The rules are simple, but a new field added to one of two files is easy to get wrong.

### How I removed the duplication

Each layout is now written once, in a header under `Engine/Renderer/Shaders/Shared/`, and both languages include it. There are 16 headers. They hold the frame, object, material and light data, the shadow faces, decals and reflection probes, the preview, bloom, exposure, TAA, Hi-Z, screen-space, fog, rain and shadow-pass constants, and the foliage visibility records.

A small prelude header gives C++ the HLSL type names (`float4`, `uint4`, `float4x4`). Each member is one macro line that names the field in both languages. C++ keeps `meter`, HLSL keeps `gExposureMeter`, so no shader code had to change:

```cpp
CC_CBUFFER(ExposureConstants, ExposureCB, 0)
    CC_FIELD(float4, range, gExposureRange) // x = min EV100, y = max EV100, ...
    CC_FIELD(float4, meter, gExposureMeter) // x = adaptation, y = anchor EV100
CC_END
```

In HLSL the macros expand to a `cbuffer` at the given register. In C++ they expand to a struct. C++ then reads each header a second time with a different set of macro definitions, which produces a table of every field's HLSL name, its offset and its size. The layout test I have run since G1 now checks against these generated tables. It reflects every compiled shader and compares each member's offset with the table. It also covers four layouts that had no check before: the rain constants, the decal records, the reflection-probe records and the visibility records.

The macros are one half of the safety. The other half is a rule I follow inside constant buffers: members are `float4`, `uint4`, arrays of `float4` and `row_major float4x4`, all multiples of 16 bytes. With those types, HLSL's packing and C++'s natural layout agree, so the `float3` plus `float2` case cannot arise. Structured-buffer records, which pack tightly, may use a `float3` and a `float` side by side.

The change removed some numbers I had typed twice. `Visibility.hlsl` had the command buffer's layout written out as `65536 * 20 + 16` and a stride of `20`. It now reads the same constants as C++, as do the light count, light type and preview light constants, which were `#define`s copied by hand.

### Shared functions

Small pure functions were in the same situation. A function written once in HLSL and copied into C++ for the tests and the bakers can drift just as a struct can. The following now live in shared headers (`BrdfMath.h`, `ScreenMath.h`, `LeafMath.h`) that both languages compile:

- the GGX pieces: roughness to alpha, the widening for a light's source size, the distribution term and the visibility term;
- the Hi-Z footprint;
- the scale of the lens distortion;
- the share of leaves that a sun shadow keeps.

For C++, the prelude supplies the few HLSL intrinsics those functions call (`saturate`, `clamp`, `max`, `sqrt` and similar). A shared function may call nothing else, which keeps the two compilations in agreement.

### Live reload knows the headers

The editor already watched `.hlsl` files. It now watches the `.h` files as well, and a saved header reloads exactly the programs that include it: `Frame.h` reloads the scene and post-process shaders, and `HiZ.h` reloads only the Hi-Z ones. The headers sit inside the shader folder, so the build's copy step, the watcher and the reload test needed no changes.

![The hallway in the editor before the edit](/images/2026-10-29-shared-headers-and-bindings/editor-before.jpg "The editor before the edit.")

![The same view after the lens distortion's scale was exaggerated in a shared header](/images/2026-10-29-shared-headers-and-bindings/live-shared-header.jpg "I exaggerated the lens distortion's scale in Shared/ScreenMath.h while the editor ran. The status bar reports 4 programs and 3 pipelines reloaded in 79 ms. The same function is what LensDistortionTests checks on the CPU. I restored the file afterwards.")

### Results of G6

The images are the same as G5's in all five test scenes, measured with TAA off. The hallway and the house are bit-identical. The kitchen and the woods have a few pixels that differ by up to 17 levels out of 255. G4 against G5, with no shader change between them, shows the same speckle, so it comes from run-to-run variation (rain and leaves), not from this change.

Mean GPU milliseconds per scene, TAA on:

| Scene | G5 | G6 |
|---|---|---|
| Hallway | 3.911 | 3.900 |
| House | 3.807 | 3.656 |
| Kitchen | 3.223 | 3.219 |
| Woods | 8.586 | 8.607 |
| Night woods | 8.896 | 8.895 |

All of these are within noise. `ctest` passes 118 of 118. The frame-spike walk passed with no spikes (woods: mean 9.57 ms, worst 10.97 ms; night woods: mean 9.90 ms, worst 12.87 ms).

Two deviations from the plan are worth recording. The headers are in `Engine/Renderer/Shaders/Shared/`, not `Engine/Renderer/Shared/` as I had planned, because that location lets the copy step, the watcher and the reload test work unchanged. And the small root-constant blocks of individual passes are still plain arrays in C++.

## Root signatures as data

The second agreement is between a shader and the root signature it runs under. The renderer had 27 root signatures, each assembled by hand in the pass file that used it: about 1,000 lines of near-identical setup code.

### Background: what a root signature is

A shader names its inputs by register: `b1` for a constant buffer, `t3` for a texture or buffer, `u0` for a read-write resource, `s0` for a sampler. It does not say where the data comes from. That is the job of the root signature. It lists the parameters the CPU will bind before a draw or dispatch and says which registers each one covers. A pass binds a parameter by its index in that list, so the order matters.

A root parameter is one of three kinds:

- **Root constants.** A few 32-bit values stored directly in the parameter. They are the fastest way to give a shader a small block of data, and appear in HLSL as a `cbuffer`.
- **Root descriptors.** A GPU address for a constant buffer, or for a raw or structured buffer SRV or UAV. Textures cannot be bound this way.
- **Descriptor tables.** A pointer to a run of descriptors in a descriptor heap. Each range in the table has a type, a count and a first register, so one table can cover `t8` to `t11` for four textures. This is the general mechanism and the only one for textures.

A root signature has a budget of 64 32-bit words, and each kind costs differently: one word per root constant, two for a root descriptor, one for a table. Static samplers are baked into the signature and cost nothing. Each parameter also has a visibility: all shader stages, or only one, such as the pixel shader.

If a shader reads a register that nothing covers, the result depends on where it fails. The pipeline might refuse to build with an HRESULT, or the shader might read an unbound resource and produce garbage. A constant buffer bigger than the struct the pass writes reads past the data.

### How I wrote them as data

Each root signature is now a short description in one file, `RootSignatures.cpp`: its parameters in order, its static samplers and its flags. The engine builds every root signature from those descriptions. The scene pass starts like this:

```cpp
Srv(ObjectBufferRegister),                    // 0: gObjects, the draw's instances
Cbv(1, FrameBytes),                           // 1: FrameCB
Table({ Srvs(SceneShaderSrvTableCount, SceneShaderSrvRegisterStart, Append) }, Pixel), // 2: the shadow atlas
```

It has 15 parameters. By the costing rules above they take 29 of the 64 words. The registry from G4 names the root signature each program uses.

To prove the change moved nothing, I dumped the 27 old root signatures as bytes before the switch. Every one rebuilt from the new descriptions was byte-identical.

### Background: checking bindings with reflection

A compiled shader carries a description of the resources it reads. D3D12's shader reflection interface lists them: each resource's name, kind, register, register space, the number of array slots it binds and, for a constant buffer, its size. That is enough to compare a shader against a root signature without running anything.

For each compiled shader my check reads every register the shader uses and compares it with the description of the root signature the program runs under. It reports:

- a register that no root parameter, table range or static sampler covers, or covers only for another shader stage;
- a texture or typed UAV on a root descriptor, which D3D12 allows for buffers only;
- a table that starts at the register but is too short for the array;
- a constant buffer whose size differs from the C++ struct the root parameter says the pass fills.

### Where the check runs

- **The shader test**, for all 70 programs on both compilers (FXC was still in the build). Seven shaders with planted mistakes prove that it catches each kind: 140 compiled programs checked.
- **The reload test**, over every pipeline the renderer made. This also catches a pipeline built with a different root signature than its programs are registered with.
- **Debug builds**, before each pipeline is created.
- **Every live reload in the editor.** An edit that reads an input nothing provides is now rejected with a message naming the program, the root signature and the register. Before this, it either failed with an HRESULT or quietly read garbage.

I tested the editor case by editing the post-process shader while the editor ran, so that it read a texture at `t9`, a register the post root signature does not provide. The reload was refused and the frame stayed as it was. The status bar reads: "Shader error, the old shaders stay: PostPS (Post root signature): gUnboundOnPurpose (t9): no root parameter of the Post root signature covers it". I then restored the file.

![The editor before the edit](/images/2026-10-29-shared-headers-and-bindings/editor-g7-before.jpg "The hallway in the editor before the shader edit.")

![The editor after a reload refused by the binding check](/images/2026-10-29-shared-headers-and-bindings/reload-rejected.jpg "The same editor after the edit. The reload is refused, the old shaders keep running and the status bar at the bottom names the register.")

### What the check found

It found two real faults in code that already worked.

- The scene pass reserved 8 root constants for its per-draw block, but the shader declares only 4. The other four were zeroed every frame and never read. The block is now 4 values.
- The registry listed the SSR trace shader under the SSR resolve's root signature, but its pipeline uses the one for GTAO. The registry entry, from G4, was wrong. It is fixed.

### Results of G7

The images match G6's in all five scenes (`--no-taa`, mean difference 0.000). The hallway and the house are bit-identical. The kitchen and the woods show the same few-pixel speckle as every run. Mean GPU milliseconds, TAA on:

| Scene | G6 | G7 |
|---|---|---|
| Hallway | 3.900 | 3.991 |
| House | 3.656 | 3.690 |
| Kitchen | 3.219 | 3.255 |
| Woods | 8.607 | 8.584 |
| Night woods | 8.895 | 8.941 |

These are within noise. `ctest` passes 118 of 118. `ShaderReloadTests` checks every pipeline and confirms that an edit reading `t9` is rejected. With the old SSR trace registry entry put back, the test fails and names it. The frame-spike walk passed with no spikes (woods: mean 9.55 ms, worst 12.02 ms; night woods: mean 10.01 ms, worst 12.75 ms). A Debug build starts every scene's pipelines with the check switched on.

## Open issues

- Most trilinear static samplers have a `MaxLOD` of 0, so they read only the top mip of whatever they sample. That is how they have always worked, and written as data it is now easy to see. I want to check whether any of their textures has mips that should be used. The clouds' tiling noise is the likeliest. That would change images, so it needs its own measured step.
- The per-pass root-constant blocks are still plain arrays in C++. Their sizes are checked against the shaders now, but their fields are not shared yet.
- Most of the BRDF code beyond the scalar pieces (Fresnel, the sheen lobe, the environment approximation) is still mirrored in both languages. It works on `float3` in HLSL and one channel in C++, and sharing it needs a small vector type for C++.
- The prelude is prepared for a CUDA branch, but nothing compiles under `nvcc` yet. That waits on my decision to add `nvcc` to the build.
- The integer-hash question from G2 is still open. G8 is next: one measured use of Shader Model 6.
