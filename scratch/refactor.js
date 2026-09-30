const fs = require('fs');
const path = require('path');

const original = fs.readFileSync('src/engine/core/spatial_queries.ts', 'utf8');

// We will construct the new spatial_queries.ts with:
// 1. Header, imports, RaycastHit, OverlapHit, SpatialFilter, factories, cellHash, insertHitSorted, recordOverlapHit
// 2. Global scalar scratch registers: sActiveScene, sCandCx, sCandCy, sCandCz, sCandYaw, sHullContactOut
// 3. quickselect, mfloor, getSpatialStepId
// 4. export class SpatialIndex with fields, constructor, capacity/entry helpers, clear, rebuild, ensureIndex, raycastNonAlloc, overlapSphereNonAlloc, overlapBoxNonAlloc
// 5. getSpatialIndex, setSpatialScene, getSpatialScene, spatialRebuildIndex, spatialGridRebuildCost
// 6. rebuildDynamicsInto (free typed function)
// 7. raycastObject, raycastStaticGridDDA, raycastDynamicsDDA
// 8. raycast (allocating)
// 9. overlapSphereObject, testOverlapSphereObject, cloneOverlapHit, copyOverlapHit, ensureAllocHitsCapacity, overlapSphereInto, overlapSphereDynamicsInto
// 10. overlapSphere (allocating)
// 11. overlapBoxObject, testOverlapBoxObject, overlapBoxInto, overlapBoxDynamicsInto
// 12. overlapBox (allocating)

console.log('Original length:', original.length);
