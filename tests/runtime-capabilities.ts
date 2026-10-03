import * as ui from "rts:egui";
const required=["drawWaterSurface","drawWater","meshUpload","meshFree","captureScene","setSky","setExposure"];
for(let i=0;i<required.length;i++)if(typeof (ui as any)[required[i]]!=="function")throw new Error("Runtime incompativel: falta rts:egui."+required[i]);
println("PASS runtime capabilities: agua, malhas, captura e HDR");
