/**
 * SAARTHI - Production Grade UI Manager
 * Handles DOM telemetry, Reticle targeting vectors, Task HUD, Intelligence Drawer,
 * and high-contrast accessibility feedback.
 */

import { STATE } from './config.js';

export const UI = {
    cam: document.getElementById('cam'),
    simCanvas: document.getElementById('sim-canvas'),
    body: document.body,

    // Header Status
    statusPill: document.getElementById('statusPill'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    searchPill: document.getElementById('searchPill'),

    // Reticle
    reticleOverlay: document.getElementById('reticle-overlay'),
    reticleVector: document.getElementById('reticle-vector'),
    reticleBadge: document.getElementById('reticle-badge'),

    // Hero Start Card
    heroStartCard: document.getElementById('hero-start-card'),
    heroStartBtn: document.getElementById('hero-start-btn'),

    // Alert Banner
    mainAlertBanner: document.getElementById('main-alert-banner'),
    alertBannerText: document.getElementById('alert-banner-text'),

    // Task Live Activity Card
    taskHudCard: document.getElementById('task-hud-card'),
    taskStepList: document.getElementById('task-step-list'),
    taskStepBadge: document.getElementById('task-card-step-badge'),
    taskProgressFill: document.getElementById('task-progress-fill'),
    taskVisualFeedback: document.getElementById('task-visual-feedback'),
    taskCardName: document.getElementById('task-card-name'),

    // Intelligence Drawer
    intelDrawer: document.getElementById('intelligence-drawer'),
    drawerCloseBtn: document.getElementById('drawer-close-btn'),
    drawerSocialCue: document.getElementById('drawer-social-cue'),
    drawerSocialText: document.getElementById('drawer-social-text'),
    drawerSocialEmpty: document.getElementById('drawer-social-empty'),
    drawerEnvCue: document.getElementById('drawer-env-cue'),
    drawerEnvText: document.getElementById('drawer-env-text'),
    drawerEnvEmpty: document.getElementById('drawer-env-empty'),
    drawerThinkingLog: document.getElementById('drawer-thinking-log'),
    drawerObjList: document.getElementById('drawer-object-list'),
    drawerObjCount: document.getElementById('drawer-obj-count'),

    // Telemetry Cells
    telemDist: document.getElementById('telem-dist'),
    telemDir: document.getElementById('telem-dir'),
    telemLat: document.getElementById('telem-lat'),
    compassBadge: document.getElementById('compass-badge'),

    // Control Dock
    dockBtnPower: document.getElementById('dock-btn-power'),
    dockPowerText: document.getElementById('dock-power-text'),
    dockBtnMic: document.getElementById('dock-btn-mic'),
    dockBtnAsk: document.getElementById('dock-btn-ask'),
    dockBtnMicro: document.getElementById('dock-btn-micro'),
    dockBtnTask: document.getElementById('dock-btn-task'),
    dockBtnMemory: document.getElementById('dock-btn-memory'),
    dockBtnIntel: document.getElementById('dock-btn-intel'),
    dockBtnSettings: document.getElementById('dock-btn-settings'),

    // Header Tool Triggers
    btnHeaderDrawer: document.getElementById('btn-header-drawer'),
    btnHeaderSettings: document.getElementById('btn-header-settings'),

    // Modals
    modalCommand: document.getElementById('modal-command'),
    modalMemory: document.getElementById('modal-memory'),
    modalSettings: document.getElementById('modal-settings')
};

// --- Toast Feedback Banner ---

let alertTimeout = null;
export function showFeedback(text, duration = 2000) {
    if (!UI.mainAlertBanner || !UI.alertBannerText) return;
    UI.alertBannerText.textContent = text;
    UI.mainAlertBanner.classList.add('visible');

    if (alertTimeout) clearTimeout(alertTimeout);
    alertTimeout = setTimeout(() => {
        UI.mainAlertBanner.classList.remove('visible');
    }, duration);
}

export function updateStatus(text, stateClass = '') {
    if (UI.statusText) UI.statusText.textContent = text;
    if (UI.statusDot) {
        UI.statusDot.className = `status-indicator-dot ${stateClass}`;
    }
}

// --- Intelligence Drawer Controls ---

export function toggleIntelDrawer() {
    if (!UI.intelDrawer) return;
    const isOpen = UI.intelDrawer.classList.toggle('open');
    if (UI.dockBtnIntel) UI.dockBtnIntel.classList.toggle('active', isOpen);
    if (window.spatialAudio) {
        window.spatialAudio.playTone(isOpen ? 750 : 420, 'sine', 0.1);
    }
}

export function closeIntelDrawer() {
    if (UI.intelDrawer) UI.intelDrawer.classList.remove('open');
    if (UI.dockBtnIntel) UI.dockBtnIntel.classList.remove('active');
}

// --- Modal Dialog Helpers ---

export function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('visible');
}

export function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
}

export function closeAllModals() {
    closeModal(UI.modalCommand);
    closeModal(UI.modalMemory);
    closeModal(UI.modalSettings);
    closeIntelDrawer();
}

// --- Real-Time Mode Visualizers ---

export function updateNavUI(data) {
    const { 
        thinking, 
        distance, 
        direction, 
        social_cues, 
        environment, 
        objects, 
        ms, 
        current_goal, 
        current_location_tag 
    } = data;

    // Reset Reticle for general navigation
    if (UI.reticleOverlay) {
        UI.reticleOverlay.classList.remove('locked');
        if (UI.reticleVector) UI.reticleVector.style.display = 'none';
        if (UI.reticleBadge) UI.reticleBadge.style.display = 'none';
    }

    // Search Goal Banner
    if (current_goal && UI.searchPill) {
        UI.searchPill.classList.add('visible');
        UI.searchPill.textContent = `SEARCH: ${current_goal}`;
    } else if (UI.searchPill) {
        UI.searchPill.classList.remove('visible');
    }

    // Thinking / AI Reasoning Log
    if (thinking && UI.drawerThinkingLog) {
        UI.drawerThinkingLog.textContent = thinking;
    }

    // Social Intelligence Cues
    if (social_cues && social_cues.intent && social_cues.intent !== 'none') {
        if (UI.drawerSocialCue) {
            UI.drawerSocialCue.style.display = 'flex';
            if (UI.drawerSocialEmpty) UI.drawerSocialEmpty.style.display = 'none';
            if (UI.drawerSocialText) {
                UI.drawerSocialText.innerHTML = `
                    <b>${social_cues.intent === 'interaction_seeking' ? 'Active Engagement' : 'Social Cue'}:</b> 
                    ${social_cues.details || social_cues.intent}
                `;
            }
        }
        // Also show alert toast if active greeting
        if (social_cues.intent === 'interaction_seeking') {
            showFeedback(`👋 ${social_cues.details || 'Person engaging ahead'}`);
        }
    } else {
        if (UI.drawerSocialCue) UI.drawerSocialCue.style.display = 'none';
        if (UI.drawerSocialEmpty) UI.drawerSocialEmpty.style.display = 'block';
    }

    // Environmental Affordances
    if (environment && (environment.occupancy === 'occupied' || environment.affordances)) {
        if (UI.drawerEnvCue) {
            UI.drawerEnvCue.style.display = 'flex';
            if (UI.drawerEnvEmpty) UI.drawerEnvEmpty.style.display = 'none';
            if (UI.drawerEnvText) {
                UI.drawerEnvText.innerHTML = `
                    <b>${environment.markers?.[0] || 'Environment State'}:</b> 
                    ${environment.affordances ? `Affordance: ${environment.affordances}` : 'Obstruction detected'}
                `;
            }
        }
    } else {
        if (UI.drawerEnvCue) UI.drawerEnvCue.style.display = 'none';
        if (UI.drawerEnvEmpty) UI.drawerEnvEmpty.style.display = 'block';
    }

    // Memory Palace Location Tag
    if (current_location_tag) {
        showFeedback(`📍 Recognized: ${current_location_tag}`);
    }

    // Telemetry Strip
    if (UI.telemDist && typeof distance === 'number') {
        UI.telemDist.textContent = distance < 1.0 
            ? `${Math.round(distance * 100)}cm` 
            : `${distance.toFixed(1)}m`;
    }
    if (UI.telemDir) UI.telemDir.textContent = direction || '--';
    if (UI.telemLat && ms) UI.telemLat.textContent = `${ms}ms`;

    // Detected Objects Table
    if (UI.drawerObjList) {
        if (!objects || objects.length === 0) {
            UI.drawerObjList.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:10px;">Scanning environment...</div>';
            if (UI.drawerObjCount) UI.drawerObjCount.textContent = '0 items';
        } else {
            if (UI.drawerObjCount) UI.drawerObjCount.textContent = `${objects.length} items`;
            UI.drawerObjList.innerHTML = objects.map(o => {
                const isNear = (o.distance || 99) < 1.0;
                return `
                    <div class="object-item-row">
                        <span>${o.name}</span>
                        <span class="object-dist-tag ${isNear ? 'near' : ''}">
                            ${o.distance < 1.0 ? Math.round(o.distance * 100) + 'cm' : o.distance.toFixed(1) + 'm'}
                        </span>
                    </div>
                `;
            }).join('');
        }
    }
}

export function updateMicroUI(data) {
    const { x, y, action, guidance_speech, target, ms } = data;

    if (UI.telemLat && ms) UI.telemLat.textContent = `${ms}ms`;

    if (UI.reticleOverlay) {
        if (UI.reticleBadge) {
            UI.reticleBadge.style.display = 'inline-block';
            UI.reticleBadge.textContent = `TARGET: ${target || 'OBJECT'}`;
        }

        const dist = Math.sqrt(x * x + y * y);
        if (dist < 12 || action === 'push') {
            UI.reticleOverlay.classList.add('locked');
            if (UI.reticleVector) UI.reticleVector.style.display = 'none';
        } else {
            UI.reticleOverlay.classList.remove('locked');
            if (UI.reticleVector) {
                UI.reticleVector.style.display = 'block';
                const angleRad = Math.atan2(y, x);
                const angleDeg = (angleRad * 180 / Math.PI) + 90;
                UI.reticleVector.style.transform = `rotate(${angleDeg}deg)`;
                UI.reticleVector.style.height = `${Math.min(80, Math.max(25, dist * 1.4))}px`;
            }
        }
    }

    if (guidance_speech) {
        showFeedback(guidance_speech.toUpperCase(), 1200);
    }
}

export function updateTaskUI(data) {
    const { plan, current_step_index, visual_feedback, ms } = data;

    if (!UI.taskHudCard) return;
    UI.taskHudCard.classList.add('visible');

    if (UI.telemLat && ms) UI.telemLat.textContent = `${ms}ms`;
    if (UI.taskVisualFeedback) UI.taskVisualFeedback.textContent = visual_feedback || "";

    if (plan && plan.length > 0) {
        const stepNum = Math.min(current_step_index + 1, plan.length);
        if (UI.taskStepBadge) {
            UI.taskStepBadge.textContent = `Step ${stepNum}/${plan.length}`;
        }
        if (UI.taskProgressFill) {
            const pct = Math.round((stepNum / plan.length) * 100);
            UI.taskProgressFill.style.width = `${pct}%`;
        }

        if (UI.taskStepList) {
            UI.taskStepList.innerHTML = plan.map((step, idx) => {
                let cls = '';
                if (idx < current_step_index) cls = 'completed';
                else if (idx === current_step_index) cls = 'active';

                return `
                    <div class="task-step-item ${cls}">
                        <div class="task-step-num">${idx < current_step_index ? '✓' : idx + 1}</div>
                        <div style="flex:1;">${step.instruction}</div>
                    </div>
                `;
            }).join('');
        }
    }

    if (current_step_index >= plan.length) {
        setTimeout(() => {
            if (UI.taskHudCard) UI.taskHudCard.classList.remove('visible');
        }, 4000);
    }
}

export function updateInquiryUI(data) {
    const { thinking, current_goal, ms } = data;
    if (thinking && UI.drawerThinkingLog) UI.drawerThinkingLog.textContent = thinking;
    if (current_goal && UI.searchPill) {
        UI.searchPill.classList.add('visible');
        UI.searchPill.textContent = `SEARCH: ${current_goal}`;
    }
    if (UI.telemLat && ms) UI.telemLat.textContent = `${ms}ms`;
}
