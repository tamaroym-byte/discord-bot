require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require("discord.js");

const SAVE_FILE = path.join(__dirname, "rooms.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const rooms = new Map();

// ==========================
// 永続化
// ==========================
function saveRooms() {
  const data = [...rooms.entries()].map(([id, room]) => [id, {
    ...room,
    watchers: [...room.watchers]
  }]);

  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

function loadRooms() {
  if (!fs.existsSync(SAVE_FILE)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    for (const [id, room] of raw) {
      rooms.set(id, {
        ...room,
        watchers: new Set(room.watchers || [])
      });
    }
    console.log(`復元済みルーム数: ${rooms.size}`);
  } catch (e) {
    console.error("rooms.json復元失敗", e);
  }
}

// ==========================
// VCイベント
// ==========================
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (
      oldState.channel &&
      newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {
      await handleLeave(oldState);
      await handleJoin(newState);
      return;
    }

    if (!oldState.channel && newState.channel) {
      await handleJoin(newState);
    }

    if (oldState.channel && !newState.channel) {
      await handleLeave(oldState);
    }
  } catch (e) {
    console.error("voiceStateUpdate error", e);
  }
});

// ==========================
// 入室処理
// ==========================
async function handleJoin(state) {
  const vc = state.channel;
  const member = state.member;

  if (!/^部屋[1-4]$/.test(vc.name)) return;

  let max = getMaxMembers(vc);

  if (vc.parent?.name === "他ゲーム") {
    max = await askMaxMembers(vc, member);
    if (!max) return;
  }

  if (!rooms.has(vc.id)) {
    const channel = getRecruitChannel(vc.guild, vc);
    if (!channel) return;

    const msg = await channel.send({
      content: `@everyone ${vc.name} @${max}`
    });

    rooms.set(vc.id, {
      max,
      count: max,
      messageId: msg.id,
      watchers: new Set(),
      ownerId: member.id,
      waiting: null
    });

    saveRooms();
    return;
  }

  const room = rooms.get(vc.id);

  if (member.id === room.ownerId) return;
  if (vc.members.size <= 1) return;
  if (room.waiting) return;

  room.waiting = member.id;
  saveRooms();

  await showSelection(vc, member, room);
}

// ==========================
// 退出処理
// ==========================
async function handleLeave(state) {
  const vc = state.channel;
  const member = state.member;

  const room = rooms.get(vc.id);
  if (!room) return;

  if (room.watchers.has(member.id)) {
    room.watchers.delete(member.id);
    await removeWatchName(member);
    saveRooms();
    return;
  }

  room.count++;
  if (room.count > room.max) room.count = room.max;

  const remain = vc.members.filter(m => !room.watchers.has(m.id)).size;

  if (remain === 0) {
    await updateMessage(vc, room, true);
    rooms.delete(vc.id);
    saveRooms();
    return;
  }

  await updateMessage(vc, room);
  saveRooms();
}

// ==========================
// 人数入力
// ==========================
async function askMaxMembers(vc, member) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return null;

  await channel.send(`${member} 募集人数を入力してください`);

  try {
    const collected = await channel.awaitMessages({
      filter: m => m.author.id === member.id,
      max: 1,
      time: 30000
    });

    const num = parseInt(collected.first()?.content, 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

// ==========================
// ボタンUI
// ==========================
async function showSelection(vc, member, room) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const msg = await channel.send({
    content: `${member} 参加 or 観戦？（60秒）`,
    components: [buildButtons()]
  });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === member.id,
    time: 60000,
    max: 1
  });

  collector.on("collect", async interaction => {
    try {
      if (interaction.customId === "join") {
        room.count--;
        if (room.count < 0) room.count = 0;
        await updateMessage(vc, room);
        await interaction.update({
          content: "参加しました",
          components: []
        });
      } else {
        room.watchers.add(member.id);
        await addWatchName(member);
        await interaction.update({
          content: "観戦に設定しました",
          components: []
        });
      }

      room.waiting = null;
      saveRooms();
    } catch (e) {
      console.error("button collect error", e);
    }
  });

  collector.on("end", async collected => {
    try {
      if (collected.size === 0 && member.voice.channelId === vc.id) {
        await member.voice.setChannel(null);
      }

      room.waiting = null;
      saveRooms();
      await msg.delete().catch(() => {});
    } catch (e) {
      console.error("collector end error", e);
    }
  });
}

// ==========================
// メッセージ更新
// ==========================
async function updateMessage(vc, room, close = false) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  try {
    const msg = await channel.messages.fetch(room.messageId);
    const text = close || room.count <= 0
      ? `${vc.name} 募集〆`
      : `${vc.name} @${room.count}`;

    await msg.edit({ content: text });
  } catch (e) {
    console.error("message update error", e);
  }
}

function buildButtons() {
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

function getMaxMembers(vc) {
  if (vc.parent?.name === "PHASMOPHOBIA") return 3;
  return 4;
}

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

async function addWatchName(member) {
  if (!member.manageable) return;
  if (!member.displayName.includes("（観戦）")) {
    await member.setNickname(member.displayName + "（観戦）");
  }
}

async function removeWatchName(member) {
  if (!member.manageable) return;
  await member.setNickname(member.displayName.replace("（観戦）", ""));
}

// ==========================
// 起動
// ==========================
client.once("clientReady", () => {
  console.log(`ログイン成功: ${client.user.tag}`);
  loadRooms();
});

process.on("unhandledRejection", err => {
  console.error("unhandledRejection", err);
});

process.on("uncaughtException", err => {
  console.error("uncaughtException", err);
});

client.login(process.env.DISCORD_TOKEN);
