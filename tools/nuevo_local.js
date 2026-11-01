#!/usr/bin/env node
'use strict';
/*
 * Arma el borrador de un local nuevo de la matriz a partir de la Ficha de alta (ficha.json del Google Form).
 * Uso: node tools/nuevo_local.js <ficha.json> <local> [--forzar]
 *
 * Crea locales/<local>/local.json y locales/<local>/PENDIENTES.md (lo que falta y hay que confirmar).
 * La carta NO se arma acá: catalogo.json se arma leyendo la carta del local (Excel, PDF o fotos)
 * y nunca se inventan productos ni precios. El logo va como locales/<local>/logo.png.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Títulos de las preguntas de la ficha (FichaDeAlta.gs). Si cambian en el formulario, cambiarlos acá.
const Q = {
  nombre: 'Nombre del negocio', responsable: 'Nombre y apellido del responsable', whatsapp: 'WhatsApp de contacto',
  razon: 'Razón social', ruc: 'RUC', emailFact: 'Correo para facturación', plan: 'Plan contratado',
  visible: 'Nombre visible del local', color1: 'Color principal de la marca', color2: 'Color secundario',
  direccion: 'Dirección del local', ciudad: 'Ciudad / barrio', horarios: 'Horarios de atención', redes: 'Instagram o página web',
  tipo: 'Tipo de local', puntos: 'Puntos de venta', nCajas: '¿Cuántas cajas cobran por separado?', cajas: 'Nombre de cada caja',
  mesas: 'Cantidad de mesas', zonas: 'Mesas por zona', medios: 'Medios de pago que aceptan',
  cuentaQr: '¿Querés que el cliente pueda pedir la cuenta desde el celular?', reservas: '¿Toman reservas?',
  formato: '¿En qué formato tienen la carta hoy?', porDia: '¿Tienen platos que se sirven solo algunos días? (menú del día, menú semanal)',
  porDiaComo: 'Si respondiste que sí, contanos cómo funciona', variantes: 'Variantes, agregados y guarniciones',
  fotos: 'Fotos de los platos (planes Gold y Premium)', platos3d: 'Platos para la carta en 3D (plan Premium, hasta 5)',
  admin: 'Administrador principal (dueño/a)', equipo: 'Personas y roles', maps: 'Link del local en Google Maps',
  premios: 'Premios del club de clientes (Premium)', minimo: 'Compra mínima para sumar un sello (Premium)',
  cumple: 'Regalo de cumpleaños (Premium)', ekuatiai: "¿Contrata el Upgrade e-Kuatia'i (factura desde la caja)?", fecha: 'Fecha deseada para empezar a usar el sistema',
  horario: 'Mejor horario para la capacitación del equipo', otros: '¿Algo más que debamos saber?'
};
const ROL = { encargado: 'ADMIN', 'encargada': 'ADMIN', admin: 'ADMIN', administrador: 'ADMIN', dueño: 'ADMIN', 'dueña': 'ADMIN', mozo: 'MOZO', moza: 'MOZO', mesero: 'MOZO', 'mesera': 'MOZO', cocina: 'COCINA', cocinero: 'COCINA', cocinera: 'COCINA', caja: 'CAJA', cajero: 'CAJA', cajera: 'CAJA' };
const MEDIO = { 'Efectivo': 'EFECTIVO', 'Transferencia': 'TRANSFERENCIA', 'Tarjeta de crédito': 'TC', 'Tarjeta de débito / QR': 'TD' };

function sinAcentos(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function texto(v) { return Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v).trim(); }
function lista(v) { return Array.isArray(v) ? v : String(v || '').split(/\s*,\s*/).filter(Boolean); }
function lineas(v) { return String(v || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }
function limpio(s, max) { return texto(s).replace(/[<>"\\`]/g, '').slice(0, max || 80); }

function armar(ficha, slug) {
  const r = ficha.respuestas || ficha;
  const pend = [];
  const nombre = limpio(r[Q.visible] || r[Q.nombre], 60);
  if (!nombre) pend.push('Falta el nombre visible del local.');
  const plan = sinAcentos(texto(r[Q.plan])).toUpperCase();
  if (['BASICO', 'GOLD', 'PREMIUM'].indexOf(plan) < 0) pend.push('Confirmar el plan contratado (vino: "' + texto(r[Q.plan]) + '").');

  const puntos = lista(r[Q.puntos]);
  const conTk = puntos.some((p) => /llevar|mostrador|barra/i.test(p));
  const soloMostrador = !puntos.some((p) => /llevar/i.test(p));
  const cajas = lineas(r[Q.cajas]);
  if (conTk && cajas.length < 2) pend.push('Confirmar el nombre de la caja de para llevar (se usó "Caja 02 — Para llevar").');

  const mesas = parseInt(texto(r[Q.mesas]), 10);
  if (!(mesas >= 0)) pend.push('Confirmar la cantidad de mesas.');

  const hex = (v) => (/^#?[0-9a-fA-F]{6}$/.test(texto(v)) ? '#' + texto(v).replace('#', '').toUpperCase() : null);
  const colores = {};
  if (hex(r[Q.color1])) colores.principal = hex(r[Q.color1]); else if (texto(r[Q.color1])) pend.push('Pasar a código el color principal "' + texto(r[Q.color1]) + '" (o tomarlo del logo).');
  if (hex(r[Q.color2])) colores.secundario = hex(r[Q.color2]); else if (texto(r[Q.color2])) pend.push('Pasar a código el color secundario "' + texto(r[Q.color2]) + '".');

  const config = {};
  const medios = lista(r[Q.medios]).map((m) => MEDIO[m]).filter(Boolean);
  if (medios.length) config.medios_pago = medios.join(',');
  lista(r[Q.medios]).filter((m) => !MEDIO[m]).forEach((m) => pend.push('Medio de pago no estándar: "' + m + '" (ver si se agrega).'));
  // "Pedir la cuenta desde el celular" viene SIEMPRE activado en las altas nuevas (decisión de Ser o Límites, 23/10/2026).
  // Si el local respondió que no, se deja activado igual y queda como pendiente para mostrarlo en la capacitación.
  config.cuenta_qr_habilitada = 'SI';
  if (texto(r[Q.cuentaQr]) && !/^s/i.test(texto(r[Q.cuentaQr]))) pend.push('En la ficha respondieron "' + texto(r[Q.cuentaQr]) + '" a pedir la cuenta desde el celular: queda ACTIVADO igual (viene en todos los planes). Mostrarlo en la capacitación; si insisten, se apaga en Administración → Configuración → cuenta_qr_habilitada = NO.');
  const maps = texto(r[Q.maps]);
  if (/writereview\?placeid=/.test(maps)) config.res_google_url = maps;
  else if (plan !== 'BASICO') pend.push('Armar el link directo de reseñas de Google (writereview?placeid=…) desde: ' + (maps || 'sin link de Maps'));

  // Equipo: "Nombre — Rol" por línea. Nunca PIN.
  const equipo = [];
  if (texto(r[Q.admin])) equipo.push({ nombre: limpio(r[Q.admin], 40), rol: 'ADMIN' });
  lineas(r[Q.equipo]).forEach((l) => {
    const m = l.split(/\s*[—–\-:|]\s*/);
    const nom = limpio(m[0], 40), rolTxt = sinAcentos(String(m[1] || '')).toLowerCase().trim();
    const rol = ROL[rolTxt] || ROL[rolTxt.split(' ')[0]];
    if (!nom) return;
    if (equipo.some((u) => u.nombre.toLowerCase() === nom.toLowerCase())) return;
    if (!rol) { pend.push('Rol no reconocido para "' + l + '" (roles: Encargado, Mozo, Cocina, Caja).'); return; }
    equipo.push({ nombre: nom, rol });
  });

  const local = {
    slug,
    nombre,
    nombre_corto: nombre.length <= 24 ? nombre : nombre.slice(0, 24).trim(),
    direccion: limpio([texto(r[Q.direccion]), texto(r[Q.ciudad])].filter(Boolean).join(' · '), 90),
    plan: ['BASICO', 'GOLD', 'PREMIUM'].indexOf(plan) >= 0 ? plan : 'BASICO',
    colores,
    mesas: mesas >= 0 ? mesas : 0,
    puntos: {
      salon: { nombre: 'Salón', corto: 'Salón' },
      para_llevar: conTk ? { activo: true, nombre: soloMostrador ? 'Mostrador' : 'Para llevar', corto: soloMostrador ? 'Mostrador' : 'Para llevar', lugar: 'el mostrador' } : { activo: false }
    },
    cajas: { A: limpio(cajas[0] || 'Caja 01 — Salón', 60) },
    config,
    sitio: { api_url: '', firebase: { projectId: '', apiKey: '', appId: '' } },
    empresa: { razon_social: limpio(r[Q.razon], 80), ruc: limpio(r[Q.ruc], 20) },
    contacto: { responsable: limpio(r[Q.responsable], 60), whatsapp: limpio(r[Q.whatsapp], 30), email: limpio(ficha.email, 80) },
    equipo,
    horarios: texto(r[Q.horarios]),
    ficha: { enviado: ficha.enviado || '', carpeta: ficha.carpeta || '', respuesta_id: ficha.respuesta_id || '' }
  };
  if (conTk) local.cajas.B = limpio(cajas[1] || 'Caja 02 — Para llevar', 60);
  if (local.nombre_corto !== nombre) pend.push('Revisar el nombre corto (se cortó a "' + local.nombre_corto + '").');
  if (!local.direccion) pend.push('Falta la dirección.');
  if (!equipo.some((u) => u.rol === 'ADMIN')) pend.push('Falta el administrador principal.');
  // Mejoras de octubre 2026: se deciden con el local en la capacitación (quedan apagadas por defecto).
  if (conTk) {
    pend.push('Capacitación: ¿quién atiende los pedidos para llevar del QR? CAJA (la caja de para llevar, por defecto) o EQUIPO (mozos marcados "Atiende para llevar" + caja del salón). Config: para_llevar_qr_atiende.');
    pend.push('Capacitación: ¿pedir el WhatsApp del cliente en para llevar? NO / OPCIONAL / OBLIGATORIO. Config: para_llevar_whatsapp.');
  }
  pend.push('Capacitación: mostrar "🔀 Cambiar de mesa" (mozo) y "🖨 Imprimir comanda" (cocina, mozo y caja); preguntar qué impresora de tickets usan.');
  pend.push('Leer la carta (' + (texto(r[Q.formato]) || 'formato sin indicar') + ') desde la carpeta del local y armar catalogo.json. Nunca inventar productos ni precios: lo dudoso queda POR_VALIDAR y se pregunta.');
  if (/^s/i.test(texto(r[Q.porDia]))) pend.push('Platos por día: ' + (texto(r[Q.porDiaComo]) || 'preguntar cómo funciona') + ' (campo dias: 1 = lunes … 7 = domingo).');
  if (texto(r[Q.variantes])) pend.push('Variantes y guarniciones a cargar como grupos: ' + texto(r[Q.variantes]));
  pend.push('Copiar el logo de la carpeta del local a locales/' + slug + '/logo.png y correr: python3 tools/iconos_local.py ' + slug);
  if (plan === 'GOLD' || plan === 'PREMIUM') pend.push('Fotos de los platos: ' + (texto(r[Q.fotos]) || 'sin respuesta') + '.');
  if (plan === 'PREMIUM') {
    pend.push('Platos 3D: ' + (texto(r[Q.platos3d]) || 'sin respuesta') + '.');
    pend.push('Club de clientes (se carga en Administración → Recompensas): premios "' + texto(r[Q.premios]) + '", mínimo "' + texto(r[Q.minimo]) + '", cumpleaños "' + texto(r[Q.cumple]) + '".');
  }
  if (texto(r[Q.zonas])) pend.push('Zonas de mesas a cargar en Administración → Mesas: ' + texto(r[Q.zonas]));
  pend.push(/^s/i.test(texto(r[Q.ekuatiai]))
    ? "Upgrade e-Kuatia'i contratado: confirmar que el local tiene un solo establecimiento y un punto de expedición en la DNIT; después de publicar, activarlo con sol en ⚙ Licencia → Upgrades e instalar la extensión del local (node tools/extension_local.js " + slug + " <sitio>) en la PC de la caja."
    : "Preguntar si contrata el Upgrade e-Kuatia'i (factura desde la caja; se cobra aparte, implementación + mantenimiento). Solo sirve con un establecimiento y un punto de expedición en la DNIT.");
  pend.push('Después de publicar el servidor: completar sitio.api_url y sitio.firebase con lo que imprime desplegar.sh.');
  pend.push('Usuarios: se crean en la capacitación y cada persona elige su PIN (nunca por mensaje ni en la ficha).');
  if (texto(r[Q.fecha]) || texto(r[Q.horario])) pend.push('Capacitación: ' + [texto(r[Q.fecha]), texto(r[Q.horario])].filter(Boolean).join(' · ') + '.');
  if (texto(r[Q.otros])) pend.push('Comentario del local: ' + texto(r[Q.otros]));
  return { local, pendientes: pend };
}

module.exports = { armar, Q };

if (require.main === module) {
  const [fichaPath, slug] = process.argv.slice(2);
  if (!fichaPath || !/^[a-z0-9-]{3,40}$/.test(slug || '')) { console.log('Uso: node tools/nuevo_local.js <ficha.json> <local>   (local: minúsculas, números y guiones)'); process.exit(1); }
  const dir = path.join(ROOT, 'locales', slug);
  if (fs.existsSync(path.join(dir, 'local.json')) && process.argv.indexOf('--forzar') < 0) { console.log('Ya existe locales/' + slug + '/local.json (usar --forzar para reemplazarlo).'); process.exit(1); }
  const { local, pendientes } = armar(JSON.parse(fs.readFileSync(fichaPath, 'utf8')), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify(local, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'PENDIENTES.md'), '# Pendientes · ' + local.nombre + '\n\n' + pendientes.map((p) => '- [ ] ' + p).join('\n') + '\n');
  console.log('Borrador creado en locales/' + slug + ' (' + pendientes.length + ' pendientes en PENDIENTES.md).');
}
