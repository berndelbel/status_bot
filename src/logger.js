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
