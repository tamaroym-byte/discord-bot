require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType
} = require("discord.js");

const SAVE_FILE = "/data/rooms.json";
if (!fs.existsSync(SAVE_FILE)) fs.writeFileSync(SAVE_FILE, "[]");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const rooms = new Map();
const creatingRooms = new Set();
const roomLocks = new Map();

// ===== BOT判定 =====
const BOT_ROLE_ID = "YOUR_BOT_ROLE_ID";

function isBotMember(member) {
  return member.user.bot || member.roles.cache.has(BOT_ROLE_ID);
}

// ===== ロック =====
async function withRoomLock(id, fn) {
  while (roomLocks.get(id)) {
    await new Promise(r => setTimeout(r, 30));
  }
  roomLocks.set(id, true);
  try {
    return await fn();
  } finally {
    roomLocks.delete(id);
  }
}

// ===== 保存 =====
function saveRooms() {
  const data = [...rooms.entries()].map(([id, r]) => [
    id,
    {
      ...r,
      watchers: [...r.watchers],
      waitingQueue: r.waitingQueue
    }
  ]);
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

function loadRooms() {
  const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  for (const [id, r] of raw) {
    rooms.set(id, {
      ...r,
      watchers: new Set(r.watchers || []),
      waitingQueue: r.waitingQueue || []
    });
  }
}

// ===== 人数計算（最重要） =====
function getActiveCount(vc, room) {
  return vc.members.filter(
    m =>
      !room.watchers.has(m.id) &&
      !room.waitingQueue.includes(m.id) &&
      !isBotMember(m)
  ).size;
}

function getFreeSlots(vc, room) {
  return room.max - getActiveCount(vc, room);
}

// ===== VCイベント =====
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (isBotMember(newState.member || oldState.member)) return;

    if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      await handleLeave(oldState);
      await handleJoin(newState);
      return;
    }
    if (!oldState.channel && newState.channel) await handleJoin(newState);
    if (oldState.channel && !newState.channel) await handleLeave(oldState);
  } catch (e) {
    console.error(e);
  }
});

// ===== JOIN =====
async function handleJoin(state) {
  const vc = state.channel;
  const member = state.member;

  if (!/^部屋[1-4]$/.test(vc.name)) return;
  if (creatingRooms.has(vc.id)) return;

  let max = getDefaultMax(vc);

  if (!rooms.has(vc.id)) {
    creatingRooms.add(vc.id);
    try {
      const channel = getRecruitChannel(vc.guild, vc);
      if (!channel) return;

      const msg = await channel.send({ content: `@everyone ${vc.name} @${max}` });

      rooms.set(vc.id, {
        max,
        messageId: msg.id,
        watchers: new Set(),
        waitingQueue: [],
        ownerId: member.id
      });

      saveRooms();
      return;
    } finally {
      creatingRooms.delete(vc.id);
    }
  }

  const room = rooms.get(vc.id);
  await showSelection(vc, member, room);
}

// ===== LEAVE =====
async function handleLeave(state) {
  const vc = state.channel;
  const member = state.member;
  const room = rooms.get(vc.id);
  if (!room) return;

  await withRoomLock(vc.id, async () => {
    room.watchers.delete(member.id);

    const index = room.waitingQueue.indexOf(member.id);
    if (index !== -1) {
      room.waitingQueue.splice(index, 1);
    }

    // 昇格処理
    while (getFreeSlots(vc, room) > 0 && room.waitingQueue.length > 0) {
      const nextId = room.waitingQueue.shift();
      const nextMember = await vc.guild.members.fetch(nextId).catch(() => null);
      if (nextMember) await normalizeNickname(nextMember, room);
    }

    await updateMessage(vc, room);
    saveRooms();
  });
}

// ===== 選択UI =====
async function showSelection(vc, member, room) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const msg = await channel.send({
    content: `${member} 参加 or 観戦？`,
    components: [buildButtons()]
  });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === member.id,
    time: 30000,
    max: 1
  });

  collector.on("collect", async i => {
    await withRoomLock(vc.id, async () => {
      if (i.customId === "join") {
        const free = getFreeSlots(vc, room);

        if (free <= 0) {
          room.waitingQueue.push(member.id);
          await normalizeNickname(member, room);

          await i.update({ content: `待機${room.waitingQueue.length}`, components: [] });
        } else {
          await i.update({ content: "参加しました", components: [] });
        }
      } else {
        room.watchers.add(member.id);
        await normalizeNickname(member, room);

        await i.update({ content: "観戦", components: [] });
      }

      await updateMessage(vc, room);
      saveRooms();
    });
  });

  collector.on("end", async c => {
    if (c.size === 0 && member.voice.channelId === vc.id) {
      await withRoomLock(vc.id, async () => {
        const free = getFreeSlots(vc, room);

        if (free <= 0) {
          room.waitingQueue.push(member.id);
          await normalizeNickname(member, room);
        }

        await updateMessage(vc, room);
        saveRooms();
      });
    }
    await msg.delete().catch(() => {});
  });
}

// ===== ニックネーム =====
async function normalizeNickname(member, room) {
  if (isBotMember(member)) return;
  if (!member.manageable) return;

  let name = member.displayName
    .replace(/（観戦）/g, "")
    .replace(/ 待機\d+/g, "");

  if (room.watchers.has(member.id)) {
    name += "（観戦）";
  } else {
    const idx = room.waitingQueue.indexOf(member.id);
    if (idx !== -1) name += ` 待機${idx + 1}`;
  }

  await member.setNickname(name).catch(() => {});
}

// ===== メッセージ更新 =====
async function updateMessage(vc, room) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const free = getFreeSlots(vc, room);
  const text =
    free <= 0
      ? `@everyone ${vc.name} 募集〆`
      : `@everyone ${vc.name} @${free}`;

  try {
    const msg = await channel.messages.fetch(room.messageId);
    await msg.edit({ content: text });
  } catch {
    const msg = await channel.send({ content: text });
    room.messageId = msg.id;
  }
}

// ===== その他 =====
function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("join").setLabel("参加").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("watch").setLabel("観戦").setStyle(ButtonStyle.Secondary)
  );
}

function getDefaultMax(vc) {
  if (vc.parent?.name === "PHASMOPHOBIA") return 3;
  if (vc.parent?.name === "他ゲーム") return 7;
  return 4;
}

function getRecruitChannel(guild, vc) {
  const recruit = guild.channels.cache.find(
    c => c.name === "募集" && c.type === ChannelType.GuildCategory
  );
  if (!recruit) return null;

  return guild.channels.cache.find(c => c.parentId === recruit.id);
}

// ===== 起動 =====
client.once("clientReady", async () => {
  loadRooms();
  console.log(`ログイン成功: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
