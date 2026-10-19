import type { APIRoute } from 'astro';
import { isMission } from '../../utils/jarvis-mission';
import { jarvisStore, loadServerMission } from '../../utils/jarvis-server';

export const prerender = false;

// The browser mirrors its mission here so the daily phone call knows the current goal and progress.
export const GET: APIRoute = async () => {
    return Response.json({ mission: await loadServerMission() });
};

export const PUT: APIRoute = async ({ request }) => {
    const body = await request.json().catch(() => null);
    if (body?.mission === null) {
        await jarvisStore().delete('mission');
        return Response.json({ ok: true });
    }
    if (!isMission(body?.mission) || JSON.stringify(body.mission).length > 20_000) {
        return Response.json({ error: 'Ungültige Mission.' }, { status: 400 });
    }
    await jarvisStore().setJSON('mission', body.mission);
    return Response.json({ ok: true });
};
