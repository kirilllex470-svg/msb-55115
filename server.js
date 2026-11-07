const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const webpush = require('web-push');

const DATA_DIR = fs.existsSync('/data') ? '/data/' : '';
const DB_FILE = DATA_DIR + 'history.json';
const NOTIFS_FILE = DATA_DIR + 'notifications.json';
const SUBS_FILE = DATA_DIR + 'subscriptions.json';
const VAPID_FILE = DATA_DIR + 'vapid.json';

let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
}

webpush.setVapidDetails('mailto:admin@journal.local', vapidKeys.publicKey, vapidKeys.privateKey);

let pushSubscriptions = new Array();
if (fs.existsSync(SUBS_FILE)) {
    try { pushSubscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); }
    catch (e) { pushSubscriptions = new Array(); }
}

const MANIFEST_JSON = JSON.stringify({
    name: "Журнал МСБ55115", short_name: "МСБ55115", start_url: "/", display: "standalone",
    background_color: "#0f172a", theme_color: "#0f172a",
    icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
});

const ICON_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SW_CODE = [
    "self.addEventListener('install', function(e) { self.skipWaiting(); });",
    "self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });",
    "self.addEventListener('fetch', function(e) { e.respondWith(fetch(e.request).catch(function() { return new Response(''); })); });",
    "self.addEventListener('push', function(event) {",
    "    var data = { title: '🛑 СООБЩЕНИЕ В ЖУРНАЛЕ!', body: 'Срочно откройте журнал!' };",
    "    if (event.data) { try { data = event.data.json(); } catch (e) {} }",
    "    event.waitUntil(self.registration.showNotification(data.title, {",
    "        body: data.body, vibrate: Array.of(800, 200, 800, 200, 800, 200, 1000),",
    "        silent: false, requireInteraction: true, renotify: true, tag: 'admin-alert'",
    "    }));",
    "});",
    "self.addEventListener('notificationclick', function(event) {",
    "    event.notification.close();",
    "    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "        for (var i = 0; i < clientList.length; i++) { var cl = clientList.at(i); if (cl && 'focus' in cl) return cl.focus(); }",
    "        if (clients.openWindow) return clients.openWindow('/');",
    "    }));",
    "});"
].join('\n');
const server = http.createServer(function(req, res) {
    if (req.url && req.url.indexOf('/sw.js') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(SW_CODE);
    }
    if (req.url === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        return res.end(MANIFEST_JSON);
    }
    if (req.url === '/icon-192.png' || req.url === '/icon-512.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(Buffer.from(ICON_BASE64, 'base64'));
    }
    if (req.url === '/') {
        fs.readFile('index.html', function(err, data) {
            if (err) { res.writeHead(500); res.end('Error loading index.html'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data); }
        });
    }
});

const wss = new WebSocket.Server({ server: server });
let tableHistory = new Array();
let notificationsHistory = new Array();
let activeAlerts = {};
let currentStreamUrl = "https://salutejazz.ru";

if (fs.existsSync(DB_FILE)) {
    try { const c = fs.readFileSync(DB_FILE, 'utf8'); tableHistory = c.trim() ? JSON.parse(c) : new Array(); }
    catch (e) { tableHistory = new Array(); }
}
if (fs.existsSync(NOTIFS_FILE)) {
    try { const n = fs.readFileSync(NOTIFS_FILE, 'utf8'); notificationsHistory = n.trim() ? JSON.parse(n) : new Array(); }
    catch (e) { notificationsHistory = new Array(); }
}

function triggerAlertBroadcast(sender, color, target, text, timeStr) {
    const now = new Date();
    const tStr = timeStr || (now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5));
    const notifId = Date.now() + Math.floor(Math.random() * 1000);
    const newNotif = { id: notifId, time: tStr, sender: sender, color: color, target: target, text: text, read: false, readBy: '' };
    notificationsHistory.push(newNotif);
    if (notificationsHistory.length > 200) notificationsHistory = notificationsHistory.slice(-200);
    fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});
    activeAlerts[target] = { id: notifId, text: text, sender: sender };

    wss.clients.forEach(function(c) {
        if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'admin_alert', sender: sender, target: target, text: text, notif: newNotif }));
        }
    });
    const payload = JSON.stringify({ title: '🛑 СООБЩЕНИЕ ДЛЯ [' + target + ']!', body: sender + ': ' + text });
    pushSubscriptions.forEach(function(item, index) {
        if (target === 'ВСЕМ' || item.user === target) {
            webpush.sendNotification(item.sub, payload, { TTL: 3600, headers: { 'Urgency': 'high' } }).catch(function(err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    pushSubscriptions.splice(index, 1);
                    fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                }
            });
        }
    });
}
wss.on('connection', function(ws) {
    ws.send(JSON.stringify({
        type: 'init', data: tableHistory, notifications: notificationsHistory,
        alerts: activeAlerts, streamUrl: currentStreamUrl, vapidPublicKey: vapidKeys.publicKey
    }));

    ws.on('message', function(message) {
        try {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));

            if (msg.type === 'set_stream_url' && msg.url) {
                currentStreamUrl = msg.url;
                wss.clients.forEach(function(c) {
                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'stream_url_updated', url: currentStreamUrl }));
                });
                if (msg.notify) {
                    triggerAlertBroadcast('АДМИН', '#8b5cf6', 'ВСЕМ', '📹 НАЧАЛСЯ ВИДЕОСТРИМ! Откройте раздел видеострима и нажмите «ПЕРЕЙТИ ПО ССЫЛКЕ»', msg.time);
                }
                return;
            }
            if (msg.type === 'close_stream') {
                wss.clients.forEach(function(c) {
                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'stream_closed' }));
                });
                return;
            }
            if (msg.type === 'save_sub' && msg.sub) {
                const idx = pushSubscriptions.findIndex(function(s) { return s.sub.endpoint === msg.sub.endpoint; });
                if (idx !== -1) pushSubscriptions.at(idx).user = msg.user;
                else pushSubscriptions.push({ user: msg.user, sub: msg.sub });
                fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                return;
            }
            if (msg.type === 'add_row') {
                const newRow = { id: Date.now(), time: msg.time, user: msg.user, values: msg.values, color: msg.color };
                tableHistory.push(newRow);
                fs.writeFile(DB_FILE, JSON.stringify(tableHistory), function() {});
                wss.clients.forEach(function(c) {
                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'new_row', row: newRow }));
                });
            }
            if (msg.type === 'clear_history') {
                tableHistory = new Array(); notificationsHistory = new Array(); activeAlerts = {};
                fs.writeFile(DB_FILE, JSON.stringify(tableHistory), function() {});
                fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});
                wss.clients.forEach(function(c) {
                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'history_cleared' }));
                });
            }
            if (msg.type === 'admin_alert') {
                triggerAlertBroadcast(msg.sender || 'АДМИН', msg.color || '#ef4444', msg.target, msg.text, msg.time);
            }
            if (msg.type === 'clear_alert') {
                delete activeAlerts[msg.target];
                notificationsHistory.forEach(function(n) {
                    if (n.target === msg.target && !n.read) { n.read = true; n.readBy = msg.readBy || ''; }
                });
                fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});
                wss.clients.forEach(function(c) {
                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'alert_cleared', target: msg.target, notifId: msg.notifId || null, readBy: msg.readBy || '' }));
                });
            }
        } catch (e) { console.error("Ошибка:", e); }
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() { console.log('🚀 СЕРВЕР ЗАПУЩЕН! (Порт ' + PORT + ')'); });
