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
    Mesas: ['mesa_id', 'punto_id', 'numero', 'nombre', 'zona', 'qr_token', 'activa', 'reserva_nombre', 'reserva_hora', 'reserva_personas', 'reserva_nota', 'reserva_por', 'pagada_en'],
    Categorias: ['categoria_id', 'nombre', 'orden', 'activa', 'nota', 'estacion'],
    Productos: ['producto_id', 'categoria_id', 'nombre', 'descripcion', 'precio_gs', 'activo', 'disponible', 'puntos', 'grupos', 'orden', 'fuente', 'validacion', 'nota', 'actualizado_en', 'modelo_3d', 'imagen', 'dias', 'estacion', 'armador'],
    Grupos: ['grupo_id', 'nombre', 'min', 'max', 'activo', 'nota', 'regla', 'tipo', 'repetir'],
    Opciones: ['opcion_id', 'grupo_id', 'nombre', 'delta_gs', 'activo', 'orden', 'dibujo'],
    Usuarios: ['usuario_id', 'nombre', 'rol', 'caja_id', 'pin_hash', 'pin_salt', 'activo', 'token_version', 'intentos', 'bloqueado_hasta', 'creado_en', 'para_llevar'],
    Cuentas: ['cuenta_id', 'punto_id', 'caja_id', 'mesa_id', 'alias', 'estado', 'pago_estado', 'abierta_en', 'cierre_solicitado_en', 'cerrada_en', 'cobro_id', 'creado_por', 'comprobante', 'fact_ruc', 'fact_razon', 'fact_email', 'personas', 'cliente_id', 'cierre_pedido', 'whatsapp', 'acepta_promos', 'mesa_antes', 'trasladada_en', 'trasladada_por'],
    Pedidos: ['pedido_id', 'request_id', 'numero', 'fecha', 'cuenta_id', 'punto_id', 'caja_id', 'mesa_id', 'origen', 'modo', 'estado', 'alias', 'observacion', 'total_gs', 'creado_por', 'creado_en', 'actualizado_en', 'aceptado_en', 'preparacion_en', 'listo_en', 'entregado_en', 'cancelado_en', 'motivo_cancelacion', 'status_token', 'whatsapp', 'estaciones'],
    PedidoItems: ['item_id', 'pedido_id', 'producto_id', 'nombre', 'precio_unit_gs', 'cantidad', 'opciones', 'opciones_ids', 'observacion', 'total_gs', 'anulado', 'anulado_por', 'anulado_motivo', 'persona', 'estacion', 'costo_gs', 'stock_ok', 'consumo'],
    Historial: ['evento_id', 'pedido_id', 'fecha', 'usuario_id', 'accion', 'de', 'a', 'detalle'],
    Turnos: ['turno_id', 'caja_id', 'estado', 'abierto_en', 'abierto_por', 'monto_inicial_gs', 'cerrado_en', 'cerrado_por', 'esperado_efectivo_gs', 'declarado_efectivo_gs', 'diferencia_gs', 'totales', 'observacion'],
    Cobros: ['cobro_id', 'request_id', 'cuenta_id', 'caja_id', 'turno_id', 'fecha', 'subtotal_gs', 'descuento_gs', 'total_gs', 'pagos', 'usuario_id', 'autorizado_por', 'motivo_descuento', 'estado', 'revertido_por', 'revertido_en', 'motivo_reverso', 'comprobante', 'detalle', 'recompensa'],
    Movimientos: ['movimiento_id', 'request_id', 'caja_id', 'turno_id', 'cuenta_id', 'cobro_id', 'fecha', 'tipo', 'medio', 'monto_gs', 'usuario_id', 'motivo'],
    Auditoria: ['audit_id', 'fecha', 'usuario_id', 'accion', 'entidad', 'entidad_id', 'detalle'],
    Contadores: ['clave', 'valor'],
    // Módulo Premium · Recompensas (solo opera con licencia: env.modulos incluye RECOMPENSAS)
    RecClientes: ['cliente_id', 'celular', 'nombre', 'cumple', 'email', 'codigo', 'token', 'sellos', 'ciclos', 'visitas', 'canjes', 'ultima_visita', 'ultimo_sello_dia', 'creado_en', 'origen', 'activo', 'nota', 'ultimo_bonus_dia'],
    RecPremios: ['premio_id', 'tipo', 'sellos', 'nombre', 'producto_id', 'valor_gs', 'costo_gs', 'activo', 'orden'],
    RecCupones: ['cupon_id', 'cliente_id', 'premio_id', 'nombre', 'producto_id', 'valor_gs', 'costo_gs', 'estado', 'creado_en', 'vence_en', 'canjeado_en', 'cobro_id', 'usuario_id', 'motivo'],
    // Módulo Gold · Reseñas
    Resenas: ['resena_id', 'request_id', 'clave', 'fecha', 'pedido_id', 'cuenta_id', 'punto_id', 'mesa_id', 'mozo_id', 'cliente_id', 'estrellas', 'comentario', 'canal', 'google_click', 'leida', 'nota', 'sello'],
    RecMovs: ['mov_id', 'cliente_id', 'fecha', 'tipo', 'sellos_delta', 'sellos_despues', 'cuenta_id', 'cobro_id', 'cupon_id', 'caja_id', 'usuario_id', 'detalle'],
    // Upgrade · Mesa Viru (stock y costos). Cantidades en enteros de la unidad base (G, ML o UN); dinero en guaraníes enteros.
    // costo_mil_gs = costo promedio ponderado por 1.000 unidades base (Gs. por kg, por litro o por 1.000 unidades).
    Insumos: ['insumo_id', 'nombre', 'unidad', 'stock', 'costo_mil_gs', 'minimo', 'activo', 'proveedor', 'nota', 'actualizado_en'],
    // Movimientos de stock: eventos que no se editan ni se borran (COMPRA, VENTA, DEVOLUCION, CONTEO, MERMA).
    MovStock: ['mov_id', 'request_id', 'fecha', 'insumo_id', 'tipo', 'cantidad', 'stock_despues', 'costo_gs', 'costo_mil_gs', 'pedido_id', 'item_id', 'referencia', 'usuario_id', 'motivo'],
    // Recetas: insumos por unidad vendida de un producto (opcion_id vacío) o los que suma una opción elegida.
    Recetas: ['receta_id', 'producto_id', 'opcion_id', 'insumo_id', 'cantidad'],
    // Upgrade · Atención Integrada: avisos automáticos por WhatsApp (Whaticket). Cola: el núcleo la llena y el servidor la envía.
    AvisosWA: ['aviso_id', 'pedido_id', 'tipo', 'numero', 'texto', 'estado', 'intentos', 'creado_en', 'enviado_en', 'error']
  };
  var KEYS = {
    Config: 'clave', Puntos: 'punto_id', Cajas: 'caja_id', Mesas: 'mesa_id', Categorias: 'categoria_id',
    Productos: 'producto_id', Grupos: 'grupo_id', Opciones: 'opcion_id', Usuarios: 'usuario_id',
    Cuentas: 'cuenta_id', Pedidos: 'pedido_id', PedidoItems: 'item_id', Historial: 'evento_id',
    Turnos: 'turno_id', Cobros: 'cobro_id', Movimientos: 'movimiento_id', Auditoria: 'audit_id', Contadores: 'clave',
    RecClientes: 'cliente_id', RecPremios: 'premio_id', RecCupones: 'cupon_id', RecMovs: 'mov_id', Resenas: 'resena_id',
    Insumos: 'insumo_id', MovStock: 'mov_id', Recetas: 'receta_id', AvisosWA: 'aviso_id'
  };
  // Tablas operativas que se archivan (las de catálogo/configuración no).
  var ARCHIVABLE = ['Pedidos', 'PedidoItems', 'Historial', 'Cuentas', 'Cobros', 'Movimientos', 'Turnos', 'Auditoria', 'MovStock'];

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

  // Planes comerciales de Mesa Pya'e. Cada local tiene un plan (variable MESA_PLAN del despliegue).
  var MODULOS = {
    FOTOS: 'Fotos de los platos en la carta del cliente',
    MENU3D: 'Menú 3D: platos en 3D y realidad aumentada en la carta',
    RESENAS: 'Reseñas: encuesta interna después del pedido e invitación a reseñar en Google',
    RECOMPENSAS: 'Recompensas: tarjeta de sellos, premios y base de clientes',
    EKUATIAI: "Factura en e-Kuatia'i (DNIT) desde la caja, con la extensión Migrador",
    STOCK: 'Mesa Viru (stock y costos): insumos, compras, recetas, descuento automático con cada venta, conteos y margen por plato',
    ATENCION: 'Atención Integrada: avisos automáticos por WhatsApp al cliente (pedido recibido y pedido listo), con Whaticket',
    ARMADOR: 'Armá tu pedido: el cliente arma su pizza o hamburguesa en la carta QR con una animación (ingredientes, tamaño, dobles y sin)'
  };
  var PLANES = { BASICO: [], GOLD: ['FOTOS', 'RESENAS'], PREMIUM: ['FOTOS', 'RESENAS', 'MENU3D', 'RECOMPENSAS'] };
  // Upgrades: módulos que no entran en ningún plan; se contratan aparte sobre Básico, Gold o Premium
  // y Ser o Límites los activa por local desde ⚙ Licencia (Config "_upgrades") o con MESA_MODULOS en el despliegue.
  var UPGRADES = ['EKUATIAI', 'STOCK', 'ATENCION', 'ARMADOR'];
  // Armador animado: tipos de producto armable, tipos de grupo y dibujos de ingredientes (public/assets/armador.js).
  var ARMADORES = ['PIZZA', 'PORCION', 'HAMBURGUESA'];
  var TIPOS_GRUPO = ['', 'TAMANO', 'QUITAR'];
  var MAX_REPETIR = 5;
  var PLATOS_3D_INCLUIDOS = 5;  // platos en 3D que incluye el plan; Ser o Límites puede ampliarlo por local desde ⚙ Licencia

  var DEFAULT_CONFIG = {
    nombre_negocio: ['Mi local', 'Nombre visible'],
    zona_horaria: ['America/Asuncion', 'Zona horaria de reportes'],
    medios_pago: ['EFECTIVO,TRANSFERENCIA,TC,TD', 'Medios de pago en caja. TC = tarjeta de crédito, TD = tarjeta de débito (incluye pagos con QR del POS)'],
    qr_pedidos_habilitados: ['SI', 'Permite pedidos desde el menú QR'],
    cuenta_qr_habilitada: ['SI', 'SI: el cliente puede pedir la cuenta desde el menú QR, con sus datos de factura y cómo va a pagar (avisa al mozo y a la caja)'],
    qr_requiere_aceptacion: ['SI', 'SI: pedidos QR esperan aceptación de mozo/caja antes de ir a cocina'],
    takeaway_qr_habilitado: ['SI', 'Permite prepedidos desde el QR de para llevar'],
    para_llevar_qr_atiende: ['CAJA', 'Quién atiende los pedidos para llevar hechos desde el QR o la web. CAJA: la caja de para llevar los acepta y los cobra. EQUIPO: los aceptan y entregan los mozos marcados "Atiende para llevar" y la caja del salón, que también los cobra; la caja de para llevar solo recibe el aviso'],
    para_llevar_whatsapp: ['NO', 'WhatsApp del cliente en los pedidos para llevar del QR o la web. NO: no se pide. OPCIONAL u OBLIGATORIO: se pide (con permiso aparte para promociones) y el equipo puede avisarle por WhatsApp cuando el pedido está listo'],
    para_llevar_alerta_min: ['3,5', 'Con EQUIPO: minutos sin aceptar un pedido para llevar del QR para avisar de nuevo a todo el equipo (hasta 3 valores crecientes, ej.: 3,5)'],
    max_pedidos_qr_10min: ['6', 'Límite de pedidos por QR cada 10 minutos'],
    max_items_pedido: ['30', 'Máximo de líneas por pedido'],
    max_cantidad_item: ['20', 'Máxima cantidad por línea'],
    sesion_horas: ['14', 'Duración de la sesión del personal'],
    reserva_bloqueo_min: ['120', 'Minutos antes de la hora de una reserva desde los que la mesa queda bloqueada'],
    reserva_tolerancia_min: ['30', 'Minutos de espera después de la hora reservada; pasado ese tiempo la mesa se libera sola'],
    estaciones: ['Cocina', 'Estaciones de preparación separadas por coma (ej.: Cocina, Barra 1, Barra 2). Cada categoría o producto elige la suya; la primera es la de por defecto. Cada estación ve solo lo suyo y marca su parte como lista'],
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
    // ------------------------------------------------------------ estaciones de preparación
    // Configuración `estaciones` (ej.: "Cocina, Barra 1, Barra 2"). Cada producto va a la estación de su categoría
    // o a la suya propia; cada línea del pedido guarda su estación al pedirse. Cada estación marca su parte
    // (NUEVO → EN_PREPARACION → LISTO) y el pedido queda LISTO cuando todas terminaron.
    var MAX_ESTACIONES = 6, EST_ESTADOS = ['NUEVO', 'EN_PREPARACION', 'LISTO'];
    function slugEst(n) {
      var s = str(n); if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    }
    function estaciones() {
      var vistos = {}, out = [];
      csv(cfg('estaciones')).forEach(function (n) {
        var nm = cleanText(n, 20), id = slugEst(nm);
        if (id && !vistos[id] && out.length < MAX_ESTACIONES) { vistos[id] = 1; out.push({ id: id, nombre: nm }); }
      });
      return out.length ? out : [{ id: 'COCINA', nombre: 'Cocina' }];
    }
    function estacionesIdx() { var m = {}; estaciones().forEach(function (e, i) { m[e.id] = { nombre: e.nombre, orden: i }; }); return m; }
    function estacionDe(prod) {
      var ok = estacionesIdx();
      if (prod && ok[str(prod.estacion)]) return str(prod.estacion);
      var c = prod && db.get('Categorias', prod.categoria_id);
      if (c && ok[str(c.estacion)]) return str(c.estacion);
      return estaciones()[0].id;
    }
    // Estación efectiva de una línea: si su estación ya no existe en la configuración, va a la primera (nunca se pierde).
    function itemEstacion(i, ok) { ok = ok || estacionesIdx(); return ok[str(i.estacion)] ? str(i.estacion) : estaciones()[0].id; }
    function avanceDe(ped) {
      var m = null; try { m = JSON.parse(str(ped.estaciones) || 'null'); } catch (e) { m = null; }
      var ok = estacionesIdx(), activos = {};
      itemsOf(ped.pedido_id).forEach(function (i) { if (!isTrue(i.anulado)) activos[itemEstacion(i, ok)] = true; });
      // Pedidos sin avance guardado (anteriores a las estaciones o sin tocar): cada estación refleja el estado del pedido.
      var base = ped.estado === 'LISTO' || ped.estado === 'ENTREGADO' ? 'LISTO' : ped.estado === 'EN_PREPARACION' ? 'EN_PREPARACION' : 'NUEVO';
      var out = {};
      Object.keys(activos).forEach(function (id) {
        var x = m && m[id];
        out[id] = x && EST_ESTADOS.indexOf(x.estado) >= 0 ? { estado: x.estado, preparacion_en: str(x.preparacion_en), listo_en: str(x.listo_en) }
          : { estado: base, preparacion_en: base !== 'NUEVO' ? str(ped.preparacion_en) : '', listo_en: base === 'LISTO' ? str(ped.listo_en) : '' };
      });
      return out;
    }
    function estadoPorAvance(av) {
      var ks = Object.keys(av); if (!ks.length) return null;
      if (ks.every(function (k) { return av[k].estado === 'LISTO'; })) return 'LISTO';
      if (ks.some(function (k) { return av[k].estado !== 'NUEVO'; })) return 'EN_PREPARACION';
      return 'ACEPTADO';
    }
    function avanceView(ped) {
      var av = avanceDe(ped), ok = estacionesIdx();
      return Object.keys(av).sort(function (a, b) { return (ok[a] ? ok[a].orden : 99) - (ok[b] ? ok[b].orden : 99); })
        .map(function (k) { return { id: k, nombre: ok[k] ? ok[k].nombre : k, estado: av[k].estado, preparacion_en: av[k].preparacion_en, listo_en: av[k].listo_en }; });
    }
    // Una estación marca su parte del pedido: Empezar / Listo / Deshacer.
    function stationState(p, user) {
      requireRole(user, ['ADMIN', 'COCINA']);
      var ped = db.get('Pedidos', str(p.pedido_id));
      must(ped, 'PEDIDO_INEXISTENTE', 'Pedido inexistente.', 404);
      must(['ACEPTADO', 'EN_PREPARACION', 'LISTO'].indexOf(ped.estado) >= 0, 'ESTADO_INVALIDO', 'El pedido ya no está en preparación (ahora: ' + ped.estado + ').', 409);
      var est = str(p.estacion).toUpperCase(), to = str(p.estado).toUpperCase();
      must(EST_ESTADOS.indexOf(to) >= 0, 'ESTADO_INVALIDO', 'Estado inválido.');
      var av = avanceDe(ped);
      must(av[est], 'ESTACION_INVALIDA', 'Ese pedido no tiene nada para esta estación.', 409);
      if (p.desde) must(av[est].estado === str(p.desde), 'CONFLICTO', 'La comanda cambió mientras tanto (ahora: ' + av[est].estado + ').', 409);
      if (av[est].estado === to) return { pedido: orderView(ped), sin_cambios: true };
      var antes = av[est].estado, t = iso(now());
      av[est].estado = to;
      if (to === 'NUEVO') { av[est].preparacion_en = ''; av[est].listo_en = ''; }
      if (to === 'EN_PREPARACION') { if (!av[est].preparacion_en) av[est].preparacion_en = t; av[est].listo_en = ''; }
      if (to === 'LISTO') av[est].listo_en = t;
      var nuevo = estadoPorAvance(av), patch = { estaciones: JSON.stringify(av), actualizado_en: t };
      if (nuevo && nuevo !== ped.estado) {
        patch.estado = nuevo;
        if (nuevo === 'EN_PREPARACION' && !ped.preparacion_en) patch.preparacion_en = t;
        if (nuevo === 'LISTO') patch.listo_en = t;
      }
      db.update('Pedidos', ped.pedido_id, patch);
      if (patch.estado === 'LISTO') avisoWA(ped, 'LISTO');
      historial(ped.pedido_id, user, 'ESTACION', est + ':' + antes, est + ':' + to, '');
      if (patch.estado) historial(ped.pedido_id, user, 'ESTADO', ped.estado, patch.estado, 'por estaciones');
      bumpRev();
      return { pedido: orderView(db.get('Pedidos', ped.pedido_id)) };
    }
    // Cambio del pedido entero (pantalla "Todo" o pedidos de una sola estación): todas las estaciones acompañan.
    function avanceTodo(ped, to, t) {
      var av = avanceDe(ped), e = to === 'LISTO' ? 'LISTO' : to === 'EN_PREPARACION' ? 'EN_PREPARACION' : to === 'ACEPTADO' ? 'NUEVO' : null;
      if (!e) return null;
      Object.keys(av).forEach(function (k) {
        av[k].estado = e;
        if (e === 'NUEVO') { av[k].preparacion_en = ''; av[k].listo_en = ''; }
        if (e === 'EN_PREPARACION') { if (!av[k].preparacion_en) av[k].preparacion_en = t; av[k].listo_en = ''; }
        if (e === 'LISTO') { if (!av[k].listo_en) av[k].listo_en = t; }
      });
      return JSON.stringify(av);
    }
    // Pedidos para llevar del QR: los atiende la caja de para llevar (CAJA, como siempre) o el EQUIPO
    // (mozos marcados "Atiende para llevar" + la caja del salón, que también cobra).
    function llevarEquipo() { return str(cfg('para_llevar_qr_atiende')).toUpperCase() === 'EQUIPO'; }
    function alertasLlevar() {
      var l = csv(cfg('para_llevar_alerta_min')).map(int).filter(function (x) { return x > 0; });
      return l.length ? l.slice(0, 3) : [3, 5];
    }
    function cajaSalon() {
      var pt = db.all('Puntos').filter(function (x) { return x.modalidad === 'SALON' && isTrue(x.activo); })[0];
      return pt ? pt.caja_id : '';
    }
    function waLlevar() { var v = str(cfg('para_llevar_whatsapp')).toUpperCase(); return v === 'OBLIGATORIO' || v === 'OPCIONAL' ? v : ''; }
    function esLlevarQR(ped) { return ped && ped.modo === 'TAKEAWAY' && ped.origen === 'QR'; }
    function atiendeLlevar(user) {
      if (!user || user.rol !== 'MOZO') return false;
      var u = db.get('Usuarios', user.usuario_id);
      return !!u && isTrue(u.para_llevar);
    }
    // Con EQUIPO, un mozo solo puede aceptar, rechazar o entregar pedidos para llevar del QR si está marcado.
    function checkMozoLlevar(ped, user) {
      if (user && user.rol === 'MOZO' && esLlevarQR(ped) && llevarEquipo())
        must(atiendeLlevar(user), 'SIN_PERMISO', 'Los pedidos para llevar los atienden los mozos marcados "Atiende para llevar" y la caja del salón.', 403);
    }
    // ------------------------------------------------------------ reservas y mesas pagadas
    function reservaInfo(m) {
      if (!m || !m.reserva_hora) return null;
      var t = Date.parse(m.reserva_hora); if (!isFinite(t)) return null;
      var tol = int(cfg('reserva_tolerancia_min') || 30), bloq = int(cfg('reserva_bloqueo_min') || 120), n = now();
      if (n > t + tol * 60000) return null; // vencida: la mesa se libera sola
      return { nombre: str(m.reserva_nombre), hora: m.reserva_hora, personas: int(m.reserva_personas), nota: str(m.reserva_nota), por: str(m.reserva_por),
        bloquea: n >= t - bloq * 60000, vence: iso(t + tol * 60000) };
    }
    function cuentaAbiertaDeMesa(mesaId) {
      return db.all('Cuentas').filter(function (c) { return c.mesa_id === mesaId && (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO'); })[0] || null;
    }
    function limpiarReserva(m) { db.update('Mesas', m.mesa_id, { reserva_nombre: '', reserva_hora: '', reserva_personas: '', reserva_nota: '', reserva_por: '' }); }
    function mesaReservar(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var m = db.get('Mesas', str(p.mesa_id));
      must(m && isTrue(m.activa), 'MESA_INVALIDA', 'Mesa inválida.');
      must(!reservaInfo(m), 'MESA_RESERVADA', m.nombre + ' ya tiene una reserva.', 409);
      var nombre = cleanText(p.nombre, 60);
      must(nombre.length >= 2, 'NOMBRE_INVALIDO', 'Indicá a nombre de quién es la reserva.');
      var t = Date.parse(str(p.hora));
      must(isFinite(t), 'HORA_INVALIDA', 'Hora de reserva inválida.');
      must(t > now() - 5 * 60000 && t < now() + 60 * 86400000, 'HORA_INVALIDA', 'La reserva tiene que ser desde ahora y hasta 60 días adelante.');
      var personas = p.personas === undefined || p.personas === '' ? 0 : p.personas;
      must(isInt(personas) && personas >= 0 && personas <= 50, 'PERSONAS_INVALIDAS', 'Cantidad de personas inválida.');
      var bloq = int(cfg('reserva_bloqueo_min') || 120);
      if (now() >= t - bloq * 60000) must(!cuentaAbiertaDeMesa(m.mesa_id), 'MESA_OCUPADA', m.nombre + ' está ocupada ahora. Elegí otra mesa u otro horario.', 409);
      db.update('Mesas', m.mesa_id, { reserva_nombre: nombre, reserva_hora: iso(t), reserva_personas: personas, reserva_nota: cleanText(p.nota, 140), reserva_por: user.usuario_id });
      audit(user, 'RESERVA_CREADA', 'Mesas', m.mesa_id, { nombre: nombre, hora: iso(t), personas: personas });
      bumpRev();
      return { reserva: reservaInfo(db.get('Mesas', m.mesa_id)) };
    }
    function mesaReservaFin(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var m = db.get('Mesas', str(p.mesa_id));
      must(m && m.reserva_hora, 'SIN_RESERVA', 'La mesa no tiene reserva.', 409);
      var llego = str(p.motivo) === 'LLEGO';
      audit(user, llego ? 'RESERVA_LLEGO' : 'RESERVA_CANCELADA', 'Mesas', m.mesa_id, { nombre: m.reserva_nombre, hora: m.reserva_hora });
      limpiarReserva(m);
      bumpRev();
      return { ok: true };
    }
    function mesaLiberar(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var m = db.get('Mesas', str(p.mesa_id));
      must(m, 'MESA_INVALIDA', 'Mesa inválida.');
      must(!cuentaAbiertaDeMesa(m.mesa_id), 'CUENTA_ABIERTA', 'La mesa tiene una cuenta sin cobrar.', 409);
      db.update('Mesas', m.mesa_id, { pagada_en: '' });
      audit(user, 'MESA_LIBERADA', 'Mesas', m.mesa_id, {});
      bumpRev();
      return { ok: true };
    }
    // Cambiar de mesa: los clientes se mudan a una mesa libre y se llevan la cuenta entera
    // (pedidos, también los que están en cocina, personas, pedido de cuenta y tarjeta del club).
    function mesaTxt(m) { return m ? m.nombre || ('Mesa ' + m.numero) : ''; }
    function mesaCambiar(p, user) {
      requireRole(user, ['ADMIN', 'MOZO', 'CAJA']);
      var orig = db.get('Mesas', str(p.mesa_id)), dest = db.get('Mesas', str(p.destino_id));
      must(orig, 'MESA_INVALIDA', 'Mesa inválida.');
      var c = cuentaAbiertaDeMesa(orig.mesa_id);
      must(c, 'SIN_CUENTA', mesaTxt(orig) + ' no tiene una cuenta abierta para mover.', 409);
      if (user.rol === 'CAJA') must(c.caja_id === user.caja_id, 'SIN_PERMISO', 'Esa mesa la cobra otra caja.', 403);
      must(dest && isTrue(dest.activa), 'MESA_INVALIDA', 'Elegí la mesa nueva.');
      must(dest.mesa_id !== orig.mesa_id, 'MESA_INVALIDA', 'Elegí una mesa distinta.');
      must(dest.punto_id === orig.punto_id, 'MESA_OTRO_PUNTO', 'Solo se puede mover a una mesa del mismo salón.', 409);
      must(!cuentaAbiertaDeMesa(dest.mesa_id), 'MESA_OCUPADA', mesaTxt(dest) + ' está ocupada. Elegí una mesa libre.', 409);
      must(!dest.pagada_en, 'MESA_OCUPADA', mesaTxt(dest) + ' está pagada pero aún ocupada. Liberala primero o elegí otra.', 409);
      var r = reservaInfo(dest);
      must(!(r && r.bloquea), 'MESA_RESERVADA', mesaTxt(dest) + ' está reservada para ' + (r ? r.nombre : '') + '. Elegí otra mesa.', 409);
      var t = iso(now());
      db.update('Cuentas', c.cuenta_id, { mesa_id: dest.mesa_id, mesa_antes: mesaTxt(orig), trasladada_en: t, trasladada_por: user.usuario_id });
      var n = 0;
      db.all('Pedidos').forEach(function (x) { if (x.cuenta_id === c.cuenta_id) { db.update('Pedidos', x.pedido_id, { mesa_id: dest.mesa_id, actualizado_en: t }); n++; } });
      audit(user, 'MESA_CAMBIADA', 'Cuentas', c.cuenta_id, { de: orig.mesa_id, a: dest.mesa_id, pedidos: n });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)), de: mesaTxt(orig), a: mesaTxt(dest) };
    }
    function cancelClose(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c && c.estado === 'CIERRE_SOLICITADO', 'CUENTA_INVALIDA', 'La cuenta no tiene pedido de cobro.', 409);
      db.update('Cuentas', c.cuenta_id, { estado: 'ABIERTA', cierre_solicitado_en: '', cierre_pedido: '' });
      audit(user, 'CIERRE_CANCELADO', 'Cuentas', c.cuenta_id, { mesa: c.mesa_id });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)) };
    }
    // Una reserva activa bloquea pedidos en la mesa (mozo, caja y QR), salvo que ya haya una cuenta abierta (los que llegaron antes).
    function checkReserva(mesa) {
      var r = reservaInfo(mesa);
      if (r && r.bloquea && !cuentaAbiertaDeMesa(mesa.mesa_id)) fail('MESA_RESERVADA', mesa.nombre + ' está reservada para ' + r.nombre + ' (' + horaLocal(r.hora) + '). Tocá "Llegó la reserva" para habilitarla.', 409);
    }
    function horaLocal(isoStr) {
      var d = new Date(Date.parse(isoStr) - 3 * 3600000); // America/Asuncion (UTC−3)
      return pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2);
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

    // ------------------------------------------------------------ Atención Integrada · avisos por WhatsApp (Upgrade ATENCION)
    // El núcleo solo deja el aviso en la cola AvisosWA (dentro de la misma transacción del pedido). El servidor
    // (firebase/functions → core/atencion-wa.js) lo envía por Whaticket con el token del local (Secret Manager) y
    // devuelve el resultado con `sistema.avisoResultado`. Un aviso por pedido y tipo: nunca se repite.
    var WA_DEFAULTS = {
      wa_avisos: ['NO', 'Avisos automáticos por WhatsApp al cliente de para llevar. NO, LISTO (solo cuando el pedido está listo) o AMBOS (también al recibirlo)'],
      wa_aviso_recibido: ['¡Hola {nombre}! Recibimos tu pedido {numero} en {local}. Te avisamos por acá cuando esté listo.', 'Mensaje al recibir el pedido. Se puede usar {nombre}, {numero} y {local}'],
      wa_aviso_listo: ['¡{nombre}, tu pedido {numero} ya está listo! Podés pasar a retirarlo en {local}. ¡Gracias!', 'Mensaje cuando el pedido está listo. Se puede usar {nombre}, {numero} y {local}'],
      wa_conexion_id: ['', 'Conexión de WhatsApp de Whaticket por la que salen los avisos (la elige Ser o Límites al probar la conexión)'],
      wa_conexion_nombre: ['', 'Nombre de la conexión elegida (solo para mostrar)']
    };
    var WA_MAX_INTENTOS = 3;
    function waCfg(k) { var r = db.get('Config', k); return r ? str(r.valor) : (WA_DEFAULTS[k] ? WA_DEFAULTS[k][0] : ''); }
    function waModo() { var m = waCfg('wa_avisos').toUpperCase(); return m === 'AMBOS' || m === 'LISTO' ? m : 'NO'; }
    function avisoWA(ped, tipo) {
      if (!ped || !str(ped.whatsapp) || !tieneModulo('ATENCION')) return;
      var modo = waModo();
      if (modo === 'NO' || (tipo === 'RECIBIDO' && modo !== 'AMBOS')) return;
      if (!waCfg('wa_conexion_id')) return;
      var id = ped.pedido_id + '_' + tipo;
      if (db.get('AvisosWA', id)) return;
      var nombre = str(ped.alias) || 'hola', local = cfg('nombre_negocio');
      var texto = cleanText(waCfg(tipo === 'LISTO' ? 'wa_aviso_listo' : 'wa_aviso_recibido'), 600)
        .replace(/\{nombre\}/g, nombre).replace(/\{numero\}/g, str(ped.numero)).replace(/\{local\}/g, local);
      db.insert('AvisosWA', { aviso_id: id, pedido_id: ped.pedido_id, tipo: tipo, numero: str(ped.whatsapp), texto: texto, estado: 'PENDIENTE', intentos: 0, creado_en: iso(now()), enviado_en: '', error: '' });
    }
    // Llamadas internas del servidor (no del navegador): firmadas con el mismo secreto de las sesiones y con hora.
    function requireSistema(p) {
      var ts = int(p.ts);
      must(Math.abs(now() - ts) < 5 * 60000, 'NO_SESION', 'Llamada interna vencida.', 401);
      must(str(p.firma) && env.hmac(env.secret, 'sistema|' + ts) === str(p.firma), 'NO_SESION', 'Llamada interna inválida.', 401);
    }
    function sistemaAvisosWA(p) {
      requireSistema(p);
      if (!tieneModulo('ATENCION')) return { conexion_id: '', avisos: [] };
      var avisos = db.all('AvisosWA').filter(function (a) { return a.estado === 'PENDIENTE' && int(a.intentos) < WA_MAX_INTENTOS; })
        .sort(function (a, b) { return str(a.creado_en) < str(b.creado_en) ? -1 : 1; }).slice(0, 20)
        .map(function (a) { return { aviso_id: a.aviso_id, numero: a.numero, texto: a.texto }; });
      return { conexion_id: waCfg('wa_conexion_id'), avisos: avisos };
    }
    function sistemaAvisoResultado(p) {
      requireSistema(p);
      var n = 0;
      (Array.isArray(p.resultados) ? p.resultados : []).slice(0, 50).forEach(function (r) {
        var a = db.get('AvisosWA', str(r && r.aviso_id));
        if (!a || a.estado !== 'PENDIENTE') return;
        if (r.ok === true) db.update('AvisosWA', a.aviso_id, { estado: 'ENVIADO', enviado_en: iso(now()), error: '' });
        else {
          var it = int(a.intentos) + 1;
          db.update('AvisosWA', a.aviso_id, { intentos: it, estado: it >= WA_MAX_INTENTOS ? 'ERROR' : 'PENDIENTE', error: cleanText(r.error, 200) });
        }
        n++;
      });
      // La cola no crece: lo enviado o fallido hace más de 7 días se borra.
      var limite = iso(now() - 7 * 86400000);
      db.remove('AvisosWA', function (a) { return a.estado !== 'PENDIENTE' && str(a.creado_en) < limite; });
      if (n) bumpRev();
      return { actualizados: n };
    }
    function requireAtencion() { must(tieneModulo('ATENCION'), 'MODULO_NO_ACTIVO', 'El Upgrade Atención Integrada no está contratado en este local.', 403); }
    function waEstado(p, user) {
      requireRole(user, ['ADMIN']);
      requireAtencion();
      var cfgOut = {}; Object.keys(WA_DEFAULTS).forEach(function (k) { cfgOut[k] = waCfg(k); });
      cfgOut.wa_avisos = waModo();
      var l = db.all('AvisosWA').slice().sort(function (a, b) { return str(a.creado_en) < str(b.creado_en) ? 1 : -1; });
      var pend = l.filter(function (a) { return a.estado === 'PENDIENTE'; }).length, errs = l.filter(function (a) { return a.estado === 'ERROR'; }).length;
      return {
        config: cfgOut, pendientes: pend, con_error: errs, plataforma: !!user.plataforma,
        whatsapp_llevar: cfg('para_llevar_whatsapp'),
        avisos: l.slice(0, 40).map(function (a) {
          var ped = db.get('Pedidos', a.pedido_id);
          return { aviso_id: a.aviso_id, tipo: a.tipo, numero: a.numero, pedido: ped ? ped.numero : '', estado: a.estado, intentos: int(a.intentos), creado_en: a.creado_en, enviado_en: a.enviado_en, error: a.error };
        })
      };
    }
    function waConfig(p, user) {
      requireRole(user, ['ADMIN']);
      requireAtencion();
      var c = p.config || {}, cambios = {};
      Object.keys(c).forEach(function (k) {
        must(WA_DEFAULTS[k], 'CLAVE_INVALIDA', 'Configuración no editable: ' + k);
        var v = cleanText(c[k], k.indexOf('wa_aviso_') === 0 ? 600 : 120);
        if (k === 'wa_avisos') { v = v.toUpperCase(); must(['NO', 'LISTO', 'AMBOS'].indexOf(v) >= 0, 'VALOR_INVALIDO', 'Avisos: NO, LISTO o AMBOS.'); }
        if (k.indexOf('wa_aviso_') === 0) must(v.length >= 10, 'VALOR_INVALIDO', 'El mensaje es muy corto.');
        if (k === 'wa_conexion_id' || k === 'wa_conexion_nombre') must(user.plataforma, 'SIN_PERMISO', 'La conexión la elige Ser o Límites.', 403);
        if (k === 'wa_conexion_id') must(/^[A-Za-z0-9_-]{0,64}$/.test(v), 'VALOR_INVALIDO', 'Conexión inválida.');
        cambios[k] = v;
      });
      if (cambios.wa_avisos && cambios.wa_avisos !== 'NO') must(cambios.wa_conexion_id || waCfg('wa_conexion_id'), 'SIN_CONEXION', 'Primero Ser o Límites tiene que probar la conexión con Whaticket y elegir el número.', 409);
      Object.keys(cambios).forEach(function (k) {
        if (db.get('Config', k)) db.update('Config', k, { valor: cambios[k] }); else db.insert('Config', { clave: k, valor: cambios[k], descripcion: WA_DEFAULTS[k][1] });
      });
      audit(user, 'WA_CONFIG', 'Config', 'wa', cambios);
      bumpRev();
      return waEstado({}, user);
    }
    // Lo usa el servidor antes de «Probar conexión» (wa.probar): solo el usuario de Ser o Límites y con el Upgrade.
    function waPuedeProbar(p, user) {
      requireRole(user, ['ADMIN']);
      requireAtencion();
      must(user.plataforma, 'SIN_PERMISO', 'La conexión con Whaticket la configura Ser o Límites.', 403);
      return { ok: true };
    }

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
      return u.rol === 'PLATAFORMA' ? Object.assign({}, u, { rol: 'ADMIN', plataforma: true }) : u;
    }
    function usuarioPublico(u) {
      var pl = u.rol === 'PLATAFORMA' || u.plataforma === true;
      var o = { usuario_id: u.usuario_id, nombre: u.nombre, rol: pl ? 'ADMIN' : u.rol, caja_id: u.caja_id };
      if (pl) o.plataforma = true;
      return o;
    }
    function requirePlataforma(user) { must(user && user.plataforma === true, 'SIN_PERMISO', 'Solo Ser o Límites puede cambiar el plan del local.', 403); }
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
      must(a && isTrue(a.activo) && (a.rol === 'ADMIN' || a.rol === 'PLATAFORMA'), 'AUTORIZACION_INVALIDA', 'Autorización inválida.', 403);
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
    // Platos por día (menú semanal): 'dias' = días ISO separados por coma (1 = lunes … 7 = domingo). Vacío = todos los días.
    var DIAS_TXT = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    function diaHoy() { var d = new Date(env.dateKey(now()) + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
    function diasDe(p) { return csv(p && p.dias).map(int).filter(function (x) { return x >= 1 && x <= 7; }); }
    function sirveHoy(p) { var l = diasDe(p); return !l.length || l.indexOf(diaHoy()) >= 0; }
    function menuFor(puntoId, includeHidden) {
      var cats = db.all('Categorias').filter(function (c) { return includeHidden || isTrue(c.activa); })
        .sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var grupos = idx(db.all('Grupos'), 'grupo_id');
      var opciones = db.all('Opciones').filter(function (o) { return includeHidden || isTrue(o.activo); })
        .sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var prods = db.all('Productos').filter(function (p) {
        return includeHidden || (isTrue(p.activo) && sirveHoy(p) && (!puntoId || csv(p.puntos).indexOf(puntoId) >= 0));
      }).sort(function (a, b) { return int(a.orden) - int(b.orden); });
      var usedGroups = {};
      var outProds = prods.map(function (p) {
        var gs = csv(p.grupos).filter(function (g) { return grupos[g] && (includeHidden || isTrue(grupos[g].activo)); });
        gs.forEach(function (g) { usedGroups[g] = true; });
        var o = {
          id: p.producto_id, categoria: p.categoria_id, nombre: p.nombre, descripcion: str(p.descripcion),
          precio: int(p.precio_gs), disponible: isTrue(p.disponible), grupos: gs
        };
        if (str(p.modelo_3d) && (includeHidden || tieneModulo('MENU3D'))) o.modelo_3d = str(p.modelo_3d); // módulo Gold · Menú 3D
        if (str(p.imagen) && (includeHidden || tieneModulo('FOTOS'))) o.imagen = str(p.imagen); // foto del plato (Gold y Premium)
        if (diasDe(p).length && !includeHidden) o.dia = DIAS_TXT[diaHoy()];
        if (str(p.armador) && (includeHidden || tieneModulo('ARMADOR'))) o.armador = str(p.armador); // Upgrade Armá tu pedido
        if (includeHidden) { o.estacion = str(p.estacion); o.estacion_efectiva = estacionDe(p); o.dias = diasDe(p).join(','); o.activo = isTrue(p.activo); o.puntos = str(p.puntos); o.validacion = str(p.validacion); o.fuente = str(p.fuente); o.nota = str(p.nota); o.orden = int(p.orden); }
        return o;
      });
      var catIds = {};
      outProds.forEach(function (p) { catIds[p.categoria] = true; });
      return {
        categorias: cats.filter(function (c) { return includeHidden || catIds[c.categoria_id]; }).map(function (c) {
          var o = { id: c.categoria_id, nombre: c.nombre };
          if (includeHidden) { o.activa = isTrue(c.activa); o.orden = int(c.orden); o.nota = str(c.nota); o.estacion = str(c.estacion); }
          return o;
        }),
        productos: outProds,
        grupos: Object.keys(grupos).filter(function (g) { return includeHidden || usedGroups[g]; }).map(function (g) {
          var G = grupos[g];
          return {
            id: g, nombre: G.nombre, min: int(G.min), max: int(G.max), activo: isTrue(G.activo), regla: str(G.regla),
            tipo: str(G.tipo), repetir: repetirDe(G),
            opciones: opciones.filter(function (o) { return o.grupo_id === g; }).map(function (o) {
              var r = { id: o.opcion_id, nombre: o.nombre, delta: int(o.delta_gs) };
              if (str(o.dibujo)) r.dibujo = str(o.dibujo);
              if (includeHidden) r.activo = isTrue(o.activo);
              return r;
            })
          };
        })
      };
    }

    // Veces que se puede elegir una misma opción de un grupo (1 = sin repetir; ej. 2 = doble carne).
    function repetirDe(G) { return Math.max(1, Math.min(MAX_REPETIR, int(G && G.repetir) || 1)); }
    // Texto de una opción en la comanda: "Pan: Brioche", "+ Carne x2", "Sin cebolla".
    function textoOpcion(G, o, veces) {
      var on = o.nombre;
      if (str(G.tipo) === 'QUITAR') return 'Sin ' + on.charAt(0).toLowerCase() + on.slice(1);
      // Agregados que se pueden repetir: "+ Carne x2" (se distingue de lo que el plato ya trae).
      var t = repetirDe(G) > 1 ? '+ ' + on : on.toLowerCase().indexOf(String(G.nombre).toLowerCase()) === 0 ? on : G.nombre + ': ' + on;
      return veces > 1 ? t + ' x' + veces : t;
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
        must(sirveHoy(p), 'PRODUCTO_OTRO_DIA', p.nombre + ' se sirve solo los ' + diasDe(p).map(function (x) { return DIAS_TXT[x].toLowerCase(); }).join(', ') + '.');
        var qty = it.cantidad;
        must(isInt(qty) && qty >= 1 && qty <= maxQty, 'CANTIDAD_INVALIDA', 'Cantidad inválida para ' + p.nombre + '.');
        var sel = Array.isArray(it.opciones) ? it.opciones.map(String) : [];
        var pgs = csv(p.grupos).filter(function (g) { return grupos[g] && isTrue(grupos[g].activo); });
        var precio = int(p.precio_gs);
        var mayor = 0; // grupos con regla MAYOR (ej. pizza mitad y mitad): se cobra solo la diferencia más alta entre ellos
        var desc = [];
        var countBy = {}, vecesOp = {};
        sel.forEach(function (oid) {
          var o = opciones[oid];
          must(o && isTrue(o.activo) && pgs.indexOf(o.grupo_id) >= 0, 'OPCION_INVALIDA', 'Opción inválida para ' + p.nombre + '.');
          vecesOp[oid] = (vecesOp[oid] || 0) + 1;
          // Una opción se repite solo si su grupo lo permite (ej. doble carne): "repetir" = veces máximas por opción.
          must(vecesOp[oid] <= repetirDe(grupos[o.grupo_id]), 'OPCION_INVALIDA', 'Opción repetida en ' + p.nombre + '.');
          countBy[o.grupo_id] = (countBy[o.grupo_id] || 0) + 1;
        });
        pgs.forEach(function (g) {
          var G = grupos[g], n = countBy[g] || 0;
          must(n >= int(G.min), 'OPCION_REQUERIDA', 'Elegí "' + G.nombre + '" para ' + p.nombre + '.');
          must(n <= int(G.max), 'OPCION_INVALIDA', 'Demasiadas opciones en "' + G.nombre + '" para ' + p.nombre + '.');
          var vistos = {};
          sel.filter(function (oid) { return opciones[oid].grupo_id === g; }).forEach(function (oid) {
            if (str(G.regla) === 'MAYOR') mayor = Math.max(mayor, int(opciones[oid].delta_gs));
            else precio += int(opciones[oid].delta_gs);
            if (vistos[oid]) return;
            vistos[oid] = true;
            desc.push(textoOpcion(G, opciones[oid], vecesOp[oid]));
          });
        });
        precio += mayor;
        return {
          producto_id: p.producto_id, nombre: p.nombre, precio_unit_gs: precio, cantidad: qty,
          opciones: desc.join(' · '), opciones_ids: sel.join(','), observacion: cleanText(it.observacion, 140),
          total_gs: precio * qty, estacion: estacionDe(p)
        };
      });
    }

    // ---------------------------------------------------------------- pedidos
    function openCuentaFor(puntoId, mesaId, alias, user, cajaId) {
      if (mesaId) {
        var abiertas = db.all('Cuentas').filter(function (c) {
          return c.mesa_id === mesaId && (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO');
        });
        if (abiertas.length) {
          var c0 = abiertas[0];
          if (c0.estado === 'CIERRE_SOLICITADO') db.update('Cuentas', c0.cuenta_id, { estado: 'ABIERTA', cierre_solicitado_en: '', cierre_pedido: '' });
          return c0;
        }
      }
      var punto = db.get('Puntos', puntoId);
      var c = {
        cuenta_id: newId('CTA'), punto_id: puntoId, caja_id: cajaId || punto.caja_id, mesa_id: mesaId || '', alias: alias || '',
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
        checkReserva(mesa);
        puntoId = mesa.punto_id; mesaId = mesa.mesa_id; modo = 'SALON';
        if (mesa.pagada_en) db.update('Mesas', mesa.mesa_id, { pagada_en: '' });
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
      var reqPersonas = (Array.isArray(p.items) ? p.items : []).map(function (it) { return str(it && it.persona); });

      // Para llevar desde el QR con EQUIPO: lo atiende y lo cobra la caja del salón.
      var cajaDestino = punto.caja_id;
      if (origen === 'QR' && modo === 'TAKEAWAY' && llevarEquipo() && cajaSalon()) cajaDestino = cajaSalon();
      var cuenta;
      if (p.cuenta_id) {
        cuenta = db.get('Cuentas', str(p.cuenta_id));
        must(cuenta && cuenta.punto_id === puntoId && (cuenta.estado === 'ABIERTA' || cuenta.estado === 'CIERRE_SOLICITADO'), 'CUENTA_INVALIDA', 'La cuenta ya no está abierta.');
        must(!mesaId || cuenta.mesa_id === mesaId, 'CUENTA_INVALIDA', 'La cuenta no corresponde a la mesa.');
        if (cuenta.estado === 'CIERRE_SOLICITADO') db.update('Cuentas', cuenta.cuenta_id, { estado: 'ABIERTA', cierre_solicitado_en: '', cierre_pedido: '' });
      } else {
        cuenta = openCuentaFor(puntoId, mesaId, alias, user, cajaDestino);
      }

      var waPed = p.whatsapp ? normCel(p.whatsapp) : ''; if (!celValido(waPed)) waPed = '';
      var fecha = env.dateKey(now());
      var n = nextCounter('num:' + puntoId + ':' + fecha);
      var estado = 'ACEPTADO';
      if (origen === 'QR' && isTrue(cfg('qr_requiere_aceptacion'))) estado = 'PENDIENTE';
      var directa = !!p.venta_directa && origen !== 'QR';
      if (directa) estado = 'ENTREGADO';
      var t = iso(now());
      var ped = {
        pedido_id: newId('PED'), request_id: reqId, numero: punto.prefijo + '-' + pad(n, 3), fecha: fecha,
        cuenta_id: cuenta.cuenta_id, punto_id: puntoId, caja_id: cuenta.caja_id || cajaDestino, mesa_id: mesaId, origen: origen,
        modo: modo, estado: estado, alias: alias, observacion: cleanText(p.observacion, 200), total_gs: total,
        creado_por: user ? user.usuario_id : 'PUBLICO', creado_en: t, actualizado_en: t,
        aceptado_en: estado !== 'PENDIENTE' ? t : '', preparacion_en: '', listo_en: '', entregado_en: directa ? t : '',
        cancelado_en: '', motivo_cancelacion: '', status_token: env.token(24), whatsapp: waPed
      };
      db.insert('Pedidos', ped);
      if (waPed && !mesaId) db.update('Cuentas', cuenta.cuenta_id, { whatsapp: waPed, acepta_promos: p.acepta_promos === true ? 'SI' : 'NO' });
      // Sub-cuentas: solo si la cuenta ya tiene personas (las agrega el mozo). Por QR, el cliente puede indicar su nombre.
      var psC = personasDe(cuenta), idsC = {}; psC.forEach(function (x) { idsC[x.id] = true; });
      var personaQR = '';
      if (psC.length && origen === 'QR' && cleanText(p.persona_nombre, 30)) personaQR = agregarPersona(cuenta, p.persona_nombre, user).id;
      lines.forEach(function (l, ix) {
        l.persona = personaQR || (idsC[reqPersonas[ix]] ? reqPersonas[ix] : '');
        l.item_id = newId('IT'); l.pedido_id = ped.pedido_id; l.anulado = 'NO'; l.anulado_por = ''; l.anulado_motivo = '';
        db.insert('PedidoItems', l);
      });
      if (estado !== 'PENDIENTE') descontarPedido(ped, user);
      if (estado === 'ACEPTADO') avisoWA(ped, 'RECIBIDO');
      historial(ped.pedido_id, user, 'CREADO', '', estado, origen + (directa ? ' (venta directa)' : ''));
      bumpRev();
      return { pedido: orderView(ped), duplicado: false };
    }

    function itemsOf(pedidoId) {
      return db.all('PedidoItems').filter(function (i) { return i.pedido_id === pedidoId; });
    }
    function orderView(p) {
      var okEst = estacionesIdx();
      return {
        pedido_id: p.pedido_id, numero: p.numero, fecha: p.fecha, cuenta_id: p.cuenta_id, punto_id: p.punto_id, caja_id: p.caja_id,
        mesa_id: p.mesa_id, mesa: p.mesa_id ? mesaNombre(p.mesa_id) : '', mesa_antes: mesaAntes(p), origen: p.origen, modo: p.modo, estado: p.estado,
        alias: p.alias, observacion: p.observacion, total_gs: int(p.total_gs), creado_por: p.creado_por, creado_en: p.creado_en,
        aceptado_en: p.aceptado_en, preparacion_en: p.preparacion_en, listo_en: p.listo_en, entregado_en: p.entregado_en,
        cancelado_en: p.cancelado_en, motivo_cancelacion: p.motivo_cancelacion, whatsapp: str(p.whatsapp),
        items: itemsOf(p.pedido_id).map(function (i) {
          var pn = i.persona ? (personasDe(db.get('Cuentas', p.cuenta_id)).filter(function (x) { return x.id === i.persona; })[0] || {}).nombre || '' : '';
          return {
            persona: str(i.persona), persona_nombre: pn,
            item_id: i.item_id, producto_id: i.producto_id, nombre: i.nombre, precio_unit_gs: int(i.precio_unit_gs),
            cantidad: int(i.cantidad), opciones: i.opciones, observacion: i.observacion, total_gs: int(i.total_gs),
            anulado: isTrue(i.anulado), anulado_motivo: i.anulado_motivo, estacion: itemEstacion(i, okEst)
          };
        }),
        estaciones: avanceView(p)
      };
    }
    // Si la cuenta se cambió de mesa, el ticket de los pedidos anteriores lo dice ("antes Mesa 3").
    function mesaAntes(p) {
      if (!p.mesa_id || !p.cuenta_id) return '';
      var c = db.get('Cuentas', p.cuenta_id);
      return c && c.mesa_antes && c.trasladada_en && str(p.creado_en) <= str(c.trasladada_en) ? str(c.mesa_antes) : '';
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
    // ------------------------------------------------------------ sub-cuentas por persona
    // Una cuenta de mesa puede dividirse en personas (solo si el mozo las agrega). Cada ítem lleva su persona
    // ('' = compartido). Los cobros parciales guardan en `detalle` cuánto pagó cada persona y cuánto de lo compartido.
    function personasDe(c) { try { var a = JSON.parse(str(c && c.personas) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function itemsCuenta(cuentaId) {
      var peds = {}; db.all('Pedidos').forEach(function (p) { if (p.cuenta_id === cuentaId && p.estado !== 'CANCELADO') peds[p.pedido_id] = true; });
      return db.all('PedidoItems').filter(function (i) { return peds[i.pedido_id] && !isTrue(i.anulado); });
    }
    function cobrosValidos(cuentaId) { return db.all('Cobros').filter(function (x) { return x.cuenta_id === cuentaId && x.estado === 'VALIDO'; }); }
    function desglose(c) {
      var ps = personasDe(c), ids = {}; ps.forEach(function (x) { ids[x.id] = true; });
      var cons = { '': 0 }; ps.forEach(function (x) { cons[x.id] = 0; });
      itemsCuenta(c.cuenta_id).forEach(function (i) { var k = ids[str(i.persona)] ? str(i.persona) : ''; cons[k] += int(i.total_gs); });
      var pag = { '': 0 }, alguna = {}; ps.forEach(function (x) { pag[x.id] = 0; });
      var pagadoTotal = 0;
      cobrosValidos(c.cuenta_id).forEach(function (x) {
        pagadoTotal += int(x.subtotal_gs);
        var d = null; try { d = x.detalle ? JSON.parse(x.detalle) : null; } catch (e) { d = null; }
        if (!d) { Object.keys(cons).forEach(function (k) { pag[k] = cons[k]; alguna[k] = true; }); return; } // cobro de toda la cuenta
        Object.keys(d.personas || {}).forEach(function (k) { pag[k] = (pag[k] || 0) + int(d.personas[k]); alguna[k] = true; });
        pag[''] += int(d.compartido);
      });
      return {
        personas: ps.map(function (x) { return { id: x.id, nombre: x.nombre, consumo_gs: cons[x.id] || 0, pagado_gs: pag[x.id] || 0, pendiente_gs: Math.max(0, (cons[x.id] || 0) - (pag[x.id] || 0)), pago: !!alguna[x.id] }; }),
        compartido: { consumo_gs: cons[''], pagado_gs: pag[''], pendiente_gs: Math.max(0, cons[''] - pag['']) },
        pagado_gs: pagadoTotal
      };
    }
    // Cuánto corresponde cobrar: todo lo pendiente, o las personas elegidas + su parte de lo compartido.
    // modo de lo compartido: IGUALES (partes iguales entre quienes faltan pagar) | TODO | NADA.
    function calcularParte(c, sel, modo) {
      var d = desglose(c), pend = { personas: {}, compartido: 0 }, monto = 0;
      if (!sel || !sel.length) {
        d.personas.forEach(function (x) { if (x.pendiente_gs) { pend.personas[x.id] = x.pendiente_gs; monto += x.pendiente_gs; } });
        pend.compartido = d.compartido.pendiente_gs; monto += pend.compartido;
        return { monto: monto, detalle: pend, total: !0 };
      }
      var porId = {}; d.personas.forEach(function (x) { porId[x.id] = x; });
      sel.forEach(function (id) { must(porId[id], 'PERSONA_INVALIDA', 'Persona inválida.'); var v = porId[id].pendiente_gs; if (v) { pend.personas[id] = v; monto += v; } });
      var faltan = d.personas.filter(function (x) { return x.pendiente_gs > 0 || !x.pago; }).map(function (x) { return x.id; });
      sel.forEach(function (id) { if (faltan.indexOf(id) < 0) faltan.push(id); });
      var comp = d.compartido.pendiente_gs, parte = 0;
      if (modo === 'TODO') parte = comp;
      else if (modo === 'NADA') parte = 0;
      else parte = sel.length >= faltan.length ? comp : Math.floor(comp * sel.length / faltan.length / 100) * 100; // redondeo a Gs. 100; el último paga el resto
      pend.compartido = parte; monto += parte;
      return { monto: monto, detalle: pend, total: false };
    }
    function agregarPersona(c, nombre, user) {
      var ps = personasDe(c);
      nombre = cleanText(nombre, 30);
      must(nombre.length >= 1, 'NOMBRE_INVALIDO', 'Indicá un nombre.');
      var ex = ps.filter(function (x) { return x.nombre.toLowerCase() === nombre.toLowerCase(); })[0];
      if (ex) return ex;
      must(ps.length < 30, 'DEMASIADAS_PERSONAS', 'Máximo 30 personas por mesa.');
      var n = 1; ps.forEach(function (x) { n = Math.max(n, int(String(x.id).slice(1)) + 1); });
      var nueva = { id: 'P' + n, nombre: nombre };
      ps.push(nueva);
      db.update('Cuentas', c.cuenta_id, { personas: JSON.stringify(ps) });
      c.personas = JSON.stringify(ps);
      return nueva;
    }
    function cuentaPersonas(p, user) {
      requireRole(user, ['ADMIN', 'MOZO', 'CAJA']);
      var c;
      if (p.cuenta_id) c = db.get('Cuentas', str(p.cuenta_id));
      else {
        var mesa = db.get('Mesas', str(p.mesa_id));
        must(mesa && isTrue(mesa.activa), 'MESA_INVALIDA', 'Mesa inválida.');
        checkReserva(mesa);
        if (mesa.pagada_en) db.update('Mesas', mesa.mesa_id, { pagada_en: '' });
        c = openCuentaFor(mesa.punto_id, mesa.mesa_id, '', user);
      }
      must(c && (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO'), 'CUENTA_INVALIDA', 'La cuenta no está abierta.', 409);
      if (user.rol === 'CAJA') requireCaja(user, c.caja_id);
      var r = null;
      if (p.agregar !== undefined) r = agregarPersona(c, p.agregar, user);
      if (p.renombrar) {
        var ps = personasDe(c), x = ps.filter(function (y) { return y.id === str(p.renombrar.id); })[0];
        must(x, 'PERSONA_INVALIDA', 'Persona inválida.');
        var nn = cleanText(p.renombrar.nombre, 30); must(nn.length >= 1, 'NOMBRE_INVALIDO', 'Indicá un nombre.');
        x.nombre = nn; db.update('Cuentas', c.cuenta_id, { personas: JSON.stringify(ps) });
      }
      audit(user, 'PERSONAS', 'Cuentas', c.cuenta_id, { agregar: p.agregar || '', renombrar: p.renombrar || '' });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)), persona: r };
    }
    // Un ítem de una persona (o compartido) que ya pagó no se puede anular sin revertir antes el cobro.
    function checkItemNoPagado(cuenta, persona) {
      if (!cuenta || cuenta.pago_estado !== 'PARCIAL') return;
      var d = desglose(cuenta), k = str(persona);
      var ya = k ? d.personas.filter(function (x) { return x.id === k && x.pagado_gs > 0; }).length : d.compartido.pagado_gs > 0;
      must(!ya, 'CUENTA_COBRADA', 'Esa parte de la cuenta ya fue cobrada: primero el encargado debe revertir ese cobro.', 409);
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
      checkMozoLlevar(ped, user);
      var patch = { estado: to, actualizado_en: iso(now()) };
      if (ESTADO_TS[to]) patch[ESTADO_TS[to]] = iso(now());
      var eraPendiente = ped.estado === 'PENDIENTE', estadoAntes = ped.estado;
      if (!eraPendiente) { var avT = avanceTodo(ped, to, iso(now())); if (avT) patch.estaciones = avT; }
      db.update('Pedidos', ped.pedido_id, patch);
      if (eraPendiente) descontarPedido(ped, user); // pedido del QR aceptado: recién ahora sale del stock
      if (eraPendiente) avisoWA(ped, 'RECIBIDO');
      if (to === 'LISTO') avisoWA(ped, 'LISTO');
      historial(ped.pedido_id, user, 'ESTADO', estadoAntes, to, '');
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
      itemsOf(ped.pedido_id).forEach(function (i) { if (!isTrue(i.anulado)) checkItemNoPagado(cuenta, i.persona); });
      var autorizo = '';
      // Mozo/caja pueden rechazar un pedido PENDIENTE; luego hace falta encargado.
      var mozoPuede = user.rol === 'MOZO' && (!(esLlevarQR(ped) && llevarEquipo()) || atiendeLlevar(user));
      if (ped.estado === 'PENDIENTE' && (mozoPuede || (user.rol === 'CAJA' && user.caja_id === ped.caja_id))) {
        autorizo = user.usuario_id;
      } else {
        autorizo = supervisor(user, p.autorizacion).usuario_id;
      }
      var estadoPrevio = ped.estado;
      if (stockVuelve(estadoPrevio)) itemsOf(ped.pedido_id).forEach(function (i) { devolverItem(i, ped, user, 'Cancelado: ' + motivo); });
      db.update('Pedidos', ped.pedido_id, { estado: 'CANCELADO', cancelado_en: iso(now()), motivo_cancelacion: motivo, actualizado_en: iso(now()) });
      historial(ped.pedido_id, user, 'CANCELADO', estadoPrevio, 'CANCELADO', motivo + ' | autorizó: ' + autorizo);
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
      checkItemNoPagado(cuenta, it.persona);
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo.');
      var aut = supervisor(user, p.autorizacion);
      if (stockVuelve(ped.estado)) devolverItem(it, ped, user, 'Anulado: ' + motivo);
      db.update('PedidoItems', it.item_id, { anulado: 'SI', anulado_por: aut.usuario_id, anulado_motivo: motivo });
      var tot = recomputeOrderTotal(ped.pedido_id);
      historial(ped.pedido_id, user, 'ITEM_ANULADO', '', '', it.nombre + ' x' + it.cantidad + ' | ' + motivo + ' | autorizó: ' + aut.usuario_id);
      audit(user, 'ITEM_ANULADO', 'PedidoItems', it.item_id, { pedido: ped.numero, motivo: motivo, autorizo: aut.usuario_id, monto: it.total_gs });
      if (tot === 0) {
        db.update('Pedidos', ped.pedido_id, { estado: 'CANCELADO', cancelado_en: iso(now()), motivo_cancelacion: 'Todos los ítems anulados' });
        maybeAnularCuenta(ped.cuenta_id, user);
      } else if (['ACEPTADO', 'EN_PREPARACION', 'LISTO'].indexOf(ped.estado) >= 0) {
        // Si la línea anulada era lo único que faltaba en una estación, el pedido puede quedar listo.
        var ped2 = db.get('Pedidos', ped.pedido_id), est2 = estadoPorAvance(avanceDe(ped2));
        if (est2 && est2 !== ped2.estado) {
          var pt2 = { estado: est2 }; if (est2 === 'LISTO') pt2.listo_en = iso(now());
          db.update('Pedidos', ped.pedido_id, pt2);
          if (est2 === 'LISTO') avisoWA(ped2, 'LISTO');
          historial(ped.pedido_id, user, 'ESTADO', ped2.estado, est2, 'por estaciones (ítem anulado)');
        }
      }
      bumpRev();
      return { pedido: orderView(db.get('Pedidos', ped.pedido_id)) };
    }

    // Comprobante pedido por el cliente: TICKET (sin factura) o FACTURA con RUC/CI y razón social.
    function comprobanteDe(x) {
      x = x || {};
      var tipo = str(x.tipo || x.comprobante).toUpperCase();
      if (!tipo) return null;
      must(tipo === 'TICKET' || tipo === 'FACTURA', 'COMPROBANTE_INVALIDO', 'Elegí ticket o factura.');
      if (tipo === 'TICKET') return { comprobante: 'TICKET', fact_ruc: '', fact_razon: '', fact_email: '' };
      var ruc = str(x.ruc || x.fact_ruc).replace(/[\s.]/g, '').toUpperCase();
      must(/^[0-9]{3,10}(-[0-9])?$/.test(ruc), 'RUC_INVALIDO', 'RUC o CI inválido (ej.: 80012345-6 o 1234567).');
      var razon = cleanText(x.razon || x.razon_social || x.fact_razon, 120);
      must(razon.length >= 2, 'RAZON_REQUERIDA', 'Indicá la razón social o el nombre para la factura.');
      var email = cleanText(x.email || x.fact_email, 120);
      must(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'EMAIL_INVALIDO', 'Correo inválido.');
      return { comprobante: 'FACTURA', fact_ruc: ruc, fact_razon: razon, fact_email: email };
    }
    function comprobanteView(c) {
      if (!c || !c.comprobante) return null;
      return { tipo: c.comprobante, ruc: str(c.fact_ruc), razon: str(c.fact_razon), email: str(c.fact_email) };
    }
    function setComprobante(p, user) {
      requireRole(user, ['ADMIN', 'MOZO', 'CAJA']);
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c, 'CUENTA_INEXISTENTE', 'Cuenta inexistente.', 404);
      if (user.rol === 'CAJA') requireCaja(user, c.caja_id);
      must(c.pago_estado !== 'COBRADO', 'YA_COBRADA', 'Esta cuenta ya fue cobrada.', 409);
      var cp = comprobanteDe(p.comprobante);
      must(cp, 'COMPROBANTE_INVALIDO', 'Elegí ticket o factura.');
      db.update('Cuentas', c.cuenta_id, cp);
      audit(user, 'COMPROBANTE', 'Cuentas', c.cuenta_id, { tipo: cp.comprobante, ruc: cp.fact_ruc });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)) };
    }

    function requestClose(p, user) {
      requireRole(user, ['ADMIN', 'MOZO']);
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c && c.estado === 'ABIERTA', 'CUENTA_INVALIDA', 'La cuenta no está abierta.', 409);
      var cp = comprobanteDe(p.comprobante);
      var upd = { estado: 'CIERRE_SOLICITADO', cierre_solicitado_en: iso(now()), cierre_pedido: '' };
      if (cp) Object.keys(cp).forEach(function (k) { upd[k] = cp[k]; });
      db.update('Cuentas', c.cuenta_id, upd);
      audit(user, 'CIERRE_SOLICITADO', 'Cuentas', c.cuenta_id, { mesa: c.mesa_id, total: cuentaTotal(c.cuenta_id), comprobante: cp ? cp.comprobante : '' });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)) };
    }

    // Pedido de cuenta desde el celular del cliente: cómo va a pagar (sirve al mozo y a la caja para llegar listos).
    function cierrePedidoView(c) {
      if (!str(c.cierre_pedido)) return null;
      try { return JSON.parse(c.cierre_pedido); } catch (e) { return null; }
    }
    function cierrePedidoDe(p) {
      var medios = csv(cfg('medios_pago'));
      var medio = str(p.medio).toUpperCase();
      must(!medio || medios.indexOf(medio) >= 0, 'MEDIO_INVALIDO', 'Elegí un medio de pago de la lista.');
      var con = medio === 'EFECTIVO' ? int(p.paga_con) : 0;
      must(con >= 0 && con <= 50000000, 'MONTO_INVALIDO', 'Monto inválido.');
      return { origen: 'CLIENTE', medio: medio, paga_con: con, separado: p.separado === true, nota: cleanText(p.nota, 140), en: iso(now()) };
    }
    function mesaQr(token) {
      must(isTrue(cfg('cuenta_qr_habilitada')), 'CUENTA_QR_DESHABILITADA', 'Pedile la cuenta a tu mozo.', 403);
      var r = resolveToken(token);
      must(r.tipo === 'MESA', 'SOLO_MESA', 'La cuenta se pide desde el QR de la mesa.', 400);
      return r;
    }
    function cuentaPublica(c) {
      if (!c) return null;
      var items = {};
      db.all('Pedidos').filter(function (x) { return x.cuenta_id === c.cuenta_id && x.estado !== 'CANCELADO'; }).forEach(function (ped) {
        itemsOf(ped.pedido_id).filter(function (i) { return !isTrue(i.anulado); }).forEach(function (i) {
          var k = i.nombre + '|' + str(i.opciones) + '|' + int(i.precio_unit_gs);
          if (!items[k]) items[k] = { nombre: i.nombre, opciones: str(i.opciones), cantidad: 0, total_gs: 0 };
          items[k].cantidad += int(i.cantidad); items[k].total_gs += int(i.total_gs);
        });
      });
      var cp = comprobanteView(c);
      return {
        estado: c.estado, pago_estado: c.pago_estado, total_gs: cuentaTotal(c.cuenta_id),
        pagado_gs: c.pago_estado === 'PARCIAL' ? desglose(c).pagado_gs : 0,
        cierre_solicitado_en: c.cierre_solicitado_en, items: Object.keys(items).map(function (k) { return items[k]; }),
        // El correo no se devuelve: la mesa la comparten varias personas.
        comprobante: cp ? { tipo: cp.tipo, ruc: cp.ruc, razon: cp.razon } : null,
        pedido: cierrePedidoView(c), personas: personasDe(c).length
      };
    }
    function publicCuenta(p) {
      var r = mesaQr(p.token);
      var c = cuentaAbiertaDeMesa(r.mesa_id);
      return { mesa: r.mesa, cuenta: cuentaPublica(c), medios: csv(cfg('medios_pago')) };
    }
    function publicPedirCuenta(p) {
      var r = mesaQr(p.token);
      rateLimit('cuenta:' + str(p.token), 8, 600);
      var c = cuentaAbiertaDeMesa(r.mesa_id);
      must(c && cuentaTotal(c.cuenta_id) > 0, 'SIN_CONSUMOS', 'Todavía no hay consumos cargados en esta mesa. Pedile ayuda a tu mozo.', 409);
      must(c.pago_estado !== 'COBRADO', 'YA_COBRADA', 'Esta cuenta ya fue cobrada.', 409);
      var cp = comprobanteDe(p.comprobante);
      must(cp, 'COMPROBANTE_INVALIDO', 'Elegí ticket o factura.');
      var cierre = cierrePedidoDe(p), yaPedida = c.estado === 'CIERRE_SOLICITADO';
      var upd = { estado: 'CIERRE_SOLICITADO', cierre_solicitado_en: yaPedida && c.cierre_solicitado_en ? c.cierre_solicitado_en : iso(now()), cierre_pedido: JSON.stringify(cierre) };
      Object.keys(cp).forEach(function (k) { upd[k] = cp[k]; });
      db.update('Cuentas', c.cuenta_id, upd);
      audit(null, yaPedida ? 'CIERRE_ACTUALIZADO_QR' : 'CIERRE_SOLICITADO_QR', 'Cuentas', c.cuenta_id, { mesa: c.mesa_id, total: cuentaTotal(c.cuenta_id), comprobante: cp.comprobante, medio: cierre.medio });
      bumpRev();
      return { mesa: r.mesa, cuenta: cuentaPublica(db.get('Cuentas', c.cuenta_id)), medios: csv(cfg('medios_pago')) };
    }

    function clienteCuenta(c) {
      if (!str(c.cliente_id) || !licenciaRec()) return null;
      var cli = db.get('RecClientes', c.cliente_id);
      return cli ? { cliente_id: cli.cliente_id, nombre: cli.nombre, codigo: cli.codigo, sellos: int(cli.sellos), meta: metaRec(), cupones: cuponesDe(cli.cliente_id, true).length } : null;
    }
    function cuentaView(c) {
      return {
        cuenta_id: c.cuenta_id, punto_id: c.punto_id, caja_id: c.caja_id, mesa_id: c.mesa_id, mesa: c.mesa_id ? mesaNombre(c.mesa_id) : '',
        alias: c.alias, estado: c.estado, pago_estado: c.pago_estado, abierta_en: c.abierta_en,
        cierre_solicitado_en: c.cierre_solicitado_en, cerrada_en: c.cerrada_en, cobro_id: c.cobro_id, total_gs: cuentaTotal(c.cuenta_id),
        whatsapp: str(c.whatsapp), acepta_promos: isTrue(c.acepta_promos), mesa_antes: str(c.mesa_antes), trasladada_en: str(c.trasladada_en),
        comprobante: comprobanteView(c), personas: personasDe(c).length ? desglose(c) : null,
        pagado_gs: c.pago_estado === 'PARCIAL' ? desglose(c).pagado_gs : 0,
        cliente: clienteCuenta(c), cierre_pedido: cierrePedidoView(c)
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
      var sel = Array.isArray(p.personas) && p.personas.length ? p.personas.map(String) : null;
      must(!sel || personasDe(c).length, 'PERSONA_INVALIDA', 'Esta cuenta no está dividida por personas.');
      var parte = calcularParte(c, sel, str(p.compartido).toUpperCase());
      var subtotal = parte.monto;
      must(subtotal > 0, 'CUENTA_VACIA', sel ? 'Esas personas no tienen nada pendiente.' : 'La cuenta no tiene importe a cobrar.', 409);
      if (isInt(p.total_esperado_gs)) must(p.total_esperado_gs === subtotal, 'TOTAL_CAMBIO', 'El total cambió (ahora Gs. ' + subtotal + '). Revisá antes de cobrar.', 409);
      var desc = p.descuento_gs || 0;
      must(isInt(desc) && desc >= 0 && desc <= subtotal, 'DESCUENTO_INVALIDO', 'Descuento inválido.');
      var autorizo = '';
      var motivoDesc = cleanText(p.motivo_descuento, 200);
      if (desc > 0) {
        must(motivoDesc.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo del descuento.');
        autorizo = supervisor(user, p.autorizacion).usuario_id;
      }
      var rc = recEnCobro(c, p, subtotal - desc, sel);
      var descRec = rc ? rc.desc : 0;
      var total = subtotal - desc - descRec;
      var pagos = Array.isArray(p.pagos) ? p.pagos : [];
      var medios = mediosPago();
      if (total === 0 && descRec > 0) must(pagos.length === 0, 'PAGOS_INVALIDOS', 'El premio cubre todo: no hay nada que cobrar.');
      else must(pagos.length >= 1 && pagos.length <= 4, 'PAGOS_INVALIDOS', 'Indicá el medio de pago.');
      var suma = 0;
      pagos.forEach(function (x) {
        must(medios.indexOf(x.medio) >= 0, 'MEDIO_INVALIDO', 'Medio de pago no habilitado: ' + x.medio);
        must(isInt(x.monto_gs) && x.monto_gs > 0, 'MONTO_INVALIDO', 'Monto inválido.');
        suma += x.monto_gs;
      });
      must(suma === total, 'MONTO_NO_COINCIDE', 'Los pagos (Gs. ' + suma + ') no coinciden con el total (Gs. ' + total + ').');
      var cp = comprobanteDe(p.comprobante);
      if (cp && !sel) db.update('Cuentas', c.cuenta_id, cp);
      var cpv = comprobanteView(cp ? cp : c) || { tipo: 'TICKET', ruc: '', razon: '', email: '' };
      var t = iso(now());
      var cobro = {
        cobro_id: newId('COB'), request_id: reqId, cuenta_id: c.cuenta_id, caja_id: c.caja_id, turno_id: turno.turno_id, fecha: t,
        subtotal_gs: subtotal, descuento_gs: desc + descRec, total_gs: total, pagos: JSON.stringify(pagos.map(function (x) { return { medio: x.medio, monto_gs: x.monto_gs }; })),
        usuario_id: user.usuario_id, autorizado_por: autorizo, motivo_descuento: motivoDesc, estado: 'VALIDO', revertido_por: '', revertido_en: '', motivo_reverso: '',
        comprobante: JSON.stringify(cpv), detalle: JSON.stringify(parte.detalle), recompensa: ''
      };
      db.insert('Cobros', cobro);
      var recOut = rc ? recCerrarCobro(rc, c, cobro, user) : null;
      pagos.forEach(function (x) {
        db.insert('Movimientos', {
          movimiento_id: newId('MOV'), request_id: reqId, caja_id: c.caja_id, turno_id: turno.turno_id, cuenta_id: c.cuenta_id, cobro_id: cobro.cobro_id,
          fecha: t, tipo: 'COBRO', medio: x.medio, monto_gs: x.monto_gs, usuario_id: user.usuario_id, motivo: ''
        });
      });
      var resta = cuentaTotal(c.cuenta_id) - desglose(db.get('Cuentas', c.cuenta_id)).pagado_gs;
      if (resta <= 0) {
        db.update('Cuentas', c.cuenta_id, { pago_estado: 'COBRADO', estado: 'CERRADA', cerrada_en: t, cobro_id: cobro.cobro_id });
        if (c.mesa_id && db.get('Mesas', c.mesa_id)) db.update('Mesas', c.mesa_id, { pagada_en: t }); // queda "Pagada · aún ocupada" hasta que el mozo la libere
      } else {
        db.update('Cuentas', c.cuenta_id, { pago_estado: 'PARCIAL', cobro_id: cobro.cobro_id }); // cobro de una parte (sub-cuentas)
      }
      audit(user, 'COBRO', 'Cobros', cobro.cobro_id, { cuenta: c.cuenta_id, caja: c.caja_id, total_gs: total, descuento_gs: desc, descuento_premios_gs: descRec, autorizo: autorizo, cliente: rc ? rc.cli.cliente_id : '' });
      bumpRev();
      var outC = { cobro: cobroView(db.get('Cobros', cobro.cobro_id)), duplicado: false };
      if (recOut) outC.recompensa = recOut;
      return outC;
    }
    function cobroView(c) {
      var v = pick(c, ['cobro_id', 'cuenta_id', 'caja_id', 'turno_id', 'fecha', 'usuario_id', 'autorizado_por', 'motivo_descuento', 'estado', 'revertido_por', 'revertido_en', 'motivo_reverso']);
      v.subtotal_gs = int(c.subtotal_gs); v.descuento_gs = int(c.descuento_gs); v.total_gs = int(c.total_gs);
      v.pagos = c.pagos ? JSON.parse(c.pagos) : [];
      v.comprobante = c.comprobante ? JSON.parse(c.comprobante) : null;
      v.detalle = c.detalle ? JSON.parse(c.detalle) : null;
      v.recompensa = c.recompensa ? JSON.parse(c.recompensa) : null;
      if (v.recompensa) { var rcli = db.get('RecClientes', v.recompensa.cliente_id); v.recompensa.nombre = rcli ? rcli.nombre : ''; }
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
      recRevertirCobro(cobro, user, motivo);
      var quedan = cobrosValidos(cobro.cuenta_id).length;
      db.update('Cuentas', cobro.cuenta_id, { pago_estado: quedan ? 'PARCIAL' : 'REVERTIDO', estado: 'CIERRE_SOLICITADO', cerrada_en: '', cobro_id: '' });
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
      // Avisos de pedidos para llevar del QR (EQUIPO): todo el equipo de atención se entera, aunque no le toque atenderlos.
      var avisosLlevar = llevarEquipo() && user.rol !== 'COCINA' ? pedidos.filter(function (x) { return esLlevarQR(x) && x.estado === 'PENDIENTE'; })
        .map(function (x) { return { pedido_id: x.pedido_id, numero: x.numero, alias: x.alias, creado_en: x.creado_en, total_gs: int(x.total_gs) }; }) : [];
      if (user.rol === 'CAJA') {
        pedidos = pedidos.filter(function (x) { return x.caja_id === user.caja_id; });
      }
      var cuentasVis = cuentas.filter(function (c) {
        return (abiertas[c.cuenta_id] || str(c.cerrada_en).slice(0, 10) === today || str(c.abierta_en).slice(0, 10) === today) &&
          (user.rol !== 'CAJA' || c.caja_id === user.caja_id);
      });
      var out = {
        rev: rev, ahora: iso(now()), hoy: today,
        plan: infoPlan(),
        recompensas: user.rol === 'COCINA' ? null : recEstadoSync(),
        ajustes: { cocina_alertas: alertasCocina(), estaciones: estaciones(), reserva_bloqueo_min: int(cfg('reserva_bloqueo_min') || 120), reserva_tolerancia_min: int(cfg('reserva_tolerancia_min') || 30),
          para_llevar: { modo: llevarEquipo() ? 'EQUIPO' : 'CAJA', alertas: alertasLlevar(), caja: llevarEquipo() ? cajaSalon() : '', atiendo: atiendeLlevar(user) || (user.rol === 'CAJA' && llevarEquipo() && user.caja_id === cajaSalon()) || user.rol === 'ADMIN' } },
        avisos_llevar: avisosLlevar,
        traslados: cuentas.filter(function (c) { return abiertas[c.cuenta_id] && c.trasladada_en && env.dateKey(Date.parse(str(c.trasladada_en))) === today && (user.rol !== 'CAJA' || c.caja_id === user.caja_id); })
          .map(function (c) { return { cuenta_id: c.cuenta_id, de: str(c.mesa_antes), a: mesaNombre(c.mesa_id), en: str(c.trasladada_en) }; }),
        negocio: cfg('nombre_negocio'),
        pedidos: pedidos.map(orderView),
        cuentas: user.rol === 'COCINA' ? [] : cuentasVis.map(cuentaView),
        mesas: db.all('Mesas').filter(function (m) { return isTrue(m.activa); }).map(function (m) { return { mesa_id: m.mesa_id, numero: int(m.numero), nombre: m.nombre, zona: m.zona, punto_id: m.punto_id, reserva: reservaInfo(m), pagada_en: str(m.pagada_en) }; })
          .sort(function (a, b) { return a.numero - b.numero; }),
        puntos: db.all('Puntos').map(function (x) { return pick(x, ['punto_id', 'nombre', 'modalidad', 'prefijo', 'caja_id']); }),
        disponibilidad: db.all('Productos').filter(function (x) { return isTrue(x.activo); }).map(function (x) { return { id: x.producto_id, nombre: x.nombre, categoria: x.categoria_id, disponible: isTrue(x.disponible) }; })
      };
      return out;
    }

    // ---------------------------------------------------------------- admin
    var PROD_FIELDS = ['categoria_id', 'nombre', 'descripcion', 'precio_gs', 'activo', 'disponible', 'puntos', 'grupos', 'orden', 'validacion', 'nota', 'modelo_3d', 'imagen', 'dias', 'estacion', 'armador'];
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
      if (d.modelo_3d !== undefined) {
        var m3 = str(d.modelo_3d, 300);
        must(!m3 || /^(https:\/\/[^\s"'<>]+|modelos\/[A-Za-z0-9_\-]+)\.glb$/.test(m3), 'MODELO_INVALIDO', 'El modelo 3D debe ser un archivo .glb (link https o modelos/nombre.glb).');
        if (m3) {
          var otros = db.all('Productos').filter(function (x) { return x.producto_id !== id && str(x.modelo_3d); }).length, lim = platos3d();
          var ya = db.get('Productos', id) && str(db.get('Productos', id).modelo_3d);
          must(ya || otros < lim, 'LIMITE_3D', 'Tu plan incluye ' + lim + ' platos en 3D y ya están todos en uso. Para sumar más, consultá con Ser o Límites.');
        }
        row.modelo_3d = m3;
      }
      if (d.dias !== undefined) {
        var dl = csv(d.dias);
        must(dl.every(function (x) { return /^[1-7]$/.test(x); }), 'DIAS_INVALIDOS', 'Días inválidos (1 = lunes … 7 = domingo).');
        row.dias = dl.filter(function (x, i) { return dl.indexOf(x) === i; }).sort().join(',');
      }
      if (d.estacion !== undefined) {
        var es = str(d.estacion).toUpperCase();
        must(!es || estacionesIdx()[es], 'ESTACION_INVALIDA', 'Estación inexistente: ' + es + '. Revisá Configuración → estaciones.');
        row.estacion = es;
      }
      if (d.armador !== undefined) {
        var ar = str(d.armador).toUpperCase();
        must(!ar || ARMADORES.indexOf(ar) >= 0, 'ARMADOR_INVALIDO', 'Armador inválido (PIZZA, PORCION o HAMBURGUESA).');
        row.armador = ar;
      }
      if (d.imagen !== undefined) {
        var im = str(d.imagen, 500);
        must(!im || /^(https:\/\/[^\s"'<>]+|imagenes\/[A-Za-z0-9_\-]+\.(jpg|jpeg|png|webp))$/i.test(im), 'IMAGEN_INVALIDA', 'La foto debe ser un link https://… o imagenes/nombre.jpg');
        row.imagen = im;
      }
      var prev = db.get('Productos', id);
      if (prev) {
        var cambios = {};
        PROD_FIELDS.forEach(function (k) { if (row[k] !== undefined && String(prev[k]) !== String(row[k])) cambios[k] = [prev[k], row[k]]; });
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
      must(mn >= 0 && mx >= 1 && mx >= mn && mx <= 30, 'GRUPO_INVALIDO', 'Mínimo/máximo inválidos.');
      var row = { nombre: cleanText(g.nombre, 60), min: mn, max: mx, activo: isTrue(g.activo) ? 'SI' : 'NO', nota: cleanText(g.nota, 200) };
      if (g.regla !== undefined) { must(['', 'MAYOR'].indexOf(str(g.regla)) >= 0, 'GRUPO_INVALIDO', 'Regla de precio inválida.'); row.regla = str(g.regla); }
      if (g.tipo !== undefined) { must(TIPOS_GRUPO.indexOf(str(g.tipo).toUpperCase()) >= 0, 'GRUPO_INVALIDO', 'Tipo de grupo inválido.'); row.tipo = str(g.tipo).toUpperCase(); }
      if (g.repetir !== undefined) { must(isInt(g.repetir) && g.repetir >= 1 && g.repetir <= MAX_REPETIR, 'GRUPO_INVALIDO', 'Repetir: de 1 a ' + MAX_REPETIR + ' veces por opción.'); row.repetir = g.repetir; }
      var prevG = db.get('Grupos', id) || {};
      var tipoF = row.tipo !== undefined ? row.tipo : str(prevG.tipo), regF = row.regla !== undefined ? row.regla : str(prevG.regla);
      var repF = row.repetir !== undefined ? row.repetir : repetirDe(prevG);
      must(!(repF > 1 && (regF === 'MAYOR' || tipoF)), 'GRUPO_INVALIDO', 'Solo los grupos de agregados pueden repetir una opción.');
      must(row.nombre.length >= 2, 'NOMBRE_INVALIDO', 'Nombre inválido.');
      if (db.get('Grupos', id)) db.update('Grupos', id, row); else { row.grupo_id = id; db.insert('Grupos', row); }
      var ops = Array.isArray(g.opciones) ? g.opciones : [];
      ops.forEach(function (o, i) {
        var oid = str(o.opcion_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_') || (id + '_' + (i + 1));
        must(isInt(o.delta_gs) && o.delta_gs >= 0, 'PRECIO_INVALIDO', 'Diferencia de precio inválida.');
        must(!(tipoF === 'QUITAR' && o.delta_gs !== 0), 'PRECIO_INVALIDO', 'Sacar un ingrediente no tiene costo: dejá 0 en la diferencia de precio.');
        var orow = { grupo_id: id, nombre: cleanText(o.nombre, 60), delta_gs: o.delta_gs, activo: isTrue(o.activo) ? 'SI' : 'NO', orden: i + 1 };
        if (o.dibujo !== undefined) { must(/^[A-Z_]{0,24}$/.test(str(o.dibujo).toUpperCase()), 'DIBUJO_INVALIDO', 'Dibujo inválido.'); orow.dibujo = str(o.dibujo).toUpperCase(); }
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
      if (c.estacion !== undefined) {
        var ce = str(c.estacion).toUpperCase();
        must(!ce || estacionesIdx()[ce], 'ESTACION_INVALIDA', 'Estación inexistente: ' + ce + '. Revisá Configuración → estaciones.');
        row.estacion = ce;
      }
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
      must(!ex || ex.rol !== 'PLATAFORMA', 'USUARIO_PROTEGIDO', 'Ese usuario es de Ser o Límites y no se edita desde acá.', 403);
      var row = { nombre: cleanText(u.nombre, 60), rol: u.rol, caja_id: u.rol === 'CAJA' ? str(u.caja_id) : '', activo: isTrue(u.activo) ? 'SI' : 'NO', para_llevar: u.rol === 'MOZO' && isTrue(u.para_llevar) ? 'SI' : 'NO' };
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
      audit(user, ex ? 'USUARIO_EDITADO' : 'USUARIO_CREADO', 'Usuarios', id, { rol: row.rol, caja_id: row.caja_id, activo: row.activo, para_llevar: row.para_llevar, pin_cambiado: !!u.pin });
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
      if (k === 'estaciones') {
        var en = csv(v).map(function (x) { return cleanText(x, 20); }), ids = en.map(slugEst);
        must(en.length >= 1 && en.length <= MAX_ESTACIONES && ids.every(function (x, i) { return x && ids.indexOf(x) === i; }), 'VALOR_INVALIDO', 'Indicá de 1 a ' + MAX_ESTACIONES + ' estaciones distintas separadas por coma (ej.: Cocina, Barra 1, Barra 2).');
        v = en.join(', ');
      }
      if (k === 'para_llevar_qr_atiende') {
        v = v.toUpperCase();
        must(v === 'CAJA' || v === 'EQUIPO', 'VALOR_INVALIDO', 'Elegí CAJA o EQUIPO.');
        if (v === 'EQUIPO') must(cajaSalon(), 'VALOR_INVALIDO', 'Para EQUIPO el local necesita un salón activo con su caja.');
      }
      if (k === 'para_llevar_whatsapp') {
        v = v.toUpperCase();
        must(['NO', 'OPCIONAL', 'OBLIGATORIO'].indexOf(v) >= 0, 'VALOR_INVALIDO', 'Elegí NO, OPCIONAL u OBLIGATORIO.');
      }
      if (k === 'para_llevar_alerta_min') {
        var am = csv(v);
        must(am.length >= 1 && am.length <= 3 && am.every(function (x, i) { return /^[0-9]{1,2}$/.test(x) && int(x) >= 1 && int(x) <= 60 && (i === 0 || int(x) > int(am[i - 1])); }), 'VALOR_INVALIDO', 'Indicá de 1 a 3 minutos crecientes entre 1 y 60, separados por coma (ej.: 3,5).');
        v = am.join(',');
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
        usuarios: db.all('Usuarios').filter(function (u) { return u.rol !== 'PLATAFORMA'; }).map(function (u) { return pick(u, ['usuario_id', 'nombre', 'rol', 'caja_id', 'activo', 'bloqueado_hasta', 'para_llevar']); }),
        config: Object.keys(DEFAULT_CONFIG).filter(function (k) { return k !== 'rev'; }).map(function (k) { return { clave: k, valor: cfg(k), descripcion: DEFAULT_CONFIG[k][1] }; }),
        plan: infoPlan(), estaciones: estaciones()
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
      // Tiempo de cada estación: desde que se aceptó el pedido hasta que esa estación marcó su parte lista.
      var porEst = {}, okR = estacionesIdx();
      pedidos.forEach(function (x) {
        if (!x.aceptado_en || x.estado === 'CANCELADO' || !str(x.estaciones)) return;
        var av = null; try { av = JSON.parse(x.estaciones); } catch (e) { av = null; }
        Object.keys(av || {}).forEach(function (k) {
          if (av[k] && av[k].listo_en) (porEst[k] = porEst[k] || []).push((Date.parse(av[k].listo_en) - Date.parse(x.aceptado_en)) / 60000);
        });
      });
      var tiemposEst = Object.keys(porEst).map(function (k) {
        var l = porEst[k].sort(function (a, b) { return a - b; });
        return { estacion: k, nombre: okR[k] ? okR[k].nombre : k, muestras: l.length,
          promedio: Math.round(l.reduce(function (a, b) { return a + b; }, 0) / l.length * 10) / 10, mediana: Math.round(l[Math.floor(l.length / 2)] * 10) / 10 };
      });
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
        tiempos_por_estacion: tiemposEst,
        stock: licenciaStock() ? reporteStock(desde, hasta, pedIds, H) : null,
        cierres: cierres,
        cobros_revertidos: cobros.filter(function (c) { return c.estado === 'REVERTIDO'; }).map(cobroView)
      };
    }
    function auditList(p, user) {
      requireRole(user, ['ADMIN']);
      var rows = db.all('Auditoria').slice(-300).reverse();
      return { auditoria: rows };
    }


    // ---------------------------------------------------------------- upgrade: stock y costos
    // Insumos con stock en unidades base enteras y costo promedio ponderado (Gs. por 1.000 unidades base).
    // Cada venta aceptada descuenta la receta de cada línea (producto + opciones elegidas) y guarda el costo de la
    // línea, así el margen histórico no cambia si después sube un insumo. Si se cancela antes de empezar a
    // prepararse, el stock vuelve (DEVOLUCION); después cuenta como consumido. Todo movimiento queda en MovStock.
    var UNIDADES = { G: 'g', ML: 'ml', UN: 'u' };
    var MAX_CANT = 100000000; // 100 t / 100.000 l / 100 millones de unidades
    function licenciaStock() { return tieneModulo('STOCK'); }
    function requireStock() { must(licenciaStock(), 'MODULO_NO_ACTIVO', 'Mesa Viru (stock y costos) no está contratado en este local.', 403); }
    // División entera redondeada (mitad hacia arriba en valor absoluto): todo el dinero queda en guaraníes enteros.
    function divRound(a, b) { if (!b) return 0; var sg = (a < 0) !== (b < 0) ? -1 : 1; a = Math.abs(a); b = Math.abs(b); return sg * Math.floor((2 * a + b) / (2 * b)); }
    function costoCant(costoMil, cant) { return divRound(int(cant) * int(costoMil), 1000); }
    function insumoView(i) {
      var st = int(i.stock), cm = int(i.costo_mil_gs);
      return { insumo_id: i.insumo_id, nombre: i.nombre, unidad: i.unidad, stock: st, costo_mil_gs: cm, valor_gs: st > 0 ? costoCant(cm, st) : 0,
        minimo: int(i.minimo), bajo_minimo: int(i.minimo) > 0 && st <= int(i.minimo), activo: isTrue(i.activo), proveedor: str(i.proveedor), nota: str(i.nota), actualizado_en: str(i.actualizado_en) };
    }
    function movStock(ins, tipo, cant, costo, extra, user) {
      var nuevo = int(ins.stock) + cant, t = iso(now());
      var m = {
        mov_id: newId('MST'), request_id: '', fecha: t, insumo_id: ins.insumo_id, tipo: tipo, cantidad: cant, stock_despues: nuevo,
        costo_gs: costo, costo_mil_gs: int(ins.costo_mil_gs), pedido_id: '', item_id: '', referencia: '', usuario_id: user ? user.usuario_id : 'PUBLICO', motivo: ''
      };
      Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
      db.insert('MovStock', m);
      db.update('Insumos', ins.insumo_id, { stock: nuevo, actualizado_en: t });
      ins.stock = nuevo;
      return m;
    }
    // Insumos que consume una línea: receta base del producto + lo que suma cada opción elegida.
    function recetaDe(productoId, opcionesIds) {
      var ops = {}; csv(opcionesIds).forEach(function (o) { ops[o] = (ops[o] || 0) + 1; }); // opción repetida (doble carne) = receta x2
      var tot = {};
      db.all('Recetas').forEach(function (r) {
        if (r.producto_id !== productoId || int(r.cantidad) <= 0) return;
        if (str(r.opcion_id) && !ops[str(r.opcion_id)]) return;
        tot[r.insumo_id] = (tot[r.insumo_id] || 0) + int(r.cantidad) * (str(r.opcion_id) ? ops[str(r.opcion_id)] : 1);
      });
      return tot;
    }
    // Descuenta del stock la receta de cada línea del pedido. Idempotente por línea (stock_ok). Cada línea guarda lo que
    // consumió (consumo = { insumo: [cantidad, costo] }) y su costo; en MovStock queda un movimiento por insumo y pedido
    // (así un pedido grande no supera el límite de escrituras de Firestore).
    function descontarPedido(ped, user) {
      if (!licenciaStock()) return;
      var agg = {}, orden = [];
      itemsOf(ped.pedido_id).forEach(function (it) {
        if (isTrue(it.anulado) || it.stock_ok === 'SI' || it.stock_ok === 'DEV') return;
        var rec = recetaDe(it.producto_id, it.opciones_ids), cons = {}, costo = 0;
        Object.keys(rec).forEach(function (iid) {
          var ins = db.get('Insumos', iid); if (!ins) return;
          var q = rec[iid] * int(it.cantidad), c = costoCant(ins.costo_mil_gs, q);
          cons[iid] = [q, c]; costo += c;
          if (!agg[iid]) { agg[iid] = { q: 0, c: 0 }; orden.push(iid); }
          agg[iid].q += q; agg[iid].c += c;
        });
        if (!Object.keys(cons).length) { db.update('PedidoItems', it.item_id, { stock_ok: 'SR', costo_gs: '' }); return; } // sin receta: margen desconocido
        db.update('PedidoItems', it.item_id, { stock_ok: 'SI', costo_gs: costo, consumo: JSON.stringify(cons) });
      });
      orden.forEach(function (iid) { movStock(db.get('Insumos', iid), 'VENTA', -agg[iid].q, -agg[iid].c, { pedido_id: ped.pedido_id, referencia: ped.numero }, user); });
    }
    // Devuelve al stock lo que descontó una línea (cancelación o anulación antes de empezar a prepararse).
    function devolverItem(it, ped, user, motivo) {
      if (it.stock_ok !== 'SI') return;
      var cons = {}; try { cons = JSON.parse(str(it.consumo) || '{}'); } catch (e) { cons = {}; }
      Object.keys(cons).forEach(function (iid) {
        var ins = db.get('Insumos', iid); if (!ins) return;
        movStock(ins, 'DEVOLUCION', int(cons[iid][0]), int(cons[iid][1]), { pedido_id: ped.pedido_id, item_id: it.item_id, referencia: ped.numero, motivo: cleanText(motivo, 120) }, user);
      });
      db.update('PedidoItems', it.item_id, { stock_ok: 'DEV' });
    }
    // Antes de que la cocina empiece, lo pedido todavía está en la heladera: vuelve al stock.
    function stockVuelve(estado) { return estado === 'PENDIENTE' || estado === 'ACEPTADO'; }

    function stockData(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var ins = db.all('Insumos').map(insumoView).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      var insIdx = idx(db.all('Insumos'), 'insumo_id');
      var recetas = {};
      db.all('Recetas').forEach(function (r) { if (int(r.cantidad) > 0) (recetas[r.producto_id] = recetas[r.producto_id] || []).push({ receta_id: r.receta_id, opcion_id: str(r.opcion_id), insumo_id: r.insumo_id, cantidad: int(r.cantidad) }); });
      var opciones = idx(db.all('Opciones'), 'opcion_id');
      var costoLinea = function (l) { var i = insIdx[l.insumo_id]; return i ? costoCant(i.costo_mil_gs, l.cantidad) : 0; };
      var costos = db.all('Productos').filter(function (x) { return isTrue(x.activo); }).map(function (x) {
        var ls = recetas[x.producto_id] || [], base = ls.filter(function (l) { return !l.opcion_id; });
        var c = base.reduce(function (s0, l) { return s0 + costoLinea(l); }, 0), precio = int(x.precio_gs);
        var porOp = {};
        ls.filter(function (l) { return l.opcion_id; }).forEach(function (l) { porOp[l.opcion_id] = (porOp[l.opcion_id] || 0) + costoLinea(l); });
        return { producto_id: x.producto_id, nombre: x.nombre, categoria_id: x.categoria_id, precio_gs: precio, tiene_receta: base.length > 0, costo_gs: c,
          margen_gs: precio - c, margen_pct: precio > 0 && base.length ? divRound((precio - c) * 100, precio) : null,
          opciones: Object.keys(porOp).map(function (o) { return { opcion_id: o, nombre: opciones[o] ? opciones[o].nombre : o, delta_gs: opciones[o] ? int(opciones[o].delta_gs) : 0, costo_gs: porOp[o] }; }) };
      });
      var movs = db.all('MovStock').slice(-150).reverse().map(function (m) {
        return { mov_id: m.mov_id, fecha: m.fecha, insumo_id: m.insumo_id, nombre: insIdx[m.insumo_id] ? insIdx[m.insumo_id].nombre : m.insumo_id, tipo: m.tipo, cantidad: int(m.cantidad),
          stock_despues: int(m.stock_despues), costo_gs: int(m.costo_gs), referencia: str(m.referencia), usuario_id: m.usuario_id, motivo: str(m.motivo) };
      });
      return {
        insumos: ins, recetas: recetas, costos: costos, movimientos: movs, unidades: UNIDADES,
        valor_total_gs: ins.reduce(function (s0, i) { return s0 + i.valor_gs; }, 0),
        para_comprar: ins.filter(function (i) { return i.activo && i.bajo_minimo; })
      };
    }
    function insumoUpsert(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var d = p.insumo || {};
      var nombre = cleanText(d.nombre, 60);
      must(nombre.length >= 2, 'NOMBRE_INVALIDO', 'Indicá el nombre del insumo.');
      var id = str(d.insumo_id) ? str(d.insumo_id).toUpperCase().replace(/[^A-Z0-9_]/g, '_') : 'I_' + slugEst(nombre).slice(0, 30);
      var ex = db.get('Insumos', id);
      if (!str(d.insumo_id) && ex) { var n = 2; while (db.get('Insumos', id + '_' + n)) n++; id = id + '_' + n; ex = null; }
      var unidad = str(d.unidad).toUpperCase();
      must(UNIDADES[unidad], 'UNIDAD_INVALIDA', 'Unidad inválida: G (gramos), ML (mililitros) o UN (unidades).');
      if (ex && ex.unidad !== unidad) must(!db.all('MovStock').some(function (m) { return m.insumo_id === id; }), 'UNIDAD_FIJA', 'Este insumo ya tiene movimientos: su unidad no se puede cambiar. Creá uno nuevo.', 409);
      var minimo = d.minimo === undefined || d.minimo === '' ? 0 : d.minimo;
      must(isInt(minimo) && minimo >= 0 && minimo <= MAX_CANT, 'CANTIDAD_INVALIDA', 'Mínimo inválido (entero en ' + UNIDADES[unidad] + ').');
      var row = { nombre: nombre, unidad: unidad, minimo: minimo, activo: d.activo === undefined || isTrue(d.activo) ? 'SI' : 'NO', proveedor: cleanText(d.proveedor, 60), nota: cleanText(d.nota, 200), actualizado_en: iso(now()) };
      if (ex) db.update('Insumos', id, row);
      else { row.insumo_id = id; row.stock = 0; row.costo_mil_gs = 0; db.insert('Insumos', row); }
      audit(user, ex ? 'INSUMO_EDITADO' : 'INSUMO_CREADO', 'Insumos', id, row);
      bumpRev();
      return { insumo: insumoView(db.get('Insumos', id)) };
    }
    function recetaSet(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var prod = db.get('Productos', str(p.producto_id));
      must(prod, 'PRODUCTO_INEXISTENTE', 'Producto inexistente.', 404);
      var op = str(p.opcion_id);
      if (op) {
        var o = db.get('Opciones', op);
        must(o && csv(prod.grupos).indexOf(o.grupo_id) >= 0, 'OPCION_INVALIDA', 'Esa opción no es de este producto.');
      }
      var lineas = Array.isArray(p.lineas) ? p.lineas : [];
      must(lineas.length <= 40, 'RECETA_GRANDE', 'Máximo 40 insumos por receta.');
      var vistos = {};
      lineas.forEach(function (l) {
        var ins = db.get('Insumos', str(l.insumo_id));
        must(ins, 'INSUMO_INEXISTENTE', 'Insumo inexistente: ' + str(l.insumo_id));
        must(isInt(l.cantidad) && l.cantidad >= 1 && l.cantidad <= 1000000, 'CANTIDAD_INVALIDA', 'Cantidad inválida para ' + ins.nombre + ' (entero en ' + UNIDADES[ins.unidad] + ').');
        must(!vistos[ins.insumo_id], 'INSUMO_REPETIDO', ins.nombre + ' está dos veces en la receta.'); vistos[ins.insumo_id] = true;
      });
      // Clave fija por producto + opción + insumo: una línea quitada queda con cantidad 0 (no se borran filas).
      var antes = db.all('Recetas').filter(function (r) { return r.producto_id === prod.producto_id && str(r.opcion_id) === op && int(r.cantidad) > 0; });
      var nuevas = {}; lineas.forEach(function (l) { nuevas[str(l.insumo_id)] = l.cantidad; });
      antes.forEach(function (r) { if (!nuevas[r.insumo_id]) db.update('Recetas', r.receta_id, { cantidad: 0 }); });
      lineas.forEach(function (l) {
        var rid = prod.producto_id + '|' + op + '|' + str(l.insumo_id);
        if (db.get('Recetas', rid)) db.update('Recetas', rid, { cantidad: l.cantidad });
        else db.insert('Recetas', { receta_id: rid, producto_id: prod.producto_id, opcion_id: op, insumo_id: str(l.insumo_id), cantidad: l.cantidad });
      });
      audit(user, 'RECETA', 'Productos', prod.producto_id, { opcion: op, antes: antes.map(function (r) { return r.insumo_id + ':' + r.cantidad; }), despues: lineas.map(function (l) { return str(l.insumo_id) + ':' + l.cantidad; }) });
      bumpRev();
      return { producto_id: prod.producto_id, opcion_id: op, lineas: lineas.length };
    }
    function stockDuplicado(reqId) { return db.all('MovStock').some(function (m) { return str(m.request_id).split('#')[0] === reqId; }); }
    function stockCompra(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      if (stockDuplicado(reqId)) return { duplicado: true };
      var items = Array.isArray(p.items) ? p.items : [];
      must(items.length >= 1 && items.length <= 60, 'COMPRA_VACIA', 'Cargá al menos un insumo comprado.');
      var proveedor = cleanText(p.proveedor, 60), total = 0, out = [];
      items.forEach(function (x, i) {
        var ins = db.get('Insumos', str(x.insumo_id));
        must(ins, 'INSUMO_INEXISTENTE', 'Insumo inexistente: ' + str(x.insumo_id));
        must(isInt(x.cantidad) && x.cantidad >= 1 && x.cantidad <= MAX_CANT, 'CANTIDAD_INVALIDA', 'Cantidad inválida para ' + ins.nombre + ' (entero en ' + UNIDADES[ins.unidad] + ').');
        must(isInt(x.costo_total_gs) && x.costo_total_gs >= 0 && x.costo_total_gs <= 1000000000, 'MONTO_INVALIDO', 'Costo inválido para ' + ins.nombre + ' (total pagado en guaraníes).');
        // Costo promedio ponderado: lo que hay (valuado a su costo) + lo comprado. Si el stock estaba en negativo
        // (se vendió sin cargar la compra), el costo nuevo es el de esta compra.
        var hay = Math.max(int(ins.stock), 0), valorHay = costoCant(ins.costo_mil_gs, hay);
        var nuevoCm = divRound((valorHay + x.costo_total_gs) * 1000, hay + x.cantidad);
        db.update('Insumos', ins.insumo_id, { costo_mil_gs: nuevoCm });
        ins.costo_mil_gs = nuevoCm;
        movStock(ins, 'COMPRA', x.cantidad, x.costo_total_gs, { request_id: reqId + '#' + i, referencia: proveedor, motivo: cleanText(p.nota, 120) }, user);
        if (proveedor && !str(ins.proveedor)) db.update('Insumos', ins.insumo_id, { proveedor: proveedor });
        total += x.costo_total_gs;
        out.push(insumoView(db.get('Insumos', ins.insumo_id)));
      });
      audit(user, 'STOCK_COMPRA', 'MovStock', reqId, { proveedor: proveedor, items: items.length, total_gs: total });
      bumpRev();
      return { total_gs: total, insumos: out };
    }
    function stockConteo(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      if (stockDuplicado(reqId)) return { duplicado: true };
      var items = Array.isArray(p.items) ? p.items : [];
      must(items.length >= 1, 'CONTEO_VACIO', 'Indicá al menos un insumo contado.');
      var det = [], valor = 0, vistos = {};
      items.forEach(function (x, i) {
        var ins = db.get('Insumos', str(x.insumo_id));
        must(ins, 'INSUMO_INEXISTENTE', 'Insumo inexistente: ' + str(x.insumo_id));
        must(!vistos[ins.insumo_id], 'INSUMO_REPETIDO', ins.nombre + ' está dos veces en el conteo.'); vistos[ins.insumo_id] = true;
        must(isInt(x.contado) && x.contado >= 0 && x.contado <= MAX_CANT, 'CANTIDAD_INVALIDA', 'Cantidad contada inválida para ' + ins.nombre + ' (entero en ' + UNIDADES[ins.unidad] + ').');
        var esperado = int(ins.stock), dif = x.contado - esperado;
        var c = dif === 0 ? 0 : (dif < 0 ? -1 : 1) * costoCant(ins.costo_mil_gs, Math.abs(dif));
        if (dif !== 0) movStock(ins, 'CONTEO', dif, c, { request_id: reqId + '#' + i, motivo: cleanText(p.nota, 120) }, user);
        valor += c;
        det.push({ insumo_id: ins.insumo_id, nombre: ins.nombre, unidad: ins.unidad, esperado: esperado, contado: x.contado, diferencia: dif, valor_gs: c });
      });
      audit(user, 'STOCK_CONTEO', 'MovStock', reqId, { items: det.length, diferencia_gs: valor, nota: cleanText(p.nota, 120) });
      bumpRev();
      return { detalle: det, diferencia_gs: valor };
    }
    function stockMerma(p, user) {
      requireRole(user, ['ADMIN']); requireStock();
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      if (stockDuplicado(reqId)) return { duplicado: true };
      var ins = db.get('Insumos', str(p.insumo_id));
      must(ins, 'INSUMO_INEXISTENTE', 'Insumo inexistente.', 404);
      must(isInt(p.cantidad) && p.cantidad >= 1 && p.cantidad <= MAX_CANT, 'CANTIDAD_INVALIDA', 'Cantidad inválida (entero en ' + UNIDADES[ins.unidad] + ').');
      var motivo = cleanText(p.motivo, 160);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo (ej.: se venció, se cayó).');
      var c = costoCant(ins.costo_mil_gs, p.cantidad);
      movStock(ins, 'MERMA', -p.cantidad, -c, { request_id: reqId + '#0', motivo: motivo }, user);
      audit(user, 'STOCK_MERMA', 'Insumos', ins.insumo_id, { cantidad: p.cantidad, costo_gs: c, motivo: motivo });
      bumpRev();
      return { insumo: insumoView(db.get('Insumos', ins.insumo_id)), costo_gs: c };
    }
    // Reporte del período: costo de lo vendido, margen por plato, consumo por insumo, mermas y diferencias de conteo.
    function reporteStock(desde, hasta, pedIds, H) {
      var items = H('PedidoItems').filter(function (i) { return pedIds[i.pedido_id]; });
      var vendidas = items.filter(function (i) { return pedIds[i.pedido_id].estado !== 'CANCELADO' && !isTrue(i.anulado); });
      var conCosto = vendidas.filter(function (i) { return i.stock_ok === 'SI' || i.stock_ok === 'DEV'; });
      var porProd = {};
      vendidas.forEach(function (i) {
        var t = porProd[i.producto_id] || (porProd[i.producto_id] = { producto_id: i.producto_id, nombre: i.nombre, cantidad: 0, importe_gs: 0, costo_gs: 0, sin_receta: 0 });
        t.cantidad += int(i.cantidad); t.importe_gs += int(i.total_gs);
        if (i.stock_ok === 'SI') t.costo_gs += int(i.costo_gs); else t.sin_receta += int(i.cantidad);
      });
      var ventasConCosto = conCosto.reduce(function (s0, i) { return s0 + int(i.total_gs); }, 0);
      var costoVentas = conCosto.reduce(function (s0, i) { return s0 + int(i.costo_gs); }, 0);
      // Lo que se preparó y no se cobró (cancelado o anulado después de empezar): consumo sin venta.
      var perdido = items.filter(function (i) { return (pedIds[i.pedido_id].estado === 'CANCELADO' || isTrue(i.anulado)) && i.stock_ok === 'SI'; })
        .reduce(function (s0, i) { return s0 + int(i.costo_gs); }, 0);
      var insIdx = idx(db.all('Insumos'), 'insumo_id');
      var movs = H('MovStock').filter(function (m) { return inRange(m.fecha, desde, hasta); });
      var consumo = {}, mermas = 0, conteo = 0, compras = 0;
      movs.forEach(function (m) {
        if (m.tipo === 'VENTA' || m.tipo === 'DEVOLUCION') {
          var c = consumo[m.insumo_id] || (consumo[m.insumo_id] = { insumo_id: m.insumo_id, nombre: insIdx[m.insumo_id] ? insIdx[m.insumo_id].nombre : m.insumo_id, unidad: insIdx[m.insumo_id] ? insIdx[m.insumo_id].unidad : '', cantidad: 0, costo_gs: 0 });
          c.cantidad -= int(m.cantidad); c.costo_gs -= int(m.costo_gs);
        }
        if (m.tipo === 'MERMA') mermas -= int(m.costo_gs);
        if (m.tipo === 'CONTEO') conteo += int(m.costo_gs);
        if (m.tipo === 'COMPRA') compras += int(m.costo_gs);
      });
      return {
        ventas_con_costo_gs: ventasConCosto, costo_ventas_gs: costoVentas, ganancia_bruta_gs: ventasConCosto - costoVentas,
        margen_pct: ventasConCosto > 0 ? divRound((ventasConCosto - costoVentas) * 100, ventasConCosto) : null,
        lineas_sin_receta: vendidas.filter(function (i) { return i.stock_ok !== 'SI' && i.stock_ok !== 'DEV'; }).reduce(function (s0, i) { return s0 + int(i.cantidad); }, 0),
        productos: Object.keys(porProd).map(function (k) {
          var t = porProd[k]; t.margen_pct = t.sin_receta || !t.importe_gs ? null : divRound((t.importe_gs - t.costo_gs) * 100, t.importe_gs); return t;
        }).sort(function (a, b) { return (b.importe_gs - b.costo_gs) - (a.importe_gs - a.costo_gs); }),
        consumo: Object.keys(consumo).map(function (k) { return consumo[k]; }).filter(function (c) { return c.cantidad; }).sort(function (a, b) { return b.costo_gs - a.costo_gs; }),
        compras_gs: compras, mermas_gs: mermas, diferencia_conteo_gs: conteo, consumo_sin_venta_gs: perdido
      };
    }


    // ---------------------------------------------------------------- carta con IA (todos los planes)
    // La lectura (foto/PDF → propuesta) corre fuera del núcleo (core/carta-ia.js, asíncrona). Acá: permiso, límite
    // diario y la importación de lo que el encargado revisó. Todo lo importado queda POR_VALIDAR.
    var IA_MAX_DIA = 20;
    function claveTxt(s) { s = str(s).toLowerCase(); if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); return s.replace(/[^a-z0-9]+/g, ' ').trim(); }
    function idDesde(nombre, prefijo, tabla) {
      var base = (prefijo || '') + slugEst(nombre).slice(0, 34); if (base.length < 2) base = (prefijo || 'P_') + 'ITEM';
      var id = base, n = 2; while (db.get(tabla, id)) id = base + '_' + (n++);
      return id;
    }
    function cartaIaUso(p, user) {
      requireRole(user, ['ADMIN']);
      var k = 'ia:' + env.dateKey(now()), r = db.get('Contadores', k), usos = (r ? int(r.valor) : 0) + 1;
      must(usos <= IA_MAX_DIA, 'LIMITE_IA', 'Llegaste a las ' + IA_MAX_DIA + ' lecturas de carta de hoy. Probá mañana o cargá los productos a mano.', 429);
      if (r) db.update('Contadores', k, { valor: String(usos) }); else db.insert('Contadores', { clave: k, valor: String(usos) });
      audit(user, 'CARTA_IA_LECTURA', 'Productos', '', { archivos: int(p.archivos), usos_hoy: usos });
      return { usos: usos, max: IA_MAX_DIA, existentes: db.all('Productos').map(function (x) { return x.nombre; }) };
    }
    function importarCarta(p, user) {
      requireRole(user, ['ADMIN']);
      var reqId = str(p.request_id, 80);
      must(reqId.length >= 8, 'REQUEST_ID', 'Falta identificador de solicitud.');
      if (db.get('Contadores', 'imp:' + reqId)) return { duplicado: true };
      var ps = Array.isArray(p.productos) ? p.productos : [];
      must(ps.length >= 1 && ps.length <= 300, 'CARTA_VACIA', 'Elegí de 1 a 300 productos para importar.');
      var puntos = db.all('Puntos').filter(function (x) { return isTrue(x.activo); }).map(function (x) { return x.punto_id; }).join(',');
      var cats = {}; db.all('Categorias').forEach(function (c) { cats[claveTxt(c.nombre)] = c.categoria_id; });
      var ordenCat = db.all('Categorias').reduce(function (m, c) { return Math.max(m, int(c.orden)); }, 0);
      var orden = db.all('Productos').reduce(function (m, x) { return Math.max(m, int(x.orden)); }, 0);
      var existentes = {}; db.all('Productos').forEach(function (x) { existentes[x.categoria_id + '|' + claveTxt(x.nombre)] = true; });
      var nuevasCat = 0, nuevos = 0, omitidos = 0, t = iso(now());
      ps.forEach(function (x) {
        var nombre = cleanText(x && x.nombre, 80);
        must(nombre.length >= 2, 'NOMBRE_INVALIDO', 'Hay un producto sin nombre.');
        var precio = x && x.precio_gs;
        must(isInt(precio) && precio >= 1 && precio <= 10000000, 'PRECIO_INVALIDO', 'Falta el precio (entero en guaraníes) de ' + nombre + '.');
        var cn = cleanText(x && x.categoria, 60) || 'Carta', ck = claveTxt(cn);
        if (!cats[ck]) {
          var cid = idDesde(cn, '', 'Categorias');
          db.insert('Categorias', { categoria_id: cid, nombre: cn, orden: ++ordenCat, activa: 'SI', nota: 'Creada desde la carta con IA', estacion: '' });
          cats[ck] = cid; nuevasCat++;
        }
        var catId = cats[ck];
        if (existentes[catId + '|' + claveTxt(nombre)]) { omitidos++; return; }
        existentes[catId + '|' + claveTxt(nombre)] = true;
        var variantes = cleanText(x && x.variantes, 200);
        db.insert('Productos', {
          producto_id: idDesde(nombre, '', 'Productos'), categoria_id: catId, nombre: nombre, descripcion: cleanText(x && x.descripcion, 300), precio_gs: precio,
          activo: 'SI', disponible: 'SI', puntos: puntos, grupos: '', orden: ++orden, fuente: 'Carta con IA · revisado por ' + user.usuario_id,
          validacion: 'POR_VALIDAR', nota: variantes ? 'Variantes: ' + variantes : '', actualizado_en: t
        });
        nuevos++;
      });
      db.insert('Contadores', { clave: 'imp:' + reqId, valor: String(nuevos) });
      audit(user, 'CARTA_IMPORTADA', 'Productos', '', { productos: nuevos, categorias: nuevasCat, omitidos: omitidos });
      bumpRev();
      return { productos_nuevos: nuevos, categorias_nuevas: nuevasCat, omitidos: omitidos };
    }

    // ---------------------------------------------------------------- plataforma (Ser o Límites)
    // El plan de cada local lo maneja Ser o Límites desde su usuario de plataforma, sin volver a publicar.
    function plataformaEstado(p, user) {
      requirePlataforma(user);
      var l = licenciaPanel();
      return {
        plan: planNombre(), modulos: modulosActivos(), origen: l && PLANES[l.plan] ? 'panel' : (str(env.plan) ? 'despliegue' : 'por_defecto'),
        plan_despliegue: str(env.plan).toUpperCase() || 'BASICO', licencia: l, negocio: cfg('nombre_negocio'), platos_3d: platos3d(), platos_3d_incluidos: PLATOS_3D_INCLUIDOS,
        planes: Object.keys(PLANES).map(function (k) { return { plan: k, modulos: PLANES[k] }; }),
        modulos_info: MODULOS,
        upgrades: UPGRADES.map(function (k) { return { modulo: k, info: MODULOS[k], activo: tieneModulo(k), origen: upgradesPanel().indexOf(k) >= 0 ? 'panel' : (tieneModulo(k) ? 'despliegue' : '') }; }),
        historial: db.all('Auditoria').filter(function (a) { return a.accion === 'LICENCIA'; }).slice(-30).reverse()
      };
    }
    // Reinicio de datos de prueba (después de la capacitación): borra la operación y conserva la configuración del local.
    // Se conservan carta, opciones, mesas y QR, puntos y cajas, usuarios, configuración, licencia, premios del programa y auditoría.
    var TABLAS_REINICIO = ['Pedidos', 'PedidoItems', 'Historial', 'Cuentas', 'Cobros', 'Movimientos', 'Turnos', 'Resenas', 'RecClientes', 'RecCupones', 'RecMovs', 'Contadores', 'MovStock', 'AvisosWA'];
    function plataformaReiniciar(p, user) {
      requirePlataforma(user);
      must(str(p.confirmar) === 'REINICIAR', 'CONFIRMACION', 'Escribí REINICIAR para confirmar.');
      must(typeof db.remove === 'function', 'NO_DISPONIBLE', 'Este servidor no permite reiniciar los datos.', 501);
      var abiertas = db.all('Turnos').filter(function (t) { return t.estado === 'ABIERTO'; }).length;
      must(!abiertas, 'CAJA_ABIERTA', 'Cerrá las cajas antes de reiniciar (' + abiertas + ' abierta/s).', 409);
      var pend = db.all('Cuentas').filter(function (c) { return (c.estado === 'ABIERTA' || c.estado === 'CIERRE_SOLICITADO') && cuentaTotal(c.cuenta_id) > 0; }).length;
      must(!pend, 'CUENTAS_ABIERTAS', 'Hay ' + pend + ' cuenta/s sin cobrar. Cobralas o cancelalas antes de reiniciar.', 409);
      var borrados = {};
      TABLAS_REINICIO.forEach(function (t) { borrados[t] = db.remove(t, function () { return true; }); });
      db.all('Mesas').forEach(function (m) {
        if (str(m.reserva_nombre) || str(m.reserva_hora) || str(m.pagada_en)) { limpiarReserva(m); db.update('Mesas', m.mesa_id, { pagada_en: '' }); }
      });
      // Stock: se conservan insumos, costos y recetas; el stock de la capacitación vuelve a cero (cargar compras o un conteo inicial).
      db.all('Insumos').forEach(function (i) { if (int(i.stock) !== 0) db.update('Insumos', i.insumo_id, { stock: 0 }); });
      audit(user, 'REINICIO_DATOS', 'Config', '', { borrados: borrados, nota: cleanText(p.nota, 200) });
      bumpRev();
      return { ok: true, borrados: borrados };
    }
    // Activa o desactiva un Upgrade (ej. e-Kuatia'i) en este local, sin tocar el plan.
    function plataformaUpgrade(p, user) {
      requirePlataforma(user);
      var m = str(p.modulo).toUpperCase(), on = p.activo === true || str(p.activo).toUpperCase() === 'SI';
      must(UPGRADES.indexOf(m) >= 0, 'MODULO_INVALIDO', 'Upgrade inválido.');
      var lista = upgradesPanel().filter(function (x) { return x !== m; });
      if (on) lista.push(m);
      var antes = tieneModulo(m);
      var v = JSON.stringify(lista);
      if (db.get('Config', '_upgrades')) db.update('Config', '_upgrades', { valor: v }); else db.insert('Config', { clave: '_upgrades', valor: v, descripcion: 'Upgrades contratados aparte, definidos por Ser o Límites (no editable por el local)' });
      audit(user, 'LICENCIA', 'Config', '_upgrades', { antes: m + (antes ? ' activo' : ' inactivo'), despues: m + (tieneModulo(m) ? ' activo' : ' inactivo'), nota: cleanText(p.nota, 200) });
      bumpRev();
      return plataformaEstado(p, user);
    }
    function plataformaPlan(p, user) {
      requirePlataforma(user);
      var plan = str(p.plan).toUpperCase();
      must(!plan || PLANES[plan], 'PLAN_INVALIDO', 'Plan inválido.');
      var antes = planNombre();
      var p3 = p.platos_3d === undefined || p.platos_3d === '' ? '' : int(p.platos_3d);
      must(p3 === '' || (p3 >= 0 && p3 <= 200), 'VALOR_INVALIDO', 'Platos en 3D: de 0 a 200.');
      var v = plan ? JSON.stringify({ plan: plan, nota: cleanText(p.nota, 200), por: user.usuario_id, desde: iso(now()), platos_3d: p3 }) : '';
      if (db.get('Config', '_licencia')) db.update('Config', '_licencia', { valor: v }); else db.insert('Config', { clave: '_licencia', valor: v, descripcion: 'Plan del local definido por Ser o Límites (no editable por el local)' });
      audit(user, 'LICENCIA', 'Config', '_licencia', { antes: antes, despues: (plan || ('despliegue: ' + (str(env.plan) || 'BASICO'))) + (p3 !== '' ? ' · ' + p3 + ' platos 3D' : ''), nota: cleanText(p.nota, 200) });
      bumpRev();
      return plataformaEstado(p, user);
    }

    // ---------------------------------------------------------------- módulo premium: recompensas
    // Tarjeta de sellos digital integrada a la caja. Solo funciona si el despliegue tiene licencia
    // (env.modulos incluye 'RECOMPENSAS') y el local activó el programa (rec_activo = SI).
    var REC_DEFAULTS = {
      rec_activo: ['NO', 'SI: el programa de recompensas está activo para los clientes'],
      rec_nombre: ['Club de clientes', 'Nombre del programa que ve el cliente'],
      rec_minimo_gs: ['20000', 'Compra mínima (Gs.) en un cobro para sumar un sello'],
      rec_un_sello_por_dia: ['SI', 'SI: como máximo un sello por cliente por día'],
      rec_vence_dias: ['60', 'Días de validez de un premio desde que se gana (0 = no vence)'],
      rec_icono: ['cafe', 'Ícono de los sellos: cafe, pizza o estrella'],
      rec_mensaje: ['Sumá un sello en cada visita y ganá premios.', 'Texto corto de la tarjeta'],
      rec_ticket_qr: ['SI', 'SI: el comprobante del cobro y el ticket para llevar imprimen el QR para unirse al club'],
      rec_ticket_mensaje: ['', 'Mensaje propio al pie del comprobante y del ticket para llevar (ej.: Seguinos en @tulocal)']
    };
    // Plan contratado por el local (env.plan) + módulos sueltos (env.modulos). Sin nada = Básico.
    // La licencia que define Ser o Límites desde su panel (Config "_licencia") manda sobre la del despliegue.
    function licenciaPanel() { var r = db.get('Config', '_licencia'); if (!r) return null; try { return JSON.parse(r.valor); } catch (e) { return null; } }
    function planVigente() { var l = licenciaPanel(); return l && PLANES[l.plan] ? l.plan : str(env.plan).toUpperCase(); }
    function upgradesPanel() {
      var r = db.get('Config', '_upgrades'), l = [];
      if (r) { try { l = JSON.parse(r.valor); } catch (e) { l = []; } }
      return (Array.isArray(l) ? l : []).map(function (x) { return str(x).toUpperCase(); }).filter(function (x) { return UPGRADES.indexOf(x) >= 0; });
    }
    function modulosActivos() {
      var plan = planVigente(), out = (PLANES[plan] || []).slice();
      var m = env.modulos; if (typeof m === 'string') m = csv(m.toUpperCase());
      (Array.isArray(m) ? m : []).concat(upgradesPanel()).forEach(function (x) { x = str(x).toUpperCase(); if (MODULOS[x] && out.indexOf(x) < 0) out.push(x); });
      return out;
    }
    function planNombre() {
      var plan = planVigente();
      if (PLANES[plan]) return plan;
      var ms = modulosActivos().filter(function (x) { return UPGRADES.indexOf(x) < 0; }); // los Upgrades no cambian el nombre del plan
      var tiene = function (pl) { return PLANES[pl].every(function (x) { return ms.indexOf(x) >= 0; }) && ms.length === PLANES[pl].length; };
      return tiene('PREMIUM') ? 'PREMIUM' : tiene('GOLD') ? 'GOLD' : ms.length ? 'A_MEDIDA' : 'BASICO';
    }
    function tieneModulo(m) { return modulosActivos().indexOf(m) >= 0; }
    function platos3d() { var l = licenciaPanel(); return l && l.platos_3d !== undefined && l.platos_3d !== '' ? int(l.platos_3d) : PLATOS_3D_INCLUIDOS; }
    function infoPlan() { return { nombre: planNombre(), modulos: modulosActivos(), platos_3d: platos3d(), platos_3d_usados: db.all('Productos').filter(function (x) { return str(x.modelo_3d); }).length }; }
    function licenciaRec() { return tieneModulo('RECOMPENSAS'); }
    function recCfg(k) { var r = db.get('Config', k); return r ? str(r.valor) : (REC_DEFAULTS[k] ? REC_DEFAULTS[k][0] : ''); }
    function recActivo() { return licenciaRec() && isTrue(recCfg('rec_activo')); }
    function requireLicencia() { must(licenciaRec(), 'MODULO_NO_ACTIVO', 'El módulo Recompensas no está contratado en este local.', 403); }
    function requireRec() { requireLicencia(); must(isTrue(recCfg('rec_activo')), 'REC_INACTIVO', 'El programa de recompensas está pausado.', 409); }
    function hoy() { return env.dateKey(now()); }
    function normCel(v) {
      var d = str(v).replace(/[^0-9]/g, '');
      if (/^09\d{8}$/.test(d)) d = '595' + d.slice(1);
      else if (/^9\d{8}$/.test(d)) d = '595' + d;
      return d;
    }
    function celValido(d) { return /^\d{10,15}$/.test(d); }
    function celMask(d) { d = str(d); if (d.indexOf('595') === 0) d = '0' + d.slice(3); return d.length > 6 ? d.slice(0, 4) + ' *** ' + d.slice(-3) : d; }
    function celLocal(d) { d = str(d); return d.indexOf('595') === 0 ? '0' + d.slice(3) : d; }
    function premiosRec(tipo) {
      return db.all('RecPremios').filter(function (x) { return isTrue(x.activo) && (!tipo || x.tipo === tipo); })
        .sort(function (a, b) { return int(a.sellos) - int(b.sellos) || int(a.orden) - int(b.orden); });
    }
    function metaRec() { var l = premiosRec('SELLOS'); return l.length ? int(l[l.length - 1].sellos) : 10; }
    function cuponVigente(cu) { return cu.estado === 'DISPONIBLE' && (!cu.vence_en || cu.vence_en > iso(now())); }
    function cuponesDe(clienteId, soloVigentes) {
      return db.all('RecCupones').filter(function (cu) { return cu.cliente_id === clienteId && (!soloVigentes || cuponVigente(cu)); })
        .sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : 1; });
    }
    function clientePorCel(cel) { return db.all('RecClientes').filter(function (x) { return x.celular === cel; })[0] || null; }
    function buscarCliente(q) {
      q = str(q, 60);
      if (!q) return null;
      var up = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
      var tk = q.replace(/^.*[?&]c=/, '').replace(/[^a-z0-9]/g, '');
      var all = db.all('RecClientes');
      return all.filter(function (x) { return tk.length >= 16 && x.token === tk; })[0] ||
        all.filter(function (x) { return up.length === 6 && x.codigo === up; })[0] ||
        (celValido(normCel(q)) ? clientePorCel(normCel(q)) : null);
    }
    function nuevoCodigo() {
      for (var i = 0; i < 20; i++) {
        var c = env.token(6).toUpperCase();
        if (!db.all('RecClientes').some(function (x) { return x.codigo === c; })) return c;
      }
      fail('ERROR_CODIGO', 'No se pudo generar el código. Reintentá.', 500);
    }
    function cumpleValido(v) {
      v = str(v);
      if (!v) return '';
      var m = /^(\d{1,2})[-\/](\d{1,2})$/.exec(v); // DD/MM o MM-DD (formato interno)
      must(m, 'CUMPLE_INVALIDO', 'Cumpleaños inválido. Usá día/mes.');
      var dd, mm;
      if (v.indexOf('/') >= 0) { dd = int(m[1]); mm = int(m[2]); } else { mm = int(m[1]); dd = int(m[2]); }
      must(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31, 'CUMPLE_INVALIDO', 'Cumpleaños inválido. Usá día/mes.');
      return pad(mm, 2) + '-' + pad(dd, 2);
    }
    function crearCliente(d, origen) {
      var nombre = cleanText(d.nombre, 40);
      must(nombre.length >= 2, 'NOMBRE_REQUERIDO', 'Indicá el nombre.');
      var cel = normCel(d.celular);
      must(celValido(cel), 'CELULAR_INVALIDO', 'Celular inválido. Ejemplo: 0981 123456.');
      must(!clientePorCel(cel), 'YA_REGISTRADO', 'Ese celular ya tiene tarjeta.', 409);
      var c = {
        cliente_id: newId('CLI'), celular: cel, nombre: nombre, cumple: cumpleValido(d.cumple), email: cleanText(d.email, 80).toLowerCase(),
        codigo: nuevoCodigo(), token: env.token(20), sellos: 0, ciclos: 0, visitas: 0, canjes: 0, ultima_visita: '', ultimo_sello_dia: '',
        creado_en: iso(now()), origen: origen, activo: 'SI', nota: ''
      };
      db.insert('RecClientes', c);
      return c;
    }
    function emitirCupon(cli, premio, user, motivo) {
      var dias = int(recCfg('rec_vence_dias'));
      var cu = {
        cupon_id: newId('CUP'), cliente_id: cli.cliente_id, premio_id: premio.premio_id, nombre: premio.nombre, producto_id: str(premio.producto_id),
        valor_gs: int(premio.valor_gs), costo_gs: int(premio.costo_gs), estado: 'DISPONIBLE', creado_en: iso(now()),
        vence_en: dias > 0 ? iso(now() + dias * 86400000) : '', canjeado_en: '', cobro_id: '', usuario_id: user ? user.usuario_id : '', motivo: motivo || ''
      };
      db.insert('RecCupones', cu);
      return cu;
    }
    function movRec(cli, tipo, delta, extra, user) {
      var m = {
        mov_id: newId('RMV'), cliente_id: cli.cliente_id, fecha: iso(now()), tipo: tipo, sellos_delta: delta, sellos_despues: int(db.get('RecClientes', cli.cliente_id).sellos),
        cuenta_id: extra.cuenta_id || '', cobro_id: extra.cobro_id || '', cupon_id: extra.cupon_id || '', caja_id: extra.caja_id || '',
        usuario_id: user ? user.usuario_id : '', detalle: extra.detalle ? JSON.stringify(extra.detalle) : ''
      };
      db.insert('RecMovs', m);
      return m;
    }
    // Premio de cumpleaños: se emite una vez por año si el cumpleaños cae dentro de ±7 días.
    function revisarCumple(cli, user) {
      var pr = premiosRec('CUMPLE')[0];
      if (!pr || !cli.cumple) return null;
      var cerca = false;
      for (var d = -7; d <= 7; d++) if (env.dateKey(now() + d * 86400000).slice(5) === cli.cumple) cerca = true;
      if (!cerca) return null;
      var anio = hoy().slice(0, 4);
      var ya = db.all('RecCupones').some(function (cu) { return cu.cliente_id === cli.cliente_id && cu.premio_id === pr.premio_id && str(cu.creado_en).slice(0, 4) === anio; });
      if (ya) return null;
      var cu = emitirCupon(cli, pr, user, 'Cumpleaños');
      movRec(cli, 'CUMPLE', 0, { cupon_id: cu.cupon_id }, user);
      return cu;
    }
    // Suma un sello. Al llegar a un umbral se emite su premio; al completar la tarjeta, vuelve a 0.
    function darSello(cli, ctx, user) {
      var dia = hoy();
      if (isTrue(recCfg('rec_un_sello_por_dia')) && cli.ultimo_sello_dia === dia) return { sumado: false, motivo: 'Ya sumó su sello de hoy.' };
      var meta = metaRec(), antes = int(cli.sellos), nuevo = antes + 1, nuevos = [], ciclo = false;
      premiosRec('SELLOS').forEach(function (pr) { if (int(pr.sellos) === nuevo) nuevos.push(emitirCupon(cli, pr, user, nuevo + ' sellos')); });
      var upd = { sellos: nuevo, visitas: int(cli.visitas) + 1, ultima_visita: iso(now()), ultimo_sello_dia: dia };
      if (nuevo >= meta) { upd.sellos = 0; upd.ciclos = int(cli.ciclos) + 1; ciclo = true; }
      db.update('RecClientes', cli.cliente_id, upd);
      var m = movRec(cli, 'SELLO', 1, { cuenta_id: ctx.cuenta_id, cobro_id: ctx.cobro_id, caja_id: ctx.caja_id, detalle: { antes: antes, ciclo: ciclo, cupones: nuevos.map(function (x) { return x.cupon_id; }) } }, user);
      return { sumado: true, mov_id: m.mov_id, sellos: nuevo, meta: meta, ciclo_completo: ciclo, cupones_nuevos: nuevos.map(function (x) { return { cupon_id: x.cupon_id, nombre: x.nombre }; }) };
    }
    function valorCupon(cu, items) {
      if (!cu.producto_id) return int(cu.valor_gs);
      var its = items.filter(function (i) { return i.producto_id === cu.producto_id; });
      if (!its.length) return -1; // el producto no está en la cuenta
      var unit = Math.max.apply(null, its.map(function (i) { return int(i.precio_unit_gs); }));
      var prod = db.get('Productos', cu.producto_id), base = prod ? int(prod.precio_gs) : unit;
      return Math.min(unit, base || unit);
    }
    function clienteView(cli, opts) {
      opts = opts || {};
      var meta = metaRec(), dia = hoy();
      var v = {
        cliente_id: cli.cliente_id, nombre: cli.nombre, celular: opts.completo ? celLocal(cli.celular) : celMask(cli.celular), codigo: cli.codigo,
        sellos: int(cli.sellos), meta: meta, ciclos: int(cli.ciclos), visitas: int(cli.visitas), canjes: int(cli.canjes),
        ultima_visita: cli.ultima_visita, sello_hoy: cli.ultimo_sello_dia === dia && isTrue(recCfg('rec_un_sello_por_dia')),
        cumple: cli.cumple, activo: isTrue(cli.activo),
        premios: premiosRec('SELLOS').map(function (pr) { return { sellos: int(pr.sellos), nombre: pr.nombre }; }),
        cupones: cuponesDe(cli.cliente_id, true).map(function (cu) { return { cupon_id: cu.cupon_id, nombre: cu.nombre, producto_id: cu.producto_id, valor_gs: int(cu.valor_gs), vence_en: cu.vence_en }; })
      };
      if (opts.token) v.token = cli.token;
      if (opts.completo) { v.email = cli.email; v.creado_en = cli.creado_en; v.origen = cli.origen; v.nota = cli.nota; }
      return v;
    }
    function programaView() {
      return {
        nombre: recCfg('rec_nombre'), mensaje: recCfg('rec_mensaje'), icono: recCfg('rec_icono'), minimo_gs: int(recCfg('rec_minimo_gs')),
        un_sello_por_dia: isTrue(recCfg('rec_un_sello_por_dia')), vence_dias: int(recCfg('rec_vence_dias')), meta: metaRec(), negocio: cfg('nombre_negocio'),
        premios: premiosRec('SELLOS').map(function (pr) { return { sellos: int(pr.sellos), nombre: pr.nombre }; }),
        cumple: (premiosRec('CUMPLE')[0] || {}).nombre || ''
      };
    }
    function recEstadoSync() {
      if (!recActivo()) return null;
      var pr = premiosRec('SELLOS').map(function (x) { return int(x.sellos) + ' sellos: ' + x.nombre; });
      return { activo: true, nombre: recCfg('rec_nombre'), minimo_gs: int(recCfg('rec_minimo_gs')), icono: recCfg('rec_icono'),
        // Pie de los tickets que se lleva el cliente (Premium): QR del club y mensaje propio del local.
        ticket: { qr: isTrue(recCfg('rec_ticket_qr')), mensaje: recCfg('rec_ticket_mensaje'), premio: pr[0] || '' } };
    }

    // ---- público
    function publicRecInfo(p) {
      must(recActivo(), 'NO_DISPONIBLE', 'Este local no tiene programa de recompensas activo.', 404);
      var out = { programa: programaView() };
      var tk = str(p.token, 40);
      if (tk) {
        var cli = db.all('RecClientes').filter(function (x) { return x.token === tk && isTrue(x.activo); })[0];
        must(cli, 'TARJETA_INVALIDA', 'No encontramos esta tarjeta.', 404);
        out.tarjeta = clienteView(cli, { token: true });
        out.historial = db.all('RecMovs').filter(function (m) { return m.cliente_id === cli.cliente_id; }).slice(-12).reverse()
          .map(function (m) { return { fecha: m.fecha, tipo: m.tipo, sellos: int(m.sellos_delta) }; });
        out.canjeados = cuponesDe(cli.cliente_id, false).filter(function (cu) { return cu.estado === 'CANJEADO'; }).slice(-5).reverse()
          .map(function (cu) { return { nombre: cu.nombre, canjeado_en: cu.canjeado_en }; });
      }
      return out;
    }
    function primerNombre(s) { return str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0]; }
    function publicRecJoin(p) {
      must(recActivo(), 'NO_DISPONIBLE', 'Este local no tiene programa de recompensas activo.', 404);
      must(p.acepta === true, 'ACEPTA_REQUERIDO', 'Para sumarte tenés que aceptar que guardemos tus datos para el programa.');
      rateLimit('rec:join', 60, 600);
      var cel = normCel(p.celular);
      must(celValido(cel), 'CELULAR_INVALIDO', 'Celular inválido. Ejemplo: 0981 123456.');
      var ex = clientePorCel(cel);
      if (ex) {
        // Recuperar la tarjeta: solo si el nombre coincide (evita ver la tarjeta de otro con solo su número).
        must(isTrue(ex.activo) && primerNombre(ex.nombre) === primerNombre(p.nombre), 'YA_REGISTRADO', 'Ese celular ya tiene tarjeta. Pedí ayuda en caja para recuperarla.', 409);
        return { tarjeta: clienteView(ex, { token: true }), existente: true };
      }
      var cli = crearCliente(p, 'WEB');
      movRec(cli, 'ALTA', 0, {}, null);
      return { tarjeta: clienteView(db.get('RecClientes', cli.cliente_id), { token: true }), existente: false };
    }
    // Vincula un pedido QR a la tarjeta del cliente (si el cliente dio su celular).
    function vincularPorCelular(cuenta, celular, nombre, unirse) {
      if (!recActivo() || !str(celular)) return null;
      var cel = normCel(celular);
      if (!celValido(cel)) return null;
      var cli = clientePorCel(cel);
      if (!cli && unirse && cleanText(nombre, 40).length >= 2) { cli = crearCliente({ nombre: nombre, celular: cel }, 'QR'); movRec(cli, 'ALTA', 0, { cuenta_id: cuenta.cuenta_id }, null); }
      if (!cli || !isTrue(cli.activo)) return null;
      db.update('Cuentas', cuenta.cuenta_id, { cliente_id: cli.cliente_id });
      return cli;
    }

    // ---- personal
    function recBuscar(p, user) {
      requireRole(user, ['ADMIN', 'CAJA', 'MOZO']);
      requireRec();
      var cli = buscarCliente(p.q);
      if (!cli) return { encontrado: false };
      must(isTrue(cli.activo), 'CLIENTE_INACTIVO', 'Esta tarjeta está dada de baja.', 409);
      var cu = revisarCumple(cli, user);
      if (cu) bumpRev();
      return { encontrado: true, cliente: clienteView(db.get('RecClientes', cli.cliente_id)), cumple_nuevo: !!cu, programa: programaView() };
    }
    function recRegistrar(p, user) {
      requireRole(user, ['ADMIN', 'CAJA', 'MOZO']);
      requireRec();
      var ex = clientePorCel(normCel(p.celular));
      if (ex) return { cliente: clienteView(ex), existente: true, link_token: ex.token };
      var cli = crearCliente(p, 'CAJA');
      movRec(cli, 'ALTA', 0, {}, user);
      audit(user, 'REC_ALTA', 'RecClientes', cli.cliente_id, { origen: 'CAJA' });
      return { cliente: clienteView(cli), existente: false, link_token: cli.token };
    }
    function recVincular(p, user) {
      requireRole(user, ['ADMIN', 'CAJA', 'MOZO']);
      requireRec();
      var c = db.get('Cuentas', str(p.cuenta_id));
      must(c && c.estado !== 'CERRADA' && c.estado !== 'ANULADA', 'CUENTA_INVALIDA', 'La cuenta no está abierta.', 409);
      var id = str(p.cliente_id);
      if (id) must(db.get('RecClientes', id), 'CLIENTE_INEXISTENTE', 'Cliente inexistente.', 404);
      db.update('Cuentas', c.cuenta_id, { cliente_id: id });
      bumpRev();
      return { cuenta: cuentaView(db.get('Cuentas', c.cuenta_id)) };
    }
    // Aplica canjes y sello dentro de un cobro. Devuelve el descuento por premios y una función para terminar tras crear el cobro.
    function recEnCobro(c, p, total0, sel) {
      var r = p.recompensa;
      if (r === undefined && c.cliente_id && !sel) r = { cliente_id: c.cliente_id, sello: true };
      if (!r || !str(r.cliente_id)) return null;
      requireRec();
      var cli = db.get('RecClientes', str(r.cliente_id));
      must(cli && isTrue(cli.activo), 'CLIENTE_INEXISTENTE', 'Tarjeta inexistente o dada de baja.', 404);
      var items = itemsCuenta(c.cuenta_id), usados = {}, desc = 0, canjes = [];
      (Array.isArray(r.cupones) ? r.cupones : []).forEach(function (id) {
        id = str(id);
        must(!usados[id], 'CUPON_INVALIDO', 'Premio repetido.');
        usados[id] = true;
        var cu = db.get('RecCupones', id);
        must(cu && cu.cliente_id === cli.cliente_id, 'CUPON_INVALIDO', 'Ese premio no es de este cliente.');
        must(cuponVigente(cu), 'CUPON_INVALIDO', 'El premio "' + (cu ? cu.nombre : '') + '" ya fue usado o venció.', 409);
        var prod = cu.producto_id ? db.get('Productos', cu.producto_id) : null;
        var val = valorCupon(cu, items);
        must(val >= 0, 'PREMIO_SIN_PRODUCTO', 'Para canjear "' + cu.nombre + '" agregá ' + (prod ? prod.nombre : 'ese producto') + ' a la cuenta.', 409);
        canjes.push({ cu: cu, valor: val });
        desc += val;
      });
      desc = Math.min(desc, total0);
      return { cli: cli, sello: r.sello !== false, desc: desc, canjes: canjes };
    }
    function recCerrarCobro(rc, c, cobro, user) {
      var cli = db.get('RecClientes', rc.cli.cliente_id), out = { cliente_id: cli.cliente_id, nombre: cli.nombre, descuento_gs: rc.desc, cupones_canjeados: [], sello: false };
      rc.canjes.forEach(function (x) {
        db.update('RecCupones', x.cu.cupon_id, { estado: 'CANJEADO', canjeado_en: cobro.fecha, cobro_id: cobro.cobro_id, usuario_id: user.usuario_id });
        movRec(cli, 'CANJE', 0, { cuenta_id: c.cuenta_id, cobro_id: cobro.cobro_id, cupon_id: x.cu.cupon_id, caja_id: c.caja_id, detalle: { valor_gs: x.valor } }, user);
        out.cupones_canjeados.push(x.cu.cupon_id);
      });
      if (rc.canjes.length) db.update('RecClientes', cli.cliente_id, { canjes: int(cli.canjes) + rc.canjes.length });
      var minimo = int(recCfg('rec_minimo_gs'));
      if (rc.sello) {
        if (int(cobro.total_gs) < minimo) out.motivo = 'No llega a la compra mínima de Gs. ' + minimo + '.';
        else {
          var s = darSello(db.get('RecClientes', cli.cliente_id), { cuenta_id: c.cuenta_id, cobro_id: cobro.cobro_id, caja_id: c.caja_id }, user);
          out.sello = s.sumado; if (!s.sumado) out.motivo = s.motivo;
          if (s.sumado) { out.mov_id = s.mov_id; out.sellos = s.sellos; out.meta = s.meta; out.ciclo_completo = s.ciclo_completo; out.cupones_nuevos = s.cupones_nuevos; }
        }
      }
      if (!out.sello) { out.sellos = int(db.get('RecClientes', cli.cliente_id).sellos); out.meta = metaRec(); }
      db.update('Cobros', cobro.cobro_id, { recompensa: JSON.stringify({ cliente_id: out.cliente_id, sello: out.sello, mov_id: out.mov_id || '', descuento_gs: out.descuento_gs, cupones_canjeados: out.cupones_canjeados, cupones_nuevos: (out.cupones_nuevos || []).map(function (x) { return x.cupon_id; }) }) });
      return out;
    }
    function recRevertirCobro(cobro, user, motivo) {
      if (!str(cobro.recompensa)) return;
      var r; try { r = JSON.parse(cobro.recompensa); } catch (e) { return; }
      var cli = db.get('RecClientes', r.cliente_id);
      if (!cli) return;
      (r.cupones_canjeados || []).forEach(function (id) { if (db.get('RecCupones', id)) db.update('RecCupones', id, { estado: 'DISPONIBLE', canjeado_en: '', cobro_id: '' }); });
      var upd = {};
      if ((r.cupones_canjeados || []).length) upd.canjes = Math.max(0, int(cli.canjes) - r.cupones_canjeados.length);
      if (r.sello) {
        var mov = db.get('RecMovs', r.mov_id), det = {}; try { det = JSON.parse(mov.detalle); } catch (e) { }
        upd.sellos = det.ciclo ? metaRec() - 1 : Math.max(0, int(cli.sellos) - 1);
        if (det.ciclo) upd.ciclos = Math.max(0, int(cli.ciclos) - 1);
        upd.visitas = Math.max(0, int(cli.visitas) - 1);
        if (cli.ultimo_sello_dia === hoy()) upd.ultimo_sello_dia = '';
        (r.cupones_nuevos || []).forEach(function (id) { var cu = db.get('RecCupones', id); if (cu && cu.estado === 'DISPONIBLE') db.update('RecCupones', id, { estado: 'ANULADO', motivo: 'Cobro revertido' }); });
      }
      db.update('RecClientes', cli.cliente_id, upd);
      movRec(cli, 'REVERSO', r.sello ? -1 : 0, { cobro_id: cobro.cobro_id, caja_id: cobro.caja_id, detalle: { motivo: motivo } }, user);
    }

    // ---- administración
    function recAdmin(p, user) {
      requireRole(user, ['ADMIN']);
      if (!licenciaRec()) return { licencia: false };
      var clientes = db.all('RecClientes'), cupones = db.all('RecCupones'), movs = db.all('RecMovs');
      var hace30 = iso(now() - 30 * 86400000), mes = hoy().slice(5, 7);
      var porCli = {};
      cupones.forEach(function (cu) { if (cuponVigente(cu)) porCli[cu.cliente_id] = (porCli[cu.cliente_id] || 0) + 1; });
      var cobrosClub = (db.history ? db.history('Cobros') : db.all('Cobros')).filter(function (c) { return c.estado === 'VALIDO' && str(c.recompensa) && c.fecha >= hace30; });
      var activos = clientes.filter(function (c) { return isTrue(c.activo); });
      var conVisita = activos.filter(function (c) { return int(c.visitas) + int(c.ciclos) > 0; });
      var recurrentes = activos.filter(function (c) { return int(c.visitas) >= 2; });
      var canjeados = cupones.filter(function (cu) { return cu.estado === 'CANJEADO'; });
      return {
        licencia: true,
        config: Object.keys(REC_DEFAULTS).map(function (k) { return { clave: k, valor: recCfg(k), descripcion: REC_DEFAULTS[k][1] }; }),
        premios: db.all('RecPremios').sort(function (a, b) { return (a.tipo === b.tipo ? 0 : a.tipo === 'SELLOS' ? -1 : 1) || int(a.sellos) - int(b.sellos); }),
        programa: programaView(),
        stats: {
          clientes: activos.length, con_visita: conVisita.length, recurrentes: recurrentes.length,
          tasa_retorno: conVisita.length ? Math.round(recurrentes.length / conVisita.length * 100) : 0,
          sellos_30d: movs.filter(function (m) { return m.tipo === 'SELLO' && m.fecha >= hace30; }).length,
          altas_30d: activos.filter(function (c) { return c.creado_en >= hace30; }).length,
          cupones_emitidos: cupones.filter(function (cu) { return cu.estado !== 'ANULADO'; }).length,
          cupones_canjeados: canjeados.length, cupones_disponibles: cupones.filter(cuponVigente).length,
          costo_premios_gs: canjeados.reduce(function (s, cu) { return s + int(cu.costo_gs); }, 0),
          ventas_club_30d_gs: cobrosClub.reduce(function (s, c) { return s + int(c.total_gs); }, 0),
          cobros_club_30d: cobrosClub.length
        },
        cumples_mes: activos.filter(function (c) { return str(c.cumple).slice(0, 2) === mes; }).map(function (c) { return { nombre: c.nombre, cumple: c.cumple, celular: celLocal(c.celular) }; })
          .sort(function (a, b) { return a.cumple < b.cumple ? -1 : 1; }),
        clientes: clientes.map(function (c) { var v = clienteView(c, { completo: true }); v.cupones_n = porCli[c.cliente_id] || 0; delete v.cupones; delete v.premios; return v; })
          .sort(function (a, b) { return int(b.visitas) - int(a.visitas) || (a.nombre < b.nombre ? -1 : 1); })
      };
    }
    function recConfig(p, user) {
      requireRole(user, ['ADMIN']);
      requireLicencia();
      var cambios = {};
      Object.keys(p.config || {}).forEach(function (k) {
        must(REC_DEFAULTS[k], 'CLAVE_INVALIDA', 'Configuración no editable: ' + k);
        var v = cleanText(p.config[k], 200);
        if (k === 'rec_minimo_gs' || k === 'rec_vence_dias') { must(/^\d{1,9}$/.test(v), 'VALOR_INVALIDO', 'Valor numérico inválido.'); v = String(int(v)); }
        if (k === 'rec_ticket_mensaje') v = cleanText(p.config[k], 120);
        if (k === 'rec_activo' || k === 'rec_un_sello_por_dia' || k === 'rec_ticket_qr') { must(v === 'SI' || v === 'NO', 'VALOR_INVALIDO', 'Usá SI o NO.'); }
        if (k === 'rec_icono') must(['cafe', 'pizza', 'estrella'].indexOf(v) >= 0, 'VALOR_INVALIDO', 'Ícono inválido.');
        if (k === 'rec_nombre') must(v.length >= 3, 'VALOR_INVALIDO', 'Nombre muy corto.');
        cambios[k] = v;
      });
      if (Array.isArray(p.premios)) {
        must(p.premios.length <= 12, 'VALOR_INVALIDO', 'Máximo 12 premios.');
        var vistos = {}, guardados = {}, cumples = 0;
        p.premios.forEach(function (x, i) {
          var tipo = str(x.tipo || 'SELLOS').toUpperCase();
          must(tipo === 'SELLOS' || tipo === 'CUMPLE', 'VALOR_INVALIDO', 'Tipo de premio inválido.');
          var act = x.activo !== false, n = int(x.sellos);
          if (tipo === 'SELLOS') {
            must(n >= 1 && n <= 30, 'VALOR_INVALIDO', 'Los sellos de un premio van de 1 a 30.');
            if (act) { must(!vistos[n], 'VALOR_INVALIDO', 'Hay dos premios con ' + n + ' sellos.'); vistos[n] = true; }
          } else if (act) { cumples++; must(cumples <= 1, 'VALOR_INVALIDO', 'Solo puede haber un premio de cumpleaños activo.'); }
          var nombre = cleanText(x.nombre, 60);
          must(nombre.length >= 2, 'VALOR_INVALIDO', 'Cada premio necesita un nombre.');
          var pid = str(x.producto_id);
          if (pid) must(db.get('Productos', pid), 'PRODUCTO_INVALIDO', 'Producto inexistente: ' + pid);
          must(pid || int(x.valor_gs) > 0, 'VALOR_INVALIDO', 'El premio "' + nombre + '" necesita un producto de la carta o un valor en Gs.');
          var id = str(x.premio_id);
          if (id) must(db.get('RecPremios', id), 'VALOR_INVALIDO', 'Premio inexistente.');
          var row = { premio_id: id || newId('PRM'), tipo: tipo, sellos: tipo === 'SELLOS' ? n : 0, nombre: nombre, producto_id: pid, valor_gs: Math.max(0, int(x.valor_gs)), costo_gs: Math.max(0, int(x.costo_gs)), activo: act ? 'SI' : 'NO', orden: i };
          if (id) db.update('RecPremios', id, row); else db.insert('RecPremios', row);
          guardados[row.premio_id] = true;
        });
        db.all('RecPremios').forEach(function (r) { if (!guardados[r.premio_id] && isTrue(r.activo)) db.update('RecPremios', r.premio_id, { activo: 'NO' }); });
      }
      var activa = cambios.rec_activo !== undefined ? cambios.rec_activo === 'SI' : isTrue(recCfg('rec_activo'));
      if (activa) must(premiosRec('SELLOS').length > 0, 'SIN_PREMIOS', 'Cargá al menos un premio por sellos antes de activar el programa.', 409);
      Object.keys(cambios).forEach(function (k) {
        if (db.get('Config', k)) db.update('Config', k, { valor: cambios[k] }); else db.insert('Config', { clave: k, valor: cambios[k], descripcion: REC_DEFAULTS[k][1] });
      });
      audit(user, 'REC_CONFIG', 'Config', 'recompensas', { config: cambios, premios: Array.isArray(p.premios) ? p.premios.length : null });
      bumpRev();
      return { programa: programaView() };
    }
    function recCliente(p, user) {
      requireRole(user, ['ADMIN']);
      requireLicencia();
      var cli = db.get('RecClientes', str(p.cliente_id));
      must(cli, 'CLIENTE_INEXISTENTE', 'Cliente inexistente.', 404);
      var upd = {};
      if (p.nombre !== undefined) { upd.nombre = cleanText(p.nombre, 40); must(upd.nombre.length >= 2, 'NOMBRE_REQUERIDO', 'Indicá el nombre.'); }
      if (p.cumple !== undefined) upd.cumple = cumpleValido(p.cumple);
      if (p.email !== undefined) upd.email = cleanText(p.email, 80).toLowerCase();
      if (p.nota !== undefined) upd.nota = cleanText(p.nota, 200);
      if (p.activo !== undefined) upd.activo = p.activo ? 'SI' : 'NO';
      if (p.celular !== undefined) {
        var cel = normCel(p.celular);
        must(celValido(cel), 'CELULAR_INVALIDO', 'Celular inválido.');
        var otro = clientePorCel(cel); must(!otro || otro.cliente_id === cli.cliente_id, 'YA_REGISTRADO', 'Ese celular ya es de otra tarjeta.', 409);
        upd.celular = cel;
      }
      if (p.ajuste_sellos !== undefined) {
        var d = int(p.ajuste_sellos), motivo = cleanText(p.motivo, 200);
        must(d !== 0 && Math.abs(d) <= 30, 'VALOR_INVALIDO', 'Ajuste inválido.');
        must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo del ajuste.');
        upd.sellos = Math.max(0, Math.min(metaRec() - 1, int(cli.sellos) + d));
      }
      if (p.nuevo_token) { upd.token = env.token(20); upd.codigo = nuevoCodigo(); }
      db.update('RecClientes', cli.cliente_id, upd);
      if (upd.sellos !== undefined) movRec(cli, 'AJUSTE', upd.sellos - int(cli.sellos), { detalle: { motivo: cleanText(p.motivo, 200) } }, user);
      audit(user, 'REC_CLIENTE', 'RecClientes', cli.cliente_id, Object.keys(upd));
      return { cliente: clienteView(db.get('RecClientes', cli.cliente_id), { completo: true }) };
    }
    function recClienteDetalle(p, user) {
      requireRole(user, ['ADMIN']);
      requireLicencia();
      var cli = db.get('RecClientes', str(p.cliente_id));
      must(cli, 'CLIENTE_INEXISTENTE', 'Cliente inexistente.', 404);
      return {
        cliente: clienteView(cli, { completo: true, token: true }),
        cupones: cuponesDe(cli.cliente_id, false).reverse(),
        movimientos: db.all('RecMovs').filter(function (m) { return m.cliente_id === cli.cliente_id; }).slice(-50).reverse()
      };
    }
    function recCuponAnular(p, user) {
      requireRole(user, ['ADMIN']);
      requireLicencia();
      var cu = db.get('RecCupones', str(p.cupon_id));
      must(cu && cu.estado === 'DISPONIBLE', 'CUPON_INVALIDO', 'Ese premio no está disponible.', 409);
      var motivo = cleanText(p.motivo, 200);
      must(motivo.length >= 3, 'MOTIVO_REQUERIDO', 'Indicá el motivo.');
      db.update('RecCupones', cu.cupon_id, { estado: 'ANULADO', motivo: motivo, usuario_id: user.usuario_id });
      audit(user, 'REC_CUPON_ANULADO', 'RecCupones', cu.cupon_id, motivo);
      return { ok: true };
    }

    // ---------------------------------------------------------------- módulo gold: reseñas
    // Encuesta interna después del pedido (llega solo al local) + invitación a reseñar en Google para TODOS,
    // sin condicionarla a la nota ni premiarla (las reglas de Google prohíben incentivar o filtrar reseñas).
    var RES_DEFAULTS = {
      res_google_url: ['', 'Link de Google para escribir una reseña (Google Business Profile → Pedir reseñas)'],
      res_pregunta: ['¿Cómo estuvo tu visita?', 'Pregunta que ve el cliente'],
      res_sello_encuesta: ['NO', 'Solo Premium. SI: responder la encuesta interna suma un sello extra (máximo uno por día). Nunca por reseñas de Google']
    };
    function resCfg(k) { var r = db.get('Config', k); return r ? str(r.valor) : (RES_DEFAULTS[k] ? RES_DEFAULTS[k][0] : ''); }
    function requireRes() { must(tieneModulo('RESENAS'), 'MODULO_NO_ACTIVO', 'El módulo Reseñas no está contratado en este local.', 403); }
    function resInfoBase() { return { pregunta: resCfg('res_pregunta'), google_url: resCfg('res_google_url'), negocio: cfg('nombre_negocio') }; }
    function mozoDe(peds) {
      var c = peds.filter(function (x) { return x.creado_por && x.creado_por !== 'PUBLICO'; }).sort(function (a, b) { return a.creado_en < b.creado_en ? 1 : -1; })[0];
      return c ? c.creado_por : '';
    }
    // Contexto de la encuesta: por pedido (status_token del cliente) o por QR de mesa o de para llevar.
    function resContexto(p) {
      var st = str(p.status_token, 40);
      if (st) {
        var ped = db.all('Pedidos').filter(function (x) { return x.status_token === st; })[0];
        must(ped, 'NO_ENCONTRADO', 'Pedido no encontrado.', 404);
        var c = db.get('Cuentas', ped.cuenta_id);
        var peds = db.all('Pedidos').filter(function (x) { return x.cuenta_id === ped.cuenta_id; });
        var mozo = (ped.creado_por !== 'PUBLICO' ? ped.creado_por : '') || mozoDe(peds);
        return { clave: 'P:' + ped.pedido_id, pedido_id: ped.pedido_id, cuenta_id: ped.cuenta_id, punto_id: ped.punto_id, mesa_id: ped.mesa_id, mozo_id: mozo, cliente_id: c ? str(c.cliente_id) : '', canal: 'PEDIDO' };
      }
      var r = resolveToken(p.token);
      var hoy0 = env.dateKey(now());
      var pedsMesa = r.mesa_id ? db.all('Pedidos').filter(function (x) { return x.mesa_id === r.mesa_id && x.fecha === hoy0; }) : [];
      var ultimo = pedsMesa.sort(function (a, b) { return a.creado_en < b.creado_en ? 1 : -1; })[0];
      var cu = ultimo ? db.get('Cuentas', ultimo.cuenta_id) : null;
      return { clave: '', pedido_id: '', cuenta_id: ultimo ? ultimo.cuenta_id : '', punto_id: r.punto_id, mesa_id: r.mesa_id || '', mozo_id: mozoDe(pedsMesa), cliente_id: cu ? str(cu.cliente_id) : '', canal: 'QR' };
    }
    function publicResenaInfo(p) {
      must(tieneModulo('RESENAS'), 'NO_DISPONIBLE', 'No disponible.', 404);
      var ctx = resContexto(p), out = resInfoBase();
      out.ya_respondio = !!(ctx.clave && db.all('Resenas').some(function (x) { return x.clave === ctx.clave; }));
      out.mesa = ctx.mesa_id ? mesaNombre(ctx.mesa_id) : '';
      return out;
    }
    function publicResena(p) {
      must(tieneModulo('RESENAS'), 'NO_DISPONIBLE', 'No disponible.', 404);
      var ctx = resContexto(p);
      var n = int(p.estrellas);
      must(n >= 1 && n <= 5, 'ESTRELLAS_INVALIDAS', 'Elegí de 1 a 5 estrellas.');
      var reqId = str(p.request_id, 80);
      var prev = db.all('Resenas').filter(function (x) { return (reqId && x.request_id === reqId) || (ctx.clave && x.clave === ctx.clave); })[0];
      if (prev) return { resena_id: prev.resena_id, duplicado: true, google_url: resCfg('res_google_url') };
      rateLimit('res:' + (str(p.token) || 'pedido'), 30, 600);
      rateLimit('res:global', 200, 600);
      var row = {
        resena_id: newId('RES'), request_id: reqId, clave: ctx.clave, fecha: iso(now()), pedido_id: ctx.pedido_id, cuenta_id: ctx.cuenta_id, punto_id: ctx.punto_id, mesa_id: ctx.mesa_id,
        mozo_id: ctx.mozo_id, cliente_id: ctx.cliente_id, estrellas: n, comentario: cleanText(p.comentario, 500), canal: ctx.canal, google_click: '', leida: 'NO', nota: '', sello: ''
      };
      db.insert('Resenas', row);
      var out = { resena_id: row.resena_id, duplicado: false, google_url: resCfg('res_google_url') };
      // Premium (opcional): la encuesta interna suma un sello extra al cliente vinculado, máximo uno por día.
      if (ctx.cliente_id && recActivo() && isTrue(resCfg('res_sello_encuesta'))) {
        var cli = db.get('RecClientes', ctx.cliente_id), dia = hoy();
        if (cli && isTrue(cli.activo) && cli.ultimo_bonus_dia !== dia) {
          var meta = metaRec(), nuevo = int(cli.sellos) + 1, nuevos = [];
          premiosRec('SELLOS').forEach(function (pr) { if (int(pr.sellos) === nuevo) nuevos.push(emitirCupon(cli, pr, null, nuevo + ' sellos')); });
          var upd = { sellos: nuevo >= meta ? 0 : nuevo, ultimo_bonus_dia: dia };
          if (nuevo >= meta) upd.ciclos = int(cli.ciclos) + 1;
          db.update('RecClientes', cli.cliente_id, upd);
          movRec(cli, 'ENCUESTA', 1, { cuenta_id: ctx.cuenta_id, detalle: { resena_id: row.resena_id, cupones: nuevos.map(function (x) { return x.cupon_id; }) } }, null);
          db.update('Resenas', row.resena_id, { sello: 'SI' });
          out.sello = { sellos: nuevo, meta: meta, cupones_nuevos: nuevos.map(function (x) { return x.nombre; }) };
        }
      }
      return out;
    }
    function publicResenaGoogle(p) {
      must(tieneModulo('RESENAS'), 'NO_DISPONIBLE', 'No disponible.', 404);
      var r = db.get('Resenas', str(p.resena_id));
      if (r && !r.google_click) db.update('Resenas', r.resena_id, { google_click: iso(now()) });
      else if (!r) { rateLimit('res:gclick', 300, 600); db.insert('Resenas', { resena_id: newId('RES'), request_id: '', clave: '', fecha: iso(now()), pedido_id: '', cuenta_id: '', punto_id: '', mesa_id: '', mozo_id: '', cliente_id: '', estrellas: 0, comentario: '', canal: 'SOLO_GOOGLE', google_click: iso(now()), leida: 'SI', nota: '', sello: '' }); }
      return { ok: true };
    }
    function resAdmin(p, user) {
      requireRole(user, ['ADMIN']);
      if (!tieneModulo('RESENAS')) return { licencia: false };
      var all = db.all('Resenas'), conNota = all.filter(function (r) { return int(r.estrellas) > 0; });
      var hace30 = iso(now() - 30 * 86400000), r30 = conNota.filter(function (r) { return r.fecha >= hace30; });
      var dist = [0, 0, 0, 0, 0]; conNota.forEach(function (r) { dist[int(r.estrellas) - 1]++; });
      var prom = function (l) { return l.length ? Math.round(l.reduce(function (s, r) { return s + int(r.estrellas); }, 0) / l.length * 10) / 10 : 0; };
      var porMozo = {};
      conNota.forEach(function (r) { if (!r.mozo_id) return; (porMozo[r.mozo_id] = porMozo[r.mozo_id] || []).push(r); });
      var nombres = idx(db.all('Usuarios'), 'usuario_id');
      return {
        licencia: true,
        config: Object.keys(RES_DEFAULTS).filter(function (k) { return k !== 'res_sello_encuesta' || licenciaRec(); }).map(function (k) { return { clave: k, valor: resCfg(k), descripcion: RES_DEFAULTS[k][1] }; }),
        stats: {
          total: conNota.length, promedio: prom(conNota), promedio_30d: prom(r30), total_30d: r30.length, distribucion: dist,
          sin_leer_bajas: conNota.filter(function (r) { return int(r.estrellas) <= 3 && !isTrue(r.leida); }).length,
          clics_google: all.filter(function (r) { return r.google_click; }).length
        },
        por_mozo: Object.keys(porMozo).map(function (k) { return { mozo_id: k, nombre: nombres[k] ? nombres[k].nombre : k, total: porMozo[k].length, promedio: prom(porMozo[k]) }; }).sort(function (a, b) { return b.total - a.total; }),
        resenas: conNota.slice(-300).reverse().map(function (r) {
          var cli = r.cliente_id && licenciaRec() ? db.get('RecClientes', r.cliente_id) : null;
          return { resena_id: r.resena_id, fecha: r.fecha, estrellas: int(r.estrellas), comentario: r.comentario, mesa: r.mesa_id ? mesaNombre(r.mesa_id) : (r.punto_id === 'B_TAKEAWAY' ? 'Para llevar' : ''), mozo: r.mozo_id ? (nombres[r.mozo_id] ? nombres[r.mozo_id].nombre : r.mozo_id) : '', cliente: cli ? cli.nombre : '', google: !!r.google_click, leida: isTrue(r.leida), nota: r.nota, canal: r.canal };
        })
      };
    }
    function resConfig(p, user) {
      requireRole(user, ['ADMIN']);
      requireRes();
      var c = p.config || {};
      Object.keys(c).forEach(function (k) {
        must(RES_DEFAULTS[k], 'CLAVE_INVALIDA', 'Configuración no editable: ' + k);
        var v = cleanText(c[k], 400);
        if (k === 'res_google_url') must(!v || /^https:\/\/[^\s]+$/.test(v), 'VALOR_INVALIDO', 'Pegá el link completo que empieza con https://');
        if (k === 'res_sello_encuesta') { must(v === 'SI' || v === 'NO', 'VALOR_INVALIDO', 'Usá SI o NO.'); if (v === 'SI') requireLicencia(); }
        if (k === 'res_pregunta') must(v.length >= 5, 'VALOR_INVALIDO', 'Pregunta muy corta.');
        if (db.get('Config', k)) db.update('Config', k, { valor: v }); else db.insert('Config', { clave: k, valor: v, descripcion: RES_DEFAULTS[k][1] });
      });
      audit(user, 'RES_CONFIG', 'Config', 'resenas', c);
      return { ok: true };
    }
    function resMarcar(p, user) {
      requireRole(user, ['ADMIN']);
      requireRes();
      var r = db.get('Resenas', str(p.resena_id));
      must(r, 'NO_ENCONTRADO', 'Reseña inexistente.', 404);
      var upd = {};
      if (p.leida !== undefined) upd.leida = p.leida ? 'SI' : 'NO';
      if (p.nota !== undefined) upd.nota = cleanText(p.nota, 300);
      db.update('Resenas', r.resena_id, upd);
      return { ok: true };
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
      if (r.tipo === 'MESA') {
        out.mesa = r.mesa;
        var rm = db.get('Mesas', r.mesa_id), rv = reservaInfo(rm);
        if (rv && rv.bloquea && !cuentaAbiertaDeMesa(r.mesa_id)) out.reservada = true;
        var ca = cuentaAbiertaDeMesa(r.mesa_id), pss = ca ? personasDe(ca) : [];
        if (pss.length) out.personas = pss.map(function (x) { return x.nombre; }); // la mesa está dividida: el cliente puede indicar quién pide
      }
      out.pedidos_habilitados = isTrue(cfg('qr_pedidos_habilitados')) && (r.tipo === 'MESA' || isTrue(cfg('takeaway_qr_habilitado')));
      out.requiere_aceptacion = isTrue(cfg('qr_requiere_aceptacion'));
      out.cuenta_qr = r.tipo === 'MESA' && isTrue(cfg('cuenta_qr_habilitada'));
      if (r.tipo !== 'MESA' && waLlevar()) out.whatsapp = waLlevar();
      out.menu = menuFor(r.punto_id, false);
      out.modulos = modulosActivos().filter(function (m) { return m !== 'RECOMPENSAS'; });
      if (tieneModulo('RESENAS')) out.resenas = resInfoBase();
      var re = recEstadoSync();
      if (re) out.recompensas = { nombre: re.nombre, minimo_gs: re.minimo_gs, meta: metaRec(), premios: premiosRec('SELLOS').map(function (pr) { return { sellos: int(pr.sellos), nombre: pr.nombre }; }) };
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
      if (r.tipo === 'MESA') {
        var rv2 = reservaInfo(db.get('Mesas', r.mesa_id));
        must(!(rv2 && rv2.bloquea && !cuentaAbiertaDeMesa(r.mesa_id)), 'MESA_RESERVADA', 'Esta mesa está reservada. Pedí ayuda al personal.', 409);
      }
      // WhatsApp del cliente en para llevar (si el local lo pide): para avisarle cuando está listo.
      var wa = '', promos = false;
      if (r.tipo !== 'MESA' && waLlevar()) {
        var waTxt = str(p.whatsapp, 30);
        if (waTxt) { wa = normCel(waTxt); must(celValido(wa), 'WHATSAPP_INVALIDO', 'Revisá tu número de WhatsApp (ej.: 0981 123 456).'); }
        must(wa || waLlevar() !== 'OBLIGATORIO', 'WHATSAPP_REQUERIDO', 'Dejanos tu WhatsApp para avisarte cuando tu pedido esté listo.');
        promos = !!wa && p.acepta_promos === true;
      }
      var res = createOrder({
        whatsapp: wa, acepta_promos: promos,
        request_id: p.request_id, mesa_id: r.tipo === 'MESA' ? r.mesa_id : '', punto_id: r.punto_id,
        alias: p.alias, observacion: p.observacion, items: p.items, persona_nombre: p.persona_nombre
      }, null, 'QR');
      var ped = db.get('Pedidos', res.pedido.pedido_id);
      // Club de clientes: si no indicó otro celular, se usa su WhatsApp (solo suma el sello si ya es socio o pidió sumarse).
      var celRec = p.rec_celular || wa;
      var vinc = !res.duplicado && celRec ? vincularPorCelular(db.get('Cuentas', ped.cuenta_id), celRec, p.alias || p.persona_nombre, p.rec_unirse === true) : null;
      if (vinc) bumpRev();
      return { recompensa: vinc ? { nombre: vinc.nombre, sellos: int(vinc.sellos), meta: metaRec(), token: vinc.token } : null, numero: ped.numero, estado: ped.estado, total_gs: int(ped.total_gs), status_token: ped.status_token, duplicado: res.duplicado };
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
      return { token: signSession(u), usuario: usuarioPublico(u) };
    }
    function logoutAll(p, user) {
      // Invalida todas las sesiones del propio usuario (o de otro, si es ADMIN)
      var id = str(p.usuario_id) || user.usuario_id;
      if (id !== user.usuario_id) requireRole(user, ['ADMIN']);
      var u = db.get('Usuarios', id);
      must(u, 'USUARIO_INEXISTENTE', 'Usuario inexistente.', 404);
      must(u.rol !== 'PLATAFORMA' || user.plataforma, 'USUARIO_PROTEGIDO', 'Ese usuario es de Ser o Límites.', 403);
      db.update('Usuarios', id, { token_version: int(u.token_version) + 1 });
      audit(user, 'SESIONES_CERRADAS', 'Usuarios', id, '');
      return { ok: true };
    }

    // ---------------------------------------------------------------- router
    var PUBLIC = {
      'public.resolve': publicResolve, 'public.order': publicOrder, 'public.status': publicStatus, 'auth.login': login,
      'public.recInfo': publicRecInfo, 'public.recJoin': publicRecJoin,
      'public.cuenta': publicCuenta, 'public.pedirCuenta': publicPedirCuenta,
      'public.resenaInfo': publicResenaInfo, 'public.resena': publicResena, 'public.resenaGoogle': publicResenaGoogle,
      'sistema.avisosWA': sistemaAvisosWA, 'sistema.avisoResultado': sistemaAvisoResultado,
      'health': function () { return { ok: true, version: VERSION, hora: iso(now()), plan: planNombre() }; }
    };
    var STAFF = {
      'sync': syncData,
      'me': function (p, u) { return { usuario: usuarioPublico(u) }; },
      'menu': function (p, u) { return menuFor(str(p.punto_id) || null, false); },
      'order.create': function (p, u) { requireRole(u, ['ADMIN', 'MOZO', 'CAJA']); return createOrder(p, u, u.rol === 'CAJA' ? 'CAJA' : 'MOZO'); },
      'order.state': setState,
      'order.station': stationState,
      'order.cancel': cancelOrder,
      'order.voidItem': voidItem,
      'cuenta.requestClose': requestClose, 'cuenta.comprobante': setComprobante, 'cuenta.cancelClose': cancelClose, 'cuenta.personas': cuentaPersonas,
      'mesa.reservar': mesaReservar, 'mesa.reservaFin': mesaReservaFin, 'mesa.liberar': mesaLiberar, 'mesa.cambiar': mesaCambiar,
      'caja.estado': cajaEstado, 'caja.abrir': cajaAbrir, 'caja.cobrar': cajaCobrar, 'caja.revertir': cajaRevertir,
      'caja.movimiento': cajaMovimiento, 'caja.cerrar': cajaCerrar,
      'product.availability': productAvailability,
      'admin.data': adminData, 'admin.product': productUpsert, 'admin.group': groupUpsert, 'admin.category': categoryUpsert,
      'admin.mesa': mesaUpsert, 'admin.rotateQr': rotateQr, 'admin.user': userUpsert, 'admin.config': configSet,
      'admin.report': report, 'admin.audit': auditList, 'auth.logoutAll': logoutAll,
      'rec.buscar': recBuscar, 'rec.registrar': recRegistrar, 'rec.vincular': recVincular,
      'rec.admin': recAdmin, 'rec.config': recConfig, 'rec.cliente': recCliente, 'rec.clienteDetalle': recClienteDetalle, 'rec.cuponAnular': recCuponAnular,
      'res.admin': resAdmin, 'res.config': resConfig, 'res.marcar': resMarcar,
      'plataforma.estado': plataformaEstado, 'plataforma.plan': plataformaPlan, 'plataforma.upgrade': plataformaUpgrade, 'plataforma.reiniciar': plataformaReiniciar,
      'carta.iaUso': cartaIaUso, 'admin.importarCarta': importarCarta,
      'wa.estado': waEstado, 'wa.config': waConfig, 'wa.puedeProbar': waPuedeProbar,
      'stock.data': stockData, 'stock.insumo': insumoUpsert, 'stock.receta': recetaSet, 'stock.compra': stockCompra, 'stock.conteo': stockConteo, 'stock.merma': stockMerma
    };
    var READONLY = { 'public.resolve': 1, 'public.status': 1, 'public.cuenta': 1, 'health': 1, 'sync': 1, 'me': 1, 'menu': 1, 'caja.estado': 1, 'admin.data': 1, 'admin.report': 1, 'admin.audit': 1, 'public.recInfo': 1, 'rec.admin': 1, 'rec.clienteDetalle': 1, 'public.resenaInfo': 1, 'res.admin': 1, 'plataforma.estado': 1, 'stock.data': 1, 'sistema.avisosWA': 1, 'wa.estado': 1, 'wa.puedeProbar': 1 };

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
        // Cada local (matriz): nombre, puntos, cajas y configuración salen de locales/<local>/local.json.
        // Sin opts.local quedan nombres neutros de Mesa Pya'e. Solo completa lo que no existe: nunca pisa datos de un local en marcha.
        var L = opts.local || {}, LP = L.puntos || {}, LS = LP.salon || {}, LT = LP.para_llevar || {}, LC = L.cajas || {};
        var conTakeaway = LT.activo !== false;
        var cfgLocal = {};
        if (L.nombre) cfgLocal.nombre_negocio = L.nombre;
        Object.keys(L.config || {}).forEach(function (k) { cfgLocal[k] = L.config[k]; });
        if (!conTakeaway) cfgLocal.takeaway_qr_habilitado = 'NO';
        Object.keys(cfgLocal).forEach(function (k) {
          var d = DEFAULT_CONFIG[k] || REC_DEFAULTS[k] || RES_DEFAULTS[k];
          if (d) ensure('Config', { clave: k, valor: String(cfgLocal[k]), descripcion: d[1] });
        });
        Object.keys(DEFAULT_CONFIG).forEach(function (k) { ensure('Config', { clave: k, valor: DEFAULT_CONFIG[k][0], descripcion: DEFAULT_CONFIG[k][1] }); });
        var mp = db.get('Config', 'medios_pago');
        if (mp && mp.valor === 'EFECTIVO,TARJETA,TRANSFERENCIA') { db.update('Config', 'medios_pago', { valor: DEFAULT_CONFIG.medios_pago[0], descripcion: DEFAULT_CONFIG.medios_pago[1] }); created.push('Config:medios_pago'); }
        var am = db.get('Config', 'cocina_alerta_min');
        if (am && String(am.valor) === '5' && am.descripcion.indexOf('Hasta 3 valores') < 0) { db.update('Config', 'cocina_alerta_min', { valor: DEFAULT_CONFIG.cocina_alerta_min[0], descripcion: DEFAULT_CONFIG.cocina_alerta_min[1] }); created.push('Config:cocina_alerta_min'); }
        ensure('Cajas', { caja_id: 'CAJA_A', punto_id: 'A_CAFE', nombre: cleanText(LC.A, 60) || 'Caja 01 — Salón', activo: 'SI' });
        ensure('Cajas', { caja_id: 'CAJA_B', punto_id: 'B_TAKEAWAY', nombre: cleanText(LC.B, 60) || 'Caja 02 — Para llevar', activo: conTakeaway ? 'SI' : 'NO' });
        ensure('Puntos', { punto_id: 'A_CAFE', nombre: cleanText(LS.nombre, 60) || 'Salón principal', modalidad: 'SALON', prefijo: 'A', caja_id: 'CAJA_A', qr_token: env.token(12), activo: 'SI' });
        ensure('Puntos', { punto_id: 'B_TAKEAWAY', nombre: cleanText(LT.nombre, 60) || 'Para llevar', modalidad: 'TAKEAWAY', prefijo: 'T', caja_id: 'CAJA_B', qr_token: env.token(12), activo: conTakeaway ? 'SI' : 'NO' });
        var nMesas = int(opts.mesas || 20);
        for (var i = 1; i <= nMesas; i++) {
          ensure('Mesas', { mesa_id: 'M' + pad(i, 2), punto_id: 'A_CAFE', numero: i, nombre: 'Mesa ' + i, zona: '', qr_token: env.token(12), activa: 'SI' });
        }
        var cat = opts.catalogo;
        if (cat) {
          cat.categorias.forEach(function (c) { ensure('Categorias', { categoria_id: c.categoria_id, nombre: c.nombre, orden: c.orden, activa: c.activa ? 'SI' : 'NO', nota: c.nota }); });
          cat.grupos.forEach(function (g) { ensure('Grupos', { grupo_id: g.grupo_id, nombre: g.nombre, min: g.min, max: g.max, activo: 'SI', nota: g.nota, regla: g.regla || '', tipo: g.tipo || '', repetir: g.repetir || 1 }); });
          cat.opciones.forEach(function (o) { ensure('Opciones', { opcion_id: o.opcion_id, grupo_id: o.grupo_id, nombre: o.nombre, delta_gs: o.delta_gs, activo: 'SI', orden: o.orden, dibujo: o.dibujo || '' }); });
          cat.productos.forEach(function (p) {
            var row = {
              producto_id: p.producto_id, categoria_id: p.categoria_id, nombre: p.nombre, descripcion: p.descripcion, precio_gs: p.precio_gs,
              activo: 'SI', disponible: 'SI', puntos: p.puntos, grupos: p.grupos, orden: p.orden, fuente: p.fuente, validacion: p.validacion, nota: p.nota, actualizado_en: iso(now())
            };
            if (p.dias) row.dias = str(p.dias);        // platos por día (catálogo de un local nuevo)
            if (p.imagen) row.imagen = str(p.imagen);  // foto del plato
            if (p.armador) row.armador = str(p.armador); // Upgrade Armá tu pedido
            ensure('Productos', row);
          });
        }
        // Migración 10/10/2026: la pizza personal admite mitad y mitad (solo si nadie cambió sus grupos a mano).
        var ppz = db.get('Productos', 'PIZZA_PERSONAL');
        if (ppz && str(ppz.grupos) === 'G_PIZZA_SABOR' && db.get('Grupos', 'G_PIZZA_MITAD_P')) { db.update('Productos', 'PIZZA_PERSONAL', { grupos: 'G_PIZZA_SABOR,G_PIZZA_MITAD_P' }); created.push('Productos:PIZZA_PERSONAL'); }
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
        // Sitio de demo: modelos 3D de ejemplo en algunos productos (solo si están vacíos)
        Object.keys(opts.modelos3d || {}).forEach(function (pid) {
          var pr = db.get('Productos', pid);
          if (pr && !str(pr.modelo_3d)) { db.update('Productos', pid, { modelo_3d: opts.modelos3d[pid] }); created.push('Productos:' + pid + ' (3D)'); }
        });
        // Sitio de demo: premios y configuración de ejemplo (solo la primera vez, si no hay premios cargados)
        if (opts.demo && !db.all('RecPremios').length) {
          (opts.demo.premios || []).forEach(function (x, i) {
            if (x.producto_id && !db.get('Productos', x.producto_id)) return;
            db.insert('RecPremios', { premio_id: newId('PRM'), tipo: x.tipo || 'SELLOS', sellos: x.tipo === 'CUMPLE' ? 0 : int(x.sellos), nombre: str(x.nombre), producto_id: str(x.producto_id), valor_gs: int(x.valor_gs), costo_gs: int(x.costo_gs), activo: 'SI', orden: i });
          });
          Object.keys(opts.demo.config || {}).forEach(function (k) {
            var d = DEFAULT_CONFIG[k] || REC_DEFAULTS[k] || RES_DEFAULTS[k];
            if (!d || db.get('Config', k)) return;
            db.insert('Config', { clave: k, valor: String(opts.demo.config[k]), descripcion: d[1] });
          });
          created.push('Demo: premios y configuración de ejemplo');
        }
        // Sitio de demo: fotos de ejemplo en los productos (solo si están vacías)
        Object.keys(opts.imagenes || {}).forEach(function (pid) {
          var pr = db.get('Productos', pid);
          if (pr && !str(pr.imagen)) { db.update('Productos', pid, { imagen: opts.imagenes[pid] }); created.push('Productos:' + pid + ' (foto)'); }
        });
        // Usuario de plataforma (Ser o Límites): llega con el PIN ya cifrado (MESA_PLATAFORMA=usuario:sal:hash).
        if (opts.plataforma && opts.plataforma.usuario_id && opts.plataforma.hash) {
          var pu = db.get('Usuarios', opts.plataforma.usuario_id);
          if (!pu) {
            db.insert('Usuarios', { usuario_id: opts.plataforma.usuario_id, nombre: opts.plataforma.nombre || 'Ser o Límites', rol: 'PLATAFORMA', caja_id: '', pin_hash: opts.plataforma.hash, pin_salt: opts.plataforma.salt,
              activo: 'SI', token_version: 1, intentos: 0, bloqueado_hasta: '', creado_en: iso(now()) });
            created.push('Usuarios:' + opts.plataforma.usuario_id);
          } else if (pu.rol === 'PLATAFORMA' && pu.pin_hash !== opts.plataforma.hash) {
            db.update('Usuarios', pu.usuario_id, { pin_hash: opts.plataforma.hash, pin_salt: opts.plataforma.salt, token_version: int(pu.token_version) + 1, intentos: 0, bloqueado_hasta: '' });
            created.push('Usuarios:' + pu.usuario_id + ' (PIN)');
          }
        }
        (opts.usuarios || []).forEach(function (u) {
          if (db.get('Usuarios', u.usuario_id)) return;
          var s = env.token(16);
          db.insert('Usuarios', {
            usuario_id: u.usuario_id, nombre: u.nombre, rol: u.rol, caja_id: u.caja_id || '', pin_hash: hashPin(u.pin, s), pin_salt: s,
            activo: 'SI', token_version: 1, intentos: 0, bloqueado_hasta: '', creado_en: iso(now()), para_llevar: u.rol === 'MOZO' && u.para_llevar ? 'SI' : 'NO'
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
        n.MovStock = db.archive('MovStock', function (r) { return env.dateKey(Date.parse(r.fecha)) < limite && !(r.pedido_id && db.get('Pedidos', r.pedido_id)); });
        db.commit();
        return n;
      });
    }

    return { handle: handle, seed: seed, archive: archive, _hashPin: hashPin };
  }
  // MESA_PLATAFORMA="usuario:sal:hash" → opciones de seed del usuario de plataforma
  function parsePlataforma(v) {
    var f = String(v || '').trim().split(':');
    return f.length === 3 && /^[a-z0-9_.]{3,30}$/.test(f[0]) && f[1].length >= 8 && /^[0-9a-f]{64}$/.test(f[2]) ? { usuario_id: f[0], salt: f[1], hash: f[2], nombre: 'Ser o Límites' } : null;
  }

  return { create: create, parsePlataforma: parsePlataforma, PLANES: PLANES, MODULOS: MODULOS, UPGRADES: UPGRADES, SCHEMA: SCHEMA, KEYS: KEYS, ARCHIVABLE: ARCHIVABLE, VERSION: VERSION, ESTADOS: ESTADOS, TRANSICIONES: TRANSICIONES, DEFAULT_CONFIG: DEFAULT_CONFIG };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MesaCore;
