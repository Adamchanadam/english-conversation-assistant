/**
 * Unit Tests for State Machine
 *
 * Run with: node src/tests/test_state_machine.js
 */

const { StateMachine, VALID_TRANSITIONS, STATES } = require('../frontend/state_machine.js');

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
// Test 1: Valid Transition Sequence
// =============================================================================
test('Valid transition sequence: INIT -> LISTENING -> THINKING -> SPEAKING -> LISTENING -> STOPPING -> STOPPED', () => {
  const sm = new StateMachine();

  assert(sm.getState() === 'INIT', 'Initial state is INIT');

  assert(sm.transition('LISTENING') === true, 'INIT -> LISTENING succeeds');
  assert(sm.getState() === 'LISTENING', 'State is now LISTENING');

  assert(sm.transition('THINKING') === true, 'LISTENING -> THINKING succeeds');
  assert(sm.getState() === 'THINKING', 'State is now THINKING');

  assert(sm.transition('SPEAKING') === true, 'THINKING -> SPEAKING succeeds');
  assert(sm.getState() === 'SPEAKING', 'State is now SPEAKING');

  assert(sm.transition('LISTENING') === true, 'SPEAKING -> LISTENING succeeds');
  assert(sm.getState() === 'LISTENING', 'State is now LISTENING');

  assert(sm.transition('STOPPING') === true, 'LISTENING -> STOPPING succeeds');
  assert(sm.getState() === 'STOPPING', 'State is now STOPPING');

  assert(sm.transition('STOPPED') === true, 'STOPPING -> STOPPED succeeds');
  assert(sm.getState() === 'STOPPED', 'State is now STOPPED');
});

// =============================================================================
// Test 2: Invalid Transitions
// =============================================================================
test('Invalid transitions should return false', () => {
  const sm = new StateMachine();

  // INIT -> SPEAKING (skipping LISTENING)
  assert(sm.canTransition('SPEAKING') === false, 'INIT cannot transition to SPEAKING');
  assert(sm.transition('SPEAKING') === false, 'INIT -> SPEAKING fails');
  assert(sm.getState() === 'INIT', 'State remains INIT after failed transition');

  // Transition to LISTENING first
  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.transition('SPEAKING');
  sm.transition('STOPPING');
  sm.transition('STOPPED');

  // STOPPED -> INIT (terminal state cannot transition)
  assert(sm.canTransition('INIT') === false, 'STOPPED cannot transition to INIT');
  assert(sm.transition('INIT') === false, 'STOPPED -> INIT fails');
  assert(sm.getState() === 'STOPPED', 'State remains STOPPED after failed transition');

  // STOPPED -> any state
  assert(sm.transition('LISTENING') === false, 'STOPPED -> LISTENING fails');
  assert(sm.transition('STOPPED') === false, 'STOPPED -> STOPPED fails');
});

test('Invalid state name returns false', () => {
  const sm = new StateMachine();

  assert(sm.canTransition('INVALID_STATE') === false, 'Cannot transition to invalid state');
  assert(sm.transition('INVALID_STATE') === false, 'Transition to invalid state fails');
  assert(sm.getState() === 'INIT', 'State remains INIT');
});

// =============================================================================
// Test 3: Listener Callbacks
// =============================================================================
test('onTransition listeners are called correctly', () => {
  const sm = new StateMachine();
  const transitions = [];

  sm.onTransition((oldState, newState) => {
    transitions.push({ from: oldState, to: newState });
  });

  sm.transition('LISTENING');
  sm.transition('THINKING');

  assert(transitions.length === 2, 'Two transitions recorded');
  assert(transitions[0].from === 'INIT' && transitions[0].to === 'LISTENING',
    'First transition: INIT -> LISTENING');
  assert(transitions[1].from === 'LISTENING' && transitions[1].to === 'THINKING',
    'Second transition: LISTENING -> THINKING');
});

test('Multiple listeners are all called', () => {
  const sm = new StateMachine();
  let listener1Called = false;
  let listener2Called = false;

  sm.onTransition(() => { listener1Called = true; });
  sm.onTransition(() => { listener2Called = true; });

  sm.transition('LISTENING');

  assert(listener1Called === true, 'Listener 1 was called');
  assert(listener2Called === true, 'Listener 2 was called');
});

test('Listener errors do not break state machine', () => {
  const sm = new StateMachine();
  let secondListenerCalled = false;

  sm.onTransition(() => { throw new Error('Intentional error'); });
  sm.onTransition(() => { secondListenerCalled = true; });

  const result = sm.transition('LISTENING');

  assert(result === true, 'Transition still succeeds');
  assert(sm.getState() === 'LISTENING', 'State changed correctly');
  assert(secondListenerCalled === true, 'Second listener was still called');
});

// =============================================================================
// Test 4: Reset Functionality
// =============================================================================
test('reset() returns state to INIT', () => {
  const sm = new StateMachine();

  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.transition('SPEAKING');

  assert(sm.getState() === 'SPEAKING', 'State is SPEAKING before reset');

  sm.reset();

  assert(sm.getState() === 'INIT', 'State is INIT after reset');
});

test('reset() triggers listener callback', () => {
  const sm = new StateMachine();
  let resetTransition = null;

  sm.onTransition((oldState, newState) => {
    resetTransition = { from: oldState, to: newState };
  });

  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.reset();

  assert(resetTransition.from === 'THINKING', 'Reset callback has correct old state');
  assert(resetTransition.to === 'INIT', 'Reset callback has correct new state (INIT)');
});

test('reset() from STOPPED state works', () => {
  const sm = new StateMachine();

  sm.transition('LISTENING');
  sm.transition('STOPPING');
  sm.transition('STOPPED');

  assert(sm.getState() === 'STOPPED', 'State is STOPPED');

  sm.reset();

  assert(sm.getState() === 'INIT', 'State is INIT after reset from STOPPED');

  // Can now transition again
  assert(sm.transition('LISTENING') === true, 'Can transition after reset');
});

// =============================================================================
// Test 5: Additional Edge Cases
// =============================================================================
test('SPEAKING -> CHECKPOINT transition works', () => {
  const sm = new StateMachine();

  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.transition('SPEAKING');

  assert(sm.transition('CHECKPOINT') === true, 'SPEAKING -> CHECKPOINT succeeds');
  assert(sm.getState() === 'CHECKPOINT', 'State is now CHECKPOINT');

  assert(sm.transition('LISTENING') === true, 'CHECKPOINT -> LISTENING succeeds');
  assert(sm.getState() === 'LISTENING', 'State is now LISTENING');
});

test('canTransition does not change state', () => {
  const sm = new StateMachine();

  sm.canTransition('LISTENING');
  sm.canTransition('SPEAKING');
  sm.canTransition('STOPPED');

  assert(sm.getState() === 'INIT', 'State unchanged after canTransition calls');
});

test('All states can transition to STOPPING (except INIT and STOPPED)', () => {
  // LISTENING -> STOPPING
  let sm = new StateMachine();
  sm.transition('LISTENING');
  assert(sm.canTransition('STOPPING') === true, 'LISTENING can transition to STOPPING');

  // THINKING -> STOPPING
  sm = new StateMachine();
  sm.transition('LISTENING');
  sm.transition('THINKING');
  assert(sm.canTransition('STOPPING') === true, 'THINKING can transition to STOPPING');

  // SPEAKING -> STOPPING
  sm = new StateMachine();
  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.transition('SPEAKING');
  assert(sm.canTransition('STOPPING') === true, 'SPEAKING can transition to STOPPING');

  // CHECKPOINT -> STOPPING
  sm = new StateMachine();
  sm.transition('LISTENING');
  sm.transition('THINKING');
  sm.transition('SPEAKING');
  sm.transition('CHECKPOINT');
  assert(sm.canTransition('STOPPING') === true, 'CHECKPOINT can transition to STOPPING');
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
