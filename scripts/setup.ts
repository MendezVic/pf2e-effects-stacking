// Dev environment setup. Idempotent. Run with `npm run setup`.
//   1. Personalize module.json — offer to fill the <your-org>/<your-name> placeholders
//      `npm run init` couldn't resolve (auto-detected from git; skipped on the template).
//   2. Find the Foundry data dir — detect per-platform, else ask for the path.
//   3. Resolve the PF2e system source — detect, clone foundryvtt/pf2e, point at a
//      checkout, or skip (types also ship via the foundry-pf2e dep, so it's optional).
//   4. Symlink references INTO the repo, then scaffold a *real* module dir in Foundry's
//      modules/ whose entries symlink back to the repo (see scaffoldDevModule).
// Resolved paths cache in .dev-paths.json (gitignored) so re-runs don't re-ask.
// Flags: --reconfigure (ask again), --no-link (resolve+cache only), --yes (no prompts).
import {
  existsSync, symlinkSync, lstatSync, unlinkSync, readFileSync, writeFileSync, mkdirSync, copyFileSync,
  rmSync, statSync,
} from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ownerFromOrigin, authorName, isValidOwner } from './git-identity.ts';

const repo = process.cwd();
const home = homedir();
const ID = 'pf2e-effects-stacking';

const PF2E_REPO = 'https://github.com/foundryvtt/pf2e.git';
const CONFIG = join(repo, '.dev-paths.json');

const argv = new Set(process.argv.slice(2));
const reconfigure = argv.has('--reconfigure');
const noLink = argv.has('--no-link');
const interactive = Boolean(stdin.isTTY) && !argv.has('--yes');

interface DevPaths {
  foundryData?: string;
  pf2eSource?: string;
}

const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

// Ctrl+D / closed stdin mid-prompt rejects with AbortError — treat it as "cancel", not a crash.
async function prompt(line: string): Promise<string> {
  try {
    return (await rl!.question(line)).trim();
  } catch {
    console.log('\nCancelled.');
    rl?.close();
    process.exit(0);
  }
}

async function ask(question: string, fallback = ''): Promise<string> {
  if (!rl) return fallback;
  const answer = await prompt(`${question}${fallback ? ` [${fallback}]` : ''} `);
  return answer || fallback;
}

async function confirm(question: string, def = true): Promise<boolean> {
  if (!rl) return def;
  const answer = (await prompt(`${question} [${def ? 'Y/n' : 'y/N'}] `)).toLowerCase();
  return answer ? answer.startsWith('y') : def;
}

function expand(p: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

function readConfig(): DevPaths {
  if (!reconfigure && existsSync(CONFIG)) {
    try {
      return JSON.parse(readFileSync(CONFIG, 'utf8')) as DevPaths;
    } catch {
      /* malformed cache — start fresh */
    }
  }
  return {};
}

// Foundry's default user-data folders per platform. Recent desktop builds version the
// folder (FoundryVTT-v14); older/server installs use a plain FoundryVTT. v14-only — we
// check the v14 folder first, then the plain one, and use the first that resolves.
function userDataDirs(): string[] {
  let base: string;
  if (process.platform === 'darwin') base = join(home, 'Library/Application Support');
  else if (process.platform === 'win32') base = process.env.LOCALAPPDATA ?? join(home, 'AppData/Local');
  else base = process.env.XDG_DATA_HOME ?? join(home, '.local/share');
  return ['FoundryVTT-v14', 'FoundryVTT'].map((n) => join(base, n));
}

// The configured data dir lives in Config/options.json's `dataPath` (which may point
// elsewhere than the folder holding it), with content under `<dataPath>/Data`.
function dataDirFor(userData: string): string | null {
  const options = join(userData, 'Config', 'options.json');
  if (existsSync(options)) {
    try {
      const { dataPath } = JSON.parse(readFileSync(options, 'utf8')) as { dataPath?: string };
      if (dataPath) return join(dataPath, 'Data');
    } catch {
      /* malformed options.json — fall through to the conventional layout */
    }
  }
  const conventional = join(userData, 'Data');
  return existsSync(conventional) ? conventional : null;
}

function detectFoundryData(): string | null {
  if (process.env.FOUNDRY_DATA) return process.env.FOUNDRY_DATA;
  for (const ud of userDataDirs()) {
    const dd = dataDirFor(ud);
    if (dd && existsSync(dd)) return dd;
  }
  return null;
}

async function resolveFoundryData(cfg: DevPaths): Promise<string | undefined> {
  const found = (cfg.foundryData && existsSync(cfg.foundryData) ? cfg.foundryData : detectFoundryData()) || undefined;
  if (found) {
    console.log(`✓ Foundry data: ${found}`);
    return found;
  }
  console.log('• No Foundry data dir found (no Config/options.json at the default locations).');
  if (!interactive) {
    console.log('  Set FOUNDRY_DATA or run interactively to point at it; skipping Foundry links.');
    return undefined;
  }
  // Foundry picks/creates its own data dir — we only link into an existing one, never make it.
  const entered = expand(await ask('  Path to your Foundry Data dir (the folder holding modules/, worlds/):'));
  if (entered && existsSync(entered)) return entered;
  if (entered) console.log(`  ${entered} doesn't exist — skipping Foundry links.`);
  return undefined;
}

function pf2eCandidates(cfg: DevPaths): string[] {
  const out: string[] = [];
  if (cfg.pf2eSource) out.push(cfg.pf2eSource);
  out.push(join(home, 'Documents/repos/pf2e'), join(home, 'repos/pf2e'), join(repo, '..', 'pf2e'));
  return out;
}

async function resolvePf2eSource(cfg: DevPaths): Promise<string | undefined> {
  const hit = pf2eCandidates(cfg).find(existsSync);
  if (hit) {
    console.log(`✓ PF2e source: ${hit}`);
    return hit;
  }
  console.log('• PF2e system source not found (optional — types also come from the foundry-pf2e dep).');
  if (!interactive) return undefined;
  const choice = (await ask('  [c]lone foundryvtt/pf2e, [p]oint at a checkout, or [s]kip?', 's')).toLowerCase();
  if (choice.startsWith('p')) {
    const p = expand(await ask('  Path to your pf2e checkout:'));
    if (p && existsSync(p)) return p;
    console.log('  not found — skipping.');
    return undefined;
  }
  if (choice.startsWith('c')) {
    const dest = expand(await ask('  Clone destination:', join(repo, '..', 'pf2e')));
    if (!dest) return undefined;
    if (existsSync(dest)) {
      console.log(`  ${dest} already exists — using it.`);
      return dest;
    }
    try {
      mkdirSync(dirname(dest), { recursive: true }); // git clone needs the parent to exist
      console.log(`  cloning ${PF2E_REPO} → ${dest} (large repo; shallow --depth 1)…`);
      execFileSync('git', ['clone', '--depth', '1', PF2E_REPO, dest], { stdio: 'inherit' });
      return dest;
    } catch {
      console.log('  clone failed — skipping.');
      return undefined;
    }
  }
  return undefined;
}

// allowMissing lets us link dist/ before it's built — a dangling link that resolves once
// `npm run build` (or the Vite dev server) produces it.
type LinkKind = 'file' | 'dir';

interface LinkOptions {
  allowMissing?: boolean;
  kind?: LinkKind;
  replaceExisting?: boolean;
}

function inferredKind(target: string, fallback: LinkKind): LinkKind {
  const st = statSync(target, { throwIfNoEntry: false });
  return st?.isDirectory() ? 'dir' : st?.isFile() ? 'file' : fallback;
}

function targetForSymlink(linkPath: string, target: string, kind: LinkKind): string {
  // Junctions require absolute targets. Other symlinks are relative so the scaffold
  // survives moving the containing Foundry Data/repo folders together.
  if (process.platform === 'win32' && kind === 'dir') return target;
  const rel = relative(dirname(linkPath), target);
  return rel || target;
}

function symlinkKind(kind: LinkKind): 'junction' | 'file' | undefined {
  if (process.platform !== 'win32') return undefined;
  return kind === 'dir' ? 'junction' : 'file';
}

function canCopyFileFallback(error: unknown, kind: LinkKind): boolean {
  return (
    process.platform === 'win32'
    && kind === 'file'
    && typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EPERM'
  );
}

function link(linkPath: string, target: string, options: LinkOptions = {}): void {
  const { allowMissing = false, kind: configuredKind, replaceExisting = false } = options;
  if (!allowMissing && !existsSync(target)) {
    console.log(`skip (missing target): ${basename(linkPath)} → ${target}`);
    return;
  }
  const kind = configuredKind ?? inferredKind(target, 'dir');
  const st = lstatSync(linkPath, { throwIfNoEntry: false });
  if (st) {
    if (!st.isSymbolicLink()) {
      if (!replaceExisting) {
        console.log(`skip (exists, not a symlink): ${linkPath}`);
        return;
      }
      rmSync(linkPath, { recursive: true, force: true });
    } else {
      unlinkSync(linkPath);
    }
  }
  try {
    symlinkSync(targetForSymlink(linkPath, target, kind), linkPath, symlinkKind(kind));
    console.log(`linked ${basename(linkPath)} → ${target}`);
  } catch (error) {
    if (!canCopyFileFallback(error, kind)) throw error;
    copyFileSync(target, linkPath);
    console.log(`copied ${basename(linkPath)} from ${target} (Windows file symlinks need Developer Mode or admin)`);
  }
}

// Dev install: a *real* module dir whose entries symlink back to the repo, NOT one symlink
// pointing at the whole repo. The whole-repo form exposes node_modules/.git to Foundry's file
// picker, makes the repo's module.json the one Foundry loads, and ships nothing on its own —
// so any non-symlink install (a release, a copied folder) had no assets. Per-entry symlinks
// keep live edits and the Vite proxy's HMR while matching the shape `npm run deploy` copies.
// We link the content dirs (assets/lang/packs) + the manifest + dist; the TypeScript sources
// under src/ stay out of the module.
function scaffoldDevModule(modulesDir: string): void {
  const dest = join(modulesDir, ID);
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) {
    unlinkSync(dest); // drop the legacy whole-repo symlink
  } else if (st && !st.isDirectory()) {
    console.log(`skip (exists, not a dir or symlink): ${dest}`);
    return;
  }
  mkdirSync(dest, { recursive: true });
  link(join(dest, 'module.json'), join(repo, 'module.json'), { kind: 'file', replaceExisting: true });
  link(join(dest, 'dist'), join(repo, 'dist'), { allowMissing: true, kind: 'dir', replaceExisting: true });
  link(join(dest, 'lang'), join(repo, 'lang'), { kind: 'dir', replaceExisting: true });
  link(join(dest, 'packs'), join(repo, 'packs'), { kind: 'dir', replaceExisting: true });
  link(join(dest, 'assets'), join(repo, 'assets'), { kind: 'dir', replaceExisting: true });
  console.log(`scaffolded dev module → ${dest}`);
}

const ORG_PLACEHOLDER = '<your-org>';
const AUTHOR_PLACEHOLDER = '<your-name>';

// init.ts deletes itself once it has run, so its presence means this is the un-initialized
// template — the placeholders are intentional there and must not be filled in.
async function resolveIdentity(): Promise<void> {
  if (existsSync(join(repo, 'scripts', 'init.ts'))) return;
  const manifestPath = join(repo, 'module.json');
  if (!existsSync(manifestPath)) return;
  const manifest = readFileSync(manifestPath, 'utf8');
  const needsOrg = manifest.includes(ORG_PLACEHOLDER);
  const needsAuthor = manifest.includes(AUTHOR_PLACEHOLDER);
  if (!needsOrg && !needsAuthor) return;

  const org = needsOrg ? ownerFromOrigin(repo) : undefined;
  const author = needsAuthor ? authorName(repo) : undefined;

  console.log('• module.json still has template placeholders:');
  if (needsOrg) console.log(`    owner  ${ORG_PLACEHOLDER}  →  ${org ?? '(no origin remote)'}`);
  if (needsAuthor) console.log(`    author ${AUTHOR_PLACEHOLDER}  →  ${author ?? '(git config user.name unset)'}`);

  if (!interactive) {
    console.log('  Re-run `npm run setup` interactively to fill them, or edit module.json.\n');
    return;
  }

  let finalOrg = org;
  if (needsOrg && !finalOrg) {
    const typed = await ask('  GitHub owner for the module.json URLs (blank to skip):');
    if (typed && isValidOwner(typed)) finalOrg = typed;
    else if (typed) console.log(`  "${typed}" isn't a valid GitHub owner — skipping owner.`);
  }
  const finalAuthor = needsAuthor ? author || (await ask('  Author name for module.json (blank to skip):')) : undefined;

  const changes = [
    finalAuthor && `author = ${finalAuthor}`,
    finalOrg && `owner = ${finalOrg}`,
  ].filter(Boolean);
  if (changes.length === 0) {
    console.log('  Left as placeholders.\n');
    return;
  }
  if (!(await confirm(`  Write ${changes.join(', ')} to module.json?`, true))) {
    console.log('  Left as placeholders.\n');
    return;
  }
  let updated = manifest;
  if (finalOrg) updated = updated.replaceAll(ORG_PLACEHOLDER, finalOrg);
  if (finalAuthor) updated = updated.replaceAll(AUTHOR_PLACEHOLDER, finalAuthor);
  writeFileSync(manifestPath, updated);
  console.log('  ✓ updated module.json\n');
}

const cfg = readConfig();
console.log('Setting up the dev environment…\n');

await resolveIdentity();

const foundryData = await resolveFoundryData(cfg);
const pf2eSource = await resolvePf2eSource(cfg);

if (foundryData || pf2eSource) {
  writeFileSync(CONFIG, `${JSON.stringify({ foundryData, pf2eSource }, null, 2)}\n`);
  console.log(`\nSaved paths to ${basename(CONFIG)} (gitignored) — re-run with --reconfigure to change.`);
}

if (noLink) {
  console.log('--no-link: resolved paths only, no symlinks created.');
  rl?.close();
} else if (!(await confirm('\nCreate the dev symlinks now?', true))) {
  console.log('Skipped symlinks. Run `npm run setup` again when ready.');
  rl?.close();
} else {
  console.log('');
  if (pf2eSource) link(join(repo, '_pf2e-source'), pf2eSource);
  if (foundryData) {
    link(join(repo, '_foundry-data'), foundryData);
    link(join(repo, '_foundry-modules'), join(foundryData, 'modules'));
    const modulesDir = join(foundryData, 'modules');
    if (existsSync(modulesDir)) scaffoldDevModule(modulesDir);
    else console.log(`skip (no modules dir): ${modulesDir}`);
  }
  rl?.close();
}
