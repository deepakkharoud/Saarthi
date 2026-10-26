/**
 * SAARTHI - Configuration & State Architecture
 * Assistive Vision & Spatial Intelligence System
 */

export const CONFIG = {
    scanInterval: 1200,     // Interval between standard navigation frames (ms)
    microInterval: 250,     // Interval between micro-nav precision frames (ms)
    imgWidth: 480,          // Processing canvas width
    jpegQuality: 0.55       // Frame compression quality
};

export const STATE = {
    active: false,
    debug: false,
    ws: null,
    loop: null,
    heading: 0,
    lastShake: 0,
    mode: 'nav',            // 'nav' | 'micro' | 'task'
    microTarget: null,
    currentGoal: null,
    lastGeiger: 0,
    wsRetryCount: 0,
    videoSource: 'camera',  // 'camera' | 'simulator'
    currentScenario: 'social', // 'social' | 'elevator' | 'coffee' | 'desk'
    simAnimFrame: null,
    isRecording: false,
    volume: 0.8
};
