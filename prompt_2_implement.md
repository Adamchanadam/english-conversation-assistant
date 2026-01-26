依 tasks.md 由上而下逐項實作（支援 Swarm mode 並行）。可同時處理多個 tasks，但必須以「Workstream / Batch」方式組織，避免互相踩檔與驗收不可重播。

Implementation 起手式（必做）：
- 先套用 Plan 階段輸出的「Spec Improvement Pack」到 repo（更新 requirements/design/tasks/steering/CLAUDE 等），並先做一次獨立 commit（只包含規格修訂）。
- 之後才開始按 tasks.md 落地代碼與測試。

Swarm 並行規則（硬規約）：
- 先把 tasks.md 分解為若干 Workstreams（可並行），每個 Workstream 需列明：
  - 涉及的 task ids（可多個）
  - 會改動的檔案範圍（檔案所有權/避免衝突）
  - 共同驗收命令（同一套可重播）
- 若多個 tasks 必須同時改同一組核心檔案（例如同一個 Realtime 管線/狀態機模組），允許合併為同一個 Batch；否則應分拆並行。
- 規格（spec）改動與代碼改動不得混在同一個 commit：先 spec commit，再代碼/測試 commits。

對每個 Workstream / Batch 的交付要求：
- 先簡述如何滿足其涵蓋的 tasks（逐項引用對應的 requirement/design 段落；如該段落已在 Spec Improvement Pack 更新，引用更新後內容）
- 實作改動
- 加/改測試
- 提供驗收命令（例如 lint/test/build），必須可一鍵重播
- 完成後：更新 tasks.md 對應項目標記為完成（例如 [x]）

若遇到規格缺口或不確定：
- 允許在 Implementation 階段直接完善規格，但必須先更新 spec（requirements/design/tasks/steering/CLAUDE）並以獨立 commit 記錄，然後才改代碼
- 可提出最少澄清問題（不多於 5 條）；如必須使用安全預設，需清楚標示並提供可回退方案。

補充：Claude Code 支援在終端機內執行、改檔及做 git 工作流；建議以「workstream/batch」為單位做可回退的 commits（可多 commit），確保每次合併前均可跑通驗收命令。
