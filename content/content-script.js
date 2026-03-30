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

  // Scroll to next reel
  function scrollToNextReel() {
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
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

  // Fetch logged-in user's profile info via Instagram's web API
  async function getProfileInfo() {
    try {
      const res = await fetch('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      const user = data.form_data || data;
      return {
        isLoggedIn: true,
        username: user.username || '',
        fullName: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.username || '',
        profilePic: user.profile_pic_url || '',
      };
    } catch {
      // Fallback: try parsing from page meta/scripts
      try {
        const metaEl = document.querySelector('meta[property="og:title"]');
        const profileImg = document.querySelector('header img, nav img[alt]');
        return {
          isLoggedIn: !window.location.href.includes('/accounts/login'),
          username: '',
          fullName: metaEl?.content || '',
          profilePic: profileImg?.src || '',
        };
      } catch {
        return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
      }
    }
  }

  // Initialize
  injectInterceptor();
})();
