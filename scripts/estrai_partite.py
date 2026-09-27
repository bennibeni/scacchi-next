#!/usr/bin/env python3
"""
Estrae le partite di un giocatore chess.com in un CSV pronto per l'addestramento.

Uso:
    python estrai_partite.py                      # Scaccomatto999, 1+0, tutto lo storico
    python estrai_partite.py --base partite.csv --out nuovo.csv   # aggiornamento incrementale
    python estrai_partite.py --dal 2020-01 --al 2026-09 --cadenza 60 --out partite_1min.csv

Solo libreria standard (Python 3.9+). Gli archivi mensili vengono salvati in --cache:
una seconda esecuzione scarica solo i mesi mancanti e il mese corrente.

Con --base (un CSV prodotto da questo script) l'aggiornamento è INCREMENTALE: si tengono le
righe del CSV fino al mese dell'ultima partita esclusa, si scaricano solo quel mese, il precedente
(per ricostruire Elo, pause e sessioni al confine) e i mesi successivi. Bastano pochi secondi.

Durante il download stampa su stderr righe «PROGRESSO i/n AAAA-MM» (lette dall'app).

Colonne: vedi DIZIONARIO in fondo al file (scritto anche in <out>.colonne.md).
Le colonne marcate [POST] si conoscono solo a partita finita: NON usarle come input di un modello.
"""
import argparse, csv, json, os, re, sys, time, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

API = 'https://api.chess.com/pub/player/{u}/games/archives'
DRAW = {'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'}
SESSION_GAP_MIN = 30          # pausa oltre la quale inizia una nuova sessione
ANOMALY_DELTA = 40            # variazione Elo oltre la quale la ricostruzione è sospetta
FAMILY_END = re.compile(r'^(.*?(?:Defense|Opening|Gambit|Game|Attack|System|Countergambit))(?:-|$)')


def fetch(url, ua, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # rete, 429, 5xx: breve attesa e nuovo tentativo
            err = e
            time.sleep(2 + 3 * i)
    raise RuntimeError(f'Download fallito: {url} ({err})')


def cached(path):
    """Legge un mese dalla cache; None se manca o è rovinato (es. scrittura interrotta)."""
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)['games']
    except (OSError, ValueError, KeyError):
        return None


def load_archives(user, cache, ua, since, until, refresh_from='9999-99'):
    """Scarica (o legge dalla cache) i mesi tra since e until. I mesi >= refresh_from e il mese
    in corso vengono sempre riscaricati, perché possono essere cambiati."""
    os.makedirs(cache, exist_ok=True)
    months = [u for u in fetch(API.format(u=user.lower()), ua)['archives'] if since <= u[-7:].replace('/', '-') <= until]
    now = datetime.now(timezone.utc).strftime('%Y-%m')
    games = []
    for i, url in enumerate(months, 1):
        ym = url[-7:].replace('/', '-')
        path = os.path.join(cache, f'{ym}.json')
        data = None if ym == now or ym >= refresh_from else cached(path)
        if data is None:
            raw = fetch(url, ua)
            # Scrittura atomica: un'interruzione non lascia in cache un file a metà.
            with open(path + '.tmp', 'w', encoding='utf-8') as f:
                json.dump(raw, f)
            os.replace(path + '.tmp', path)
            data = raw['games']
            time.sleep(0.3)                              # cortesia verso l'API pubblica
        games += data
        print(f'PROGRESSO {i}/{len(months)} {ym}', file=sys.stderr, flush=True)
    return games


def month_before(ym):
    y, m = map(int, ym.split('-'))
    return f'{y - 1}-12' if m == 1 else f'{y}-{m - 1:02d}'


def read_base(path, cadenza_ok=True):
    """Righe di un CSV precedente, oppure None se assente o non compatibile."""
    try:
        with open(path, newline='', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))
    except OSError:
        return None
    need = {'inizio_utc', 'elo_mio_pre', 'elo_mio_post', 'trend_elo_20', 'url'}
    if not rows or not need <= set(rows[0]):
        return None
    return rows


def pgn_tag(pgn, tag):
    m = re.search(rf'\[{tag} "([^"]*)"\]', pgn or '')
    return m.group(1) if m else ''


def first_moves(pgn, plies=4):
    body = (pgn or '').split('\n\n', 1)[-1]
    body = re.sub(r'\{[^}]*\}', ' ', body)               # commenti con l'orologio
    body = re.sub(r'\d+\.(\.\.)?', ' ', body)            # numeri di mossa
    toks = [t for t in body.split() if t not in ('1-0', '0-1', '1/2-1/2', '*')]
    return ' '.join(toks[:plies]), len(toks)


def opening(pgn):
    slug = pgn_tag(pgn, 'ECOUrl').rsplit('/', 1)[-1]
    name = re.sub(r'-\d.*$', '', slug) or 'Undefined'    # toglie le mosse in coda allo slug
    m = FAMILY_END.match(name)
    return pgn_tag(pgn, 'ECO') or '?', name.replace('-', ' '), (m.group(1) if m else name).replace('-', ' ')


def start_ts(g):
    d, t = pgn_tag(g.get('pgn'), 'UTCDate'), pgn_tag(g.get('pgn'), 'StartTime') or pgn_tag(g.get('pgn'), 'UTCTime')
    try:
        return datetime.strptime(f'{d} {t}', '%Y.%m.%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return g['end_time']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--utente', default='Scaccomatto999')
    ap.add_argument('--cadenza', default='60', help='time_control chess.com: 60 = 1+0, 180 = 3+0, 120+1 ...')
    ap.add_argument('--dal', default='2000-01', help='mese iniziale AAAA-MM')
    ap.add_argument('--al', default='2999-12', help='mese finale AAAA-MM')
    ap.add_argument('--fuso', default='Europe/Rome', help='fuso orario per ora e giorno')
    ap.add_argument('--cache', default='archivi_chesscom')
    ap.add_argument('--out', default='partite.csv')
    ap.add_argument('--base', default=None, help='CSV precedente: aggiornamento incrementale (solo mesi recenti)')
    ap.add_argument('--ua', default='chess-lab (script didattico)', help='User-Agent: chess.com chiede un contatto')
    a = ap.parse_args()
    tz, me = ZoneInfo(a.fuso), a.utente.lower()

    base = read_base(a.base) if a.base else None
    kept, cutoff, seed_history, seed_rating = [], None, [], None
    if base:
        # Mese M dell'ultima partita nota: si ricalcola da M in poi, partendo dal mese precedente.
        last_month = max(r['inizio_utc'][:7] for r in base)
        since = max(month_before(last_month), a.dal)
        cutoff = last_month + '-01 00:00:00'
        kept = [r for r in base if r['inizio_utc'] < cutoff]
        before_since = [r for r in kept if r['inizio_utc'] < since + '-01 00:00:00']
        seed_history = [int(float(r['elo_mio_pre'])) for r in before_since]
        seed_rating = int(float(before_since[-1]['elo_mio_post'])) if before_since else None
        print(f'Aggiornamento incrementale dal {since}: {len(kept)} partite già note.', file=sys.stderr, flush=True)
        allg = load_archives(a.utente, a.cache, a.ua, since, a.al, refresh_from=last_month)
    else:
        print('Scarico / leggo tutti gli archivi…', file=sys.stderr, flush=True)
        allg = load_archives(a.utente, a.cache, a.ua, a.dal, a.al)
    for g in allg:
        g['_side'] = 'white' if g['white']['username'].lower() == me else 'black'
        g['_start'] = start_ts(g)
    allg.sort(key=lambda g: g['end_time'])

    rows, last_rating, last_end, sess_n, day_count = [], {}, None, 0, {}
    history = seed_history                                # Elo pre-partita della cadenza scelta, per il trend
    if seed_rating is not None and a.cadenza == '60':
        last_rating[('chess', 'bullet')] = seed_rating
    for g in allg:
        side, opp = g['_side'], 'black' if g['_side'] == 'white' else 'white'
        # Sessione e pausa: contano TUTTE le partite giocate, di qualsiasi cadenza o variante.
        pause = None if last_end is None else (g['_start'] - last_end) / 60
        sess_n = 1 if pause is None or pause > SESSION_GAP_MIN else sess_n + 1
        last_end = g['end_time']
        local = datetime.fromtimestamp(g['_start'], tz)
        day = local.date().isoformat()
        played_today = day_count.get(day, 0)
        day_count[day] = played_today + 1

        # Il punteggio chess.com è per "pool": bullet/blitz/rapid × regole. 1+0 e 2+1 condividono il bullet.
        pool = (g.get('rules'), g.get('time_class'))
        rated = g.get('rated', False)
        pre = last_rating.get(pool)
        post = g[side]['rating']
        if rated:
            last_rating[pool] = post
        if g.get('time_control') != a.cadenza or g.get('rules') != 'chess' or not rated or pre is None:
            continue

        res = g[side]['result']
        score = 1.0 if res == 'win' else 0.5 if res in DRAW else 0.0
        delta = post - pre
        opp_post = g[opp]['rating']
        opp_pre = opp_post + delta                        # stima: variazioni quasi simmetriche
        diff = opp_pre - pre
        expected = 1 / (1 + 10 ** (diff / 400))
        eco, name, family = opening(g.get('pgn'))
        moves4, nplies = first_moves(g.get('pgn'))
        trend = pre - history[-20] if len(history) >= 20 else ''
        history.append(pre)
        start_utc = datetime.fromtimestamp(g['_start'], timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        if cutoff and start_utc < cutoff:
            continue                                      # già presente nel CSV di base
        rows.append({
            'id': g.get('uuid', ''),
            'inizio_utc': start_utc,
            'inizio_locale': local.strftime('%Y-%m-%d %H:%M:%S'),
            'anno': local.year, 'mese': local.month, 'ora': local.hour,
            'giorno_settimana': local.isoweekday(),
            'colore': 'bianco' if side == 'white' else 'nero',
            'elo_mio_pre': pre, 'elo_avv_pre': opp_pre, 'diff_elo': diff,
            'punteggio_atteso': round(expected, 4),
            'posizione_sessione': sess_n,
            'pausa_min': '' if pause is None else round(min(max(pause, 0), 10080), 1),
            'partite_prima_oggi': played_today,
            'trend_elo_20': trend,
            'eco': eco, 'apertura': name, 'famiglia_apertura': family, 'prime_mosse': moves4,
            'risultato': 'V' if score == 1 else 'P' if score == .5 else 'S',
            'punteggio': score,
            'elo_mio_post': post, 'elo_avv_post': opp_post, 'delta_elo': delta,
            'esito': res if score < 1 else g[opp]['result'],
            'semimosse': nplies,
            'elo_sospetto': int(abs(delta) > ANOMALY_DELTA),
            'url': g.get('url', ''),
        })

    fields = list(rows[0]) if rows else list(kept[0])
    rows = kept + rows
    if not rows:
        sys.exit('Nessuna partita trovata con questi criteri.')
    with open(a.out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)
    with open(os.path.splitext(a.out)[0] + '.colonne.md', 'w', encoding='utf-8') as f:
        f.write(DIZIONARIO.format(utente=a.utente, cadenza=a.cadenza, fuso=a.fuso, gap=SESSION_GAP_MIN, soglia=ANOMALY_DELTA))
    print(f'\n{len(rows)} partite → {a.out}', file=sys.stderr)


DIZIONARIO = """# Colonne del CSV — {utente}, cadenza {cadenza}, fuso {fuso}

**[PRE]** noto prima della partita, utilizzabile come input. **[POST]** noto solo a partita finita: usarlo come input è data leakage.
**[ID]** identificativi e controlli, non input.

| Colonna | Tipo | Significato |
|---|---|---|
| id, url | [ID] | UUID e link della partita |
| inizio_utc, inizio_locale | [PRE] | Ora d'inizio (dal PGN), in UTC e nel fuso scelto |
| anno, mese, ora, giorno_settimana | [PRE] | Derivati dall'ora locale (1 = lunedì) |
| colore | [PRE] | bianco / nero |
| elo_mio_pre | [PRE] | Il mio punteggio prima della partita = punteggio dopo la partita precedente dello stesso pool (per il bullet: 1+0 e 2+1 insieme) |
| elo_avv_pre | [PRE] | STIMA: Elo finale dell'avversario + la mia variazione (le variazioni Glicko sono quasi simmetriche, non identiche) |
| diff_elo | [PRE] | elo_avv_pre − elo_mio_pre (positivo = avversario più forte) |
| punteggio_atteso | [PRE] | 1 / (1 + 10^(diff_elo/400)): la previsione della sola formula Elo, modello di base |
| posizione_sessione | [PRE] | 1 = prima partita dopo una pausa > {gap} minuti (contano partite di ogni cadenza e variante) |
| pausa_min | [PRE] | Minuti dalla fine della partita precedente (qualsiasi tipo), limitati a 7 giorni |
| partite_prima_oggi | [PRE] | Partite (qualsiasi tipo) già iniziate nello stesso giorno locale |
| trend_elo_20 | [PRE] | elo_mio_pre − elo_mio_pre di 20 partite prima (vuoto per le prime 20) |
| eco, apertura, famiglia_apertura | [PRE]* | Classificazione chess.com. *Nota solo dopo le prime mosse, e col Nero dipende anche dall'avversario |
| prime_mosse | [PRE]* | Prime 4 semimosse in notazione SAN |
| risultato, punteggio | [TARGET] | V/P/S e 1 / 0,5 / 0 |
| elo_mio_post, elo_avv_post, delta_elo | [POST] | Punteggi dopo la partita e variazione: rivelano il risultato |
| esito | [POST] | Modo in cui è finita la partita (win, timeout, checkmated, resigned, …) |
| semimosse | [POST] | Lunghezza della partita |
| elo_sospetto | [ID] | 1 se abs(delta_elo) > {soglia}: ricostruzione dell'Elo pre-partita poco affidabile |
"""

if __name__ == '__main__':
    main()
