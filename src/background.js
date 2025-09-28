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

async function readItems(boardId = "default") {
  const key = `whiteboardItems_${boardId}`;
  const obj = await API.storage.local.get({ [key]: [] });
  const items = obj[key];
  return Array.isArray(items) ? items : [];
}

async function writeItems(items, boardId = "default") {
  const key = `whiteboardItems_${boardId}`;
  await API.storage.local.set({ [key]: items });
}

function createItemBase(partial) {
  return {
    id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    // Let the frontend place at center of board on spawn
    spawnAtCenter: true,
    z: Date.now(),
    ...partial,
  };
}

async function addImageItem(src, boardId = "default") {
  const items = await readItems(boardId);
  items.push(createItemBase({ type: "image", src, w: 240, h: 180 }));
  await writeItems(items, boardId);
}

async function addLinkItem(url, title, boardId = "default") {
  const items = await readItems(boardId);
  items.push(
    createItemBase({ type: "link", url, title: title || url, w: 280, h: 120 })
  );
  await writeItems(items, boardId);
}

async function addScreenshotItem(dataUrl, boardId = "default") {
  const items = await readItems(boardId);
  items.push(createItemBase({ type: "image", src: dataUrl, w: 320, h: 240 }));
  await writeItems(items, boardId);
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
      // Use active board from whiteboardBoards meta if present
      const { whiteboardBoards } = await API.storage.local.get({
        whiteboardBoards: { active: "default", list: ["default"] },
      });
      const boardId =
        (whiteboardBoards && whiteboardBoards.active) || "default";
      await addImageItem(info.srcUrl, boardId);
      await openOrFocusWhiteboard();
      return;
    }
    if (info.menuItemId === MENU_IDS.ADD_LINK && info.linkUrl) {
      const { whiteboardBoards } = await API.storage.local.get({
        whiteboardBoards: { active: "default", list: ["default"] },
      });
      const boardId =
        (whiteboardBoards && whiteboardBoards.active) || "default";
      await addLinkItem(info.linkUrl, info.selectionText, boardId);
      await openOrFocusWhiteboard();
      return;
    }
    if (info.menuItemId === MENU_IDS.ADD_VIDEO && info.srcUrl) {
      const { whiteboardBoards } = await API.storage.local.get({
        whiteboardBoards: { active: "default", list: ["default"] },
      });
      const boardId =
        (whiteboardBoards && whiteboardBoards.active) || "default";
      const items = await readItems(boardId);
      items.push(
        createItemBase({ type: "video", src: info.srcUrl, w: 360, h: 240 })
      );
      await writeItems(items, boardId);
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

// Proxy function to fetch images and convert to data URL (bypasses CORS)
async function proxyImageToDataUrl(imageUrl) {
  try {
    console.log("Proxying image:", imageUrl);

    // Add headers to mimic a browser request
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    // Fetch the image with headers
    console.log("Fetching image with headers...");
    const response = await fetch(imageUrl, {
      method: "GET",
      headers: headers,
      mode: "cors",
    });

    console.log("Response status:", response.status, response.statusText);
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content type
    const contentType = response.headers.get("content-type");
    console.log("Content type:", contentType);

    if (!contentType || !contentType.startsWith("image/")) {
      throw new Error(`Invalid content type: ${contentType}. Expected image/*`);
    }

    // Convert to blob
    console.log("Converting to blob...");
    const blob = await response.blob();
    console.log("Blob size:", blob.size, "bytes");
    console.log("Blob type:", blob.type);

    if (blob.size === 0) {
      throw new Error("Received empty image");
    }

    // Check if blob is too large (limit to 10MB)
    if (blob.size > 10 * 1024 * 1024) {
      throw new Error(
        `Image too large: ${Math.round(
          blob.size / 1024 / 1024
        )}MB. Maximum allowed: 10MB`
      );
    }

    // Convert blob to data URL
    console.log("Converting blob to data URL...");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        console.log("Data URL created, length:", reader.result.length);
        resolve(reader.result);
      };
      reader.onerror = (error) => {
        console.error("FileReader error:", error);
        reject(new Error("Failed to convert image to data URL"));
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error proxying image:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

// Alternative proxy method for problematic URLs
async function proxyImageToDataUrlFallback(imageUrl) {
  try {
    console.log("Trying fallback proxy method for:", imageUrl);

    // Try without CORS mode first
    const response = await fetch(imageUrl, {
      method: "GET",
      mode: "no-cors",
    });

    console.log("Fallback response status:", response.status);

    // For no-cors mode, we can't read the response body directly
    // So we'll create a new request with different headers
    const fallbackResponse = await fetch(imageUrl, {
      method: "GET",
      headers: {
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0 (compatible; Extension/1.0)",
      },
    });

    if (!fallbackResponse.ok) {
      throw new Error(
        `Fallback failed: ${fallbackResponse.status} ${fallbackResponse.statusText}`
      );
    }

    const blob = await fallbackResponse.blob();
    console.log("Fallback blob size:", blob.size);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Fallback conversion failed"));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Fallback proxy failed:", error);
    throw error;
  }
}

// Handle messages from content script
API.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    if (message.action === "addImageToWhiteboard") {
      const targetBoard = message.boardId || "default";
      // Ensure target board exists and becomes active
      const { whiteboardBoards } = await API.storage.local.get({
        whiteboardBoards: { active: "default", list: ["default"] },
      });
      const meta = whiteboardBoards || { active: "default", list: ["default"] };
      if (!Array.isArray(meta.list)) meta.list = [];
      if (!meta.list.includes(targetBoard)) meta.list.push(targetBoard);
      meta.active = targetBoard;
      await API.storage.local.set({ whiteboardBoards: meta });

      await addImageItem(message.src, targetBoard);
      await openOrFocusWhiteboard();
      sendResponse({ success: true });
    } else if (message.action === "proxyImageToDataUrl") {
      try {
        const dataUrl = await proxyImageToDataUrl(message.imageUrl);
        sendResponse({ success: true, dataUrl });
      } catch (primaryError) {
        console.log("Primary proxy failed, trying fallback...");
        try {
          const dataUrl = await proxyImageToDataUrlFallback(message.imageUrl);
          sendResponse({ success: true, dataUrl });
        } catch (fallbackError) {
          console.error("Both proxy methods failed:", {
            primaryError,
            fallbackError,
          });
          sendResponse({
            success: false,
            error: `Proxy failed: ${primaryError.message}. Fallback also failed: ${fallbackError.message}`,
          });
        }
      }
    }
  } catch (err) {
    console.error("Message handling error:", err);
    sendResponse({ success: false, error: err.message });
  }
  return true; // Keep message channel open for async response
});
