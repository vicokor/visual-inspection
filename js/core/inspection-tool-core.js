/**
 * 视检工具核心层
 * 负责共享状态、DOM 引用、功能初始化编排、通用反馈与全局快捷键。
 * 具体业务能力通过 feature mixin 在 js/script.js 中组合。
 */
class InspectionToolCore {
    constructor() {
        // 获取设备像素比用于Canvas高清渲染
        this.devicePixelRatio = window.devicePixelRatio || 1;

        this.state = {
            designImage: null,
            devImage: null,
            inspectionMode: 'side-by-side',
            baseWidth: 375,
            customWidth: '',
            opacity: 50,
            zoom: 100,
            annotations: [],
            pluginAnnotations: [],  // 👈存储插件标注数据
            currentAnnotationId: 1,
            isAnnotating: false,
            isDrawing: false,
            startX: 0,
            startY: 0,
            endX: 0,
            endY: 0,
            canvasOffsetX: 0,
            canvasOffsetY: 0,
            designCanvasOffsetX: 0,
            imageWidth: 0,
            imageHeight: 0,
            designYOffset: 0,  // 新增：设计图Y轴偏移量

            isResizing: false,              // 是否正在调整标注
            resizeAnnotationId: null,       // 正在调整的标注ID
            resizeStartX: 0,                // 调整开始时的鼠标X
            resizeStartY: 0,                // 调整开始时的鼠标Y
            resizeStartBaseX: 0,            // 标注原始的baseX
            resizeStartBaseY: 0,            // 标注原始的baseY
            resizeStartBaseWidth: 0,         // 标注原始的baseWidth
            resizeStartBaseHeight: 0,        // 标注原始的baseHeight
            resizeDirection: null,           // 调整方向：'n','s','e','w','ne','nw','se','sw'
            hoveredAnnotationId: null,        // 当前鼠标悬停的标注ID
            imageBoundaryHovered: false,      // 鼠标是否位于可标注图片范围内
            annotationsVisible: true  // 👈 这个也需要加上，原代码缺失
        };

        // 新增：缩放动画相关
        this._zoomAnimationId = null;
        this._lastZoom = 100;

        // 标注状态配置
        this.STATUS_CONFIG = {
            pending: {
                color: '#ff4444',      // 红色
                bgColor: '#ff4444',
                text: '待修复',
                className: 'pending'
            },
            keep: {
                color: '#f5a623',      // 黄色/橙色
                bgColor: '#f5a623',
                text: '可遗留',
                className: 'keep'
            },
            fixed: {
                color: '#80c808',      // 绿色
                bgColor: '#80c808',
                text: '已修复',
                className: 'fixed'
            }
        };

        // 先初始化所有元素
        this.initElements();

        // 最后初始化事件监听
        this.initEventListeners();
        this.initCanvas();
        this.updateUI();

        // 新增：存储相关属性
        this.historyStorage = new HistoryStorage();
        this.isSidebarOpen = false;
        this.hasUnsavedChanges = false; // 是否有未保存的更改
        this.currentSavedTimestamp = null; // 当前已保存状态的时间戳

        // 浮动菜单相关属性
        this.currentFloatingMenu = null;
        this.currentMenuTrigger = null;
        this.closeOnClickOutside = null;
        this.closeOnEsc = null;

        // 新增：保存按钮状态
        this.saveButton = document.getElementById('save-state');
        this.historyToggle = document.getElementById('history-toggle');
        this.historySidebar = document.getElementById('history-sidebar');
        this.historyClose = document.getElementById('history-close');
        this.historyContent = document.getElementById('history-content');
        this.clearHistoryBtn = document.getElementById('clear-history');
        this.toastContainer = document.getElementById('toast-container');
        this.unsavedModal = document.getElementById('unsaved-modal');
        this.unsavedSaveBtn = document.getElementById('unsaved-save');
        this.unsavedDiscardBtn = document.getElementById('unsaved-discard');
        this.unsavedCancelBtn = document.getElementById('unsaved-cancel');
        this.appContainer = document.querySelector('.app-container');

        // 新增：设计图偏移滑块控制
        this.offsetToggle = null;
        this.offsetMenu = null;
        this.offsetSlider = null;
        this.offsetValue = null;
        this.isOffsetMenuOpen = false;

// 新增：批量导出相关属性
this.isBatchSelectMode = false;
this.selectedBatchItems = new Set();
this.batchExportBtn = null;
this.batchExportPdfBtn = null;
this.batchExportCancelBtn = null;
this.batchSelectCount = null;
    }

    imageToBase64(img, maxSize = null, quality = 0.95) {
        return new Promise((resolve) => {
            // 完整图片保存时直接复用原始 Data URL，避免每次保存都经过
            // Canvas -> JPEG 的有损重编码。历史记录加载后的图片同样是
            // Data URL，因此“加载历史 -> 修改 -> 再保存”也不会继续降质。
            // 指定 maxSize 时仍生成压缩后的缩略图，不影响预览体积控制。
            if (!maxSize && typeof img?.src === 'string' && img.src.startsWith('data:image/')) {
                resolve(img.src);
                return;
            }

            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // 如果指定了最大尺寸，进行缩放（保持宽高比）
            if (maxSize) {
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round(height * (maxSize / width));
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round(width * (maxSize / height));
                        height = maxSize;
                    }
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // 开启抗锯齿，提高缩放质量
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(img, 0, 0, width, height);

            // 缩略图或不具备原始 Data URL 的兼容场景继续使用 JPEG。
            const base64 = canvas.toDataURL('image/jpeg', quality);
            resolve(base64);
        });
    }

    /**
    * Base64转图片
* @param {string} base64 Base64字符串
    */
    base64ToImage(base64) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                console.log('Base64转图片成功, 尺寸: ', img.width, 'x', img.height);
                resolve(img);
            };
            img.onerror = (error) => {
                console.error('Base64转图片失败: ', error);
                reject(error);
            };
            img.src = base64;
        });
    }

    // 添加防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

// 自动调整 textarea 输入框高度
autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // 临时重置高度以获取正确的 scrollHeight
    textarea.style.height = 'auto';
    // 设置新高度（最小60px，最大300px可滚动）
    const newHeight = Math.min(300, Math.max(60, textarea.scrollHeight));
    textarea.style.height = newHeight + 'px';
    
    // 如果内容超过300px，显示滚动条
    if (textarea.scrollHeight > 300) {
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.overflowY = 'hidden';
    }
}

    initElements() {
        // 上传相关
        this.designUpload = document.getElementById('design-upload');
        this.devUpload = document.getElementById('dev-upload');
        this.designInput = document.getElementById('design-input');
        this.devInput = document.getElementById('dev-input');
        this.designPreview = document.getElementById('design-preview');
        this.devPreview = document.getElementById('dev-preview');
        // 新图片替换
        this.designPreviewCompact = document.getElementById('design-preview-compact');
        this.devPreviewCompact = document.getElementById('dev-preview-compact');

        // 操作控制相关
        //this.modeButtons = document.querySelectorAll('.mode-btn');
        //this.widthButtons = document.querySelectorAll('.width-btn');
        //this.customWidthInput = document.getElementById('custom-width');
        // 改为安全获取（避免报错）
        this.modeButtons = document.querySelectorAll('.mode-btn') || [];
        this.widthButtons = document.querySelectorAll('.width-btn') || [];
        this.customWidthInput = document.getElementById('custom-width');
        this.opacitySlider = document.getElementById('opacity-slider');
        this.opacityValue = document.getElementById('opacity-value');
        this.opacityControl = document.getElementById('opacity-control');
        this.startButton = document.getElementById('start-inspection');
        this.resetButton = document.getElementById('reset-all');

        // 新增：保存按钮
        this.saveButton = document.getElementById('save-state');
        // 初始禁用保存按钮
        if (this.saveButton) {
           this.saveButton.disabled = true;
        }

        // 历史侧边栏蒙层
        this.sidebarOverlay = document.getElementById('sidebar-overlay');
        // 清空历史确认弹窗
        this.clearHistoryModal = document.getElementById('clear-history-modal');
        this.clearHistoryCancelBtn = document.getElementById('clear-history-cancel');
        this.clearHistoryConfirmBtn = document.getElementById('clear-history-confirm');

        // 清空标注确认弹窗
        this.clearAnnotationsModal = document.getElementById('clear-annotations-modal');
        this.clearAnnotationsCancelBtn = document.getElementById('clear-annotations-cancel');
        this.clearAnnotationsConfirmBtn = document.getElementById('clear-annotations-confirm');

        // 导出报告命名弹窗
        this.exportReportModal = document.getElementById('export-report-modal');
        this.exportReportNameInput = document.getElementById('export-report-name');
        this.exportReportCancelBtn = document.getElementById('export-report-cancel');
        this.exportReportConfirmBtn = document.getElementById('export-report-confirm');

        // 视检区域相关
        this.emptyState = document.getElementById('empty-state');
        this.comparisonContainer = document.getElementById('comparison-container');
        this.currentModeSpan = document.getElementById('current-mode');
        this.currentWidthSpan = document.getElementById('current-width');
        this.designCanvas = document.getElementById('design-canvas');
        this.devCanvas = document.getElementById('dev-canvas');
        this.annotationCanvas = document.getElementById('annotation-canvas');
        this.sliderHandle = document.getElementById('slider-handle');
        this.zoomInButton = document.getElementById('zoom-in');
        this.zoomOutButton = document.getElementById('zoom-out');
        //this.resetZoomButton = document.getElementById('reset-zoom');
        this.zoomLevelSpan = document.getElementById('zoom-level');
        this.canvasWrapper = document.getElementById('canvas-wrapper');

        // 标注相关
        this.annotationToggle = document.getElementById('annotation-toggle');
        this.annotationHint = document.getElementById('annotation-hint');
        this.annotationsList = document.getElementById('annotations-list');
        this.clearAllButton = document.getElementById('clear-all');
        this.modal = document.getElementById('annotation-modal');
        this.modalAnnotationId = document.getElementById('modal-annotation-id');
        this.annotationDesc = document.getElementById('annotation-desc');
        this.saveAnnotationButton = document.getElementById('save-annotation');
        this.cancelAnnotationButton = document.getElementById('cancel-annotation');
        this.deleteAnnotationButton = document.getElementById('delete-annotation');
        this.toggleVisibilityButton = document.getElementById('toggle-visibility');
        this.exportPdfButton = document.getElementById('export-pdf');

        // 新增：历史侧边栏相关
        this.historyToggle = document.getElementById('history-toggle');
        this.historySidebar = document.getElementById('history-sidebar');
        this.historyClose = document.getElementById('history-close');
        this.historyContent = document.getElementById('history-content');
        this.clearHistoryBtn = document.getElementById('clear-history');
        this.toastContainer = document.getElementById('toast-container');
        this.unsavedModal = document.getElementById('unsaved-modal');
        this.unsavedSaveBtn = document.getElementById('unsaved-save');
        this.unsavedDiscardBtn = document.getElementById('unsaved-discard');
        this.unsavedCancelBtn = document.getElementById('unsaved-cancel');
        this.appContainer = document.querySelector('.app-container');

        // Canvas上下文
        if (this.designCanvas) {
            this.designCtx = this.designCanvas.getContext('2d');
        }
        if (this.devCanvas) {
            this.devCtx = this.devCanvas.getContext('2d');
        }
        if (this.annotationCanvas) {
            this.annotationCtx = this.annotationCanvas.getContext('2d');
        }

        // 设计图滑块偏移相关
        this.offsetToggle = document.getElementById('offset-toggle');
        this.offsetMenu = document.getElementById('offset-menu');
        this.offsetSlider = document.getElementById('offset-slider');
        this.offsetValue = document.getElementById('offset-value');

// 批量导出相关元素（延迟初始化，因为按钮在侧边栏标题中动态添加）
this.batchExportBtn = null;
this.batchExportPdfBtn = null;
this.batchExportCancelBtn = null;
this.batchSelectCount = null;

    }

    // 启动金色边框淡入动画
    startHighlightAnimation() {
        // 取消之前的动画
        if (this.state.highlightAnimationId) {
            cancelAnimationFrame(this.state.highlightAnimationId);
        }

        // 重置透明度
        this.state.highlightOpacity = 0;
        const startTime = performance.now();
        const duration = 300; // 动画持续时间 300ms

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // 使用 ease-out 缓动函数，让动画更自然
            this.state.highlightOpacity = 1 - Math.pow(1 - progress, 3);

            // 重绘画布
            this.drawAnnotations();

            if (progress < 1) {
                this.state.highlightAnimationId = requestAnimationFrame(animate);
            } else {
                this.state.highlightAnimationId = null;
            }
        };

        this.state.highlightAnimationId = requestAnimationFrame(animate);
    }

    // 停止高亮动画
    stopHighlightAnimation() {
        if (this.state.highlightAnimationId) {
            cancelAnimationFrame(this.state.highlightAnimationId);
            this.state.highlightAnimationId = null;
        }
        this.state.highlightOpacity = 0;
    }


    /**
     * 统一编排各功能域的事件初始化。
     * 新功能应在所属 feature 内维护事件，避免继续扩大核心层。
     */
    initEventListeners() {
        this.initKeyboardShortcuts();
        this.initComparisonEvents();
        if (this.initLongScreenshotEvents) {
            this.initLongScreenshotEvents();
        }
        this.initHistoryEvents();
        this.initAnnotationEvents();
        if (this.initAIInspectionEvents) {
            this.initAIInspectionEvents();
        }
        if (this.initRulerEvents) {
            this.initRulerEvents();
        }
        if (this.initExportEvents) {
            this.initExportEvents();
        }
        this.setupDataChangeListeners();
    }

    // 新增：设置数据变化监听
    setupDataChangeListeners() {
        // 代理 state 对象，监听变化
        const originalState = this.state;
        const self = this;

        this.state = new Proxy(originalState, {
            set(target, property, value) {
                const oldValue = target[property];
                target[property] = value;

                // 忽略内部状态和初始化时的变化
                if (!self._initializing) {
                    // 这些属性的变化不应该触发"未保存"状态
                    const ignoreProps = ['zoom', 'isDrawing', 'startX', 'startY', 'endX', 'endY',
                    'canvasOffsetX', 'canvasOffsetY', 'designCanvasOffsetX', 'imageWidth', 'imageHeight',
                    'imageBoundaryHovered', 'hoveredAnnotationId'];

                    if (!ignoreProps.includes(property)) {
                        self.markAsUnsaved();
                    }
                }

                return true;
            }
        });

        // 标记初始化完成
        this._initializing = true;
        setTimeout(() => {
            this._initializing = false;
        }, 100);
    }

    // 新增：标记为未保存
    markAsUnsaved() {
        if (this.currentSavedTimestamp !== null) {
            this.hasUnsavedChanges = true;
            this.updateSaveButtonState();
        }
    }

    // 保存按钮
    updateSaveButtonState() {
        if (!this.saveButton) return;

        if (this.hasUnsavedChanges) {
            this.saveButton.innerHTML = '<i class="icon download"></i> 保存';
            this.saveButton.disabled = false;
        } else {
            this.saveButton.innerHTML = '<i class="icon circle-check"></i> 已保存';
            this.saveButton.disabled = true;
        }
    }

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
    toast.className = `toast ${type}`;

        let icon = 'invoice';
        if (type === 'success') icon = 'circle-check';
        if (type === 'error') icon = 'exclamation-circle';

        toast.innerHTML = `
    <i class="icon ${icon}"></i>
    <span>${message}</span>
        `;

        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    // 切换历史侧边栏

            resetAll() {
                if (confirm('确定要重置所有设置和图片吗？')) {
                    if (this.cancelAIInspection) {
                        this.cancelAIInspection();
                    }
                    // 重置状态
                    this.state = {
                        designImage: null,
                        devImage: null,
                        inspectionMode: 'side-by-side',
                        baseWidth: 375,
                        customWidth: '',
                        opacity: 50,
                        zoom: 100,
                        annotations: [],
                        pluginAnnotations: [],  // 插件层
                        currentAnnotationId: 1,
                        annotationsVisible: true,
                        isAnnotating: false,
                        isDrawing: false,
                        startX: 0,
                        startY: 0,
                        endX: 0,
                        endY: 0,
                        canvasOffsetX: 0,
                        canvasOffsetY: 0,
                        designCanvasOffsetX: 0,
                        imageWidth: 0,
                        imageHeight: 0,
                        highlightOpacity: 0,
                        highlightAnimationId: null
                    };

                    // 重置缩放显示
                    if (this.zoomLevelSpan) {
                        this.zoomLevelSpan.textContent = '100%';
                    }
                    this._lastZoom = 100;

                    // 新增：重置偏移
                    this.state.designYOffset = 0;
                    if (this.offsetSlider) {
                        this.offsetSlider.value = 0;
                    }
                    if (this.offsetValue) {
                        this.offsetValue.textContent = '0px';
                    }
                    if (this.offsetToggle) {
                        this.offsetToggle.classList.remove('active');
                    }
                    if (this.isOffsetMenuOpen) {
                        this.closeOffsetMenu();
                    }

                    // 关闭浮动菜单（如果存在）
                    if (this.currentFloatingMenu) {
                        this.closeFloatingStatusMenu();
                    }

                    // 重置悬停状态
                    this.hoveredUploadArea = null;

                    // 清空上传预览
                    if (this.designPreview) {
                        this.designPreview.innerHTML = '';
                        this.designPreview.classList.remove('active');
                    }
                    if (this.devPreview) {
                        this.devPreview.innerHTML = '';
                        this.devPreview.classList.remove('active');
                    }

                    // 清空文件输入
                    if (this.designInput) {
                        this.designInput.value = '';
                    }
                    if (this.devInput) {
                        this.devInput.value = '';
                    }
                    if (this.clearLongScreenshotState) {
                        this.clearLongScreenshotState({ keepToggle: false });
                    }

                    // 重置UI状态
                    //this.modeButtons.forEach(btn => {
                    //    btn.classList.toggle('active', btn.dataset.mode === 'slider');
                    //});
                    //this.widthButtons.forEach(btn => {
                    //    btn.classList.toggle('active', btn.dataset.width === '375');
                    //});
                    //if (this.customWidthInput) {
                    //    this.customWidthInput.value = '';
                    //}

    // 替换为：重置新选择器显示
    if (this.syncModeSelector) {
        this.syncModeSelector();
    }
    if (this.syncWidthSelector) {
        this.syncWidthSelector(375);
    }

                    if (this.opacitySlider) {
                        this.opacitySlider.value = '50';
                    }
                    if (this.opacityValue) {
                        this.opacityValue.textContent = '50%';
                    }
                    if (this.opacityControl) {
                        this.opacityControl.classList.remove('active');
                    }
                    if (this.annotationToggle) {
                        this.annotationToggle.checked = false;
                    }
                    if (this.annotationHint) {
                        this.annotationHint.classList.remove('active');
                    }
                    if (this.annotationCanvas) {
                        this.annotationCanvas.style.pointerEvents = 'auto';
                        this.annotationCanvas.style.cursor = 'default';
                    }

                    // 隐藏对比区域
                    if (this.emptyState) {
                        this.emptyState.style.display = 'flex';
                    }
                    if (this.comparisonContainer) {
                        this.comparisonContainer.style.display = 'none';
                        this.comparisonContainer.classList.remove('annotating');
                        this.comparisonContainer.classList.remove('drawing');
                    }

                    // 重置显示/隐藏按钮
                    if (this.toggleVisibilityButton) {
                        this.toggleVisibilityButton.style.display = 'none';
                        const icon = this.toggleVisibilityButton.querySelector('i');
                        if (icon) {
                            icon.className = 'icon eye-edit';
                        }
                        this.toggleVisibilityButton.classList.remove('hidden-active');
                    }

// 👇 确保重置时插件画布恢复可见
if (window.drawingToolbar) {
    const pluginInstance = window.drawingToolbar.getInstance();
    if (pluginInstance && pluginInstance.drawCanvas) {
        pluginInstance.drawCanvas.style.display = 'block';
        pluginInstance.drawCanvas.style.visibility = 'visible';
        pluginInstance.drawCanvas.style.opacity = '1';
    }
}

                    // 清空画布
                    if (this.designCtx && this.designCanvas) {
                        const cssWidth = this.designCanvas.width / this.devicePixelRatio;
                        const cssHeight = this.designCanvas.height / this.devicePixelRatio;
                        this.designCtx.clearRect(0, 0, cssWidth, cssHeight);
                    }
                    if (this.devCtx && this.devCanvas) {
                        const cssWidth = this.devCanvas.width / this.devicePixelRatio;
                        const cssHeight = this.devCanvas.height / this.devicePixelRatio;
                        this.devCtx.clearRect(0, 0, cssWidth, cssHeight);
                    }
                    if (this.annotationCtx && this.annotationCanvas) {
                        const cssWidth = this.annotationCanvas.width / this.devicePixelRatio;
                        const cssHeight = this.annotationCanvas.height / this.devicePixelRatio;
                        this.annotationCtx.clearRect(0, 0, cssWidth, cssHeight);
                    }

                    // 隐藏滑杆
                    if (this.sliderHandle) {
                        this.sliderHandle.style.display = 'none';
                    }

                    // 新增：重置保存状态
                    this.currentSavedTimestamp = null; // 清除当前保存的时间戳
                    this.hasUnsavedChanges = false;
                    this.updateSaveButtonState();

                    // 更新按钮状态
                    this.updateStartButton();
                    this.updateAnnotationsList();

                    // 更新显示
                    if (this.zoomLevelSpan) {
                        this.zoomLevelSpan.textContent = '100%';
                    }
                }
            }

            updateUI() {
                this.zoomLevelSpan.textContent = '100%';
                this.opacityValue.textContent = '50%';
            }

            // 初始化键盘快捷键
            initKeyboardShortcuts() {
                document.addEventListener('keydown', (e) => {
                    // 检查是否按下 Cmd 键（Mac）或 Ctrl 键（Windows）
                    const isCmdOrCtrl = e.metaKey || e.ctrlKey;

                    // 特别处理 Cmd+V/Ctrl+V：如果有悬停的上传区域，不阻止默认行为
                    if (isCmdOrCtrl && e.key.toLowerCase() === 'v') {
                        if (this.hoveredUploadArea) {
                            console.log('允许默认粘贴行为，将由paste事件处理');
                            return;
                        }
                    }

                    // 忽略输入框内的快捷键（除了 Enter 和 Esc）
                    const isInputFocused = document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.tagName === 'TEXTAREA';

                    if (isInputFocused) {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (this.modal.classList.contains('active')) {
                                this.saveAnnotation();
                            }
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            if (this.modal.classList.contains('active')) {
                                this.deleteAnnotation();
                            } else if (this.state.isAnnotating) {
                                this.annotationToggle.checked = false;
                                this.toggleAnnotationMode();
                            }
                        }
                        return;
                    }

                    // 其他快捷键
                    switch(e.key.toLowerCase()) {
                        case 's': 
                        if (isCmdOrCtrl) {
                            // Cmd+S / Ctrl+S：保存
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('快捷键: Cmd+S 保存');
                            if (this.saveButton && !this.saveButton.disabled) {
                                this.saveCurrentState();
                            }
                        } else {
                            // 单独按 S 键：开始视检
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('快捷键: S 开始视检');
                            if (this.startButton && !this.startButton.disabled) {
                                this.startInspection();
                            }
                        }
                        break;

                        case 'p': 
                        // Cmd+P / Ctrl+P：导出PDF
                        if (isCmdOrCtrl) {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('快捷键: Cmd+P 导出PDF');
                            if (this.exportPdfButton && !this.exportPdfButton.disabled) {
                                this.openExportReportModal?.();
                            }
                        }
                        break;

                        case '+': 
                        case '=': 
                        e.preventDefault();
                        this.zoomIn();
                        break;

                        case '-': 
                        e.preventDefault();
                        this.zoomOut();
                        break;

                        case '0': 
                        e.preventDefault();
                        this.resetZoom();
                        break;

case 'r': 
e.preventDefault();
if (this.state.designImage && this.state.devImage) {
    // 切换标注模式
    this.annotationToggle.checked = !this.annotationToggle.checked;
    this.toggleAnnotationMode();
    
    // 如果标注模式开启，禁用插件工具栏
    if (this.state.isAnnotating) {
        if (window.drawingToolbar && window.drawingToolbar.isEnabled()) {
            window.drawingToolbar.disable();
        }
        if (window.updateToolbarButtonsState) {
            window.updateToolbarButtonsState(false);  // 按钮变灰禁用
        }
    } else {
        // 标注模式关闭，恢复工具栏按钮
        if (window.updateToolbarButtonsState) {
            window.updateToolbarButtonsState(true);   // 按钮恢复可用
        }
    }
}
break;
                    }
                });
            }

            // 导出PDF功能
}
