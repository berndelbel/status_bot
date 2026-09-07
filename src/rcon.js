import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { crc32 } from 'node:zlib';
import { log } from './logger.js';

/**
 * Client fuer das BattlEye-RCon-Protokoll (UDP).
 *
 * Paketaufbau:
 *   'B' 'E' <CRC32 des Rests, little endian> 0xFF <Typ> <Daten>
 *
 * Typen:
 *   0x00  Login          -> Antwort: 0x01 = ok, 0x00 = abgelehnt
 *   0x01  Befehl         -> Antwort ggf. in mehreren Teilpaketen
 *   0x02  Servermeldung  -> muss bestaetigt werden, sonst trennt der Server
 *
 * Ereignisse: 'connected', 'message', 'disconnected', 'error'
 */
export class BattlEyeRcon extends EventEmitter {
  #socket = null;
  #seq = 0;
  #pending = new Map();
  #multipart = new Map();
  #keepaliveTimer = null;
  #loginTimer = null;
  #lastResponse = 0;
  #connected = false;
  #closed = false;

  constructor({ host, port, password, timeout = 5000 }) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeout = timeout;
  }

  get connected() {
    return this.#connected;
  }

  // ---------------------------------------------------------------- Pakete

  #build(type, data = Buffer.alloc(0)) {
    const payload = Buffer.concat([Buffer.from([0xff, type]), Buffer.from(data)]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32LE(crc32(payload) >>> 0, 0);
    return Buffer.concat([Buffer.from('BE', 'ascii'), checksum, payload]);
  }

  #send(type, data) {
    if (!this.#socket) return;
    this.#socket.send(this.#build(type, data), this.port, this.host, (err) => {
      if (err) this.emit('error', err);
    });
  }

  // ---------------------------------------------------------------- Verbindung

  connect() {
    if (this.#socket) return Promise.resolve();
    this.#closed = false;

    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      this.#socket = socket;

      socket.on('message', (msg) => this.#handle(msg, resolve, reject));
      socket.on('error', (err) => {
        this.emit('error', err);
        this.#teardown();
        reject(err);
      });

      socket.bind(() => {
        this.#send(0x00, Buffer.from(this.password, 'ascii'));
      });

      this.#loginTimer = setTimeout(() => {
        // Keine Antwort: Port gesperrt, falscher Port oder Server offline.
        this.#teardown();
        reject(new Error(`Keine Antwort von ${this.host}:${this.port} innerhalb von ${this.timeout} ms`));
      }, this.timeout);
    });
  }

  #handle(msg, resolveLogin, rejectLogin) {
    if (msg.length < 8 || msg.toString('ascii', 0, 2) !== 'BE') return;
    this.#lastResponse = Date.now();

    const type = msg[7];
    const data = msg.subarray(8);

    switch (type) {
      case 0x00:
        return this.#handleLogin(data, resolveLogin, rejectLogin);
      case 0x01:
        return this.#handleCommand(data);
      case 0x02:
        return this.#handleServerMessage(data);
      default:
        log.debug(`RCon: unbekannter Pakettyp 0x${type.toString(16)}`);
    }
  }

  #handleLogin(data, resolve, reject) {
    clearTimeout(this.#loginTimer);
    this.#loginTimer = null;

    if (data[0] === 0x01) {
      this.#connected = true;
      this.#startKeepalive();
      this.emit('connected');
      resolve?.();
    } else {
      this.#teardown();
      reject?.(new Error('RCon-Login abgelehnt - stimmt das RConPassword?'));
    }
  }

  #handleCommand(data) {
    const seq = data[0];
    let body = data.subarray(1);

    // Mehrteilige Antwort: 0x00 <Gesamtzahl> <Index> <Daten>
    if (body.length >= 3 && body[0] === 0x00) {
      const total = body[1];
      const index = body[2];
      const chunk = body.subarray(3);

      const parts = this.#multipart.get(seq) ?? new Array(total).fill(null);
      parts[index] = chunk;
      this.#multipart.set(seq, parts);

      if (parts.some((p) => p === null)) return; // noch nicht vollstaendig
      this.#multipart.delete(seq);
      body = Buffer.concat(parts);
    }

    const waiting = this.#pending.get(seq);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.#pending.delete(seq);
      waiting.resolve(body.toString('utf8'));
    }
  }

  #handleServerMessage(data) {
    const seq = data[0];
    // Bestaetigen, sonst wiederholt der Server und trennt schliesslich.
    this.#send(0x02, Buffer.from([seq]));
    const text = data.subarray(1).toString('utf8');
    if (text.trim() !== '') this.emit('message', text);
  }

  // ---------------------------------------------------------------- Befehle

  /** Sendet einen Befehl und wartet auf die Antwort. */
  command(cmd) {
    if (!this.#connected) return Promise.reject(new Error('RCon ist nicht verbunden'));

    const seq = this.#seq;
    this.#seq = (this.#seq + 1) % 256;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq);
        this.#multipart.delete(seq);
        reject(new Error(`Zeitueberschreitung bei Befehl "${cmd}"`));
      }, this.timeout);

      this.#pending.set(seq, { resolve, reject, timer });
      this.#send(0x01, Buffer.concat([Buffer.from([seq]), Buffer.from(cmd, 'ascii')]));
    });
  }

  #startKeepalive() {
    // BattlEye trennt nach 45 s ohne Lebenszeichen.
    this.#keepaliveTimer = setInterval(() => {
      if (Date.now() - this.#lastResponse > 45_000) {
        log.warn('RCon: keine Antwort mehr, Verbindung gilt als verloren.');
        this.#teardown();
        this.emit('disconnected');
        return;
      }
      const seq = this.#seq;
      this.#seq = (this.#seq + 1) % 256;
      this.#send(0x01, Buffer.from([seq]));
    }, 25_000);
  }

  #teardown() {
    this.#connected = false;
    if (this.#keepaliveTimer) clearInterval(this.#keepaliveTimer);
    if (this.#loginTimer) clearTimeout(this.#loginTimer);
    this.#keepaliveTimer = null;
    this.#loginTimer = null;

    for (const { timer, reject } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new Error('RCon-Verbindung geschlossen'));
    }
    this.#pending.clear();
    this.#multipart.clear();

    try {
      this.#socket?.close();
    } catch {
      /* bereits geschlossen */
    }
    this.#socket = null;
  }

  close() {
    this.#closed = true;
    this.#teardown();
  }
}

/**
 * Zerlegt die Ausgabe des Befehls "players".
 *
 * Format:
 *   Players on server:
 *   [#] [IP Address]:[Port] [Ping] [GUID] [Name]
 *   --------------------------------------------------
 *   0   1.2.3.4:2304  35   abc123...(OK) SpielerName
 *   (1 players in total)
 *
 * IP-Adressen werden bewusst verworfen - fuer die Spielzeit reichen GUID und Name.
 */
export function parsePlayers(text) {
  const players = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+\S+:\d+\s+(-?\d+)\s+([0-9a-f]{32}|-)\s*\((\w+)\)\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, id, ping, guid, verified, rawName] = m;
    players.push({
      id: Number.parseInt(id, 10),
      ping: Number.parseInt(ping, 10),
      guid,
      verified: verified.toUpperCase() === 'OK',
      // Ein angehaengtes "(Lobby)" gehoert nicht zum Namen.
      name: rawName.replace(/\s*\(Lobby\)\s*$/i, '').trim(),
    });
  }
  return players;
}
