/**
 * SAARTHI - Production Input Manager
 * Manages Mobile Touch Gestures, Shake Detection, Compass Sensors,
 * Desktop Keyboard Shortcuts, and Ergonomic Dock Controls.
 */

import { STATE } from './config.js';
import { toggleSystem, checkDebugOverlay, captureCurrentFrameDataUrl } from './main.js';
import { 
    toggleIntelDrawer, 
    closeIntelDrawer, 
    showFeedback, 
    UI, 
    openModal, 
    closeModal, 
    closeAllModals 
} from './ui.js';
import { sendInquiryData, sendModeChange, sendStartTask } from './network.js';

let tapTime = 0;
let holdTimer = null;
let isHolding = false;
let mediaRecorder = null;
let audioChunks = [];

export function setupInputs() {
    // 1. Mobile Touch Interactions
    document.body.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.body.addEventListener('touchend', handleTouchEnd);

    // 2. Desktop Mouse Interactions
    document.body.addEventListener('dblclick', (e) => {
        if (e.target.closest('#control-dock') || 
            e.target.closest('.modal-backdrop') || 
            e.target.closest('#task-hud-card') ||
            e.target.closest('#intelligence-drawer') ||
            e.target.closest('.app-header')) return;
        toggleSystem();
    });

    // 3. Desktop Keyboard Shortcuts
    window.addEventListener('keydown', handleKeyDown);

    // 4. Mobile Device Motion & Orientation
    window.addEventListener('devicemotion', handleMotion);
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', handleOrientation);
    }

    // 5. Setup Action Button Listeners
    setupDockListeners();
}

function handleTouchStart(e) {
    if (e.touches.length === 3) {
        checkDebugOverlay();
        return;
    }

    if (e.target.closest('#control-dock') || 
        e.target.closest('.modal-backdrop') || 
        e.target.closest('#task-hud-card') ||
        e.target.closest('#intelligence-drawer') ||
        e.target.closest('.app-header')) {
        return;
    }

    const now = Date.now();

    // Double Tap (Toggle System)
    if (now - tapTime < 320) {
        toggleSystem();
        tapTime = 0;
        return;
    }
    tapTime = now;

    // Hold (Voice Recording)
    isHolding = false;
    holdTimer = setTimeout(() => {
        isHolding = true;
        startVoiceRecording();
    }, 550);
}

function handleTouchEnd() {
    if (holdTimer) clearTimeout(holdTimer);
    if (isHolding) {
        stopVoiceRecording();
        isHolding = false;
    }
}

function handleKeyDown(e) {
    // Don't intercept typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        if (e.key === 'Escape') {
            closeAllModals();
        }
        return;
    }

    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            toggleSystem();
            break;
        case 'i':
            toggleIntelDrawer();
            break;
        case 'm':
            if (STATE.mode === 'micro') {
                sendModeChange('nav');
            } else {
                sendModeChange('micro', 'Target');
            }
            break;
        case 't':
            if (STATE.mode === 'task') {
                sendModeChange('nav');
            } else {
                sendStartTask('Make Coffee');
            }
            break;
        case 'a':
            openModal(UI.modalCommand);
            break;
        case 'p':
            openModal(UI.modalMemory);
            break;
        case 's':
            openModal(UI.modalSettings);
            break;
        case 'escape':
            closeAllModals();
            break;
    }
}

function handleMotion(e) {
    const { x, y, z } = e.accelerationIncludingGravity || {};
    if (!x) return;

    const mag = Math.abs(Math.sqrt(x * x + y * y + z * z) - 9.8);
    if (mag > 18 && (Date.now() - STATE.lastShake > 1200)) {
        STATE.lastShake = Date.now();
        toggleIntelDrawer();
    }
}

function handleOrientation(e) {
    if (e.webkitCompassHeading) {
        STATE.heading = Math.round(e.webkitCompassHeading);
    } else if (e.alpha) {
        STATE.heading = Math.round(360 - e.alpha);
    }
    if (UI.compassBadge) {
        UI.compassBadge.textContent = `${STATE.heading}° N`;
    }
}

// --- Voice Recording Pipeline ---

export async function startVoiceRecording() {
    if (!STATE.active) {
        showFeedback('START SYSTEM FIRST');
        return;
    }

    showFeedback('LISTENING...');
    if (UI.dockBtnMic) UI.dockBtnMic.classList.add('recording');
    window.speechSynthesis.cancel();
    if (window.spatialAudio) window.spatialAudio.playTone(880, 'sine', 0.1);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.start();
        STATE.isRecording = true;

    } catch (e) {
        console.warn("Microphone access denied; activating speech recognition fallback:", e);
        startWebSpeechRecognition();
    }
}

export function stopVoiceRecording() {
    if (UI.dockBtnMic) UI.dockBtnMic.classList.remove('recording');

    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        STATE.isRecording = false;
        return;
    }

    showFeedback('THINKING...');
    if (window.spatialAudio) window.spatialAudio.playTone(440, 'sine', 0.1);

    mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const frameDataUrl = captureCurrentFrameDataUrl();
            sendInquiryData(frameDataUrl, reader.result, null);
        };

        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        STATE.isRecording = false;
    };

    mediaRecorder.stop();
}

function startWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showFeedback('MIC NOT AVAILABLE');
        openModal(UI.modalCommand);
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.start();

    recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        showFeedback(`"${transcript}"`);
        const frameDataUrl = captureCurrentFrameDataUrl();
        sendInquiryData(frameDataUrl, null, transcript);
    };

    recognition.onerror = () => {
        showFeedback('PLEASE TYPE QUERY');
        openModal(UI.modalCommand);
    };
}

// --- Dock & Header Triggers Setup ---

function setupDockListeners() {
    if (UI.heroStartBtn) {
        UI.heroStartBtn.addEventListener('click', toggleSystem);
    }

    if (UI.dockBtnPower) {
        UI.dockBtnPower.addEventListener('click', toggleSystem);
    }

    if (UI.dockBtnMic) {
        UI.dockBtnMic.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startVoiceRecording();
        });
        window.addEventListener('mouseup', () => {
            if (STATE.isRecording) stopVoiceRecording();
        });
        UI.dockBtnMic.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startVoiceRecording();
        });
        UI.dockBtnMic.addEventListener('touchend', (e) => {
            e.stopPropagation();
            if (STATE.isRecording) stopVoiceRecording();
        });
    }

    if (UI.dockBtnAsk) {
        UI.dockBtnAsk.addEventListener('click', () => openModal(UI.modalCommand));
    }

    if (UI.dockBtnMicro) {
        UI.dockBtnMicro.addEventListener('click', () => {
            if (STATE.mode === 'micro') {
                sendModeChange('nav');
            } else {
                sendModeChange('micro', 'Target');
            }
        });
    }

    if (UI.dockBtnTask) {
        UI.dockBtnTask.addEventListener('click', () => {
            if (STATE.mode === 'task') {
                sendModeChange('nav');
            } else {
                sendStartTask('Make Coffee');
            }
        });
    }

    if (UI.dockBtnMemory) {
        UI.dockBtnMemory.addEventListener('click', () => openModal(UI.modalMemory));
    }

    if (UI.dockBtnIntel) {
        UI.dockBtnIntel.addEventListener('click', toggleIntelDrawer);
    }

    if (UI.dockBtnSettings) {
        UI.dockBtnSettings.addEventListener('click', () => openModal(UI.modalSettings));
    }

    // Header buttons
    if (UI.btnHeaderDrawer) {
        UI.btnHeaderDrawer.addEventListener('click', toggleIntelDrawer);
    }
    if (UI.btnHeaderSettings) {
        UI.btnHeaderSettings.addEventListener('click', () => openModal(UI.modalSettings));
    }
    if (UI.drawerCloseBtn) {
        UI.drawerCloseBtn.addEventListener('click', closeIntelDrawer);
    }
}
