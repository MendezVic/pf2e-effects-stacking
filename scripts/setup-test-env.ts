// Build test/foundry-data/ — an isolated Foundry data path for the Playwright e2e harness,
// so driving a headless Foundry never touches the user's normal install. Idempotent.
// Run with `npm run test:e2e:setup`.
//
// systems/modules/worlds are SYMLINKED from the real data dir (not copied): tests run against
// the same pf2e system, the live module scaffold (its dist symlink → repo dist), and the same
// worlds. The license is copied; admin.txt is intentionally omitted so the instance has no
// admin password (the harness joins a world as a user, never /setup).
import {
  existsSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync, lstatSync, rmSync, symlinkSync, readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const repo = process.cwd();
const TEST_DATA = join(repo, 'test', 'foundry-data');
const PORT = Number(process.env.TEST_FOUNDRY_PORT ?? 30005);

// Windows can't make plain dir symlinks without admin; junctions need no privilege.
const symlinkType = process.platform === 'win32' ? 'junction' : undefined;

function readDevPaths(): { foundryData?: string } {
  const p = join(repo, '.dev-paths.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as { foundryData?: string };
  } catch {
    return {};
  }
}

// The real Foundry Data dir (holds systems/, modules/, worlds/). Mirrors npm run setup's
// detection so both resolve the same place without re-prompting.
function resolveFoundryData(): string {
  const candidates = [
    process.env.FOUNDRY_DATA,
    readDevPaths().foundryData,
    join(homedir(), 'Library', 'Application Support', 'FoundryVTT-v14', 'Data'),
    join(homedir(), 'Library', 'Application Support', 'FoundryVTT', 'Data'),
    join(homedir(), 'FoundryVTT', 'Data'),
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('❌ Could not find a Foundry Data dir to mirror.');
    console.error('   Set FOUNDRY_DATA or run `npm run setup` to cache it in .dev-paths.json. Looked in:');
    for (const p of candidates) console.error(`     - ${p}`);
    process.exit(1);
  }
  return found;
}

function relink(target: string, linkPath: string): void {
  const st = lstatSync(linkPath, { throwIfNoEntry: false });
  if (st) {
    if (st.isDirectory() && !st.isSymbolicLink()) rmSync(linkPath, { recursive: true, force: true });
    else unlinkSync(linkPath);
  }
  symlinkSync(target, linkPath, symlinkType);
  console.log(`🔗 linked ${linkPath.replace(repo + '/', '')} → ${target}`);
}

const foundryData = resolveFoundryData();
const configSource = join(dirname(foundryData), 'Config');

console.log(`📁 Data source:   ${foundryData}`);
console.log(`📁 Config source: ${configSource}\n`);

const configDir = join(TEST_DATA, 'Config');
const dataDir = join(TEST_DATA, 'Data');
mkdirSync(configDir, { recursive: true });
mkdirSync(join(dataDir, 'assets'), { recursive: true });
mkdirSync(join(TEST_DATA, 'Logs'), { recursive: true });

const licenseSrc = join(configSource, 'license.json');
if (existsSync(licenseSrc)) {
  copyFileSync(licenseSrc, join(configDir, 'license.json'));
  console.log('📋 copied license.json');
} else {
  console.warn(`⚠️  license.json not found at ${licenseSrc} — the test instance won't boot without it.`);
}
// A lingering admin.txt would reinstate an admin password we can't recover the plaintext for.
const adminTxt = join(configDir, 'admin.txt');
if (existsSync(adminTxt)) unlinkSync(adminTxt);

const options = {
  dataPath: `${TEST_DATA}/`,
  port: PORT,
  upnp: false,
  hostname: null,
  routePrefix: null,
  sslCert: null,
  sslKey: null,
  proxyPort: null,
  proxySSL: false,
  updateChannel: 'stable',
  language: 'en.core',
  world: null,
  telemetry: false,
};
writeFileSync(join(configDir, 'options.json'), `${JSON.stringify(options, null, 2)}\n`);
console.log(`✅ wrote Config/options.json (port ${PORT}, upnp off)`);

for (const name of ['systems', 'modules', 'worlds']) {
  relink(join(foundryData, name), join(dataDir, name));
}

console.log('\n✨ Test data path ready at test/foundry-data');
console.log('   Boot it with:  npm run test:foundry            (auto-launches TEST_WORLD)');
console.log('   Run e2e with:  npm run test:e2e');
