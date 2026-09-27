// A cena que o jogo (ou o editor) está rodando, para APIs estáticas como
// Camera.main(). Quem cria a cena principal a registra uma vez.
import type { Scene } from "./scene";
let cenaAtiva: Scene | null = null;
export function setActiveScene(sc: Scene | null): void { cenaAtiva = sc; }
export function activeScene(): Scene | null { return cenaAtiva; }
