// Registre des scripts.
//
// Ajouter un script = créer son fichier dans ./library/, l'importer ici, et
// l'ajouter au tableau. Rien d'autre : le formulaire du panneau se dessine
// depuis son `fields`, et le moteur ne connaît que le contrat de ./engine.js.

import boomRsier    from './library/boomRsier';
import ringble      from './library/ringble';
import rfvgPaliers  from './library/rfvgPaliers';
import demoCross    from './library/demoCross';

export const SCRIPTS = [
  boomRsier,
  ringble,
  rfvgPaliers,
  demoCross,
];

export function getScript(id) {
  return SCRIPTS.find(s => s.id === id) ?? null;
}

// Aplatit les champs imbriqués ('row') — le formulaire les groupe, la
// validation ne doit pas les perdre.
function flatFields(fields = []) {
  const out = [];
  for (const f of fields) {
    if (f.kind === 'row') out.push(...flatFields(f.fields));
    else if (f.key) out.push(f);
  }
  return out;
}

export function defaultParams(script) {
  return { ...(script?.defaults ?? {}) };
}

// Fusionne des réglages reçus avec les défauts du script, en validant chaque
// champ décrit. Comme sanitizeParams du backtest : jamais de rejet, on ramène
// dans les bornes — un réglage hors limites ne doit pas empêcher un run.
export function sanitizeParams(script, raw = {}) {
  const defaults = defaultParams(script);
  const out      = { ...defaults, ...raw };

  for (const f of flatFields(script?.fields)) {
    const v   = raw[f.key];
    const def = defaults[f.key];

    switch (f.kind) {
      case 'number': {
        const n = Number(v);
        out[f.key] = Number.isFinite(n)
          ? Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, n))
          : def;
        break;
      }
      case 'toggle':
        out[f.key] = typeof v === 'boolean' ? v : def;
        break;
      // Texte libre : on ne valide rien ici. Ce que la chaîne veut dire
      // n'appartient qu'au script qui la lit (une table de paliers, par
      // exemple) — la juger ici demanderait au registre de connaître les
      // scripts, ce qu'il ne fait justement jamais.
      case 'text':
        out[f.key] = typeof v === 'string' ? v : (def ?? '');
        break;
      case 'segmented':
      case 'select':
        out[f.key] = (f.options ?? []).some(o => o.value === v) ? v : def;
        break;
      default:
        out[f.key] = v ?? def;
    }
  }
  return out;
}
