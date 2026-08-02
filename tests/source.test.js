/* Things the module system will happily let you write that do not work.
 *
 * No bundler, no type checker, no linter — the browser is the only thing that
 * ever reads this code, and it reports a bad reference by throwing inside an
 * event handler, where nothing is looking. Reordering was dead on every surface
 * in the app for exactly this reason and said so only in the console.
 *
 * These parse the sources rather than importing them, because every renderer
 * touches the DOM on the way in. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../js/', import.meta.url);

function sources(dir = ROOT, prefix = 'js/') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...sources(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.js')) {
      out.push({ path: `${prefix}${entry.name}`, src: readFileSync(new URL(entry.name, dir), 'utf8') });
    }
  }
  return out;
}

const FILES = sources();

test('there are sources to check', () => {
  assert.ok(FILES.length > 15, `only found ${FILES.length}`);
});

test('an export alias is not a local binding, and must not be called like one', () => {
  // `export { expectShift as expectReorder }` renames the symbol for importers
  // and declares NOTHING in the module that wrote it. checklist.js then called
  // expectReorder() from eight places — both arrow buttons, both action sheets,
  // Alt+Arrow on a task and on a section, and both drag drops — and every one
  // threw ReferenceError before the moveTask/moveSection call beside it ran.
  // Every way the app had of moving anything, silently dead.
  for (const { path, src } of FILES) {
    for (const match of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const alias of match[1].matchAll(/\b[\w$]+\s+as\s+([\w$]+)/g)) {
        const name = alias[1];
        if (name === 'default') continue;
        const declared = new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(src)
          || new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(src);
        if (declared) continue;
        const called = new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(src);
        assert.ok(!called,
          `${path} calls ${name}(), which exists only as an export alias — it is not defined in that module`);
      }
    }
  }
});

test('nothing imports a name its source does not export', () => {
  // A missing export is not an error at parse time in the browser for a name
  // that is never used, and a typo'd one throws only when the line runs.
  const exportsOf = (src) => {
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const bits = part.trim().split(/\s+as\s+/);
        if (bits[0]) names.add((bits[1] || bits[0]).trim());
      }
    }
    return names;
  };
  const byPath = new Map(FILES.map((f) => [f.path, exportsOf(f.src)]));

  for (const { path, src } of FILES) {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    for (const imp of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]*)['"]/g)) {
      const target = new URL(imp[2], `file:///${dir}`).pathname.slice(1);
      const available = byPath.get(target);
      if (!available) continue; // resolved outside js/, not this test's business
      for (const part of imp[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        assert.ok(available.has(name), `${path} imports { ${name} } from ${imp[2]}, which does not export it`);
      }
    }
  }
});
