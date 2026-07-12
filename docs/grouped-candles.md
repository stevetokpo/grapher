# Bougies groupées — logique

## L'idée de base

En mode normal, le graphe affiche une bougie par unité de temps (ex. une bougie = 1 heure). En mode **grouped**, on fusionne les bougies qui vont dans le même sens en une seule grande bougie, jusqu'à ce que le marché change de direction.

## Comment on regroupe

On parcourt les bougies dans l'ordre chronologique. Tant que le marché continue dans la même direction (hausse ou baisse), on accumule. Dès qu'il change de sens, on ferme la bougie courante et on en démarre une nouvelle.

**Ce qui compose la bougie fusionnée :**

- Elle ouvre là où la première bougie du groupe a ouvert
- Elle ferme là où la dernière bougie du groupe a clôturé
- Son plus haut est le plus haut atteint pendant tout le groupe
- Son plus bas est le plus bas atteint pendant tout le groupe
- Son volume est la somme des volumes de toutes les bougies du groupe

## Ce que ça donne visuellement

Au lieu de voir une succession haussier / baissier / haussier / haussier / baissier, on voit une alternance propre : haussier / baissier / haussier / baissier. Chaque bougie représente une "vague" de marché, peu importe combien de bougies individuelles elle contenait.

Une bougie groupée peut donc représenter 1 seule bougie brute si le marché inverse tout de suite, ou des dizaines si la tendance dure longtemps.

## Pourquoi c'est utile

En mode normal, il est parfois difficile de voir la structure directionnelle du marché à cause du "bruit" des petites inversions. Le mode groupé fait ressortir les vraies impulsions et les vrais retracements, indépendamment du temps. On lit le marché en termes de **mouvements** plutôt qu'en termes de **temps**.

## La limite à garder en tête

Les bougies groupées ne sont plus régulières dans le temps. Une "bougie" peut durer 1 heure ou 12 heures selon la force de la tendance. C'est voulu, mais cela veut dire qu'on ne peut plus lire la durée d'un mouvement directement sur l'axe horizontal comme en mode normal.
