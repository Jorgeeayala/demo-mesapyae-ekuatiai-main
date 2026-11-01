# Registro de pruebas — Mesa Pya'e Andrade

**Ejecución:** 09/10/2026, entorno de desarrollo de SoL.

**Resultado:**
- 24/24 pruebas automáticas de API y backend;
- recorrido completo en navegador real (E2E) de 14 pasos;
- prueba de humo de la demo.

**Cómo repetirlas:** ver `docs/manual-tecnico.md` §5. Las capturas del E2E están en `tests/capturas/`.

> **Alcance real.** Todas se ejecutaron contra el servidor local y contra un **emulador** de Apps Script, Google Sheets y Netlify. **Todavía no se ejecutaron sobre la infraestructura de Google ni de Netlify** porque falta el despliegue, que requiere cuentas y aprobación. Las pruebas en dispositivos físicos y el piloto con el personal (fase 8) siguen pendientes.

## Pruebas de aceptación del pedido (prompt §18)

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| 1 | Crear pedido para una mesa | ✅ | E2E: A-001 por QR de Mesa 3 y A-002 cargado por mozo en Mesa 5 |
| 2 | Crear pedido takeaway | ✅ | E2E: T-001 (venta en Caja 02) y T-002 (QR de la casita, nombre obligatorio) |
| 3 | Enviar correctamente ambos pedidos | ✅ | E2E y API 1, 9 |
| 4 | Visualizarlos en cocina | ✅ | E2E: cocina recibe A-001, A-002 y T-002, sin precios |
| 5 | Cambiar estados | ✅ | API 7: transiciones por rol, conflicto entre dispositivos, historial completo |
| 6 | Verificar observaciones y variantes | ✅ | E2E: "sin tomate", "Traer todo junto", pan y syrup visibles en cocina |
| 7 | Cobro en Caja 01 | ✅ | E2E: efectivo con vuelto y pago dividido efectivo + tarjeta |
| 8 | Cobro en Caja 02 | ✅ | E2E: transferencia; API 9: descuento con autorización |
| 9 | Confirmar que no se mezclen | ✅ | API 9: cajera A no puede operar B ni al revés; E2E: URL forzada a Caja 02 rechazada |
| 10 | Cierre independiente | ✅ | API 9 y E2E: Caja 01 cierra con −Gs. 1.000 y observación obligatoria; Caja 02 sigue abierta |
| 11 | Reporte consolidado | ✅ | E2E: Caja 01 Gs. 165.000 + Caja 02 Gs. 30.000 = Gs. 195.000, desglosado por medio |
| 12 | Modificar disponibilidad | ✅ | E2E: cocina marca agotado; API 4: el pedido se rechaza aunque la página siga abierta |
| 13 | Dos pedidos simultáneos | ✅ | API 19: 40 pedidos concurrentes desde 10 mesas, sin mezcla de mesa ni de productos |
| 14 | Evitar duplicados | ✅ | API 5 y 19: reintentos con el mismo `request_id` dan 1 solo pedido; E2E: reintento tras corte de red |
| 15 | Roles sin permisos administrativos | ✅ | API 10: mozo, cocina y cajas no pueden editar catálogo, usuarios, configuración ni reportes; tokens adulterados rechazados |
| 16 | Fallos de conexión | ✅ | E2E: aviso "Sin conexión", el carrito se conserva y se registra una sola vez; Netlify: backend caído devuelve 504 |
| 17 | Actualización en cocina | ✅ (local) | E2E: aparición automática por sondeo de 3 s. **Pendiente** medir con Apps Script real en hora pico |
| 18 | Celulares y tablets | ✅ (emulado) | E2E: 390×844 (celular), 820×1180 (tablet), 1440×900 (escritorio). **Pendiente** en equipos físicos de Andrade |

## Matriz T01–T20 del plan técnico

| ID | Estado | Detalle |
|---|---|---|
| T01–T02 | ✅ | El QR resuelve por token aleatorio; cambiar el número en la URL no sirve |
| T03–T08 | ✅ | Precios simples, pan, carne o pollo, jugo 250/500 ml, pizza personal y combo con elecciones obligatorias |
| T09 | ✅ | Producto inactivo o agotado rechazado en el servidor |
| T10–T11 | ✅ | Doble toque y concurrencia |
| T12 | ✅ local / ⏳ real | Visibilidad en cocina; medir latencia con Apps Script |
| T13 | ✅ | Transiciones por rol; cancelación con motivo y autorización |
| T14–T16 | ✅ | Cajas A y B, cierres y reporte |
| T17 | ✅ | Aviso y procedimiento de contingencia |
| T18 | ✅ | Un cliente anónimo no puede leer pedidos ajenos ni datos de caja |
| T19 | ✅ | Precio manipulado ignorado (Aperol enviado a Gs. 1 se registra a Gs. 55.000) |
| T20 | ⏳ | Piloto en hora pico de almuerzo con el personal |

## Pruebas adicionales

- **Catálogo:** las 101 filas del Excel fuente se recalcularon con el modelo normalizado, con 0 diferencias de precio (`tools/build_catalog.py`).
- **Backend Apps Script (emulado):**
  - hojas en formato texto (Sheets no convierte fechas ni números);
  - fórmulas inyectadas (`=IMPORTRANGE…`) guardadas como texto;
  - un error de validación no deja escrituras parciales;
  - la caché se invalida al editar a mano.
- **Seguridad:**
  - PIN guardado con hash y sal, nunca en texto plano;
  - bloqueo tras 5 intentos;
  - al cambiar el rol se cierran las sesiones abiertas;
  - el secreto del proxy nunca llega al navegador.
- **Códigos QR:** el generador propio fue verificado con un decodificador independiente (OpenCV) en 5 de 5 casos, incluidos acentos.
- **Archivo diario:** lo archivado sigue apareciendo en los reportes.

## Alertas de demora en cocina (agregado 09/10/2026)

**Prueba `tests/demora.test.js`** (navegador real, umbrales de prueba 1, 2 y 3 min):

- la tarjeta pasa a amarillo, luego a naranja y luego a rojo;
- en cada nivel suena una alarma (3 en total) y no se repite dentro del mismo nivel;
- al marcar *Listo* deja de figurar demorado;
- la configuración inválida se rechaza.

## Versión Firebase (09/10/2026)

Todas corridas sobre un **simulador de Firestore**: reproduce transacciones con conflicto, lotes, límite de 1 MiB y conteo de lecturas y escrituras. La prueba sobre Firebase real queda para el proyecto de staging.

| Prueba | Resultado |
|---|---|
| Primera ejecución crea catálogo, mesas, cajas y admin una sola vez; el PIN no queda en texto plano | ✅ |
| Flujo completo repartido entre dos instancias de la función: pedido, cocina, cobro TD + efectivo, cierre y reporte | ✅ |
| 60 pedidos simultáneos en 3 instancias, con reintentos duplicados: 60 pedidos, números únicos, mesa y total correctos | ✅ (3/3 corridas) |
| Estrés: 150 pedidos simultáneos en 5 instancias: datos consistentes; el límite global de seguridad frenó 30, como corresponde | ✅ |
| Dos cajas cobrando la misma cuenta a la vez desde instancias distintas: un solo cobro, el otro recibe YA_COBRADA | ✅ |
| Costo: consulta sin cambios = 1 lectura; ráfagas desde caché = 0 lecturas | ✅ |
| Un error de validación no escribe nada | ✅ |
| Archivo diario troceado por día, reportes desde el archivo y exportación del día | ✅ |
| Límite de pedidos por QR activo; los reintentos no consumen cupo | ✅ (se encontró y corrigió un error) |
| Recorrido completo E2E en navegador sobre Firebase (14 pasos) | ✅ |
| Tiempo real: pedido visible en cocina 40 ms después del pulso | ✅ |
| Función publicable (`index.js`) con módulos de Firebase simulados: api, GET 405, JSON inválido 400, exportación con y sin clave, archivo | ✅ |
| Exportación a Google Sheets (Apps Script con servicios simulados): no duplica al re-ejecutar | ✅ |
| Simulación de un día: 200 pedidos y 6 pantallas = 12.400 lecturas y 5.400 escrituras (gratis); 400 pedidos y 8 pantallas = 29.000 y 10.800 (gratis) | ✅ |

**Error encontrado y corregido:** cuando dos servidores chocaban y uno reintentaba, el reintento también consumía el cupo de "6 pedidos por QR cada 10 minutos". Ahora el cupo se descuenta una sola vez por pedido.

## Hallazgos corregidos durante las pruebas

1. En celulares, la barra de categorías ensanchaba la página. Se corrigió el ancho mínimo de la grilla.
2. El adorno botánico arrastraba líneas del marco de la carta. Se reemplazó por la hoja aislada de la carta.
3. Aparecía "desde" en cafés solo por el syrup opcional. Ahora solo se muestra si una opción obligatoria cambia el precio.
4. Se repetía "Pan: Pan ciabatta" en las comandas. Ahora dice "Pan ciabatta".
5. En la demo, los diálogos nativos de confirmación quedaban bloqueados. Se reemplazaron por confirmaciones dentro de la página.

## Firebase real — proyecto de prueba (09/10/2026)

| Prueba | Resultado |
|---|---|
| Publicación de reglas y de las 3 funciones (Node 22, São Paulo) | ✅ (exportDia falló en el primer intento por la creación inicial del depósito de Google; al reintentar, OK) |
| `health` contra la función real: responde y crea la base en la primera llamada | ✅ |
| QR falso rechazado (`QR_INVALIDO`) | ✅ |
| Acción de administración sin sesión rechazada (`NO_SESION`) | ✅ |
| `exportDia` sin clave rechazado (403) | ✅ |
| Tarea programada `archivoDiario` 05:00 activa | ✅ |
| Sitio publicado en Netlify (`andrade-mesapyae.netlify.app`), `/api` llega a la función | ✅ |
| **Prueba completa sobre el sistema real** (página `/prueba`, 20 pasos): usuarios con PIN al azar, PIN incorrecto rechazado, pedido QR de mesa con precio manipulado ignorado (Gs. 47.000), takeaway sin nombre rechazado, takeaway Gs. 16.000, Caja 02 sin acceso a la cafetería, cocina recibe ambos con observación, preparación → listo → entregado, cobro Caja 01 efectivo + TD sin duplicar, Caja 02 transferencia, cobro cruzado rechazado, cierres sin diferencia, reporte consolidado | ✅ 20/20 en 5 s (API 588 ms en frío) |
| Dispositivos físicos de Andrade y piloto con el personal | ⏳ |
