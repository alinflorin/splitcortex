import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  Fog,
  GridHelper,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Brand colours from the logo: violet, mint, cyan. */
const VIOLET = '#6c7bf2';
const MINT = '#2ce6c5';
const CYAN = '#14b8d4';
const DEEP_VIOLET = '#4a5be6';
const DEEP_TEAL = '#0e9f8a';

const RACKS_PER_SIDE = 18;
const RACK_STEP = 3.2;
const RACK_X = 3.9;
const HUB_Z = -66;
const PULSES_PER_CABLE = 2;

export interface TourScene {
  /** Scroll position through the tour, 0..1. */
  setProgress(p: number): void;
  /** Pointer in -1..1, for a small parallax. */
  setPointer(x: number, y: number): void;
  setTheme(mode: 'light' | 'dark'): void;
  resize(width: number, height: number): void;
  render(time: number): void;
  dispose(): void;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Small deterministic random, so the layout is the same on every visit.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function createTourScene(
  canvas: HTMLCanvasElement,
  { lowPower }: { lowPower: boolean },
): TourScene {
  const renderer = new WebGLRenderer({ canvas, antialias: !lowPower, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1 : 1.75));

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 200);
  const rand = rng(7);

  const ambient = new AmbientLight('#ffffff', 1);
  const camLight = new PointLight('#ffffff', 40, 40, 1.6);
  const hubLight = new PointLight(MINT, 300, 60, 1.6);
  hubLight.position.set(0, 3, HUB_Z + 4);
  scene.add(ambient, camLight, hubLight);

  // ground
  const gridDark = new GridHelper(130, 65, new Color(VIOLET), new Color('#222a6b'));
  const gridLight = new GridHelper(130, 65, new Color('#a9b3f3'), new Color('#d9def8'));
  for (const g of [gridDark, gridLight]) {
    g.position.set(0, 0, -30);
    scene.add(g);
  }

  // racks: one instanced body, three instanced device shapes on their fronts
  const rackCount = RACKS_PER_SIDE * 2;
  const rackMat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  const racks = new InstancedMesh(new BoxGeometry(1.7, 3.6, 1.5), rackMat, rackCount);
  scene.add(racks);

  const deviceMat = new MeshBasicMaterial();
  const phones = new InstancedMesh(new BoxGeometry(0.2, 0.36, 0.05), deviceMat, rackCount * 16);
  const pis = new InstancedMesh(new BoxGeometry(0.4, 0.26, 0.06), deviceMat, rackCount * 8);
  const laptops = new InstancedMesh(new BoxGeometry(0.62, 0.38, 0.04), deviceMat, rackCount * 4);
  scene.add(phones, pis, laptops);

  const m = new Matrix4();
  const palette = [new Color(VIOLET), new Color(MINT), new Color(CYAN)] as [Color, Color, Color];
  const pick = () => palette[Math.floor(rand() * 3)] as Color;
  const darkRack = new Color('#161c52');
  const lightRack = new Color('#ffffff');
  let phoneN = 0;
  let piN = 0;
  let laptopN = 0;
  const cables: CatmullRomCurve3[] = [];

  let r = 0;
  for (let i = 0; i < RACKS_PER_SIDE; i++) {
    for (const side of [-1, 1]) {
      const z = -i * RACK_STEP - 4;
      const x = side * RACK_X;
      m.makeTranslation(x, 1.8, z);
      racks.setMatrixAt(r++, m);
      // devices sit on the face that looks at the aisle
      const faceX = x - side * 0.88;
      for (let row = 0; row < 8; row++) {
        const y = 0.45 + row * 0.4;
        const kind = rand();
        if (kind < 0.5) {
          for (let c = 0; c < 2; c++) {
            m.makeTranslation(faceX, y, z + (c - 0.5) * 0.7);
            m.multiply(new Matrix4().makeRotationY(Math.PI / 2));
            phones.setMatrixAt(phoneN, m);
            phones.setColorAt(phoneN++, pick());
          }
        } else if (kind < 0.8) {
          m.makeTranslation(faceX, y, z);
          m.multiply(new Matrix4().makeRotationY(Math.PI / 2));
          pis.setMatrixAt(piN, m);
          pis.setColorAt(piN++, pick());
        } else {
          m.makeTranslation(faceX, y, z);
          m.multiply(new Matrix4().makeRotationY(Math.PI / 2));
          laptops.setMatrixAt(laptopN, m);
          laptops.setColorAt(laptopN++, pick());
        }
      }
      // cable: from the rack's foot, along the floor, up into the hub
      cables.push(
        new CatmullRomCurve3([
          new Vector3(faceX, 0.1, z),
          new Vector3(side * 1.2, 0.05, z),
          new Vector3(side * 0.6, 0.05, (z + HUB_Z) / 2),
          new Vector3(0, 1.2, HUB_Z + 3),
        ]),
      );
    }
  }
  phones.count = phoneN;
  pis.count = piN;
  laptops.count = laptopN;

  const cableMat = new LineBasicMaterial({ transparent: true, opacity: 0.5 });
  for (const curve of cables) {
    scene.add(new Line(new BufferGeometry().setFromPoints(curve.getPoints(40)), cableMat));
  }

  const pulseMat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  const pulses = new InstancedMesh(
    new SphereGeometry(1, 8, 8),
    pulseMat,
    cables.length * PULSES_PER_CABLE,
  );
  scene.add(pulses);

  // hub at the end of the aisle
  const hub = new Group();
  hub.position.set(0, 3, HUB_Z);
  const hubShell = new MeshBasicMaterial({ wireframe: true });
  const hubCore = new MeshBasicMaterial({ color: MINT });
  const ringA = new MeshBasicMaterial({ transparent: true, opacity: 0.8 });
  const ringB = new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 });
  const shell = new Mesh(new IcosahedronGeometry(2.6, 1), hubShell);
  const core = new Mesh(new SphereGeometry(1.1, 24, 24), hubCore);
  const ring1 = new Mesh(new TorusGeometry(3.6, 0.04, 8, 80), ringA);
  const ring2 = new Mesh(new TorusGeometry(4.4, 0.04, 8, 80), ringB);
  ring1.rotation.x = Math.PI / 2.4;
  ring2.rotation.y = Math.PI / 2.8;
  hub.add(shell, core, ring1, ring2);
  scene.add(hub);

  // chapter 1-2: a desk with forgotten devices, just before the aisle
  const DESK_Z = 8;
  const desk = new Group();
  const deskMat = new MeshStandardMaterial({ roughness: 0.7 });
  const deskTop = new Mesh(new BoxGeometry(3.6, 0.5, 1.8), deskMat);
  deskTop.position.set(0, 0.25, DESK_Z);
  const deskDevices = [
    {
      mat: new MeshBasicMaterial(),
      size: [0.5, 0.9, 0.07],
      pos: [-1.1, 0.95, DESK_Z],
      rotX: -0.25,
    },
    { mat: new MeshBasicMaterial(), size: [0.9, 0.1, 0.6], pos: [0, 0.55, DESK_Z + 0.1], rotX: 0 },
    {
      mat: new MeshBasicMaterial(),
      size: [1.1, 0.7, 0.05],
      pos: [1.1, 0.95, DESK_Z - 0.2],
      rotX: -0.2,
    },
  ] as const;
  desk.add(deskTop);
  for (const d of deskDevices) {
    const mesh = new Mesh(new BoxGeometry(...d.size), d.mat);
    mesh.position.set(...d.pos);
    mesh.rotation.x = d.rotX;
    desk.add(mesh);
  }
  const laptopBase = new Mesh(new BoxGeometry(1.1, 0.06, 0.75), deskDevices[2].mat);
  laptopBase.position.set(1.1, 0.53, DESK_Z + 0.2);
  desk.add(laptopBase);
  const enrollMat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  const enrollRing = new Mesh(new TorusGeometry(1, 0.025, 8, 96), enrollMat);
  enrollRing.rotation.x = Math.PI / 2;
  enrollRing.position.set(0, 0.6, DESK_Z);
  desk.add(enrollRing);
  scene.add(desk);
  const deskBrand = [new Color(VIOLET), new Color(MINT), new Color(CYAN)];
  const idle = new Color();

  // chapter 4: an app, the gateway (the hub), one device, and a request travelling between them
  const APP = new Vector3(9, 7, -8);
  const GATE = new Vector3(0, 3, HUB_Z + 4.5);
  const DEVICE = new Vector3(-3.0, 2.8, -8 * RACK_STEP - 4);
  const appMat = new MeshBasicMaterial({ transparent: true });
  const appPanel = new Mesh(new BoxGeometry(1.6, 1, 0.08), appMat);
  appPanel.position.copy(APP);
  scene.add(appPanel);
  const legMat = new LineBasicMaterial({ transparent: true });
  for (const [a, b] of [
    [APP, GATE],
    [GATE, DEVICE],
    [DEVICE, APP],
  ] as const) {
    scene.add(new Line(new BufferGeometry().setFromPoints([a, b]), legMat));
  }
  const FLOW = 9; // 1 request + 8 streamed tokens
  const flowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  const flow = new InstancedMesh(new SphereGeometry(1, 10, 10), flowMat, FLOW);
  flow.frustumCulled = false;
  scene.add(flow);

  // the flight: desk, enrolment, down the aisle, then a side view of the request path
  const stops: [number[], number[]][] = [
    [
      [2.2, 2.0, 14],
      [0, 0.9, DESK_Z],
    ],
    [
      [1.2, 1.6, 12],
      [0, 0.9, DESK_Z],
    ],
    [
      [0, 4.6, 14],
      [0, 0.8, 4],
    ],
    [
      [0.6, 2.6, -6],
      [0, 2, -30],
    ],
    [
      [-0.5, 2.2, -32],
      [0, 2, -50],
    ],
    [
      [15, 9.5, -6],
      [0, 3, -26],
    ],
    [
      [13, 8, 12],
      [0, 3.2, -14],
    ],
  ];
  const path = new CatmullRomCurve3(
    stops.map(([p]) => new Vector3(...(p as [number, number, number]))),
  );
  const look = new CatmullRomCurve3(
    stops.map(([, l]) => new Vector3(...(l as [number, number, number]))),
  );

  // bloom only in dark and not on low power; light mode stays crisp
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.5, 0.5, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let mode: 'light' | 'dark' = 'dark';
  let progress = 0;
  const pointer = { x: 0, y: 0 };
  const tmp = new Vector3();
  const tmpLook = new Vector3();

  function setTheme(next: 'light' | 'dark') {
    mode = next;
    const light = next === 'light';
    const bg = light ? '#eef1ff' : '#0a0e2b';
    scene.background = new Color(bg);
    scene.fog = new Fog(bg, 18, light ? 70 : 62);
    ambient.intensity = light ? 2.1 : 1.4;
    ambient.color.set(light ? '#ffffff' : VIOLET);
    camLight.intensity = light ? 40 : 90;
    hubLight.intensity = light ? 160 : 400;
    gridDark.visible = !light;
    gridLight.visible = light;
    rackMat.color.copy(light ? lightRack : darkRack);
    cableMat.color.set(light ? DEEP_VIOLET : MINT);
    cableMat.opacity = light ? 0.55 : 0.45;
    pulseMat.blending = light ? NormalBlending : AdditiveBlending;
    pulseMat.color.set(light ? DEEP_TEAL : MINT);
    pulseMat.needsUpdate = true;
    hubShell.color.set(light ? DEEP_VIOLET : VIOLET);
    ringA.color.set(light ? DEEP_VIOLET : VIOLET);
    bloom.enabled = !light && !lowPower;
    deskMat.color.set(light ? '#ffffff' : '#161c52');
    idle.set(light ? '#a3a9c9' : '#3a4070');
    enrollMat.color.set(light ? DEEP_TEAL : MINT);
    enrollMat.blending = light ? NormalBlending : AdditiveBlending;
    enrollMat.needsUpdate = true;
    appMat.color.set(light ? DEEP_VIOLET : CYAN);
    appMat.opacity = 0.9;
    legMat.color.set(light ? DEEP_VIOLET : CYAN);
    flowMat.blending = light ? NormalBlending : AdditiveBlending;
    flowMat.color.set(light ? DEEP_TEAL : MINT);
    flowMat.needsUpdate = true;
  }
  setTheme('dark');

  function render(time: number) {
    const t = time / 1000;
    // camera on the path, a little off by the pointer
    path.getPoint(progress, tmp);
    look.getPoint(progress, tmpLook);
    camera.position.set(tmp.x + pointer.x * 0.6, tmp.y - pointer.y * 0.35, tmp.z);
    camera.lookAt(tmpLook);
    camLight.position.copy(camera.position);

    hub.rotation.y = t * 0.35;
    ring1.rotation.z = t * 0.6;
    ring2.rotation.x = t * 0.45;
    const beat = 1 + Math.sin(t * 2.2) * 0.06;
    core.scale.setScalar(beat);

    // enrolment: the desk devices light up, a ring spreads out, the fleet wakes up
    // the side view at the end sees the whole line, so the fog has to thin out
    if (scene.fog instanceof Fog) {
      scene.fog.near = 18 + 60 * smooth(0.6, 0.85, progress);
      scene.fog.far = (mode === 'light' ? 70 : 62) + 90 * smooth(0.6, 0.85, progress);
    }
    const reveal = smooth(0.3, 0.42, progress);
    deskDevices.forEach((d, n) => d.mat.color.lerpColors(idle, deskBrand[n] as Color, reveal));
    const wave = smooth(0.28, 0.5, progress);
    enrollRing.scale.setScalar(0.6 + wave * 7);
    enrollMat.opacity = wave > 0 && wave < 1 ? (1 - wave) * 0.9 : 0;
    deviceMat.color.setScalar(0.28 + 0.72 * reveal);
    cableMat.opacity = (mode === 'light' ? 0.55 : 0.45) * reveal;

    // request path
    const vis = smooth(0.66, 0.76, progress);
    appPanel.visible = vis > 0;
    appMat.opacity = 0.9 * vis;
    legMat.opacity = 0.45 * vis;
    const ph = (t * 0.22) % 1;
    const big = mode === 'light' ? 0.4 : 0.5;
    const small = mode === 'light' ? 0.22 : 0.26;
    const setFlow = (n: number, from: Vector3, to: Vector3, u: number, sz: number) => {
      m.makeScale(sz * vis, sz * vis, sz * vis);
      m.setPosition(tmp.lerpVectors(from, to, u));
      flow.setMatrixAt(n, m);
    };
    const hide = (n: number) => {
      m.makeScale(0, 0, 0);
      flow.setMatrixAt(n, m);
    };
    if (ph < 0.4) setFlow(0, APP, GATE, ph / 0.4, big);
    else if (ph < 0.6) setFlow(0, GATE, DEVICE, (ph - 0.4) / 0.2, big);
    else hide(0);
    for (let k = 0; k < FLOW - 1; k++) {
      const u = (ph - 0.6) / 0.4 - k * 0.06;
      if (ph >= 0.6 && u >= 0 && u <= 1) setFlow(k + 1, DEVICE, APP, u, small);
      else hide(k + 1);
    }
    flow.instanceMatrix.needsUpdate = true;

    const size = (mode === 'light' ? 0.13 : 0.22) * reveal;
    const p = new Vector3();
    for (let c = 0; c < cables.length; c++) {
      for (let k = 0; k < PULSES_PER_CABLE; k++) {
        // pulses run from the devices to the hub, offset per cable
        const u = (t * 0.18 + c * 0.137 + k / PULSES_PER_CABLE) % 1;
        (cables[c] as CatmullRomCurve3).getPointAt(u, p);
        m.makeScale(size, size, size);
        m.setPosition(p);
        pulses.setMatrixAt(c * PULSES_PER_CABLE + k, m);
      }
    }
    pulses.instanceMatrix.needsUpdate = true;

    if (bloom.enabled) composer.render();
    else renderer.render(scene, camera);
  }

  return {
    setProgress: (p) => {
      progress = Math.max(0, Math.min(1, p));
    },
    setPointer: (x, y) => {
      pointer.x = x;
      pointer.y = y;
    },
    setTheme,
    resize: (w, h) => {
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      // narrow screens need a wider view to fit both racks
      camera.fov = w / h < 0.9 ? 75 : 55;
      camera.updateProjectionMatrix();
    },
    render,
    dispose: () => {
      scene.traverse((o) => {
        const mesh = o as Mesh;
        mesh.geometry?.dispose();
      });
      composer.dispose();
      renderer.dispose();
    },
  };
}
