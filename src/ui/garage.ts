import GUI, { type Controller } from 'lil-gui';
import type { GameCar } from '../game/GameCar';
import { CARS } from '../game/catalog';
import { curvePeaks, PRESETS, stockTune, type Tune, type TuneKey } from '../vehicle/tuning';

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
export class Garage {
  readonly gui: GUI;
  private tune: Tune;
  private readonly choice: { car: string };
  private readonly ranged: { c: Controller; max: (stock: Tune) => number }[] = [];
  private readonly info: { power: string };

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
    gui.add(this.choice, 'car', Object.fromEntries(CARS.map((c) => [c.name, c.id]))).name('Car').onChange((id: string) => onSwap(id));

    const presets = gui.addFolder('Setups');
    for (const name of Object.keys(PRESETS)) {
      presets.add({ [name]: () => this.preset(name) }, name).name(name === 'Stock' ? 'Stock (factory)' : name === 'Drift' ? 'Drift' : 'Track (grip)');
    }

    const t = this.tune;
    const num = (folder: GUI, key: TuneKey, name: string, min: number, max: number, step: number): Controller =>
      folder.add(t, key, min, max, step).name(name).onChange(() => this.changed());

    const steer = gui.addFolder('Steering');
    num(steer, 'steerLock', 'Lock (deg)', 20, 70, 0.5);
    num(steer, 'steerAssist', 'Steering assist (%)', 0, 100, 1);
    num(steer, 'stability', 'Stability assist (%)', 0, 100, 1);
    num(steer, 'slideControl', 'Slide control (%)', 0, 100, 1);
    num(steer, 'steerSpeed', 'Steering speed (x)', 0.5, 2.5, 0.05);

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
  }

  /** Bind the panel to the current player car (after a swap) and apply its saved setup. */
  attach(): void {
    const car = this.getCar();
    Object.assign(this.tune, loadTune(car));
    this.choice.car = car.def.id;
    const stock = stockTune(car.def.cfg);
    for (const r of this.ranged) r.c.max(r.max(stock));
    car.applyTune(this.tune);
    this.refresh();
  }

  toggle(): void {
    if (this.gui._closed) this.gui.open();
    else this.gui.close();
  }

  private preset(name: string): void {
    const car = this.getCar();
    const keepBox = this.tune.gearbox;
    Object.assign(this.tune, PRESETS[name]!(stockTune(car.def.cfg)), { gearbox: keepBox });
    this.changed();
  }

  private changed(): void {
    const car = this.getCar();
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
