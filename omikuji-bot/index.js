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

// ===== ログ関数 =====
function log(...args) {
  console.log("[LOG]", ...args);
}
function error(...args) {
  console.error("[ERROR]", ...args);
}

// ===== クライアント =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== コマンド =====
const command = new SlashCommandBuilder()
  .setName("kuji")
  .setDescription("おみくじ（デバッグ版）");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ===== 保存 =====
const REDRAW_FILE = "./redraws.json";
if (!fs.existsSync(REDRAW_FILE)) fs.writeFileSync(REDRAW_FILE, "{}");

function loadRedraws() {
  try {
    const data = JSON.parse(fs.readFileSync(REDRAW_FILE, "utf8"));
    log("redraws loaded", data);
    return data;
  } catch (e) {
    error("redraw load failed", e);
    return {};
  }
}

function saveRedraws(data) {
  try {
    fs.writeFileSync(REDRAW_FILE, JSON.stringify(data, null, 2));
    log("redraws saved");
  } catch (e) {
    error("redraw save failed", e);
  }
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
function buildEmbed(name, result) {
  log("buildEmbed", result);

  return new EmbedBuilder()
    .setTitle("🎍 おみくじ 🎍")
    .setDescription(`「${name}」さんの運勢`)
    .addFields(
      { name: "運勢", value: result.luck },
      { name: "総合", value: result.luckMessage }
    )
    .setTimestamp();
}

// ===== コマンド登録 =====
async function registerCommands() {
  log("registering command...");
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [command.toJSON()] }
  );
  log("command registered");
}

// ===== 起動 =====
client.once(Events.ClientReady, async () => {
  log(`READY: ${client.user.tag}`);
  await registerCommands();
});

// ===== Interaction =====
client.on(Events.InteractionCreate, async interaction => {
  log("interaction received", interaction.type);

  try {
    // ===== Slash =====
    if (interaction.isChatInputCommand()) {
      log("slash command", interaction.commandName);

      if (interaction.commandName === "kuji") {
        await interaction.reply({
          content: "ボタンを押してください",
          components: [buildStartButton()]
        });
        log("slash reply sent");
      }
    }

    // ===== ボタン =====
    if (!interaction.isButton()) return;

    log("button pressed", interaction.customId);

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const name = member.displayName;

    // --- START ---
    if (interaction.customId === "kuji_start") {
      log("start clicked");

      await interaction.deferUpdate(); // 安定化

      const result = getDailyFortune(interaction.user.id);

      await interaction.editReply({
        content: "結果",
        embeds: [buildEmbed(name, result)],
        components: [buildRedrawButton(false)]
      });

      log("start done");
    }

    // --- REDRAW ---
    if (interaction.customId === "kuji_redraw") {
      log("redraw clicked");

      await interaction.deferUpdate();

      const redraws = loadRedraws();
      const key = getTodayKey(interaction.user.id);

      if (redraws[key]) {
        log("already used redraw");

        return interaction.followUp({
          content: "もう引き直せません",
          ephemeral: true
        });
      }

      const result = getDailyFortune(interaction.user.id, true);

      redraws[key] = true;
      saveRedraws(redraws);

      await interaction.editReply({
        content: "引き直しました",
        embeds: [buildEmbed(name, result)],
        components: [buildRedrawButton(true)]
      });

      log("redraw done");
    }

  } catch (err) {
    error("interaction error", err);

    try {
      if (!interaction.replied) {
        await interaction.reply({
          content: "エラー発生（ログ確認）",
          ephemeral: true
        });
      }
    } catch (e) {
      error("reply fail", e);
    }
  }
});

// ===== クラッシュ防止 =====
process.on("unhandledRejection", err => {
  error("UNHANDLED REJECTION", err);
});

process.on("uncaughtException", err => {
  error("UNCAUGHT EXCEPTION", err);
});

// ===== 起動 =====
client.login(process.env.DISCORD_TOKEN);
