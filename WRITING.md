# How posts are written

This blog is my public dev diary for the CC Horror Engine, a from-scratch C++20 / DirectX 12 survival-horror engine and editor aimed at the look of Resident Evil 7 and Village. It is a portfolio piece. A reader (another engine or graphics programmer, a studio lead, a technical artist) should come away understanding what I built each day, the theory behind it, and how my implementation works.

The source of truth is the engine's own diary in `C:\CC_Engine\Docs\DevDiary\*.md` (index: `C:\CC_Engine\Docs\DevDiary.md`) and its screenshots in `C:\CC_Engine\Docs\Diary\<date>-<topic>\`. `C:\CC_Engine\Docs\Roadmap.md`, `C:\CC_Engine\Docs\DeveloperAPI.md` and the engine source in `C:\CC_Engine\Engine\` can fill in how something works. Never invent features, numbers or results the sources don't support.

## Point of view: always me, first person

I am the engine's developer and the only author. Every post is written by me, about my work, in the first person singular.

- Use "I", "my engine", "my renderer". Never "we" (except "we" meaning people in general is also out; rephrase).
- Every decision, observation, preference, fix and measurement is mine: "I decided", "I noticed", "I prefer matte surfaces", "I measured".
- The diary was written as an internal log and often refers to "the owner", "the user", "the project owner", "the agent", "the reviewer", or says things like "the owner asked for…", "per the owner's request", "the owner dislikes…". Convert all of these to me: "I wanted…", "I decided…", "I don't like…". Never write "the owner", "the user", "the developer", "he", "she", or "they" when the subject is me, and never describe my own choices as someone's request or instruction to me.
- AI agents: I built an MCP server so AI agents can drive my editor, and I use agents as development help. Mention this only where the post is about that tooling (the MCP server, batch tools, agent-facing tools). Even then, the work and the decisions are mine: "I built the house using only the editor's MCP tools, the same tools an agent would use", not "the agent built the house". Don't credit an agent or reviewer with a finding; write "I found", "a review found" at most.

## Tone: professional, plain, easy to read

Write like a senior engine programmer's technical blog: calm, precise, concrete. Easy to read does not mean casual.

- No jokes, puns, wordplay, cute headings or dramatic language. No exclamation marks. No rhetorical questions.
- No slang or chatty filler. Avoid, for example: "honest(ly)", "here's the thing", "the catch", "the trick", "turns out", "sure enough", "nasty", "annoying", "sneaky", "culprit", "villain", "magic", "fancy", "boom", "game changer", "a twist", "keep its head", "territory", "the fun part", "let's", "spoiler", "plot twist", "in a nutshell", "deep dive", "under the hood", "the real output", "for free" (say "at no extra cost" only if literally true).
- No emotive adjectives about my own work ("beautiful", "gorgeous", "amazing", "huge win", "finally"). Let numbers and screenshots carry the result.
- No anthropomorphising code ("the shader wants…", "the GPU is happy").
- Short to medium sentences. One idea per paragraph. Prefer the specific number or name over a vague word.
- Headings are plain and descriptive, in sentence case: "How a shadow map works", "Choosing which lights cast shadows", "Results". Titles likewise: "Shadow maps for the flashlight and the nearest lamps", not "Shadows from the lights that matter".
- Be candid about problems in a matter-of-fact way: "The first version leaked light under the walls because…", not "This was a disaster".

## Depth: explain the graphics and engine concepts properly

This is the most important part. Each technique in a post gets a real explanation that a programmer new to rendering could follow, tied to what I saw in my engine.

For each main technique or system in the post:

1. **The problem.** What I saw in the engine (refer to the screenshot or the measurement) and why it mattered for the target look or the frame budget.
2. **How it works in general.** The theory, explained from first principles:
   - the physical or visual phenomenon being modelled (e.g. why contact shadows are sharp and far shadows are soft; why wet surfaces get darker and glossier);
   - the standard technique used in real-time rendering, step by step (what is rendered or computed, in which pass, from which inputs, stored where);
   - the key formula or rule where it helps, written in plain text or a short code block and then explained in words (e.g. inverse-square falloff, the GGX distribution's role, Beer–Lambert absorption, the reprojection step in TAA);
   - its usual artifacts and limits (acne, peter-panning, ghosting, light leaks, popping, banding) and why they happen;
   - the cost and how it scales.
   Put the general explanation in a `> **Background: ...**` box when it is a self-contained aside, or in a `##` section titled "How X works" when it is long. Most posts need two to four of these.
3. **How I implemented it.** My specific choices and why: resolutions, counts, passes, data layouts, the trade-offs I picked, what I tried that didn't work. Connect it back to the theory explicitly: "Because a lightmap texel covers 10 cm and the door lining is 8.8 cm deep, …".
4. **Results.** Before/after numbers (GPU ms, memory, counts) and screenshots, and what still isn't right.

Diagrams, short HLSL/C++/C# snippets and small tables are encouraged when they make a concept clearer. Keep code to a few lines.

## Structure of a post

1. Opening paragraph or two: where the engine stood that day and what I set out to do. No preamble like "In this post…".
2. `##` sections per feature, each following the depth pattern above.
3. A short closing section, e.g. `## Results` and/or `## Open issues`, stating what worked, what it cost, what is still wrong and what I'm doing next. No sign-off lines.

Length: about 1,500 to 2,800 words. Prefer depth on the concepts over listing every small fix; small fixes can be a short list.

## Files

- One post = one file `posts/<date>-<short-slug>.md`. Keep the existing file name and slug when rewriting (image folders depend on it).
- Front matter, exactly these keys:

  ```markdown
  ---
  title: Shadow maps for the flashlight and the nearest lamps
  date: 2026-09-28
  order: 4
  summary: One plain sentence (max ~160 characters) saying what the post covers.
  tags: renderer, shadows
  cover: /images/2026-09-28-shadows/flashlight-door.jpg
  ---
  ```

  - `date` is the real day of the work; `order` sorts posts on the same date. Keep the existing values.
  - `tags`: 1–3 from: renderer, lighting, shadows, materials, post-processing, performance, editor, tools, ai-tooling, scene, physics, gameplay, scripting, animation, assets, audio, outdoors, weather, foliage, architecture, retrospective.
  - `cover`: the post's most representative screenshot (an engine render, not a chart or a diagram, when one exists).
  - Don't put a colon followed by a space inside `title` or `summary` unless the whole value is in double quotes.

## Images

- Use the diary's screenshots, 2–6 per post. Copy each into `public/images/<post-slug>/` and reference it as `/images/<post-slug>/<file>`. Remove images from that folder that the post no longer uses.
- Open an image with the Read tool before choosing it. Prefer clear before/after pairs and representative views.
- Each image on its own line, with alt text and a plain, factual caption in the title:

  ```markdown
  ![The hallway with the flashlight's shadow](/images/2026-09-28-shadows/flashlight-door.jpg "The flashlight's shadow map: the door frame's edge casts a hard shadow on the wall.")
  ```

- **Never use an image that contains a frame from Resident Evil or any other commercial game or film, or someone else's photo.** In the diary folders these are usually named with `reference`, `vs-reference`, `vs-ref` or `ref`, or are side-by-sides with a game frame on one half. Look at the image; skip it if in doubt. Describing a reference in words is fine.
- Skip unreadable debug overlays, benchmark text dumps and non-screenshots.
- Diagrams: you may write one small SVG per post where it clarifies a concept, saved as `public/images/<post-slug>/<name>.svg`. Rules: viewBox about 720×360, background `#0b0b0b`, strokes and text `#c8c8c8` / `#8a8a84`, one accent `#d9c591`, `font-family="Georgia, serif"`, 14–16 px text, generous margins, no overlapping labels. You can't preview SVG, so compute coordinates carefully and keep it simple. Existing diagrams may be kept.

## Don'ts

- Don't run `npm run build` or touch `build.mjs`, `static/`, `package.json`, `about.md` or other writers' posts.
- Don't create or edit anything in `C:\CC_Engine`; it is read-only source material.
- Don't write about work outside your assigned range.
