import io from "@compat/io.ts";

class SceneHolder {
  spatialIndex: any = null;
  objects: any[] = [];
}

class SpatialIndexHolder {
  scene: SceneHolder;
  dynHead: number[];
  objs: any[];
  constructor(sc: SceneHolder) {
    this.scene = sc;
    this.dynHead = new Array(2048).fill(-1);
    this.objs = sc.objects;
  }
}

let i = 0;
while (i < 20) {
  const sc = new SceneHolder();
  let j = 0;
  while (j < 2000) {
    sc.objects.push({ id: j });
    j = j + 1;
  }
  const idx = new SpatialIndexHolder(sc);
  sc.spatialIndex = idx;
  i = i + 1;
}

io.print("Done 20 scenes with cyclic SpatialIndexHolder!");
