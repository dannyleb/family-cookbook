# Family Cookbook: working notes for Claude

Static site (GitHub Pages via Actions). Source of truth is `recipes/*.yml`; `scripts/build.mjs`
validates them and writes `dist/`. No framework; `site/model.js` is shared by the browser and the
build (validation + table layout).

## Transcribing a recipe from a photo

1. **Read the card carefully.** Transcribe faithfully: quantities, wording, the family's own
   phrasing. Don't modernize or "fix" silently. If something looks wrong or is illegible, keep what's
   written and add a line to `notes` (e.g. "Card says 3 Tbsp baking soda; probably tsp."). List
   anything you weren't sure of in your reply so the user can check it.
2. **File name:** `recipes/<lowercase-dashed-title>.yml`. Start from `recipes/_template.yml`.
3. **Fields:**
   - `title`, `category` (use the list in `cookbook.yml`; only add a new category if none fit)
   - `from`: whose recipe it is if the card says or the user tells you. Don't guess.
   - `serves`, `time`: only if stated or obvious from the card. Don't invent.
   - `tags`: a few useful search words (main ingredient, occasion, cuisine).
   - `description`: optional; one plain line. Skip rather than write filler.
4. **Ingredients:** one line each, as written, with a short id: `- butter: 1/2 cup butter`.
   Use `- heading: For the frosting` for sub-sections. If one ingredient is used in two places
   ("1 cup sugar, divided"), split it into two lines with the amounts per use, so each step can
   use its own (the table view requires each ingredient to feed exactly one step).
5. **Steps:** every step gets
   - `action`: short table label, lowercase, a few words ("cream", "simmer 20 min", "bake 350°F 25 min")
   - `uses`: ingredient ids and/or earlier step results; `previous` = the step before. A separate
     component (sauce, frosting) gets an `id` so a later step can combine it.
   - `text`: the full instruction for the normal view, close to the card's wording.
   Pre-heating and pan prep go in `before:`, not steps.
   - Words you add for clarity go in square brackets: `½ [cup] chicken broth`. If the card has
     no directions and you write the obvious ones, say so in `notes`.
   - Link another recipe with `[[slug]]` in any text (e.g. a spice mix used by a main). The build
     fails if the slug doesn't exist. A sub-recipe that makes more than one use (spice blends)
     gets its own file.
   - **Published sources** (newspaper clippings, magazines, websites): put the source in `from`
     (e.g. `The Italia (printed in Metroland)`), keep ingredients as printed, and write the
     directions as short steps in your own words rather than copying the prose. Don't attach
     scans of published pages; the site is public.
6. **Photo of the card:** keep it; family handwriting is part of the point.
   `python3 scripts/prep_image.py <upload> images/<slug>-card.jpg` (resizes + strips GPS/EXIF;
   never commit raw phone photos), then `scan: <slug>-card.jpg`. Multi-page: `scan: [a.jpg, b.jpg]`.
   Several recipes on one page share the same scan file.
   Ask before committing if the photo shows people, addresses, or anything private.
7. **Check:** `npm run check` must pass with no warnings for the new recipe. Warnings about unused
   ingredients or several unconnected steps mean the `uses` tree is wrong.
8. Commit one recipe per commit ("Add Grandma's meatballs") unless a batch was sent together.

## Code

- `site/model.js`: `normalizeRecipe` (validation) and `layoutTable` (grid layout). The build
  asserts the table tiles the grid exactly; keep that check passing.
- `site/app.js`: hash routing (`#/`, `#/recipe/<slug>`), search, chips, favorites (localStorage),
  table toggle, wake lock.
- Test UI changes in Playwright at phone width (iPhone SE/13) and desktop, light and dark.

## Family context

- The binder's sections (from its cover): Dad, Mom, Gramma Urs, Grammi Jan, Gramma Fi Fi,
  Great Great Grandma Sullivan, Adaptations, Essay on beer and wine.
- Who wrote which page isn't known yet; leave `from` blank unless the user says, the page
  names the person (e.g. "Gramma Florence"), or it's from a published source.
- Only magazine recipes the family circled/boxed get transcribed; other recipes on the same
  page are skipped unless the user asks.
- Non-recipe pages (the letter, the beer & wine essay, the storage chart) live in `pages/*.yml`
  and are linked from the top of the home page. Fields: `title`, `link`, `order`, `intro`,
  `body` (paragraphs; `## ` lines are headings), `outro`, or `columns` + `sections` for a chart.
- The letter and essay are published with names, the email address and other personal details
  removed (user's request). Keep it that way when editing them, and crop names/addresses off
  photos before committing.
- Family first names and nicknames in recipes are fine to keep (user confirmed): Nikki's notes,
  "Grammi Jan", "Billy's", "Gramma Florence". The rule above is about full names, emails,
  addresses and similar.
