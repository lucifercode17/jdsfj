import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {
  Activity, ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown,
  Clock3, Download, Gauge, Leaf, RefreshCw, Search, SlidersHorizontal, Wind, Zap
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL
const number = (n, digits = 0) => Number(n ?? 0).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const dateLabel = (iso, options = { day: '2-digit', month: 'short' }) => new Date(iso).toLocaleDateString('en-GB', options);
const hourLabel = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

function normalizePayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
  const data = rows.map((r) => ({
    ...r,
    startTime: r.startTime || r.start_time || r.delivery_time,
    publishTime: r.publishTime || r.publish_time,
    actual_mw: Number(r.actual_mw ?? r.actual ?? 0),
    forecast_mw: Number(r.forecast_mw ?? r.forecast ?? 0),
    error_mw: Number(r.error_mw ?? (Number(r.forecast_mw ?? r.forecast ?? 0) - Number(r.actual_mw ?? r.actual ?? 0))),
  })).filter((r) => r.startTime && Number.isFinite(r.actual_mw) && Number.isFinite(r.forecast_mw)).sort((a,b) => new Date(a.startTime)-new Date(b.startTime));
  const m = payload?.metrics || {};
  const errors = data.map(d => d.forecast_mw - d.actual_mw);
  const actuals = data.map(d => d.actual_mw);
  const mae = m.mae_mw ?? (errors.length ? errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length : 0);
  const rmse = m.rmse_mw ?? (errors.length ? Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length) : 0);
  const bias = m.bias_mw ?? (errors.length ? errors.reduce((s,e)=>s+e,0)/errors.length : 0);
  const validPct = data.filter(d=>Math.abs(d.actual_mw)>1);
  const mape = m.mape_percent ?? (validPct.length ? validPct.reduce((s,d)=>s+Math.abs(d.forecast_mw-d.actual_mw)/Math.abs(d.actual_mw)*100,0)/validPct.length : 0);
  return { ...payload, data, metrics: { intervals_evaluated: m.intervals_evaluated ?? data.length, mae_mw: mae, rmse_mw: rmse, bias_mw: bias, mape_percent: mape } };
}

function MetricCard({ label, value, unit, icon: Icon, tone, note, trend }) {
  return <article className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={18}/></span></div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    <div className="metric-foot"><span className="metric-note">{note}</span>{trend && <span className={`trend ${trend.startsWith('+') ? 'up' : 'down'}`}>{trend}</span>}</div>
  </article>;
}
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><div className="tooltip-label">{label}</div>{payload.map((p) => <div className="tooltip-row" key={p.dataKey}><span><i style={{background:p.color || p.stroke}} />{p.name}</span><b>{number(p.value, 1)} MW</b></div>)}</div>;
}
function App() {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState('loading');
  const [source, setSource] = useState('sample');
  const [range, setRange] = useState('month');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState('');

  const load = async (quiet = false) => {
    if (!quiet) setStatus('loading');
    setRefreshing(true); setApiError('');
    try {
      if (API_BASE) {
        const response = await fetch(`${API_BASE}/api/wind/accuracy`);
        if (!response.ok) throw new Error(`API responded with ${response.status}`);
        const json = await response.json();
        setPayload(normalizePayload(json)); setSource('api'); setStatus('ready');
      } else {
        const response = await fetch('/data/accuracy.json');
        if (!response.ok) throw new Error('Could not load bundled sample data');
        setPayload(normalizePayload(await response.json())); setSource('sample'); setStatus('ready');
      }
    } catch (err) {
      setApiError(err.message || 'Could not load dashboard data');
      if (!payload) {
        try {
          const response = await fetch('/data/accuracy.json');
          setPayload(normalizePayload(await response.json())); setSource('sample'); setStatus('ready');
        } catch { setStatus('error'); }
      }
    } finally { setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const allData = payload?.data || [];
  const visibleData = useMemo(() => {
    const filtered = allData.filter(d => {
      if (!query) return true;
      return new Date(d.startTime).toISOString().slice(0,10).includes(query.trim());
    });
    if (!filtered.length || range === 'month') return filtered;
    const days = range === '7d' ? 7 : 1;
    const end = new Date(filtered[filtered.length - 1].startTime).getTime();
    return filtered.filter(d => end - new Date(d.startTime).getTime() < days * 86400000);
  }, [allData, range, query]);

  const chartData = useMemo(() => visibleData.map((d) => ({
    ...d, time: dateLabel(d.startTime), fullTime: `${dateLabel(d.startTime, { day:'2-digit', month:'short', year:'numeric' })} · ${hourLabel(d.startTime)} UTC`,
    error_mw: d.error_mw ?? d.forecast_mw - d.actual_mw,
  })), [visibleData]);
  const dailyData = useMemo(() => {
    const grouped = new Map();
    visibleData.forEach(d => {
      const day = new Date(d.startTime).toISOString().slice(0,10);
      if (!grouped.has(day)) grouped.set(day, { day, actual:0, forecast:0, error:0, count:0 });
      const g=grouped.get(day); g.actual+=d.actual_mw; g.forecast+=d.forecast_mw; g.error+=d.forecast_mw-d.actual_mw; g.count++;
    });
    return [...grouped.values()].map(g => ({ date: dateLabel(g.day), actual: g.actual/g.count, forecast: g.forecast/g.count, bias: g.error/g.count }));
  }, [visibleData]);
  const metrics = useMemo(() => {
    if (!visibleData.length) return { count:0, mae:0, rmse:0, bias:0, mape:0 };
    const errors=visibleData.map(d=>d.forecast_mw-d.actual_mw);
    const pct=visibleData.filter(d=>Math.abs(d.actual_mw)>1);
    return {
      count:visibleData.length,
      mae:errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length,
      rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),
      bias:errors.reduce((s,e)=>s+e,0)/errors.length,
      mape:pct.length?pct.reduce((s,d)=>s+Math.abs(d.forecast_mw-d.actual_mw)/Math.abs(d.actual_mw)*100,0)/pct.length:0
    };
  }, [visibleData]);
  const period = payload?.period || { start: allData[0]?.startTime?.slice(0,10), end: allData.at(-1)?.startTime?.slice(0,10) };

  const exportCsv = () => {
    const header = ['startTime','publishTime','actual_mw','forecast_mw','error_mw'];
    const rows = visibleData.map(d => header.map(k => JSON.stringify(k==='error_mw' ? d.forecast_mw-d.actual_mw : d[k] ?? '')).join(','));
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='wind-forecast-accuracy.csv'; a.click(); URL.revokeObjectURL(url);
  };

  if (status === 'loading' && !payload) return <div className="loading-screen"><div className="loader-mark"><Wind size={28}/></div><p>Loading wind intelligence…</p></div>;
  if (status === 'error' && !payload) return <div className="loading-screen"><h2>Could not load data</h2><p>{apiError}</p><button className="primary-button" onClick={()=>load()}>Try again</button></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Wind size={23}/></div><div><strong>WindSight</strong><span>ENERGY INTELLIGENCE</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav"><a className="nav-item active" href="#overview"><Gauge size={17}/>Overview<span className="nav-dot"/></a><a className="nav-item" href="#forecast"><Activity size={17}/>Forecast accuracy</a><a className="nav-item" href="#errors"><SlidersHorizontal size={17}/>Error analysis</a></nav>
      <div className="sidebar-bottom"><div className="live-card"><div className="live-dot"/><span>DATA PIPELINE</span><b>{source === 'api' ? 'Connected' : 'Sample data'}</b><small>{source === 'api' ? 'Live API source' : 'Local JSON dataset'}</small></div><div className="profile"><div className="avatar">WS</div><div><strong>Wind analytics</strong><span>Analyst workspace</span></div><ChevronDown size={15}/></div></div>
    </aside>
    <main className="main-content" id="overview">
      <header className="topbar"><div className="breadcrumb">Analytics <span>/</span> <b>Wind generation</b></div><div className="top-actions"><span className="updated"><span className="live-dot"/> {source==='api'?'API connected':'Demo dataset'}</span><button className="icon-button" title="Refresh data" onClick={()=>load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/></button><button className="export-button" onClick={exportCsv}><Download size={16}/> Export CSV</button></div></header>
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> RENEWABLES / PERFORMANCE</div><h1>Wind forecast <em>overview</em></h1><p>Understand forecast accuracy, generation patterns, and where predictions diverge from reality.</p></div><div className="period-chip"><CalendarDays size={17}/><div><span>REPORTING PERIOD</span><strong>{period?.start ? dateLabel(period.start,{day:'2-digit',month:'short',year:'numeric'}) : '—'} – {period?.end ? dateLabel(period.end,{day:'2-digit',month:'short',year:'numeric'}) : '—'}</strong></div><ChevronDown size={15}/></div></section>
      {apiError && <div className="notice"><span>Using available data.</span> {apiError}. Check <code>VITE_API_BASE_URL</code> and backend CORS settings if you expected live data.</div>}
      <section className="metric-grid" aria-label="Forecast metrics">
        <MetricCard label="Mean absolute error" value={number(metrics.mae,0)} unit="MW" icon={Activity} tone="violet" note="Lower is better"/>
        <MetricCard label="Root mean square error" value={number(metrics.rmse,0)} unit="MW" icon={Gauge} tone="blue" note="Highlights large misses"/>
        <MetricCard label="Forecast bias" value={`${metrics.bias>0?'+':''}${number(metrics.bias,0)}`} unit="MW" icon={metrics.bias>=0?ArrowUpRight:ArrowDownRight} tone={metrics.bias>=0?'amber':'mint'} note={metrics.bias>0?'Over-forecasting on average':metrics.bias<0?'Under-forecasting on average':'No average bias'}/>
        <MetricCard label="Mean absolute % error" value={number(metrics.mape,2)} unit="%" icon={Zap} tone="mint" note="Excludes zero actuals"/>
      </section>
      <section className="chart-card hero-chart" id="forecast">
        <div className="section-heading"><div><div className="section-kicker">GENERATION PROFILE</div><h2>Forecast vs. actual</h2><p>Hourly wind generation · megawatts (MW)</p></div><div className="chart-controls"><div className="range-tabs"><button className={range==='1d'?'selected':''} onClick={()=>setRange('1d')}>24H</button><button className={range==='7d'?'selected':''} onClick={()=>setRange('7d')}>7D</button><button className={range==='month'?'selected':''} onClick={()=>setRange('month')}>1M</button></div><button className="icon-button" onClick={exportCsv} title="Export chart data"><Download size={15}/></button></div></div>
        <div className="legend-row"><span><i className="legend-dot actual"/>Actual generation</span><span><i className="legend-dot forecast"/>Day-ahead forecast</span><span className="chart-caption">{number(metrics.count)} hourly intervals</span></div>
        <div className="chart-wrap main-line"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{top:12,right:8,left:0,bottom:4}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#263246"/><XAxis dataKey="fullTime" tickFormatter={(v)=>v.split(' · ')[0]} minTickGap={60} tick={{fill:'#7f8da5',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tickFormatter={v=>`${Math.round(v/1000)}k`} tick={{fill:'#7f8da5',fontSize:11}} axisLine={false} tickLine={false} width={42}/><Tooltip content={<ChartTooltip/>}/><Line type="monotone" dataKey="actual_mw" name="Actual" stroke="#54d6b2" strokeWidth={2} dot={false} activeDot={{r:4,strokeWidth:0}}/><Line type="monotone" dataKey="forecast_mw" name="Forecast" stroke="#8a7cff" strokeWidth={2} dot={false} activeDot={{r:4,strokeWidth:0}}/></LineChart></ResponsiveContainer></div>
        <div className="chart-insight"><div className="insight-icon"><Activity size={17}/></div><div><strong>{metrics.bias>0?'Forecasts trend above actual generation':'Forecasts trend below actual generation'}</strong><p>Average signed error is {metrics.bias>0?'+':''}{number(metrics.bias,0)} MW across the selected window. Review the error profile below to locate periods with larger deviations.</p></div></div>
      </section>
      <section className="lower-grid" id="errors">
        <article className="chart-card error-card"><div className="section-heading compact"><div><div className="section-kicker">DAILY AGGREGATES</div><h2>Average generation by day</h2><p>Daily mean of hourly readings</p></div><span className="mini-badge"><CalendarDays size={13}/> Daily</span></div><div className="legend-row small"><span><i className="legend-dot actual"/>Actual</span><span><i className="legend-dot forecast"/>Forecast</span></div><div className="chart-wrap daily-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyData} margin={{top:10,right:6,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#263246"/><XAxis dataKey="date" tick={{fill:'#7f8da5',fontSize:10}} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28}/><YAxis tickFormatter={v=>`${Math.round(v/1000)}k`} tick={{fill:'#7f8da5',fontSize:10}} axisLine={false} tickLine={false} width={36}/><Tooltip content={<ChartTooltip/>}/><Area type="monotone" dataKey="forecast" name="Forecast" stroke="#8a7cff" fill="#8a7cff" fillOpacity={0.08} strokeWidth={1.7}/><Line type="monotone" dataKey="actual" name="Actual" stroke="#54d6b2" strokeWidth={2} dot={false}/></ComposedChart></ResponsiveContainer></div></article>
        <article className="chart-card error-card"><div className="section-heading compact"><div><div className="section-kicker">SYSTEMATIC DEVIATION</div><h2>Forecast error by day</h2><p>Positive values indicate over-forecasting</p></div><span className={`bias-pill ${metrics.bias>=0?'positive':'negative'}`}>{metrics.bias>=0?'+':''}{number(metrics.bias,0)} MW mean</span></div><div className="chart-wrap daily-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={dailyData} margin={{top:16,right:6,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#263246"/><XAxis dataKey="date" tick={{fill:'#7f8da5',fontSize:10}} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28}/><YAxis tickFormatter={v=>`${v>0?'+':''}${Math.round(v/1000)}k`} tick={{fill:'#7f8da5',fontSize:10}} axisLine={false} tickLine={false} width={40}/><Tooltip content={<ChartTooltip/>}/><ReferenceLine y={0} stroke="#607087"/><Bar dataKey="bias" name="Daily mean error" fill="#f5b95e" radius={[3,3,0,0]} maxBarSize={18}/></BarChart></ResponsiveContainer></div><div className="error-legend"><span><i className="legend-dot amber-dot"/>Mean daily error</span><span>0 MW = unbiased</span></div></article>
      </section>
      <section className="data-section chart-card"><div className="section-heading compact"><div><div className="section-kicker">INTERVAL DETAIL</div><h2>Forecast evaluation records</h2><p>Inspect individual delivery hours and forecast publication times.</p></div><div className="table-tools"><div className="search-box"><Search size={15}/><input aria-label="Filter by date" placeholder="Filter YYYY-MM-DD" value={query} onChange={e=>setQuery(e.target.value)}/></div><span className="record-count">{number(visibleData.length)} rows</span></div></div><div className="table-scroll"><table><thead><tr><th>Delivery time (UTC)</th><th>Published (UTC)</th><th>Actual (MW)</th><th>Forecast (MW)</th><th>Error (MW)</th><th>Direction</th></tr></thead><tbody>{visibleData.slice(0,50).map((d,i)=>{const err=d.forecast_mw-d.actual_mw;return <tr key={`${d.startTime}-${i}`}><td className="date-cell">{dateLabel(d.startTime,{day:'2-digit',month:'short',year:'numeric'})} <span>{hourLabel(d.startTime)}</span></td><td>{d.publishTime?`${dateLabel(d.publishTime,{day:'2-digit',month:'short'})} ${hourLabel(d.publishTime)}`:'—'}</td><td>{number(d.actual_mw,1)}</td><td>{number(d.forecast_mw,1)}</td><td className={err>=0?'error-positive':'error-negative'}>{err>0?'+':''}{number(err,1)}</td><td><span className={`direction-tag ${err>=0?'over':'under'}`}>{err>=0?'Over':'Under'}</span></td></tr>})}</tbody></table>{visibleData.length===0&&<div className="empty-state">No intervals match that date. Try YYYY-MM-DD from the reporting period.</div>}</div>{visibleData.length>50&&<div className="table-footer">Showing first 50 of {number(visibleData.length)} intervals. <button onClick={exportCsv}>Export all rows <Download size={13}/></button></div>}</section>
      <footer className="footer"><div><Leaf size={15}/> <span>WindSight <b>·</b> Renewable generation analytics</span></div><span>Forecast rule: latest publication before delivery day starts</span></footer>
    </main>
  </div>;
}

export default App;
