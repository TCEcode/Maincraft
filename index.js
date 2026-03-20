import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const containerRef = useRef(null);
  const leftZoneRef = useRef(null);
  const rightZoneRef = useRef(null);
  const joystickKnobRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [renderDist, setRenderDist] = useState(2); // Дальность прорисовки (в чанках)
  
  const blocksList = ['grass', 'dirt', 'stone', 'wood', 'leaves'];
  const [activeSlot, setActiveSlot] = useState(0);

  const controls = useRef({
    moveForward: 0,
    moveRight: 0,
    lookYaw: 0,
    lookPitch: 0,
    isJumping: false,
    actionsQueue: [], 
    selectedBlock: 'grass', 
    
    lastChunkX: Infinity,
    lastChunkZ: Infinity,
    renderDist: 2, // Внутренняя переменная для игрового цикла
    isPaused: false,

    leftTouchId: null,
    leftStartX: 0,
    leftStartY: 0,
    rightTouchId: null,
    rightStartX: 0,
    rightStartY: 0,
    rightLastX: 0,
    rightLastY: 0,
    rightTouchMoved: false,
    longPressTimeout: null,
    longPressFired: false
  });

  // Синхронизация состояния React и useRef
  useEffect(() => { controls.current.selectedBlock = blocksList[activeSlot]; }, [activeSlot]);
  useEffect(() => { controls.current.isPaused = showSettings; }, [showSettings]);
  useEffect(() => { 
    controls.current.renderDist = renderDist; 
    controls.current.lastChunkX = Infinity; // Принудительно обновляем чанки при смене дальности
  }, [renderDist]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.onload = () => {
      setLoading(false);
      initGame(window.THREE);
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  const initGame = (THREE) => {
    if (!containerRef.current) return;

    // --- 1. СЦЕНА И КАМЕРА ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 50); 

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    // --- 2. ТЕКСТУРЫ ---
    const createTexture = (type) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      
      if (type === 'grass_top') {
        ctx.fillStyle = '#689F38'; ctx.fillRect(0, 0, 64, 64);
      } else if (type === 'dirt') {
        ctx.fillStyle = '#795548'; ctx.fillRect(0, 0, 64, 64);
      } else if (type === 'grass_side') {
        ctx.fillStyle = '#795548'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#689F38'; ctx.fillRect(0, 0, 64, 16); 
      } else if (type === 'stone') {
        ctx.fillStyle = '#7d7d7d'; ctx.fillRect(0, 0, 64, 64);
      } else if (type === 'wood') {
        ctx.fillStyle = '#8B5A2B'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#654321'; 
        for(let w=0; w<64; w+=16) ctx.fillRect(w, 0, 2, 64);
      } else if (type === 'leaves') {
        ctx.fillStyle = '#2d5a27'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#3a7332';
        for (let i = 0; i < 64; i += 8) {
          for (let j = 0; j < 64; j += 8) if (Math.random() > 0.3) ctx.fillRect(i, j, 4, 4);
        }
      }
      
      if (type !== 'leaves') { 
        for(let i=0; i<64; i+=4) {
          for(let j=0; j<64; j+=4) {
            if (Math.random() > 0.5) {
              ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
              ctx.fillRect(i, j, 4, 4);
            }
          }
        }
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      return texture;
    };

    const grassMaterials = [
      new THREE.MeshLambertMaterial({ map: createTexture('grass_side') }), 
      new THREE.MeshLambertMaterial({ map: createTexture('grass_side') }), 
      new THREE.MeshLambertMaterial({ map: createTexture('grass_top') }),  
      new THREE.MeshLambertMaterial({ map: createTexture('dirt') }),       
      new THREE.MeshLambertMaterial({ map: createTexture('grass_side') }), 
      new THREE.MeshLambertMaterial({ map: createTexture('grass_side') })  
    ];
    const dirtMaterials = Array(6).fill(new THREE.MeshLambertMaterial({ map: createTexture('dirt') }));
    const stoneMaterials = Array(6).fill(new THREE.MeshLambertMaterial({ map: createTexture('stone') }));
    const woodMaterials = Array(6).fill(new THREE.MeshLambertMaterial({ map: createTexture('wood') }));
    const leavesMaterials = Array(6).fill(new THREE.MeshLambertMaterial({ map: createTexture('leaves') }));

    // --- 3. СИСТЕМА ЧАНКОВ И ПАМЯТЬ ---
    const CHUNK_SIZE = 16;
    const MAX_BLOCKS = 60000; // Увеличили лимит для бОльшей дальности прорисовки
    
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const grassMesh = new THREE.InstancedMesh(geometry, grassMaterials, MAX_BLOCKS);
    const dirtMesh = new THREE.InstancedMesh(geometry, dirtMaterials, MAX_BLOCKS);
    const stoneMesh = new THREE.InstancedMesh(geometry, stoneMaterials, MAX_BLOCKS);
    const woodMesh = new THREE.InstancedMesh(geometry, woodMaterials, MAX_BLOCKS);
    const leavesMesh = new THREE.InstancedMesh(geometry, leavesMaterials, MAX_BLOCKS);
    
    scene.add(grassMesh); scene.add(dirtMesh); scene.add(stoneMesh);
    scene.add(woodMesh); scene.add(leavesMesh);

    const blocksMap = new Map();
    const generatedChunks = new Set();
    const deletedBlocks = new Set(); // ИСПРАВЛЕНИЕ 1: Черный список сломанных блоков

    const getElevation = (x, z) => {
      let y = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 6;
      y += Math.sin(x * 0.15 + 2) * Math.cos(z * 0.15 + 2) * 3;
      return Math.floor(y + 8);
    };

    const generateTree = (bx, by, bz) => {
      const h = 4 + Math.floor(Math.random() * 2);
      for (let y = 0; y < h; y++) blocksMap.set(`${bx},${by+y},${bz}`, {x: bx, y: by+y, z: bz, type: 'wood'});
      for (let lx = -2; lx <= 2; lx++) {
        for (let ly = h - 2; ly <= h + 1; ly++) {
          for (let lz = -2; lz <= 2; lz++) {
            if (lx === 0 && lz === 0 && ly < h) continue; 
            if (Math.abs(lx) + Math.abs(lz) === 4) continue; 
            const lKey = `${bx+lx},${by+ly},${bz+lz}`;
            if (!blocksMap.has(lKey)) blocksMap.set(lKey, {x: bx+lx, y: by+ly, z: bz+lz, type: 'leaves'});
          }
        }
      }
    };

    const generateChunk = (cx, cz) => {
      const chunkKey = `${cx},${cz}`;
      if (generatedChunks.has(chunkKey)) return;
      generatedChunks.add(chunkKey);

      const startX = cx * CHUNK_SIZE;
      const startZ = cz * CHUNK_SIZE;

      for (let x = startX; x < startX + CHUNK_SIZE; x++) {
        for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
          const surfaceY = getElevation(x, z);
          
          if (!deletedBlocks.has(`${x},${surfaceY},${z}`)) {
            blocksMap.set(`${x},${surfaceY},${z}`, { x, y: surfaceY, z, type: 'grass' });
          }
          if (!deletedBlocks.has(`${x},${surfaceY-1},${z}`)) {
            blocksMap.set(`${x},${surfaceY-1},${z}`, { x, y: surfaceY-1, z, type: 'dirt' });
          }

          if (Math.random() < 0.015) generateTree(x, surfaceY + 1, z);
        }
      }
    };

    const updateWorldMesh = () => {
      const ctrl = controls.current;
      let gIdx = 0, dIdx = 0, sIdx = 0, wIdx = 0, lIdx = 0;
      const dummy = new THREE.Object3D();
      
      const px = camera.position.x;
      const pz = camera.position.z;
      // Используем динамическую дальность прорисовки из настроек
      const renderRadius = (ctrl.renderDist + 1) * CHUNK_SIZE;

      blocksMap.forEach((block) => {
        if (Math.abs(block.x - px) > renderRadius || Math.abs(block.z - pz) > renderRadius) return;

        dummy.position.set(block.x, block.y, block.z);
        dummy.updateMatrix();
        
        if (block.type === 'grass' && gIdx < MAX_BLOCKS) grassMesh.setMatrixAt(gIdx++, dummy.matrix);
        else if (block.type === 'dirt' && dIdx < MAX_BLOCKS) dirtMesh.setMatrixAt(dIdx++, dummy.matrix);
        else if (block.type === 'stone' && sIdx < MAX_BLOCKS) stoneMesh.setMatrixAt(sIdx++, dummy.matrix);
        else if (block.type === 'wood' && wIdx < MAX_BLOCKS) woodMesh.setMatrixAt(wIdx++, dummy.matrix);
        else if (block.type === 'leaves' && lIdx < MAX_BLOCKS) leavesMesh.setMatrixAt(lIdx++, dummy.matrix);
      });
      
      grassMesh.count = gIdx; grassMesh.instanceMatrix.needsUpdate = true;
      dirtMesh.count = dIdx; dirtMesh.instanceMatrix.needsUpdate = true;
      stoneMesh.count = sIdx; stoneMesh.instanceMatrix.needsUpdate = true;
      woodMesh.count = wIdx; woodMesh.instanceMatrix.needsUpdate = true;
      leavesMesh.count = lIdx; leavesMesh.instanceMatrix.needsUpdate = true;
    };

    // Открытие блоков с учетом Черного списка
    const revealBlock = (bx, by, bz) => {
      const key = `${bx},${by},${bz}`;
      // ИСПРАВЛЕНИЕ 2: Если блока нет в памяти, но он был ранее удален - НЕ создаем его заново!
      if (!blocksMap.has(key) && !deletedBlocks.has(key)) {
        const surfaceY = getElevation(bx, bz);
        if (by < surfaceY) { 
          const type = (by < surfaceY - 5) ? 'stone' : 'dirt'; 
          blocksMap.set(key, { x: bx, y: by, z: bz, type });
        }
      }
    };

    // --- 4. ФИЗИКА И ИГРОК ---
    const playerPosition = new THREE.Vector3(0, 25, 0); 
    const playerVelocity = new THREE.Vector3();
    
    const maxSpeed = 12.0; 
    const gravity = 25.0; 
    const jumpForce = 9.0; 
    let canJump = false;

    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster(undefined, undefined, 0, 6); 
    const screenCenter = new THREE.Vector2(0, 0);

    const checkCollision = (pos) => {
      const radius = 0.3; 
      const height = 1.8; 
      
      const minX = pos.x - radius, maxX = pos.x + radius;
      const minY = pos.y,          maxY = pos.y + height;
      const minZ = pos.z - radius, maxZ = pos.z + radius;

      const gridMinX = Math.floor(minX + 0.5);
      const gridMaxX = Math.floor(maxX + 0.5);
      const gridMinY = Math.floor(minY + 0.5);
      const gridMaxY = Math.floor(maxY + 0.5);
      const gridMinZ = Math.floor(minZ + 0.5);
      const gridMaxZ = Math.floor(maxZ + 0.5);

      for (let x = gridMinX; x <= gridMaxX; x++) {
        for (let y = gridMinY; y <= gridMaxY; y++) {
          for (let z = gridMinZ; z <= gridMaxZ; z++) {
            let isSolid = false;
            const key = `${x},${y},${z}`;
            
            // ИСПРАВЛЕНИЕ 3: Правильная логика монолита
            if (blocksMap.has(key)) {
              isSolid = true; // Есть блок
            } else if (deletedBlocks.has(key)) {
              isSolid = false; // Точно пустота (игрок сломал)
            } else {
              const surfaceY = getElevation(x, z);
              if (y < surfaceY) isSolid = true; // Подземный монолит (еще не трогали)
            }

            if (isSolid) {
              const bMinX = x - 0.5, bMaxX = x + 0.5;
              const bMinY = y - 0.5, bMaxY = y + 0.5;
              const bMinZ = z - 0.5, bMaxZ = z + 0.5;
              
              if (minX < bMaxX && maxX > bMinX &&
                  minY < bMaxY && maxY > bMinY &&
                  minZ < bMaxZ && maxZ > bMinZ) {
                return true; 
              }
            }
          }
        }
      }
      return false; 
    };

    const animate = () => {
      requestAnimationFrame(animate);
      const ctrl = controls.current;

      // Остановка игры, если открыты настройки
      if (ctrl.isPaused) return;

      const delta = Math.min(clock.getDelta(), 0.1);

      // Динамический туман в зависимости от дальности прорисовки
      const targetFogFar = (ctrl.renderDist * CHUNK_SIZE) + 15;
      if (scene.fog.far !== targetFogFar) {
        scene.fog.far = targetFogFar;
        scene.fog.near = targetFogFar * 0.4;
      }

      camera.rotation.order = 'YXZ';
      camera.rotation.y = ctrl.lookYaw;
      camera.rotation.x = ctrl.lookPitch;

      // ОБНОВЛЕНИЕ ЧАНКОВ
      const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
      const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

      if (currentChunkX !== ctrl.lastChunkX || currentChunkZ !== ctrl.lastChunkZ) {
        ctrl.lastChunkX = currentChunkX;
        ctrl.lastChunkZ = currentChunkZ;
        
        for (let dx = -ctrl.renderDist; dx <= ctrl.renderDist; dx++) {
          for (let dz = -ctrl.renderDist; dz <= ctrl.renderDist; dz++) {
            generateChunk(currentChunkX + dx, currentChunkZ + dz);
          }
        }
        updateWorldMesh();
      }

      // ТАПЫ ПО БЛОКАМ
      while (ctrl.actionsQueue.length > 0) {
        const action = ctrl.actionsQueue.shift();
        raycaster.setFromCamera(screenCenter, camera);
        
        const intersects = raycaster.intersectObjects([grassMesh, dirtMesh, stoneMesh, woodMesh, leavesMesh]);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const instanceId = intersects[0].instanceId;
          const matrix = new THREE.Matrix4();
          hitMesh.getMatrixAt(instanceId, matrix);
          const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
          const blockKey = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;

          if (action === 'break') {
            if (blocksMap.has(blockKey)) {
              blocksMap.delete(blockKey);
              deletedBlocks.add(blockKey); // Заносим в черный список!

              revealBlock(pos.x, pos.y - 1, pos.z); 
              revealBlock(pos.x + 1, pos.y, pos.z); 
              revealBlock(pos.x - 1, pos.y, pos.z);
              revealBlock(pos.x, pos.y, pos.z + 1);
              revealBlock(pos.x, pos.y, pos.z - 1);
              revealBlock(pos.x, pos.y + 1, pos.z); 
              
              updateWorldMesh();
            }
          } else if (action === 'place') {
            const normal = intersects[0].face.normal;
            const newPos = pos.clone().add(normal);
            const newKey = `${Math.round(newPos.x)},${Math.round(newPos.y)},${Math.round(newPos.z)}`;

            blocksMap.set(newKey, { x: Math.round(newPos.x), y: Math.round(newPos.y), z: Math.round(newPos.z), type: ctrl.selectedBlock });
            
            if (checkCollision(playerPosition)) {
              blocksMap.delete(newKey); 
            } else {
              deletedBlocks.delete(newKey); // Убираем из черного списка, если поставили блок туда
              updateWorldMesh();
            }
          }
        }
      }

      // --- ДВИЖЕНИЕ И АВТО-ПРЫЖОК ---
      const moveX = ctrl.moveRight;
      const moveZ = ctrl.moveForward;
      
      let magnitude = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (magnitude > 1) magnitude = 1;

      let dirX = moveX;
      let dirZ = moveZ;
      if (magnitude > 0.01) { dirX /= magnitude; dirZ /= magnitude; }

      const angle = camera.rotation.y;
      const speedMult = maxSpeed * delta * magnitude; 
      
      const velX = (dirX * Math.cos(angle) + dirZ * Math.sin(angle)) * speedMult;
      const velZ = (-dirX * Math.sin(angle) + dirZ * Math.cos(angle)) * speedMult;

      playerPosition.x += velX;
      if (checkCollision(playerPosition)) {
        playerPosition.x -= velX; 
        const stepUpPos = playerPosition.clone();
        stepUpPos.y += 1.1; stepUpPos.x += velX; 
        if (!checkCollision(stepUpPos) && canJump && magnitude > 0.1) ctrl.isJumping = true; 
      }

      playerPosition.z += velZ;
      if (checkCollision(playerPosition)) {
        playerPosition.z -= velZ; 
        const stepUpPos = playerPosition.clone();
        stepUpPos.y += 1.1; stepUpPos.z += velZ;
        if (!checkCollision(stepUpPos) && canJump && magnitude > 0.1) ctrl.isJumping = true; 
      }

      if (ctrl.isJumping && canJump) {
        playerVelocity.y = jumpForce;
        canJump = false;
        ctrl.isJumping = false;
      }

      playerVelocity.y -= gravity * delta;
      playerPosition.y += playerVelocity.y * delta;
      
      if (checkCollision(playerPosition)) {
        if (playerVelocity.y < 0) canJump = true; 
        playerPosition.y -= playerVelocity.y * delta; 
        playerVelocity.y = 0;
      } else {
        if (playerVelocity.y < 0) canJump = false; 
      }

      if (playerPosition.y < -30) { playerPosition.set(16, 25, 16); playerVelocity.y = 0; }

      camera.position.copy(playerPosition);
      camera.position.y += 1.6; 

      renderer.render(scene, camera);
    };

    animate();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  };

  // --- УПРАВЛЕНИЕ ---
  const handleTouchStart = (e, side) => {
    if (showSettings) return; // Блокируем управление, если открыты настройки
    e.preventDefault();
    const touch = e.changedTouches[0];
    const ctrl = controls.current;

    if (side === 'left' && ctrl.leftTouchId === null) {
      ctrl.leftTouchId = touch.identifier;
      ctrl.leftStartX = touch.clientX;
      ctrl.leftStartY = touch.clientY;
      if (joystickKnobRef.current) {
        joystickKnobRef.current.style.opacity = '1';
        joystickKnobRef.current.style.transform = `translate(${touch.clientX - 25}px, ${touch.clientY - 25}px)`;
      }
    } else if (side === 'right' && ctrl.rightTouchId === null) {
      ctrl.rightTouchId = touch.identifier;
      ctrl.rightStartX = touch.clientX;
      ctrl.rightStartY = touch.clientY;
      ctrl.rightLastX = touch.clientX;
      ctrl.rightLastY = touch.clientY;
      ctrl.rightTouchMoved = false;
      ctrl.longPressFired = false;
      if (ctrl.longPressTimeout) clearTimeout(ctrl.longPressTimeout);

      ctrl.longPressTimeout = setTimeout(() => {
        if (!ctrl.rightTouchMoved) {
          ctrl.longPressFired = true;
          ctrl.actionsQueue.push('break');
          if (navigator.vibrate) navigator.vibrate(50); 
        }
      }, 400);
    }
  };

  const handleTouchMove = (e) => {
    if (showSettings) return;
    e.preventDefault();
    const ctrl = controls.current;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === ctrl.leftTouchId) {
        const dx = touch.clientX - ctrl.leftStartX;
        const dy = touch.clientY - ctrl.leftStartY;
        const maxDist = 50; 
        
        const dist = Math.sqrt(dx * dx + dy * dy);
        let normalizedX = dx; let normalizedY = dy;
        
        if (dist > maxDist) {
          normalizedX = (dx / dist) * maxDist;
          normalizedY = (dy / dist) * maxDist;
        }

        if (joystickKnobRef.current) {
          joystickKnobRef.current.style.transform = `translate(${ctrl.leftStartX + normalizedX - 25}px, ${ctrl.leftStartY + normalizedY - 25}px)`;
        }

        ctrl.moveRight = normalizedX / maxDist;
        ctrl.moveForward = normalizedY / maxDist;
      }

      if (touch.identifier === ctrl.rightTouchId) {
        const distMoved = Math.abs(touch.clientX - ctrl.rightStartX) + Math.abs(touch.clientY - ctrl.rightStartY);
        if (distMoved > 10) ctrl.rightTouchMoved = true;

        const dx = touch.clientX - ctrl.rightLastX;
        const dy = touch.clientY - ctrl.rightLastY;

        const sensitivity = 0.005;
        ctrl.lookYaw -= dx * sensitivity;
        ctrl.lookPitch -= dy * sensitivity;
        ctrl.lookPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, ctrl.lookPitch));

        ctrl.rightLastX = touch.clientX;
        ctrl.rightLastY = touch.clientY;
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (showSettings) return;
    e.preventDefault();
    const ctrl = controls.current;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === ctrl.leftTouchId) {
        ctrl.leftTouchId = null;
        ctrl.moveForward = 0; ctrl.moveRight = 0;
        if (joystickKnobRef.current) joystickKnobRef.current.style.opacity = '0';
      }

      if (touch.identifier === ctrl.rightTouchId) {
        if (ctrl.longPressTimeout) clearTimeout(ctrl.longPressTimeout);
        if (!ctrl.rightTouchMoved && !ctrl.longPressFired) {
          ctrl.actionsQueue.push('place');
        }
        ctrl.rightTouchId = null;
      }
    }
  };

  const fullScreenStyle = {
    position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
    overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'
  };

  const getSlotStyle = (type) => {
    if (type === 'grass') return { background: 'linear-gradient(to bottom, #689F38 25%, #795548 25%)' };
    if (type === 'dirt') return { backgroundColor: '#795548' };
    if (type === 'stone') return { backgroundColor: '#7d7d7d' };
    if (type === 'wood') return { background: 'repeating-linear-gradient(90deg, #8B5A2B, #8B5A2B 4px, #654321 4px, #654321 6px)' };
    if (type === 'leaves') return { backgroundColor: '#2d5a27', backgroundImage: 'radial-gradient(#3a7332 20%, transparent 20%)', backgroundSize: '10px 10px' };
    return {};
  };

  return (
    <div style={fullScreenStyle}>
      {loading && (
        <div style={{ ...fullScreenStyle, backgroundColor: '#87CEEB', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, color: 'white', fontFamily: 'monospace', fontSize: '24px', textShadow: '2px 2px 0 #000' }}>
          ГЕНЕРАЦИЯ МИРА...
        </div>
      )}

      <div ref={containerRef} style={fullScreenStyle} />

      {!loading && (
        <>
          {/* Кнопка настроек */}
          <button 
            onTouchStart={(e) => { e.stopPropagation(); setShowSettings(true); }}
            onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
            style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 50, fontSize: '30px', background: 'none', border: 'none', color: 'white', textShadow: '2px 2px 0 #000', padding: '10px' }}
          >
            ⚙️
          </button>

          {/* Меню Настроек */}
          {showSettings && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', fontFamily: 'sans-serif' }}>
              <h2 style={{ fontSize: '24px', marginBottom: '30px' }}>НАСТРОЙКИ</h2>
              
              <div style={{ width: '80%', maxWidth: '300px', textAlign: 'center' }}>
                <label style={{ fontSize: '18px', display: 'block', marginBottom: '15px' }}>
                  Дальность прорисовки: {renderDist} {renderDist === 1 ? 'чанк' : renderDist < 5 ? 'чанка' : 'чанков'}
                </label>
                <input 
                  type="range" min="1" max="4" value={renderDist} 
                  onChange={(e) => setRenderDist(Number(e.target.value))}
                  style={{ width: '100%', height: '15px', borderRadius: '5px', background: '#d3d3d3', outline: 'none' }}
                />
                <p style={{ fontSize: '12px', color: '#ccc', marginTop: '15px' }}>
                  Внимание: значения больше 2 могут вызывать лаги на слабых телефонах!
                </p>
              </div>

              <button 
                onClick={() => setShowSettings(false)} 
                onTouchStart={() => setShowSettings(false)} 
                style={{ marginTop: '40px', padding: '15px 40px', fontSize: '18px', backgroundColor: '#689F38', color: 'white', border: '3px solid #4CAF50', borderRadius: '10px', fontWeight: 'bold' }}
              >
                Вернуться к игре
              </button>
            </div>
          )}

          {/* Игровой интерфейс (Скрываем, если открыты настройки) */}
          {!showSettings && (
            <>
              <div 
                ref={leftZoneRef}
                onTouchStart={(e) => handleTouchStart(e, 'left')}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: '100%', zIndex: 10 }}
              />
              <div 
                ref={rightZoneRef}
                onTouchStart={(e) => handleTouchStart(e, 'right')}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{ position: 'absolute', top: 0, left: '50%', width: '50%', height: '100%', zIndex: 10 }}
              />
              
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'rgba(255,255,255,0.8)', fontSize: '24px', fontWeight: 'bold', pointerEvents: 'none', zIndex: 20, textShadow: '1px 1px 0 #000' }}>
                +
              </div>
              
              <div 
                ref={joystickKnobRef}
                style={{ position: 'absolute', top: 0, left: 0, width: '50px', height: '50px', backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', pointerEvents: 'none', opacity: 0, transition: 'opacity 0.2s', zIndex: 15 }}
              />
              
              <button 
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); controls.current.isJumping = true; }}
                style={{ position: 'absolute', bottom: '60px', right: '30px', width: '60px', height: '60px', backgroundColor: 'rgba(255,255,255,0.3)', border: '3px solid rgba(255,255,255,0.6)', borderRadius: '50%', color: 'white', fontWeight: 'bold', zIndex: 20 }}
              >
                ▲
              </button>
              
              <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '5px', backgroundColor: 'rgba(0,0,0,0.5)', padding: '5px', border: '2px solid #555', zIndex: 30 }}>
                {blocksList.map((type, idx) => (
                  <div 
                    key={type} 
                    onTouchStart={(e) => { e.stopPropagation(); setActiveSlot(idx); }} 
                    onMouseDown={(e) => { e.stopPropagation(); setActiveSlot(idx); }} 
                    style={{ 
                      width: '35px', 
                      height: '35px', 
                      ...getSlotStyle(type),
                      border: idx === activeSlot ? '3px solid white' : '2px solid #555',
                      boxSizing: 'border-box',
                      boxShadow: idx === activeSlot ? '0 0 10px white' : 'none',
                      opacity: idx === activeSlot ? 1 : 0.7,
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}


