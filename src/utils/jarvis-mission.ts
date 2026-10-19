// Shared by the browser UI and the server (chat, phone calls), so keep this free of server-only imports.

export type MissionStep = { title: string; detail: string; estimate_eur: number; done?: boolean };

export type Mission = {
    goal: string;
    title: string;
    briefing: string;
    target_eur: number;
    reality_check: string;
    steps: MissionStep[];
    earned_eur: number;
};

export function formatEur(value: number) {
    return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

export function describeMission(mission: Mission) {
    const steps = mission.steps.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.title}`).join('\n');
    const money = mission.target_eur > 0 ? `\nFortschritt: ${formatEur(mission.earned_eur)} von ${formatEur(mission.target_eur)}` : '';
    return `Ziel: ${mission.goal}\nMission: ${mission.title}${money}\nSchritte:\n${steps}`;
}

export function isMission(value: unknown): value is Mission {
    if (!value || typeof value !== 'object') return false;
    const m = value as Record<string, unknown>;
    return (
        typeof m.goal === 'string' &&
        typeof m.title === 'string' &&
        typeof m.target_eur === 'number' &&
        typeof m.earned_eur === 'number' &&
        Array.isArray(m.steps) &&
        m.steps.every((s) => s && typeof s.title === 'string' && typeof s.detail === 'string' && typeof s.estimate_eur === 'number')
    );
}
