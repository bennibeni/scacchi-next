const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Interpreti Python da provare in ordine: su Windows spesso esiste solo il launcher «py».
const PYTHONS = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
const TIMEOUT_MS = 25 * 60 * 1000; // un download completo (senza CSV di base) richiede diversi minuti

function runPython(cmd, args, cwd, onLine, onSpawn) {
  return new Promise((resolve) => {
    let stderr = '',
      pending = '',
      done = false;
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const finish = (value) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: -1, stderr: 'Tempo massimo di 25 minuti raggiunto.' });
    }, TIMEOUT_MS);
    child.once('spawn', () => onSpawn(child.pid));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
      pending += d;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onLine(line);
    });
    child.once('error', (error) =>
      finish({ code: error.code === 'ENOENT' ? 'ENOENT' : -1, stderr: error.message }),
    );
    child.once('exit', (code) => finish({ code, stderr }));
  });
}

/**
 * Esegue scripts/estrai_partite.py su un file temporaneo e, solo se riesce,
 * lo sostituisce a data/partite.csv. Se il CSV esiste lo usa come base (aggiornamento
 * incrementale: pochi secondi), altrimenti scarica tutto lo storico.
 */
async function updateData(
  root,
  { pythons = PYTHONS, onProgress = () => {}, onChild = () => {} } = {},
) {
  const data = path.join(root, 'data'),
    csv = path.join(data, 'partite.csv');
  const tmp = path.join(data, 'partite.nuovo.csv'),
    tmpCols = path.join(data, 'partite.nuovo.colonne.md');
  const count = async (file) => {
    try {
      return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).length - 1;
    } catch {
      return 0;
    }
  };
  const before = await count(csv);
  await fs.mkdir(data, { recursive: true });
  const args = [
    path.join('scripts', 'estrai_partite.py'),
    '--out',
    tmp,
    '--cache',
    path.join('data', 'archivi'),
  ];
  if (before > 0) args.push('--base', csv);
  const onLine = (line) => {
    const m = line.match(/^PROGRESSO (\d+)\/(\d+) (\S+)/);
    if (m)
      onProgress({ done: Number(m[1]), total: Number(m[2]), month: m[3], incremental: before > 0 });
  };
  let result;
  for (const cmd of pythons) {
    result = await runPython(cmd, args, root, onLine, onChild);
    if (result.code !== 'ENOENT') break;
  }
  const cleanup = async () => {
    await fs.rm(tmp, { force: true });
    await fs.rm(tmpCols, { force: true });
  };
  if (result.code === 'ENOENT')
    throw new Error(
      'Python non trovato. Installa Python 3.9 o successivo (su Windows anche il launcher «py»), poi riprova.',
    );
  if (result.code !== 0) {
    await cleanup();
    // 9009: su Windows «python» è solo il collegamento al Microsoft Store, non un vero interprete.
    if (result.code === 9009)
      throw new Error(
        'Python non trovato: «python» apre solo il Microsoft Store. Installa Python 3.9+ oppure usa il launcher «py».',
      );
    const last =
      result.stderr
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('PROGRESSO'))
        .pop() || 'errore sconosciuto';
    throw new Error(`Aggiornamento non riuscito: ${last}`);
  }
  const after = await count(tmp);
  if (after < 1) {
    await cleanup();
    throw new Error('Aggiornamento non riuscito: il nuovo CSV è vuoto.');
  }
  await fs.rename(tmp, csv);
  await fs.rename(tmpCols, path.join(data, 'partite.colonne.md')).catch(() => {});
  return { before, after, added: after - before, incremental: before > 0 };
}

module.exports = { updateData, PYTHONS };
