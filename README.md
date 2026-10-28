# CC Engine Dev Diary

The dev diary for the CC Horror Engine, a from-scratch C++20 / DirectX 12 survival-horror engine. Live at **https://cc-engine-devlog.vercel.app**.

## How it works

- Posts are Markdown files in `posts/`, named `<date>-<slug>.md`, with a small front matter block (`title`, `date`, `order`, `summary`, `tags`, `cover`).
- Images live in `public/images/<post-slug>/`.
- `build.mjs` turns them into static HTML in `dist/`, using `marked`. The theme is in `static/style.css`.
- Vercel runs `npm run build` on every push to `main` and serves `dist/`.

`WRITING.md` describes the voice and structure every post follows.

## Adding a post

```bash
npm install
npm run build
```

Write `posts/<date>-<slug>.md`, put its screenshots in `public/images/<date>-<slug>/`, build to check that no image is missing, then commit and push.
