function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Send DM using Instagram's internal Share API (no page navigation needed)
async function sendDM(username, reelUrls) {
  const results = { sent: [], failed: [] };

  try {
    // Step 1: Get CSRF token from cookie
    const csrfToken = document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrftoken='))
      ?.split('=')[1];

    if (!csrfToken) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: 'CSRF token not found' })) };
    }

    // Step 2: Search for user to get their user ID
    const searchRes = await fetch(
      `https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(username)}&context=blended`,
      {
        headers: {
          'X-CSRFToken': csrfToken,
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
      }
    );

    if (!searchRes.ok) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: `Search failed: ${searchRes.status}` })) };
    }

    const searchData = await searchRes.json();
    const userMatch = searchData.users?.find(
      (u) => u.user.username.toLowerCase() === username.toLowerCase()
    );

    if (!userMatch) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: `User @${username} not found` })) };
    }

    const recipientId = userMatch.user.pk || userMatch.user.id;

    // Step 3: Send each reel URL as a DM link
    for (const reelUrl of reelUrls) {
      try {
        // Use Instagram's share endpoint to send a link via DM
        const formData = new URLSearchParams();
        formData.append('recipient_users', JSON.stringify([recipientId]));
        formData.append('action', 'send_item');
        formData.append('client_context', `${Date.now()}_${Math.random().toString(36).slice(2)}`);

        // Extract reel media ID from URL for proper share, or fall back to text
        const reelCode = reelUrl.match(/\/reel\/([^/?]+)/)?.[1];

        if (reelCode) {
          // Try to send as a media share (shows reel preview in DM)
          const mediaInfoRes = await fetch(
            `https://www.instagram.com/api/v1/media/${reelCode}/info/`,
            {
              headers: {
                'X-CSRFToken': csrfToken,
                'X-IG-App-ID': '936619743392459',
              },
              credentials: 'include',
            }
          );

          let sentAsMedia = false;
          if (mediaInfoRes.ok) {
            const mediaData = await mediaInfoRes.json();
            const mediaId = mediaData.items?.[0]?.pk || mediaData.items?.[0]?.id;

            if (mediaId) {
              const shareRes = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/media_share/', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-CSRFToken': csrfToken,
                  'X-IG-App-ID': '936619743392459',
                },
                credentials: 'include',
                body: new URLSearchParams({
                  recipient_users: JSON.stringify([recipientId]),
                  action: 'send_item',
                  media_id: String(mediaId),
                  client_context: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                }),
              });

              if (shareRes.ok) {
                sentAsMedia = true;
                results.sent.push(reelUrl);
              }
            }
          }

          // Fallback: send as text link
          if (!sentAsMedia) {
            const textRes = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/link/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': csrfToken,
                'X-IG-App-ID': '936619743392459',
              },
              credentials: 'include',
              body: new URLSearchParams({
                recipient_users: JSON.stringify([recipientId]),
                action: 'send_item',
                link_text: reelUrl,
                link_urls: JSON.stringify([reelUrl]),
                client_context: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
              }),
            });

            if (textRes.ok) {
              results.sent.push(reelUrl);
            } else {
              results.failed.push({ url: reelUrl, error: `Send failed: ${textRes.status}` });
            }
          }
        } else {
          // No reel code, send as plain text
          const textRes = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/link/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-CSRFToken': csrfToken,
              'X-IG-App-ID': '936619743392459',
            },
            credentials: 'include',
            body: new URLSearchParams({
              recipient_users: JSON.stringify([recipientId]),
              action: 'send_item',
              link_text: reelUrl,
              link_urls: JSON.stringify([reelUrl]),
              client_context: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            }),
          });

          if (textRes.ok) {
            results.sent.push(reelUrl);
          } else {
            results.failed.push({ url: reelUrl, error: `Send failed: ${textRes.status}` });
          }
        }

        // Delay between messages
        await sleep(1000);
      } catch (err) {
        results.failed.push({ url: reelUrl, error: err.message });
      }
    }
  } catch (err) {
    return {
      sent: results.sent,
      failed: [
        ...results.failed,
        ...reelUrls
          .filter((url) => !results.sent.includes(url))
          .map((url) => ({ url, error: err.message })),
      ],
    };
  }

  return results;
}
