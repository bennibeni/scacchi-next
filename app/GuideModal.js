'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { leggiGuida } from './actions';

const STORAGE_KEY = 'scacchi-guida-ultima-pagina';
export function lastGuidePage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function rememberPage(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* archiviazione non disponibile: si ignora */
  }
}

// I link esterni si aprono in una nuova scheda per non perdere lo stato dell'esperimento.
const markdownComponents = {
  a: ({ href = '', children }) =>
    /^https?:\/\//.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span aria-hidden="true"> ↗</span>
        <span className="srOnly"> (si apre in una nuova scheda)</span>
      </a>
    ) : (
      <a href={href}>{children}</a>
    ),
  table: ({ children }) => (
    <div className="mdTable" tabIndex={0} role="region" aria-label="Tabella scorrevole">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
};

/** Pulsante "?" che apre la guida alla pagina indicata. */
export function Help({ page, label, onOpen }) {
  return (
    <button
      type="button"
      className="help"
      aria-label={`Guida: ${label}`}
      title={`Guida: ${label}`}
      onClick={(e) => onOpen(page, e.currentTarget)}
    >
      ?
    </button>
  );
}

/**
 * Modale della guida. `pageId` null = chiusa.
 * Aprire o chiudere la guida non tocca lo stato dell'esperimento (modello, campi, risultati).
 */
export default function GuideModal({ pageId, opener, onNavigate, onClose }) {
  const dialogRef = useRef(null),
    headingRef = useRef(null),
    indexRef = useRef(null),
    scrollRef = useRef(null);
  const [guide, setGuide] = useState(null),
    [error, setError] = useState('');
  const [showIndex, setShowIndex] = useState(false);
  const open = pageId !== null;

  // Caricamento pigro: il Markdown arriva dal server solo alla prima apertura.
  useEffect(() => {
    if (!open || guide) return;
    let cancelled = false;
    leggiGuida()
      .then((res) => {
        if (cancelled) return;
        if (res.success) setGuide(res.guide);
        else setError(res.error);
      })
      .catch(() => {
        if (!cancelled) setError('Impossibile caricare la guida. Riprova.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, guide]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setShowIndex(false);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Chiusura (Escape, pulsante, clic sullo sfondo): ripristina il focus sul comando che l'ha aperta.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      onClose();
      if (opener && opener.isConnected) opener.focus();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [opener, onClose]);

  const pages = guide?.pages ?? [];
  const index = Math.max(
    0,
    pages.findIndex((p) => p.id === pageId),
  );
  const page = pages[index];

  // Cambio pagina: torna in cima, sposta il focus sul titolo e ricorda la pagina letta.
  useEffect(() => {
    if (!open || !page || showIndex) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
    rememberPage(page.id);
  }, [open, page, showIndex]);

  useEffect(() => {
    if (!showIndex) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    indexRef.current?.focus({ preventScroll: true });
  }, [showIndex]);

  const go = (id) => {
    setShowIndex(false);
    onNavigate(id);
  };
  const prev = pages[index - 1],
    next = pages[index + 1];

  return (
    <dialog
      ref={dialogRef}
      className="guide"
      aria-labelledby="guide-title"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <div className="guideFrame">
        <div className="guideHead">
          <div>
            <div className="eyebrow" id="guide-title">
              GUIDA AL LABORATORIO
            </div>
            {page && (
              <span className="guideCount">
                Pagina {page.number} di {pages.length}
              </span>
            )}
          </div>
          <button
            type="button"
            className="guideClose"
            onClick={() => dialogRef.current.close()}
            aria-label="Chiudi la guida"
          >
            ✕
          </button>
        </div>
        {guide && (
          <nav className="guideNav" aria-label="Sezioni della guida">
            <button
              type="button"
              className={showIndex ? 'chip on' : 'chip'}
              aria-pressed={showIndex}
              onClick={() => setShowIndex((v) => !v)}
            >
              ☰ Indice
            </button>
            {guide.shortcuts.map((s) => (
              <button type="button" key={s.id} className="chip" onClick={() => go(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <div className="guideBody" ref={scrollRef}>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!guide && !error && (
            <div className="status">
              <span className="spinner" />
              Caricamento della guida…
            </div>
          )}
          {guide && showIndex && (
            <div className="guideIndex">
              <h2 tabIndex={-1} ref={indexRef}>
                Indice
              </h2>
              {guide.chapters.map((c) => (
                <section key={c.title}>
                  <h3>{c.title}</h3>
                  <ol>
                    {c.pages.map((p) => (
                      <li key={p.id} value={p.number}>
                        <button
                          type="button"
                          className="link"
                          aria-current={p.id === page?.id ? 'page' : undefined}
                          onClick={() => go(p.id)}
                        >
                          {p.title}
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
          {page && !showIndex && (
            <article className="md">
              <div className="eyebrow">PAGINA {String(page.number).padStart(2, '0')}</div>
              <h2 ref={headingRef} tabIndex={-1}>
                {page.title}
              </h2>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {page.body}
              </ReactMarkdown>
            </article>
          )}
        </div>
        {page && !showIndex && (
          <div className="guideFoot">
            <button
              type="button"
              className="secondary"
              disabled={!prev}
              onClick={() => go(prev.id)}
            >
              ← {prev ? 'Indietro' : 'Inizio'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!next}
              onClick={() => go(next.id)}
            >
              {next ? 'Avanti' : 'Fine'} →
            </button>
          </div>
        )}
        <div className="srOnly" aria-live="polite">
          {page && !showIndex ? `Pagina ${page.number} di ${pages.length}: ${page.title}` : ''}
        </div>
      </div>
    </dialog>
  );
}
