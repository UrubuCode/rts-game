import { Behavior } from "./behavior";

/** @componentIgnore Placeholder para preservar cenas cujo script nao esta no build. */
export class MissingScript extends Behavior {
  private savedData: any;
  constructor(data: any) { super(); this.savedData = data; }
  typeName(): string { return "Script ausente: " + this.savedData.type; }
  toData(): any { return this.savedData; }
}
