import { useEffect, useRef, useState, type ReactNode } from 'react';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type Status = 'idle' | 'listening' | 'thinking' | 'planning' | 'speaking';

type MissionStep = { title: string; detail: string; estimate_eur: number; done?: boolean };
type Mission = {
    goal: string;
    title: string;
    briefing: string;
    target_eur: number;
    reality_check: string;
    steps: MissionStep[];
    earned_eur: number;
};

const STATUS_LABEL: Record<Status, string> = {
    idle: 'System bereit',
    listening: 'Höre zu …',
    thinking: 'Verarbeite …',
    planning: 'Plane Mission …',
    speaking: 'Spreche …'
};

const MISSION_STORAGE_KEY = 'jarvis-mission';

// "Mein Ziel ist …", "Ziel: …", "Neues Ziel …" start mission planning instead of a chat reply.
const GOAL_PATTERN = /^\s*(?:jarvis[,!]?\s*)?(?:mein\s+|neues\s+|unser\s+)?ziel(?:\s+ist)?\s*[:,-]?\s+(.{4,})$/i;

// Minimal typing for the Web Speech API, which is not part of lib.dom in all TS versions.
type SpeechRecognitionLike = {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    start: () => void;
    stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as Record<string, unknown>;
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    return (
        voices.find((v) => v.lang.startsWith('de') && /male|mann|markus|yannick|conrad/i.test(v.name)) ??
        voices.find((v) => v.lang.startsWith('de')) ??
        voices[0]
    );
}

function loadMission(): Mission | null {
    try {
        const raw = localStorage.getItem(MISSION_STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Mission) : null;
    } catch {
        return null;
    }
}

function saveMission(mission: Mission | null) {
    try {
        if (mission) localStorage.setItem(MISSION_STORAGE_KEY, JSON.stringify(mission));
        else localStorage.removeItem(MISSION_STORAGE_KEY);
    } catch {
        // Storage can be unavailable (private mode); the mission then lives for this visit only.
    }
}

function formatEur(value: number) {
    return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function describeMission(mission: Mission) {
    const steps = mission.steps.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.title}`).join('\n');
    const money = mission.target_eur > 0 ? `\nFortschritt: ${formatEur(mission.earned_eur)} von ${formatEur(mission.target_eur)}` : '';
    return `Ziel: ${mission.goal}\nMission: ${mission.title}${money}\nSchritte:\n${steps}`;
}

export default function Jarvis() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [speechSupported, setSpeechSupported] = useState(false);
    const [mission, setMission] = useState<Mission | null>(null);
    const [earnedInput, setEarnedInput] = useState('');
    const [now, setNow] = useState(() => new Date());
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSpeechSupported(!!getSpeechRecognition());
        setMission(loadMission());
        // Some browsers load voices asynchronously.
        window.speechSynthesis?.getVoices();
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    function updateMission(next: Mission | null) {
        setMission(next);
        saveMission(next);
    }

    function speak(text: string) {
        if (!voiceEnabled || !window.speechSynthesis || !text.trim()) {
            setStatus('idle');
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang ?? 'de-DE';
        utterance.rate = 1.02;
        utterance.pitch = 0.9;
        utterance.onstart = () => setStatus('speaking');
        utterance.onend = () => setStatus('idle');
        utterance.onerror = () => setStatus('idle');
        window.speechSynthesis.speak(utterance);
    }

    async function planMission(goal: string, history: Message[]) {
        setMessages([...history, { role: 'assistant', content: '' }]);
        setStatus('planning');
        let reply: string;
        try {
            const res = await fetch('/api/jarvis-mission', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ goal })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            updateMission({ ...data, earned_eur: 0, steps: data.steps.map((s: MissionStep) => ({ ...s, done: false })) });
            reply = `${data.briefing}\n\nRealitätscheck: ${data.reality_check}`;
        } catch (error) {
            reply = `Missionsplanung fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`;
        }
        setMessages([...history, { role: 'assistant', content: reply }]);
        speak(reply);
    }

    async function send(text: string, { asGoal = false } = {}) {
        const content = text.trim();
        if (!content || status === 'thinking' || status === 'planning') return;

        window.speechSynthesis?.cancel();
        const history: Message[] = [...messages, { role: 'user', content }];
        setInput('');

        const goalMatch = content.match(GOAL_PATTERN);
        if (asGoal || goalMatch) {
            await planMission(asGoal ? content : goalMatch![1], history);
            return;
        }

        setMessages([...history, { role: 'assistant', content: '' }]);
        setStatus('thinking');
        let reply = '';
        try {
            const res = await fetch('/api/jarvis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history, mission: mission ? describeMission(mission) : undefined })
            });
            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                reply += decoder.decode(value, { stream: true });
                setMessages([...history, { role: 'assistant', content: reply }]);
            }
        } catch (error) {
            reply = `Verbindung fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`;
            setMessages([...history, { role: 'assistant', content: reply }]);
        }
        speak(reply);
    }

    function toggleListening() {
        if (status === 'listening') {
            recognitionRef.current?.stop();
            return;
        }
        const Recognition = getSpeechRecognition();
        if (!Recognition) return;

        window.speechSynthesis?.cancel();
        const recognition = new Recognition();
        recognition.lang = 'de-DE';
        recognition.interimResults = true;
        recognition.continuous = false;

        let transcript = '';
        recognition.onresult = (event) => {
            transcript = Array.from(event.results)
                .map((result) => result[0].transcript)
                .join('');
            setInput(transcript);
        };
        recognition.onerror = () => setStatus('idle');
        recognition.onend = () => {
            recognitionRef.current = null;
            if (transcript.trim()) send(transcript);
            else setStatus('idle');
        };

        recognitionRef.current = recognition;
        setStatus('listening');
        recognition.start();
    }

    function toggleStep(index: number) {
        if (!mission) return;
        updateMission({ ...mission, steps: mission.steps.map((s, i) => (i === index ? { ...s, done: !s.done } : s)) });
    }

    function addEarnings() {
        const amount = Number(earnedInput.replace(',', '.'));
        if (!mission || !Number.isFinite(amount) || amount === 0) return;
        updateMission({ ...mission, earned_eur: Math.max(0, mission.earned_eur + amount) });
        setEarnedInput('');
    }

    const busy = status === 'thinking' || status === 'planning';
    const progress = mission
        ? mission.target_eur > 0
            ? Math.min(1, mission.earned_eur / mission.target_eur)
            : mission.steps.filter((s) => s.done).length / Math.max(1, mission.steps.length)
        : 0;

    return (
        <div className="relative flex flex-col min-h-screen gap-4 p-4 overflow-hidden font-mono text-cyan-100 sm:p-6 lg:h-screen">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(34_211_238/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(34_211_238/0.05)_1px,transparent_1px)] bg-[size:40px_40px]" />

            <header className="relative flex flex-wrap items-center justify-between gap-2 pb-3 text-xs tracking-[0.25em] uppercase border-b border-cyan-500/30">
                <a href="/" className="no-underline text-cyan-300">
                    ◂ J.A.R.V.I.S. // Mark VII
                </a>
                <span className={busy ? 'animate-pulse text-amber-300' : 'text-cyan-300'}>● {STATUS_LABEL[status]}</span>
                <span className="text-cyan-400">
                    {now.toLocaleDateString('de-DE')} · {now.toLocaleTimeString('de-DE')}
                </span>
            </header>

            <div className="relative grid gap-4 grow lg:grid-cols-[1fr_auto_1fr] lg:min-h-0">
                <Panel title="Kommunikation" className="order-2 lg:order-1">
                    <div ref={scrollRef} className="h-64 space-y-3 overflow-y-auto lg:h-full">
                        {messages.length === 0 && (
                            <p className="text-sm text-cyan-300/70">
                                Guten Tag, Sir. Nennen Sie mir Ihr Ziel — zum Beispiel „Mein Ziel ist, diesen Monat 500 Euro zu verdienen“ — und ich erstelle
                                einen Missionsplan. {speechSupported ? 'Tippen Sie auf den Reaktor, um zu sprechen.' : ''}
                            </p>
                        )}
                        {messages.map((message, i) => (
                            <div key={i} className="text-sm">
                                <div className={`text-[10px] tracking-[0.3em] uppercase ${message.role === 'user' ? 'text-amber-300' : 'text-cyan-400'}`}>
                                    {message.role === 'user' ? 'Sie' : 'Jarvis'}
                                </div>
                                <div className="whitespace-pre-wrap">{message.content || <span className="animate-pulse">▍</span>}</div>
                            </div>
                        ))}
                    </div>
                </Panel>

                <div className="flex flex-col items-center justify-center order-1 gap-4 py-4 lg:order-2 lg:px-6">
                    <ArcReactor status={status} progress={progress} onClick={speechSupported ? toggleListening : undefined} />
                    {mission && (
                        <p className="text-xs tracking-[0.3em] uppercase text-cyan-300">
                            Mission {Math.round(progress * 100)} % abgeschlossen
                        </p>
                    )}
                </div>

                <Panel title="Mission" className="order-3">
                    {mission ? (
                        <div className="flex flex-col h-full gap-4 overflow-y-auto">
                            <div>
                                <h2 className="text-lg font-bold tracking-wide text-white sm:text-xl">{mission.title}</h2>
                                <p className="text-xs text-cyan-300/70">Ziel: {mission.goal}</p>
                            </div>

                            {mission.target_eur > 0 && (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Verdient</span>
                                        <span className="text-white">
                                            {formatEur(mission.earned_eur)} / {formatEur(mission.target_eur)}
                                        </span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded bg-cyan-950">
                                        <div className="h-full transition-all duration-700 bg-cyan-300" style={{ width: `${progress * 100}%` }} />
                                    </div>
                                    <form
                                        className="flex gap-2"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            addEarnings();
                                        }}
                                    >
                                        <input
                                            value={earnedInput}
                                            onChange={(e) => setEarnedInput(e.target.value)}
                                            inputMode="decimal"
                                            placeholder="Betrag in €"
                                            className="w-full px-3 py-1.5 text-sm bg-transparent border rounded border-cyan-500/40 focus:outline-none focus:border-cyan-300"
                                        />
                                        <button type="submit" className="px-3 text-sm whitespace-nowrap border rounded border-cyan-400 text-cyan-200 hover:bg-cyan-400/10">
                                            + Erfassen
                                        </button>
                                    </form>
                                </div>
                            )}

                            <ol className="space-y-2">
                                {mission.steps.map((step, i) => (
                                    <li key={i}>
                                        <label className="flex gap-3 cursor-pointer">
                                            <input type="checkbox" checked={!!step.done} onChange={() => toggleStep(i)} className="mt-1 accent-cyan-400" />
                                            <span className={step.done ? 'line-through opacity-50' : ''}>
                                                <span className="text-sm text-white">
                                                    {i + 1}. {step.title}
                                                </span>
                                                {step.estimate_eur > 0 && <span className="ml-2 text-xs text-amber-300">≈ {formatEur(step.estimate_eur)}</span>}
                                                <span className="block text-xs text-cyan-200/70">{step.detail}</span>
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ol>

                            <p className="p-3 text-xs border rounded border-amber-400/30 text-amber-100/80">⚠ Realitätscheck: {mission.reality_check}</p>

                            <button
                                type="button"
                                onClick={() => updateMission(null)}
                                className="self-start text-xs tracking-widest uppercase text-cyan-400/70 hover:text-cyan-200"
                            >
                                Mission beenden
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm text-cyan-300/70">
                            Keine aktive Mission. Sagen Sie „Mein Ziel ist …“ oder schreiben Sie Ihr Ziel unten hinein und klicken Sie auf „Als Ziel setzen“.
                        </p>
                    )}
                </Panel>
            </div>

            <form
                className="relative flex flex-wrap gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                }}
            >
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Sprechen Sie mit Jarvis …"
                    className="flex-1 min-w-0 px-4 py-3 text-white border rounded basis-full sm:basis-auto bg-gray-950/70 border-cyan-500/40 focus:outline-none focus:border-cyan-300"
                />
                {speechSupported && (
                    <button type="button" onClick={toggleListening} className="btn" aria-label={status === 'listening' ? 'Zuhören beenden' : 'Sprechen'}>
                        {status === 'listening' ? '■' : '🎙'}
                    </button>
                )}
                <button type="button" className="btn" disabled={!input.trim() || busy} onClick={() => send(input, { asGoal: true })}>
                    Als Ziel setzen
                </button>
                <button type="submit" className="btn" disabled={!input.trim() || busy}>
                    Senden
                </button>
                <label className="flex items-center gap-2 px-2 text-xs cursor-pointer text-cyan-300">
                    <input
                        type="checkbox"
                        checked={voiceEnabled}
                        onChange={(e) => {
                            setVoiceEnabled(e.target.checked);
                            if (!e.target.checked) window.speechSynthesis?.cancel();
                        }}
                        className="accent-cyan-400"
                    />
                    Stimme
                </label>
            </form>
        </div>
    );
}

function Panel({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
    return (
        <section className={`relative flex flex-col p-4 border bg-gray-950/60 border-cyan-500/30 backdrop-blur-sm lg:min-h-0 ${className}`}>
            <span className="absolute w-3 h-3 border-t-2 border-l-2 -top-px -left-px border-cyan-300" />
            <span className="absolute w-3 h-3 border-b-2 border-r-2 -bottom-px -right-px border-cyan-300" />
            <h2 className="mb-3 text-[10px] font-normal tracking-[0.4em] uppercase text-cyan-400">{title}</h2>
            <div className="min-h-0 grow">{children}</div>
        </section>
    );
}

function ArcReactor({ status, progress, onClick }: { status: Status; progress: number; onClick?: () => void }) {
    const active = status !== 'idle';
    const busy = status === 'thinking' || status === 'planning';
    const speed = busy ? '1.2s' : status === 'listening' ? '2.5s' : '10s';
    const circumference = 2 * Math.PI * 98;
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            aria-label="Mit Jarvis sprechen"
            className="relative grid rounded-full cursor-pointer w-60 h-60 place-items-center disabled:cursor-default sm:w-80 sm:h-80 lg:w-[22rem] lg:h-[22rem]"
        >
            <span
                className={`absolute inset-4 rounded-full bg-cyan-400/25 blur-3xl transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-50'} ${
                    status === 'speaking' || status === 'listening' ? 'animate-pulse' : ''
                }`}
            />
            {/* Mission progress ring */}
            <svg viewBox="0 0 220 220" className="absolute inset-0 w-full h-full -rotate-90">
                <circle cx="110" cy="110" r="98" fill="none" stroke="rgb(34 211 238 / 0.12)" strokeWidth="3" />
                <circle
                    cx="110"
                    cy="110"
                    r="98"
                    fill="none"
                    stroke="rgb(252 211 77)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                    className="transition-[stroke-dashoffset] duration-700"
                />
            </svg>
            <svg viewBox="0 0 220 220" className="absolute inset-0 w-full h-full" style={{ animation: `spin ${speed} linear infinite` }}>
                <circle cx="110" cy="110" r="86" fill="none" stroke="rgb(34 211 238)" strokeWidth="6" strokeDasharray="34 10" />
            </svg>
            <svg viewBox="0 0 220 220" className="absolute inset-0 w-full h-full" style={{ animation: `spin ${speed} linear infinite reverse` }}>
                <circle cx="110" cy="110" r="70" fill="none" stroke="rgb(103 232 249 / 0.8)" strokeWidth="3" strokeDasharray="4 8" />
                <circle cx="110" cy="110" r="58" fill="none" stroke="rgb(34 211 238 / 0.4)" strokeWidth="1" />
            </svg>
            <span
                className={`relative w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-cyan-100 shadow-[0_0_60px_18px_rgb(34_211_238/0.7)] transition-transform duration-300 ${
                    active ? 'scale-110' : 'scale-100'
                }`}
            />
        </button>
    );
}
