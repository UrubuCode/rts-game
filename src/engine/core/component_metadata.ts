// Contrato pequeno, sem imports de scripts: evita ciclos Behavior -> script -> Behavior.
// O provider concreto e gerado a partir das classes TS e instalado no bootstrap.
const SEM_OPCOES: string[] = [];

export class ComponentReflection {
  create(name: string): any { throw new Error("Registro de componentes nao inicializado: " + name); }
  name(component: any): string { return "Script"; }
  fieldCount(component: any): number { return 0; }
  fieldLabel(component: any, index: number): string { return ""; }
  /// Nome do campo `index` na classe (o mesmo do JSON da cena).
  fieldName(component: any, index: number): string { return ""; }
  fieldType(component: any, index: number): string { return "number"; }
  fieldGet(component: any, index: number): f64 { return 0; }
  fieldSet(component: any, index: number, value: f64): void {}
  fieldStringGet(component: any, index: number): string { return ""; }
  fieldStringSet(component: any, index: number, value: string): void {}
  /// Dica do campo além do tipo ("" | "color" | "enum"; ver Behavior.fieldHint).
  /// O gerador ainda não emite: é o ponto para uma futura marcação JSDoc
  /// (@color/@options) entrar sem mudar a API dos componentes.
  fieldHint(component: any, index: number): string { return ""; }
  /// Kind cru do `@asset` ("audio"/"imagem"/...) do campo `index`, sem o
  /// prefixo "asset:" de `fieldHint` — usado só pelo caminho por quadro do
  /// Inspector, pra nunca fatiar uma string ali (ver `fieldHint`).
  fieldAssetKind(component: any, index: number): string { return ""; }
  /// Opções de um campo "enum" (ver Behavior.fieldOptions).
  fieldOptions(component: any, index: number): string[] { return SEM_OPCOES; }
  serialize(component: any): any { return null; }
  legacyFields(component: any): any { return null; }
  restoreLegacyFields(component: any, fields: any): void {}
  /// O component sobrescreve onDrawGizmos/onDrawGizmosSelected (editor).
  drawsGizmos(component: any): boolean { return false; }
}

export class ComponentMetadata {
  provider: ComponentReflection = new ComponentReflection();
}

export const componentMetadata = new ComponentMetadata();
