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

// ===== BOT判定 =====
const BOT_ROLE_ID = "YOUR_BOT_ROLE_ID";

function isBotMember(member) {
  if (!member) return true;
  return member.user.bot || member.roles.cache.has(BOT_ROLE_ID);
}

// ===== 保存 =====
function saveRooms() {
  const data = [...rooms.entries()].map(([id, room]) => [
    id,
    {
      ...room,
      watchers: [...room.watchers],
      waitingUsers: [...room.waitingUsers.entries()]
    }
  ]);
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

function loadRooms() {
  const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  for (const [id, room] of raw) {
    rooms.set(id, {
      ...room,
      watchers: new Set(room.watchers || []),
      waitingUsers: new Map(room.waitingUsers || [])
    });
  }
}

// ===== VCイベント =====
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;

    // 🔥 BOT完全無視
    if (isBotMember(member)) return;

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
      if (vc.parent?.name === "他ゲーム") {
        max = await askOtherGameMax(vc, member);
      }

      const channel = getRecruitChannel(vc.guild, vc);
      if (!channel) return;

      const msg = await channel.send({ content: `@everyone ${vc.name} @${max}` });

      rooms.set(vc.id, {
        max,
        count: max,
        messageId: msg.id,
        watchers: new Set(),
        waitingUsers: new Map(),
        ownerId: member.id,
        waiting: null
      });
      saveRooms();
      return;
    } finally {
      creatingRooms.delete(vc.id);
    }
  }

  const room = rooms.get(vc.id);
  if (!room || member.id === room.ownerId || room.waiting) return;

  room.waiting = member.id;
  saveRooms();
  await showSelection(vc, member, room);
}

// ===== LEAVE =====
async function handleLeave(state) {
  const vc = state.channel;
  const member = state.member;
  const room = rooms.get(vc.id);
  if (!room) return;

  // 観戦退出
  if (room.watchers.delete(member.id)) {
    await normalizeNickname(member, room);
    saveRooms();
    return;
  }

  // 待機退出
  if (room.waitingUsers.has(member.id)) {
    room.waitingUsers.delete(member.id);
    await reorderWaiting(vc, room);
    await normalizeNickname(member, room);
    saveRooms();
    return;
  }

  // owner移譲（BOT除外）
  if (member.id === room.ownerId) {
    const nextOwner = vc.members
      .filter(m => m.id !== member.id && !room.watchers.has(m.id) && !isBotMember(m))
      .first();
    if (nextOwner) room.ownerId = nextOwner.id;
  }

  room.count = Math.min(room.count + 1, room.max);

  // 待機昇格
  if (room.count > 0 && room.waitingUsers.size > 0) {
    const promotedId = [...room.waitingUsers.keys()][0];
    room.waitingUsers.delete(promotedId);

    const promoted = await vc.guild.members.fetch(promotedId).catch(() => null);
    if (promoted && !isBotMember(promoted)) {
      await normalizeNickname(promoted, room);
    }

    room.count--;
    await reorderWaiting(vc, room);
  }

  // 残人数（BOT除外）
  const remain = vc.members.filter(
    m => !room.watchers.has(m.id) && !isBotMember(m)
  ).size;

  if (remain === 0) {
    await updateMessage(vc, room, true);
    rooms.delete(vc.id);
    saveRooms();
    return;
  }

  await updateMessage(vc, room);
  saveRooms();
}

// ===== UI =====
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
    if (i.customId === "join") {
      if (room.count <= 0) {
        const next = room.waitingUsers.size + 1;
        room.waitingUsers.set(member.id, next);
        await normalizeNickname(member, room);
        await i.update({ content: `待機${next}`, components: [] });
      } else {
        room.count--;
        await updateMessage(vc, room);
        await i.update({ content: "参加しました", components: [] });
      }
    } else {
      room.watchers.add(member.id);
      await normalizeNickname(member, room);
      await i.update({ content: "観戦", components: [] });
    }

    room.waiting = null;
    saveRooms();
  });

  collector.on("end", async c => {
    if (c.size === 0 && member.voice.channelId === vc.id) {
      if (room.count <= 0) {
        const next = room.waitingUsers.size + 1;
        room.waitingUsers.set(member.id, next);
        await normalizeNickname(member, room);
      } else {
        room.count--;
        await updateMessage(vc, room);
      }
    }
    room.waiting = null;
    saveRooms();
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
  } else if (room.waitingUsers.has(member.id)) {
    name += ` 待機${room.waitingUsers.get(member.id)}`;
  }

  await member.setNickname(name).catch(() => {});
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

// ===== 募集チャンネル（元仕様復元） =====
function getRecruitChannel(guild, vc) {
  const recruit = guild.channels.cache.find(
    c => c.name === "募集" && c.type === ChannelType.GuildCategory
  );
  if (!recruit) return null;

  if (vc.parent?.name === "PHASMOPHOBIA") {
    return guild.channels.cache.find(
      c => c.parentId === recruit.id && c.name === "調査員募集"
    );
  }
  if (vc.parent?.name === "他ゲーム") {
    return guild.channels.cache.find(
      c => c.parentId === recruit.id && c.name === "他ゲーム募集"
    );
  }
  return null;
}

// ===== 起動 =====
client.once("clientReady", async () => {
  loadRooms();
  console.log(`ログイン成功: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
