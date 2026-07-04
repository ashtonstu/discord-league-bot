require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");

const { loadDB, saveDB, normalizeTeamName } = require("./storage");

const MAX_TEAM_SIZE = 25;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const PREFIX = process.env.COMMAND_PREFIX || "!";

process.on("unhandledRejection", (reason) =>
  console.error("❌ Unhandled Rejection:", reason)
);
process.on("uncaughtException", (err) =>
  console.error("❌ Uncaught Exception:", err)
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

function isDiscordAdmin(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function tokenize(input) {
  // Supports: words, "double quoted", 'single quoted'
  const out = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] || m[2] || m[3]);
  }
  return out;
}

function helpEmbed(clientUser) {
  const e = new EmbedBuilder()
    .setTitle("📘 League Bot Help")
    .setDescription(
      `All commands use the **${PREFIX}** prefix.\n\n` +
        `Tip: wrap multi-word team names in quotes, e.g. **${PREFIX}team info \"Elysium Prime\"**.`
    )
    .addFields(
      {
        name: "General",
        value:
          `• **${PREFIX}ping** — check if the bot is alive\n` +
          `• **${PREFIX}help** — show this menu\n` +
          `• **${PREFIX}register <IGN>** — register your Marvel Rivals IGN`,
        inline: false,
      },
      {
        name: "Teams",
        value:
          `• **${PREFIX}team create <team name>** *(Discord admins)*\n` +
          `• **${PREFIX}team delete <team name>** *(Discord admins)*\n` +
          `• **${PREFIX}team list**\n` +
          `• **${PREFIX}team info <team name>**\n` +
          `• **${PREFIX}team roster** *(your team)*\n` +
          `• **${PREFIX}team invite @user** *(captain/admin)*\n` +
          `• **${PREFIX}team invites**\n` +
          `• **${PREFIX}team accept <team name>**\n` +
          `• **${PREFIX}team decline <team name>**\n` +
          `• **${PREFIX}team leave**\n` +
          `• **${PREFIX}team kick <@user | user ID | IGN>** *(captain/admin)*\n` +
          `• **${PREFIX}team transfer @user [team name]** *(captain; admins can target any team)*\n` +
          `• **${PREFIX}team promote @user [team name]** *(captain; admins can target any team)*\n` +
          `• **${PREFIX}team demote @user [team name]** *(captain; admins can target any team)*`,
        inline: false,
      },
      {
        name: "Matches",
        value:
          `• **${PREFIX}match request <opponent team> <day> <time> [tz]** *(captain/admin)*\n` +
          `• **${PREFIX}match accept <match_id>** *(invited team captain/admin)*\n` +
          `• **${PREFIX}match decline <match_id>** *(invited team captain/admin)*\n` +
          `• **${PREFIX}match cancel <match_id>** *(team staff / Discord admins)*\n` +
          `• **${PREFIX}match list**\n` +
          `• **${PREFIX}match report <match_id> <scoreA-scoreB>** *(team staff / Discord admins)*`,
        inline: false,
      },
      {
        name: "League",
        value: `• **${PREFIX}standings** — show team standings (based on reported match results)`,
        inline: false,
      },
      {
        name: "Scrims",
        value:
          `• **${PREFIX}scrim lft [note]** — post “looking for team”\n` +
          `• **${PREFIX}scrim lfp <team> [note]** *(captain/admin)* — post “looking for players”\n` +
          `• **${PREFIX}scrim list** — list open posts\n` +
          `• **${PREFIX}scrim close <post_id>** — close your post`,
        inline: false,
      },
      {
        name: "Examples",
        value:
          `• **${PREFIX}register AtomicMegaFart**\n` +
          `• **${PREFIX}team create \"Elysium\"**\n` +
          `• **${PREFIX}team invite @Ash**\n` +
          `• **${PREFIX}team kick 759628285893935104**\n` +
          `• **${PREFIX}match request \"Elysium\" Fri 8pm ET**\n` +
          `• **${PREFIX}match report match_ab12cd 2-1**\n` +
          `• **${PREFIX}standings**\n` +
          `• **${PREFIX}scrim lft \"Support main, evenings\"**`,
        inline: false,
      }
    )
    .setFooter({
      text: "League Bot • Use quotes for names with spaces",
      iconURL: clientUser?.displayAvatarURL?.() || undefined,
    });

  if (clientUser?.displayAvatarURL) e.setThumbnail(clientUser.displayAvatarURL());
  return e;
}

function parseScore(raw) {
  // Accept: 2-1, 2:1, 2/1
  const m = String(raw || "").trim().match(/^(\d+)[\-:\/](\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

function computeStandings(db) {
  const table = {};
  const ensure = (teamKey, teamName) => {
    if (!table[teamKey]) {
      table[teamKey] = {
        teamKey,
        teamName,
        gp: 0,
        w: 0,
        l: 0,
        gf: 0,
        ga: 0,
      };
    }
    return table[teamKey];
  };

  for (const t of Object.entries(db.teams || {})) {
    ensure(t[0], t[1]?.name || t[0]);
  }

  for (const m of Object.values(db.matches || {})) {
    if (m.status !== "completed") continue;
    if (!m.result || typeof m.result.scoreA !== "number" || typeof m.result.scoreB !== "number") continue;

    const a = ensure(m.teamAKey, m.teamAName);
    const b = ensure(m.teamBKey, m.teamBName);

    a.gp += 1;
    b.gp += 1;

    a.gf += m.result.scoreA;
    a.ga += m.result.scoreB;
    b.gf += m.result.scoreB;
    b.ga += m.result.scoreA;

    if (m.result.scoreA > m.result.scoreB) {
      a.w += 1;
      b.l += 1;
    } else if (m.result.scoreB > m.result.scoreA) {
      b.w += 1;
      a.l += 1;
    }
  }

  const rows = Object.values(table).map((r) => ({
    ...r,
    diff: r.gf - r.ga,
  }));

  rows.sort((x, y) =>
    y.w - x.w || y.diff - x.diff || y.gf - x.gf || x.teamName.localeCompare(y.teamName)
  );

  return rows;
}

function standingsEmbed(db) {
  const rows = computeStandings(db);
  const e = new EmbedBuilder()
    .setTitle("🏆 Standings")
    .setDescription(
      rows.length
        ? "Results are based on **reported** matches (use `!match report`)."
        : "No results yet — report a match to start building standings."
    );

  if (rows.length) {
    const lines = rows.slice(0, 20).map((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
      return `${medal} **${i + 1}. ${r.teamName}** — ${r.w}-${r.l} (GP ${r.gp}) • Diff ${r.diff} • GF ${r.gf}`;
    });
    e.addFields({ name: "Leaderboard", value: lines.join("\n") });
  }

  return e;
}

function matchScheduledEmbed(match) {
  return new EmbedBuilder()
    .setTitle("⚔️ Match Scheduled")
    .setDescription(`**${match.teamAName}** vs **${match.teamBName}**`)
    .addFields(
      { name: "When", value: `${match.day} @ ${match.time} ${match.timezone}`, inline: true },
      { name: "Match ID", value: `\`${match.id}\``, inline: true }
    );
}

function matchRequestEmbed(req) {
  return new EmbedBuilder()
    .setTitle("📨 Match Requested")
    .setDescription(`**${req.teamAName}** vs **${req.teamBName}**`)
    .addFields(
      { name: "When", value: `${req.day} @ ${req.time} ${req.timezone}`, inline: true },
      { name: "Request ID", value: `\`${req.id}\``, inline: true },
      { name: "Next", value: `Invited team: **${PREFIX}match accept ${req.id}** or **${PREFIX}match decline ${req.id}**`, inline: false }
    );
}

function matchResultEmbed(match) {
  const a = match?.result?.scoreA;
  const b = match?.result?.scoreB;
  const scoreLine = typeof a === "number" && typeof b === "number" ? `**${a} - ${b}**` : "(no score)";
  return new EmbedBuilder()
    .setTitle("✅ Match Reported")
    .setDescription(`**${match.teamAName}** vs **${match.teamBName}**`)
    .addFields(
      { name: "Score", value: scoreLine, inline: true },
      { name: "Match ID", value: `\`${match.id}\``, inline: true },
      { name: "When", value: `${match.day} @ ${match.time} ${match.timezone}`, inline: false }
    );
}

async function announce(guild, fallbackChannel, message) {
  try {
    let channel = null;

    if (LOG_CHANNEL_ID && guild) {
      channel = await guild.channels
        .fetch(LOG_CHANNEL_ID)
        .catch(() => null);
    }

    if (!channel) channel = fallbackChannel;

    if (channel && channel.isTextBased()) {
      await channel.send(message);
    }
  } catch (err) {
    console.error("announce error:", err);
  }
}

function formatTeamRoster(db, team) {
  const roster = (team.memberIds || []).map((id) => {
    const ign = db.players?.[id]?.ign || "IGN not registered";
    const tags = [
      team.captainId === id ? "👑 Captain" : null,
      (team.adminIds || []).includes(id) ? "🛡️ Admin" : null,
    ].filter(Boolean);

    return `• <@${id}> — **${ign}**${tags.length ? ` (${tags.join(", ")})` : ""} — ID: \`${id}\``;
  });
  return roster.length ? roster.join("\n") : "(no members)";
}

function cleanUserLookup(raw) {
  return String(raw || "")
    .trim()
    .replace(/[<@!>]/g, "");
}

function resolveTeamMember(db, team, rawTarget) {
  const lookup = cleanUserLookup(rawTarget);
  if (!lookup) return null;

  const memberIds = team.memberIds || [];

  // Direct Discord ID lookup. This still works after the user leaves or is banned.
  if (/^\d{17,20}$/.test(lookup) && memberIds.includes(lookup)) {
    return {
      id: lookup,
      ign: db.players?.[lookup]?.ign || "IGN not registered",
      matchedBy: "Discord ID",
    };
  }

  // Registered IGN lookup for convenience.
  const lowered = lookup.toLowerCase();
  for (const id of memberIds) {
    const ign = db.players?.[id]?.ign;
    if (ign && ign.toLowerCase() === lowered) {
      return { id, ign, matchedBy: "IGN" };
    }
  }

  return null;
}

function findUsersTeamEntry(db, userId) {
  return Object.entries(db.teams).find(([_, t]) =>
    (t.memberIds || []).includes(userId)
  );
}

function isCaptain(team, userId) {
  return team?.captainId === userId;
}

function isTeamAdmin(team, userId) {
  return (team?.adminIds || []).includes(userId);
}

function isTeamManager(team, userId) {
  return isCaptain(team, userId) || isTeamAdmin(team, userId);
}

function getTeamByName(db, rawName) {
  const key = normalizeTeamName(rawName);
  return { key, team: db.teams[key] || null };
}

function requireRegisteredOrAdmin(db, member, userId) {
  if (isDiscordAdmin(member)) return true;
  return !!db.players?.[userId]?.ign;
}

function ensureInviteStore(db) {
  db.invites = db.invites || {};
}

function addInvite(db, userId, teamKey, invitedBy) {
  ensureInviteStore(db);
  db.invites[userId] = db.invites[userId] || [];
  const already = db.invites[userId].some((x) => x.teamKey === teamKey);
  if (already) return false;
  db.invites[userId].push({ teamKey, invitedBy, createdAt: nowIso() });
  return true;
}

function removeInvite(db, userId, teamKey) {
  ensureInviteStore(db);
  const list = db.invites[userId] || [];
  const next = list.filter((x) => x.teamKey !== teamKey);
  db.invites[userId] = next;
}

function listInvites(db, userId) {
  ensureInviteStore(db);
  return db.invites[userId] || [];
}

function cleanupInvitesForTeam(db, teamKey) {
  ensureInviteStore(db);
  for (const uid of Object.keys(db.invites)) {
    db.invites[uid] = (db.invites[uid] || []).filter((x) => x.teamKey !== teamKey);
  }
}

function formatMatchRequestLine(req) {
  return `• **${req.id}** — **${req.teamAName}** vs **${req.teamBName}** — ${req.day} @ ${req.time} ${req.timezone} — *${req.status}*`;
}

function formatMatchLine(m) {
  return `• **${m.id}** — **${m.teamAName}** vs **${m.teamBName}** — ${m.day} @ ${m.time} ${m.timezone} — *${m.status}*`;
}

// ==============================
// PREFIX COMMANDS (!help, etc.)
// ==============================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.content?.startsWith(PREFIX)) return;

    const raw = message.content.slice(PREFIX.length).trim();
    if (!raw) return;

    const parts = tokenize(raw);
    const cmd = (parts.shift() || "").toLowerCase();

    const db = loadDB();

    // !ping
    if (cmd === "ping") {
      return message.reply("Pong! 🧩");
    }

    // !help
    if (cmd === "help") {
      return message.reply({ embeds: [helpEmbed(client.user)] });
    }

    // !register <ign...>
    if (cmd === "register") {
      const ign = parts.join(" ").trim();
      if (!ign) return message.reply(`❌ Usage: **${PREFIX}register <IGN>**`);

      db.players[message.author.id] = { ign, registeredAt: nowIso() };
      saveDB(db);

      await announce(
        message.guild,
        message.channel,
        `✅ <@${message.author.id}> registered IGN: **${ign}**`
      );

      return message.reply(`✅ Registered IGN as **${ign}**`);
    }

    // !standings
    if (cmd === "standings") {
      return message.reply({ embeds: [standingsEmbed(db)] });
    }

    // !team ...
    if (cmd === "team") {
      const sub = (parts.shift() || "").toLowerCase();
      if (!sub) return message.reply(`❌ Usage: **${PREFIX}team <subcommand>** (try ${PREFIX}help)`);

      // create (admins only)
      if (sub === "create") {
        if (!isDiscordAdmin(message.member)) return message.reply("❌ Admins only.");
        const name = parts.join(" ").trim();
        if (!name) return message.reply(`❌ Usage: **${PREFIX}team create <team name>**`);

        const key = normalizeTeamName(name);
        if (db.teams[key]) return message.reply("❌ Team already exists.");

        db.teams[key] = {
          name,
          captainId: message.author.id,
          adminIds: [],
          memberIds: [message.author.id],
        };

        saveDB(db);

        await announce(
          message.guild,
          message.channel,
          `🏁 Team created: **${name}** (Captain: <@${message.author.id}>)`
        );

        return message.reply("✅ Team created.");
      }

      // delete (admins only)
      if (sub === "delete") {
        if (!isDiscordAdmin(message.member)) return message.reply("❌ Admins only.");
        const name = parts.join(" ").trim();
        if (!name) return message.reply(`❌ Usage: **${PREFIX}team delete <team name>**`);
        const { key, team } = getTeamByName(db, name);
        if (!team) return message.reply("❌ Team not found.");

        delete db.teams[key];
        cleanupInvitesForTeam(db, key);

        // mark related match requests/matches as canceled (keeps history)
        for (const r of Object.values(db.matchRequests || {})) {
          if (r.teamAKey === key || r.teamBKey === key) r.status = "canceled";
        }
        for (const m of Object.values(db.matches || {})) {
          if (m.teamAKey === key || m.teamBKey === key) m.status = "canceled";
        }

        saveDB(db);
        await announce(message.guild, message.channel, `🗑️ Team deleted: **${team.name}**`);
        return message.reply("✅ Team deleted.");
      }

      // list
      if (sub === "list") {
        const teams = Object.values(db.teams);
        if (!teams.length) return message.reply("No teams created.");
        const lines = teams.map(
          (t) =>
            `• **${t.name}** — Captain: <@${t.captainId}> — Members: ${(t.memberIds || []).length}/${MAX_TEAM_SIZE}`
        );
        return message.reply(lines.join("\n"));
      }

      // info
      if (sub === "info") {
        const name = parts.join(" ").trim();
        if (!name) return message.reply(`❌ Usage: **${PREFIX}team info <team name>**`);
        const { team } = getTeamByName(db, name);
        if (!team) return message.reply("❌ Team not found.");

        const e = new EmbedBuilder()
          .setTitle(`🏷️ ${team.name}`)
          .setDescription(
            `👑 Captain: <@${team.captainId}>\n` +
              `👥 Members: ${(team.memberIds || []).length}/${MAX_TEAM_SIZE}`
          )
          .addFields({ name: "Roster", value: formatTeamRoster(db, team) });

        return message.reply({ embeds: [e] });
      }

      // roster (quick view for your own team)
      if (sub === "roster") {
        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You are not on a team.");
        const [_, team] = entry;

        const e = new EmbedBuilder()
          .setTitle(`👥 Roster — ${team.name}`)
          .setDescription(
            `👑 Captain: <@${team.captainId}>\n` +
              `👥 Members: ${(team.memberIds || []).length}/${MAX_TEAM_SIZE}`
          )
          .addFields({ name: "Players", value: formatTeamRoster(db, team) });

        return message.reply({ embeds: [e] });
      }

      // kick <@user | user ID | IGN>
      if (sub === "kick") {
        const rawTarget = parts.shift();
        if (!rawTarget) {
          return message.reply(`❌ Usage: **${PREFIX}team kick <@user | user ID | IGN>**`);
        }

        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You must be on a team.");
        const [_, team] = entry;

        if (!isTeamManager(team, message.author.id) && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Captain/admin only.");
        }

        const target = resolveTeamMember(db, team, rawTarget);
        if (!target) {
          return message.reply(
            "❌ I couldn’t find that player on your team. Try their Discord ID from `!team roster`, or their exact registered IGN."
          );
        }

        if (target.id === team.captainId && !isDiscordAdmin(message.member)) {
          return message.reply("❌ You can’t kick the captain. Transfer captain first.");
        }

        team.memberIds = (team.memberIds || []).filter((id) => id !== target.id);
        team.adminIds = (team.adminIds || []).filter((id) => id !== target.id);
        saveDB(db);

        const playerLabel = `${target.ign} (ID: ${target.id})`;
        await announce(
          message.guild,
          message.channel,
          `👢 **${playerLabel}** was removed from **${team.name}** by <@${message.author.id}>`
        );

        return message.reply(`✅ Removed **${target.ign}** from **${team.name}**.`);
      }

      // invite @user
      if (sub === "invite") {
        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You must be on a team to invite.");
        const [teamKey, team] = entry;
        if (!isTeamManager(team, message.author.id)) return message.reply("❌ Captain/admin only.");

        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Usage: **${PREFIX}team invite @user**`);
        if (target.bot) return message.reply("❌ You can’t invite bots.");

        if ((team.memberIds || []).includes(target.id)) return message.reply("❌ They are already on your team.");
        if ((team.memberIds || []).length >= MAX_TEAM_SIZE) return message.reply("❌ Team is full.");

        const added = addInvite(db, target.id, teamKey, message.author.id);
        if (!added) return message.reply("⚠️ They already have an invite to this team.");
        saveDB(db);

        await announce(
          message.guild,
          message.channel,
          `✉️ <@${target.id}> was invited to **${team.name}** by <@${message.author.id}>`
        );

        // Try DM (best effort)
        target
          .send(
            `You’ve been invited to join **${team.name}** in **${message.guild.name}**.\n` +
              `Accept: **${PREFIX}team accept "${team.name}"**\n` +
              `Decline: **${PREFIX}team decline "${team.name}"**`
          )
          .catch(() => null);

        return message.reply("✅ Invite sent.");
      }

      // invites
      if (sub === "invites") {
        const inv = listInvites(db, message.author.id);
        if (!inv.length) return message.reply("You have no pending invites.");
        const lines = inv
          .map((x) => {
            const team = db.teams?.[x.teamKey];
            const teamName = team?.name || x.teamKey;
            return `• **${teamName}** (invited by <@${x.invitedBy}>)`;
          })
          .join("\n");
        return message.reply(`📩 **Pending Invites**\n${lines}`);
      }

      // accept <team>
      if (sub === "accept") {
        const name = parts.join(" ").trim();
        if (!name) return message.reply(`❌ Usage: **${PREFIX}team accept <team name>**`);

        const { key: teamKey, team } = getTeamByName(db, name);
        if (!team) return message.reply("❌ Team not found.");

        // must have invite unless Discord admin
        const hasInvite = listInvites(db, message.author.id).some((x) => x.teamKey === teamKey);
        if (!hasInvite && !isDiscordAdmin(message.member)) {
          return message.reply("❌ You don’t have an invite to that team.");
        }

        if (!requireRegisteredOrAdmin(db, message.member, message.author.id)) {
          return message.reply(`❌ You must register first: **${PREFIX}register <IGN>**`);
        }

        const current = findUsersTeamEntry(db, message.author.id);
        if (current) {
          const [curKey, curTeam] = current;
          if (curKey === teamKey) {
            removeInvite(db, message.author.id, teamKey);
            saveDB(db);
            return message.reply("✅ You’re already on that team.");
          }
          if (isCaptain(curTeam, message.author.id)) {
            return message.reply("❌ Captain must transfer before leaving current team.");
          }
          // If admin: allow switching teams without having to manually leave
          curTeam.memberIds = (curTeam.memberIds || []).filter((id) => id !== message.author.id);
          curTeam.adminIds = (curTeam.adminIds || []).filter((id) => id !== message.author.id);
          await announce(message.guild, message.channel, `👋 <@${message.author.id}> left **${curTeam.name}**`);
        }

        if ((team.memberIds || []).length >= MAX_TEAM_SIZE) {
          return message.reply("❌ Team is full.");
        }

        team.memberIds = team.memberIds || [];
        team.memberIds.push(message.author.id);
        removeInvite(db, message.author.id, teamKey);
        saveDB(db);

        await announce(message.guild, message.channel, `✅ <@${message.author.id}> joined **${team.name}**`);
        return message.reply(`✅ Joined **${team.name}**`);
      }

      // decline <team>
      if (sub === "decline") {
        const name = parts.join(" ").trim();
        if (!name) return message.reply(`❌ Usage: **${PREFIX}team decline <team name>**`);
        const { key: teamKey, team } = getTeamByName(db, name);
        if (!team) return message.reply("❌ Team not found.");
        removeInvite(db, message.author.id, teamKey);
        saveDB(db);
        return message.reply(`✅ Declined invite to **${team.name}**`);
      }

      // leave
      if (sub === "leave") {
        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You are not on a team.");
        const [_, team] = entry;
        if (team.captainId === message.author.id) {
          return message.reply("❌ Captain must transfer before leaving.");
        }

        team.memberIds = (team.memberIds || []).filter((id) => id !== message.author.id);
        team.adminIds = (team.adminIds || []).filter((id) => id !== message.author.id);
        saveDB(db);

        await announce(message.guild, message.channel, `👋 <@${message.author.id}> left **${team.name}**`);
        return message.reply("✅ You left the team.");
      }

      // transfer / promote / demote
      if (["transfer", "promote", "demote"].includes(sub)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Usage: **${PREFIX}team ${sub} @user [team name]**`);

        // if admin: optionally target a team by name in remaining args
        const maybeTeamName = parts.filter((p) => !p.startsWith("<@"))
          .join(" ")
          .trim();

        let teamKey, team;
        if (isDiscordAdmin(message.member) && maybeTeamName) {
          const got = getTeamByName(db, maybeTeamName);
          teamKey = got.key;
          team = got.team;
          if (!team) return message.reply("❌ Team not found.");
        } else {
          const entry = findUsersTeamEntry(db, message.author.id);
          if (!entry) return message.reply("❌ You must be on a team.");
          [teamKey, team] = entry;
        }

        const authorIsAdmin = isDiscordAdmin(message.member);

        if (!authorIsAdmin) {
          if (sub === "transfer" && !isCaptain(team, message.author.id)) return message.reply("❌ Captain only.");
          if (["promote", "demote"].includes(sub) && !isCaptain(team, message.author.id)) return message.reply("❌ Captain only.");
        }

        if (!(team.memberIds || []).includes(target.id)) {
          return message.reply("❌ That user is not a member of the target team.");
        }

        if (sub === "transfer") {
          team.captainId = target.id;
          team.adminIds = (team.adminIds || []).filter((id) => id !== target.id);
          saveDB(db);
          await announce(message.guild, message.channel, `👑 Captain transferred for **${team.name}** → <@${target.id}>`);
          return message.reply("✅ Captain transferred.");
        }

        if (sub === "promote") {
          team.adminIds = team.adminIds || [];
          if (!team.adminIds.includes(target.id)) team.adminIds.push(target.id);
          saveDB(db);
          await announce(message.guild, message.channel, `🛡️ <@${target.id}> promoted to admin in **${team.name}**`);
          return message.reply("✅ Promoted.");
        }

        if (sub === "demote") {
          team.adminIds = (team.adminIds || []).filter((id) => id !== target.id);
          saveDB(db);
          await announce(message.guild, message.channel, `🔻 <@${target.id}> demoted in **${team.name}**`);
          return message.reply("✅ Demoted.");
        }
      }

      return message.reply(`⚠️ Unknown team subcommand. Try **${PREFIX}help**`);
    }

    // !scrim ...
    if (cmd === "scrim") {
      const sub = (parts.shift() || "").toLowerCase();
      if (!sub) return message.reply(`❌ Usage: **${PREFIX}scrim <lft|lfp|list|close>**`);

      db.scrims = db.scrims || { posts: [] };
      db.scrims.posts = db.scrims.posts || [];

      const openPosts = () => db.scrims.posts.filter((p) => p.status === "open");

      if (sub === "lft") {
        const note = parts.join(" ").trim() || "(no note)";
        const id = makeId("scrim");
        db.scrims.posts.push({
          id,
          type: "LFT",
          userId: message.author.id,
          note,
          status: "open",
          createdAt: nowIso(),
        });
        saveDB(db);

        const e = new EmbedBuilder()
          .setTitle("🔎 LFT — Looking for Team")
          .setDescription(`<@${message.author.id}>`)
          .addFields(
            { name: "Post ID", value: `\`${id}\``, inline: true },
            { name: "Note", value: note, inline: false }
          );

        await announce(message.guild, message.channel, { embeds: [e] });
        return message.reply("✅ Posted LFT.");
      }

      if (sub === "lfp") {
        const teamName = parts.shift();
        if (!teamName) return message.reply(`❌ Usage: **${PREFIX}scrim lfp <team> [note]**`);
        const { key: teamKey, team } = getTeamByName(db, teamName);
        if (!team) return message.reply("❌ Team not found.");
        if (!isTeamManager(team, message.author.id) && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Captain/admin only.");
        }

        const note = parts.join(" ").trim() || "(no note)";
        const id = makeId("scrim");
        db.scrims.posts.push({
          id,
          type: "LFP",
          teamKey,
          teamName: team.name,
          createdBy: message.author.id,
          note,
          status: "open",
          createdAt: nowIso(),
        });
        saveDB(db);

        const e = new EmbedBuilder()
          .setTitle("🧩 LFP — Looking for Players")
          .setDescription(`**${team.name}**`)
          .addFields(
            { name: "Post ID", value: `\`${id}\``, inline: true },
            { name: "Posted by", value: `<@${message.author.id}>`, inline: true },
            { name: "Note", value: note, inline: false }
          );

        await announce(message.guild, message.channel, { embeds: [e] });
        return message.reply("✅ Posted LFP.");
      }

      if (sub === "list") {
        const posts = openPosts().slice(-15).reverse();
        if (!posts.length) return message.reply("No open scrim posts right now.");

        const lines = posts.map((p) => {
          if (p.type === "LFT") return `• **${p.id}** — 🔎 <@${p.userId}> — ${p.note}`;
          return `• **${p.id}** — 🧩 **${p.teamName}** (by <@${p.createdBy}>) — ${p.note}`;
        });

        const e = new EmbedBuilder().setTitle("📌 Scrim Board").setDescription(lines.join("\n"));
        return message.reply({ embeds: [e] });
      }

      if (sub === "close") {
        const id = parts[0];
        if (!id) return message.reply(`❌ Usage: **${PREFIX}scrim close <post_id>**`);
        const post = db.scrims.posts.find((p) => p.id === id);
        if (!post) return message.reply("❌ Post not found.");
        if (post.status !== "open") return message.reply("⚠️ That post is already closed.");

        const authorIsAdmin = isDiscordAdmin(message.member);
        const isOwner = post.userId === message.author.id || post.createdBy === message.author.id;
        const isTeamOwner = post.teamKey ? isTeamManager(db.teams?.[post.teamKey], message.author.id) : false;

        if (!authorIsAdmin && !isOwner && !isTeamOwner) {
          return message.reply("❌ Only the creator (or team staff / Discord admins) can close this post.");
        }

        post.status = "closed";
        post.closedAt = nowIso();
        post.closedBy = message.author.id;
        saveDB(db);
        return message.reply("✅ Closed.");
      }

      return message.reply(`⚠️ Unknown scrim subcommand. Try **${PREFIX}help**`);
    }

    // !match ...
    if (cmd === "match") {
      const sub = (parts.shift() || "").toLowerCase();
      if (!sub) return message.reply(`❌ Usage: **${PREFIX}match <subcommand>** (try ${PREFIX}help)`);

      if (sub === "request") {
        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You must be on a team.");
        const [teamAKey, teamA] = entry;
        if (!isTeamManager(teamA, message.author.id)) return message.reply("❌ Captain/admin only.");

        const opponentRaw = parts.shift();
        const day = parts.shift();
        const time = parts.shift();
        const timezone = parts.shift() || "ET";

        if (!opponentRaw || !day || !time) {
          return message.reply(
            `❌ Usage: **${PREFIX}match request <opponent team> <day> <time> [tz]**\n` +
              `Example: **${PREFIX}match request \"Elysium\" Fri 8pm ET**`
          );
        }

        const teamBKey = normalizeTeamName(opponentRaw);
        const teamB = db.teams[teamBKey];
        if (!teamB) return message.reply("❌ Opponent team not found.");

        const requestId = makeId("matchreq");
        db.matchRequests[requestId] = {
          id: requestId,
          teamAKey,
          teamBKey,
          teamAName: teamA.name,
          teamBName: teamB.name,
          day,
          time,
          timezone,
          status: "pending",
          createdAt: nowIso(),
          createdBy: message.author.id,
        };

        saveDB(db);

        await announce(message.guild, message.channel, {
          embeds: [matchRequestEmbed(db.matchRequests[requestId])],
        });

        return message.reply(`✅ Match request sent. ID: **${requestId}**`);
      }

      if (sub === "accept") {
        const id = parts[0];
        if (!id) return message.reply(`❌ Usage: **${PREFIX}match accept <match_id>**`);
        const req = db.matchRequests?.[id];
        if (!req) return message.reply("❌ Match request not found.");
        if (req.status !== "pending") return message.reply(`❌ That request is not pending (status: ${req.status}).`);

        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You must be on a team.");
        const [userTeamKey, userTeam] = entry;
        if (userTeamKey !== req.teamBKey && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Only the invited team can accept.");
        }
        if (!isTeamManager(userTeam, message.author.id) && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Captain/admin only.");
        }

        req.status = "accepted";
        req.acceptedAt = nowIso();
        req.acceptedBy = message.author.id;

        const matchId = makeId("match");
        db.matches[matchId] = {
          id: matchId,
          teamAKey: req.teamAKey,
          teamBKey: req.teamBKey,
          teamAName: req.teamAName,
          teamBName: req.teamBName,
          day: req.day,
          time: req.time,
          timezone: req.timezone,
          status: "scheduled",
          createdFromRequest: req.id,
          createdAt: nowIso(),
        };

        saveDB(db);

        await announce(message.guild, message.channel, {
          embeds: [matchScheduledEmbed(db.matches[matchId])],
        });

        return message.reply(`✅ Accepted. Match ID: **${matchId}**`);
      }

      if (sub === "decline") {
        const id = parts[0];
        if (!id) return message.reply(`❌ Usage: **${PREFIX}match decline <match_id>**`);
        const req = db.matchRequests?.[id];
        if (!req) return message.reply("❌ Match request not found.");
        if (req.status !== "pending") return message.reply(`❌ That request is not pending (status: ${req.status}).`);

        const entry = findUsersTeamEntry(db, message.author.id);
        if (!entry) return message.reply("❌ You must be on a team.");
        const [userTeamKey, userTeam] = entry;
        if (userTeamKey !== req.teamBKey && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Only the invited team can decline.");
        }
        if (!isTeamManager(userTeam, message.author.id) && !isDiscordAdmin(message.member)) {
          return message.reply("❌ Captain/admin only.");
        }

        req.status = "declined";
        req.declinedAt = nowIso();
        req.declinedBy = message.author.id;
        saveDB(db);

        await announce(message.guild, message.channel, `❌ Match request declined (**${req.id}**) — **${req.teamAName}** vs **${req.teamBName}**`);
        return message.reply("✅ Declined.");
      }

      if (sub === "cancel") {
        const id = parts[0];
        if (!id) return message.reply(`❌ Usage: **${PREFIX}match cancel <match_id>**`);

        // cancel a request
        if (db.matchRequests?.[id]) {
          const req = db.matchRequests[id];
          const entry = findUsersTeamEntry(db, message.author.id);
          const authorIsAdmin = isDiscordAdmin(message.member);

          const can =
            authorIsAdmin ||
            (entry &&
              (entry[0] === req.teamAKey || entry[0] === req.teamBKey) &&
              isTeamManager(entry[1], message.author.id));

          if (!can) return message.reply("❌ Captain/admin for either team (or Discord admin) only.");

          req.status = "canceled";
          req.canceledAt = nowIso();
          req.canceledBy = message.author.id;
          saveDB(db);
          await announce(message.guild, message.channel, `🛑 Match request canceled (**${req.id}**) — **${req.teamAName}** vs **${req.teamBName}**`);
          return message.reply("✅ Canceled.");
        }

        // cancel a match
        if (db.matches?.[id]) {
          const m = db.matches[id];
          const entry = findUsersTeamEntry(db, message.author.id);
          const authorIsAdmin = isDiscordAdmin(message.member);

          const can =
            authorIsAdmin ||
            (entry &&
              (entry[0] === m.teamAKey || entry[0] === m.teamBKey) &&
              isTeamManager(entry[1], message.author.id));

          if (!can) return message.reply("❌ Captain/admin for either team (or Discord admin) only.");

          m.status = "canceled";
          m.canceledAt = nowIso();
          m.canceledBy = message.author.id;
          saveDB(db);
          await announce(message.guild, message.channel, `🛑 Match canceled (**${m.id}**) — **${m.teamAName}** vs **${m.teamBName}**`);
          return message.reply("✅ Canceled.");
        }

        return message.reply("❌ No match request or match found with that ID.");
      }

      if (sub === "report") {
        const id = parts[0];
        const scoreRaw = parts[1];
        if (!id || !scoreRaw) {
          return message.reply(
            `❌ Usage: **${PREFIX}match report <match_id> <scoreA-scoreB>**\n` +
              `Example: **${PREFIX}match report match_ab12cd 2-1**`
          );
        }
        const m = db.matches?.[id];
        if (!m) return message.reply("❌ Match not found.");
        if (m.status === "canceled") return message.reply("❌ That match is canceled.");

        const score = parseScore(scoreRaw);
        if (!score) return message.reply("❌ Invalid score format. Use like **2-1**.");

        const entry = findUsersTeamEntry(db, message.author.id);
        const authorIsAdmin = isDiscordAdmin(message.member);
        const onEitherTeam = entry && (entry[0] === m.teamAKey || entry[0] === m.teamBKey);
        const can = authorIsAdmin || (onEitherTeam && isTeamManager(entry[1], message.author.id));
        if (!can) return message.reply("❌ Team captain/admin for either team (or Discord admin) only.");

        m.status = "completed";
        m.result = {
          scoreA: score.a,
          scoreB: score.b,
          reportedBy: message.author.id,
          reportedAt: nowIso(),
        };

        saveDB(db);

        await announce(message.guild, message.channel, { embeds: [matchResultEmbed(m)] });
        return message.reply("✅ Result recorded.");
      }

      if (sub === "list") {
        const reqs = Object.values(db.matchRequests || {}).filter((r) => r.status === "pending");
        const matches = Object.values(db.matches || {}).filter((m) => m.status !== "canceled");

        const lines = [];
        if (reqs.length) {
          lines.push("📨 **Pending Requests**");
          lines.push(...reqs.map(formatMatchRequestLine));
        }
        if (matches.length) {
          if (lines.length) lines.push("");
          lines.push("📅 **Scheduled Matches**");
          lines.push(...matches.map(formatMatchLine));
        }
        if (!lines.length) return message.reply("No pending requests or scheduled matches.");
        return message.reply(lines.join("\n"));
      }

      return message.reply(`⚠️ Unknown match subcommand. Try **${PREFIX}help**`);
    }

    return message.reply(`❓ Unknown command. Try **${PREFIX}help**`);
  } catch (err) {
    console.error("Message command error:", err);
    try {
      return message.reply("Something went wrong.");
    } catch {
      return;
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    // Bot has switched to prefix commands.
    // Keep slash commands from breaking existing servers by responding with guidance.
    const msg = `✅ This bot now uses **${PREFIX}** prefix commands. Try **${PREFIX}help**.`;

    if (!interaction.inGuild()) {
      return interaction.reply({ content: msg, flags: 64 });
    }

    return interaction.reply({ content: msg, flags: 64 });
  } catch (err) {
    if (err?.code === 10062) {
      console.log("Ignored expired interaction.");
      return;
    }

    console.error("Command error:", err);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Something went wrong.");
    } else {
      await interaction.reply({
        content: "Something went wrong.",
        flags: 64,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
