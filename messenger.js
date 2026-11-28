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

    if (packet.type === 'room_history' && packet.room && Array.isArray(packet.messages)) {
        var rLow = String(packet.room).trim().toLowerCase();
        if (currentRoomId && String(currentRoomId).trim().toLowerCase() === rLow) {
            var mDivH = getMessagesDiv();
            var modalH = document.getElementById('messenger-modal');
            var isOpenH = modalH && modalH.style.display === 'flex';
            if (mDivH) applyMessagesToDOM(mDivH, packet.messages, isOpenH);
        }
        return;
    }


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
                rowEd.setAttribute('data-raw-text', String(packet.text || ''));
                var txtEl = rowEd.querySelector('.msg-text');
                if (txtEl) txtEl.innerHTML = renderMessageTextWithLiveEmojis(packet.text);

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

        // Если открыт другой чат на активном экране — даём только мягкий звук (сам пуш в шторку пришлёт сервер 1 раз!)
        var isFromOther = String(msg.sender || '').trim().toLowerCase() !== chatUser.toLowerCase();
        var isWatchingThisChat = isModalOpen && (currentRoomId === packet.room) && (document.visibilityState === 'visible');
        if (isFromOther && !isWatchingThisChat && document.visibilityState === 'visible') {
            if (typeof playSoundById === 'function' && !window.MsbNative) {
                playSoundById('nice1', true);
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
        '<button type="button" id="msb-top-back-btn" class="msb-unified-back-btn" onclick="handleUnifiedMessengerBack()">',
        '<span class="back-arrow-icon">‹</span><span>Назад</span>',
        '</button>',
        '<div class="msb-profile-pill" onclick="openUserProfileModal()" style="cursor:pointer;">',
        '<div id="my-avatar" class="avatar msb-top-avatar">МС</div>',
        '<div class="msb-profile-meta">',
        '<span id="msg-my-name" class="msb-profile-callsign">Боец</span>',
        '<span class="msb-avatar-edit-link">👤 Профиль</span>',
        '</div>',
        '</div>'
    ].join('');

    modal.insertBefore(topbar, modal.firstChild);
    updateTopBackButtonVisibility();
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
            '<div class="login-box msb-themed-card" style="max-width:350px;">',
            '<h3 class="msb-themed-title">👤 Профиль бойца</h3>',
            '<div id="profile-modal-avatar" class="avatar msb-themed-avatar" ',
            'style="width:76px;height:76px;border-radius:50%;margin:0 auto 10px;font-size:22px;" ',
            'onclick="openAvatarInViewer(this, chatUser)"></div>',
            '<div id="profile-modal-name" class="msb-themed-subname"></div>',
            '<button type="button" class="msb-themed-btn" style="margin-bottom:10px;" ',
            'onclick="document.getElementById(\'msb-top-avatar-file\').click()">',
            '📷 Сменить аватарку',
            '</button>',
            '<input type="file" id="msb-top-avatar-file" accept="image/*" style="display:none;" onchange="uploadMyAvatar(this)">',
            '<button type="button" class="msb-themed-btn-alt" style="margin-bottom:10px;" ',
            'onclick="closeUserProfileModal(); openPinSetupModal();">',
            '🔐 Создать ПИН-код',
            '</button>',
            '<button type="button" class="msb-themed-btn" style="margin-bottom:10px;" ',
            'onclick="openWorkNewWindow()">',
            '📊 Работа',
            '</button>',
            '<button type="button" id="msb-profile-dl-apk-btn" class="msb-themed-btn-alt" style="margin-bottom:10px;" ',
            'onclick="downloadMsbApkDirect()">',
            '📥 Скачать и установить APK',
            '</button>',
            '<button type="button" id="msb-admin-upload-apk-btn" class="msb-themed-btn" ',
            'style="display:none; margin-bottom:10px; background:linear-gradient(135deg,#dc2626,#991b1b)!important; border-color:#f87171!important;" ',
            'onclick="document.getElementById(\'msb-admin-apk-input\').click()">',
            '📤 Загрузить APK файл для всех',
            '</button>',
            '<button type="button" id="msb-admin-clear-chats-btn" class="msb-themed-btn" ',
            'style="display:none; margin-bottom:10px; background:linear-gradient(135deg,#991b1b,#450a0a)!important; border-color:#ef4444!important;" ',
            'onclick="adminClearAllChatsEverywhere()">',
            '🗑️ Очистить ВСЕ чаты у всех',
            '</button>',
            '<input type="file" id="msb-admin-apk-input" accept=".apk,application/vnd.android.package-archive" ',
            'style="display:none;" onchange="adminUploadApkForAll(this)">',
            '<div id="msb-admin-apk-status" style="display:none; font-size:12px; color:#facc15; font-weight:bold; margin-bottom:8px;"></div>',
            '<button type="button" class="viewer-btn" onclick="closeUserProfileModal()">',
            'Закрыть',
            '</button>',
            '</div>'
        ].join('');

        modal.onclick = function(e) {
            if (e.target === modal) closeUserProfileModal();
        };
        document.body.appendChild(modal);
    }

    var isAdm = (typeof currentUser !== 'undefined' && typeof ADMIN_NAME !== 'undefined' && currentUser === ADMIN_NAME) ||
                (String(chatUser).toLowerCase() === 'муравей');
    var admBtn = document.getElementById('msb-admin-upload-apk-btn');
    if (admBtn) admBtn.style.display = isAdm ? 'block' : 'none';
    var clrBtn = document.getElementById('msb-admin-clear-chats-btn');
    if (clrBtn) clrBtn.style.display = isAdm ? 'block' : 'none';


    document.getElementById('profile-modal-name').textContent = chatUser;
    var avBox = document.getElementById('profile-modal-avatar');
    renderAvatarElement(avBox, chatUser, getCachedUserAvatar(chatUser, ''));
    modal.style.display = 'flex';
}


function openWorkNewWindow() {
    closeUserProfileModal();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {

        document.activeElement.blur();
    }
    toggleTgEmojiDrawer(false);
    toggleMsbRadialToolbar(false);
    var workModal = document.getElementById('msb-work-window-modal');

    if (!workModal) {
        workModal = document.createElement('div');
        workModal.id = 'msb-work-window-modal';
        workModal.className = 'msb-work-fullscreen-modal';
        workModal.innerHTML = [
            '<div class="msb-work-window-header">',
            '<span style="font-weight:900; font-size:16px; color:#f8fafc;">📊 РАБОТА — МСБ-55115</span>',
            '<button type="button" class="msb-work-close-btn" onclick="closeWorkNewWindow()">✖ Закрыть</button>',
            '</div>',
            '<div id="msb-work-window-body" class="msb-work-window-body"></div>'
        ].join('');
        document.body.appendChild(workModal);
    }

    var bodySlot = document.getElementById('msb-work-window-body');
    var blocks = [
        document.getElementById('input-panel'),
        document.querySelector('.notifications-window'),
        document.getElementById('journal-table-section'),
        document.querySelector('.history-container')
    ];

    blocks.forEach(function(el) {
        if (el) {
            el.style.pointerEvents = 'auto';
        }
    });


    blocks.forEach(function(el) {
        if (el && el.parentElement !== bodySlot) {
            el.style.maxWidth = '1400px';
            el.style.margin = '0 auto 16px auto';
            bodySlot.appendChild(el);
        }
    });

    workModal.style.display = 'flex';
}

function closeWorkNewWindow() {
    var workModal = document.getElementById('msb-work-window-modal');
    if (workModal) workModal.style.display = 'none';
}


window.openWorkNewWindow = openWorkNewWindow;
window.closeWorkNewWindow = closeWorkNewWindow;



function closeUserProfileModal() {
    var m = document.getElementById('msb-user-profile-modal');
    if (m) m.style.display = 'none';
}
window.openUserProfileModal = openUserProfileModal;
window.closeUserProfileModal = closeUserProfileModal;
function adminClearAllChatsEverywhere() {
    if (!confirm('⚠️ ВНИМАНИЕ! Удалить ВСЕ сообщения во всех личных чатах и комнатах у ВСЕХ пользователей безвозвратно?')) return;
    if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'clear_all_chats' })); } catch (e) {}
    }
    fetch('/api/admin/clear-all-chats', { method: 'POST' })
        .then(function() {
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
            closeUserProfileModal();
            alert('✅ Все сообщения и кэши чатов полностью очищены у всех пользователей!');
        })
        .catch(function() { alert('❌ Ошибка связи с сервером'); });
}
window.adminClearAllChatsEverywhere = adminClearAllChatsEverywhere;

async function adminUploadApkForAll(inputEl) {
    if (!inputEl || !inputEl.files || inputEl.files.length === 0) return;
    var file = inputEl.files[0];
    var statusEl = document.getElementById('msb-admin-apk-status');
    var btnEl = document.getElementById('msb-admin-upload-apk-btn');

    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#facc15';
        statusEl.textContent = '⏳ Подготовка файла: ' + file.name + '...';
    }
    if (btnEl) btnEl.disabled = true;

    try {
        var chunkSize = 1024 * 1024;
        var totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
        var verCode = Math.floor(Date.now() / 1000);
        var verName = '1.0.' + new Date().toLocaleDateString('ru-RU');

        for (var idx = 0; idx < totalChunks; idx++) {
            var start = idx * chunkSize;
            var end = Math.min(file.size, start + chunkSize);
            var chunkBlob = file.slice(start, end);

            var pct = Math.round(((idx + 1) / totalChunks) * 100);
            if (statusEl) {
                statusEl.textContent = '📤 Загрузка APK на сервер: ' + pct + '% (' + (idx + 1) + '/' + totalChunks + ')';
            }

            var res = await fetch('/api/app/upload-apk-chunk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'x-update-secret': 'msb55115_ota_key',
                    'x-chunk-index': String(idx),
                    'x-total-chunks': String(totalChunks),
                    'x-version-code': String(verCode),
                    'x-version-name': encodeURIComponent(verName)
                },
                body: chunkBlob
            });

            if (!res.ok) {
                throw new Error('Ошибка сервера: HTTP ' + res.status);
            }
        }

        if (statusEl) {
            statusEl.style.color = '#4ade80';
            statusEl.textContent = '✅ APK успешно загружен для всех!';
        }
        alert('✅ Новый APK-файл успешно загружен на сервер и доступен для скачивания всем пользователям!');
    } catch (err) {
        if (statusEl) {
            statusEl.style.color = '#ef4444';
            statusEl.textContent = '❌ Ошибка: ' + (err && err.message ? err.message : 'сбой сети');
        }
        alert('❌ Не удалось загрузить APK: ' + (err && err.message ? err.message : 'ошибка связи'));
    } finally {
        inputEl.value = '';
        if (btnEl) btnEl.disabled = false;
    }
}
window.adminUploadApkForAll = adminUploadApkForAll;


function updateTopBackButtonVisibility() {

    var topbar = document.getElementById('msb-unified-topbar');
    var backBtn = document.getElementById('msb-top-back-btn');
    var sb = document.getElementById('app-sidebar');
    if (!backBtn || !sb) return;
    var isChatOpenOnMobile = (window.innerWidth <= 768) && sb.classList.contains('hidden');
    backBtn.style.display = isChatOpenOnMobile ? 'inline-flex' : 'none';
    if (topbar) {
        topbar.classList.toggle('has-back-btn', isChatOpenOnMobile);
    }
}

function handleUnifiedMessengerBack() {
    if (typeof resetChatArea === 'function') {
        resetChatArea();
    }
    var sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        sidebar.classList.remove('hidden');
    }

    updateTopBackButtonVisibility();
    lastFriendsRenderSig = '';
    loadFriendsAndRequests(true);
}


window.updateTopBackButtonVisibility = updateTopBackButtonVisibility;
window.handleUnifiedMessengerBack = handleUnifiedMessengerBack;


function enqueueChatPayload(payload) {
    if (!payload.lid) {
        payload.lid = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
        if (!payload.blob && (!payload.type || payload.type === 'text' || payload.type === 'gif' || payload.type === 'contact') && payload.room) {

        try {
            var nowD = new Date();
            var tStr = String(nowD.getDate()).padStart(2, '0') + '.' +
                       String(nowD.getMonth() + 1).padStart(2, '0') + '.' +
                       nowD.getFullYear() + ' ' +
                       String(nowD.getHours()).padStart(2, '0') + ':' +
                       String(nowD.getMinutes()).padStart(2, '0');
            var rawCache = localStorage.getItem('msb_cache_room_' + payload.room);
            var arrCache = rawCache ? JSON.parse(rawCache) : [];
            arrCache.push({
                id: payload.lid,
                clientMsgId: payload.lid,
                sender: payload.sender,
                text: payload.text || '',
                type: payload.type || 'text',
                time: tStr,
                timestamp: Date.now(),
                quoteId: payload.quoteId || null,
                quoteText: payload.quoteText || null,
                quoteSender: payload.quoteSender || null
            });
            localStorage.setItem('msb_cache_room_' + payload.room, JSON.stringify(arrCache.slice(-80)));
        } catch (e) {}
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
    if (msbOutboxQueue.length === 0) return;

    var textItems = msbOutboxQueue.filter(function(it) {
        return it && !it.blob && (!it.type || it.type === 'text' || it.type === 'gif' || it.type === 'contact');
    });


    textItems.forEach(function(item) {
        if (item._inFlight && (Date.now() - item._inFlight < 15000)) return;
        item._inFlight = Date.now();

        var payloadObj = {
            clientMsgId: item.lid,
            sender: item.sender,
            room: item.room,
            type: item.type || 'text',
            text: item.text || '',
            quoteId: item.quoteId || null,
            quoteText: item.quoteText || null,
            quoteSender: item.quoteSender || null,
            forwardedFrom: item.forwardedFrom || null
        };

        if (typeof ws === 'undefined' || !ws || ws.readyState !== WebSocket.OPEN) {
            if (typeof connectWS === 'function') connectWS(false);
        }


        var isShortText = (payloadObj.type === 'text') &&
            !payloadObj.forwardedFrom &&
            (payloadObj.text.length > 0 && payloadObj.text.length <= 500);

        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 18000);

        var reqPromise;
        if (isShortText) {
            var qs = '/api/fast-txt?c=' + encodeURIComponent(item.lid) +
                '&s=' + encodeURIComponent(item.sender) +
                '&r=' + encodeURIComponent(item.room) +
                '&t=' + encodeURIComponent(item.text) +
                (item.quoteId ? ('&qid=' + encodeURIComponent(item.quoteId) +
                                 '&qt=' + encodeURIComponent(item.quoteText || '') +
                                 '&qs=' + encodeURIComponent(item.quoteSender || '')) : '');
            reqPromise = fetch(qs, {
                method: 'GET',
                cache: 'no-store',
                keepalive: true,
                signal: controller.signal
            });
        } else {
            reqPromise = fetch('/api/send', {
                method: 'POST',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadObj),
                signal: controller.signal
            });
        }

        reqPromise
        .then(function(res) {
            clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP');
            return res.json().catch(function() { return { ok: true }; });
        })
        .then(function(respData) {
            msbOutboxQueue = msbOutboxQueue.filter(function(x) { return x && x.lid !== item.lid; });
            saveTextOutboxToStorage();
            try {
                var rC = localStorage.getItem('msb_cache_room_' + item.room);
                if (rC) {
                    var aC = JSON.parse(rC).filter(function(m) { return m.id !== item.lid; });
                    localStorage.setItem('msb_cache_room_' + item.room, JSON.stringify(aC));
                }
            } catch (e) {}
            var tempEl = document.querySelector('.msb-pending-row[data-lid="' + item.lid + '"]');
            if (tempEl) tempEl.remove();
            var oldLocalRow = document.querySelector('.message-row[data-msg-id="' + item.lid + '"]');
            if (oldLocalRow) oldLocalRow.remove();
            renderedMsgIds.delete(item.lid);
            if (respData && respData.msg && typeof window.handleIncomingChatWS === 'function') {
                window.handleIncomingChatWS({ type: 'chat_new_msg', room: item.room, msg: respData.msg });
            }
            clearNetworkErrorBanner();
        })

        .catch(function() {
            clearTimeout(timer);
            item._inFlight = 0;
        });
    });

    if (msbIsFlushing) return;
    var mediaItem = msbOutboxQueue.find(function(it) { return it && it.blob; });
    if (!mediaItem) return;

    msbIsFlushing = true;
    var mCtrl = new AbortController();
    var mTimer = setTimeout(function() { mCtrl.abort(); }, 60000);
    var fd = new FormData();
    fd.append('clientMsgId', mediaItem.lid);
    fd.append('sender', mediaItem.sender);
    fd.append('room', mediaItem.room);
    fd.append('type', mediaItem.type || 'file');
    fd.append('media', mediaItem.blob, mediaItem.fileName || ('media_' + Date.now()));
    if (mediaItem.quoteId) {
        fd.append('quoteId', mediaItem.quoteId);
        fd.append('quoteText', mediaItem.quoteText || '');
        fd.append('quoteSender', mediaItem.quoteSender || '');
    }
    if (mediaItem.forwardedFrom) fd.append('forwardedFrom', mediaItem.forwardedFrom);

    fetch('/api/send', { method: 'POST', body: fd, signal: mCtrl.signal })
    .then(function(res) {
        clearTimeout(mTimer);
        if (!res.ok) throw new Error('Send error');
        return res.json().catch(function() { return { ok: true }; });
    })
    .then(function(respData) {
        msbOutboxQueue = msbOutboxQueue.filter(function(x) { return x && x.lid !== mediaItem.lid; });
        var tempEl = document.querySelector('.msb-pending-row[data-lid="' + mediaItem.lid + '"]');
        if (tempEl) tempEl.remove();
        if (respData && respData.msg && typeof window.handleIncomingChatWS === 'function') {
            window.handleIncomingChatWS({ type: 'chat_new_msg', room: mediaItem.room, msg: respData.msg });
        }
        msbIsFlushing = false;
        if (msbOutboxQueue.some(function(x) { return x && x.blob; })) setTimeout(flushOutboxQueue, 100);
    })
    .catch(function() {
        clearTimeout(mTimer);
        msbIsFlushing = false;
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
                return;
            } else if (cleanName && cleanName.toLowerCase() !== chatUser.toLowerCase() && cleanName !== 'АДМИН') {
                selectChat({ name: cleanName, isGroup: false, avatar: '', online: true });
                return;
            }
        } catch (err) {}
    }
    if (currentRoomId) fetchMessages();
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
    [fInput, document.getElementById('login-callsign'), document.getElementById('reg-callsign'), document.getElementById('mini-notif-input')].forEach(function(inp) {
        if (!inp) return;
        inp.setAttribute('lang', 'ru');
        inp.setAttribute('autocapitalize', 'sentences');
        inp.setAttribute('autocorrect', 'on');
        inp.setAttribute('spellcheck', 'true');
        inp.removeAttribute('autocomplete');
        inp.removeAttribute('inputmode');
    });

    function bindVisualViewportForAndroidKeyboard() {
        if (!window.visualViewport) return;
        var vpRaf = null;
        var lastVpH = window.visualViewport.height;

        var updateVp = function() {
            if (vpRaf) cancelAnimationFrame(vpRaf);
            vpRaf = requestAnimationFrame(function() {
                var modal = document.getElementById('messenger-modal');
                if (!modal || modal.style.display !== 'flex') return;

                // В APK сдвиг делает сам Android через WindowInsets, а в браузере — visualViewport
                var isNativeApk = Boolean(window.MsbNative || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));
                if (!isNativeApk) {
                    var vh = window.visualViewport.height;
                    modal.style.height = vh + 'px';
                    modal.style.maxHeight = vh + 'px';
                    modal.style.top = Math.max(0, window.visualViewport.offsetTop || 0) + 'px';
                }

                if (window.visualViewport.height < lastVpH - 80) {
                    var mBox = getMessagesDiv();
                    if (mBox) mBox.scrollTop = mBox.scrollHeight;
                }
                lastVpH = window.visualViewport.height;
            });
        };
        window.visualViewport.addEventListener('resize', updateVp);
        window.visualViewport.addEventListener('scroll', updateVp);
    }

    bindVisualViewportForAndroidKeyboard();

    if (tInput && tInput.tagName === 'INPUT') {
        var ta = document.createElement('textarea');
        ta.id = tInput.id;
        ta.placeholder = tInput.placeholder || 'Написать сообщение...';
        ta.disabled = tInput.disabled;
        ta.rows = 1;
        tInput.parentNode.replaceChild(ta, tInput);
        tInput = ta;
    }

    if (tInput) {
        // Чистые атрибуты обычного текстового поля, чтобы над буквами ВСЕГДА была панель:
        // буфер обмена, смайлики, микрофон и шестерёнка настроек
        tInput.setAttribute('rows', '1');
        tInput.setAttribute('lang', 'ru');
        tInput.setAttribute('autocapitalize', 'sentences');
        tInput.setAttribute('autocorrect', 'on');
        tInput.setAttribute('spellcheck', 'true');
        tInput.removeAttribute('autocomplete');
        tInput.removeAttribute('inputmode');
        tInput.removeAttribute('data-gramm');

        var isImeComposing = false;
        tInput.addEventListener('compositionstart', function() { isImeComposing = true; });
        tInput.addEventListener('compositionend', function() {
            isImeComposing = false;
            syncTextareaHeight();
        });

        var taResizeRaf = null;
        function syncTextareaHeight() {
            if (tInput.value.length === 0) {
                if (tInput.style.height !== '36px') tInput.style.height = '36px';
                return;
            }
            if (taResizeRaf) return;
            taResizeRaf = requestAnimationFrame(function() {
                taResizeRaf = null;
                var sh = tInput.scrollHeight;
                var targetPx = Math.min(110, Math.max(36, sh));
                if (Math.abs(tInput.clientHeight - targetPx) > 4) {
                    tInput.style.height = targetPx + 'px';
                }
            });
        }


        tInput.addEventListener('keydown', function(e) {
            var isMobileScreen = window.innerWidth <= 768 || ('ontouchstart' in window);
            if (e.key === 'Enter' && !e.shiftKey && !isMobileScreen && !isImeComposing) {
                e.preventDefault();
                sendMessage();
            }
        });

        tInput.addEventListener('input', function() {
            if (!isImeComposing) syncTextareaHeight();
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
    fetch('/api/messenger/sync?user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(res) { return res.json(); })
        .then(function(payload) {
            isFetchingFriends = false;
            if (!payload || !Array.isArray(payload.friends)) return;

            payload.friends.forEach(function(item) {
                if (!item.isGroup) {
                    item.avatar = getCachedUserAvatar(item.name, item.avatarHash || '');
                }
            });
            friendsList = payload.friends;
            try {
                var slim = payload.friends.map(function(x) { return Object.assign({}, x, { avatar: '' }); });
                localStorage.setItem('msb_cache_friends_' + chatUser, JSON.stringify(slim));
            } catch (e) {}

            if (typeof myMessengerFriends !== 'undefined') myMessengerFriends = payload.friends;
            if (typeof populateTargetSelect === 'function') populateTargetSelect();
            renderFriends();

            if (Array.isArray(payload.requests)) {
                friendRequests = payload.requests;
                renderRequests();
            }
            if (!lightweight && payload.avatarHash) {
                var avData = getCachedUserAvatar(chatUser, payload.avatarHash);
                if (avData) renderAvatarElement(document.getElementById('my-avatar'), chatUser, avData);
            }
            updateTotalUnreadBadge();
        }).catch(function() { isFetchingFriends = false; });


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
        if (!lastTextVal || lastTextVal === 'Нет сообщений') {
            if (!window._msbLastMsgMem) window._msbLastMsgMem = {};
            var memHit = window._msbLastMsgMem[activeId];
            if (!memHit) {
                try {
                    var locRaw = localStorage.getItem('msb_cache_room_' + activeId);
                    var locArr = locRaw ? JSON.parse(locRaw) : [];
                    if (locArr.length > 0) {
                        var lm = locArr[locArr.length - 1];
                        memHit = {
                            txt: lm.type === 'audio' ? '🎙️ Голосовое' :
                                 lm.type === 'video' ? '🎥 Кружок' :
                                 lm.type === 'file' ? '📎 Файл' : (lm.text || ''),
                            tm: lm.time || ''
                        };
                        window._msbLastMsgMem[activeId] = memHit;
                    } else {
                        window._msbLastMsgMem[activeId] = { empty: true };
                    }
                } catch (e) {}
            }
            if (memHit && !memHit.empty) {
                lastTextVal = memHit.txt || lastTextVal;
                lastTimeVal = memHit.tm || lastTimeVal;
            }
        }


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
        currentRoomId = String(itemObj.id || '').trim().toLowerCase();
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
    chatVisibleLimit = 45;
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
    updateTopBackButtonVisibility();
    var mDiv = getMessagesDiv();
    if (mDiv) mDiv.innerHTML = '';

    friendsList.forEach(function(f) {
        var fid = f.isGroup ? f.id : makeDirectRoomId(chatUser, f.name);
        if (fid === currentRoomId) f.unread = 0;
    });
    updateTotalUnreadBadge();
    renderFriends();

    requestAnimationFrame(function() {
        renderPendingBubbles();
        fetchMessages();
        markChatAsRead(currentRoomId);
    });
}



function closeChatMobile() {
    resetChatArea();
    var sb = document.getElementById('app-sidebar');
    if (sb) sb.classList.remove('hidden');
    updateTopBackButtonVisibility();
    lastFriendsRenderSig = '';
    loadFriendsAndRequests(true);
}

(function initChatLeftSwipeToFriends() {
    var touchStartX = 0;
    var touchStartY = 0;
    var isLeftSwipeAllowed = false;

    document.addEventListener('touchstart', function(e) {
        if (window.innerWidth > 768) return;
        var modal = document.getElementById('messenger-modal');
        var sb = document.getElementById('app-sidebar');
        if (!modal || modal.style.display !== 'flex') return;
        if (!sb || !sb.classList.contains('hidden')) return;

        var t = e.touches.item(0);
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        var isNearRightEdge = (window.innerWidth - touchStartX) <= 55;
        var isOnBubble = e.target && e.target.closest && e.target.closest('.swipe-container');
        isLeftSwipeAllowed = isNearRightEdge || !isOnBubble;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!isLeftSwipeAllowed || window.innerWidth > 768) return;
        isLeftSwipeAllowed = false;

        var t = e.changedTouches.item(0);
        var diffX = t.clientX - touchStartX;
        var diffY = Math.abs(t.clientY - touchStartY);

        if (diffX < -75 && diffY < 60) {
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
var lastKnownScrollH = 36;

function sendMessage() {
    chatUser = getActiveChatIdentity();
    var textInput = document.getElementById('text-input');
    if (!textInput) return;
    var text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;

    if (editingMessageId) {
        var editId = editingMessageId;
        var editRoom = currentRoomId;
        editingMessageId = null;
        textInput.value = '';
        textInput.style.height = '36px';
        lastKnownScrollH = 36;
        if (stopTypingDebounce) clearTimeout(stopTypingDebounce);
        notifyServerTyping(false);
        cancelReply();

        // 1. Сразу обновляем сообщение на экране и в локальном кэше без ожидания сети
        if (typeof window.handleIncomingChatWS === 'function') {
            window.handleIncomingChatWS({
                type: 'chat_msg_edited',
                room: editRoom,
                messageId: editId,
                text: text
            });
        }

        // 2. Дублируем по WebSocket для мгновенной доставки собеседнику
        if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'chat_edit_ws',
                    room: editRoom,
                    messageId: editId,
                    sender: chatUser,
                    text: text
                }));
            } catch (e) {}
        }

        // 3. Отправляем по HTTP с автоповтором при слабой сети
        var sendEditHttp = function(attempt) {
            fetch('/api/messages/edit', {
                method: 'POST',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room: editRoom,
                    messageId: editId,
                    sender: chatUser,
                    text: text
                })
            }).then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                loadFriendsAndRequests(true);
            }).catch(function() {
                if (attempt < 5) {
                    setTimeout(function() { sendEditHttp(attempt + 1); }, 2500);
                }
            });
        };
        sendEditHttp(1);
        return;
    }


    var qId = quotedMessageId || null;
    var qTxt = quotedMessageText || null;
    var qSnd = quotedMessageSender || null;

    textInput.value = '';
    textInput.style.height = '36px';
    lastKnownScrollH = 36;
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
var voiceRecTimer = null;
var voiceRecStartTs = 0;
var voiceRecDurationSec = 0;
var voiceRecCanceled = false;

function formatVoiceSec(sec) {
    var total = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
}

function showVoiceRecordBar(show) {
    var inputContainer = document.querySelector('#messenger-modal .input-container');
    if (!inputContainer) return;
    var bar = document.getElementById('msb-voice-rec-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'msb-voice-rec-bar';
        bar.className = 'msb-voice-rec-bar';
        bar.innerHTML = [
            '<div class="voice-rec-left">',
            '  <span class="voice-rec-dot"></span>',
            '  <span id="voice-rec-clock" class="voice-rec-clock">0:00</span>',
            '  <span class="voice-rec-label">Запись голоса...</span>',
            '</div>',
            '<div class="voice-rec-actions">',
            '  <button type="button" class="voice-rec-cancel-btn" onclick="cancelVoiceRecord()">🗑️ Отмена</button>',
            '  <button type="button" class="voice-rec-send-btn" onclick="toggleVoiceRecord()">➤ Отправить</button>',
            '</div>'
        ].join('');
        inputContainer.insertBefore(bar, inputContainer.firstChild);
    }
    bar.style.display = show ? 'flex' : 'none';
}

function cancelVoiceRecord() {
    voiceRecCanceled = true;
    if (voiceRecTimer) {
        clearInterval(voiceRecTimer);
        voiceRecTimer = null;
    }
    showVoiceRecordBar(false);
    var btn = document.getElementById('voice-btn');
    if (btn) {
        btn.classList.remove('recording');
        btn.textContent = '🎙️';
    }
    if (audioRecorder && audioRecorder.state === 'recording') {
        try { audioRecorder.stop(); } catch (e) {}
    }
}

function toggleVoiceRecord() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId) return alert('Сначала выберите чат слева!');
    var btn = document.getElementById('voice-btn');

    if (audioRecorder && audioRecorder.state === 'recording') {
        voiceRecDurationSec = Math.max(1, Math.round((Date.now() - voiceRecStartTs) / 1000));
        if (voiceRecTimer) {
            clearInterval(voiceRecTimer);
            voiceRecTimer = null;
        }
        showVoiceRecordBar(false);
        audioRecorder.stop();
        if (btn) {
            btn.classList.remove('recording');
            btn.textContent = '🎙️';
        }
    } else {
        voiceRecCanceled = false;
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
                stream.getTracks().forEach(function(track) { track.stop(); });
                if (voiceRecCanceled) {
                    voiceRecCanceled = false;
                    audioChunks = new Array();
                    return;
                }
                var mimeUsed = audioRecorder.mimeType || 'audio/webm';
                var ext = mimeUsed.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
                var blob = new Blob(audioChunks, { type: mimeUsed });
                var qId = quotedMessageId || null, qTxt = quotedMessageText || null, qSnd = quotedMessageSender || null;
                cancelReply();

                enqueueChatPayload({
                    sender: chatUser,
                    room: currentRoomId,
                    type: 'audio',
                    blob: blob,
                    fileName: 'voice_' + voiceRecDurationSec + 's.' + ext,
                    duration: voiceRecDurationSec,
                    quoteId: qId,
                    quoteText: qTxt,
                    quoteSender: qSnd
                });
            };

            voiceRecStartTs = Date.now();
            voiceRecDurationSec = 0;
            showVoiceRecordBar(true);
            var clockEl = document.getElementById('voice-rec-clock');
            if (clockEl) clockEl.textContent = '0:00';

            if (voiceRecTimer) clearInterval(voiceRecTimer);
            voiceRecTimer = setInterval(function() {
                var sec = Math.floor((Date.now() - voiceRecStartTs) / 1000);
                voiceRecDurationSec = sec;
                var cEl = document.getElementById('voice-rec-clock');
                if (cEl) cEl.textContent = formatVoiceSec(sec);
            }, 250);

            audioRecorder.start(400);
            if (btn) {
                btn.classList.add('recording');
                btn.textContent = '🛑';
            }
        }).catch(function() {
            alert('Нет доступа к микрофону!');
        });
    }
}
window.cancelVoiceRecord = cancelVoiceRecord;


var roundCamFacing = 'user';
var roundRecCanvas = null;
var roundRecRaf = null;
var roundRecAccMs = 0;
var roundRecSegTs = 0;
var roundRecPaused = false;
var roundRecTrash = false;
var roundAudioStream = null;
var MAX_ROUND_SEC = 60;

function ensureRoundVideoStage() {
    var st = document.getElementById('msb-round-stage');
    if (st) return st;

    st = document.createElement('div');
    st.id = 'msb-round-stage';
    st.innerHTML = [
        '<svg class="msb-round-ring-svg" viewBox="0 0 120 120">',
        '  <circle class="msb-round-ring-bg" cx="60" cy="60" r="57"></circle>',
        '  <circle id="msb-round-ring-prog" class="msb-round-ring-prog" cx="60" cy="60" r="57"></circle>',
        '</svg>',
        '<div id="msb-round-time-pill" class="msb-round-time-pill">',
        '  <span class="msb-rec-dot"></span>',
        '  <span id="msb-round-time-text">0:00</span>',
        '</div>',
        '<div class="msb-round-controls-bar">',
        '  <button type="button" id="msb-round-discard" class="msb-round-ctrl-btn trash-round-btn" title="Удалить"><span class="rc-ico">🗑️</span></button>',
        '  <button type="button" id="msb-round-cam-flip" class="msb-round-ctrl-btn flip-round-btn" title="Камера"><span class="rc-ico">🔄</span></button>',
        '  <button type="button" id="msb-round-pause-play" class="msb-round-ctrl-btn pause-round-btn" title="Пауза"><span class="rc-ico">⏸</span></button>',
        '  <button type="button" id="msb-round-stop-send" class="msb-round-ctrl-btn send-round-btn" title="Отправить"><span class="rc-ico">➤</span></button>',
        '</div>'
    ].join('');

    document.body.appendChild(st);

    document.getElementById('msb-round-discard').onclick = function(e) {
        e.stopPropagation();
        discardRoundRecording();
    };
    document.getElementById('msb-round-cam-flip').onclick = function(e) {
        e.stopPropagation();
        switchRoundCameraLive();
    };
    document.getElementById('msb-round-pause-play').onclick = function(e) {
        e.stopPropagation();
        toggleRoundPausePlay();
    };
    document.getElementById('msb-round-stop-send').onclick = function(e) {
        e.stopPropagation();
        if (videoRecorder && videoRecorder.state !== 'inactive') {
            toggleVideoRecord();
        }
    };
    return st;
}
function setRoundRingProgress(frac, sec, isRec) {
    var prog = document.getElementById('msb-round-ring-prog');
    var pill = document.getElementById('msb-round-time-pill');
    var txt = document.getElementById('msb-round-time-text');
    var circ = 358.14;
    var cl = Math.max(0, Math.min(1, frac || 0));

    if (prog) {
        prog.style.strokeDashoffset = String(circ * (1 - cl));
        prog.classList.toggle('is-rec-active', Boolean(isRec && !roundRecPaused));
    }
    if (pill) {
        pill.classList.toggle('is-rec-blinking', Boolean(isRec && !roundRecPaused));
        pill.classList.toggle('is-rec-paused', Boolean(isRec && roundRecPaused));
    }
    var tot = Math.max(0, Math.floor(sec || 0));
    var mm = Math.floor(tot / 60);
    var ss = String(tot % 60).padStart(2, '0');
    if (txt) {
        txt.textContent = mm + ':' + ss;
    } else if (pill) {
        pill.innerHTML = (isRec ? '<span class="msb-rec-dot"></span>' : '') + mm + ':' + ss;
    }
}

function toggleRoundPausePlay() {
    if (!videoRecorder || videoRecorder.state === 'inactive') return;
    var pp = document.getElementById('msb-round-pause-play');

    if (videoRecorder.state === 'recording') {
        try { videoRecorder.pause(); } catch (e) {}
        roundRecAccMs += (Date.now() - roundRecSegTs);
        roundRecPaused = true;
        if (pp) pp.textContent = '▶️';
        setRoundRingProgress((roundRecAccMs / 1000) / MAX_ROUND_SEC, roundRecAccMs / 1000, true);
    } else if (videoRecorder.state === 'paused') {
        try { videoRecorder.resume(); } catch (e) {}
        roundRecSegTs = Date.now();
        roundRecPaused = false;
        if (pp) pp.textContent = '⏸';
    }
}

function discardRoundRecording() {
    roundRecTrash = true;
    var btn = document.getElementById('video-btn');
    if (btn) {
        btn.classList.remove('recording');
        btn.textContent = '🎥';
    }
    if (videoRecorder && videoRecorder.state !== 'inactive') {
        try { videoRecorder.stop(); } catch (e) {}
    }
    cleanupRoundRecordingUI();
}
async function openCameraByFacing(facing) {
    var base = {
        width: { ideal: 360, max: 480 },
        height: { ideal: 360, max: 480 },
        frameRate: { ideal: 24, max: 30 }
    };
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: Object.assign({}, base, { facingMode: { exact: facing } }),
            audio: false
        });
    } catch (e1) {}

    try {
        var devs = await navigator.mediaDevices.enumerateDevices();
        var cams = devs.filter(function(d) { return d.kind === 'videoinput'; });
        if (cams.length > 1) {
            var wantFront = (facing === 'user');
            var found = cams.find(function(d) {
                var l = String(d.label || '').toLowerCase();
                return wantFront
                    ? (l.indexOf('front') !== -1 || l.indexOf('user') !== -1 || l.indexOf('передн') !== -1)
                    : (l.indexOf('back') !== -1 || l.indexOf('rear') !== -1 || l.indexOf('environment') !== -1 || l.indexOf('задн') !== -1);
            });
            var pick = found || (wantFront ? cams : cams[cams.length - 1]);
            if (pick && pick.deviceId) {
                return await navigator.mediaDevices.getUserMedia({
                    video: Object.assign({}, base, { deviceId: { exact: pick.deviceId } }),
                    audio: false
                });
            }
        }
    } catch (e2) {}

    return await navigator.mediaDevices.getUserMedia({
        video: Object.assign({}, base, { facingMode: facing }),
        audio: false
    });
}

async function switchRoundCameraLive() {
    if (!videoRecorder || videoRecorder.state === 'inactive') return;
    var flip = document.getElementById('msb-round-cam-flip');
    if (flip) flip.disabled = true;

    var next = (roundCamFacing === 'user') ? 'environment' : 'user';
    var prev = document.getElementById('video-preview');

    if (videoStreamRef) {
        videoStreamRef.getVideoTracks().forEach(function(t) { t.stop(); });
        videoStreamRef = null;
    }

    try {
        var ns = await openCameraByFacing(next);
        roundCamFacing = next;
        videoStreamRef = ns;
        if (prev) {
            prev.srcObject = ns;
            prev.classList.toggle('rear-cam', roundCamFacing === 'environment');
            await prev.play().catch(function() {});
        }
    } catch (err) {
        try {
            var fb = await openCameraByFacing(roundCamFacing);
            videoStreamRef = fb;
            if (prev) {
                prev.srcObject = fb;
                await prev.play().catch(function() {});
            }
        } catch (e) {}
    } finally {
        if (flip) flip.disabled = false;
    }
}

function cleanupRoundRecordingUI() {
    if (roundRecRaf) {
        cancelAnimationFrame(roundRecRaf);
        roundRecRaf = null;
    }
    roundRecPaused = false;
    roundRecAccMs = 0;

    var pp = document.getElementById('msb-round-pause-play');
    if (pp) pp.textContent = '⏸';

    var prev = document.getElementById('video-preview');
    if (prev) {
        prev.style.display = 'none';
        prev.srcObject = null;
    }
    var st = document.getElementById('msb-round-stage');
    if (st) {
        st.style.display = 'none';
        st.classList.remove('mode-rec');
    }
    if (videoStreamRef) {
        videoStreamRef.getTracks().forEach(function(t) { t.stop(); });
        videoStreamRef = null;
    }
    if (roundAudioStream) {
        roundAudioStream.getTracks().forEach(function(t) { t.stop(); });
        roundAudioStream = null;
    }
}
function toggleVideoRecord() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId) return alert('Сначала выберите чат слева!');
    var btn = document.getElementById('video-btn');
    var prev = document.getElementById('video-preview');

    if (videoRecorder && videoRecorder.state !== 'inactive') {
        try { videoRecorder.stop(); } catch (e) {}
        if (btn) {
            btn.classList.remove('recording');
            btn.textContent = '🎥';
        }
        cleanupRoundRecordingUI();
        return;
    }

    closeBigVideoRoundOverlay();
    roundCamFacing = 'user';
    roundRecPaused = false;
    roundRecTrash = false;
    roundRecAccMs = 0;

    navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 },
        video: { width: { ideal: 360, max: 480 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }
    }).then(function(stream) {
        videoChunks = new Array();
        videoStreamRef = new MediaStream(stream.getVideoTracks());
        roundAudioStream = new MediaStream(stream.getAudioTracks());

        var st = ensureRoundVideoStage();
        st.classList.add('mode-rec');
        st.style.display = 'block';

        var pp = document.getElementById('msb-round-pause-play');
        if (pp) pp.textContent = '⏸';
        setRoundRingProgress(0, 0, true);

        if (prev) {
            if (prev.parentElement !== st) st.insertBefore(prev, st.firstChild);
            prev.classList.remove('rear-cam');
            prev.muted = true;
            prev.setAttribute('playsinline', '');
            prev.srcObject = videoStreamRef;
            prev.style.display = 'block';
            prev.play().catch(function() {});
        }

        if (!roundRecCanvas) {
            roundRecCanvas = document.createElement('canvas');
            roundRecCanvas.width = 360;
            roundRecCanvas.height = 360;
        }
        var ctx = roundRecCanvas.getContext('2d');
        roundRecSegTs = Date.now();

        function drawFrameLoop() {
            if (!roundRecPaused) {
                if (prev && prev.readyState >= 2) {
                    var vw = prev.videoWidth || 360;
                    var vh = prev.videoHeight || 360;
                    var minS = Math.min(vw, vh);
                    var sx = (vw - minS) / 2;
                    var sy = (vh - minS) / 2;
                    ctx.save();
                    if (roundCamFacing === 'user') {
                        ctx.translate(360, 0);
                        ctx.scale(-1, 1);
                    }
                    ctx.drawImage(prev, sx, sy, minS, minS, 0, 0, 360, 360);
                    ctx.restore();
                }
                var totMs = roundRecAccMs + (Date.now() - roundRecSegTs);
                var elap = totMs / 1000;
                setRoundRingProgress(elap / MAX_ROUND_SEC, elap, true);
                if (elap >= MAX_ROUND_SEC && videoRecorder && videoRecorder.state !== 'inactive') {
                    toggleVideoRecord();
                    return;
                }
            }
            roundRecRaf = requestAnimationFrame(drawFrameLoop);
        }
        roundRecRaf = requestAnimationFrame(drawFrameLoop);

        var comb = new MediaStream();
        var cStr = roundRecCanvas.captureStream(24);
        cStr.getVideoTracks().forEach(function(t) { comb.addTrack(t); });
        roundAudioStream.getAudioTracks().forEach(function(t) { comb.addTrack(t); });

        var mime = '';
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) mime = 'video/mp4;codecs=avc1,mp4a.40.2';
        else if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';
        else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mime = 'video/webm;codecs=vp8,opus';
        else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';

        var opts = { videoBitsPerSecond: 380000, audioBitsPerSecond: 24000 };
        if (mime) opts.mimeType = mime;

        videoRecorder = new MediaRecorder(comb, opts);
        videoRecorder.ondataavailable = function(e) {
            if (e.data && e.data.size > 0) videoChunks.push(e.data);
        };
        videoRecorder.onstop = function() {
            if (roundRecTrash) {
                roundRecTrash = false;
                videoChunks = new Array();
                cleanupRoundRecordingUI();
                return;
            }
            var blob = new Blob(videoChunks, { type: videoRecorder.mimeType || 'video/mp4' });
            var ext = (videoRecorder.mimeType && videoRecorder.mimeType.indexOf('mp4') !== -1) ? 'mp4' : 'webm';
            var qId = quotedMessageId || null;
            var qTxt = quotedMessageText || null;
            var qSnd = quotedMessageSender || null;
            cancelReply();
            cleanupRoundRecordingUI();
            enqueueChatPayload({
                sender: chatUser, room: currentRoomId, type: 'video',
                blob: blob, fileName: 'video.' + ext,
                quoteId: qId, quoteText: qTxt, quoteSender: qSnd
            });
        };
        videoRecorder.start(400);
        if (btn) {
            btn.classList.add('recording');
            btn.textContent = '🛑';
        }
    }).catch(function() { alert('Нет доступа к камере или микрофону!'); });
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
    var startX = 0, startY = 0, currentX = 0, isSwiping = false, isHorizontal = false, swipeLockedVertical = false;
    var displayStr = rawText;
    if (msgType === 'audio') displayStr = "🎙️ Голосовое сообщение";
    if (msgType === 'video') displayStr = "🎥 Видео-кружок";
    if (msgType === 'gif') displayStr = "🎬 GIF-анимация";
    if (msgType === 'contact') displayStr = "👤 Контакт";
    if (msgType === 'file') {
        try { displayStr = '📎 Файл: ' + JSON.parse(rawText).name; } catch (e) {}
    }

    container.addEventListener('touchstart', function(e) {
        var touch = e.touches.item(0);
        startX = touch.clientX; startY = touch.clientY;
        isSwiping = true; isHorizontal = false; swipeLockedVertical = false;
        container.style.transition = 'none';
    }, { passive: true });

    container.addEventListener('touchmove', function(e) {
        if (!isSwiping || swipeLockedVertical) return;
        var touch = e.touches.item(0);
        var diffX = touch.clientX - startX;
        var diffY = touch.clientY - startY;
        if (!isHorizontal) {
            if (Math.abs(diffY) > 10 && Math.abs(diffY) >= Math.abs(diffX)) {
                swipeLockedVertical = true;
                return;
            }
            if (Math.abs(diffX) > 14 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                isHorizontal = true;
            } else {
                return;
            }
        }
        currentX = Math.max(-80, Math.min(80, diffX * 0.6));
        container.style.transform = 'translate3d(' + currentX + 'px, 0, 0)';
        leftIndicator.style.opacity = (currentX > 35) ? '1' : '0';
        rightIndicator.style.opacity = (currentX < -35) ? '1' : '0';
    }, { passive: true });

    container.addEventListener('touchend', function() {
        isSwiping = false;
        swipeLockedVertical = false;
        if (currentX !== 0) {
            container.style.transition = 'transform 0.2s cubic-bezier(0.1, 0.8, 0.3, 1)';
            container.style.transform = 'translate3d(0px, 0, 0)';
            leftIndicator.style.opacity = '0';
            rightIndicator.style.opacity = '0';
            if (currentX > 50) handleQuoteTrigger(msgId, displayStr, sender);
            else if (currentX < -50) handleForwardTrigger(msgId, rawText, msgType, sender);
            currentX = 0;
        }
    }, { passive: true });
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
    var wasEditing = Boolean(editingMessageId);
    editingMessageId = null;
    quotedMessageId = null;
    quotedMessageText = null;
    quotedMessageSender = null;
    var bar = document.getElementById('reply-bar');
    if (bar) bar.style.display = 'none';
    if (wasEditing) {
        var input = document.getElementById('text-input');
        if (input) {
            input.value = '';
            input.style.height = '36px';
        }
    }
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
    var row = document.querySelector('.message-row[data-msg-id="' + msgId + '"]');
    if (!row) return;
    if (row.getAttribute('data-ant-eating') === '1') return;

    row.setAttribute('data-ant-eating', '1');
    var roomToDel = currentRoomId;
    var container = row.querySelector('.swipe-container');
    var bubble = row.querySelector('.bubble');

    if (bubble) {
        bubble.classList.add('ant-being-eaten-both');
    }

    if (container) {
        container.classList.add('ant-stage-wrap');

        // Муравей слева (ползёт снаружи слева к центру и грызёт)
        var antLeft = document.createElement('div');
        antLeft.className = 'ant-dual-eater ant-from-left';
        antLeft.innerHTML = '<span class="ant-crumbs">✦ ‧</span><span class="ant-bug">🐜</span>';
        container.appendChild(antLeft);

        // Муравей справа (ползёт снаружи справа к центру и грызёт)
        var antRight = document.createElement('div');
        antRight.className = 'ant-dual-eater ant-from-right';
        antRight.innerHTML = '<span class="ant-bug">🐜</span><span class="ant-crumbs">‧ ✦</span>';
        container.appendChild(antRight);
    }

    // Через 10 секунд оба муравья доедают сообщение в центре -> строка схлопывается и удаляется
    setTimeout(function() {
        row.classList.add('ant-row-collapse');
        setTimeout(function() {
            if (row && row.parentNode) row.remove();
            renderedMsgIds.delete(msgId);
        }, 350);

        fetch('/api/messages/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: roomToDel, messageId: msgId })
        }).catch(function() {});
    }, 10000);
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
                requestAnimationFrame(function() { mDiv.scrollTop = mDiv.scrollHeight; });
                setTimeout(function() { if (currentRoomId === requestedRoom) mDiv.scrollTop = mDiv.scrollHeight; }, 80);
                setTimeout(function() { if (currentRoomId === requestedRoom) mDiv.scrollTop = mDiv.scrollHeight; }, 240);
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
        if (data.length > 0) {
            setTimeout(function() {
                try {
                    var oldRaw = localStorage.getItem('msb_cache_room_' + requestedRoom);
                    var oldArr = oldRaw ? JSON.parse(oldRaw) : [];
                    var byId = {};
                    oldArr.forEach(function(m) { if (m && m.id) byId[m.id] = m; });
                    data.forEach(function(m) { if (m && m.id) byId[m.id] = m; });
                    var combined = Object.values(byId).sort(function(a, b) {
                        return Number(a.timestamp || 0) - Number(b.timestamp || 0);
                    }).slice(-100);
                    localStorage.setItem('msb_cache_room_' + requestedRoom, JSON.stringify(combined));
                } catch (e) {}
            }, 50);
        }



        var partnerOnline = (resp && typeof resp.partnerOnline === 'boolean') ? resp.partnerOnline : false;
        if (resp && typeof resp.partnerLastSeen === 'string' && resp.partnerLastSeen) partnerLastSeenCache = resp.partnerLastSeen;
        var typingUsers = (resp && Array.isArray(resp.typingUsers)) ? resp.typingUsers : new Array();
        if (currentPartner) renderPartnerPresenceHeader(partnerOnline, partnerLastSeenCache, typingUsers);
        applyMessagesToDOM(mDiv, data, isModalOpen);
    }).catch(function() { isFetchingMessages = false; });
}
var chatVisibleLimit = 45;

function applyMessagesToDOM(mDiv, data, isModalOpen) {
    data = data.slice().sort(function(a, b) {
        return Number(a.timestamp || 0) - Number(b.timestamp || 0);
    });
    if (data.length === 0) {
        var hasLocalPending = msbOutboxQueue.some(function(p) { return p && p.room === currentRoomId; });
        if (lastMessagesCount !== 0 && !hasLocalPending && renderedMsgIds.size === 0) {
            lastMessagesCount = 0;
            mDiv.innerHTML = '<div class="chat-placeholder">История сообщений пуста.</div>';
        }
        renderPendingBubbles();
        return;
    }
    var placeholder = mDiv.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    var totalLen = data.length;
    var sliceStart = Math.max(0, totalLen - chatVisibleLimit);
    var visibleData = data.slice(sliceStart);

    var oldLoadBtn = document.getElementById('msb-load-older-btn');
    if (sliceStart > 0) {
        if (!oldLoadBtn) {
            oldLoadBtn = document.createElement('button');
            oldLoadBtn.id = 'msb-load-older-btn';
            oldLoadBtn.type = 'button';
            oldLoadBtn.style.cssText = 'margin:4px auto 10px auto;padding:7px 14px;border-radius:12px;border:1px solid rgba(56,189,248,0.4);background:rgba(15,23,42,0.85);color:#38bdf8;font-size:12px;font-weight:700;cursor:pointer;display:block;';
            oldLoadBtn.onclick = function() {
                var prevH = mDiv.scrollHeight;
                chatVisibleLimit += 45;
                renderedMsgIds.clear();
                mDiv.innerHTML = '';
                applyMessagesToDOM(mDiv, data, isModalOpen);
                mDiv.scrollTop = mDiv.scrollHeight - prevH;
            };
            mDiv.insertBefore(oldLoadBtn, mDiv.firstChild);
        }
        oldLoadBtn.textContent = '⬆️ Показать ранние сообщения (' + sliceStart + ')';
    } else if (oldLoadBtn) {
        oldLoadBtn.remove();
    }

    var addedNew = false, hasUnreadIncoming = false;
    var frag = document.createDocumentFragment();
    visibleData.forEach(function(msg) {
        var isMy = String(msg.sender || '').trim().toLowerCase() === String(chatUser || '').trim().toLowerCase();
        if (!isMy && !msg.read) hasUnreadIncoming = true;
        var checkIcon = isMy
            ? (msg.read
                ? ' <span class="msg-check" style="color:#38bdf8;font-weight:900;margin-left:5px;font-size:13px;" title="Прочитано">✓✓</span>'
                : ' <span class="msg-check" style="color:rgba(255,255,255,0.6);font-weight:bold;margin-left:5px;font-size:13px;" title="Доставлено">✓</span>')
            : '';
        if (renderedMsgIds.has(msg.id)) {
            var existingRow = mDiv.querySelector('.message-row[data-msg-id="' + msg.id + '"]');
            if (existingRow) {
                if ((!msg.type || msg.type === 'text') && existingRow.getAttribute('data-raw-text') !== String(msg.text || '')) {
                    existingRow.setAttribute('data-raw-text', String(msg.text || ''));
                    var txtBox = existingRow.querySelector('.msg-text');
                    if (txtBox) txtBox.innerHTML = renderMessageTextWithLiveEmojis(msg.text);
                }
                var editedTag = msg.edited ? '<span class="msg-edited-tag">(изм.)</span>' : '';
                var timeBox = existingRow.querySelector('.msg-time');
                var desiredTimeHTML = editedTag + msg.time + checkIcon;
                if (timeBox && timeBox.innerHTML !== desiredTimeHTML) timeBox.innerHTML = desiredTimeHTML;
            }
            return;
        }

        renderedMsgIds.add(msg.id);
        addedNew = true;
        renderSingleRow(frag, msg, isMy, checkIcon);
    });
    if (addedNew) {
        var prevLastRow = mDiv.querySelector('.message-row:not(.msb-pending-row):last-of-type');
        var prevLastTs = prevLastRow ? Number(prevLastRow.getAttribute('data-ts') || 0) : 0;
        var firstNewEl = frag.firstElementChild;
        var firstNewTs = firstNewEl ? Number(firstNewEl.getAttribute('data-ts') || 0) : 0;

        mDiv.appendChild(frag);

        if (prevLastTs > 0 && firstNewTs > 0 && firstNewTs < prevLastTs) {
            var rowsArr = Array.from(mDiv.querySelectorAll('.message-row:not(.msb-pending-row)'));
            rowsArr.sort(function(r1, r2) {
                return Number(r1.getAttribute('data-ts') || 0) - Number(r2.getAttribute('data-ts') || 0);
            });
            rowsArr.forEach(function(r) { mDiv.appendChild(r); });
        }
        mDiv.scrollTop = mDiv.scrollHeight;
        requestAnimationFrame(function() { mDiv.scrollTop = mDiv.scrollHeight; });
        setTimeout(function() { mDiv.scrollTop = mDiv.scrollHeight; }, 120);
    } else if (lastMessagesCount <= 0) {
        requestAnimationFrame(function() { mDiv.scrollTop = mDiv.scrollHeight; });
        setTimeout(function() { mDiv.scrollTop = mDiv.scrollHeight; }, 120);
    }
    lastMessagesCount = Math.max(lastMessagesCount, totalLen);
    renderPendingBubbles();
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
    if (msg.clientMsgId) {
        var dupByClient = document.querySelector('.message-row[data-client-id="' + msg.clientMsgId + '"]');
        if (dupByClient && dupByClient.getAttribute('data-msg-id') !== String(msg.id)) {
            dupByClient.remove();
        }
    }
    var row = document.createElement('div');
    row.className = 'message-row ' + (isMy ? 'my-msg' : 'other-msg');
    row.setAttribute('data-msg-id', msg.id);
    row.setAttribute('data-ts', String(msg.timestamp || 0));
    row.setAttribute('data-raw-text', String(msg.text || ''));


    if (msg.clientMsgId) row.setAttribute('data-client-id', msg.clientMsgId);
    row.innerHTML = '<div class="swipe-indicator left-indicator">💬</div><div class="swipe-container"><div class="bubble"></div></div><div class="swipe-indicator right-indicator">↪️</div>';
    var bubble = row.querySelector('.bubble');
    var quoteHTML = (msg.quoteId && msg.quoteText) ? ('<div class="msg-quote-block"><div class="msg-quote-author">' + escapeEdgeHtml(msg.quoteSender || 'Система') + '</div>' + escapeEdgeHtml(msg.quoteText) + '</div>') : '';
    var forwardHTML = msg.forwardedFrom ? ('<div class="msg-forwarded-label">↪ Переслано от: ' + escapeEdgeHtml(msg.forwardedFrom) + '</div>') : '';
    var authorHTML = (isCurrentGroup && !isMy) ? ('<div class="msg-author">' + escapeEdgeHtml(msg.sender) + '</div>') : '';
    var delBtnHTML = '<button class="msg-del-inline-btn" onclick="inlineDeleteMessage(\'' + msg.id + '\')">&times;</button>';
    var contentHTML = '';
    var mediaSrc = window.resolveMsbMediaUrl ? window.resolveMsbMediaUrl(msg.text) : msg.text;
    if (msg.type === 'audio') {
        contentHTML = buildMsbVoicePlayerHTML(mediaSrc, msg.id);
    } else if (msg.type === 'video') {
        bubble.classList.add('video-bubble-clean');
        contentHTML = '<div class="video-round-wrap"><video class="video-round" src="' + mediaSrc + '#t=0.001" playsinline muted loop preload="metadata" onclick="playVideoWithSound(this)"></video></div>';
    } else if (msg.type === 'gif') {
        contentHTML = '<img class="chat-image" src="' + mediaSrc + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'🎬 GIF\')">';
    } else if (msg.type === 'file') {
        try {
            var fileObj = JSON.parse(msg.text);
            var fullPath = window.resolveMsbMediaUrl ? window.resolveMsbMediaUrl(fileObj.path) : fileObj.path;
            var ext = fileObj.name.split('.').pop().toLowerCase();
            if (Array.of('jpg', 'jpeg', 'png', 'gif', 'webp').includes(ext)) {
                contentHTML = '<img class="chat-image" src="' + fullPath + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'📷 Фото\')">';
            } else {
                var safeUrl = String(fullPath || '').replace(/'/g, "\\'");
                var safeFn = String(fileObj.name || 'file').replace(/'/g, "\\'");
                contentHTML = '<a href="' + fullPath + '" download="' + escapeEdgeHtml(fileObj.name) + '" onclick="return downloadChatAttachment(event, \'' + safeUrl + '\', \'' + safeFn + '\')" class="chat-file-card"><span class="chat-file-icon">📄</span><div class="chat-file-info"><span class="chat-file-name">' + escapeEdgeHtml(fileObj.name) + '</span><span class="chat-file-action">📥 Скачать файл</span></div></a>';
            }
        } catch (e) { contentHTML = '<div class="msg-text">Поврежденный файл</div>'; }

     } else if (msg.type === 'missed_call') {
        var callTargetName = isMy ? (msg.target || currentPartner || '') : (msg.sender || currentPartner || '');
        var safeCallTarget = String(callTargetName).replace(/'/g, "\\'");
        var missedTitle = isMy ? '📵 Недозвон (абонент не ответил)' : '📵 Пропущенный вызов';
        contentHTML =
            '<div class="msb-missed-call-card" onclick="triggerCallInDev(\'Аудиозвонок\', \'' + safeCallTarget + '\')">' +
                '<div class="msb-missed-call-top">' +
                    '<span class="msb-missed-ico">📵</span>' +
                    '<div class="msb-missed-info">' +
                        '<div class="msb-missed-title">' + missedTitle + '</div>' +
                        '<div class="msb-missed-sub">Нажмите, чтобы перезвонить</div>' +
                    '</div>' +
                '</div>' +
                '<button type="button" class="msb-missed-callback-btn">📞 Позвонить</button>' +
            '</div>';
    } else if (msg.type === 'contact') {
        var cObj = { name: msg.text || 'Боец', unit: '' };
        try {
            var parsedC = JSON.parse(msg.text);
            if (parsedC && parsedC.name) cObj = parsedC;
        } catch (e) {}
        var safeCName = String(cObj.name || '').replace(/'/g, "\\'");
        var cUnitBadge = cObj.unit ? (' <span class="friend-unit-pill">' + escapeEdgeHtml(cObj.unit) + '</span>') : '';
        contentHTML =
            '<div class="msb-shared-contact-card">' +
                '<div class="msb-shared-contact-top">' +
                    '<div class="msb-shared-contact-ico">👤</div>' +
                    '<div class="msb-shared-contact-meta">' +
                        '<div class="msb-shared-contact-label">Контакт МСБ-55115</div>' +
                        '<div class="msb-shared-contact-name">' + escapeEdgeHtml(cObj.name) + cUnitBadge + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="msb-shared-contact-actions">' +
                    '<button type="button" class="msb-contact-act-btn chat" onclick="openSharedContactChat(\'' + safeCName + '\')">💬 Написать</button>' +
                    '<button type="button" class="msb-contact-act-btn call call-live-green" onclick="triggerCallInDev(\'Аудиозвонок\', \'' + safeCName + '\')">📞</button>' +
                '</div>' +
            '</div>';
    } else {
        contentHTML = '<div class="msg-text">' + renderMessageTextWithLiveEmojis(msg.text) + '</div>';
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
var activeMsbAudio = null;
var activeMsbAudioCard = null;
var msbAudioRaf = null;

function extractVoiceSecondsFromUrl(url) {
    var m = String(url || '').match(/voice_(\d+)s/i);
    return m ? Number(m.at(1)) : 0;
}

function buildMsbVoicePlayerHTML(audioUrl, msgId) {
    var presetSec = extractVoiceSecondsFromUrl(audioUrl);
    var initialLabel = presetSec > 0 ? formatVoiceSec(presetSec) : '0:01';
    var barsCount = 24;
    var heights = Array.of(32, 65, 90, 48, 82, 55, 100, 72, 40, 88, 60, 95, 45, 76, 52, 92, 68, 38, 84, 58, 96, 50, 74, 42);
    var barsHTML = '';
    for (var i = 0; i < barsCount; i++) {
        var h = heights.at(i % heights.length);
        barsHTML += '<span class="msb-eq-bar" style="height:' + h + '%; --bar-i:' + i + ';"></span>';
    }

    return Array.of(
        '<div class="msb-voice-card" data-audio-url="' + escapeEdgeHtml(audioUrl) + '" data-fixed-sec="' + presetSec + '" id="voice-card-' + escapeEdgeHtml(msgId) + '">',
        '  <button type="button" class="msb-voice-play-btn" onclick="toggleMsbVoicePlay(this)">▶</button>',
        '  <div class="msb-voice-body">',
        '    <div class="msb-voice-eq-track" onclick="seekMsbVoice(event, this)">',
        '      <div class="msb-voice-eq-bars">' + barsHTML + '</div>',
        '    </div>',
        '    <div class="msb-voice-meta">',
        '      <span class="msb-voice-timer">' + initialLabel + '</span>',
        '      <span class="msb-voice-badge">🎙️ Голосовое</span>',
        '    </div>',
        '  </div>',
        '  <audio class="msb-hidden-audio" src="' + escapeEdgeHtml(audioUrl) + '" preload="none"></audio>',
        '</div>'
    ).join('');
}

function stopActiveMsbAudio() {
    if (msbAudioRaf) {
        cancelAnimationFrame(msbAudioRaf);
        msbAudioRaf = null;
    }
    if (activeMsbAudio) {
        try {
            activeMsbAudio.pause();
            activeMsbAudio.currentTime = 0;
        } catch (e) {}
    }
    if (activeMsbAudioCard) {
        activeMsbAudioCard.classList.remove('is-playing');
        var btn = activeMsbAudioCard.querySelector('.msb-voice-play-btn');
        if (btn) btn.textContent = '▶';
        var timerEl = activeMsbAudioCard.querySelector('.msb-voice-timer');
        var fixedSec = Number(activeMsbAudioCard.getAttribute('data-fixed-sec') || 0);
        if (timerEl && fixedSec > 0) {
            timerEl.textContent = formatVoiceSec(fixedSec);
        }
        activeMsbAudioCard.querySelectorAll('.msb-eq-bar').forEach(function(b) {
            b.classList.remove('played');
        });
    }
    activeMsbAudio = null;
    activeMsbAudioCard = null;
}

function toggleMsbVoicePlay(btnEl) {
    var card = btnEl.closest('.msb-voice-card');
    if (!card) return;
    var audio = card.querySelector('audio.msb-hidden-audio');
    var timerEl = card.querySelector('.msb-voice-timer');
    var bars = card.querySelectorAll('.msb-eq-bar');
    if (!audio) return;

    if (activeMsbAudio && activeMsbAudio !== audio) {
        stopActiveMsbAudio();
    }

    if (!audio.paused) {
        audio.pause();
        card.classList.remove('is-playing');
        btnEl.textContent = '▶';
        if (msbAudioRaf) cancelAnimationFrame(msbAudioRaf);
        return;
    }

    activeMsbAudio = audio;
    activeMsbAudioCard = card;
    card.classList.add('is-playing');
    btnEl.textContent = '⏸';

    var playWallStart = Date.now() - Math.round((audio.currentTime || 0) * 1000);

    function updateProgressLoop() {
        if (!audio || audio.paused || audio.ended) return;

        var fixedSec = Number(card.getAttribute('data-fixed-sec') || 0);
        var wallElapsed = (Date.now() - playWallStart) / 1000;
        var cur = (isFinite(audio.currentTime) && audio.currentTime > 0) ? audio.currentTime : wallElapsed;

        // Никогда не берём сломанный audio.duration у WebM, если известна точная запись в секундах!
        var totalDur = fixedSec > 0
            ? fixedSec
            : ((isFinite(audio.duration) && audio.duration > 0 && audio.duration < 600) ? audio.duration : Math.max(1, Math.ceil(cur)));

        if (cur > totalDur) cur = totalDur;

        if (timerEl) {
            timerEl.textContent = formatVoiceSec(Math.floor(cur)) + ' / ' + formatVoiceSec(totalDur);
        }

        var ratio = totalDur > 0 ? Math.min(1, Math.max(0, cur / totalDur)) : 0;
        var playedBars = Math.round(ratio * bars.length);
        bars.forEach(function(b, idx) {
            b.classList.toggle('played', idx < playedBars);
        });

        msbAudioRaf = requestAnimationFrame(updateProgressLoop);
    }

    audio.onplay = function() {
        playWallStart = Date.now() - Math.round((audio.currentTime || 0) * 1000);
        if (msbAudioRaf) cancelAnimationFrame(msbAudioRaf);
        msbAudioRaf = requestAnimationFrame(updateProgressLoop);
    };

    audio.onended = function() {
        if (msbAudioRaf) cancelAnimationFrame(msbAudioRaf);
        card.classList.remove('is-playing');
        btnEl.textContent = '▶';

        var fixedSec = Number(card.getAttribute('data-fixed-sec') || 0);
        if (fixedSec <= 0) {
            var realElapsed = Math.max(1, Math.round((Date.now() - playWallStart) / 1000));
            fixedSec = realElapsed;
            card.setAttribute('data-fixed-sec', String(fixedSec));
        }

        try { audio.currentTime = 0; } catch (e) {}

        // Показываем 100% зелёную шкалу в момент окончания и через 0.25 сек чисто сбрасываем в начало
        bars.forEach(function(b) { b.classList.add('played'); });
        if (timerEl) timerEl.textContent = formatVoiceSec(fixedSec);

        setTimeout(function() {
            if (audio.paused) {
                bars.forEach(function(b) { b.classList.remove('played'); });
            }
        }, 250);
    };

    audio.play().catch(function() {
        card.classList.remove('is-playing');
        btnEl.textContent = '▶';
    });
}

function seekMsbVoice(event, trackEl) {
    var card = trackEl.closest('.msb-voice-card');
    if (!card) return;
    var audio = card.querySelector('audio.msb-hidden-audio');
    if (!audio) return;
    var fixedSec = Number(card.getAttribute('data-fixed-sec') || 0);
    if (fixedSec <= 0) return;

    var rect = trackEl.getBoundingClientRect();
    var clickX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    var ratio = clickX / rect.width;
    var targetTime = ratio * fixedSec;
    try {
        audio.currentTime = targetTime;
    } catch (e) {}

    var timerEl = card.querySelector('.msb-voice-timer');
    if (timerEl) {
        timerEl.textContent = formatVoiceSec(Math.floor(targetTime)) + ' / ' + formatVoiceSec(fixedSec);
    }

    var bars = card.querySelectorAll('.msb-eq-bar');
    var playedBars = Math.round(ratio * bars.length);
    bars.forEach(function(b, idx) {
        b.classList.toggle('played', idx < playedBars);
    });
}

window.toggleMsbVoicePlay = toggleMsbVoicePlay;
window.seekMsbVoice = seekMsbVoice;



function downloadChatAttachment(e, filePath, fileName) {
    var baseOrig = window.API_ORIGIN || location.origin;
    var fullUrl = filePath.indexOf('http') === 0 ? filePath : (baseOrig + filePath);
    var dlUrl = fullUrl + (fullUrl.indexOf('?') === -1 ? '?' : '&') + 'dl=1&name=' + encodeURIComponent(fileName || 'file');
    if (window.MsbNative && typeof window.MsbNative.downloadFile === 'function') {
        if (e) e.preventDefault();
        window.MsbNative.downloadFile(dlUrl, fileName || 'file');
        return false;
    }
    if (e) e.preventDefault();
    var a = document.createElement('a');
    a.href = dlUrl;
    a.download = fileName || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return false;
}
window.downloadChatAttachment = downloadChatAttachment;

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
    bubble.style.webkitUserSelect = 'none';
    bubble.style.userSelect = 'none';
    bubble.style.webkitTouchCallout = 'none';

    var pressTimer = null;
    var holdFired = false;
    var startX = 0;
    var startY = 0;
    var msgType = msg.type || 'text';

    function triggerHold() {
        pressTimer = null;
        holdFired = true;
        if (navigator.vibrate) navigator.vibrate(45);
        var actualText = rowEl.getAttribute('data-raw-text') || msg.text || '';
        if (msgType === 'text' && actualText) {
            copyTextUniversal(actualText);
        }
        openMessageActionSheet(msg.id, actualText, msgType, isMy);
    }

    bubble.addEventListener('touchstart', function(e) {
        if (e.target && e.target.closest('button, a, audio, video')) return;
        holdFired = false;
        var t = e.touches.item(0);
        startX = t.clientX;
        startY = t.clientY;
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(triggerHold, 420);
    }, { passive: true });

    bubble.addEventListener('touchmove', function(e) {
        if (!pressTimer) return;
        var t = e.touches.item(0);
        if (Math.abs(t.clientX - startX) > 16 || Math.abs(t.clientY - startY) > 16) {
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

    bubble.addEventListener('touchcancel', function() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    });

    bubble.addEventListener('contextmenu', function(e) {
        if (e.target && e.target.closest('a, audio, video')) return;
        e.preventDefault();
        if (!holdFired) triggerHold();
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
    var canEdit = isMy && (!msgType || msgType === 'text');
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

    quotedMessageId = null;
    quotedMessageText = null;
    quotedMessageSender = null;
    editingMessageId = msgId;

    var bar = document.getElementById('reply-bar');
    var textEl = document.getElementById('reply-bar-text');
    var input = document.getElementById('text-input');

    if (textEl) textEl.textContent = '✏️ Исправление: ' + oldText;
    if (bar) bar.style.display = 'flex';

    if (input) {
        input.removeAttribute('disabled');
        input.disabled = false;
        input.value = oldText || '';
        input.dispatchEvent(new Event('input'));
        setTimeout(function() {
            input.focus();
            var len = input.value.length;
            try { input.setSelectionRange(len, len); } catch (e) {}
        }, 60);
    }
}



var activeSmallRoundVideo = null;
var roundPlayRaf = null;

function closeBigVideoRoundOverlay() {
    if (roundPlayRaf) {
        cancelAnimationFrame(roundPlayRaf);
        roundPlayRaf = null;
    }
    var ov = document.getElementById('msb-video-round-backdrop');
    if (ov) ov.style.display = 'none';

    var floatVid = document.getElementById('msb-floating-round-player');
    if (floatVid) {
        try { floatVid.pause(); } catch (e) {}
        floatVid.removeAttribute('src');
        floatVid.style.display = 'none';
    }

    var stage = document.getElementById('msb-round-stage');
    if (stage && !stage.classList.contains('mode-rec')) {
        stage.style.display = 'none';
    }

    if (activeSmallRoundVideo) {
        activeSmallRoundVideo.style.visibility = 'visible';
        activeSmallRoundVideo = null;
    }
}

function playVideoWithSound(v) {
    if (!v) return;
    if (videoRecorder && videoRecorder.state === 'recording') return;

    if (activeSmallRoundVideo === v) {
        closeBigVideoRoundOverlay();
        return;
    }

    closeBigVideoRoundOverlay();

    var ov = document.getElementById('msb-video-round-backdrop');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'msb-video-round-backdrop';
        ov.onclick = function() { closeBigVideoRoundOverlay(); };
        document.body.appendChild(ov);
    }

    var stage = ensureRoundVideoStage();
    stage.classList.remove('mode-rec');
    stage.style.display = 'block';
    setRoundRingProgress(0, 0, false);

    var floatVid = document.getElementById('msb-floating-round-player');
    if (!floatVid) {
        floatVid = document.createElement('video');
        floatVid.id = 'msb-floating-round-player';
        floatVid.setAttribute('playsinline', '');
        floatVid.onclick = function() { closeBigVideoRoundOverlay(); };
        stage.insertBefore(floatVid, stage.firstChild);
    }

    document.querySelectorAll('#messages video.video-round').forEach(function(other) {
        other.muted = true;
        other.pause();
    });

    activeSmallRoundVideo = v;
    v.style.visibility = 'hidden';

    var rawSrc = String(v.getAttribute('src') || v.src || '');
    var hashPos = rawSrc.indexOf('#');
    var cleanSrc = (hashPos !== -1) ? rawSrc.substring(0, hashPos) : rawSrc;

    ov.style.display = 'block';
    floatVid.src = cleanSrc;
    floatVid.style.display = 'block';
    floatVid.muted = false;
    floatVid.loop = false;
    floatVid.currentTime = 0;
    floatVid.play().catch(function() {});

    function syncPlayProgress() {
        if (!floatVid || floatVid.paused || floatVid.ended) return;
        var dur = (floatVid.duration && isFinite(floatVid.duration)) ? floatVid.duration : 1;
        var rem = Math.max(0, dur - floatVid.currentTime);
        setRoundRingProgress(floatVid.currentTime / dur, rem, false);
        roundPlayRaf = requestAnimationFrame(syncPlayProgress);
    }
    floatVid.onplay = function() {
        if (roundPlayRaf) cancelAnimationFrame(roundPlayRaf);
        roundPlayRaf = requestAnimationFrame(syncPlayProgress);
    };
    floatVid.onended = function() {
        setRoundRingProgress(1, 0, false);
        closeBigVideoRoundOverlay();
    };
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
setInterval(function() {
    if (msbOutboxQueue.length > 0 && document.visibilityState === 'visible') {
        flushOutboxQueue();
    }
}, 3500);
window.selectChat = selectChat; window.closeChatMobile = closeChatMobile; window.sendMessage = sendMessage;
window.toggleVoiceRecord = toggleVoiceRecord; window.toggleVideoRecord = toggleVideoRecord; window.uploadAnyFile = uploadAnyFile;
window.uploadMyAvatar = uploadMyAvatar; window.deleteFriend = deleteFriend; window.openCreateGroupModal = openCreateGroupModal;
window.closeGroupModal = closeGroupModal; window.submitCreateGroup = submitCreateGroup; window.sendFriendRequest = sendFriendRequest;
window.handleRequest = handleRequest; window.closeForwardModal = closeForwardModal; window.cancelReply = cancelReply;
window.inlineDeleteMessage = inlineDeleteMessage; window.playVideoWithSound = playVideoWithSound; window.syncMessengerAuth = syncMessengerAuth;
window.flushRetryQueue = flushRetryQueue;
var msbExtraClockTimer = null;
var msbToolbarExpanded = false;

var RECENT_EMOJIS_KEY = 'msb_recent_emojis_v1';

function getRecentEmojis() {
    try {
        var raw = localStorage.getItem(RECENT_EMOJIS_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(0, 24) : [];
    } catch (e) { return []; }
}

function saveRecentEmoji(em) {
    if (!em) return;
    var list = getRecentEmojis().filter(function(x) { return x !== em; });
    list.unshift(em);
    if (list.length > 24) list = list.slice(0, 24);
    try { localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(list)); } catch (e) {}
    refreshRecentEmojisGrid();
}

function refreshRecentEmojisGrid() {
    var grid = document.getElementById('tg-recent-emoji-grid');
    var title = document.getElementById('tg-ecat-recent');
    if (!grid || !title) return;
    var recents = getRecentEmojis();
    if (recents.length === 0) {
        title.style.display = 'none';
        grid.style.display = 'none';
        grid.innerHTML = '';
        return;
    }
    title.style.display = 'block';
    grid.style.display = 'grid';
    grid.innerHTML = recents.map(function(em) {
        var liveCls = getLiveEmojiAnimClass(em) ? ' live-preview' : '';
        return '<button type="button" class="tg-emoji-item' + liveCls + '" onclick="insertTgEmoji(\'' + em + '\')">' + em + '</button>';
    }).join('');
}

var LIVE_EMOJI_MAP = {
    '❤️':'anim-heart','🧡':'anim-heart','💛':'anim-heart','💚':'anim-heart','💙':'anim-heart','💜':'anim-heart','💖':'anim-heart','💗':'anim-heart','💓':'anim-heart','💔':'anim-heart',
    '🔥':'anim-fire','💥':'anim-fire','⚡':'anim-fire','✨':'anim-fire','🌟':'anim-fire','🎆':'anim-fire',
    '😂':'anim-bounce','🤣':'anim-bounce','😍':'anim-bounce','🥳':'anim-bounce','🤩':'anim-bounce','😎':'anim-bounce','🚀':'anim-bounce','🚁':'anim-bounce','🛸':'anim-bounce','🏆':'anim-bounce',
    '👍':'anim-shake','👋':'anim-shake','👏':'anim-shake','🤝':'anim-shake','🙏':'anim-shake','💪':'anim-shake','🚨':'anim-shake','⚠️':'anim-shake','🎉':'anim-shake'
};

function getLiveEmojiAnimClass(em) {
    return LIVE_EMOJI_MAP[em] || '';
}

function renderMessageTextWithLiveEmojis(rawText) {
    var safe = escapeEdgeHtml(rawText || '');
    var trimmed = safe.trim();
    var emojiKeys = Object.keys(LIVE_EMOJI_MAP);
    var onlySmallCount = Array.from(trimmed).length <= 3 && emojiKeys.some(function(k) { return trimmed.indexOf(k) !== -1; });
    var isSolo = onlySmallCount && trimmed.replace(/[\s\uFE0F]/g, '').length <= 6;

    emojiKeys.forEach(function(em) {
        if (safe.indexOf(em) !== -1) {
            var cls = 'msb-live-emoji ' + LIVE_EMOJI_MAP[em] + (isSolo ? ' big-solo' : '');
            safe = safe.split(em).join('<span class="' + cls + '">' + em + '</span>');
        }
    });
    return safe;
}

var TG_EMOJI_CATEGORIES = [
    {
        id: 'live',
        icon: '✨',
        title: '✨ Живые смайлики',
        items: [
            '❤️','🔥','😂','🤣','👍','😍','🥳','🤩','🚀','💥',
            '⚡','👋','👏','🤝','🙏','💪','😎','💖','💗','💔',
            '✨','🌟','🚁','🏆','🎉','⚠️'
        ]
    },
    {
        id: 'faces',
        icon: '😀',
        title: 'Эмоции',

        items: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
            '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
            '🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
            '🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕',
            '😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
            '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','🤡'
        ]
    },
    {
        id: 'gestures',
        icon: '👍',
        title: 'Жесты',
        items: [
            '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
            '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️',
            '💪','🦾','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'
        ]
    },
    {
        id: 'tactical',
        icon: '🪖',
        title: 'Служба и техника',
        items: [
            '🪖','🎖️','🏅','🥇','🏆','🚀','🛸','🛰️','🚁','🛩️','✈️','🚢','🚤','⚓','🚜','🚛',
            '🚚','🚗','🚓','🚑','🚒','📡','📻','🔋','🔌','🔦','🧭','🗺️','📍','📌','💣','🧨',
            '🔪','🗡️','⚔️','🛡️','🏹','🎯','🔭','🔬','🩺','🩹','💊','💉','🩸','🧰','🔧','🔨'
        ]
    },
    {
        id: 'symbols',
        icon: '🔥',
        title: 'Знаки и природа',
        items: [
            '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
            '🔥','⚡','💥','✨','💫','⭐','🌟','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️',
            '❄️','☃️','🌊','💧','🌲','🌳','🌴','🌵','🌿','☘️','🍀','🍁','🍂','🍃','🌍','🌙',
            '✅','❌','⚠️','🚫','⛔','🆘','🆗','🆙','🆕','🔴','🟠','🟡','🟢','🔵','🟣','⚫'
        ]
    }
];

function buildTelegramComposerLayout() {
    if (document.getElementById('tg-capsule-wrap')) return;
    var inputContainer = document.querySelector('#messenger-modal .input-container');
    var toolsRow = document.querySelector('#messenger-modal .tools-row');
    var inputRow = document.querySelector('#messenger-modal .input-row');
    var textInput = document.getElementById('text-input');
    var sendBtn = document.getElementById('send-btn');

    if (!inputContainer || !toolsRow || !inputRow || !textInput) return;


      if (toolsRow.getAttribute('data-tg-tools') !== '1') {
        toolsRow.setAttribute('data-tg-tools', '1');
        toolsRow.className = 'tools-row msb-radial-tools-row tg-radial-wave-tray';

        var fileInput = toolsRow.querySelector('input[type="file"]');
        toolsRow.innerHTML =
            '<div class="msb-wing msb-wing-left" id="msb-wing-left">' +
                '<button type="button" id="video-btn" class="media-btn" onclick="toggleVideoRecord()" title="Видео-кружок">🎥</button>' +
                '<button type="button" class="media-btn" onclick="document.getElementById(\'msb-radial-file-input\').click()" title="Прикрепить файл">📎</button>' +
                '<button type="button" id="voice-btn" class="media-btn" onclick="toggleVoiceRecord()" title="Голосовое сообщение">🎙️</button>' +
            '</div>' +
            '<button type="button" id="msb-center-toggle-btn" class="media-btn msb-center-plus-btn" onclick="toggleMsbRadialToolbar(false)" title="Свернуть панель">✖</button>' +
            '<div class="msb-wing msb-wing-right" id="msb-wing-right">' +
                '<button type="button" class="media-btn" onclick="openShareContactModal()" title="Поделиться контактом">👤</button>' +
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

    if (!document.getElementById('tg-emoji-drawer')) {
        var emojiDrawer = document.createElement('div');
        emojiDrawer.id = 'tg-emoji-drawer';
        emojiDrawer.className = 'tg-emoji-drawer';

        var recentTabBtn = '<button type="button" class="tg-emoji-tab active" data-cat="recent" onclick="scrollToEmojiCat(\'recent\')" title="Недавние">🕘</button>';
        var tabsHtml = recentTabBtn + TG_EMOJI_CATEGORIES.map(function(cat) {
            return '<button type="button" class="tg-emoji-tab" ' +
                   'data-cat="' + cat.id + '" onclick="scrollToEmojiCat(\'' + cat.id + '\')" title="' + cat.title + '">' +
                   cat.icon + '</button>';
        }).join('');

        var recentBlockHtml =
            '<div class="tg-emoji-cat-title" id="tg-ecat-recent" style="display:none;">🕘 Недавние</div>' +
            '<div class="tg-emoji-grid" id="tg-recent-emoji-grid" style="display:none;"></div>';

        var bodyHtml = recentBlockHtml + TG_EMOJI_CATEGORIES.map(function(cat) {
            var btns = cat.items.map(function(em) {
                var liveCls = (cat.id === 'live' || getLiveEmojiAnimClass(em)) ? ' live-preview' : '';
                return '<button type="button" class="tg-emoji-item' + liveCls + '" onclick="insertTgEmoji(\'' + em + '\')">' + em + '</button>';
            }).join('');
            return '<div class="tg-emoji-cat-title" id="tg-ecat-' + cat.id + '">' + cat.title + '</div>' +
                   '<div class="tg-emoji-grid">' + btns + '</div>';
        }).join('');

        emojiDrawer.innerHTML =
            '<div class="tg-emoji-tabs-bar">' +
                tabsHtml +
                '<button type="button" class="tg-emoji-backspace" onclick="backspaceTgEmoji()" title="Удалить символ">⌫</button>' +
                '<button type="button" class="tg-emoji-close" onclick="toggleTgEmojiDrawer(false)" title="Закрыть">✖</button>' +
            '</div>' +
            '<div class="tg-emoji-scroll-area" id="tg-emoji-scroll-area">' + bodyHtml + '</div>';

        inputContainer.insertBefore(emojiDrawer, toolsRow);
        refreshRecentEmojisGrid();
    }


    if (!document.getElementById('tg-capsule-wrap')) {
        inputRow.classList.add('tg-full-input-row');

        var capsule = document.createElement('div');
        capsule.id = 'tg-capsule-wrap';
        capsule.className = 'tg-input-capsule';

        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.id = 'tg-smile-btn';
        smileBtn.className = 'tg-inside-btn tg-smile-btn';
        smileBtn.textContent = '😊';
        smileBtn.title = 'Смайлики';
        smileBtn.onpointerdown = function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleTgEmojiDrawer();
        };

        var plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.id = 'tg-inside-plus-btn';
        plusBtn.className = 'tg-inside-btn tg-plus-btn';
        plusBtn.textContent = '➕';
        plusBtn.title = 'Инструменты';
              plusBtn.onpointerdown = function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleMsbRadialToolbar(true);
        };


           inputRow.insertBefore(capsule, textInput);
        capsule.appendChild(smileBtn);
        capsule.appendChild(textInput);
        capsule.appendChild(plusBtn);

        if (sendBtn) {
            sendBtn.textContent = '➤';
            sendBtn.title = 'Отправить';
            sendBtn.classList.add('tg-inside-send-btn');
            capsule.appendChild(sendBtn);
        }

        textInput.addEventListener('focus', function() {
            toggleTgEmojiDrawer(false);
        });
    }
}


function toggleTgEmojiDrawer(forceState) {
    buildTelegramComposerLayout();
    var drawer = document.getElementById('tg-emoji-drawer');
    if (!drawer) return;
    var show = (typeof forceState === 'boolean') ? forceState : (drawer.style.display !== 'flex');
    drawer.style.display = show ? 'flex' : 'none';
}

function scrollToEmojiCat(catId) {
    var scrollBox = document.getElementById('tg-emoji-scroll-area');
    var targetEl = document.getElementById('tg-ecat-' + catId);
    if (scrollBox && targetEl) {
        scrollBox.scrollTo({ top: targetEl.offsetTop - scrollBox.offsetTop, behavior: 'smooth' });
    }
    document.querySelectorAll('.tg-emoji-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-cat') === catId);
    });
}

function insertTgEmoji(emojiChar) {
    saveRecentEmoji(emojiChar);
    if (window.__msbNatActive && window.MsbNative && typeof window.MsbNative.appendChatEmoji === 'function') {
        window.MsbNative.appendChatEmoji(emojiChar);
        return;
    }
    var inp = document.getElementById('text-input');
    if (!inp || inp.disabled) return;
    var start = (typeof inp.selectionStart === 'number') ? inp.selectionStart : inp.value.length;
    var end = (typeof inp.selectionEnd === 'number') ? inp.selectionEnd : inp.value.length;
    inp.value = inp.value.slice(0, start) + emojiChar + inp.value.slice(end);
    var nextPos = start + emojiChar.length;
    inp.setSelectionRange(nextPos, nextPos);
    inp.dispatchEvent(new Event('input'));
}


function backspaceTgEmoji() {
    var inp = document.getElementById('text-input');
    if (!inp || inp.disabled || !inp.value) return;
    var start = (typeof inp.selectionStart === 'number') ? inp.selectionStart : inp.value.length;
    var end = (typeof inp.selectionEnd === 'number') ? inp.selectionEnd : inp.value.length;
    if (start !== end) {
        inp.value = inp.value.slice(0, start) + inp.value.slice(end);
        inp.setSelectionRange(start, start);
    } else if (start > 0) {
        var before = Array.from(inp.value.slice(0, start));
        before.pop();
        var newBefore = before.join('');
        inp.value = newBefore + inp.value.slice(end);
        inp.setSelectionRange(newBefore.length, newBefore.length);
    }
    inp.focus();
    inp.dispatchEvent(new Event('input'));
}


function toggleMsbRadialToolbar(forceState) {
    buildTelegramComposerLayout();
    var toolsRow = document.querySelector('#messenger-modal .tools-row');
    var insidePlus = document.getElementById('tg-inside-plus-btn');
    var drop = document.getElementById('msb-plus-dropdown');
    if (!toolsRow) return;

    msbToolbarExpanded = (typeof forceState === 'boolean') ? forceState : !msbToolbarExpanded;
    toolsRow.classList.toggle('open', msbToolbarExpanded);
    toolsRow.classList.toggle('expanded', msbToolbarExpanded);

    if (insidePlus) {
        insidePlus.style.display = msbToolbarExpanded ? 'none' : 'flex';
    }

    if (!msbToolbarExpanded && drop) {
        drop.classList.remove('open');
    }
}


window.toggleTgEmojiDrawer = toggleTgEmojiDrawer;
window.scrollToEmojiCat = scrollToEmojiCat;
window.insertTgEmoji = insertTgEmoji;
window.backspaceTgEmoji = backspaceTgEmoji;

function ensureMessengerExtraHub() {
    buildTelegramComposerLayout();


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

    if (String(tabTitle).indexOf('Каналы') !== -1) {
        openMsbChannelsFeedModal();
        return;
    }

    var titleEl = document.getElementById('msb-dev-tab-title');
    var modal = document.getElementById('msb-dev-tab-modal');
    if (titleEl) titleEl.textContent = tabTitle;
    updateMsbDevClock();
    if (msbExtraClockTimer) clearInterval(msbExtraClockTimer);
    msbExtraClockTimer = setInterval(updateMsbDevClock, 1000);
    if (modal) modal.style.display = 'flex';
}

function openMsbChannelsFeedModal() {
    var modal = document.getElementById('msb-channels-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'msb-channels-modal';
        modal.className = 'msb-work-fullscreen-modal';
        modal.style.zIndex = '232000';
        modal.innerHTML = [
            '<div class="msb-work-window-header">',
            '  <span style="font-weight:900; font-size:15px; color:#f8fafc;">📡 КАНАЛЫ • ЭФИР</span>',
            '  <div style="display:flex; gap:6px; align-items:center;">',
            '    <button type="button" class="msb-channel-add-btn" onclick="pullMoreChannelReels()" title="Подгрузить свежие и перемешать">🎲 Эфир</button>',
            '    <button type="button" class="msb-channel-add-btn" onclick="toggleChannelUploadBox()">➕ Свой</button>',
            '    <button type="button" class="msb-work-close-btn" onclick="closeMsbChannelsModal()">✖</button>',
            '  </div>',
            '</div>',
            '<div id="msb-channel-upload-box" class="msb-channel-upload-box" style="display:none;">',
            '  <input type="text" id="msb-channel-title-inp" class="search-input" placeholder="Подпись к ролику (например: Прикол 😂)..." style="width:100%; margin-bottom:8px;">',
            '  <div style="display:flex; gap:8px; align-items:center;">',
            '    <input type="file" id="msb-channel-file-inp" accept="video/*" style="flex:1; color:#cbd5e1; font-size:12px;">',
            '    <button type="button" id="msb-channel-send-btn" class="msb-channel-add-btn" onclick="uploadChannelVideo()">📤 Залить</button>',
            '  </div>',
            '  <div id="msb-channel-upload-status" style="display:none; margin-top:8px; font-size:12px; color:#facc15; font-weight:bold;"></div>',
            '</div>',
            '<div id="msb-channels-feed-list" class="msb-channels-feed-list"></div>'
        ].join('');
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    loadMsbChannelsFeed();
}

function closeMsbChannelsModal() {
    var modal = document.getElementById('msb-channels-modal');
    if (modal) {
        modal.querySelectorAll('video').forEach(function(v) {
            try { v.pause(); } catch (e) {}
        });
        modal.style.display = 'none';
    }
}

function toggleChannelUploadBox() {
    var box = document.getElementById('msb-channel-upload-box');
    if (!box) return;
    box.style.display = (box.style.display === 'none') ? 'block' : 'none';
}

var MSB_FALLBACK_RU_REELS = new Array();

var MSB_HUMOR_TOPICS = Array.of(
    'смешные приколы',
    'приколы с животными',
    'смешные коты',
    'юмор скетчи',
    'приколы до слез',
    'веселые видео'
);

async function fetchClientRutubeShorts() {
    try {
        var q = MSB_HUMOR_TOPICS.at(Math.floor(Math.random() * MSB_HUMOR_TOPICS.length));
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 5000);
        var apiPath = ['/api', 'search', 'video', ''].join('/');
        var url = 'https://rutube.ru' + apiPath + '?query=' + encodeURIComponent(q) + '&format=json';
        var res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return new Array();
        var data = await res.json();
        var results = (data && Array.isArray(data.results)) ? data.results : new Array();
        var out = new Array();
        results.forEach(function(v) {
            if (!v || !v.id || v.is_adult || v.is_hidden || v.is_deleted || v.is_locked || v.is_livestream) return;
            if (Number(v.duration || 0) > 300) return;
            var embUrl = v.embed_url ? String(v.embed_url) : ('https://rutube.ru' + ['/play', 'embed', String(v.id)].join('/'));
            if (embUrl.indexOf('/play/embed/') === -1) return;
            out.push({
                id: 'rt_live_' + String(v.id),
                author: '📺 ' + ((v.author && v.author.name) ? String(v.author.name).slice(0, 22) : 'Rutube Юмор'),
                isAuto: true,
                mediaKind: 'iframe',
                title: String(v.title || 'Прикол дня 😂').slice(0, 110),
                videoUrl: embUrl,
                time: 'Прямой эфир',
                likes: new Array()
            });
        });
        return out.sort(function() { return Math.random() - 0.5; }).slice(0, 12);
    } catch (e) {
        return new Array();
    }
}


function pullMoreChannelReels() {
    var listEl = document.getElementById('msb-channels-feed-list');
    if (listEl) {
        listEl.innerHTML = '<div class="chat-placeholder">🎲 Переключаем волну эфира...</div>';
    }
    var done = false;
    var finish = function() {
        if (done) return;
        done = true;
        loadMsbChannelsFeed(true);
    };
    var safetyTimer = setTimeout(finish, 3000);

    fetch('/api/channels/pull-now', { method: 'POST' })
        .then(function() { clearTimeout(safetyTimer); finish(); })
        .catch(function() { clearTimeout(safetyTimer); finish(); });
}

async function loadMsbChannelsFeed(forceShuffle) {
    var listEl = document.getElementById('msb-channels-feed-list');
    if (!listEl) return;
    var me = String(getActiveChatIdentity() || '').trim().toLowerCase();
    var isAdm = (typeof currentUser !== 'undefined' && currentUser === 'АДМИН') || (me === 'муравей');

    var serverItems = new Array();
    try {
        var r = await fetch('/api/channels/list?t=' + Date.now());
        var d = await r.json();
        if (d && Array.isArray(d.videos)) serverItems = d.videos;
    } catch (e) {}

    var clientLive = new Array();
    if (forceShuffle || serverItems.length < 4) {
        clientLive = await fetchClientRutubeShorts();
    }

    var userUploads = serverItems.filter(function(x) { return x && !x.isAuto; });
    var autoPool = serverItems.filter(function(x) { return x && x.isAuto; }).concat(clientLive);

    autoPool.sort(function() { return Math.random() - 0.5; });


    var seenUrls = new Set();
    var finalFeed = new Array();
    userUploads.concat(autoPool).forEach(function(it) {
        if (!it || !it.videoUrl || seenUrls.has(it.videoUrl)) return;
        seenUrls.add(it.videoUrl);
        finalFeed.push(it);
    });

    listEl.innerHTML = '';
	    if (finalFeed.length === 0) {
        listEl.innerHTML = '<div class="chat-placeholder">📡 Нажмите «🎲 Эфир» или загрузите свой ролик кнопкой «➕ Свой»!</div>';
        return;
    }

    finalFeed.slice(0, 25).forEach(function(item) {
        var card = document.createElement('div');
        card.className = 'msb-reel-card';
        var likesArr = Array.isArray(item.likes) ? item.likes : new Array();
        var isLiked = me && likesArr.includes(me);
        var canDel = !String(item.id).startsWith('rt_live_') && !String(item.id).startsWith('ru_fb_') &&
                     (isAdm || (me && String(item.author || '').trim().toLowerCase() === me));
        var vidSrc = window.resolveMsbMediaUrl ? window.resolveMsbMediaUrl(item.videoUrl) : item.videoUrl;
        var sourceBadge = item.isAuto
            ? '<span class="msb-reel-auto-pill">АВТО-ЭФИР</span>'
            : '<span class="msb-reel-auto-pill" style="color:#4ade80;border-color:#4ade80;">НАШ БОЕЦ</span>';

        var delHtml = canDel
            ? '<button type="button" class="msb-reel-del-btn" onclick="deleteChannelVideo(\'' + item.id + '\')" title="Удалить">🗑️</button>'
            : '';

        var isIframe = (item.mediaKind === 'iframe') ||
                       String(vidSrc).indexOf('/play/embed/') !== -1 ||
                       String(vidSrc).indexOf('://vk.com') !== -1;

        var playerHtml = isIframe
            ? '<iframe class="msb-reel-iframe" src="' + vidSrc + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy"></iframe>'
            : '<video class="msb-reel-video" src="' + vidSrc + '" controls playsinline preload="metadata" onplay="pauseOtherChannelVideos(this)"></video>';

        card.innerHTML = Array.of(
            '<div class="msb-reel-header">',
            '  <div>',
            '    <span class="msb-reel-author">' + escapeEdgeHtml(item.author || 'Боец') + '</span>',
            sourceBadge,
            '    <span class="msb-reel-time">' + escapeEdgeHtml(item.time || '') + '</span>',
            '  </div>',
            delHtml,
            '</div>',
            '<div class="msb-reel-title">' + escapeEdgeHtml(item.title || '') + '</div>',
            playerHtml,
            '<div class="msb-reel-footer">',
            '  <button type="button" class="msb-reel-like-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleChannelVideoLike(\'' + item.id + '\', this)">',
            '    ' + (isLiked ? '❤️' : '🤍') + ' ' + likesArr.length,
            '  </button>',
            '</div>'
        ).join('');
        listEl.appendChild(card);
    });
}

function pauseOtherChannelVideos(activeVid) {
    var listEl = document.getElementById('msb-channels-feed-list');
    if (!listEl) return;
    listEl.querySelectorAll('video').forEach(function(v) {
        if (v !== activeVid) {
            try { v.pause(); } catch (e) {}
        }
    });
}

function toggleChannelVideoLike(videoId, btnEl) {
    var me = getActiveChatIdentity();
    if (!me) return;
    fetch('/api/channels/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: videoId, user: me })
    }).then(function() {
        if (btnEl) {
            var likedNow = !btnEl.classList.contains('liked');
            btnEl.classList.toggle('liked', likedNow);
            var num = parseInt(btnEl.textContent.replace(/\D+/g, ''), 10) || 0;
            num = likedNow ? (num + 1) : Math.max(0, num - 1);
            btnEl.textContent = (likedNow ? '❤️ ' : '🤍 ') + num;
        }
    }).catch(function() {});
}

function uploadChannelVideo() {
    var me = getActiveChatIdentity();
    if (!me) return alert('Сначала войдите под своим позывным!');
    var fileInp = document.getElementById('msb-channel-file-inp');
    var titleInp = document.getElementById('msb-channel-title-inp');
    var statusEl = document.getElementById('msb-channel-upload-status');
    var sendBtn = document.getElementById('msb-channel-send-btn');

    if (!fileInp || !fileInp.files || fileInp.files.length === 0) {
        return alert('Выберите видеоролик с устройства!');
    }
    var file = fileInp.files.item(0);
    if (!file) return alert('Файл не выбран!');
    if (file.size > 60 * 1024 * 1024) {
        return alert('Ролик слишком большой (максимум 60 МБ). Выберите короткое видео!');
    }

    var title = (titleInp && titleInp.value.trim()) ? titleInp.value.trim() : 'Юмор МСБ-55115 😂';
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#facc15';
        statusEl.textContent = '⏳ Отправка ролика на сервер...';
    }
    if (sendBtn) sendBtn.disabled = true;

    var upUrl = '/api/channels/upload' +
        '?sender=' + encodeURIComponent(me) +
        '&title=' + encodeURIComponent(title) +
        '&filename=' + encodeURIComponent(file.name || 'reel.mp4');

    fetch(upUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
    })
    .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    })
    .then(function(d) {
        if (d && d.ok) {
            fileInp.value = '';
            if (titleInp) titleInp.value = '';
            if (statusEl) statusEl.style.display = 'none';
            toggleChannelUploadBox();
            loadMsbChannelsFeed();
        } else {
            throw new Error('Save failed');
        }
    })
    .catch(function() {
        if (statusEl) {
            statusEl.style.color = '#ef4444';
            statusEl.textContent = '❌ Ошибка загрузки ролика на сервер';
        }
    })
    .finally(function() {
        if (sendBtn) sendBtn.disabled = false;
    });
}

function deleteChannelVideo(videoId) {
    if (!confirm('Удалить этот видеоролик из канала?')) return;
    fetch('/api/channels/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: videoId })
    }).then(function() { loadMsbChannelsFeed(); }).catch(function() {});
}

window.openMsbChannelsFeedModal = openMsbChannelsFeedModal;
window.closeMsbChannelsModal = closeMsbChannelsModal;
window.toggleChannelUploadBox = toggleChannelUploadBox;
window.pullMoreChannelReels = pullMoreChannelReels;
window.uploadChannelVideo = uploadChannelVideo;
window.loadMsbChannelsFeed = loadMsbChannelsFeed;
window.pauseOtherChannelVideos = pauseOtherChannelVideos;
window.toggleChannelVideoLike = toggleChannelVideoLike;
window.deleteChannelVideo = deleteChannelVideo;


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

function openShareContactModal() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId || !chatUser) {
        alert('Сначала откройте чат, куда хотите отправить контакт!');
        return;
    }
    toggleMsbRadialToolbar(false);

    var modal = document.getElementById('msb-share-contact-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'msb-share-contact-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '235000';
        modal.innerHTML =
            '<div class="modal-box msb-themed-card">' +
                '<h3 class="msb-themed-title"><span>👤 Поделиться контактом</span>' +
                '<button type="button" class="modal-close" onclick="document.getElementById(\'msb-share-contact-modal\').style.display=\'none\'">&times;</button></h3>' +
                '<div id="msb-share-contact-list" class="modal-list"></div>' +
            '</div>';
        modal.onclick = function(e) {
            if (e.target === modal) modal.style.display = 'none';
        };
        document.body.appendChild(modal);
    }

    var listEl = document.getElementById('msb-share-contact-list');
    listEl.innerHTML = '';
    var contacts = friendsList.filter(function(f) { return f && !f.isGroup; });

    if (contacts.length === 0) {
        listEl.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:14px;">В вашем списке пока нет друзей</div>';
    } else {
        contacts.forEach(function(c) {
            var row = document.createElement('div');
            row.className = 'modal-item';
            var unitTxt = c.unit ? (' (' + escapeEdgeHtml(c.unit) + ')') : '';
            row.innerHTML =
                '<span>👤 <b>' + escapeEdgeHtml(c.name) + '</b>' + unitTxt + '</span>' +
                '<span style="color:#4ade80;font-weight:800;">Отправить ➤</span>';
            row.onclick = function() {
                modal.style.display = 'none';
                var qId = quotedMessageId || null, qTxt = quotedMessageText || null, qSnd = quotedMessageSender || null;
                cancelReply();
                enqueueChatPayload({
                    sender: chatUser,
                    room: currentRoomId,
                    type: 'contact',
                    text: JSON.stringify({ name: c.name, unit: c.unit || '' }),
                    quoteId: qId,
                    quoteText: qTxt,
                    quoteSender: qSnd
                });
            };
            listEl.appendChild(row);
        });
    }
    modal.style.display = 'flex';
}

function openSharedContactChat(targetName) {
    chatUser = getActiveChatIdentity();
    if (!targetName || !chatUser) return;
    if (targetName.toLowerCase() === chatUser.toLowerCase()) {
        alert('Это ваш собственный контакт!');
        return;
    }
    var existing = friendsList.find(function(f) {
        return f && !f.isGroup && String(f.name || '').toLowerCase() === targetName.toLowerCase();
    });
    if (existing) {
        selectChat(existing);
    } else {
        if (confirm('Добавить бойца «' + targetName + '» в друзья и открыть чат?')) {
            fetch('/api/friends/request/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: chatUser, to: targetName })
            }).catch(function() {});
        }
             selectChat({ name: targetName, isGroup: false, avatar: '', online: true });
    }
}

window.openShareContactModal = openShareContactModal;
window.openSharedContactChat = openSharedContactChat;

(function initSmoothChatScrollBoost() {
    var scrollTimer = null;
    function bindScroll() {
        var mDiv = document.getElementById('messages');
        if (!mDiv || mDiv.getAttribute('data-smooth-bound') === '1') return;
        mDiv.setAttribute('data-smooth-bound', '1');
        mDiv.addEventListener('scroll', function() {
            if (!mDiv.classList.contains('is-scrolling')) {
                mDiv.classList.add('is-scrolling');
            }
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(function() {
                mDiv.classList.remove('is-scrolling');
            }, 180);
        }, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindScroll);
    } else {
        bindScroll();
    }
})();
