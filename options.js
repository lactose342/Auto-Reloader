const intervalInput = document.getElementById("interval");
const statusText = document.getElementById("status");

// 保存された値を読み込み
chrome.storage.sync.get("reloadInterval", (data) => {
  if (data.reloadInterval) {
    intervalInput.value = data.reloadInterval;
  }
});

// 保存ボタンの処理
document.getElementById("save").addEventListener("click", () => {
  const newInterval = parseInt(intervalInput.value, 10);
  chrome.storage.sync.set({ reloadInterval: newInterval }, () => {
    statusText.textContent = "保存しました";
    setTimeout(() => statusText.textContent = "", 1500);
  });
});
