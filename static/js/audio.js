/**
 * SAARTHI Spatial Audio System
 * Provides multi-channel auditory telemetry, sonar pings, Geiger proximity clicks,
 * and vector-based stereo micro-guidance.
 */

class SpatialAudio {
    constructor() {
        this.ctx = null;
        this.gain = null;
        this.microOsc = null;
        this.microGain = null;
        this.microPan = null;
        this.isPlayingMicro = false;
        this.volume = 0.8;
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.ctx = new AudioCtx();
            this.gain = this.ctx.createGain();
            this.gain.gain.value = this.volume;
            this.gain.connect(this.ctx.destination);
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(e => console.warn("AudioContext resume warning:", e));
        }
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.gain && this.ctx) {
            this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
        }
    }

    playTone(freq, type = 'sine', dur = 0.15) {
        if (!this.ctx) this.init();
        if (!this.ctx) return;
        this.ctx.resume();

        try {
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = type;
            o.frequency.value = freq;

            o.connect(g);
            g.connect(this.gain);

            const now = this.ctx.currentTime;
            g.gain.setValueAtTime(0.35, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + dur);

            o.start(now);
            o.stop(now + dur);
        } catch (e) {
            console.warn("Audio playTone error:", e);
        }
    }

    // Continuous Micro-Guidance Tone (Vector Panning + Pitch modulation)
    startMicroTone() {
        if (!this.ctx) this.init();
        if (!this.ctx || this.isPlayingMicro) return;
        this.ctx.resume();

        try {
            this.microOsc = this.ctx.createOscillator();
            this.microOsc.type = 'triangle';
            this.microOsc.frequency.value = 440; // Base 440Hz

            if (this.ctx.createStereoPanner) {
                this.microPan = this.ctx.createStereoPanner();
                this.microPan.pan.value = 0;
            }

            this.microGain = this.ctx.createGain();
            this.microGain.gain.value = 0.001;

            if (this.microPan) {
                this.microOsc.connect(this.microPan);
                this.microPan.connect(this.microGain);
            } else {
                this.microOsc.connect(this.microGain);
            }
            this.microGain.connect(this.gain);

            this.microOsc.start();
            this.microGain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.3);
            this.isPlayingMicro = true;
        } catch (e) {
            console.warn("startMicroTone error:", e);
        }
    }

    updateMicroTone(x, y) {
        if (!this.isPlayingMicro || !this.microOsc || !this.ctx) return;

        try {
            // Horizontal Stereo Pan: -1 (left) to 1 (right)
            if (this.microPan) {
                const panVal = Math.max(-1, Math.min(1, x / 40));
                this.microPan.pan.setTargetAtTime(panVal, this.ctx.currentTime, 0.08);
            }

            // Vertical Pitch: Higher pitch when hand needs to move UP (+y), lower when DOWN (-y)
            const baseFreq = 440;
            const pitchShift = (y / 40) * 220;
            const targetFreq = Math.max(120, Math.min(1200, baseFreq + pitchShift));

            this.microOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08);
        } catch (e) {
            console.warn("updateMicroTone error:", e);
        }
    }

    stopMicroTone() {
        if (!this.isPlayingMicro || !this.microOsc || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            this.microGain.gain.cancelScheduledValues(now);
            this.microGain.gain.setValueAtTime(this.microGain.gain.value, now);
            this.microGain.gain.linearRampToValueAtTime(0.001, now + 0.15);

            this.microOsc.stop(now + 0.15);
            setTimeout(() => {
                this.microOsc = null;
                this.microPan = null;
                this.microGain = null;
                this.isPlayingMicro = false;
            }, 200);
        } catch (e) {
            this.isPlayingMicro = false;
        }
    }

    playSonar(dir, dist, prio) {
        if (!this.ctx) this.init();
        if (!this.ctx) return;
        this.ctx.resume();

        try {
            const pan = Math.sin(this.parseDir(dir) * Math.PI / 180);
            const freq = prio === 'critical' ? 920 : (prio === 'high' ? 680 : 440);

            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = prio === 'critical' ? 'sawtooth' : 'sine';
            o.frequency.value = freq;

            let finalNode = g;
            if (this.ctx.createStereoPanner) {
                const panner = this.ctx.createStereoPanner();
                panner.pan.value = Math.max(-1, Math.min(1, pan));
                g.connect(panner);
                finalNode = panner;
            }

            o.connect(g);
            finalNode.connect(this.gain);

            const now = this.ctx.currentTime;
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(0.35, now + 0.04);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

            o.start(now);
            o.stop(now + 0.22);
        } catch (e) {
            console.warn("playSonar error:", e);
        }
    }

    playTargetLocked(dir, dist) {
        this.playTone(1100, 'square', 0.12);
        setTimeout(() => this.playTone(1400, 'sine', 0.18), 80);
    }

    playSuccess() {
        this.playTone(523.25, 'triangle', 0.15); // C5
        setTimeout(() => this.playTone(659.25, 'triangle', 0.15), 100); // E5
        setTimeout(() => this.playTone(783.99, 'triangle', 0.35), 200); // G5
    }

    playGeigerClick(x, y) {
        if (!this.ctx) this.init();
        if (!this.ctx) return;
        this.ctx.resume();

        try {
            const distance = Math.sqrt(x * x + y * y);
            const max_dist = 140;
            const proximity = 1 - (Math.min(distance, max_dist) / max_dist);

            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = 800 + (proximity * 900);

            o.connect(g);
            g.connect(this.gain);

            const now = this.ctx.currentTime;
            g.gain.setValueAtTime(0.25, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            o.start(now);
            o.stop(now + 0.04);
        } catch (e) {
            // Ignore click error
        }
    }

    parseDir(dir) {
        if (!dir) return 0;
        const d = String(dir).toLowerCase();
        if (d.includes('left') || d.includes('10') || d.includes('9') || d.includes('8')) return -45;
        if (d.includes('right') || d.includes('2') || d.includes('3') || d.includes('4')) return 45;
        return 0;
    }
}

// Global singleton instance
const spatialAudio = new SpatialAudio();
window.spatialAudio = spatialAudio;
