(function () {
  let isScanning = false;
  let processedReelIds = new Set();
  let targetCount = 0;
  let collectedCount = 0;
  let lastUrl = '';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get CSRF token from cookie
  function getCsrfToken() {
    return document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrftoken='))
      ?.split('=')[1] || '';
  }

  // Extract reel code from current URL
  function getReelCodeFromUrl() {
    const match = window.location.href.match(/\/reels?\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Convert image URL to base64 (same-origin fetch → blob → base64)
  async function imageUrlToBase64(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // result is "data:image/jpeg;base64,XXXXX"
          const base64 = reader.result.split(',')[1];
          const mediaType = blob.type || 'image/jpeg';
          resolve({ base64, mediaType });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // Fetch reel info using Instagram's API (same-origin, cookies included)
  async function fetchReelData(reelCode) {
    try {
      const res = await fetch(
        `https://www.instagram.com/api/v1/media/${reelCode}/info/`,
        {
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
        }
      );

      if (!res.ok) return null;

      const data = await res.json();
      const item = data.items?.[0];
      if (!item) return null;

      const caption = item.caption?.text || '';
      const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
      const comments = (item.preview_comments || [])
        .slice(0, 10)
        .map((c) => c.text || '');
      const thumbnailUrl = item.image_versions2?.candidates?.[0]?.url || null;
      const audioTitle =
        item.clips_metadata?.music_info?.music_asset_info?.title ||
        item.clips_metadata?.original_sound_info?.original_audio_title ||
        '';

      // Convert thumbnail to base64
      let thumbnailBase64 = null;
      if (thumbnailUrl) {
        thumbnailBase64 = await imageUrlToBase64(thumbnailUrl);
      }

      return {
        reelId: reelCode,
        reelUrl: `https://www.instagram.com/reel/${reelCode}/`,
        caption,
        hashtags: hashtags.map((h) => h.slice(1)),
        comments,
        thumbnailUrl,
        thumbnailBase64,
        audioTitle,
      };
    } catch {
      return null;
    }
  }

  // Fallback: extract from DOM + grab video thumbnail
  async function extractFromDOM(reelCode) {
    // Try multiple selectors for caption
    const captionEl =
      document.querySelector('h1') ||
      document.querySelector('span[dir="auto"]') ||
      document.querySelector('[class*="Caption"]');
    const caption = captionEl?.textContent?.trim() || '';
    const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];

    // Try to get video thumbnail
    let thumbnailBase64 = null;
    const video = document.querySelector('video');
    if (video) {
      // Method 1: video poster attribute
      if (video.poster) {
        thumbnailBase64 = await imageUrlToBase64(video.poster);
      }
      // Method 2: capture frame from video
      if (!thumbnailBase64) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 360;
          canvas.height = video.videoHeight || 640;
          canvas.getContext('2d').drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          const base64 = dataUrl.split(',')[1];
          if (base64 && base64.length > 100) {
            thumbnailBase64 = { base64, mediaType: 'image/jpeg' };
          }
        } catch {}
      }
    }

    return {
      reelId: reelCode || `dom-${Date.now()}`,
      reelUrl: window.location.href,
      caption,
      hashtags: hashtags.map((h) => h.slice(1)),
      comments: [],
      thumbnailUrl: null,
      thumbnailBase64,
      audioTitle: '',
    };
  }

  // Move to next reel — try every method
  function scrollToNextReel() {
    // Method 1: Find the scrollable reels container and scroll it
    const scrollables = document.querySelectorAll('div');
    for (const div of scrollables) {
      const style = window.getComputedStyle(div);
      if (
        style.scrollSnapType && style.scrollSnapType !== 'none' &&
        div.scrollHeight > div.clientHeight
      ) {
        div.scrollBy({ top: div.clientHeight, behavior: 'smooth' });
        return;
      }
    }

    // Method 2: Find video elements and scroll their section container
    const videos = document.querySelectorAll('video');
    if (videos.length > 0) {
      const section = videos[0].closest('section') || videos[0].closest('[role="main"]') || videos[0].parentElement?.parentElement?.parentElement;
      if (section && section.scrollHeight > section.clientHeight) {
        section.scrollBy({ top: section.clientHeight, behavior: 'smooth' });
        return;
      }
    }

    // Method 3: Keyboard events on multiple targets
    const targets = [document.activeElement, document.body, document];
    for (const target of targets) {
      if (target) {
        target.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', code: 'ArrowDown', keyCode: 40,
          which: 40, bubbles: true, cancelable: true,
        }));
      }
    }

    // Method 4: Window scroll as last resort
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
  }

  // Wait for URL to change (indicates new reel loaded)
  async function waitForNewReel(timeout = 8000) {
    const startUrl = window.location.href;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (window.location.href !== startUrl) return true;
      await sleep(300);
    }
    return false;
  }

  // Main scan loop
  async function processReels() {
    // Wait for first reel to load
    await sleep(2000);

    while (isScanning && collectedCount < targetCount) {
      const reelCode = getReelCodeFromUrl();

      if (reelCode && !processedReelIds.has(reelCode)) {
        processedReelIds.add(reelCode);

        // Try API first, fall back to DOM
        let reelData = await fetchReelData(reelCode);
        if (!reelData) {
          reelData = await extractFromDOM(reelCode);
        }

        collectedCount++;

        // Send to background for classification
        chrome.runtime.sendMessage({
          type: 'CLASSIFY_REEL',
          reel: reelData,
          current: collectedCount,
          total: targetCount,
        }).catch(() => {});

        // Wait before scrolling to next
        await sleep(1500);
      }

      if (collectedCount < targetCount) {
        // Try up to 3 times to move to next reel
        let moved = false;
        for (let attempt = 0; attempt < 3 && !moved; attempt++) {
          scrollToNextReel();
          moved = await waitForNewReel(4000);
          if (!moved) await sleep(1000);
        }
        if (!moved) {
          // Force continue even if URL didn't change — maybe reel loaded without URL update
          await sleep(2000);
        }
        await sleep(500);
      }
    }

    if (collectedCount >= targetCount) {
      chrome.runtime.sendMessage({ type: 'COLLECTION_DONE' }).catch(() => {});
    }
  }

  // Listen for commands from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_CONTENT_SCAN') {
      isScanning = true;
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
      return true;
    }
    if (msg.type === 'CHECK_LOGIN') {
      const isLoggedIn =
        !window.location.href.includes('/accounts/login') &&
        document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]') !== null;
      sendResponse({ isLoggedIn });
    }
    if (msg.type === 'GET_PROFILE') {
      getProfileInfo().then((profile) => sendResponse(profile));
      return true;
    }
  });

  async function getProfileInfo() {
    if (window.location.href.includes('/accounts/login')) {
      return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
    }
    try {
      const res = await fetch('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', {
        headers: { 'X-IG-App-ID': '936619743392459', 'X-CSRFToken': getCsrfToken() },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const user = data.form_data || data.user || data;
        if (user.username) {
          return {
            isLoggedIn: true,
            username: user.username,
            fullName: user.full_name || user.first_name || user.username,
            profilePic: user.profile_pic_url || '',
          };
        }
      }
    } catch {}
    return {
      isLoggedIn: document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]') !== null,
      username: '', fullName: '', profilePic: '',
    };
  }
})();
