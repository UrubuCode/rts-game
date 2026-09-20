// Engine RTS — CAMERA: o ponto de vista como COMPONENT de um GameObject
// (o modelo da Unity). A câmera é parte da CENA, não estado solto do editor:
// aparece na hierarquia, tem transform, pode ser FILHA de outro objeto (um
// veículo, um alvo de follow) e receber scripts como qualquer GameObject.
//
// Quem renderiza lê a pose do TRANSFORM do dono:
//   posição = transform de MUNDO (wx,wy,wz) — herda do pai quando é filha
//   yaw     = transform.wry   |   pitch = transform.rx
//
// O runtime do jogo (game.ts) renderiza pela primeira câmera ATIVA da cena
// (Scene.mainCameraIdx). A viewport do editor mantém a fly-cam própria —
// editar não é jogar; o botão "Olhar" alinha uma na outra.

import { Behavior, KIND_CAMERA } from "./behavior";

export class Camera extends Behavior {
  fov: f64;         // campo de visão VERTICAL, em radianos
  isMain: number;   // 1 = câmera principal (a que o jogo usa)

  constructor(fov: f64) {
    super();
    this.fov = fov;
    this.isMain = 1;
  }

  kind(): number { return KIND_CAMERA; }
  typeName(): string { return "Camera"; }

  // ── config no inspector: FOV em GRAUS (radiano é ruim de editar à mão) ────
  fieldCount(): number { return 2; }
  fieldLabel(i: number): string {
    if (i === 0) return "FOV";
    return "Main";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.fov * 57.2957795130823;   // rad → graus
    return this.isMain;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) {
      let g = v;
      if (g < 10.0) g = 10.0;
      if (g > 150.0) g = 150.0;
      this.fov = g / 57.2957795130823;
    } else {
      this.isMain = v !== 0.0 ? 1 : 0;
    }
  }

  toData(): any {
    return { type: "camera", fov: this.fov, isMain: this.isMain };
  }

  // ── acesso do render (dispatch virtual, sem cast) ─────────────────────────
  camFov(): f64 { return this.fov; }
  camIsMain(): number { return this.isMain; }
}
