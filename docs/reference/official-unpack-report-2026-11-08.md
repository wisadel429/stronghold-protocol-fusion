# 明日方舟「卫戍协议」解包报告

> 采样时间：2026-11-08 16:10–17:0x（Asia/Shanghai）
> 客户端位置：`D:\Hypergryph Launcher\games\Arknights`（鹰角 PC 端）
> 本次解包目标：刚刚完成的热更新，定位「卫戍协议」相关全部内容

---

## 一、结论速览

1. 游戏**确已在今天 16:10–16:12 完成热更新**，本地资源版本号 `26-11-06-12-42-25-70182449`（上一版是 `26-10-29-15-36-11-33649006`）。
2. 本次更新的卫戍协议内容，内部代号是 **`act3autochess`**，即**第三期**卫戍协议（对应官方 11-01 发布的「**卫戍协议：规程**」宣传 PV）。
3. 共定位到 **93 个**相关资源文件、合计 **176.9 MB**，全部写入时间为本次更新时刻（16:11:14–16:11:17），可确认为新增/更新内容。
4. 已从资源包中直接提取出 **391 条**中文界面原文（含新增玩法提示），见第五节。
5. **限制**：本次客户端的资源包使用 UnityFS `compression=4`（LZHAM），UnityPy 1.25 与 AssetStudioMod 0.20 均不支持该块压缩；因此只能做“字符串级”提取，无法完整还原 JSON 表格与贴图。技术细节见第七节。

---

## 二、更新事实核对

| 项目 | 值 |
|---|---|
| 本地资源版本 | `26-11-06-12-42-25-70182449` |
| 本地更新完成时间 | 2026-11-08 16:10:47 ~ 16:11:25 |
| CDN 当前资源版本 | `26-11-06-12-56-09-07186384` |
| CDN 客户端版本 | `2.7.91` |
| 资源清单条目 | 15759 |
| 上一版资源版本 | `26-10-29-15-36-11-33649006` |

清单文件：`Arknights_Data\PersistentData\Bundles\hot_update_list.json`

### 资源存放结构

```
Arknights_Data\
├─ StreamingAssets\AB\Windows\     基础安装资源（约 24 GB）
└─ PersistentData\Bundles\         热更新增量资源（约 3.5 GB）
   ├─ hot_update_list.json          本次版本清单
   ├─ anon\*.bin                    gamedata 表格（含 gamedata/excel/* 路径）
   ├─ activity\                    活动资源（含 [uc]act3autochess.ab）
   ├─ ui\autochess\                卫戍协议 UI
   ├─ battle\prefabs\levelprefabs\activities\act3autochess\   关卡预制体
   └─ scenes\activities\act3autochess\                        关卡场景
```

---

## 三、本期「卫戍协议」资产清单

### 3.1 关卡地图（10 张，编号 m01–m06、m09–m12）

编号 **m07、m08 缺失**，即本期实际开放 10 张地图，中间两张可能为后续追加或占位。

每张地图含三层资源：

| 层级 | 路径 | 说明 |
|---|---|---|
| 场景 | `scenes\activities\act3autochess\level_act3autochess_mNN\` | Unity 场景包（约 128–134 KB/张） |
| 关卡预制体 | `battle\prefabs\levelprefabs\activities\act3autochess\level_act3autochess_mNN\level_act3autochess_mNN_sub_01..03\` | 每张图 3 个波次/子关 |
| 小地图预览 | `arts\ui\stage\mappreviews\act3autochess_mNN_sub_0X.ab` | 共 30 个预览图 |

### 3.2 音乐与音效

| 文件 | 大小 | 说明 |
|---|---|---|
| `audio\sound_beta_2\music\act3autochess\m_boss1_act3autochess.ab` | 1745 KB | 首领战 BGM 1 |
| `audio\sound_beta_2\music\act3autochess\m_boss2_act3autochess.ab` | 1490 KB | 首领战 BGM 2 |
| `audio\sound_beta_2\music\act3autochess\m_sys_act3autochess.ab` | 2134 KB | 系统/大厅 BGM |
| `audio\sound_beta_2\music\act1autochess\m_bat_act1autochess.ab` | 1578 KB | 沿用第一期战斗曲 |

**两首首领曲（boss1、boss2）为本期新增**——与“本期存在多个最终领袖”的设计吻合。

### 3.3 界面与外观

| 文件 | 大小 | 说明 |
|---|---|---|
| `ui\autochess\[uc]autochessouter.ab` | 17822 KB | 大厅/外围界面（最大） |
| `ui\autochess\[uc]autochessbattle.ab` | 4570 KB | 战斗内界面 |
| `ui\autochess\[uc]autochesscommon.ab` | 2983 KB | 通用组件 |
| `ui\autochess\[uc]autochesstemplateshop.ab` | 407 KB | 模板商店 |
| `ui\autochess\autochessvariantskin\[uc]ac_s_closur.ab` | 3485 KB | **新肤色变体：Closure** |
| `ui\autochess\autochessvariantskin\[uc]ac_n_iron.ab` | 1760 KB | **新变体：Iron** |
| `ui\autochess\autochessvariantskin\[uc]ac_n_initial.ab` | 1519 KB | 初始变体 |
| `spritepack\ui_zone_home_theme_act3autochess.ab` | 627 KB | **主页主题装饰** |
| `building\diy\prefabs\furnitures\furni_act3autochess.ab` | 387 KB | **活动家具** |
| `ui\emoticon\theme\[uc]emoticon_autochess_basic_2.ab` | 74 KB | 第二套卫戍专用表情 |

### 3.4 汇总

| 指标 | 值 |
|---|---|
| 相关文件总数 | 93 |
| 合计体积 | 176.9 MB |
| 地图数 | 10（m01–m06、m09–m12） |
| 子关卡数 | 30 |
| 新增 BGM | 2 首首领曲 + 1 首系统曲 |

---

## 四、解包方法（可复现）

1. **定位版本**：读 `hot_update_list.json` 的 `versionId`，与 CDN `https://ak-conf.hypergryph.com/config/prod/official/Android/version` 对比，确认本次更新。
2. **格式识别**：所有 `.ab` 均为标准 `UnityFS` 头（Unity 2021.3.39f1，头部版本 8）。
3. **块解析**：blob 头 `flags=0x243`，含 `BlockInfoNeedPaddingAtStart(0x200)`；blocksInfo 用 LZ4 解出后得到 block 表。
4. **压缩判定**：block 的 `flags & 0x3f` 抽样统计为 **4(LZHAM) 与 0(未压缩) 各约一半**。
5. **字符串提取**：对 flag=0 的块及 LZHAM 流中的明文字面量做 UTF-8 游程提取，得到界面文本。

---

## 五、从资源包中提取到的原文（节选）

以下字符串直接取自本期 `act3autochess` 系列资源包，**未做改写**（`#`、`<`、`$` 等为提取时混入的字节噪声，已尽量剔除）。

### 5.1 新增玩法线索

| 提取原文 | 推断含义 |
|---|---|
| `可选择2名干员加入作战编队` / `选择自编干员` | 本期新增「自编干员」入口，可选 2 名加入编队 |
| `选择一个赏金怪加入本回合作战` | 「赏金怪」机制：主动投放强力敌人换取收益 |
| `<共同敌手>进入目标点时，会同时扣除协作双方的关卡生命。` | 新增「共同敌手」：漏怪会同时扣双方生命 |
| `决战回合` / `合力迎击领袖！` / `迎击首领敌人` | 新增「决战回合」阶段 |
| `隐藏回合已解锁` | 对应既有「隐秘核心」隐藏回合机制 |
| `以三星评价完成` | 本期结算改用**三星评价** |
| `挑战失败不影响胜利结算` | 失败判定与结算解耦 |
| `特训敌人` | 沿用「特训敌人组合」 |
| `常态模拟` / `快速模拟` / `组队模拟` / `模拟邀约` | 大厅入口文案（含新增的组队/邀约入口） |

### 5.2 流程与状态文本

```
等待模拟重载        模拟即将继续        仍在模拟中
模拟完成            模拟中断            放弃模拟
通过回合#           团队通过回合        当前回合
匹配成功！          取消匹配成功        等待重连中
取消准备            完成教学关后开放
```

### 5.3 道具与装备文本

```
道具图鉴
装备已满
装备后防御力下降15%，攻击间隔增大
是否选择已穿戴装备<color=#FF0000>销毁并替换<
激活后：攻击方式变为对前方2格的3个敌人造成
```

### 5.4 盟约/数值相关

```
协防干            当前层数
已击败首个领袖！
```

> 完整 391 条原文见 `ak_out\act3_strings_all.txt`。

---

## 六、与已知两期的关系

| 期次 | 内部代号 | 官方名 | 时间 |
|---|---|---|---|
| 第一期 | `act1autochess` | 卫戍协议 2024 | 2024 |
| 第二期 | （`1autochess` 蚀刻章前缀） | 卫戍协议：盟约 | 2025-11-14 ~ 12-12 |
| **第三期** | **`act3autochess`** | **卫戍协议：规程** | **2026-11-08 更新实装** |

注：官方 2026-11-01 发布「卫戍协议：规程」宣传 PV；PRTS 目前只建有前两期词条，第三期词条尚未建立，故本期细节以上表第五节的资源原文为准。

---

## 七、未完成部分与技术原因

| 项目 | 状态 | 原因 |
|---|---|---|
| 文件清单、体积、时间 | ✅ 完成 | 文件系统直读 |
| 界面中文原文 | ⚠️ 部分完成（391 条） | LZHAM 流中仅字面量可读，文本被截断 |
| `gamedata/excel/*.json` 表格 | ❌ 未完成 | 全部位于 `anon\*.bin`，块压缩为 LZHAM |
| 贴图 / 立绘 / 音频导出 | ❌ 未完成 | 同上 |

### 排查记录

- **UnityPy 1.25.4**：`NotImplementedError: Custom compression or unimplemented LZHAM`。其 `DECOMPRESSION_MAP` 明确将 flag=4 映射到未实现的 `decompress_lzham`。
- **AssetStudioModCLI 0.20.0**（net472）：`IOException: Unsupported block compression type: Lzham.`——该分支已移除 LZHAM。
- **Perfare AssetStudio 0.16.47**：`BundleFile.ReadBlocks` 的 `switch` 同样只处理 None/Lzma/Lz4/Lz4HC，Lzham 落入 `default: throw`。
- **自研试探**：对同一 block 依次尝试 LZ4（偏移 0/4/8/12/15/16/20，尺寸 32768/64K/us/us÷2）、zlib、raw deflate、LZMA(alone/raw)、bz2、zstd、brotli、Snappy，均无法解出 `usize` 长度的数据。
- **ArkUnpacker 5.2.0**（本机已装）：可解该客户端，但其解压逻辑封装在 PyInstaller 冻结包内（仅暴露 `UnityPyBoost.pyd` 的 `decrypt_block` / `read_typetree` / `unpack_vertexdata`，无 LZHAM 导出），且程序为 GUI，无命令行模式。

### 结论

LZHAM 解码需要引入第三方实现（如 `lzham_codec` 编译产物），当前环境无 C++ 工具链、PyPI 亦无可用 `lzham` 轮子，故完整还原被阻断。

---

## 八、本次使用的脚本

| 脚本 | 用途 |
|---|---|
| `ak_hdr.py` | 批量统计 UnityFS 头与压缩标志 |
| `ak_parse.py` / `ak_blocks.py` | 单包结构、block 表解析 |
| `ak_rawscan.py` | 全目录字节扫描（定位 `卫戍`、`gamedata/excel` 等） |
| `ak_extract.py` | 从 anon 包提取 TextAsset |
| `ak_codec.py` / `ak_codec2.py` / `ak_codec3.py` | 多编解码器试探 |
| `ak_harvest2.py` | 资源包中文字符串提取（产出第五节数据） |
| `ak_pyi*.py` / `ak_pyz2.py` | ArkUnpacker 内部归档解析 |

产出文件：

- `ak_out\act3_strings_all.txt` —— 391 条提取原文
- `ak_out\act3_strings_report.txt` —— 按关键词分组
- `ak_out\weishu_ctx.txt` —— `卫戍` 命中处的上下文字节
