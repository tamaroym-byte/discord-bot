require("dotenv").config();
const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");

// =====================
// CONFIG
// =====================
const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const SAVE_FILE = "/data/rooms.json";
if (!fs.existsSync(SAVE_FILE)) fs.writeFileSync(SAVE_FILE, "[]");

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// =====================
// STATE
// =====================
const rooms = new Map();
const locks = new Map();

const BOT_ROLE_ID = process.env.BOT_ROLE_ID;

// =====================
// LOCK
// =====================
async function withLock(key, fn) {
  if (locks.has(key)) await locks.get(key);

  let resolve;
  const p = new Promise(r => (resolve = r));
  locks.set(key, p);

  try {
    return await fn();
  } finally {
    resolve();
    locks.delete(key);
  }
}

// =====================
// BOT判定
// =====================
function isBot(member) {
  if (!member) return true;
  return member.user.bot || member.roles.cache.has(BOT_ROLE_ID);
}

// =====================
// SAVE / LOAD
// =====================
function saveRooms() {
  const data = [...rooms.entries()].map(([id, r]) => [
    id,
    {
      ...r,
      players: [...r.players],
      watchers: [...r.watchers],
      queue: [...r.queue],
    },
  ]);

  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

function loadRooms() {
  const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));

  for (const [id, r] of raw) {
    rooms.set(id, {
      ...r,
      players: new Set(r.players || []),
      watchers: new Set(r.watchers || []),
      queue: r.queue || [],
      full: false,
    });
  }
}

// =====================
// UI
// =====================
function buttons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("join").setLabel("参加").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("watch").setLabel("観戦").setStyle(ButtonStyle.Secondary)
  );
}

// =====================
// 募集テキスト
// =====================
function getText(vc, room) {
  const tag = room.full ? "＠〆" : "@1";

  return `${tag}
🎮 ${vc.name}
参加: ${room.players.size}/${room.max}
待機: ${room.queue.length}`;
}

// =====================
// 募集チャンネル取得（完全設定化）
// =====================
function getRecruitChannel(guild, vc) {
  const category = guild.channels.cache.find(
    c =>
      c.name === config.recruitCategoryName &&
      c.type === ChannelType.GuildCategory
  );
  if (!category) return null;

  const vcCategory = vc.parent?.name;

  const target =
    config.recruitChannels[vcCategory] ??
    config.defaultRecruitChannel;

  return guild.channels.cache.find(
    c => c.parentId === category.id && c.name === target
  );
}

// =====================
// 最大人数（完全設定化）
// =====================
function getMax(vc) {
  const cat = vc.parent?.name;

  return (
    config.vcRules.categories?.[cat]?.max ??
    config.vcRules.defaultMax
  );
}

// =====================
// メッセージ同期
// =====================
async function sync(vc, room) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  let msg;

  try {
    msg = await channel.messages.fetch(room.messageId);
  } catch {
    msg = null;
  }

  const content = getText(vc, room);

  if (!msg || msg.author.id !== client.user.id) {
    const m = await channel.send(content);
    room.messageId = m.id;
    return;
  }

  if (msg.content !== content) {
    await msg.edit(content);
  }
}

// =====================
// 昇格
// =====================
function promote(room) {
  if (room.players.size >= room.max) return null;
  if (room.queue.length === 0) return null;

  const next = room.queue.shift();
  room.players.add(next);

  return next;
}

// =====================
// OWNER
// =====================
function transferOwner(vc, room) {
  if (room.players.has(room.ownerId)) return;

  const next = vc.members
    .filter(m => room.players.has(m.id) && !isBot(m))
    .first();

  if (next) room.ownerId = next.id;
}

// =====================
// JOIN
// =====================
async function join(state) {
  const vc = state.channel;
  const member = state.member;

  if (!/^部屋/.test(vc.name)) return;

  await withLock(vc.id, async () => {
    if (!rooms.has(vc.id)) {
      const msg = await getRecruitChannel(vc.guild, vc)?.send("初期化中...");

      rooms.set(vc.id, {
        ownerId: member.id,
        max: getMax(vc),
        players: new Set(),
        watchers: new Set(),
        queue: [],
        messageId: msg?.id,
        full: false,
      });
    }

    const room = rooms.get(vc.id);
    if (!room || room.watchers.has(member.id)) return;

    if (room.players.size < room.max) {
      room.players.add(member.id);
    } else {
      room.queue.push(member.id);
    }

    room.full = room.players.size >= room.max;

    await sync(vc, room);
    saveRooms();
  });
}

// =====================
// LEAVE
// =====================
async function leave(state) {
  const vc = state.channel;
  const member = state.member;

  const room = rooms.get(vc.id);
  if (!room) return;

  await withLock(vc.id, async () => {
    room.players.delete(member.id);
    room.watchers.delete(member.id);
    room.queue = room.queue.filter(id => id !== member.id);

    transferOwner(vc, room);

    const promoted = promote(room);
    if (promoted) {
      const m = await vc.guild.members.fetch(promoted).catch(() => null);
      if (m) {
        await normalizeNickname(m, room);
      }
    }

    room.full = room.players.size >= room.max;

    if (room.players.size === 0) {
      await sync(vc, room);
      rooms.delete(vc.id);
      saveRooms();
      return;
    }

    await sync(vc, room);
    saveRooms();
  });
}

// =====================
// VCイベント
// =====================
client.on("voiceStateUpdate", async (oldS, newS) => {
  const m = newS.member || oldS.member;
  if (isBot(m)) return;

  if (!oldS.channel && newS.channel) return join(newS);
  if (oldS.channel && !newS.channel) return leave(oldS);
});

// =====================
// ニックネーム
// =====================
async function normalizeNickname(member, room) {
  if (isBot(member)) return;
  if (!member.manageable) return;

  let name = member.displayName
    .replace(/（観戦）/g, "")
    .replace(/ 待機\d+/g, "");

  if (room.watchers.has(member.id)) {
    name += "（観戦）";
  } else {
    const i = room.queue.indexOf(member.id);
    if (i !== -1) name += ` 待機${i + 1}`;
  }

  await member.setNickname(name).catch(() => {});
}

// =====================
// 起動復元
// =====================
client.once("ready", async () => {
  loadRooms();

  for (const [id, room] of rooms) {
    const vc = await client.channels.fetch(id).catch(() => null);
    if (!vc) continue;

    room.players.clear();

    const members = vc.members.filter(m => !isBot(m));

    for (const m of members.values()) {
      if (room.players.size < room.max) {
        room.players.add(m.id);
      } else {
        room.queue.push(m.id);
      }
    }

    room.full = room.players.size >= room.max;

    await sync(vc, room);
  }

  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
