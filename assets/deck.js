/* 發牌。三件事各解一個問題：

   1. Fisher-Yates 洗整包後依序發  → 同一組內絕不重複出題
      （每次 Math.random() 抽單題一定會抽到重複的）
   2. 組號偏移                     → 隔壁組不會同時在比一樣的東西
   3. seeded PRNG                  → 重整不掉進度：只要存 seed + 游標
                                     就能重建整個順序，不必存整副牌

   關於 2 能保證到什麼程度，看 create() 上面那段註解。 */
(function (global) {
  "use strict";

  /** 字串 -> 32-bit 種子（xmur3） */
  function hashSeed(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  /** mulberry32 -> [0,1)。週期夠長，狀態只有 32 bits，好存 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    if (global.crypto && global.crypto.getRandomValues) {
      return global.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
  }

  /** Fisher-Yates，就地洗。rand 是 () => [0,1) */
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 建一副牌。所有手機用同一個 seed 洗出同一份順序，
   * 第 g 組從 offset = (g-1) * stride 開始取。
   *
   * 這個機制真正保證的是：第 g 組的第 k 張是 order[((g-1)*stride + k) % n]，
   * 兩組要同時撞題得滿足 (g'-g)*stride ≡ d (mod n)，d 是兩組的進度差。
   * 因為 (g'-g)*stride < n，所以【只要任兩組的進度差距小於 stride 題，
   * 就不可能同時出現同一題】。
   *
   * 整場完全不重複是做不到的 —— 12 組 x 3 輪 x 6 題 = 216 次抽牌，
   * 題庫只有 74 題。但「不同組在不同時間抽到同一題」不影響體驗，
   * 「隔壁組現在在比一樣的東西」才影響，而後者正是這裡擋掉的。
   *
   * 注意 stride 會跟著【篩選後】的池子縮水：74 題 / 12 組 = 6（安全），
   * 只勾 Lv1 的話 18 / 12 = 1（形同沒保護）。呼叫端要看 deck.stride 提醒使用者。
   *
   * @param {{terms:Array, levels:number[], seed:number,
   *          group:(number|null), groups:number, at:number}} o
   */
  function create(o) {
    var levels = o.levels || [];
    var pool = (o.terms || []).filter(function (t) {
      return levels.indexOf(t.lv) >= 0;
    });
    var order = shuffle(pool.slice(), rng(o.seed));
    var n = order.length;
    var G = Math.max(1, o.groups || 12);
    var stride = (o.group && n) ? Math.max(1, Math.floor(n / G)) : 0;
    var offset = (o.group && n) ? ((o.group - 1) * stride) % n : 0;
    if (offset) { order = order.slice(offset).concat(order.slice(0, offset)); }

    var deck = {
      order: order,
      at: o.at || 0,
      seed: o.seed,
      stride: stride,
      /** 局號。給現場對照用：同一場所有手機應該顯示同一組四碼 */
      code: ("000" + (o.seed >>> 0).toString(36).toUpperCase()).slice(-4),
      size: function () { return order.length; },
      remaining: function () { return order.length - deck.at; },
      peek: function () { return deck.at < order.length ? order[deck.at] : null; },
      /** @returns {Object|null} null = 整包出完了 */
      next: function () {
        var t = deck.peek();
        if (t) { deck.at++; }
        return t;
      },
      /** 還原存檔用：把游標移到某個 id 上（回傳是否找到） */
      seekTo: function (id) {
        for (var i = 0; i < order.length; i++) {
          if (order[i].id === id) { deck.at = i; return true; }
        }
        return false;
      },
      reset: function () { deck.at = 0; }
    };
    return deck;
  }

  global.TM_DECK = {
    create: create, rng: rng, shuffle: shuffle,
    hashSeed: hashSeed, randomSeed: randomSeed
  };
})(window);
