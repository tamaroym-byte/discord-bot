require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

const { getDailyFortune } = require("./fortunes");

// ===== ログ =====
const log = (...a) => console.log("[LOG]", ...a);
const error = (...a) => console.error("[ERROR]", ...a);

// ===== クライアント =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== コマンド =====
const command = new SlashCommandBuilder()
  .setName("kuji")
  .setDescription("おみくじ（1日1回＋引き直し1回）");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ===== 引き直し管理 =====
const FILE = "./redraws.json";
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function key(userId) {
  const d = new Date().toISOString().slice(0, 10);
  return `${userId}_${d}`;
}

// ===== UI =====
const startBtn = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start")
      .setLabel("🎍 おみくじを引く")
      .setStyle(ButtonStyle.Success)
  );

const redrawBtn = (disabled = false) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("redraw")
      .setLabel("🔁 引き直す")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );

// ===== Embed =====
function color(luck) {
  return {
    "大吉": 0xffd700,
    "吉": 0x00cc66,
    "中吉": 0x3399ff,
    "小吉": 0x66ccff,
    "末吉": 0xaaaaaa,
    "凶": 0xff6600,
    "大凶": 0xff0000
  }[luck] || 0xffffff;
}

function embed(name, r) {
  return new EmbedBuilder()
    .setColor(color(r.luck))
    .setTitle(`🎍 ${r.luck} 🎍`)
    .setDescription(`「${name}」さんの運勢`)
    .addFields(
      { name: "総合", value: r.luckMessage },
      { name: "願望", value: r.wish, inline: true },
      { name: "待ち人", value: r.person, inline: true },
      { name: "失せ物", value: r.lost, inline: true },
      { name: "旅行", value: r.travel, inline: true }
    )
    .setTimestamp();
}

// ===== コマンド登録 =====
async function register() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [command.toJSON()] }
  );
  log("command registered");
}

// ===== 起動 =====
client.once(Events.ClientReady, async () => {
  log("READY", client.user.tag);
  await register();
});

// ===== メイン処理 =====
client.on(Events.InteractionCreate, async i => {
  try {
    // Slash
    if (i.isChatInputCommand() && i.commandName === "kuji") {
      return i.reply({
        content: "🎍 ボタンを押しておみくじを引く",
        components: [startBtn()]
      });
    }

    if (!i.isButton()) return;

    let name;

　　if (i.inGuild()) {
　　  const member = await i.guild.members.fetch(i.user.id);
　　  name = member.displayName;
　　} else {
　　  name = i.user.username;
　　}
    // ===== 初回 =====
    if (i.customId === "start") {
      await i.deferUpdate();

      const r = getDailyFortune(i.user.id);

      await i.editReply({
        content: "🎍 結果",
        embeds: [embed(name, r)],
        components: [redrawBtn(false)]
      });

      log("start OK");
    }

    // ===== 引き直し =====
    if (i.customId === "redraw") {
      await i.deferUpdate();

      const data = load();
      const k = key(i.user.id);

      if (data[k]) {
        return i.followUp({
          content: "⛔ 今日は引き直し済み",
          flags: 64
        });
      }

      const r = getDailyFortune(i.user.id, true);

      data[k] = true;
      save(data);

      await i.editReply({
        content: "🔁 引き直し結果",
        embeds: [embed(name, r)],
        components: [redrawBtn(true)]
      });

      log("redraw OK");
    }

  } catch (e) {
    error("interaction error", e);

    if (!i.replied) {
      try {
        await i.reply({ content: "エラー発生", flags: 64 });
      } catch {}
    }
  }
});

// ===== クラッシュ防止 =====
process.on("unhandledRejection", e => error("UNHANDLED", e));
process.on("uncaughtException", e => error("UNCAUGHT", e));

// ===== 起動 =====
client.login(process.env.DISCORD_TOKEN);
