#!/usr/bin/env bash
# Installa il gateway temperature sul mini PC (Ubuntu Server / Debian). Da lanciare dalla cartella del gateway:
#   sudo bash installa.sh
# Si può rilanciare per aggiornare il programma: config.json e buffer non vengono toccati.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Lanciare con sudo: sudo bash installa.sh"; exit 1; fi
QUI="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/gateway-temperature
CONF=/etc/gateway-temperature

echo "== 1. Node.js =="
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]]; then
  apt-get update
  apt-get install -y nodejs
fi
NODE_MAJ="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJ" -lt 18 ]]; then
  echo "Serve Node.js 18 o più recente (installato: $(node -v)). Vedere la guida, punto 'Node.js'."; exit 1
fi
echo "Node $(node -v) OK"
# per raggiungere le schede ESP32 con il nome (fv6.local) oltre che con l'IP
if command -v apt-get >/dev/null && ! dpkg -s libnss-mdns >/dev/null 2>&1; then apt-get install -y libnss-mdns || true; fi
# il servizio usa /usr/bin/node
if [[ ! -x /usr/bin/node ]]; then ln -sf "$(command -v node)" /usr/bin/node; fi

echo "== 2. Utente di servizio 'gateway' (senza login) =="
id gateway >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin gateway
# porta seriale dell'adattatore USB-RS485 (celle Pego)
usermod -aG dialout gateway

echo "== 3. Programma in $DEST =="
mkdir -p "$DEST/lib"
install -m 644 "$QUI/gateway.mjs" "$QUI/package.json" "$QUI/config.esempio.json" "$DEST/"
install -m 644 "$QUI"/lib/*.mjs "$DEST/lib/"

echo "== 4. Configurazione in $CONF =="
mkdir -p "$CONF"
if [[ ! -f "$CONF/config.json" ]]; then
  install -m 640 -o root -g gateway "$QUI/config.esempio.json" "$CONF/config.json"
  sed -i 's#"file": "[^"]*buffer.jsonl"#"file": "/var/lib/gateway-temperature/buffer.jsonl"#' "$CONF/config.json"
  echo "Creato $CONF/config.json dall'esempio: VA COMPILATO (sudo nano $CONF/config.json)."
else
  echo "$CONF/config.json esiste già: non lo tocco."
fi
chown root:gateway "$CONF/config.json"; chmod 640 "$CONF/config.json"

echo "== 5. Servizio systemd =="
install -m 644 "$QUI/gateway-temperature.service" /etc/systemd/system/gateway-temperature.service
systemctl daemon-reload
systemctl enable gateway-temperature >/dev/null
echo
echo "Fatto. Prossimi passi:"
echo "  sudo nano $CONF/config.json                                          compilare Supabase e indirizzi"
echo "  sudo -u gateway node $DEST/gateway.mjs --test --config $CONF/config.json   prova delle sonde"
echo "  sudo systemctl restart gateway-temperature                            avvio"
echo "  journalctl -u gateway-temperature -f                                  log"
