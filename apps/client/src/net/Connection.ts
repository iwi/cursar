import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from '@cursar/game-core';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';
type Handler<T> = (message: T) => void;
type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

const SEAT_KEY = 'cursar.seat';
const RETRIES = 6;

/** The room this tab last joined and its token there, so a reload takes the same place back. */
function storedToken(room: string): string | undefined {
  try {
    const seat = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null') as { room?: string; token?: string } | null;
    return seat?.room === room ? seat.token : undefined;
  } catch {
    return undefined;
  }
}

function storeSeat(room: string, token: string): void {
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ room, token }));
  } catch {
    /* a reload will simply join as a new player */
  }
}

/**
 * The link to the game server. It reconnects by itself after a drop and
 * presents the same token, so the server gives the player their place back.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  id = '';
  /** The room's code, known once the server has welcomed us. */
  room = '';
  /** Network addresses of the server machine, for telling other players where to join. */
  addresses: string[] = [];
  /** The server turned us away (unknown code, full room, removed): do not keep retrying. */
  private refused = false;
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler<never>>>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private attempts = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** `room` is the code to join, or null to create a new room. */
  constructor(
    private profile: { name: string; color: number },
    room: string | null,
  ) {
    this.room = room ?? '';
    this.open();
  }

  private open(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      // Once welcomed, reconnecting always goes back to the same room, never a new one.
      const room = this.room || undefined;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.profile.name, color: this.profile.color, room, token: room && storedToken(room) });
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'welcome') {
        this.id = message.id;
        this.room = message.room;
        this.addresses = message.addresses;
        this.attempts = 0;
        storeSeat(message.room, message.token);
        this.setStatus('open');
      }
      // The token is kept even then: it is how the server knows a removed player trying again.
      if (message.t === 'error') this.refused = true;
      this.handlers.get(message.t)?.forEach((handler) => (handler as Handler<ServerMessage>)(message));
    };
    socket.onclose = () => {
      if (this.closedByUs || this.refused || this.socket !== socket) return;
      if (this.attempts++ < RETRIES) {
        this.setStatus('connecting');
        this.retryTimer = setTimeout(() => this.open(), 700);
      } else {
        this.setStatus('closed');
      }
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  setProfile(profile: { name: string; color: number }): void {
    this.profile = profile;
    this.send({ t: 'profile', ...profile });
  }

  on<T extends ServerMessage['t']>(type: T, handler: Handler<Of<T>>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  onStatus(handler: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Try again after the automatic retries gave up. */
  retry(): void {
    if (this.status !== 'closed') return;
    this.attempts = 0;
    this.setStatus('connecting');
    this.open();
  }

  close(): void {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    this.setStatus('closed');
  }
}
