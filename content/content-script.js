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

  // Process reels one by one
  async function processReels() {
    while (isScanning && collectedCount < targetCount) {
      if (reelQueue.length === 0) {
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
  });

  // Initialize
  injectInterceptor();
})();
