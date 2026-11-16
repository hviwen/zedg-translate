# ZedG Translate

Zed / ZedG 翻译扩展：hover 气泡中英互译 + LLM 接入 + 翻译记忆本 + 词汇本统计。

## 功能

| 需求 | 实现方式 |
|---|---|
| 中英互译 | 自动识别：光标处含中文 → 中→英，否则 英→中 |
| 气泡翻译 | LSP hover 弹窗：光标停留即显示翻译气泡（Zed 原生 hover UI） |
| LLM 接入 | OpenAI 兼容 `/chat/completions`（默认 DeepSeek），key 配置在 settings.json |
| 翻译记忆本 | `memory.jsonl` 逐条记录；`stats.md` 生成统计（总量/近 7 天/高频词句） |
| 词汇本（可选） | 内置高考 3743 / 四级 4544 / 计算机 260 / Ogden 850 词；气泡内打标签，统计页显示覆盖率 |

优先级：**记忆本命中 → 秒回**（不发请求）；**无 key 时词汇本仍可离线翻译**；否则调用 LLM。

## 安装

前置：rustup（`wasm32-wasip2` target 已包含）。构建与运行由 Zed 完成。

1. 在 ZedG 中打开命令面板（`cmd-p`）→ `zed: install dev extension` → 选择本目录。
2. 在 `~/.config/zed/settings.json` 中添加：

```json
{
  "lsp": {
    "zedg-translate": {
      "settings": {
        "api_key": "sk-你的DeepSeek密钥",
        "api_base": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "books": ["gaokao", "cet4", "computing"]
      }
    }
  }
}
```

- `api_base`/`model` 换成其他 OpenAI 兼容服务即可（如智谱 `https://open.bigmodel.cn/api/paas/v4` + `glm-4-flash`）。
- 改完配置后执行 `editor: restart language servers` 生效。

## 使用

光标停在英文单词或中文词组上（不用选中），hover 气泡显示：

```
### abandon　*`英 → 中`*
/əˈbændən/
**v. 放弃**　**n. 放任；狂热**
`高考词汇` `大学英语四级词汇`
> The plan was abandoned.  计划被放弃了。
```

默认词本：`gaokao`、`cet4`、`computing`、`ogden`（Ogden 850 基础英语，来自 ogden.munch.love）。

查看统计：打开数据目录下的 `stats.md`：

```
~/Library/Application Support/Zed/zedg-translate/memory.jsonl   # 记忆本（JSONL，可 grep）
~/Library/Application Support/Zed/zedg-translate/stats.md      # 统计（每次翻译后自动更新）
```

统计包含：累计翻译次数、唯一词句数、近 7 天趋势、高频词句 Top 20、各词汇本覆盖率（已翻译词数 ÷ 总词数）。

## 挂载语言

`extension.toml` 的 `languages = [...]` 决定 hover 翻译生效的语言（已覆盖 Markdown/Python/Rust/Go/TS/JSON/TOML 等 44 种）。增加语言后重新安装 dev 扩展即可。

## 目录结构

```
extension.toml                  # 扩展清单（language_servers 挂载）
src/lib.rs                      # WASM 扩展：写资源文件、读配置、返回 node 启动命令
server/zedg-translate-lsp.js    # LSP server（无依赖，运行于 Zed 自带 Node 22）
vocab/*.json                    # 词汇本数据
scripts/gen_vocab.py            # 词表再生成（kajweb/dict、Wei-Xia/MIT 数据源）
scripts/e2e.js                  # E2E 测试（mock LLM 驱动 LSP 全流程）
```

## 测试

```sh
node scripts/e2e.js   # mock LLM，验证 hover→翻译→记忆→统计 全链路
```

## 已知限制

- **hover 触发（普通 Zed）**：光标/鼠标停留即显示气泡——Zed 扩展 API 无编辑器 UI 能力，LSP hover 请求不携带选区信息。
- **ZedG fork 模式（推荐）**：ZedG 源码已内置 `zedg/selectionChanged` 通知（见下），此时交互变为**只有选中文本后 hover 才弹出气泡，翻译整段选中文本**；未选中时 hover 不弹。未收到该通知的旧环境自动退回普通 hover 模式。
- 首次翻译需等 LLM 响应（约 1~3 s）；同一词句第二次起从记忆本秒回。
- 统计在翻译后 500ms 防抖写入，进程退出时 flush。

### ZedG fork 改动（已合入 ZedG 源码）

| 文件 | 改动 |
|---|---|
| `crates/editor/src/hover_popover.rs` | hover 时若位置在非空选区内，把选中文本经 `Project::notify_zedg_selection` 发给 zedg-translate server；否则发送空选区 |
| `crates/project/src/project.rs` | `notify_zedg_selection` 公开包装 |
| `crates/project/src/lsp_store.rs` | `notify_zedg_selection`：定位 buffer 的 zedg-translate server 并发送 FIFO 通知 |
| `crates/project/src/lsp_command.rs` | `zedg/selectionChanged` 自定义通知定义 |

## 测试
