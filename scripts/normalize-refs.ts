// Rewrite world UUIDs back to compendium UUIDs in pack sources — the inverse of the build-time
// rewrite in build-adventure.ts. Keeps the per-type sources canonical (compendium UUIDs) so they
// stay model-agnostic and re-derive cleanly into either compendia or an Adventure.
//
// Why it's needed: after you import an Adventure, edit a journal/actor in Foundry, and unpack it
// back to source, links come back as world UUIDs (@UUID[Actor.<id>], "uuid": "Item.<id>"). Left
// alone the source drifts toward the Adventure model. This restores the canonical form.
//
// Run it after unpacking: `node scripts/normalize-refs.ts [packs/_source/<name> ...]`
// (defaults to the whole packs/_source tree). Only ids that belong to this module's own sources
// are rewritten; references to the GM's world documents are left untouched.
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'packs', '_source');
const MODULE_ID = (JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as { id: string }).id;

const TYPES = ['Actor', 'Item', 'JournalEntry', 'Scene', 'Macro', 'RollTable', 'Playlist', 'Cards'];

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return path.endsWith('.json') ? [path] : [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

// id -> pack name, across every source pack (top-level and _library/<name>).
function buildIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const packDirs: Array<[string, string]> = [];
  for (const entry of readdirSync(SOURCE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_library') {
      for (const lib of readdirSync(join(SOURCE, '_library'), { withFileTypes: true })) {
        if (lib.isDirectory()) packDirs.push([lib.name, join(SOURCE, '_library', lib.name)]);
      }
    } else {
      packDirs.push([entry.name, join(SOURCE, entry.name)]);
    }
  }
  for (const [name, dir] of packDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { _id?: string })._id;
      if (id) index.set(id, name);
    }
  }
  return index;
}

const index = buildIndex();
const typeAlt = TYPES.join('|');
// World refs only: @UUID[Type.id]  and  "uuid": "Type.id"  — both forms start right after the
// bracket / opening quote, so compendium refs (which start with "Compendium.") never match.
const inline = new RegExp(`@UUID\\[(${typeAlt})\\.([A-Za-z0-9]{16})\\]`, 'g');
const rule = new RegExp(`("uuid"\\s*:\\s*")(${typeAlt})\\.([A-Za-z0-9]{16})(")`, 'g');

const targets = process.argv.slice(2).map((p) => (p.startsWith('/') ? p : join(ROOT, p)));
const files = (targets.length ? targets : [SOURCE]).flatMap(walk);

let changed = 0;
let rewrites = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before.replace(inline, (m, type: string, id: string) => {
    const pack = index.get(id);
    if (!pack) return m;
    rewrites++;
    return `@UUID[Compendium.${MODULE_ID}.${pack}.${type}.${id}]`;
  });
  after = after.replace(rule, (m, head: string, type: string, id: string, tail: string) => {
    const pack = index.get(id);
    if (!pack) return m;
    rewrites++;
    return `${head}Compendium.${MODULE_ID}.${pack}.${type}.${id}${tail}`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`normalized ${rewrites} world ref(s) → compendium UUIDs across ${changed} file(s) (${index.size} known ids)`);
