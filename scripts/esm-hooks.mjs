// Permet à node d'importer les modules du projet TELS QUELS, sans build.
//
// Le paquet n'est pas `"type": "module"` : node lit donc les .js en CommonJS et
// s'étrangle sur le premier `export`. Et les imports du projet sont sans
// extension (`./params`), ce que la résolution ESM refuse. Ces deux crochets
// règlent l'un et l'autre — rien de plus.
//
//   node --import ./scripts/esm-hooks.mjs scripts/mon-test.mjs
//
// Sans ça, un test ne peut atteindre lib/ qu'en passant par l'API HTTP, ce qui
// oblige à lancer le serveur pour vérifier une fonction pure.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    return { url: new URL(`${specifier}.js`, context.parentURL).href, shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.js')) {
    return { format: 'module', source: await readFile(fileURLToPath(url), 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}

// Auto-enregistrement : `--import ./scripts/esm-hooks.mjs` suffit, sans avoir à
// écrire le register() dans chaque test.
register(pathToFileURL(fileURLToPath(import.meta.url)));
