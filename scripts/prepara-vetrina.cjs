// Addestra i modelli dimostrativi e li copia in vetrina/, la cartella pubblicata su Vercel.
// Uso: npm run vetrina   (dopo aver aggiornato i dati con «Aggiorna dati» o npm run dati)
process.env.SCACCHI_SOLA_LETTURA = '0';
const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../lib/core.cjs');

const CONFIGS = [
  { period: 'tutto', trees: 100, depth: 6 },
  { period: 'dal2023', trees: 100, depth: 6 },
];

(async () => {
  const root = path.join(__dirname, '..'),
    out = path.join(root, 'vetrina');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  for (const config of CONFIGS) {
    process.stdout.write(`Addestramento ${JSON.stringify(config)}… `);
    const meta = await core.run(root, config);
    for (const file of [core.modelPath(root, meta.id), core.metaPath(root, meta.id)])
      await fs.copyFile(file, path.join(out, path.basename(file)));
    console.log(
      `${core.NAMES[meta.kind]} · Brier test ${meta.test.brier.toFixed(4)} (Elo ${meta.eloTest.brier.toFixed(4)})`,
    );
  }
  console.log(
    `Modelli dimostrativi in ${path.relative(process.cwd(), out) || out}/ — fai commit della cartella e ripubblica.`,
  );
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
