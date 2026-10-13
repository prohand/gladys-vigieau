# VigiEau — Französische Dürrewarnstufen in Gladys

Diese Integration fragt [VigiEau](https://vigieau.gouv.fr) ab, den Dienst des
französischen Staates, der die **Dürrewarnstufe** und die an einer Adresse
geltenden **Wasserbeschränkungen** veröffentlicht, und stellt das Ergebnis als
Gladys-Sensoren bereit.

Die VigiEau-API ist kostenlos und öffentlich: **kein Konto, kein API-Schlüssel**.
Sie deckt **nur Frankreich** ab.

## Was Sie erhalten

**Ein Gerät pro überwachtem Ort**, benannt „Vigilance sécheresse — _Ihr Ort_“,
mit jeweils sieben Sensoren. Sie können bis zu **zehn Orte** überwachen: Ein
Haus, ein Zweitwohnsitz und ein Schrebergarten fallen selten unter denselben
Präfekturerlass.

| Sensor                       | Wert                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| **Dürrewarnstufe**           | 0 bis 3 — die schlechteste der drei Wasserarten                             |
| **Stufe (Text)**             | „Alerte renforcée“, „Crise“…                                                |
| **Stufe Oberflächenwasser**  | 0 bis 3 — Flüsse und Seen (Zonen `SUP`)                                     |
| **Stufe Grundwasser**        | 0 bis 3 — Grundwasserleiter (Zonen `SOU`)                                   |
| **Stufe Trinkwasser**        | 0 bis 3 — das Leitungswassernetz (Zonen `AEP`)                              |
| **Dernière mise à jour**     | „15/06/2026 09:26“ — die letzte erfolgreiche VigiEau-Abfrage für diesen Ort |
| **Arrêté en vigueur depuis** | „15/06/2026“ — der Tag, an dem der Erlass dieser Stufe in Kraft trat        |

> **Die beiden Daten sagen nicht dasselbe aus.** VigiEau veröffentlicht keinen
> Zeitstempel seiner eigenen Daten: Nichts in der API sagt „diese Information
> stammt vom…“. **Dernière mise à jour** ist daher der Moment, in dem _die
> Integration_ VigiEau zuletzt erfolgreich für diesen Ort abgefragt hat — das
> unterscheidet einen eingefrorenen Sensor von einer Stufe, die sich einfach
> nicht geändert hat. Der Wert ändert sich nur bei einer erfolgreichen Abfrage:
> Nach einem Ausfall bleibt er wie die Stufe auf seinem vorherigen Wert.
> **Arrêté en vigueur depuis** ist ein Datum aus der Quelle: der Tag, an dem der
> geltende Präfekturerlass in Kraft trat. Ist nichts in Kraft, zeigt der Sensor
> „Aucun arrêté en vigueur“, statt das Datum eines aufgehobenen Erlasses zu
> behalten. Beide werden in Pariser Zeit angezeigt, unabhängig von der Zeitzone
> des Servers.

Die numerische Skala folgt den Präfekturerlassen, zusammengefasst auf die vier
Werte, die Gladys benennen kann:

| Wert | Anzeige in Gladys | VigiEau-Stufe                   | Bedeutung                                             |
| ---- | ----------------- | ------------------------------- | ----------------------------------------------------- |
| 0    | Kein Risiko       | Pas de restriction              | An dieser Adresse gilt nichts                         |
| 1    | Niedrig           | Vigilance                       | Wassersparen empfohlen, noch kein Verbot              |
| 2    | Mittel            | Alerte                          | Erste Verbote (Bewässerung, Autowäsche…)              |
| 3    | Hoch              | Alerte renforcée **oder** Crise | Weitere Verbote, bis hin zu nur vorrangigen Nutzungen |

> Gladys kann eine Risikostufe nur von 0 bis 3 benennen; alles darüber wird als
> „Unbekannt“ angezeigt. „Alerte renforcée“ und „Crise“ teilen sich daher den
> Wert 3. Der Sensor **Stufe (Text)** behält den genauen amtlichen Wortlaut,
> „Crise“ eingeschlossen — nutzen Sie ihn, um die beiden zu unterscheiden.

Ein Ort kann zu mehreren Zonen gehören: Ein Erlass kann das Grundwasser
einschränken, ohne das Leitungswasser zu betreffen. Deshalb werden die drei
Wasserarten zusätzlich zur Gesamtstufe getrennt bereitgestellt.

## Konfiguration

1. Öffnen Sie den Tab **Konfiguration** der Integration.
2. Klicken Sie auf **„Ort hinzufügen (Adresse suchen)“**, geben Sie Ihre Adresse
   ein (Straße, Postleitzahl, Gemeinde) und, wenn Sie möchten, einen **Namen**
   („Maison“, „Jardin“… — bleibt er leer, wird die Gemeinde verwendet). Der Ort
   wird angelegt, seine Koordinaten werden für Sie geokodiert, und sein Gerät
   erscheint im Tab **Entdecken**, bereit zum Hinzufügen. Kennen Sie den Punkt
   bereits, füllen Sie stattdessen die optionalen Felder **Breitengrad** und
   **Längengrad** aus: Sie werden unverändert verwendet, ohne Geokodierung.
3. Wiederholen Sie das für jeden Ort, den Sie überwachen möchten, bis zu zehn.
   Sind die gewünschten Orte Ihre **Gladys-Zuhause**, erspart Ihnen die
   Schaltfläche **„Meine Gladys-Zuhause hinzufügen“** jede Eingabe: siehe
   „Ihre Gladys-Zuhause mit einem Klick hinzufügen“ weiter unten.
4. Wählen Sie unter **„Allgemeine Einstellungen“** Ihr **Nutzerprofil**:
   Privathaushalt, Unternehmen, Gebietskörperschaft oder landwirtschaftlicher
   Betrieb. Die Beschränkungen hängen vom Profil ab, und VigiEau liefert die,
   die für Ihres gelten. Diese Einstellung gilt für **alle Orte**.
5. Belassen Sie das **Aktualisierungsintervall** bei 3600 s (1 Stunde):
   Präfekturerlasse ändern sich höchstens einmal am Tag. Die Integration hält
   diesen Takt selbst ein, zwischen 15 Minuten und 24 Stunden, was immer Sie
   eingeben.
6. Speichern Sie.

> Solange kein Ort einen verwendbaren Punkt hat, wird kein Gerät angeboten. Das
> ist gewollt: Kein Gerät ist besser als ein Gerät, das an einen leeren Ort
> gebunden ist.

### Ihre Gladys-Zuhause mit einem Klick hinzufügen

Sie haben Gladys bereits mitgeteilt, wo Sie wohnen: Das ist die Karte unter
**Einstellungen > Zuhause**. Die Schaltfläche **„Meine Gladys-Zuhause
hinzufügen“** liest diese Zuhause und legt für jedes, das noch nicht überwacht
wird, einen Ort an — keine Adresse einzugeben, kein Risiko, die falsche Gemeinde
zu geokodieren. Der Ort übernimmt den Namen, den das Zuhause in Gladys trägt,
und die in der Liste angezeigte Adresse wird für Sie anhand des Punktes gesucht.

Einige Regeln, die die Meldung unter der Schaltfläche jedes Mal wiederholt:

- **Das Lesen der Koordinaten Ihrer Zuhause ist eine Berechtigung.** Wo Sie
  wohnen, sind personenbezogene Daten: Die Integration fordert sie in ihrem
  Manifest an, und Gladys zeigt Ihnen diese Anfrage bei der Installation. Meldet
  die Schaltfläche, dass Gladys die Weitergabe dieser Koordinaten verweigert,
  hat die installierte Version sie nie angefordert: Aktualisieren Sie die
  Integration, oder entfernen Sie sie, installieren Sie sie neu und akzeptieren
  Sie die Anfrage.
- **Ein Zuhause, das nie auf der Karte platziert wurde, hat keine
  Koordinaten.** Es wird in der Antwort genannt, und an seiner Stelle wird
  nichts überwacht: Verorten Sie es unter **Einstellungen > Zuhause** und
  klicken Sie dann erneut.
- **Ein bereits überwachtes Zuhause wird nicht doppelt hinzugefügt.** Klicken
  Sie so oft Sie möchten: Die Meldung sagt Ihnen, welcher Ort es bereits
  überwacht.
- **Es ist keine Synchronisierung.** Die Zuhause werden einmal beim Klick
  gelesen. Ein so angelegter Ort ist ein gewöhnlicher Ort: Verschieben Sie das
  Zuhause danach in Gladys, bleibt der Ort, wo er war — löschen Sie ihn und
  klicken Sie erneut.

### Ihre Orte anzeigen

Führen Sie die Aktion **„Orte anzeigen“** aus: Die Meldung unter der
Schaltfläche listet **alle konfigurierten Orte** nummeriert auf, in der Form

```
• number. name — address (latitude, longitude)
```

(in der deutschen Oberfläche: `• Nummer. Name — Adresse (Breitengrad, Längengrad)`).

Die Nummern sind diejenigen, die die Auswahlliste von **„Ort löschen“**
anbietet — hier lesen Sie ab, welcher Ort „Ort 2“ ist. Ein Ort mit unbrauchbaren
Koordinaten wird ebenfalls aufgeführt, mit einem Gedankenstrich an der Stelle
seines Punktes: Er wird weder veröffentlicht noch abgefragt, und diese Zeile ist
das Einzige, was darauf hinweist.

> **Warum stehen alle Orte in einer einzigen Zeile?** Die Integration sendet
> sehr wohl einen echten Zeilenumbruch zwischen zwei Orten — die Container-Logs
> zeigen ihn. Der Konfigurationsbildschirm zeigt die Antwort einer Aktion jedoch
> als **Text** eines einfachen Hinweisfelds an, und ein Browser stellt einen
> Zeilenumbruch dort als Leerzeichen dar: Keine Formatierung ist möglich, was
> auch immer die Integration sendet. Daher das **„•“** am Anfang jedes Ortes —
> es trennt die Einträge sichtbar, solange Gladys die Zeilenumbrüche
> zusammenfasst.

> **Warum eine Schaltfläche und keine Tabelle auf der Seite?** Der
> Konfigurationsbildschirm zeigt nichts von dem, was eine Integration zu sagen
> hat, außer der Meldung einer **Aktion** unter ihrer Schaltfläche — und er
> stellt nur Eingabefelder dar, nie einen schreibgeschützten Text. Eine Liste,
> die Sie nach und nach aufbauen, hat dort keinen Platz. Genau das macht
> „Orte anzeigen“ auch immer aktuell: Es gibt nichts neu zu laden.

> **Ein Ort kann nicht bearbeitet werden.** Um eine Adresse zu ändern, fügen
> Sie den neuen Ort mit „Ort hinzufügen“ hinzu und löschen dann den alten. Sie
> erhalten ein **neues Gerät** im Tab „Entdecken“: Das alte behält seinen
> eigenen Verlauf, und der Name eines Ortes ist der, den Sie ihm beim Anlegen
> geben.
>
> Warum diese Einschränkung? Einen Ort zu bearbeiten hieße, ihn im
> Konfigurationsbildschirm auszuwählen, und die Auswahlliste einer Integration
> kann nur Optionen anbieten, die vorab in ihrem Manifest stehen — nie Ihre
> Ortsnamen. Die Felder, die einer solchen Auswahlliste folgten, zeigten zudem
> den vorherigen Ort an, bis die Seite neu geladen wurde, mit dem Risiko, die
> Adresse eines Ortes auf einen anderen zu schreiben.

### Einen Ort löschen

Wählen Sie in der Aktion **„Ort löschen“** die **Nummer**, die „Orte anzeigen“
zeigt, setzen Sie das Häkchen bei **„Ich bestätige das Löschen“** und führen Sie
sie aus. Ohne Häkchen ausgeführt, sagt sie Ihnen nur, welcher Ort entfernt würde.

> Die Orte nach dem gelöschten **rücken eine Stelle nach oben**: Die Meldung
> weist darauf hin. Führen Sie „Orte anzeigen“ erneut aus, um vor dem nächsten
> Löschen die neue Nummerierung zu sehen.

Was mit dem Gerät geschieht, hängt davon ab, was Sie damit gemacht hatten:

- **Sie hatten es nie hinzugefügt** (es wurde nur im Tab „Entdecken“
  angeboten): Es verschwindet sofort aus der Erkennung, da die Integration es
  nicht mehr anbietet. Die Meldung bestätigt das.
- **Sie hatten es zu Gladys hinzugefügt**: Es **bleibt** und wird nicht mehr
  aktualisiert. Eine Integration darf kein Gerät löschen — Gladys bietet ihr
  keine Möglichkeit dazu. Die Meldung nennt Ihnen seinen genauen Namen: Löschen
  Sie es selbst im Tab **Geräte** der Integration.

> Das Löschen eines Ortes löscht nicht sein Gladys-Gerät — eine Integration
> darf das nicht. Löschen Sie es selbst, wenn Sie es nicht mehr brauchen.

## Warum eine Adresse und keine Postleitzahl

Der überwachte Ort ist ein **genauer Punkt**, keine Gemeinde.

> Eine **Postleitzahl** umfasst oft mehrere Gemeinden, und eine Gemeinde kann
> für dieselbe Wasserart in **mehreren Beschränkungszonen** liegen. Genau dann
> verweigert VigiEau die Antwort und verlangt Ihre Straße: Der Gemeindecode kann
> die geltende Zone nicht benennen.

Ein geokodierter Punkt hat dieses Problem nie — er liegt in genau einer Zone pro
Wasserart. Die Integration fragt VigiEau daher immer über Koordinaten ab.

### Die Suchschaltfläche

1. Klicken Sie auf **„Ort hinzufügen (Adresse suchen)“**.
2. Geben Sie Ihre Adresse ein. Je genauer, desto besser: „12 rue des Lilas,
   82000 Montauban“ ist besser als „Montauban“.
3. Die Integration geokodiert sie über die offizielle
   [Base Adresse Nationale](https://adresse.data.gouv.fr) — denselben Dienst,
   den die VigiEau-Website nutzt —, legt den Ort an und veröffentlicht sein Gerät
   im Tab **Entdecken**.

Passen mehrere Adressen **ohne eindeutigen Treffer**, **rät die Integration
nicht**: Sie listet die Kandidaten auf und bittet Sie um eine genauere Angabe.
Ergänzen Sie die Hausnummer, die Straße oder die Gemeinde und suchen Sie erneut.

Die Bestätigungsmeldung zeigt die gewählte Adresse und ihre Koordinaten: Prüfen
Sie sie kurz, bevor Sie weitermachen.

### Breiten- und Längengrad selbst eingeben

Die Felder **„Breitengrad“** und **„Längengrad“** derselben Aktion sind
**optional**. Füllen Sie beide aus, wird der Ort **unverändert** auf diesem
Punkt angelegt, ohne Geokodierung: der Ausweg für die Fälle, die eine Adresse
nicht abdecken kann — ein Grundstück ohne Straße, ein Weiler, den die Base
Adresse Nationale nicht kennt, oder ein auf einer Karte abgelesener Punkt.

- Es sind **Dezimalgrad WGS-84**: Breitengrad -90 bis 90, Längengrad -180 bis 180. Komma und Punkt werden beide akzeptiert („48,8566“ wie „48.8566“), und
  ein Wert außerhalb des Bereichs wird mit einer Meldung abgelehnt, die zeigt,
  was empfangen wurde.
- **Beide gehören zusammen**: Ein Breitengrad allein ist kein Punkt, und die
  Aktion lehnt ihn ab, statt ihn mit einer Null zu ergänzen — damit würden Sie
  den Golf von Guinea überwachen.
- Geben Sie **zusätzlich eine Adresse** ein, **haben die Koordinaten Vorrang**:
  Die Adresse ist dann nur die Bezeichnung, die „Orte anzeigen“ anzeigt (und der
  Name, wenn Sie keinen angeben). Ohne Adresse und ohne Namen wird der Ort nach
  seinen eigenen Koordinaten benannt.
- Ein auf einer Karte gewählter Punkt bleibt nur ein Punkt: Prüfen Sie ihn
  direkt nach dem Hinzufügen mit **„VigiEau-Verbindung testen“**.

## Aktionen

- **Ort hinzufügen (Adresse suchen)** — geokodiert die Adresse und legt den Ort
  an, oder legt ihn direkt auf dem eingegebenen Breiten- und Längengrad an
  (beide optional). Siehe „Warum eine Adresse und keine Postleitzahl“ oben.
- **Meine Gladys-Zuhause hinzufügen** — liest die in Gladys konfigurierten
  Zuhause und fügt für jedes, das noch nicht überwacht wird, einen Ort hinzu,
  ohne etwas einzugeben. Wählen Sie im Feld **Zuhause** ein Zuhause, um nur
  dieses hinzuzufügen (ein Ferienhaus, das nicht überwacht werden soll, bleibt
  außen vor); lassen Sie das Feld leer, um alle hinzuzufügen. Erfordert die bei
  der Installation akzeptierte Berechtigung und Gladys 5.2 oder neuer.
- **Orte anzeigen** — listet alle konfigurierten Orte nummeriert auf, mit Name,
  Adresse und Koordinaten. Diese Nummern sind die, die das Löschen anbietet.
- **VigiEau-Verbindung testen (alle Orte)** — führt eine Live-Abfrage aus und
  zeigt die aktuelle Stufe jedes Ortes für die drei Wasserarten. Nutzen Sie sie
  direkt nach der Konfiguration, um zu prüfen, ob Ihre Orte abgedeckt sind.
- **Geltende Beschränkungen anzeigen (alle Orte)** — listet die an jeder
  Adresse für Ihr Profil derzeit eingeschränkten Wassernutzungen auf, mit einem
  Link zum Erlass.
- **Ort löschen** — beendet nach Bestätigung die Überwachung des Ortes, dessen
  Nummer Sie wählen. Sein Gladys-Gerät bleibt: Löschen Sie es selbst. Es ist die
  letzte Schaltfläche des Bildschirms, die einzige, die etwas zerstört.

## Widgets, Szenenauslöser und Szenenaktionen (Gladys 5.1)

Seit Gladys 5.1 fügt die Integration dem Dashboard eigene Karten und dem
Szeneneditor eigene Bausteine hinzu. Sie alle bezeichnen einen Ort über **sein
Gerät**: Ein Ort, dessen Gerät Sie noch nicht aus dem Tab „Entdecken“
hinzugefügt haben, erscheint nicht in diesen Listen.

### Dashboard-Widgets

- **Dürrewarnung** — ein Ort, in den Einstellungen des Widgets gewählt: die
  Gesamtstufe und die Stufe jeder Wasserart (farbiger Punkt), das Datum des
  Erlasses, die Uhrzeit der letzten Abfrage, die Anzahl der eingeschränkten
  Nutzungen und ihre Liste (tippen Sie auf eine Nutzung, um die Details zu
  lesen). Zwei Schaltflächen: **Erlass ansehen** und **Aktualisieren**.
- **Dürre: alle Orte** — alle Orte auf einer Karte, eine farbige Zeile pro Ort,
  mit der Anzahl der Orte mit Einschränkung (Stufe Alerte oder höher) und einer
  Schaltfläche **Aktualisieren**.

Die Widgets folgen den Abfragen der Integration, ohne VigiEau bei jeder Anzeige
eines Dashboards abzufragen.

### Szenenauslöser

- **Die Dürrestufe hat sich geändert** — eine Abfrage ergibt für einen Ort eine
  andere Stufe als die vorherige. Optionale Filter (leer = beliebig): der Ort,
  die neue Stufe (die fünf VigiEau-Stufen, **Crise** eingeschlossen, die der
  numerische Sensor nicht von „Alerte renforcée“ unterscheiden kann) und die
  Richtung (Verschlechterung oder Verbesserung).
- **Ein neuer Erlass ist in Kraft** — eine Abfrage findet einen
  Präfekturerlass, den die vorherige Abfrage nicht hatte, selbst bei
  unveränderter Stufe. Optionaler Filter: der Ort.

Beide geben den folgenden Aktionen den Namen des Ortes, die Stufe in Worten,
den Link zum Erlass usw. weiter: Fügen Sie sie mit der Variablenauswahl des
Editors in eine Nachricht ein („Name des Ortes“, „Stufe (Text)“…).

Die **erste** Abfrage eines Ortes löst nichts aus: Sie legt den Bezugswert fest.
Dieser Bezugswert übersteht einen Neustart, sodass eine Änderung, die während
eines Updates der Integration eingetreten ist, die Szene bei der nächsten
Abfrage trotzdem auslöst. Ein Auslöser feuert im Takt der Abfragen: höchstens
einmal pro „Aktualisierungsintervall“.

### Szenenaktionen

- **Dürrestufe abfragen** — fragt VigiEau sofort für einen Ort ab und gibt den
  folgenden Aktionen seine Stufe (in Worten und als Code von 0 bis 4, wobei
  4 = Crise), die Stufe jeder Wasserart, die eingeschränkten Nutzungen und den
  Erlass weiter.
- **Prüfen, ob eine Wassernutzung eingeschränkt ist** — fragt VigiEau für einen
  Ort ab und meldet, ob eine Nutzung eingeschränkt ist: Geben Sie ein Wort ihres
  französischen Namens oder Themas ein („arrosage“, „piscine“, „lavage“…). Die
  Ausgabe „Eingeschränkt“ (wahr / falsch) lässt sich in einer Bedingung der
  Szene prüfen.

Diese Aktionen veröffentlichen nichts: Sie bewegen weder die Sensoren noch die
Auslöser, sodass sich eine Szene nie selbst neu starten kann.

## Ideen für Szenen

- **Die automatische Bewässerung stoppen**, sobald die „Dürrewarnstufe“ 1
  (Vigilance) oder 2 (Alerte) erreicht, je nachdem, wie vorsichtig Sie sein
  möchten.
- **Sich benachrichtigen lassen**, wenn sich die Stufe ändert: Auslöser „Die
  Dürrestufe hat sich geändert“, dann eine Nachricht mit den Variablen „Stufe
  (Text)“ und „Link zum Erlass“.
- **Vor dem Bewässern prüfen**: In der Bewässerungsszene die Aktion „Prüfen, ob
  eine Wassernutzung eingeschränkt ist“ mit „arrosage“, dann eine Bedingung auf
  „Eingeschränkt“, bevor das Ventil geöffnet wird.
- **Die Saison verfolgen**: Die numerischen Sensoren behalten ihren Verlauf,
  sodass ein Diagramm zeigt, wie die Stufe im Laufe des Sommers steigt.

## Fehlerbehebung

- **Kein Gerät im Tab „Entdecken“** — der Reihe nach:
  1. **Haben Sie einen Ort hinzugefügt?** Ohne einen verorteten Ort
     veröffentlicht die Integration bewusst kein Gerät. Nutzen Sie die
     Schaltfläche **„Ort hinzufügen (Adresse suchen)“**; die Aktion
     **„Orte anzeigen“** listet auf, was tatsächlich gespeichert ist.
  2. Klicken Sie im Tab „Entdecken“ auf **Scannen**, um eine neue
     Veröffentlichung zu erzwingen.
  3. Lesen Sie die **Protokolle der Integration**. Eine Zeile, die mit
     `Published` beginnt, bestätigt, dass Gladys das Gerät angenommen hat. Sehen
     Sie stattdessen `Post-connection initialization failed`, nennt die folgende
     Meldung den genauen Grund — er wird auch im Konfigurationsbildschirm
     angezeigt.
  4. Prüfen Sie, ob der Container tatsächlich läuft: Ein Docker-Image, das nicht
     heruntergeladen werden kann (`manifest unknown`), verhindert den Start der
     Integration, und es wird nie etwas veröffentlicht.
- **Ich möchte Breiten- oder Längengrad eines Ortes korrigieren** — ein Ort wird
  nie bearbeitet: Fügen Sie einen neuen hinzu, entweder mit einer genaueren
  Adresse oder indem Sie die gewünschten Koordinaten direkt in „Ort hinzufügen“
  eingeben, und löschen Sie dann den alten.
- **Zwei „Vigilance sécheresse“-Geräte nach einer Adressänderung** — das war bis
  Version 1.1.1 der Fall: Die Gerätekennung wurde aus den Koordinaten gebildet,
  sodass jede Adresse ihr eigenes Gerät erzeugte und das vorherige nicht mehr
  aktualisiert wurde. Das Gerät folgt jetzt der Adresse. Nach dem Update behält
  die Integration das bereits angelegte Gerät samt Verlauf — die Protokollzeile
  `Keeping the existing identity of drought-zone` sagt, welches. Jedes andere
  Gerät, das von einer älteren Adresse übrig ist, kann in Gladys gelöscht
  werden.
- **Ich finde meine Orte nirgends auf der Seite** — das ist gewollt: Ein
  Konfigurationsbildschirm stellt nur Eingabefelder dar und zeigt nichts von
  dem, was eine Integration zu sagen hat, außer der Meldung einer Aktion. Führen
  Sie **„Orte anzeigen“** aus: Die Liste erscheint unter der Schaltfläche, immer
  aktuell, ohne etwas neu zu laden.
- **Die Auswahlliste zum Löschen zeigt „Ort 1“, „Ort 2“… statt meiner Namen** —
  die Optionen einer Auswahlliste stehen vorab im Manifest der Integration: Es
  können nur Nummern sein. „Orte anzeigen“ ordnet einer Nummer einen Namen zu.
- **Ein Gerät, das nach dem Löschen eines Ortes nicht mehr aktualisiert wird** —
  das ist zu erwarten: Eine Integration kann kein Gladys-Gerät löschen, sie kann
  es nur nicht mehr anbieten. Löschen Sie es in Gladys.
- **„Kein aktueller Wert“ bei allen Funktionen** — direkt nach dem Hinzufügen
  des Geräts ist das für einige Sekunden normal: Gladys verwirft die Zustände,
  die veröffentlicht wurden, bevor das Gerät existierte. Die Integration bemerkt
  das Anlegen und aktualisiert sofort. Ist es nach einer Minute noch leer,
  nutzen Sie die Aktion **VigiEau-Verbindung testen**: Sie fragt die API live ab
  und zeigt jeden Fehler an.
- **Alle Funktionen heißen „Risikostufe“** — so zeigt Gladys sie an: Die Liste
  „Funktionen“ auf der Geräteseite zeigt die allgemeine Bezeichnung der
  Kategorie, nicht den von der Integration veröffentlichten Namen. Den drei
  Textsensoren — Stufe (Text), letzte Aktualisierung, Erlass in Kraft seit —
  geht es genauso, sie tragen eine identische allgemeine Bezeichnung. Der Reihe
  nach sind es: Gesamtstufe, Text, Oberflächenwasser, Grundwasser, Trinkwasser,
  letzte Aktualisierung, Erlass in Kraft seit. In einem Dashboard oder einer
  Szene zeigen sie alle ihren echten Namen.
- **„VigiEau kann nicht bestimmen, welche Zone hier gilt“** — der konfigurierte
  Punkt liegt nicht in einer einzigen Zone. Die Meldung nennt den Ort: Fügen Sie
  ihn mit einer genaueren Adresse erneut hinzu (Hausnummer und Straße statt nur
  des Gemeindenamens) und löschen Sie dann den alten.
- **Keine Daten / Fehler in den Protokollen** — beginnen Sie mit der Aktion
  **VigiEau-Verbindung testen**. Ein Fehler `VigiEau HTTP 5xx` bedeutet, dass
  der Dienst vorübergehend nicht verfügbar ist: Er wird im
  Konfigurationsbildschirm angezeigt, und die Integration versucht es bei der
  nächsten Aktualisierung erneut, ohne aufzugeben.
- **Die Werte werden nicht jede Minute aktualisiert** — das ist zu erwarten. Das
  Gerät nutzt nicht den Abfragemechanismus von Gladys (auf eine Minute
  begrenzt): Die Integration aktualisiert selbstständig im konfigurierten
  Intervall, sofort beim Verbinden und danach standardmäßig stündlich.
- **Alle Stufen auf 0** — das ist die normale Antwort, wenn keine
  Beschränkungszone die Adresse abdeckt (VigiEau deckt nur Frankreich ab).
- **Die Stufe bewegt sich nicht mehr, obwohl sich die API geändert hat** — die
  Integration veröffentlicht nie einen Wert, den sie nicht verstanden hat, und
  kann daher nicht fälschlich „keine Einschränkung“ melden. Die Protokolle
  enthalten dann eine Warnung `VigiEau returned an unknown severity`.

Die Integration protokolliert alles, was sie tut: Lesen Sie ihre Protokolle in
der Gladys-Oberfläche (oder mit `docker logs` auf dem Host) mit
`LOG_LEVEL=debug` für alle Details, einschließlich der aufgerufenen URL.

## Datenquelle

Die Daten stammen von VigiEau, betrieben vom französischen Ministerium für den
ökologischen Wandel. Sie dienen nur zur Information: Im Zweifelsfall ist der von
Ihrer Präfektur veröffentlichte Präfekturerlass maßgeblich.
