// content.js

// content.js が複数回実行されるのを防ぐためのフラグ
// (manifest.json の修正により本来は不要だが、念のためのセーフガードとして)
if (window.myAutoReloadExtensionHasRun && window.myAutoReloadExtensionHasRun !== chrome.runtime.id) {
  // 既に別のインスタンス(または自身の再実行)が実行されている場合は、
  // 新しいインスタンスの処理を中断する
  // chrome.runtime.id で自身のIDと比較し、古いインスタンスが残っているケースも考慮
  console.warn("Auto Reload Extension content script is trying to run again or an old instance exists. Aborting new instance.");
} else {
  // 初回実行、または自身のIDでフラグを設定
  window.myAutoReloadExtensionHasRun = chrome.runtime.id; // 一意なIDでマーキング

  // --- グローバル変数宣言 ---
  let container = null;                 // UIのコンテナ要素
  let toggle = null;                    // UIのトグルスイッチ要素
  let intervalId = null;                // setIntervalのID
  let reloadInterval = 10000;           // 自動リロードの間隔 (ミリ秒、デフォルト10秒)
  let extensionGloballyEnabled = false; // このタブで拡張機能が全体的に有効か (background.jsが管理)
  let previousExtensionState = false;   // extensionGloballyEnabled の直前の状態を保持

  /**
   * UI要素を初期化またはページから検索する関数。
   * UIが存在しない場合は作成し、ページに追加する。
   * ドラッグ移動やトグルスイッチのイベントリスナーも設定する。
   */
  function initializeUI() {
    container = document.querySelector('#auto-reload-container');
    if (!container) {
      // UIコンテナが存在しない場合は新規作成
      container = document.createElement('div');
      container.id = 'auto-reload-container';
      container.className = 'auto-reload-toggle'; // CSSクラス名 (toggle.cssでスタイル定義)
      // sessionStorageから前回の位置を復元、なければデフォルト位置
      container.style.top = sessionStorage.getItem('toggleTop') || '0px';
      container.style.left = sessionStorage.getItem('toggleLeft') || '0px';
      container.style.display = 'none'; // 初期状態では非表示

      // ドラッグハンドル部分の作成
      const dragHandle = document.createElement('div');
      dragHandle.textContent = '≡'; // ドラッグアイコン
      dragHandle.className = 'drag-handle';
      dragHandle.title = 'ドラッグで移動'; // ツールチップ

      // ラベルとトグルスイッチ部分の作成
      const label = document.createElement('label');
      label.className = 'toggle-label';
      label.innerHTML = '🔁 Auto Reload <input type="checkbox" id="reload-toggle">'; // HTML構造

      // 作成した要素をコンテナに追加
      container.appendChild(dragHandle);
      container.appendChild(label);
      // コンテナをbodyの末尾に追加
      document.body.appendChild(container);

      // --- ドラッグ移動のロジック ---
      let isDragging = false;
      let offsetX = 0, offsetY = 0;

      dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        // マウスダウン位置と要素の左上隅とのオフセットを計算
        offsetX = e.clientX - container.offsetLeft;
        offsetY = e.clientY - container.offsetTop;
        e.preventDefault(); // テキスト選択などを防ぐ
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return; // ドラッグ中でなければ何もしない
        // 新しい位置を計算 (ウィンドウ範囲内に制限)
        const left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - container.offsetWidth));
        const top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - container.offsetHeight));
        // UIの位置を更新
        container.style.left = left + 'px';
        container.style.top = top + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        // ドラッグ終了時にUIの位置をsessionStorageに保存
        sessionStorage.setItem('toggleLeft', container.style.left);
        sessionStorage.setItem('toggleTop', container.style.top);
      });
    }
    // トグルスイッチ要素を取得 (UI作成後または既存UIの場合)
    toggle = document.querySelector('#reload-toggle');

    // トグルスイッチの変更イベントリスナー (まだ設定されていなければ設定)
    if (toggle && !toggle._hasChangeListener) {
      toggle.addEventListener('change', () => {
        const autoReloadActive = toggle.checked; //現在のチェック状態
        // チェック状態をsessionStorageに保存 (ページリロード後も維持するため)
        sessionStorage.setItem('autoReloadEnabled', autoReloadActive.toString());
        // 拡張機能が全体的に有効な場合のみ、リロードを開始/停止
        if (extensionGloballyEnabled) {
          autoReloadActive ? startAutoReload() : stopAutoReload();
        }
      });
      toggle._hasChangeListener = true; // リスナーが設定されたことをマーク
    }
  }

  /**
   * 自動リロードを開始する関数。
   * 設定された`reloadInterval`に従ってページをリロードするタイマーを開始する。
   */
  function startAutoReload() {
    if (!intervalId) { // タイマーが既に開始されていなければ
      console.log("自動リロードを開始します。間隔:", reloadInterval, "ms");
      intervalId = setInterval(() => {
        console.log("ページをリロードします...");
        location.reload(); // ページをリロード
      }, reloadInterval);
    }
  }

  /**
   * 自動リロードを停止する関数。
   * 実行中のリロードタイマーがあればクリアする。
   */
  function stopAutoReload() {
    if (intervalId) { // タイマーが開始されていれば
      console.log("自動リロードを停止します。");
      clearInterval(intervalId); // タイマーをクリア
      intervalId = null; // タイマーIDをリセット
    }
  }

  /**
   * 拡張機能の全体的な状態 (extensionGloballyEnabled) と
   * sessionStorageに保存されたユーザーのトグル設定に基づいて、
   * UIの表示/非表示、トグルのチェック状態、リロード処理の開始/停止を制御する。
   */
  function updateUIAndReloadState() {
    // UI要素がまだ準備できていない場合は初期化を試みる
    if (!container || !toggle) {
      initializeUI(); // UI要素の取得または作成を試みる
      // それでも要素が見つからなければ処理を中断
      if (!container || !toggle) {
        console.log("UI要素が見つからないため、UIとリロード状態の更新をスキップします。");
        return;
      }
    }

    console.log("UIとリロード状態を更新します。拡張機能の全体的な有効状態:", extensionGloballyEnabled);
    if (extensionGloballyEnabled) {
      // 拡張機能が有効な場合
      container.style.display = 'flex'; // UIコンテナを表示

      // sessionStorageからユーザーのリロード設定 (トグルのチェック状態) を読み込む
      const userPrefersReload = sessionStorage.getItem('autoReloadEnabled') === 'true';
      toggle.checked = userPrefersReload; // UIのトグルに反映

      // ユーザー設定に基づいてリロードを開始または停止
      userPrefersReload ? startAutoReload() : stopAutoReload();
    } else {
      // 拡張機能が無効な場合
      stopAutoReload(); // まずリロードを停止
      if(toggle) toggle.checked = false; // UIのトグルをOFFに
      if(container) container.style.display = 'none'; // UIコンテナを非表示
    }
  }

  // background.js からのメッセージを受信するリスナー
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 拡張機能の状態変更メッセージ ("extension-state-change") を受信した場合
    if (message.type === "extension-state-change") {
      console.log("background.jsからextension-state-changeメッセージを受信:", message.extensionEnabled);
      previousExtensionState = extensionGloballyEnabled; // 現在の状態を「以前の状態」として保存
      extensionGloballyEnabled = message.extensionEnabled; // 新しい状態に更新

      // 拡張機能が「OFF→ON」に切り替わった場合のみ、リロード設定をリセット (トグルをOFFにする)
      if (extensionGloballyEnabled && !previousExtensionState) {
        console.log("拡張機能がOFFからONに切り替わりました。リロード設定をリセットします。");
        sessionStorage.setItem('autoReloadEnabled', 'false'); // sessionStorageをOFFに
        if (toggle) { // トグル要素があればチェックも外す
          toggle.checked = false;
        }
        stopAutoReload(); // 念のためリロードも停止
      }

      updateUIAndReloadState(); // UIとリロード状態を更新

      // background.js に処理完了を通知
      sendResponse({ status: extensionGloballyEnabled ? "acknowledged_on" : "acknowledged_off" });
    }
    return true; // 非同期でsendResponseを呼ぶためtrueを返す
  });

  /**
   * 即時実行関数 (IIFE) による初期化処理。
   * content.js がページに読み込まれたときに一度だけ実行される。
   */
  (function init() {
    initializeUI(); // まずUIを初期化 (または検索)

    // chrome.storageからリロード間隔を取得 (オプションページで設定された値)
    chrome.storage.sync.get("reloadInterval", (data) => {
      if (data.reloadInterval) {
        reloadInterval = data.reloadInterval * 1000; // ミリ秒に変換
        console.log("取得したリロード間隔:", reloadInterval, "ms");
      }
    });

    // background.jsに現在のタブの拡張機能の初期状態を問い合わせる
    chrome.runtime.sendMessage({ type: "get-initial-state" }, (response) => {
      if (chrome.runtime.lastError) {
        // エラーが発生した場合 (例: background.js が応答しない)
        console.error("初期状態の取得中にエラー:", chrome.runtime.lastError.message);
        extensionGloballyEnabled = false; // デフォルトで無効とする
        previousExtensionState = false;   // 同様に初期化
      } else if (response) {
        // 正常に状態を取得できた場合
        extensionGloballyEnabled = response.extensionEnabled;
        // 初期読み込み時は、previousExtensionState と extensionGloballyEnabled は同じ値でよい
        // (OFF→ONの遷移とは異なるため)
        previousExtensionState = response.extensionEnabled;
      }

      // 取得した初期状態に基づいてUIとリロード処理を更新
      updateUIAndReloadState();
      console.log("content.jsが初期化されました。拡張機能の全体的な有効状態:", extensionGloballyEnabled);
    });
  })();

} // 重複実行防止フラグのelseブロックの終わり