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
let publicVapidKey = null;
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
    for (let i = 0; i < rawData.length; ++i) outputArray.fill(rawData.charCodeAt(i), i, i + 1);
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
    } catch(e) {}
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
    if (allMaps.length === 0) {
        const cachedMaps = loadLocalJournalCache('maps', new Array());
        if (Array.isArray(cachedMaps) && cachedMaps.length > 0) {
            allMaps = cachedMaps;
            renderMapsGrid();
        }
    }
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
                    saveLocalJournalCache('maps', data.maps);
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
    if (Object.keys(archiveData).length === 0) {
        const cachedArch = loadLocalJournalCache('archive', {});
        if (cachedArch && typeof cachedArch === 'object' && Object.keys(cachedArch).length > 0) {
            archiveData = cachedArch;
            renderArchiveCalendar();
            if (selectedArchiveDate) selectArchiveDate(selectedArchiveDate);
        }
    }
    fetch('/archive-data?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && typeof data === 'object') {
                archiveData = data;
                saveLocalJournalCache('archive', data);
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
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let k of keys) {
                if (k !== 'msb55115-media-v1') {
                    await caches.delete(k);
                }
            }
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) {
                await r.unregister();
            }
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
    ws = new WebSocket(location.origin.replace(/^http/, 'ws'));

    ws.onopen = function() {
        lastPongTime = Date.now();
        subscribeToWebPush();
    };

    ws.onmessage = function(event) {
        lastPongTime = Date.now();
        const msg = JSON.parse(event.data);
		       if (typeof window.markMsbServerAlive === 'function') {
            window.markMsbServerAlive(msg.type === 'init');
        }
        if (msg.type === 'chat_typing' && typeof window.handleIncomingTypingWS === 'function') {
            window.handleIncomingTypingWS(msg);
            return;
        }
        if (msg.serverBootId) {
            checkServerVersionChange(msg.serverBootId, msg.serverBootTime);
        }
        if (msg.type === 'pong') return;
        if (msg.type === 'init') {
            document.getElementById('table-body').innerHTML = '';
            msg.data.forEach(appendRow);
            saveLocalJournalCache('table_rows', msg.data);
            allNotifications = msg.notifications || new Array();
            saveLocalJournalCache('notifs', allNotifications);
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
            const curRows = loadLocalJournalCache('table_rows', new Array());
            curRows.push(msg.row);
            saveLocalJournalCache('table_rows', curRows);
            fetchArchiveFromServer();
        }
        if (msg.type === 'daily_archived') {
            document.getElementById('table-body').innerHTML = '';
            saveLocalJournalCache('table_rows', new Array());
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
            saveLocalJournalCache('table_rows', new Array());
            saveLocalJournalCache('notifs', new Array());
            saveLocalJournalCache('maps', new Array());
            stopAlertVisuals();
            renderNotificationsWindow();
            renderMapsGrid();
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
        if (Date.now() - lastPongTime > 12000) {
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

    const cachedRows = loadLocalJournalCache('table_rows', new Array());
    if (Array.isArray(cachedRows) && cachedRows.length > 0) {
        document.getElementById('table-body').innerHTML = '';
        cachedRows.forEach(appendRow);
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
    fetchMapsFromServer();
    connectWS(false);
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
    fetch('/api/user/me?user=' + encodeURIComponent(currentCallsign) + '&t=' + Date.now())
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
    subscribeToWebPush();
    checkAndShowAlerts(false);
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
        if (badge) {
            badge.style.display = pending.length > 0 ? 'inline-block' : 'none';
            badge.innerText = pending.length;
        }
        if (pending.length === 0) pBox.innerHTML = '<div style="color:#64748b;">Нет новых заявок</div>';
        pending.forEach(function(u) {
            const row = document.createElement('div');
            row.className = 'user-row-card';
            row.innerHTML = '<div style="flex:1;"><div><b>Позывной:</b> <span style="color:#38bdf8;">' + u.username + '</span> | <b>Подр.:</b> ' + u.unit + ' | <b>Пароль:</b> <code style="color:#facc15;">' + u.password + '</code></div>' + renderPermCheckboxes(u) + '</div>' +
                '<div style="display:flex; gap:6px;"><button class="lb-btn" style="background:#22c55e;" onclick="adminUserAction(\'' + u.key + '\', \'approve\')">✅ Одобрить</button><button class="lb-btn" style="background:#ef4444;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">❌ Отклонить</button></div>';
            pBox.appendChild(row);
        });
        if (approved.length === 0) aBox.innerHTML = '<div style="color:#64748b;">Пока нет пользователей</div>';
        approved.forEach(function(u) {
            const row = document.createElement('div');
            row.className = 'user-row-card';
            row.innerHTML = '<div style="flex:1;"><div><b>' + u.username + '</b> (' + u.unit + ') — Пароль: <code style="color:#4ade80; font-weight:bold;">' + u.password + '</code></div>' + renderPermCheckboxes(u) + '</div><button class="lb-btn" style="background:#ef4444; padding:5px 10px;" onclick="adminUserAction(\'' + u.key + '\', \'delete\')">🗑️ Удалить</button>';
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
    localStorage.removeItem('journal_user');
    localStorage.removeItem('journal_callsign');
    localStorage.removeItem('journal_color');
    localStorage.removeItem('chat_username');
    localStorage.removeItem('msb_jcache_my_perms');
    location.reload();
}

function loginAsViewer() {
    unlockMobileFeatures();
    document.getElementById('login-overlay').style.display = 'none';
    renderNotificationsWindow();
    renderMapsGrid();
    updateStreamUI();
    subscribeToWebPush();
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

function sendLocalNotification(target, text, sender, notifId) {
    const fromWho = sender || 'АДМИН';
    const title = '🛑 ТРЕВОГА ДЛЯ [' + target + ']!';
    const body = fromWho + ': ' + text;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function(reg) {
            reg.showNotification(title, {
                body: body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                vibrate: Array.of(800, 200, 800, 200, 1000),
                silent: false,
                requireInteraction: true,
                renotify: true,
                tag: 'msb-alert-' + (notifId || Date.now())
            }).catch(function() {});
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

function showAlert(target, text, sender, notifId, isNew) {
    currentAlertId = notifId || null;
    currentAlertTarget = target;
    currentAlertText = text;
    currentAlertSender = sender || ADMIN_NAME;
    const queueLen = getAlertsQueue(target).filter(isUnreadForMe).length;
    document.getElementById('alert-target-label').innerText = 'ДЛЯ [' + target + '] ОТ [' + currentAlertSender + ']' + (queueLen > 1 ? ' (1 из ' + queueLen + ')' : '') + ':';
    document.getElementById('alert-text').innerText = text;
    document.getElementById('alert-modal').style.display = 'flex';
    if (isNew || document.visibilityState === 'hidden') {
        sendLocalNotification(target, text, currentAlertSender, currentAlertId);
    }
    if (!titleInterval) {
        let flag = false;
        titleInterval = setInterval(function() {
            document.title = flag ? "🛑 ТРЕВОГА!" : "⚠️ СООБЩЕНИЕ!";
            flag = !flag;
        }, 600);
    }
    playBeep();
    if (!soundInterval) soundInterval = setInterval(playBeep, 2000);
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
    const whoConfirmed = currentCallsign || currentUser || 'Просмотр';
    const readTime = new Date().toLocaleTimeString().slice(0, 5);
    const targetToClear = currentAlertTarget;
    const idToClear = currentAlertId;
    const alertTextCopy = String(currentAlertText || '');
    const alertSenderCopy = String(currentAlertSender || '');
    stopAlertVisuals();
    if (targetToClear && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear_alert', target: targetToClear, notifId: idToClear, readBy: whoConfirmed, readTime: readTime }));
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
    ws.send(JSON.stringify({ type: 'add_row', user: authorLabel, color: userColor, time: now.toLocaleDateString() + ' ' + now.toLocaleTimeString().slice(0, 5), values: values }));
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) document.getElementById('in-' + i).value = "";
}

function appendRow(row) {
    if (row.values && row.values.at(0)) {
        const firstCol = String(row.values.at(0));
        if (firstCol.indexOf("ОЗНАКОМЛЕН") !== -1 || firstCol.indexOf("УВЕДОМЛЕН") !== -1) return;
    }
    const tbody = document.getElementById('table-body');
    const tr = document.createElement('tr');
    let html = '<td class="time-cell">' + row.time + '</td><td class="user-cell" style="color:' + row.color + '">' + row.user + '</td>';
    for (let i = 0; i < COLUMNS_CONFIG.length; i++) {
        html += '<td>' + ((row.values && row.values.at(i)) ? row.values.at(i) : '-') + '</td>';
    }
    tr.innerHTML = html;
    tbody.appendChild(tr);
    requestAnimationFrame(function() { tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
}

function triggerCallInDev(callType, targetName) {
    playSoundById('nice2', true);
    const modal = document.getElementById('call-dev-modal');
    const icon = document.getElementById('call-dev-icon');
    const title = document.getElementById('call-dev-title');
    const text = document.getElementById('call-dev-text');
    if (icon) icon.innerText = (callType === 'Видеозвонок') ? '🎥' : '📞';
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
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = 20; x < 320; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 200); ctx.stroke(); }
    for (let y = 20; y < 200; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(320, y); ctx.stroke(); }
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

function setAppTheme(themeName) {
    const clean = (themeName === 'rocket' || themeName === 'cosmic') ? themeName : 'military';
    document.body.classList.remove('theme-military', 'theme-rocket', 'theme-cosmic');
    document.body.classList.add('theme-' + clean);
    localStorage.setItem('msb_app_theme', clean);
    Array.of('military', 'rocket', 'cosmic').forEach(function(t) {
        const b = document.getElementById('theme-btn-' + t);
        if (b) b.classList.toggle('active', t === clean);
    });
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
        const formData = new FormData();
        formData.append('sender', sender); formData.append('room', currentRoomId);
        formData.append('type', 'file'); formData.append('media', blob, 'gif_' + Date.now() + '.png');
        return fetch('/api/send', { method: 'POST', body: formData });
    }).then(function() {
        const drawer = document.getElementById('chat-gif-drawer');
        if (drawer) drawer.style.display = 'none';
        closeMsgPhotoViewer();
        if (typeof fetchMessages === 'function') { lastMessagesCount = -1; fetchMessages(); }
    });
}

function openMsgPhotoViewer(src, title) {
    const modal = document.getElementById('msg-photo-viewer-modal');
    const img = document.getElementById('msg-viewer-img');
    const ttl = document.getElementById('msg-viewer-title');
    msgImageZoom = 1;
    if (img) { img.src = src || makeAnimatedSvgGif('military', 0, '🪖 МСБ-55115'); img.style.transform = 'scale(1)'; }
    if (ttl) ttl.innerText = title || '🖼️ Просмотр и настройки темы';
    const zLbl = document.getElementById('msg-zoom-label');
    if (zLbl) zLbl.innerText = '100%';
    setAppTheme(localStorage.getItem('msb_app_theme') || 'military');
    if (modal) modal.style.display = 'flex';
}

function openAvatarInViewer(el, titleName) {
    const imgEl = el ? el.querySelector('img') : null;
    const fallback = makeAnimatedSvgGif(localStorage.getItem('msb_app_theme') || 'military', 0, '🎖️ ' + (titleName || currentCallsign || 'МСБ'));
    openMsgPhotoViewer(imgEl ? imgEl.src : fallback, '👤 Профиль: ' + (titleName || currentCallsign || 'Боец МСБ-55115'));
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
    msgImageZoom = Math.min(4, Math.max(0.5, msgImageZoom + delta));
    const img = document.getElementById('msg-viewer-img');
    const lbl = document.getElementById('msg-zoom-label');
    if (img) img.style.transform = 'scale(' + msgImageZoom + ')';
    if (lbl) lbl.innerText = Math.round(msgImageZoom * 100) + '%';
}
var msbInitialSyncDone = false;
var msbIsWeakNetwork = false;
var msbLastPingRtt = 0;
var msbPingSentAt = 0;
var msbBootWaitTimer = null;

function getMsbWeakPhraseHTML() {
    return '📡 (ищем сеть, закрытый протокол <span class="msb-jumping-word">МСБ55115</span>, обновляемся... ждите)';
}
window.getMsbWeakPhraseHTML = getMsbWeakPhraseHTML;

function ensureWeakBootOverlay() {
    if (document.getElementById('msb-weak-boot-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'msb-weak-boot-overlay';
    ov.innerHTML =
        '<div class="msb-weak-boot-card">' +
            '<div class="msb-weak-spinner"></div>' +
            '<div>' + getMsbWeakPhraseHTML() + '</div>' +
        '</div>';
    document.body.appendChild(ov);
}

function evaluateNetworkWeakness() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        var eff = String(conn.effectiveType || '').toLowerCase();
        if (eff === 'slow-2g' || eff === '2g') return true;
        if (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 0.45) return true;
        if (typeof conn.rtt === 'number' && conn.rtt > 1400) return true;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return true;
    if (msbLastPingRtt > 1800) return true;
    if (Date.now() - lastPongTime > 9000) return true;
    return false;
}

function updateWeakNetworkUI() {
    ensureWeakBootOverlay();
    var weakNow = evaluateNetworkWeakness();
    msbIsWeakNetwork = weakNow;
    window.msbIsWeakNetwork = weakNow;

    var bootOv = document.getElementById('msb-weak-boot-overlay');
    if (bootOv) {
        if (!msbInitialSyncDone && weakNow) {
            bootOv.style.display = 'flex';
        } else if (msbInitialSyncDone) {
            bootOv.style.display = 'none';
        }
    }

    if (typeof window.syncMessengerWeakBanner === 'function') {
        window.syncMessengerWeakBanner(weakNow);
    }
}

function triggerImmediateEdgePull() {
    connectWS(false);
    fetchMapsFromServer();
    fetchArchiveFromServer();
    refreshMyPermissionsFromServer();
    if (typeof flushOutboxQueue === 'function') flushOutboxQueue();
    if (typeof loadFriendsAndRequests === 'function') loadFriendsAndRequests();
    if (typeof fetchMessages === 'function') fetchMessages();

    fetch('/maps-list?t=' + Date.now())
        .then(function(r) {
            if (r.ok) window.markMsbServerAlive(true);
            return r.json();
        })
        .then(function(list) {
            if (Array.isArray(list)) {
                allMaps = list;
                saveLocalJournalCache('maps', list);
                renderMapsGrid();
            }
        })
        .catch(function() {});
}

window.markMsbServerAlive = function(isFullInit) {
    if (msbPingSentAt > 0) {
        msbLastPingRtt = Date.now() - msbPingSentAt;
        msbPingSentAt = 0;
    }
    if (isFullInit && !msbInitialSyncDone) {
        msbInitialSyncDone = true;
        if (msbBootWaitTimer) {
            clearTimeout(msbBootWaitTimer);
            msbBootWaitTimer = null;
        }
    }
    updateWeakNetworkUI();
};

(function initWeakNetworkWatcher() {
    ensureWeakBootOverlay();
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!navigator.onLine || (conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || (conn.downlink > 0 && conn.downlink < 0.45)))) {
        document.getElementById('msb-weak-boot-overlay').style.display = 'flex';
    }

    msbBootWaitTimer = setTimeout(function() {
        if (!msbInitialSyncDone) {
            ensureWeakBootOverlay();
            document.getElementById('msb-weak-boot-overlay').style.display = 'flex';
            triggerImmediateEdgePull();
        }
    }, 1800);

    if (conn && typeof conn.addEventListener === 'function') {
        conn.addEventListener('change', function() {
            updateWeakNetworkUI();
            if (navigator.onLine) {
                triggerImmediateEdgePull();
            }
        });
    }

    window.addEventListener('online', function() {
        triggerImmediateEdgePull();
        setTimeout(updateWeakNetworkUI, 400);
    });

    window.addEventListener('offline', function() {
        updateWeakNetworkUI();
    });

    setInterval(function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            msbPingSentAt = Date.now();
        } else if (navigator.onLine) {
            triggerImmediateEdgePull();
        }
        updateWeakNetworkUI();
    }, 2200);
})();
initApp();
