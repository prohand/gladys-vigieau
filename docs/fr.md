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
3. Renseignez le **code INSEE de la commune** — c'est le seul champ de
   localisation obligatoire. Le plus simple : cliquez sur **« Rechercher ma
   commune »**, tapez son nom, et le code est renseigné pour vous (voir
   « Trouver votre code INSEE » ci-dessous).
4. **Facultatif** : la **latitude** et la **longitude** du lieu (WGS-84). Vous
   pouvez les laisser vides. Ne les renseignez que si votre commune est assez
   étendue pour relever de plusieurs zones de restriction : dans ce cas la
   position exacte remplace la commune dans la requête. Il faut les **deux** —
   une latitude seule est ignorée.
5. Choisissez votre **profil d'usager** : particulier, entreprise, collectivité
   ou exploitation agricole. Les restrictions ne sont pas les mêmes pour tous, et
   VigiEau renvoie celles qui s'appliquent au vôtre.
6. Laissez l'**intervalle de rafraîchissement** à 3600 s (1 heure) : les arrêtés
   préfectoraux changent au plus une fois par jour. C'est l'intégration qui
   tient ce rythme elle-même ; le minimum appliqué est de 5 minutes, quoi que
   vous saisissiez.
7. Enregistrez : l'appareil apparaît dans l'onglet **Découverte**, prêt à être
   ajouté.

> Tant que le code INSEE n'est pas renseigné, aucun appareil n'est proposé et
> l'intégration l'indique dans son écran de configuration. C'est voulu : mieux
> vaut pas d'appareil qu'un appareil rattaché à un lieu vide.

> Si vous changez de lieu après coup (nouveau code INSEE, ou ajout/retrait des
> coordonnées), Gladys découvre un **nouvel** appareil : ajoutez-le, puis
> supprimez l'ancien. Renommer simplement le lieu ne change rien à l'appareil
> existant.

## Trouver votre code INSEE

Le code INSEE identifie une commune française sur **5 caractères** : `75056`
pour Paris, `69123` pour Lyon, `2A004` pour Ajaccio.

> **Ce n'est pas le code postal.** Un code postal peut couvrir plusieurs
> communes, et une grande ville a plusieurs codes postaux pour un seul code
> INSEE. Utiliser le code postal dans le champ INSEE donnera une erreur ou un
> mauvais résultat.

### Le plus simple : le bouton de recherche

Dans l'écran de configuration, l'action **« Rechercher ma commune (remplit le
code INSEE) »** fait le travail à votre place :

1. Cliquez sur le bouton.
2. Tapez le **nom de la commune** (« Bordeaux »). Vous pouvez aussi ne saisir
   que le **code postal** : c'est celui que vous avez sur votre courrier.
3. L'intégration interroge l'API Géo officielle, écrit le code INSEE dans le
   champ **Code INSEE de la commune** et publie l'appareil dans l'onglet
   **Découverte**. Rechargez la page pour voir le champ rempli.

Si plusieurs communes portent le même nom — il existe une douzaine de
« Sainte-Marie » — l'intégration **ne choisit pas au hasard** : elle affiche la
liste des candidates avec leur département et leur code INSEE. Relancez la
recherche en ajoutant le code postal, ou recopiez le bon code.

### À la main

- **La recherche géographique de l'INSEE** —
  <https://www.insee.fr/fr/recherche/recherche-geographique> : cherchez votre
  commune, le code officiel géographique est affiché sur sa fiche.
- **L'API Géo officielle**, si vous préférez une réponse directe — ouvrez
  <https://geo.api.gouv.fr/communes?nom=Paris&fields=code,nom> dans votre
  navigateur et remplacez `Paris` par le nom de votre commune. Le champ `code`
  de la réponse est le code INSEE.

Les deux liens sont également accessibles depuis l'écran de configuration de
l'intégration, juste au-dessus du champ.

## Actions

- **Rechercher ma commune (remplit le code INSEE)** — cherchez par nom et/ou
  code postal, le code INSEE est renseigné automatiquement. Voir « Trouver
  votre code INSEE » plus haut.
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
  1. Le **code INSEE est-il renseigné** ? Sans lui, l'intégration ne publie
     volontairement aucun appareil et l'écran de configuration l'indique.
     Utilisez le bouton **« Rechercher ma commune »**.
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
- **« Cette commune relève de plusieurs zones VigiEau du même type »** — la
  commune est couverte par plusieurs zones d'alerte du même type, et le code
  INSEE seul ne permet pas à VigiEau de choisir laquelle s'applique (le site
  vous demande alors votre rue). **Renseignez la latitude et la longitude** du
  lieu : la position exacte lève l'ambiguïté. Réessayer sans elles ne servira à
  rien.
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
