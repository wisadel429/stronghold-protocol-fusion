# 第三期「规程」（act3autochess）版本接入清单

日期：2026-11-08
状态：`shared/versions.js` 已登记 `act3autochess`；`data/versions/act3autochess/` 等待解包数据。
数据未到位前：服务端会警告该版本目录不可读并**暂时禁用**，大厅版本切换中不会出现；不影响第二期。

## 1. 解包文件 → 游戏内放置位置

| 解包内容 | 放这里 | 说明 |
| --- | --- | --- |
| gamedata 表格（activity / character / skill / enemy / stage / item 等 JSON） | 由转换脚本生成到 `data/versions/act3autochess/` | 需要与 `data/versions/act1autochess/` 相同的文件集：`config.json`、`chess.json`、`bonds.json`、`items.json`、`enemies.json`、`stages.json`、`waves.json`、`bosses.json`、`effects.json`、`choices.json`、`bands.json`、`factions.json`、`garrisons.json`、`tokens.json`、`backups.json`、`tuning.json` 等；`config.version.id` 必须是 `act3autochess`。 |
| 地图场景 / 关卡预制体 | `data/versions/act3autochess/` 的 `stages.json` 引用 | 关卡 id 形如 `level_act3autochess_mNN`；先落表，再看本作是否需要预制体资源。 |
| 小地图预览 | `public/assets/...`（按 `assets.json` 的 UI 键） | 官方路径 `arts/ui/stage/mappreviews/act3autochess_mNN_sub_0X.ab`，转成 webp/png 后登记清单。 |
| 大厅/战斗 UI 贴图 | `public/assets/...` | 官方路径 `ui/autochess/[uc]autochessouter / battle / common / templateshop`。 |
| 新皮肤（Closure / Iron 变体） | `public/assets/...` + `data/assets.json` 的 `chars[].skins` | 与皮肤内置同一套机制。 |
| BGM（`m_boss1/m_boss2/m_sys_act3autochess`） | `public/assets/.../audio/bgm/` + `data/assets.json` 的 `audio.bgm` | 版本声音按清单解析。 |
| 391 条 UI 原文 | 已归档 `docs/reference/act3-strings.md` | 用来补第三期文案。 |

## 2. 版本数据要求

- `data/versions/act3autochess/config.json` 里的 `version.id` = `act3autochess`，否则服务端判为「数据缺失」。
- 数据文件集必须齐全（参考 `data/versions/act1autochess/`）；服务端按 `VERSION_DATA_FILES` 校验并算内容哈希。
- 构建完成后启动服务器，`/healthz` 的 `versions.enabled` 应包含 `act3autochess`，大厅右上角版本切换出现「第三期·规程」。
- 若目录为空：日志出现 `[versions] ... act3autochess ...` 警告并禁用，属正常等待状态。

## 3. 版本切换

- 默认仍是第二期下半（`DEFAULT_VERSION = act2autochess`）。
- 启用：默认 `SP_VERSIONS` 为空时启用注册表全部版本；也可 `SP_VERSIONS=act2autochess,act3autochess` 只开这两个。
- 客户端：大厅 `VersionSwitch`（`public/js/ui/versionPicker.js`）列出可用版本；房间创建时带 `version`，匹配/房间数据按版本隔离。
- 若想让第三期成为默认：`SP_VERSION_DEFAULT=act3autochess`（数据可用后再改）。

## 4. 文件到位后我会做的顺序

1. 校验解包表格字段，写/跑转换脚本生成 `data/versions/act3autochess/*.json`（对齐 `act1autochess` 的 schema）。
2. 启动服务器验证版本被启用、`/healthz` 列出，创建第三期房间能开局。
3. 导入地图预览 / UI 贴图 / BGM / 皮肤并登记 `data/assets.json`。
4. 补第三期文案（从 `docs/reference/act3-strings.md` 取）。
5. 截图验证版本切换与第三期大厅/对局。


## 6. 关于「第三期独立于其他版本」

现状：`family` 字段此前只是说明性的——引擎里没有任何地方按版本 family 分支（只有超限 sp 草稿有自己的 family）。所以「独立」不能靠改一个字符串实现，需要分三层考虑：

| 层级 | 做法 | 何时采用 |
| --- | --- | --- |
| 1. 数据/构建独立（必须） | act3 自己的构建适配器与 `data/versions/act3autochess/`，schema 可新增字段；act1/act2 数据一律不动 | 立即 |
| 2. 规则开关独立（建议） | 用 `family: 'regulation'`（已登记）＋按 family 读取特性开关；新机制（自编干员、赏金怪/特训敌人、共同敌手、决战回合、三星评价）做成可选钩子，covenant 路径保持逐字节不变 | 差异中等时 |
| 3. 引擎分叉（最后手段） | 复制 `server/match` 为 `match-regulation`，按 family 选择；网络/房间/资产复用 | 阶段/结算/购买流程差异过大（约 >40%）时 |

当前决定：`shared/versions.js` 里 act3 的 family 已改为 `regulation`，并新增 `familyOfVersion(id)` 供后续规则层使用；引擎尚未按 family 分支。等解包表格到位、确认机制差异后，再在 2 与 3 之间定夺。

注意：数据目录缺失时该版本会自动禁用（日志警告），不会影响第二期的房间、匹配与结算。


## 7. 首轮构建结果（2026-11-08）

- 构建器：`tools/build-data-act3.mjs`（从上游 build-data 移植，已适配 `activity.AUTOCHESS.<id>.V3_1`、旧期教学关映射、宽容卡池、char/skill 表解包根字段）。
- 数据：`data/versions/act3autochess/` 共 18 个文件（15 个生成 + relics/tuning 占位），约 5.6 MB。
- 内容量：干员 310、可见 141、盟约 26、卫戍能力 334、道具 116、分队 61、效果 465、敌人 341、波次 50、关卡 12、首领 16、代币 34。
- 验证：版本已启用；大厅版本切换显示「第三期·规程」；选版本 → 独立模拟 → 开局成功（简报页显示 act3 的 m01、萨米的意志、新盟约），客户端无报错。
- 待修：盟约 26/27（隐藏盟约被丢）、首领 16/17（矩兽缺图鉴）、812 条模块/练度告警、relics 与 tuning 暂用第一期占位；卫戍能力/自编干员/20 档规程/称号等机制尚未在引擎里生效。
