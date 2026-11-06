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

const FIXED_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const FIXED_PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';

let vapidKeys = {
    publicKey: FIXED_PUBLIC_KEY,
    privateKey: FIXED_PRIVATE_KEY
};

if (webpush) {
    try {
        if (fs.existsSync(VAPID_FILE)) {
            const savedVapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
            if (savedVapid && savedVapid.publicKey && savedVapid.privateKey) {
                vapidKeys = savedVapid;
            }
        } else {
            fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
        }
        webpush.setVapidDetails(
            'mailto:admin@msb55115.com',
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );
    } catch (e) {
        console.error('Ошибка VAPID:', e);
    }
}

let pushSubscriptions = new Array();
try {
    if (fs.existsSync(SUBS_FILE)) {
        const parsedSubs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        if (Array.isArray(parsedSubs)) pushSubscriptions = parsedSubs;
    }
} catch (e) {
    pushSubscriptions = new Array();
}

let tableState = new Array();
let activeAlerts = {};
let currentStreamUrl = '';

try {
    if (fs.existsSync(DATA_FILE)) {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (Array.isArray(saved)) {
            tableState = saved;
        } else if (saved && (Array.isArray(saved.tableState) || saved.activeAlerts)) {
            tableState = saved.tableState || new Array();
            activeAlerts = saved.activeAlerts || {};
        }
    }
} catch (e) {
    tableState = new Array();
    activeAlerts = {};
}

function saveState() {
    try {
        const toSave = { tableState: tableState, activeAlerts: activeAlerts };
        fs.writeFile(DATA_FILE, JSON.stringify(toSave, null, 2), function() {});
    } catch (e) {}
}

const ICON_SVG = '<svg xmlns="http://w3.org" viewBox="0 0 192 192" width="192" height="192"><rect width="192" height="192" rx="36" fill="#0f172a"/><rect x="16" y="16" width="160" height="160" rx="24" fill="#1e293b" stroke="#3b82f6" stroke-width="6"/><text x="96" y="115" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">МСБ</text></svg>';

const SW_CODE = "self.addEventListener('install', function(e) { self.skipWaiting(); });\n" +
"self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });\n" +
"self.addEventListener('push', function(e) {\n" +
"    let d = { title: '🚨 ТРЕВОГА МСБ55115!', body: 'Срочное уведомление в журнале' };\n" +
"    if (e.data) { try { d = Object.assign(d, e.data.json()); } catch(err) { d.body = e.data.text(); } }\n" +
"    e.waitUntil(self.registration.showNotification(d.title, {\n" +
"        body: d.body, icon: '/icon.svg', badge: '/icon.svg', requireInteraction: true,\n" +
"        tag: d.tag || 'alert-' + Date.now(), renotify: true, data: { url: '/' }\n" +
"    }));\n" +
"});\n" +
"self.addEventListener('notificationclick', function(e) {\n" +
"    e.notification.close();\n" +
"    e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {\n" +
"        for (var i = 0; i < list.length; i++) { var c = list.at(i); if (c && 'focus' in c) return c.focus(); }\n" +
"        if (clients.openWindow) return clients.openWindow('/');\n" +
"    }));\n" +
"});";
const server = http.createServer(function(req, res) {
    const urlPath = req.url.split('?').at(0);

    if (urlPath === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            name: 'Журнал МСБ55115',
            short_name: 'МСБ55115',
            start_url: '/',
            display: 'standalone',
            background_color: '#0f172a',
            theme_color: '#1e293b',
            icons: Array.of(
                { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
                { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
            )
        }));
        return;
    }

    if (urlPath === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(SW_CODE);
        return;
    }

    if (urlPath === '/icon.svg' || urlPath === '/icon-192.png') {
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
                const user = parsed.user || 'ГОСТЬ';
                if (sub && sub.endpoint) {
                    const idx = pushSubscriptions.findIndex(function(item) {
                        return item.sub && item.sub.endpoint === sub.endpoint;
                    });
                    if (idx !== -1) {
                        pushSubscriptions.splice(idx, 1, { sub: sub, user: user });
                    } else {
                        pushSubscriptions.push({ sub: sub, user: user });
                    }
                    fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                    console.log('✅ HTTP Подписка сохранена: ' + user);
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

            if (msg.type === 'save_sub') {
                const sub = msg.sub;
                const user = msg.user || 'ГОСТЬ';
                if (sub && sub.endpoint) {
                    const idx = pushSubscriptions.findIndex(function(item) {
                        return item.sub && item.sub.endpoint === sub.endpoint;
                    });
                    if (idx !== -1) {
                        pushSubscriptions.splice(idx, 1, { sub: sub, user: user });
                    } else {
                        pushSubscriptions.push({ sub: sub, user: user });
                    }
                    fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                    console.log('✅ WS Подписка сохранена: ' + user);
                }
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

                if (msg.forceOpen && currentStreamUrl && webpush && pushSubscriptions.length > 0) {
                    const streamPayload = JSON.stringify({
                        title: '📡 НАЧАЛСЯ ВИДЕОСТРИМ!',
                        body: 'Администратор запустил трансляцию. Нажмите для перехода.',
                        tag: 'stream-' + Date.now()
                    });
                    const pushOptions = { TTL: 3600, urgency: 'high' };

                    pushSubscriptions.forEach(function(item) {
                        if (item.user !== 'АДМИН') {
                            webpush.sendNotification(item.sub, streamPayload, pushOptions)
                                .catch(function(err) {
                                    if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403 || err.statusCode === 401) {
                                        const rmIdx = pushSubscriptions.findIndex(function(s) {
                                            return s.sub && s.sub.endpoint === item.sub.endpoint;
                                        });
                                        if (rmIdx !== -1) {
                                            pushSubscriptions.splice(rmIdx, 1);
                                            fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                                        }
                                    }
                                });
                        }
                    });
                }
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

            if (msg.type === 'add_row' || msg.type === 'update') {
                if (msg.values && Array.isArray(msg.values)) {
                    const newRow = {
                        user: msg.user,
                        color: msg.color,
                        time: msg.time,
                        values: msg.values
                    };
                    tableState.push(newRow);
                    saveState();

                    wss.clients.forEach(function(client) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'new_row', row: newRow }));
                        }
                    });
                }
                return;
            }

            if (msg.type === 'admin_alert' || msg.type === 'alert') {
                const target = msg.target || 'ВСЕМ';
                const text = msg.text || msg.message || 'Срочное сообщение!';
                const sender = msg.sender || 'АДМИН';
                const now = new Date();
                const timeStr = msg.time || (now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5));

                Reflect.set(activeAlerts, target, { text: text, sender: sender });

                let notifValues = new Array(6).fill("-");
                notifValues.splice(0, 1, "⚠️ УВЕДОМЛЕНИЕ");
                notifValues.splice(1, 1, "КОМУ: " + target);
                notifValues.splice(notifValues.length - 1, 1, "Текст: " + text);

                const newRow = {
                    user: sender,
                    color: msg.color || '#ef4444',
                    time: timeStr,
                    values: notifValues
                };
                tableState.push(newRow);
                saveState();

                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'new_row', row: newRow }));
                        client.send(JSON.stringify({
                            type: 'admin_alert',
                            target: target,
                            text: text,
                            sender: sender
                        }));
                    }
                });

                if (webpush && pushSubscriptions.length > 0) {
                    const payload = JSON.stringify({
                        title: '🚨 ТРЕВОГА ДЛЯ: ' + target,
                        body: sender + ': ' + text,
                        tag: 'alert-' + Date.now()
                    });
                    const pushOptions = { TTL: 86400, urgency: 'high' };

                    pushSubscriptions.forEach(function(item) {
                        const isForAll = (target === 'ВСЕМ' || target === 'ВСЕ' || target === 'ALL');
                        const isExactTarget = (item.user === target);
                        const isGuest = (!item.user || item.user === 'ГОСТЬ');
                        const isNotSender = (item.user !== sender);

                        if ((isForAll && isNotSender) || isExactTarget || isGuest) {
                            webpush.sendNotification(item.sub, payload, pushOptions)
                                .then(function() { console.log('---> Доставлено в шторку: ' + (item.user || 'Гость')); })
                                .catch(function(err) {
                                    if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403 || err.statusCode === 401) {
                                        const rmIdx = pushSubscriptions.findIndex(function(s) {
                                            return s.sub && s.sub.endpoint === item.sub.endpoint;
                                        });
                                        if (rmIdx !== -1) {
                                            pushSubscriptions.splice(rmIdx, 1);
                                            fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                                        }
                                    }
                                });
                        }
                    });
                }
                return;
            }

            if (msg.type === 'clear_alert') {
                Reflect.deleteProperty(activeAlerts, msg.target);
                saveState();
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'alert_cleared', target: msg.target }));
                    }
                });
                return;
            }

            if (msg.type === 'clear_history') {
                tableState = new Array();
                activeAlerts = {};
                saveState();
                wss.clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'history_cleared' }));
                    }
                });
                return;
            }

        } catch (e) { console.error("Ошибка обработки:", e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 СЕРВЕР ЗАПУЩЕН И РАБОТАЕТ! (Порт ' + PORT + ')');
});
