const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let webpush = null;
try {
    webpush = require('web-push');
} catch (e) {
    console.log('Модуль web-push не найден, работаем через WebSocket');
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

let pushSubscriptions = Array.of();
try {
    if (fs.existsSync(SUBS_FILE)) {
        pushSubscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        if (!Array.isArray(pushSubscriptions)) pushSubscriptions = Array.of();
    }
} catch (e) {
    pushSubscriptions = Array.of();
}

let journalState = {};
try {
    if (fs.existsSync(DATA_FILE)) {
        journalState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
} catch (e) {
    journalState = {};
}

function saveJournalState() {
    try {
        fs.writeFile(DATA_FILE, JSON.stringify(journalState, null, 2), function(err) {
            if (err) console.error('Ошибка сохранения data.json:', err);
        });
    } catch (e) {}
}

let activeAlerts = {};
let currentStreamUrl = '';
const ICON_SVG = '<svg xmlns="http://w3.org" viewBox="0 0 192 192" width="192" height="192"><rect width="192" height="192" rx="36" fill="#0f172a"/><rect x="16" y="16" width="160" height="160" rx="24" fill="#1e293b" stroke="#3b82f6" stroke-width="6"/><text x="96" y="115" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">МСБ</text></svg>';

const SW_CODE = [
    "self.addEventListener('install', function(event) { self.skipWaiting(); });",
    "self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });",
    "self.addEventListener('push', function(event) {",
    "    let data = { title: '🚨 ВНИМАНИЕ!', body: 'Новое уведомление в журнале МСБ55115' };",
    "    if (event.data) {",
    "        try { data = Object.assign(data, event.data.json()); }",
    "        catch (e) { data.body = event.data.text(); }",
    "    }",
    "    const options = {",
    "        body: data.body,",
    "        icon: '/icon.svg',",
    "        badge: '/icon.svg',",
    "        vibrate: Array.of(500, 200, 500, 200, 800),",
    "        requireInteraction: true,",
    "        tag: data.tag || 'msb-alert-' + Date.now(),",
    "        renotify: true,",
    "        data: { url: '/' }",
    "    };",
    "    event.waitUntil(self.registration.showNotification(data.title, options));",
    "});",
    "self.addEventListener('notificationclick', function(event) {",
    "    event.notification.close();",
    "    event.waitUntil(",
    "        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "            if (clientList.length > 0) {",
    "                const firstClient = clientList.find(function(c) { return 'focus' in c; });",
    "                if (firstClient) return firstClient.focus();",
    "            }",
    "            if (clients.openWindow) return clients.openWindow('/');",
    "        })",
    "    );",
    "});"
].join('\n');

const server = http.createServer(function(req, res) {
    const urlPath = String(req.url || '/').split('?').shift();

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
        res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
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
                    pushSubscriptions = pushSubscriptions.filter(function(item) {
                        return item.sub && item.sub.endpoint !== sub.endpoint;
                    });
                    pushSubscriptions.push({ sub: sub, user: user });
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

    if (urlPath === '/' || urlPath === '/index.html') {
        const indexPath = path.join(__dirname, 'index.html');
        fs.readFile(indexPath, function(err, content) {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Ошибка загрузки index.html');
            } else {
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
                });
                res.end(content);
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
});
const wss = new WebSocket.Server({ server: server });

function broadcastAll(dataObj, excludeWs) {
    const raw = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj);
    wss.clients.forEach(function(client) {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(raw);
        }
    });
}

wss.on('connection', function(ws) {
    try {
        // Отправляем клиенту все сохраненные данные журнала в любом формате, который ожидает ваш index.html
        const initPacket = Object.assign({}, journalState, {
            type: 'init',
            data: journalState.data !== undefined ? journalState.data : journalState,
            tableData: journalState.tableData || journalState.cells || {},
            rowsData: journalState.rowsData || journalState.rows || Array.of(),
            activeAlerts: activeAlerts,
            vapidPublicKey: vapidKeys.publicKey,
            streamUrl: currentStreamUrl
        });
        ws.send(JSON.stringify(initPacket));

        // Дополнительно отправляем активные тревоги, если они есть
        Object.keys(activeAlerts).forEach(function(targetKey) {
            const al = activeAlerts[targetKey];
            if (al) {
                ws.send(JSON.stringify({
                    type: 'alert',
                    target: al.target,
                    text: al.text,
                    message: al.text,
                    sender: al.sender
                }));
            }
        });

        if (currentStreamUrl) {
            ws.send(JSON.stringify({
                type: 'stream_url',
                url: currentStreamUrl,
                forceOpen: false
            }));
        }
    } catch (e) {}

    ws.on('message', function(message) {
        try {
            const rawStr = message.toString();
            const msg = JSON.parse(rawStr);

            // 1. ВИДЕОСТРИМ
            if (msg.type === 'set_stream') {
                currentStreamUrl = msg.url || '';
                console.log('📡 Видеострим обновлен админом: ' + (currentStreamUrl || 'ОСТАНОВЛЕН'));
                broadcastAll({
                    type: 'stream_url',
                    url: currentStreamUrl,
                    forceOpen: msg.forceOpen || false
                }, null);
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

            // 2. ПОДПИСКА НА ШТОРКУ УВЕДОМЛЕНИЙ
            if (msg.type === 'push_subscribe' || msg.type === 'register_push' || msg.type === 'subscribe') {
                const sub = msg.subscription || msg.sub;
                const user = msg.user || 'АДМИН';
                if (sub && sub.endpoint) {
                    pushSubscriptions = pushSubscriptions.filter(function(item) {
                        return item.sub && item.sub.endpoint !== sub.endpoint;
                    });
                    pushSubscriptions.push({ sub: sub, user: user });
                    fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                    console.log('✅ Телефон подключен к шторке уведомлений: ' + user);
                }
                return;
            }

            // 3. ОТПРАВКА УВЕДОМЛЕНИЙ / ТРЕВОГИ АДМИНОМ
            if (msg.type === 'alert' || msg.type === 'send_alert' || msg.type === 'notify' || msg.type === 'admin_alert') {
                const target = msg.target || msg.to || 'ВСЕ';
                const text = msg.text || msg.message || 'Внимание! Проверьте журнал!';
                const sender = msg.sender || msg.from || 'АДМИН';

                activeAlerts[target] = { target: target, text: text, sender: sender, time: Date.now() };

                // Рассылаем всем открытым браузерам
                broadcastAll({
                    type: 'alert',
                    target: target,
                    text: text,
                    message: text,
                    sender: sender
                }, null);

                // Отправляем в шторку телефонов (даже если браузер закрыт)
                if (webpush && pushSubscriptions.length > 0) {
                    const payload = JSON.stringify({
                        title: '🚨 ' + sender + ' -> ' + target,
                        body: text,
                        tag: 'alert-' + target
                    });
                    const pushOptions = { TTL: 86400, urgency: 'high' };

                    pushSubscriptions.forEach(function(item) {
                        const isForAll = (target === 'ВСЕ' || target === 'ALL' || !target);
                        const isExactTarget = (item.user === target || item.user === 'АДМИН');

                        if (isForAll || isExactTarget) {
                            webpush.sendNotification(item.sub, payload, pushOptions)
                                .then(function() { console.log('---> Доставлено в шторку (' + (item.user || 'Гость') + ')'); })
                                .catch(function(err) {
                                    if (err.statusCode === 410 || err.statusCode === 404) {
                                        pushSubscriptions = pushSubscriptions.filter(function(s) {
                                            return s.sub.endpoint !== item.sub.endpoint;
                                        });
                                        fs.writeFile(SUBS_FILE, JSON.stringify(pushSubscriptions), function() {});
                                    }
                                });
                        }
                    });
                }
                return;
            }

            // 4. СБРОС ТРЕВОГИ
            if (msg.type === 'clear_alert' || msg.type === 'dismiss_alert') {
                const t = msg.target || 'ВСЕ';
                delete activeAlerts[t];
                broadcastAll({ type: 'alert_cleared', target: t }, null);
                return;
            }

            // 5. ЗАПИСЬ В ЖУРНАЛ / ОБНОВЛЕНИЕ ЯЧЕЕК И ТАБЛИЦЫ (сохраняем абсолютно любые поля!)
            if (msg.data !== undefined && typeof msg.data === 'object' && !Array.isArray(msg.data)) {
                journalState = Object.assign(journalState, msg.data);
            }
            Object.keys(msg).forEach(function(key) {
                if (key !== 'type') {
                    journalState[key] = msg[key];
                }
            });
            if (msg.id !== undefined && msg.value !== undefined) {
                if (!journalState.tableData) journalState.tableData = {};
                journalState.tableData[msg.id] = msg.value;
            }
            if (msg.row !== undefined && msg.col !== undefined) {
                if (!journalState.cells) journalState.cells = {};
                journalState.cells[msg.row + '_' + msg.col] = msg.value !== undefined ? msg.value : msg.val;
            }

            saveJournalState();
            // Пересылаем изменения всем подключенным участникам
            broadcastAll(rawStr, ws);

        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 СЕРВЕР ЗАПУЩЕН И РАБОТАЕТ! (Порт ' + PORT + ')');
});
