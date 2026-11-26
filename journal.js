const MSB_SERVER_ORIGIN = localStorage.getItem('msb_server_url') || 'https://msb-55115-kirill000000007.mia0.amvera.tech';
const IS_LOCAL_APK = Boolean(window.Capacitor) || location.protocol === 'capacitor:' || location.hostname !== 'msb-55115-kirill000000007.mia0.amvera.tech';
const API_ORIGIN = IS_LOCAL_APK ? MSB_SERVER_ORIGIN : location.origin;


window.API_ORIGIN = API_ORIGIN;
window.resolveMsbMediaUrl = function(u) {
    if (!u) return '';
    if (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//')) {
        return API_ORIGIN + u;
    }
    return u;
};

if (IS_LOCAL_APK) {
    const origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
        if (typeof input === 'string' && input.startsWith('/')) {
            input = API_ORIGIN + input;
        }
        return origFetch(input, init);
    };
}

const USERS_CONFIG = Array.of(
    { name: "ШР", pass: "551151111", color: "#3b82f6" },
    { name: "РОТА-1", pass: "551152222", color: "#a855f7" },
    { name: "РОТА-2", pass: "551153333", color: "#22c55e" },
    { name: "РОТА-3", pass: "551154444", color: "#eab308" },
    { name: "АДМИН", pass: "5555", color: "#ef4444" }
);
const ADMIN_NAME = "АДМИН";

const COLUMNS_CONFIG = Array.of(
    { label: "ГРУППА", options: Array.of("1", "2", "3", "4", "5") },
    { label: "ИСХОДНИКИ", options: Array.of(
        "НАЧАЛИ ДВИЖЕНИЕ", "ЖДУТ", "ИДУТ", "ПЕРЕСЕКАЮТ ОТКРЫТКУ",
        "ПРОШЛИ ИСХОДНЫЙ ПУНКТ", "ЗАНЯТИЕ Р-НА ФОР-Я ГРУПП",
        "ЗАНЯТИЕ ПЕРЕФОР-Я Р-НА ГРУПП", "ВЫХОД НА РУБЕЖ АТАКИ",
        "ВЫХОД НА РУБЕЖ ШТУРМА", "ЗАНИМАЮТСЯ МЕДИЦИНОЙ",
        "ЗАНИМАЮТСЯ СВЯЗЬЮ", "ОБОРОНА", "РАБОТАЮТ В ОБОРОНЕ",
        "ШТУРМУЮТ", "РВБС"
    )},
    { label: "ЦВЕТ ТОЧКИ", options: Array.of(
        "ФИОЛЕТОВЫЙ", "БИРЮЗОВАЯ", "БИРЮЗОВАЯ-А", "СЕРАЯ", "ЗЕЛЕНАЯ",
        "СИНИЯ", "ЖЕЛТАЯ", "ОРАНЖЕВАЯ", "КРАСНАЯ", "РОЗОВАЯ",
        "РОЗОВАЯ-А", "БЕЖЕВАЯ", "КОРИЧНЕВАЯ", "ЧЕРНАЯ", "БОРДОВАЯ"
    )},
    { label: "НОМЕР ТОЧКИ", options: new Array(), digitsOnly: true },
    { label: "ЛЕСОПОЛОСА", options: Array.of(
        "ФАКС", "ЗУБР1", "ПОЭТ", "СУДЬЯ", "СОР4", "СМОГ-1", "КИЛТ", "ЗАЯЦ", "ЗАМЕНА", "КРАСКА",
        "МАСТАК1", "ВОЛК3", "АНГЕЛ", "ВАЛИК1", "ЛЕЖАК", "ЛОТ ", "ПРИНТ7",
        "ГОН1", "СТОП-3", "ТАБЛА", "ПОКЕР", "ЛОКОН", "КАЛЫМ", "КАРМАН1",
        "ИРБИС", "СЕЗОН", "КАРАЗ", "КВАС", "КАФР", "СТЕНА", "ТРАКТ",
        "СЛЕЖКА", "МОНАРХ", "ГИК", "МУРАЛ", "ГРЕК", "БАКУ", "БАКУ-1",
        "САЛАТ", "САЛАТ-1", "ГУК", "СМЕНА-1", "КАБАН", "КАБАН-2",
        "КАБАН-3", "ЛИС-1", "ЛИС-2", "ЛИС-3",
        "-->ФАКС", "-->ЗУБР1", "-->ПОЭТ", "-->ЗАЯЦ", "-->СМОГ-1", "-->СУДЬЯ", "-->СОР4",
        "-->ЗАМЕНА", "-->КРАСКА", "-->МАСТАК1", "-->ВОЛК3", "-->АНГЕЛ",
        "-->ВАЛИК1", "-->ЛЕЖАК", "-->ЛОТ ", "-->КИЛТ", "-->ПРИНТ7", "-->ГОН1",
        "-->СТОП-3", "-->ТАБЛА", "-->ПОКЕР", "-->ЛОКОН", "-->КАЛЫМ",
        "-->КАРМАН1", "-->ИРБИС", "-->СЕЗОН", "-->КАРАЗ", "-->КВАС",
        "-->КАФР", "-->СТЕНА", "-->ТРАКТ", "-->СЛЕЖКА", "-->МОНАРХ",
        "-->ГИК", "-->МУРАЛ", "-->ГРЕК", "-->БАКУ", "-->БАКУ-1",
        "-->САЛАТ", "-->САЛАТ-1", "-->ГУК", "-->СМЕНА-1", "-->КАБАН",
        "-->КАБАН-2", "-->КАБАН-3", "-->ЛИС-1", "-->ЛИС-2", "-->ЛИС-3"
    )},
    { label: "ПРИМЕЧАНИЯ", options: new Array() }
);

let ws = null;
let currentUser = null;
let currentCallsign = "";
let userColor = '#fff';
let myPermissions = { row: false, stream: false, maps: false, archive: false, table: false };
let selectedSoundId = localStorage.getItem('msb_sound_id') || 'alarm1';
let myMessengerFriends = new Array();
let allUsersAvatars = {};
let lastTargetOptionsSig = "";
let currentAlertId = null;
let currentAlertText = "";
let currentAlertTarget = "";
let currentAlertSender = "";
let pendingAlerts = {};
let allNotifications = new Array();
let allMaps = new Array();
let archiveData = {};
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedArchiveDate = "";
let activeStream = { active: false, url: "" };
let titleInterval = null;
let soundInterval = null;
let audioCtx = null;
let sirenAudio = null;
let publicVapidKey = localStorage.getItem('msb_vapid_pub') || null;
let deferredPrompt = null;
let knownServerBootId = sessionStorage.getItem('msb_server_boot_id') || null;
let pendingServerBootId = null;
function saveLocalJournalCache(key, data) {
    try {
        localStorage.setItem('msb_jcache_' + key, JSON.stringify(data));
    } catch (e) {}
}

function loadLocalJournalCache(key, fallback) {
    try {
        const raw = localStorage.getItem('msb_jcache_' + key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function getStaticDateTime() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return dd + '.' + mm + '.' + yyyy + ' ' + hh + ':' + min;
}

const SPLASH_FILES = Array.of(
    "boot/kernel_msb55115.sys", "crypto/cipher_channel_v4.dat", "net/websocket_sync_protocol.dll",
    "maps/tactical_forest_sectors.db", "auth/unit_credentials_guard.bin", "push/vapid_service_worker.js",
    "stream/salutejazz_rtc_bridge.mod", "journal/history_storage_engine.json", "audio/siren_emergency_synth.wav",
    "system/msb55115_ready_state.ok"
);

function runSplash() {
    const s = document.getElementById('splash-screen');
    const b = document.getElementById('splash-bar');
    const p = document.getElementById('splash-percent');
    const f = document.getElementById('splash-file');
    const g = document.getElementById('splash-tag');
    if (!s) return;
    let cur = 0;
    const timer = setInterval(function() {
        cur += 4;
        if (cur > 100) cur = 100;
        if (b) b.style.width = cur + '%';
        if (p) p.innerText = 'ЗАГРУЗКА СИСТЕМЫ: ' + cur + '%';
        const idx = Math.min(Math.floor((cur / 100) * SPLASH_FILES.length), SPLASH_FILES.length - 1);
        if (f) f.innerText = SPLASH_FILES.at(idx);
        if (g) g.innerText = (cur < 100) ? '[' + cur + '%]' : '[ГОТОВО]';
        if (cur >= 100) {
            clearInterval(timer);
            s.style.opacity = '0';
            setTimeout(function() { s.style.display = 'none'; }, 250);
        }
    }, 25);
}

window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    document.querySelectorAll('.pwa-install-btn').forEach(function(btn) {
        btn.style.display = 'inline-block';
    });
});

window.addEventListener('appinstalled', function() {
    deferredPrompt = null;
    document.querySelectorAll('.pwa-install-btn').forEach(function(btn) {
        btn.style.display = 'none';
    });
});

async function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
    } else {
        alert('Чтобы установить приложение МСБ55115, откройте меню браузера (⋮ или "Поделиться") и нажмите "Установить приложение" / "Добавить на главный экран".');
    }
}
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray.fill(rawData.charCodeAt(i), i, i + 1);
    return outputArray;
}

async function subscribeToWebPush(forceRenew) {
    if (window.MsbNative || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    try {

        if (Notification.permission === 'denied') return;
        const permission = (Notification.permission === 'granted')
            ? 'granted'
            : await Notification.requestPermission();
        if (permission !== 'granted') return;

        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const readyReg = await navigator.serviceWorker.ready;
        if ('PushManager' in window && publicVapidKey) {
            let sub = await readyReg.pushManager.getSubscription();
            if (sub && forceRenew) {
                try { await sub.unsubscribe(); } catch (e) {}
                sub = null;
            }
            if (!sub) {
                sub = await readyReg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });
            }
            const cleanSub = (typeof sub.toJSON === 'function') ? sub.toJSON() : sub;
                   const subPayload = {
                type: 'save_sub',
                user: currentUser || localStorage.getItem('journal_user') || 'ГОСТЬ',
                callsign: currentCallsign || localStorage.getItem('journal_callsign') || '',
                theme: localStorage.getItem('msb_app_theme') || 'military',
                sub: cleanSub
            };

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(subPayload));
            }
            fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subPayload)
            }).catch(function() {});
        }
    } catch (e) {}
}


if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(ev) {
        if (!ev || !ev.data) return;
        if (ev.data.type === 'resubscribe_push') subscribeToWebPush(true);
        if (ev.data.type === 'wake_sync') {
            connectWS(true);
            if (typeof fetchMessages === 'function') fetchMessages();
            if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests(true);
        }
    });
}

function createWavUrl(freq, durationSec, volume) {
    const sr = 8000;
    const numSamples = sr * durationSec;
    const buf = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buf);
    const writeStr = function(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    for (let i = 0; i < numSamples; i++) {
        let sample = 0;
        if (volume > 0) {
            const f = (i % sr < sr / 2) ? freq : freq * 1.3;
            sample = Math.sin(2 * Math.PI * f * (i / sr)) * volume * 32767;
        }
        view.setInt16(44 + i * 2, sample, true);
    }
    return URL.createObjectURL(new Blob(Array.of(buf), { type: 'audio/wav' }));
}
function unlockMobileFeatures() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!sirenAudio) {
            sirenAudio = new Audio(createWavUrl(880, 1, 0.9));
            sirenAudio.loop = true;
        }
    } catch (e) {}
    if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(function() {});
    }
}

const SOUND_PRESETS = Array.of(
    { id: 'alarm1', name: '🚨 Тревога 1 (Сирена МСБ — стандарт)', type: 'alarm' },
    { id: 'alarm2', name: '🚨 Тревога 2 (Двойной радарный импульс)', type: 'alarm' },
    { id: 'nice1',  name: '🎵 Красивый 1 (Хрустальный аккорд)', type: 'nice' },
    { id: 'nice2',  name: '🎵 Красивый 2 (Космическое эхо)', type: 'nice' },
    { id: 'nice3',  name: '🎵 Красивый 3 (Тёплая маримба)', type: 'nice' },
    { id: 'bank1',  name: '🏦 Банк 1 (Сбер / Перевод зачислен)', type: 'bank' },
    { id: 'bank2',  name: '🏦 Банк 2 (Премиум Банк / Push)', type: 'bank' }
);

function playToneNotes(notes, waveType) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        notes.forEach(function(n) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = n.type || waveType || 'sine';
            osc.frequency.setValueAtTime(n.f, now + n.t);
                       if (n.fEnd) osc.frequency.exponentialRampToValueAtTime(n.fEnd, now + n.t + n.d);
            gain.gain.setValueAtTime(0.001, now + n.t);
            gain.gain.linearRampToValueAtTime(n.v || 0.35, now + n.t + 0.02);

            gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
            osc.connect(gain);

            gain.connect(audioCtx.destination);
            osc.start(now + n.t);
            osc.stop(now + n.t + n.d + 0.02);
        });
    } catch (e) {}
}

function playSoundById(soundId, isPreview) {
    const id = soundId || selectedSoundId || 'alarm1';
    try {
        if (navigator.vibrate) {
            navigator.vibrate(id.startsWith('alarm') ? Array.of(600, 200, 600) : Array.of(200, 100, 200));
        }
        if (id === 'alarm1') {
            if (!isPreview && sirenAudio) sirenAudio.play().catch(function() {});
            playToneNotes(Array.of(
                { f: 880, fEnd: 1140, t: 0, d: 0.25, v: 0.4, type: 'sawtooth' },
                { f: 1140, fEnd: 880, t: 0.25, d: 0.25, v: 0.4, type: 'sawtooth' }
            ));
        } else if (id === 'alarm2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 960, t: 0, d: 0.14, v: 0.45, type: 'square' },
                { f: 960, t: 0.18, d: 0.14, v: 0.45, type: 'square' },
                { f: 1280, t: 0.38, d: 0.28, v: 0.45, type: 'square' }
            ));
        } else if (id === 'nice1') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 523.25, t: 0, d: 0.45, v: 0.3, type: 'sine' },
                { f: 659.25, t: 0.10, d: 0.45, v: 0.3, type: 'sine' },
                { f: 783.99, t: 0.20, d: 0.55, v: 0.3, type: 'sine' },
                { f: 1046.50, t: 0.30, d: 0.70, v: 0.35, type: 'sine' }
            ));
        } else if (id === 'nice2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 440, t: 0, d: 0.35, v: 0.3, type: 'triangle' },
                { f: 554.37, t: 0.18, d: 0.35, v: 0.3, type: 'triangle' },
                { f: 659.25, t: 0.36, d: 0.65, v: 0.35, type: 'triangle' }
            ));
        } else if (id === 'nice3') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 587.33, t: 0, d: 0.22, v: 0.35, type: 'sine' },
                { f: 880, t: 0.14, d: 0.22, v: 0.35, type: 'sine' },
                { f: 739.99, t: 0.28, d: 0.22, v: 0.35, type: 'sine' },
                { f: 1174.66, t: 0.42, d: 0.55, v: 0.4, type: 'sine' }
            ));
        } else if (id === 'bank1') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 783.99, t: 0, d: 0.16, v: 0.4, type: 'sine' },
                { f: 1567.98, t: 0.12, d: 0.15, v: 0.18, type: 'triangle' },
                { f: 1174.66, t: 0.14, d: 0.48, v: 0.45, type: 'sine' },
                { f: 2349.32, t: 0.14, d: 0.35, v: 0.18, type: 'triangle' }
            ));
        } else if (id === 'bank2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes(Array.of(
                { f: 1046.50, t: 0, d: 0.11, v: 0.38, type: 'sine' },
                { f: 1318.51, t: 0.09, d: 0.11, v: 0.38, type: 'sine' },
                { f: 1567.98, t: 0.18, d: 0.45, v: 0.45, type: 'sine' }
            ));
        }
    } catch (e) {}
}

function playBeep() {
    playSoundById(selectedSoundId, false);
}
function openSoundModal() {
    const modal = document.getElementById('sound-modal');
    const list = document.getElementById('sound-options-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    SOUND_PRESETS.forEach(function(s) {
        const isSel = (s.id === selectedSoundId);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border-radius:8px; cursor:pointer; background:' + (isSel ? 'rgba(59,130,246,0.22)' : '#0f172a') + '; border:1px solid ' + (isSel ? '#38bdf8' : '#334155') + ';';
        row.innerHTML = '<span style="color:#f8fafc; font-size:13px; font-weight:' + (isSel ? 'bold' : 'normal') + ';">' + (isSel ? '🔘 ' : '⚪ ') + s.name + '</span>' +
            '<button type="button" style="width:auto; padding:6px 12px; background:#0284c7; font-size:12px; border-radius:6px;">▶️ Тест</button>';
        row.onclick = function() {
            selectedSoundId = s.id;
            localStorage.setItem('msb_sound_id', s.id);
            if (window.MsbNative && typeof window.MsbNative.setSound === 'function') {
                try { window.MsbNative.setSound(s.id); } catch (e) {}
            }
            if (typeof sendFcmTokenToServer === 'function') {
                sendFcmTokenToServer();
            }
            playSoundById(s.id, true);
            openSoundModal();
        };

        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function closeSoundModal() {
    const modal = document.getElementById('sound-modal');
    if (modal) modal.style.display = 'none';
}

function handleStreamBtnClick() {
    if (currentUser === ADMIN_NAME) {
        const box = document.getElementById('admin-stream-box');
        box.style.display = (box.style.display === 'block') ? 'none' : 'block';
    } else {
        if (activeStream && activeStream.active && activeStream.url) {
            const uBox = document.getElementById('user-stream-box');
            uBox.style.display = (uBox.style.display === 'block') ? 'none' : 'block';
        } else {
            alert('Видеострим сейчас не запущен администратором.');
        }
    }
}

function openStreamInAppPage(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer,width=1100,height=750');
}

function closeStreamPage() {
    const page = document.getElementById('stream-page');
    const iframe = document.getElementById('stream-iframe');
    if (page) page.style.display = 'none';
    if (iframe) iframe.src = 'about:blank';
}

function openStreamExternalFallback() {
    const url = (activeStream && activeStream.url) ? activeStream.url : document.getElementById('stream-url-input').value.trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer,width=1100,height=750');
}

function openActiveStreamWindow() {
    if (activeStream && activeStream.url) {
        window.open(activeStream.url, '_blank', 'noopener,noreferrer,width=1100,height=750');
    }
}

function startVideoStream() {
    if (currentUser !== ADMIN_NAME) return;
    const url = document.getElementById('stream-url-input').value.trim();
    if (!url) return alert('Вставьте ссылку на стрим!');
    const now = new Date();
    const timeString = now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5);
    ws.send(JSON.stringify({
        type: 'stream_start', url: url, sender: currentUser, color: userColor, time: timeString
    }));
    window.open(url, '_blank', 'noopener,noreferrer,width=1100,height=750');
}

function stopVideoStream() {
    if (currentUser !== ADMIN_NAME) return;
    ws.send(JSON.stringify({ type: 'stream_stop' }));
    closeStreamPage();
}

function updateStreamUI() {
    const mainBtn = document.getElementById('stream-main-btn');
    const userBox = document.getElementById('user-stream-box');
    const viewerPanel = document.getElementById('viewer-stream-panel');
    const urlInput = document.getElementById('stream-url-input');
    if (activeStream && activeStream.active && activeStream.url) {
        if (urlInput && currentUser !== ADMIN_NAME) urlInput.value = activeStream.url;
        if (mainBtn) { mainBtn.classList.add('live'); mainBtn.innerText = '🔴 ИДЕТ ВИДЕОСТРИМ МСБ-55115'; }
        if (currentUser && currentUser !== ADMIN_NAME && userBox) userBox.style.display = 'block';
        if (!currentUser && viewerPanel) viewerPanel.style.display = 'block';
    } else {
        if (mainBtn) { mainBtn.classList.remove('live'); mainBtn.innerText = '🎥 ВИДЕОСТРИМ МСБ-55115'; }
        if (userBox) userBox.style.display = 'none';
        if (viewerPanel) viewerPanel.style.display = 'none';
    }
}
let mapsLastFetchedAt = 0;
let archiveLastFetchedAt = 0;

function toggleMapsSection() {
    const box = document.getElementById('maps-section-box');
    if (!box) return;
    const isOpening = (box.style.display !== 'block');
    box.style.display = isOpening ? 'block' : 'none';
    if (isOpening) fetchMapsFromServer(true);
    else renderMapsGrid();
}

function isMapVisibleForMe(m) {
    if (!m) return false;
    if (m.target === "ВСЕМ") return true;
    if (currentUser === ADMIN_NAME) return true;
    if (currentUser && (m.target === currentUser || m.sender === currentUser)) return true;
    if (currentCallsign && (m.target === currentCallsign || m.sender === currentCallsign)) return true;
    return false;
}

let photoZoom = 1, photoPanX = 0, photoPanY = 0, isDraggingPhoto = false, dragStartX = 0, dragStartY = 0, zoomEventsBound = false;

function applyPhotoTransform() {
    const img = document.getElementById('lightbox-img');
    const lbl = document.getElementById('zoom-level-label');
    if (img) img.style.transform = 'translate(' + photoPanX + 'px, ' + photoPanY + 'px) scale(' + photoZoom + ')';
    if (lbl) lbl.innerText = Math.round(photoZoom * 100) + '%';
}

function changePhotoZoom(delta) {
    photoZoom = Math.min(5, Math.max(1, photoZoom + delta));
    if (photoZoom === 1) { photoPanX = 0; photoPanY = 0; }
    applyPhotoTransform();
}

function resetPhotoZoom() {
    photoZoom = 1; photoPanX = 0; photoPanY = 0;
    applyPhotoTransform();
}

function bindPhotoZoomEvents() {
    if (zoomEventsBound) return;
    zoomEventsBound = true;
    const vp = document.getElementById('lb-viewport');
    if (!vp) return;
    vp.addEventListener('wheel', function(e) { e.preventDefault(); changePhotoZoom(e.deltaY < 0 ? 0.35 : -0.35); }, { passive: false });
    vp.addEventListener('pointerdown', function(e) {
        if (photoZoom <= 1) return;
        isDraggingPhoto = true; dragStartX = e.clientX - photoPanX; dragStartY = e.clientY - photoPanY;
        vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function(e) {
        if (!isDraggingPhoto) return;
        photoPanX = e.clientX - dragStartX; photoPanY = e.clientY - dragStartY;
        applyPhotoTransform();
    });
    vp.addEventListener('pointerup', function() { isDraggingPhoto = false; });
    vp.addEventListener('pointercancel', function() { isDraggingPhoto = false; });
}

function openPhotoLightbox(src, caption) {
    const lb = document.getElementById('photo-lightbox');
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');
    if (lb && img) {
        img.src = src;
        if (cap) cap.innerText = caption || '';
        resetPhotoZoom(); bindPhotoZoomEvents();
        lb.style.display = 'flex';
    }
}

function closePhotoLightbox() {
    const lb = document.getElementById('photo-lightbox');
    if (lb) lb.style.display = 'none';
}
function renderMapsGrid() {
    const grid = document.getElementById('maps-tiles-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const myMaps = allMaps.filter(isMapVisibleForMe).slice(-6).reverse();
    if (myMaps.length === 0) {
        grid.innerHTML = '<div style="color:#64748b; font-size:13px; grid-column: 1 / -1; padding:10px 0;">Нет загруженных карт или вводных</div>';
        return;
    }
    myMaps.forEach(function(m, idx) {
        const tile = document.createElement('div');
        tile.className = 'map-tile';
        const badge = (idx === 0) ? '<span class="map-tile-fresh">СВЕЖЕЕ</span>' : '';
        tile.innerHTML =
            badge +
            '<img src="' + m.image + '" loading="lazy" alt="Карта">' +
            '<div class="map-tile-overlay">' +
                '<span class="map-tile-time">🕒 ' + m.time + '</span>' +
                '<span class="map-tile-target">' + m.target + '</span>' +
            '</div>';
        tile.onclick = function() {
            openPhotoLightbox(m.image, 'КОМУ: ' + m.target + ' | ВРЕМЯ: ' + m.time);
        };
        grid.appendChild(tile);
    });
}

function fetchMapsFromServer(force) {
    if (allMaps.length === 0) {
        const cachedMaps = loadLocalJournalCache('maps', new Array());
        if (Array.isArray(cachedMaps) && cachedMaps.length > 0) {
            allMaps = cachedMaps;
            renderMapsGrid();
        }
    }
    if (!force && (Date.now() - mapsLastFetchedAt < 45000)) return;
    mapsLastFetchedAt = Date.now();
    fetch('/maps-list?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(list) {
            if (Array.isArray(list)) {
                allMaps = list;
                saveLocalJournalCache('maps', list);
                renderMapsGrid();
            }
        })
        .catch(function() {});
}

function uploadMapPhoto() {
    if (currentUser !== ADMIN_NAME) return alert('Загружать карты может только АДМИН!');
    const fileInput = document.getElementById('map-file-input');
    const targetSelect = document.getElementById('map-target-select');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        return alert('Сначала выберите фотографию или карту!');
    }
    const file = fileInput.files.item(0);
    const target = (targetSelect && targetSelect.value) ? targetSelect.value : 'ВСЕМ';
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let w = img.width || 600, h = img.height || 600;
            const maxS = 750;
            if (w > maxS || h > maxS) {
                if (w > h) { h = Math.round(h * (maxS / w)); w = maxS; }
                else { w = Math.round(w * (maxS / h)); h = maxS; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const finalDataUrl = canvas.toDataURL('image/jpeg', 0.65);
            const now = new Date();
            const timeStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5);
            fetch('/upload-map', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: currentUser, color: userColor, target: target, time: timeStr, image: finalDataUrl })
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                fileInput.value = '';
                if (data && Array.isArray(data.maps)) {
                    allMaps = data.maps;
                    saveLocalJournalCache('maps', data.maps);
                    renderMapsGrid();
                } else fetchMapsFromServer(true);
            })
            .catch(function() { alert('Ошибка при отправке фото на сервер!'); });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
const MONTH_NAMES = Array.of(
    "ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ",
    "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"
);

function formatIsoDate(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function formatRuDateFromIso(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    return (parts.length === 3) ? (parts.at(2) + '.' + parts.at(1) + '.' + parts.at(0)) : iso;
}

function fetchArchiveFromServer(force) {
    if (Object.keys(archiveData).length === 0) {
        const cachedArch = loadLocalJournalCache('archive', {});
        if (cachedArch && typeof cachedArch === 'object' && Object.keys(cachedArch).length > 0) {
            archiveData = cachedArch;
            renderArchiveCalendar();
            if (selectedArchiveDate) selectArchiveDate(selectedArchiveDate);
        }
    }
    if (!force && (Date.now() - archiveLastFetchedAt < 60000)) return;
    archiveLastFetchedAt = Date.now();
    fetch('/archive-data?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && typeof data === 'object') {
                archiveData = data;
                saveLocalJournalCache('archive', data);
                renderArchiveCalendar();
                if (selectedArchiveDate) selectArchiveDate(selectedArchiveDate);
            }
        }).catch(function() {});
}

function openArchivePage() {
    const page = document.getElementById('archive-page');
    if (!page) return;
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    const todayKey = formatIsoDate(calYear, calMonth, now.getDate());
    if (!selectedArchiveDate) selectedArchiveDate = todayKey;
    page.style.display = 'flex';
    renderArchiveCalendar();
    selectArchiveDate(selectedArchiveDate);
    fetchArchiveFromServer(true);
}

function closeArchivePage() {
    const page = document.getElementById('archive-page');
    if (page) page.style.display = 'none';
}

function changeArchiveMonth(delta) {
    calMonth += delta;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderArchiveCalendar();
}

function renderArchiveCalendar() {
    const titleEl = document.getElementById('cal-month-label');
    const gridEl = document.getElementById('cal-days-grid');
    if (!titleEl || !gridEl) return;
    titleEl.innerText = MONTH_NAMES.at(calMonth) + ' ' + calYear;
    gridEl.innerHTML = '';
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const startOffset = (firstDay === 0) ? 6 : (firstDay - 1);
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    for (let i = 0; i < startOffset; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'cal-day empty';
        gridEl.appendChild(emptyDiv);
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = formatIsoDate(calYear, calMonth, d);
        const rowsForDay = archiveData[dateKey] || new Array();
        const count = Array.isArray(rowsForDay) ? rowsForDay.length : 0;
        const cell = document.createElement('div');
        cell.className = 'cal-day' + (count > 0 ? ' has-data' : '') + (selectedArchiveDate === dateKey ? ' selected' : '');
        cell.innerHTML = '<span>' + d + '</span>' + (count > 0 ? '<span class="cal-dot">' + count + ' зап.</span>' : '');
        cell.onclick = function() { selectArchiveDate(dateKey); };
        gridEl.appendChild(cell);
    }
}
function selectArchiveDate(dateKey) {
    selectedArchiveDate = dateKey;
    renderArchiveCalendar();
    const ruDate = formatRuDateFromIso(dateKey);
    const lbl = document.getElementById('archive-selected-label');
    const tTitle = document.getElementById('archive-table-title');
    const badge = document.getElementById('archive-count-badge');
    const tbody = document.getElementById('archive-table-body');
    if (lbl) lbl.innerText = '📅 ' + ruDate;
    if (tTitle) tTitle.innerText = '📊 Архив журнала за ' + ruDate;
    const rows = Array.isArray(archiveData[dateKey]) ? archiveData[dateKey] : new Array();
    if (badge) badge.innerText = rows.length + ' записей';
    if (!tbody) return;
    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (COLUMNS_CONFIG.length + 2) + '" style="color:#64748b; padding:20px;">За ' + ruDate + ' записей в архиве нет</td></tr>';
        return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach(function(row) {
        const tr = document.createElement('tr');
        let html = '<td class="time-cell">' + (row.time || '-') + '</td><td class="user-cell" style="color:' + (row.color || '#fff') + '">' + (row.user || '-') + '</td>';
        for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
            const val = (row.values && row.values.at(i) !== undefined) ? row.values.at(i) : '-';
            html += '<td>' + (val || '-') + '</td>';
        }
        tr.innerHTML = html;
        frag.appendChild(tr);
    });
    tbody.appendChild(frag);
}

function isNotificationVisibleForMe(notif) {
    if (!notif) return false;
    if (notif.target === "ВСЕМ") return true;
    if (currentUser === ADMIN_NAME) return true;
    const tLow = String(notif.target || '').trim().toLowerCase();
    const sLow = String(notif.sender || '').trim().toLowerCase();
    const myCallLow = String(currentCallsign || '').trim().toLowerCase();
    const myUserLow = String(currentUser || '').trim().toLowerCase();
    if (myCallLow && (tLow === myCallLow || sLow === myCallLow || sLow.indexOf('(' + myCallLow + ')') !== -1)) return true;
    if (myUserLow && (tLow === myUserLow || sLow === myUserLow)) return true;
    return false;
}

function renderNotificationsWindow() {
    const list = document.getElementById('notifications-list');
    if (!list) return;
    list.innerHTML = '';
    const myNotifs = allNotifications.filter(isNotificationVisibleForMe).slice(-10);
    if (myNotifs.length === 0) {
        list.innerHTML = '<div style="color:#64748b; font-size:13px;" id="no-notif-placeholder">Нет уведомлений</div>';
    } else {
        const frag = document.createDocumentFragment();
        myNotifs.forEach(function(notif) {
            const item = document.createElement('div');
            item.className = 'notif-item' + (notif.read ? ' read' : '');
            const statusText = notif.read ? ('✅ ПРОЧИТАНО' + (notif.readBy ? ' (' + notif.readBy + ')' : '')) : '⏳ НЕ ПРОЧИТАНО';
            item.innerHTML =
                '<span class="notif-time">' + notif.time + '</span>' +
                '<span class="notif-sender" style="color:' + (notif.color || '#ef4444') + '">' + notif.sender + '</span>' +
                '<span class="notif-target">КОМУ: ' + notif.target + '</span>' +
                '<span class="notif-text">' + notif.text + '</span>' +
                '<span class="notif-status">' + statusText + '</span>';
            item.onclick = function() {
                openMessengerWindow(notif.sender);
            };
            frag.appendChild(item);
        });
        list.appendChild(frag);
        list.scrollTop = list.scrollHeight;
    }
    updateBroadcastTicker();
}

function updateBroadcastTicker() {
    const ticker = document.getElementById('msg-broadcast-ticker');
    if (!ticker) return;
    const allBroadcasts = allNotifications.filter(function(n) {
        return n && n.target === 'ВСЕМ';
    }).slice(-8).reverse();
    if (allBroadcasts.length === 0) {
        ticker.innerText = '📢 СВОДКА «ВСЕМ»: Пока нет общих оповещений...';
        return;
    }
    const parts = allBroadcasts.map(function(n) {
        return '⚡ [' + (n.time || '') + '] ' + (n.sender || 'АДМИН') + ' ➔ ВСЕМ: ' + n.text;
    });
    ticker.innerText = parts.join('   |   ');
}
function getAlertsQueue(target) {
    if (!target) return new Array();
    const tLow = String(target).trim().toLowerCase();
    let raw = pendingAlerts[target];
    if (!raw) {
        const matchKey = Object.keys(pendingAlerts).find(function(k) {
            return k.trim().toLowerCase() === tLow;
        });
        if (matchKey) raw = pendingAlerts[matchKey];
    }
    if (!raw) return new Array();
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        return Array.of({ id: null, text: raw, sender: ADMIN_NAME, readList: new Array() });
    }
    return Array.of(raw);
}

function checkServerVersionChange(bootId, bootTime) {
    if (!bootId || IS_LOCAL_APK) return;

    if (!knownServerBootId) {
        knownServerBootId = bootId;
        sessionStorage.setItem('msb_server_boot_id', bootId);
        return;
    }
    if (knownServerBootId !== bootId) {
        pendingServerBootId = bootId;
        const modal = document.getElementById('server-update-modal');
        const timeEl = document.getElementById('update-server-time');
        if (timeEl) timeEl.innerText = bootTime || getStaticDateTime();
        if (modal && modal.style.display !== 'flex') {
            modal.style.display = 'flex';
            playSoundById('bank2', true);
        }
    }
}

async function forceReloadApp() {
    if (pendingServerBootId) {
        sessionStorage.setItem('msb_server_boot_id', pendingServerBootId);
    } else {
        sessionStorage.removeItem('msb_server_boot_id');
    }
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let k of keys) {
                if (k !== 'msb55115-media-v1') await caches.delete(k);
            }
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) await r.unregister();
        }
    } catch (e) {}
    window.location.href = window.location.pathname + '?v=' + Date.now();
}

let lastPongTime = Date.now();
let wsReconnectTimer = null;

function connectWS(forceReconnect) {
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }
    if (forceReconnect && ws) {
        try {
            ws.onclose = null;
            ws.close();
        } catch (e) {}
        ws = null;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
        ws = new WebSocket(API_ORIGIN.replace(/^http/, 'ws'));
    } catch (e) {
        wsReconnectTimer = setTimeout(function() { connectWS(false); }, 2000);
        return;
    }

    ws.onopen = function() {
        lastPongTime = Date.now();
        var uInit = currentUser || localStorage.getItem('journal_user') || '';
        var cInit = currentCallsign || localStorage.getItem('journal_callsign') || '';
        if (uInit || cInit) {
            try {
                ws.send(JSON.stringify({ type: 'ping', user: uInit, callsign: cInit }));
            } catch (e) {}
        }
        subscribeToWebPush(false);
        if (typeof flushOutboxQueue === 'function') flushOutboxQueue();
    };


    ws.onmessage = handleWsIncomingEvent;

    ws.onclose = function() {
        wsReconnectTimer = setTimeout(function() { connectWS(false); }, 1800);
    };
}
function handleWsIncomingEvent(event) {
    lastPongTime = Date.now();
    let msg = null;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (!msg) return;

    if (typeof window.markMsbServerAlive === 'function') {
        window.markMsbServerAlive(msg.type === 'init');
    }
    if (msg.serverBootId) {
        checkServerVersionChange(msg.serverBootId, msg.serverBootTime);
    }
    if (msg.type === 'pong') return;

    if (msg.type && msg.type.indexOf('call_') === 0 && typeof window.handleMsbAudioCallWS === 'function') {
        window.handleMsbAudioCallWS(msg);
        return;
    }


     if (msg.type === 'presence_update' && typeof window.handlePresenceUpdateWS === 'function') {
        window.handlePresenceUpdateWS(msg);
        return;
    }

       if ((msg.type === 'chat_typing' || msg.type === 'typing') && typeof window.handleIncomingTypingWS === 'function') {
        window.handleIncomingTypingWS(msg);
        return;
    }

    if (msg.type === 'pin_unlocked_by_admin' && msg.user) {
        const who = String(currentCallsign || currentUser || '').trim().toLowerCase();
        if (who && who === String(msg.user).trim().toLowerCase()) {
            localStorage.removeItem('msb_user_has_pin_' + who);
            sessionStorage.setItem('msb_pin_verified_' + who, '1');
            const lockModal = document.getElementById('msb-pin-lock-modal');
            if (lockModal) lockModal.style.display = 'none';
            alert('✅ Администратор подтвердил сброс ПИН-кода! Доступ открыт.');
        }
        return;
    }

    if ((msg.type === 'room_history' || msg.type === 'chat_new_msg' || msg.type === 'chat_msg_deleted' || msg.type === 'chat_msg_edited' || msg.type === 'chat_room_read' || msg.type === 'avatar_updated') && typeof window.handleIncomingChatWS === 'function') {
        window.handleIncomingChatWS(msg);
        return;
    }


    if (msg.type === 'init') {
        const tbody = document.getElementById('table-body');
        if (tbody) {
            tbody.innerHTML = '';
            const frag = document.createDocumentFragment();
            (msg.data || []).forEach(function(r) { appendRowToContainer(frag, r, false); });
            tbody.appendChild(frag);
            if (tbody.lastElementChild) {
                requestAnimationFrame(function() {
                    tbody.lastElementChild.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                });
            }
        }
        saveLocalJournalCache('table_rows', msg.data || []);
        allNotifications = msg.notifications || new Array();
        saveLocalJournalCache('notifs', allNotifications);
        renderNotificationsWindow();
        fetchMapsFromServer(false);
        if (msg.streamState) {
            activeStream = msg.streamState;
            updateStreamUI();
        }
        if (msg.vapidPublicKey) {
            publicVapidKey = msg.vapidPublicKey;
            localStorage.setItem('msb_vapid_pub', publicVapidKey);
            subscribeToWebPush(false);
        }
        if (msg.alerts) {
            pendingAlerts = msg.alerts;
            checkAndShowAlerts(true);
        }
        if (currentUser === ADMIN_NAME) fetchAdminUsersList();
        refreshMyPermissionsFromServer();
        if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests(true);
        if (typeof currentRoomId !== 'undefined' && currentRoomId && typeof fetchMessages === 'function') {
            fetchMessages();
        }
        return;
    }
    if (msg.type === 'new_row') {
        appendRow(msg.row);
        const curRows = loadLocalJournalCache('table_rows', new Array());
        curRows.push(msg.row);
        saveLocalJournalCache('table_rows', curRows);
        return;
    }
    if (msg.type === 'daily_archived') {
        document.getElementById('table-body').innerHTML = '';
        saveLocalJournalCache('table_rows', new Array());
        fetchArchiveFromServer(true);
        return;
    }
    if (msg.type === 'new_map') {
        fetchMapsFromServer(true);
        if (!msg.target || msg.target === 'ВСЕМ' || currentUser === ADMIN_NAME || msg.target === currentUser || msg.target === currentCallsign) {
            const box = document.getElementById('maps-section-box');
            if (box && (currentUser === ADMIN_NAME || myPermissions.maps)) box.style.display = 'block';
        }
        return;
    }
    if (msg.type === 'stream_state') {
        activeStream = msg.streamState || { active: false, url: '' };
        updateStreamUI();
        return;
    }
       if (msg.type === 'apk_updated') {
        if (typeof checkApkRemoteUpdate === 'function') checkApkRemoteUpdate(true);
        return;
    }
    if (msg.type === 'users_updated') {
        if (currentUser === ADMIN_NAME) fetchAdminUsersList();
        refreshMyPermissionsFromServer();
        if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests(true);
        return;
    }

    if (msg.type === 'history_cleared') {
        document.getElementById('table-body').innerHTML = '';
        allNotifications = new Array(); allMaps = new Array(); pendingAlerts = {};
        saveLocalJournalCache('table_rows', new Array());
        saveLocalJournalCache('notifs', new Array());
        saveLocalJournalCache('maps', new Array());
        stopAlertVisuals(); renderNotificationsWindow(); renderMapsGrid();
        return;
    }
    if (msg.type === 'all_chats_cleared') {
        try {
            Object.keys(localStorage).forEach(function(k) {
                if (k.startsWith('msb_cache_room_') || k === 'msb_edge_q') {
                    localStorage.removeItem(k);
                }
            });
        } catch (e) {}
        if (typeof msbOutboxQueue !== 'undefined') msbOutboxQueue = new Array();
        if (typeof renderedMsgIds !== 'undefined') renderedMsgIds.clear();
        if (typeof lastMessagesCount !== 'undefined') lastMessagesCount = 0;
        var mDiv = document.getElementById('messages');
        if (mDiv) mDiv.innerHTML = '<div class="chat-placeholder">Все сообщения очищены администратором.</div>';
        if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests(true);
        return;
    }

    if (msg.type === 'admin_alert') {
        if (msg.notif) {
            const exists = allNotifications.some(function(n) { return n.id === msg.notif.id; });
            if (!exists) {
                allNotifications.push(msg.notif);
                saveLocalJournalCache('notifs', allNotifications);
            }
            renderNotificationsWindow();
        }
        const queue = getAlertsQueue(msg.target);
        const alertId = msg.notif ? msg.notif.id : Date.now();
        if (!queue.some(function(a) { return a.id === alertId; })) {
            queue.push({ id: alertId, text: msg.text, sender: msg.sender || ADMIN_NAME, readList: new Array() });
        }
        pendingAlerts[msg.target] = queue;
        checkAndShowAlerts(true);
        return;
    }
    if (msg.type === 'alert_cleared') {
        handleAlertClearedMsg(msg);
    }
}
setInterval(function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (Date.now() - lastPongTime > 40000) {
            connectWS(true);
            return;
        }

        try {
            ws.send(JSON.stringify({
                type: 'ping',
                user: currentUser || '',
                callsign: currentCallsign || ''
            }));
        } catch (e) {}
    } else if (navigator.onLine !== false) {
        connectWS(false);
    }
}, 5000);

window.addEventListener('online', function() {
    connectWS(true);
    subscribeToWebPush(false);
});

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        if (!ws || ws.readyState !== WebSocket.OPEN || (Date.now() - lastPongTime > 9000)) {
            connectWS(true);
        } else {
            try {
                ws.send(JSON.stringify({
                    type: 'ping',
                    user: currentUser || '',
                    callsign: currentCallsign || ''
                }));
            } catch (e) {}
            checkAndShowAlerts(false);
            if (typeof currentRoomId !== 'undefined' && currentRoomId && typeof fetchMessages === 'function') {
                fetchMessages();
            }
            if (typeof loadFriendsAndRequests === 'function') {
                loadFriendsAndRequests(true);
            }
        }
    } else if (document.visibilityState === 'hidden') {
        if (ws && ws.readyState === WebSocket.OPEN && (currentUser || currentCallsign)) {
            try {
                ws.send(JSON.stringify({
                    type: 'user_away',
                    user: currentUser || '',
                    callsign: currentCallsign || ''
                }));
            } catch (e) {}
        }
    }
});

function handleAlertClearedMsg(msg) {
    const queue = getAlertsQueue(msg.target);
    if (msg.target === 'ВСЕМ') {
        queue.forEach(function(a) {
            if (!msg.notifId || a.id === msg.notifId) {
                if (!Array.isArray(a.readList)) a.readList = new Array();
                if (msg.who && a.readList.indexOf(msg.who) === -1) a.readList.push(msg.who);
            }
        });
        pendingAlerts[msg.target] = queue;
    } else {
        if (msg.notifId) {
            pendingAlerts[msg.target] = queue.filter(function(a) { return a.id !== msg.notifId; });
        } else {
            queue.shift();
            pendingAlerts[msg.target] = queue;
        }
        if (pendingAlerts[msg.target] && pendingAlerts[msg.target].length === 0) {
            delete pendingAlerts[msg.target];
        }
    }

    if (msg.notifId) {
        allNotifications.forEach(function(n) {
            if (n.id === msg.notifId) {
                n.read = true;
                n.readBy = msg.readBy || '';
            }
        });
    } else {
        let marked = false;
        allNotifications.forEach(function(n) {
            if (!marked && n.target === msg.target) {
                n.read = true;
                n.readBy = msg.readBy || '';
                marked = true;
            }
        });
    }
    saveLocalJournalCache('notifs', allNotifications);
    renderNotificationsWindow();

    const myName = currentCallsign || currentUser || 'Просмотр';
    if (currentAlertTarget === msg.target && (!msg.notifId || currentAlertId === msg.notifId)) {
        if (msg.target !== 'ВСЕМ' || msg.who === myName || msg.who === currentUser) {
            stopAlertVisuals();
        }
    }
    checkAndShowAlerts(false);
}
function populateTargetSelect() {
    const adminSelect = document.getElementById('admin-target');
    const miniSelect = document.getElementById('mini-notif-target');
    const mapSelect = document.getElementById('map-target-select');
    const onlyFriends = myMessengerFriends.filter(function(f) { return f && !f.isGroup; });
    const sigParts = Array.of(currentUser || '');
    onlyFriends.forEach(function(f) {
        sigParts.push(f.name + ':' + (f.online ? '1' : '0') + ':' + (f.unit || ''));
    });
    const newSig = sigParts.join('|');
    if (newSig !== lastTargetOptionsSig) {
        lastTargetOptionsSig = newSig;
        Array.of(adminSelect, miniSelect).forEach(function(sel) {
            if (!sel) return;
            const prevVal = sel.value;
            sel.innerHTML = '';
            let optAll = document.createElement('option');
            optAll.value = "ВСЕМ";
            optAll.innerText = "📢 ВСЕМ";
            sel.appendChild(optAll);
            onlyFriends.forEach(function(f) {
                let opt = document.createElement('option');
                opt.value = f.name;
                opt.innerText = (f.online ? "🟢 " : "⚫ ") + f.name + (f.unit ? " (" + f.unit + ")" : "");
                sel.appendChild(opt);
            });
            if (prevVal && Array.from(sel.options).some(function(o) { return o.value === prevVal; })) {
                sel.value = prevVal;
            }
        });
    }
    if (mapSelect && mapSelect.options.length === 0) {
        mapSelect.innerHTML = '<option value="ВСЕМ">📢 ВСЕМ</option>';
        USERS_CONFIG.forEach(function(u) {
            if (u.name !== currentUser) {
                let opt = document.createElement('option');
                opt.value = u.name;
                opt.innerText = u.name;
                mapSelect.appendChild(opt);
            }
        });
    }
}

function applyPermissionsUI() {
    const isAdmin = (currentUser === ADMIN_NAME);
    const canRow = isAdmin || (myPermissions && myPermissions.row);
    const canStream = isAdmin || (myPermissions && myPermissions.stream);
    const canMaps = isAdmin || (myPermissions && myPermissions.maps);
    const canArchive = isAdmin || (myPermissions && myPermissions.archive);
    const canTable = isAdmin || (myPermissions && myPermissions.table);

    const gridEl = document.getElementById('dynamic-inputs');
    if (gridEl) gridEl.style.display = canRow ? 'grid' : 'none';

    document.querySelectorAll('.send-btn, #submit-row-btn, #send-row-btn, button[onclick*="submitRow"]').forEach(function(btn) {
        btn.style.display = canRow ? 'block' : 'none';
    });

    document.querySelectorAll('button').forEach(function(btn) {
        if (btn.innerText && btn.innerText.includes('ЗАПИСАТЬ В ЖУРНАЛ')) {
            btn.style.display = canRow ? 'block' : 'none';
        }
    });

    const streamBtn = document.getElementById('stream-main-btn');
    const mapsBtn = document.getElementById('maps-main-btn');
    const archBtn = document.querySelector('.archive-main-btn');
    const notifArchBtn = document.getElementById('notif-archive-btn');
    const tableSection = document.getElementById('journal-table-section');

    if (streamBtn) streamBtn.style.display = canStream ? 'block' : 'none';
    if (mapsBtn) mapsBtn.style.display = canMaps ? 'block' : 'none';
    if (archBtn) archBtn.style.display = canArchive ? 'block' : 'none';
    if (notifArchBtn) notifArchBtn.style.display = canArchive ? 'inline-block' : 'none';
    if (tableSection) tableSection.style.display = canTable ? 'block' : 'none';
}

function applyUserUI() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('input-panel').style.display = 'block';
    document.getElementById('my-name').innerText = currentUser;
    document.getElementById('my-name').style.color = userColor;
    const badge = document.getElementById('my-callsign-badge');
    if (badge) badge.innerText = currentCallsign ? ('[' + currentCallsign + ']') : '';
    const az = document.getElementById('admin-zone');
    if (az) az.style.display = 'none';
    const miniBar = document.getElementById('mini-notif-reply-bar');
    if (miniBar) miniBar.style.display = 'flex';
    lastTargetOptionsSig = "";
    applyPermissionsUI();
    populateTargetSelect();
    renderNotificationsWindow();
    renderMapsGrid();
    updateStreamUI();
    if (currentUser === ADMIN_NAME) {
        document.getElementById('admin-maps-upload').style.display = 'block';
        document.getElementById('admin-users-btn').style.display = 'inline-block';
        fetchAdminUsersList();
    } else {
        document.getElementById('admin-stream-box').style.display = 'none';
        document.getElementById('admin-maps-upload').style.display = 'none';
        document.getElementById('admin-users-btn').style.display = 'none';
    }
    if (typeof syncMessengerAuth === 'function') syncMessengerAuth();
    if (typeof checkPinOnAppEntry === 'function') {
        checkPinOnAppEntry();
    } else {
        openFriendsListDirectly();
    }
}

function openFriendsListDirectly() {
    setTimeout(function() {
        if (typeof openMessengerWindow === 'function') {
            openMessengerWindow();
        }
        var sb = document.getElementById('app-sidebar');
        if (sb) {
            sb.classList.remove('hidden');
        }
    }, 50);
}



function initApp() {
    runSplash();
    hideAuthMessages();
    const savedTheme = localStorage.getItem('msb_app_theme') || 'military';
    setAppTheme(savedTheme, true);
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        document.querySelectorAll('.pwa-install-btn').forEach(function(btn) { btn.style.display = 'none'; });
    }
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function() {});
    }
    document.body.addEventListener('click', function firstTouch() {
        unlockMobileFeatures();
        subscribeToWebPush(false);
        document.body.removeEventListener('click', firstTouch);
    }, { once: true });

    const loginSelect = document.getElementById('login-select');
    const regSelect = document.getElementById('reg-unit-select');
    if (loginSelect) loginSelect.innerHTML = '';
    if (regSelect) regSelect.innerHTML = '';
    USERS_CONFIG.forEach(function(u, index) {
        let opt = document.createElement('option');
        opt.value = index;
        opt.innerText = u.name;
        if (loginSelect) loginSelect.appendChild(opt);
        if (regSelect && u.name !== ADMIN_NAME) {
            let optR = document.createElement('option');
            optR.value = u.name;
            optR.innerText = u.name;
            regSelect.appendChild(optR);
        }
    });

    const headerRow = document.getElementById('table-headers');
    const archHeaderRow = document.getElementById('archive-table-headers');
    const inputContainer = document.getElementById('dynamic-inputs');
    headerRow.innerHTML = '<th style="width: 130px;">🕒 Время</th><th style="width: 110px;">👤 Кто</th>';
    if (archHeaderRow) archHeaderRow.innerHTML = '<th style="width: 130px;">🕒 Время</th><th style="width: 110px;">👤 Кто</th>';
    inputContainer.innerHTML = '';
    const inputsFrag = document.createDocumentFragment();
    COLUMNS_CONFIG.forEach(function(col, index) {
        let th = document.createElement('th');
        th.innerText = col.label;
        headerRow.appendChild(th);
        if (archHeaderRow) {
            let thA = document.createElement('th');
            thA.innerText = col.label;
            archHeaderRow.appendChild(thA);
        }
        let div = document.createElement('div');
        div.className = 'field-group';
        let inputHtml = '';
        if (col.options && col.options.length > 0) {
            let opts = col.options.map(function(o) { return '<option>' + o + '</option>'; }).join('');
            inputHtml = '<select id="in-' + index + '"><option value="" disabled selected>-</option>' + opts + '</select>';
        } else if (col.digitsOnly) {
            inputHtml = '<input type="text" id="in-' + index + '" placeholder="Цифры, дробь, слэш..." oninput="this.value = this.value.replace(/[^0-9.,\\/\\\\]/g, \'\')">';
        } else {
            inputHtml = '<input type="text" id="in-' + index + '" placeholder="...">';
        }
        div.innerHTML = '<label>' + col.label + '</label>' + inputHtml;
        inputsFrag.appendChild(div);
    });
    inputContainer.appendChild(inputsFrag);

    const cachedRows = loadLocalJournalCache('table_rows', new Array());
    if (Array.isArray(cachedRows) && cachedRows.length > 0) {
        const tbody = document.getElementById('table-body');
        tbody.innerHTML = '';
        const rFrag = document.createDocumentFragment();
        cachedRows.forEach(function(r) { appendRowToContainer(rFrag, r, false); });
        tbody.appendChild(rFrag);
    }
    const cachedNotifs = loadLocalJournalCache('notifs', new Array());
    if (Array.isArray(cachedNotifs) && cachedNotifs.length > 0) {
        allNotifications = cachedNotifs;
    }

    const savedUser = localStorage.getItem('journal_user');
    const savedCall = localStorage.getItem('journal_callsign');
    const savedColor = localStorage.getItem('journal_color');
    const savedPerms = loadLocalJournalCache('my_perms', null);
    if (savedPerms) myPermissions = savedPerms;
    if (savedUser) {
        currentUser = savedUser;
        currentCallsign = savedCall || savedUser;
        userColor = savedColor || '#fff';
        applyUserUI();
    }
    fetchMapsFromServer(false);
    connectWS(false);
if (
    window.MsbNative &&
    typeof window.MsbNative.setIdentity === 'function'
) {
    window.MsbNative.setIdentity(
        currentUser || '',
        currentCallsign || '',
        API_ORIGIN
    );
}

    if (typeof initNativeFcmPush === 'function') {
        initNativeFcmPush();
    }
}


function hideAuthMessages() {
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
}

function openRegisterModal() {
    document.getElementById('register-modal').style.display = 'flex';
    document.getElementById('reg-status-msg').style.display = 'none';
}

function closeRegisterModal() {
    document.getElementById('register-modal').style.display = 'none';
}

function submitRegistration() {
    const unit = document.getElementById('reg-unit-select').value;
    const callsign = document.getElementById('reg-callsign').value.trim();
    const password = document.getElementById('reg-pass').value.trim();
    const msgEl = document.getElementById('reg-status-msg');
    if (!unit || !callsign || !password) {
        msgEl.style.color = '#ef4444';
        msgEl.innerText = '❌ Заполните позывной и пароль!';
        msgEl.style.display = 'block';
        return;
    }
    fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: unit, username: callsign, password: password })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        msgEl.style.display = 'block';
        if (data.success) {
            msgEl.style.color = '#4ade80';
            msgEl.innerText = '✅ Заявка отправлена АДМИНУ! Ожидайте одобрения.';
            document.getElementById('reg-callsign').value = '';
            document.getElementById('reg-pass').value = '';
        } else {
            msgEl.style.color = '#ef4444';
            msgEl.innerText = '❌ ' + (data.message || 'Ошибка регистрации');
        }
    });
}

function refreshMyPermissionsFromServer() {
    if (!currentCallsign) return;
    if (currentUser === ADMIN_NAME) {
        myPermissions = { row: true, stream: true, maps: true, archive: true, table: true };
        saveLocalJournalCache('my_perms', myPermissions);
        applyPermissionsUI();
        return;
    }
    fetch('/api/user/me?noav=1&user=' + encodeURIComponent(currentCallsign) + '&t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && data.permissions) {
                myPermissions = data.permissions;
                saveLocalJournalCache('my_perms', myPermissions);
                applyPermissionsUI();
            }
        }).catch(function() {});
}

function attemptLogin() {
    unlockMobileFeatures();
    const userIndex = Number(document.getElementById('login-select').value);
    const callsignInput = document.getElementById('login-callsign').value.trim();
    const pass = document.getElementById('login-pass').value.trim();
    const unitObj = USERS_CONFIG.at(userIndex);
    const errEl = document.getElementById('login-error');
    if (!unitObj || !pass) {
        errEl.innerText = '❌ Введите пароль!';
        errEl.style.display = 'block';
        return;
    }
    if (unitObj.name === ADMIN_NAME && pass === "551150000" && (!callsignInput || callsignInput.toLowerCase() === "муравей")) {
        myPermissions = { row: true, stream: true, maps: true, archive: true, table: true };
        saveLocalJournalCache('my_perms', myPermissions);
        completeLoginSuccess(ADMIN_NAME, "муравей", unitObj.color);
        return;
    }
    if (!callsignInput) {
        errEl.innerText = '❌ Введите ваш Позывной и пароль!';
        errEl.style.display = 'block';
        return;
    }
     const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) loginOverlay.style.pointerEvents = 'auto';

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: unitObj.name, username: callsignInput, password: pass })
    })

    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            myPermissions = data.permissions || { row: false, stream: false, maps: false, archive: false, table: false };
            saveLocalJournalCache('my_perms', myPermissions);
            completeLoginSuccess(unitObj.name, data.username || callsignInput, unitObj.color);
        } else {
            errEl.innerText = '❌ ' + (data.message || 'Неверный пароль или позывной не одобрен');
            errEl.style.display = 'block';
        }
    }).catch(function() {
        errEl.innerText = '❌ Ошибка связи с сервером';
        errEl.style.display = 'block';
    });
}
function completeLoginSuccess(unitName, callsign, color) {
    hideAuthMessages();
    currentUser = unitName;
    currentCallsign = callsign || unitName;
    userColor = color;
    localStorage.setItem('journal_user', currentUser);
    localStorage.setItem('journal_callsign', currentCallsign);
    localStorage.setItem('journal_color', userColor);
    localStorage.setItem('chat_username', currentCallsign);
    applyUserUI();
    refreshMyPermissionsFromServer();
    subscribeToWebPush(false);
    checkAndShowAlerts(false);

    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({
                type: 'ping',
                user: currentUser || '',
                callsign: currentCallsign || ''
            }));
        } catch (e) {}
    }
if (
    window.MsbNative &&
    typeof window.MsbNative.setIdentity === 'function'
) {
    window.MsbNative.setIdentity(
        currentUser || '',
        currentCallsign || '',
        API_ORIGIN
    );
}

    if (typeof sendFcmTokenToServer === 'function') sendFcmTokenToServer();
    if (typeof checkPinOnAppEntry === 'function') checkPinOnAppEntry();
}




function openAdminUsersModal() {
    if (currentUser !== ADMIN_NAME) return;
    document.getElementById('admin-users-modal').style.display = 'flex';
    fetchAdminUsersList();
}

function closeAdminUsersModal() {
    document.getElementById('admin-users-modal').style.display = 'none';
}

function renderPermCheckboxes(u) {
    const p = u.permissions || { row: false, stream: false, maps: false, archive: false, table: false };
    const k = u.key;
    return '<div class="perm-grid">' +
        '<label class="perm-chip"><input type="checkbox" ' + (p.row ? 'checked' : '') + ' onchange="toggleUserPerm(\'' + k + '\', \'row\', this.checked)"> 📤 Запись</label>' +
        '<label class="perm-chip"><input type="checkbox" ' + (p.table ? 'checked' : '') + ' onchange="toggleUserPerm(\'' + k + '\', \'table\', this.checked)"> 📊 Таблица</label>' +
        '<label class="perm-chip"><input type="checkbox" ' + (p.stream ? 'checked' : '') + ' onchange="toggleUserPerm(\'' + k + '\', \'stream\', this.checked)"> 🎥 Стрим</label>' +
        '<label class="perm-chip"><input type="checkbox" ' + (p.maps ? 'checked' : '') + ' onchange="toggleUserPerm(\'' + k + '\', \'maps\', this.checked)"> 🗺️ Карта</label>' +
        '<label class="perm-chip"><input type="checkbox" ' + (p.archive ? 'checked' : '') + ' onchange="toggleUserPerm(\'' + k + '\', \'archive\', this.checked)"> 🗂️ Архив</label></div>';
}

function fetchAdminUsersList() {
    if (currentUser !== ADMIN_NAME) return;
    fetch('/api/admin/users?t=' + Date.now()).then(function(r) { return r.json(); }).then(function(data) {
        const pBox = document.getElementById('admin-pending-list');
        const aBox = document.getElementById('admin-approved-list');
        const badge = document.getElementById('pending-count-badge');
        if (!pBox || !aBox) return;
        pBox.innerHTML = '';
        aBox.innerHTML = '';
        const pending = data.pending || new Array();
        const approved = data.approved || new Array();
        const resets = data.pinResets || new Array();
        const totalActionCount = pending.length + resets.length;
        if (badge) {
            badge.style.display = totalActionCount > 0 ? 'inline-block' : 'none';
            badge.innerText = totalActionCount;
        }
        if (pending.length === 0 && resets.length === 0) {
            pBox.innerHTML = '<div style="color:#64748b;">Нет новых заявок</div>';
        }
        resets.forEach(function(r) {
            const rCard = document.createElement('div');
            rCard.className = 'user-row-card';
            rCard.style.borderColor = '#facc15';
            const ansBlock = r.userAnswer
                ? ('<div>Ответ бойца: <b style="color:#4ade80;">' + r.userAnswer + '</b> (Верный ответ: <code style="color:#facc15;">' + (r.expectedAnswer || '-') + '</code>)</div>')
                : '<div style="color:#94a3b8;">⏳ Ожидаем, пока боец введёт ответ на вопрос...</div>';
            rCard.innerHTML =
                '<div style="flex:1;">' +
                    '<div style="color:#facc15; font-weight:bold;">🔐 ЗАБЫТ ПИН-КОД: ' + r.username + ' (' + r.unit + ')</div>' +
                    '<div>Контрольный вопрос: <i>' + r.question + '</i></div>' +
                    ansBlock +
                '</div>' +
                '<button class="lb-btn" style="background:#22c55e;" onclick="adminUserAction(\'' + r.key + '\', \'approve_pin_reset\')">🔓 Подтвердить и сбросить ПИН</button>';
            pBox.appendChild(rCard);
        });
        pending.forEach(function(u) {
            const row = document.createElement('div');
            row.className = 'user-row-card';
            row.innerHTML = '<div style="flex:1;"><div><b>Позывной:</b> <span style="color:#38bdf8;">' + u.username + '</span> | <b>Подр.:</b> ' + u.unit + ' | <b>Пароль:</b> <code style="color:#facc15;">' + u.password + '</code></div>' + renderPermCheckboxes(u) + '</div>' +
                '<div style="display:flex; gap:6px;"><button class="lb-btn" style="background:#22c55e;" onclick="adminUserAction(\'' + u.key + '\', \'approve\')">✅ Одобрить</button><button class="lb-btn" style="background:#ef4444;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">❌ Отклонить</button></div>';
            pBox.appendChild(row);
        });
        if (approved.length === 0) aBox.innerHTML = '<div style="color:#64748b;">Пока нет пользователей</div>';
        approved.forEach(function(u) {
            const pinBadge = u.pinCode
                ? (' | 🔐 ПИН: <code style="color:#facc15; font-weight:bold;">' + u.pinCode + '</code> (Вопрос: <i>' + (u.pinQuestion || '-') + '</i> / Ответ: <b>' + (u.pinAnswer || '-') + '</b>)')
                : ' | <span style="color:#64748b;">ПИН не задан</span>';
            const row = document.createElement('div');
            row.className = 'user-row-card';
            row.innerHTML = '<div style="flex:1;"><div><b>' + u.username + '</b> (' + u.unit + ') — Пароль: <code style="color:#4ade80; font-weight:bold;">' + u.password + '</code>' + pinBadge + '</div>' + renderPermCheckboxes(u) + '</div><button class="lb-btn" style="background:#ef4444; padding:5px 10px;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">🗑️ Удалить</button>';
            aBox.appendChild(row);
        });
    }).catch(function() {});
}


function toggleUserPerm(userKey, permName, val) {
    fetch('/api/admin/users/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: userKey, action: 'set_perm', permName: permName, permVal: val })
    });
}

function adminUserAction(userKey, action) {
    fetch('/api/admin/users/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: userKey, action: action })
    }).then(function() { fetchAdminUsersList(); });
}

function logoutUser() {
    if (typeof closeWorkNewWindow === 'function') closeWorkNewWindow();
    if (typeof closeMessengerWindow === 'function') closeMessengerWindow();
    const tok = localStorage.getItem('msb_fcm_token');
    if (tok) {
        fetch('/api/fcm/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'ГОСТЬ', callsign: '', token: tok })
        }).catch(function() {});
    }
    localStorage.removeItem('journal_user');
    localStorage.removeItem('journal_callsign');
    localStorage.removeItem('journal_color');
    localStorage.removeItem('chat_username');
    localStorage.removeItem('msb_jcache_my_perms');
    setTimeout(function() { location.reload(); }, 150);
}



function loginAsViewer() {
    unlockMobileFeatures();
    document.getElementById('login-overlay').style.display = 'none';
    renderNotificationsWindow();
    renderMapsGrid();
    updateStreamUI();
    subscribeToWebPush(false);
    checkAndShowAlerts(false);
}
function sendAdminAlert() {
    if (!currentUser) return;
    const target = document.getElementById('admin-target').value;
    const msg = document.getElementById('admin-msg').value.trim();
    if (!target || !msg) return alert("Заполните получателя и текст!");
    const senderLabel = (currentCallsign && currentCallsign !== currentUser) ? (currentUser + ' (' + currentCallsign + ')') : currentUser;
    ws.send(JSON.stringify({ type: 'admin_alert', sender: senderLabel, color: userColor, time: getStaticDateTime(), target: target, text: msg }));
    document.getElementById('admin-msg').value = '';
}

function sendMiniNotification() {
    if (!currentUser) return alert("Войдите в систему!");
    const target = document.getElementById('mini-notif-target').value;
    const input = document.getElementById('mini-notif-input');
    const msg = input.value.trim();
    if (!target || !msg) return;
    const senderLabel = (currentCallsign && currentCallsign !== currentUser) ? (currentUser + ' (' + currentCallsign + ')') : currentUser;
    ws.send(JSON.stringify({ type: 'admin_alert', sender: senderLabel, color: userColor, time: getStaticDateTime(), target: target, text: msg }));
    input.value = '';
}

function clearHistoryAdmin() {
    if (currentUser === ADMIN_NAME && confirm("⚠️ Очистить текущий журнал событий у всех?")) {
        ws.send(JSON.stringify({ type: 'clear_history' }));
    }
}

function createCleanBigAvatarIcon(senderName, themeName, callback) {
    const meta = getMsbThemeMeta(themeName);
    const palettes = {
        military: { bg1: '#102a1a', bg2: '#06120b', text: '#4ade80' },
        rocket:   { bg1: '#2e140d', bg2: '#120704', text: '#fb923c' },
        cosmic:   { bg1: '#1c1242', bg2: '#090618', text: '#c084fc' }
    };
    const pal = palettes[meta.id] || palettes.military;
    const size = 576;

    const cleanKey = String(senderName || '').replace(/^👥\s*/, '').trim().toLowerCase();
    const cachedAv = (typeof getCachedUserAvatar === 'function') ? getCachedUserAvatar(cleanKey, '') : '';

    const renderCanvas = function(imgObj) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (imgObj) {
            const minSide = Math.min(imgObj.width, imgObj.height);
            const sx = (imgObj.width - minSide) / 2;
            const sy = (imgObj.height - minSide) / 2;
            ctx.drawImage(imgObj, sx, sy, minSide, minSide, 0, 0, size, size);
        } else {
            const grad = ctx.createLinearGradient(0, 0, size, size);
            grad.addColorStop(0, pal.bg1);
            grad.addColorStop(1, pal.bg2);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);

            ctx.fillStyle = pal.text;
            ctx.font = '900 180px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const initials = (cleanKey || 'МСБ').substring(0, 2).toUpperCase();
            ctx.fillText(initials, size / 2, size / 2);
        }
        callback(canvas.toDataURL('image/png'));
    };

    if (cachedAv) {
        const img = new Image();
        img.onload = function() { renderCanvas(img); };
        img.onerror = function() { renderCanvas(null); };
        img.src = cachedAv;
    } else {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() { renderCanvas(img); };
        img.onerror = function() { renderCanvas(null); };
        img.src = API_ORIGIN + '/api/avatar-img/' + encodeURIComponent(cleanKey) + '.jpg?v=' + Date.now();
    }
}

const shownSystemNotifIds = new Set();

function sendLocalNotification(target, text, sender, notifId) {
    const dedupKey = notifId ? String(notifId) : (String(sender) + '|' + String(text));
    if (shownSystemNotifIds.has(dedupKey)) return;
    shownSystemNotifIds.add(dedupKey);
    if (shownSystemNotifIds.size > 300) {
        const firstKey = shownSystemNotifIds.values().next().value;
        shownSystemNotifIds.delete(firstKey);
    }

    if (window.MsbNative && typeof window.MsbNative.notify === 'function') {
        if (document.visibilityState === 'visible') return;
    }



    const rawFrom = String(sender || 'АДМИН').trim();
    let unitStr = '';
    let callStr = rawFrom;
    const m = rawFrom.match(/^(.+?)\s*\((.+?)\)$/);
    if (m) {
        unitStr = m.at(1).trim();
        callStr = m.at(2).trim();
    } else if (Array.isArray(myMessengerFriends)) {
        const fr = myMessengerFriends.find(function(f) {
            return f && !f.isGroup && String(f.name || '').toLowerCase() === rawFrom.toLowerCase();
        });
        if (fr && fr.unit) unitStr = fr.unit;
    }
    const title = (unitStr && unitStr.toLowerCase() !== callStr.toLowerCase())
        ? (unitStr + ' • ' + callStr)
        : callStr;
    const body = String(text || '').replace(/^💬\s*Мессенджер:\s*/i, '');
    const meta = getMsbThemeMeta();

    if (window.MsbNative && typeof window.MsbNative.notify === 'function') {
        try {
            window.MsbNative.notify(title, body, String(notifId || dedupKey), '#00000000|' + meta.color);
            return;
        } catch (e) {}
    }

    if ('serviceWorker' in navigator) {
        createCleanBigAvatarIcon(callStr, meta.id, function(bigAvatarDataUrl) {
            navigator.serviceWorker.ready.then(function(reg) {
                reg.showNotification(title, {
                    body: body,
                    icon: bigAvatarDataUrl || '/icon-192.png',
                    badge: '/icon-192.png',
                    vibrate: Array.of(800, 200, 800, 200, 1000),
                    silent: false,
                    requireInteraction: true,
                    renotify: false,
                    tag: 'msb-alert-' + (notifId || dedupKey)
                }).catch(function() {});
            });
        });
    }
}





function isUnreadForMe(a) {
    const myCall = String(currentCallsign || '').trim().toLowerCase();
    const myUnit = String(currentUser || '').trim().toLowerCase();
    const sLow = String(a.sender || '').trim().toLowerCase();
    if (myCall && (sLow === myCall || sLow.indexOf('(' + myCall + ')') !== -1)) return false;
    if (!myCall && myUnit && sLow === myUnit) return false;
    if (Array.isArray(a.readList)) {
        const alreadyRead = a.readList.some(function(r) {
            const rLow = String(r || '').trim().toLowerCase();
            return (myCall && rLow === myCall) || (myUnit && rLow === myUnit);
        });
        if (alreadyRead) return false;
    }
    return true;
}

function checkAndShowAlerts(isNew) {
    if (document.getElementById('alert-modal').style.display === 'flex' && !isNew) return;
    let targetToShow = null;
    let alertObj = null;
    if (currentCallsign) {
        const q = getAlertsQueue(currentCallsign).filter(isUnreadForMe);
        if (q.length > 0) { targetToShow = currentCallsign; alertObj = q.at(0); }
    }
    if (!targetToShow && currentUser) {
        const q = getAlertsQueue(currentUser).filter(isUnreadForMe);
        if (q.length > 0) { targetToShow = currentUser; alertObj = q.at(0); }
    }
    if (!targetToShow) {
        const q = getAlertsQueue("ВСЕМ").filter(isUnreadForMe);
        if (q.length > 0) { targetToShow = "ВСЕМ"; alertObj = q.at(0); }
    }
    if (targetToShow && alertObj) {
        showAlert(targetToShow, alertObj.text, alertObj.sender, alertObj.id, isNew);
    }
}

const dismissedAlertIds = new Set(
    JSON.parse(localStorage.getItem('msb_dismissed_alerts') || '[]')
);

function markAlertDismissedLocally(notifId, text, sender) {
    const key = notifId ? String(notifId) : (String(sender) + '|' + String(text));
    dismissedAlertIds.add(key);
    const arr = Array.from(dismissedAlertIds).slice(-200);
    localStorage.setItem('msb_dismissed_alerts', JSON.stringify(arr));
}

function isAlertDismissedLocally(notifId, text, sender) {
    const key = notifId ? String(notifId) : (String(sender) + '|' + String(text));
    return dismissedAlertIds.has(key);
}
function showAlert(target, text, sender, notifId, isNew) {
    if (isAlertDismissedLocally(notifId, text, sender)) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'clear_alert',
                target: target,
                notifId: notifId,
                readBy: currentCallsign || currentUser || 'Просмотр'
            }));
        }
        return;
    }

    const updModal = document.getElementById('server-update-modal');
    if (updModal && updModal.style.display === 'flex') return;

    const msgModal = document.getElementById('messenger-modal');
    const txtStr = String(text || '');
    const isChatAlert = txtStr.indexOf('👥') === 0 || txtStr.indexOf('💬') === 0 || txtStr.indexOf('🎙️') === 0 || txtStr.indexOf('🎥') === 0 || txtStr.indexOf('📎') === 0 || txtStr.indexOf('🎬') === 0;
    if (msgModal && msgModal.style.display === 'flex' && isChatAlert) {
        if (isNew && !window.MsbNative) {
            playSoundById('nice1', true);
        }
        markAlertDismissedLocally(notifId, text, sender);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'clear_alert',
                target: target,
                notifId: notifId,
                readBy: currentCallsign || currentUser || 'Просмотр',
                readTime: new Date().toLocaleTimeString().slice(0, 5)
            }));
        }
        return;
    }

    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'none';
    stopAlertVisuals();

    if (isNew || document.visibilityState === 'hidden') {
        if (!window.MsbNative) {
            playSoundById(selectedSoundId, true);
        }
        sendLocalNotification(target, text, sender || ADMIN_NAME, notifId);
    }



    markAlertDismissedLocally(notifId, text, sender);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'clear_alert',
            target: target,
            notifId: notifId,
            readBy: currentCallsign || currentUser || 'Просмотр',
            readTime: new Date().toLocaleTimeString().slice(0, 5)
        }));
    }

}


function stopAlertVisuals() {
    document.getElementById('alert-modal').style.display = 'none';
    currentAlertId = null;
    currentAlertTarget = "";
    if (titleInterval) { clearInterval(titleInterval); titleInterval = null; }
    if (soundInterval) { clearInterval(soundInterval); soundInterval = null; }
    if (sirenAudio) { sirenAudio.pause(); sirenAudio.currentTime = 0; }
    if (navigator.vibrate) navigator.vibrate(0);
    document.title = "МСБ55115";
}

function confirmAlert() {
    unlockMobileFeatures();
    markAlertDismissedLocally(currentAlertId, currentAlertText, currentAlertSender);

    const whoConfirmed = currentCallsign || currentUser || 'Просмотр';
    const readTime = new Date().toLocaleTimeString().slice(0, 5);
    const targetToClear = currentAlertTarget;
    const idToClear = currentAlertId;
    const alertTextCopy = String(currentAlertText || '');
    const alertSenderCopy = String(currentAlertSender || '');

    if (targetToClear) {
        const q = getAlertsQueue(targetToClear);
        if (targetToClear === 'ВСЕМ') {
            q.forEach(function(a) {
                if (!idToClear || a.id === idToClear) {
                    if (!Array.isArray(a.readList)) a.readList = [];
                    if (a.readList.indexOf(whoConfirmed) === -1) a.readList.push(whoConfirmed);
                    if (currentUser && a.readList.indexOf(currentUser) === -1) a.readList.push(currentUser);
                }
            });
            pendingAlerts[targetToClear] = q;
        } else {
            pendingAlerts[targetToClear] = idToClear
                ? q.filter(function(a) { return a.id !== idToClear; })
                : q.slice(1);
        }
    }

    stopAlertVisuals();

    if (targetToClear && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'clear_alert',
            target: targetToClear,
            notifId: idToClear,
            readBy: whoConfirmed,
            readTime: readTime
        }));
        if (currentUser && currentUser !== whoConfirmed) {
            ws.send(JSON.stringify({
                type: 'clear_alert',
                target: targetToClear,
                notifId: idToClear,
                readBy: currentUser,
                readTime: readTime
            }));
        }
    }

    const isFromMessenger = alertTextCopy.indexOf('👥') === 0 || alertTextCopy.indexOf('💬') === 0 || alertTextCopy.indexOf('🎙️') === 0 || alertTextCopy.indexOf('🎥') === 0 || alertTextCopy.indexOf('📎') === 0 || alertTextCopy.indexOf('🎬') === 0;
    if (isFromMessenger && typeof openMessengerWindow === 'function') {
        openMessengerWindow(alertSenderCopy);
        return;
    }
    checkAndShowAlerts(false);
}
function submitRow() {
    if (!currentUser) return;
    let values = new Array(), isEmpty = true;
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        let val = document.getElementById('in-' + i).value;
        if (COLUMNS_CONFIG.at(i).digitsOnly && val) val = val.replace(/[^0-9.,\/\\]/g, '');
        values.push(val);
        if (val) isEmpty = false;
    }
    if (isEmpty) return alert("Пустая строка!");
    const now = new Date();
    const authorLabel = (currentCallsign && currentCallsign !== currentUser) ? (currentUser + ' (' + currentCallsign + ')') : currentUser;
    ws.send(JSON.stringify({
        type: 'add_row',
        user: authorLabel,
        color: userColor,
        time: now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5),
        values: values
    }));
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) document.getElementById('in-' + i).value = "";
}

function appendRowToContainer(container, row, doScroll) {
    if (!container || !row) return;
    if (row.values && row.values.at(0)) {
        const firstCol = String(row.values.at(0));
        if (firstCol.indexOf("ОЗНАКОМЛЕН") !== -1 || firstCol.indexOf("УВЕДОМЛЕН") !== -1) return;
    }
    const tr = document.createElement('tr');
    let html = '<td class="time-cell">' + row.time + '</td><td class="user-cell" style="color:' + row.color + '">' + row.user + '</td>';
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        html += '<td>' + ((row.values && row.values.at(i)) ? row.values.at(i) : '-') + '</td>';
    }
    tr.innerHTML = html;
    container.appendChild(tr);
    if (doScroll) {
        requestAnimationFrame(function() { tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    }
}

function appendRow(row) {
    const tbody = document.getElementById('table-body');
    appendRowToContainer(tbody, row, true);
}

function triggerCallInDev(callType, targetName) {
    if (callType === 'Аудиозвонок') {
        if (typeof window.startMsbAudioCall === 'function') {
            window.startMsbAudioCall(targetName);
        }
        return;
    }
    playSoundById('nice2', true);
    const modal = document.getElementById('call-dev-modal');
    const icon = document.getElementById('call-dev-icon');
    const title = document.getElementById('call-dev-title');
    const text = document.getElementById('call-dev-text');
    if (icon) icon.innerText = '🎥';
    if (title) title.innerText = callType + (targetName ? (' [' + targetName + ']') : '') + ' — МСБ-55115';
    if (text) text.innerHTML = 'Модуль <b>«' + callType + '»</b> в разработке системы <b>МСБ-55115</b>!';
    if (modal) modal.style.display = 'flex';
}


function closeCallDevModal() {
    const m = document.getElementById('call-dev-modal');
    if (m) m.style.display = 'none';
}

const GIF_TITLES = {
    military: Array.of(
        "🪖 Спецназ МСБ", "🛡️ Броня крепка", "🚁 Вертушка", "📡 Радар ПВО",
        "🎯 Снайпер", "🟩 ПНВ Разведка", "🚜 Танковый прорыв", "⚡ Штурм",
        "🎖️ Отвага", "📻 Радиосвязь", "🔥 Артиллерия", "🛩️ Су-57 в небе",
        "🧭 Маршрут", "💣 Саперы", "🐕 Дозор", "🚢 Флот",
        "🚁 Десант", "🛡️ Оборона", "🎆 Салют Победы", "🏆 МСБ-55115"
    ),
    rocket: Array.of(
        "🚀 Пуск из шахты", "🔥 Гиперзвук", "⚡ Тополь-М", "💥 Перехват ПВО",
        "🛰️ Баллистика", "🚀 РВСН Дежурство", "🌋 Огненный старт", "🎯 Точно в цель",
        "🚀 Комплекс Ярс", "🧭 Телеметрия", "🔥 Форсаж", "🛡️ Купол С-400",
        "⚡ Удар с неба", "🚀 Залп РСЗО", "🛰️ Орбитальный блок", "🔥 Плазма",
        "🚀 Калибр", "⏱️ Пуск 3..2..1", "💥 Ударная волна", "🚀 Щит МСБ"
    ),
    cosmic: Array.of(
        "🌌 Глубокий космос", "🛰️ Станция МКС", "👨‍🚀 Космонавт", "🌟 Сверхновая",
        "🛸 Варп-прыжок", "🪐 Сатурн", "☄️ Метеориты", "🌌 Андромеда",
        "🛰️ Спутник ВКС", "🌑 Лунная база", "⚡ Солнечный шторм", "🕳️ Черная дыра",
        "🚀 Стыковка", "🌠 Звездный флот", "🪐 Марс", "🛰️ Лазерная орбита",
        "🌌 Галактика", "👨‍🚀 Невесомость", "🌟 Пульсар", "🌌 Космос МСБ"
    )
};
var gifCacheStore = {};

function makeAnimatedSvgGif(cat, idx, title) {
    const cacheKey = cat + '_' + idx;
    if (gifCacheStore[cacheKey]) return gifCacheStore[cacheKey];
    const palettes = {
        military: Array.of('#051f10', '#14532d', '#22c55e', '#facc15'),
        rocket: Array.of('#260804', '#7c2d12', '#f97316', '#fde047'),
        cosmic: Array.of('#090422', '#3b0764', '#38bdf8', '#c084fc')
    };
    const pal = palettes[cat] || palettes.military;
    const parts = String(title || '').split(' ');
    const icon = parts.at(0) || '🚀';
    const label = parts.slice(1).join(' ') || 'МСБ-55115';
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 320, 200);
    grad.addColorStop(0, pal.at(0)); grad.addColorStop(1, pal.at(1));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 320, 200);
    ctx.strokeStyle = pal.at(2); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(160, 78, 52, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = pal.at(3); ctx.lineWidth = 2; ctx.setLineDash(Array.of(8, 6));
    ctx.beginPath(); ctx.arc(160, 78, 36, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash(new Array());
    ctx.font = '46px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, 160, 78);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)'; ctx.fillRect(14, 144, 292, 42);
    ctx.strokeStyle = pal.at(2); ctx.lineWidth = 1.5; ctx.strokeRect(14, 144, 292, 42);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px "Segoe UI", monospace, sans-serif';
    ctx.fillText(label + ' #' + (idx + 1), 160, 166);
    const dataUrl = canvas.toDataURL('image/png');
    gifCacheStore[cacheKey] = dataUrl;
    return dataUrl;
}

function getMsbThemeMeta(themeName) {
    const t = themeName || localStorage.getItem('msb_app_theme') || 'military';
    if (t === 'rocket') return { id: 'rocket', color: '#f97316', bgColor: '#2e140d', badge: '🚀', label: 'РАКЕТНЫЙ' };
    if (t === 'cosmic') return { id: 'cosmic', color: '#a855f7', bgColor: '#1c1242', badge: '🌌', label: 'КОСМОС' };
    return { id: 'military', color: '#22c55e', bgColor: '#102a1a', badge: '🪖', label: 'ВОЕННЫЙ' };
}


function setAppTheme(themeName, skipSync) {
    const clean = (themeName === 'rocket' || themeName === 'cosmic') ? themeName : 'military';
    document.body.classList.remove('theme-military', 'theme-rocket', 'theme-cosmic');
    document.body.classList.add('theme-' + clean);
    localStorage.setItem('msb_app_theme', clean);
    Array.of('military', 'rocket', 'cosmic').forEach(function(t) {
        const b = document.getElementById('theme-btn-' + t);
        if (b) b.classList.toggle('active', t === clean);
    });
    const meta = getMsbThemeMeta(clean);
    if (window.MsbNative && typeof window.MsbNative.setTheme === 'function') {
        try { window.MsbNative.setTheme(meta.id, meta.color); } catch (e) {}
    }
    if (!skipSync && typeof sendFcmTokenToServer === 'function') {
        sendFcmTokenToServer();
    }
}


function toggleChatGifDrawer() {
    const drawer = document.getElementById('chat-gif-drawer');
    if (!drawer) { openThemeSettingsModal(); return; }
    if (drawer.style.display === 'none' || !drawer.style.display) {
        drawer.style.display = 'flex';
        switchGifCategory(currentGifCategory || 'military');
    } else {
        drawer.style.display = 'none';
    }
}

function switchGifCategory(cat) {
    currentGifCategory = (cat === 'rocket' || cat === 'cosmic') ? cat : 'military';
    Array.of('military', 'rocket', 'cosmic').forEach(function(t) {
        const tab = document.getElementById('gif-tab-' + t);
        if (tab) tab.classList.toggle('active', t === currentGifCategory);
    });
    const grid = document.getElementById('chat-gifs-grid') || document.getElementById('viewer-gifs-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const titles = GIF_TITLES[currentGifCategory] || GIF_TITLES.military;
    titles.forEach(function(title, idx) {
        const src = makeAnimatedSvgGif(currentGifCategory, idx, title);
        const card = document.createElement('div'); card.className = 'gif-card-item';
        const imgEl = document.createElement('img'); imgEl.src = src; imgEl.alt = title;
        const capEl = document.createElement('div'); capEl.className = 'gif-card-title'; capEl.innerText = title;
        card.appendChild(imgEl); card.appendChild(capEl);
        card.onclick = function() { sendGifToCurrentChat(src, title); };
        grid.appendChild(card);
    });
}

function sendGifToCurrentChat(gifSrc) {
    if (typeof currentRoomId === 'undefined' || !currentRoomId) {
        alert('Сначала выберите друга или конференцию слева, чтобы отправить гифку!');
        return;
    }
    const sender = (typeof getActiveChatIdentity === 'function') ? getActiveChatIdentity() : currentCallsign;
    if (!sender) return;
    fetch(gifSrc).then(function(r) { return r.blob(); }).then(function(blob) {
        if (typeof enqueueChatPayload === 'function') {
            enqueueChatPayload({ sender: sender, room: currentRoomId, type: 'file', blob: blob, fileName: 'gif_' + Date.now() + '.png' });
        }
        const drawer = document.getElementById('chat-gif-drawer');
        if (drawer) drawer.style.display = 'none';
        closeMsgPhotoViewer();
    });
}
var msgPanX = 0, msgPanY = 0, msgDragging = false, msgStartX = 0, msgStartY = 0, msgPanBound = false;

function updateMsgViewerTransform() {
    const img = document.getElementById('msg-viewer-img');
    const lbl = document.getElementById('msg-zoom-label');
    if (img) img.style.transform = 'translate(' + msgPanX + 'px, ' + msgPanY + 'px) scale(' + msgImageZoom + ')';
    if (lbl) lbl.innerText = Math.round(msgImageZoom * 100) + '%';
}

function bindMsgViewerPan() {
    if (msgPanBound) return;
    msgPanBound = true;
    const wrap = document.querySelector('.msg-viewer-img-wrap');
    if (!wrap) return;
    wrap.style.touchAction = 'none';
    wrap.style.cursor = 'grab';
    wrap.addEventListener('pointerdown', function(e) {
        if (msgImageZoom <= 1) return;
        msgDragging = true;
        msgStartX = e.clientX - msgPanX;
        msgStartY = e.clientY - msgPanY;
        wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', function(e) {
        if (!msgDragging) return;
        msgPanX = e.clientX - msgStartX;
        msgPanY = e.clientY - msgStartY;
        updateMsgViewerTransform();
    });
    wrap.addEventListener('pointerup', function() { msgDragging = false; });
    wrap.addEventListener('pointercancel', function() { msgDragging = false; });
}

function openMsgPhotoViewer(src, title, hideSettings) {
    const modal = document.getElementById('msg-photo-viewer-modal');
    const img = document.getElementById('msg-viewer-img');
    const ttl = document.getElementById('msg-viewer-title');
    const settingsBox = modal ? modal.querySelector('.msg-viewer-settings') : null;
    if (settingsBox) {
        settingsBox.style.display = hideSettings ? 'none' : 'block';
    }
    msgImageZoom = 1; msgPanX = 0; msgPanY = 0;
    if (img) {
        img.src = src || makeAnimatedSvgGif('military', 0, '🪖 МСБ-55115');
        img.style.userSelect = 'none';
        img.ondragstart = function() { return false; };
    }
    if (ttl) ttl.innerText = title || '🖼️ Просмотр и настройки темы';
    updateMsgViewerTransform();
    bindMsgViewerPan();
    setAppTheme(localStorage.getItem('msb_app_theme') || 'military');
    if (modal) modal.style.display = 'flex';
}

function openAvatarInViewer(el, titleName) {
    const imgEl = el ? el.querySelector('img') : null;
    const fallback = makeAnimatedSvgGif(localStorage.getItem('msb_app_theme') || 'military', 0, '🎖️ ' + (titleName || currentCallsign || 'МСБ'));
    openMsgPhotoViewer(imgEl ? imgEl.src : fallback, '👤 Профиль: ' + (titleName || currentCallsign || 'Боец МСБ-55115'), true);
}

function openThemeSettingsModal() {
    const preview = makeAnimatedSvgGif(localStorage.getItem('msb_app_theme') || 'military', 19, '🎨 Тема МСБ-55115');
    openMsgPhotoViewer(preview, '🎨 Выбор темы оформления (Военный / Ракетный / Космос)');
}
window.openThemeAndGifHub = openThemeSettingsModal;

function closeMsgPhotoViewer() {
    const m = document.getElementById('msg-photo-viewer-modal');
    if (m) m.style.display = 'none';
}

function changeMsgImageZoom(delta) {
    msgImageZoom = Math.min(4.5, Math.max(1, msgImageZoom + delta));
    if (msgImageZoom === 1) { msgPanX = 0; msgPanY = 0; }
    updateMsgViewerTransform();
}


var msbInitialSyncDone = false;
var msbIsWeakNetwork = false;
var msbBootWaitTimer = null;
var lastEdgePullAt = 0;

function getMsbWeakPhraseHTML() {
    return '📡 (ищем сеть, закрытый протокол <span class="msb-jumping-word">МСБ55115</span>, обновляемся... ждите)';
}
window.getMsbWeakPhraseHTML = getMsbWeakPhraseHTML;

function ensureWeakBootOverlay() {
    if (document.getElementById('msb-weak-boot-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'msb-weak-boot-overlay';
    ov.innerHTML = '<div class="msb-weak-boot-card"><div class="msb-weak-spinner"></div><div>' + getMsbWeakPhraseHTML() + '</div></div>';
    document.body.appendChild(ov);
}

function evaluateNetworkWeakness() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return false;
    return (Date.now() - lastPongTime > 40000);
}

function updateWeakNetworkUI() {
    var weakNow = evaluateNetworkWeakness();
    msbIsWeakNetwork = weakNow;
    window.msbIsWeakNetwork = weakNow;

    // Если пользователь уже входил ранее — приложение работает мгновенно из кэша без перекрытия экраном
    if (localStorage.getItem('journal_user')) {
        msbInitialSyncDone = true;
    }

    var bootOv = document.getElementById('msb-weak-boot-overlay');
    if (bootOv) {
        bootOv.style.display = (!msbInitialSyncDone && weakNow) ? 'flex' : 'none';
    }
    if (typeof window.syncMessengerWeakBanner === 'function') {
        window.syncMessengerWeakBanner(weakNow);
    }
}



function triggerImmediateEdgePull() {
    var now = Date.now();
    if (now - lastEdgePullAt < 5000) return;
    lastEdgePullAt = now;
    connectWS(false);
    if (typeof flushOutboxQueue === 'function') flushOutboxQueue();
    fetch('/api/ping?t=' + now)
        .then(function(r) { if (r.ok) window.markMsbServerAlive(true); })
        .catch(function() {});
}

window.markMsbServerAlive = function(isFullInit) {
    if (isFullInit && !msbInitialSyncDone) {
        msbInitialSyncDone = true;
        if (msbBootWaitTimer) { clearTimeout(msbBootWaitTimer); msbBootWaitTimer = null; }
    }
    updateWeakNetworkUI();
};

(function initWeakNetworkWatcher() {
    ensureWeakBootOverlay();
    msbBootWaitTimer = setTimeout(function() {
        if (!msbInitialSyncDone) {
            ensureWeakBootOverlay();
            if (evaluateNetworkWeakness()) document.getElementById('msb-weak-boot-overlay').style.display = 'flex';
            triggerImmediateEdgePull();
        }
    }, 2500);
    window.addEventListener('online', function() { triggerImmediateEdgePull(); setTimeout(updateWeakNetworkUI, 400); });
    window.addEventListener('offline', updateWeakNetworkUI);
    setInterval(function() {
        if ((!ws || ws.readyState !== WebSocket.OPEN) && navigator.onLine !== false) triggerImmediateEdgePull();
        updateWeakNetworkUI();
    }, 4500);
})();

var enteredLockPin = '';
var pinStatusPollTimer = null;

function ensurePinModals() {
    if (!document.getElementById('msb-pin-setup-modal')) {

        const m = document.createElement('div');
        m.id = 'msb-pin-setup-modal';
        m.className = 'custom-modal-overlay';
        m.style.zIndex = '240000';
        m.innerHTML = [
            '<div class="login-box msb-themed-card" style="max-width:360px;">',
            '<h3 class="msb-themed-title">🔐 Создать 4-значный ПИН</h3>',

            '<p style="font-size:12px; color:#94a3b8; margin:0 0 10px 0;">',
            'Введите 4 цифры и обязательный контрольный вопрос:',
            '</p>',
            '<input type="password" id="msb-pin-in1" inputmode="numeric" maxlength="4" placeholder="Новый ПИН (4 цифры)">',
            '<input type="password" id="msb-pin-in2" inputmode="numeric" maxlength="4" placeholder="Повторите ПИН (4 цифры)">',
            '<input type="text" id="msb-pin-question" placeholder="Контрольный вопрос">',
            '<input type="text" id="msb-pin-answer" placeholder="Ответ на вопрос">',
            '<div id="msb-pin-setup-msg" style="font-size:13px; margin-bottom:10px; display:none;"></div>',
            '<button type="button" onclick="submitNewUserPin()">✅ СОХРАНИТЬ</button>',
            '<button type="button" class="viewer-btn" onclick="closePinSetupModal()">Отмена</button>',
            '</div>'
        ].join('');
        document.body.appendChild(m);
    }

       if (!document.getElementById('msb-pin-lock-modal')) {
        const lock = document.createElement('div');
        lock.id = 'msb-pin-lock-modal';
        lock.className = 'custom-modal-overlay msb-pin-fullscreen';
        lock.style.zIndex = '260000';

        const digits = ['1','2','3','4','5','6','7','8','9'];
        const numBtns = digits.map(function(n) {
            return '<button type="button" onclick="pressPinDigit(\'' + n + '\')">' + n + '</button>';
        }).join('');

        lock.innerHTML = [
            '<div class="bank-pin-screen">',
            '<div class="bank-pin-badge">🛡️ ЗАЩИТА МСБ-55115</div>',
            '<div id="msb-pin-lock-user" class="bank-pin-user"></div>',
            '<div id="msb-pin-entry-view">',
            '<div class="bank-pin-subtitle">Введите 4-значный код</div>',
            '<div class="bank-pin-dots" id="bank-pin-dots">',
            '<span></span><span></span><span></span><span></span>',
            '</div>',
            '<div id="msb-pin-unlock-err" class="bank-pin-err">❌ Неверный ПИН-код</div>',
            '<div class="bank-keypad">',
            numBtns,
            '<button type="button" class="kp-sub" onclick="logoutUser()">Выход</button>',
            '<button type="button" onclick="pressPinDigit(\'0\')">0</button>',
            '<button type="button" class="kp-sub" onclick="backspacePinDigit()">⌫</button>',
            '</div>',
            '<button type="button" class="bank-forgot-btn" onclick="requestForgotPinSupport()">',
            '🆘 Забыли ПИН-код? Связаться со службой поддержки',
            '</button>',
            '</div>',
            '<div id="msb-pin-recovery-view" style="display:none; width:100%;">',
            '<div class="pin-rec-info">',
            '📩 Оповещение отправлено Админу. Ответьте на ваш вопрос:',
            '</div>',
            '<div id="msb-recovery-question-text" class="pin-rec-q"></div>',
            '<input type="text" id="msb-recovery-answer-input" class="auth-input" placeholder="Ваш ответ...">',
            '<button type="button" class="auth-btn" onclick="submitPinRecoveryAnswer()">',
            '📤 ОТПРАВИТЬ ОТВЕТ',
            '</button>',
            '<div id="msb-recovery-wait-box" class="pin-rec-wait">',
            '⏳ Ожидайте подтверждения разблокировки от Админа...',
            '</div>',
            '<button type="button" class="bank-forgot-btn" style="margin-top:14px;" onclick="backToPinKeypad()">',
            '← Назад к вводу ПИН-кода',
            '</button>',
            '</div>',
            '</div>'
        ].join('');
        document.body.appendChild(lock);
    }
}

function closePinSetupModal() {
    const m = document.getElementById('msb-pin-setup-modal');
    if (m) m.style.display = 'none';
}

function updateBankPinDots() {
    const dotsBox = document.getElementById('bank-pin-dots');
    if (!dotsBox) return;
    dotsBox.querySelectorAll('span').forEach(function(sp, i) {
        sp.classList.toggle('filled', i < enteredLockPin.length);
    });
}

function pressPinDigit(d) {
    if (enteredLockPin.length >= 4) return;
    enteredLockPin += d;
    updateBankPinDots();
    const err = document.getElementById('msb-pin-unlock-err');
    if (err) err.style.visibility = 'hidden';
    if (enteredLockPin.length === 4) {
        setTimeout(verifyUnlockPin, 120);
    }
}

function backspacePinDigit() {
    enteredLockPin = enteredLockPin.slice(0, -1);
    updateBankPinDots();
}

function openPinSetupModal() {
    ensurePinModals();
    document.getElementById('msb-pin-in1').value = '';
    document.getElementById('msb-pin-in2').value = '';
    document.getElementById('msb-pin-question').value = '';
    document.getElementById('msb-pin-answer').value = '';
    document.getElementById('msb-pin-setup-msg').style.display = 'none';
    document.getElementById('msb-pin-setup-modal').style.display = 'flex';
}

function showSetupMsg(text, color) {
    const msg = document.getElementById('msb-pin-setup-msg');
    if (!msg) return;
    msg.style.color = color;
    msg.innerText = text;
    msg.style.display = 'block';
}

function submitNewUserPin() {
    const p1 = document.getElementById('msb-pin-in1').value.trim();
    const p2 = document.getElementById('msb-pin-in2').value.trim();
    const q = document.getElementById('msb-pin-question').value.trim();
    const a = document.getElementById('msb-pin-answer').value.trim();
    const who = currentCallsign || currentUser;

    if (!/^\d{4}$/.test(p1)) {
        return showSetupMsg('❌ Введите ровно 4 цифры!', '#ef4444');
    }
    if (p1 !== p2) {
        return showSetupMsg('❌ ПИН-коды не совпадают!', '#ef4444');
    }
    if (!q || !a) {
        return showSetupMsg('❌ Заполните вопрос и ответ!', '#ef4444');
    }

    fetch('/api/user/pin/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: who, pin: p1, question: q, answer: a })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d && d.ok) {
            const k = who.toLowerCase();
            localStorage.setItem('msb_user_has_pin_' + k, '1');
            sessionStorage.setItem('msb_pin_verified_' + k, '1');
            showSetupMsg('✅ 4-значный ПИН сохранён!', '#4ade80');
            setTimeout(closePinSetupModal, 900);
        }
    });
}

function checkPinOnAppEntry() {
    const who = currentCallsign || currentUser;
    if (!who) return;
    const key = who.toLowerCase();
    if (sessionStorage.getItem('msb_pin_verified_' + key) === '1') {
        openFriendsListDirectly();
        return;
    }

    ensurePinModals();
    enteredLockPin = '';
    updateBankPinDots();

    const userLbl = document.getElementById('msb-pin-lock-user');
    const lockModal = document.getElementById('msb-pin-lock-modal');

    if (localStorage.getItem('msb_user_has_pin_' + key) === '1') {
        userLbl.innerText = 'Позывной: ' + who;
        lockModal.style.display = 'flex';
    }

    const url = '/api/user/pin/status?user=' + encodeURIComponent(who) + '&t=' + Date.now();
    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d && d.hasPin) {
                localStorage.setItem('msb_user_has_pin_' + key, '1');
                if (sessionStorage.getItem('msb_pin_verified_' + key) !== '1') {
                    userLbl.innerText = 'Позывной: ' + who;
                    lockModal.style.display = 'flex';
                    const isWait = (d.resetState === 'waiting_user' || d.resetState === 'waiting_admin');
                    if (isWait) {
                        showPinRecoveryView(d.question, d.resetState === 'waiting_admin');
                    }
                }
                   } else {
                localStorage.removeItem('msb_user_has_pin_' + key);
                lockModal.style.display = 'none';
                openFriendsListDirectly();
            }

        })
        .catch(function() {});
}

function verifyUnlockPin() {
    const who = currentCallsign || currentUser;
    const err = document.getElementById('msb-pin-unlock-err');
    fetch('/api/user/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: who, pin: enteredLockPin })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d && d.ok) {
            const k = who.toLowerCase();
            sessionStorage.setItem('msb_pin_verified_' + k, '1');
            document.getElementById('msb-pin-lock-modal').style.display = 'none';
            enteredLockPin = '';
            updateBankPinDots();
            openFriendsListDirectly();
        } else {
            enteredLockPin = '';
            updateBankPinDots();
            if (err) err.style.visibility = 'visible';
        }
    });
}


function requestForgotPinSupport() {
    const who = currentCallsign || currentUser;
    fetch('/api/user/pin/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: who })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d && d.ok) showPinRecoveryView(d.question, false);
    });
}

function showPinRecoveryView(questionText, alreadyAnswered) {
    document.getElementById('msb-pin-entry-view').style.display = 'none';
    document.getElementById('msb-pin-recovery-view').style.display = 'block';
    const qEl = document.getElementById('msb-recovery-question-text');
    qEl.innerText = '❓ Вопрос: ' + (questionText || '');
    const wBox = document.getElementById('msb-recovery-wait-box');
    wBox.style.display = alreadyAnswered ? 'block' : 'none';

    if (pinStatusPollTimer) clearInterval(pinStatusPollTimer);
    pinStatusPollTimer = setInterval(function() {
        const who = currentCallsign || currentUser;
        if (!who) return;
        const url = '/api/user/pin/status?user=' + encodeURIComponent(who) + '&t=' + Date.now();
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(st) {
                if (st && !st.hasPin) {
                    clearInterval(pinStatusPollTimer);
                    const k = who.toLowerCase();
                    localStorage.removeItem('msb_user_has_pin_' + k);
                    sessionStorage.setItem('msb_pin_verified_' + k, '1');
                    const m = document.getElementById('msb-pin-lock-modal');
                    if (m) m.style.display = 'none';
                }
            })
            .catch(function() {});
    }, 3500);
}

function submitPinRecoveryAnswer() {
    const who = currentCallsign || currentUser;
    const inp = document.getElementById('msb-recovery-answer-input');
    const ans = inp ? inp.value.trim() : '';
    if (!ans) return alert('Введите ответ на вопрос!');
    fetch('/api/user/pin/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: who, answer: ans })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d && d.ok) {
            const w = document.getElementById('msb-recovery-wait-box');
            if (w) w.style.display = 'block';
        }
    });
}

function backToPinKeypad() {
    document.getElementById('msb-pin-recovery-view').style.display = 'none';
    document.getElementById('msb-pin-entry-view').style.display = 'block';
}

(function syncNativeIdentityOnce() {
    var hasNat = window.MsbNative &&
        typeof window.MsbNative.setIdentity === 'function';
    if (!hasNat) return;
    var u = currentUser || localStorage.getItem('journal_user') || '';
    var c = currentCallsign || localStorage.getItem('journal_callsign') || '';
    if (u || c) {
        window.MsbNative.setIdentity(u, c, API_ORIGIN);
    }
})();

initApp();

async function initNativeFcmPush() {
    try {
        const cap = window.Capacitor;
        if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
        const PushNotifications = cap.Plugins && cap.Plugins.PushNotifications;
        if (!PushNotifications) return;

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') return;

        PushNotifications.addListener('registration', function(tokenObj) {
            if (!tokenObj || !tokenObj.value) return;
            localStorage.setItem('msb_fcm_token', tokenObj.value);
            sendFcmTokenToServer(tokenObj.value);
        });

        PushNotifications.addListener('pushNotificationReceived', function() {
            if (typeof connectWS === 'function') connectWS(true);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', function() {
            if (typeof connectWS === 'function') connectWS(true);
        });

        await PushNotifications.register();
    } catch (e) {}
}

function sendFcmTokenToServer(tok) {
    const token = tok || localStorage.getItem('msb_fcm_token');
    if (!token) return;
    const u = currentUser || localStorage.getItem('journal_user') || 'ГОСТЬ';
    const c = currentCallsign || localStorage.getItem('journal_callsign') || '';
    const th = localStorage.getItem('msb_app_theme') || 'military';
    const snd = localStorage.getItem('msb_sound_id') || 'alarm1';
    fetch('/api/fcm/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u, callsign: c, token: token, theme: th, soundId: snd })
    }).catch(function() {});
}

function checkApkRemoteUpdate(forcePrompt) {
    if (!window.MsbNative || typeof window.MsbNative.installApkUpdate !== 'function') return;
    fetch('/api/app/version?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(meta) {
            if (!meta || !meta.hasApk || !meta.versionCode) return;
            const localVer = Number(localStorage.getItem('msb_installed_apk_ver') || 0);
            if (forcePrompt || meta.versionCode > localVer) {
                const msg = '📲 Доступна новая версия МСБ-55115 (' + meta.versionName + ').\n\nНажмите ОК для загрузки и установки поверх.';
                if (confirm(msg)) {
                    localStorage.setItem('msb_installed_apk_ver', String(meta.versionCode));
                    window.MsbNative.installApkUpdate(API_ORIGIN + '/api/app/download.apk?t=' + Date.now());
                }
            }
        }).catch(function() {});
}
async function downloadMsbApkDirect() {
    window.onNativeApkProgress = function(statusText, isDone) {
        var dlBtn = document.getElementById('msb-profile-dl-apk-btn');
        if (!dlBtn) return;
        dlBtn.textContent = statusText;
        dlBtn.disabled = !isDone;
        if (isDone) {
            setTimeout(function() {
                dlBtn.disabled = false;
                dlBtn.textContent = '📥 Скачать и установить APK';
            }, 4000);
        }
    };

    var dlBtn = document.getElementById('msb-profile-dl-apk-btn');
    var origText = '📥 Скачать и установить APK';
    try {
        if (dlBtn) {
            dlBtn.disabled = true;
            dlBtn.textContent = '🔍 Проверка файла на сервере...';
        }
        var metaRes = await fetch('/api/app/version?t=' + Date.now());
        var meta = await metaRes.json();
        if (!meta || !meta.hasApk) {
            if (dlBtn) {
                dlBtn.disabled = false;
                dlBtn.textContent = origText;
            }
            alert('⚠️ На сервере пока нет загруженного APK-файла.');
            return;
        }

        var apkUrl = API_ORIGIN + '/api/app/download.apk?t=' + Date.now();
        if (window.MsbNative && typeof window.MsbNative.installApkUpdate === 'function') {
            if (meta.versionCode) {
                localStorage.setItem('msb_installed_apk_ver', String(meta.versionCode));
            }
            window.MsbNative.installApkUpdate(apkUrl);
            return;
        }
        window.location.href = apkUrl;
    } catch (err) {
        if (dlBtn) {
            dlBtn.disabled = false;
            dlBtn.textContent = origText;
        }
        window.location.href = API_ORIGIN + '/api/app/download.apk?t=' + Date.now();
    }
}

window.downloadMsbApkDirect = downloadMsbApkDirect;
window.manualCheckApkUpdate = downloadMsbApkDirect;

var msbCall = {
    pc: null,
    stream: null,
    partner: '',
    state: 'idle',
    muted: false,
    speaker: true,
    timer: null,
    ringTimer: null,
    waitTimer: null,
    startTs: 0,
    offer: null,
    callId: '',
    iceQueue: []
};

var DOT = String.fromCharCode(46);
var MSB_RTC_CFG = {
    iceCandidatePoolSize: 2,
    iceServers: [
        { urls: 'stun:' + ['74', '125', '250', '129'].join(DOT) + ':19302' },
        { urls: 'stun:' + ['162', '159', '207', '0'].join(DOT) + ':3478' }
    ]
};



function getMsbCallerName() {
    var name = '';
    if (typeof getActiveChatIdentity === 'function') name = getActiveChatIdentity();
    else name = currentCallsign || currentUser || localStorage.getItem('journal_callsign') || '';
    name = String(name || '').trim();
    if (name.toLowerCase() === 'админ') return 'муравей';
    return name;
}


function sendMsbCallWS(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch (e) {}
    } else {
        connectWS(true);
        setTimeout(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify(obj)); } catch (e) {}
            }
        }, 600);
    }
}

function ensureMsbCallModal() {
    var m = document.getElementById('msb-audio-call-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'msb-audio-call-modal';
    m.className = 'custom-modal-overlay';
    m.style.zIndex = '285000';

    var box = document.createElement('div');
    box.className = 'login-box msb-themed-card msb-call-card';

    var badge = document.createElement('div');
    badge.className = 'msb-call-badge';
    badge.textContent = '📞 ЗАЩИЩЕННЫЙ АУДИОКАНАЛ';

    var av = document.createElement('div');
    av.id = 'msb-call-avatar';
    av.className = 'avatar msb-themed-avatar msb-call-av';
    av.textContent = 'МС';

    var nm = document.createElement('div');
    nm.id = 'msb-call-name';
    nm.className = 'msb-themed-subname';
    nm.style.marginBottom = '4px';

    var st = document.createElement('div');
    st.id = 'msb-call-status';
    st.className = 'msb-call-status-txt';

    var incRow = document.createElement('div');
    incRow.id = 'msb-call-incoming-btns';
    incRow.className = 'msb-call-btn-row';
    incRow.style.display = 'none';

    var btnAcc = document.createElement('button');
    btnAcc.type = 'button';
    btnAcc.className = 'msb-call-btn accept';
    btnAcc.textContent = '📞 Принять';
    btnAcc.onclick = function() { window.acceptMsbAudioCall(); };

    var btnDec = document.createElement('button');
    btnDec.type = 'button';
    btnDec.className = 'msb-call-btn hangup';
    btnDec.textContent = '✖ Сброс';
    btnDec.onclick = function() { window.endMsbAudioCall(true, 'declined'); };

    incRow.appendChild(btnAcc);
    incRow.appendChild(btnDec);

    var actRow = document.createElement('div');
    actRow.id = 'msb-call-active-btns';
    actRow.className = 'msb-call-btn-row';

    var btnMute = document.createElement('button');
    btnMute.type = 'button';
    btnMute.id = 'msb-btn-mute-call';
    btnMute.className = 'msb-call-btn ctrl';
    btnMute.textContent = '🎙️ Микрофон';
    btnMute.onclick = function() { window.toggleMsbCallMute(); };

    var btnSpk = document.createElement('button');
    btnSpk.type = 'button';
    btnSpk.id = 'msb-btn-spk-call';
    btnSpk.className = 'msb-call-btn ctrl active-spk';
    btnSpk.textContent = '🔊 Громкая';
    btnSpk.onclick = function() { window.toggleMsbCallSpeaker(); };

    var btnEnd = document.createElement('button');
    btnEnd.type = 'button';
    btnEnd.className = 'msb-call-btn hangup';
    btnEnd.textContent = '☎️ Завершить';
    btnEnd.onclick = function() { window.endMsbAudioCall(true, 'hangup'); };

    actRow.appendChild(btnMute);
    actRow.appendChild(btnSpk);
    actRow.appendChild(btnEnd);

    var aud = document.createElement('audio');
    aud.id = 'msb-remote-call-audio';
    aud.autoplay = true;
    aud.setAttribute('playsinline', 'true');
    aud.style.cssText = 'width:1px;height:1px;opacity:0.01;position:absolute;pointer-events:none;';

    box.appendChild(badge);
    box.appendChild(av);
    box.appendChild(nm);
    box.appendChild(st);
    box.appendChild(incRow);
    box.appendChild(actRow);
    box.appendChild(aud);
    m.appendChild(box);
    document.body.appendChild(m);
    return m;
}

function startMsbRing(isIncoming) {
    stopMsbRing();
    var beep = function() {
        if (msbCall.state !== 'calling' && msbCall.state !== 'incoming') {
            stopMsbRing();
            return;
        }
        if (isIncoming) playSoundById('nice1', true);
        else playToneNotes([{ f: 425, t: 0, d: 0.8, v: 0.2, type: 'sine' }]);

        // Проверяем по HTTP, не сброшен ли уже звонок при плохом интернете
        var checkTarget = isIncoming ? getMsbCallerName() : msbCall.partner;
        if (checkTarget) {
            fetch('/api/call/status?target=' + encodeURIComponent(checkTarget) + '&callId=' + encodeURIComponent(msbCall.callId || '') + '&t=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(st) {
                    if (st && st.ok && st.ringing === false && (msbCall.state === 'calling' || msbCall.state === 'incoming')) {
                        window.endMsbAudioCall(false, 'ended');
                    }
                })
                .catch(function() {});
        }
    };
    beep();
    msbCall.ringTimer = setInterval(beep, 2600);
}


function stopMsbRing() {
    if (msbCall.ringTimer) {
        clearInterval(msbCall.ringTimer);
        msbCall.ringTimer = null;
    }
    if (window.MsbNative && typeof window.MsbNative.stopNativeRingtone === 'function') {
        try { window.MsbNative.stopNativeRingtone(); } catch (e) {}
    }
}

function showMsbCallModal(peerName, statusTxt, incomingWait) {
    var modal = ensureMsbCallModal();
    document.getElementById('msb-call-name').textContent = peerName || 'Боец';
    document.getElementById('msb-call-status').textContent = statusTxt || '';
    var avEl = document.getElementById('msb-call-avatar');
    if (avEl && typeof renderAvatarElement === 'function') {
        var avUrl = (typeof getCachedUserAvatar === 'function') ? getCachedUserAvatar(peerName, '') : '';
        renderAvatarElement(avEl, peerName, avUrl);
    }
    document.getElementById('msb-call-incoming-btns').style.display = incomingWait ? 'flex' : 'none';
    document.getElementById('msb-call-active-btns').style.display = incomingWait ? 'none' : 'flex';
    modal.style.display = 'flex';
}

function openMsbCallContactPicker() {
    var list = (typeof friendsList !== 'undefined' && Array.isArray(friendsList))
        ? friendsList.filter(function(f) { return f && !f.isGroup; })
        : [];
    if (list.length === 0) {
        var typed = prompt('Введите позывной бойца для аудиозвонка:', '');
        if (typed && typed.trim()) window.startMsbAudioCall(typed.trim());
        return;
    }
    var picker = document.getElementById('msb-call-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'msb-call-picker-modal';
        picker.className = 'modal-overlay';
        picker.style.zIndex = '280000';
        var pBox = document.createElement('div');
        pBox.className = 'modal-box msb-themed-card';
        var hdr = document.createElement('h3');
        hdr.className = 'msb-themed-title';
        hdr.innerHTML = '<span>📞 Кому позвонить?</span>';
        var clsBtn = document.createElement('button');
        clsBtn.className = 'modal-close';
        clsBtn.innerHTML = '&times;';
        clsBtn.onclick = function() { picker.style.display = 'none'; };
        hdr.appendChild(clsBtn);
        var pList = document.createElement('div');
        pList.id = 'msb-call-picker-list';
        pList.className = 'modal-list';
        pBox.appendChild(hdr);
        pBox.appendChild(pList);
        picker.appendChild(pBox);
        document.body.appendChild(picker);
    }
    var container = document.getElementById('msb-call-picker-list');
    container.innerHTML = '';
    list.forEach(function(c) {
        var item = document.createElement('div');
        item.className = 'modal-item';
        var stSpan = document.createElement('span');
        stSpan.textContent = (c.online ? '🟢 ' : '⚫ ') + c.name;
        var icoSpan = document.createElement('span');
        icoSpan.textContent = '📞';
        item.appendChild(stSpan);
        item.appendChild(icoSpan);
        item.onclick = function() {
            picker.style.display = 'none';
            window.startMsbAudioCall(c.name);
        };
        container.appendChild(item);
    });
    picker.style.display = 'flex';
}

function createMsbPeer(partnerName) {
    var me = getMsbCallerName();
    var pc;
    try {
        pc = new RTCPeerConnection(MSB_RTC_CFG);
    } catch (cfgErr) {
        pc = new RTCPeerConnection({ iceServers: [] });
    }
    msbCall.pc = pc;

    pc.onicecandidate = function(ev) {
        if (ev.candidate) {
            sendMsbCallWS({ type: 'call_ice', from: me, to: partnerName, candidate: ev.candidate });
        }
    };

    pc.ontrack = function(ev) {
        ensureMsbCallModal();
        var a = document.getElementById('msb-remote-call-audio');
        if (!a) return;
        var firstStream = (ev.streams && ev.streams.length > 0) ? ev.streams.at(0) : null;
        var remStream = firstStream || new MediaStream([ev.track]);
        a.srcObject = remStream;
        a.muted = false;
        a.volume = 1.0;
        var tryPlay = function() {
            a.play().catch(function() {
                setTimeout(function() { a.play().catch(function() {}); }, 350);
            });
        };
        tryPlay();
        if (ev.track) {
            ev.track.onunmute = tryPlay;
        }
    };

    pc.oniceconnectionstatechange = function() {
        if (!msbCall.pc) return;
        var ice = msbCall.pc.iceConnectionState;
        if (ice === 'connected' || ice === 'completed') {
            if (msbCall.discTimer) { clearTimeout(msbCall.discTimer); msbCall.discTimer = null; }
            onMsbCallConnected();
        } else if (ice === 'disconnected') {
            if (msbCall.discTimer) clearTimeout(msbCall.discTimer);
            msbCall.discTimer = setTimeout(function() {
                if (msbCall.pc && (msbCall.pc.iceConnectionState === 'disconnected' || msbCall.pc.iceConnectionState === 'failed')) {
                    window.endMsbAudioCall(true, 'network_fail');
                }
            }, 6000);
        } else if (ice === 'failed') {
            window.endMsbAudioCall(true, 'network_fail');
        }
    };


    pc.onconnectionstatechange = function() {
        if (!msbCall.pc) return;
        var st = msbCall.pc.connectionState;
        if (st === 'connected') {
            onMsbCallConnected();
        } else if ((st === 'failed' || st === 'closed') && msbCall.state !== 'idle') {
            window.endMsbAudioCall(true, 'network_fail');
        }
    };
    return pc;
}

function onMsbCallConnected() {

    if (msbCall.state === 'connected') return;
    msbCall.state = 'connected';
    stopMsbRing();
    if (msbCall.waitTimer) { clearTimeout(msbCall.waitTimer); msbCall.waitTimer = null; }
    if (window.MsbNative && typeof window.MsbNative.setSpeakerphone === 'function') {
        try { window.MsbNative.setSpeakerphone(msbCall.speaker); } catch (e) {}
        setTimeout(function() {
            if (msbCall.state === 'connected' && window.MsbNative) {
                try { window.MsbNative.setSpeakerphone(msbCall.speaker); } catch (e) {}
            }
        }, 450);
    }
    var a = document.getElementById('msb-remote-call-audio');

    if (a && a.paused && a.srcObject) a.play().catch(function() {});
    msbCall.startTs = Date.now();
    document.getElementById('msb-call-status').textContent = '🟢 На связи • 00:00';
    if (msbCall.timer) clearInterval(msbCall.timer);

    msbCall.timer = setInterval(function() {
        var sec = Math.floor((Date.now() - msbCall.startTs) / 1000);
        var mm = String(Math.floor(sec / 60)).padStart(2, '0');
        var ss = String(sec % 60).padStart(2, '0');
        var el = document.getElementById('msb-call-status');
        if (el) el.textContent = '🟢 На связи • ' + mm + ':' + ss;
    }, 1000);
}
async function getMsbMicStream() {
    if (window.MsbNative && typeof window.MsbNative.ensureMicPermission === 'function') {
        var granted = false;
        try { granted = Boolean(window.MsbNative.ensureMicPermission()); } catch (e) {}
        if (!granted) {
            for (var i = 0; i < 25; i++) {
                await new Promise(function(r) { setTimeout(r, 400); });
                try { if (window.MsbNative.ensureMicPermission()) { granted = true; break; } } catch (e2) {}
            }
        }
    }
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
        });
    } catch (e1) {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
}


window.startMsbAudioCall = async function(targetName) {
    var me = getMsbCallerName();
    if (!me) return alert('Сначала войдите под своим позывным!');
    if (msbCall.state !== 'idle') return;

    var partner = String(targetName || '').trim();
    if (!partner && typeof isCurrentGroup !== 'undefined' && !isCurrentGroup && typeof currentPartner !== 'undefined' && currentPartner) {
        partner = currentPartner;
    }
    if (!partner || (typeof isCurrentGroup !== 'undefined' && isCurrentGroup && !targetName)) {
        openMsbCallContactPicker();
        return;
    }
    partner = partner.replace(/^👥\s*/, '').trim();
    if (partner.toLowerCase() === me.toLowerCase()) return alert('Нельзя позвонить самому себе!');

    unlockMobileFeatures();
    if (typeof stopActiveMsbAudio === 'function') stopActiveMsbAudio();
    msbCall.partner = partner;
    msbCall.state = 'calling';
    msbCall.muted = false;
    msbCall.speaker = true;
    msbCall.callId = 'call_' + Date.now();
    msbCall.iceQueue = [];
    syncMsbCallControls();
    showMsbCallModal(partner, '📡 Вызов абонента...', false);
    startMsbRing(false);

    var micStream = null;
    try {
        micStream = await getMsbMicStream();
    } catch (micErr) {
        alert('❌ Нет доступа к микрофону в настройках Android!');
        window.endMsbAudioCall(false);
        return;
    }

    try {
        msbCall.stream = micStream;
        var pc = createMsbPeer(partner);
        msbCall.stream.getTracks().forEach(function(t) { pc.addTrack(t, msbCall.stream); });
        var offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        sendMsbCallWS({ type: 'call_offer', callId: msbCall.callId, from: me, to: partner, sdp: pc.localDescription });

        msbCall.waitTimer = setTimeout(function() {
            if (msbCall.state === 'calling') window.endMsbAudioCall(true, 'timeout');
        }, 45000);
    } catch (rtcErr) {
        alert('❌ Ошибка установки аудиоканала: ' + (rtcErr && rtcErr.message ? rtcErr.message : 'сбой'));
        window.endMsbAudioCall(true, 'error');
    }
};

window.acceptMsbAudioCall = async function() {
    if (msbCall.state !== 'incoming' || !msbCall.offer) return;
    var remoteOffer = msbCall.offer;
    msbCall.offer = null;
    msbCall.state = 'connecting';

    var me = getMsbCallerName();
    unlockMobileFeatures();
    if (typeof stopActiveMsbAudio === 'function') stopActiveMsbAudio();
    stopMsbRing();
    showMsbCallModal(msbCall.partner, '🔄 Соединение...', false);

    var audEl = document.getElementById('msb-remote-call-audio');
    if (audEl) { audEl.muted = false; audEl.play().catch(function() {}); }

    var micStream = null;
    try {
        micStream = await getMsbMicStream();
    } catch (micErr) {
        alert('❌ Не удалось включить микрофон!');
        window.endMsbAudioCall(true, 'error');
        return;
    }

    try {
        if (msbCall.state === 'idle') {
            micStream.getTracks().forEach(function(t) { t.stop(); });
            return;
        }
        msbCall.stream = micStream;
        var pc = createMsbPeer(msbCall.partner);
        msbCall.stream.getTracks().forEach(function(t) { pc.addTrack(t, msbCall.stream); });

        await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));


        while (msbCall.iceQueue.length > 0) {
            var c = msbCall.iceQueue.shift();
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
        }

        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendMsbCallWS({ type: 'call_answer', from: me, to: msbCall.partner, sdp: pc.localDescription });
    } catch (rtcErr) {
        alert('❌ Сбой при ответе на звонок.');
        window.endMsbAudioCall(true, 'error');
    }
};

function syncMsbCallControls() {
    ensureMsbCallModal();
    var mBtn = document.getElementById('msb-btn-mute-call');
    var sBtn = document.getElementById('msb-btn-spk-call');
    if (mBtn) {
        mBtn.textContent = msbCall.muted ? '🔇 Выкл.' : '🎙️ Микрофон';
        mBtn.classList.toggle('muted', msbCall.muted);
    }
    if (sBtn) {
        sBtn.textContent = msbCall.speaker ? '🔊 Громкая' : '🔈 Телефон';
        sBtn.classList.toggle('active-spk', msbCall.speaker);
    }
}

window.toggleMsbCallMute = function() {
    msbCall.muted = !msbCall.muted;
    if (msbCall.stream) {
        msbCall.stream.getAudioTracks().forEach(function(t) { t.enabled = !msbCall.muted; });
    }
    syncMsbCallControls();
};

window.toggleMsbCallSpeaker = function() {
    msbCall.speaker = !msbCall.speaker;
    if (window.MsbNative && typeof window.MsbNative.setSpeakerphone === 'function') {
        try { window.MsbNative.setSpeakerphone(msbCall.speaker); } catch (e) {}
    }
    syncMsbCallControls();
};

window.endMsbAudioCall = function(notifyRemote, reason) {
    var me = getMsbCallerName();
    var prevPartner = msbCall.partner;
    stopMsbRing();
    if (msbCall.timer) { clearInterval(msbCall.timer); msbCall.timer = null; }
    if (msbCall.waitTimer) { clearTimeout(msbCall.waitTimer); msbCall.waitTimer = null; }
  if (notifyRemote && prevPartner && me) {
      var endObj = { type: 'call_end', from: me, to: prevPartner, reason: reason || 'hangup' };
      sendMsbCallWS(endObj);
      fetch('/api/call/end', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(endObj)
      }).catch(function() {});
  }

    if (msbCall.stream) {
        msbCall.stream.getTracks().forEach(function(t) { try { t.stop(); } catch (e) {} });
        msbCall.stream = null;
    }
    if (msbCall.pc) {
        try {
            msbCall.pc.oniceconnectionstatechange = null;
            msbCall.pc.onconnectionstatechange = null;
            msbCall.pc.close();
        } catch (e) {}
        msbCall.pc = null;
    }
    var a = document.getElementById('msb-remote-call-audio');
    if (a) { try { a.pause(); a.srcObject = null; } catch (e) {} }
    if (window.MsbNative && typeof window.MsbNative.resetAudioMode === 'function') {
        try { window.MsbNative.resetAudioMode(); } catch (e) {}
    }
    msbCall.state = 'idle';
    msbCall.partner = '';
    msbCall.offer = null;
    msbCall.callId = '';
    msbCall.iceQueue = [];
    var modal = document.getElementById('msb-audio-call-modal');
    if (modal) modal.style.display = 'none';
    if (msbCall.callOnlyMode) {
        msbCall.callOnlyMode = false;
        if (window.MsbNative && typeof window.MsbNative.minimizeApp === 'function') {
            try { window.MsbNative.minimizeApp(); } catch (e) {}
        }
    }
};


window.handleMsbAudioCallWS = async function(msg) {
    if (!msg || !msg.from) return;
    var me = getMsbCallerName();
    if (!me) return;

    if (msg.type === 'call_offer') {
        if ((msbCall.state === 'incoming' || msbCall.state === 'connecting') && (!msbCall.callId || msg.callId === msbCall.callId || msbCall.partner.toLowerCase() === String(msg.from || '').toLowerCase())) {
            if (!msbCall.offer && msbCall.state === 'incoming') msbCall.offer = msg.sdp;
            return;
        }
        if (msbCall.state !== 'idle') {

            sendMsbCallWS({ type: 'call_end', from: me, to: msg.from, reason: 'busy' });
            return;
        }
        msbCall.partner = msg.from;
        msbCall.state = 'incoming';
        msbCall.offer = msg.sdp;
        msbCall.callId = msg.callId || '';
        msbCall.iceQueue = [];
        msbCall.muted = false;
        msbCall.speaker = true;
        syncMsbCallControls();
        showMsbCallModal(msg.from, '📲 Входящий аудиозвонок...', true);
        var isHiddenApk = Boolean(window.MsbNative) && document.visibilityState !== 'visible';
        if (!isHiddenApk) {
            startMsbRing(true);
            // Гасим дублирующий системный звонок FCM, если мы уже видим экран вызова в открытом APK
            if (window.MsbNative && typeof window.MsbNative.stopNativeRingtone === 'function') {
                setTimeout(function() { if (msbCall.state === 'incoming') try { window.MsbNative.stopNativeRingtone(); } catch (e) {} }, 500);
                setTimeout(function() { if (msbCall.state === 'incoming') try { window.MsbNative.stopNativeRingtone(); } catch (e) {} }, 1400);
            }
        }
        return;

    }

    if (msg.type === 'call_answer' && msbCall.state === 'calling') {
        stopMsbRing();
        var stWait = document.getElementById('msb-call-status');
        if (stWait) stWait.textContent = '🔄 Установка канала...';
        if (msbCall.pc && msg.sdp) {
            try {
                await msbCall.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                while (msbCall.iceQueue.length > 0) {
                    var ic = msbCall.iceQueue.shift();
                    try { await msbCall.pc.addIceCandidate(new RTCIceCandidate(ic)); } catch (e) {}
                }
            } catch (e) {}
        }
        return;
    }

    if (msg.type === 'call_ice' && msg.candidate) {
        if (msbCall.pc && msbCall.pc.remoteDescription && msbCall.pc.remoteDescription.type) {
            try { await msbCall.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {}
        } else {
            msbCall.iceQueue.push(msg.candidate);
        }
        return;
    }

  if (msg.type === 'call_end') {
      var fromLow = String(msg.from || '').trim().toLowerCase();
      var partLow = String(msbCall.partner || '').trim().toLowerCase();
      if (msbCall.state !== 'idle' && (!partLow || !fromLow || partLow === fromLow)) {
            var stEl = document.getElementById('msb-call-status');
            if (stEl) {
                stEl.textContent = (msg.reason === 'busy') ? '⛔ Абонент занят' :
                                   (msg.reason === 'declined') ? '❌ Вызов отклонён' : '☎️ Звонок завершён';
            }
             stopMsbRing();
            setTimeout(function() { window.endMsbAudioCall(false); }, 900);
        }
    }
};

window.onNativeCallIntent = function(callerName, action) {
    if (!callerName) return;
    var me = getMsbCallerName();

    if (action === 'decline') {
        window.endMsbAudioCall(true, 'declined');
        return;
    }

    // Если нажали "Ответить" из шторки — включаем режим "Только экран звонка"
    if (action === 'accept') {
        msbCall.callOnlyMode = true;
        var splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';
        var msgModal = document.getElementById('messenger-modal');
        if (msgModal) msgModal.style.display = 'none';
    } else if (typeof openMessengerWindow === 'function') {
        openMessengerWindow(callerName);
    }

    connectWS(true);

    if (msbCall.state === 'idle') {
        msbCall.partner = callerName;
        msbCall.state = 'incoming';
        var modal = ensureMsbCallModal();
        modal.style.background = '#020617';
        showMsbCallModal(callerName, action === 'accept' ? '🔄 Соединение...' : '📲 Входящий аудиозвонок...', action !== 'accept');
    }

    var pullAndConnect = function() {
        if (msbCall.offer) {
            if (action === 'accept' && msbCall.state === 'incoming') {
                window.acceptMsbAudioCall();
            }
            return;
        }
        if (!me) return;
        fetch('/api/call/pending?user=' + encodeURIComponent(me) + '&t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d && d.ok && d.offerMsg && d.offerMsg.sdp) {
                    msbCall.partner = d.offerMsg.from || callerName;
                    msbCall.offer = d.offerMsg.sdp;
                    msbCall.callId = d.offerMsg.callId || '';
                    if (Array.isArray(d.iceList)) {
                        d.iceList.forEach(function(icMsg) {
                            if (icMsg && icMsg.candidate) msbCall.iceQueue.push(icMsg.candidate);
                        });
                    }
                    if (action === 'accept') {
                        window.acceptMsbAudioCall();
                    }
                }
            })
            .catch(function() {});
    };

    pullAndConnect();
    var fastPoll = setInterval(function() {
        if (msbCall.state === 'connected' || msbCall.state === 'idle') {
            clearInterval(fastPoll);
            return;
        }
        if (msbCall.offer && action === 'accept') {
            clearInterval(fastPoll);
            window.acceptMsbAudioCall();
            return;
        }
        pullAndConnect();
    }, 300);
    setTimeout(function() { clearInterval(fastPoll); }, 10000);
};
