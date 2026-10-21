/**
 * SAARTHI - Network Manager
 * Robust WebSocket pipeline, frame streaming, audio telemetry triggers,
 * and low-latency bidirectional communication.
 */

import { STATE } from './config.js';
import { 
    updateNavUI, 
    updateMicroUI, 
    updateTaskUI, 
    updateInquiryUI, 
    updateStatus, 
    showFeedback,
    UI 
} from './ui.js';
import { startLoop, startMicroLoop } from './main.js';

export function connectWS() {
    if (!STATE.active) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws`;

    STATE.ws = new WebSocket(wsUrl);

    STATE.ws.onopen = () => {
        console.log("[WebSocket] Connected to SAARTHI Vision Pipeline");
        STATE.wsRetryCount = 0;
        updateStatus(STATE.mode === 'micro' ? 'Precision' : (STATE.mode === 'task' ? 'Task Guide' : 'Scanning'), 'active');
        
        if (STATE.mode === 'micro') {
            startMicroLoop();
        } else {
            startLoop();
        }
    };

    STATE.ws.onmessage = async (msg) => {
        try {
            const data = JSON.parse(msg.data);
            handleServerMessage(data);
        } catch (e) {
            console.error("[WebSocket] Parse Error:", e);
        }
    };

    STATE.ws.onclose = (e) => {
        console.warn("[WebSocket] Closed:", e.code);
        if (STATE.active) {
            updateStatus('Reconnecting...', 'warning');
            const retryDelay = Math.min(4000, 1000 * Math.pow(1.4, STATE.wsRetryCount));
            STATE.wsRetryCount++;
            setTimeout(connectWS, retryDelay);
        }
    };

    STATE.ws.onerror = (e) => {
        console.error("[WebSocket] Error:", e);
    };
}

function handleServerMessage(data) {
    // Mode Switching Logic
    if (data.mode && data.mode !== STATE.mode) {
        STATE.mode = data.mode;
        
        if (STATE.mode === 'micro') {
            showFeedback('MICRO NAV MODE');
            if (window.spatialAudio) window.spatialAudio.startMicroTone();
            updateStatus('Precision Micro-Nav', 'active');
            if (UI.dockBtnMicro) UI.dockBtnMicro.classList.add('active');
            startMicroLoop();
        } else if (STATE.mode === 'task') {
            showFeedback('TASK GUIDANCE MODE');
            if (window.spatialAudio) window.spatialAudio.stopMicroTone();
            updateStatus('Task Guidance', 'active');
            if (UI.dockBtnTask) UI.dockBtnTask.classList.add('active');
            startLoop();
        } else {
            showFeedback('NAVIGATION MODE');
            if (window.spatialAudio) window.spatialAudio.stopMicroTone();
            updateStatus('Scanning Surroundings', 'active');
            if (UI.dockBtnMicro) UI.dockBtnMicro.classList.remove('active');
            if (UI.dockBtnTask) UI.dockBtnTask.classList.remove('active');
            startLoop();
        }
    }

    // Audio Spatial Feedback
    handleAudioFeedback(data);

    // Route to UI Handlers
    switch (data.type) {
        case 'result': 
            updateNavUI(data); 
            break;
        case 'micro_result': 
            updateMicroUI(data); 
            break;
        case 'task_update': 
            updateTaskUI(data); 
            break;
        case 'inquiry_result': 
            updateInquiryUI(data); 
            break;
        case 'speak': 
            speak(data.text); 
            break;
        case 'feedback':
            if (data.text) showFeedback(data.text);
            break;
    }
}

function handleAudioFeedback(data) {
    if (!window.spatialAudio) return;

    // Micro Mode Feedback
    if (data.type === 'micro_result') {
        const { x, y, action } = data;
        window.spatialAudio.updateMicroTone(x, y);

        // Proximity Geiger clicks
        const dist = Math.sqrt(x * x + y * y);
        const maxDist = 120;
        const proximity = 1 - (Math.min(dist, maxDist) / maxDist);
        const now = Date.now();
        if (now - STATE.lastGeiger > (280 - (proximity * 220))) {
            window.spatialAudio.playGeigerClick(x, y);
            STATE.lastGeiger = now;
        }

        if (action === 'push') {
            window.spatialAudio.stopMicroTone();
            window.spatialAudio.playSuccess();
            showFeedback('PUSH NOW', 2000);
        }
        return;
    }

    // Standard Nav Feedback
    if (data.type === 'result' && data.distance > 0) {
        if (data.target_detected) {
            window.spatialAudio.playTargetLocked(data.direction, data.distance);
        } else if (data.priority === 'critical' || data.priority === 'high') {
            window.spatialAudio.playSonar(data.direction, data.distance, data.priority);
        }
    }
}

// Text-to-Speech synthesis with deduplication and natural speech
let lastSpokenText = "";
let lastSpokenTime = 0;

export function speak(text) {
    if (!text || !window.speechSynthesis) return;
    const now = Date.now();
    if (text === lastSpokenText && now - lastSpokenTime < 3000) return;
    lastSpokenText = text;
    lastSpokenTime = now;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    
    // Pick natural voice if available
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (naturalVoice) utterance.voice = naturalVoice;

    window.speechSynthesis.speak(utterance);
}

export function sendFrame(blob) {
    if (STATE.ws && STATE.ws.readyState === WebSocket.OPEN) {
        STATE.ws.send(blob);
    }
}

export function sendInquiryData(imageDataUrl, audioBase64 = null, textQuery = null) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) {
        showFeedback('CONNECTING...');
        return;
    }

    STATE.ws.send(JSON.stringify({
        type: 'inquiry',
        image: imageDataUrl,
        audio: audioBase64,
        query: textQuery
    }));
}

export function sendModeChange(mode, target = null) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    STATE.ws.send(JSON.stringify({
        type: 'set_mode',
        mode: mode,
        target: target
    }));
}

export function sendTaskAction(action) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    STATE.ws.send(JSON.stringify({
        type: 'task_action',
        action: action
    }));
}

export function sendStartTask(taskName) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    STATE.ws.send(JSON.stringify({
        type: 'start_task',
        task_name: taskName
    }));
}

export function sendSearchGoal(goal) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    STATE.ws.send(JSON.stringify({
        type: 'search',
        goal: goal
    }));
}

export function sendLocationTag(name, description) {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    STATE.ws.send(JSON.stringify({
        type: 'tag_location',
        name: name,
        description: description
    }));
}
