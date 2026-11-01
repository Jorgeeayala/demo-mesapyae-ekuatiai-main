/*
 * Tiempo real (solo versión Firebase): escucha el documento público meta/pulse de
 * Firestore. No contiene datos del negocio, solo un número de revisión; cuando cambia,
 * las pantallas piden las novedades al servidor. Si no carga (sin internet o bloqueado),
 * el sistema sigue funcionando con consultas periódicas.
 */
(function (w) {
  'use strict';
  var cfg = w.MESA_CONFIG && w.MESA_CONFIG.firebase;
  if (!cfg || !cfg.projectId || w.MESA_CONFIG.demo) return;
  var V = '10.14.1';
  function load(src) {
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  load('https://www.gstatic.com/firebasejs/' + V + '/firebase-app-compat.js')
    .then(function () { return load('https://www.gstatic.com/firebasejs/' + V + '/firebase-firestore-compat.js'); })
    .then(function () {
      var app = w.firebase.initializeApp(cfg, 'mesa-pulso');
      app.firestore().doc('meta/pulse').onSnapshot(function (snap) {
        if (snap.exists && w.Mesa) w.Mesa.onPulse(snap.get('rev'));
      }, function (err) { if (w.console) console.warn('Tiempo real no disponible, se usa consulta periódica.', err && err.code); if (w.Mesa) w.Mesa.realtime = false; });
    })
    .catch(function () { if (w.console) console.warn('No se pudo cargar Firebase; se usa consulta periódica.'); });
})(window);
