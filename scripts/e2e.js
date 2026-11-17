#!/usr/bin/env node
/** E2E: mock LLM + drive the hover-translate LSP server over stdio. */
"use strict";
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TEST_DIR = "/tmp/zedg-test/server";
const DATA_DIR = "/tmp/zedg-test/data";
fs.rmSync("/tmp/zedg-test", { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
fs.copyFileSync(path.join(__dirname, "../server/hover-translate-lsp.js"), path.join(TEST_DIR, "hover-translate-lsp.js"));
fs.cpSync(path.join(__dirname, "../vocab"), path.join(TEST_DIR, "vocab"), { recursive: true });

// --- mock LLM -------------------------------------------------------------
const llm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body);
    const user = msg.messages.find((m) => m.role === "user").content;
    const hasCjk = /[\u4e00-\u9fff]/.test(user);
    const out = hasCjk
      ? { translations: [{ pos: "", text: `MOCK-EN(${user})` }], example: { en: `mock example for ${user}`, zh: "例句" } }
      : { translations: [{ pos: "v.", text: `MOCK-ZH(${user})` }, { pos: "n.", text: `MOCK-ZH2(${user})` }], phonetic: "/mɒk/", example: { en: `mock example for ${user}`, zh: "模拟例句" } };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
llm.listen(9876);

// --- LSP client -----------------------------------------------------------
function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

const server = spawn(process.execPath, [path.join(TEST_DIR, "hover-translate-lsp.js")], {
  env: {
    ...process.env,
    HOVER_TRANSLATE_API_KEY: "test-key",
    HOVER_TRANSLATE_API_BASE: "http://127.0.0.1:9876",
    HOVER_TRANSLATE_MODEL: "mock-model",
    HOVER_TRANSLATE_DATA_DIR: DATA_DIR,
  },
});
let buf = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;
server.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
server.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const len = parseInt(buf.slice(0, sep).toString().match(/Content-Length:\s*(\d+)/)[1], 10);
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.slice(sep + 4, sep + 4 + len).toString("utf8"));
    buf = buf.slice(sep + 4 + len);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
  });
}
function notify(method, params) {
  server.stdin.write(frame({ jsonrpc: "2.0", method, params }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PY_DOC = "uri-demo-doc";
const text = [
  "# demo",
  "We should abandon this plan immediately.",
  "这是测试中文句子",
  "curiosity killed the cat.",
].join("\n");

async function main() {
  const init = await request("initialize", { capabilities: {} });
  console.log("== initialize ==");
  console.log(JSON.stringify(init.result.capabilities));
  notify("initialized", {});
  notify("textDocument/didOpen", {
    textDocument: { uri: PY_DOC, languageId: "python", text, version: 1 },
  });

  // 1. English word -> LLM (en2zh)
  let r = await request("textDocument/hover", {
    textDocument: { uri: PY_DOC },
    position: { line: 1, character: 11 },
  });
  console.log("\n== hover 'abandon' (en2zh, LLM) ==");
  console.log(r.result.contents.value);

  // 2. same word again -> memory hit (no new LLM call)
  r = await request("textDocument/hover", {
    textDocument: { uri: PY_DOC },
    position: { line: 1, character: 12 },
  });
  console.log("\n== hover 'abandon' again (memory) ==");
  console.log(r.result.contents.value);

  // 3. CJK run -> zh2en
  r = await request("textDocument/hover", {
    textDocument: { uri: PY_DOC },
    position: { line: 2, character: 4 },
  });
  console.log("\n== hover 中文 (zh2en) ==");
  console.log(r.result.contents.value);

  // 4. vocab-only path: no API key
  const server2 = spawn(process.execPath, [path.join(TEST_DIR, "hover-translate-lsp.js")], {
    env: { ...process.env, HOVER_TRANSLATE_DATA_DIR: DATA_DIR }, // no key
  });
  server2.stderr.on("data", (d) => process.stderr.write(`[srv2] ${d}`));
  let b2 = Buffer.alloc(0);
  const pending2 = new Map();
  let nextId2 = 1;
  server2.stdout.on("data", (d) => {
    b2 = Buffer.concat([b2, d]);
    for (;;) {
      const sep = b2.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const len = parseInt(b2.slice(0, sep).toString().match(/Content-Length:\s*(\d+)/)[1], 10);
      if (b2.length < sep + 4 + len) return;
      const msg = JSON.parse(b2.slice(sep + 4, sep + 4 + len).toString("utf8"));
      b2 = b2.slice(sep + 4 + len);
      if (msg.id && pending2.has(msg.id)) {
        pending2.get(msg.id)(msg);
        pending2.delete(msg.id);
      }
    }
  });
  const request2 = (method, params) =>
    new Promise((resolve) => {
      const id = nextId2++;
      pending2.set(id, resolve);
      server2.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
    });

  await request2("initialize", { capabilities: {} });
  server2.stdin.write(
    frame({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri: "uri-doc2", languageId: "python", text: "the result is important\n这是中文", version: 1 },
      },
    })
  );
  const r2 = await request2("textDocument/hover", {
    textDocument: { uri: "uri-doc2" },
    position: { line: 0, character: 17 },
  });
  console.log("\n== hover 'important' without API key (vocab hit) ==");
  console.log(r2.result && r2.result.contents ? r2.result.contents.value : "(no hover)");

  // 'result' is in computing.json? maybe not; use a word from cet4: 'abandon' / 'curiosity'? curiosity in cet4?
  // 5. ZedG fork mode: selection-driven hover
  notify("zedg/selectionChanged", { uri: PY_DOC, text: "abandon the plan" });
  await sleep(100);
  r = await request("textDocument/hover", {
    textDocument: { uri: PY_DOC },
    position: { line: 1, character: 12 },
  });
  console.log("\n== fork mode: hover with selection 'abandon the plan' ==");
  console.log(r.result && r.result.contents ? r.result.contents.value : "(no hover)");

  notify("zedg/selectionChanged", { uri: PY_DOC, text: null });
  await sleep(100);
  r = await request("textDocument/hover", {
    textDocument: { uri: PY_DOC },
    position: { line: 1, character: 12 },
  });
  console.log("\n== fork mode: hover without selection ==");
  console.log(r.result === null ? "null (correct: no bubble)" : JSON.stringify(r.result));

  server2.kill();
  llm.close();
  server.kill();
  await sleep(300);

  console.log("\n== memory.jsonl ==");
  console.log(fs.readFileSync(path.join(DATA_DIR, "memory.jsonl"), "utf8").trim());
  // stats.md is written with a 500ms debounce; wait for it
  for (let i = 0; i < 20 && !fs.existsSync(path.join(DATA_DIR, "stats.md")); i++) {
    await sleep(100);
  }
  console.log(fs.readFileSync(path.join(DATA_DIR, "stats.md"), "utf8").split("\n").slice(0, 34).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
