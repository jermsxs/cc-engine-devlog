The **CC Horror Engine** is a survival-horror engine and editor I'm building from scratch in C++20 and DirectX 12, for Windows. The visual target is the look of Resident Evil 7 and Village: dim, grimy, realistic interiors, lit like a film rather than a game.

![A dim hallway with a wall lamp, framed paintings and a window at the far end](/images/2026-10-28-five-months-in/game-start.jpg "The hallway that started it all.")

## What's in it

- **Renderer.** DirectX 12, physically based lighting, shadows for the lights that matter, clustered lighting, lightmaps and probes, ambient occlusion, screen-space reflections and indirect light, volumetric fog and clouds, temporal anti-aliasing, and a camera pipeline with bloom, auto-exposure, colour grading and film grain.
- **Materials.** Scanned PBR materials, wear and grime layers, decals, parallax relief, texture compression and streaming.
- **World.** Physics, a first-person player who can crouch, lean, carry and throw, doors, triggers, light switches, skeletal animation, an enemy, and weather: rain, wet surfaces, lightning.
- **Editor.** A custom immediate-mode UI with docks, a model viewer, a material library and live asset reload. AI agents can drive the editor through an MCP server, with every edit undoable.
- **Scripting.** Gameplay in C#, hosted by the engine through .NET.

There are no third-party libraries: everything above is written on top of the Windows SDK.

## About this diary

Every work session ends with an entry in the engine's own dev diary, with screenshots and benchmark numbers. This site turns those entries into readable posts: what I added, why, the theory behind it, and how it works in practice.

The first goal is a 3 to 5 minute playable demo: a haunted hallway, a few interactions, and one quiet scare.
