// Erzeugt eine Vorschau des Verlaufsgraphen mit simulierten Daten (kein Server noetig).
import { writeFileSync } from 'node:fs';
import { renderChart } from '../src/chart.js';

const now = Math.floor(Date.now() / 1000);
const hours = 24;
const buckets = 96;
const width = (hours * 3600) / buckets;

const series = Array.from({ length: buckets }, (_, i) => {
  const from = now - hours * 3600 + i * width;
  const hourOfDay = new Date(from * 1000).getHours();
  // Tagesrhythmus: abends voll, nachts leer
  const base = 22 + 20 * Math.sin(((hourOfDay - 4) / 24) * Math.PI * 2);
  const noise = Math.sin(i / 3) * 3 + (Math.random() - 0.5) * 4;
  const value = Math.max(0, Math.round(base + noise));

  if (i > 40 && i < 46) return { from, to: from + width, value: null, offline: true, empty: false };
  if (i > 12 && i < 18) return { from, to: from + width, value: null, offline: false, empty: true };
  return { from, to: from + width, value, offline: false, empty: false };
});

const values = series.map((s) => s.value).filter((v) => v !== null);
const png = renderChart(series, {
  hours,
  label: 'Letzte 24 Stunden',
  slots: 60,
  current: values.at(-1),
  peak: Math.max(...values),
  avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
});

writeFileSync('scripts/preview.png', png);
console.log(`Vorschau geschrieben: scripts/preview.png (${(png.length / 1024).toFixed(1)} KB)`);
