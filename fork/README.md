# ZedG fork 改动：选中后才弹翻译气泡

`zedg-selection-hover.patch` 可直接 `git apply` 到 ZedG v1.28.1 源码包
（`zedg-zh-cn-source-v1.28.1.tar.gz`，已含汉化补丁）。

## 改动内容

| 文件 | 改动 |
|---|---|
| `crates/editor/src/hover_popover.rs` | `show_hover` 时判断 hover 位置是否在非空选区内，把选中文本（或空）经 `zedg/selectionChanged` 通知发给 zedg-translate server，随后才发 hover 请求 |
| `crates/project/src/project.rs` | 新增 `Project::notify_zedg_selection` |
| `crates/project/src/lsp_store.rs` | 新增 `LspStore::notify_zedg_selection`：找到 buffer 的 zedg-translate server，FIFO 发送通知 |
| `crates/project/src/lsp_command.rs` | 定义 `zedg/selectionChanged` 通知（uri + text） |

## 行为

- 选中文本（拖选/双击）→ 鼠标停在该选区内 → 气泡翻译**整段选中文本**
- 无选区 / hover 在选区外 → server 收到空通知 → 不弹气泡
- 旧环境（未打补丁的 Zed）不会发该通知 → 扩展自动退回逐词 hover 模式

## 应用与构建

```sh
# 1. 解压源码包并打补丁
tar -xzf zedg-zh-cn-source-v1.28.1.tar.gz zed-src && cd zed-src
git apply /path/to/zedg-selection-hover.patch

# 2. 构建（rust-toolchain.toml 钉住 1.98.1，rustup 会自动安装）
RELEASE_CHANNEL=stable cargo build --release --package zed --package cli \
  --target aarch64-apple-darwin

# 3. 组装 .app（复用 ZedG 98-macos-release.yml 的打包段：Info.plist = dev.zed.ZedG）
```

验证：`cargo check -p project -p editor` 通过（1.98.1）。
