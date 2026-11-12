import { PROTOCOL_VERSION, ROOM_CODE_LETTERS, type ServerMessage } from '@cursar/game-core';
import { describe, expect, it } from 'vitest';
import { Rooms } from '../src/rooms';

/** A repeatable stand-in for Math.random. */
function sequence(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function setup(options: { maxRooms?: number } = {}) {
  const clock = { now: 0 };
  let n = 0;
  const rooms = new Rooms({ ...options, now: () => clock.now, randomId: () => `id${++n}-padding`, random: sequence() });
  const join = (name: string, room?: string, token?: string) => {
    const inbox: ServerMessage[] = [];
    const seat = rooms.join((m) => inbox.push(m), { t: 'hello', v: PROTOCOL_VERSION, name, color: 0, room, token });
    const welcome = inbox.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }> | undefined;
    const error = inbox.find((m) => m.t === 'error') as Extract<ServerMessage, { t: 'error' }> | undefined;
    return { seat, inbox, welcome, error };
  };
  const ticks = (count: number) => {
    for (let i = 0; i < count; i++) rooms.tick();
  };
  return { rooms, clock, join, ticks };
}

describe('rooms', () => {
  it('creates a room with a four-letter code when no code is given, and joins it by that code', () => {
    const { rooms, join } = setup();
    const ana = join('Ana');
    const code = ana.welcome!.room;
    expect(code).toMatch(new RegExp(`^[${ROOM_CODE_LETTERS}]{4}$`));
    expect(rooms.count).toBe(1);

    const ben = join('Ben', code);
    expect(ben.seat!.room).toBe(ana.seat!.room);
    expect(ben.welcome!.room).toBe(code);
    expect(ana.seat!.room.info().players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(ana.seat!.room.info().hostId).toBe(ana.welcome!.id);
  });

  it('keeps rooms apart, each with its own code', () => {
    const { rooms, join } = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) codes.add(join(`P${i}`).welcome!.room);
    expect(codes.size).toBe(30);
    expect(rooms.count).toBe(30);
    const [first] = [...codes];
    expect(rooms.get(first!)!.info().players).toHaveLength(1);
  });

  it('turns away an unknown or malformed code with a reason', () => {
    const { rooms, join } = setup();
    join('Ana');
    const wrong = join('Ben', 'ZZZZ');
    expect(wrong.seat).toBeNull();
    expect(wrong.error!.message).toMatch(/no room with the code ZZZZ/);
    expect(join('Cy', '').error!.message).toMatch(/four letters/);
    expect(rooms.count).toBe(1);
  });

  it('refuses new rooms once the limit is reached, but still lets people join existing ones', () => {
    const { rooms, join } = setup({ maxRooms: 2 });
    const a = join('A');
    join('B');
    const c = join('C');
    expect(c.seat).toBeNull();
    expect(c.error!.message).toMatch(/busy/);
    expect(join('D', a.welcome!.room).seat).not.toBeNull();
    expect(rooms.count).toBe(2);
  });

  it('does not leave a room behind when its creator is turned away', () => {
    const { rooms } = setup();
    const inbox: ServerMessage[] = [];
    expect(rooms.join((m) => inbox.push(m), { t: 'hello', v: 999, name: 'Old', color: 0 })).toBeNull();
    expect(rooms.count).toBe(0);
  });

  it('closes a room once everyone has been gone for the reconnection time, and not before', () => {
    const { rooms, clock, join, ticks } = setup();
    const ana = join('Ana');
    const code = ana.welcome!.room;
    ana.seat!.room.receive(ana.seat!.member, { t: 'addBot', level: 'easy' });
    ana.seat!.room.leave(ana.seat!.member);
    clock.now = 20_000;
    ticks(60);
    expect(rooms.get(code)).toBeDefined();
    // Back within the time: same room, same place.
    const back = join('Ana', code, ana.welcome!.token);
    expect(back.welcome!.id).toBe(ana.welcome!.id);

    back.seat!.room.leave(back.seat!.member);
    clock.now = 60_000;
    ticks(60);
    expect(rooms.get(code)).toBeUndefined();
    expect(rooms.count).toBe(0);
    expect(join('Ana', code).error!.message).toMatch(/no room/);
  });

  it('runs every room on each tick', () => {
    const { join, ticks } = setup();
    const a = join('A');
    const b = join('B');
    for (const p of [a, b]) {
      p.seat!.room.receive(p.seat!.member, { t: 'settings', settings: { seed: 'fixture' } });
      p.seat!.room.receive(p.seat!.member, { t: 'start' });
    }
    ticks(30);
    expect(a.seat!.room.raceState!.tick).toBe(30);
    expect(b.seat!.room.raceState!.tick).toBe(30);
  });
});
