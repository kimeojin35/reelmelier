const fields = ['apiKey', 'model', 'confidenceThreshold', 'dmDelayMin', 'dmDelayMax'];

async function loadSettings() {
  const settings = await getSettings();
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('model').value = settings.model;
  document.getElementById('confidenceThreshold').value = settings.confidenceThreshold;
  document.getElementById('dmDelayMin').value = settings.dmDelayMin;
  document.getElementById('dmDelayMax').value = settings.dmDelayMax;
}

async function save() {
  const partial = {
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value,
    confidenceThreshold: parseFloat(document.getElementById('confidenceThreshold').value),
    dmDelayMin: parseInt(document.getElementById('dmDelayMin').value, 10),
    dmDelayMax: parseInt(document.getElementById('dmDelayMax').value, 10),
  };
  await saveSettings(partial);
  const msg = document.getElementById('savedMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 1500);
}

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('toggleKey').addEventListener('click', () => {
  const input = document.getElementById('apiKey');
  const btn = document.getElementById('toggleKey');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '숨기기';
  } else {
    input.type = 'password';
    btn.textContent = '보기';
  }
});
