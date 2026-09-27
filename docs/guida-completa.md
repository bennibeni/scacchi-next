---
title: "Scacchi bullet — Capire e usare il laboratorio"
language: it
version: "1.0"
updated: "2026-09-27"
format: "Pagine Markdown con identificativi stabili, mostrate nella modale Guida"
---

# Scacchi bullet — Capire e usare il laboratorio

Questa guida accompagna l’app `scacchi-next`. Ogni intestazione `## Pagina NN` è una pagina della modale **Guida**; il commento `page:` le assegna un ID stabile, usato dai pulsanti **?** dell’interfaccia. I commenti `capitolo:` raggruppano le pagine e generano gli accessi rapidi.

I numeri citati vengono dall’estrazione del **27 settembre 2026** (57.968 partite 1+0 rated di Scaccomatto999) e dall’esperimento di riferimento: tutto lo storico, 100 alberi, profondità 6. Con dati aggiornati o impostazioni diverse cambieranno un po’.

<!-- capitolo: Le domande e i dati | Domande e dati -->

<!-- page:benvenuto -->
## Pagina 01 — Tre domande sulle mie partite

**Obiettivo:** capire che cosa l’app cerca di scoprire e perché non è banale.

Le domande di partenza sono tre:

1. **A parità di Elo dell’avversario, quanto conta l’apertura** sulla probabilità di vincere?
2. **In quale momento della giornata gioco meglio?**
3. **Quali altri fattori** (colore, pause, numero di partite, giorno della settimana…) influiscono sui risultati, e quali no?

Per rispondere l’app addestra quattro modelli sulle partite più vecchie, sceglie il migliore su un periodo intermedio e lo giudica sulle partite più recenti. Poi misura quanto peggiora il modello quando una colonna viene «rotta» mescolandola a caso: se non peggiora, quella colonna non contava.

Il percorso è:

```text
chess.com → CSV → Elo pre-partita ricostruito → colonne note PRIMA della partita
  → split per data: passato / intermedio / recente
  → 4 candidati → scelta sulla validazione → riaddestramento → test
  → importanza delle colonne → calibrazione → previsioni «cosa succederebbe se»
```

Una premessa cambia il modo di leggere tutto il resto: chess.com ti abbina ad avversari del tuo livello. Nel complesso vinci circa metà delle partite qualunque cosa tu faccia. Gli effetti da cercare sono quindi **piccoli, di pochi punti percentuali**, e servono molte partite per distinguerli dal caso.

**Da ricordare:** un modello utile qui non è uno che «indovina quasi sempre», ma uno che fa **un po’ meglio della sola formula Elo**, in modo stabile, su partite che non ha mai visto.

<!-- page:dati-chesscom -->
## Pagina 02 — Da dove vengono i dati

**Obiettivo:** sapere che cosa contiene il CSV e come viene prodotto.

Chess.com offre un’API pubblica, senza autenticazione, con l’archivio mensile delle partite di ogni giocatore:

```text
https://api.chess.com/pub/player/scaccomatto999/games/archives   → elenco dei mesi
https://api.chess.com/pub/player/scaccomatto999/games/2026/09    → partite del mese
```

Lo script `scripts/estrai_partite.py` scarica i mesi, li conserva in una cache locale e produce `data/partite.csv`. Tiene solo le partite **rated** a cadenza **1+0** (`time_control = 60`) con le regole standard: niente King of the Hill, Crazyhouse o 960.

Nell’estrazione del 27/9/2026 l’account contava partite dal novembre 2015; le 1+0 rated sono **57.968**, dal 9 gennaio 2016 a quella mattina. Ogni partita porta con sé il PGN, dove si trovano ora di inizio, codice ECO, nome dell’apertura e mosse con i tempi.

Le ore sono convertite nel fuso **Europe/Rome** (opzione `--fuso`). Se in qualche periodo hai giocato da un altro fuso, quelle ore risultano spostate: in quel caso conviene escludere quei mesi con `--dal`/`--al` oppure estrarli separatamente.

**Da ricordare:** il CSV è una fotografia. Per includere le partite nuove si preme **↻ Aggiorna dati** (oppure `npm run dati`); i modelli già salvati continuano a riflettere i dati con cui sono stati addestrati.

<!-- page:colonne -->
## Pagina 03 — Le colonne: prima e dopo la partita

**Obiettivo:** distinguere ciò che si può usare per prevedere da ciò che rivela il risultato.

Una previsione ha senso solo se usa informazioni disponibili **prima** di giocare. Il dizionario `data/partite.colonne.md` marca ogni colonna come **[PRE]**, **[POST]** o identificativo.

| Colonna del modello | Da dove viene | Note |
|---|---|---|
| Differenza Elo | `diff_elo` = Elo avversario − il tuo, entrambi **prima** della partita | positivo = avversario più forte |
| Colore | `colore` | bianco / nero |
| Pausa prima della partita | `pausa_min`, in 6 classi: <1, 1–3, 3–10, 10–30, 30–120, >120 minuti | contano le partite di ogni cadenza e variante |
| Posizione nella sessione | `posizione_sessione` | 1 = prima partita dopo più di 30 minuti di stop |
| Ora di inizio | `ora`, 0–23 | nel fuso scelto |
| Giorno della settimana | `giorno_settimana` | 1 = lunedì |
| Partite già giocate oggi | `partite_prima_oggi` | qualsiasi cadenza |
| Andamento Elo | `trend_elo_20` = Elo attuale − Elo di 20 partite prima | «sono in forma?» |
| Apertura | `famiglia_apertura`, dal nome chess.com | vedi sotto |

Escluse perché **[POST]**: Elo dopo la partita, variazione di Elo, modo in cui è finita (tempo, matto, abbandono), numero di mosse.

L’apertura è un caso intermedio: si conosce solo dopo le prime mosse, e col Nero dipende anche dall’avversario. Il nome è quello della **partita**, non di chi l’ha scelta: col Bianco «Sicilian Defense» significa che hai giocato 1.e4 e l’avversario ha risposto 1…c5. L’app la tratta come informazione nota «all’inizio» della partita, ed è giusto ricordarlo leggendo i risultati.

**Da ricordare:** la domanda da porsi per ogni colonna è sempre «l’avrei saputo prima di premere *Gioca*?».

<!-- page:elo-post-partita -->
## Pagina 04 — La trappola dell’Elo dopo la partita

**Obiettivo:** riconoscere un caso reale di data leakage.

L’API di chess.com, per ogni giocatore, riporta il punteggio **dopo** la partita. Chi vince sale di circa 8 punti e chi perde scende di altrettanti. Usando quei valori, la differenza di Elo «contiene» già il risultato.

La prima esplorazione dei dati l’ha mostrato in modo clamoroso: con l’Elo finale sembrava che, contro avversari più deboli di 25–50 punti, si facesse il **93%** dei punti. È impossibile: il 93% veniva dal fatto che, **avendo vinto**, eri salito e l’avversario era sceso.

La correzione:

- **Il tuo Elo prima** = il tuo Elo dopo la partita bullet precedente. Su chess.com 1+0 e 2+1 condividono lo stesso punteggio bullet, quindi lo script segue l’intero «pool» bullet.
- **L’Elo dell’avversario prima** ≈ il suo Elo finale + la tua variazione. Le variazioni del sistema Glicko sono quasi simmetriche ma non identiche: è una **stima**.
- Se la variazione supera 40 punti, la riga è marcata `elo_sospetto` e l’app la esclude. Nell’estrazione di riferimento erano 2 su 57.968.

Dopo la correzione i conti tornano: punteggio medio reale 0,502, punteggio medio atteso dalla formula 0,503.

**Da ricordare:** un risultato troppo bello per essere vero, in machine learning, è quasi sempre una colonna che conosce la risposta.

<!-- capitolo: Concetti | Concetti -->

<!-- page:probabilita -->
## Pagina 05 — Prevedere una probabilità, non un risultato

**Obiettivo:** capire perché i modelli restituiscono un numero tra 0 e 1.

Il target è **vittoria sì / no** (le patte, circa il 2%, contano come «no»). Un modello potrebbe rispondere solo «vinci» o «perdi», ma sarebbe poco utile: quasi tutte le partite sono vicine al 50%.

Per questo ogni modello restituisce una **probabilità**: «in partite come questa vinci il 54% delle volte». Non è una promessa sulla prossima partita, ma una frequenza su molte partite simili. Con il 54% perdi comunque 46 volte su 100.

Da una probabilità si ricava una decisione (vittoria prevista se p > 50%) e quindi un’**accuratezza**. Ma l’accuratezza è una misura grossolana: un modello che dice 51% e uno che dice 90% danno la stessa previsione «vittoria», anche se il secondo è molto più sicuro, e sbaglia di più quando perdi.

**Da ricordare:** in questo laboratorio conta quanto sono **buone le probabilità**, e per misurarlo serve il Brier score (pagina seguente).

<!-- page:brier -->
## Pagina 06 — Brier score e log-loss

**Obiettivo:** leggere le due metriche principali.

Il **Brier score** è l’errore quadratico medio tra probabilità prevista e risultato (1 se hai vinto, 0 altrimenti):

```text
Brier = media di (p − risultato)²
```

| Previsione | Risultato | Contributo |
|---|---:|---:|
| 0,60 | vittoria (1) | (0,60 − 1)² = 0,16 |
| 0,60 | sconfitta (0) | (0,60 − 0)² = 0,36 |
| 0,50 | qualsiasi | 0,25 |

Dire sempre 50% dà esattamente **0,25**: è il riferimento del «tirare a indovinare». Più basso è meglio. Nelle tue partite i modelli stanno tra 0,247 e 0,251: differenze nella terza o quarta cifra decimale, ma su 11.594 partite di test sono differenze reali.

La **log-loss** misura la stessa cosa in un altro modo, `−log(p)` se vinci e `−log(1 − p)` se perdi, e punisce molto di più le previsioni sicure e sbagliate. Il riferimento del 50% vale ln 2 ≈ 0,693.

**Da ricordare:** Brier e log-loss premiano le probabilità **oneste**. Un modello che esagera la propria sicurezza viene punito anche quando «indovina» il vincitore.

<!-- page:formula-elo -->
## Pagina 07 — La formula Elo, il modello da battere

**Obiettivo:** capire perché il primo candidato non viene addestrato.

Il sistema Elo contiene già una previsione:

```text
p = 1 / (1 + 10^(diff_elo / 400))
```

Con avversario alla pari p = 50%; con avversario più forte di 100 punti p ≈ 36%. La formula non impara nulla dai tuoi dati: è il **modello di base**. Se un modello addestrato non la batte sulla validazione, tutta la sua complessità non serve, e l’app lo dice (nel caso, la formula stessa può risultare vincitrice).

Nei tuoi dati la formula è **troppo sicura di sé**. Stimando la pendenza dai dati, ogni punto di differenza pesa circa il **24% in meno** di quanto assume la formula: quando prevede il 35% vinci circa il 40%, quando prevede il 60% circa il 57%. Nel bullet il caso (il tempo, gli errori di mouse) conta più che a cadenze lente, e il divario di Elo si traduce meno in risultati.

C’è anche una ragione tecnica: l’Elo pre-partita dell’avversario è una stima rumorosa (pagina 4), e il rumore su una variabile tende ad appiattirne l’effetto osservato.

**Da ricordare:** parte del vantaggio dei modelli addestrati viene semplicemente dal **ricalibrare** l’effetto dell’Elo sui tuoi dati.

<!-- page:split-temporale -->
## Pagina 08 — Uno split che segue il tempo

**Obiettivo:** capire perché qui non si mescolano le partite.

In melbourne-next le case venivano mescolate a caso e poi divise 60/20/20. Qui le partite si ordinano per **data**:

| Insieme | Quota | Nell’esperimento di riferimento |
|---|---:|---|
| Training | 60% più vecchio | 09/01/2016 → 02/03/2022 · 34.779 partite |
| Validazione | 20% intermedio | 02/03/2022 → 20/03/2024 · 11.593 partite |
| Test | 20% più recente | 20/03/2024 → 27/09/2026 · 11.594 partite |

I motivi sono due.

1. **È la domanda vera.** Vogliamo sapere se ciò che il passato insegna vale anche per le partite future, non per partite estratte a caso dallo stesso periodo.
2. **Le partite non sono indipendenti.** Quelle della stessa sessione condividono stanchezza, umore, avversari simili. Con uno split casuale partite «gemelle» finirebbero in training e in test, e il modello sembrerebbe migliore di quanto è.

Il prezzo da pagare: nel tempo cambiano repertorio, livello e abitudini. Un effetto che valeva nel 2018 può essersi attenuato nel 2025, e il test lo mette in evidenza.

**Da ricordare:** con dati che hanno un ordine nel tempo, lo split per data è il modo onesto di simulare «uso il modello domani».

<!-- page:candidati -->
## Pagina 09 — I quattro candidati e la regressione logistica

**Obiettivo:** sapere che cosa fa ciascun modello.

| Candidato | Che cosa impara | Punto di forza | Limite |
|---|---|---|---|
| Formula Elo | nulla | riferimento semplice e onesto | usa solo la differenza di Elo |
| Regressione logistica | un peso per ogni colonna | pesi leggibili, poco overfitting | effetti solo additivi |
| Albero decisionale | una sequenza di domande | coglie soglie e interazioni | instabile, va in overfitting |
| Random Forest | la media di molti alberi diversi | più stabile dell’albero | meno leggibile, più lenta |

La **regressione logistica** somma i contributi di ogni colonna e trasforma la somma in probabilità con la funzione logistica:

```text
z = w0 + w1·diff_elo + w2·[bianco] + w3·[pausa > 120] + … + w_k·[apertura = …]
p = 1 / (1 + e^(−z))
```

Le colonne numeriche vengono standardizzate (media 0, deviazione 1) usando **solo il training**; le categorie diventano colonne 0/1 (*one-hot*). Una penalità L2 tiene piccoli i pesi delle categorie rare, così un’apertura giocata poche volte non riceve un peso esagerato.

Un limite importante: nella logistica l’effetto dell’ora è lo stesso qualunque sia la pausa, il colore o l’apertura. Alberi e foresta possono invece scoprire **interazioni** («questa apertura rende di più la sera»).

**Da ricordare:** la logistica è spesso il candidato più difficile da battere con dati rumorosi, e il più facile da spiegare.

<!-- page:alberi -->
## Pagina 10 — Alberi, profondità e overfitting

**Obiettivo:** capire l’albero e perché va limitato.

Un albero pone domande in sequenza: «la differenza di Elo è ≤ 12?», «la pausa supera i 30 minuti?», «l’apertura è in questo gruppo?». Ogni foglia contiene la **frequenza di vittorie** delle partite di training che vi arrivano: è la probabilità prevista.

La **profondità massima** limita il numero di domande. Più è alta, più l’albero si adatta al training, fino a ricordarne i dettagli casuali. Nell’esperimento di riferimento, con profondità 6:

| | Brier training | Brier validazione |
|---|---:|---:|
| Albero | 0,2401 | 0,2509 |
| Formula Elo | 0,2441 | 0,2493 |

L’albero è il migliore sul training e il peggiore sulla validazione: è **overfitting**. Con profondità 12 il divario cresce ancora. Ogni foglia deve contenere almeno 100 partite, un’altra protezione contro le foglie costruite su pochi casi fortunati.

Per le colonne categoriche (ora, giorno, apertura) l’albero non usa l’ordine numerico: ordina le categorie per frequenza di vittoria nel nodo e cerca il miglior taglio in quell’ordine. Con un target 0/1 questo trova la divisione ottima tra tutte quelle possibili.

**Da ricordare:** un albero singolo è ottimo per capire l’idea, raramente per prevedere.

<!-- page:foresta -->
## Pagina 11 — La foresta: molti alberi diversi

**Obiettivo:** capire perché la media di alberi imperfetti funziona meglio.

La Random Forest costruisce molti alberi e fa la **media** delle loro probabilità. Perché la media aiuti, gli alberi devono sbagliare in modo diverso. Due fonti di varietà:

1. **Bootstrap:** ogni albero vede un campione di partite estratto con ripetizione dal training.
2. **Colonne casuali:** a ogni nodo l’albero sceglie la domanda migliore tra **3 colonne** estratte a caso tra le 9.

La seconda è la differenza rispetto a melbourne-next, dove ogni nodo guardava tutte le colonne. Qui è la Random Forest «classica».

Ogni foglia della foresta deve contenere almeno 30 partite: i singoli alberi possono essere più dettagliati perché la media ne attenua gli eccessi. Più alberi rendono il risultato più stabile, ma oltre un certo numero il guadagno è minimo e il tempo cresce. Nell’esperimento di riferimento la foresta ha vinto la validazione per un soffio sulla logistica (0,24789 contro 0,24797).

**Da ricordare:** 100 alberi sono un buon compromesso; 300 servono soprattutto a verificare che il risultato non cambi.

<!-- page:scelta-riaddestramento -->
## Pagina 12 — Scegliere, riaddestrare, verificare

**Obiettivo:** seguire le tre fasi dell’esperimento.

1. **Addestramento:** i quattro candidati imparano sul solo training (la formula Elo non impara nulla).
2. **Scelta:** vince il Brier più basso sulla **validazione**. Il test non viene guardato.
3. **Riaddestramento:** il vincitore impara di nuovo su training + validazione, cioè su dati più recenti e più numerosi. Anche la codifica (medie, quantili, elenco aperture) viene ricostruita su questi dati.
4. **Verifica:** il modello finale viene misurato **una volta** sul test, insieme alla formula Elo sulle stesse partite.

L’interfaccia offre anche la tabella «test di tutti i candidati». È lì per curiosità didattica: se la usassi per cambiare scelta, il test diventerebbe una seconda validazione e perderebbe il suo ruolo di giudice indipendente.

**Da ricordare:** la validazione sceglie, il test certifica. Invertire i ruoli rende il test ottimista.

<!-- page:importanza -->
## Pagina 13 — Importanza per permutazione

**Obiettivo:** capire come l’app decide quali fattori contano.

Per ogni colonna l’app:

1. prende le partite di test;
2. **mescola a caso** i valori di quella sola colonna tra le partite, rompendo il legame con il risultato;
3. ricalcola il Brier e misura di quanto è peggiorato;
4. ripete 5 volte e riporta media e deviazione standard.

Se il Brier non peggiora, il modello non stava usando quella colonna in modo utile. Un effetto entro due deviazioni standard da zero viene mostrato in grigio come «nessun effetto».

Due accorgimenti:

- l’**apertura** si mescola solo tra partite dello stesso colore, altrimenti comparirebbero combinazioni impossibili;
- il **colore** si mescola insieme alla sua apertura, per lo stesso motivo.

Un limite importante: se due colonne portano la stessa informazione, mescolarne una fa perdere poco, perché l’altra la sostituisce. È il caso di **pausa** e **posizione nella sessione**: la prima partita della sessione è, per definizione, quella dopo una pausa lunga. Entrambe possono risultare poco importanti pur contando insieme.

**Da ricordare:** «importanza» significa «il modello peggiora senza questa colonna», non «questa colonna causa il risultato».

<!-- page:calibrazione -->
## Pagina 14 — Calibrazione

**Obiettivo:** verificare che le probabilità significhino quello che dicono.

Un modello è **calibrato** se, tra tutte le partite in cui dice circa 45%, vinci davvero circa il 45%. La tabella raggruppa le partite di test per probabilità prevista e confronta la media prevista con le vittorie reali.

Nell’esperimento di riferimento (foresta, test 2024–2026):

| Prevista | Partite | Media prevista | Vittorie reali |
|---|---:|---:|---:|
| 0–40% | 562 | 38,3% | 42,2% |
| 40–45% | 2.424 | 43,0% | 44,6% |
| 45–50% | 4.818 | 47,5% | 48,7% |
| 50–55% | 3.306 | 52,1% | 52,3% |
| 55–60% | 455 | 56,4% | 55,6% |

Al centro il modello è ben calibrato; agli estremi è ancora un po’ troppo pessimista o ottimista. Una possibile ragione è il **cambiamento nel tempo**: le relazioni imparate fino al 2024 valgono un po’ meno nelle partite recenti. Le fasce con poche partite hanno comunque un margine d’incertezza di diversi punti.

**Da ricordare:** Brier basso e buona calibrazione vanno insieme; guardare la tabella aiuta a capire *dove* il modello sbaglia.

<!-- page:confondimento -->
## Pagina 15 — Ora o riscaldamento? Il confondimento

**Obiettivo:** capire perché un effetto grezzo può ingannare.

Guardando le partite senza correzioni, la mattina (9–12) sembra peggiore: circa −1,8 punti percentuali rispetto a quanto previsto dall’Elo. Ma la mattina ha un’altra caratteristica: molte partite sono le **prime di una sessione**, dopo una pausa lunga. E la prima partita dopo più di 30 minuti di stop si vince il 44–45% delle volte invece del 50%.

Quale delle due cose conta? Un modello che vede **entrambe** le colonne può separarle: se, a parità di pausa, l’ora aggiunge poco, l’effetto «mattina» era in buona parte un effetto «riscaldamento». Nell’analisi con la regressione logistica l’importanza della pausa è risultata molto più alta di quella dell’ora.

Questo fenomeno si chiama **confondimento**: una terza variabile (la pausa) è legata sia alla causa apparente (l’ora) sia al risultato.

Anche un modello non risolve tutto: vede solo le colonne che gli dai. Se la mattina fossi anche più stanco o distratto, e quella stanchezza non è in nessuna colonna, l’effetto finirebbe attribuito all’ora.

**Da ricordare:** «alle 10 gioco peggio» e «le prime partite le gioco peggio» possono sembrare la stessa osservazione, ma suggeriscono rimedi diversi.

<!-- page:confronti-multipli -->
## Pagina 16 — Attenzione ai confronti multipli

**Obiettivo:** non farsi ingannare dalla migliore tra tante aperture.

Con 24 ore, 7 giorni e una trentina di aperture, l’app confronta decine di gruppi. Anche se nessuno contasse davvero, qualcuno risulterebbe «migliore» per puro caso: con un margine di confidenza al 95%, circa **uno su venti** esce dal margine senza una ragione reale.

Per le aperture, l’analisi preliminare sull’intero storico (effetto a parità di Elo, rispetto alla media del proprio colore) ha dato:

| Col Bianco | Partite | Effetto |
|---|---:|---:|
| Queen’s Gambit | 6.774 | **+2,3%** ±1,2 |
| Réti | 2.650 | +1,7% ±1,9 |
| contro la Est-Indiana | 1.108 | −3,8% ±2,9 |

| Col Nero | Partite | Effetto |
|---|---:|---:|
| Siciliana | 8.013 | **+1,9%** ±1,1 |
| Old Benoni | 2.174 | **+2,8%** ±2,1 |
| Francese | 1.307 | +2,8% ±2,7 |
| Scandinava | 1.231 | −2,8% ±2,8 |
| contro 1.e3 (Van ’t Kruijs) | 917 | **−4,6%** ±3,2 |
| contro l’Inglese | 778 | −3,2% ±3,5 |

Gli effetti più credibili sono quelli **grandi rispetto al margine e basati su molte partite**, meglio se confermati anche nel periodo di test. Un effetto isolato su 700 partite, appena fuori dal margine, va trattato come un’ipotesi da ricontrollare fra un anno.

**Da ricordare:** tra molte aperture, la migliore sembra sempre migliore di quanto sia.

<!-- capitolo: Usare l’app | Guida all’app -->

<!-- page:primo-avvio -->
## Pagina 17 — Primo avvio

**Obiettivo:** far partire l’app sul tuo computer.

```powershell
cd C:\Users\torre\Desktop\Kaggle\scacchi-next
npm ci
npm run dev
```

Apri **http://127.0.0.1:3000**: gli script ascoltano solo su `127.0.0.1`, e su alcune configurazioni Windows `localhost` viene risolto prima verso IPv6. Serve Node.js 22 o successivo.

Il CSV di riferimento è già in `data/partite.csv`. Per aggiornarlo con le partite nuove premi **↻ Aggiorna dati** nella striscia sotto l’intestazione (serve Python 3.9 o successivo). Dal terminale si ottiene lo stesso risultato con:

```powershell
npm run dati
```

Poiché il CSV esiste già, l’aggiornamento è **incrementale**: scarica solo gli ultimi mesi e richiede pochi secondi. Solo senza CSV scarica tutto lo storico (circa 240 MB, alcuni minuti), mostrando l’avanzamento mese per mese. La striscia sotto l’intestazione mostra quante partite valide sono state lette e il periodo coperto.

**Da ricordare:** i modelli già salvati non si aggiornano da soli: dopo nuovi dati conviene addestrarne uno nuovo.

**Versione pubblicata.** Su Vercel l’app gira in **sola lettura**: mostra i modelli dimostrativi della cartella `vetrina/` (il più recente è già attivo) e nasconde «Addestra» e «Aggiorna dati», perché lì il disco non è scrivibile e le funzioni hanno una durata massima. Per rinnovarla, in locale: `npm run dati`, poi `npm run vetrina`, poi commit e push. Per provarla sul tuo computer avvia l’app con la variabile `SCACCHI_SOLA_LETTURA=1`.

<!-- page:impostazioni -->
## Pagina 18 — Le impostazioni dell’esperimento

**Obiettivo:** scegliere periodo, alberi e profondità con cognizione.

| Controllo | Valori | Effetto |
|---|---|---|
| Partite da utilizzare | tutto (dal 2016), dal 2020, dal 2023 | quanti dati e quanto recenti |
| Alberi nella foresta | 50, 100, 300 | stabilità e tempo della foresta |
| Profondità massima | 4, 6, 8, 12 | complessità di albero e foresta |

**Periodo.** Più partite rendono gli effetti piccoli più misurabili, ma il 2017 può somigliare poco a oggi. Con «dal 2023» il test copre gli ultimi mesi e il training è più omogeneo, ma i margini d’incertezza crescono. Confrontare i due periodi è un buon esercizio (pagina 30).

**Alberi e profondità** riguardano solo albero e foresta; logistica e formula Elo non cambiano. Tempi indicativi: 10–30 secondi per le impostazioni predefinite sull’intero storico, meno di un minuto per 300 alberi a profondità 12. L’addestramento gira sul server in background: il riquadro di stato ne mostra le fasi (candidati, riaddestramento, importanza) e la pagina si può ricaricare senza interromperlo. A fine lavoro il modello salvato diventa quello attivo.

**Da ricordare:** cambiare impostazioni guardando il test lo trasforma in validazione; decidi guardando la tabella dei candidati.

<!-- page:leggere-risultati -->
## Pagina 19 — Leggere i risultati

**Obiettivo:** orientarsi nel pannello dei risultati.

Dall’alto in basso:

1. **Modello scelto** e le quattro cifre chiave: Brier sul test, Brier della formula Elo **sulle stesse partite**, accuratezza sul test, tempo.
2. **Periodi**: date e numero di partite di training, validazione e test, con la percentuale di vittorie di ciascuno.
3. **Confronto dei candidati** sulla validazione. Un Brier di training molto più basso di quello di validazione indica overfitting.
4. **Test di tutti i candidati**, nascosto: solo per curiosità.
5. **Che cosa conta davvero**: l’importanza per permutazione (pagina 13).
6. **Calibrazione** (pagina 14).

Nell’esperimento di riferimento la foresta ha vinto la validazione (0,2479) davanti alla logistica (0,2480), alla formula Elo (0,2493) e all’albero (0,2509). Sul test ha ottenuto 0,2487 contro 0,2497 della formula Elo, e un’accuratezza del 52,9% contro il 52,2%.

L’importanza, nello stesso esperimento: colore 10,6; differenza Elo 7,1; apertura 3,0; pausa 2,6; ora 2,6; posizione nella sessione 1,0; andamento 0,8. Giorno della settimana e partite già giocate: nessun effetto.

**Da ricordare:** «batte la formula Elo dello 0,4%» sembra poco, ma è misurato su 11.594 partite mai viste ed è coerente con quanto trovato con scikit-learn.

<!-- page:archivio -->
## Pagina 20 — L’archivio dei modelli

**Obiettivo:** salvare, ritrovare e riusare gli esperimenti.

Ogni esperimento crea due file in `models/`:

```text
models/
├─ <uuid>.json        ← modello completo, regole di codifica, metriche
└─ <uuid>.meta.json   ← solo metriche e impostazioni: usato per l’elenco
```

Le **regole di codifica** (medie, quantili, elenco delle aperture riconosciute) sono salvate con il modello: la previsione le usa identiche, anche se nel frattempo il CSV è cambiato. Le scritture passano da un file temporaneo e un cambio di nome, così un’interruzione non lascia versioni a metà.

Un file illeggibile non blocca l’elenco: viene ignorato e segnalato. Un solo lavoro pesante alla volta (addestramento o aggiornamento dei dati) è ammesso, tramite `models/.training.lock`. Il lock registra quale processo lo possiede: se il server si arresta durante un lavoro, al riavvio l’app se ne accorge, termina l’eventuale processo rimasto orfano, rimuove il lock e avvisa che il lavoro è stato interrotto. Non serve cancellarlo a mano.

**Da ricordare:** «Carica dal disco» mostra di nuovo risultati, importanza e calibrazione di quella versione e la rende disponibile per le previsioni.

<!-- page:previsione -->
## Pagina 21 — Descrivere una partita

**Obiettivo:** compilare correttamente il modulo della previsione.

| Campo | Come compilarlo |
|---|---|
| Colore, Elo tuo e dell’avversario | come compaiono **prima** della partita |
| Apertura | la famiglia della partita, tra quelle riconosciute dal modello per quel colore; «Altra / rara» per le altre |
| Ora di inizio, giorno | nel fuso usato per l’estrazione |
| Pausa prima (minuti) | dalla fine della partita precedente, di qualsiasi tipo; 0,5 = partite consecutive |
| Posizione nella sessione | 1 se è la prima dopo più di 30 minuti di stop |
| Partite già giocate oggi | qualsiasi cadenza |
| Andamento Elo | il tuo Elo attuale meno quello di 20 partite fa |

Il modello riconosce le aperture con almeno 300 partite nel training (fino a 14 per colore); le altre confluiscono in «Altra / rara».

I valori fuori dall’intervallo visto nei dati vengono limitati: una differenza di Elo di 800 punti è trattata come 400, perché il modello non ha mai visto casi così estremi.

**Da ricordare:** la probabilità si confronta sempre con quella della sola formula Elo, mostrata accanto.

<!-- page:cosa-se -->
## Pagina 22 — I grafici «cosa succederebbe se»

**Obiettivo:** usare il modello per rispondere alle domande di partenza.

Dopo il calcolo l’app ripete la previsione cambiando **una sola cosa alla volta**:

- **l’ora** (24 colonne): l’ora scelta è evidenziata in ocra, la migliore in blu;
- **la pausa** (6 colonne): dalle partite consecutive alle pause oltre due ore;
- **l’apertura**: tutte quelle riconosciute per il colore scelto, ordinate.

Le colonne usano una **scala ingrandita** attorno ai valori, con una linea tratteggiata al 50%, perché le differenze sono di pochi punti. Non leggere l’altezza come proporzionale alla probabilità.

Per la partita di esempio (Bianco, Elo alla pari, pausa di 30 secondi, terza della sessione, ore 20, Queen’s Gambit) la foresta di riferimento dà il 54,9%, contro il 50% della formula Elo. Tra le ore il massimo è attorno alle 20–21 e alle 3, il minimo verso mezzogiorno; tra le aperture del Bianco il Queen’s Gambit e la Réti sono in cima.

Con la **logistica** le curve si spostano tutte in parallelo al cambiare degli altri campi; con **albero e foresta** la forma può cambiare, perché colgono interazioni.

**Da ricordare:** è un esperimento «a parità di tutto il resto», che nelle partite reali non accade mai del tutto: la sera, per esempio, giochi anche contro avversari diversi.

<!-- page:errori -->
## Pagina 23 — Problemi frequenti

**Obiettivo:** risolvere i messaggi più comuni.

| Messaggio o sintomo | Che cosa fare |
|---|---|
| File data/partite.csv non trovato | Esegui `npm run dati` oppure copia il CSV in `data/` |
| Colonna mancante nel CSV | Il CSV viene da una versione diversa dello script: rigeneralo |
| Servono almeno 500 partite valide | Il periodo scelto contiene troppe poche partite |
| Aggiornamento dei dati interrotto (il server… non è più attivo) | Il server è stato chiuso durante il lavoro. L’app ha già rimosso il lock: premi di nuovo il pulsante, i mesi già scaricati restano in cache |
| Formato del modello non compatibile | Il file viene da un’altra versione dell’app o è stato modificato |
| Apertura non disponibile per questo colore | Scegli un’apertura dall’elenco del modello caricato |
| Un campo della previsione fuori intervallo | Il messaggio indica campo e intervallo ammesso |
| Python non trovato | Installa Python 3.9+; su Windows l’app prova `py`, poi `python`. Dal terminale: `py scripts/estrai_partite.py --out data/partite.csv --cache data/archivi` |
| Aggiornamento non riuscito | Il messaggio riporta l’ultima riga d’errore dello script; il CSV precedente resta intatto. Per errori di rete riprova: i mesi già in cache non vengono riscaricati |
| «… è già in corso dalle HH:MM» | Aggiornamento e addestramento condividono lo stesso lock: attendi che l’altra operazione finisca. L’avanzamento è visibile nel riquadro di stato, anche dopo aver ricaricato la pagina |

**Da ricordare:** se la richiesta si interrompe, il server potrebbe aver finito comunque il salvataggio: aggiorna l’elenco prima di rilanciare.

<!-- capitolo: Che cosa dicono i dati | Risultati -->

<!-- page:risultati -->
## Pagina 24 — Che cosa dicono le tue partite

**Obiettivo:** raccogliere le risposte alle tre domande.

**Aperture, a parità di Elo.** Contano, ma poco: pochi punti percentuali. Le indicazioni più solide (pagina 16) sono il Queen’s Gambit col Bianco e la Siciliana e l’Old Benoni col Nero. Col Nero vai peggio contro le prime mosse insolite dell’avversario (1.e3, 1.c4): sono le partite in cui l’apertura la sceglie lui.

**Orario.** L’effetto grezzo esiste (la mattina un po’ peggio, la sera un po’ meglio) ma è piccolo, e in buona parte si spiega con il **riscaldamento**: la prima partita dopo una pausa lunga si vince il 44–45% delle volte contro il 50% delle partite consecutive.

**Altri fattori.**

| Fattore | Conta? |
|---|---|
| Colore | Sì: 51,6% col Bianco, 46,6% col Nero |
| Differenza Elo | Sì, ma meno di quanto prevede la formula |
| Pausa / prima partita della sessione | Sì, è l’effetto più chiaro dopo colore ed Elo |
| Ora | Poco, una volta considerata la pausa |
| Andamento dell’Elo nelle ultime 20 partite | Quasi nulla |
| Giorno della settimana | No |
| Partite già giocate nella giornata | No |
| Risultato della partita precedente (tilt) | No: dopo una sconfitta vinci il 50,7%, dopo una vittoria il 49,2%. La piccola differenza va nel verso opposto al tilt e si spiega con l’abbinamento: dopo una sconfitta il tuo Elo scende e incontri avversari un po’ più deboli |

**Da ricordare:** il consiglio pratico più robusto che emerge dai dati è semplice: **una partita di riscaldamento** (magari non rated) prima di iniziare.

<!-- page:limiti -->
## Pagina 25 — Che cosa il modello non sa

**Obiettivo:** conoscere i limiti prima di trarre conclusioni.

- **Correlazione, non causa.** L’app misura associazioni. Che le prime partite vadano peggio è compatibile col riscaldamento, ma anche con il fatto che dopo una pausa lunga ti colleghi in momenti diversi o con avversari diversi.
- **Colonne mancanti.** Stanchezza, dispositivo (mouse o telefono), connessione, umore: non ci sono. Il loro effetto finisce attribuito ad altre colonne o resta rumore.
- **Elo dell’avversario stimato.** La ricostruzione è buona in media, non per ogni singola partita.
- **Aperture decise anche dall’avversario.** Col Nero l’effetto di un’apertura mescola la tua scelta e la sua.
- **Cambiamenti nel tempo.** Repertorio e livello cambiano: il test recente mostra quanto gli effetti passati reggono.
- **Fuso orario unico.** Le partite giocate da un altro fuso hanno l’ora sbagliata.
- **Solo 1+0.** Nulla garantisce che gli stessi effetti valgano in blitz o rapid.

**Da ricordare:** i risultati descrivono le partite di Scaccomatto999 in questo periodo, non «gli scacchi bullet» in generale.

<!-- capitolo: Codice e dati | Codice -->

<!-- page:mappa-codice -->
## Pagina 26 — La mappa del codice

**Obiettivo:** sapere dove si trova ogni parte.

| File | Responsabilità |
|---|---|
| `scripts/estrai_partite.py` | Scarica da chess.com, ricostruisce l’Elo pre-partita, scrive il CSV |
| `data/partite.csv` e `.colonne.md` | Dati e dizionario delle colonne |
| `lib/modelli.cjs` | Albero a istogrammi, foresta, regressione logistica, metriche, calibrazione |
| `lib/core.cjs` | Colonne, codifica, split temporale, pipeline, importanza, previsione, archivio |
| `lib/train-worker.cjs` | Processo figlio che esegue l’addestramento senza bloccare il server |
| `lib/aggiorna.cjs` | Avvia lo script Python per «Aggiorna dati» e sostituisce il CSV solo se il download riesce |
| `lib/lavori.cjs` | Lock condiviso tra addestramento e aggiornamento: chi lo possiede, avanzamento, lock abbandonati, esito dell’ultimo lavoro |
| `scripts/prepara-vetrina.cjs` | `npm run vetrina`: addestra i modelli dimostrativi e li copia in `vetrina/` per la versione pubblicata |
| `lib/guide.cjs` | Divide questa guida in pagine e capitoli |
| `app/actions.js` | Server Action chiamate dal browser |
| `app/page.js` | Interfaccia: esperimento, archivio, risultati, previsione |
| `app/GuideModal.js` | Modale della guida |
| `tests/core.test.cjs` | Test automatici (`npm test`) |

Il browser non esegue modelli né legge file: chiama le Server Action, che girano in Node.js sul tuo computer. L’addestramento avviene in un processo separato, così il server resta reattivo.

**Da ricordare:** i modelli sono scritti in circa 200 righe di JavaScript senza librerie di machine learning; la pagina seguente spiega perché.

<!-- page:istogrammi -->
## Pagina 27 — Perché alberi «fatti in casa»

**Obiettivo:** capire la scelta tecnica rispetto a melbourne-next.

melbourne-next usa `ml-cart` e `ml-random-forest`. Per trovare la domanda migliore in un nodo, `ml-cart` prova **ogni valore distinto** di ogni colonna e per ciascuno scorre tutte le righe. Con 13.580 case e 10 alberi servivano 143 secondi; con 35.000 partite **un solo albero** non terminava in dieci minuti.

`lib/modelli.cjs` usa la tecnica degli **istogrammi**, la stessa di LightGBM e di `HistGradientBoosting` di scikit-learn:

1. prima dell’addestramento ogni colonna numerica viene divisa in al massimo 32 intervalli, con confini sui quantili del training;
2. in ogni nodo si conta, per ciascun intervallo, quante partite ci sono e quante sono vittorie;
3. il taglio migliore si trova scorrendo questi pochi conteggi, non le righe.

Risultato: l’esperimento completo (quattro candidati, riaddestramento, importanza) richiede circa 30 secondi con le impostazioni predefinite.

La regressione logistica è stimata con il **metodo di Newton**: a ogni passo risolve un sistema lineare con la fattorizzazione di Cholesky, e converge in poche iterazioni. I test verificano che ritrovi coefficienti noti su dati sintetici.

**Da ricordare:** i risultati coincidono, entro le piccole differenze di implementazione, con quelli ottenuti in Python con scikit-learn sugli stessi dati.

<!-- page:aggiornare-dati -->
## Pagina 28 — Aggiornare o cambiare i dati

**Obiettivo:** usare lo script per altri periodi, cadenze o giocatori.

Il modo più semplice è il pulsante **↻ Aggiorna dati**. L’app:

1. avvia `scripts/estrai_partite.py` con Python (su Windows prova `py`, poi `python`) **in background**: la pagina mostra l’avanzamento e può essere ricaricata senza interrompere il lavoro;
2. se `data/partite.csv` esiste, lo passa come base (`--base`): lo script tiene le righe fino al mese dell’ultima partita, riscarica solo quel mese, il precedente (per ricostruire Elo, pause e sessioni al confine) e i successivi. Il risultato coincide riga per riga con un’estrazione completa, in pochi secondi;
3. fa scrivere il risultato in `data/partite.nuovo.csv` e, solo se lo script termina senza errori, lo sostituisce a `data/partite.csv` e riporta quante partite nuove sono state aggiunte.

Un’interruzione o un errore di rete lasciano quindi intatto il CSV precedente. Senza CSV lo script scarica tutto lo storico in `data/archivi/` (circa 240 MB, alcuni minuti); ogni mese viene salvato in cache con una scrittura atomica, quindi un download interrotto riparte dai mesi già scaricati. Non serve riavviare il server: l’app rilegge il CSV a ogni operazione.

Per altri periodi, cadenze o giocatori si usa lo script dal terminale:

```powershell
npm run dati                                              # come il pulsante (incrementale)
python scripts/estrai_partite.py --dal 2023-01 --out data/partite.csv
python scripts/estrai_partite.py --cadenza 180 --out data/partite.csv   # blitz 3+0
python scripts/estrai_partite.py --utente AltroGiocatore --out data/partite.csv
```

Le opzioni principali: `--utente`, `--cadenza` (il `time_control` di chess.com: `60`, `180`, `120+1`…), `--dal` e `--al` (mesi AAAA-MM), `--fuso`, `--cache`. Lo script usa solo la libreria standard di Python e attende brevemente tra una richiesta e l’altra, per cortesia verso l’API pubblica.

Cambiando cadenza, l’elenco delle aperture e i confini degli intervalli vengono ricalcolati al prossimo addestramento. Un modello salvato resta legato ai dati con cui è stato creato.

**Da ricordare:** la cartella della cache (`data/archivi/`) può essere cancellata in qualsiasi momento; verrà ricreata.

<!-- capitolo: Ripasso | Ripasso -->

<!-- page:glossario -->
## Pagina 29 — Glossario essenziale

**Obiettivo:** avere le definizioni a portata di mano.

| Termine | Significato in questo laboratorio |
|---|---|
| Target | Ciò che si prevede: vittoria sì / no |
| Colonna (feature) | Un’informazione nota prima della partita, usata come input |
| Data leakage | Usare un’informazione che contiene il risultato, come l’Elo dopo la partita |
| Split temporale | Divisione per data: passato, periodo intermedio, recente |
| Brier score | Media di (probabilità − risultato)²; 0,25 = tirare a indovinare |
| Log-loss | Come il Brier, ma punisce di più gli errori molto sicuri |
| Accuratezza | Quota di partite in cui «p > 50%» coincide con la vittoria |
| Modello di base | La formula Elo: ciò che un modello deve battere |
| Overfitting | Ottimo sul training, peggiore sui dati nuovi |
| One-hot | Una colonna 0/1 per ogni categoria |
| Bootstrap | Campione estratto con ripetizione, diverso per ogni albero |
| Importanza per permutazione | Peggioramento quando una colonna viene mescolata |
| Calibrazione | Accordo tra probabilità previste e frequenze reali |
| Confondimento | Un effetto attribuito a una colonna ma dovuto a un’altra collegata |
| Confronti multipli | Tra molti gruppi, qualcuno spicca per caso |

**Da ricordare:** «importante» non vuol dire «causa», e «significativo» non vuol dire «grande».

<!-- page:esercizi -->
## Pagina 30 — Esercizi e domande

**Obiettivo:** mettere alla prova la comprensione con l’app.

**1. Perché un modello che usa l’Elo dopo la partita otterrebbe un Brier bassissimo, e perché non servirebbe a niente?**

Perché l’Elo finale incorpora il risultato: chi ha vinto è salito. Prima della partita quell’informazione non esiste, quindi il modello non potrebbe essere usato per prevedere.

**2. Addestra con «tutto lo storico» e con «dal 2023». Quale colonna cambia di più nella classifica dell’importanza?**

Guarda soprattutto apertura e differenza di Elo. Con meno partite i margini crescono: un cambiamento entro le barre d’errore non è un cambiamento reale.

**3. Porta la profondità da 6 a 12. Che cosa succede al Brier di training e di validazione dell’albero?**

Il training migliora, la validazione peggiora: è l’overfitting in azione. La foresta ne soffre molto meno.

**4. Il modello dice 54%. Su 100 partite così, quante ne vinci in media? E la prossima?**

Circa 54 su 100. Per la prossima si può dire solo che è un po’ più probabile vincerla che perderla.

**5. Nella previsione, porta la pausa da 0,5 a 200 minuti lasciando tutto il resto uguale. Che cosa suggerisce il risultato?**

Che la prima partita dopo una lunga pausa è sfavorevole: il consiglio pratico è una partita di riscaldamento.

**6. Nella tabella nascosta, un candidato che ha perso la validazione fa meglio sul test del vincitore. Devi cambiare scelta?**

No. Scegliere guardando il test lo trasformerebbe in validazione. Se la differenza è piccola, è normale oscillazione; se si ripete con dati nuovi, è un’informazione per il prossimo esperimento.
