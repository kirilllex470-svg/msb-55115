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

const USERS_FILE = path.join(storagePath, 'users.json');
const CHAT_ROOMS_FILE = path.join(storagePath, 'chat_rooms.json');
const FRIENDS_FILE = path.join(storagePath, 'friends.json');
const GROUPS_FILE = path.join(storagePath, 'groups.json');
const REQUESTS_FILE = path.join(storagePath, 'requests.json');
const READS_FILE = path.join(storagePath, 'last_read.json');
const UPLOADS_DIR = path.join(storagePath, 'uploads');

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

const writeTimers = {};
function writeJSON(filePath, data, immediate) {
    if (immediate) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {}
        return;
    }
    if (writeTimers[filePath]) {
        clearTimeout(writeTimers[filePath]);
    }
    writeTimers[filePath] = setTimeout(function() {
        delete writeTimers[filePath];
        fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8', function() {});
    }, 250);
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
webpush.setVapidDetails('mailto:admin@msb55115.local', vapidKeys.publicKey, vapidKeys.privateKey);

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

function markUserOnline(name) {
    if (!name) return;
    const key = String(name).trim().toLowerCase();
    if (!key || key === 'гость' || key === 'просмотр') return;
    const prev = lastSeenDB[key] || 0;
    const now = Date.now();
    lastSeenDB[key] = now;
    if (now - prev > 15000) {
        writeJSON(LAST_SEEN_FILE, lastSeenDB);
    }
}

function isUserOnlineNow(name) {
    if (!name) return false;
    const key = String(name).trim().toLowerCase();
    const t = lastSeenDB[key] || 0;
    return (Date.now() - t) < 20000;
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
            const dx = x - half;
            const dy = y - half;
            const r = Math.sqrt(dx * dx + dy * dy);
            let red = 15, green = 23, blue = 42;
            if (r <= half * 0.88) {
                if (r >= half * 0.82) {
                    red = 56; green = 189; blue = 248;
                } else {
                    red = 30; green = 41; blue = 59;
                    const c1 = Math.abs(dy - (-half * 0.32 + Math.abs(dx) * 0.75));
                    const c2 = Math.abs(dy - (-half * 0.05 + Math.abs(dx) * 0.75));
                    const c3 = Math.abs(dy - (half * 0.22 + Math.abs(dx) * 0.75));
                    if ((c1 <= size * 0.045 && Math.abs(dx) <= half * 0.52) ||
                        (c2 <= size * 0.045 && Math.abs(dx) <= half * 0.46) ||
                        (c3 <= size * 0.045 && Math.abs(dx) <= half * 0.38)) {
                        red = 250; green = 204; blue = 21;
                    }
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
const TACTICAL_ICON_192 = makeTacticalIcon(192);
const TACTICAL_ICON_512 = makeTacticalIcon(512);

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
    "const SHELL_CACHE = 'msb55115-shell-v2';",
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
    "    event.waitUntil(self.registration.showNotification(data.title || '🛑 МСБ-55115', {",
    "        body: data.body || 'Откройте приложение',",
    "        icon: '/icon-192.png',",
    "        badge: '/icon-192.png',",
    "        vibrate: Array.of(400, 100, 400, 100, 600),",
    "        silent: false,",
    "        requireInteraction: true,",
    "        renotify: true,",
    "        tag: data.tag || ('msb-push-' + Date.now()),",
    "        data: { url: data.url || '/' }",
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
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(TACTICAL_ICON_192);
    }

    if (urlPath === '/icon-512.png') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(TACTICAL_ICON_512);
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

    if (req.method === 'GET' && urlPath === '/api/ping') {
        return sendJsonCompressed(req, res, 200, { ok: true, bootId: SERVER_BOOT_ID, ts: Date.now() }, 'no-store');
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

    if (req.method === 'GET' && urlPath === '/api/admin/users') {
        const pending = new Array();
        const approved = new Array();
        Object.keys(usersDB).forEach(function(k) {
            const u = usersDB[k];
            const item = {
                key: k,
                username: u.username,
                password: u.password,
                unit: u.unit || '—',
                permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
            };
            if (u.approved === false) pending.push(item);
            else approved.push(item);
        });
        return sendJsonCompressed(req, res, 200, { pending: pending, approved: approved });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/users/action') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.key && usersDB[data.key]) {
                if (data.action === 'approve') usersDB[data.key].approved = true;
                else if (data.action === 'delete') delete usersDB[data.key];
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
            if (group && Array.isArray(group.members) && group.members.some(function(m) {
                return String(m).trim().toLowerCase() === myLowerName;
            })) {
                listData.push(buildChatPreviewItem(group.name, groupId, myLowerName, myReads[groupId] || 0, true, omitAvatars));
            }
        });
        return sendJsonCompressed(req, res, 200, listData);
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
            if (!err && data && data.room && data.messageId && Array.isArray(roomsDB[data.room])) {
                roomsDB[data.room] = roomsDB[data.room].filter(function(m) { return m.id !== data.messageId; });
                writeJSON(CHAT_ROOMS_FILE, roomsDB);
                broadcastWS({ type: 'chat_msg_deleted', room: data.room, messageId: data.messageId });
            }
            res.writeHead(200);
            res.end('OK');
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
        const room = myUrl.searchParams.get('room');
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
        });
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

    if (urlPath === '/api/send' && req.method === 'POST') {
        return handleMultipartSend(req, res);
    }

    if (urlPath.startsWith('/uploads/')) {
        const fileName = path.basename(urlPath);
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.stat(filePath, function(err, stat) {
            if (err || !stat.isFile()) {
                res.writeHead(404);
                return res.end('File Not Found');
            }
            let contentType = 'application/octet-stream';
            const ext = path.extname(urlPath).toLowerCase();
            if (ext === '.mp4') contentType = 'video/mp4';
            else if (ext === '.webm') contentType = fileName.startsWith('audio_') ? 'audio/webm' : 'video/webm';
            else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            else if (ext === '.png') contentType = 'image/png';
            else if (ext === '.gif') contentType = 'image/gif';
            else if (ext === '.pdf') contentType = 'application/pdf';
            const range = req.headers.range;
            if (range) {
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
                res.writeHead(200, {
                    'Content-Length': stat.size,
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=86400'
                });
                fs.createReadStream(filePath).pipe(res);
            }
        });
        return;
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
    const roomMessages = Array.isArray(roomsDB[roomId]) ? roomsDB[roomId] : new Array();
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
    const sender = fields.sender;
    const room = fields.room;
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
            return sendJsonCompressed(req, res, 200, { ok: true, msg: dup });
        }
    }

    let finalContent = fields.text || '';
    if ((type === 'audio' || type === 'video' || type === 'file') && fileBuffer && fileBuffer.length > 0) {
        const fileName = type + '_' + crypto.randomBytes(8).toString('hex') + '.' + fileExt;
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
    writeJSON(CHAT_ROOMS_FILE, roomsDB);

    broadcastWS({ type: 'chat_new_msg', room: room, msg: newMsgObj });
    notifyJournalFromMessenger(room, sender, finalContent, type, timeStr);
    return sendJsonCompressed(req, res, 200, { ok: true, msg: newMsgObj });
}

function notifyJournalFromMessenger(room, sender, rawContent, type, timeStr) {
    let cleanText = rawContent || '';
    const isGroupRoom = Boolean(groupsDB[room]);
    const groupTitle = isGroupRoom ? groupsDB[room].name : '';
    const prefix = isGroupRoom ? ('👥 [' + groupTitle + '] ') : '💬 Мессенджер: ';

    if (type === 'audio') cleanText = (isGroupRoom ? '👥 [' + groupTitle + '] ' : '') + '🎙️ Голосовое сообщение в Мессенджере';
    else if (type === 'video') cleanText = (isGroupRoom ? '👥 [' + groupTitle + '] ' : '') + '🎥 Видео-кружок в Мессенджере';
    else if (type === 'file') cleanText = (isGroupRoom ? '👥 [' + groupTitle + '] ' : '') + '📎 Файл в Мессенджере';
    else if (type === 'gif') cleanText = (isGroupRoom ? '👥 [' + groupTitle + '] ' : '') + '🎬 GIF-анимация в Мессенджере';
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
        broadcastAlert(alertSender, '#00a884', timeStr, realTarget, cleanText);
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

    const payload = JSON.stringify({
        title: '🛑 СООБЩЕНИЕ ДЛЯ (' + target + ')!',
        body: sender + ': ' + text,
        tag: 'msb-alert-' + notifId,
        url: '/'
    });
    const pushOptions = {
        TTL: 86400,
        urgency: 'high',
        headers: { 'Urgency': 'high' }
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
}
wss.on('connection', function(ws) {
    ws.isAlive = true;
    ws.on('pong', function() { ws.isAlive = true; });

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
                if (msg.callsign) markUserOnline(msg.callsign);
                else if (msg.user && msg.user === 'АДМИН') markUserOnline('муравей');
                ws.send(JSON.stringify({ type: 'pong', serverBootId: SERVER_BOOT_ID, serverBootTime: SERVER_BOOT_TIME }));
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
}, 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 ЕДИНЫЙ СЕРВЕР МСБ-55115 ЗАПУЩЕН НА ПОРТУ ' + PORT + ' | СБОРКА: ' + SERVER_BOOT_TIME);
});
