require("dotenv").config();
const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// =====================
// STATE
// =====================
const rooms = new Map();

// =====================
// BOT判定
// =====================
const BOT_ROLE_ID = process.env.BOT_ROLE_ID;

function isBot(m) {
  return !m || m.user.bot || m.roles?.cache?.has(BOT_ROLE_ID);
}

// =====================
// 募集チャンネル
// =====================
function getRecruitChannel(guild, vc) {
  const category = guild.channels.cache.find(
    c => c.name === "募集" && c.type === ChannelType.GuildCategory
  );
  if (!category) return null;

  if (vc.parent?.name === "PHASMOPHOBIA") {
    return guild.channels.cache.find(
      c => c.parentId === category.id && c.name === "調査員募集"
    );
  }

  if (vc.parent?.name === "他ゲーム") {
    return guild.channels.cache.find(
      c => c.parentId === category.id && c.name === "他ゲーム募集"
    );
  }

  return null;
}

// =====================
// 実参加者（観戦除外）
// =====================
function getActive(vc, room) {
  return [...vc.members.values()].filter(m =>
    !m.user.bot && !room.watchers.has(m.id)
  );
}

// =====================
// ニックネーム更新
// =====================
async function applyNickname(member, room, indexMap) {
  if (!member.manageable) return;

  let name = member.displayName
    .replace(/（観戦）/g, "")
    .replace(/（待機\d+）/g, "")
    .trim();

  if (room.watchers.has(member.id)) {
    name += "（観戦）";
  } else if (indexMap.has(member.id)) {
    name += `（待機${indexMap.get(member.id)}）`;
  }

  await member.setNickname(name).catch(() => {});
}

// =====================
// 表示
// =====================
function buildText(vc, room) {
  const active = getActive(vc, room).length;
  const remaining = room.max - active;

  return remaining <= 0
    ? `@everyone ${vc.name} 〆`
    : `@everyone ${vc.name} 残り${remaining}`;
}

// =====================
// 他ゲーム選択
// =====================
async function askMax(vc, member) {
  const ch = getRecruitChannel(vc.guild, vc);
  if (!ch) return 3;

  const msg = await ch.send({
    content: `${member} 募集人数を選択`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`max_${member.id}`)
          .addOptions([
            { label: "3人", value: "3" },
            { label: "7人", value: "7" },
            { label: "11人", value: "11" }
          ])
      )
    ]
  });

  return new Promise(resolve => {
    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === member.id,
      time: 30000,
      max: 1
    });

    collector.on("collect", async i => {
      const v = Number(i.values[0]);
      await i.update({ content: `募集人数 ${v}人`, components: [] });
      resolve(v);
    });

    collector.on("end", c => {
      if (c.size === 0) resolve(3);
    });
  });
}

// =====================
// JOIN（初期登録のみ）
// =====================
client.on("voiceStateUpdate", async (oldS, newS) => {
  const member = newS.member || oldS.member;
  if (isBot(member)) return;

  const vc = newS.channel || oldS.channel;
  if (!vc) return;

  if (!/^部屋[1-4]$/.test(vc.name)) return;

  if (!rooms.has(vc.id)) {
    let max = 3;

    if (vc.parent?.name === "他ゲーム") {
      max = await askMax(vc, member);
    }

    rooms.set(vc.id, {
      max,
      watchers: new Set(),
      queue: [],
      messageId: null
    });
  }
});

// =====================
// 再構築（核心ロジック）
// =====================
async function reconcile() {
  for (const [vcId, room] of rooms) {
    const vc = client.channels.cache.get(vcId);
    if (!vc) continue;

    const active = getActive(vc, room);
    let free = room.max - active.length;

    // ===== 待機再構築 =====
    const newQueue = [];
    const indexMap = new Map();
    let index = 1;

    for (const id of room.queue) {
      const m = await vc.guild.members.fetch(id).catch(() => null);

      if (!m || m.voice.channelId !== vc.id) continue;

      if (free > 0) {
        free--;
      } else {
        newQueue.push(id);
        indexMap.set(id, index++);
      }
    }

    room.queue = newQueue;

    // ===== ニックネーム同期 =====
    for (const m of vc.members.values()) {
      if (isBot(m)) continue;
      await applyNickname(m, room, indexMap);
    }

    // ===== メッセージ更新 =====
    const ch = getRecruitChannel(vc.guild, vc);
    if (ch) {
      const text = buildText(vc, room);

      try {
        const msg = await ch.messages.fetch(room.messageId);
        await msg.edit({ content: text });
      } catch {
        const msg = await ch.send({ content: text });
        room.messageId = msg.id;
      }
    }
  }
}

// =====================
// 定期実行（イベントレス核）
// =====================
setInterval(reconcile, 5000);

// =====================
// 起動
// =====================
client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
