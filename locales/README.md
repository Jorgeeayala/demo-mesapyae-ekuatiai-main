# Matriz de locales de Mesa Pya'e

Cada cliente es una carpeta `locales/<local>/` con su configuración, su logo y su carta. El código es el mismo para
todos y `public/` es la base neutra de Mesa Pya'e. Andrade es un local más: `locales/andrade/`.

`locales/ejemplo/` es un local **ficticio** que sirve de plantilla y para las pruebas.

## Qué hay en la carpeta de un local

| Archivo | Qué es | Quién lo arma |
|---|---|---|
| `local.json` | Nombre, dirección, plan, colores, mesas, puntos, cajas, configuración, conexión con su servidor, equipo (sin PIN) | `tools/nuevo_local.js` desde la Ficha de alta, revisado a mano |
| `catalogo.json` | La carta (mismo formato que `locales/andrade/catalogo.json`) | Leyendo la carta del local. **Nunca se inventan productos ni precios**: lo dudoso queda `POR_VALIDAR` y se pregunta |
| `logo.png` | Logo del local (PNG, ideal con fondo transparente) | Se copia de la carpeta del local en Drive |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Íconos de la app | `python3 tools/iconos_local.py <local>` |
| `PENDIENTES.md` | Lo que falta confirmar con el local | `tools/nuevo_local.js` |
| `hoja.png` (opcional) | Adorno de la carta (sin él, ninguno) | El local |
| `extra/` (opcional) | Archivos propios que se suman al sitio (ej. `extra/prueba.html` de Andrade) | Ser o Límites |

`local.json` **nunca** guarda PIN, contraseñas ni tokens (el validador lo frena). `locales/*/privado/` está en `.gitignore`.

## Alta de un local, paso a paso

1. **Ficha → borrador.** Bajar `ficha.json` de la carpeta del local en Drive y correr
   `node tools/nuevo_local.js ficha.json <local>` (local = minúsculas y guiones, ej. `pizzeria-don-luis`).
2. **Logo e íconos.** Copiar el logo a `locales/<local>/logo.png` y correr `python3 tools/iconos_local.py <local>`.
3. **Carta.** Armar `locales/<local>/catalogo.json` desde la carta del local. Ids en MAYÚSCULAS; `puntos` = `A_CAFE`
   (salón) y/o `B_TAKEAWAY` (para llevar); `dias` = 1 (lunes) … 7 (domingo) para platos por día.
4. **Revisar.** `node tools/validar_local.js <local>` hasta que no queden errores. Resolver o anotar los avisos y `PENDIENTES.md`.
5. **Servidor (botón en GitHub, sin Cloud Shell).** Con la carpeta del local ya en la rama `estable` (entra por pull request;
   solo agrega `locales/<local>/`), GitHub → Actions → **alta-local** → Run workflow: local = `<local>`, rama = `estable`.
   Crea el proyecto en `Mesa Pyae / Clientes`, le vincula la facturación, le pone el presupuesto de USD 10 (solo alertas),
   lo agrega a Firebase, publica el servidor (PIN de `sol` desde la bóveda central), verifica que responde y abre un pull
   request con los datos del sitio (`local.json → sitio`). En ese pull request: "Approve workflows to run", esperar
   `pruebas` en verde y unirlo. (A mano, si hiciera falta: `sh tools/paquete_local.sh` + `firebase/desplegar.sh` en Cloud Shell.)
6. **Sitio (E4 · sitio único, automático).** Al unir ese pull request a `estable`, el local aparece solo en el sitio único
   **https://mesapyae.serolimites.com/<local>/** (carta `/<local>/menu`, personal `/<local>/`, caja `/<local>/caja`…).
   No hace falta crear un sitio de Netlify. Si el local quiere su propio dominio (ej. `pedidos.<dominio>`), se le puede
   seguir creando un sitio propio como antes (rama `estable`, `MESA_LOCAL=<local>`) y poner su `dominio` en `local.json`.
7. **Plan y Upgrades.** Entrar con `sol` → Administración → ⚙ Licencia y activar el plan pagado. Si contrató
   **e-Kuatia'i** (Upgrade aparte, sobre cualquier plan): ⚙ Licencia → Upgrades → Activar, e instalar en la PC de la caja
   la extensión única (descargarla de `https://mesapyae.serolimites.com/extension/migrador-ekuatiai.zip`; sirve para
   todos los locales del sitio único y los que tienen `dominio` propio en `local.json`).
   Antes, confirmar que el local tiene un solo establecimiento y un punto de expedición en la DNIT.
8. **Validación y capacitación.** El encargado revisa la carta; se crean los usuarios (cada uno elige su PIN),
   se imprimen los QR y, antes de salir, ⚙ Licencia → "Reiniciar datos de prueba".

### Opciones que se deciden con el local (vienen apagadas)

Se pueden dejar ya en `local.json → config` (se aplican al crear el servidor, nunca pisan un local en marcha)
o cambiar después en Administración → Configuración:

| Clave | Valores | Para qué |
|---|---|---|
| `para_llevar_qr_atiende` | `CAJA` (por defecto) / `EQUIPO` | Con `EQUIPO`, el para llevar del QR lo atienden los mozos marcados "Atiende para llevar" (Usuarios) y la caja del salón |
| `para_llevar_alerta_min` | ej. `3,5` | Minutos de las alertas si el para llevar sigue sin aceptar |
| `para_llevar_whatsapp` | `NO` (por defecto) / `OPCIONAL` / `OBLIGATORIO` | Pedir el WhatsApp del cliente en para llevar (promociones en casilla aparte) |
| `cuenta_qr_habilitada` | `SI` (siempre, en todas las altas) / `NO` | Pedir la cuenta desde el celular. Viene activado aunque la ficha diga que no; se apaga solo si el local lo pide después de verlo en la capacitación |

Sin configuración, todos los locales tienen además "🔀 Cambiar de mesa" (mozo) e "🖨 Imprimir comanda" (cocina, mozo y caja).

## Límites de esta versión

- Dos puntos de venta como máximo: salón (`A_CAFE`) y para llevar o mostrador (`B_TAKEAWAY`, se puede apagar).
- Una o dos cajas (Caja 01 y Caja 02).
- Un proyecto de Firebase por local. La Fase 2 (un solo servidor para muchos locales) lo simplifica.

## Pruebas

- `node --test tests/locales.test.js`: validador, marca, servidor de un local, local sin para llevar, ficha → borrador,
  y que Andrade no cambie.
- `node tests/e2e-local.js`: el local de ejemplo en el navegador (carta, pedido, para llevar, personal).
