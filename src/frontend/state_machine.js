/**
 * State Machine for Voice Proxy Negotiator
 *
 * States: INIT -> LISTENING -> THINKING -> SPEAKING -> CHECKPOINT -> STOPPING -> STOPPED
 */

const VALID_TRANSITIONS = {
  'INIT':       ['LISTENING'],
  'LISTENING':  ['THINKING', 'STOPPING'],
  'THINKING':   ['SPEAKING', 'STOPPING'],
  'SPEAKING':   ['LISTENING', 'CHECKPOINT', 'STOPPING'],
  'CHECKPOINT': ['LISTENING', 'STOPPING'],
  'STOPPING':   ['STOPPED'],
  'STOPPED':    []  // Terminal state, no transitions allowed
};

const STATES = Object.keys(VALID_TRANSITIONS);

class StateMachine {
  constructor() {
    this._state = 'INIT';
    this._listeners = [];
  }

  /**
   * Check if transition to newState is valid from current state
   * @param {string} newState - Target state
   * @returns {boolean} - True if transition is valid
   */
  canTransition(newState) {
    if (!STATES.includes(newState)) {
      return false;
    }
    const allowedTransitions = VALID_TRANSITIONS[this._state];
    return allowedTransitions.includes(newState);
  }

  /**
   * Attempt to transition to newState
   * @param {string} newState - Target state
   * @returns {boolean} - True if transition succeeded, false otherwise
   */
  transition(newState) {
    const oldState = this._state;

    if (!this.canTransition(newState)) {
      console.error(`Invalid transition: ${oldState} -> ${newState}`);
      return false;
    }

    this._state = newState;

    // Notify all listeners
    for (const callback of this._listeners) {
      try {
        callback(oldState, newState);
      } catch (err) {
        console.error('Error in transition listener:', err);
      }
    }

    return true;
  }

  /**
   * Register a callback for state transitions
   * @param {Function} callback - Function to call on transition (oldState, newState)
   */
  onTransition(callback) {
    if (typeof callback === 'function') {
      this._listeners.push(callback);
    }
  }

  /**
   * Get current state
   * @returns {string} - Current state
   */
  getState() {
    return this._state;
  }

  /**
   * Reset state machine to INIT state
   */
  reset() {
    const oldState = this._state;
    this._state = 'INIT';

    // Notify listeners of reset
    for (const callback of this._listeners) {
      try {
        callback(oldState, 'INIT');
      } catch (err) {
        console.error('Error in transition listener:', err);
      }
    }
  }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateMachine, VALID_TRANSITIONS, STATES };
}
