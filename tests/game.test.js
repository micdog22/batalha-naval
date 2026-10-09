import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE, CELLS, FLEET, cellName, neighbors, shipCells, placementsOf, canPlace, validateFleet, randomFleet,
  Board, Knowledge, UNKNOWN, MISS, HIT, SUNK, easyShot, mediumShot, hardShot, densityMap, chooseShot,
  Game, shotsToWin, seededRandom,
} from '../src/game.js';

const at = (name) => {
  const row = 'ABCDEFGHIJ'.indexOf(name[0]);
  return row * SIZE + Number(name.slice(1)) - 1;
};

test('coordenadas e vizinhança', () => {
  assert.equal(cellName(0), 'A1');
  assert.equal(cellName(14), 'B5');
  assert.equal(cellName(99), 'J10');
  assert.equal(at('B5'), 14);
  assert.deepEqual(neighbors(0).sort((a, b) => a - b), [1, 10]);
  assert.deepEqual(neighbors(0, true).sort((a, b) => a - b), [1, 10, 11]);
  assert.equal(neighbors(at('E5'), true).length, 8);
  assert.equal(neighbors(at('E5')).length, 4);
});

test('posições de navio: dentro do mar e em linha reta', () => {
  assert.deepEqual(shipCells(0, 0, 3, true), [0, 1, 2]);
  assert.deepEqual(shipCells(0, 0, 3, false), [0, 10, 20]);
  assert.equal(shipCells(0, 8, 3, true), null, 'sai pela direita');
  assert.equal(shipCells(8, 0, 3, false), null, 'sai por baixo');
  // Número de posições de um navio de tamanho k: 2 * 10 * (10 - k + 1).
  for (const k of [2, 3, 4, 5]) assert.equal(placementsOf(k).length, 2 * SIZE * (SIZE - k + 1));
});

test('regras de posicionamento: sobrepor e encostar', () => {
  const ships = [{ id: 'cruiser', cells: [at('C3'), at('C4'), at('C5')] }];
  assert.equal(canPlace(ships, [at('C5'), at('D5')]), false, 'sobrepõe');
  assert.equal(canPlace(ships, [at('D3'), at('D4')]), true, 'encostar é permitido por padrão');
  assert.equal(canPlace(ships, [at('D3'), at('D4')], { noTouch: true }), false, 'encosta de lado');
  assert.equal(canPlace(ships, [at('D6'), at('E6')], { noTouch: true }), false, 'encosta na diagonal');
  assert.equal(canPlace(ships, [at('E6'), at('F6')], { noTouch: true }), true);
  assert.equal(canPlace(ships, null), false);
  assert.equal(canPlace(ships, [at('C3'), at('C4')], { ignoreId: 'cruiser' }), true, 'ignora o próprio navio ao mover');
});

test('validação da frota', () => {
  const fleet = [
    { id: 'carrier', cells: [at('A1'), at('A2'), at('A3'), at('A4'), at('A5')] },
    { id: 'battleship', cells: [at('C1'), at('D1'), at('E1'), at('F1')] },
    { id: 'cruiser', cells: [at('C3'), at('C4'), at('C5')] },
    { id: 'submarine', cells: [at('H8'), at('I8'), at('J8')] },
    { id: 'destroyer', cells: [at('J1'), at('J2')] },
  ];
  assert.equal(validateFleet(fleet), true);
  assert.equal(validateFleet(fleet, { noTouch: true }), true);
  const touching = fleet.map((s) => (s.id === 'destroyer' ? { ...s, cells: [at('B6'), at('B7')] } : s));
  assert.equal(validateFleet(touching), true);
  assert.equal(validateFleet(touching, { noTouch: true }), false, 'B6 encosta em A5 na diagonal');
  const bent = fleet.map((s) => (s.id === 'cruiser' ? { ...s, cells: [at('C3'), at('C4'), at('D4')] } : s));
  assert.equal(validateFleet(bent), false, 'navio torto');
  const gap = fleet.map((s) => (s.id === 'cruiser' ? { ...s, cells: [at('C3'), at('C4'), at('C6')] } : s));
  assert.equal(validateFleet(gap), false, 'navio com buraco');
  const wrap = fleet.map((s) => (s.id === 'destroyer' ? { ...s, cells: [at('E10'), at('F1')] } : s));
  assert.equal(validateFleet(wrap), false, 'não pode dar a volta no tabuleiro');
  const overlap = fleet.map((s) => (s.id === 'destroyer' ? { ...s, cells: [at('A5'), at('A6')] } : s));
  assert.equal(validateFleet(overlap), false);
  assert.equal(validateFleet(fleet.slice(1)), false, 'falta navio');
});

test('frota aleatória é sempre válida, nas duas regras', () => {
  const rng = seededRandom(11);
  for (let i = 0; i < 400; i++) {
    const noTouch = i % 2 === 1;
    const ships = randomFleet(rng, { noTouch });
    assert.equal(validateFleet(ships, { noTouch }), true);
    assert.deepEqual(ships.map((s) => s.id), FLEET.map((s) => s.id));
  }
});

test('tiros: água, acertou, afundou e tiro repetido', () => {
  const board = new Board([
    { id: 'destroyer', name: 'destróier', size: 2, cells: [at('B2'), at('B3')] },
    { id: 'cruiser', name: 'cruzador', size: 3, cells: [at('E5'), at('F5'), at('G5')] },
  ]);
  assert.deepEqual(board.fire(at('A1')), { cell: at('A1'), result: 'miss' });
  assert.deepEqual(board.fire(at('A1')), { cell: at('A1'), result: 'repeated' });
  assert.equal(board.shotCount, 1, 'repetido não conta');
  assert.equal(board.fire(at('B2')).result, 'hit');
  const sunk = board.fire(at('B3'));
  assert.equal(sunk.result, 'sunk');
  assert.equal(sunk.ship.name, 'destróier');
  assert.deepEqual(sunk.sunkCells, [at('B2'), at('B3')]);
  assert.equal(sunk.gameOver, false);
  assert.equal(board.shots.get(at('B2')), 'sunk');
  board.fire(at('E5'));
  board.fire(at('F5'));
  const last = board.fire(at('G5'));
  assert.equal(last.result, 'sunk');
  assert.equal(last.gameOver, true);
  assert.equal(board.allSunk(), true);
  assert.throws(() => board.fire(100), /inválida/);
  assert.throws(() => board.fire(-1), /inválida/);
});

test('conhecimento do atirador e casas descartadas sem encostar', () => {
  const k = new Knowledge({ noTouch: true });
  k.record({ cell: at('E5'), result: 'hit' });
  assert.equal(k.grid[at('E5')], HIT);
  for (const d of ['D4', 'D6', 'F4', 'F6']) assert.equal(k.open(at(d)), false, `${d} é diagonal de um acerto`);
  for (const d of ['D5', 'F5', 'E4', 'E6']) assert.equal(k.open(at(d)), true);
  k.record({ cell: at('E6'), result: 'sunk', ship: { id: 'destroyer', size: 2 }, sunkCells: [at('E5'), at('E6')] });
  assert.equal(k.remaining.length, 4);
  assert.ok(!k.remaining.some((s) => s.id === 'destroyer'));
  for (const d of ['D4', 'D5', 'D6', 'D7', 'E4', 'E7', 'F4', 'F5', 'F6', 'F7']) assert.equal(k.open(at(d)), false, `${d} encosta no navio afundado`);
  assert.equal(k.grid[at('E5')], SUNK);
  const free = new Knowledge({ noTouch: false });
  free.record({ cell: at('E5'), result: 'hit' });
  assert.equal(free.open(at('D4')), true, 'sem a regra, a diagonal continua possível');
  free.record({ cell: at('A1'), result: 'miss' });
  assert.equal(free.grid[at('A1')], MISS);
  assert.equal(free.grid[at('B1')], UNKNOWN);
});

test('médio: depois de um acerto, mira nas vizinhas e segue a linha', () => {
  const rng = seededRandom(3);
  const k = new Knowledge();
  k.record({ cell: at('E5'), result: 'hit' });
  for (let i = 0; i < 50; i++) {
    const shot = mediumShot(k, rng);
    assert.ok(['D5', 'F5', 'E4', 'E6'].map(at).includes(shot), cellName(shot));
  }
  k.record({ cell: at('E6'), result: 'hit' });
  for (let i = 0; i < 50; i++) {
    const shot = mediumShot(k, rng);
    assert.ok(['E4', 'E7'].map(at).includes(shot), `continua a linha: ${cellName(shot)}`);
  }
});

test('densidade: só mira em casas válidas e zera onde nenhum navio cabe', () => {
  const k = new Knowledge();
  // Só sobra o destróier. A casa E5 cercada de água nos quatro lados não comporta navio nenhum.
  k.remaining = [{ id: 'destroyer', size: 2 }];
  for (const d of ['D5', 'F5', 'E4', 'E6']) k.record({ cell: at(d), result: 'miss' });
  const density = densityMap(k);
  assert.equal(density[at('E5')], 0);
  for (const d of ['D5', 'F5', 'E4', 'E6']) assert.equal(density[at(d)], 0, 'casa atirada não recebe peso');
  assert.ok(density[at('A1')] > 0);
  // Canto A1: só 2 posições do destróier (A1-A2 e A1-B1); casa do meio: 4.
  assert.equal(densityMap(new Knowledge())[at('A1')] > 0, true);
  const only2 = new Knowledge();
  only2.remaining = [{ id: 'destroyer', size: 2 }];
  const d2 = densityMap(only2);
  assert.equal(d2[at('A1')], 2);
  assert.equal(d2[at('E5')], 4);
  // Com acerto pendente, só contam as posições que passam por ele.
  const target = new Knowledge();
  target.remaining = [{ id: 'cruiser', size: 3 }];
  target.record({ cell: at('E5'), result: 'hit' });
  const dt = densityMap(target);
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const nearLine = (r === 4 && Math.abs(c - 4) <= 2) || (c === 4 && Math.abs(r - 4) <= 2);
    if (!nearLine) assert.equal(dt[i], 0, `${cellName(i)} não alcança o acerto`);
  }
  assert.ok(dt[at('E4')] > 0 && dt[at('E6')] > 0 && dt[at('D5')] > 0 && dt[at('F5')] > 0);
});

test('difícil: em partidas inteiras, todo tiro é numa casa aberta e com densidade', () => {
  const rng = seededRandom(77);
  for (const noTouch of [false, true]) {
    for (let g = 0; g < 25; g++) {
      const board = new Board(randomFleet(rng, { noTouch }));
      const k = new Knowledge({ noTouch });
      while (!board.allSunk()) {
        const density = densityMap(k);
        const anyFocused = [...density].some((v, i) => v > 0 && k.open(i));
        const shot = hardShot(k, rng);
        assert.equal(k.open(shot), true, `${cellName(shot)} não estava aberta`);
        if (anyFocused) assert.ok(density[shot] > 0, 'escolheu casa sem densidade');
        // Toda casa escolhida tem a maior densidade entre as abertas.
        if (anyFocused) {
          for (let i = 0; i < CELLS; i++) if (k.open(i)) assert.ok(density[i] <= density[shot]);
        }
        const out = board.fire(shot);
        assert.notEqual(out.result, 'repeated');
        k.record(out);
      }
    }
  }
});

test('nenhum nível repete tiro e todos terminam em até 100 tiros', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const rng = seededRandom(5);
    for (let i = 0; i < 40; i++) {
      const shots = shotsToWin(level, rng, { noTouch: i % 2 === 0 });
      assert.ok(shots >= 17 && shots <= 100, `${level}: ${shots}`);
    }
  }
  // O fácil, se continuar atirando, cobre o mar inteiro sem repetir.
  const k = new Knowledge();
  const rng = seededRandom(9);
  const seen = new Set();
  for (let i = 0; i < CELLS; i++) {
    const shot = easyShot(k, rng);
    assert.ok(!seen.has(shot));
    seen.add(shot);
    k.record({ cell: shot, result: 'miss' });
  }
  assert.equal(seen.size, CELLS);
});

test('com semente fixa, o difícil vence em menos tiros que o médio, que vence o fácil', () => {
  const games = 150;
  for (const noTouch of [false, true]) {
    const average = {};
    for (const level of ['easy', 'medium', 'hard']) {
      const rng = seededRandom(2026);
      let total = 0;
      for (let i = 0; i < games; i++) total += shotsToWin(level, rng, { noTouch });
      average[level] = total / games;
    }
    assert.ok(average.hard < average.medium, `difícil ${average.hard.toFixed(1)} x médio ${average.medium.toFixed(1)}`);
    assert.ok(average.medium < average.easy, `médio ${average.medium.toFixed(1)} x fácil ${average.easy.toFixed(1)}`);
    assert.ok(average.hard < 50, `difícil abaixo de 50 tiros em média (${average.hard.toFixed(1)})`);
    assert.ok(average.easy > 85, 'o fácil precisa de quase o mar inteiro');
  }
});

test('partida: turnos, vencedor e tiros contabilizados', () => {
  const rng = seededRandom(12);
  const game = new Game({ playerShips: randomFleet(rng), cpuShips: randomFleet(rng), level: 'hard', rng });
  assert.equal(game.turn, 'player');
  assert.throws(() => game.cpuFire(), /vez/);
  const order = [];
  for (let i = 0; i < CELLS; i++) order.push(i);
  let next = 0;
  while (!game.winner) {
    if (game.turn === 'player') {
      const out = game.playerFire(order[next++]);
      assert.notEqual(out.result, 'repeated');
    } else {
      game.cpuFire();
    }
  }
  assert.ok(['player', 'cpu'].includes(game.winner));
  assert.throws(() => game.playerFire(0), /vez/);
  assert.equal(game.stats.playerShots, game.cpuBoard.shotCount);
  assert.equal(game.stats.cpuShots, game.playerBoard.shotCount);
  const loserBoard = game.winner === 'player' ? game.cpuBoard : game.playerBoard;
  assert.equal(loserBoard.allSunk(), true);
  assert.equal(chooseShot('unknown-level-falls-back-to-hard', new Knowledge(), rng) >= 0, true);
});
