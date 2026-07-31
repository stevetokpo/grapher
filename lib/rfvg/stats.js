// Statistiques rFVG — le calcul lui-même est commun à tous les motifs et vit
// dans lib/signals/stats.js (population, classement par t-stat, études
// break-even et SL plafonné). Ce fichier n'existe plus que comme point d'entrée
// historique : pages/rapports.js, la page /rfvg et les API rFVG l'importent.
export { computeStats, summarize } from '../signals/stats';
