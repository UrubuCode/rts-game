// Visual preview only: simulated progress; actual demos use measured task progress.
import { openWindow,pump,isOpen,beginFrame,endFrame,close } from "rts:egui";
import input from "@compat/input.ts";
import { LoadingScreen } from "@engine/render/loading_screen";
const win=openWindow("RTS | Loading preview",1280,800,0);
const screen=new LoadingScreen();const start=performance.now();
while(pump(win)&&isOpen(win)&&performance.now()-start<90000){
  beginFrame(win);if(input.key(win,2,0)){endFrame(win);break;}
  screen.draw(win,"PRÉVIA VISUAL • Esc para fechar",((performance.now()-start)%12000)/12000);endFrame(win);
}
close(win);
