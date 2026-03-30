function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(300);
  }
  return null;
}

function simulateInput(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set || Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendDM(username, reelUrls) {
  const results = { sent: [], failed: [] };
  const MAX_RETRIES = 3;

  try {
    // Navigate to DM new message page
    window.location.href = 'https://www.instagram.com/direct/new/';
    await sleep(3000);

    // Wait for the search input in DM compose
    const searchInput = await waitForSelector(
      'input[name="queryBox"], input[placeholder*="검색"], input[placeholder*="Search"]'
    );
    if (!searchInput) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: 'Search input not found' })) };
    }

    // Type username
    simulateInput(searchInput, username);
    await sleep(1500);

    // Click the matching user result
    const userResult = await waitForSelector(
      '[role="listbox"] button, [role="option"], div[class*="result"] span'
    );
    if (!userResult) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: 'User not found in search' })) };
    }
    userResult.click();
    await sleep(1000);

    // Click "Chat" / "다음" button to open the conversation
    const nextBtn = await waitForSelector(
      'div[role="button"]:not([aria-disabled="true"])'
    );
    if (nextBtn) {
      nextBtn.click();
      await sleep(2000);
    }

    // Send each reel URL
    for (const reelUrl of reelUrls) {
      let sent = false;
      for (let retry = 0; retry < MAX_RETRIES && !sent; retry++) {
        try {
          const messageInput = await waitForSelector(
            'textarea[placeholder*="메시지"], textarea[placeholder*="Message"], div[role="textbox"][contenteditable="true"]'
          );
          if (!messageInput) throw new Error('Message input not found');

          if (messageInput.tagName === 'TEXTAREA') {
            simulateInput(messageInput, reelUrl);
          } else {
            // contenteditable div
            messageInput.focus();
            messageInput.textContent = reelUrl;
            messageInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
          }

          await sleep(500);

          // Press Enter to send
          messageInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
          );
          await sleep(1000);

          sent = true;
          results.sent.push(reelUrl);
        } catch (err) {
          if (retry === MAX_RETRIES - 1) {
            results.failed.push({ url: reelUrl, error: err.message });
          }
          await sleep(1000);
        }
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
