#!/bin/sh
# Vigilancia de Mesa Pya'e (se corre desde GitHub → Actions → vigilancia, o al final de cada alta). Idempotente.
#
# Para cada local con servidor (tools/locales_servidor.js) y la demo pública:
#   1. Respaldo diario de su base Firestore (se guardan 7 días). Si algo se borra por error, se puede recuperar.
#   2. Chequeo cada 10 minutos de su servidor (/api health, desde varias regiones de Google), hecho desde el proyecto central.
# Y una sola alerta en el proyecto central: si un servidor deja de responder, llega un correo a AVISO_CORREO.
#
# Variables: MESA_CENTRAL (mesapyae-central), AVISO_CORREO (admin@serolimites.com), SOLO=<local> (un solo local).
# Necesita: gcloud con permisos de editor en la carpeta Mesa Pyae (la cuenta de GitHub los tiene).
set -e
cd "$(dirname "$0")/.."
CENTRAL="${MESA_CENTRAL:-mesapyae-central}"
CORREO="${AVISO_CORREO:-admin@serolimites.com}"
POLITICA="Mesa Pya'e · un servidor no responde"
FALLAS=0

LISTA=$(node -e "
  const l = require('./tools/locales_servidor.js').listar(process.argv[1] || 'todos');
  if (!process.argv[1] || process.argv[1] === 'todos') l.push({ local: 'demo', proyecto: 'mesapyae-demo', host: 'mesapyae-demo.web.app' });
  for (const x of l) console.log(x.local + ' ' + x.proyecto + ' ' + (x.host || ('southamerica-east1-' + x.proyecto + '.cloudfunctions.net')));
" "${SOLO:-todos}")
[ -n "$LISTA" ] || { echo "No hay locales para vigilar."; exit 1; }

echo "== Activando el monitoreo en $CENTRAL =="
gcloud services enable monitoring.googleapis.com --project "$CENTRAL"

echo "== Canal de aviso por correo ($CORREO) =="
TOKEN=$(gcloud auth print-access-token)
API="https://monitoring.googleapis.com/v3/projects/$CENTRAL"
CANAL=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/notificationChannels?filter=type%3D%22email%22" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{ const j=JSON.parse(d||'{}');
    const c=(j.notificationChannels||[]).find(x=>x.labels&&x.labels.email_address===process.argv[1]); process.stdout.write(c?c.name:''); });" "$CORREO")
if [ -z "$CANAL" ]; then
  CANAL=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$API/notificationChannels" \
    -d "{\"type\":\"email\",\"displayName\":\"Mesa Pya'e · avisos\",\"labels\":{\"email_address\":\"$CORREO\"}}" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{ const j=JSON.parse(d||'{}'); if(!j.name){console.error(d);process.exit(1);} process.stdout.write(j.name); });")
  echo "Canal creado: $CANAL"
else
  echo "Canal existente: $CANAL"
fi

EXISTENTES=$(gcloud monitoring uptime list-configs --project "$CENTRAL" --format='value(displayName)' 2>/dev/null || true)
echo "$LISTA" | while read -r LOCAL PROY HOST; do
  echo "== $LOCAL ($PROY) =="
  # 1. Respaldo diario (la demo no lo necesita: sus datos son de ejemplo)
  if [ "$LOCAL" != "demo" ]; then
    if gcloud firestore backups schedules list --database='(default)' --project "$PROY" --format='value(name)' 2>/dev/null | grep -q .; then
      echo "   Respaldo diario: ya estaba"
    elif gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project "$PROY" >/dev/null 2>&1; then
      echo "   Respaldo diario: programado (se guardan 7 días)"
    else
      echo "   ::warning::No se pudo programar el respaldo diario de $PROY"
    fi
  fi
  # 2. Chequeo del servidor cada 10 minutos
  NOMBRE="Mesa Pya'e · $LOCAL"
  if printf '%s\n' "$EXISTENTES" | grep -Fxq "$NOMBRE"; then
    echo "   Chequeo del servidor: ya estaba"
  elif gcloud monitoring uptime create "$NOMBRE" --project "$CENTRAL" \
      --resource-type=uptime-url --resource-labels="host=$HOST,project_id=$CENTRAL" \
      --protocol=https --path=/api --request-method=post \
      --content-type=user-provided --custom-content-type=application/json --body='{"action":"health"}' \
      --matcher-content='"ok":true' --matcher-type=contains-string --period=10 --timeout=10 >/dev/null; then
    echo "   Chequeo del servidor: creado (cada 10 minutos)"
  else
    echo "   ::warning::No se pudo crear el chequeo de $HOST"
  fi
done

echo "== Alerta por correo si un servidor no responde =="
if gcloud monitoring policies list --project "$CENTRAL" --format='value(displayName)' 2>/dev/null | grep -Fxq "$POLITICA"; then
  echo "La alerta ya existe."
else
  F=$(mktemp)
  cat > "$F" <<JSON
{
  "displayName": "$POLITICA",
  "combiner": "OR",
  "conditions": [{
    "displayName": "El chequeo de un servidor falla en más de una región",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "600s",
      "trigger": { "count": 1 },
      "aggregations": [{
        "alignmentPeriod": "1200s",
        "perSeriesAligner": "ALIGN_NEXT_OLDER",
        "crossSeriesReducer": "REDUCE_COUNT_FALSE",
        "groupByFields": ["resource.label.host"]
      }]
    }
  }],
  "notificationChannels": ["$CANAL"],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "Un servidor de Mesa Pya'e no responde hace más de 10 minutos. El correo dice cuál (host). Revisar en Google Cloud → proyecto del local → Cloud Run / Functions → registros, o volver a publicarlo con GitHub → Actions → publicar-servidores."
  }
}
JSON
  gcloud monitoring policies create --policy-from-file="$F" --project "$CENTRAL" >/dev/null && echo "Alerta creada: avisa a $CORREO."
  rm -f "$F"
fi
echo "LISTO"
