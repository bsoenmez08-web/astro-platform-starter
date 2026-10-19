import Anthropic from '@anthropic-ai/sdk';
import { getStore } from '@netlify/blobs';
import twilio from 'twilio';
import { describeMission, isMission, type Mission } from './jarvis-mission';

export const CALL_VOICE = 'Polly.Daniel-Neural';
export const CALL_LANGUAGE = 'de-DE';

const PHONE_PROMPT = `Du bist J.A.R.V.I.S. (Just A Rather Very Intelligent System), der persönliche KI-Assistent des Nutzers, und telefonierst gerade mit ihm.
Du sprichst ihn höflich mit "Sir" an, bist loyal, präzise und hast einen trockenen, feinen britischen Humor. Sprich Deutsch.
Alles, was du schreibst, wird am Telefon vorgelesen: Antworte in ein bis drei kurzen, natürlichen Sätzen, ohne Aufzählungen, Emojis, Abkürzungen oder Sonderzeichen.
Du kannst nicht selbst in der Welt handeln oder Geld verdienen. Du coachst, motivierst, kommentierst den Fortschritt und schlägst den nächsten konkreten Schritt vor.`;

export function env(name: string): string | undefined {
    return process.env[name] ?? (import.meta.env?.[name] as string | undefined);
}

// Netlify sets URL to the site's primary address; Twilio callbacks and signature checks both use it.
export function siteUrl() {
    return (env('URL') ?? 'http://localhost:4321').replace(/\/$/, '');
}

export function jarvisStore() {
    return getStore({ name: 'jarvis', consistency: 'strong' });
}

export async function loadServerMission(): Promise<Mission | null> {
    const mission = await jarvisStore().get('mission', { type: 'json' });
    return isMission(mission) ? mission : null;
}

export async function phoneSystemPrompt() {
    const mission = await loadServerMission();
    return mission ? `${PHONE_PROMPT}\n\nAktuelle Mission des Nutzers:\n${describeMission(mission)}` : PHONE_PROMPT;
}

export function anthropicClient(options: { timeout?: number; maxRetries?: number } = {}) {
    const apiKey = env('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.');
    return new Anthropic({ apiKey, ...options });
}

export async function askJarvis(client: Anthropic, system: string, messages: Anthropic.MessageParam[]) {
    const response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages
    });
    if (response.stop_reason === 'refusal') return 'Verzeihung, Sir, dabei kann ich leider nicht helfen.';
    return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
        .trim();
}

/** Parses a Twilio webhook and rejects it unless it carries a valid X-Twilio-Signature. */
export async function readTwilioWebhook(request: Request): Promise<Record<string, string> | null> {
    const authToken = env('TWILIO_AUTH_TOKEN');
    const signature = request.headers.get('x-twilio-signature');
    if (!authToken || !signature) return null;

    const form = await request.formData();
    const params: Record<string, string> = {};
    form.forEach((value, key) => {
        params[key] = String(value);
    });
    const { pathname, search } = new URL(request.url);
    return twilio.validateRequest(authToken, signature, `${siteUrl()}${pathname}${search}`, params) ? params : null;
}

export function twimlResponse(twiml: twilio.twiml.VoiceResponse) {
    return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

/** Says `text`, then listens for the caller's answer and posts it to /api/call/respond. */
export function sayAndListen(text: string, query = '') {
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: ['speech'],
        language: CALL_LANGUAGE,
        speechTimeout: 'auto',
        actionOnEmptyResult: true,
        action: `${siteUrl()}/api/call/respond${query}`,
        method: 'POST'
    });
    gather.say({ voice: CALL_VOICE, language: CALL_LANGUAGE }, text);
    return twiml;
}

export function sayAndHangUp(text: string) {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: CALL_VOICE, language: CALL_LANGUAGE }, text);
    twiml.hangup();
    return twiml;
}
