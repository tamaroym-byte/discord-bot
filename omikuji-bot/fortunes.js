const luckLevels = ["大吉", "吉", "中吉", "小吉", "末吉", "凶", "大凶"];

const wishes = [
  "焦らず進めば願いに近づきます。",
  "周囲に相談すると良い道が開けます。",
  "一度立ち止まり見直すと良いでしょう。",
  "昨夜考えた願いほど実現しやすい日です。",
  "欲張らず一つに絞ると叶いやすいでしょう。",
  "小さな積み重ねが大きな結果になります。",
  "タイミングは午後に訪れます。見逃さないでください。",
  "思い切った行動が良運を引き寄せます。",
  "人に優しくすることが吉です。",
  "今日始めることは長く良い結果を生みます。"
];

const people = [
  "懐かしい人との再会に縁があります。",
  "意外な相手が力になってくれるでしょう。",
  "待っていた連絡は夕方に届く兆しです。",
  "近しい友人との会話に良いヒントがあります。",
  "新しい出会いは趣味の場にありそうです。",
  "年上の人物が良い助言をくれます。",
  "久しぶりの交流が運気を上げます。",
  "気になっている人とは自然体で接すると吉です。",
  "遠方の相手とも良縁があります。",
  "まず自分から声をかけると流れが良くなります。"
];

const losts = [
  "最後に使った場所を丁寧に探すと見つかります。",
  "机や棚の隅に隠れていそうです。",
  "布や服の近くに紛れている可能性があります。",
  "意外と足元や低い位置にあります。",
  "身近な人が手がかりを知っているでしょう。",
  "カバンの小さなポケットを確認してください。",
  "昨日立ち寄った場所に心当たりがあります。",
  "落ち着いて順番に探すと早く見つかります。",
  "電子機器の近くに置き忘れているかもしれません。",
  "一度諦めた後にふと見つかりそうです。"
];

const travels = [
  "東の方角が吉です。",
  "西の方角に良い出会いがあります。",
  "南への移動は気分転換に最適です。",
  "北へ向かうと落ち着いた時間を過ごせます。",
  "北東は新しい発見に恵まれます。",
  "南西は金運を呼び込みやすい方角です。",
  "朝の出発が最も運気を高めます。",
  "夕方の移動は良い景色に恵まれます。",
  "近場への小旅行が心を整えます。",
  "寄り道が思わぬ幸運を呼びます。"
];

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function pick(array, seedOffset, seed) {
  return array[Math.floor(seededRandom(seed + seedOffset) * array.length)];
}

function getDailyFortune(userId) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const baseSeed = Number(userId.slice(-6)) + Number(today);

  return {
    luck: pick(luckLevels, 0, baseSeed),
    wish: pick(wishes, 1, baseSeed),
    person: pick(people, 2, baseSeed),
    lost: pick(losts, 3, baseSeed),
    travel: pick(travels, 4, baseSeed)
  };
}

module.exports = { getDailyFortune };
