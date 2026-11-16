#!/usr/bin/env node
/**
 * zedg-translate LSP server (hover-translation bubble for Zed).
 *
 * Protocol surface: initialize / initialized / shutdown / exit,
 * textDocument didOpen|didChange(full)|didClose, textDocument/hover.
 *
 * Behavior on hover:
 *   1. Extract the term under the cursor (English word or contiguous CJK run).
 *   2. Auto-detect direction: CJK present -> zh->en, else en->zh.
 *   3. Answer instantly from the translation memory when the term was
 *      translated before; otherwise call the LLM (OpenAI-compatible
 *      /chat/completions), falling back to bundled vocab books offline.
 *   4. Append the record to memory.jsonl and regenerate stats.md.
 *
 * All configuration arrives via ZEDG_TRANSLATE_* environment variables set
 * by the extension from settings.json (`lsp.zedg-translate.settings`).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration

const API_KEY = process.env.ZEDG_TRANSLATE_API_KEY || "";
const API_BASE = (process.env.ZEDG_TRANSLATE_API_BASE || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = process.env.ZEDG_TRANSLATE_MODEL || "deepseek-chat";
const BOOK_NAMES = (process.env.ZEDG_TRANSLATE_BOOKS || "gaokao,cet4,computing,ogden")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DATA_DIR =
  process.env.ZEDG_TRANSLATE_DATA_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "Zed", "zedg-translate");
const MEMORY_PATH = path.join(DATA_DIR, "memory.jsonl");
const STATS_PATH = path.join(DATA_DIR, "stats.md");

function log(...args) {
  console.error("[zedg-translate]", ...args);
}

// ---------------------------------------------------------------------------
// Vocabulary books (written next to this script by the extension)

const books = [];
for (const name of BOOK_NAMES) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "vocab", `${name}.json`), "utf8");
    const data = JSON.parse(raw);
    books.push({ id: name, label: data.name || name, words: data.words || {} });
    log(`loaded vocab book "${name}": ${Object.keys(data.words).length} words`);
  } catch (e) {
    log(`vocab book "${name}" unavailable: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Translation memory

/** key: `${dir}|${term.toLowerCase()}` -> { dst, count, lastTs } */
const memory = new Map();
let memoryLoaded = false;

function loadMemory() {
  if (memoryLoaded) return;
  memoryLoaded = true;
  try {
    const text = fs.readFileSync(MEMORY_PATH, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        const key = `${rec.dir}|${String(rec.src).toLowerCase()}`;
        const prev = memory.get(key);
        if (prev) {
          prev.count += 1;
          prev.lastTs = rec.ts > prev.lastTs ? rec.ts : prev.lastTs;
        } else {
          memory.set(key, { dst: rec.dst, count: 1, lastTs: rec.ts, lang: rec.lang, books: rec.books });
        }
      } catch {
        /* skip malformed line */
      }
    }
    log(`memory loaded: ${memory.size} unique terms`);
  } catch {
    log("memory file empty or missing; starting fresh");
  }
}

function memoryLookup(dir, term) {
  loadMemory();
  return memory.get(`${dir}|${term.toLowerCase()}`);
}

function record(src, dst, dir, lang, uri, bookTags) {
  const rec = {
    ts: new Date().toISOString(),
    src,
    dst,
    dir,
    lang: lang || "",
    file: uri ? decodeURIComponent(uri.split("/").pop() || "") : "",
    books: bookTags,
  };
  const key = `${dir}|${src.toLowerCase()}`;
  if (!dst || !String(dst).trim()) {
    log("skip empty record for", src);
    return;
  }
  loadMemory();
  const prev = memory.get(key);
  if (prev) {
    prev.count += 1;
    prev.lastTs = rec.ts;
    prev.dst = dst; // keep the freshest wording
  } else {
    memory.set(key, { dst, count: 1, lastTs: rec.ts });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFile(MEMORY_PATH, JSON.stringify(rec) + "\n", (e) => {
    if (e) log("memory append failed:", e.message);
  });
  scheduleStats();
}

// ---------------------------------------------------------------------------
// Stats (翻译本/记忆本 统计)

let statsScheduled = false;
function scheduleStats() {
  if (statsScheduled) return;
  statsScheduled = true;
  setTimeout(() => {
    statsScheduled = false;
    writeStats();
  }, 500);
}

function writeStats() {
  loadMemory();
  const byDay = new Map();
  const byTerm = new Map();
  const files = new Set();
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;

  try {
    const text = fs.readFileSync(MEMORY_PATH, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      total += 1;
      const day = String(rec.ts || "").slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
      const key = `${rec.dir}|${String(rec.src).toLowerCase()}`;
      const t = byTerm.get(key) || { src: rec.src, dst: rec.dst, count: 0, last: day };
      t.count += 1;
      if (day >= t.last) {
        t.last = day;
        t.dst = rec.dst;
      }
      byTerm.set(key, t);
      if (rec.file) files.add(rec.file);
    }
  } catch {
    /* no memory yet */
  }

  const lines = [];
  lines.push("# ZedG Translate 翻译统计");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}  `);
  lines.push(`记忆文件：${MEMORY_PATH}`);
  lines.push("");
  lines.push("## 概览");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---|");
  lines.push(`| 累计翻译 | ${total} 次 |`);
  lines.push(`| 唯一词句 | ${byTerm.size} 个 |`);
  lines.push(`| 今日 | ${byDay.get(today) || 0} 次 |`);
  lines.push(`| 涉及文件 | ${files.size} 个 |`);
  lines.push("");

  lines.push("## 最近 7 天");
  lines.push("");
  lines.push("| 日期 | 次数 |");
  lines.push("|---|---|");
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    lines.push(`| ${d} | ${byDay.get(d) || 0} |`);
  }
  lines.push("");

  lines.push("## 高频词句 Top 20");
  lines.push("");
  lines.push("| 词句 | 次数 | 最近译文 |");
  lines.push("|---|---|---|");
  const top = [...byTerm.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  for (const t of top) {
    lines.push(`| ${t.src.replace(/\|/g, "\\|")} | ${t.count} | ${(t.dst || "").replace(/\|/g, "\\|")} |`);
  }
  if (!top.length) lines.push("| - | - | - |");
  lines.push("");

  lines.push("## 词汇本覆盖（翻译范围）");
  lines.push("");
  lines.push("| 词汇本 | 总词数 | 已翻译 | 覆盖率 |");
  lines.push("|---|---|---|---|");
  for (const book of books) {
    const ids = new Set(Object.keys(book.words).map((w) => w.toLowerCase()));
    let hit = 0;
    for (const key of memory.keys()) {
      const term = key.split("|")[1];
      if (ids.has(term)) hit += 1;
    }
    const pct = ids.size ? ((hit / ids.size) * 100).toFixed(1) : "0.0";
    lines.push(`| ${book.label} | ${ids.size} | ${hit} | ${pct}% |`);
  }
  lines.push("");

  try {
    fs.writeFileSync(STATS_PATH, lines.join("\n"));
  } catch (e) {
    log("stats write failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Term extraction & language detection

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const CJK_EDGE = /[，。？！、；：（）「」『』《》""''…—\s]/;

function extractTerm(lineText, character) {
  const ch = Math.max(0, Math.min(character, lineText.length));
  const under = lineText[ch] || "";
  const before = lineText[ch - 1] || "";

  // English token: expand while word chars surround the cursor.
  if (/[A-Za-z0-9]/.test(under) || /[A-Za-z0-9]/.test(before)) {
    let s = ch;
    let e = ch;
    const isWord = (c) => /[A-Za-z0-9]/.test(c) || c === "'" || c === "-";
    while (s > 0 && isWord(lineText[s - 1])) s--;
    while (e < lineText.length && isWord(lineText[e])) e++;
    let word = lineText.slice(s, e).replace(/^['-]+|['-]+$/g, "");
    if (word && /[A-Za-z0-9]/.test(word) && word.length <= 60) {
      return { term: word, english: true, range: { start: { character: s }, end: { character: e } } };
    }
  }

  // Contiguous CJK run, capped at 20 chars centered on the cursor,
  // with surrounding punctuation trimmed.
  if (CJK.test(under) || CJK.test(before)) {
    let s = ch;
    let e = ch;
    const isCJKish = (c) => CJK.test(c) || /[A-Za-z0-9]/.test(c);
    while (s > 0 && isCJKish(lineText[s - 1])) s--;
    while (e < lineText.length && isCJKish(lineText[e])) e++;
    if (e - s > 20) {
      const center = ch;
      s = Math.max(s, center - 10);
      e = Math.min(e, s + 20);
    }
    while (s < e && CJK_EDGE.test(lineText[s])) s++;
    while (e > s && CJK_EDGE.test(lineText[e - 1])) e--;
    const term = lineText.slice(s, e).trim();
    if (term && CJK.test(term)) {
      return { term, english: false, range: { start: { character: s }, end: { character: e } } };
    }
  }
  return null;
}

function hasCJK(text) {
  return CJK.test(text);
}

// ---------------------------------------------------------------------------
// Vocab books lookup

function vocabLookup(term, english) {
  if (!english) return [];
  const lower = term.toLowerCase();
  const candidates = [lower];
  if (lower.endsWith("'s")) candidates.push(lower.slice(0, -2));
  if (lower.endsWith("s") && lower.length > 3) candidates.push(lower.slice(0, -1));
  const hits = [];
  for (const book of books) {
    for (const cand of candidates) {
      const entry = book.words[cand];
      if (entry && Array.isArray(entry.trans) && entry.trans.length) {
        hits.push({
          book: book.label,
          trans: entry.trans.slice(0, 3),
          phonetic: entry.phonetic || "",
        });
        break;
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// LLM translation (OpenAI-compatible /chat/completions)

const inflight = new Map(); // key -> Promise<markdown|null>

function systemPrompt(dir) {
  if (dir === "zh2en") {
    return [
      "你是汉英词典助手。用户给出一个中文词或短语。",
      '只输出 JSON：{"translations":[{"pos":"","text":"最常用英文译法"}],"example":{"en":"short example sentence","zh":"例句中文"}}',
      "translations 按常用程度排序，最多 3 条；pos 留空即可；例句要简短自然。不要输出其他内容。",
    ].join("\n");
  }
  return [
    "你是英汉词典助手。用户给出一个英文单词或短语。",
    '只输出 JSON：{"translations":[{"pos":"词性缩写如 n. / v. / adj. / prep.","text":"最常用中文释义"}],"phonetic":"美式IPA音标","example":{"en":"short example sentence","zh":"例句中文翻译"}}',
    "translations 按常用程度排序，最多 3 条；音标查不到时为空字符串；例句要简短自然。不要输出其他内容。",
  ].join("\n");
}

function parseLlmJson(content) {
  const trimmed = String(content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

async function llmTranslate(term, dir) {
  if (!API_KEY) return null;
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt(dir) },
        { role: "user", content: term },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: "json_object" },
      stream: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = parseLlmJson(content);
  if (!parsed || !Array.isArray(parsed.translations)) {
    throw new Error("LLM 返回无法解析");
  }
  return {
    translations: parsed.translations
      .filter((t) => t && t.text)
      .map((t) => ({ pos: t.pos || "", text: String(t.text) }))
      .slice(0, 3),
    phonetic: parsed.phonetic || "",
    example: parsed.example && parsed.example.en ? parsed.example : null,
  };
}

// ---------------------------------------------------------------------------
// Hover markdown rendering

function renderMarkdown({ term, dir, translation, phonetic, example, vocabHits, fromVocabOnly }) {
  const lines = [];
  const arrow = dir === "zh2en" ? "中 → 英" : "英 → 中";
  const title = `${term}　*\`${arrow}\`*`;
  lines.push(`### ${title}`);

  if (phonetic) lines.push(`/${phonetic.replace(/^\/|\/$/g, "")}/`);
  lines.push("");

  if (fromVocabOnly) {
    const first = vocabHits[0];
    lines.push(first.trans.map((t) => `**${t}**`).join("　"));
  } else if (translation) {
    lines.push(translation.translations.map((t) => `**${[t.pos, t.text].filter(Boolean).join(" ")}**`).join("　"));
  }

  if (vocabHits.length) {
    const tags = vocabHits.map((h) => `\`${h.book}\``).join(" ");
    lines.push("");
    lines.push(tags);
    if (fromVocabOnly) {
      for (const h of vocabHits.slice(1)) {
        lines.push(`- ${h.book}：${h.trans.join("；")}`);
      }
    }
  }

  if (example && example.en) {
    lines.push("");
    lines.push(`> ${example.en}`);
    lines.push(`> ${example.zh}`);
  }
  return lines.join("\n");
}

function configErrorMarkdown(term, dir) {
  return [
    `### ${term}　*\`${dir === "zh2en" ? "中 → 英" : "英 → 中"}\`*`,
    "",
    "⚠️ 未配置 LLM API Key，且记忆本/词汇本中无此词。",
    "",
    "在 `settings.json` 中添加：",
    "",
    "```json",
    '"lsp": {',
    '  "zedg-translate": {',
    '    "settings": { "api_key": "sk-你的DeepSeek密钥" }',
    "  }",
    "}",
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Hover pipeline

async function hoverMarkdown(term, english, lang, uri) {
  const dir = hasCJK(term) ? "zh2en" : "en2zh";

  // 1. Instant answer from memory.
  const memHit = memoryLookup(dir, term);
  if (memHit) {
    return renderMarkdown({
      term,
      dir,
      translation: { translations: [{ pos: "", text: memHit.dst }] },
      phonetic: "",
      example: null,
      vocabHits: vocabLookup(term, english),
    });
  }

  // 2. Vocab books work even without an API key.
  const vocabHits = vocabLookup(term, english);
  if (!API_KEY) {
    if (vocabHits.length) {
      record(term, vocabHits[0].trans.join("；"), dir, lang, uri, vocabHits.map((h) => h.book));
      return renderMarkdown({
        term,
        dir,
        translation: null,
        phonetic: vocabHits[0].phonetic,
        example: null,
        vocabHits,
        memHit: null,
        fromVocabOnly: true,
      });
    }
    return configErrorMarkdown(term, dir);
  }

  // 3. LLM.
  const llm = await llmTranslate(term, dir);
  const dst = llm.translations.map((t) => [t.pos, t.text].filter(Boolean).join(" ")).join("；");
  record(term, dst, dir, lang, uri, vocabHits.map((h) => h.book));
  return renderMarkdown({
    term,
    dir,
    translation: llm,
    phonetic: llm.phonetic,
    example: llm.example,
    vocabHits,
    memHit: memoryLookup(dir, term),
  });
}

function handleHover(params) {
  const doc = docs.get(params.textDocument.uri);
  if (!doc) return Promise.resolve(null);
  const { character, line } = params.position;
  const lineText = (doc.text.split("\n")[line] || "");
  const found = extractTerm(lineText, character);
  if (!found) return Promise.resolve(null);

  const { term, english } = found;
  const key = `${hasCJK(term) ? "zh2en" : "en2zh"}|${term.toLowerCase()}`;
  let p = inflight.get(key);
  if (!p) {
    p = hoverMarkdown(term, english, doc.lang, params.textDocument.uri)
      .catch((e) => {
        log("hover failed:", e.message);
        const vocabHits = vocabLookup(term, english);
        if (vocabHits.length) {
          return renderMarkdown({
            term,
            dir: key.split("|")[0],
            translation: null,
            phonetic: vocabHits[0].phonetic,
            example: null,
            vocabHits,
            memHit: null,
            fromVocabOnly: true,
          });
        }
        return `⚠️ 翻译失败：${e.message}`;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p.then((markdown) =>
    markdown
      ? {
          contents: { kind: "markdown", value: markdown },
          range: {
            start: { line, character: found.range.start.character },
            end: { line, character: found.range.end.character },
          },
        }
      : null,
  );
}

// ---------------------------------------------------------------------------
// Minimal LSP over stdio

const docs = new Map(); // uri -> { text, lang }

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const sep = buffer.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const header = buffer.slice(0, sep).toString("ascii");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      log("bad header:", header);
      buffer = Buffer.alloc(0);
      return;
    }
    const length = parseInt(m[1], 10);
    if (buffer.length < sep + 4 + length) return;
    const body = buffer.slice(sep + 4, sep + 4 + length).toString("utf8");
    buffer = buffer.slice(sep + 4 + length);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (e) {
      log("bad json:", e.message);
      continue;
    }
    dispatch(msg);
  }
});

process.stdin.on("end", () => {
  writeStats();
  process.exit(0);
});
process.on("SIGTERM", () => {
  writeStats();
  process.exit(0);
});
process.on("exit", writeStats);
process.on("uncaughtException", (e) => log("uncaught:", e.stack || e.message));

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n${body}`);
}

function reply(id, result, error) {
  send({ jsonrpc: "2.0", id, result: result === undefined ? null : result, ...(error ? { error } : {}) });
}

function dispatch(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        capabilities: {
          hoverProvider: true,
          textDocumentSync: { openClose: true, change: 1 },
        },
        serverInfo: { name: "zedg-translate", version: "0.1.0" },
      });
      break;
    case "initialized":
    case "$/cancelRequest":
    case "$/setTrace":
    case "workspace/didChangeConfiguration":
    case "workspace/didChangeWatchedFiles":
      break;
    case "shutdown":
      reply(id, null);
      break;
    case "exit":
      process.exit(0);
      break;
    case "textDocument/didOpen": {
      const td = params.textDocument;
      docs.set(td.uri, { text: td.text, lang: td.languageId || "" });
      break;
    }
    case "textDocument/didChange": {
      const uri = params.textDocument.uri;
      const doc = docs.get(uri);
      if (doc) {
        for (const change of params.contentChanges) {
          if (change.range === undefined && change.rangeLength === undefined) {
            doc.text = change.text; // full sync
          }
        }
      }
      break;
    }
    case "textDocument/didClose":
      docs.delete(params.textDocument.uri);
      break;
    case "textDocument/hover":
      handleHover(params)
        .then((result) => reply(id, result))
        .catch((e) => {
          log("hover error:", e.message);
          reply(id, null);
        });
      break;
    default:
      if (method) {
        if (id !== undefined) {
          reply(id, null, { code: -32601, message: `method not found: ${method}` });
        } else {
          log("ignored notification:", method);
        }
      }
      break;
  }
}

log(`starting (model=${MODEL}, base=${API_BASE}, books=[${BOOK_NAMES.join(",")}] key=${API_KEY ? "set" : "missing"})`);
