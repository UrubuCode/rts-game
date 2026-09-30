import io from "@compat/io.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import {
  setSpatialScene,
  raycast,
  getSpatialIndex,
} from "../src/engine/core/spatial_queries";

const sc = new Scene("TestScene");
setSpatialScene(sc);

const sphereObj = new GameObject("SphereTarget");
sphereObj.setMesh(4, 255, 0, 0);
sphereObj.transform.setPosition(0.0, 0.0, 10.0);
sphereObj.transform.setScale(2.0);
sc.add(sphereObj);
sc.computeWorld();

const idx = getSpatialIndex(sc);
idx.ensureIndex();
io.print("dynamicCount=" + idx.dynamicCount + " staticCount=" + idx.staticCount + " objs.length=" + idx.objs.length);
io.print("dynSceneMinZ=" + idx.dynSceneMinZ + " dynSceneMaxZ=" + idx.dynSceneMaxZ);
io.print("sphereObj.active=" + sphereObj.active + " collideFlag=" + sphereObj.collideFlag + " colIdx=" + sphereObj.colIdx);
io.print("shape=" + idx.shape[0] + " radius=" + idx.worldRadius[0] + " bodyId=" + idx.bodyId[0]);
io.print("trs.wx=" + idx.trs[0].wx + " wy=" + idx.trs[0].wy + " wz=" + idx.trs[0].wz);

const hitSphere = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 50.0);
io.print("hitSphere: " + (hitSphere !== null ? JSON.stringify(hitSphere) : "null"));
