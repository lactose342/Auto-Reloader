// background.js

/**
 * 指定されたタブIDの状態をchrome.storage.sessionから非同期で取得します。
 * @param {number} tabId
 * @returns {Promise<{extensionEnabled: boolean}>}
 */
async function getTabState(tabId) {
  const data = await chrome.storage.session.get(String(tabId));
  return data[tabId] || { extensionEnabled: false };
}

/**
 * 指定されたタブIDの状態をchrome.storage.sessionに非同期で保存します。
 * @param {number} tabId
 * @param {{extensionEnabled: boolean}} state
 */
async function setTabState(tabId, state) {
  await chrome.storage.session.set({ [String(tabId)]: state });
}

// 拡張機能のアイコンがクリックされたときの処理
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const currentState = await getTabState(tab.id);
  const newExtensionEnabledState = !currentState.extensionEnabled;

  // 新しい状態をストレージに保存
  await setTabState(tab.id, { extensionEnabled: newExtensionEnabledState });

  // アイコンのバッジを更新
  chrome.action.setBadgeText({
    tabId: tab.id,
    text: newExtensionEnabledState ? "ON" : "",
  });

  try {
    if (newExtensionEnabledState) {
      // 拡張機能を有効にする場合 (UIを表示)
      console.log(`Tab ${tab.id}: content.jsを注入します`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      // content.jsに状態変更を通知
      chrome.tabs.sendMessage(tab.id, { type: "extension-state-change", extensionEnabled: true }, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tab.id}: ONメッセージ送信エラー: ${chrome.runtime.lastError.message}`);
        } else if (response && response.status === "acknowledged_on") {
          console.log(`Tab ${tab.id}: content.jsがON状態を認識しました`);
        }
      });
    } else {
      // 拡張機能を無効にする場合 (UIを非表示)
      console.log(`Tab ${tab.id}: content.jsにOFFメッセージを送信します`);
      chrome.tabs.sendMessage(tab.id, { type: "extension-state-change", extensionEnabled: false }, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tab.id}: OFFメッセージ送信エラー: ${chrome.runtime.lastError.message}`);
        } else if (response && response.status === "acknowledged_off") {
          console.log(`Tab ${tab.id}: content.jsがOFF状態を認識しました`);
        }
      });
    }
  } catch (error) {
    console.error(`Tab ${tab.id}: アイコンクリック処理中にエラーが発生しました:`, error);
    // エラーが発生した場合は、状態を元に戻す
    if (newExtensionEnabledState) {
      await setTabState(tab.id, { extensionEnabled: false });
      chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    }
  }
});

// タブが更新されたときの処理 (ページリロードなど)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    const currentState = await getTabState(tabId); // ストレージから状態を読み込む

    // バッジの状態を現在のストレージの状態に合わせて更新
    chrome.action.setBadgeText({
        tabId: tabId,
        text: currentState.extensionEnabled ? "ON" : "",
    });

    if (currentState.extensionEnabled) {
      // このタブで拡張機能が有効だった場合 (UIを表示すべき)
      console.log(`Tab ${tabId} が更新されました。content.jsを再注入します。`);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        });
      } catch (error) {
        console.error(`Tab ${tabId}: content.jsの再注入中にエラーが発生しました:`, error);
      }
    }
  }
});

// タブが閉じられたときに、そのタブの状態情報をストレージから削除する
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(String(tabId));
  console.log(`Tab ${tabId} が閉じられたため、状態を削除しました。`);
});

// content.js からのメッセージを受信するリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return false;
  }

  if (message.type === "get-initial-state") {
    // ストレージから非同期で状態を取得し、content.jsに返す
    getTabState(tabId).then(state => {
      sendResponse({ extensionEnabled: state.extensionEnabled });
    });
    return true; // 非同期でレスポンスを返すことを示す
  }
});