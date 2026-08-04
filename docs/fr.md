# VigiEau — vigilance sécheresse dans Gladys

Cette intégration interroge [VigiEau](https://vigieau.gouv.fr), le service de
l'État qui publie le **niveau de vigilance sécheresse** et les **restrictions
d'eau** en vigueur à une adresse, et expose le résultat sous forme de capteurs
Gladys.

L'API VigiEau est gratuite et publique : **aucun compte, aucune clé d'API**.

## Ce que vous obtenez

Un appareil « Vigilance sécheresse — _votre lieu_ » avec six capteurs :

| Capteur                            | Valeur                                      |
| ---------------------------------- | ------------------------------------------- |
| **Niveau de vigilance sécheresse** | 0 à 4 — le plus élevé des trois types d'eau |
| **Niveau (texte)**                 | « Alerte renforcée », « Crise »…            |
| **Restrictions en cours**          | Actif dès que le niveau dépasse 0           |
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
3. Indiquez **où regarder**, au choix :
   - le **code INSEE de la commune** (5 caractères, par exemple `75056` pour
     Paris) — c'est l'option la plus fiable ; il est prioritaire sur les
     coordonnées ;
   - ou la **latitude** et la **longitude** du lieu (WGS-84). Vous les trouvez
     dans Gladys (maison → position) ou sur n'importe quelle carte.
4. Choisissez votre **profil d'usager** : particulier, entreprise, collectivité
   ou exploitation agricole. Les restrictions ne sont pas les mêmes pour tous, et
   VigiEau renvoie celles qui s'appliquent au vôtre.
5. Laissez l'**intervalle de rafraîchissement** à 3600 s (1 heure) : les arrêtés
   préfectoraux changent au plus une fois par jour.
6. Enregistrez : l'appareil apparaît dans l'onglet **Découverte**, prêt à être
   ajouté.

> Si vous changez de lieu après coup (nouvelles coordonnées ou nouveau code
> INSEE), Gladys découvre un **nouvel** appareil : ajoutez-le, puis supprimez
> l'ancien. Renommer simplement le lieu ne change rien à l'appareil existant.

## Actions

- **Tester la connexion VigiEau** — effectue une requête en direct et affiche le
  niveau actuel pour les trois types d'eau. À utiliser juste après la
  configuration pour vérifier que le lieu est bien couvert.
- **Afficher les restrictions en vigueur** — liste les usages de l'eau
  actuellement restreints à cette adresse pour votre profil, avec le lien vers
  l'arrêté préfectoral.

## Idées de scènes

- **Couper l'arrosage automatique** dès que « Restrictions en cours » passe à
  actif, ou que « Niveau de vigilance sécheresse » atteint 2 (Alerte).
- **Recevoir une notification** quand le niveau change : déclencheur sur le
  capteur « Niveau (texte) », qui contient le libellé officiel.
- **Suivre la saison** : les capteurs numériques conservent leur historique, un
  graphique montre la montée en gravité de l'été.

## Dépannage

- **Aucune donnée / erreur dans les logs** — vérifiez d'abord avec l'action
  **Tester la connexion VigiEau**. Une erreur `VigiEau HTTP 5xx` signale une
  indisponibilité passagère du service : l'intégration réessaiera au
  rafraîchissement suivant.
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
