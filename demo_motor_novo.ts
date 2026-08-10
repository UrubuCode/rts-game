// A engine RTS rodando no MOTOR NOVO, com janela.
//
//   cargo run --features ui -- run demo_motor_novo.ts
//
// # O que esta demo prova, e por que ela existe em vez do editor
//
// `main.ts` é o editor: 1383 linhas sobre `rts:render` (rasterizador 2D
// aposentado), `rts:buffer` (ponteiros crus) e um `createAppAt` global que o
// motor antigo fornecia. Portar aquilo é a Fase 3, e nada nela é sobre se a
// ENGINE roda.
//
// Esta demo responde essa pergunta e nenhuma outra: a mesma `Scene`, os mesmos
// `GameObject`/`Transform`, o mesmo `Rigidbody` que `tools/test_scene.ts` valida
// em 70 asserções — dirigindo uma janela de verdade pela superfície nova, sem
// uma linha de compatibilidade no caminho do desenho.
//
// # Por que a geometria é montada aqui e não vem de `gpu3d.ts`
//
// `gpu3d.upload()` escreve os vértices com `buffer.write_f32` num bloco alocado
// e passa o PONTEIRO. A superfície nova recebe `Float32Array`/`Uint32Array` de
// propósito: o coletor move células, então um endereço lido antes pode não ser
// mais o buffer quando o Rust o usa. Isso não é um nome que mudou, é a correção
// de uma leitura arbitrária de memória — então o caminho novo é escrito, não
// traduzido.

import {
  openWindow, pump, isOpen, close, beginFrame, endFrame,
  drawRect, drawText, winWidth, winHeight,
  meshUpload, setCamera, setLight, setShadow, setClearColor, drawMesh,
} from "rts:egui";
import { mouseX, mouseDown } from "rts:input";

import { GameObject } from "./engine/core/gameobject";
import { scene } from "./editor/control/session";
import { Rigidbody } from "./scripts/rigidbody";

// ── geometria ─────────────────────────────────────────────────────────────
// 8 floats por vértice: posição, normal, uv — o layout que `meshUpload` lê.

function esfera(anelHoriz: number, anelVert: number): Float32Array {
  const dados: number[] = [];
  for (let i = 0; i <= anelVert; i++) {
    const phi = (i / anelVert) * Math.PI;
    for (let j = 0; j <= anelHoriz; j++) {
      const theta = (j / anelHoriz) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      // Normal SUAVE = a própria posição normalizada, que numa esfera de raio 1
      // já é a posição.
      dados.push(x, y, z, x, y, z, j / anelHoriz, i / anelVert);
    }
  }
  return new Float32Array(dados);
}

function esferaIndices(anelHoriz: number, anelVert: number): Uint32Array {
  const indices: number[] = [];
  for (let i = 0; i < anelVert; i++) {
    for (let j = 0; j < anelHoriz; j++) {
      const a = i * (anelHoriz + 1) + j;
      const b = a + anelHoriz + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return new Uint32Array(indices);
}

function chao(lado: number): Float32Array {
  const m = lado / 2;
  // Quatro vértices, normal para cima.
  return new Float32Array([
    -m, 0, -m, 0, 1, 0, 0, 0,
     m, 0, -m, 0, 1, 0, 1, 0,
     m, 0,  m, 0, 1, 0, 1, 1,
    -m, 0,  m, 0, 1, 0, 0, 1,
  ]);
}

// ── janela ────────────────────────────────────────────────────────────────

const win = openWindow("RTS — a engine no motor novo", 1100, 660, 0);
if (win <= 0) {
  println("openWindow devolveu 0 — o motivo saiu no stderr acima");
} else {
  const malhaEsfera = meshUpload(win, esfera(24, 16), esferaIndices(24, 16));
  const malhaChao = meshUpload(win, chao(40), new Uint32Array([0, 1, 2, 0, 2, 3]));

  // ── a cena, montada com a engine de verdade ─────────────────────────────
  scene.clear();
  const cores: number[] = [
    0xFF4FC3F7, 0xFFFF8A65, 0xFFAED581, 0xFFBA68C8,
    0xFFFFD54F, 0xFF4DB6AC, 0xFFF06292, 0xFF9575CD,
  ];
  const bolas: GameObject[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new GameObject("bola" + i);
    g.setMesh(4, 200, 200, 200);
    g.transform.setPosition(
      -7 + i * 2,
      6 + (i % 3) * 2.5,
      Math.sin(i * 0.9) * 3,
    );
    g.transform.setScale(0.7 + (i % 4) * 0.15);
    // O MESMO Rigidbody que test_scene.ts valida: gravidade e restituição.
    // A gravidade é NEGATIVA por convenção do Rigidbody (o eixo y cresce para
    // cima); passá-la positiva faz as bolas subirem, que foi o primeiro
    // resultado desta demo.
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.62 + (i % 3) * 0.12));
    scene.add(g);
    bolas.push(g);
  }

  setClearColor(win, 0.07, 0.09, 0.13);
  setLight(win, { x: 8, y: 18, z: -6, ambient: 0.28 });
  setShadow(win, { dx: -0.4, dy: -1, dz: 0.3, cx: 0, cy: 0, cz: 0, radius: 22 });

  let frame = 0;
  let pausado = false;
  let jaClicado = false;

  while (isOpen(win)) {
    pump(win);
    beginFrame(win);
    const w = winWidth(win);
    const h = winHeight(win);

    // Clique alterna pausa — a borda, não o estado, senão pausa e despausa a
    // cada frame que o botão fica pressionado.
    //
    // `mouseDown` devolve um BOOLEANO no motor novo, onde a superfície antiga
    // devolvia número. Comparar com `!== 0` sempre dá `true` (mesmo para
    // `false`), então a pausa ligava no frame 0 e nunca mais saía — a física
    // rodava o tempo todo e nada se movia na tela.
    const clicado = mouseDown(win);
    if (clicado && !jaClicado) pausado = !pausado;
    jaClicado = clicado;

    if (!pausado) {
      // dt fixo: a demo mede a ENGINE, e um passo variável faria a física
      // responder ao frame rate em vez de ao próprio código.
      scene.update(1 / 60);
      scene.resolveCollisions();
    }
    scene.computeWorld();

    // Câmera orbitando, dirigida pelo mouse na horizontal.
    const angulo = (mouseX(win) / (w > 0 ? w : 1)) * Math.PI * 2;
    const raio = 26;
    setCamera(win, {
      x: Math.sin(angulo) * raio,
      y: 11,
      z: Math.cos(angulo) * raio,
      // Olhando de volta para a origem: a base é canhota e yaw 0 olha para +Z.
      yaw: angulo + Math.PI,
      pitch: -0.36,
      fov: 1.0,
      aspect: h > 0 ? w / h : 1.6,
    });

    drawMesh(win, { mesh: malhaChao, x: 0, y: 0, z: 0, color: 0xFF243040, tex: 1 });
    for (let i = 0; i < bolas.length; i++) {
      const t = bolas[i].transform;
      drawMesh(win, {
        mesh: malhaEsfera,
        x: t.px, y: t.py, z: t.pz,
        sx: t.sx, sy: t.sy, sz: t.sz,
        color: cores[i],
      });
    }

    // A UI 2D por cima, no mesmo frame — os dois caminhos do egui juntos.
    drawRect(win, { x: 0, y: 0, w: 380, h: 96, fill: 0x000000A0, radius: 10 });
    drawText(win, {
      x: 18, y: 16, size: 20, color: 0xFFFFFFFF,
      text: "engine RTS — Scene + Rigidbody, motor novo",
    });
    drawText(win, {
      x: 18, y: 46, size: 14, color: 0xFF90A0B0,
      text: bolas.length + " corpos · frame " + frame + (pausado ? " · PAUSADO" : ""),
    });
    drawText(win, {
      x: 18, y: 68, size: 14, color: 0xFF90A0B0,
      text: "mouse: orbita · clique: pausa",
    });

    endFrame(win);
    frame = frame + 1;
  }
  close(win);
}
