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
      checkInstagramLogin().then((result) => sendResponse(result));
      return true; // async

    case 'START_SCAN':
      handleStartScan(msg);
      sendResponse({ ok: true });
      return false;

    case 'STOP_SCAN':
      handleStopScan();
      sendResponse({ ok: true });
      return false;

    case 'CLASSIFY_REEL':
      handleClassifyReel(msg);
      sendResponse({ ok: true });
      return false;

    case 'COLLECTION_DONE':
      handleCollectionDone();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
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
    await chrome.tabs.update(tab.id, { url: 'https://www.instagram.com/reels/', active: false });
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.instagram.com/reels/', active: false });
  }

  scanState.tabId = tab.id;

  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === scanState.tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(async () => {
        try {
          const loginCheck = await chrome.tabs.sendMessage(scanState.tabId, {
            type: 'CHECK_LOGIN',
          });
          if (!loginCheck || !loginCheck.isLoggedIn) {
            broadcastToPopup({
              type: 'SCAN_COMPLETE',
              result: {
                totalReels: 0,
                matched: 0,
                skipped: 0,
                sent: [],
                failed: [],
                error: '인스타그램에 로그인되어 있지 않습니다.',
              },
            });
            scanState.isRunning = false;
            return;
          }
        } catch (e) {
          // Content script might not be ready yet, proceed anyway
        }
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

  let result;
  try {
    result = await classifyReel(
      settings.apiKey,
      settings.model,
      scanState.friends,
      msg.reel
    );
  } catch (err) {
    result = { matches: [], error: err.message };
  }

  scanState.processedCount = msg.current;

  scanState.lastDetails = [];
  if (result.error) {
    scanState.lastDetails.push(`릴스 ${msg.current}: ${result.error}`);
  } else if (result.matches.length > 0 && result.confidence >= settings.confidenceThreshold) {
    scanState.classifiedReels.push({
      reel: msg.reel,
      matches: result.matches,
      reason: result.reason,
      confidence: result.confidence,
    });
    scanState.lastDetails.push(`${result.matches.join(', ')}에게 매칭!`);
  } else {
    scanState.lastDetails.push(`패스`);
  }

  broadcastToPopup({
    type: 'PROGRESS_UPDATE',
    current: msg.current,
    total: msg.total,
    details: scanState.lastDetails,
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

async function checkInstagramLogin() {
  // Step 1: Check login via cookie
  const cookie = await chrome.cookies.get({
    url: 'https://www.instagram.com',
    name: 'ds_user_id',
  });

  if (!cookie) {
    return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
  }

  // Step 2: Get session cookie and fetch profile with it
  try {
    const sessionCookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'sessionid',
    });
    const csrfCookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'csrftoken',
    });

    if (sessionCookie) {
      const res = await fetch('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': csrfCookie?.value || '',
          'Cookie': `sessionid=${sessionCookie.value}; ds_user_id=${cookie.value}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const user = data.form_data || data.user || data;
        if (user && user.username) {
          return {
            isLoggedIn: true,
            username: user.username,
            fullName: user.full_name || user.first_name || user.username,
            profilePic: user.profile_pic_url || '',
          };
        }
      }
    }
  } catch {}

  // Step 3: Cookie exists but API failed — still logged in, just can't get profile
  return {
    isLoggedIn: true,
    username: '',
    fullName: '로그인됨',
    profilePic: '',
  };
}

async function broadcastToPopup(msg) {
  // Always save state to storage (popup may be closed)
  if (msg.type === 'PROGRESS_UPDATE') {
    await chrome.storage.local.set({
      scanProgress: {
        isRunning: true,
        current: msg.current,
        total: msg.total,
        details: msg.details,
      },
    });
  }
  if (msg.type === 'SCAN_COMPLETE') {
    await chrome.storage.local.set({
      scanProgress: { isRunning: false },
      lastResult: msg.result,
    });
  }

  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Popup is closed — state is saved in storage, will restore on reopen
  }
}
