const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Divide il Markdown della guida nelle pagine della modale.
 * <!-- capitolo: Titolo | Etichetta breve -->  apre un capitolo (l'etichetta diventa un accesso rapido)
 * <!-- page:id -->                             apre una pagina, che termina al marcatore successivo
 *                                              o a una riga orizzontale "---"
 */
function parseGuide(markdown) {
  const text = markdown.replace(/\r\n?/g, '\n');
  const marker =
    /^<!--\s*(page:([a-z0-9-]+)|capitolo:\s*([^|>]+?)\s*(?:\|\s*([^>]+?)\s*)?)\s*-->\s*$/gm;
  const marks = [...text.matchAll(marker)];
  const pages = [],
    chapters = [];
  marks.forEach((m, i) => {
    if (m[3]) {
      chapters.push({ title: m[3], short: m[4] || m[3], pages: [] });
      return;
    }
    if (!chapters.length) throw new Error('La prima pagina deve trovarsi dentro un capitolo.');
    const start = m.index + m[0].length,
      end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    let body = text.slice(start, end);
    const rule = body.search(/^---\s*$/m);
    if (rule !== -1) body = body.slice(0, rule);
    body = body.trim();
    const heading = body.match(/^##\s+Pagina\s+(\d+)\s+[—–-]\s+(.+)$/m);
    if (!heading) throw new Error(`Pagina "${m[2]}" senza intestazione "## Pagina NN — Titolo".`);
    const page = {
      id: m[2],
      number: Number(heading[1]),
      title: heading[2].trim(),
      body: body.slice(heading.index + heading[0].length).trim(),
    };
    pages.push(page);
    chapters[chapters.length - 1].pages.push({
      id: page.id,
      number: page.number,
      title: page.title,
    });
  });
  if (new Set(pages.map((p) => p.id)).size !== pages.length)
    throw new Error('ID di pagina duplicati nella guida.');
  pages.forEach((p, i) => {
    if (p.number !== i + 1) throw new Error(`Numerazione non sequenziale alla pagina "${p.id}".`);
  });
  return { pages, chapters: chapters.filter((c) => c.pages.length) };
}

async function loadGuide(root) {
  const { pages, chapters } = parseGuide(
    await fs.readFile(path.join(root, 'docs', 'guida-completa.md'), 'utf8'),
  );
  return {
    pages,
    chapters: chapters.map(({ title, pages }) => ({ title, pages })),
    shortcuts: chapters.map((c) => ({ label: c.short, id: c.pages[0].id })),
  };
}

module.exports = { parseGuide, loadGuide };
