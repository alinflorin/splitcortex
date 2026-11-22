import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  LineLoop,
  PlaneGeometry,
  SRGBColorSpace,
  TubeGeometry,
  CatmullRomCurve3,
  Color,
  Fog,
  GridHelper,
  IcosahedronGeometry,
  Group,
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
  Sprite,
  SpriteMaterial,
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
  const hubLight = new PointLight('#ffffff', 300, 60, 1.6);
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
  const ringA = new MeshBasicMaterial({ transparent: true, opacity: 0.8 });
  const ringB = new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 });
  const ring1 = new Mesh(new TorusGeometry(3.6, 0.04, 8, 80), ringA);
  const ring2 = new Mesh(new TorusGeometry(4.4, 0.04, 8, 80), ringB);
  ring1.rotation.x = Math.PI / 2.4;
  ring2.rotation.y = Math.PI / 2.8;
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    if (!g) return undefined;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  })();
  const glowMat = new SpriteMaterial({
    map: glowTex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const glow = new Sprite(glowMat);
  glow.scale.setScalar(13);
  const R = 2.2;
  const leftMat = new MeshBasicMaterial({ side: DoubleSide });
  const rightMat = new MeshBasicMaterial({ side: DoubleSide });
  const mark = new Group();
  mark.position.set(0, 3, HUB_Z);
  const leftHalf = new Mesh(new SphereGeometry(R, 48, 32, -Math.PI / 2, Math.PI), leftMat);
  const rightHalf = new Mesh(new SphereGeometry(R, 48, 32, Math.PI / 2, Math.PI), rightMat);
  leftHalf.position.x = -0.05;
  rightHalf.position.x = 0.05;
  const seamMat = new MeshBasicMaterial({ color: '#dfe4ff' });
  const seam = new Mesh(new TorusGeometry(R, 0.035, 8, 96), seamMat);
  seam.rotation.y = Math.PI / 2;
  const net = new Mesh(
    new IcosahedronGeometry(R + 0.08, 2),
    new MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.08 }),
  );
  mark.add(leftHalf, rightHalf, seam, net);
  scene.add(mark);
  hub.add(glow, ring1, ring2);
  scene.add(hub);

  // chapter 1-2: a desk with forgotten devices, just before the aisle
  const DESK_Z = 8;
  const D = DESK_Z;
  const desk = new Group();
  const deskMat = new MeshStandardMaterial({ roughness: 0.7 });
  const deskTop = new Mesh(new BoxGeometry(3.6, 0.5, 1.8), deskMat);
  deskTop.position.set(0, 0.25, D);
  desk.add(deskTop);

  const bodyMat = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 });
  const metal = new MeshStandardMaterial({ color: '#b9c3d6', roughness: 0.3, metalness: 0.85 });
  const pcbMat = new MeshStandardMaterial({ color: '#1f6b57', roughness: 0.55, metalness: 0.1 });
  const chipMat = new MeshStandardMaterial({ color: '#12172b', roughness: 0.4, metalness: 0.4 });
  const glassMat = new MeshStandardMaterial({ color: '#05070f', roughness: 0.15, metalness: 0.2 });

  // the screens share one gradient with a heartbeat line, shown once enrolled
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    if (!g) return undefined;
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, VIOLET);
    grad.addColorStop(0.55, '#222e76');
    grad.addColorStop(1, MINT);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(30, 140);
    for (const [x, y] of [
      [90, 140],
      [110, 90],
      [135, 190],
      [158, 140],
      [226, 140],
    ] as const)
      g.lineTo(x, y);
    g.stroke();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const screenMat = () =>
    new MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      side: DoubleSide,
    });
  const phoneScreenMat = screenMat();
  const laptopScreenMat = screenMat();

  // phone, lying face up, USB-C on the back edge
  const phone = new Group();
  phone.position.set(-1.1, 0.535, D - 0.05);
  phone.rotation.y = 0.12;
  phone.add(new Mesh(new BoxGeometry(0.5, 0.07, 0.95), bodyMat));
  const phoneGlass = new Mesh(new BoxGeometry(0.45, 0.012, 0.88), glassMat);
  phoneGlass.position.y = 0.037;
  const phoneScreen = new Mesh(new PlaneGeometry(0.43, 0.86), phoneScreenMat);
  phoneScreen.rotation.x = -Math.PI / 2;
  phoneScreen.position.y = 0.045;
  phone.add(phoneGlass, phoneScreen);
  const lens = new Mesh(new SphereGeometry(0.035, 12, 12), chipMat);
  lens.position.set(0.14, -0.04, -0.34);
  phone.add(lens);

  // Raspberry Pi: board, chips, GPIO header, ports
  const pi = new Group();
  pi.position.set(0, 0.52, D + 0.1);
  pi.add(new Mesh(new BoxGeometry(0.95, 0.04, 0.62), pcbMat));
  for (const [x, z, w, d] of [
    [-0.18, -0.02, 0.2, 0.2],
    [0.16, 0.08, 0.17, 0.16],
    [0.3, -0.12, 0.1, 0.1],
  ] as const) {
    const chip = new Mesh(new BoxGeometry(w, 0.05, d), chipMat);
    chip.position.set(x, 0.045, z);
    pi.add(chip);
  }
  const pins = new InstancedMesh(new BoxGeometry(0.014, 0.07, 0.014), metal, 40);
  for (let n = 0; n < 40; n++) {
    m.makeTranslation(-0.45 + (n >> 1) * 0.0475, 0.055, n % 2 ? -0.26 : -0.22);
    pins.setMatrixAt(n, m);
  }
  pi.add(pins);
  for (const x of [-0.3, -0.12, 0.06]) {
    const port = new Mesh(new BoxGeometry(0.14, 0.11, 0.16), metal);
    port.position.set(x, 0.07, 0.25);
    pi.add(port);
  }
  const piLedMat = new MeshBasicMaterial({ toneMapped: false });
  const piLed = new Mesh(new BoxGeometry(0.03, 0.02, 0.03), piLedMat);
  piLed.position.set(0.4, 0.03, 0.2);
  pi.add(piLed);

  // laptop with a lid that opens
  const laptop = new Group();
  laptop.position.set(1.1, 0.525, D + 0.15);
  laptop.add(new Mesh(new BoxGeometry(1.1, 0.05, 0.75), bodyMat));
  const keys = new Mesh(new BoxGeometry(0.96, 0.012, 0.4), chipMat);
  keys.position.set(0, 0.03, -0.06);
  laptop.add(keys);
  const hinge = new Group();
  hinge.position.set(0, 0.025, -0.375);
  const lid = new Mesh(new BoxGeometry(1.1, 0.7, 0.03), bodyMat);
  lid.position.y = 0.35;
  const lidScreen = new Mesh(new PlaneGeometry(1.0, 0.6), laptopScreenMat);
  lidScreen.position.set(0, 0.35, 0.018);
  hinge.add(lid, lidScreen);
  laptop.add(hinge);
  desk.add(phone, pi, laptop);

  // cables leave each device and run down the aisle to the hub: the devices feed the fleet
  const SEG = 240;
  const plugs = [
    { port: new Vector3(-1.1, 0.545, D - 0.54), dir: new Vector3(0, 0, -1) },
    { port: new Vector3(0.3, 0.56, D - 0.22), dir: new Vector3(0, 0, -1) },
    { port: new Vector3(1.66, 0.56, D + 0.15), dir: new Vector3(1, 0, 0) },
  ].map(({ port, dir }) => {
    const away = port.clone().addScaledVector(dir, 0.3);
    const tail = [
      new Vector3(port.x * 0.4, 0.03, D - 7),
      new Vector3(port.x * 0.1, 0.03, -20),
      new Vector3(0, 0.05, -45),
      new Vector3(0, 1.2, HUB_Z + 3),
    ];
    const start =
      dir.x === 0
        ? [
            away,
            new Vector3(port.x, 0.62, D - 0.8),
            new Vector3(port.x, 0.4, D - 1.05),
            new Vector3(port.x, 0.03, D - 1.3),
          ]
        : [
            away,
            new Vector3(1.9, 0.62, D + 0.15),
            new Vector3(1.95, 0.4, D + 0.1),
            new Vector3(1.95, 0.03, D - 0.5),
          ];
    const curve = new CatmullRomCurve3([...start, ...tail]);
    const geo = new TubeGeometry(curve, SEG, 0.022, 6, false);
    const mat = new MeshBasicMaterial({ toneMapped: false });
    const cable = new Mesh(geo, mat);
    cable.frustumCulled = false;
    const plug = new Mesh(new BoxGeometry(0.09, 0.05, 0.12), metal);
    plug.rotation.y = dir.x === 0 ? 0 : Math.PI / 2;
    desk.add(cable, plug);
    return { geo, mat, cable, plug, port, dir, curve };
  });
  const DESK_PULSES = 5;
  const deskPulses = new InstancedMesh(
    new SphereGeometry(1, 8, 8),
    pulseMat,
    plugs.length * DESK_PULSES,
  );
  deskPulses.frustumCulled = false;
  scene.add(deskPulses);

  // identity glyphs: a key/shield outline floats above each device when it enrols
  const shieldMat = new LineBasicMaterial({ transparent: true, opacity: 0 });
  const shieldGeo = new BufferGeometry().setFromPoints(
    [
      [-0.2, 0.08],
      [0, 0.28],
      [0.2, 0.08],
      [0.15, -0.15],
      [0, -0.29],
      [-0.15, -0.15],
    ].map(([x, y]) => new Vector3(x, y, 0)),
  );
  for (const x of [-1.1, 0, 1.1]) {
    const shield = new LineLoop(shieldGeo, shieldMat);
    shield.position.set(x, 1.75, D);
    desk.add(shield);
  }

  const enrollMat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  const enrollRing = new Mesh(new TorusGeometry(1, 0.025, 8, 96), enrollMat);
  enrollRing.rotation.x = Math.PI / 2;
  enrollRing.position.set(0, 0.6, D);
  desk.add(enrollRing);
  scene.add(desk);
  const idle = new Color();
  const mintColor = new Color(MINT);

  // chapter 4: an app, the gateway (the hub), one device, and a request travelling between them
  const APP = new Vector3(9, 7, -8);
  const GATE = new Vector3(0, 3, HUB_Z + 4.5);
  const DEVICE = new Vector3(-3.0, 2.8, -8 * RACK_STEP - 4);
  const DEVICE2 = new Vector3(3.0, 2.8, -4 * RACK_STEP - 4);
  const appMat = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  const appBarMat = new MeshBasicMaterial({ transparent: true, toneMapped: false });
  const appPanel = new Group();
  appPanel.position.copy(APP);
  appPanel.rotation.y = 0.9;
  appPanel.add(new Mesh(new PlaneGeometry(1.8, 1.2), appMat));
  for (let n = 0; n < 6; n++) {
    const w = 0.5 + (n % 3) * 0.22;
    const bar = new Mesh(new PlaneGeometry(w, 0.04), appBarMat);
    bar.position.set(-0.75 + w / 2, 0.32 - n * 0.16, 0.01);
    appPanel.add(bar);
  }
  scene.add(appPanel);
  const legMat = new LineBasicMaterial({ transparent: true });
  for (const [a, b] of [
    [APP, GATE],
    [GATE, DEVICE],
    [DEVICE, APP],
    [GATE, DEVICE2],
    [DEVICE2, APP],
  ] as const) {
    scene.add(new Line(new BufferGeometry().setFromPoints([a, b]), legMat));
  }
  // the two devices that can answer: the first one drops out halfway, the other takes over
  const markA = new MeshBasicMaterial({ transparent: true, toneMapped: false });
  const markB = new MeshBasicMaterial({ transparent: true, toneMapped: false });
  for (const [pos, mat] of [
    [DEVICE, markA],
    [DEVICE2, markB],
  ] as const) {
    const mark = new Mesh(new TorusGeometry(0.55, 0.05, 8, 40), mat);
    mark.position.copy(pos);
    mark.rotation.y = Math.PI / 2;
    scene.add(mark);
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
    hubLight.intensity = light ? 8 : 10;
    gridDark.visible = !light;
    gridLight.visible = light;
    rackMat.color.copy(light ? lightRack : darkRack);
    cableMat.color.set(light ? DEEP_VIOLET : MINT);
    cableMat.opacity = light ? 0.55 : 0.45;
    pulseMat.blending = light ? NormalBlending : AdditiveBlending;
    pulseMat.color.set(light ? DEEP_TEAL : MINT);
    pulseMat.needsUpdate = true;
    glowMat.color.set(light ? VIOLET : MINT);
    glowMat.opacity = light ? 0.12 : 0.07;
    leftMat.color.set(light ? DEEP_VIOLET : '#5566e8');
    rightMat.color.set(light ? DEEP_TEAL : '#25c9ae');
    ringA.color.set(light ? DEEP_VIOLET : VIOLET);
    bloom.enabled = !light && !lowPower;
    deskMat.color.set(light ? '#ffffff' : '#161c52');
    idle.set(light ? '#a3a9c9' : '#3a4070');
    enrollMat.color.set(light ? DEEP_TEAL : MINT);
    enrollMat.blending = light ? NormalBlending : AdditiveBlending;
    enrollMat.needsUpdate = true;
    appMat.color.set(light ? '#dfe4ff' : '#18234d');
    appBarMat.color.set(light ? DEEP_VIOLET : CYAN);
    bodyMat.color.set(light ? '#8d96b5' : '#262c52');
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
    mark.scale.setScalar(beat);
    net.rotation.y = t * 0.2;
    net.rotation.x = t * 0.1;
    mark.rotation.y = Math.sin(t * 0.4) * 0.35;
    glow.scale.setScalar(13 * beat);

    // enrolment: the desk devices light up, a ring spreads out, the fleet wakes up
    // the side view at the end sees the whole line, so the fog has to thin out
    if (scene.fog instanceof Fog) {
      scene.fog.near = 18 + 60 * smooth(0.6, 0.85, progress);
      scene.fog.far = (mode === 'light' ? 70 : 62) + 90 * smooth(0.6, 0.85, progress);
    }
    const reveal = smooth(0.4, 0.54, progress); // the fleet lights up as the cables arrive
    const wake = smooth(0.24, 0.32, progress); // the desk devices enrol
    hinge.rotation.x = Math.PI / 2 - 0.02 - (Math.PI / 2 + 0.2) * smooth(0, 0.1, progress);
    const pv = new Vector3();
    plugs.forEach((pl, n) => {
      const grow = smooth(0.16 + n * 0.02, 0.52 + n * 0.02, progress);
      const snap = smooth(0.16 + n * 0.02, 0.2 + n * 0.02, progress);
      pl.geo.setDrawRange(0, Math.floor(grow * (SEG - 1)) * 36 + (grow >= 1 ? 100000 : 0));
      pl.mat.color.lerpColors(idle, mintColor, Math.min(1, grow * 10));
      pl.plug.position.copy(pl.port).addScaledVector(pl.dir, 0.1 * (1 - snap) + 0.05);
      // pulses run from the device out to the hub, only along the part already laid
      for (let k = 0; k < DESK_PULSES; k++) {
        const u = ((t * 0.1 + k / DESK_PULSES) % 1) * grow;
        pl.curve.getPointAt(u, pv);
        // fade out before the hub so the pulses don't pile up on the sphere
        const sz = grow > 0.02 ? (mode === 'light' ? 0.08 : 0.09) * (1 - smooth(0.8, 0.97, u)) : 0;
        m.makeScale(sz, sz, sz);
        m.setPosition(pv);
        deskPulses.setMatrixAt(n * DESK_PULSES + k, m);
      }
    });
    deskPulses.instanceMatrix.needsUpdate = true;
    phoneScreenMat.opacity = wake;
    laptopScreenMat.opacity = wake;
    piLedMat.color.lerpColors(idle, mintColor, wake);
    shieldMat.color.set(mode === 'light' ? DEEP_TEAL : MINT);
    shieldMat.opacity = smooth(0.27, 0.32, progress) * (1 - smooth(0.4, 0.46, progress)) * 0.9;
    const wave = smooth(0.22, 0.4, progress);
    enrollRing.scale.setScalar(0.6 + wave * 7);
    enrollMat.opacity = wave > 0 && wave < 1 ? (1 - wave) * 0.9 : 0;
    deviceMat.color.setScalar(0.28 + 0.72 * reveal);
    cableMat.opacity = (mode === 'light' ? 0.55 : 0.45) * reveal;

    // request path
    const vis = smooth(0.66, 0.76, progress);
    appPanel.visible = vis > 0;
    appMat.opacity = 0.85 * vis;
    appBarMat.opacity = 0.9 * vis;
    legMat.opacity = 0.45 * vis;
    const cycle = (t * 0.11) % 1;
    const second = cycle >= 0.5;
    const target = second ? DEVICE2 : DEVICE;
    const ph = (cycle % 0.5) * 2;
    markA.color.set(second ? (mode === 'light' ? '#9aa0c0' : '#4a4f7a') : mintColor);
    markB.color.set(mintColor);
    markA.opacity = vis;
    markB.opacity = vis * (second ? 1 : 0.35);
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
    else if (ph < 0.6) setFlow(0, GATE, target, (ph - 0.4) / 0.2, big);
    else hide(0);
    for (let k = 0; k < FLOW - 1; k++) {
      const u = (ph - 0.6) / 0.4 - k * 0.06;
      if (ph >= 0.6 && u >= 0 && u <= 1) setFlow(k + 1, target, APP, u, small);
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
        const sz = size * (1 - smooth(0.8, 0.97, u));
        m.makeScale(sz, sz, sz);
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
      glowTex?.dispose();
      tex?.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
