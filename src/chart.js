import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { config } from './config.js';

GlobalFonts.loadSystemFonts?.();

const FONT = '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, sans-serif';

const THEME = {
  bg: '#17181c',
  card: '#1e1f24',
  grid: 'rgba(255,255,255,0.055)',
  axis: 'rgba(255,255,255,0.10)',
  textStrong: '#f2f3f5',
  textMuted: '#8b909a',
  textFaint: '#5c616b',
  offline: '#ed4245',
};

const W = 1000;
const H = 380;
const PAD = { top: 74, right: 30, bottom: 44, left: 54 };

function hex(num) {
  return `#${num.toString(16).padStart(6, '0')}`;
}

function rgba(hexColor, alpha) {
  const n = Number.parseInt(hexColor.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Waehlt einen "schoenen" ganzzahligen Abstand zwischen zwei Gitterlinien.
 * So bleiben die Achsenbeschriftungen ganze Zahlen und der Graph nutzt die Hoehe aus.
 */
function niceStep(x) {
  if (x <= 1) return 1;
  const base = 10 ** Math.floor(Math.log10(x));
  const frac = x / base;
  const mult = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((m) => m >= frac - 1e-9) ?? 10;
  return Math.ceil(mult * base);
}

function timeFormatter(hours) {
  const opts =
    hours <= 48 ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' };
  return new Intl.DateTimeFormat('de-DE', { ...opts, timeZone: config.timezone });
}

/**
 * Rendert den Spielerverlauf als PNG.
 * @param {Array} series Buckets aus stats.buildSeries()
 * @param {object} meta { hours, label, slots, current, peak, avg }
 * @returns {Buffer} PNG
 */
export function renderChart(series, meta) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const accent = hex(config.accentColor);

  // --- Hintergrund ---------------------------------------------------------
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 1, 1, W - 2, H - 2, 18);
  ctx.fillStyle = THEME.card;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: W - PAD.left - PAD.right,
    h: H - PAD.top - PAD.bottom,
  };

  // --- Kopfzeile -----------------------------------------------------------
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = THEME.textStrong;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('Spielerverlauf', PAD.left - 6, 38);

  ctx.fillStyle = THEME.textFaint;
  ctx.font = `400 14px ${FONT}`;
  ctx.fillText(meta.label ?? '', PAD.left - 6, 58);

  drawHeaderStats(ctx, meta, accent);

  // --- Skala ---------------------------------------------------------------
  const values = series.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  const dataMax = values.length > 0 ? Math.max(...values) : 0;
  const lines = 4;
  const step = niceStep(Math.max(dataMax * 1.15, meta.current ?? 0, 4) / lines);
  const yMax = step * lines;

  const xOf = (i) => plot.x + (i / Math.max(1, series.length - 1)) * plot.w;
  const yOf = (v) => plot.y + plot.h - (v / yMax) * plot.h;

  // --- Gitternetz ----------------------------------------------------------
  ctx.font = `400 12px ${FONT}`;
  ctx.textAlign = 'right';
  for (let i = 0; i <= lines; i++) {
    const v = step * i;
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = i === 0 ? THEME.axis : THEME.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText(String(Math.round(v)), plot.x - 12, y + 4);
  }
  ctx.textAlign = 'left';

  // --- Ausfaelle als rote Baender ------------------------------------------
  const bandW = plot.w / Math.max(1, series.length - 1);
  series.forEach((p, i) => {
    if (!p.offline) return;
    ctx.fillStyle = rgba(THEME.offline, 0.15);
    ctx.fillRect(xOf(i) - bandW / 2, plot.y, Math.max(bandW, 2), plot.h);
  });

  // --- Datenreihe (in zusammenhaengende Abschnitte zerlegt) ----------------
  const segments = [];
  let run = [];
  series.forEach((p, i) => {
    if (p.value === null || p.value === undefined) {
      if (run.length > 0) segments.push(run);
      run = [];
    } else {
      run.push({ x: xOf(i), y: yOf(p.value), v: p.value });
    }
  });
  if (run.length > 0) segments.push(run);

  for (const seg of segments) drawSegment(ctx, seg, plot, accent);

  // --- Slot-Kapazitaet als gestrichelte Linie ------------------------------
  if (meta.slots && meta.slots > 0 && meta.slots <= yMax) {
    const y = Math.round(yOf(meta.slots)) + 0.5;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = THEME.textFaint;
    ctx.font = `400 11px ${FONT}`;
    // Liegt die Linie ganz oben, wandert die Beschriftung unter sie - sonst
    // kollidiert sie mit der Kopfzeile.
    const labelY = y - plot.y < 16 ? y + 15 : y - 6;
    ctx.fillText(`${meta.slots} Slots`, plot.x + 6, labelY);
  }

  // --- Peak-Markierung ------------------------------------------------------
  drawPeakMarker(ctx, series, xOf, yOf, plot, accent);

  // --- Aktueller Wert am rechten Rand --------------------------------------
  const lastSeg = segments[segments.length - 1];
  if (lastSeg && lastSeg.length > 0) {
    const p = lastSeg[lastSeg.length - 1];
    ctx.fillStyle = rgba(accent, 0.25);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = THEME.card;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // --- Zeitachse ------------------------------------------------------------
  drawTimeAxis(ctx, series, xOf, plot, meta.hours);

  // --- Hinweis, wenn (noch) keine Daten vorliegen --------------------------
  if (values.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.textFaint;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText(
      'Noch keine Daten in diesem Zeitraum – der Verlauf füllt sich automatisch.',
      plot.x + plot.w / 2,
      plot.y + plot.h / 2
    );
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

function drawHeaderStats(ctx, meta, accent) {
  const items = [
    { label: 'DURCHSCHNITT', value: meta.avg ?? '-', color: THEME.textStrong },
    { label: 'PEAK', value: meta.peak ?? '-', color: THEME.textStrong },
    { label: 'AKTUELL', value: meta.current ?? '-', color: accent },
  ];

  let x = W - PAD.right;
  ctx.textAlign = 'right';
  for (const item of items) {
    const valueText = String(item.value).replace('.', ',');
    ctx.font = `700 20px ${FONT}`;
    const valueW = ctx.measureText(valueText).width;
    ctx.font = `600 10px ${FONT}`;
    const labelW = ctx.measureText(item.label).width;
    const blockW = Math.max(valueW, labelW);

    ctx.fillStyle = THEME.textFaint;
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText(item.label, x, 32);
    ctx.fillStyle = item.color;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(valueText, x, 56);

    x -= blockW + 34;
  }
  ctx.textAlign = 'left';
}

function drawSegment(ctx, seg, plot, accent) {
  if (seg.length === 1) {
    const p = seg[0];
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    for (let i = 0; i < seg.length - 1; i++) {
      const p0 = seg[Math.max(0, i - 1)];
      const p1 = seg[i];
      const p2 = seg[i + 1];
      const p3 = seg[Math.min(seg.length - 1, i + 2)];
      // Catmull-Rom in kubische Bezier umgerechnet - weiche, aber treue Kurve.
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y
      );
    }
  };

  // Flaeche mit Farbverlauf
  const grad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
  grad.addColorStop(0, rgba(accent, 0.42));
  grad.addColorStop(1, rgba(accent, 0.02));

  ctx.save();
  trace();
  ctx.lineTo(seg[seg.length - 1].x, plot.y + plot.h);
  ctx.lineTo(seg[0].x, plot.y + plot.h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Linie mit weichem Schein
  ctx.save();
  ctx.shadowColor = rgba(accent, 0.5);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  trace();
  ctx.stroke();
  ctx.restore();
}

function drawPeakMarker(ctx, series, xOf, yOf, plot, accent) {
  let peakIdx = -1;
  let peakVal = -1;
  series.forEach((p, i) => {
    if (p.value !== null && p.value > peakVal) {
      peakVal = p.value;
      peakIdx = i;
    }
  });
  if (peakIdx < 0 || peakVal <= 0) return;

  const x = xOf(peakIdx);
  const y = yOf(peakVal);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = rgba(accent, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, plot.y + plot.h);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawTimeAxis(ctx, series, xOf, plot, hours) {
  if (series.length === 0) return;
  const fmt = timeFormatter(hours);
  const ticks = 6;
  ctx.font = `400 11px ${FONT}`;
  ctx.fillStyle = THEME.textFaint;
  ctx.textAlign = 'center';

  for (let i = 0; i <= ticks; i++) {
    const idx = Math.round((i / ticks) * (series.length - 1));
    const point = series[idx];
    if (!point) continue;
    let x = xOf(idx);
    // Randbeschriftungen leicht einruecken, damit sie nicht abgeschnitten werden.
    if (i === 0) x += 14;
    if (i === ticks) x -= 14;
    ctx.fillText(fmt.format(new Date(point.from * 1000)), x, plot.y + plot.h + 24);
  }
  ctx.textAlign = 'left';
}
