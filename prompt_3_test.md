請把 tasks.md 內的測試/驗收全部落成可重播：
- 提供最少 3 個端到端測試腳本（含 2 次打斷、1 次未知問題、1 次按鈕改立場）
- 每次 run 產出可追蹤的 log（事件時間線 + 判定結果 + 版本/配置資訊）
- 提供一鍵式驗收命令（例如：npm scripts / python scripts），確保任何人可重播
- 以 tasks.md/requirements.md（更新後版本）內定義的 KPI 計算結果並輸出摘要

如驗收/KPI 口徑不足以覆蓋風險（例如：barge-in buffer、摘要壓縮失焦、progress bar 估算偏差）：
- 允許先更新 spec（特別是 tasks.md/requirements.md 的驗收條目）以完善驗收口徑，並用獨立 commit 記錄
- 然後再補齊測試與腳本，最後再宣告通過。
