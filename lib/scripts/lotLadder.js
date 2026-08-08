// L'ESCALIER DES LOTS — faire grossir la taille avec le compte.
//
// Un script fixe sa taille lui-même. Ce fichier ne fait qu'une chose : répondre
// à « combien de lots, vu où en est le compte ? ». Il est SANS ÉTAT tant qu'on
// ne lui demande pas de cliquet, ne touche jamais au compte, et ne sait rien de
// la stratégie qui l'appelle — c'est ce qui permet de le brancher sur n'importe
// quel script sans le contaminer.
//
// CE QU'UN ESCALIER FAIT, ET CE QU'IL NE FAIT PAS. Il multiplie l'espérance, il
// ne la crée pas. Sur une stratégie qui gagne 0,3 point par trade, monter le lot
// fait gagner plus vite ; sur une stratégie qui perd 0,7 point par trade, il fait
// perdre plus vite, et l'accélération est EXACTEMENT la même. Aucun escalier,
// aucune martingale, aucun palier n'a jamais changé le signe d'une espérance —
// c'est la seule chose que la taille ne peut pas faire. À brancher donc APRÈS
// avoir montré que la stratégie gagne à lot fixe, jamais pour l'y amener.
//
// LES CINQ MODES, du plus sage au plus explosif :
//   • `fixe`           — lot constant. Le compte croît LINÉAIREMENT.
//   • `proportionnel`  — lot = base × solde / capital. C'est la composition
//     honnête : chaque trade risque la même FRACTION du compte, la courbe est
//     exponentielle, et le drawdown en POURCENTAGE ne bouge pas d'un cheveu.
//   • `paliers` + `plus`  — +N lots tous les X USD gagnés. Escalier arithmétique,
//     très proche du proportionnel si le pas est bien choisi, mais par marches.
//   • `table`          — les paliers ÉCRITS À LA MAIN : « à 2000, lot 0,05 ». Pour
//     qui a un plan de progression précis plutôt qu'une formule.
//   • `paliers` + `fois` — ×F lots tous les X USD. Croissance SUPER-exponentielle :
//     le lot double quand le compte fait +1000, redouble à +2000, alors que le
//     compte, lui, n'a pas doublé. C'est la façon la plus rapide de transformer
//     une série de pertes ordinaire en ruine. Disponible parce qu'on la demande,
//     documentée pour qu'on sache ce qu'on demande.
//
// LE CLIQUET (`ladderDown`) est le vrai piège, et il ne se voit pas sur une
// courbe qui monte. En `cliquet`, le lot ne redescend jamais : le compte monte à
// 3000, prend le lot du palier 3000, puis retombe à 2000 — et continue d'y
// perdre au lot du palier 3000. La perte en pourcentage du compte grandit à
// chaque marche redescendue, et c'est ainsi qu'un système qui survivait à un
// creux de 30 % n'y survit plus. En `symetrique`, le lot suit le compte dans les
// deux sens : c'est ce que fait un dimensionnement en % du capital, et c'est la
// seule version dont on sache dire qu'elle ne change pas le risque de ruine.
//
// LA RÉFÉRENCE (`ladderRef`) : `solde` ne compte que les positions FERMÉES ;
// `equite` inclut le flottant, donc une position ouverte en gain monte le lot de
// la suivante — et une série qui se retourne les emporte toutes ensemble. Le
// défaut est `solde`, et ce n'est pas de la timidité : c'est le seul des deux
// qui ne peut pas être démenti par la bougie suivante.
//
// UNITÉS — le palier est un NIVEAU DE COMPTE en USD (cf. lib/scripts/account.js :
// un point × un lot = un dollar par défaut), pas un gain. « Palier 2000 » veut
// dire « quand le compte vaut 2000 », pas « quand j'ai gagné 2000 ». C'est ainsi
// qu'on parle d'un compte, et ça évite d'avoir à se rappeler du capital de départ.
//
// CE QUI N'EST PAS ICI, et qui appartient au compte : le pas de lot du broker,
// le lot minimum et maximum (`normalizeLots`), et la marge libre — un lot que
// l'escalier calcule peut très bien être REFUSÉ à l'ouverture, et c'est
// `Account.open` qui le comptera. L'escalier propose, le compte dispose.

export const LADDER_DEFAULTS = {
  ladderMode:  'fixe',        // 'fixe' | 'proportionnel' | 'paliers' | 'table'
  baseLots:    0.10,          // lot du palier 0, celui du capital de départ
  ladderStep:  1000,          // largeur d'un palier, en USD de compte (mode 'paliers')
  ladderKind:  'plus',        // 'plus' = +lots par palier | 'fois' = ×lots par palier
  ladderPlus:  0.10,          // lots ajoutés par palier franchi
  ladderTimes: 2,             // facteur appliqué par palier franchi
  ladderTable: '',            // paliers écrits à la main : « 2000:0.2, 5000:0.5 »
  ladderRef:   'solde',       // 'solde' | 'equite'
  ladderDown:  'symetrique',  // 'symetrique' | 'cliquet'
  ladderMax:   0,             // plafond de lot propre au script (0 = aucun)
};

// « 2000:0.2, 5000:0.5 ; 10000:1 » → [{ level: 2000, lots: 0.2 }, …], trié.
// Tolérant sur les séparateurs (virgule, point-virgule, retour à la ligne) et
// sur le lien (deux-points, égal, espace) : c'est un champ que l'on tape à la
// main, il ne doit pas punir une virgule de trop. Une ligne illisible est
// IGNORÉE et rendue à part — le panneau la montre plutôt que de la taire.
export function parseLadderTable(raw = '') {
  const rows = [], bad = [];
  for (const chunk of String(raw).split(/[,;\n]+/)) {
    const s = chunk.trim();
    if (!s) continue;
    const m = s.match(/^(-?[\d.]+)\s*[:=\s]\s*(-?[\d.]+)$/);
    const level = m ? Number(m[1]) : NaN;
    const lots  = m ? Number(m[2]) : NaN;
    if (!Number.isFinite(level) || !Number.isFinite(lots) || lots <= 0) { bad.push(s); continue; }
    rows.push({ level, lots });
  }
  rows.sort((a, b) => a.level - b.level);
  return { rows, bad };
}

// L'escalier lui-même. `capital` est le capital de DÉPART : c'est lui qui donne
// son origine au palier 0, et sans lui les modes 'paliers' et 'proportionnel'
// n'auraient pas de point de référence.
export function createLotLadder(params = {}, capital = 0) {
  const p = { ...LADDER_DEFAULTS, ...params };
  const table = parseLadderTable(p.ladderTable);
  const base  = p.baseLots > 0 ? p.baseLots : LADDER_DEFAULTS.baseLots;
  const step  = p.ladderStep > 0 ? p.ladderStep : LADDER_DEFAULTS.ladderStep;

  // Le cliquet, et lui seul, a besoin d'une mémoire.
  let peakLots  = 0;
  let peakLevel = 0;

  // Numéro de palier franchi — 0 = on est au capital de départ ou en dessous.
  // Un compte qui a FONDU rend un palier négatif en mode symétrique : le lot
  // descend alors sous la base, ce qui est le comportement voulu (c'est ce que
  // fait un % du capital). `table` n'en a pas besoin : elle est absolue.
  const levelOf = ref => {
    if (p.ladderMode === 'table') {
      let k = 0;
      for (let j = 0; j < table.rows.length; j++) if (ref >= table.rows[j].level) k = j + 1;
      return k;
    }
    return Math.floor((ref - capital) / step);
  };

  const rawLotsOf = (ref, level) => {
    switch (p.ladderMode) {
      case 'proportionnel':
        return capital > 0 ? base * (ref / capital) : base;
      case 'table':
        return level > 0 ? table.rows[level - 1].lots : base;
      case 'paliers':
        return p.ladderKind === 'fois'
          ? base * Math.pow(p.ladderTimes > 0 ? p.ladderTimes : 1, level)
          : base + level * p.ladderPlus;
      default:
        return base;
    }
  };

  return {
    table,
    mode: p.ladderMode,

    // Le lot brut pour ce niveau de compte. À passer ensuite par
    // `api.normalizeLots` : le pas de lot et les bornes appartiennent au broker.
    lots(ref) {
      const level = levelOf(ref);
      let lots = rawLotsOf(ref, level);

      // Un escalier ne rend jamais un lot négatif ou nul : sous le premier
      // palier, on retombe sur la base plutôt que de cesser de trader — le lot
      // minimum du compte tranchera si la base elle-même est trop petite.
      if (!(lots > 0)) lots = base;

      if (p.ladderDown === 'cliquet') {
        if (level > peakLevel) peakLevel = level;
        if (lots > peakLots)   peakLots  = lots;
        lots = Math.max(lots, peakLots);
      }
      if (p.ladderMax > 0) lots = Math.min(lots, p.ladderMax);
      return +lots.toFixed(6);
    },

    level: levelOf,
    get peak() { return { lots: peakLots, level: peakLevel }; },

    // Une phrase pour le journal du run : sans elle, un rapport relu dans six
    // mois ne dirait pas à quelle taille il a été joué.
    describe() {
      const ref  = p.ladderRef === 'equite' ? 'équité' : 'solde';
      const desc = p.ladderDown === 'cliquet' ? 'cliquet (le lot ne redescend jamais)' : 'symétrique';
      const cap  = p.ladderMax > 0 ? ` · plafond ${p.ladderMax} lots` : '';
      switch (p.ladderMode) {
        case 'proportionnel':
          return capital > 0
            ? `lot proportionnel — ${base} lots pour ${capital} USD, suivi sur l'${ref}${cap}`
            : `lot proportionnel au compte — base ${base} · ${ref}${cap}`;
        case 'table':
          return `paliers écrits — ${table.rows.map(r => `${r.level}→${r.lots}`).join(' · ') || 'aucun'}`
               + ` · base ${base} · ${ref} · ${desc}${cap}`;
        case 'paliers':
          return p.ladderKind === 'fois'
            ? `×${p.ladderTimes} lots tous les ${step} USD — base ${base} · ${ref} · ${desc}${cap}`
            : `+${p.ladderPlus} lots tous les ${step} USD — base ${base} · ${ref} · ${desc}${cap}`;
        default:
          return `lot fixe ${base}`;
      }
    },
  };
}

// Le formulaire de l'escalier, à insérer tel quel dans le `fields` d'un script.
// `when` permet de le masquer quand le script propose aussi un dimensionnement
// en % du capital et que c'est celui-là qui est choisi.
export function ladderFields(when = null) {
  const w = extra => (when ? p => when(p) && (extra ? extra(p) : true) : (extra ?? undefined));
  return [
    { kind: 'divider', label: 'Escalier des lots', when: w() },
    { kind: 'segmented', key: 'ladderMode', label: 'Progression', when: w(), options: [
      { value: 'fixe',           label: 'Fixe' },
      { value: 'proportionnel',  label: 'Proportionnel' },
      { value: 'paliers',        label: 'Paliers' },
      { value: 'table',          label: 'Table' },
    ] },
    { kind: 'number', key: 'baseLots', label: 'Lot de départ', min: 0.001, max: 1000, step: 0.01, when: w() },

    { kind: 'hint', when: w(p => p.ladderMode === 'fixe'), text:
      "Lot constant : le compte croît en ligne droite, et le pire creux traversé vaut le même nombre "
      + "de dollars au début qu'à la fin. C'est le seul mode qui permette de LIRE une stratégie — "
      + "commencer par lui, toujours." },
    { kind: 'hint', when: w(p => p.ladderMode === 'proportionnel'), text:
      "Lot = départ × compte / capital. Chaque trade risque la même FRACTION du compte : la courbe "
      + "devient exponentielle et le drawdown en POURCENTAGE ne change pas. C'est la composition "
      + "honnête — celle qui ne coûte rien de plus que ce qu'elle rapporte." },

    { kind: 'row', when: w(p => p.ladderMode === 'paliers'), fields: [
      { kind: 'number', key: 'ladderStep', label: 'Palier (USD)', min: 1, max: 100000000, step: 100 },
      { kind: 'number', key: 'ladderPlus', label: '+ lots / palier', min: 0, max: 1000, step: 0.01 },
    ] },
    { kind: 'segmented', key: 'ladderKind', label: 'Marche', when: w(p => p.ladderMode === 'paliers'), options: [
      { value: 'plus', label: '+ lots' },
      { value: 'fois', label: '× lots' },
    ] },
    { kind: 'number', key: 'ladderTimes', label: '× lots / palier', min: 1, max: 100, step: 0.1,
      when: w(p => p.ladderMode === 'paliers' && p.ladderKind === 'fois') },
    { kind: 'hint', when: w(p => p.ladderMode === 'paliers' && p.ladderKind === 'fois'), text:
      "⚠ ×2 tous les 1000 USD, c'est un lot qui DOUBLE quand le compte fait +1000 — alors que le "
      + "compte, lui, n'a pas doublé. Deux paliers plus haut, une série de pertes ordinaire coûte "
      + "quatre fois ce qu'elle coûtait. C'est le mode qui ruine, et il ne prévient pas." },

    { kind: 'text', key: 'ladderTable', label: 'Paliers', placeholder: '2000:0.2, 5000:0.5, 10000:1',
      when: w(p => p.ladderMode === 'table') },
    { kind: 'hint', when: w(p => p.ladderMode === 'table'), text:
      "« niveau de compte : lot », séparés par des virgules. Le lot d'un palier s'applique dès que le "
      + "compte ATTEINT ce niveau ; en dessous du premier, c'est le lot de départ qui sert." },

    { kind: 'row', when: w(p => p.ladderMode !== 'fixe'), fields: [
      { kind: 'segmented', key: 'ladderRef', label: 'Suivi sur', options: [
        { value: 'solde',  label: 'Solde' },
        { value: 'equite', label: 'Équité' },
      ] },
      { kind: 'segmented', key: 'ladderDown', label: 'À la baisse', options: [
        { value: 'symetrique', label: 'Symétrique' },
        { value: 'cliquet',    label: 'Cliquet' },
      ] },
    ] },
    { kind: 'hint', when: w(p => p.ladderMode !== 'fixe'), text:
      "SOLDE = positions fermées seulement. ÉQUITÉ inclut le flottant : une position ouverte en gain "
      + "monte le lot de la suivante, et un retournement les emporte ensemble. CLIQUET = le lot ne "
      + "redescend jamais — le compte retombe, les pertes restent à la taille du plus haut palier "
      + "atteint, et c'est comme ça qu'un creux survivable cesse de l'être." },
    { kind: 'number', key: 'ladderMax', label: 'Plafond de lot (0 = aucun)', min: 0, max: 100000, step: 0.1,
      when: w(p => p.ladderMode !== 'fixe') },
  ];
}
