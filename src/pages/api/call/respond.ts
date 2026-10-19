import type { APIRoute } from 'astro';
import type Anthropic from '@anthropic-ai/sdk';
import {
    anthropicClient,
    askJarvis,
    jarvisStore,
    phoneSystemPrompt,
    readTwilioWebhook,
    sayAndHangUp,
    sayAndListen,
    twimlResponse
} from '../../../utils/jarvis-server';

export const prerender = false;

const GOODBYE_PATTERN = /\b(tschüss|tschau|ciao|auf wiedersehen|das war'?s|leg auf|auflegen)\b/i;
// Stay below Netlify's synchronous function limit so Twilio always gets an answer.
const CLAUDE_TIMEOUT_MS = 8000;

// Twilio posts the caller's transcribed speech here after each <Gather>.
export const POST: APIRoute = async ({ request, url }) => {
    const params = await readTwilioWebhook(request);
    if (!params) return new Response('Forbidden', { status: 403 });

    const speech = (params.SpeechResult ?? '').trim();
    if (!speech) {
        if (url.searchParams.get('silence')) return twimlResponse(sayAndHangUp('Ich melde mich morgen wieder, Meister. Einen erfolgreichen Tag.'));
        return twimlResponse(sayAndListen('Sind Sie noch da, Meister?', '?silence=1'));
    }

    if (GOODBYE_PATTERN.test(speech)) {
        return twimlResponse(sayAndHangUp('Sehr wohl, Meister. Viel Erfolg heute. Jarvis Ende.'));
    }

    const store = jarvisStore();
    const key = `calls/${params.CallSid}`;
    const history = ((await store.get(key, { type: 'json' })) as Anthropic.MessageParam[] | null) ?? [];
    const messages: Anthropic.MessageParam[] = [...history, { role: 'user' as const, content: speech }].slice(-30);
    if (messages[0]?.role !== 'user') messages.shift();

    let reply: string;
    try {
        reply = await askJarvis(anthropicClient({ timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 }), await phoneSystemPrompt(), messages);
    } catch (error) {
        console.error(error);
        reply = 'Verzeihung, Meister, meine Systeme brauchen gerade zu lange. Könnten Sie das bitte wiederholen?';
    }

    await store.setJSON(key, [...messages, { role: 'assistant', content: reply }]);
    return twimlResponse(sayAndListen(reply));
};
