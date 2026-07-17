// Registre des stratégies de backtest.
// Pour ajouter une stratégie : créer le fichier dans ce dossier (voir le
// contrat documenté dans docs/backtesting.md et l'exemple maCross.js),
// puis l'importer et l'ajouter au tableau STRATEGIES — rien d'autre :
// l'API et le formulaire UI se génèrent depuis le schéma `params`.

import maCross        from './maCross';
import rsiReversion   from './rsiReversion';
import twinsBars      from './twinsBars';
import trenderHarmony from './trenderHarmony';
import eqBalance      from './eqBalance';
import rfvgZone       from './rfvgZone';

export const STRATEGIES = [
  rfvgZone,
  eqBalance,
  trenderHarmony,
  maCross,
  rsiReversion,
  twinsBars,
];

export function getStrategy(id) {
  return STRATEGIES.find(s => s.id === id) ?? null;
}

// Valeurs par défaut du schéma → objet params complet
export function defaultParams(strategy) {
  const out = {};
  for (const p of strategy.params) out[p.key] = p.def;
  return out;
}

// Fusionne les params reçus avec les défauts, en validant type et bornes.
// Toute valeur invalide retombe sur le défaut — l'API ne rejette jamais
// un backtest pour un paramètre hors bornes, elle le clampe.
export function sanitizeParams(strategy, raw = {}) {
  const out = {};
  for (const p of strategy.params) {
    const v = raw[p.key];
    switch (p.type) {
      case 'int':
      case 'float': {
        const n = p.type === 'int' ? parseInt(v, 10) : parseFloat(v);
        out[p.key] = Number.isFinite(n)
          ? Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, n))
          : p.def;
        break;
      }
      case 'select':
        out[p.key] = p.options.includes(v) ? v : p.def;
        break;
      case 'bool':
        out[p.key] = typeof v === 'boolean' ? v : p.def;
        break;
      default:
        out[p.key] = v ?? p.def;
    }
  }
  return out;
}
