// Engine RTS — SceneRef: marca um GameObject como INSTÂNCIA de outra cena (cena
// dentro de cena, estilo Godot). É um component de DADOS (sem update): guarda o
// path da sub-cena instanciada sob este objeto. Serve pra (a) o inspector mostrar
// "de qual cena isso veio" e (b) a serialização re-instanciar no load.
//
// A instância em si (adicionar os objetos da sub-cena parenteados) é feita por
// `sceneio.instantiateSceneUnder` no momento do `instscene`; este component é o
// MARCADOR que fica no host. Fecha a cena-dentro-de-cena no modelo "tudo é
// GameObject": o vínculo com a outra cena é um component como qualquer outro.

import { Behavior, KIND_SCENE_REF } from "./behavior";

export class SceneRef extends Behavior {
  scenePath: string;   // path da cena instanciada sob este objeto

  constructor(scenePath: string) {
    super();
    this.scenePath = scenePath;
  }

  kind(): number { return KIND_SCENE_REF; }
  typeName(): string { return "SceneRef"; }

  toData(): any {
    return { type: "sceneRef", scenePath: this.scenePath };
  }
}
