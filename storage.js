const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "league.json");

// Normalize team names to a stable key (lowercase, no punctuation/spaces)
function normalizeTeamName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s/g, "");
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return {
        teams: {},
        invites: {},
        players: {},       // { userId: { ign, registeredAt } }
        matchRequests: {}, // { requestId: { ... } }
        matches: {},       // { matchId: { ... } }
        scrims: { posts: [] }, // LFT/LFP posts
      };
    }

    const raw = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(raw || "{}");

    db.teams = db.teams || {};
    db.invites = db.invites || {};
    db.players = db.players || {};
    db.matchRequests = db.matchRequests || {};
    db.matches = db.matches || {};
    db.scrims = db.scrims || { posts: [] };
    db.scrims.posts = db.scrims.posts || [];

    return db;
  } catch (err) {
    console.error("❌ Failed to load league.json:", err);
    return {
      teams: {},
      invites: {},
      players: {},
      matchRequests: {},
      matches: {},
      scrims: { posts: [] },
    };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Failed to save league.json:", err);
  }
}

module.exports = { loadDB, saveDB, normalizeTeamName };