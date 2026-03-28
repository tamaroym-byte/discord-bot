require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

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
// VCイベント
// ==========================
client.on("voiceStateUpdate", async (oldState, newState) => {

  // ======================
  // VC移動
  // ======================
  if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    await handleLeave(oldState);
    await handleJoin(newState);
    return;
  }

  // 入室
  if (!oldState.channel && newState.channel) {
    await handleJoin(newState);
  }

  // 退出
  if (oldState.channel && !newState.channel) {
    await handleLeave(oldState);
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

  // 他ゲームは入力
  if (vc.parent?.name === "他ゲーム") {
    max = await askMaxMembers(vc, member);
    if (!max) return;
  }

  // 初回（募集作成）
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

    return;
  }

  // 2人目以降
  const room = rooms.get(vc.id);

  if (member.id === room.ownerId) return;
  if (vc.members.size <= 1) return;
  if (room.waiting) return;

  room.waiting = member.id;

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
    return;
  }

  room.count++;
  if (room.count > room.max) room.count = room.max;

  const remain = vc.members.filter(
    m => !room.watchers.has(m.id)
  ).size;

  if (remain === 0) {
    await updateMessage(vc, room, true);
    rooms.delete(vc.id);
    return;
  }

  await updateMessage(vc, room);
}

// ==========================
// 人数入力
// ==========================
async function askMaxMembers(vc, member) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return null;

  const ask = await channel.send(`${member} 募集人数を入力してください`);

  try {
    const collected = await channel.awaitMessages({
      filter: m => m.author.id === member.id,
      max: 1,
      time: 30000
    });

    const num = parseInt(collected.first().content);
    if (isNaN(num)) return null;

    return num;

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
  });

  collector.on("end", async collected => {
    if (collected.size === 0) {
      if (member.voice.channelId === vc.id) {
        await member.voice.disconnect();
      }
    }

    room.waiting = null;
    msg.delete().catch(() => {});
  });
}

// ==========================
// メッセージ更新
// ==========================
async function updateMessage(vc, room, close = false) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const msg = await channel.messages.fetch(room.messageId);

  const text = close || room.count <= 0
    ? `${vc.name} 募集〆`
    : `${vc.name} @${room.count}`;

  await msg.edit({
    content: text
  });
}

// ==========================
function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("join").setLabel("参加").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("watch").setLabel("観戦").setStyle(ButtonStyle.Secondary)
  );
}

// ==========================
function getMaxMembers(vc) {
  if (vc.parent?.name === "PHASMOPHOBIA") return 3;
  return null;
}

// ==========================
function getRecruitChannel(guild, vc) {
  const recruit = guild.channels.cache.find(
    c => c.name === "募集" && c.type === 4
  );
  if (!recruit) return null;

  if (vc.parent.name === "PHASMOPHOBIA") {
    return guild.channels.cache.find(
      c => c.parentId === recruit.id && c.name === "調査員募集"
    );
  }

  if (vc.parent.name === "他ゲーム") {
    return guild.channels.cache.find(
      c => c.parentId === recruit.id && c.name === "他ゲーム募集"
    );
  }

  return null;
}

// ==========================
async function addWatchName(member) {
  if (!member.manageable) return;
  if (!member.displayName.includes("観戦")) {
    await member.setNickname(member.displayName + "（観戦）");
  }
}

async function removeWatchName(member) {
  if (!member.manageable) return;
  await member.setNickname(member.displayName.replace("（観戦）", ""));
}

// ==========================
client.once("clientReady", () => {
  console.log(`ログイン成功: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);