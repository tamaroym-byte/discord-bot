const { Client, GatewayIntentBits } = require("discord.js");

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers
    ]
  });
}

module.exports = { createClient };
