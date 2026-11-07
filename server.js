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

webpush.setVapidDetails(
    'mailto:admin@journal.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

let pushSubscriptions = new Array();
if (fs.existsSync(SUBS_FILE)) {
    try { 
        pushSubscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); 
    } catch (e) { 
        pushSubscriptions = new Array(); 
    }
}

const MANIFEST_JSON = JSON.stringify({
    name: "МСБ55115 — Журнал событий",
    short_name: "МСБ55115",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-192.png", sizes: "512x512", type: "image/png" }
    ]
});

const ICON_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SW_CODE = [
    "self.addEventListener('install', function(e) { self.skipWaiting(); });",
    "self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });",
    "self.addEventListener('fetch', function(e) {});",
    "self.addEventListener('push', function(event) {",
    "    var data = { title: '🛑 СООБЩЕНИЕ В ЖУРНАЛЕ!', body: 'Срочно откройте журнал!' };",
    "    if (event.data) { try { data = event.data.json(); } catch (e) {} }",
    "    event.waitUntil(self.registration.showNotification(data.title, {",
    "        body: data.body,",
    "        vibrate: Array.of(800, 200, 800, 200, 800, 200, 1000),",
    "        silent: false,",
    "        requireInteraction: true,",
    "        renotify: true,",
    "        tag: 'admin-alert-' + Date.now()",
    "    }));",
    "});",
    "self.addEventListener('message', function(event) {",
    "    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {",
    "        self.registration.showNotification(event.data.title, {",
    "            body: event.data.body,",
    "            vibrate: Array.of(800, 200, 800, 200, 800, 200, 1000),",
    "            silent: false,",
    "            requireInteraction: true,",
    "            renotify: true,",
    "            tag: 'admin-alert-' + Date.now()",
    "        });",
    "    }",
    "});",
    "self.addEventListener('notificationclick', function(event) {",
    "    event.notification.close();",
    "    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "        for (var i = 0; i < clientList.length; i++) {",
    "            var cl = clientList.at(i);",
    "            if (cl && 'focus' in cl) return cl.focus();",
    "        }",
    "        if (clients.openWindow) return clients.openWindow('/');",
    "    }));",
    "});"
].join('\n');
const server = http.createServer(function(req, res) {
    if (req.url && req.url.indexOf('/sw.js') === 0) {
        res.writeHead(200, { 
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(SW_CODE);
        return;
    }
    if (req.url === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        res.end(MANIFEST_JSON);
        return;
    }
    if (req.url === '/icon-192.png') {
        if (fs.existsSync('icon-192.png')) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(fs.readFileSync('icon-192.png'));
        } else {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(Buffer.from(ICON_BASE64, 'base64'));
        }
        return;
    }
    if (req.url === '/' || req.url.indexOf('/?') === 0) {
        fs.readFile('index.html', function(err, data) {
            if (err) { 
                res.writeHead(500); 
                res.end('Error loading index.html'); 
            } else { 
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); 
                res.end(data); 
            }
        });
    }
});

const wss = new WebSocket.Server({ server: server });

let tableHistory = new Array(); 
let notificationsHistory = new Array();
let activeAlerts = {}; 
let streamState = { active: false, url: '' };

if (fs.existsSync(DB_FILE)) {
    try { 
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        tableHistory = fileContent.trim() ? JSON.parse(fileContent) : new Array();
    } catch (e) { 
        tableHistory = new Array(); 
    }
}

if (fs.existsSync(NOTIFS_FILE)) {
    try {
        const notifContent = fs.readFileSync(NOTIFS_FILE, 'utf8');
        notificationsHistory = notifContent.trim() ? JSON.parse(notifContent) : new Array();
        notificationsHistory.forEach(function(n) {
            if (!n.read) {
                if (!Array.isArray(activeAlerts[n.target])) activeAlerts[n.target] = new Array();
                activeAlerts[n.target].push({ id: n.id, text: n.text, sender: n.sender });
            }
        });
    } catch (e) {
        notificationsHistory = new Array();
    }
}
function broadcastAlert(sender, color, timeStr, target, text) {
    const notifId = Date.now() + Math.floor(Math.random() * 1000);
    const newNotif = {
        id: notifId,
        time: timeStr,
        sender: sender,
        color: color,
        target: target,
        text: text,
        read: false,
        readBy: ''
    };

    notificationsHistory.push(newNotif);
    if (notificationsHistory.length > 200) {
        notificationsHistory = notificationsHistory.slice(-200);
    }
    fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});

    if (!Array.isArray(activeAlerts[target])) {
        activeAlerts[target] = new Array();
    }
    activeAlerts[target].push({
        id: notifId,
        text: text,
        sender: sender
    });

    wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'admin_alert',
                sender: sender,
                target: target,
                text: text,
                notif: newNotif
            }));
        }
    });

    const payload = JSON.stringify({
        title: '🛑 СООБЩЕНИЕ ДЛЯ [' + target + ']!',
        body: sender + ': ' + text
    });

    const pushOptions = { TTL: 3600, headers: { 'Urgency': 'high' } };

    pushSubscriptions.forEach(function(item, index) {
        if (target === 'ВСЕМ' || item.user === target) {
            webpush.sendNotification(item.sub, payload, pushOptions)
                .catch(function(err) {
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
        type: 'init', 
        data: tableHistory, 
        notifications: notificationsHistory,
        alerts: activeAlerts,
        streamState: streamState,
        vapidPublicKey: vapidKeys.publicKey 
    }));

    ws.on('message', function(message) {
        try {
            const msg = JSON.parse(message.toString());

            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }
            if (msg.type === 'save_sub' && msg.sub) {
                const idx = pushSubscriptions.findIndex(function(s) { return s.sub.endpoint === msg.sub.endpoint; });
                if (idx !== -1) {
                    pushSubscriptions.at(idx).user = msg.user;
                } else {
                    pushSubscriptions.push({ user: msg.user, sub: msg.sub });
                }
                fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                return;
            }

            if (msg.type === 'add_row') {
                const newRow = {
                    id: Date.now(),
                    time: msg.time,
                    user: msg.user,
                    values: msg.values,
                    color: msg.color
                };
                tableHistory.push(newRow);
                fs.writeFile(DB_FILE, JSON.stringify(tableHistory), function() {});

                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'new_row', row: newRow }));
                    }
                });
            }

            if (msg.type === 'stream_start') {
                streamState = { active: true, url: msg.url };
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'stream_state', streamState: streamState }));
                    }
                });
                const now = new Date();
                const timeStr = msg.time || (now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5));
                broadcastAlert(msg.sender || 'АДМИН', msg.color || '#ef4444', timeStr, 'ВСЕМ', '🎥 НАЧАЛСЯ ВИДЕОСТРИМ МСБ-55115! Нажмите кнопку "ПЕРЕЙТИ ПО ССЫЛКЕ"');
            }

            if (msg.type === 'stream_stop') {
                streamState = { active: false, url: '' };
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'stream_state', streamState: streamState }));
                    }
                });
            }

            if (msg.type === 'clear_history') {
                tableHistory = new Array();
                notificationsHistory = new Array();
                activeAlerts = {};
                fs.writeFile(DB_FILE, JSON.stringify(tableHistory), function() {});
                fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});

                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'history_cleared' }));
                    }
                });
            }

            if (msg.type === 'admin_alert') {
                const sender = msg.sender || 'АДМИН';
                const color = msg.color || '#ef4444';
                const now = new Date();
                const timeStr = msg.time || (now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5));
                broadcastAlert(sender, color, timeStr, msg.target, msg.text);
            }

            if (msg.type === 'clear_alert') {
                if (Array.isArray(activeAlerts[msg.target])) {
                    if (msg.notifId) {
                        activeAlerts[msg.target] = activeAlerts[msg.target].filter(function(a) { return a.id !== msg.notifId; });
                    } else {
                        activeAlerts[msg.target].shift();
                    }
                    if (activeAlerts[msg.target].length === 0) {
                        delete activeAlerts[msg.target];
                    }
                } else {
                    delete activeAlerts[msg.target];
                }

                let marked = false;
                notificationsHistory.forEach(function(n) {
                    if (msg.notifId && n.id === msg.notifId) {
                        n.read = true;
                        n.readBy = msg.readBy || '';
                    } else if (!msg.notifId && !marked && n.target === msg.target && !n.read) {
                        n.read = true;
                        n.readBy = msg.readBy || '';
                        marked = true;
                    }
                });
                fs.writeFile(NOTIFS_FILE, JSON.stringify(notificationsHistory), function() {});

                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'alert_cleared',
                            target: msg.target,
                            notifId: msg.notifId || null,
                            readBy: msg.readBy || ''
                        }));
                    }
                });
            }
        } catch (e) { console.error("Ошибка:", e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 СЕРВЕР ЗАПУЩЕН И РАБОТАЕТ! (Порт ' + PORT + ')');
});
