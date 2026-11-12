import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from '@cursar/game-core';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';
type Handler<T> = (message: T) => void;
type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

const TOKEN_KEY = 'cursar.token';
const RETRIES = 6;

function storedToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The link to the game server. It reconnects by itself after a drop and
 * presents the same token, so the server gives the player their place back.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  id = '';
  /** Network addresses of the server machine, for telling other players where to join. */
  addresses: string[] = [];
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler<never>>>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private attempts = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private profile: { name: string; color: number }) {
    this.open();
  }

  private open(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.profile.name, color: this.profile.color, token: storedToken() });
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
        this.addresses = message.addresses;
        this.attempts = 0;
        try {
          sessionStorage.setItem(TOKEN_KEY, message.token);
        } catch {
          /* a reload will simply join as a new player */
        }
        this.setStatus('open');
      }
      this.handlers.get(message.t)?.forEach((handler) => (handler as Handler<ServerMessage>)(message));
    };
    socket.onclose = () => {
      if (this.closedByUs || this.socket !== socket) return;
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
