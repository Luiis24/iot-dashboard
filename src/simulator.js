// Simulador de nodos ESP32. Cada lectura tiene la MISMA forma que el JSON
// que enviaría el firmware real, así el dashboard no cambia al conectar el backend.
export const TICK = 500; // ms entre lecturas
export const DEFAULTS = [
  { id: 'esp32-inv-01', name: 'Invernadero A', zone: 'Tomate', t: 26, h: 68, limits: { tMin: 18, tMax: 30, hMin: 50, hMax: 80 } },
  { id: 'esp32-inv-02', name: 'Invernadero B', zone: 'Pimentón', t: 27, h: 64, limits: { tMin: 18, tMax: 31, hMin: 50, hMax: 80 } },
  { id: 'esp32-cf-01', name: 'Cuarto frío', zone: 'Poscosecha', t: 8, h: 85, limits: { tMin: 2, tMax: 10, hMin: 75, hMax: 92 } },
  { id: 'esp32-sec-01', name: 'Secadero', zone: 'Café', t: 31, h: 45, limits: { tMin: 25, tMax: 35, hMin: 30, hMax: 60 } },
];

const registry = new Map();
const state = {};

export function registerDevice(d) {
  registry.set(d.id, d);
  state[d.id] = { t: d.t, h: d.h, battery: 85 + Math.random() * 12, spike: 0, outUntil: 0, on: true };
}
DEFAULTS.forEach(registerDevice);

// "Comandos" al nodo (en real serían mensajes MQTT al topic de comandos del dispositivo).
export const injectSpike = (id) => { if (state[id]) state[id].spike = 20; };
export const setPower = (id, on) => { if (state[id]) state[id].on = on; };
export function restart(id, ms) {
  const x = state[id], d = registry.get(id);
  if (!x) return;
  x.outUntil = Date.now() + ms; x.spike = 0; x.t = d.t; x.h = d.h; // al reiniciar se limpia la anomalía
}

export function startSimulator(onReading) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const d of registry.values()) {
      const x = state[d.id];
      if (!x.on || now < x.outUntil) continue; // apagado o sin señal: no publica
      if (Math.random() < 0.0015) { x.outUntil = now + 10000; continue; } // caída aleatoria
      if (!x.spike && Math.random() < 0.004) x.spike = 12;
      x.t += (d.t - x.t) * 0.03 + (Math.random() - 0.5) * 0.25 + (x.spike ? 0.35 : 0);
      x.h += (d.h - x.h) * 0.03 + (Math.random() - 0.5) * 0.5 - (x.spike ? 0.4 : 0);
      if (x.spike) x.spike--;
      x.battery -= 0.001;
      onReading({
        deviceId: d.id, ts: now,
        temperature: +x.t.toFixed(1), humidity: +x.h.toFixed(1),
        battery: +x.battery.toFixed(1), rssi: -Math.round(55 + Math.random() * 25),
      });
    }
  }, TICK);
  return () => clearInterval(timer);
}
