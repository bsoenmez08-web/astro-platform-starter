import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const prerender = false;

const SYSTEM_PROMPT = `Du bist J.A.R.V.I.S., ein persönlicher KI-Assistent. Der Nutzer nennt dir ein Ziel, und du erstellst daraus einen konkreten, umsetzbaren Missionsplan.
Wichtig: Du selbst kannst nicht in der Welt handeln, kein Geld verdienen und keine Konten bedienen. Der Nutzer führt die Schritte aus; du planst, motivierst und behältst den Überblick.
Regeln für den Plan:
- 4 bis 7 Schritte, jeder sofort startbar und konkret (was genau, wo, wie), keine Floskeln.
- Nur legale, seriöse Wege. Keine Glücksspiele, keine Krypto-Spekulation, kein "schnell reich", keine Schneeballsysteme.
- Bei Geldzielen: Setze target_eur auf den Zielbetrag und schätze pro Schritt realistisch, wie viel Euro er einbringen kann (estimate_eur, 0 wenn der Schritt nur vorbereitet). Sonst target_eur = 0 und alle estimate_eur = 0.
- reality_check: ein bis zwei ehrliche Sätze dazu, wie realistisch das Ziel im genannten Zeitraum ist und worauf es ankommt (z. B. Steuern, Zeitaufwand).
- briefing: ein kurzer, gesprochener Satz im Jarvis-Stil, mit dem du die Mission bestätigst. Sprich den Nutzer darin mit "Meister" an.
Antworte auf Deutsch.`;

const MISSION_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string', description: 'Kurzer Missionsname, max. 6 Wörter' },
        briefing: { type: 'string' },
        target_eur: { type: 'number' },
        reality_check: { type: 'string' },
        steps: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    detail: { type: 'string' },
                    estimate_eur: { type: 'number' }
                },
                required: ['title', 'detail', 'estimate_eur'],
                additionalProperties: false
            }
        }
    },
    required: ['title', 'briefing', 'target_eur', 'reality_check', 'steps'],
    additionalProperties: false
};

export const POST: APIRoute = async ({ request }) => {
    const apiKey = import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return Response.json({ error: 'ANTHROPIC_API_KEY ist nicht gesetzt.' }, { status: 500 });
    }

    const body = await request.json().catch(() => null);
    const goal = typeof body?.goal === 'string' ? body.goal.trim().slice(0, 1000) : '';
    if (!goal) {
        return Response.json({ error: 'Bitte nennen Sie ein Ziel.' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });
    try {
        const response = await client.beta.messages.create({
            model: 'claude-opus-5-5',
            max_tokens: 16000,
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: MISSION_SCHEMA } },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: `Mein Ziel: ${goal}` }]
        });

        if (response.stop_reason === 'refusal') {
            return Response.json({ error: 'Für dieses Ziel kann ich leider keinen Plan erstellen.' }, { status: 422 });
        }
        const text = response.content.find((block) => block.type === 'text');
        if (!text || text.type !== 'text') throw new Error('Keine Antwort erhalten');
        return Response.json({ goal, ...JSON.parse(text.text) });
    } catch (error) {
        console.error(error);
        const message =
            error instanceof Anthropic.AuthenticationError
                ? 'Mein API-Schlüssel scheint ungültig zu sein.'
                : error instanceof Anthropic.RateLimitError
                  ? 'Ich bin gerade überlastet. Bitte gleich noch einmal versuchen.'
                  : 'Die Missionsplanung ist fehlgeschlagen.';
        return Response.json({ error: message }, { status: 502 });
    }
};
