import { type ClientMessage, PLAYER_COLORS, PROTOCOL_VERSION, type RaceState, type ServerMessage, isSolid, parseClientMessage } from '@cursar/game-core';
import { describe, expect, it } from 'vitest';
import { type Member, Room } from '../src/room';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** A pretend player: records everything the room sends it. */
class Client {
  inbox: ServerMessage[] = [];
  member: Member | null;
  closed = false;
  constructor(
    private room: Room,
    name: string,
    token?: string,
    color = PLAYER_COLORS[0]!,
  ) {
    this.member = room.join((m) => this.inbox.push(JSON.parse(JSON.stringify(m)) as ServerMessage), { t: 'hello', v: PROTOCOL_VERSION, name, color, token }, () => (this.closed = true));
  }
  send(message: ClientMessage) {
    this.room.receive(this.member!, message);
  }
  last<T extends ServerMessage['t']>(t: T): Of<T> {
    const found = [...this.inbox].reverse().find((m) => m.t === t);
    if (!found) throw new Error(`no ${t} message received`);
    return found as Of<T>;
  }
  count(t: ServerMessage['t']) {
    return this.inbox.filter((m) => m.t === t).length;
  }
  get id() {
    return this.last('welcome').id;
  }
}

function setup(names = ['Ana', 'Ben']) {
  let n = 0;
  const clock = { now: 0 };
  const room = new Room({ randomId: () => `id${++n}-padding`, now: () => clock.now, addresses: ['192.168.1.20'] });
  const clients = names.map((name) => new Client(room, name));
  // A fixed seed, so every run of the tests races on the same maps.
  clients[0]!.send({ t: 'settings', settings: { seed: 'fixture' } });
  return { room, clients, clock };
}

/** A direction in which the runner has at least three open tiles ahead. */
function openDirection(state: RaceState, p: { x: number; y: number }): { mx: number; my: number } {
  for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if ([1, 2, 3].every((n) => !isSolid(state.map, Math.floor(p.x + mx * n), Math.floor(p.y + my * n)))) return { mx, my };
  }
  throw new Error('runner is boxed in');
}

function ticks(room: Room, count: number) {
  for (let i = 0; i < count; i++) room.tick();
}

/** Starts a race and runs it to the racing phase. */
function startRacing(names?: string[]) {
  const ctx = setup(names);
  ctx.clients[0]!.send({ t: 'start' });
  for (const c of ctx.clients) c.send({ t: 'ready' });
  while (ctx.room.raceState!.phase !== 'racing') ctx.room.tick();
  return ctx;
}

describe('lobby', () => {
  it('makes the first player host and gives everyone a different colour', () => {
    const { clients } = setup(['Ana', 'Ben', 'Cy']);
    const room = clients[2]!.last('room').room;
    expect(room.stage).toBe('lobby');
    expect(room.hostId).toBe(clients[0]!.id);
    expect(room.players.map((p) => p.name)).toEqual(['Ana', 'Ben', 'Cy']);
    expect(new Set(room.players.map((p) => p.color)).size).toBe(3);
    expect(clients[0]!.last('welcome').addresses).toEqual(['192.168.1.20']);
    expect(clients[0]!.last('welcome').room).toBe('');
  });

  it('lets only the host change settings and start', () => {
    const { clients, room } = setup();
    clients[1]!.send({ t: 'settings', settings: { size: 'large' } });
    clients[1]!.send({ t: 'start' });
    expect(room.info().settings.size).toBe('small');
    expect(room.info().stage).toBe('lobby');
    clients[0]!.send({ t: 'settings', settings: { size: 'medium', races: 5 } });
    expect(clients[1]!.last('room').room.settings).toMatchObject({ size: 'medium', races: 5 });
  });

  it('refuses a ninth player and an out-of-date client', () => {
    const { room } = setup(['1', '2', '3', '4', '5', '6', '7', '8']);
    const extra = new Client(room, 'Nine');
    expect(extra.member).toBeNull();
    expect(extra.last('error').message).toMatch(/full/);
    const inbox: ServerMessage[] = [];
    expect(new Room().join((m) => inbox.push(m), { t: 'hello', v: 999, name: 'x', color: 0 })).toBeNull();
    expect(inbox[0]).toMatchObject({ t: 'error' });
  });

  it('passes the host on when the host leaves', () => {
    const { clients, room } = setup();
    room.leave(clients[0]!.member!);
    expect(clients[1]!.last('room').room.hostId).toBe(clients[1]!.id);
  });

  it('gives the host role back to a host who reconnects', () => {
    const { clients, room } = setup(['Ana', 'Ben']);
    const [ana, ben] = clients as [Client, Client];
    room.leave(ana.member!);
    expect(ben.last('room').room.hostId).toBe(ben.id);
    const back = new Client(room, 'Ana', ana.last('welcome').token);
    expect(back.last('room').room.hostId).toBe(ana.id);
  });

  it('lets a player change name and colour, but not to a taken colour', () => {
    const { clients } = setup();
    const benColor = clients[1]!.last('room').room.players[1]!.color;
    clients[0]!.send({ t: 'profile', name: 'Anabel', color: benColor });
    const me = clients[0]!.last('room').room.players[0]!;
    expect(me.name).toBe('Anabel');
    expect(me.color).not.toBe(benColor);
  });
});

describe('messages', () => {
  it('drops malformed input and cleans what it accepts', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('[1,2]')).toBeNull();
    expect(parseClientMessage('{"t":"teleport","x":1}')).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":1,"mx":"left","my":0}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 4, mx: 50, my: -9, sprint: 'yes' }))).toEqual({ t: 'input', seq: 4, mx: 1, my: -1, sprint: false });
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 1, color: 1, name: '  <b>Zed</b>   the\tvery very long name ' }))).toMatchObject({ name: 'bZed/b the very' });
    expect(parseClientMessage(JSON.stringify({ t: 'settings', settings: { size: 'huge', races: 400, seed: 'ok seed!' } }))).toEqual({ t: 'settings', settings: { races: 9, seed: 'ok seed' } });
    expect(parseClientMessage('x'.repeat(3000))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 1, color: 1, name: 'A', room: ' bcdf ' }))).toMatchObject({ room: 'BCDF' });
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 1, color: 1, name: 'A', room: 'ABCD' }))).toMatchObject({ room: '' });
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 1, color: 1, name: 'A' }))).toMatchObject({ room: undefined });
  });
});

describe('race', () => {
  it('starts everyone on the same map at different start positions', () => {
    const { clients } = setup();
    clients[0]!.send({ t: 'start' });
    const a = clients[0]!.last('race');
    const b = clients[1]!.last('race');
    expect(a.seed).toBe(b.seed);
    expect(a.slot).not.toBe(b.slot);
    expect(a.runners.map((r) => r.name)).toEqual(['Ana', 'Ben']);
    expect(clients[0]!.last('room').room.stage).toBe('race');
  });

  it('waits for everyone to be ready before cutting the preview short', () => {
    const { clients, room } = setup();
    clients[0]!.send({ t: 'start' });
    clients[0]!.send({ t: 'ready' });
    ticks(room, 30);
    expect(room.raceState!.phase).toBe('preview');
    expect(clients[1]!.last('snap').readyCount).toBe(1);
    clients[1]!.send({ t: 'ready' });
    ticks(room, 2);
    expect(room.raceState!.phase).toBe('countdown');
    expect(clients[1]!.inbox.some((m) => m.t === 'snap' && m.events.some((e) => e.type === 'countdown'))).toBe(true);
  });

  it('moves a runner from its inputs and acknowledges them', () => {
    const { clients, room } = startRacing();
    const before = clients[0]!.last('snap').you;
    for (let seq = 1; seq <= 30; seq++) {
      clients[0]!.send({ t: 'input', seq, mx: 0, my: 0, sprint: false });
      room.tick();
    }
    const state = room.raceState!;
    const p = state.players[0]!;
    expect(p).toMatchObject({ x: before.x, y: before.y, lastInputSeq: 30 });
    expect(clients[0]!.last('snap').you.lastInputSeq).toBeGreaterThanOrEqual(28);
    const dir = openDirection(state, p);
    for (let seq = 31; seq <= 60; seq++) {
      clients[0]!.send({ t: 'input', seq, ...dir, sprint: false });
      room.tick();
    }
    expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeGreaterThan(1.5);
    // The other runner did not move.
    expect(state.players[1]!.vx).toBe(0);
  });

  it('stops a runner whose page stops sending inputs', () => {
    const { clients, room } = startRacing();
    const state = room.raceState!;
    const p = state.players[0]!;
    const dir = openDirection(state, p);
    clients[0]!.send({ t: 'input', seq: 1, ...dir, sprint: false });
    ticks(room, 10);
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(1);
    ticks(room, 30);
    expect(Math.hypot(p.vx, p.vy)).toBe(0);
    expect(p.lastInputSeq).toBe(1);
  });

  it('ignores replayed or flooding inputs', () => {
    const { clients, room } = startRacing();
    for (let seq = 1; seq <= 100; seq++) clients[0]!.send({ t: 'input', seq, mx: 1, my: 0, sprint: false });
    clients[0]!.send({ t: 'input', seq: 5, mx: -1, my: 0, sprint: false });
    expect(clients[0]!.member!.queue.length).toBeLessThanOrEqual(12);
    ticks(room, 60);
    expect(room.raceState!.players[0]!.lastInputSeq).toBe(100);
  });

  it('only tells a runner about rivals inside their view', () => {
    const { clients, room } = startRacing();
    const state = room.raceState!;
    ticks(room, 3);
    expect(clients[0]!.last('snap').rivals.map((r) => r.id)).toEqual([clients[1]!.id]);
    // Move the rival to the far side of the map, behind many walls.
    const far = state.map.finish;
    state.players[1]!.x = far.x + 0.5;
    state.players[1]!.y = far.y + 0.5;
    ticks(room, 3);
    expect(clients[0]!.last('snap').rivals).toEqual([]);
    expect(clients[0]!.last('snap').prints).toEqual([]);
    expect(JSON.stringify(clients[0]!.last('snap'))).not.toContain(String(far.x + 0.5));
  });

  it('keeps waypoints private to the runner who placed them', () => {
    const { clients, room } = setup();
    clients[0]!.send({ t: 'start' });
    const start = room.raceState!.map.startPositions[0]!;
    clients[0]!.send({ t: 'marker', x: start.x, y: start.y });
    ticks(room, 3);
    expect(clients[0]!.last('snap').you.markers).toHaveLength(1);
    expect(clients[1]!.last('snap').you.markers).toHaveLength(0);
    expect(JSON.stringify(clients[1]!.last('snap'))).not.toContain('reached');
  });

  it('lets nearby runners hear a footstep without revealing where it was', () => {
    const { clients, room } = startRacing();
    const p = room.raceState!.players[0]!;
    const dir = openDirection(room.raceState!, p);
    for (let seq = 1; seq <= 40; seq++) {
      clients[0]!.send({ t: 'input', seq, ...dir, sprint: false });
      room.tick();
    }
    const heard = clients[1]!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).filter((e) => e.type === 'rivalStep');
    expect(heard.length).toBeGreaterThan(0);
    expect(Object.keys(heard[0]!).sort()).toEqual(['closeness', 'pan', 'type']);
    // A runner does not get their own footsteps back: the client plays those itself.
    expect(clients[0]!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).some((e) => e.type === 'rivalStep')).toBe(false);
  });

  it('gives the rest 30 seconds once someone finishes, then scores the race', () => {
    const { clients, room } = startRacing();
    const state = room.raceState!;
    const winner = state.players[1]!;
    winner.checkpoints = winner.checkpoints.map(() => true);
    winner.x = state.map.finish.x + 0.5;
    winner.y = state.map.finish.y + 0.5;
    ticks(room, 3);
    const finish = clients[0]!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).find((e) => e.type === 'finish');
    expect(finish).toMatchObject({ playerId: clients[1]!.id, place: 1 });
    expect(clients[0]!.last('snap').deadline).toBeCloseTo(state.raceTime + 30, 0);
    // A finished runner watches the rest of the race and sees everyone.
    expect(clients[1]!.last('snap').rivals).toHaveLength(1);

    ticks(room, 31 * 60);
    const results = clients[0]!.last('results');
    expect(results.rows.map((r) => [r.name, r.place, r.pointsGained])).toEqual([['Ben', 1, 10], ['Ana', null, 0]]);
    expect(results).toMatchObject({ raceNumber: 1, racesTotal: 3, seriesOver: false });
    expect(results.rows[0]!.track.length).toBeGreaterThan(0);
    const info = clients[0]!.last('room').room;
    expect(info.stage).toBe('results');
    expect(info.players.find((p) => p.name === 'Ben')!.points).toBe(10);
    expect(room.raceState).toBeNull();
  });

  it('runs a series: new map each race, points add up, then a fresh series', () => {
    const { clients, room } = setup(['Solo']);
    const host = clients[0]!;
    host.send({ t: 'settings', settings: { races: 2, seed: 'cup' } });
    const seeds: string[] = [];
    for (let race = 0; race < 2; race++) {
      host.send({ t: 'start' });
      seeds.push(host.last('race').seed);
      host.send({ t: 'ready' });
      while (room.raceState!.phase !== 'racing') room.tick();
      const p = room.raceState!.players[0]!;
      p.checkpoints = p.checkpoints.map(() => true);
      p.x = room.raceState!.map.finish.x + 0.5;
      p.y = room.raceState!.map.finish.y + 0.5;
      ticks(room, 2);
    }
    expect(seeds).toEqual(['cup-1', 'cup-2']);
    expect(host.last('results')).toMatchObject({ raceNumber: 2, seriesOver: true });
    expect(host.last('results').rows[0]!.pointsTotal).toBe(20);
    host.send({ t: 'start' });
    expect(host.last('race').raceNumber).toBe(1);
    expect(host.last('room').room.players[0]!.points).toBe(0);
  });

  it('lets a dropped player rejoin the race in progress', () => {
    const { clients, room } = startRacing();
    const ben = clients[1]!;
    const token = ben.last('welcome').token;
    room.leave(ben.member!);
    expect(clients[0]!.last('room').room.players[1]!.connected).toBe(false);
    ticks(room, 120);
    const back = new Client(room, 'Ben', token);
    expect(back.id).toBe(ben.id);
    expect(back.last('race').seed).toBe(clients[0]!.last('race').seed);
    ticks(room, 3);
    expect(back.last('snap').phase).toBe('racing');
    expect(clients[0]!.last('room').room.players).toHaveLength(2);
  });

  it('makes a late joiner wait for the next race', () => {
    const { clients, room } = startRacing();
    const late = new Client(room, 'Late');
    ticks(room, 6);
    expect(late.count('race')).toBe(0);
    expect(late.count('snap')).toBe(0);
    expect(late.last('room').room.players.find((p) => p.name === 'Late')!.inRace).toBe(false);
    expect(clients[0]!.last('snap').rivals).toHaveLength(1);
  });

  it('lets the host add computer players, which race at their level and score points', () => {
    const { clients, room } = setup(['Ana', 'Ben']);
    const [ana, ben] = clients as [Client, Client];
    ben.send({ t: 'addBot', level: 'hard' });
    expect(room.info().players).toHaveLength(2);
    ana.send({ t: 'addBot', level: 'hard' });
    ana.send({ t: 'addBot', level: 'easy' });
    const bots = room.info().players.filter((p) => p.bot);
    expect(bots.map((p) => p.bot)).toEqual(['hard', 'easy']);
    expect(new Set(room.info().players.map((p) => p.color)).size).toBe(4);
    ana.send({ t: 'remove', id: bots[1]!.id });
    expect(room.info().players).toHaveLength(3);

    ana.send({ t: 'start' });
    expect(ana.last('race').runners).toHaveLength(3);
    ana.send({ t: 'ready' });
    ben.send({ t: 'ready' });
    // People only: the computer player never holds up the preview.
    ticks(room, 2);
    expect(room.raceState!.phase).toBe('countdown');
    let guard = 0;
    while (room.raceState && guard++ < 60 * 400) room.tick();
    const rows = ana.last('results').rows;
    expect(rows[0]).toMatchObject({ name: bots[0]!.name, place: 1, pointsGained: 10 });
    // Hard runs at 80% of top speed: clearly slower than a flawless run, clearly faster than easy would be.
    expect(rows[0]!.time!).toBeGreaterThan(60);
    expect(rows[0]!.time!).toBeLessThan(260);
    expect(ana.last('room').room.players.find((p) => p.bot)!.points).toBe(10);
  });

  it('does not keep the room alive for computer players alone', () => {
    const { clients, room, clock } = setup(['Ana']);
    clients[0]!.send({ t: 'addBot', level: 'normal' });
    ticks(room, 120);
    expect(room.info().players).toHaveLength(2);
    expect(room.abandoned).toBe(false);
    room.leave(clients[0]!.member!);
    expect(room.abandoned).toBe(false);
    clock.now = 31_000;
    ticks(room, 60);
    expect(room.info().players).toEqual([]);
    expect(room.abandoned).toBe(true);
  });

  it('lets only the host pause, freezes the race for everyone, and counts 3-2-1 before play continues', () => {
    const { clients, room } = startRacing();
    const state = room.raceState!;
    ticks(room, 30);
    clients[1]!.send({ t: 'pause', on: true });
    ticks(room, 30);
    expect(state.raceTicks).toBe(60);

    clients[0]!.send({ t: 'pause', on: true });
    expect(clients[1]!.last('snap').paused).toBe(true);
    const dir = openDirection(state, state.players[1]!);
    const before = { ...state.players[1]! };
    for (let seq = 1; seq <= 60; seq++) {
      clients[1]!.send({ t: 'input', seq, ...dir, sprint: false });
      room.tick();
    }
    expect(state.raceTicks).toBe(60);
    expect(state.players[1]).toMatchObject({ x: before.x, y: before.y });

    clients[0]!.send({ t: 'pause', on: false });
    expect(clients[1]!.last('snap')).toMatchObject({ paused: false, resumeTime: 3 });
    // A 3-2-1 before play continues: the clock stands still and nobody moves.
    const seen = clients[1]!.inbox.length;
    ticks(room, 3 * 60 - 1);
    expect(state.raceTicks).toBe(60);
    expect(state.players[1]).toMatchObject({ x: before.x, y: before.y });
    room.tick();
    const events = clients[1]!.inbox.slice(seen).flatMap((m) => (m.t === 'snap' ? m.events : []));
    expect(events.filter((e) => e.type === 'countdown').map((e) => (e as { n: number }).n)).toEqual([3, 2, 1]);
    expect(events.at(-1)).toEqual({ type: 'resumed' });
    expect(clients[1]!.last('snap').resumeTime).toBe(0);
    ticks(room, 30);
    expect(state.raceTicks).toBe(90);
    expect(state.players[1]!.x !== before.x || state.players[1]!.y !== before.y).toBe(true);
  });

  it('lets the host restart the race on the same map, or cancel it', () => {
    const { clients, room } = startRacing();
    const first = clients[1]!.last('race');
    const state = room.raceState!;
    const dir = openDirection(state, state.players[0]!);
    for (let seq = 1; seq <= 60; seq++) {
      clients[0]!.send({ t: 'input', seq, ...dir, sprint: false });
      room.tick();
    }
    clients[1]!.send({ t: 'restart' });
    expect(room.raceState).toBe(state);

    clients[0]!.send({ t: 'pause', on: true });
    clients[0]!.send({ t: 'restart' });
    const second = clients[1]!.last('race');
    expect(second).toMatchObject({ seed: first.seed, slot: first.slot, raceNumber: 1 });
    expect(second.id).not.toBe(first.id);
    expect(room.raceState).not.toBe(state);
    expect(room.raceState!.phase).toBe('preview');
    ticks(room, 3);
    expect(clients[1]!.last('snap')).toMatchObject({ paused: false, raceTicks: 0 });

    clients[1]!.send({ t: 'lobby' });
    expect(room.info().stage).toBe('race');
    clients[0]!.send({ t: 'lobby' });
    expect(clients[1]!.last('room').room.stage).toBe('lobby');
    expect(room.raceState).toBeNull();
  });

  it('forgets players who stay away, and empties when everyone leaves', () => {
    const { clients, room, clock } = setup(['Ana', 'Ben', 'Cy']);
    room.leave(clients[2]!.member!);
    clock.now = 31_000;
    ticks(room, 60);
    expect(clients[0]!.last('room').room.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    room.leave(clients[0]!.member!);
    room.leave(clients[1]!.member!);
    // Places are kept for a while even with nobody connected, then the room empties.
    expect(room.info().players).toHaveLength(2);
    clock.now = 62_000;
    ticks(room, 60);
    expect(room.info().players).toEqual([]);
    expect(room.abandoned).toBe(true);
  });

  it('gives a lone host who reloads the room back, with its settings and players', () => {
    const { clients, room } = setup(['Ana']);
    const ana = clients[0]!;
    ana.send({ t: 'settings', settings: { size: 'large', races: 5 } });
    ana.send({ t: 'addBot', level: 'easy' });
    room.leave(ana.member!);
    ticks(room, 120);
    const back = new Client(room, 'Ana', ana.last('welcome').token);
    expect(back.id).toBe(ana.id);
    const info = back.last('room').room;
    expect(info.hostId).toBe(ana.id);
    expect(info.settings).toMatchObject({ size: 'large', races: 5 });
    expect(info.players).toHaveLength(2);
  });

  it('lets the host remove a person, who is told, disconnected and cannot rejoin from that page', () => {
    const { clients, room } = setup(['Ana', 'Ben', 'Cy']);
    const [ana, ben, cy] = clients as [Client, Client, Client];
    ben.send({ t: 'remove', id: cy.id });
    ana.send({ t: 'remove', id: ana.id });
    expect(room.info().players).toHaveLength(3);

    ana.send({ t: 'remove', id: cy.id });
    expect(cy.last('error').message).toMatch(/removed/);
    expect(cy.closed).toBe(true);
    expect(ana.last('room').room.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    // A message still in flight from the removed page changes nothing.
    cy.send({ t: 'profile', name: 'Sneaky', color: PLAYER_COLORS[3]! });
    room.leave(cy.member!);
    expect(room.info().players.map((p) => p.name)).toEqual(['Ana', 'Ben']);

    const again = new Client(room, 'Cy', cy.last('welcome').token);
    expect(again.member).toBeNull();
    expect(again.last('error').message).toMatch(/removed/);
  });

  it('does not let the host remove someone running in the race, only someone waiting for the next', () => {
    const { clients, room } = startRacing(['Ana', 'Ben']);
    const late = new Client(room, 'Late');
    clients[0]!.send({ t: 'remove', id: clients[1]!.id });
    expect(room.info().players).toHaveLength(3);
    clients[0]!.send({ t: 'remove', id: late.id });
    expect(late.closed).toBe(true);
    expect(room.info().players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
  });
});

describe('effects in a network race', () => {
  it('sends a runner its own effects, and shows a rival’s effects only when in view', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const state = room.raceState!;
    const [pa, pb] = state.players;
    // Side by side, so each can see the other.
    pb!.x = pa!.x;
    pb!.y = pa!.y;
    pb!.effects.push({ kind: 'slow', time: 2, total: 2 });
    ticks(room, 3);
    expect(ben!.last('snap').you.effects.map((e) => e.kind)).toEqual(['slow']);
    expect(ana!.last('snap').rivals.find((r) => r.id === ben!.id)?.fx).toEqual(['slow']);
    expect(ben!.last('snap').rivals.find((r) => r.id === ana!.id)?.fx).toBeUndefined();
  });

  it('a blinded runner is sent fewer of the rivals around them', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const state = room.raceState!;
    const [pa, pb] = state.players;
    // Put Ben a few tiles straight ahead of Ana along an open line.
    const dir = openDirection(state, pa!);
    pb!.x = pa!.x + dir.mx * 3;
    pb!.y = pa!.y + dir.my * 3;
    pa!.facing = Math.atan2(dir.my, dir.mx);
    ticks(room, 3);
    expect(ana!.last('snap').rivals.some((r) => r.id === ben!.id)).toBe(true);
    // Blinded, Ana sees 2 tiles ahead: clearly short of Ben.
    state.config.effects.blind.visionMul = 0.25;
    pa!.effects.push({ kind: 'blind', time: 3, total: 3 });
    pb!.x = pa!.x + dir.mx * 3;
    pb!.y = pa!.y + dir.my * 3;
    pa!.facing = Math.atan2(dir.my, dir.mx);
    ticks(room, 3);
    expect(ana!.last('snap').rivals.some((r) => r.id === ben!.id)).toBe(false);
  });
});

describe('health in a network race', () => {
  it('shows a rival flickering during their safe time', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const [pa, pb] = room.raceState!.players;
    pb!.x = pa!.x;
    pb!.y = pa!.y;
    pb!.safeTime = 1;
    ticks(room, 3);
    expect(ana!.last('snap').rivals.find((r) => r.id === ben!.id)?.safe).toBe(true);
    expect(ben!.last('snap').you.safeTime).toBeGreaterThan(0);
  });
});

describe('obstacles in a network race', () => {
  it('tells only the runner who was hit, with the lost heart and the stun', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const state = room.raceState!;
    const pb = state.players[1]!;
    state.map.obstacles = [{ kind: 'boulder', ax: pb.x, ay: pb.y, bx: pb.x, by: pb.y, phase: 0 }];
    ticks(room, 3);
    const benEvents = ben!.inbox.filter((m) => m.t === 'snap').flatMap((m) => (m.t === 'snap' ? m.events : []));
    const anaEvents = ana!.inbox.filter((m) => m.t === 'snap').flatMap((m) => (m.t === 'snap' ? m.events : []));
    expect(benEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['obstacleHit', 'hurt', 'effect']));
    expect(anaEvents.some((e) => e.type === 'obstacleHit' || e.type === 'hurt')).toBe(false);
    expect(ben!.last('snap').you.health).toBe(state.config.health.hearts - 1);
  });
});

describe('traps in a network race', () => {
  it('tells the runner who sprang a trap, and shows sprung traps only to runners who can see them', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const state = room.raceState!;
    const pa = state.players[0]!;
    const pb = state.players[1]!;
    // Ben far away from Ana, standing on a fresh trap.
    pb.x = pa.x + 30;
    pb.y = pa.y;
    while (isSolid(state.map, Math.floor(pb.x), Math.floor(pb.y))) pb.x -= 1;
    state.map.traps = [{ kind: 'glue', x: Math.floor(pb.x), y: Math.floor(pb.y) }];
    state.traps = [0];
    ticks(room, 3);
    const benEvents = ben!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : []));
    expect(benEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['trap', 'effect']));
    expect(ben!.last('snap').traps.slice(0, 1)).toEqual([0]);
    expect(ana!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).some((e) => e.type === 'trap')).toBe(false);
    expect(ana!.last('snap').traps).toEqual([]);
  });
});

describe('enemies in a network race', () => {
  it('shows chasers only to runners who can see them, and lets others hear them by direction only', () => {
    const { room, clients } = startRacing();
    const [ana, ben] = clients;
    const state = room.raceState!;
    const pa = state.players[0]!;
    const pb = state.players[1]!;
    // A chaser right beside Ana; Ben far off.
    state.map.enemies = [{ kind: 'chaser', x: pa.x, y: pa.y }];
    state.foes = [{ kind: 'chaser', x: pa.x, y: pa.y, facing: 0, mode: 'chase', target: pa.id, lastX: pa.x, lastY: pa.y, timer: 2, cue: 0 }];
    // Ben on open floor at least 25 tiles away.
    const far = state.map.tiles.findIndex((_t, i) => {
      const x = (i % state.map.width) + 0.5;
      const y = Math.floor(i / state.map.width) + 0.5;
      return !isSolid(state.map, Math.floor(x), Math.floor(y)) && Math.hypot(x - pa.x, y - pa.y) > 25;
    });
    pb.x = (far % state.map.width) + 0.5;
    pb.y = Math.floor(far / state.map.width) + 0.5;
    ticks(room, 3);
    expect(ana!.last('snap').foes.map((f) => f.i)).toEqual([0]);
    expect(ben!.last('snap').foes).toEqual([]);
    const heard = ana!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).filter((e) => e.type === 'foeHeard');
    expect(heard.length).toBeGreaterThan(0);
    for (const e of heard) expect(Object.keys(e).sort()).toEqual(['aimed', 'closeness', 'pan', 'sound', 'type']);
    expect(ana!.inbox.flatMap((m) => (m.t === 'snap' ? m.events : [])).some((e) => e.type === 'foeCue')).toBe(false);
  });
});

describe('ready in the lobby', () => {
  it('lets each person say they are ready, shows it to everyone, and starts afresh back in the lobby', () => {
    const { clients } = setup(['Ana', 'Ben']);
    const [ana, ben] = clients;
    const readyOf = (c: typeof ana, name: string) => c!.last('room').room.players.find((p) => p.name === name)!.ready;
    expect(readyOf(ana, 'Ben')).toBe(false);
    ben!.send({ t: 'lobbyReady', on: true });
    expect(readyOf(ana, 'Ben')).toBe(true);
    ben!.send({ t: 'lobbyReady', on: false });
    expect(readyOf(ana, 'Ben')).toBe(false);
    // Computer players are always ready.
    ana!.send({ t: 'addBot', level: 'easy' });
    expect(ana!.last('room').room.players.find((p) => p.bot)!.ready).toBe(true);
    // Back in the lobby after a race, people say so again.
    ben!.send({ t: 'lobbyReady', on: true });
    ana!.send({ t: 'start' });
    ana!.send({ t: 'lobby' });
    expect(readyOf(ana, 'Ben')).toBe(false);
  });

  it('ignores "ready" outside the lobby, and parses it safely', () => {
    expect(parseClientMessage('{"t":"lobbyReady","on":"yes"}')).toEqual({ t: 'lobbyReady', on: false });
    expect(parseClientMessage('{"t":"lobbyReady","on":true}')).toEqual({ t: 'lobbyReady', on: true });
  });
});
