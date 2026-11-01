/*
 * MESA PYA'E — ANDRADE CASA CAFÉ Y ARTE
 * Núcleo de negocio portable.
 *
 * Corre igual en Node (servidor de desarrollo / pruebas) y en Google Apps Script
 * (producción MVP sobre Google Sheets). No usa módulos ni APIs propias de ninguna
 * plataforma: todo lo externo llega por `store` (persistencia) y `env` (reloj,
 * hashes, aleatoriedad, caché).
 *
 * Reglas centrales:
 *  - Los precios SIEMPRE se calculan en el servidor desde el catálogo vigente.
 *  - Cada pedido guarda una foto (snapshot) de nombre y precio: cambios de
 *    catálogo no alteran pedidos pasados.
 *  - Estado del pedido (cocina) y estado de pago (caja) son independientes.
 *  - Cada operación que crea algo recibe un request_id: reintentos devuelven
 *    el mismo resultado en lugar de duplicar.
 *  - Cada caja tiene sus propios turnos, movimientos y cierres.
 *  - Todo cambio queda en Auditoria / Historial.
 *
 * Sintaxis limitada a ES2019 (compatibilidad Apps Script V8).
 */
var MesaCore = (function () {
  'use strict';

  var VERSION = '1.0.0';

  // ------------------------------------------------------------------ esquema
  var SCHEMA = {
    Config: ['clave', 'valor', 'descripcion'],
    Puntos: ['punto_id', 'nombre', 'modalidad', 'prefijo', 'caja_id', 'qr_token', 'activo'],
    Cajas: ['caja_id', 'punto_id', 'nombre', 'activo'],
    Mesas: ['mesa_id', 'punto_id', 'numero', 'nombre', 'zona', 'qr_token', 'activa'],
    Categorias: ['categoria_id', 'nombre', 'orden', 'activa', 'nota'],
    Productos: ['producto_id', 'categoria_id', 'nombre', 'descripcion', 'precio_gs', 'activo', 'disponible', 'puntos', 'grupos', 'orden', 'fuente', 'validacion', 'nota', 'actualizado_en'],
    Grupos: ['grupo_id', 'nombre', 'min', 'max', 'activo', 'nota'],
    Opciones: ['opcion_id', 'grupo_id', 'nombre', 'delta_gs', 'activo', 'orden'],
    Usuarios: ['usuario_id', 'nombre', 'rol', 'caja_id', 'pin_hash', 'pin_salt', 'activo', 'token_version', 'intentos', 'bloqueado_hasta', 'creado_en'],
    Cuentas: ['cuenta_id', 'punto_id', 'caja_id', 'mesa_id', 'alias', 'estado', 'pago_estado', 'abierta_en', 'cierre_solicitado_en', 'cerrada_en', 'cobro_id', 'creado_por'],
    Pedidos: ['pedido_id', 'request_id', 'numero', 'fecha', 'cuenta_id', 'punto_id', 'caja_id', 'mesa_id', 'origen', 'modo', 'estado', 'alias', 'observacion', 'total_gs', 'creado_por', 'creado_en', 'actualizado_en', 'aceptado_en', 'preparacion_en', 'listo_en', 'entregado_en', 'cancelado_en', 'motivo_cancelacion', 'status_token'],
    PedidoItems: ['item_id', 'pedido_id', 'producto_id', 'nombre', 'precio_unit_gs', 'cantidad', 'opciones', 'opciones_ids', 'observacion', 'total_gs', 'anulado', 'anulado_por', 'anulado_motivo'],
    Historial: ['evento_id', 'pedido_id', 'fecha', 'usuario_id', 'accion', 'de', 'a', 'detalle'],
    Turnos: ['turno_id', 'caja_id', 'estado', 'abierto_en', 'abierto_por', 'monto_inicial_gs', 'cerrado_en', 'cerrado_por', 'esperado_efectivo_gs', 'declarado_efectivo_gs', 'diferencia_gs', 'totales', 'observacion'],
    Cobros: ['cobro_id', 'request_id', 'cuenta_id', 'caja_id', 'turno_id', 'fecha', 'subtotal_gs', 'descuento_gs', 'total_gs', 'pagos', 'usuario_id', 'autorizado_por', 'motivo_descuento', 'estado', 'revertido_por', 'revertido_en', 'motivo_reverso'],
    Movimientos: ['movimiento_id', 'request_id', 'caja_id', 'turno_id', 'cuenta_id', 'cobro_id', 'fecha', 'tipo', 'medio', 'monto_gs', 'usuario_id', 'motivo'],
    Auditoria: ['audit_id', 'fecha', 'usuario_id', 'accion', 'entidad', 'entidad_id', 'detalle'],
    Contadores: ['clave', 'valor']
  };
  var KEYS = {
    Config: 'clave', Puntos: 'punto_id', Cajas: 'caja_id', Mesas: 'mesa_id', Categorias: 'categoria_id',
    Productos: 'producto_id', Grupos: 'grupo_id', Opciones: 'opcion_id', Usuarios: 'usuario_id',
    Cuentas: 'cuenta_id', Pedidos: 'pedido_id', PedidoItems: 'item_id', Historial: 'evento_id',
    Turnos: 'turno_id', Cobros: 'cobro_id', Movimientos: 'movimiento_id', Auditoria: 'audit_id', Contadores: 'clave'
  };
  // Tablas operativas que se archivan (las de catálogo/configuración no).
  var ARCHIVABLE = ['Pedidos', 'PedidoItems', 'Historial', 'Cuentas', 'Cobros', 'Movimientos', 'Turnos', 'Auditoria'];

  var ROLES = ['ADMIN', 'MOZO', 'COCINA', 'CAJA'];
  var ESTADOS = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];
  var ESTADO_TS = { ACEPTADO: 'aceptado_en', EN_PREPARACION: 'preparacion_en', LISTO: 'listo_en', ENTREGADO: 'entregado_en', CANCELADO: 'cancelado_en' };

  // Transiciones permitidas: estado -> { destino: [roles] }.
  // CANCELADO se gestiona aparte (requiere motivo y autorización).
  var TRANSICIONES = {
    PENDIENTE: { ACEPTADO: ['ADMIN', 'MOZO', 'CAJA'] },
    ACEPTADO: { EN_PREPARACION: ['ADMIN', 'COCINA'], LISTO: ['ADMIN', 'COCINA'] },
    EN_PREPARACION: { LISTO: ['ADMIN', 'COCINA'], ACEPTADO: ['ADMIN', 'COCINA'] },
    LISTO: { ENTREGADO: ['ADMIN', 'MOZO', 'CAJA'], EN_PREPARACION: ['ADMIN', 'COCINA'] },
    ENTREGADO: {},
    CANCELADO: {}
  };

  var DEFAULT_CONFIG = {
    nombre_negocio: ['Andrade Casa Café y Arte', 'Nombre visible'],
    zona_horaria: ['America/Asuncion', 'Zona horaria de reportes'],
    medios_pago: ['EFECTIVO,TRANSFERENCIA,TC,TD', 'Medios de pago en caja. TC = tarjeta de crédito, TD = tarjeta de débito (incluye pagos con QR del POS)'],
    qr_pedidos_habilitados: ['SI', 'Permite pedidos desde el menú QR'],
    qr_requiere_aceptacion: ['SI', 'SI: pedidos QR esperan aceptación de mozo/caja antes de ir a cocina'],
    takeaway_qr_habilitado: ['SI', 'Permite prepedidos desde QR de la casita'],
    max_pedidos_qr_10min: ['6', 'Límite de pedidos por QR cada 10 minutos'],
    max_items_pedido: ['30', 'Máximo de líneas por pedido'],
    max_cantidad_item: ['20', 'Máxima cantidad por línea'],
    sesion_horas: ['14', 'Duración de la sesión del personal'],
    cocina_alerta_min: ['5,10,15', 'Minutos de demora en cocina para alertar (amarillo, naranja, rojo + sonido en cada nivel). Hasta 3 valores crecientes separados por coma'],
    dias_activos: ['2', 'Días que los pedidos cerrados permanecen en tablas activas antes de archivarse'],
    rev: ['1', 'Contador interno de cambios (no editar)']
  };

  // ------------------------------------------------------------------ errores
  function AppError(code, message, status) {
    this.code = code; this.message = message; this.status = status || 400;
  }
  function fail(code, message, status) { throw new AppError(code, message, status); }
  function must(cond, code, message, status) { if (!cond) fail(code, message, status); }

  // ------------------------------------------------------------------ utilidades
  function isTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 'SI' || v === 'Sí' || v === 1 || v === '1'; }
  function int(v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
  function str(v, max) { var s = (v === null || v === undefined) ? '' : String(v).trim(); return max ? s.slice(0, max) : s; }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function csv(v) { return str(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pick(o, ks) { var r = {}; ks.forEach(function (k) { r[k] = o[k]; }); return r; }
  function idx(rows, key) { var m = {}; rows.forEach(function (r) { m[r[key]] = r; }); return m; }
  function cleanText(s, max) { return str(s, max).replace(/[\u0000-\u001f<>]/g, ' '); }

  // ------------------------------------------------------------------ aplicación
  function create(store, env) {
    // env: now() ms, uuid(), token(n), sha256(s)->hex, hmac(key,msg)->hex,
    //      dateKey(ms)->'YYYY-MM-DD' (zona Asunción), secret, cache {get,put}
    var db;   // vista transaccional de la petición en curso

    function now() { return env.now(); }
    function iso(ms) { return new Date(ms).toISOString(); }
    function newId(prefix) { return prefix + '_' + env.uuid().replace(/-/g, '').slice(0, 16); }

    function cfg(k) {
      var r = db.get('Config', k);
      if (r) return str(r.valor);
      return DEFAULT_CONFIG[k] ? DEFAULT_CONFIG[k][0] : '';
    }
    function alertasCocina() {
      var l = csv(cfg('cocina_alerta_min')).map(int).filter(function (x) { return x > 0; });
      return l.length ? l.slice(0, 3) : [5, 10, 15];
    }
    function bumpRev() {
      var r = db.get('Config', 'rev');
      var v = (r ? int(r.valor) : 0) + 1;
      if (r) db.update('Config', 'rev', { valor: String(v) });
      else db.insert('Config', { clave: 'rev', valor: String(v), descripcion: DEFAULT_CONFIG.rev[1] });
      return v;
    }
    function audit(user, accion, entidad, entidadId, detalle) {
      db.insert('Auditoria', {
        audit_id: newId('AUD'), fecha: iso(now()), usuario_id: user ? user.usuario_id : 'PUBLICO',
        accion: accion, entidad: entidad, entidad_id: entidadId || '', detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {})
      });
    }
    function historial(pedidoId, user, accion, de, a, detalle) {
      db.insert('Historial', {
        evento_id: newId('EV'), pedido_id: pedidoId, fecha: iso(now()), usuario_id: user ? user.usuario_id : 'PUBLICO',
        accion: accion, de: de || '', a: a || '', detalle: detalle || ''
      });
    }
    function nextCounter(key) {
      var r = db.get('Contadores', key);
      var v = (r ? int(r.valor) : 0) + 1;
      if (r) db.update('Contadores', key, { valor: String(v) }); else db.insert('Contadores', { clave: key, valor: String(v) });
      return v;
    }
    function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

    // ---------------------------------------------------------------- seguridad
    function hashPin(pin, salt) {
      var h = salt + ':' + pin;
      for (var i = 0; i < 300; i++) h = env.sha256(h + ':' + salt);
      return h;
    }
    function signSession(user) {
      var exp = now() + int(cfg('sesion_horas') || 14) * 3600 * 1000;
      var body = [user.usuario_id, int(user.token_version), exp].join('|');
      return b64url(body) + '.' + env.hmac(env.secret, body);
    }
    function b64url(s) { return env.b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function unb64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return env.unb64(s); }
    function verifySession(token) {
      must(token && typeof token === 'string' && token.indexOf('.') > 0, 'NO_SESION', 'Iniciá sesión.', 401);
      var parts = token.split('.');
      var body;
      try { body = unb64url(parts[0]); } catch (e) { fail('NO_SESION', 'Sesión inválida.', 401); }
      must(env.hmac(env.secret, body) === parts[1], 'NO_SESION', 'Sesión inválida.', 401);
      var f = body.split('|');
      must(int(f[2]) > now(), 'SESION_VENCIDA', 'La sesión venció. Volvé a ingresar.', 401);
      var u = db.get('Usuarios', f[0]);
      must(u && isTrue(u.activo), 'NO_SESION', 'Usuario inactivo.', 401);
      must(int(u.token_version) === int(f[1]), 'NO_SESION', 'La sesión fue cerrada por un administrador.', 401);
      return u;
    }
    function requireRole(user, roles) {
      must(roles.indexOf(user.rol) >= 0, 'SIN_PERMISO', 'Tu usuario no tiene permiso para esta acción.', 403);
    }
    function canOperateCaja(user, cajaId) {
      return user.rol === 'ADMIN' || (user.rol === 'CAJA' && user.caja_id === cajaId);
    }
    function requireCaja(user, cajaId) {
      must(canOperateCaja(user, cajaId), 'SIN_PERMISO', 'Tu usuario no puede operar ' + cajaId + '.', 403);
    }
    function puntoDeCaja(cajaId) { var c = db.get('Cajas', cajaId); return c ? c.punto_id : ''; }
    // Autorización de encargado: ADMIN logueado o código+PIN de un ADMIN
    function supervisor(user, auth) {
      if (user && user.rol === 'ADMIN') return user;
      must(auth && auth.usuario && auth.pin, 'REQUIERE_AUTORIZACION', 'Esta acción necesita autorización del encargado.', 403);
      var a = db.get('Usuarios', str(auth.usuario).toLowerCase());
      must(a && isTrue(a.activo) && a.rol === 'ADMIN', 'AUTORIZACION_INVALIDA', 'Autorización inválida.', 403);
      must(!(int(a.bloqueado_hasta) > now()), 'USUARIO_BLOQUEADO', 'Usuario autorizante bloqueado temporalmente.', 403);
      if (hashPin(str(auth.pin), a.pin_salt) !== a.pin_hash) {
        db.update('Usuarios', a.usuario_id, { intentos: int(a.intentos) + 1, bloqueado_hasta: int(a.intentos) + 1 >= 5 ? now() + 5 * 60000 : a.bloqueado_hasta });
        fail('AUTORIZACION_INVALIDA', 'Autorización inválida.', 403);
      }
      return a;
    }
    function rateLimit(key, max, windowSec) {
      if (!env.cache) return;
      var k = 'rl:' + key + ':' + Math.floor(now() / (windowSec * 1000));
      var n = int(env.cache.get(k)) + 1;
      env.cache.put(k, String(n), windowSec + 5);
      must(n <= max, 'DEMASIADOS_PEDIDOS', 'Se alcanzó el límite de pedidos. Pedí ayuda al personal.', 429);
    }

    // ---------------------------------------------------------------- catálogo
    function menuFor(puntoId, includeHidden) {
      var cats = db.all('Categorias').filter(function (c) { return includeHidden || isTrue(c.activa); })
        .sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var grupos = idx(db.all('Grupos'), 'grupo_id');
      var opciones = db.all('Opciones').filter(function (o) { return includeHidden || isTrue(o.activo); })
        .sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var prods = db.all('Productos').filter(function (p) {
        return includeHidden || (isTrue(p.activo) && (!puntoId || csv(p.puntos).indexOf(puntoId) >= 0));
      }).sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var usedGroups = {};
      var outProds = prods.map(function (p) {
        var gs = csv(p.grupos).filter(function (g) { return grupos[g] && (includeHidden || isTrue(grupos[g].activo)); });
        gs.forEach(function (g) { usedGroups[g] = true; });
        var o = {
          id: p.producto_id, categoria: p.categoria_id, nombre: p.nombre, descripcion: str(p.descripcion),
          precio: int(p.precio_gs), disponible: isTrue(p.disponible), grupos: gs
        };
        if (includeHidden) { o.activo = isTrue(p.activo); o.puntos = str(p.puntos); o.validacion = str(p.validacion); o.fuente = str(p.fuente); o.nota = str(p.nota); o.orden = int(p.orden); }
        return o;
      });
      var catIds = {};
      outProds.forEach(function (p) { catIds[p.categoria] = true; });
      return {
        categorias: cats.filter(function (c) { return includeHidden || catIds[c.categoria_id]; }).map(function (c) {
          var o = { id: c.categoria_id, nombre: c.nombre };
          if (includeHidden) { o.activa = isTrue(c.activa); o.orden = int(c.orden); o.nota = str(c.nota); }
          return o;
        }),
        productos: outProds,
        grupos: Object.keys(grupos).filter(function (g) { return includeHidden || usedGroups[g]; }).map(function (g) {
          var G = grupos[g];
          return {
            id: g, nombre: G.nombre, min: int(G.min), max: int(G.max), activo: isTrue(G.activo),
            opciones: opciones.filter(function (o) { return o.grupo_id === g; }).map(function (o) {
              var r = { id: o.opcion_id, nombre: o.nombre, delta: int(o.delta_gs) };
              if (includeHidden) r.activo = isTrue(o.activo);
              return r;
            })
          };
        })
      };
    }

    // Construye líneas de pedido validadas y con precio de servidor.
    function buildItems(puntoId, items) {
      must(Array.isArray(items) && items.length > 0, 'PEDIDO_VACIO', 'El pedido no tiene productos.');
      must(items.length <= int(cfg('max_items_pedido') || 30), 'PEDIDO_GRANDE', 'Demasiados productos en un solo pedido.');
      var maxQty = int(cfg('max_cantidad_item') || 20);
      var grupos = idx(db.all('Grupos'), 'grupo_id');
      var opciones = idx(db.all('Opciones'), 'opcion_id');
      return items.map(function (it) {
        var p = db.get('Productos', str(it.producto_id));
        must(p && isTrue(p.activo), 'PRODUCTO_INEXISTENTE', 'Un producto ya no está en la carta.');
        must(csv(p.puntos).indexOf(puntoId) >= 0, 'PRODUCTO_NO_HABILITADO', p.nombre + ' no está habilitado en este punto.');
        must(isTrue(p.disponible), 'PRODUCTO_AGOTADO', p.nombre + ' no está disponible en este momento.');
        var qty = it.cantidad;
        must(isInt(qty) && qty >= 1 && qty <= maxQty, 'CANTIDAD_INVALIDA', 'Cantidad inválida para ' + p.nombre + '.');
        var sel = Array.isArray(it.opciones) ? it.opciones.map(String) : [];
        var seen = {};
        sel.forEach(function (o) { must(!seen[o], 'OPCION_INVALIDA', 'Opción repetida en ' + p.nombre + '.'); seen[o] = true; });
        var pgs = csv(p.grupos).filter(function (g) { return grupos[g] && isTrue(grupos[g].activo); });
        var precio = int(p.precio_gs);
        var desc = [];
        var countBy = {};
        sel.forEach(function (oid) {
          var o = opciones[oid];
          must(o && isTrue(o.activo) && pgs.indexOf(o.grupo_id) >= 0, 'OPCION_INVALIDA', 'Opción inválida para ' + p.nombre + '.');
          countBy[o.grupo_id] = (countBy[o.grupo_id] || 0) + 1;
        });
        pgs.forEach(function (g) {
          var G = grupos[g], n = countBy[g] || 0;
          must(n >= int(G.min), 'OPCION_REQUERIDA', 'Elegí "' + G.nombre + '" para ' + p.nombre + '.');
          must(n <= int(G.max), 'OPCION_INVALIDA', 'Demasiadas opciones en "' + G.nombre + '" para ' + p.nombre + '.');
          sel.filter(function (oid) { return opciones[oid].grupo_id === g; }).forEach(function (oid) {
            precio += int(opciones[oid].delta_gs);
            var on = opciones[oid].nombre;
            desc.push(on.toLowerCase().indexOf(String(G.nombre).toLowerCase()) === 0 ? on : G.nombre + ': ' + on);
          });
        });
        return {
          producto_id: p.producto_id, nombre: p.nombre, precio_unit_gs: precio, cantidad: qty,
          opciones: desc.join(' · '), opciones_ids: sel.join(','), observacion: cleanText(it.observacion, 140),
          total_gs: precio * qty
        };
      });
    }

    // ---------------------------------------------------------------- pedidos
    function openCuentaFor(puntoId, mesaId, alias, user) {
      if (mesaId) {
        var abiertas = db.all('Cuentas').filter(function (c) {
          return c.mesa_id === mesaId && (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO');
        });
        if (abiertas.length) {
          var c0 = abiertas[0];
          if (c0.estado === 'CIERRE_SOLICITADO') db.update('Cuentas', c0.cuenta_id, { estado: 'ABIERTA', cierre_solicitado_en: '' });
          return c0;
        }
      }
      var punto = db.get('Puntos', puntoId);
      var c = {
        cuenta_id: newId('CTA'), punto_id: puntoId, caja_id: punto.caja_id, mesa_id: mesaId || '', alias: alias || '',
        estado: 'ABIERTA', pago_estado: 'NO_COBRADO', abierta_en: iso(now()), cierre_solicitado_en: '', cerrada_en: '', cobro_id: '',
        creado_por: user ? user.usuario_id : 'PUBLICO'
      };
      db.insert('Cuentas', c);
      return c;
    }

    function createOrder(p, user, origen) {
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      var prev = db.all('Pedidos').filter(function (x) { return x.request_id === reqId; })[0];
      if (prev) return { pedido: orderView(prev), duplicado: true };

      var puntoId, mesaId = '', modo;
      if (p.mesa_id) {
        var mesa = db.get('Mesas', str(p.mesa_id));
        must(mesa && isTrue(mesa.activa), 'MESA_INVALIDA', 'Mesa inválida.');
        puntoId = mesa.punto_id; mesaId = mesa.mesa_id; modo = 'SALON';
      } else {
        puntoId = str(p.punto_id);
        var pt = db.get('Puntos', puntoId);
        must(pt && isTrue(pt.activo), 'PUNTO_INVALIDO', 'Punto operativo inválido.');
        modo = pt.modalidad === 'TAKEAWAY' ? 'TAKEAWAY' : 'MOSTRADOR';
      }
      var punto = db.get('Puntos', puntoId);
      if (user && user.rol === 'CAJA') must(punto.caja_id === user.caja_id, 'SIN_PERMISO', 'Tu caja no opera este punto.', 403);
      var alias = cleanText(p.alias, 40);
      if (modo !== 'SALON') must(alias.length > 0 || origen !== 'QR', 'ALIAS_REQUERIDO', 'Indicá un nombre para llamar el pedido.');

      var lines = buildItems(puntoId, p.items);
      var total = lines.reduce(function (s, l) { return s + l.total_gs; }, 0);

      var cuenta;
      if (p.cuenta_id) {
        cuenta = db.get('Cuentas', str(p.cuenta_id));
        must(cuenta && cuenta.punto_id === puntoId && (cuenta.estado === 'ABIERTA' || cuenta.estado === 'CIERRE_SOLICITADO'), 'CUENTA_INVALIDA', 'La cuenta ya no está abierta.');
        must(!mesaId || cuenta.mesa_id === mesaId, 'CUENTA_INVALIDA', 'La cuenta no corresponde a la mesa.');
        if (cuenta.estado === 'CIERRE_SOLICITADO') db.update('Cuentas', cuenta.cuenta_id, { estado: 'ABIERTA', cierre_solicitado_en: '' });
      } else {
        cuenta = openCuentaFor(puntoId, mesaId, alias, user);
      }

      var fecha = env.dateKey(now());
      var n = nextCounter('num:' + puntoId + ':' + fecha);
      var estado = 'ACEPTADO';
      if (origen === 'QR' && isTrue(cfg('qr_requiere_aceptacion'))) estado = 'PENDIENTE';
      var directa = !!p.venta_directa && origen !== 'QR';
      if (directa) estado = 'ENTREGADO';
      var t = iso(now());
      var ped = {
        pedido_id: newId('PED'), request_id: reqId, numero: punto.prefijo + '-' + pad(n, 3), fecha: fecha,
        cuenta_id: cuenta.cuenta_id, punto_id: puntoId, caja_id: punto.caja_id, mesa_id: mesaId, origen: origen,
        modo: modo, estado: estado, alias: alias, observacion: cleanText(p.observacion, 200), total_gs: total,
        creado_por: user ? user.usuario_id : 'PUBLICO', creado_en: t, actualizado_en: t,
        aceptado_en: estado !== 'PENDIENTE' ? t : '', preparacion_en: '', listo_en: '', entregado_en: directa ? t : '',
        cancelado_en: '', motivo_cancelacion: '', status_token: env.token(24)
      };
      db.insert('Pedidos', ped);
      lines.forEach(function (l) {
        l.item_id = newId('IT'); l.pedido_id = ped.pedido_id; l.anulado = 'NO'; l.anulado_por = ''; l.anulado_motivo = '';
        db.insert('PedidoItems', l);
      });
      historial(ped.pedido_id, user, 'CREADO', '', estado, origen + (directa ? ' (venta directa)' : ''));
      bumpRev();
      return { pedido: orderView(ped), duplicado: false };
    }

    function itemsOf(pedidoId) {
      return db.all('PedidoItems').filter(function (i) { return i.pedido_id === pedidoId; });
    }
    function orderView(p) {
      return {
        pedido_id: p.pedido_id, numero: p.numero, fecha: p.fecha, cuenta_id: p.cuenta_id, punto_id: p.punto_id, caja_id: p.caja_id,
        mesa_id: p.mesa_id, mesa: p.mesa_id ? mesaNombre(p.mesa_id) : '', origen: p.origen, modo: p.modo, estado: p.estado,
        alias: p.alias, observacion: p.observacion, total_gs: int(p.total_gs), creado_por: p.creado_por, creado_en: p.creado_en,
        aceptado_en: p.aceptado_en, preparacion_en: p.preparacion_en, listo_en: p.listo_en, entregado_en: p.entregado_en,
        cancelado_en: p.cancelado_en, motivo_cancelacion: p.motivo_cancelacion,
        items: itemsOf(p.pedido_id).map(function (i) {
          return {
            item_id: i.item_id, producto_id: i.producto_id, nombre: i.nombre, precio_unit_gs: int(i.precio_unit_gs),
            cantidad: int(i.cantidad), opciones: i.opciones, observacion: i.observacion, total_gs: int(i.total_gs),
            anulado: isTrue(i.anulado), anulado_motivo: i.anulado_motivo
          };
        })
      };
    }
    function mesaNombre(id) { var m = db.get('Mesas', id); return m ? m.nombre : id; }

    function recomputeOrderTotal(pedidoId) {
      var tot = itemsOf(pedidoId).filter(function (i) { return !isTrue(i.anulado); })
        .reduce(function (s, i) { return s + int(i.total_gs); }, 0);
      db.update('Pedidos', pedidoId, { total_gs: tot, actualizado_en: iso(now()) });
      return tot;
    }
    function cuentaTotal(cuentaId) {
      return db.all('Pedidos').filter(function (p) { return p.cuenta_id === cuentaId && p.estado !== 'CANCELADO'; })
        .reduce(function (s, p) { return s + int(p.total_gs); }, 0);
    }
    function maybeAnularCuenta(cuentaId, user) {
      var c = db.get('Cuentas', cuentaId);
      if (!c || c.pago_estado === 'COBRADO') return;
      var peds = db.all('Pedidos').filter(function (p) { return p.cuenta_id === cuentaId; });
      if (peds.length && peds.every(function (p) { return p.estado === 'CANCELADO'; })) {
        db.update('Cuentas', cuentaId, { estado: 'ANULADA', cerrada_en: iso(now()) });
        audit(user, 'CUENTA_ANULADA', 'Cuentas', cuentaId, 'Todos sus pedidos fueron cancelados');
      }
    }

    function setState(p, user) {
      var ped = db.get('Pedidos', str(p.pedido_id));
      must(ped, 'PEDIDO_INEXISTENTE', 'Pedido inexistente.', 404);
      var to = str(p.estado);
      must(ESTADOS.indexOf(to) >= 0 && to !== 'CANCELADO' && to !== 'PENDIENTE', 'ESTADO_INVALIDO', 'Estado inválido.');
      if (p.desde) must(ped.estado === str(p.desde), 'CONFLICTO', 'El pedido cambió mientras tanto (ahora: ' + ped.estado + ').', 409);
      if (ped.estado === to) return { pedido: orderView(ped), sin_cambios: true };
      var allowed = (TRANSICIONES[ped.estado] || {})[to];
      must(allowed, 'TRANSICION_INVALIDA', 'No se puede pasar de ' + ped.estado + ' a ' + to + '.', 409);
      requireRole(user, allowed);
      if (user.rol === 'CAJA') must(ped.caja_id === user.caja_id, 'SIN_PERMISO', 'Pedido de otro punto.', 403);
      var patch = { estado: to, actualizado_en: iso(now()) };
      if (ESTADO_TS[to]) patch[ESTADO_TS[to]] = iso(now());
      db.update('Pedidos', ped.pedido_id, patch);
      historial(ped.pedido_id, user, 'ESTADO', ped.estado, to, '');
      bumpRev();
      return { pedido: orderView(db.get('Pedidos', ped.pedido_id)) };
    }

    function cancelOrder(p, user) {
      var ped = db.get('Pedidos', str(p.pedido_id));
      must(ped, 'PEDIDO_INEXISTENTE', 'Pedido inexistente.', 404);
      must(ped.estado !== 'CANCELADO', 'YA_CANCELADO', 'El pedido ya está cancelado.', 409);
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo de la cancelación.');
      var cuenta = db.get('Cuentas', ped.cuenta_id);
      must(!(cuenta && cuenta.pago_estado === 'COBRADO'), 'CUENTA_COBRADA', 'La cuenta ya fue cobrada: primero el encargado debe revertir el cobro.', 409);
      var autorizo = '';
      // Mozo/caja pueden rechazar un pedido PENDIENTE; luego hace falta encargado.
      if (ped.estado === 'PENDIENTE' && (user.rol === 'MOZO' || (user.rol === 'CAJA' && user.caja_id === ped.caja_id))) {
        autorizo = user.usuario_id;
      } else {
        autorizo = supervisor(user, p.autorizacion).usuario_id;
      }
      db.update('Pedidos', ped.pedido_id, { estado: 'CANCELADO', cancelado_en: iso(now()), motivo_cancelacion: motivo, actualizado_en: iso(now()) });
      historial(ped.pedido_id, user, 'CANCELADO', ped.estado, 'CANCELADO', motivo + ' | autorizó: ' + autorizo);
      audit(user, 'PEDIDO_CANCELADO', 'Pedidos', ped.pedido_id, { motivo: motivo, autorizo: autorizo, total_gs: ped.total_gs });
      maybeAnularCuenta(ped.cuenta_id, user);
      bumpRev();
      return { pedido: orderView(db.get('Pedidos', ped.pedido_id)) };
    }

    function voidItem(p, user) {
      var it = db.get('PedidoItems', str(p.item_id));
      must(it, 'ITEM_INEXISTENTE', 'Ítem inexistente.', 404);
      must(!isTrue(it.anulado), 'YA_ANULADO', 'El ítem ya está anulado.', 409);
      var ped = db.get('Pedidos', it.pedido_id);
      must(ped.estado !== 'CANCELADO', 'PEDIDO_CANCELADO', 'El pedido está cancelado.', 409);
      var cuenta = db.get('Cuentas', ped.cuenta_id);
      must(!(cuenta && cuenta.pago_estado === 'COBRADO'), 'CUENTA_COBRADA', 'La cuenta ya fue cobrada.', 409);
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo.');
      var aut = supervisor(user, p.autorizacion);
      db.update('PedidoItems', it.item_id, { anulado: 'SI', anulado_por: aut.usuario_id, anulado_motivo: motivo });
      var tot = recomputeOrderTotal(ped.pedido_id);
      historial(ped.pedido_id, user, 'ITEM_ANULADO', '', '', it.nombre + ' x' + it.cantidad + ' | ' + motivo + ' | autorizó: ' + aut.usuario_id);
      audit(user, 'ITEM_ANULADO', 'PedidoItems', it.item_id, { pedido: ped.numero, motivo: motivo, autorizo: aut.usuario_id, monto: it.total_gs });
      if (tot === 0) {
        db.update('Pedidos', ped.pedido_id, { estado: 'CANCELADO', cancelado_en: iso(now()), motivo_cancelacion: 'Todos los ítems anulados' });
        maybeAnularCuenta(ped.cuenta_id, user);
      }
      bumpRev();
      return { pedido: orderView(db.get('Pedidos', ped.pedido_id)) };
    }

    function requestClose(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c && c.estado === 'ABIERTA', 'CUENTA_INVALIDA', 'La cuenta no está abierta.', 409);
      db.update('Cuentas', c.cuenta_id, { estado: 'CIERRE_SOLICITADO', cierre_solicitado_en: iso(now()) });
      audit(user, 'CIERRE_SOLICITADO', 'Cuentas', c.cuenta_id, { mesa: c.mesa_id, total: cuentaTotal(c.cuenta_id) });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)) };
    }

    function cuentaView(c) {
      return {
        cuenta_id: c.cuenta_id, punto_id: c.punto_id, caja_id: c.caja_id, mesa_id: c.mesa_id, mesa: c.mesa_id ? mesaNombre(c.mesa_id) : '',
        alias: c.alias, estado: c.estado, pago_estado: c.pago_estado, abierta_en: c.abierta_en,
        cierre_solicitado_en: c.cierre_solicitado_en, cerrada_en: c.cerrada_en, cobro_id: c.cobro_id, total_gs: cuentaTotal(c.cuenta_id)
      };
    }

    // ---------------------------------------------------------------- cajas
    function openTurno(cajaId) {
      return db.all('Turnos').filter(function (t) { return t.caja_id === cajaId && t.estado === 'ABIERTO'; })[0] || null;
    }
    function mediosPago() { return csv(cfg('medios_pago')); }

    function cajaAbrir(p, user) {
      var cajaId = str(p.caja_id);
      must(db.get('Cajas', cajaId), 'CAJA_INVALIDA', 'Caja inválida.');
      requireCaja(user, cajaId);
      must(!openTurno(cajaId), 'TURNO_ABIERTO', 'Esta caja ya tiene un turno abierto.', 409);
      var monto = p.monto_inicial_gs;
      must(isInt(monto) && monto >= 0, 'MONTO_INVALIDO', 'Monto inicial inválido.');
      var t = {
        turno_id: newId('TUR'), caja_id: cajaId, estado: 'ABIERTO', abierto_en: iso(now()), abierto_por: user.usuario_id,
        monto_inicial_gs: monto, cerrado_en: '', cerrado_por: '', esperado_efectivo_gs: '', declarado_efectivo_gs: '',
        diferencia_gs: '', totales: '', observacion: ''
      };
      db.insert('Turnos', t);
      db.insert('Movimientos', {
        movimiento_id: newId('MOV'), request_id: '', caja_id: cajaId, turno_id: t.turno_id, cuenta_id: '', cobro_id: '',
        fecha: iso(now()), tipo: 'APERTURA', medio: 'EFECTIVO', monto_gs: monto, usuario_id: user.usuario_id, motivo: 'Fondo inicial'
      });
      audit(user, 'CAJA_ABIERTA', 'Turnos', t.turno_id, { caja: cajaId, monto_inicial_gs: monto });
      bumpRev();
      return { turno: turnoView(t) };
    }

    function turnoTotals(t) {
      var movs = db.all('Movimientos').filter(function (m) { return m.turno_id === t.turno_id; });
      var porMedio = {}, efectivo = 0, cobros = 0, reversos = 0, ingresos = 0, egresos = 0;
      movs.forEach(function (m) {
        var v = int(m.monto_gs);
        if (m.tipo === 'COBRO' || m.tipo === 'REVERSO') {
          porMedio[m.medio] = (porMedio[m.medio] || 0) + v;
          if (m.tipo === 'COBRO') cobros += v; else reversos += v;
        }
        if (m.tipo === 'INGRESO') ingresos += v;
        if (m.tipo === 'EGRESO') egresos += v; // ya negativo
        if (m.medio === 'EFECTIVO') efectivo += v;
      });
      var nCobros = db.all('Cobros').filter(function (c) { return c.turno_id === t.turno_id && c.estado === 'VALIDO'; }).length;
      return {
        por_medio: porMedio, ventas_netas_gs: cobros + reversos, cobros_gs: cobros, reversos_gs: reversos,
        ingresos_gs: ingresos, egresos_gs: egresos, efectivo_esperado_gs: efectivo, cantidad_cobros: nCobros
      };
    }
    function turnoView(t) {
      var v = pick(t, ['turno_id', 'caja_id', 'estado', 'abierto_en', 'abierto_por', 'cerrado_en', 'cerrado_por', 'observacion']);
      v.monto_inicial_gs = int(t.monto_inicial_gs);
      v.totales = t.estado === 'CERRADO' && t.totales ? JSON.parse(t.totales) : turnoTotals(t);
      if (t.estado === 'CERRADO') {
        v.esperado_efectivo_gs = int(t.esperado_efectivo_gs); v.declarado_efectivo_gs = int(t.declarado_efectivo_gs); v.diferencia_gs = int(t.diferencia_gs);
      }
      return v;
    }

    function cajaCobrar(p, user) {
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      var prev = db.all('Cobros').filter(function (c) { return c.request_id === reqId; })[0];
      if (prev) return { cobro: cobroView(prev), duplicado: true };
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c, 'CUENTA_INEXISTENTE', 'Cuenta inexistente.', 404);
      requireCaja(user, c.caja_id);
      must(c.estado !== 'ANULADA', 'CUENTA_ANULADA', 'La cuenta está anulada.', 409);
      must(c.pago_estado !== 'COBRADO', 'YA_COBRADA', 'Esta cuenta ya fue cobrada.', 409);
      var turno = openTurno(c.caja_id);
      must(turno, 'CAJA_CERRADA', 'Abrí la caja antes de cobrar.', 409);
      var subtotal = cuentaTotal(c.cuenta_id);
      must(subtotal > 0, 'CUENTA_VACIA', 'La cuenta no tiene importe a cobrar.', 409);
      if (isInt(p.total_esperado_gs)) must(p.total_esperado_gs === subtotal, 'TOTAL_CAMBIO', 'El total cambió (ahora Gs. ' + subtotal + '). Revisá antes de cobrar.', 409);
      var desc = p.descuento_gs || 0;
      must(isInt(desc) && desc >= 0 && desc <= subtotal, 'DESCUENTO_INVALIDO', 'Descuento inválido.');
      var autorizo = '';
      var motivoDesc = cleanText(p.motivo_descuento, 200);
      if (desc > 0) {
        must(motivoDesc.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo del descuento.');
        autorizo = supervisor(user, p.autorizacion).usuario_id;
      }
      var total = subtotal - desc;
      var pagos = Array.isArray(p.pagos) ? p.pagos : [];
      var medios = mediosPago();
      must(pagos.length >= 1 && pagos.length <= 4, 'PAGOS_INVALIDOS', 'Indicá el medio de pago.');
      var suma = 0;
      pagos.forEach(function (x) {
        must(medios.indexOf(x.medio) >= 0, 'MEDIO_INVALIDO', 'Medio de pago no habilitado: ' + x.medio);
        must(isInt(x.monto_gs) && x.monto_gs > 0, 'MONTO_INVALIDO', 'Monto inválido.');
        suma += x.monto_gs;
      });
      must(suma === total, 'MONTO_NO_COINCIDE', 'Los pagos (Gs. ' + suma + ') no coinciden con el total (Gs. ' + total + ').');
      var t = iso(now());
      var cobro = {
        cobro_id: newId('COB'), request_id: reqId, cuenta_id: c.cuenta_id, caja_id: c.caja_id, turno_id: turno.turno_id, fecha: t,
        subtotal_gs: subtotal, descuento_gs: desc, total_gs: total, pagos: JSON.stringify(pagos.map(function (x) { return { medio: x.medio, monto_gs: x.monto_gs }; })),
        usuario_id: user.usuario_id, autorizado_por: autorizo, motivo_descuento: motivoDesc, estado: 'VALIDO', revertido_por: '', revertido_en: '', motivo_reverso: ''
      };
      db.insert('Cobros', cobro);
      pagos.forEach(function (x) {
        db.insert('Movimientos', {
          movimiento_id: newId('MOV'), request_id: reqId, caja_id: c.caja_id, turno_id: turno.turno_id, cuenta_id: c.cuenta_id, cobro_id: cobro.cobro_id,
          fecha: t, tipo: 'COBRO', medio: x.medio, monto_gs: x.monto_gs, usuario_id: user.usuario_id, motivo: ''
        });
      });
      db.update('Cuentas', c.cuenta_id, { pago_estado: 'COBRADO', estado: 'CERRADA', cerrada_en: t, cobro_id: cobro.cobro_id });
      audit(user, 'COBRO', 'Cobros', cobro.cobro_id, { cuenta: c.cuenta_id, caja: c.caja_id, total_gs: total, descuento_gs: desc, autorizo: autorizo });
      bumpRev();
      return { cobro: cobroView(cobro), duplicado: false };
    }
    function cobroView(c) {
      var v = pick(c, ['cobro_id', 'cuenta_id', 'caja_id', 'turno_id', 'fecha', 'usuario_id', 'autorizado_por', 'motivo_descuento', 'estado', 'revertido_por', 'revertido_en', 'motivo_reverso']);
      v.subtotal_gs = int(c.subtotal_gs); v.descuento_gs = int(c.descuento_gs); v.total_gs = int(c.total_gs);
      v.pagos = c.pagos ? JSON.parse(c.pagos) : [];
      return v;
    }

    function cajaRevertir(p, user) {
      var cobro = db.get('Cobros', str(p.cobro_id));
      must(cobro, 'COBRO_INEXISTENTE', 'Cobro inexistente.', 404);
      must(cobro.estado === 'VALIDO', 'YA_REVERTIDO', 'El cobro ya fue revertido.', 409);
      var aut = supervisor(user, p.autorizacion);
      if (user.rol !== 'ADMIN') requireCaja(user, cobro.caja_id);
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo.');
      var turno = openTurno(cobro.caja_id);
      must(turno, 'CAJA_CERRADA', 'La caja ' + cobro.caja_id + ' debe estar abierta para registrar el reverso.', 409);
      var t = iso(now());
      JSON.parse(cobro.pagos).forEach(function (x) {
        db.insert('Movimientos', {
          movimiento_id: newId('MOV'), request_id: '', caja_id: cobro.caja_id, turno_id: turno.turno_id, cuenta_id: cobro.cuenta_id, cobro_id: cobro.cobro_id,
          fecha: t, tipo: 'REVERSO', medio: x.medio, monto_gs: -int(x.monto_gs), usuario_id: user.usuario_id, motivo: motivo
        });
      });
      db.update('Cobros', cobro.cobro_id, { estado: 'REVERTIDO', revertido_por: aut.usuario_id, revertido_en: t, motivo_reverso: motivo });
      db.update('Cuentas', cobro.cuenta_id, { pago_estado: 'REVERTIDO', estado: 'CIERRE_SOLICITADO', cerrada_en: '', cobro_id: '' });
      audit(user, 'COBRO_REVERTIDO', 'Cobros', cobro.cobro_id, { motivo: motivo, autorizo: aut.usuario_id, total_gs: cobro.total_gs });
      bumpRev();
      return { cobro: cobroView(db.get('Cobros', cobro.cobro_id)) };
    }

    function cajaMovimiento(p, user) {
      var cajaId = str(p.caja_id);
      requireCaja(user, cajaId);
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      var prev = db.all('Movimientos').filter(function (m) { return m.request_id === reqId; })[0];
      if (prev) return { movimiento: prev, duplicado: true };
      var tipo = str(p.tipo);
      must(tipo === 'INGRESO' || tipo === 'EGRESO', 'TIPO_INVALIDO', 'Tipo inválido.');
      var monto = p.monto_gs;
      must(isInt(monto) && monto > 0, 'MONTO_INVALIDO', 'Monto inválido.');
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo.');
      var turno = openTurno(cajaId);
      must(turno, 'CAJA_CERRADA', 'La caja está cerrada.', 409);
      var aut = tipo === 'EGRESO' ? supervisor(user, p.autorizacion).usuario_id : '';
      var m = {
        movimiento_id: newId('MOV'), request_id: reqId, caja_id: cajaId, turno_id: turno.turno_id, cuenta_id: '', cobro_id: '',
        fecha: iso(now()), tipo: tipo, medio: 'EFECTIVO', monto_gs: tipo === 'EGRESO' ? -monto : monto, usuario_id: user.usuario_id,
        motivo: motivo + (aut ? ' | autorizó: ' + aut : '')
      };
      db.insert('Movimientos', m);
      audit(user, 'CAJA_' + tipo, 'Movimientos', m.movimiento_id, { caja: cajaId, monto_gs: m.monto_gs, motivo: motivo });
      bumpRev();
      return { movimiento: m };
    }

    function cajaCerrar(p, user) {
      var cajaId = str(p.caja_id);
      requireCaja(user, cajaId);
      var t = openTurno(cajaId);
      must(t, 'CAJA_CERRADA', 'La caja no tiene turno abierto.', 409);
      var decl = p.efectivo_declarado_gs;
      must(isInt(decl) && decl >= 0, 'MONTO_INVALIDO', 'Indicá el efectivo contado.');
      var tot = turnoTotals(t);
      var dif = decl - tot.efectivo_esperado_gs;
      var obs = cleanText(p.observacion, 300);
      if (dif !== 0) must(obs.length >= 3, 'OBSERVACION_REQUERIDA', 'Hay diferencia de caja: explicá la observación.');
      var pendientes = db.all('Cuentas').filter(function (c) { return c.caja_id === cajaId && (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO') && cuentaTotal(c.cuenta_id) > 0; }).length;
      db.update('Turnos', t.turno_id, {
        estado: 'CERRADO', cerrado_en: iso(now()), cerrado_por: user.usuario_id, esperado_efectivo_gs: tot.efectivo_esperado_gs,
        declarado_efectivo_gs: decl, diferencia_gs: dif, totales: JSON.stringify(tot), observacion: obs + (pendientes ? ' | cuentas sin cobrar al cierre: ' + pendientes : '')
      });
      audit(user, 'CAJA_CERRADA', 'Turnos', t.turno_id, { caja: cajaId, esperado: tot.efectivo_esperado_gs, declarado: decl, diferencia: dif, pendientes: pendientes });
      bumpRev();
      return { turno: turnoView(db.get('Turnos', t.turno_id)), cuentas_pendientes: pendientes };
    }

    function cajaEstado(p, user) {
      var cajaId = str(p.caja_id);
      requireCaja(user, cajaId);
      var t = openTurno(cajaId);
      var cobros = t ? db.all('Cobros').filter(function (c) { return c.turno_id === t.turno_id; }).map(cobroView) : [];
      var movs = t ? db.all('Movimientos').filter(function (m) { return m.turno_id === t.turno_id; }) : [];
      var ultimos = db.all('Turnos').filter(function (x) { return x.caja_id === cajaId && x.estado === 'CERRADO'; })
        .sort(function (a, b) { return a.cerrado_en < b.cerrado_en ? 1 : -1; }).slice(0, 10).map(turnoView);
      return { caja_id: cajaId, turno: t ? turnoView(t) : null, cobros: cobros, movimientos: movs, cierres: ultimos, medios_pago: mediosPago() };
    }

    // ---------------------------------------------------------------- sync
    function syncData(p, user) {
      var rev = int(cfg('rev'));
      if (int(p.since) === rev) return { rev: rev, sin_cambios: true };
      var today = env.dateKey(now());
      var cuentas = db.all('Cuentas');
      var abiertas = {};
      cuentas.forEach(function (c) { if (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO') abiertas[c.cuenta_id] = true; });
      var pedidos = db.all('Pedidos').filter(function (x) {
        var active = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO'].indexOf(x.estado) >= 0;
        return active || abiertas[x.cuenta_id] || x.fecha === today;
      });
      if (user.rol === 'CAJA') {
        var pu = puntoDeCaja(user.caja_id);
        pedidos = pedidos.filter(function (x) { return x.punto_id === pu; });
      }
      var cuentasVis = cuentas.filter(function (c) {
        return (abiertas[c.cuenta_id] || str(c.cerrada_en).slice(0, 10) === today || str(c.abierta_en).slice(0, 10) === today) &&
          (user.rol !== 'CAJA' || c.caja_id === user.caja_id);
      });
      var out = {
        rev: rev, ahora: iso(now()), hoy: today,
        ajustes: { cocina_alertas: alertasCocina() },
        pedidos: pedidos.map(orderView),
        cuentas: user.rol === 'COCINA' ? [] : cuentasVis.map(cuentaView),
        mesas: db.all('Mesas').filter(function (m) { return isTrue(m.activa); }).map(function (m) { return { mesa_id: m.mesa_id, numero: int(m.numero), nombre: m.nombre, zona: m.zona, punto_id: m.punto_id }; })
          .sort(function (a, b) { return a.numero - b.numero; }),
        puntos: db.all('Puntos').map(function (x) { return pick(x, ['punto_id', 'nombre', 'modalidad', 'prefijo', 'caja_id']); }),
        disponibilidad: db.all('Productos').filter(function (x) { return isTrue(x.activo); }).map(function (x) { return { id: x.producto_id, nombre: x.nombre, categoria: x.categoria_id, disponible: isTrue(x.disponible) }; })
      };
      return out;
    }

    // ---------------------------------------------------------------- admin
    var PROD_FIELDS = ['categoria_id', 'nombre', 'descripcion', 'precio_gs', 'activo', 'disponible', 'puntos', 'grupos', 'orden', 'validacion', 'nota'];
    function productUpsert(p, user) {
      requireRole(user, ['ADMIN']);
      var d = p.producto || {};
      var id = str(d.producto_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      must(id.length >= 2, 'ID_INVALIDO', 'Código de producto inválido.');
      must(db.get('Categorias', str(d.categoria_id)), 'CATEGORIA_INVALIDA', 'Categoría inválida.');
      must(cleanText(d.nombre, 80).length >= 2, 'NOMBRE_INVALIDO', 'Nombre inválido.');
      must(isInt(d.precio_gs) && d.precio_gs >= 0 && d.precio_gs <= 10000000, 'PRECIO_INVALIDO', 'Precio inválido (entero en guaraníes).');
      csv(d.grupos).forEach(function (g) { must(db.get('Grupos', g), 'GRUPO_INVALIDO', 'Grupo de opciones inexistente: ' + g); });
      csv(d.puntos).forEach(function (x) { must(db.get('Puntos', x), 'PUNTO_INVALIDO', 'Punto inexistente: ' + x); });
      var row = {
        categoria_id: str(d.categoria_id), nombre: cleanText(d.nombre, 80), descripcion: cleanText(d.descripcion, 300), precio_gs: d.precio_gs,
        activo: isTrue(d.activo) ? 'SI' : 'NO', disponible: isTrue(d.disponible) ? 'SI' : 'NO', puntos: csv(d.puntos).join(','),
        grupos: csv(d.grupos).join(','), orden: int(d.orden), validacion: cleanText(d.validacion || 'POR_VALIDAR', 40), nota: cleanText(d.nota, 300),
        actualizado_en: iso(now())
      };
      var prev = db.get('Productos', id);
      if (prev) {
        var cambios = {};
        PROD_FIELDS.forEach(function (k) { if (String(prev[k]) !== String(row[k])) cambios[k] = [prev[k], row[k]]; });
        db.update('Productos', id, row);
        audit(user, 'PRODUCTO_EDITADO', 'Productos', id, cambios);
      } else {
        row.producto_id = id; row.fuente = 'Admin ' + user.usuario_id;
        db.insert('Productos', row);
        audit(user, 'PRODUCTO_CREADO', 'Productos', id, row);
      }
      bumpRev();
      return { producto_id: id };
    }
    function productAvailability(p, user) {
      requireRole(user, ['ADMIN', 'COCINA']);
      var prod = db.get('Productos', str(p.producto_id));
      must(prod, 'PRODUCTO_INEXISTENTE', 'Producto inexistente.', 404);
      var v = isTrue(p.disponible) ? 'SI' : 'NO';
      db.update('Productos', prod.producto_id, { disponible: v, actualizado_en: iso(now()) });
      audit(user, 'DISPONIBILIDAD', 'Productos', prod.producto_id, { disponible: v });
      bumpRev();
      return { producto_id: prod.producto_id, disponible: v === 'SI' };
    }
    function groupUpsert(p, user) {
      requireRole(user, ['ADMIN']);
      var g = p.grupo || {};
      var id = str(g.grupo_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      must(id.length >= 3, 'ID_INVALIDO', 'Código de grupo inválido.');
      var mn = int(g.min), mx = int(g.max);
      must(mn >= 0 && mx >= 1 && mx >= mn && mx <= 10, 'GRUPO_INVALIDO', 'Mínimo/máximo inválidos.');
      var row = { nombre: cleanText(g.nombre, 60), min: mn, max: mx, activo: isTrue(g.activo) ? 'SI' : 'NO', nota: cleanText(g.nota, 200) };
      must(row.nombre.length >= 2, 'NOMBRE_INVALIDO', 'Nombre inválido.');
      if (db.get('Grupos', id)) db.update('Grupos', id, row); else { row.grupo_id = id; db.insert('Grupos', row); }
      var ops = Array.isArray(g.opciones) ? g.opciones : [];
      ops.forEach(function (o, i) {
        var oid = str(o.opcion_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_') || (id + '_' + (i + 1));
        must(isInt(o.delta_gs) && o.delta_gs >= 0, 'PRECIO_INVALIDO', 'Diferencia de precio inválida.');
        var orow = { grupo_id: id, nombre: cleanText(o.nombre, 60), delta_gs: o.delta_gs, activo: isTrue(o.activo) ? 'SI' : 'NO', orden: i + 1 };
        var ex = db.get('Opciones', oid);
        if (ex) { must(ex.grupo_id === id, 'ID_INVALIDO', 'La opción ' + oid + ' pertenece a otro grupo.'); db.update('Opciones', oid, orow); }
        else { orow.opcion_id = oid; db.insert('Opciones', orow); }
      });
      audit(user, 'GRUPO_GUARDADO', 'Grupos', id, { grupo: row, opciones: ops });
      bumpRev();
      return { grupo_id: id };
    }
    function categoryUpsert(p, user) {
      requireRole(user, ['ADMIN']);
      var c = p.categoria || {};
      var id = str(c.categoria_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      must(id.length >= 2, 'ID_INVALIDO', 'Código inválido.');
      var row = { nombre: cleanText(c.nombre, 60), orden: int(c.orden), activa: isTrue(c.activa) ? 'SI' : 'NO', nota: cleanText(c.nota, 200) };
      if (db.get('Categorias', id)) db.update('Categorias', id, row); else { row.categoria_id = id; db.insert('Categorias', row); }
      audit(user, 'CATEGORIA_GUARDADA', 'Categorias', id, row);
      bumpRev();
      return { categoria_id: id };
    }
    function mesaUpsert(p, user) {
      requireRole(user, ['ADMIN']);
      var m = p.mesa || {};
      var numero = int(m.numero);
      must(numero >= 1 && numero <= 99, 'MESA_INVALIDA', 'Número de mesa inválido.');
      var id = str(m.mesa_id) || ('M' + pad(numero, 2));
      if (!str(m.mesa_id)) must(!db.get('Mesas', id), 'MESA_DUPLICADA', 'Ya existe la mesa número ' + numero + '.', 409);
      else must(db.get('Mesas', id), 'MESA_INVALIDA', 'Mesa inexistente.', 404);
      var row = { punto_id: 'A_CAFE', numero: numero, nombre: cleanText(m.nombre, 30) || ('Mesa ' + numero), zona: cleanText(m.zona, 30), activa: isTrue(m.activa) ? 'SI' : 'NO' };
      var ex = db.get('Mesas', id);
      if (ex) db.update('Mesas', id, row); else { row.mesa_id = id; row.qr_token = env.token(12); db.insert('Mesas', row); }
      audit(user, 'MESA_GUARDADA', 'Mesas', id, row);
      bumpRev();
      return { mesa_id: id };
    }
    function rotateQr(p, user) {
      requireRole(user, ['ADMIN']);
      var tok = env.token(12);
      if (p.mesa_id) {
        must(db.get('Mesas', str(p.mesa_id)), 'MESA_INVALIDA', 'Mesa inválida.');
        db.update('Mesas', str(p.mesa_id), { qr_token: tok });
      } else {
        must(db.get('Puntos', str(p.punto_id)), 'PUNTO_INVALIDO', 'Punto inválido.');
        db.update('Puntos', str(p.punto_id), { qr_token: tok });
      }
      audit(user, 'QR_REGENERADO', p.mesa_id ? 'Mesas' : 'Puntos', str(p.mesa_id || p.punto_id), 'Token anterior invalidado');
      bumpRev();
      return { qr_token: tok };
    }
    function userUpsert(p, user) {
      requireRole(user, ['ADMIN']);
      var u = p.usuario || {};
      var id = str(u.usuario_id).toLowerCase().replace(/[^a-z0-9_.]/g, '');
      must(id.length >= 3 && id.length <= 30, 'ID_INVALIDO', 'El usuario debe tener entre 3 y 30 letras/números.');
      must(ROLES.indexOf(u.rol) >= 0, 'ROL_INVALIDO', 'Rol inválido.');
      if (u.rol === 'CAJA') must(db.get('Cajas', str(u.caja_id)), 'CAJA_INVALIDA', 'Elegí la caja del usuario.');
      var ex = db.get('Usuarios', id);
      var row = { nombre: cleanText(u.nombre, 60), rol: u.rol, caja_id: u.rol === 'CAJA' ? str(u.caja_id) : '', activo: isTrue(u.activo) ? 'SI' : 'NO' };
      must(row.nombre.length >= 2, 'NOMBRE_INVALIDO', 'Nombre inválido.');
      if (id === user.usuario_id) must(row.rol === 'ADMIN' && row.activo === 'SI', 'AUTO_BLOQUEO', 'No podés quitarte el rol de administrador ni desactivarte.');
      if (u.pin) {
        must(/^[0-9]{4,8}$/.test(str(u.pin)), 'PIN_INVALIDO', 'El PIN debe tener de 4 a 8 dígitos.');
        row.pin_salt = env.token(16); row.pin_hash = hashPin(str(u.pin), row.pin_salt); row.intentos = 0; row.bloqueado_hasta = '';
      } else must(ex, 'PIN_REQUERIDO', 'Asigná un PIN al usuario nuevo.');
      if (ex) {
        if (u.pin || row.rol !== ex.rol || row.activo !== ex.activo || row.caja_id !== ex.caja_id) row.token_version = int(ex.token_version) + 1;
        db.update('Usuarios', id, row);
      } else {
        row.usuario_id = id; row.token_version = 1; row.creado_en = iso(now());
        db.insert('Usuarios', row);
      }
      audit(user, ex ? 'USUARIO_EDITADO' : 'USUARIO_CREADO', 'Usuarios', id, { rol: row.rol, caja_id: row.caja_id, activo: row.activo, pin_cambiado: !!u.pin });
      bumpRev();
      return { usuario_id: id };
    }
    function configSet(p, user) {
      requireRole(user, ['ADMIN']);
      var k = str(p.clave);
      must(DEFAULT_CONFIG[k] && k !== 'rev', 'CLAVE_INVALIDA', 'Configuración no editable.');
      var v = cleanText(p.valor, 300);
      if (k === 'cocina_alerta_min') {
        var mins = csv(v);
        must(mins.length >= 1 && mins.length <= 3 && mins.every(function (x, i) { return /^[0-9]{1,3}$/.test(x) && int(x) >= 1 && int(x) <= 180 && (i === 0 || int(x) > int(mins[i - 1])); }), 'VALOR_INVALIDO', 'Indicá de 1 a 3 minutos crecientes entre 1 y 180, separados por coma (ej.: 5,10,15).');
        v = mins.join(',');
      }
      if (k === 'medios_pago') must(csv(v).length > 0 && csv(v).every(function (x) { return /^[A-Z_]{2,20}$/.test(x); }), 'VALOR_INVALIDO', 'Medios: palabras en MAYÚSCULAS separadas por coma.');
      var prev = cfg(k);
      if (db.get('Config', k)) db.update('Config', k, { valor: v }); else db.insert('Config', { clave: k, valor: v, descripcion: DEFAULT_CONFIG[k][1] });
      audit(user, 'CONFIG', 'Config', k, { antes: prev, despues: v });
      bumpRev();
      return { clave: k, valor: v };
    }
    function adminData(p, user) {
      requireRole(user, ['ADMIN']);
      return {
        menu: menuFor(null, true),
        mesas: db.all('Mesas').map(function (m) { return pick(m, ['mesa_id', 'punto_id', 'numero', 'nombre', 'zona', 'qr_token', 'activa']); })
          .sort(function (a, b) { return int(a.numero) - int(b.numero); }),
        puntos: db.all('Puntos').map(function (x) { return pick(x, ['punto_id', 'nombre', 'modalidad', 'prefijo', 'caja_id', 'qr_token', 'activo']); }),
        cajas: db.all('Cajas'),
        usuarios: db.all('Usuarios').map(function (u) { return pick(u, ['usuario_id', 'nombre', 'rol', 'caja_id', 'activo', 'bloqueado_hasta']); }),
        config: Object.keys(DEFAULT_CONFIG).filter(function (k) { return k !== 'rev'; }).map(function (k) { return { clave: k, valor: cfg(k), descripcion: DEFAULT_CONFIG[k][1] }; })
      };
    }

    // ---------------------------------------------------------------- reportes
    function inRange(ts, desde, hasta) { var d = ts ? env.dateKey(Date.parse(ts)) : ''; return d >= desde && d <= hasta; }
    function report(p, user) {
      requireRole(user, ['ADMIN']);
      var desde = str(p.desde) || env.dateKey(now()), hasta = str(p.hasta) || desde;
      must(/^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta) && desde <= hasta, 'RANGO_INVALIDO', 'Rango de fechas inválido.');
      var H = function (t) { return db.history ? db.history(t) : db.all(t); };
      var movs = H('Movimientos').filter(function (m) { return inRange(m.fecha, desde, hasta); });
      var cajas = {};
      db.all('Cajas').forEach(function (c) { cajas[c.caja_id] = { caja_id: c.caja_id, nombre: c.nombre, ventas_netas_gs: 0, cobros_gs: 0, reversos_gs: 0, por_medio: {}, cantidad_cobros: 0, descuentos_gs: 0 }; });
      movs.forEach(function (m) {
        var c = cajas[m.caja_id]; if (!c) return;
        var v = int(m.monto_gs);
        if (m.tipo === 'COBRO' || m.tipo === 'REVERSO') {
          c.ventas_netas_gs += v; c.por_medio[m.medio] = (c.por_medio[m.medio] || 0) + v;
          if (m.tipo === 'COBRO') c.cobros_gs += v; else c.reversos_gs += v;
        }
      });
      var cobros = H('Cobros').filter(function (c) { return inRange(c.fecha, desde, hasta); });
      cobros.forEach(function (c) { var k = cajas[c.caja_id]; if (!k) return; if (c.estado === 'VALIDO') { k.cantidad_cobros++; k.descuentos_gs += int(c.descuento_gs); } });
      var pedidos = H('Pedidos').filter(function (x) { return x.fecha >= desde && x.fecha <= hasta; });
      var pedIds = {}; pedidos.forEach(function (x) { pedIds[x.pedido_id] = x; });
      var porPunto = {}, porEstado = {}, porOrigen = {};
      pedidos.forEach(function (x) {
        porPunto[x.punto_id] = (porPunto[x.punto_id] || 0) + 1;
        porEstado[x.estado] = (porEstado[x.estado] || 0) + 1;
        porOrigen[x.origen] = (porOrigen[x.origen] || 0) + 1;
      });
      var top = {};
      H('PedidoItems').forEach(function (i) {
        var ped = pedIds[i.pedido_id];
        if (!ped || ped.estado === 'CANCELADO' || isTrue(i.anulado)) return;
        var t = top[i.producto_id] || (top[i.producto_id] = { producto_id: i.producto_id, nombre: i.nombre, cantidad: 0, importe_gs: 0 });
        t.cantidad += int(i.cantidad); t.importe_gs += int(i.total_gs);
      });
      var tiempos = [];
      pedidos.forEach(function (x) {
        if (x.aceptado_en && x.listo_en && x.estado !== 'CANCELADO') tiempos.push((Date.parse(x.listo_en) - Date.parse(x.aceptado_en)) / 60000);
      });
      tiempos.sort(function (a, b) { return a - b; });
      var cancelados = pedidos.filter(function (x) { return x.estado === 'CANCELADO'; }).map(function (x) {
        return { numero: x.numero, fecha: x.fecha, punto_id: x.punto_id, total_gs: int(x.total_gs), motivo: x.motivo_cancelacion };
      });
      var cierres = H('Turnos').filter(function (t) { return inRange(t.abierto_en, desde, hasta); }).map(turnoView);
      var consolidado = Object.keys(cajas).reduce(function (s, k) { return s + cajas[k].ventas_netas_gs; }, 0);
      return {
        desde: desde, hasta: hasta, cajas: Object.keys(cajas).map(function (k) { return cajas[k]; }), consolidado_gs: consolidado,
        pedidos: { total: pedidos.length, por_punto: porPunto, por_estado: porEstado, por_origen: porOrigen },
        top_productos: Object.keys(top).map(function (k) { return top[k]; }).sort(function (a, b) { return b.cantidad - a.cantidad; }).slice(0, 20),
        cancelados: cancelados,
        tiempos_preparacion_min: tiempos.length >= 5 ? {
          muestras: tiempos.length, promedio: Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10,
          mediana: Math.round(tiempos[Math.floor(tiempos.length / 2)] * 10) / 10
        } : { muestras: tiempos.length, nota: 'Datos insuficientes (mínimo 5 pedidos con aceptado y listo).' },
        cierres: cierres,
        cobros_revertidos: cobros.filter(function (c) { return c.estado === 'REVERTIDO'; }).map(cobroView)
      };
    }
    function auditList(p, user) {
      requireRole(user, ['ADMIN']);
      var rows = db.all('Auditoria').slice(-300).reverse();
      return { auditoria: rows };
    }

    // ---------------------------------------------------------------- público
    function resolveToken(token) {
      token = str(token, 40);
      must(token.length >= 8, 'QR_INVALIDO', 'Código QR inválido.', 404);
      var m = db.all('Mesas').filter(function (x) { return x.qr_token === token && isTrue(x.activa); })[0];
      if (m) return { tipo: 'MESA', mesa_id: m.mesa_id, mesa: m.nombre, punto_id: m.punto_id };
      var pt = db.all('Puntos').filter(function (x) { return x.qr_token === token && isTrue(x.activo); })[0];
      if (pt) return { tipo: 'PUNTO', punto_id: pt.punto_id, nombre: pt.nombre, modalidad: pt.modalidad };
      fail('QR_INVALIDO', 'Este código QR ya no es válido. Pedí ayuda al personal.', 404);
    }
    function publicResolve(p) {
      var r = resolveToken(p.token);
      var out = { tipo: r.tipo, punto_id: r.punto_id, nombre_punto: db.get('Puntos', r.punto_id).nombre, negocio: cfg('nombre_negocio') };
      if (r.tipo === 'MESA') out.mesa = r.mesa;
      out.pedidos_habilitados = isTrue(cfg('qr_pedidos_habilitados')) && (r.tipo === 'MESA' || isTrue(cfg('takeaway_qr_habilitado')));
      out.requiere_aceptacion = isTrue(cfg('qr_requiere_aceptacion'));
      out.menu = menuFor(r.punto_id, false);
      return out;
    }
    function publicOrder(p) {
      var r = resolveToken(p.token);
      must(isTrue(cfg('qr_pedidos_habilitados')) && (r.tipo === 'MESA' || isTrue(cfg('takeaway_qr_habilitado'))), 'QR_DESHABILITADO', 'Los pedidos por QR están deshabilitados. Pedí al personal.', 403);
      // Reintento idempotente: no consume cupo de rate limit
      var prev = db.all('Pedidos').filter(function (x) { return x.request_id === str(p.request_id, 80); })[0];
      if (prev) return { numero: prev.numero, estado: prev.estado, total_gs: int(prev.total_gs), status_token: prev.status_token, duplicado: true };
      rateLimit('qr:' + str(p.token), int(cfg('max_pedidos_qr_10min') || 6), 600);
      rateLimit('qr:global', 120, 600);
      var res = createOrder({
        request_id: p.request_id, mesa_id: r.tipo === 'MESA' ? r.mesa_id : '', punto_id: r.punto_id,
        alias: p.alias, observacion: p.observacion, items: p.items
      }, null, 'QR');
      var ped = db.get('Pedidos', res.pedido.pedido_id);
      return { numero: ped.numero, estado: ped.estado, total_gs: int(ped.total_gs), status_token: ped.status_token, duplicado: res.duplicado };
    }
    function publicStatus(p) {
      var tok = str(p.status_token, 40);
      must(tok.length >= 16, 'NO_ENCONTRADO', 'Pedido no encontrado.', 404);
      var ped = db.all('Pedidos').filter(function (x) { return x.status_token === tok; })[0];
      must(ped, 'NO_ENCONTRADO', 'Pedido no encontrado.', 404);
      return {
        numero: ped.numero, estado: ped.estado, mesa: ped.mesa_id ? mesaNombre(ped.mesa_id) : '', alias: ped.alias, total_gs: int(ped.total_gs),
        creado_en: ped.creado_en, items: itemsOf(ped.pedido_id).filter(function (i) { return !isTrue(i.anulado); }).map(function (i) { return { nombre: i.nombre, cantidad: int(i.cantidad), opciones: i.opciones }; })
      };
    }

    // ---------------------------------------------------------------- login
    function login(p) {
      var id = str(p.usuario).toLowerCase();
      var u = db.get('Usuarios', id);
      must(u && isTrue(u.activo), 'LOGIN_INVALIDO', 'Usuario o PIN incorrecto.', 401);
      must(!(int(u.bloqueado_hasta) > now()), 'USUARIO_BLOQUEADO', 'Demasiados intentos. Esperá 5 minutos.', 429);
      if (hashPin(str(p.pin), u.pin_salt) !== u.pin_hash) {
        var n = int(u.intentos) + 1;
        db.update('Usuarios', id, { intentos: n >= 5 ? 0 : n, bloqueado_hasta: n >= 5 ? now() + 5 * 60000 : '' });
        if (n >= 5) audit(null, 'USUARIO_BLOQUEADO', 'Usuarios', id, 'Bloqueo por intentos fallidos');
        return { __commitAndFail: new AppError('LOGIN_INVALIDO', 'Usuario o PIN incorrecto.', 401) };
      }
      if (int(u.intentos) || u.bloqueado_hasta) db.update('Usuarios', id, { intentos: 0, bloqueado_hasta: '' });
      audit(u, 'LOGIN', 'Usuarios', id, '');
      return { token: signSession(u), usuario: { usuario_id: u.usuario_id, nombre: u.nombre, rol: u.rol, caja_id: u.caja_id } };
    }
    function logoutAll(p, user) {
      // Invalida todas las sesiones del propio usuario (o de otro, si es ADMIN)
      var id = str(p.usuario_id) || user.usuario_id;
      if (id !== user.usuario_id) requireRole(user, ['ADMIN']);
      var u = db.get('Usuarios', id);
      must(u, 'USUARIO_INEXISTENTE', 'Usuario inexistente.', 404);
      db.update('Usuarios', id, { token_version: int(u.token_version) + 1 });
      audit(user, 'SESIONES_CERRADAS', 'Usuarios', id, '');
      return { ok: true };
    }

    // ---------------------------------------------------------------- router
    var PUBLIC = {
      'public.resolve': publicResolve, 'public.order': publicOrder, 'public.status': publicStatus, 'auth.login': login,
      'health': function () { return { ok: true, version: VERSION, hora: iso(now()) }; }
    };
    var STAFF = {
      'sync': syncData,
      'me': function (p, u) { return { usuario: { usuario_id: u.usuario_id, nombre: u.nombre, rol: u.rol, caja_id: u.caja_id } }; },
      'menu': function (p, u) { return menuFor(str(p.punto_id) || null, false); },
      'order.create': function (p, u) { requireRole(u, ['ADMIN', 'MOZO', 'CAJA']); return createOrder(p, u, u.rol === 'CAJA' ? 'CAJA' : 'MOZO'); },
      'order.state': setState,
      'order.cancel': cancelOrder,
      'order.voidItem': voidItem,
      'cuenta.requestClose': requestClose,
      'caja.estado': cajaEstado, 'caja.abrir': cajaAbrir, 'caja.cobrar': cajaCobrar, 'caja.revertir': cajaRevertir,
      'caja.movimiento': cajaMovimiento, 'caja.cerrar': cajaCerrar,
      'product.availability': productAvailability,
      'admin.data': adminData, 'admin.product': productUpsert, 'admin.group': groupUpsert, 'admin.category': categoryUpsert,
      'admin.mesa': mesaUpsert, 'admin.rotateQr': rotateQr, 'admin.user': userUpsert, 'admin.config': configSet,
      'admin.report': report, 'admin.audit': auditList, 'auth.logoutAll': logoutAll
    };
    var READONLY = { 'public.resolve': 1, 'public.status': 1, 'health': 1, 'sync': 1, 'me': 1, 'menu': 1, 'caja.estado': 1, 'admin.data': 1, 'admin.report': 1, 'admin.audit': 1 };

    function handle(req) {
      req = req || {};
      var action = str(req.action);
      var payload = req.payload || {};
      var fnPub = PUBLIC[action], fnStaff = STAFF[action];
      if (!fnPub && !fnStaff) return { ok: false, error: { code: 'ACCION_DESCONOCIDA', message: 'Acción desconocida.' }, status: 404 };
      var run = function () {
        db = store.begin();
        try {
          var user = fnStaff ? verifySession(req.token) : null;
          var data = fnPub ? fnPub(payload) : fnStaff(payload, user);
          if (data && data.__commitAndFail) { db.commit(); throw data.__commitAndFail; }
          if (!READONLY[action]) db.commit(); else db.rollback();
          return { ok: true, data: data, status: 200 };
        } catch (e) {
          db.rollback();
          throw e;
        }
      };
      try {
        return READONLY[action] ? run() : store.withLock(run);
      } catch (e) {
        if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message }, status: e.status };
        if (env.log) env.log('ERROR ' + action + ': ' + (e && e.stack || e));
        return { ok: false, error: { code: 'ERROR_INTERNO', message: 'Error interno. Reintentá; si persiste avisá al encargado.' }, status: 500 };
      }
    }

    // ---------------------------------------------------------------- setup
    // Crea datos base (puntos, cajas, mesas, catálogo, configuración y un ADMIN).
    // Solo inserta lo que no existe: es seguro ejecutarlo más de una vez.
    function seed(opts) {
      opts = opts || {};
      return store.withLock(function () {
        db = store.begin();
        var created = [];
        function ensure(table, row) {
          if (!db.get(table, row[KEYS[table]])) { db.insert(table, row); created.push(table + ':' + row[KEYS[table]]); }
        }
        Object.keys(DEFAULT_CONFIG).forEach(function (k) { ensure('Config', { clave: k, valor: DEFAULT_CONFIG[k][0], descripcion: DEFAULT_CONFIG[k][1] }); });
        var mp = db.get('Config', 'medios_pago');
        if (mp && mp.valor === 'EFECTIVO,TARJETA,TRANSFERENCIA') { db.update('Config', 'medios_pago', { valor: DEFAULT_CONFIG.medios_pago[0], descripcion: DEFAULT_CONFIG.medios_pago[1] }); created.push('Config:medios_pago'); }
        var am = db.get('Config', 'cocina_alerta_min');
        if (am && String(am.valor) === '5' && am.descripcion.indexOf('Hasta 3 valores') < 0) { db.update('Config', 'cocina_alerta_min', { valor: DEFAULT_CONFIG.cocina_alerta_min[0], descripcion: DEFAULT_CONFIG.cocina_alerta_min[1] }); created.push('Config:cocina_alerta_min'); }
        ensure('Cajas', { caja_id: 'CAJA_A', punto_id: 'A_CAFE', nombre: 'Caja 01 — Cafetería principal', activo: 'SI' });
        ensure('Cajas', { caja_id: 'CAJA_B', punto_id: 'B_TAKEAWAY', nombre: 'Caja 02 — Andrade Takeaway', activo: 'SI' });
        ensure('Puntos', { punto_id: 'A_CAFE', nombre: 'Cafetería principal', modalidad: 'SALON', prefijo: 'A', caja_id: 'CAJA_A', qr_token: env.token(12), activo: 'SI' });
        ensure('Puntos', { punto_id: 'B_TAKEAWAY', nombre: 'Andrade Takeaway (casita)', modalidad: 'TAKEAWAY', prefijo: 'T', caja_id: 'CAJA_B', qr_token: env.token(12), activo: 'SI' });
        var nMesas = int(opts.mesas || 20);
        for (var i = 1; i <= nMesas; i++) {
          ensure('Mesas', { mesa_id: 'M' + pad(i, 2), punto_id: 'A_CAFE', numero: i, nombre: 'Mesa ' + i, zona: '', qr_token: env.token(12), activa: 'SI' });
        }
        var cat = opts.catalogo;
        if (cat) {
          cat.categorias.forEach(function (c) { ensure('Categorias', { categoria_id: c.categoria_id, nombre: c.nombre, orden: c.orden, activa: c.activa ? 'SI' : 'NO', nota: c.nota }); });
          cat.grupos.forEach(function (g) { ensure('Grupos', { grupo_id: g.grupo_id, nombre: g.nombre, min: g.min, max: g.max, activo: 'SI', nota: g.nota }); });
          cat.opciones.forEach(function (o) { ensure('Opciones', { opcion_id: o.opcion_id, grupo_id: o.grupo_id, nombre: o.nombre, delta_gs: o.delta_gs, activo: 'SI', orden: o.orden }); });
          cat.productos.forEach(function (p) {
            ensure('Productos', {
              producto_id: p.producto_id, categoria_id: p.categoria_id, nombre: p.nombre, descripcion: p.descripcion, precio_gs: p.precio_gs,
              activo: 'SI', disponible: 'SI', puntos: p.puntos, grupos: p.grupos, orden: p.orden, fuente: p.fuente, validacion: p.validacion, nota: p.nota, actualizado_en: iso(now())
            });
          });
        }
        var admins = db.all('Usuarios').filter(function (u) { return u.rol === 'ADMIN'; });
        var adminPin = null;
        if (!admins.length && opts.admin) {
          adminPin = opts.admin.pin;
          var salt = env.token(16);
          db.insert('Usuarios', {
            usuario_id: opts.admin.usuario_id, nombre: opts.admin.nombre, rol: 'ADMIN', caja_id: '', pin_hash: hashPin(adminPin, salt), pin_salt: salt,
            activo: 'SI', token_version: 1, intentos: 0, bloqueado_hasta: '', creado_en: iso(now())
          });
          created.push('Usuarios:' + opts.admin.usuario_id);
        }
        (opts.usuarios || []).forEach(function (u) {
          if (db.get('Usuarios', u.usuario_id)) return;
          var s = env.token(16);
          db.insert('Usuarios', {
            usuario_id: u.usuario_id, nombre: u.nombre, rol: u.rol, caja_id: u.caja_id || '', pin_hash: hashPin(u.pin, s), pin_salt: s,
            activo: 'SI', token_version: 1, intentos: 0, bloqueado_hasta: '', creado_en: iso(now())
          });
          created.push('Usuarios:' + u.usuario_id);
        });
        if (created.length) bumpRev();
        db.commit();
        return { creados: created.length };
      });
    }

    // Mueve a archivo los registros cerrados con más de N días.
    function archive() {
      return store.withLock(function () {
        db = store.begin();
        var dias = int(cfg('dias_activos') || 2);
        var limite = env.dateKey(now() - dias * 86400000);
        var cuentasCerradas = {};
        db.all('Cuentas').forEach(function (c) {
          if ((c.estado === 'CERRADA' || c.estado === 'ANULADA') && str(c.cerrada_en) && env.dateKey(Date.parse(c.cerrada_en)) < limite) cuentasCerradas[c.cuenta_id] = true;
        });
        var peds = {};
        db.all('Pedidos').forEach(function (p) {
          var terminal = p.estado === 'ENTREGADO' || p.estado === 'CANCELADO';
          if (terminal && cuentasCerradas[p.cuenta_id] && p.fecha < limite) peds[p.pedido_id] = true;
        });
        // No archivar cuentas que tengan algún pedido aún activo
        db.all('Pedidos').forEach(function (p) { if (cuentasCerradas[p.cuenta_id] && !peds[p.pedido_id]) delete cuentasCerradas[p.cuenta_id]; });
        var turnosCerrados = {};
        db.all('Turnos').forEach(function (t) { if (t.estado === 'CERRADO' && env.dateKey(Date.parse(t.cerrado_en)) < limite) turnosCerrados[t.turno_id] = true; });
        var n = {};
        n.Pedidos = db.archive('Pedidos', function (r) { return peds[r.pedido_id] && cuentasCerradas[r.cuenta_id]; });
        n.PedidoItems = db.archive('PedidoItems', function (r) { var p = db.get('Pedidos', r.pedido_id); return !p; });
        n.Historial = db.archive('Historial', function (r) { return !db.get('Pedidos', r.pedido_id); });
        n.Cuentas = db.archive('Cuentas', function (r) { return cuentasCerradas[r.cuenta_id]; });
        n.Cobros = db.archive('Cobros', function (r) { return turnosCerrados[r.turno_id] && !db.get('Cuentas', r.cuenta_id); });
        n.Movimientos = db.archive('Movimientos', function (r) { return turnosCerrados[r.turno_id] && (!r.cuenta_id || !db.get('Cuentas', r.cuenta_id)); });
        n.Turnos = db.archive('Turnos', function (r) {
          return turnosCerrados[r.turno_id] && !db.all('Movimientos').some(function (m) { return m.turno_id === r.turno_id; });
        });
        n.Auditoria = db.archive('Auditoria', function (r) { return env.dateKey(Date.parse(r.fecha)) < limite; });
        db.commit();
        return n;
      });
    }

    return { handle: handle, seed: seed, archive: archive, _hashPin: hashPin };
  }

  return { create: create, SCHEMA: SCHEMA, KEYS: KEYS, ARCHIVABLE: ARCHIVABLE, VERSION: VERSION, ESTADOS: ESTADOS, TRANSICIONES: TRANSICIONES, DEFAULT_CONFIG: DEFAULT_CONFIG };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MesaCore;
