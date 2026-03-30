importScripts('../utils/storage.js', '../utils/openai.js');

let scanState = {
  isRunning: false,
  friends: [],
  targetCount: 0,
  classifiedReels: [],
  processedCount: 0,
  tabId: null,
};

function resetState() {
  scanState = {
    isRunning: false,
    friends: [],
    targetCount: 0,
    classifiedReels: [],
    processedCount: 0,
    tabId: null,
  };
}

// --- Ensure an Instagram tab exists with content script loaded ---

async function ensureInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  let tab;

  if (tabs.length > 0) {
    tab = tabs[0];
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.instagram.com/reels/', active: false });
    // Wait for page load
    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
    await new Promise((r) => setTimeout(r, 2000));
  }

  scanState.tabId = tab.id;

  // Verify content script responds
  for (let i = 0; i < 3; i++) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      return tab.id;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw new Error('Instagram 탭과 연결할 수 없습니다. Instagram에 로그인되어 있는지 확인하세요.');
}

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATUS':
      sendResponse({
        isRunning: scanState.isRunning,
        current: scanState.processedCount,
        total: scanState.targetCount,
        lastDetails: scanState.lastDetails || [],
      });
      return false;

    case 'CHECK_INSTAGRAM':
      handleCheckInstagram().then((r) => sendResponse(r));
      return true;

    case 'START_SCAN':
      handleStartScan(msg);
      sendResponse({ ok: true });
      return false;

    case 'STOP_SCAN':
      handleStopScan();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// --- Login check via content script ---

async function handleCheckInstagram() {
  try {
    const tabId = await ensureInstagramTab();
    const profile = await chrome.tabs.sendMessage(tabId, { type: 'GET_PROFILE' });
    return profile || { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
  } catch {
    return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
  }
}

// --- Scan flow ---

async function handleStartScan(msg) {
  resetState();
  scanState.isRunning = true;
  scanState.friends = msg.friends;
  scanState.targetCount = msg.count;

  await broadcastToPopup({
    type: 'PROGRESS_UPDATE', current: 0, total: msg.count, details: ['릴스 피드 가져오는 중...'],
  });

  // Step 0: Ensure Instagram tab
  let tabId;
  try {
    tabId = await ensureInstagramTab();
  } catch (err) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: err.message },
    });
    scanState.isRunning = false;
    return;
  }

  // Step 1: Fetch reels via content script
  let reels = [];
  try {
    // 먼저 API 디버그 호출로 실제 응답 확인
    const debug = await chrome.tabs.sendMessage(tabId, { type: 'DEBUG_REELS_API' });

    const response = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_REELS', count: msg.count });
    reels = response?.reels || [];

    if (reels.length === 0) {
      const errorDetail = response?.error || (debug?.status ? `API ${debug.status}: ${debug.body?.slice(0, 100)}` : '알 수 없는 오류');
      await broadcastToPopup({
        type: 'SCAN_COMPLETE',
        result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: `릴스 가져오기 실패: ${errorDetail}` },
      });
      scanState.isRunning = false;
      return;
    }
  } catch (err) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: '릴스를 가져올 수 없습니다: ' + err.message },
    });
    scanState.isRunning = false;
    return;
  }

  // Step 2: Classify each reel with Claude
  const settings = await getSettings();
  if (!settings.apiKey) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: 'API 키가 설정되지 않았습니다.' },
    });
    scanState.isRunning = false;
    return;
  }

  const actualCount = Math.min(reels.length, msg.count);

  for (let i = 0; i < actualCount && scanState.isRunning; i++) {
    const reel = reels[i];
    scanState.processedCount = i + 1;

    let result;
    try {
      result = await classifyReel(settings.apiKey, settings.model, scanState.friends, reel);
    } catch (err) {
      result = { matches: [], error: err.message };
    }

    scanState.lastDetails = [];
    if (result.error) {
      scanState.lastDetails.push(`릴스 ${i + 1}: ${result.error}`);
    } else if (result.matches.length > 0 && result.confidence >= settings.confidenceThreshold) {
      scanState.classifiedReels.push({ reel, matches: result.matches, reason: result.reason, confidence: result.confidence });
      scanState.lastDetails.push(`${result.matches.join(', ')}에게 매칭!`);
    } else {
      scanState.lastDetails.push(`패스`);
    }

    await broadcastToPopup({
      type: 'PROGRESS_UPDATE', current: i + 1, total: actualCount, details: scanState.lastDetails,
    });
  }

  if (!scanState.isRunning) return;

  // Step 3: Send DMs via content script
  await broadcastToPopup({
    type: 'PROGRESS_UPDATE', current: actualCount, total: actualCount, details: ['DM 전송 중...'],
  });

  const friendReelMap = {};
  for (const c of scanState.classifiedReels) {
    for (const name of c.matches) {
      if (!friendReelMap[name]) friendReelMap[name] = [];
      friendReelMap[name].push(c.reel.reelUrl);
    }
  }

  const sentResults = [];
  const failedResults = [];

  for (const friend of scanState.friends) {
    const urls = friendReelMap[friend.name];
    if (!urls || urls.length === 0) continue;

    try {
      const dmResult = await chrome.tabs.sendMessage(tabId, {
        type: 'SEND_DM', username: friend.username, reelUrls: urls,
      });
      if (dmResult?.sent?.length > 0) sentResults.push({ friend: friend.name, reels: dmResult.sent });
      if (dmResult?.failed?.length > 0) failedResults.push({ friend: friend.name, reels: dmResult.failed });
    } catch (err) {
      failedResults.push({ friend: friend.name, reels: urls.map((u) => ({ url: u, error: err.message })) });
    }

    const delay = settings.dmDelayMin + Math.random() * (settings.dmDelayMax - settings.dmDelayMin);
    await new Promise((r) => setTimeout(r, delay));
  }

  const finalResult = {
    totalReels: actualCount,
    matched: scanState.classifiedReels.length,
    skipped: actualCount - scanState.classifiedReels.length,
    sent: sentResults,
    failed: failedResults,
  };

  await broadcastToPopup({ type: 'SCAN_COMPLETE', result: finalResult });
  scanState.isRunning = false;
}

function handleStopScan() {
  scanState.isRunning = false;
  chrome.storage.local.set({ scanProgress: { isRunning: false } });
}

// --- Popup broadcast ---

async function broadcastToPopup(msg) {
  if (msg.type === 'PROGRESS_UPDATE') {
    await chrome.storage.local.set({
      scanProgress: { isRunning: true, current: msg.current, total: msg.total, details: msg.details },
    });
  }
  if (msg.type === 'SCAN_COMPLETE') {
    await chrome.storage.local.set({
      scanProgress: { isRunning: false },
      lastResult: msg.result,
    });
  }
  chrome.runtime.sendMessage(msg).catch(() => {});
}
