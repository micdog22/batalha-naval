/**
 * Motor da Batalha Naval, sem DOM: tabuleiro 10x10, regras de
 * posicionamento, tiros, o que cada atirador sabe do mar inimigo e as três
 * estratégias do computador (aleatória, caça e alvo, densidade de
 * probabilidade).
 *
 * Casas são índices de 0 a 99: linha * 10 + coluna. Linhas de A a J,
 * colunas de 1 a 10 (B5 = linha 1, coluna 4 = índice 14).
 */

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const ROWS = 'ABCDEFGHIJ';

export const FLEET = [
  { id: 'carrier', name: 'porta-aviões', size: 5 },
  { id: 'battleship', name: 'encouraçado', size: 4 },
  { id: 'cruiser', name: 'cruzador', size: 3 },
  { id: 'submarine', name: 'submarino', size: 3 },
  { id: 'destroyer', name: 'destróier', size: 2 },
];

export const LEVELS = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

export function cellName(idx) {
  return `${ROWS[Math.floor(idx / SIZE)]}${(idx % SIZE) + 1}`;
}

export function rowOf(idx) {
  return Math.floor(idx / SIZE);
}

export function colOf(idx) {
  return idx % SIZE;
}

/** Vizinhas ortogonais (4) ou incluindo diagonais (8), dentro do tabuleiro. */
export function neighbors(idx, diagonals = false) {
  const r = rowOf(idx);
  const c = colOf(idx);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr === 0 && dc === 0) || (!diagonals && dr !== 0 && dc !== 0)) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc);
    }
  }
  return out;
}

/** Casas de um navio com a proa em (row, col), para a direita ou para baixo. Null se sair do mar. */
export function shipCells(row, col, size, horizontal) {
  const cells = [];
  for (let k = 0; k < size; k++) {
    const r = horizontal ? row : row + k;
    const c = horizontal ? col + k : col;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    cells.push(r * SIZE + c);
  }
  return cells;
}

/** Todas as posições possíveis de um navio de cada tamanho (calculadas uma vez). */
const PLACEMENTS = new Map();
export function placementsOf(size) {
  if (!PLACEMENTS.has(size)) {
    const list = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const horizontal of size === 1 ? [true] : [true, false]) {
          const cells = shipCells(r, c, size, horizontal);
          if (cells) list.push(cells);
        }
      }
    }
    PLACEMENTS.set(size, list);
  }
  return PLACEMENTS.get(size);
}

/**
 * Um navio cabe ali? Não pode sair do mar nem sobrepor outro; com a regra
 * "sem encostar", também não pode tocar outro navio, nem na diagonal.
 */
export function canPlace(ships, cells, { noTouch = false, ignoreId = null } = {}) {
  if (!cells) return false;
  const blocked = new Set();
  for (const ship of ships) {
    if (ship.id === ignoreId) continue;
    for (const c of ship.cells) {
      blocked.add(c);
      if (noTouch) for (const n of neighbors(c, true)) blocked.add(n);
    }
  }
  return cells.every((c) => !blocked.has(c));
}

/** Confere uma frota completa: um navio de cada, retos, contínuos, sem sobrepor (nem encostar). */
export function validateFleet(ships, { noTouch = false } = {}) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  const seen = new Set();
  for (const spec of FLEET) {
    const ship = ships.find((s) => s.id === spec.id);
    if (!ship || !Array.isArray(ship.cells) || ship.cells.length !== spec.size) return false;
    const sorted = [...ship.cells].sort((a, b) => a - b);
    const horizontal = sorted.every((c) => rowOf(c) === rowOf(sorted[0]));
    const expected = shipCells(rowOf(sorted[0]), colOf(sorted[0]), spec.size, horizontal);
    if (!expected || expected.some((c, i) => c !== sorted[i])) return false;
    seen.add(spec.id);
  }
  for (const ship of ships) {
    const others = ships.filter((s) => s !== ship);
    if (!canPlace(others, ship.cells, { noTouch })) return false;
  }
  return seen.size === FLEET.length;
}

/**
 * Frota aleatória: para cada navio (do maior para o menor) lista todas as
 * posições válidas e sorteia uma, com a mesma chance para cada posição.
 * Se um navio não couber (raro, com a regra de não encostar), recomeça.
 */
export function randomFleet(rng, { noTouch = false } = {}) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const ships = [];
    let ok = true;
    for (const spec of FLEET) {
      const options = placementsOf(spec.size).filter((cells) => canPlace(ships, cells, { noTouch }));
      if (!options.length) {
        ok = false;
        break;
      }
      const cells = options[Math.floor(rng() * options.length)];
      ships.push({ ...spec, cells: [...cells] });
    }
    if (ok) return ships;
  }
  throw new Error('Não foi possível posicionar a frota.');
}

/* ------------------------------------------------------------------ */
/* Tabuleiro e tiros                                                   */
/* ------------------------------------------------------------------ */

export class Board {
  constructor(ships) {
    this.ships = ships.map((s) => ({ id: s.id, name: s.name, size: s.size, cells: [...s.cells], hits: 0 }));
    this.owner = new Map();
    this.ships.forEach((ship, i) => ship.cells.forEach((c) => this.owner.set(c, i)));
    this.shots = new Map(); // casa -> 'miss' | 'hit' | 'sunk'
  }

  /**
   * Atira numa casa. Resultado: 'miss' (água), 'hit' (acertou), 'sunk'
   * (afundou, com o navio e as casas dele) ou 'repeated' (casa já atirada,
   * não conta como tiro).
   */
  fire(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS) throw new Error(`Casa inválida: ${idx}`);
    if (this.shots.has(idx)) return { cell: idx, result: 'repeated' };
    const i = this.owner.get(idx);
    if (i === undefined) {
      this.shots.set(idx, 'miss');
      return { cell: idx, result: 'miss' };
    }
    const ship = this.ships[i];
    ship.hits++;
    this.shots.set(idx, 'hit');
    if (ship.hits < ship.size) return { cell: idx, result: 'hit', ship: { id: ship.id, name: ship.name } };
    for (const c of ship.cells) this.shots.set(c, 'sunk');
    return {
      cell: idx,
      result: 'sunk',
      ship: { id: ship.id, name: ship.name, size: ship.size },
      sunkCells: [...ship.cells],
      gameOver: this.allSunk(),
    };
  }

  allSunk() {
    return this.ships.every((s) => s.hits === s.size);
  }

  shipAt(idx) {
    const i = this.owner.get(idx);
    return i === undefined ? null : this.ships[i];
  }

  get shotCount() {
    return this.shots.size;
  }
}

/* ------------------------------------------------------------------ */
/* O que o atirador sabe                                               */
/* ------------------------------------------------------------------ */

export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;
export const SUNK = 3;

/**
 * Visão do mar inimigo para quem atira: água, acerto, navio afundado e,
 * com a regra de não encostar, casas descartadas (vizinhas de navio afundado
 * e diagonais de um acerto, onde nenhum navio pode estar).
 */
export class Knowledge {
  constructor({ noTouch = false } = {}) {
    this.noTouch = noTouch;
    this.grid = new Uint8Array(CELLS);
    this.excluded = new Uint8Array(CELLS);
    this.remaining = FLEET.map((s) => ({ id: s.id, size: s.size }));
  }

  record(outcome) {
    const { cell, result } = outcome;
    if (result === 'miss') this.grid[cell] = MISS;
    else if (result === 'hit') {
      this.grid[cell] = HIT;
      if (this.noTouch) {
        for (const n of neighbors(cell, true)) {
          if (rowOf(n) !== rowOf(cell) && colOf(n) !== colOf(cell)) this.excluded[n] = 1;
        }
      }
    } else if (result === 'sunk') {
      for (const c of outcome.sunkCells) this.grid[c] = SUNK;
      const i = this.remaining.findIndex((s) => s.id === outcome.ship.id);
      if (i >= 0) this.remaining.splice(i, 1);
      if (this.noTouch) for (const c of outcome.sunkCells) for (const n of neighbors(c, true)) this.excluded[n] = 1;
    }
  }

  /** Casa ainda não atirada. */
  untried(idx) {
    return this.grid[idx] === UNKNOWN;
  }

  /** Casa ainda não atirada e que pode ter navio. */
  open(idx) {
    return this.grid[idx] === UNKNOWN && !this.excluded[idx];
  }

  openCells() {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (this.open(i)) out.push(i);
    return out;
  }

  unsunkHits() {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (this.grid[i] === HIT) out.push(i);
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Estratégias do computador                                           */
/* ------------------------------------------------------------------ */

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/** Fácil: qualquer casa ainda não atirada, ao acaso. */
export function easyShot(knowledge, rng) {
  const options = [];
  for (let i = 0; i < CELLS; i++) if (knowledge.untried(i)) options.push(i);
  return pick(options, rng);
}

/**
 * Médio, "caça e alvo": sem acertos pendentes, atira ao acaso (caça).
 * Depois de um acerto, tenta as vizinhas ortogonais (alvo), dando
 * preferência a continuar uma linha de dois ou mais acertos.
 */
export function mediumShot(knowledge, rng) {
  const hits = knowledge.unsunkHits();
  if (hits.length) {
    const score = new Map();
    for (const h of hits) {
      const r = rowOf(h);
      const c = colOf(h);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        const n = nr * SIZE + nc;
        if (!knowledge.open(n)) continue;
        const br = r - dr;
        const bc = c - dc;
        const inLine = br >= 0 && br < SIZE && bc >= 0 && bc < SIZE && knowledge.grid[br * SIZE + bc] === HIT;
        score.set(n, Math.max(score.get(n) || 0, inLine ? 2 : 1));
      }
    }
    if (score.size) {
      const best = Math.max(...score.values());
      return pick([...score].filter(([, s]) => s === best).map(([cell]) => cell), rng);
    }
  }
  const options = knowledge.openCells();
  return options.length ? pick(options, rng) : easyShot(knowledge, rng);
}

const HIT_WEIGHT = 30;

/**
 * Mapa de densidade de probabilidade: para cada navio que ainda flutua,
 * percorre todas as posições possíveis e descarta as que passam por água,
 * por navio afundado ou por casa descartada (e, sem encostar, as que tocam
 * um acerto que não cobrem). Cada posição válida soma peso nas casas
 * desconhecidas que ocupa. Com acertos pendentes, só contam as posições que
 * passam por eles, com peso que cresce a cada acerto coberto.
 */
export function densityMap(knowledge, { requireHits = true } = {}) {
  const density = new Float64Array(CELLS);
  const { grid, excluded } = knowledge;
  const hits = knowledge.unsunkHits();
  const hitHalo = new Map();
  if (knowledge.noTouch) for (const h of hits) hitHalo.set(h, new Set(neighbors(h, true)));
  const focus = requireHits && hits.length > 0;
  for (const ship of knowledge.remaining) {
    for (const cells of placementsOf(ship.size)) {
      let covered = 0;
      let valid = true;
      for (const c of cells) {
        const g = grid[c];
        if (g === MISS || g === SUNK || (g === UNKNOWN && excluded[c])) {
          valid = false;
          break;
        }
        if (g === HIT) covered++;
      }
      if (!valid || (focus && covered === 0)) continue;
      if (knowledge.noTouch && hits.length) {
        const mine = new Set(cells);
        for (const h of hits) {
          if (mine.has(h)) continue;
          if (cells.some((c) => hitHalo.get(h).has(c))) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;
      }
      const weight = covered ? HIT_WEIGHT ** covered : 1;
      for (const c of cells) if (grid[c] === UNKNOWN) density[c] += weight;
    }
  }
  return density;
}

/** Difícil: atira na casa de maior densidade (empates resolvidos ao acaso). */
export function hardShot(knowledge, rng) {
  let density = densityMap(knowledge);
  let best = 0;
  for (let i = 0; i < CELLS; i++) if (knowledge.open(i) && density[i] > best) best = density[i];
  if (best === 0) {
    density = densityMap(knowledge, { requireHits: false });
    for (let i = 0; i < CELLS; i++) if (knowledge.open(i) && density[i] > best) best = density[i];
  }
  if (best === 0) return mediumShot(knowledge, rng);
  const options = [];
  for (let i = 0; i < CELLS; i++) if (knowledge.open(i) && density[i] === best) options.push(i);
  return pick(options, rng);
}

export function chooseShot(level, knowledge, rng) {
  if (level === 'easy') return easyShot(knowledge, rng);
  if (level === 'medium') return mediumShot(knowledge, rng);
  return hardShot(knowledge, rng);
}

/* ------------------------------------------------------------------ */
/* Partida                                                             */
/* ------------------------------------------------------------------ */

export class Game {
  constructor({ playerShips, cpuShips, level = 'medium', noTouch = false, rng = Math.random }) {
    this.level = level;
    this.noTouch = noTouch;
    this.rng = rng;
    this.playerBoard = new Board(playerShips); // onde o computador atira
    this.cpuBoard = new Board(cpuShips); // onde você atira
    this.cpuKnowledge = new Knowledge({ noTouch });
    this.turn = 'player';
    this.winner = null;
    this.stats = { playerShots: 0, playerHits: 0, cpuShots: 0, cpuHits: 0 };
  }

  playerFire(idx) {
    if (this.winner || this.turn !== 'player') throw new Error('Não é a sua vez.');
    const outcome = this.cpuBoard.fire(idx);
    if (outcome.result === 'repeated') return outcome;
    this.stats.playerShots++;
    if (outcome.result !== 'miss') this.stats.playerHits++;
    if (this.cpuBoard.allSunk()) this.winner = 'player';
    else this.turn = 'cpu';
    return outcome;
  }

  cpuFire() {
    if (this.winner || this.turn !== 'cpu') throw new Error('Não é a vez do computador.');
    const idx = chooseShot(this.level, this.cpuKnowledge, this.rng);
    const outcome = this.playerBoard.fire(idx);
    if (outcome.result === 'repeated') throw new Error('O computador repetiu um tiro.');
    this.cpuKnowledge.record(outcome);
    this.stats.cpuShots++;
    if (outcome.result !== 'miss') this.stats.cpuHits++;
    if (this.playerBoard.allSunk()) this.winner = 'cpu';
    else this.turn = 'player';
    return outcome;
  }
}

/**
 * Joga uma partida "solo" da estratégia contra uma frota aleatória e devolve
 * quantos tiros foram precisos para afundar tudo. Usada para comparar os
 * níveis.
 */
export function shotsToWin(level, rng, { noTouch = false } = {}) {
  const board = new Board(randomFleet(rng, { noTouch }));
  const knowledge = new Knowledge({ noTouch });
  const fired = new Set();
  while (!board.allSunk()) {
    const idx = chooseShot(level, knowledge, rng);
    if (fired.has(idx)) throw new Error(`Tiro repetido em ${cellName(idx)}`);
    fired.add(idx);
    knowledge.record(board.fire(idx));
    if (fired.size > CELLS) throw new Error('Partida sem fim.');
  }
  return fired.size;
}

/** Gerador com semente (mulberry32) para simulações reproduzíveis. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteio de verdade para o jogo: crypto.getRandomValues. */
export function secureRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}
