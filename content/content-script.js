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

  // Find the visible playing video element
  function getPlayingVideo() {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      // Video that's mostly visible in viewport
      if (rect.top > -100 && rect.top < window.innerHeight / 2 && rect.height > 200) {
        return v;
      }
    }
    return videos[0] || null;
  }

  // Find the scroll container (parent of videos with overflow scroll)
  function findScrollContainer() {
    const video = getPlayingVideo();
    if (!video) return null;
    let el = video.parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if ((overflowY === 'scroll' || overflowY === 'auto') && el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // Scroll to next reel
  function scrollToNextReel() {
    // Method 1: Scroll the snap container
    const container = findScrollContainer();
    if (container) {
      container.scrollBy({ top: container.clientHeight, behavior: 'smooth' });
      return;
    }

    // Method 2: Find next video and scroll it into view
    const currentVideo = getPlayingVideo();
    if (currentVideo) {
      const allVideos = Array.from(document.querySelectorAll('video'));
      const idx = allVideos.indexOf(currentVideo);
      if (idx >= 0 && idx < allVideos.length - 1) {
        allVideos[idx + 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    // Method 3: Window scroll
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
  }

  // Wait for a genuinely different reel to appear
  async function waitForNewReel(prevReelId, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const newId = getCurrentReelId();
      if (newId !== prevReelId) return newId;
      await sleep(400);
    }
    return null;
  }

  // Get stable reel ID from URL shortcode only
  function getCurrentReelId() {
    const match = window.location.href.match(/\/reels?\/([A-Za-z0-9_-]{6,})/);
    return match ? match[1] : null;
  }

  // Main scan loop
  async function processReels() {
    await sleep(3000);

    while (isScanning && collectedCount < targetCount) {
      const reelId = getCurrentReelId();

      if (reelId && !processedReelIds.has(reelId)) {
        processedReelIds.add(reelId);

        // Wait for video to load
        await sleep(1500);

        // Collect data
        let reelData = await fetchReelData(reelId);
        if (!reelData) {
          reelData = await extractFromDOM(reelId);
        }

        collectedCount++;

        // Classify and wait for result
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'CLASSIFY_REEL',
            reel: reelData,
            current: collectedCount,
            total: targetCount,
          }, () => resolve());
        });

        await sleep(500);
      }

      // Move to next
      if (collectedCount < targetCount) {
        const prevId = getCurrentReelId();
        scrollToNextReel();
        const newId = await waitForNewReel(prevId, 6000);

        if (!newId) {
          // Retry scroll
          scrollToNextReel();
          const retryId = await waitForNewReel(prevId, 5000);
          if (!retryId) {
            // Can't scroll further — skip
            collectedCount++;
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                type: 'CLASSIFY_REEL',
                reel: { reelId: `skip-${collectedCount}`, reelUrl: '', caption: '', hashtags: [], comments: [], thumbnailBase64: null, audioTitle: '' },
                current: collectedCount,
                total: targetCount,
              }, () => resolve());
            });
          }
        }
        // Wait for new video to start playing
        await sleep(1500);
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
