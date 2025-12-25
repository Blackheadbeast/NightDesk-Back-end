const conversations = new Map();

// Auto-expire after 24 hours
const TTL_MS = 24 * 60 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, value] of conversations.entries()) {
    if (now - value.updatedAt > TTL_MS) {
      conversations.delete(key);
    }
  }
}

export function getMemory(phone) {
  cleanup();

  if (!conversations.has(phone)) {
    conversations.set(phone, { lines: [], updatedAt: Date.now() });
  }

  const convo = conversations.get(phone);
  convo.updatedAt = Date.now();
  return convo.lines;
}

export function addToMemory(phone, line) {
  const mem = getMemory(phone);
  mem.push(line);
  if (mem.length > 20) mem.splice(0, mem.length - 20);
}
