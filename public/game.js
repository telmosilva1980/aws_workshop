(() => {
  'use strict';

  // ---------- Canvas & sizing ----------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Utility ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2;

  // ---------- Round configuration (one short, complete round) ----------
  const ROUND = {
    duration: 90, // seconds
    cargoTotal: 6,
    comboWindow: 8, // seconds between deliveries to keep/raise the multiplier
    maxCombo: 5,
    deliveryBase: 100,
    timeBonusPerSecond: 5,
    maxHull: 3,
  };

  // ---------- Particle pool (object pooling, no per-frame allocation) ----------
  const PARTICLE_POOL_SIZE = 240;
  const particles = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({ active: false }));
  function spawnParticle(x, y, vx, vy, life, size, color) {
    for (const p of particles) {
      if (!p.active) {
        p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.life = life; p.maxLife = life; p.size = size; p.color = color;
        return;
      }
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98; p.vy *= 0.98;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Input ----------
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  const touch = { active: false, dx: 0, dy: 0, boost: false };
  const joystickZone = document.getElementById('joystick-zone');
  const joystickNub = document.getElementById('joystick-nub');
  let joyTouchId = null;
  const JOY_RADIUS = 50;

  function joyStart(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    joyTouchId = t.identifier ?? 'mouse';
    touch.active = true;
    joyMove(e);
  }
  function joyMove(e) {
    if (!touch.active) return;
    const t = e.changedTouches ? [...e.changedTouches].find((x) => x.identifier === joyTouchId) : e;
    if (!t) return;
    const rect = joystickZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) { dx = (dx / d) * JOY_RADIUS; dy = (dy / d) * JOY_RADIUS; }
    joystickNub.style.left = `${35 + dx}px`;
    joystickNub.style.top = `${35 + dy}px`;
    touch.dx = dx / JOY_RADIUS;
    touch.dy = dy / JOY_RADIUS;
  }
  function joyEnd() {
    touch.active = false;
    touch.dx = 0; touch.dy = 0;
    joystickNub.style.left = '35px';
    joystickNub.style.top = '35px';
  }
  joystickZone.addEventListener('touchstart', joyStart, { passive: true });
  joystickZone.addEventListener('touchmove', joyMove, { passive: true });
  joystickZone.addEventListener('touchend', joyEnd);
  joystickZone.addEventListener('touchcancel', joyEnd);

  const boostBtn = document.getElementById('btn-boost');
  const setBoost = (v) => (e) => { touch.boost = v; if (e) e.preventDefault(); };
  boostBtn.addEventListener('touchstart', setBoost(true), { passive: false });
  boostBtn.addEventListener('touchend', setBoost(false));
  boostBtn.addEventListener('mousedown', setBoost(true));
  boostBtn.addEventListener('mouseup', setBoost(false));

  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  // ---------- Game state ----------
  let state = 'title'; // title | playing | ended
  let world;
  let shake = { t: 0, mag: 0 };

  function makeShip() {
    return {
      x: W * 0.15, y: H * 0.85, angle: -Math.PI / 4,
      vx: 0, vy: 0,
      speed: 220, boostSpeed: 380,
      boostFuel: 1, boostFuelMax: 1,
      hull: ROUND.maxHull,
      carrying: false,
      invuln: 0,
      wakeTimer: 0,
    };
  }

  function spawnCargo(n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({
        x: rand(W * 0.25, W * 0.92),
        y: rand(H * 0.1, H * 0.9),
        taken: false,
        bob: rand(0, TAU),
      });
    }
    return list;
  }

  function spawnObstacles() {
    const list = [];
    const kinds = ['iceberg', 'rock', 'storm'];
    for (let i = 0; i < 7; i++) {
      const kind = kinds[i % kinds.length];
      list.push({
        kind,
        x: rand(W * 0.2, W * 0.95),
        y: rand(H * 0.08, H * 0.92),
        r: kind === 'storm' ? rand(70, 100) : rand(22, 36),
        wobble: rand(0, TAU),
      });
    }
    return list;
  }

  function makePirate() {
    return {
      x: W * 0.85, y: H * 0.2,
      angle: Math.PI,
      speed: 130,
      t: 0,
    };
  }

  function startRound() {
    world = {
      ship: makeShip(),
      cargo: spawnCargo(ROUND.cargoTotal),
      obstacles: spawnObstacles(),
      pirate: makePirate(),
      port: { x: W * 0.08, y: H * 0.5, r: 46 },
      time: ROUND.duration,
      cargoDelivered: 0,
      score: 0,
      combo: 1,
      lastDeliveryAt: -999,
      elapsed: 0,
      skyPhase: Math.random() * TAU,
      ended: false,
      endReason: null,
    };
    state = 'playing';
    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('end-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('cargo-total').textContent = ROUND.cargoTotal;
    if (isTouchDevice()) document.getElementById('touch-controls').classList.remove('hidden');
    sfx.unlock();
  }

  function endRound(reason) {
    if (world.ended) return;
    world.ended = true;
    world.endReason = reason;
    const timeBonus = reason === 'delivered' ? Math.round(world.time) * ROUND.timeBonusPerSecond : 0;
    world.score += timeBonus;
    world.timeBonus = timeBonus;
    state = 'ended';
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch-controls').classList.add('hidden');
    showEndScreen(reason, timeBonus);
  }

  // ---------- Simple synthesized SFX (Web Audio API, no asset files) ----------
  const sfx = (() => {
    let actx = null;
    function unlock() {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) actx = new AC();
      } else if (actx.state === 'suspended') {
        actx.resume();
      }
    }
    function tone(freq, dur, type = 'sine', gain = 0.2) {
      if (!actx) return;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g).connect(actx.destination);
      g.gain.setValueAtTime(gain, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      osc.start();
      osc.stop(actx.currentTime + dur);
    }
    return {
      unlock,
      pickup: () => tone(660, 0.12, 'triangle', 0.18),
      deliver: () => { tone(520, 0.1, 'sine', 0.2); setTimeout(() => tone(780, 0.15, 'sine', 0.2), 90); },
      hit: () => tone(120, 0.25, 'sawtooth', 0.25),
      win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sine', 0.2), i * 90)); },
      lose: () => tone(90, 0.5, 'sawtooth', 0.2),
    };
  })();

  // ---------- Update ----------
  function updateShip(ship, dt) {
    let ix = 0, iy = 0;
    if (keys['KeyW'] || keys['ArrowUp']) iy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) iy += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if (touch.active) { ix = touch.dx; iy = touch.dy; }

    const mag = Math.hypot(ix, iy);
    const boosting = (keys['Space'] || touch.boost) && ship.boostFuel > 0.05;
    if (mag > 0.05) {
      const nx = ix / Math.max(mag, 1); const ny = iy / Math.max(mag, 1);
      ship.angle = Math.atan2(ny, nx);
      const spd = boosting ? ship.boostSpeed : ship.speed;
      ship.vx = lerp(ship.vx, nx * spd * Math.min(mag, 1), dt * 6);
      ship.vy = lerp(ship.vy, ny * spd * Math.min(mag, 1), dt * 6);
    } else {
      ship.vx = lerp(ship.vx, 0, dt * 4);
      ship.vy = lerp(ship.vy, 0, dt * 4);
    }

    if (boosting) {
      ship.boostFuel = clamp(ship.boostFuel - dt * 0.6, 0, 1);
    } else {
      ship.boostFuel = clamp(ship.boostFuel + dt * 0.25, 0, 1);
    }

    ship.x = clamp(ship.x + ship.vx * dt, 20, W - 20);
    ship.y = clamp(ship.y + ship.vy * dt, 20, H - 20);
    ship.invuln = Math.max(0, ship.invuln - dt);

    const speedNow = Math.hypot(ship.vx, ship.vy);
    ship.wakeTimer -= dt;
    if (speedNow > 20 && ship.wakeTimer <= 0) {
      ship.wakeTimer = 0.04;
      const back = ship.angle + Math.PI;
      spawnParticle(
        ship.x + Math.cos(back) * 14 + rand(-4, 4),
        ship.y + Math.sin(back) * 14 + rand(-4, 4),
        Math.cos(back) * 30 + rand(-20, 20),
        Math.sin(back) * 30 + rand(-20, 20),
        rand(0.4, 0.8), rand(2, 5), 'rgba(255,255,255,0.8)'
      );
    }
  }

  function triggerShake(mag) { shake.t = 0.35; shake.mag = mag; }

  function damageShip(reason) {
    const ship = world.ship;
    if (ship.invuln > 0) return;
    ship.invuln = 1.1;
    ship.hull -= 1;
    triggerShake(10);
    sfx.hit();
    if (world.ship.carrying) {
      world.ship.carrying = false;
      world.combo = 1;
    }
    for (let i = 0; i < 14; i++) {
      spawnParticle(ship.x, ship.y, rand(-120, 120), rand(-120, 120), rand(0.3, 0.6), rand(2, 4), 'rgba(200,220,255,0.9)');
    }
    if (ship.hull <= 0) endRound('wrecked');
  }

  function updateObstacles(dt) {
    for (const o of world.obstacles) o.wobble += dt;
    const p = world.pirate;
    p.t += dt;
    p.angle += Math.sin(p.t * 0.6) * dt * 0.6;
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;
    if (p.x < W * 0.2 || p.x > W - 30) p.angle = Math.PI - p.angle;
    if (p.y < 30 || p.y > H - 30) p.angle = -p.angle;
  }

  function checkCollisions() {
    const ship = world.ship;

    for (const o of world.obstacles) {
      const rr = (o.r + 14) ** 2;
      if (dist2(ship.x, ship.y, o.x, o.y) < rr) {
        if (o.kind === 'storm') continue; // handled as slow zone below
        damageShip(o.kind);
      }
    }

    // Storm zones slow the ship instead of a hard hit.
    for (const o of world.obstacles) {
      if (o.kind !== 'storm') continue;
      if (dist2(ship.x, ship.y, o.x, o.y) < o.r ** 2) {
        ship.x += (Math.random() - 0.5) * 60 * (1 / 60);
        ship.vx *= 0.9; ship.vy *= 0.9;
      }
    }

    const p = world.pirate;
    if (dist2(ship.x, ship.y, p.x, p.y) < 26 ** 2) damageShip('pirate');

    if (!ship.carrying) {
      for (const c of world.cargo) {
        if (c.taken) continue;
        if (dist2(ship.x, ship.y, c.x, c.y) < 26 ** 2) {
          c.taken = true;
          ship.carrying = true;
          sfx.pickup();
          for (let i = 0; i < 10; i++) {
            spawnParticle(c.x, c.y, rand(-60, 60), rand(-60, 60), rand(0.3, 0.5), rand(2, 3), 'rgba(255,221,120,0.9)');
          }
          break;
        }
      }
    } else {
      const port = world.port;
      if (dist2(ship.x, ship.y, port.x, port.y) < (port.r + 10) ** 2) {
        ship.carrying = false;
        world.cargoDelivered += 1;

        if (world.elapsed - world.lastDeliveryAt <= ROUND.comboWindow) {
          world.combo = Math.min(ROUND.maxCombo, world.combo + 1);
        } else {
          world.combo = 1;
        }
        world.lastDeliveryAt = world.elapsed;

        const points = ROUND.deliveryBase * world.combo;
        world.score += points;
        sfx.deliver();
        flashCombo();
        for (let i = 0; i < 16; i++) {
          spawnParticle(port.x, port.y, rand(-80, 80), rand(-80, 80), rand(0.4, 0.7), rand(2, 4), 'rgba(140,255,180,0.9)');
        }

        if (world.cargoDelivered >= ROUND.cargoTotal) {
          sfx.win();
          endRound('delivered');
        }
      }
    }
  }

  function flashCombo() {
    const el = document.getElementById('combo');
    document.getElementById('combo-value').textContent = world.combo;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    requestAnimationFrame(() => { el.style.animation = 'pop 0.25s ease'; });
  }

  function updateHud() {
    document.getElementById('cargo-count').textContent = world.cargoDelivered;
    document.getElementById('score-value').textContent = Math.round(world.score);
    const pct = clamp(world.time / ROUND.duration, 0, 1) * 100;
    const fill = document.getElementById('timer-fill');
    fill.style.width = pct + '%';
    fill.style.backgroundColor = pct > 50 ? '#58e07a' : pct > 20 ? '#ffcf4a' : '#ff5a5a';
  }

  function update(dt) {
    if (state !== 'playing') return;
    world.elapsed += dt;
    world.time -= dt;
    updateShip(world.ship, dt);
    updateObstacles(dt);
    checkCollisions();
    updateParticles(dt);
    updateHud();
    if (shake.t > 0) shake.t -= dt;
    if (world.time <= 0) {
      world.time = 0;
      endRound('timeout');
    }
  }

  // ---------- Rendering ----------
  function skyGradient(phase) {
    // Smooth day/sunset/night cycle driven by remaining time, independent of real clock.
    const t = (Math.sin(phase) + 1) / 2;
    const palettes = [
      ['#8fd3ff', '#eaf8ff'], // dawn
      ['#ff9a62', '#ffd9a0'], // sunset
      ['#0a1230', '#1c2a52'], // night
    ];
    const idx = Math.floor(t * palettes.length) % palettes.length;
    return palettes[idx];
  }

  function drawSky() {
    const phase = world ? world.skyPhase + world.elapsed * 0.02 : 0;
    const [c1, c2] = skyGradient(phase);
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawOcean(t) {
    const base = H * 0.1;
    const oceanTop = H * 0.42;
    const g = ctx.createLinearGradient(0, oceanTop, 0, H);
    g.addColorStop(0, '#1c6ea8');
    g.addColorStop(1, '#042f4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, oceanTop, W, H - oceanTop);

    // Layered parallax sine waves.
    const layers = [
      { amp: 10, len: 90, speed: 0.6, y: oceanTop + 10, color: 'rgba(255,255,255,0.10)' },
      { amp: 14, len: 140, speed: 0.35, y: oceanTop + 60, color: 'rgba(255,255,255,0.08)' },
      { amp: 20, len: 220, speed: 0.2, y: oceanTop + 140, color: 'rgba(255,255,255,0.06)' },
    ];
    for (const l of layers) {
      ctx.beginPath();
      ctx.moveTo(0, l.y);
      for (let x = 0; x <= W; x += 8) {
        const y = l.y + Math.sin(x / l.len + t * l.speed) * l.amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = l.color;
      ctx.fill();
    }
  }

  function drawPort(port) {
    ctx.save();
    ctx.translate(port.x, port.y);
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, port.r);
    glow.addColorStop(0, 'rgba(140,255,190,0.5)');
    glow.addColorStop(1, 'rgba(140,255,190,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, port.r, 0, TAU); ctx.fill();

    ctx.fillStyle = '#d8c89a';
    ctx.fillRect(-26, -34, 52, 68);
    ctx.fillStyle = '#9a876a';
    for (let i = -1; i <= 1; i++) ctx.fillRect(-4, -34 + i * 22, 8, 16);
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(0, -40, 5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawCargo(c, t) {
    if (c.taken) return;
    const bob = Math.sin(t * 2 + c.bob) * 4;
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    glow.addColorStop(0, 'rgba(255,221,120,0.55)');
    glow.addColorStop(1, 'rgba(255,221,120,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();

    ctx.fillStyle = '#f2a93c';
    ctx.fillRect(-11, -9, 22, 18);
    ctx.strokeStyle = '#8a5a16';
    ctx.lineWidth = 2;
    ctx.strokeRect(-11, -9, 22, 18);
    ctx.restore();
  }

  function drawObstacle(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.kind === 'iceberg') {
      ctx.fillStyle = '#d9f1ff';
      ctx.beginPath();
      ctx.moveTo(-o.r, o.r * 0.6);
      ctx.lineTo(-o.r * 0.3, -o.r);
      ctx.lineTo(o.r * 0.5, -o.r * 0.5);
      ctx.lineTo(o.r, o.r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
    } else if (o.kind === 'rock') {
      ctx.fillStyle = '#5c5a52';
      ctx.beginPath();
      ctx.ellipse(0, 0, o.r, o.r * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.ellipse(-o.r * 0.3, -o.r * 0.3, o.r * 0.3, o.r * 0.2, 0, 0, TAU); ctx.fill();
    } else {
      const pulse = (Math.sin(o.wobble) + 1) / 2;
      ctx.fillStyle = `rgba(70,80,110,${0.25 + pulse * 0.15})`;
      ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(180,190,220,0.4)';
      ctx.beginPath(); ctx.arc(0, 0, o.r * 0.7, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPirate(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#2a2a2e';
    ctx.beginPath();
    ctx.moveTo(20, 0); ctx.lineTo(-16, -10); ctx.lineTo(-16, 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a1f1f';
    ctx.fillRect(-6, -14, 3, 14);
    ctx.restore();
  }

  function drawShip(ship) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    if (ship.invuln > 0 && Math.floor(ship.invuln * 10) % 2 === 0) ctx.globalAlpha = 0.4;

    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(-16, -11); ctx.lineTo(-20, 0); ctx.lineTo(-16, 11);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#30465a'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = '#d33a3a';
    ctx.fillRect(-6, -6, 14, 12);

    if (ship.carrying) {
      ctx.fillStyle = '#f2a93c';
      ctx.fillRect(-2, -5, 8, 10);
      ctx.strokeStyle = '#8a5a16'; ctx.strokeRect(-2, -5, 8, 10);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function render(t) {
    ctx.save();
    if (shake.t > 0) {
      const m = shake.mag * (shake.t / 0.35);
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    drawSky();
    drawOcean(t);

    if (world) {
      drawPort(world.port);
      for (const o of world.obstacles) drawObstacle(o);
      for (const c of world.cargo) drawCargo(c, t);
      drawPirate(world.pirate);
      drawShip(world.ship);
      drawParticles();
    } else {
      drawOcean(t); // animated background behind the title screen
    }

    ctx.restore();
  }

  // ---------- End screen & scoring ----------
  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  async function loadScores() {
    const list = document.getElementById('score-list');
    try {
      const scores = await fetchJSON('api/scores');
      if (!scores.length) {
        list.innerHTML = '<li class="loading">No scores yet — be the first.</li>';
        return;
      }
      list.innerHTML = scores
        .map((s, i) => `<li><span class="rank">#${i + 1}</span><span>${escapeHtml(s.name)}</span><span>${s.score}</span></li>`)
        .join('');
    } catch {
      list.innerHTML = '<li class="loading">Scores unavailable.</li>';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showEndScreen(reason, timeBonus) {
    const titles = {
      delivered: 'All Cargo Delivered!',
      timeout: "Time's Up",
      wrecked: 'Ship Lost',
    };
    document.getElementById('end-title').textContent = titles[reason] || 'Round Complete';

    const base = world.score - timeBonus;
    const rows = [
      [`Cargo delivered`, `${world.cargoDelivered} / ${ROUND.cargoTotal}`],
      [`Delivery score`, `${base}`],
    ];
    if (timeBonus) rows.push([`Time bonus`, `+${timeBonus}`]);
    const breakdown = document.getElementById('score-breakdown');
    breakdown.innerHTML = rows
      .map(([label, val], i) => `<div class="row" style="animation-delay:${i * 0.12}s"><span>${label}</span><span>${val}</span></div>`)
      .join('');

    document.getElementById('final-score').textContent = Math.round(world.score);
    document.getElementById('save-status').textContent = '';
    document.getElementById('save-status').className = '';
    document.getElementById('end-screen').classList.remove('hidden');
    document.getElementById('player-name').value = '';
    if (reason !== 'delivered') sfx.lose();
    loadScores();
  }

  let saving = false;
  document.getElementById('save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const nameInput = document.getElementById('player-name');
    const status = document.getElementById('save-status');
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = 'Enter a name to save your score.';
      status.className = 'error';
      return;
    }
    saving = true;
    status.textContent = 'Saving…';
    status.className = '';
    try {
      await fetchJSON('api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: Math.round(world.score) }),
      });
      status.textContent = 'Saved!';
      status.className = 'ok';
      nameInput.disabled = true;
      document.querySelector('#save-form button').disabled = true;
      await loadScores();
    } catch (err) {
      status.textContent = err.message || 'Could not save score.';
      status.className = 'error';
    } finally {
      saving = false;
    }
  });

  document.getElementById('btn-start').addEventListener('click', startRound);
  document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('player-name').disabled = false;
    document.querySelector('#save-form button').disabled = false;
    startRound();
  });

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  loadScores();
  requestAnimationFrame(frame);
})();
