# Family Cookbook

The family's paper recipes as a website: searchable, filterable by category, favorites, and a
table view that shows each recipe as a one-glance grid.

**Live site:** `https://dannyleb.github.io/family-cookbook/` (once Pages is turned on, below)

## What it does

| Feature | How |
|---|---|
| Search | Matches title, ingredients, category, tags, who it's from, notes. `/` focuses the box. |
| Category filter | Chips under the search box. Order set in `cookbook.yml`. |
| Favorites | ☆ on any card or recipe. Saved **per device/browser** (no accounts). |
| Table view | Switch on each recipe. Ingredients down the left; each step spans what it combines. Choice is remembered. |
| Cooking aids | Tap ingredients to check them off. "Keep screen on" stops the phone sleeping (where supported). |
| Original card | Photo of the handwritten card shown at the bottom of the recipe. |
| Phone | Built mobile-first. "Add to Home Screen" gives it an app icon. Light/dark follow the phone. |

## One-time setup

1. Merge this work into `main`.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` rebuilds and deploys (takes ~1 min). Pull requests run the recipe check without deploying.

The site is public, like all GitHub Pages sites on a personal account. Don't put anything private in a recipe.

## Adding recipes

**Easiest:** send photos of the cards to Claude in this repo. Conventions are in `CLAUDE.md`.

**By hand:** copy `recipes/_template.yml` to `recipes/<name-with-dashes>.yml` and fill it in.
The template explains every field. Photos go in `images/` (run them through
`python3 scripts/prep_image.py photo.jpg images/<name>-card.jpg` first: it shrinks them and strips
GPS location data).

The build fails with a plain-English message if a recipe is broken (missing title, a step that
uses an ingredient that doesn't exist, a missing image), so a bad edit can't take the site down.

### How the table view is described

Each ingredient gets a short id; each step says what it `uses`:

```yaml
ingredients:
  - butter: 4 oz (115 g) unsalted butter
  - sugar: 1 cup (200 g) sugar
steps:
  - action: melt              # short label shown in the table
    uses: [butter]
    text: Melt the butter.    # full sentence shown in the normal view
  - action: mix
    uses: [previous, sugar]   # "previous" = result of the step before
    text: Stir in the sugar.
```

## Local preview

```sh
npm install
npm run serve      # builds, then serves at http://localhost:8080
npm run check      # validate recipes only
```

## Layout

```
recipes/        one .yml per recipe (files starting with _ are ignored)
images/         card scans and food photos
cookbook.yml    site title, subtitle, category order
site/           the web app (HTML/CSS/JS, no framework)
scripts/        build + validation, local server, photo prep
```
