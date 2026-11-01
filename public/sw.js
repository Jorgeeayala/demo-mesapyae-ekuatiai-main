// Service worker mínimo: permite instalar Mesa Pya'e como app.
// No guarda nada en caché a propósito: precios, pedidos y cobros siempre vienen del servidor.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* red directa */ });
