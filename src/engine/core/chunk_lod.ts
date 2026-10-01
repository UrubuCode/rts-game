/** Hysteresis prevents toggling detail on every frame near a distance boundary. */
export function fpsChunkLod(previous:number,distance:number):number {
  return previous===0?(distance>190?1:0):(distance<155?0:1);
}
