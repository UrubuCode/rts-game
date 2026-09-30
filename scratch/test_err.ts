import io from "@compat/io.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { setSpatialScene, spatialRebuildIndex, raycast } from "../src/engine/core/spatial_queries";

const sc = new Scene("TestScene");
setSpatialScene(sc);

const sphereObj = new GameObject("SphereTarget");
sphereObj.setMesh(4, 255, 0, 0);
sphereObj.transform.setPosition(0.0, 0.0, 10.0);
sphereObj.transform.setScale(2.0);
sc.add(sphereObj);

const boxObj = new GameObject("BoxTarget");
boxObj.setMesh(1, 0, 255, 0);
boxObj.transform.setPosition(10.0, 0.0, 0.0);
boxObj.transform.setScale(2.0);
sc.add(boxObj);
sc.computeWorld();

spatialRebuildIndex(sc);
try {
  const hitSphere = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 20.0);
  io.print("Sphere hit: " + (hitSphere !== null ? "yes, dist=" + hitSphere.distance : "no"));
  const hitBox = raycast(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 20.0);
  io.print("Box hit: " + (hitBox !== null ? "yes, dist=" + hitBox.distance : "no"));
} catch (e: any) {
  io.print("Caught error: " + e + "\nStack: " + e.stack);
}
