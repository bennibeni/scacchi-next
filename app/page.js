'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  avviaAddestramento,
  avviaAggiornamento,
  caricaModello,
  elencaModelli,
  modalita,
  prevedi,
  riepilogoDati,
  statoLavori,
} from './actions';
import GuideModal, { Help, lastGuidePage } from './GuideModal';

const NAMES = {
  elo: 'Formula Elo',
  logistic: 'Regressione logistica',
  tree: 'Albero decisionale',
  forest: 'Random Forest',
};
const PERIODS = {
  tutto: 'Tutto lo storico (dal 2016)',
  dal2020: 'Dal 2020',
  dal2023: 'Dal 2023',
};
const DAYS = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const pct = (v, d = 1) =>
  `${(v * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const num = (v, d = 4) =>
  v.toLocaleString('it-IT', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const int = (v) => v.toLocaleString('it-IT');
const date = (s) => (s ? new Date(s).toLocaleDateString('it-IT') : '–');

function duration({ period, trees, depth }) {
  const heavy =
    Number(trees) *
    (Number(depth) >= 8 ? 2 : 1) *
    (period === 'tutto' ? 1 : period === 'dal2020' ? 0.6 : 0.25);
  return heavy > 300
    ? 'Durata indicativa: meno di un minuto.'
    : heavy > 100
      ? 'Durata indicativa: 20–40 secondi.'
      : 'Durata indicativa: 5–30 secondi.';
}

/** Barre orizzontali per l'importanza: un effetto entro 2 deviazioni standard da zero non è distinguibile dal caso. */
function Importance({ items }) {
  const max = Math.max(...items.map((i) => i.delta), 1e-6);
  return (
    <div className="bars" role="list">
      {items.map((i) => {
        const real = i.delta > 0 && i.delta > 2 * i.sd;
        return (
          <div className="barRow" role="listitem" key={i.key}>
            <span className="barLabel">{i.label}</span>
            <span className="barTrack">
              <span
                className={real ? 'bar' : 'bar weak'}
                style={{ width: `${(Math.max(0, i.delta) / max) * 100}%` }}
              />
            </span>
            <span className="barValue">
              {real ? `+${num(i.delta * 1e4, 1)}` : 'nessun effetto'}
              <small>{real ? ` ±${num(i.sd * 1e4, 1)}` : ''}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Colonne verticali "cosa succederebbe se": scala ingrandita attorno ai valori, linea al 50%. */
function WhatIf({ items, labelOf, selected, title, caption }) {
  const ps = items.map((i) => i.p),
    lo = Math.min(...ps, 0.5) - 0.01,
    hi = Math.max(...ps, 0.5) + 0.01,
    best = Math.max(...ps);
  const h = (p) => `${((p - lo) / (hi - lo)) * 100}%`;
  return (
    <figure className="whatIf">
      <figcaption>
        {title}
        <small>{caption}</small>
      </figcaption>
      <div className="cols" style={{ '--half': h(0.5) }}>
        {items.map((it, k) => (
          <div
            key={k}
            className={`col${selected === k ? ' sel' : ''}${it.p === best ? ' best' : ''}`}
            title={`${labelOf(it, k)}: ${pct(it.p)}`}
          >
            <span className="colBar" style={{ height: h(it.p) }}>
              <span className="colTip">{pct(it.p, 0)}</span>
            </span>
            <span className="colLabel">{labelOf(it, k)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function Home() {
  const [config, setConfig] = useState({
    period: 'tutto',
    trees: '100',
    depth: '6',
  });
  const [data, setData] = useState(undefined); // undefined = in lettura, null = CSV assente;
  const [models, setModels] = useState([]),
    [skipped, setSkipped] = useState([]),
    [selected, setSelected] = useState('');
  const [active, setActive] = useState(null),
    [result, setResult] = useState(null),
    [showAllTest, setShowAllTest] = useState(false);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [noticeWarn, setNoticeWarn] = useState(false),
    [prediction, setPrediction] = useState(null);
  // Lavoro sul server (aggiornamento dati o addestramento), letto dal lock: sopravvive al ricaricamento della pagina.
  const [job, setJob] = useState(null);
  const wasRunning = useRef(false);
  const locked = !!busy || !!job;
  // Vetrina (Vercel): sola lettura, modelli dimostrativi già addestrati. null = modalità non ancora nota.
  const [readOnly, setReadOnly] = useState(null);
  const [values, setValues] = useState({
    colore: 'bianco',
    elo_mio: '1000',
    elo_avv: '1000',
    pausa: '0.5',
    posizione: '3',
    ora: '20',
    giorno: String(((new Date().getDay() + 6) % 7) + 1),
    partite_oggi: '5',
    trend: '0',
    apertura: '',
  });
  const [guidePage, setGuidePage] = useState(null),
    [guideOpener, setGuideOpener] = useState(null);
  const openGuide = useCallback((page, opener) => {
    setGuideOpener(opener ?? null);
    setGuidePage(page ?? lastGuidePage() ?? 'benvenuto');
  }, []);
  const closeGuide = useCallback(() => setGuidePage(null), []);
  const openings = active?.openings?.[values.colore] ?? [];

  async function refresh() {
    const res = await elencaModelli();
    if (!res.success) throw new Error(res.error);
    setModels(res.models);
    setSkipped(res.skipped ?? []);
    return res.models;
  }
  useEffect(() => {
    Promise.all([modalita(), refresh()])
      .then(([m, ms]) => {
        setReadOnly(m.readOnly);
        // In vetrina il modello più recente è subito attivo: risultati e previsione senza un clic.
        if (m.readOnly && ms.length) activate(ms[0]);
      })
      .catch((e) => setError(e.message));
    riepilogoDati()
      .then((res) => (res.success ? setData(res.data) : setError(res.error)))
      .catch(() => setError('Impossibile leggere il riepilogo dei dati.'));
  }, []);
  // Quando cambia il modello o il colore, l'apertura deve appartenere all'elenco del modello.
  useEffect(() => {
    if (openings.length && !openings.includes(values.apertura))
      setValues((v) => ({ ...v, apertura: openings[0] }));
  }, [openings, values.apertura]);

  async function perform(label, task) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(e.message || 'Richiesta interrotta. Riprova.');
    } finally {
      setBusy('');
    }
  }
  function activate(meta) {
    setActive(meta);
    setResult(meta);
    setSelected(meta.id);
    setPrediction(null);
    setShowAllTest(false);
  }
  async function train(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const res = await avviaAddestramento(config);
    if (!res.success) {
      setError(res.error);
      return;
    }
    wasRunning.current = true;
    setJob({
      kind: 'addestramento',
      label: 'Addestramento',
      startedAt: res.startedAt,
      progress: null,
    });
  }
  async function refreshData() {
    setError('');
    setNotice('');
    const res = await avviaAggiornamento();
    if (!res.success) {
      setError(res.error);
      return;
    }
    wasRunning.current = true;
    setJob({
      kind: 'dati',
      label: 'Aggiornamento dei dati',
      startedAt: res.startedAt,
      progress: null,
    });
  }
  // Interroga il server: ogni 1,5 s mentre un lavoro è in corso, ogni 15 s altrimenti.
  const poll = useCallback(async () => {
    const res = await statoLavori().catch(() => null);
    if (!res?.success) return;
    setJob(res.running);
    const last = res.last,
      recent = last && Date.now() - Date.parse(last.finishedAt) < 120000;
    if (wasRunning.current && !res.running && last) {
      if (last.kind === 'dati') {
        if (last.ok) {
          setNoticeWarn(false);
          setNotice(last.message);
          riepilogoDati().then((r) => r.success && setData(r.data));
        } else setError(last.message);
      } else if (last.kind === 'addestramento') {
        // Il modello appena salvato diventa quello attivo, come se fosse stato caricato dall'archivio.
        if (last.ok && last.detail?.id)
          caricaModello(last.detail.id).then((r) =>
            r.success ? activate(r.result) : setError(r.error),
          );
        else if (!last.ok) setError(last.message);
      }
      refresh().catch(() => {});
    } else if (
      !wasRunning.current &&
      !res.running &&
      recent &&
      !last.ok &&
      /interrott/.test(last.message)
    ) {
      setNoticeWarn(true);
      setNotice(last.message);
    }
    wasRunning.current = !!res.running;
  }, []);
  useEffect(() => {
    if (readOnly !== false) return;
    poll();
    const t = setInterval(poll, job ? 1500 : 15000);
    return () => clearInterval(t);
  }, [poll, !!job, readOnly]);
  function jobText(j) {
    const p = j.progress,
      since = j.startedAt
        ? ` · iniziato alle ${new Date(j.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
        : '';
    if (j.kind === 'dati')
      return p
        ? `${p.incremental ? 'Aggiornamento incrementale' : 'Download completo dello storico'}: mese ${p.done} di ${p.total} (${p.month})${since}`
        : `Avvio dell’aggiornamento dei dati…${since}`;
    return `${p?.label ?? `${j.label} in corso…`}${since}`;
  }

  async function load() {
    await perform('Caricamento dal disco…', async () => {
      const res = await caricaModello(selected);
      if (!res.success) throw new Error(res.error);
      activate(res.result);
    });
  }
  async function predict(event) {
    event.preventDefault();
    setPrediction(null);
    await perform('Calcolo della probabilità…', async () => {
      const res = await prevedi(active.id, values);
      if (!res.success) throw new Error(res.error);
      setPrediction(res);
    });
  }
  const set = (key) => (e) => {
    setValues({ ...values, [key]: e.target.value });
    setPrediction(null);
  };
  const winnerScore = result?.scores.find((s) => s.kind === result.kind);

  return (
    <main>
      <header>
        <div className="eyebrow">SCACCOMATTO999 / BULLET 1+0 / MACHINE LEARNING LAB</div>
        <h1>
          Che cosa decide <em>le mie partite?</em>
        </h1>
        <p>
          Elo, colore, apertura, orario, pause: quattro modelli imparano dalle partite passate e
          vengono giudicati su quelle più recenti. Poi puoi chiedere a quello scelto quanto vale una
          partita.
        </p>
        <div className="headRow">
          <span className="badge">Dati reali chess.com · calcolo sul server</span>
          <button
            type="button"
            className="guideButton"
            onClick={(e) => openGuide(null, e.currentTarget)}
          >
            📖 Guida
          </button>
        </div>
      </header>

      <div className="stepsWrap">
        <div className="steps">
          <span>
            <b>60%</b> Partite più vecchie · impara
          </span>
          <span>
            <b>20%</b> Periodo intermedio · sceglie
          </span>
          <span>
            <b>20%</b> Partite più recenti · verifica
          </span>
        </div>
        <Help page="split-temporale" label="perché lo split segue il tempo" onOpen={openGuide} />
      </div>

      <div className="dataStrip">
        {data ? (
          <>
            <span>
              <b>{int(data.n)}</b> partite 1+0 valide
            </span>
            <span>
              <b>
                {date(data.from)} → {date(data.to)}
              </b>{' '}
              periodo
            </span>
            <span>
              <b>{pct(data.winRate)}</b> vittorie
            </span>
          </>
        ) : data === undefined ? (
          <span>Lettura delle partite…</span>
        ) : readOnly ? (
          <span>Dati delle partite non disponibili in questa pubblicazione.</span>
        ) : (
          <span>
            Nessun dato letto da <code>data/partite.csv</code>: premi «Aggiorna dati» per scaricarlo
            da chess.com.
          </span>
        )}
        <span className="stripActions">
          {readOnly === false && (
            <button
              type="button"
              className="secondary small"
              disabled={locked}
              onClick={refreshData}
            >
              ↻ Aggiorna dati
            </button>
          )}
          {readOnly && data && <span className="badge">Dati aggiornati al {date(data.to)}</span>}
          <Help page="aggiornare-dati" label="aggiornare i dati" onOpen={openGuide} />
        </span>
      </div>
      {notice && (
        <div className={noticeWarn ? 'notice warn' : 'notice'} role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <div className="rowBetween">
            <span>{error}</span>
            <Help page="errori" label="problemi frequenti" onOpen={openGuide} />
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">
        {job ? (
          <div className="status">
            <span className="spinner" />
            {jobText(job)}
            {job.kind === 'dati' && job.progress && (
              <span className="progress">
                <span
                  style={{
                    width: `${(job.progress.done / job.progress.total) * 100}%`,
                  }}
                />
              </span>
            )}
            <small>Puoi ricaricare la pagina: il lavoro continua sul server.</small>
          </div>
        ) : (
          busy && (
            <div className="status">
              <span className="spinner" />
              {busy}
            </div>
          )
        )}
      </div>

      <div className="grid">
        {readOnly ? (
          <section className="card">
            <div className="eyebrow">01 / ESPERIMENTO</div>
            <h2>Versione dimostrativa</h2>
            <p>
              Questa pubblicazione è in <b>sola lettura</b>: mostra modelli già addestrati sulle
              partite fino al {data ? date(data.to) : '…'}. Puoi esplorarne i risultati,
              l’importanza delle colonne e la calibrazione, e chiedere previsioni.
            </p>
            <p>
              Addestrare nuovi modelli e aggiornare le partite da chess.com richiede un disco
              scrivibile e processi lunghi: si fa eseguendo l’app sul proprio computer (
              <code>npm run dev</code>).
            </p>
            <div className="demoList">
              {models.map((m) => (
                <div key={m.id}>
                  <b>{NAMES[m.kind]}</b> · {PERIODS[m.config.period]} · {m.config.trees} alberi,
                  profondità {m.config.depth}
                  <small>
                    Brier sul test {num(m.test.brier)} contro {num(m.eloTest.brier)} della formula
                    Elo
                  </small>
                </div>
              ))}
            </div>
            <div className="actionRow">
              <Help
                page="scelta-riaddestramento"
                label="come viene scelto il vincitore"
                onOpen={openGuide}
              />
              <small>Come vengono scelti e verificati i modelli</small>
            </div>
          </section>
        ) : readOnly === false ? (
          <section className="card">
            <div className="eyebrow">01 / ESPERIMENTO</div>
            <h2>Addestra e confronta</h2>
            <p>
              Formula Elo, regressione logistica, albero e foresta. Vince chi prevede meglio il
              periodo di validazione; il vincitore viene riaddestrato e giudicato sulle partite più
              recenti.
            </p>
            <form onSubmit={train}>
              <div className="field">
                <div className="fieldHead">
                  <label htmlFor="cfg-period">Partite da utilizzare</label>
                  <Help page="impostazioni" label="scegliere il periodo" onOpen={openGuide} />
                </div>
                <select
                  id="cfg-period"
                  disabled={locked}
                  value={config.period}
                  onChange={(e) => setConfig({ ...config, period: e.target.value })}
                >
                  {Object.entries(PERIODS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                      {data ? ` · ${int(data.byPeriod[k])} partite` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pair">
                <div className="field">
                  <div className="fieldHead">
                    <label htmlFor="cfg-trees">Alberi nella foresta</label>
                    <Help page="foresta" label="foresta di alberi" onOpen={openGuide} />
                  </div>
                  <select
                    id="cfg-trees"
                    disabled={locked}
                    value={config.trees}
                    onChange={(e) => setConfig({ ...config, trees: e.target.value })}
                  >
                    {[50, 100, 300].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <div className="fieldHead">
                    <label htmlFor="cfg-depth">Profondità massima</label>
                    <Help page="alberi" label="profondità e overfitting" onOpen={openGuide} />
                  </div>
                  <select
                    id="cfg-depth"
                    disabled={locked}
                    value={config.depth}
                    onChange={(e) => setConfig({ ...config, depth: e.target.value })}
                  >
                    {[4, 6, 8, 12].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
              <small className="hint">
                {duration(config)} La profondità vale per l’albero singolo e per ogni albero della
                foresta.
              </small>
              <div className="actionRow">
                <button type="submit" disabled={locked}>
                  Addestra e salva su disco <span>↗</span>
                </button>
                <Help
                  page="scelta-riaddestramento"
                  label="come viene scelto il vincitore"
                  onOpen={openGuide}
                />
              </div>
            </form>
          </section>
        ) : (
          <section className="card" aria-busy="true">
            <div className="eyebrow">01 / ESPERIMENTO</div>
            <h2>Caricamento…</h2>
          </section>
        )}
        <section className="card">
          <div className="eyebrow">02 / ARCHIVIO</div>
          <h2>{readOnly ? 'Modelli dimostrativi' : 'Riprendi un modello'}</h2>
          <p>
            {readOnly
              ? 'Scegli uno dei modelli pubblicati e caricalo per vederne i risultati e usarlo nelle previsioni.'
              : 'Ogni esperimento è salvato su disco con metriche, importanza delle colonne e regole di codifica.'}
          </p>
          <label>
            Versione salvata
            <select
              value={selected}
              disabled={locked}
              onChange={(e) => {
                setSelected(e.target.value);
                setActive(null);
                setPrediction(null);
              }}
            >
              <option value="">Seleziona un modello</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.createdAt).toLocaleString('it-IT')} · {NAMES[m.kind]} ·{' '}
                  {PERIODS[m.config.period].split(' (')[0]}
                </option>
              ))}
            </select>
          </label>
          {skipped.length > 0 && (
            <div className="warn" role="note">
              {skipped.length === 1
                ? 'Un file in models/ non è leggibile ed è stato ignorato'
                : `${skipped.length} file in models/ non sono leggibili e sono stati ignorati`}
              : {skipped.join(', ')}.
            </div>
          )}
          <div className="pair">
            <button className="secondary" disabled={!selected || locked} onClick={load}>
              {readOnly ? 'Carica il modello' : 'Carica dal disco'}
            </button>
            {!readOnly && (
              <button
                className="secondary"
                disabled={locked}
                onClick={() => perform('Aggiornamento archivio…', refresh)}
              >
                Aggiorna elenco
              </button>
            )}
          </div>
          <div className="modelState">
            <div className="rowBetween">
              <span>
                {active ? (
                  <>
                    <span className="dot" /> Pronto: {NAMES[active.kind]}
                  </>
                ) : (
                  <>
                    <span className="dot empty" /> Nessun modello caricato
                  </>
                )}
              </span>
              <Help page="archivio" label="archivio dei modelli" onOpen={openGuide} />
            </div>
            {active ? (
              <small>{active.id}</small>
            ) : (
              <small>Addestra un modello oppure selezionalo dall’archivio.</small>
            )}
          </div>
        </section>
      </div>

      {result && (
        <section className="card results">
          <div className="eyebrow">
            RISULTATI / {int(result.counts.used)} PARTITE /{' '}
            {PERIODS[result.config.period].toUpperCase()}
          </div>
          <h2>{NAMES[result.kind]} scelto</h2>
          <div className="metrics">
            <div>
              <small className="withHelp">
                Brier sul test{' '}
                <Help page="brier" label="che cos’è il Brier score" onOpen={openGuide} />
              </small>
              <strong>{num(result.test.brier)}</strong>
              <small>più basso è meglio · 0,25 = tirare a indovinare</small>
            </div>
            <div>
              <small className="withHelp">
                Formula Elo sullo stesso test{' '}
                <Help page="formula-elo" label="la formula Elo" onOpen={openGuide} />
              </small>
              <strong>{num(result.eloTest.brier)}</strong>
              <small>
                {result.test.brier < result.eloTest.brier
                  ? `il modello la batte dello ${num((1 - result.test.brier / result.eloTest.brier) * 100, 2)}%`
                  : 'il modello non la batte'}
              </small>
            </div>
            <div>
              <small>Accuratezza sul test</small>
              <strong>{pct(result.test.accuracy)}</strong>
              <small>vittoria prevista se p &gt; 50%</small>
            </div>
            <div>
              <small>Tempo di calcolo</small>
              <strong>{num(result.seconds, 1)} s</strong>
              <small>
                {int(result.counts.valid)} partite valide su {int(result.counts.read)}
              </small>
            </div>
          </div>
          <div className="periods">
            {[
              ['train', 'Training'],
              ['validation', 'Validazione'],
              ['test', 'Test'],
            ].map(([k, l]) => (
              <span key={k}>
                <b>{l}</b> {date(result.periods[k].from)} → {date(result.periods[k].to)} ·{' '}
                {int(result.periods[k].n)} partite · {pct(result.periods[k].winRate)} vittorie
              </span>
            ))}
          </div>

          <h3 className="withHelp">
            Confronto dei candidati sulla validazione{' '}
            <Help page="candidati" label="i quattro candidati" onOpen={openGuide} />
          </h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Modello</th>
                  <th>Brier training</th>
                  <th>Brier validazione</th>
                  <th>Log-loss validazione</th>
                  <th>Accuratezza validazione</th>
                  <th>Tempo</th>
                </tr>
              </thead>
              <tbody>
                {result.scores.map((s) => (
                  <tr key={s.kind}>
                    <td>
                      {NAMES[s.kind]}
                      {s.kind === result.kind && <span className="winner">Scelto</span>}
                    </td>
                    <td>{num(s.train.brier)}</td>
                    <td>
                      <b>{num(s.valid.brier)}</b>
                    </td>
                    <td>{num(s.valid.logloss)}</td>
                    <td>{pct(s.valid.accuracy)}</td>
                    <td>{num(s.seconds, 1)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            Un Brier di training molto più basso di quello di validazione indica overfitting: il
            modello ricorda le partite viste invece di generalizzare.
          </small>
          <button
            type="button"
            className="link toggle"
            aria-expanded={showAllTest}
            onClick={() => setShowAllTest((v) => !v)}
          >
            {showAllTest ? '▾' : '▸'} Mostra il test di tutti i candidati (solo a scopo didattico)
          </button>
          {showAllTest && (
            <div className="didactic">
              <p>
                Qui ogni candidato è addestrato sul solo training e misurato sul test.{' '}
                <b>Non si usa per scegliere</b>: se scegliessi guardando queste cifre, il test
                diventerebbe una seconda validazione e non misurerebbe più nulla di indipendente.
              </p>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Modello</th>
                      <th>Brier test</th>
                      <th>Log-loss test</th>
                      <th>Accuratezza test</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.allOnTest.map((s) => (
                      <tr key={s.kind}>
                        <td>{NAMES[s.kind]}</td>
                        <td>{num(s.test.brier)}</td>
                        <td>{num(s.test.logloss)}</td>
                        <td>{pct(s.test.accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="twoCols">
            <div>
              <h3 className="withHelp">
                Che cosa conta davvero{' '}
                <Help page="importanza" label="importanza per permutazione" onOpen={openGuide} />
              </h3>
              <p className="note">
                Peggioramento del Brier sul test (×10⁻⁴) quando una colonna viene mescolata a caso
                tra le partite. Grigio: effetto non distinguibile dal caso.
              </p>
              <Importance items={result.importance} />
            </div>
            <div>
              <h3 className="withHelp">
                Calibrazione sul test{' '}
                <Help page="calibrazione" label="calibrazione" onOpen={openGuide} />
              </h3>
              <p className="note">
                Quando il modello dice «45%», vinci davvero il 45% di quelle partite?
              </p>
              <div className="tableWrap">
                <table className="compact">
                  <thead>
                    <tr>
                      <th>Probabilità prevista</th>
                      <th>Partite</th>
                      <th>Media prevista</th>
                      <th>Vittorie reali</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.calibration
                      .filter((c) => c.n)
                      .map((c) => (
                        <tr key={c.from}>
                          <td>
                            {pct(c.from, 0)}–{pct(c.to, 0)}
                          </td>
                          <td>{int(c.n)}</td>
                          <td>{pct(c.predicted)}</td>
                          <td>{pct(c.observed)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="rowBetween">
          <div className="eyebrow">03 / PREVISIONE</div>
          <Help page="previsione" label="descrivere una partita" onOpen={openGuide} />
        </div>
        <h2>Quanto vale questa partita?</h2>
        <p>
          Descrivi una partita prima di giocarla. Il modello caricato stima la probabilità di
          vincerla e mostra come cambierebbe con un’altra ora, un’altra pausa o un’altra apertura.
        </p>
        <form onSubmit={predict}>
          <fieldset disabled={!active || locked}>
            <div className="gameFields">
              <label>
                Colore
                <select value={values.colore} onChange={set('colore')}>
                  <option value="bianco">Bianco</option>
                  <option value="nero">Nero</option>
                </select>
              </label>
              <label>
                Il tuo Elo
                <input
                  required
                  type="number"
                  min="100"
                  max="3500"
                  step="1"
                  value={values.elo_mio}
                  onChange={set('elo_mio')}
                />
              </label>
              <label>
                Elo avversario
                <input
                  required
                  type="number"
                  min="100"
                  max="3500"
                  step="1"
                  value={values.elo_avv}
                  onChange={set('elo_avv')}
                />
              </label>
              <label>
                Apertura
                <select value={values.apertura} onChange={set('apertura')}>
                  {openings.map((o) => (
                    <option key={o} value={o}>
                      {o === 'altra' ? 'Altra / rara' : o}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ora di inizio
                <select value={values.ora} onChange={set('ora')}>
                  {[...Array(24).keys()].map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Giorno
                <select value={values.giorno} onChange={set('giorno')}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pausa prima (minuti)
                <input
                  required
                  type="number"
                  min="0"
                  max="10080"
                  step="any"
                  value={values.pausa}
                  onChange={set('pausa')}
                />
              </label>
              <label>
                Posizione nella sessione
                <input
                  required
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  value={values.posizione}
                  onChange={set('posizione')}
                />
              </label>
              <label>
                Partite già giocate oggi
                <input
                  required
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  value={values.partite_oggi}
                  onChange={set('partite_oggi')}
                />
              </label>
              <label>
                Andamento Elo (ultime 20)
                <input
                  required
                  type="number"
                  min="-1000"
                  max="1000"
                  step="1"
                  value={values.trend}
                  onChange={set('trend')}
                />
              </label>
            </div>
            <button type="submit">
              Calcola la probabilità di vittoria <span>→</span>
            </button>
          </fieldset>
        </form>
        {prediction && (
          <div className="prediction" role="status">
            <div className="predHead">
              <div>
                <small>Probabilità di vittoria · {NAMES[active.kind]}</small>
                <strong>{pct(prediction.probability)}</strong>
              </div>
              <div>
                <small>La sola formula Elo direbbe</small>
                <strong className="muted">{pct(prediction.elo)}</strong>
              </div>
            </div>
            <p>
              È una frequenza attesa su molte partite simili, non una certezza sulla prossima: anche
              al 55% ne perdi quasi una su due.
            </p>
            <div className="whatIfs">
              <WhatIf
                title="Se giocassi a un’altra ora"
                caption="stessa partita, cambia solo l’ora · scala ingrandita, linea = 50%"
                items={prediction.byHour}
                selected={Number(values.ora)}
                labelOf={(it) => String(it.hour).padStart(2, '0')}
              />
              <WhatIf
                title="Se la pausa prima fosse…"
                caption="minuti dalla partita precedente"
                items={prediction.byPause}
                labelOf={(it) => it.pause}
              />
            </div>
            <h3 className="withHelp">
              Se scegliessi un’altra apertura ({values.colore}){' '}
              <Help
                page="confronti-multipli"
                label="attenzione ai confronti multipli"
                onOpen={openGuide}
              />
            </h3>
            <div className="bars">
              {prediction.byOpening.map((o) => (
                <div
                  className={`barRow${o.opening === values.apertura ? ' current' : ''}`}
                  key={o.opening}
                >
                  <span className="barLabel">
                    {o.opening === 'altra' ? 'Altra / rara' : o.opening}
                  </span>
                  <span className="barTrack">
                    <span
                      className="bar"
                      style={{
                        width: `${Math.max(0, (o.p - 0.3) / 0.4) * 100}%`,
                      }}
                    />
                    <span className="half" />
                  </span>
                  <span className="barValue">{pct(o.p)}</span>
                </div>
              ))}
            </div>
            <small>
              Barre da 30% a 70%, tacca al 50%. Un modello lineare come la logistica sposta tutte le
              curve in parallelo; alberi e foresta possono cogliere interazioni (un’apertura che
              rende di più la sera, per esempio).
            </small>
          </div>
        )}
      </section>
      <footer>
        Dati: API pubblica di chess.com · Scaccomatto999 · 1+0 rated · CSV e modelli restano sul tuo
        computer
      </footer>
      <GuideModal
        pageId={guidePage}
        opener={guideOpener}
        onNavigate={setGuidePage}
        onClose={closeGuide}
      />
      <footer className="projects-footer">
        <a href="https://links-page-bennibeni.vercel.app/">&larr; All projects</a>
      </footer>
    </main>
  );
}
