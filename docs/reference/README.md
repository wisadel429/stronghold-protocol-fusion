# 官方《卫戍协议·规程》参考资料

- `official-regulations-2026-11-08.jpg`：2026-11-08 提供的官方规程表截图（1137×3688），含干员（名称/职业/盟约/效果）与盟约分档效果。
- 图片字号过小，系统 OCR（Windows.Media.Ocr，zh-Hans）无法稳定识别（整图与 4× 放大均失败）；暂不能自动转成结构化数据。
- 如需接入游戏数据，请提供 Excel / CSV / JSON / 官方数据文件或可复制的网页链接；也可以按区块提供更清晰的截图（每张 960px 宽以上、仅含 10–15 行），我逐块转录后合并。

## 计划中的数据结构（供整理来源时参考）

干员行：`name, class, bond, rarity, cost, desc`
盟约行：`bond, tier (人数/层数), effect, desc`

整理成 CSV 后可直接映射到 `data/chess.json`、`data/bonds.json` 与 `data/config.json` 的盟约分档。
