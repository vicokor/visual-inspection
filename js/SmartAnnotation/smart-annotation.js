/**
 * SmartAnnotation - Canvas标注工具插件
 * 版本: v5.2 (支持外部容器模式)
 * 功能: 画笔、箭头、矩形、文字、橡皮擦，支持撤销、清空、导出图片
 * 依赖: 无外部依赖，纯原生JavaScript
 * 
 * 新增功能: 支持使用已有的canvas元素，不清空容器
 * 
 * 使用方法:
 *   // 方式1: 自动创建canvas
 *   const annotation = new SmartAnnotation({
 *     container: '#container',
 *     width: 900,
 *     height: 500
 *   });
 * 
 *   // 方式2: 使用已有canvas
 *   const annotation = new SmartAnnotation({
 *     container: '#container',
 *     existingDrawCanvas: document.getElementById('my-draw-canvas'),
 *     existingBgCanvas: document.getElementById('my-bg-canvas'),
 *     width: 900,
 *     height: 500
 *   });
 */
(function (global) {
  'use strict';
  // ==================== 插件主类 ====================
  class SmartAnnotation {
    /**
     * 构造函数
     * @param {Object} options 配置项
     * @param {string|HTMLElement} options.container - 容器元素或选择器（必需）
     * @param {number} [options.width=900] - 画布宽度（逻辑像素）
     * @param {number} [options.height=500] - 画布高度（逻辑像素）
     * @param {string} [options.defaultColor='#3b82f6'] - 默认颜色
     * @param {number} [options.defaultSize=3] - 默认线条粗细/擦除半径
     * @param {number} [options.defaultFontSize=14] - 默认文字大小
     * @param {Object} [options.backgroundConfig] - 背景配置（可选）
     * @param {HTMLCanvasElement} [options.existingDrawCanvas] - 已有的绘制画布（可选）
     * @param {HTMLCanvasElement} [options.existingBgCanvas] - 已有的背景画布（可选）
     * @param {HTMLCanvasElement} [options.existingHandleCanvas] - 已有的手柄画布（可选）
     */
    constructor(options) {
      if (!options || !options.container) {
        throw new Error('SmartAnnotation: 必须指定container容器');
      }
      // 获取容器
      this.container = typeof options.container === 'string' ?
        document.querySelector(options.container) :
        options.container;
      if (!this.container) {
        throw new Error('SmartAnnotation: 找不到容器元素');
      }
      // 配置参数
      this.width = options.width || 900;
      this.height = options.height || 500;
      this.defaultColor = options.defaultColor || '#3b82f6';
      this.defaultSize = options.defaultSize || 2;
      this.defaultFontSize = options.defaultFontSize || 14;
      // 外部容器支持-外部传入的画布（如果有）
      this.existingDrawCanvas = options.existingDrawCanvas || null;
      this.existingBgCanvas = options.existingBgCanvas || null;
      this.existingHandleCanvas = options.existingHandleCanvas || null;
      // 标记是否使用外部容器模式
      this.useExternalCanvas = !!(this.existingDrawCanvas);
      // 背景配置
      this.backgroundConfig = {
        mainText: options.backgroundConfig?.text || '智能批注演示',
        subText: options.backgroundConfig?.subText || '箭头/矩形：拖动时实时预览',
        gridColor: options.backgroundConfig?.gridColor || '#edeff2',
        ...options.backgroundConfig
      };
      // 运行时状态
      this.annotations = []; // 所有批注数据
      this.currentTool = 'pen'; // 当前工具: pen, arrow, rect, text, eraser
      this.currentColor = this.defaultColor;
      this.currentSize = this.defaultSize;
      this.currentFontSize = this.defaultFontSize;
      // 绘制临时状态
      this.isDrawing = false;
      this.startX = 0;
      this.startY = 0;
      this.tempPoints = [];
      this.selectedArrowIndex = -1;
      this.dragHandle = null;
      this.isDraggingHandle = false;
      // 文字工具状态
      this.pendingTextCoords = null;
      this.isDraggingInput = false;
      this.dragInputOffsetX = 0;
      this.dragInputOffsetY = 0;
      this.currentHoveredTextInfo = null;
      // 橡皮擦状态
      this.isErasing = false;
      this.lastErasePoint = null;
      // 动画状态
      this.animationScale = 1;
      this.targetScale = 1;
      this.animating = false;
      // 设备像素比
      this.pixelRatio = window.devicePixelRatio || 1;
      // 输入框偏移量
      this.TEXT_INPUT_OFFSET = {
        x: -10,
        y: -16
      };
      this.DEBUG_SHOW_TEXT_BG = false;
      // 回调函数
      this.onUpdate = null; // 批注数量变化时回调
      this.onToolChange = null; // 工具切换时回调
      this.onSizeChange = null; // Cmd + 滚轮修改尺寸时回调
      this.onImageHoverChange = null; // 进入/离开可标注图片范围时回调
      this._lastImageHoverState = false;
      this._wheelAccumulator = 0;
      this._wheelLastAt = 0;
      this._wheelTool = null;
      this._sizeCursorTimer = null;
      // 初始化DOM
      this._initDOM();
      this._createSizeCursor();
      // 绑定事件
      this._bindEvents();
      // 初始化背景和渲染
      this._initBackground();
      this.render();
      // 更新UI状态
      this._updateUIState();
      // 新增：图片边界（相对于画布的位置）
      this.imageBounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      // 左右对比模式启用：只允许从开发图边界内开始批注。
      this.restrictStartToImageBounds = false;
    }
    // ==================== 私有方法 ====================
    /**
     * 初始化DOM结构
     * 支持使用外部传入的canvas
     */
    _initDOM() {
      // 如果使用外部canvas模式，不清理容器，直接使用传入的画布
      if (this.useExternalCanvas) {
        // 使用外部传入的画布
        this.drawCanvas = this.existingDrawCanvas;
        this.bgCanvas = this.existingBgCanvas;
        this.handleCanvas = this.existingHandleCanvas;
        // 确保画布有正确的样式
        if (this.drawCanvas) {
          this.drawCanvas.style.position = 'absolute';
          this.drawCanvas.style.top = '0';
          this.drawCanvas.style.left = '0';
          this.drawCanvas.style.pointerEvents = 'auto';
          this.drawCanvas.style.cursor = 'crosshair';
        }
        if (this.bgCanvas) {
          this.bgCanvas.style.position = 'absolute';
          this.bgCanvas.style.top = '0';
          this.bgCanvas.style.left = '0';
          this.bgCanvas.style.pointerEvents = 'none';
        }
        if (this.handleCanvas) {
          this.handleCanvas.style.position = 'absolute';
          this.handleCanvas.style.top = '0';
          this.handleCanvas.style.left = '0';
          this.handleCanvas.style.pointerEvents = 'none';
        }
        // 设置画布尺寸
        [this.bgCanvas, this.drawCanvas, this.handleCanvas].forEach(canvas => {
          if (canvas) {
            canvas.style.width = this.width + 'px';
            canvas.style.height = this.height + 'px';
            canvas.width = this.width * this.pixelRatio;
            canvas.height = this.height * this.pixelRatio;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.scale(this.pixelRatio, this.pixelRatio);
            }
          }
        });
        // 获取上下文
        if (this.bgCanvas) this.bgCtx = this.bgCanvas.getContext('2d');
        if (this.drawCanvas) this.drawCtx = this.drawCanvas.getContext('2d');
        if (this.handleCanvas) this.handleCtx = this.handleCanvas.getContext('2d');
        // 创建文字输入框（始终需要）
        this._createTextInput();
        return;
      }
      // 原有逻辑：清空容器并创建画布
      this.container.innerHTML = '';
      this.container.style.position = 'relative';
      this.container.style.width = this.width + 'px';
      this.container.style.height = this.height + 'px';
      this.container.style.overflow = 'hidden';
      // 创建三个画布层
      this.bgCanvas = document.createElement('canvas');
      this.drawCanvas = document.createElement('canvas');
      this.handleCanvas = document.createElement('canvas');
      [this.bgCanvas, this.drawCanvas, this.handleCanvas].forEach(canvas => {
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = this.width + 'px';
        canvas.style.height = this.height + 'px';
        canvas.width = this.width * this.pixelRatio;
        canvas.height = this.height * this.pixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.scale(this.pixelRatio, this.pixelRatio);
        this.container.appendChild(canvas);
      });
      this.bgCanvas.style.zIndex = '1';
      this.drawCanvas.style.zIndex = '2';
      this.drawCanvas.style.cursor = 'crosshair';
      this.handleCanvas.style.zIndex = '3';
      this.handleCanvas.style.pointerEvents = 'none';
      this.bgCtx = this.bgCanvas.getContext('2d');
      this.drawCtx = this.drawCanvas.getContext('2d');
      this.handleCtx = this.handleCanvas.getContext('2d');
      this._createTextInput();
    }
    /**
     * 创建文字输入框
     */
    _createTextInput() {
      this.textInput = document.createElement('textarea');
      this.textInput.className = 'smart-annotation-text-input';
      this.textInput.setAttribute('rows', '1');
      this.textInput.style.cssText = `
                position: absolute;
                z-index: 10;
                background: rgba(255, 255, 255, 0.98);
                border: 2px dashed #3b82f6;
                border-radius: 6px;
                padding: 4px 8px;
                font-family: system-ui, sans-serif;
                outline: none;
                resize: none;
                white-space: nowrap;
                overflow-x: auto;
                overflow-y: hidden;
                word-wrap: break-word;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                display: none;
                cursor: move;
                line-height: 1.2;
                font-size: 16px;
                box-sizing: border-box;
            `;
      this.container.appendChild(this.textInput);
    }
    /**
     * 绑定事件
     */
    _bindEvents() {
      // 画布事件
      this._boundPointerDown = (e) => {
        if (e.isPrimary === false) return;
        this._handleMouseDown(e);
        if (this.isDrawing || this.isErasing || this.isDraggingHandle) {
          try {
            this.drawCanvas.setPointerCapture(e.pointerId);
          } catch (_) {}
        }
      };
      this._boundPointerMove = (e) => {
        if (e.isPrimary === false) return;
        this._handleMouseMove(e);
      };
      this._boundPointerUp = (e) => {
        if (e.isPrimary === false) return;
        this._handleMouseUp(e);
        if (this.drawCanvas.hasPointerCapture?.(e.pointerId)) {
          this.drawCanvas.releasePointerCapture(e.pointerId);
        }
      };
      this._boundPointerCancel = (e) => {
        this.isDrawing = false;
        this.isErasing = false;
        this.isDraggingHandle = false;
        this.dragHandle = null;
        this.lastErasePoint = null;
        this.tempPoints = [];
        if (this.drawCanvas.hasPointerCapture?.(e.pointerId)) {
          this.drawCanvas.releasePointerCapture(e.pointerId);
        }
        this.render();
      };
      this._boundWheel = this._handleWheel.bind(this);
      this._boundDoubleClick = this._handleDoubleClick.bind(this);
      this._boundClick = this._handleClick.bind(this);
      this._boundInputWheel = this._handleInputWheel.bind(this);
      this._boundInput = this._adjustTextInputSize.bind(this);
      this._boundInputKeydown = this._handleInputKeydown.bind(this);
      this._boundInputPointerDown = this._handleInputMouseDown.bind(this);
      this._boundGlobalPointerMove = this._handleGlobalMouseMove.bind(this);
      this._boundGlobalPointerUp = this._handleGlobalMouseUp.bind(this);
      this._boundPointerLeave = () => {
        this._hideSizeCursor();
        this._hideToolCursor();
        this.drawCanvas.style.cursor = 'default';
        this._notifyImageHoverChange(false);
      };
      this._boundGlobalKeyUp = (e) => {
        if (e.key === 'Meta') this._hideSizeCursor();
      };
      this._boundGlobalBlur = () => {
        this._hideSizeCursor();
        this._hideToolCursor();
      };
      this.drawCanvas.addEventListener('pointerdown', this._boundPointerDown);
      this.drawCanvas.addEventListener('pointermove', this._boundPointerMove);
      this.drawCanvas.addEventListener('pointerup', this._boundPointerUp);
      this.drawCanvas.addEventListener('pointercancel', this._boundPointerCancel);
      this.drawCanvas.addEventListener('wheel', this._boundWheel, { passive: false });
      this.drawCanvas.addEventListener('pointerleave', this._boundPointerLeave);
      this.drawCanvas.addEventListener('dblclick', this._boundDoubleClick);
      this.drawCanvas.addEventListener('click', this._boundClick);
      // 查找实际滚动容器（canvas-wrapper）
      let scrollContainer = null;
      let parent = this.drawCanvas.parentElement;
      while (parent && parent !== this.container) {
        if (parent.scrollWidth > parent.clientWidth || parent.scrollHeight > parent.clientHeight) {
          scrollContainer = parent;
          break;
        }
        parent = parent.parentElement;
      }
      // 添加滚动监听
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', () => {
          // 如果有正在编辑的文字，更新输入框位置
          if (this.pendingTextCoords) {
            const css = this._logicalToCss(this.pendingTextCoords.x, this.pendingTextCoords.y);
            this.textInput.style.left = (css.x + this.TEXT_INPUT_OFFSET.x) + 'px';
            this.textInput.style.top = (css.y + this.TEXT_INPUT_OFFSET.y) + 'px';
          }
          this.render();
          this._drawHandles();
        });
      }
      // 输入框事件
      this.textInput.addEventListener('wheel', this._boundInputWheel, { passive: false });
      this.textInput.addEventListener('input', this._boundInput);
      this.textInput.addEventListener('blur', () => this._commitText());
      this.textInput.addEventListener('keydown', this._boundInputKeydown);
      this.textInput.addEventListener('pointerdown', this._boundInputPointerDown);
      // 全局拖拽事件
      document.addEventListener('pointermove', this._boundGlobalPointerMove);
      document.addEventListener('pointerup', this._boundGlobalPointerUp);
      document.addEventListener('pointercancel', this._boundGlobalPointerUp);
      document.addEventListener('keyup', this._boundGlobalKeyUp);
      window.addEventListener('blur', this._boundGlobalBlur);
    }

    _createSizeCursor() {
      if (!this.container) return;
      this.sizeCursor = document.createElement('div');
      this.sizeCursor.className = 'smart-annotation-size-cursor';
      this.sizeCursor.setAttribute('aria-hidden', 'true');
      this.sizeCursorDot = document.createElement('span');
      this.sizeCursorDot.className = 'smart-annotation-size-cursor-dot';
      this.sizeCursorLabel = document.createElement('span');
      this.sizeCursorLabel.className = 'smart-annotation-size-cursor-label';
      this.sizeCursor.appendChild(this.sizeCursorDot);
      this.sizeCursor.appendChild(this.sizeCursorLabel);
      document.body.appendChild(this.sizeCursor);

      this.toolCursor = document.createElement('div');
      this.toolCursor.className = 'smart-annotation-tool-cursor';
      this.toolCursor.setAttribute('aria-hidden', 'true');
      this.toolCursor.innerHTML = '<i class="icon pencil"></i>';
      document.body.appendChild(this.toolCursor);
    }

    _showSizeCursor(e, value, tool = this.currentTool, persist = false, showLabel = true) {
      if (!this.sizeCursor || !e || !['pen', 'eraser'].includes(tool)) return;
      this._hideToolCursor();
      // 自定义尺寸光标显示期间彻底隐藏浏览器原生光标，避免橡皮擦旁出现方块。
      this.drawCanvas.style.cursor = 'none';
      this.sizeCursor.style.left = `${e.clientX}px`;
      this.sizeCursor.style.top = `${e.clientY}px`;
      this.sizeCursor.style.setProperty('--size-cursor-color',
        tool === 'eraser' ? '#111111' : this.currentColor);
      // 仅光标视觉最小 3px，实际画笔尺寸仍保留 1px。
      this.sizeCursor.style.setProperty('--brush-dot-size', `${Math.max(3, value)}px`);
      this.sizeCursor.style.setProperty('--eraser-diameter', `${Math.max(4, value)}px`);
      // 使用组件专属状态类，避免与图标字体的 `.eraser::before` 规则冲突。
      this.sizeCursor.classList.toggle('cursor-pen', tool === 'pen');
      this.sizeCursor.classList.toggle('cursor-eraser', tool === 'eraser');
      this.sizeCursorLabel.textContent = `${tool === 'eraser' ? '橡皮擦' : '画笔'} ${value}px`;
      this.sizeCursor.classList.toggle('with-label', showLabel);
      this.sizeCursor.classList.add('visible');
      this.container.classList.add('size-cursor-active');
      if (this._sizeCursorTimer) clearTimeout(this._sizeCursorTimer);
      if (!persist) {
        this._sizeCursorTimer = setTimeout(() => this._hideSizeCursor(), 700);
      }
    }

    _hideSizeCursor() {
      if (this._sizeCursorTimer) clearTimeout(this._sizeCursorTimer);
      this._sizeCursorTimer = null;
      this.sizeCursor?.classList.remove('visible');
      this.container?.classList.remove('size-cursor-active');
    }

    _showToolCursor(e) {
      if (!this.toolCursor || !e) return;
      this._hideSizeCursor();
      this.toolCursor.style.left = `${e.clientX}px`;
      this.toolCursor.style.top = `${e.clientY}px`;
      this.toolCursor.style.setProperty('--tool-cursor-color', this.currentColor);
      this.toolCursor.classList.add('visible');
      this.container?.classList.add('tool-cursor-active');
    }

    _hideToolCursor() {
      this.toolCursor?.classList.remove('visible');
      this.container?.classList.remove('tool-cursor-active');
    }

    _consumeWheelSteps(e, toolKey) {
      const now = performance.now();
      if (this._wheelTool !== toolKey || now - this._wheelLastAt > 450) {
        this._wheelAccumulator = 0;
      }
      this._wheelTool = toolKey;
      this._wheelLastAt = now;
      const multiplier = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1);
      this._wheelAccumulator += e.deltaY * multiplier;
      const threshold = 80;
      let steps = Math.trunc(this._wheelAccumulator / threshold);
      steps = Math.max(-2, Math.min(2, steps));
      if (steps !== 0) this._wheelAccumulator -= steps * threshold;
      return -steps;
    }

    _notifySizeChange(tool, value) {
      if (this.onSizeChange) this.onSizeChange({ tool, value });
    }

    _isPointInsideImageBounds(x, y) {
      const bounds = this.imageBounds || { x: 0, y: 0, width: 0, height: 0 };
      return bounds.width > 0 && bounds.height > 0 &&
        x >= bounds.x && x <= bounds.x + bounds.width &&
        y >= bounds.y && y <= bounds.y + bounds.height;
    }

    _notifyImageHoverChange(hovered) {
      const next = !!hovered;
      if (this._lastImageHoverState === next) return;
      this._lastImageHoverState = next;
      if (this.onImageHoverChange) this.onImageHoverChange(next);
    }
    /**
     * 坐标转换：获取画布逻辑坐标
     */
    _getLogicalCoords(e) {
      const rect = this.drawCanvas.getBoundingClientRect();
      // 累加所有可滚动父容器的滚动偏移
      let scrollLeft = 0;
      let scrollTop = 0;
      let parent = this.drawCanvas.parentElement;
      while (parent && parent !== this.container) {
        if (parent.scrollWidth > parent.clientWidth || parent.scrollHeight > parent.clientHeight) {
          scrollLeft += parent.scrollLeft;
          scrollTop += parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      // 计算画布上的绝对坐标（包含滚动偏移）
      let x = e.clientX - rect.left + scrollLeft;
      let y = e.clientY - rect.top + scrollTop;
      // 边界限制（考虑画布实际尺寸）
      const maxX = Math.max(rect.width, this.drawCanvas.scrollWidth);
      const maxY = Math.max(rect.height, this.drawCanvas.scrollHeight);
      x = Math.min(maxX, Math.max(0, x));
      y = Math.min(maxY, Math.max(0, y));
      return {
        x,
        y
      };
    }
    /**
     * CSS坐标转逻辑坐标
     */
    _cssToLogical(cssX, cssY) {
      const rect = this.drawCanvas.getBoundingClientRect();
      // 累加所有可滚动父容器的滚动偏移
      let scrollLeft = 0;
      let scrollTop = 0;
      let parent = this.drawCanvas.parentElement;
      while (parent && parent !== this.container) {
        if (parent.scrollWidth > parent.clientWidth || parent.scrollHeight > parent.clientHeight) {
          scrollLeft += parent.scrollLeft;
          scrollTop += parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      const actualX = cssX + scrollLeft;
      const actualY = cssY + scrollTop;
      return {
        x: (actualX / rect.width) * this.width,
        y: (actualY / rect.height) * this.height
      };
    }
    /**
     * 逻辑坐标转CSS坐标
     */
    _logicalToCss(logicalX, logicalY) {
      const rect = this.drawCanvas.getBoundingClientRect();
      // 累加所有可滚动父容器的滚动偏移
      let scrollLeft = 0;
      let scrollTop = 0;
      let parent = this.drawCanvas.parentElement;
      while (parent && parent !== this.container) {
        if (parent.scrollWidth > parent.clientWidth || parent.scrollHeight > parent.clientHeight) {
          scrollLeft += parent.scrollLeft;
          scrollTop += parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      const cssX = (logicalX / this.width) * rect.width - scrollLeft;
      const cssY = (logicalY / this.height) * rect.height - scrollTop;
      return {
        x: cssX,
        y: cssY
      };
    }
    /**
     * 初始化背景
     */
    _initBackground() {
      // 如果使用外部canvas且没有背景画布，跳过背景绘制
      if (this.useExternalCanvas && !this.bgCanvas) {
        return;
      }
      this.bgCtx.fillStyle = '#ffffff';
      this.bgCtx.fillRect(0, 0, this.width, this.height);
      // 绘制网格
      this.bgCtx.strokeStyle = this.backgroundConfig.gridColor;
      this.bgCtx.lineWidth = 0.5;
      for (let i = 0; i < this.width; i += 25) {
        this.bgCtx.beginPath();
        this.bgCtx.moveTo(i, 0);
        this.bgCtx.lineTo(i, this.height);
        this.bgCtx.stroke();
      }
      for (let i = 0; i < this.height; i += 25) {
        this.bgCtx.beginPath();
        this.bgCtx.moveTo(0, i);
        this.bgCtx.lineTo(this.width, i);
        this.bgCtx.stroke();
      }
      // 绘制文字
      this.bgCtx.font = 'bold 26px system-ui, sans-serif';
      this.bgCtx.fillStyle = '#1e293b';
      this.bgCtx.fillText(this.backgroundConfig.mainText, 40, 80);
      this.bgCtx.font = '16px system-ui';
      this.bgCtx.fillStyle = '#475569';
      this.bgCtx.fillText(this.backgroundConfig.subText, 40, 130);
      this.bgCtx.fillText('文字工具：点击画布，输入框可拖拽，自动适应内容，滚轮调大小', 40, 170);
    }
    /**
     * 平滑画笔路径
     */
    _applyMovingAverage(points, windowSize = 3) {
      if (points.length < windowSize) return points;
      const smoothed = [];
      const halfWindow = Math.floor(windowSize / 2);
      for (let i = 0; i < points.length; i++) {
        let sumX = 0,
          sumY = 0,
          count = 0;
        for (let j = -halfWindow; j <= halfWindow; j++) {
          const idx = Math.min(points.length - 1, Math.max(0, i + j));
          sumX += points[idx].x;
          sumY += points[idx].y;
          count++;
        }
        smoothed.push({
          x: sumX / count,
          y: sumY / count
        });
      }
      return smoothed;
    }
    _smoothPoints(points) {
      if (points.length < 3) return points;
      const interpolated = [points[0]];
      for (let i = 1; i < points.length - 1; i++) {
        interpolated.push(points[i]);
        if (i < points.length - 2) {
          const dx = points[i + 1].x - points[i].x;
          const dy = points[i + 1].y - points[i].y;
          const distance = Math.hypot(dx, dy);
          if (distance > 8) {
            const step = 0.3;
            for (let t = 0.2; t < 1.0; t += step) {
              const x = points[i].x + dx * t;
              const y = points[i].y + dy * t;
              interpolated.push({
                x,
                y
              });
            }
          }
        }
      }
      interpolated.push(points[points.length - 1]);
      return this._applyMovingAverage(interpolated, 3);
    }
    /**
     * 绘制箭头
     */
    _drawArrow(from, to, color, width, ctx = this.drawCtx) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 5) return;
      const angle = Math.atan2(dy, dx);
      const arrowSize = Math.min(24, Math.max(10, width * 2.5));
      const shorten = arrowSize * 0.7;
      const endX = to.x - Math.cos(angle) * shorten;
      const endY = to.y - Math.sin(angle) * shorten;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      const angleOffset = 0.5;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - arrowSize * Math.cos(angle - angleOffset), to.y - arrowSize * Math.sin(angle - angleOffset));
      ctx.lineTo(to.x - arrowSize * Math.cos(angle + angleOffset), to.y - arrowSize * Math.sin(angle + angleOffset));
      ctx.closePath();
      ctx.fill();
    }
    /**
     * 绘制多行文字
     */
    _drawMultilineText(ctx, text, x, y, fontSize, color, lineHeight = 1.2, showBackground = false) {
      if (!text) return;
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
    }
    /**
     * 绘制箭头手柄
     */
    _drawHandles() {
      if (!this.handleCtx) return;
      // 使用实际画布尺寸，而不是 this.width
      const actualWidth = this.handleCanvas.clientWidth;
      const actualHeight = this.handleCanvas.clientHeight;
      this.handleCtx.clearRect(0, 0, actualWidth, actualHeight);
      if (this.selectedArrowIndex >= 0 && this.selectedArrowIndex < this.annotations.length) {
        const arrow = this.annotations[this.selectedArrowIndex];
        if (arrow.type === 'arrow') {
          const bounds = this.imageBounds || {
            x: 0,
            y: 0
          };
          // 将存储的相对坐标转换为画布坐标
          const startX = bounds.x + arrow.start.x;
          const startY = bounds.y + arrow.start.y;
          const endX = bounds.x + arrow.end.x;
          const endY = bounds.y + arrow.end.y;
          // 绘制起点手柄
          this.handleCtx.beginPath();
          this.handleCtx.arc(startX, startY, 8, 0, 2 * Math.PI);
          this.handleCtx.strokeStyle = '#000';
          this.handleCtx.lineWidth = 1.5;
          this.handleCtx.stroke();
          this.handleCtx.fillStyle = 'rgba(255,255,255,0.0)';
          this.handleCtx.fill();
          // 绘制终点手柄
          this.handleCtx.beginPath();
          this.handleCtx.arc(endX, endY, 8, 0, 2 * Math.PI);
          this.handleCtx.strokeStyle = '#000';
          this.handleCtx.lineWidth = 1.5;
          this.handleCtx.stroke();
          this.handleCtx.fillStyle = 'rgba(255,255,255,0.0)';
          this.handleCtx.fill();
        }
      }
    }
    /**
     * 获取关闭按钮位置
     */
    _getCloseBtnPosition(ann) {
      if (ann.type !== 'text') return null;
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      // 将图片相对坐标转换为画布坐标
      const canvasX = bounds.x + (ann.position?.x || 0);
      const canvasY = bounds.y + (ann.position?.y || 0);
      const lines = ann.text.split('\n');
      const fontSize = ann.fontSize || 14;
      const lineHeight = fontSize * 1.2;
      const totalHeight = lines.length * lineHeight;
      this.drawCtx.save();
      this.drawCtx.font = `normal ${fontSize}px system-ui, sans-serif`;
      let maxWidth = 0;
      for (let line of lines) {
        const metrics = this.drawCtx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width);
      }
      this.drawCtx.restore();
      const paddingTop = 4;
      const paddingRight = 8;
      const paddingLeft = 8;
      const x = canvasX - paddingLeft;
      const y = canvasY - paddingTop;
      const width = maxWidth + paddingLeft + paddingRight;
      const closeBtnSize = 16;
      const closeBtnX = x + width - closeBtnSize / 2 + 8;
      const closeBtnY = y - closeBtnSize / 2 + 8;
      const clickRadius = 16;
      return {
        x: closeBtnX,
        y: closeBtnY,
        radius: clickRadius
      };
    }
    /**
     * 绘制文字边框（用于hover）
     */
    _drawTextBorderWithAnimation(ann, isHoverOnBtn = false, customScale = 1) {
      if (ann.type !== 'text') return;
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      // 将图片相对坐标转换为画布坐标
      const canvasX = bounds.x + (ann.position?.x || 0);
      const canvasY = bounds.y + (ann.position?.y || 0);
      const lines = ann.text.split('\n');
      const fontSize = ann.fontSize || 14;
      const lineHeight = fontSize * 1.2;
      const totalHeight = lines.length * lineHeight;
      this.drawCtx.save();
      this.drawCtx.font = `normal ${fontSize}px system-ui, sans-serif`;
      let maxWidth = 0;
      for (let line of lines) {
        const metrics = this.drawCtx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width);
      }
      const paddingTop = 6;
      const paddingRight = 8;
      const paddingBottom = 2;
      const paddingLeft = 8;
      const radius = 6;
      const x = canvasX - paddingLeft;
      const y = canvasY - paddingTop;
      const width = maxWidth + paddingLeft + paddingRight;
      const height = totalHeight + paddingTop + paddingBottom;
      this.drawCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
      this.drawCtx.lineWidth = 1.5;
      this.drawCtx.setLineDash([3, 3]);
      this._drawRoundedRect(this.drawCtx, x, y, width, height, radius);
      this.drawCtx.stroke();
      const closeBtnBaseSize = 16;
      const closeBtnX = x + width - closeBtnBaseSize / 2 + 8;
      const closeBtnY = y - closeBtnBaseSize / 2 + 8;
      const clickRadius = 12;
      let scale = isHoverOnBtn ? customScale : 1;
      const btnRadius = (closeBtnBaseSize / 2) * scale;
      const crossOffset = 3 * scale;
      const lineWidthVal = 2 * scale;
      this.drawCtx.setLineDash([]);
      this.drawCtx.fillStyle = '#ef4444';
      this.drawCtx.beginPath();
      this.drawCtx.arc(closeBtnX, closeBtnY, btnRadius, 0, 2 * Math.PI);
      this.drawCtx.fill();
      this.drawCtx.strokeStyle = 'white';
      this.drawCtx.lineWidth = lineWidthVal;
      this.drawCtx.lineCap = 'round';
      this.drawCtx.beginPath();
      this.drawCtx.moveTo(closeBtnX - crossOffset, closeBtnY - crossOffset);
      this.drawCtx.lineTo(closeBtnX + crossOffset, closeBtnY + crossOffset);
      this.drawCtx.moveTo(closeBtnX + crossOffset, closeBtnY - crossOffset);
      this.drawCtx.lineTo(closeBtnX - crossOffset, closeBtnY + crossOffset);
      this.drawCtx.stroke();
      this.drawCtx.closeBtnInfo = {
        x: closeBtnX,
        y: closeBtnY,
        radius: clickRadius,
        textObj: ann
      };
      this.drawCtx.restore();
    }
    _drawRoundedRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
    /**
     * 检查点是否在文字区域内
     */
    _isPointInText(ann, x, y) {
      if (ann.type !== 'text') return false;
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      // 将图片相对坐标转换为画布坐标
      const canvasX = bounds.x + (ann.position?.x || 0);
      const canvasY = bounds.y + (ann.position?.y || 0);
      const lines = ann.text.split('\n');
      const lineHeight = (ann.fontSize || 14) * 1.2;
      const totalHeight = lines.length * lineHeight;
      const yToleranceTop = 4;
      const yToleranceBottom = 0;
      if (y < canvasY - yToleranceTop || y > canvasY + totalHeight + yToleranceBottom) return false;
      this.drawCtx.save();
      this.drawCtx.font = `normal ${ann.fontSize || 14}px system-ui, sans-serif`;
      let maxWidth = 0;
      for (let line of lines) {
        const metrics = this.drawCtx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width);
      }
      this.drawCtx.restore();
      const xTolerance = 0;
      return (x >= canvasX && x <= canvasX + maxWidth + xTolerance);
    }
    /**
     * 检查手柄点击
     */
    _checkHandleHit(x, y) {
      if (this.selectedArrowIndex >= 0) {
        const arrow = this.annotations[this.selectedArrowIndex];
        if (arrow.type === 'arrow') {
          const bounds = this.imageBounds || {
            x: 0,
            y: 0
          };
          // 将存储的相对坐标转换为画布坐标
          const startX = bounds.x + arrow.start.x;
          const startY = bounds.y + arrow.start.y;
          const endX = bounds.x + arrow.end.x;
          const endY = bounds.y + arrow.end.y;
          if (Math.hypot(x - startX, y - startY) < 10) return 'start';
          if (Math.hypot(x - endX, y - endY) < 10) return 'end';
        }
      }
      return null;
    }
    /**
     * 检查点是否在批注上（橡皮擦）
     */
    _hitTestAnnotation(x, y, ann) {
      if (!ann) return false;
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      switch (ann.type) {
      case 'pen':
        if (ann.points && ann.points.length > 1) {
          for (let i = 0; i < ann.points.length - 1; i++) {
            const p1 = ann.points[i];
            const p2 = ann.points[i + 1];
            // 将相对坐标转换为画布坐标
            const canvasP1 = {
              x: bounds.x + p1.x,
              y: bounds.y + p1.y
            };
            const canvasP2 = {
              x: bounds.x + p2.x,
              y: bounds.y + p2.y
            };
            const dist = this._pointToSegmentDistance(x, y, canvasP1.x, canvasP1.y, canvasP2.x, canvasP2.y);
            if (dist < 15) return true;
          }
        }
        return false;
      case 'arrow':
        // 将相对坐标转换为画布坐标
        const start = {
          x: bounds.x + ann.start.x,
          y: bounds.y + ann.start.y
        };
        const end = {
          x: bounds.x + ann.end.x,
          y: bounds.y + ann.end.y
        };
        const distToLine = this._pointToSegmentDistance(x, y, start.x, start.y, end.x, end.y);
        return distToLine < 15;
      case 'rect':
        // 将相对坐标转换为画布坐标
        const left = bounds.x + Math.min(ann.start.x, ann.end.x);
        const right = bounds.x + Math.max(ann.start.x, ann.end.x);
        const top = bounds.y + Math.min(ann.start.y, ann.end.y);
        const bottom = bounds.y + Math.max(ann.start.y, ann.end.y);
        return (x >= left - 10 && x <= right + 10 && y >= top - 10 && y <= bottom + 10);
      case 'text':
        return this._isPointInText(ann, x, y);
      default:
        return false;
      }
    }
    _pointToSegmentDistance(px, py, x1, y1, x2, y2) {
      const ax = px - x1;
      const ay = py - y1;
      const bx = x2 - x1;
      const by = y2 - y1;
      const dot = ax * bx + ay * by;
      const len2 = bx * bx + by * by;
      if (len2 === 0) return Math.hypot(ax, ay);
      let t = dot / len2;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * bx;
      const projY = y1 + t * by;
      return Math.hypot(px - projX, py - projY);
    }
    /**
     * 橡皮擦擦除
     */
    _eraseAt(x, y) {
      let erased = false;
      const eraseRadius = this.currentSize;
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];
        if (this._hitTestAnnotation(x, y, ann)) {
          this.annotations.splice(i, 1);
          erased = true;
        }
      }
      if (erased) {
        this.render();
        this.selectedArrowIndex = -1;
        this._drawHandles();
        if (this.onUpdate) this.onUpdate(this.annotations.length);
      }
    }
    _eraseLine(x, y) {
      if (!this.lastErasePoint) {
        this._eraseAt(x, y);
        this.lastErasePoint = {
          x,
          y
        };
        return;
      }
      const steps = Math.ceil(Math.hypot(x - this.lastErasePoint.x, y - this.lastErasePoint.y) / 5);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const ix = this.lastErasePoint.x + (x - this.lastErasePoint.x) * t;
        const iy = this.lastErasePoint.y + (y - this.lastErasePoint.y) * t;
        this._eraseAt(ix, iy);
      }
      this.lastErasePoint = {
        x,
        y
      };
    }
    /**
     * 调整输入框大小
     */
    _adjustTextInputSize() {
      this.textInput.style.height = 'auto';
      const computedStyle = window.getComputedStyle(this.textInput);
      const lineHeight = parseFloat(computedStyle.lineHeight);
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
      const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
      const minTotalHeight = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
      let totalHeight = this.textInput.scrollHeight;
      this.textInput.style.height = Math.max(minTotalHeight, totalHeight) + 'px';
      this.textInput.style.overflow = 'hidden';
      const measure = document.createElement('div');
      measure.style.fontSize = this.textInput.style.fontSize;
      measure.style.fontFamily = computedStyle.fontFamily;
      measure.style.fontWeight = computedStyle.fontWeight;
      measure.style.position = 'absolute';
      measure.style.visibility = 'hidden';
      measure.style.whiteSpace = 'pre-wrap';
      measure.style.wordWrap = 'break-word';
      measure.style.padding = computedStyle.padding;
      measure.style.border = 'none';
      measure.textContent = this.textInput.value || this.textInput.placeholder || '';
      document.body.appendChild(measure);
      let newWidth = measure.offsetWidth + borderTop * 2;
      newWidth = Math.max(21, newWidth);
      this.textInput.style.width = newWidth + 'px';
      document.body.removeChild(measure);
    }
    /**
     * 显示文字输入框
     */
    _showTextInput(x, y) {
      const bounds = this.imageBounds || {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      // 限制坐标在图片区域内
      let clampedX = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width));
      let clampedY = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height));
      this.pendingTextCoords = {
        x: clampedX,
        y: clampedY
      };
      // 计算输入框在画布坐标系中的位置
      const offsetX = this.TEXT_INPUT_OFFSET?.x || -10;
      const offsetY = this.TEXT_INPUT_OFFSET?.y || -16;
      // 输入框的 left/top 直接使用画布逻辑坐标（与画布一一对应）
      const inputLeft = clampedX + offsetX;
      const inputTop = clampedY + offsetY;
      // 设置输入框初始样式
      this.textInput.style.opacity = '0';
      this.textInput.style.display = 'block';
      this.textInput.style.left = inputLeft + 'px';
      this.textInput.style.top = inputTop + 'px';
      this.textInput.style.fontSize = this.currentFontSize + 'px';
      this.textInput.value = '';
      this.textInput.focus();
      this._adjustTextInputSize();
      requestAnimationFrame(() => {
        this.textInput.style.opacity = '0.9';
      });
      this.drawCanvas.style.pointerEvents = 'none';
    }
    /**
     * 提交文字
     */
    _commitText() {
      if (!this.pendingTextCoords) return;
      const text = this.textInput.value;
      if (text && text.trim() !== '') {
        const bounds = this.imageBounds || {
          x: 0,
          y: 0,
          width: 0,
          height: 0
        };
        // pendingTextCoords 已经是画布逻辑坐标
        let finalX = this.pendingTextCoords.x;
        let finalY = this.pendingTextCoords.y;
        // 确保坐标在图片区域内
        finalX = Math.max(bounds.x, Math.min(finalX, bounds.x + bounds.width));
        finalY = Math.max(bounds.y, Math.min(finalY, bounds.y + bounds.height));
        // 画布坐标 → 图片相对坐标（存储到 annotation 中）
        const relativeX = finalX - bounds.x;
        const relativeY = finalY - bounds.y + this.TEXT_INPUT_OFFSET.y / 2;
        this.annotations.push({
          type: 'text',
          position: {
            x: relativeX,
            y: relativeY
          },
          text: text,
          color: this.currentColor,
          fontSize: this.currentFontSize,
          lineHeight: 1.2
        });
        this.render();
        if (this.onUpdate) this.onUpdate(this.annotations.length);
      }
      this.textInput.style.display = 'none';
      this.drawCanvas.style.pointerEvents = 'auto';
      this.pendingTextCoords = null;
      this.isDraggingInput = false;
    }
    /**
     * 进入文字编辑模式
     */
    _enterTextEditMode(ann, index) {
      const bounds = this.imageBounds || {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      // 图片相对坐标 → 画布坐标
      let canvasX = bounds.x + (ann.position?.x || 0);
      let canvasY = bounds.y + (ann.position?.y || 0);
      // 限制坐标在图片区域内
      canvasX = Math.max(bounds.x, Math.min(canvasX, bounds.x + bounds.width));
      canvasY = Math.max(bounds.y, Math.min(canvasY, bounds.y + bounds.height));
      // 计算输入框在画布坐标系中的位置
      const offsetX = this.TEXT_INPUT_OFFSET?.x || -10;
      const offsetY = this.TEXT_INPUT_OFFSET?.y || -16;
      // 输入框的 left/top 直接使用画布逻辑坐标
      const inputLeft = canvasX + offsetX;
      //const inputTop = canvasY + offsetY;
      const inputTop = canvasY + this.TEXT_INPUT_OFFSET.y / 2;
      this.pendingTextCoords = {
        x: canvasX,
        y: canvasY - this.TEXT_INPUT_OFFSET.y / 2
      };
      //this.pendingTextCoords = { x: canvasX, y: canvasY };
      this.currentFontSize = ann.fontSize || 14;
      this.currentColor = ann.color;
      // 设置输入框位置
      this.textInput.style.display = 'block';
      this.textInput.style.left = inputLeft + 'px';
      this.textInput.style.top = inputTop + 'px';
      this.textInput.style.fontSize = this.currentFontSize + 'px';
      this.textInput.value = ann.text;
      this.textInput.focus();
      this.drawCanvas.style.pointerEvents = 'none';
      this._adjustTextInputSize();
      // 从批注列表中移除原文字
      this.annotations.splice(index, 1);
      this.render();
    }
    /**
     * 实时预览绘制
     */
    _drawPreview(currentX, currentY) {
      this.render();
      if (this.isDrawing) {
        const bounds = this.imageBounds || {
          x: 0,
          y: 0
        };
        // 限制预览坐标在图片区域内
        let previewX = currentX;
        let previewY = currentY;
        if (previewX < bounds.x) previewX = bounds.x;
        if (previewX > bounds.x + bounds.width) previewX = bounds.x + bounds.width;
        if (previewY < bounds.y) previewY = bounds.y;
        if (previewY > bounds.y + bounds.height) previewY = bounds.y + bounds.height;
        if (this.currentTool === 'arrow') {
          this._drawArrow({
            x: this.startX,
            y: this.startY
          }, {
            x: previewX,
            y: previewY
          }, this.currentColor, this.currentSize, this.drawCtx);
        } else if (this.currentTool === 'rect') {
          this.drawCtx.strokeStyle = this.currentColor;
          this.drawCtx.lineWidth = this.currentSize;
          this.drawCtx.strokeRect(this.startX, this.startY, previewX - this.startX, previewY - this.startY);
        } else if (this.currentTool === 'pen' && this.tempPoints.length > 1) {
          this.drawCtx.beginPath();
          this.drawCtx.strokeStyle = this.currentColor;
          this.drawCtx.lineWidth = this.currentSize;
          this.drawCtx.lineCap = 'round';
          this.drawCtx.lineJoin = 'round';
          // 将相对坐标转换为画布坐标进行预览绘制
          this.drawCtx.moveTo(this.tempPoints[0].x + bounds.x, this.tempPoints[0].y + bounds.y);
          for (let i = 1; i < this.tempPoints.length; i++) {
            this.drawCtx.lineTo(this.tempPoints[i].x + bounds.x, this.tempPoints[i].y + bounds.y);
          }
          this.drawCtx.stroke();
        }
      }
    }
    /**
     * 动画缩放
     */
    _startScaleAnimation(target) {
      if (this.targetScale === target) return;
      this.targetScale = target;
      if (!this.animating) {
        this.animating = true;
        const animate = () => {
          this.animationScale = this.animationScale + (this.targetScale - this.animationScale) * 0.3;
          if (this.currentHoveredTextInfo && this.currentHoveredTextInfo.textObj) {
            const ann = this.currentHoveredTextInfo.textObj;
            this._drawTextBorderWithAnimation(ann, true, this.animationScale);
          }
          if (Math.abs(this.animationScale - this.targetScale) > 0.01) {
            requestAnimationFrame(animate);
          } else {
            this.animationScale = this.targetScale;
            this.animating = false;
          }
        };
        requestAnimationFrame(animate);
      }
    }
    /**
     * 更新UI状态
     */
    _updateUIState() {
      // 指针进入图片边界后才显示工具光标，边界外保持系统箭头。
      this.drawCanvas.style.cursor = 'default';
    }
    // ==================== 事件处理 ====================
    _handleMouseDown(e) {
      const coords = this._getLogicalCoords(e);
      const bounds = this.imageBounds || {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      if (this.restrictStartToImageBounds &&
        (coords.x < bounds.x || coords.x > bounds.x + bounds.width ||
          coords.y < bounds.y || coords.y > bounds.y + bounds.height)) {
        return;
      }
      e.preventDefault();
      if (this.pendingTextCoords) return;
      // 检测关闭按钮
      if (this.currentHoveredTextInfo && this.currentHoveredTextInfo.closeBtnX) {
        const dist = Math.hypot(coords.x - this.currentHoveredTextInfo.closeBtnX, coords.y - this.currentHoveredTextInfo.closeBtnY);
        if (dist < (this.currentHoveredTextInfo.closeBtnRadius || 16)) {
          return;
        }
      }
      // 橡皮擦
      if (this.currentTool === 'eraser') {
        this.isErasing = true;
        this.lastErasePoint = null;
        this._eraseAt(coords.x, coords.y);
        return;
      }
      // 检测是否点击到文字
      let hitText = false;
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];
        if (ann.type === 'text' && this._isPointInText(ann, coords.x, coords.y)) {
          hitText = true;
          break;
        }
      }
      if (hitText) return;
      // 检测箭头手柄
      if (this.selectedArrowIndex >= 0) {
        const hit = this._checkHandleHit(coords.x, coords.y);
        if (hit) {
          this.dragHandle = hit;
          this.isDraggingHandle = true;
          return;
        } else {
          this.selectedArrowIndex = -1;
          this._drawHandles();
        }
      }
      // 文字工具
      if (this.currentTool === 'text') {
        this._showTextInput(coords.x, coords.y);
        return;
      }
      // 开始绘制
      this.isDrawing = true;
      // 获取图片边界
      // 限制起始点在图片区域内
      let startX = coords.x;
      let startY = coords.y;
      if (startX < bounds.x) startX = bounds.x;
      if (startX > bounds.x + bounds.width) startX = bounds.x + bounds.width;
      if (startY < bounds.y) startY = bounds.y;
      if (startY > bounds.y + bounds.height) startY = bounds.y + bounds.height;
      this.startX = startX;
      this.startY = startY;
      if (this.currentTool === 'pen') {
        // 存储相对坐标的点
        this.tempPoints = [{
          x: this.startX - bounds.x,
          y: this.startY - bounds.y
        }];
      }
    }
    _handleMouseMove(e) {
      const coords = this._getLogicalCoords(e);
      const insideImage = this._isPointInsideImageBounds(coords.x, coords.y);
      this._notifyImageHoverChange(insideImage);
      if (!insideImage) {
        this.drawCanvas.style.cursor = 'default';
        this._hideSizeCursor();
        this._hideToolCursor();
      } else if (e.metaKey && ['pen', 'eraser'].includes(this.currentTool)) {
        this._showSizeCursor(e, this.currentSize, this.currentTool, true, true);
      } else if (this.currentTool === 'pen') {
        this._showToolCursor(e);
      } else if (this.currentTool === 'eraser') {
        this.drawCanvas.style.cursor = 'none';
        this._showSizeCursor(e, this.currentSize, 'eraser', true, false);
      } else {
        this._hideSizeCursor();
        this._hideToolCursor();
        this.drawCanvas.style.cursor = this.currentTool === 'text'
          ? 'text'
          : 'crosshair';
      }
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      if (this.isErasing && this.currentTool === 'eraser') {
        this._eraseLine(coords.x, coords.y);
        return;
      }
      if (this.isDraggingHandle && this.selectedArrowIndex >= 0) {
        const arrow = this.annotations[this.selectedArrowIndex];
        if (this.dragHandle === 'start') {
          // 画布坐标 → 相对坐标
          let dragX = coords.x;
          let dragY = coords.y;
          if (dragX < bounds.x) dragX = bounds.x;
          if (dragX > bounds.x + bounds.width) dragX = bounds.x + bounds.width;
          if (dragY < bounds.y) dragY = bounds.y;
          if (dragY > bounds.y + bounds.height) dragY = bounds.y + bounds.height;
          arrow.start = {
            x: dragX - bounds.x,
            y: dragY - bounds.y
          };
        } else if (this.dragHandle === 'end') {
          let dragX = coords.x;
          let dragY = coords.y;
          if (dragX < bounds.x) dragX = bounds.x;
          if (dragX > bounds.x + bounds.width) dragX = bounds.x + bounds.width;
          if (dragY < bounds.y) dragY = bounds.y;
          if (dragY > bounds.y + bounds.height) dragY = bounds.y + bounds.height;
          arrow.end = {
            x: dragX - bounds.x,
            y: dragY - bounds.y
          };
        }
        this.render();
        return;
      }
      if (this.isDrawing) {
        // 检查鼠标是否在图片区域内
        let drawX = coords.x;
        let drawY = coords.y;
        if (drawX < bounds.x) drawX = bounds.x;
        if (drawX > bounds.x + bounds.width) drawX = bounds.x + bounds.width;
        if (drawY < bounds.y) drawY = bounds.y;
        if (drawY > bounds.y + bounds.height) drawY = bounds.y + bounds.height;
        if (this.currentTool === 'pen') {
          // 添加新点（相对坐标）
          const newPoint = {
            x: drawX - bounds.x,
            y: drawY - bounds.y
          };
          this.tempPoints.push(newPoint);
          this._drawPreview(drawX, drawY);
        } else {
          this._drawPreview(drawX, drawY);
        }
      } else if (this.currentTool === 'text' && !this.pendingTextCoords) {
        // 文字 hover 检测逻辑
        let hoveredText = null;
        let hitCloseBtn = false;
        for (let i = this.annotations.length - 1; i >= 0; i--) {
          const ann = this.annotations[i];
          if (ann.type === 'text') {
            const btnInfo = this._getCloseBtnPosition(ann);
            if (btnInfo) {
              const dist = Math.hypot(coords.x - btnInfo.x, coords.y - btnInfo.y);
              if (dist < btnInfo.radius) {
                hoveredText = ann;
                hitCloseBtn = true;
                break;
              }
            }
          }
        }
        if (!hoveredText) {
          for (let i = this.annotations.length - 1; i >= 0; i--) {
            const ann = this.annotations[i];
            if (ann.type === 'text' && this._isPointInText(ann, coords.x, coords.y)) {
              hoveredText = ann;
              break;
            }
          }
        }
        if (hitCloseBtn) {
          this.drawCanvas.style.cursor = 'pointer';
        } else if (hoveredText) {
          this.drawCanvas.style.cursor = 'text';
        } else {
          this.drawCanvas.style.cursor = 'text';
        }
        this.render();
        if (hoveredText) {
          if (hitCloseBtn) {
            this._startScaleAnimation(1.1);
            this._drawTextBorderWithAnimation(hoveredText, true, this.animationScale);
          } else {
            this._startScaleAnimation(1);
            this._drawTextBorderWithAnimation(hoveredText, false, this.animationScale);
          }
          const btnInfo = this._getCloseBtnPosition(hoveredText);
          this.currentHoveredTextInfo = {
            textObj: hoveredText,
            closeBtnX: btnInfo?.x,
            closeBtnY: btnInfo?.y,
            closeBtnRadius: btnInfo?.radius,
            isHover: hitCloseBtn
          };
        } else {
          this.currentHoveredTextInfo = null;
        }
      }
    }
    _handleMouseUp(e) {
      if (this.isErasing) {
        this.isErasing = false;
        this.lastErasePoint = null;
        return;
      }
      const coords = this._getLogicalCoords(e);
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      if (this.isDraggingHandle) {
        this.isDraggingHandle = false;
        this.dragHandle = null;
        return;
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this.currentTool === 'pen') {
        if (this.tempPoints.length > 2) {
          this.annotations.push({
            type: 'pen',
            points: this._smoothPoints(this.tempPoints),
            color: this.currentColor,
            size: this.currentSize
          });
          if (this.onUpdate) this.onUpdate(this.annotations.length);
        }
        this.tempPoints = [];
        this.render();
      } else if (this.currentTool === 'arrow') {
        // 限制结束点在图片区域内
        let endX = coords.x;
        let endY = coords.y;
        if (endX < bounds.x) endX = bounds.x;
        if (endX > bounds.x + bounds.width) endX = bounds.x + bounds.width;
        if (endY < bounds.y) endY = bounds.y;
        if (endY > bounds.y + bounds.height) endY = bounds.y + bounds.height;
        const dist = Math.hypot(endX - this.startX, endY - this.startY);
        if (dist > 10) {
          // 转换为图片相对坐标
          const relativeStart = {
            x: this.startX - bounds.x,
            y: this.startY - bounds.y
          };
          const relativeEnd = {
            x: endX - bounds.x,
            y: endY - bounds.y
          };
          this.annotations.push({
            type: 'arrow',
            start: relativeStart,
            end: relativeEnd,
            color: this.currentColor,
            size: this.currentSize
          });
          this.selectedArrowIndex = this.annotations.length - 1;
          if (this.onUpdate) this.onUpdate(this.annotations.length);
        }
        this.render();
      } else if (this.currentTool === 'rect') {
        // 限制结束点在图片区域内
        let endX = coords.x;
        let endY = coords.y;
        if (endX < bounds.x) endX = bounds.x;
        if (endX > bounds.x + bounds.width) endX = bounds.x + bounds.width;
        if (endY < bounds.y) endY = bounds.y;
        if (endY > bounds.y + bounds.height) endY = bounds.y + bounds.height;
        const width = endX - this.startX;
        const height = endY - this.startY;
        if (Math.abs(width) > 5 && Math.abs(height) > 5) {
          // 转换为图片相对坐标
          const relativeStart = {
            x: this.startX - bounds.x,
            y: this.startY - bounds.y
          };
          const relativeEnd = {
            x: endX - bounds.x,
            y: endY - bounds.y
          };
          this.annotations.push({
            type: 'rect',
            start: relativeStart,
            end: relativeEnd,
            color: this.currentColor,
            size: this.currentSize
          });
          if (this.onUpdate) this.onUpdate(this.annotations.length);
        }
        this.render();
      }
    }
    _handleWheel(e) {
      if (!e.metaKey || this.pendingTextCoords) return;
      const coords = this._getLogicalCoords(e);
      if (this.restrictStartToImageBounds && !this._isPointInsideImageBounds(coords.x, coords.y)) return;
      const selectedArrow = this.currentTool === 'arrow' && this.selectedArrowIndex >= 0
        ? this.annotations[this.selectedArrowIndex]
        : null;
      const adjustable = this.currentTool === 'pen' || this.currentTool === 'eraser' ||
        this.currentTool === 'text' || selectedArrow?.type === 'arrow';
      if (!adjustable) return;

      e.preventDefault();
      e.stopPropagation();
      const toolKey = selectedArrow ? 'arrow' : this.currentTool;
      const steps = this._consumeWheelSteps(e, toolKey);
      if (['pen', 'eraser'].includes(this.currentTool)) {
        this._showSizeCursor(e, this.currentSize, this.currentTool);
      }
      if (!steps) return;

      if (this.currentTool === 'text') {
        this.currentFontSize = Math.min(32, Math.max(8, this.currentFontSize + steps));
        this._notifySizeChange('text', this.currentFontSize);
      } else if (this.currentTool === 'eraser') {
        this.currentSize = Math.min(30, Math.max(5, this.currentSize + steps));
        this._notifySizeChange('eraser', this.currentSize);
        this._showSizeCursor(e, this.currentSize, 'eraser');
      } else if (selectedArrow) {
        selectedArrow.size = Math.round(Math.min(12, Math.max(1,
          (selectedArrow.size || this.currentSize) + steps * 0.5)) * 2) / 2;
        this.currentSize = selectedArrow.size;
        this._notifySizeChange('arrow', selectedArrow.size);
        this.render();
        if (this.onUpdate) this.onUpdate(this.annotations.length);
      } else if (this.currentTool === 'pen') {
        this.currentSize = Math.round(Math.min(12, Math.max(1,
          this.currentSize + steps * 0.5)) * 2) / 2;
        this._notifySizeChange('pen', this.currentSize);
        this._showSizeCursor(e, this.currentSize, 'pen');
      }
    }
    _handleDoubleClick(e) {
      if (this.pendingTextCoords) return;
      const coords = this._getLogicalCoords(e);
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];
        if (this._isPointInText(ann, coords.x, coords.y)) {
          this._enterTextEditMode(ann, i);
          return;
        }
      }
    }
    _handleClick(e) {
      const coords = this._getLogicalCoords(e);
      // 检测关闭按钮
      if (this.currentHoveredTextInfo && this.currentHoveredTextInfo.closeBtnX) {
        const dist = Math.hypot(coords.x - this.currentHoveredTextInfo.closeBtnX, coords.y - this.currentHoveredTextInfo.closeBtnY);
        if (dist < (this.currentHoveredTextInfo.closeBtnRadius || 16)) {
          const textToDelete = this.currentHoveredTextInfo.textObj;
          const index = this.annotations.findIndex(a => a === textToDelete);
          if (index !== -1) {
            this.annotations.splice(index, 1);
            this.render();
            if (this.onUpdate) this.onUpdate(this.annotations.length);
          }
          this.currentHoveredTextInfo = null;
          return;
        }
      }
      // 箭头选中取消
      if (this.selectedArrowIndex >= 0) {
        if (!this._checkHandleHit(coords.x, coords.y)) {
          this.selectedArrowIndex = -1;
          this._drawHandles();
        }
      }
      // 文字点击编辑
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];
        if (ann.type === 'text' && this._isPointInText(ann, coords.x, coords.y)) {
          this._enterTextEditMode(ann, i);
          return;
        }
      }
      // 文字工具新建
      if (this.currentTool === 'text') {
        this._showTextInput(coords.x, coords.y);
      }
    }
    _handleInputWheel(e) {
      if (!e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const steps = this._consumeWheelSteps(e, 'text');
      if (!steps) return;
      this.currentFontSize = Math.min(32, Math.max(8, this.currentFontSize + steps));
      this.textInput.style.fontSize = this.currentFontSize + 'px';
      this._adjustTextInputSize();
      this._notifySizeChange('text', this.currentFontSize);
    }
    _handleInputKeydown(e) {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        this._commitText();
      } else if (e.key === 'Escape') {
        this.textInput.style.display = 'none';
        this.drawCanvas.style.pointerEvents = 'auto';
        this.pendingTextCoords = null;
        this.isDraggingInput = false;
      }
    }
    _handleInputMouseDown(e) {
      if (!this.pendingTextCoords) return;
      e.stopPropagation();
      // 记录鼠标的初始位置和状态
      this.isDraggingInput = true;
      this._lastDragMouseX = e.clientX;
      this._lastDragMouseY = e.clientY;
      this.textInput.classList.add('dragging');
    }
    _handleGlobalMouseMove(e) {
      if (!this.isDraggingInput || !this.pendingTextCoords) return;
      const bounds = this.imageBounds || {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      const canvasRect = this.drawCanvas.getBoundingClientRect();
      // 获取鼠标相对于上一次的位移
      const dx = e.clientX - this._lastDragMouseX;
      const dy = e.clientY - this._lastDragMouseY;
      // 记录当前鼠标位置用于下次计算
      this._lastDragMouseX = e.clientX;
      this._lastDragMouseY = e.clientY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      // 计算缩放比例
      const scaleX = this.width / canvasRect.width;
      const scaleY = this.height / canvasRect.height;
      // 获取输入框当前的画布坐标（从 CSS 转换为画布坐标，因为输入框的 left/top 直接等于画布坐标）
      const currentLeft = parseFloat(this.textInput.style.left) || 0;
      const currentTop = parseFloat(this.textInput.style.top) || 0;
      // 计算新的画布坐标位置
      let newLeft = currentLeft + dx * scaleX;
      let newTop = currentTop + dy * scaleY;
      // 获取输入框尺寸（CSS像素）
      const inputRect = this.textInput.getBoundingClientRect();
      const inputWidthInCanvas = inputRect.width * scaleX;
      const inputHeightInCanvas = inputRect.height * scaleY;
      // 限制在图片边界内（画布逻辑坐标）
      newLeft = Math.max(bounds.x, Math.min(newLeft, bounds.x + bounds.width - inputWidthInCanvas));
      newTop = Math.max(bounds.y, Math.min(newTop, bounds.y + bounds.height - inputHeightInCanvas));
      // 设置输入框的 CSS 位置（与画布坐标一一对应）
      this.textInput.style.left = newLeft + 'px';
      this.textInput.style.top = newTop + 'px';
      // 更新文字的锚点坐标（画布逻辑坐标）
      const offsetX = this.TEXT_INPUT_OFFSET?.x || -10;
      const offsetY = this.TEXT_INPUT_OFFSET?.y || -16;
      this.pendingTextCoords = {
        x: newLeft - offsetX,
        y: newTop - offsetY
      };
    }
    _handleGlobalMouseUp() {
      if (this.isDraggingInput) {
        this.isDraggingInput = false;
        this.textInput.classList.remove('dragging');
      }
    }
    // ==================== 公共API ====================
    /**
     * 渲染所有批注
     */
    render() {
      if (!this.drawCtx) return;
      // 使用实际画布尺寸（已设置为内容完整尺寸）
      const actualWidth = this.drawCanvas.width / this.pixelRatio;
      const actualHeight = this.drawCanvas.height / this.pixelRatio;
      this.drawCtx.clearRect(0, 0, actualWidth, actualHeight);
      const bounds = this.imageBounds || {
        x: 0,
        y: 0
      };
      for (const ann of this.annotations) {
        switch (ann.type) {
        case 'pen':
          this.drawCtx.beginPath();
          this.drawCtx.strokeStyle = ann.color;
          this.drawCtx.lineWidth = ann.size;
          this.drawCtx.lineCap = 'round';
          this.drawCtx.lineJoin = 'round';
          if (ann.points && ann.points.length > 1) {
            this.drawCtx.moveTo(bounds.x + ann.points[0].x, bounds.y + ann.points[0].y);
            for (let i = 1; i < ann.points.length; i++) {
              this.drawCtx.lineTo(bounds.x + ann.points[i].x, bounds.y + ann.points[i].y);
            }
            this.drawCtx.stroke();
          }
          break;
        case 'arrow':
          this._drawArrow({
              x: bounds.x + ann.start.x,
              y: bounds.y + ann.start.y
            }, {
              x: bounds.x + ann.end.x,
              y: bounds.y + ann.end.y
            },
            ann.color, ann.size, this.drawCtx
          );
          break;
        case 'rect':
          this.drawCtx.strokeStyle = ann.color;
          this.drawCtx.lineWidth = ann.size;
          this.drawCtx.strokeRect(
            bounds.x + ann.start.x,
            bounds.y + ann.start.y,
            ann.end.x - ann.start.x,
            ann.end.y - ann.start.y
          );
          break;
        case 'text':
          this._drawMultilineText(
            this.drawCtx, ann.text,
            bounds.x + (ann.position?.x || 0),
            bounds.y + (ann.position?.y || 0),
            ann.fontSize || 14, ann.color, ann.lineHeight || 1.2, this.DEBUG_SHOW_TEXT_BG
          );
          break;
        }
      }
      this._drawHandles();
    }
    /**
     * 切换工具
     * @param {string} tool - 工具名称: 'pen', 'arrow', 'rect', 'text', 'eraser'
     */
    setTool(tool) {
      const validTools = ['pen', 'arrow', 'rect', 'text', 'eraser'];
      if (!validTools.includes(tool)) {
        console.warn(`SmartAnnotation: 无效工具 "${tool}"，可用工具: ${validTools.join(', ')}`);
        return;
      }
      this.currentTool = tool;
      this._wheelAccumulator = 0;
      this._wheelTool = null;
      this._hideSizeCursor();
      this._hideToolCursor();
      this.selectedArrowIndex = -1;
      this._drawHandles();
      this._updateUIState();
      if (this.onToolChange) this.onToolChange(tool);
    }
    /**
     * 获取当前工具
     */
    getTool() {
      return this.currentTool;
    }
    /**
     * 设置颜色
     * @param {string} color - CSS颜色值
     */
    setColor(color) {
      this.currentColor = color;
    }
    /**
     * 获取当前颜色
     */
    getColor() {
      return this.currentColor;
    }
    /**
     * 设置线条粗细/擦除半径
     * @param {number} size - 大小值
     */
    setSize(size) {
      let validSize = size;
      if (this.currentTool === 'eraser') {
        validSize = Math.min(30, Math.max(5, size));
      } else {
        validSize = Math.min(12, Math.max(1, size));
      }
      this.currentSize = validSize;
      if (this.currentTool === 'arrow' && this.selectedArrowIndex >= 0) {
        const arrow = this.annotations[this.selectedArrowIndex];
        if (arrow?.type === 'arrow') {
          arrow.size = validSize;
          this.render();
          if (this.onUpdate) this.onUpdate(this.annotations.length);
        }
      }
    }
    /**
     * 获取当前粗细/半径
     */
    getSize() {
      return this.currentSize;
    }
    /**
     * 设置文字大小
     * @param {number} fontSize - 字号 (8-32)
     */
    setFontSize(fontSize) {
      this.currentFontSize = Math.min(32, Math.max(8, fontSize));
    }
    /**
     * 获取当前文字大小
     */
    getFontSize() {
      return this.currentFontSize;
    }
    /**
     * 撤销上一步
     */
    undo() {
      this.annotations.pop();
      this.selectedArrowIndex = -1;
      this.render();
      if (this.onUpdate) this.onUpdate(this.annotations.length);
    }
    /**
     * 清空所有批注
     */
    clear() {
      this.annotations = [];
      this.selectedArrowIndex = -1;
      this.render();
      if (this.onUpdate) this.onUpdate(0);
    }
    /**
     * 导出为PNG图片
     * @returns {string} 图片的DataURL
     */
    exportImage() {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = this.width * this.pixelRatio;
      exportCanvas.height = this.height * this.pixelRatio;
      const eCtx = exportCanvas.getContext('2d');
      eCtx.scale(this.pixelRatio, this.pixelRatio);
      if (this.bgCanvas) eCtx.drawImage(this.bgCanvas, 0, 0);
      eCtx.drawImage(this.drawCanvas, 0, 0);
      return exportCanvas.toDataURL('image/png');
    }
    /**
     * 下载导出图片
     * @param {string} filename - 文件名（可选）
     */
    downloadImage(filename) {
      const link = document.createElement('a');
      const name = filename || `批注_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.png`;
      link.download = name;
      link.href = this.exportImage();
      link.click();
    }
    /**
     * 获取当前批注数量
     */
    getAnnotationCount() {
      return this.annotations.length;
    }
    /**
     * 获取所有批注数据
     */
    getAnnotations() {
      return [...this.annotations];
    }
    /**
     * 加载批注数据
     * @param {Array} annotations - 批注数据数组
     */
    loadAnnotations(annotations) {
      this.annotations = [...annotations];
      this.selectedArrowIndex = -1;
      this.render();
      if (this.onUpdate) this.onUpdate(this.annotations.length);
    }
    /**
     * 设置背景文字
     * @param {Object} config - { mainText, subText, gridColor }
     */
    setBackground(config) {
      if (config.mainText !== undefined) this.backgroundConfig.mainText = config.mainText;
      if (config.subText !== undefined) this.backgroundConfig.subText = config.subText;
      if (config.gridColor !== undefined) this.backgroundConfig.gridColor = config.gridColor;
      this._initBackground();
      this.render();
    }
    /**
     * 设置图片边界（用于坐标转换）
     * @param {Object} bounds - { x, y, width, height }
     */
    setImageBounds(bounds) {
      this.imageBounds = bounds;
    }
    /**
     * 设置是否必须从图片边界内开始批注。
     * 左右对比模式开启，旧模式关闭以保持原有交互。
     */
    setRestrictStartToImageBounds(enabled) {
      this.restrictStartToImageBounds = !!enabled;
    }
    /**
     * 设置更新回调
     * @param {Function} callback - 批注数量变化时的回调函数
     */
    setOnUpdate(callback) {
      this.onUpdate = callback;
    }
    /**
     * 设置工具切换回调
     * @param {Function} callback - 工具切换时的回调函数
     */
    setOnToolChange(callback) {
      this.onToolChange = callback;
    }
    /**
     * 设置尺寸变化回调（Cmd + 滚轮）。
     */
    setOnSizeChange(callback) {
      this.onSizeChange = callback;
    }
    /**
     * 设置可标注图片范围的悬停状态回调。
     */
    setOnImageHoverChange(callback) {
      this.onImageHoverChange = callback;
    }
    /**
     * 销毁插件，清理DOM和事件
     */
    destroy() {
      // 移除事件监听
      this.drawCanvas.removeEventListener('pointerdown', this._boundPointerDown);
      this.drawCanvas.removeEventListener('pointermove', this._boundPointerMove);
      this.drawCanvas.removeEventListener('pointerup', this._boundPointerUp);
      this.drawCanvas.removeEventListener('pointercancel', this._boundPointerCancel);
      this.drawCanvas.removeEventListener('wheel', this._boundWheel);
      this.drawCanvas.removeEventListener('pointerleave', this._boundPointerLeave);
      this.drawCanvas.removeEventListener('dblclick', this._boundDoubleClick);
      this.drawCanvas.removeEventListener('click', this._boundClick);
      this.textInput.removeEventListener('wheel', this._boundInputWheel);
      this.textInput.removeEventListener('input', this._boundInput);
      this.textInput.removeEventListener('keydown', this._boundInputKeydown);
      this.textInput.removeEventListener('pointerdown', this._boundInputPointerDown);
      document.removeEventListener('pointermove', this._boundGlobalPointerMove);
      document.removeEventListener('pointerup', this._boundGlobalPointerUp);
      document.removeEventListener('pointercancel', this._boundGlobalPointerUp);
      document.removeEventListener('keyup', this._boundGlobalKeyUp);
      window.removeEventListener('blur', this._boundGlobalBlur);
      this._hideSizeCursor();
      this._hideToolCursor();
      this.sizeCursor?.remove();
      this.toolCursor?.remove();
      // 如果是自动创建模式，清空容器
      if (!this.useExternalCanvas && this.container) {
        this.container.innerHTML = '';
      }
    }
  }
  // ==================== 导出 ====================
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmartAnnotation;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () {
      return SmartAnnotation;
    });
  } else {
    global.SmartAnnotation = SmartAnnotation;
  }
})(typeof window !== 'undefined' ? window : this);
