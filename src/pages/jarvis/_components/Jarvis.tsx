import { useEffect, useRef, useState } from 'react';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

const STATUS_LABEL: Record<Status, string> = {
    idle: 'Bereit',
    listening: 'Höre zu …',
    thinking: 'Verarbeite …',
    speaking: 'Spreche …'
};

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

export default function Jarvis() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [speechSupported, setSpeechSupported] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSpeechSupported(!!getSpeechRecognition());
        // Some browsers load voices asynchronously.
        window.speechSynthesis?.getVoices();
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

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

    async function send(text: string) {
        const content = text.trim();
        if (!content || status === 'thinking') return;

        window.speechSynthesis?.cancel();
        const history: Message[] = [...messages, { role: 'user', content }];
        setMessages([...history, { role: 'assistant', content: '' }]);
        setInput('');
        setStatus('thinking');

        let reply = '';
        try {
            const res = await fetch('/api/jarvis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history })
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

    return (
        <div className="flex flex-col items-center gap-8">
            <ArcReactor status={status} onClick={speechSupported ? toggleListening : undefined} />
            <p className="text-sm tracking-[0.3em] uppercase text-cyan-300">{STATUS_LABEL[status]}</p>

            <div
                ref={scrollRef}
                className="w-full max-w-3xl p-4 space-y-4 overflow-y-auto border rounded-lg h-96 bg-gray-950/60 border-cyan-500/30 sm:p-6"
            >
                {messages.length === 0 && (
                    <p className="text-center text-gray-400">
                        Guten Tag. Ich bin J.A.R.V.I.S. — {speechSupported ? 'tippen Sie auf den Reaktor, um zu sprechen, oder ' : ''}
                        schreiben Sie mir eine Nachricht.
                    </p>
                )}
                {messages.map((message, i) => (
                    <div key={i} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                        <div
                            className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2 ${
                                message.role === 'user' ? 'bg-primary text-primary-content' : 'bg-cyan-950/80 text-cyan-50 border border-cyan-500/30'
                            }`}
                        >
                            {message.content || <span className="animate-pulse">▍</span>}
                        </div>
                    </div>
                ))}
            </div>

            <form
                className="flex w-full max-w-3xl gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                }}
            >
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Fragen Sie Jarvis …"
                    className="flex-1 px-4 py-3 text-white border rounded bg-gray-950/60 border-cyan-500/40 focus:outline-none focus:border-cyan-300"
                />
                {speechSupported && (
                    <button
                        type="button"
                        onClick={toggleListening}
                        className="btn"
                        aria-label={status === 'listening' ? 'Zuhören beenden' : 'Sprechen'}
                    >
                        {status === 'listening' ? '■' : '🎙'}
                    </button>
                )}
                <button type="submit" className="btn" disabled={!input.trim() || status === 'thinking'}>
                    Senden
                </button>
            </form>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                    type="checkbox"
                    checked={voiceEnabled}
                    onChange={(e) => {
                        setVoiceEnabled(e.target.checked);
                        if (!e.target.checked) window.speechSynthesis?.cancel();
                    }}
                />
                Antworten vorlesen
            </label>
        </div>
    );
}

function ArcReactor({ status, onClick }: { status: Status; onClick?: () => void }) {
    const active = status !== 'idle';
    const speed = status === 'thinking' ? '1.2s' : status === 'listening' ? '2.5s' : '8s';
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            aria-label="Jarvis aktivieren"
            className="relative grid w-48 h-48 rounded-full cursor-pointer place-items-center disabled:cursor-default sm:w-56 sm:h-56"
        >
            <span
                className={`absolute inset-0 rounded-full bg-cyan-400/20 blur-2xl transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-40'} ${
                    status === 'speaking' || status === 'listening' ? 'animate-pulse' : ''
                }`}
            />
            <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" style={{ animation: `spin ${speed} linear infinite` }}>
                <circle cx="100" cy="100" r="92" fill="none" stroke="rgb(34 211 238 / 0.35)" strokeWidth="2" />
                <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(34 211 238)" strokeWidth="6" strokeDasharray="30 12" />
            </svg>
            <svg
                viewBox="0 0 200 200"
                className="absolute inset-0 w-full h-full"
                style={{ animation: `spin ${speed} linear infinite reverse` }}
            >
                <circle cx="100" cy="100" r="62" fill="none" stroke="rgb(103 232 249 / 0.8)" strokeWidth="3" strokeDasharray="4 8" />
            </svg>
            <span
                className={`relative w-20 h-20 rounded-full bg-cyan-200 shadow-[0_0_40px_10px_rgb(34_211_238/0.7)] transition-transform duration-300 ${
                    active ? 'scale-110' : 'scale-100'
                }`}
            />
        </button>
    );
}
