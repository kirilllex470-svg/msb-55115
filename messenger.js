// --- МОДУЛЬ ДОСТАВКИ ДЛЯ СЕТИ 2G / EDGE ("E") ---
const OUTBOX_KEY = 'msb_outbox_edge_v3';
let isSendingNow = false;

function isSlowEdgeNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const t = String(conn.effectiveType || '').toLowerCase();
    return (t === 'slow-2g' || t === '2g' || (conn.downlink && conn.downlink < 0.4));
}

function getOutbox() {
    try {
        const raw = localStorage.getItem(OUTBOX_KEY);
        return raw ? JSON.parse(raw) : new Array();
    } catch (e) {
        return new Array();
    }
}

function saveOutbox(queue) {
    try {
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
    } catch (e) {}
}

function enqueueMessage(payload) {
    const queue = getOutbox();
    const task = {
        localId: 'loc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        sender: payload.sender,
        room: payload.room,
        text: payload.text || '',
        type: payload.type || 'text',
        quoteId: payload.quoteId || null,
        quoteText: payload.quoteText || null,
        quoteSender: payload.quoteSender || null,
        forwardedFrom: payload.forwardedFrom || null,
        mediaBase64: payload.mediaBase64 || null,
        mediaName: payload.mediaName || 'file.bin'
    };
    queue.push(task);
    saveOutbox(queue);
    processOutboxQueue();
    return task;
}

async function processOutboxQueue() {
    if (isSendingNow) return;
    if (getOutbox().length === 0) return;

    isSendingNow = true;

    while (getOutbox().length > 0) {
        const currentList = getOutbox();
        const currentTask = currentList.at(0);
        if (!currentTask) break;

        try {
            const limitMs = currentTask.mediaBase64 ? 90000 : 30000;
            await sendTaskToServer(currentTask, limitMs);

            const afterSend = getOutbox();
            afterSend.shift();
            saveOutbox(afterSend);

            lastMessagesCount = -1;
            if (typeof fetchMessages === 'function') {
                fetchMessages();
            }
        } catch (err) {
            await new Promise(function(r) { setTimeout(r, 4000); });
            break;
        }
    }

    isSendingNow = false;
}

function sendTaskToServer(task, timeoutMs) {
    return new Promise(async function(resolve, reject) {
        const controller = new AbortController();
        const timer = setTimeout(function() { controller.abort(); }, timeoutMs);

        try {
            const formData = new FormData();
            formData.append('sender', task.sender);
            formData.append('room', task.room);
            formData.append('type', task.type);
            if (task.text) formData.append('text', task.text);
            if (task.quoteId) {
                formData.append('quoteId', task.quoteId);
                formData.append('quoteText', task.quoteText);
                formData.append('quoteSender', task.quoteSender);
            }
            if (task.forwardedFrom) {
                formData.append('forwardedFrom', task.forwardedFrom);
            }
            if (task.mediaBase64) {
                const resBlob = await fetch(task.mediaBase64);
                const blob = await resBlob.blob();
                formData.append('media', blob, task.mediaName);
            }

            const res = await fetch('/api/send', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timer);
            if (res.ok) resolve(true);
            else reject(new Error('HTTP ' + res.status));
        } catch (e) {
            clearTimeout(timer);
            reject(e);
        }
    });
}

window.addEventListener('online', function() { processOutboxQueue(); });
setInterval(function() {
    if (!isSendingNow && getOutbox().length > 0) {
        processOutboxQueue();
    }
}, 5000);

// --- ОСНОВНЫЕ ПЕРЕМЕННЫЕ МЕССЕНДЖЕРА ---
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
    return localStorage.getItem('journal_callsign') || localStorage.getItem('chat_username') || localStorage.getItem('journal_user') || null;
}

function makeDirectRoomId(u1, u2) {
    var sorted = Array.of(
        String(u1 || '').trim().toLowerCase(),
        String(u2 || '').trim().toLowerCase()
    ).sort();
    var pair = sorted.join(',');
    return pair + '_' + pair;
}
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
        var tickCounter = 0;
        updateInterval = setInterval(function() {
            if (document.visibilityState === 'hidden') return;
            if (isSendingNow) return;

            tickCounter++;
            var slow = isSlowEdgeNetwork();
            if (slow && (tickCounter % 3 !== 0)) return;

            var modal = document.getElementById('messenger-modal');
            if (modal && modal.style.display === 'flex') {
                fetchMessages();
            }
            if (!slow || (tickCounter % 6 === 0)) {
                loadFriendsAndRequests();
            }
        }, 3000);
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
        try {
            updateBroadcastTicker();
        } catch (e) {}
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
function closeMessengerWindow() {
    var modal = document.getElementById('messenger-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    document.querySelectorAll('#messages video, #messages audio').forEach(function(media) {
        try {
            media.pause();
        } catch (e) {}
    });
}

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
    var tInput = document.getElementById('text-input');
    if (tInput) {
        tInput.removeAttribute('disabled');
        tInput.disabled = false;
        tInput.placeholder = "Написать сообщение...";
    }
    if (window.innerWidth  0) audioChunks.push(e.data); };
            audioRecorder.onstop = function() {
                var mimeUsed = audioRecorder.mimeType || 'audio/webm';
                var ext = mimeUsed.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
                var blob = new Blob(audioChunks, { type: mimeUsed });
                var qId = quotedMessageId, qTxt = quotedMessageText, qSnd = quotedMessageSender;
                cancelReply();
                var reader = new FileReader();
                reader.onloadend = function() {
                    enqueueMessage({
                        sender: chatUser,
                        room: currentRoomId,
                        type: 'audio',
                        mediaBase64: reader.result,
                        mediaName: 'voice.' + ext,
                        quoteId: qId,
                        quoteText: qTxt,
                        quoteSender: qSnd
                    });
                    btn.textContent = "🎙️";
                };
                reader.readAsDataURL(blob);
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
            video: { width: { ideal: 160, max: 200 }, height: { ideal: 160, max: 200 }, frameRate: { ideal: 12, max: 15 }, facingMode: "user" }
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
            var recOptions = { videoBitsPerSecond: 90000, audioBitsPerSecond: 12000 };
            if (mime) recOptions.mimeType = mime;
            videoRecorder = new MediaRecorder(stream, recOptions);
            videoRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
            videoRecorder.onstop = function() {
                var blob = new Blob(videoChunks, { type: videoRecorder.mimeType || 'video/mp4' });
                var fileExt = (videoRecorder.mimeType && videoRecorder.mimeType.indexOf('mp4') !== -1) ? 'mp4' : 'webm';
                var qId = quotedMessageId, qTxt = quotedMessageText, qSnd = quotedMessageSender;
                cancelReply();
                var vReader = new FileReader();
                vReader.onloadend = function() {
                    enqueueMessage({
                        sender: chatUser,
                        room: currentRoomId,
                        type: 'video',
                        mediaBase64: vReader.result,
                        mediaName: 'video.' + fileExt,
                        quoteId: qId,
                        quoteText: qTxt,
                        quoteSender: qSnd
                    });
                    btn.textContent = "🎥";
                };
                vReader.readAsDataURL(blob);
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
    inputElement.value = '';
    var qId = quotedMessageId, qTxt = quotedMessageText, qSnd = quotedMessageSender;
    cancelReply();

    if (file.type && file.type.indexOf('image/') === 0 && file.type.indexOf('gif') === -1) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                var maxSide = isSlowEdgeNetwork() ? 520 : 800;
                var w = img.width, h = img.height;
                if (w > maxSide || h > maxSide) {
                    if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
                    else { w = Math.round(w * maxSide / h); h = maxSide; }
                }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                var compressedDataUrl = canvas.toDataURL('image/jpeg', isSlowEdgeNetwork() ? 0.45 : 0.65);
                var safeName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
                enqueueMessage({
                    sender: chatUser, room: currentRoomId, type: 'file',
                    mediaBase64: compressedDataUrl, mediaName: safeName,
                    quoteId: qId, quoteText: qTxt, quoteSender: qSnd
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        return;
    }

    var fReader = new FileReader();
    fReader.onloadend = function() {
        enqueueMessage({
            sender: chatUser, room: currentRoomId, type: 'file',
            mediaBase64: fReader.result, mediaName: file.name,
            quoteId: qId, quoteText: qTxt, quoteSender: qSnd
        });
    };
    fReader.readAsDataURL(file);
}

function sendMessage() {
    chatUser = getActiveChatIdentity();
    var textInput = document.getElementById('text-input');
    if (!textInput) return;
    var text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;

    var payload = {
        sender: chatUser,
        room: currentRoomId,
        text: text,
        type: 'text',
        quoteId: quotedMessageId,
        quoteText: quotedMessageText,
        quoteSender: quotedMessageSender
    };

    textInput.value = '';
    cancelReply();
    enqueueMessage(payload);
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
        try {
            displayStr = '📎 Файл: ' + JSON.parse(rawText).name;
        } catch (e) {}
    }

    container.addEventListener('touchstart', function(e) {
        var touch = e.touches.item(0);
        startX = touch.clientX;
        startY = touch.clientY;
        isSwiping = true;
        isHorizontal = false;
        container.style.transition = 'none';
    }, { passive: true });
    container.addEventListener('touchmove', function(e) {
        if (!isSwiping) return;
        var touch = e.touches.item(0);
        var diffX = touch.clientX - startX;
        var diffY = touch.clientY - startY;
        if (!isHorizontal && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8) {
            isHorizontal = true;
        }
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
        leftIndicator.style.opacity = '0';
        rightIndicator.style.opacity = '0';
        if (currentX > 50) {
            handleQuoteTrigger(msgId, displayStr, sender);
        } else if (currentX < -50) {
            handleForwardTrigger(msgId, rawText, msgType, sender);
        }
        currentX = 0;
    });
}

function handleQuoteTrigger(id, text, sender) {
    quotedMessageId = id;
    quotedMessageText = text;
    quotedMessageSender = sender;
    var bar = document.getElementById('reply-bar');
    var textEl = document.getElementById('reply-bar-text');
    textEl.textContent = 'Цитата от ' + sender + ': ' + text;
    bar.style.display = 'flex';
    document.getElementById('text-input').focus();
}

function cancelReply() {
    quotedMessageId = null;
    quotedMessageText = null;
    quotedMessageSender = null;
    var bar = document.getElementById('reply-bar');
    if (bar) bar.style.display = 'none';
}

function handleForwardTrigger(id, text, type, sender) {
    activeMessageId = id;
    activeMessageText = text;
    activeMessageType = type;
    activeMessageOriginalSender = sender;
    var modal = document.getElementById('forward-modal');
    var listContainer = document.getElementById('modal-contacts-list');
    listContainer.innerHTML = '';
    if (friendsList.length === 0) {
        listContainer.innerHTML = '<div style="color:#64748b;font-size:14px;text-align:center;">Нет контактов</div>';
    } else {
        friendsList.forEach(function(f) {
            var item = document.createElement('div');
            item.className = 'modal-item';
            item.innerHTML = '<span>' + (f.isGroup ? '👥 ' : (f.online ? '🟢 ' : '⚫ ')) + f.name + '</span><span class="modal-forward-icon">➔</span>';
            item.onclick = function() { executeForward(f); };
            listContainer.appendChild(item);
        });
    }
    modal.style.display = 'flex';
}

function closeForwardModal() {
    document.getElementById('forward-modal').style.display = 'none';
}

function executeForward(targetObj) {
    chatUser = getActiveChatIdentity();
    var targetRoomId = targetObj.isGroup ? targetObj.id : makeDirectRoomId(chatUser, targetObj.name);
    var originalAuthor = activeMessageOriginalSender || chatUser;
    if (activeMessageType === 'audio' || activeMessageType === 'video' || activeMessageType === 'file') {
        var fileUrl = activeMessageType === 'file' ? JSON.parse(activeMessageText).path : activeMessageText;
        fetch(fileUrl).then(function(res) { return res.blob(); }).then(function(blob) {
            var fReader = new FileReader();
            fReader.onloadend = function() {
                enqueueMessage({
                    sender: chatUser, room: targetRoomId, type: activeMessageType,
                    mediaBase64: fReader.result, mediaName: 'media_file', forwardedFrom: originalAuthor
                });
                closeForwardModal();
            };
            fReader.readAsDataURL(blob);
        });
    } else {
        enqueueMessage({
            sender: chatUser, room: targetRoomId, type: activeMessageType || 'text',
            text: activeMessageText, forwardedFrom: originalAuthor
        });
        closeForwardModal();
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
        lastMessagesCount = -1;
        fetchMessages();
    });
}

function fetchMessages() {
    chatUser = getActiveChatIdentity();
    var mDiv = getMessagesDiv();
    if (!chatUser || !currentRoomId || !mDiv) return;
    var modal = document.getElementById('messenger-modal');
    var isModalOpen = modal && modal.style.display === 'flex';

    fetch('/api/messages?room=' + encodeURIComponent(currentRoomId) + '&user=' + encodeURIComponent(chatUser) + '&t=' + Date.now())
    .then(function(res) { return res.json(); })
    .then(function(resp) {
        var data = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.messages) ? resp.messages : new Array());
        var partnerOnline = (resp && typeof resp.partnerOnline === 'boolean') ? resp.partnerOnline : false;
        if (!isCurrentGroup && currentPartner) {
            var stEl = document.getElementById('chat-status');
            if (stEl) {
                stEl.style.display = 'block';
                stEl.textContent = partnerOnline ? '🟢 в сети' : '⚫ не в сети';
                stEl.style.color = partnerOnline ? '#4ade80' : '#94a3b8';
            }
        }
        if (data.length === 0) {
            if (lastMessagesCount !== 0) {
                renderedMsgIds.clear();
                lastMessagesCount = 0;
                mDiv.innerHTML = '<div class="chat-placeholder">История сообщений пуста.</div>';
            }
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
            var row = document.createElement('div');
            row.className = 'message-row ' + (isMy ? 'my-msg' : 'other-msg');
            row.setAttribute('data-msg-id', msg.id);
            row.innerHTML = '<div class="swipe-indicator left-indicator">💬</div><div class="swipe-container"><div class="bubble"></div></div><div class="swipe-indicator right-indicator">↪️</div>';
            var bubble = row.querySelector('.bubble');
            var quoteHTML = (msg.quoteId && msg.quoteText) ? ('<div class="msg-quote-block"><div class="msg-quote-author">' + (msg.quoteSender || 'Система') + '</div>' + msg.quoteText + '</div>') : '';
            var forwardHTML = msg.forwardedFrom ? ('<div class="msg-forwarded-label">↪ Переслано от: ' + msg.forwardedFrom + '</div>') : '';
            var authorHTML = (isCurrentGroup && !isMy) ? ('<div class="msg-author">' + msg.sender + '</div>') : '';
            var delBtnHTML = '<button class="msg-del-inline-btn" onclick="inlineDeleteMessage(\'' + msg.id + '\')">&times;</button>';
            var contentHTML = '';
            if (msg.type === 'audio') {
                contentHTML = '<audio class="audio-player" src="' + msg.text + '" controls preload="metadata" style="display:block; max-width:100%;"></audio>';
            } else if (msg.type === 'video') {
                contentHTML = '<video class="video-round" src="' + msg.text + '#t=0.001" playsinline muted loop preload="metadata" style="display:block;" onclick="playVideoWithSound(this)"></video>';
            } else if (msg.type === 'gif') {
                contentHTML = '<img class="chat-image" src="' + msg.text + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'🎬 GIF от ' + msg.sender + '\')">';
            } else if (msg.type === 'file') {
                try {
                    var fileObj = JSON.parse(msg.text);
                    var ext = fileObj.name.split('.').pop().toLowerCase();
                    if (Array.of('jpg', 'jpeg', 'png', 'gif', 'webp').includes(ext)) {
                        contentHTML = '<img class="chat-image" src="' + fileObj.path + '" loading="lazy" onclick="openMsgPhotoViewer(this.src, \'📷 Фото: ' + fileObj.name + '\')">';
                    } else {
                        contentHTML = '<a href="' + fileObj.path + '" target="_blank" class="chat-file-card"><span class="chat-file-icon">📄</span><div class="chat-file-info"><span class="chat-file-name">' + fileObj.name + '</span><span class="chat-file-action">Скачать</span></div></a>';
                    }
                } catch (e) {
                    contentHTML = '<div class="msg-text">Поврежденный файл</div>';
                }
            } else {
                contentHTML = '<div class="msg-text">' + msg.text + '</div>';
            }
            bubble.innerHTML = delBtnHTML + quoteHTML + forwardHTML + authorHTML + contentHTML + '<div class="msg-time">' + msg.time + checkIcon + '</div>';
            mDiv.appendChild(row);
            setupSwipe(row, msg.id, msg.text, msg.type, msg.sender);
        });
        lastMessagesCount = data.length;
        if (addedNew) setTimeout(function() { mDiv.scrollTop = mDiv.scrollHeight; }, 50);
        if (isModalOpen && (addedNew || hasUnreadIncoming) && currentPartner) {
            fetch('/api/messages/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: chatUser, room: currentRoomId }) });
        }
    }).catch(function() {});
}

function playVideoWithSound(v) {
    document.querySelectorAll('#messages video.video-round').forEach(function(other) {
        if (other !== v) { other.muted = true; other.pause(); }
    });
    if (!v.paused && !v.muted) {
        v.muted = true; v.pause();
    } else {
        v.muted = false; v.loop = false; v.currentTime = 0;
        v.play().catch(function() {});
        v.onended = function() { v.muted = true; v.pause(); v.currentTime = 0; };
    }
}

function sendFriendRequest() {
    chatUser = getActiveChatIdentity();
    var input = document.getElementById('new-friend-name');
    if (!input) return;
    var targetName = input.value.trim();
    if (!targetName) return alert('Введите позывной для добавления в друзья!');
    if (!chatUser) return alert('Сначала войдите в систему!');
    if (targetName.toLowerCase() === chatUser.toLowerCase()) return alert('Нельзя добавить самого себя!');
    fetch('/api/friends/request/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: chatUser, to: targetName })
    }).then(function(res) { return res.json(); }).then(function(data) {
        if (data && data.success) {
            input.value = '';
            alert('✅ Заявка в друзья отправлена позывному: ' + targetName);
            loadFriendsAndRequests();
        } else {
            alert('❌ ' + (data && data.message ? data.message : 'Ошибка отправки заявки'));
        }
    }).catch(function() { alert('❌ Ошибка связи с сервером'); });
}

function handleRequest(fromUser, action) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !fromUser) return;
    fetch('/api/friends/request/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, from: fromUser, action: action })
    }).then(function() { loadFriendsAndRequests(); }).catch(function() {});
}

function updateTotalUnreadBadge() {
    var badge = document.getElementById('msg-unread-total');
    if (!badge) return;
    var total = 0;
    if (Array.isArray(friendsList)) friendsList.forEach(function(f) { if (f && f.unread > 0) total += f.unread; });
    if (Array.isArray(friendRequests)) total += friendRequests.length;
    if (total > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = total;
    } else {
        badge.style.display = 'none';
    }
}

window.openMessengerWindow = openMessengerWindow;
window.closeMessengerWindow = closeMessengerWindow;
window.selectChat = selectChat;
window.closeChatMobile = closeChatMobile;
window.sendMessage = sendMessage;
window.toggleVoiceRecord = toggleVoiceRecord;
window.toggleVideoRecord = toggleVideoRecord;
window.uploadAnyFile = uploadAnyFile;
window.uploadMyAvatar = uploadMyAvatar;
window.deleteFriend = deleteFriend;
window.openCreateGroupModal = openCreateGroupModal;
window.closeGroupModal = closeGroupModal;
window.submitCreateGroup = submitCreateGroup;
window.sendFriendRequest = sendFriendRequest;
window.handleRequest = handleRequest;
window.closeForwardModal = closeForwardModal;
window.cancelReply = cancelReply;
window.inlineDeleteMessage = inlineDeleteMessage;
window.playVideoWithSound = playVideoWithSound;
window.syncMessengerAuth = syncMessengerAuth;
window.processOutboxQueue = processOutboxQueue;
