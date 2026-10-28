// Builds the dev diary into static HTML in dist/.
// Posts are Markdown files in posts/ with a small front matter block; images live in public/.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const SITE = {
  title: 'CC Engine Dev Diary',
  tagline: 'Building a survival-horror engine from scratch, one session at a time.',
  author: 'ghostmountain3',
  url: 'https://cc-engine-devlog.vercel.app',
};

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const warnings = [];

// --- front matter -----------------------------------------------------------

function parsePost(file) {
  const raw = readFileSync(join(ROOT, 'posts', file), 'utf8').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    meta[kv[1]] = value;
  }
  for (const key of ['title', 'date', 'summary']) {
    if (!meta[key]) throw new Error(`${file}: front matter needs "${key}"`);
  }
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.title,
    date: meta.date,
    summary: meta.summary,
    order: Number(meta.order ?? 0),
    tags: (meta.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    cover: meta.cover ?? '',
    body: match[2],
  };
}

// --- markdown ----------------------------------------------------------------

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function checkAsset(href, slug) {
  if (href.startsWith('/') && !existsSync(join(ROOT, 'public', href))) {
    warnings.push(`${slug}: missing image ${href}`);
  }
}

function makeMarked(slug) {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      // A paragraph that holds only an image becomes a figure; the image title is its caption.
      paragraph(token) {
        const only = token.tokens?.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null;
        if (!only) return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
        checkAsset(only.href, slug);
        const caption = only.title ? `<figcaption>${escapeHtml(only.title)}</figcaption>` : '';
        return `<figure><a href="${only.href}" target="_blank" rel="noopener"><img src="${only.href}" alt="${escapeHtml(only.text)}" loading="lazy" decoding="async"></a>${caption}</figure>\n`;
      },
      image(token) {
        checkAsset(token.href, slug);
        return `<img src="${token.href}" alt="${escapeHtml(token.text)}" loading="lazy" decoding="async">`;
      },
      // "> **Concept: ...**" blockquotes become concept boxes.
      blockquote(token) {
        const inner = this.parser.parse(token.tokens);
        const cls = /^<p><strong>(Concept|In practice|Theory|Note)\b/i.test(inner) ? ' class="concept"' : '';
        return `<blockquote${cls}>\n${inner}</blockquote>\n`;
      },
      table(token) {
        return `<div class="table-wrap">${marked.Renderer.prototype.table.call(this, token)}</div>`;
      },
    },
  });
  return marked;
}

// --- templates ---------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const formatDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const readingMinutes = (md) => Math.max(1, Math.round(md.split(/\s+/).length / 230));

function layout({ title, description, body, path = '/', image = '' }) {
  const fullTitle = title ? `${title} · ${SITE.title}` : SITE.title;
  const ogImage = image ? `${SITE.url}${image}` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title || SITE.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="${path.startsWith('/posts/') ? 'article' : 'website'}">
<meta property="og:url" content="${SITE.url}${path}">
${ogImage ? `<meta property="og:image" content="${ogImage}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#000000">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.title)}" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="/">CC Engine<span>/</span>Dev Diary</a>
  <nav><a href="/">Diary</a><a href="/about/">About</a></nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>A from-scratch C++20 / DirectX 12 horror engine.</p>
  <p><a href="/feed.xml">RSS</a></p>
</footer>
</body>
</html>
`;
}

function postPage(post, prev, next) {
  const marked = makeMarked(post.slug);
  const html = marked.parse(post.body);
  const tags = post.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const nav = `<nav class="post-nav">
  ${prev ? `<a class="prev" href="/posts/${prev.slug}/"><span>← Earlier</span>${escapeHtml(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a class="next" href="/posts/${next.slug}/"><span>Later →</span>${escapeHtml(next.title)}</a>` : '<span></span>'}
</nav>`;
  const body = `<article class="post">
  <header class="post-header">
    <p class="meta"><time datetime="${post.date}">${formatDate(post.date)}</time><span>·</span>${readingMinutes(post.body)} min read</p>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="lead">${escapeHtml(post.summary)}</p>
    ${tags ? `<p class="tags">${tags}</p>` : ''}
  </header>
  <div class="prose">
${html}
  </div>
</article>
${nav}`;
  return layout({ title: post.title, description: post.summary, body, path: `/posts/${post.slug}/`, image: post.cover });
}

function indexPage(posts) {
  const newestFirst = [...posts].reverse();
  const groups = new Map();
  for (const p of newestFirst) {
    const [y, m] = p.date.split('-').map(Number);
    const key = `${MONTHS[m - 1]} ${y}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const first = posts[0];
  const sections = [...groups]
    .map(
      ([month, list]) => `<section class="month">
  <h2>${month}</h2>
  <ol class="post-list">
${list
  .map(
    (p) => `    <li><a href="/posts/${p.slug}/">
      ${p.cover ? `<img src="${p.cover}" alt="" loading="lazy" decoding="async">` : '<span class="no-cover"></span>'}
      <div><time datetime="${p.date}">${formatDate(p.date)}</time><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.summary)}</p></div>
    </a></li>`
  )
  .join('\n')}
  </ol>
</section>`
    )
    .join('\n');
  const body = `<section class="intro">
  <h1>Building a horror engine from scratch.</h1>
  <p>This is the diary of the CC Horror Engine: a C++20 and DirectX 12 engine and editor I'm writing without third-party libraries, aimed at the dim, grimy look of Resident Evil 7 and Village. Each post explains what I added, the theory behind it, and how it works in practice.</p>
  <p class="intro-links"><a href="/posts/${first.slug}/">Start from day one →</a><span>${posts.length} entries · ${formatDate(first.date)} to ${formatDate(posts[posts.length - 1].date)}</span></p>
</section>
${sections}`;
  return layout({ title: '', description: SITE.tagline, body, path: '/' , image: posts[posts.length - 1].cover });
}

function aboutPage() {
  const marked = makeMarked('about');
  const html = marked.parse(readFileSync(join(ROOT, 'about.md'), 'utf8'));
  const body = `<article class="post"><header class="post-header"><h1>About the engine</h1></header><div class="prose">${html}</div></article>`;
  return layout({ title: 'About', description: 'What the CC Horror Engine is and how it is built.', body, path: '/about/' });
}

function feed(posts) {
  const items = [...posts]
    .reverse()
    .map(
      (p) => `<item><title>${escapeHtml(p.title)}</title><link>${SITE.url}/posts/${p.slug}/</link><guid>${SITE.url}/posts/${p.slug}/</guid><pubDate>${new Date(p.date + 'T12:00:00Z').toUTCString()}</pubDate><description>${escapeHtml(p.summary)}</description></item>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${escapeHtml(SITE.title)}</title><link>${SITE.url}</link><description>${escapeHtml(SITE.tagline)}</description>
${items}
</channel></rss>
`;
}

// --- build ---------------------------------------------------------------------

const posts = readdirSync(join(ROOT, 'posts'))
  .filter((f) => f.endsWith('.md'))
  .map(parsePost)
  .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.slug.localeCompare(b.slug));

for (const p of posts) if (p.cover) checkAsset(p.cover, p.slug);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, 'public'), DIST, { recursive: true });
cpSync(join(ROOT, 'static'), DIST, { recursive: true });

posts.forEach((post, i) => {
  const dir = join(DIST, 'posts', post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), postPage(post, posts[i - 1], posts[i + 1]));
});
writeFileSync(join(DIST, 'index.html'), indexPage(posts));
mkdirSync(join(DIST, 'about'), { recursive: true });
writeFileSync(join(DIST, 'about', 'index.html'), aboutPage());
writeFileSync(join(DIST, 'feed.xml'), feed(posts));
writeFileSync(join(DIST, '404.html'), layout({ title: 'Not found', description: 'Page not found', body: '<section class="intro"><h1>Nothing here.</h1><p><a href="/">Back to the diary →</a></p></section>' }));

for (const w of warnings) console.warn('warning:', w);
console.log(`Built ${posts.length} posts into dist/${warnings.length ? ` with ${warnings.length} warnings` : ''}.`);
if (warnings.length && process.env.STRICT) process.exit(1);
