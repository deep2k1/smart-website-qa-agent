import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CATEGORIES, SEVERITIES, type Category, type Finding, type ScanMode, type ScanReport, type Severity } from '../../shared/types';
import { exportUrl, getScan, startScan } from './api';

export default function App() {
  const [url, setUrl] = useState('https://example.com');
  const [mode, setMode] = useState<ScanMode>('full');
  const [maxPages, setMaxPages] = useState(20);
  const [browserChecks, setBrowserChecks] = useState(true);
  const [scanId, setScanId] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sev, setSev] = useState<Severity | 'all'>('all');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Finding | null>(null);
  const [tab, setTab] = useState<'findings' | 'pages'>('findings');

  const active = report?.status === 'queued' || report?.status === 'running';

  useEffect(() => {
    if (!scanId) return;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      try {
        const r = await getScan(scanId);
        if (stopped) return;
        failures = 0;
        setReport(r);
        if (r.status === 'completed' || r.status === 'failed') return;
      } catch (e) {
        if (++failures >= 3) { setError(e instanceof Error ? e.message : 'Lost connection to the server.'); return; }
      }
      if (!stopped) setTimeout(tick, 1000);
    };
    void tick();
    return () => { stopped = true; };
  }, [scanId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setReport(null); setSelected(null); setSubmitting(true);
    try {
      const { id } = await startScan({ url: url.trim(), mode, maxPages, browserChecks });
      setScanId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan.');
    } finally {
      setSubmitting(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.findings ?? []).filter((f) =>
      (sev === 'all' || f.severity === sev) && (cat === 'all' || f.category === cat) &&
      (!q || `${f.title} ${f.url} ${f.evidence} ${f.id}`.toLowerCase().includes(q)));
  }, [report, sev, cat, query]);

  const p = report?.progress;
  const pct = !report ? 0 : report.status === 'completed' ? 100 : p && p.pagesDiscovered ? Math.min(95, Math.round((p.pagesScanned / Math.max(p.pagesDiscovered, 1)) * 70 + (p.linksTotal ? (p.linksChecked / p.linksTotal) * 25 : 0))) : 5;

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Smart Website QA Agent</h1>
        <p>Point it at a site. It reports what is broken, with the evidence.</p>
      </header>

      <form className="panel scan-form" onSubmit={submit} aria-label="Start a scan">
        <label className="field grow">
          <span>Website URL</span>
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
        </label>
        <fieldset className="field">
          <legend>Scope</legend>
          <label className="radio"><input type="radio" name="mode" checked={mode === 'full'} onChange={() => setMode('full')} /> Full website</label>
          <label className="radio"><input type="radio" name="mode" checked={mode === 'single'} onChange={() => setMode('single')} /> Single page only</label>
        </fieldset>
        <label className="field narrow">
          <span>Max pages</span>
          <input type="number" min={1} max={50} value={mode === 'single' ? 1 : maxPages} disabled={mode === 'single'} onChange={(e) => setMaxPages(Number(e.target.value) || 1)} />
        </label>
        <label className="radio check"><input type="checkbox" checked={browserChecks} onChange={(e) => setBrowserChecks(e.target.checked)} /> Browser checks</label>
        <button className="primary" disabled={submitting || active}>{submitting ? 'Starting…' : active ? 'Scanning…' : 'Run scan'}</button>
      </form>

      {error && <div className="banner error" role="alert">{error}</div>}

      {report && (
        <>
          <section className="panel progress" aria-live="polite">
            <div className="row">
              <strong>{report.status === 'failed' ? 'Scan failed' : report.status === 'completed' ? 'Scan complete' : 'Scanning'}</strong>
              <span className="muted">{p?.phase} · {report.pages.length} page(s) · {p?.linksChecked}/{p?.linksTotal} links checked · {report.request.mode} mode</span>
              <a className={`btn ${report.status === 'queued' ? 'disabled' : ''}`} href={exportUrl(report.id)} download>Export JSON</a>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
            {report.error && <div className="banner error">{report.error}</div>}
            {report.notes.map((n) => <div key={n} className="banner note">{n}</div>)}
          </section>

          <section className="counts" aria-label="Issue counts">
            {SEVERITIES.map((s) => (
              <button key={s} className={`count sev-${s} ${sev === s ? 'on' : ''}`} onClick={() => setSev(sev === s ? 'all' : s)}>
                <b>{report.counts.bySeverity[s]}</b><span>{s}</span>
              </button>
            ))}
          </section>

          {report.ai && (
            <section className="panel ai">
              <h2>Summary <small>{report.ai.provider === 'anthropic' ? `AI (${report.ai.model})` : 'rule-based fallback'}</small></h2>
              <p>{report.ai.summary}</p>
              {report.ai.priorities.length > 0 && (
                <ol>{report.ai.priorities.map((x) => {
                  const f = report.findings.find((ff) => ff.id === x.findingId);
                  return <li key={x.findingId}><button className="link" onClick={() => { setTab('findings'); setSelected(f ?? null); }}>{x.findingId}</button> {f?.title}: {x.reason}</li>;
                })}</ol>
              )}
              <p className="muted small">{report.ai.disclaimer}</p>
            </section>
          )}

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'findings'} onClick={() => setTab('findings')}>Findings ({visible.length})</button>
            <button role="tab" aria-selected={tab === 'pages'} onClick={() => setTab('pages')}>Pages ({report.pages.length})</button>
          </div>

          {tab === 'findings' ? (
            <section className="split">
              <div className="panel list">
                <div className="filters">
                  <select aria-label="Filter by severity" value={sev} onChange={(e) => setSev(e.target.value as Severity | 'all')}>
                    <option value="all">All severities</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value as Category | 'all')}>
                    <option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input aria-label="Search findings" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                {visible.length === 0 && <p className="empty">{report.status === 'completed' ? (report.findings.length ? 'No findings match these filters.' : 'No issues found by the implemented checks.') : 'Findings will appear when the scan completes.'}</p>}
                <ul>
                  {visible.map((f) => (
                    <li key={f.id}>
                      <button className={`item ${selected?.id === f.id ? 'on' : ''}`} onClick={() => setSelected(f)}>
                        <span className={`pill sev-${f.severity}`}>{f.severity}</span>
                        <span className="t">{f.title}</span>
                        <span className="muted small">{f.id} · {f.category} · {f.url}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <aside className="panel detail" aria-live="polite">
                {selected ? (
                  <>
                    <span className={`pill sev-${selected.severity}`}>{selected.severity}</span> <span className="muted">{selected.id} · {selected.category}</span>
                    <h3>{selected.title}</h3>
                    <dl>
                      <dt>Affected URL</dt><dd><a href={selected.url} target="_blank" rel="noreferrer noopener">{selected.url}</a></dd>
                      <dt>Evidence</dt><dd><pre>{selected.evidence}</pre></dd>
                      <dt>Recommendation</dt><dd>{selected.recommendation}</dd>
                    </dl>
                  </>
                ) : <p className="empty">Select a finding to see its evidence and recommendation.</p>}
              </aside>
            </section>
          ) : (
            <section className="panel table-wrap">
              <table>
                <thead><tr><th>URL</th><th>Status</th><th>Found via</th><th>Title</th><th>CTAs</th></tr></thead>
                <tbody>{report.pages.map((pg) => (
                  <tr key={pg.url}>
                    <td className="break">{pg.url}</td><td>{pg.status || 'no response'}</td><td>{pg.source}</td><td>{pg.title ?? '—'}</td>
                    <td>{pg.ctas.length ? pg.ctas.map((c) => `${c.text} → ${c.href ?? 'none'}`).join('; ') : '—'}</td>
                  </tr>))}</tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
