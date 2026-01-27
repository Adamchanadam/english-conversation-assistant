#!/usr/bin/env node
/**
 * 3-Party Simulation Test Runner
 *
 * 執行三方互動測試，評估 AI Proxy 的任務成功率
 *
 * Usage:
 *   node src/tests/simulation/run_simulation.js
 *   node src/tests/simulation/run_simulation.js --scenario "煤氣味報告"
 *   node src/tests/simulation/run_simulation.js --verbose
 *   node src/tests/simulation/run_simulation.js --output reports/simulation_report.json
 *   node src/tests/simulation/run_simulation.js --offline  # 離線模式（使用 mock LLM）
 *
 * @module run_simulation
 */

const fs = require('fs');
const path = require('path');
const { Simulator, CONFIG } = require('./simulator');
const { Evaluator, generateReport, generateJsonReport } = require('./evaluator');

// ============================================
// 命令行參數解析
// ============================================

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        scenario: null,
        verbose: false,
        output: null,
        offline: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--scenario':
            case '-s':
                options.scenario = args[++i];
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--output':
            case '-o':
                options.output = args[++i];
                break;
            case '--offline':
                options.offline = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
        }
    }

    return options;
}

function showHelp() {
    console.log(`
3-Party Simulation Test Runner
================================

Usage:
  node run_simulation.js [options]

Options:
  -s, --scenario <name>  執行特定場景
  -v, --verbose          詳細輸出
  -o, --output <file>    輸出 JSON 報告到檔案
      --offline          離線模式（使用 mock LLM）
  -h, --help             顯示幫助

Examples:
  node run_simulation.js                          # 執行所有場景
  node run_simulation.js --scenario "煤氣味報告"   # 執行特定場景
  node run_simulation.js --verbose --offline      # 詳細輸出，離線模式
`);
}

// ============================================
// 場景載入
// ============================================

function loadScenarios(scenarioDir) {
    const scenarios = [];
    const files = fs.readdirSync(scenarioDir);

    for (const file of files) {
        if (file.endsWith('.json')) {
            const filePath = path.join(scenarioDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const scenario = JSON.parse(content);
                // 保存檔名作為別名（不含 .json）
                scenario._fileName = file.replace('.json', '');
                scenarios.push(scenario);
            } catch (e) {
                console.error(`Failed to load scenario ${file}: ${e.message}`);
            }
        }
    }

    return scenarios;
}

// ============================================
// 預設場景（內建）
// ============================================

const DEFAULT_SCENARIOS = [
    {
        name: "煤氣味報告",
        config: {
            agentName: "陳大文",
            counterpartType: "煤氣公司",
            goal: "報告在家門口聞到煤氣味，請求派人檢查",
            taskLanguage: "zh-TW",
            rules: "不要透露家中無人",
            ssot: "地址：九龍塘金巴倫道123號"
        },
        counterpartPersona: "你是煤氣公司客服，負責處理煤氣洩漏報告。詢問地址、情況嚴重程度，並安排檢查。",
        userActions: [
            { turn: 3, action: "AGREE" }
        ],
        successCriteria: {
            mustMention: ["陳大文"],
            mustNotSay: ["我是煤氣公司", "請問您在哪裡"],
            maxTurns: 6,
            goalKeywords: ["煤氣味", "檢查"]
        },
        maxTurns: 5
    },
    {
        name: "折扣談判",
        config: {
            agentName: "John Smith",
            counterpartType: "Sales Manager",
            goal: "Negotiate 20% discount on bulk order of 500 units",
            taskLanguage: "en",
            rules: "Do not accept less than 15% discount",
            ssot: "Previous order: 200 units at 10% discount"
        },
        counterpartPersona: "You are a sales manager. Start by offering 10% discount, then negotiate. Be professional but firm on pricing.",
        userActions: [
            { turn: 2, action: "DISAGREE" },
            { turn: 4, action: "PROPOSE_ALTERNATIVE" }
        ],
        successCriteria: {
            mustMention: ["John Smith"],
            mustNotSay: ["I am the sales manager", "What products"],
            maxTurns: 8,
            goalKeywords: ["discount", "20%", "15%"]
        },
        maxTurns: 6
    },
    {
        name: "投訴噪音問題",
        config: {
            agentName: "李明",
            counterpartType: "房東",
            goal: "投訴樓上鄰居噪音問題，要求房東介入處理",
            taskLanguage: "zh-CN",
            rules: "保持禮貌但堅定",
            ssot: "租約還有8個月"
        },
        counterpartPersona: "你是房東，接到租客投訴。先了解情況，再考慮如何處理。",
        userActions: [
            { turn: 3, action: "ASK_BOTTOM_LINE" }
        ],
        successCriteria: {
            mustMention: ["李明"],
            mustNotSay: ["我是房東"],
            maxTurns: 6,
            goalKeywords: ["噪音", "投訴", "處理"]
        },
        maxTurns: 5
    },
    {
        name: "求職面試",
        config: {
            agentName: "田中太郎",
            counterpartType: "面接官",
            goal: "回答面接官的問題，展示自己的優勢",
            taskLanguage: "ja",
            rules: "謙虛但自信",
            ssot: "應聘職位：軟體工程師，經驗：5年"
        },
        counterpartPersona: "あなたは面接官です。自己紹介を求め、志望動機と強みについて質問してください。",
        userActions: [],
        successCriteria: {
            mustMention: ["田中太郎"],
            mustNotSay: ["自己紹介をどうぞ"],
            maxTurns: 6,
            goalKeywords: ["エンジニア", "経験"]
        },
        maxTurns: 4
    },
    {
        name: "AI 作為客服（角色反轉）",
        config: {
            agentName: "Support Agent",
            counterpartType: "Customer",
            goal: "Help the customer resolve their billing issue",
            taskLanguage: "en",
            rules: "Be empathetic. Offer refund if error confirmed.",
            ssot: "Customer account: #12345. Last bill: $150."
        },
        counterpartPersona: "You are a frustrated customer. You were charged twice for the same order ($150 each time). You want a refund.",
        userActions: [
            { turn: 2, action: "AGREE" }
        ],
        successCriteria: {
            mustMention: [],
            mustNotSay: ["I have a billing problem"],
            maxTurns: 6,
            goalKeywords: ["refund", "help", "resolve"]
        },
        maxTurns: 5
    },
    {
        name: "誠實策略測試",
        config: {
            agentName: "王小明",
            counterpartType: "保險公司",
            goal: "詢問保險理賠流程",
            taskLanguage: "zh-TW",
            rules: "如不確定，承認不知道",
            ssot: "保單編號：A123456"
        },
        counterpartPersona: "你是保險公司客服，回答客戶關於理賠的問題。如果客戶問超出你權限的問題，請他們聯繫專員。",
        userActions: [],
        successCriteria: {
            mustMention: ["王小明"],
            mustNotSay: ["我是保險公司"],
            maxTurns: 6,
            goalKeywords: ["理賠", "保險"]
        },
        maxTurns: 4
    }
];

// ============================================
// Mock LLM（離線模式）
// ============================================

class MockSimulator {
    constructor(scenario, options = {}) {
        this.scenario = scenario;
        this.config = scenario.config;
        this.maxTurns = options.maxTurns || scenario.maxTurns || 5;
        this.verbose = options.verbose || false;
        this.userActions = scenario.userActions || [];
    }

    async run() {
        if (this.verbose) {
            console.log('\n' + '═'.repeat(60));
            console.log(`場景: ${this.scenario.name} [MOCK MODE]`);
            console.log('═'.repeat(60));
        }

        const turns = [];
        const I = this.config.agentName;
        const O = this.config.counterpartType;
        const G = this.config.goal;

        // 模擬對話
        const mockDialogs = this.getMockDialogs();

        for (let i = 0; i < Math.min(this.maxTurns, mockDialogs.length); i++) {
            const turn = i + 1;
            const userAction = this.userActions.find(a => a.turn === turn);

            if (this.verbose) {
                if (userAction) {
                    console.log(`\n[USER ACTION: ${userAction.action}]`);
                }
                console.log(`[Turn ${turn}] ${O}: "${mockDialogs[i].counterpart}"`);
                console.log(`[Turn ${turn}] ${I}: "${mockDialogs[i].proxy}"`);
            }

            turns.push({
                turn,
                counterpart: mockDialogs[i].counterpart,
                aiProxy: mockDialogs[i].proxy,
                userAction: userAction ? userAction.action : null
            });
        }

        return {
            scenario: this.scenario.name,
            config: this.config,
            turns,
            totalTurns: turns.length
        };
    }

    getMockDialogs() {
        const I = this.config.agentName;
        const O = this.config.counterpartType;
        const L = this.config.taskLanguage;

        // 根據語言和場景返回 mock 對話
        if (L === 'zh-TW' && O === '煤氣公司') {
            return [
                { counterpart: `你好，這裡是${O}，有什麼可以幫到你？`, proxy: `你好，我是${I}，我想報告在我家門口聞到煤氣味。` },
                { counterpart: '好的，請問具體位置在哪裡？', proxy: '在九龍塘金巴倫道123號門口附近。' },
                { counterpart: '明白了，我們會安排人員過去檢查。', proxy: '好的，謝謝你們的安排。' },
                { counterpart: '請問還有其他問題嗎？', proxy: '沒有了，謝謝。再見。' }
            ];
        } else if (L === 'en' && O === 'Sales Manager') {
            return [
                { counterpart: 'Hello, how can I help you today?', proxy: `Hi, I'm ${I}. I'd like to discuss pricing for a bulk order of 500 units.` },
                { counterpart: 'We can offer you 10% off for that volume.', proxy: 'I was hoping for something closer to 20% given the volume. Is that possible?' },
                { counterpart: 'The best I can do is 12%.', proxy: 'How about 15%? That would work within my budget.' },
                { counterpart: 'Let me check with my manager. 15% might be doable.', proxy: 'Great, I appreciate your flexibility. Please let me know.' },
                { counterpart: 'We can do 15%. Shall I prepare the order?', proxy: 'Yes, please proceed. Thank you for the discount.' }
            ];
        } else if (L === 'zh-CN' && O === '房東') {
            return [
                { counterpart: '喂，我是房东，有什么事？', proxy: `房东你好，我是${I}，我想投诉楼上的噪音问题。` },
                { counterpart: '噪音问题？具体是什么情况？', proxy: '每天晚上都很吵，影响我休息。已经持续好几周了。' },
                { counterpart: '我了解了，你希望我怎么处理？', proxy: '希望您能跟楼上邻居沟通一下，实在不行的话，有什么其他方案吗？' },
                { counterpart: '好的，我会找楼上谈谈。', proxy: '谢谢您的帮助。' }
            ];
        } else if (L === 'ja') {
            return [
                { counterpart: '自己紹介をお願いします。', proxy: `はじめまして、${I}と申します。ソフトウェアエンジニアとして5年の経験があります。` },
                { counterpart: '志望動機を教えてください。', proxy: '御社の技術力と成長環境に魅力を感じています。' },
                { counterpart: 'あなたの強みは何ですか？', proxy: 'チームワークと問題解決能力だと思います。' }
            ];
        } else if (L === 'en' && O === 'Customer') {
            return [
                { counterpart: 'Hi, I have a problem with my bill.', proxy: 'Hello, I\'m here to help. Could you tell me more about the billing issue?' },
                { counterpart: 'I was charged twice for the same order!', proxy: 'I apologize for the inconvenience. Let me look into that for you. Can you confirm your order number?' },
                { counterpart: 'It\'s order #12345.', proxy: 'I see the duplicate charge. I\'ll process a refund for the extra $150 right away.' },
                { counterpart: 'Thank you!', proxy: 'You\'re welcome. The refund should appear in 3-5 business days. Is there anything else?' }
            ];
        } else {
            return [
                { counterpart: `你好，這裡是${O}。`, proxy: `你好，我是${I}。${this.config.goal}` },
                { counterpart: '好的，我了解了。', proxy: '謝謝你的幫助。' },
                { counterpart: '還有其他問題嗎？', proxy: '沒有了，再見。' }
            ];
        }
    }
}

// ============================================
// 主程序
// ============================================

async function main() {
    const options = parseArgs();

    if (options.help) {
        showHelp();
        process.exit(0);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('3-Party Simulation Test');
    console.log('═'.repeat(60));

    if (options.offline) {
        console.log('[MODE] 離線模式（使用 Mock LLM）');
    } else {
        console.log(`[MODE] 線上模式（連接 ${CONFIG.backendUrl}）`);
    }

    // 載入場景
    let scenarios = DEFAULT_SCENARIOS;

    // 嘗試從檔案載入場景
    const scenarioDir = path.join(__dirname, 'scenarios');
    if (fs.existsSync(scenarioDir)) {
        const fileScenarios = loadScenarios(scenarioDir);
        if (fileScenarios.length > 0) {
            scenarios = fileScenarios;
            console.log(`[INFO] 從 ${scenarioDir} 載入了 ${fileScenarios.length} 個場景`);
        }
    }

    // 過濾特定場景（支援名稱或檔名匹配）
    if (options.scenario) {
        const searchTerm = options.scenario.toLowerCase();
        scenarios = scenarios.filter(s =>
            s.name === options.scenario ||
            s.name.toLowerCase().includes(searchTerm) ||
            (s._fileName && s._fileName.toLowerCase().includes(searchTerm))
        );
        if (scenarios.length === 0) {
            console.error(`[ERROR] 找不到場景: ${options.scenario}`);
            console.log('[INFO] 可用場景:');
            // 重新載入所有場景以顯示可用選項
            const allScenarios = fs.existsSync(scenarioDir)
                ? loadScenarios(scenarioDir)
                : DEFAULT_SCENARIOS;
            allScenarios.forEach(s => console.log(`  - ${s.name} (${s._fileName || 'builtin'})`));
            process.exit(1);
        }
    }

    console.log(`[INFO] 將執行 ${scenarios.length} 個場景\n`);

    // 執行模擬和評估
    const results = [];

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];

        // 即時顯示進度
        console.log(`\n[${ i + 1}/${scenarios.length}] 執行場景: ${scenario.name}`);
        console.log('─'.repeat(50));

        try {
            // 選擇模擬器
            const SimulatorClass = options.offline ? MockSimulator : Simulator;
            const simulator = new SimulatorClass(scenario, {
                verbose: options.verbose,
                maxTurns: scenario.maxTurns || 5
            });

            // 執行模擬
            console.log('  開始模擬對話...');
            const simResult = await simulator.run();
            console.log(`  對話完成，共 ${simResult.totalTurns} 輪`);

            // 評估結果
            console.log('  評估結果...');
            const evaluator = new Evaluator(scenario, simResult);
            const evalResult = evaluator.evaluate();

            results.push(evalResult);

            // 輸出報告
            if (options.verbose) {
                console.log(generateReport(evalResult));
            } else {
                const status = evalResult.result === 'PASS' ? '✓' : '✗';
                const m = evalResult.metrics;
                const goalStatus = m.goalAchieved ? '✓' : '✗';
                console.log(`  結果: ${status} 身份=${(m.identityAccuracy*100).toFixed(0)}%, 目標達成=${goalStatus}, 按鈕=${(m.buttonResponseRate*100).toFixed(0)}%`);
            }
        } catch (error) {
            console.error(`  [ERROR] 執行失敗: ${error.message}`);
            results.push({
                scenario: scenario.name,
                result: 'ERROR',
                error: error.message
            });
        }
    }

    // 總結
    console.log('\n' + '═'.repeat(60));
    console.log('測試總結');
    console.log('═'.repeat(60));

    const passed = results.filter(r => r.result === 'PASS').length;
    const failed = results.filter(r => r.result === 'FAIL').length;
    const errors = results.filter(r => r.result === 'ERROR').length;

    console.log(`通過: ${passed}`);
    console.log(`失敗: ${failed}`);
    if (errors > 0) console.log(`錯誤: ${errors}`);

    // 聚合指標
    const validResults = results.filter(r => r.metrics);
    if (validResults.length > 0) {
        const jsonReport = generateJsonReport(validResults);
        const agg = jsonReport.aggregateMetrics;

        console.log('\n聚合指標:');
        console.log(`  平均身份正確率: ${(agg.avgIdentityAccuracy * 100).toFixed(1)}%`);
        console.log(`  目標達成率: ${(agg.goalAchievedRate * 100).toFixed(1)}%`);
        console.log(`  平均按鈕響應率: ${(agg.avgButtonResponseRate * 100).toFixed(1)}%`);
        console.log(`  總體通過率: ${(agg.overallPassRate * 100).toFixed(1)}%`);

        // 輸出 JSON 報告
        if (options.output) {
            const outputDir = path.dirname(options.output);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(options.output, JSON.stringify(jsonReport, null, 2));
            console.log(`\n[INFO] JSON 報告已輸出到: ${options.output}`);
        }
    }

    console.log('═'.repeat(60));

    // 退出碼
    process.exit(failed + errors > 0 ? 1 : 0);
}

// 執行
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
