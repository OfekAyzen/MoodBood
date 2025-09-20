// Background service worker for MV3 (Firefox compatible)
// - Provides action click to open/focus whiteboard
// - Adds context menus to add image/link/screenshot to whiteboard
// - Persists items in storage.local under key "whiteboardItems"

const API = typeof browser !== "undefined" ? browser : chrome;

const MENU_IDS = {
  ADD_IMAGE: "wb_add_image",
  ADD_LINK: "wb_add_link",
  ADD_SCREENSHOT: "wb_add_screenshot",
  ADD_VIDEO: "wb_add_video",
};

function getWhiteboardUrl() {
  return API.runtime.getURL("src/whiteboard.html");
}

async function openOrFocusWhiteboard() {
  const url = getWhiteboardUrl();
  const tabs = await API.tabs.query({ url });
  if (tabs && tabs.length > 0) {
    const tab = tabs[0];
    await API.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === "number") {
      await API.windows.update(tab.windowId, { focused: true });
    }
    return tab.id;
  }
  const created = await API.tabs.create({ url });
  return created.id;
}

async function readItems() {
  const { whiteboardItems } = await API.storage.local.get({
    whiteboardItems: [],
  });
  return Array.isArray(whiteboardItems) ? whiteboardItems : [];
}

async function writeItems(items) {
  await API.storage.local.set({ whiteboardItems: items });
}

function createItemBase(partial) {
  return {
    id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    x: Math.floor(60 + Math.random() * 200),
    y: Math.floor(60 + Math.random() * 120),
    z: Date.now(),
    ...partial,
  };
}

async function addImageItem(src) {
  const items = await readItems();
  items.push(createItemBase({ type: "image", src, w: 240, h: 180 }));
  await writeItems(items);
}

async function addLinkItem(url, title) {
  const items = await readItems();
  items.push(
    createItemBase({ type: "link", url, title: title || url, w: 280, h: 120 })
  );
  await writeItems(items);
}

async function addScreenshotItem(dataUrl) {
  const items = await readItems();
  items.push(createItemBase({ type: "image", src: dataUrl, w: 320, h: 240 }));
  await writeItems(items);
}

// Create context menus on install/update
API.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll();
  } catch (e) {}
  API.contextMenus.create({
    id: MENU_IDS.ADD_IMAGE,
    title: "Add image to Whiteboard",
    contexts: ["image"],
  });
  API.contextMenus.create({
    id: MENU_IDS.ADD_LINK,
    title: "Add link to Whiteboard",
    contexts: ["link"],
  });
  API.contextMenus.create({
    id: MENU_IDS.ADD_VIDEO,
    title: "Add video to Whiteboard",
    contexts: ["video"],
  });
  API.contextMenus.create({
    id: MENU_IDS.ADD_SCREENSHOT,
    title: "Add page screenshot to Whiteboard",
    contexts: ["page", "frame", "link", "image", "selection"],
  });
});

// Toolbar button opens the whiteboard (supports MV2 browserAction and MV3 action)
if (API.action && API.action.onClicked) {
  API.action.onClicked.addListener(async () => {
    await openOrFocusWhiteboard();
  });
} else if (API.browserAction && API.browserAction.onClicked) {
  API.browserAction.onClicked.addListener(async () => {
    await openOrFocusWhiteboard();
  });
}

// Handle context menu clicks
API.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU_IDS.ADD_IMAGE && info.srcUrl) {
      await addImageItem(info.srcUrl);
      await openOrFocusWhiteboard();
      return;
    }
    if (info.menuItemId === MENU_IDS.ADD_LINK && info.linkUrl) {
      await addLinkItem(info.linkUrl, info.selectionText);
      await openOrFocusWhiteboard();
      return;
    }
    if (info.menuItemId === MENU_IDS.ADD_VIDEO && info.srcUrl) {
      const items = await readItems();
      items.push(
        createItemBase({ type: "video", src: info.srcUrl, w: 360, h: 240 })
      );
      await writeItems(items);
      await openOrFocusWhiteboard();
      return;
    }
    if (info.menuItemId === MENU_IDS.ADD_SCREENSHOT && tab) {
      const dataUrl = await API.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      await addScreenshotItem(dataUrl);
      await openOrFocusWhiteboard();
      return;
    }
  } catch (err) {
    console.error("Context menu error:", err);
  }
});

// Handle messages from content script
API.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    if (message.action === "addImageToWhiteboard") {
      await addImageItem(message.src);
      await openOrFocusWhiteboard();
      sendResponse({ success: true });
    }
  } catch (err) {
    console.error("Message handling error:", err);
    sendResponse({ success: false, error: err.message });
  }
  return true; // Keep message channel open for async response
});
