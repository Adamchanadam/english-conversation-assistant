/**
 * Voice Proxy Negotiator - Main Application
 *
 * Reference:
 * - design.md § 3 (FSM States)
 * - design.md § 8 (Stop conditions)
 * - tasks.md T1.6
 *
 * Integrates:
 * - StateMachine (state_machine.js)
 * - WebRTC Realtime connection (from spike)
 * - Controller API calls
 * - Stop conditions (hard/soft)
 */

// For Node.js environment (tests), import StateMachine
// For browser, StateMachine is already global from state_machine.js
(function() {
    if (typeof window === 'undefined' && typeof require !== 'undefined') {
        global.StateMachine = require('./state_machine.js').StateMachine;
    }
})();

// =============================================================================
// Constants
// =============================================================================

// API endpoints
const API_TOKEN_URL = '/api/token';
const API_CONTROLLER_URL = '/api/controller';

// Controller timing thresholds (design.md § 1.1)
const TURNS_PER_CONTROLLER_CALL = 5;
const TOKEN_THRESHOLD_PERCENT = 0.70;
const ESTIMATED_MAX_TOKENS = 8000;  // Approximate context limit for gpt-realtime-mini

// Stop condition types
const STOP_TYPE = {
    HARD: 'hard',   // Immediate cancel + clear
    SOFT: 'soft'    // Inject goodbye, then end
};

// Directive to controller mapping
const DIRECTIVE_MAP = {
    'AGREE': 'AGREE',
    'DISAGREE': 'DISAGREE',
    'NEED_TIME': 'NEED_TIME',
    'REPEAT': 'REPEAT',
    'PROPOSE_ALTERNATIVE': 'PROPOSE_ALTERNATIVE',
    'ASK_BOTTOM_LINE': 'ASK_BOTTOM_LINE',
    'SAY_GOODBYE': 'SAY_GOODBYE',
    'GOAL_MET': 'GOAL_MET',
    'EMERGENCY_STOP': 'EMERGENCY_STOP',
    'CONTINUE': 'CONTINUE'
};

// =============================================================================
// Default Button Configuration (design.md § 2.4)
// =============================================================================

const DEFAULT_BUTTONS = [
    // Row 1: 立場表達
    {
        id: "btn_agree",
        label: "同意",
        executionType: "continue",
        promptTemplate: "Express agreement with the other party's point.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal wants you to EXPRESS AGREEMENT with what the other party just said.
- React naturally to their specific point
- Show genuine understanding of WHY you agree
- Be warm and positive, but don't overdo it
- Remember: YOU speak FOR your principal, TO the other party`,
        buttonClass: "btn-secondary"
    },
    {
        id: "btn_disagree",
        label: "不同意",
        executionType: "continue",
        promptTemplate: "Express disagreement politely but firmly.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal wants you to DISAGREE with what the other party said.
- First show you understand their position (don't dismiss)
- Then express your disagreement with reasoning
- Be firm but respectful - this is a negotiation, not a fight
- Remember: YOU speak FOR your principal, TO the other party`,
        buttonClass: "btn-secondary"
    },
    {
        id: "btn_need_time",
        label: "我需要時間考慮",
        executionType: "continue",
        promptTemplate: "Request time to think before committing.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal needs TIME before deciding.
- Tell the other party you need time to think
- Don't reject or accept - just defer
- Give a natural reason (need to review, consult, think it over)
- Remember: YOU represent your principal in this conversation`,
        buttonClass: "btn-secondary"
    },

    // Row 2: 資訊收集
    {
        id: "btn_repeat",
        label: "請重複一次",
        executionType: "continue",
        promptTemplate: "Ask the other party to repeat or clarify.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal needs the other party to REPEAT or CLARIFY what they said.
- Ask naturally - maybe you missed something, or want more detail
- Be specific if possible about what part needs clarification
- Remember: YOU are asking the other party on behalf of your principal`,
        buttonClass: "btn-secondary"
    },
    {
        id: "btn_propose",
        label: "提出替代方案",
        executionType: "continue",
        promptTemplate: "Suggest an alternative approach.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal wants to PROPOSE SOMETHING DIFFERENT to the other party.
- Acknowledge their offer first
- Then pivot to your alternative idea
- Frame it as a win-win if possible
- Remember: YOU are negotiating WITH the other party FOR your principal`,
        buttonClass: "btn-secondary"
    },
    {
        id: "btn_ask_bottom",
        label: "詢問對方底線",
        executionType: "continue",
        promptTemplate: "Probe for the other party's minimum acceptable terms.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal wants to know the other party's BOTTOM LINE.
- Ask tactfully - don't demand
- Frame it as wanting to understand what's possible
- You might ask about flexibility, limits, must-haves
- Remember: YOU are probing the other party on behalf of your principal`,
        buttonClass: "btn-secondary"
    },

    // Row 3: 結束控制
    {
        id: "btn_goodbye",
        label: "是時候說再見",
        executionType: "natural_end",
        promptTemplate: "End the conversation gracefully.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
Your principal wants to END this conversation now.
- Wrap up naturally - don't just suddenly say goodbye
- Respond briefly to whatever they just said
- Signal you need to go (in your own words)
- Thank them warmly and say goodbye
- Make it feel like a natural ending, not an abrupt cutoff`,
        buttonClass: "btn-warning"
    },
    {
        id: "btn_goal_met",
        label: "達標",
        executionType: "natural_end",
        promptTemplate: "Goal achieved! Wrap up positively.",
        guidanceTemplate: `[INTERNAL GUIDANCE - NOT FROM THE OTHER PARTY]
SUCCESS! The goal has been achieved. End on a HIGH NOTE.
- Express genuine satisfaction/gratitude
- Acknowledge what was accomplished
- Wrap up warmly and positively
- Say goodbye with enthusiasm
- This is a celebration - sound happy!`,
        buttonClass: "btn-goal-met"
    },
    {
        id: "btn_emergency",
        label: "立即停止",
        executionType: "emergency",
        promptTemplate: null, // Not used - immediate disconnect
        guidanceTemplate: null,
        buttonClass: "btn-emergency"
    }
];

// Button ID to directive mapping (for backward compatibility)
const BUTTON_ID_TO_DIRECTIVE = {
    'btn_agree': 'AGREE',
    'btn_disagree': 'DISAGREE',
    'btn_need_time': 'NEED_TIME',
    'btn_repeat': 'REPEAT',
    'btn_propose': 'PROPOSE_ALTERNATIVE',
    'btn_ask_bottom': 'ASK_BOTTOM_LINE',
    'btn_goodbye': 'SAY_GOODBYE',
    'btn_goal_met': 'GOAL_MET',
    'btn_emergency': 'EMERGENCY_STOP'
};

// Directive to button ID mapping (reverse lookup)
const DIRECTIVE_TO_BUTTON_ID = {
    'AGREE': 'btn_agree',
    'DISAGREE': 'btn_disagree',
    'NEED_TIME': 'btn_need_time',
    'REPEAT': 'btn_repeat',
    'PROPOSE_ALTERNATIVE': 'btn_propose',
    'ASK_BOTTOM_LINE': 'btn_ask_bottom',
    'SAY_GOODBYE': 'btn_goodbye',
    'GOAL_MET': 'btn_goal_met',
    'EMERGENCY_STOP': 'btn_emergency'
};

// =============================================================================
// Main Application Class
// =============================================================================

class VoiceProxyApp {
    constructor() {
        // State machine
        this.stateMachine = new StateMachine();

        // WebRTC state
        this.peerConnection = null;
        this.dataChannel = null;
        this.localStream = null;

        // Session state
        this.config = null;
        this.tokenExpiresAt = null;
        this.currentAssistantItemId = null;
        this.audioPlaybackMs = 0;
        this.isAssistantSpeaking = false;

        // Conversation tracking
        this.turnCount = 0;
        this.conversationItems = [];
        this.estimatedTokens = 0;
        this.memory = '';
        this.previousResponseId = null;

        // Controller state
        this.pendingDirective = null;
        this.lastControllerCall = null;
        this.controllerAbortController = null;  // For cancelling pending API calls
        this.isDisconnecting = false;  // Flag to prevent actions during disconnect

        // Button context capture (for natural conversation flow)
        this.lastCounterpartUtterance = '';  // Track what counterpart last said
        this.lastAIUtterance = '';  // Track what AI last said
        this.capturedDirectiveContext = null;  // Context when button was pressed

        // Transcript ordering fix: ensure 📞 對方說 appears before 🤖 AI代理說
        // Problem: AI transcript arrives faster than counterpart's speech-to-text
        // Solution: Buffer AI transcripts until counterpart transcript arrives
        this.pendingCounterpartTranscript = false;  // Waiting for counterpart's transcript
        this.pendingAITranscripts = [];  // Buffered AI transcripts (display after counterpart)

        // Button configuration (dynamically configurable)
        this.buttonConfig = null;  // Loaded from localStorage or defaults

        // Audio monitoring
        this.audioContext = null;
        this.analyser = null;

        // Session timer (45 minute limit)
        this.sessionStartTime = null;
        this.sessionTimerInterval = null;
        this.sessionMaxMinutes = 45;
        this.notifiedMilestones = new Set();  // Track which notifications were shown

        // Callbacks for UI updates
        this.onLog = null;
        this.onStateChange = null;
        this.onConnectionChange = null;
        this.onMicChange = null;
        this.onSpeakerChange = null;
        this.onNotesForUser = null;
        this.onTimerUpdate = null;
        this.onTimerNotification = null;
        this.onSessionTimeout = null;

        // Bind state machine listener
        this.stateMachine.onTransition((oldState, newState) => {
            this._log(`狀態轉換: ${oldState} → ${newState}`, 'event');
            if (this.onStateChange) {
                this.onStateChange(oldState, newState);
            }
        });
    }

    // =========================================================================
    // Logging
    // =========================================================================

    _log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-TW');
        console.log(`[${type}] ${msg}`);
        if (this.onLog) {
            this.onLog(msg, type);
        }
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    loadConfig() {
        const savedConfig = localStorage.getItem('vpn_config');
        if (!savedConfig) {
            this._log('錯誤：未找到設定資料', 'error');
            return false;
        }

        try {
            this.config = JSON.parse(savedConfig);
            this._log('設定已載入', 'success');
            this._log(`任務目標: ${this.config.goal?.substring(0, 50) || '(未設定)'}...`, 'info');

            // Load button configuration (with fallback to defaults)
            this._loadButtonConfig();

            return true;
        } catch (e) {
            this._log(`設定解析失敗: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * Load button configuration from localStorage or use defaults
     * design.md § 2.4 - Backward compatibility: use DEFAULT_BUTTONS if no custom config
     */
    _loadButtonConfig() {
        const savedButtonConfig = localStorage.getItem('vpn_button_config');

        if (savedButtonConfig) {
            try {
                const customConfig = JSON.parse(savedButtonConfig);
                // Build lookup map by button ID
                this.buttonConfig = {};
                for (const btn of customConfig) {
                    this.buttonConfig[btn.id] = btn;
                }
                this._log(`已載入自定義按鈕配置 (${customConfig.length} 個按鈕)`, 'info');
            } catch (e) {
                this._log(`按鈕配置解析失敗，使用預設: ${e.message}`, 'warn');
                this._useDefaultButtonConfig();
            }
        } else {
            this._useDefaultButtonConfig();
        }
    }

    /**
     * Use default button configuration
     */
    _useDefaultButtonConfig() {
        this.buttonConfig = {};
        for (const btn of DEFAULT_BUTTONS) {
            this.buttonConfig[btn.id] = btn;
        }
        this._log('使用預設按鈕配置', 'info');
    }

    /**
     * Get button config by ID or directive name
     * Supports both new button IDs (btn_agree) and legacy directives (AGREE)
     */
    _getButtonConfig(idOrDirective) {
        // Try direct lookup first
        if (this.buttonConfig[idOrDirective]) {
            return this.buttonConfig[idOrDirective];
        }

        // Try mapping from directive to button ID
        const buttonId = DIRECTIVE_TO_BUTTON_ID[idOrDirective];
        if (buttonId && this.buttonConfig[buttonId]) {
            return this.buttonConfig[buttonId];
        }

        // Not found
        return null;
    }

    /**
     * Replace template variables in prompt/guidance templates
     * Supported variables: {{goal}}, {{lastCounterpart}}, {{lastAI}}, {{agentName}}, {{counterpartType}}, {{customInput}}
     */
    _replaceTemplateVariables(template, customInput = '') {
        if (!template) return template;

        const capturedContext = this.capturedDirectiveContext || {};

        const variables = {
            '{{goal}}': this.config?.goal || '(未設定)',
            '{{lastCounterpart}}': capturedContext.lastCounterpartUtterance || this.lastCounterpartUtterance || '',
            '{{lastAI}}': capturedContext.lastAIUtterance || this.lastAIUtterance || '',
            '{{agentName}}': this.config?.agentName || 'User',
            '{{counterpartType}}': this.config?.counterpartType || 'the other person',
            '{{customInput}}': customInput
        };

        let result = template;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
        }

        return result;
    }

    // =========================================================================
    // WebRTC Connection (based on spike/realtime_test.html)
    // =========================================================================

    async connect() {
        if (!this.config) {
            this._log('錯誤：請先載入設定', 'error');
            return false;
        }

        // Reset state for new connection
        this.isDisconnecting = false;
        this.stateMachine.reset();

        try {
            this._log('正在取得 ephemeral token...', 'info');
            if (this.onConnectionChange) {
                this.onConnectionChange('connecting', '連線中...');
            }

            // Step 1: Get ephemeral token
            const tokenResponse = await fetch(API_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice: this.config.voice || 'marin' })
            });

            if (!tokenResponse.ok) {
                const err = await tokenResponse.json();
                throw new Error(err.detail || 'Failed to get token');
            }

            const tokenData = await tokenResponse.json();
            this.tokenExpiresAt = tokenData.expires_at;
            const expiresIn = Math.round((this.tokenExpiresAt * 1000 - Date.now()) / 1000);
            this._log(`Token 取得成功 (TTL: ${expiresIn}s)`, 'success');

            // Step 2: Get microphone access
            this._log('請求麥克風權限...', 'info');
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._log('麥克風權限已取得', 'success');

            // Start audio monitoring
            this._startAudioMonitor(this.localStream);

            // Step 3: Create WebRTC connection
            this._log('建立 WebRTC 連線...', 'info');

            const rtcConfig = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            };

            this.peerConnection = new RTCPeerConnection(rtcConfig);

            // Add audio track
            const audioTrack = this.localStream.getAudioTracks()[0];
            audioTrack.enabled = true;
            this.peerConnection.addTrack(audioTrack, this.localStream);

            // Handle remote audio
            this.peerConnection.ontrack = (event) => {
                this._log('收到遠端音訊軌', 'success');
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.play().catch(e => this._log(`音訊播放錯誤: ${e.message}`, 'error'));

                // Track playback for truncate
                audio.ontimeupdate = () => {
                    this.audioPlaybackMs = Math.round(audio.currentTime * 1000);
                };
            };

            // Create data channel
            this.dataChannel = this.peerConnection.createDataChannel('oai-events');
            this._setupDataChannel();

            // ICE connection state
            this.peerConnection.oniceconnectionstatechange = () => {
                this._log(`ICE 狀態: ${this.peerConnection.iceConnectionState}`, 'event');
                if (this.peerConnection.iceConnectionState === 'connected') {
                    if (this.onConnectionChange) {
                        this.onConnectionChange('connected', '已連線');
                    }
                    // Transition state machine to LISTENING
                    this.stateMachine.transition('LISTENING');
                } else if (this.peerConnection.iceConnectionState === 'failed') {
                    this._log('ICE 連線失敗', 'error');
                    this.disconnect();
                }
            };

            // Create and send offer
            await this.peerConnection.setLocalDescription();
            this._log('SDP offer 已創建', 'info');

            // Step 4: Send offer to OpenAI Realtime
            this._log('發送 SDP offer 到 OpenAI...', 'info');
            const sdpResponse = await fetch(
                'https://api.openai.com/v1/realtime/calls',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${tokenData.client_secret}`,
                        'Content-Type': 'application/sdp'
                    },
                    body: this.peerConnection.localDescription.sdp
                }
            );

            if (!sdpResponse.ok) {
                throw new Error(`SDP exchange failed: ${sdpResponse.status}`);
            }

            const answerSdp = await sdpResponse.text();
            await this.peerConnection.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });

            this._log('WebRTC 連線建立完成', 'success');
            return true;

        } catch (error) {
            this._log(`連線失敗: ${error.message}`, 'error');
            if (this.onConnectionChange) {
                this.onConnectionChange('disconnected', '連線失敗');
            }
            this.disconnect();
            return false;
        }
    }

    _setupDataChannel() {
        this.dataChannel.onopen = () => {
            this._log('Data channel 已開啟', 'success');
            this._sendSessionUpdate();
            this._startSessionTimer();  // Start the 45-minute session timer
        };

        this.dataChannel.onclose = () => {
            this._log('Data channel 已關閉', 'warn');
        };

        this.dataChannel.onerror = (error) => {
            this._log(`Data channel 錯誤: ${error}`, 'error');
        };

        this.dataChannel.onmessage = (event) => {
            this._handleRealtimeEvent(JSON.parse(event.data));
        };
    }

    _sendSessionUpdate() {
        // ========================================
        // PROMPT CONSOLIDATION: Session Instructions
        // ========================================
        // DEFINITIONS (single source of truth - from config only):
        //   I = config.agentName (who the AI represents)
        //   O = config.counterpartType (the other party)
        //   G = config.goal (what to achieve)
        //   L = config.taskLanguage (language to use)
        //   R = config.rules (constraints)
        //   S = config.ssot (reference info)
        //
        // CORE RULES (4 immutable, no hardcoded scenarios):
        //   1. IDENTITY: AI = I, never O
        //   2. PURPOSE: AI pursues G
        //   3. LANGUAGE: AI speaks L
        //   4. INTERACTION: Voice heard = O, AI responds as I
        //
        // INSTRUCTIONS: Only reference definitions, no assumptions
        // ========================================

        const I = this.config.agentName || 'the user';
        const O = this.config.counterpartType || 'the other party';
        const G = this.config.goal || '';
        const L = this.config.taskLanguage || 'zh-TW';
        const R = this.config.rules || '';
        const S = this.config.ssot || '';

        const languageMap = {
            'zh-TW': 'Traditional Chinese',
            'zh-CN': 'Simplified Chinese',
            'en': 'English',
            'ja': 'Japanese',
            'ko': 'Korean'
        };
        const langName = languageMap[L] || L;

        // Prompt Consolidation Pattern - validated by 3-Party Simulation Tests (100% pass)
        // Enhanced with natural conversation rules (2026-01-28)
        // Root-cause fix for irrelevant answers (2026-01-28) - Answer relevance enforcement
        // ALL-ENGLISH prompt for multi-language support (2026-01-28)
        const instructions = `[LANGUAGE] Speak only in ${langName}.

[CRITICAL IDENTITY]
- You ARE ${I}.
- You are CALLING ${O} to achieve your goal.
- You are the CALLER, not the service provider.
- NEVER act as ${O}. NEVER give advice like a customer service rep.
- NEVER say "I understand" or "Let me help you" - those are ${O}'s lines, not yours.

[INTERACTION] The voice you hear is ${O} (the one you called). You respond as ${I} (the caller).

[YOUR GOAL] ${G}

${R ? `[CONSTRAINTS] ${R}` : ''}

${S ? `[FACTS I KNOW - This is ALL I know]
${S.substring(0, 2000)}
If ${O} asks about something NOT listed above, respond naturally (e.g., "I don't have that information right now, I can follow up later"). NEVER make up information.` : ''}

[SPEAKING STYLE]
- You are on a phone call as the CALLER.
- Introduce yourself ONLY ONCE at the start.
- Be concise. 1-2 sentences per turn.
- RESPOND FIRST, then pursue your goal. Never ignore ${O}'s question to talk about your goal.

[RESPONSE RULES - HIGHEST PRIORITY]
- LISTEN AND ANSWER: When ${O} asks a question, your answer MUST be about THAT question.
- ANSWER RELEVANCE: Your response must be semantically related to what ${O} asked. NEVER give unrelated information.
- IF YOU DON'T KNOW: Be honest but natural. You can say things like:
  * "I don't have that information right now, I can get back to you later"
  * "I need to check on that, I'll follow up"
  * "I'm not sure about that, but I can find out"
  * "Let me note that down and get back to you"
  Choose a response that fits the conversation naturally. NEVER make up information.
- NEVER SUBSTITUTE: If you don't know the answer, NEVER give unrelated information instead.
- ANSWER THEN GOAL: Complete your answer to ${O}'s question BEFORE mentioning anything about your goal.
- NO FILLERS: Never start with filler phrases like "Okay", "Sure", "I see", "Got it". Just answer directly.
- VARY OPENINGS: Each response should start differently.

[COMMON SITUATIONS]
- Asked for your name → State your name directly.
- Asked "when" or "what date" → Give the date/time if you know, or say you're not sure of the exact time.
- Asked to repeat → REPEAT what you just said, maybe slower or rephrased. Don't say new information.
- Yes/No question (e.g., "Do you have...?", "Did you...?") → Answer "Yes" or "No" FIRST, or if unsure: "I need to check on that". Then explain.
- Asked "How can I help you?" → State your request clearly based on your goal.
- Question about something NOT in your knowledge → Respond naturally that you don't have that info - don't make things up.
- ${O} confirms something → Brief acknowledgment and move on.

[SELF-CHECK]
Before speaking, ask yourself: Does my answer actually address what ${O} just asked?
If not, fix it. If you don't know, respond naturally and honestly - offer to follow up later if appropriate.

[OUTPUT] Only speak as ${I}. No narration. Just what ${I} says.

[INTERNAL] Messages marked [INTERNAL GUIDANCE] are from your principal. Follow naturally, but ALWAYS respond to ${O}'s question first.`;

        // Debug: Log definitions and instructions
        console.log('=== DEFINITIONS ===');
        console.log('I (identity):', I);
        console.log('O (other party):', O);
        console.log('G (goal):', G);
        console.log('L (language):', L);
        console.log('=== INSTRUCTIONS ===');
        console.log(instructions);
        console.log('=== END ===');

        const sessionConfig = {
            type: 'session.update',
            session: {
                type: 'realtime',
                instructions: instructions,
                output_modalities: ['audio'],
                audio: {
                    input: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        transcription: {
                            model: 'whisper-1'
                        },
                        turn_detection: {
                            type: 'semantic_vad',
                            eagerness: 'auto',
                            create_response: true,
                            interrupt_response: true
                        }
                    },
                    output: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        voice: this.config.voice || 'marin'
                    }
                }
            }
        };

        this._sendEvent(sessionConfig);
        this._log('已發送 session.update', 'info');

        // Inject initial system message to reinforce identity
        // Uses only definition references, no hardcoded scenarios
        const initialReminder = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'system',
                content: [{
                    type: 'input_text',
                    text: `You are ${I}. You are NOT ${O}. Your purpose: ${G}`
                }]
            }
        };
        this._sendEvent(initialReminder);
        this._log('已發送角色提醒', 'debug');
    }

    _sendEvent(event) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(event));
            this._log(`→ ${event.type}`, 'info');
        } else {
            this._log('無法發送事件: data channel 未開啟', 'error');
        }
    }

    _startAudioMonitor(stream) {
        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(this.analyser);
        this.analyser.fftSize = 256;
        this._log('音量監測已啟動', 'info');
    }

    // =========================================================================
    // Session Timer (45 minute limit)
    // =========================================================================

    _startSessionTimer() {
        this.sessionStartTime = Date.now();
        this.notifiedMilestones.clear();

        // Update timer every second
        this.sessionTimerInterval = setInterval(() => {
            this._updateSessionTimer();
        }, 1000);

        this._log(`對話計時開始 (上限: ${this.sessionMaxMinutes} 分鐘)`, 'info');
    }

    _stopSessionTimer() {
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
            this.sessionTimerInterval = null;
        }
        this.sessionStartTime = null;
    }

    _updateSessionTimer() {
        if (!this.sessionStartTime) return;

        const elapsedMs = Date.now() - this.sessionStartTime;
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        const remainingMinutes = this.sessionMaxMinutes - elapsedMinutes;

        // Update UI timer display
        if (this.onTimerUpdate) {
            this.onTimerUpdate(elapsedSeconds);
        }

        // Check milestones (only notify once per milestone)
        this._checkTimerMilestones(elapsedMinutes, remainingMinutes);
    }

    _checkTimerMilestones(elapsedMinutes, remainingMinutes) {
        // Regular progress notifications (non-intrusive)
        const progressMilestones = [15, 30, 40];
        for (const milestone of progressMilestones) {
            if (elapsedMinutes === milestone && !this.notifiedMilestones.has(`progress_${milestone}`)) {
                this.notifiedMilestones.add(`progress_${milestone}`);
                const msg = `已對話 ${milestone} 分鐘`;
                this._log(`⏱️ ${msg}`, 'info');
                if (this.onTimerNotification) {
                    this.onTimerNotification(msg, 'info');
                }
            }
        }

        // Warning notifications (more prominent)
        // 5 min = orange warning, 3 min and 1 min = red critical
        const warningMilestones = [
            { remaining: 5, msg: '剩餘 5 分鐘', type: 'warning' },
            { remaining: 3, msg: '剩餘 3 分鐘！', type: 'critical' },
            { remaining: 1, msg: '剩餘 1 分鐘！', type: 'critical' }
        ];
        for (const { remaining, msg, type } of warningMilestones) {
            const key = `warning_${remaining}`;
            if (remainingMinutes === remaining && !this.notifiedMilestones.has(key)) {
                this.notifiedMilestones.add(key);
                const logLevel = type === 'critical' ? 'error' : 'warn';
                this._log(`⚠️ ${msg}`, logLevel);
                if (this.onTimerNotification) {
                    this.onTimerNotification(msg, type);
                }
            }
        }

        // Session timeout
        if (remainingMinutes <= 0 && !this.notifiedMilestones.has('timeout')) {
            this.notifiedMilestones.add('timeout');
            this._log('⏰ 對話時間已達上限', 'error');
            if (this.onSessionTimeout) {
                this.onSessionTimeout();
            }
        }
    }

    // =========================================================================
    // Realtime Event Handling
    // =========================================================================

    _handleRealtimeEvent(event) {
        const type = event.type;

        switch (type) {
            case 'session.created':
            case 'session.updated':
                this._log(`← ${type}`, 'event');
                break;

            case 'input_audio_buffer.speech_started':
                this._log('← speech_started (對方開始說話)', 'event');
                if (this.onMicChange) this.onMicChange(true);

                // If assistant is speaking, user is interrupting
                if (this.isAssistantSpeaking) {
                    this._log('⚠️ 檢測到打斷！AI代理被對方打斷', 'warn');
                    this._log(`   打斷時 AI 正在說的內容可能會被截斷`, 'warn');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                this._log('← speech_stopped (用戶停止說話)', 'event');
                // Mark that we're waiting for counterpart's transcript
                // (AI transcript may arrive faster, so we buffer it)
                this.pendingCounterpartTranscript = true;
                // Transition to THINKING
                if (this.stateMachine.canTransition('THINKING')) {
                    this.stateMachine.transition('THINKING');
                }
                break;

            case 'response.created':
                this._log('← response.created (AI 開始生成回應)', 'event');
                break;

            case 'response.cancelled':
                this._log('← response.cancelled (AI 回應被取消)', 'warn');
                break;

            case 'response.output_item.added':
                if (event.item && event.item.id) {
                    this.currentAssistantItemId = event.item.id;
                    this._log(`← output_item.added (id: ${event.item.id})`, 'event');
                }
                break;

            case 'response.audio.delta':
                // Assistant is speaking
                if (!this.isAssistantSpeaking) {
                    this.isAssistantSpeaking = true;
                    if (this.onSpeakerChange) this.onSpeakerChange(true);

                    // Transition to SPEAKING
                    if (this.stateMachine.canTransition('SPEAKING')) {
                        this.stateMachine.transition('SPEAKING');
                    }
                }
                break;

            case 'response.audio.done':
                this._log('← response.audio.done', 'event');
                this.isAssistantSpeaking = false;
                if (this.onSpeakerChange) this.onSpeakerChange(false);
                break;

            case 'response.audio_transcript.done':
            case 'response.output_audio_transcript.done':
                // AI proxy's speech transcript
                if (event.transcript) {
                    // Track AI's last response (can be used as context reference)
                    this.lastAIUtterance = event.transcript;

                    // Transcript ordering fix:
                    // If we're still waiting for counterpart's transcript, buffer this
                    // Otherwise display immediately
                    if (this.pendingCounterpartTranscript) {
                        this.pendingAITranscripts.push(event.transcript);
                    } else {
                        this._log(`🤖 AI代理說: "${event.transcript}"`, 'chat');
                    }
                }
                break;

            case 'input_audio_buffer.transcription.completed':
            case 'conversation.item.input_audio_transcription.completed':
                // Counterpart's speech transcript
                if (event.transcript) {
                    // Display counterpart's transcript FIRST (correct order)
                    this._log(`📞 對方說: "${event.transcript}"`, 'chat');
                    this.lastCounterpartUtterance = event.transcript;

                    // Transcript ordering fix:
                    // Now display any buffered AI transcripts (in order)
                    if (this.pendingAITranscripts.length > 0) {
                        for (const aiTranscript of this.pendingAITranscripts) {
                            this._log(`🤖 AI代理說: "${aiTranscript}"`, 'chat');
                        }
                        this.pendingAITranscripts = [];  // Clear buffer
                    }
                    this.pendingCounterpartTranscript = false;  // Reset flag
                }
                break;

            case 'response.done':
                this._log('← response.done', 'event');
                this.isAssistantSpeaking = false;
                if (this.onSpeakerChange) this.onSpeakerChange(false);

                // Transition back to LISTENING
                if (this.stateMachine.canTransition('LISTENING')) {
                    this.stateMachine.transition('LISTENING');
                }

                // Increment turn count and check if controller call needed
                this.turnCount++;
                this._checkControllerTrigger();
                break;

            case 'conversation.item.created':
                if (event.item) {
                    const role = event.item.role || 'unknown';
                    const itemType = event.item.type || 'unknown';

                    // Note: Actual transcript content comes from separate events:
                    // - response.output_audio_transcript.done (AI's speech)
                    // - conversation.item.input_audio_transcription.completed (counterpart's speech)
                    this._log(`← conversation.item.created (role: ${role}, type: ${itemType})`, 'event');

                    // Track conversation item
                    this.conversationItems.push({
                        role: role,
                        timestamp: Date.now(),
                        item: event.item
                    });

                    // Update token estimate
                    this._updateTokenEstimate(event.item);
                }
                break;

            case 'conversation.item.truncated':
                this._log('← conversation.item.truncated (AI 的話被截斷以同步上下文)', 'warn');
                break;

            case 'error':
                // Handle errors
                const errorCode = event.error?.code || '';
                const errorMsg = event.error?.message || '';
                const errorType = event.error?.type || '';

                // These errors are expected during disconnect/stop operations
                const nonCriticalErrors = [
                    'response_cancel_not_active',
                    'invalid_value',  // Truncate position errors
                    'conversation_already_has_active_response'
                ];

                if (nonCriticalErrors.includes(errorCode) || this.isDisconnecting) {
                    this._log(`← (ignored) ${errorCode}: ${errorMsg.substring(0, 50)}`, 'warn');
                } else if (errorType === 'invalid_request_error') {
                    // Session configuration errors - CRITICAL
                    this._log(`⛔ 配置錯誤: ${errorMsg}`, 'error');
                    this._log(`   這可能導致 AI 行為異常！`, 'error');
                } else {
                    this._log(`← error: ${JSON.stringify(event.error)}`, 'error');
                }
                break;

            default:
                // Skip verbose delta logs
                if (!type.includes('delta')) {
                    this._log(`← ${type}`, 'event');
                }
        }
    }

    // =========================================================================
    // Helper: Extract text from conversation item
    // =========================================================================

    _extractTextFromItem(item) {
        let text = '';
        if (item.content && Array.isArray(item.content)) {
            for (const content of item.content) {
                if (content.transcript) {
                    text += content.transcript;
                }
                if (content.text) {
                    text += content.text;
                }
            }
        }
        return text.trim();
    }

    // =========================================================================
    // Token Estimation
    // =========================================================================

    _updateTokenEstimate(item) {
        // Simple estimation: count characters and apply formula
        let text = '';
        if (item.content && Array.isArray(item.content)) {
            for (const content of item.content) {
                if (content.transcript) text += content.transcript;
                if (content.text) text += content.text;
            }
        }

        // Estimate tokens (Chinese chars * 2 + English words * 1.3)
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const englishWords = text.replace(/[\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
        const estimated = Math.round(chineseChars * 2 + englishWords * 1.3);

        this.estimatedTokens += estimated;
    }

    // =========================================================================
    // Controller Trigger Logic (design.md § 1.1)
    // =========================================================================

    _checkControllerTrigger() {
        // Check if pending directive needs processing
        if (this.pendingDirective) {
            this._callController(this.pendingDirective);
            this.pendingDirective = null;
            return;
        }

        // Note: Auto-trigger on turn count is disabled because:
        // 1. CONTINUE directive doesn't provide meaningful guidance
        // 2. Causes timing conflicts (conversation_already_has_active_response errors)
        // 3. The AI handles natural conversation flow on its own
        // Controller is only called when user clicks a button (explicit directive)
        // if (this.turnCount % TURNS_PER_CONTROLLER_CALL === 0) {
        //     this._log(`達到 ${TURNS_PER_CONTROLLER_CALL} 輪，觸發 Controller`, 'info');
        //     this._callController('CONTINUE');
        //     return;
        // }

        // Check token threshold
        const tokenRatio = this.estimatedTokens / ESTIMATED_MAX_TOKENS;
        if (tokenRatio >= TOKEN_THRESHOLD_PERCENT) {
            this._log(`Token 使用達 ${Math.round(tokenRatio * 100)}%，觸發 Controller`, 'info');
            this._callController('CONTINUE');
            return;
        }
    }

    // =========================================================================
    // Controller API Integration
    // =========================================================================

    async _callController(directive) {
        // Skip if disconnecting
        if (this.isDisconnecting) {
            this._log(`Controller 呼叫已跳過（正在斷線）`, 'warn');
            return;
        }

        this._log(`呼叫 Controller: ${directive}`, 'info');
        this.lastControllerCall = Date.now();

        // Create AbortController for this request
        this.controllerAbortController = new AbortController();

        try {
            // Build pinned context
            const pinnedContext = [
                `Goal: ${this.config.goal || '(未設定)'}`,
                this.config.rules ? `Rules: ${this.config.rules}` : '',
                this.config.ssot ? `SSOT: ${this.config.ssot.substring(0, 2000)}...` : ''
            ].filter(Boolean).join('\n\n');

            // Get latest turns (last 3)
            const latestTurns = this.conversationItems
                .slice(-6)  // Get last 6 items for up to 3 turn pairs
                .map(item => {
                    const role = item.item.role || 'unknown';
                    let text = '';
                    if (item.item.content) {
                        for (const c of item.item.content) {
                            if (c.transcript) text += c.transcript;
                            if (c.text) text += c.text;
                        }
                    }
                    return `${role}: ${text || '(audio)'}`;
                });

            const requestBody = {
                directive: directive,
                pinned_context: pinnedContext,
                memory: this.memory,
                latest_turns: latestTurns,
                previous_response_id: this.previousResponseId
            };

            const response = await fetch(API_CONTROLLER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: this.controllerAbortController.signal
            });

            // Check if disconnected during fetch
            if (this.isDisconnecting) {
                this._log(`Controller 回應已忽略（已斷線）`, 'warn');
                return;
            }

            if (!response.ok) {
                throw new Error(`Controller API error: ${response.status}`);
            }

            const result = await response.json();
            this._log(`Controller 回應: decision=${result.decision}`, 'success');

            // Update memory
            if (result.memory_update) {
                this.memory = result.memory_update;
            }

            // Store response ID for continuation
            if (result.response_id) {
                this.previousResponseId = result.response_id;
            }

            // Show notes to user
            if (result.notes_for_user && this.onNotesForUser) {
                this.onNotesForUser(result.notes_for_user);
            }

            // Handle decision (only if still connected)
            if (!this.isDisconnecting) {
                this._handleControllerDecision(result, directive);
            }

        } catch (error) {
            // Ignore abort errors (expected during disconnect)
            if (error.name === 'AbortError') {
                this._log(`Controller 呼叫已取消`, 'info');
                return;
            }
            this._log(`Controller 錯誤: ${error.message}`, 'error');
        }
    }

    _handleControllerDecision(result, originalDirective) {
        const decision = result.decision;
        const utterance = result.next_english_utterance || '';

        // Get pending button config if available (for custom guidance)
        const btnConfig = this._pendingButtonConfig;
        this._pendingButtonConfig = null;  // Clear after use

        // Determine if we're going to end the conversation
        const willEndConversation = (
            originalDirective === 'GOAL_MET' ||
            originalDirective === 'SAY_GOODBYE'
        );

        // For SAY_GOODBYE: Use natural goodbye transition (don't cut off AI)
        if (originalDirective === 'SAY_GOODBYE') {
            this._log('用戶要求結束對話，啟動自然告別流程', 'info');

            // Use custom guidance template if available
            if (btnConfig?.guidanceTemplate) {
                const customGuidance = this._replaceTemplateVariables(btnConfig.guidanceTemplate);
                this.handleGoodbyeTransitionWithGuidance(customGuidance);
            } else {
                this.handleGoodbyeTransition(utterance || "Thank you for your time. It was nice talking with you. Goodbye!");
            }
            return;  // Don't process further
        }

        // For GOAL_MET: Use natural transition with celebratory tone
        if (originalDirective === 'GOAL_MET') {
            if (decision !== 'stop') {
                this._log('衝突：用戶認為達標，但 Controller 判定未達標', 'warn');
                if (this.onNotesForUser) {
                    this.onNotesForUser('警告：您認為已達標，但 Controller 認為尚未達成目標。以用戶決定為準，正在結束對話...');
                }
            } else {
                this._log('達標確認：用戶與 Controller 一致', 'success');
            }

            // Use custom guidance template if available
            if (btnConfig?.guidanceTemplate) {
                const customGuidance = this._replaceTemplateVariables(btnConfig.guidanceTemplate);
                this.handleGoalMetTransitionWithGuidance(customGuidance);
            } else {
                const celebratoryGoodbye = utterance ||
                    "This worked out great! Thank you so much for your help with this. I really appreciate it!";
                this.handleGoalMetTransition(celebratoryGoodbye);
            }
            return;
        }

        // For other directives: Inject the utterance normally
        if (utterance || btnConfig?.guidanceTemplate) {
            // Use custom guidance template if available, otherwise use default
            if (btnConfig?.guidanceTemplate) {
                const customGuidance = this._replaceTemplateVariables(btnConfig.guidanceTemplate);
                // Append controller's utterance suggestion if available
                const fullGuidance = utterance
                    ? `${customGuidance}\n\nController's suggestion: ${utterance}`
                    : customGuidance;
                this._injectUtteranceWithGuidance(utterance, fullGuidance);
            } else {
                this._injectUtterance(utterance, originalDirective);
            }
        }

        // Handle stop decision from controller (for non-ending directives)
        if (decision === 'stop') {
            // Controller initiated stop - warn user but don't auto-stop
            this._log('Controller 建議停止對話', 'warn');
            if (this.onNotesForUser) {
                this.onNotesForUser('提示：Controller 建議結束對話。如需繼續，請按任意指令按鈕。');
            }
        }
    }

    _injectUtterance(utterance, directive = null) {
        // Build directional guidance for natural conversation flow
        // These are DIRECTIONS, not scripts - AI must respond naturally with its own words
        // IMPORTANT: Use clear markers to distinguish from counterpart speech
        let guidanceText;

        const capturedContext = this.capturedDirectiveContext;
        const lastCounterpart = capturedContext?.lastCounterpartUtterance || this.lastCounterpartUtterance || '';
        const lastAI = capturedContext?.lastAIUtterance || this.lastAIUtterance || '';
        const userName = this.config?.agentName || 'the user';

        // Simplified header - less verbose, more focused (2026-01-28)
        const guidanceHeader = `[INTERNAL GUIDANCE - FROM PRINCIPAL]
You ARE ${userName}. Respond TO the counterpart.`;

        if (lastCounterpart && directive) {
            // Best case: we know what counterpart said
            guidanceText = `${guidanceHeader}

Counterpart said: "${lastCounterpart.substring(0, 200)}"

DIRECTION: ${directive}
APPROACH: ${utterance}

RESPOND NATURALLY:
1. Answer/acknowledge what they said first
2. Then follow the direction above
3. Use your own words, no filler phrases like "好的，我明白了"`;
        } else if (lastAI && directive) {
            // Fallback: we know what AI last said, use that for context
            guidanceText = `${guidanceHeader}

You just said: "${lastAI.substring(0, 150)}"
Counterpart has responded.

DIRECTION: ${directive}
APPROACH: ${utterance}

RESPOND NATURALLY:
1. Don't repeat yourself
2. Move the conversation forward
3. No filler phrases`;
        } else if (directive) {
            // Directive without context
            guidanceText = `${guidanceHeader}

DIRECTION: ${directive}
APPROACH: ${utterance}

Express naturally in your own words. No filler phrases.`;
        } else {
            // Simple direction (for goodbye, etc.)
            guidanceText = `${guidanceHeader}

Express naturally: ${utterance}
Use your own phrasing.`;
        }

        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: guidanceText
                }]
            }
        };

        this._sendEvent(event);

        // Trigger response generation
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入指令: ${utterance.substring(0, 50)}...`, 'info');
        this._log(`📤 完整 Guidance: ${guidanceText.substring(0, 150)}...`, 'debug');

        // Clear captured context after use
        this.capturedDirectiveContext = null;
    }

    // =========================================================================
    // Stop Conditions (T1.6)
    // =========================================================================

    /**
     * Hard Stop: Immediate cancellation (design.md § 8)
     * - response.cancel: Stop any ongoing response
     * - output_audio_buffer.clear: Clear audio buffer
     * - Truncate to sync context
     */
    handleHardStop() {
        this._log('執行 Hard Stop...', 'warn');

        // Set disconnecting flag early to suppress errors
        this.isDisconnecting = true;

        // Transition to STOPPING
        if (this.stateMachine.canTransition('STOPPING')) {
            this.stateMachine.transition('STOPPING');
        }

        // Abort any pending controller API calls
        if (this.controllerAbortController) {
            this.controllerAbortController.abort();
            this.controllerAbortController = null;
        }

        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            // Cancel ongoing response and clear buffer
            // Note: These may fail if no active response, but that's OK
            this._sendEvent({ type: 'response.cancel' });
            this._sendEvent({ type: 'output_audio_buffer.clear' });
            // Skip truncate - we're disconnecting anyway and it can cause errors
        }

        // Update speaker status
        this.isAssistantSpeaking = false;
        if (this.onSpeakerChange) this.onSpeakerChange(false);

        // Disconnect after short delay
        setTimeout(() => {
            this.disconnect();
        }, 300);

        this._log('Hard Stop 完成', 'success');
    }

    /**
     * Goodbye Transition: Natural conversation ending for SAY_GOODBYE (design.md § 8)
     * - Does NOT immediately cancel/clear the current response
     * - Injects guidance for AI to naturally wrap up and transition to goodbye
     * - Waits for the goodbye to complete naturally
     * - Then disconnects
     */
    handleGoodbyeTransition(utterance) {
        this._log('執行自然告別過渡...', 'info');

        // Transition to STOPPING (but don't cancel yet)
        if (this.stateMachine.canTransition('STOPPING')) {
            this.stateMachine.transition('STOPPING');
        }

        // Get context for natural transition
        const capturedContext = this.capturedDirectiveContext;
        const lastCounterpart = capturedContext?.lastCounterpartUtterance || this.lastCounterpartUtterance || '';
        const lastAI = capturedContext?.lastAIUtterance || this.lastAIUtterance || '';
        const userName = this.config?.agentName || 'the user';
        const counterpartType = this.config?.counterpartType || 'the other person';

        // Simplified header (2026-01-28)
        const guidanceHeader = `[INTERNAL GUIDANCE - FROM PRINCIPAL]
You ARE ${userName}. Respond TO ${counterpartType}.`;

        // Build natural goodbye direction (not a script)
        let goodbyeGuidance;
        if (lastCounterpart) {
            goodbyeGuidance = `${guidanceHeader}

${counterpartType} said: "${lastCounterpart.substring(0, 200)}"

END THE CONVERSATION:
1. Respond briefly to what they said
2. Signal you need to go
3. Say goodbye warmly

Use your own words, no filler phrases.`;
        } else if (lastAI) {
            goodbyeGuidance = `${guidanceHeader}

You just said: "${lastAI.substring(0, 150)}"

END THE CONVERSATION:
1. Acknowledge what was discussed
2. Signal you need to go
3. Say goodbye warmly`;
        } else {
            goodbyeGuidance = `${guidanceHeader}

END THE CONVERSATION:
- Thank them for their time
- Say goodbye warmly`;
        }

        // Inject the goodbye guidance (AI will naturally transition)
        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: goodbyeGuidance
                }]
            }
        };

        this._sendEvent(event);
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入告別指令 (自然過渡模式)`, 'info');

        // Clear captured context
        this.capturedDirectiveContext = null;

        this._setupDisconnectAfterSpeaking();
    }

    /**
     * Goodbye Transition with custom guidance template
     * Uses user-configured guidanceTemplate instead of default
     */
    handleGoodbyeTransitionWithGuidance(customGuidance) {
        this._log('執行自然告別過渡（使用自定義模板）...', 'info');

        // Transition to STOPPING (but don't cancel yet)
        if (this.stateMachine.canTransition('STOPPING')) {
            this.stateMachine.transition('STOPPING');
        }

        // Inject the custom goodbye guidance
        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: customGuidance
                }]
            }
        };

        this._sendEvent(event);
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入告別指令 (自定義模板)`, 'info');

        // Clear captured context
        this.capturedDirectiveContext = null;

        this._setupDisconnectAfterSpeaking();
    }

    /**
     * Goal Met Transition: Natural conversation ending with celebratory tone
     * - Similar to handleGoodbyeTransition but with positive/celebratory guidance
     * - Does NOT immediately cancel/clear the current response
     * - Lets AI naturally wrap up and celebrate the achievement
     */
    handleGoalMetTransition(utterance) {
        this._log('執行達標自然過渡...', 'success');

        // Transition to STOPPING (but don't cancel yet)
        if (this.stateMachine.canTransition('STOPPING')) {
            this.stateMachine.transition('STOPPING');
        }

        // Get context for natural transition
        const capturedContext = this.capturedDirectiveContext;
        const lastCounterpart = capturedContext?.lastCounterpartUtterance || this.lastCounterpartUtterance || '';
        const lastAI = capturedContext?.lastAIUtterance || this.lastAIUtterance || '';
        const userName = this.config?.agentName || 'the user';
        const counterpartType = this.config?.counterpartType || 'the other person';

        // Simplified header (2026-01-28)
        const guidanceHeader = `[INTERNAL GUIDANCE - GOAL ACHIEVED!]
You ARE ${userName}. Respond TO ${counterpartType}.`;

        // Build celebratory goodbye guidance (direction, not script)
        let celebratoryGuidance;
        if (lastCounterpart) {
            celebratoryGuidance = `${guidanceHeader}

${counterpartType} said: "${lastCounterpart.substring(0, 200)}"

CELEBRATE & END:
1. React positively to what they said
2. Express satisfaction and thanks
3. Say goodbye warmly with enthusiasm

Use your own words, no filler phrases.`;
        } else if (lastAI) {
            celebratoryGuidance = `${guidanceHeader}

You just said: "${lastAI.substring(0, 150)}"

CELEBRATE & END:
1. Acknowledge what was accomplished
2. Express appreciation
3. Say goodbye with enthusiasm`;
        } else {
            celebratoryGuidance = `${guidanceHeader}

CELEBRATE & END:
- Express satisfaction
- Thank them warmly
- Say goodbye with enthusiasm`;
        }

        // Inject the celebratory guidance
        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: celebratoryGuidance
                }]
            }
        };

        this._sendEvent(event);
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入達標告別指令 (自然過渡模式)`, 'success');

        // Clear captured context
        this.capturedDirectiveContext = null;

        this._setupDisconnectAfterSpeaking();
    }

    /**
     * Goal Met Transition with custom guidance template
     * Uses user-configured guidanceTemplate instead of default
     */
    handleGoalMetTransitionWithGuidance(customGuidance) {
        this._log('執行達標自然過渡（使用自定義模板）...', 'success');

        // Transition to STOPPING (but don't cancel yet)
        if (this.stateMachine.canTransition('STOPPING')) {
            this.stateMachine.transition('STOPPING');
        }

        // Inject the custom celebratory guidance
        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: customGuidance
                }]
            }
        };

        this._sendEvent(event);
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入達標告別指令 (自定義模板)`, 'success');

        // Clear captured context
        this.capturedDirectiveContext = null;

        this._setupDisconnectAfterSpeaking();
    }

    /**
     * Helper: Setup monitoring to disconnect after AI finishes speaking
     */
    _setupDisconnectAfterSpeaking() {
        // Wait for response to complete, then disconnect
        const checkAndDisconnect = () => {
            if (!this.isAssistantSpeaking) {
                this._log('告別播放完成，斷線中...', 'info');
                this.disconnect();
            } else {
                // Check again after 1 second
                setTimeout(checkAndDisconnect, 1000);
            }
        };

        // Start checking after 3 seconds (give time for natural response)
        setTimeout(checkAndDisconnect, 3000);

        // Fallback: Force disconnect after 20 seconds
        setTimeout(() => {
            if (this.stateMachine.getState() !== 'STOPPED') {
                this._log('告別超時，強制斷線', 'warn');
                this.disconnect();
            }
        }, 20000);
    }

    // =========================================================================
    // Button Handler (Refactored for dynamic button configuration)
    // =========================================================================

    /**
     * Main directive handler - dispatches based on executionType
     * Supports both legacy directive names (AGREE) and new button IDs (btn_agree)
     * design.md § 3.2
     */
    handleDirective(directive) {
        if (!this.config) {
            this._log('錯誤：設定未載入', 'error');
            return;
        }

        this._log(`按鈕點擊: ${directive}`, 'info');

        // Capture context at button press time (for natural conversation flow)
        this.capturedDirectiveContext = {
            directive: directive,
            lastCounterpartUtterance: this.lastCounterpartUtterance || '',
            lastAIUtterance: this.lastAIUtterance || '',
            timestamp: Date.now(),
            currentState: this.stateMachine.getState()
        };
        const contextPreview = this.lastCounterpartUtterance?.substring(0, 30) ||
                              (this.lastAIUtterance ? `AI剛說: ${this.lastAIUtterance.substring(0, 25)}` : '(無)');
        this._log(`已捕捉上下文: "${contextPreview}..."`, 'info');

        // Get button configuration
        const btnConfig = this._getButtonConfig(directive);

        if (!btnConfig) {
            this._log(`警告：找不到按鈕配置 "${directive}"，使用舊版邏輯`, 'warn');
            this._handleDirectiveLegacy(directive);
            return;
        }

        // Dispatch based on executionType (design.md § 2.6)
        switch (btnConfig.executionType) {
            case 'continue':
                this._executeContinue(btnConfig, directive);
                break;

            case 'natural_end':
                this._executeNaturalEnd(btnConfig, directive);
                break;

            case 'emergency':
                this._executeEmergency(btnConfig);
                break;

            case 'inject_only':
                this._executeInjectOnly(btnConfig);
                break;

            default:
                this._log(`未知的執行類型: ${btnConfig.executionType}，使用 continue`, 'warn');
                this._executeContinue(btnConfig, directive);
        }
    }

    /**
     * Legacy handler for backward compatibility
     * Used when no button configuration is found
     */
    _handleDirectiveLegacy(directive) {
        switch (directive) {
            case 'EMERGENCY_STOP':
                this._log('執行緊急停止！', 'error');
                this.handleHardStop();
                return;

            case 'GOAL_MET':
                this._log('用戶確認達標', 'success');
                this._callController(directive);
                return;

            case 'SAY_GOODBYE':
                this._log('用戶發起結束對話', 'info');
                this._callController(directive);
                return;

            default:
                // Queue directive for next controller call
                this.pendingDirective = directive;
                this._log(`指令已排隊: ${directive}`, 'info');

                // If we're in a good state, call controller immediately
                const state = this.stateMachine.getState();
                if (state === 'LISTENING' || state === 'CHECKPOINT') {
                    this._callController(directive);
                    this.pendingDirective = null;
                }
        }
    }

    /**
     * Execute 'continue' type - Call Controller, inject utterance, continue conversation
     * design.md § 1.2 - standard type
     */
    _executeContinue(btnConfig, directive) {
        // Map button ID to directive for controller
        const controllerDirective = BUTTON_ID_TO_DIRECTIVE[btnConfig.id] || directive;

        // Queue directive for next controller call
        this.pendingDirective = controllerDirective;
        this._log(`指令已排隊: ${controllerDirective}`, 'info');

        // Store button config for use in controller response handling
        this._pendingButtonConfig = btnConfig;

        // If we're in a good state, call controller immediately
        const state = this.stateMachine.getState();
        if (state === 'LISTENING' || state === 'CHECKPOINT') {
            this._callController(controllerDirective);
            this.pendingDirective = null;
        }
    }

    /**
     * Execute 'natural_end' type - Call Controller, natural transition to goodbye
     * design.md § 1.2 - natural_end type (SAY_GOODBYE, GOAL_MET)
     */
    _executeNaturalEnd(btnConfig, directive) {
        const controllerDirective = BUTTON_ID_TO_DIRECTIVE[btnConfig.id] || directive;

        // Store button config for custom guidance if available
        this._pendingButtonConfig = btnConfig;

        if (controllerDirective === 'GOAL_MET' || btnConfig.id === 'btn_goal_met') {
            this._log('用戶確認達標', 'success');
        } else {
            this._log('用戶發起結束對話', 'info');
        }

        // Call controller - the response handler will use btnConfig.guidanceTemplate
        this._callController(controllerDirective);
    }

    /**
     * Execute 'emergency' type - Immediate hard stop, no controller call
     * design.md § 1.2 - emergency type (EMERGENCY_STOP)
     */
    _executeEmergency(btnConfig) {
        this._log('執行緊急停止！', 'error');
        this.handleHardStop();
    }

    /**
     * Execute 'inject_only' type - Direct injection without controller call
     * design.md § 2.6 - For simple commands or testing
     */
    _executeInjectOnly(btnConfig) {
        this._log(`直接注入模式: ${btnConfig.label}`, 'info');

        if (!btnConfig.guidanceTemplate) {
            this._log('錯誤：inject_only 模式需要 guidanceTemplate', 'error');
            return;
        }

        // Replace template variables and inject directly
        const processedGuidance = this._replaceTemplateVariables(btnConfig.guidanceTemplate);
        this._injectUtteranceWithGuidance(null, processedGuidance);
    }

    /**
     * Inject utterance with custom guidance template
     * Used when button has a custom guidanceTemplate
     */
    _injectUtteranceWithGuidance(utterance, customGuidance) {
        const guidanceText = customGuidance || this._buildDefaultGuidance(utterance);

        const event = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: guidanceText
                }]
            }
        };

        this._sendEvent(event);
        this._sendEvent({ type: 'response.create' });

        this._log(`📤 已注入指令: ${guidanceText.substring(0, 50)}...`, 'info');

        // Clear captured context after use
        this.capturedDirectiveContext = null;
    }

    /**
     * Build default guidance when no custom template is provided
     */
    _buildDefaultGuidance(utterance) {
        const capturedContext = this.capturedDirectiveContext;
        const lastCounterpart = capturedContext?.lastCounterpartUtterance || this.lastCounterpartUtterance || '';

        if (lastCounterpart) {
            return `[Direction: The other person just said: "${lastCounterpart.substring(0, 200)}".
Controller's suggestion: ${utterance}
HOW TO RESPOND:
- First react naturally to what they said
- Then move toward the suggestion above
- Use YOUR OWN WORDS - be natural]`;
        } else {
            return `[Direction: Express something along these lines: ${utterance}
Use your own natural phrasing - don't read this verbatim.]`;
        }
    }

    // =========================================================================
    // Disconnect
    // =========================================================================

    disconnect() {
        // Set disconnecting flag to prevent new actions
        this.isDisconnecting = true;

        // Abort any pending controller API calls
        if (this.controllerAbortController) {
            this.controllerAbortController.abort();
            this.controllerAbortController = null;
        }

        // Stop session timer
        this._stopSessionTimer();

        // Cleanup audio monitor
        if (this.analyser) {
            this.analyser = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }

        // Close data channel
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Reset state
        this.currentAssistantItemId = null;
        this.audioPlaybackMs = 0;
        this.isAssistantSpeaking = false;

        // Transition to STOPPED
        if (this.stateMachine.getState() !== 'STOPPED') {
            if (this.stateMachine.canTransition('STOPPING')) {
                this.stateMachine.transition('STOPPING');
            }
            if (this.stateMachine.canTransition('STOPPED')) {
                this.stateMachine.transition('STOPPED');
            }
        }

        // Update UI
        if (this.onConnectionChange) {
            this.onConnectionChange('disconnected', '已斷線');
        }
        if (this.onMicChange) this.onMicChange(false);
        if (this.onSpeakerChange) this.onSpeakerChange(false);

        this._log('已斷線', 'info');

        // Reset disconnecting flag after a short delay
        setTimeout(() => {
            this.isDisconnecting = false;
        }, 500);
    }

    // =========================================================================
    // Reset
    // =========================================================================

    reset() {
        this.disconnect();

        // Reset conversation state
        this.turnCount = 0;
        this.conversationItems = [];
        this.estimatedTokens = 0;
        this.memory = '';
        this.previousResponseId = null;
        this.pendingDirective = null;

        // Reset context capture state
        this.lastCounterpartUtterance = '';
        this.lastAIUtterance = '';
        this.capturedDirectiveContext = null;

        // Reset transcript ordering state
        this.pendingCounterpartTranscript = false;
        this.pendingAITranscripts = [];

        // Reset state machine
        this.stateMachine.reset();

        this._log('應用程式已重置', 'info');
    }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VoiceProxyApp,
        STOP_TYPE,
        DIRECTIVE_MAP,
        DEFAULT_BUTTONS,
        BUTTON_ID_TO_DIRECTIVE,
        DIRECTIVE_TO_BUTTON_ID
    };
}
