/* 投影端。全場的節奏棒。

   這一端【不知道任何一組現在在比什麼題】—— 各組自己抽題、自己揭曉，
   所以這裡只負責：規則、傳話方式、範例題、大倒數、時間到的 hype。
   正式題目一個字都不會出現在投影幕上。 */
(function () {
  "use strict";

  var U = window.TM_UTIL;
  var $ = U.$, esc = U.esc;
  var TERMS = window.TM_TERMS;
  var THEMES = TERMS.THEMES;
  var DECK = window.TM_DECK;
  var ROLES = window.TM_ROLES.ROLES;
  var QR = window.CDVC_QR;
  var BGM = window.TM_BGM;

  /* 連範例題也不想先曝光的話，把這個改成 false */
  var SHOW_DEMO_TERM = true;

  /* 每一輪（＝每一題）的預設秒數。主持人可以用 +/- 和 1/2/3 現場調 */
  var ROUND_SEC = 240;

  var KEY = "tm.stage.v1";

  /* ============================================================
     手機端網址：從投影端的網址推，不寫死 domain。
     https://u.github.io/ThreeMonky/            -> .../ThreeMonky/play.html
     https://u.github.io/ThreeMonky/index.html  -> 同上
     file:///C:/ThreeMonky/index.html           -> file:///C:/ThreeMonky/play.html
     ============================================================ */
  function playUrl() {
    var u = new URL(location.href);
    u.hash = "";
    u.search = "";
    // 這條同時處理「結尾是 /」和「結尾是 index.html」兩種情況
    u.pathname = u.pathname.replace(/[^/]*$/, "") + "play.html";
    var s = new URLSearchParams(location.search).get("s");
    return u.href + (s ? "?s=" + encodeURIComponent(s) : "");
  }

  /** QR 的底一定要純白。米色紙在投影機上對比不夠，很多手機掃不到 */
  function qrHtml() {
    try {
      return QR.svg(playUrl(), { dark: "#40260F", light: "#ffffff", quiet: 3 });
    } catch (e) {
      return '<p style="color:#333;padding:1rem;font-size:1rem">QR 產生失敗，請直接念網址</p>';
    }
  }

  /* ============================================================
     流程。一維陣列，中途要插一輪就直接 splice，沒有副作用。
     ============================================================ */
  var S = [];
  function add(o) { S.push(o); }

  add({ kind: "cover",   label: "封面" });
  add({ kind: "rules",   label: "三隻猴子是誰" });
  add({ kind: "lineup",  label: "話怎麼傳" });
  add({ kind: "demo",    label: "範例題：" + TERMS.DEMO.t });
  add({ kind: "handoff", label: "比劃猴拿手機・選組號" });
  // 一輪 = 一個主題 = 一題。主題數就是輪數。
  THEMES.forEach(function (th, k) {
    var r = k + 1;
    add({ kind: "round", n: r, theme: th, sec: ROUND_SEC,
          label: "第 " + r + " 輪　" + th.name });
    add({ kind: "timeup", n: r, label: "└ 時間到" });
  });
  add({ kind: "finale",  label: "結束" });

  var i = 0;
  var count = null;     // 3・2・1 的當前那一格
  var showQR = true;    // 正式輪角落的小 QR
  var ranToZero = false;

  /* ============================================================
     計時器
     ============================================================ */
  var ticker = U.Ticker(function (left, running) {
    paintTimer(left, running);
    if (running && left > 0 && left <= 10) { U.beep(880, 0.06); }
    if (left === 0 && ranToZero) { ranToZero = false; U.beep(220, 0.9); }
  });

  function paintTimer(left, running) {
    var el = $("clock");
    if (!el) { return; }
    var m = Math.floor(left / 60), s = left % 60;
    el.className = "timer" + (left === 0 ? " zero" : (left <= 10 ? " low" : ""));
    el.innerHTML = m + ":" + (s < 10 ? "0" : "") + s +
      "<small>" + (left === 0 ? "時間到" : (running ? "比！" : "準備")) + "</small>";
  }

  function startRound() {
    ranToZero = true;
    ticker.start(ticker.left() > 0 ? ticker.left() : S[i].sec);
  }

  /* ============================================================
     畫面
     ============================================================ */
  var VIEWS = {};
  var AFTER = {};

  function roleBar() {
    return '<div class="rolebar">' + ROLES.map(function (x) {
      return "<span>" + x.emoji + " <b>" + esc(x.name) + "</b>：" + esc(x.short) + "</span>";
    }).join("") + "</div>";
  }

  /* 封面先不放 QR，就是一張標題頁。要掃碼的那一步在「交接」頁。
     emoji 包在 .plain 裡：.huge 是漸層剪字，emoji 套進去會被裁成
     一片橘色剪影，得把 background-clip 還原回來才會有顏色。 */
  VIEWS.cover = function () {
    return "" +
      '<p class="eyebrow">至善班相見歡</p>' +
      '<h1 class="huge">三隻猴子<span class="plain">🙊🙉🙈</span></h1>' +
      '<p class="lede"><br>' +
        "每個人扮演不同的角色，分工合作畫出答案</p>";
  };

  VIEWS.rules = function () {
    return "" +
      '<h1 class="big">遊戲規則</h1>' +
      '<p class="lede">三個人一組。題目只有比劃猴看得到，' +
        "<b>答案不是用講的，是用畫的</b>。</p>" +
      '<div class="roles">' +
        ROLES.map(function (x) {
          return '<div class="role">' +
            '<div class="role__e" aria-hidden="true">' + x.emoji + "</div>" +
            '<div class="role__n">' + esc(x.name) + "</div>" +
            '<div class="role__r">' + esc(x.rule) + "</div>" +
            '<div class="role__t">' + esc(x.tip) + "</div>" +
          "</div>";
        }).join("") +
      "</div>";
  };

  VIEWS.lineup = function () {
    function monkey(x) {
      return '<div class="lineup__m"><b aria-hidden="true">' + x.emoji + "</b>" +
        "<span>" + esc(x.name) + "</span></div>";
    }
    function arrow(t) {
      return '<div class="lineup__a"><b aria-hidden="true">➜</b><span>' + esc(t) + "</span></div>";
    }
    return "" +
      '<p class="eyebrow">話怎麼傳</p>' +
      '<h1 class="big">' + esc(window.TM_ROLES.LINEUP) + "</h1>" +
      '<div class="lineup">' +
        monkey(ROLES[0]) + arrow("看動作") +
        monkey(ROLES[1]) + arrow("聽聲音") +
        monkey(ROLES[2]) + arrow("畫出來") +
        '<div class="lineup__m"><b aria-hidden="true">📄</b><span>答案</span></div>' +
      "</div>";
  };

  VIEWS.demo = function () {
    return "" +
      '<p class="term__n">範例題　先示範一次，大家看懂規則再開始</p>' +
      (SHOW_DEMO_TERM
        ? '<div class="term term--demo">' + esc(TERMS.DEMO.t) + "</div>"
        : '<div class="big">（主持人口頭給題）</div>') +
      roleBar() +
      '<p class="lede quiet" style="font-size:1.2rem;margin-top:1.4rem">' +
        "正式題只會出現在比劃猴的手機上，投影幕不會顯示。</p>";
  };

  VIEWS.handoff = function () {
    var steps = [
      ["①", "比劃猴掃 QR"],
      ["②", "選一個代表數字"],
      ["③", "靜待主持人開始"]
    ];
    return "" +
      '<p class="eyebrow">每組派一個人當 🙊 比劃猴</p>' +
      '<h1 class="big">拿出手機</h1>' +
      '<div class="steps">' +
        steps.map(function (s) {
          return '<div class="step"><b>' + s[0] + "</b><span>" + esc(s[1]) + "</span></div>";
        }).join("") +
      "</div>" +
      '<div class="qr" id="qr" style="width:min(22rem,26vw);margin:1.6rem auto 0;border:.3rem solid #fff"></div>' +
      '<p class="cover__url" style="font-size:1.1rem">' + esc(playUrl()) + "</p>";
  };

  AFTER.handoff = function () { $("qr").innerHTML = qrHtml(); };

  VIEWS.round = function () {
    var sc = S[i];
    if (count !== null) {
      return '<div class="count3' + (typeof count === "string" ? " count3--emoji" : "") + '">' +
        esc(count) + "</div>";
    }
    return "" +
      '<p class="eyebrow">第 ' + sc.n + " / " + THEMES.length + " 輪</p>" +
      '<div class="timer" id="clock">0:00<small>準備</small></div>' +
      roleBar();
  };

  AFTER.round = function () {
    paintTimer(ticker.left(), ticker.isRunning());
    paintCornerQR();
  };

  VIEWS.timeup = function () {
    return "" +
      '<div class="slam">時間到 ✋</div>' +
      '<p class="lede">請 🙈 猜題猴睜眼<br>並分享你的曠世巨作</p>';
  };

  AFTER.timeup = function () {
    document.body.classList.add("hype");
    U.beep(220, 0.9);
  };

  VIEWS.finale = function () {
    return "" +
      '<p class="eyebrow">三隻猴子</p>' +
      '<p class="emoji" aria-hidden="true">🙊 🙉 🙈</p>';
  };

  /* ============================================================
     渲染
     ============================================================ */
  function render() {
    var sc = S[i];
    document.body.classList.remove("hype");
    $("screen").innerHTML = VIEWS[sc.kind]();
    if (AFTER[sc.kind]) { AFTER[sc.kind](); }
    paintWhere();
    try { sessionStorage.setItem(KEY, String(i)); } catch (e) {}
  }

  function paintWhere() {
    var sc = S[i];
    var extra = "";
    if (sc.kind === "round") {
      extra = "　<kbd>S</kbd> 3・2・1 開始　<kbd>T</kbd> 暫停　<kbd>+</kbd><kbd>-</kbd> 加減 30 秒" +
        "　<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 3/4/5 分　<kbd>H</kbd> 收 QR";
    }
    $("where").innerHTML = (i + 1) + " / " + S.length + "　" + esc(sc.label) + extra;
  }

  /** 正式輪角落的小 QR，給遲到或手機當掉的組 */
  function paintCornerQR() {
    var old = $("qrCorner");
    if (old) { old.remove(); }
    if (!showQR || S[i].kind !== "round" || count !== null) { return; }
    var box = document.createElement("div");
    box.className = "qr-corner";
    box.id = "qrCorner";
    box.innerHTML = '<div class="qr">' + qrHtml() + "</div><p>比劃猴掃這裡</p>";
    document.body.appendChild(box);
  }

  function go(delta) {
    var next = i + delta;
    if (next < 0 || next >= S.length) { return; }
    i = next;
    count = null;
    var sc = S[i];
    if (sc.kind === "round") { ticker.arm(sc.sec); }
    else { ticker.stop(); }
    var stale = $("qrCorner");
    if (stale) { stale.remove(); }
    render();
  }

  function jump(n) {
    i = Math.max(0, Math.min(S.length - 1, n));
    count = null;
    if (S[i].kind === "round") { ticker.arm(S[i].sec); } else { ticker.stop(); }
    render();
  }

  /* 3・2・1 開始。序列跑完直接接上倒數 */
  function runStartCountdown() {
    if (count !== null) { return; }
    var seq = [3, 2, 1, "開始"];
    var at = 0;
    (function step() {
      count = seq[at];
      render();
      U.beep(at === seq.length - 1 ? 660 : 440, 0.12);
      at++;
      if (at < seq.length) { setTimeout(step, 900); }
      else {
        setTimeout(function () {
          count = null;
          render();
          startRound();
        }, 700);
      }
    })();
  }

  /* ============================================================
     跳關選單
     ============================================================ */
  function buildMenu() {
    $("menuList").innerHTML = S.map(function (sc, n) {
      return "<li><button data-jump=\"" + n + "\" class=\"" + (n === i ? "now" : "") + "\">" +
        (n + 1) + "　" + esc(sc.label) + "</button></li>";
    }).join("") + '<li><button data-act="addRound">➕ 再加一輪</button></li>';
    $("menuKeys").innerHTML =
      "<kbd>F</kbd> 全螢幕　<kbd>S</kbd> 3・2・1 開始　<kbd>T</kbd> 倒數開始/暫停　" +
      "<kbd>R</kbd> 重設本輪　<kbd>+</kbd><kbd>-</kbd> 加減 30 秒　" +
      "<kbd>C</kbd> 亮場/暗場　<kbd>H</kbd> 角落 QR　<kbd>M</kbd> 靜音";
  }

  function toggleMenu() {
    var m = $("menu");
    if (m.hidden) { buildMenu(); m.hidden = false; }
    else { m.hidden = true; }
  }

  /** 主持人臨時想多玩一輪。S 是純陣列，插進 finale 前面就好 */
  function addRound() {
    var at = S.length - 1;                       // finale 的位置
    var n = S.filter(function (x) { return x.kind === "round"; }).length + 1;
    var th = DECK.themeAt(THEMES, n);            // 超過主題數就繞回第一個
    S.splice(at, 0,
      { kind: "round", n: n, theme: th, sec: ROUND_SEC,
        label: "第 " + n + " 輪　" + th.name },
      { kind: "timeup", n: n, label: "└ 時間到" });
    $("menu").hidden = true;
    jump(at);
  }

  $("menu").addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("button") : null;
    if (!el) { return; }
    if (el.getAttribute("data-act") === "addRound") { addRound(); return; }
    var n = el.getAttribute("data-jump");
    if (n === null) { return; }
    $("menu").hidden = true;
    jump(+n);
  });

  /* ============================================================
     全螢幕・暗場
     ============================================================ */
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()["catch"](function () {});
    }
  }

  /** 嗶聲 + 背景音樂一起開關 */
  function toggleSound() {
    var on = !U.isMuted();          // 現在有聲 -> 要靜音
    U.setMuted(on);
    BGM.setMuted(on);
    if (!on) { BGM.start(); }
    paintSound();
  }

  function paintSound() {
    var b = $("musicBtn");
    if (b) { b.textContent = U.isMuted() ? "🔇 已靜音" : "🎵 音樂"; }
  }

  function applyDark(on) {
    document.body.classList.toggle("dark", on);
    try { localStorage.setItem("tm.dark", on ? "1" : "0"); } catch (e) {}
  }

  /* ============================================================
     鍵盤
     ============================================================ */
  document.addEventListener("keydown", function (e) {
    var sc = S[i];
    U.warmAudio();                 // AudioContext 要在使用者手勢之後才能 resume
    if (!U.isMuted()) { BGM.start(); }

    if (e.key === "Escape") { e.preventDefault(); toggleMenu(); return; }
    if (!$("menu").hidden) { return; }

    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "Enter") {
      e.preventDefault(); go(1); return;
    }
    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault(); go(-1); return;
    }

    if (e.key === "+" || e.key === "=") { ticker.add(30); return; }
    if (e.key === "-" || e.key === "_") { ticker.add(-30); return; }

    if (sc.kind === "round" && (e.key === "1" || e.key === "2" || e.key === "3")) {
      sc.sec = { "1": 180, "2": 240, "3": 300 }[e.key];
      ranToZero = true;
      ticker.start(sc.sec);
      return;
    }

    var k = e.key.toLowerCase();

    if (k === "f") { toggleFull(); return; }
    if (k === "c") { applyDark(!document.body.classList.contains("dark")); return; }
    if (k === "m") { toggleSound(); return; }

    if (k === "h") { showQR = !showQR; paintCornerQR(); return; }

    if (k === "s") { if (sc.kind === "round") { runStartCountdown(); } return; }

    if (k === "t") {
      if (sc.kind !== "round") { return; }
      if (ticker.left() > 0) { ranToZero = true; ticker.pause(); }
      else { ranToZero = true; ticker.start(sc.sec); }
      return;
    }

    if (k === "r") {
      if (sc.kind === "round") { ticker.arm(sc.sec); }
      return;
    }
  });

  /* ============================================================
     控制列：滑鼠不動 3 秒就收起來
     ============================================================ */
  var idle = 0;
  document.addEventListener("mousemove", function () {
    document.body.classList.add("show-ui");
    clearTimeout(idle);
    idle = setTimeout(function () {
      document.body.classList.remove("show-ui");
    }, 3000);
  });

  $("bar").addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) { return; }
    var a = el.getAttribute("data-act");
    if (!U.isMuted()) { BGM.start(); }     // 只用滑鼠的主持人也要能把音樂打開
    if (a === "prev") { go(-1); }
    else if (a === "next") { go(1); }
    else if (a === "menu") { toggleMenu(); }
    else if (a === "full") { toggleFull(); }
    else if (a === "music") { toggleSound(); }
  });

  /* ============================================================
     開場
     ============================================================ */
  try { applyDark(localStorage.getItem("tm.dark") === "1"); } catch (e) {}

  // 投影端不小心重整時回到同一頁，但【倒數不自動續跑】—— 主持人要有主動權
  try {
    var saved = parseInt(sessionStorage.getItem(KEY), 10);
    if (saved >= 0 && saved < S.length) { i = saved; }
  } catch (e) {}

  if (S[i].kind === "round") { ticker.arm(S[i].sec); }
  render();
  paintSound();

  // 投影端也註冊，主持人的筆電斷網一樣開得起來
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js")["catch"](function () {});
    });
  }
})();
