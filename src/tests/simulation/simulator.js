/**
 * 3-Party Simulation Simulator
 *
 * 模擬三方互動：User (腳本驅動) + AI Proxy + Counterpart
 * 使用 gpt-5-mini 透過後端 API 進行真實 LLM 互動
 *
 * @module simulator
 */

const http = require('http');
const https = require('https');

// ============================================
// 配置
// ============================================

const CONFIG = {
    backendUrl: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
    maxTurns: 10,
    timeout: 60000  // 60 秒超時（LLM 調用可能較慢）
};

// ============================================
// HTTP 請求工具
// ============================================

/**
 * 發送 POST 請求到後端
 */
function postRequest(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.timeout
        };

        const req = lib.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${body.substring(0, 200)}`));
                }
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error('無法連接後端，請確認後端已啟動 (http://127.0.0.1:8000)'));
            } else {
                reject(err);
            }
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`請求超時 (${CONFIG.timeout/1000}秒)`));
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

// ============================================
// Prompt 構建
// ============================================

/**
 * 構建 AI Proxy 的 session instructions
 * 使用 Prompt Consolidation 模式
 */
function buildProxyInstructions(config) {
    const I = config.agentName || 'the user';
    const O = config.counterpartType || 'the other party';
    const G = config.goal || '';
    const L = config.taskLanguage || 'zh-TW';
    const R = config.rules || '';
    const S = config.ssot || '';

    const languageMap = {
        'zh-TW': 'Traditional Chinese',
        'zh-CN': 'Simplified Chinese',
        'en': 'English',
        'ja': 'Japanese',
        'ko': 'Korean'
    };
    const langName = languageMap[L] || L;

    return `[LANGUAGE] Speak only in ${langName}.

[CRITICAL IDENTITY]
- You ARE ${I}.
- You are CALLING ${O} to achieve your goal.
- You are the CALLER, not the service provider.
- NEVER act as ${O}. NEVER give advice like a customer service rep.
- NEVER say "I understand" or "Let me help you" - those are ${O}'s lines, not yours.

[INTERACTION] The voice you hear is ${O} (the one you called). You respond as ${I} (the caller).

[YOUR GOAL] ${G}

[WHAT YOU KNOW] Only say what ${I} would know. If unsure, say so honestly.

${R ? `[CONSTRAINTS] ${R}` : ''}

${S ? `[REFERENCE] ${S.substring(0, 2000)}` : ''}

[SPEAKING STYLE]
- You are on a phone call as the CALLER.
- Introduce yourself ONLY ONCE at the start.
- Be concise. 1-2 sentences per turn.
- Pursue YOUR goal, don't help ${O} with their job.

[OUTPUT] Only speak as ${I}. No narration. Just what ${I} says.`;
}

/**
 * 構建 Counterpart 的 persona instructions
 */
function buildCounterpartInstructions(scenario) {
    const config = scenario.config;
    const O = config.counterpartType || 'the other party';
    const L = config.taskLanguage || 'zh-TW';

    const languageMap = {
        'zh-TW': 'Traditional Chinese',
        'zh-CN': 'Simplified Chinese',
        'en': 'English',
        'ja': 'Japanese',
        'ko': 'Korean'
    };
    const langName = languageMap[L] || L;

    const persona = scenario.counterpartPersona || `You are ${O}. Respond naturally to the caller.`;

    return `[LANGUAGE] Speak only in ${langName}.

[IDENTITY] You are ${O}. You are on a phone call with ${config.agentName || 'someone'}.

[PERSONA] ${persona}

[CONVERSATION STYLE]
- Speak like a REAL PERSON on a phone call, not a robot
- Keep each response SHORT (1-2 sentences max)
- Ask only ONE question at a time
- Don't repeat information already established
- Don't give long lists of instructions
- Use natural spoken language, not formal written style
- React naturally to what the other person says

[RESPONSE FORMAT] Just say what ${O} would naturally say next. No narration.`;
}

// ============================================
// 模擬器
// ============================================

/**
 * 3-Party Simulator
 */
class Simulator {
    constructor(scenario, options = {}) {
        this.scenario = scenario;
        this.config = scenario.config;
        this.maxTurns = options.maxTurns || scenario.maxTurns || CONFIG.maxTurns;
        this.verbose = options.verbose || false;

        // 對話歷史
        this.turns = [];
        this.currentTurn = 0;

        // Instructions
        this.proxyInstructions = buildProxyInstructions(this.config);
        this.counterpartInstructions = buildCounterpartInstructions(scenario);

        // 用戶動作
        this.userActions = scenario.userActions || [];
        this.pendingDirective = null;
    }

    /**
     * 執行模擬
     */
    async run() {
        if (this.verbose) {
            console.log('\n' + '═'.repeat(60));
            console.log(`場景: ${this.scenario.name}`);
            console.log('═'.repeat(60));
            console.log(`AI: ${this.config.agentName}`);
            console.log(`對方: ${this.config.counterpartType}`);
            console.log(`目標: ${this.config.goal}`);
            console.log('─'.repeat(60));
        }

        // Counterpart 先開場
        console.log('  [Turn 0] 生成對方開場白...');
        let counterpartMessage = await this.generateCounterpartOpening();
        console.log(`  [Turn 0] 對方: "${counterpartMessage.substring(0, 50)}${counterpartMessage.length > 50 ? '...' : ''}"`);

        while (this.currentTurn < this.maxTurns) {
            this.currentTurn++;
            console.log(`  [Turn ${this.currentTurn}] 處理中...`);

            // 檢查用戶動作
            const userAction = this.userActions.find(a => a.turn === this.currentTurn);
            if (userAction) {
                this.pendingDirective = userAction.action;
                console.log(`  [Turn ${this.currentTurn}] 用戶按鈕: ${userAction.action}`);
            }

            // AI Proxy 回應
            const proxyResponse = await this.generateProxyResponse(counterpartMessage);
            console.log(`  [Turn ${this.currentTurn}] AI: "${proxyResponse.substring(0, 50)}${proxyResponse.length > 50 ? '...' : ''}"`);

            this.turns.push({
                turn: this.currentTurn,
                counterpart: counterpartMessage,
                aiProxy: proxyResponse,
                userAction: userAction ? userAction.action : null
            });

            if (this.verbose) {
                console.log(`\n[Turn ${this.currentTurn}]`);
                console.log(`📞 ${this.config.counterpartType}: "${counterpartMessage}"`);
                console.log(`🤖 ${this.config.agentName}: "${proxyResponse}"`);
            }

            // 清除已使用的 directive
            this.pendingDirective = null;

            // 檢查是否結束（如 SAY_GOODBYE 或 GOAL_MET）
            if (userAction && (userAction.action === 'SAY_GOODBYE' || userAction.action === 'GOAL_MET')) {
                console.log(`  [Turn ${this.currentTurn}] 結束對話 (${userAction.action})`);
                break;
            }

            // Counterpart 繼續對話
            counterpartMessage = await this.generateCounterpartResponse(proxyResponse);
            console.log(`  [Turn ${this.currentTurn}] 對方: "${counterpartMessage.substring(0, 50)}${counterpartMessage.length > 50 ? '...' : ''}"`);
        }

        return {
            scenario: this.scenario.name,
            config: this.config,
            turns: this.turns,
            totalTurns: this.currentTurn
        };
    }

    /**
     * 生成 Counterpart 開場白
     */
    async generateCounterpartOpening() {
        const prompt = `The phone is ringing and you pick up. Say a SHORT greeting (one sentence only) as ${this.config.counterpartType}. Example: "你好，煤氣公司。" or "Hello, sales department."`;

        return await this.callLLM(
            this.counterpartInstructions,
            [{ role: 'user', content: prompt }]
        );
    }

    /**
     * 生成 AI Proxy 回應
     */
    async generateProxyResponse(counterpartMessage) {
        const messages = this.buildProxyMessages(counterpartMessage);

        // 如果有 pending directive，加入引導
        if (this.pendingDirective) {
            const directiveMap = {
                'AGREE': 'Express agreement with what they said.',
                'DISAGREE': 'Politely decline or disagree.',
                'NEED_TIME': 'Ask for time to consider.',
                'REPEAT': 'Ask them to repeat or clarify.',
                'PROPOSE_ALTERNATIVE': 'Suggest an alternative option.',
                'ASK_BOTTOM_LINE': 'Ask about their constraints or limits.',
                'SAY_GOODBYE': 'Politely wrap up and say goodbye.',
                'GOAL_MET': 'Confirm the goal is achieved and wrap up positively.'
            };
            const guidance = directiveMap[this.pendingDirective] || '';
            if (guidance) {
                messages.push({
                    role: 'system',
                    content: `[INTERNAL GUIDANCE] ${guidance}`
                });
            }
        }

        return await this.callLLM(this.proxyInstructions, messages);
    }

    /**
     * 生成 Counterpart 回應
     */
    async generateCounterpartResponse(proxyMessage) {
        const messages = this.buildCounterpartMessages(proxyMessage);
        return await this.callLLM(this.counterpartInstructions, messages);
    }

    /**
     * 構建 Proxy 對話歷史
     */
    buildProxyMessages(latestCounterpart) {
        const messages = [];

        // 加入歷史對話
        for (const turn of this.turns) {
            messages.push({ role: 'user', content: turn.counterpart });
            messages.push({ role: 'assistant', content: turn.aiProxy });
        }

        // 加入最新對方發言
        messages.push({ role: 'user', content: latestCounterpart });

        return messages;
    }

    /**
     * 構建 Counterpart 對話歷史
     */
    buildCounterpartMessages(latestProxy) {
        const messages = [];

        // 加入歷史對話（角色反轉）
        for (const turn of this.turns) {
            messages.push({ role: 'assistant', content: turn.counterpart });
            messages.push({ role: 'user', content: turn.aiProxy });
        }

        // 加入最新 AI Proxy 發言
        messages.push({ role: 'user', content: latestProxy });

        return messages;
    }

    /**
     * 調用 LLM（透過後端 API）
     */
    async callLLM(instructions, messages) {
        // 即時輸出進度
        process.stdout.write('  [LLM] 調用中...');

        try {
            const startTime = Date.now();
            const response = await postRequest(`${CONFIG.backendUrl}/api/simulate/llm`, {
                instructions,
                messages
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (response.error) {
                console.log(` ✗ 錯誤 (${elapsed}s)`);
                console.error('       ' + response.error);
                throw new Error(response.error);
            }

            console.log(` ✓ 完成 (${elapsed}s)`);
            return response.response || '';
        } catch (error) {
            console.log(` ✗ 失敗`);
            console.error('       ' + error.message);
            // 返回 fallback 回應
            return '[ERROR: LLM call failed]';
        }
    }
}

// ============================================
// 導出
// ============================================

module.exports = {
    Simulator,
    buildProxyInstructions,
    buildCounterpartInstructions,
    CONFIG
};
