# Mesa Pya'e — sistema de pedidos para gastronomía (Ser o Límites)

> `main` es la base neutra del producto (piloto y demo). Cada cliente vive en `locales/<local>/` y sus sitios publican la rama `estable`. Ver `CLAUDE.md` y `locales/README.md`. Lo que sigue es la documentación histórica del primer local, Andrade Casa Café y Arte.

## Andrade Casa Café y Arte (primer local)

Sistema de pedidos conectado para Andrade: menú QR, panel de mozos, cocina, **Caja 01 (Cafetería)** y **Caja 02 (Takeaway)** con turnos y cierres independientes, administración, reportes y auditoría.

Desarrollado por Ser o Límites E.A.S. · Plan Mesa Pya'e Básico · v1.0 (pruebas).

```
public/              Páginas para Netlify (menu, pedidos, cocina, caja, admin) y assets
core/core.js         Reglas de negocio (único núcleo: Node, Apps Script y demo)
firebase/            Backend de producción: Cloud Functions + Firestore (tools/build_firebase.sh)
alternativas/        Variante Apps Script + Google Sheets (mismo núcleo)
server/              Servidor local de desarrollo
locales/andrade/catalogo.json   Carta normalizada (verificada contra el Excel fuente)
appsheet/            Planilla del portal AppSheet
demo/                Modo demo en navegador (tools/build_demo.sh → dist-demo/)
tests/               API, Apps Script emulado, proxy Netlify, E2E en navegador
docs/                Manual técnico, AppSheet, inventario, registro de pruebas
entregables/         Excel de validación de carta para Pablo
```

Inicio rápido: `node server/dev-server.js`, y luego abrir http://127.0.0.1:8787.
Inicio con Firebase simulado: `node server/dev-server.js --backend firebase`.
Pruebas: `npm test && node tests/e2e.js && BACKEND=firebase node tests/e2e.js`.

Antes de cualquier publicación, leer `docs/manual-tecnico.md`.
