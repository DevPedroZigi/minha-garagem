// Cena 3D do topo: carro de F1 nas cores Red Bull andando na pista.
// Tudo procedural (sem modelo baixado). Cores centralizadas em COR.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const COR = {
  fundo: 0x070b1f,
  navy: 0x1b2559,
  vermelho: 0xe4002b,
  amarelo: 0xffc906,
  carbono: 0x0d0f14,
};
const VELOCIDADE = 16; // m/s "visuais"
const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.getElementById("cena3d");

async function iniciar() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const cena = new THREE.Scene();
  cena.background = new THREE.Color(COR.fundo);
  cena.fog = new THREE.Fog(COR.fundo, 11, 26);
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  cena.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(28, 2, 0.1, 100);

  // luzes
  cena.add(new THREE.HemisphereLight(0x8fa6ff, 0x080810, 0.35));
  const sol = new THREE.DirectionalLight(0xffffff, 2.6);
  sol.position.set(4, 8, 5);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -5, right: 5, top: 4, bottom: -4, near: 1, far: 25 });
  sol.shadow.bias = -0.0004;
  sol.shadow.radius = 4;
  cena.add(sol);
  const recorte = new THREE.DirectionalLight(0x3d6bff, 2.2); // contorno azul por trás
  recorte.position.set(-6, 3, -5);
  cena.add(recorte);
  const lateral = new THREE.PointLight(COR.vermelho, 6, 9, 2); // brilho vermelho de lado
  lateral.position.set(-1, 1.2, 3);
  cena.add(lateral);

  const pista = criarPista();
  cena.add(pista.grupo);
  const carro = criarCarro();
  cena.add(carro.grupo);

  // enquadramento: carro à direita no desktop, centralizado embaixo no celular
  const alvo = new THREE.Vector3();
  const base = new THREE.Vector3();
  function ajustar() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const largo = camera.aspect > 1.6;
    base.set(largo ? 3.1 : 6.2, largo ? 0.95 : 2.3, largo ? 5.7 : 9.6);
    alvo.set(largo ? -1.55 * Math.min(camera.aspect / 3, 1.25) : 0.15, largo ? 0.5 : 1.05, 0);
    camera.fov = largo ? 27 : 30;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  // leve paralaxe com o mouse (sem travar rolagem no celular)
  const mouse = { x: 0, y: 0 };
  addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    mouse.x = e.clientX / innerWidth - 0.5;
    mouse.y = e.clientY / innerHeight - 0.5;
  });

  let visivel = true;
  new IntersectionObserver(([en]) => { visivel = en.isIntersecting; }).observe(canvas);

  const relogio = new THREE.Clock();
  let t = 0;
  function quadro() {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden) { relogio.getDelta(); return; }
    const dt = Math.min(relogio.getDelta(), 0.05);
    if (!reduzido) {
      t += dt;
      pista.andar(VELOCIDADE * dt);
      carro.rodas.forEach(r => (r.giro.rotation.z -= (VELOCIDADE * dt) / r.raio));
      carro.corpo.position.y = Math.sin(t * 38) * 0.004 + Math.sin(t * 2.3) * 0.006;
      carro.corpo.rotation.x = Math.sin(t * 1.7) * 0.004;
    }
    camera.position.set(
      base.x + mouse.x * 0.9 + Math.sin(t * 0.25) * 0.25,
      base.y - mouse.y * 0.45,
      base.z + Math.cos(t * 0.2) * 0.2
    );
    camera.lookAt(alvo);
    renderer.render(cena, camera);
  }
  quadro();
  canvas.classList.add("pronto");
}

/* ---------------- pista ---------------- */
function texturaCanvas(w, h, desenhar, repetir = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  desenhar(c.getContext("2d"), w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  if (repetir) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.anisotropy = 8;
  return tx;
}

function criarPista() {
  const grupo = new THREE.Group();
  const COMP = 90, TILE = 4;
  const moveis = [];

  const asfalto = texturaCanvas(512, 512, (g, w, h) => {
    g.fillStyle = "#1d1f26"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = 20 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 6},${Math.random() * 0.8})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.fillStyle = "rgba(0,0,0,.25)"; // marcas de pneu
    g.fillRect(0, h * 0.36, w, h * 0.06); g.fillRect(0, h * 0.58, w, h * 0.06);
  });
  asfalto.repeat.set(COMP / TILE, 2);
  const chao = new THREE.Mesh(
    new THREE.PlaneGeometry(COMP, 7.2),
    new THREE.MeshStandardMaterial({ map: asfalto, roughness: 0.92, metalness: 0 })
  );
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  grupo.add(chao);
  moveis.push({ tx: asfalto, passo: TILE });

  // zebras vermelho/branco
  const zebra = texturaCanvas(128, 16, (g) => {
    g.fillStyle = "#e4002b"; g.fillRect(0, 0, 64, 16);
    g.fillStyle = "#f2f2f2"; g.fillRect(64, 0, 64, 16);
  });
  zebra.repeat.set(COMP / 2, 1);
  for (const z of [-3.9, 3.9]) {
    const k = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 0.8), new THREE.MeshStandardMaterial({ map: zebra, roughness: 0.6 }));
    k.rotation.x = -Math.PI / 2; k.position.set(0, 0.012, z); k.receiveShadow = true;
    grupo.add(k);
  }
  moveis.push({ tx: zebra, passo: 2 });

  // linhas brancas da borda + grama/área de escape escura
  for (const z of [-3.45, 3.45]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 0.12), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }));
    l.rotation.x = -Math.PI / 2; l.position.set(0, 0.011, z); grupo.add(l);
  }
  for (const z of [-19.3, 19.3]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 30), new THREE.MeshStandardMaterial({ color: 0x0b1a14, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.position.set(0, -0.01, z); g.receiveShadow = true; grupo.add(g);
  }

  return {
    grupo,
    andar(dist) { for (const m of moveis) m.tx.offset.x += dist / m.passo; },
  };
}

/* ---------------- carro ---------------- */
function mat(cor, o = {}) {
  return new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.42, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.35, ...o });
}

// caixa arredondada que afina ao longo do comprimento (X); f(t) com t=0 traseira, t=1 frente
function peca(comp, alt, larg, raio, f) {
  const g = new RoundedBoxGeometry(comp, alt, larg, 4, raio);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) + comp / 2) / comp;
    const { sy = 1, sz = 1, dy = 0 } = f ? f(t) : {};
    p.setY(i, p.getY(i) * sy + dy);
    p.setZ(i, p.getZ(i) * sz);
  }
  g.computeVertexNormals();
  return g;
}
const lerp = (a, b, t) => a + (b - a) * t;
const suave = t => t * t * (3 - 2 * t);

function malha(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function decalNumero(txt) {
  const tx = texturaCanvas(256, 256, (g) => {
    g.font = "italic 900 200px Barlow, Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 14; g.strokeStyle = "#e4002b"; g.strokeText(txt, 128, 136);
    g.fillStyle = "#ffffff"; g.fillText(txt, 128, 136);
  }, false);
  return new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
}

function criarCarro() {
  const grupo = new THREE.Group();
  const corpo = new THREE.Group();
  grupo.add(corpo);

  const navy = mat(COR.navy, { roughness: 0.55, clearcoat: 0.2 }); // pintura fosca do RB
  const vermelho = mat(COR.vermelho);
  const amarelo = mat(COR.amarelo);
  const carbono = mat(COR.carbono, { roughness: 0.3, metalness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const preto = mat(0x050505, { roughness: 0.2, clearcoat: 1 });

  // assoalho
  const assoalho = mat(0x07080b, { roughness: 0.7, metalness: 0.2, clearcoat: 0 });
  corpo.add(malha(peca(3.7, 0.035, 1.42, 0.015, t => ({ sz: t > 0.78 ? lerp(1, 0.5, (t - 0.78) / 0.22) : lerp(0.72, 1, suave(Math.min(t / 0.3, 1))) })), assoalho, -0.15, 0.075, 0));

  // bico
  corpo.add(malha(peca(1.5, 0.24, 0.32, 0.08, t => ({ sy: lerp(1, 0.55, t), sz: lerp(1, 0.5, t), dy: -0.09 * t * t })), navy, 1.95, 0.33, 0));
  corpo.add(malha(peca(0.22, 0.13, 0.16, 0.05, t => ({ sy: lerp(1, 0.7, t), sz: lerp(1, 0.8, t) })), amarelo, 2.76, 0.24, 0));

  // monocoque / cockpit
  corpo.add(malha(peca(1.55, 0.47, 0.66, 0.14, t => ({ sy: lerp(1, 0.78, suave(t)), dy: -0.05 * t })), navy, 0.5, 0.37, 0));
  corpo.add(malha(new RoundedBoxGeometry(0.62, 0.06, 0.44, 3, 0.03), preto, 0.28, 0.585, 0)); // abertura do cockpit

  // sidepods (garrafa de coca: estreita atrás)
  corpo.add(malha(peca(1.8, 0.47, 1.26, 0.2, t => ({ sz: lerp(0.45, 1, suave(t)), sy: lerp(0.6, 1, suave(t)), dy: lerp(-0.07, 0, t) })), navy, -0.33, 0.33, 0));
  for (const s of [-1, 1]) {
    corpo.add(malha(new RoundedBoxGeometry(0.06, 0.2, 0.3, 2, 0.02), preto, 0.5, 0.36, s * 0.47)); // entrada de ar
    corpo.add(malha(peca(1.45, 0.05, 0.02, 0.01, t => ({ dy: lerp(-0.03, 0, t) })), vermelho, -0.25, 0.24, s * 0.62)); // faixa vermelha lateral
  }

  // tampa do motor + airbox
  corpo.add(malha(peca(2.05, 0.5, 0.46, 0.14, t => ({ sy: lerp(0.32, 1, suave(t)), sz: lerp(0.4, 1, suave(t)), dy: lerp(-0.12, 0, t) })), navy, -0.82, 0.52, 0));
  corpo.add(malha(new RoundedBoxGeometry(0.22, 0.2, 0.26, 3, 0.07), preto, 0.02, 0.86, 0));
  // barbatana
  const fin = malha(peca(1.0, 0.26, 0.015, 0.005, t => ({ sy: lerp(0.45, 1, t), dy: lerp(-0.07, 0, t) })), navy, -1.35, 0.86, 0);
  corpo.add(fin);
  for (const s of [-1, 1]) { // número 3 dos dois lados da barbatana e no bico
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), decalNumero("3"));
    n.position.set(-1.25, 0.86, s * 0.012); if (s < 0) n.rotation.y = Math.PI;
    corpo.add(n);
  }
  const nBico = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), decalNumero("3"));
  nBico.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); nBico.position.set(2.05, 0.437, 0);
  corpo.add(nBico);

  // halo
  const haloMat = carbono;
  const laco = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.12, 0.64, 0.29), new THREE.Vector3(0.18, 0.8, 0.28), new THREE.Vector3(0.48, 0.84, 0.15),
    new THREE.Vector3(0.58, 0.85, 0), new THREE.Vector3(0.48, 0.84, -0.15), new THREE.Vector3(0.18, 0.8, -0.28),
    new THREE.Vector3(-0.12, 0.64, -0.29),
  ]);
  corpo.add(malha(new THREE.TubeGeometry(laco, 64, 0.028, 12), haloMat));
  corpo.add(malha(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.57, 0.84, 0), new THREE.Vector3(0.72, 0.7, 0), new THREE.Vector3(0.8, 0.55, 0)]), 16, 0.03, 10), haloMat));

  // capacete
  const capacete = malha(new THREE.SphereGeometry(0.125, 32, 24), mat(0x1d3fbf, { roughness: 0.25, clearcoat: 1 }), 0.12, 0.69, 0);
  corpo.add(capacete);
  const viseira = malha(new THREE.SphereGeometry(0.128, 32, 12, -0.9, 1.8, 1.1, 0.55), preto, 0.12, 0.69, 0);
  viseira.rotation.y = Math.PI / 2;
  corpo.add(viseira);
  corpo.add(malha(new THREE.TorusGeometry(0.126, 0.012, 8, 40), amarelo, 0.12, 0.69, 0)); // faixa amarela do capacete

  // retrovisores
  for (const s of [-1, 1]) {
    corpo.add(malha(new RoundedBoxGeometry(0.1, 0.06, 0.14, 2, 0.02), navy, 0.72, 0.66, s * 0.44));
    corpo.add(malha(new THREE.CylinderGeometry(0.008, 0.008, 0.14), carbono, 0.72, 0.62, s * 0.37));
  }

  // asa dianteira
  corpo.add(malha(new RoundedBoxGeometry(0.42, 0.025, 1.78, 2, 0.01), carbono, 2.62, 0.12, 0));
  const aba1 = malha(new RoundedBoxGeometry(0.28, 0.02, 1.7, 2, 0.008), navy, 2.5, 0.18, 0); aba1.rotation.z = 0.32; corpo.add(aba1);
  const aba2 = malha(new RoundedBoxGeometry(0.2, 0.018, 1.6, 2, 0.008), vermelho, 2.4, 0.24, 0); aba2.rotation.z = 0.5; corpo.add(aba2);
  for (const s of [-1, 1]) {
    corpo.add(malha(new RoundedBoxGeometry(0.5, 0.2, 0.018, 2, 0.008), navy, 2.55, 0.19, s * 0.89));
    corpo.add(malha(new THREE.BoxGeometry(0.14, 0.16, 0.02), carbono, 2.3, 0.2, s * 0.12)); // pilones do bico
  }

  // asa traseira
  corpo.add(malha(new RoundedBoxGeometry(0.34, 0.03, 1.02, 2, 0.012), navy, -2.42, 0.86, 0));
  const flap = malha(new RoundedBoxGeometry(0.22, 0.025, 1.02, 2, 0.01), vermelho, -2.32, 0.96, 0); flap.rotation.z = 0.45; corpo.add(flap);
  corpo.add(malha(new RoundedBoxGeometry(0.26, 0.025, 0.9, 2, 0.01), carbono, -2.36, 0.46, 0)); // beam wing
  for (const s of [-1, 1]) {
    corpo.add(malha(peca(0.62, 0.58, 0.022, 0.01, t => ({ sy: lerp(1, 0.8, t) })), navy, -2.38, 0.74, s * 0.52));
    corpo.add(malha(new RoundedBoxGeometry(0.6, 0.05, 0.026, 2, 0.01), vermelho, -2.38, 1.02, s * 0.52));
  }
  corpo.add(malha(new THREE.BoxGeometry(0.1, 0.42, 0.04), carbono, -2.3, 0.62, 0)); // pilone
  // luz de chuva
  corpo.add(malha(new THREE.BoxGeometry(0.03, 0.05, 0.12), new THREE.MeshBasicMaterial({ color: 0xff1030 }), -2.62, 0.42, 0));

  // rodas + suspensão
  const rodas = [];
  const pneuMat = mat(0x141414, { roughness: 0.85, metalness: 0, clearcoat: 0 });
  const aroMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1d24, metalness: 0.9, roughness: 0.32 });
  const capaMat = mat(0x0a0d18, { roughness: 0.35, metalness: 0.5 });
  const posicoes = [[1.62, 0.79, 0.34, 0.3], [-1.62, 0.77, 0.36, 0.4]];
  for (const [x, zabs, raio, larg] of posicoes) {
    for (const s of [-1, 1]) {
      const roda = new THREE.Group();
      roda.position.set(x, raio, s * zabs);
      const giro = new THREE.Group();
      roda.add(giro);
      const perfil = [
        [0.235, -larg / 2], [raio - 0.06, -larg / 2], [raio - 0.015, -larg / 2 + 0.03], [raio, -larg / 2 + 0.08],
        [raio, larg / 2 - 0.08], [raio - 0.015, larg / 2 - 0.03], [raio - 0.06, larg / 2], [0.235, larg / 2],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const pneu = new THREE.Mesh(new THREE.LatheGeometry(perfil, 64).rotateX(Math.PI / 2), pneuMat);
      pneu.castShadow = true;
      giro.add(pneu);
      giro.add(new THREE.Mesh(new THREE.CylinderGeometry(0.236, 0.236, larg * 0.92, 40).rotateX(Math.PI / 2), aroMat));
      const capa = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.012, 40).rotateX(Math.PI / 2), capaMat);
      capa.position.z = s * (larg / 2 + 0.004);
      giro.add(capa);
      // marca de giro na capa (para dar para ver a roda rodando)
      const risco = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.016, 0.004), amarelo);
      risco.position.set(0.08, 0, s * (larg / 2 + 0.012));
      giro.add(risco);
      const faixa = new THREE.Mesh(new THREE.TorusGeometry(raio - 0.045, 0.007, 8, 64), amarelo); // faixa Pirelli
      faixa.position.z = s * (larg / 2 + 0.001);
      roda.add(faixa);
      grupo.add(roda);
      rodas.push({ giro, raio });

      // braços da suspensão (do chassi até a roda)
      const ini = new THREE.Vector3(x > 0 ? x - 0.25 : x + 0.3, 0.38, s * 0.3);
      for (const dy of [0.08, -0.1]) {
        const a = ini.clone().setY(0.38 + dy);
        const b = new THREE.Vector3(x, raio + dy * 0.6, s * (zabs - larg / 2));
        const tubo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.012, 6), carbono);
        tubo.castShadow = true;
        corpo.add(tubo);
      }
    }
  }

  // sombra de contato suave sob o carro
  const sombra = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 2.6),
    new THREE.MeshBasicMaterial({
      map: texturaCanvas(256, 128, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, false),
      transparent: true, depthWrite: false,
    })
  );
  sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.015;
  grupo.add(sombra);

  return { grupo, corpo, rodas };
}

// inicia no fim do arquivo (depois de todas as funções/consts existirem)
if (canvas) iniciar().catch(e => { console.warn("3D desligado:", e); canvas.remove(); });
