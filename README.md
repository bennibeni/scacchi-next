# Scacchi bullet · Next.js

Laboratorio didattico di machine learning sulle partite 1+0 di
**Scaccomatto999** su chess.com. Stessa architettura di melbourne-next (Server
Action, addestramento in un processo Node separato, modelli JSON su disco, guida
in una modale), con dati reali e tre domande:

1. A parità di Elo dell’avversario, quanto conta l’apertura?
2. In quale momento della giornata gioco meglio?
3. Quali altri fattori influiscono sui risultati, e quali no?

## Avvio in VS Code / PowerShell

```powershell
cd C:\Users\torre\Desktop\Kaggle\scacchi-next
npm ci
npm run dev
```

Aprire http://127.0.0.1:3000 (gli script ascoltano solo su `127.0.0.1`; su
Windows `localhost` può essere risolto prima verso IPv6). Node.js 22 o
successivo. Produzione locale: `npm run build`, poi `npm start`. Test:
`npm test`.

Il CSV di riferimento (57.968 partite, estrazione del 27/9/2026) è già in
`data/partite.csv`. Per aggiornarlo premi **↻ Aggiorna dati** nell'app, oppure
dal terminale:

```powershell
npm run dati
```

Serve Python 3.9+ (solo libreria standard; su Windows l'app prova `py`, poi
`python`). Con il CSV presente l'aggiornamento è incrementale (solo gli ultimi
mesi, pochi secondi); senza CSV scarica tutto lo storico in `data/archivi/`
(circa 240 MB, alcuni minuti, con avanzamento visibile e ripresa dai mesi già in
cache). Il lavoro gira in background: la pagina si può ricaricare. Il CSV viene
sostituito solo se lo script termina senza errori.

## Utilizzo

1. Scegli periodo (tutto dal 2016, dal 2020, dal 2023), numero di alberi e
   profondità. Premi **Addestra e salva su disco**: con le impostazioni
   predefinite servono circa 30 secondi.
2. L'addestramento gira in background: la pagina ne mostra le fasi e può essere
   ricaricata. Le partite sono divise **per data**: 60% più vecchio (training),
   20% intermedio (validazione), 20% più recente (test).
3. Quattro candidati: formula Elo (modello di base, non addestrato), regressione
   logistica, albero, Random Forest. Vince il Brier più basso sulla validazione;
   il vincitore viene riaddestrato su training + validazione e valutato una
   volta sul test, accanto alla formula Elo.
4. Il pannello dei risultati mostra l’importanza per permutazione di ogni
   colonna (che cosa conta davvero) e la calibrazione.
5. **Previsione**: descrivi una partita (colore, Elo, apertura, ora, pausa…) e
   ottieni la probabilità di vittoria, con i grafici «cosa succederebbe se» per
   ora, pausa e apertura.
6. Il pulsante **Guida** e i pulsanti **?** aprono `docs/guida-completa.md` (30
   pagine) alla pagina pertinente.

Solo colonne note **prima** della partita entrano nei modelli. L’API di
chess.com riporta l’Elo _dopo_ la partita: lo script ricostruisce quello
precedente (vedi la pagina 4 della guida).

## Struttura

- `scripts/estrai_partite.py`: scarica da chess.com (con cache), ricostruisce
  l’Elo pre-partita, scrive `data/partite.csv` e `data/partite.colonne.md`.
- `lib/modelli.cjs`: albero a istogrammi (colonne categoriche con divisione
  ottima), Random Forest (bootstrap + 3 colonne casuali per nodo), regressione
  logistica L2 con metodo di Newton, Brier/log-loss/accuratezza, calibrazione.
  Nessuna libreria ML: `ml-cart` non terminava un solo albero su 35.000 righe in
  10 minuti.
- `lib/core.cjs`: colonne, codifica (costruita solo sul training e salvata col
  modello), split temporale, pipeline, importanza per permutazione, previsione,
  archivio con `.meta.json`.
- `lib/train-worker.cjs`: processo figlio per l’addestramento.
- `lib/aggiorna.cjs`: esegue lo script Python per «Aggiorna dati» (incrementale
  se il CSV esiste) su un file temporaneo, ne legge l'avanzamento e lo
  sostituisce al CSV solo se riesce.
- `lib/lavori.cjs`: lock condiviso tra addestramento e aggiornamento, con
  riconoscimento dei lock abbandonati, avanzamento ed esito dell'ultimo lavoro.
- `lib/guide.cjs`: divide la guida in pagine (`<!-- page:id -->`) e capitoli
  (`<!-- capitolo: Titolo | Etichetta -->`).
- `app/actions.js`: `avviaAddestramento`, `avviaAggiornamento`, `statoLavori`,
  `riepilogoDati`, `elencaModelli`, `caricaModello`, `prevedi`, `leggiGuida`.
- `app/page.js`, `app/GuideModal.js`, `app/style.css`: interfaccia.
- `scripts/prepara-vetrina.cjs`: `npm run vetrina`, addestra i modelli
  dimostrativi e li copia in `vetrina/`.
- `tests/core.test.cjs`: albero, foresta, logistica, metriche, split temporale,
  codifica, pipeline su disco, guida, aggiornamento dati, lock, sola lettura.

## Pubblicare su Vercel (vetrina in sola lettura)

Su Vercel il filesystem del deploy non è scrivibile, le funzioni hanno una
durata massima (Hobby: 300 s) e non c'è Python. L'app lo riconosce da sola
(variabile `VERCEL=1`) e passa in **sola lettura**:

- i modelli si leggono da `vetrina/`, una cartella versionata (diversamente da
  `models/`, esclusa da git); il più recente è subito attivo;
- «Addestra» e «Aggiorna dati» non compaiono, e le Server Action corrispondenti
  rifiutano la richiesta;
- risultati, importanza, calibrazione, previsioni e guida funzionano come in
  locale.

Per preparare o rinnovare la vetrina, in locale:

```powershell
npm run dati       # partite aggiornate
npm run vetrina    # addestra i modelli dimostrativi (tutto lo storico e dal 2023) e li copia in vetrina/
git add data vetrina && git commit -m "Aggiorna la vetrina" && git push
```

Con il progetto Vercel collegato al repository GitHub, il push pubblica la nuova
versione. `next.config.js` dichiara in `outputFileTracingIncludes` i file letti
a runtime (`data/partite.csv`, `docs/guida-completa.md`, `vetrina/*.json`),
altrimenti non verrebbero inclusi nel deploy. `SCACCHI_SOLA_LETTURA=1` attiva la
vetrina anche in locale (per provarla); `SCACCHI_SOLA_LETTURA=0` la disattiva
anche su Vercel.

## Ambiente previsto

Progetto locale su `127.0.0.1`. Richiede Node.js, processi figli e disco
scrivibile: non è adatto a Vercel senza un’architettura con coda di job e
storage esterno. Un solo lavoro pesante alla volta (`models/.training.lock`, con
PID del server e del processo figlio). Se il server si arresta durante un
lavoro, al riavvio il lock viene riconosciuto come abbandonato e rimosso
automaticamente; l'eventuale processo figlio orfano viene terminato.

## Riferimenti

- https://www.chess.com/news/view/published-data-api
- https://nextjs.org/docs/app/api-reference/directives/use-server
- https://scikit-learn.org/stable/modules/permutation_importance.html
