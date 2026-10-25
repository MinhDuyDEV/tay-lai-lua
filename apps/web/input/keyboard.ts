// Raw keyboard state. Keys are identified by `event.code` (the physical key), so a Vietnamese IME
// (Telex/VNI) or a non-QWERTY layout cannot change which key is which.

export interface Keyboard {
  /** Codes currently held. */
  readonly held: ReadonlySet<string>;
  /** Codes that went down since the last call (key repeat excluded), oldest first. */
  drainPressed(): string[];
  /** Forget everything held and pending, e.g. after the "enter the car" key press. */
  clear(): void;
  dispose(): void;
}

export function attachKeyboard(target: Window, handles: ReadonlySet<string>): Keyboard {
  const held = new Set<string>();
  let pressed: string[] = [];

  const onDown = (e: KeyboardEvent) => {
    // Browser shortcuts (Cmd+R, Ctrl+W...) are not ours, and a modifier-held keyup may never arrive.
    if (e.metaKey || e.ctrlKey || e.altKey || !handles.has(e.code)) return;
    e.preventDefault();
    if (e.repeat || held.has(e.code)) return;
    held.add(e.code);
    pressed.push(e.code);
  };
  const onUp = (e: KeyboardEvent) => {
    if (!handles.has(e.code)) return;
    e.preventDefault();
    held.delete(e.code);
  };
  // A key released while the page is not looking never sends keyup: forget it, or the pedal sticks.
  const clear = () => {
    held.clear();
    pressed = [];
  };
  const onHidden = () => {
    if (document.hidden) clear();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', onHidden);

  return {
    held,
    drainPressed() {
      const out = pressed;
      pressed = [];
      return out;
    },
    clear,
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', onHidden);
    },
  };
}
