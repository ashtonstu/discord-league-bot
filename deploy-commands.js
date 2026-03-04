require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

// REQUIRED env vars:
// DISCORD_TOKEN
// CLIENT_ID
// (optional) GUILD_ID for guild-only registration (faster updates)

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Replies with pong."),

  new SlashCommandBuilder().setName("help").setDescription("Lists all commands."),

  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your Marvel Rivals IGN (required to join a team unless Discord admin).")
    .addStringOption((opt) =>
      opt.setName("ign").setDescription("Your Marvel Rivals IGN").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Team commands")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a team (Discord server admins only).")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Team name").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a team (Discord server admins only).")
        .addStringOption((opt) =>
          opt.setName("team").setDescription("Team name").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("invite")
        .setDescription("Invite a user to your team (captain/admin).")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to invite").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("invites").setDescription("View your pending invites.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("accept")
        .setDescription("Accept a team invite (must leave current team unless Discord admin).")
        .addStringOption((opt) =>
          opt.setName("team").setDescription("Team name").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("decline")
        .setDescription("Decline a team invite.")
        .addStringOption((opt) =>
          opt.setName("team").setDescription("Team name").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("leave").setDescription("Leave your current team (captain must transfer first).")
    )
    .addSubcommand((sub) =>
      sub
        .setName("transfer")
        .setDescription("Transfer captain to another member (captain; admins can transfer any team).")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("New captain").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("team")
            .setDescription("Team name (admins only; optional)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("promote")
        .setDescription("Promote a member to team admin (captain; admins can promote any team).")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to promote").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("team")
            .setDescription("Team name (admins only; optional)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("demote")
        .setDescription("Demote a team admin to member (captain; admins can demote any team).")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to demote").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("team")
            .setDescription("Team name (admins only; optional)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all teams (with captain).")
    )
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Show team info (includes roster + IGNs).")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Team name").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("match")
    .setDescription("Match scheduling")
    .addSubcommand((sub) =>
      sub
        .setName("request")
        .setDescription("Request a match time vs another team (other team must accept).")
        .addStringOption((opt) =>
          opt.setName("opponent").setDescription("Opponent team name").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("day").setDescription("Day (Fri/Sat/etc)").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("time").setDescription("Time (e.g., 8pm)").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("timezone").setDescription("Timezone label (ET/EST)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("accept")
        .setDescription("Accept a match request (ONLY the invited team’s captain/admin).")
        .addStringOption((opt) =>
          opt.setName("match_id").setDescription("Match request ID").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("decline")
        .setDescription("Decline a match request (ONLY the invited team’s captain/admin).")
        .addStringOption((opt) =>
          opt.setName("match_id").setDescription("Match request ID").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel a pending request or scheduled match (team staff / Discord admins).")
        .addStringOption((opt) =>
          opt.setName("match_id").setDescription("Match request ID or Match ID").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List pending + scheduled matches.")
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;

    if (!clientId) throw new Error("Missing CLIENT_ID in .env");
    if (!process.env.DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN in .env");

    if (guildId) {
      console.log("🚀 Deploying guild slash commands...");
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log("✅ Guild commands deployed.");
    } else {
      console.log("🚀 Deploying GLOBAL slash commands (can take up to 1 hour to update)...");
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("✅ Global commands deployed.");
    }
  } catch (err) {
    console.error("❌ Deploy failed:", err);
  }
})();