請先完整閱讀 requirements.md, design.md, tasks.md, steering.md, CLAUDE.md（以及其中引用的 Precedence / Tooling Router / skills）。

以這些文件作「初始 SSOT（可優化的工作版）」：允許在 Plan 階段由 swarm 完善、補洞、重排與優化，但必須以「可落檔」形式交付修訂稿。

以 tasks.md 為主線，輸出三個部分：

A) 落地計劃（Plan）
- 逐項 task 的落地方案（會改哪些檔、加哪些測試、驗收命令）
- 風險點（尤其：Realtime 中斷/緩衝、摘要壓縮、progress bar 估算）
- 需要我補充的最少問題（不多於 5 條）

B) 規格修訂稿（Spec Improvement Pack｜可落檔）
- 如發現規格缺口／矛盾／可優化點：直接輸出對 requirements.md / design.md / tasks.md / steering.md / CLAUDE.md 的修訂內容
- 交付形式必須可直接落檔（逐檔提供「精準錨點＋BEFORE/AFTER」或逐檔完整替換稿）
- 同時列出：修訂原因＋對 tasks/測試/驗收的影響（僅列要點）

C) 落檔順序（Write Order）
- 指明 Implementation 階段應先落檔哪些 spec 變更（例如先更新 tasks/steering，再更新 design/requirements），再開始寫代碼。

Plan Mode 不要求直接改 repo 檔；但必須輸出「可直接落檔」的修訂稿，供下一階段套用。
