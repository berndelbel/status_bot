#!/usr/bin/env bash
#
# Richtet den Status-Bot als systemd-Dienst ein.
#
# Das Skript ermittelt Projektpfad, Benutzer und Node-Pfad selbst und erzeugt
# daraus eine passende Unit - so koennen Pfade nicht auseinanderlaufen.
#
#   sudo bash deploy/install-service.sh              # Standard
#   sudo bash deploy/install-service.sh --user bot   # unter anderem Benutzer
#        bash deploy/install-service.sh --dry-run    # nur anzeigen, nichts tun
#
set -euo pipefail

SERVICE_NAME="status-bot"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER=""
DRY_RUN=0

# --- Ausgabe ---------------------------------------------------------------
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
ok()   { printf '%s  ok  %s %s\n' "$c_grn" "$c_off" "$1"; }
warn() { printf '%s WARN %s %s\n' "$c_ylw" "$c_off" "$1"; }
die()  { printf '%s FEHLER %s %s\n' "$c_red" "$c_off" "$1" >&2; exit 1; }
step() { printf '\n%s== %s ==%s\n' "$c_dim" "$1" "$c_off"; }

# --- Argumente -------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) RUN_USER="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "Unbekannte Option: $1" ;;
  esac
done

step "Vorabpruefung"

[[ -f "$PROJECT_DIR/package.json" ]] || die "package.json nicht gefunden in $PROJECT_DIR"
ok "Projektverzeichnis: $PROJECT_DIR"

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  die ".env fehlt in $PROJECT_DIR - ohne Konfiguration startet der Bot nicht."
fi
ok ".env vorhanden"

if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
  die "node_modules fehlt - bitte zuerst 'npm ci' im Projektordner ausfuehren."
fi
ok "Abhaengigkeiten installiert"

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "node nicht gefunden. Bitte Node.js 22 oder neuer installieren."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  die "Node $($NODE_BIN -v) ist zu alt. Der Bot braucht mindestens Version 22 (node:sqlite)."
fi
ok "Node $("$NODE_BIN" -v) unter $NODE_BIN"

# Der Graph wird serverseitig gerendert und braucht dafuer System-Schriften.
if command -v fc-list >/dev/null 2>&1; then
  if fc-list 2>/dev/null | grep -qi 'dejavu\|noto\|liberation'; then
    ok "Schriftarten vorhanden"
  else
    warn "Keine passende Schriftart gefunden - der Graph kaeme ohne Beschriftung."
    warn "  Beheben mit: apt-get install -y fonts-dejavu-core"
  fi
else
  warn "fontconfig nicht installiert - Schriftarten konnten nicht geprueft werden."
  warn "  Empfohlen: apt-get install -y fontconfig fonts-dejavu-core"
fi

# --- Benutzer --------------------------------------------------------------
if [[ -z "$RUN_USER" ]]; then
  # Standard: derjenige, dem das Projekt gehoert - der kann sicher darauf zugreifen.
  RUN_USER="$(stat -c '%U' "$PROJECT_DIR")"
fi
id "$RUN_USER" >/dev/null 2>&1 || die "Benutzer '$RUN_USER' existiert nicht."
RUN_GROUP="$(id -gn "$RUN_USER" 2>/dev/null | head -n 1 || true)"
[[ -n "$RUN_GROUP" ]] || RUN_GROUP="$RUN_USER"
ok "Dienst laeuft als: ${RUN_USER}:${RUN_GROUP}"

if [[ "$RUN_USER" == "root" ]]; then
  warn "Der Bot laeuft als root. Er braucht keine Root-Rechte -"
  warn "  fuer den Dauerbetrieb ist ein eigener Benutzer die bessere Wahl."
fi

# --- Absicherung an den Pfad anpassen --------------------------------------
# ProtectHome=read-only wuerde /home und /root schreibgeschuetzt machen. Liegt
# das Projekt dort, koennte der Bot seine Datenbank nicht anlegen.
case "$PROJECT_DIR" in
  /home/*|/root|/root/*)
    PROTECT_HOME="# ProtectHome bewusst deaktiviert: das Projekt liegt unter einem
# Home-Verzeichnis und muss beschreibbar bleiben (Datenbank)."
    ;;
  *)
    PROTECT_HOME="ProtectHome=read-only"
    ;;
esac

# --- Unit erzeugen ---------------------------------------------------------
UNIT_CONTENT="[Unit]
Description=DayZ Status Bot (Discord)
After=network-online.target
Wants=network-online.target

# Nach 5 Fehlstarts in 5 Minuten aufgeben, statt endlos zu rotieren.
# Diese beiden Schluessel gehoeren in [Unit], nicht in [Service].
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${PROJECT_DIR}

# dotenv liest die .env aus dem WorkingDirectory.
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning src/index.js

# Bei Absturz oder Verbindungsverlust automatisch neu starten.
Restart=always
RestartSec=10

Environment=NODE_ENV=production

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# --- Absicherung ---
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
${PROTECT_HOME}
# Das Projektverzeichnis muss beschreibbar bleiben (Datenbank).
ReadWritePaths=${PROJECT_DIR}
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
"

if (( DRY_RUN )); then
  step "Erzeugte Unit (nichts installiert)"
  printf '%s' "$UNIT_CONTENT"
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Bitte mit sudo bzw. als root ausfuehren."

step "Dienst installieren"
printf '%s' "$UNIT_CONTENT" > "$UNIT_PATH"
ok "Unit geschrieben: $UNIT_PATH"

# Datenverzeichnis vorbereiten, damit es dem Dienstbenutzer gehoert.
mkdir -p "$PROJECT_DIR/data"
chown -R "${RUN_USER}:${RUN_GROUP}" "$PROJECT_DIR/data"
ok "Datenverzeichnis gehoert ${RUN_USER}"

systemctl daemon-reload
ok "systemd neu geladen"

systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
ok "Autostart beim Booten aktiviert"

systemctl restart "$SERVICE_NAME"
ok "Dienst gestartet"

# --- Ergebnis pruefen ------------------------------------------------------
step "Status"
# Kurz warten: bei einem Konfigurationsfehler beendet sich der Bot sofort
# wieder, das soll hier auffallen statt als "gestartet" durchzugehen.
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Der Dienst laeuft."
  echo
  systemctl status "$SERVICE_NAME" --no-pager --lines=15 || true
  echo
  echo "  Logs live mitlesen:   journalctl -u ${SERVICE_NAME} -f"
  echo "  Neu starten:          systemctl restart ${SERVICE_NAME}"
  echo "  Stoppen:              systemctl stop ${SERVICE_NAME}"
else
  warn "Der Dienst laeuft nicht. Die letzten Logzeilen:"
  echo
  journalctl -u "$SERVICE_NAME" --no-pager --lines=40 || true
  exit 1
fi
