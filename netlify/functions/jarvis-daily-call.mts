import type { Config } from '@netlify/functions';
import twilio from 'twilio';
import { anthropicClient, askJarvis, env, jarvisStore, phoneSystemPrompt, siteUrl } from '../../src/utils/jarvis-server';

const TIME_ZONE = 'Europe/Berlin';

function berlinNow() {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
            .formatToParts(new Date())
            .map((p) => [p.type, p.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Runs every hour; places the call once per day at JARVIS_CALL_HOUR (German time, so daylight saving is handled).
export default async () => {
    const callHour = Number(env('JARVIS_CALL_HOUR') ?? '8');
    const { date, hour } = berlinNow();
    if (hour !== callHour) return;

    const accountSid = env('TWILIO_ACCOUNT_SID');
    const authToken = env('TWILIO_AUTH_TOKEN');
    const from = env('TWILIO_PHONE_NUMBER');
    const to = env('JARVIS_PHONE_NUMBER');
    if (!accountSid || !authToken || !from || !to) {
        console.error('Jarvis-Anruf übersprungen: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER und JARVIS_PHONE_NUMBER müssen gesetzt sein.');
        return;
    }

    const store = jarvisStore();
    if ((await store.get('call/last-date', { type: 'text' })) === date) return;
    await store.set('call/last-date', date);

    // Prepared ahead of time so the greeting plays instantly when the call is answered.
    let briefing = '';
    try {
        briefing = await askJarvis(anthropicClient(), await phoneSystemPrompt(), [
            {
                role: 'user',
                content:
                    '(Du rufst den Nutzer jetzt zum täglichen Morgen-Briefing an. Begrüße ihn, fasse in höchstens drei Sätzen den Stand seiner Mission zusammen und nenne den wichtigsten nächsten Schritt für heute. Ende mit einer kurzen Frage.)'
            }
        ]);
    } catch (error) {
        console.error('Briefing konnte nicht erstellt werden', error);
    }
    await store.set('call/briefing', briefing);

    const call = await twilio(accountSid, authToken).calls.create({ to, from, url: `${siteUrl()}/api/call/voice`, method: 'POST' });
    console.log(`Jarvis ruft an: ${call.sid}`);
};

export const config: Config = {
    schedule: '0 * * * *'
};
