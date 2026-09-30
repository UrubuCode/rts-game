import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";

function criarCenaAlinhada(n: number): Scene {
  const sc = new Scene("BenchScene_Alinhada_" + n);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("dyn_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function runScene(nome: string, sc: Scene) {
  io.print("Done: " + nome + " objCount=" + sc.objects.length);
}

runScene("1", criarCenaAlinhada(2000));
runScene("2", criarCenaAlinhada(2000));
runScene("3", criarCenaAlinhada(2000));
runScene("4", criarCenaAlinhada(2000));
runScene("5", criarCenaAlinhada(2000));
runScene("6", criarCenaAlinhada(2000));
runScene("7", criarCenaAlinhada(2000));
runScene("8", criarCenaAlinhada(2000));
runScene("9", criarCenaAlinhada(2000));
runScene("10", criarCenaAlinhada(2000));
io.print("Finished 10 scenes without spatial index!");
