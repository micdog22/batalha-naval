import {
  SIZE, ROWS, FLEET, LEVELS, cellName, rowOf, colOf, shipCells, canPlace, validateFleet, randomFleet,
  Game, secureRandom,
} from './game.js';
import { Sound } from './sound.js';

const CONFIG_KEY = 'batalha-naval:config';
const STATS_KEY = 'batalha-naval:estatisticas';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (sel) => document.querySelector(sel);
const els = {
  level: $('#level'),
  noTouch: $('#no-touch'),
  sound: $('#sound'),
  animations: $('#animations'),
  newGame: $('#new-game'),
  settingsNote: $('#settings-note'),
  turn: $('#turn'),
  message: $('#message'),
  log: $('#log'),
  boards: $('#boards'),
  playerBoard: $('#player-board'),
  enemyBoard: $('#enemy-board'),
  playerInfo: $('#player-info'),
  enemyInfo: $('#enemy-info'),
  setup: $('#setup'),
  dock: $('#dock'),
  rotate: $('#rotate'),
  random: $('#random'),
  clear: $('#clear'),
  start: $('#start'),
  playerFleet: $('#player-fleet'),
  enemyFleet: $('#enemy-fleet'),
  stats: $('#stats'),
  resetStats: $('#reset-stats'),
};

const config = loadConfig();
const sound = new Sound();
sound.enabled = config.sound;
let stats = loadStats();

let phase = 'setup';
let placed = [];
let selected = FLEET[0].id;
let horizontal = true;
let game = null;
let cpuTimer = 0;
let drag = null;
let suppressClick = false;
let preview = null;
const focusIdx = { player: 0, enemy: 0 };
const logLines = [];
const cells = { player: [], enemy: [] };

/* ---------------- armazenamento ---------------- */

function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  return {
    level: LEVELS[saved.level] ? saved.level : 'medium',
    noTouch: Boolean(saved.noTouch),
    sound: saved.sound !== false,
    animations: typeof saved.animations === 'boolean' ? saved.animations : !reducedMotion.matches,
  };
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* sem armazenamento: segue sem salvar */
  }
}

function emptyStats() {
  return { played: 0, wins: 0, losses: 0, bestWin: null, shots: 0, hits: 0 };
}

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
    if (s && Number.isInteger(s.played)) return { ...emptyStats(), ...s };
  } catch {
    /* ignora dados corrompidos */
  }
  return emptyStats();
}

function saveStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* idem */
  }
}

/* ---------------- utilidades ---------------- */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function animationsOn() {
  return config.animations && !reducedMotion.matches;
}

function spec(id) {
  return FLEET.find((s) => s.id === id);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------------- tabuleiros ---------------- */

function buildBoard(container, kind) {
  container.replaceChildren(h('div', { role: 'row', class: 'board-row head' },
    h('span', { role: 'columnheader', class: 'corner', 'aria-label': 'Linhas e colunas' }),
    Array.from({ length: SIZE }, (_, c) => h('span', { role: 'columnheader', class: 'col-label', text: String(c + 1) }))));
  cells[kind] = [];
  for (let r = 0; r < SIZE; r++) {
    const row = h('div', { role: 'row', class: 'board-row' }, h('span', { role: 'rowheader', class: 'row-label', text: ROWS[r] }));
    for (let c = 0; c < SIZE; c++) {
      const idx = r * SIZE + c;
      const button = h('button', { type: 'button', class: 'cell', 'data-idx': String(idx), tabindex: idx === 0 ? '0' : '-1' });
      cells[kind].push(button);
      row.append(h('div', { role: 'gridcell', class: 'cell-wrap' }, button));
    }
    container.append(row);
  }
}

/** Classes de segmento para desenhar proa e popa arredondadas. */
function segmentClasses(ships) {
  const map = new Map();
  for (const ship of ships) {
    const sorted = [...ship.cells].sort((a, b) => a - b);
    const horiz = sorted.length > 1 ? rowOf(sorted[0]) === rowOf(sorted[1]) : true;
    sorted.forEach((c, i) => {
      const part = i === 0 ? 'start' : i === sorted.length - 1 ? 'end' : 'mid';
      map.set(c, { ship, cls: `ship ${horiz ? 'seg-h' : 'seg-v'} seg-${part}` });
    });
  }
  return map;
}

function previewCells() {
  if (phase !== 'setup' || !preview || placed.some((s) => s.id === preview.id)) return null;
  const size = spec(preview.id).size;
  let r = rowOf(preview.idx);
  let c = colOf(preview.idx);
  if (preview.offset) {
    if (preview.horizontal) c -= preview.offset;
    else r -= preview.offset;
  }
  const full = shipCells(r, c, size, preview.horizontal);
  const ok = Boolean(full) && canPlace(placed, full, { noTouch: config.noTouch });
  const visible = [];
  for (let k = 0; k < size; k++) {
    const rr = preview.horizontal ? r : r + k;
    const cc = preview.horizontal ? c + k : c;
    if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) visible.push(rr * SIZE + cc);
  }
  return { cells: new Set(visible), ok, full };
}

function renderPlayerBoard() {
  const ships = phase === 'setup' ? placed : game.playerBoard.ships;
  const segments = segmentClasses(ships);
  const shots = game && phase !== 'setup' ? game.playerBoard.shots : new Map();
  const pv = previewCells();
  cells.player.forEach((button, idx) => {
    const seg = segments.get(idx);
    const shot = shots.get(idx);
    let cls = 'cell';
    let label = `${cellName(idx)}: `;
    if (seg) cls += ` ${seg.cls}`;
    if (shot) cls += ` ${shot}`;
    if (pv && pv.cells.has(idx)) cls += pv.ok ? ' preview-ok' : ' preview-bad';
    if (shot === 'sunk') label += `${seg.ship.name} afundado`;
    else if (shot === 'hit') label += `${seg.ship.name} atingido`;
    else if (shot === 'miss') label += 'água, tiro do computador';
    else if (seg) label += seg.ship.name;
    else label += 'água';
    button.className = cls;
    button.setAttribute('aria-label', label);
    button.tabIndex = idx === focusIdx.player ? 0 : -1;
  });
  els.playerBoard.classList.toggle('placing', phase === 'setup');
}

function renderEnemyBoard() {
  const shots = game ? game.cpuBoard.shots : new Map();
  const segments = game ? segmentClasses(game.cpuBoard.ships) : new Map();
  const reveal = phase === 'over';
  const canShoot = phase === 'playing' && game && game.turn === 'player';
  cells.enemy.forEach((button, idx) => {
    const shot = shots.get(idx);
    let cls = 'cell';
    let label = `${cellName(idx)}: `;
    if (shot) cls += ` ${shot}`;
    const ship = game ? game.cpuBoard.shipAt(idx) : null;
    if (shot === 'sunk') {
      cls += ` ${segments.get(idx).cls}`;
      label += `${ship.name} afundado`;
    } else if (shot === 'hit') label += 'acertou';
    else if (shot === 'miss') label += 'água';
    else if (reveal && segments.has(idx)) {
      cls += ` ${segments.get(idx).cls} revealed`;
      label += `${ship.name} que sobrou`;
    } else label += 'desconhecida';
    button.className = cls;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-disabled', String(!canShoot || Boolean(shot)));
    button.tabIndex = idx === focusIdx.enemy ? 0 : -1;
  });
  els.enemyBoard.classList.toggle('waiting', !canShoot);
}

function renderDock() {
  els.dock.replaceChildren(...FLEET.map((s, i) => {
    const isPlaced = placed.some((p) => p.id === s.id);
    return h('li', {},
      h('button', {
        type: 'button',
        class: `dock-ship${s.id === selected ? ' selected' : ''}${isPlaced ? ' placed' : ''}`,
        'aria-pressed': String(s.id === selected),
        onclick: () => selectShip(s.id),
      },
      h('span', { class: 'dock-key', text: String(i + 1) }),
      h('span', { class: 'dock-name', text: `${s.name[0].toUpperCase()}${s.name.slice(1)}` }),
      h('span', { class: 'dock-blocks', 'aria-hidden': 'true' }, Array.from({ length: s.size }, () => h('i'))),
      h('span', { class: 'dock-state', text: isPlaced ? 'no mar' : `${s.size} casas` })));
  }));
  els.rotate.textContent = `Girar (R): ${horizontal ? 'horizontal' : 'vertical'}`;
  els.start.disabled = placed.length !== FLEET.length;
}

function renderFleets() {
  if (!game || phase === 'setup') {
    els.playerFleet.replaceChildren();
    els.enemyFleet.replaceChildren();
    return;
  }
  els.playerFleet.replaceChildren(...game.playerBoard.ships.map((s) => {
    const state = s.hits === s.size ? 'afundado' : s.hits ? `atingido (${s.hits} de ${s.size})` : 'intacto';
    return h('li', { class: s.hits === s.size ? 'sunk' : '' }, h('span', { text: s.name }), h('span', { class: 'muted', text: state }));
  }));
  els.enemyFleet.replaceChildren(...game.cpuBoard.ships.map((s) => {
    const sunk = s.hits === s.size;
    return h('li', { class: sunk ? 'sunk' : '' }, h('span', { text: `${s.name} (${s.size})` }), h('span', { class: 'muted', text: sunk ? 'afundado' : 'flutuando' }));
  }));
}

function renderStatus() {
  if (phase === 'setup') {
    const missing = FLEET.length - placed.length;
    els.turn.textContent = missing
      ? `Posicione sua frota: ${plural(missing, 'navio falta', 'navios faltam')}.`
      : 'Frota pronta. Clique em "Começar partida".';
  } else if (phase === 'playing') {
    els.turn.textContent = game.turn === 'player' ? 'Sua vez: escolha uma casa no mar inimigo.' : 'Vez do computador...';
  } else {
    els.turn.textContent = game.winner === 'player'
      ? `Você venceu em ${plural(game.stats.playerShots, 'tiro', 'tiros')}!`
      : `O computador venceu em ${plural(game.stats.cpuShots, 'tiro', 'tiros')}.`;
  }
  els.log.replaceChildren(...logLines.map((line) => h('li', { text: line })));
  const s = game ? game.stats : null;
  els.playerInfo.textContent = s && phase !== 'setup' ? `Tiros do computador: ${s.cpuShots}` : '';
  els.enemyInfo.textContent = s && phase !== 'setup'
    ? `Seus tiros: ${s.playerShots} · acertos: ${s.playerHits}${s.playerShots ? ` (${Math.round((100 * s.playerHits) / s.playerShots)}%)` : ''}`
    : 'Posicione sua frota para começar.';
  els.setup.hidden = phase !== 'setup';
  els.boards.classList.toggle('in-game', phase !== 'setup');
}

function renderStats() {
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '0%');
  const items = [
    ['Partidas', String(stats.played)],
    ['Vitórias', String(stats.wins)],
    ['Derrotas', String(stats.losses)],
    ['Aproveitamento', pct(stats.wins, stats.played)],
    ['Melhor vitória', stats.bestWin ? plural(stats.bestWin, 'tiro', 'tiros') : 'ainda não'],
    ['Precisão', pct(stats.hits, stats.shots)],
  ];
  els.stats.replaceChildren(...items.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));
}

function render() {
  renderPlayerBoard();
  renderEnemyBoard();
  renderDock();
  renderFleets();
  renderStatus();
}

function setMessage(text) {
  els.message.textContent = text;
}

function pushLog(text) {
  logLines.unshift(text);
  if (logLines.length > 6) logLines.length = 6;
}

function flash(kind, idx, result) {
  if (!animationsOn()) return;
  const button = cells[kind][idx];
  const cls = result === 'miss' ? 'anim-splash' : 'anim-boom';
  button.classList.remove('anim-splash', 'anim-boom');
  void button.offsetWidth;
  button.classList.add(cls);
  setTimeout(() => button.classList.remove(cls), 700);
}

/* ---------------- posicionamento ---------------- */

function selectShip(id) {
  if (phase !== 'setup') return;
  const i = placed.findIndex((s) => s.id === id);
  if (i >= 0) {
    horizontal = placed[i].horizontal;
    placed.splice(i, 1);
    setMessage(`${spec(id).name[0].toUpperCase()}${spec(id).name.slice(1)} recolhido: escolha onde colocar.`);
  }
  selected = id;
  render();
}

function nextUnplaced() {
  const next = FLEET.find((s) => !placed.some((p) => p.id === s.id));
  return next ? next.id : null;
}

function tryPlace(idx, offset = 0) {
  if (phase !== 'setup' || !selected || placed.some((s) => s.id === selected)) return false;
  const s = spec(selected);
  let r = rowOf(idx);
  let c = colOf(idx);
  if (horizontal) c -= offset;
  else r -= offset;
  const shipCellsList = shipCells(r, c, s.size, horizontal);
  if (!canPlace(placed, shipCellsList, { noTouch: config.noTouch })) {
    setMessage(shipCellsList
      ? `O ${s.name} não cabe aí: ${config.noTouch ? 'sobrepõe ou encosta em outro navio' : 'sobrepõe outro navio'}.`
      : `O ${s.name} não cabe aí: sairia do mar. Tente girar (R).`);
    return false;
  }
  placed.push({ ...s, cells: shipCellsList, horizontal });
  setMessage(`${s.name[0].toUpperCase()}${s.name.slice(1)} posicionado de ${cellName(shipCellsList[0])} a ${cellName(shipCellsList[shipCellsList.length - 1])}.`);
  selected = nextUnplaced();
  return true;
}

function pickUp(idx) {
  const i = placed.findIndex((s) => s.cells.includes(idx));
  if (i < 0) return null;
  const ship = placed[i];
  placed.splice(i, 1);
  selected = ship.id;
  horizontal = ship.horizontal;
  return ship;
}

function rotate() {
  if (phase !== 'setup') return;
  horizontal = !horizontal;
  if (preview) preview.horizontal = horizontal;
  render();
}

els.rotate.addEventListener('click', rotate);
els.random.addEventListener('click', () => {
  if (phase !== 'setup') return;
  placed = randomFleet(secureRandom, { noTouch: config.noTouch }).map((s) => ({
    ...s, horizontal: s.cells.length > 1 && rowOf(s.cells[0]) === rowOf(s.cells[1]),
  }));
  selected = null;
  setMessage('Frota posicionada ao acaso. Arraste para ajustar ou clique em "Começar partida".');
  render();
});
els.clear.addEventListener('click', () => {
  if (phase !== 'setup') return;
  placed = [];
  selected = FLEET[0].id;
  setMessage('Frota recolhida.');
  render();
});

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const button = el && el.closest('#player-board .cell');
  return button ? Number(button.dataset.idx) : null;
}

els.playerBoard.addEventListener('pointerdown', (event) => {
  if (phase !== 'setup' || event.button > 0) return;
  const button = event.target.closest('.cell');
  if (!button) return;
  const idx = Number(button.dataset.idx);
  const ship = placed.find((s) => s.cells.includes(idx));
  if (!ship) return;
  event.preventDefault();
  const sorted = [...ship.cells].sort((a, b) => a - b);
  const offset = sorted.indexOf(idx);
  const original = { ...ship, cells: [...ship.cells] };
  pickUp(idx);
  drag = { id: ship.id, offset, original, pointerId: event.pointerId, moved: false };
  preview = { id: ship.id, idx, offset, horizontal };
  els.playerBoard.setPointerCapture(event.pointerId);
  render();
});

els.playerBoard.addEventListener('pointermove', (event) => {
  if (phase !== 'setup') return;
  const idx = drag ? cellFromPoint(event.clientX, event.clientY) : (event.target.closest('.cell') ? Number(event.target.closest('.cell').dataset.idx) : null);
  if (idx === null) {
    if (!drag && preview) {
      preview = null;
      renderPlayerBoard();
    }
    return;
  }
  if (drag) drag.moved = drag.moved || idx !== preview.idx;
  const id = drag ? drag.id : selected;
  if (!id) return;
  if (!preview || preview.idx !== idx || preview.id !== id) {
    preview = { id, idx, offset: drag ? drag.offset : 0, horizontal };
    renderPlayerBoard();
  }
});

els.playerBoard.addEventListener('pointerleave', () => {
  if (!drag && preview) {
    preview = null;
    renderPlayerBoard();
  }
});

function endDrag(event, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (els.playerBoard.hasPointerCapture && els.playerBoard.hasPointerCapture(d.pointerId)) els.playerBoard.releasePointerCapture(d.pointerId);
  const idx = cancelled ? null : cellFromPoint(event.clientX, event.clientY);
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (!d.moved && !cancelled) {
    // Clique simples num navio: só recolhe para reposicionar.
    setMessage(`${spec(d.id).name[0].toUpperCase()}${spec(d.id).name.slice(1)} recolhido: clique onde quer colocar ou aperte R para girar.`);
  } else if (idx === null || !tryPlace(idx, d.offset)) {
    placed.push(d.original);
    horizontal = d.original.horizontal;
    selected = nextUnplaced();
    if (idx !== null) setMessage(`Não cabe aí. O ${spec(d.id).name} voltou para o lugar.`);
  }
  preview = null;
  render();
}

els.playerBoard.addEventListener('pointerup', (event) => endDrag(event, false));
els.playerBoard.addEventListener('pointercancel', (event) => endDrag(event, true));

els.playerBoard.addEventListener('click', (event) => {
  if (phase !== 'setup' || suppressClick) return;
  const button = event.target.closest('.cell');
  if (!button) return;
  const idx = Number(button.dataset.idx);
  focusIdx.player = idx;
  if (tryPlace(idx)) {
    preview = selected ? { id: selected, idx, offset: 0, horizontal } : null;
  }
  render();
});

/* ---------------- teclado ---------------- */

function moveFocus(idx, key) {
  let r = rowOf(idx);
  let c = colOf(idx);
  if (key === 'ArrowUp') r = Math.max(0, r - 1);
  else if (key === 'ArrowDown') r = Math.min(SIZE - 1, r + 1);
  else if (key === 'ArrowLeft') c = Math.max(0, c - 1);
  else if (key === 'ArrowRight') c = Math.min(SIZE - 1, c + 1);
  else if (key === 'Home') c = 0;
  else if (key === 'End') c = SIZE - 1;
  else return null;
  return r * SIZE + c;
}

els.playerBoard.addEventListener('keydown', (event) => {
  const button = event.target.closest('.cell');
  if (!button) return;
  const idx = Number(button.dataset.idx);
  const next = moveFocus(idx, event.key);
  if (next !== null) {
    event.preventDefault();
    focusIdx.player = next;
    if (phase === 'setup' && selected) preview = { id: selected, idx: next, offset: 0, horizontal };
    renderPlayerBoard();
    cells.player[next].focus();
    return;
  }
  if (phase !== 'setup') return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (selected && !placed.some((s) => s.id === selected)) tryPlace(idx);
    else if (pickUp(idx)) setMessage(`${spec(selected).name[0].toUpperCase()}${spec(selected).name.slice(1)} recolhido: escolha a nova posição e tecle Enter.`);
    preview = selected ? { id: selected, idx, offset: 0, horizontal } : null;
    render();
    cells.player[idx].focus();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    const ship = pickUp(idx);
    if (ship) setMessage(`${ship.name[0].toUpperCase()}${ship.name.slice(1)} recolhido.`);
    preview = { id: selected, idx, offset: 0, horizontal };
    render();
    cells.player[idx].focus();
  }
});

els.playerBoard.addEventListener('focusin', (event) => {
  const button = event.target.closest('.cell');
  if (!button || phase !== 'setup' || !selected || drag) return;
  preview = { id: selected, idx: Number(button.dataset.idx), offset: 0, horizontal };
  renderPlayerBoard();
});

els.enemyBoard.addEventListener('keydown', (event) => {
  const button = event.target.closest('.cell');
  if (!button) return;
  const idx = Number(button.dataset.idx);
  const next = moveFocus(idx, event.key);
  if (next !== null) {
    event.preventDefault();
    focusIdx.enemy = next;
    renderEnemyBoard();
    cells.enemy[next].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    playerShoot(idx);
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('select, input, textarea')) return;
  if (phase !== 'setup') return;
  if (event.key === 'r' || event.key === 'R') {
    rotate();
  } else if (/^[1-5]$/.test(event.key)) {
    selectShip(FLEET[Number(event.key) - 1].id);
  }
});

/* ---------------- partida ---------------- */

function describe(who, out) {
  const where = cellName(out.cell);
  const yours = who === 'cpu' ? 'seu ' : 'o ';
  if (out.result === 'miss') return `${who === 'cpu' ? 'O computador' : 'Você'} atirou em ${where}: água.`;
  if (out.result === 'hit') return who === 'cpu' ? `O computador atirou em ${where}: acertou ${yours}${out.ship.name}!` : `Você atirou em ${where}: acertou!`;
  return `${who === 'cpu' ? 'O computador' : 'Você'} atirou em ${where}: afundou ${yours}${out.ship.name}!`;
}

function startGame() {
  if (!validateFleet(placed, { noTouch: config.noTouch })) {
    setMessage('Posicione os cinco navios antes de começar.');
    return;
  }
  game = new Game({
    playerShips: placed,
    cpuShips: randomFleet(secureRandom, { noTouch: config.noTouch }),
    level: config.level,
    noTouch: config.noTouch,
    rng: secureRandom,
  });
  phase = 'playing';
  preview = null;
  logLines.length = 0;
  els.settingsNote.textContent = '';
  setMessage(`Partida começou no nível ${LEVELS[config.level].toLowerCase()}. Você atira primeiro.`);
  render();
  cells.enemy[focusIdx.enemy].focus();
}

els.start.addEventListener('click', startGame);

function playerShoot(idx) {
  if (phase !== 'playing' || !game || game.turn !== 'player') return;
  const out = game.playerFire(idx);
  if (out.result === 'repeated') {
    setMessage(`Você já atirou em ${cellName(idx)}. Escolha outra casa.`);
    return;
  }
  const text = describe('player', out);
  setMessage(text);
  pushLog(text);
  sound.play(out.result);
  render();
  flash('enemy', idx, out.result);
  if (game.winner) {
    finish();
    return;
  }
  cpuTimer = setTimeout(cpuShoot, animationsOn() ? 800 : 300);
}

function cpuShoot() {
  if (phase !== 'playing' || !game || game.turn !== 'cpu') return;
  const out = game.cpuFire();
  const text = describe('cpu', out);
  setMessage(text);
  pushLog(text);
  sound.play(out.result);
  render();
  flash('player', out.cell, out.result);
  if (game.winner) finish();
}

els.enemyBoard.addEventListener('click', (event) => {
  const button = event.target.closest('.cell');
  if (!button) return;
  const idx = Number(button.dataset.idx);
  focusIdx.enemy = idx;
  playerShoot(idx);
});

function finish() {
  phase = 'over';
  const won = game.winner === 'player';
  stats.played++;
  if (won) {
    stats.wins++;
    stats.bestWin = stats.bestWin ? Math.min(stats.bestWin, game.stats.playerShots) : game.stats.playerShots;
  } else {
    stats.losses++;
  }
  stats.shots += game.stats.playerShots;
  stats.hits += game.stats.playerHits;
  saveStats();
  renderStats();
  setTimeout(() => sound.play(won ? 'win' : 'lose'), 500);
  const msg = won
    ? `Vitória! Você afundou a frota inimiga em ${plural(game.stats.playerShots, 'tiro', 'tiros')}.`
    : `Derrota. O computador afundou sua frota em ${plural(game.stats.cpuShots, 'tiro', 'tiros')}. Os navios que sobraram aparecem no mar inimigo.`;
  setMessage(msg);
  pushLog(msg);
  render();
  els.newGame.focus();
}

function newGame() {
  clearTimeout(cpuTimer);
  game = null;
  phase = 'setup';
  logLines.length = 0;
  if (placed.length && !validateFleet(placed, { noTouch: config.noTouch })) placed = [];
  selected = nextUnplaced();
  preview = null;
  setMessage(placed.length ? 'Sua frota continua no lugar. Ajuste se quiser e comece a partida.' : 'Posicione sua frota.');
  els.settingsNote.textContent = '';
  render();
}

els.newGame.addEventListener('click', newGame);

/* ---------------- configurações ---------------- */

function applyConfig() {
  els.level.value = config.level;
  els.noTouch.checked = config.noTouch;
  els.sound.checked = config.sound;
  els.animations.checked = config.animations;
  document.body.classList.toggle('no-anim', !config.animations);
}

els.level.addEventListener('change', () => {
  config.level = els.level.value;
  saveConfig();
  els.settingsNote.textContent = phase === 'playing' ? 'O novo nível vale a partir da próxima partida.' : '';
});

els.noTouch.addEventListener('change', () => {
  config.noTouch = els.noTouch.checked;
  saveConfig();
  if (phase === 'setup') {
    const ok = placed.every((ship) => canPlace(placed.filter((s) => s !== ship), ship.cells, { noTouch: config.noTouch }));
    if (!ok) {
      placed = [];
      selected = FLEET[0].id;
      setMessage('Havia navios encostados, então a frota foi recolhida. Posicione de novo.');
    }
    render();
  } else {
    els.settingsNote.textContent = 'A regra de encostar vale a partir da próxima partida.';
  }
});

els.sound.addEventListener('change', () => {
  config.sound = els.sound.checked;
  sound.enabled = config.sound;
  saveConfig();
  if (config.sound) sound.ensure();
});

els.animations.addEventListener('change', () => {
  config.animations = els.animations.checked;
  saveConfig();
  applyConfig();
});

els.resetStats.addEventListener('click', () => {
  stats = emptyStats();
  saveStats();
  renderStats();
  setMessage('Estatísticas zeradas.');
});

/* ---------------- início ---------------- */

buildBoard(els.playerBoard, 'player');
buildBoard(els.enemyBoard, 'enemy');
applyConfig();
renderStats();
newGame();
