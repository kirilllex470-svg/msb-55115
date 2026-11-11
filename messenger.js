// ==========================================
// МСБ-55115: МЕССЕНДЖЕР (messenger.js)
// ЧАСТЬ 1/11: Состояние, буферы и переменные
// ==========================================

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

// --- Флаги защиты сети МСБ-55115 ---
var isSendingPayload = false;
var pendingRetryQueue = [];

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
           localStorage.getItem('journal_user') || 
           null;
}

function makeDirectRoomId(u1, u2) {
    var sorted = Array.of(
        String(u1 || '').trim().toLowerCase(),
        String(u2 || '').trim().toLowerCase()
    ).sort();
    var pair = sorted.join(',');
    return pair + '_' + pair;
}
// ==========================================
// ЧАСТЬ 2/11: Проверка связи и очередь повторов
// ==========================================

async function checkServerConnection() {
    if (!navigator.onLine) return false;
    try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 3000);
        var targetUser = getActiveChatIdentity() || '';
        var res = await fetch('/api/user/me?user=' + encodeURIComponent(targetUser) + '&t=' + Date.now(), {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        return false;
    }
}

function showNetworkErrorBanner() {
    var mDiv = getMessagesDiv();
    if (!mDiv) return;
    
    var oldBanner = document.getElementById('msb-net-error-banner');
    if (oldBanner) oldBanner.remove();

    var banner = document.createElement('div');
    banner.id = 'msb-net-error-banner';
    banner.style.cssText = 'background: rgba(239, 68, 68, 0.22); border: 1.5px solid #ef4444; border-left: 5px solid #ef4444; color: #fca5a5; padding: 10px 14px; border-radius: 8px; font-size: 13px; text-align: center; margin: 10px 0; font-weight: bold; animation: pulseLive 1.5s infinite; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);';
    banner.innerHTML = '⚠️ подождите пока наладится связь или наладится интеренет,передача данных отсутствует МСБ55115';
    
    mDiv.appendChild(banner);
    mDiv.scrollTop = mDiv.scrollHeight;
}

function clearNetworkErrorBanner() {
    var oldBanner = document.getElementById('msb-net-error-banner');
    if (oldBanner) oldBanner.remove();
}

async function flushRetryQueue() {
    if (pendingRetryQueue.length === 0) return;
    var isOnline = await checkServerConnection();
    if (!isOnline) return;

    clearNetworkErrorBanner();
    while (pendingRetryQueue.length > 0) {
        var queuedFormData = pendingRetryQueue.shift();
        try {
            await fetch('/api/send', { method: 'POST', body: queuedFormData });
        } catch (e) {
            pendingRetryQueue.unshift(queuedFormData);
            showNetworkErrorBanner();
            break;
        }
    }
    lastMessagesCount = -1;
    fetchMessages();
}

window.addEventListener('online', function() {
    flushRetryQueue();
});

setInterval(function() {
    if (pendingRetryQueue.length > 0) flushRetryQueue();
}, 4000);
// ==========================================
// ЧАСТЬ 3/11: Авторизация окна и синхронизация
// ==========================================

function syncMessengerAuth() {
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;
    var nameEl = document.getElementById('msg-my-name');
    var avEl = document.getElementById('my-avatar');
    var hdrEl = document.getElementById('msg-header-identity');
    var uName = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : '';
    if (nameEl) {
        nameEl.textContent = chatUser + (uName && uName !== chatUser ? ' (' + uName + ')' : '');
    }
    if (avEl && !avEl.querySelector('img')) {
        avEl.textContent = chatUser.substring(0, 2).toUpperCase();
    }
    if (hdrEl) {
        hdrEl.textContent = '👤 ' + chatUser;
    }
    if (!updateInterval) {
        updateInterval = setInterval(function() {
            if (document.visibilityState === 'hidden') return;
            var modal = document.getElementById('messenger-modal');
            if (modal && modal.style.display === 'flex') {
                fetchMessages();
            }
            loadFriendsAndRequests();
        }, 2500);
    }
    loadFriendsAndRequests();
}

function openMessengerWindow(targetPartnerName) {
    chatUser = getActiveChatIdentity();
    if (!chatUser) {
        alert('Сначала войдите в систему под своим подразделением и позывным!');
        return;
    }
    var modal = document.getElementById('messenger-modal');
    var wasAlreadyOpen = (modal && modal.style.display === 'flex');
    if (modal) {
        modal.style.display = 'flex';
    }
    syncMessengerAuth();
    if (typeof updateBroadcastTicker === 'function') {
        try { updateBroadcastTicker(); } catch (e) {}
    }
    if (wasAlreadyOpen && currentRoomId) {
        fetchMessages();
        loadFriendsAndRequests();
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
                selectChat({
                    name: cleanName,
                    isGroup: false,
                    avatar: '',
                    online: true
                });
            }
        } catch (err) {}
    }
    fetchMessages();
    loadFriendsAndRequests();
}
window.openMessengerWindow = openMessengerWindow;
// ==========================================
// ЧАСТЬ 4/11: Аватары, закрытие и Event Listeners
// ==========================================

function closeMessengerWindow() {
    var modal = document.getElementById('messenger-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    document.querySelectorAll('#messages video, #messages audio').forEach(function(media) {
        try { media.pause(); } catch (e) {}
    });
}
window.closeMessengerWindow = closeMessengerWindow;

function renderAvatarElement(el, name, avatarDataUrl) {
    if (!el) return;
    if (avatarDataUrl) {
        el.innerHTML = '<img src="' + avatarDataUrl + '" alt="av">';
    } else {
        el.innerHTML = '';
        el.textContent = (name || '?').substring(0, 2).toUpperCase();
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
            canvas.width = 160;
            canvas.height = 160;
            var ctx = canvas.getContext('2d');
            var minSide = Math.min(img.width, img.height);
            var sx = (img.width - minSide) / 2;
            var sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 160, 160);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.75);
            fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: chatUser, avatar: dataUrl })
            }).then(function() {
                if (typeof allUsersAvatars !== 'undefined') {
                    allUsersAvatars[chatUser.toLowerCase()] = dataUrl;
                }
                renderAvatarElement(document.getElementById('my-avatar'), chatUser, dataUrl);
                loadFriendsAndRequests();
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

document.addEventListener('DOMContentLoaded', function() {
    var tInput = document.getElementById('text-input');
    var fInput = document.getElementById('new-friend-name');
    if (tInput) {
        tInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendMessage();
        });
    }
    if (fInput) {
        fInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendFriendRequest();
        });
    }
    var savedTheme = localStorage.getItem('msb_app_theme') || 'military';
    if (typeof setAppTheme === 'function') {
        setAppTheme(savedTheme, true);
    }
    syncMessengerAuth();
});
// ==========================================
// ЧАСТЬ 5/11: Загрузка друзей, заявок и бейджей
// ==========================================

function loadFriendsAndRequests() {
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;
    fetch('/api/friends/get?user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (Array.isArray(data)) {
                friendsList = data;
                if (typeof myMessengerFriends !== 'undefined') {
                    myMessengerFriends = data;
                }
                if (typeof populateTargetSelect === 'function') {
                    populateTargetSelect();
                }
                renderFriends();
                updateTotalUnreadBadge();
            }
        }).catch(function() {});

    fetch('/api/friends/requests?user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (Array.isArray(data)) {
                friendRequests = data;
                renderRequests();
                updateTotalUnreadBadge();
            }
        }).catch(function() {});

    fetch('/api/user/me?user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d && d.avatar) {
                renderAvatarElement(document.getElementById('my-avatar'), chatUser, d.avatar);
            }
        }).catch(function() {});
}

function renderRequests() {
    var box = document.getElementById('requests-box');
    if (!box) return;
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
                '<span class="request-name">' + req + '</span>' +
                '<span class="request-label">Запрос в друзья</span>' +
            '</div>' +
            '<div class="request-actions">' +
                '<button class="req-btn req-accept" onclick="handleRequest(\'' + req + '\', \'accept\')">Принять</button>' +
                '<button class="req-btn req-decline" onclick="handleRequest(\'' + req + '\', \'decline\')">Отклонить</button>' +
            '</div>';
        box.appendChild(item);
    });
}
// ==========================================
// ЧАСТЬ 6/11: Рендер списка контактов и групп
// ==========================================

function renderFriends() {
    chatUser = getActiveChatIdentity();
    var box = document.getElementById('friends-box');
    if (!box || !chatUser) return;
    box.innerHTML = '';
    if (friendsList.length === 0) {
        box.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b; font-size:13px;">Список друзей пуст</div>';
        return;
    }
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
        var displayName = statusDot + friend.name + unitTag;
        var avInner = friend.avatar ? ('<img src="' + friend.avatar + '" alt="av">') : friend.name.substring(0, 2).toUpperCase();
        var friendDataEscaped = JSON.stringify({
            id: friend.id,
            name: friend.name,
            isGroup: friend.isGroup,
            avatar: friend.avatar || '',
            online: Boolean(friend.online)
        }).replace(/"/g, '&quot;');
        var callBtnsHTML =
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Аудиозвонок\', \'' + friend.name + '\')" title="Аудиозвонок">📞</button>' +
            '<button class="friend-call-mini" onclick="event.stopPropagation(); triggerCallInDev(\'Видеозвонок\', \'' + friend.name + '\')" title="Видеозвонок">🎥</button>';
        var delBtnHTML = '<button class="delete-friend-btn" onclick="deleteFriend(' + friendDataEscaped + ', event)">&times;</button>';
        item.innerHTML =
            '<div class="friend-info">' +
                '<div class="avatar" style="width:38px; height:38px; font-size:13px;" onclick="event.stopPropagation(); openAvatarInViewer(this, \'' + friend.name + '\')">' + avInner + '</div>' +
                '<div class="friend-meta">' +
                    '<div class="friend-name">' + displayName + '</div>' +
                    '<div class="friend-last-msg">' + friend.lastMessage + '</div>' +
                '</div>' +
                '<div class="friend-status-box">' + timeHTML + badgeHTML + '</div>' +
            '</div>' + callBtnsHTML + delBtnHTML;
        box.appendChild(item);
    });
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
        body: JSON.stringify({
            creator: chatUser,
            groupName: gName,
            members: memberArray
        })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) {
            nameInput.value = '';
            membersInput.value = '';
            closeGroupModal();
            loadFriendsAndRequests();
        }
    });
}
// ==========================================
// ЧАСТЬ 7/11: Выбор чата, сброс и удаление
// ==========================================

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
            if (isCurrentGroup && currentRoomId === friendObj.id) {
                resetChatArea();
            }
            loadFriendsAndRequests();
        });
        return;
    }
    if (!confirm('Удалить ' + friendObj.name + ' из контактов?')) return;
    var cleanNames = friendsList.filter(function(f) {
        return !f.isGroup && f.name.toLowerCase() !== friendObj.name.toLowerCase();
    }).map(function(f) {
        return f.name;
    });
    if (!isCurrentGroup && currentPartner && currentPartner.toLowerCase() === friendObj.name.toLowerCase()) {
        resetChatArea();
    }
    fetch('/api/friends/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, friends: cleanNames })
    }).then(function() {
        loadFriendsAndRequests();
    });
}

function resetChatArea() {
    currentPartner = null;
    currentRoomId = null;
    isCurrentGroup = false;
    cancelReply();
    lastMessagesCount = -1;
    renderedMsgIds.clear();
    document.getElementById('partner-display-name').textContent = "Чат не выбран";
    document.getElementById('chat-status').style.display = "none";
    document.getElementById('text-input').setAttribute('disabled', 'true');
    document.getElementById('text-input').placeholder = "Сообщение...";
    var mDiv = getMessagesDiv();
    if (mDiv) {
        mDiv.innerHTML = '<div class="chat-placeholder">Выберите контакт или конференцию слева.</div>';
    }
}

function selectChat(itemObj) {
    chatUser = getActiveChatIdentity();
    var stEl = document.getElementById('chat-status');
    if (itemObj.isGroup) {
        currentPartner = itemObj.name;
        currentRoomId = itemObj.id;
        isCurrentGroup = true;
        if (stEl) {
            stEl.textContent = "👥 конференция";
            stEl.style.color = "#38bdf8";
        }
    } else {
        currentPartner = itemObj.name;
        isCurrentGroup = false;
        currentRoomId = makeDirectRoomId(chatUser, currentPartner);
        if (stEl) {
            stEl.textContent = itemObj.online ? "🟢 в сети" : "⚫ не в сети";
            stEl.style.color = itemObj.online ? "#4ade80" : "#94a3b8";
        }
    }
    document.getElementById('partner-display-name').textContent = currentPartner;
    renderAvatarElement(document.getElementById('partner-avatar'), currentPartner, itemObj.avatar);
    if (stEl) stEl.style.display = "block";
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
        document.getElementById('app-sidebar').classList.add('hidden');
    }
    var mDiv = getMessagesDiv();
    if (mDiv) mDiv.innerHTML = '';
    markChatAsRead(currentRoomId);
    fetchMessages();
    renderFriends();
}

function closeChatMobile() {
    document.getElementById('app-sidebar').classList.remove('hidden');
}

function markChatAsRead(roomId) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !roomId) return;
    fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, room: roomId })
    }).then(function() {
        loadFriendsAndRequests();
    });
}
// ==========================================
// ЧАСТЬ 8/11: Антидубликат и отправка сообщений
// ==========================================

async function executeSendFormData(formData, onSuccessCallback, onErrorCallback) {
    if (isSendingPayload) return false;

    var isOnline = await checkServerConnection();
    if (!isOnline) {
        showNetworkErrorBanner();
        if (onErrorCallback) onErrorCallback();
        return false;
    }

    clearNetworkErrorBanner();
    isSendingPayload = true;

    if (!formData.has('clientMsgId')) {
        formData.append('clientMsgId', Date.now() + '_' + Math.random().toString(36).substring(2, 9));
    }

    var controller = new AbortController();
    var sendTimer = setTimeout(function() { controller.abort(); }, 6000);

    fetch('/api/send', {
        method: 'POST',
        body: formData,
        signal: controller.signal
    })
    .then(function(res) {
        clearTimeout(sendTimer);
        if (!res.ok) throw new Error('Send failed');
        if (onSuccessCallback) onSuccessCallback();
        lastMessagesCount = -1;
        fetchMessages();
    })
    .catch(function(err) {
        clearTimeout(sendTimer);
        showNetworkErrorBanner();
        pendingRetryQueue.push(formData);
        if (onErrorCallback) onErrorCallback();
    })
    .finally(function() {
        isSendingPayload = false;
    });

    return true;
}

async function sendMessage() {
    chatUser = getActiveChatIdentity();
    var textInput = document.getElementById('text-input');
    var sendBtn = document.getElementById('send-btn');
    if (!textInput) return;
    var text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;

    textInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    var formData = new FormData();
    formData.append('sender', chatUser);
    formData.append('room', currentRoomId);
    formData.append('text', text);
    formData.append('type', 'text');

    if (quotedMessageId) {
        formData.append('quoteId', quotedMessageId);
        formData.append('quoteText', quotedMessageText);
        formData.append('quoteSender', quotedMessageSender);
        cancelReply();
    }

    await executeSendFormData(formData, function() {
        textInput.value = '';
    }, function() {});

    textInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    textInput.focus();
}

function uploadAnyFile(inputElement) {
    chatUser = getActiveChatIdentity();
    if (!inputElement.files || inputElement.files.length === 0 || !chatUser || !currentRoomId) return;
    var file = inputElement.files.item(0);
    var formData = new FormData();
    formData.append('sender', chatUser);
    formData.append('room', currentRoomId);
    formData.append('type', 'file');
    formData.append('media', file, file.name);
    if (quotedMessageId) {
        formData.append('quoteId', quotedMessageId);
        formData.append('quoteText', quotedMessageText);
        formData.append('quoteSender', quotedMessageSender);
        cancelReply();
    }
    executeSendFormData(formData, function() {
        inputElement.value = '';
    });
}
// ==========================================
// ЧАСТЬ 9/11: Запись Voice и Video-сообщений
// ==========================================

function toggleVoiceRecord() {
    chatUser = getActiveChatIdentity();
    if (!currentRoomId) return alert("Сначала выберите чат слева!");
    var btn = document.getElementById('voice-btn');
    if (audioRecorder && audioRecorder.state === "recording") {
        audioRecorder.stop();
        btn.classList.remove('recording');
        btn.textContent = "⏳";
    } else {
        navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 }
        }).then(function(stream) {
            audioChunks = new Array();
            var options = { audioBitsPerSecond: 24000 };
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/mp4')) options.mimeType = 'audio/mp4';
            audioRecorder = new MediaRecorder(stream, options);
            audioRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
            audioRecorder.onstop = function() {
                var mimeUsed = audioRecorder.mimeType || 'audio/webm';
                var ext = mimeUsed.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
                var blob = new Blob(audioChunks, { type: mimeUsed });
                var formData = new FormData();
                formData.append('sender', chatUser);
                formData.append('room', currentRoomId);
                formData.append('type', 'audio');
                formData.append('media', blob, 'voice.' + ext);
                if (quotedMessageId) {
                    formData.append('quoteId', quotedMessageId);
                    formData.append('quoteText', quotedMessageText);
                    formData.append('quoteSender', quotedMessageSender);
                    cancelReply();
                }

                executeSendFormData(formData, function() {
                    btn.textContent = "🎙️";
                }, function() {
                    btn.textContent = "🎙️";
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
        btn.textContent = "⏳";
        preview.style.display = 'none';
        if (preview.srcObject) {
            preview.srcObject.getTracks().forEach(function(t) { t.stop(); });
            preview.srcObject = null;
        }
    } else {
        navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 },
            video: { width: { ideal: 180, max: 220 }, height: { ideal: 180, max: 220 }, frameRate: { ideal: 15, max: 18 }, facingMode: "user" }
        }).then(function(stream) {
            videoChunks = new Array();
            videoStreamRef = stream;
            preview.srcObject = stream;
            preview.style.display = 'block';
            var mime = '';
            if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) mime = 'video/mp4;codecs=avc1,mp4a.40.2';
            else if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';
            else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mime = 'video/webm;codecs=vp8,opus';
            else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';
            var recOptions = { videoBitsPerSecond: 150000, audioBitsPerSecond: 24000 };
            if (mime) recOptions.mimeType = mime;
            videoRecorder = new MediaRecorder(stream, recOptions);
            videoRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
            videoRecorder.onstop = function() {
                var blob = new Blob(videoChunks, { type: videoRecorder.mimeType || 'video/mp4' });
                var fileExt = (videoRecorder.mimeType && videoRecorder.mimeType.indexOf('mp4') !== -1) ? 'mp4' : 'webm';
                var formData = new FormData();
                formData.append('sender', chatUser);
                formData.append('room', currentRoomId);
                formData.append('type', 'video');
                formData.append('media', blob, 'video.' + fileExt);
                if (quotedMessageId) {
                    formData.append('quoteId', quotedMessageId);
                    formData.append('quoteText', quotedMessageText);
                    formData.append('quoteSender', quotedMessageSender);
                    cancelReply();
                }

                executeSendFormData(formData, function() {
                    btn.textContent = "🎥";
                }, function() {
                    btn.textContent = "🎥";
                });

                if (videoStreamRef) videoStreamRef.getTracks().forEach(function(t) { t.stop(); });
            };
            videoRecorder.start(400);
            btn.classList.add('recording');
            btn.textContent = "🛑";
        }).catch(function() { alert("Нет доступа к камере!"); });
    }
}
// ==========================================
// ОКНО 10: СЛЕЖЕНИЕ ЗА СЕТЬЮ И ОБРАБОТЧИКИ UI
// ==========================================

// Очистка очереди при смене чата
function clearPendingQueueForCurrentRoom() {
    if (!currentRoomId) return;
    pendingRetryQueue = pendingRetryQueue.filter(function(item) {
        return item.room !== currentRoomId;
    });
}

// Глобальное слежение за возвращением связи
window.addEventListener('online', function() {
    clearNetworkErrorBanner();
    flushRetryQueue();
    if (currentRoomId) {
        fetchMessages();
        markChatAsRead(currentRoomId);
    }
});

// Периодическая фоновая проверка и выталкивание очереди
setInterval(function() {
    if (pendingRetryQueue.length > 0) {
        flushRetryQueue();
    }
}, 4000);

// Инициализация при загрузке документа
document.addEventListener('DOMContentLoaded', function() {
    var tInput = document.getElementById('text-input');
    var fInput = document.getElementById('new-friend-name');

    if (tInput) {
        tInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (fInput) {
        fInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendFriendRequest();
            }
        });
    }

    var savedTheme = localStorage.getItem('msb_app_theme') || 'military';
    if (typeof setAppTheme === 'function') {
        setAppTheme(savedTheme, true);
    }
    syncMessengerAuth();
});

// Экспорт критических функций в глобальную область видимости
window.openMessengerWindow = openMessengerWindow;
window.closeMessengerWindow = closeMessengerWindow;
window.selectChat = selectChat;
window.sendMessage = sendMessage;
window.toggleVoiceRecord = toggleVoiceRecord;
window.toggleVideoRecord = toggleVideoRecord;
window.uploadAnyFile = uploadAnyFile;
window.flushRetryQueue = flushRetryQueue;
// ==========================================
// ОКНО 11: СЕРВЕРНАЯ ПРОВЕРКА ДУБЛИКАТОВ И СТАТУС
// ==========================================

// Вставка в функцию saveMultipartChatMsg в server.js перед сохранением:
function checkAndFilterDuplicates(fields, room, sender, type, finalContent) {
    const clientMsgId = fields.clientMsgId || null;

    if (!Array.isArray(roomsDB[room]) || roomsDB[room].length === 0) {
        return false; // Дубликатов нет, сохраняем
    }

    const recent = roomsDB[room].slice(-8); // Анализ последних сообщений в комнате
    const isDup = recent.some(function(m) {
        // 1. Точное совпадение по уникальному clientMsgId
        if (clientMsgId && m.clientMsgId && m.clientMsgId === clientMsgId) {
            return true;
        }

        // 2. Защита от дублей при дребезге клика (текст, автор и окно < 2.5 сек)
        const sameAuthor = String(m.sender || '').trim().toLowerCase() === String(sender || '').trim().toLowerCase();
        const sameBody = (type === 'text' && m.text === finalContent);
        const withinTimeWindow = (Date.now() - (m.timestamp || 0)) < 2500;

        return sameAuthor && sameBody && withinTimeWindow;
    });

    return isDup;
}

// Обновленная сигнатура вставки в roomsDB:
function appendVerifiedMessage(room, msgPayload) {
    if (!Array.isArray(roomsDB[room])) {
        roomsDB[room] = [];
    }
    roomsDB[room].push(msgPayload);
    if (roomsDB[room].length > 150) {
        roomsDB[room].shift();
    }
    writeJSON(CHAT_ROOMS_FILE, roomsDB);
}
