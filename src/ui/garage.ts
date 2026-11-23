import GUI, { type Controller } from 'lil-gui';
import type { GameCar } from '../game/GameCar';
import { CARS } from '../game/catalog';
import { curvePeaks, PRESETS, stockTune, suggestFinalDrive, type Tune, type TuneKey } from '../vehicle/tuning';

const KEY = (id: string): string => `open-road:tune:${id}`;

/** The saved setup for a car, on top of its factory setup (so new settings get their stock value). */
export function loadTune(car: GameCar): Tune {
  const stock = stockTune(car.def.cfg);
  try {
    const raw = localStorage.getItem(KEY(car.def.id));
    if (raw) return { ...stock, ...(JSON.parse(raw) as Partial<Tune>) };
  } catch {
    /* storage unavailable or corrupt: factory setup */
  }
  return stock;
}

function saveTune(id: string, t: Tune): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(t));
  } catch {
    /* storage unavailable: setup lasts for this session */
  }
}

/**
 * Garage panel (lil-gui): car choice, ready-made setups and every setting, applied live and saved
 * per car.
 */
/** The aircraft's entry in the vehicle menu. */
export const PLANE_ID = 'plane';

export class Garage {
  readonly gui: GUI;
  private tune: Tune;
  private readonly choice: { car: string };
  private readonly ranged: { c: Controller; max: (stock: Tune) => number }[] = [];
  private readonly info: { power: string };
  private followGearing = true;

  constructor(
    private getCar: () => GameCar,
    onSwap: (id: string) => void,
  ) {
    const car = getCar();
    this.tune = loadTune(car);
    this.choice = { car: car.def.id };
    this.info = { power: '' };
    const gui = new GUI({ title: 'Garage (G)' });
    this.gui = gui;
    // Every vehicle, the aircraft included: choosing one takes over where you are, at your speed.
    gui
      .add(this.choice, 'car', { ...Object.fromEntries(CARS.map((c) => [c.name, c.id])), 'Cirrus SR22 (aircraft)': PLANE_ID })
      .name('Vehicle')
      .onChange((id: string) => onSwap(id));

    const presets = gui.addFolder('Setups');
    for (const name of Object.keys(PRESETS)) {
      presets.add({ [name]: () => this.preset(name) }, name).name(name === 'Stock' ? 'Stock (factory)' : name === 'Track' ? 'Track (grip)' : name === 'Rally' ? 'Rally (gravel and drift)' : name);
    }

    const t = this.tune;
    const num = (folder: GUI, key: TuneKey, name: string, min: number, max: number, step: number): Controller =>
      folder.add(t, key, min, max, step).name(name).onChange(() => this.changed(key));

    const steer = gui.addFolder('Steering');
    num(steer, 'steerLock', 'Lock (deg)', 20, 70, 0.5);
    num(steer, 'steerAssist', 'Steering assist (%)', 0, 100, 1);
    num(steer, 'stability', 'Stability assist (%)', 0, 100, 1);
    num(steer, 'slideControl', 'Slide control (%)', 0, 100, 1);
    num(steer, 'steerSpeed', 'Steering speed (x)', 0.5, 2.5, 0.05);
    num(steer, 'arcade', 'Arcade grip (%)', 0, 100, 1);
    num(steer, 'driftAssist', 'Drift assist (%)', 0, 100, 1);

    const eng = gui.addFolder('Engine');
    this.ranged.push({ c: num(eng, 'power', 'Power (hp)', 50, 1200, 1), max: (s) => Math.max(1200, s.power * 2.5) });
    this.ranged.push({ c: num(eng, 'torque', 'Torque (N m)', 100, 1500, 1), max: (s) => Math.max(1500, s.torque * 2.5) });
    num(eng, 'redline', 'Rev limit (rpm)', 4000, 10000, 100);
    eng.add(this.info, 'power').name('Peak').disable();

    const drv = gui.addFolder('Driveline');
    drv.add(t, 'drive', ['FWD', 'RWD', 'AWD']).name('Drive').onChange(() => this.changed());
    num(drv, 'frontBias', 'AWD front share (%)', 10, 90, 1);
    num(drv, 'diffLock', 'Diff lock (%)', 0, 100, 1);
    num(drv, 'finalDrive', 'Final drive', 2, 6, 0.01);
    drv.add(t, 'gearbox', ['auto', 'manual']).name('Gearbox').onChange(() => this.changed());

    const sus = gui.addFolder('Suspension');
    num(sus, 'rideHeight', 'Ride height (cm)', -8, 12, 0.5);
    num(sus, 'springFront', 'Front springs (N/mm)', 10, 150, 0.5);
    num(sus, 'springRear', 'Rear springs (N/mm)', 10, 150, 0.5);
    num(sus, 'damping', 'Dampers (x)', 0.5, 2, 0.05);
    num(sus, 'arbFront', 'Front anti-roll bar (N/mm)', 0, 60, 0.5);
    num(sus, 'arbRear', 'Rear anti-roll bar (N/mm)', 0, 60, 0.5);

    const wh = gui.addFolder('Wheels and tyres');
    num(wh, 'trackFront', 'Front track (+cm)', -6, 20, 0.5);
    num(wh, 'trackRear', 'Rear track (+cm)', -6, 20, 0.5);
    num(wh, 'camberFront', 'Front camber (deg)', -10, 3, 0.1);
    num(wh, 'camberRear', 'Rear camber (deg)', -10, 3, 0.1);
    num(wh, 'tireFront', 'Front tyre width (mm)', 175, 355, 5);
    num(wh, 'tireRear', 'Rear tyre width (mm)', 175, 355, 5);
    num(wh, 'grip', 'Tyre grip (x)', 0.6, 1.5, 0.01);
    num(wh, 'rearGrip', 'Rear grip balance (x)', 0.7, 1.3, 0.01);
    num(wh, 'slideGrip', 'Grip while sliding (%)', 60, 97, 1);
    num(wh, 'looseGrip', 'Dirt and grass grip (x)', 0.5, 1.6, 0.01);

    const br = gui.addFolder('Brakes');
    num(br, 'brakes', 'Brake power (x)', 0.5, 2, 0.05);
    num(br, 'brakeBias', 'Front bias (%)', 40, 80, 1);
    num(br, 'handbrake', 'Handbrake (x)', 0.5, 4, 0.1);

    const ch = gui.addFolder('Chassis');
    num(ch, 'mass', 'Mass (kg)', 800, 3500, 10);
    num(ch, 'weightFront', 'Weight on front (%)', 35, 65, 0.5);
    num(ch, 'downforce', 'Downforce (Cl A)', 0, 4, 0.05);

    const aids = gui.addFolder('Driving aids');
    aids.add(t, 'tc').name('Traction control').onChange(() => this.changed());
    aids.add(t, 'abs').name('ABS').onChange(() => this.changed());
    aids.add(t, 'esp').name('ESP').onChange(() => this.changed());

    const credits = gui.addFolder('Credits (CC BY 4.0)');
    for (const [car, author] of [
      ["Thunderbolt '96", 'Daniel Zhabotinsky'],
      ["Bokaroo '67", 'Daniel Zhabotinsky'],
      ['V12 Goblin', 'ollitei'],
    ]) {
      credits.add({ [car]: `${author} (Sketchfab)` }, car).disable();
    }

    for (const f of gui.folders) f.close();
    presets.open();
    gui.close();
    this.attach();
    this.giveKeysBack();
  }

  /**
   * After a click or a change in the panel, hand the keyboard back to the game: otherwise the
   * focused menu, checkbox or button keeps the keys (and Space would press the button again).
   * Only a value field the player clicked into keeps them, to type a number (Enter gives them back).
   * A menu keeps the focus while it is open, then lets go once a choice is made or a key is pressed.
   */
  private giveKeysBack(): void {
    const el = this.gui.domElement;
    const release = (keepTyping: boolean): void => {
      const a = document.activeElement;
      if (!(a instanceof HTMLElement) || !el.contains(a)) return;
      if (keepTyping && a instanceof HTMLInputElement && (a.type === 'text' || a.type === 'number')) return;
      a.blur();
    };
    el.addEventListener('pointerup', (e) => {
      // A menu must keep the focus while its list is open.
      if (e.target instanceof HTMLSelectElement) return;
      const typing = e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number');
      // After lil-gui has handled the click.
      window.setTimeout(() => release(typing), 0);
    });
    el.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type === 'checkbox')) release(false);
    });
    // lil-gui stops key events inside the panel from reaching the page. A key pressed while a menu,
    // box or button of the panel has the focus is meant for the car: let go of the focus (so the
    // menu does not take the arrows or letters as a new choice) and pass the key on to the game.
    // Key releases always go on, or a key let go over the panel would stay held down.
    const forward = (type: 'keydown' | 'keyup', e: KeyboardEvent): void => {
      window.dispatchEvent(new KeyboardEvent(type, { code: e.code, key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat }));
    };
    el.addEventListener(
      'keydown',
      (e) => {
        const a = document.activeElement;
        if (e.key === 'Tab' || !(a instanceof HTMLElement) || !el.contains(a)) return;
        if (a instanceof HTMLInputElement && (a.type === 'text' || a.type === 'number')) return;
        e.preventDefault();
        e.stopPropagation();
        a.blur();
        forward('keydown', e);
      },
      true,
    );
    el.addEventListener('keyup', (e) => forward('keyup', e), true);
  }

  /** Bind the panel to the current player car (after a swap) and apply its saved setup. */
  attach(): void {
    const car = this.getCar();
    this.followGearing = true;
    Object.assign(this.tune, loadTune(car));
    this.choice.car = car.def.id;
    const stock = stockTune(car.def.cfg);
    for (const r of this.ranged) r.c.max(r.max(stock));
    car.applyTune(this.tune);
    this.refresh();
  }

  /** Show the vehicle actually in use in the menu: the aircraft, or the car (after a refused or failed swap). */
  syncCar(flying = false): void {
    this.choice.car = flying ? PLANE_ID : this.getCar().def.id;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  toggle(): void {
    if (this.gui._closed) this.gui.open();
    else this.gui.close();
  }

  private preset(name: string): void {
    const car = this.getCar();
    const keepBox = this.tune.gearbox;
    Object.assign(this.tune, PRESETS[name]!(stockTune(car.def.cfg), car.def.cfg), { gearbox: keepBox });
    this.followGearing = true;
    this.changed();
  }

  private changed(key?: TuneKey): void {
    const car = this.getCar();
    // The gearing follows the power (a stronger engine reaches a higher top speed instead of
    // hitting the rev limiter in top gear), until the final drive is set by hand.
    if (key === 'finalDrive') this.followGearing = false;
    if (key === 'power' && this.followGearing) this.tune.finalDrive = suggestFinalDrive(car.def.cfg, this.tune);
    car.applyTune(this.tune);
    saveTune(car.def.id, this.tune);
    this.refresh();
  }

  private refresh(): void {
    const e = this.getCar().vehicle.cfg.engine;
    const pk = curvePeaks(e.torqueCurve, e.redlineRpm);
    this.info.power = `${Math.round(pk.power / 745.7)} hp @ ${pk.powerRpm} rpm, ${Math.round(pk.torque)} N m`;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
