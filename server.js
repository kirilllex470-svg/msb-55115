const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
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

const BEAR_SVG = [
    '<svg xmlns="http://w3.org" viewBox="0 0 800 500" width="100%" height="100%">',
    '<defs>',
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>',
    '<linearGradient id="fur" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#854d0e"/><stop offset="50%" stop-color="#5c3409"/><stop offset="100%" stop-color="#2e1905"/></linearGradient>',
    '<linearGradient id="furLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a16207"/><stop offset="100%" stop-color="#713f12"/></linearGradient>',
    '</defs>',
    '<rect width="800" height="500" fill="url(#sky)"/>',
    '<g fill="#14532d" opacity="0.55">',
    '<polygon points="80,90 20,380 140,380"/><polygon points="180,60 110,390 250,390"/>',
    '<polygon points="640,70 570,390 710,390"/><polygon points="730,110 670,390 790,390"/>',
    '<polygon points="310,120 250,380 370,380"/><polygon points="510,100 440,380 580,380"/>',
    '</g>',
    '<g fill="#166534" opacity="0.7">',
    '<polygon points="130,130 60,410 200,410"/><polygon points="600,120 520,410 680,410"/>',
    '</g>',
    '<path d="M50,500 L140,395 L330,370 L560,375 L730,415 L780,500 Z" fill="#64748b"/>',
    '<path d="M140,395 L330,370 L560,375 L640,420 L250,435 Z" fill="#94a3b8"/>',
    '<path d="M220,405 Q380,380 570,405" stroke="#4d7c0f" stroke-width="14" fill="none" stroke-linecap="round"/>',
    '<g id="bear">',
    '<path d="M350,135 Q430,115 515,165 Q595,210 585,310 L565,385 L505,385 L500,320 L455,320 L445,385 L385,385 L375,325 L340,385 L280,385 L275,265 Q275,165 350,135 Z" fill="url(#fur)" stroke="#1c0f02" stroke-width="4"/>',
    '<circle cx="270" cy="155" r="24" fill="#452306"/><circle cx="270" cy="155" r="13" fill="#271202"/>',
    '<circle cx="385" cy="150" r="24" fill="#452306"/><circle cx="385" cy="150" r="13" fill="#271202"/>',
    '<ellipse cx="328" cy="215" rx="76" ry="68" fill="url(#furLight)"/>',
    '<ellipse cx="312" cy="235" rx="35" ry="28" fill="#ca8a04"/>',
    '<ellipse cx="305" cy="224" rx="16" ry="12" fill="#0f172a"/>',
    '<path d="M292,244 Q308,255 328,244" stroke="#1e293b" stroke-width="4" fill="none" stroke-linecap="round"/>',
    '<circle cx="295" cy="195" r="6" fill="#090d16"/><circle cx="293" cy="193" r="2" fill="#fff"/>',
    '<circle cx="352" cy="195" r="6" fill="#090d16"/><circle cx="350" cy="193" r="2" fill="#fff"/>',
    '</g>',
    '</svg>'
].join('');
function createSolidPng(width, height, r, g, b) {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c;
    }
    function crc32(buf) {
        let c = -1;
        for (let i = 0; i < buf.length; i++) {
            c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
        }
        return (c ^ -1) >>> 0;
    }
    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
        return Buffer.concat([len, typeBuf, data, crc]);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 3);
        raw[rowStart] = 0;
        for (let x = 0; x < width; x++) {
            const p = rowStart + 1 + x * 3;
            const dx = x - width / 2;
            const dy = y - height / 2;
            if (dx * dx + dy * dy < (width * 0.36) * (width * 0.36)) {
                raw[p] = 133; raw[p + 1] = 77; raw[p + 2] = 14;
            } else {
                raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
            }
        }
    }
    const idat = zlib.deflateSync(raw);
    const sig = Buffer.from('89504e470d0a1a0a', 'hex');
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const GENERATED_ICON = createSolidPng(192, 192, 15, 23, 42);

const MANIFEST_JSON = JSON.stringify({
    id: "/",
    name: "МСБ55115 — Журнал событий",
    short_name: "МСБ55115",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-192.png", sizes: "512x512", type: "image/png", purpose: "any" }
    ]
});

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
    if (req.url === '/logo.jpg') {
        if (fs.existsSync('logo.jpg')) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(fs.readFileSync('logo.jpg'));
        } else if (fs.existsSync('logo.png')) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(fs.readFileSync('logo.png'));
        } else {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
            res.end(BEAR_SVG);
        }
        return;
    }
    if (req.url === '/icon-192.png') {
        if (fs.existsSync('icon-192.png')) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(fs.readFileSync('icon-192.png'));
        } else {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(GENERATED_ICON);
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
