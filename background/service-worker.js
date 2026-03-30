importScripts('utils/storage.js', 'utils/openai.js');

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCAN') {
    handleStartScan(msg);
    sendResponse({ ok: true });
  }

  if (msg.type === 'STOP_SCAN') {
    handleStopScan();
    sendResponse({ ok: true });
  }

  if (msg.type === 'CLASSIFY_REEL') {
    handleClassifyReel(msg);
    sendResponse({ ok: true });
  }

  if (msg.type === 'COLLECTION_DONE') {
    handleCollectionDone();
    sendResponse({ ok: true });
  }

  return false;
});

async function handleStartScan(msg) {
  resetState();
  scanState.isRunning = true;
  scanState.friends = msg.friends;
  scanState.targetCount = msg.count;

  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  let tab;

  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: 'https://www.instagram.com/reels/', active: true });
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.instagram.com/reels/' });
  }

  scanState.tabId = tab.id;

  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === scanState.tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        chrome.tabs.sendMessage(scanState.tabId, {
          type: 'START_CONTENT_SCAN',
          count: scanState.targetCount,
        });
      }, 2000);
    }
  });
}

function handleStopScan() {
  if (scanState.tabId) {
    chrome.tabs.sendMessage(scanState.tabId, { type: 'STOP_CONTENT_SCAN' });
  }
  scanState.isRunning = false;
}

async function handleClassifyReel(msg) {
  if (!scanState.isRunning) return;

  const settings = await getSettings();
  if (!settings.apiKey) {
    broadcastToPopup({
      type: 'PROGRESS_UPDATE',
      current: msg.current,
      total: msg.total,
      details: ['API 키가 설정되지 않았습니다'],
    });
    return;
  }

  const result = await classifyReel(
    settings.apiKey,
    settings.model,
    scanState.friends,
    msg.reel
  );

  scanState.processedCount = msg.current;

  const details = [];
  if (result.error) {
    details.push(`릴스 ${msg.current}: 분류 실패`);
  } else if (result.matches.length > 0 && result.confidence >= settings.confidenceThreshold) {
    scanState.classifiedReels.push({
      reel: msg.reel,
      matches: result.matches,
      reason: result.reason,
      confidence: result.confidence,
    });
    details.push(`${result.matches.join(', ')}에게 매칭!`);
  } else {
    details.push(`패스`);
  }

  broadcastToPopup({
    type: 'PROGRESS_UPDATE',
    current: msg.current,
    total: msg.total,
    details,
  });
}

async function handleCollectionDone() {
  if (!scanState.isRunning) return;

  const settings = await getSettings();

  const friendReelMap = {};
  for (const classified of scanState.classifiedReels) {
    for (const friendName of classified.matches) {
      if (!friendReelMap[friendName]) {
        friendReelMap[friendName] = [];
      }
      friendReelMap[friendName].push(classified.reel.reelUrl);
    }
  }

  const sentResults = [];
  const failedResults = [];

  for (const friend of scanState.friends) {
    const reelUrls = friendReelMap[friend.name];
    if (!reelUrls || reelUrls.length === 0) continue;

    const dmResult = await chrome.tabs.sendMessage(scanState.tabId, {
      type: 'SEND_DM',
      username: friend.username,
      reelUrls,
    });

    if (dmResult.sent.length > 0) {
      sentResults.push({ friend: friend.name, reels: dmResult.sent });
    }
    if (dmResult.failed.length > 0) {
      failedResults.push({ friend: friend.name, reels: dmResult.failed });
    }

    const delay =
      settings.dmDelayMin +
      Math.random() * (settings.dmDelayMax - settings.dmDelayMin);
    await new Promise((r) => setTimeout(r, delay));
  }

  const totalMatched = scanState.classifiedReels.length;
  const finalResult = {
    totalReels: scanState.targetCount,
    matched: totalMatched,
    skipped: scanState.targetCount - totalMatched,
    sent: sentResults,
    failed: failedResults,
  };

  broadcastToPopup({ type: 'SCAN_COMPLETE', result: finalResult });
  scanState.isRunning = false;
}

async function broadcastToPopup(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Popup might be closed
  }
}
