const fs = require("fs");
const path = require("path");

const SAVE_FILE = path.join(__dirname, "..", "main-bot", "rooms.json");

function ensureFile() {
  if (!fs.existsSync(SAVE_FILE)) {
    fs.writeFileSync(SAVE_FILE, "[]");
  }
}

function saveRooms(rooms) {
  ensureFile();

  const data = [...rooms.entries()].map(([id, room]) => [
    id,
    {
      ...room,
      watchers: [...room.watchers],
      waitingUsers: [...room.waitingUsers.entries()]
    }
  ]);

  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

function loadRooms() {
  ensureFile();

  const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  const rooms = new Map();

  for (const [id, room] of raw) {
    rooms.set(id, {
      ...room,
      watchers: new Set(room.watchers || []),
      waitingUsers: new Map(room.waitingUsers || [])
    });
  }

  return rooms;
}

module.exports = { saveRooms, loadRooms };
