/**
 * 工具栏接入模块 - SmartAnnotation 插件初始化和管理
 * 依赖: SmartAnnotation 类, window.inspectionTool
 */
(function () {
  'use strict';
  // ==================== SmartAnnotation 插件实例 ====================
  let plugin = null;
  let isPluginEnabled = false;
  let isExistingAnnotationEnabled = false;
  let pendingPluginAnnotations = null; // 待恢复的标注数据
  // 全局元素引用
  let penBtn = null;
  let arrowBtn = null;
  let rectBtn = null;
  let textBtn = null;
  let eraserBtn = null;
  let strokeWidthSlider = null;
  let colorInput = null;
  let colorPreview = null;
  let annotationToggle = null;
  let canvasWrapper = null;
  let pluginCanvas = null;
  let activeTool = null;
  let eraserSize = 12;
  // 获取图片边界（视图坐标，单位 px）
  function getImageBounds() {
    const inspectionTool = window.inspectionTool;
    if (inspectionTool && inspectionTool.state) {
      return {
        x: inspectionTool.state.canvasOffsetX || 0,
        y: inspectionTool.state.canvasOffsetY || 0,
        width: inspectionTool.state.imageWidth || 0,
        height: inspectionTool.state.imageHeight || 0
      };
    }
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
  }
  function getComparisonSurfaceSize(bounds = getImageBounds()) {
    let width = canvasWrapper?.clientWidth || 0;
    let height = canvasWrapper?.clientHeight || 0;
    ['annotation-canvas', 'design-canvas', 'dev-canvas'].forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(width, rect.width || parseFloat(canvas.style.width) || 0);
      height = Math.max(height, rect.height || parseFloat(canvas.style.height) || 0);
    });
    return {
      width: Math.max(width, bounds.x + bounds.width),
      height: Math.max(height, bounds.y + bounds.height)
    };
  }
  // 辅助函数：获取值显示元素
  function getValueBadge() {
    let badge = document.querySelector('.slider-value-badge');
    if (!badge) {
      const vContainer = document.querySelector('.vertical-slider-container');
      if (vContainer) {
        badge = document.createElement('span');
        badge.className = 'slider-value-badge';
        badge.innerText = strokeWidthSlider ? strokeWidthSlider.value + 'px' : '4px';
        vContainer.appendChild(badge);
      }
    }
    return badge;
  }
  // ==================== 重写插件的坐标转换方法 ====================
  function overridePluginCoordinateSystem() {
    if (!plugin) return;
    plugin._getLogicalCoords = function (e) {
      const rect = this.drawCanvas.getBoundingClientRect();
      let x = (e.clientX - rect.left) * (this.width / rect.width);
      let y = (e.clientY - rect.top) * (this.height / rect.height);
      // 保留真实指针位置，由插件统一判断是否进入开发图边界。
      return {
        x: Math.min(this.width, Math.max(0, x)),
        y: Math.min(this.height, Math.max(0, y))
      };
    };
    console.log('[工具栏] 已重写坐标转换方法');
  }
  // ==================== 重写文字绘制方法，增加裁剪蒙版 ====================
  function overrideTextRenderMethod() {
    if (!plugin) return;
    plugin._drawMultilineText = function (ctx, text, x, y, fontSize, color, lineHeight = 1.2, showBackground = false) {
      if (!text) return;
      const bounds = getImageBounds();
      ctx.save();
      ctx.font = `normal ${fontSize}px system-ui, sans-serif`;
      const lines = text.split('\n');
      const lineHeightPx = fontSize * lineHeight;
      let maxWidth = 0;
      for (let line of lines) {
        const metrics = ctx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width);
      }
      const totalHeight = lines.length * lineHeightPx;
      const textLeft = x;
      const textRight = x + maxWidth;
      const textTop = y;
      const textBottom = y + totalHeight;
      const needClip = (textLeft < bounds.x || textRight > bounds.x + bounds.width ||
        textTop < bounds.y || textBottom > bounds.y + bounds.height);
      if (needClip && bounds.width > 0 && bounds.height > 0) {
        ctx.beginPath();
        ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.clip();
      }
      ctx.font = `normal ${fontSize}px system-ui, sans-serif`;
      if (showBackground) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x - 4, y - 2, maxWidth + 8, totalHeight + 4);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 4, y - 2, maxWidth + 8, totalHeight + 4);
      }
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      lines.forEach((line, index) => {
        ctx.fillText(line, x, y + (index * lineHeightPx));
      });
      ctx.restore();
    };
    console.log('[工具栏] 已重写文字绘制方法');
  }
  // ==================== 使用父容器监听限制 textarea 拖拽边界 ====================
  function setupTextareaDragBoundary() {
    if (!plugin || !plugin.textInput) return;
    const textInput = plugin.textInput;
    let isDragging = false;
    let dragStartX = 0,
      dragStartY = 0;
    let inputStartLeft = 0,
      inputStartTop = 0;

    function getBoundaryLimits() {
      const bounds = getImageBounds();
      const inputWidthInCanvas = textInput.offsetWidth || 100;
      const inputHeightInCanvas = textInput.offsetHeight || 30;
      return {
        minLeft: bounds.x,
        maxLeft: bounds.x + bounds.width - inputWidthInCanvas,
        minTop: bounds.y,
        maxTop: bounds.y + bounds.height - inputHeightInCanvas
      };
    }
    const onPointerDown = (e) => {
      if (e.target === textInput || textInput.contains(e.target)) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        inputStartLeft = parseFloat(textInput.style.left) || 0;
        inputStartTop = parseFloat(textInput.style.top) || 0;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onPointerMove = (e) => {
      if (!isDragging) return;
      const canvasRect = plugin.drawCanvas.getBoundingClientRect();
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const scaleX = plugin.width / canvasRect.width;
      const scaleY = plugin.height / canvasRect.height;
      let newLeft = inputStartLeft + dx * scaleX;
      let newTop = inputStartTop + dy * scaleY;
      const limits = getBoundaryLimits();
      newLeft = Math.max(limits.minLeft, Math.min(newLeft, limits.maxLeft));
      newTop = Math.max(limits.minTop, Math.min(newTop, limits.maxTop));
      textInput.style.left = newLeft + 'px';
      textInput.style.top = newTop + 'px';
      if (plugin.pendingTextCoords) {
        const offsetX = plugin.TEXT_INPUT_OFFSET?.x || -10;
        const offsetY = plugin.TEXT_INPUT_OFFSET?.y || -16;
        plugin.pendingTextCoords = {
          x: newLeft - offsetX,
          y: newTop - offsetY
        };
      }
    };
    const onPointerUp = () => {
      isDragging = false;
    };
    if (canvasWrapper) {
      canvasWrapper.addEventListener('pointerdown', onPointerDown, true);
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    plugin._dragCleanup = () => {
      if (canvasWrapper) {
        canvasWrapper.removeEventListener('pointerdown', onPointerDown, true);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
    console.log('[工具栏] 已设置 textarea 拖拽边界监听');
  }
  // ==================== 更新工具栏按钮状态 ====================
  function updateToolbarButtonsState(enabled) {
    const buttons = [penBtn, arrowBtn, rectBtn, textBtn, eraserBtn];
    buttons.forEach(btn => {
      if (btn) {
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.5';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
      }
    });
  }
  // ==================== 更新工具栏高亮 ====================
  function updateToolbarHighlight(tool) {
    const buttons = [penBtn, arrowBtn, rectBtn, textBtn, eraserBtn];
    buttons.forEach(btn => btn?.classList.remove('active'));
    const toolMap = {
      'pen': penBtn,
      'arrow': arrowBtn,
      'rect': rectBtn,
      'text': textBtn,
      'eraser': eraserBtn
    };
    if (toolMap[tool]) toolMap[tool].classList.add('active');
  }

  function clearToolbarHighlight() {
    const buttons = [penBtn, arrowBtn, rectBtn, textBtn, eraserBtn];
    buttons.forEach(btn => btn?.classList.remove('active'));
    activeTool = null;
  }
  // ==================== 更新滑块范围 ====================
  function updateSliderRange(toolName) {
    if (!strokeWidthSlider) return;
    const valueBadge = getValueBadge();
    if (toolName === 'text') {
      strokeWidthSlider.min = 8;
      strokeWidthSlider.max = 32;
      strokeWidthSlider.step = 1;
      strokeWidthSlider.value = plugin?.getFontSize() || 16;
      if (valueBadge) valueBadge.innerText = strokeWidthSlider.value + 'px';
    } else if (toolName === 'eraser') {
      strokeWidthSlider.min = 5;
      strokeWidthSlider.max = 30;
      strokeWidthSlider.step = 1;
      strokeWidthSlider.value = plugin?.getSize() || 10;
      if (valueBadge) valueBadge.innerText = strokeWidthSlider.value + 'px';
    } else {
      strokeWidthSlider.min = 1;
      strokeWidthSlider.max = 12;
      strokeWidthSlider.step = 0.5;
      strokeWidthSlider.value = plugin?.getSize() || 4;
      if (valueBadge) valueBadge.innerText = strokeWidthSlider.value + 'px';
    }
  }
  function syncSliderFromCanvas({ tool, value }) {
    if (!strokeWidthSlider || !Number.isFinite(value) || tool !== activeTool) return;
    if (tool === 'eraser') eraserSize = value;
    if (tool === 'text') {
      strokeWidthSlider.min = 8;
      strokeWidthSlider.max = 32;
      strokeWidthSlider.step = 1;
    } else if (tool === 'eraser') {
      strokeWidthSlider.min = 5;
      strokeWidthSlider.max = 30;
      strokeWidthSlider.step = 1;
    } else {
      strokeWidthSlider.min = 1;
      strokeWidthSlider.max = 12;
      strokeWidthSlider.step = 0.5;
    }
    strokeWidthSlider.value = String(value);
    const valueBadge = getValueBadge();
    if (valueBadge) valueBadge.innerText = `${value}px`;
  }
  // ==================== 禁用/启用工具栏标注 ====================
  function disablePluginAnnotation() {
    if (!plugin) return;
    isPluginEnabled = false;
    plugin._notifyImageHoverChange?.(false);
    plugin._hideSizeCursor?.();
    plugin._hideToolCursor?.();
    if (plugin.drawCanvas) {
      plugin.drawCanvas.style.pointerEvents = 'none';
      plugin.drawCanvas.style.touchAction = 'auto';
    }
    clearToolbarHighlight();
    updateToolbarButtonsState(true);
    window.inspectionTool?.refreshRulerInteractionState?.();
    console.log('[工具栏] 标注已禁用');
  }

  function enablePluginAnnotation(toolName) {
    if (!plugin) {
      initPlugin();
      if (!plugin) return;
    }
    isPluginEnabled = true;
    window.inspectionTool?.refreshRulerInteractionState?.();
    activeTool = toolName;
    if (plugin.drawCanvas) {
      plugin.drawCanvas.style.pointerEvents = 'auto';
      plugin.drawCanvas.style.touchAction = 'none';
      plugin.drawCanvas.style.zIndex = '10';
    }
    plugin.setTool(toolName);
    if (toolName === 'eraser') {
      plugin.setSize(eraserSize);
    }
    updateToolbarHighlight(toolName);
    updateSliderRange(toolName);
    if (pendingPluginAnnotations && pendingPluginAnnotations.length > 0) {
      console.log('[启用工具] 检测到待恢复标注，立即渲染');
      plugin.loadAnnotations(pendingPluginAnnotations);
      plugin.render();
      pendingPluginAnnotations = null;
    }
    console.log('[工具栏] 已启用，当前工具:', toolName);
  }
  // ==================== 初始化插件 ====================
  function initPlugin() {
    // 重新获取元素
    canvasWrapper = document.getElementById('canvas-wrapper');
    pluginCanvas = document.getElementById('plugin-canvas');
    if (!canvasWrapper || !pluginCanvas) {
      console.error('[工具栏] 找不到必要元素: canvas-wrapper 或 plugin-canvas');
      return false;
    }
    const currentColor = colorInput?.value || '#ff4d4f';
    const currentSize = strokeWidthSlider ? parseFloat(strokeWidthSlider.value) : 2;
    const inspectionTool = window.inspectionTool;
    const initialSurface = getComparisonSurfaceSize();
    let contentWidth = initialSurface.width;
    let contentHeight = initialSurface.height;
    try {
      let handleCanvas = document.getElementById('plugin-handle-canvas');
      if (!handleCanvas) {
        handleCanvas = document.createElement('canvas');
        handleCanvas.id = 'plugin-handle-canvas';
        handleCanvas.style.position = 'absolute';
        handleCanvas.style.top = '0';
        handleCanvas.style.left = '0';
        handleCanvas.style.width = contentWidth + 'px';
        handleCanvas.style.height = contentHeight + 'px';
        handleCanvas.style.pointerEvents = 'none';
        handleCanvas.style.zIndex = '11';
        canvasWrapper.appendChild(handleCanvas);
      }
      plugin = new SmartAnnotation({
        container: canvasWrapper,
        existingDrawCanvas: pluginCanvas,
        existingBgCanvas: null,
        existingHandleCanvas: handleCanvas,
        width: contentWidth,
        height: contentHeight,
        defaultColor: currentColor,
        defaultSize: currentSize,
        defaultFontSize: 14,
        backgroundConfig: {
          mainText: '',
          subText: '',
          gridColor: 'transparent'
        }
      });
      if (plugin.drawCanvas) {
        plugin.drawCanvas.style.position = 'absolute';
        plugin.drawCanvas.style.top = '0';
        plugin.drawCanvas.style.left = '0';
        plugin.drawCanvas.style.width = contentWidth + 'px';
        plugin.drawCanvas.style.height = contentHeight + 'px';
        plugin.drawCanvas.style.zIndex = '10';
        plugin.drawCanvas.style.pointerEvents = 'none';
        plugin.drawCanvas.style.touchAction = 'auto';
      }
      if (plugin.handleCanvas) {
        plugin.handleCanvas.style.zIndex = '11';
        plugin.handleCanvas.style.pointerEvents = 'none';
      }
      overridePluginCoordinateSystem();
      overrideTextRenderMethod();
      setTimeout(() => {
        setupTextareaDragBoundary();
      }, 100);
      // 插件回调：同步标注到主程序
      plugin.setOnUpdate((count) => {
        console.log('[工具栏] 批注数量:', count);
        const inspectionTool = window.inspectionTool;
        if (inspectionTool && inspectionTool.state && plugin) {
          const pluginAnnotations = plugin.getAnnotations();
          inspectionTool.state.pluginAnnotations = pluginAnnotations;
          if (inspectionTool.markAsUnsaved) {
            inspectionTool.markAsUnsaved();
          }
          console.log('[工具栏] 已同步插件标注到主程序:', pluginAnnotations.length, '个');
        }
      });
      plugin.setOnSizeChange(syncSliderFromCanvas);
      plugin.setOnImageHoverChange((hovered) => {
        window.inspectionTool?.setImageBoundaryHover?.(hovered);
      });
      plugin.setRestrictStartToImageBounds(true);
      // 同步图片边界
      function syncImageBounds() {
        if (!plugin) return;
        const inspectionTool = window.inspectionTool;
        if (inspectionTool && inspectionTool.state) {
          const newBounds = {
            x: inspectionTool.state.canvasOffsetX || 0,
            y: inspectionTool.state.canvasOffsetY || 0,
            width: inspectionTool.state.imageWidth || 0,
            height: inspectionTool.state.imageHeight || 0
          };
          const oldBounds = plugin.imageBounds || {
            x: 0,
            y: 0,
            width: 0,
            height: 0
          };
          let scale = 1;
          if (oldBounds.width > 0 && newBounds.width > 0 && oldBounds.width !== newBounds.width) {
            scale = newBounds.width / oldBounds.width;
          }
          if (scale !== 1) {
            const annotations = plugin.getAnnotations();
            if (annotations.length > 0) {
              const scaledAnnotations = annotations.map(ann => {
                const newAnn = JSON.parse(JSON.stringify(ann));
                if (ann.type === 'pen' && ann.points) {
                  newAnn.points = ann.points.map(p => ({
                    x: p.x * scale,
                    y: p.y * scale
                  }));
                } else if (ann.type === 'arrow') {
                  newAnn.start = {
                    x: ann.start.x * scale,
                    y: ann.start.y * scale
                  };
                  newAnn.end = {
                    x: ann.end.x * scale,
                    y: ann.end.y * scale
                  };
                } else if (ann.type === 'rect') {
                  newAnn.start = {
                    x: ann.start.x * scale,
                    y: ann.start.y * scale
                  };
                  newAnn.end = {
                    x: ann.end.x * scale,
                    y: ann.end.y * scale
                  };
                } else if (ann.type === 'text' && ann.position) {
                  newAnn.position = {
                    x: ann.position.x * scale,
                    y: ann.position.y * scale
                  };
                  if (ann.fontSize) newAnn.fontSize = ann.fontSize * scale;
                }
                return newAnn;
              });
              plugin.loadAnnotations(scaledAnnotations);
            }
          }
          const surface = getComparisonSurfaceSize(newBounds);
          const contentWidth = surface.width;
          const contentHeight = surface.height;
          if (plugin.width !== contentWidth || plugin.height !== contentHeight) {
            plugin.width = contentWidth;
            plugin.height = contentHeight;
            const dpr = window.devicePixelRatio || 1;
            plugin.drawCanvas.style.width = contentWidth + 'px';
            plugin.drawCanvas.style.height = contentHeight + 'px';
            plugin.drawCanvas.width = contentWidth * dpr;
            plugin.drawCanvas.height = contentHeight * dpr;
            const ctx = plugin.drawCanvas.getContext('2d');
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (plugin.handleCanvas) {
              plugin.handleCanvas.style.width = contentWidth + 'px';
              plugin.handleCanvas.style.height = contentHeight + 'px';
              plugin.handleCanvas.width = contentWidth * dpr;
              plugin.handleCanvas.height = contentHeight * dpr;
              const handleCtx = plugin.handleCanvas.getContext('2d');
              if (handleCtx) handleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
          }
          if (plugin.setImageBounds) plugin.setImageBounds(newBounds);
          if (plugin.setRestrictStartToImageBounds) {
            plugin.setRestrictStartToImageBounds(true);
          }
          plugin.render();
        }
      }
      plugin._syncImageBounds = syncImageBounds;
      const resizeObserver = new ResizeObserver(() => {
        if (!plugin || !plugin.drawCanvas) return;
        syncImageBounds();
      });
      resizeObserver.observe(canvasWrapper);
      plugin._resizeObserver = resizeObserver;
      if (inspectionTool) {
        const originalUpdateComparison = inspectionTool.updateComparison;
        if (originalUpdateComparison) {
          inspectionTool.updateComparison = function () {
            originalUpdateComparison.apply(this, arguments);
            syncImageBounds();
            requestAnimationFrame(() => requestAnimationFrame(syncImageBounds));
          };
        }
      }
      const zoomBtns = ['zoom-in', 'zoom-out', 'reset-zoom'];
      zoomBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.addEventListener('click', () => {
            setTimeout(() => syncImageBounds(), 30);
            setTimeout(() => syncImageBounds(), 80);
            setTimeout(() => syncImageBounds(), 150);
            setTimeout(() => syncImageBounds(), 300);
          });
        }
      });
      window.addEventListener('resize', () => {
        setTimeout(syncImageBounds, 100);
      });
      const startBtn = document.getElementById('start-inspection');
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          setTimeout(syncImageBounds, 100);
        });
      }
      setTimeout(syncImageBounds, 200);
      setTimeout(() => {
        if (pendingPluginAnnotations && pendingPluginAnnotations.length > 0) {
          console.log('[初始化] 检测到待恢复标注数据:', pendingPluginAnnotations.length, '个');
          if (window.loadPluginAnnotations) {
            window.loadPluginAnnotations(pendingPluginAnnotations);
          }
        }
      }, 400);
      console.log('[工具栏] 插件初始化完成');
      return true;
    } catch (error) {
      console.error('[工具栏] 插件初始化失败:', error);
      return false;
    }
  }
  // ==================== 监听画布尺寸变化 ====================
  function observeCanvasResize() {
    if (!canvasWrapper) return;
    if (plugin?._resizeObserver) {
      plugin._syncImageBounds?.();
      return;
    }
    let resizeTimeout = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        plugin?._syncImageBounds?.();
      }, 150);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvasWrapper);
    window.addEventListener('resize', handleResize);
    if (plugin) {
      plugin._resizeObserver = resizeObserver;
    }
  }
  // ==================== 绑定UI事件 ====================
  function bindUIEvents() {
    const handleToolClick = (toolName, btnElement) => {
      const isSameTool = (activeTool === toolName && isPluginEnabled);
      if (isSameTool) {
        disablePluginAnnotation();
        if (btnElement) btnElement.classList.remove('active');
        activeTool = null;
        console.log('[工具栏] 已取消选中:', toolName);
        return;
      }
      if (isExistingAnnotationEnabled && annotationToggle) {
        annotationToggle.checked = false;
        if (window.inspectionTool && window.inspectionTool.toggleAnnotationMode) {
          window.inspectionTool.toggleAnnotationMode();
        }
        isExistingAnnotationEnabled = false;
      }
      enablePluginAnnotation(toolName);
    };
    if (penBtn) penBtn.addEventListener('click', () => handleToolClick('pen', penBtn));
    if (arrowBtn) arrowBtn.addEventListener('click', () => handleToolClick('arrow', arrowBtn));
    if (rectBtn) rectBtn.addEventListener('click', () => handleToolClick('rect', rectBtn));
    if (textBtn) textBtn.addEventListener('click', () => handleToolClick('text', textBtn));
    if (eraserBtn) eraserBtn.addEventListener('click', () => handleToolClick('eraser', eraserBtn));
    if (strokeWidthSlider) {
      strokeWidthSlider.addEventListener('input', function () {
        const valueBadge = getValueBadge();
        if (valueBadge) valueBadge.innerText = this.value + 'px';
        if (!plugin || !isPluginEnabled) return;
        const newSize = parseFloat(strokeWidthSlider.value);
        const newColor = colorInput?.value || '#ff4d4f';
        if (activeTool === 'text') plugin.setFontSize(newSize);
        else {
          plugin.setSize(newSize);
          if (activeTool === 'eraser') eraserSize = plugin.getSize();
        }
        plugin.setColor(newColor);
        if (colorPreview) colorPreview.style.backgroundColor = newColor;
      });
    }
    if (colorInput) {
      colorInput.addEventListener('input', function () {
        if (colorPreview) colorPreview.style.backgroundColor = this.value;
        if (!plugin || !isPluginEnabled) return;
        const newSize = strokeWidthSlider ? parseFloat(strokeWidthSlider.value) : 4;
        const newColor = colorInput?.value || '#ff4d4f';
        if (activeTool === 'text') plugin.setFontSize(newSize);
        else plugin.setSize(newSize);
        plugin.setColor(newColor);
      });
    }
    if (annotationToggle) {
      annotationToggle.addEventListener('change', function (e) {
        isExistingAnnotationEnabled = e.target.checked;
        if (isExistingAnnotationEnabled) {
          if (isPluginEnabled) disablePluginAnnotation();
          updateToolbarButtonsState(false);
        } else {
          updateToolbarButtonsState(true);
        }
      });
    }
    const annotationsList = document.getElementById('annotations-list');
    if (annotationsList) {
      annotationsList.addEventListener('focusin', function (e) {
        if (e.target.classList && e.target.classList.contains('annotation-desc')) {
          if (isPluginEnabled) disablePluginAnnotation();
          clearToolbarHighlight();
        }
      });
    }
  }
  // ==================== 监听开始视检 ====================
  function bindInspectionEvents() {
    const startInspectionBtn = document.getElementById('start-inspection');
    if (startInspectionBtn) {
      const initWhenReady = () => {
        if (!startInspectionBtn.disabled && !plugin) {
          initPlugin();
          observeCanvasResize();
        }
      };
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
            if (!startInspectionBtn.disabled && !plugin) setTimeout(initWhenReady, 100);
          }
        });
      });
      observer.observe(startInspectionBtn, {
        attributes: true
      });
      if (!startInspectionBtn.disabled && !plugin) setTimeout(initWhenReady, 100);
    }
  }
  // ==================== 重置事件 ====================
  function bindResetEvents() {
    const resetBtn = document.getElementById('reset-all');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (plugin && isPluginEnabled) plugin.clear();
        isPluginEnabled = false;
        isExistingAnnotationEnabled = false;
        clearToolbarHighlight();
        updateToolbarButtonsState(true);
        if (plugin && plugin.drawCanvas) plugin.drawCanvas.style.pointerEvents = 'none';
        if (plugin && plugin._dragCleanup) plugin._dragCleanup();
        if (plugin && plugin._resizeObserver) {
          plugin._resizeObserver.disconnect();
          plugin._resizeObserver = null;
        }
      });
    }
  }
  // ==================== 暴露全局API ====================
  window.getPluginAnnotations = () => {
    if (plugin && plugin.getAnnotations) {
      const annotations = plugin.getAnnotations();
      const inspectionTool = window.inspectionTool;
      if (inspectionTool && inspectionTool.state) {
        inspectionTool.state.pluginAnnotations = annotations;
      }
      return annotations;
    }
    const inspectionTool = window.inspectionTool;
    if (inspectionTool && inspectionTool.state && inspectionTool.state.pluginAnnotations) {
      return inspectionTool.state.pluginAnnotations;
    }
    return [];
  };
  window.loadPluginAnnotations = (annotations, forceRender = true) => {
    const nextAnnotations = Array.isArray(annotations) ? annotations : [];
    const pluginInstance = window.drawingToolbar?.getInstance();
    if (!pluginInstance || !pluginInstance.drawCanvas) {
      pendingPluginAnnotations = nextAnnotations;
      if (nextAnnotations.length > 0) {
        console.warn('[loadPluginAnnotations] 插件实例未完全就绪，加入待恢复队列');
        waitForPluginAndRestore();
      }
      return false;
    }
    pluginInstance.drawCanvas.style.pointerEvents = 'auto';
    pluginInstance.drawCanvas.style.zIndex = '10';
    pluginInstance.loadAnnotations(nextAnnotations);
    pluginInstance.render();
    console.log('[loadPluginAnnotations] ✅ 插件标注已替换:', nextAnnotations.length, '个');
    if (!isPluginEnabled) {
      setTimeout(() => {
        if (pluginInstance.drawCanvas && !isPluginEnabled) {
          pluginInstance.drawCanvas.style.pointerEvents = 'none';
        }
      }, 300);
    }
    pendingPluginAnnotations = null;
    return true;
  };

  function waitForPluginAndRestore() {
    let attempts = 0;
    const maxAttempts = 50;
    const checkInterval = setInterval(() => {
      attempts++;
      const pluginInstance = window.drawingToolbar?.getInstance();
      if (pluginInstance && pluginInstance.drawCanvas && pluginInstance.drawCanvas.width > 0) {
        clearInterval(checkInterval);
        console.log('[等待插件] 插件已就绪（尝试次数:', attempts, '），恢复标注数据');
        if (pendingPluginAnnotations && pendingPluginAnnotations.length > 0) {
          const annotations = pendingPluginAnnotations;
          pendingPluginAnnotations = null;
          pluginInstance.drawCanvas.style.pointerEvents = 'auto';
          pluginInstance.drawCanvas.style.zIndex = '10';
          pluginInstance.loadAnnotations(annotations);
          pluginInstance.render();
          console.log('[等待插件] ✅ 已恢复插件标注:', annotations.length, '个');
          if (!isPluginEnabled) {
            setTimeout(() => {
              if (pluginInstance.drawCanvas && !isPluginEnabled) {
                pluginInstance.drawCanvas.style.pointerEvents = 'none';
              }
            }, 300);
          }
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.error('[等待插件] ❌ 超时，插件未就绪，标注数据保留在队列中');
      }
    }, 100);
  }
  window.getPluginCanvasImage = () => plugin?.drawCanvas?.toDataURL('image/png') || null;
  window.clearToolbarHighlight = clearToolbarHighlight;
  window.updateToolbarButtonsState = updateToolbarButtonsState;
  window.drawingToolbar = {
    getActiveTool: () => isPluginEnabled ? activeTool : null,
    getStrokeWidth: () => strokeWidthSlider ? parseFloat(strokeWidthSlider.value) : 4,
    getColor: () => colorInput?.value || '#ff4d4f',
    isEnabled: () => isPluginEnabled,
    enable: (toolName) => {
      if (toolName) {
        const toolMap = {
          pen: penBtn,
          arrow: arrowBtn,
          rect: rectBtn,
          text: textBtn,
          eraser: eraserBtn
        };
        toolMap[toolName]?.click();
      } else if (!isPluginEnabled) enablePluginAnnotation('pen');
    },
    disable: () => disablePluginAnnotation(),
    setActiveTool: (toolName) => {
      const toolMap = {
        pen: penBtn,
        arrow: arrowBtn,
        rect: rectBtn,
        text: textBtn,
        eraser: eraserBtn
      };
      toolMap[toolName]?.click();
    },
    clear: () => {
      if (plugin && isPluginEnabled) plugin.clear();
    },
    getInstance: () => plugin,
    getAnnotations: () => plugin?.getAnnotations() || [],
    loadAnnotations: (annotations) => {
      if (plugin) plugin.loadAnnotations(annotations);
    }
  };
  // ==================== 初始化 ====================
  function init() {
    // 获取所有必要的 DOM 元素
    penBtn = document.getElementById('tool-pen');
    arrowBtn = document.getElementById('tool-arrow');
    rectBtn = document.getElementById('tool-rect');
    textBtn = document.getElementById('tool-text');
    eraserBtn = document.getElementById('tool-eraser');
    strokeWidthSlider = document.getElementById('stroke-width-slider');
    colorInput = document.getElementById('stroke-color-input');
    colorPreview = document.getElementById('color-preview');
    annotationToggle = document.getElementById('annotation-toggle');
    canvasWrapper = document.getElementById('canvas-wrapper');
    pluginCanvas = document.getElementById('plugin-canvas');
    // 检查必要元素是否存在
    if (!canvasWrapper || !pluginCanvas) {
      console.warn('[工具栏] 必要元素未就绪(canvas-wrapper或plugin-canvas)，等待 DOMContentLoaded');
      return;
    }
    bindUIEvents();
    bindInspectionEvents();
    bindResetEvents();
    isPluginEnabled = false;
    isExistingAnnotationEnabled = false;
    updateToolbarButtonsState(true);
    getValueBadge();
    console.log('[工具栏] 接入完成');
  }
  // 确保 DOM 加载完成后再初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
