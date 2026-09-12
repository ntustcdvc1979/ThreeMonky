/* 手機端。只有 🙊 比劃猴會開這一頁。

   這一端【完全不跟投影端通訊】：題庫打包在 terms.js 裡，
   各組自己抽題、自己揭曉。全場共同的節奏由投影幕的大鐘負責，
   所以這裡預設不計時 —— 比劃猴晚幾秒按「開始」只是自己少玩幾秒，
   不會讓整組的結束時間跟別組歪掉。 */
(function () {
  "use strict";

  var U = window.TM_UTIL;
  var $ = U.$, esc = U.esc;
  var DECK = window.TM_DECK;
  var TERMS = window.TM_TERMS;
  var ROLES = window.TM_ROLES.ROLES;

  var GROUPS = 12;          // 組號按鈕做幾顆，也是發牌分流的分母
  var KEY = "tm.play.v1";
  var DEFAULT_SEC = 150;    // 只有「自己計時」打開時才用得到

  var ST = {
    RESUME: "resume", SETUP: "setup", LEVEL: "level",
    READY: "ready", CARD: "card", REVEAL: "reveal", SUMMARY: "summary"
  };

  var app = {
    st: ST.SETUP,
    group: null,
    levels: [1, 2],
    selfTimer: false,
    seed: 0,
    at: 0,
    round: 1,
    cur: null,
    result: null,      // "hit" | "skip"
    hit: 0, skip: 0,
    log: [],           // 本輪出過的題 [{t, r}]
    totalHit: 0,
    exhausted: false   // 整包題目發完了
  };

  var deck = null;
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

  function rebuildDeck() {
    deck = DECK.create({
      terms: TERMS.TERMS,
      levels: app.levels,
      seed: app.seed,
      group: app.group,
      groups: GROUPS,
      at: app.at
    });
    return deck;
  }

  /** 150 -> "2 分 30 秒"。不能用 Math.round(sec/60)，2.5 分會被講成 3 分鐘 */
  function fmtMin(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + " 分" + (s ? " " + s + " 秒" : "鐘");
  }

  function poolSize(levels) {
    return TERMS.TERMS.filter(function (t) {
      return levels.indexOf(t.lv) >= 0;
    }).length;
  }

  /* ============================================================
     存檔。只存 seed + 游標，不存整副牌 —— 靠 seed/levels/group
     就能把一模一樣的順序重建出來。這是用 seeded PRNG 最實際的理由。
     用 sessionStorage 不用 localStorage：活動結束關掉分頁就自然清空，
     不會有人隔週打開發現自己卡在第 3 輪。
     ============================================================ */
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        day: U.dayKey(), seedText: seedText(),
        st: app.st, group: app.group, levels: app.levels,
        selfTimer: app.selfTimer, seed: app.seed,
        at: deck ? deck.at : app.at,
        round: app.round, hit: app.hit, skip: app.skip,
        log: app.log, totalHit: app.totalHit,
        curId: app.cur ? app.cur.id : null, result: app.result
      }));
    } catch (e) { /* 無痕模式會丟例外，不值得為此中斷遊戲 */ }
  }

  function loadSaved() {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (!s || s.day !== U.dayKey() || s.seedText !== seedText()) { return null; }
      if (s.st === ST.SETUP || s.st === ST.LEVEL) { return null; }  // 還沒開始，沒什麼好還原
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
    if (deck) { app.at = deck.at; }
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
      lock.addEventListener("release", function () { wl = null; paintWake(); });
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
      keepAwake().then(paintWake);
    }
  });

  function paintWake() {
    var el = $("wake");
    if (!el) { return; }
    el.textContent = wakeOK ? "⚡ 螢幕保持亮著" : "";
  }

  function wakeNote() {
    if (!wakeTried || wakeOK) { return ""; }
    return '<p class="note">這支瀏覽器不支援「保持螢幕亮著」。' +
      "建議先去設定把自動鎖定調長一點，不然比到一半螢幕會暗掉。</p>";
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
    document.body.classList.toggle("is-skip", app.st === ST.REVEAL && app.result === "skip");
    if (AFTER[app.st]) { AFTER[app.st](); }
  }

  function roleBar() {
    return '<div class="row">' + ROLES.map(function (r) {
      return '<span class="pill">' + r.emoji + " " + esc(r.short) + "</span>";
    }).join("") + "</div>";
  }

  /* ---------- RESUME ---------- */
  VIEWS[ST.RESUME] = function () {
    var s = pending;
    var where = "第 " + s.round + " 輪、答對 " + s.hit + " 題";
    return "" +
      '<p class="eyebrow">剛剛玩到一半</p>' +
      '<h1 class="hero">要接著玩嗎？</h1>' +
      '<div class="card"><p class="lede">你停在 <b>' + esc(where) + "</b>。" +
        "接著玩會回到同一副牌、同一題。</p></div>" +
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
      '<p class="eyebrow">三隻猴子</p>' +
      '<h1 class="hero">你是 🙊 比劃猴</h1>' +
      '<p class="lede">這支手機只有你看。另外兩隻猴子不用看螢幕。</p>' +
      '<div class="card">' +
        '<p class="tiny" style="margin-bottom:.6rem">' +
          "<b>你們是第幾組？</b>　選對組號，才不會跟隔壁組比到一樣的題目。</p>" +
        '<div class="groups">' + btns + "</div>" +
      "</div>" +
      '<div class="spacer"></div>' +
      roleBar() +
      '<div style="text-align:center">' +
        '<button class="link" data-act="noGroup">沒分組，隨便給我題目</button>' +
      "</div>";
  };

  /* ---------- LEVEL：挑難度 ---------- */
  VIEWS[ST.LEVEL] = function () {
    var n = poolSize(app.levels);
    var stride = app.group ? Math.floor(n / GROUPS) : 0;
    var cards = TERMS.LEVELS.map(function (L) {
      var on = app.levels.indexOf(L.lv) >= 0;
      return '<button class="lv' + (on ? " is-on" : "") + '" data-act="lv" data-lv="' + L.lv + '"' +
        ' aria-pressed="' + on + '">' +
        '<span class="lv__e" aria-hidden="true">' + L.emoji + "</span>" +
        '<span class="lv__b"><span class="lv__n">' + esc(L.name) + "</span><br>" +
        '<span class="lv__d">' + esc(L.desc) + "</span></span>" +
        '<span class="lv__c" aria-hidden="true">' + (on ? "✓" : "") + "</span>" +
        "</button>";
    }).join("");

    var warn = "";
    if (n === 0) {
      warn = '<p class="note">至少要選一個難度。</p>';
    } else if (app.group && stride < 3) {
      warn = '<p class="note">這包只有 ' + n + " 題，分給 " + GROUPS +
        " 組會不夠用，隔壁組很可能跟你比到一樣的。建議再多勾一個難度。</p>";
    }

    return "" +
      '<p class="eyebrow">' + (app.group ? "第 " + app.group + " 組" : "沒分組") + "</p>" +
      '<h1 class="hero">要玩哪種題目？</h1>' +
      '<p class="lede">可以複選。這包有 <b>' + n + "</b> 題。</p>" +
      '<div class="lvs">' + cards + "</div>" +
      warn +
      '<label class="toggle">' +
        '<input type="checkbox" data-act="selfTimer"' + (app.selfTimer ? " checked" : "") + ">" +
        "<span>自己計時（分在不同教室、看不到投影幕時才打開）</span>" +
      "</label>" +
      '<div class="spacer"></div>' +
      '<div class="acts">' +
        '<button class="act act--go" data-act="toReady"' + (n === 0 ? " disabled" : "") +
          ">準備好了 ➜</button>" +
      "</div>";
  };

  /* ---------- READY：待命 ---------- */
  VIEWS[ST.READY] = function () {
    return "" +
      '<div class="row row--between">' +
        '<span class="pill">' + (app.group ? "第 " + app.group + " 組" : "沒分組") + "</span>" +
        '<span class="pill">局號 ' + esc(deck.code) + "</span>" +
      "</div>" +
      '<p class="eyebrow">第 ' + app.round + " 輪</p>" +
      '<h1 class="hero">準備好就開始</h1>' +
      '<p class="lede">' + (app.selfTimer
        ? "按下去之後會開始倒數 " + fmtMin(DEFAULT_SEC) + "。"
        : "看投影幕上的大鐘，主持人喊開始你再按。") + "</p>" +
      '<div class="card"><p class="tiny">' +
        "🙊 你面對手機比動作　🙉 背對你、只能講　🙈 閉眼、把聽到的畫在紙上" +
      "</p></div>" +
      '<div class="spacer"></div>' +
      wakeNote() +
      '<p class="tiny">牌堆還有 ' + deck.remaining() + " 題</p>" +
      '<div class="acts">' +
        '<button class="act act--hit" data-act="start">開始比 🙊</button>' +
      "</div>";
  };

  AFTER[ST.READY] = function () { paintWake(); };

  /* ---------- CARD：出題 ---------- */
  VIEWS[ST.CARD] = function () {
    var t = app.cur;
    var lv = TERMS.LEVELS.filter(function (L) { return L.lv === t.lv; })[0];
    return "" +
      '<div class="row row--between">' +
        '<span class="pill">第 ' + (app.hit + app.skip + 1) + " 題</span>" +
        (lv ? '<span class="pill">' + lv.emoji + " " + esc(lv.name) + "</span>" : "") +
        '<span class="pill">本輪 ✅ ' + app.hit + "</span>" +
      "</div>" +
      (app.selfTimer ? '<div class="bar"><div class="bar__f" id="bar"></div></div>' : "") +
      /* 主持人喊「停」的時候，比劃猴常常正卡在一張還沒判定的題上。
         給一個出口，但擺在畫面最上方、遠離拇指區，免得比到一半誤觸。 */
      '<div style="text-align:right;margin-top:-.3rem">' +
        '<button class="link" data-act="endRound">本輪結束</button>' +
      "</div>" +
      '<div class="spacer"></div>' +
      '<div class="term' + (t.t.length > 8 ? " term--long" : "") + '">' + esc(t.t) + "</div>" +
      '<div class="spacer"></div>' +
      '<p class="wake" id="wake"></p>' +
      '<div class="acts">' +
        '<button class="act act--skip" data-act="skip">跳過 ⏭</button>' +
        '<button class="act act--hit" data-act="hit">答對了 ✅</button>' +
      "</div>";
  };

  AFTER[ST.CARD] = function () { paintWake(); paintBar(); };

  /* ---------- REVEAL：答案在這組自己的手機上炸出來 ---------- */
  VIEWS[ST.REVEAL] = function () {
    var t = app.cur;
    var hit = app.result === "hit";
    var last = !deck.peek();
    return "" +
      '<div class="spacer"></div>' +
      '<div class="verdict verdict--' + (hit ? "hit" : "skip") + '">' +
        (hit ? "✅ 答對了" : "⏭ 跳過") + "</div>" +
      '<p class="eyebrow">題目是</p>' +
      '<div class="term' + (t.t.length > 8 ? " term--long" : "") + '">' + esc(t.t) + "</div>" +
      (t.hint ? '<p class="hint">畫重點：' + esc(t.hint) + "</p>" : "") +
      '<div class="spacer"></div>' +
      '<p class="tiny">本輪 ✅ ' + app.hit + "　⏭ " + app.skip +
        (last ? "　·　題目發完了" : "") + "</p>" +
      '<div class="acts">' +
        '<button class="act act--skip" data-act="endRound">本輪結束</button>' +
        '<button class="act act--go" data-act="nextTerm"' + (last ? " disabled" : "") +
          ">下一題 ➜</button>" +
      "</div>";
  };

  /* 揭曉後 1.2 秒才讓按鈕吃點擊。比劃猴按「答對了」的手勢常常連著第二下，
     沒有這道閘會直接把答案跳掉，那組根本來不及看到題目。 */
  AFTER[ST.REVEAL] = function () {
    var acts = document.querySelector(".view--reveal .acts");
    if (!acts) { return; }
    setTimeout(function () { acts.classList.add("is-armed"); }, 1200);
  };

  /* ---------- SUMMARY ---------- */
  VIEWS[ST.SUMMARY] = function () {
    var items = app.log.map(function (e) {
      return '<li class="' + (e.r === "hit" ? "is-hit" : "is-skip") + '">' +
        '<span class="log__m" aria-hidden="true">' + (e.r === "hit" ? "✅" : "⏭") + "</span>" +
        "<span>" + esc(e.t) + "</span></li>";
    }).join("");

    return "" +
      '<p class="eyebrow">第 ' + app.round + " 輪結束</p>" +
      '<div class="score">答對 ' + app.hit + " 題</div>" +
      '<p class="lede">整場累計 ' + app.totalHit + " 題。看看猜題猴畫了什麼。</p>" +
      (app.exhausted ? '<p class="note">題庫發完了。要再玩就換個難度。</p>' : "") +
      (items ? '<ul class="log">' + items + "</ul>" : '<p class="tiny">這輪沒出過題。</p>') +
      '<div class="spacer"></div>' +
      '<div style="text-align:center">' +
        '<button class="link" data-act="toLevel">換難度</button>' +
        '<button class="link" data-act="toSetup">重新設定</button>' +
      "</div>" +
      '<div class="acts">' +
        '<button class="act act--go" data-act="nextRound"' +
          (deck.peek() ? "" : " disabled") + ">下一輪 ➜</button>" +
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
        go(ST.SUMMARY);
      }
    });
    return ticker;
  }

  /* ============================================================
     動作
     ============================================================ */
  function drawNext() {
    var t = deck.next();
    if (!t) {
      go(ST.SUMMARY, { exhausted: true });
      return;
    }
    go(ST.CARD, { cur: t, result: null });
  }

  function judge(result) {
    app.log.push({ t: app.cur.t, r: result });
    if (result === "hit") { app.hit++; app.totalHit++; U.beep(880, 0.09); }
    else { app.skip++; U.beep(330, 0.09); }
    go(ST.REVEAL, { result: result });
  }

  var ACTS = {
    resumeYes: function () {
      var s = pending;
      app.group = s.group; app.levels = s.levels; app.selfTimer = s.selfTimer;
      app.seed = s.seed; app.at = s.at; app.round = s.round;
      app.hit = s.hit; app.skip = s.skip; app.log = s.log || [];
      app.totalHit = s.totalHit; app.result = s.result;
      rebuildDeck();
      // curId 存的是題目 id 不是索引，就算之後題庫插了新題也還原得回來
      if (s.curId) {
        app.cur = deck.order.filter(function (t) { return t.id === s.curId; })[0] || null;
      }
      pending = null;
      if (!app.cur && (s.st === ST.CARD || s.st === ST.REVEAL)) { go(ST.READY); return; }
      go(s.st);
    },
    resumeNo: function () { pending = null; clearSaved(); rebuildDeck(); go(ST.SETUP); },

    group: function (el) { go(ST.LEVEL, { group: +el.getAttribute("data-g") }); },
    noGroup: function () { go(ST.LEVEL, { group: null }); },

    lv: function (el) {
      var lv = +el.getAttribute("data-lv");
      var i = app.levels.indexOf(lv);
      if (i >= 0) { app.levels.splice(i, 1); }
      else { app.levels.push(lv); app.levels.sort(); }
      save();
      render();
    },
    selfTimer: function (el) { app.selfTimer = el.checked; save(); render(); },

    toReady: function () {
      app.at = 0;
      rebuildDeck();
      go(ST.READY, { round: 1, hit: 0, skip: 0, log: [], totalHit: 0, exhausted: false });
    },

    start: function () {
      keepAwake().then(paintWake);
      U.warmAudio();
      if (app.selfTimer) { ensureTicker().start(DEFAULT_SEC); }
      drawNext();
    },

    hit: function () { judge("hit"); },
    skip: function () { judge("skip"); },
    nextTerm: drawNext,

    endRound: function () {
      if (ticker) { ticker.stop(); }
      go(ST.SUMMARY);
    },

    nextRound: function () {
      go(ST.READY, {
        round: app.round + 1, hit: 0, skip: 0, log: [], result: null, cur: null
      });
    },
    toLevel: function () { go(ST.LEVEL); },
    toSetup: function () { clearSaved(); go(ST.SETUP); }
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

  rebuildDeck();   // 先給一副，讓 VIEWS 不用到處判斷 deck 是不是 null
  if (pending) { app.st = ST.RESUME; }
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js")["catch"](function () {});
    });
  }
})();
