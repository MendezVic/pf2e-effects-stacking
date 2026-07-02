// Owner + author derived from the local git repo. Shared by init.ts and setup.ts; init.ts
// deletes itself after running but leaves this behind for setup.ts's later placeholder fill.
import { execFileSync } from 'node:child_process';

export const isValidOwner = (s: string): boolean => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(s);

function git(args: string[], cwd: string = process.cwd()): string | undefined {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

// origin only points at the new repo in the create-from-template flows; a plain clone still
// points at the template, so callers re-init git (or pass --org) before relying on this.
export function ownerFromOrigin(cwd?: string): string | undefined {
  const url = git(['remote', 'get-url', 'origin'], cwd);
  const owner = url?.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).at(-2);
  return owner && isValidOwner(owner) ? owner : undefined;
}

export function authorName(cwd?: string): string | undefined {
  return git(['config', 'user.name'], cwd);
}
