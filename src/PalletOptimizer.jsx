import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Upload, Play, Zap, ArrowUp, ShieldAlert, Scale, Hammer, Settings } from 'lucide-react';

const PalletOptimizer = () => {
  // State
  const [items, setItems] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [errors, setErrors] = useState([]);
  const [currentPalletView, setCurrentPalletView] = useState(0);
  
  // Configuration
  const [config, setConfig] = useState({
    palletLength: 250, // Max length 20'10"
    palletWidth: 84,   // Max width 7'
    maxHeight: 80,     // Safe height buffer
    maxWeight: 2500,   // Max lbs per pallet
    safetyGap: 1.0,    // Gap from edges
    framingSpacing: 48, // Vertical posts every 48"
    lumberWidth: 3.5,   // 2x4 width (actual)
    lumberThick: 1.5,   // 2x4 thickness (actual)
    addBracing: true,   // Add diagonal bracing
    allowVertical: true // Allow items to stand if they fit
  });

  // Refs for 3D
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);

  // Colors
  const colorPalette = [
    0x3B82F6, 0xEF4444, 0x10B981, 0xF59E0B, 0x8B5CF6, 0xEC4899,
    0x6366F1, 0x14B8A6, 0xF97316, 0x84CC16, 0x06B6D4, 0xD946EF
  ];

  // -------------------------------------------------------------------------
  // 1. DATA PARSING
  // -------------------------------------------------------------------------
  const loadDemoData = () => {
    const demoItems = [
      { itemNumber: 'PIPE-240-HVY', height: 4.5, width: 4.5, length: 240, weight: 180, qty: 4 },
      { itemNumber: 'PIPE-120-STD', height: 4, width: 4, length: 120, weight: 80, qty: 6 },
      { itemNumber: 'SHORT-POST-60', height: 4, width: 4, length: 60, weight: 45, qty: 15 }, // Should stand vertically if logic permits
      { itemNumber: 'CURVED-96', height: 8, width: 12, length: 96, weight: 65, qty: 2 }, 
    ];
    processItems(demoItems);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()));
        const parsedItems = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 6 || !row[0]) continue;
          const item = {
            itemNumber: row[0],
            height: parseFloat(row[1]),
            width: parseFloat(row[2]),
            length: parseFloat(row[3]),
            weight: parseFloat(row[4]),
            qty: parseFloat(row[5]) || 1,
          };
          if (!isNaN(item.height) && !isNaN(item.weight)) parsedItems.push(item);
        }
        processItems(parsedItems);
      } catch (err) {
        setErrors(['Failed to parse CSV.']);
      }
    };
    reader.readAsText(file);
  };

  const processItems = (rawItems) => {
    const expanded = [];
    rawItems.forEach((item, idx) => {
      for (let i = 0; i < item.qty; i++) {
        expanded.push({
          ...item,
          uniqueId: `${item.itemNumber}-${i}`,
          colorIndex: idx % colorPalette.length
        });
      }
    });
    setItems(expanded);
    setPallets([]);
    setErrors([]);
  };

  // -------------------------------------------------------------------------
  // 2. FRAMING GENERATOR (The Wood Structure)
  // -------------------------------------------------------------------------

  // Helper to create a single wood piece
  const createLumber = (type, dimX, dimY, dimZ, posX, posY, posZ) => ({
      type,
      dims: { x: dimX, y: dimY, z: dimZ },
      pos: { x: posX, y: posY, z: posZ }
  });

  // -------------------------------------------------------------------------
  // 3. OPTIMIZATION ALGORITHM
  // -------------------------------------------------------------------------

  const runOptimization = () => {
    if (items.length === 0) return;
    
    // Sort: Length Desc -> Weight Desc
    const sortedQueue = [...items].sort((a, b) => {
      if (Math.abs(b.length - a.length) > 5) return b.length - a.length;
      return b.weight - a.weight;
    });

    const newPallets = [];
    
    // Effective dimensions
    const effWidth = config.palletWidth - (config.safetyGap * 2);
    const effLength = config.palletLength - (config.safetyGap * 2);

    let currentItemIndex = 0;

    while (currentItemIndex < sortedQueue.length) {
      const pallet = {
        id: newPallets.length + 1,
        items: [],
        woodFrames: [],
        totalWeight: 0,
        currentHeight: 0,
        woodUsage: 0
      };

      let layerY = config.lumberThick; // Start on top of bottom runners
      let palletActive = true;

      // Add Pallet Base Runners (Foundation)
      // 3 long runners for the pallet base
      [0.2, 0.5, 0.8].forEach(factor => {
           pallet.woodFrames.push(createLumber('base-runner', config.lumberWidth, config.lumberThick, config.palletLength, config.palletWidth * factor, config.lumberThick/2, config.palletLength/2));
      });

      while (palletActive) {
        const rowItems = [];
        let rowWidthUsed = 0;
        let rowMaxHeight = 0;
        let rowMaxLength = 0;
        let isVerticalRow = false;

        // Try to fill a row
        for (let i = currentItemIndex; i < sortedQueue.length; i++) {
          const item = sortedQueue[i];
          if (item.isPlaced) continue;
          
          // WEIGHT CHECK
          if (pallet.totalWeight + item.weight > config.maxWeight) continue;

          // Determine Orientation
          let dims = { x: item.width, y: item.height, z: item.length };
          let vertical = false;

          if (config.allowVertical && item.length < config.maxHeight && item.length < 90) {
              dims = { x: item.width, y: item.length, z: item.height }; 
              vertical = true;
          } else {
              if (item.width > item.height) dims = { x: item.height, y: item.width, z: item.length };
          }

          // VERTICAL CONSTRAINT: Must be on base layer
          // If we have moved up from the base layer (layerY > config.lumberThick), verticals are forbidden
          if (vertical && layerY > config.lumberThick) continue;

          if (rowItems.length > 0 && isVerticalRow !== vertical) continue;
          if (rowItems.length === 0) isVerticalRow = vertical;

          // Width Calculation with Framing
          let itemFootprintWidth = dims.x;
          if (!vertical) {
              const postW = config.lumberWidth;
              if (rowItems.length === 0) itemFootprintWidth += (postW * 2);
              else itemFootprintWidth += postW;
          } else {
              itemFootprintWidth += 0.5; // Small buffer
          }

          if (dims.z > effLength && !vertical) continue; 
          if (layerY + dims.y > config.maxHeight) continue;
          if (rowWidthUsed + itemFootprintWidth > effWidth) continue;

          rowItems.push({ index: i, ...item, dims, vertical });
          rowWidthUsed += itemFootprintWidth;
          rowMaxHeight = Math.max(rowMaxHeight, dims.y);
          rowMaxLength = Math.max(rowMaxLength, dims.z);
          
          // Mark as placed and UPDATE WEIGHT IMMEDIATELY
          item.isPlaced = true; 
          pallet.totalWeight += item.weight;
        }

        if (rowItems.length === 0) {
          palletActive = false;
        } else {
          // PLACE ROW
          const startX = (config.palletWidth - rowWidthUsed) / 2;
          let currentX = startX;

          rowItems.forEach((ri, idx) => {
            let itemX = currentX;
            if (!ri.vertical) {
                itemX += config.lumberWidth; 
            }

            const posX = itemX + (ri.dims.x / 2);
            const posY = layerY + (ri.dims.y / 2);
            const posZ = config.palletLength / 2; 

            pallet.items.push({
              ...sortedQueue[ri.index],
              position: { x: posX, y: posY, z: posZ },
              rotation: { x: 0, y: 0, z: 0 },
              finalDims: ri.dims
            });

            // GENERATE FRAMING (Pockets)
            if (!ri.vertical) {
                const frameLen = ri.dims.z; 
                const pocketHeight = ri.dims.y + config.lumberThick;
                
                const zStartGlobal = (config.palletLength - frameLen) / 2;
                const leftPostX = itemX - (config.lumberWidth / 2);
                const rightPostX = itemX + ri.dims.x + (config.lumberWidth / 2);

                // Iterate Z-axis for Cradle Points (every 48")
                for (let z = 0; z <= frameLen; z += config.framingSpacing) {
                    const zPos = zStartGlobal + z;
                    
                    // 1. Left Vertical Post
                    pallet.woodFrames.push(createLumber('post', config.lumberWidth, pocketHeight, config.lumberWidth, leftPostX, layerY + pocketHeight/2, zPos));
                    
                    // 2. Right Vertical Post
                    pallet.woodFrames.push(createLumber('post', config.lumberWidth, pocketHeight, config.lumberWidth, rightPostX, layerY + pocketHeight/2, zPos));
                
                    // 3. Top Cross Beam (Rung) - Only at cradle points
                    const rungWidth = (rightPostX - leftPostX) + config.lumberWidth;
                    pallet.woodFrames.push(createLumber('rung', 
                        rungWidth, 
                        config.lumberThick, 
                        config.lumberWidth, 
                        (leftPostX + rightPostX) / 2, 
                        layerY + pocketHeight, 
                        zPos
                    ));

                    // 4. Diagonal Bracing (Optional)
                    if (config.addBracing && z + config.framingSpacing <= frameLen) {
                         const nextZ = zStartGlobal + z + config.framingSpacing;
                         
                         // Left Wall Diagonal
                         pallet.woodFrames.push({
                            type: 'diagonal',
                            isDiagonal: true,
                            start: { x: leftPostX, y: layerY, z: zPos },
                            end: { x: leftPostX, y: layerY + pocketHeight, z: nextZ },
                            dims: { x: config.lumberWidth, y: config.lumberThick } 
                         });

                         // Right Wall Diagonal
                         pallet.woodFrames.push({
                            type: 'diagonal',
                            isDiagonal: true,
                            start: { x: rightPostX, y: layerY, z: zPos },
                            end: { x: rightPostX, y: layerY + pocketHeight, z: nextZ },
                            dims: { x: config.lumberWidth, y: config.lumberThick } 
                         });
                    }
                }
                
                // 5. Longitudinal Side Rails (Top & Bottom)
                // Left Rail
                pallet.woodFrames.push(createLumber('rail', config.lumberWidth, config.lumberThick, frameLen, leftPostX, layerY + pocketHeight + config.lumberThick, config.palletLength/2));
                // Right Rail
                pallet.woodFrames.push(createLumber('rail', config.lumberWidth, config.lumberThick, frameLen, rightPostX, layerY + pocketHeight + config.lumberThick, config.palletLength/2));
            }

            if (!ri.vertical) {
                currentX += ri.dims.x + config.lumberWidth; 
            } else {
                currentX += ri.dims.x + 0.5;
            }
          });

          if (isVerticalRow) {
              layerY += rowMaxHeight;
          } else {
              layerY += rowMaxHeight + (config.lumberThick * 2); // Space for bottom dunnage + top rung
          }
          
          pallet.currentHeight = layerY;
        }
      }

      // Calculate Wood Usage
      let totalVol = 0;
      pallet.woodFrames.forEach(L => {
          if (L.isDiagonal) {
              const dx = L.end.x - L.start.x;
              const dy = L.end.y - L.start.y;
              const dz = L.end.z - L.start.z;
              totalVol += Math.sqrt(dx*dx + dy*dy + dz*dz);
          } else {
              totalVol += Math.max(L.dims.x, L.dims.y, L.dims.z);
          }
      });
      pallet.woodUsage = (totalVol / 12).toFixed(1);

      const remaining = sortedQueue.filter(i => !i.isPlaced);
      if (remaining.length === sortedQueue.length) {
        setErrors(["Item fits failed. Check max dimensions."]);
        break;
      }

      newPallets.push(pallet);
      let nextQueue = [];
      for(let i=0; i<sortedQueue.length; i++) {
        if(!sortedQueue[i].isPlaced) nextQueue.push(sortedQueue[i]);
      }
      sortedQueue.length = 0;
      sortedQueue.push(...nextQueue);
      if (sortedQueue.length === 0) break;
    }

    setPallets(newPallets);
    if(newPallets.length > 0) setCurrentPalletView(0);
  };

  // -------------------------------------------------------------------------
  // 4. THREE.JS RENDERING
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (pallets.length === 0) return;
    const pallet = pallets[currentPalletView];
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    camera.position.set(config.palletWidth * 2.5, config.palletLength * 0.6, config.palletLength * 1.2);
    camera.lookAt(config.palletWidth / 2, 40, config.palletLength / 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(100, 200, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Pallet Base
    const baseGeo = new THREE.BoxGeometry(config.palletWidth, 5, config.palletLength);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(config.palletWidth / 2, -2.5, config.palletLength / 2);
    baseMesh.receiveShadow = true;
    scene.add(baseMesh);

    // Render Items
    pallet.items.forEach((item) => {
      const geo = new THREE.BoxGeometry(item.finalDims.x, item.finalDims.y, item.finalDims.z);
      const mat = new THREE.MeshStandardMaterial({ 
        color: colorPalette[item.colorIndex],
        roughness: 0.7,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(item.position.x, item.position.y, item.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { item };
      scene.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.2, transparent: true }));
      line.position.copy(mesh.position);
      scene.add(line);
    });

    // Render Wood Framing
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xEECFA1, roughness: 0.9 });
    
    pallet.woodFrames.forEach(wf => {
        if (wf.isDiagonal) {
            const start = new THREE.Vector3(wf.start.x, wf.start.y, wf.start.z);
            const end = new THREE.Vector3(wf.end.x, wf.end.y, wf.end.z);
            const distance = start.distanceTo(end);
            const geo = new THREE.BoxGeometry(wf.dims.x, wf.dims.y, distance);
            const mesh = new THREE.Mesh(geo, woodMat);
            const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
            mesh.position.copy(mid);
            mesh.lookAt(end);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
        } else {
            const geo = new THREE.BoxGeometry(wf.dims.x, wf.dims.y, wf.dims.z);
            const mesh = new THREE.Mesh(geo, woodMat);
            mesh.position.set(wf.pos.x, wf.pos.y, wf.pos.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
        }
    });

    let isDragging = false;
    let prevPos = { x: 0, y: 0 };
    const target = new THREE.Vector3(config.palletWidth/2, config.maxHeight/3, config.palletLength/2);

    const onMouseDown = (e) => { isDragging = true; prevPos = { x: e.clientX, y: e.clientY }; };
    const onMouseUp = () => { isDragging = false; };
    const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - prevPos.x;
        const dy = e.clientY - prevPos.y;
        prevPos = { x: e.clientX, y: e.clientY };
        const offset = new THREE.Vector3().subVectors(camera.position, target);
        const theta = Math.atan2(offset.x, offset.z);
        const phi = Math.atan2(Math.sqrt(offset.x*offset.x + offset.z*offset.z), offset.y);
        const newTheta = theta - dx * 0.01;
        const newPhi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.01));
        const radius = offset.length();
        camera.position.x = target.x + radius * Math.sin(newPhi) * Math.sin(newTheta);
        camera.position.y = target.y + radius * Math.cos(newPhi);
        camera.position.z = target.z + radius * Math.sin(newPhi) * Math.cos(newTheta);
        camera.lookAt(target);
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);

    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
        renderer.domElement.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('mousemove', onMouseMove);
    };
  }, [pallets, currentPalletView, config]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
            <div className="bg-orange-600 p-2 rounded-lg text-white"><Hammer size={24} /></div>
            <div>
                <h1 className="text-xl font-bold text-gray-900">Structural Crate Optimizer</h1>
                <p className="text-xs text-gray-500">Auto-framing, wood calculation, and pipe stacking</p>
            </div>
        </div>
        <div className="flex gap-3">
             <button onClick={loadDemoData} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md border border-purple-200 transition-colors">
                <Zap size={16} /> Load Demo
            </button>
            <button onClick={runOptimization} disabled={items.length===0} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50">
                <Play size={16} /> Build Crate
            </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r flex flex-col overflow-y-auto">
            {/* CONFIG */}
            <div className="p-4 border-b space-y-4">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Settings size={12}/> Pallet Configuration</h2>
                
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-gray-600">Pallet Len (in)</label>
                        <input type="number" value={config.palletLength} onChange={e => setConfig({...config, palletLength: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600">Pallet Wid (in)</label>
                        <input type="number" value={config.palletWidth} onChange={e => setConfig({...config, palletWidth: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><ArrowUp size={10}/> Max Height</label>
                        <input type="number" value={config.maxHeight} onChange={e => setConfig({...config, maxHeight: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><Scale size={10}/> Max Lbs</label>
                        <input type="number" value={config.maxWeight} onChange={e => setConfig({...config, maxWeight: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                         <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><ShieldAlert size={10}/> Safety Gap</label>
                         <input type="number" step="0.5" value={config.safetyGap} onChange={e => setConfig({...config, safetyGap: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600">Post Spacing</label>
                        <input type="number" value={config.framingSpacing} onChange={e => setConfig({...config, framingSpacing: Number(e.target.value)})} className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">Diagonal Bracing</label>
                    <select 
                        value={config.addBracing} 
                        onChange={e => setConfig({...config, addBracing: e.target.value === 'true'})}
                        className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="true">Yes - Add Structural Cross-Bracing</option>
                        <option value="false">No - Vertical Posts Only</option>
                    </select>
                </div>
                 <div>
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">Vertical Stacking</label>
                    <select 
                        value={config.allowVertical} 
                        onChange={e => setConfig({...config, allowVertical: e.target.value === 'true'})}
                        className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="true">Auto - Stand Short Items</option>
                        <option value="false">No - Always Lay Flat</option>
                    </select>
                </div>
            </div>

            {/* UPLOAD */}
            <div className="p-4 border-b bg-gray-50">
                <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-white hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-2 pb-2">
                        <Upload size={20} className="text-gray-400 mb-1" />
                        <p className="text-[10px] text-gray-500">Upload CSV (H, W, L, Wgt, Qty)</p>
                    </div>
                    <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
                </label>
            </div>

            {/* ERROR */}
            {errors.length > 0 && (
                <div className="p-4 bg-red-50 border-b border-red-100">
                    <div className="text-xs text-red-600 font-medium mb-1">Errors</div>
                    <ul className="list-disc list-inside text-[10px] text-red-500">
                        {errors.map((e,i) => <li key={i}>{e}</li>)}
                    </ul>
                </div>
            )}

            {/* ITEMS */}
            <div className="flex-1 p-4 overflow-y-auto">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Manifest</h2>
                <div className="space-y-2">
                    {Array.from(new Set(items.map(i => i.itemNumber))).map((num, i) => {
                        const group = items.filter(x => x.itemNumber === num);
                        return (
                            <div key={i} className="bg-white border rounded p-2 text-xs shadow-sm flex justify-between items-center">
                                <span className="font-bold">{num}</span>
                                <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-500">x{group.length}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>

        {/* CANVAS */}
        <div className="flex-1 flex flex-col bg-gray-200 relative">
            <div ref={mountRef} className="flex-1 w-full h-full cursor-move" />

            {/* PALLET CONTROLS */}
            {pallets.length > 0 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border px-6 py-3 flex items-center gap-6">
                    <button 
                        onClick={() => setCurrentPalletView(Math.max(0, currentPalletView - 1))}
                        disabled={currentPalletView===0}
                        className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                    >
                        Prev
                    </button>
                    <div className="text-sm font-bold text-gray-800">
                        Crate {currentPalletView + 1} <span className="text-gray-400 font-normal">of {pallets.length}</span>
                    </div>
                    <button 
                        onClick={() => setCurrentPalletView(Math.min(pallets.length-1, currentPalletView + 1))}
                        disabled={currentPalletView===pallets.length-1}
                        className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                    >
                        Next
                    </button>
                </div>
            )}
            
            {/* STATS PANEL */}
            {pallets.length > 0 && (
                <div className="absolute top-4 right-4 bg-white/95 backdrop-blur rounded-lg shadow-md border p-4 w-64">
                    <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 border-b pb-1">Bill of Materials</h3>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600 flex items-center gap-2"><Scale size={14}/> Cargo Weight</span>
                            <span className={`font-mono font-bold ${pallets[currentPalletView].totalWeight > config.maxWeight ? 'text-red-600' : 'text-gray-800'}`}>
                                {pallets[currentPalletView].totalWeight} / {config.maxWeight} lbs
                            </span>
                        </div>
                        
                        <div className="flex justify-between items-center text-blue-800 bg-blue-50 p-2 rounded">
                            <span className="text-blue-600 flex items-center gap-2"><Hammer size={14}/> Wood Req.</span>
                            <div className="text-right">
                                <div className="font-mono font-bold">{pallets[currentPalletView].woodUsage} ft</div>
                                <div className="text-[10px] opacity-70">~{Math.ceil(pallets[currentPalletView].woodUsage / 8)} (8ft boards)</div>
                            </div>
                        </div>

                         <div className="flex justify-between items-center">
                            <span className="text-gray-600 flex items-center gap-2"><ArrowUp size={14}/> Total Height</span>
                            <span className="font-mono font-bold text-gray-800">{pallets[currentPalletView].currentHeight.toFixed(1)}"</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default PalletOptimizer;
