// Cena 3D do topo: BMW M4 GT3 EVO preto (modelo real glTF) numa pista noturna, faróis vermelhos ("red eyes").
// O F1 procedural (criarCarro) ficou só como reserva caso o modelo não carregue.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const COR = {
  fundo: "#05081a",
  navy: "#1a2358",
  carbono: "#0a0c12",
  vermelho: "#e4002b",
  amarelo: "#ffc906",
};
const VELOCIDADE = 22; // m/s "visuais"
const GIRO_RODA = 11; // rad/s das rodas
const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canvas = document.getElementById("cena3d");

/* ---------------- utilidades ---------------- */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function texturaCanvas(w, h, desenhar, repetir = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  desenhar(c.getContext("2d"), w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  if (repetir) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}
function sombrear(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function em(m, x, y, z) { m.position.set(x, y, z); return m; }

// Loft: estações {x, w (meia largura), top, bot, n (expoente da superelipse)} ordenadas de trás pra frente.
function loft(est, { aneis = 90, segs = 56 } = {}) {
  const N = est.length, xmin = est[0].x, xmax = est[N - 1].x;
  const pos = [], uv = [], idx = [];
  const campo = (k, i) => est[Math.max(0, Math.min(N - 1, i))][k];
  for (let r = 0; r <= aneis; r++) {
    const f = (r / aneis) * (N - 1), i = Math.min(Math.floor(f), N - 2), t = f - i;
    const v = k => catmull(campo(k, i - 1), campo(k, i), campo(k, i + 1), campo(k, i + 2), t);
    const x = v("x"), w = Math.max(v("w"), 0.002), top = v("top"), bot = v("bot"), n = v("n");
    const mid = (top + bot) / 2, h = Math.max((top - bot) / 2, 0.002);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      pos.push(x, mid + h * Math.sign(s) * Math.abs(s) ** (2 / n), w * Math.sign(c) * Math.abs(c) ** (2 / n));
      uv.push((x - xmin) / (xmax - xmin), j / segs);
    }
  }
  for (let r = 0; r < aneis; r++) for (let j = 0; j < segs; j++) {
    const a = r * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  for (const r of [0, aneis]) { // tampas
    const base = r * (segs + 1);
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < segs; j++) { cx += pos[(base + j) * 3]; cy += pos[(base + j) * 3 + 1]; cz += pos[(base + j) * 3 + 2]; }
    const c = pos.length / 3;
    pos.push(cx / segs, cy / segs, cz / segs); uv.push(r ? 1 : 0, 0.25);
    for (let j = 0; j < segs; j++) r ? idx.push(base + j, c, base + j + 1) : idx.push(base + j + 1, c, base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// aerofólio extrudado na envergadura (Z); bordo de ataque para +X; ângulo levanta o bordo de fuga
function asa(corda, esp, env, angulo = 0) {
  const s = new THREE.Shape();
  s.moveTo(corda / 2, 0);
  s.bezierCurveTo(corda * 0.42, esp, -corda * 0.1, esp * 0.75, -corda / 2, esp * 0.05);
  s.bezierCurveTo(-corda * 0.1, -esp * 0.1, corda * 0.4, -esp * 0.35, corda / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: env, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -env / 2);
  g.rotateZ(-angulo);
  g.computeVertexNormals();
  return g;
}
// placa fina com contorno (XY), espessura em Z
function placa(pontos, esp) {
  const s = new THREE.Shape(pontos.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: esp, bevelEnabled: true, bevelThickness: esp * 0.3, bevelSize: esp * 0.3, bevelSegments: 2 });
  g.translate(0, 0, -esp / 2);
  return g;
}

/* ---------------- pintura (livery) ---------------- */
// UV do loft: u = comprimento (0 traseira -> 1 bico), v = volta (0 lado +z, .25 topo, .5 lado -z, .75 baixo)
function liveryCorpo() {
  return texturaCanvas(2048, 1024, (g, W, H) => {
    g.fillStyle = COR.navy; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.25, "rgba(255,255,255,.05)"); gr.addColorStop(0.5, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = COR.carbono; g.fillRect(0, H * 0.58, W, H * 0.34); // parte de baixo em carbono
    for (const v of [0.035, 0.465]) { // faixa vermelha + filete amarelo
      g.fillStyle = COR.vermelho; g.fillRect(W * 0.12, H * v, W * 0.66, H * 0.03);
      g.fillStyle = COR.amarelo; g.fillRect(W * 0.12, H * (v + 0.032), W * 0.66, H * 0.006);
    }
    g.fillStyle = COR.amarelo; g.fillRect(W * 0.955, 0, W * 0.045, H); // bico amarelo
    g.save(); g.translate(W * 0.83, H * 0.25); g.rotate(Math.PI / 2); // número no bico
    g.font = "italic 900 120px Barlow, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = COR.vermelho; g.strokeText("3", 0, 4);
    g.fillStyle = "#fff"; g.fillText("3", 0, 4); g.restore();
  });
}
function liverySidepod() {
  return texturaCanvas(1024, 512, (g, W, H) => {
    g.fillStyle = COR.navy; g.fillRect(0, 0, W, H);
    g.fillStyle = COR.carbono; g.fillRect(0, H * 0.6, W, H * 0.3);
    for (const v of [0.0, 0.5]) { g.fillStyle = COR.vermelho; g.fillRect(0, H * (v + 0.08), W, H * 0.025); }
  });
}

/* ---------------- carro ---------------- */
function criarCarro() {
  const grupo = new THREE.Group();
  const corpo = new THREE.Group();
  grupo.add(corpo);

  const fisico = o => new THREE.MeshPhysicalMaterial({ roughness: 0.48, metalness: 0.25, clearcoat: 0.25, clearcoatRoughness: 0.4, ...o });
  const pintura = fisico({ map: liveryCorpo() });
  const pinturaSide = fisico({ map: liverySidepod() });
  const navy = fisico({ color: COR.navy });
  const vermelho = fisico({ color: COR.vermelho, roughness: 0.35, metalness: 0.1, clearcoat: 0.6 });
  const amarelo = fisico({ color: COR.amarelo, roughness: 0.35, metalness: 0.1, clearcoat: 0.6 });
  const carbono = fisico({ color: COR.carbono, roughness: 0.32, metalness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.2 });
  const preto = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.6 });

  // carroceria principal: câmbio -> tampa do motor -> airbox -> cockpit -> bico
  corpo.add(sombrear(new THREE.Mesh(loft([
    { x: -2.45, w: 0.07, top: 0.36, bot: 0.2, n: 2.6 },
    { x: -1.95, w: 0.11, top: 0.42, bot: 0.17, n: 2.6 },
    { x: -1.35, w: 0.17, top: 0.58, bot: 0.14, n: 2.8 },
    { x: -0.75, w: 0.22, top: 0.8, bot: 0.12, n: 3 },
    { x: -0.32, w: 0.25, top: 0.93, bot: 0.11, n: 3 },
    { x: 0.0, w: 0.31, top: 0.7, bot: 0.11, n: 3.2 },
    { x: 0.45, w: 0.33, top: 0.62, bot: 0.11, n: 3.4 },
    { x: 0.95, w: 0.29, top: 0.58, bot: 0.12, n: 3.2 },
    { x: 1.45, w: 0.21, top: 0.47, bot: 0.14, n: 2.8 },
    { x: 2.0, w: 0.14, top: 0.36, bot: 0.15, n: 2.5 },
    { x: 2.5, w: 0.085, top: 0.27, bot: 0.14, n: 2.3 },
    { x: 2.8, w: 0.04, top: 0.21, bot: 0.15, n: 2.2 },
  ]), pintura)));

  // sidepods (as duas laterais num volume só, estreitando atrás)
  corpo.add(sombrear(new THREE.Mesh(loft([
    { x: -1.75, w: 0.2, top: 0.3, bot: 0.12, n: 2.4 },
    { x: -1.2, w: 0.34, top: 0.38, bot: 0.11, n: 2.6 },
    { x: -0.5, w: 0.55, top: 0.47, bot: 0.11, n: 2.8 },
    { x: 0.1, w: 0.64, top: 0.52, bot: 0.12, n: 3 },
    { x: 0.5, w: 0.63, top: 0.5, bot: 0.16, n: 3 },
    { x: 0.62, w: 0.56, top: 0.47, bot: 0.2, n: 2.8 },
  ], { aneis: 60 }), pinturaSide)));
  for (const s of [-1, 1]) { // entradas de ar
    const boca = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.16, 6, 16), preto);
    boca.rotation.x = Math.PI / 2; boca.scale.set(0.6, 1, 1);
    corpo.add(em(boca, 0.6, 0.38, s * 0.46));
  }

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), preto); // abertura do cockpit
  cockpit.scale.set(0.38, 0.06, 0.2);
  corpo.add(em(cockpit, 0.38, 0.62, 0));

  // barbatana com número
  corpo.add(em(sombrear(new THREE.Mesh(placa([[-0.95, 0], [0.2, 0], [0.2, 0.06], [-0.6, 0.26], [-0.95, 0.27]], 0.012), navy)), -1.05, 0.72, 0));
  const numero = texturaCanvas(256, 256, g => {
    g.font = "italic 900 190px Barlow, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 14; g.strokeStyle = COR.vermelho; g.strokeText("3", 128, 136); g.fillStyle = "#fff"; g.fillText("3", 128, 136);
  });
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: numero, transparent: true, toneMapped: false, depthWrite: false }));
    if (s < 0) n.rotation.y = Math.PI;
    corpo.add(em(n, -1.45, 0.86, s * 0.014));
  }

  // assoalho (vista de cima)
  const meio = [[1.3, 0.3], [1.0, 0.72], [-0.9, 0.74], [-1.55, 0.6], [-2.0, 0.42], [-2.2, 0.3]];
  const contorno = [...meio, ...meio.slice().reverse().map(([x, z]) => [x, -z])];
  const piso = new THREE.Mesh(placa(contorno, 0.025), carbono);
  piso.rotation.x = Math.PI / 2;
  corpo.add(em(sombrear(piso), 0, 0.09, 0));

  // halo
  const halo = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.08, 0.66, 0.3), new THREE.Vector3(0.2, 0.82, 0.29), new THREE.Vector3(0.5, 0.87, 0.16),
    new THREE.Vector3(0.6, 0.88, 0), new THREE.Vector3(0.5, 0.87, -0.16), new THREE.Vector3(0.2, 0.82, -0.29), new THREE.Vector3(-0.08, 0.66, -0.3),
  ]);
  corpo.add(sombrear(new THREE.Mesh(new THREE.TubeGeometry(halo, 80, 0.03, 14), carbono)));
  corpo.add(sombrear(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.6, 0.87, 0), new THREE.Vector3(0.74, 0.76, 0), new THREE.Vector3(0.86, 0.6, 0)]), 24, 0.034, 12), carbono)));

  // piloto
  const capacete = em(sombrear(new THREE.Mesh(new THREE.SphereGeometry(0.13, 40, 28), fisico({ color: "#1d3fbf", roughness: 0.2, clearcoat: 1 }))), 0.16, 0.7, 0);
  corpo.add(capacete);
  const viseira = new THREE.Mesh(new THREE.SphereGeometry(0.133, 40, 16, -0.95, 1.9, 1.15, 0.5), fisico({ color: 0x050505, roughness: 0.05, metalness: 0.6, clearcoat: 1 }));
  viseira.rotation.y = Math.PI / 2; viseira.position.copy(capacete.position); corpo.add(viseira);
  const faixaCap = new THREE.Mesh(new THREE.TorusGeometry(0.131, 0.012, 8, 48), amarelo);
  faixaCap.position.copy(capacete.position); corpo.add(faixaCap);

  // retrovisores
  for (const s of [-1, 1]) {
    const esp = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.08, 4, 12), navy);
    esp.rotation.x = Math.PI / 2; corpo.add(em(sombrear(esp), 0.78, 0.68, s * 0.45));
    const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16), carbono);
    haste.rotation.x = Math.PI / 2; corpo.add(em(haste, 0.78, 0.64, s * 0.36));
  }

  // asa dianteira
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.42, 0.04, 1.8, 0.05), carbono)), 2.62, 0.1, 0));
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.26, 0.03, 1.66, 0.28), navy)), 2.47, 0.17, 0));
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.2, 0.025, 1.6, 0.48), vermelho)), 2.36, 0.24, 0));
  for (const s of [-1, 1]) {
    corpo.add(em(sombrear(new THREE.Mesh(placa([[0.3, 0], [-0.3, 0], [-0.3, 0.22], [-0.05, 0.25], [0.3, 0.12]], 0.014), navy)), 2.55, 0.06, s * 0.9));
    corpo.add(em(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.016), carbono), 2.35, 0.19, s * 0.1));
  }

  // asa traseira
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.34, 0.045, 1.0, 0.12), navy)), -2.38, 0.86, 0));
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.24, 0.035, 1.0, 0.55), vermelho)), -2.5, 0.97, 0));
  corpo.add(em(sombrear(new THREE.Mesh(asa(0.26, 0.03, 0.86, 0.2), carbono)), -2.38, 0.42, 0));
  for (const s of [-1, 1]) {
    corpo.add(em(sombrear(new THREE.Mesh(placa([[0.32, 0], [-0.3, 0], [-0.34, 0.66], [0.1, 0.7], [0.32, 0.55]], 0.016), navy)), -2.42, 0.38, s * 0.51));
    corpo.add(em(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.02), vermelho), -2.52, 1.06, s * 0.51));
  }
  corpo.add(em(sombrear(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.035), carbono)), -2.3, 0.62, 0));
  corpo.add(em(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.3) })), -2.47, 0.36, 0)); // luz traseira

  // rodas
  const rodas = [];
  const borracha = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.82 });
  const aro = new THREE.MeshPhysicalMaterial({ color: 0x1b1e26, metalness: 0.95, roughness: 0.28 });
  const capaMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0f1c, metalness: 0.6, roughness: 0.3, clearcoat: 1 });
  const flanco = texturaCanvas(1024, 64, (g, W, H) => {
    g.fillStyle = "#121212"; g.fillRect(0, 0, W, H);
    g.fillStyle = COR.amarelo; g.fillRect(0, H * 0.42, W, H * 0.16);
    g.font = "bold 30px Arial"; g.fillStyle = "#d8d8d8"; g.textBaseline = "middle";
    for (let i = 0; i < 4; i++) g.fillText("P ZERO", i * W / 4 + 40, H * 0.2);
  });
  const flancoMat = new THREE.MeshStandardMaterial({ map: flanco, roughness: 0.8 });
  for (const [x, zabs, raio, larg] of [[1.62, 0.8, 0.345, 0.3], [-1.66, 0.78, 0.36, 0.4]]) {
    for (const s of [-1, 1]) {
      const roda = new THREE.Group(); roda.position.set(x, raio, s * zabs);
      const giro = new THREE.Group(); roda.add(giro);
      const perfil = [[0.24, -larg / 2], [raio - 0.07, -larg / 2], [raio - 0.02, -larg / 2 + 0.03], [raio, -larg / 2 + 0.09],
        [raio, larg / 2 - 0.09], [raio - 0.02, larg / 2 - 0.03], [raio - 0.07, larg / 2], [0.24, larg / 2]].map(([r, y]) => new THREE.Vector2(r, y));
      const pneu = new THREE.Mesh(new THREE.LatheGeometry(perfil, 72).rotateX(Math.PI / 2), borracha);
      pneu.castShadow = true; giro.add(pneu);
      giro.add(new THREE.Mesh(new THREE.CylinderGeometry(0.242, 0.242, larg * 0.9, 48).rotateX(Math.PI / 2), aro));
      const lado = new THREE.Mesh(new THREE.RingGeometry(0.245, raio - 0.03, 72, 1), flancoMat); // flanco com faixa e escrita
      const uvs = lado.geometry.attributes.uv, p = lado.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getY(i), p.getX(i)), r = Math.hypot(p.getX(i), p.getY(i));
        uvs.setXY(i, a / (2 * Math.PI) + 0.5, (r - 0.245) / (raio - 0.275));
      }
      lado.position.z = s * (larg / 2 + 0.002); if (s < 0) lado.rotation.y = Math.PI;
      giro.add(lado);
      giro.add(em(new THREE.Mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.014, 48).rotateX(Math.PI / 2), capaMat), 0, 0, s * (larg / 2 + 0.006)));
      giro.add(em(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6).rotateX(Math.PI / 2), aro), 0, 0, s * (larg / 2 + 0.018)));
      grupo.add(roda);
      rodas.push({ giro, raio });
      for (const dy of [0.1, -0.08]) for (const off of [-0.18, 0.18]) { // suspensão em braços duplos
        const a = new THREE.Vector3(x - Math.sign(x) * 0.35 + off, 0.36 + dy, s * 0.26);
        const b = new THREE.Vector3(x, raio + dy * 0.55, s * (zabs - larg / 2 - 0.02));
        const braco = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.011, 6), carbono);
        braco.castShadow = true; corpo.add(braco);
      }
    }
  }

  // sombra de contato
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), new THREE.MeshBasicMaterial({
    map: texturaCanvas(256, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, "rgba(0,0,0,.85)"); gr.addColorStop(0.6, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false,
  }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.012; sombra.scale.y = 0.75;
  grupo.add(sombra);

  return { grupo, corpo, rodas };
}

/* ---------------- pista noturna ---------------- */
function criarPista() {
  const grupo = new THREE.Group();
  const COMP = 120;
  const moveis = []; // texturas que deslizam: {tx, passo}

  const asfalto = texturaCanvas(1024, 1024, (g, w, h) => {
    g.fillStyle = "#15171d"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90000; i++) {
      const v = 18 + Math.random() * 46;
      g.fillStyle = `rgba(${v},${v},${v + 8},${0.25 + Math.random() * 0.6})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.3, 1.3);
    }
    const gr = g.createLinearGradient(0, 0, 0, h); // borracha da trajetória
    gr.addColorStop(0.3, "rgba(0,0,0,0)"); gr.addColorStop(0.45, "rgba(0,0,0,.35)"); gr.addColorStop(0.62, "rgba(0,0,0,.35)"); gr.addColorStop(0.75, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, true);
  asfalto.repeat.set(COMP / 6, 1.5);
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 9), new THREE.MeshStandardMaterial({ map: asfalto, roughness: 0.62, metalness: 0.12, envMapIntensity: 0.35 }));
  chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; grupo.add(chao);
  moveis.push({ tx: asfalto, passo: 6 });

  // zebras em relevo + linhas brancas
  const zebraTx = texturaCanvas(256, 32, (g, w, h) => {
    g.fillStyle = COR.vermelho; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = "#eef0f4"; g.fillRect(w / 2, 0, w / 2, h);
  }, true);
  zebraTx.repeat.set(COMP / 2.2, 1);
  moveis.push({ tx: zebraTx, passo: 2.2 });
  const zebraMat = new THREE.MeshStandardMaterial({ map: zebraTx, roughness: 0.45 });
  for (const z of [-4.9, 4.9]) {
    const g = new THREE.BoxGeometry(COMP, 0.05, 0.9);
    const k = new THREE.Mesh(g, zebraMat);
    k.position.set(0, 0.025, z); k.receiveShadow = true; grupo.add(k);
    const linha = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 0.14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
    linha.rotation.x = -Math.PI / 2; linha.position.set(0, 0.006, z - Math.sign(z) * 0.6); grupo.add(linha);
  }
  for (const z of [-14, 14]) { // área de escape
    const e = new THREE.Mesh(new THREE.PlaneGeometry(COMP, 18), new THREE.MeshStandardMaterial({ color: 0x0b0e18, roughness: 0.9 }));
    e.rotation.x = -Math.PI / 2; e.position.set(0, -0.01, z); grupo.add(e);
  }

  // muro + painel de LED com texto passando
  // painel de LED: largura do canvas = 2 blocos exatos, para repetir sem emenda
  const blocos = [["GARAGEM DO KYZAM", "#ffffff"], ["  •  ", COR.vermelho], ["COLEÇÃO 1:64", COR.amarelo], ["  •  ", COR.vermelho]];
  const fonteLed = "italic 900 76px Barlow, Arial, sans-serif";
  const med = document.createElement("canvas").getContext("2d"); med.font = fonteLed;
  const larguraBloco = Math.ceil(blocos.reduce((s, [t]) => s + med.measureText(t).width, 0));
  const ledTx = texturaCanvas(larguraBloco * 2, 128, (g, w, h) => {
    g.fillStyle = "#03040a"; g.fillRect(0, 0, w, h);
    g.font = fonteLed; g.textBaseline = "middle";
    let x = 0;
    for (let k = 0; k < 2; k++) for (const [t, c] of blocos) { g.fillStyle = c; g.fillText(t, x, h / 2 + 4); x += med.measureText(t).width; }
    g.fillStyle = "rgba(0,0,0,.35)";
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    for (let xx = 0; xx < w; xx += 4) g.fillRect(xx, 0, 1, h);
  }, true);
  ledTx.repeat.set(COMP / 16, 1);
  moveis.push({ tx: ledTx, passo: 16 });
  grupo.add(em(new THREE.Mesh(new THREE.BoxGeometry(COMP, 1.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x0d1024, roughness: 0.7 })), 0, 0.65, -12));
  grupo.add(em(new THREE.Mesh(new THREE.PlaneGeometry(COMP, 0.62), new THREE.MeshBasicMaterial({ map: ledTx, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) })), 0, 0.78, -11.84));

  // postes de iluminação (brilham com o bloom)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 5) });
  const posteMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.6 });
  const postes = new THREE.Group();
  for (let i = -7; i <= 7; i++) {
    const p = new THREE.Group(); p.position.set(i * 9, 0, -14);
    p.add(em(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 7), posteMat), 0, 3.5, 0));
    p.add(em(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), posteMat), 0, 7, 0));
    for (const dx of [-0.6, -0.2, 0.2, 0.6]) p.add(em(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.12), lampMat), dx, 6.9, 0.08));
    postes.add(p);
  }
  grupo.add(postes);

  // rastros de velocidade rentes ao chão
  const rastroMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 2.4), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
  const rastros = [];
  for (let i = 0; i < 26; i++) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(2 + Math.random() * 4, 0.025), rastroMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(-30 + Math.random() * 60, 0.02 + Math.random() * 0.02, (Math.random() - 0.5) * 8.4);
    grupo.add(r); rastros.push(r);
  }

  let postesX = 0;
  return {
    grupo,
    andar(d) {
      for (const m of moveis) m.tx.offset.x += d / m.passo;
      postesX = (postesX - d) % 9; postes.position.x = postesX;
      for (const r of rastros) { r.position.x -= d * 2.2; if (r.position.x < -30) r.position.x += 60; }
    },
  };
}

/* ---------------- cena ---------------- */
// Modelo real (glTF). Ajuste: GIRO = rotação em Y para o bico apontar para +X.
const MODELO = "modelos/bmw-m4-gt3.glb?v=2";
const GIRO = 0;
const COMPRIMENTO = 4.6; // m (escala da cena)

// O RB19 vem numa malha só: recorta os triângulos de cada roda (pelo eixo) e
// cria um pivô para girar. Medidas no espaço do modelo (Y para cima, bico em +Z, eixo em X).
const RODAS_RB19 = [
  { z: 1.378, y: 0.251, r: 0.252, xIn: 0.45 }, // dianteiras
  { z: -1.014, y: 0.254, r: 0.256, xIn: 0.40 }, // traseiras
];

function separarRodas(raiz) {
  const malhas = [];
  raiz.traverse(o => { if (o.isMesh) malhas.push(o); });
  const rodas = [];
  const pivos = [];
  for (const d of RODAS_RB19) for (const lado of [1, -1]) {
    const pivo = new THREE.Group();
    pivo.position.set(0, d.y, d.z);
    raiz.add(pivo);
    pivos.push({ ...d, lado, pivo });
    rodas.push({ giro: pivo, raio: d.r, eixo: "x", sinal: 1 });
  }
  raiz.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const o of malhas) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    if (!idx) continue;
    const n = pos.count, mundo = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); mundo[i * 3] = v.x; mundo[i * 3 + 1] = v.y; mundo[i * 3 + 2] = v.z; }
    const qual = new Int8Array(n).fill(-1); // em qual roda o vértice está
    for (let i = 0; i < n; i++) {
      const x = mundo[i * 3], y = mundo[i * 3 + 1], z = mundo[i * 3 + 2];
      pivos.forEach((p, k) => { if (x * p.lado > p.xIn && Math.hypot(y - p.y, z - p.z) < p.r + 0.012) qual[i] = k; });
    }
    const resto = [], porRoda = pivos.map(() => []);
    const a = idx.array;
    for (let t = 0; t < a.length; t += 3) {
      const k = qual[a[t]];
      if (k >= 0 && qual[a[t + 1]] === k && qual[a[t + 2]] === k) porRoda[k].push(a[t], a[t + 1], a[t + 2]);
      else resto.push(a[t], a[t + 1], a[t + 2]);
    }
    if (porRoda.every(l => !l.length)) continue;
    porRoda.forEach((lista, k) => {
      if (!lista.length) return;
      const gr = compactar(g, lista);
      const m = new THREE.Mesh(gr, o.material);
      // malha fica onde estava: matriz = inverso(pivô) * mundo(original)
      m.matrixAutoUpdate = false;
      m.matrix.copy(pivos[k].pivo.matrixWorld).invert().multiply(o.matrixWorld);
      pivos[k].pivo.add(m);
    });
    g.setIndex(resto);
  }
  return rodas;
}

function compactar(g, lista) {
  const mapa = new Map(), novos = [];
  const ind = lista.map(i => { let j = mapa.get(i); if (j === undefined) { j = novos.length; mapa.set(i, j); novos.push(i); } return j; });
  const out = new THREE.BufferGeometry();
  for (const [nome, at] of Object.entries(g.attributes)) {
    const s = at.itemSize, src = at.array, dst = new src.constructor(novos.length * s);
    if (at.isInterleavedBufferAttribute) { // valores crus (quantizados), sem desnormalizar
      const passo = at.data.stride, off = at.offset;
      for (let j = 0; j < novos.length; j++) for (let c = 0; c < s; c++) dst[j * s + c] = src[novos[j] * passo + off + c];
    } else {
      for (let j = 0; j < novos.length; j++) for (let c = 0; c < s; c++) dst[j * s + c] = src[novos[j] * s + c];
    }
    out.setAttribute(nome, new THREE.BufferAttribute(dst, s, at.normalized));
  }
  out.setIndex(ind);
  return out;
}

// "Red eyes": a malha de luzes do BMW junta faróis e lanternas. Separa os triângulos da frente
// (z > 0 no espaço do modelo, antes de girar/escalar) numa malha própria com emissivo vermelho forte
// (o bloom faz o brilho). Devolve o centro de cada farol (esquerdo/direito) no espaço do modelo.
const VERMELHO_OLHO = new THREE.Color(1, 0.02, 0.06);
function olhosVermelhos(modelo) {
  const centros = [];
  modelo.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  modelo.traverse(o => {
    if (!o.isMesh || !/Lights/i.test([].concat(o.material)[0]?.name || "")) return;
    const g = o.geometry, pos = g.attributes.position, a = g.index?.array;
    if (!a) return;
    const z = new Float32Array(pos.count), x = new Float32Array(pos.count), y = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); x[i] = v.x; y[i] = v.y; z[i] = v.z; }
    const frente = [], resto = [];
    for (let t = 0; t < a.length; t += 3) {
      const cz = (z[a[t]] + z[a[t + 1]] + z[a[t + 2]]) / 3;
      (cz > 0.5 ? frente : resto).push(a[t], a[t + 1], a[t + 2]);
    }
    if (!frente.length) return;
    g.setIndex(resto);
    o.material.emissive = new THREE.Color(1, 0.04, 0.08); o.material.emissiveIntensity = 1.6; // lanternas traseiras vermelhas
    const mat = o.material.clone();
    mat.emissive = VERMELHO_OLHO.clone(); mat.emissiveIntensity = 9;
    mat.color = new THREE.Color(0.35, 0, 0.02);
    const m = new THREE.Mesh(compactar(g, frente), mat);
    m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
    o.parent.add(m);
    for (const lado of [1, -1]) { // centro de cada farol: média dos vértices da frente daquele lado
      const c = new THREE.Vector3(); let n = 0;
      for (const i of new Set(frente)) if (x[i] * lado > 0.2) { c.x += x[i]; c.y += y[i]; c.z += z[i]; n++; }
      if (n) centros.push(c.divideScalar(n));
    }
  });
  return centros;
}

// brilho redondo (sprite) para o farol "acender" mesmo sem bloom (modo leve)
function brilhoOlho() {
  const tx = texturaCanvas(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, "rgba(255,210,215,1)"); gr.addColorStop(0.12, "rgba(255,40,70,.9)");
    gr.addColorStop(0.4, "rgba(228,0,43,.25)"); gr.addColorStop(1, "rgba(228,0,43,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  return new THREE.SpriteMaterial({ map: tx, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
}

// feixe de luz do farol: cone aberto, transparente, mais forte na saída
function feixe() {
  const tx = texturaCanvas(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(255,30,60,0)"); gr.addColorStop(1, "rgba(255,30,60,1)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const geo = new THREE.ConeGeometry(0.95, 5.5, 32, 1, true);
  geo.translate(0, -2.75, 0); geo.rotateZ(Math.PI / 2); // ponta no farol, abre para +X
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tx, color: new THREE.Color(1, 0.1, 0.2), transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
}

// ambiente de estúdio para reflexos: caixa escura com faixas de luz (a lataria preta reflete as faixas)
function ambienteEstudio() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(40, 16, 40), new THREE.MeshBasicMaterial({ color: 0x03040b, side: THREE.BackSide })));
  const faixa = (w, h, cor, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: cor, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); s.add(m);
  };
  for (const z of [-3.2, 0, 3.2]) faixa(26, 1.4, new THREE.Color(1.1, 1.1, 1.25), 0, 7.5, z, Math.PI / 2); // refletores do teto
  faixa(24, 3, new THREE.Color(0.25, 0.45, 1.6), 0, 2.5, -19);      // parede azul atrás
  faixa(4, 8, new THREE.Color(1.8, 0.05, 0.2), -19, 3, 0, 0, Math.PI / 2); // faixa vermelha lateral
  faixa(4, 8, new THREE.Color(0.7, 0.7, 0.8), 19, 3, 4, 0, Math.PI / 2);
  return s;
}

async function carregarModelo(url) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const draco = new DRACOLoader(); draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  const modelo = gltf.scene;
  modelo.updateMatrixWorld(true);
  // BMW M4 GT3: as rodas já vêm separadas (nós WHEEL_*), é só girar cada pivô no eixo X
  const rodas = [];
  modelo.traverse(o => { if (/^WHEEL_(RF|LF|RR|LR)$/.test(o.name)) rodas.push({ giro: o, raio: 0.35, eixo: "x", sinal: 1 }); });
  // pintura preta metálica com verniz (clearcoat): reflete as faixas de luz do estúdio
  modelo.traverse(o => {
    if (!o.isMesh || !/car_paint/i.test(o.material?.name || "")) return;
    const old = o.material;
    o.material = new THREE.MeshPhysicalMaterial({ name: old.name, color: new THREE.Color(0.006, 0.0065, 0.009), metalness: 0.25, roughness: 0.5,
      clearcoat: 1, clearcoatRoughness: 0.1, normalMap: old.normalMap || null, envMapIntensity: 0.8 });
    old.dispose();
  });
  const faroisModelo = olhosVermelhos(modelo);
  modelo.rotation.y = GIRO;
  modelo.updateMatrixWorld(true);

  // normaliza: comprimento fixo, centrado em X/Z, rodas no chão
  let caixa = new THREE.Box3().setFromObject(modelo);
  const tam = caixa.getSize(new THREE.Vector3());
  const longo = Math.max(tam.x, tam.z);
  if (tam.z > tam.x) { modelo.rotation.y += Math.PI / 2; modelo.updateMatrixWorld(true); caixa = new THREE.Box3().setFromObject(modelo); }
  modelo.scale.setScalar(COMPRIMENTO / longo);
  modelo.updateMatrixWorld(true);
  caixa = new THREE.Box3().setFromObject(modelo);
  const centro = caixa.getCenter(new THREE.Vector3());
  modelo.position.x -= centro.x; modelo.position.z -= centro.z; modelo.position.y -= caixa.min.y;
  for (const r of rodas) r.raio *= modelo.scale.x;
  modelo.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = true; // sombra do carro = mancha de contato (bem mais leve)
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && "envMapIntensity" in m && !m.isMeshPhysicalMaterial) m.envMapIntensity = 1;
  });

  const corpo = new THREE.Group(); corpo.add(modelo);
  // faróis vermelhos: brilho + feixe + luz projetada na pista, presos à carroceria (balançam junto)
  modelo.updateMatrixWorld(true);
  const farois = faroisModelo.map(p => p.clone().applyMatrix4(modelo.matrixWorld));
  const matBrilho = brilhoOlho();
  for (const p of farois) {
    const s = new THREE.Sprite(matBrilho); s.scale.setScalar(0.55); s.position.copy(p).add(new THREE.Vector3(0.06, 0, 0)); corpo.add(s);
    const f = feixe(); f.position.copy(p).add(new THREE.Vector3(0.05, 0, 0)); f.rotation.z = -0.09; corpo.add(f);
    const luz = new THREE.SpotLight(0xff1033, 45, 16, 0.42, 0.7, 1.4);
    luz.position.copy(p).add(new THREE.Vector3(0.45, -0.05, 0));
    luz.target.position.set(p.x + 5, 0, p.z * 1.4);
    corpo.add(luz, luz.target);
  }
  const grupo = new THREE.Group(); grupo.add(corpo);
  // sombra de contato
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(COMPRIMENTO * 1.05, 2.3),
    new THREE.MeshBasicMaterial({ map: texturaCanvas(256, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.save(); g.scale(1, h / w * 2); g.fillRect(0, 0, w, w); g.restore();
    }), transparent: true, depthWrite: false }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.004; grupo.add(sombra);
  return { grupo, corpo, rodas };
}

async function iniciar() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Sem aceleração de vídeo (WebGL no processador: SwiftShader/"Basic Render") → modo leve
  const gl = renderer.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
  const placa = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  let leve = /swiftshader|basic render|llvmpipe|software/i.test(placa);
  if (leve) { console.info("3D em modo leve (sem aceleração de vídeo):", placa); renderer.setPixelRatio(0.6); renderer.shadowMap.enabled = false; }

  const cena = new THREE.Scene();
  cena.background = new THREE.Color(COR.fundo);
  cena.fog = new THREE.Fog(COR.fundo, 9, 32);
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(ambienteEstudio(), 0.02).texture;
  cena.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 120);

  cena.add(new THREE.HemisphereLight(0x6f86ff, 0x05060c, 0.3));
  const key = new THREE.DirectionalLight(0xfff4e6, 3.2); // refletores
  key.position.set(2, 9, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 3, bottom: -3, near: 1, far: 20 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
  cena.add(key);
  const azul = new THREE.DirectionalLight(0x3f6dff, 3); azul.position.set(-7, 2.5, -4); cena.add(azul);
  const verm = new THREE.SpotLight(0xff1a3c, 22, 12, 0.45, 0.9, 1.6); verm.position.set(-3.5, 1.2, 2.2); verm.target.position.set(0, 0.4, 0); cena.add(verm, verm.target);
  const frente = new THREE.PointLight(0xffffff, 6, 8, 2); frente.position.set(4, 1.2, 2.5); cena.add(frente);

  const pista = criarPista(); cena.add(pista.grupo);
  const carro = (await carregarModelo(MODELO).catch(e => { console.warn("modelo 3D indisponível:", e); return null; })) || criarCarro();
  cena.add(carro.grupo);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(cena, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 0.97));
  composer.addPass(new OutputPass());

  const alvo = new THREE.Vector3(), base = new THREE.Vector3();
  function ajustar() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h;
    if (camera.aspect > 1.6) { base.set(3.7, 1.45, 5.3); alvo.set(-1.45 * Math.min(camera.aspect / 3, 1.25), 0.62, 0.1); camera.fov = 30; }
    // celular: o topo é alto e os quadros de contagem ocupam a parte de cima,
    // então a câmera mira mais alto (carro desce para a faixa livre) e recua um pouco (cabe inteiro)
    // tela mais estreita que 0.94 (topo alto no celular): abre o ângulo para o carro caber inteiro na largura
    else { base.set(6.6, 1.8, 9.2); alvo.set(0.45, 2.0, 0); camera.fov = 31 * Math.max(1, 0.94 / camera.aspect); }
    cena.fog.near = base.length() + 1.5; cena.fog.far = cena.fog.near + 22; // névoa começa depois do carro
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  const mouse = { x: 0, y: 0 };
  addEventListener("pointermove", e => { if (e.pointerType === "mouse") { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; } });
  let visivel = true;
  new IntersectionObserver(([en]) => { visivel = en.isIntersecting; }).observe(canvas);

  const relogio = new THREE.Clock();
  let t = 0, amostras = 0, soma = 0;
  const cam = new THREE.Vector3();
  camera.position.copy(base);
  function quadro() {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden) { relogio.getDelta(); return; }
    const dt = Math.min(relogio.getDelta(), 0.05);
    // qualidade automática: se o PC/celular não segura ~50 fps, baixa a resolução da cena
    if (amostras < 120) {
      amostras++; if (amostras > 20) soma += dt;
      if (amostras === 120 && soma / 100 > 1 / 50) {
        if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); composer.setPixelRatio(1); }
        else if (!leve) { leve = true; renderer.setPixelRatio(0.75); renderer.shadowMap.enabled = false; }
        ajustar(); amostras = soma = 0; // mede de novo
      }
    }
    // o carro anda sempre (o Windows do Kyzam tem "efeitos de animação" desligados → reduced-motion);
    // com reduced-motion só a câmera fica parada
    {
      t += dt;
      pista.andar(VELOCIDADE * dt);
      for (const r of carro.rodas) r.giro.rotation[r.eixo || "z"] += (r.sinal ?? -1) * GIRO_RODA * dt; // giro legível (o real é rápido demais e parece parado)
      carro.corpo.position.y = Math.sin(t * 41) * 0.003 + Math.sin(t * 2.1) * 0.005;
      carro.grupo.position.z = Math.sin(t * 0.45) * 0.18;
      carro.grupo.rotation.y = Math.cos(t * 0.45) * 0.015;
    }
    const bal = reduzido ? 0 : 1;
    // ao rolar a página a câmera sobe e recua: o carro "fica para trás" enquanto o topo sai da tela
    const rol = reduzido ? 0 : Math.min(scrollY / Math.max(canvas.clientHeight, 1), 1);
    cam.set(base.x + (mouse.x * 0.7 + Math.sin(t * 0.3) * 0.15) * bal - rol * 1.2, base.y - mouse.y * 0.25 * bal + rol * 1.1, base.z + Math.cos(t * 0.23) * 0.12 * bal + rol * 2.4);
    camera.position.lerp(cam, 0.08);
    camera.lookAt(alvo);
    if (leve) renderer.render(cena, camera); else composer.render(); // modo leve: sem brilho (bloom)
  }
  quadro();
  canvas.classList.add("pronto");
}

if (canvas) iniciar().catch(e => { console.warn("3D desligado:", e); canvas.remove(); });
