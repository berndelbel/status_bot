import {
  getWindowAggregate,
  getPeakSample,
  getSamplesSince,
  getCurrentStreakStart,
  getOutages,
} from './db.js';

export const RANGES = {
  '1h': { label: 'Letzte Stunde', hours: 1 },
  '6h': { label: 'Letzte 6 Stunden', hours: 6 },
  '24h': { label: 'Letzte 24 Stunden', hours: 24 },
  '7d': { label: 'Letzte 7 Tage', hours: 24 * 7 },
  '30d': { label: 'Letzte 30 Tage', hours: 24 * 30 },
};

/** Ab diesem Anteil offline-Messungen gilt ein Bucket im Graphen als Ausfall. */
const OFFLINE_BUCKET_THRESHOLD = 0.25;

export function rangeToSince(hours) {
  return Math.floor(Date.now() / 1000) - Math.round(hours * 3600);
}

/** Sammelt alle Kennzahlen fuer ein Zeitfenster. */
export function collectStats(hours) {
  const since = rangeToSince(hours);
  const agg = getWindowAggregate(since);
  const peak = getPeakSample(since);
  const outages = getOutages(since);
  const streak = getCurrentStreakStart();

  const downtimeSeconds = outages.reduce((sum, o) => sum + o.seconds, 0);

  return {
    hours,
    since,
    samples: agg.total,
    uptimeRatio: agg.uptimeRatio,
    peak: peak ? peak.players : null,
    peakAt: peak ? peak.ts : null,
    avg: agg.avg !== null ? Math.round(agg.avg * 10) / 10 : null,
    avgPing: agg.avgPing !== null ? Math.round(agg.avgPing) : null,
    slots: agg.slots,
    outageCount: outages.length,
    downtimeSeconds,
    outages,
    streak,
  };
}

/**
 * Verdichtet Messungen zu gleichmaessigen Zeit-Buckets fuer den Graphen.
 * Luecken (z. B. Bot war aus) bleiben als null erhalten und werden nicht interpoliert.
 */
export function buildSeries(hours, buckets = 96) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - Math.round(hours * 3600);
  const samples = getSamplesSince(since);
  const width = (now - since) / buckets;

  const slots = Array.from({ length: buckets }, (_, i) => ({
    from: since + i * width,
    to: since + (i + 1) * width,
    sum: 0,
    count: 0,
    max: 0,
    offline: 0,
    total: 0,
  }));

  for (const s of samples) {
    let idx = Math.floor((s.ts - since) / width);
    if (idx < 0) idx = 0;
    if (idx >= buckets) idx = buckets - 1;
    const slot = slots[idx];
    slot.total += 1;
    if (s.online) {
      slot.sum += s.players;
      slot.count += 1;
      if (s.players > slot.max) slot.max = s.players;
    } else {
      slot.offline += 1;
    }
  }

  return slots.map((slot) => ({
    from: slot.from,
    to: slot.to,
    value: slot.count > 0 ? slot.sum / slot.count : null,
    max: slot.count > 0 ? slot.max : null,
    // Ein Bucket wird als Ausfall markiert, sobald ein nennenswerter Teil der
    // Messungen darin offline war. Ein einzelner Aussetzer (z. B. 1 von 15
    // Messungen) bleibt dadurch unauffaellig, eine echte Stoerung von einigen
    // Minuten wird im Graphen aber sichtbar - auch wenn das Bucket laenger ist.
    offline: slot.total > 0 && slot.offline / slot.total >= OFFLINE_BUCKET_THRESHOLD,
    empty: slot.total === 0,
  }));
}

/** Vergleicht den aktuellen Spielerstand mit dem Durchschnitt der Vorperiode. */
export function playerTrend(currentPlayers, hours = 1) {
  const now = Math.floor(Date.now() / 1000);
  const prev = getSamplesSince(now - hours * 3600 * 2).filter(
    (s) => s.ts < now - hours * 3600 && s.online
  );
  if (prev.length < 3) return null;
  const avgPrev = prev.reduce((a, s) => a + s.players, 0) / prev.length;
  const diff = currentPlayers - avgPrev;
  if (Math.abs(diff) < 1) return { direction: 'flat', diff: 0 };
  return { direction: diff > 0 ? 'up' : 'down', diff: Math.round(Math.abs(diff)) };
}

// ---------------------------------------------------------------- Formatierung

export function formatDuration(seconds, { short = false } = {}) {
  if (seconds === null || seconds === undefined || seconds < 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}${short ? 'd' : ' Tage'}`);
  if (h > 0) parts.push(`${h}${short ? 'h' : ' Std'}`);
  if (m > 0 && d === 0) parts.push(`${m}${short ? 'm' : ' Min'}`);
  if (parts.length === 0) parts.push(`${s}${short ? 's' : ' Sek'}`);
  return parts.slice(0, 2).join(' ');
}

export function formatPercent(ratio, digits = 2) {
  if (ratio === null || ratio === undefined) return '-';
  return `${(ratio * 100).toFixed(digits).replace('.', ',')} %`;
}

export function formatNumber(n) {
  if (n === null || n === undefined) return '-';
  return String(n).replace('.', ',');
}

/** Balken aus Blockzeichen, z. B. fuer die Slot-Auslastung. */
export function progressBar(value, max, width = 14) {
  if (!max || max <= 0) return '─'.repeat(width);
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const SPARK = '▁▂▃▄▅▆▇█';

/** Kompakter Verlauf als Textzeile - Fallback, wenn kein Graph gerendert wird. */
export function sparkline(series) {
  const values = series.map((p) => p.value).filter((v) => v !== null);
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  return series
    .map((p) => {
      if (p.empty) return ' ';
      if (p.offline) return '×';
      const idx = Math.min(SPARK.length - 1, Math.round((p.value / max) * (SPARK.length - 1)));
      return SPARK[idx];
    })
    .join('');
}

/** Discord-Zeitstempel: <t:1234567890:R> */
export function discordTime(unixSeconds, style = 'R') {
  return `<t:${Math.floor(unixSeconds)}:${style}>`;
}
