require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events
} = require("discord.js");
const { getDailyFortune } = require("./fortunes");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const command = new SlashCommandBuilder()
  .setName("kuji")
  .setDescription("今日のおみくじを引きます（1日1回固定）");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [command.toJSON()] }
  );
  console.log("/kuji コマンド登録完了");
}

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} 起動完了`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "kuji") return;

  try {
    const name = interaction.member?.displayName ?? interaction.user.username;
    const result = getDailyFortune(user.id);

    const message = [
      `「${name}」さんの本日の運勢は`,
      `**運勢**：**${result.luck}**`,
      `**願望**：${result.wish}`,
      `**待ち人**：${result.person}`,
      `**失せ物**：${result.lost}`,
      `**旅行**：${result.travel}`
    ].join("\n");

    await interaction.reply({
      content: message
    });
  } catch (err) {
    console.error("おみくじ生成エラー:", err);
    await interaction.reply({
      content: "おみくじの生成中にエラーが発生しました。",
      ephemeral: true
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
