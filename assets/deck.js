/* 題目分派。

   規則是：一輪一個主題，全場主題一樣，同一主題裡各組拿到不同的那一題。
   每個主題只有 4 題，所以

     slot = ((組號 - 1) + (輪次 - 1)) % 4

   這條式子給了三個性質：

   1. 相鄰組號永遠落在不同 slot → 隔壁桌絕對不會跟你比一樣的
   2. 會共用同一題的組固定差 4（1&5、2&6、3&7、4&8），永遠不是隔壁
   3. 加上輪次的偏移，每組每一輪都落在不同 slot，不會四輪都拿同一個位置

   4 組以內完全不撞題；5-8 組會有一對共用，但 pigeonhole 擺在那裡
   —— 8 組 4 題，一定有兩組拿到同一題，能做的只是讓他們離得夠遠。

   每個主題的 4 題會先用當天的 seed 洗過，所以同一個組號在不同場次
   拿到的不是同一題。 */
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

  /** mulberry32 -> [0,1)。狀態只有 32 bits，好存 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher-Yates，就地洗 */
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 第 r 輪是哪個主題。超過主題數就繞回去 */
  function themeAt(themes, round) {
    return themes[(round - 1) % themes.length];
  }

  /** 這個主題的 4 題，用 seed 洗過的順序。同一場活動所有手機算出來一樣 */
  function orderOf(themes, round, seed) {
    var ti = (round - 1) % themes.length;
    return shuffle(themes[ti].terms.slice(), rng((seed >>> 0) + ti * 7919));
  }

  /**
   * 第 g 組在第 r 輪拿到哪一題。
   * @param {{themes:Array, round:number, group:number, seed:number}} o
   * @returns {{theme:Object, term:Object, slot:number}}
   */
  function pick(o) {
    var order = orderOf(o.themes, o.round, o.seed);
    var n = order.length;
    var g = o.group > 0 ? o.group : 1;
    var slot = ((g - 1) + (o.round - 1)) % n;
    return {
      theme: themeAt(o.themes, o.round),
      term: order[slot],
      slot: slot
    };
  }

  /** 幾組以內可以完全不撞題 = 每個主題的題數 */
  function safeGroups(themes) {
    return themes.reduce(function (m, t) {
      return Math.min(m, t.terms.length);
    }, Infinity);
  }

  global.TM_DECK = {
    pick: pick, themeAt: themeAt, orderOf: orderOf, safeGroups: safeGroups,
    rng: rng, shuffle: shuffle, hashSeed: hashSeed
  };
})(window);
