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
var activeUserTypers = {};

function normalizeRoomKey(r) {
    return String(r || '').trim().toLowerCase();
}

function isSameDirectOrRoom(roomA, roomB) {
    var a = normalizeRoomKey(roomA);
    var b = normalizeRoomKey(roomB);
    if (!a || !b) return false;
    if (a === b) return true;
    var baseA = a.split('_')[0];
    var baseB = b.split('_')[0];
    return Boolean(baseA && baseB && baseA === baseB);
}

var typingCleanupTimers = {};


function getActiveTypersForRoom(roomId, partnerName) {
    var result = new Array();
    var now = Date.now();
    var me = String(getActiveChatIdentity() || '').trim().toLowerCase();

    if (roomId && activeRoomTypers[roomId]) {
        Object.keys(activeRoomTypers[roomId]).forEach(function(u) {
            if (now - activeRoomTypers[roomId][u] < 5000) {
                if (u.toLowerCase() !== me && !result.includes(u)) result.push(u);
            } else {
                delete activeRoomTypers[roomId][u];
            }
        });
    }

    Object.keys(activeRoomTypers).forEach(function(rKey) {
        if (isSameDirectOrRoom(rKey, roomId)) {
            Object.keys(activeRoomTypers[rKey]).forEach(function(u) {
                if (now - activeRoomTypers[rKey][u] < 5000) {
                    if (u.toLowerCase() !== me && !result.includes(u)) result.push(u);
                } else {
                    delete activeRoomTypers[rKey][u];
                }
            });
        }
    });

    if (partnerName) {
        var pLow = String(partnerName).trim().toLowerCase();
        Object.keys(activeUserTypers).forEach(function(u) {
            var info = activeUserTypers[u];
            if (info && (now - info.ts < 5000)) {
                if (u.toLowerCase() === pLow) {
                    if (!result.includes(u)) result.push(u);
                }
            } else {
                delete activeUserTypers[u];
            }
        });
    }

    return result;
}

function renderPartnerPresenceHeader(partnerOnline, partnerLastSeen, typingUsersList) {
    var stEl = document.getElementById('chat-status');
    if (!stEl || !currentRoomId) return;
    stEl.style.display = 'block';

    var typers = Array.isArray(typingUsersList) ? typingUsersList.slice() : new Array();
    getActiveTypersForRoom(currentRoomId, isCurrentGroup ? '' : currentPartner).forEach(function(u) {
        if (!typers.includes(u)) typers.push(u);
    });

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

window.handlePresenceUpdateWS = function(msg) {
    if (!msg || !msg.user) return;
    var uLow = String(msg.user).trim().toLowerCase();
    var isOnline = Boolean(msg.online);
    var seenStr = msg.lastSeen || '';
    var updated = false;

    friendsList.forEach(function(f) {
        if (!f.isGroup && String(f.name || '').trim().toLowerCase() === uLow) {
            f.online = isOnline;
            if (seenStr) f.lastSeen = seenStr;
            updated = true;
        }
    });

    if (typeof myMessengerFriends !== 'undefined' && Array.isArray(myMessengerFriends)) {
        myMessengerFriends.forEach(function(f) {
            if (!f.isGroup && String(f.name || '').trim().toLowerCase() === uLow) {
                f.online = isOnline;
                if (seenStr) f.lastSeen = seenStr;
            }
        });
    }

    lastFriendsRenderSig = '';
    if (updated) {
        renderFriends();
        if (typeof populateTargetSelect === 'function') populateTargetSelect();
    }

    if (currentRoomId && !isCurrentGroup && currentPartner && currentPartner.trim().toLowerCase() === uLow) {
        if (seenStr) partnerLastSeenCache = seenStr;
        renderPartnerPresenceHeader(isOnline, partnerLastSeenCache, null);
    }
};

window.handleIncomingTypingWS = function(msg) {
    if (!msg || !msg.user) return;
    var me = String(getActiveChatIdentity() || '').trim().toLowerCase();
    var senderLow = String(msg.user).trim().toLowerCase();
    if (!senderLow || senderLow === me) return;

    friendsList.forEach(function(f) {
        if (!f.isGroup && String(f.name || '').trim().toLowerCase() === senderLow) {
            f.online = true;
        }
    });

    var roomKey = msg.room || makeDirectRoomId(me, msg.user);

    if (!activeRoomTypers[roomKey]) activeRoomTypers[roomKey] = {};

    if (typingCleanupTimers[senderLow]) {
        clearTimeout(typingCleanupTimers[senderLow]);
        delete typingCleanupTimers[senderLow];
    }

    if (msg.typing) {
        activeRoomTypers[roomKey][msg.user] = Date.now();
        activeUserTypers[msg.user] = { room: roomKey, ts: Date.now() };
    } else {
        delete activeRoomTypers[roomKey][msg.user];
        delete activeUserTypers[msg.user];
        Object.keys(activeRoomTypers).forEach(function(rk) {
            if (activeRoomTypers[rk][msg.user]) delete activeRoomTypers[rk][msg.user];
        });
    }

    lastFriendsRenderSig = '';
    renderFriends();

    if (currentRoomId && (isSameDirectOrRoom(currentRoomId, roomKey) || (!isCurrentGroup && currentPartner && currentPartner.toLowerCase() === senderLow))) {
        var fObj = friendsList.find(function(f) {
            return !f.isGroup && currentPartner && f.name.toLowerCase() === currentPartner.toLowerCase();
        });
        renderPartnerPresenceHeader(fObj ? fObj.online : true, partnerLastSeenCache, null);
    }

    if (msg.typing) {
        typingCleanupTimers[senderLow] = setTimeout(function() {
            delete activeUserTypers[msg.user];
            Object.keys(activeRoomTypers).forEach(function(rk) {
                if (activeRoomTypers[rk][msg.user]) delete activeRoomTypers[rk][msg.user];
            });
            lastFriendsRenderSig = '';
            renderFriends();
            if (currentRoomId && (isSameDirectOrRoom(currentRoomId, roomKey) || (!isCurrentGroup && currentPartner && currentPartner.toLowerCase() === senderLow))) {
                var fObj2 = friendsList.find(function(f) {
                    return !f.isGroup && currentPartner && f.name.toLowerCase() === currentPartner.toLowerCase();
                });
                renderPartnerPresenceHeader(fObj2 ? fObj2.online : false, partnerLastSeenCache, null);
            }
        }, 5100);
    }
};


function notifyServerTyping(isTyping) {
    var me = getActiveChatIdentity();
    if (!me || !currentRoomId) return;
    var now = Date.now();
    if (isTyping && myLastTypingSentAt > 0 && (now - myLastTypingSentAt < 1200)) return;
    myLastTypingSentAt = isTyping ? now : 0;


    var payload = {
        type: 'chat_typing',
        user: me,
        to: !isCurrentGroup ? currentPartner : '',
        room: currentRoomId,
        typing: Boolean(isTyping)
    };

    if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(payload));
        } catch (e) {}
        return;
    }

    fetch('/api/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(function() {});
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
                var arrC = JSON.parse(rawC).filter(function(m) {
                    return m.id !== packet.messageId;
                });
                localStorage.setItem(
                    'msb_cache_room_' + packet.room,
                    JSON.stringify(arrC)
                );
            }
        } catch (e) {}
        if (currentRoomId === packet.room) {
            var selDel = '.message-row[data-msg-id="' + packet.messageId + '"]';
            var rowDel = document.querySelector(selDel);
            if (rowDel) rowDel.remove();
            renderedMsgIds.delete(packet.messageId);
        }
        loadFriendsAndRequests(true);
        return;
    }

    if (packet.type === 'chat_msg_edited' && packet.room && packet.messageId) {
        try {
            var rawE = localStorage.getItem('msb_cache_room_' + packet.room);
            if (rawE) {
                var arrE = JSON.parse(rawE);
                arrE.forEach(function(m) {
                    if (m.id === packet.messageId) {
                        m.text = packet.text;
                        m.edited = true;
                    }
                });
                localStorage.setItem(
                    'msb_cache_room_' + packet.room,
                    JSON.stringify(arrE)
                );
            }
        } catch (e) {}
        if (currentRoomId === packet.room) {
            var selEd = '.message-row[data-msg-id="' + packet.messageId + '"]';
            var rowEd = document.querySelector(selEd);
            if (rowEd) {
                var txtEl = rowEd.querySelector('.msg-text');
                if (txtEl) txtEl.textContent = packet.text;
                var timeEl = rowEd.querySelector('.msg-time');
                if (timeEl && timeEl.textContent.indexOf('изм.') === -1) {
                    var badge = '<span class="msg-edited-tag">(изм.)</span>';
                    timeEl.insertAdjacentHTML('afterbegin', badge);
                }
            }
        }
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
        if (msg.sender) {
            var senderClean = String(msg.sender).trim().toLowerCase();
            var isMsgFromMe = senderClean === chatUser.toLowerCase();
            friendsList.forEach(function(f) {
                if (!f.isGroup && String(f.name || '').trim().toLowerCase() === senderClean) {
                    f.online = true;
                }
            });
            delete activeUserTypers[msg.sender];

            Object.keys(activeRoomTypers).forEach(function(rk) {
                if (activeRoomTypers[rk][msg.sender]) delete activeRoomTypers[rk][msg.sender];
            });
            lastFriendsRenderSig = '';
            renderFriends();
            if (!isMsgFromMe && currentRoomId && isSameDirectOrRoom(currentRoomId, packet.room)) {
                renderPartnerPresenceHeader(true, partnerLastSeenCache, null);
            }
        }

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
    topbar.innerHTML = [
        '<div class="msb-profile-pill" onclick="openUserProfileModal()" style="cursor:pointer;">',
        '<div id="my-avatar" class="avatar msb-top-avatar">МС</div>',
        '<div class="msb-profile-meta">',
        '<span id="msg-my-name" class="msb-profile-callsign">Боец</span>',
        '<span class="msb-avatar-edit-link">👤 Профиль</span>',
        '</div>',
        '</div>',
        '<button type="button" class="msb-work-top-btn" onclick="openWorkWorkspaceFromMessenger()">',
        '📊 Работа',
        '</button>'
    ].join('');

    modal.insertBefore(topbar, modal.firstChild);
}

function openUserProfileModal() {
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;
    var modal = document.getElementById('msb-user-profile-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'msb-user-profile-modal';
        modal.className = 'custom-modal-overlay';
        modal.style.zIndex = '220000';
        modal.innerHTML = [
            '<div class="login-box msb-themed-card msb-profile-extended-card">',
            '<div class="msb-profile-modal-head">',
            '<h3 class="msb-themed-title" style="margin:0;">👤 Профиль бойца</h3>',
            '<button type="button" class="modal-close" onclick="closeUserProfileModal()">&times;</button>',
            '</div>',
            '<div class="msb-profile-header-row">',
            '<div id="profile-modal-avatar" class="avatar msb-themed-avatar" ',
            'style="width:68px;height:68px;border-radius:50%;font-size:20px;flex-shrink:0;" ',
            'onclick="openAvatarInViewer(this, chatUser)"></div>',
            '<div style="text-align:left; min-width:0; flex:1;">',
            '<div id="profile-modal-name" class="msb-themed-subname" style="margin-bottom:6px;"></div>',
            '<div style="display:flex; gap:6px; flex-wrap:wrap;">',
            '<button type="button" class="msb-themed-btn msb-mini-prof-btn" ',
            'onclick="document.getElementById(\'msb-top-avatar-file\').click()">📷 Аватар</button>',
            '<button type="button" class="msb-themed-btn-alt msb-mini-prof-btn" ',
            'onclick="closeUserProfileModal(); openPinSetupModal();">🔐 ПИН-код</button>',
            '</div>',
            '</div>',
            '</div>',
            '<input type="file" id="msb-top-avatar-file" accept="image/*" style="display:none;" onchange="uploadMyAvatar(this)">',
            '<button type="button" id="msb-profile-work-toggle-btn" class="msb-work-launch-btn" onclick="toggleWorkSectionInProfile()">',
            '📊 Работа (Журнал событий, Архив, Карты)',
            '</button>',
            '<div id="msb-profile-work-slot" class="msb-profile-work-slot"></div>',
            '<button type="button" class="viewer-btn" style="margin-top:10px;" onclick="closeUserProfileModal()">Закрыть</button>',
            '</div>'
        ].join('');

        modal.onclick = function(e) {
            if (e.target === modal) closeUserProfileModal();
        };
        document.body.appendChild(modal);
    }

    mountJournalBlocksIntoProfile();

    document.getElementById('profile-modal-name').textContent = chatUser;
    var avBox = document.getElementById('profile-modal-avatar');
    renderAvatarElement(avBox, chatUser, getCachedUserAvatar(chatUser, ''));
    modal.style.display = 'flex';
}

function mountJournalBlocksIntoProfile() {
    var slot = document.getElementById('msb-profile-work-slot');
    if (!slot || slot.getAttribute('data-mounted') === '1') return;

    var blocks = [
        document.getElementById('input-panel'),
        document.querySelector('.notifications-window'),
        document.getElementById('journal-table-section'),
        document.querySelector('.history-container')
    ];

    blocks.forEach(function(el) {
        if (el && el.parentElement !== slot) {
            el.style.maxWidth = '100%';
            el.style.marginBottom = '12px';
            slot.appendChild(el);
        }
    });
    slot.setAttribute('data-mounted', '1');
}

function toggleWorkSectionInProfile(forceOpen) {
    mountJournalBlocksIntoProfile();
    var slot = document.getElementById('msb-profile-work-slot');
    var btn = document.getElementById('msb-profile-work-toggle-btn');
    if (!slot) return;
    var isOpen = (typeof forceOpen === 'boolean') ? forceOpen : (slot.style.display !== 'block');
    slot.style.display = isOpen ? 'block' : 'none';
    if (btn) {
        btn.innerHTML = isOpen
            ? '🔽 Свернуть раздел «Работа»'
            : '📊 Работа (Журнал событий, Архив, Карты)';
    }
}

function openWorkWorkspaceFromMessenger() {
    openUserProfileModal();
    toggleWorkSectionInProfile(true);
}

window.toggleWorkSectionInProfile = toggleWorkSectionInProfile;
window.openWorkWorkspaceFromMessenger = openWorkWorkspaceFromMessenger;


function closeUserProfileModal() {
    var m = document.getElementById('msb-user-profile-modal');
    if (m) m.style.display = 'none';
}
window.openUserProfileModal = openUserProfileModal;
window.closeUserProfileModal = closeUserProfileModal;


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
    [tInput, fInput, document.getElementById('login-callsign'), document.getElementById('reg-callsign'), document.getElementById('mini-notif-input')].forEach(function(inp) {
        if (!inp) return;
        inp.setAttribute('lang', 'ru');
        inp.setAttribute('inputmode', 'text');
        inp.setAttribute('autocapitalize', 'sentences');
        inp.setAttribute('autocomplete', 'on');
        inp.setAttribute('autocorrect', 'on');
        inp.setAttribute('spellcheck', 'true');
    });
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
        var rId = f.isGroup ? f.id : makeDirectRoomId(chatUser, f.name);
        var typersCount = getActiveTypersForRoom(rId, f.isGroup ? '' : f.name).length;
        return [
            f.isGroup ? f.id : f.name,
            f.online ? 1 : 0,
            f.unread || 0,
            typersCount,
            f.lastMessage || f.lastMsg || '',
            f.time || f.lastTime || '',
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
        var lastTextVal = friend.lastMessage || friend.lastMsg || '';
        var lastTimeVal = friend.time || friend.lastTime || '';
        var hasUnread = (friend.unread > 0 && !isActive);
        var badgeHTML = hasUnread ? ('<div class="unread-badge">' + friend.unread + '</div>') : '';
        var timeHTML = lastTimeVal ? ('<div class="friend-time-label">' + escapeEdgeHtml(lastTimeVal) + '</div>') : '';
        var unitTag = (!friend.isGroup && friend.unit) ? (' <span class="friend-unit-pill">' + escapeEdgeHtml(friend.unit) + '</span>') : '';
        var groupIcon = friend.isGroup ? '👥 ' : '';
        var displayName = groupIcon + escapeEdgeHtml(friend.name) + unitTag;

        var activeTypers = getActiveTypersForRoom(activeId, friend.isGroup ? '' : friend.name);
        var subLineHTML = '';
        if (activeTypers.length > 0) {
            var typingText = friend.isGroup
                ? ('✍️ ' + escapeEdgeHtml(activeTypers.join(', ')) + ' набирает...')
                : '✍️ набирает сообщение...';
            subLineHTML = '<div class="friend-typing-green">' + typingText + '</div>';
        } else if (lastTextVal) {
            var msgColorStyle = hasUnread ? ' style="color:#4ade80; font-weight:700;"' : '';
            subLineHTML = '<div class="friend-last-msg"' + msgColorStyle + '>' + escapeEdgeHtml(lastTextVal) + '</div>';
        }

        var isOnline = !friend.isGroup && (Boolean(friend.online) || activeTypers.length > 0);
        var dotHTML = !friend.isGroup ? ('<span class="online-dot ' + (isOnline ? 'online' : 'offline') + '"></span>') : '';
        var avClass = 'avatar friend-list-avatar' + (isOnline ? ' friend-avatar-online' : '');
        var avInner = (friend.avatar ? ('<img src="' + friend.avatar + '" alt="av">') : escapeEdgeHtml(friend.name.substring(0, 2).toUpperCase())) + dotHTML;

        var friendDataEscaped = JSON.stringify({
            id: friend.id,
            name: friend.name,
            isGroup: friend.isGroup,
            avatarHash: friend.avatarHash || '',
            online: isOnline,
            lastSeen: friend.lastSeen || ''
        }).replace(/"/g, '&quot;');

        var safeNameJs = String(friend.name || '').replace(/'/g, "\\'");
        var callBtnsHTML =
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Аудиозвонок\', \'' + safeNameJs + '\')" title="Аудиозвонок">📞</button>' +
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Видеозвонок\', \'' + safeNameJs + '\')" title="Видеозвонок">🎥</button>';
        var delBtnHTML = '<button class="delete-friend-btn" onclick="deleteFriend(' + friendDataEscaped + ', event)">&times;</button>';
        item.innerHTML =
            '<div class="friend-info">' +
                '<div class="' + avClass + '" onclick="event.stopPropagation(); openAvatarInViewer(this, \'' + safeNameJs + '\')">' + avInner + '</div>' +
                '<div class="friend-meta">' +
                    '<div class="friend-name">' + displayName + '</div>' +
                    subLineHTML +
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

(function initChatRightSwipeToFriends() {
    var touchStartX = 0;
    var touchStartY = 0;
    var isEdgeSwipe = false;

    document.addEventListener('touchstart', function(e) {
        if (window.innerWidth > 768) return;
        var modal = document.getElementById('messenger-modal');
        var sb = document.getElementById('app-sidebar');
        if (!modal || modal.style.display !== 'flex') return;
        if (!sb || !sb.classList.contains('hidden')) return;

        var t = e.touches.item(0);
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        var isOnBubble = e.target && e.target.closest && e.target.closest('.swipe-container');
        isEdgeSwipe = (touchStartX <= 55) || !isOnBubble;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!isEdgeSwipe || window.innerWidth > 768) return;
        isEdgeSwipe = false;

        var t = e.changedTouches.item(0);
        var diffX = t.clientX - touchStartX;
        var diffY = Math.abs(t.clientY - touchStartY);

        if (diffX > 75 && diffY < 60) {
            closeChatMobile();
        }
    }, { passive: true });
})();


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

var editingMessageId = null;

function sendMessage() {
    chatUser = getActiveChatIdentity();
    var textInput = document.getElementById('text-input');
    if (!textInput) return;
    var text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;

    if (editingMessageId) {
        var editId = editingMessageId;
        editingMessageId = null;
        textInput.value = '';
        cancelReply();
        fetch('/api/messages/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room: currentRoomId,
                messageId: editId,
                text: text
            })
        });
        return;
    }

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
    editingMessageId = null;
    quotedMessageId = null;
    quotedMessageText = null;
    quotedMessageSender = null;
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
    var editedBadge = msg.edited
        ? '<span class="msg-edited-tag">(изм.)</span>'
        : '';
    var timeBlock = '<div class="msg-time">' +
        editedBadge + msg.time + checkIcon +
        '</div>';
    bubble.innerHTML = delBtnHTML + quoteHTML + forwardHTML +
        authorHTML + contentHTML + timeBlock;
    parentContainer.appendChild(row);
    setupSwipe(row, msg.id, msg.text, msg.type, msg.sender);
    attachLongPressActions(row, msg, isMy);
}

function copyTextUniversal(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function() {});
    } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }
}

function attachLongPressActions(rowEl, msg, isMy) {
    var bubble = rowEl.querySelector('.bubble');
    if (!bubble) return;
    var pressTimer = null;
    var startX = 0;
    var startY = 0;

    function triggerHold() {
        if (navigator.vibrate) navigator.vibrate(45);
        var txtNode = rowEl.querySelector('.msg-text');
        var actualText = txtNode ? txtNode.textContent : (msg.text || '');
        if (msg.type === 'text' && actualText) {
            copyTextUniversal(actualText);
        }
        openMessageActionSheet(msg.id, actualText, msg.type, isMy);
    }

    bubble.addEventListener('touchstart', function(e) {
        var t = e.touches.item(0);
        startX = t.clientX;
        startY = t.clientY;
        pressTimer = setTimeout(triggerHold, 520);
    }, { passive: true });

    bubble.addEventListener('touchmove', function(e) {
        if (!pressTimer) return;
        var t = e.touches.item(0);
        var dx = Math.abs(t.clientX - startX);
        var dy = Math.abs(t.clientY - startY);
        if (dx > 10 || dy > 10) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }, { passive: true });

    bubble.addEventListener('touchend', function() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    });

    bubble.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        triggerHold();
    });
}

function openMessageActionSheet(msgId, text, msgType, isMy) {
    var sheet = document.getElementById('msb-msg-action-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'msb-msg-action-sheet';
        sheet.className = 'custom-modal-overlay';
        sheet.style.zIndex = '225000';
        sheet.onclick = function(e) {
            if (e.target === sheet) sheet.style.display = 'none';
        };
        document.body.appendChild(sheet);
    }
    var canEdit = isMy && msgType === 'text';
    var editBtnHtml = canEdit
        ? '<button type="button" id="act-edit-msg-btn" ' +
          'class="msb-themed-btn" style="margin-bottom:8px;">' +
          '✏️ Исправить сообщение</button>'
        : '';

    sheet.innerHTML = [
        '<div class="login-box msb-themed-card" style="max-width:340px;">',
        '<div class="msb-themed-title" style="font-size:14px;">',
        '📋 Текст сразу скопирован в буфер!',
        '</div>',
        editBtnHtml,
        '<button type="button" id="act-copy-msg-btn" ',
        'class="msb-themed-btn-alt" style="margin-bottom:8px;">',
        '📋 Скопировать ещё раз',
        '</button>',
        '<button type="button" class="viewer-btn" id="act-close-msg-btn">',
        'Отмена',
        '</button>',
        '</div>'
    ].join('');

    sheet.style.display = 'flex';

    document.getElementById('act-close-msg-btn').onclick = function() {
        sheet.style.display = 'none';
    };
    document.getElementById('act-copy-msg-btn').onclick = function() {
        copyTextUniversal(text);
        sheet.style.display = 'none';
    };
    if (canEdit) {
        document.getElementById('act-edit-msg-btn').onclick = function() {
            sheet.style.display = 'none';
            startEditingMessage(msgId, text);
        };
    }
}

function startEditingMessage(msgId, oldText) {
    editingMessageId = msgId;
    var bar = document.getElementById('reply-bar');
    var textEl = document.getElementById('reply-bar-text');
    var input = document.getElementById('text-input');
    if (textEl) textEl.textContent = '✏️ Исправление: ' + oldText;
    if (bar) bar.style.display = 'flex';
    if (input) {
        input.value = oldText;
        input.focus();
    }
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
var msbExtraClockTimer = null;
var msbToolbarExpanded = false;

function buildAnimatedRadialToolsRow() {
    var toolsRow = document.querySelector('#messenger-modal .tools-row');
    if (!toolsRow || toolsRow.getAttribute('data-msb-radial') === '1') return;
    toolsRow.setAttribute('data-msb-radial', '1');
    toolsRow.classList.add('msb-radial-tools-row');

    var fileInput = toolsRow.querySelector('input[type="file"]');

    toolsRow.innerHTML =
        '<div class="msb-wing msb-wing-left" id="msb-wing-left">' +
            '<button type="button" id="video-btn" class="media-btn" onclick="toggleVideoRecord()" title="Видео-кружок">🎥</button>' +
            '<button type="button" class="media-btn" onclick="document.getElementById(\'msb-radial-file-input\').click()" title="Прикрепить файл">📎</button>' +
            '<button type="button" id="voice-btn" class="media-btn" onclick="toggleVoiceRecord()" title="Голосовое сообщение">🎙️</button>' +
        '</div>' +
        '<button type="button" id="msb-center-toggle-btn" class="media-btn gif-btn-wide msb-center-plus-btn" onclick="toggleMsbRadialToolbar()" title="Инструменты">➕</button>' +
        '<div class="msb-wing msb-wing-right" id="msb-wing-right">' +
            '<button type="button" class="media-btn" onclick="triggerCallInDev(\'Аудиозвонок\', currentPartner || \'\')" title="Аудиозвонок">📞</button>' +
            '<button type="button" class="media-btn" onclick="openThemeSettingsModal()" title="Темы и Гифки">🎨</button>' +
            '<button type="button" id="msb-plus-menu-btn" class="media-btn" onclick="event.stopPropagation(); toggleMsbPlusDropdown()" title="Разделы МСБ-55115">➕</button>' +
        '</div>';

    if (fileInput) {
        fileInput.id = 'msb-radial-file-input';
        toolsRow.appendChild(fileInput);
    } else {
        var newFile = document.createElement('input');
        newFile.type = 'file';
        newFile.id = 'msb-radial-file-input';
        newFile.style.display = 'none';
        newFile.onchange = function() { uploadAnyFile(this); };
        toolsRow.appendChild(newFile);
    }
}

function toggleMsbRadialToolbar(forceState) {
    buildAnimatedRadialToolsRow();
    var toolsRow = document.querySelector('#messenger-modal .tools-row');
    var centerBtn = document.getElementById('msb-center-toggle-btn');
    var drop = document.getElementById('msb-plus-dropdown');
    if (!toolsRow || !centerBtn) return;

    msbToolbarExpanded = (typeof forceState === 'boolean') ? forceState : !msbToolbarExpanded;
    toolsRow.classList.toggle('expanded', msbToolbarExpanded);
    centerBtn.classList.toggle('active', msbToolbarExpanded);
    centerBtn.textContent = msbToolbarExpanded ? '✖' : '➕';

    if (!msbToolbarExpanded && drop) {
        drop.classList.remove('open');
    }
}

function ensureMessengerExtraHub() {
    buildAnimatedRadialToolsRow();

    if (!document.getElementById('msb-plus-dropdown')) {
        var inputContainer = document.querySelector('#messenger-modal .input-container');
        if (inputContainer) {
            inputContainer.style.position = 'relative';
            var drop = document.createElement('div');
            drop.id = 'msb-plus-dropdown';
            drop.className = 'msb-plus-dropdown';
            drop.innerHTML =
                '<div class="msb-plus-item" onclick="openMsbDevTab(\'📡 Каналы\')"><span>📡</span><span>Каналы</span></div>' +
                '<div class="msb-plus-item" onclick="openMsbDevTab(\'⭐ Избранное\')"><span>⭐</span><span>Избранное</span></div>' +
                '<div class="msb-plus-item" onclick="openMsbDevTab(\'🆕 Новое\')"><span>🆕</span><span>Новое</span></div>' +
                '<div class="msb-plus-item" onclick="openMsbDevTab(\'👤 Личное\')"><span>👤</span><span>Личное</span></div>' +
                '<div class="msb-plus-item" onclick="openMsbDevTab(\'💳 Кошелек\')"><span>💳</span><span>Кошелек</span></div>';
            inputContainer.appendChild(drop);
        }
    }

    if (!document.getElementById('msb-dev-tab-modal')) {
        var modal = document.createElement('div');
        modal.id = 'msb-dev-tab-modal';
        modal.className = 'custom-modal-overlay';
        modal.style.zIndex = '230000';
        modal.innerHTML =
            '<div class="msb-dev-tab-card">' +
                '<div class="msb-dev-tab-header">' +
                    '<span id="msb-dev-tab-title">Раздел</span>' +
                    '<button type="button" class="modal-close" onclick="closeMsbDevTab()">&times;</button>' +
                '</div>' +
                '<div class="msb-dev-clock-box">' +
                    '<div id="msb-dev-live-clock" class="msb-dev-clock-time">00:00:00</div>' +
                    '<div id="msb-dev-live-date" class="msb-dev-clock-date">—</div>' +
                '</div>' +
                '<div class="msb-dev-status-text">в разработке МСБ55115</div>' +
                '<button type="button" class="alert-btn" style="margin-top:16px;" onclick="closeMsbDevTab()">ЗАКРЫТЬ</button>' +
            '</div>';
        modal.onclick = function(e) {
            if (e.target === modal) closeMsbDevTab();
        };
        document.body.appendChild(modal);
    }
}

function toggleMsbPlusDropdown() {
    ensureMessengerExtraHub();
    var drop = document.getElementById('msb-plus-dropdown');
    if (!drop) return;
    var isOpen = drop.classList.contains('open');
    drop.classList.toggle('open', !isOpen);
}

function updateMsbDevClock() {
    var clockEl = document.getElementById('msb-dev-live-clock');
    var dateEl = document.getElementById('msb-dev-live-date');
    if (!clockEl) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = hh + ':' + mm + ':' + ss;
    if (dateEl) {
        var dd = String(now.getDate()).padStart(2, '0');
        var mon = String(now.getMonth() + 1).padStart(2, '0');
        var yyyy = now.getFullYear();
        dateEl.textContent = dd + '.' + mon + '.' + yyyy;
    }
}

function openMsbDevTab(tabTitle) {
    ensureMessengerExtraHub();
    var drop = document.getElementById('msb-plus-dropdown');
    if (drop) drop.classList.remove('open');

    var titleEl = document.getElementById('msb-dev-tab-title');
    var modal = document.getElementById('msb-dev-tab-modal');
    if (titleEl) titleEl.textContent = tabTitle;
    updateMsbDevClock();
    if (msbExtraClockTimer) clearInterval(msbExtraClockTimer);
    msbExtraClockTimer = setInterval(updateMsbDevClock, 1000);
    if (modal) modal.style.display = 'flex';
}

function closeMsbDevTab() {
    var modal = document.getElementById('msb-dev-tab-modal');
    if (modal) modal.style.display = 'none';
    if (msbExtraClockTimer) {
        clearInterval(msbExtraClockTimer);
        msbExtraClockTimer = null;
    }
}

document.addEventListener('click', function(e) {
    var drop = document.getElementById('msb-plus-dropdown');
    var btn = document.getElementById('msb-plus-menu-btn');
    if (drop && drop.classList.contains('open')) {
        if (!drop.contains(e.target) && e.target !== btn) {
            drop.classList.remove('open');
        }
    }
});

document.addEventListener('DOMContentLoaded', ensureMessengerExtraHub);
setTimeout(ensureMessengerExtraHub, 250);

window.toggleMsbRadialToolbar = toggleMsbRadialToolbar;
window.openMsbDevTab = openMsbDevTab;
window.closeMsbDevTab = closeMsbDevTab;
window.toggleMsbPlusDropdown = toggleMsbPlusDropdown;