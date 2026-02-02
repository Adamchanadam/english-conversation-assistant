/**
 * Audio Capture Module for English Conversation Assistant
 *
 * Provides two audio capture methods:
 * 1. System Audio: Captures audio from other applications (phone calls, video calls)
 * 2. Microphone: Fallback when system audio is not available
 *
 * Reference: design.md § 4.2
 */

class AudioCapture {
    constructor() {
        this.systemStream = null;
        this.micStream = null;
        this.mode = null; // 'system' | 'microphone' | null
        this.onError = null;
        this.onStreamReady = null;
    }

    /**
     * Check if system audio capture is supported
     * Note: getDisplayMedia with audio is not supported on all browsers/OS
     */
    static isSystemAudioSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    }

    /**
     * Capture system audio using getDisplayMedia
     * This captures audio from the selected window/screen
     *
     * @returns {Promise<MediaStream>} Audio stream from system
     */
    async captureSystemAudio() {
        if (!AudioCapture.isSystemAudioSupported()) {
            throw new Error('System audio capture not supported on this browser');
        }

        try {
            // Request screen/window share with audio
            // Note: User must select a window/tab that has audio
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    // Video is required but we'll ignore it
                    width: { ideal: 1 },
                    height: { ideal: 1 },
                    frameRate: { ideal: 1 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                // Prefer audio sharing
                preferCurrentTab: false,
                selfBrowserSurface: 'exclude',
                systemAudio: 'include'  // Chrome 105+
            });

            // Check if audio track exists
            const audioTracks = displayStream.getAudioTracks();
            if (audioTracks.length === 0) {
                // Stop video track
                displayStream.getVideoTracks().forEach(t => t.stop());
                throw new Error('NO_AUDIO_TRACK');
            }

            // Stop video track - we only need audio
            displayStream.getVideoTracks().forEach(track => {
                track.stop();
                displayStream.removeTrack(track);
            });

            this.systemStream = displayStream;
            this.mode = 'system';

            // Handle track ended (user stops sharing)
            audioTracks[0].onended = () => {
                this.cleanup();
                if (this.onError) {
                    this.onError(new Error('System audio sharing stopped'));
                }
            };

            console.log('[AudioCapture] System audio captured successfully');
            return displayStream;

        } catch (error) {
            console.error('[AudioCapture] System audio capture failed:', error);

            // Provide user-friendly error messages
            if (error.name === 'NotAllowedError') {
                throw new Error('PERMISSION_DENIED');
            } else if (error.message === 'NO_AUDIO_TRACK') {
                throw new Error('NO_AUDIO_TRACK');
            } else {
                throw new Error('CAPTURE_FAILED');
            }
        }
    }

    /**
     * Capture microphone audio (fallback)
     * Use this when system audio is not available
     *
     * @returns {Promise<MediaStream>} Audio stream from microphone
     */
    async captureMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.micStream = stream;
            this.mode = 'microphone';

            // Handle track ended
            stream.getAudioTracks()[0].onended = () => {
                this.cleanup();
                if (this.onError) {
                    this.onError(new Error('Microphone disconnected'));
                }
            };

            console.log('[AudioCapture] Microphone captured successfully');
            return stream;

        } catch (error) {
            console.error('[AudioCapture] Microphone capture failed:', error);

            if (error.name === 'NotAllowedError') {
                throw new Error('MIC_PERMISSION_DENIED');
            } else if (error.name === 'NotFoundError') {
                throw new Error('MIC_NOT_FOUND');
            } else {
                throw new Error('MIC_CAPTURE_FAILED');
            }
        }
    }

    /**
     * Get the current audio stream
     * @returns {MediaStream|null}
     */
    getStream() {
        return this.systemStream || this.micStream || null;
    }

    /**
     * Get current capture mode
     * @returns {'system'|'microphone'|null}
     */
    getMode() {
        return this.mode;
    }

    /**
     * Check if audio is currently being captured
     * @returns {boolean}
     */
    isCapturing() {
        const stream = this.getStream();
        if (!stream) return false;

        const tracks = stream.getAudioTracks();
        return tracks.length > 0 && tracks[0].readyState === 'live';
    }

    /**
     * Cleanup and release all resources
     */
    cleanup() {
        if (this.systemStream) {
            this.systemStream.getTracks().forEach(track => track.stop());
            this.systemStream = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        this.mode = null;
        console.log('[AudioCapture] Cleaned up');
    }

    /**
     * Get user-friendly error message
     * @param {string} errorCode
     * @returns {object} { title, message, suggestion }
     */
    static getErrorMessage(errorCode) {
        const messages = {
            'PERMISSION_DENIED': {
                title: '權限被拒絕',
                message: '您拒絕了螢幕分享的權限。',
                suggestion: '請重新點擊「開始」並允許螢幕分享以捕獲系統音訊。'
            },
            'NO_AUDIO_TRACK': {
                title: '未偵測到音訊',
                message: '您選擇的視窗/分頁沒有音訊輸出。',
                suggestion: '請選擇有音訊的視窗（如電話應用程式），或使用「麥克風模式」代替。'
            },
            'CAPTURE_FAILED': {
                title: '捕獲失敗',
                message: '無法捕獲系統音訊。',
                suggestion: '您的瀏覽器可能不支援系統音訊捕獲，請嘗試使用「麥克風模式」。'
            },
            'MIC_PERMISSION_DENIED': {
                title: '麥克風權限被拒絕',
                message: '您拒絕了麥克風的權限。',
                suggestion: '請在瀏覽器設定中允許麥克風權限，然後重新整理頁面。'
            },
            'MIC_NOT_FOUND': {
                title: '找不到麥克風',
                message: '系統未偵測到麥克風裝置。',
                suggestion: '請連接麥克風後重新整理頁面。'
            },
            'MIC_CAPTURE_FAILED': {
                title: '麥克風捕獲失敗',
                message: '無法存取麥克風。',
                suggestion: '麥克風可能正被其他應用程式使用，請關閉其他程式後重試。'
            }
        };

        return messages[errorCode] || {
            title: '未知錯誤',
            message: '發生未知錯誤。',
            suggestion: '請重新整理頁面後重試。'
        };
    }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioCapture };
}
