const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let webpush = null;
try {
    webpush = require('web-push');
} catch (e) {
    console.log('Модуль web-push не найден');
}

const DATA_FILE = path.join(__dirname, 'data.json');
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
const VAPID_FILE = path.join(__dirname, 'vapid.json');

let vapidKeys = { publicKey: '', privateKey: '' };
if (webpush) {
    try {
        if (fs.existsSync(VAPID_FILE)) {
            vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        } else {
            vapidKeys = webpush.generateVAPIDKeys();
            fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
        }
        webpush.setVapidDetails(
            'mailto:admin@msb55115.local',
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );
    } catch (e) {
        console.error('Ошибка VAPID:', e);
    }
}

let pushSubscriptions = [];
try {
    if (fs.existsSync(SUBS_FILE)) {
        pushSubscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    }
} catch (e) {
    pushSubscriptions = [];
}

let tableState = [];
let activeAlerts = {};
let currentStreamUrl = '';

try {
    if (fs.existsSync(DATA_FILE)) {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (Array.isArray(saved)) {
            tableState = saved;
        } else if (saved && Array.isArray(saved.tableState)) {
            tableState = saved.tableState;
            if (saved.activeAlerts) activeAlerts = saved.activeAlerts;
        }
    }
} catch (e) {
    tableState = [];
}

function saveState() {
    try {
        fs.writeFile(DATA_FILE, JSON.stringify(tableState), function() {});
    } catch (e) {}
}
const ICON_SVG = '<svg xmlns="http://w3.org" viewBox="0 0 192 192" width="192" height="192"><rect width="192" height="192" rx="36" fill="#0f172a"/><rect x="16" y="16" width="160" height="160" rx="24" fill="#1e293b" stroke="#3b82f6" stroke-width="6"/><text x="96" y="115" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">МСБ</text></svg>';

const SW_CODE = [
    "self.addEventListener('install', function(event) { self.skipWaiting(); });",
    "self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });",
    "self.addEventListener('push', function(event) {",
    "    let data = { title: '🚨 ВНИМАНИЕ!', body: 'Новое уведомление в журнале' };",
    "    if (event.data) {",
    "        try { data = Object.assign(data, event.data.json()); }",
    "        catch (e) { data.body = event.data.text(); }",
    "    }",
    "    const options = {",
    "        body: data.body,",
    "        icon: '/icon.svg',",
    "        badge: '/icon.svg',",
    "        vibrate: [800, 200, 800, 200, 800, 200, 1000],",
    "        requireInteraction: true,",
    "        tag: data.tag || 'alert-' + Date.now(),",
    "        renotify: true,",
    "        data: { url: '/' }",
    "    };",
    "    event.waitUntil(self.registration.showNotification(data.title, options));",
    "});",
    "self.addEventListener('notificationclick', function(event) {",
    "    event.notification.close();",
    "    event.waitUntil(",
    "        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "            for (var i = 0; i < clientList.length; i++) {",
    "                if ('focus' in clientList[i]) return clientList[i].focus();",
    "            }",
    "            if (clients.openWindow) return clients.openWindow('/');",
    "        })",
    "    );",
    "});"
].join('\n');

const server = http.createServer(function(req, res) {
    const urlPath = req.url.split('?')[0];

    if (urlPath === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            name: 'Журнал МСБ55115',
            short_name: 'МСБ55115',
            start_url: '/',
            display: 'standalone',
            background_color: '#0f172a',
            theme_color: '#1e293b',
            icons: [
                { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
                { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
            ]
        }));
        return;
    }

    if (urlPath === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(SW_CODE);
        return;
    }

    if (urlPath === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(ICON_SVG);
        return;
    }

    if (urlPath === '/vapidPublicKey') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(vapidKeys.publicKey || '');
        return;
    }

    if (urlPath === '/subscribe' && req.method === 'POST') {
        let body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', function() {
            try {
                const parsed = JSON.parse(body);
                const sub = parsed.subscription || parsed.sub || parsed;
                const user = parsed.user || 'АДМИН';
                if (sub && sub.endpoint) {
                    const idx = pushSubscriptions.findIndex(function(item) {
                        return item.sub && item.sub.endpoint === sub.endpoint;
                    });
                    if (idx !== -1) {
                        pushSubscriptions[idx] = { sub: sub, user: user };
                    } else {
                        pushSubscriptions.push({ sub: sub, user: user });
                    }
                    fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                    console.log('✅ Телефон подключен к шторке уведомлений: ' + user);
                }
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400);
                res.end();
            }
        });
        return;
    }

    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, function(err, content) {
        if (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(content);
        }
    });
});
const wss = new WebSocket.Server({ server: server });

wss.on('connection', function(ws) {
    ws.send(JSON.stringify({
        type: 'init',
        data: tableState,
        alerts: activeAlerts,
        vapidPublicKey: vapidKeys.publicKey
    }));

    if (currentStreamUrl) {
        ws.send(JSON.stringify({
            type: 'stream_url',
            url: currentStreamUrl,
            forceOpen: false
        }));
    }

    ws.on('message', function(message) {
        try {
            const msg = JSON.parse(message.toString());

            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            if (msg.type === 'set_stream') {
                currentStreamUrl = msg.url || '';
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'stream_url',
                            url: currentStreamUrl,
                            forceOpen: msg.forceOpen || false
                        }));
                    }
                });
                return;
            }

            if (msg.type === 'get_stream') {
                if (currentStreamUrl) {
                    ws.send(JSON.stringify({
                        type: 'stream_url',
                        url: currentStreamUrl,
                        forceOpen: false
                    }));
                }
                return;
            }

            if (msg.type === 'update') {
                tableState = msg.data;
                saveState();
                wss.clients.forEach(function(client) {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'update', data: tableState }));
                    }
                });
            }

            if (msg.type === 'alert') {
                const target = msg.target || 'ВСЕ';
                const text = msg.text || msg.message || 'Срочное уведомление от Админа!';
                activeAlerts[target] = text;

                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'alert',
                            target: target,
                            text: text,
                            message: text
                        }));
                    }
                });

                if (webpush && pushSubscriptions.length > 0) {
                    const payload = JSON.stringify({
                        title: '🚨 ВНИМАНИЕ: ' + target,
                        body: text,
                        tag: 'alert-' + target
                    });
                    const pushOptions = { TTL: 86400, urgency: 'high' };

                    pushSubscriptions.forEach(function(item, index) {
                        const isForAll = (target === 'ВСЕ' || target === 'ALL');
                        const isExactTarget = (item.user === target);
                        if (isForAll || isExactTarget) {
                            webpush.sendNotification(item.sub, payload, pushOptions)
                                .then(function() { console.log('---> Доставлено в шторку (' + (item.user || 'Гость') + ')'); })
                                .catch(function(err) {
                                    if (err.statusCode === 410 || err.statusCode === 404) {
                                        pushSubscriptions.splice(index, 1);
                                        fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                                    }
                                });
                        }
                    });
                }
            }

            if (msg.type === 'clear_alert') {
                delete activeAlerts[msg.target];
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'alert_cleared', target: msg.target }));
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
