'use strict';

// Reads the session transcript and the per subagent transcripts to work out what
// is running right now.
//
// The transcript is the authority on liveness. A tool call that has no result yet
// means work is in flight. That is exact, unlike guessing from how long the file
// has been quiet, which reads a five minute Bash call as an idle session.

const fs = require('fs');
const path = require('path');

const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 16 * 1024;
const MAX_AGENT_FILES = 8;

function parseTs(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// One pass over the session transcript. Returns token totals (so the water figure
// does not need a second read), plus turn and liveness state.
function scanTranscript(transcriptPath) {
  const out = {
    totals: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
    turnStartMs: 0,
    lastActivityMs: 0,
    pendingTools: 0,
    pendingAgents: 0,
  };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return out;

  let text = '';
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (e) {
    return out;
  }

  const pendingTools = new Set();
  const pendingAgents = new Set();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (obj.isSidechain) continue;

    const ts = obj.timestamp ? parseTs(obj.timestamp) : 0;
    if (ts) out.lastActivityMs = Math.max(out.lastActivityMs, ts);

    const msg = obj.message || {};
    const usage = msg.usage;
    if (usage) {
      out.totals.input += usage.input_tokens || 0;
      out.totals.cacheCreation += usage.cache_creation_input_tokens || 0;
      out.totals.cacheRead += usage.cache_read_input_tokens || 0;
      out.totals.output += usage.output_tokens || 0;
    }

    const content = msg.content;
    let isToolResultOnly = false;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use') {
          pendingTools.add(block.id);
          if (block.name === 'Agent' || block.name === 'Task') pendingAgents.add(block.id);
        } else if (block.type === 'tool_result') {
          isToolResultOnly = true;
          pendingTools.delete(block.tool_use_id);
          pendingAgents.delete(block.tool_use_id);
        }
      }
    }

    // A fresh user turn means anything still dangling was interrupted, not running.
    // Without this an aborted turn would leave the timer claiming work forever.
    if (obj.type === 'user' && !obj.isMeta && !isToolResultOnly) {
      pendingTools.clear();
      pendingAgents.clear();
      if (ts) out.turnStartMs = ts;
    }
  }

  out.pendingTools = pendingTools.size;
  out.pendingAgents = pendingAgents.size;
  return out;
}

function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString('utf8');
  } catch (e) {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {}
  }
}

function readTail(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.slice(0, n).toString('utf8');
  } catch (e) {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {}
  }
}

// Start time sits on the very first line. The agent type and the real model only
// appear on assistant lines further in, and the second line is often a huge tool
// listing attachment, so the head alone is not enough. Read both ends instead of
// the whole file, which can be megabytes.
function readAgentFile(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return null;
  }
  const info = { file: file, mtimeMs: st.mtimeMs, startMs: 0, agentType: '', model: '' };

  const head = readHead(file, HEAD_BYTES);
  const firstLine = head.split('\n', 1)[0];
  try {
    const o = JSON.parse(firstLine);
    info.startMs = parseTs(o.timestamp);
  } catch (e) {
    // fall through, an unreadable first line just means no start time
  }

  const tail = readTail(file, st.size, TAIL_BYTES);
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch (e) {
      continue; // a tail read almost always starts mid line
    }
    if (!info.agentType && o.attributionAgent) info.agentType = o.attributionAgent;
    const m = o.message && o.message.model;
    if (!info.model && m && m !== '<synthetic>') info.model = m;
    if (info.agentType && info.model) break;
  }
  return info;
}

function subagentsDir(transcriptPath) {
  if (!transcriptPath) return '';
  const dir = path.dirname(transcriptPath);
  const id = path.basename(transcriptPath).replace(/\.jsonl$/, '');
  return path.join(dir, id, 'subagents');
}

// The transcript says how many agents are live. The files say which ones they are.
// Newest start wins, because agents are spawned in order.
function runningAgents(transcriptPath, count) {
  if (!count) return [];
  const dir = subagentsDir(transcriptPath);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
  } catch (e) {
    return [];
  }
  const infos = files
    .map((f) => {
      let st;
      try {
        st = fs.statSync(path.join(dir, f));
      } catch (e) {
        return null;
      }
      return { file: path.join(dir, f), mtimeMs: st.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_AGENT_FILES)
    .map((x) => readAgentFile(x.file))
    .filter((x) => x && x.startMs);

  infos.sort((a, b) => b.startMs - a.startMs);
  return infos.slice(0, count);
}

module.exports = {
  scanTranscript,
  readAgentFile,
  runningAgents,
  subagentsDir,
  readHead,
  readTail,
};
