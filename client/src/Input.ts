// Teclado, mouse com Pointer Lock e mira (yaw/pitch).

export class Input {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  mouseDown = false;
  /** Cliques ainda não processados (um toque rápido não se perde entre frames). */
  clicks = 0;
  rightDown = false;
  locked = false;
  /** Mapa de alvo aberto: o mouse move um cursor (cursorDX/DY) em vez da câmera. */
  cursorMode = false;
  cursorDX = 0;
  cursorDY = 0;
  private pressed = new Set<string>();
  private wheel = 0;
  private recoilPitch = 0;

  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    addEventListener('keydown', (e) => {
      if (!this.locked && e.code !== 'Tab') return;
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.rightDown = false; });

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this.cursorMode) { this.cursorDX += e.movementX; this.cursorDY += e.movementY; return; }
      this.yaw -= e.movementX * this.sensitivity * this.sensScale;
      this.pitch -= e.movementY * this.sensitivity * this.sensScale;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseDown = true; this.clicks++; }
      if (e.button === 2) this.rightDown = true;
      if (e.button === 3 || e.button === 4) this.pressed.add('Melee');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (new URLSearchParams(location.search).has('debug')) return;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = false; this.rightDown = false; this.keys.clear(); }
    });
  }

  /** Reduz a sensibilidade ao mirar com a sniper. */
  sensScale = 1;

  lock(): void {
    // ?debug: dispensa o Pointer Lock (útil em navegadores embutidos / testes)
    if (new URLSearchParams(location.search).has('debug')) {
      this.locked = true;
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    try {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch { /* navegador sem Pointer Lock */ }
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Verdadeiro uma única vez por pressionamento. */
  consume(code: string): boolean {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  /** Recuo: sobe a mira e devolve parte suavemente. */
  kick(amount: number, yaw = 0): void {
    this.pitch = Math.min(1.5, this.pitch + amount);
    this.yaw += yaw;
    this.recoilPitch += amount * 0.55;
  }

  update(dt: number): void {
    if (this.recoilPitch > 0) {
      const back = Math.min(this.recoilPitch, dt * 0.25);
      this.recoilPitch -= back;
      this.pitch -= back;
    }
  }

  move(): { f: number; s: number } {
    const f = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    const s = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    return { f, s };
  }
}
