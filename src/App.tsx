import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  CalendarClock, FolderOpen, ScanSearch, SlidersHorizontal, ListFilter,
  AlertTriangle, History, Sun, Moon, Plus, Save, Trash2, Pencil,
  Eye, Play, Download, RotateCcw, X, ShieldCheck, LoaderCircle, Search,
  Languages,
} from 'lucide-react';
import { translate, ruleTitle, message as localizeError, type Locale } from './i18n';
import './styles.css';

type Rule = {
  id: string; name: string; precision: number; source: string;
  pattern: string; format: string; priority: number; enabled: boolean;
};
type Candidate = {
  ruleId: string; ruleName: string; source: string; precision: number;
  priority: number; date: string; epoch: number | null;
};
type FileRow = {
  id: number; path: string; name: string; size: number; original: string;
  status: string; selected: Candidate | null; candidates: Candidate[];
  warning: string | null; refinedFromMtime: boolean;
};
type Settings = { preservePreciseMtime: boolean; overwriteExistingExif: boolean; parallelWorkers: number };
type Summary = { total: number; matched: number; conflict: number; unmatched: number; errors: number; cancelled: boolean };
type Page = { rows: FileRow[]; total: number };
type ResultCounts = {
  all: number; second: number; minute: number; hour: number;
  day: number; unmatched: number; conflict: number; invalid: number;
};
type Journal = { id: string; status: string; items: { status: string; error: string | null }[] };
type OpResult = { id: string; succeeded: number; failed: number; skipped: number };
type ResultGroup = 'all' | 'second' | 'minute' | 'hour' | 'day' | 'unmatched' | 'conflict';

const emptySummary: Summary = { total: 0, matched: 0, conflict: 0, unmatched: 0, errors: 0, cancelled: false };
const emptyCounts: ResultCounts = { all: 0, second: 0, minute: 0, hour: 0, day: 0, unmatched: 0, conflict: 0, invalid: 0 };
const initialSettings: Settings = { preservePreciseMtime: true, overwriteExistingExif: false, parallelWorkers: 4 };
const navigation = [
  { id: 'scan', label: 'Scan workspace', icon: ScanSearch },
  { id: 'rules', label: 'Matching rules', icon: SlidersHorizontal },
  { id: 'results', label: 'Results', icon: ListFilter },
  { id: 'history', label: 'History & undo', icon: History },
] as const;
type Tab = typeof navigation[number]['id'];
const groups: { key: ResultGroup; label: string; precision: number | null; status: string }[] = [
  { key: 'all', label: 'All files', precision: null, status: 'all' },
  { key: 'second', label: 'Second', precision: 4, status: 'all' },
  { key: 'minute', label: 'Minute', precision: 3, status: 'all' },
  { key: 'hour', label: 'Hour', precision: 2, status: 'all' },
  { key: 'day', label: 'Day', precision: 1, status: 'all' },
  { key: 'unmatched', label: 'Unmatched', precision: null, status: 'unmatched' },
  { key: 'conflict', label: 'Conflicts', precision: null, status: 'conflict' },
];
const precisionName: Record<number, string> = { 4: 'Second', 3: 'Minute', 2: 'Hour', 1: 'Day' };
const statusName: Record<string, string> = {
  all: 'All statuses', matched: 'Matched', unmatched: 'Unmatched',
  conflict: 'Conflict', invalid: 'Invalid date',
};
const shortError = (error: unknown) => error instanceof Error ? error.message : String(error);
const newRule = (): Rule => ({
  id: crypto.randomUUID(), name: 'New rule', precision: 4,
  source: 'filename', pattern: '(?P<date>\\d{8}_\\d{6})',
  format: '%Y%m%d_%H%M%S', priority: 100, enabled: true,
});

function NumberText({ number, locale }: { number: number; locale: Locale }) {
  return <>{number.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</>;
}
function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}
function Stat({ icon, label, count, locale }: { icon: React.ReactNode; label: string; count: number; locale: Locale }) {
  return <div className="stat"><span className="stat-icon">{icon}</span><b><NumberText number={count} locale={locale}/></b><small>{label}</small></div>;
}
function Statistics({ s, locale }: { s: Summary; locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  return <div className="stats">
    <Stat icon={<FolderOpen/>} count={s.total} label={t('Files scanned')} locale={locale}/>
    <Stat icon={<ScanSearch/>} count={s.matched} label={t('Matched')} locale={locale}/>
    <Stat icon={<AlertTriangle/>} count={s.unmatched} label={t('Unmatched')} locale={locale}/>
    <Stat icon={<ListFilter/>} count={s.conflict} label={t('Conflicts')} locale={locale}/>
  </div>;
}
function FileResult({
  row, checked, expanded, onCheck, onExpand, locale,
}: {
  row: FileRow; checked: boolean; expanded: boolean; onCheck: () => void;
  onExpand: () => void; locale: Locale;
}) {
  const t = (key: string) => translate(locale, key);
  return <>
    <tr>
      <td><input type="checkbox" checked={checked} disabled={row.status !== 'matched'} aria-label={t('Selected') + ': ' + row.name} onChange={onCheck}/></td>
      <td><b className="file" title={row.name}>{row.name}</b><small className="path-small" title={row.path}>{row.path}</small></td>
      <td className="mono">{row.original}</td>
      <td className="mono">{row.selected?.date ?? '—'}{row.refinedFromMtime && <span className="mtime-refined" title={t('Same date refined from file modification time')}> · {t('Refined')}</span>}</td>
      <td>{row.selected ? <span className="tag">{t(precisionName[row.selected.precision])}</span> : '—'}</td>
      <td><span className={'tag ' + (row.status === 'matched' ? 'ok' : 'warn')}>{t(statusName[row.status] ?? row.status)}</span></td>
      <td><button className="icon-btn" onClick={onExpand} aria-label={t('View candidate dates')}><Eye size={17}/></button></td>
    </tr>
    {expanded && <tr className="details"><td colSpan={7}>
      <b>{t('All candidates')}</b>
      <p className="muted">{row.warning ? localizeError(locale, row.warning) : t('Candidates are ordered by precision and rule priority.')}</p>
      {row.candidates.length === 0
        ? <span className="muted">{t('No candidates')}</span>
        : row.candidates.map((candidate, i) => <div className="candidate" key={i}>
          <span className="tag">{t(precisionName[candidate.precision])}</span>
          <b>{candidate.date}</b>
          <span className="muted">{ruleTitle(locale, candidate.ruleId, candidate.ruleName)} / {t('Priority')} {candidate.priority}</span>
        </div>)}
    </td></tr>}
  </>;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    window.localStorage.getItem('photo-date-fixer-language') === 'zh' ? 'zh' : 'en');
  const t = (key: string) => translate(locale, key);
  const [tab, setTab] = useState<Tab>('scan');
  const [dark, setDark] = useState(true);
  const [root, setRoot] = useState('');
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [opProgress, setOpProgress] = useState(0);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [precision, setPrecision] = useState<number | null>(null);
  const [counts, setCounts] = useState<ResultCounts>(emptyCounts);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [history, setHistory] = useState<Journal[]>([]);
  const [notice, setNotice] = useState('');
  const notify = (text: string) => setNotice(text);
  const error = (e: unknown) => localizeError(locale, shortError(e));
  const refreshRows = useCallback(async () => {
    try {
      const response = await invoke<Page>('get_files', { offset: page * 100, limit: 100, status, precision, search });
      setRows(response.rows); setTotal(response.total);
    } catch (e) { notify(shortError(e)); }
  }, [page, status, precision, search]);
  const refreshCounts = useCallback(async () => {
    try { setCounts(await invoke<ResultCounts>('get_result_counts')); }
    catch (e) { notify(shortError(e)); }
  }, []);
  const refreshHistory = useCallback(async () => {
    try { setHistory(await invoke<Journal[]>('get_operations')); }
    catch (e) { notify(shortError(e)); }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    window.localStorage.setItem('photo-date-fixer-language', locale);
  }, [locale]);
  useEffect(() => {
    void invoke<Rule[]>('get_rules').then(setRules).catch(e => notify(shortError(e)));
    void invoke<Settings>('get_settings').then(setSettings).catch(e => notify(shortError(e)));
    void refreshCounts();
    const scanEvent = listen<number>('scan-progress', event => setProgress(event.payload));
    const operationEvent = listen<number>('operation-progress', event => setOpProgress(event.payload));
    return () => { void scanEvent.then(unlisten => unlisten()); void operationEvent.then(unlisten => unlisten()); };
  }, [refreshCounts]);
  useEffect(() => { void refreshRows(); }, [refreshRows]);
  useEffect(() => { if (tab === 'history') void refreshHistory(); }, [tab, refreshHistory]);

  const activeGroup: ResultGroup = precision === 4 ? 'second' : precision === 3 ? 'minute'
    : precision === 2 ? 'hour' : precision === 1 ? 'day'
    : status === 'unmatched' ? 'unmatched' : status === 'conflict' ? 'conflict' : 'all';
  const chooseGroup = (key: ResultGroup) => {
    const group = groups.find(g => g.key === key);
    if (!group) return;
    setPrecision(group.precision); setStatus(group.status);
    setPage(0); setSelected([]); setExpanded(null);
  };
  const choose = async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: t('Choose a photo or video directory') });
      if (typeof path === 'string') setRoot(path);
    } catch (e) { notify(error(e)); }
  };
  const scan = async () => {
    if (!root || scanning) return;
    setScanning(true); setProgress(0); setSelected([]);
    try {
      const report = await invoke<Summary>('start_scan', { root });
      setSummary(report);
      setStatus('all'); setPrecision(null); setPage(0); setTab('results');
      await refreshCounts(); await refreshRows();
      notify(t(report.cancelled ? 'Scanning cancelled.' : 'Scan complete. No files changed.'));
    } catch (e) { notify(t('Scan failed: ') + error(e)); }
    finally { setScanning(false); }
  };
  const commitRules = async (next: Rule[]): Promise<boolean> => {
    setBusy(true);
    try {
      await invoke('save_rules', { rules: next });
      setRules(next);
      setSummary(await invoke<Summary>('rematch'));
      setPage(0); setSelected([]);
      await refreshCounts(); await refreshRows();
      notify(t('Rules saved and matches refreshed.'));
      return true;
    } catch (e) { notify(t('Saving rules failed: ') + error(e)); return false; }
    finally { setBusy(false); }
  };
  const updateSettings = async (next: Settings) => {
    setBusy(true);
    try {
      await invoke('save_settings', { settings: next });
      setSettings(next);
      setSummary(await invoke<Summary>('rematch'));
      setSelected([]); setPage(0);
      await refreshRows();
      notify(t('Settings saved; matches refreshed.'));
    } catch (e) { notify(t('Saving settings failed: ') + error(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy || !window.confirm(t('Repair confirmation'))) return;
    setBusy(true); setOpProgress(0);
    try {
      const result = await invoke<OpResult>('apply_changes', { ids: selected, status, precision, search });
      notify(t('Wrote ') + result.succeeded + t(', skipped ') + result.skipped + t(', failed ') + result.failed);
      setTab('history'); await refreshHistory();
    } catch (e) { notify(t('Repair failed: ') + error(e)); }
    finally { setBusy(false); }
  };
  const undo = async (id: string) => {
    if (busy || !window.confirm(t('Undo confirmation'))) return;
    setBusy(true);
    try {
      const result = await invoke<OpResult>('undo_operation', { id });
      notify(t('Restored ') + result.succeeded + t(', skipped ') + result.skipped + t(', failed ') + result.failed);
      await refreshHistory();
    } catch (e) { notify(t('Undo failed: ') + error(e)); }
    finally { setBusy(false); }
  };
  const exportCsv = async () => {
    try {
      const path = await save({
        title: t('Export report (includes full local paths)'),
        defaultPath: 'photo-date-report.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (path) {
        const count = await invoke<number>('export_report', { output: path, status, precision, search });
        notify(t('Saved CSV rows: ') + count);
      }
    } catch (e) { notify(error(e)); }
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-icon"><CalendarClock size={22}/></span>
        <div><strong>Photo Date Fixer</strong><small>LOCAL WORKSPACE</small></div>
      </div>
      <div className="side-caption">{t('Workspace')}</div>
      <nav>{navigation.map(item => <button key={item.id}
        className={'nav-link ' + (tab === item.id ? 'active' : '')}
        onClick={() => setTab(item.id)}>
        <item.icon size={18}/>{t(item.label)}
      </button>)}</nav>
      <div className="sidebar-foot">
        <div className="privacy"><ShieldCheck size={19}/>
          <span><b>{t('All local')}</b><small>{t('No photos or paths are uploaded')}</small></span>
        </div>
        <label className="locale-picker">
          <Languages size={16}/>
          <select aria-label={t('Language')} value={locale} onChange={e => setLocale(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </label>
        <button className="theme" onClick={() => setDark(!dark)}>
          {dark ? <Sun size={16}/> : <Moon size={16}/>}
          {t(dark ? 'Light mode' : 'Dark mode')}
        </button>
        <div className="footnote">GPLv3 · VERSION 1.1</div>
      </div>
    </aside>

    <main className="main">
      <header className="top"><span>{t('Workspace')} <span className="muted">/</span> {t(navigation.find(item => item.id === tab)?.label ?? 'Workspace')}</span>
        <span className="local"><span className="dot"/>{t('Running locally')}</span>
      </header>
      <div className="content">
        {tab === 'scan' && <>
          <PageHeader eyebrow="WORKSPACE OVERVIEW" title={t('Put your photos back in time')}
            description={t('Read dates from filenames and folders, review matches, then write photo EXIF metadata.')}/>
          <section className="hero"><div>
            <div className="eyebrow">GET STARTED</div>
            <h2>{t('Choose your photo folder')}</h2>
            <p>{t('Scanning is read-only. Photos are changed only when you confirm a repair.')}</p>
            <div className="path"><FolderOpen size={19}/><span title={root}>{root || t('No folder selected')}</span>
              <button onClick={choose} disabled={scanning}>{t('Browse')}</button>
            </div>
            <div className="button-row">
              <button className="primary" onClick={scan} disabled={!root || scanning}>
                {scanning ? <LoaderCircle className="spin" size={18}/> : <ScanSearch size={18}/>}
                {t(scanning ? 'Scanning…' : 'Start scan')}
              </button>
              {scanning && <button className="secondary" onClick={() => void invoke('cancel_scan')}>{t('Stop scan')}</button>}
            </div>
            {scanning && <p className="muted">{t('Media files scanned:')} <NumberText number={progress} locale={locale}/></p>}
          </div><div className="hero-art"><CalendarClock size={110} strokeWidth={1}/></div></section>
          <Statistics s={summary} locale={locale}/>
          <section className="panel">
            <div className="panel-header"><h3>{t('Precision takes priority')}</h3><button className="link" onClick={() => setTab('rules')}>{t('Edit rules')} →</button></div>
            <div className="precision-grid">{[4,3,2,1].map(p => <div className="precision" key={p}>
              <span>{p === 4 ? 'SS' : p === 3 ? 'MM' : p === 2 ? 'HH' : 'DD'}</span>
              <b>{t(precisionName[p])}</b>
              <small>{t(p === 4 ? 'Highest priority' : 'Fallback')}</small>
            </div>)}</div>
            <p className="muted">{t('Higher precision wins. Within the same precision, smaller rule priority wins. Conflicts are not modified.')}</p>
          </section>
        </>}

        {tab === 'rules' && <>
          <PageHeader eyebrow="MATCHING ENGINE" title={t('Matching rules')}
            description={t('Create and manage matching rules. Higher precision always wins.')}/>
          <section className="panel setting-panel">
            <div className="panel-header"><h3>{t('EXIF and performance settings')}</h3></div>
            <label className="setting-row">
              <input type="checkbox" checked={settings.preservePreciseMtime} disabled={busy}
                onChange={e => void updateSettings({ ...settings, preservePreciseMtime: e.target.checked })}/>
              <span><b>{t('Preserve more precise original modification time when it agrees')}</b>
                <small>{t('Enabled by default. A day-level match can borrow the hours, minutes and seconds from the original file only when the day matches.')}</small>
              </span>
            </label>
            <label className="setting-row">
              <input type="checkbox" checked={settings.overwriteExistingExif} disabled={busy}
                onChange={e => void updateSettings({ ...settings, overwriteExistingExif: e.target.checked })}/>
              <span><b>{t('Allow overwriting an existing EXIF capture date')}</b>
                <small>{t('Off by default. Existing EXIF capture dates are preserved unless you enable this option.')}</small>
              </span>
            </label>
            <div className="setting-row worker-row">
              <label htmlFor="parallel-workers"><b>{t('Parallel EXIF workers')}</b>
                <small>{t('Each worker uses its own persistent ExifTool process. Start with 4; reduce to 1–2 for slow network storage, or try 6–8 for a fast local SSD.')}</small>
              </label>
              <select id="parallel-workers" value={settings.parallelWorkers} disabled={busy}
                onChange={e => void updateSettings({ ...settings, parallelWorkers: Number(e.target.value) })}>
                {[1,2,3,4,5,6,7,8].map(count => <option value={count} key={count}>{count}</option>)}
              </select>
            </div>
            <p className="muted">{t('EXIF writing preserves full original-file backups locally for verified undo.')}</p>
          </section>
          <div className="toolbar">
            <span className="muted"><NumberText number={rules.length} locale={locale}/> {t('rules')}</span>
            <button className="primary" onClick={() => setDraft(newRule())}><Plus size={16}/>{t('Add rule')}</button>
          </div>
          {[4,3,2,1].map(p => <section className="panel rule-group" key={p}>
            <div className="panel-header"><h3><span className="precision-tag">{t(precisionName[p])}</span> {t('Matching rules')}</h3>
              <span className="muted">{rules.filter(rule => rule.precision === p).length} {t('rules')}</span>
            </div>
            {rules.filter(rule => rule.precision === p).sort((a,b) => a.priority - b.priority).map(rule => <div className="rule" key={rule.id}>
              <input type="checkbox" checked={rule.enabled} disabled={busy}
                aria-label={ruleTitle(locale,rule.id,rule.name)}
                onChange={() => void commitRules(rules.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}/>
              <div><b>{ruleTitle(locale,rule.id,rule.name)}</b>
                <small>{t(rule.source === 'filename' ? 'Filename' : 'Directory')} · {rule.format} · {t('Priority')} {rule.priority}</small></div>
              <button className="icon-btn" aria-label={t('Edit rules')} onClick={() => setDraft({ ...rule })}><Pencil size={16}/></button>
              <button className="icon-btn" aria-label={t('Delete this rule?')} onClick={() => {
                if (window.confirm(t('Delete this rule?'))) void commitRules(rules.filter(r => r.id !== rule.id));
              }}><Trash2 size={16}/></button>
            </div>)}
          </section>)}
        </>}

        {tab === 'results' && <>
          <PageHeader eyebrow="RESULT EXPLORER" title={t('File matches')}
            description={t('Filter by precision and status. Open any file to inspect all candidate dates.')}/>
          <Statistics s={summary} locale={locale}/>
          <section className="panel filter-panel">
            <div className="panel-header"><div>
              <h3>{t('Filter by precision')}</h3>
              <p className="muted filter-help">{t('Conflicting files are grouped under their highest-precision candidate.')}</p>
            </div><button className="link" onClick={() => chooseGroup('all')}>{t('Clear filters')}</button></div>
            <div className="result-groups">{groups.map(group => <button key={group.key}
              className={'group-chip ' + (activeGroup === group.key && status === group.status ? 'chosen' : '')}
              onClick={() => chooseGroup(group.key)}
              aria-pressed={activeGroup === group.key && status === group.status}>
              <span>{t(group.label)}</span><strong><NumberText number={counts[group.key]} locale={locale}/></strong>
            </button>)}</div>
            <div className="filter-divider"/>
            <div className="toolbar wrap">
              <div className="search"><Search size={16}/>
                <input placeholder={t('Search filenames or paths')} value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); setSelected([]); }}/>
              </div>
              <label className="status-filter">{t('Status')}
                <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); setSelected([]); }}>
                  {['all','matched','unmatched','conflict','invalid'].map(value =>
                    <option key={value} value={value}>{t(statusName[value])}</option>)}
                </select>
              </label>
              <button className="secondary" onClick={exportCsv}><Download size={16}/>{t('Export filtered CSV')}</button>
            </div>
            <div className="filter-summary">
              <span>{t('Current filter')}: <b>{precision ? t(precisionName[precision]) : t('All precisions')}</b> · <b>{t(statusName[status])}</b></span>
              <span><NumberText number={total} locale={locale}/> {t('items')}</span>
            </div>
          </section>
          <section className="panel table-panel">
            <div className="table-scroll"><table>
              <thead><tr>
                <th><input type="checkbox" aria-label={t('Selected')} checked={
                  rows.some(row => row.status === 'matched') &&
                  rows.filter(row => row.status === 'matched').every(row => selected.includes(row.id))}
                  onChange={e => setSelected(old => e.target.checked
                    ? Array.from(new Set([...old,...rows.filter(row=>row.status==='matched').map(row=>row.id)]))
                    : old.filter(id => !rows.some(row => row.id === id)))}/></th>
                <th>{t('File')}</th><th>{t('Original modified time')}</th>
                <th>{t('Detected date')}</th><th>{t('Precision')}</th>
                <th>{t('Status')}</th><th/>
              </tr></thead>
              <tbody>{rows.map(row => <FileResult key={row.id} row={row}
                locale={locale} checked={selected.includes(row.id)} expanded={expanded === row.id}
                onCheck={() => setSelected(old => old.includes(row.id) ? old.filter(x => x !== row.id) : [...old, row.id])}
                onExpand={() => setExpanded(expanded === row.id ? null : row.id)}/>)}
                {rows.length === 0 && <tr><td colSpan={7} className="empty">{t('No files match these filters.')}</td></tr>}
              </tbody>
            </table></div>
            <div className="footer"><span className="muted">
              <NumberText number={total} locale={locale}/> {t('items')} · {t('Page')} {page + 1} · {t('Selected')} {selected.length}
            </span><div className="button-row">
              <button className="secondary" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>{t('Previous')}</button>
              <button className="secondary" disabled={(page + 1) * 100 >= total} onClick={() => setPage(page + 1)}>{t('Next')}</button>
            </div></div>
          </section>
          <div className="apply-bar"><span><ShieldCheck size={18}/>{t('Only matched files in the active filter will be written. Original backups stay local.')}</span>
            <button className="primary" disabled={busy || summary.matched === 0 ||
              (!selected.length && (total === 0 || ['unmatched','conflict','invalid'].includes(status)))}
              onClick={apply}><Play size={16}/>{t('Write EXIF for')} {selected.length
                ? selected.length + ' ' + t('selected files')
                : t('matching filtered files')}</button>
          </div>
        </>}

        {tab === 'history' && <>
          <PageHeader eyebrow="OPERATION HISTORY" title={t('Operations and undo')}
            description={t('Operation history and original backups are stored only on this computer.')}/>
          {busy && <div className="panel">{t('Files processed:')} {opProgress}</div>}
          {history.length === 0 ? <div className="panel empty">{t('No operations yet.')}</div>
            : history.map(op => <section className="panel history" key={op.id}>
              <div><h3>{t('EXIF repair operation')}</h3><small className="muted">{t('Operation ID')}: {op.id}</small>
                <p><span className="tag ok">{op.items.filter(i=>i.status==='applied').length} {t('Written')}</span>{' '}
                  <span className="tag warn">{op.items.filter(i=>i.status==='failed').length} {t('Failed')}</span>{' '}
                  <span className="tag">{op.items.filter(i=>i.status==='skipped').length} {t('Skipped')}</span>{' '}
                  <span className="tag">{op.items.filter(i=>i.status==='undone').length} {t('Undone')}</span></p>
              </div>
              <button className="secondary" disabled={busy || op.status === 'undone'} onClick={() => void undo(op.id)}>
                <RotateCcw size={16}/>{t('Undo')}
              </button>
            </section>)}
        </>}
      </div>
    </main>

    {draft && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDraft(null); }}>
      <div className="modal">
        <div className="panel-header"><h2>{t('Edit matching rule')}</h2><button className="icon-btn" onClick={() => setDraft(null)}><X/></button></div>
        <div className="form">
          <label>{t('Rule name')}<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
          <div className="form-two">
            <label>{t('Date precision')}<select value={draft.precision}
              onChange={e => setDraft({ ...draft, precision: Number(e.target.value) })}>
              {[4,3,2,1].map(p => <option key={p} value={p}>{t(precisionName[p])}</option>)}
            </select></label>
            <label>{t('Match source')}<select value={draft.source}
              onChange={e => setDraft({ ...draft, source: e.target.value })}>
              <option value="filename">{t('Filename')}</option><option value="directory">{t('Directory')}</option>
            </select></label>
          </div>
          <label>{t('Regular expression (capture group named date)')}
            <input className="mono" spellCheck={false} value={draft.pattern}
              onChange={e => setDraft({ ...draft, pattern: e.target.value })}/></label>
          <div className="form-two">
            <label>{t('Date parsing format')}<input className="mono" value={draft.format}
              onChange={e => setDraft({ ...draft, format: e.target.value })}/></label>
            <label>{t('Priority within this precision')}<input type="number" value={draft.priority}
              onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}/></label>
          </div>
          <p className="muted">{t('Format example: %Y%m%d_%H%M%S. Rules inspect text only and never execute it.')}</p>
        </div>
        <div className="button-row right">
          <button className="secondary" onClick={() => setDraft(null)}>{t('Cancel')}</button>
          <button className="primary" disabled={busy || !draft.name.trim()} onClick={async () => {
            const next = rules.some(r => r.id === draft.id)
              ? rules.map(r => r.id === draft.id ? draft : r) : [...rules, draft];
            if (await commitRules(next)) setDraft(null);
          }}><Save size={16}/>{t('Save rule')}</button>
        </div>
      </div>
    </div>}
    {notice && <div className="toast"><span>{notice}</span><button onClick={() => setNotice('')}><X size={17}/></button></div>}
  </div>;
}
