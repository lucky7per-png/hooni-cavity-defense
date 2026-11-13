// =============================================================
//  훈이의 충치 방어전 — 1단계 기본 게임
//  (좌우 이동 · 사탕/초콜릿 낙하 · 충돌 · 생명 3개 · 시간 점수 · 난이도 상승)
// =============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 480
const H = canvas.height;  // 720

// ---------- 무대 위치 ----------
const TOP_GUM = 50;        // 윗잇몸 두께
const TOP_TEETH_END = 92;  // 윗니 끝 (단것이 나오는 높이)
const FLOOR_Y = 640;       // 아랫니 윗면 (의사가 서는 바닥)

// ---------- 게임 설정값 (기획서 7·8번 항목) ----------
const CONFIG = {
  lives: 3,
  playerSpeed: 390,        // 의사 이동 속도 (px/초)
  baseFallSpeed: 240,      // 1단계 낙하 속도 (px/초)
  levelEvery: 8,           // 몇 초마다 단계 상승
  maxLevel: 20,            // 최고 단계 (이 단계에서 난이도 최대)
  level2SpeedMul: 1.5,     // 2단계 속도 (예전 4단계 수준으로 시작)
  maxSpeedMul: 3.5,        // 20단계 속도 (최고)
  level2Interval: 0.66,    // 2단계 나오는 간격 (초)
  minInterval: 0.18,       // 20단계 나오는 간격 (초, 가장 짧음)
  invincibleTime: 0.8,     // 맞은 뒤 무적 시간 (초)
  lanes: 8,                // 단것이 떨어지는 칸 수
  maxLives: 5,             // 생명 최대치 (치약·가그린으로 늘릴 수 있는 한도)
  healMinGap: 10,          // 회복 아이템 최소 간격 (초)
  healMaxGap: 17,         // 회복 아이템 최대 간격 (초)
  fullLifeBonus: 50,       // 생명이 가득 찼을 때 회복 아이템 보너스 점수
  rotSpeed: 1.6,           // 이가 썩어 가는/회복되는 속도
};

const TOOTH_COUNT = 16;    // 윗니 8개 + 아랫니 8개

// 단계별 난이도 계산
// 1단계는 몸풀기. 2단계에서 한 번에 어려워지고, 20단계까지 고르게 올라감
function difficulty(level) {
  if (level < 2) return { speedMul: 1, interval: 0.85, minCount: 1, maxCount: 1 };
  const t = Math.min(level - 2, CONFIG.maxLevel - 2) / (CONFIG.maxLevel - 2); // 2단계=0 → 20단계=1
  const speedMul = CONFIG.level2SpeedMul + (CONFIG.maxSpeedMul - CONFIG.level2SpeedMul) * t;
  const interval = CONFIG.level2Interval + (CONFIG.minInterval - CONFIG.level2Interval) * t;
  let minCount, maxCount;
  if (level < 5)       { minCount = 2; maxCount = 2; }
  else if (level < 10) { minCount = 2; maxCount = 3; }
  else if (level < 16) { minCount = 3; maxCount = 3; }
  else                 { minCount = 3; maxCount = 4; }
  return { speedMul, interval, minCount, maxCount };
}

// ---------- 상태 ----------
let state = "start"; // start | playing | paused | over
let player, items, particles, popups;
let elapsed, spawnTimer, lives, dodged, level, shake, invincible;
let healTimer, bonus, healed, toothRot, rotOrder;
let bestScore = Number(localStorage.getItem("dentistBest") || 0);

const keys = { left: false, right: false };
let pointerX = null; // 손가락/마우스 목표 위치

function resetGame() {
  player = { x: W / 2, w: 54, h: 92, dir: 1, walk: 0 };
  items = [];
  particles = [];
  popups = [];
  elapsed = 0;
  spawnTimer = 0.6;
  lives = CONFIG.lives;
  dodged = 0;
  level = 1;
  shake = 0;
  invincible = 0;
  pointerX = null;
  healTimer = nextHealGap();
  bonus = 0;
  healed = 0;
  // 이 하나하나의 썩은 정도 (0 = 하얀 이, 1 = 까맣게 썩은 이)
  toothRot = new Array(TOOTH_COUNT).fill(0);
  // 어떤 이부터 썩을지 매 판 무작위 순서로 정함
  rotOrder = [...Array(TOOTH_COUNT).keys()].sort(() => Math.random() - 0.5);
}

const nextHealGap = () => CONFIG.healMinGap + Math.random() * (CONFIG.healMaxGap - CONFIG.healMinGap);
const score = () => Math.floor(elapsed * 10) + bonus;

// 생명 수에 따라 각 이가 얼마나 썩어야 하는지 계산
// 생명 3개 이상 = 모두 하얀 이, 2개 = 1/3 썩음, 1개 = 2/3 썩음, 0개 = 전부 썩음
function rotTargets() {
  const lost = Math.max(0, CONFIG.lives - lives);
  const rotten = Math.round((TOOTH_COUNT * lost) / CONFIG.lives);
  const targets = new Array(TOOTH_COUNT).fill(0);
  rotOrder.forEach((toothIdx, order) => {
    if (order < rotten) targets[toothIdx] = 1;            // 완전히 썩음
    else if (order < rotten + 3 && lost > 0) targets[toothIdx] = 0.35; // 썩기 시작 (누런 얼룩)
  });
  return targets;
}

function updateTeeth(dt) {
  const targets = rotTargets();
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const diff = targets[i] - toothRot[i];
    const step = CONFIG.rotSpeed * dt;
    toothRot[i] += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
  }
}

// ---------- 단것 만들기 ----------
const CANDY_COLORS = ["#ff5c8a", "#ffb02e", "#7cc8ff", "#a98bff", "#5fd38a"];

function spawnWave() {
  const d = difficulty(level);
  const count = d.minCount + Math.floor(Math.random() * (d.maxCount - d.minCount + 1));
  const laneW = W / CONFIG.lanes;

  // 서로 다른 칸을 골라서, 빠져나갈 틈이 항상 남도록 함
  const lanes = [...Array(CONFIG.lanes).keys()].sort(() => Math.random() - 0.5).slice(0, count);

  lanes.forEach((lane, i) => {
    const type = Math.random() < 0.55 ? "candy" : "choco";
    const size = type === "candy" ? 34 : 44;
    items.push({
      type,
      x: lane * laneW + laneW / 2 + (Math.random() - 0.5) * (laneW - size) * 0.6,
      y: TOP_TEETH_END - 10 - i * 30,          // 살짝 시간차를 두고 등장
      size,
      speed: CONFIG.baseFallSpeed * d.speedMul * (0.9 + Math.random() * 0.2),
      rot: Math.random() * Math.PI,
      rotSpeed: (Math.random() - 0.5) * 4,
      color: CANDY_COLORS[Math.floor(Math.random() * CANDY_COLORS.length)],
    });
  });
}

// 회복 아이템(치약 / 가그린) 만들기 — 받으면 생명 +1
function spawnHeal() {
  const type = Math.random() < 0.5 ? "toothpaste" : "mouthwash";
  const size = 44;
  items.push({
    type,
    heal: true,
    x: size + Math.random() * (W - size * 2),
    y: TOP_TEETH_END - 10,
    size,
    // 받기 쉽도록 단것보다 조금 느리게
    speed: CONFIG.baseFallSpeed * Math.min(difficulty(level).speedMul, 1.8) * 0.8,
    rot: 0,
    rotSpeed: 0,
    wobble: Math.random() * Math.PI * 2,
  });
}

function onHeal(it) {
  healed++;
  burst(it.x, it.y, "#7fffd4", 12);
  burst(it.x, it.y, "#ffffff", 8);
  if (lives < CONFIG.maxLives) {
    lives++;
    popups.push({ text: "생명 +1 ✨", x: player.x, y: FLOOR_Y - player.h - 20, life: 1.0, size: 26, color: "#7fffd4" });
  } else {
    bonus += CONFIG.fullLifeBonus;
    popups.push({ text: `+${CONFIG.fullLifeBonus}점`, x: player.x, y: FLOOR_Y - player.h - 20, life: 1.0, size: 26, color: "#ffe68a" });
  }
}

// ---------- 업데이트 ----------
function update(dt) {
  elapsed += dt;

  // 단계 상승
  const newLevel = Math.min(Math.floor(elapsed / CONFIG.levelEvery) + 1, CONFIG.maxLevel);
  if (newLevel > level) {
    level = newLevel;
    const isMax = level === CONFIG.maxLevel;
    popups.push({
      text: isMax ? "최고 난이도!" : "LEVEL UP!",
      x: W / 2, y: H / 2 - 60, life: isMax ? 2 : 1.2, size: 42,
      color: isMax ? "#ff7a7a" : "#ffe68a",
    });
  }

  // 의사 이동
  let move = 0;
  if (keys.left) move -= 1;
  if (keys.right) move += 1;
  if (move === 0 && pointerX !== null) {
    const diff = pointerX - player.x;
    if (Math.abs(diff) > 4) move = Math.sign(diff) * Math.min(1, Math.abs(diff) / 20);
  }
  player.x += move * CONFIG.playerSpeed * dt;
  player.x = Math.max(player.w / 2 + 4, Math.min(W - player.w / 2 - 4, player.x));
  if (move !== 0) {
    player.dir = Math.sign(move);
    player.walk += dt * 14;
  } else {
    player.walk = 0;
  }

  // 단것 생성
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnWave();
    spawnTimer = difficulty(level).interval;
  }

  // 회복 아이템 생성 (화면에 하나만)
  healTimer -= dt;
  if (healTimer <= 0) {
    if (!items.some((it) => it.heal)) spawnHeal();
    healTimer = nextHealGap();
  }

  // 단것 이동 + 충돌
  if (invincible > 0) invincible -= dt;

  // 충돌 상자는 그림보다 작게 (억울하지 않도록)
  const pBox = {
    x: player.x - player.w * 0.32,
    y: FLOOR_Y - player.h * 0.85,
    w: player.w * 0.64,
    h: player.h * 0.85,
  };

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.y += it.speed * dt;
    it.rot += it.rotSpeed * dt;

    const r = it.size * 0.36;
    const hit =
      it.x + r > pBox.x && it.x - r < pBox.x + pBox.w &&
      it.y + r > pBox.y && it.y - r < pBox.y + pBox.h;

    if (it.heal) {
      it.wobble += dt * 5;
      if (hit) {
        items.splice(i, 1);
        onHeal(it);
      } else if (it.y - it.size / 2 > FLOOR_Y - 6) {
        items.splice(i, 1); // 놓치면 그냥 사라짐
      }
      continue;
    }

    if (hit && invincible <= 0) {
      items.splice(i, 1);
      onHit(it);
      if (state !== "playing") return;
      continue;
    }

    // 아랫니에 닿으면 사라짐 → 피하기 성공
    if (it.y - it.size / 2 > FLOOR_Y - 6) {
      items.splice(i, 1);
      dodged++;
      burst(it.x, FLOOR_Y, it.type === "candy" ? it.color : "#6b3e26", 6);
    }
  }

  updateEffects(dt);
}

function onHit(it) {
  lives--;
  invincible = CONFIG.invincibleTime;
  shake = 0.35;
  burst(it.x, it.y, it.type === "candy" ? it.color : "#6b3e26", 14);
  popups.push({ text: "으악!", x: player.x, y: FLOOR_Y - player.h - 20, life: 0.8, size: 26, color: "#fff" });
  if (lives <= 0) gameOver();
}

function updateEffects(dt) {
  if (shake > 0) shake -= dt;
  updateTeeth(dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life -= dt;
    popups[i].y -= 30 * dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 80 + Math.random() * 180;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.5 + Math.random() * 0.3, color });
  }
}

// ---------- 그리기 ----------
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);

  drawMouth();
  items.forEach(drawItem);
  drawDentist();
  drawLowerTeethFront();
  particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  ctx.restore();

  if (state !== "start") drawHUD();
  popups.forEach(drawPopup);
}

function drawMouth() {
  // 입 안쪽 (짙은 붉은색)
  const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, H * 0.7);
  g.addColorStop(0, "#8a2b45");
  g.addColorStop(1, "#3e0f1e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 혀
  ctx.fillStyle = "#e46b8a";
  ctx.beginPath();
  ctx.ellipse(W / 2, FLOOR_Y + 30, W * 0.62, 210, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(160, 40, 80, 0.45)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2, FLOOR_Y - 170);
  ctx.quadraticCurveTo(W / 2 + 6, FLOOR_Y - 80, W / 2, FLOOR_Y);
  ctx.stroke();

  // 윗잇몸 + 윗니
  ctx.fillStyle = "#f08aa5";
  ctx.fillRect(0, 0, W, TOP_GUM + 6);
  const n = 8, tw = W / n;
  for (let i = 0; i < n; i++) {
    drawTooth(i * tw + 3, TOP_GUM, tw - 6, TOP_TEETH_END - TOP_GUM, true, toothRot[i]);
  }
}

function drawLowerTeethFront() {
  // 아랫니 + 아랫잇몸 (의사 발 앞에 그려서 바닥처럼 보이게)
  const n = 8, tw = W / n;
  for (let i = 0; i < n; i++) {
    drawTooth(i * tw + 3, FLOOR_Y, tw - 6, 44, false, toothRot[8 + i]);
  }
  ctx.fillStyle = "#f08aa5";
  ctx.fillRect(0, FLOOR_Y + 40, W, H - FLOOR_Y - 40);
}

// 두 색 사이를 섞기 (t: 0~1)
function mix(c1, c2, t) {
  const a = c1.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = c2.match(/\w\w/g).map((h) => parseInt(h, 16));
  return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
}

// 썩은 정도(rot)에 따른 이 색: 하얀색 → 누런색 → 까만색
function toothColor(rot) {
  if (rot < 0.5) return mix("#fffdf6", "#c9a86a", rot / 0.5);
  return mix("#c9a86a", "#2a1d1a", (rot - 0.5) / 0.5);
}

function drawTooth(x, y, w, h, upper, rot = 0) {
  ctx.fillStyle = toothColor(rot);
  ctx.strokeStyle = rot > 0.5 ? "#1a1010" : "#d9cfc0";
  ctx.lineWidth = 2;
  const r = 12;
  ctx.beginPath();
  if (upper) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  } else {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 반짝임 (썩을수록 사라짐)
  ctx.fillStyle = `rgba(255,255,255,${0.9 * Math.max(0, 1 - rot * 1.6)})`;
  ctx.fillRect(x + 8, upper ? y + 6 : y + 8, 5, h * 0.4);

  // 충치 구멍/얼룩 (썩기 시작하면 보임)
  if (rot > 0.15) {
    const a = Math.min(1, (rot - 0.15) / 0.5);
    ctx.fillStyle = `rgba(40, 22, 15, ${a})`;
    const cx = x + w * 0.6, cy = upper ? y + h * 0.6 : y + h * 0.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.16 + rot * 4, h * 0.12 + rot * 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.3, upper ? y + h * 0.35 : y + h * 0.7, 2 + rot * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 완전히 썩으면 금이 간 모양
  if (rot > 0.7) {
    ctx.strokeStyle = `rgba(0,0,0,${(rot - 0.7) / 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sy = upper ? y + h : y;
    const dir = upper ? -1 : 1;
    ctx.moveTo(x + w * 0.45, sy);
    ctx.lineTo(x + w * 0.55, sy + dir * h * 0.3);
    ctx.lineTo(x + w * 0.4, sy + dir * h * 0.55);
    ctx.stroke();
  }
}

function drawHealItem(it) {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(Math.sin(it.wobble) * 0.25);

  // 반짝이는 테두리 (먹는 아이템이라는 표시)
  const glow = 0.5 + Math.sin(it.wobble * 1.5) * 0.25;
  ctx.fillStyle = `rgba(127, 255, 212, ${glow * 0.45})`;
  ctx.beginPath();
  ctx.arc(0, 0, it.size * 0.72, 0, Math.PI * 2);
  ctx.fill();

  if (it.type === "toothpaste") {
    // 치약 튜브: 흰 몸통 + 파란 줄 + 빨간 뚜껑
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#9fb4c8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -20);
    ctx.lineTo(14, -20);
    ctx.lineTo(9, 16);
    ctx.lineTo(-9, 16);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3d8bfd";
    ctx.fillRect(-12, -8, 23, 8);
    ctx.fillStyle = "#ff5c5c";
    ctx.fillRect(-7, 21 - 5, 14, 8);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("치약", 0, -4);
  } else {
    // 가그린(구강청결제) 병: 초록 액체 + 흰 뚜껑
    ctx.fillStyle = "rgba(220, 255, 240, 0.9)";
    ctx.strokeStyle = "#5fb89c";
    ctx.lineWidth = 2;
    roundRect(-12, -14, 24, 34, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2fcf8f";
    roundRect(-10, -2, 20, 20, 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-7, -22, 14, 9);
    ctx.strokeRect(-7, -22, 14, 9);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("가그린", 0, 8);
  }
  ctx.restore();
}

function drawItem(it) {
  if (it.heal) return drawHealItem(it);
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.rot);
  const s = it.size;

  if (it.type === "candy") {
    // 포장 사탕: 가운데 동그라미 + 양쪽 리본
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, 0); ctx.lineTo(-s * 0.62, -s * 0.28); ctx.lineTo(-s * 0.62, s * 0.28);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.3, 0); ctx.lineTo(s * 0.62, -s * 0.28); ctx.lineTo(s * 0.62, s * 0.28);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.22, Math.PI * 0.9, Math.PI * 1.6);
    ctx.stroke();
  } else {
    // 판 초콜릿: 갈색 네모 + 격자
    const w = s * 0.8, h = s * 0.9;
    ctx.fillStyle = "#5a321d";
    roundRect(-w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = "#7d4a2c";
    ctx.lineWidth = 2;
    for (let i = 1; i < 2; i++) {
      ctx.beginPath(); ctx.moveTo(-w / 2 + (w / 2) * i, -h / 2 + 3); ctx.lineTo(-w / 2 + (w / 2) * i, h / 2 - 3); ctx.stroke();
    }
    for (let j = 1; j < 3; j++) {
      ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 2 + (h / 3) * j); ctx.lineTo(w / 2 - 3, -h / 2 + (h / 3) * j); ctx.stroke();
    }
    // 은박 포장 일부
    ctx.fillStyle = "#c9ccd6";
    ctx.fillRect(-w / 2, h * 0.18, w, h * 0.32);
  }
  ctx.restore();
}

function drawDentist() {
  // 무적 시간에는 깜빡임
  if (invincible > 0 && Math.floor(invincible * 12) % 2 === 0) return;

  const x = player.x, feet = FLOOR_Y + 4;
  const bob = Math.abs(Math.sin(player.walk)) * 3;
  const d = player.dir;

  ctx.save();
  ctx.translate(x, feet - bob);

  // 다리
  const legSwing = Math.sin(player.walk) * 5;
  ctx.fillStyle = "#3b4a6b";
  ctx.fillRect(-13 + legSwing, -24, 10, 24);
  ctx.fillRect(3 - legSwing, -24, 10, 24);
  // 신발
  ctx.fillStyle = "#222";
  ctx.fillRect(-15 + legSwing, -5, 14, 6);
  ctx.fillRect(1 - legSwing, -5, 14, 6);

  // 흰 가운
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#c5ced8";
  ctx.lineWidth = 2;
  roundRect(-22, -62, 44, 44, 10);
  ctx.fill(); ctx.stroke();
  // 가운 단추 줄 + 주머니
  ctx.strokeStyle = "#c5ced8";
  ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(0, -20); ctx.stroke();
  ctx.fillStyle = "#e7f6f2";
  ctx.fillRect(-17, -40, 10, 8);

  // 칫솔 든 팔 (바라보는 방향)
  ctx.fillStyle = "#ffffff";
  ctx.save();
  ctx.translate(18 * d, -54);
  ctx.rotate(-0.5 * d);
  ctx.fillRect(d > 0 ? 0 : -8, 0, 8, 22);
  ctx.restore();
  // 손
  ctx.fillStyle = "#f6cfa8";
  ctx.beginPath(); ctx.arc(28 * d, -38, 5, 0, Math.PI * 2); ctx.fill();
  // 칫솔 (손잡이 + 머리 + 솔)
  ctx.save();
  ctx.translate(28 * d, -38);
  ctx.rotate(-0.35 * d);
  ctx.fillStyle = "#5fd3b8";
  ctx.fillRect(-3, -40, 6, 44);
  ctx.fillStyle = "#3fb39a";
  ctx.fillRect(-4, -48, 8, 12);
  ctx.fillStyle = "#e8fbff";
  for (let i = 0; i < 4; i++) ctx.fillRect(d > 0 ? 4 : -10, -47 + i * 3, 6, 2);
  ctx.restore();

  // 머리
  ctx.fillStyle = "#f6cfa8";
  ctx.beginPath(); ctx.arc(0, -76, 17, 0, Math.PI * 2); ctx.fill();
  // 머리카락
  ctx.fillStyle = "#3a2a1e";
  ctx.beginPath(); ctx.arc(0, -80, 17, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.fillRect(-17, -82, 34, 5);
  // 이마 반사경(치과 헤드미러)
  ctx.fillStyle = "#cfd8e3";
  ctx.beginPath(); ctx.arc(0, -90, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-1.5, -91.5, 2, 0, Math.PI * 2); ctx.fill();
  // 눈
  ctx.fillStyle = "#222";
  ctx.beginPath(); ctx.arc(-6 + d * 2, -77, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(6 + d * 2, -77, 2.3, 0, Math.PI * 2); ctx.fill();
  // 마스크
  ctx.fillStyle = "#9fd9ef";
  roundRect(-12, -72, 24, 12, 4);
  ctx.fill();
  ctx.strokeStyle = "#7fbcd4";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-10, -67); ctx.lineTo(10, -67); ctx.stroke();

  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(90, 20, 45, 0.9)";
  ctx.lineWidth = 4;
  ctx.textBaseline = "middle";

  // 점수
  ctx.font = "bold 20px 'Malgun Gothic', sans-serif";
  ctx.textAlign = "left";
  const sTxt = `점수 ${score()}`;
  ctx.strokeText(sTxt, 12, 18);
  ctx.fillText(sTxt, 12, 18);
  ctx.font = "13px 'Malgun Gothic', sans-serif";
  const bTxt = `최고 ${Math.max(bestScore, score())}`;
  ctx.strokeText(bTxt, 12, 39);
  ctx.fillText(bTxt, 12, 39);

  // 생명 (기본 이빨 3개 + 치약·가그린으로 늘어난 만큼)
  const slots = Math.max(CONFIG.lives, lives);
  const gap = 30;
  for (let i = 0; i < slots; i++) {
    drawLifeTooth(W / 2 - ((slots - 1) * gap) / 2 + i * gap, 24, i < lives);
  }

  // 단계
  ctx.font = "bold 20px 'Malgun Gothic', sans-serif";
  ctx.textAlign = "right";
  const lTxt = level >= CONFIG.maxLevel ? `Lv.${level} MAX` : `Lv.${level}`;
  ctx.strokeText(lTxt, W - 58, 24);
  ctx.fillText(lTxt, W - 58, 24);
}

function drawLifeTooth(cx, cy, healthy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = healthy ? "#ffffff" : "#3a2a2a";
  ctx.strokeStyle = healthy ? "#b9a99a" : "#1a1010";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-11, -9);
  ctx.quadraticCurveTo(-11, -15, -5, -14);
  ctx.quadraticCurveTo(0, -11, 5, -14);
  ctx.quadraticCurveTo(11, -15, 11, -9);
  ctx.quadraticCurveTo(11, 0, 7, 6);
  ctx.lineTo(5, 14);
  ctx.quadraticCurveTo(3, 15, 2, 12);
  ctx.lineTo(0, 4);
  ctx.lineTo(-2, 12);
  ctx.quadraticCurveTo(-3, 15, -5, 14);
  ctx.lineTo(-7, 6);
  ctx.quadraticCurveTo(-11, 0, -11, -9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPopup(p) {
  ctx.globalAlpha = Math.min(1, p.life * 2);
  ctx.font = `bold ${p.size}px 'Malgun Gothic', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(90, 20, 45, 0.9)";
  ctx.strokeText(p.text, p.x, p.y);
  ctx.fillStyle = p.color;
  ctx.fillText(p.text, p.x, p.y);
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- 화면 전환 ----------
const $ = (id) => document.getElementById(id);
const screens = { start: $("startScreen"), pause: $("pauseScreen"), over: $("overScreen") };

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  if (name) screens[name].classList.remove("hidden");
  $("pauseBtn").classList.toggle("hidden", name !== null);
}

function startGame() {
  resetGame();
  state = "playing";
  show(null);
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  show("pause");
}

function resumeGame() {
  if (state !== "paused") return;
  state = "playing";
  keys.left = keys.right = false;
  show(null);
}

function goHome() {
  state = "start";
  resetGame();
  $("startBest").textContent = bestScore;
  show("start");
}

function gameOver() {
  state = "over";
  const s = score();
  const isRecord = s > bestScore;
  if (isRecord) {
    bestScore = s;
    localStorage.setItem("dentistBest", String(bestScore));
  }
  $("finalScore").textContent = s;
  $("finalTime").textContent = elapsed.toFixed(1) + "초";
  $("finalDodged").textContent = dodged + "개";
  $("finalHealed").textContent = healed + "개";
  $("finalBest").textContent = bestScore;
  $("newRecord").classList.toggle("hidden", !isRecord);
  // 맞는 장면이 잠깐 보이도록 살짝 늦게 표시
  setTimeout(() => { if (state === "over") show("over"); }, 600);
}

$("startBtn").onclick = startGame;
$("retryBtn").onclick = startGame;
$("homeBtn").onclick = goHome;
$("quitBtn").onclick = goHome;
$("resumeBtn").onclick = resumeGame;
$("pauseBtn").onclick = pauseGame;

// ---------- 입력 ----------
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
  if (e.key === "p" || e.key === "P" || e.key === "Escape") {
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
  }
  if ((e.key === "Enter" || e.key === " ") && (state === "start" || (state === "over" && !screens.over.classList.contains("hidden")))) {
    e.preventDefault();
    startGame();
  }
  if (e.key.startsWith("Arrow")) e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
});

// 터치/마우스: 누른 위치로 의사가 따라감
function toCanvasX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * W;
}
canvas.addEventListener("pointerdown", (e) => { pointerX = toCanvasX(e.clientX); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => { if (pointerX !== null) pointerX = toCanvasX(e.clientX); });
canvas.addEventListener("pointerup", () => { pointerX = null; });
canvas.addEventListener("pointercancel", () => { pointerX = null; });

// 다른 창으로 가면 자동 일시정지
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

// ---------- 메인 루프 ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // 너무 큰 시간 점프 방지
  last = now;
  if (state === "playing") update(dt);
  else if (state === "over") updateEffects(dt);
  draw();
  requestAnimationFrame(loop);
}

resetGame();
$("startBest").textContent = bestScore;
requestAnimationFrame(loop);
