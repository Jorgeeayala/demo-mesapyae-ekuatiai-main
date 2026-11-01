# Mesa Pya'e — guía de producto y de trabajo

**Mesa Pya'e** (by Ser o Límites) es un sistema de pedidos para gastronomía que se vende a muchos locales.
**Andrade Casa Café y Arte es el primer cliente** y el local donde se prueba todo. Cada mejora que se hace
para Andrade se construye como parte del producto, para poder replicarla en otros locales.

## Reglas de oro

1. **No romper lo que los locales ya usan. Dos carriles:**
   - **`main` = piloto / demo.** Lo nuevo se trabaja en una rama y entra a `main` con todas las pruebas en verde
     (`npm test`, `node tests/e2e.js`, `tests/e2e-*.js`, `tests/demo-smoke.js`). `main` NO lo usa ningún cliente.
   - **Sitio de pruebas: https://mesapyae-pruebas.netlify.app** (Netlify `mesapyae-pruebas`, rama `main`, `MESA_SITIO=DEMO_WEB`):
     la demo entera en el navegador, con datos ficticios. **Desde el 25/10/2026 NO se publica sola** (builds detenidos en
     Netlify para ahorrar créditos, 15 por publicación): cuando haga falta revisar, Netlify → `mesapyae-pruebas` →
     Project configuration → Build settings → «Active builds», y luego Deploys → Trigger deploy (o pedírselo a Claude).
     Los sitios de clientes (`andrade-mesapyae`, `lo-de-rolo-mesapyae`, `mesapyae-locales`) tienen los Deploy Previews
     apagados: los pull requests ya no arman vistas previas en cada local. Después de pasar
     una mejora a `main`, revisarla ahí (y avisarle a Ser o Límites qué probar) ANTES de pedir aprobación para `estable`.
     No usa el servidor de ningún cliente.
   - **`estable` = clientes.** Los sitios de Netlify de los locales (Andrade incluido) publican `estable`. Una mejora pasa de
     `main` a `estable` solo cuando Ser o Límites lo aprueba, después de probarla en la demo.
   - El servidor de cada local (Firebase) solo cambia cuando se publica a mano desde Cloud Shell para ese local.
2. **`main` es neutro: de Mesa Pya'e y de ningún cliente.** Nada de datos de un local en `core/`, `public/` ni `tools/`:
   nombre, logo, colores, dirección, puntos, cajas y carta van en `locales/<local>/`; horarios, links y premios en la
   configuración (tabla `Config`) o en el panel del local. Andrade es un local más (`locales/andrade/`).
3. **Las funciones pagas van detrás de un plan.** Se usa `tieneModulo('X')` en `core/core.js`.
   Sin plan, el local queda en Básico y no ve nada de Gold ni Premium.
4. **No inventar productos ni precios.** La carta y los precios salen siempre del catálogo del local.
5. **Reseñas de Google: nunca premiarlas ni filtrarlas.** Las reglas de Google prohíben dar incentivos por
   reseñas y pedirlas solo a los clientes conformes. El botón de Google se muestra a todos, sin condición.
   Lo único que puede sumar un sello (en Premium, si el local lo activa) es la **encuesta interna**.
6. **Seguridad.** No exponer secretos, PIN ni tokens. No reutilizar nada de Coloso.
   Pedir aprobación antes de cambios en producción, compras, permisos o borrados.
7. **Probar antes de decir que funciona.** Cada módulo tiene su prueba de API y su prueba en navegador.

## Planes comerciales

| Plan | Incluye | Módulos (`core.js` → `PLANES`) |
|---|---|---|
| **Básico** | Carta QR, pedidos de mozos, cocina, dos cajas, administración, reservas, sub-cuentas por persona, factura, **pedir la cuenta desde el celular** | — |
| **Gold** | Básico + **Fotos de los platos** en la carta + **Reseñas** (encuesta interna y botón a Google) | `FOTOS`, `RESENAS` |
| **Premium** | Gold + **Carta en 3D** (realidad aumentada, hasta 5 platos; Ser o Límites lo amplía en ⚙ Licencia) + **Recompensas** (tarjeta de sellos, premios, cumpleaños y base de clientes) | `FOTOS`, `RESENAS`, `MENU3D`, `RECOMPENSAS` |

**Upgrades (se cobran aparte, sobre cualquiera de los tres planes):** no están en `PLANES`; van en `UPGRADES` de `core.js`.
| Upgrade | Incluye | Módulo |
|---|---|---|
| **e-Kuatia'i** | Factura en e-Kuatia'i (DNIT) desde la caja con la extensión Migrador. Precio de lista (aprobado por Mauro, 29/10/2026): implementación Gs. 500.000 + Gs. 100.000/mes; el primer cliente conserva USD 50 + Gs. 100.000/mes. Solo para contribuyentes con un establecimiento y un punto de expedición. | `EKUATIAI` |
| **Mesa Viru** (stock y costos) | Insumos, compras con costo promedio, recetas por plato y por opción, descuento automático con cada venta, conteos, mermas, "para comprar" y margen por plato (Administración → 💰 Mesa Viru y Resumen). Decisión 29/10/2026: Upgrade aparte con el nombre comercial **Mesa Viru** (*viru* = plata en guaraní); se vende sobre Básico como mínimo. Precios (29/10/2026): implementación Gs. 900.000 hasta 40 platos con receta, Gs. 1.500.000 de 41 a 80, a medida más de 80; Gs. 90.000/mes. Combo inicial Básico + Mesa Viru (hasta 30 mesas y 40 platos): implementación Gs. 1.800.000 y Gs. 240.000/mes. Detalle de qué incluye y qué no: documento del proyecto `claude/mesa-pyae-estado.md`. Para incluirlo en un plan: mover `STOCK` de `UPGRADES` a `PLANES` en `core.js` y ajustar `tests/stock.test.js`. | `STOCK` |
| **Atención Integrada** (WhatsApp con Whaticket) | Fase 1 (30/10/2026): avisos automáticos por WhatsApp al cliente de para llevar (pedido recibido y pedido listo) desde el número del local. Próximas fases: Wäbot con la carta del local y bandeja de chats en Mesa Pya'e. Precio: a definir con Mauro. | `ATENCION` |
| **Armá tu pedido** | En la carta del QR, el cliente arma su pizza o hamburguesa con una animación: elige tamaño o pan, toca cada ingrediente (cae sobre la pizza o se apila en la hamburguesa), pide doble o triple, saca lo que el plato trae, y el precio se actualiza en vivo. Pizzas y hamburguesas de la carta y "a tu gusto". Pedido de Mauro, 30/10/2026. **Precio: a definir por Ser o Límites.** | `ARMADOR` |

- **Quién activa un Upgrade:** `sol` desde Administración → ⚙ Licencia → "Upgrades" (acción `plataforma.upgrade`, guarda Config `_upgrades`, queda en el historial). No cambia el nombre del plan y se conserva al cambiar de plan. También vale `MESA_MODULOS=EKUATIAI` en el despliegue. En la demo, la barra superior tiene "+ e-Kuatia'i".

- **Quién cambia el plan:** Ser o Límites, con su usuario de plataforma (`sol`, rol `PLATAFORMA`), desde Administración →
  **⚙ Licencia (SoL)**. Se aplica al instante y queda en el historial. El encargado del local ve su plan, pero no
  puede cambiarlo ni ver o editar ese usuario. El PIN se crea con `node tools/plataforma-pin.js`, que genera la línea
  `MESA_PLATAFORMA=sol:sal:hash` para el `.env` del proyecto. El PIN nunca queda escrito en ningún lado.
- **Plan por defecto del despliegue:** variable de entorno `MESA_PLAN=GOLD` o `MESA_PLAN=PREMIUM` en el despliegue.
  En Firebase va en el archivo `firebase/functions/.env.<proyecto>`.
- **Módulos sueltos:** `MESA_MODULOS=RECOMPENSAS` agrega un módulo fuera de plan.
- **Andrade hoy (16/10/2026):** plan Premium activado desde ⚙ Licencia (despliegue en Básico). Servidor en `andrade-mesapyae-staging`; pantallas en el sitio de Netlify `andrade-mesapyae`, que publica la rama **`estable`** con `MESA_LOCAL=andrade`, en **https://pedidos.andradecasacafe.com** (CNAME `pedidos` en Namecheap; la web de Lovable sigue en el dominio principal). Repositorio: `ser-o-limites/mesa-pyae` (organización de GitHub de Ser o Límites, plan Team).
- **PIN de `sol` en la bóveda central (E3, 23/10/2026):** proyecto `mesapyae-central` (carpeta Mesa Pyae), secreto `MESA_PLATAFORMA` en Secret Manager con la línea `sol:sal:hash` (nunca el PIN). `firebase/desplegar.sh` la toma de ahí y no pide el PIN; si la bóveda no existe o está vacía, pide el PIN **dos veces** y, si existe el proyecto central, lo guarda. Cambiar el PIN de sol: `node tools/plataforma-pin.js sol | cut -d= -f2- | tr -d '\n' | gcloud secrets versions add MESA_PLATAFORMA --data-file=- --project mesapyae-central` y volver a publicar cada local borrando antes la línea `MESA_PLATAFORMA` de su `.env`. Otro proyecto central: `MESA_CENTRAL=<id>`. Prueba: `tests/desplegar.test.js`.
- **Publicar el servidor de un local:** `sh tools/paquete_local.sh mesa-local.tgz <local>` (para Andrade: `andrade`), subirlo a Cloud Shell y correr `sh firebase/desplegar.sh <proyecto>` (verifica md5; la primera vez pide el PIN de `sol`, visible y se borra al Enter). Sin `<local>` el paquete sale sin carta.
- **Demo pública:** https://mesapyae-demo.web.app (Firebase Hosting). Se publica con un botón: GitHub → Actions → **publicar-demo** (rama `main` o `estable`), que arma `tools/paquete_demo.sh` y corre `firebase/desplegar.sh mesapyae-demo PREMIUM demo`. (A mano en Cloud Shell, si hiciera falta, con esos mismos dos comandos.)
- **Lo de Rolo (23/10/2026):** servidor `lo-de-rolo-mesapyae`, sitio Netlify `lo-de-rolo-mesapyae` (rama `estable`, `MESA_LOCAL=lo-de-rolo`), plan Básico.
- **Fotos de productos:** campo `imagen` (link https o `imagenes/x.jpg`), módulo `FOTOS` (Gold y Premium). Ser o Límites ofrece sesión de fotos como servicio aparte. Las fotos de la demo son de Unsplash (`demo/fotos-demo.json`).
- **Demo:** `PLAN=PREMIUM OUT=dist-demo-planes sh tools/build_demo.sh` genera la demo. Trae un selector de plan en
  la barra superior y datos de ejemplo ficticios: 32 clientes, 24 opiniones y 3 modelos 3D de `demo/modelos`.

- **Pedir la cuenta desde el celular:** en la carta de una mesa, el cliente ve su consumo, elige ticket o factura (RUC/CI y razón social), cómo paga y con cuánto (vuelto), y si pagan por separado. Acciones `public.cuenta` y `public.pedirCuenta`; queda en `Cuentas.cierre_pedido`. El mozo y la caja reciben aviso con sonido y la caja abre el cobro precargado. Se apaga con `cuenta_qr_habilitada=NO` en Configuración.

- **Platos por día (menú semanal):** campo `dias` del producto (1 = lunes … 7 = domingo, vacío = todos los días). La carta muestra solo los del día con la etiqueta "Hoy · Jueves" y el pedido de otro día se rechaza (`PRODUCTO_OTRO_DIA`). Se marca en Administración → Catálogo → Editar.

- **Para llevar del QR atendido por el equipo (pedido de Andrade, 20/10/2026):** Configuración `para_llevar_qr_atiende` = `CAJA` (por defecto: lo acepta y cobra la caja de para llevar, como siempre) o `EQUIPO`: el pedido para llevar del QR/web lo aceptan, rechazan y entregan los mozos marcados "Atiende para llevar" (Administración → Usuarios, ej. el mozo de barra) y la caja del salón, que también lo cobra; la caja de para llevar solo recibe el aviso. Todo el equipo de atención recibe aviso con sonido y alertas a los minutos de `para_llevar_alerta_min` (por defecto 3,5) si sigue sin aceptar. Los mozos ven la pestaña "🥡 Para llevar". Pruebas: `tests/llevar.test.js` y `tests/e2e-llevar.js`.

- **WhatsApp del cliente en para llevar (pedido de Andrade, 20/10/2026, pensando en delivery):** Configuración `para_llevar_whatsapp` = `NO` (por defecto) / `OPCIONAL` / `OBLIGATORIO`. En la carta para llevar (no en la mesa) se pide "Tu WhatsApp"; se guarda normalizado (`595981…`) en `Pedidos.whatsapp` y `Cuentas.whatsapp`. Las promociones van en una casilla **aparte y sin marcar** (`Cuentas.acepta_promos` SI/NO): sin esa casilla no se le manda publicidad. El ticket del equipo muestra el número y el botón "Avisar por WhatsApp" (link wa.me con el mensaje "tu pedido ya está listo"; se envía desde el teléfono del local, no es automático). El estado público del pedido no muestra el número. Si el local tiene Recompensas, el número vincula al cliente del club.

- **Cambiar de mesa (pedido de Andrade, 20/10/2026):** en la mesa abierta, el mozo toca "🔀 Cambiar de mesa" y elige una mesa **libre** del mismo salón (sin cuenta, no "pagada · aún ocupada" ni reservada en bloqueo). Acción `mesa.cambiar` (`mesa_id`, `destino_id`; mozo, admin o la caja de esa cuenta). Se mueven la cuenta y todos sus pedidos (también los de cocina), personas, pedido de cuenta y tarjeta del club; la mesa vieja queda libre y el QR de la nueva entra a la misma cuenta. Quedan `Cuentas.mesa_antes`/`trasladada_en`/`trasladada_por` y la auditoría `MESA_CAMBIADA`. Todo el personal recibe aviso con sonido (`sync.traslados`) y los tickets anteriores dicen "antes Mesa 3". "Juntar mesas" (a una mesa ocupada) quedó fuera a propósito. Pruebas: `tests/mesa.test.js` y `tests/e2e-mesa.js`.

- **Imprimir comanda (pedido de Andrade, 20/10/2026):** cada ticket (cocina, mozo, cajas) tiene el botón "🖨". Imprime la comanda en formato de impresora de tickets (58/80 mm, también sirve en A4) con la impresora que tenga ese equipo: número grande, mesa (o "PARA LLEVAR · nombre"), hora, platos con opciones, persona y observaciones. En cocina sale sin precios; en mozo y caja, con precios y total. Usa el diálogo de impresión del navegador (no es impresión automática). Código en `public/assets/comandas.js` y estilos `#comanda-print` en `app.css`. Prueba: `tests/e2e-imprimir.js`.

- **Ticket que trae clientes de vuelta (Premium, 20/10/2026):** con Recompensas activo, el **comprobante del cobro** y el **ticket para llevar** (impreso desde mozo o caja) llevan al pie el QR para sacar la tarjeta del club (`tarjeta.html`), el primer premio ("10 sellos: Café gratis") y un mensaje propio del local. Se configura en Administración → Recompensas → Reglas: `rec_ticket_qr` (SI por defecto) y `rec_ticket_mensaje` (hasta 120 caracteres). Si el cobro ya está vinculado a un cliente del club, el comprobante no repite el QR. La comanda de cocina y la de las mesas no llevan pie. Nunca lleva QR a reseñas de Google. Básico y Gold: sin pie. Pruebas: `tests/ticket.test.js` y `tests/e2e-imprimir.js`.

- **Factura en e-Kuatia'i (DNIT) desde la caja (22/10/2026):** extensión de Chrome `extension/migrador-ekuatiai` (Manifest V3, ID fijo `cdjnkjemaniamlfcdpccchenabkfbfgf`). **Upgrade aparte (módulo `EKUATIAI`, 23/10/2026).** En Caja → Turno y cierre, cada cobro con factura muestra "🧾 e-Kuatia'i" **solo si el local tiene el Upgrade activo y ese navegador tiene la extensión** (`public/assets/facturador.js` la detecta; sin ella la caja no cambia). Arma receptor (RUC + DV o CI), ítems de la cuenta (o de las personas cobradas + lo compartido; si no cuadra, una línea con lo cobrado), descuento repartido e IVA 10 %; la extensión enfoca o abre e-Kuatia'i y rellena "Nueva factura" (consulta el RUC con el botón Buscar del portal). **Nunca** inicia sesión, ni escribe el PIN, ni emite, ni llama a servidores de la DNIT. Evita duplicados por `cobro_id`. Si la DNIT cambia la pantalla: ícono de la extensión → Revisar / Calibrar campos. Por local: `node tools/extension_local.js <local> [sitio netlify]` (agrega su dominio a `externally_connectable`). Pruebas: `tests/ekuatiai.test.js` y `tests/e2e-ekuatiai.js` (formulario simulado). Ver `extension/migrador-ekuatiai/README.md`.

- **Estaciones de preparación (todos los planes, 28/10/2026):** Configuración `estaciones` (ej. `Cocina, Barra 1, Barra 2`, de 1 a 6; la primera es la de por defecto). Cada categoría tiene su estación (Catálogo → Categorías) y un producto puede cambiarla (Editar). Cada línea del pedido guarda su estación al pedirse (`PedidoItems.estacion`; cambiar la categoría después no mueve pedidos hechos). Cocina → "Esta pantalla es de:" (Todas / cada estación, guardado en el equipo): cada estación ve solo sus platos y marca su parte con `order.station` (NUEVO → EN_PREPARACION → LISTO, guardado en `Pedidos.estaciones`); el pedido queda LISTO cuando terminan todas. `order.state` del pedido entero mueve todas las estaciones (un local con una sola estación funciona como antes). Los tickets (Todas, mozo, caja) muestran cómo va cada estación; la comanda impresa en una estación lleva su nombre y solo sus platos. Si se borra una estación de la configuración, sus comandas pasan a la primera. Reporte: `tiempos_por_estacion`. Pruebas: `tests/estaciones.test.js` y `tests/e2e-estaciones.js`.

- **Mesa Viru · stock y costos (Upgrade `STOCK`, 28/10/2026; nombre comercial desde 29/10/2026):** tablas `Insumos` (stock en unidades base enteras G/ML/UN, `costo_mil_gs` = costo promedio ponderado en Gs. por 1.000 unidades base, `minimo`), `MovStock` (eventos que no se editan ni se borran: COMPRA, VENTA, DEVOLUCION, CONTEO, MERMA) y `Recetas` (clave fija producto|opción|insumo; quitar una línea = cantidad 0). Acciones (solo ADMIN, con el Upgrade): `stock.data`, `stock.insumo`, `stock.receta`, `stock.compra`, `stock.conteo`, `stock.merma` (las tres últimas idempotentes por `request_id`). La venta descuenta cuando el pedido queda aceptado (QR: al aceptarlo); cada línea guarda `costo_gs` y `consumo`; en MovStock va un movimiento por insumo y pedido (límite de escrituras de Firestore). Cancelar/anular antes de EN_PREPARACION devuelve el stock; después es consumo sin venta. Vender sin stock no se bloquea (queda negativo; la compra siguiente fija el costo). Dinero siempre en guaraníes enteros (`divRound`). `admin.report.stock`: costo de ventas, ganancia bruta, margen por plato, consumo por insumo, compras, mermas, conteos y consumo sin venta. Reinicio de datos: borra MovStock, stock a cero, conserva insumos, costos y recetas. Pantalla: `public/assets/stock.js`. Demo: "+ Mesa Viru" en la barra (insumos y recetas ficticios). Pruebas: `tests/stock.test.js` (incluye Firestore) y `tests/e2e-stock.js`.

- **Cargar la carta con IA (todos los planes, 29/10/2026):** Administración → Catálogo → "📷 Cargar carta con IA". El encargado sube hasta 4 fotos (se achican en el navegador a JPG de 1800 px) o un PDF de hasta 4 MB; el servidor la lee con **Gemini en Vertex AI** (`core/carta-ia.js`, modelo `gemini-3.8-flash`, endpoint `global`; cambiar con `MESA_IA_MODELO` / `MESA_IA_REGION`) usando la cuenta de servicio de la función (sin claves). Acción `carta.leer` (asíncrona, fuera del núcleo: `firebase/functions/index.js`, `server/dev-server.js` y la demo; en desarrollo y en la demo devuelve una carta de ejemplo ficticia). El núcleo valida ADMIN y cuenta el uso (`carta.iaUso`, hasta 20 lecturas por día y local, Contadores `ia:<fecha>`). La propuesta se revisa en una tabla editable: lo que no tiene precio legible o ya está en la carta queda sin marcar; nunca se inventan precios. `admin.importarCarta` (idempotente por `request_id`) crea categorías y productos **Por validar**, sin duplicar (categoría + nombre), con las variantes anotadas en la nota. Las opciones (grupos) se arman a mano después. La lectura va **directo al servidor del local** (`MESA_CONFIG.apiDirecta`, lo escribe `tools/marca_local.py` desde `sitio.api_url`) porque el proxy de Netlify corta a los 26 s; el servidor responde CORS sin cookies (la sesión va como token en el cuerpo) y, si la llamada directa no sale, se reintenta por `/api`. Las pruebas quitan `apiDirecta` para no tocar servidores reales. `firebase/desplegar.sh` activa `aiplatform.googleapis.com` y da `roles/aiplatform.user` a la cuenta del servidor. Pruebas: `tests/carta-ia.test.js` y `tests/e2e-carta-ia.js`.

- **Atención Integrada · avisos por WhatsApp (Upgrade `ATENCION`, 30/10/2026):** cada local tiene su propia cuenta de Whaticket (modelo mayorista de Ser o Límites) y su token en Secret Manager del proyecto del local (`WHATICKET_TOKEN`; `firebase/desplegar.sh` lo crea con «pendiente» para que la función se publique; cargar el real con `printf '%s' "<token>" | gcloud secrets versions add WHATICKET_TOKEN --data-file=- --project <proyecto>` y volver a publicar). El token nunca pasa por el navegador ni por Firestore. Administración → **💬 WhatsApp**: `sol` toca «Probar conexión» (acción `wa.probar`, fuera del núcleo: `core/atencion-wa.js`, `firebase/functions/index.js`, `server/dev-server.js` y la demo) y elige el número (`wa_conexion_id`); el encargado elige `wa_avisos` = NO / LISTO / AMBOS y edita los mensajes (`{nombre}`, `{numero}`, `{local}`). Necesita `para_llevar_whatsapp` = OPCIONAL u OBLIGATORIO. El núcleo deja el aviso en la tabla `AvisosWA` dentro de la misma transacción (uno por pedido y tipo: RECIBIDO al aceptar, LISTO al quedar listo, también por estaciones o por ítem anulado) y el servidor lo envía por Whaticket (`POST /messages`, sin `ticketData`: queda en «Resueltos» y no llena la bandeja) después de cada acción de pedidos (`AtencionWA.DISPARAN`), sin frenar la respuesta más de 8 s; reintenta hasta 3 veces y lo que falla queda en «No salió». Las llamadas internas (`sistema.avisosWA`, `sistema.avisoResultado`) van firmadas con `SESSION_SECRET` y hora (5 min). Lo enviado o fallido se borra a los 7 días; «Reiniciar datos» vacía la cola. **Costo:** en una conexión QR cada aviso es un mensaje de campaña y consume créditos de Whaticket (referencia documental: 1.000 créditos ≈ USD 25, verificar vigencia). Demo: «+ Atención» en la barra (Whaticket simulado). Pruebas: `tests/atencion.test.js` y `tests/e2e-atencion.js`.

- **Armá tu pedido (Upgrade `ARMADOR`, 30/10/2026):** pantalla animada en la carta QR (`public/assets/armador.js`, dibujos SVG propios, sin fotos) para los productos con `Productos.armador` = `PIZZA`, `PORCION` (slice) o `HAMBURGUESA`. Dibujos en `public/assets/armador-dibujos.js` (ilustraciones propias; los ingredientes de la pizza se reparten parejo). Usa los grupos de opciones de siempre, así los precios salen del catálogo: grupo con `tipo` **TAMANO** (en la pizza cambia el tamaño del dibujo), grupo `tipo` **QUITAR** = lo que trae el plato (el cliente lo saca sin costo; la comanda dice "Sin cebolla"; diferencia de precio siempre 0), grupos de una sola elección (pan, proteína) como botones y grupos de agregados como grilla. `Grupos.repetir` (1 a 5) permite pedir una opción varias veces (doble carne): cada vez se cobra, la comanda dice "+ Carne x2" y Mesa Viru descuenta la receta de esa opción tantas veces. `Opciones.dibujo` elige el dibujo (QUESO, PEPPERONI, CARNE, PAN_NEGRO…); vacío = se adivina por el nombre ("Locote" → morrón). Lo de `tipo`, `repetir` y "Sin…" funciona en todos los planes (mozo y caja ven contador y "Sin…" en la lista de opciones); solo la animación es del Upgrade: sin él, la carta muestra la lista de siempre. Al agregar, la pizza y la porción se hornean y se cierran en su caja (octogonal / triangular) y la hamburguesa en su caja; las cajas llevan el logo de Mesa Pya'e (`assets/mesapyae-logo.png`). Administración → Catálogo → Editar ("Armá tu pedido") y Grupos de opciones (tipo, "se puede pedir hasta", dibujo). Demo: "+ Armá tu pedido" en la barra (pizzas, porción y hamburguesas de ejemplo). Pruebas: `tests/armador.test.js` y `tests/e2e-armador.js`.

- **Empezar de cero (después de la capacitación):** Administración → ⚙ Licencia → "Reiniciar datos de prueba" (solo `sol`, escribiendo REINICIAR). Acción `plataforma.reiniciar`: borra pedidos, cuentas, cobros, turnos, movimientos, reseñas y clientes/sellos/cupones del programa (también lo archivado); conserva carta, mesas y QR, usuarios, configuración, licencia, premios y auditoría. En Firebase guarda antes una copia en la colección `respaldo`. Exige cajas cerradas y ninguna cuenta sin cobrar.

## Arquitectura

- **Núcleo:** `core/core.js` concentra todas las reglas de negocio. Es portable: corre igual en Node, Apps Script
  y el navegador (demo). Recibe `store` y `env`; `env.plan` y `env.modulos` definen la licencia.
- **Backend real:** `firebase/` (Cloud Functions gen2 + Firestore, región southamerica-east1).
  `sh tools/build_firebase.sh` copia el núcleo a `firebase/functions/lib`.
- **Pantallas:** `public/`.
  - **Clientes:** `menu.html`, `tarjeta.html`, `resena.html`.
  - **Personal:** `pedidos.html`, `cocina.html`, `caja.html`, `admin.html`.
  - **Piezas compartidas:** `assets/lib.js`, `assets/composer.js`, `assets/rec.js`, `assets/menu3d.js`.
- **Visor 3D:** usa `@google/model-viewer@3.5.0` desde jsDelivr y se carga solo al tocar "3D".
  Los modelos son archivos `.glb` por producto (campo `modelo_3d`).
- **Pruebas:**
  - Por API: `npm test`, que incluye `api`, `recompensas`, `planes`, `cuenta`, `locales`, `llevar`, `mesa`, `ticket`, `ekuatiai`, `desplegar`, `e3`, `sitio`, `estaciones`, `stock`, `carta-ia`, `atencion` y `armador`.
  - En navegador: `node tests/e2e.js`, `node tests/e2e-recompensas.js`, `node tests/e2e-gold.js`, `node tests/e2e-plataforma.js` `node tests/e2e-carta.js` (carta fluida en el celular) `node tests/e2e-cuenta.js` (pedir la cuenta desde el celular) `node tests/e2e-local.js` (un local de la matriz) `node tests/e2e-llevar.js` (para llevar atendido por el equipo) `node tests/e2e-mesa.js` (cambiar de mesa) `node tests/e2e-imprimir.js` (imprimir comanda) `node tests/e2e-ekuatiai.js` (factura en e-Kuatia'i con la extensión), `node tests/e2e-unico.js` (sitio único), `node tests/e2e-estaciones.js` (cocina y barra) `node tests/e2e-stock.js` (stock y costos) `node tests/e2e-carta-ia.js` (carta con IA), `node tests/e2e-atencion.js` (avisos por WhatsApp) y `node tests/e2e-armador.js` (Armá tu pedido).
  - Demo: `sh tools/build_demo.sh && node tests/demo-smoke.js` (incluye estaciones y los Upgrades Mesa Viru y Armá tu pedido).
- **Publicar el backend en staging:** desde Cloud Shell del usuario, aplicando un parche verificado con md5
  (ver `docs/manual-tecnico.md`).

## Matriz de locales (replicar en otro local)

Cada cliente es una carpeta `locales/<local>/` (`local.json`, `catalogo.json`, `logo.png`, íconos, `hoja.png` y `extra/` opcionales).
Paso a paso en `locales/README.md`. `public/` es la base neutra (marca Mesa Pya'e y textos marcadores como "Tu Local Gastronómico");
`data/catalogo-base.json` está vacío. Las pruebas usan `locales/andrade` como local de referencia; la demo, `demo/catalogo-demo.json`.
- **Ficha de alta → borrador:** `node tools/nuevo_local.js ficha.json <local>` (crea `local.json` y `PENDIENTES.md`).
- **Revisar:** `node tools/validar_local.js <local>`. **Íconos:** `python3 tools/iconos_local.py <local>`.
- **Servidor:** `sh tools/paquete_local.sh mesa-<local>.tgz <local>` (lleva su catálogo, nombre, puntos, cajas y mesas).
- **Sitio (E4 · sitio único, 24/10/2026):** un solo sitio de Netlify para todos los locales, **`mesapyae-locales`**
  (rama `estable`, `MESA_SITIO=LOCALES`) → **`https://mesapyae.serolimites.com/<local>/`** (`/menu`, `/caja`, `/admin`…;
  también `mesapyae-locales.netlify.app`). Dominio: CNAME `mesapyae` en Namecheap (serolimites.com) → `mesapyae-locales.netlify.app`.
  La raíz va a la página de ventas (`MESA_PORTADA=https://serolimites.com/empresas/sistemas/mesa-pyae` en Netlify).
  `tools/sitio_unico.py` copia `public/` por local, aplica `tools/marca_local.py`, manda su API por `/<local>/api`
  (reglas en `_redirects`), guarda lo del navegador con el nombre del local (`mesapyae.<local>.…`) y deja la app
  instalable dentro de `/<local>/`. Entra todo local con `sitio.api_url` (menos `ejemplo`). La raíz no lista clientes.
  Una sola extensión e-Kuatia'i: `node tools/extension_local.js todos <sitio>` (el sitio único + el `dominio` de cada local),
  publicada en `/extension/migrador-ekuatiai.zip`. Pruebas: `tests/sitio.test.js` y `tests/e2e-unico.js`.
  Andrade y Lo de Rolo conservan además su sitio propio (`MESA_LOCAL=<local>`, `tools/marca_local.py`).
- **Límites:** dos puntos (salón `A_CAFE` y para llevar `B_TAKEAWAY`, que se puede apagar) y una o dos cajas.
- `locales/ejemplo/` es ficticio (plantilla y pruebas). Pruebas: `tests/locales.test.js` y `tests/e2e-local.js`.
- **Pasar una mejora a los clientes:** con todas las pruebas en verde y la aprobación de Ser o Límites, pull request de
  `main` a `estable` (unir con bypass). Antes, revisar `git diff --stat origin/estable origin/main`: no tiene que borrar
  la carpeta de ningún local. Después: GitHub → Actions → **publicar-servidores** (`todos`, rama `estable`) si cambió el servidor.

**Lista de alta de un local nuevo:**
1. Proyecto Firebase propio.
2. Secretos `SESSION_SECRET`, `EXPORT_KEY` y `WHATICKET_TOKEN` (este último con el token real solo si contrató Atención Integrada).
3. `MESA_PLAN` según lo contratado.
4. Sitio: automático en el sitio único al unir a `estable` (o sitio Netlify propio si quiere su dominio).
5. Catálogo validado por el local.
6. Usuarios con PIN propio.
7. QR impresos.
8. Kit de bienvenida y manual.
