var chatUser = null;
var currentPartner = null;
var currentRoomId = null;
var isCurrentGroup = false;
var friendsList = new Array();
var friendRequests = new Array();
var updateInterval = null;
var lastMessagesCount = -1;
var renderedMsgIds = new Set();
var audioRecorder = null;
var videoRecorder = null;
var audioChunks = new Array();
var videoChunks = new Array();
var videoStreamRef = null;

var activeMessageId = null;
var activeMessageText = null;
var activeMessageType = null;
var activeMessageOriginalSender = null;

var quotedMessageId = null;
var quotedMessageText = null;
var quotedMessageSender = null;

var msgImageZoom = 1;
var currentGifCategory = 'military';

var msbOutboxQueue = new Array();
var msbIsFlushing = false;
var isFetchingMessages = false;
var isFetchingFriends = false;
var lastFriendsRenderSig = '';
var lastRequestsRenderSig = '';
var avatarLocalMem = {};
var avatarFetchingSet = {};

try {
    var savedAvMap = localStorage.getItem('msb_avatars_map_v1');
    if (savedAvMap) avatarLocalMem = JSON.parse(savedAvMap) || {};
} catch (e) { avatarLocalMem = {}; }

function saveAvatarToLocalMem(userKey, hashStr, dataUrl) {
    if (!userKey || !dataUrl) return;
    var k = String(userKey).trim().toLowerCase();
    avatarLocalMem[k] = { h: hashStr || String(dataUrl.length), d: dataUrl };
    try {
        localStorage.setItem('msb_avatars_map_v1', JSON.stringify(avatarLocalMem));
    } catch (e) {}
}

function getCachedUserAvatar(userKey, expectedHash) {
    if (!userKey) return '';
    var k = String(userKey).trim().toLowerCase();
    var entry = avatarLocalMem[k];
    if (entry && entry.d) {
        if (!expectedHash || entry.h === expectedHash) return entry.d;
    }
    if (expectedHash && !avatarFetchingSet[k]) {
        avatarFetchingSet[k] = true;
        fetch('/api/user/avatar?user=' + encodeURIComponent(k) + '&t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(d) {
                delete avatarFetchingSet[k];
                if (d && d.avatar) {
                    saveAvatarToLocalMem(k, String(d.avatar.length), d.avatar);
                    lastFriendsRenderSig = '';
                    renderFriends();
                    if (currentPartner && currentPartner.toLowerCase() === k) {
                        renderAvatarElement(document.getElementById('partner-avatar'), currentPartner, d.avatar);
                    }
                }
            })
            .catch(function() { delete avatarFetchingSet[k]; });
    }
    return entry ? entry.d : '';
}

try {
    var savedTextQ = localStorage.getItem('msb_edge_q');
    if (savedTextQ) {
        var parsedQ = JSON.parse(savedTextQ);
        if (Array.isArray(parsedQ)) msbOutboxQueue = parsedQ;
    }
} catch (e) {
    msbOutboxQueue = new Array();
}
function getMessagesDiv() {
    return document.getElementById('messages');
}

function getActiveChatIdentity() {
    if (typeof currentCallsign !== 'undefined' && currentCallsign) {
        return currentCallsign;
    }
    if (typeof currentUser !== 'undefined' && currentUser) {
        return currentUser;
    }
    return localStorage.getItem('journal_callsign') ||
        localStorage.getItem('chat_username') ||
        localStorage.getItem('journal_user') || null;
}

function makeDirectRoomId(u1, u2) {
    var sorted = Array.of(
        String(u1 || '').trim().toLowerCase(),
        String(u2 || '').trim().toLowerCase()
    ).sort();
    var pair = sorted.join(',');
    return pair + '_' + pair;
}

function escapeEdgeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function saveTextOutboxToStorage() {
    try {
        var onlyText = msbOutboxQueue.filter(function(item) {
            return item && item.type === 'text';
        });
        localStorage.setItem('msb_edge_q', JSON.stringify(onlyText));
    } catch (e) {}
}

var partnerLastSeenCache = '';
var activeRoomTypers = {};
var myLastTypingSentAt = 0;
var stopTypingDebounce = null;

function ensureMessengerWeakBannerEl() {
    var chatArea = document.querySelector('#messenger-modal .chat-area');
    if (!chatArea) return null;
    var banner = document.getElementById('msb-chat-weak-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'msb-chat-weak-banner';
        banner.innerHTML = (typeof window.getMsbWeakPhraseHTML === 'function')
            ? window.getMsbWeakPhraseHTML()
            : '📡 (ищем сеть, закрытый протокол <span class="msb-jumping-word">МСБ55115</span>, обновляемся... ждите)';
        var mDiv = getMessagesDiv();
        if (mDiv) {
            chatArea.insertBefore(banner, mDiv);
        } else {
            chatArea.appendChild(banner);
        }
    }
    return banner;
}

var msbWeakBannerTimer = null;

function syncMessengerWeakBanner(isWeak) {
    var banner = ensureMessengerWeakBannerEl();
    if (!banner) return;

    if (!isWeak) {
        if (msbWeakBannerTimer) {
            clearTimeout(msbWeakBannerTimer);
            msbWeakBannerTimer = null;
        }
        banner.style.display = 'none';
        return;
    }

    if (banner.style.display === 'block' || msbWeakBannerTimer) return;

    msbWeakBannerTimer = setTimeout(function() {
        msbWeakBannerTimer = null;
        if (window.msbIsWeakNetwork || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            var b = ensureMessengerWeakBannerEl();
            if (b) b.style.display = 'block';
        }
    }, 6000);
}
window.syncMessengerWeakBanner = syncMessengerWeakBanner;

function showNetworkErrorBanner() {
    syncMessengerWeakBanner(true);
}

function clearNetworkErrorBanner() {
    window.msbIsWeakNetwork = false;
    syncMessengerWeakBanner(false);
}
function renderPartnerPresenceHeader(partnerOnline, partnerLastSeen, typingUsersList) {
    var stEl = document.getElementById('chat-status');
    if (!stEl || !currentRoomId) return;
    stEl.style.display = 'block';

    var typers = Array.isArray(typingUsersList) ? typingUsersList.slice() : new Array();
    var now = Date.now();
    if (activeRoomTypers[currentRoomId]) {
        Object.keys(activeRoomTypers[currentRoomId]).forEach(function(u) {
            if (now - activeRoomTypers[currentRoomId][u] < 4200) {
                if (!typers.includes(u)) typers.push(u);
            } else {
                delete activeRoomTypers[currentRoomId][u];
            }
        });
    }

    var nextText = '';
    var nextColor = '#94a3b8';
    var isTypingNow = typers.length > 0;

    if (isTypingNow) {
        nextColor = '#4ade80';
        nextText = isCurrentGroup
            ? ('✍️ ' + typers.join(', ') + ' набирает сообщение...')
            : '✍️ набирает сообщение...';
    } else if (isCurrentGroup) {
        nextText = '👥 конференция';
        nextColor = '#38bdf8';
    } else if (partnerOnline) {
        nextText = '🟢 в сети';
        nextColor = '#4ade80';
    } else {
        var seenText = partnerLastSeen || partnerLastSeenCache || '';
        nextText = seenText ? ('⚫ был(а): ' + seenText) : '⚫ не в сети';
        nextColor = '#94a3b8';
    }

    if (stEl.textContent !== nextText) stEl.textContent = nextText;
    stEl.style.color = nextColor;
    stEl.style.fontWeight = isTypingNow ? 'bold' : 'normal';
    stEl.classList.toggle('msb-typing-active', isTypingNow);
}

window.handleIncomingTypingWS = function(msg) {
    if (!msg || !msg.room || !msg.user) return;
    var me = String(getActiveChatIdentity() || '').trim().toLowerCase();
    if (String(msg.user).trim().toLowerCase() === me) return;

    if (!activeRoomTypers[msg.room]) activeRoomTypers[msg.room] = {};
    if (msg.typing) {
        activeRoomTypers[msg.room][msg.user] = Date.now();
    } else {
        delete activeRoomTypers[msg.room][msg.user];
    }

    if (currentRoomId === msg.room) {
        var fObj = friendsList.find(function(f) {
            return !f.isGroup && currentPartner && f.name.toLowerCase() === currentPartner.toLowerCase();
        });
        renderPartnerPresenceHeader(fObj ? fObj.online : false, partnerLastSeenCache, null);
    }

    setTimeout(function() {
        if (currentRoomId === msg.room) {
            var fObj2 = friendsList.find(function(f) {
                return !f.isGroup && currentPartner && f.name.toLowerCase() === currentPartner.toLowerCase();
            });
            renderPartnerPresenceHeader(fObj2 ? fObj2.online : false, partnerLastSeenCache, null);
        }
    }, 4300);
};

function notifyServerTyping(isTyping) {
    var me = getActiveChatIdentity();
    if (!me || !currentRoomId) return;
    var now = Date.now();
    if (isTyping && (now - myLastTypingSentAt < 2200)) return;
    myLastTypingSentAt = isTyping ? now : 0;

    var payload = {
        type: 'chat_typing',
        user: me,
        room: currentRoomId,
        typing: Boolean(isTyping)
    };

    if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(payload));
            return;
        } catch (e) {}
    }
}
window.handleIncomingChatWS = function(packet) {
    if (!packet) return;
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;

    if (packet.type === 'avatar_updated' && packet.user) {
        delete avatarLocalMem[String(packet.user).toLowerCase()];
        getCachedUserAvatar(packet.user, 'force_' + Date.now());
        return;
    }

    if (packet.type === 'chat_msg_deleted' && packet.room && packet.messageId) {
        try {
            var rawC = localStorage.getItem('msb_cache_room_' + packet.room);
            if (rawC) {
                var arrC = JSON.parse(rawC).filter(function(m) { return m.id !== packet.messageId; });
                localStorage.setItem('msb_cache_room_' + packet.room, JSON.stringify(arrC));
            }
        } catch (e) {}
        if (currentRoomId === packet.room) {
            var rowDel = document.querySelector('.message-row[data-msg-id="' + packet.messageId + '"]');
            if (rowDel) rowDel.remove();
            renderedMsgIds.delete(packet.messageId);
        }
        loadFriendsAndRequests(true);
        return;
    }

    if (packet.type === 'chat_room_read' && packet.room) {
        if (currentRoomId === packet.room && String(packet.reader || '').toLowerCase() !== chatUser.toLowerCase()) {
            var mDivR = getMessagesDiv();
            if (mDivR) {
                mDivR.querySelectorAll('.message-row.my-msg .msg-check').forEach(function(chk) {
                    chk.textContent = '✓✓';
                    chk.style.color = '#38bdf8';
                    chk.style.fontWeight = '900';
                    chk.title = 'Прочитано';
                });
            }
        }
        return;
    }

    if (packet.type === 'chat_new_msg' && packet.room && packet.msg) {
        var msg = packet.msg;
        try {
            var rawRoom = localStorage.getItem('msb_cache_room_' + packet.room);
            var listRoom = rawRoom ? JSON.parse(rawRoom) : [];
            if (!listRoom.some(function(x) { return x.id === msg.id; })) {
                listRoom.push(msg);
                if (listRoom.length > 150) listRoom.shift();
                localStorage.setItem('msb_cache_room_' + packet.room, JSON.stringify(listRoom));
            }
        } catch (e) {}

        var modal = document.getElementById('messenger-modal');
        var isModalOpen = modal && modal.style.display === 'flex';

        if (currentRoomId === packet.room) {
            var mDiv = getMessagesDiv();
            if (mDiv && !renderedMsgIds.has(msg.id)) {
                var ph = mDiv.querySelector('.chat-placeholder');
                if (ph) ph.remove();
                var isMy = String(msg.sender || '').trim().toLowerCase() === chatUser.toLowerCase();
                var checkIcon = isMy
                    ? ' <span class="msg-check" style="color:rgba(255,255,255,0.6);font-weight:bold;margin-left:5px;font-size:13px;" title="Доставлено">✓</span>'
                    : '';
                renderedMsgIds.add(msg.id);
                renderSingleRow(mDiv, msg, isMy, checkIcon);
                renderPendingBubbles();
                mDiv.scrollTop = mDiv.scrollHeight;
                if (!isMy && isModalOpen) {
                    markChatAsRead(currentRoomId);
                }
            }
        }
        loadFriendsAndRequests(true);
    }
};
function ensureCleanMessengerTopbar() {
    var modal = document.getElementById('messenger-modal');
    if (!modal) return;

    Array.from(modal.children).forEach(function(child) {
        if (child.id === 'app-screen' || child.classList.contains('msb-clean-topbar') || child.classList.contains('msg-ticker-wrap')) {
            return;
        }
        var txt = child.textContent || '';
        if (txt.indexOf('В ЖУРНАЛ') !== -1 || txt.indexOf('МЕССЕНДЖЕР') !== -1) {
            child.style.display = 'none';
        }
    });

    if (document.getElementById('msb-unified-topbar')) return;

    var oldAv = document.getElementById('my-avatar');
    if (oldAv) oldAv.id = 'my-avatar-legacy';
    var oldName = document.getElementById('msg-my-name');
    if (oldName) oldName.id = 'msg-my-name-legacy';

    var topbar = document.createElement('div');
    topbar.id = 'msb-unified-topbar';
    topbar.className = 'msb-clean-topbar';
    topbar.innerHTML =
        '<button type="button" class="msb-unified-back-btn" onclick="handleUnifiedMessengerBack()">' +
            '<span class="back-arrow-icon">‹</span>' +
            '<span>Назад</span>' +
        '</button>' +
        '<div class="msb-profile-pill">' +
            '<div id="my-avatar" class="avatar msb-top-avatar" onclick="openAvatarInViewer(this, chatUser)">МС</div>' +
            '<div class="msb-profile-meta">' +
                '<span id="msg-my-name" class="msb-profile-callsign">Боец</span>' +
                '<label for="msb-top-avatar-file" class="msb-avatar-edit-link">📷 Сменить аватарку</label>' +
                '<input type="file" id="msb-top-avatar-file" accept="image/*" style="display:none;" onchange="uploadMyAvatar(this)">' +
            '</div>' +
        '</div>';

    modal.insertBefore(topbar, modal.firstChild);
}

function handleUnifiedMessengerBack() {
    var sidebar = document.getElementById('app-sidebar');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('hidden')) {
        sidebar.classList.remove('hidden');
        return;
    }
    closeMessengerWindow();
}
window.handleUnifiedMessengerBack = handleUnifiedMessengerBack;

function enqueueChatPayload(payload) {
    if (!payload.lid) {
        payload.lid = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    msbOutboxQueue.push(payload);
    saveTextOutboxToStorage();
    renderPendingBubbles();
    flushOutboxQueue();
}
function renderPendingBubbles() {
    var mDiv = getMessagesDiv();
    if (!mDiv || !currentRoomId) return;

    var myPending = msbOutboxQueue.filter(function(item) {
        return item && item.room === currentRoomId;
    });

    mDiv.querySelectorAll('.msb-pending-row').forEach(function(el) {
        var lid = el.getAttribute('data-lid');
        var stillInQueue = myPending.some(function(p) { return p.lid === lid; });
        if (!stillInQueue) el.remove();
    });

    if (myPending.length === 0) return;

    var placeholder = mDiv.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    var added = false;
    myPending.forEach(function(p) {
        var alreadyDelivered = mDiv.querySelector('.message-row[data-client-id="' + p.lid + '"]');
        if (alreadyDelivered) return;

        var existing = mDiv.querySelector('.msb-pending-row[data-lid="' + p.lid + '"]');
        var contentDesc = '';
        if (p.type === 'audio') {
            contentDesc = '🎙️ <b>Голосовое сообщение</b> (передача...)';
        } else if (p.type === 'video') {
            contentDesc = '🎥 <b>Видео-кружок</b> (передача...)';
        } else if (p.type === 'file') {
            contentDesc = '📎 <b>Файл:</b> ' + escapeEdgeHtml(p.fileName || 'вложение');
        } else {
            contentDesc = escapeEdgeHtml(p.text || '');
        }

        if (!existing) {
            var row = document.createElement('div');
            row.className = 'message-row my-msg msb-pending-row';
            row.setAttribute('data-lid', p.lid);
            var quoteHTML = (p.quoteId && p.quoteText)
                ? ('<div class="msg-quote-block"><div class="msg-quote-author">' + escapeEdgeHtml(p.quoteSender || 'Система') + '</div>' + escapeEdgeHtml(p.quoteText) + '</div>')
                : '';
            row.innerHTML =
                '<div class="swipe-container">' +
                    '<div class="bubble" style="opacity:0.9; border:1px dashed #facc15 !important;">' +
                        quoteHTML +
                        '<div class="msg-text">' + contentDesc + '</div>' +
                        '<div class="msg-time" style="color:#facc15; font-weight:bold;">⏳ Отправка...</div>' +
                    '</div>' +
                '</div>';
            mDiv.appendChild(row);
            added = true;
        }
    });

    if (added) {
        mDiv.scrollTop = mDiv.scrollHeight;
    }
}

function flushOutboxQueue() {
    renderPendingBubbles();
    if (msbIsFlushing || msbOutboxQueue.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    var item = msbOutboxQueue.at(0);
    if (!item) return;

    msbIsFlushing = true;
    var controller = new AbortController();
    var isPlainText = (!item.blob && (!item.type || item.type === 'text' || item.type === 'gif'));
    var timeoutMs = isPlainText ? 12000 : 85000;
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);

    var fetchOpts = { method: 'POST', signal: controller.signal };
    if (isPlainText) {
        fetchOpts.headers = { 'Content-Type': 'application/json' };
        fetchOpts.body = JSON.stringify({
            clientMsgId: item.lid,
            sender: item.sender,
            room: item.room,
            type: item.type || 'text',
            text: item.text || '',
            quoteId: item.quoteId || null,
            quoteText: item.quoteText || null,
            quoteSender: item.quoteSender || null,
            forwardedFrom: item.forwardedFrom || null
        });
    } else {
        var fd = new FormData();
        fd.append('clientMsgId', item.lid);
        fd.append('sender', item.sender);
        fd.append('room', item.room);
        fd.append('type', item.type || 'file');
        if (item.blob) fd.append('media', item.blob, item.fileName || ('media_' + Date.now()));
        if (item.quoteId) {
            fd.append('quoteId', item.quoteId);
            fd.append('quoteText', item.quoteText || '');
            fd.append('quoteSender', item.quoteSender || '');
        }
        if (item.forwardedFrom) fd.append('forwardedFrom', item.forwardedFrom);
        fetchOpts.body = fd;
    }

    fetch('/api/send', fetchOpts)
    .then(function(res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('Send error');
        return res.json().catch(function() { return { ok: true }; });
    })
    .then(function(respData) {
        msbOutboxQueue.shift();
        saveTextOutboxToStorage();
        var tempEl = document.querySelector('.msb-pending-row[data-lid="' + item.lid + '"]');
        if (tempEl) tempEl.remove();

        if (respData && respData.msg && typeof window.handleIncomingChatWS === 'function') {
            window.handleIncomingChatWS({ type: 'chat_new_msg', room: item.room, msg: respData.msg });
        } else {
            fetchMessages();
        }
        clearNetworkErrorBanner();
        msbIsFlushing = false;
        if (msbOutboxQueue.length > 0) setTimeout(flushOutboxQueue, 60);
    })
    .catch(function() {
        clearTimeout(timer);
        msbIsFlushing = false;
        renderPendingBubbles();
    });
}

function flushRetryQueue() {
    flushOutboxQueue();
}
function syncMessengerAuth() {
    ensureCleanMessengerTopbar();
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;

    var nameEl = document.getElementById('msg-my-name');
    var avEl = document.getElementById('my-avatar');
    var hdrEl = document.getElementById('msg-header-identity');
    var uName = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : '';

    if (nameEl) {
        nameEl.textContent = chatUser + (uName && uName !== chatUser ? ' (' + uName + ')' : '');
    }
    var myCachedAv = getCachedUserAvatar(chatUser, '');
    if (avEl) {
        renderAvatarElement(avEl, chatUser, myCachedAv);
    }
    if (hdrEl) {
        hdrEl.textContent = '👤 ' + chatUser;
    }

    if (!updateInterval) {
        updateInterval = setInterval(function() {
            if (document.visibilityState === 'hidden') return;
            var wsHealthy = (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN);
            var modal = document.getElementById('messenger-modal');
            if (modal && modal.style.display === 'flex' && !wsHealthy) {
                fetchMessages();
            }
            if (!wsHealthy) {
                loadFriendsAndRequests(true);
            }
        }, 7000);
    }
    loadFriendsAndRequests(false);
}

function openMessengerWindow(targetPartnerName) {
    ensureCleanMessengerTopbar();
    chatUser = getActiveChatIdentity();
    if (!chatUser) {
        alert('Сначала войдите в систему под своим подразделением и позывным!');
        return;
    }
    var modal = document.getElementById('messenger-modal');
    var wasAlreadyOpen = (modal && modal.style.display === 'flex');
    if (modal) modal.style.display = 'flex';
    syncMessengerAuth();
    if (typeof updateBroadcastTicker === 'function') {
        try { updateBroadcastTicker(); } catch (e) {}
    }
    if (wasAlreadyOpen && currentRoomId && !targetPartnerName) {
        fetchMessages();
        loadFriendsAndRequests(true);
        return;
    }
    if (targetPartnerName && typeof targetPartnerName === 'string') {
        try {
            var cleanName = targetPartnerName.trim();
            if (cleanName.indexOf('👥 ') === 0) {
                var gTitle = cleanName.replace('👥 ', '').trim().toLowerCase();
                var foundGroup = friendsList.find(function(f) {
                    return f && f.isGroup && String(f.name || '').trim().toLowerCase() === gTitle;
                });
                if (foundGroup) {
                    selectChat(foundGroup);
                    return;
                }
            }
            var openIdx = cleanName.indexOf('(');
            var closeIdx = cleanName.indexOf(')');
            if (openIdx !== -1 && closeIdx > openIdx) {
                cleanName = cleanName.substring(openIdx + 1, closeIdx).trim();
            }
            var foundFriend = friendsList.find(function(f) {
                return f && !f.isGroup && String(f.name || '').trim().toLowerCase() === cleanName.toLowerCase();
            });
            if (foundFriend) {
                selectChat(foundFriend);
            } else if (cleanName && cleanName.toLowerCase() !== chatUser.toLowerCase() && cleanName !== 'АДМИН') {
                selectChat({ name: cleanName, isGroup: false, avatar: '', online: true });
            }
        } catch (err) {}
    }
    fetchMessages();
    loadFriendsAndRequests(true);
}
window.openMessengerWindow = openMessengerWindow;

function closeMessengerWindow() {
    var modal = document.getElementById('messenger-modal');
    if (modal) modal.style.display = 'none';
    document.querySelectorAll('#messages video, #messages audio').forEach(function(media) {
        try { media.pause(); } catch (e) {}
    });
}
window.closeMessengerWindow = closeMessengerWindow;
function renderAvatarElement(el, name, avatarDataUrl) {
    if (!el) return;
    if (avatarDataUrl) {
        var curImg = el.querySelector('img');
        if (curImg && curImg.getAttribute('src') === avatarDataUrl) return;
        el.innerHTML = '<img src="' + avatarDataUrl + '" alt="av">';
    } else {
        var fallbackTxt = (!name || name === '?') ? 'МСБ-55115' : String(name).substring(0, 2).toUpperCase();
        if (!el.querySelector('img') && el.textContent === fallbackTxt) return;
        el.innerHTML = '';
        if (!name || name === '?') {
            el.style.fontSize = '8px';
            el.style.lineHeight = '1.1';
            el.style.textAlign = 'center';
            el.textContent = 'МСБ-55115';
        } else {
            el.style.fontSize = '';
            el.textContent = fallbackTxt;
        }
    }
}

function uploadMyAvatar(inputEl) {
    chatUser = getActiveChatIdentity();
    if (!inputEl.files || inputEl.files.length === 0 || !chatUser) return;
    var file = inputEl.files.item(0);
    var reader = new FileReader();
    reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
            var canvas = document.createElement('canvas');
            canvas.width = 140;
            canvas.height = 140;
            var ctx = canvas.getContext('2d');
            var minSide = Math.min(img.width, img.height);
            var sx = (img.width - minSide) / 2;
            var sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 140, 140);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            saveAvatarToLocalMem(chatUser, String(dataUrl.length), dataUrl);
            fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: chatUser, avatar: dataUrl })
            }).then(function() {
                renderAvatarElement(document.getElementById('my-avatar'), chatUser, dataUrl);
                var legAv = document.getElementById('my-avatar-legacy');
                if (legAv) renderAvatarElement(legAv, chatUser, dataUrl);
                loadFriendsAndRequests(true);
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

document.addEventListener('DOMContentLoaded', function() {
    ensureCleanMessengerTopbar();
    var tInput = document.getElementById('text-input');
    var fInput = document.getElementById('new-friend-name');
    if (tInput) {
        tInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendMessage();
        });
        tInput.addEventListener('input', function() {
            if (!currentRoomId) return;
            var hasVal = tInput.value.trim().length > 0;
            if (hasVal) {
                notifyServerTyping(true);
                if (stopTypingDebounce) clearTimeout(stopTypingDebounce);
                stopTypingDebounce = setTimeout(function() {
                    notifyServerTyping(false);
                }, 3000);
            } else {
                if (stopTypingDebounce) clearTimeout(stopTypingDebounce);
                notifyServerTyping(false);
            }
        });
    }
    if (fInput) {
        fInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendFriendRequest();
        });
    }
    var savedTheme = localStorage.getItem('msb_app_theme') || 'military';
    if (typeof setAppTheme === 'function') setAppTheme(savedTheme, true);
    syncMessengerAuth();
    var pAv = document.getElementById('partner-avatar');
    if (pAv && !currentPartner) renderAvatarElement(pAv, '', '');
});
function loadFriendsAndRequests(lightweight) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || isFetchingFriends) return;

    if (friendsList.length === 0) {
        try {
            var rawCachedFriends = localStorage.getItem('msb_cache_friends_' + chatUser);
            var cachedFriends = rawCachedFriends ? JSON.parse(rawCachedFriends) : new Array();
            if (Array.isArray(cachedFriends) && cachedFriends.length > 0) {
                friendsList = cachedFriends;
                if (typeof myMessengerFriends !== 'undefined') myMessengerFriends = cachedFriends;
                if (typeof populateTargetSelect === 'function') populateTargetSelect();
                renderFriends();
                updateTotalUnreadBadge();
            }
        } catch (e) {}
    }

    isFetchingFriends = true;
    fetch('/api/friends/get?noav=1&user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(res) { return res.json(); })
        .then(function(data) {
            isFetchingFriends = false;
            if (Array.isArray(data)) {
                data.forEach(function(item) {
                    if (!item.isGroup) {
                        item.avatar = getCachedUserAvatar(item.name, item.avatarHash || '');
                    }
                });
                friendsList = data;
                try {
                    var slim = data.map(function(x) { return Object.assign({}, x, { avatar: '' }); });
                    localStorage.setItem('msb_cache_friends_' + chatUser, JSON.stringify(slim));
                } catch (e) {}
                if (typeof myMessengerFriends !== 'undefined') myMessengerFriends = data;
                if (typeof populateTargetSelect === 'function') populateTargetSelect();
                renderFriends();
                updateTotalUnreadBadge();
            }
        }).catch(function() { isFetchingFriends = false; });

    fetch('/api/friends/requests?user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (Array.isArray(data)) {
                friendRequests = data;
                renderRequests();
                updateTotalUnreadBadge();
            }
        }).catch(function() {});

    if (!lightweight) {
        fetch('/api/user/me?noav=1&user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d && d.avatarHash) {
                    var avData = getCachedUserAvatar(chatUser, d.avatarHash);
                    if (avData) {
                        renderAvatarElement(document.getElementById('my-avatar'), chatUser, avData);
                    }
                }
            }).catch(function() {});
    }
}

function renderRequests() {
    var box = document.getElementById('requests-box');
    if (!box) return;
    var sig = friendRequests.join('|');
    if (sig === lastRequestsRenderSig) return;
    lastRequestsRenderSig = sig;

    box.innerHTML = '';
    if (friendRequests.length === 0) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';
    friendRequests.forEach(function(req) {
        var item = document.createElement('div');
        item.className = 'request-item';
        item.innerHTML =
            '<div class="request-info">' +
                '<span class="request-name">' + escapeEdgeHtml(req) + '</span>' +
                '<span class="request-label">Запрос в друзья</span>' +
            '</div>' +
            '<div class="request-actions">' +
                '<button class="req-btn req-accept" onclick="handleRequest(\'' + req + '\', \'accept\')">Принять</button>' +
                '<button class="req-btn req-decline" onclick="handleRequest(\'' + req + '\', \'decline\')">Отклонить</button>' +
            '</div>';
        box.appendChild(item);
    });
}
function renderFriends() {
    chatUser = getActiveChatIdentity();
    var box = document.getElementById('friends-box');
    if (!box || !chatUser) return;

    var sig = String(currentRoomId || '') + '||' + friendsList.map(function(f) {
        return [
            f.isGroup ? f.id : f.name,
            f.online ? 1 : 0,
            f.lastSeen || '',
            f.lastMessage || '',
            f.time || '',
            f.unread || 0,
            f.avatar ? f.avatar.length : 0
        ].join(':');
    }).join(';');

    if (sig === lastFriendsRenderSig) return;
    lastFriendsRenderSig = sig;

    box.innerHTML = '';
    if (friendsList.length === 0) {
        box.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b; font-size:13px;">Список друзей пуст</div>';
        return;
    }
    var frag = document.createDocumentFragment();
    friendsList.forEach(function(friend) {
        var activeId = friend.isGroup ? friend.id : makeDirectRoomId(chatUser, friend.name);
        var isActive = currentRoomId && currentRoomId === activeId;
        var item = document.createElement('div');
        item.className = 'friend-item ' + (isActive ? 'active' : '');
        item.onclick = function() { selectChat(friend); };
        var badgeHTML = (friend.unread > 0 && !isActive) ? ('<div class="unread-badge">' + friend.unread + '</div>') : '';
        var timeHTML = friend.time ? ('<div class="friend-time-label">' + friend.time + '</div>') : '';
        var unitTag = (!friend.isGroup && friend.unit) ? (' <span style="color:#38bdf8;font-size:12px;">(' + friend.unit + ')</span>') : '';
        var statusDot = friend.isGroup ? '👥 ' : (friend.online ? '🟢 ' : '⚫ ');
        var subSeen = (!friend.isGroup && !friend.online && friend.lastSeen)
            ? (' <span style="color:#64748b;font-size:11px;font-weight:normal;">• ' + friend.lastSeen + '</span>')
            : '';
        var displayName = statusDot + escapeEdgeHtml(friend.name) + unitTag + subSeen;
        var avInner = friend.avatar ? ('<img src="' + friend.avatar + '" alt="av">') : escapeEdgeHtml(friend.name.substring(0, 2).toUpperCase());
        var friendDataEscaped = JSON.stringify({
            id: friend.id,
            name: friend.name,
            isGroup: friend.isGroup,
            avatarHash: friend.avatarHash || '',
            online: Boolean(friend.online),
            lastSeen: friend.lastSeen || ''
        }).replace(/"/g, '&quot;');

        var safeNameJs = String(friend.name || '').replace(/'/g, "\\'");
        var callBtnsHTML =
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Аудиозвонок\', \'' + safeNameJs + '\')" title="Аудиозвонок">📞</button>' +
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Видеозвонок\', \'' + safeNameJs + '\')" title="Видеозвонок">🎥</button>';
        var delBtnHTML = '<button class="delete-friend-btn" onclick="deleteFriend(' + friendDataEscaped + ', event)">&times;</button>';
        item.innerHTML =
            '<div class="friend-info">' +
                '<div class="avatar" style="width:38px; height:38px; font-size:13px;" onclick="event.stopPropagation(); openAvatarInViewer(this, \'' + safeNameJs + '\')">' + avInner + '</div>' +
                '<div class="friend-meta">' +
                    '<div class="friend-name">' + displayName + '</div>' +
                    '<div class="friend-last-msg">' + escapeEdgeHtml(friend.lastMessage || '') + '</div>' +
                '</div>' +
                '<div class="friend-status-box">' + timeHTML + badgeHTML + '</div>' +
            '</div>' + callBtnsHTML + delBtnHTML;
        frag.appendChild(item);
    });
    box.appendChild(frag);
}

function openCreateGroupModal() {
    document.getElementById('group-modal').style.display = 'flex';
}

function closeGroupModal() {
    document.getElementById('group-modal').style.display = 'none';
}
function submitCreateGroup() {
    chatUser = getActiveChatIdentity();
    var nameInput = document.getElementById('group-name-input');
    var membersInput = document.getElementById('group-members-input');
    var gName = nameInput.value.trim();
    var gMembersRaw = membersInput.value.trim();
    if (!gName || !gMembersRaw || !chatUser) {
        return alert("Заполните поля!");
    }
    var memberArray = gMembersRaw.split(',').map(function(m) {
        return m.trim();
    }).filter(function(m) {
        return m !== '';
    });
    fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: chatUser, groupName: gName, members: memberArray })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) {
            nameInput.value = '';
            membersInput.value = '';
            closeGroupModal();
            loadFriendsAndRequests(true);
        }
    });
}

function deleteFriend(friendObj, event) {
    chatUser = getActiveChatIdentity();
    if (event) event.stopPropagation();
    if (friendObj.isGroup) {
        if (!confirm('Покинуть и удалить конференцию "' + friendObj.name + '" у себя из списка?')) return;
        fetch('/api/groups/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: friendObj.id, user: chatUser })
        }).then(function() {
            if (isCurrentGroup && currentRoomId === friendObj.id) resetChatArea();
            loadFriendsAndRequests(true);
        });
        return;
    }
    if (!confirm('Удалить ' + friendObj.name + ' из контактов?')) return;
    var cleanNames = friendsList.filter(function(f) {
        return !f.isGroup && f.name.toLowerCase() !== friendObj.name.toLowerCase();
    }).map(function(f) { return f.name; });
    if (!isCurrentGroup && currentPartner && currentPartner.toLowerCase() === friendObj.name.toLowerCase()) {
        resetChatArea();
    }
    fetch('/api/friends/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, friends: cleanNames })
    }).then(function() {
        loadFriendsAndRequests(true);
    });
}

var msgFetchAbortCtrl = null;
var lastMarkReadMap = {};

function resetChatArea() {
    if (msgFetchAbortCtrl) {
        try { msgFetchAbortCtrl.abort(); } catch (e) {}
        msgFetchAbortCtrl = null;
    }
    isFetchingMessages = false;
    currentPartner = null;
    currentRoomId = null;
    isCurrentGroup = false;
    cancelReply();
    clearNetworkErrorBanner();
    lastMessagesCount = -1;
    renderedMsgIds.clear();
    document.getElementById('partner-display-name').textContent = "Чат не выбран";
    renderAvatarElement(document.getElementById('partner-avatar'), '', '');
    var tInput = document.getElementById('text-input');
    if (tInput) {
        tInput.setAttribute('disabled', 'true');
        tInput.placeholder = "Сообщение...";
    }
    var mDiv = getMessagesDiv();
    if (mDiv) {
        mDiv.innerHTML = '<div class="chat-placeholder">Выберите контакт или конференцию слева.</div>';
    }
}
function selectChat(itemObj) {
    chatUser = getActiveChatIdentity();
    if (msgFetchAbortCtrl) {
        try { msgFetchAbortCtrl.abort(); } catch (e) {}
        msgFetchAbortCtrl = null;
    }
    isFetchingMessages = false;

    if (itemObj.isGroup) {
        currentPartner = itemObj.name;
        currentRoomId = itemObj.id;
        isCurrentGroup = true;
    } else {
        currentPartner = itemObj.name;
        isCurrentGroup = false;
        currentRoomId = makeDirectRoomId(chatUser, currentPartner);
    }
    document.getElementById('partner-display-name').textContent = currentPartner;
    var avUrl = itemObj.avatar || (!itemObj.isGroup ? getCachedUserAvatar(currentPartner, itemObj.avatarHash || '') : '');
    renderAvatarElement(document.getElementById('partner-avatar'), currentPartner, avUrl);
    partnerLastSeenCache = itemObj.lastSeen || '';
    renderPartnerPresenceHeader(Boolean(itemObj.online), partnerLastSeenCache, null);
    syncMessengerWeakBanner(Boolean(window.msbIsWeakNetwork));

    lastMessagesCount = -1;
    renderedMsgIds.clear();
    cancelReply();
    clearNetworkErrorBanner();
    var tInput = document.getElementById('text-input');
    if (tInput) {
        tInput.removeAttribute('disabled');
        tInput.disabled = false;
        tInput.placeholder = "Написать сообщение...";
    }
    if (window.innerWidth < 768) {
        var sb = document.getElementById('app-sidebar');
        if (sb) sb.classList.add('hidden');
    }
    var mDiv = getMessagesDiv();
    if (mDiv) mDiv.innerHTML = '';

    friendsList.forEach(function(f) {
        var fid = f.isGroup ? f.id : makeDirectRoomId(chatUser, f.name);
        if (fid === currentRoomId) f.unread = 0;
    });
    updateTotalUnreadBadge();
    renderFriends();

    fetchMessages();
    markChatAsRead(currentRoomId);
    setTimeout(renderPendingBubbles, 30);
}

function closeChatMobile() {
    var sb = document.getElementById('app-sidebar');
    if (sb) sb.classList.remove('hidden');
}

function markChatAsRead(roomId) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !roomId) return;
    var now = Date.now();
    if (lastMarkReadMap[roomId] && (now - lastMarkReadMap[roomId] < 1800)) return;
    lastMarkReadMap[roomId] = now;

    fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, room: roomId })
    }).catch(function() {});
}

function sendMessage() {
    chatUser = getActiveChatIdentity();
    var textInput = document.getElementById('text-input');
    if (!textInput) return;
    var text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;

    var qId = quotedMessageId || null;
    var qTxt = quotedMessageText || null;
    var qSnd = quotedMessageSender || null;

    textInput.value = '';
    if (stopTypingDebounce) clearTimeout(stopTypingDebounce);
    notifyServerTyping(false);
    cancelReply();

    enqueueChatPayload({
        sender: chatUser,
        room: currentRoomId,
        type: 'text',
        text: text,
        quoteId: qId,
        quoteText: qTxt,
        quoteSender: qSnd
    });
    textInput.focus();
}
function toggleVoiceRecord() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId) return alert("Сначала выберите чат слева!");
    var btn = document.getElementById('voice-btn');
    if (audioRecorder && audioRecorder.state === "recording") {
        audioRecorder.stop();
        btn.classList.remove('recording');
        btn.textContent = "🎙️";
    } else {
        navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 }
        }).then(function(stream) {
            audioChunks = new Array();
            var options = { audioBitsPerSecond: 18000 };
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/mp4')) options.mimeType = 'audio/mp4';
            audioRecorder = new MediaRecorder(stream, options);
            audioRecorder.ondataavailable = function(e) {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };
            audioRecorder.onstop = function() {
                var mimeUsed = audioRecorder.mimeType || 'audio/webm';
                var ext = mimeUsed.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
                var blob = new Blob(audioChunks, { type: mimeUsed });
                var qId = quotedMessageId || null, qTxt = quotedMessageText || null, qSnd = quotedMessageSender || null;
                cancelReply();
                enqueueChatPayload({
                    sender: chatUser, room: currentRoomId, type: 'audio',
                    blob: blob, fileName: 'voice.' + ext,
                    quoteId: qId, quoteText: qTxt, quoteSender: qSnd
                });
                stream.getTracks().forEach(function(track) { track.stop(); });
            };
            audioRecorder.start(400);
            btn.classList.add('recording');
            btn.textContent = "🛑";
        }).catch(function() { alert("Нет доступа к микрофону!"); });
    }
}

function toggleVideoRecord() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId) return alert("Сначала выберите чат слева!");
    var btn = document.getElementById('video-btn');
    var preview = document.getElementById('video-preview');
    if (videoRecorder && videoRecorder.state === "recording") {
        videoRecorder.stop();
        btn.classList.remove('recording');
        btn.textContent = "🎥";
        if (preview) {
            preview.style.display = 'none';
            if (preview.srcObject) {
                preview.srcObject.getTracks().forEach(function(t) { t.stop(); });
                preview.srcObject = null;
            }
        }
    } else {
        navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 },
            video: { width: { ideal: 160, max: 200 }, height: { ideal: 160, max: 200 }, frameRate: { ideal: 14, max: 16 }, facingMode: "user" }
        }).then(function(stream) {
            videoChunks = new Array();
            videoStreamRef = stream;
            if (preview) { preview.srcObject = stream; preview.style.display = 'block'; }
            var mime = '';
            if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) mime = 'video/mp4;codecs=avc1,mp4a.40.2';
            else if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';
            else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mime = 'video/webm;codecs=vp8,opus';
            else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';
            var recOptions = { videoBitsPerSecond: 115000, audioBitsPerSecond: 18000 };
            if (mime) recOptions.mimeType = mime;
            videoRecorder = new MediaRecorder(stream, recOptions);
            videoRecorder.ondataavailable = function(e) {
                if (e.data && e.data.size > 0) videoChunks.push(e.data);
            };
            videoRecorder.onstop = function() {
                var blob = new Blob(videoChunks, { type: videoRecorder.mimeType || 'video/mp4' });
                var fileExt = (videoRecorder.mimeType && videoRecorder.mimeType.indexOf('mp4') !== -1) ? 'mp4' : 'webm';
                var qId = quotedMessageId || null, qTxt = quotedMessageText || null, qSnd = quotedMessageSender || null;
                cancelReply();
                enqueueChatPayload({
                    sender: chatUser, room: currentRoomId, type: 'video',
                    blob: blob, fileName: 'video.' + fileExt,
                    quoteId: qId, quoteText: qTxt, quoteSender: qSnd
                });
                if (videoStreamRef) videoStreamRef.getTracks().forEach(function(t) { t.stop(); });
            };
            videoRecorder.start(400);
            btn.classList.add('recording');
            btn.textContent = "🛑";
        }).catch(function() { alert("Нет доступа к камере!"); });
    }
}

function uploadAnyFile(inputElement) {
    chatUser = getActiveChatIdentity();
    if (!inputElement.files || inputElement.files.length === 0 || !chatUser || !currentRoomId) return;
    var file = inputElement.files.item(0);
    var qId = quotedMessageId || null, qTxt = quotedMessageText || null, qSnd = quotedMessageSender || null;
    cancelReply();
    inputElement.value = '';
    enqueueChatPayload({
        sender: chatUser, room: currentRoomId, type: 'file',
        blob: file, fileName: file.name,
        quoteId: qId, quoteText: qTxt, quoteSender: qSnd
    });
}
function setupSwipe(rowElement, msgId, rawText, msgType, sender) {
    var container = rowElement.querySelector('.swipe-container');
    var leftIndicator = rowElement.querySelector('.left-indicator');
    var rightIndicator = rowElement.querySelector('.right-indicator');
    var startX = 0, startY = 0, currentX = 0, isSwiping = false, isHorizontal = false;
    var displayStr = rawText;
    if (msgType === 'audio') displayStr = "🎙️ Голосовое сообщение";
    if (msgType === 'video') displayStr = "🎥 Видео-кружок";
    if (msgType === 'gif') displayStr = "🎬 GIF-анимация";
    if (msgType === 'file') {
        try { displayStr = '📎 Файл: ' + JSON.parse(rawText).name; } catch (e) {}
    }

    container.addEventListener('touchstart', function(e) {
        var touch = e.touches.item(0);
        startX = touch.clientX; startY = touch.clientY;
        isSwiping = true; isHorizontal = false;
        container.style.transition = 'none';
    }, { passive: true });

    container.addEventListener('touchmove', function(e) {
        if (!isSwiping) return;
        var touch = e.touches.item(0);
        var diffX = touch.clientX - startX;
        var diffY = touch.clientY - startY;
        if (!isHorizontal && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8) isHorizontal = true;
        if (isHorizontal) {
            if (e.cancelable) e.preventDefault();
            currentX = Math.max(-80, Math.min(80, diffX * 0.6));
            container.style.transform = 'translateX(' + currentX + 'px)';
            leftIndicator.style.opacity = (currentX > 35) ? '1' : '0';
            rightIndicator.style.opacity = (currentX < -35) ? '1' : '0';
        }
    }, { passive: false });

    container.addEventListener('touchend', function() {
        isSwiping = false;
        container.style.transition = 'transform 0.2s cubic-bezier(0.1, 0.8, 0.3, 1)';
        container.style.transform = 'translateX(0px)';
        leftIndicator.style.opacity = '0'; rightIndicator.style.opacity = '0';
        if (currentX > 50) handleQuoteTrigger(msgId, displayStr, sender);
        else if (currentX < -50) handleForwardTrigger(msgId, rawText, msgType, sender);
        currentX = 0;
    });
}

function handleQuoteTrigger(id, text, sender) {
    quotedMessageId = id; quotedMessageText = text; quotedMessageSender = sender;
    var bar = document.getElementById('reply-bar');
    var textEl = document.getElementById('reply-bar-text');
    if (textEl) textEl.textContent = 'Цитата от ' + sender + ': ' + text;
    if (bar) bar.style.display = 'flex';
    var ti = document.getElementById('text-input');
    if (ti) ti.focus();
}

function cancelReply() {
    quotedMessageId = null; quotedMessageText = null; quotedMessageSender = null;
    var bar = document.getElementById('reply-bar');
    if (bar) bar.style.display = 'none';
}

function handleForwardTrigger(id, text, type, sender) {
    activeMessageId = id; activeMessageText = text; activeMessageType = type; activeMessageOriginalSender = sender;
    var modal = document.getElementById('forward-modal');
    var listContainer = document.getElementById('modal-contacts-list');
    if (!modal || !listContainer) return;
    listContainer.innerHTML = '';
    if (friendsList.length === 0) {
        listContainer.innerHTML = '<div style="color:#64748b;font-size:14px;text-align:center;">Нет контактов</div>';
    } else {
        friendsList.forEach(function(f) {
            var item = document.createElement('div');
            item.className = 'modal-item';
            item.innerHTML = '<span>' + (f.isGroup ? '👥 ' : (f.online ? '🟢 ' : '⚫ ')) + escapeEdgeHtml(f.name) + '</span><span class="modal-forward-icon">➔</span>';
            item.onclick = function() { executeForward(f); };
            listContainer.appendChild(item);
        });
    }
    modal.style.display = 'flex';
}

function closeForwardModal() {
    var m = document.getElementById('forward-modal');
    if (m) m.style.display = 'none';
}
function executeForward(targetObj) {
    chatUser = getActiveChatIdentity();
    var targetRoomId = targetObj.isGroup ? targetObj.id : makeDirectRoomId(chatUser, targetObj.name);
    var originalAuthor = activeMessageOriginalSender || chatUser;
    if (activeMessageType === 'audio' || activeMessageType === 'video' || activeMessageType === 'file') {
        var fileUrl = activeMessageType === 'file' ? JSON.parse(activeMessageText).path : activeMessageText;
        var origName = activeMessageType === 'file' ? JSON.parse(activeMessageText).name : ('media.' + (fileUrl.split('.').pop() || 'mp4'));
        fetch(fileUrl).then(function(res) { return res.blob(); }).then(function(blob) {
            closeForwardModal();
            enqueueChatPayload({
                sender: chatUser, room: targetRoomId, type: activeMessageType,
                blob: blob, fileName: origName, forwardedFrom: originalAuthor
            });
            loadFriendsAndRequests(true);
        });
    } else {
        closeForwardModal();
        enqueueChatPayload({
            sender: chatUser, room: targetRoomId, type: activeMessageType || 'text',
            text: activeMessageText, forwardedFrom: originalAuthor
        });
        loadFriendsAndRequests(true);
    }
}

function inlineDeleteMessage(msgId) {
    if (!confirm("Удалить это сообщение?")) return;
    fetch('/api/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: currentRoomId, messageId: msgId })
    }).then(function() {
        var existingRow = document.querySelector('.message-row[data-msg-id="' + msgId + '"]');
        if (existingRow) existingRow.remove();
        renderedMsgIds.delete(msgId);
    });
}

function fetchMessages() {
    chatUser = getActiveChatIdentity();
    var mDiv = getMessagesDiv();
    if (!chatUser || !currentRoomId || !mDiv || isFetchingMessages) return;
    var requestedRoom = currentRoomId;
    var modal = document.getElementById('messenger-modal');
    var isModalOpen = modal && modal.style.display === 'flex';

    if (renderedMsgIds.size === 0) {
        try {
            var rawRoomCache = localStorage.getItem('msb_cache_room_' + requestedRoom);
            var cachedMsgs = rawRoomCache ? JSON.parse(rawRoomCache) : new Array();
            if (Array.isArray(cachedMsgs) && cachedMsgs.length > 0) {
                var phInit = mDiv.querySelector('.chat-placeholder');
                if (phInit) phInit.remove();
                var fragC = document.createDocumentFragment();
                cachedMsgs.forEach(function(msg) {
                    var isMyInit = String(msg.sender || '').trim().toLowerCase() === String(chatUser || '').trim().toLowerCase();
                    var checkInit = isMyInit
                        ? (msg.read
                            ? ' <span class="msg-check" style="color:#38bdf8;font-weight:900;margin-left:5px;font-size:13px;" title="Прочитано">✓✓</span>'
                            : ' <span class="msg-check" style="color:rgba(255,255,255,0.6);font-weight:bold;margin-left:5px;font-size:13px;" title="Доставлено">✓</span>')
                        : '';
                    renderedMsgIds.add(msg.id);
                    renderSingleRow(fragC, msg, isMyInit, checkInit);
                });
                mDiv.appendChild(fragC);
                lastMessagesCount = cachedMsgs.length;
                mDiv.scrollTop = mDiv.scrollHeight;
            }
        } catch (e) {}
    }

    isFetchingMessages = true;
    msgFetchAbortCtrl = new AbortController();
    fetch('/api/messages?room=' + encodeURIComponent(requestedRoom) + '&user=' + encodeURIComponent(chatUser) + '&t=' + Date.now(), {
        signal: msgFetchAbortCtrl.signal
    })
    .then(function(res) { return res.json(); })
    .then(function(resp) {
        isFetchingMessages = false;
        if (requestedRoom !== currentRoomId) return;
        var data = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.messages) ? resp.messages : new Array());
        try { localStorage.setItem('msb_cache_room_' + requestedRoom, JSON.stringify(data)); } catch (e) {}
        var partnerOnline = (resp && typeof resp.partnerOnline === 'boolean') ? resp.partnerOnline : false;
        if (resp && typeof resp.partnerLastSeen === 'string' && resp.partnerLastSeen) partnerLastSeenCache = resp.partnerLastSeen;
        var typingUsers = (resp && Array.isArray(resp.typingUsers)) ? resp.typingUsers : new Array();
        if (currentPartner) renderPartnerPresenceHeader(partnerOnline, partnerLastSeenCache, typingUsers);
        applyMessagesToDOM(mDiv, data, isModalOpen);
    }).catch(function() { isFetchingMessages = false; });
}
function applyMessagesToDOM(mDiv, data, isModalOpen) {
    if (data.length === 0) {
        var hasLocalPending = msbOutboxQueue.some(function(p) { return p && p.room === currentRoomId; });
        if (lastMessagesCount !== 0 && !hasLocalPending) {
            renderedMsgIds.clear();
            lastMessagesCount = 0;
            mDiv.innerHTML = '<div class="chat-placeholder">История сообщений пуста.</div>';
        }
        renderPendingBubbles();
        return;
    }
    var placeholder = mDiv.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();
    var serverIds = new Set(data.map(function(m) { return m.id; }));
    renderedMsgIds.forEach(function(id) {
        if (!serverIds.has(id)) {
            var el = mDiv.querySelector('.message-row[data-msg-id="' + id + '"]');
            if (el) el.remove();
            renderedMsgIds.delete(id);
        }
    });
    var addedNew = false, hasUnreadIncoming = false;
    var frag = document.createDocumentFragment();
    data.forEach(function(msg) {
        var isMy = String(msg.sender || '').trim().toLowerCase() === String(chatUser || '').trim().toLowerCase();
        if (!isMy && !msg.read) hasUnreadIncoming = true;
        var checkIcon = isMy
            ? (msg.read
                ? ' <span class="msg-check" style="color:#38bdf8;font-weight:900;margin-left:5px;font-size:13px;" title="Прочитано">✓✓</span>'
                : ' <span class="msg-check" style="color:rgba(255,255,255,0.6);font-weight:bold;margin-left:5px;font-size:13px;" title="Доставлено">✓</span>')
            : '';
        if (renderedMsgIds.has(msg.id)) {
            if (isMy) {
                var existingRow = mDiv.querySelector('.message-row[data-msg-id="' + msg.id + '"]');
                if (existingRow) {
                    var timeBox = existingRow.querySelector('.msg-time');
                    var desiredTimeHTML = msg.time + checkIcon;
                    if (timeBox && timeBox.innerHTML !== desiredTimeHTML) timeBox.innerHTML = desiredTimeHTML;
                }
            }
            return;
        }
        renderedMsgIds.add(msg.id);
        addedNew = true;
        renderSingleRow(frag, msg, isMy, checkIcon);
    });
    if (addedNew) mDiv.appendChild(frag);
    lastMessagesCount = data.length;
    renderPendingBubbles();
    if (addedNew) setTimeout(function() { mDiv.scrollTop = mDiv.scrollHeight; }, 30);
    if (isModalOpen && (addedNew || hasUnreadIncoming) && currentPartner) markChatAsRead(currentRoomId);
}

function renderSingleRow(parentContainer, msg, isMy, checkIcon) {
    if (msg.clientMsgId) {
        var mDivReal = getMessagesDiv();
        if (mDivReal) {
            var tempDup = mDivReal.querySelector('.msb-pending-row[data-lid="' + msg.clientMsgId + '"]');
            if (tempDup) tempDup.remove();
        }
        msbOutboxQueue = msbOutboxQueue.filter(function(item) { return item && item.lid !== msg.clientMsgId; });
        saveTextOutboxToStorage();
    }
    var row = document.createElement('div');
    row.className = 'message-row ' + (isMy ? 'my-msg' : 'other-msg');
    row.setAttribute('data-msg-id', msg.id);
    if (msg.clientMsgId) row.setAttribute('data-client-id', msg.clientMsgId);
    row.innerHTML = '<div class="swipe-indicator left-indicator">💬</div><div class="swipe-container"><div class="bubble"></div></div><div class="swipe-indicator right-indicator">↪️</div>';
    var bubble = row.querySelector('.bubble');
    var quoteHTML = (msg.quoteId && msg.quoteText) ? ('<div class="msg-quote-block"><div class="msg-quote-author">' + escapeEdgeHtml(msg.quoteSender || 'Система') + '</div>' + escapeEdgeHtml(msg.quoteText) + '</div>') : '';
    var forwardHTML = msg.forwardedFrom ? ('<div class="msg-forwarded-label">↪ Переслано от: ' + escapeEdgeHtml(msg.forwardedFrom) + '</div>') : '';
    var authorHTML = (isCurrentGroup && !isMy) ? ('<div class="msg-author">' + escapeEdgeHtml(msg.sender) + '</div>') : '';
    var delBtnHTML = '<button class="msg-del-inline-btn" onclick="inlineDeleteMessage(\'' + msg.id + '\')">&times;</button>';
    var contentHTML = '';
    if (msg.type === 'audio') {
        contentHTML = '<audio class="audio-player" src="' + msg.text + '" controls preload="none" style="display:block; max-width:100%;"></audio>';
    } else if (msg.type === 'video') {
        contentHTML = '<video class="video-round" src="' + msg.text + '#t=0.001" playsinline muted loop preload="metadata" style="display:block;" onclick="playVideoWithSound(this)"></video>';
    } else if (msg.type === 'gif') {
        contentHTML = '<img class="chat-image" src="' + msg.text + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'🎬 GIF\')">';
    } else if (msg.type === 'file') {
        try {
            var fileObj = JSON.parse(msg.text);
            var ext = fileObj.name.split('.').pop().toLowerCase();
            if (Array.of('jpg', 'jpeg', 'png', 'gif', 'webp').includes(ext)) {
                contentHTML = '<img class="chat-image" src="' + fileObj.path + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'📷 Фото\')">';
            } else {
                contentHTML = '<a href="' + fileObj.path + '" target="_blank" class="chat-file-card"><span class="chat-file-icon">📄</span><div class="chat-file-info"><span class="chat-file-name">' + escapeEdgeHtml(fileObj.name) + '</span><span class="chat-file-action">Скачать</span></div></a>';
            }
        } catch (e) { contentHTML = '<div class="msg-text">Поврежденный файл</div>'; }
    } else {
        contentHTML = '<div class="msg-text">' + escapeEdgeHtml(msg.text) + '</div>';
    }
    bubble.innerHTML = delBtnHTML + quoteHTML + forwardHTML + authorHTML + contentHTML + '<div class="msg-time">' + msg.time + checkIcon + '</div>';
    parentContainer.appendChild(row);
    setupSwipe(row, msg.id, msg.text, msg.type, msg.sender);
}

function playVideoWithSound(v) {
    document.querySelectorAll('#messages video.video-round').forEach(function(other) {
        if (other !== v) { other.muted = true; other.pause(); }
    });
    if (!v.paused && !v.muted) { v.muted = true; v.pause(); }
    else { v.muted = false; v.loop = false; v.currentTime = 0; v.play().catch(function() {}); v.onended = function() { v.muted = true; v.pause(); v.currentTime = 0; }; }
}

function sendFriendRequest() {
    chatUser = getActiveChatIdentity();
    var input = document.getElementById('new-friend-name');
    if (!input) return;
    var targetName = input.value.trim();
    if (!targetName || !chatUser) return alert('Введите позывной!');
    if (targetName.toLowerCase() === chatUser.toLowerCase()) return alert('Нельзя добавить самого себя!');
    fetch('/api/friends/request/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: chatUser, to: targetName }) })
        .then(function(res) { return res.json(); }).then(function(data) {
            if (data && data.success) { input.value = ''; alert('✅ Заявка отправлена: ' + targetName); loadFriendsAndRequests(true); }
            else alert('❌ ' + (data && data.message ? data.message : 'Ошибка'));
        }).catch(function() { alert('❌ Ошибка связи'); });
}

function handleRequest(fromUser, action) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !fromUser) return;
    fetch('/api/friends/request/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: chatUser, from: fromUser, action: action }) })
        .then(function() { loadFriendsAndRequests(true); }).catch(function() {});
}

function updateTotalUnreadBadge() {
    var badge = document.getElementById('msg-unread-total');
    if (!badge) return;
    var total = 0;
    if (Array.isArray(friendsList)) friendsList.forEach(function(f) { if (f && f.unread > 0) total += f.unread; });
    if (Array.isArray(friendRequests)) total += friendRequests.length;
    badge.style.display = total > 0 ? 'inline-block' : 'none';
    if (total > 0) badge.innerText = total;
}

window.addEventListener('online', function() { clearNetworkErrorBanner(); flushOutboxQueue(); if (currentRoomId) { fetchMessages(); markChatAsRead(currentRoomId); } });
setInterval(function() { if (msbOutboxQueue.length > 0) flushOutboxQueue(); }, 3500);

window.selectChat = selectChat; window.closeChatMobile = closeChatMobile; window.sendMessage = sendMessage;
window.toggleVoiceRecord = toggleVoiceRecord; window.toggleVideoRecord = toggleVideoRecord; window.uploadAnyFile = uploadAnyFile;
window.uploadMyAvatar = uploadMyAvatar; window.deleteFriend = deleteFriend; window.openCreateGroupModal = openCreateGroupModal;
window.closeGroupModal = closeGroupModal; window.submitCreateGroup = submitCreateGroup; window.sendFriendRequest = sendFriendRequest;
window.handleRequest = handleRequest; window.closeForwardModal = closeForwardModal; window.cancelReply = cancelReply;
window.inlineDeleteMessage = inlineDeleteMessage; window.playVideoWithSound = playVideoWithSound; window.syncMessengerAuth = syncMessengerAuth;
window.flushRetryQueue = flushRetryQueue;
