# VigiEau — vigilance sécheresse dans Gladys

Cette intégration interroge [VigiEau](https://vigieau.gouv.fr), le service de
l'État qui publie le **niveau de vigilance sécheresse** et les **restrictions
d'eau** en vigueur à une adresse, et expose le résultat sous forme de capteurs
Gladys.

L'API VigiEau est gratuite et publique : **aucun compte, aucune clé d'API**.

## Ce que vous obtenez

**Un appareil par lieu surveillé**, « Vigilance sécheresse — _votre lieu_ »,
avec cinq capteurs chacun. Vous pouvez suivre côte à côte votre maison, une
résidence secondaire et un jardin familial : ils relèvent rarement du même
arrêté préfectoral.

| Capteur                            | Valeur                                      |
| ---------------------------------- | ------------------------------------------- |
| **Niveau de vigilance sécheresse** | 0 à 3 — le plus élevé des trois types d'eau |
| **Niveau (texte)**                 | « Alerte renforcée », « Crise »…            |
| **Niveau eau superficielle**       | 0 à 3 — rivières, lacs (zones `SUP`)        |
| **Niveau eau souterraine**         | 0 à 3 — nappes phréatiques (zones `SOU`)    |
| **Niveau eau potable**             | 0 à 3 — réseau d'eau potable (zones `AEP`)  |

L'échelle numérique suit celle des arrêtés préfectoraux, ramenée aux quatre
valeurs que Gladys sait nommer :

| Valeur | Affiché par Gladys | Niveau VigiEau                | Ce que cela signifie                                        |
| ------ | ------------------ | ----------------------------- | ----------------------------------------------------------- |
| 0      | Pas de risque      | Pas de restriction            | Rien en vigueur à cette adresse                             |
| 1      | Faible             | Vigilance                     | Appel aux économies d'eau, pas encore d'interdiction        |
| 2      | Moyen              | Alerte                        | Premières interdictions (arrosage, lavage…)                 |
| 3      | Élevé              | Alerte renforcée **ou** Crise | Interdictions étendues, jusqu'aux seuls usages prioritaires |

> Gladys ne sait étiqueter qu'un niveau de risque de 0 à 3 : au-delà, il
> affiche « Inconnu ». « Alerte renforcée » et « Crise » partagent donc la
> valeur 3. Le capteur **Niveau (texte)** conserve le libellé officiel exact,
> « Crise » compris — utilisez-le pour distinguer les deux.

Un même lieu peut relever de plusieurs zones : un arrêté peut restreindre la
nappe phréatique sans toucher au robinet. C'est pourquoi les trois types d'eau
sont exposés séparément, en plus du niveau global.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez votre **profil d'usager** : particulier, entreprise, collectivité
   ou exploitation agricole. Les restrictions ne sont pas les mêmes pour tous, et
   VigiEau renvoie celles qui s'appliquent au vôtre. Ce réglage est commun à tous
   vos lieux.
3. Laissez l'**intervalle de rafraîchissement** à 3600 s (1 heure) : les arrêtés
   préfectoraux changent au plus une fois par jour. C'est l'intégration qui
   tient ce rythme elle-même ; le minimum appliqué est de 5 minutes, quoi que
   vous saisissiez.
4. Cliquez sur **« Ajouter un lieu »**, donnez-lui un nom (« Maison »,
   « Jardin »…) — il apparaît dans le nom de l'appareil — et saisissez votre
   adresse (rue, code postal, commune). L'intégration la géocode et crée
   l'appareil correspondant.
   Si vous préférez saisir les coordonnées vous-même — relevées sur une carte,
   par exemple — laissez l'adresse vide et remplissez **latitude** et
   **longitude** : les deux séparateurs décimaux sont acceptés, `48,8566` comme
   `48.8566` désignent le même point.
5. Recommencez pour chaque lieu à surveiller (10 au maximum).
6. Les appareils apparaissent dans l'onglet **Découverte**, prêts à être ajoutés.

> Tant qu'aucune adresse n'a été géocodée, aucun appareil n'est proposé et
> l'intégration l'indique dans son écran de configuration. C'est voulu : mieux
> vaut pas d'appareil qu'un appareil rattaché à un lieu vide.

> Si vous déplacez ou renommez un lieu après coup (**« Modifier un lieu »**),
> l'appareil **existant vous suit** : il conserve son historique, ses pièces et
> ses scènes, et rend compte du nouveau point. Rien à supprimer, rien à
> rajouter.

### Gérer plusieurs lieux

Les lieux se gèrent entièrement depuis les boutons de l'écran de configuration,
et non depuis des champs de formulaire : la liste se construit au fil de l'eau,
ce qu'un formulaire figé ne peut pas représenter.

- **Ajouter un lieu** — nom + adresse (ou coordonnées). Réutiliser un nom
  existant **met ce lieu à jour** au lieu d'en créer un double : c'est la façon
  de corriger une adresse saisie de travers avant même d'avoir créé l'appareil.
- **Modifier un lieu** — choisissez l'**appareil** dans la liste déroulante,
  puis donnez un nouveau nom, une nouvelle adresse, ou les deux. Ce qui est
  laissé vide n'est pas touché.
- **Supprimer un lieu** — choisissez l'appareil dans la liste déroulante. Pour
  un lieu dont l'appareil n'a jamais été ajouté depuis l'onglet Découverte (il
  n'apparaît donc pas dans la liste), saisissez son **nom exact** à la place.
- **Lister les lieux surveillés** — affiche la liste complète, avec l'adresse et
  les coordonnées de chacun.

> La liste déroulante ne propose que les appareils que vous avez **réellement
> ajoutés** depuis l'onglet Découverte : c'est Gladys qui la remplit, avec les
> appareils de l'intégration. Un lieu tout juste ajouté n'y figure donc pas
> encore.

> Supprimer un lieu arrête de proposer son appareil, mais **ne supprime pas
> l'appareil** : une intégration n'en a pas le droit. Supprimez-le vous-même
> dans Gladys, sans quoi il restera figé sur sa dernière valeur.

## Pourquoi une adresse et pas un code postal

Le lieu surveillé est un **point précis**, pas une commune.

> Un **code postal** couvre souvent plusieurs communes, et une même commune
> peut relever de **plusieurs zones de restriction** pour un même type d'eau.
> C'est exactement le cas où VigiEau refuse de répondre et vous demande votre
> rue : le code de la commune ne suffit pas à désigner la zone applicable.

Un point géocodé n'a jamais ce problème : il tombe dans une seule zone par type
d'eau. L'intégration interroge donc toujours VigiEau par coordonnées.

### La recherche d'adresse

1. Cliquez sur **« Ajouter un lieu »** (ou **« Modifier un lieu »**).
2. Saisissez votre adresse. Plus c'est précis, meilleure est la réponse :
   « 12 rue des Lilas, 82000 Montauban » vaut mieux que « Montauban ».
3. L'intégration géocode l'adresse sur la
   [Base Adresse Nationale](https://adresse.data.gouv.fr) officielle — le même
   service que le site VigiEau — enregistre le point et publie l'appareil dans
   l'onglet **Découverte**.

Si plusieurs adresses correspondent **sans qu'aucune ne se détache**,
l'intégration **ne choisit pas au hasard** : elle affiche les candidates et
vous demande de préciser. Ajoutez le numéro, la rue ou la commune, et relancez.

Le message de confirmation affiche l'adresse retenue et ses coordonnées :
vérifiez-la d'un coup d'œil avant de continuer.

## Actions

- **Ajouter un lieu** — géocode une adresse et crée l'appareil correspondant.
  Voir « Pourquoi une adresse et pas un code postal » plus haut.
- **Modifier un lieu** — renomme ou déplace un lieu existant, choisi par son
  appareil.
- **Supprimer un lieu** — arrête de surveiller un lieu.
- **Lister les lieux surveillés** — affiche la liste complète.
- **Tester la connexion VigiEau** — effectue une requête en direct et affiche le
  niveau actuel pour les trois types d'eau. À utiliser juste après la
  configuration pour vérifier que le lieu est bien couvert. Laissez le sélecteur
  d'appareil vide pour tester tous les lieux d'un coup.
- **Afficher les restrictions en vigueur** — liste les usages de l'eau
  actuellement restreints pour votre profil, avec le lien vers l'arrêté
  préfectoral. Là aussi, le sélecteur laissé vide couvre tous les lieux.

## Idées de scènes

- **Couper l'arrosage automatique** dès que « Niveau de vigilance sécheresse »
  atteint 1 (Vigilance) ou 2 (Alerte), selon votre prudence.
- **Recevoir une notification** quand le niveau change : déclencheur sur le
  capteur « Niveau (texte) », qui contient le libellé officiel.
- **Suivre la saison** : les capteurs numériques conservent leur historique, un
  graphique montre la montée en gravité de l'été.

## Dépannage

- **Aucun appareil dans l'onglet Découverte** — dans l'ordre :
  1. **Avez-vous ajouté un lieu** ? Sans lieu géocodé, l'intégration ne publie
     volontairement aucun appareil et l'écran de configuration l'indique.
     Utilisez le bouton **« Ajouter un lieu »**, puis **« Lister les lieux
     surveillés »** pour vérifier ce qui est enregistré.
  2. Cliquez sur **Scanner** dans l'onglet Découverte pour forcer une nouvelle
     publication.
  3. Regardez les **logs de l'intégration**. Une ligne commençant par
     `Published` confirme que Gladys a accepté l'appareil. Si vous voyez plutôt
     `Post-connection initialization failed`, le message qui suit donne la
     raison exacte — elle est aussi affichée dans l'écran de configuration.
  4. Vérifiez que le conteneur tourne bien : une image Docker introuvable
     (`manifest unknown`) empêche l'intégration de démarrer, et rien n'est
     jamais publié.
- **La latitude ou la longitude saisie à la main ne reste pas enregistrée** —
  c'était le cas jusqu'à la version 1.1.1 : les champs n'acceptaient que le
  séparateur décimal de votre navigateur, et une valeur qu'il refusait était
  ignorée sans message. Depuis, les deux séparateurs fonctionnent (`48,8566`
  comme `48.8566`). Mettez l'intégration à jour, puis ressaisissez la
  coordonnée — ou, plus simple, saisissez une adresse.
- **Mon lieu unique a-t-il survécu à la mise à jour ?** — oui. Le lieu configuré
  avant la version 1.3.0 devient automatiquement le premier de la liste, sous
  l'identifiant qui était déjà celui de son appareil : celui-ci garde son
  historique, ses pièces et ses scènes. Vérifiez avec **« Lister les lieux
  surveillés »**.
- **La liste déroulante « Appareil du lieu » est vide** — elle ne contient que
  les appareils **déjà ajoutés** depuis l'onglet Découverte. Ajoutez d'abord
  l'appareil ; pour supprimer un lieu qui n'en a pas encore, saisissez son nom
  exact dans le champ prévu à cet effet.
- **Deux appareils « Vigilance sécheresse » après un changement d'adresse** —
  c'était le cas jusqu'à la version 1.1.1 : l'identifiant de l'appareil était
  construit à partir des coordonnées, si bien que chaque adresse créait un
  appareil de plus et que le précédent cessait de se rafraîchir. Désormais
  l'appareil suit l'adresse. Après la mise à jour, l'intégration reprend
  l'appareil que vous aviez déjà ajouté, historique compris — la ligne de log
  `Keeping the existing identity of drought-zone` indique lequel. Les appareils
  restés d'une ancienne adresse peuvent être supprimés dans Gladys.
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
  configuré ne tombe pas dans une seule zone. Le message nomme le lieu
  concerné : reprenez-le avec **« Modifier un lieu »** et une adresse plus
  précise (numéro et rue plutôt que le seul nom de la commune).
- **Un seul lieu est en erreur** — les autres continuent normalement : chaque
  lieu est interrogé indépendamment, et l'écran de configuration nomme celui qui
  échoue.
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
