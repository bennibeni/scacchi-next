const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parse } = require('csv-parse/sync');
const M = require('./modelli.cjs');

// ---------------------------------------------------------------- colonne

// Solo informazioni note PRIMA della partita. Esito, mosse ed Elo finali sono esclusi: rivelano il risultato.
const PAUSE = [
  ['<1', 1],
  ['1-3', 3],
  ['3-10', 10],
  ['10-30', 30],
  ['30-120', 120],
  ['>120', Infinity],
];
const DAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const features = [
  { key: 'diff_elo', label: 'Differenza Elo (avversario − tu)', kind: 'num', min: -400, max: 400 },
  { key: 'colore', label: 'Colore (con la sua apertura)', kind: 'cat', values: ['bianco', 'nero'] },
  {
    key: 'pausa',
    label: 'Pausa prima della partita (min)',
    kind: 'cat',
    values: PAUSE.map((p) => p[0]),
    min: 0,
    max: 10080,
  },
  { key: 'posizione', label: 'Posizione nella sessione', kind: 'num', min: 1, max: 30 },
  { key: 'ora', label: 'Ora di inizio', kind: 'cat', values: [...Array(24).keys()].map(String) },
  { key: 'giorno', label: 'Giorno della settimana', kind: 'cat', values: DAYS },
  { key: 'partite_oggi', label: 'Partite già giocate oggi', kind: 'num', min: 0, max: 60 },
  { key: 'trend', label: 'Andamento Elo (ultime 20)', kind: 'num', min: -200, max: 200 },
  { key: 'apertura', label: 'Apertura (famiglia)', kind: 'cat', values: null }, // elenco ricavato dal training
];
const labels = Object.fromEntries(features.map((f) => [f.key, f.label]));
const PERIODS = { tutto: 2016, dal2020: 2020, dal2023: 2023 };

/**
 * Sola lettura: su Vercel (VERCEL=1) oppure con SCACCHI_SOLA_LETTURA=1.
 * Il filesystem di un deploy non è scrivibile: i modelli si leggono da vetrina/ (inclusa nel deploy)
 * e addestramento e aggiornamento dei dati sono disattivati. SCACCHI_SOLA_LETTURA=0 forza la modalità completa.
 */
const readOnly = () =>
  process.env.SCACCHI_SOLA_LETTURA === '1' ||
  (process.env.VERCEL === '1' && process.env.SCACCHI_SOLA_LETTURA !== '0');
const modelsDir = (root) => path.join(root, readOnly() ? 'vetrina' : 'models');
const OPENING_MIN = 300,
  OPENING_MAX = 14,
  OTHER = 'altra';

const pauseClass = (minutes) => PAUSE.find(([, max]) => minutes < max)[0];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Da una riga del CSV (o dal modulo di previsione) ai valori grezzi delle colonne. */
function fromCsv(r) {
  const n = (k) => (r[k] === '' || r[k] == null ? NaN : Number(r[k]));
  return {
    t: r.inizio_locale,
    y: Number(r.punteggio) === 1 ? 1 : 0,
    expected: n('punteggio_atteso'),
    diff_elo: n('diff_elo'),
    colore: r.colore,
    pausa: Number.isFinite(n('pausa_min')) ? n('pausa_min') : 10080,
    posizione: n('posizione_sessione'),
    ora: n('ora'),
    giorno: n('giorno_settimana'),
    partite_oggi: n('partite_prima_oggi'),
    trend: Number.isFinite(n('trend_elo_20')) ? n('trend_elo_20') : 0,
    apertura: r.famiglia_apertura || 'Undefined',
  };
}
const openingKey = (row) => `${row.colore} · ${row.apertura}`;

// ---------------------------------------------------------------- codifica

/**
 * Il codificatore si costruisce SOLO sui dati di addestramento (medie, quantili, elenco aperture)
 * e viene salvato con il modello, così la previsione usa esattamente le stesse regole.
 */
function buildEncoder(rows) {
  const counts = {};
  for (const r of rows) counts[openingKey(r)] = (counts[openingKey(r)] || 0) + 1;
  const openings = {};
  for (const color of ['bianco', 'nero']) {
    openings[color] = Object.entries(counts)
      .filter(([k, c]) => k.startsWith(color + ' · ') && c >= OPENING_MIN)
      .sort((a, b) => b[1] - a[1])
      .slice(0, OPENING_MAX)
      .map(([k]) => k.slice(color.length + 3));
  }
  const openingValues = [
    ...openings.bianco.map((o) => `bianco · ${o}`),
    ...openings.nero.map((o) => `nero · ${o}`),
    `bianco · ${OTHER}`,
    `nero · ${OTHER}`,
  ];
  const num = {};
  for (const f of features.filter((f) => f.kind === 'num')) {
    const v = rows.map((r) => clamp(r[f.key], f.min, f.max)).sort((a, b) => a - b);
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1;
    // Al massimo 32 intervalli per l'albero, con confini sui quantili (senza duplicati).
    const edges = [
      ...new Set(Array.from({ length: 31 }, (_, k) => v[Math.floor(((k + 1) * v.length) / 32)])),
    ];
    num[f.key] = { mean, sd, edges };
  }
  return { version: 1, openings, openingValues, num };
}

function categories(enc, f) {
  return f.key === 'apertura' ? enc.openingValues : f.values;
}

/** Valori grezzi → valori normalizzati e controllati (categorie come stringhe). */
function normalize(enc, row) {
  const opening = enc.openings[row.colore]?.includes(row.apertura) ? row.apertura : OTHER;
  return {
    diff_elo: clamp(row.diff_elo, -400, 400),
    colore: row.colore,
    pausa: pauseClass(Math.max(0, row.pausa)),
    posizione: clamp(row.posizione, 1, 30),
    ora: String(row.ora),
    giorno: DAYS[row.giorno - 1],
    partite_oggi: clamp(row.partite_oggi, 0, 60),
    trend: clamp(row.trend, -200, 200),
    apertura: `${row.colore} · ${opening}`,
  };
}

/** Per gli alberi: un intero (bin) per colonna. */
function treeCodes(enc, row) {
  const v = normalize(enc, row);
  return features.map((f) => {
    if (f.kind === 'num') {
      const e = enc.num[f.key].edges;
      let b = 0;
      while (b < e.length && v[f.key] > e[b]) b++;
      return b;
    }
    const i = categories(enc, f).indexOf(v[f.key]);
    if (i < 0) throw new Error(`Valore non previsto: ${f.label}.`);
    return i;
  });
}
function treeMeta(enc) {
  return {
    kinds: features.map((f) => f.kind),
    nBins: features.map((f) =>
      f.kind === 'num' ? enc.num[f.key].edges.length + 1 : categories(enc, f).length,
    ),
  };
}

/** Per la logistica: numeri standardizzati + una colonna 0/1 per ogni categoria (one-hot). */
function linearRow(enc, row) {
  const v = normalize(enc, row),
    out = [];
  for (const f of features) {
    if (f.kind === 'num') out.push((v[f.key] - enc.num[f.key].mean) / enc.num[f.key].sd);
    else for (const c of categories(enc, f)) out.push(v[f.key] === c ? 1 : 0);
  }
  return out;
}
function linearNames(enc) {
  return features.flatMap((f) =>
    f.kind === 'num' ? [f.key] : categories(enc, f).map((c) => `${f.key}=${c}`),
  );
}

// ---------------------------------------------------------------- modelli

const KINDS = ['elo', 'logistic', 'tree', 'forest'];
const NAMES = {
  elo: 'Formula Elo',
  logistic: 'Regressione logistica',
  tree: 'Albero decisionale',
  forest: 'Random Forest',
};

function eloProbability(row) {
  return 1 / (1 + 10 ** (clamp(row.diff_elo, -400, 400) / 400));
}

function fit(kind, rows, config) {
  const y = rows.map((r) => r.y);
  if (kind === 'elo') return { kind, encoder: null, model: { type: 'elo' } };
  const encoder = buildEncoder(rows);
  if (kind === 'logistic')
    return {
      kind,
      encoder,
      model: M.fitLogistic(
        rows.map((r) => linearRow(encoder, r)),
        y,
        { lambda: 1 },
      ),
    };
  const X = rows.map((r) => treeCodes(encoder, r)),
    meta = treeMeta(encoder);
  if (kind === 'tree')
    return {
      kind,
      encoder,
      model: M.fitTree(X, y, meta, { maxDepth: config.depth, minLeaf: 100 }),
    };
  return {
    kind,
    encoder,
    model: M.fitForest(X, y, meta, {
      trees: config.trees,
      maxDepth: config.depth,
      minLeaf: 30,
      mtry: 3,
      seed: 1,
    }),
  };
}

function predictor(fitted) {
  const { kind, encoder, model } = fitted;
  if (kind === 'elo') return (row) => eloProbability(row);
  if (kind === 'logistic') return (row) => M.predictLogistic(model, linearRow(encoder, row));
  if (kind === 'tree')
    return (row) => M.predictTree(model.root, treeCodes(encoder, row), model.kinds);
  return (row) => {
    const c = treeCodes(encoder, row);
    let s = 0;
    for (const r of model.roots) s += M.predictTree(r, c, model.kinds);
    return s / model.roots.length;
  };
}
const predictAll = (fitted, rows) => {
  const p = predictor(fitted);
  return rows.map(p);
};

/**
 * Importanza per permutazione: si mescola una colonna alla volta tra le partite di test
 * e si misura di quanto peggiora il Brier. Se non peggiora, il modello non la usa davvero.
 */
function permutationImportance(fitted, rows, repeats = 5, seed = 7) {
  const p = predictor(fitted),
    y = rows.map((r) => r.y),
    base = M.metrics(y, rows.map(p)).brier,
    random = M.rng(seed);
  return features
    .map((f) => {
      const deltas = [];
      for (let k = 0; k < repeats; k++) {
        const shuffled = rows.map((r) => ({ ...r }));
        // L'apertura dipende dal colore: si mescola solo tra partite dello stesso colore.
        // Il colore si mescola insieme alla sua apertura, altrimenti nascerebbero combinazioni impossibili.
        const groups =
          f.key === 'apertura'
            ? ['bianco', 'nero'].map((c) => [...rows.keys()].filter((i) => rows[i].colore === c))
            : [[...rows.keys()]];
        const moved = f.key === 'colore' ? ['colore', 'apertura'] : [f.key];
        for (const g of groups) {
          const perm = [...g];
          for (let i = perm.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
          }
          g.forEach((i, n) => {
            for (const k2 of moved) shuffled[i][k2] = rows[perm[n]][k2];
          });
        }
        deltas.push(M.metrics(y, shuffled.map(p)).brier - base);
      }
      const mean = deltas.reduce((s, d) => s + d, 0) / repeats;
      const sd = Math.sqrt(deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / repeats);
      return { key: f.key, label: f.label, delta: mean, sd };
    })
    .sort((a, b) => b.delta - a.delta);
}

// ---------------------------------------------------------------- dati e pipeline

function options(input) {
  const result = {
    period: String(input.period),
    trees: Number(input.trees),
    depth: Number(input.depth),
  };
  if (
    !(result.period in PERIODS) ||
    ![50, 100, 300].includes(result.trees) ||
    ![4, 6, 8, 12].includes(result.depth)
  )
    throw new Error('Configurazione non valida.');
  return result;
}

/** Split TEMPORALE: il passato impara, il periodo intermedio sceglie, il più recente verifica. */
function split(rows) {
  const sorted = [...rows].sort((a, b) => a.t.localeCompare(b.t));
  const a = Math.floor(sorted.length * 0.6),
    b = Math.floor(sorted.length * 0.8);
  return {
    train: sorted.slice(0, a),
    valid: sorted.slice(a, b),
    test: sorted.slice(b),
    rest: sorted.slice(0, b),
  };
}

const REQUIRED = [
  'inizio_locale',
  'punteggio',
  'punteggio_atteso',
  'diff_elo',
  'colore',
  'pausa_min',
  'posizione_sessione',
  'ora',
  'giorno_settimana',
  'partite_prima_oggi',
  'trend_elo_20',
  'famiglia_apertura',
  'elo_sospetto',
];

// Il CSV (16 MB) si analizza una volta sola finché non cambia: conta soprattutto su Vercel, dove ogni avvio a freddo lo rilegge.
let rowsCache = null;
async function loadRows(root) {
  const file = path.join(root, 'data', 'partite.csv'),
    st = await fs.stat(file),
    key = `${file}|${st.mtimeMs}|${st.size}`;
  if (rowsCache?.key === key) return rowsCache.value;
  const raw = parse(await fs.readFile(file, 'utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  });
  for (const key of REQUIRED)
    if (!raw.length || !(key in raw[0])) throw new Error(`Colonna mancante nel CSV: ${key}.`);
  const rows = raw
    .filter((r) => r.elo_sospetto !== '1')
    .map(fromCsv)
    .filter(
      (r) =>
        ['bianco', 'nero'].includes(r.colore) &&
        [r.diff_elo, r.posizione, r.ora, r.giorno, r.partite_oggi].every(Number.isFinite) &&
        r.giorno >= 1 &&
        r.giorno <= 7,
    );
  rowsCache = { key, value: { raw: raw.length, rows } };
  return rowsCache.value;
}

function stats(rows) {
  const y = rows.reduce((s, r) => s + r.y, 0);
  return {
    n: rows.length,
    from: rows[0]?.t.slice(0, 10),
    to: rows[rows.length - 1]?.t.slice(0, 10),
    winRate: rows.length ? y / rows.length : 0,
  };
}

async function run(root, input, progress = () => {}) {
  const config = options(input),
    start = Date.now();
  const { raw, rows: all } = await loadRows(root);
  const rows = all.filter((r) => Number(r.t.slice(0, 4)) >= PERIODS[config.period]);
  if (rows.length < 500) throw new Error('Servono almeno 500 partite valide nel periodo scelto.');
  const { train, valid, test, rest } = split(rows);
  const yv = valid.map((r) => r.y),
    yt = test.map((r) => r.y),
    ytr = train.map((r) => r.y);

  // 1. Ogni candidato impara sul training; la scelta avviene SOLO sulla validazione.
  const candidates = {},
    scores = [];
  for (const kind of KINDS) {
    progress(`Addestramento: ${NAMES[kind]}…`);
    const t0 = Date.now();
    const fitted = fit(kind, train, config);
    candidates[kind] = fitted;
    scores.push({
      kind,
      train: M.metrics(ytr, predictAll(fitted, train)),
      valid: M.metrics(yv, predictAll(fitted, valid)),
      seconds: (Date.now() - t0) / 1000,
    });
  }
  const winner = scores.reduce((a, b) => (a.valid.brier <= b.valid.brier ? a : b));

  // 2. Il vincitore si riaddestra su training + validazione e si valuta UNA volta sul test.
  progress(`Riaddestramento del vincitore (${NAMES[winner.kind]}) su training + validazione…`);
  const final = fit(winner.kind, rest, config);
  const pTest = predictAll(final, test);
  const testMetrics = M.metrics(yt, pTest);
  const eloTest = M.metrics(yt, test.map(eloProbability));

  // Vista didattica: tutti i candidati (addestrati sul solo training) sul test. Non serve a scegliere.
  const allOnTest = scores.map((s) => ({
    kind: s.kind,
    test: M.metrics(yt, predictAll(candidates[s.kind], test)),
  }));

  progress('Importanza delle colonne (permutazione sul test)…');
  const importance = permutationImportance(final, test);

  const bundle = {
    schema: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    target: 'vittoria',
    kind: winner.kind,
    config,
    features: features.map((f) => f.key),
    scores,
    allOnTest,
    test: testMetrics,
    eloTest,
    importance,
    calibration: M.calibration(yt, pTest),
    counts: {
      read: raw,
      valid: all.length,
      used: rows.length,
      train: train.length,
      validation: valid.length,
      test: test.length,
    },
    periods: { train: stats(train), validation: stats(valid), test: stats(test) },
    seconds: (Date.now() - start) / 1000,
    encoder: final.encoder,
    model: final.model,
  };
  await fs.mkdir(modelsDir(root), { recursive: true });
  await writeAtomic(modelPath(root, bundle.id), JSON.stringify(bundle));
  const meta = summary(bundle);
  await writeAtomic(metaPath(root, bundle.id), JSON.stringify(meta));
  return meta;
}

// ---------------------------------------------------------------- previsione

function openingsFor(bundle) {
  const enc = bundle.encoder;
  return enc
    ? { bianco: [...enc.openings.bianco, OTHER], nero: [...enc.openings.nero, OTHER] }
    : { bianco: [OTHER], nero: [OTHER] };
}

/** Controlla il modulo della previsione e lo trasforma in una riga grezza. */
function house(input, bundle) {
  const num = (key, label, lo, hi, integer = true) => {
    if (input[key] === '' || input[key] == null) throw new Error(`Inserisci il campo ${label}.`);
    const v = Number(input[key]);
    if (!Number.isFinite(v)) throw new Error(`${label}: inserisci un numero.`);
    if (v < lo || v > hi)
      throw new Error(`${label}: il valore deve essere compreso tra ${lo} e ${hi}.`);
    if (integer && !Number.isInteger(v)) throw new Error(`${label}: inserisci un numero intero.`);
    return v;
  };
  if (!['bianco', 'nero'].includes(input.colore)) throw new Error('Colore non valido.');
  const me = num('elo_mio', 'Il tuo Elo', 100, 3500),
    opp = num('elo_avv', 'Elo avversario', 100, 3500);
  const apertura = String(input.apertura ?? '');
  if (!openingsFor(bundle)[input.colore].includes(apertura))
    throw new Error('Apertura non disponibile per questo colore.');
  return {
    diff_elo: opp - me,
    colore: input.colore,
    pausa: num('pausa', 'Pausa (minuti)', 0, 10080, false),
    posizione: num('posizione', 'Posizione nella sessione', 1, 500),
    ora: num('ora', 'Ora', 0, 23),
    giorno: num('giorno', 'Giorno', 1, 7),
    partite_oggi: num('partite_oggi', 'Partite già giocate oggi', 0, 500),
    trend: num('trend', 'Andamento Elo', -1000, 1000),
    apertura,
  };
}

/** Probabilità per la partita descritta + "cosa succederebbe se" per ora e apertura. */
function explore(bundle, row) {
  const p = predictor(bundle);
  return {
    probability: p(row),
    elo: eloProbability(row),
    byHour: [...Array(24).keys()].map((h) => ({ hour: h, p: p({ ...row, ora: h }) })),
    byOpening: openingsFor(bundle)
      [row.colore].map((o) => ({ opening: o, p: p({ ...row, apertura: o }) }))
      .sort((a, b) => b.p - a.p),
    byPause: PAUSE.map(([name, max]) => ({
      pause: name,
      p: p({ ...row, pausa: max === Infinity ? 240 : max - 0.5 }),
    })),
  };
}

// ---------------------------------------------------------------- archivio

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function modelPath(root, id) {
  if (typeof id !== 'string' || !idPattern.test(id))
    throw new Error('Identificativo modello non valido.');
  return path.join(modelsDir(root), `${id}.json`);
}
const metaPath = (root, id) => modelPath(root, id).replace(/\.json$/, '.meta.json');
function summary(bundle) {
  const { model, encoder, ...meta } = bundle;
  return { ...meta, openings: openingsFor(bundle) };
}
async function writeAtomic(file, data) {
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
}
async function read(root, id) {
  const b = JSON.parse(await fs.readFile(modelPath(root, id), 'utf8'));
  check(b);
  return b;
}
function check(b) {
  if (
    b.schema !== 1 ||
    !KINDS.includes(b.kind) ||
    JSON.stringify(b.features) !== JSON.stringify(features.map((f) => f.key))
  )
    throw new Error('Formato del modello non compatibile.');
  if (b.kind !== 'elo' && (!b.encoder || !b.model))
    throw new Error('Formato del modello non compatibile.');
}
async function list(root) {
  const dir = modelsDir(root);
  if (readOnly()) {
    try {
      await fs.access(dir);
    } catch {
      return { models: [], skipped: [] };
    }
  } else await fs.mkdir(dir, { recursive: true });
  const ids = (await fs.readdir(dir))
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map((f) => f.slice(0, -5))
    .filter((id) => idPattern.test(id));
  const models = [],
    skipped = [];
  for (const id of ids) {
    try {
      let meta;
      try {
        meta = JSON.parse(await fs.readFile(metaPath(root, id), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const b = await read(root, id);
        meta = summary(b);
        await writeAtomic(metaPath(root, id), JSON.stringify(meta)).catch(() => {});
      } // in sola lettura il file di metadati non si può creare: si usa quello calcolato
      if (meta.id !== id || typeof meta.createdAt !== 'string' || !meta.counts)
        throw new Error('metadati incompleti');
      models.push(meta);
    } catch {
      skipped.push(`${id}.json`);
    }
  }
  return { models: models.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), skipped };
}

async function dataset(root) {
  const { raw, rows } = await loadRows(root);
  return {
    raw,
    ...stats([...rows].sort((a, b) => a.t.localeCompare(b.t))),
    byPeriod: Object.fromEntries(
      Object.entries(PERIODS).map(([k, y]) => [
        k,
        rows.filter((r) => Number(r.t.slice(0, 4)) >= y).length,
      ]),
    ),
  };
}

module.exports = {
  features,
  labels,
  PERIODS,
  PAUSE,
  DAYS,
  KINDS,
  NAMES,
  OTHER,
  fromCsv,
  buildEncoder,
  normalize,
  treeCodes,
  linearRow,
  linearNames,
  fit,
  predictor,
  predictAll,
  eloProbability,
  permutationImportance,
  options,
  split,
  loadRows,
  run,
  house,
  explore,
  openingsFor,
  modelPath,
  metaPath,
  summary,
  read,
  list,
  dataset,
  readOnly,
  modelsDir,
};
