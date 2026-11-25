const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const WebSocket = require('ws');
const webpush = require('web-push');

const storagePath = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(storagePath, 'history.json');
const ARCHIVE_FILE = path.join(storagePath, 'archive.json');
const NOTIFS_FILE = path.join(storagePath, 'notifications.json');
const MAPS_FILE = path.join(storagePath, 'maps.json');
const SUBS_FILE = path.join(storagePath, 'subscriptions.json');
const VAPID_FILE = path.join(storagePath, 'vapid.json');
const FCM_FILE = path.join(storagePath, 'fcm_tokens.json');

const USERS_FILE = path.join(storagePath, 'users.json');
const CHAT_ROOMS_FILE = path.join(storagePath, 'chat_rooms.json');
const FRIENDS_FILE = path.join(storagePath, 'friends.json');
const GROUPS_FILE = path.join(storagePath, 'groups.json');
const REQUESTS_FILE = path.join(storagePath, 'requests.json');
const READS_FILE = path.join(storagePath, 'last_read.json');
const PIN_RESET_FILE = path.join(storagePath, 'pin_resets.json');
const UPLOADS_DIR = path.join(storagePath, 'uploads');
let pinResetsDB = readJSON(PIN_RESET_FILE, {});

if (!fs.existsSync(UPLOADS_DIR)) {
    try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    } catch (e) {}
}

function readJSON(filePath, defaultVal) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return raw.trim() ? JSON.parse(raw) : defaultVal;
        }
    } catch (e) {}
    return defaultVal;
}

let fcmAdmin = null;
try {
    const admin = require('firebase-admin');
    const keyPath = fs.existsSync('/data/firebase-key.json')
        ? '/data/firebase-key.json'
        : path.join(__dirname, 'firebase-key.json');
    if (fs.existsSync(keyPath)) {
        const serviceAccount = require(keyPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        fcmAdmin = admin;
        console.log('✅ Firebase FCM успешно подключен!');
    }
} catch (e) {
    console.log('⚠️ Firebase FCM не запущен:', e.message);
}

let fcmTokens = readJSON(FCM_FILE, []);
if (!Array.isArray(fcmTokens)) fcmTokens = [];

function atomicWriteFileSync(filePath, contentStr) {
    const tmpFile = filePath + '.tmp_' + process.pid;
    try {
        fs.writeFileSync(tmpFile, contentStr, 'utf-8');
        fs.renameSync(tmpFile, filePath);
    } catch (e) {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e2) {}
    }
}

const writeTimers = {};
function writeJSON(filePath, data, immediate) {
    if (immediate) {
        atomicWriteFileSync(filePath, JSON.stringify(data, null, 2));
        return;
    }
    if (writeTimers[filePath]) {
        clearTimeout(writeTimers[filePath]);
    }
    writeTimers[filePath] = setTimeout(function() {
        delete writeTimers[filePath];
        atomicWriteFileSync(filePath, JSON.stringify(data, null, 2));
    }, 150);
}


function sendJsonCompressed(req, res, statusCode, payloadObj, cacheHeader) {
    const jsonStr = JSON.stringify(payloadObj);
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheHeader || 'no-cache'
    };
    const acceptEnc = (req.headers && req.headers['accept-encoding']) ? req.headers['accept-encoding'] : '';
    if (jsonStr.length > 1024 && acceptEnc.includes('gzip')) {
        zlib.gzip(Buffer.from(jsonStr, 'utf-8'), function(err, zipped) {
            if (!err && zipped) {
                headers['Content-Encoding'] = 'gzip';
                headers['Content-Length'] = zipped.length;
                res.writeHead(statusCode, headers);
                res.end(zipped);
            } else {
                res.writeHead(statusCode, headers);
                res.end(jsonStr);
            }
        });
    } else {
        res.writeHead(statusCode, headers);
        res.end(jsonStr);
    }
}
let vapidKeys = fs.existsSync(VAPID_FILE) ? readJSON(VAPID_FILE, null) : null;
if (!vapidKeys || !vapidKeys.publicKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    writeJSON(VAPID_FILE, vapidKeys, true);
}
webpush.setVapidDetails('mailto:support@msb55115.ru', vapidKeys.publicKey, vapidKeys.privateKey);


let pushSubscriptions = readJSON(SUBS_FILE, new Array());
if (!Array.isArray(pushSubscriptions)) {
    pushSubscriptions = new Array();
}

let usersDB = readJSON(USERS_FILE, {});
usersDB['муравей'] = {
    username: 'муравей',
    password: '551150000',
    unit: 'АДМИН',
    approved: true,
    avatar: (usersDB['муравей'] && usersDB['муравей'].avatar) ? usersDB['муравей'].avatar : '',
    permissions: {
        row: true,
        stream: true,
        maps: true,
        archive: true,
        table: true
    }
};
writeJSON(USERS_FILE, usersDB, true);

let roomsDB = readJSON(CHAT_ROOMS_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {});
const db = {
    lastRead: readJSON(READS_FILE, {})
};

const LAST_SEEN_FILE = path.join(storagePath, 'last_seen.json');
const lastSeenDB = readJSON(LAST_SEEN_FILE, {});
const typingDB = {};
const onlinePresenceCache = {};

function formatTimestampRu(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts) + 3 * 3600 * 1000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return dd + '.' + mm + '.' + yyyy + ' ' + hh + ':' + min;
}

function hasActiveWsForUser(cleanKey) {
    if (typeof wss === 'undefined' || !wss || !wss.clients) return false;
    let found = false;
    wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN && client.userIdentity === cleanKey) {
            found = true;
        }
    });
    return found;
}

function markUserOnline(name, wsClient) {
    if (!name) return;
    const key = String(name).trim().toLowerCase();
    if (!key || key === 'гость' || key === 'просмотр') return;
    if (wsClient) {
        wsClient.userIdentity = key;
        wsClient.isAway = false;
    }
    const prev = lastSeenDB[key] || 0;
    const now = Date.now();
    const wasOnline = Boolean(onlinePresenceCache[key]);
    lastSeenDB[key] = now;
    onlinePresenceCache[key] = true;
    if (!wasOnline && typeof broadcastWS === 'function') {
        broadcastWS({ type: 'presence_update', user: key, online: true, lastSeen: formatTimestampRu(now) });
    }
    if (now - prev > 10000) {
        writeJSON(LAST_SEEN_FILE, lastSeenDB);
    }
}

function hasActiveVisibleWsForUser(cleanKey) {
    if (typeof wss === 'undefined' || !wss || !wss.clients) return false;
    let found = false;
    wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN && client.userIdentity === cleanKey && !client.isAway) {
            found = true;
        }
    });
    return found;
}

function isUserOnlineNow(name) {
    if (!name) return false;
    const key = String(name).trim().toLowerCase();
    if (hasActiveVisibleWsForUser(key)) return true;
    const t = lastSeenDB[key] || 0;
    return (Date.now() - t) < 25000;
}



function getUserLastSeenStr(name) {
    if (!name) return '';
    const key = String(name).trim().toLowerCase();
    const t = lastSeenDB[key] || 0;
    return t ? formatTimestampRu(t) : '';
}

let tableHistory = readJSON(DB_FILE, new Array());
if (!Array.isArray(tableHistory)) tableHistory = new Array();
let archiveHistory = readJSON(ARCHIVE_FILE, {});
let notificationsHistory = readJSON(NOTIFS_FILE, new Array());
if (!Array.isArray(notificationsHistory)) notificationsHistory = new Array();
let mapsHistory = readJSON(MAPS_FILE, new Array());
if (!Array.isArray(mapsHistory)) mapsHistory = new Array();

let activeAlerts = {};
let streamState = { active: false, url: '' };

function getServerDateTime() {
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return dd + '.' + mm + '.' + yyyy + ' ' + hh + ':' + min;
}

var SERVER_BOOT_ID = 'build_' + Date.now();
var SERVER_BOOT_TIME = getServerDateTime();

function makeTacticalIcon(size) {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable.fill(c, n, n + 1);
    }
    function crc32(buf) {
        let c = -1;
        for (let i = 0; i < buf.length; i++) {
            const b = buf.readUInt8(i);
            const idx = (c ^ b) & 0xff;
            const t = crcTable.subarray(idx, idx + 1).reduce(function(a, v) { return v; }, 0);
            c = (c >>> 8) ^ t;
        }
        return (c ^ -1) >>> 0;
    }
    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const t = Buffer.from(type, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat(Array.of(t, data))), 0);
        return Buffer.concat(Array.of(len, t, data, crc));
    }
    const ihdr = Buffer.alloc(13, 0);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);
    const rowLen = 1 + size * 3;
    const raw = Buffer.alloc(size * rowLen, 0);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
        const rowOff = y * rowLen;
        raw.writeUInt8(0, rowOff);
        for (let x = 0; x < size; x++) {
            const p = rowOff + 1 + x * 3;
            const dx = (x - half) / half;
            const dy = (y - half) / half;

            const r = Math.hypot(dx, dy);
            let red = 11, green = 18, blue = 32;

            if (r <= 0.94) {
                red = 22; green = 163; blue = 74;
                const outerRing = (0.64 <= r && r <= 0.78);
                const innerRing = (0.30 <= r && r <= 0.40);
                const crossH = (Math.abs(dy) <= 0.055 && 0.16 <= Math.abs(dx) && Math.abs(dx) <= 0.86);
                const crossV = (Math.abs(dx) <= 0.055 && 0.16 <= Math.abs(dy) && Math.abs(dy) <= 0.86);
                const centerDot = (r <= 0.14);

                if (outerRing || innerRing || crossH || crossV || centerDot) {
                    red = 248; green = 250; blue = 252;
                }
            }
            raw.writeUInt8(red, p);
            raw.writeUInt8(green, p + 1);
            raw.writeUInt8(blue, p + 2);
        }
    }

    const idat = zlib.deflateSync(raw);
    const sig = Buffer.from('89504e470d0a1a0a', 'hex');
    return Buffer.concat(Array.of(sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))));
}

const CUSTOM_LOGO_PATH = ['logo.jpg', 'logo.jpeg', 'logo.JPG', 'logo.png']
    .map(function(name) { return path.join(__dirname, name); })
    .find(function(full) { return fs.existsSync(full); });
const CUSTOM_LOGO_BUF = CUSTOM_LOGO_PATH ? fs.readFileSync(CUSTOM_LOGO_PATH) : null;
const CUSTOM_LOGO_MIME = (CUSTOM_LOGO_PATH && CUSTOM_LOGO_PATH.toLowerCase().endsWith('.png')) ? 'image/png' : 'image/jpeg';

const TACTICAL_ICON_192 = CUSTOM_LOGO_BUF || makeTacticalIcon(192);
const TACTICAL_ICON_512 = CUSTOM_LOGO_BUF || makeTacticalIcon(512);


const MANIFEST_JSON = JSON.stringify({
    name: "МСБ-55115",
    short_name: "МСБ55115",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: Array.of(
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
    )
});

const SW_CODE = [
    "const SHELL_CACHE = 'msb55115-shell-v33';",
    "const MEDIA_CACHE = 'msb55115-media-v1';",
    "const SHELL_ASSETS = [",
    "    '/',",
    "    '/index.html',",
    "    '/style.css',",
    "    '/journal.js',",
    "    '/messenger.js',",
    "    '/manifest.json',",
    "    '/icon-192.png',",
    "    '/icon-512.png'",
    "];",
    "",
    "self.addEventListener('install', function(e) {",
    "    self.skipWaiting();",
    "    e.waitUntil(caches.open(SHELL_CACHE).then(function(cache) { return cache.addAll(SHELL_ASSETS); }));",
    "});",
    "self.addEventListener('activate', function(e) {",
    "    e.waitUntil(caches.keys().then(function(keys) {",
    "        return Promise.all(keys.map(function(k) {",
    "            if (k !== SHELL_CACHE && k !== MEDIA_CACHE) return caches.delete(k);",
    "        }));",
    "    }).then(function() { return clients.claim(); }));",
    "});",
    "",
    "function buildRangeResponse(request, cachedResponse) {",
    "    const rangeHeader = request.headers.get('range');",
    "    if (!rangeHeader) return Promise.resolve(cachedResponse);",
    "    return cachedResponse.arrayBuffer().then(function(buf) {",
    "        const bytes = /^bytes=(\\d+)-(\\d+)?$/.exec(rangeHeader);",
    "        if (!bytes) return cachedResponse;",
    "        const start = Number(bytes.at(1));",
    "        const end = bytes.at(2) ? Number(bytes.at(2)) : buf.byteLength - 1;",
    "        const slice = buf.slice(start, end + 1);",
    "        return new Response(slice, {",
    "            status: 206,",
    "            statusText: 'Partial Content',",
    "            headers: {",
    "                'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,",
    "                'Accept-Ranges': 'bytes',",
    "                'Content-Length': String(slice.byteLength),",
    "                'Content-Type': cachedResponse.headers.get('Content-Type') || 'application/octet-stream'",
    "            }",
    "        });",
    "    });",
    "}",
    "",
    "self.addEventListener('fetch', function(event) {",
    "    const url = new URL(event.request.url);",
    "    if (event.request.method !== 'GET') return;",
    "    if (url.pathname.startsWith('/api/') || url.pathname === '/maps-list' || url.pathname === '/archive-data') return;",
    "    if (url.pathname.startsWith('/uploads/')) {",
    "        event.respondWith(caches.open(MEDIA_CACHE).then(function(cache) {",
    "            return cache.match(url.pathname).then(function(cachedRes) {",
    "                if (cachedRes) return buildRangeResponse(event.request, cachedRes);",
    "                return fetch(url.pathname).then(function(networkRes) {",
    "                    if (networkRes && networkRes.status === 200) {",
    "                        cache.put(url.pathname, networkRes.clone());",
    "                        return buildRangeResponse(event.request, networkRes);",
    "                    }",
    "                    return networkRes;",
    "                });",
    "            });",
    "        }));",
    "        return;",
    "    }"
].join('\n') + '\n' + [
    "    event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(function(cachedRes) {",
    "        const netFetch = fetch(event.request).then(function(networkRes) {",
    "            if (networkRes && networkRes.status === 200) {",
    "                const resClone = networkRes.clone();",
    "                caches.open(SHELL_CACHE).then(function(cache) { cache.put(event.request, resClone); });",
    "            }",
    "            return networkRes;",
    "        }).catch(function() { return cachedRes; });",
    "        return cachedRes || netFetch;",
    "    }));",
    "});",
    "",
    "self.addEventListener('push', function(event) {",
    "    var data = { title: '🛑 ТРЕВОГА В МСБ-55115!', body: 'Новое сообщение в системе!', tag: 'msb-alert-' + Date.now() };",
    "    if (event.data) {",
    "        try { data = event.data.json(); } catch (e) { data.body = event.data.text() || data.body; }",
    "    }",
    "    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(winList) {",
    "        var isFocusedNow = winList.some(function(w) { return w.focused === true; });",
    "        if (isFocusedNow) return;",
    "        return self.registration.showNotification(data.title || '🛑 МСБ-55115', {",
    "            body: data.body || 'Откройте приложение',",
    "            icon: data.icon || '/icon-192.png',",
    "            badge: '/icon-192.png',",
    "            vibrate: Array.of(400, 100, 400, 100, 600),",
    "            silent: false,",
    "            requireInteraction: true,",
    "            renotify: true,",
    "            tag: data.tag || 'msb-push',",
    "            data: { url: data.url || '/' }",
    "        });",
    "    }));",
    "});",

    "",
    "self.addEventListener('pushsubscriptionchange', function(event) {",
    "    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {",
    "        list.forEach(function(cl) { cl.postMessage({ type: 'resubscribe_push' }); });",
    "    }));",
    "});",
    "",
    "self.addEventListener('notificationclick', function(event) {",
    "    event.notification.close();",
    "    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "        for (var i = 0; i < clientList.length; i++) {",
    "            var cl = clientList.at(i);",
    "            if (cl && 'focus' in cl) {",
    "                cl.postMessage({ type: 'wake_sync' });",
    "                return cl.focus();",
    "            }",
    "        }",
    "        if (clients.openWindow) return clients.openWindow('/');",
    "    }));",
    "});"
].join('\n');

function readBodyJSON(req, cb) {
    const chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() {
        try {
            cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
            cb(e, null);
        }
    });
}
const server = http.createServer(function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-update-secret, x-chunk-index, x-total-chunks, x-version-code, x-version-name');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }
    const urlPath = (req.url || '/').split('?').at(0);


    if (urlPath === '/sw.js') {
        res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Service-Worker-Allowed': '/',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(SW_CODE);
    }

    if (urlPath === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        return res.end(MANIFEST_JSON);
    }

    if (urlPath === '/icon-192.png' || urlPath === '/favicon.ico') {
        res.writeHead(200, { 'Content-Type': CUSTOM_LOGO_MIME, 'Cache-Control': 'public, max-age=86400' });
        return res.end(TACTICAL_ICON_192);
    }

    if (urlPath === '/icon-512.png') {
        res.writeHead(200, { 'Content-Type': CUSTOM_LOGO_MIME, 'Cache-Control': 'public, max-age=86400' });
        return res.end(TACTICAL_ICON_512);
    }

    if (urlPath.startsWith('/api/avatar-img/')) {
        const isSvgReq = urlPath.toLowerCase().endsWith('.svg');
        const rawName = decodeURIComponent(urlPath.replace('/api/avatar-img/', '').replace(/\.(jpg|svg)$/i, '')).trim().toLowerCase();
        const uObj = usersDB[rawName];
        if (isSvgReq && uObj && uObj.avatar && uObj.avatar.startsWith('data:image/')) {
            const svgCircle = '<svg xmlns="http://w3.org" width="192" height="192" viewBox="0 0 192 192">' +
                '<defs><clipPath id="c"><circle cx="96" cy="96" r="96"/></clipPath></defs>' +
                '<image href="' + uObj.avatar + '" width="192" height="192" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>' +
                '</svg>';
            res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' });
            return res.end(svgCircle);
        }
        if (uObj && uObj.avatar && uObj.avatar.startsWith('data:image/')) {
            const parts = uObj.avatar.split(',');
            const imgBuf = Buffer.from(parts.at(1), 'base64');
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' });
            return res.end(imgBuf);
        }
        res.writeHead(200, { 'Content-Type': CUSTOM_LOGO_MIME, 'Cache-Control': 'public, max-age=300' });
        return res.end(TACTICAL_ICON_192);
    }




    if (urlPath === '/style.css' || urlPath === '/journal.js' || urlPath === '/messenger.js') {
        const cType = urlPath.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
        fs.readFile(path.join(__dirname, urlPath.slice(1)), function(err, data) {
            if (err) {
                res.writeHead(404);
                return res.end('Not Found');
            }
            const acceptEnc = (req.headers && req.headers['accept-encoding']) ? req.headers['accept-encoding'] : '';
            if (acceptEnc.includes('gzip')) {
                zlib.gzip(data, function(zErr, zipped) {
                    if (!zErr && zipped) {
                        res.writeHead(200, {
                            'Content-Type': cType,
                            'Content-Encoding': 'gzip',
                            'Cache-Control': 'no-cache'
                        });
                        return res.end(zipped);
                    }
                    res.writeHead(200, { 'Content-Type': cType, 'Cache-Control': 'no-cache' });
                    res.end(data);
                });
            } else {
                res.writeHead(200, { 'Content-Type': cType, 'Cache-Control': 'no-cache' });
                res.end(data);
            }
        });
        return;
    }

        if (req.method === 'GET' && urlPath === '/api/bg-sync') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const uLow = (myUrl.searchParams.get('unit') || '').trim().toLowerCase();
        const cLow = (myUrl.searchParams.get('callsign') || '').trim().toLowerCase();


        const unreadAlerts = notificationsHistory.filter(function(n) {
            if (!n || n.read) return false;
            const tLow = String(n.target || '').trim().toLowerCase();
            const sLow = String(n.sender || '').trim().toLowerCase();
            if (cLow && (sLow === cLow || sLow.includes('(' + cLow + ')'))) return false;
            if (!cLow && uLow && sLow === uLow) return false;
            return tLow === 'всем' || (cLow && tLow === cLow) || (uLow && tLow === uLow);
        }).slice(-10);

        return sendJsonCompressed(req, res, 200, { alerts: unreadAlerts }, 'no-store');
    }

    if (req.method === 'GET' && urlPath === '/api/ping') {
        return sendJsonCompressed(req, res, 200, { ok: true, bootId: SERVER_BOOT_ID, ts: Date.now() }, 'no-store');
    }


     if (req.method === 'POST' && urlPath === '/api/fcm/register') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.token) {
                const proto = req.headers['x-forwarded-proto'] || 'https';
                const host = req.headers.host || '';
                const baseOrigin = host ? (proto + '://' + host) : '';
                const themeName = data.theme || 'military';
                const soundId = data.soundId || 'alarm1';
                if (data.callsign) {
                    const ck = String(data.callsign).trim().toLowerCase();
                    if (usersDB[ck]) {
                        usersDB[ck].theme = themeName;
                        usersDB[ck].soundId = soundId;
                        writeJSON(USERS_FILE, usersDB);
                    }
                }

                const callLow = String(data.callsign || '').trim().toLowerCase();
                if (callLow) {
                    fcmTokens = fcmTokens.filter(function(t) {
                        return t.token === data.token || String(t.callsign || '').trim().toLowerCase() !== callLow;
                    });
                }
                const idx = fcmTokens.findIndex(function(t) { return t.token === data.token; });

                if (idx !== -1) {

                    fcmTokens[idx].user = data.user || 'ГОСТЬ';
                    fcmTokens[idx].callsign = data.callsign || '';
                    fcmTokens[idx].theme = themeName;
                    if (baseOrigin) fcmTokens[idx].origin = baseOrigin;
                } else {
                    fcmTokens.push({
                        user: data.user || 'ГОСТЬ',
                        callsign: data.callsign || '',
                        theme: themeName,
                        token: data.token,
                        origin: baseOrigin
                    });
                }
                writeJSON(FCM_FILE, fcmTokens);
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }



    if (req.method === 'POST' && urlPath === '/api/push/subscribe') {
        return readBodyJSON(req, function(err, data) {

            if (!err && data && data.sub && data.sub.endpoint) {
                if (data.callsign) markUserOnline(data.callsign);
                const idx = pushSubscriptions.findIndex(function(s) {
                    return s.sub && s.sub.endpoint === data.sub.endpoint;
                });
                if (idx !== -1) {
                    pushSubscriptions[idx].user = data.user || 'ГОСТЬ';
                    pushSubscriptions[idx].callsign = data.callsign || '';
                    pushSubscriptions[idx].sub = data.sub;
                } else {
                    pushSubscriptions.push({
                        user: data.user || 'ГОСТЬ',
                        callsign: data.callsign || '',
                        sub: data.sub
                    });
                }
                writeJSON(SUBS_FILE, pushSubscriptions);
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }
    if (req.method === 'POST' && urlPath === '/api/auth/register') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.username || !data.password || !data.unit) {
                return sendJsonCompressed(req, res, 400, { success: false, message: 'Заполните все поля' });
            }
            const key = data.username.trim().toLowerCase();
            if (usersDB[key]) {
                return sendJsonCompressed(req, res, 200, { success: false, message: 'Этот позывной уже занят!' });
            }
            usersDB[key] = {
                username: data.username.trim(),
                password: data.password.trim(),
                unit: data.unit,
                approved: false,
                avatar: '',
                permissions: { row: false, stream: false, maps: false, archive: false, table: false }
            };
            writeJSON(USERS_FILE, usersDB);
            broadcastWS({ type: 'users_updated' });
            broadcastAlert(
                data.unit,
                '#38bdf8',
                getServerDateTime(),
                'АДМИН',
                '📝 НОВАЯ ЗАЯВКА НА РЕГИСТРАЦИЮ: Позывной (' + data.username.trim() + ') (' + data.unit + '). Откройте "Пользователи и заявки"!'
            );
            return sendJsonCompressed(req, res, 200, { success: true });
        });
    }

    if (req.method === 'POST' && urlPath === '/api/auth/login') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.username || !data.password) {
                return sendJsonCompressed(req, res, 400, { success: false, message: 'Пустые поля' });
            }
            const u = usersDB[data.username.trim().toLowerCase()];
            if (!u) {
                return sendJsonCompressed(req, res, 200, { success: false, message: 'Позывной не найден. Нажмите "Регистрация"!' });
            }
            if (u.password !== data.password.trim()) {
                return sendJsonCompressed(req, res, 200, { success: false, message: 'Неверный пароль!' });
            }
            if (u.approved === false) {
                return sendJsonCompressed(req, res, 200, { success: false, message: '⏳ Заявка еще не одобрена АДМИНОМ!' });
            }
            markUserOnline(u.username);
            return sendJsonCompressed(req, res, 200, {
                success: true,
                username: u.username,
                unit: u.unit,
                permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
            });
        });
    }

    if (req.method === 'GET' && urlPath === '/api/user/me') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = (myUrl.searchParams.get('user') || '').trim().toLowerCase();
        const skipAv = myUrl.searchParams.get('noav') === '1';
        const u = usersDB[user] || {};
        if (user) markUserOnline(user);
        const avHash = u.avatar ? String(u.avatar.length) : '';
        return sendJsonCompressed(req, res, 200, {
            avatar: skipAv ? undefined : (u.avatar || ''),
            avatarHash: avHash,
            hasPin: Boolean(u.pinCode),
            unit: u.unit || '',
            permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
        });
    }

    if (req.method === 'GET' && urlPath === '/api/user/avatar') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = (myUrl.searchParams.get('user') || '').trim().toLowerCase();
        const u = usersDB[user] || {};
        return sendJsonCompressed(req, res, 200, { user: user, avatar: u.avatar || '' });
    }
    if (req.method === 'POST' && urlPath === '/api/user/avatar') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && data.avatar) {
                const k = data.user.trim().toLowerCase();
                if (!usersDB[k]) {
                    usersDB[k] = { username: data.user.trim(), password: '', unit: '', approved: true };
                }
                usersDB[k].avatar = data.avatar;
                writeJSON(USERS_FILE, usersDB);
                broadcastWS({ type: 'avatar_updated', user: k });
                broadcastWS({ type: 'users_updated' });
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }

     if (req.method === 'POST' && urlPath === '/api/user/pin/set') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user || !data.pin || !/^\d{4}$/.test(String(data.pin)) || !data.question || !data.answer) {
                return sendJsonCompressed(req, res, 400, { ok: false, message: 'Нужны 4 цифры, контрольный вопрос и ответ' });
            }
            const k = String(data.user).trim().toLowerCase();
            if (!usersDB[k]) {
                return sendJsonCompressed(req, res, 404, { ok: false, message: 'Пользователь не найден' });
            }
            usersDB[k].pinCode = String(data.pin);
            usersDB[k].pinQuestion = String(data.question).trim();
            usersDB[k].pinAnswer = String(data.answer).trim();
            writeJSON(USERS_FILE, usersDB, true);
            broadcastWS({ type: 'users_updated' });
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }

    if (req.method === 'POST' && urlPath === '/api/user/pin/verify') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user || !data.pin) {
                return sendJsonCompressed(req, res, 400, { ok: false });
            }
            const k = String(data.user).trim().toLowerCase();
            const u = usersDB[k];
            const valid = Boolean(u && u.pinCode && String(u.pinCode) === String(data.pin).trim());
            return sendJsonCompressed(req, res, 200, { ok: valid });
        });
    }

    if (req.method === 'POST' && urlPath === '/api/user/pin/forgot') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user) {
                return sendJsonCompressed(req, res, 400, { ok: false });
            }
            const k = String(data.user).trim().toLowerCase();
            const u = usersDB[k];
            if (!u || !u.pinCode) {
                return sendJsonCompressed(req, res, 404, { ok: false, message: 'ПИН-код не установлен' });
            }
            pinResetsDB[k] = {
                key: k,
                username: u.username,
                unit: u.unit || '—',
                question: u.pinQuestion || 'Контрольный вопрос не задан',
                expectedAnswer: u.pinAnswer || '',
                userAnswer: '',
                status: 'waiting_user',
                time: getServerDateTime()
            };
            writeJSON(PIN_RESET_FILE, pinResetsDB, true);
            broadcastAlert(
                u.username,
                '#facc15',
                getServerDateTime(),
                'АДМИН',
                '🔐 ЗАБЫТ ПИН-КОД: Боец ' + u.username + ' (' + (u.unit || '') + ') запросил разблокировку! Откройте "Пользователи и заявки".'
            );
            broadcastWS({ type: 'users_updated' });
            return sendJsonCompressed(req, res, 200, { ok: true, question: pinResetsDB[k].question });
        });
    }

    if (req.method === 'POST' && urlPath === '/api/user/pin/answer') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user || !data.answer) {
                return sendJsonCompressed(req, res, 400, { ok: false });
            }
            const k = String(data.user).trim().toLowerCase();
            if (!pinResetsDB[k]) {
                return sendJsonCompressed(req, res, 404, { ok: false });
            }
            pinResetsDB[k].userAnswer = String(data.answer).trim();
            pinResetsDB[k].status = 'waiting_admin';
            writeJSON(PIN_RESET_FILE, pinResetsDB, true);
            broadcastAlert(
                pinResetsDB[k].username,
                '#38bdf8',
                getServerDateTime(),
                'АДМИН',
                '🔑 ОТВЕТ НА ВОПРОС ПИН-КОДА от ' + pinResetsDB[k].username + ': «' + pinResetsDB[k].userAnswer + '». Подтвердите разблокировку!'
            );
            broadcastWS({ type: 'users_updated' });
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }

    if (req.method === 'GET' && urlPath === '/api/user/pin/status') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const k = (myUrl.searchParams.get('user') || '').trim().toLowerCase();
        const u = usersDB[k] || {};
        const rst = pinResetsDB[k] || null;
        return sendJsonCompressed(req, res, 200, {
            hasPin: Boolean(u.pinCode),
            question: u.pinQuestion || '',
            resetState: rst ? rst.status : 'none'
        });
    }


    if (req.method === 'GET' && urlPath === '/api/admin/users') {
        const pending = new Array();
        const approved = new Array();
        Object.keys(usersDB).forEach(function(k) {
            const u = usersDB[k];
            const item = {
                key: k,
                username: u.username,
                password: u.password,
                pinCode: u.pinCode || '',
                pinQuestion: u.pinQuestion || '',
                pinAnswer: u.pinAnswer || '',
                unit: u.unit || '—',
                permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
            };
            if (u.approved === false) pending.push(item);
            else approved.push(item);
        });
        const pinResets = Object.values(pinResetsDB).filter(function(r) { return r && r.status !== 'unlocked'; });
        return sendJsonCompressed(req, res, 200, { pending: pending, approved: approved, pinResets: pinResets });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/users/action') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.key && usersDB[data.key]) {
                if (data.action === 'approve') usersDB[data.key].approved = true;
                else if (data.action === 'delete') delete usersDB[data.key];
                else if (data.action === 'approve_pin_reset') {
                    delete usersDB[data.key].pinCode;
                    delete usersDB[data.key].pinQuestion;
                    delete usersDB[data.key].pinAnswer;
                    if (pinResetsDB[data.key]) {
                        pinResetsDB[data.key].status = 'unlocked';
                        writeJSON(PIN_RESET_FILE, pinResetsDB, true);
                    }
                    broadcastWS({ type: 'pin_unlocked_by_admin', user: data.key });
                }
                else if (data.action === 'set_perm' && data.permName) {
                    if (!usersDB[data.key].permissions) {
                        usersDB[data.key].permissions = { row: false, stream: false, maps: false, archive: false, table: false };
                    }
                    usersDB[data.key].permissions[data.permName] = Boolean(data.permVal);
                }
                writeJSON(USERS_FILE, usersDB);
                broadcastWS({ type: 'users_updated' });
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }


    if (req.method === 'GET' && urlPath === '/maps-list') {
        return sendJsonCompressed(req, res, 200, mapsHistory, 'no-store');
    }

    if (req.method === 'GET' && urlPath === '/archive-data') {
        return sendJsonCompressed(req, res, 200, archiveHistory, 'no-store');
    }

    if (req.method === 'POST' && urlPath === '/upload-map') {
        const chunks = new Array();
        req.on('data', function(chunk) { chunks.push(chunk); });
        req.on('end', function() {
            try {
                const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (msg && msg.image) {
                    saveAndBroadcastMap(msg);
                    return sendJsonCompressed(req, res, 200, { ok: true, maps: mapsHistory });
                }
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false }));
            }
        });
        return;
    }
    if (urlPath === '/api/friends/get' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = myUrl.searchParams.get('user');
        const omitAvatars = myUrl.searchParams.get('noav') === '1';
        if (!user) {
            return sendJsonCompressed(req, res, 200, new Array());
        }
        const myLowerName = String(user).trim().toLowerCase();
        markUserOnline(myLowerName);
        const myFriends = Array.isArray(friendsDB[myLowerName]) ? friendsDB[myLowerName] : new Array();
        const myReads = db.lastRead[myLowerName] || {};
        const listData = myFriends.map(function(friendName) {
            const sortedRoom = Array.of(myLowerName, String(friendName).trim().toLowerCase()).sort();
            const pair = sortedRoom.join(',');
            const roomId = pair + '_' + pair;
            return buildChatPreviewItem(friendName, roomId, myLowerName, myReads[roomId] || 0, false, omitAvatars);
        });
        Object.keys(groupsDB).forEach(function(groupId) {
            const group = groupsDB[groupId];
            const normGid = String(groupId).trim().toLowerCase();
            if (group && Array.isArray(group.members) && group.members.some(function(m) {
                return String(m).trim().toLowerCase() === myLowerName;
            })) {
                listData.push(buildChatPreviewItem(group.name, roomsDB[normGid] ? normGid : groupId, myLowerName, myReads[groupId] || 0, true, omitAvatars));
            }
        });
        return sendJsonCompressed(req, res, 200, listData, 'no-store');

    }

    if (urlPath === '/api/friends/request/send' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.from || !data.to) {
                return sendJsonCompressed(req, res, 400, { success: false, message: 'Неполные данные' });
            }
            const targetKey = data.to.trim().toLowerCase();
            const stdUnits = Array.of('шр', 'рота-1', 'рота-2', 'рота-3', 'админ');
            if (!usersDB[targetKey] && !stdUnits.includes(targetKey)) {
                return sendJsonCompressed(req, res, 200, { success: false, message: 'Позывной или Подразделение не найдены в системе!' });
            }
            if (!Array.isArray(requestsDB[targetKey])) requestsDB[targetKey] = new Array();
            const alreadyRequested = requestsDB[targetKey].some(function(n) {
                return n.toLowerCase() === data.from.trim().toLowerCase();
            });
            if (!alreadyRequested) {
                requestsDB[targetKey].push(data.from.trim());
                writeJSON(REQUESTS_FILE, requestsDB);
            }
            broadcastWS({ type: 'users_updated' });
            return sendJsonCompressed(req, res, 200, { success: true });
        });
    }

    if (urlPath === '/api/friends/requests' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = myUrl.searchParams.get('user');
        const list = (user && Array.isArray(requestsDB[user.toLowerCase()])) ? requestsDB[user.toLowerCase()] : new Array();
        return sendJsonCompressed(req, res, 200, list);
    }

    if (urlPath === '/api/friends/request/respond' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user || !data.from || !data.action) {
                res.writeHead(400);
                return res.end('Bad');
            }
            const myL = data.user.toLowerCase();
            const fromL = data.from.toLowerCase();
            if (Array.isArray(requestsDB[myL])) {
                requestsDB[myL] = requestsDB[myL].filter(function(n) { return n.toLowerCase() !== fromL; });
                writeJSON(REQUESTS_FILE, requestsDB);
            }
            if (data.action === 'accept') {
                const tMy = usersDB[myL] ? usersDB[myL].username : data.user;
                const tFr = usersDB[fromL] ? usersDB[fromL].username : data.from;
                if (!Array.isArray(friendsDB[myL])) friendsDB[myL] = new Array();
                if (!friendsDB[myL].some(function(n) { return n.toLowerCase() === fromL; })) friendsDB[myL].push(tFr);
                if (!Array.isArray(friendsDB[fromL])) friendsDB[fromL] = new Array();
                if (!friendsDB[fromL].some(function(n) { return n.toLowerCase() === myL; })) friendsDB[fromL].push(tMy);
                writeJSON(FRIENDS_FILE, friendsDB);
            }
            broadcastWS({ type: 'users_updated' });
            res.writeHead(200);
            res.end('OK');
        });
    }
    if (urlPath === '/api/friends/save' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && Array.isArray(data.friends)) {
                friendsDB[data.user.toLowerCase()] = data.friends;
                writeJSON(FRIENDS_FILE, friendsDB);
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200);
            res.end('OK');
        });
    }

    if (urlPath === '/api/groups/create' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.creator || !data.groupName || !Array.isArray(data.members)) {
                res.writeHead(400);
                return res.end('Bad');
            }
            const groupId = 'group_' + crypto.randomBytes(6).toString('hex');
            if (!data.members.map(function(m) { return m.toLowerCase(); }).includes(data.creator.toLowerCase())) {
                data.members.push(data.creator);
            }
            groupsDB[groupId] = { name: data.groupName, members: data.members, creator: data.creator };
            writeJSON(GROUPS_FILE, groupsDB);
            broadcastWS({ type: 'users_updated' });
            return sendJsonCompressed(req, res, 200, { success: true, groupId: groupId });
        });
    }

    if (urlPath === '/api/groups/delete' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.groupId && groupsDB[data.groupId]) {
                const reqUser = String(data.user || '').trim().toLowerCase();
                if (reqUser && Array.isArray(groupsDB[data.groupId].members)) {
                    groupsDB[data.groupId].members = groupsDB[data.groupId].members.filter(function(m) {
                        return String(m).trim().toLowerCase() !== reqUser;
                    });
                }
                if (!reqUser || !Array.isArray(groupsDB[data.groupId].members) || groupsDB[data.groupId].members.length === 0) {
                    delete groupsDB[data.groupId];
                    if (roomsDB[data.groupId]) {
                        delete roomsDB[data.groupId];
                        writeJSON(CHAT_ROOMS_FILE, roomsDB);
                    }
                }
                writeJSON(GROUPS_FILE, groupsDB);
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200);
            res.end('OK');
        });
    }

    if (urlPath === '/api/messages/delete' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            const roomKey = data && data.room ? String(data.room).trim().toLowerCase() : '';
            if (!err && roomKey && data.messageId && Array.isArray(roomsDB[roomKey])) {
                roomsDB[roomKey] = roomsDB[roomKey].filter(function(m) { return m.id !== data.messageId; });
                writeJSON(CHAT_ROOMS_FILE, roomsDB, true);
                broadcastWS({ type: 'chat_msg_deleted', room: roomKey, messageId: data.messageId });
            }
            res.writeHead(200);
            res.end('OK');
        });
    }

    if (urlPath === '/api/messages/edit' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            const roomKey = data && data.room ? String(data.room).trim().toLowerCase() : '';
            if (!err && roomKey && data.messageId && typeof data.text === 'string' && Array.isArray(roomsDB[roomKey])) {
                const cleanTxt = data.text.trim();
                const msg = roomsDB[roomKey].find(function(m) { return String(m.id) === String(data.messageId); });
                if (msg && cleanTxt && (!msg.type || msg.type === 'text')) {
                    msg.text = cleanTxt;
                    msg.edited = true;
                    writeJSON(CHAT_ROOMS_FILE, roomsDB, true);
                    broadcastWS({ type: 'chat_msg_edited', room: roomKey, messageId: msg.id, text: msg.text });
                }
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }



    if (urlPath === '/api/typing' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && data.room) {
                const uClean = String(data.user).trim();
                markUserOnline(uClean);
                if (!typingDB[data.room]) typingDB[data.room] = {};
                if (data.typing === false) delete typingDB[data.room][uClean];
                else typingDB[data.room][uClean] = Date.now();
                broadcastWS({ type: 'chat_typing', room: data.room, user: uClean, typing: data.typing !== false });
            }
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }
    if (urlPath === '/api/messages' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const room = String(myUrl.searchParams.get('room') || '').trim().toLowerCase();
        const reqUser = (myUrl.searchParams.get('user') || '').trim().toLowerCase();
        const sinceTs = Number(myUrl.searchParams.get('since') || 0);
        const rawList = (room && Array.isArray(roomsDB[room])) ? roomsDB[room] : new Array();
        if (reqUser) {
            markUserOnline(reqUser);
            if (room && rawList.length > 0) {
                const lastMsgTs = Number(rawList.at(-1).timestamp || 0);
                if (!db.lastRead[reqUser]) db.lastRead[reqUser] = {};
                if ((db.lastRead[reqUser][room] || 0) < lastMsgTs) {
                    db.lastRead[reqUser][room] = Date.now();
                    writeJSON(READS_FILE, db.lastRead);
                    broadcastWS({ type: 'chat_room_read', room: room, reader: reqUser, readAt: db.lastRead[reqUser][room] });
                }
            }
        }
        let partnerOnline = false;
        let partnerLastSeen = '';
        let otherParticipants = new Array();
        if (room) {
            if (groupsDB[room] && Array.isArray(groupsDB[room].members)) {
                otherParticipants = groupsDB[room].members.map(function(m) { return String(m).trim().toLowerCase(); }).filter(function(m) { return m !== reqUser; });
                partnerOnline = otherParticipants.some(function(m) { return isUserOnlineNow(m); });
            } else {
                const pairParts = room.split('_').at(0).split(',');
                otherParticipants = pairParts.map(function(p) { return String(p).trim().toLowerCase(); }).filter(function(p) { return p !== reqUser; });
                if (otherParticipants.length > 0) {
                    const pKey = otherParticipants.at(0);
                    partnerOnline = isUserOnlineNow(pKey);
                    partnerLastSeen = getUserLastSeenStr(pKey);
                }
            }
        }
        const activeTypers = new Array();
        if (room && typingDB[room]) {
            const nowTs = Date.now();
            Object.keys(typingDB[room]).forEach(function(tUser) {
                if (nowTs - typingDB[room][tUser] < 4500) {
                    if (tUser.toLowerCase() !== reqUser) activeTypers.push(tUser);
                } else {
                    delete typingDB[room][tUser];
                }
            });
        }
        const filteredRaw = sinceTs > 0 ? rawList.filter(function(m) { return Number(m.timestamp || 0) >= sinceTs; }) : rawList;
        const enriched = filteredRaw.map(function(msg) {
            const senderLow = String(msg.sender || '').trim().toLowerCase();
            const msgTs = Number(msg.timestamp || 0);
            let isRead = false;
            if (otherParticipants.length > 0) {
                isRead = otherParticipants.some(function(part) {
                    if (part === senderLow) return false;
                    const pRead = (db.lastRead[part] && db.lastRead[part][room]) ? Number(db.lastRead[part][room]) : 0;
                    return pRead >= msgTs && msgTs > 0;
                });
            }
            return Object.assign({}, msg, { read: isRead });
        });
        return sendJsonCompressed(req, res, 200, {
                    messages: enriched,
            totalCount: rawList.length,
            isDelta: sinceTs > 0,
            partnerOnline: partnerOnline,
            partnerLastSeen: partnerLastSeen,
            typingUsers: activeTypers
        }, 'no-store');

    }

    if (urlPath === '/api/messages/read' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && data.room) {
                const myL = String(data.user).trim().toLowerCase();
                markUserOnline(myL);
                if (!db.lastRead[myL]) db.lastRead[myL] = {};
                const ts = Date.now() + 500;
                db.lastRead[myL][data.room] = ts;
                writeJSON(READS_FILE, db.lastRead);
                broadcastWS({ type: 'chat_room_read', room: data.room, reader: myL, readAt: ts });
            }
            res.writeHead(200);
            res.end('OK');
        });
    }

      if (urlPath === '/api/fast-txt' && req.method === 'GET') {
        const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const s = u.searchParams.get('s');
        const r = u.searchParams.get('r');
        const t = u.searchParams.get('t');
        const cid = u.searchParams.get('c');
        if (!s || !r || !t) {
            res.writeHead(400);
            return res.end('0');
        }
        return saveMultipartChatMsg({
            sender: s,
            room: r,
            type: 'text',
            text: t,
            clientMsgId: cid || null,
            quoteId: u.searchParams.get('qid') || null,
            quoteText: u.searchParams.get('qt') || null,
            quoteSender: u.searchParams.get('qs') || null
        }, null, '', '', req, res);
    }

    if (urlPath === '/api/send' && req.method === 'POST') {
        return handleMultipartSend(req, res);
    }


    if (urlPath.startsWith('/uploads/')) {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const isDownload = myUrl.searchParams.get('dl') === '1';
        const customName = myUrl.searchParams.get('name') || path.basename(urlPath);
        const fileName = path.basename(urlPath);
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.stat(filePath, function(err, stat) {
            if (err || !stat.isFile()) {
                res.writeHead(404);
                return res.end('File Not Found');
            }
            let contentType = 'application/octet-stream';
            const ext = path.extname(urlPath).toLowerCase();
            if (!isDownload) {
                if (ext === '.mp4') contentType = 'video/mp4';
                else if (ext === '.webm') contentType = fileName.startsWith('audio_') ? 'audio/webm' : 'video/webm';
                else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
                else if (ext === '.png') contentType = 'image/png';
                else if (ext === '.gif') contentType = 'image/gif';
                else if (ext === '.pdf') contentType = 'application/pdf';
            }
            const range = req.headers.range;
            if (range && !isDownload) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts.at(0), 10);
                const end = parts.at(1) ? parseInt(parts.at(1), 10) : stat.size - 1;
                if (start >= stat.size) {
                    res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
                    return res.end();
                }
                res.writeHead(206, {
                    'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': (end - start) + 1,
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=86400'
                });
                fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
            } else {
                const headers = {
                    'Content-Length': stat.size,
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': isDownload ? 'no-store' : 'public, max-age=86400'
                };
                if (isDownload) {
                    headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(customName);
                }
                res.writeHead(200, headers);
                fs.createReadStream(filePath).pipe(res);
            }
        });
        return;
    }


    const APK_FILE_PATH = path.join(storagePath, 'msb55115-latest.apk');
    const APK_META_FILE = path.join(storagePath, 'apk_meta.json');

    if (req.method === 'GET' && urlPath === '/api/app/version') {
        const meta = readJSON(APK_META_FILE, { versionCode: 1, versionName: '1.0', hasApk: false });
        meta.hasApk = fs.existsSync(APK_FILE_PATH);
        return sendJsonCompressed(req, res, 200, meta, 'no-store');
    }

    if (req.method === 'GET' && urlPath === '/api/app/download.apk') {
        if (!fs.existsSync(APK_FILE_PATH)) {
            res.writeHead(404);
            return res.end('APK not found');
        }
        const stat = fs.statSync(APK_FILE_PATH);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': 'attachment; filename="MSB55115.apk"',
            'Content-Length': stat.size,
            'Cache-Control': 'no-store'
        });
        return fs.createReadStream(APK_FILE_PATH).pipe(res);
    }

    if (req.method === 'POST' && urlPath === '/api/app/upload-apk-chunk') {
        const secret = req.headers['x-update-secret'] || '';
        const expected = process.env.UPDATE_SECRET || 'msb55115_ota_key';
        if (secret !== expected) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        const idx = Number(req.headers['x-chunk-index'] || 0);
        const total = Number(req.headers['x-total-chunks'] || 1);
        const verCode = Number(req.headers['x-version-code'] || Math.floor(Date.now() / 1000));
        const verName = decodeURIComponent(req.headers['x-version-name'] || getServerDateTime());
        const tmpPath = APK_FILE_PATH + '.part';
        const chunks = [];
        req.on('data', function(c) { chunks.push(c); });
        req.on('end', function() {
            try {
                const buf = Buffer.concat(chunks);
                if (idx === 0 && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                fs.appendFileSync(tmpPath, buf);
                if (idx + 1 >= total) {
                    if (fs.existsSync(APK_FILE_PATH)) fs.unlinkSync(APK_FILE_PATH);
                    fs.renameSync(tmpPath, APK_FILE_PATH);
                    const stat = fs.statSync(APK_FILE_PATH);
                    writeJSON(APK_META_FILE, {
                        versionCode: verCode,
                        versionName: verName,
                        size: stat.size,
                        updatedAt: getServerDateTime()
                    }, true);
                    broadcastWS({ type: 'apk_updated', versionCode: verCode, versionName: verName });
                    return sendJsonCompressed(req, res, 200, { ok: true, done: true, size: stat.size });
                }
                return sendJsonCompressed(req, res, 200, { ok: true, done: false, index: idx });
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && urlPath === '/api/app/upload-apk') {
        const secret = req.headers['x-update-secret'] || '';
        const expected = process.env.UPDATE_SECRET || 'msb55115_ota_key';
        if (secret !== expected) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        const verCode = Number(req.headers['x-version-code'] || Math.floor(Date.now() / 1000));
        const verName = decodeURIComponent(req.headers['x-version-name'] || getServerDateTime());
        const tmpPath = APK_FILE_PATH + '.tmp';
        const wsApk = fs.createWriteStream(tmpPath);
        req.pipe(wsApk);
        wsApk.on('finish', function() {
            try {
                if (fs.existsSync(APK_FILE_PATH)) fs.unlinkSync(APK_FILE_PATH);
                fs.renameSync(tmpPath, APK_FILE_PATH);
                writeJSON(APK_META_FILE, { versionCode: verCode, versionName: verName, updatedAt: getServerDateTime() }, true);
                broadcastWS({ type: 'apk_updated', versionCode: verCode, versionName: verName });
                sendJsonCompressed(req, res, 200, { ok: true, versionCode: verCode });
            } catch (e) {
                res.writeHead(500);
                res.end('Save error');
            }
        });
        return;
    }


    // ⬇️ ВСТАВЛЯТЬ ОБРАБОТЧИК ИМЕННО СЮДА (ПЕРЕД fs.readFile) ⬇️
    if (req.method === 'POST' && urlPath === '/api/reply-from-notif') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.sender || !data.target || !data.text) {
                return sendJsonCompressed(req, res, 400, { ok: false });
            }
            const fromUser = String(data.sender).trim();
            const toRaw = String(data.target).trim();
            const replyText = String(data.text).trim();
            if (!replyText) return sendJsonCompressed(req, res, 200, { ok: false });

            let roomId = '';
            if (toRaw.startsWith('👥')) {
                const gName = toRaw.replace(/^👥\s*/, '').trim().toLowerCase();
                const foundGId = Object.keys(groupsDB).find(function(gid) {
                    return groupsDB[gid] && String(groupsDB[gid].name || '').trim().toLowerCase() === gName;
                });
                if (foundGId) roomId = foundGId;
            }
            if (!roomId) {
                const sorted = [fromUser.toLowerCase(), toRaw.toLowerCase()].sort();
                const pair = sorted.join(',');
                roomId = pair + '_' + pair;
            }

            if (!Array.isArray(roomsDB[roomId])) roomsDB[roomId] = [];
            const timeStr = getServerDateTime();
            const newMsgObj = {
                id: crypto.randomBytes(8).toString('hex'),
                sender: fromUser,
                text: replyText,
                type: 'text',
                time: timeStr,
                timestamp: Date.now()
            };
            roomsDB[roomId].push(newMsgObj);
            if (roomsDB[roomId].length > 150) roomsDB[roomId].shift();
            writeJSON(CHAT_ROOMS_FILE, roomsDB);

            broadcastWS({ type: 'chat_new_msg', room: roomId, msg: newMsgObj });
            notifyJournalFromMessenger(roomId, fromUser, replyText, 'text', timeStr);
            return sendJsonCompressed(req, res, 200, { ok: true });
        });
    }
    // ⬆️ КОНЕЦ ВСТАВКИ ⬆️

    if (req.method === 'POST' && urlPath === '/api/admin/clear-all-chats') {
        roomsDB = {};
        db.lastRead = {};
        writeJSON(CHAT_ROOMS_FILE, roomsDB, true);
        writeJSON(READS_FILE, db.lastRead, true);
        broadcastWS({ type: 'all_chats_cleared' });
        return sendJsonCompressed(req, res, 200, { ok: true }, 'no-store');
    }

    fs.readFile(path.join(__dirname, 'index.html'), function(err, data) {
        if (err) {

            res.writeHead(500);
            res.end('Error loading index.html');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(data);
        }
    });
});


function buildChatPreviewItem(name, roomId, myLowerName, myLastReadTime, isGroup, omitAvatars) {
    const cleanRoomId = String(roomId || '').trim().toLowerCase();
    const roomMessages = Array.isArray(roomsDB[cleanRoomId]) ? roomsDB[cleanRoomId] : (Array.isArray(roomsDB[roomId]) ? roomsDB[roomId] : new Array());
    let lastMsgText = "Нет сообщений";
    let lastMsgTime = "";
    let unreadCount = 0;
    if (roomMessages.length > 0) {
        const lastMsg = roomMessages.at(-1);
        const prefix = isGroup ? (lastMsg.sender + ': ') : '';
        if (lastMsg.type === 'audio') lastMsgText = "🎙️ " + prefix + "Голосовое";
        else if (lastMsg.type === 'video') lastMsgText = "🎥 " + prefix + "Кружок";
        else if (lastMsg.type === 'file') lastMsgText = "📎 " + prefix + "Файл";
        else if (lastMsg.type === 'gif') lastMsgText = "🎬 " + prefix + "GIF";
        else lastMsgText = prefix + (lastMsg.text || "");
        lastMsgTime = lastMsg.time || "";
        roomMessages.forEach(function(msg) {
            if (String(msg.sender || '').trim().toLowerCase() !== myLowerName && (msg.timestamp || 0) > myLastReadTime) {
                unreadCount++;
            }
        });
    }
    const cleanKey = String(name || '').trim().toLowerCase();
    const uInfo = !isGroup ? (usersDB[cleanKey] || {}) : {};
    const isOnline = isGroup ? true : isUserOnlineNow(cleanKey);
    const avStr = uInfo.avatar || '';
    return {
        id: isGroup ? roomId : undefined,
        name: name,
        unit: uInfo.unit || '',
        avatar: omitAvatars ? undefined : avStr,
        avatarHash: avStr ? String(avStr.length) : '',
        lastMessage: lastMsgText,
        time: lastMsgTime,
        unread: unreadCount,
        isGroup: isGroup,
        online: isOnline,
        lastSeen: !isGroup ? getUserLastSeenStr(cleanKey) : ''
    };
}

function handleMultipartSend(req, res) {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
        return readBodyJSON(req, function(err, fields) {
            if (err || !fields) {
                res.writeHead(400);
                return res.end('Bad JSON');
            }
            saveMultipartChatMsg(fields, null, '', '', req, res);
        });
    }
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    const boundaryStr = boundaryMatch ? (boundaryMatch.at(1) || boundaryMatch.at(2)) : null;
    if (!boundaryStr) {
        res.writeHead(400);
        return res.end('No boundary');
    }
    const boundary = Buffer.from('--' + boundaryStr);
    const chunks = new Array();
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() {
        const buffer = Buffer.concat(chunks);
        let fields = {};
        let fileBuffer = null;
        let fileExt = 'bin';
        let originalFileName = '';
        let start = 0;
        let end = buffer.indexOf(boundary, start);
        const doubleCRLF = Buffer.from('\r\n\r\n');
        while (end !== -1) {
            const part = buffer.subarray(start, end);
            const headerEndIndex = part.indexOf(doubleCRLF);
            if (headerEndIndex !== -1) {
                const headerStr = part.subarray(0, headerEndIndex).toString('utf-8');
                const bodyStart = headerEndIndex + 4;
                const bodyEnd = part.length - 2;
                if (bodyEnd > bodyStart && headerStr.includes('name="')) {
                    const nameMatch = headerStr.match(/name="([^"]+)"/);
                    if (nameMatch) {
                        const fieldName = nameMatch.at(1);
                        if (headerStr.includes('filename="')) {
                            const fnMatch = headerStr.match(/filename="([^"]+)"/);
                            if (fnMatch) {
                                originalFileName = fnMatch.at(1);
                                if (originalFileName.includes('.')) fileExt = originalFileName.split('.').pop();
                                fileBuffer = part.subarray(bodyStart, bodyEnd);
                            }
                        } else {
                            fields[fieldName] = part.subarray(bodyStart, bodyEnd).toString('utf-8');
                        }
                    }
                }
            }
            start = end + boundary.length;
            end = buffer.indexOf(boundary, start);
        }
        saveMultipartChatMsg(fields, fileBuffer, fileExt, originalFileName, req, res);
    });
}
function saveMultipartChatMsg(fields, fileBuffer, fileExt, originalFileName, req, res) {
    const sender = String(fields.sender || '').trim();
    const room = String(fields.room || '').trim().toLowerCase();
    const type = fields.type || 'text';

    const clientMsgId = fields.clientMsgId ? String(fields.clientMsgId).trim() : null;
    if (!sender || !room) {
        res.writeHead(400);
        return res.end('Incomplete');
    }
    markUserOnline(sender);
    if (typingDB[room]) delete typingDB[room][sender];
    if (!Array.isArray(roomsDB[room])) roomsDB[room] = new Array();

    if (clientMsgId) {
        const dup = roomsDB[room].find(function(m) { return m.clientMsgId === clientMsgId; });
        if (dup) {
            if (res) return sendJsonCompressed(req, res, 200, { ok: true, msg: dup });
            return;
        }
    }



    let finalContent = fields.text || '';
    if ((type === 'audio' || type === 'video' || type === 'file') && fileBuffer && fileBuffer.length > 0) {
        const durMatch = String(originalFileName || '').match(/voice_(\d+)s/i);
        const durTag = (type === 'audio' && durMatch) ? ('_voice_' + durMatch[1] + 's') : '';
        const fileName = type + durTag + '_' + crypto.randomBytes(6).toString('hex') + '.' + fileExt;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), fileBuffer);
        finalContent = (type === 'file')
            ? JSON.stringify({ path: '/uploads/' + fileName, name: originalFileName })
            : ('/uploads/' + fileName);
    }


    const timeStr = getServerDateTime();
    const newMsgObj = {
        id: crypto.randomBytes(8).toString('hex'),
        clientMsgId: clientMsgId,
        sender: sender,
        text: finalContent,
        type: type,
        time: timeStr,
        timestamp: Date.now(),
        forwardedFrom: fields.forwardedFrom || null,
        quoteId: fields.quoteId || null,
        quoteText: fields.quoteText || null,
        quoteSender: fields.quoteSender || null
    };
      roomsDB[room].push(newMsgObj);
    if (roomsDB[room].length > 150) roomsDB[room].shift();
    writeJSON(CHAT_ROOMS_FILE, roomsDB, true);


    broadcastWS({ type: 'chat_new_msg', room: room, msg: newMsgObj });
    notifyJournalFromMessenger(room, sender, finalContent, type, timeStr);
    if (res) {
        return sendJsonCompressed(req, res, 200, { ok: true, msg: newMsgObj });
    }
}


function notifyJournalFromMessenger(room, sender, rawContent, type, timeStr) {
    let cleanText = rawContent || '';
    const isGroupRoom = Boolean(groupsDB[room]);
    const groupTitle = isGroupRoom ? groupsDB[room].name : '';
    const prefix = isGroupRoom ? ('👥 [' + groupTitle + '] ') : '';

    if (type === 'audio') cleanText = prefix + '🎙️ Голосовое сообщение';
    else if (type === 'video') cleanText = prefix + '🎥 Видео-кружок';
    else if (type === 'file') cleanText = prefix + '📎 Файл';
    else if (type === 'gif') cleanText = prefix + '🎬 GIF-анимация';
    else cleanText = prefix + cleanText;


    let targets = new Array();
    if (isGroupRoom) {
        targets = groupsDB[room].members.filter(function(m) {
            return String(m).trim().toLowerCase() !== String(sender).trim().toLowerCase();
        });
    } else {
        const parts = room.split('_').at(0).split(',');
        targets = parts.filter(function(n) {
            return String(n).trim().toLowerCase() !== String(sender).trim().toLowerCase();
        });
    }
    targets.forEach(function(t) {
        const cleanKey = String(t).trim().toLowerCase();
        const uObj = usersDB[cleanKey];
        const realTarget = uObj ? uObj.username : String(t).trim();
        const alertSender = isGroupRoom ? ('👥 ' + groupTitle) : sender;
        sendChatBackgroundPushOnly(alertSender, realTarget, cleanText);
    });
}
function sendChatBackgroundPushOnly(sender, target, text) {
    const tLow = String(target || '').trim().toLowerCase();
    const sLow = String(sender || '').trim().toLowerCase();
    if (!tLow || tLow === sLow) return;

    const notifId = Date.now() + Math.floor(Math.random() * 1000);
    const notifTag = 'msb-chat-' + notifId;

    const rawSenderStr = String(sender || 'МСБ-55115').trim();
    const parsedCallsign = rawSenderStr.replace(/^👥\s*/, '').trim();
    const senderObj = usersDB[parsedCallsign.toLowerCase()];
    const senderHeader = (senderObj && senderObj.unit && senderObj.unit.toLowerCase() !== parsedCallsign.toLowerCase())
        ? (senderObj.unit + ' • ' + parsedCallsign)
        : rawSenderStr;

    const cleanSenderKeyForWeb = parsedCallsign.toLowerCase();
    const cleanBody = String(text || 'Новое сообщение');

    // 1. Отправка WebPush (для браузера и PWA)
    const webPayload = JSON.stringify({
        title: senderHeader,
        body: cleanBody,
        icon: '/api/avatar-img/' + encodeURIComponent(cleanSenderKeyForWeb) + '.jpg?v=' + notifId,
        tag: notifTag,
        url: '/'
    });

    for (let i = pushSubscriptions.length - 1; i >= 0; i--) {
        const item = pushSubscriptions[i];
        if (!item || !item.sub) continue;
        const uLow = String(item.user || '').trim().toLowerCase();
        const cLow = String(item.callsign || '').trim().toLowerCase();
        if (cLow && cLow === sLow) continue;
        if (cLow === tLow || (!cLow && uLow === tLow)) {
            webpush.sendNotification(item.sub, webPayload, { TTL: 86400, urgency: 'high' }).catch(function(err) {
                if (err && (err.statusCode === 410 || err.statusCode === 404)) {
                    const idx = pushSubscriptions.indexOf(item);
                    if (idx !== -1) {
                        pushSubscriptions.splice(idx, 1);
                        writeJSON(SUBS_FILE, pushSubscriptions);
                    }
                }
            });
        }
    }

    // 2. Отправка Firebase FCM (для Android APK)
    if (fcmAdmin && fcmTokens.length > 0) {
        fcmTokens.forEach(function(item) {
            if (!item || !item.token) return;
            const uLow = String(item.user || '').trim().toLowerCase();
            const cLow = String(item.callsign || '').trim().toLowerCase();
            if (cLow && cLow === sLow) return;

            if (cLow === tLow || (!cLow && uLow === tLow)) {
                const avatarUrl = item.origin
                    ? (item.origin + '/api/avatar-img/' + encodeURIComponent(cleanSenderKeyForWeb) + '.jpg?v=' + notifId)
                    : '';
                const targetSound = (usersDB[cLow] && usersDB[cLow].soundId) ? usersDB[cLow].soundId : 'nice1';

                fcmAdmin.messaging().send({
                    token: item.token,
                    data: {
                        tag: notifTag,
                        title: senderHeader,
                        body: cleanBody,
                        target: String(target),
                        sender: parsedCallsign,
                        soundId: targetSound,
                        image: avatarUrl,
                        accentColor: '#22c55e',
                        bgColor: '#00000000'
                    },
                    android: {
                        priority: 'high',
                        ttl: 86400000
                    }
                }).catch(function(err) {
                    console.error('❌ FCM Chat Error:', err.code, err.message);
                    if (err && (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token')) {
                        const badIdx = fcmTokens.indexOf(item);
                        if (badIdx !== -1) {
                            fcmTokens.splice(badIdx, 1);
                            writeJSON(FCM_FILE, fcmTokens);
                        }
                    }
                });
            }
        });
    }
}


function sendIncomingCallFcm(fromUser, targetKey, callId) {
    if (!fcmAdmin || fcmTokens.length === 0) return;
    const tLow = String(targetKey || '').trim().toLowerCase();
    fcmTokens.forEach(function(item) {
        if (!item || !item.token) return;
        const uLow = String(item.user || '').trim().toLowerCase();
        const cLow = String(item.callsign || '').trim().toLowerCase();
        if (cLow === tLow || uLow === tLow) {
            fcmAdmin.messaging().send({
                token: item.token,
                data: {
                    type: 'incoming_call',
                    from: String(fromUser),
                    callId: String(callId || ''),
                    title: '📞 Входящий аудиозвонок',
                    body: 'Вызывает: ' + fromUser
                },
                android: { priority: 'high', ttl: 45000 }
            }).catch(function() {});
        }
    });
}

function sendCancelCallFcm(fromUser, targetKey) {
    if (!fcmAdmin || fcmTokens.length === 0) return;
    const tLow = String(targetKey || '').trim().toLowerCase();
    fcmTokens.forEach(function(item) {
        if (!item || !item.token) return;
        const uLow = String(item.user || '').trim().toLowerCase();
        const cLow = String(item.callsign || '').trim().toLowerCase();
        if (cLow === tLow || (!cLow && uLow === tLow)) {
            fcmAdmin.messaging().send({
                token: item.token,
                data: { type: 'call_cancel', from: String(fromUser) },
                android: { priority: 'high' }
            }).catch(function() {});
        }
    });
}

const wss = new WebSocket.Server({ server: server, maxPayload: 20 * 1024 * 1024 });


function broadcastWS(obj) {
    const str = JSON.stringify(obj);
    wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(str); } catch (e) {}
        }
    });
}

function getIsoDateNow() {
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
}

let currentActiveDay = getIsoDateNow();
if (tableHistory.length > 0 && !archiveHistory[currentActiveDay]) {
    archiveHistory[currentActiveDay] = tableHistory.slice();
    writeJSON(ARCHIVE_FILE, archiveHistory);
}

setInterval(function() {
    const todayIso = getIsoDateNow();
    if (todayIso !== currentActiveDay) {
        if (tableHistory.length > 0) {
            archiveHistory[currentActiveDay] = tableHistory.slice();
            writeJSON(ARCHIVE_FILE, archiveHistory);
        }
        currentActiveDay = todayIso;
        tableHistory = new Array();
        writeJSON(DB_FILE, tableHistory);
        broadcastWS({ type: 'daily_archived', date: currentActiveDay });
    }
}, 30000);

notificationsHistory.forEach(function(n) {
    if (!n.read) {
        if (!Array.isArray(activeAlerts[n.target])) activeAlerts[n.target] = new Array();
        activeAlerts[n.target].push({ id: n.id, text: n.text, sender: n.sender, readList: new Array() });
    }
});

function saveAndBroadcastMap(msg) {
    const timeStr = msg.time || getServerDateTime();
    const mapItem = {
        id: Date.now(),
        sender: msg.sender || 'АДМИН',
        target: msg.target || 'ВСЕМ',
        time: timeStr,
        image: msg.image
    };
    mapsHistory.push(mapItem);
    if (mapsHistory.length > 18) mapsHistory = mapsHistory.slice(-18);
    writeJSON(MAPS_FILE, mapsHistory);
    broadcastWS({ type: 'new_map', target: mapItem.target });
    broadcastAlert(
        msg.sender || 'АДМИН',
        msg.color || '#8b5cf6',
        timeStr,
        msg.target || 'ВСЕМ',
        '🗺️ ЗАГРУЖЕНА НОВАЯ ВВОДНАЯ / КАРТА! Откройте раздел "ВВОДНЫЕ / КАРТА"'
    );
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
    if (notificationsHistory.length > 200) notificationsHistory = notificationsHistory.slice(-200);
    writeJSON(NOTIFS_FILE, notificationsHistory);

    if (!Array.isArray(activeAlerts[target])) activeAlerts[target] = new Array();
    activeAlerts[target].push({ id: notifId, text: text, sender: sender, readList: new Array() });
    broadcastWS({ type: 'admin_alert', sender: sender, target: target, text: text, notif: newNotif });

    const themePalettes = {
        military: { accentColor: '#22c55e' },
        rocket:   { accentColor: '#f97316' },
        cosmic:   { accentColor: '#a855f7' }
    };

    let rawSenderStr = String(sender || 'АДМИН').trim();
    let parsedCallsign = rawSenderStr.replace(/^👥\s*/, '').trim();
    let parsedUnit = '';
    const parenMatch = rawSenderStr.match(/^(.+?)\s*\((.+?)\)$/);
    if (parenMatch) {
        parsedUnit = parenMatch.at(1).trim();
        parsedCallsign = parenMatch.at(2).trim();
    }

    const senderObj = usersDB[parsedCallsign.toLowerCase()];
    if (!parsedUnit && senderObj && senderObj.unit) {
        parsedUnit = senderObj.unit;
    }
    const senderHeader = (parsedUnit && parsedUnit.toLowerCase() !== parsedCallsign.toLowerCase())
        ? (parsedUnit + ' • ' + parsedCallsign)
        : parsedCallsign;
    const senderThemeId = (senderObj && senderObj.theme) ? senderObj.theme : 'military';
    const senderAccent = (themePalettes[senderThemeId] || themePalettes.military).accentColor;

    const cleanSenderKeyForWeb = parsedCallsign.toLowerCase();
    const webAvatarUrl = '/api/avatar-img/' + encodeURIComponent(cleanSenderKeyForWeb) + '.jpg?v=' + Date.now();

    const payload = JSON.stringify({
        title: senderHeader,
        body: String(text || ''),
        icon: webAvatarUrl,
        tag: 'msb-alert-' + notifId,
        url: '/'
    });


    const pushOptions = {
        TTL: 86400,
        urgency: 'high'
    };

    const tLow = String(target).trim().toLowerCase();
    const sLow = String(sender).trim().toLowerCase();
    const isUnitTarget = Array.of('шр', 'рота-1', 'рота-2', 'рота-3', 'админ').includes(tLow);

    for (let i = pushSubscriptions.length - 1; i >= 0; i--) {
        const item = pushSubscriptions[i];
        if (!item || !item.sub) continue;
        const uLow = String(item.user || '').trim().toLowerCase();
        const cLow = String(item.callsign || '').trim().toLowerCase();
        if (cLow && (sLow === cLow || sLow.includes('(' + cLow + ')'))) continue;
        const matchCallsign = cLow && cLow === tLow;
        const matchUnit = isUnitTarget && uLow === tLow;
        if (target === 'ВСЕМ' || matchCallsign || matchUnit) {
            webpush.sendNotification(item.sub, payload, pushOptions).catch(function(err) {
                if (err && (err.statusCode === 410 || err.statusCode === 404)) {
                    const curIdx = pushSubscriptions.indexOf(item);
                    if (curIdx !== -1) {
                        pushSubscriptions.splice(curIdx, 1);
                        writeJSON(SUBS_FILE, pushSubscriptions);
                    }
                }
            });
        }
    }
    if (fcmAdmin && fcmTokens.length > 0) {

        fcmTokens.forEach(function(item) {
            if (!item || !item.token) return;
            const uLow = String(item.user || '').trim().toLowerCase();
            const cLow = String(item.callsign || '').trim().toLowerCase();
            if (cLow && (sLow === cLow || sLow.includes('(' + cLow + ')'))) return;
            const matchCallsign = cLow && cLow === tLow;
            const matchUnit = isUnitTarget && uLow === tLow;
            if (target === 'ВСЕМ' || matchCallsign || matchUnit) {
                const avatarUrl = item.origin
                    ? (item.origin + '/api/avatar-img/' + encodeURIComponent(cleanSenderKeyForWeb) + '.jpg?v=' + Date.now())
                    : undefined;

                const targetSound = (usersDB[cLow] && usersDB[cLow].soundId) ? usersDB[cLow].soundId : 'alarm1';
                fcmAdmin.messaging().send({
                    token: item.token,
                    data: {
                        tag: 'msb-alert-' + notifId,
                        title: senderHeader,
                        body: String(text || ''),
                        target: String(target),
                        sender: parsedCallsign,
                        soundId: targetSound,
                        image: avatarUrl || '',
                        theme: senderThemeId,
                        accentColor: senderAccent,
                        bgColor: '#00000000'
                    },
                    android: {
                        priority: 'high'
                    }
            

                }).catch(function(err) {
                    console.error('❌ Ошибка отправки FCM:', err.code, err.message);
                    if (err && (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token')) {
                        const badIdx = fcmTokens.indexOf(item);
                        if (badIdx !== -1) {
                            fcmTokens.splice(badIdx, 1);
                            writeJSON(FCM_FILE, fcmTokens);
                        }
                    }
                });

            }
        });
    }
}


const pendingCalls = {};

wss.on('connection', function(ws) {

    ws.isAlive = true;

    ws.on('pong', function() { ws.isAlive = true; });

    ws.on('close', function() {
        if (ws.userIdentity) {
            const key = ws.userIdentity;
            setTimeout(function() {
                if (!hasActiveVisibleWsForUser(key)) {
                    const seenStr = formatTimestampRu(Date.now());
                    onlinePresenceCache[key] = false;
                    lastSeenDB[key] = Date.now() - 8000;
                    writeJSON(LAST_SEEN_FILE, lastSeenDB);
                    broadcastWS({ type: 'presence_update', user: key, online: false, lastSeen: seenStr });
                }
            }, 300);
        }
    });


    ws.send(JSON.stringify({
        type: 'init',
        serverBootId: SERVER_BOOT_ID,
        serverBootTime: SERVER_BOOT_TIME,
        data: tableHistory,
        notifications: notificationsHistory,
        alerts: activeAlerts,
        streamState: streamState,
        vapidPublicKey: vapidKeys.publicKey
    }));

    ws.on('message', function(message) {
        try {
            const msg = JSON.parse(message.toString());
            ws.isAlive = true;
if (msg.type === 'ping') {
    let myKey = '';
    if (msg.callsign) {
        markUserOnline(msg.callsign, ws);
        myKey = String(msg.callsign).trim().toLowerCase();
    } else if (msg.user && msg.user === 'АДМИН') {
        markUserOnline('муравей', ws);
        myKey = 'муравей';
    } else if (msg.user) {
        markUserOnline(msg.user, ws);
        myKey = String(msg.user).trim().toLowerCase();
    }

    ws.send(JSON.stringify({
        type: 'pong',
        serverBootId: SERVER_BOOT_ID,
        serverBootTime: SERVER_BOOT_TIME
    }));

    if (myKey && pendingCalls[myKey]) {
        const pc = pendingCalls[myKey];
        if (Date.now() - pc.ts < 45000) {
            try {
                ws.send(JSON.stringify(pc.offerMsg));
            } catch (e) {}
        } else {
            delete pendingCalls[myKey];
        }
    }
    return;
}

            if (msg.type === 'user_away') {
                ws.isAway = true;
                const rawName = msg.callsign || (msg.user === 'АДМИН' ? 'муравей' : msg.user) || ws.userIdentity;
                if (rawName) {
                    const key = String(rawName).trim().toLowerCase();
                    setTimeout(function() {
                        if (!hasActiveVisibleWsForUser(key)) {
                            const seenStr = formatTimestampRu(Date.now());
                            onlinePresenceCache[key] = false;
                            lastSeenDB[key] = Date.now() - 8000;
                            writeJSON(LAST_SEEN_FILE, lastSeenDB);
                            broadcastWS({ type: 'presence_update', user: key, online: false, lastSeen: seenStr });
                        }
                    }, 400);
                }
                return;
            }

if (msg.type && msg.type.indexOf('call_') === 0) {
    let targetKey = String(msg.to || '').trim().toLowerCase();
    if (targetKey === 'админ') targetKey = 'муравей';

    let fromUser = String(msg.from || '').trim();
    if (fromUser.toLowerCase() === 'админ') fromUser = 'муравей';
    const fromKey = fromUser.toLowerCase();
    if (!targetKey || !fromUser) return;

    msg.from = fromUser;
    msg.to = targetKey;
    markUserOnline(fromUser, ws);


    if (msg.type === 'call_offer') {
        pendingCalls[targetKey] = {
            offerMsg: msg,
            fromKey: fromKey,
            ts: Date.now()
        };
    } else if (
        msg.type === 'call_answer' ||
        msg.type === 'call_end'
    ) {
        delete pendingCalls[targetKey];
        delete pendingCalls[fromKey];
    }

    let deliveredActive = false;
    const rawPacket = JSON.stringify(msg);
    wss.clients.forEach(function(client) {
        const isTarget = (client.userIdentity === targetKey);
        if (client.readyState === WebSocket.OPEN && isTarget) {
            try {
                client.send(rawPacket);
                if (!client.isAway) deliveredActive = true;
            } catch (e) {}
        }
    });

    if (msg.type === 'call_offer') {
        sendIncomingCallFcm(fromUser, targetKey, msg.callId || '');
    } else if (msg.type === 'call_end' || msg.type === 'call_answer') {
        sendCancelCallFcm(fromUser, targetKey);
        sendCancelCallFcm(targetKey, fromUser);
    }
    return;
}




                        if (msg.type === 'get_room_history' && msg.room) {
                const rKey = String(msg.room).trim().toLowerCase();
                const list = Array.isArray(roomsDB[rKey]) ? roomsDB[rKey] : [];
                ws.send(JSON.stringify({
                    type: 'room_history',
                    room: rKey,
                    messages: list
                }));
                return;
            }

            if (msg.type === 'chat_typing' && msg.user && msg.room) {

                const uClean = String(msg.user).trim();
                markUserOnline(uClean);
                if (!typingDB[msg.room]) typingDB[msg.room] = {};
                if (msg.typing === false) delete typingDB[msg.room][uClean];
                else typingDB[msg.room][uClean] = Date.now();
                broadcastWS({ type: 'chat_typing', room: msg.room, user: uClean, typing: msg.typing !== false });
                return;
            }
            if (msg.type === 'chat_edit_ws' && msg.room && msg.messageId && typeof msg.text === 'string') {
                const roomKey = String(msg.room).trim().toLowerCase();
                const cleanTxt = msg.text.trim();
                if (cleanTxt && Array.isArray(roomsDB[roomKey])) {
                    const targetMsg = roomsDB[roomKey].find(function(m) { return String(m.id) === String(msg.messageId); });
                    if (targetMsg && (!targetMsg.type || targetMsg.type === 'text')) {
                        targetMsg.text = cleanTxt;
                        targetMsg.edited = true;
                        writeJSON(CHAT_ROOMS_FILE, roomsDB, true);
                        broadcastWS({ type: 'chat_msg_edited', room: roomKey, messageId: targetMsg.id, text: targetMsg.text });
                    }
                }
                return;
            }

            if (msg.type === 'chat_send_ws' && msg.sender && msg.room) {

                saveMultipartChatMsg({
                    sender: msg.sender,
                    room: msg.room,
                    type: msg.msgType || 'text',
                    text: msg.text || '',
                    clientMsgId: msg.clientMsgId || null,
                    quoteId: msg.quoteId || null,
                    quoteText: msg.quoteText || null,
                    quoteSender: msg.quoteSender || null,
                    forwardedFrom: msg.forwardedFrom || null
                }, null, '', '', null, null);
                try {
                    ws.send(JSON.stringify({ type: 'chat_ack', clientMsgId: msg.clientMsgId, room: msg.room }));
                } catch (e) {}
                return;
            }

            if (msg.type === 'save_sub' && msg.sub) {
                if (msg.callsign) markUserOnline(msg.callsign);
                const idx = pushSubscriptions.findIndex(function(s) { return s.sub && s.sub.endpoint === msg.sub.endpoint; });
                if (idx !== -1) {
                    pushSubscriptions.at(idx).user = msg.user;
                    pushSubscriptions.at(idx).callsign = msg.callsign || '';
                } else {
                    pushSubscriptions.push({ user: msg.user, callsign: msg.callsign || '', sub: msg.sub });
                }
                writeJSON(SUBS_FILE, pushSubscriptions);
                return;
            }
            if (msg.type === 'add_row') {
                const newRow = { id: Date.now(), time: getServerDateTime(), user: msg.user, values: msg.values, color: msg.color };
                tableHistory.push(newRow);
                writeJSON(DB_FILE, tableHistory);
                const dayKey = getIsoDateNow();
                if (!Array.isArray(archiveHistory[dayKey])) archiveHistory[dayKey] = new Array();
                archiveHistory[dayKey].push(newRow);
                writeJSON(ARCHIVE_FILE, archiveHistory);
                broadcastWS({ type: 'new_row', row: newRow });
            }
            if (msg.type === 'upload_map' && msg.image) saveAndBroadcastMap(msg);
            if (msg.type === 'stream_start') {
                streamState = { active: true, url: msg.url };
                broadcastWS({ type: 'stream_state', streamState: streamState });
                broadcastAlert(msg.sender || 'АДМИН', msg.color || '#ef4444', getServerDateTime(), 'ВСЕМ', '🎥 НАЧАЛСЯ ВИДЕОСТРИМ МСБ-55115! Нажмите кнопку "ПЕРЕЙТИ ПО ССЫЛКЕ"');
            }
            if (msg.type === 'stream_stop') {
                streamState = { active: false, url: '' };
                broadcastWS({ type: 'stream_state', streamState: streamState });
            }
            if (msg.type === 'clear_history') {
                tableHistory = new Array(); notificationsHistory = new Array(); mapsHistory = new Array(); activeAlerts = {};
                writeJSON(DB_FILE, tableHistory); writeJSON(NOTIFS_FILE, notificationsHistory); writeJSON(MAPS_FILE, mapsHistory);
                broadcastWS({ type: 'history_cleared' });
            }
            if (msg.type === 'clear_all_chats') {
                roomsDB = {};
                db.lastRead = {};
                writeJSON(CHAT_ROOMS_FILE, roomsDB, true);
                writeJSON(READS_FILE, db.lastRead, true);
                broadcastWS({ type: 'all_chats_cleared' });
            }

            if (msg.type === 'admin_alert') {
                broadcastAlert(msg.sender || 'АДМИН', msg.color || '#ef4444', getServerDateTime(), msg.target, msg.text);
            }
            if (msg.type === 'clear_alert') {
                const now = new Date();
                const tStr = msg.readTime || now.toLocaleTimeString().slice(0, 5);
                const whoStr = msg.readBy || 'Просмотр';
                const stamp = whoStr + ' ' + tStr;
                if (Array.isArray(activeAlerts[msg.target])) {
                    if (msg.target === 'ВСЕМ') {
                        activeAlerts[msg.target].forEach(function(a) {
                            if (!msg.notifId || a.id === msg.notifId) {
                                if (!Array.isArray(a.readList)) a.readList = new Array();
                                if (a.readList.indexOf(whoStr) === -1) a.readList.push(whoStr);
                            }
                        });
                    } else {
                        if (msg.notifId) activeAlerts[msg.target] = activeAlerts[msg.target].filter(function(a) { return a.id !== msg.notifId; });
                        else activeAlerts[msg.target].shift();
                        if (activeAlerts[msg.target].length === 0) delete activeAlerts[msg.target];
                    }
                } else {
                    delete activeAlerts[msg.target];
                }
                let updatedReadBy = stamp, marked = false;
                notificationsHistory.forEach(function(n) {
                    const match = (msg.notifId && n.id === msg.notifId) || (!msg.notifId && !marked && n.target === msg.target);
                    if (match) {
                        n.read = true;
                        if (n.target === 'ВСЕМ') {
                            if (!n.readBy) n.readBy = stamp;
                            else if (n.readBy.indexOf(whoStr) === -1) n.readBy = n.readBy + ', ' + stamp;
                        } else n.readBy = stamp;
                        updatedReadBy = n.readBy;
                        marked = true;
                    }
                });
                writeJSON(NOTIFS_FILE, notificationsHistory);
                broadcastWS({ type: 'alert_cleared', target: msg.target, notifId: msg.notifId || null, who: whoStr, readBy: updatedReadBy });
            }
        } catch (e) { console.error("WS error:", e); }
    });
});

setInterval(function() {
    wss.clients.forEach(function(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        try { ws.ping(); } catch (e) {}
    });
}, 35000);

setInterval(function() {
    Object.keys(onlinePresenceCache).forEach(function(key) {
        const nowOnline = isUserOnlineNow(key);
        if (onlinePresenceCache[key] && !nowOnline) {
            onlinePresenceCache[key] = false;
            broadcastWS({ type: 'presence_update', user: key, online: false, lastSeen: getUserLastSeenStr(key) });
        }
    });
}, 6000);


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 ЕДИНЫЙ СЕРВЕР МСБ-55115 ЗАПУЩЕН НА ПОРТУ ' + PORT + ' | СБОРКА: ' + SERVER_BOOT_TIME);
});