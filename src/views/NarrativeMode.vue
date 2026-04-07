<template>
  <div class="narrative-mode-container">
    
    <div class="bg-gradient"></div>
    <div class="grid-overlay"></div>
    <div class="floating-orb orb-1"></div>
    <div class="floating-orb orb-2"></div>

    
    <MapContainer 
      ref="mapRef"
      class="background-map"
      :poiFeatures="poiFeatures"
      :filterEnabled="true"
      :globalAnalysisEnabled="true"
      :showControls="false"
      @map-ready="onMapReady"
      @map-move-end="onMapMove"
    />

    
    <canvas ref="canvasRef" class="effect-canvas"></canvas>

    
    <div class="narrative-ui">
      
      <div v-if="isPlaying && narrativeSteps.length > 0" class="progress-ring-container">
        <svg width="48" height="48" class="progress-ring-svg">
          <circle class="ring-bg" cx="24" cy="24" r="20"/>
          <circle 
            class="ring-progress" 
            cx="24" cy="24" r="20" 
            :style="{ strokeDashoffset: progressOffset }"
          />
        </svg>
        <div class="progress-text">{{ currentStepIndex + 1 }}/{{ narrativeSteps.length }}</div>
      </div>

      
      <transition name="fade-slide">
        <div v-if="scriptVisible" class="script-panel" :class="{ 'generating': isGenerating }">
          <div class="panel-header">
            <div class="brand-mini">
              <div class="brand-icon-mini">✨</div>
              <div class="brand-text-mini">
                <h1>AI 空间叙事</h1>
                <span>SPACE NARRATIVE</span>
              </div>
            </div>
            <el-button link @click="scriptVisible = false" class="close-btn">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          
          <div class="script-content" ref="scriptContentRef">
            
            <div v-if="aiResponse" class="ai-text-response">
              <div class="response-title">AI 分析报告</div>
              <div class="response-body" v-html="formattedAiResponse"></div>
            </div>

            
            <div v-if="narrativeSteps.length > 0" class="narrative-steps-section">
              <div class="response-title">漫游脚本</div>
              <div class="modern-steps">
                <div 
                  v-for="(step, index) in narrativeSteps" 
                  :key="index"
                  class="modern-step-item"
                  :class="{ 'active': currentStepIndex === index, 'finished': currentStepIndex > index }"
                >
                  <div class="step-line"></div>
                  <div class="step-dot"></div>
                  <div class="step-info">
                    <div class="step-label">STEP {{ index + 1 }}</div>
                    <div class="step-title">{{ step.focus === 'overview' ? '区域全景' : step.focus }}</div>
                  </div>
                </div>
              </div>
            </div>
            
            
            <div v-if="!aiResponse && !isGenerating" class="empty-state">
              <div class="empty-icon">💬</div>
              <p>当前为前端展示模式，后端接入中。点击下方按钮查看叙事规范模板。</p>
            </div>

            
            <div v-if="isGenerating" class="loading-state">
              <div class="loader-spinner-mini"></div>
              <span>正在加载叙事规范模板...</span>
            </div>
          </div>

          <div class="panel-footer">
            <div class="action-row">
              <button 
                class="btn-modern btn-generate" 
                :disabled="isGenerating"
                @click="handleGenerate"
              >
                <el-icon v-if="isGenerating" class="is-loading"><Loading /></el-icon>
                <el-icon v-else><MagicStick /></el-icon>
                {{ isGenerating ? '模板加载中...' : '查看叙事规范模板' }}
              </button>
              <button 
                v-if="narrativeSteps.length > 0" 
                class="btn-modern btn-play-narrative"
                :class="{ 'playing': isPlaying }"
                @click="playNarrative" 
                :disabled="isPlaying"
              >
                <el-icon><VideoPlay /></el-icon>
                {{ isPlaying ? '播放中...' : '开始漫游' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

      
      <transition name="up">
        <div v-if="isPlaying && currentVoiceText" class="subtitle-card">
          <div class="card-glow"></div>
          <div class="district-name-container">
            <span class="district-prefix">NOW FOCUSING</span>
            <h2 class="district-name-text">{{ currentNarrativeFocus }}</h2>
          </div>
          <div class="narrative-text-container">
            <p class="narrative-text">
              {{ typedText }}<span class="typing-cursor"></span>
            </p>
          </div>
          
          
          <div class="card-controls">
            <div class="voice-visualizer">
              <div v-for="i in 5" :key="i" class="audio-bar" :style="{ animationDelay: (i * 0.2) + 's' }"></div>
            </div>
          </div>
        </div>
      </transition>
      
      
      <div class="action-buttons">
        <button class="round-tool-btn" @click="scriptVisible = !scriptVisible" :title="scriptVisible ? '隐藏面板' : '显示面板'">
          <el-icon><View v-if="scriptVisible" /><Hide v-else /></el-icon>
        </button>
        <button class="round-tool-btn danger" @click="goBack" title="返回主页">
          <el-icon><ArrowLeft /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, shallowRef, watch, nextTick, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index';
import { ElIcon } from 'element-plus/es/components/icon/index';
import { marked } from 'marked';
import { ArrowLeft, Close, Hide, Loading, MagicStick, VideoPlay, View } from '@element-plus/icons-vue';
import { fromLonLat, toLonLat } from 'ol/proj';
import { NARRATIVE_TEXT_TEMPLATE_MARKDOWN, NARRATIVE_UI_ONLY_NOTICE } from '../utils/narrativeTextTemplate';
import { normalizeMarkdownForRender } from '../utils/markdownContract.js';

const MapContainer = defineAsyncComponent(() => import('../components/MapContainer.vue'));

let THREE = null;
let threeRuntimePromise = null;

async function ensureThreeRuntime() {
  if (THREE) return THREE;
  if (!threeRuntimePromise) {
    threeRuntimePromise = import('three').then((mod) => {
      THREE = mod;
      return THREE;
    }).finally(() => {
      threeRuntimePromise = null;
    });
  }
  return threeRuntimePromise;
}


const router = useRouter();
const mapRef = ref(null);
const canvasRef = ref(null);
const poiFeatures = ref([]);
const narrativeSteps = ref([]);
const aiResponse = ref(''); 
const currentStepIndex = ref(-1);
const isGenerating = ref(false);
const isPlaying = ref(false);
const scriptVisible = ref(true);
const currentVoiceText = ref('');
const boundaryData = ref(null);
const scriptContentRef = ref(null); 


const typedText = ref('');
const currentNarrativeFocus = computed(() => {
  if (currentStepIndex.value >= 0 && narrativeSteps.value[currentStepIndex.value]) {
    const focus = narrativeSteps.value[currentStepIndex.value].focus;
    return focus === 'overview' ? '区域概览' : focus;
  }
  return '空间叙事';
});


const progressOffset = computed(() => {
  if (narrativeSteps.value.length === 0) return 125.6;
  const progress = (currentStepIndex.value + 1) / narrativeSteps.value.length;
  return 125.6 * (1 - progress);
});


let typeInterval = null;
const typeText = (text) => {
  clearInterval(typeInterval);
  typedText.value = '';
  let i = 0;
  typeInterval = setInterval(() => {
    if (i < text.length) {
      typedText.value += text[i];
      i++;
    } else {
      clearInterval(typeInterval);
    }
  }, 50); 
};


watch(currentVoiceText, (newVal) => {
  if (newVal) {
    typeText(newVal.replace(/<[^>]+>/g, '')); 
  }
});


const scene = shallowRef(null);
const camera = shallowRef(null);
const renderer = shallowRef(null);
const clock = shallowRef(null);
const boundaryMesh = shallowRef(null);
const boundaryMaterial = shallowRef(null);
const maskMesh = shallowRef(null); 
const mapInstance = shallowRef(null);
const spatialClusters = ref([]); 
const vernacularRegions = ref([]); 
const fuzzyRegions = ref([]); 
const clusterBoundaries = ref([]); 
const fuzzyRegionMeshes = ref([]); 
const isDrawingCluster = ref(false); 
const currentSubtitle = ref(''); 
const subtitleHistory = ref([]); 
const isSubtitleVisible = ref(false); 
const subtitleContainerRef = ref(null); 
const aiPanelRef = ref(null); 
const subtitlePosition = ref({ x: 0, y: 0 }); 
const subtitleSafeZone = ref({ left: 0, top: 0, right: 0, bottom: 0 }); 
const activeRegionIndex = ref(-1); 

let frameId = null;
let boundaryDashStart = 0;
let boundaryDashTotal = 0;
const BOUNDARY_DASH_DURATION = 3.6;

function getElapsedClockTime() {
  if (!clock.value) return 0;
  return clock.value.getElapsedTime();
}

const NARRATIVE_TEMPLATE_CONTENT = `${NARRATIVE_UI_ONLY_NOTICE}

${NARRATIVE_TEXT_TEMPLATE_MARKDOWN}`;

const formattedAiResponse = computed(() => {
  const normalized = normalizeMarkdownForRender(aiResponse.value || NARRATIVE_TEMPLATE_CONTENT);
  return marked.parse(normalized);
});


watch(aiResponse, () => {
  nextTick(() => {
    if (scriptContentRef.value) {
      scriptContentRef.value.scrollTop = scriptContentRef.value.scrollHeight;
    }
  });
});

const initThree = async () => {
  await ensureThreeRuntime();
  if (!canvasRef.value) return;
  if (!clock.value) {
    clock.value = new THREE.Clock();
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  const s = new THREE.Scene();
  const r = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    alpha: true,
    antialias: true
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(width, height);

  const c = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 1000);
  c.position.z = 10;

  scene.value = s;
  camera.value = c;
  renderer.value = r;

  
  const maskGeo = new THREE.PlaneGeometry(width * 2, height * 2);
  const maskMat = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(width, height) },
      uFocus: { value: new THREE.Vector2(width / 2, height / 2) },
      uRadius: { value: 0.35 },
      uOpacity: { value: 0.6 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uResolution;
      uniform vec2 uFocus;
      uniform float uRadius;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 st = gl_FragCoord.xy / uResolution;
        vec2 focus = uFocus / uResolution;
        float d = distance(st, focus);
        float mask = smoothstep(uRadius, uRadius + 0.2, d);
        gl_FragColor = vec4(0.0, 0.0, 0.0, mask * uOpacity);
      }
    `,
    transparent: true,
    depthTest: false
  });
  const m = new THREE.Mesh(maskGeo, maskMat);
  m.position.set(width / 2, height / 2, 1);
  s.add(m);
  maskMesh.value = m;

  animate();
};

const handleResize = () => {
  if (!camera.value || !renderer.value) return;
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.value.right = width;
  camera.value.bottom = height;
  camera.value.updateProjectionMatrix();

  renderer.value.setSize(width, height);
  if (maskMesh.value) {
    maskMesh.value.geometry.dispose();
    maskMesh.value.geometry = new THREE.PlaneGeometry(width * 2, height * 2);
    maskMesh.value.position.set(width / 2, height / 2, 1);
    maskMesh.value.material.uniforms.uResolution.value.set(width, height);
    maskMesh.value.material.uniforms.uFocus.value.set(width / 2, height / 2);
  }
};

const cleanupThree = () => {
  if (frameId) cancelAnimationFrame(frameId);
  window.removeEventListener('resize', handleResize);
  if (renderer.value) renderer.value.dispose();
  if (scene.value) {
    scene.value.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
};




const syncThreeWithMap = () => {
  if (!mapInstance.value || !scene.value || !camera.value) return;
  
  
  if (boundaryData.value && boundaryMesh.value) {
    const ring = boundaryData.value.coordinates[0];
    const positions = boundaryMesh.value.geometry.attributes.position;
    const array = positions.array;
    let needsUpdate = false;
    
    
    
    
    ring.forEach((coord, i) => {
      
      
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if (pixel) {
        
        array[i * 3] = pixel[0];     
        array[i * 3 + 1] = window.innerHeight - pixel[1]; 
        array[i * 3 + 2] = 0;        
      }
    });
    
    positions.needsUpdate = true;
    
    
    if (boundaryMesh.value) {
      boundaryMesh.value.computeLineDistances();
      const lineDistance = boundaryMesh.value.geometry.attributes.lineDistance;
      if (lineDistance && lineDistance.array && lineDistance.array.length > 0) {
        const total = lineDistance.array[lineDistance.array.length - 1];
        if (Number.isFinite(total) && total > 0) {
          boundaryDashTotal = total;
          if (boundaryMaterial.value?.uniforms) {
            boundaryMaterial.value.uniforms.uDashSize.value = total;
            boundaryMaterial.value.uniforms.uTotalSize.value = total * 2.0;
            const elapsed = getElapsedClockTime() - boundaryDashStart;
            const t = (elapsed % BOUNDARY_DASH_DURATION) / BOUNDARY_DASH_DURATION;
            boundaryMaterial.value.uniforms.uDashOffset.value = total * (1.0 - t);
          }
        }
      }
    }

    
    
    let centerX = 0, centerY = 0;
    let count = 0;
    ring.forEach(coord => {
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if(pixel) {
        centerX += pixel[0];
        centerY += pixel[1];
        count++;
      }
    });
    
    if (count > 0 && maskMesh.value) {
      maskMesh.value.material.uniforms.uFocus.value.set(
        centerX / count, 
        window.innerHeight - (centerY / count) 
      );
    }
  }
};

const animate = () => {
  frameId = requestAnimationFrame(animate);
  
  if (renderer.value && scene.value && camera.value) {
    const time = getElapsedClockTime();
    
    
    syncThreeWithMap();
    
    
    syncClusterBoundaries();

    
    if (maskMesh.value) {
      maskMesh.value.material.uniforms.uOpacity.value = 0.6 + 0.1 * Math.sin(time * 0.8);
    }
    
    renderer.value.render(scene.value, camera.value);
  }
};


const updateBoundaryLine = () => {
  if (!boundaryData.value || !scene.value) return;

  if (boundaryMesh.value) {
    scene.value.remove(boundaryMesh.value);
    boundaryMesh.value.geometry.dispose();
  }

  
  const ring = boundaryData.value.coordinates[0];
  const points = ring.map(() => new THREE.Vector3(0, 0, 0)); 
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  
  if (!boundaryMaterial.value) {
    boundaryMaterial.value = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#38bdf8') },
        uDashOffset: { value: 0 },
        uDashSize: { value: 1 },
        uTotalSize: { value: 2 },
        uOpacity: { value: 0.95 }
      },
      vertexShader: `
        attribute float lineDistance;
        varying float vLineDistance;
        void main() {
          vLineDistance = lineDistance;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uDashOffset;
        uniform float uDashSize;
        uniform float uTotalSize;
        uniform float uOpacity;
        varying float vLineDistance;
        void main() {
          float d = mod(vLineDistance + uDashOffset, uTotalSize);
          if (d > uDashSize) discard;
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false
    });
  }

  const mesh = new THREE.LineLoop(geometry, boundaryMaterial.value);
  mesh.computeLineDistances();
  boundaryDashStart = getElapsedClockTime();
  const lineDistance = mesh.geometry.attributes.lineDistance;
  if (lineDistance && lineDistance.array && lineDistance.array.length > 0) {
    boundaryDashTotal = lineDistance.array[lineDistance.array.length - 1];
    if (boundaryMaterial.value?.uniforms) {
      boundaryMaterial.value.uniforms.uDashSize.value = boundaryDashTotal;
      boundaryMaterial.value.uniforms.uTotalSize.value = boundaryDashTotal * 2.0;
      boundaryMaterial.value.uniforms.uDashOffset.value = boundaryDashTotal;
    }
  }
  
  mesh.frustumCulled = false; 
  boundaryMesh.value = mesh;
  scene.value.add(mesh);
  
  
  syncThreeWithMap();
};


const onMapReady = async (olMap) => {
  mapInstance.value = olMap;
  await initThree();
  window.addEventListener('resize', handleResize);
};

const onMapMove = () => {
  
};

const handleGenerate = async () => {
  if (isGenerating.value) return;

  isGenerating.value = true;
  narrativeSteps.value = [];
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
  boundaryData.value = null;
  poiFeatures.value = [];
  spatialClusters.value = [];
  vernacularRegions.value = [];
  fuzzyRegions.value = [];
  clearClusterBoundaries();
  clearFuzzyRegions();
  aiResponse.value = NARRATIVE_TEMPLATE_CONTENT;

  await nextTick();
  isGenerating.value = false;
};

const drawFuzzyRegions = async (regions) => {
  if (!regions || regions.length === 0 || !scene.value) return;
  
  console.log(`[Narrative] 绘制模糊区域: ${regions.length} 个区域`);
  
  
  clearFuzzyRegions();
  
  
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (!region.layers) continue;
    
    const regionMeshGroup = {
      id: region.id,
      name: region.name,
      core: null,
      transition: null,
      outer: null
    };
    
    
    if (region.layers.outer?.boundary) {
      regionMeshGroup.outer = createAuroraBoundary(
        region.layers.outer.boundary,
        i,
        'outer',
        { r: 0.0, g: 0.8, b: 1.0 }, 
        0.15 
      );
      if (regionMeshGroup.outer) {
        scene.value.add(regionMeshGroup.outer);
      }
    }
    
    
    if (region.layers.transition?.boundary) {
      regionMeshGroup.transition = createAuroraBoundary(
        region.layers.transition.boundary,
        i,
        'transition',
        { r: 0.5, g: 0.3, b: 1.0 }, 
        0.35 
      );
      if (regionMeshGroup.transition) {
        scene.value.add(regionMeshGroup.transition);
      }
    }
    
    
    if (region.layers.core?.boundary) {
      regionMeshGroup.core = createAuroraBoundary(
        region.layers.core.boundary,
        i,
        'core',
        { r: 0.0, g: 0.95, b: 1.0 }, 
        0.85 
      );
      if (regionMeshGroup.core) {
        scene.value.add(regionMeshGroup.core);
      }
    }
    
    fuzzyRegionMeshes.value.push(regionMeshGroup);
  }
  
  
  startAuroraAnimation();
};


const createAuroraBoundary = (boundary, regionIndex, layerType, color, baseAlpha) => {
  if (!boundary || boundary.length < 3) return null;
  
  
  const points = boundary.map(() => new THREE.Vector3(0, 0, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(color.r, color.g, color.b) },
      uColorStart: { value: new THREE.Color(0.0, 0.95, 1.0) }, 
      uColorEnd: { value: new THREE.Color(0.6, 0.3, 1.0) },    
      uProgress: { value: 0 },
      uRegionIndex: { value: regionIndex },
      uLayerType: { value: layerType === 'core' ? 0 : layerType === 'transition' ? 1 : 2 },
      uBaseAlpha: { value: baseAlpha },
      uIsActive: { value: 0 } 
    },
    vertexShader: `
      attribute float vertexProgress;
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        vUv = uv;
        vProgress = vertexProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uColorStart;
      uniform vec3 uColorEnd;
      uniform float uProgress;
      uniform float uRegionIndex;
      uniform int uLayerType;
      uniform float uBaseAlpha;
      uniform float uIsActive;
      
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        
        float speed = uLayerType == 0 ? 3.0 : uLayerType == 1 ? 2.0 : 1.0;
        float flow = fract(vUv.x * 4.0 - uTime * speed + uRegionIndex * 0.3);
        
        
        
        vec3 gradientColor = mix(uColorStart, uColorEnd, 0.5 + 0.5 * sin(flow * 3.14 + vUv.x));
        
        
        vec3 finalColor = mix(uBaseColor, gradientColor, 0.6);
        
        
        if (uIsActive > 0.5) {
          finalColor = mix(finalColor, vec3(1.0, 0.9, 0.3), 0.6); 
        }
        
        
        float beam = smoothstep(0.0, 0.2, sin(flow * 3.14159)); 
        finalColor += vec3(1.0) * beam * 0.5;

        
        float alpha = uBaseAlpha;
        
        
        if (vUv.x > uProgress) {
          alpha *= 0.1; 
        } else {
          
          float pulse = 0.8 + 0.2 * sin(uTime * 4.0 + vUv.x * 10.0);
          alpha *= pulse;
        }
        
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    side: THREE.DoubleSide
  });
  
  
  const count = points.length;
  const progressArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    progressArray[i] = i / (count - 1);
  }
  geometry.setAttribute('vertexProgress', new THREE.BufferAttribute(progressArray, 1));
  
  const mesh = new THREE.LineLoop(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = { 
    boundary, 
    regionIndex, 
    layerType,
    isFuzzyRegion: true 
  };
  
  return mesh;
};


let auroraAnimationId = null;
let drawStartTime = null; 
const DRAW_DURATION = 2500; 

const startAuroraAnimation = () => {
  if (auroraAnimationId) cancelAnimationFrame(auroraAnimationId);
  
  drawStartTime = performance.now(); 
  
  const animate = () => {
    auroraAnimationId = requestAnimationFrame(animate);
    
    const time = getElapsedClockTime();
    const elapsed = performance.now() - drawStartTime;
    const drawProgress = Math.min(elapsed / DRAW_DURATION, 1); 
    
    
    fuzzyRegionMeshes.value.forEach((regionGroup, regionIdx) => {
      
      const regionDelay = regionIdx * 400; 
      const localElapsed = Math.max(0, elapsed - regionDelay);
      const localProgress = Math.min(localElapsed / DRAW_DURATION, 1);
      
      ['outer', 'transition', 'core'].forEach((layerType, layerIdx) => {
        const mesh = regionGroup[layerType];
        if (mesh && mesh.material.uniforms) {
          mesh.material.uniforms.uTime.value = time;
          
          
          const layerDelay = layerIdx * 200; 
          const layerLocalElapsed = Math.max(0, localElapsed - layerDelay);
          const layerProgress = Math.min(layerLocalElapsed / (DRAW_DURATION * 0.8), 1);
          
          mesh.material.uniforms.uProgress.value = layerProgress;
        }
      });
    });
  };
  
  animate();
};



const clearFuzzyRegions = () => {
  fuzzyRegionMeshes.value.forEach(regionGroup => {
    ['outer', 'transition', 'core'].forEach(layerType => {
      const mesh = regionGroup[layerType];
      if (mesh && scene.value) {
        scene.value.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    });
  });
  fuzzyRegionMeshes.value = [];
  
  if (auroraAnimationId) {
    cancelAnimationFrame(auroraAnimationId);
    auroraAnimationId = null;
  }
};


const highlightFuzzyRegion = (regionIndex) => {
  activeRegionIndex.value = regionIndex;
  
  fuzzyRegionMeshes.value.forEach((regionGroup, idx) => {
    const isActive = idx === regionIndex;
    
    ['outer', 'transition', 'core'].forEach(layerType => {
      const mesh = regionGroup[layerType];
      if (mesh && mesh.material.uniforms) {
        mesh.material.uniforms.uIsActive.value = isActive ? 1 : 0;
      }
    });
  });
};


const drawClusterBoundaries = async (clusters) => {
  if (!clusters || clusters.length === 0 || !scene.value) return;
  
  isDrawingCluster.value = true;
  clusterBoundaries.value = [];
  
  
  clusterBoundaries.value.forEach(mesh => {
    if (mesh && scene.value) {
      scene.value.remove(mesh);
      mesh.geometry.dispose();
    }
  });
  
  
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    if (!cluster.boundary || cluster.boundary.length < 3) continue;
    
    const boundaryMesh = await createFlowingBoundary(cluster.boundary, i);
    if (boundaryMesh) {
      clusterBoundaries.value.push(boundaryMesh);
      scene.value.add(boundaryMesh);
    }
  }
  
  isDrawingCluster.value = false;
};


const createFlowingBoundary = (boundary, index) => {
  if (!boundary || boundary.length < 3) return null;
  
  
  const points = boundary.map(() => new THREE.Vector3(0, 0, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorStart: { value: new THREE.Color('#00f2ff') }, 
      uColorEnd: { value: new THREE.Color('#a855f7') },   
      uProgress: { value: 0 }, 
      uIndex: { value: index } 
    },
    vertexShader: `
      attribute float progress;
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        vUv = uv;
        vProgress = progress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorStart;
      uniform vec3 uColorEnd;
      uniform float uProgress;
      uniform float uIndex;
      
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        
        float flow = fract(vUv.x * 3.0 - uTime * 2.0 + uIndex * 0.5);
        
        
        vec3 color = mix(uColorStart, uColorEnd, flow);
        
        
        float alpha = 0.0;
        if (vUv.x <= uProgress) {
          
          alpha = 0.8 + 0.2 * sin(flow * 3.14159 * 2.0);
        } else if (vUv.x <= uProgress + 0.05) {
          
          alpha = 0.8 * (1.0 - (vUv.x - uProgress) / 0.05);
        }
        
        
        float glow = 0.5 + 0.5 * sin(uTime * 3.0 + vUv.x * 10.0);
        color = mix(color, vec3(1.0), glow * 0.2);
        
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    side: THREE.DoubleSide
  });
  
  
  const count = points.length;
  const progressArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    progressArray[i] = i / (count - 1);
  }
  geometry.setAttribute('progress', new THREE.BufferAttribute(progressArray, 1));
  
  const mesh = new THREE.LineLoop(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = { boundary, isClusterBoundary: true };
  
  return mesh;
};


const syncClusterBoundaries = () => {
  if (!mapInstance.value || !scene.value) return;
  
  clusterBoundaries.value.forEach(mesh => {
    if (!mesh || !mesh.userData.boundary) return;
    
    const boundary = mesh.userData.boundary;
    const positions = mesh.geometry.attributes.position;
    const array = positions.array;
    
    boundary.forEach((coord, i) => {
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if (pixel) {
        array[i * 3] = pixel[0];
        array[i * 3 + 1] = window.innerHeight - pixel[1];
        array[i * 3 + 2] = 0;
      }
    });
    
    positions.needsUpdate = true;
    
    
    if (mesh.material.uniforms) {
      mesh.material.uniforms.uTime.value = getElapsedClockTime();
    }
  });
};


const playClusterAnimation = async (clusters) => {
  if (!clusters || clusters.length === 0) return;
  
  
  await drawClusterBoundaries(clusters);
  
  
  const duration = 2000; 
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      
      clusterBoundaries.value.forEach((mesh, index) => {
        if (mesh && mesh.material.uniforms) {
          
          const delay = index * 300;
          const localProgress = Math.max(0, Math.min((elapsed - delay) / duration, 1));
          mesh.material.uniforms.uProgress.value = localProgress;
        }
      });
      
      if (progress < 1 || clusterBoundaries.value.some(m => m.material.uniforms.uProgress.value < 1)) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };
    animate();
  });
};


const clearClusterBoundaries = () => {
  clusterBoundaries.value.forEach(mesh => {
    if (mesh && scene.value) {
      scene.value.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
  clusterBoundaries.value = [];
};

const playNarrative = async () => {
  if (narrativeSteps.value.length === 0 || isPlaying.value) return;
  
  isPlaying.value = true;
  
  
  if (fuzzyRegionMeshes.value.length > 0) {
    startAuroraAnimation(); 
  }
  
  for (let i = 0; i < narrativeSteps.value.length; i++) {
    currentStepIndex.value = i;
    const step = narrativeSteps.value[i];
    currentVoiceText.value = step.voice_text;
    
    
    if (step.region_index !== undefined && step.region_index >= 0) {
      highlightFuzzyRegion(step.region_index);
    }
    
    if (step.focus !== 'overview') {
      let targetCoords = null;
      
      
      if (step.center && step.center.lon && step.center.lat) {
        targetCoords = [step.center.lon, step.center.lat];
      }
      
      
      if (!targetCoords && fuzzyRegions.value && fuzzyRegions.value.length > 0) {
        const targetRegion = fuzzyRegions.value.find(r => 
          r.id === step.region_id || 
          r.name === step.focus || 
          (r.candidates?.bestGuess === step.focus)
        );
        
        if (targetRegion && targetRegion.center) {
          targetCoords = [targetRegion.center.lon, targetRegion.center.lat];
          const idx = fuzzyRegions.value.indexOf(targetRegion);
          if (idx >= 0) highlightFuzzyRegion(idx);
        }
      }
      
      
      if (!targetCoords) {
        const targetPoi = poiFeatures.value.find(p => p.properties.name === step.focus);
        if (targetPoi) {
          targetCoords = targetPoi.geometry.coordinates;
        }
      }
      
      if (targetCoords && mapInstance.value) {
        mapInstance.value.getView().animate({
          center: fromLonLat(targetCoords),
          zoom: 16,
          duration: 1500
        });
      }
    } else {
      
      if (mapInstance.value) {
        mapInstance.value.getView().animate({ zoom: 14, duration: 1500 });
      }
      
      highlightFuzzyRegion(-1);
    }

    await new Promise(resolve => setTimeout(resolve, step.duration || 5000));
  }
  
  isPlaying.value = false;
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
  highlightFuzzyRegion(-1); 
};


const goBack = () => router.push('/');

onBeforeUnmount(() => {
  cleanupThree();
  clearClusterBoundaries();
  clearFuzzyRegions();
});

</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');

.narrative-mode-container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #0a0a12;
    font-family: 'Inter', 'Noto Sans SC', sans-serif;
    color: rgba(255, 255, 255, 0.95);
}


.bg-gradient {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse 80% 50% at 20% 40%, rgba(0, 212, 255, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse 60% 40% at 80% 60%, rgba(123, 44, 191, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse 50% 30% at 50% 100%, rgba(0, 212, 255, 0.04) 0%, transparent 50%);
    animation: bgPulse 20s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
}

@keyframes bgPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

.grid-overlay {
    position: fixed;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 70%);
    pointer-events: none;
    z-index: 2;
}

.floating-orb {
    position: fixed;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 70%);
    pointer-events: none;
    animation: float 15s ease-in-out infinite;
    z-index: 3;
}

.floating-orb.orb-1 { top: 10%; left: 10%; animation-delay: 0s; }
.floating-orb.orb-2 { bottom: 20%; right: 10%; animation-delay: -5s; }

@keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -30px) scale(1.1); }
    50% { transform: translate(-20px, 20px) scale(0.9); }
    75% { transform: translate(20px, 30px) scale(1.05); }
}


.background-map {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    filter: brightness(0.6) grayscale(0.2) contrast(1.1);
}

.effect-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 5;
    pointer-events: none;
}


.narrative-ui {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
}

.narrative-ui > * { pointer-events: auto; }


.progress-ring-container {
    position: fixed;
    bottom: 32px;
    left: 40px;
    width: 56px;
    height: 56px;
    z-index: 100;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    border-radius: 50%;
    padding: 4px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
}

.progress-ring-svg { transform: rotate(-90deg); }
.progress-ring-svg circle { fill: none; stroke-width: 3; }
.progress-ring-svg .ring-bg { stroke: rgba(255,255,255,0.1); }
.progress-ring-svg .ring-progress {
    stroke: #00d4ff;
    stroke-dasharray: 125.6;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    filter: drop-shadow(0 0 5px #00d4ff);
}

.progress-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #00d4ff;
    letter-spacing: -0.5px;
}


.script-panel {
    position: absolute;
    left: 24px;
    top: 24px;
    width: 380px;
    max-height: calc(100vh - 48px);
    background: rgba(10, 10, 18, 0.75);
    backdrop-filter: blur(30px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    z-index: 20;
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
}

.script-panel.generating {
    border-color: rgba(0, 212, 255, 0.4);
    box-shadow: 0 0 40px rgba(0, 212, 255, 0.15);
}

.panel-header {
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
}

.brand-mini { display: flex; align-items: center; gap: 12px; }
.brand-icon-mini {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #00d4ff, #7b2cbf);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
}

.brand-text-mini h1 { font-size: 15px; font-weight: 700; color: #fff; margin: 0; letter-spacing: 0.5px; }
.brand-text-mini span { font-size: 9px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 1.5px; }

.script-content {
    flex: 1;
    padding: 0 24px 24px;
    overflow-y: auto;
    scrollbar-width: none;
}

.script-content::-webkit-scrollbar { display: none; }

.response-title {
    font-size: 11px;
    color: #00d4ff;
    font-weight: 700;
    letter-spacing: 2px;
    margin: 24px 0 16px;
    opacity: 0.8;
}

.ai-text-response {
    color: rgba(255,255,255,0.8);
    font-size: 14px;
    line-height: 1.8;
}


.modern-steps { display: flex; flex-direction: column; gap: 4px; }
.modern-step-item {
    position: relative;
    padding: 12px 0 12px 32px;
    transition: all 0.3s ease;
}

.step-line {
    position: absolute;
    left: 7px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255,255,255,0.1);
}

.modern-step-item:first-child .step-line { top: 20px; }
.modern-step-item:last-child .step-line { bottom: auto; height: 20px; }

.step-dot {
    position: absolute;
    left: 4px;
    top: 20px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    border: 2px solid #0a0a12;
    z-index: 2;
    transition: all 0.4s ease;
}

.modern-step-item.active .step-dot {
    background: #00d4ff;
    box-shadow: 0 0 10px #00d4ff;
    transform: scale(1.4);
}

.modern-step-item.finished .step-dot { background: #7b2cbf; }

.step-label { font-size: 9px; color: rgba(255, 255, 255, 0.5); font-weight: 700; letter-spacing: 1px; margin-bottom: 2px; }
.step-title { font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500; transition: all 0.3s ease; }
.modern-step-item.active .step-title { color: #fff; font-weight: 600; }


.panel-footer {
    padding: 24px;
    background: rgba(0,0,0,0.2);
    border-top: 1px solid rgba(255,255,255,0.05);
}

.action-row { display: flex; flex-direction: column; gap: 12px; }

.btn-modern {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    letter-spacing: 0.5px;
}

.btn-generate {
    background: rgba(255,255,255,0.05);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.1);
}

.btn-generate:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); }

.btn-play-narrative {
    background: linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%);
    color: #fff;
    box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
}

.btn-play-narrative:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 212, 255, 0.4); }
.btn-play-narrative:active { transform: translateY(0); }
.btn-play-narrative.playing { background: rgba(255,255,255,0.1); box-shadow: none; color: rgba(255, 255, 255, 0.5); cursor: not-allowed; }


.subtitle-card {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    max-width: 90vw;
    background: rgba(10, 10, 18, 0.6);
    backdrop-filter: blur(40px) saturate(150%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    padding: 24px 32px;
    text-align: center;
    z-index: 100;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255,255,255,0.1);
    overflow: hidden;
}

.card-glow {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 1px;
    background: linear-gradient(90deg, transparent, #00d4ff, transparent);
    opacity: 0.6;
}

.district-prefix {
    font-size: 10px;
    font-weight: 700;
    color: #00d4ff;
    text-transform: uppercase;
    letter-spacing: 4px;
    margin-bottom: 8px;
    display: block;
    opacity: 0.7;
}

.district-name-text {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 12px;
    letter-spacing: 3px;
    background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.6) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.narrative-text {
    font-size: 13px;
    line-height: 1.7;
    color: rgba(255,255,255,0.85);
    font-weight: 400;
    letter-spacing: 0.3px;
    min-height: 40px;
}

.typing-cursor {
    display: inline-block;
    width: 3px;
    height: 20px;
    background: #00d4ff;
    margin-left: 6px;
    vertical-align: middle;
    animation: blink 0.8s infinite;
    box-shadow: 0 0 10px #00d4ff;
}

@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }


.card-controls { margin-top: 24px; display: flex; justify-content: center; }
.voice-visualizer { display: flex; align-items: flex-end; gap: 4px; height: 30px; }
.audio-bar {
    width: 3px;
    height: 8px;
    background: #00d4ff;
    border-radius: 2px;
    animation: bar-dance 0.6s ease-in-out infinite alternate;
}

@keyframes bar-dance { from { height: 6px; opacity: 0.4; } to { height: 24px; opacity: 1; } }


.action-buttons {
    position: absolute;
    right: 32px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.round-tool-btn {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(10, 10, 18, 0.6);
    backdrop-filter: blur(20px);
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
}

.round-tool-btn:hover { background: #00d4ff; color: #fff; transform: scale(1.1) rotate(5deg); }
.round-tool-btn.danger:hover { background: #ff6b6b; }


.loader-spinner-mini {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 40px 0;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}


.up-enter-active, .up-leave-active { transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); }
.up-enter-from, .up-leave-to { opacity: 0; transform: translate(-50%, 100px); }

.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.6s ease; }
.fade-slide-enter-from, .fade-slide-leave-to { opacity: 0; transform: translateX(-50px); filter: blur(10px); }


:deep(.map-filter-control) {
  display: none !important;
}

.response-body :deep(h3) {
  color: #00f2ff;
  font-size: 1.1rem;
  margin: 16px 0 8px 0;
}
.response-body :deep(p) { margin-bottom: 12px; }
.response-body :deep(ul) { padding-left: 20px; margin-bottom: 12px; }


.script-content {
    -ms-overflow-style: none; 
}
</style>


