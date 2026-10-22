# naiwa-laugh

让 [奶蛙桌宠](https://github.com/yugh6/Naiwa) 在 **DeepSeek Harness (DSH)** 每轮回答结束时捧腹大笑一次的插件。

> 本项目**不包含**奶蛙桌宠的 exe、`素材.nwp`、音频或任何形象素材——那些版权归原作者所有，请自行获取。本插件只负责「在正确的时机给桌宠发个消息」。

## 效果

DSH 一打开 → 奶蛙自动出现在桌面上（已经在运行就不动它）。
每轮 agent 回答结束 → 奶蛙播放约 14 秒的捧腹大笑，然后自己站起来。

- 桌宠没在运行时，插件会尝试自动把它拉起来
- 3 秒防抖，连续触发不会叠加
- 任何失败都只写日志，**不会影响回答本身**

不想让它开机就出现的话，在配置里加 `"startOnLoad": false`。

## 已知限制

- 子 agent（subagent）结束时也会触发一次，因为 harness 的 `agent/turn-stopping` 不带 agent 信息。3 秒防抖会压掉紧挨着的重复触发。
- 只支持 Windows：靠窗口消息和 PowerShell 触发。

## 环境要求

- Windows 10 / 11
- DSH Desktop（`dsh` 内核 0.2.x）
- 奶蛙桌宠（原作者 [yugh6](https://github.com/yugh6)，抖音：握石竹）

## 安装

### 从 GitHub 安装

```powershell
dsh plugin --profile desktop add github:bbtnoctrl/dsh-naiwa
```

### 从本地目录安装（开发/自用）

```powershell
dsh plugin --profile desktop add C:\path\to\naiwa-laugh
```

装完**重启 DSH**（完全退出再打开）。

## 配置（多数情况不用管）

插件会**自动寻找**奶蛙桌宠，判定方式是「目录里有没有 `素材.nwp`」——所以就算你把 exe 改了名也能认出来。

搜索范围：

| 位置 | 深度 |
|---|---|
| `D:\` `E:\` `F:\` `G:\`（盘根） | 3 层 |
| `下载` / `桌面` / `文档` | 3 层 |
| 用户目录 | 2 层 |
| `C:\` | 2 层 |

上限 3000 个目录、8 秒，**在后台异步跑，不阻塞 DSH 启动**。找到后会把路径写进配置文件，以后直接读，不再扫描。

如果同时放了多个桌宠（比如同一源码改出来的变体），会**优先选名字带「奶蛙」的那个**。

### 扫不到的几种情况

- 放在 `C:\Program Files\` 里，或 `C:\` 下超过 2 层
- 放在没列出来的盘（比如 H 盘）
- 整个文件夹在 OneDrive 同步目录里
- `素材.nwp` 被删掉或改名了

这时手动指定即可。创建 `%USERPROFILE%\.dsh\naiwa-laugh.json`：

```json
{
  "exePath": "C:\\Users\\你的用户名\\Downloads\\Naiwa-main\\Naiwa-main\\奶蛙桌宠.exe"
}
```

> 路径要写到 **exe 本身**，不是文件夹。也可以用正斜杠：`"C:/Users/.../奶蛙桌宠.exe"`。

同一份配置里还能加：

| 字段 | 默认 | 作用 |
|---|---|---|
| `exePath` | 自动探测 | 桌宠 exe 的完整路径 |
| `startOnLoad` | `true` | DSH 启动时是否自动把桌宠叫起来 |

也可以在 profile 的 `cordis.patch.yml` 里用 `config.exePath` 覆盖（优先级更高）。

## 兼容性

插件对两种桌宠都能用：

| 桌宠版本 | 触发方式 |
|---|---|
| 官方原版 | 模拟两次快速点击（原版靠这个判定双击）；笑完 15 秒再补一次点击让它站起来 |
| 打过 `--laugh` 补丁的版本 | 直接发 `WM_APP+3`，响应更快，桌宠自己会在笑完 3 秒后站起 |

判断方式是自动的：先发消息，700ms 后查状态，没在笑就回落到模拟点击。

> 补丁版的原版源码在 [yugh6/Naiwa](https://github.com/yugh6/Naiwa) 的 `源码/Naiwa.cs`，加约 10 行即可（`Main` 里加 `--laugh` 分支 + `WndProc` 里加一条消息处理）。

## 排错

日志：`%USERPROFILE%\.dsh\naiwa-laugh.log`

| 日志停在 | 含义 |
|---|---|
| 没有 `plugin loaded` | 插件没挂载，检查 `dsh plugin list` 和 bundles 列表 |
| 没有 `trigger via` | 事件没到，确认 DSH 版本有 `agent/turn-stopping` 接缝 |
| `auto-detect: no pet exe found` | 扫描没找到桌宠，按上面「扫不到的几种情况」手填 `exePath` |
| `exePath not configured` | 同上，配置文件里还没写路径 |
| `pet window did not appear` | exe 路径错；或者你装的是**别的变体桌宠**（窗口标题不是 `NaiwaDesktop.Source.v1`），本插件只驱动奶蛙 |
| `trigger sent but state=` | 桌宠收到了但没进入大笑，可能窗口标题变了 |

## 卸载

```powershell
dsh plugin --profile desktop remove naiwa-laugh
```

然后重启 DSH。

## 许可

插件代码 MIT。奶蛙桌宠及其素材的版权归原作者 yugh6，本项目不声称任何权利，也不分发其任何文件。

---

## English

A DSH plugin that makes the **Naiwa desktop pet** laugh once whenever an agent turn ends, and brings it up as soon as DSH starts.

It ships **no** pet binary or artwork — you install the pet yourself from its original author. The plugin only sends window messages to it.

```powershell
dsh plugin --profile desktop add github:bbtnoctrl/dsh-naiwa
```

The plugin auto-detects the pet by looking for a folder that contains `素材.nwp` (so a renamed exe still works): drive roots `D:`–`G:` and `Downloads`/`Desktop`/`Documents` down to 3 levels, `C:\` to 2. Up to 3000 folders / 8 s, in the background. When several pets are present it prefers the one named 奶蛙.

If it cannot find yours, create `%USERPROFILE%\.dsh\naiwa-laugh.json`:

```json
{ "exePath": "C:\\...\\奶蛙桌宠.exe", "startOnLoad": true }
```

Then restart DSH. Works with both the stock pet (synthetic double-click) and a patched build that understands `WM_APP+3` (detected automatically). Logs to `%USERPROFILE%\.dsh\naiwa-laugh.log`.
