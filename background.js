// REFACTORED: Privacy-First Version. No external connections.
// This extension operates entirely offline and does not transmit any user data.

// Initialize default speed on install
chrome.runtime.onInstalled.addListener(function (details) {
  chrome.storage.sync.set({ key: "1" });
});

// Keyboard shortcut handlers
chrome.commands.onCommand.addListener(function (command) {
  const params = {
    active: true,
    currentWindow: true,
  };

  switch (command) {
    case "left":
      chrome.storage.sync.get(["key"], function (result) {
        const currentSpeed = parseFloat(result.key) || 1;
        if (currentSpeed >= 0.5) {
          const newSpeed = (currentSpeed - 0.25).toFixed(2);
          chrome.storage.sync.set({ key: newSpeed });
          chrome.tabs.query(params, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, newSpeed);
            }
          });
        }
      });
      break;

    case "right":
      chrome.storage.sync.get(["key"], function (result) {
        const currentSpeed = parseFloat(result.key) || 1;
        if (currentSpeed <= 3.75) {
          const newSpeed = (currentSpeed + 0.25).toFixed(2);
          chrome.storage.sync.set({ key: newSpeed });
          chrome.tabs.query(params, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, newSpeed);
            }
          });
        }
      });
      break;
  }
});

// Sync speed to content scripts when tab updates
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  // Ignore internal Chrome pages
  const internalPagePatterns = [
    /^chrome:\/\//,
    /^chrome-extension:\/\//
  ];

  if (!tab.url || internalPagePatterns.some(pattern => pattern.test(tab.url))) {
    return;
  }

  if (changeInfo.status === "complete") {
    chrome.storage.sync.get(["key"], function (result) {
      if (result.key) {
        chrome.tabs.sendMessage(tabId, result.key).catch(() => {
          // Tab may not have content script, ignore error
        });
      }
    });
  }
});
