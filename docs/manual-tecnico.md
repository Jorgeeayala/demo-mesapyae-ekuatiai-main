# Mesa Pya'e — Andrade · Manual técnico y de mantenimiento

Versión 1.1 (Firebase) · 09/10/2026 · Ser o Límites E.A.S.

## 1. Arquitectura

```
Cliente (QR mesa / QR casita)          Personal (portal AppSheet → enlaces)
              │                                     │
              └────────────── Netlify ──────────────┘
          páginas: menu, pedidos, cocina, caja, admin  (GitHub → despliegue automático)
                │ POST /api                  ▲ pulso en tiempo real (solo un número)
                ▼ (redirección de Netlify)    │
     Cloud Function `api` (São Paulo)        Firestore  meta/pulse  (lectura pública)
       core.js = reglas de negocio                  ▲
       firestore-backend.js = caché + transacciones │
                │                                   │
                └──────────────► Cloud Firestore ───┘
                                 t_<Tabla>/<id>   tablas activas
                                 archivo/<día>_<Tabla>_…  histórico por día
     Cloud Scheduler 05:00 → archivoDiario      exportDia → Apps Script → Google Sheets (06:00)
```

**Por qué así**

- **Seguridad.** El navegador nunca escribe en la base. Las reglas de Firestore niegan todo salvo leer el pulso. Precios, permisos, cajas e idempotencia los valida la función.
- **Tiempo real.** Las pantallas escuchan `meta/pulse`. Cuando cambia, piden las novedades a la función. Medido en prueba: la cocina muestra el pedido 40 ms después del aviso. La consulta cada 30 s queda solo como respaldo.
- **Costo.** Cada instancia de la función guarda las tablas en caché. Si no hay cambios, una consulta cuesta 1 lectura (el pulso). Si hay cambios, solo lee los documentos modificados.
- **Concurrencia.** Cada escritura usa una transacción que verifica el pulso. Si otra instancia escribió antes, se refresca y se recalcula. Dentro de una instancia, las escrituras se encolan.
- **Núcleo portable.** `core/core.js` es el mismo para Firebase, Apps Script (alternativa) y la demo.

## 2. Reglas de negocio (probadas)

| Regla | Dónde |
|---|---|
| El precio se calcula en el servidor; lo que mande el navegador se ignora | `buildItems` |
| Copia de nombre, precio y opciones por ítem: cambiar el catálogo no altera pedidos pasados | `PedidoItems` |
| `request_id` en pedidos, cobros y movimientos: los reintentos no duplican, aunque entren por otra instancia | `createOrder`, `cajaCobrar` |
| Estados por rol: PENDIENTE → ACEPTADO → EN_PREPARACION → LISTO → ENTREGADO, más CANCELADO | `TRANSICIONES` |
| El estado de pago es independiente del estado del pedido | `Cuentas.pago_estado` |
| Dos cajas separadas, cada una con turnos, cobros, reversos y cierre con diferencia | `caja.*` |
| Medios de pago: Efectivo, Transferencia, TC y TD (los pagos por QR del POS se registran como TC o TD) | `medios_pago` |
| Autorización de encargado para descuentos, egresos, cancelaciones, anulaciones y reversos | `supervisor` |
| QR con token por mesa o punto, regenerable, con límite de pedidos | `resolveToken` |
| PIN con hash y sal, bloqueo por intentos y sesiones firmadas y revocables | `login` |
| Alertas de demora en cocina a los 5, 10 y 15 minutos (configurable) | `cocina_alerta_min` |

## 3. Publicación (Firebase + GitHub + Netlify)

> Requiere aprobación de SoL y Andrade. Recomendado: un proyecto `andrade-mesapyae-staging` para pruebas y otro `andrade-mesapyae` para producción.

**A. Firebase (en la PC de quien publica, con Node 22 y `npm i -g firebase-tools`)**

1. En la consola de Firebase, crear el proyecto.
   - Activar el plan **Blaze**. Pide tarjeta; ver costos en la §6.
   - Crear un **presupuesto con alerta** de USD 5 en Google Cloud → Facturación → Presupuestos.
2. En **Firestore Database**, crear la base en modo producción, ubicación `southamerica-east1` (São Paulo).
3. Preparar el código:
   ```
   sh tools/build_firebase.sh
   cd firebase
   firebase login
   firebase use --add
   ```
   En `firebase use --add`, elegir el proyecto.
4. Crear los secretos:
   ```
   firebase functions:secrets:set SESSION_SECRET
   firebase functions:secrets:set EXPORT_KEY
   ```
   En cada caso, pegar un valor largo y aleatorio, por ejemplo la salida de `openssl rand -hex 32`. Guardarlos en el gestor de contraseñas de SoL.
5. Instalar dependencias y publicar:
   ```
   cd functions && npm install && cd ..
   firebase deploy --only firestore:rules,functions
   ```
6. Primera ejecución: abrir `https://southamerica-east1-<proyecto>.cloudfunctions.net/api` con POST, o simplemente entrar al sitio. Eso crea la base.
   - En **Cloud Logging** (Funciones → api → Registros) aparece `PIN inicial: ######` del usuario `admin`.
   - Cambiarlo enseguida en Administración → Usuarios.
7. En **Configuración del proyecto → Tus apps**, agregar una app **Web**. Copiar `apiKey`, `authDomain`, `projectId` y `appId` en `public/assets/config.js`.
   - Son datos públicos: solo sirven para escuchar el pulso.
   - Si se dejan vacíos, el sistema funciona por consulta periódica cada 4 s.

**B. GitHub**

1. Crear un repositorio **privado** en la organización de SoL, por ejemplo `serolimites/mesa-pyae-andrade`, y subir este directorio.
2. `.gitignore` ya excluye datos locales y secretos. Nunca subir secretos al repositorio.

**C. Netlify**

1. **Add new site → Import from GitHub** → el repositorio. El directorio de publicación sale solo de `netlify.toml` (`public`).
2. En `netlify.toml`, reemplazar `PROJECT_ID` en la redirección `/api` por el id real del proyecto de Firebase y hacer *commit*. Netlify vuelve a publicar solo.
3. Verificar que `https://<sitio>.netlify.app/` muestre la pantalla de ingreso.
4. Verificar que, en la consola del navegador de Cocina, no aparezca "Tiempo real no disponible".

**D. Primer día**

1. Crear los usuarios de cada persona.
2. Ajustar las mesas reales.
3. Fijar la dirección pública e imprimir los QR (Administración → Mesas y QR).
4. Marcar como *Aprobado* los precios que Pablo valide.

**E. Exportación diaria a Google Sheets (opcional, recomendada)**

1. Crear la planilla `ANDRADE_VENTAS_DIARIAS` y abrir **Extensiones → Apps Script**.
2. Pegar `firebase/sheets-export/ExportarDia.js`.
3. En las Propiedades del script, cargar:
   - `EXPORT_URL` = `https://southamerica-east1-<proyecto>.cloudfunctions.net/exportDia`;
   - `EXPORT_KEY` = el mismo valor del secreto.
4. Ejecutar `instalarExportacion()`. Cada día a las 06:00 se cargan los pedidos, ítems, cobros, movimientos y turnos del día anterior.

**F. Portal AppSheet**: ver `docs/appsheet.md`. No cambia con Firebase.

## 4. Operación y mantenimiento

- **Respaldo y recuperación.**
  - En Firestore → Recuperación ante desastres, activar las **copias programadas diarias** (retención de 7 a 14 días) y la **recuperación a un momento dado (PITR)**.
  - Además, el archivo diario conserva el histórico por día en la colección `archivo`, y la exportación a Sheets deja una copia legible.
- **Archivo.** Todos los días a las 05:00 lo cerrado de más de 2 días (`dias_activos`) pasa a `archivo`. Los reportes lo leen igual.
- **Límites y escalado.**
  - `maxInstances: 4`, `concurrency: 80`.
  - El documento `meta/pulse` se escribe una vez por operación. Firestore recomienda alrededor de 1 escritura por segundo sostenida por documento, y aguanta ráfagas. Para el volumen de un café sobra.
  - Si en el futuro un local supera unas 5 operaciones por segundo sostenidas, se divide el pulso por tabla.
- **Arranque en frío.** Con `minInstances: 0`, la primera consulta del día puede tardar de 2 a 4 s. Para evitarlo, `minInstances: 1` tiene un costo fijo mensual (ver precios de Cloud Run).
- **Contingencia sin conexión.**
  - Las pantallas avisan, conservan el pedido en curso y el reintento no duplica.
  - Si el corte dura, se pasa a comanda en papel y después se carga con la observación "CONTINGENCIA".
- **Secretos.** Para rotar `SESSION_SECRET`, se cambia con `firebase functions:secrets:set` y se vuelve a publicar. Cierra todas las sesiones.

## 5. Desarrollo y pruebas

```
node server/dev-server.js --backend firebase   # Firestore simulado en memoria, http://127.0.0.1:8787
node server/dev-server.js                      # backend local en archivo JSON
npm test                                       # núcleo, Apps Script, proxy Netlify y Firebase (32 pruebas)
node tests/e2e.js                              # navegador real, backend local
BACKEND=firebase node tests/e2e.js             # navegador real, backend Firebase
node tests/realtime.test.js                    # tiempo real (pulso)
node tests/demora.test.js                      # alertas de demora en cocina
node tools/simular-dia-firebase.js 200 6       # lecturas/escrituras de un día (costo)
```

El simulador (`tests/fake-firestore.js`) reproduce transacciones con conflicto y reintento, el orden lecturas-antes-que-escrituras, lotes de 500, el límite de 1 MiB por documento y el conteo de lecturas como las factura Google. **No reemplaza** la prueba en el proyecto de staging antes del piloto.

## 6. Costos (precios oficiales consultados el 09/10/2026)

| Recurso | Tramo gratis | Uso estimado de Andrade |
|---|---|---|
| Firestore: lecturas | 50.000 por día | 12.400 por día con 200 pedidos y 6 pantallas; 29.000 con 400 pedidos y 8 pantallas |
| Firestore: escrituras | 20.000 por día | 5.400 por día con 200 pedidos; 10.800 con 400 |
| Cloud Functions: invocaciones | 2 millones por mes | unas 520.000 por mes |
| Cloud Scheduler | 3 tareas por cuenta | 1 |
| Secret Manager | 6 versiones activas | 2 |

Pasado el tramo gratis: USD 0,03 cada 100.000 lecturas y USD 0,09 cada 100.000 escrituras. Estimación para Andrade: **USD 0 por mes**. Las cifras de uso salen de `tools/simular-dia-firebase.js`.

## 7. Alternativa: Apps Script + Google Sheets

Está en `alternativas/apps-script/`: backend en `gas/` y función proxy de Netlify en `netlify-function/`. Usa el mismo núcleo, también tiene pruebas y no requiere tarjeta. Para usarla, se reemplaza la redirección `/api` de `netlify.toml` por la función de esa carpeta (ver su `Code.js`).
