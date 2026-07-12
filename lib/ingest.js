import { query, run } from './db';

// Renvoie l'id du symbole, en le créant s'il n'existe pas.
// Partagé entre l'import CSV (/api/import) et le flux live MT5 (/api/live/*).
export async function getOrCreateSymbol(name) {
  let [sym] = await query('SELECT id FROM symbols WHERE name = ?', name);
  if (!sym) {
    await run(
      "INSERT INTO symbols (id, name) VALUES (nextval('seq_symbols'), ?) ON CONFLICT DO NOTHING",
      name,
    );
    [sym] = await query('SELECT id FROM symbols WHERE name = ?', name);
  }
  return sym.id;
}

// Contrôle d'accès des routes d'ingestion live.
// GRAPHER_INGEST_KEY absente/vide → tout passe (usage local).
// Définie → l'appelant doit envoyer le header x-ingest-key identique.
export function ingestAuthorized(req) {
  const key = process.env.GRAPHER_INGEST_KEY;
  if (!key) return true;
  return req.headers['x-ingest-key'] === key;
}

// Nom de symbole plausible côté MT5 (lettres/chiffres/espaces/ponctuation légère).
export function validSymbolName(s) {
  return typeof s === 'string' && /^[\w .&#/+-]{1,64}$/.test(s.trim());
}
