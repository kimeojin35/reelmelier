let friends = [];
let editingIndex = -1;

// --- Friend Management ---

async function loadFriends() {
  friends = await getFriends();
  renderFriendChips();
}

function renderFriendChips() {
  const container = document.getElementById('friendChips');
  container.innerHTML = '';
  friends.forEach((friend, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span class="chip-name">${friend.name}</span><span class="chip-pref">${friend.preference}</span>`;
    chip.addEventListener('click', () => openEditFriend(index));
    container.appendChild(chip);
  });
}

function openAddFriend() {
  editingIndex = -1;
  document.getElementById('modalTitle').textContent = '친구 추가';
  document.getElementById('friendName').value = '';
  document.getElementById('friendPreference').value = '';
  document.getElementById('friendUsername').value = '';
  document.getElementById('modalDeleteBtn').classList.add('hidden');
  document.getElementById('friendModal').classList.remove('hidden');
}

function openEditFriend(index) {
  editingIndex = index;
  const friend = friends[index];
  document.getElementById('modalTitle').textContent = '친구 수정';
  document.getElementById('friendName').value = friend.name;
  document.getElementById('friendPreference').value = friend.preference;
  document.getElementById('friendUsername').value = friend.username;
  document.getElementById('modalDeleteBtn').classList.remove('hidden');
  document.getElementById('friendModal').classList.remove('hidden');
}

async function saveFriendFromModal() {
  const name = document.getElementById('friendName').value.trim();
  const preference = document.getElementById('friendPreference').value.trim();
  const username = document.getElementById('friendUsername').value.trim();
  if (!name || !preference || !username) return;

  const friend = { name, preference, username };
  if (editingIndex === -1) {
    friends.push(friend);
  } else {
    friends[editingIndex] = friend;
  }
  await saveFriends(friends);
  renderFriendChips();
  closeModal();
}

async function deleteFriend() {
  if (editingIndex === -1) return;
  friends.splice(editingIndex, 1);
  await saveFriends(friends);
  renderFriendChips();
  closeModal();
}

function closeModal() {
  document.getElementById('friendModal').classList.add('hidden');
}

// --- Login Check ---

async function checkLogin() {
  const btn = document.getElementById('checkLoginBtn');
  btn.textContent = '확인 중...';
  btn.disabled = true;

  chrome.runtime.sendMessage({ type: 'CHECK_INSTAGRAM' }, (profile) => {
    btn.disabled = false;
    btn.textContent = 'Instagram 로그인 확인';

    if (profile && profile.isLoggedIn && profile.username) {
      showProfile(profile);
      // Save profile for next popup open
      chrome.storage.local.set({ cachedProfile: profile });
    } else if (profile && profile.isLoggedIn) {
      showProfile({ ...profile, fullName: '로그인됨', username: '프로필을 불러올 수 없습니다' });
    } else {
      chrome.tabs.create({ url: 'https://www.instagram.com/accounts/login/', active: true });
      btn.textContent = '로그인 후 다시 확인';
    }
  });
}

function showProfile(profile) {
  document.getElementById('loginStatus').classList.add('hidden');
  const info = document.getElementById('profileInfo');
  info.classList.remove('hidden');
  document.getElementById('profilePic').src = profile.profilePic || '';
  document.getElementById('profilePic').style.display = profile.profilePic ? 'block' : 'none';
  document.getElementById('profileName').textContent = profile.fullName || profile.username;
  document.getElementById('profileUsername').textContent = profile.username ? `@${profile.username}` : '';
}

function loadCachedProfile() {
  chrome.storage.local.get(['cachedProfile'], (data) => {
    if (data.cachedProfile && data.cachedProfile.isLoggedIn) {
      showProfile(data.cachedProfile);
    }
  });
}

// --- Execution Control ---

let isRunning = false;

function startExecution() {
  const count = parseInt(document.getElementById('reelCount').value, 10);
  if (count < 1 || count > 50) return;
  if (friends.length === 0) {
    alert('친구를 먼저 추가하세요.');
    return;
  }

  isRunning = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('resultSection').classList.add('hidden');
  updateProgress(0, count, []);

  chrome.runtime.sendMessage({ type: 'START_SCAN', count, friends });
}

function stopExecution() {
  chrome.runtime.sendMessage({ type: 'STOP_SCAN' });
  isRunning = false;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('progressSection').classList.add('hidden');
  document.getElementById('resultSection').classList.remove('hidden');
  document.getElementById('resultContent').innerHTML =
    '<div style="color:#aaa;font-size:13px;padding:4px 0;">중지됨</div>';
}

function updateProgress(current, total, details) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progressText').textContent = `${current}/${total} 릴스 확인`;
  document.getElementById('progressPercent').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
  const detailText = details.length > 0 ? details.join(', ') : '';
  document.getElementById('progressDetail').textContent = detailText;
}

function showResult(result) {
  isRunning = false;
  document.getElementById('progressSection').classList.add('hidden');
  document.getElementById('resultSection').classList.remove('hidden');
  document.getElementById('startBtn').disabled = false;

  const container = document.getElementById('resultContent');
  let html = '';

  if (result.error) {
    html = `<div style="color:#d32f2f;font-size:13px;padding:8px 0;">${result.error}</div>`;
    container.innerHTML = html;
    return;
  }

  if (result.sent && result.sent.length > 0) {
    result.sent.forEach((s) => {
      html += `<div class="result-friend">
        <span class="result-friend-name">${s.friend}</span>
        <span class="result-friend-count">${s.reels.length}개 전송</span>
      </div>`;
    });
  }

  if (result.failed && result.failed.length > 0) {
    result.failed.forEach((f) => {
      html += `<div class="result-friend">
        <span class="result-friend-name">${f.friend}</span>
        <span style="color:#d32f2f;font-size:12px;">전송 실패</span>
      </div>`;
    });
  }

  html += `<div class="result-summary">
    총 ${result.totalReels}개 탐색 · ${result.matched}개 매칭 · ${result.skipped}개 패스
  </div>`;

  container.innerHTML = html;
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    updateProgress(msg.current, msg.total, msg.details);
  }
  if (msg.type === 'SCAN_COMPLETE') {
    showResult(msg.result);
    saveLastResult(msg.result);
  }
});

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
  loadFriends();
  document.getElementById('addFriendBtn').addEventListener('click', openAddFriend);
  document.getElementById('modalSaveBtn').addEventListener('click', saveFriendFromModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalDeleteBtn').addEventListener('click', deleteFriend);
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('checkLoginBtn').addEventListener('click', checkLogin);
  document.getElementById('refreshLoginBtn').addEventListener('click', checkLogin);
  document.getElementById('startBtn').addEventListener('click', startExecution);
  document.getElementById('stopBtn').addEventListener('click', stopExecution);
  loadCachedProfile();

  // Restore state from service worker
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (status && status.isRunning) {
      isRunning = true;
      document.getElementById('startBtn').disabled = true;
      document.getElementById('progressSection').classList.remove('hidden');
      document.getElementById('resultSection').classList.add('hidden');
      updateProgress(status.current, status.total, status.lastDetails);
    } else {
      getLastResult().then((result) => {
        if (result) showResult(result);
      });
    }
  });
});
