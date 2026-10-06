const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const M = require('../lib/modelli.cjs');
const core = require('../lib/core.cjs');

test('Albero: trova la soglia numerica e la divisione ottima tra categorie', () => {
  // colonna 0 numerica (bin 0..9): vince chi ha bin ≥ 5. Colonna 1 categorica: le categorie 1 e 3 vincono.
  const n = 2000,
    X = [],
    y = [];
  for (let i = 0; i < n; i++) {
    const a = i % 10,
      b = i % 4;
    X.push([a, b]);
    y.push(a >= 5 && (b === 1 || b === 3) ? 1 : 0);
  }
  const model = M.fitTree(
    X,
    y,
    { kinds: ['num', 'cat'], nBins: [10, 4] },
    { maxDepth: 3, minLeaf: 20 },
  );
  for (const [a, b] of [
    [7, 1],
    [7, 3],
    [2, 1],
    [7, 0],
    [9, 2],
  ])
    assert.equal(
      M.predictTree(model.root, [a, b], model.kinds),
      a >= 5 && (b === 1 || b === 3) ? 1 : 0,
    );
});

test('Foresta: ripetibile con lo stesso seme e probabilità tra 0 e 1', () => {
  const r = M.rng(3),
    X = [],
    y = [];
  for (let i = 0; i < 1500; i++) {
    const a = Math.floor(r() * 8),
      b = Math.floor(r() * 3);
    X.push([a, b]);
    y.push(r() < 0.2 + a * 0.08 ? 1 : 0);
  }
  const meta = { kinds: ['num', 'cat'], nBins: [8, 3] },
    opts = { trees: 20, maxDepth: 4, minLeaf: 20, mtry: 1, seed: 5 };
  const f1 = M.fitForest(X, y, meta, opts),
    f2 = M.fitForest(X, y, meta, opts);
  assert.deepEqual(JSON.parse(JSON.stringify(f1)), JSON.parse(JSON.stringify(f2)));
  const p = (row) =>
    f1.roots.reduce((s, t) => s + M.predictTree(t, row, f1.kinds), 0) / f1.roots.length;
  assert(p([7, 0]) > p([0, 0]) + 0.3);
  assert(X.every((x) => p(x) >= 0 && p(x) <= 1));
});

test('Logistica: ritrova i coefficienti veri', () => {
  const r = M.rng(11),
    X = [],
    y = [];
  for (let i = 0; i < 20000; i++) {
    const a = r() * 2 - 1,
      b = r() < 0.5 ? 1 : 0;
    X.push([a, b]);
    y.push(r() < M.sigmoid(-0.5 + 2 * a + 1 * b) ? 1 : 0);
  }
  const w = M.fitLogistic(X, y, { lambda: 0.01 }).weights;
  assert(
    Math.abs(w[0] + 0.5) < 0.1 && Math.abs(w[1] - 2) < 0.15 && Math.abs(w[2] - 1) < 0.1,
    String(w),
  );
});

test('Metriche: Brier, log-loss, accuratezza', () => {
  const m = M.metrics([1, 0], [0.8, 0.4]);
  assert.ok(Math.abs(m.brier - (0.04 + 0.16) / 2) < 1e-12);
  assert.ok(Math.abs(m.logloss - -(Math.log(0.8) + Math.log(0.6)) / 2) < 1e-12);
  assert.equal(m.accuracy, 1);
  assert.throws(() => M.metrics([1], [NaN]));
});

test('Split temporale: il test è il periodo più recente, senza sovrapposizioni', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    t: `2020-01-01 00:${String(99 - i).padStart(2, '0')}:00`,
  }));
  const { train, valid, test, rest } = core.split(rows);
  assert.deepEqual([train.length, valid.length, test.length, rest.length], [60, 20, 20, 80]);
  assert(train.at(-1).t < valid[0].t && valid.at(-1).t < test[0].t);
});

test('Codifica: aperture rare → «altra», valori fuori scala limitati, input controllati', () => {
  const base = {
    diff_elo: 20,
    colore: 'bianco',
    pausa: 0.5,
    posizione: 3,
    ora: 20,
    giorno: 2,
    partite_oggi: 4,
    trend: 0,
    apertura: 'Queens Gambit',
  };
  const rows = Array.from({ length: 400 }, (_, i) => ({ ...base, diff_elo: i - 200 }));
  const enc = core.buildEncoder(rows);
  assert.deepEqual(enc.openings.bianco, ['Queens Gambit']);
  assert.equal(
    core.normalize(enc, { ...base, apertura: 'Sconosciuta' }).apertura,
    'bianco · altra',
  );
  assert.equal(core.normalize(enc, { ...base, diff_elo: 9999 }).diff_elo, 400);
  assert.equal(core.normalize(enc, { ...base, pausa: 45 }).pausa, '30-120');
  assert.equal(core.linearRow(enc, base).length, core.linearNames(enc).length);
  const bundle = { encoder: enc };
  const ok = {
    colore: 'bianco',
    elo_mio: '1000',
    elo_avv: '1020',
    pausa: '0.5',
    posizione: '3',
    ora: '20',
    giorno: '2',
    partite_oggi: '4',
    trend: '0',
    apertura: 'Queens Gambit',
  };
  assert.equal(core.house(ok, bundle).diff_elo, 20);
  assert.throws(
    () => core.house({ ...ok, ora: '24' }, bundle),
    /Ora: il valore deve essere compreso tra 0 e 23/,
  );
  assert.throws(
    () => core.house({ ...ok, apertura: 'Sicilian Defense' }, bundle),
    /Apertura non disponibile/,
  );
  assert.throws(() => core.options({ period: 'tutto', trees: 999, depth: 6 }));
  assert.throws(() => core.modelPath('.', '../segreto'));
});

test('Pipeline completa su CSV sintetico: scelta sulla validazione, salvataggio, elenco, previsione', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scacchi-test-'));
  try {
    await fs.mkdir(path.join(root, 'data'));
    const head =
      'inizio_locale,punteggio,punteggio_atteso,diff_elo,colore,pausa_min,posizione_sessione,ora,giorno_settimana,partite_prima_oggi,trend_elo_20,famiglia_apertura,elo_sospetto';
    const r = M.rng(1),
      lines = [head];
    for (let i = 0; i < 3000; i++) {
      const diff = Math.round((r() - 0.5) * 200),
        white = r() < 0.5,
        pause = r() < 0.2 ? 200 : 0.5;
      const p = 1 / (1 + 10 ** (diff / 400)) + (white ? 0.03 : -0.03) - (pause > 60 ? 0.06 : 0);
      const d = new Date(Date.UTC(2023, 0, 1) + i * 3600e3)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      lines.push(
        [
          d,
          r() < p ? 1 : 0,
          (1 / (1 + 10 ** (diff / 400))).toFixed(4),
          diff,
          white ? 'bianco' : 'nero',
          pause,
          1 + (i % 8),
          i % 24,
          1 + (i % 7),
          i % 12,
          '',
          white ? 'Queens Gambit' : 'Sicilian Defense',
          i === 5 ? 1 : 0,
        ].join(','),
      );
    }
    await fs.writeFile(path.join(root, 'data', 'partite.csv'), lines.join('\n'));
    const meta = await core.run(root, { period: 'tutto', trees: 50, depth: 4 });
    assert.equal(meta.counts.read, 3000);
    assert.equal(meta.counts.valid, 2999);
    assert.equal(
      meta.kind,
      meta.scores.reduce((a, b) => (a.valid.brier <= b.valid.brier ? a : b)).kind,
    );
    assert.equal(meta.model, undefined);
    assert.equal(meta.encoder, undefined);
    assert.equal(meta.importance.length, core.features.length);
    const { models, skipped } = await core.list(root);
    assert.deepEqual([models.length, skipped.length], [1, 0]);
    const bundle = await core.read(root, meta.id);
    const row = core.house(
      {
        colore: 'bianco',
        elo_mio: '1000',
        elo_avv: '1000',
        pausa: '0.5',
        posizione: '2',
        ora: '20',
        giorno: '3',
        partite_oggi: '2',
        trend: '0',
        apertura: meta.openings.bianco[0],
      },
      bundle,
    );
    const out = core.explore(bundle, row);
    assert(out.probability > 0 && out.probability < 1);
    assert.equal(out.byHour.length, 24);
    assert.equal(out.byPause.length, 6);
    await fs.writeFile(
      path.join(root, 'models', '00000000-0000-4000-8000-000000000000.json'),
      '{ troncato',
    );
    assert.deepEqual((await core.list(root)).skipped, [
      '00000000-0000-4000-8000-000000000000.json',
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Guida: pagine numerate, ID unici, capitoli con accesso rapido', async () => {
  const { loadGuide, parseGuide } = require('../lib/guide.cjs');
  const guide = await loadGuide(path.join(__dirname, '..'));
  assert(guide.pages.length >= 20);
  assert.equal(
    guide.chapters.reduce((n, c) => n + c.pages.length, 0),
    guide.pages.length,
  );
  assert.equal(guide.shortcuts.length, guide.chapters.length);
  for (const p of guide.pages) assert(p.title && p.body.length > 200, p.id);
  assert.throws(
    () =>
      parseGuide(
        '<!-- capitolo: A -->\n<!-- page:a -->\n## Pagina 01 — A\nx\n<!-- page:a -->\n## Pagina 02 — B\ny',
      ),
    /duplicati/,
  );
});

test('Aggiorna dati: incrementale con base, avanzamento, sostituisce il CSV solo se lo script riesce', async () => {
  const { updateData } = require('../lib/aggiorna.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scacchi-agg-'));
  try {
    await fs.mkdir(path.join(root, 'scripts'));
    await fs.mkdir(path.join(root, 'data'));
    await fs.writeFile(path.join(root, 'data', 'partite.csv'), 'a\n1\n2\n');
    // Finto script (eseguito da Node al posto di Python): registra gli argomenti, stampa l'avanzamento, scrive 4 righe.
    const fake = `const fs=require('fs'),a=process.argv,out=a[a.indexOf('--out')+1];
      fs.writeFileSync('argomenti.txt', a.slice(2).join(' '));
      if (fs.existsSync('FALLISCI')) { console.error('PROGRESSO 1/3 2026-07'); console.error('HTTP Error 503: Service Unavailable'); process.exit(1); }
      console.error('PROGRESSO 1/2 2026-08'); console.error('PROGRESSO 2/2 2026-09');
      fs.writeFileSync(out,'a\\n1\\n2\\n3\\n4\\n'); fs.writeFileSync(out.replace(/\\.csv$/,'.colonne.md'),'# colonne');`;
    await fs.writeFile(path.join(root, 'scripts', 'estrai_partite.py'), fake);
    const progress = [],
      children = [];
    const opts = {
      pythons: ['interprete-inesistente-xyz', process.execPath],
      onProgress: (p) => progress.push(p),
      onChild: (pid) => children.push(pid),
    };
    assert.deepEqual(await updateData(root, opts), {
      before: 2,
      after: 4,
      added: 2,
      incremental: true,
    });
    assert.match(
      await fs.readFile(path.join(root, 'argomenti.txt'), 'utf8'),
      /--base .*partite\.csv/,
    );
    assert.deepEqual(
      progress.map((p) => `${p.done}/${p.total} ${p.month}`),
      ['1/2 2026-08', '2/2 2026-09'],
    );
    assert.equal(children.length, 1);
    assert.equal(
      await fs.readFile(path.join(root, 'data', 'partite.colonne.md'), 'utf8'),
      '# colonne',
    );
    await fs.writeFile(path.join(root, 'FALLISCI'), '');
    await assert.rejects(updateData(root, opts), /Aggiornamento non riuscito: HTTP Error 503/);
    assert.equal(
      await fs.readFile(path.join(root, 'data', 'partite.csv'), 'utf8'),
      'a\n1\n2\n3\n4\n',
    );
    await assert.rejects(fs.access(path.join(root, 'data', 'partite.nuovo.csv')));
    await assert.rejects(
      updateData(root, { pythons: ['interprete-inesistente-xyz'] }),
      /Python non trovato/,
    );
    // Senza CSV: download completo, nessun --base
    await fs.rm(path.join(root, 'FALLISCI'));
    await fs.rm(path.join(root, 'data', 'partite.csv'));
    assert.equal((await updateData(root, opts)).incremental, false);
    assert.doesNotMatch(await fs.readFile(path.join(root, 'argomenti.txt'), 'utf8'), /--base/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Lock: vuoto o di un server morto viene rimosso, quello attivo blocca con un messaggio chiaro', async () => {
  const lavori = require('../lib/lavori.cjs');
  const { execFileSync } = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scacchi-lock-'));
  try {
    await fs.mkdir(path.join(root, 'models'));
    // 1. Lock vuoto della versione precedente, vecchio di un minuto → abbandonato.
    await fs.writeFile(lavori.lockPath(root), '');
    const old = new Date(Date.now() - 60000);
    await fs.utimes(lavori.lockPath(root), old, old);
    const a = await lavori.acquire(root, 'dati');
    assert.equal(a.serverPid, process.pid);
    // 2. Lock attivo di questo server → occupato, con tipo di lavoro e ora.
    await assert.rejects(
      lavori.acquire(root, 'addestramento'),
      /Aggiornamento dei dati è già in corso dalle \d\d:\d\d/,
    );
    await lavori.update(root, a, { progress: { done: 3, total: 10, month: '2016-02' } });
    assert.deepEqual((await lavori.status(root)).running.progress, {
      done: 3,
      total: 10,
      month: '2016-02',
    });
    await lavori.release(root, a);
    assert.equal((await lavori.status(root)).running, null);
    // 3. Lock di un server che non esiste più → rimosso, e l'esito dice che il lavoro è stato interrotto.
    const deadPid = Number(
      execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']),
    );
    await fs.writeFile(
      lavori.lockPath(root),
      JSON.stringify({
        kind: 'dati',
        serverPid: deadPid,
        childPid: null,
        startedAt: new Date().toISOString(),
      }),
    );
    const st = await lavori.status(root);
    assert.equal(st.running, null);
    assert.match(
      st.last.message,
      /Aggiornamento dei dati interrotto \(il server che l’aveva avviato non è più attivo\)/,
    );
    const b = await lavori.acquire(root, 'addestramento');
    await lavori.release(root, b);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Sola lettura (vetrina): modelli da vetrina/, nessuna cartella creata, nessun file scritto', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scacchi-ro-'));
  const prev = process.env.SCACCHI_SOLA_LETTURA;
  try {
    process.env.SCACCHI_SOLA_LETTURA = '1';
    assert.equal(core.readOnly(), true);
    assert.deepEqual(await core.list(root), { models: [], skipped: [] });
    await assert.rejects(fs.access(path.join(root, 'vetrina'))); // nessuna cartella creata
    await assert.rejects(fs.access(path.join(root, 'models')));
    // Un modello senza .meta.json in vetrina: elencato lo stesso, senza scrivere (qui la cartella è in sola lettura).
    await fs.mkdir(path.join(root, 'vetrina'));
    const src = path.join(__dirname, '..', 'vetrina');
    const id = (await fs.readdir(src))
      .find((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
      .slice(0, -5);
    await fs.copyFile(path.join(src, `${id}.json`), path.join(root, 'vetrina', `${id}.json`));
    await fs.chmod(path.join(root, 'vetrina'), 0o555);
    const { models } = await core.list(root);
    assert.deepEqual(
      models.map((m) => m.id),
      [id],
    );
    assert.equal(core.modelPath(root, id), path.join(root, 'vetrina', `${id}.json`));
    process.env.SCACCHI_SOLA_LETTURA = '0';
    process.env.VERCEL = '1';
    assert.equal(core.readOnly(), false); // forzatura della modalità completa
    process.env.SCACCHI_SOLA_LETTURA = '';
    assert.equal(core.readOnly(), true); // su Vercel è il comportamento predefinito
  } finally {
    delete process.env.VERCEL;
    if (prev === undefined) delete process.env.SCACCHI_SOLA_LETTURA;
    else process.env.SCACCHI_SOLA_LETTURA = prev;
    await fs.chmod(path.join(root, 'vetrina'), 0o755).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
