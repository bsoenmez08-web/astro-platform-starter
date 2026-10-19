import type { APIRoute } from 'astro';
import type Anthropic from '@anthropic-ai/sdk';
import { jarvisStore, readTwilioWebhook, sayAndListen, twimlResponse } from '../../../utils/jarvis-server';

export const prerender = false;

const FALLBACK_GREETING = 'Guten Morgen, Sir. Hier ist Jarvis mit Ihrem täglichen Briefing. Wie kann ich Ihnen heute helfen?';

// Twilio requests this URL as soon as the daily call is answered.
export const POST: APIRoute = async ({ request }) => {
    const params = await readTwilioWebhook(request);
    if (!params) return new Response('Forbidden', { status: 403 });

    const store = jarvisStore();
    const briefing = ((await store.get('call/briefing', { type: 'text' })) ?? '').trim() || FALLBACK_GREETING;

    // The API expects the conversation to start with a user turn, so record why Jarvis is calling.
    const history: Anthropic.MessageParam[] = [
        { role: 'user', content: '(Jarvis ruft den Nutzer zum täglichen Briefing an. Der Nutzer hat abgenommen.)' },
        { role: 'assistant', content: briefing }
    ];
    await store.setJSON(`calls/${params.CallSid}`, history);

    return twimlResponse(sayAndListen(briefing));
};
