# Migrador e-Kuatia'i (extensión de Chrome, Manifest V3)

Pasa el detalle de un cobro con factura de la **caja de Mesa Pya'e** al formulario **Nueva factura** de
e-Kuatia'i (DNIT), sin volver a tipear RUC, razón social ni ítems. La persona sigue haciendo lo que la ley
exige que haga una persona: iniciar sesión, poner el **PIN del certificado** y **emitir**.

## Bucle de facturación

1. En la caja, pestaña **Turno y cierre → Cobros del turno**, el cobro pedido con factura muestra **🧾 e-Kuatia'i**
   (solo en los navegadores que tienen la extensión; en los demás la caja queda igual que siempre).
2. La extensión trae al frente la pestaña de e-Kuatia'i si ya está abierta, o abre una nueva.
3. Si todavía no entraste: iniciá sesión con Marangatu **a mano** y abrí **Nueva factura**. Los datos se cargan solos:
   RUC + DV → clic en **Buscar** (el portal trae la razón social oficial) → correo → ítems con cantidad, precio,
   descuento e IVA 10 % → **Tipo de obligación afectada** 211 (IVA) → un **pago por cada medio** cobrado en la caja: elige el
   "Tipo de pago" (Efectivo, Transferencia, Tarjeta de crédito/débito…), pone el monto y toca **Agregar**.
4. Revisás, ponés **tu PIN** y emitís. La extensión nunca toca el PIN ni el botón de emitir.
5. Al ver el mensaje de éxito (o el formulario limpio) la extensión marca el cobro como facturado y queda esperando
   el siguiente. Si se vuelve a mandar el mismo cobro, la caja avisa antes de duplicar.

## Qué manda la caja (`public/assets/facturador.js`)

- **Receptor:** `80012345-6` se separa en RUC `80012345` y DV `6`; un número sin guion va como CI.
- **Ítems:** los de los pedidos de esa cuenta (sin anulados ni cancelados). En un cobro por personas, los de esas
  personas más su parte de lo compartido. Si algo no cuadra exacto, va **una sola línea** con el importe cobrado
  (nunca se inventan precios).
- **Descuento** del cobro: repartido entre los ítems; si el formulario no tiene casilla de descuento, se carga el
  importe neto por línea. La suma siempre coincide con lo cobrado (la extensión lo verifica).
- **IVA:** 10 % por defecto (gastronomía).
- **Pagos:** medio y monto de cada pago del cobro (`EFECTIVO`, `TRANSFERENCIA`, `TC`, `TD`…). En e-Kuatia'i, por
  cada uno: `ui-select` "Tipo de pago" → monto → botón Agregar (`emitir.agregarPago()`).
- **Obligación afectada:** `ui-select` múltiple `tipoObligacionAfectadaRG90`; por defecto **211 – IVA**. Se cambia en
  el ícono de la extensión → Portal → "Obligación afectada". Si ya está elegida, no la repite.

## Instalación (una vez por computadora de caja)

1. Armar la extensión del local: `node tools/extension_local.js <local> [sitio de Netlify]`
   (ej.: `node tools/extension_local.js andrade andrade-mesapyae.netlify.app`). Agrega el dominio del local a los
   sitios autorizados. La carpeta base solo acepta la demo, el sitio de pruebas y `127.0.0.1`/`localhost`.
2. En Chrome: `chrome://extensions` → **Modo de desarrollador** → **Cargar descomprimida** → elegir `dist-extension-<local>/`.
3. El ID queda fijo (`cdjnkjemaniamlfcdpccchenabkfbfgf`, sale de la clave del manifest): la caja lo encuentra sola.
4. Ícono de la extensión → **Portal**: Producción (`ekuatia.set.gov.py`) o Pruebas (`desa-ekuatia.set.gov.py`).

## Calibrar campos

El formulario real de e-Kuatia'i no es público y la DNIT puede cambiarlo. El migrador busca cada campo por sus
atributos (`ng-model`, `name`, `placeholder`…) y por el texto de su etiqueta; nunca toca campos del **emisor**.
Si algo no se encuentra:

1. Abrí **Nueva factura** (con al menos una fila de ítem a la vista).
2. Ícono de la extensión → **Revisar**: muestra qué campos encuentra (✔ / ✘).
3. **Calibrar campos**: hacé clic, en orden, en cada campo que pide el cartel (o “Saltar” si no existe).
   Los clics no se ejecutan; solo se guardan. Queda guardado en ese navegador.

## Límites a propósito (Ley 4439/11 y seguridad de la DNIT)

- **Sin inicio de sesión automático:** el usuario y la clave de Marangatu siempre se escriben a mano.
- **Sin firma automática:** el PIN del certificado nunca se guarda ni lo escribe el código.
- **Sin conexión propia a la DNIT:** no hace peticiones HTTP a sus servidores; solo completa la pantalla, como un
  “copiar y pegar” inteligente. La prueba `tests/ekuatiai.test.js` verifica que el código no use `fetch`/XHR.
- **Solo recibe de sitios autorizados:** `externally_connectable` y una segunda verificación en el service worker.

## Archivos

| Archivo | Qué hace |
|---|---|
| `manifest.json` | Permisos (`tabs`, `storage`), hosts de e-Kuatia'i, sitios autorizados, clave del ID fijo |
| `service-worker.js` | Recibe la factura, la valida, evita duplicados, enfoca o abre e-Kuatia'i |
| `factura.js` | Validación del paquete (también en las pruebas de Node) |
| `campos.js` | Campos del formulario, pistas para encontrarlos y selectores de calibración |
| `content.js` / `content.css` | Relleno, cartel de estado, detección de “emitida”, calibración |
| `popup.html` / `popup.js` | Estado, portal, revisar/calibrar campos, últimas facturas |

Pruebas: `node --test tests/ekuatiai.test.js` y `node tests/e2e-ekuatiai.js` (Chromium con la extensión y un
formulario **simulado** de e-Kuatia'i en `tests/fixtures/ekuatiai-simulado.html`).
