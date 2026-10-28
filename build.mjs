// Builds the dev diary into static HTML in dist/.
// Posts are Markdown files in posts/ with a small front matter block; images live in public/.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const SITE = {
  title: 'CC Engine Dev Diary',
  tagline: 'Notes from building a survival-horror engine from scratch in C++ and DirectX 12.',
  url: 'https://cc-engine-devlog.vercel.app',
};
const PER_PAGE = 8;

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
      // "> **Background: ...**" blockquotes become boxed explanations.
      blockquote(token) {
        const inner = this.parser.parse(token.tokens);
        const cls = /^<p><strong>(Background|Concept|In practice|Theory|Note|How it works)\b/i.test(inner) ? ' class="aside"' : '';
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
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parts = (iso) => iso.split('-').map(Number);
const formatDate = (iso) => {
  const [y, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const dayHeader = (iso) => {
  const [y, m, d] = parts(iso);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
};

function sidebar(posts, current) {
  const byMonth = new Map();
  for (const p of [...posts].reverse()) {
    const [y, m] = parts(p.date);
    const key = `${y}-${m}`;
    if (!byMonth.has(key)) byMonth.set(key, { label: `${MONTHS[m - 1]} ${y}`, list: [] });
    byMonth.get(key).list.push(p);
  }
  const currentMonth = current ? (([y, m]) => `${y}-${m}`)(parts(current.date)) : [...byMonth.keys()][0];
  const archive = [...byMonth]
    .map(
      ([key, { label, list }]) => `<details${key === currentMonth ? ' open' : ''}><summary>${label} <span class="count">(${list.length})</span></summary><ul>
${list.map((p) => `<li>${current && p.slug === current.slug ? `<strong>${escapeHtml(p.title)}</strong>` : `<a href="/posts/${p.slug}/">${escapeHtml(p.title)}</a>`}</li>`).join('\n')}
</ul></details>`
    )
    .join('\n');
  const tagCounts = new Map();
  for (const p of posts) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const labels = [...tagCounts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => `<li><a href="/labels/${t}/">${escapeHtml(t)}</a> <span class="count">(${n})</span></li>`)
    .join('\n');
  return `<aside class="sidebar">
<section>
<h2>About</h2>
<p>I'm building the CC Horror Engine, a survival-horror engine and editor written from scratch in C++20 and DirectX 12. This is my working diary: what I built each day, how it works, and what went wrong.</p>
<p><a href="/about/">More about the engine</a></p>
</section>
<section>
<h2>Blog archive</h2>
${archive}
</section>
<section>
<h2>Labels</h2>
<ul class="labels">
${labels}
</ul>
</section>
<section>
<h2>Subscribe</h2>
<p><a href="/feed.xml">Posts (RSS)</a></p>
</section>
</aside>`;
}

function layout({ title, description, body, path = '/', image = '', posts, current = null }) {
  const fullTitle = title ? `${SITE.title}: ${title}` : SITE.title;
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
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="outer">
<header id="header">
  <h1><a href="/">${escapeHtml(SITE.title)}</a></h1>
  <p class="description">${escapeHtml(SITE.tagline)}</p>
</header>
<div id="content">
<main id="main">
${body}
</main>
${sidebar(posts, current)}
</div>
<footer id="footer">
  <p>CC Engine Dev Diary &middot; written and built by hand &middot; <a href="/feed.xml">RSS</a></p>
</footer>
</div>
</body>
</html>
`;
}

const postFooter = (post) =>
  `<p class="post-footer">Posted on ${formatDate(post.date)}${post.tags.length ? ` &middot; Labels: ${post.tags.map((t) => `<a href="/labels/${t}/">${escapeHtml(t)}</a>`).join(', ')}` : ''}</p>`;

function postPage(post, prev, next, posts) {
  const html = makeMarked(post.slug).parse(post.body);
  const body = `<h2 class="date-header">${dayHeader(post.date)}</h2>
<article class="post">
  <h3 class="post-title">${escapeHtml(post.title)}</h3>
  <p class="post-summary">${escapeHtml(post.summary)}</p>
  <div class="post-body">
${html}
  </div>
  ${postFooter(post)}
</article>
<nav class="entry-nav">
  ${prev ? `<a class="prev" href="/posts/${prev.slug}/"><span class="label">&laquo; Previous entry</span><span class="date">${formatDate(prev.date)}</span>${escapeHtml(prev.title)}</a>` : '<span class="prev none"><span class="label">&laquo; Previous entry</span>This is the first entry.</span>'}
  ${next ? `<a class="next" href="/posts/${next.slug}/"><span class="label">Next entry &raquo;</span><span class="date">${formatDate(next.date)}</span>${escapeHtml(next.title)}</a>` : '<span class="next none"><span class="label">Next entry &raquo;</span>This is the latest entry.</span>'}
</nav>
<p class="back-home"><a href="/">Back to all entries</a></p>`;
  return layout({ title: post.title, description: post.summary, body, path: `/posts/${post.slug}/`, image: post.cover, posts, current: post });
}

// A post as it appears on the front page and label pages: title, picture, summary and a link.
function excerpt(p, showDate) {
  return `${showDate ? `<h2 class="date-header">${dayHeader(p.date)}</h2>\n` : ''}<article class="post">
  <h3 class="post-title"><a href="/posts/${p.slug}/">${escapeHtml(p.title)}</a></h3>
  <div class="post-body">
    ${p.cover ? `<a href="/posts/${p.slug}/"><img class="excerpt-image" src="${p.cover}" alt="" loading="lazy" decoding="async"></a>` : ''}
    <p>${escapeHtml(p.summary)}</p>
    <p class="read-more"><a href="/posts/${p.slug}/">Read the full entry &raquo;</a></p>
  </div>
  ${postFooter(p)}
</article>`;
}

function listing(list) {
  let lastDate = '';
  return list
    .map((p) => {
      const html = excerpt(p, p.date !== lastDate);
      lastDate = p.date;
      return html;
    })
    .join('\n');
}

function indexPages(posts) {
  const newestFirst = [...posts].reverse();
  const pages = Math.ceil(newestFirst.length / PER_PAGE);
  const out = [];
  for (let i = 0; i < pages; i++) {
    const href = (n) => (n === 0 ? '/' : `/page/${n + 1}/`);
    const intro =
      i === 0
        ? `<div class="welcome"><p>This diary follows the engine from its first commit in June 2026. Each entry covers one day or one feature: what I set out to do, the graphics or engine theory behind it, how I implemented it, and how I measured the result. <a href="/posts/${posts[0].slug}/">Start from the first entry</a>, or read the newest below.</p></div>\n`
        : '';
    const pager = `<nav class="blog-pager">
  ${i > 0 ? `<a class="newer" href="${href(i - 1)}">&laquo; Newer posts</a>` : '<span class="newer"></span>'}
  <span class="home">Page ${i + 1} of ${pages}</span>
  ${i < pages - 1 ? `<a class="older" href="${href(i + 1)}">Older posts &raquo;</a>` : '<span class="older"></span>'}
</nav>`;
    const body = intro + listing(newestFirst.slice(i * PER_PAGE, (i + 1) * PER_PAGE)) + '\n' + pager;
    out.push({ path: href(i), html: layout({ title: i ? `Page ${i + 1}` : '', description: SITE.tagline, body, path: href(i), image: posts[posts.length - 1].cover, posts }) });
  }
  return out;
}

function labelPages(posts) {
  const tags = [...new Set(posts.flatMap((p) => p.tags))];
  return tags.map((t) => {
    const list = [...posts].reverse().filter((p) => p.tags.includes(t));
    const body = `<div class="status-msg">Showing ${list.length} posts with the label <strong>${escapeHtml(t)}</strong>. <a href="/">Show all posts</a></div>\n${listing(list)}`;
    return { path: `/labels/${t}/`, html: layout({ title: `Label: ${t}`, description: `Posts labelled ${t}`, body, path: `/labels/${t}/`, posts }) };
  });
}

function aboutPage(posts) {
  const html = makeMarked('about').parse(readFileSync(join(ROOT, 'about.md'), 'utf8'));
  const body = `<article class="post"><h3 class="post-title">About the engine</h3><div class="post-body">${html}</div></article>`;
  return layout({ title: 'About', description: 'What the CC Horror Engine is and how it is built.', body, path: '/about/', posts });
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

const write = (path, html) => {
  const dir = join(DIST, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
};

posts.forEach((post, i) => write(`/posts/${post.slug}/`, postPage(post, posts[i - 1], posts[i + 1], posts)));
for (const page of indexPages(posts)) write(page.path, page.html);
for (const page of labelPages(posts)) write(page.path, page.html);
write('/about/', aboutPage(posts));
writeFileSync(join(DIST, 'feed.xml'), feed(posts));
writeFileSync(
  join(DIST, '404.html'),
  layout({ title: 'Not found', description: 'Page not found', body: '<div class="status-msg">Sorry, that page does not exist. <a href="/">Back to the diary</a></div>', posts })
);

for (const w of warnings) console.warn('warning:', w);
console.log(`Built ${posts.length} posts into dist/${warnings.length ? ` with ${warnings.length} warnings` : ''}.`);
if (warnings.length && process.env.STRICT) process.exit(1);
