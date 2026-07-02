// Build the compendium packs module.json registers, from their JSON sources. Run by `npm run
// build`, so the shipped LevelDB always matches the tracked sources and the current module id —
// built packs are gitignored, like dist/.
//
// What ships is driven by module.json `packs`, not the source layout:
//   - an `Adventure` pack is *derived* from the per-type sources (scripts/build-adventure.ts)
//   - every other pack is compiled from packs/_source/<name> or packs/_source/_library/<name>
// A module with no Adventure pack just compiles its compendia — the plain, library-style default.
//
// If Foundry holds a pack open (LevelDB lock), the existing build is kept and we warn rather than
// fail; close Foundry to refresh it. Manual single-pack rebuild:
//   npm run pack -- <name> --in packs/_source/<name> --out packs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAdventure } from './build-adventure.ts';
import { packCompendium } from './pack-leveldb.ts';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'packs', '_source');
if (!existsSync(SOURCE)) process.exit(0);

interface PackEntry { name: string; type?: string }
const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as { packs?: PackEntry[] };
const packs = manifest.packs ?? [];

// A pack's source is top-level, or under _library/ when it's a runtime library kept out of an Adventure.
function sourceDir(name: string): string | undefined {
  for (const candidate of [join(SOURCE, name), join(SOURCE, '_library', name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

for (const pack of packs) {
  if (pack.type === 'Adventure') {
    try {
      buildAdventure();
    } catch (error) {
      console.warn(`⚠ adventure "${pack.name}" not rebuilt: ${(error as Error).message}`);
    }
    continue;
  }
  const dir = sourceDir(pack.name);
  if (!dir) {
    console.warn(`⚠ pack "${pack.name}" registered in module.json but no source at packs/_source/${pack.name} — skipping.`);
    continue;
  }
  if (!packCompendium(pack.name, dir, join(ROOT, 'packs'))) {
    console.warn(`⚠ pack "${pack.name}" not rebuilt (is Foundry holding it open? LevelDB lock) — keeping the existing build.`);
  }
}
