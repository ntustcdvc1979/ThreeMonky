/* 背景音樂。

   沒有音檔 —— 整段是用 Web Audio 即時合成的。這樣 repo 保持零二進位檔，
   也不會踩到授權問題。代價是它是一段會一直繞的簡單循環，不是真正的配樂。

   想換成真的音樂：把檔案放成 assets/bgm.mp3，start() 會優先用它，
   合成的那套自動退場。不用改任何一行程式。

   音量壓得很低（0.16），台上講話一定蓋得過它。 */
(function (global) {
  "use strict";

  var U = global.TM_UTIL;

  var FILE = "assets/bgm.mp3";   // 有這個檔就用它，沒有就用合成的
  var VOL = 0.16;

  var A = null;        // AudioContext（跟嗶聲共用）
  var master = null;   // 總音量
  var el = null;       // 有音檔時的 <audio>
  var srcNode = null;
  var iv = 0;
  var playing = false;
  var muted = false;
  var step = 0;
  var nextAt = 0;

  var BPM = 96;
  var STEP = 60 / BPM / 2;       // 八分音符
  var BAR = STEP * 8;            // 4/4 一小節
  var LOOP = 32;                 // 4 小節

  /* I - V - vi - IV，C 大調。這組進行聽起來就是「輕鬆愉快」的那個味道。
     數字是相對 C4 的半音。 */
  var CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
  var BASS = [-24, -17, -15, -20];
  /* 琶音每一拍踩和弦的第幾個音。不規則一點才不會像練習曲 */
  var ARP = [0, 2, 1, 2, 0, 1, 2, 1];

  function hz(semi) { return 261.63 * Math.pow(2, semi / 12); }

  /* ---------- 三種音色 ---------- */

  /** 撥弦感的琶音：三角波 + 快速衰減 */
  function pluck(freq, at, gain) {
    var o = A.createOscillator(), g = A.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    o.connect(g); g.connect(master);
    o.start(at);
    o.stop(at + 0.5);
  }

  /** 襯底和弦：正弦 + 低通，慢進慢出，不搶前景 */
  function pad(semis, at, dur) {
    var f = A.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1400;
    f.connect(master);

    var g = A.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.09, at + 0.35);
    g.gain.setValueAtTime(0.09, at + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(f);

    semis.forEach(function (s) {
      var o = A.createOscillator();
      o.type = "sine";
      o.frequency.value = hz(s);
      // 兩個 osc 差一點點頻率會有厚度，但這裡只用一個，保持乾淨
      o.connect(g);
      o.start(at);
      o.stop(at + dur + 0.05);
    });
  }

  /** 低音：純正弦，短一點，只給拍點 */
  function bass(freq, at) {
    var o = A.createOscillator(), g = A.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + BAR * 0.8);
    o.connect(g); g.connect(master);
    o.start(at);
    o.stop(at + BAR);
  }

  /* ---------- 排程 ----------
     Web Audio 的排程要提前餵，不能等到該響的那一刻才呼叫，
     所以用 setInterval 每 40ms 看一次，把接下來 0.25 秒的音先排好。
     時間全部從 A.currentTime 算，分頁被節流也不會走音。 */
  function playStep(s, at) {
    var barIdx = Math.floor(s / 8) % CHORDS.length;
    var chord = CHORDS[barIdx];
    var beat = s % 8;

    if (beat === 0) {
      bass(hz(BASS[barIdx]), at);
      pad(chord, at, BAR);
    }
    // 第 5 拍留白一下，整段才不會塞太滿
    if (beat !== 4) {
      var note = chord[ARP[beat]] + 12;
      pluck(hz(note), at, beat === 0 ? 0.11 : 0.07);
    }
  }

  function tick() {
    if (!A) { return; }
    while (nextAt < A.currentTime + 0.25) {
      if (nextAt > A.currentTime) { playStep(step, nextAt); }
      step = (step + 1) % LOOP;
      nextAt += STEP;
    }
  }

  /* ---------- 對外 ---------- */

  function ensure() {
    A = U.ctx();
    if (!A) { return false; }
    if (!master) {
      master = A.createGain();
      master.gain.value = muted ? 0 : VOL;
      master.connect(A.destination);
    }
    return true;
  }

  /** 有 assets/bgm.mp3 就用它，沒有就回 false 走合成 */
  function tryFile() {
    if (el) { return true; }
    var a = new Audio(FILE);
    a.loop = true;
    a.preload = "auto";
    // 檔案不存在 / 不是音訊，play() 會 reject，那就靜靜地走合成路線
    return a.play().then(function () {
      el = a;
      try {
        srcNode = A.createMediaElementSource(el);
        srcNode.connect(master);
      } catch (e) {
        // 接不進 AudioContext 就直接用 element 的音量
        el.volume = muted ? 0 : VOL * 2;
      }
      return true;
    })["catch"](function () {
      try { a.pause(); } catch (e) {}
      return false;
    });
  }

  function startSynth() {
    step = 0;
    nextAt = A.currentTime + 0.12;
    clearInterval(iv);
    iv = setInterval(tick, 40);
    tick();
  }

  /** 必須在使用者手勢之後呼叫，否則 AudioContext 起不來 */
  function start() {
    if (playing) { return; }
    if (!ensure()) { return; }
    playing = true;
    tryFile().then(function (gotFile) {
      if (!gotFile && playing) { startSynth(); }
    });
  }

  function stop() {
    playing = false;
    clearInterval(iv); iv = 0;
    if (el) { try { el.pause(); } catch (e) {} }
  }

  function setMuted(v) {
    muted = !!v;
    if (master && A) {
      // 直接砍到 0 會爆音，給 0.15 秒滑過去
      master.gain.cancelScheduledValues(A.currentTime);
      master.gain.setValueAtTime(master.gain.value, A.currentTime);
      master.gain.linearRampToValueAtTime(muted ? 0 : VOL, A.currentTime + 0.15);
    }
    if (el && !srcNode) { el.volume = muted ? 0 : VOL * 2; }
  }

  function isMuted() { return muted; }
  function isPlaying() { return playing; }

  global.TM_BGM = {
    start: start, stop: stop,
    setMuted: setMuted, isMuted: isMuted, isPlaying: isPlaying
  };
})(window);
