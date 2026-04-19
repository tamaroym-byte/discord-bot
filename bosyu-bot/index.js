require("dotenv").config();
const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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
function isBot(m) {
  if (!m) return true;
  return m.user.bot || m.roles.cache.has(BOT_ROLE_ID);
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
    new ButtonBuilder()
      .setCustomId("join")
      .setLabel("参加")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("watch")
      .setLabel("観戦")
      .setStyle(ButtonStyle.Secondary)
  );
}

// =====================
// 募集チャンネル
// =====================
function getRecruitChannel(guild, vc) {
  const category = guild.channels.cache.find(
    c =>
      c.name === config.recruitCategoryName &&
      c.type === ChannelType.GuildCategory
  );
  if (!category) return null;

  const vcCat = vc.parent?.name;

  const target =
    config.recruitChannels[vcCat] ??
    config.defaultRecruitChannel;

  return guild.channels.cache.find(
    c => c.parentId === category.id && c.name === target
  );
}

// =====================
// 最大人数（固定 or 選択）
// =====================
function getFixedMax(vc) {
  return config.vcRules.categories?.[vc.parent?.name]?.fixedMax ?? null;
}

function getSelectableMax(vc) {
  return config.vcRules.categories?.[vc.parent?.name]?.selectableMax ?? null;
}

// =====================
// メッセージ
// =====================
function text(vc, room) {
  const tag = room.full ? "＠〆" : "@1";

  return `${tag}
🎮 ${vc.name}
参加: ${room.players.size}/${room.max}
待機: ${room.queue.length}`;
}

// =====================
// sync
// =====================
async function sync(vc, room) {
  const ch = getRecruitChannel(vc.guild, vc);
  if (!ch) return;

  let msg;

  try {
    msg = await ch.messages.fetch(room.messageId);
  } catch {
    msg = null;
  }

  const content = text(vc, room);

  if (!msg || msg.author.id !== client.user.id) {
    const m = await ch.send(content);
    room.messageId = m.id;
    return;
  }

  if (msg.content !== content) {
    await msg.edit(content);
  }
}

// =====================
// 3/7/11 UI
// =====================
async function showMaxSelect(vc, member, options) {
  const ch = getRecruitChannel(vc.guild, vc);
  if (!ch) return;

  const msg = await ch.send({
    content: `${member} 募集人数を選択してください`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`max_${vc.id}`)
          .addOptions(
            options.map(v => ({
              label: `${v}人`,
              value: String(v),
            }))
          )
      ),
    ],
  });

  const collector = msg.createMessageComponentCollector({
    max: 1,
    time: 30000,
    filter: i => i.user.id === member.id,
  });

  collector.on("collect", async i => {
    const room = createRoom(vc, member);

    room.max = parseInt(i.values[0]);
    room.players.add(member.id);

    await i.update({ content: "参加しました", components: [] });

    saveRooms();
    await sync(vc, room);
  });
}

// =====================
// room作成
// =====================
function createRoom(vc, member) {
  const room = {
    ownerId: member.id,
    max: 4,
    players: new Set(),
    watchers: new Set(),
    queue: [],
    full: false,
    messageId: null,
  };

  rooms.set(vc.id, room);
  return room;
}

// =====================
// JOIN
// =====================
async function join(state) {
  const vc = state.channel;
  const member = state.member;

  if (!/^部屋/.test(vc.name)) return;

  await withLock(vc.id, async () => {
    let room = rooms.get(vc.id);

    if (!room) {
      const fixed = getFixedMax(vc);
      const selectable = getSelectableMax(vc);

      room = createRoom(vc, member);

      if (fixed) {
        room.max = fixed;
        room.players.add(member.id);
      } else if (selectable) {
        await showMaxSelect(vc, member, selectable);
        return;
      }
    }

    if (room.watchers.has(member.id)) return;

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

    if (room.players.size < room.max && room.queue.length > 0) {
      const next = room.queue.shift();
      room.players.add(next);
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
