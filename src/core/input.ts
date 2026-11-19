import type { InputFrame, Vec3 } from '../types/game';

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveZ: 0, aimGround: null, sprintHeld: false, dashPressed: false,
  meleeHeld: false, rangedHeld: false, rangedReleased: false, magicPressed: false,
  interactHeld: false, interactPressed: false, bandagePressed: false, pausePressed: false,
};
export function withoutEdges(input: InputFrame): InputFrame {
  return { ...input, dashPressed: false, rangedReleased: false, magicPressed: false, interactPressed: false, bandagePressed: false, pausePressed: false };
}
export class InputController {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly removers: (() => void)[] = [];
  private mouseX = 0;
  private mouseY = 0;
  private melee = false;
  private ranged = false;
  private rangedRelease = false;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    const keyDown = (event: KeyboardEvent): void => {
      if (this.isEditing(event.target) && event.code !== 'Escape') return;
      if (!this.held.has(event.code)) this.pressed.add(event.code);
      this.held.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent): void => { this.held.delete(event.code); };
    const mouseMove = (event: PointerEvent): void => { this.mouseX = event.clientX; this.mouseY = event.clientY; };
    const mouseDown = (event: PointerEvent): void => {
      if (event.target !== this.canvas) return;
      if (event.button === 0) this.melee = true;
      if (event.button === 2) this.ranged = true;
    };
    const mouseUp = (event: PointerEvent): void => {
      if (event.button === 0) this.melee = false;
      if (event.button === 2) { this.rangedRelease = this.ranged; this.ranged = false; }
    };
    const contextMenu = (event: MouseEvent): void => { if (event.target === this.canvas) event.preventDefault(); };
    const blur = (): void => this.clear();
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('pointermove', mouseMove);
    window.addEventListener('pointerdown', mouseDown);
    window.addEventListener('pointerup', mouseUp);
    canvas.addEventListener('contextmenu', contextMenu);
    window.addEventListener('blur', blur);
    this.removers.push(() => window.removeEventListener('keydown', keyDown), () => window.removeEventListener('keyup', keyUp), () => window.removeEventListener('pointermove', mouseMove), () => window.removeEventListener('pointerdown', mouseDown), () => window.removeEventListener('pointerup', mouseUp), () => canvas.removeEventListener('contextmenu', contextMenu), () => window.removeEventListener('blur', blur));
  }
  private isEditing(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
  }
  sample(resolveAim: (clientX: number, clientY: number) => Vec3 | null): InputFrame {
    const frame: InputFrame = {
      moveX: Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')),
      moveZ: Number(this.held.has('KeyS')) - Number(this.held.has('KeyW')),
      aimGround: resolveAim(this.mouseX, this.mouseY),
      sprintHeld: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      dashPressed: this.pressed.has('Space'), meleeHeld: this.melee,
      rangedHeld: this.ranged, rangedReleased: this.rangedRelease, magicPressed: this.pressed.has('KeyQ'),
      interactHeld: this.held.has('KeyE'), interactPressed: this.pressed.has('KeyE'),
      bandagePressed: this.pressed.has('KeyR'), pausePressed: this.pressed.has('Escape'),
    };
    this.pressed.clear();
    this.rangedRelease = false;
    return frame;
  }
  clear(): void { this.held.clear(); this.pressed.clear(); this.melee = false; this.ranged = false; this.rangedRelease = false; }
  dispose(): void { for (const remove of this.removers) remove(); this.clear(); }
}
