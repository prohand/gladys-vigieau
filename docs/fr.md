# VigiEau — vigilance sécheresse dans Gladys

Cette intégration interroge [VigiEau](https://vigieau.gouv.fr), le service de
l'État qui publie le **niveau de vigilance sécheresse** et les **restrictions
d'eau** en vigueur à une adresse, et expose le résultat sous forme de capteurs
Gladys.

L'API VigiEau est gratuite et publique : **aucun compte, aucune clé d'API**.

## Ce que vous obtenez

Un appareil « Vigilance sécheresse — _votre lieu_ » avec cinq capteurs :

| Capteur                            | Valeur                                      |
| ---------------------------------- | ------------------------------------------- |
| **Niveau de vigilance sécheresse** | 0 à 4 — le plus élevé des trois types d'eau |
| **Niveau (texte)**                 | « Alerte renforcée », « Crise »…            |
| **Niveau eau superficielle**       | 0 à 4 — rivières, lacs (zones `SUP`)        |
| **Niveau eau souterraine**         | 0 à 4 — nappes phréatiques (zones `SOU`)    |
| **Niveau eau potable**             | 0 à 4 — réseau d'eau potable (zones `AEP`)  |

L'échelle numérique suit celle des arrêtés préfectoraux :

| Valeur | Niveau             | Ce que cela signifie                                       |
| ------ | ------------------ | ---------------------------------------------------------- |
| 0      | Pas de restriction | Rien en vigueur à cette adresse                            |
| 1      | Vigilance          | Appel aux économies d'eau, pas encore d'interdiction       |
| 2      | Alerte             | Premières interdictions (arrosage, lavage…)                |
| 3      | Alerte renforcée   | Interdictions étendues, horaires plus stricts              |
| 4      | Crise              | Seuls les usages prioritaires (santé, sécurité) subsistent |

Un même lieu peut relever de plusieurs zones : un arrêté peut restreindre la
nappe phréatique sans toucher au robinet. C'est pourquoi les trois types d'eau
sont exposés séparément, en plus du niveau global.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Donnez un **nom au lieu** (« Maison », « Jardin »…) : il apparaît dans le nom
   de l'appareil.
3. Cliquez sur **« Rechercher mon adresse »**, saisissez votre adresse (rue,
   code postal, commune) et validez : la **latitude** et la **longitude** sont
   renseignées à votre place. C'est le seul champ de localisation.
4. Choisissez votre **profil d'usager** : particulier, entreprise, collectivité
   ou exploitation agricole. Les restrictions ne sont pas les mêmes pour tous, et
   VigiEau renvoie celles qui s'appliquent au vôtre.
5. Laissez l'**intervalle de rafraîchissement** à 3600 s (1 heure) : les arrêtés
   préfectoraux changent au plus une fois par jour. C'est l'intégration qui
   tient ce rythme elle-même ; le minimum appliqué est de 5 minutes, quoi que
   vous saisissiez.
6. Enregistrez : l'appareil apparaît dans l'onglet **Découverte**, prêt à être
   ajouté.

> Tant qu'aucune adresse n'a été géocodée, aucun appareil n'est proposé et
> l'intégration l'indique dans son écran de configuration. C'est voulu : mieux
> vaut pas d'appareil qu'un appareil rattaché à un lieu vide.

> Si vous changez de lieu après coup (nouvelle adresse), Gladys découvre un
> **nouvel** appareil : ajoutez-le, puis supprimez l'ancien. Renommer
> simplement le lieu ne change rien à l'appareil existant.

## Pourquoi une adresse et pas un code postal

Le lieu surveillé est un **point précis**, pas une commune.

> Un **code postal** couvre souvent plusieurs communes, et une même commune
> peut relever de **plusieurs zones de restriction** pour un même type d'eau.
> C'est exactement le cas où VigiEau refuse de répondre et vous demande votre
> rue : le code de la commune ne suffit pas à désigner la zone applicable.

Un point géocodé n'a jamais ce problème : il tombe dans une seule zone par type
d'eau. L'intégration interroge donc toujours VigiEau par coordonnées.

### Le bouton de recherche

1. Cliquez sur **« Rechercher mon adresse (remplit les coordonnées) »**.
2. Saisissez votre adresse. Plus c'est précis, meilleure est la réponse :
   « 12 rue des Lilas, 82000 Montauban » vaut mieux que « Montauban ».
3. L'intégration géocode l'adresse sur la
   [Base Adresse Nationale](https://adresse.data.gouv.fr) officielle — le même
   service que le site VigiEau — écrit la latitude et la longitude dans les
   champs, et publie l'appareil dans l'onglet **Découverte**. Rechargez la page
   pour voir les champs remplis.

Si plusieurs adresses correspondent **sans qu'aucune ne se détache**,
l'intégration **ne choisit pas au hasard** : elle affiche les candidates et
vous demande de préciser. Ajoutez le numéro, la rue ou la commune, et relancez.

Le message de confirmation affiche l'adresse retenue et ses coordonnées :
vérifiez-la d'un coup d'œil avant de continuer.

## Actions

- **Rechercher mon adresse (remplit les coordonnées)** — géocode votre adresse
  et renseigne la latitude et la longitude. Voir « Pourquoi une adresse et pas
  un code postal » plus haut.
- **Tester la connexion VigiEau** — effectue une requête en direct et affiche le
  niveau actuel pour les trois types d'eau. À utiliser juste après la
  configuration pour vérifier que le lieu est bien couvert.
- **Afficher les restrictions en vigueur** — liste les usages de l'eau
  actuellement restreints à cette adresse pour votre profil, avec le lien vers
  l'arrêté préfectoral.

## Idées de scènes

- **Couper l'arrosage automatique** dès que « Niveau de vigilance sécheresse »
  atteint 1 (Vigilance) ou 2 (Alerte), selon votre prudence.
- **Recevoir une notification** quand le niveau change : déclencheur sur le
  capteur « Niveau (texte) », qui contient le libellé officiel.
- **Suivre la saison** : les capteurs numériques conservent leur historique, un
  graphique montre la montée en gravité de l'été.

## Dépannage

- **Aucun appareil dans l'onglet Découverte** — dans l'ordre :
  1. La **latitude et la longitude sont-elles renseignées** ? Sans elles,
     l'intégration ne publie volontairement aucun appareil et l'écran de
     configuration l'indique. Utilisez le bouton
     **« Rechercher mon adresse »**.
  2. Cliquez sur **Scanner** dans l'onglet Découverte pour forcer une nouvelle
     publication.
  3. Regardez les **logs de l'intégration**. Une ligne commençant par
     `Published` confirme que Gladys a accepté l'appareil. Si vous voyez plutôt
     `Post-connection initialization failed`, le message qui suit donne la
     raison exacte — elle est aussi affichée dans l'écran de configuration.
  4. Vérifiez que le conteneur tourne bien : une image Docker introuvable
     (`manifest unknown`) empêche l'intégration de démarrer, et rien n'est
     jamais publié.
- **« Pas de valeur récente » sur toutes les fonctionnalités** — juste après
  l'ajout de l'appareil, c'est normal quelques secondes : Gladys ignore les
  valeurs publiées avant que l'appareil n'existe. L'intégration détecte la
  création et rafraîchit immédiatement. Si l'écran reste vide au bout d'une
  minute, utilisez l'action **Tester la connexion VigiEau** : elle interroge
  l'API en direct et affiche l'erreur éventuelle.
- **Les fonctionnalités s'appellent toutes « Niveau de risque »** — c'est
  l'affichage de Gladys : la liste « Fonctionnalités » de la fiche appareil
  montre le libellé générique de la catégorie, pas le nom publié par
  l'intégration. Dans l'ordre, ce sont : niveau global, texte, eau
  superficielle, eau souterraine, eau potable. Sur un tableau de bord ou dans
  une scène, les quatre niveaux affichent bien leurs vrais noms.
- **« VigiEau n'arrive pas à déterminer la zone applicable ici »** — le point
  configuré ne tombe pas dans une seule zone. Relancez **« Rechercher mon
  adresse »** avec une adresse plus précise (numéro et rue plutôt que le seul
  nom de la commune).
- **Aucune donnée / erreur dans les logs** — vérifiez d'abord avec l'action
  **Tester la connexion VigiEau**. Une erreur `VigiEau HTTP 5xx` signale une
  indisponibilité passagère du service : elle est affichée dans l'écran de
  configuration, et l'intégration réessaie au rafraîchissement suivant sans
  s'arrêter.
- **Les valeurs ne se rafraîchissent pas toutes les minutes** — c'est normal.
  L'appareil ne passe pas par le mécanisme d'interrogation de Gladys (plafonné
  à une minute) : l'intégration se rafraîchit toute seule à l'intervalle
  configuré, immédiatement à la connexion puis toutes les heures par défaut.
- **Tous les niveaux à 0** — c'est la réponse normale quand aucune zone de
  restriction ne couvre l'adresse (VigiEau ne couvre que la France).
- **Le niveau ne bouge plus alors que l'API a changé** — l'intégration ne publie
  jamais une valeur qu'elle n'a pas comprise, pour ne pas annoncer à tort « pas
  de restriction ». Les logs contiennent alors un avertissement
  « VigiEau returned an unknown severity ».

L'intégration journalise tout ce qu'elle fait : consultez ses logs depuis
l'interface Gladys (ou `docker logs` sur l'hôte) avec `LOG_LEVEL=debug` pour le
détail complet, y compris l'URL appelée.

## Source des données

Les données proviennent de VigiEau, opéré par le ministère de la Transition
écologique. Elles sont fournies à titre informatif : en cas de doute, l'arrêté
préfectoral publié par votre préfecture fait foi.
