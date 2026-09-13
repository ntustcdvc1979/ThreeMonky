/* 手機端。只有 🙊 比劃猴會開這一頁。

   這一端【完全不跟投影端通訊】：題庫打包在 terms.js 裡，
   各組自己抽題、自己揭曉。全場共同的節奏由投影幕的大鐘負責，
   所以這裡預設不計時 —— 比劃猴晚幾秒按「開始」只是自己少玩幾秒，
   不會讓整組的結束時間跟別組歪掉。

   一輪 = 一個主題 = 一題。輪次由這支自己數，
   只要跟著投影幕走，就會跟全場在同一個主題上。 */
(function () {
  "use strict";

  var U = window.TM_UTIL;
  var $ = U.$, esc = U.esc;
  var DECK = window.TM_DECK;
  var TERMS = window.TM_TERMS;

  var THEMES = TERMS.THEMES;
  var ROUNDS = THEMES.length;      // 主題數就是輪數（含最後的加碼題）
  /* 加碼題只有自願的組別上，所以正式輪數要把它扣掉 */
  var MAIN_ROUNDS = THEMES.filter(function (t) { return !t.volunteer; }).length;
  function isBonus(round) { return !!DECK.themeAt(THEMES, round).volunteer; }
  function roundLabel(round) {
    return isBonus(round) ? "加碼題" : "第 " + round + " / " + MAIN_ROUNDS + " 輪";
  }
  /** 總結清單一行一題，不需要分母，短的比較好讀 */
  function shortRound(round) {
    return isBonus(round) ? "加碼題" : "第 " + round + " 輪";
  }
  var GROUPS = 12;                 // 組號按鈕做幾顆
  var KEY = "tm.play.v2";          // v1 是舊的難度制存檔，格式不相容
  var DEFAULT_SEC = 240;           // 只有「自己計時」打開時才用得到，跟投影幕的預設一致

  var ST = {
    RESUME: "resume", SETUP: "setup",
    READY: "ready", CARD: "card", REVEAL: "reveal", SUMMARY: "summary"
  };

  var app = {
    st: ST.SETUP,
    group: null,
    selfTimer: false,
    seed: 0,
    round: 1,
    cur: null,         // 這一輪的題 {id,t,hint}
    theme: null,
    result: null,      // "hit" | "miss"
    hit: 0,
    log: []            // 整場的紀錄 [{round, theme, t, r}]
  };

  var pending = null;  // RESUME 卡片上等著被接受的存檔
  var ticker = null;

  /* ============================================================
     seed：同一天所有手機算出同一個值，不需要任何連線。
     投影端網址加 ?s=XXXX 會由 QR 帶過來，用於同一天辦兩場不想撞題。
     ============================================================ */
  function seedText() {
    var s = new URLSearchParams(location.search).get("s");
    return s ? String(s) : U.dayKey();
  }

  /** 這一輪這一組拿到哪一題。純函式，所以存檔只要記 round + group */
  function pickNow() {
    return DECK.pick({
      themes: THEMES, round: app.round, group: app.group, seed: app.seed
    });
  }

  /** 90 -> "1 分 30 秒"。不能用 Math.round(sec/60)，1.5 分會被講成 2 分鐘 */
  function fmtMin(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    if (!m) { return s + " 秒"; }
    return m + " 分" + (s ? " " + s + " 秒" : "鐘");
  }

  /* ============================================================
     存檔。題目是 round + group + seed 算出來的純函式結果，
     所以只要記這三個數字就能還原到同一題，不必存題庫。
     用 sessionStorage 不用 localStorage：活動結束關掉分頁就自然清空。
     ============================================================ */
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        day: U.dayKey(), seedText: seedText(),
        st: app.st, group: app.group, selfTimer: app.selfTimer, seed: app.seed,
        round: app.round, hit: app.hit, log: app.log,
        curId: app.cur ? app.cur.id : null, result: app.result
      }));
    } catch (e) { /* 無痕模式會丟例外，不值得為此中斷遊戲 */ }
  }

  function loadSaved() {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (!s || s.day !== U.dayKey() || s.seedText !== seedText()) { return null; }
      if (s.st === ST.SETUP) { return null; }   // 還沒開始，沒什麼好還原
      return s;
    } catch (e) { return null; }
  }

  function clearSaved() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  /** 唯一改狀態的入口。全檔不准有第二個地方直接碰 app.st */
  function go(next, patch) {
    if (patch) {
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) { app[k] = patch[k]; }
      }
    }
    app.st = next;
    save();
    render();
  }

  /* ============================================================
     Wake Lock
     ============================================================ */
  var wl = null;
  var wakeTried = false;
  var wakeOK = false;

  function keepAwake() {
    wakeTried = true;
    if (!navigator.wakeLock) { wakeOK = false; return Promise.resolve(false); }
    return navigator.wakeLock.request("screen").then(function (lock) {
      wl = lock;
      wakeOK = true;
      lock.addEventListener("release", function () { wl = null; });
      return true;
    })["catch"](function () {         // 低電量模式、非 https、使用者拒絕
      wakeOK = false;
      return false;
    });
  }

  // iOS / Android 把分頁收到背景時會自動釋放，切回來要重拿
  document.addEventListener("visibilitychange", function () {
    var playing = (app.st === ST.CARD || app.st === ST.REVEAL || app.st === ST.READY);
    if (document.visibilityState === "visible" && !wl && playing && wakeTried) {
      keepAwake();
    }
  });

  function wakeNote() {
    if (!wakeTried || wakeOK) { return ""; }
    return '<p class="note">螢幕可能會自己暗掉，去設定把自動鎖定調長一點</p>';
  }

  /* ============================================================
     畫面
     ============================================================ */
  var VIEWS = {};
  var AFTER = {};

  function render() {
    var el = $("view");
    el.className = "view view--" + app.st;
    el.innerHTML = VIEWS[app.st]();
    document.body.classList.toggle("is-hit", app.st === ST.REVEAL && app.result === "hit");
    document.body.classList.toggle("is-skip", app.st === ST.REVEAL && app.result === "miss");
    if (AFTER[app.st]) { AFTER[app.st](); }
  }

  function timerToggle() {
    return '<label class="toggle">' +
      '<input type="checkbox" data-act="selfTimer"' + (app.selfTimer ? " checked" : "") + ">" +
      "<span>自己計時（看不到投影幕時才打開）</span>" +
      "</label>";
  }

  /* ---------- RESUME ---------- */
  VIEWS[ST.RESUME] = function () {
    var s = pending;
    return "" +
      '<p class="eyebrow">剛剛玩到一半</p>' +
      '<h1 class="hero">要接著玩嗎？</h1>' +
      '<div class="card"><p class="lede">你停在 <b>第 ' + s.round + " 輪、答對 " +
        s.hit + " 題</b>。接著玩會回到同一題。</p></div>" +
      '<div class="spacer"></div>' +
      '<div class="acts">' +
        '<button class="act act--skip" data-act="resumeNo">重新開始</button>' +
        '<button class="act act--go" data-act="resumeYes">接著玩 ➜</button>' +
      "</div>";
  };

  /* ---------- SETUP：選第幾組 ---------- */
  VIEWS[ST.SETUP] = function () {
    var btns = "";
    for (var g = 1; g <= GROUPS; g++) {
      btns += '<button class="gbtn" data-act="group" data-g="' + g + '">' + g + "</button>";
    }
    return "" +
      '<h1 class="hero">你是 🙊 比劃猴</h1>' +
      '<div class="card">' +
        '<p class="tiny" style="margin-bottom:.6rem"><b>你們是第幾組？</b></p>' +
        '<div class="groups">' + btns + "</div>" +
      "</div>" +
      '<div class="spacer"></div>' +
      '<div style="text-align:center">' +
        '<button class="link" data-act="randGroup">不知道，隨便給我一個</button>' +
      "</div>";
  };

  /* ---------- READY：待命 ---------- */
  VIEWS[ST.READY] = function () {
    return "" +
      '<div class="row row--between">' +
        '<span class="pill">第 ' + app.group + " 組</span>" +
        '<span class="pill">' + roundLabel(app.round) + "</span>" +
      "</div>" +
      '<h1 class="hero">' + (isBonus(app.round) ? "加碼題，拚了" : "準備好就開始") + "</h1>" +
      // 只有自己計時的時候才需要講幾分鐘；其他規則投影幕上都有，不重講
      (app.selfTimer
        ? '<p class="lede">倒數 ' + fmtMin(DEFAULT_SEC) + "</p>"
        : "") +
      timerToggle() +
      '<div class="spacer"></div>' +
      wakeNote() +
      '<div class="acts">' +
        '<button class="act act--hit" data-act="start">開始比 🙊</button>' +
      "</div>";
  };



  /* ---------- CARD：這一輪的題 ---------- */
  VIEWS[ST.CARD] = function () {
    var t = app.cur;
    return "" +
      '<div class="row row--between">' +
        '<span class="pill">' + roundLabel(app.round) + "</span>" +
        '<span class="pill">累計 ✅ ' + app.hit + "</span>" +
      "</div>" +
      (app.selfTimer ? '<div class="bar"><div class="bar__f" id="bar"></div></div>' : "") +
      '<div class="spacer"></div>' +
      '<div class="term' + (t.t.length > 8 ? " term--long" : "") + '">' + esc(t.t) + "</div>" +
      '<div class="spacer"></div>' +
      '<div class="acts">' +
        '<button class="act act--skip" data-act="miss">沒猜到 ⏭</button>' +
        '<button class="act act--hit" data-act="hit">答對了 ✅</button>' +
      "</div>";
  };

  AFTER[ST.CARD] = function () { paintBar(); };

  /* ---------- REVEAL：答案在這組自己的手機上炸出來，同時也是本輪結束 ---------- */
  VIEWS[ST.REVEAL] = function () {
    var t = app.cur;
    var hit = app.result === "hit";
    return "" +
      '<div class="spacer"></div>' +
      '<div class="verdict verdict--' + (hit ? "hit" : "skip") + '">' +
        (hit ? "✅ 答對了" : "⏭ 沒猜到") + "</div>" +
      '<p class="eyebrow">答案是</p>' +
      '<div class="term' + (t.t.length > 8 ? " term--long" : "") + '">' + esc(t.t) + "</div>" +
      (t.hint ? '<p class="hint">畫重點：' + esc(t.hint) + "</p>" : "") +
      '<div class="spacer"></div>' +
      '<p class="tiny">' + roundLabel(app.round) + "結束　·　累計答對 " + app.hit + " 題</p>" +
      '<div class="acts">' + revealActs() + "</div>";
  };

  /** 揭曉頁底下要出現哪幾顆按鈕。
      打完最後一個正式輪時要給兩條路 —— 加碼題是自願的，
      不想上的組別必須能在這裡直接收掉。 */
  function revealActs() {
    if (app.round < MAIN_ROUNDS) {
      return '<button class="act act--go" data-act="nextRound">下一輪 ➜</button>';
    }
    if (app.round === MAIN_ROUNDS && ROUNDS > MAIN_ROUNDS) {
      return '<button class="act act--skip" data-act="toSummary">我們到這裡就好</button>' +
        '<button class="act act--go" data-act="nextRound">挑戰加碼題 ➜</button>';
    }
    return '<button class="act act--go" data-act="toSummary">看總結 ➜</button>';
  }

  /* 揭曉後 1.2 秒才讓按鈕吃點擊。比劃猴按「答對了」的手勢常常連著第二下，
     沒有這道閘會直接把答案跳掉，那組根本來不及看到題目。 */
  AFTER[ST.REVEAL] = function () {
    var acts = document.querySelector(".view--reveal .acts");
    if (!acts) { return; }
    setTimeout(function () { acts.classList.add("is-armed"); }, 1200);
  };

  /* ---------- SUMMARY：整場結算 ---------- */
  VIEWS[ST.SUMMARY] = function () {
    var items = app.log.map(function (e) {
      return '<li class="' + (e.r === "hit" ? "is-hit" : "is-skip") + '">' +
        '<span class="log__m" aria-hidden="true">' + (e.r === "hit" ? "✅" : "⏭") + "</span>" +
        "<span>" + shortRound(e.round) + "　" + esc(e.t) + "</span></li>";
    }).join("");

    return "" +
      '<p class="eyebrow">第 ' + app.group + " 組　全部結束</p>" +
      '<div class="score">答對 ' + app.hit + " / " + app.log.length + " 題</div>" +
      (items ? '<ul class="log">' + items + "</ul>" : '<p class="tiny">這場沒出過題。</p>') +
      '<div class="spacer"></div>' +
      '<div style="text-align:center">' +
        '<button class="link" data-act="toSetup">重新開始</button>' +
      "</div>";
  };

  /* ============================================================
     自己計時（預設關）。開了才會有進度條。
     ============================================================ */
  function paintBar() {
    if (!ticker || !app.selfTimer) { return; }
    var el = $("bar");
    if (!el) { return; }
    var l = ticker.left();
    el.style.width = Math.round((l / DEFAULT_SEC) * 100) + "%";
    el.className = "bar__f" + (l <= 15 ? " low" : "");
  }

  function ensureTicker() {
    if (ticker) { return ticker; }
    ticker = U.Ticker(function (left) {
      paintBar();
      if (left === 0 && app.st === ST.CARD) {
        U.beep(220, 0.7);
        judge("miss");
      }
    });
    return ticker;
  }

  /* ============================================================
     動作
     ============================================================ */
  function judge(result) {
    if (ticker) { ticker.stop(); }
    app.log.push({
      round: app.round, theme: app.theme.name, t: app.cur.t, r: result
    });
    if (result === "hit") { app.hit++; U.beep(880, 0.09); }
    else { U.beep(330, 0.09); }
    go(ST.REVEAL, { result: result });
  }

  var ACTS = {
    resumeYes: function () {
      var s = pending;
      app.group = s.group; app.selfTimer = s.selfTimer; app.seed = s.seed;
      app.round = s.round; app.hit = s.hit; app.log = s.log || [];
      app.result = s.result;
      var p = pickNow();
      app.theme = p.theme;
      app.cur = p.term;
      pending = null;
      go(s.st);
    },
    resumeNo: function () { pending = null; clearSaved(); go(ST.SETUP); },

    group: function (el) { go(ST.READY, { group: +el.getAttribute("data-g"), round: 1, hit: 0, log: [] }); },
    randGroup: function () {
      go(ST.READY, {
        group: 1 + Math.floor(Math.random() * GROUPS), round: 1, hit: 0, log: []
      });
    },

    selfTimer: function (el) { app.selfTimer = el.checked; save(); render(); },

    start: function () {
      keepAwake();
      U.warmAudio();
      if (app.selfTimer) { ensureTicker().start(DEFAULT_SEC); }
      var p = pickNow();
      go(ST.CARD, { cur: p.term, theme: p.theme, result: null });
    },

    hit: function () { judge("hit"); },
    miss: function () { judge("miss"); },

    nextRound: function () {
      go(ST.READY, { round: app.round + 1, result: null, cur: null });
    },
    toSummary: function () { go(ST.SUMMARY); },
    toSetup: function () { clearSaved(); go(ST.SETUP, { round: 1, hit: 0, log: [], cur: null }); }
  };

  $("view").addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el || el.disabled || el.type === "checkbox") { return; }
    var fn = ACTS[el.getAttribute("data-act")];
    if (fn) { fn(el, e); }
  });

  // checkbox 走 change，點 label 才不會被觸發兩次
  $("view").addEventListener("change", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el || el.type !== "checkbox") { return; }
    var fn = ACTS[el.getAttribute("data-act")];
    if (fn) { fn(el, e); }
  });

  /* ============================================================
     開場
     ============================================================ */
  app.seed = DECK.hashSeed(seedText())();
  pending = loadSaved();
  if (pending) { app.st = ST.RESUME; }
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js")["catch"](function () {});
    });
  }
})();
