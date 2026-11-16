import { type GameConfig, type GameMap, PLAYER_COLORS, generateMap } from '@cursar/game-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HudState } from '../game/bridge';
import { LocalDriver } from '../game/driver';
import { read, type Settings, formatTime, write } from '../storage';
import { RaceView } from './RaceView';
import { isTouchDevice } from './TouchControls';

const TUTORIAL_KEY = 'cursar.tutorial';

/** Whether this browser has finished or skipped the tutorial. */
export function tutorialSeen(): boolean {
  return read<boolean>(TUTORIAL_KEY) === true;
}

export function markTutorialSeen(): void {
  write(TUTORIAL_KEY, true);
}

/**
 * The tutorial's map: a tiny generated map with no hazards, doors or coins,
 * so only the basics are left: two checkpoints and the finish.
 */
export function tutorialMap(): GameMap {
  const map = generateMap({ seed: 'tutorial', size: 'tiny' });
  return { ...map, id: 'tutorial', name: 'Tutorial', obstacles: [], traps: [], enemies: [], treasures: [], doors: undefined };
}

type Step = 'preview' | 'count' | 'run' | 'sprint' | 'map' | 'checkpoints' | 'finish' | 'done';

interface Props {
  config: GameConfig;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Leaves for the solo menu, ready for a real race. */
  onDone: () => void;
  onExit: () => void;
}

/**
 * A short guided race for new players: the preview, moving, sprinting, the full
 * map and the checkpoints, on a tiny map with no hazards. A coach panel says
 * what to do and moves on as each thing is done. Nothing is recorded.
 */
export function Tutorial({ config, settings, onChange, onDone, onExit }: Props) {
  const map = useMemo(tutorialMap, []);
  const [attempt, setAttempt] = useState(0);
  const [finished, setFinished] = useState<number | null>(null);
  const touch = useMemo(isTouchDevice, []);

  const createDriver = () =>
    new LocalDriver(map, config, null, null, (result) => {
      if (result.finished) markTutorialSeen();
      setFinished(result.finished ? result.time : -1);
    }, { color: PLAYER_COLORS.includes(settings.color) ? settings.color : PLAYER_COLORS[0]! });

  return (
    <RaceView
      key={attempt}
      map={map}
      createDriver={createDriver}
      settings={settings}
      onChange={onChange}
      title="Tutorial"
      subtitle="A short guided race"
      quiet={finished !== null}
      onRestartKey={() => {
        setFinished(null);
        setAttempt((n) => n + 1);
      }}
      buttons={
        <button
          type="button"
          onClick={() => {
            markTutorialSeen();
            onExit();
          }}
        >
          Skip tutorial
        </button>
      }
    >
      {(hud) => (
        <>
          {finished === null && hud && <Coach hud={hud} touch={touch} />}
          {finished !== null && (
            <div className="overlay results">
              <div className="panel">
                <h2>{finished >= 0 ? 'Tutorial done' : 'Out of time'}</h2>
                {finished >= 0 && <div className="big-time">{formatTime(finished)}</div>}
                <p className="delta">
                  {finished >= 0
                    ? 'That is all there is to it. Real maps are bigger and have traps, enemies and moving obstacles: watch for them in the preview, and listen for them in the race.'
                    : 'Try again: touch both pink checkpoints, then reach the chequered finish.'}
                </p>
                <div className="actions">
                  <button type="button" className="primary" onClick={onDone} autoFocus>Race a real map</button>
                  <button
                    type="button"
                    onClick={() => {
                      setFinished(null);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    Tutorial again
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </RaceView>
  );
}

/** Seconds of sprinting, and of running before sprinting is asked for. */
const SPRINT_SECONDS = 1;
const RUN_SECONDS = 4;

/** The coach: one instruction at a time, moving on as each is done. */
function Coach({ hud, touch }: { hud: HudState; touch: boolean }) {
  const [step, setStep] = useState<Step>('preview');
  const sprinted = useRef(0);
  const last = useRef(hud.raceTime);
  const mapWasOpen = useRef(false);

  useEffect(() => {
    const dt = Math.max(0, hud.raceTime - last.current);
    last.current = hud.raceTime;
    const allDone = hud.checkpointsTotal > 0 && hud.checkpointsDone >= hud.checkpointsTotal;
    setStep((current) => {
      if (hud.phase === 'preview') return 'preview';
      if (hud.phase === 'countdown') return 'count';
      if (hud.phase !== 'racing') return current;
      if (current === 'preview' || current === 'count') return 'run';
      if (current === 'run' && hud.raceTime >= RUN_SECONDS) return 'sprint';
      if (current === 'sprint') {
        if (hud.sprinting) sprinted.current += dt;
        return sprinted.current >= SPRINT_SECONDS ? 'map' : current;
      }
      if (current === 'map') {
        if (hud.mapOpen) mapWasOpen.current = true;
        return mapWasOpen.current && !hud.mapOpen ? (allDone ? 'finish' : 'checkpoints') : current;
      }
      if (current === 'checkpoints' && allDone) return 'finish';
      return current;
    });
  }, [hud]);

  const left = hud.checkpointsTotal - hud.checkpointsDone;
  const move = touch ? 'Drag on the left of the screen to run' : 'Run with W A S D or the arrow keys';
  const text: Record<Step, { title: string; body: string }> = {
    preview: {
      title: 'Step 1 of 5: the preview',
      body: `This is the whole map, for a few seconds only. The pulsing runner is you. Find the ${hud.checkpointsTotal} pink checkpoints and the chequered finish, and work out a way round. When you think you have it, press I’m ready.`,
    },
    count: { title: 'Get ready', body: 'In the race you only see what is in front of you, so remember the way.' },
    run: { title: 'Step 2 of 5: run', body: `${move}. You see ahead of you; where you have been fades into memory.` },
    sprint: {
      title: 'Step 3 of 5: sprint',
      body: touch ? 'Hold Sprint to run faster. It uses stamina (the bar at the bottom); let go to get it back.' : 'Hold Shift to run faster. It uses stamina (the bar at the bottom); let go to get it back.',
    },
    map: {
      title: 'Step 4 of 5: the full map',
      body: touch ? 'Lost? Tap Map (top right) to see the whole map again, then close it. You stand still while it is open, and the clock keeps running.' : 'Lost? Press M to see the whole map again, then M to close it. You stand still while it is open, and the clock keeps running.',
    },
    checkpoints: {
      title: 'Step 5 of 5: the checkpoints',
      body: `Touch every pink checkpoint, in any order: ${left} to go. The finish only counts once they are all done.`,
    },
    finish: { title: 'The finish is open', body: 'All checkpoints done. Now run to the chequered finish.' },
    done: { title: '', body: '' },
  };
  if (hud.paused || step === 'done') return null;
  return (
    <div className="coach" role="status" aria-live="polite">
      <strong>{text[step].title}</strong>
      <span>{text[step].body}</span>
    </div>
  );
}
