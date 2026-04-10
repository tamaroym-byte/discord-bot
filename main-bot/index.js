require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { saveRooms, loadRooms } = require("../shared/roomStore");

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType
} = require("discord.js");

const { createClient } = require("../shared/client");

const client = createClient();

const rooms = loadRooms();
const creatingRooms = new Set();

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
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
      function saveRooms(rooms)
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

async function handleLeave(state) {
  const vc = state.channel;
  const member = state.member;
  const room = rooms.get(vc.id);
  if (!room) return;

  // 観戦者退出
  if (room.watchers.delete(member.id)) {
    await normalizeNickname(member, room);
    function saveRooms(rooms);
    return;
  }

  // 待機者退出
  if (room.waitingUsers.has(member.id)) {
    room.waitingUsers.delete(member.id);
    await reorderWaiting(vc, room);
    await normalizeNickname(member, room);
    function saveRooms(rooms);
    return;
  }

  // owner移譲
  if (member.id === room.ownerId) {
    const nextOwner = vc.members
      .filter(m => m.id !== member.id && !room.watchers.has(m.id))
      .first();
    if (nextOwner) room.ownerId = nextOwner.id;
  }

  room.count = Math.min(room.count + 1, room.max);

  // 待機者昇格
  if (room.count > 0 && room.waitingUsers.size > 0) {
    const promotedId = [...room.waitingUsers.keys()][0];
    room.waitingUsers.delete(promotedId);
    const promoted = await vc.guild.members.fetch(promotedId).catch(() => null);
    if (promoted) await normalizeNickname(promoted, room);
    room.count--;
    await reorderWaiting(vc, room);
  }

  const remain = vc.members.filter(m => !room.watchers.has(m.id)).size;
  if (remain === 0) {
    await updateMessage(vc, room, true);
    rooms.delete(vc.id);
    function saveRooms(rooms);
    return;
  }

  await updateMessage(vc, room);
  function saveRooms(rooms);
}

async function askOtherGameMax(vc, member) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return 7;

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`max_${member.id}`)
      .setPlaceholder("募集人数を選択")
      .addOptions([
        { label: "3人", value: "3" },
        { label: "7人", value: "7" },
        { label: "11人", value: "11" }
      ])
  );

  const msg = await channel.send({
    content: `${member} 募集人数を選択してください`,
    components: [row]
  });

  return new Promise(resolve => {
    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === member.id,
      time: 30000,
      max: 1
    });

    collector.on("collect", async i => {
      const value = Number(i.values[0]);
      await i.update({ content: `募集人数 ${value}人`, components: [] });
      resolve(value);
    });

    collector.on("end", c => {
      if (c.size === 0) resolve(7);
    });
  });
}

async function showSelection(vc, member, room) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const msg = await channel.send({
    content: `${member} 参加 or 観戦？（30秒）`,
    components: [buildButtons()]
  });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === member.id,
    time: 30000,
    max: 1
  });

  collector.on("collect", async interaction => {
    if (interaction.customId === "join") {
      if (room.count <= 0) {
        const next = room.waitingUsers.size + 1;
        room.waitingUsers.set(member.id, next);
        await normalizeNickname(member, room);

        await interaction.update({
          content: `待機${next}`,
          components: []
        });
      } else {
        room.count--;
        await updateMessage(vc, room);

        await interaction.update({
          content: "参加しました",
          components: []
        });
      }
    } else {
      room.watchers.add(member.id);
      await normalizeNickname(member, room);

      await interaction.update({
        content: "観戦に設定しました",
        components: []
      });
    }

    room.waiting = null;
    function saveRooms(rooms);
  });

  collector.on("end", async c => {
    if (c.size === 0 && member.voice.channelId === vc.id) {

      if (room.count <= 0) {
        // 満員 → 待機
        const next = room.waitingUsers.size + 1;
        room.waitingUsers.set(member.id, next);
        await normalizeNickname(member, room);

        //　簡略メッセージ + メンション抑制
        if (channel) {
          await channel.send({
            content: `${member} → 待機${next}`,
            allowedMentions: { parse: [] }
          });
        }

      } else {
        // 空きあり → 自動参加
        room.count--;
        await updateMessage(vc, room);

        // 簡略メッセージ + メンション抑制
        if (channel) {
          await channel.send({
            content: `${member} → 自動参加`,
            allowedMentions: { parse: [] }
          });
        }
      }
    }

    room.waiting = null;
    saveRooms(rooms);
    await msg.delete().catch(() => {});
  });
}

async function reorderWaiting(vc, room) {
  let index = 1;
  const newMap = new Map();

  for (const id of room.waitingUsers.keys()) {
    newMap.set(id, index);
    const member = await vc.guild.members.fetch(id).catch(() => null);
    if (member) await normalizeNickname(member, { ...room, waitingUsers: newMap });
    index++;
  }

  room.waitingUsers = newMap;
}

async function normalizeNickname(member, room) {
  if (!member.manageable) return;

  let name = member.displayName
    .replace(/（観戦）/g, "")
    .replace(/ 待機\d+/g, "")
    .trim();

  if (room.watchers?.has(member.id)) {
    name += "（観戦）";
  } else if (room.waitingUsers?.has(member.id)) {
    name += ` 待機${room.waitingUsers.get(member.id)}`;
  }

  await member.setNickname(name).catch(() => {});
}

async function updateMessage(vc, room, close = false) {
  const channel = getRecruitChannel(vc.guild, vc);
  if (!channel) return;

  const text = close || room.count <= 0 ? `@everyone ${vc.name} 募集〆` : `@everyone ${vc.name} @${room.count}`;

  try {
    const msg = await channel.messages.fetch(room.messageId);
    await msg.edit({ content: text });
  } catch {
    const msg = await channel.send({ content: text });
    room.messageId = msg.id;
  }
}

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

  if (vc.parent?.name === "PHASMOPHOBIA") {
    return guild.channels.cache.find(c => c.parentId === recruit.id && c.name === "調査員募集");
  }
  if (vc.parent?.name === "他ゲーム") {
    return guild.channels.cache.find(c => c.parentId === recruit.id && c.name === "他ゲーム募集");
  }
  return null;
}

async function selfHealRooms() {
  for (const [vcId, room] of rooms.entries()) {
    let foundVc = null;
    let foundGuild = null;

    for (const guild of client.guilds.cache.values()) {
      const vc = guild.channels.cache.get(vcId);
      if (vc) {
        foundVc = vc;
        foundGuild = guild;
        break;
      }
    }

    if (!foundVc || !foundGuild) {
      rooms.delete(vcId);
      continue;
    }

    // 実際にVC内にいない観戦者を掃除
    for (const userId of [...room.watchers]) {
      if (!foundVc.members.has(userId)) {
        room.watchers.delete(userId);
      }
    }

    // 実際にVC内にいない待機者を掃除
    for (const userId of [...room.waitingUsers.keys()]) {
      if (!foundVc.members.has(userId)) {
        room.waitingUsers.delete(userId);
      }
    }

    // 待機番号を詰め直す
    let index = 1;
    const repaired = new Map();
    for (const userId of room.waitingUsers.keys()) {
      repaired.set(userId, index++);
    }
    room.waitingUsers = repaired;

    // owner不在なら通常参加者へ移譲
    if (!foundVc.members.has(room.ownerId)) {
      const nextOwner = foundVc.members
        .filter(m => !room.watchers.has(m.id) && !room.waitingUsers.has(m.id))
        .first();

      if (nextOwner) {
        room.ownerId = nextOwner.id;
      }
    }
  }

  saveRooms(rooms);
}

async function restoreNicknames() {
  for (const [vcId, room] of rooms.entries()) {
    for (const guild of client.guilds.cache.values()) {
      const vc = guild.channels.cache.get(vcId);
      if (!vc) continue;

      for (const userId of room.watchers || []) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await normalizeNickname(member, room);
      }

      for (const userId of room.waitingUsers?.keys?.() || []) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await normalizeNickname(member, room);
      }
    }
  }
}

client.once("clientReady", async () => {
  await selfHealRooms();
  await restoreNicknames();
  console.log(`ログイン成功: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
