const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function stamp() {
  return new Date().toLocaleTimeString('de-DE', { hour12: false });
}

function write(color, tag, args) {
  console.log(`${COLORS.dim}${stamp()}${COLORS.reset} ${color}${tag}${COLORS.reset}`, ...args);
}

export const log = {
  info: (...a) => write(COLORS.blue, '[INFO ]', a),
  ok: (...a) => write(COLORS.green, '[OK   ]', a),
  warn: (...a) => write(COLORS.yellow, '[WARN ]', a),
  error: (...a) => write(COLORS.red, '[ERROR]', a),
  debug: (...a) => {
    if (process.env.DEBUG === 'true') write(COLORS.magenta, '[DEBUG]', a);
  },
};

/**
 * Macht Sammelfehler lesbar.
 *
 * discord.js validiert Embeds ueber verschachtelte Fehlerobjekte und meldet
 * nach aussen nur "Received one or more errors" - welches Feld tatsaechlich
 * beanstandet wurde, steckt in err.errors. Diese Funktion faltet das auf, damit
 * im Log steht, woran es wirklich lag.
 */
export function describeError(err, depth = 0) {
  const pad = '  '.repeat(depth);
  const lines = [`${pad}${err?.constructor?.name ?? 'Error'}: ${err?.message ?? err}`];

  if (err?.given !== undefined) {
    lines.push(`${pad}  erhalten: ${JSON.stringify(err.given)?.slice(0, 200)}`);
  }
  if (err?.expected !== undefined) {
    lines.push(`${pad}  erwartet: ${err.expected}`);
  }

  if (Array.isArray(err?.errors)) {
    for (const entry of err.errors) {
      // Manche Fehler kommen als [feldname, fehler]-Paar.
      if (Array.isArray(entry)) {
        lines.push(`${pad}  bei "${entry[0]}":`);
        lines.push(describeError(entry[1], depth + 2));
      } else {
        lines.push(describeError(entry, depth + 1));
      }
    }
  }
  return lines.join('\n');
}
