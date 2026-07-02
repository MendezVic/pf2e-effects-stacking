import { readFileSync } from "node:fs";

// A plain `npm install` on macOS prunes the top-level @emnapi/* nodes that the
// rolldown/oxc wasm bindings declare as peerDependencies — the lock then installs
// fine locally but breaks `npm ci` on the linux CI/release runners ("Missing from
// lock file"). Only `rm -rf node_modules package-lock.json && npm install`
// regenerates them. This guards the committed lock against that silent regression
// by reading it directly (never regenerating — that's what strips the nodes).

const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
) as { packages?: Record<string, { peerDependencies?: Record<string, string> }> };

const packages = lock.packages ?? {};

const needed = new Set<string>();
for (const meta of Object.values(packages)) {
  for (const peer of Object.keys(meta.peerDependencies ?? {})) {
    if (peer.startsWith("@emnapi/")) needed.add(peer);
  }
}

const missing = [...needed].filter((p) => !packages[`node_modules/${p}`]);

if (missing.length) {
  console.error(
    `package-lock.json is missing top-level ${missing.join(", ")} required by an ` +
      `@emnapi peer dependency.\nThis breaks \`npm ci\` on linux. Regenerate with a ` +
      `clean install (a plain \`npm install\` on macOS strips them):\n` +
      `  rm -rf node_modules package-lock.json && npm install`,
  );
  process.exit(1);
}

console.log(`lockfile guard OK (${needed.size} @emnapi peer node(s) present)`);
