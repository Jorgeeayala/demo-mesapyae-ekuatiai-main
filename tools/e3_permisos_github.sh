#!/bin/sh
# E3 · Permiso para que GitHub publique Mesa Pya'e sin Cloud Shell (se corre UNA vez, en Cloud Shell, por Ser o Límites).
#
# Qué crea (todo en el proyecto central mesapyae-central, sin claves descargables):
#   - Cuenta de servicio  github-publicador@mesapyae-central.iam.gserviceaccount.com
#   - Federación de identidad "github": solo acepta al repositorio ser-o-limites/mesa-pyae, desde las ramas main o estable.
# Qué permisos le da:
#   - Carpeta "Mesa Pyae" (clientes, demo y central): publicar servidores (Functions, Run, Firestore, Secret Manager, Firebase).
#   - Carpeta "Clientes": crear proyectos nuevos (altas).
#   - Cuenta de facturación "Mesa Pya'e · Clientes": vincular proyectos nuevos y crear su presupuesto.
# No puede: borrar proyectos, ver otras carpetas, ni descargar claves.
# Uso:  sh tools/e3_permisos_github.sh
set -e
CENTRAL=mesapyae-central
CARPETA_MESA=639429589596
CARPETA_CLIENTES=188823144806
FACTURACION=01917F-CDBAA5-F38FEC
REPO=ser-o-limites/mesa-pyae
SA_NOMBRE=github-publicador
SA="$SA_NOMBRE@$CENTRAL.iam.gserviceaccount.com"

echo "== 1/6 Activando servicios en $CENTRAL =="
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com \
  serviceusage.googleapis.com firebase.googleapis.com secretmanager.googleapis.com --project "$CENTRAL"
# La cuenta de GitHub usa a mesapyae-central como proyecto de cuota: las APIs que llama al publicar tienen que estar activas acá.
gcloud services enable firebaserules.googleapis.com firestore.googleapis.com cloudfunctions.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com firebasehosting.googleapis.com cloudscheduler.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com firebaseextensions.googleapis.com storage.googleapis.com --project "$CENTRAL"

echo "== 2/6 Cuenta de servicio de GitHub =="
gcloud iam service-accounts describe "$SA" --project "$CENTRAL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NOMBRE" --project "$CENTRAL" --display-name "GitHub publica Mesa Pyae"

echo "== 3/6 Federación de identidad con GitHub (solo $REPO, ramas main y estable) =="
gcloud iam workload-identity-pools describe github --project "$CENTRAL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --project "$CENTRAL" --location global --display-name "GitHub"
gcloud iam workload-identity-pools providers describe github-oidc --project "$CENTRAL" --location global --workload-identity-pool github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github-oidc --project "$CENTRAL" --location global \
    --workload-identity-pool github --display-name "GitHub Actions" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.actor=assertion.actor" \
    --attribute-condition "assertion.repository=='$REPO' && (assertion.ref=='refs/heads/main' || assertion.ref=='refs/heads/estable')"
NUM=$(gcloud projects describe "$CENTRAL" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$CENTRAL" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" >/dev/null

echo "== 4/6 Permisos en la carpeta Mesa Pyae (publicar servidores) =="
for R in roles/editor roles/run.admin roles/cloudfunctions.admin roles/iam.serviceAccountUser \
         roles/secretmanager.admin roles/firebase.admin roles/serviceusage.serviceUsageAdmin \
         roles/resourcemanager.projectIamAdmin; do
  gcloud resource-manager folders add-iam-policy-binding "$CARPETA_MESA" --member "serviceAccount:$SA" --role "$R" --condition=None >/dev/null
  echo "   $R"
done

echo "== 5/6 Permiso en la carpeta Clientes (crear proyectos de altas nuevas) =="
gcloud resource-manager folders add-iam-policy-binding "$CARPETA_CLIENTES" --member "serviceAccount:$SA" \
  --role roles/resourcemanager.projectCreator --condition=None >/dev/null
echo "   roles/resourcemanager.projectCreator"

echo "== 6/6 Facturación Mesa Pya'e · Clientes (vincular proyectos y presupuestos) =="
for R in roles/billing.user roles/billing.costsManager; do
  gcloud billing accounts add-iam-policy-binding "$FACTURACION" --member "serviceAccount:$SA" --role "$R" >/dev/null
  echo "   $R"
done

echo
echo "LISTO. Datos para GitHub (no son secretos):"
echo "PROVEEDOR=projects/$NUM/locations/global/workloadIdentityPools/github/providers/github-oidc"
echo "CUENTA=$SA"
