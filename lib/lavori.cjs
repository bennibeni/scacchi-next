// Un solo lavoro pesante alla volta (addestramento o aggiornamento dati), coordinato da un file di lock.
// Il lock contiene chi lo possiede (PID del server e del processo figlio), quando è iniziato e l'avanzamento.
// Se il server che l'ha creato non esiste più (arresto, riavvio, crash) il lock è ABBANDONATO:
// viene rimosso da solo e l'eventuale processo figlio orfano viene terminato.
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_AGE_MS = { dati: 30 * 60 * 1000, addestramento: 15 * 60 * 1000 };
const LABELS = { dati: 'Aggiornamento dei dati', addestramento: 'Addestramento' };
const lockPath = root => path.join(root, 'models', '.training.lock');
const lastPath = root => path.join(root, 'models', '.ultimo-lavoro.json');

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function writeAtomic(file, data) { await fs.writeFile(`${file}.tmp`, data); await fs.rename(`${file}.tmp`, file); }

/** Legge il lock; restituisce null se non esiste. */
async function readLock(root) {
  let text, stat;
  try { [text, stat] = await Promise.all([fs.readFile(lockPath(root), 'utf8'), fs.stat(lockPath(root))]); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return { ...JSON.parse(text), mtime: stat.mtimeMs }; } catch { return { invalid: true, mtime: stat.mtimeMs }; }
}

/** Motivo per cui il lock è abbandonato, oppure null se il lavoro è davvero in corso. */
function staleReason(info, now = Date.now()) {
  // Lock vuoto o illeggibile: lasciato da una versione precedente dell'app o da una scrittura interrotta.
  if (info.invalid) return now - info.mtime > 15000 ? 'lock senza informazioni' : null;
  if (info.serverPid !== process.pid && !alive(info.serverPid)) return 'il server che l’aveva avviato non è più attivo';
  if (now - Date.parse(info.startedAt) > (MAX_AGE_MS[info.kind] ?? MAX_AGE_MS.dati)) return 'durata massima superata';
  return null;
}

async function clearStale(root) {
  const info = await readLock(root);
  if (!info) return null;
  const reason = staleReason(info);
  if (!reason) return info;
  if (!info.invalid && info.childPid && alive(info.childPid)) { try { process.kill(info.childPid); } catch { /* già terminato */ } }
  await fs.unlink(lockPath(root)).catch(() => {});
  if (!info.invalid) await finish(root, info.kind, false, `${LABELS[info.kind] ?? 'Lavoro'} interrotto (${reason}). Puoi riavviarlo.`, null, info.startedAt);
  return null;
}

class BusyError extends Error {}

/** Acquisisce il lock o lancia BusyError con un messaggio che dice chi lo tiene e da quando. */
async function acquire(root, kind) {
  await fs.mkdir(path.join(root, 'models'), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await clearStale(root);
    if (info) {
      const since = info.invalid ? '' : ` dalle ${new Date(info.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}`;
      throw new BusyError(`${LABELS[info.kind] ?? 'Un lavoro'} è già in corso${since}. Attendi il completamento.`);
    }
    try {
      const handle = await fs.open(lockPath(root), 'wx');
      const lock = { kind, serverPid: process.pid, childPid: null, startedAt: new Date().toISOString(), progress: null };
      await handle.writeFile(JSON.stringify(lock)); await handle.close();
      return lock;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }   // un'altra richiesta è arrivata prima: si riprova una volta
  }
  throw new BusyError('Un lavoro è già in corso. Attendi il completamento.');
}

/** Aggiorna PID del figlio e/o avanzamento, solo se il lock è ancora di questo lavoro. */
async function update(root, lock, patch) {
  Object.assign(lock, patch);
  const current = await readLock(root).catch(() => null);
  if (!current || current.startedAt !== lock.startedAt) return;
  await writeAtomic(lockPath(root), JSON.stringify(lock)).catch(() => {});
}

async function release(root, lock) {
  const current = await readLock(root).catch(() => null);
  if (current && current.startedAt === lock.startedAt) await fs.unlink(lockPath(root)).catch(() => {});
}

async function finish(root, kind, ok, message, detail = null, startedAt = null) {
  await writeAtomic(lastPath(root), JSON.stringify({ kind, ok, message, detail, startedAt, finishedAt: new Date().toISOString() })).catch(() => {});
}

/** Stato per l'interfaccia: lavoro in corso (con avanzamento) ed esito dell'ultimo lavoro concluso. */
async function status(root) {
  const info = await clearStale(root);
  let last = null;
  try { last = JSON.parse(await fs.readFile(lastPath(root), 'utf8')); } catch { /* nessun lavoro concluso */ }
  const running = info && !info.invalid ? { kind: info.kind, label: LABELS[info.kind], startedAt: info.startedAt, progress: info.progress } : info ? { kind: null, label: 'Un lavoro', startedAt: null, progress: null } : null;
  return { running, last };
}

module.exports = { acquire, update, release, finish, status, staleReason, alive, BusyError, lockPath, lastPath };
