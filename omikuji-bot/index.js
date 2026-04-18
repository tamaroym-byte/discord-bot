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

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== コマンド =====
const command = new SlashCommandBuilder()
  .setName("kuji")
  .setDescription("おみくじを引きます（1日1回＋引き直し1回）");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ===== 引き直し管理 =====
const REDRAW_FILE = "./redraws.json";
if (!fs.existsSync(REDRAW_FILE)) fs.writeFileSync(REDRAW_FILE, "{}");

function loadRedraws() {
  return JSON.parse(fs.readFileSync(REDRAW_FILE, "utf8"));
}
function saveRedraws(data) {
  fs.writeFileSync(REDRAW_FILE, JSON.stringify(data, null, 2));
}
function getTodayKey(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return `${userId}_${today}`;
}

// ===== UI =====
function buildStartButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("kuji_start")
      .setLabel("🎍 おみくじを引く")
      .setStyle(ButtonStyle.Success)
  );
}

function buildRedrawButton(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("kuji_redraw")
      .setLabel("🔁 引き直す")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

// ===== Embed =====
function getLuckColor(luck) {
  switch (luck) {
    case "大吉": return 0xffd700;
    case "吉": return 0x00cc66;
    case "中吉": return 0x3399ff;
    case "小吉": return 0x66ccff;
    case "末吉": return 0xcccccc;
    case "凶": return 0xff6600;
    case "大凶": return 0xff0000;
    default: return 0xffffff;
  }
}

function buildEmbed(name, result) {
  const embed = new EmbedBuilder()
    .setColor(getLuckColor(result.luck))
    .setTitle("🎍 おみくじ 🎍")
    .setDescription(`「${name}」さんの本日の運勢`)
    .addFields(
      { name: "✨ 運勢 ✨", value: `**${result.luck}**` },
      { name: "🧭 総合", value: result.luckMessage },
      { name: "🙏 願望", value: result.wish, inline: true },
      { name: "👤 待ち人", value: result.person, inline: true },
      { name: "🔍 失せ物", value: result.lost, inline: true },
      { name: "🗺️ 旅行", value: result.travel, inline: true }
    )
    .setFooter({ text: "本日の運勢（毎日更新）" })
    .setTimestamp();

  if (result.luck === "大吉") {
    embed.setTitle("🌟🎍 大吉 🎍🌟");
  }

  return embed;
}

// ===== コマンド登録 =====
async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [command.toJSON()] }
  );
  console.log("/kuji 登録完了");
}

// ===== イベント =====
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} 起動完了`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {

  // ===== Slash =====
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "kuji") {
      return interaction.reply({
        content: "🎍 おみくじを引いてください",
        components: [buildStartButton()]
      });
    }
  }

  // ===== ボタン =====
  if (!interaction.isButton()) return;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const name = member.displayName;

  // --- 初回 ---
  if (interaction.customId === "kuji_start") {
    const result = getDailyFortune(interaction.user.id);

    return interaction.update({
      content: "🎍 結果はこちら",
      embeds: [buildEmbed(name, result)],
      components: [buildRedrawButton(false)]
    });
  }

  // --- 引き直し ---
  if (interaction.customId === "kuji_redraw") {
    const redraws = loadRedraws();
    const key = getTodayKey(interaction.user.id);

    if (redraws[key]) {
      return interaction.reply({
        content: "⛔ 今日はもう引き直しできません",
        ephemeral: true
      });
    }

    const result = getDailyFortune(interaction.user.id, true);

    redraws[key] = true;
    saveRedraws(redraws);

    return interaction.update({
      content: "🔁 引き直しました（本日1回のみ）",
      embeds: [buildEmbed(name, result)],
      components: [buildRedrawButton(true)]
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
