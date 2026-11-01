# Inventario de infraestructura, cuentas y URLs (versión Firebase)

| Componente | Estado | Dueño propuesto | Dato |
|---|---|---|---|
| Demo interactiva (sin backend) | ✅ Publicada (privada) | Cuenta Claude de SoL | Página "Mesa Pya'e Andrade" |
| Repositorio GitHub | ✅ Creado (privado) | Cuenta GitHub de SoL | `danielvera97dv-SoL/mesa-pyae-andrade`, rama `main` |
| Proyecto Firebase staging | ✅ Activo | Cuenta Google de SoL | `andrade-mesapyae-staging`, plan Blaze, Firestore en São Paulo, app Web creada |
| Proyecto Firebase producción | ⏳ Por crear | Cuenta Google de SoL (con acceso de Andrade si se acuerda) | `andrade-mesapyae`, Firestore en `southamerica-east1` |
| Funciones (staging) | ✅ Publicadas 09/10/2026 | — | `api`, `archivoDiario` (05:00, tarea programada activa), `exportDia`; Node 22 |
| Secretos (Secret Manager, staging) | ✅ Creados con valores aleatorios | — | `SESSION_SECRET`, `EXPORT_KEY` (nunca en el repositorio) |
| Sitio Netlify | ⏳ Por crear | Netlify de SoL (transferible) | `andrade-mesapyae.netlify.app`; redirección `/api` a la función |
| Planilla de exportación diaria | ⏳ Opcional | Cuenta Google de Andrade | `ANDRADE_VENTAS_DIARIAS` + Apps Script `ExportarDia` |
| Portal AppSheet | ⏳ Por crear | Cuenta Google de Andrade/SoL | Planilla `ANDRADE_MESA_PYAE_ACCESO` (`docs/appsheet.md`) |
| Copias de Firestore (staging) | ✅ Diarias, 14 días | — | PITR pendiente para producción |

**Datos que se cargan en el frontend (públicos, no son secretos):** `apiKey`, `authDomain`, `projectId` y `appId` de la app Web de Firebase. Las reglas solo permiten leer `meta/pulse`.

**Secretos** (en el gestor de contraseñas de SoL): `SESSION_SECRET`, `EXPORT_KEY` y el PIN inicial de `admin`.

**Independencia de Coloso:** Andrade usa su propio proyecto de Firebase, sus propios secretos y su propio sitio. Nada de Coloso se reutiliza.

**Costos estimados:** USD 0 por mes dentro del tramo gratis (ver `docs/manual-tecnico.md` §6). Requiere tarjeta en el plan Blaze. No se contrató ningún servicio pago.
