import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DEFAULTS, TICK, injectSpike, registerDevice, restart, setPower, startSimulator } from './simulator';

const MAX = 1200;      // lecturas guardadas por nodo (10 min)
const WIN = 80;        // lecturas visibles en la gráfica (40 s)
const OFFLINE_MS = 3000;
const BOOT_MS = 6000;
const COLORS = {
  light: { t: '#D1345B', h: '#2A6FDB', grid: '#CBD8D3', text: '#5B7370' },
  dark: { t: '#FF6B8B', h: '#6FA8FF', grid: '#24403F', text: '#8FA8A3' },
};
const LABELS = { ok: 'En línea', alert: 'Fuera de rango', off: 'Sin señal', down: 'Apagado', boot: 'Reiniciando' };
const FIELDS = [['tMin', 'Temp. mínima (°C)'], ['tMax', 'Temp. máxima (°C)'], ['hMin', 'Humedad mínima (%)'], ['hMax', 'Humedad máxima (%)']];
const NEW_NODE = { name: '', zone: '', t: 24, h: 60, tMin: 15, tMax: 30, hMin: 40, hMax: 80 };
const time = (ts) => new Date(ts).toLocaleTimeString('es-CO', { hour12: false });
const inRange = (r, l) => r.temperature <= l.tMax && r.temperature >= l.tMin && r.humidity <= l.hMax && r.humidity >= l.hMin;
const stats = (arr, k) => { const v = arr.map((r) => r[k]); return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length }; };

function check(r, l) {
  const out = [];
  if (r.temperature > l.tMax) out.push(['T+', `Temperatura alta: ${r.temperature} °C (máx. ${l.tMax})`]);
  if (r.temperature < l.tMin) out.push(['T-', `Temperatura baja: ${r.temperature} °C (mín. ${l.tMin})`]);
  if (r.humidity > l.hMax) out.push(['H+', `Humedad alta: ${r.humidity} % (máx. ${l.hMax})`]);
  if (r.humidity < l.hMin) out.push(['H-', `Humedad baja: ${r.humidity} % (mín. ${l.hMin})`]);
  return out;
}

function Modal({ children, onClose }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export default function App() {
  const [devices, setDevices] = useState(DEFAULTS);
  const [data, setData] = useState(() => Object.fromEntries(DEFAULTS.map((d) => [d.id, []])));
  const [limits, setLimits] = useState(() => Object.fromEntries(DEFAULTS.map((d) => [d.id, d.limits])));
  const [powered, setPowered] = useState({});
  const [boot, setBoot] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [queue, setQueue] = useState([]);
  const [reports, setReports] = useState([]);
  const [sel, setSel] = useState(DEFAULTS[0].id);
  const [frozen, setFrozen] = useState(null);
  const [end, setEnd] = useState(0);
  const [form, setForm] = useState(null);
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [now, setNow] = useState(Date.now());
  const limitsRef = useRef(limits); limitsRef.current = limits;
  const devicesRef = useRef(devices); devicesRef.current = devices;
  const active = useRef({});

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  useEffect(() => startSimulator((r) => {
    setData((p) => ({ ...p, [r.deviceId]: [...(p[r.deviceId] || []), r].slice(-MAX) }));
    const lim = limitsRef.current[r.deviceId];
    if (!lim) return;
    const found = check(r, lim);
    const prev = active.current[r.deviceId] || [];
    const fresh = found.filter(([code]) => !prev.includes(code));
    active.current[r.deviceId] = found.map(([code]) => code);
    if (fresh.length) {
      const name = devicesRef.current.find((d) => d.id === r.deviceId)?.name;
      const items = fresh.map(([code, msg]) => ({ id: `${r.ts}-${r.deviceId}-${code}`, deviceId: r.deviceId, name, msg, ts: r.ts }));
      setAlerts((a) => [...items, ...a].slice(0, 200));
      setQueue((q) => [...q, ...items].slice(-10));
    }
  }), []);

  const statusOf = (d) => {
    if (powered[d.id] === false) return 'down';
    if (now < (boot[d.id] || 0)) return 'boot';
    const last = data[d.id]?.at(-1);
    if (!last || now - last.ts > OFFLINE_MS) return 'off';
    return check(last, limits[d.id]).length ? 'alert' : 'ok';
  };
  const pick = (id) => { setSel(id); setFrozen(null); };
  const dismiss = () => setQueue((q) => q.slice(1));
  const device = devices.find((d) => d.id === sel);
  const off = powered[sel] === false;
  const l = limits[sel];
  const src = frozen || data[sel] || [];
  const e = frozen ? end : src.length;
  const series = src.slice(Math.max(0, e - WIN), e).map((r) => ({ time: time(r.ts), temperature: r.temperature, humidity: r.humidity }));
  const last = (data[sel] || []).at(-1);
  const c = COLORS[dark ? 'dark' : 'light'];

  const toggle = () => { setPowered((p) => ({ ...p, [sel]: off })); setPower(sel, off); };
  const reboot = () => { restart(sel, BOOT_MS); setBoot((p) => ({ ...p, [sel]: Date.now() + BOOT_MS })); };

  const makeReport = (d) => {
    const arr = data[d.id] || [];
    if (!arr.length) return null;
    return {
      id: `${Date.now()}-${d.id}`, ts: Date.now(), name: d.name, status: statusOf(d), secs: Math.round((arr.length * TICK) / 1000),
      t: stats(arr, 'temperature'), h: stats(arr, 'humidity'),
      ok: Math.round((100 * arr.filter((r) => inRange(r, limits[d.id])).length) / arr.length),
      alerts: alerts.filter((a) => a.deviceId === d.id).length, battery: arr.at(-1).battery,
    };
  };
  const addReports = (list) => setReports((p) => [...list.filter(Boolean), ...p]);
  const csv = () => {
    const head = ['fecha', 'nodo', 'estado', 'segundos', 'temp_min', 'temp_prom', 'temp_max', 'hum_min', 'hum_prom', 'hum_max', 'pct_en_rango', 'alertas', 'bateria'];
    const rows = reports.map((r) => [new Date(r.ts).toISOString(), r.name, LABELS[r.status], r.secs, r.t.min, r.t.avg.toFixed(1), r.t.max, r.h.min, r.h.avg.toFixed(1), r.h.max, r.ok, r.alerts, r.battery]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...rows].map((x) => x.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'historico-reportes.csv'; a.click();
  };

  const addNode = (ev) => {
    ev.preventDefault();
    const f = form;
    const id = `esp32-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${devices.length + 1}`;
    const d = { id, name: f.name, zone: f.zone || 'Sin zona', t: f.t, h: f.h, limits: { tMin: f.tMin, tMax: f.tMax, hMin: f.hMin, hMax: f.hMax } };
    setLimits((p) => ({ ...p, [id]: d.limits })); setData((p) => ({ ...p, [id]: [] })); setDevices((p) => [...p, d]);
    registerDevice(d); pick(id); setForm(null);
  };
  const setF = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.type === 'number' ? Number(ev.target.value) : ev.target.value }));
  const q = queue[0];

  return (
    <div className="app">
      <header>
        <div>
          <h1>Monitoreo de cultivos</h1>
          <p>Demo con nodos ESP32 simulados que publican dos veces por segundo.</p>
        </div>
        <div className="actions">
          <button onClick={() => injectSpike(sel)} disabled={off}>Provocar alerta en {device.name}</button>
          <button onClick={() => setDark(!dark)}>{dark ? 'Modo claro' : 'Modo oscuro'}</button>
        </div>
      </header>

      <main>
        <section className="devices" aria-label="Dispositivos">
          {devices.map((d) => {
            const st = statusOf(d);
            const r = data[d.id]?.at(-1);
            return (
              <button key={d.id} className={`device ${sel === d.id ? 'sel' : ''} ${st === 'alert' ? 'bad' : ''}`} onClick={() => pick(d.id)}>
                <span className={`dot ${st}`} />
                <span className="dname"><b>{d.name}</b><small>{d.zone}: {LABELS[st]}</small></span>
                <span className="nums">{r && st !== 'down' ? `${r.temperature}°C` : '--'}<small>{r && st !== 'down' ? `${r.humidity}%` : ''}</small></span>
              </button>
            );
          })}
          <button className="add" onClick={() => setForm(NEW_NODE)}>Agregar nodo</button>
        </section>

        <section className="panel chart">
          <div className="chead">
            <div><h2>{device.name}</h2><small>{device.id}{last ? `, batería ${last.battery}%, señal ${last.rssi} dBm` : ''}</small></div>
            <div className="big">
              <span style={{ color: c.t }}>{last ? last.temperature : '--'}<small> °C</small></span>
              <span style={{ color: c.h }}>{last ? last.humidity : '--'}<small> %</small></span>
            </div>
          </div>
          <div className="ctrl">
            <button onClick={toggle}>{off ? 'Encender' : 'Apagar'}</button>
            <button onClick={reboot} disabled={off}>Reiniciar</button>
            <button onClick={() => addReports([makeReport(device)])}>Generar reporte</button>
          </div>
          {series.length < 2 ? <p className="empty">Esperando las primeras lecturas del nodo…</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={series} margin={{ top: 8, right: 0, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fill: c.text, fontSize: 11 }} minTickGap={50} />
                <YAxis yAxisId="t" tick={{ fill: c.t, fontSize: 11 }} domain={[Math.min(l.tMin, 0) === 0 ? 'auto' : 'auto', 'auto']} />
                <YAxis yAxisId="h" orientation="right" tick={{ fill: c.h, fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                <ReferenceLine yAxisId="t" y={l.tMax} stroke={c.t} strokeDasharray="5 4" />
                <ReferenceLine yAxisId="t" y={l.tMin} stroke={c.t} strokeDasharray="5 4" />
                <Line yAxisId="t" dataKey="temperature" name="Temperatura (°C)" stroke={c.t} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line yAxisId="h" dataKey="humidity" name="Humedad (%)" stroke={c.h} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="panel limits">
          <h3>Niveles aceptables de {device.name}</h3>
          <div className="fields">
            {FIELDS.map(([k, label]) => (
              <label key={k}>{label}
                <input type="number" value={l[k]} onChange={(ev) => setLimits((p) => ({ ...p, [sel]: { ...p[sel], [k]: Number(ev.target.value) } }))} />
              </label>
            ))}
          </div>
        </section>

        <section className="panel reports">
          <div className="rhead">
            <h3>Histórico de reportes</h3>
            <div className="ctrl">
              <button onClick={() => addReports(devices.map(makeReport))}>Reporte de todos</button>
              <button onClick={csv} disabled={!reports.length}>Descargar CSV</button>
            </div>
          </div>
          {!reports.length ? <p className="empty">Aún no hay reportes. Genera uno del nodo seleccionado o de todos.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Hora</th><th>Nodo</th><th>Estado</th><th>Temp. prom. (mín–máx)</th><th>Hum. prom. (mín–máx)</th><th>En rango</th><th>Alertas</th></tr></thead>
              <tbody>{reports.map((r) => (
                <tr key={r.id}><td>{time(r.ts)}</td><td>{r.name}</td><td>{LABELS[r.status]}</td>
                  <td>{r.t.avg.toFixed(1)} °C ({r.t.min}–{r.t.max})</td><td>{r.h.avg.toFixed(1)} % ({r.h.min}–{r.h.max})</td><td>{r.ok}%</td><td>{r.alerts}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        <section className="panel alerts">
          <h3>Alertas recientes</h3>
          {alerts.length === 0 ? <p className="empty">Sin alertas. Pulsa «Provocar alerta» para ver cómo reacciona el panel.</p> : (
            <ul>{alerts.slice(0, 30).map((a) => <li key={a.id}><span className="dot alert" /><span><b>{a.name}</b> {a.msg}</span><small>{time(a.ts)}</small></li>)}</ul>
          )}
        </section>
      </main>

      {q && (
        <Modal onClose={dismiss}>
          <h2 className="badtxt">Alerta en {q.name}</h2>
          <p>{q.msg}</p>
          <small>{time(q.ts)}{queue.length > 1 ? `. Hay ${queue.length - 1} alertas más en cola.` : ''}</small>
          <div className="ctrl"><button className="primary" onClick={() => { pick(q.deviceId); dismiss(); }}>Ver nodo</button><button onClick={dismiss}>Entendido</button></div>
        </Modal>
      )}

      {form && (
        <Modal onClose={() => setForm(null)}>
          <h2>Agregar nodo</h2>
          <form onSubmit={addNode}>
            <div className="fields">
              <label>Nombre<input required value={form.name} onChange={setF('name')} placeholder="Invernadero C" /></label>
              <label>Zona o cultivo<input value={form.zone} onChange={setF('zone')} placeholder="Lulo" /></label>
              <label>Temperatura normal (°C)<input type="number" step="0.1" value={form.t} onChange={setF('t')} /></label>
              <label>Humedad normal (%)<input type="number" step="0.1" value={form.h} onChange={setF('h')} /></label>
              {FIELDS.map(([k, label]) => <label key={k}>{label}<input type="number" value={form[k]} onChange={setF(k)} /></label>)}
            </div>
            <div className="ctrl"><button className="primary" type="submit">Agregar nodo</button><button type="button" onClick={() => setForm(null)}>Cancelar</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
