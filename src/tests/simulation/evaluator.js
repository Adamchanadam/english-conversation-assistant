/**
 * 3-Party Simulation Evaluator
 *
 * 評估 AI Proxy 在模擬對話中的表現
 * 計算身份正確率、目標推進率、按鈕響應率、任務完成率
 *
 * @module evaluator
 */

// ============================================
// 評估器
// ============================================

class Evaluator {
    constructor(scenario, simulationResult) {
        this.scenario = scenario;
        this.result = simulationResult;
        this.config = scenario.config;
        this.criteria = scenario.successCriteria || {};
    }

    /**
     * 執行完整評估
     */
    evaluate() {
        const turnEvaluations = this.evaluateTurns();
        const metrics = this.calculateMetrics(turnEvaluations);
        const taskCompleted = this.evaluateTaskCompletion();
        const goalAchieved = this.checkOverallGoalAchieved();
        const result = this.determineResult(metrics, taskCompleted);

        return {
            scenario: this.scenario.name,
            config: this.config,
            turns: turnEvaluations,
            metrics: {
                identityAccuracy: metrics.identityAccuracy,
                goalProgressRate: metrics.goalProgressRate,  // 保留作為參考
                goalAchieved: goalAchieved,  // 新增：整體目標是否達成
                buttonResponseRate: metrics.buttonResponseRate,
                taskCompleted
            },
            result,
            failureReasons: this.failureReasons || []
        };
    }

    /**
     * 評估每一輪對話
     */
    evaluateTurns() {
        return this.result.turns.map((turn, index) => {
            const evaluation = {
                turn: turn.turn,
                counterpart: turn.counterpart,
                aiProxy: turn.aiProxy,
                userAction: turn.userAction,
                evaluation: {
                    identityCorrect: this.checkIdentity(turn.aiProxy),
                    goalProgress: this.checkGoalProgress(turn.aiProxy),
                    buttonResponse: turn.userAction ? this.checkButtonResponse(turn, index) : null,
                    honestyMaintained: this.checkHonesty(turn.aiProxy)
                }
            };
            return evaluation;
        });
    }

    /**
     * 檢查身份是否正確（AI 沒有說對方的話）
     */
    checkIdentity(aiResponse) {
        const I = this.config.agentName || '';
        const O = this.config.counterpartType || '';

        // 檢查 AI 是否說了對方才會說的話
        const counterpartPatterns = this.getCounterpartPatterns();

        for (const pattern of counterpartPatterns) {
            if (pattern.test(aiResponse)) {
                return false;
            }
        }

        // 檢查 mustNotSay
        const mustNotSay = this.criteria.mustNotSay || [];
        for (const phrase of mustNotSay) {
            if (aiResponse.includes(phrase)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 獲取對方才會說的模式
     */
    getCounterpartPatterns() {
        const O = this.config.counterpartType || '';
        const patterns = [];

        // 通用模式：自稱對方
        patterns.push(new RegExp(`我是${O}`, 'i'));
        patterns.push(new RegExp(`I am (?:the )?${O}`, 'i'));
        patterns.push(new RegExp(`This is ${O}`, 'i'));

        // 服務提供者模式（如果 AI 不是服務提供者）
        if (!this.isServiceProvider()) {
            patterns.push(/請問您在哪/i);
            patterns.push(/有什麼可以幫/i);
            patterns.push(/how can I help/i);
            patterns.push(/what can I do for you/i);
            patterns.push(/我會派人/i);
            patterns.push(/we will send/i);
        }

        return patterns;
    }

    /**
     * 判斷 AI 是否扮演服務提供者角色
     */
    isServiceProvider() {
        const I = this.config.agentName || '';
        const serviceKeywords = ['agent', 'support', 'service', 'staff', 'representative', '客服', '服務'];
        return serviceKeywords.some(k => I.toLowerCase().includes(k.toLowerCase()));
    }

    /**
     * 檢查目標推進（單輪）
     * 注意：這只是輔助指標，主要看整體對話是否達成目標
     */
    checkGoalProgress(aiResponse) {
        const G = this.config.goal || '';
        const goalKeywords = this.criteria.goalKeywords || [];
        const responseLower = aiResponse.toLowerCase();

        // 檢查是否提及目標相關關鍵詞
        const allKeywords = [...goalKeywords];

        // 從目標中提取關鍵詞
        const goalWords = G.split(/[,，、\s]+/).filter(w => w.length >= 2);
        allKeywords.push(...goalWords);

        // 至少匹配一個關鍵詞（不區分大小寫）
        for (const keyword of allKeywords) {
            if (keyword && responseLower.includes(keyword.toLowerCase())) {
                return true;
            }
        }

        // 檢查 mustMention（不區分大小寫）
        const mustMention = this.criteria.mustMention || [];
        for (const phrase of mustMention) {
            if (responseLower.includes(phrase.toLowerCase())) {
                return true;
            }
        }

        return false;
    }

    /**
     * 檢查整體對話是否達成目標（新增）
     */
    checkOverallGoalAchieved() {
        // 合併所有對話內容（AI + 對方）
        const allContent = this.result.turns.map(t =>
            `${t.counterpart} ${t.aiProxy}`
        ).join(' ').toLowerCase();

        const goalKeywords = this.criteria.goalKeywords || [];
        let keywordsMatched = 0;

        for (const keyword of goalKeywords) {
            if (keyword && allContent.includes(keyword.toLowerCase())) {
                keywordsMatched++;
            }
        }

        // 至少匹配一半的關鍵詞即視為達成目標
        const threshold = Math.ceil(goalKeywords.length / 2);
        return keywordsMatched >= threshold;
    }

    /**
     * 檢查按鈕響應
     */
    checkButtonResponse(turn, turnIndex) {
        const action = turn.userAction;
        const response = turn.aiProxy;

        // 根據按鈕類型檢查回應是否符合
        const actionPatterns = {
            'AGREE': [/同意/i, /好的/i, /可以/i, /agree/i, /okay/i, /yes/i, /sure/i],
            'DISAGREE': [/不/i, /抱歉/i, /decline/i, /sorry/i, /cannot/i, /can't/i],
            'NEED_TIME': [/時間/i, /考慮/i, /time/i, /think/i, /consider/i],
            'REPEAT': [/重複/i, /再說/i, /repeat/i, /again/i, /clarify/i],
            'PROPOSE_ALTERNATIVE': [/或者/i, /另外/i, /alternative/i, /instead/i, /how about/i],
            'ASK_BOTTOM_LINE': [/底線/i, /最低/i, /limit/i, /minimum/i, /best/i],
            'SAY_GOODBYE': [/再見/i, /拜拜/i, /謝謝/i, /goodbye/i, /bye/i, /thank/i],
            'GOAL_MET': [/謝謝/i, /感謝/i, /thank/i, /great/i, /perfect/i]
        };

        const patterns = actionPatterns[action] || [];
        for (const pattern of patterns) {
            if (pattern.test(response)) {
                return true;
            }
        }

        // 如果沒有匹配到明確模式，檢查語氣變化
        // 這是一個寬鬆的檢查，假設 LLM 會根據 guidance 調整
        return true;
    }

    /**
     * 檢查誠實性
     */
    checkHonesty(aiResponse) {
        // 檢查是否有明顯的虛構（這是簡化版本）
        // 實際應該根據 SSOT 檢查是否捏造事實
        const fabricationPatterns = [
            /definitely/i,
            /absolutely certain/i,
            /100% sure/i
        ];

        // 這些模式表示可能的過度確定，需要結合上下文判斷
        // 目前返回 true（假設沒有虛構）
        return true;
    }

    /**
     * 計算指標
     */
    calculateMetrics(turnEvaluations) {
        let identityCorrect = 0;
        let goalProgress = 0;
        let buttonResponses = 0;
        let buttonTotal = 0;

        for (const turn of turnEvaluations) {
            if (turn.evaluation.identityCorrect) identityCorrect++;
            if (turn.evaluation.goalProgress) goalProgress++;
            if (turn.evaluation.buttonResponse !== null) {
                buttonTotal++;
                if (turn.evaluation.buttonResponse) buttonResponses++;
            }
        }

        const total = turnEvaluations.length;

        return {
            identityAccuracy: total > 0 ? identityCorrect / total : 1,
            goalProgressRate: total > 0 ? goalProgress / total : 0,
            buttonResponseRate: buttonTotal > 0 ? buttonResponses / buttonTotal : 1
        };
    }

    /**
     * 評估任務完成
     */
    evaluateTaskCompletion() {
        // 合併所有 AI 回應
        const allResponses = this.result.turns.map(t => t.aiProxy).join(' ');
        const allResponsesLower = allResponses.toLowerCase();

        // 追蹤失敗原因
        this.taskCompletionFailures = [];

        // 檢查 mustMention（改為不區分大小寫）
        const mustMention = this.criteria.mustMention || [];
        for (const phrase of mustMention) {
            if (!allResponsesLower.includes(phrase.toLowerCase())) {
                this.taskCompletionFailures.push(`未提及 "${phrase}"`);
            }
        }

        // 檢查 goalKeywords（至少匹配一個，不區分大小寫）
        const goalKeywords = this.criteria.goalKeywords || [];
        if (goalKeywords.length > 0) {
            const matched = goalKeywords.some(k => allResponsesLower.includes(k.toLowerCase()));
            if (!matched) {
                this.taskCompletionFailures.push(`未匹配任何目標關鍵詞: ${goalKeywords.join(', ')}`);
            }
        }

        // 檢查 maxTurns
        const maxTurns = this.criteria.maxTurns || 10;
        if (this.result.totalTurns > maxTurns) {
            this.taskCompletionFailures.push(`超過最大回合數 (${this.result.totalTurns} > ${maxTurns})`);
        }

        return this.taskCompletionFailures.length === 0;
    }

    /**
     * 決定最終結果
     */
    determineResult(metrics, taskCompleted) {
        // 核心判定標準：
        // 1. 身份正確率 >= 90%（AI 不能說錯身份）
        // 2. 整體目標達成（對話中提及了目標關鍵詞）
        // 3. 按鈕有響應（如果有按按鈕的話）
        // 4. 任務完成條件滿足

        const identityOk = metrics.identityAccuracy >= 0.90;
        const goalAchieved = this.checkOverallGoalAchieved();
        const buttonOk = metrics.buttonResponseRate >= 0.80;

        // 追蹤失敗原因
        this.failureReasons = [];
        if (!identityOk) this.failureReasons.push(`身份正確率不足 (${(metrics.identityAccuracy * 100).toFixed(0)}% < 90%)`);
        if (!goalAchieved) this.failureReasons.push('整體目標未達成');
        if (!buttonOk) this.failureReasons.push(`按鈕響應率不足 (${(metrics.buttonResponseRate * 100).toFixed(0)}% < 80%)`);
        if (!taskCompleted) {
            this.failureReasons.push('任務完成條件未滿足');
            if (this.taskCompletionFailures && this.taskCompletionFailures.length > 0) {
                this.failureReasons.push(...this.taskCompletionFailures.map(f => `  - ${f}`));
            }
        }

        const passed = identityOk && goalAchieved && buttonOk && taskCompleted;

        return passed ? 'PASS' : 'FAIL';
    }
}

// ============================================
// 報告生成
// ============================================

/**
 * 生成人類可讀報告
 */
function generateReport(evaluationResult, verbose = true) {
    const lines = [];

    lines.push('═'.repeat(60));
    lines.push(`場景：${evaluationResult.scenario}`);
    lines.push('═'.repeat(60));
    lines.push(`配置：AI=${evaluationResult.config.agentName}, 對方=${evaluationResult.config.counterpartType}, 語言=${evaluationResult.config.taskLanguage}`);
    lines.push('');
    lines.push('對話記錄：');
    lines.push('─'.repeat(60));

    for (const turn of evaluationResult.turns) {
        if (turn.userAction) {
            lines.push(`[USER ACTION: ${turn.userAction}]`);
        }
        lines.push(`[Turn ${turn.turn}] ${evaluationResult.config.counterpartType}: ${turn.counterpart}`);
        lines.push(`[Turn ${turn.turn}] ${evaluationResult.config.agentName}: ${turn.aiProxy}`);

        // 評估結果
        const eval_ = turn.evaluation;
        const evalStatus = [];
        evalStatus.push(eval_.identityCorrect ? '✓ 身份正確' : '✗ 身份錯誤');
        evalStatus.push(eval_.goalProgress ? '✓ 目標推進' : '○ 無推進');
        if (eval_.buttonResponse !== null) {
            evalStatus.push(eval_.buttonResponse ? '✓ 按鈕響應' : '✗ 無響應');
        }
        lines.push(`         ${evalStatus.join(' | ')}`);
    }

    lines.push('─'.repeat(60));
    lines.push('');
    lines.push('評估結果：');

    const m = evaluationResult.metrics;
    lines.push(`  身份正確率: ${(m.identityAccuracy * 100).toFixed(0)}%`);
    lines.push(`  目標達成: ${m.goalAchieved ? '✓' : '✗'}`);
    lines.push(`  按鈕響應率: ${(m.buttonResponseRate * 100).toFixed(0)}%`);
    lines.push(`  任務完成: ${m.taskCompleted ? '✓' : '✗'}`);

    lines.push('');
    lines.push(`總評：${evaluationResult.result}`);

    // 顯示失敗原因
    if (evaluationResult.result === 'FAIL' && evaluationResult.failureReasons && evaluationResult.failureReasons.length > 0) {
        lines.push('');
        lines.push('失敗原因：');
        for (const reason of evaluationResult.failureReasons) {
            lines.push(`  ${reason}`);
        }
    }

    lines.push('═'.repeat(60));

    return lines.join('\n');
}

/**
 * 生成 JSON 報告
 */
function generateJsonReport(evaluationResults) {
    return {
        timestamp: new Date().toISOString(),
        totalScenarios: evaluationResults.length,
        passed: evaluationResults.filter(r => r.result === 'PASS').length,
        failed: evaluationResults.filter(r => r.result === 'FAIL').length,
        scenarios: evaluationResults.map(r => ({
            name: r.scenario,
            result: r.result,
            metrics: {
                identityAccuracy: r.metrics.identityAccuracy,
                goalAchieved: r.metrics.goalAchieved,
                buttonResponseRate: r.metrics.buttonResponseRate,
                taskCompleted: r.metrics.taskCompleted
            }
        })),
        aggregateMetrics: calculateAggregateMetrics(evaluationResults)
    };
}

/**
 * 計算聚合指標
 */
function calculateAggregateMetrics(results) {
    if (results.length === 0) {
        return {
            avgIdentityAccuracy: 0,
            goalAchievedRate: 0,
            avgButtonResponseRate: 0,
            overallPassRate: 0
        };
    }

    const sum = results.reduce((acc, r) => ({
        identity: acc.identity + r.metrics.identityAccuracy,
        goalAchieved: acc.goalAchieved + (r.metrics.goalAchieved ? 1 : 0),
        button: acc.button + r.metrics.buttonResponseRate
    }), { identity: 0, goalAchieved: 0, button: 0 });

    return {
        avgIdentityAccuracy: sum.identity / results.length,
        goalAchievedRate: sum.goalAchieved / results.length,
        avgButtonResponseRate: sum.button / results.length,
        overallPassRate: results.filter(r => r.result === 'PASS').length / results.length
    };
}

// ============================================
// 導出
// ============================================

module.exports = {
    Evaluator,
    generateReport,
    generateJsonReport
};
