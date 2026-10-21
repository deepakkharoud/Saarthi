/**
 * SAARTHI - Main Application Orchestrator
 * Coordinates video capture, Scene Simulator, WebSocket frame pipeline,
 * and high-level multimodal navigation interactions.
 */

import { CONFIG, STATE } from './config.js';
import { UI, showFeedback, updateStatus, openModal, closeModal, closeAllModals } from './ui.js';
import { 
    connectWS, 
    sendFrame, 
    sendInquiryData, 
    sendModeChange, 
    sendTaskAction, 
    sendStartTask 
} from './network.js';
import { setupInputs } from './input.js';

// Initialize Inputs & Gestures
setupInputs();

// Global namespace for console debugging
window.SAARTHI = { STATE, CONFIG, UI };

// Initialize System Status on load
initSystemStatus();

// Setup Interactive Modals & Actions
setupModalInteractions();
setupTaskHudActions();


// =============================================================================
// SYSTEM POWER CONTROL (START / STOP)
// =============================================================================

export async function toggleSystem() {
    if (STATE.active) {
        stopSystem();
    } else {
        await startSystem();
    }
}

async function startSystem() {
    if (window.spatialAudio) window.spatialAudio.init();

    if (STATE.videoSource === 'simulator') {
        startSimulatorFeed();
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 }
                }
            });

            UI.cam.srcObject = stream;
            await new Promise(resolve => UI.cam.onloadedmetadata = resolve);
            UI.body.classList.remove('sim-active');

        } catch (e) {
            console.warn("Real camera unavailable or blocked, activating Scene Simulator:", e);
            STATE.videoSource = 'simulator';
            startSimulatorFeed();
        }
    }

    STATE.active = true;
    UI.body.classList.add('active');
    if (UI.dockBtnPower) UI.dockBtnPower.classList.add('active');
    if (UI.dockPowerText) UI.dockPowerText.textContent = 'Stop';

    showFeedback('SAARTHI ACTIVE');
    updateStatus('Connecting...', 'active');

    connectWS();
}

function stopSystem() {
    STATE.active = false;
    STATE.mode = 'nav';
    STATE.wsRetryCount = 0;

    if (window.spatialAudio) window.spatialAudio.stopMicroTone();
    UI.body.classList.remove('active');
    if (UI.dockBtnPower) UI.dockBtnPower.classList.remove('active');
    if (UI.dockPowerText) UI.dockPowerText.textContent = 'Start';

    // Close WebSocket
    if (STATE.ws) {
        STATE.ws.onclose = null;
        STATE.ws.close();
        STATE.ws = null;
    }

    // Stop Processing Loop
    stopLoop();

    // Stop Simulator Animation
    if (STATE.simAnimFrame) {
        cancelAnimationFrame(STATE.simAnimFrame);
        STATE.simAnimFrame = null;
    }

    // Stop Real Camera
    if (UI.cam && UI.cam.srcObject) {
        UI.cam.srcObject.getTracks().forEach(track => track.stop());
        UI.cam.srcObject = null;
    }

    showFeedback('STANDBY');
    updateStatus('Ready', '');
}


// =============================================================================
// FRAME TRANSMISSION LOOPS
// =============================================================================

export function startLoop() {
    if (STATE.loop) clearInterval(STATE.loop);
    STATE.loop = setInterval(tick, CONFIG.scanInterval);
}

export function startMicroLoop() {
    if (STATE.loop) clearInterval(STATE.loop);
    STATE.loop = setInterval(tick, CONFIG.microInterval);
}

function stopLoop() {
    if (STATE.loop) clearInterval(STATE.loop);
    STATE.loop = null;
}

function tick() {
    if (!STATE.active || !STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;

    const cvs = document.createElement('canvas');
    cvs.width = CONFIG.imgWidth;
    cvs.height = Math.round(CONFIG.imgWidth * 0.75); // 4:3
    const ctx = cvs.getContext('2d');

    if (STATE.videoSource === 'simulator' && UI.simCanvas) {
        ctx.drawImage(UI.simCanvas, 0, 0, cvs.width, cvs.height);
    } else if (UI.cam && UI.cam.videoWidth > 0) {
        ctx.drawImage(UI.cam, 0, 0, cvs.width, cvs.height);
    } else {
        ctx.fillStyle = '#08090D';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
    }

    cvs.toBlob(blob => {
        if (blob) sendFrame(blob);
    }, 'image/jpeg', CONFIG.jpegQuality);
}

export function captureCurrentFrameDataUrl() {
    const cvs = document.createElement('canvas');
    cvs.width = CONFIG.imgWidth;
    cvs.height = Math.round(CONFIG.imgWidth * 0.75);
    const ctx = cvs.getContext('2d');

    if (STATE.videoSource === 'simulator' && UI.simCanvas) {
        ctx.drawImage(UI.simCanvas, 0, 0, cvs.width, cvs.height);
    } else if (UI.cam && UI.cam.videoWidth > 0) {
        ctx.drawImage(UI.cam, 0, 0, cvs.width, cvs.height);
    } else {
        ctx.fillStyle = '#0E1118';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
    }

    return cvs.toDataURL('image/jpeg', 0.65);
}


// =============================================================================
// INTERACTIVE SCENE SIMULATOR (High-Fidelity Canvas Demonstration)
// =============================================================================

function startSimulatorFeed() {
    UI.body.classList.add('sim-active');
    const canvas = UI.simCanvas;
    if (!canvas) return;

    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    let t = 0;

    function renderSim() {
        t += 0.03;
        ctx.fillStyle = '#090B10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Architectural depth guides
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, canvas.height);
            ctx.lineTo(canvas.width / 2, canvas.height / 2);
            ctx.stroke();
        }

        if (STATE.currentScenario === 'social') {
            // Scenario 1: Approaching colleague with smile and waving hand
            const scale = 1 + Math.sin(t * 0.8) * 0.12;
            const px = canvas.width / 2 + Math.sin(t * 0.5) * 16;
            const py = canvas.height / 2 + 25;

            // Head
            ctx.fillStyle = '#F5D0A9';
            ctx.beginPath();
            ctx.arc(px, py - 60 * scale, 22 * scale, 0, Math.PI * 2);
            ctx.fill();

            // Smile
            ctx.strokeStyle = '#5A2A18';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(px, py - 58 * scale, 11 * scale, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();

            // Torso
            ctx.fillStyle = '#3B82F6';
            ctx.beginPath();
            ctx.ellipse(px, py + 18 * scale, 32 * scale, 52 * scale, 0, 0, Math.PI * 2);
            ctx.fill();

            // Waving Hand
            const waveY = py - 70 * scale + Math.sin(t * 8) * 14;
            ctx.fillStyle = '#F5D0A9';
            ctx.beginPath();
            ctx.arc(px + 44 * scale, waveY, 11 * scale, 0, Math.PI * 2);
            ctx.fill();

            // Clean modern identification badge
            ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
            ctx.font = '600 13px Inter, sans-serif';
            ctx.fillText("Active Engagement • Approaching & Waving", px - 130, py - 95 * scale);

        } else if (STATE.currentScenario === 'elevator') {
            // Scenario 2: Elevator panel with button 4
            ctx.fillStyle = '#1A202C';
            ctx.roundRect ? ctx.roundRect(canvas.width / 2 - 80, 70, 160, 340, 12) : ctx.fillRect(canvas.width / 2 - 80, 70, 160, 340);
            ctx.fill();

            for (let b = 1; b <= 4; b++) {
                const by = 350 - (b * 65);
                ctx.fillStyle = b === 4 ? '#10B981' : '#2D3748';
                ctx.beginPath();
                ctx.arc(canvas.width / 2, by, 22, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#FFFFFF';
                ctx.font = '700 16px "JetBrains Mono", monospace';
                ctx.fillText(String(b), canvas.width / 2 - 6, by + 6);
            }

            ctx.fillStyle = '#94A3B8';
            ctx.font = '600 12px Inter, sans-serif';
            ctx.fillText("Elevator Panel • Target: Button 4", canvas.width / 2 - 95, 52);

        } else if (STATE.currentScenario === 'coffee') {
            // Scenario 3: Coffee station & mug
            ctx.fillStyle = '#262E3B';
            ctx.fillRect(canvas.width / 2 - 110, 130, 220, 230);

            // Mug
            ctx.fillStyle = '#EF4444';
            ctx.fillRect(canvas.width / 2 - 28, 280, 56, 60);
            ctx.beginPath();
            ctx.arc(canvas.width / 2 + 32, 310, 15, -Math.PI / 2, Math.PI / 2);
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#EF4444';
            ctx.stroke();

            // Steam
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(canvas.width / 2 - 8, 270);
            ctx.quadraticCurveTo(canvas.width / 2 - 12 + Math.sin(t * 3) * 8, 240, canvas.width / 2 - 8, 215);
            ctx.stroke();

            ctx.fillStyle = '#94A3B8';
            ctx.font = '600 12px Inter, sans-serif';
            ctx.fillText("Coffee Station • Task Verification Active", canvas.width / 2 - 110, 110);

        } else {
            // Scenario 4: Office desk memory palace
            ctx.fillStyle = '#334155';
            ctx.fillRect(70, 250, 500, 170);

            // Laptop
            ctx.fillStyle = '#475569';
            ctx.fillRect(canvas.width / 2 - 65, 210, 130, 85);
            ctx.fillStyle = '#06B6D4';
            ctx.fillRect(canvas.width / 2 - 60, 215, 120, 75);

            // Water bottle
            ctx.fillStyle = '#3B82F6';
            ctx.fillRect(canvas.width / 2 + 105, 195, 28, 75);

            // Keys
            ctx.fillStyle = '#F59E0B';
            ctx.beginPath();
            ctx.arc(canvas.width / 2 - 110, 285, 11, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#94A3B8';
            ctx.font = '600 12px Inter, sans-serif';
            ctx.fillText("Recognized Location: [Work Desk]", canvas.width / 2 - 95, 180);
        }

        if (STATE.active) {
            STATE.simAnimFrame = requestAnimationFrame(renderSim);
        }
    }

    renderSim();
}


// =============================================================================
// MODALS SETUP & API INTEGRATIONS
// =============================================================================

function setupModalInteractions() {
    // Close triggers
    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeAllModals();
        });
    });

    // Command Input Modal
    const cmdInput = document.getElementById('command-input');
    const cmdSubmit = document.getElementById('command-submit-btn');

    if (cmdSubmit && cmdInput) {
        cmdSubmit.addEventListener('click', () => {
            const query = cmdInput.value.trim();
            if (!query) return;
            const frameDataUrl = captureCurrentFrameDataUrl();
            sendInquiryData(frameDataUrl, null, query);
            cmdInput.value = '';
            closeAllModals();
            showFeedback(`COMMAND: "${query}"`);
        });

        cmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cmdSubmit.click();
        });
    }

    // Command Preset Chips
    document.querySelectorAll('.preset-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const cmd = btn.getAttribute('data-cmd');
            if (cmd) {
                const frameDataUrl = captureCurrentFrameDataUrl();
                sendInquiryData(frameDataUrl, null, cmd);
                closeAllModals();
                showFeedback(cmd);
            }
        });
    });

    // Settings Modal
    const apiKeyInput = document.getElementById('settings-api-key');
    const modelSelect = document.getElementById('settings-model-select');
    const videoSourceSelect = document.getElementById('settings-video-source');
    const scenarioSelect = document.getElementById('settings-scenario-select');
    const volumeSlider = document.getElementById('settings-volume-slider');
    const settingsSaveBtn = document.getElementById('settings-save-btn');
    const audioTestBtn = document.getElementById('btn-test-audio');

    if (settingsSaveBtn) {
        settingsSaveBtn.addEventListener('click', async () => {
            const key = apiKeyInput?.value.trim();
            const model = modelSelect?.value;
            const vSource = videoSourceSelect?.value;
            const scen = scenarioSelect?.value;

            if (key) {
                try {
                    const res = await fetch('/api/settings/key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, model: model })
                    });
                    const d = await res.json();
                    showFeedback(d.message || 'Key saved successfully');
                } catch (e) {
                    console.error("Save Key Error:", e);
                }
            }

            if (vSource) {
                STATE.videoSource = vSource;
                if (vSource === 'simulator') {
                    startSimulatorFeed();
                } else if (STATE.active) {
                    UI.body.classList.remove('sim-active');
                    startSystem();
                }
            }
            if (scen) {
                STATE.currentScenario = scen;
            }

            closeAllModals();
            initSystemStatus();
        });
    }

    if (audioTestBtn) {
        audioTestBtn.addEventListener('click', () => {
            if (window.spatialAudio) {
                window.spatialAudio.init();
                window.spatialAudio.playTone(660, 'triangle', 0.15);
                setTimeout(() => window.spatialAudio.playSuccess(), 220);
            }
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            STATE.volume = val;
            if (window.spatialAudio) window.spatialAudio.setVolume(val);
        });
    }

    // Memory Palace: Tag location button & refresh
    const tagLocBtn = document.getElementById('btn-tag-loc');
    if (tagLocBtn) {
        tagLocBtn.addEventListener('click', async () => {
            const name = prompt("Enter a name for this location (e.g., 'Work Desk', 'Kitchen'):", "Work Desk");
            if (!name) return;
            const desc = prompt("Enter visual description:", "Desk with laptop and water bottle");
            if (!desc) return;

            try {
                const res = await fetch('/api/memory/tag', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, description: desc })
                });
                const d = await res.json();
                showFeedback(`TAGGED: ${name}`);
                loadMemoryPalaceData();
            } catch (e) {
                console.error("Tag error:", e);
            }
        });
    }

    if (UI.dockBtnMemory) {
        UI.dockBtnMemory.addEventListener('click', loadMemoryPalaceData);
    }
}

// Setup Task HUD action buttons
function setupTaskHudActions() {
    const btnDone = document.getElementById('task-btn-done');
    const btnSkip = document.getElementById('task-btn-skip');
    const btnCancel = document.getElementById('task-btn-cancel');

    if (btnDone) btnDone.addEventListener('click', () => sendTaskAction('done'));
    if (btnSkip) btnSkip.addEventListener('click', () => sendTaskAction('skip'));
    if (btnCancel) btnCancel.addEventListener('click', () => sendModeChange('nav'));
}

async function initSystemStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const apiKeyInput = document.getElementById('settings-api-key');
        if (apiKeyInput && data.has_gemini_key) {
            apiKeyInput.placeholder = "•••••••••••••••••••• (API Key Active)";
        }
    } catch (e) {
        // Backend status fetch error
    }
}

async function loadMemoryPalaceData() {
    try {
        const res = await fetch('/api/memory');
        const data = await res.json();
        const locContainer = document.getElementById('memory-locations-list');
        const histContainer = document.getElementById('memory-history-list');

        if (locContainer) {
            const locEntries = Object.entries(data.locations || {});
            if (locEntries.length === 0) {
                locContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px;">No locations tagged yet. Tag locations by voice or click "+ Tag Location".</div>';
            } else {
                locContainer.innerHTML = locEntries.map(([name, details]) => `
                    <div class="object-item-row" style="flex-direction:column; align-items:flex-start; gap:3px;">
                        <div style="font-weight:600; color:#A5B4FC;">📍 ${name}</div>
                        <div style="font-size:12px; color:var(--text-secondary);">${details.description}</div>
                    </div>
                `).join('');
            }
        }

        if (histContainer) {
            const history = data.history || [];
            if (history.length === 0) {
                histContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px;">No recent object sightings.</div>';
            } else {
                histContainer.innerHTML = history.slice(-8).reverse().map(h => {
                    const timeStr = new Date(h.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return `
                        <div class="object-item-row" style="font-size:12px;">
                            <span>📦 <b>${h.object}</b> ${h.location ? `at <i>${h.location}</i>` : ''}</span>
                            <span style="color:var(--text-muted);">${timeStr}</span>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error("Failed to load memory:", e);
    }
}

export function checkDebugOverlay() {
    const box = document.getElementById('console-log');
    if (box) box.classList.toggle('visible');
}

// On-Screen Logging Setup
(function setupConsole() {
    const box = document.getElementById('console-log');
    if (!box) return;

    const _log = console.log;
    const _err = console.error;

    const addItem = (msg, type) => {
        const div = document.createElement('div');
        div.className = `log-entry log-${type}`;
        div.textContent = `[${type.toUpperCase()}] ${msg}`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    };

    console.log = (...args) => { _log(...args); addItem(args.join(' '), 'info'); };
    console.error = (...args) => { _err(...args); addItem(args.join(' '), 'error'); };
})();
