# How posts are written

This blog is the public dev diary of the CC Horror Engine, a from-scratch C++20 / DirectX 12 survival-horror engine and editor aimed at the look of Resident Evil 7 / Village. It is a portfolio piece: a reader should come away understanding what was built, why, and how it works, including the graphics and engine concepts behind it.

The source of truth is the engine's own diary in `C:\CC_Engine\Docs\DevDiary\*.md` (an index is in `C:\CC_Engine\Docs\DevDiary.md`) and its screenshots in `C:\CC_Engine\Docs\Diary\<date>-<topic>\`. Roadmap and API docs in `C:\CC_Engine\Docs\` can fill in background. Never invent features, numbers or results the sources don't support.

## Voice

- First person, as the engine's developer ("I", "my engine"). Warm, plain and curious, not salesy. Short sentences.
- Explain like you're talking to a smart friend who plays games but has never written a renderer. Define every term the first time it appears (e.g. "a *shadow map* is a depth picture taken from the light's point of view…").
- Each feature gets three layers: **what I added and why** (the problem I saw), **the theory** (the concept in simple, accurate terms; an analogy helps), and **the practice** (how it actually works in this engine: passes, data, the trade-off chosen, what it costs).
- Be honest: mention what went wrong, what was hard, what's still open. Diary entries often mention bugs found and fixed; those make good stories.
- The diary was written for an internal log; do not copy its sentences. Rewrite in your own words. Leave out branch names, commit hashes, internal ticket codes (B4, R8c, W5h …) unless a code helps (then explain it once), file paths, and tool flags. Keep benchmark numbers that tell a story (e.g. "GPU time fell from 9.1 ms to 5.0 ms").
- The engine uses AI agents (Claude, via an MCP server built into the editor) as development help. It's fine to say so plainly where the diary does; don't make it the focus of every post.
- No personal details about anyone (names, emails, locations). The owner is just "I".

## Structure of a post

1. One or two opening paragraphs: where the engine stood that day and what I set out to do.
2. `##` sections, one per thing that was built. Inside each, the what/why, the theory and the practice. Use `###` sparingly.
3. At least one concept box per post, a blockquote starting with a bold label:

   ```markdown
   > **Concept: Screen-space reflections.** Instead of rendering the scene a second time from a mirror's point of view, …
   ```

   Labels that get the box style: `Concept:`, `Theory:`, `In practice:`, `Note:`.
4. Short close: what it looked like at the end of the day, what was still rough, what came next.

Length: about 900 to 1,800 words. Tables are fine for before/after numbers. Small code or pseudo-code snippets are fine when they make a concept click (HLSL, C++ or C#), kept to a few lines.

## Files

- One post = one file `posts/<date>-<short-slug>.md`, e.g. `posts/2026-09-28-shadows.md`. Lowercase, hyphens, no more than ~5 words in the slug.
- Front matter, exactly these keys:

  ```markdown
  ---
  title: Shadows from the lights that matter
  date: 2026-09-28
  order: 4
  summary: One sentence (max ~160 characters) that says what the post covers.
  tags: renderer, shadows
  cover: /images/2026-09-28-shadows/flashlight-door.jpg
  ---
  ```

  - `date` is the real day the work happened (from the diary).
  - `order` sorts posts that share a date (1, 2, 3 … in the order the work happened that day). Use the order numbers you were given.
  - `tags`: 1–3 from: renderer, lighting, shadows, materials, post-processing, performance, editor, tools, ai-tooling, scene, physics, gameplay, scripting, animation, assets, audio, outdoors, weather, foliage, architecture, retrospective.
  - `cover`: one of the post's images, the most striking one.
  - Don't put a colon followed by a space inside `title` or `summary` unless the whole value is in double quotes.

## Images

- Use the diary's screenshots for the work in your post, 2–6 per post. Copy each chosen file into `public/images/<post-slug>/` (same name as the post file without `.md`) and reference it as `/images/<post-slug>/<file>.jpg`.
- Look at an image before choosing it (open it with the Read tool); pick the clearest before/after pairs and the most atmospheric shots.
- Put each image on its own line, with alt text and a caption in the title:

  ```markdown
  ![The hallway with shadows from the flashlight](/images/2026-09-28-shadows/flashlight-door.jpg "The flashlight now casts a real shadow: the door frame's edge falls across the wall.")
  ```

- **Do not use any image that contains a frame from Resident Evil or any other commercial game or film**: these are copyrighted. In the diary folders that usually means files with `reference`, `vs-reference`, `vs-ref` or `ref` in the name, or any side-by-side that has a game screenshot on one half. Look at the image and skip it if in doubt. Describing a reference in words ("RE7's kitchen has…") is fine.
- Skip images of benchmark text, raw debug overlays nobody can read, and files that aren't screenshots.
- You may add your own explanatory diagram where it really helps a concept (e.g. how a shadow map works, how cascades split the view). Make it a small hand-written SVG file saved as `public/images/<post-slug>/<name>.svg` and reference it like any image. Diagram rules: viewBox about 720×360, transparent or `#0b0b0b` background, strokes and text in `#cfcfcb` / `#8d8d89`, one accent `#d8b67a`, font-family `Inter, sans-serif`, 14–16 px text, plenty of whitespace, no overlapping labels. You can't preview an SVG, so keep it simple enough to be correct by construction: compute coordinates, leave margins, keep labels short. At most one diagram per post, and none is fine.

## Don'ts

- Don't run `npm run build` or touch `build.mjs`, `static/`, `package.json` or other people's posts.
- Don't create or edit anything in `C:\CC_Engine`; it is read-only source material.
- Don't write about things outside your assigned range.
