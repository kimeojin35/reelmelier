(function () {
  function getCsrfToken() {
    return document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrftoken='))
      ?.split('=')[1] || '';
  }

  function igHeaders() {
    return {
      'X-IG-App-ID': '936619743392459',
      'X-CSRFToken': getCsrfToken(),
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  // Fetch reels feed from Instagram API (same-origin = cookies auto-included)
  async function fetchReelsFeed(count) {
    const reels = [];
    let maxId = null;

    while (reels.length < count) {
      const res = await fetch('https://www.instagram.com/api/v1/clips/home/', {
        method: 'POST',
        headers: { ...igHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body: new URLSearchParams({ paging_token: maxId || '', max_id: maxId || '' }),
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

  // Send DM via Instagram API
  async function sendDM(username, reelUrls) {
    const results = { sent: [], failed: [] };

    // Find user ID
    const searchRes = await fetch(
      `https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(username)}&context=blended`,
      { headers: igHeaders(), credentials: 'include' }
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
          headers: { ...igHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'include',
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
      await new Promise((r) => setTimeout(r, 1500));
    }

    return results;
  }

  // Get profile info
  async function getProfileInfo() {
    if (window.location.href.includes('/accounts/login')) {
      return { isLoggedIn: false, username: '', fullName: '', profilePic: '' };
    }
    try {
      const res = await fetch('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', {
        headers: igHeaders(),
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
    return { isLoggedIn: true, username: '', fullName: '로그인됨', profilePic: '' };
  }

  // Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'FETCH_REELS':
        fetchReelsFeed(msg.count).then((reels) => sendResponse({ reels })).catch((err) => sendResponse({ reels: [], error: err.message }));
        return true;

      case 'DEBUG_REELS_API': {
        // 디버그용: 실제 API 응답을 그대로 반환
        fetch('https://www.instagram.com/api/v1/clips/home/', {
          method: 'POST',
          headers: { ...igHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'include',
          body: new URLSearchParams({}),
        })
          .then((res) => res.text().then((text) => sendResponse({ status: res.status, body: text.slice(0, 500) })))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }

      case 'SEND_DM':
        sendDM(msg.username, msg.reelUrls).then((result) => sendResponse(result));
        return true;

      case 'GET_PROFILE':
        getProfileInfo().then((profile) => sendResponse(profile));
        return true;

      case 'PING':
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });
})();
