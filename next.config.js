// I file letti con fs a runtime non vengono tracciati automaticamente da Next.js:
// senza questa dichiarazione mancherebbero nel deploy su Vercel.
module.exports = {
  turbopack: { root: __dirname },
  serverExternalPackages: ['csv-parse'],
  outputFileTracingIncludes: {
    '/': ['./data/partite.csv', './docs/guida-completa.md', './vetrina/*.json'],
  },
};
