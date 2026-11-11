// Recipe model shared by the browser (rendering) and scripts/build.mjs (validation).
//
// A recipe's steps form a tree: each step "uses" ingredients and/or the results of
// earlier steps. The standard view lists ingredients and steps; the table view lays
// that tree out as a grid (ingredients down the left, each step a cell spanning the
// rows of everything that goes into it).

export const PREVIOUS = 'previous';

const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Turn a parsed YAML object into a clean recipe. Never throws; problems are
 * returned as `errors` (build fails) or `warnings` (build passes, prints a note).
 */
export function normalizeRecipe(raw, slug) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { recipe: null, errors: ['File is empty or is not a YAML mapping'], warnings };
  }

  const recipe = {
    slug,
    title: str(raw.title),
    category: str(raw.category) || 'Uncategorized',
    from: str(raw.from),
    serves: str(raw.serves),
    time: str(raw.time),
    description: str(raw.description),
    tags: list(raw.tags).map(str).filter(Boolean),
    image: str(raw.image),
    scans: list(raw.scans ?? raw.scan).map(str).filter(Boolean),
    before: list(raw.before).map(str).filter(Boolean),
    ingredients: [],
    steps: [],
    notes: str(raw.notes),
  };

  if (!recipe.title) errors.push('Missing "title"');
  if (!str(raw.category)) warnings.push('No "category" (filed under Uncategorized)');

  // ---- ingredients -------------------------------------------------------
  const kind = new Map(); // id -> 'ingredient' | 'step'
  let autoId = 0;

  list(raw.ingredients).forEach((entry, i) => {
    const where = `Ingredient ${i + 1}`;
    if (typeof entry === 'string' || typeof entry === 'number') {
      recipe.ingredients.push({ type: 'item', id: `#${++autoId}`, text: str(entry) });
      return;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const keys = Object.keys(entry);
      if (keys.length !== 1) {
        errors.push(`${where}: expected "id: text", got ${JSON.stringify(entry)}`);
        return;
      }
      const id = keys[0];
      const text = str(entry[id]);
      if (id === 'heading') {
        recipe.ingredients.push({ type: 'heading', text });
        return;
      }
      if (!text) warnings.push(`${where} ("${id}") has no text`);
      if (kind.has(id)) errors.push(`Duplicate id "${id}"`);
      kind.set(id, 'ingredient');
      recipe.ingredients.push({ type: 'item', id, text });
      return;
    }
    errors.push(`${where} is not understood: ${JSON.stringify(entry)}`);
  });

  if (!recipe.ingredients.some((x) => x.type === 'item')) warnings.push('No ingredients');

  // ---- steps -------------------------------------------------------------
  const useCount = new Map(); // id -> how many steps use it

  list(raw.steps).forEach((entry, i) => {
    const n = i + 1;
    const s = typeof entry === 'string' ? { text: entry } : entry;
    const step = { id: `step ${n}`, action: '', text: '', uses: [] };
    recipe.steps.push(step); // always push so indexes stay aligned

    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      errors.push(`Step ${n} is not understood: ${JSON.stringify(entry)}`);
      return;
    }

    if (s.id != null) step.id = str(s.id);
    if (kind.has(step.id)) errors.push(`Step ${n}: id "${step.id}" is already used`);
    step.action = str(s.action);
    step.text = str(s.text);
    if (!step.action && !step.text) errors.push(`Step ${n} needs "action" and/or "text"`);
    else if (!step.action) warnings.push(`Step ${n} has no "action" (the short label in table view)`);

    const refs = s.uses == null ? (i > 0 ? [PREVIOUS] : []) : list(s.uses).map(str);
    for (const ref of refs) {
      let id = ref;
      if (ref === PREVIOUS) {
        if (i === 0) {
          errors.push('Step 1 can\'t use "previous"');
          continue;
        }
        id = recipe.steps[i - 1].id;
      } else if (!kind.has(ref)) {
        const later = list(raw.steps).some((x, j) => j > i && x && str(x.id) === ref);
        errors.push(
          later
            ? `Step ${n} uses "${ref}", which is a later step`
            : `Step ${n} uses "${ref}", which isn't an ingredient or step id`,
        );
        continue;
      }
      if (step.uses.includes(id)) {
        errors.push(`Step ${n} lists "${ref}" twice`);
        continue;
      }
      step.uses.push(id);
      useCount.set(id, (useCount.get(id) || 0) + 1);
    }
    kind.set(step.id, 'step');
  });

  // Each ingredient/step can feed exactly one later step, or the table can't be drawn.
  for (const [id, count] of useCount) {
    if (count > 1) {
      errors.push(
        `"${id}" is used by ${count} steps. Split it into separate lines ` +
          `(e.g. "2 Tbsp butter (for the pan)") so each step uses its own.`,
      );
    }
  }

  if (recipe.steps.length) {
    const unused = recipe.ingredients.filter((x) => x.type === 'item' && !useCount.has(x.id));
    if (unused.length) {
      warnings.push(
        `Not used by any step (table view shows them unattached): ${unused
          .map((x) => x.text)
          .join('; ')}`,
      );
    }
    const roots = recipe.steps.filter((s) => !useCount.has(s.id));
    if (roots.length > 1) {
      warnings.push(
        `${roots.length} steps aren't used by a later step (${roots
          .map((s) => `"${s.action || s.id}"`)
          .join(', ')}); table view shows them as separate branches`,
      );
    }
  }

  return { recipe, errors, warnings };
}

/** Full sentence for a step in the standard view. */
export function stepText(recipe, step) {
  if (step.text) return step.text;
  const names = step.uses
    .map((id) => recipe.ingredients.find((x) => x.type === 'item' && x.id === id))
    .filter(Boolean)
    .map((x) => x.text);
  const verb = step.action.charAt(0).toUpperCase() + step.action.slice(1);
  return names.length ? `${verb}: ${names.join(', ')}.` : `${verb}.`;
}

/**
 * Lay out the step tree as a grid.
 * Returns { cols, rows, header, cells } where each cell is
 * { kind: 'ingredient' | 'step' | 'empty', row, col, rowspan, colspan, text }.
 * Cells tile the rows x cols grid exactly (no gaps, no overlaps), so they can be
 * emitted row by row, left to right, as an HTML table with rowspan/colspan.
 */
export function layoutTable(recipe) {
  const items = recipe.ingredients.filter((x) => x.type === 'item');
  const ingById = new Map(items.map((x) => [x.id, x]));
  const stepById = new Map(recipe.steps.map((s) => [s.id, s]));
  const used = new Set(recipe.steps.flatMap((s) => s.uses));

  const cells = [];
  let rows = 0;

  const emptyCell = (r0, r1, c0, c1) => {
    if (c1 >= c0) {
      cells.push({ kind: 'empty', row: r0, col: c0, rowspan: r1 - r0 + 1, colspan: c1 - c0 + 1, text: '' });
    }
  };

  // Fill the gap to the right of each part up to (but not including) column `col`.
  // Neighbouring parts that end in the same column share one filler cell.
  const fillTo = (parts, col) => {
    let i = 0;
    while (i < parts.length) {
      let j = i;
      while (j + 1 < parts.length && parts[j + 1].col === parts[i].col) j++;
      emptyCell(parts[i].r0, parts[j].r1, parts[i].col + 1, col - 1);
      i = j + 1;
    }
  };

  const placeIngredient = (ing) => {
    const r = rows++;
    cells.push({ kind: 'ingredient', row: r, col: 0, rowspan: 1, colspan: 1, text: ing.text });
    return { r0: r, r1: r, col: 0 };
  };

  const placeStep = (step) => {
    let parts = step.uses
      .map((id) => (ingById.has(id) ? placeIngredient(ingById.get(id)) : stepById.has(id) ? placeStep(stepById.get(id)) : null))
      .filter(Boolean);
    if (!parts.length) {
      // A step with no inputs still needs a row of its own.
      const r = rows++;
      emptyCell(r, r, 0, 0);
      parts = [{ r0: r, r1: r, col: 0 }];
    }
    const col = 1 + Math.max(...parts.map((p) => p.col));
    fillTo(parts, col);
    const r0 = parts[0].r0;
    const r1 = parts[parts.length - 1].r1;
    cells.push({ kind: 'step', row: r0, col, rowspan: r1 - r0 + 1, colspan: 1, text: step.action || step.text });
    return { r0, r1, col };
  };

  const top = [
    ...recipe.steps.filter((s) => !used.has(s.id)).map(placeStep),
    ...items.filter((x) => !used.has(x.id)).map(placeIngredient),
  ];
  const lastCol = Math.max(0, ...top.map((p) => p.col));
  fillTo(top, lastCol + 1);

  return { cols: lastCol + 1, rows, header: recipe.before, cells };
}
