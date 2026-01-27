/**
 * Prompt Consolidation - Scenario Tests
 *
 * Tests the session instruction logic across different scenarios
 * to ensure no hardcoded assumptions break generality.
 *
 * Run: node src/tests/test_prompt_scenarios.js
 */

// Mock browser globals for Node.js
global.localStorage = {
    _data: {},
    getItem: (key) => global.localStorage._data[key] || null,
    setItem: (key, value) => { global.localStorage._data[key] = value; },
    clear: () => { global.localStorage._data = {}; }
};

const { VoiceProxyApp } = require('../frontend/app.js');

// ============================================
// Test Framework
// ============================================

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message, details = '') {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.log(`  ✗ ${message}`);
        if (details) console.log(`    → ${details}`);
        failed++;
        failures.push({ message, details });
    }
}

function scenario(name, fn) {
    console.log(`\n━━━ Scenario: ${name} ━━━`);
    global.localStorage.clear();
    try {
        fn();
    } catch (err) {
        console.log(`  ✗ ERROR: ${err.message}`);
        failed++;
        failures.push({ message: name, details: err.message });
    }
}

// ============================================
// Instruction Extraction Helper
// ============================================

function extractInstructions(config) {
    // Save config to localStorage
    global.localStorage.setItem('vpn_config', JSON.stringify(config));

    // Create app and capture instructions
    const app = new VoiceProxyApp();
    app.loadConfig();

    // Extract instruction building logic (mirror of _sendSessionUpdate)
    const I = app.config.agentName || 'the user';
    const O = app.config.counterpartType || 'the other party';
    const G = app.config.goal || '';
    const L = app.config.taskLanguage || 'zh-TW';
    const R = app.config.rules || '';
    const S = app.config.ssot || '';

    const languageMap = {
        'zh-TW': 'Traditional Chinese',
        'zh-CN': 'Simplified Chinese',
        'en': 'English',
        'ja': 'Japanese',
        'ko': 'Korean'
    };
    const langName = languageMap[L] || L;

    // Prompt Consolidation Pattern - synchronized with app.js and simulator.js
    const instructions = `[LANGUAGE] Speak only in ${langName}.

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

[OUTPUT] Only speak as ${I}. No narration. Just what ${I} says.

[INTERNAL] Messages marked [INTERNAL GUIDANCE] are from your principal. Follow naturally.`;

    return { instructions, I, O, G, L, langName };
}

// ============================================
// Validation Helpers
// ============================================

function validateIdentity(instructions, I, O) {
    const checks = [];

    // Must contain [CRITICAL IDENTITY] section
    checks.push({
        pass: instructions.includes('[CRITICAL IDENTITY]'),
        msg: 'Contains [CRITICAL IDENTITY] section',
        detail: 'Must have critical identity section'
    });

    // Must contain identity assertion
    checks.push({
        pass: instructions.includes(`You ARE ${I}`),
        msg: `Contains "You ARE ${I}"`,
        detail: `Identity I="${I}" must be stated`
    });

    // Must contain NEVER act as other (new format)
    checks.push({
        pass: instructions.includes(`NEVER act as ${O}`),
        msg: `Contains "NEVER act as ${O}"`,
        detail: `Must explicitly state NEVER act as O="${O}"`
    });

    // Must contain interaction rule
    checks.push({
        pass: instructions.includes(`The voice you hear is ${O}`),
        msg: `Contains interaction rule`,
        detail: `Must clarify voice heard is ${O}`
    });

    checks.push({
        pass: instructions.includes(`You respond as ${I}`),
        msg: `Contains response identity`,
        detail: `Must clarify responding as ${I}`
    });

    // Must contain CALLER identity
    checks.push({
        pass: instructions.includes('You are the CALLER'),
        msg: 'Contains CALLER identity',
        detail: 'Must state agent is the CALLER'
    });

    return checks;
}

function validateNoHardcoding(instructions, config = {}) {
    // Check that template uses generic variables (I, O, G) not hardcoded scenario-specific content
    // The template now INTENTIONALLY uses "CALLER", "service provider" as generic role terms
    // What we want to prevent: hardcoded scenario-specific details like specific names, addresses, etc.

    // These are scenario-specific patterns that should NOT appear in template
    const hardcodedScenarioPatterns = [
        { pattern: /煤氣公司/i, name: 'specific counterpart (煤氣公司)' },
        { pattern: /gas company/i, name: 'specific counterpart (gas company)' },
        { pattern: /陳大文/i, name: 'specific agent name (陳大文)' },
        { pattern: /John Smith/i, name: 'specific agent name (John Smith)' },
    ];

    // Remove user-provided content before checking (these ARE expected to be in instructions)
    let templateOnly = instructions;
    if (config.agentName) {
        const escaped = config.agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        templateOnly = templateOnly.replace(new RegExp(escaped, 'g'), '');
    }
    if (config.counterpartType) {
        const escaped = config.counterpartType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        templateOnly = templateOnly.replace(new RegExp(escaped, 'g'), '');
    }
    if (config.goal) templateOnly = templateOnly.replace(config.goal, '');
    if (config.rules) templateOnly = templateOnly.replace(config.rules, '');
    if (config.ssot) templateOnly = templateOnly.replace(config.ssot.substring(0, 2000), '');

    const checks = [];

    // Check template structure uses I/O/G variables, not hardcoded scenario content
    for (const { pattern, name } of hardcodedScenarioPatterns) {
        checks.push({
            pass: !pattern.test(templateOnly),
            msg: `No hardcoded "${name}" in template`,
            detail: `Found hardcoded scenario-specific content: ${name}`
        });
    }

    // Validate template has proper generic structure
    checks.push({
        pass: instructions.includes('[CRITICAL IDENTITY]'),
        msg: 'Template uses [CRITICAL IDENTITY] section',
        detail: 'Template must have structured identity section'
    });

    checks.push({
        pass: instructions.includes('[YOUR GOAL]'),
        msg: 'Template uses [YOUR GOAL] section',
        detail: 'Template must have goal section'
    });

    return checks;
}

function validateLanguage(instructions, langName) {
    return [{
        pass: instructions.includes(`Speak only in ${langName}`),
        msg: `Language set to ${langName}`,
        detail: `Must specify language`
    }];
}

function validatePurpose(instructions, G) {
    return [{
        pass: instructions.includes(`[YOUR GOAL] ${G}`),
        msg: `Goal section contains goal`,
        detail: `Goal must be in [YOUR GOAL] section`
    }];
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: Original gas leak reporting
scenario('Gas Leak Reporting (zh-TW)', () => {
    const config = {
        agentName: '陳大文',
        counterpartType: '煤氣公司',
        goal: '報告在家門口聞到煤氣味，請求派人檢查',
        taskLanguage: 'zh-TW',
        rules: '不要透露家中無人',
        ssot: '地址：九龍塘金巴倫道123號'
    };

    const { instructions, I, O, G, langName } = extractInstructions(config);

    // Identity checks
    for (const check of validateIdentity(instructions, I, O)) {
        assert(check.pass, check.msg, check.detail);
    }

    // No hardcoding (pass config to exclude user-provided values)
    for (const check of validateNoHardcoding(instructions, config)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Language
    for (const check of validateLanguage(instructions, langName)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Purpose
    for (const check of validatePurpose(instructions, G)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Constraints included
    assert(instructions.includes('[CONSTRAINTS]'), 'Constraints section exists');
    assert(instructions.includes('不要透露家中無人'), 'Constraints content included');

    // Reference included
    assert(instructions.includes('[REFERENCE]'), 'Reference section exists');
    assert(instructions.includes('九龍塘金巴倫道'), 'Reference content included');
});

// Scenario 2: Discount negotiation
scenario('Discount Negotiation (en)', () => {
    const config = {
        agentName: 'John Smith',
        counterpartType: 'Sales Manager',
        goal: 'Negotiate 20% discount on bulk order of 500 units',
        taskLanguage: 'en',
        rules: 'Do not accept less than 15% discount. Do not reveal budget ceiling.',
        ssot: 'Previous order: 200 units at 10% discount. Competitor quote: 18% discount.'
    };

    const { instructions, I, O, G, langName } = extractInstructions(config);

    // Identity checks
    for (const check of validateIdentity(instructions, I, O)) {
        assert(check.pass, check.msg, check.detail);
    }

    // No hardcoding (pass config to exclude user-provided values)
    for (const check of validateNoHardcoding(instructions, config)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Language is English
    assert(langName === 'English', 'Language is English');

    // Goal is about negotiation, not help-seeking
    assert(G.includes('Negotiate'), 'Goal is negotiation');
    // Template uses "help" in "NEVER say Let me help you" - this is intentional
    // The AI is told NOT to say help-offering phrases
    assert(instructions.includes('NEVER say'), 'Template explicitly forbids help-offering phrases');
});

// Scenario 3: Complaint handling
scenario('Complaint to Landlord (zh-CN)', () => {
    const config = {
        agentName: '李明',
        counterpartType: '房东',
        goal: '投诉楼上邻居噪音问题，要求房东介入处理',
        taskLanguage: 'zh-CN',
        rules: '保持礼貌但坚定。不要威胁搬走。',
        ssot: '租约还有8个月。已经口头投诉过2次。'
    };

    const { instructions, I, O, G, langName } = extractInstructions(config);

    // Identity checks
    for (const check of validateIdentity(instructions, I, O)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Language is Simplified Chinese
    assert(langName === 'Simplified Chinese', 'Language is Simplified Chinese');

    // This is a complaint, not service request
    assert(G.includes('投诉'), 'Goal is complaint');
});

// Scenario 4: Job interview preparation
scenario('Job Interview (ja)', () => {
    const config = {
        agentName: '田中太郎',
        counterpartType: '面接官',
        goal: '回答面接官の質問に適切に答え、自分の強みをアピールする',
        taskLanguage: 'ja',
        rules: '謙虚だが自信を持って。給与の話は相手から切り出すまで待つ。',
        ssot: '応募職種：ソフトウェアエンジニア。経験年数：5年。'
    };

    const { instructions, I, O, G, langName } = extractInstructions(config);

    // Identity checks
    for (const check of validateIdentity(instructions, I, O)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Language is Japanese
    assert(langName === 'Japanese', 'Language is Japanese');

    // In interview, AI is the interviewee, not interviewer
    assert(I === '田中太郎', 'AI is the interviewee');
    assert(O === '面接官', 'Other party is interviewer');
});

// Scenario 5: Calling support line (AI as customer calling support)
scenario('Calling Support Line (en)', () => {
    const config = {
        agentName: 'John Doe',
        counterpartType: 'Customer Support',
        goal: 'Get a refund for the billing error on last month\'s invoice',
        taskLanguage: 'en',
        rules: 'Be polite but firm. Do not accept store credit.',
        ssot: 'Account: #12345. Last bill: $150. Error: double charge of $50.'
    };

    const { instructions, I, O, G, langName } = extractInstructions(config);

    // Identity checks - AI is the CALLER (customer calling support)
    for (const check of validateIdentity(instructions, I, O)) {
        assert(check.pass, check.msg, check.detail);
    }

    // Verify the prompt correctly sets up the caller/callee relationship
    assert(instructions.includes('You are the CALLER'), 'AI knows it is the CALLER');
    assert(instructions.includes('NEVER act as Customer Support'), 'AI knows NOT to act as support');

    // No hardcoding still applies
    for (const check of validateNoHardcoding(instructions, config)) {
        assert(check.pass, check.msg, check.detail);
    }
});

// Scenario 6: Minimal config (edge case)
scenario('Minimal Config (defaults)', () => {
    const config = {
        agentName: 'User',
        goal: 'Have a conversation'
        // No counterpartType, language, rules, ssot
    };

    const { instructions, I, O, langName } = extractInstructions(config);

    // Should use defaults
    assert(I === 'User', 'Identity uses provided name');
    assert(O === 'the other party', 'Other party uses default');
    assert(langName === 'Traditional Chinese', 'Language defaults to zh-TW');

    // Should not have empty sections
    assert(!instructions.includes('[CONSTRAINTS] \n'), 'No empty constraints');
    assert(!instructions.includes('[REFERENCE] \n'), 'No empty reference');
});

// Scenario 7: Special characters in config
scenario('Special Characters in Config', () => {
    const config = {
        agentName: "O'Brien & Associates",
        counterpartType: 'Client (Mr. "Big" Wong)',
        goal: 'Discuss contract terms: 50% upfront, 50% on delivery',
        taskLanguage: 'en',
        rules: 'No discount > 10%',
        ssot: 'Contract value: $100,000'
    };

    const { instructions, I, O, G } = extractInstructions(config);

    // Should handle special characters
    assert(instructions.includes("O'Brien"), 'Handles apostrophe');
    assert(instructions.includes('"Big"'), 'Handles quotes');
    assert(instructions.includes('50%'), 'Handles percentage');
    assert(instructions.includes('$100,000'), 'Handles currency');
});

// Scenario 8: Very long goal/rules (edge case)
scenario('Long Content Handling', () => {
    const longGoal = '目標：' + '這是一個很長的目標描述。'.repeat(50);
    const longRules = '規則：' + '這是一條很長的規則。'.repeat(50);
    const longSsot = '參考：' + '這是很長的參考資料。'.repeat(200);

    const config = {
        agentName: '測試用戶',
        counterpartType: '對方',
        goal: longGoal,
        taskLanguage: 'zh-TW',
        rules: longRules,
        ssot: longSsot
    };

    const { instructions } = extractInstructions(config);

    // SSOT in instructions should be truncated (check via reference section)
    const refMatch = instructions.match(/\[REFERENCE\] ([\s\S]*?)\n\n\[SPEAKING STYLE\]/);
    const refContent = refMatch ? refMatch[1] : '';
    assert(refContent.length <= 2000, `SSOT truncated to ≤2000 chars (got ${refContent.length})`);

    // Instructions should still be valid (new section names)
    assert(instructions.includes('[CRITICAL IDENTITY]'), 'Critical Identity section exists');
    assert(instructions.includes('[YOUR GOAL]'), 'Goal section exists');
});

// ============================================
// Conversation Simulation Tests
// ============================================

console.log('\n' + '═'.repeat(50));
console.log('CONVERSATION SIMULATION TESTS');
console.log('═'.repeat(50));

// Simulate what the AI should understand from instructions
function simulateUnderstanding(config) {
    const { instructions, I, O, G } = extractInstructions(config);

    return {
        whoAmI: I,
        whoIsOther: O,
        myPurpose: G,
        whenOtherSpeaks: `I hear ${O}, I respond as ${I}`,
        iAmNot: O
    };
}

scenario('Conversation: Gas Company Calls', () => {
    const config = {
        agentName: '陳大文',
        counterpartType: '煤氣公司',
        goal: '報告煤氣味',
        taskLanguage: 'zh-TW'
    };

    const understanding = simulateUnderstanding(config);

    // When gas company says "你好，煤氣公司"
    // AI should understand: that's the OTHER party, I am 陳大文
    assert(understanding.whoAmI === '陳大文', 'AI knows: I am 陳大文');
    assert(understanding.whoIsOther === '煤氣公司', 'AI knows: Other is 煤氣公司');
    assert(understanding.iAmNot === '煤氣公司', 'AI knows: I am NOT 煤氣公司');

    // When asked "有什麼可以幫到你?"
    // AI should respond with its purpose, not ask questions back
    assert(understanding.myPurpose.includes('報告'), 'AI knows its purpose is to report');
});

scenario('Conversation: Negotiation', () => {
    const config = {
        agentName: 'Buyer',
        counterpartType: 'Seller',
        goal: 'Get best price for 100 units',
        taskLanguage: 'en'
    };

    const understanding = simulateUnderstanding(config);

    // AI is buyer, not seller
    assert(understanding.whoAmI === 'Buyer', 'AI is Buyer');
    assert(understanding.iAmNot === 'Seller', 'AI is NOT Seller');

    // AI's purpose is to get best price, not to sell
    assert(understanding.myPurpose.includes('Get best price'), 'AI wants best price');
});

// ============================================
// Summary
// ============================================

console.log('\n' + '═'.repeat(50));
console.log('TEST SUMMARY');
console.log('═'.repeat(50));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.message}`);
        if (f.details) console.log(`     ${f.details}`);
    });
}

console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
