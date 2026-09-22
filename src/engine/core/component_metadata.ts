// Contrato pequeno, sem imports de scripts: evita ciclos Behavior -> script -> Behavior.
// O provider concreto e gerado a partir das classes TS e instalado no bootstrap.
export class ComponentReflection {
  create(name: string): any { throw new Error("Registro de componentes nao inicializado: " + name); }
  name(component: any): string { return "Script"; }
  fieldCount(component: any): number { return 0; }
  fieldLabel(component: any, index: number): string { return ""; }
  fieldType(component: any, index: number): string { return "number"; }
  fieldGet(component: any, index: number): f64 { return 0; }
  fieldSet(component: any, index: number, value: f64): void {}
  fieldStringGet(component: any, index: number): string { return ""; }
  fieldStringSet(component: any, index: number, value: string): void {}
  serialize(component: any): any { return null; }
  legacyFields(component: any): any { return null; }
  restoreLegacyFields(component: any, fields: any): void {}
}

export class ComponentMetadata {
  provider: ComponentReflection = new ComponentReflection();
}

export const componentMetadata = new ComponentMetadata();
