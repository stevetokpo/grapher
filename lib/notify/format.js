// Rendu d'un signal en texte. Les canaux partagent ce format pour qu'une
// alerte lue sur Telegram, en mail ou en push dise exactement la même chose.

const ARROW = { buy: '▲', sell: '▼' };

// Les timestamps en base sont des TIMESTAMP naïfs en HEURE BROKER (même
// convention que l'import CSV). On les rend tels quels, sans conversion de
// fuseau : afficher « 14:30 (broker) » est honnête, deviner le fuseau ne l'est pas.
export function fmtBrokerTime(epochSec) {
  return new Date(epochSec * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtPrice(v) {
  if (!Number.isFinite(v)) return '—';
  return String(Number(v.toFixed(6)));
}

// signal → { title, lines, text }
export function formatSignal(s) {
  const dir   = s.signal === 'buy' ? 'ACHAT' : 'VENTE';
  const arrow = ARROW[s.signal] ?? '•';
  const title = `${arrow} ${dir} ${s.symbol} ${s.tf}`;

  const lines = [];
  lines.push(`Alerte : ${s.alertName}`);
  lines.push(`Stratégie : ${s.strategyLabel}`);
  if (s.action.endsWith('Stop')) {
    lines.push(`Ordre : ${s.action} @ ${fmtPrice(s.price)}`);
  } else {
    lines.push(`Prix (clôture) : ${fmtPrice(s.price)}`);
  }
  if (Number.isFinite(s.sl)) lines.push(`SL : ${fmtPrice(s.sl)}`);
  if (Number.isFinite(s.tp)) lines.push(`TP : ${fmtPrice(s.tp)}`);
  if (s.reason)              lines.push(`Motif : ${s.reason}`);
  lines.push(`Bougie : ${fmtBrokerTime(s.candleTs)} (heure broker)`);

  return { title, lines, text: `${title}\n\n${lines.join('\n')}` };
}
