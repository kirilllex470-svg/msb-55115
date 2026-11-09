let chatUser = null;
let currentPartner = null;
let currentRoomId = null;
let isCurrentGroup = false;
let friendsList = [];
let friendRequests = [];
let updateInterval = null;
let lastMessagesCount = 0;
let audioRecorder = null;
let videoRecorder = null;
let audioChunks = [];
let videoChunks = [];
let videoStreamRef = null;

let activeMessageId = null;
let activeMessageText = null;
let activeMessageType = null;
let activeMessageOriginalSender = null;

let quotedMessageId = null;
let quotedMessageText = null;
let quotedMessageSender = null;

const messagesDiv = document.getElementById('messages');

function getActiveChatIdentity() {
    return currentCallsign || currentUser || localStorage.getItem('chat_username') || null;
}

function syncMessengerAuth() {
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;
    const nameEl = document.getElementById('msg-my-name');
    const avEl = document.getElementById('my-avatar');
    const hdrEl = document.getElementById('msg-header-identity');
    if (nameEl) nameEl.textContent = chatUser + (currentUser && currentUser !== chatUser ? ' (' + currentUser + ')' : '');
    if (avEl) avEl.textContent = chatUser.substring(0, 2).toUpperCase();
    if (hdrEl) hdrEl.textContent = '👤 ' + chatUser;
    if (!updateInterval) {
        updateInterval = setInterval(function() {
            if (document.getElementById('messenger-modal').style.display === 'flex') {
                fetchMessages();
            }
            loadFriendsAndRequests();
        }, 2000);
    }
    loadFriendsAndRequests();
}
function openMessengerWindow(targetPartnerName) {
    chatUser = getActiveChatIdentity();
    if (!chatUser) {
        alert('Сначала войдите в систему под своим подразделением и позывным!');
        return;
    }
    syncMessengerAuth();
    if (typeof updateBroadcastTicker === 'function') updateBroadcastTicker();
    const modal = document.getElementById('messenger-modal');
    if (modal) modal.style.display = 'flex';
    fetchMessages();
    loadFriendsAndRequests();
}

function closeMessengerWindow() {
    const modal = document.getElementById('messenger-modal');
    if (modal) modal.style.display = 'none';
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
    const file = inputEl.files.item(0);
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = 160; canvas.height = 160;
            const ctx = canvas.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2, sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 160, 160);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
            fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: chatUser, avatar: dataUrl })
            }).then(function() {
                allUsersAvatars[chatUser.toLowerCase()] = dataUrl;
                renderAvatarElement(document.getElementById('my-avatar'), chatUser, dataUrl);
                loadFriendsAndRequests();
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

document.addEventListener('DOMContentLoaded', function() {
    const tInput = document.getElementById('text-input');
    const fInput = document.getElementById('new-friend-name');
    const miniInput = document.getElementById('mini-notif-input');
    if (tInput) tInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') sendMessage(); });
    if (fInput) fInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') sendFriendRequest(); });
    if (miniInput) miniInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') sendMiniNotification(); });
    syncMessengerAuth();
});
function loadFriendsAndRequests() {
    chatUser = getActiveChatIdentity();
    if (!chatUser) return;
    fetch('/api/friends/get?user=' + encodeURIComponent(chatUser))
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (Array.isArray(data)) {
                friendsList = data;
                myMessengerFriends = data;
                if (typeof populateTargetSelect === 'function') populateTargetSelect();
                renderFriends();
                updateTotalUnreadBadge();
            }
        }).catch(function() {});
    fetch('/api/friends/requests?user=' + encodeURIComponent(chatUser))
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (Array.isArray(data)) {
                friendRequests = data;
                renderRequests();
                updateTotalUnreadBadge();
            }
        }).catch(function() {});
    fetch('/api/user/me?user=' + encodeURIComponent(chatUser))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d && d.avatar) renderAvatarElement(document.getElementById('my-avatar'), chatUser, d.avatar);
        }).catch(function() {});
}

function renderRequests() {
    const box = document.getElementById('requests-box');
    if (!box) return;
    box.innerHTML = '';
    if (friendRequests.length === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    friendRequests.forEach(function(req) {
        const item = document.createElement('div');
        item.className = 'request-item';
        item.innerHTML = '<div class="request-info"><span class="request-name">' + req + '</span><span class="request-label">Запрос в друзья</span></div>' +
            '<div class="request-actions"><button class="req-btn req-accept" onclick="handleRequest(\'' + req + '\', \'accept\')">Принять</button>' +
            '<button class="req-btn req-decline" onclick="handleRequest(\'' + req + '\', \'decline\')">Отклонить</button></div>';
        box.appendChild(item);
    });
}

function renderFriends() {
    chatUser = getActiveChatIdentity();
    const box = document.getElementById('friends-box');
    if (!box || !chatUser) return;
    box.innerHTML = '';
    if (friendsList.length === 0) {
        box.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b; font-size:13px;">Список друзей пуст</div>';
        return;
    }
    friendsList.forEach(function(friend) {
        const sorted = [chatUser.toLowerCase(), friend.name.toLowerCase()].sort();
        let activeId = friend.isGroup ? friend.id : (sorted + '_' + sorted);
        const isActive = currentRoomId && currentRoomId === activeId;
        const item = document.createElement('div');
        item.className = 'friend-item ' + (isActive ? 'active' : '');
        item.onclick = function() { selectChat(friend); };
        const badgeHTML = (friend.unread > 0 && !isActive) ? ('<div class="unread-badge">' + friend.unread + '</div>') : '';
        const timeHTML = friend.time ? ('<div class="friend-time-label">' + friend.time + '</div>') : '';
        const unitTag = (!friend.isGroup && friend.unit) ? (' <span style="color:#38bdf8;font-size:12px;">[' + friend.unit + ']</span>') : '';
        const displayName = (friend.isGroup ? ('👥 ' + friend.name) : friend.name) + unitTag;
        const avInner = friend.avatar ? ('<img src="' + friend.avatar + '" alt="av">') : friend.name.substring(0, 2).toUpperCase();
        const friendDataEscaped = JSON.stringify({ id: friend.id, name: friend.name, isGroup: friend.isGroup }).replace(/"/g, '&quot;');
        const delBtnHTML = '<button class="delete-friend-btn" onclick="deleteFriend(' + friendDataEscaped + ', event)">&times;</button>';
        item.innerHTML = '<div class="friend-info"><div class="avatar" style="width:38px; height:38px; font-size:13px;">' + avInner + '</div>' +
            '<div class="friend-meta"><div class="friend-name">' + displayName + '</div><div class="friend-last-msg">' + friend.lastMessage + '</div></div>' +
            '<div class="friend-status-box">' + timeHTML + badgeHTML + '</div></div>' + delBtnHTML;
        box.appendChild(item);
    });
}
function openCreateGroupModal() { document.getElementById('group-modal').style.display = 'flex'; }
function closeGroupModal() { document.getElementById('group-modal').style.display = 'none'; }

function submitCreateGroup() {
    chatUser = getActiveChatIdentity();
    const nameInput = document.getElementById('group-name-input');
    const membersInput = document.getElementById('group-members-input');
    const gName = nameInput.value.trim();
    const gMembersRaw = membersInput.value.trim();
    if (!gName || !gMembersRaw || !chatUser) return alert("Заполните поля!");
    const memberArray = gMembersRaw.split(',').map(function(m) { return m.trim(); }).filter(function(m) { return m !== ''; });
    fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: chatUser, groupName: gName, members: memberArray })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) { nameInput.value = ''; membersInput.value = ''; closeGroupModal(); loadFriendsAndRequests(); }
    });
}

function deleteFriend(friendObj, event) {
    chatUser = getActiveChatIdentity();
    if (event) event.stopPropagation();
    if (friendObj.isGroup) {
        if (!confirm('Удалить конференцию "' + friendObj.name + '" для всех участников?')) return;
        fetch('/api/groups/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: friendObj.id })
        }).then(function() {
            if (isCurrentGroup && currentRoomId === friendObj.id) resetChatArea();
            loadFriendsAndRequests();
        });
        return;
    }
    if (!confirm('Удалить ' + friendObj.name + ' из контактов?')) return;
    const cleanNames = friendsList.filter(function(f) { return !f.isGroup && f.name.toLowerCase() !== friendObj.name.toLowerCase(); }).map(function(f) { return f.name; });
    if (!isCurrentGroup && currentPartner && currentPartner.toLowerCase() === friendObj.name.toLowerCase()) resetChatArea();
    fetch('/api/friends/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, friends: cleanNames })
    }).then(function() { loadFriendsAndRequests(); });
}

function resetChatArea() {
    currentPartner = null; currentRoomId = null; isCurrentGroup = false; cancelReply();
    document.getElementById('partner-display-name').textContent = "Чат не выбран";
    document.getElementById('chat-status').style.display = "none";
    document.getElementById('text-input').setAttribute('disabled', 'true');
    document.getElementById('text-input').placeholder = "Сообщение...";
    if (messagesDiv) messagesDiv.innerHTML = '<div class="chat-placeholder">Выберите контакт или конференцию слева.</div>';
}

function selectChat(itemObj) {
    chatUser = getActiveChatIdentity();
    if (itemObj.isGroup) {
        currentPartner = itemObj.name; currentRoomId = itemObj.id; isCurrentGroup = true;
        document.getElementById('chat-status').textContent = "конференция";
    } else {
        currentPartner = itemObj.name; isCurrentGroup = false;
        const sorted = [chatUser.toLowerCase(), currentPartner.toLowerCase()].sort();
        currentRoomId = sorted + '_' + sorted;
        document.getElementById('chat-status').textContent = "в сети";
    }
    document.getElementById('partner-display-name').textContent = currentPartner;
    renderAvatarElement(document.getElementById('partner-avatar'), currentPartner, itemObj.avatar);
    document.getElementById('chat-status').style.display = "block";
    lastMessagesCount = 0; cancelReply();
    document.getElementById('text-input').removeAttribute('disabled');
    document.getElementById('text-input').placeholder = "Написать сообщение...";
    if (window.innerWidth < 768) document.getElementById('app-sidebar').classList.add('hidden');
    if (messagesDiv) messagesDiv.innerHTML = '';
    markChatAsRead(currentRoomId); fetchMessages(); renderFriends();
}

function closeChatMobile() { document.getElementById('app-sidebar').classList.remove('hidden'); }

function markChatAsRead(roomId) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !roomId) return;
    fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, room: roomId })
    }).then(function() { loadFriendsAndRequests(); });
}
function toggleVoiceRecord() {
    chatUser = getActiveChatIdentity();
    const btn = document.getElementById('voice-btn');
    if (audioRecorder && audioRecorder.state === "recording") {
        audioRecorder.stop(); btn.classList.remove('recording'); btn.textContent = "🎙️";
    } else {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
            audioChunks = [];
            let options = { mimeType: 'audio/webm; codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'audio/webm' };
            audioRecorder = new MediaRecorder(stream, options);
            audioRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
            audioRecorder.onstop = function() {
                const blob = new Blob(audioChunks, { type: audioRecorder.mimeType });
                const formData = new FormData();
                formData.append('sender', chatUser); formData.append('room', currentRoomId); formData.append('type', 'audio'); formData.append('media', blob, 'voice.webm');
                if (quotedMessageId) { formData.append('quoteId', quotedMessageId); formData.append('quoteText', quotedMessageText); formData.append('quoteSender', quotedMessageSender); cancelReply(); }
                fetch('/api/send', { method: 'POST', body: formData }).then(function() { fetchMessages(); });
                stream.getTracks().forEach(function(track) { track.stop(); });
            };
            audioRecorder.start(); btn.classList.add('recording'); btn.textContent = "🛑";
        }).catch(function() { alert("Нет доступа к микрофону!"); });
    }
}

function toggleVideoRecord() {
    chatUser = getActiveChatIdentity();
    const btn = document.getElementById('video-btn');
    const preview = document.getElementById('video-preview');
    if (videoRecorder && videoRecorder.state === "recording") {
        videoRecorder.stop(); btn.classList.remove('recording'); btn.textContent = "🎥"; preview.style.display = 'none';
        if (preview.srcObject) { preview.srcObject.getTracks().forEach(function(t) { t.stop(); }); preview.srcObject = null; }
    } else {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: 320, height: 320, facingMode: "user" } }).then(function(stream) {
            videoChunks = []; videoStreamRef = stream; preview.srcObject = stream; preview.style.display = 'block';
            let options = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2') ? { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2' } : (MediaRecorder.isTypeSupported('video/mp4') ? { mimeType: 'video/mp4' } : { mimeType: 'video/webm;codecs=vp8,opus' });
            videoRecorder = new MediaRecorder(stream, options);
            videoRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
            videoRecorder.onstop = function() {
                const blob = new Blob(videoChunks, { type: videoRecorder.mimeType || 'video/mp4' });
                const fileExt = (videoRecorder.mimeType && videoRecorder.mimeType.includes('mp4')) ? 'mp4' : 'webm';
                const formData = new FormData();
                formData.append('sender', chatUser); formData.append('room', currentRoomId); formData.append('type', 'video'); formData.append('media', blob, 'video.' + fileExt);
                if (quotedMessageId) { formData.append('quoteId', quotedMessageId); formData.append('quoteText', quotedMessageText); formData.append('quoteSender', quotedMessageSender); cancelReply(); }
                fetch('/api/send', { method: 'POST', body: formData }).then(function() { fetchMessages(); });
                if (videoStreamRef) videoStreamRef.getTracks().forEach(function(t) { t.stop(); });
            };
            videoRecorder.start(); btn.classList.add('recording'); btn.textContent = "🛑";
        }).catch(function() { alert("Нет доступа к камере!"); });
    }
}

function uploadAnyFile(inputElement) {
    chatUser = getActiveChatIdentity();
    if (!inputElement.files || inputElement.files.length === 0 || !chatUser || !currentRoomId) return;
    const file = inputElement.files[0];
    const formData = new FormData();
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
    fetch('/api/send', { method: 'POST', body: formData })
        .then(function() { inputElement.value = ''; fetchMessages(); })
        .catch(function() { alert("Ошибка отправки файла!"); });
}
function sendMessage() {
    chatUser = getActiveChatIdentity();
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    if (text === '' || !chatUser || !currentRoomId) return;
    const formData = new FormData();
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
    fetch('/api/send', { method: 'POST', body: formData }).then(function() {
        textInput.value = '';
        fetchMessages();
    });
}

function setupSwipe(rowElement, msgId, rawText, msgType, sender) {
    const container = rowElement.querySelector('.swipe-container');
    const leftIndicator = rowElement.querySelector('.left-indicator');
    const rightIndicator = rowElement.querySelector('.right-indicator');
    let startX = 0, startY = 0, currentX = 0, isSwiping = false, isHorizontal = false;
    let displayStr = rawText;
    if (msgType === 'audio') displayStr = "🎙️ Голосовое сообщение";
    if (msgType === 'video') displayStr = "🎥 Видео-кружок";
    if (msgType === 'file') { try { displayStr = '📎 Файл: ' + JSON.parse(rawText).name; } catch(e){} }

    container.addEventListener('touchstart', function(e) {
        const touch = e.touches.item(0);
        startX = touch.clientX; startY = touch.clientY;
        isSwiping = true; isHorizontal = false;
        container.style.transition = 'none';
    }, { passive: false });

    container.addEventListener('touchmove', function(e) {
        if (!isSwiping) return;
        const touch = e.touches.item(0);
        const diffX = touch.clientX - startX, diffY = touch.clientY - startY;
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
    const bar = document.getElementById('reply-bar');
    const textEl = document.getElementById('reply-bar-text');
    textEl.textContent = 'Цитата от ' + sender + ': ' + text;
    bar.style.display = 'flex';
    document.getElementById('text-input').focus();
}

function cancelReply() {
    quotedMessageId = null; quotedMessageText = null; quotedMessageSender = null;
    const bar = document.getElementById('reply-bar');
    if (bar) bar.style.display = 'none';
}

function handleForwardTrigger(id, text, type, sender) {
    activeMessageId = id; activeMessageText = text; activeMessageType = type; activeMessageOriginalSender = sender;
    const modal = document.getElementById('forward-modal');
    const listContainer = document.getElementById('modal-contacts-list');
    listContainer.innerHTML = '';
    if (friendsList.length === 0) {
        listContainer.innerHTML = '<div style="color:#64748b;font-size:14px;text-align:center;">Нет контактов</div>';
    } else {
        friendsList.forEach(function(f) {
            const item = document.createElement('div');
            item.className = 'modal-item';
            item.innerHTML = '<span>' + (f.isGroup ? '👥 ' : '') + f.name + '</span><span class="modal-forward-icon">➔</span>';
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
    const sorted = [chatUser.toLowerCase(), targetObj.name.toLowerCase()].sort();
    let targetRoomId = targetObj.isGroup ? targetObj.id : (sorted + '_' + sorted);
    let originalAuthor = activeMessageOriginalSender || chatUser;
    if (activeMessageType === 'audio' || activeMessageType === 'video' || activeMessageType === 'file') {
        let fileUrl = activeMessageType === 'file' ? JSON.parse(activeMessageText).path : activeMessageText;
        fetch(fileUrl).then(function(res) { return res.blob(); }).then(function(blob) {
            const formData = new FormData();
            formData.append('sender', chatUser); formData.append('room', targetRoomId); formData.append('type', activeMessageType); formData.append('forwardedFrom', originalAuthor); formData.append('media', blob, 'media_file');
            fetch('/api/send', { method: 'POST', body: formData }).then(function() { closeForwardModal(); loadFriendsAndRequests(); });
        });
    } else {
        const formData = new FormData();
        formData.append('sender', chatUser); formData.append('room', targetRoomId); formData.append('text', activeMessageText); formData.append('type', 'text'); formData.append('forwardedFrom', originalAuthor);
        fetch('/api/send', { method: 'POST', body: formData }).then(function() { closeForwardModal(); loadFriendsAndRequests(); });
    }
}

function inlineDeleteMessage(msgId) {
    if (!confirm("Удалить это сообщение?")) return;
    fetch('/api/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: currentRoomId, messageId: msgId })
    }).then(function() {
        lastMessagesCount = -1;
        fetchMessages();
    });
}

function fetchMessages() {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !currentRoomId) return;
    fetch('/api/messages?room=' + encodeURIComponent(currentRoomId)).then(function(res) { return res.json(); }).then(function(data) {
        if (data.length === lastMessagesCount) return;
        lastMessagesCount = data.length; messagesDiv.innerHTML = '';
        if (data.length === 0) { messagesDiv.innerHTML = '<div class="chat-placeholder">История сообщений пуста.</div>'; return; }
        data.forEach(function(msg) {
            const row = document.createElement('div');
            const isMy = msg.sender.toLowerCase() === chatUser.toLowerCase();
            row.className = 'message-row ' + (isMy ? 'my-msg' : 'other-msg');
            row.innerHTML = '<div class="swipe-indicator left-indicator">💬</div><div class="swipe-container"><div class="bubble"></div></div><div class="swipe-indicator right-indicator">↪️</div>';
            const bubble = row.querySelector('.bubble');
            let quoteHTML = (msg.quoteId && msg.quoteText) ? ('<div class="msg-quote-block"><div class="msg-quote-author">' + (msg.quoteSender || 'Система') + '</div>' + msg.quoteText + '</div>') : '';
            let forwardHTML = msg.forwardedFrom ? ('<div class="msg-forwarded-label">↪ Переслано от: ' + msg.forwardedFrom + '</div>') : '';
            let authorHTML = (isCurrentGroup && !isMy) ? ('<div class="msg-author">' + msg.sender + '</div>') : '';
            let delBtnHTML = '<button class="msg-del-inline-btn" onclick="inlineDeleteMessage(\'' + msg.id + '\')">&times;</button>';
            let contentHTML = '';
            if (msg.type === 'audio') contentHTML = '<audio class="audio-player" src="' + msg.text + '" controls preload="metadata" style="display:block; max-width:100%;"></audio>';
            else if (msg.type === 'video') contentHTML = '<video class="video-round" src="' + msg.text + '" playsinline autoplay muted loop style="display:block;" onclick="playVideoWithSound(this)"></video>';
            else if (msg.type === 'file') {
                try {
                    const fileObj = JSON.parse(msg.text); const ext = fileObj.name.split('.').pop().toLowerCase();
                    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) contentHTML = '<img class="chat-image" src="' + fileObj.path + '" onclick="window.open(this.src)">';
                    else contentHTML = '<a href="' + fileObj.path + '" target="_blank" class="chat-file-card"><span class="chat-file-icon">📄</span><div class="chat-file-info"><span class="chat-file-name">' + fileObj.name + '</span><span class="chat-file-action">Скачать</span></div></a>';
                } catch(e) { contentHTML = '<div class="msg-text">Поврежденный файл</div>'; }
            } else contentHTML = '<div class="msg-text">' + msg.text + '</div>';
            bubble.innerHTML = delBtnHTML + quoteHTML + forwardHTML + authorHTML + contentHTML + '<div class="msg-time">' + msg.time + '</div>';
            messagesDiv.appendChild(row);
            setupSwipe(row, msg.id, msg.text, msg.type, msg.sender);
        });
        setTimeout(function() { messagesDiv.scrollTop = messagesDiv.scrollHeight; }, 50);
        if (data.length > 0 && currentPartner) {
            fetch('/api/messages/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: chatUser, room: currentRoomId }) });
        }
    }).catch(function() {});
}

function playVideoWithSound(v) {
    if (!v.muted) { v.muted = true; v.loop = true; v.play(); }
    else { v.muted = false; v.loop = false; v.currentTime = 0; v.play(); v.onended = function() { v.muted = true; v.loop = true; v.currentTime = 0; v.play(); }; }
}

function sendFriendRequest() {
    chatUser = getActiveChatIdentity();
    const input = document.getElementById('new-friend-name');
    if (!input) return;
    const targetName = input.value.trim();
    if (!targetName) return alert('Введите позывной для добавления в друзья!');
    if (!chatUser) return alert('Сначала войдите в систему!');
    if (targetName.toLowerCase() === chatUser.toLowerCase()) {
        return alert('Нельзя добавить самого себя!');
    }
    fetch('/api/friends/request/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: chatUser, to: targetName })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data && data.success) {
            input.value = '';
            alert('✅ Заявка в друзья отправлена позывному: ' + targetName);
            loadFriendsAndRequests();
        } else {
            alert('❌ ' + (data && data.message ? data.message : 'Ошибка отправки заявки'));
        }
    })
    .catch(function() {
        alert('❌ Ошибка связи с сервером');
    });
}

function handleRequest(fromUser, action) {
    chatUser = getActiveChatIdentity();
    if (!chatUser || !fromUser) return;
    fetch('/api/friends/request/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: chatUser, from: fromUser, action: action })
    })
    .then(function() {
        loadFriendsAndRequests();
    })
    .catch(function() {});
}

function updateTotalUnreadBadge() {
    const badge = document.getElementById('msg-unread-total');
    if (!badge) return;
    let total = 0;
    if (Array.isArray(friendsList)) {
        friendsList.forEach(function(f) {
            if (f && f.unread > 0) total += f.unread;
        });
    }
    if (Array.isArray(friendRequests)) {
        total += friendRequests.length;
    }
    if (total > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = total;
    } else {
        badge.style.display = 'none';
    }
}
