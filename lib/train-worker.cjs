const { run } = require('./core.cjs');
process.once('message', async ({ root, config }) => {
  try {
    const result = await run(root, config, (message) => process.send({ progress: message }));
    process.send({ success: true, result }, () => process.exit(0));
  } catch (error) {
    process.send(
      {
        success: false,
        error:
          error.code === 'ENOENT'
            ? 'File data/partite.csv non trovato: esegui prima «npm run dati».'
            : error.message,
      },
      () => process.exit(1),
    );
  }
});
