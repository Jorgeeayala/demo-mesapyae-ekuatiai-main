/*
 * MESA PYA'E — Atención Integrada (Upgrade ATENCION): conexión con Whaticket desde el servidor del local.
 *
 * - probar: Ser o Límites prueba el token del local (Secret Manager WHATICKET_TOKEN) y trae las conexiones de WhatsApp.
 * - enviarPendientes: toma de la cola AvisosWA (core.js) los avisos pendientes, los manda por Whaticket y devuelve
 *   el resultado al núcleo. Se llama después de cada cambio de pedido; si algo falla, se reintenta en la próxima vuelta
 *   (hasta 3 intentos). Nunca frena la operación del local.
 *
 * El token nunca pasa por el navegador ni se guarda en Firestore. Corre en Node (Cloud Functions y servidor de desarrollo)
 * y en el navegador (demo: cliente simulado). Sintaxis ES2019.
 */
(function (root, factory) {
  var M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.AtencionWA = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://api.whaticket.com/api/v1';
  var PLACEHOLDER = 'pendiente';

  function tokenConfigurado(t) { t = String(t || '').trim(); return !!t && t.toLowerCase() !== PLACEHOLDER; }

  function WhaticketError(status, ruta, codigo) {
    this.status = status; this.ruta = ruta; this.codigo = codigo || '';
    this.message = 'Whaticket ' + status + ' en ' + ruta + (codigo ? ' (' + codigo + ')' : '');
  }

  // Cliente mínimo de la API de Whaticket (los datos sensibles nunca van al log: solo ruta, estado y código).
  function crearCliente(opts) {
    var token = String(opts.token || '').trim(), f = opts.fetch, base = opts.base || BASE;
    function pedir(metodo, ruta, cuerpo) {
      var init = { method: metodo, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } };
      if (cuerpo !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(cuerpo); }
      return Promise.resolve(f(base + ruta, init)).then(function (res) {
        return res.text().then(function (txt) {
          var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
          if (!res.ok) {
            var cod = data && typeof data === 'object' ? (data.error || data.code || '') : '';
            throw new WhaticketError(res.status, metodo + ' ' + ruta.split('?')[0], /^ERR_[A-Z_]+$/.test(String(cod)) ? cod : '');
          }
          return data;
        });
      }, function () { throw new WhaticketError(0, metodo + ' ' + ruta.split('?')[0], 'SIN_RESPUESTA'); });
    }
    return {
      me: function () { return pedir('GET', '/me'); },
      conexiones: function () { return pedir('GET', '/whatsapps'); },
      // Campaña de 1 a 999 mensajes. Sin ticketData.status el chat queda en «Resueltos»: el aviso no llena la bandeja
      // del local y, si el cliente responde, entra como chat nuevo por el departamento (equipo o Wäbot).
      enviar: function (conexionId, mensajes) { return pedir('POST', '/messages', { connectionId: conexionId, campaignName: 'Mesa Pya\'e · avisos', fastMode: true, messages: mensajes }); }
    };
  }

  function mensajeError(e) {
    if (!(e instanceof WhaticketError)) return 'No se pudo conectar con Whaticket.';
    if (e.codigo === 'ERR_INSUFFICIENT_PERMISSION' || e.status === 403) return 'Al perfil del token de Whaticket le falta un permiso (' + e.ruta + '). Agregalo en Whaticket → Equipo → Perfiles y permisos.';
    if (e.status === 401) return 'Whaticket rechazó el token. Revisalo en Secret Manager (WHATICKET_TOKEN) del proyecto del local.';
    if (e.status === 429) return 'Whaticket está recibiendo demasiadas solicitudes. Probá de nuevo en un minuto.';
    if (e.status === 0) return 'Whaticket no respondió. Probá de nuevo en un momento.';
    return 'Whaticket no aceptó la operación' + (e.codigo ? ' (' + e.codigo + ')' : '') + '.';
  }

  // Acción wa.probar (fuera del núcleo porque llama a internet): verifica permisos con el núcleo y prueba el token.
  function probar(req, deps) {
    return Promise.resolve(deps.handle({ action: 'wa.puedeProbar', payload: {}, token: req.token })).then(function (r) {
      if (!r.ok) return r;
      if (!tokenConfigurado(deps.token)) return { ok: false, status: 409, error: { code: 'SIN_TOKEN', message: 'Falta cargar el token de Whaticket del local en Secret Manager (WHATICKET_TOKEN) y volver a publicar el servidor.' } };
      var c = deps.cliente || crearCliente({ token: deps.token, fetch: deps.fetch });
      return c.me().then(function (me) {
        return c.conexiones().then(function (cs) {
          return { ok: true, status: 200, data: {
            empresa: me && me.company ? me.company.name : '', token_nombre: me ? me.name : '',
            conexiones: (Array.isArray(cs) ? cs : []).map(function (x) { return { id: String(x.id), nombre: x.name || '', estado: x.status || '', canal: x.channel || '' }; })
          } };
        });
      }).catch(function (e) {
        if (deps.log) deps.log('wa.probar: ' + (e && e.message));
        return { ok: false, status: 502, error: { code: 'WHATICKET', message: mensajeError(e) } };
      });
    });
  }

  // Envía lo pendiente de la cola. Devuelve cuántos salieron y cuántos fallaron.
  function enviarPendientes(deps) {
    if (!tokenConfigurado(deps.token)) return Promise.resolve({ enviados: 0, fallidos: 0, motivo: 'sin-token' });
    var ts = deps.now ? deps.now() : Date.now();
    var firma = { ts: ts, firma: deps.firmar('sistema|' + ts) };
    return Promise.resolve(deps.handle({ action: 'sistema.avisosWA', payload: firma })).then(function (r) {
      if (!r.ok || !r.data || !r.data.avisos.length || !r.data.conexion_id) return { enviados: 0, fallidos: 0 };
      var c = deps.cliente || crearCliente({ token: deps.token, fetch: deps.fetch });
      var avisos = r.data.avisos, resultados = [];
      // De a uno: si un número falla, los demás salen igual.
      return avisos.reduce(function (pr, a) {
        return pr.then(function () {
          return c.enviar(r.data.conexion_id, [{ number: a.numero, body: a.texto }])
            .then(function () { resultados.push({ aviso_id: a.aviso_id, ok: true }); },
              function (e) { resultados.push({ aviso_id: a.aviso_id, ok: false, error: mensajeError(e) }); if (deps.log) deps.log('avisoWA: ' + (e && e.message)); });
        });
      }, Promise.resolve()).then(function () {
        var ts2 = deps.now ? deps.now() : Date.now();
        return Promise.resolve(deps.handle({ action: 'sistema.avisoResultado', payload: { ts: ts2, firma: deps.firmar('sistema|' + ts2), resultados: resultados } })).then(function () {
          var ok = resultados.filter(function (x) { return x.ok; }).length;
          return { enviados: ok, fallidos: resultados.length - ok };
        });
      });
    });
  }

  // Acciones después de las que puede haber un aviso nuevo en la cola.
  var DISPARAN = { 'public.order': 1, 'order.create': 1, 'order.state': 1, 'order.station': 1, 'order.voidItem': 1 };

  // Cliente simulado (servidor de desarrollo, demo y pruebas): no sale a internet.
  function clienteSimulado(registro) {
    return {
      me: function () { return Promise.resolve({ name: 'Token de prueba', company: { name: 'Local de prueba' } }); },
      conexiones: function () { return Promise.resolve([{ id: 'conn-demo', name: 'WhatsApp del local (prueba)', status: 'CONNECTED', channel: 'WHATSAPP' }]); },
      enviar: function (conexionId, mensajes) { if (registro) registro.push({ conexionId: conexionId, mensajes: mensajes }); return Promise.resolve('OK'); }
    };
  }

  return { crearCliente: crearCliente, probar: probar, enviarPendientes: enviarPendientes, clienteSimulado: clienteSimulado, tokenConfigurado: tokenConfigurado, DISPARAN: DISPARAN, WhaticketError: WhaticketError };
});
