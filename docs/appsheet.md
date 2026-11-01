# AppSheet — portal de acceso del personal

AppSheet funciona como puerta de entrada, igual que en Coloso. Muestra a cada persona solo los módulos de su rol y los abre en el navegador. **No** guarda pedidos ni cobros: esos datos quedan en el backend de Mesa Pya'e, que exige el usuario y el PIN de cada persona.

## Datos
Subir `appsheet/ANDRADE_MESA_PYAE_ACCESO.xlsx` a Google Drive y abrirlo como Hoja de cálculo de Google. Tiene dos hojas:
- **Modulos**: `modulo_id`, `orden`, `nombre`, `descripcion`, `url`, `roles`. Reemplazar `https://andrade-mesapyae.netlify.app` por la dirección real de Netlify.
- **Accesos**: `email`, `nombre`, `rol`. Los roles posibles son ADMIN, MOZO, COCINA, CAJA_A y CAJA_B. Hay que cargar un correo de Google por persona.

## Construcción (aprox. 20 minutos)
1. En appsheet.com, entrar con la cuenta de Andrade/SoL y elegir **Create → App → Start with existing data**. Elegir la hoja anterior y ponerle de nombre `Andrade Mesa Pya'e`.
2. En **Data → Accesos**:
   - clave `email`;
   - solo lectura para todos (*Are updates allowed?* = Read-Only).
3. En **Data → Modulos**:
   - clave `modulo_id`;
   - solo lectura;
   - tipo de la columna `url` = **URL**.
4. En **Security filter de Modulos**:
   ```
   OR(
     LOOKUP(USEREMAIL(), "Accesos", "email", "rol") = "ADMIN",
     IN(LOOKUP(USEREMAIL(), "Accesos", "email", "rol"), SPLIT([roles], ","))
   )
   ```
   **Security filter de Accesos**: `[email] = USEREMAIL()`.
5. En **Security → Require Sign-In = ON**. Autenticación: Google.
6. En **Views**, crear la vista `Módulos`:
   - tipo **Deck** (o *Card*);
   - tabla `Modulos`;
   - orden por `orden`;
   - título `nombre`;
   - subtítulo `descripcion`.
7. En **Actions**, crear la acción `Abrir módulo`:
   - tipo **External: go to a website**;
   - target `[url]`.

   Ponerla como acción principal de la fila (*Row Selected → Abrir módulo*), así un toque abre el módulo.
8. En **Users**, compartir la app solo con los correos de la hoja `Accesos`.
9. Apariencia:
   - colores `#1F1B17` y `#F3EDE1`;
   - logo `public/assets/logo-andrade.png`, sin modificarlo.

## Notas
- **Licencias:** revisar el plan de AppSheet antes de agregar personal. Cada usuario que inicia sesión cuenta como licencia según el plan. Este portal no necesita funciones Enterprise: no usa la API de AppSheet ni bots.
- **Ocultar un módulo no es seguridad.** Aunque alguien consiga el enlace, el backend exige su usuario y PIN, y valida su rol y su caja.
- **Pantallas fijas de cocina:** pueden abrir directamente `https://<sitio>/cocina.html`, sin AppSheet.
