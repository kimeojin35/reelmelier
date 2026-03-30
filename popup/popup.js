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
});
