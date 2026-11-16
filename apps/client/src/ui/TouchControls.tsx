import { useEffect, useRef, useState } from 'react';
import type { Bridge } from '../game/bridge';

/** How far (screen pixels) the stick's knob can travel from its centre. */
const STICK_REACH = 56;
/** Pushes shorter than this share of the reach count as none. */
const DEAD_ZONE = 0.15;
/** Pushed this far (as a share of the reach) or more, the runner goes at full speed. */
const FULL_PUSH = 0.7;

/** Keeps a finger's moves coming to this element (some browsers refuse; the controls still work without it). */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

/** Whether this device is mainly touch (a phone or tablet), so the on-screen controls show. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

/**
 * On-screen controls for phones and tablets during the race: a stick that
 * appears wherever a thumb touches the left half of the screen, and Sprint
 * (hold) and Shove buttons on the right. They write into `bridge.touch`, which
 * the scene reads every tick.
 */
export function TouchControls({ bridge, shoveReady }: { bridge: Bridge; shoveReady: boolean }) {
  const [stick, setStick] = useState<{ x: number; y: number; kx: number; ky: number } | null>(null);
  const [sprinting, setSprinting] = useState(false);
  const finger = useRef<number | null>(null);

  // Let go of everything when the controls go away (the race ends, the map opens).
  useEffect(() => () => {
    bridge.touch.mx = 0;
    bridge.touch.my = 0;
    bridge.touch.sprint = false;
  }, [bridge]);

  const steer = (x: number, y: number, ox: number, oy: number) => {
    let dx = x - ox;
    let dy = y - oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_REACH) {
      dx = (dx / len) * STICK_REACH;
      dy = (dy / len) * STICK_REACH;
    }
    const push = Math.min(len, STICK_REACH) / STICK_REACH;
    const strength = push < DEAD_ZONE ? 0 : Math.min(1, (push - DEAD_ZONE) / (FULL_PUSH - DEAD_ZONE));
    bridge.touch.mx = len > 0 ? (dx / Math.hypot(dx, dy)) * strength : 0;
    bridge.touch.my = len > 0 ? (dy / Math.hypot(dx, dy)) * strength : 0;
    setStick({ x: ox, y: oy, kx: dx, ky: dy });
  };

  const release = () => {
    finger.current = null;
    bridge.touch.mx = 0;
    bridge.touch.my = 0;
    setStick(null);
  };

  const sprint = (on: boolean) => {
    bridge.touch.sprint = on;
    setSprinting(on);
  };

  return (
    <div className="touch-controls">
      <div
        className="touch-stick-zone"
        onPointerDown={(event) => {
          if (finger.current !== null) return;
          finger.current = event.pointerId;
          capture(event.currentTarget, event.pointerId);
          steer(event.clientX, event.clientY, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerId !== finger.current || !stick) return;
          steer(event.clientX, event.clientY, stick.x, stick.y);
        }}
        onPointerUp={(event) => event.pointerId === finger.current && release()}
        onPointerCancel={(event) => event.pointerId === finger.current && release()}
      >
        {stick ? (
          <div className="touch-stick" style={{ left: stick.x, top: stick.y }}>
            <i style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
          </div>
        ) : (
          <span className="touch-stick-hint">Touch and drag here to run</span>
        )}
      </div>
      <div className="touch-buttons">
        <button
          type="button"
          className={shoveReady ? 'touch-shove' : 'touch-shove off'}
          onPointerDown={(event) => {
            event.preventDefault();
            bridge.emit('shove');
          }}
        >
          Shove
        </button>
        <button
          type="button"
          className={sprinting ? 'touch-sprint on' : 'touch-sprint'}
          onPointerDown={(event) => {
            event.preventDefault();
            capture(event.currentTarget, event.pointerId);
            sprint(true);
          }}
          onPointerUp={() => sprint(false)}
          onPointerCancel={() => sprint(false)}
        >
          Sprint
        </button>
      </div>
    </div>
  );
}
