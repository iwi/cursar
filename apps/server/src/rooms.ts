import { type ClientMessage, ROOM_CODE_LENGTH, ROOM_CODE_LETTERS } from '@cursar/game-core';
import { type Member, Room, type Send } from './room';

export interface RoomsOptions {
  /** Most rooms open at once; creating more is refused. */
  maxRooms?: number;
  /** Addresses other machines can use to reach this server, shown in every lobby. */
  addresses?: string[];
  now?: () => number;
  randomId?: () => string;
  /** A number in [0, 1), for picking room codes. Injected so tests are repeatable. */
  random?: () => number;
}

/** What a connection is attached to once its hello has been accepted. */
export interface Seat {
  room: Room;
  member: Member;
}

const DEFAULT_MAX_ROOMS = 50;

/**
 * All the rooms on this server, found by their code. Like `Room`, it knows
 * nothing about sockets: whoever owns it calls `join` with a connection's
 * hello, then talks to the returned room directly, and calls `tick` 60 times a
 * second. Rooms are closed once nobody is left in them.
 */
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly maxRooms: number;
  private readonly options: RoomsOptions;
  private readonly random: () => number;

  constructor(options: RoomsOptions = {}) {
    this.options = options;
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.random = options.random ?? Math.random;
  }

  get count(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /**
   * Seats a connection: in the room whose code it asked for, or in a new room
   * if it asked for none. Returns null, after telling the page why, if that
   * is not possible.
   */
  join(send: Send, hello: Extract<ClientMessage, { t: 'hello' }>, close: (() => void) | null = null): Seat | null {
    let room: Room | undefined;
    if (hello.room === undefined) {
      if (this.rooms.size >= this.maxRooms) {
        send({ t: 'error', message: 'The server is busy: every room is in use. Try again in a few minutes.' });
        return null;
      }
      room = this.create();
    } else {
      room = this.rooms.get(hello.room);
      if (!room) {
        send({ t: 'error', message: hello.room ? `There is no room with the code ${hello.room}. Check the code, or create a new room.` : 'That is not a room code. Codes are four letters.' });
        return null;
      }
    }
    const member = room.join(send, hello, close);
    if (!member) {
      if (room.abandoned) this.rooms.delete(room.code);
      return null;
    }
    return { room, member };
  }

  /** Advances every room by one tick, and closes rooms nobody is in any more. */
  tick(): void {
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.abandoned) this.rooms.delete(code);
    }
  }

  private create(): Room {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_LETTERS[Math.floor(this.random() * ROOM_CODE_LETTERS.length)];
    } while (this.rooms.has(code));
    const room = new Room({ code, addresses: this.options.addresses, now: this.options.now, randomId: this.options.randomId });
    this.rooms.set(code, room);
    return room;
  }
}
