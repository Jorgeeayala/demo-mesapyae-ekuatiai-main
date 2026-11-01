#!/bin/sh
# Publica Mesa Pya'e en un proyecto de Firebase desde Google Cloud Shell.
# Uso: sh desplegar.sh <id-del-proyecto> [PLAN] [demo]
#   PLAN: BASICO (por defecto), GOLD o PREMIUM.  "demo": carga modelos 3D de ejemplo (sitio de demo de Mesa Pya'e).
#   El PIN del usuario de plataforma (sol) se toma de la bóveda central (MESA_CENTRAL, por defecto mesapyae-central).
#   Si no está, lo pide dos veces y lo guarda cifrado (sal + hash) en el local y en la bóveda.
# Crea los secretos solo si no existen (los valores nunca se muestran).
set -e
unset GOOGLE_CLOUD_QUOTA_PROJECT  # en Cloud Shell hace fallar la subida del sitio (Hosting)
P="$1"
[ -n "$P" ] || { echo "Uso: sh desplegar.sh <id-del-proyecto>"; exit 1; }
cd "$(dirname "$0")"
gcloud config set project "$P" >/dev/null 2>&1
echo "== Activando APIs necesarias =="
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com firestore.googleapis.com aiplatform.googleapis.com --project "$P"
# Proyectos nuevos dentro de la organización: Google ya no le da permisos automáticos a la cuenta por defecto
# (PROYECTO-compute@), que compila las funciones y las ejecuta. Sin estos roles el build falla ("missing permission
# on the build service account") o el servidor responde ERROR_INTERNO (no puede leer ni escribir en Firestore).
NUMP=$(gcloud projects describe "$P" --format='value(projectNumber)' 2>/dev/null || true)
if [ -n "$NUMP" ]; then
  CSA="$NUMP-compute@developer.gserviceaccount.com"
  for ROL in roles/cloudbuild.builds.builder roles/datastore.user roles/logging.logWriter roles/aiplatform.user; do
    if ! gcloud projects get-iam-policy "$P" --flatten='bindings[].members' --filter="bindings.role:$ROL AND bindings.members:serviceAccount:$CSA" --format='value(bindings.role)' 2>/dev/null | grep -q "$ROL"; then
      gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$CSA" --role "$ROL" --condition=None >/dev/null 2>&1 \
        && echo "Permiso $ROL para la cuenta del servidor" || echo "Aviso: no se pudo dar $ROL a $CSA (darlo a mano si falla)"
    fi
  done
fi
if ! gcloud firestore databases describe --database='(default)' --project "$P" >/dev/null 2>&1; then
  echo "== Creando la base Firestore en São Paulo =="
  gcloud firestore databases create --location=southamerica-east1 --project "$P"
fi
# Respaldo diario de la base (se guardan 7 días): si algo se borra por error, se puede recuperar.
if ! gcloud firestore backups schedules list --database='(default)' --project "$P" --format='value(name)' 2>/dev/null | grep -q .; then
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project "$P" >/dev/null 2>&1 \
    && echo "Respaldo diario de la base programado (se guardan 7 días)" || echo "Aviso: no se pudo programar el respaldo diario (hacerlo con GitHub → Actions → vigilancia)"
fi
for S in SESSION_SECRET EXPORT_KEY; do
  if gcloud secrets describe "$S" --project "$P" >/dev/null 2>&1; then
    echo "Secreto $S ya existe"
  else
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets create "$S" --data-file=- --replication-policy=automatic --project "$P" >/dev/null
    echo "Secreto $S creado"
  fi
done
# Upgrade Atención Integrada: el token de Whaticket del local. Se crea con «pendiente» (el servidor lo ignora) para que
# la función se pueda publicar; Ser o Límites carga el token real cuando el local contrata el Upgrade:
#   printf '%s' "<token>" | gcloud secrets versions add WHATICKET_TOKEN --data-file=- --project <proyecto>  (y volver a publicar)
if gcloud secrets describe WHATICKET_TOKEN --project "$P" >/dev/null 2>&1; then
  echo "Secreto WHATICKET_TOKEN ya existe"
else
  printf 'pendiente' | gcloud secrets create WHATICKET_TOKEN --data-file=- --replication-policy=automatic --project "$P" >/dev/null
  echo "Secreto WHATICKET_TOKEN creado (pendiente)"
fi
ENVF="functions/.env.$P"
if [ ! -f "$ENVF" ]; then
  echo "MESA_PLAN=${2:-BASICO}" > "$ENVF"
  [ "$3" = "demo" ] && echo "MESA_DEMO=SI" >> "$ENVF"
fi
# PIN de sol: se guarda UNA vez (solo la sal y el hash, nunca el PIN) en la bóveda central de Mesa Pya'e
# (Secret Manager del proyecto $MESA_CENTRAL, por defecto mesapyae-central) y todos los locales lo toman de ahí.
CENTRAL="${MESA_CENTRAL:-mesapyae-central}"
if ! grep -q '^MESA_PLATAFORMA=' "$ENVF"; then
  LINEA=$(gcloud secrets versions access latest --secret=MESA_PLATAFORMA --project "$CENTRAL" 2>/dev/null || true)
  if printf '%s' "$LINEA" | grep -Eq '^[a-z0-9_.]{3,30}:[a-z0-9]{16}:[0-9a-f]{64}$'; then
    echo "MESA_PLATAFORMA=$LINEA" >> "$ENVF"
    echo "PIN de sol tomado de la bóveda central ($CENTRAL): es el mismo en todos los locales"
  fi
fi
if ! grep -q '^MESA_PLATAFORMA=' "$ENVF" && [ ! -t 0 ] && [ -n "$CI" ]; then
  echo "ERROR: no se pudo leer el PIN de sol de la bóveda central ($CENTRAL) y en GitHub no se puede escribir a mano."
  echo "Revisar que exista el secreto MESA_PLATAFORMA en $CENTRAL y que la cuenta de GitHub pueda leerlo."
  exit 1
fi
if ! grep -q '^MESA_PLATAFORMA=' "$ENVF"; then
  echo "== Usuario de plataforma (Ser o Límites) =="
  # El PIN se ve mientras se escribe (en Cloud Shell la entrada oculta falla) y la pantalla se borra al apretar Enter.
  # Se pide dos veces para que un error de tipeo no deje al local con otro PIN.
  while :; do
    printf 'ESCRIBI EL PIN DE sol (6 a 8 numeros; se borra de la pantalla al apretar Enter): '
    read -r PIN; clear
    if ! printf '%s' "$PIN" | grep -Eq '^[0-9]{6,8}$'; then echo "No valido (recibi ${#PIN} caracteres). Tienen que ser de 6 a 8 numeros."; continue; fi
    printf 'REPETI EL MISMO PIN para confirmar: '
    read -r PIN2; clear
    if [ "$PIN" = "$PIN2" ]; then PIN2=''; break; fi
    PIN2=''; echo "Los dos PIN no coinciden. Probemos de nuevo."
  done
  printf '%s\n' "$PIN" | node ../tools/plataforma-pin.js sol >> "$ENVF" 2>/dev/null; PIN=''
  grep -q '^MESA_PLATAFORMA=' "$ENVF" && echo "PIN de sol guardado cifrado"
  # Si existe la bóveda central y todavía no tiene el PIN, se guarda ahí para los próximos locales.
  if gcloud projects describe "$CENTRAL" >/dev/null 2>&1 && ! gcloud secrets describe MESA_PLATAFORMA --project "$CENTRAL" >/dev/null 2>&1; then
    grep '^MESA_PLATAFORMA=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\n' | \
      gcloud secrets create MESA_PLATAFORMA --data-file=- --replication-policy=automatic --project "$CENTRAL" >/dev/null 2>&1 \
      && echo "PIN de sol guardado en la bóveda central ($CENTRAL): los próximos locales no lo van a pedir"
  fi
fi
echo "Configuración del proyecto: $(grep -v PLATAFORMA "$ENVF" | tr '\n' ' ') (PIN de plataforma guardado cifrado)"
echo "== Instalando dependencias =="
(cd functions && npm install --no-audit --no-fund --omit=dev)
echo "== Publicando =="
if command -v firebase >/dev/null 2>&1; then F=firebase; else F="npx -y firebase-tools"; fi
SOLO=firestore:rules,functions
[ -d hosting ] && SOLO="$SOLO,hosting"   # solo el paquete de demo trae sitio web
$F deploy --only "$SOLO" --project "$P" --force --non-interactive
echo "== Datos para el sitio (Netlify) =="
echo "MESA_API_URL=https://southamerica-east1-$P.cloudfunctions.net/api"
[ -d hosting ] && echo "SITIO=https://$P.web.app  (demo en vivo: https://$P.web.app/vivo/)"
APP=$($F apps:list WEB --project "$P" 2>/dev/null | grep -o '1:[0-9]*:web:[0-9a-f]*' | head -1)
if [ -z "$APP" ]; then $F apps:create WEB "Mesa Pyae web" --project "$P" >/dev/null 2>&1 || true; APP=$($F apps:list WEB --project "$P" 2>/dev/null | grep -o '1:[0-9]*:web:[0-9a-f]*' | head -1); fi
if [ -n "$APP" ]; then
  $F apps:sdkconfig WEB "$APP" --project "$P" 2>/dev/null | grep -E '"(projectId|apiKey|appId)"' | sed 's/^ */  /'
fi
echo "LISTO"
