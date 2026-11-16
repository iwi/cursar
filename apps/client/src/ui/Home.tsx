import { LOOKS, type Look } from '../game/looks';

interface Props {
  onSolo: () => void;
  onMultiplayer: () => void;
  onEditor: () => void;
  onStats: () => void;
  onTutorial: () => void;
  /** The tutorial has been finished or skipped in this browser. */
  tutorialSeen: boolean;
  look: Look;
  onLook: (look: Look) => void;
  colourSafe: boolean;
  onColourSafe: (on: boolean) => void;
}

/** The entry screen: what to play. Every option is chosen on the next screen. */
export function Home({ onSolo, onMultiplayer, onEditor, onStats, onTutorial, tutorialSeen, look, onLook, colourSafe, onColourSafe }: Props) {
  return (
    <main className="menu">
      <div className="menu-card home">
        <header>
          <h1>Cursar</h1>
          <p>Study the map. Then run it from memory: touch every checkpoint, in any order, and reach the finish.</p>
        </header>
        <nav className="modes" aria-label="What to play">
          {!tutorialSeen && (
            <button type="button" className="mode tutorial" onClick={onTutorial} autoFocus>
              <strong>New here? Tutorial</strong>
              <span>A short guided race: the preview, checkpoints, sprinting and the full map.</span>
            </button>
          )}
          <button type="button" className="mode" onClick={onSolo} autoFocus={tutorialSeen}>
            <strong>Solo race</strong>
            <span>Race the clock and a ghost of your best run.</span>
          </button>
          <button type="button" className="mode" onClick={onMultiplayer}>
            <strong>Play with friends</strong>
            <span>Create a room or join one with its code. 2 to 8 runners, and computer players.</span>
          </button>
          <button type="button" className="mode" onClick={onEditor}>
            <strong>Map editor</strong>
            <span>Draw your own map, then race it alone or with friends.</span>
          </button>
        </nav>
        <div className="look-switch" role="radiogroup" aria-label="How the race looks">
          <span>Look</span>
          {LOOKS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={look === option.id}
              className={look === option.id ? 'on' : ''}
              onClick={() => onLook(option.id)}
            >
              {option.label}
            </button>
          ))}
          <small className="look-note">{LOOKS.find((option) => option.id === look)?.description}</small>
        </div>
        <label className="check colour-safe">
          <input type="checkbox" checked={colourSafe} onChange={(event) => onColourSafe(event.target.checked)} />
          <span>Colour-blind friendly colours <small>(runners, plazas, doors and keys; doors and keys also carry shapes)</small></span>
        </label>
        <div className="home-links">
          <button type="button" className="link" onClick={onStats}>Statistics</button>
          {tutorialSeen && <button type="button" className="link" onClick={onTutorial}>Tutorial</button>}
        </div>
      </div>
    </main>
  );
}
