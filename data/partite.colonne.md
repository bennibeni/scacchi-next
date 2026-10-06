# Colonne del CSV — Scaccomatto999, cadenza 60, fuso Europe/Rome

**[PRE]** noto prima della partita, utilizzabile come input. **[POST]** noto
solo a partita finita: usarlo come input è data leakage. **[ID]** identificativi
e controlli, non input.

| Colonna                               | Tipo     | Significato                                                                                                                      |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| id, url                               | [ID]     | UUID e link della partita                                                                                                        |
| inizio_utc, inizio_locale             | [PRE]    | Ora d'inizio (dal PGN), in UTC e nel fuso scelto                                                                                 |
| anno, mese, ora, giorno_settimana     | [PRE]    | Derivati dall'ora locale (1 = lunedì)                                                                                            |
| colore                                | [PRE]    | bianco / nero                                                                                                                    |
| elo_mio_pre                           | [PRE]    | Il mio punteggio prima della partita = punteggio dopo la partita precedente dello stesso pool (per il bullet: 1+0 e 2+1 insieme) |
| elo_avv_pre                           | [PRE]    | STIMA: Elo finale dell'avversario + la mia variazione (le variazioni Glicko sono quasi simmetriche, non identiche)               |
| diff_elo                              | [PRE]    | elo_avv_pre − elo_mio_pre (positivo = avversario più forte)                                                                      |
| punteggio_atteso                      | [PRE]    | 1 / (1 + 10^(diff_elo/400)): la previsione della sola formula Elo, modello di base                                               |
| posizione_sessione                    | [PRE]    | 1 = prima partita dopo una pausa > 30 minuti (contano partite di ogni cadenza e variante)                                        |
| pausa_min                             | [PRE]    | Minuti dalla fine della partita precedente (qualsiasi tipo), limitati a 7 giorni                                                 |
| partite_prima_oggi                    | [PRE]    | Partite (qualsiasi tipo) già iniziate nello stesso giorno locale                                                                 |
| trend_elo_20                          | [PRE]    | elo_mio_pre − elo_mio_pre di 20 partite prima (vuoto per le prime 20)                                                            |
| eco, apertura, famiglia_apertura      | [PRE]*   | Classificazione chess.com. *Nota solo dopo le prime mosse, e col Nero dipende anche dall'avversario                              |
| prime_mosse                           | [PRE]*   | Prime 4 semimosse in notazione SAN                                                                                               |
| risultato, punteggio                  | [TARGET] | V/P/S e 1 / 0,5 / 0                                                                                                              |
| elo_mio_post, elo_avv_post, delta_elo | [POST]   | Punteggi dopo la partita e variazione: rivelano il risultato                                                                     |
| esito                                 | [POST]   | Modo in cui è finita la partita (win, timeout, checkmated, resigned, …)                                                          |
| semimosse                             | [POST]   | Lunghezza della partita                                                                                                          |
| elo_sospetto                          | [ID]     | 1 se abs(delta_elo) > 40: ricostruzione dell'Elo pre-partita poco affidabile                                                     |
