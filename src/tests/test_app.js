/**
 * Unit Tests for VoiceProxyApp (app.js)
 *
 * Run with: node src/tests/test_app.js
 *
 * Tests:
 * - Stop condition handlers (hard/soft)
 * - Controller trigger logic
 * - Directive handling
 */

// Mock localStorage for Node.js environment
const localStorageData = {};
global.localStorage = {
    getItem: (key) => localStorageData[key] || null,
    setItem: (key, value) => { localStorageData[key] = value; },
    removeItem: (key) => { delete localStorageData[key]; },
    clear: () => { Object.keys(localStorageData).forEach(key => delete localStorageData[key]); }
};

const { StateMachine } = require('../frontend/state_machine.js');
const { VoiceProxyApp, STOP_TYPE, DIRECTIVE_MAP } = require('../frontend/app.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  [PASS] ${message}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${message}`);
        failed++;
    }
}

function test(name, fn) {
    console.log(`\nTest: ${name}`);
    try {
        fn();
    } catch (err) {
        console.error(`  [ERROR] ${err.message}`);
        failed++;
    }
}

// =============================================================================
// Test 1: VoiceProxyApp Initialization
// =============================================================================
test('VoiceProxyApp initializes with correct defaults', () => {
    const app = new VoiceProxyApp();

    assert(app.stateMachine !== null, 'State machine is initialized');
    assert(app.stateMachine.getState() === 'INIT', 'Initial state is INIT');
    assert(app.config === null, 'Config is null before loading');
    assert(app.turnCount === 0, 'Turn count starts at 0');
    assert(app.conversationItems.length === 0, 'Conversation items is empty');
    assert(app.estimatedTokens === 0, 'Estimated tokens starts at 0');
    assert(app.memory === '', 'Memory is empty string');
    assert(app.pendingDirective === null, 'Pending directive is null');
});

// =============================================================================
// Test 2: Config Loading
// =============================================================================
test('loadConfig returns false when no config in localStorage', () => {
    const app = new VoiceProxyApp();

    // Clear localStorage
    localStorage.clear();

    const result = app.loadConfig();
    assert(result === false, 'loadConfig returns false when no config');
});

test('loadConfig parses valid config', () => {
    const app = new VoiceProxyApp();
    const testConfig = {
        goal: 'Test goal',
        rules: 'Test rules',
        voice: 'coral'
    };

    // Set config in localStorage
    localStorage.setItem('vpn_config', JSON.stringify(testConfig));

    const result = app.loadConfig();
    assert(result === true, 'loadConfig returns true for valid config');
    assert(app.config.goal === 'Test goal', 'Goal is parsed correctly');
    assert(app.config.voice === 'coral', 'Voice is parsed correctly');

    // Clean up
    localStorage.clear();
});

// =============================================================================
// Test 3: State Machine Integration
// =============================================================================
test('State machine transitions work through app', () => {
    const app = new VoiceProxyApp();
    const transitions = [];

    app.onStateChange = (oldState, newState) => {
        transitions.push({ from: oldState, to: newState });
    };

    assert(app.stateMachine.getState() === 'INIT', 'Starts in INIT');

    app.stateMachine.transition('LISTENING');
    assert(app.stateMachine.getState() === 'LISTENING', 'Transitioned to LISTENING');
    assert(transitions.length === 1, 'One transition recorded');
    assert(transitions[0].from === 'INIT', 'Transition from INIT');
    assert(transitions[0].to === 'LISTENING', 'Transition to LISTENING');
});

// =============================================================================
// Test 4: Token Estimation
// =============================================================================
test('Token estimation counts Chinese and English correctly', () => {
    const app = new VoiceProxyApp();

    // Item with mixed content
    const item = {
        content: [{
            text: '你好 world hello 世界'  // 4 Chinese chars + 2 English words
        }]
    };

    app._updateTokenEstimate(item);

    // Expected: 4 Chinese * 2 = 8 tokens + 2 English * 1.3 = 2.6 ≈ 3 tokens = 11 total
    // Allow some tolerance for rounding
    assert(app.estimatedTokens >= 10 && app.estimatedTokens <= 12,
        `Token estimate is reasonable (got ${app.estimatedTokens})`);
});

test('Token estimation accumulates across items', () => {
    const app = new VoiceProxyApp();

    const item1 = { content: [{ text: 'Hello world' }] };
    const item2 = { content: [{ text: 'Another message' }] };

    app._updateTokenEstimate(item1);
    const firstEstimate = app.estimatedTokens;

    app._updateTokenEstimate(item2);
    assert(app.estimatedTokens > firstEstimate, 'Tokens accumulate across items');
});

// =============================================================================
// Test 6: Controller Trigger Logic
// =============================================================================
test('Controller does NOT auto-trigger after 5 turns (disabled by design)', () => {
    // Note: Auto-trigger on turn count is disabled because:
    // 1. CONTINUE directive doesn't provide meaningful guidance
    // 2. Causes timing conflicts (conversation_already_has_active_response errors)
    // 3. The AI handles natural conversation flow on its own
    // Controller is only called when user clicks a button (explicit directive)

    const app = new VoiceProxyApp();
    let controllerCalled = false;

    // Mock controller call
    app._callController = () => {
        controllerCalled = true;
    };

    // Simulate 5 turns - should NOT trigger (feature disabled)
    app.turnCount = 5;
    app._checkControllerTrigger();
    assert(controllerCalled === false, 'Controller NOT called at 5 turns (disabled)');

    // Simulate 10 turns - should still NOT trigger
    app.turnCount = 10;
    app._checkControllerTrigger();
    assert(controllerCalled === false, 'Controller NOT called at 10 turns (disabled)');
});

test('Controller triggers on pending directive', () => {
    const app = new VoiceProxyApp();
    let calledDirective = null;

    app._callController = (directive) => {
        calledDirective = directive;
    };

    app.pendingDirective = 'AGREE';
    app.turnCount = 1;  // Not at 5 turn threshold
    app._checkControllerTrigger();

    assert(calledDirective === 'AGREE', 'Controller called with pending directive');
    assert(app.pendingDirective === null, 'Pending directive cleared after call');
});

test('Controller triggers on token threshold', () => {
    const app = new VoiceProxyApp();
    let controllerCalled = false;

    app._callController = () => {
        controllerCalled = true;
    };

    // Set tokens above 70% threshold (assuming 8000 max)
    app.turnCount = 1;  // Not at turn threshold
    app.estimatedTokens = 6000;  // 75%
    app._checkControllerTrigger();

    assert(controllerCalled === true, 'Controller called on token threshold');
});

// =============================================================================
// Test 7: Directive Handling
// =============================================================================
test('EMERGENCY_STOP directive triggers hard stop', () => {
    const app = new VoiceProxyApp();
    let hardStopCalled = false;

    app.config = { goal: 'test' };
    app._useDefaultButtonConfig();  // Initialize button config
    app.handleHardStop = () => {
        hardStopCalled = true;
    };

    app.handleDirective('EMERGENCY_STOP');
    assert(hardStopCalled === true, 'EMERGENCY_STOP triggers hard stop');
});

test('GOAL_MET directive calls controller', () => {
    const app = new VoiceProxyApp();
    let calledDirective = null;

    app.config = { goal: 'test' };
    app._useDefaultButtonConfig();  // Initialize button config
    app._callController = (directive) => {
        calledDirective = directive;
    };

    app.handleDirective('GOAL_MET');
    assert(calledDirective === 'GOAL_MET', 'GOAL_MET calls controller');
});

test('Regular directives queue when not in LISTENING state', () => {
    const app = new VoiceProxyApp();
    let controllerCalled = false;

    app.config = { goal: 'test' };
    app._useDefaultButtonConfig();  // Initialize button config
    app._callController = () => {
        controllerCalled = true;
    };

    // State is INIT, not LISTENING
    app.handleDirective('AGREE');

    assert(app.pendingDirective === 'AGREE', 'Directive queued as pending');
    assert(controllerCalled === false, 'Controller not called immediately in INIT state');
});

test('Regular directives call controller immediately in LISTENING state', () => {
    const app = new VoiceProxyApp();
    let calledDirective = null;

    app.config = { goal: 'test' };
    app._useDefaultButtonConfig();  // Initialize button config
    app._callController = (directive) => {
        calledDirective = directive;
    };

    // Transition to LISTENING
    app.stateMachine.transition('LISTENING');

    app.handleDirective('DISAGREE');

    assert(calledDirective === 'DISAGREE', 'Directive sent immediately in LISTENING state');
    assert(app.pendingDirective === null, 'No pending directive after immediate call');
});

// =============================================================================
// Test 8: Reset Functionality
// =============================================================================
test('reset() clears all state', () => {
    const app = new VoiceProxyApp();

    // Set some state
    app.turnCount = 10;
    app.conversationItems = [{ test: 'item' }];
    app.estimatedTokens = 500;
    app.memory = 'some memory';
    app.previousResponseId = 'resp_123';
    app.pendingDirective = 'AGREE';
    app.stateMachine.transition('LISTENING');

    // Mock disconnect to avoid WebRTC cleanup
    app.disconnect = () => {
        app.stateMachine.transition('STOPPING');
        app.stateMachine.transition('STOPPED');
    };

    app.reset();

    assert(app.turnCount === 0, 'Turn count reset to 0');
    assert(app.conversationItems.length === 0, 'Conversation items cleared');
    assert(app.estimatedTokens === 0, 'Estimated tokens reset to 0');
    assert(app.memory === '', 'Memory cleared');
    assert(app.previousResponseId === null, 'Previous response ID cleared');
    assert(app.pendingDirective === null, 'Pending directive cleared');
    assert(app.stateMachine.getState() === 'INIT', 'State machine reset to INIT');
});

// =============================================================================
// Test 9: DIRECTIVE_MAP and STOP_TYPE Constants
// =============================================================================
test('DIRECTIVE_MAP contains all expected directives', () => {
    const expectedDirectives = [
        'AGREE', 'DISAGREE', 'NEED_TIME', 'REPEAT',
        'PROPOSE_ALTERNATIVE', 'ASK_BOTTOM_LINE',
        'SAY_GOODBYE', 'GOAL_MET', 'EMERGENCY_STOP', 'CONTINUE'
    ];

    for (const directive of expectedDirectives) {
        assert(DIRECTIVE_MAP[directive] !== undefined,
            `DIRECTIVE_MAP contains ${directive}`);
    }
});

test('STOP_TYPE has hard and soft types', () => {
    assert(STOP_TYPE.HARD === 'hard', 'STOP_TYPE.HARD is "hard"');
    assert(STOP_TYPE.SOFT === 'soft', 'STOP_TYPE.SOFT is "soft"');
});

// =============================================================================
// Test: Transcript Ordering Fix
// =============================================================================
test('Transcript ordering: pendingCounterpartTranscript starts as false', () => {
    const app = new VoiceProxyApp();
    assert(app.pendingCounterpartTranscript === false, 'pendingCounterpartTranscript is initially false');
    assert(Array.isArray(app.pendingAITranscripts), 'pendingAITranscripts is an array');
    assert(app.pendingAITranscripts.length === 0, 'pendingAITranscripts is initially empty');
});

test('Transcript ordering: reset() clears transcript ordering state', () => {
    const app = new VoiceProxyApp();
    app.pendingCounterpartTranscript = true;
    app.pendingAITranscripts = ['test1', 'test2'];

    app.reset();

    assert(app.pendingCounterpartTranscript === false, 'pendingCounterpartTranscript reset to false');
    assert(app.pendingAITranscripts.length === 0, 'pendingAITranscripts cleared');
});

// =============================================================================
// Summary
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
    process.exit(1);
}
