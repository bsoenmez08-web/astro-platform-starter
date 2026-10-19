# Astro on Netlify Platform Starter

[Live Demo](https://astro-platform-starter.netlify.app/)

A modern starter based on Astro.js, Tailwind, and [Netlify Core Primitives](https://docs.netlify.com/core/overview/#develop) (Edge Functions, Image CDN, Blobs).

## Astro Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Deploying to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/netlify-templates/astro-platform-starter)

## Developing Locally

| Prerequisites                                                                |
| :--------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/) v18.20.8+.                                    |
| (optional) [nvm](https://github.com/nvm-sh/nvm) for Node version management. |

1. Clone this repository, then run `npm install` in its root directory.

2. Recommended: link your local repository to a Netlify project. This will ensure you're using the same runtime version for both local development and your deployed project.

```
netlify link
```

3. Run the Astro.js development server:

```
npm run dev
```

## J.A.R.V.I.S.

Unter `/jarvis` gibt es einen KI-Sprachassistenten im Stil von Iron Mans J.A.R.V.I.S. (Chat, Spracheingabe und Sprachausgabe über die Web Speech API, Antworten von Claude).

Setze dafür die Umgebungsvariable `ANTHROPIC_API_KEY` (lokal in `.env`, auf Netlify unter _Site configuration → Environment variables_). **Missionsmodus:** Sagen oder schreiben Sie „Mein Ziel ist …“ (z. B. „Mein Ziel ist, diesen Monat 500 Euro zu verdienen“). Jarvis erstellt daraus einen Schritt-für-Schritt-Plan, Sie haken Schritte ab und erfassen verdiente Beträge; der Fortschritt bleibt im Browser gespeichert. Jarvis plant und coacht – die Schritte führen Sie selbst aus.

**Schnipsen:** Schalten Sie unten „Schnipsen“ ein (Mikrofon erlauben) und schnipsen Sie mit den Fingern – Jarvis piept kurz und hört zu.

Jarvis spricht Sie mit „Meister“ an.

Spracheingabe funktioniert am besten in Chrome, Edge oder Safari.

### Jarvis ruft Sie an (Twilio)

Jarvis kann Sie jeden Tag zu einer festen Uhrzeit auf dem Handy anrufen, Ihnen den Stand Ihrer Mission und den nächsten Schritt nennen und mit Ihnen sprechen. Sagen Sie „Tschüss“, um aufzulegen.

1. Twilio-Konto anlegen (twilio.com) und eine Telefonnummer mit Sprachfunktion kaufen. Im Testkonto (Trial) zuerst die eigene Handynummer unter _Verified Caller IDs_ bestätigen.
2. In Netlify unter _Site configuration → Environment variables_ setzen:
   - `TWILIO_ACCOUNT_SID` und `TWILIO_AUTH_TOKEN` (aus der Twilio Console)
   - `TWILIO_PHONE_NUMBER` – Ihre Twilio-Nummer, z. B. `+4930123456789`
   - `JARVIS_PHONE_NUMBER` – Ihre Handynummer im internationalen Format, z. B. `+41764569870` für 076 456 98 70 (Schweiz) oder `+4917612345678` (Deutschland)
   - `JARVIS_CALL_HOUR` – Stunde des Anrufs in deutscher Zeit (Standard: `8`)
3. Neu deployen. Die geplante Funktion `jarvis-daily-call` läuft stündlich und ruft einmal pro Tag zur eingestellten Stunde an. Zum Testen lässt sie sich in Netlify unter _Functions_ auch sofort ausführen („Run now“), sofern die aktuelle Stunde mit `JARVIS_CALL_HOUR` übereinstimmt.

Die Mission wird dafür zusätzlich in Netlify Blobs gespeichert, damit Jarvis sie beim Anruf kennt.
