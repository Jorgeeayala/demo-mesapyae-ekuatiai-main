/*
 * Mesa Pya'e — Andrade · Exportación diaria a Google Sheets (versión Firebase)
 *
 * Proyecto de Apps Script vinculado a una planilla de Google (por ejemplo
 * "ANDRADE_VENTAS_DIARIAS"). Cada día a las 06:00 trae los datos del día anterior
 * desde la función exportDia de Firebase y los escribe en las hojas Pedidos, Items,
 * Cobros, Movimientos y Turnos. Es idempotente: si se vuelve a ejecutar para el mismo
 * día, reemplaza las filas de ese día.
 *
 * Configuración (Configuración del proyecto > Propiedades del script):
 *   EXPORT_URL  https://southamerica-east1-<proyecto>.cloudfunctions.net/exportDia
 *   EXPORT_KEY  el mismo valor que el secreto EXPORT_KEY de Firebase
 * Luego ejecutar una vez instalarExportacion().
 */
var HOJAS = {
  Pedidos: { clave: 'pedidos', cols: ['fecha', 'numero', 'punto_id', 'caja_id', 'mesa_id', 'origen', 'modo', 'estado', 'alias', 'total_gs', 'creado_por', 'creado_en', 'aceptado_en', 'listo_en', 'entregado_en', 'motivo_cancelacion', 'pedido_id'] },
  Items: { clave: 'items', cols: ['pedido_id', 'producto_id', 'nombre', 'opciones', 'cantidad', 'precio_unit_gs', 'total_gs', 'anulado', 'observacion'] },
  Cobros: { clave: 'cobros', cols: ['fecha', 'caja_id', 'cuenta_id', 'subtotal_gs', 'descuento_gs', 'total_gs', 'pagos', 'usuario_id', 'autorizado_por', 'estado', 'cobro_id', 'comprobante'] },
  Movimientos: { clave: 'movimientos', cols: ['fecha', 'caja_id', 'tipo', 'medio', 'monto_gs', 'usuario_id', 'motivo', 'turno_id', 'movimiento_id'] },
  Turnos: { clave: 'turnos', cols: ['caja_id', 'estado', 'abierto_en', 'abierto_por', 'monto_inicial_gs', 'cerrado_en', 'cerrado_por', 'esperado_efectivo_gs', 'declarado_efectivo_gs', 'diferencia_gs', 'observacion', 'turno_id'] }
};

function exportarDia(dia) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('EXPORT_URL'), key = props.getProperty('EXPORT_KEY');
  if (!url || !key) throw new Error('Configurá EXPORT_URL y EXPORT_KEY en las propiedades del script.');
  var r = UrlFetchApp.fetch(url + '?dia=' + encodeURIComponent(dia), { headers: { 'X-Export-Key': key }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Exportación falló (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  var data = JSON.parse(r.getContentText()).data;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HOJAS).forEach(function (nombre) {
    var h = HOJAS[nombre];
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var cols = ['dia_export'].concat(h.cols);
    if (sh.getLastRow() === 0) sh.appendRow(cols);
    // quitar filas previas del mismo día (re-ejecución)
    var last = sh.getLastRow();
    if (last > 1) {
      var dias = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = dias.length - 1; i >= 0; i--) if (String(dias[i][0]) === dia) sh.deleteRow(i + 2);
    }
    var filas = (data[h.clave] || []).map(function (o) {
      return [dia].concat(h.cols.map(function (c) { var v = o[c]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); }));
    });
    if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, cols.length).setValues(filas);
  });
  return data.pedidos.length;
}

function exportarAyer() {
  var ayer = Utilities.formatDate(new Date(Date.now() - 86400000), 'America/Asuncion', 'yyyy-MM-dd');
  console.log('Exportados ' + exportarDia(ayer) + ' pedidos del ' + ayer);
}

function instalarExportacion() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'exportarAyer') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('exportarAyer').timeBased().everyDays(1).atHour(6).inTimezone('America/Asuncion').create();
}
