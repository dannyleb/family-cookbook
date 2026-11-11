// Validates every recipe in recipes/ and builds the static site into dist/.
//   npm run build    -> validate + write dist/
//   npm run check    -> validate only
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { normalizeRecipe, layoutTable, refsIn, REF } from '../site/model.js';

const root = path.resolve(import.meta.dirname, '..');
const dirs = {
  recipes: path.join(root, 'recipes'),
  pages: path.join(root, 'pages'),
  images: path.join(root, 'images'),
  site: path.join(root, 'site'),
  dist: path.join(root, 'dist'),
};
const checkOnly = process.argv.includes('--check');

const rel = (p) => path.relative(root, p);
let failed = false;

// ---- cookbook settings -----------------------------------------------------
const book = {
  title: 'Family Cookbook',
  subtitle: '',
  categories: [],
  ...(yaml.load(await fs.readFile(path.join(root, 'cookbook.yml'), 'utf8')) || {}),
};

// ---- recipes ---------------------------------------------------------------
const files = (await fs.readdir(dirs.recipes))
  .filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith('_'))
  .sort();

const recipes = [];
for (const file of files) {
  const slug = file.replace(/\.ya?ml$/i, '');
  const src = path.join(dirs.recipes, file);
  let raw;
  try {
    raw = yaml.load(await fs.readFile(src, 'utf8'));
  } catch (e) {
    report(src, [`YAML syntax error: ${e.message.split('\n')[0]}`], []);
    continue;
  }

  const { recipe, errors, warnings } = normalizeRecipe(raw, slug);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    errors.push(`File name should be lowercase-with-dashes (e.g. "grandmas-meatballs.yml")`);
  }
  if (recipe) {
    for (const img of [recipe.image, ...recipe.scans].filter(Boolean)) {
      if (!existsSync(path.join(dirs.images, img))) errors.push(`Image not found: images/${img}`);
    }
    if (!errors.length) {
      const problem = checkTiling(layoutTable(recipe));
      if (problem) errors.push(`Table layout bug: ${problem}`);
    }
  }

  report(src, errors, warnings);
  if (recipe && !errors.length) recipes.push(recipe);
}

// ---- extra pages (letter, essay, charts) ---------------------------------------
const pages = [];
const pageFiles = existsSync(dirs.pages)
  ? (await fs.readdir(dirs.pages)).filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith('_')).sort()
  : [];
for (const file of pageFiles) {
  const src = path.join(dirs.pages, file);
  const errors = [];
  let raw;
  try {
    raw = yaml.load(await fs.readFile(src, 'utf8')) || {};
  } catch (e) {
    report(src, [`YAML syntax error: ${e.message.split('\n')[0]}`], []);
    continue;
  }
  const page = {
    slug: file.replace(/\.ya?ml$/i, ''),
    title: String(raw.title ?? '').trim(),
    link: String(raw.link ?? raw.title ?? '').trim(),
    order: Number(raw.order ?? 99),
    intro: String(raw.intro ?? '').trim(),
    outro: String(raw.outro ?? '').trim(),
    body: String(raw.body ?? '').trim(),
    columns: (raw.columns ?? []).map(String),
    sections: (raw.sections ?? []).map((sec) => ({
      name: String(sec.name ?? '').trim(),
      rows: (sec.rows ?? []).map((row) => String(row).split('|').map((c) => c.trim())),
    })),
  };
  if (!page.title) errors.push('Missing "title"');
  for (const sec of page.sections) {
    for (const row of sec.rows) {
      if (row.length !== page.columns.length) {
        errors.push(`"${sec.name}": row "${row.join(' | ')}" has ${row.length} cells, expected ${page.columns.length}`);
      }
    }
  }
  report(src, errors, []);
  if (!errors.length) pages.push(page);
}
pages.sort((a, b) => a.order - b.order);

const slugs = new Set(recipes.map((r) => r.slug));
for (const r of recipes) {
  for (const ref of refsIn(r)) {
    if (!slugs.has(ref)) report(path.join(dirs.recipes, `${r.slug}.yml`), [`Links to [[${ref}]], but there's no recipes/${ref}.yml`], []);
  }
}

for (const pg of pages) {
  for (const t of [pg.intro, pg.body, pg.outro]) {
    for (const m of t.matchAll(REF)) {
      if (!slugs.has(m[1])) report(path.join(dirs.pages, `${pg.slug}.yml`), [`Links to [[${m[1]}]], but there's no recipes/${m[1]}.yml`], []);
    }
  }
}

const slugsByTitle = new Map();
for (const r of recipes) {
  const key = r.title.toLowerCase();
  if (slugsByTitle.has(key)) console.warn(`! Two recipes are titled "${r.title}": ${slugsByTitle.get(key)}, ${r.slug}`);
  slugsByTitle.set(key, r.slug);
}

recipes.sort((a, b) => a.title.localeCompare(b.title));
console.log(`${recipes.length} recipe(s), ${pages.length} page(s) OK${failed ? ', with errors above' : ''}`);
if (failed) process.exit(1);
if (checkOnly) process.exit(0);

// ---- write dist/ -------------------------------------------------------------
await fs.rm(dirs.dist, { recursive: true, force: true });
await fs.cp(dirs.site, dirs.dist, { recursive: true });
if (existsSync(dirs.images)) {
  await fs.cp(dirs.images, path.join(dirs.dist, 'images'), {
    recursive: true,
    filter: (p) => !path.basename(p).startsWith('.'),
  });
}
await fs.writeFile(path.join(dirs.dist, 'recipes.json'), JSON.stringify({ book, recipes, pages }));
console.log(`Built ${rel(dirs.dist)}/`);

// ---- helpers -----------------------------------------------------------------
function report(file, errors, warnings) {
  for (const w of warnings) console.warn(`! ${rel(file)}: ${w}`);
  for (const e of errors) console.error(`✗ ${rel(file)}: ${e}`);
  if (errors.length) failed = true;
}

// Every grid slot must be covered by exactly one cell, or the HTML table breaks.
function checkTiling({ rows, cols, cells }) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const c of cells) {
    for (let r = c.row; r < c.row + c.rowspan; r++) {
      for (let k = c.col; k < c.col + c.colspan; k++) {
        if (r >= rows || k >= cols) return `cell "${c.text}" runs off the grid`;
        grid[r][k]++;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (grid[r][k] !== 1) return `slot row ${r + 1}, col ${k + 1} covered ${grid[r][k]} times`;
    }
  }
  return null;
}
