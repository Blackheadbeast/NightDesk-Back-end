const calls = new Map(); // key = CallSid, value = { lines: [], updatedAt }

// Auto-expire after 2 hours (more than enough for calls)
const TTL_MS = 2 * 60 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, value] of calls.entries()) {
    if (now - value.updatedAt > TTL_MS) {
      calls.delete(key);
    }
  }
}

export function getCallMemory(callSid) {
  cleanup();

  if (!calls.has(callSid)) {
    calls.set(callSid, { lines: [], updatedAt: Date.now() });
  }

  const call = calls.get(callSid);
  call.updatedAt = Date.now();
  return call.lines;
}

export function addCallMemory(callSid, line) {
  const mem = getCallMemory(callSid);
  mem.push(line);
  if (mem.length > 30) mem.splice(0, mem.length - 30);
}
