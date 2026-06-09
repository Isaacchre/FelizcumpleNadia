const CACHE_NAME = 'cutecal-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  console.log('[Service Worker] Instalado');
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activado y listo');
});

// Escuchar el evento de notificación
self.addEventListener('push', (event) => {
  const options = {
    body: '¡Tienes un nuevo plan amor! ✨',
    icon: 'https://cdn-icons-png.flaticon.com/512/2693/2693507.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2693/2693507.png',
    vibrate: [100, 50, 100],
    data: { url: './index.html' }
  };

  event.waitUntil(
    self.registration.showNotification('CuteCal 🌸', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./index.html'));
});