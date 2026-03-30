(function () {
  const REEL_ENDPOINTS = ['/api/graphql', '/api/v1/clips/'];
  const REELMELIER_MSG_TYPE = 'REELMELIER_INTERCEPTED';

  function isReelEndpoint(url) {
    return REEL_ENDPOINTS.some((ep) => url.includes(ep));
  }

  function extractReelData(data) {
    const reels = [];

    function traverse(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.media && obj.media.code && obj.media.video_versions) {
        const media = obj.media;
        const caption = media.caption ? media.caption.text || '' : '';
        const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
        const comments = (media.preview_comments || [])
          .slice(0, 10)
          .map((c) => c.text || '');
        const thumbnailUrl =
          media.image_versions2?.candidates?.[0]?.url || null;
        const audioTitle =
          media.clips_metadata?.original_sound_info?.audio_asset_id ||
          media.clips_metadata?.music_info?.music_asset_info?.title ||
          '';
        const reelId = media.code;

        reels.push({
          reelId,
          reelUrl: `https://www.instagram.com/reel/${reelId}/`,
          caption,
          hashtags: hashtags.map((h) => h.slice(1)),
          comments,
          thumbnailUrl,
          audioTitle: String(audioTitle),
        });
      }
      if (obj.id && obj.code && obj.video_versions) {
        const caption = obj.caption ? obj.caption.text || '' : '';
        const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
        const comments = (obj.preview_comments || [])
          .slice(0, 10)
          .map((c) => c.text || '');
        const thumbnailUrl =
          obj.image_versions2?.candidates?.[0]?.url || null;
        const audioTitle =
          obj.clips_metadata?.original_sound_info?.audio_asset_id ||
          obj.clips_metadata?.music_info?.music_asset_info?.title ||
          '';

        reels.push({
          reelId: obj.code,
          reelUrl: `https://www.instagram.com/reel/${obj.code}/`,
          caption,
          hashtags: hashtags.map((h) => h.slice(1)),
          comments,
          thumbnailUrl,
          audioTitle: String(audioTitle),
        });
      }

      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    }

    traverse(data);
    const seen = new Set();
    return reels.filter((r) => {
      if (seen.has(r.reelId)) return false;
      seen.add(r.reelId);
      return true;
    });
  }

  // Monkey-patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (isReelEndpoint(url)) {
      response.clone().json().then((data) => {
        const reels = extractReelData(data);
        if (reels.length > 0) {
          window.postMessage({ type: REELMELIER_MSG_TYPE, reels }, '*');
        }
      }).catch(() => {});
    }
    return response;
  };

  // Monkey-patch XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._reelmelierUrl = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (this._reelmelierUrl && isReelEndpoint(this._reelmelierUrl)) {
        try {
          const data = JSON.parse(this.responseText);
          const reels = extractReelData(data);
          if (reels.length > 0) {
            window.postMessage({ type: REELMELIER_MSG_TYPE, reels }, '*');
          }
        } catch {}
      }
    });
    return originalSend.apply(this, args);
  };
})();
