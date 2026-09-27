'use server';
import path from 'node:path';
import { spawn } from 'node:child_process';
import core from '../lib/core.cjs';
import guide from '../lib/guide.cjs';
import aggiorna from '../lib/aggiorna.cjs';
import lavori from '../lib/lavori.cjs';

const root = () => process.cwd();
const READ_ONLY = 'Versione dimostrativa in sola lettura: addestramento e aggiornamento dei dati sono disponibili solo eseguendo l’app sul proprio computer.';
const failure = error => ({ success: false, error: error.code === 'ENOENT' ? 'File non trovato. Controlla data/partite.csv oppure aggiorna l’archivio dei modelli.' : error.message });

/**
 * Avvia l'addestramento IN BACKGROUND e risponde subito (come l'aggiornamento dei dati).
 * Next.js esegue le Server Action di una pagina una alla volta: se questa restasse in attesa
 * per 30 secondi, anche le richieste di stato resterebbero in coda e l'avanzamento non si vedrebbe.
 * A fine lavoro l'esito (con l'id del modello salvato) è letto da statoLavori().
 */
export async function avviaAddestramento(input) {
  if (core.readOnly()) return { success: false, error: READ_ONLY };
  try {
    const config = core.options(input);
    const lock = await lavori.acquire(root(), 'addestramento');
    (async () => {
      let result;
      try {
        result = await new Promise(resolve => {
          const child = spawn(process.execPath, [path.join(root(), 'lib', 'train-worker.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
          lavori.update(root(), lock, { childPid: child.pid });
          let settled = false;
          const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
          const timer = setTimeout(() => { child.kill(); finish({ success: false, error: 'Tempo massimo di 10 minuti raggiunto.' }); }, 10 * 60 * 1000);
          child.on('message', message => { if (message.progress) lavori.update(root(), lock, { progress: { label: message.progress } }); else finish(message); });
          child.once('error', error => finish(failure(error)));
          child.once('exit', () => finish({ success: false, error: 'Il processo di addestramento si è interrotto.' }));
          child.send({ root: root(), config });
        });
      } catch (error) { result = failure(error); }
      await lavori.finish(root(), 'addestramento', result.success, result.success ? 'Addestramento completato.' : result.error, result.success ? { id: result.result.id } : null, lock.startedAt);
      await lavori.release(root(), lock);
    })();
    return { success: true, startedAt: lock.startedAt };
  } catch (error) { return failure(error); }
}

/**
 * Avvia l'aggiornamento dei dati IN BACKGROUND e risponde subito.
 * L'interfaccia ne segue l'avanzamento con statoLavori(): ricaricare la pagina non lo interrompe.
 */
export async function avviaAggiornamento() {
  if (core.readOnly()) return { success: false, error: READ_ONLY };
  try {
    const lock = await lavori.acquire(root(), 'dati');
    (async () => {
      try {
        const u = await aggiorna.updateData(root(), {
          onChild: pid => lavori.update(root(), lock, { childPid: pid }),
          onProgress: p => lavori.update(root(), lock, { progress: p }),
        });
        const message = u.before === 0 ? `Dati scaricati: ${u.after.toLocaleString('it-IT')} partite.` : u.added > 0 ? `Dati aggiornati: ${u.added.toLocaleString('it-IT')} ${u.added === 1 ? 'partita nuova' : 'partite nuove'}. I modelli già salvati non cambiano: addestrane uno nuovo per includerle.`
          : u.added === 0 ? 'Dati già aggiornati: nessuna partita nuova.' : `Dati riscritti: ${u.after.toLocaleString('it-IT')} partite.`;
        await lavori.finish(root(), 'dati', true, message, u, lock.startedAt);
      } catch (error) {
        await lavori.finish(root(), 'dati', false, error.message, null, lock.startedAt);
      } finally { await lavori.release(root(), lock); }
    })();
    return { success: true, startedAt: lock.startedAt };
  } catch (error) { return failure(error); }
}

/** Modalità dell'app, letta dall'interfaccia all'avvio. */
export async function modalita() {
  return { readOnly: core.readOnly() };
}

export async function statoLavori() {
  if (core.readOnly()) return { success: true, running: null, last: null };
  try { return { success: true, ...(await lavori.status(root())) }; } catch (error) { return failure(error); }
}

export async function riepilogoDati() {
  // CSV assente: non è un errore, la striscia invita a premere «Aggiorna dati».
  try { return { success: true, data: await core.dataset(root()) }; }
  catch (error) {
    console.error('[scacchi] riepilogo dei dati:', error.code ?? '', error.message);   // visibile nei log di Vercel
    return error.code === 'ENOENT' ? { success: true, data: null } : failure(error);
  }
}

export async function elencaModelli() {
  try { const { models, skipped } = await core.list(root()); return { success: true, models, skipped }; } catch (error) { return failure(error); }
}

export async function caricaModello(id) {
  try { return { success: true, result: core.summary(await core.read(root(), id)) }; } catch (error) { return failure(error); }
}

export async function prevedi(id, valori) {
  try {
    const bundle = await core.read(root(), id);
    const row = core.house(valori, bundle);
    const result = core.explore(bundle, row);
    if (!Number.isFinite(result.probability)) throw new Error('Previsione non valida.');
    return { success: true, ...result, modelId: id };
  } catch (error) { return failure(error); }
}

export async function leggiGuida() {
  try { return { success: true, guide: await guide.loadGuide(root()) }; }
  catch (error) { return { success: false, error: error.code === 'ENOENT' ? 'File docs/guida-completa.md non trovato.' : error.message }; }
}
