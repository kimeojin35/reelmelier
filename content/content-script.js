(function () {
  let isScanning = false;
  let reelQueue = [];
  let processedReelIds = new Set();
  let targetCount = 0;
  let collectedCount = 0;

  // Inject the main world interceptor script
  function injectInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/injector.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  // Listen for intercepted reel data from main world
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'REELMELIER_INTERCEPTED') return;
    if (!isScanning) return;

    const reels = event.data.reels || [];
    for (const reel of reels) {
      if (processedReelIds.has(reel.reelId)) continue;
      processedReelIds.add(reel.reelId);
      reelQueue.push(reel);
    }
  });

  // Move to next reel — try multiple methods
  function scrollToNextReel() {
    // Method 1: Keyboard ArrowDown (works on reels snap-scroll)
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true,
    }));

    // Method 2: Find the snap-scroll container and scroll it
    setTimeout(() => {
      const containers = document.querySelectorAll('div[style*="scroll-snap"], main, div[role="main"]');
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight) {
          c.scrollBy({ top: c.clientHeight, behavior: 'smooth' });
          return;
        }
      }
      // Method 3: Fallback to window scroll
      window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }, 200);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Extract reel data from DOM when API interception fails
  function extractReelFromDOM() {
    const caption = document.querySelector(
      'h1[dir="auto"], span[dir="auto"][class*="Caption"], div[class*="Caption"] span'
    )?.textContent || '';

    const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];

    const comments = Array.from(
      document.querySelectorAll('ul[class*="Comment"] span[dir="auto"]')
    )
      .slice(0, 10)
      .map((el) => el.textContent);

    const urlMatch = window.location.href.match(/\/reel\/([^/?]+)/);
    const reelId = urlMatch ? urlMatch[1] : `unknown-${Date.now()}`;

    return {
      reelId,
      reelUrl: urlMatch
        ? `https://www.instagram.com/reel/${reelId}/`
        : window.location.href,
      caption,
      hashtags: hashtags.map((h) => h.slice(1)),
      comments,
      thumbnailUrl: null,
      audioTitle: '',
    };
  }

  // Process reels one by one
  async function processReels() {
    while (isScanning && collectedCount < targetCount) {
      if (reelQueue.length === 0) {
        const domReel = extractReelFromDOM();
        if (domReel.caption && !processedReelIds.has(domReel.reelId)) {
          processedReelIds.add(domReel.reelId);
          reelQueue.push(domReel);
          continue;
        }
        scrollToNextReel();
        await sleep(2000);
        continue;
      }

      const reel = reelQueue.shift();
      collectedCount++;

      // Send to background for classification
      chrome.runtime.sendMessage({
        type: 'CLASSIFY_REEL',
        reel,
        current: collectedCount,
        total: targetCount,
      });

      if (collectedCount < targetCount) {
        scrollToNextReel();
        await sleep(1500);
      }
    }

    if (collectedCount >= targetCount) {
      chrome.runtime.sendMessage({ type: 'COLLECTION_DONE' });
    }
  }

  // Listen for commands from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_CONTENT_SCAN') {
      isScanning = true;
      reelQueue = [];
      processedReelIds.clear();
      collectedCount = 0;
      targetCount = msg.count;
      processReels();
      sendResponse({ ok: true });
    }
    if (msg.type === 'STOP_CONTENT_SCAN') {
      isScanning = false;
      sendResponse({ ok: true });
    }
    if (msg.type === 'SEND_DM') {
      sendDM(msg.username, msg.reelUrls).then((result) => {
        sendResponse(result);
      });
      return true; // async response
    }
    if (msg.type === 'CHECK_LOGIN') {
      const isLoggedIn =
        !window.location.href.includes('/accounts/login') &&
        document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]') !== null;
      sendResponse({ isLoggedIn });
      return;
    }
    if (msg.type === 'GET_PROFILE') {
      getProfileInfo().then((profile) => sendResponse(profile));
      return true;
    }
  });

  // Fetch logged-in user's profile info
  async function getProfileInfo() {
    // Check if on login page
    if (window.location.href.includes('/accounts/login')) {
      return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
    }

    // Try multiple API endpoints
    const endpoints = [
      'https://www.instagram.com/api/v1/accounts/edit/web_form_data/',
      'https://i.instagram.com/api/v1/accounts/current_user/?edit=true',
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'X-IG-App-ID': '936619743392459' },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const user = data.form_data || data.user || data;
        if (user.username) {
          return {
            isLoggedIn: true,
            username: user.username,
            fullName: user.full_name || user.first_name || user.username,
            profilePic: user.profile_pic_url || user.hd_profile_pic_url_info?.url || '',
          };
        }
      } catch {
        continue;
      }
    }

    // Fallback: check DOM for login indicators
    const navProfileLink = document.querySelector('a[href*="/accounts/edit"], a[role="link"] img[alt]');
    const profileImg = document.querySelector('nav img[alt][src*="instagram"]');
    const isLoggedIn = document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]') !== null;

    return {
      isLoggedIn,
      username: '',
      fullName: isLoggedIn ? '로그인됨' : '',
      profilePic: profileImg?.src || '',
    };
  }

  // Initialize
  injectInterceptor();
})();
