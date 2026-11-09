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
const UPLOADS_DIR = path.join(storagePath, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
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

function writeJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
}
let vapidKeys = fs.existsSync(VAPID_FILE) ? readJSON(VAPID_FILE, null) : null;
if (!vapidKeys || !vapidKeys.publicKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    writeJSON(VAPID_FILE, vapidKeys);
}
webpush.setVapidDetails('mailto:admin@msb55115.local', vapidKeys.publicKey, vapidKeys.privateKey);

let pushSubscriptions = readJSON(SUBS_FILE, new Array());
if (!Array.isArray(pushSubscriptions)) pushSubscriptions = new Array();

let usersDB = readJSON(USERS_FILE, {});
usersDB['муравей'] = {
    username: 'муравей',
    password: '551150000',
    unit: 'АДМИН',
    approved: true,
    avatar: (usersDB['муравей'] && usersDB['муравей'].avatar) ? usersDB['муравей'].avatar : '',
    permissions: { row: true, stream: true, maps: true, archive: true, table: true }
};
writeJSON(USERS_FILE, usersDB);

let roomsDB = readJSON(CHAT_ROOMS_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {});
const db = { lastRead: {} };

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
    return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
function makeTacticalIcon(size) {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
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
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
        const t = Buffer.from(type, 'ascii');
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat(Array.of(t, data))), 0);
        return Buffer.concat(Array.of(len, t, data, crc));
    }
    const ihdr = Buffer.alloc(13, 0);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr.writeUInt8(8, 8); ihdr.writeUInt8(2, 9);
    const rowLen = 1 + size * 3;
    const raw = Buffer.alloc(size * rowLen, 0);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
        const rowOff = y * rowLen;
        raw.writeUInt8(0, rowOff);
        for (let x = 0; x < size; x++) {
            const p = rowOff + 1 + x * 3;
            const dx = x - half, dy = y - half, r = Math.sqrt(dx * dx + dy * dy);
            let red = 15, green = 23, blue = 42;
            if (r <= half * 0.88) {
                if (r >= half * 0.82) { red = 56; green = 189; blue = 248; }
                else {
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
            raw.writeUInt8(red, p); raw.writeUInt8(green, p + 1); raw.writeUInt8(blue, p + 2);
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

const SW_CODE = Array.of(
    "self.addEventListener('install', function(e) { self.skipWaiting(); });",
    "self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });",
    "self.addEventListener('push', function(event) {",
    "    var data = { title: '🛑 СООБЩЕНИЕ В МСБ-55115!', body: 'Срочно откройте приложение!' };",
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
).join('\n');

function readBodyJSON(req, cb) {
    let body = '';
    req.on('data', function(chunk) { body += chunk.toString(); });
    req.on('end', function() {
        try { cb(null, JSON.parse(body)); } catch (e) { cb(e, null); }
    });
}
const server = http.createServer(function(req, res) {
    const urlPath = (req.url || '/').split('?').at(0);

    if (urlPath === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' });
        return res.end(SW_CODE);
    }
    if (urlPath === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        return res.end(MANIFEST_JSON);
    }
    if (urlPath === '/icon-192.png' || urlPath === '/favicon.ico') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(TACTICAL_ICON_192);
    }
    if (urlPath === '/icon-512.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(TACTICAL_ICON_512);
    }
    if (urlPath === '/style.css' || urlPath === '/journal.js' || urlPath === '/messenger.js') {
        const cType = urlPath.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
        fs.readFile(path.join(__dirname, urlPath.slice(1)), function(err, data) {
            if (err) { res.writeHead(404); return res.end('Not Found'); }
            res.writeHead(200, { 'Content-Type': cType, 'Cache-Control': 'no-cache' });
            res.end(data);
        });
        return;
    }
    if (req.method === 'POST' && urlPath === '/api/auth/register') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.username || !data.password || !data.unit) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Заполните все поля' }));
            }
            const key = data.username.trim().toLowerCase();
            if (usersDB[key]) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Этот позывной уже занят!' }));
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
            broadcastAlert(data.unit, '#38bdf8', getServerDateTime(), 'АДМИН', '📝 НОВАЯ ЗАЯВКА НА РЕГИСТРАЦИЮ: Позывной (' + data.username.trim() + ') (' + data.unit + '). Откройте "Пользователи и заявки"!');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    }
    if (req.method === 'POST' && urlPath === '/api/auth/login') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.username || !data.password) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Пустые поля' }));
            }
            const u = usersDB[data.username.trim().toLowerCase()];
            if (!u) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Позывной не найден. Нажмите "Регистрация"!' }));
            }
            if (u.password !== data.password.trim()) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Неверный пароль!' }));
            }
            if (u.approved === false) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: '⏳ Заявка еще не одобрена АДМИНОМ!' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                username: u.username,
                unit: u.unit,
                permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
            }));
        });
    }

    if (req.method === 'GET' && urlPath === '/api/user/me') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = (myUrl.searchParams.get('user') || '').toLowerCase();
        const u = usersDB[user] || {};
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(JSON.stringify({
            avatar: u.avatar || '',
            unit: u.unit || '',
            permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false }
        }));
    }

    if (req.method === 'POST' && urlPath === '/api/user/avatar') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && data.avatar) {
                const k = data.user.trim().toLowerCase();
                if (!usersDB[k]) usersDB[k] = { username: data.user.trim(), password: '', unit: '', approved: true };
                usersDB[k].avatar = data.avatar;
                writeJSON(USERS_FILE, usersDB);
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
    }

    if (req.method === 'GET' && urlPath === '/api/admin/users') {
        const pending = new Array(), approved = new Array();
        Object.keys(usersDB).forEach(function(k) {
            const u = usersDB[k];
            const item = { key: k, username: u.username, password: u.password, unit: u.unit || '—', permissions: u.permissions || { row: false, stream: false, maps: false, archive: false, table: false } };
            if (u.approved === false) pending.push(item);
            else approved.push(item);
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(JSON.stringify({ pending: pending, approved: approved }));
    }

    if (req.method === 'POST' && urlPath === '/api/admin/users/action') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.key && usersDB[data.key]) {
                if (data.action === 'approve') usersDB[data.key].approved = true;
                else if (data.action === 'delete') delete usersDB[data.key];
                else if (data.action === 'set_perm' && data.permName) {
                    if (!usersDB[data.key].permissions) usersDB[data.key].permissions = { row: false, stream: false, maps: false, archive: false, table: false };
                    usersDB[data.key].permissions[data.permName] = Boolean(data.permVal);
                }
                writeJSON(USERS_FILE, usersDB);
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
    }
    if (req.method === 'GET' && urlPath === '/maps-list') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(mapsHistory));
    }

    if (req.method === 'GET' && urlPath === '/archive-data') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(archiveHistory));
    }

    if (req.method === 'POST' && urlPath === '/upload-map') {
        const chunks = new Array();
        req.on('data', function(chunk) { chunks.push(chunk); });
        req.on('end', function() {
            try {
                const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (msg && msg.image) {
                    saveAndBroadcastMap(msg);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: true, maps: mapsHistory }));
                } else { res.writeHead(400); res.end(JSON.stringify({ ok: false })); }
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); }
        });
        return;
    }

    if (urlPath === '/api/friends/get' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (!user) return res.end(JSON.stringify(new Array()));
        const myLowerName = user.toLowerCase();
        const myFriends = Array.isArray(friendsDB[myLowerName]) ? friendsDB[myLowerName] : new Array();
        const myReads = db.lastRead[myLowerName] || {};
        const listData = myFriends.map(function(friendName) {
            const sortedRoom = Array.of(myLowerName, friendName.toLowerCase()).sort();
            const pair = sortedRoom.join(',');
            const roomId = pair + '_' + pair;
            return buildChatPreviewItem(friendName, roomId, myLowerName, myReads[roomId] || 0, false);
        });
        Object.keys(groupsDB).forEach(function(groupId) {
            const group = groupsDB[groupId];
            if (group && Array.isArray(group.members) && group.members.some(function(m) { return m.toLowerCase() === myLowerName; })) {
                listData.push(buildChatPreviewItem(group.name, groupId, myLowerName, myReads[groupId] || 0, true));
            }
        });
        return res.end(JSON.stringify(listData));
    }

    if (urlPath === '/api/friends/request/send' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.from || !data.to) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Неполные данные' }));
            }
            const targetKey = data.to.trim().toLowerCase();
            const stdUnits = Array.of('шр', 'рота-1', 'рота-2', 'рота-3', 'админ');
            if (!usersDB[targetKey] && !stdUnits.includes(targetKey)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Позывной или Подразделение не найдены в системе!' }));
            }
            if (!Array.isArray(requestsDB[targetKey])) requestsDB[targetKey] = new Array();
            const alreadyRequested = requestsDB[targetKey].some(function(n) { return n.toLowerCase() === data.from.trim().toLowerCase(); });
            if (!alreadyRequested) {
                requestsDB[targetKey].push(data.from.trim());
                writeJSON(REQUESTS_FILE, requestsDB);
            }
            broadcastWS({ type: 'users_updated' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    }
    if (urlPath === '/api/friends/requests' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        const list = (user && Array.isArray(requestsDB[user.toLowerCase()])) ? requestsDB[user.toLowerCase()] : new Array();
        return res.end(JSON.stringify(list));
    }

    if (urlPath === '/api/friends/request/respond' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.user || !data.from || !data.action) { res.writeHead(400); return res.end('Bad'); }
            const myL = data.user.toLowerCase(), fromL = data.from.toLowerCase();
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
            res.writeHead(200); res.end('OK');
        });
    }

    if (urlPath === '/api/friends/save' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && Array.isArray(data.friends)) {
                friendsDB[data.user.toLowerCase()] = data.friends;
                writeJSON(FRIENDS_FILE, friendsDB);
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200); res.end('OK');
        });
    }

    if (urlPath === '/api/groups/create' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (err || !data || !data.creator || !data.groupName || !Array.isArray(data.members)) { res.writeHead(400); return res.end('Bad'); }
            const groupId = 'group_' + crypto.randomBytes(6).toString('hex');
            if (!data.members.map(function(m) { return m.toLowerCase(); }).includes(data.creator.toLowerCase())) data.members.push(data.creator);
            groupsDB[groupId] = { name: data.groupName, members: data.members, creator: data.creator };
            writeJSON(GROUPS_FILE, groupsDB);
            broadcastWS({ type: 'users_updated' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, groupId: groupId }));
        });
    }

    if (urlPath === '/api/groups/delete' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.groupId && groupsDB[data.groupId]) {
                delete groupsDB[data.groupId]; writeJSON(GROUPS_FILE, groupsDB);
                if (roomsDB[data.groupId]) { delete roomsDB[data.groupId]; writeJSON(CHAT_ROOMS_FILE, roomsDB); }
                broadcastWS({ type: 'users_updated' });
            }
            res.writeHead(200); res.end('OK');
        });
    }
    if (urlPath === '/api/messages/delete' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.room && data.messageId && Array.isArray(roomsDB[data.room])) {
                roomsDB[data.room] = roomsDB[data.room].filter(function(m) { return m.id !== data.messageId; });
                writeJSON(CHAT_ROOMS_FILE, roomsDB);
            }
            res.writeHead(200); res.end('OK');
        });
    }

    if (urlPath === '/api/messages' && req.method === 'GET') {
        const myUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        const room = myUrl.searchParams.get('room');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        const list = (room && Array.isArray(roomsDB[room])) ? roomsDB[room] : new Array();
        return res.end(JSON.stringify(list));
    }

    if (urlPath === '/api/messages/read' && req.method === 'POST') {
        return readBodyJSON(req, function(err, data) {
            if (!err && data && data.user && data.room) {
                const myL = data.user.toLowerCase();
                if (!db.lastRead[myL]) db.lastRead[myL] = {};
                db.lastRead[myL][data.room] = Date.now();
            }
            res.writeHead(200); res.end('OK');
        });
    }

    if (urlPath === '/api/send' && req.method === 'POST') {
        return handleMultipartSend(req, res);
    }

    if (urlPath.startsWith('/uploads/')) {
        const fileName = path.basename(urlPath);
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.stat(filePath, function(err, stat) {
            if (err || !stat.isFile()) { res.writeHead(404); return res.end('File Not Found'); }
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
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
            });
            res.end(data);
        }
    });
});
function buildChatPreviewItem(name, roomId, myLowerName, myLastReadTime, isGroup) {
    const roomMessages = Array.isArray(roomsDB[roomId]) ? roomsDB[roomId] : new Array();
    let lastMsgText = "Нет сообщений", lastMsgTime = "", unreadCount = 0;
    if (roomMessages.length > 0) {
        const lastMsg = roomMessages.at(-1);
        const prefix = isGroup ? (lastMsg.sender + ': ') : '';
        if (lastMsg.type === 'audio') lastMsgText = "🎙️ " + prefix + "Голосовое";
        else if (lastMsg.type === 'video') lastMsgText = "🎥 " + prefix + "Кружок";
        else if (lastMsg.type === 'file') lastMsgText = "📎 " + prefix + "Файл";
        else lastMsgText = prefix + (lastMsg.text || "");
        lastMsgTime = lastMsg.time || "";
        roomMessages.forEach(function(msg) {
            if (msg.sender.toLowerCase() !== myLowerName && (msg.timestamp || 0) > myLastReadTime) unreadCount++;
        });
    }
    const uInfo = !isGroup ? (usersDB[name.toLowerCase()] || {}) : {};
    return {
        id: isGroup ? roomId : undefined,
        name: name,
        unit: uInfo.unit || '',
        avatar: uInfo.avatar || '',
        lastMessage: lastMsgText,
        time: lastMsgTime,
        unread: unreadCount,
        isGroup: isGroup
    };
}

function handleMultipartSend(req, res) {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    const boundaryStr = boundaryMatch ? (boundaryMatch.at(1) || boundaryMatch.at(2)) : null;
    if (!boundaryStr) { res.writeHead(400); return res.end('No boundary'); }
    const boundary = Buffer.from('--' + boundaryStr);
    const chunks = new Array();
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() {
        const buffer = Buffer.concat(chunks);
        let fields = {}, fileBuffer = null, fileExt = 'bin', originalFileName = '';
        let start = 0, end = buffer.indexOf(boundary, start);
        const doubleCRLF = Buffer.from('\r\n\r\n');
        while (end !== -1) {
            const part = buffer.subarray(start, end);
            const headerEndIndex = part.indexOf(doubleCRLF);
            if (headerEndIndex !== -1) {
                const headerStr = part.subarray(0, headerEndIndex).toString('utf-8');
                const bodyStart = headerEndIndex + 4, bodyEnd = part.length - 2;
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
        saveMultipartChatMsg(fields, fileBuffer, fileExt, originalFileName, res);
    });
}
function saveMultipartChatMsg(fields, fileBuffer, fileExt, originalFileName, res) {
    const sender = fields.sender, room = fields.room, type = fields.type || 'text';
    if (!sender || !room) { res.writeHead(400); return res.end('Incomplete'); }
    let finalContent = fields.text || '';
    if ((type === 'audio' || type === 'video' || type === 'file') && fileBuffer && fileBuffer.length > 0) {
        const fileName = type + '_' + crypto.randomBytes(8).toString('hex') + '.' + fileExt;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), fileBuffer);
        finalContent = (type === 'file') ? JSON.stringify({ path: '/uploads/' + fileName, name: originalFileName }) : ('/uploads/' + fileName);
    }
    const timeStr = getServerDateTime();
    if (!Array.isArray(roomsDB[room])) roomsDB[room] = new Array();
    roomsDB[room].push({
        id: crypto.randomBytes(8).toString('hex'),
        sender: sender,
        text: finalContent,
        type: type,
        time: timeStr,
        timestamp: Date.now(),
        forwardedFrom: fields.forwardedFrom || null,
        quoteId: fields.quoteId || null,
        quoteText: fields.quoteText || null,
        quoteSender: fields.quoteSender || null
    });
    if (roomsDB[room].length > 150) roomsDB[room].shift();
    writeJSON(CHAT_ROOMS_FILE, roomsDB);
    notifyJournalFromMessenger(room, sender, finalContent, type, timeStr);
    res.writeHead(200); res.end('OK');
}

function notifyJournalFromMessenger(room, sender, rawContent, type, timeStr) {
    let cleanText = rawContent || '';
    if (type === 'audio') cleanText = '🎙️ Голосовое сообщение в Мессенджере';
    else if (type === 'video') cleanText = '🎥 Видео-кружок в Мессенджере';
    else if (type === 'file') cleanText = '📎 Файл в Мессенджере';
    else cleanText = '💬 Мессенджер: ' + cleanText;
    let targets = new Array();
    if (groupsDB[room]) {
        targets = groupsDB[room].members.filter(function(m) { return m.toLowerCase() !== sender.toLowerCase(); });
    } else {
        const parts = room.split('_').at(0).split(',');
        targets = parts.filter(function(n) { return n.toLowerCase() !== sender.toLowerCase(); });
    }
    targets.forEach(function(t) {
        const uObj = usersDB[t.toLowerCase()];
        const realTarget = uObj ? uObj.username : t.toUpperCase();
        broadcastAlert(sender, '#00a884', timeStr, realTarget, cleanText);
    });
}

const wss = new WebSocket.Server({ server: server, maxPayload: 20 * 1024 * 1024 });

function broadcastWS(obj) {
    const str = JSON.stringify(obj);
    wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) client.send(str);
    });
}

function getIsoDateNow() {
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
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
    const mapItem = { id: Date.now(), sender: msg.sender || 'АДМИН', target: msg.target || 'ВСЕМ', time: timeStr, image: msg.image };
    mapsHistory.push(mapItem);
    if (mapsHistory.length > 18) mapsHistory = mapsHistory.slice(-18);
    writeJSON(MAPS_FILE, mapsHistory);
    broadcastWS({ type: 'new_map', target: mapItem.target });
    broadcastAlert(msg.sender || 'АДМИН', msg.color || '#8b5cf6', timeStr, msg.target || 'ВСЕМ', '🗺️ ЗАГРУЖЕНА НОВАЯ ВВОДНАЯ / КАРТА! Откройте раздел "ВВОДНЫЕ / КАРТА"');
}

function broadcastAlert(sender, color, timeStr, target, text) {
    const notifId = Date.now() + Math.floor(Math.random() * 1000);
    const newNotif = { id: notifId, time: timeStr, sender: sender, color: color, target: target, text: text, read: false, readBy: '' };
    notificationsHistory.push(newNotif);
    if (notificationsHistory.length > 200) notificationsHistory = notificationsHistory.slice(-200);
    writeJSON(NOTIFS_FILE, notificationsHistory);

    if (!Array.isArray(activeAlerts[target])) activeAlerts[target] = new Array();
    activeAlerts[target].push({ id: notifId, text: text, sender: sender, readList: new Array() });
    broadcastWS({ type: 'admin_alert', sender: sender, target: target, text: text, notif: newNotif });

    const payload = JSON.stringify({ title: '🛑 СООБЩЕНИЕ ДЛЯ (' + target + ')!', body: sender + ': ' + text });
    const pushOptions = { TTL: 3600, headers: { 'Urgency': 'high' } };
    const tLow = String(target).toLowerCase();
    pushSubscriptions.forEach(function(item, index) {
        const uLow = String(item.user || '').toLowerCase();
        const cLow = String(item.callsign || '').toLowerCase();
        if (target === 'ВСЕМ' || uLow === tLow || cLow === tLow) {
            webpush.sendNotification(item.sub, payload, pushOptions).catch(function(err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    pushSubscriptions.splice(index, 1);
                    writeJSON(SUBS_FILE, pushSubscriptions);
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
            if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
            if (msg.type === 'save_sub' && msg.sub) {
                const idx = pushSubscriptions.findIndex(function(s) { return s.sub && s.sub.endpoint === msg.sub.endpoint; });
                if (idx !== -1) { pushSubscriptions.at(idx).user = msg.user; pushSubscriptions.at(idx).callsign = msg.callsign || ''; }
                else { pushSubscriptions.push({ user: msg.user, callsign: msg.callsign || '', sub: msg.sub }); }
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
                } else { delete activeAlerts[msg.target]; }

                let updatedReadBy = stamp, marked = false;
                notificationsHistory.forEach(function(n) {
                    const match = (msg.notifId && n.id === msg.notifId) || (!msg.notifId && !marked && n.target === msg.target);
                    if (match) {
                        n.read = true;
                        if (n.target === 'ВСЕМ') {
                            if (!n.readBy) n.readBy = stamp;
                            else if (n.readBy.indexOf(whoStr) === -1) n.readBy = n.readBy + ', ' + stamp;
                        } else { n.readBy = stamp; }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
    console.log('🚀 ЕДИНЫЙ СЕРВЕР МСБ-55115 (ЖУРНАЛ + МЕССЕНДЖЕР) ЗАПУЩЕН НА ПОРТУ ' + PORT);
});
