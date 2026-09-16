'use client';

/**
 * Last-resort error boundary: replaces the root layout when the layout itself throws,
 * so it cannot use the i18n provider, the site chrome or globals.css. Bilingual on purpose.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="hu">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#fbf6ec',
          color: '#2a2118',
          fontFamily: 'Georgia, "Times New Roman", serif',
          padding: '24px',
        }}
      >
        <main style={{ maxWidth: 460, textAlign: 'center' }}>
          <p style={{ fontSize: 48, margin: 0 }} aria-hidden="true">
            📚
          </p>
          <h1 style={{ fontSize: 26, margin: '12px 0 8px' }}>Hiba történt · Something went wrong</h1>
          <p style={{ margin: '0 0 20px', lineHeight: 1.5, fontFamily: 'system-ui, sans-serif', fontSize: 15 }}>
            Az oldalt most nem sikerült betölteni. Próbáld újra egy pillanat múlva.
            <br />
            The page could not be loaded. Please try again in a moment.
          </p>
          {error.digest ? (
            <p style={{ margin: '0 0 20px', fontFamily: 'ui-monospace, monospace', fontSize: 12, opacity: 0.7 }}>
              {error.digest}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#1f4d3a',
                color: '#fbf6ec',
                border: 0,
                borderRadius: 999,
                padding: '10px 20px',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Újra · Retry
            </button>
            <a
              href="/"
              style={{
                color: '#1f4d3a',
                border: '1px solid #1f4d3a',
                borderRadius: 999,
                padding: '10px 20px',
                fontSize: 15,
                textDecoration: 'none',
              }}
            >
              Főoldal · Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
