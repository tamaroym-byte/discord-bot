const luckLevels = [
  { name: "大吉", weight: 5 },
  { name: "吉", weight: 15 },
  { name: "中吉", weight: 20 },
  { name: "小吉", weight: 25 },
  { name: "末吉", weight: 20 },
  { name: "凶", weight: 10 },
  { name: "大凶", weight: 5 }
];

// ===== 運勢別コメント =====
const luckMessages = {
  "大吉": ["最高の一日です。自信を持って行動してください。"],
  "吉": ["順調な一日です。"],
  "中吉": ["安定した運勢です。"],
  "小吉": ["穏やかな一日です。"],
  "末吉": ["午後から運気が上がります。"],
  "凶": ["慎重に行動しましょう。"],
  "大凶": ["今日は静かに過ごしましょう。"]
};

const wishes = ["焦らず進めば願いに近づきます。"];
const people = ["良い出会いがあります。"];
const losts = ["落ち着いて探すと見つかります。"];
const travels = ["東が吉です。"];

// ===== ランダム =====
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function weightedPick(items, offset, seed) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  const r = seededRandom(seed + offset) * total;

  let acc = 0;
  for (const i of items) {
    acc += i.weight;
    if (r < acc) return i.name;
  }
}

function pick(arr, offset, seed) {
  return arr[Math.floor(seededRandom(seed + offset) * arr.length)];
}

function pickLuckMessage(luck, seed) {
  const arr = luckMessages[luck];
  return arr[Math.floor(seededRandom(seed + 999) * arr.length)];
}

// ===== 本体 =====
function getDailyFortune(userId, redraw = false) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = Number(userId.slice(-6)) + Number(today);
  const seed = redraw ? base + 9999 : base;

  const luck = weightedPick(luckLevels, 0, seed);

  return {
    luck,
    luckMessage: pickLuckMessage(luck, seed),
    wish: pick(wishes, 1, seed),
    person: pick(people, 2, seed),
    lost: pick(losts, 3, seed),
    travel: pick(travels, 4, seed)
  };
}

module.exports = { getDailyFortune };
