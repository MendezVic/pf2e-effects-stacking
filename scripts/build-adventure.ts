// Derive a single Adventure document from the per-type pack sources and compile it.
//
// This is the consolidation path: a module authored as individual compendia (packs/_source/<name>)
// can ship as one Adventure that the GM imports in a click. The Adventure importer creates world
// documents with keepId, so every _id (scene, journal, actor) is preserved on every install —
// that's what keeps hardcoded ids and @UUID cross-links valid. Loose per-pack import mints new ids
// and silently breaks them.
//
// It runs only when module.json registers an `Adventure` pack — that registration is the opt-in,
// not a flag. The per-type sources stay canonical; this never mutates them, so dropping the
// Adventure registration reverts to shipping plain compendia. See README "Ship as an Adventure".
//
// Bundling rule, with no configuration:
//   - bundle every packs/_source/<dir> EXCEPT those under _library/
//   - rewrite @UUID / rule `uuid` refs that point at a BUNDLED pack → world UUIDs (Actor.<id>)
//   - leave refs to _library packs as compendium UUIDs (they stay runtime libraries, never imported)
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { packCompendium } from './pack-leveldb.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'packs', '_source');
const LIBRARY_DIR = '_library'; // packs/_source/_library/<name> — compendium-resident, never bundled
const STAGING = join(ROOT, 'packs', '.adventure-staging'); // gitignored; fvtt packs from here

interface PackEntry { name: string; label?: string; type?: string; banner?: string }
interface Manifest { id: string; title?: string; description?: string; packs?: PackEntry[] }
type Doc = { _key?: string } & Record<string, unknown>;

// Adventure embedded-collection fields keyed by the `_key` collection name they accept.
const COLLECTIONS = ['folders', 'actors', 'items', 'journal', 'scenes', 'macros', 'tables', 'playlists', 'cards'];

function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

function readDocs(dir: string): Doc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Doc);
}

/** Build the Adventure for the registered Adventure pack, or no-op if none is registered. */
export function buildAdventure(opts: { dry?: boolean } = {}): boolean {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as Manifest;
  const advPack = manifest.packs?.find((p) => p.type === 'Adventure');
  if (!advPack) return false; // not an adventure module — nothing to derive

  const bundled = listDirs(SOURCE).filter((d) => d !== LIBRARY_DIR);
  const bundledSet = new Set(bundled);

  const adventure: Record<string, unknown> = {
    _id: createHash('sha256').update(`${manifest.id}:${advPack.name}`).digest('hex').slice(0, 16),
    name: advPack.label ?? manifest.title ?? advPack.name,
    img: advPack.banner ?? '',
    caption: '',
    description: manifest.description ?? '',
    sort: 0,
    flags: {},
  };
  for (const c of COLLECTIONS) adventure[c] = [];

  const counts: Record<string, number> = {};
  for (const dir of bundled) {
    for (const { _key, ...doc } of readDocs(join(SOURCE, dir))) {
      const collection = _key?.split('!')[1];
      if (!collection || !Array.isArray(adventure[collection])) {
        throw new Error(`${dir}: cannot route doc with _key ${JSON.stringify(_key)} into an Adventure`);
      }
      (adventure[collection] as Doc[]).push(doc);
      counts[collection] = (counts[collection] ?? 0) + 1;
    }
  }

  // Scenes ship with their encounter tokens placed. Keep only tokens whose actor travels in this
  // adventure and link those to the imported actor; drop the rest (world party placeholders, NPCs
  // whose actor isn't bundled) — they would otherwise import as broken, actorless tokens.
  const actorIds = new Set((adventure.actors as Doc[]).map((a) => a._id as string));
  for (const scene of adventure.scenes as Doc[]) {
    const tokens = (scene.tokens as Doc[] | undefined) ?? [];
    const kept = tokens.filter((t) => actorIds.has(t.actorId as string));
    for (const t of kept) {
      t.actorLink = true;
      delete t.delta; // a linked token derives from the world actor; the unlinked snapshot is dead weight
    }
    scene.tokens = kept;
    if (tokens.length !== kept.length) {
      console.log(`  ${String(scene.name)}: linked ${kept.length}, dropped ${tokens.length - kept.length} unbundled token(s)`);
    }
  }

  // Rewrite refs to BUNDLED packs (which become world documents on import) into world UUIDs.
  // Refs to _library packs are left as compendium UUIDs — they stay runtime libraries. Done here at
  // build time rather than in the source, so the sources stay canonical and model-agnostic.
  let json = JSON.stringify(adventure, null, 2);
  if (bundledSet.size) {
    const alt = [...bundledSet].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(`Compendium\\.${manifest.id}\\.(?:${alt})\\.([A-Za-z]+)\\.`, 'g');
    json = json.replace(re, '$1.');
  }

  console.log(`adventure "${adventure.name}": ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'no content'}`);
  if (opts.dry) {
    console.log('(dry run — not packing)');
    return true;
  }

  const stageDir = join(STAGING, advPack.name);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const doc = JSON.parse(json) as Record<string, unknown>;
  doc._key = `!adventures!${doc._id as string}`;
  writeFileSync(join(stageDir, `${advPack.name}.json`), JSON.stringify(doc, null, 2) + '\n');
  const built = packCompendium(advPack.name, stageDir, join(ROOT, 'packs'));
  rmSync(STAGING, { recursive: true, force: true });
  if (built) console.log(`✓ packs/${advPack.name} built`);
  else console.warn(`⚠ adventure "${advPack.name}" not rebuilt (is Foundry holding it open? LevelDB lock) — keeping the existing build.`);
  return true;
}

// Run standalone: `node scripts/build-adventure.ts [--dry]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = buildAdventure({ dry: process.argv.includes('--dry') });
  if (!built) console.log('no Adventure pack registered in module.json — nothing to build');
}
