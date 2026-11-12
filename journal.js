const USERS_CONFIG = [
    { name: "ШР", pass: "551151111", color: "#3b82f6" },
    { name: "РОТА-1", pass: "551152222", color: "#a855f7" },
    { name: "РОТА-2", pass: "551153333", color: "#22c55e" },
    { name: "РОТА-3", pass: "551154444", color: "#eab308" },
    { name: "АДМИН", pass: "5555", color: "#ef4444" }
];
const ADMIN_NAME = "АДМИН";

const COLUMNS_CONFIG = [
    { label: "ГРУППА", options: ["1", "2", "3", "4", "5"] },
    { label: "ИСХОДНИКИ", options: [
        "НАЧАЛИ ДВИЖЕНИЕ", "ЖДУТ", "ИДУТ", "ПЕРЕСЕКАЮТ ОТКРЫТКУ",
        "ПРОШЛИ ИСХОДНЫЙ ПУНКТ", "ЗАНЯТИЕ Р-НА ФОР-Я ГРУПП",
        "ЗАНЯТИЕ ПЕРЕФОР-Я Р-НА ГРУПП", "ВЫХОД НА РУБЕЖ АТАКИ",
        "ВЫХОД НА РУБЕЖ ШТУРМА", "ЗАНИМАЮТСЯ МЕДИЦИНОЙ",
        "ЗАНИМАЮТСЯ СВЯЗЬЮ", "ОБОРОНА", "РАБОТАЮТ В ОБОРОНЕ",
        "ШТУРМУЮТ", "РВБС"
    ]},
    { label: "ЦВЕТ ТОЧКИ", options: [
        "ФИОЛЕТОВЫЙ", "БИРЮЗОВАЯ", "БИРЮЗОВАЯ-А", "СЕРАЯ", "ЗЕЛЕНАЯ",
        "СИНИЯ", "ЖЕЛТАЯ", "ОРАНЖЕВАЯ", "КРАСНАЯ", "РОЗОВАЯ",
        "РОЗОВАЯ-А", "БЕЖЕВАЯ", "КОРИЧНЕВАЯ", "ЧЕРНАЯ", "БОРДОВАЯ"
    ]},
    { label: "НОМЕР ТОЧКИ", options: new Array(), digitsOnly: true },
    { label: "ЛЕСОПОЛОСА", options: [
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
    ]},
    { label: "ПРИМЕЧАНИЯ", options: new Array() }
];

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
let publicVapidKey = null;
let deferredPrompt = null;
let knownServerBootId = sessionStorage.getItem('msb_server_boot_id') || null;
let pendingServerBootId = null;

function getStaticDateTime() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return dd + '.' + mm + '.' + yyyy + ' ' + hh + ':' + min;
}
const SPLASH_FILES = [
    "boot/kernel_msb55115.sys", "crypto/cipher_channel_v4.dat", "net/websocket_sync_protocol.dll",
    "maps/tactical_forest_sectors.db", "auth/unit_credentials_guard.bin", "push/vapid_service_worker.js",
    "stream/salutejazz_rtc_bridge.mod", "journal/history_storage_engine.json", "audio/siren_emergency_synth.wav",
    "system/msb55115_ready_state.ok"
];

function runSplash() {
    const s = document.getElementById('splash-screen');
    const b = document.getElementById('splash-bar');
    const p = document.getElementById('splash-percent');
    const f = document.getElementById('splash-file');
    const g = document.getElementById('splash-tag');
    if (!s) return;
    let cur = 0;
    const timer = setInterval(function() {
        cur++;
        if (b) b.style.width = cur + '%';
        if (p) p.innerText = 'ЗАГРУЗКА СИСТЕМЫ: ' + cur + '%';
        const idx = Math.min(Math.floor((cur / 100) * SPLASH_FILES.length), SPLASH_FILES.length - 1);
        if (f) f.innerText = SPLASH_FILES.at(idx);
        if (g) g.innerText = (cur < 100) ? '[' + cur + '%]' : '[ГОТОВО]';
        if (cur >= 100) {
            clearInterval(timer);
            s.style.opacity = '0';
            setTimeout(function() { s.style.display = 'none'; }, 500);
        }
    }, 20);
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
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

async function subscribeToWebPush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    try {
        if (Notification.permission === 'denied') return;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        const reg = await navigator.serviceWorker.register('/sw.js');
        await reg.update();
        const readyReg = await navigator.serviceWorker.ready;
        if ('PushManager' in window && publicVapidKey) {
            let sub = await readyReg.pushManager.getSubscription();
            if (!sub) {
                sub = await readyReg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'save_sub',
                    user: currentUser || 'ГОСТЬ',
                    callsign: currentCallsign || '',
                    sub: sub
                }));
            }
        }
    } catch (e) {}
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
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function unlockMobileFeatures() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!sirenAudio) {
            sirenAudio = new Audio(createWavUrl(880, 1, 0.9));
            sirenAudio.loop = true;
        }
    } catch(e) {}
    if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(function() {});
    }
}

const SOUND_PRESETS = [
    { id: 'alarm1', name: '🚨 Тревога 1 (Сирена МСБ — стандарт)', type: 'alarm' },
    { id: 'alarm2', name: '🚨 Тревога 2 (Двойной радарный импульс)', type: 'alarm' },
    { id: 'nice1',  name: '🎵 Красивый 1 (Хрустальный аккорд)', type: 'nice' },
    { id: 'nice2',  name: '🎵 Красивый 2 (Космическое эхо)', type: 'nice' },
    { id: 'nice3',  name: '🎵 Красивый 3 (Тёплая маримба)', type: 'nice' },
    { id: 'bank1',  name: '🏦 Банк 1 (Сбер / Перевод зачислен)', type: 'bank' },
    { id: 'bank2',  name: '🏦 Банк 2 (Премиум Банк / Push)', type: 'bank' }
];

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
            playToneNotes([
                { f: 880, fEnd: 1140, t: 0, d: 0.25, v: 0.4, type: 'sawtooth' },
                { f: 1140, fEnd: 880, t: 0.25, d: 0.25, v: 0.4, type: 'sawtooth' }
            ]);
        } else if (id === 'alarm2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 960, t: 0, d: 0.14, v: 0.45, type: 'square' },
                { f: 960, t: 0.18, d: 0.14, v: 0.45, type: 'square' },
                { f: 1280, t: 0.38, d: 0.28, v: 0.45, type: 'square' }
            ]);
        } else if (id === 'nice1') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 523.25, t: 0, d: 0.45, v: 0.3, type: 'sine' },
                { f: 659.25, t: 0.10, d: 0.45, v: 0.3, type: 'sine' },
                { f: 783.99, t: 0.20, d: 0.55, v: 0.3, type: 'sine' },
                { f: 1046.50, t: 0.30, d: 0.70, v: 0.35, type: 'sine' }
            ]);
        } else if (id === 'nice2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 440, t: 0, d: 0.35, v: 0.3, type: 'triangle' },
                { f: 554.37, t: 0.18, d: 0.35, v: 0.3, type: 'triangle' },
                { f: 659.25, t: 0.36, d: 0.65, v: 0.35, type: 'triangle' }
            ]);
        } else if (id === 'nice3') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 587.33, t: 0, d: 0.22, v: 0.35, type: 'sine' },
                { f: 880, t: 0.14, d: 0.22, v: 0.35, type: 'sine' },
                { f: 739.99, t: 0.28, d: 0.22, v: 0.35, type: 'sine' },
                { f: 1174.66, t: 0.42, d: 0.55, v: 0.4, type: 'sine' }
            ]);
        } else if (id === 'bank1') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 783.99, t: 0, d: 0.16, v: 0.4, type: 'sine' },
                { f: 1567.98, t: 0.12, v: 0.15, type: 'triangle' },
                { f: 1174.66, t: 0.14, d: 0.48, v: 0.45, type: 'sine' },
                { f: 2349.32, t: 0.14, d: 0.35, v: 0.18, type: 'triangle' }
            ]);
        } else if (id === 'bank2') {
            if (sirenAudio) sirenAudio.pause();
            playToneNotes([
                { f: 1046.50, t: 0, d: 0.11, v: 0.38, type: 'sine' },
                { f: 1318.51, t: 0.09, d: 0.11, v: 0.38, type: 'sine' },
                { f: 1567.98, t: 0.18, d: 0.45, v: 0.45, type: 'sine' }
            ]);
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
        type: 'stream_start',
        url: url,
        sender: currentUser,
        color: userColor,
        time: timeString
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
        if (mainBtn) {
            mainBtn.classList.add('live');
            mainBtn.innerText = '🔴 ИДЕТ ВИДЕОСТРИМ МСБ-55115';
        }
        if (currentUser && currentUser !== ADMIN_NAME && userBox) userBox.style.display = 'block';
        if (!currentUser && viewerPanel) viewerPanel.style.display = 'block';
    } else {
        if (mainBtn) {
            mainBtn.classList.remove('live');
            mainBtn.innerText = '🎥 ВИДЕОСТРИМ МСБ-55115';
        }
        if (userBox) userBox.style.display = 'none';
        if (viewerPanel) viewerPanel.style.display = 'none';
    }
}
function toggleMapsSection() {
    const box = document.getElementById('maps-section-box');
    if (!box) return;
    box.style.display = (box.style.display === 'block') ? 'none' : 'block';
    renderMapsGrid();
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
            '<img src="' + m.image + '" alt="Карта">' +
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
function fetchMapsFromServer() {
    fetch('/maps-list?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(list) {
            if (Array.isArray(list)) {
                allMaps = list;
                renderMapsGrid();
            }
        })
        .catch(function() {});
}

function uploadMapPhoto() {
    if (currentUser !== ADMIN_NAME) {
        return alert('Загружать карты может только АДМИН!');
    }
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
            const maxW = 750;
            const maxH = 750;
            let w = img.width || 600;
            let h = img.height || 600;
            if (w > maxW || h > maxH) {
                if (w > h) {
                    h = Math.round(h * (maxW / w));
                    w = maxW;
                } else {
                    w = Math.round(w * (maxH / h));
                    h = maxH;
                }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const finalDataUrl = canvas.toDataURL('image/jpeg', 0.65);
            const now = new Date();
            const timeStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5);
            fetch('/upload-map', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: currentUser,
                    color: userColor,
                    target: target,
                    time: timeStr,
                    image: finalDataUrl
                })
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                fileInput.value = '';
                if (data && Array.isArray(data.maps)) {
                    allMaps = data.maps;
                    renderMapsGrid();
                } else {
                    fetchMapsFromServer();
                }
            })
            .catch(function() {
                alert('Ошибка при отправке фото на сервер!');
            });
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
function fetchArchiveFromServer(cb) {
    fetch('/archive-data?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && typeof data === 'object') {
                archiveData = data;
                renderArchiveCalendar();
                if (selectedArchiveDate) {
                    selectArchiveDate(selectedArchiveDate);
                }
                if (cb) cb();
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
    if (!selectedArchiveDate) {
        selectedArchiveDate = todayKey;
    }
    page.style.display = 'flex';
    renderArchiveCalendar();
    selectArchiveDate(selectedArchiveDate);
    fetchArchiveFromServer();
}

function closeArchivePage() {
    const page = document.getElementById('archive-page');
    if (page) page.style.display = 'none';
}

function changeArchiveMonth(delta) {
    calMonth += delta;
    if (calMonth < 0) {
        calMonth = 11;
        calYear--;
    }
    if (calMonth > 11) {
        calMonth = 0;
        calYear++;
    }
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
        cell.onclick = function() {
            selectArchiveDate(dateKey);
        };
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
    rows.forEach(function(row) {
        const tr = document.createElement('tr');
        let html = '<td class="time-cell">' + (row.time || '-') + '</td><td class="user-cell" style="color:' + (row.color || '#fff') + '">' + (row.user || '-') + '</td>';
        for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
            const val = (row.values && row.values.at(i) !== undefined) ? row.values.at(i) : '-';
            html += '<td>' + (val || '-') + '</td>';
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function isNotificationVisibleForMe(notif) {
    if (!notif) return false;
    if (notif.target === "ВСЕМ") return true;
    if (currentUser === ADMIN_NAME) return true;
    const tLow = String(notif.target || '').trim().toLowerCase();
    const sLow = String(notif.sender || '').trim().toLowerCase();
    const myCallLow = String(currentCallsign || '').trim().toLowerCase();
    const myUserLow = String(currentUser || '').trim().toLowerCase();
    if (myCallLow && (tLow === myCallLow || sLow === myCallLow || sLow.includes('(' + myCallLow + ')'))) {
        return true;
    }
    if (!myCallLow && myUserLow && (tLow === myUserLow || sLow === myUserLow)) {
        return true;
    }
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
            list.appendChild(item);
        });
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
    if (!bootId) return;
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
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) { await r.update(); }
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let k of keys) { await caches.delete(k); }
        }
    } catch (e) {}
    window.location.href = window.location.pathname + '?v=' + Date.now();
}
let lastPongTime = Date.now();

function connectWS(forceReconnect) {
    if (forceReconnect && ws) {
        try {
            ws.onclose = null;
            ws.close();
        } catch (e) {}
        ws = null;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    
    var wsProto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    ws = new WebSocket(wsProto + '//' + location.host + '/');

    ws.onopen = function() {
        lastPongTime = Date.now();
        subscribeToWebPush();
        if (currentUser) {
            ws.send(JSON.stringify({
                type: 'ping',
                user: currentUser || '',
                callsign: currentCallsign || ''
            }));
        }
    };

    ws.onmessage = function(event) {
        lastPongTime = Date.now();
        const msg = JSON.parse(event.data);
        if (msg.serverBootId) {
            checkServerVersionChange(msg.serverBootId, msg.serverBootTime);
        }
        if (msg.type === 'pong') return;

        // ПЕРЕХВАТ ГОЛОСОВЫХ ВЫЗОВОВ WebRTC
        if (msg.type && msg.type.startsWith('call_')) {
            if (typeof handleCallSignal === 'function') {
                handleCallSignal(msg);
            }
            return;
        }

        if (msg.type === 'init') {
            document.getElementById('table-body').innerHTML = '';
            msg.data.forEach(appendRow);
            allNotifications = msg.notifications || new Array();
            renderNotificationsWindow();
            fetchMapsFromServer();
            fetchArchiveFromServer();
            if (msg.streamState) {
                activeStream = msg.streamState;
                updateStreamUI();
            }
            if (msg.vapidPublicKey) {
                publicVapidKey = msg.vapidPublicKey;
                subscribeToWebPush();
            }
            if (msg.alerts) {
                pendingAlerts = msg.alerts;
                checkAndShowAlerts(true);
            }
            if (currentUser === ADMIN_NAME) fetchAdminUsersList();
            refreshMyPermissionsFromServer();
        }
        if (msg.type === 'new_row') {
            appendRow(msg.row);
            fetchArchiveFromServer();
        }
        if (msg.type === 'daily_archived') {
            document.getElementById('table-body').innerHTML = '';
            fetchArchiveFromServer();
        }
        if (msg.type === 'new_map') {
            fetchMapsFromServer();
            if (!msg.target || msg.target === 'ВСЕМ' || currentUser === ADMIN_NAME || msg.target === currentUser || msg.target === currentCallsign) {
                const box = document.getElementById('maps-section-box');
                if (box && (currentUser === ADMIN_NAME || myPermissions.maps)) box.style.display = 'block';
            }
        }
        if (msg.type === 'stream_state') {
            activeStream = msg.streamState || { active: false, url: '' };
            updateStreamUI();
        }
        if (msg.type === 'users_updated') {
            if (currentUser === ADMIN_NAME) fetchAdminUsersList();
            refreshMyPermissionsFromServer();
            if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests();
        }
        if (msg.type === 'history_cleared') {
            document.getElementById('table-body').innerHTML = '';
            allNotifications = new Array();
            allMaps = new Array();
            pendingAlerts = {};
            stopAlertVisuals();
            renderNotificationsWindow();
            renderMapsGrid();
        }
        if (msg.type === 'admin_alert') {
            if (msg.notif) {
                const exists = allNotifications.some(function(n) { return n.id === msg.notif.id; });
                if (!exists) allNotifications.push(msg.notif);
                renderNotificationsWindow();
            }
            const queue = getAlertsQueue(msg.target);
            const alertId = msg.notif ? msg.notif.id : Date.now();
            if (!queue.some(function(a) { return a.id === alertId; })) {
                queue.push({
                    id: alertId,
                    text: msg.text,
                    sender: msg.sender || ADMIN_NAME,
                    readList: new Array()
                });
            }
            pendingAlerts[msg.target] = queue;
            checkAndShowAlerts(true);
        }
        if (msg.type === 'alert_cleared') {
            handleAlertClearedMsg(msg);
        }
    };

    ws.onclose = function() {
        setTimeout(function() { connectWS(false); }, 1500);
    };
}

setInterval(function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (Date.now() - lastPongTime > 16000) {
            connectWS(true);
            return;
        }
        ws.send(JSON.stringify({
            type: 'ping',
            user: currentUser || '',
            callsign: currentCallsign || ''
        }));
    } else {
        connectWS(false);
    }
}, 4000);

window.addEventListener('online', function() {
    connectWS(true);
});

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        if (!ws || ws.readyState !== WebSocket.OPEN || (Date.now() - lastPongTime > 8000)) {
            connectWS(true);
        } else {
            checkAndShowAlerts(false);
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
        subscribeToWebPush();
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
        inputContainer.appendChild(div);
    });

    const savedUser = localStorage.getItem('journal_user');
    const savedCall = localStorage.getItem('journal_callsign');
    const savedColor = localStorage.getItem('journal_color');
    if (savedUser) {
        currentUser = savedUser;
        currentCallsign = savedCall || savedUser;
        userColor = savedColor || '#fff';
        applyUserUI();
    }
    connectWS(false);
}

function hideAuthMessages() {
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
}
function confirmAlert() {
    unlockMobileFeatures();
    const whoConfirmed = currentCallsign || currentUser || 'Просмотр';
    const readTime = new Date().toLocaleTimeString().slice(0, 5);
    const targetToClear = currentAlertTarget;
    const idToClear = currentAlertId;
    const alertTextCopy = String(currentAlertText || '');
    const alertSenderCopy = String(currentAlertSender || '');

    stopAlertVisuals();

    if (targetToClear && pendingAlerts[targetToClear]) {
        if (Array.isArray(pendingAlerts[targetToClear])) {
            pendingAlerts[targetToClear] = pendingAlerts[targetToClear].filter(function(a) {
                return a.id !== idToClear;
            });
            if (pendingAlerts[targetToClear].length === 0) {
                delete pendingAlerts[targetToClear];
            }
        } else {
            delete pendingAlerts[targetToClear];
        }
    }

    if (targetToClear && ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({
                type: 'clear_alert',
                target: targetToClear,
                notifId: idToClear,
                readBy: whoConfirmed,
                readTime: readTime
            }));
        } catch(e) {}
    }

    const isCallNotif = alertTextCopy.indexOf('📞') !== -1 || alertTextCopy.indexOf('ЗВОНОК') !== -1;
    const isFromMessenger = isCallNotif ||
        alertTextCopy.indexOf('👥') === 0 ||
        alertTextCopy.indexOf('💬') === 0 ||
        alertTextCopy.indexOf('🎙️') === 0 ||
        alertTextCopy.indexOf('🎥') === 0 ||
        alertTextCopy.indexOf('📎') === 0 ||
        alertTextCopy.indexOf('🎬') === 0;

    if (isFromMessenger && typeof openMessengerWindow === 'function') {
        openMessengerWindow(alertSenderCopy);
        return;
    }

    checkAndShowAlerts(false);
}

function stopAlertVisuals() {
    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'none';
    if (titleInterval) {
        clearInterval(titleInterval);
        titleInterval = null;
    }
    if (soundInterval) {
        clearInterval(soundInterval);
        soundInterval = null;
    }
    document.title = 'МСБ-55115 Журнал';
    if (sirenAudio) {
        sirenAudio.pause();
        sirenAudio.currentTime = 0;
    }
    currentAlertId = null;
    currentAlertText = '';
    currentAlertTarget = '';
    currentAlertSender = '';
}

function checkAndShowAlerts(forceSound) {
    const myName = currentCallsign || currentUser || 'Просмотр';
    const queueAll = getAlertsQueue('ВСЕМ');
    const unreadAll = queueAll.find(function(a) {
        return !a.readList || a.readList.indexOf(myName) === -1;
    });

    if (unreadAll) {
        showAlert('ВСЕМ', unreadAll.text, unreadAll.sender, unreadAll.id, forceSound);
        return;
    }

    let targetToInspect = currentCallsign || currentUser;
    if (currentUser === ADMIN_NAME) targetToInspect = 'муравей';
    if (targetToInspect) {
        const queueUnit = getAlertsQueue(targetToInspect);
        if (queueUnit.length > 0) {
            const first = queueUnit.at(0);
            showAlert(targetToInspect, first.text, first.sender, first.id, forceSound);
            return;
        }
    }
    stopAlertVisuals();
}

function showAlert(target, text, sender, notifId, playAudioNow) {
    currentAlertTarget = target;
    currentAlertId = notifId;
    currentAlertText = text;
    currentAlertSender = sender || ADMIN_NAME;

    const modal = document.getElementById('alert-modal');
    const label = document.getElementById('alert-target-label');
    const textEl = document.getElementById('alert-text');
    if (!modal || !label || !textEl) return;

    label.innerText = '🛑 ВНИМАНИЕ! СООБЩЕНИЕ ДЛЯ (' + target + ') ОТ ' + (sender || ADMIN_NAME) + '!';
    textEl.innerText = text;
    modal.style.display = 'flex';

    if (playAudioNow) {
        playBeep();
    }
}
function sendAdminAlert() {
    if (currentUser !== ADMIN_NAME) return;
    const target = document.getElementById('admin-target').value;
    const text = document.getElementById('admin-alert-text').value.trim();
    if (!text) return alert('Введите текст сообщения!');
    const now = new Date();
    const timeString = now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5);
    ws.send(JSON.stringify({
        type: 'admin_alert',
        sender: currentUser,
        color: userColor,
        target: target,
        text: text,
        time: timeString
    }));
    document.getElementById('admin-alert-text').value = '';
}

function sendMiniAlert() {
    const target = document.getElementById('mini-notif-target').value;
    const text = document.getElementById('mini-notif-text').value.trim();
    if (!text) return alert('Введите текст быстрого ответа!');
    const now = new Date();
    const timeString = now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5);
    const mySender = currentCallsign ? (currentUser + ' (' + currentCallsign + ')') : currentUser;
    ws.send(JSON.stringify({
        type: 'admin_alert',
        sender: mySender,
        color: userColor,
        target: target,
        text: text,
        time: timeString
    }));
    document.getElementById('mini-notif-text').value = '';
}

function clearAllHistory() {
    if (currentUser !== ADMIN_NAME) return;
    if (confirm('ВНИМАНИЕ! Вы точно хотите очистить всю текущую таблицу, карты и оповещения? Архив по датам останется сохранен!')) {
        ws.send(JSON.stringify({ type: 'clear_history' }));
    }
}

function appendRow(row) {
    const tbody = document.getElementById('table-body');
    const tr = document.createElement('tr');
    tr.style.animation = 'fadeIn 0.3s';
    let html = '<td class="time-cell">' + row.time + '</td><td class="user-cell" style="color:' + (row.color || '#fff') + '">' + row.user + '</td>';
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        let val = (row.values && row.values.at(i) !== undefined) ? row.values.at(i) : '-';
        html += '<td>' + (val || '-') + '</td>';
    }
    tr.innerHTML = html;
    tbody.appendChild(tr);
    tbody.scrollTop = tbody.scrollHeight;
}

function submitRow() {
    if (currentUser !== ADMIN_NAME && (!myPermissions || !myPermissions.row)) {
        return alert('У вас нет разрешения командира на запись в журнал!');
    }
    let values = new Array();
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        const input = document.getElementById('in-' + i);
        values.push(input ? input.value : '');
    }
    const hasData = values.some(function(v) { return v && v.trim() !== ''; });
    if (!hasData) return alert('Заполните хотя бы одно поле перед отправкой!');
    const sender = currentCallsign ? (currentUser + ' (' + currentCallsign + ')') : currentUser;
    ws.send(JSON.stringify({
        type: 'add_row',
        user: sender,
        color: userColor,
        values: values
    }));
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        const input = document.getElementById('in-' + i);
        if (input) {
            if (input.tagName === 'SELECT') input.selectedIndex = 0;
            else input.value = '';
        }
    }
}

function setAppTheme(themeName, skipSave) {
    document.body.classList.remove('theme-military', 'theme-rocket', 'theme-cosmic');
    document.body.classList.add('theme-' + themeName);
    if (!skipSave) {
        localStorage.setItem('msb_app_theme', themeName);
    }
}
function openAdminUsersModal() {
    if (currentUser !== ADMIN_NAME) return;
    const modal = document.getElementById('admin-users-modal');
    if (modal) {
        modal.style.display = 'flex';
        fetchAdminUsersList();
    }
}

function closeAdminUsersModal() {
    const modal = document.getElementById('admin-users-modal');
    if (modal) modal.style.display = 'none';
}

function fetchAdminUsersList() {
    if (currentUser !== ADMIN_NAME) return;
    fetch('/api/admin/users?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            renderAdminUsersLists(data.pending || new Array(), data.approved || new Array());
        })
        .catch(function() {});
}

function renderAdminUsersLists(pending, approved) {
    const pBox = document.getElementById('admin-pending-list');
    const aBox = document.getElementById('admin-approved-list');
    if (pBox) {
        pBox.innerHTML = '';
        if (pending.length === 0) {
            pBox.innerHTML = '<div style="color:#64748b; font-size:13px; padding:6px 0;">Нет новых заявок</div>';
        } else {
            pending.forEach(function(u) {
                const row = document.createElement('div');
                row.className = 'user-row-card';
                row.innerHTML =
                    '<div><b>' + u.username + '</b> <span style="color:#38bdf8;">(' + u.unit + ')</span></div>' +
                    '<div style="display:flex; gap:6px;">' +
                        '<button type="button" style="background:#22c55e; padding:6px 12px; font-size:12px;" onclick="adminUserAction(\'' + u.key + '\', \'approve\')">Одобрить</button>' +
                        '<button type="button" style="background:#ef4444; padding:6px 12px; font-size:12px;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">Удалить</button>' +
                    '</div>';
                pBox.appendChild(row);
            });
        }
    }
    if (aBox) {
        aBox.innerHTML = '';
        if (approved.length === 0) {
            aBox.innerHTML = '<div style="color:#64748b; font-size:13px; padding:6px 0;">Нет зарегистрированных пользователей</div>';
        } else {
            approved.forEach(function(u) {
                const row = document.createElement('div');
                row.className = 'user-row-card';
                const p = u.permissions || {};
                const makeChip = function(name, label) {
                    const checked = p[name] ? 'checked' : '';
                    return '<label class="perm-chip"><input type="checkbox" ' + checked + ' onchange="adminSetUserPerm(\'' + u.key + '\', \'' + name + '\', this.checked)"> ' + label + '</label>';
                };
                row.innerHTML =
                    '<div style="min-width:180px;"><b>' + u.username + '</b> <span style="color:#38bdf8;">(' + u.unit + ')</span></div>' +
                    '<div class="perm-grid">' +
                        makeChip('row', 'Запись') +
                        makeChip('stream', 'Стрим') +
                        makeChip('maps', 'Карты') +
                        makeChip('archive', 'Архив') +
                        makeChip('table', 'Таблица') +
                    '</div>' +
                    '<div><button type="button" style="background:#ef4444; padding:5px 10px; font-size:12px;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">&times;</button></div>';
                aBox.appendChild(row);
            });
        }
    }
}

function adminUserAction(key, action) {
    fetch('/api/admin/users/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, action: action })
    }).then(function() {
        fetchAdminUsersList();
    });
}

function adminSetUserPerm(key, permName, permVal) {
    fetch('/api/admin/users/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, action: 'set_perm', permName: permName, permVal: permVal })
    }).then(function() {
        fetchAdminUsersList();
    });
}

function refreshMyPermissionsFromServer() {
    if (!currentCallsign) return;
    fetch('/api/user/me?user=' + encodeURIComponent(currentCallsign) + '&t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && data.permissions) {
                myPermissions = data.permissions;
                applyPermissionsUI();
            }
        })
        .catch(function() {});
}

window.addEventListener('DOMContentLoaded', initApp);
// === ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК АВТОРИЗАЦИИ И ЭКРАНОВ ===
function switchAuthTab(tab) {
    const loginBox = document.getElementById('login-form-box') || document.getElementById('auth-login-box');
    const regBox = document.getElementById('reg-form-box') || document.getElementById('auth-reg-box');
    const tabLogin = document.getElementById('tab-btn-login');
    const tabReg = document.getElementById('tab-btn-reg');
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';

    if (tab === 'login') {
        if (loginBox) loginBox.style.display = 'block';
        if (regBox) regBox.style.display = 'none';
        if (tabLogin) tabLogin.classList.add('active');
        if (tabReg) tabReg.classList.remove('active');
    } else {
        if (loginBox) loginBox.style.display = 'none';
        if (regBox) regBox.style.display = 'block';
        if (tabLogin) tabLogin.classList.remove('active');
        if (tabReg) tabReg.classList.add('active');
    }
}

function handleAuthSubmit(event) {
    if (event) event.preventDefault();
    const loginBox = document.getElementById('login-form-box') || document.getElementById('auth-login-box');
    if (loginBox && loginBox.style.display !== 'none') {
        authLogin();
    } else {
        submitRegister();
    }
}

// === ПОЛНЫЙ ЭКСПОРТ ОБРАБОТЧИКОВ ИНТЕРФЕЙСА В WINDOW ===
window.login = login;
window.authLogin = authLogin;
window.logout = logout;
window.switchAuthTab = switchAuthTab;
window.handleAuthSubmit = handleAuthSubmit;
window.openRegisterModal = openRegisterModal;
window.closeRegisterModal = closeRegisterModal;
window.submitRegister = submitRegister;
window.submitRow = submitRow;
window.confirmAlert = confirmAlert;
window.stopAlertVisuals = stopAlertVisuals;
window.sendAdminAlert = sendAdminAlert;
window.sendMiniAlert = sendMiniAlert;
window.clearAllHistory = clearAllHistory;
window.toggleMapsSection = toggleMapsSection;
window.uploadMapPhoto = uploadMapPhoto;
window.openArchivePage = openArchivePage;
window.closeArchivePage = closeArchivePage;
window.changeArchiveMonth = changeArchiveMonth;
window.selectArchiveDate = selectArchiveDate;
window.handleStreamBtnClick = handleStreamBtnClick;
window.startVideoStream = startVideoStream;
window.stopVideoStream = stopVideoStream;
window.openActiveStreamWindow = openActiveStreamWindow;
window.openStreamExternalFallback = openStreamExternalFallback;
window.closeStreamPage = closeStreamPage;
window.openSoundModal = openSoundModal;
window.closeSoundModal = closeSoundModal;
window.playSoundById = playSoundById;
window.openAdminUsersModal = openAdminUsersModal;
window.closeAdminUsersModal = closeAdminUsersModal;
window.adminUserAction = adminUserAction;
window.adminSetUserPerm = adminSetUserPerm;
window.forceReloadApp = forceReloadApp;
window.setAppTheme = setAppTheme;
window.installPWA = installPWA;
window.openPhotoLightbox = openPhotoLightbox;
window.closePhotoLightbox = closePhotoLightbox;
window.changePhotoZoom = changePhotoZoom;
window.resetPhotoZoom = resetPhotoZoom;
