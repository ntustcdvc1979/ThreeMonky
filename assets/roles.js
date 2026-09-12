/* 三隻猴子是誰。純資料，改文案只要動這裡。 */
(function (global) {
  "use strict";

  var ROLES = [
    {
      emoji: "🙊", name: "比劃猴", short: "只能比，不能說",
      rule: "拿著手機看題目。只能比手畫腳，發出任何一個字就算犯規。",
      tip: "手機只有你看得到，別讓後面兩隻偷瞄"
    },
    {
      emoji: "🙉", name: "傳話猴", short: "只能說，不能比",
      rule: "背對題目，只看得到比劃猴的動作。用嘴巴把你看到的講給猜題猴聽。",
      tip: "手要放口袋，一比就犯規"
    },
    {
      emoji: "🙈", name: "猜題猴", short: "閉眼，用畫的",
      rule: "閉上眼睛、背對。只能用聽的，然後把聽到的東西畫在紙上。",
      tip: "畫完才睜眼，全程不准問問題"
    }
  ];

  var LINEUP = "三個人站成一直線，中間隔一步";

  global.TM_ROLES = { ROLES: ROLES, LINEUP: LINEUP };
})(window);
