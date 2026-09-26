// GERADO por tools/generate-components.mjs. Edite as classes .ts, nao este arquivo.
import { Behavior } from "../core/behavior";
import { ComponentReflection, componentMetadata } from "../core/component_metadata";
import { AnimationPlayer as Component0 } from "../core/animation_player";
import { Animator as Component1 } from "../core/animator";
import { KeyframeAnimator as Component2 } from "../../scripts/keyframeanimator";
import { VitrineContador as Component3 } from "../../../assets/scripts/VitrineContador";
import { VitrineHud as Component4 } from "../../../assets/scripts/VitrineHud";
import { Collider as Component5 } from "../core/collider";
import { PhysicsMaterial as Component6 } from "../../scripts/physicsmaterial";
import { Rigidbody as Component7 } from "../../scripts/rigidbody";
import { Camera as Component8 } from "../core/camera";
import { Light as Component9 } from "../core/light";
import { Material as Component10 } from "../core/material";
import { MeshRenderer as Component11 } from "../core/meshrenderer";
import { Skeleton as Component12 } from "../core/skeleton";
import { Bobber as Component13 } from "../../scripts/bobber";
import { MotionSettings as Component14 } from "../../../assets/scripts/MotionSettings";
import { Mover as Component15 } from "../../scripts/mover";
import { Orbit as Component16 } from "../../scripts/orbit";
import { Patrol as Component17 } from "../../scripts/patrol";
import { Pulse as Component18 } from "../../scripts/pulse";
import { Spinner as Component19 } from "../../scripts/spinner";
import { UIButton as Component20 } from "../core/ui_button";
import { UIText as Component21 } from "../core/ui_text";
import { AudioSource as Component22 } from "../../scripts/audiosource";
class GeneratedReflection extends ComponentReflection {
  create(name: string): any { return createRegisteredComponent(name); }
  name(component: any): string {
    if (component instanceof Component0) {
      return "AnimationPlayer";
    }
    if (component instanceof Component1) {
      return "Animator";
    }
    if (component instanceof Component2) {
      return "KeyframeAnimator";
    }
    if (component instanceof Component3) {
      return "VitrineContador";
    }
    if (component instanceof Component4) {
      return "VitrineHud";
    }
    if (component instanceof Component5) {
      return "Collider";
    }
    if (component instanceof Component6) {
      return "PhysicsMaterial";
    }
    if (component instanceof Component7) {
      return "Rigidbody";
    }
    if (component instanceof Component8) {
      return "Camera";
    }
    if (component instanceof Component9) {
      return "Light";
    }
    if (component instanceof Component10) {
      return "Material";
    }
    if (component instanceof Component11) {
      return "MeshRenderer";
    }
    if (component instanceof Component12) {
      return "Skeleton";
    }
    if (component instanceof Component13) {
      return "Bobber";
    }
    if (component instanceof Component14) {
      return "MotionSettings";
    }
    if (component instanceof Component15) {
      return "Mover";
    }
    if (component instanceof Component16) {
      return "Orbit";
    }
    if (component instanceof Component17) {
      return "Patrol";
    }
    if (component instanceof Component18) {
      return "Pulse";
    }
    if (component instanceof Component19) {
      return "Spinner";
    }
    if (component instanceof Component20) {
      return "UIButton";
    }
    if (component instanceof Component21) {
      return "UIText";
    }
    if (component instanceof Component22) {
      return "AudioSource";
    }
    return "Script";
  }
  fieldCount(component: any): number {
    if (component instanceof Component0) {
      return 4;
    }
    if (component instanceof Component1) {
      return 1;
    }
    if (component instanceof Component2) {
      return 0;
    }
    if (component instanceof Component3) {
      return 1;
    }
    if (component instanceof Component4) {
      return 2;
    }
    if (component instanceof Component5) {
      return 0;
    }
    if (component instanceof Component6) {
      return 0;
    }
    if (component instanceof Component7) {
      return 0;
    }
    if (component instanceof Component8) {
      return 13;
    }
    if (component instanceof Component9) {
      return 6;
    }
    if (component instanceof Component10) {
      return 0;
    }
    if (component instanceof Component11) {
      return 0;
    }
    if (component instanceof Component12) {
      return 1;
    }
    if (component instanceof Component13) {
      return 3;
    }
    if (component instanceof Component14) {
      return 3;
    }
    if (component instanceof Component15) {
      return 3;
    }
    if (component instanceof Component16) {
      return 4;
    }
    if (component instanceof Component17) {
      return 2;
    }
    if (component instanceof Component18) {
      return 3;
    }
    if (component instanceof Component19) {
      return 2;
    }
    if (component instanceof Component20) {
      return 0;
    }
    if (component instanceof Component21) {
      return 0;
    }
    if (component instanceof Component22) {
      return 0;
    }
    return 0;
  }
  fieldLabel(component: any, index: number): string {
    if (component instanceof Component0) {
      if (index === 0) return "Clip";
      if (index === 1) return "Loop";
      if (index === 2) return "Speed";
      if (index === 3) return "Playing";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "Controller";
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "Contatos";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "Titulo";
      if (index === 1) return "Alvo";
      return "";
    }
    if (component instanceof Component5) {

      return "";
    }
    if (component instanceof Component6) {

      return "";
    }
    if (component instanceof Component7) {

      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "FOV";
      if (index === 1) return "Main";
      if (index === 2) return "Near";
      if (index === 3) return "Far";
      if (index === 4) return "Ortografica";
      if (index === 5) return "Tamanho orto";
      if (index === 6) return "Fundo";
      if (index === 7) return "Cor do fundo";
      if (index === 8) return "Viewport X";
      if (index === 9) return "Viewport Y";
      if (index === 10) return "Viewport W";
      if (index === 11) return "Viewport H";
      if (index === 12) return "Profundidade";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "Tipo";
      if (index === 1) return "Cor";
      if (index === 2) return "Intensidade";
      if (index === 3) return "Alcance";
      if (index === 4) return "Ângulo do spot";
      if (index === 5) return "Sombra";
      return "";
    }
    if (component instanceof Component10) {

      return "";
    }
    if (component instanceof Component11) {

      return "";
    }
    if (component instanceof Component12) {
      if (index === 0) return "Model Path";
      return "";
    }
    if (component instanceof Component13) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base Y";
      return "";
    }
    if (component instanceof Component14) {
      if (index === 0) return "Speed";
      if (index === 1) return "Moving";
      if (index === 2) return "Label";
      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "Vx";
      if (index === 1) return "Vy";
      if (index === 2) return "Vz";
      return "";
    }
    if (component instanceof Component16) {
      if (index === 0) return "Radius";
      if (index === 1) return "Speed";
      if (index === 2) return "Cx";
      if (index === 3) return "Cz";
      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "Range";
      if (index === 1) return "Speed";
      return "";
    }
    if (component instanceof Component18) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base";
      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "SpdY";
      if (index === 1) return "SpdX";
      return "";
    }
    if (component instanceof Component20) {

      return "";
    }
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component22) {

      return "";
    }
    return "";
  }
  fieldType(component: any, index: number): string {
    if (component instanceof Component0) {
      if (index === 0) return "string";
      if (index === 1) return "boolean";
      if (index === 2) return "number";
      if (index === 3) return "boolean";
      return "number";
    }
    if (component instanceof Component1) {
      if (index === 0) return "string";
      return "number";
    }
    if (component instanceof Component2) {

      return "number";
    }
    if (component instanceof Component3) {
      if (index === 0) return "number";
      return "number";
    }
    if (component instanceof Component4) {
      if (index === 0) return "string";
      if (index === 1) return "string";
      return "number";
    }
    if (component instanceof Component5) {

      return "number";
    }
    if (component instanceof Component6) {

      return "number";
    }
    if (component instanceof Component7) {

      return "number";
    }
    if (component instanceof Component8) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "boolean";
      if (index === 5) return "number";
      if (index === 6) return "string";
      if (index === 7) return "number";
      if (index === 8) return "number";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "number";
      if (index === 12) return "number";
      return "number";
    }
    if (component instanceof Component9) {
      if (index === 0) return "string";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "boolean";
      return "number";
    }
    if (component instanceof Component10) {

      return "number";
    }
    if (component instanceof Component11) {

      return "number";
    }
    if (component instanceof Component12) {
      if (index === 0) return "string";
      return "number";
    }
    if (component instanceof Component13) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component14) {
      if (index === 0) return "number";
      if (index === 1) return "boolean";
      if (index === 2) return "string";
      return "number";
    }
    if (component instanceof Component15) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component16) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component17) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component18) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component19) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component20) {

      return "number";
    }
    if (component instanceof Component21) {

      return "number";
    }
    if (component instanceof Component22) {

      return "number";
    }
    return "number";
  }
  fieldGet(component: any, index: number): f64 {
    if (component instanceof Component0) {
      if (index === 0) return 0;
      if (index === 1) return (component["loop"] ? 1 : 0);
      if (index === 2) return component["speed"];
      if (index === 3) return (component["playing"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component1) {
      if (index === 0) return 0;
      return 0;
    }
    if (component instanceof Component2) {

      return 0;
    }
    if (component instanceof Component3) {
      if (index === 0) return component["contatos"];
      return 0;
    }
    if (component instanceof Component4) {
      if (index === 0) return 0;
      if (index === 1) return 0;
      return 0;
    }
    if (component instanceof Component5) {

      return 0;
    }
    if (component instanceof Component6) {

      return 0;
    }
    if (component instanceof Component7) {

      return 0;
    }
    if (component instanceof Component8) {
      if (index === 0) return component["fov"];
      if (index === 1) return component["isMain"];
      if (index === 2) return component["near"];
      if (index === 3) return component["far"];
      if (index === 4) return (component["ortografica"] ? 1 : 0);
      if (index === 5) return component["tamanhoOrto"];
      if (index === 6) return 0;
      if (index === 7) return component["corFundo"];
      if (index === 8) return component["viewportX"];
      if (index === 9) return component["viewportY"];
      if (index === 10) return component["viewportW"];
      if (index === 11) return component["viewportH"];
      if (index === 12) return component["profundidade"];
      return 0;
    }
    if (component instanceof Component9) {
      if (index === 0) return 0;
      if (index === 1) return component["cor"];
      if (index === 2) return component["intensidade"];
      if (index === 3) return component["alcance"];
      if (index === 4) return component["anguloSpot"];
      if (index === 5) return (component["sombra"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component10) {

      return 0;
    }
    if (component instanceof Component11) {

      return 0;
    }
    if (component instanceof Component12) {
      if (index === 0) return 0;
      return 0;
    }
    if (component instanceof Component13) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["baseY"];
      return 0;
    }
    if (component instanceof Component14) {
      if (index === 0) return component["speed"];
      if (index === 1) return (component["moving"] ? 1 : 0);
      if (index === 2) return 0;
      return 0;
    }
    if (component instanceof Component15) {
      if (index === 0) return component["vx"];
      if (index === 1) return component["vy"];
      if (index === 2) return component["vz"];
      return 0;
    }
    if (component instanceof Component16) {
      if (index === 0) return component["radius"];
      if (index === 1) return component["speed"];
      if (index === 2) return component["cx"];
      if (index === 3) return component["cz"];
      return 0;
    }
    if (component instanceof Component17) {
      if (index === 0) return component["range"];
      if (index === 1) return component["speed"];
      return 0;
    }
    if (component instanceof Component18) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["base"];
      return 0;
    }
    if (component instanceof Component19) {
      if (index === 0) return component["speedY"];
      if (index === 1) return component["speedX"];
      return 0;
    }
    if (component instanceof Component20) {

      return 0;
    }
    if (component instanceof Component21) {

      return 0;
    }
    if (component instanceof Component22) {

      return 0;
    }
    return 0;
  }
  fieldStringGet(component: any, index: number): string {
    if (component instanceof Component0) {
      if (index === 0) return component["clip"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return component["controller"];
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return component["titulo"];
      if (index === 1) return component["alvo"];
      return "";
    }
    if (component instanceof Component5) {

      return "";
    }
    if (component instanceof Component6) {

      return "";
    }
    if (component instanceof Component7) {

      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return component["fundo"];
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return component["tipo"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component10) {

      return "";
    }
    if (component instanceof Component11) {

      return "";
    }
    if (component instanceof Component12) {
      if (index === 0) return component["modelPath"];
      return "";
    }
    if (component instanceof Component13) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component14) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return component["label"];
      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component16) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component18) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component20) {

      return "";
    }
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component22) {

      return "";
    }
    return "";
  }
  fieldSet(component: any, index: number, value: f64): void {
    if (component instanceof Component0) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["loop"] = value !== 0; component.onValidate("loop"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["playing"] = value !== 0; component.onValidate("playing"); return; }
      return;
    }
    if (component instanceof Component1) {

      return;
    }
    if (component instanceof Component2) {

      return;
    }
    if (component instanceof Component3) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["contatos"] = value; component.onValidate("contatos"); return; }
      return;
    }
    if (component instanceof Component4) {


      return;
    }
    if (component instanceof Component5) {

      return;
    }
    if (component instanceof Component6) {

      return;
    }
    if (component instanceof Component7) {

      return;
    }
    if (component instanceof Component8) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["fov"] = value; component.onValidate("fov"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["isMain"] = value; component.onValidate("isMain"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["near"] = value; component.onValidate("near"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["far"] = value; component.onValidate("far"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["ortografica"] = value !== 0; component.onValidate("ortografica"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["tamanhoOrto"] = value; component.onValidate("tamanhoOrto"); return; }

      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["corFundo"] = value; component.onValidate("corFundo"); return; }
      if (index === 8) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportX"] = Math.max(0, Math.min(1, value)); component.onValidate("viewportX"); return; }
      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportY"] = Math.max(0, Math.min(1, value)); component.onValidate("viewportY"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportW"] = Math.max(0.01, Math.min(1, value)); component.onValidate("viewportW"); return; }
      if (index === 11) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportH"] = Math.max(0.01, Math.min(1, value)); component.onValidate("viewportH"); return; }
      if (index === 12) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["profundidade"] = value; component.onValidate("profundidade"); return; }
      return;
    }
    if (component instanceof Component9) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cor"] = value; component.onValidate("cor"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["intensidade"] = Math.max(0, Math.min(100, value)); component.onValidate("intensidade"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["alcance"] = Math.max(0, Math.min(10000, value)); component.onValidate("alcance"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["anguloSpot"] = Math.max(1, Math.min(179, value)); component.onValidate("anguloSpot"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["sombra"] = value !== 0; component.onValidate("sombra"); return; }
      return;
    }
    if (component instanceof Component10) {

      return;
    }
    if (component instanceof Component11) {

      return;
    }
    if (component instanceof Component12) {

      return;
    }
    if (component instanceof Component13) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["baseY"] = value; component.onValidate("baseY"); return; }
      return;
    }
    if (component instanceof Component14) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = Math.max(0, Math.min(20, value)); component.onValidate("speed"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["moving"] = value !== 0; component.onValidate("moving"); return; }

      return;
    }
    if (component instanceof Component15) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vx"] = value; component.onValidate("vx"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vy"] = value; component.onValidate("vy"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vz"] = value; component.onValidate("vz"); return; }
      return;
    }
    if (component instanceof Component16) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["radius"] = value; component.onValidate("radius"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cx"] = value; component.onValidate("cx"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cz"] = value; component.onValidate("cz"); return; }
      return;
    }
    if (component instanceof Component17) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["range"] = value; component.onValidate("range"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      return;
    }
    if (component instanceof Component18) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["base"] = value; component.onValidate("base"); return; }
      return;
    }
    if (component instanceof Component19) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedY"] = value; component.onValidate("speedY"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedX"] = value; component.onValidate("speedX"); return; }
      return;
    }
    if (component instanceof Component20) {

      return;
    }
    if (component instanceof Component21) {

      return;
    }
    if (component instanceof Component22) {

      return;
    }
  }
  fieldStringSet(component: any, index: number, value: string): void {
    if (component instanceof Component0) {
      if (index === 0) { component["clip"] = value; component.onValidate("clip"); return; }



      return;
    }
    if (component instanceof Component1) {
      if (index === 0) { component["controller"] = value; component.onValidate("controller"); return; }
      return;
    }
    if (component instanceof Component2) {

      return;
    }
    if (component instanceof Component3) {

      return;
    }
    if (component instanceof Component4) {
      if (index === 0) { component["titulo"] = value; component.onValidate("titulo"); return; }
      if (index === 1) { component["alvo"] = value; component.onValidate("alvo"); return; }
      return;
    }
    if (component instanceof Component5) {

      return;
    }
    if (component instanceof Component6) {

      return;
    }
    if (component instanceof Component7) {

      return;
    }
    if (component instanceof Component8) {






      if (index === 6) { component["fundo"] = value; component.onValidate("fundo"); return; }






      return;
    }
    if (component instanceof Component9) {
      if (index === 0) { component["tipo"] = value; component.onValidate("tipo"); return; }





      return;
    }
    if (component instanceof Component10) {

      return;
    }
    if (component instanceof Component11) {

      return;
    }
    if (component instanceof Component12) {
      if (index === 0) { component["modelPath"] = value; component.onValidate("modelPath"); return; }
      return;
    }
    if (component instanceof Component13) {



      return;
    }
    if (component instanceof Component14) {


      if (index === 2) { component["label"] = value; component.onValidate("label"); return; }
      return;
    }
    if (component instanceof Component15) {



      return;
    }
    if (component instanceof Component16) {




      return;
    }
    if (component instanceof Component17) {


      return;
    }
    if (component instanceof Component18) {



      return;
    }
    if (component instanceof Component19) {


      return;
    }
    if (component instanceof Component20) {

      return;
    }
    if (component instanceof Component21) {

      return;
    }
    if (component instanceof Component22) {

      return;
    }
  }
  serialize(component: any): any {
    if (component instanceof Component0) {
      return { type: "script:src/engine/core/animation_player.ts#AnimationPlayer", fields: { "clip": component["clip"], "loop": component["loop"], "speed": component["speed"], "playing": component["playing"] } };
    }
    if (component instanceof Component1) {
      return { type: "script:src/engine/core/animator.ts#Animator", fields: { "controller": component["controller"] } };
    }
    if (component instanceof Component2) {
      return null;
    }
    if (component instanceof Component3) {
      return { type: "script:assets/scripts/VitrineContador.ts#VitrineContador", fields: { "contatos": component["contatos"] } };
    }
    if (component instanceof Component4) {
      return { type: "script:assets/scripts/VitrineHud.ts#VitrineHud", fields: { "titulo": component["titulo"], "alvo": component["alvo"] } };
    }
    if (component instanceof Component5) {
      return null;
    }
    if (component instanceof Component6) {
      return null;
    }
    if (component instanceof Component7) {
      return null;
    }
    if (component instanceof Component8) {
      return null;
    }
    if (component instanceof Component9) {
      return { type: "script:src/engine/core/light.ts#Light", fields: { "tipo": component["tipo"], "cor": component["cor"], "intensidade": component["intensidade"], "alcance": component["alcance"], "anguloSpot": component["anguloSpot"], "sombra": component["sombra"] } };
    }
    if (component instanceof Component10) {
      return null;
    }
    if (component instanceof Component11) {
      return null;
    }
    if (component instanceof Component12) {
      return null;
    }
    if (component instanceof Component13) {
      return null;
    }
    if (component instanceof Component14) {
      return { type: "script:assets/scripts/MotionSettings.ts#MotionSettings", fields: { "speed": component["speed"], "moving": component["moving"], "label": component["label"] } };
    }
    if (component instanceof Component15) {
      return null;
    }
    if (component instanceof Component16) {
      return null;
    }
    if (component instanceof Component17) {
      return null;
    }
    if (component instanceof Component18) {
      return null;
    }
    if (component instanceof Component19) {
      return null;
    }
    if (component instanceof Component20) {
      return null;
    }
    if (component instanceof Component21) {
      return null;
    }
    if (component instanceof Component22) {
      return null;
    }
    return null;
  }
  legacyFields(component: any): any {
    if (component instanceof Component0) {
      return null;
    }
    if (component instanceof Component1) {
      return null;
    }
    if (component instanceof Component2) {
      return null;
    }
    if (component instanceof Component3) {
      return null;
    }
    if (component instanceof Component4) {
      return null;
    }
    if (component instanceof Component5) {
      return null;
    }
    if (component instanceof Component6) {
      return null;
    }
    if (component instanceof Component7) {
      return null;
    }
    if (component instanceof Component8) {
      return { "fov": component["fov"], "isMain": component["isMain"], "near": component["near"], "far": component["far"], "ortografica": component["ortografica"], "tamanhoOrto": component["tamanhoOrto"], "fundo": component["fundo"], "corFundo": component["corFundo"], "viewportX": component["viewportX"], "viewportY": component["viewportY"], "viewportW": component["viewportW"], "viewportH": component["viewportH"], "profundidade": component["profundidade"] };
    }
    if (component instanceof Component9) {
      return null;
    }
    if (component instanceof Component10) {
      return null;
    }
    if (component instanceof Component11) {
      return null;
    }
    if (component instanceof Component12) {
      return { "modelPath": component["modelPath"] };
    }
    if (component instanceof Component13) {
      return { "amp": component["amp"], "freq": component["freq"], "baseY": component["baseY"] };
    }
    if (component instanceof Component14) {
      return null;
    }
    if (component instanceof Component15) {
      return { "vx": component["vx"], "vy": component["vy"], "vz": component["vz"] };
    }
    if (component instanceof Component16) {
      return { "radius": component["radius"], "speed": component["speed"], "cx": component["cx"], "cz": component["cz"] };
    }
    if (component instanceof Component17) {
      return { "range": component["range"], "speed": component["speed"] };
    }
    if (component instanceof Component18) {
      return { "amp": component["amp"], "freq": component["freq"], "base": component["base"] };
    }
    if (component instanceof Component19) {
      return { "speedY": component["speedY"], "speedX": component["speedX"] };
    }
    if (component instanceof Component20) {
      return null;
    }
    if (component instanceof Component21) {
      return null;
    }
    if (component instanceof Component22) {
      return null;
    }
    return null;
  }
  restoreLegacyFields(component: any, fields: any): void {
    if (component instanceof Component0) {
      return;
    }
    if (component instanceof Component1) {
      return;
    }
    if (component instanceof Component2) {
      return;
    }
    if (component instanceof Component3) {
      return;
    }
    if (component instanceof Component4) {
      return;
    }
    if (component instanceof Component5) {
      return;
    }
    if (component instanceof Component6) {
      return;
    }
    if (component instanceof Component7) {
      return;
    }
    if (component instanceof Component8) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["fov"] === "number" && fields["fov"] === fields["fov"] && fields["fov"] > -1e30 && fields["fov"] < 1e30) component["fov"] = fields["fov"];
      if (typeof fields["isMain"] === "number" && fields["isMain"] === fields["isMain"] && fields["isMain"] > -1e30 && fields["isMain"] < 1e30) component["isMain"] = fields["isMain"];
      if (typeof fields["near"] === "number" && fields["near"] === fields["near"] && fields["near"] > -1e30 && fields["near"] < 1e30) component["near"] = fields["near"];
      if (typeof fields["far"] === "number" && fields["far"] === fields["far"] && fields["far"] > -1e30 && fields["far"] < 1e30) component["far"] = fields["far"];
      if (typeof fields["ortografica"] === "boolean" && true) component["ortografica"] = fields["ortografica"];
      if (typeof fields["tamanhoOrto"] === "number" && fields["tamanhoOrto"] === fields["tamanhoOrto"] && fields["tamanhoOrto"] > -1e30 && fields["tamanhoOrto"] < 1e30) component["tamanhoOrto"] = fields["tamanhoOrto"];
      if (typeof fields["fundo"] === "string" && true) component["fundo"] = fields["fundo"];
      if (typeof fields["corFundo"] === "number" && fields["corFundo"] === fields["corFundo"] && fields["corFundo"] > -1e30 && fields["corFundo"] < 1e30) component["corFundo"] = fields["corFundo"];
      if (typeof fields["viewportX"] === "number" && fields["viewportX"] === fields["viewportX"] && fields["viewportX"] > -1e30 && fields["viewportX"] < 1e30) component["viewportX"] = Math.max(0, Math.min(1, fields["viewportX"]));
      if (typeof fields["viewportY"] === "number" && fields["viewportY"] === fields["viewportY"] && fields["viewportY"] > -1e30 && fields["viewportY"] < 1e30) component["viewportY"] = Math.max(0, Math.min(1, fields["viewportY"]));
      if (typeof fields["viewportW"] === "number" && fields["viewportW"] === fields["viewportW"] && fields["viewportW"] > -1e30 && fields["viewportW"] < 1e30) component["viewportW"] = Math.max(0.01, Math.min(1, fields["viewportW"]));
      if (typeof fields["viewportH"] === "number" && fields["viewportH"] === fields["viewportH"] && fields["viewportH"] > -1e30 && fields["viewportH"] < 1e30) component["viewportH"] = Math.max(0.01, Math.min(1, fields["viewportH"]));
      if (typeof fields["profundidade"] === "number" && fields["profundidade"] === fields["profundidade"] && fields["profundidade"] > -1e30 && fields["profundidade"] < 1e30) component["profundidade"] = fields["profundidade"];
      return;
    }
    if (component instanceof Component9) {
      return;
    }
    if (component instanceof Component10) {
      return;
    }
    if (component instanceof Component11) {
      return;
    }
    if (component instanceof Component12) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["modelPath"] === "string" && true) component["modelPath"] = fields["modelPath"];
      return;
    }
    if (component instanceof Component13) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["baseY"] === "number" && fields["baseY"] === fields["baseY"] && fields["baseY"] > -1e30 && fields["baseY"] < 1e30) component["baseY"] = fields["baseY"];
      return;
    }
    if (component instanceof Component14) {
      return;
    }
    if (component instanceof Component15) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["vx"] === "number" && fields["vx"] === fields["vx"] && fields["vx"] > -1e30 && fields["vx"] < 1e30) component["vx"] = fields["vx"];
      if (typeof fields["vy"] === "number" && fields["vy"] === fields["vy"] && fields["vy"] > -1e30 && fields["vy"] < 1e30) component["vy"] = fields["vy"];
      if (typeof fields["vz"] === "number" && fields["vz"] === fields["vz"] && fields["vz"] > -1e30 && fields["vz"] < 1e30) component["vz"] = fields["vz"];
      return;
    }
    if (component instanceof Component16) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["radius"] === "number" && fields["radius"] === fields["radius"] && fields["radius"] > -1e30 && fields["radius"] < 1e30) component["radius"] = fields["radius"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      if (typeof fields["cx"] === "number" && fields["cx"] === fields["cx"] && fields["cx"] > -1e30 && fields["cx"] < 1e30) component["cx"] = fields["cx"];
      if (typeof fields["cz"] === "number" && fields["cz"] === fields["cz"] && fields["cz"] > -1e30 && fields["cz"] < 1e30) component["cz"] = fields["cz"];
      return;
    }
    if (component instanceof Component17) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["range"] === "number" && fields["range"] === fields["range"] && fields["range"] > -1e30 && fields["range"] < 1e30) component["range"] = fields["range"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      return;
    }
    if (component instanceof Component18) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["base"] === "number" && fields["base"] === fields["base"] && fields["base"] > -1e30 && fields["base"] < 1e30) component["base"] = fields["base"];
      return;
    }
    if (component instanceof Component19) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["speedY"] === "number" && fields["speedY"] === fields["speedY"] && fields["speedY"] > -1e30 && fields["speedY"] < 1e30) component["speedY"] = fields["speedY"];
      if (typeof fields["speedX"] === "number" && fields["speedX"] === fields["speedX"] && fields["speedX"] > -1e30 && fields["speedX"] < 1e30) component["speedX"] = fields["speedX"];
      return;
    }
    if (component instanceof Component20) {
      return;
    }
    if (component instanceof Component21) {
      return;
    }
    if (component instanceof Component22) {
      return;
    }
  }
  drawsGizmos(component: any): boolean {
    if (component instanceof Component0) {
      return false;
    }
    if (component instanceof Component1) {
      return false;
    }
    if (component instanceof Component2) {
      return false;
    }
    if (component instanceof Component3) {
      return false;
    }
    if (component instanceof Component4) {
      return false;
    }
    if (component instanceof Component5) {
      return false;
    }
    if (component instanceof Component6) {
      return false;
    }
    if (component instanceof Component7) {
      return false;
    }
    if (component instanceof Component8) {
      return false;
    }
    if (component instanceof Component9) {
      return false;
    }
    if (component instanceof Component10) {
      return false;
    }
    if (component instanceof Component11) {
      return false;
    }
    if (component instanceof Component12) {
      return false;
    }
    if (component instanceof Component13) {
      return false;
    }
    if (component instanceof Component14) {
      return false;
    }
    if (component instanceof Component15) {
      return false;
    }
    if (component instanceof Component16) {
      return false;
    }
    if (component instanceof Component17) {
      return false;
    }
    if (component instanceof Component18) {
      return false;
    }
    if (component instanceof Component19) {
      return false;
    }
    if (component instanceof Component20) {
      return false;
    }
    if (component instanceof Component21) {
      return false;
    }
    if (component instanceof Component22) {
      return false;
    }
    return false;
  }
}
componentMetadata.provider = new GeneratedReflection();
export function createRegisteredComponent(name: string): Behavior {
  if (name === "AnimationPlayer") return new Component0();
  if (name === "Animator") return new Component1();
  if (name === "KeyframeAnimator") return Component2.createDefault();
  if (name === "VitrineContador") return new Component3();
  if (name === "VitrineHud") return new Component4();
  if (name === "Collider") return new Component5();
  if (name === "PhysicsMaterial") return new Component6();
  if (name === "Rigidbody") return new Component7();
  if (name === "Camera") return new Component8();
  if (name === "Light") return new Component9();
  if (name === "Material") return new Component10();
  if (name === "MeshRenderer") return new Component11();
  if (name === "Skeleton") return new Component12();
  if (name === "Bobber") return new Component13();
  if (name === "MotionSettings") return new Component14();
  if (name === "Mover") return new Component15();
  if (name === "Orbit") return new Component16();
  if (name === "Patrol") return new Component17();
  if (name === "Pulse") return new Component18();
  if (name === "Spinner") return new Component19();
  if (name === "UIButton") return new Component20();
  if (name === "UIText") return new Component21();
  if (name === "AudioSource") return new Component22();
  throw new Error("Componente nao registrado: " + name);
}
export function restoreRegisteredComponent(data: any): any {
  if (data.type === "script:src/engine/core/animation_player.ts#AnimationPlayer") {
    const component = new Component0();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["clip"] === "string" && true) component["clip"] = data.fields["clip"];
      if (typeof data.fields["loop"] === "boolean" && true) component["loop"] = data.fields["loop"];
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = data.fields["speed"];
      if (typeof data.fields["playing"] === "boolean" && true) component["playing"] = data.fields["playing"];
    return component;
  }
  if (data.type === "script:src/engine/core/animator.ts#Animator") {
    const component = new Component1();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["controller"] === "string" && true) component["controller"] = data.fields["controller"];
    return component;
  }
  if (data.type === "script:assets/scripts/VitrineContador.ts#VitrineContador") {
    const component = new Component3();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["contatos"] === "number" && data.fields["contatos"] === data.fields["contatos"] && data.fields["contatos"] > -1e30 && data.fields["contatos"] < 1e30) component["contatos"] = data.fields["contatos"];
    return component;
  }
  if (data.type === "script:assets/scripts/VitrineHud.ts#VitrineHud") {
    const component = new Component4();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["titulo"] === "string" && true) component["titulo"] = data.fields["titulo"];
      if (typeof data.fields["alvo"] === "string" && true) component["alvo"] = data.fields["alvo"];
    return component;
  }
  if (data.type === "script:src/engine/core/light.ts#Light") {
    const component = new Component9();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["tipo"] === "string" && true) component["tipo"] = data.fields["tipo"];
      if (typeof data.fields["cor"] === "number" && data.fields["cor"] === data.fields["cor"] && data.fields["cor"] > -1e30 && data.fields["cor"] < 1e30) component["cor"] = data.fields["cor"];
      if (typeof data.fields["intensidade"] === "number" && data.fields["intensidade"] === data.fields["intensidade"] && data.fields["intensidade"] > -1e30 && data.fields["intensidade"] < 1e30) component["intensidade"] = Math.max(0, Math.min(100, data.fields["intensidade"]));
      if (typeof data.fields["alcance"] === "number" && data.fields["alcance"] === data.fields["alcance"] && data.fields["alcance"] > -1e30 && data.fields["alcance"] < 1e30) component["alcance"] = Math.max(0, Math.min(10000, data.fields["alcance"]));
      if (typeof data.fields["anguloSpot"] === "number" && data.fields["anguloSpot"] === data.fields["anguloSpot"] && data.fields["anguloSpot"] > -1e30 && data.fields["anguloSpot"] < 1e30) component["anguloSpot"] = Math.max(1, Math.min(179, data.fields["anguloSpot"]));
      if (typeof data.fields["sombra"] === "boolean" && true) component["sombra"] = data.fields["sombra"];
    return component;
  }
  if (data.type === "script:assets/scripts/MotionSettings.ts#MotionSettings") {
    const component = new Component14();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = Math.max(0, Math.min(20, data.fields["speed"]));
      if (typeof data.fields["moving"] === "boolean" && true) component["moving"] = data.fields["moving"];
      if (typeof data.fields["label"] === "string" && true) component["label"] = data.fields["label"];
    return component;
  }
  return null;
}
export const REGISTRO = "jogo";
