# Ship & Deliver

A short, complete arcade round: pilot a cargo ship, collect floating containers,
and deliver them to port before the clock runs out, while dodging icebergs,
rocks, a storm zone, and a pirate ship. One mechanic, one round, a persistent
high-score table.

## Run it

```
npm install
npm start
```

Serves on `PORT` (default `3000`) in the foreground: `http://localhost:3000/`.
No build step, no external assets — everything is rendered procedurally on
`<canvas>` and synthesized with the Web Audio API.

## How the score is earned

- Each of the 6 cargo containers delivered to port is worth **100 points ×
  the current combo multiplier**.
- Deliver within 8 seconds of your last delivery and the multiplier climbs
  (capped at ×5); miss that window and it resets to ×1. This rewards tight,
  continuous runs over slow, cautious ones.
- Colliding with an iceberg, rock, or the pirate ship costs a hull point,
  drops any cargo you're carrying, and resets your combo. Three hits sinks
  the round early ("Ship Lost"). Storm zones push you around instead of
  dealing damage.
- Deliver all 6 containers before time runs out and you earn a **time
  bonus** (remaining whole seconds × 5), added once to the same running
  score shown on the HUD — the number on the end screen and the number
  submitted to the leaderboard are the same value, never recomputed
  separately.
- The round ends three ways: all cargo delivered (win, with time bonus),
  the 90-second clock hits zero, or the hull is destroyed.

## Controls

- **Desktop:** WASD or arrow keys to steer, Space to boost (limited boost
  fuel that regenerates when not boosting).
- **Mobile:** on-screen virtual joystick + a BOOST button (shown
  automatically on touch devices).

## Persistence & hosting contract

- High scores are stored server-side in `data/scores.json` (created on first
  write) and survive a process restart — verified by posting a score,
  killing the server, restarting it, and re-reading `GET /api/scores`.
- `GET /api/scores` returns the top 10 entries, highest first.
- `POST /api/scores` accepts `{ "name": string (1-20 chars), "score": integer
  0-999999 }`, rejects anything else with `400` and a clear message, and
  returns `201` with the saved entry, its rank, and the refreshed top 10.
- The page talks to the API with **relative URLs** (`api/scores`), so it
  works unmodified from the project root, behind a reverse-proxy path
  prefix, or embedded in a sandboxed `<iframe>` with an opaque origin.
- No cookies, `localStorage`, `sessionStorage`, or service workers are used
  — all durable state lives on the server. The API sends open CORS headers
  (`Access-Control-Allow-Origin: *`) and answers the `OPTIONS` preflight a
  cross-origin JSON `POST` triggers.
- The score-save form is a real `<form>` handled with `submit` +
  `preventDefault()` + `fetch`; the submit button disables after a
  successful save so repeated clicks/Enter can't create duplicate entries,
  and a failed save re-enables the form for a deliberate retry.

## Reserved for later (Lab 3)

This build is intentionally one round, one mechanic, one difficulty curve.
Multiple levels/zones, a star-rating system, ship upgrades, and persisted
player progression (beyond the high-score table) are deliberately left out
of this baseline and are natural Lab 3 extensions on top of this same
server and contract.
