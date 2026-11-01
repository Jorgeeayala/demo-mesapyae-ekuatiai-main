/*
 * Prueba completa sobre un entorno publicado (staging).
 * Se ejecuta en la consola del navegador, en el sitio publicado, con una sesión de ADMIN abierta.
 * Crea usuarios de prueba con PIN aleatorio (nunca se muestran), recorre pedido QR de mesa y de takeaway,
 * cocina, entrega, cobros en Caja 01 y Caja 02, cierres y reporte; al final desactiva los usuarios de prueba.
 * Devuelve una lista de pasos con OK/FALLA.
 */
async function pruebaStaging() {
  const pasos = [];
  const marca = (n, ok, det) => { pasos.push((ok ? 'OK    ' : 'FALLA ') + n + (det ? ' — ' + det : '')); if (!ok) throw new Error(n + ': ' + det); };
  const api = async (action, payload, token) => {
    const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload: payload || {}, token }) });
    return r.json();
  };
  const ok = async (action, payload, token) => { const r = await api(action, payload, token); if (!r.ok) throw new Error(action + ': ' + JSON.stringify(r.error)); return r.data; };
  const rid = () => 'prueba-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const pin = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const ses = JSON.parse(localStorage.getItem('mesapyae.sesion') || 'null');
  const adm = ses && ses.token;
  try {
    marca('Sesión de administrador', !!adm);
    const t0 = Date.now(); await ok('health'); marca('API por Netlify → Firebase', true, (Date.now() - t0) + ' ms');
    const d = await ok('admin.data', {}, adm);
    const mesa = d.mesas.filter((m) => m.activa === 'SI' || m.activa === true || m.activa === undefined)[0];
    const tk = d.puntos.find((p) => p.punto_id === 'B_TAKEAWAY');
    marca('Datos iniciales (carta, mesas, puntos)', d.menu.productos.length > 60 && !!mesa && !!tk, d.menu.productos.length + ' productos, ' + d.mesas.length + ' mesas');
    const U = { prueba_mozo: ['MOZO', ''], prueba_cocina: ['COCINA', ''], prueba_caja1: ['CAJA', 'CAJA_A'], prueba_caja2: ['CAJA', 'CAJA_B'] };
    const T = {};
    for (const id of Object.keys(U)) {
      const p = pin();
      await ok('admin.user', { usuario: { usuario_id: id, nombre: 'Prueba ' + id.split('_')[1], rol: U[id][0], caja_id: U[id][1], activo: 'SI', pin: p } }, adm);
      T[id] = (await ok('auth.login', { usuario: id, pin: p })).token;
    }
    marca('Usuarios de prueba creados e ingresados', true, Object.keys(T).join(', '));
    const bad = await api('auth.login', { usuario: 'prueba_mozo', pin: '000000' });
    marca('PIN incorrecto rechazado', !bad.ok, bad.error && bad.error.code);
    const qm = await ok('public.order', { token: mesa.qr_token, request_id: rid(), total_gs: 1, items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }, { producto_id: 'PANINI_CESAR', cantidad: 1, opciones: ['PAN_LAC'], observacion: 'sin tomate' }] });
    marca('Pedido QR de mesa (' + mesa.nombre + ')', qm.total_gs === 47000, qm.numero + ' Gs. ' + qm.total_gs + ' (precio manipulado ignorado)');
    const sinNombre = await api('public.order', { token: tk.qr_token, request_id: rid(), items: [{ producto_id: 'CHIPA', cantidad: 1, opciones: [] }] });
    marca('Takeaway sin nombre rechazado', !sinNombre.ok, sinNombre.error && sinNombre.error.code);
    const qz = await ok('public.order', { token: mesa.qr_token, request_id: rid(), items: [{ producto_id: 'PIZZA_MITAD', cantidad: 1, opciones: ['M1_MOZ', 'M2_PEP'] }] });
    marca('Pizza mitad y mitad (Muzzarella + Peperoni = sabor más caro)', qz.total_gs === 60000, qz.numero + ' Gs. ' + qz.total_gs);
    const qt = await ok('public.order', { token: tk.qr_token, request_id: rid(), alias: 'Prueba', items: [{ producto_id: 'CHIPA', cantidad: 2, opciones: [] }] });
    marca('Pedido QR de takeaway', qt.total_gs === 16000, qt.numero + ' Gs. ' + qt.total_gs);
    const find = async (tok, num) => (await ok('sync', {}, tok)).pedidos.find((x) => x.numero === num);
    const pm = await find(T.prueba_mozo, qm.numero), pt = await find(T.prueba_caja2, qt.numero);
    const cajaMal = await api('order.state', { pedido_id: pm.pedido_id, estado: 'ACEPTADO' }, T.prueba_caja2);
    marca('Caja 02 no puede tocar pedidos de la cafetería', !cajaMal.ok, cajaMal.error && cajaMal.error.code);
    await ok('order.state', { pedido_id: pm.pedido_id, estado: 'ACEPTADO' }, T.prueba_mozo);
    let acepTk = await api('order.state', { pedido_id: pt.pedido_id, estado: 'ACEPTADO' }, T.prueba_caja2);
    if (!acepTk.ok) acepTk = await api('order.state', { pedido_id: pt.pedido_id, estado: 'ACEPTADO' }, adm);
    marca('Pedidos aceptados', acepTk.ok, acepTk.ok ? '' : JSON.stringify(acepTk.error));
    const coc = await ok('sync', {}, T.prueba_cocina);
    const enCocina = coc.pedidos.filter((x) => x.numero === qm.numero || x.numero === qt.numero);
    marca('Cocina recibe ambos pedidos (sin acceso a cuentas)', enCocina.length === 2 && coc.cuentas.length === 0, enCocina.map((x) => x.numero).join(' y '));
    marca('Observación visible en cocina', JSON.stringify(enCocina).includes('sin tomate'));
    for (const p of [pm, pt]) for (const e of ['EN_PREPARACION', 'LISTO']) await ok('order.state', { pedido_id: p.pedido_id, estado: e }, T.prueba_cocina);
    marca('Cocina: en preparación → listo', true);
    await ok('order.state', { pedido_id: pm.pedido_id, estado: 'ENTREGADO' }, T.prueba_mozo);
    let entTk = await api('order.state', { pedido_id: pt.pedido_id, estado: 'ENTREGADO' }, T.prueba_caja2);
    marca('Entregados (mozo y Caja 02)', entTk.ok, entTk.ok ? '' : JSON.stringify(entTk.error));
    for (const [tok, caja, ini] of [[T.prueba_caja1, 'CAJA_A', 100000], [T.prueba_caja2, 'CAJA_B', 50000]]) {
      const e = await ok('caja.estado', { caja_id: caja }, tok);
      if (!e.turno) await ok('caja.abrir', { caja_id: caja, monto_inicial_gs: ini }, tok);
    }
    marca('Cajas abiertas', true);
    const cruz = await api('caja.cobrar', { request_id: rid(), cuenta_id: pm.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 47000 }] }, T.prueba_caja2);
    marca('Caja 02 no puede cobrar una cuenta de Caja 01', !cruz.ok, cruz.error && cruz.error.code);
    const fac = await api('cuenta.requestClose', { cuenta_id: pm.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: '80012345-6', razon: 'Cliente Prueba SA' } }, T.prueba_mozo);
    const cu = (await ok('sync', {}, T.prueba_caja1)).cuentas.find((c) => c.cuenta_id === pm.cuenta_id);
    marca('Mozo pide la cuenta con factura y Caja 01 recibe RUC y razón social', fac.ok && cu && cu.comprobante && cu.comprobante.ruc === '80012345-6', cu && cu.comprobante ? cu.comprobante.razon : JSON.stringify(fac.error));
    const rq = rid();
    await ok('caja.cobrar', { request_id: rq, cuenta_id: pm.cuenta_id, total_esperado_gs: 107000, pagos: [{ medio: 'EFECTIVO', monto_gs: 87000 }, { medio: 'TD', monto_gs: 20000 }] }, T.prueba_caja1);
    const dup = await ok('caja.cobrar', { request_id: rq, cuenta_id: pm.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 107000 }] }, T.prueba_caja1);
    marca('Cobro en Caja 01 (efectivo + TD) con datos de factura, reintento sin duplicar', dup.duplicado === true && dup.cobro.comprobante && dup.cobro.comprobante.tipo === 'FACTURA');
    await ok('caja.cobrar', { request_id: rid(), cuenta_id: pt.cuenta_id, total_esperado_gs: 16000, pagos: [{ medio: 'TRANSFERENCIA', monto_gs: 16000 }] }, T.prueba_caja2);
    marca('Cobro en Caja 02 (transferencia)', true);
    const eA = await ok('caja.estado', { caja_id: 'CAJA_A' }, T.prueba_caja1), eB = await ok('caja.estado', { caja_id: 'CAJA_B' }, T.prueba_caja2);
    const esperadoA = eA.turno.totales.efectivo_esperado_gs;
    const esperadoB = eB.turno.totales.efectivo_esperado_gs;
    const cA = await ok('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: esperadoA, observacion: 'Cierre de prueba automática' }, T.prueba_caja1);
    const cB = await ok('caja.cerrar', { caja_id: 'CAJA_B', efectivo_declarado_gs: esperadoB, observacion: 'Cierre de prueba automática' }, T.prueba_caja2);
    marca('Cierres independientes de Caja 01 y Caja 02', !!cA.turno && !!cB.turno, 'diferencias ' + cA.turno.diferencia_gs + ' / ' + cB.turno.diferencia_gs);
    const rep = await ok('admin.report', {}, adm);
    const rA = rep.cajas.find((c) => c.caja_id === 'CAJA_A'), rB = rep.cajas.find((c) => c.caja_id === 'CAJA_B');
    marca('Reporte consolidado del día', (rA.por_medio.TD || 0) >= 20000 && (rB.por_medio.TRANSFERENCIA || 0) >= 16000, 'Caja 01 Gs. ' + rA.ventas_netas_gs + ' · Caja 02 Gs. ' + rB.ventas_netas_gs);
  } catch (e) {
    pasos.push('ERROR ' + e.message);
  } finally {
    for (const id of ['prueba_mozo', 'prueba_cocina', 'prueba_caja1', 'prueba_caja2']) {
      const U = { prueba_mozo: ['MOZO', ''], prueba_cocina: ['COCINA', ''], prueba_caja1: ['CAJA', 'CAJA_A'], prueba_caja2: ['CAJA', 'CAJA_B'] };
      try { await api('admin.user', { usuario: { usuario_id: id, nombre: 'Prueba ' + id.split('_')[1], rol: U[id][0], caja_id: U[id][1], activo: 'NO' } }, adm); } catch (e) { }
    }
    pasos.push('Usuarios de prueba desactivados');
  }
  return pasos;
}
