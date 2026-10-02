// GERADO por tools/generate-components.mjs. Edite as classes .ts, nao este arquivo.
import { Behavior } from "../core/behavior";
import { ComponentReflection, componentMetadata } from "../core/component_metadata";
import { AnimationPlayer as Component0 } from "../core/animation_player";
import { Animator as Component1 } from "../core/animator";
import { KeyframeAnimator as Component2 } from "../../scripts/keyframeanimator";
import { CameraOrbita as Component3 } from "../../../assets/pacotes/camera/camera_orbita";
import { CameraPrimeiraPessoa as Component4 } from "../../../assets/pacotes/camera/camera_primeira_pessoa";
import { CameraRTS as Component5 } from "../../../assets/pacotes/camera/camera_rts";
import { CameraSeguir as Component6 } from "../../../assets/pacotes/camera/camera_seguir";
import { AutomaticDoor as Component7 } from "../../../assets/scripts/AutomaticDoor";
import { VitrineContador as Component8 } from "../../../assets/scripts/VitrineContador";
import { VitrineHud as Component9 } from "../../../assets/scripts/VitrineHud";
import { ParticleSystem as Component10 } from "../../scripts/particlesystem";
import { Buoyancy as Component11 } from "../core/buoyancy";
import { Collider as Component12 } from "../core/collider";
import { PhysicsMaterial as Component13 } from "../../scripts/physicsmaterial";
import { Rigidbody as Component14 } from "../../scripts/rigidbody";
import { RouteAgent as Component15 } from "../core/route_agent";
import { RoutePath as Component16 } from "../core/route_path";
import { ProceduralWorld as Component17 } from "../core/procedural_world";
import { Terrain as Component18 } from "../core/terrain";
import { NetworkManager as Component19 } from "../core/network_manager";
import { NetworkObject as Component20 } from "../core/network_object";
import { NetworkTransform as Component21 } from "../core/network_transform";
import { Camera as Component22 } from "../core/camera";
import { CicloDoDia as Component23 } from "../../../assets/pacotes/ambiente/ciclo_do_dia";
import { Light as Component24 } from "../core/light";
import { Material as Component25 } from "../core/material";
import { MeshRenderer as Component26 } from "../core/meshrenderer";
import { Skeleton as Component27 } from "../core/skeleton";
import { WaterSurface as Component28 } from "../core/water_surface";
import { Bobber as Component29 } from "../../scripts/bobber";
import { MotionSettings as Component30 } from "../../../assets/scripts/MotionSettings";
import { Mover as Component31 } from "../../scripts/mover";
import { Orbit as Component32 } from "../../scripts/orbit";
import { Patrol as Component33 } from "../../scripts/patrol";
import { Pulse as Component34 } from "../../scripts/pulse";
import { Spinner as Component35 } from "../../scripts/spinner";
import { Vagar as Component36 } from "../../scripts/vagar";
import { UIButton as Component37 } from "../core/ui_button";
import { UIText as Component38 } from "../core/ui_text";
import { AudioListener as Component39 } from "../core/audio_listener";
import { AudioSource as Component40 } from "../../scripts/audiosource";
class GeneratedReflection extends ComponentReflection {
  create(name: string): any { return createRegisteredComponent(name); }
  name(component: any): string {
    if (component instanceof Component21) {
      return "NetworkTransform";
    }
    if (component instanceof Component0) {
      return "AnimationPlayer";
    }
    if (component instanceof Component1) {
      return "Animator";
    }
    if (component instanceof Component2) {
      return "KeyframeAnimator";
    }
    if (component instanceof Component3) {
      return "CameraOrbita";
    }
    if (component instanceof Component4) {
      return "CameraPrimeiraPessoa";
    }
    if (component instanceof Component5) {
      return "CameraRTS";
    }
    if (component instanceof Component6) {
      return "CameraSeguir";
    }
    if (component instanceof Component7) {
      return "AutomaticDoor";
    }
    if (component instanceof Component8) {
      return "VitrineContador";
    }
    if (component instanceof Component9) {
      return "VitrineHud";
    }
    if (component instanceof Component10) {
      return "ParticleSystem";
    }
    if (component instanceof Component11) {
      return "Buoyancy";
    }
    if (component instanceof Component12) {
      return "Collider";
    }
    if (component instanceof Component13) {
      return "PhysicsMaterial";
    }
    if (component instanceof Component14) {
      return "Rigidbody";
    }
    if (component instanceof Component15) {
      return "RouteAgent";
    }
    if (component instanceof Component16) {
      return "RoutePath";
    }
    if (component instanceof Component17) {
      return "ProceduralWorld";
    }
    if (component instanceof Component18) {
      return "Terrain";
    }
    if (component instanceof Component19) {
      return "NetworkManager";
    }
    if (component instanceof Component20) {
      return "NetworkObject";
    }
    if (component instanceof Component22) {
      return "Camera";
    }
    if (component instanceof Component23) {
      return "CicloDoDia";
    }
    if (component instanceof Component24) {
      return "Light";
    }
    if (component instanceof Component25) {
      return "Material";
    }
    if (component instanceof Component26) {
      return "MeshRenderer";
    }
    if (component instanceof Component27) {
      return "Skeleton";
    }
    if (component instanceof Component28) {
      return "WaterSurface";
    }
    if (component instanceof Component29) {
      return "Bobber";
    }
    if (component instanceof Component30) {
      return "MotionSettings";
    }
    if (component instanceof Component31) {
      return "Mover";
    }
    if (component instanceof Component32) {
      return "Orbit";
    }
    if (component instanceof Component33) {
      return "Patrol";
    }
    if (component instanceof Component34) {
      return "Pulse";
    }
    if (component instanceof Component35) {
      return "Spinner";
    }
    if (component instanceof Component36) {
      return "Vagar";
    }
    if (component instanceof Component37) {
      return "UIButton";
    }
    if (component instanceof Component38) {
      return "UIText";
    }
    if (component instanceof Component39) {
      return "AudioListener";
    }
    if (component instanceof Component40) {
      return "AudioSource";
    }
    return "Script";
  }
  fieldCount(component: any): number {
    if (component instanceof Component21) {
      return 0;
    }
    if (component instanceof Component0) {
      return 4;
    }
    if (component instanceof Component1) {
      return 1;
    }
    if (component instanceof Component2) {
      return 0;
    }
    if (component instanceof Component3) {
      return 4;
    }
    if (component instanceof Component4) {
      return 3;
    }
    if (component instanceof Component5) {
      return 6;
    }
    if (component instanceof Component6) {
      return 6;
    }
    if (component instanceof Component7) {
      return 2;
    }
    if (component instanceof Component8) {
      return 1;
    }
    if (component instanceof Component9) {
      return 2;
    }
    if (component instanceof Component10) {
      return 31;
    }
    if (component instanceof Component11) {
      return 4;
    }
    if (component instanceof Component12) {
      return 0;
    }
    if (component instanceof Component13) {
      return 0;
    }
    if (component instanceof Component14) {
      return 0;
    }
    if (component instanceof Component15) {
      return 4;
    }
    if (component instanceof Component16) {
      return 0;
    }
    if (component instanceof Component17) {
      return 17;
    }
    if (component instanceof Component18) {
      return 0;
    }
    if (component instanceof Component19) {
      return 6;
    }
    if (component instanceof Component20) {
      return 1;
    }
    if (component instanceof Component22) {
      return 13;
    }
    if (component instanceof Component23) {
      return 3;
    }
    if (component instanceof Component24) {
      return 6;
    }
    if (component instanceof Component25) {
      return 0;
    }
    if (component instanceof Component26) {
      return 0;
    }
    if (component instanceof Component27) {
      return 1;
    }
    if (component instanceof Component28) {
      return 16;
    }
    if (component instanceof Component29) {
      return 3;
    }
    if (component instanceof Component30) {
      return 3;
    }
    if (component instanceof Component31) {
      return 3;
    }
    if (component instanceof Component32) {
      return 4;
    }
    if (component instanceof Component33) {
      return 2;
    }
    if (component instanceof Component34) {
      return 3;
    }
    if (component instanceof Component35) {
      return 2;
    }
    if (component instanceof Component36) {
      return 2;
    }
    if (component instanceof Component37) {
      return 0;
    }
    if (component instanceof Component38) {
      return 0;
    }
    if (component instanceof Component39) {
      return 0;
    }
    if (component instanceof Component40) {
      return 16;
    }
    return 0;
  }
  fieldLabel(component: any, index: number): string {
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component0) {
      if (index === 0) return "Clip";
      if (index === 1) return "Loop";
      if (index === 2) return "Speed";
      if (index === 3) return "Playing";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "Controller";
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "Alvo";
      if (index === 1) return "Distancia";
      if (index === 2) return "Sensibilidade";
      if (index === 3) return "Passo Zoom";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "Velocidade";
      if (index === 1) return "Sensibilidade";
      if (index === 2) return "Exigir Botao Direito";
      return "";
    }
    if (component instanceof Component5) {
      if (index === 0) return "Velocidade";
      if (index === 1) return "Zoom Min";
      if (index === 2) return "Zoom Max";
      if (index === 3) return "Zoom";
      if (index === 4) return "Passo Zoom";
      if (index === 5) return "Inclinacao";
      return "";
    }
    if (component instanceof Component6) {
      if (index === 0) return "Alvo";
      if (index === 1) return "Desloc X";
      if (index === 2) return "Desloc Y";
      if (index === 3) return "Desloc Z";
      if (index === 4) return "Suavizacao";
      if (index === 5) return "Olhar Alvo";
      return "";
    }
    if (component instanceof Component7) {
      if (index === 0) return "Open Offset Y";
      if (index === 1) return "Open Seconds";
      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "Contatos";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "Titulo";
      if (index === 1) return "Alvo";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "Duration";
      if (index === 1) return "Loop";
      if (index === 2) return "Play On Awake";
      if (index === 3) return "Prewarm";
      if (index === 4) return "Max Particles";
      if (index === 5) return "Gravity Modifier";
      if (index === 6) return "Simulation Space";
      if (index === 7) return "Rate Over Time";
      if (index === 8) return "Start Lifetime Min";
      if (index === 9) return "Start Lifetime Max";
      if (index === 10) return "Start Speed Min";
      if (index === 11) return "Start Speed Max";
      if (index === 12) return "Start Size Min";
      if (index === 13) return "Start Size Max";
      if (index === 14) return "Start Rotation";
      if (index === 15) return "Start Color R";
      if (index === 16) return "Start Color G";
      if (index === 17) return "Start Color B";
      if (index === 18) return "Forma";
      if (index === 19) return "Raio";
      if (index === 20) return "Angulo Cone";
      if (index === 21) return "Caixa X";
      if (index === 22) return "Caixa Y";
      if (index === 23) return "Caixa Z";
      if (index === 24) return "Vento X";
      if (index === 25) return "Vento Y";
      if (index === 26) return "Vento Z";
      if (index === 27) return "Arrasto";
      if (index === 28) return "Modo";
      if (index === 29) return "Sort";
      if (index === 30) return "Textura";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "Water Object";
      if (index === 1) return "Fluid Density";
      if (index === 2) return "Drag";
      if (index === 3) return "Volume Scale";
      return "";
    }
    if (component instanceof Component12) {

      return "";
    }
    if (component instanceof Component13) {

      return "";
    }
    if (component instanceof Component14) {

      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "Speed";
      if (index === 1) return "Start Node";
      if (index === 2) return "Seed";
      if (index === 3) return "Turn Speed";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "Seed";
      if (index === 1) return "Generator";
      if (index === 2) return "Generator Settings";
      if (index === 3) return "Biomes";
      if (index === 4) return "Biome Scale";
      if (index === 5) return "Height Scale";
      if (index === 6) return "Caves";
      if (index === 7) return "Chunk Radius";
      if (index === 8) return "Memory Mi B";
      if (index === 9) return "Tree Density";
      if (index === 10) return "Grass Density";
      if (index === 11) return "Water Enabled";
      if (index === 12) return "Max Slope";
      if (index === 13) return "Brush X";
      if (index === 14) return "Brush Z";
      if (index === 15) return "Brush Radius";
      if (index === 16) return "Brush Strength";
      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "Mode";
      if (index === 1) return "Address";
      if (index === 2) return "Port";
      if (index === 3) return "Max Players";
      if (index === 4) return "Tick Rate";
      if (index === 5) return "Auto Start";
      return "";
    }
    if (component instanceof Component20) {
      if (index === 0) return "Prefab Id";
      return "";
    }
    if (component instanceof Component22) {
      if (index === 0) return "FOV";
      if (index === 1) return "Main";
      if (index === 2) return "Near";
      if (index === 3) return "Far";
      if (index === 4) return "Ortografica";
      if (index === 5) return "Tamanho orto";
      if (index === 6) return "Fundo";
      if (index === 7) return "Cor do fundo";
      if (index === 8) return "Viewport X";
      if (index === 9) return "Viewport Y";
      if (index === 10) return "Viewport W";
      if (index === 11) return "Viewport H";
      if (index === 12) return "Profundidade";
      return "";
    }
    if (component instanceof Component23) {
      if (index === 0) return "Duracao";
      if (index === 1) return "Hora";
      if (index === 2) return "Sol";
      return "";
    }
    if (component instanceof Component24) {
      if (index === 0) return "Tipo";
      if (index === 1) return "Cor";
      if (index === 2) return "Intensidade";
      if (index === 3) return "Alcance";
      if (index === 4) return "Ângulo do spot";
      if (index === 5) return "Sombra";
      return "";
    }
    if (component instanceof Component25) {

      return "";
    }
    if (component instanceof Component26) {

      return "";
    }
    if (component instanceof Component27) {
      if (index === 0) return "Model Path";
      return "";
    }
    if (component instanceof Component28) {
      if (index === 0) return "Width";
      if (index === 1) return "Length";
      if (index === 2) return "Wave Amplitude";
      if (index === 3) return "Wavelength";
      if (index === 4) return "Wave Speed";
      if (index === 5) return "Foam Width";
      if (index === 6) return "Opacity";
      if (index === 7) return "Refraction";
      if (index === 8) return "Absorption";
      if (index === 9) return "Red";
      if (index === 10) return "Green";
      if (index === 11) return "Blue";
      if (index === 12) return "Resolution";
      if (index === 13) return "Reflection Strength";
      if (index === 14) return "Reflection Distance";
      if (index === 15) return "Reflection Steps";
      return "";
    }
    if (component instanceof Component29) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base Y";
      return "";
    }
    if (component instanceof Component30) {
      if (index === 0) return "Speed";
      if (index === 1) return "Moving";
      if (index === 2) return "Label";
      return "";
    }
    if (component instanceof Component31) {
      if (index === 0) return "Vx";
      if (index === 1) return "Vy";
      if (index === 2) return "Vz";
      return "";
    }
    if (component instanceof Component32) {
      if (index === 0) return "Radius";
      if (index === 1) return "Speed";
      if (index === 2) return "Cx";
      if (index === 3) return "Cz";
      return "";
    }
    if (component instanceof Component33) {
      if (index === 0) return "Range";
      if (index === 1) return "Speed";
      return "";
    }
    if (component instanceof Component34) {
      if (index === 0) return "Amp";
      if (index === 1) return "Freq";
      if (index === 2) return "Base";
      return "";
    }
    if (component instanceof Component35) {
      if (index === 0) return "SpdY";
      if (index === 1) return "SpdX";
      return "";
    }
    if (component instanceof Component36) {
      if (index === 0) return "Raio";
      if (index === 1) return "Velocidade";
      return "";
    }
    if (component instanceof Component37) {

      return "";
    }
    if (component instanceof Component38) {

      return "";
    }
    if (component instanceof Component39) {

      return "";
    }
    if (component instanceof Component40) {
      if (index === 0) return "Modo";
      if (index === 1) return "Clip";
      if (index === 2) return "Volume";
      if (index === 3) return "Pitch";
      if (index === 4) return "Loop";
      if (index === 5) return "Tocar ao iniciar";
      if (index === 6) return "Mudo";
      if (index === 7) return "Mistura espacial";
      if (index === 8) return "Rolloff";
      if (index === 9) return "Min Distance";
      if (index === 10) return "Max Distance";
      if (index === 11) return "Grupo";
      if (index === 12) return "Forma";
      if (index === 13) return "Freq";
      if (index === 14) return "Dur";
      if (index === 15) return "Every";
      return "";
    }
    return "";
  }
  fieldName(component: any, index: number): string {
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component0) {
      if (index === 0) return "clip";
      if (index === 1) return "loop";
      if (index === 2) return "speed";
      if (index === 3) return "playing";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "controller";
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "alvo";
      if (index === 1) return "distancia";
      if (index === 2) return "sensibilidade";
      if (index === 3) return "passoZoom";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "velocidade";
      if (index === 1) return "sensibilidade";
      if (index === 2) return "exigirBotaoDireito";
      return "";
    }
    if (component instanceof Component5) {
      if (index === 0) return "velocidade";
      if (index === 1) return "zoomMin";
      if (index === 2) return "zoomMax";
      if (index === 3) return "zoom";
      if (index === 4) return "passoZoom";
      if (index === 5) return "inclinacao";
      return "";
    }
    if (component instanceof Component6) {
      if (index === 0) return "alvo";
      if (index === 1) return "deslocX";
      if (index === 2) return "deslocY";
      if (index === 3) return "deslocZ";
      if (index === 4) return "suavizacao";
      if (index === 5) return "olharAlvo";
      return "";
    }
    if (component instanceof Component7) {
      if (index === 0) return "openOffsetY";
      if (index === 1) return "openSeconds";
      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "contatos";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "titulo";
      if (index === 1) return "alvo";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "duration";
      if (index === 1) return "loop";
      if (index === 2) return "playOnAwake";
      if (index === 3) return "prewarm";
      if (index === 4) return "maxParticles";
      if (index === 5) return "gravityModifier";
      if (index === 6) return "simulationSpace";
      if (index === 7) return "rateOverTime";
      if (index === 8) return "startLifetimeMin";
      if (index === 9) return "startLifetimeMax";
      if (index === 10) return "startSpeedMin";
      if (index === 11) return "startSpeedMax";
      if (index === 12) return "startSizeMin";
      if (index === 13) return "startSizeMax";
      if (index === 14) return "startRotation";
      if (index === 15) return "startColorR";
      if (index === 16) return "startColorG";
      if (index === 17) return "startColorB";
      if (index === 18) return "forma";
      if (index === 19) return "raio";
      if (index === 20) return "anguloCone";
      if (index === 21) return "caixaX";
      if (index === 22) return "caixaY";
      if (index === 23) return "caixaZ";
      if (index === 24) return "ventoX";
      if (index === 25) return "ventoY";
      if (index === 26) return "ventoZ";
      if (index === 27) return "arrasto";
      if (index === 28) return "modo";
      if (index === 29) return "sort";
      if (index === 30) return "textura";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "waterObject";
      if (index === 1) return "fluidDensity";
      if (index === 2) return "drag";
      if (index === 3) return "volumeScale";
      return "";
    }
    if (component instanceof Component12) {

      return "";
    }
    if (component instanceof Component13) {

      return "";
    }
    if (component instanceof Component14) {

      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "speed";
      if (index === 1) return "startNode";
      if (index === 2) return "seed";
      if (index === 3) return "turnSpeed";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "seed";
      if (index === 1) return "generator";
      if (index === 2) return "generatorSettings";
      if (index === 3) return "biomes";
      if (index === 4) return "biomeScale";
      if (index === 5) return "heightScale";
      if (index === 6) return "caves";
      if (index === 7) return "chunkRadius";
      if (index === 8) return "memoryMiB";
      if (index === 9) return "treeDensity";
      if (index === 10) return "grassDensity";
      if (index === 11) return "waterEnabled";
      if (index === 12) return "maxSlope";
      if (index === 13) return "brushX";
      if (index === 14) return "brushZ";
      if (index === 15) return "brushRadius";
      if (index === 16) return "brushStrength";
      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "mode";
      if (index === 1) return "address";
      if (index === 2) return "port";
      if (index === 3) return "maxPlayers";
      if (index === 4) return "tickRate";
      if (index === 5) return "autoStart";
      return "";
    }
    if (component instanceof Component20) {
      if (index === 0) return "prefabId";
      return "";
    }
    if (component instanceof Component22) {
      if (index === 0) return "fov";
      if (index === 1) return "isMain";
      if (index === 2) return "near";
      if (index === 3) return "far";
      if (index === 4) return "ortografica";
      if (index === 5) return "tamanhoOrto";
      if (index === 6) return "fundo";
      if (index === 7) return "corFundo";
      if (index === 8) return "viewportX";
      if (index === 9) return "viewportY";
      if (index === 10) return "viewportW";
      if (index === 11) return "viewportH";
      if (index === 12) return "profundidade";
      return "";
    }
    if (component instanceof Component23) {
      if (index === 0) return "duracao";
      if (index === 1) return "hora";
      if (index === 2) return "sol";
      return "";
    }
    if (component instanceof Component24) {
      if (index === 0) return "tipo";
      if (index === 1) return "cor";
      if (index === 2) return "intensidade";
      if (index === 3) return "alcance";
      if (index === 4) return "anguloSpot";
      if (index === 5) return "sombra";
      return "";
    }
    if (component instanceof Component25) {

      return "";
    }
    if (component instanceof Component26) {

      return "";
    }
    if (component instanceof Component27) {
      if (index === 0) return "modelPath";
      return "";
    }
    if (component instanceof Component28) {
      if (index === 0) return "width";
      if (index === 1) return "length";
      if (index === 2) return "waveAmplitude";
      if (index === 3) return "wavelength";
      if (index === 4) return "waveSpeed";
      if (index === 5) return "foamWidth";
      if (index === 6) return "opacity";
      if (index === 7) return "refraction";
      if (index === 8) return "absorption";
      if (index === 9) return "red";
      if (index === 10) return "green";
      if (index === 11) return "blue";
      if (index === 12) return "resolution";
      if (index === 13) return "reflectionStrength";
      if (index === 14) return "reflectionDistance";
      if (index === 15) return "reflectionSteps";
      return "";
    }
    if (component instanceof Component29) {
      if (index === 0) return "amp";
      if (index === 1) return "freq";
      if (index === 2) return "baseY";
      return "";
    }
    if (component instanceof Component30) {
      if (index === 0) return "speed";
      if (index === 1) return "moving";
      if (index === 2) return "label";
      return "";
    }
    if (component instanceof Component31) {
      if (index === 0) return "vx";
      if (index === 1) return "vy";
      if (index === 2) return "vz";
      return "";
    }
    if (component instanceof Component32) {
      if (index === 0) return "radius";
      if (index === 1) return "speed";
      if (index === 2) return "cx";
      if (index === 3) return "cz";
      return "";
    }
    if (component instanceof Component33) {
      if (index === 0) return "range";
      if (index === 1) return "speed";
      return "";
    }
    if (component instanceof Component34) {
      if (index === 0) return "amp";
      if (index === 1) return "freq";
      if (index === 2) return "base";
      return "";
    }
    if (component instanceof Component35) {
      if (index === 0) return "speedY";
      if (index === 1) return "speedX";
      return "";
    }
    if (component instanceof Component36) {
      if (index === 0) return "raio";
      if (index === 1) return "velocidade";
      return "";
    }
    if (component instanceof Component37) {

      return "";
    }
    if (component instanceof Component38) {

      return "";
    }
    if (component instanceof Component39) {

      return "";
    }
    if (component instanceof Component40) {
      if (index === 0) return "modo";
      if (index === 1) return "clip";
      if (index === 2) return "volume";
      if (index === 3) return "pitch";
      if (index === 4) return "loop";
      if (index === 5) return "playOnAwake";
      if (index === 6) return "mudo";
      if (index === 7) return "spatialBlend";
      if (index === 8) return "rolloff";
      if (index === 9) return "minDistance";
      if (index === 10) return "maxDistance";
      if (index === 11) return "grupo";
      if (index === 12) return "forma";
      if (index === 13) return "freq";
      if (index === 14) return "dur";
      if (index === 15) return "every";
      return "";
    }
    return "";
  }
  fieldType(component: any, index: number): string {
    if (component instanceof Component21) {

      return "number";
    }
    if (component instanceof Component0) {
      if (index === 0) return "string";
      if (index === 1) return "boolean";
      if (index === 2) return "number";
      if (index === 3) return "boolean";
      return "number";
    }
    if (component instanceof Component1) {
      if (index === 0) return "string";
      return "number";
    }
    if (component instanceof Component2) {

      return "number";
    }
    if (component instanceof Component3) {
      if (index === 0) return "string";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component4) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "boolean";
      return "number";
    }
    if (component instanceof Component5) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "number";
      return "number";
    }
    if (component instanceof Component6) {
      if (index === 0) return "string";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "boolean";
      return "number";
    }
    if (component instanceof Component7) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component8) {
      if (index === 0) return "number";
      return "number";
    }
    if (component instanceof Component9) {
      if (index === 0) return "string";
      if (index === 1) return "string";
      return "number";
    }
    if (component instanceof Component10) {
      if (index === 0) return "number";
      if (index === 1) return "boolean";
      if (index === 2) return "boolean";
      if (index === 3) return "boolean";
      if (index === 4) return "number";
      if (index === 5) return "number";
      if (index === 6) return "string";
      if (index === 7) return "number";
      if (index === 8) return "number";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "number";
      if (index === 12) return "number";
      if (index === 13) return "number";
      if (index === 14) return "number";
      if (index === 15) return "number";
      if (index === 16) return "number";
      if (index === 17) return "number";
      if (index === 18) return "number";
      if (index === 19) return "number";
      if (index === 20) return "number";
      if (index === 21) return "number";
      if (index === 22) return "number";
      if (index === 23) return "number";
      if (index === 24) return "number";
      if (index === 25) return "number";
      if (index === 26) return "number";
      if (index === 27) return "number";
      if (index === 28) return "number";
      if (index === 29) return "number";
      if (index === 30) return "number";
      return "number";
    }
    if (component instanceof Component11) {
      if (index === 0) return "string";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component12) {

      return "number";
    }
    if (component instanceof Component13) {

      return "number";
    }
    if (component instanceof Component14) {

      return "number";
    }
    if (component instanceof Component15) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component16) {

      return "number";
    }
    if (component instanceof Component17) {
      if (index === 0) return "number";
      if (index === 1) return "string";
      if (index === 2) return "string";
      if (index === 3) return "boolean";
      if (index === 4) return "number";
      if (index === 5) return "number";
      if (index === 6) return "boolean";
      if (index === 7) return "number";
      if (index === 8) return "number";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "boolean";
      if (index === 12) return "number";
      if (index === 13) return "number";
      if (index === 14) return "number";
      if (index === 15) return "number";
      if (index === 16) return "number";
      return "number";
    }
    if (component instanceof Component18) {

      return "number";
    }
    if (component instanceof Component19) {
      if (index === 0) return "string";
      if (index === 1) return "string";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "boolean";
      return "number";
    }
    if (component instanceof Component20) {
      if (index === 0) return "number";
      return "number";
    }
    if (component instanceof Component22) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "boolean";
      if (index === 5) return "number";
      if (index === 6) return "string";
      if (index === 7) return "number";
      if (index === 8) return "number";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "number";
      if (index === 12) return "number";
      return "number";
    }
    if (component instanceof Component23) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "string";
      return "number";
    }
    if (component instanceof Component24) {
      if (index === 0) return "string";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "boolean";
      return "number";
    }
    if (component instanceof Component25) {

      return "number";
    }
    if (component instanceof Component26) {

      return "number";
    }
    if (component instanceof Component27) {
      if (index === 0) return "string";
      return "number";
    }
    if (component instanceof Component28) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "number";
      if (index === 5) return "number";
      if (index === 6) return "number";
      if (index === 7) return "number";
      if (index === 8) return "number";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "number";
      if (index === 12) return "number";
      if (index === 13) return "number";
      if (index === 14) return "number";
      if (index === 15) return "number";
      return "number";
    }
    if (component instanceof Component29) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component30) {
      if (index === 0) return "number";
      if (index === 1) return "boolean";
      if (index === 2) return "string";
      return "number";
    }
    if (component instanceof Component31) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component32) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      if (index === 3) return "number";
      return "number";
    }
    if (component instanceof Component33) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component34) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      if (index === 2) return "number";
      return "number";
    }
    if (component instanceof Component35) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component36) {
      if (index === 0) return "number";
      if (index === 1) return "number";
      return "number";
    }
    if (component instanceof Component37) {

      return "number";
    }
    if (component instanceof Component38) {

      return "number";
    }
    if (component instanceof Component39) {

      return "number";
    }
    if (component instanceof Component40) {
      if (index === 0) return "string";
      if (index === 1) return "string";
      if (index === 2) return "number";
      if (index === 3) return "number";
      if (index === 4) return "boolean";
      if (index === 5) return "boolean";
      if (index === 6) return "boolean";
      if (index === 7) return "number";
      if (index === 8) return "string";
      if (index === 9) return "number";
      if (index === 10) return "number";
      if (index === 11) return "string";
      if (index === 12) return "string";
      if (index === 13) return "number";
      if (index === 14) return "number";
      if (index === 15) return "number";
      return "number";
    }
    return "number";
  }
  fieldHint(component: any, index: number): string {
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component0) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component5) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component6) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component7) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      if (index === 17) return "";
      if (index === 18) return "";
      if (index === 19) return "";
      if (index === 20) return "";
      if (index === 21) return "";
      if (index === 22) return "";
      if (index === 23) return "";
      if (index === 24) return "";
      if (index === 25) return "";
      if (index === 26) return "";
      if (index === 27) return "";
      if (index === 28) return "";
      if (index === 29) return "";
      if (index === 30) return "";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component12) {

      return "";
    }
    if (component instanceof Component13) {

      return "";
    }
    if (component instanceof Component14) {

      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component20) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component22) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      return "";
    }
    if (component instanceof Component23) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component24) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component25) {

      return "";
    }
    if (component instanceof Component26) {

      return "";
    }
    if (component instanceof Component27) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component28) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    if (component instanceof Component29) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component30) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component31) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component32) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component33) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component34) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component35) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component36) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component37) {

      return "";
    }
    if (component instanceof Component38) {

      return "";
    }
    if (component instanceof Component39) {

      return "";
    }
    if (component instanceof Component40) {
      if (index === 0) return "";
      if (index === 1) return "asset:audio";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    return "";
  }
  fieldAssetKind(component: any, index: number): string {
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component0) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component5) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component6) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component7) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      if (index === 17) return "";
      if (index === 18) return "";
      if (index === 19) return "";
      if (index === 20) return "";
      if (index === 21) return "";
      if (index === 22) return "";
      if (index === 23) return "";
      if (index === 24) return "";
      if (index === 25) return "";
      if (index === 26) return "";
      if (index === 27) return "";
      if (index === 28) return "";
      if (index === 29) return "";
      if (index === 30) return "";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component12) {

      return "";
    }
    if (component instanceof Component13) {

      return "";
    }
    if (component instanceof Component14) {

      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component20) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component22) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      return "";
    }
    if (component instanceof Component23) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component24) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component25) {

      return "";
    }
    if (component instanceof Component26) {

      return "";
    }
    if (component instanceof Component27) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component28) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    if (component instanceof Component29) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component30) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component31) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component32) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component33) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component34) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component35) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component36) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component37) {

      return "";
    }
    if (component instanceof Component38) {

      return "";
    }
    if (component instanceof Component39) {

      return "";
    }
    if (component instanceof Component40) {
      if (index === 0) return "";
      if (index === 1) return "audio";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    return "";
  }
  fieldGet(component: any, index: number): f64 {
    if (component instanceof Component21) {

      return 0;
    }
    if (component instanceof Component0) {
      if (index === 0) return 0;
      if (index === 1) return (component["loop"] ? 1 : 0);
      if (index === 2) return component["speed"];
      if (index === 3) return (component["playing"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component1) {
      if (index === 0) return 0;
      return 0;
    }
    if (component instanceof Component2) {

      return 0;
    }
    if (component instanceof Component3) {
      if (index === 0) return 0;
      if (index === 1) return component["distancia"];
      if (index === 2) return component["sensibilidade"];
      if (index === 3) return component["passoZoom"];
      return 0;
    }
    if (component instanceof Component4) {
      if (index === 0) return component["velocidade"];
      if (index === 1) return component["sensibilidade"];
      if (index === 2) return (component["exigirBotaoDireito"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component5) {
      if (index === 0) return component["velocidade"];
      if (index === 1) return component["zoomMin"];
      if (index === 2) return component["zoomMax"];
      if (index === 3) return component["zoom"];
      if (index === 4) return component["passoZoom"];
      if (index === 5) return component["inclinacao"];
      return 0;
    }
    if (component instanceof Component6) {
      if (index === 0) return 0;
      if (index === 1) return component["deslocX"];
      if (index === 2) return component["deslocY"];
      if (index === 3) return component["deslocZ"];
      if (index === 4) return component["suavizacao"];
      if (index === 5) return (component["olharAlvo"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component7) {
      if (index === 0) return component["openOffsetY"];
      if (index === 1) return component["openSeconds"];
      return 0;
    }
    if (component instanceof Component8) {
      if (index === 0) return component["contatos"];
      return 0;
    }
    if (component instanceof Component9) {
      if (index === 0) return 0;
      if (index === 1) return 0;
      return 0;
    }
    if (component instanceof Component10) {
      if (index === 0) return component["duration"];
      if (index === 1) return (component["loop"] ? 1 : 0);
      if (index === 2) return (component["playOnAwake"] ? 1 : 0);
      if (index === 3) return (component["prewarm"] ? 1 : 0);
      if (index === 4) return component["maxParticles"];
      if (index === 5) return component["gravityModifier"];
      if (index === 6) return 0;
      if (index === 7) return component["rateOverTime"];
      if (index === 8) return component["startLifetimeMin"];
      if (index === 9) return component["startLifetimeMax"];
      if (index === 10) return component["startSpeedMin"];
      if (index === 11) return component["startSpeedMax"];
      if (index === 12) return component["startSizeMin"];
      if (index === 13) return component["startSizeMax"];
      if (index === 14) return component["startRotation"];
      if (index === 15) return component["startColorR"];
      if (index === 16) return component["startColorG"];
      if (index === 17) return component["startColorB"];
      if (index === 18) return component["forma"];
      if (index === 19) return component["raio"];
      if (index === 20) return component["anguloCone"];
      if (index === 21) return component["caixaX"];
      if (index === 22) return component["caixaY"];
      if (index === 23) return component["caixaZ"];
      if (index === 24) return component["ventoX"];
      if (index === 25) return component["ventoY"];
      if (index === 26) return component["ventoZ"];
      if (index === 27) return component["arrasto"];
      if (index === 28) return component["modo"];
      if (index === 29) return component["sort"];
      if (index === 30) return component["textura"];
      return 0;
    }
    if (component instanceof Component11) {
      if (index === 0) return 0;
      if (index === 1) return component["fluidDensity"];
      if (index === 2) return component["drag"];
      if (index === 3) return component["volumeScale"];
      return 0;
    }
    if (component instanceof Component12) {

      return 0;
    }
    if (component instanceof Component13) {

      return 0;
    }
    if (component instanceof Component14) {

      return 0;
    }
    if (component instanceof Component15) {
      if (index === 0) return component["speed"];
      if (index === 1) return component["startNode"];
      if (index === 2) return component["seed"];
      if (index === 3) return component["turnSpeed"];
      return 0;
    }
    if (component instanceof Component16) {

      return 0;
    }
    if (component instanceof Component17) {
      if (index === 0) return component["seed"];
      if (index === 1) return 0;
      if (index === 2) return 0;
      if (index === 3) return (component["biomes"] ? 1 : 0);
      if (index === 4) return component["biomeScale"];
      if (index === 5) return component["heightScale"];
      if (index === 6) return (component["caves"] ? 1 : 0);
      if (index === 7) return component["chunkRadius"];
      if (index === 8) return component["memoryMiB"];
      if (index === 9) return component["treeDensity"];
      if (index === 10) return component["grassDensity"];
      if (index === 11) return (component["waterEnabled"] ? 1 : 0);
      if (index === 12) return component["maxSlope"];
      if (index === 13) return component["brushX"];
      if (index === 14) return component["brushZ"];
      if (index === 15) return component["brushRadius"];
      if (index === 16) return component["brushStrength"];
      return 0;
    }
    if (component instanceof Component18) {

      return 0;
    }
    if (component instanceof Component19) {
      if (index === 0) return 0;
      if (index === 1) return 0;
      if (index === 2) return component["port"];
      if (index === 3) return component["maxPlayers"];
      if (index === 4) return component["tickRate"];
      if (index === 5) return (component["autoStart"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component20) {
      if (index === 0) return component["prefabId"];
      return 0;
    }
    if (component instanceof Component22) {
      if (index === 0) return component["fov"];
      if (index === 1) return component["isMain"];
      if (index === 2) return component["near"];
      if (index === 3) return component["far"];
      if (index === 4) return (component["ortografica"] ? 1 : 0);
      if (index === 5) return component["tamanhoOrto"];
      if (index === 6) return 0;
      if (index === 7) return component["corFundo"];
      if (index === 8) return component["viewportX"];
      if (index === 9) return component["viewportY"];
      if (index === 10) return component["viewportW"];
      if (index === 11) return component["viewportH"];
      if (index === 12) return component["profundidade"];
      return 0;
    }
    if (component instanceof Component23) {
      if (index === 0) return component["duracao"];
      if (index === 1) return component["hora"];
      if (index === 2) return 0;
      return 0;
    }
    if (component instanceof Component24) {
      if (index === 0) return 0;
      if (index === 1) return component["cor"];
      if (index === 2) return component["intensidade"];
      if (index === 3) return component["alcance"];
      if (index === 4) return component["anguloSpot"];
      if (index === 5) return (component["sombra"] ? 1 : 0);
      return 0;
    }
    if (component instanceof Component25) {

      return 0;
    }
    if (component instanceof Component26) {

      return 0;
    }
    if (component instanceof Component27) {
      if (index === 0) return 0;
      return 0;
    }
    if (component instanceof Component28) {
      if (index === 0) return component["width"];
      if (index === 1) return component["length"];
      if (index === 2) return component["waveAmplitude"];
      if (index === 3) return component["wavelength"];
      if (index === 4) return component["waveSpeed"];
      if (index === 5) return component["foamWidth"];
      if (index === 6) return component["opacity"];
      if (index === 7) return component["refraction"];
      if (index === 8) return component["absorption"];
      if (index === 9) return component["red"];
      if (index === 10) return component["green"];
      if (index === 11) return component["blue"];
      if (index === 12) return component["resolution"];
      if (index === 13) return component["reflectionStrength"];
      if (index === 14) return component["reflectionDistance"];
      if (index === 15) return component["reflectionSteps"];
      return 0;
    }
    if (component instanceof Component29) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["baseY"];
      return 0;
    }
    if (component instanceof Component30) {
      if (index === 0) return component["speed"];
      if (index === 1) return (component["moving"] ? 1 : 0);
      if (index === 2) return 0;
      return 0;
    }
    if (component instanceof Component31) {
      if (index === 0) return component["vx"];
      if (index === 1) return component["vy"];
      if (index === 2) return component["vz"];
      return 0;
    }
    if (component instanceof Component32) {
      if (index === 0) return component["radius"];
      if (index === 1) return component["speed"];
      if (index === 2) return component["cx"];
      if (index === 3) return component["cz"];
      return 0;
    }
    if (component instanceof Component33) {
      if (index === 0) return component["range"];
      if (index === 1) return component["speed"];
      return 0;
    }
    if (component instanceof Component34) {
      if (index === 0) return component["amp"];
      if (index === 1) return component["freq"];
      if (index === 2) return component["base"];
      return 0;
    }
    if (component instanceof Component35) {
      if (index === 0) return component["speedY"];
      if (index === 1) return component["speedX"];
      return 0;
    }
    if (component instanceof Component36) {
      if (index === 0) return component["raio"];
      if (index === 1) return component["velocidade"];
      return 0;
    }
    if (component instanceof Component37) {

      return 0;
    }
    if (component instanceof Component38) {

      return 0;
    }
    if (component instanceof Component39) {

      return 0;
    }
    if (component instanceof Component40) {
      if (index === 0) return 0;
      if (index === 1) return 0;
      if (index === 2) return component["volume"];
      if (index === 3) return component["pitch"];
      if (index === 4) return (component["loop"] ? 1 : 0);
      if (index === 5) return (component["playOnAwake"] ? 1 : 0);
      if (index === 6) return (component["mudo"] ? 1 : 0);
      if (index === 7) return component["spatialBlend"];
      if (index === 8) return 0;
      if (index === 9) return component["minDistance"];
      if (index === 10) return component["maxDistance"];
      if (index === 11) return 0;
      if (index === 12) return 0;
      if (index === 13) return component["freq"];
      if (index === 14) return component["dur"];
      if (index === 15) return component["every"];
      return 0;
    }
    return 0;
  }
  fieldStringGet(component: any, index: number): string {
    if (component instanceof Component21) {

      return "";
    }
    if (component instanceof Component0) {
      if (index === 0) return component["clip"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component1) {
      if (index === 0) return component["controller"];
      return "";
    }
    if (component instanceof Component2) {

      return "";
    }
    if (component instanceof Component3) {
      if (index === 0) return component["alvo"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component4) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component5) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component6) {
      if (index === 0) return component["alvo"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component7) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component8) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component9) {
      if (index === 0) return component["titulo"];
      if (index === 1) return component["alvo"];
      return "";
    }
    if (component instanceof Component10) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return component["simulationSpace"];
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      if (index === 17) return "";
      if (index === 18) return "";
      if (index === 19) return "";
      if (index === 20) return "";
      if (index === 21) return "";
      if (index === 22) return "";
      if (index === 23) return "";
      if (index === 24) return "";
      if (index === 25) return "";
      if (index === 26) return "";
      if (index === 27) return "";
      if (index === 28) return "";
      if (index === 29) return "";
      if (index === 30) return "";
      return "";
    }
    if (component instanceof Component11) {
      if (index === 0) return component["waterObject"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component12) {

      return "";
    }
    if (component instanceof Component13) {

      return "";
    }
    if (component instanceof Component14) {

      return "";
    }
    if (component instanceof Component15) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component16) {

      return "";
    }
    if (component instanceof Component17) {
      if (index === 0) return "";
      if (index === 1) return component["generator"];
      if (index === 2) return component["generatorSettings"];
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      if (index === 16) return "";
      return "";
    }
    if (component instanceof Component18) {

      return "";
    }
    if (component instanceof Component19) {
      if (index === 0) return component["mode"];
      if (index === 1) return component["address"];
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component20) {
      if (index === 0) return "";
      return "";
    }
    if (component instanceof Component22) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return component["fundo"];
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      return "";
    }
    if (component instanceof Component23) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return component["sol"];
      return "";
    }
    if (component instanceof Component24) {
      if (index === 0) return component["tipo"];
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      return "";
    }
    if (component instanceof Component25) {

      return "";
    }
    if (component instanceof Component26) {

      return "";
    }
    if (component instanceof Component27) {
      if (index === 0) return component["modelPath"];
      return "";
    }
    if (component instanceof Component28) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return "";
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return "";
      if (index === 12) return "";
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    if (component instanceof Component29) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component30) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return component["label"];
      return "";
    }
    if (component instanceof Component31) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component32) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      if (index === 3) return "";
      return "";
    }
    if (component instanceof Component33) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component34) {
      if (index === 0) return "";
      if (index === 1) return "";
      if (index === 2) return "";
      return "";
    }
    if (component instanceof Component35) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component36) {
      if (index === 0) return "";
      if (index === 1) return "";
      return "";
    }
    if (component instanceof Component37) {

      return "";
    }
    if (component instanceof Component38) {

      return "";
    }
    if (component instanceof Component39) {

      return "";
    }
    if (component instanceof Component40) {
      if (index === 0) return component["modo"];
      if (index === 1) return component["clip"];
      if (index === 2) return "";
      if (index === 3) return "";
      if (index === 4) return "";
      if (index === 5) return "";
      if (index === 6) return "";
      if (index === 7) return "";
      if (index === 8) return component["rolloff"];
      if (index === 9) return "";
      if (index === 10) return "";
      if (index === 11) return component["grupo"];
      if (index === 12) return component["forma"];
      if (index === 13) return "";
      if (index === 14) return "";
      if (index === 15) return "";
      return "";
    }
    return "";
  }
  fieldSet(component: any, index: number, value: f64): void {
    if (component instanceof Component21) {

      return;
    }
    if (component instanceof Component0) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["loop"] = value !== 0; component.onValidate("loop"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["playing"] = value !== 0; component.onValidate("playing"); return; }
      return;
    }
    if (component instanceof Component1) {

      return;
    }
    if (component instanceof Component2) {

      return;
    }
    if (component instanceof Component3) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["distancia"] = Math.max(0.5, Math.min(1000, value)); component.onValidate("distancia"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["sensibilidade"] = value; component.onValidate("sensibilidade"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["passoZoom"] = value; component.onValidate("passoZoom"); return; }
      return;
    }
    if (component instanceof Component4) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["velocidade"] = value; component.onValidate("velocidade"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["sensibilidade"] = value; component.onValidate("sensibilidade"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["exigirBotaoDireito"] = value !== 0; component.onValidate("exigirBotaoDireito"); return; }
      return;
    }
    if (component instanceof Component5) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["velocidade"] = value; component.onValidate("velocidade"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["zoomMin"] = value; component.onValidate("zoomMin"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["zoomMax"] = value; component.onValidate("zoomMax"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["zoom"] = value; component.onValidate("zoom"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["passoZoom"] = value; component.onValidate("passoZoom"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["inclinacao"] = Math.max(10, Math.min(89, value)); component.onValidate("inclinacao"); return; }
      return;
    }
    if (component instanceof Component6) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["deslocX"] = value; component.onValidate("deslocX"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["deslocY"] = value; component.onValidate("deslocY"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["deslocZ"] = value; component.onValidate("deslocZ"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["suavizacao"] = Math.max(0.01, Math.min(10, value)); component.onValidate("suavizacao"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["olharAlvo"] = value !== 0; component.onValidate("olharAlvo"); return; }
      return;
    }
    if (component instanceof Component7) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["openOffsetY"] = value; component.onValidate("openOffsetY"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["openSeconds"] = value; component.onValidate("openSeconds"); return; }
      return;
    }
    if (component instanceof Component8) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["contatos"] = value; component.onValidate("contatos"); return; }
      return;
    }
    if (component instanceof Component9) {


      return;
    }
    if (component instanceof Component10) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["duration"] = value; component.onValidate("duration"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["loop"] = value !== 0; component.onValidate("loop"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["playOnAwake"] = value !== 0; component.onValidate("playOnAwake"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["prewarm"] = value !== 0; component.onValidate("prewarm"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["maxParticles"] = value; component.onValidate("maxParticles"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["gravityModifier"] = value; component.onValidate("gravityModifier"); return; }

      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["rateOverTime"] = value; component.onValidate("rateOverTime"); return; }
      if (index === 8) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startLifetimeMin"] = value; component.onValidate("startLifetimeMin"); return; }
      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startLifetimeMax"] = value; component.onValidate("startLifetimeMax"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startSpeedMin"] = value; component.onValidate("startSpeedMin"); return; }
      if (index === 11) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startSpeedMax"] = value; component.onValidate("startSpeedMax"); return; }
      if (index === 12) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startSizeMin"] = value; component.onValidate("startSizeMin"); return; }
      if (index === 13) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startSizeMax"] = value; component.onValidate("startSizeMax"); return; }
      if (index === 14) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startRotation"] = value; component.onValidate("startRotation"); return; }
      if (index === 15) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startColorR"] = value; component.onValidate("startColorR"); return; }
      if (index === 16) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startColorG"] = value; component.onValidate("startColorG"); return; }
      if (index === 17) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startColorB"] = value; component.onValidate("startColorB"); return; }
      if (index === 18) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["forma"] = value; component.onValidate("forma"); return; }
      if (index === 19) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["raio"] = value; component.onValidate("raio"); return; }
      if (index === 20) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["anguloCone"] = value; component.onValidate("anguloCone"); return; }
      if (index === 21) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["caixaX"] = value; component.onValidate("caixaX"); return; }
      if (index === 22) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["caixaY"] = value; component.onValidate("caixaY"); return; }
      if (index === 23) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["caixaZ"] = value; component.onValidate("caixaZ"); return; }
      if (index === 24) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["ventoX"] = value; component.onValidate("ventoX"); return; }
      if (index === 25) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["ventoY"] = value; component.onValidate("ventoY"); return; }
      if (index === 26) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["ventoZ"] = value; component.onValidate("ventoZ"); return; }
      if (index === 27) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["arrasto"] = value; component.onValidate("arrasto"); return; }
      if (index === 28) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["modo"] = value; component.onValidate("modo"); return; }
      if (index === 29) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["sort"] = value; component.onValidate("sort"); return; }
      if (index === 30) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["textura"] = value; component.onValidate("textura"); return; }
      return;
    }
    if (component instanceof Component11) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["fluidDensity"] = value; component.onValidate("fluidDensity"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["drag"] = value; component.onValidate("drag"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["volumeScale"] = value; component.onValidate("volumeScale"); return; }
      return;
    }
    if (component instanceof Component12) {

      return;
    }
    if (component instanceof Component13) {

      return;
    }
    if (component instanceof Component14) {

      return;
    }
    if (component instanceof Component15) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["startNode"] = value; component.onValidate("startNode"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["seed"] = value; component.onValidate("seed"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["turnSpeed"] = value; component.onValidate("turnSpeed"); return; }
      return;
    }
    if (component instanceof Component16) {

      return;
    }
    if (component instanceof Component17) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["seed"] = value; component.onValidate("seed"); return; }


      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["biomes"] = value !== 0; component.onValidate("biomes"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["biomeScale"] = value; component.onValidate("biomeScale"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["heightScale"] = value; component.onValidate("heightScale"); return; }
      if (index === 6) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["caves"] = value !== 0; component.onValidate("caves"); return; }
      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["chunkRadius"] = value; component.onValidate("chunkRadius"); return; }
      if (index === 8) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["memoryMiB"] = value; component.onValidate("memoryMiB"); return; }
      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["treeDensity"] = value; component.onValidate("treeDensity"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["grassDensity"] = value; component.onValidate("grassDensity"); return; }
      if (index === 11) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["waterEnabled"] = value !== 0; component.onValidate("waterEnabled"); return; }
      if (index === 12) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["maxSlope"] = value; component.onValidate("maxSlope"); return; }
      if (index === 13) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["brushX"] = value; component.onValidate("brushX"); return; }
      if (index === 14) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["brushZ"] = value; component.onValidate("brushZ"); return; }
      if (index === 15) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["brushRadius"] = value; component.onValidate("brushRadius"); return; }
      if (index === 16) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["brushStrength"] = value; component.onValidate("brushStrength"); return; }
      return;
    }
    if (component instanceof Component18) {

      return;
    }
    if (component instanceof Component19) {


      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["port"] = value; component.onValidate("port"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["maxPlayers"] = value; component.onValidate("maxPlayers"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["tickRate"] = value; component.onValidate("tickRate"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["autoStart"] = value !== 0; component.onValidate("autoStart"); return; }
      return;
    }
    if (component instanceof Component20) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["prefabId"] = value; component.onValidate("prefabId"); return; }
      return;
    }
    if (component instanceof Component22) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["fov"] = value; component.onValidate("fov"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["isMain"] = value; component.onValidate("isMain"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["near"] = value; component.onValidate("near"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["far"] = value; component.onValidate("far"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["ortografica"] = value !== 0; component.onValidate("ortografica"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["tamanhoOrto"] = value; component.onValidate("tamanhoOrto"); return; }

      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["corFundo"] = value; component.onValidate("corFundo"); return; }
      if (index === 8) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportX"] = Math.max(0, Math.min(1, value)); component.onValidate("viewportX"); return; }
      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportY"] = Math.max(0, Math.min(1, value)); component.onValidate("viewportY"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportW"] = Math.max(0.01, Math.min(1, value)); component.onValidate("viewportW"); return; }
      if (index === 11) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["viewportH"] = Math.max(0.01, Math.min(1, value)); component.onValidate("viewportH"); return; }
      if (index === 12) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["profundidade"] = value; component.onValidate("profundidade"); return; }
      return;
    }
    if (component instanceof Component23) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["duracao"] = Math.max(1, Math.min(86400, value)); component.onValidate("duracao"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["hora"] = Math.max(0, Math.min(24, value)); component.onValidate("hora"); return; }

      return;
    }
    if (component instanceof Component24) {

      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cor"] = value; component.onValidate("cor"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["intensidade"] = Math.max(0, Math.min(100, value)); component.onValidate("intensidade"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["alcance"] = Math.max(0, Math.min(10000, value)); component.onValidate("alcance"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["anguloSpot"] = Math.max(1, Math.min(179, value)); component.onValidate("anguloSpot"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["sombra"] = value !== 0; component.onValidate("sombra"); return; }
      return;
    }
    if (component instanceof Component25) {

      return;
    }
    if (component instanceof Component26) {

      return;
    }
    if (component instanceof Component27) {

      return;
    }
    if (component instanceof Component28) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["width"] = value; component.onValidate("width"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["length"] = value; component.onValidate("length"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["waveAmplitude"] = value; component.onValidate("waveAmplitude"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["wavelength"] = value; component.onValidate("wavelength"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["waveSpeed"] = value; component.onValidate("waveSpeed"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["foamWidth"] = value; component.onValidate("foamWidth"); return; }
      if (index === 6) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["opacity"] = value; component.onValidate("opacity"); return; }
      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["refraction"] = value; component.onValidate("refraction"); return; }
      if (index === 8) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["absorption"] = value; component.onValidate("absorption"); return; }
      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["red"] = value; component.onValidate("red"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["green"] = value; component.onValidate("green"); return; }
      if (index === 11) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["blue"] = value; component.onValidate("blue"); return; }
      if (index === 12) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["resolution"] = value; component.onValidate("resolution"); return; }
      if (index === 13) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["reflectionStrength"] = value; component.onValidate("reflectionStrength"); return; }
      if (index === 14) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["reflectionDistance"] = value; component.onValidate("reflectionDistance"); return; }
      if (index === 15) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["reflectionSteps"] = value; component.onValidate("reflectionSteps"); return; }
      return;
    }
    if (component instanceof Component29) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["baseY"] = value; component.onValidate("baseY"); return; }
      return;
    }
    if (component instanceof Component30) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = Math.max(0, Math.min(20, value)); component.onValidate("speed"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["moving"] = value !== 0; component.onValidate("moving"); return; }

      return;
    }
    if (component instanceof Component31) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vx"] = value; component.onValidate("vx"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vy"] = value; component.onValidate("vy"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["vz"] = value; component.onValidate("vz"); return; }
      return;
    }
    if (component instanceof Component32) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["radius"] = value; component.onValidate("radius"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cx"] = value; component.onValidate("cx"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["cz"] = value; component.onValidate("cz"); return; }
      return;
    }
    if (component instanceof Component33) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["range"] = value; component.onValidate("range"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speed"] = value; component.onValidate("speed"); return; }
      return;
    }
    if (component instanceof Component34) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["amp"] = value; component.onValidate("amp"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = value; component.onValidate("freq"); return; }
      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["base"] = value; component.onValidate("base"); return; }
      return;
    }
    if (component instanceof Component35) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedY"] = value; component.onValidate("speedY"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["speedX"] = value; component.onValidate("speedX"); return; }
      return;
    }
    if (component instanceof Component36) {
      if (index === 0) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["raio"] = value; component.onValidate("raio"); return; }
      if (index === 1) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["velocidade"] = value; component.onValidate("velocidade"); return; }
      return;
    }
    if (component instanceof Component37) {

      return;
    }
    if (component instanceof Component38) {

      return;
    }
    if (component instanceof Component39) {

      return;
    }
    if (component instanceof Component40) {


      if (index === 2) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["volume"] = Math.max(0, Math.min(1, value)); component.onValidate("volume"); return; }
      if (index === 3) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["pitch"] = Math.max(0.1, Math.min(3, value)); component.onValidate("pitch"); return; }
      if (index === 4) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["loop"] = value !== 0; component.onValidate("loop"); return; }
      if (index === 5) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["playOnAwake"] = value !== 0; component.onValidate("playOnAwake"); return; }
      if (index === 6) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["mudo"] = value !== 0; component.onValidate("mudo"); return; }
      if (index === 7) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["spatialBlend"] = Math.max(0, Math.min(1, value)); component.onValidate("spatialBlend"); return; }

      if (index === 9) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["minDistance"] = Math.max(0.01, Math.min(10000, value)); component.onValidate("minDistance"); return; }
      if (index === 10) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["maxDistance"] = Math.max(0.01, Math.min(10000, value)); component.onValidate("maxDistance"); return; }


      if (index === 13) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["freq"] = Math.max(20, Math.min(20000, value)); component.onValidate("freq"); return; }
      if (index === 14) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["dur"] = Math.max(0.01, Math.min(10, value)); component.onValidate("dur"); return; }
      if (index === 15) { if (value !== value || value <= -1e30 || value >= 1e30) return; component["every"] = value; component.onValidate("every"); return; }
      return;
    }
  }
  fieldStringSet(component: any, index: number, value: string): void {
    if (component instanceof Component21) {

      return;
    }
    if (component instanceof Component0) {
      if (index === 0) { component["clip"] = value; component.onValidate("clip"); return; }



      return;
    }
    if (component instanceof Component1) {
      if (index === 0) { component["controller"] = value; component.onValidate("controller"); return; }
      return;
    }
    if (component instanceof Component2) {

      return;
    }
    if (component instanceof Component3) {
      if (index === 0) { component["alvo"] = value; component.onValidate("alvo"); return; }



      return;
    }
    if (component instanceof Component4) {



      return;
    }
    if (component instanceof Component5) {






      return;
    }
    if (component instanceof Component6) {
      if (index === 0) { component["alvo"] = value; component.onValidate("alvo"); return; }





      return;
    }
    if (component instanceof Component7) {


      return;
    }
    if (component instanceof Component8) {

      return;
    }
    if (component instanceof Component9) {
      if (index === 0) { component["titulo"] = value; component.onValidate("titulo"); return; }
      if (index === 1) { component["alvo"] = value; component.onValidate("alvo"); return; }
      return;
    }
    if (component instanceof Component10) {






      if (index === 6) { component["simulationSpace"] = value; component.onValidate("simulationSpace"); return; }
























      return;
    }
    if (component instanceof Component11) {
      if (index === 0) { component["waterObject"] = value; component.onValidate("waterObject"); return; }



      return;
    }
    if (component instanceof Component12) {

      return;
    }
    if (component instanceof Component13) {

      return;
    }
    if (component instanceof Component14) {

      return;
    }
    if (component instanceof Component15) {




      return;
    }
    if (component instanceof Component16) {

      return;
    }
    if (component instanceof Component17) {

      if (index === 1) { component["generator"] = value; component.onValidate("generator"); return; }
      if (index === 2) { component["generatorSettings"] = value; component.onValidate("generatorSettings"); return; }














      return;
    }
    if (component instanceof Component18) {

      return;
    }
    if (component instanceof Component19) {
      if (index === 0) { component["mode"] = value; component.onValidate("mode"); return; }
      if (index === 1) { component["address"] = value; component.onValidate("address"); return; }




      return;
    }
    if (component instanceof Component20) {

      return;
    }
    if (component instanceof Component22) {






      if (index === 6) { component["fundo"] = value; component.onValidate("fundo"); return; }






      return;
    }
    if (component instanceof Component23) {


      if (index === 2) { component["sol"] = value; component.onValidate("sol"); return; }
      return;
    }
    if (component instanceof Component24) {
      if (index === 0) { component["tipo"] = value; component.onValidate("tipo"); return; }





      return;
    }
    if (component instanceof Component25) {

      return;
    }
    if (component instanceof Component26) {

      return;
    }
    if (component instanceof Component27) {
      if (index === 0) { component["modelPath"] = value; component.onValidate("modelPath"); return; }
      return;
    }
    if (component instanceof Component28) {
















      return;
    }
    if (component instanceof Component29) {



      return;
    }
    if (component instanceof Component30) {


      if (index === 2) { component["label"] = value; component.onValidate("label"); return; }
      return;
    }
    if (component instanceof Component31) {



      return;
    }
    if (component instanceof Component32) {




      return;
    }
    if (component instanceof Component33) {


      return;
    }
    if (component instanceof Component34) {



      return;
    }
    if (component instanceof Component35) {


      return;
    }
    if (component instanceof Component36) {


      return;
    }
    if (component instanceof Component37) {

      return;
    }
    if (component instanceof Component38) {

      return;
    }
    if (component instanceof Component39) {

      return;
    }
    if (component instanceof Component40) {
      if (index === 0) { component["modo"] = value; component.onValidate("modo"); return; }
      if (index === 1) { component["clip"] = value; component.onValidate("clip"); return; }






      if (index === 8) { component["rolloff"] = value; component.onValidate("rolloff"); return; }


      if (index === 11) { component["grupo"] = value; component.onValidate("grupo"); return; }
      if (index === 12) { component["forma"] = value; component.onValidate("forma"); return; }



      return;
    }
  }
  serialize(component: any): any {
    if (component instanceof Component21) {
      return { type: "script:src/engine/core/network_transform.ts#NetworkTransform", fields: {  } };
    }
    if (component instanceof Component0) {
      return { type: "script:src/engine/core/animation_player.ts#AnimationPlayer", fields: { "clip": component["clip"], "loop": component["loop"], "speed": component["speed"], "playing": component["playing"] } };
    }
    if (component instanceof Component1) {
      return { type: "script:src/engine/core/animator.ts#Animator", fields: { "controller": component["controller"] } };
    }
    if (component instanceof Component2) {
      return null;
    }
    if (component instanceof Component3) {
      return { type: "script:assets/pacotes/camera/camera_orbita.ts#CameraOrbita", fields: { "alvo": component["alvo"], "distancia": component["distancia"], "sensibilidade": component["sensibilidade"], "passoZoom": component["passoZoom"] } };
    }
    if (component instanceof Component4) {
      return { type: "script:assets/pacotes/camera/camera_primeira_pessoa.ts#CameraPrimeiraPessoa", fields: { "velocidade": component["velocidade"], "sensibilidade": component["sensibilidade"], "exigirBotaoDireito": component["exigirBotaoDireito"] } };
    }
    if (component instanceof Component5) {
      return { type: "script:assets/pacotes/camera/camera_rts.ts#CameraRTS", fields: { "velocidade": component["velocidade"], "zoomMin": component["zoomMin"], "zoomMax": component["zoomMax"], "zoom": component["zoom"], "passoZoom": component["passoZoom"], "inclinacao": component["inclinacao"] } };
    }
    if (component instanceof Component6) {
      return { type: "script:assets/pacotes/camera/camera_seguir.ts#CameraSeguir", fields: { "alvo": component["alvo"], "deslocX": component["deslocX"], "deslocY": component["deslocY"], "deslocZ": component["deslocZ"], "suavizacao": component["suavizacao"], "olharAlvo": component["olharAlvo"] } };
    }
    if (component instanceof Component7) {
      return { type: "script:assets/scripts/AutomaticDoor.ts#AutomaticDoor", fields: { "openOffsetY": component["openOffsetY"], "openSeconds": component["openSeconds"] } };
    }
    if (component instanceof Component8) {
      return { type: "script:assets/scripts/VitrineContador.ts#VitrineContador", fields: { "contatos": component["contatos"] } };
    }
    if (component instanceof Component9) {
      return { type: "script:assets/scripts/VitrineHud.ts#VitrineHud", fields: { "titulo": component["titulo"], "alvo": component["alvo"] } };
    }
    if (component instanceof Component10) {
      return null;
    }
    if (component instanceof Component11) {
      return { type: "script:src/engine/core/buoyancy.ts#Buoyancy", fields: { "waterObject": component["waterObject"], "fluidDensity": component["fluidDensity"], "drag": component["drag"], "volumeScale": component["volumeScale"] } };
    }
    if (component instanceof Component12) {
      return null;
    }
    if (component instanceof Component13) {
      return null;
    }
    if (component instanceof Component14) {
      return null;
    }
    if (component instanceof Component15) {
      return { type: "script:src/engine/core/route_agent.ts#RouteAgent", fields: { "speed": component["speed"], "startNode": component["startNode"], "seed": component["seed"], "turnSpeed": component["turnSpeed"] } };
    }
    if (component instanceof Component16) {
      return null;
    }
    if (component instanceof Component17) {
      return { type: "script:src/engine/core/procedural_world.ts#ProceduralWorld", fields: { "seed": component["seed"], "generator": component["generator"], "generatorSettings": component["generatorSettings"], "biomes": component["biomes"], "biomeScale": component["biomeScale"], "heightScale": component["heightScale"], "caves": component["caves"], "chunkRadius": component["chunkRadius"], "memoryMiB": component["memoryMiB"], "treeDensity": component["treeDensity"], "grassDensity": component["grassDensity"], "waterEnabled": component["waterEnabled"], "maxSlope": component["maxSlope"], "brushX": component["brushX"], "brushZ": component["brushZ"], "brushRadius": component["brushRadius"], "brushStrength": component["brushStrength"], "vegetationMask": component["vegetationMask"] } };
    }
    if (component instanceof Component18) {
      return null;
    }
    if (component instanceof Component19) {
      return { type: "script:src/engine/core/network_manager.ts#NetworkManager", fields: { "mode": component["mode"], "address": component["address"], "port": component["port"], "maxPlayers": component["maxPlayers"], "tickRate": component["tickRate"], "autoStart": component["autoStart"] } };
    }
    if (component instanceof Component20) {
      return { type: "script:src/engine/core/network_object.ts#NetworkObject", fields: { "prefabId": component["prefabId"] } };
    }
    if (component instanceof Component22) {
      return null;
    }
    if (component instanceof Component23) {
      return { type: "script:assets/pacotes/ambiente/ciclo_do_dia.ts#CicloDoDia", fields: { "duracao": component["duracao"], "hora": component["hora"], "sol": component["sol"] } };
    }
    if (component instanceof Component24) {
      return { type: "script:src/engine/core/light.ts#Light", fields: { "tipo": component["tipo"], "cor": component["cor"], "intensidade": component["intensidade"], "alcance": component["alcance"], "anguloSpot": component["anguloSpot"], "sombra": component["sombra"] } };
    }
    if (component instanceof Component25) {
      return null;
    }
    if (component instanceof Component26) {
      return null;
    }
    if (component instanceof Component27) {
      return null;
    }
    if (component instanceof Component28) {
      return { type: "script:src/engine/core/water_surface.ts#WaterSurface", fields: { "width": component["width"], "length": component["length"], "waveAmplitude": component["waveAmplitude"], "wavelength": component["wavelength"], "waveSpeed": component["waveSpeed"], "foamWidth": component["foamWidth"], "opacity": component["opacity"], "refraction": component["refraction"], "absorption": component["absorption"], "red": component["red"], "green": component["green"], "blue": component["blue"], "resolution": component["resolution"], "reflectionStrength": component["reflectionStrength"], "reflectionDistance": component["reflectionDistance"], "reflectionSteps": component["reflectionSteps"] } };
    }
    if (component instanceof Component29) {
      return null;
    }
    if (component instanceof Component30) {
      return { type: "script:assets/scripts/MotionSettings.ts#MotionSettings", fields: { "speed": component["speed"], "moving": component["moving"], "label": component["label"] } };
    }
    if (component instanceof Component31) {
      return null;
    }
    if (component instanceof Component32) {
      return null;
    }
    if (component instanceof Component33) {
      return null;
    }
    if (component instanceof Component34) {
      return null;
    }
    if (component instanceof Component35) {
      return null;
    }
    if (component instanceof Component36) {
      return { type: "script:src/scripts/vagar.ts#Vagar", fields: { "raio": component["raio"], "velocidade": component["velocidade"] } };
    }
    if (component instanceof Component37) {
      return null;
    }
    if (component instanceof Component38) {
      return null;
    }
    if (component instanceof Component39) {
      return { type: "script:src/engine/core/audio_listener.ts#AudioListener", fields: {  } };
    }
    if (component instanceof Component40) {
      return { type: "script:src/scripts/audiosource.ts#AudioSource", fields: { "modo": component["modo"], "clip": component["clip"], "volume": component["volume"], "pitch": component["pitch"], "loop": component["loop"], "playOnAwake": component["playOnAwake"], "mudo": component["mudo"], "spatialBlend": component["spatialBlend"], "rolloff": component["rolloff"], "minDistance": component["minDistance"], "maxDistance": component["maxDistance"], "grupo": component["grupo"], "forma": component["forma"], "freq": component["freq"], "dur": component["dur"], "every": component["every"] } };
    }
    return null;
  }
  legacyFields(component: any): any {
    if (component instanceof Component21) {
      return null;
    }
    if (component instanceof Component0) {
      return null;
    }
    if (component instanceof Component1) {
      return null;
    }
    if (component instanceof Component2) {
      return null;
    }
    if (component instanceof Component3) {
      return null;
    }
    if (component instanceof Component4) {
      return null;
    }
    if (component instanceof Component5) {
      return null;
    }
    if (component instanceof Component6) {
      return null;
    }
    if (component instanceof Component7) {
      return null;
    }
    if (component instanceof Component8) {
      return null;
    }
    if (component instanceof Component9) {
      return null;
    }
    if (component instanceof Component10) {
      return { "duration": component["duration"], "loop": component["loop"], "playOnAwake": component["playOnAwake"], "prewarm": component["prewarm"], "maxParticles": component["maxParticles"], "gravityModifier": component["gravityModifier"], "simulationSpace": component["simulationSpace"], "rateOverTime": component["rateOverTime"], "startLifetimeMin": component["startLifetimeMin"], "startLifetimeMax": component["startLifetimeMax"], "startSpeedMin": component["startSpeedMin"], "startSpeedMax": component["startSpeedMax"], "startSizeMin": component["startSizeMin"], "startSizeMax": component["startSizeMax"], "startRotation": component["startRotation"], "startColorR": component["startColorR"], "startColorG": component["startColorG"], "startColorB": component["startColorB"], "forma": component["forma"], "raio": component["raio"], "anguloCone": component["anguloCone"], "caixaX": component["caixaX"], "caixaY": component["caixaY"], "caixaZ": component["caixaZ"], "ventoX": component["ventoX"], "ventoY": component["ventoY"], "ventoZ": component["ventoZ"], "arrasto": component["arrasto"], "modo": component["modo"], "sort": component["sort"], "textura": component["textura"] };
    }
    if (component instanceof Component11) {
      return null;
    }
    if (component instanceof Component12) {
      return null;
    }
    if (component instanceof Component13) {
      return null;
    }
    if (component instanceof Component14) {
      return null;
    }
    if (component instanceof Component15) {
      return null;
    }
    if (component instanceof Component16) {
      return null;
    }
    if (component instanceof Component17) {
      return null;
    }
    if (component instanceof Component18) {
      return null;
    }
    if (component instanceof Component19) {
      return null;
    }
    if (component instanceof Component20) {
      return null;
    }
    if (component instanceof Component22) {
      return { "fov": component["fov"], "isMain": component["isMain"], "near": component["near"], "far": component["far"], "ortografica": component["ortografica"], "tamanhoOrto": component["tamanhoOrto"], "fundo": component["fundo"], "corFundo": component["corFundo"], "viewportX": component["viewportX"], "viewportY": component["viewportY"], "viewportW": component["viewportW"], "viewportH": component["viewportH"], "profundidade": component["profundidade"] };
    }
    if (component instanceof Component23) {
      return null;
    }
    if (component instanceof Component24) {
      return null;
    }
    if (component instanceof Component25) {
      return null;
    }
    if (component instanceof Component26) {
      return null;
    }
    if (component instanceof Component27) {
      return { "modelPath": component["modelPath"] };
    }
    if (component instanceof Component28) {
      return null;
    }
    if (component instanceof Component29) {
      return { "amp": component["amp"], "freq": component["freq"], "baseY": component["baseY"] };
    }
    if (component instanceof Component30) {
      return null;
    }
    if (component instanceof Component31) {
      return { "vx": component["vx"], "vy": component["vy"], "vz": component["vz"] };
    }
    if (component instanceof Component32) {
      return { "radius": component["radius"], "speed": component["speed"], "cx": component["cx"], "cz": component["cz"] };
    }
    if (component instanceof Component33) {
      return { "range": component["range"], "speed": component["speed"] };
    }
    if (component instanceof Component34) {
      return { "amp": component["amp"], "freq": component["freq"], "base": component["base"] };
    }
    if (component instanceof Component35) {
      return { "speedY": component["speedY"], "speedX": component["speedX"] };
    }
    if (component instanceof Component36) {
      return null;
    }
    if (component instanceof Component37) {
      return null;
    }
    if (component instanceof Component38) {
      return null;
    }
    if (component instanceof Component39) {
      return null;
    }
    if (component instanceof Component40) {
      return null;
    }
    return null;
  }
  restoreLegacyFields(component: any, fields: any): void {
    if (component instanceof Component21) {
      return;
    }
    if (component instanceof Component0) {
      return;
    }
    if (component instanceof Component1) {
      return;
    }
    if (component instanceof Component2) {
      return;
    }
    if (component instanceof Component3) {
      return;
    }
    if (component instanceof Component4) {
      return;
    }
    if (component instanceof Component5) {
      return;
    }
    if (component instanceof Component6) {
      return;
    }
    if (component instanceof Component7) {
      return;
    }
    if (component instanceof Component8) {
      return;
    }
    if (component instanceof Component9) {
      return;
    }
    if (component instanceof Component10) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["duration"] === "number" && fields["duration"] === fields["duration"] && fields["duration"] > -1e30 && fields["duration"] < 1e30) component["duration"] = fields["duration"];
      if (typeof fields["loop"] === "boolean" && true) component["loop"] = fields["loop"];
      if (typeof fields["playOnAwake"] === "boolean" && true) component["playOnAwake"] = fields["playOnAwake"];
      if (typeof fields["prewarm"] === "boolean" && true) component["prewarm"] = fields["prewarm"];
      if (typeof fields["maxParticles"] === "number" && fields["maxParticles"] === fields["maxParticles"] && fields["maxParticles"] > -1e30 && fields["maxParticles"] < 1e30) component["maxParticles"] = fields["maxParticles"];
      if (typeof fields["gravityModifier"] === "number" && fields["gravityModifier"] === fields["gravityModifier"] && fields["gravityModifier"] > -1e30 && fields["gravityModifier"] < 1e30) component["gravityModifier"] = fields["gravityModifier"];
      if (typeof fields["simulationSpace"] === "string" && true) component["simulationSpace"] = fields["simulationSpace"];
      if (typeof fields["rateOverTime"] === "number" && fields["rateOverTime"] === fields["rateOverTime"] && fields["rateOverTime"] > -1e30 && fields["rateOverTime"] < 1e30) component["rateOverTime"] = fields["rateOverTime"];
      if (typeof fields["startLifetimeMin"] === "number" && fields["startLifetimeMin"] === fields["startLifetimeMin"] && fields["startLifetimeMin"] > -1e30 && fields["startLifetimeMin"] < 1e30) component["startLifetimeMin"] = fields["startLifetimeMin"];
      if (typeof fields["startLifetimeMax"] === "number" && fields["startLifetimeMax"] === fields["startLifetimeMax"] && fields["startLifetimeMax"] > -1e30 && fields["startLifetimeMax"] < 1e30) component["startLifetimeMax"] = fields["startLifetimeMax"];
      if (typeof fields["startSpeedMin"] === "number" && fields["startSpeedMin"] === fields["startSpeedMin"] && fields["startSpeedMin"] > -1e30 && fields["startSpeedMin"] < 1e30) component["startSpeedMin"] = fields["startSpeedMin"];
      if (typeof fields["startSpeedMax"] === "number" && fields["startSpeedMax"] === fields["startSpeedMax"] && fields["startSpeedMax"] > -1e30 && fields["startSpeedMax"] < 1e30) component["startSpeedMax"] = fields["startSpeedMax"];
      if (typeof fields["startSizeMin"] === "number" && fields["startSizeMin"] === fields["startSizeMin"] && fields["startSizeMin"] > -1e30 && fields["startSizeMin"] < 1e30) component["startSizeMin"] = fields["startSizeMin"];
      if (typeof fields["startSizeMax"] === "number" && fields["startSizeMax"] === fields["startSizeMax"] && fields["startSizeMax"] > -1e30 && fields["startSizeMax"] < 1e30) component["startSizeMax"] = fields["startSizeMax"];
      if (typeof fields["startRotation"] === "number" && fields["startRotation"] === fields["startRotation"] && fields["startRotation"] > -1e30 && fields["startRotation"] < 1e30) component["startRotation"] = fields["startRotation"];
      if (typeof fields["startColorR"] === "number" && fields["startColorR"] === fields["startColorR"] && fields["startColorR"] > -1e30 && fields["startColorR"] < 1e30) component["startColorR"] = fields["startColorR"];
      if (typeof fields["startColorG"] === "number" && fields["startColorG"] === fields["startColorG"] && fields["startColorG"] > -1e30 && fields["startColorG"] < 1e30) component["startColorG"] = fields["startColorG"];
      if (typeof fields["startColorB"] === "number" && fields["startColorB"] === fields["startColorB"] && fields["startColorB"] > -1e30 && fields["startColorB"] < 1e30) component["startColorB"] = fields["startColorB"];
      if (typeof fields["forma"] === "number" && fields["forma"] === fields["forma"] && fields["forma"] > -1e30 && fields["forma"] < 1e30) component["forma"] = fields["forma"];
      if (typeof fields["raio"] === "number" && fields["raio"] === fields["raio"] && fields["raio"] > -1e30 && fields["raio"] < 1e30) component["raio"] = fields["raio"];
      if (typeof fields["anguloCone"] === "number" && fields["anguloCone"] === fields["anguloCone"] && fields["anguloCone"] > -1e30 && fields["anguloCone"] < 1e30) component["anguloCone"] = fields["anguloCone"];
      if (typeof fields["caixaX"] === "number" && fields["caixaX"] === fields["caixaX"] && fields["caixaX"] > -1e30 && fields["caixaX"] < 1e30) component["caixaX"] = fields["caixaX"];
      if (typeof fields["caixaY"] === "number" && fields["caixaY"] === fields["caixaY"] && fields["caixaY"] > -1e30 && fields["caixaY"] < 1e30) component["caixaY"] = fields["caixaY"];
      if (typeof fields["caixaZ"] === "number" && fields["caixaZ"] === fields["caixaZ"] && fields["caixaZ"] > -1e30 && fields["caixaZ"] < 1e30) component["caixaZ"] = fields["caixaZ"];
      if (typeof fields["ventoX"] === "number" && fields["ventoX"] === fields["ventoX"] && fields["ventoX"] > -1e30 && fields["ventoX"] < 1e30) component["ventoX"] = fields["ventoX"];
      if (typeof fields["ventoY"] === "number" && fields["ventoY"] === fields["ventoY"] && fields["ventoY"] > -1e30 && fields["ventoY"] < 1e30) component["ventoY"] = fields["ventoY"];
      if (typeof fields["ventoZ"] === "number" && fields["ventoZ"] === fields["ventoZ"] && fields["ventoZ"] > -1e30 && fields["ventoZ"] < 1e30) component["ventoZ"] = fields["ventoZ"];
      if (typeof fields["arrasto"] === "number" && fields["arrasto"] === fields["arrasto"] && fields["arrasto"] > -1e30 && fields["arrasto"] < 1e30) component["arrasto"] = fields["arrasto"];
      if (typeof fields["modo"] === "number" && fields["modo"] === fields["modo"] && fields["modo"] > -1e30 && fields["modo"] < 1e30) component["modo"] = fields["modo"];
      if (typeof fields["sort"] === "number" && fields["sort"] === fields["sort"] && fields["sort"] > -1e30 && fields["sort"] < 1e30) component["sort"] = fields["sort"];
      if (typeof fields["textura"] === "number" && fields["textura"] === fields["textura"] && fields["textura"] > -1e30 && fields["textura"] < 1e30) component["textura"] = fields["textura"];
      return;
    }
    if (component instanceof Component11) {
      return;
    }
    if (component instanceof Component12) {
      return;
    }
    if (component instanceof Component13) {
      return;
    }
    if (component instanceof Component14) {
      return;
    }
    if (component instanceof Component15) {
      return;
    }
    if (component instanceof Component16) {
      return;
    }
    if (component instanceof Component17) {
      return;
    }
    if (component instanceof Component18) {
      return;
    }
    if (component instanceof Component19) {
      return;
    }
    if (component instanceof Component20) {
      return;
    }
    if (component instanceof Component22) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["fov"] === "number" && fields["fov"] === fields["fov"] && fields["fov"] > -1e30 && fields["fov"] < 1e30) component["fov"] = fields["fov"];
      if (typeof fields["isMain"] === "number" && fields["isMain"] === fields["isMain"] && fields["isMain"] > -1e30 && fields["isMain"] < 1e30) component["isMain"] = fields["isMain"];
      if (typeof fields["near"] === "number" && fields["near"] === fields["near"] && fields["near"] > -1e30 && fields["near"] < 1e30) component["near"] = fields["near"];
      if (typeof fields["far"] === "number" && fields["far"] === fields["far"] && fields["far"] > -1e30 && fields["far"] < 1e30) component["far"] = fields["far"];
      if (typeof fields["ortografica"] === "boolean" && true) component["ortografica"] = fields["ortografica"];
      if (typeof fields["tamanhoOrto"] === "number" && fields["tamanhoOrto"] === fields["tamanhoOrto"] && fields["tamanhoOrto"] > -1e30 && fields["tamanhoOrto"] < 1e30) component["tamanhoOrto"] = fields["tamanhoOrto"];
      if (typeof fields["fundo"] === "string" && true) component["fundo"] = fields["fundo"];
      if (typeof fields["corFundo"] === "number" && fields["corFundo"] === fields["corFundo"] && fields["corFundo"] > -1e30 && fields["corFundo"] < 1e30) component["corFundo"] = fields["corFundo"];
      if (typeof fields["viewportX"] === "number" && fields["viewportX"] === fields["viewportX"] && fields["viewportX"] > -1e30 && fields["viewportX"] < 1e30) component["viewportX"] = Math.max(0, Math.min(1, fields["viewportX"]));
      if (typeof fields["viewportY"] === "number" && fields["viewportY"] === fields["viewportY"] && fields["viewportY"] > -1e30 && fields["viewportY"] < 1e30) component["viewportY"] = Math.max(0, Math.min(1, fields["viewportY"]));
      if (typeof fields["viewportW"] === "number" && fields["viewportW"] === fields["viewportW"] && fields["viewportW"] > -1e30 && fields["viewportW"] < 1e30) component["viewportW"] = Math.max(0.01, Math.min(1, fields["viewportW"]));
      if (typeof fields["viewportH"] === "number" && fields["viewportH"] === fields["viewportH"] && fields["viewportH"] > -1e30 && fields["viewportH"] < 1e30) component["viewportH"] = Math.max(0.01, Math.min(1, fields["viewportH"]));
      if (typeof fields["profundidade"] === "number" && fields["profundidade"] === fields["profundidade"] && fields["profundidade"] > -1e30 && fields["profundidade"] < 1e30) component["profundidade"] = fields["profundidade"];
      return;
    }
    if (component instanceof Component23) {
      return;
    }
    if (component instanceof Component24) {
      return;
    }
    if (component instanceof Component25) {
      return;
    }
    if (component instanceof Component26) {
      return;
    }
    if (component instanceof Component27) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["modelPath"] === "string" && true) component["modelPath"] = fields["modelPath"];
      return;
    }
    if (component instanceof Component28) {
      return;
    }
    if (component instanceof Component29) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["baseY"] === "number" && fields["baseY"] === fields["baseY"] && fields["baseY"] > -1e30 && fields["baseY"] < 1e30) component["baseY"] = fields["baseY"];
      return;
    }
    if (component instanceof Component30) {
      return;
    }
    if (component instanceof Component31) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["vx"] === "number" && fields["vx"] === fields["vx"] && fields["vx"] > -1e30 && fields["vx"] < 1e30) component["vx"] = fields["vx"];
      if (typeof fields["vy"] === "number" && fields["vy"] === fields["vy"] && fields["vy"] > -1e30 && fields["vy"] < 1e30) component["vy"] = fields["vy"];
      if (typeof fields["vz"] === "number" && fields["vz"] === fields["vz"] && fields["vz"] > -1e30 && fields["vz"] < 1e30) component["vz"] = fields["vz"];
      return;
    }
    if (component instanceof Component32) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["radius"] === "number" && fields["radius"] === fields["radius"] && fields["radius"] > -1e30 && fields["radius"] < 1e30) component["radius"] = fields["radius"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      if (typeof fields["cx"] === "number" && fields["cx"] === fields["cx"] && fields["cx"] > -1e30 && fields["cx"] < 1e30) component["cx"] = fields["cx"];
      if (typeof fields["cz"] === "number" && fields["cz"] === fields["cz"] && fields["cz"] > -1e30 && fields["cz"] < 1e30) component["cz"] = fields["cz"];
      return;
    }
    if (component instanceof Component33) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["range"] === "number" && fields["range"] === fields["range"] && fields["range"] > -1e30 && fields["range"] < 1e30) component["range"] = fields["range"];
      if (typeof fields["speed"] === "number" && fields["speed"] === fields["speed"] && fields["speed"] > -1e30 && fields["speed"] < 1e30) component["speed"] = fields["speed"];
      return;
    }
    if (component instanceof Component34) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["amp"] === "number" && fields["amp"] === fields["amp"] && fields["amp"] > -1e30 && fields["amp"] < 1e30) component["amp"] = fields["amp"];
      if (typeof fields["freq"] === "number" && fields["freq"] === fields["freq"] && fields["freq"] > -1e30 && fields["freq"] < 1e30) component["freq"] = fields["freq"];
      if (typeof fields["base"] === "number" && fields["base"] === fields["base"] && fields["base"] > -1e30 && fields["base"] < 1e30) component["base"] = fields["base"];
      return;
    }
    if (component instanceof Component35) {
      if (fields === null || fields === undefined) return;
      if (typeof fields["speedY"] === "number" && fields["speedY"] === fields["speedY"] && fields["speedY"] > -1e30 && fields["speedY"] < 1e30) component["speedY"] = fields["speedY"];
      if (typeof fields["speedX"] === "number" && fields["speedX"] === fields["speedX"] && fields["speedX"] > -1e30 && fields["speedX"] < 1e30) component["speedX"] = fields["speedX"];
      return;
    }
    if (component instanceof Component36) {
      return;
    }
    if (component instanceof Component37) {
      return;
    }
    if (component instanceof Component38) {
      return;
    }
    if (component instanceof Component39) {
      return;
    }
    if (component instanceof Component40) {
      return;
    }
  }
  drawsGizmos(component: any): boolean {
    if (component instanceof Component21) {
      return false;
    }
    if (component instanceof Component0) {
      return false;
    }
    if (component instanceof Component1) {
      return false;
    }
    if (component instanceof Component2) {
      return false;
    }
    if (component instanceof Component3) {
      return false;
    }
    if (component instanceof Component4) {
      return false;
    }
    if (component instanceof Component5) {
      return false;
    }
    if (component instanceof Component6) {
      return false;
    }
    if (component instanceof Component7) {
      return false;
    }
    if (component instanceof Component8) {
      return false;
    }
    if (component instanceof Component9) {
      return false;
    }
    if (component instanceof Component10) {
      return false;
    }
    if (component instanceof Component11) {
      return false;
    }
    if (component instanceof Component12) {
      return false;
    }
    if (component instanceof Component13) {
      return false;
    }
    if (component instanceof Component14) {
      return false;
    }
    if (component instanceof Component15) {
      return false;
    }
    if (component instanceof Component16) {
      return true;
    }
    if (component instanceof Component17) {
      return true;
    }
    if (component instanceof Component18) {
      return true;
    }
    if (component instanceof Component19) {
      return false;
    }
    if (component instanceof Component20) {
      return false;
    }
    if (component instanceof Component22) {
      return false;
    }
    if (component instanceof Component23) {
      return false;
    }
    if (component instanceof Component24) {
      return false;
    }
    if (component instanceof Component25) {
      return false;
    }
    if (component instanceof Component26) {
      return false;
    }
    if (component instanceof Component27) {
      return false;
    }
    if (component instanceof Component28) {
      return false;
    }
    if (component instanceof Component29) {
      return false;
    }
    if (component instanceof Component30) {
      return false;
    }
    if (component instanceof Component31) {
      return false;
    }
    if (component instanceof Component32) {
      return false;
    }
    if (component instanceof Component33) {
      return false;
    }
    if (component instanceof Component34) {
      return false;
    }
    if (component instanceof Component35) {
      return false;
    }
    if (component instanceof Component36) {
      return false;
    }
    if (component instanceof Component37) {
      return false;
    }
    if (component instanceof Component38) {
      return false;
    }
    if (component instanceof Component39) {
      return false;
    }
    if (component instanceof Component40) {
      return false;
    }
    return false;
  }
}
componentMetadata.provider = new GeneratedReflection();
export function createRegisteredComponent(name: string): Behavior {
  if (name === "AnimationPlayer") return new Component0();
  if (name === "Animator") return new Component1();
  if (name === "KeyframeAnimator") return Component2.createDefault();
  if (name === "CameraOrbita") return new Component3();
  if (name === "CameraPrimeiraPessoa") return new Component4();
  if (name === "CameraRTS") return new Component5();
  if (name === "CameraSeguir") return new Component6();
  if (name === "AutomaticDoor") return new Component7();
  if (name === "VitrineContador") return new Component8();
  if (name === "VitrineHud") return new Component9();
  if (name === "ParticleSystem") return new Component10();
  if (name === "Buoyancy") return new Component11();
  if (name === "Collider") return new Component12();
  if (name === "PhysicsMaterial") return new Component13();
  if (name === "Rigidbody") return new Component14();
  if (name === "RouteAgent") return new Component15();
  if (name === "RoutePath") return new Component16();
  if (name === "ProceduralWorld") return new Component17();
  if (name === "Terrain") return new Component18();
  if (name === "NetworkManager") return new Component19();
  if (name === "NetworkObject") return new Component20();
  if (name === "NetworkTransform") return new Component21();
  if (name === "Camera") return new Component22();
  if (name === "CicloDoDia") return new Component23();
  if (name === "Light") return new Component24();
  if (name === "Material") return new Component25();
  if (name === "MeshRenderer") return new Component26();
  if (name === "Skeleton") return new Component27();
  if (name === "WaterSurface") return new Component28();
  if (name === "Bobber") return new Component29();
  if (name === "MotionSettings") return new Component30();
  if (name === "Mover") return new Component31();
  if (name === "Orbit") return new Component32();
  if (name === "Patrol") return new Component33();
  if (name === "Pulse") return new Component34();
  if (name === "Spinner") return new Component35();
  if (name === "Vagar") return new Component36();
  if (name === "UIButton") return new Component37();
  if (name === "UIText") return new Component38();
  if (name === "AudioListener") return new Component39();
  if (name === "AudioSource") return new Component40();
  throw new Error("Componente nao registrado: " + name);
}
export function restoreRegisteredComponent(data: any): any {
  if (data.type === "script:src/engine/core/animation_player.ts#AnimationPlayer") {
    const component = new Component0();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["clip"] === "string" && true) component["clip"] = data.fields["clip"];
      if (typeof data.fields["loop"] === "boolean" && true) component["loop"] = data.fields["loop"];
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = data.fields["speed"];
      if (typeof data.fields["playing"] === "boolean" && true) component["playing"] = data.fields["playing"];
    return component;
  }
  if (data.type === "script:src/engine/core/animator.ts#Animator") {
    const component = new Component1();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["controller"] === "string" && true) component["controller"] = data.fields["controller"];
    return component;
  }
  if (data.type === "script:assets/pacotes/camera/camera_orbita.ts#CameraOrbita") {
    const component = new Component3();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["alvo"] === "string" && true) component["alvo"] = data.fields["alvo"];
      if (typeof data.fields["distancia"] === "number" && data.fields["distancia"] === data.fields["distancia"] && data.fields["distancia"] > -1e30 && data.fields["distancia"] < 1e30) component["distancia"] = Math.max(0.5, Math.min(1000, data.fields["distancia"]));
      if (typeof data.fields["sensibilidade"] === "number" && data.fields["sensibilidade"] === data.fields["sensibilidade"] && data.fields["sensibilidade"] > -1e30 && data.fields["sensibilidade"] < 1e30) component["sensibilidade"] = data.fields["sensibilidade"];
      if (typeof data.fields["passoZoom"] === "number" && data.fields["passoZoom"] === data.fields["passoZoom"] && data.fields["passoZoom"] > -1e30 && data.fields["passoZoom"] < 1e30) component["passoZoom"] = data.fields["passoZoom"];
    return component;
  }
  if (data.type === "script:assets/pacotes/camera/camera_primeira_pessoa.ts#CameraPrimeiraPessoa") {
    const component = new Component4();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["velocidade"] === "number" && data.fields["velocidade"] === data.fields["velocidade"] && data.fields["velocidade"] > -1e30 && data.fields["velocidade"] < 1e30) component["velocidade"] = data.fields["velocidade"];
      if (typeof data.fields["sensibilidade"] === "number" && data.fields["sensibilidade"] === data.fields["sensibilidade"] && data.fields["sensibilidade"] > -1e30 && data.fields["sensibilidade"] < 1e30) component["sensibilidade"] = data.fields["sensibilidade"];
      if (typeof data.fields["exigirBotaoDireito"] === "boolean" && true) component["exigirBotaoDireito"] = data.fields["exigirBotaoDireito"];
    return component;
  }
  if (data.type === "script:assets/pacotes/camera/camera_rts.ts#CameraRTS") {
    const component = new Component5();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["velocidade"] === "number" && data.fields["velocidade"] === data.fields["velocidade"] && data.fields["velocidade"] > -1e30 && data.fields["velocidade"] < 1e30) component["velocidade"] = data.fields["velocidade"];
      if (typeof data.fields["zoomMin"] === "number" && data.fields["zoomMin"] === data.fields["zoomMin"] && data.fields["zoomMin"] > -1e30 && data.fields["zoomMin"] < 1e30) component["zoomMin"] = data.fields["zoomMin"];
      if (typeof data.fields["zoomMax"] === "number" && data.fields["zoomMax"] === data.fields["zoomMax"] && data.fields["zoomMax"] > -1e30 && data.fields["zoomMax"] < 1e30) component["zoomMax"] = data.fields["zoomMax"];
      if (typeof data.fields["zoom"] === "number" && data.fields["zoom"] === data.fields["zoom"] && data.fields["zoom"] > -1e30 && data.fields["zoom"] < 1e30) component["zoom"] = data.fields["zoom"];
      if (typeof data.fields["passoZoom"] === "number" && data.fields["passoZoom"] === data.fields["passoZoom"] && data.fields["passoZoom"] > -1e30 && data.fields["passoZoom"] < 1e30) component["passoZoom"] = data.fields["passoZoom"];
      if (typeof data.fields["inclinacao"] === "number" && data.fields["inclinacao"] === data.fields["inclinacao"] && data.fields["inclinacao"] > -1e30 && data.fields["inclinacao"] < 1e30) component["inclinacao"] = Math.max(10, Math.min(89, data.fields["inclinacao"]));
    return component;
  }
  if (data.type === "script:assets/pacotes/camera/camera_seguir.ts#CameraSeguir") {
    const component = new Component6();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["alvo"] === "string" && true) component["alvo"] = data.fields["alvo"];
      if (typeof data.fields["deslocX"] === "number" && data.fields["deslocX"] === data.fields["deslocX"] && data.fields["deslocX"] > -1e30 && data.fields["deslocX"] < 1e30) component["deslocX"] = data.fields["deslocX"];
      if (typeof data.fields["deslocY"] === "number" && data.fields["deslocY"] === data.fields["deslocY"] && data.fields["deslocY"] > -1e30 && data.fields["deslocY"] < 1e30) component["deslocY"] = data.fields["deslocY"];
      if (typeof data.fields["deslocZ"] === "number" && data.fields["deslocZ"] === data.fields["deslocZ"] && data.fields["deslocZ"] > -1e30 && data.fields["deslocZ"] < 1e30) component["deslocZ"] = data.fields["deslocZ"];
      if (typeof data.fields["suavizacao"] === "number" && data.fields["suavizacao"] === data.fields["suavizacao"] && data.fields["suavizacao"] > -1e30 && data.fields["suavizacao"] < 1e30) component["suavizacao"] = Math.max(0.01, Math.min(10, data.fields["suavizacao"]));
      if (typeof data.fields["olharAlvo"] === "boolean" && true) component["olharAlvo"] = data.fields["olharAlvo"];
    return component;
  }
  if (data.type === "script:assets/scripts/AutomaticDoor.ts#AutomaticDoor") {
    const component = new Component7();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["openOffsetY"] === "number" && data.fields["openOffsetY"] === data.fields["openOffsetY"] && data.fields["openOffsetY"] > -1e30 && data.fields["openOffsetY"] < 1e30) component["openOffsetY"] = data.fields["openOffsetY"];
      if (typeof data.fields["openSeconds"] === "number" && data.fields["openSeconds"] === data.fields["openSeconds"] && data.fields["openSeconds"] > -1e30 && data.fields["openSeconds"] < 1e30) component["openSeconds"] = data.fields["openSeconds"];
    return component;
  }
  if (data.type === "script:assets/scripts/VitrineContador.ts#VitrineContador") {
    const component = new Component8();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["contatos"] === "number" && data.fields["contatos"] === data.fields["contatos"] && data.fields["contatos"] > -1e30 && data.fields["contatos"] < 1e30) component["contatos"] = data.fields["contatos"];
    return component;
  }
  if (data.type === "script:assets/scripts/VitrineHud.ts#VitrineHud") {
    const component = new Component9();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["titulo"] === "string" && true) component["titulo"] = data.fields["titulo"];
      if (typeof data.fields["alvo"] === "string" && true) component["alvo"] = data.fields["alvo"];
    return component;
  }
  if (data.type === "script:src/engine/core/buoyancy.ts#Buoyancy") {
    const component = new Component11();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["waterObject"] === "string" && true) component["waterObject"] = data.fields["waterObject"];
      if (typeof data.fields["fluidDensity"] === "number" && data.fields["fluidDensity"] === data.fields["fluidDensity"] && data.fields["fluidDensity"] > -1e30 && data.fields["fluidDensity"] < 1e30) component["fluidDensity"] = data.fields["fluidDensity"];
      if (typeof data.fields["drag"] === "number" && data.fields["drag"] === data.fields["drag"] && data.fields["drag"] > -1e30 && data.fields["drag"] < 1e30) component["drag"] = data.fields["drag"];
      if (typeof data.fields["volumeScale"] === "number" && data.fields["volumeScale"] === data.fields["volumeScale"] && data.fields["volumeScale"] > -1e30 && data.fields["volumeScale"] < 1e30) component["volumeScale"] = data.fields["volumeScale"];
    return component;
  }
  if (data.type === "script:src/engine/core/route_agent.ts#RouteAgent") {
    const component = new Component15();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = data.fields["speed"];
      if (typeof data.fields["startNode"] === "number" && data.fields["startNode"] === data.fields["startNode"] && data.fields["startNode"] > -1e30 && data.fields["startNode"] < 1e30) component["startNode"] = data.fields["startNode"];
      if (typeof data.fields["seed"] === "number" && data.fields["seed"] === data.fields["seed"] && data.fields["seed"] > -1e30 && data.fields["seed"] < 1e30) component["seed"] = data.fields["seed"];
      if (typeof data.fields["turnSpeed"] === "number" && data.fields["turnSpeed"] === data.fields["turnSpeed"] && data.fields["turnSpeed"] > -1e30 && data.fields["turnSpeed"] < 1e30) component["turnSpeed"] = data.fields["turnSpeed"];
    return component;
  }
  if (data.type === "script:src/engine/core/procedural_world.ts#ProceduralWorld") {
    const component = new Component17();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["seed"] === "number" && data.fields["seed"] === data.fields["seed"] && data.fields["seed"] > -1e30 && data.fields["seed"] < 1e30) component["seed"] = data.fields["seed"];
      if (typeof data.fields["generator"] === "string" && true) component["generator"] = data.fields["generator"];
      if (typeof data.fields["generatorSettings"] === "string" && true) component["generatorSettings"] = data.fields["generatorSettings"];
      if (typeof data.fields["biomes"] === "boolean" && true) component["biomes"] = data.fields["biomes"];
      if (typeof data.fields["biomeScale"] === "number" && data.fields["biomeScale"] === data.fields["biomeScale"] && data.fields["biomeScale"] > -1e30 && data.fields["biomeScale"] < 1e30) component["biomeScale"] = data.fields["biomeScale"];
      if (typeof data.fields["heightScale"] === "number" && data.fields["heightScale"] === data.fields["heightScale"] && data.fields["heightScale"] > -1e30 && data.fields["heightScale"] < 1e30) component["heightScale"] = data.fields["heightScale"];
      if (typeof data.fields["caves"] === "boolean" && true) component["caves"] = data.fields["caves"];
      if (typeof data.fields["chunkRadius"] === "number" && data.fields["chunkRadius"] === data.fields["chunkRadius"] && data.fields["chunkRadius"] > -1e30 && data.fields["chunkRadius"] < 1e30) component["chunkRadius"] = data.fields["chunkRadius"];
      if (typeof data.fields["memoryMiB"] === "number" && data.fields["memoryMiB"] === data.fields["memoryMiB"] && data.fields["memoryMiB"] > -1e30 && data.fields["memoryMiB"] < 1e30) component["memoryMiB"] = data.fields["memoryMiB"];
      if (typeof data.fields["treeDensity"] === "number" && data.fields["treeDensity"] === data.fields["treeDensity"] && data.fields["treeDensity"] > -1e30 && data.fields["treeDensity"] < 1e30) component["treeDensity"] = data.fields["treeDensity"];
      if (typeof data.fields["grassDensity"] === "number" && data.fields["grassDensity"] === data.fields["grassDensity"] && data.fields["grassDensity"] > -1e30 && data.fields["grassDensity"] < 1e30) component["grassDensity"] = data.fields["grassDensity"];
      if (typeof data.fields["waterEnabled"] === "boolean" && true) component["waterEnabled"] = data.fields["waterEnabled"];
      if (typeof data.fields["maxSlope"] === "number" && data.fields["maxSlope"] === data.fields["maxSlope"] && data.fields["maxSlope"] > -1e30 && data.fields["maxSlope"] < 1e30) component["maxSlope"] = data.fields["maxSlope"];
      if (typeof data.fields["brushX"] === "number" && data.fields["brushX"] === data.fields["brushX"] && data.fields["brushX"] > -1e30 && data.fields["brushX"] < 1e30) component["brushX"] = data.fields["brushX"];
      if (typeof data.fields["brushZ"] === "number" && data.fields["brushZ"] === data.fields["brushZ"] && data.fields["brushZ"] > -1e30 && data.fields["brushZ"] < 1e30) component["brushZ"] = data.fields["brushZ"];
      if (typeof data.fields["brushRadius"] === "number" && data.fields["brushRadius"] === data.fields["brushRadius"] && data.fields["brushRadius"] > -1e30 && data.fields["brushRadius"] < 1e30) component["brushRadius"] = data.fields["brushRadius"];
      if (typeof data.fields["brushStrength"] === "number" && data.fields["brushStrength"] === data.fields["brushStrength"] && data.fields["brushStrength"] > -1e30 && data.fields["brushStrength"] < 1e30) component["brushStrength"] = data.fields["brushStrength"];
      if (typeof data.fields["vegetationMask"] === "string" && true) component["vegetationMask"] = data.fields["vegetationMask"];
    return component;
  }
  if (data.type === "script:src/engine/core/network_manager.ts#NetworkManager") {
    const component = new Component19();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["mode"] === "string" && true) component["mode"] = data.fields["mode"];
      if (typeof data.fields["address"] === "string" && true) component["address"] = data.fields["address"];
      if (typeof data.fields["port"] === "number" && data.fields["port"] === data.fields["port"] && data.fields["port"] > -1e30 && data.fields["port"] < 1e30) component["port"] = data.fields["port"];
      if (typeof data.fields["maxPlayers"] === "number" && data.fields["maxPlayers"] === data.fields["maxPlayers"] && data.fields["maxPlayers"] > -1e30 && data.fields["maxPlayers"] < 1e30) component["maxPlayers"] = data.fields["maxPlayers"];
      if (typeof data.fields["tickRate"] === "number" && data.fields["tickRate"] === data.fields["tickRate"] && data.fields["tickRate"] > -1e30 && data.fields["tickRate"] < 1e30) component["tickRate"] = data.fields["tickRate"];
      if (typeof data.fields["autoStart"] === "boolean" && true) component["autoStart"] = data.fields["autoStart"];
    return component;
  }
  if (data.type === "script:src/engine/core/network_object.ts#NetworkObject") {
    const component = new Component20();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["prefabId"] === "number" && data.fields["prefabId"] === data.fields["prefabId"] && data.fields["prefabId"] > -1e30 && data.fields["prefabId"] < 1e30) component["prefabId"] = data.fields["prefabId"];
    return component;
  }
  if (data.type === "script:src/engine/core/network_transform.ts#NetworkTransform") {
    const component = new Component21();
    if (data.fields === undefined || data.fields === null) return component;

    return component;
  }
  if (data.type === "script:assets/pacotes/ambiente/ciclo_do_dia.ts#CicloDoDia") {
    const component = new Component23();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["duracao"] === "number" && data.fields["duracao"] === data.fields["duracao"] && data.fields["duracao"] > -1e30 && data.fields["duracao"] < 1e30) component["duracao"] = Math.max(1, Math.min(86400, data.fields["duracao"]));
      if (typeof data.fields["hora"] === "number" && data.fields["hora"] === data.fields["hora"] && data.fields["hora"] > -1e30 && data.fields["hora"] < 1e30) component["hora"] = Math.max(0, Math.min(24, data.fields["hora"]));
      if (typeof data.fields["sol"] === "string" && true) component["sol"] = data.fields["sol"];
    return component;
  }
  if (data.type === "script:src/engine/core/light.ts#Light") {
    const component = new Component24();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["tipo"] === "string" && true) component["tipo"] = data.fields["tipo"];
      if (typeof data.fields["cor"] === "number" && data.fields["cor"] === data.fields["cor"] && data.fields["cor"] > -1e30 && data.fields["cor"] < 1e30) component["cor"] = data.fields["cor"];
      if (typeof data.fields["intensidade"] === "number" && data.fields["intensidade"] === data.fields["intensidade"] && data.fields["intensidade"] > -1e30 && data.fields["intensidade"] < 1e30) component["intensidade"] = Math.max(0, Math.min(100, data.fields["intensidade"]));
      if (typeof data.fields["alcance"] === "number" && data.fields["alcance"] === data.fields["alcance"] && data.fields["alcance"] > -1e30 && data.fields["alcance"] < 1e30) component["alcance"] = Math.max(0, Math.min(10000, data.fields["alcance"]));
      if (typeof data.fields["anguloSpot"] === "number" && data.fields["anguloSpot"] === data.fields["anguloSpot"] && data.fields["anguloSpot"] > -1e30 && data.fields["anguloSpot"] < 1e30) component["anguloSpot"] = Math.max(1, Math.min(179, data.fields["anguloSpot"]));
      if (typeof data.fields["sombra"] === "boolean" && true) component["sombra"] = data.fields["sombra"];
    return component;
  }
  if (data.type === "script:src/engine/core/water_surface.ts#WaterSurface") {
    const component = new Component28();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["width"] === "number" && data.fields["width"] === data.fields["width"] && data.fields["width"] > -1e30 && data.fields["width"] < 1e30) component["width"] = data.fields["width"];
      if (typeof data.fields["length"] === "number" && data.fields["length"] === data.fields["length"] && data.fields["length"] > -1e30 && data.fields["length"] < 1e30) component["length"] = data.fields["length"];
      if (typeof data.fields["waveAmplitude"] === "number" && data.fields["waveAmplitude"] === data.fields["waveAmplitude"] && data.fields["waveAmplitude"] > -1e30 && data.fields["waveAmplitude"] < 1e30) component["waveAmplitude"] = data.fields["waveAmplitude"];
      if (typeof data.fields["wavelength"] === "number" && data.fields["wavelength"] === data.fields["wavelength"] && data.fields["wavelength"] > -1e30 && data.fields["wavelength"] < 1e30) component["wavelength"] = data.fields["wavelength"];
      if (typeof data.fields["waveSpeed"] === "number" && data.fields["waveSpeed"] === data.fields["waveSpeed"] && data.fields["waveSpeed"] > -1e30 && data.fields["waveSpeed"] < 1e30) component["waveSpeed"] = data.fields["waveSpeed"];
      if (typeof data.fields["foamWidth"] === "number" && data.fields["foamWidth"] === data.fields["foamWidth"] && data.fields["foamWidth"] > -1e30 && data.fields["foamWidth"] < 1e30) component["foamWidth"] = data.fields["foamWidth"];
      if (typeof data.fields["opacity"] === "number" && data.fields["opacity"] === data.fields["opacity"] && data.fields["opacity"] > -1e30 && data.fields["opacity"] < 1e30) component["opacity"] = data.fields["opacity"];
      if (typeof data.fields["refraction"] === "number" && data.fields["refraction"] === data.fields["refraction"] && data.fields["refraction"] > -1e30 && data.fields["refraction"] < 1e30) component["refraction"] = data.fields["refraction"];
      if (typeof data.fields["absorption"] === "number" && data.fields["absorption"] === data.fields["absorption"] && data.fields["absorption"] > -1e30 && data.fields["absorption"] < 1e30) component["absorption"] = data.fields["absorption"];
      if (typeof data.fields["red"] === "number" && data.fields["red"] === data.fields["red"] && data.fields["red"] > -1e30 && data.fields["red"] < 1e30) component["red"] = data.fields["red"];
      if (typeof data.fields["green"] === "number" && data.fields["green"] === data.fields["green"] && data.fields["green"] > -1e30 && data.fields["green"] < 1e30) component["green"] = data.fields["green"];
      if (typeof data.fields["blue"] === "number" && data.fields["blue"] === data.fields["blue"] && data.fields["blue"] > -1e30 && data.fields["blue"] < 1e30) component["blue"] = data.fields["blue"];
      if (typeof data.fields["resolution"] === "number" && data.fields["resolution"] === data.fields["resolution"] && data.fields["resolution"] > -1e30 && data.fields["resolution"] < 1e30) component["resolution"] = data.fields["resolution"];
      if (typeof data.fields["reflectionStrength"] === "number" && data.fields["reflectionStrength"] === data.fields["reflectionStrength"] && data.fields["reflectionStrength"] > -1e30 && data.fields["reflectionStrength"] < 1e30) component["reflectionStrength"] = data.fields["reflectionStrength"];
      if (typeof data.fields["reflectionDistance"] === "number" && data.fields["reflectionDistance"] === data.fields["reflectionDistance"] && data.fields["reflectionDistance"] > -1e30 && data.fields["reflectionDistance"] < 1e30) component["reflectionDistance"] = data.fields["reflectionDistance"];
      if (typeof data.fields["reflectionSteps"] === "number" && data.fields["reflectionSteps"] === data.fields["reflectionSteps"] && data.fields["reflectionSteps"] > -1e30 && data.fields["reflectionSteps"] < 1e30) component["reflectionSteps"] = data.fields["reflectionSteps"];
    return component;
  }
  if (data.type === "script:assets/scripts/MotionSettings.ts#MotionSettings") {
    const component = new Component30();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["speed"] === "number" && data.fields["speed"] === data.fields["speed"] && data.fields["speed"] > -1e30 && data.fields["speed"] < 1e30) component["speed"] = Math.max(0, Math.min(20, data.fields["speed"]));
      if (typeof data.fields["moving"] === "boolean" && true) component["moving"] = data.fields["moving"];
      if (typeof data.fields["label"] === "string" && true) component["label"] = data.fields["label"];
    return component;
  }
  if (data.type === "script:src/scripts/vagar.ts#Vagar") {
    const component = new Component36();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["raio"] === "number" && data.fields["raio"] === data.fields["raio"] && data.fields["raio"] > -1e30 && data.fields["raio"] < 1e30) component["raio"] = data.fields["raio"];
      if (typeof data.fields["velocidade"] === "number" && data.fields["velocidade"] === data.fields["velocidade"] && data.fields["velocidade"] > -1e30 && data.fields["velocidade"] < 1e30) component["velocidade"] = data.fields["velocidade"];
    return component;
  }
  if (data.type === "script:src/engine/core/audio_listener.ts#AudioListener") {
    const component = new Component39();
    if (data.fields === undefined || data.fields === null) return component;

    return component;
  }
  if (data.type === "script:src/scripts/audiosource.ts#AudioSource") {
    const component = new Component40();
    if (data.fields === undefined || data.fields === null) return component;
      if (typeof data.fields["modo"] === "string" && true) component["modo"] = data.fields["modo"];
      if (typeof data.fields["clip"] === "string" && true) component["clip"] = data.fields["clip"];
      if (typeof data.fields["volume"] === "number" && data.fields["volume"] === data.fields["volume"] && data.fields["volume"] > -1e30 && data.fields["volume"] < 1e30) component["volume"] = Math.max(0, Math.min(1, data.fields["volume"]));
      if (typeof data.fields["pitch"] === "number" && data.fields["pitch"] === data.fields["pitch"] && data.fields["pitch"] > -1e30 && data.fields["pitch"] < 1e30) component["pitch"] = Math.max(0.1, Math.min(3, data.fields["pitch"]));
      if (typeof data.fields["loop"] === "boolean" && true) component["loop"] = data.fields["loop"];
      if (typeof data.fields["playOnAwake"] === "boolean" && true) component["playOnAwake"] = data.fields["playOnAwake"];
      if (typeof data.fields["mudo"] === "boolean" && true) component["mudo"] = data.fields["mudo"];
      if (typeof data.fields["spatialBlend"] === "number" && data.fields["spatialBlend"] === data.fields["spatialBlend"] && data.fields["spatialBlend"] > -1e30 && data.fields["spatialBlend"] < 1e30) component["spatialBlend"] = Math.max(0, Math.min(1, data.fields["spatialBlend"]));
      if (typeof data.fields["rolloff"] === "string" && true) component["rolloff"] = data.fields["rolloff"];
      if (typeof data.fields["minDistance"] === "number" && data.fields["minDistance"] === data.fields["minDistance"] && data.fields["minDistance"] > -1e30 && data.fields["minDistance"] < 1e30) component["minDistance"] = Math.max(0.01, Math.min(10000, data.fields["minDistance"]));
      if (typeof data.fields["maxDistance"] === "number" && data.fields["maxDistance"] === data.fields["maxDistance"] && data.fields["maxDistance"] > -1e30 && data.fields["maxDistance"] < 1e30) component["maxDistance"] = Math.max(0.01, Math.min(10000, data.fields["maxDistance"]));
      if (typeof data.fields["grupo"] === "string" && true) component["grupo"] = data.fields["grupo"];
      if (typeof data.fields["forma"] === "string" && true) component["forma"] = data.fields["forma"];
      if (typeof data.fields["freq"] === "number" && data.fields["freq"] === data.fields["freq"] && data.fields["freq"] > -1e30 && data.fields["freq"] < 1e30) component["freq"] = Math.max(20, Math.min(20000, data.fields["freq"]));
      if (typeof data.fields["dur"] === "number" && data.fields["dur"] === data.fields["dur"] && data.fields["dur"] > -1e30 && data.fields["dur"] < 1e30) component["dur"] = Math.max(0.01, Math.min(10, data.fields["dur"]));
      if (typeof data.fields["every"] === "number" && data.fields["every"] === data.fields["every"] && data.fields["every"] > -1e30 && data.fields["every"] < 1e30) component["every"] = data.fields["every"];
    return component;
  }
  return null;
}
export const REGISTRO = "jogo";
