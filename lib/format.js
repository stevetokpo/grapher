export function fmtPrice(n) {
  if (n == null) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(3);
  return n.toFixed(5);
}

export function fmtVol(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

export function fmtCount(n) {
  return Number(n ?? 0).toLocaleString();
}

// Montants des scripts. Le capital et les gains sont comptés en POINTS de prix —
// l'affichage dit USD, parce qu'on raisonne en compte, pas en points. Un seul
// endroit pour ce mensonge assumé, et signé (cf. lib/scripts/account.js).
export function fmtUsd(n, { sign = false, decimals = 2 } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = n < 0 ? '−' : sign ? '+' : '';
  return `${prefix}$${s}`;
}

export function fmtPct(n, { sign = false, decimals = 1 } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const prefix = n > 0 && sign ? '+' : '';
  return `${prefix}${n.toFixed(decimals)} %`;
}

// HH:MM en UTC. Les timestamps MT5 sont naïfs (heure serveur du broker) :
// on n'applique jamais le fuseau local, sinon les heures divergent entre vues.
export function fmtTimeHM(epoch) {
  const d = new Date(epoch * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
