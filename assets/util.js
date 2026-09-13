/* 兩端共用的小工具。沒有任何相依，第一個載入。 */
(function (global) {
  "use strict";

  function $(id) { return document.getElementById(id); }

  /** 題目與角色文案都會進 innerHTML，一律先過這裡 */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** "20260912"。當天所有手機靠它算出同一個 seed，不需要任何連線 */
  function dayKey(d) {
    d = d || new Date();
    return "" + d.getFullYear() +
      ("0" + (d.getMonth() + 1)).slice(-2) +
      ("0" + d.getDate()).slice(-2);
  }

  /* ---------- 嗶聲 ----------
     不放 mp3，repo 保持純文字。AudioContext 必須在使用者手勢之後才能 resume，
     所以第一次按鍵/點擊時要呼叫 warmAudio()。 */
  var actx = null;
  var muted = false;

  function warmAudio() {
    try {
      actx = actx || new (global.AudioContext || global.webkitAudioContext)();
      if (actx.state === "suspended") { actx.resume(); }
    } catch (e) { /* 不支援就算了，嗶聲只是加分項 */ }
  }

  function beep(freq, dur) {
    if (muted) { return; }
    try {
      warmAudio();
      if (!actx) { return; }
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur + 0.02);
    } catch (e) { /* 同上 */ }
  }

  function setMuted(v) { muted = !!v; }
  function isMuted() { return muted; }

  /** 共用同一個 AudioContext：嗶聲和背景音樂都掛在它底下，
      瀏覽器對每個分頁的 AudioContext 數量有上限，也省得各開一個 */
  function ctx() { warmAudio(); return actx; }

  /* ---------- 計時器 ----------
     不用 setInterval 累減：投影機放 5 分鐘會漂移，分頁切到背景時
     Chrome 還會把 interval 節流到 1/min。改成記結束時刻、每幀重算。 */
  function Ticker(onTick) {
    var endAt = 0, leftPaused = 0, running = false, iv = 0, lastShown = -1;

    function left() {
      return running
        ? Math.max(0, Math.ceil((endAt - performance.now()) / 1000))
        : leftPaused;
    }

    /* 用 setInterval 不用 requestAnimationFrame：rAF 在分頁不在前景時會停掉，
       主持人切去別的視窗再切回來，投影幕上的鐘就凍在那裡。
       這裡只需要秒級精度，而且每次都從 performance.now() 重算，不會累積誤差。 */
    function paint() {
      var l = left();
      var was = running;
      if (was && l <= 0) { running = false; leftPaused = 0; stopLoop(); }
      if (l !== lastShown || was !== running) {
        lastShown = l;
        onTick(l, running);
      }
    }

    function startLoop() { stopLoop(); iv = setInterval(paint, 200); paint(); }
    function stopLoop() { if (iv) { clearInterval(iv); iv = 0; } }

    var api = {
      start: function (sec) {
        leftPaused = sec;
        endAt = performance.now() + sec * 1000;
        running = true; lastShown = -1;
        startLoop();
      },
      pause: function () {
        if (running) {
          leftPaused = left(); running = false; lastShown = -1;
          stopLoop(); paint();
        } else if (leftPaused > 0) {
          endAt = performance.now() + leftPaused * 1000;
          running = true; lastShown = -1;
          startLoop();
        }
      },
      /** 現場加時。手機端不計時，所以這裡一改全場自動吃到 */
      add: function (sec) {
        if (running) { endAt += sec * 1000; }
        else { leftPaused = Math.max(0, leftPaused + sec); }
        lastShown = -1;
        paint();
      },
      /** 擺好秒數但先不跑，主持人按 T 或 S 才開始 */
      arm: function (sec) {
        leftPaused = sec; running = false; lastShown = -1;
        stopLoop(); paint();
      },
      stop: function () { running = false; stopLoop(); },
      left: left,
      isRunning: function () { return running; }
    };
    return api;
  }

  global.TM_UTIL = {
    $: $, esc: esc, dayKey: dayKey,
    beep: beep, warmAudio: warmAudio, ctx: ctx, setMuted: setMuted, isMuted: isMuted,
    Ticker: Ticker
  };
})(window);
