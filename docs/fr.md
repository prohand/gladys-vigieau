# VigiEau — vigilance sécheresse dans Gladys

Cette intégration interroge [VigiEau](https://vigieau.gouv.fr), le service de
l'État qui publie le **niveau de vigilance sécheresse** et les **restrictions
d'eau** en vigueur à une adresse, et expose le résultat sous forme de capteurs
Gladys.

L'API VigiEau est gratuite et publique : **aucun compte, aucune clé d'API**.

## Ce que vous obtenez

**Un appareil par lieu surveillé**, nommé « Vigilance sécheresse — _votre lieu_ »,
avec cinq capteurs chacun. Vous pouvez suivre jusqu'à **dix lieux** : une maison,
une résidence secondaire et un jardin relèvent rarement du même arrêté
préfectoral.

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
2. Cliquez sur **« Ajouter un lieu (rechercher une adresse) »**, saisissez votre
   adresse (rue, code postal, commune) et, si vous le souhaitez, un **nom**
   (« Maison », « Jardin »… — sans nom, la commune est utilisée). Le lieu est
   créé, ses coordonnées sont géocodées à votre place, et son appareil apparaît
   dans l'onglet **Découverte**, prêt à être ajouté.
3. Recommencez pour chaque lieu à surveiller, jusqu'à dix.
4. Choisissez votre **profil d'usager** : particulier, entreprise, collectivité
   ou exploitation agricole. Les restrictions ne sont pas les mêmes pour tous, et
   VigiEau renvoie celles qui s'appliquent au vôtre. Ce réglage vaut pour **tous
   les lieux**.
5. Laissez l'**intervalle de rafraîchissement** à 3600 s (1 heure) : les arrêtés
   préfectoraux changent au plus une fois par jour. C'est l'intégration qui
   tient ce rythme elle-même ; le minimum appliqué est de 5 minutes, quoi que
   vous saisissiez.
6. Enregistrez.

> Tant qu'aucune adresse n'a été géocodée, aucun appareil n'est proposé. C'est
> voulu : mieux vaut pas d'appareil qu'un appareil rattaché à un lieu vide.

### Consulter et modifier un lieu

La section **« Le lieu à surveiller »** a sa propre liste déroulante. Juste en
dessous, le champ **« Lieux surveillés »** liste vos lieux numérotés avec leur
adresse et leurs coordonnées ; le lieu affiché y est marqué d'un ▶. C'est là que
vous lisez à quel lieu correspond « Lieu 2 ».

- **Aucun lieu ?** le champ vous le dit et vous renvoie vers « Ajouter un lieu ».
- **Un seul lieu ?** il est sélectionné et affiché d'office.
- **Plusieurs lieux ?** le premier est affiché ; choisissez-en un autre dans la
  liste déroulante.

1. Choisissez le numéro du lieu, puis cliquez sur
   **« Enregistrer la configuration »**.
2. **Rechargez la page (F5)** : les champs **Nom du lieu sélectionné**,
   **Adresse**, **Latitude** et **Longitude** affichent ses informations.
3. Modifiez ce que vous voulez et **Enregistrez** à nouveau :
   - changer le **nom** renomme le lieu (son appareil conserve son historique) ;
   - saisir une **nouvelle adresse** la géocode et déplace le point ;
   - saisir vous-même **latitude et longitude** l'emporte sur l'adresse. Les deux
     séparateurs décimaux sont acceptés : `48,8566` comme `48.8566` désignent le
     même point.

   Rechargez la page pour voir le résultat (l'adresse retenue, les coordonnées
   recalculées).

> **Pourquoi recharger la page ?** Gladys n'envoie rien à un écran de
> configuration déjà ouvert, et la réponse à un enregistrement est préparée
> avant même que l'intégration ait réagi. Après avoir changé de lieu, ajouté ou
> supprimé, les champs continuent donc d'afficher le précédent jusqu'au
> rechargement. Enregistrer cet écran périmé est sans danger — l'intégration
> sait ce qu'il affichait et n'applique que ce que vous avez réellement
> modifié — mais vous ne verrez les bonnes valeurs qu'après un F5.

> Si vous changez de lieu **et** modifiez un champ dans le même enregistrement,
> la modification est appliquée au lieu qui était affiché — celui que vous étiez
> en train de regarder — puis la section passe au nouveau. Rien n'est perdu.

### Supprimer un lieu

L'action **« Supprimer un lieu »** a **sa propre** liste déroulante,
indépendante de celle du haut : choisissez le numéro du lieu, cochez
**« Je confirme la suppression »** et lancez l'action. Lancée sans cocher, elle
se contente de vous dire quel lieu serait supprimé.

> Changer l'adresse d'un lieu ne crée pas un nouvel appareil : l'appareil
> **existant vous suit**, avec son historique, ses pièces et ses scènes. En
> revanche, supprimer un lieu ne supprime pas son appareil dans Gladys — une
> intégration n'en a pas le droit. Supprimez-le vous-même s'il ne vous sert
> plus.

## Pourquoi une adresse et pas un code postal

Le lieu surveillé est un **point précis**, pas une commune.

> Un **code postal** couvre souvent plusieurs communes, et une même commune
> peut relever de **plusieurs zones de restriction** pour un même type d'eau.
> C'est exactement le cas où VigiEau refuse de répondre et vous demande votre
> rue : le code de la commune ne suffit pas à désigner la zone applicable.

Un point géocodé n'a jamais ce problème : il tombe dans une seule zone par type
d'eau. L'intégration interroge donc toujours VigiEau par coordonnées.

### Le bouton de recherche

1. Cliquez sur **« Ajouter un lieu (rechercher une adresse) »**.
2. Saisissez votre adresse. Plus c'est précis, meilleure est la réponse :
   « 12 rue des Lilas, 82000 Montauban » vaut mieux que « Montauban ».
3. L'intégration géocode l'adresse sur la
   [Base Adresse Nationale](https://adresse.data.gouv.fr) officielle — le même
   service que le site VigiEau — crée le lieu et publie son appareil dans
   l'onglet **Découverte**. Rechargez la page pour voir les champs remplis.

Si plusieurs adresses correspondent **sans qu'aucune ne se détache**,
l'intégration **ne choisit pas au hasard** : elle affiche les candidates et
vous demande de préciser. Ajoutez le numéro, la rue ou la commune, et relancez.

Le message de confirmation affiche l'adresse retenue et ses coordonnées :
vérifiez-la d'un coup d'œil avant de continuer.

## Actions

- **Ajouter un lieu (rechercher une adresse)** — géocode l'adresse, crée le lieu
  et l'affiche dans « Le lieu à surveiller ». Rechargez la page pour le voir
  dans les champs. Voir « Pourquoi une adresse et pas un code postal » plus haut.
- **Supprimer un lieu** — retire de la surveillance le lieu choisi dans la liste
  déroulante de cette action, après confirmation. Son appareil Gladys, lui,
  reste : supprimez-le vous-même.
- **Tester la connexion VigiEau (tous les lieux)** — effectue une requête en
  direct et affiche le niveau actuel de chaque lieu, pour les trois types d'eau.
  À utiliser juste après la configuration pour vérifier que les lieux sont bien
  couverts.
- **Afficher les restrictions en vigueur (tous les lieux)** — liste les usages de
  l'eau actuellement restreints à chaque adresse pour votre profil, avec le lien
  vers l'arrêté préfectoral.

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
     volontairement aucun appareil. Utilisez le bouton
     **« Ajouter un lieu (rechercher une adresse) »**. Le champ
     **« Lieux surveillés »** liste ce qui est effectivement enregistré.
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
  coordonnée — ou, plus simple, saisissez l'adresse et laissez-la être
  géocodée.
- **Deux appareils « Vigilance sécheresse » après un changement d'adresse** —
  c'était le cas jusqu'à la version 1.1.1 : l'identifiant de l'appareil était
  construit à partir des coordonnées, si bien que chaque adresse créait un
  appareil de plus et que le précédent cessait de se rafraîchir. Désormais
  l'appareil suit l'adresse. Après la mise à jour, l'intégration reprend
  l'appareil que vous aviez déjà ajouté, historique compris — la ligne de log
  `Keeping the existing identity of drought-zone` indique lequel. Les appareils
  restés d'une ancienne adresse peuvent être supprimés dans Gladys.
- **Les champs affichent encore le lieu précédent** — rechargez la page (F5).
  Gladys n'envoie rien à un écran de configuration déjà ouvert : après avoir
  changé de lieu, ajouté ou supprimé, les champs gardent ce qu'ils avaient
  chargé. Enregistrer cet écran périmé ne casse rien — seul ce que vous avez
  réellement modifié est appliqué — mais les valeurs affichées, elles, ne
  seront justes qu'après le rechargement. L'intégration ne peut pas recharger
  la page à votre place : rien, dans Gladys, ne permet à une intégration de
  rafraîchir un écran de configuration ouvert.
- **La liste déroulante affiche « Lieu 1 », « Lieu 2 »… et pas les noms** — c'est
  une limite de Gladys, pas un choix : les options d'une liste déroulante sont
  écrites dans le fichier de description de l'intégration, donc figées, et la
  seule source dynamique prévue par Gladys n'est pas encore active côté serveur
  (vérifié sur la version 4.84.4). Le champ **« Lieux surveillés »** donne la
  correspondance numéro → nom.
- **Un appareil qui ne se rafraîchit plus après une suppression de lieu** —
  c'est attendu : une intégration ne peut pas supprimer un appareil Gladys, elle
  peut seulement cesser de le proposer. Supprimez-le dans Gladys.
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
  configuré ne tombe pas dans une seule zone. Sélectionnez le lieu concerné —
  le message le nomme — et saisissez une adresse plus précise (numéro et rue
  plutôt que le seul nom de la commune).
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
