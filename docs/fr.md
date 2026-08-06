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
4. Dans **« Réglages généraux »**, choisissez votre **profil d'usager** : particulier, entreprise, collectivité
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

### Consulter les lieux

La section **« Informations sur les lieux »** est un tableau : **une ligne par
lieu surveillé**, numérotée, au format

```
Nom | Adresse | Latitude | Longitude
```

Ces lignes sont écrites par l'intégration. Seuls les lieux configurés y
apparaissent : les lignes suivantes restent vides. Les numéros sont ceux que
propose la liste déroulante de **« Supprimer un lieu »** — c'est là que vous
lisez à quel lieu correspond « Lieu 2 ».

> **Un lieu ne se modifie pas.** Pour changer d'adresse, ajoutez le nouveau lieu
> avec « Ajouter un lieu », puis supprimez l'ancien. C'est un **nouvel appareil**
> qui est proposé dans l'onglet Découverte : l'historique de l'ancien reste
> attaché à l'ancien appareil, et le nom du lieu est celui que vous donnez à la
> création.
>
> Pourquoi cette limite ? Modifier un lieu supposait de pouvoir en désigner un
> dans l'écran de configuration, et une liste déroulante d'intégration ne peut
> proposer que des options écrites d'avance dans son fichier de description :
> jamais vos noms de lieux. Les champs qui suivaient cette liste continuaient
> par ailleurs d'afficher le lieu précédent tant que la page n'était pas
> rechargée, avec le risque d'écrire l'adresse de l'un sur l'autre.

> **Pourquoi recharger la page (F5) ?** Gladys n'envoie rien à un écran de
> configuration déjà ouvert. Après un ajout ou une suppression, le tableau
> continue d'afficher ce qu'il avait chargé jusqu'au rechargement. Vous pouvez
> enregistrer cet écran périmé sans risque : le tableau est un affichage, jamais
> une saisie — l'intégration le réécrit à partir de la liste réellement
> enregistrée. Écrire dans une ligne ne crée donc aucun lieu.

### Supprimer un lieu

Dans l'action **« Supprimer un lieu »**, choisissez le **numéro de la ligne**
du tableau, cochez **« Je confirme la suppression »** et lancez l'action.
Lancée sans cocher, elle se contente de vous dire quel lieu serait supprimé.

> Les lieux situés sous celui que vous supprimez **remontent d'une ligne** : le
> message vous le rappelle, et un rechargement (F5) vous montre la nouvelle
> numérotation avant la suppression suivante.

Ce qu'il advient de l'appareil dépend de ce que vous en aviez fait :

- **Vous ne l'aviez jamais ajouté** (il n'était que proposé dans l'onglet
  Découverte) : il disparaît de la découverte immédiatement, l'intégration
  cessant de le proposer. Le message vous le confirme.
- **Vous l'aviez ajouté à Gladys** : il **reste** et cesse de se mettre à jour.
  Une intégration n'a pas le droit de supprimer un appareil — Gladys ne lui en
  donne aucun moyen. Le message vous donne son nom exact : supprimez-le
  vous-même depuis l'onglet **Appareils** de l'intégration.

> Supprimer un lieu ne supprime pas son appareil dans Gladys — une intégration
> n'en a pas le droit. Supprimez-le vous-même s'il ne vous sert plus.

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
   l'onglet **Découverte**. Rechargez la page pour voir sa ligne dans le
   tableau.

Si plusieurs adresses correspondent **sans qu'aucune ne se détache**,
l'intégration **ne choisit pas au hasard** : elle affiche les candidates et
vous demande de préciser. Ajoutez le numéro, la rue ou la commune, et relancez.

Le message de confirmation affiche l'adresse retenue et ses coordonnées :
vérifiez-la d'un coup d'œil avant de continuer.

## Actions

- **Ajouter un lieu (rechercher une adresse)** — géocode l'adresse et crée le
  lieu. Rechargez la page pour voir sa ligne dans « Informations sur les
  lieux ». Voir « Pourquoi une adresse et pas un code postal » plus haut.
- **Supprimer un lieu** — retire de la surveillance le lieu dont vous choisissez
  le numéro de ligne, après confirmation. Son appareil Gladys, lui, reste :
  supprimez-le vous-même.
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
     **« Ajouter un lieu (rechercher une adresse) »**. Le tableau
     **« Informations sur les lieux »** liste ce qui est effectivement
     enregistré.
  2. Cliquez sur **Scanner** dans l'onglet Découverte pour forcer une nouvelle
     publication.
  3. Regardez les **logs de l'intégration**. Une ligne commençant par
     `Published` confirme que Gladys a accepté l'appareil. Si vous voyez plutôt
     `Post-connection initialization failed`, le message qui suit donne la
     raison exacte — elle est aussi affichée dans l'écran de configuration.
  4. Vérifiez que le conteneur tourne bien : une image Docker introuvable
     (`manifest unknown`) empêche l'intégration de démarrer, et rien n'est
     jamais publié.
- **Je voudrais corriger la latitude ou la longitude d'un lieu** — ce n'est plus
  possible depuis l'écran de configuration : les coordonnées affichées dans le
  tableau sont celles que le géocodage a retenues. Ajoutez un lieu avec une
  adresse plus précise, puis supprimez l'ancien.
- **Deux appareils « Vigilance sécheresse » après un changement d'adresse** —
  c'était le cas jusqu'à la version 1.1.1 : l'identifiant de l'appareil était
  construit à partir des coordonnées, si bien que chaque adresse créait un
  appareil de plus et que le précédent cessait de se rafraîchir. Désormais
  l'appareil suit l'adresse. Après la mise à jour, l'intégration reprend
  l'appareil que vous aviez déjà ajouté, historique compris — la ligne de log
  `Keeping the existing identity of drought-zone` indique lequel. Les appareils
  restés d'une ancienne adresse peuvent être supprimés dans Gladys.
- **Le tableau n'affiche pas le lieu que je viens d'ajouter (ou de supprimer)** —
  rechargez la page (F5). Gladys n'envoie rien à un écran de configuration déjà
  ouvert : le tableau garde ce qu'il avait chargé. Enregistrer cet écran périmé
  ne casse rien — l'intégration réécrit les lignes à partir de la liste
  enregistrée. L'intégration ne peut pas recharger la page à votre place : rien,
  dans Gladys, ne permet à une intégration de rafraîchir un écran de
  configuration ouvert.
- **Le tableau propose dix lignes alors que je n'ai que deux lieux** — les
  champs d'un écran de configuration sont écrits d'avance dans le fichier de
  description de l'intégration : les dix lignes existent toujours, seules celles
  qui correspondent à un lieu sont remplies. Pour la même raison, la liste
  déroulante de la suppression affiche « Lieu 1 », « Lieu 2 »… et pas vos noms :
  c'est le tableau qui donne la correspondance numéro → nom.
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
  configuré ne tombe pas dans une seule zone. Le message nomme le lieu
  concerné : ajoutez-le à nouveau avec une adresse plus précise (numéro et rue
  plutôt que le seul nom de la commune), puis supprimez l'ancien.
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
