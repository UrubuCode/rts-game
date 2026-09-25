// GERADO por tools/generate-components.mjs. Edite as classes .ts, nao este arquivo.
import { Behavior } from "../core/behavior";
import { ComponentReflection, componentMetadata } from "../core/component_metadata";
import { Animator as Component0 } from "../../scripts/animator";
import { VitrineContador as Component1 } from "../../../assets/scripts/VitrineContador";
import { VitrineHud as Component2 } from "../../../assets/scripts/VitrineHud";
import { Collider as Component3 } from "../core/collider";
import { PhysicsMaterial as Component4 } from "../../scripts/physicsmaterial";
import { Rigidbody as Component5 } from "../../scripts/rigidbody";
import { Camera as Component6 } from "../core/camera";
import { Material as Component7 } from "../core/material";
import { MeshRenderer as Component8 } from "../core/meshrenderer";
import { Bobber as Component9 } from "../../scripts/bobber";
import { MotionSettings as Component10 } from "../../../assets/scripts/MotionSettings";
import { Mover as Component11 } from "../../scripts/mover";
import { Orbit as Component12 } from "../../scripts/orbit";
import { Patrol as Component13 } from "../../scripts/patrol";
import { Pulse as Component14 } from "../../scripts/pulse";
import { Spinner as Component15 } from "../../scripts/spinner";
import { UIButton as Component16 } from "../core/ui_button";
import { UIText as Component17 } from "../core/ui_text";
import { AudioSource as Component18 } from "../../scripts/audiosource";
class GeneratedReflection extends ComponentReflection {
  create(name: string): any { return createRegisteredComponent(name); }
  name(component: any): string {
    if (component instanceof Component0) {
      return "Animator";
    }
    if (component instanceof Component1) {
      return "VitrineContador";
    }
    if (component instanceof Component2) {
      return "VitrineHud";
    }
    if (component instanceof Component3) {
      return "Collider";
    }
    if (component instanceof Component4) {
      return "PhysicsMaterial";
    }
    if (component instanceof Component5) {
      return "Rigidbody";
    }
    if (component instanceof Component6) {
      return "Camera";
    }
    if (component instanceof Component7) {
      return "Material";
    }
    if (component instanceof Component8) {
      return "MeshRenderer";
    }
    if (component instanceof Component9) {
      return "Bobber";
    }
    if (component instanceof Component10) {
      return "MotionSettings";
    }
    if (component instanceof Component11) {
      return "Mover";
    }
    if (component instanceof Component12) {
      return "Orbit";
    }
    if (component instanceof Component13) {
      return "Patrol";
    }
    if (component instanceof Component14) {
      return "Pulse";
    }
    if (component instanceof Component15) {
      return "Spinner";
    }
    if (component instanceof Component16) {
      return "UIButton";
    }
    if (component instanceof Component17) {
      return "UIText";
    }
    if (component instanceof Component18) {
      return "AudioSource";
    }
    return "Script";
  }
  fieldCount(component: any): number {
    if (component instanceof Component0) {
      return 0;
    }
    if (component instanceof Component1) {
      return 1;
    }
    if (component instanceof Component2) {
      return 2;
    }
    if (component instanceof Component3) {
      return 0;
    }
    if (component instanceof Component4) {
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
      return 0;
    }
    if (component instanceof Component9) {
      return 3;
    }
    if (component instanceof Component10) {
      return 3;
    }
    if (component instanceof Component11) {
      return 3;
    }
    if (component instanceof Component12) {
      return 4;
    }
    if (component instanceof Component13) {
      return 2;
    }
    if (component instanceof Component14) {
      return 3;
    }
    if (component instanceof Component15) {
      return 2;
    }
    if (component instanceof Component16) {
      return 0;
    }
    if (component instanceof Component17) {
      return 0;
    }
    if (component instanceof Component18) {
      return 0;
    }
    return 0;
  }
  fieldLabel(component: any, index: number): string {
    if (component instanceof Component0) {

      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "Contatos";
      return "";
    }
    if (component instanceof Component2) {
      if (index === 0) return "Titulo";
      if (index === 1) return "Alvo";
      return "";
    }
    if (component instanceof Component3) {

      return "";
    }
    if (component instanceof Component4) {

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

      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base Y";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "Speed";
      if (index === 1) return "Moving";
      if (index === 2) return "Label";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "Vx";
      if (index === 1) return "Vy";
      if (index === 2) return "Vz";
      return "";
    }
    if (component instanceof Component12) {
      if (index === 0) return "Radius";
      if (index === 1) return "Speed";
      if (index === 2) return "Cx";
      if (index === 3) return "Cz";
      return "";
    }
    if (component instanceof Component13) {
      if (index === 0) return "Range";
      if (index === 1) return "Speed";
      return "";
    }
    if (component instanceof Component14) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base";
      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "SpdY";
      if (index === 1) return "SpdX";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {

      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    return "";
  }
  fieldType(component: any, index: number): string {
    if (component instanceof Component0) {

      return "number";
    }
    if (component instanceof Component1) {
      if (index === 0) return "number";
      return "number";
    }
    if (component instanceof Component2) {
      if (index === 0) return "string";
      if (index === 1) return "string";
      return "number";
    }
    if (component instanceof Component3) {

      return "number";
    }
    if (component instanceof Component4) {

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

      return "number";
    }
    if (component instanceof Component9) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component10) {
      if (index === 0) return "number";
      if (index === 1) return "boolean";
      if (index === 2) return "string";
      return "number";
    }
    if (component instanceof Component11) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component12) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component13) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component14) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component15) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component16) {

      return "number";
    }
    if (component instanceof Component17) {

      return "number";
    }
    if (component instanceof Component18) {

      return "number";
    }
    return "number";
  }
  fieldGet(component: any, index: number): f64 {
    if (component instanceof Component0) {

      return 0;
    }
    if (component instanceof Component1) {
      if (index === 0) return component["contatos"];
      return 0;
    }
    if (component instanceof Component2) {
      if (index === 0) return 0;
      if (index === 1) return 0;
      return 0;
    }
    if (component instanceof Component3) {

      return 0;
    }
    if (component instanceof Component4) {

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

      return 0;
    }
    if (component instanceof Component9) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["baseY"];
      return 0;
    }
    if (component instanceof Component10) {
      if (index === 0) return component["speed"];
      if (index === 1) return (component["moving"] ? 1 : 0);
      if (index === 2) return 0;
      return 0;
    }
    if (component instanceof Component11) {
      if (index === 0) return component["vx"];
      if (index === 1) return component["vy"];
      if (index === 2) return component["vz"];
      return 0;
    }
    if (component instanceof Component12) {
      if (index === 0) return component["radius"];
      if (index === 1) return component["speed"];
      if (index === 2) return component["cx"];
      if (index === 3) return component["cz"];
      return 0;
    }
    if (component instanceof Component13) {
      if (index === 0) return component["range"];
      if (index === 1) return component["speed"];
      return 0;
    }
    if (component instanceof Component14) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["base"];
      return 0;
    }
    if (component instanceof Component15) {
      if (index === 0) return component["speedY"];
      if (index === 1) return component["speedX"];
      return 0;
    }
    if (component instanceof Component16) {

      return 0;
    }
    if (component instanceof Component17) {

      return 0;
    }
    if (component instanceof Component18) {

      return 0;
    }
    return 0;
  }
  fieldStringGet(component: any, index: number): string {
    if (component instanceof Component0) {

      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component2) {
      if (index === 0) return component["titulo"];
      if (index === 1) return component["alvo"];
      return "";
    }
    if (component instanceof Component3) {

      return "";
    }
    if (component instanceof Component4) {

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

      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return component["label"];
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component12) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component13) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component14) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {

      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    return "";
  }
  fieldSet(component: any, index: number, value: f64): void {
    if (component instanceof Component0) {

      return;
    }
    if (component instanceof Component1) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["contatos"] = value; component.onValidate("contatos"); return; }
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

      return;
    }
    if (component instanceof Component9) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["baseY"] = value; component.onValidate("baseY"); return; }
      return;
    }
    if (component instanceof Component10) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = Math.max(0, Math.min(20, value)); component.onValidate("speed"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["moving"] = value !== 0; component.onValidate("moving"); return; }

      return;
    }
    if (component instanceof Component11) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vx"] = value; component.onValidate("vx"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vy"] = value; component.onValidate("vy"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vz"] = value; component.onValidate("vz"); return; }
      return;
    }
    if (component instanceof Component12) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["radius"] = value; component.onValidate("radius"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cx"] = value; component.onValidate("cx"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cz"] = value; component.onValidate("cz"); return; }
      return;
    }
    if (component instanceof Component13) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["range"] = value; component.onValidate("range"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      return;
    }
    if (component instanceof Component14) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["base"] = value; component.onValidate("base"); return; }
      return;
    }
    if (component instanceof Component15) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedY"] = value; component.onValidate("speedY"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedX"] = value; component.onValidate("speedX"); return; }
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
  }
  fieldStringSet(component: any, index: number, value: string): void {
    if (component instanceof Component0) {

      return;
    }
    if (component instanceof Component1) {

      return;
    }
    if (component instanceof Component2) {
      if (index === 0) { component["titulo"] = value; component.onValidate("titulo"); return; }
      if (index === 1) { component["alvo"] = value; component.onValidate("alvo"); return; }
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

      return;
    }
    if (component instanceof Component9) {



      return;
    }
    if (component instanceof Component10) {


      if (index === 2) { component["label"] = value; component.onValidate("label"); return; }
      return;
    }
    if (component instanceof Component11) {



      return;
    }
    if (component instanceof Component12) {




      return;
    }
    if (component instanceof Component13) {


      return;
    }
    if (component instanceof Component14) {



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
  }
  serialize(component: any): any {
    if (component instanceof Component0) {
      return null;
    }
    if (component instanceof Component1) {
      return { type: "script:assets/scripts/VitrineContador.ts#VitrineContador", fields: { "contatos": component["contatos"] } };
    }
    if (component instanceof Component2) {
      return { type: "script:assets/scripts/VitrineHud.ts#VitrineHud", fields: { "titulo": component["titulo"], "alvo": component["alvo"] } };
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
      return null;
    }
    if (component instanceof Component9) {
      return null;
    }
    if (component instanceof Component10) {
      return { type: "script:assets/scripts/MotionSettings.ts#MotionSettings", fields: { "speed": component["speed"], "moving": component["moving"], "label": component["label"] } };
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
      return null;
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
      return null;
    }
    if (component instanceof Component9) {
      return { "amp": component["amp"], "freq": component["freq"], "baseY": component["baseY"] };
    }
    if (component instanceof Component10) {
      return null;
    }
    if (component instanceof Component11) {
      return { "vx": component["vx"], "vy": component["vy"], "vz": component["vz"] };
    }
    if (component instanceof Component12) {
      return { "radius": component["radius"], "speed": component["speed"], "cx": component["cx"], "cz": component["cz"] };
    }
    if (component instanceof Component13) {
      return { "range": component["range"], "speed": component["speed"] };
    }
    if (component instanceof Component14) {
      return { "amp": component["amp"], "freq": component["freq"], "base": component["base"] };
    }
    if (component instanceof Component15) {
      return { "speedY": component["speedY"], "speedX": component["speedX"] };
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
      return;
    }
    if (component instanceof Component9) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["baseY"] === "number" && fields["baseY"] === fields["baseY"] && fields["baseY"] > -1e30 && fields["baseY"] < 1e30) component["baseY"] = fields["baseY"];
      return;
    }
    if (component instanceof Component10) {
      return;
    }
    if (component instanceof Component11) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["vx"] === "number" && fields["vx"] === fields["vx"] && fields["vx"] > -1e30 && fields["vx"] < 1e30) component["vx"] = fields["vx"];
      if (typeof fields["vy"] === "number" && fields["vy"] === fields["vy"] && fields["vy"] > -1e30 && fields["vy"] < 1e30) component["vy"] = fields["vy"];
      if (typeof fields["vz"] === "number" && fields["vz"] === fields["vz"] && fields["vz"] > -1e30 && fields["vz"] < 1e30) component["vz"] = fields["vz"];
      return;
    }
    if (component instanceof Component12) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["radius"] === "number" && fields["radius"] === fields["radius"] && fields["radius"] > -1e30 && fields["radius"] < 1e30) component["radius"] = fields["radius"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      if (typeof fields["cx"] === "number" && fields["cx"] === fields["cx"] && fields["cx"] > -1e30 && fields["cx"] < 1e30) component["cx"] = fields["cx"];
      if (typeof fields["cz"] === "number" && fields["cz"] === fields["cz"] && fields["cz"] > -1e30 && fields["cz"] < 1e30) component["cz"] = fields["cz"];
      return;
    }
    if (component instanceof Component13) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["range"] === "number" && fields["range"] === fields["range"] && fields["range"] > -1e30 && fields["range"] < 1e30) component["range"] = fields["range"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      return;
    }
    if (component instanceof Component14) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["base"] === "number" && fields["base"] === fields["base"] && fields["base"] > -1e30 && fields["base"] < 1e30) component["base"] = fields["base"];
      return;
    }
    if (component instanceof Component15) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["speedY"] === "number" && fields["speedY"] === fields["speedY"] && fields["speedY"] > -1e30 && fields["speedY"] < 1e30) component["speedY"] = fields["speedY"];
      if (typeof fields["speedX"] === "number" && fields["speedX"] === fields["speedX"] && fields["speedX"] > -1e30 && fields["speedX"] < 1e30) component["speedX"] = fields["speedX"];
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
  }
}
componentMetadata.provider = new GeneratedReflection();
export function createRegisteredComponent(name: string): Behavior {
  if (name === "Animator") return Component0.createDefault();
  if (name === "VitrineContador") return new Component1();
  if (name === "VitrineHud") return new Component2();
  if (name === "Collider") return new Component3();
  if (name === "PhysicsMaterial") return new Component4();
  if (name === "Rigidbody") return new Component5();
  if (name === "Camera") return new Component6();
  if (name === "Material") return new Component7();
  if (name === "MeshRenderer") return new Component8();
  if (name === "Bobber") return new Component9();
  if (name === "MotionSettings") return new Component10();
  if (name === "Mover") return new Component11();
  if (name === "Orbit") return new Component12();
  if (name === "Patrol") return new Component13();
  if (name === "Pulse") return new Component14();
  if (name === "Spinner") return new Component15();
  if (name === "UIButton") return new Component16();
  if (name === "UIText") return new Component17();
  if (name === "AudioSource") return new Component18();
  throw new Error("Componente nao registrado: " + name);
}
export function restoreRegisteredComponent(data: any): any {
  if (data.type === "script:assets/scripts/VitrineContador.ts#VitrineContador") {
    const component = new Component1();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["contatos"] === "number" && data.fields["contatos"] === data.fields["contatos"] && data.fields["contatos"] > -1e30 && data.fields["contatos"] < 1e30) component["contatos"] = data.fields["contatos"];
    return component;
  }
  if (data.type === "script:assets/scripts/VitrineHud.ts#VitrineHud") {
    const component = new Component2();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["titulo"] === "string" && true) component["titulo"] = data.fields["titulo"];
      if (typeof data.fields["alvo"] === "string" && true) component["alvo"] = data.fields["alvo"];
    return component;
  }
  if (data.type === "script:assets/scripts/MotionSettings.ts#MotionSettings") {
    const component = new Component10();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = Math.max(0, Math.min(20, data.fields["speed"]));
      if (typeof data.fields["moving"] === "boolean" && true) component["moving"] = data.fields["moving"];
      if (typeof data.fields["label"] === "string" && true) component["label"] = data.fields["label"];
    return component;
  }
  return null;
}
