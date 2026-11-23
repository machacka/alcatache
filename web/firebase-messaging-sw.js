// Service worker : reçoit les alertes même quand l'appli est fermée.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('firebase-config.js');

firebase.initializeApp(self.ALCA_CONFIG.firebase);
firebase.messaging(); // FCM affiche automatiquement les notifications reçues

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
