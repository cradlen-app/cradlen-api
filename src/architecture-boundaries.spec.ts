import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Lint-independent enforcement of the documented module-boundary convention:
 *
 *   plugins/ and specialties/ may import from core/ ONLY through a published
 *   surface — a `*.public.ts` or `*.module.ts` file — never a core internal.
 *
 * This is the rule CLAUDE.md preserves as a convention because
 * eslint-plugin-import's `except`-glob matching is unreliable on Windows
 * backslash paths (see eslint.config.mjs). A plain file scan sidesteps that
 * entirely and runs in the normal unit suite. Spec files are excluded — tests
 * may reach into internals.
 */
const LAYER_DIRS = ['specialties', 'plugins'];

// Matches `from '@core/...'` in both import and `export ... from` statements.
const CORE_IMPORT = /from\s+['"]@core\/([^'"]+)['"]/g;
// A published surface ends in .public or .module (with an optional .js suffix).
const PUBLISHED = /\.(public|module)(\.js)?$/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('module boundaries: plugins/specialties → core via published surface only', () => {
  it('has no core-internal imports from specialties/ or plugins/', () => {
    const violations: string[] = [];

    for (const layer of LAYER_DIRS) {
      const root = join(__dirname, layer);
      let files: string[];
      try {
        files = collectTsFiles(root);
      } catch {
        continue; // layer scaffold may be empty (e.g. plugins/)
      }

      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const match of src.matchAll(CORE_IMPORT)) {
          const target = match[1]; // path after '@core/'
          if (!PUBLISHED.test(target)) {
            violations.push(`${file}  →  @core/${target}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
