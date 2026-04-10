require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  Events
} = require("discord.js");
const Database = require("better-sqlite3");

// Railway Volume 永続化推奨: /data
const db = new Database("/data/sleep_logs.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    executor TEXT NOT NULL,
    guild TEXT NOT NULL,
    datetime TEXT NOT NULL
  )
`).run();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

const command = new SlashCommandBuilder()
  .setName("sleep")
  .setDescription("指定ユーザーをVCから退出させます")
  .addUserOption(option =>
    option
      .setName("name")
      .setDescription("退出させるユーザー")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [command.toJSON()] }
  );
  console.log("/sleep コマンド登録完了");
}

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} 起動完了`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "sleep") return;

  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "このコマンドは管理者のみ使用可能です。",
      ephemeral: true
    });
  }

  const target = interaction.options.getUser("name");
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

client.login(process.env.DISCORD_TOKEN);