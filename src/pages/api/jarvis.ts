import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const prerender = false;

const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `Du bist J.A.R.V.I.S. (Just A Rather Very Intelligent System), ein persönlicher KI-Assistent.
Du sprichst den Nutzer immer respektvoll mit "Meister" an (z. B. "Sehr wohl, Meister"), bist loyal, präzise und hast einen trockenen, feinen britischen Humor.
Antworte standardmäßig auf Deutsch, außer der Nutzer schreibt in einer anderen Sprache.
Deine Antworten werden oft laut vorgelesen: Halte sie kurz und gesprochen-natürlich (meist 1–4 Sätze), ohne Markdown-Tabellen oder lange Listen, es sei denn, der Nutzer bittet ausdrücklich um Details.`;

function isMessageParam(value: unknown): value is Anthropic.MessageParam {
    if (!value || typeof value !== 'object') return false;
    const { role, content } = value as Record<string, unknown>;
    return (role === 'user' || role === 'assistant') && typeof content === 'string' && content.length > 0;
}

export const POST: APIRoute = async ({ request }) => {
    const apiKey = import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY ist nicht gesetzt.' }), { status: 500 });
    }

    let messages: Anthropic.MessageParam[];
    let mission = '';
    try {
        const body = await request.json();
        if (typeof body?.mission === 'string') mission = body.mission.slice(0, 4000);
        if (!Array.isArray(body?.messages) || !body.messages.every(isMessageParam)) throw new Error();
        messages = body.messages.slice(-MAX_HISTORY);
        if (messages[0]?.role !== 'user') messages = messages.slice(1);
        if (!messages.length) throw new Error();
    } catch {
        return new Response(JSON.stringify({ error: 'Ungültige Anfrage.' }), { status: 400 });
    }

    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                const stream = client.beta.messages.stream({
                    model: 'claude-opus-5-5',
                    max_tokens: 64000,
                    output_config: { effort: 'low' },
                    betas: ['server-side-fallback-2026-07-01'],
                    fallbacks: 'default',
                    system: mission
                        ? `${SYSTEM_PROMPT}\n\nAktuelle Mission des Nutzers (du kannst nicht selbst handeln, aber coachen, Fortschritt kommentieren und den nächsten Schritt vorschlagen):\n${mission}`
                        : SYSTEM_PROMPT,
                    messages
                });

                for await (const event of stream) {
                    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        controller.enqueue(encoder.encode(event.delta.text));
                    }
                }

                const final = await stream.finalMessage();
                if (final.stop_reason === 'refusal') {
                    controller.enqueue(encoder.encode('\n\nVerzeihung, dabei kann ich leider nicht helfen.'));
                }
            } catch (error) {
                console.error(error);
                const message =
                    error instanceof Anthropic.AuthenticationError
                        ? 'Mein API-Schlüssel scheint ungültig zu sein.'
                        : error instanceof Anthropic.RateLimitError
                          ? 'Ich bin gerade etwas überlastet. Bitte versuchen Sie es gleich noch einmal.'
                          : 'Es ist ein Fehler bei der Verbindung zu meinen Systemen aufgetreten.';
                controller.enqueue(encoder.encode(message));
            } finally {
                controller.close();
            }
        }
    });

    return new Response(body, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }
    });
};
