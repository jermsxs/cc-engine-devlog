The **CC Horror Engine** is a survival-horror engine and editor that I am writing from scratch in C++20 and DirectX 12, for Windows. The visual target is the look of Resident Evil 7 and Village: dim, worn, realistic interiors lit the way a film would light them.

![A dim hallway with a wall lamp, framed paintings and a window at the far end](/images/2026-10-28-five-months-in/game-start.jpg "The hallway scene that the project started from.")

## Main systems

- **Renderer:** DirectX 12 with physically based shading, plus:
  - shadow maps for the lights that affect the view, and clustered lighting;
  - lightmaps and probes;
  - ground-truth ambient occlusion, screen-space reflections and screen-space indirect light;
  - volumetric fog and clouds, and temporal anti-aliasing;
  - a camera pipeline with auto-exposure, bloom, colour grading and film grain.
- **Materials:** scanned PBR materials, layered wear and grime, projected decals, parallax relief, block compression and texture streaming.
- **Simulation and gameplay:**
  - rigid-body physics;
  - a first-person player who can crouch, lean, carry and throw;
  - doors, triggers and light circuits;
  - skeletal animation and an enemy;
  - weather with rain, wet surfaces and lightning.
- **Editor:**
  - a custom immediate-mode UI with docking panels, a model viewer, a material library and live asset reload;
  - an MCP server, so external tools and AI agents can drive the editor with undoable edits.
- **Scripting:** gameplay logic in C#, with the .NET runtime hosted by the engine.

The engine uses no third-party libraries. Everything above is written against the Windows SDK.

## About this diary

I end every work session with an entry in the engine's internal diary, including screenshots and benchmark numbers. This site turns those entries into readable posts. Each one explains what I built, the theory behind it, and how my implementation works.

The first milestone is a 3–5 minute playable demo: a haunted hallway, a few interactions, and one scripted scare.
