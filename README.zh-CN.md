# Hover Translate

Zed 翻译扩展：在原生 hover 气泡里做中英互译，可接入任意 OpenAI 兼容 LLM，带本地翻译记忆本和离线词汇本。

## 功能

| 需求 | 实现方式 |
|---|---|
| 中英互译 | 自动识别：光标处含中文 → 中→英，否则 英→中 |
| 气泡翻译 | LSP hover 弹窗（Zed 原生 hover UI） |
| LLM 接入 | OpenAI 兼容 `/chat/completions`（默认 DeepSeek），key 配置在 settings.json |
| 翻译记忆本 | `memory.jsonl` 逐条记录；`stats.md` 生成统计（总量/近 7 天/高频词句/词本覆盖率） |
| 词汇本（可选） | 内置高考 3743 / 四级 4544 / 计算机 260 / Ogden 850 词 |

优先级：**记忆本命中 → 秒回**（不发请求）；**无 key 时词汇本仍可离线翻译**；否则调用 LLM。

## 安装

- 扩展市场：在 Zed 的 Extensions 面板搜索 `Hover Translate` 安装。
- 开发调试：命令面板 → `zed: install dev extension` → 选择本目录（需要 rustup，Zed 会自动安装 `wasm32-wasip2` target）。

语言服务器本体不打包进扩展，首次使用时从本仓库的 GitHub Release 下载并缓存到扩展工作目录。

## 配置

在 `~/.config/zed/settings.json` 中添加：

```json
{
  "lsp": {
    "hover-translate-lsp": {
      "settings": {
        "api_key": "sk-你的密钥",
        "api_base": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "books": ["gaokao", "cet4", "computing"]
      }
    }
  }
}
```

- `api_base` / `model` 换成其他 OpenAI 兼容服务即可（如智谱 `https://open.bigmodel.cn/api/paas/v4` + `glm-4-flash`）。
- `books` 可选 `gaokao`、`cet4`、`computing`、`ogden`，默认全部启用。
- `data_dir` 可选，绝对路径。默认记忆本放在扩展工作目录，扩展更新时可能被替换；想让记忆长期保留、并方便找到 `stats.md`，建议显式指定。
- `binary` 可选，用自己的服务器副本替代下载版本。

改完配置后执行 `editor: restart language servers` 生效。

## 使用

光标停在英文单词或中文词组上（普通 Zed 下无需选中），hover 气泡显示：

```
### abandon　*`EN → ZH`*
/əˈbændən/
**v. 放弃**　**n. 放任；狂热**
`Gaokao` `CET-4`
> The plan was abandoned.  计划被放弃了。
```

译文内容本身是中文/英文，界面文案为英文。

统计文件包含累计翻译次数、唯一词句数、近 7 天趋势、高频词句 Top 20、各词汇本覆盖率。

## 挂载语言

`extension.toml` 的 `languages = [...]` 决定 hover 翻译生效的语言（已覆盖 Markdown/Python/Rust/Go/TS/JSON/YAML/TOML 等 44 种）。修改后重新安装扩展即可。

## 语言服务器如何分发

扩展市场不允许把语言服务器打包进扩展二进制。`src/lib.rs` 会从 `v<version>` tag 的 Release 下载 `hover-translate-lsp.zip` 到扩展工作目录的 `lsp/`，再用 Zed 自带的 Node 启动。Release 由 `.github/workflows/release.yml` 生成；本地打包用 `./scripts/package-lsp.sh`。

## 目录结构

```
extension.toml                  # 扩展清单（language_servers 挂载）
src/lib.rs                      # WASM 扩展：下载服务器、读配置、返回 node 启动命令
server/hover-translate-lsp.js   # LSP server（无依赖，运行于 Zed 自带 Node）
vocab/*.json                    # 词汇本数据
scripts/gen_vocab.py            # 词表再生成
scripts/e2e.js                  # E2E 测试（mock LLM 驱动 LSP 全流程）
scripts/package-lsp.sh          # 生成本地 Release 资产
```

## 测试

```sh
node scripts/e2e.js   # mock LLM，验证 hover→翻译→记忆→统计 全链路
```

## 已知限制

- **普通 Zed**：LSP hover 请求不携带选区信息，光标停留即弹气泡，翻译光标处的词或短语。
- **ZedG fork**：宿主若发送 `zedg/selectionChanged` 通知（见 `fork/`），则只有 hover 在非空选区内时弹气泡并翻译整段选中文本；未发送该通知的环境自动退回普通 hover 模式。
- 首次翻译需等 LLM 响应（约 1~3 s）；同一词句第二次起从记忆本秒回。
- 统计在翻译后 500ms 防抖写入。

## 隐私

只会把光标处的词/短语（或选中文本）和翻译方向发送到你配置的 `api_base`。记忆本、词表与统计都保存在本地，扩展没有遥测。

## 许可

MIT
