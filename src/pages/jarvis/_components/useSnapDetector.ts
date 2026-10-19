import { useEffect, useRef, useState } from 'react';

// A finger snap is a very short, loud, bright click: a sudden jump in level, most energy above
// ~2 kHz, and silence again within roughly 150 ms. Speech, music and knocks fail at least one test.
const MIN_PEAK = 0.25;
const MIN_ONSET_RATIO = 6; // level jump versus the running noise floor
const MIN_HIGH_FREQ_SHARE = 0.45;
const HIGH_FREQ_HZ = 2000;
const MAX_SNAP_MS = 160;
const COOLDOWN_MS = 1500;

export type SnapState = 'off' | 'starting' | 'on' | 'denied';

/** Listens on the microphone while `enabled` and calls `onSnap` when a finger snap is heard (unless `paused`). */
export function useSnapDetector(enabled: boolean, paused: boolean, onSnap: () => void): SnapState {
    const [state, setState] = useState<SnapState>('off');
    const onSnapRef = useRef(onSnap);
    const pausedRef = useRef(paused);
    onSnapRef.current = onSnap;
    pausedRef.current = paused;

    useEffect(() => {
        if (!enabled) {
            setState('off');
            return;
        }
        let cancelled = false;
        let frame = 0;
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;

        (async () => {
            setState('starting');
            try {
                // Browser noise suppression removes exactly the clicks we are looking for.
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                });
            } catch {
                if (!cancelled) setState('denied');
                return;
            }
            if (cancelled) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            context = new AudioContext();
            await context.resume();
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0;
            context.createMediaStreamSource(stream).connect(analyser);

            const samples = new Float32Array(analyser.fftSize);
            const spectrum = new Float32Array(analyser.frequencyBinCount);
            const highBin = Math.floor((HIGH_FREQ_HZ / (context.sampleRate / 2)) * spectrum.length);

            let noiseFloor = 0.01;
            let onsetAt = 0;
            let onsetLevel = 0;
            let lastSnapAt = 0;
            let previousRms = 0;
            let waitForQuiet = false;
            setState('on');

            const tick = () => {
                frame = requestAnimationFrame(tick);
                analyser.getFloatTimeDomainData(samples);
                let peak = 0;
                let sumSquares = 0;
                for (const s of samples) {
                    peak = Math.max(peak, Math.abs(s));
                    sumSquares += s * s;
                }
                const rms = Math.sqrt(sumSquares / samples.length);
                const now = performance.now();
                const risenFrom = previousRms;
                previousRms = rms;

                // After a long sound (speech, music) wait for silence, so its fade-out is not taken for a snap.
                if (waitForQuiet) {
                    if (rms < noiseFloor * 2) waitForQuiet = false;
                    return;
                }

                if (onsetAt) {
                    // A candidate onset only counts if the sound dies away quickly.
                    if (rms < onsetLevel * 0.35) {
                        onsetAt = 0;
                        if (!pausedRef.current && now - lastSnapAt > COOLDOWN_MS) {
                            lastSnapAt = now;
                            onSnapRef.current();
                        }
                    } else if (now - onsetAt > MAX_SNAP_MS) {
                        onsetAt = 0;
                        waitForQuiet = true;
                    }
                    return;
                }

                if (peak > MIN_PEAK && rms > noiseFloor * MIN_ONSET_RATIO && rms > risenFrom * 2) {
                    analyser.getFloatFrequencyData(spectrum);
                    let total = 0;
                    let high = 0;
                    spectrum.forEach((db, i) => {
                        const power = 10 ** (db / 10);
                        total += power;
                        if (i >= highBin) high += power;
                    });
                    if (total > 0 && high / total > MIN_HIGH_FREQ_SHARE) {
                        onsetAt = now;
                        onsetLevel = rms;
                        return;
                    }
                }
                noiseFloor = noiseFloor * 0.98 + Math.max(rms, 0.002) * 0.02;
            };
            tick();
        })();

        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            stream?.getTracks().forEach((t) => t.stop());
            context?.close();
        };
    }, [enabled]);

    return state;
}

/** Short rising "power-up" chirp so the user hears that the snap was recognised. */
export function playActivationSound() {
    try {
        const context = new AudioContext();
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, context.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1600, context.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
        osc.connect(gain).connect(context.destination);
        osc.start();
        osc.stop(context.currentTime + 0.26);
        osc.onended = () => context.close();
    } catch {
        // Audio feedback is optional.
    }
}
