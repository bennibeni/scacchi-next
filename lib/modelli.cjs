// Modelli di classificazione binaria (vittoria sì/no) che restituiscono una PROBABILITÀ.
// Scritti a mano perché ml-cart prova ogni valore distinto di ogni colonna in ogni nodo:
// con ~40.000 partite un solo albero richiedeva oltre dieci minuti.
// Qui gli alberi lavorano su colonne già discretizzate in pochi "bin" (istogrammi),
// la stessa idea di LightGBM e di HistGradientBoosting di scikit-learn.

/** Generatore pseudo-casuale ripetibile (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- albero

/**
 * Addestra un albero di regressione sul target 0/1: il valore di una foglia è la
 * frequenza di vittorie delle partite che vi arrivano, cioè una probabilità.
 * codes[f][i] = bin della colonna f per la riga i (interi 0..nBins[f]-1)
 * kinds[f]    = 'num' (bin ordinati: soglia "≤") oppure 'cat' (insieme di categorie a sinistra)
 * idx         = righe usate (con ripetizioni, per il bootstrap della foresta)
 */
function trainTree(
  codes,
  y,
  idx,
  { kinds, nBins, maxDepth, minLeaf, mtry = kinds.length, random = Math.random },
) {
  const F = kinds.length;
  function leaf(rows) {
    let s = 0;
    for (const i of rows) s += y[i];
    return s / rows.length;
  }
  function build(rows, depth) {
    if (depth >= maxDepth || rows.length < 2 * minLeaf) return leaf(rows);
    let total = 0;
    for (const i of rows) total += y[i];
    const n = rows.length,
      base = (total * total) / n;
    // Foresta: a ogni nodo si considera solo un sottoinsieme casuale di colonne.
    const features = [...Array(F).keys()];
    for (let k = F - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [features[k], features[j]] = [features[j], features[k]];
    }
    let best = null;
    for (const f of features.slice(0, mtry)) {
      const nb = nBins[f],
        cnt = new Float64Array(nb),
        sum = new Float64Array(nb),
        col = codes[f];
      for (const i of rows) {
        cnt[col[i]]++;
        sum[col[i]] += y[i];
      }
      let order = [...Array(nb).keys()].filter((b) => cnt[b] > 0);
      // Con target 0/1 ordinare le categorie per frequenza di vittoria rende ottima la ricerca
      // di un taglio "prefisso": è la divisione migliore tra tutte le 2^k possibili.
      if (kinds[f] === 'cat') order.sort((a, b) => sum[a] / cnt[a] - sum[b] / cnt[b]);
      let cl = 0,
        sl = 0;
      for (let k = 0; k < order.length - 1; k++) {
        cl += cnt[order[k]];
        sl += sum[order[k]];
        const cr = n - cl,
          sr = total - sl;
        if (cl < minLeaf || cr < minLeaf) continue;
        const gain = (sl * sl) / cl + (sr * sr) / cr - base; // riduzione della somma dei quadrati
        if (!best || gain > best.gain)
          best = { gain, f, split: kinds[f] === 'cat' ? order.slice(0, k + 1) : order[k] };
      }
    }
    if (!best || best.gain <= 1e-12) return leaf(rows);
    const goLeft = goesLeft(best.split, kinds[best.f], nBins[best.f]);
    const L = [],
      R = [];
    for (const i of rows) (goLeft[codes[best.f][i]] ? L : R).push(i);
    return [best.f, best.split, build(L, depth + 1), build(R, depth + 1)];
  }
  return build(idx, 0);
}

function goesLeft(split, kind, nb) {
  const out = new Uint8Array(nb);
  if (kind === 'cat') for (const b of split) out[b] = 1;
  else for (let b = 0; b <= split; b++) out[b] = 1;
  return out;
}

/** Nodo: numero (foglia) oppure [colonna, soglia | categorie a sinistra, sinistra, destra]. */
function predictTree(node, row, kinds) {
  while (Array.isArray(node)) {
    const [f, split, l, r] = node,
      v = row[f];
    node = (kinds[f] === 'cat' ? split.includes(v) : v <= split) ? l : r;
  }
  return node;
}

function countLeaves(node) {
  return Array.isArray(node) ? countLeaves(node[2]) + countLeaves(node[3]) : 1;
}

// ---------------------------------------------------------------- albero e foresta come oggetti serializzabili

function column(codes, F, n) {
  return Array.from({ length: F }, (_, f) => {
    const c = new Uint16Array(n);
    for (let i = 0; i < n; i++) c[i] = codes[i][f];
    return c;
  });
}

function fitTree(rows, y, meta, { maxDepth, minLeaf }) {
  const cols = column(rows, meta.kinds.length, rows.length);
  const root = trainTree(cols, y, [...Array(rows.length).keys()], { ...meta, maxDepth, minLeaf });
  return { type: 'tree', kinds: meta.kinds, root };
}

function fitForest(rows, y, meta, { trees, maxDepth, minLeaf, mtry, seed = 1 }) {
  const n = rows.length,
    cols = column(rows, meta.kinds.length, n),
    random = rng(seed),
    roots = [];
  for (let t = 0; t < trees; t++) {
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = Math.floor(random() * n); // bootstrap
    roots.push(trainTree(cols, y, idx, { ...meta, maxDepth, minLeaf, mtry, random }));
  }
  return { type: 'forest', kinds: meta.kinds, roots };
}

// ---------------------------------------------------------------- regressione logistica

const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/**
 * Regressione logistica con penalità L2, stimata con il metodo di Newton (IRLS).
 * X: righe di numeri già preparati (colonne numeriche standardizzate + categorie one-hot).
 * L'intercetta non viene penalizzata. Converge in poche iterazioni.
 */
function fitLogistic(X, y, { lambda = 1, iterations = 25 } = {}) {
  const n = X.length,
    p = X[0].length + 1;
  const w = new Float64Array(p);
  for (let it = 0; it < iterations; it++) {
    const H = Array.from({ length: p }, () => new Float64Array(p)),
      g = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const x = X[i];
      let z = w[0];
      for (let j = 1; j < p; j++) z += w[j] * x[j - 1];
      const pr = sigmoid(z),
        r = y[i] - pr,
        s = pr * (1 - pr);
      g[0] += r;
      for (let j = 1; j < p; j++) g[j] += r * x[j - 1];
      // H = Xᵀ S X (solo triangolo inferiore, poi simmetrizzato)
      for (let j = 0; j < p; j++) {
        const xj = j ? x[j - 1] : 1;
        if (!xj) continue;
        const sxj = s * xj;
        const Hj = H[j];
        Hj[0] += sxj;
        for (let k = 1; k <= j; k++) Hj[k] += sxj * x[k - 1];
      }
    }
    for (let j = 1; j < p; j++) {
      g[j] -= lambda * w[j];
      H[j][j] += lambda;
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[k][j] = H[j][k];
    const step = solve(H, g);
    let change = 0;
    for (let j = 0; j < p; j++) {
      w[j] += step[j];
      change = Math.max(change, Math.abs(step[j]));
    }
    if (change < 1e-7) break;
  }
  return { type: 'logistic', weights: Array.from(w) };
}

/** Risolve H x = g con la fattorizzazione di Cholesky (H simmetrica definita positiva). */
function solve(H, g) {
  const p = g.length,
    L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++)
    for (let j = 0; j <= i; j++) {
      let s = H[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = g[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
    z[i] = s / L[i][i];
  }
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < p; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function predictLogistic(model, x) {
  const w = model.weights;
  let z = w[0];
  for (let j = 1; j < w.length; j++) z += w[j] * x[j - 1];
  return sigmoid(z);
}

// ---------------------------------------------------------------- metriche

const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
function metrics(y, p) {
  if (!y.length || y.length !== p.length || !p.every(Number.isFinite))
    throw new Error('Valori non validi nel calcolo delle metriche.');
  let brier = 0,
    logloss = 0,
    correct = 0;
  for (let i = 0; i < y.length; i++) {
    brier += (p[i] - y[i]) ** 2;
    logloss -= y[i] * Math.log(clip(p[i])) + (1 - y[i]) * Math.log(1 - clip(p[i]));
    correct += p[i] > 0.5 === (y[i] === 1);
  }
  return { brier: brier / y.length, logloss: logloss / y.length, accuracy: correct / y.length };
}

/** Calibrazione: le partite si raggruppano per probabilità prevista e si confronta con la frequenza reale. */
function calibration(y, p, edges = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1]) {
  return edges.slice(0, -1).map((lo, k) => {
    const hi = edges[k + 1];
    let n = 0,
      sp = 0,
      sy = 0;
    for (let i = 0; i < y.length; i++)
      if (p[i] >= lo && (p[i] < hi || (k === edges.length - 2 && p[i] <= hi))) {
        n++;
        sp += p[i];
        sy += y[i];
      }
    return { from: lo, to: hi, n, predicted: n ? sp / n : null, observed: n ? sy / n : null };
  });
}

module.exports = {
  rng,
  trainTree,
  predictTree,
  countLeaves,
  fitTree,
  fitForest,
  fitLogistic,
  predictLogistic,
  sigmoid,
  solve,
  metrics,
  calibration,
};
