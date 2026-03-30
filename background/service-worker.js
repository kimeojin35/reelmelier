importScripts('../utils/storage.js', '../utils/openai.js');

let scanState = {
  isRunning: false,
  friends: [],
  targetCount: 0,
  classifiedReels: [],
  processedCount: 0,
};

function resetState() {
  scanState = {
    isRunning: false,
    friends: [],
    targetCount: 0,
    classifiedReels: [],
    processedCount: 0,
  };
}

// --- Instagram API helpers (runs entirely in service worker) ---

async function getInstagramCookies() {
  const [sessionid, csrftoken, ds_user_id] = await Promise.all([
    chrome.cookies.get({ url: 'https://www.instagram.com', name: 'sessionid' }),
    chrome.cookies.get({ url: 'https://www.instagram.com', name: 'csrftoken' }),
    chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' }),
  ]);
  return { sessionid, csrftoken, ds_user_id };
}

function igHeaders(cookies) {
  return {
    'X-IG-App-ID': '936619743392459',
    'X-CSRFToken': cookies.csrftoken?.value || '',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': `sessionid=${cookies.sessionid?.value || ''}; csrftoken=${cookies.csrftoken?.value || ''}; ds_user_id=${cookies.ds_user_id?.value || ''}`,
  };
}

async function fetchReelsFeed(cookies, count) {
  const reels = [];
  let maxId = null;

  while (reels.length < count) {
    const params = new URLSearchParams({ paging_token: maxId || '', max_id: maxId || '' });
    const res = await fetch(`https://www.instagram.com/api/v1/clips/home/?${params}`, {
      method: 'POST',
      headers: {
        ...igHeaders(cookies),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ target_user_id: cookies.ds_user_id?.value || '0' }),
    });

    if (!res.ok) break;

    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (reels.length >= count) break;
      const media = item.media;
      if (!media || !media.code) continue;

      const caption = media.caption?.text || '';
      const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
      const comments = (media.preview_comments || []).slice(0, 10).map((c) => c.text || '');
      const thumbnailUrl = media.image_versions2?.candidates?.[0]?.url || null;
      const audioTitle =
        media.clips_metadata?.music_info?.music_asset_info?.title ||
        media.clips_metadata?.original_sound_info?.original_audio_title || '';

      reels.push({
        reelId: media.code,
        reelUrl: `https://www.instagram.com/reel/${media.code}/`,
        caption,
        hashtags: hashtags.map((h) => h.slice(1)),
        comments,
        thumbnailUrl,
        audioTitle,
      });
    }

    maxId = data.paging_info?.max_id;
    if (!maxId) break;
  }

  return reels;
}

async function sendDMviaAPI(cookies, username, reelUrls) {
  const headers = igHeaders(cookies);
  const results = { sent: [], failed: [] };

  // Find user ID
  const searchRes = await fetch(
    `https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(username)}&context=blended`,
    { headers }
  );
  if (!searchRes.ok) {
    return { sent: [], failed: reelUrls.map((u) => ({ url: u, error: 'Search failed' })) };
  }

  const searchData = await searchRes.json();
  const userMatch = searchData.users?.find(
    (u) => u.user.username.toLowerCase() === username.toLowerCase()
  );
  if (!userMatch) {
    return { sent: [], failed: reelUrls.map((u) => ({ url: u, error: `@${username} not found` })) };
  }

  const recipientId = String(userMatch.user.pk || userMatch.user.id);

  for (const reelUrl of reelUrls) {
    try {
      const res = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/link/', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          recipient_users: JSON.stringify([recipientId]),
          action: 'send_item',
          link_text: reelUrl,
          link_urls: JSON.stringify([reelUrl]),
          client_context: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        }),
      });

      if (res.ok) {
        results.sent.push(reelUrl);
      } else {
        results.failed.push({ url: reelUrl, error: `DM ${res.status}` });
      }
    } catch (err) {
      results.failed.push({ url: reelUrl, error: err.message });
    }

    // Delay between messages
    await new Promise((r) => setTimeout(r, 1500));
  }

  return results;
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
      checkInstagramLogin().then((r) => sendResponse(r));
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

// --- Scan flow (all in service worker, no tab needed for scanning) ---

async function handleStartScan(msg) {
  resetState();
  scanState.isRunning = true;
  scanState.friends = msg.friends;
  scanState.targetCount = msg.count;

  await broadcastToPopup({
    type: 'PROGRESS_UPDATE', current: 0, total: msg.count, details: ['릴스 피드 가져오는 중...'],
  });

  const cookies = await getInstagramCookies();
  if (!cookies.sessionid) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: '인스타그램에 로그인되어 있지 않습니다.' },
    });
    scanState.isRunning = false;
    return;
  }

  // Step 1: Fetch reels from Instagram API
  const reels = await fetchReelsFeed(cookies, msg.count);
  if (reels.length === 0) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: '릴스를 가져올 수 없습니다.' },
    });
    scanState.isRunning = false;
    return;
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      result: { totalReels: 0, matched: 0, skipped: 0, sent: [], failed: [], error: 'API 키가 설정되지 않았습니다.' },
    });
    scanState.isRunning = false;
    return;
  }

  // Step 2: Classify each reel
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

  // Step 3: Send DMs
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
      const dmResult = await sendDMviaAPI(cookies, friend.username, urls);
      if (dmResult.sent.length > 0) sentResults.push({ friend: friend.name, reels: dmResult.sent });
      if (dmResult.failed.length > 0) failedResults.push({ friend: friend.name, reels: dmResult.failed });
    } catch (err) {
      failedResults.push({ friend: friend.name, reels: urls.map((u) => ({ url: u, error: err.message })) });
    }

    const delay = settings.dmDelayMin + Math.random() * (settings.dmDelayMax - settings.dmDelayMin);
    await new Promise((r) => setTimeout(r, delay));
  }

  // Done
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

// --- Login check ---

async function checkInstagramLogin() {
  const cookies = await getInstagramCookies();
  if (!cookies.ds_user_id) {
    return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
  }

  try {
    const res = await fetch('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', {
      headers: igHeaders(cookies),
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
  } catch {}

  return { isLoggedIn: true, username: '', fullName: '로그인됨', profilePic: '' };
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
