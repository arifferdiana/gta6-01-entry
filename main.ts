// SOLMARINA — the entrypoint (Node 22, standard library only).
// It hands the game in: copies game/ and screenshots/ from this repository
// into the output directory and writes /output/dossier.json with
// buildDossier from the kit's vendor/makefun-game.ts. Outside the grader,
// MAKEFUN_OUTPUT_DIR stands in for /output. The program runs twice and
// both runs write the same bytes: the copy is a plain recursive copy and
// buildDossier is deterministic.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else if (entry.isFile()) n += 1;
  }
  return n;
}

function totalBytes(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += totalBytes(p);
    else if (entry.isFile()) n += statSync(p).size;
  }
  return n;
}

// Start from a clean output directory so a second run writes the same bytes.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Fail fast with a readable message when the repository is incomplete.
for (const needed of ['game', 'game/index.html', 'screenshots']) {
  if (!existsSync(join(repoDir, needed))) {
    throw new Error(`SOLMARINA: missing ${needed} in ${repoDir}`);
  }
}

// The playable game, exactly as it sits in the repository.
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });
// The screenshots, real renders of the game's own code.
cpSync(join(repoDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

// The dossier: the scorer rebuilds it with the same library and requires
// byte-for-byte equality, so the caps here are the gate's own caps.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const gameFiles = countFiles(join(outDir, 'game'));
const shotFiles = readdirSync(join(outDir, 'screenshots')).filter((f) => !f.startsWith('.'));
console.log(
  `SOLMARINA packaged into ${outDir} (${gameFiles} game files, ` +
    `${shotFiles.length} screenshots, dossier.json ${dossier.length} bytes, ` +
    `game/ ${totalBytes(join(outDir, 'game'))} bytes)`,
);
