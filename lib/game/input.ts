export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  handbrake: boolean;
  fire: boolean;
  enter: boolean;
  horn: boolean;
  /** mouse position in screen pixels */
  mouse: { x: number; y: number };
  /** edge-triggered actions consumed by the engine */
  pressed: Set<string>;
  wheel: number;
}

const KEY_MAP: Record<string, keyof InputState | 'ignore'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'handbrake',
  KeyF: 'enter',
  Enter: 'enter',
  KeyH: 'horn',
};

/** Keys that are reported once per physical press. */
const EDGE_KEYS = new Set([
  'KeyF',
  'Enter',
  'Escape',
  'Tab',
  'KeyE',
  'KeyM',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'KeyQ',
  'KeyR',
  'KeyP',
]);

export function createInput(target: HTMLElement): { state: InputState; dispose: () => void } {
  const state: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    run: false,
    handbrake: false,
    fire: false,
    enter: false,
    horn: false,
    mouse: { x: 0, y: 0 },
    pressed: new Set<string>(),
    wheel: 0,
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (EDGE_KEYS.has(e.code) && !e.repeat) state.pressed.add(e.code);
    const bind = KEY_MAP[e.code];
    if (bind && bind !== 'ignore') (state as unknown as Record<string, boolean>)[bind] = true;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const bind = KEY_MAP[e.code];
    if (bind && bind !== 'ignore') (state as unknown as Record<string, boolean>)[bind] = false;
  };

  const onMouseMove = (e: MouseEvent) => {
    const rect = target.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) state.fire = true;
    if (e.button === 2) state.pressed.add('MouseRight');
  };

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) state.fire = false;
  };

  const onWheel = (e: WheelEvent) => {
    state.wheel += Math.sign(e.deltaY);
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const onBlur = () => {
    state.up = state.down = state.left = state.right = false;
    state.run = state.handbrake = state.fire = state.horn = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('mousemove', onMouseMove);
  target.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  target.addEventListener('wheel', onWheel, { passive: true });
  target.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

export function consumePress(state: InputState, code: string): boolean {
  if (!state.pressed.has(code)) return false;
  state.pressed.delete(code);
  return true;
}
