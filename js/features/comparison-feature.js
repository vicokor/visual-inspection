/**
 * 图片对比功能
 * 负责图片输入、画布尺寸、四种对比模式、滑杆、缩放和垂直偏移。
 */
const withComparisonFeature = (Base) => class extends Base {
    initComparisonEvents() {
        // 添加上传区域悬停状态记录
        this.hoveredUploadArea = null;

        // 监听上传区域的鼠标悬停
        if (this.designUpload) {
            this.designUpload.addEventListener('mouseenter', () => {
                // 调试日志 console.log('mouseenter design');
                this.hoveredUploadArea = 'design';
            });

            this.designUpload.addEventListener('mouseleave', () => {
                // 调试日志 console.log('mouseleave design');
                if (this.hoveredUploadArea === 'design') {
                    this.hoveredUploadArea = null;
                }
            });
        }

        if (this.devUpload) {
            this.devUpload.addEventListener('mouseenter', () => {
                // 调试日志 console.log('mouseenter dev');
                this.hoveredUploadArea = 'dev';
            });

            this.devUpload.addEventListener('mouseleave', () => {
                // 调试日志 console.log('mouseleave dev');
                if (this.hoveredUploadArea === 'dev') {
                    this.hoveredUploadArea = null;
                }
            });
        }


        // 监听全局粘贴事件
        document.addEventListener('paste', (e) => this.handlePaste(e));

        // 图片上传事件
        if (this.designUpload) {
            this.designUpload.addEventListener('click', () => this.designInput?.click());
        }
        if (this.devUpload) {
            this.devUpload.addEventListener('click', () => this.devInput?.click());
        }
        if (this.designInput) {
            this.designInput.addEventListener('change', (e) => this.handleImageUpload(e, 'design'));
        }
        if (this.devInput) {
            this.devInput.addEventListener('change', (e) => this.handleImageUpload(e, 'dev'));
        }

        // 拖拽上传
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            if (this.designUpload) {
                this.designUpload.addEventListener(eventName, this.preventDefaults);
            }
            if (this.devUpload) {
                this.devUpload.addEventListener(eventName, this.preventDefaults);
            }
        });

        if (this.designUpload) {
            this.designUpload.addEventListener('drop', (e) => this.handleDrop(e, 'design'));
        }
        if (this.devUpload) {
            this.devUpload.addEventListener('drop', (e) => this.handleDrop(e, 'dev'));
        }

        // 操作控制事件（原左侧控制组已删除）
        //this.modeButtons.forEach(btn => {
        //    btn.addEventListener('click', () => this.setInspectionMode(btn.dataset.mode));
        //});

        //this.widthButtons.forEach(btn => {
        //    btn.addEventListener('click', () => this.setBaseWidth(parseInt(btn.dataset.width)));
        //});

        //if (this.customWidthInput) {
        //    this.customWidthInput.addEventListener('input', (e) => {
        //        const value = parseInt(e.target.value);
        //        if (value && value >= 1 && value <= 5000) {
        //            this.setBaseWidth(value, true);
        //        }
        //    });
        //}

        if (this.opacitySlider) {
            this.opacitySlider.addEventListener('input', (e) => {
                this.state.opacity = parseInt(e.target.value);
            this.opacityValue.textContent = `${this.state.opacity}%`;
                if (this.state.inspectionMode === 'overlay') {
                    this.updateComparison();
                }
            });
        }

        if (this.startButton) {
            this.startButton.addEventListener('click', () => this.startInspection());
        }
        if (this.resetButton) {
            this.resetButton.addEventListener('click', () => this.resetAll());
        }

        if (this.sliderHandle) {
            this.sliderHandle.addEventListener('pointerdown', (e) => this.startSliderMove(e));
        }

        // 缩放事件
        if (this.zoomInButton) {
            this.zoomInButton.addEventListener('click', () => this.zoomIn());
        }
        if (this.zoomOutButton) {
            this.zoomOutButton.addEventListener('click', () => this.zoomOut());
        }
        //if (this.resetZoomButton) {
        //    this.resetZoomButton.addEventListener('click', () => this.resetZoom());
        //}

// 点击 zoom-level 重置缩放
if (this.zoomLevelSpan) {
    this.zoomLevelSpan.addEventListener('click', () => this.resetZoom());
}

        // 全局事件
        document.addEventListener('pointermove', (e) => this.moveSlider(e));
        document.addEventListener('pointerup', (e) => this.stopSliderMove(e));
        document.addEventListener('pointercancel', (e) => this.stopSliderMove(e));

        this.designOffsetDrag = null;
        this.designOffsetPointer = null;
        if (this.canvasWrapper) {
            this.canvasWrapper.addEventListener('pointerdown', (e) => this.startDesignOffsetDrag(e), true);
            this.canvasWrapper.addEventListener('pointermove', (e) => {
                this.designOffsetPointer = { clientX: e.clientX, clientY: e.clientY };
                this.updateDesignOffsetHoverState(e);
            }, true);
            this.canvasWrapper.addEventListener('pointerleave', () => {
                if (!this.designOffsetDrag) this.canvasWrapper.classList.remove('shift-offset-ready');
            });
        }
        document.addEventListener('pointermove', (e) => this.moveDesignOffsetDrag(e));
        document.addEventListener('pointerup', (e) => this.stopDesignOffsetDrag(e));
        document.addEventListener('pointercancel', (e) => this.stopDesignOffsetDrag(e));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift' && this.designOffsetPointer && !this.designOffsetDrag) {
                this.updateDesignOffsetHoverState({ ...this.designOffsetPointer, shiftKey: true });
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') this.canvasWrapper?.classList.remove('shift-offset-ready');
        });
        window.addEventListener('blur', () => {
            this.canvasWrapper?.classList.remove('shift-offset-ready');
        });

        if (this.canvasWrapper) {
            this.canvasWrapper.addEventListener('scroll', () => {
                if (this.state.inspectionMode === 'slider') {
                    this.updateSliderIconPosition();
                }
            }, { passive: true });
        }

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            if (this.state.inspectionMode === 'slider') {
                this.updateSliderIconPosition();
            }
        });

        // 偏移按钮事件 - 彻底清理后只绑定一次
        // 正确的写法（约 900 行）
        if (this.offsetToggle) {
            const oldToggle = this.offsetToggle;
            const newToggle = oldToggle.cloneNode(true);
            oldToggle.parentNode.replaceChild(newToggle, oldToggle);

            this.offsetToggle = newToggle;
            this.offsetMenu = document.getElementById('offset-menu');

            this.offsetToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('偏移按钮点击（唯一监听）', Date.now());
                this.toggleOffsetMenu(e);  // 调用方法，而不是直接写逻辑
            });
        }

        // 偏移滑块事件
        if (this.offsetSlider) {
            this.offsetSlider.addEventListener('input', (e) => this.handleOffsetChange(e));

            // 阻止滑块事件冒泡
            this.offsetSlider.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        }

// 点击 offset-value 重置偏移为 0
if (this.offsetValue) {
    this.offsetValue.style.cursor = 'pointer';
    this.offsetValue.style.transition = 'all 0.2s ease';
    this.offsetValue.title = '点击重置偏移';
    
    this.offsetValue.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetOffset();
    });
}

        // 偏移菜单点击阻止冒泡
        if (this.offsetMenu) {
            this.offsetMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }


// ========== 🆕 control-nav 交互逻辑 ==========

// 获取新增的元素
this.navMenuBtn = document.getElementById('menu-toggle-btn');
this.widthSelectorTrigger = document.getElementById('width-selector-trigger');
this.widthDropdown = document.getElementById('width-dropdown');
this.modeOptions = document.querySelectorAll('.mode-option');
this.modeSelector = document.getElementById('mode-selector');
this.navSaveBtn = document.getElementById('nav-save-btn');
this.navExportBtn = document.getElementById('nav-export-btn');

// 初始化宽度显示
if (this.syncWidthSelector) {
    this.syncWidthSelector(this.state.baseWidth);
}

// ⭐ 基准宽度下拉菜单（完整代码）
if (this.widthSelectorTrigger && this.widthDropdown) {
    // 移除可能存在的旧事件（避免重复绑定）
    const newTrigger = this.widthSelectorTrigger.cloneNode(true);
    this.widthSelectorTrigger.parentNode.replaceChild(newTrigger, this.widthSelectorTrigger);
    this.widthSelectorTrigger = newTrigger;
    
    // 重新获取 dropdown（因为 DOM 没变，不需要替换）
    this.widthDropdown = document.getElementById('width-dropdown');
    
    // 绑定点击事件
    this.widthSelectorTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('宽度选择器点击'); // 调试日志
        this.widthDropdown.classList.toggle('active');
        this.widthSelectorTrigger.classList.toggle('active');
    });

    // 选择预设宽度
    const dropdownItems = this.widthDropdown.querySelectorAll('.dropdown-item[data-width]');
    dropdownItems.forEach(item => {
        // 移除旧事件
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        newItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const width = parseInt(newItem.dataset.width);
            console.log('选择宽度:', width); // 调试日志
            this.setBaseWidth(width);
            this.widthDropdown.classList.remove('active');
            this.widthSelectorTrigger.classList.remove('active');
            // 更新显示文字
            const span = this.widthSelectorTrigger.querySelector('span');
            if (span) span.textContent = `${width}px`;
        });
    });

    // 自定义宽度
    const customItem = document.getElementById('custom-width-item');
    if (customItem) {
        const newCustomItem = customItem.cloneNode(true);
        customItem.parentNode.replaceChild(newCustomItem, customItem);
        
        newCustomItem.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('自定义宽度点击'); // 调试日志
            this.widthDropdown.classList.remove('active');
            this.widthSelectorTrigger.classList.remove('active');
            this.showCustomWidthModal();
        });
    }
}

// 自定义宽度弹窗
this.showCustomWidthModal = () => {
    // 创建弹窗（如果不存在）
    if (!this.customWidthModal) {
        this.customWidthModal = document.createElement('div');
        this.customWidthModal.className = 'custom-width-modal';
        this.customWidthModal.innerHTML = `
            <div class="custom-width-content">
                <h4>自定义宽度</h4>
                <input type="number" id="custom-width-input" placeholder="输入宽度 (px)" min="1" max="5000" step="1">
                <div class="custom-width-actions">
                    <button class="btn-secondary" id="custom-width-cancel">取消</button>
                    <button class="btn-primary" id="custom-width-confirm">确认</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.customWidthModal);

        // 绑定确认按钮事件
        const confirmBtn = this.customWidthModal.querySelector('#custom-width-confirm');
        const cancelBtn = this.customWidthModal.querySelector('#custom-width-cancel');
        const input = this.customWidthModal.querySelector('#custom-width-input');

        confirmBtn.addEventListener('click', () => {
            const width = parseInt(input.value);
            if (width && width >= 1 && width <= 5000) {
                this.setBaseWidth(width, true);
                // 同步宽度选择器显示
                if (this.syncWidthSelector) {
                    this.syncWidthSelector(width);
                }
                this.closeCustomWidthModal();
            } else {
                alert('请输入1-5000之间的数字');
            }
        });

        cancelBtn.addEventListener('click', () => this.closeCustomWidthModal());
        
        // 点击遮罩关闭
        this.customWidthModal.addEventListener('click', (e) => {
            if (e.target === this.customWidthModal) {
                this.closeCustomWidthModal();
            }
        });

        // 回车确认
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            }
        });
        // 获取元素的 offsetHeight 会强制浏览器计算样式
        this.customWidthModal.offsetHeight;
    }

    // 显示弹窗
    this.customWidthModal.classList.add('active');
    
    // 设置当前宽度值
    const input = this.customWidthModal.querySelector('#custom-width-input');
    if (input) {
        input.value = this.state.baseWidth;
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    }
};

// 关闭自定义宽度弹窗
this.closeCustomWidthModal = () => {
    if (this.customWidthModal) {
        this.customWidthModal.classList.remove('active');
    }
};

        // 全局点击监听 - 用于处理所有菜单关闭
        document.addEventListener('click', (e) => {
            // 1. 处理偏移菜单关闭
            if (this.isOffsetMenuOpen) {
                if (this.offsetMenu &&
                this.offsetToggle &&
                !this.offsetMenu.contains(e.target) &&
                !this.offsetToggle.contains(e.target)) {
                    this.closeOffsetMenu();
                }
            }

            // 2. 处理历史侧边栏关闭
            if (this.isSidebarOpen) {
                if (this.historySidebar &&
                this.historyToggle &&
                !this.historySidebar.contains(e.target) &&
                !this.historyToggle.contains(e.target)) {
                    this.closeHistorySidebar();
                }
            }

            // 3. 关闭基准宽度菜单
            if (this.widthDropdown && this.widthDropdown.classList.contains('active')) {
                if (!this.widthSelectorTrigger?.contains(e.target) && !this.widthDropdown.contains(e.target)) {
                    this.widthDropdown.classList.remove('active');
                    this.widthSelectorTrigger?.classList.remove('active');
                }
            }

            // 👆如果有其他需要全局点击关闭的菜单，在上面可以继续添加
        });

// 同步宽度选择器显示
this.syncWidthSelector = (width) => {
    if (this.widthSelectorTrigger) {
        const widthText = document.querySelector('#width-selector-trigger span');
        if (widthText) {
            widthText.textContent = `${width}px`;
        }
    }
};


// 更新滑块位置的函数
this.updateModeSlider = (activeIndex) => {
    if (this.modeSelector) {
        this.modeSelector.setAttribute('data-active-index', activeIndex);
    }
};

// 同步模式到滑块
this.syncModeSelector = () => {
    const currentMode = this.state.inspectionMode;
    let activeIndex = 0;
    if (currentMode === 'side-by-side') activeIndex = 0;
    else if (currentMode === 'slider') activeIndex = 1;
    else if (currentMode === 'overlay') activeIndex = 2;
    else if (currentMode === 'invert') activeIndex = 3;
    
    this.updateModeSlider(activeIndex);
    
    // 更新按钮激活样式
    this.modeOptions.forEach((opt, idx) => {
        const mode = opt.dataset.mode;
        if (mode === currentMode) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });
};

// 绑定点击事件
if (this.modeOptions.length) {
    this.modeOptions.forEach((opt, index) => {
        opt.addEventListener('click', () => {
            const mode = opt.dataset.mode;
            if (this.state.inspectionMode === mode) return;
            
            // 更新滑块位置
            this.updateModeSlider(index);
            
            // 更新按钮样式
            this.modeOptions.forEach(btn => btn.classList.remove('active'));
            opt.classList.add('active');
            
            // 调用原有的切换方法
            this.setInspectionMode(mode);
            
            // 同步原有模式按钮
            this.modeButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
        });
    });
}

// 初始同步滑块位置
this.syncModeSelector();

// 自定义宽度弹窗（动态创建）
this.customWidthModal = null;

// 保存按钮
if (this.navSaveBtn) {
    this.navSaveBtn.addEventListener('click', () => this.saveCurrentState());
}

// 导出PDF按钮
if (this.navExportBtn) {
    this.navExportBtn.addEventListener('click', () => this.openExportReportModal?.());
}

// ========== 🆕 左下角图片替换按钮交互 ==========
this.imageReplaceBtn = document.getElementById('image-replace-btn');
this.imageReplaceMenu = document.getElementById('image-replace-menu');
this.imageReplaceClose = document.getElementById('image-replace-close');
this.designUploadCompact = document.getElementById('design-upload-compact');
this.devUploadCompact = document.getElementById('dev-upload-compact');
this.startInspectionCompact = document.getElementById('start-inspection-compact');
this.designPreviewCompact = document.getElementById('design-preview-compact');
this.devPreviewCompact = document.getElementById('dev-preview-compact');

// 打开/关闭菜单逻辑
if (this.imageReplaceBtn && this.imageReplaceMenu) {
    this.imageReplaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.closeAISettingsPanel) this.closeAISettingsPanel();
        this.imageReplaceMenu.classList.toggle('active');
    });
}

if (this.imageReplaceClose) {
    this.imageReplaceClose.addEventListener('click', () => {
        this.imageReplaceMenu.classList.remove('active');
    });
}

// 🆕 浮层设计图上传 - 悬停监听（必须绑定）
if (this.designUploadCompact) {
    this.designUploadCompact.addEventListener('mouseenter', () => {
        this.hoveredUploadArea = 'design-compact';
    });
    this.designUploadCompact.addEventListener('mouseleave', () => {
        if (this.hoveredUploadArea === 'design-compact') {
            this.hoveredUploadArea = null;
        }
    });
}

// 🆕 浮层开发图上传 - 悬停监听
if (this.devUploadCompact) {
    this.devUploadCompact.addEventListener('mouseenter', () => {
        this.hoveredUploadArea = 'dev-compact';
    });
    this.devUploadCompact.addEventListener('mouseleave', () => {
        if (this.hoveredUploadArea === 'dev-compact') {
            this.hoveredUploadArea = null;
        }
    });
}

// 🆕 浮层设计图上传 - 点击上传
if (this.designUploadCompact) {
    this.designUploadCompact.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.designInput) {
            this.designInput.click();
        }
    });
    
    // 🆕 拖拽上传支持
    this.designUploadCompact.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.designUploadCompact.style.borderColor = 'var(--primary-color)';
        this.designUploadCompact.style.backgroundColor = 'rgba(43, 108, 176, 0.05)';
    });
    
    this.designUploadCompact.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.designUploadCompact.style.borderColor = 'var(--border-color)';
        this.designUploadCompact.style.backgroundColor = '';
    });
    
    this.designUploadCompact.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.designUploadCompact.style.borderColor = 'var(--border-color)';
        this.designUploadCompact.style.backgroundColor = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            this.handleCompactImageUpload(file, 'design');
        }
    });
}

// 🆕 浮层开发图上传 - 点击上传
if (this.devUploadCompact) {
    this.devUploadCompact.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.devInput) {
            this.devInput.click();
        }
    });
    
    // 🆕 拖拽上传支持
    this.devUploadCompact.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.devUploadCompact.style.borderColor = 'var(--primary-color)';
        this.devUploadCompact.style.backgroundColor = 'rgba(43, 108, 176, 0.05)';
    });
    
    this.devUploadCompact.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.devUploadCompact.style.borderColor = 'var(--border-color)';
        this.devUploadCompact.style.backgroundColor = '';
    });
    
    this.devUploadCompact.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.devUploadCompact.style.borderColor = 'var(--border-color)';
        this.devUploadCompact.style.backgroundColor = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            if (this.handleDroppedFiles) {
                this.handleDroppedFiles(files, 'dev', { compact: true });
            } else {
                const file = files[0];
                this.handleCompactImageUpload(file, 'dev');
            }
        }
    });
}

// 浮层更新图片按钮
if (this.startInspectionCompact) {
    this.startInspectionCompact.addEventListener('click', () => {
        if (!this.startInspectionCompact.disabled) {
            this.startInspection();
            this.imageReplaceMenu.classList.remove('active');
        }
    });
}
    }

async handlePaste(e) {
    console.log('paste event triggered', {
        hoveredArea: this.hoveredUploadArea,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey
    });

    // 检查是否有悬停的上传区域
    if (!this.hoveredUploadArea) {
        console.log('没有悬停的上传区域，忽略粘贴');
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    const items = e.clipboardData?.items;
    if (!items) {
        console.log('没有剪贴板数据');
        return;
    }

    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            if (file) {
                const fileName = file.name || `clipboard_image_${Date.now()}.png`;
                const imageFile = new File([file], fileName, { type: file.type });
                
                // 🆕 修改这里：统一判断逻辑
                if (this.hoveredUploadArea === 'design' || this.hoveredUploadArea === 'design-compact') {
                    // 判断是左侧还是浮层
                    if (this.hoveredUploadArea === 'design-compact') {
                        await this.handleCompactImageUpload(imageFile, 'design');
                    } else {
                        await this.handleClipboardImage(imageFile, 'design');
                    }
                    this.showPasteFeedback('design');
                } 
                else if (this.hoveredUploadArea === 'dev' || this.hoveredUploadArea === 'dev-compact') {
                    if (this.hoveredUploadArea === 'dev-compact') {
                        await this.handleCompactImageUpload(imageFile, 'dev');
                    } else {
                        await this.handleClipboardImage(imageFile, 'dev');
                    }
                    this.showPasteFeedback('dev');
                }
                break;
            }
        }
    }
}

            // 处理剪贴板图片
            async handleClipboardImage(file, type) {
                try {
                    const image = await this.loadImage(file);
                    const previewId = type === 'design' ? this.designPreview: this.devPreview;

                if (this.prepareForImageChange) this.prepareForImageChange();
                this.state[`${type}Image`] = image;
                    this.updatePreview(previewId, file.name, image);
                    this.updateStartButton();

                console.log(`${type === 'design' ? '设计图' : '开发图'} 粘贴成功:`, file.name);
                } catch (error) {
                    console.error('图片粘贴失败: ', error);
                    alert('图片粘贴失败，请重试');
                }
            }

            // 显示粘贴成功的视觉反馈
            showPasteFeedback(type) {
                const uploadArea = type === 'design' ? this.designUpload: this.devUpload;

                // 添加闪光效果
                uploadArea.style.transition = 'all 0.2s ease';
                uploadArea.style.backgroundColor = 'rgba(52, 111, 230, 0.1)';
                uploadArea.style.borderColor = '#346fe6';

                // 显示临时提示
                const originalPlaceholder = uploadArea.querySelector('.upload-placeholder');
                if (originalPlaceholder) {
                    const originalDisplay = originalPlaceholder.style.display;
                    originalPlaceholder.style.display = 'none';

                    // 创建临时成功提示
                    const successMsg = document.createElement('div');
                    successMsg.className = 'upload-placeholder';
                    successMsg.innerHTML = `
                    <i class="icon circle-check" style="color: #38A169;"></i>
                    <p>粘贴成功</p>
                    <span class="upload-hint">图片已上传</span>
                    `;
                    uploadArea.appendChild(successMsg);

                    // 1.5秒后恢复原样
                    setTimeout(() => {
                        uploadArea.style.backgroundColor = '';
                        uploadArea.style.borderColor = '';
                        if (successMsg.parentNode === uploadArea) {
                            uploadArea.removeChild(successMsg);
                        }
                        originalPlaceholder.style.display = originalDisplay;
                    }, 1500);
                }
            }

            // 在类中添加一个检查方法
            checkElementsReady() {
                return new Promise((resolve) => {
                    const check = () => {
                        // 检查关键元素是否已渲染
                        if (this.sliderHandle.offsetParent &&
                        this.canvasWrapper.clientHeight > 0 &&
                        this.designCanvas.width > 0) {
                            resolve(true);
                        } else {
                            setTimeout(check, 50);
                        }
                    };
                    check();
                });
            }

            updateSliderIconPosition() {
                const bgContainer = this.sliderHandle.querySelector('.slider-handle-bg');
                if (!bgContainer) return;
                const sliderHeight = this.sliderHandle.offsetHeight ||
                    parseFloat(this.sliderHandle.style.height) || 0;
                const visibleCenter = this.canvasWrapper.scrollTop +
                    (this.canvasWrapper.clientHeight / 2);
                const clampedIconTop = Math.max(16, Math.min(visibleCenter, sliderHeight - 16));

                // 跟随滚动同步计算，不做防抖与 top 动画，手柄在可视区域中保持稳定。
                bgContainer.style.position = 'absolute';
                bgContainer.style.top = `${clampedIconTop}px`;
                bgContainer.style.left = '50%';
                bgContainer.style.transform = 'translate(-50%, -50%)';
                bgContainer.style.opacity = '1';
            }

            /**
            * 切换偏移菜单显示 - 基于手动打开成功的版本
            */
            toggleOffsetMenu(e) {
                e.preventDefault();
                e.stopPropagation();

                console.log('toggleOffsetMenu 被调用', '当前状态: ', this.isOffsetMenuOpen);

                if (!this.offsetToggle || !this.offsetMenu) {
                    console.error('偏移元素未初始化');
                    return;
                }

                if (this.isOffsetMenuOpen) {
                    this.closeOffsetMenu();
                } else {
                    // 关闭其他可能打开的菜单
                    if (typeof this.closeFloatingStatusMenu === 'function') {
                        this.closeFloatingStatusMenu();
                    }

                    // 获取按钮位置
                    const rect = this.offsetToggle.getBoundingClientRect();

                    // 计算菜单在按钮正上方显示的位置
                    const menuWidth = 78;  // 菜单宽度固定70px
                    const menuHeight = 200; // 菜单大概高度（根据内容估算）

                    // 水平方向与按钮中心对齐
                    // 按钮中心点 = rect.left + (rect.width / 2)
                    // 菜单左边距 = 按钮中心点 - (menuWidth / 2)
                    let left = rect.left + (rect.width / 2) - (menuWidth / 2);

                    // 垂直方向：在按钮正上方，留4px间隙
                    let top = rect.top - menuHeight - 16;

                    // 记录菜单位置类型（用于动画原点）
                    let positionType = 'top'; // 默认在上方

                    // 边界检查：确保菜单不超出视口顶部
                    if (top < 4) {
                        // 如果上方空间不足，改为下方显示
                        top = rect.bottom + 4;
                        positionType = 'bottom';
                    }

                    // 边界检查：确保菜单不超出左右边界
                    if (left + menuWidth > window.innerWidth) {
                        left = window.innerWidth - menuWidth - 4;
                    }
                    if (left < 4) {
                        left = 4;
                    }

                    // 根据位置设置动画原点类
                    if (positionType === 'bottom') {
                        this.offsetMenu.classList.add('position-bottom');
                        this.offsetMenu.classList.remove('position-top');
                    } else {
                        this.offsetMenu.classList.add('position-top');
                        this.offsetMenu.classList.remove('position-bottom');
                    }

                    // 设置基础样式
                    Object.assign(this.offsetMenu.style, {
                        position: 'fixed',
                        left: left + 'px',
                        top: top + 'px',
                        display: 'block',
                        backgroundColor: 'white',
                        zIndex: '1000000'
                    });

                    // 确保滑块容器显示
                    const container = this.offsetMenu.querySelector('.offset-slider-container');
                    if (container) {
                        container.style.display = 'flex';
                    }

                    // 强制重绘
                    this.offsetMenu.offsetHeight;

                    // 添加active类触发动画
                    this.offsetMenu.classList.add('active');

                    // 按钮激活状态
                    this.offsetToggle.classList.add('active');

                    // 更新状态
                    this.isOffsetMenuOpen = true;
                    document.body.classList.add('menu-open');

                console.log('菜单已打开', '位置:', { left, top, positionType });
                }
            }

            /**
            * 关闭偏移菜单
            */
            closeOffsetMenu() {
                console.log('closeOffsetMenu 被调用');

                if (!this.offsetMenu || !this.isOffsetMenuOpen) return;

                // 移除active类触发关闭动画
                this.offsetMenu.classList.remove('active');

                // 按钮取消激活状态
                if (this.offsetToggle) {
                    this.offsetToggle.classList.remove('active');
                }

                // 延迟隐藏菜单，等待动画完成
                setTimeout(() => {
                    // 再次检查，防止在延迟期间被重新打开
                    if (this.offsetMenu && !this.offsetMenu.classList.contains('active')) {
                        this.offsetMenu.style.display = 'none';
                    }
                }, 200); // 与CSS过渡时间一致

                this.isOffsetMenuOpen = false;
                document.body.classList.remove('menu-open');
            }

            /**
            * 处理偏移滑块变化
            */
            handleOffsetChange(e) {
                const viewOffset = parseInt(e.target.value); // 这是视觉上的偏移量

                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 转换为基准偏移量（存储时除以缩放比例）
                this.state.designYOffset = viewOffset / scale;

                if (this.offsetValue) {
                    this.offsetValue.textContent = viewOffset + 'px'; // 显示视觉偏移量
                }

                this.updateDesignPosition();
            }

            startDesignOffsetDrag(e) {
                if (!e.shiftKey || e.isPrimary === false || e.button !== 0 ||
                    !this.state.designImage || !this.state.devImage ||
                    this.comparisonContainer?.style.display === 'none') return;
                if (e.target?.closest?.('button, input, textarea, select, a, [contenteditable="true"]')) return;

                if (!this.isPointerOverDesignImage(e)) return;

                const scale = this.state.zoom / 100;
                const minViewOffset = Number(this.offsetSlider?.min ?? -400);
                const maxViewOffset = Number(this.offsetSlider?.max ?? 400);
                this.designOffsetDrag = {
                    pointerId: e.pointerId,
                    startClientY: e.clientY,
                    startViewOffset: this.state.designYOffset * scale,
                    scale,
                    minViewOffset,
                    maxViewOffset
                };
                this.canvasWrapper.classList.remove('shift-offset-ready');
                this.canvasWrapper.classList.add('shift-offset-dragging');
                try {
                    this.canvasWrapper.setPointerCapture?.(e.pointerId);
                } catch (_) {}
                e.preventDefault();
                e.stopPropagation();
            }

            isPointerOverDesignImage(e) {
                if (!this.canvasWrapper || !this.state.designImage || !this.state.devImage ||
                    this.comparisonContainer?.style.display === 'none') return false;
                const wrapperRect = this.canvasWrapper.getBoundingClientRect();
                const pointerX = e.clientX - wrapperRect.left + this.canvasWrapper.scrollLeft;
                const pointerY = e.clientY - wrapperRect.top + this.canvasWrapper.scrollTop;
                const designX = this.state.inspectionMode === 'side-by-side'
                    ? this.state.designCanvasOffsetX
                    : this.state.canvasOffsetX;
                const designWidth = this.state.imageWidth || 0;
                const designHeight = designWidth > 0
                    ? this.state.designImage.height * designWidth / this.state.designImage.width
                    : 0;
                const designY = this.state.canvasOffsetY || 0;
                const insideDesign = designWidth > 0 && designHeight > 0 &&
                    pointerX >= designX && pointerX <= designX + designWidth &&
                    pointerY >= designY && pointerY <= designY + designHeight;
                return insideDesign;
            }

            updateDesignOffsetHoverState(e) {
                if (!this.canvasWrapper || this.designOffsetDrag) return;
                const ready = !!e.shiftKey && this.isPointerOverDesignImage(e);
                this.canvasWrapper.classList.toggle('shift-offset-ready', ready);
            }

            moveDesignOffsetDrag(e) {
                const drag = this.designOffsetDrag;
                if (!drag || e.pointerId !== drag.pointerId) return;
                const deltaY = e.clientY - drag.startClientY;
                const viewOffset = Math.max(drag.minViewOffset,
                    Math.min(drag.maxViewOffset, Math.round(drag.startViewOffset + deltaY)));
                this.state.designYOffset = viewOffset / Math.max(0.0001, drag.scale);
                if (this.offsetSlider) this.offsetSlider.value = String(viewOffset);
                if (this.offsetValue) this.offsetValue.textContent = `${viewOffset}px`;
                this.updateDesignPosition();
                e.preventDefault();
            }

            stopDesignOffsetDrag(e) {
                const drag = this.designOffsetDrag;
                if (!drag || e.pointerId !== drag.pointerId) return;
                if (this.canvasWrapper.hasPointerCapture?.(e.pointerId)) {
                    this.canvasWrapper.releasePointerCapture(e.pointerId);
                }
                this.canvasWrapper.classList.remove('shift-offset-dragging');
                this.designOffsetDrag = null;
                this.updateDesignOffsetHoverState(e);
                if (this.markAsUnsaved) this.markAsUnsaved();
            }

            /**
            * 更新设计图位置（应用偏移）
            */
            updateDesignPosition() {
                if (!this.state.designImage || !this.state.devImage) return;

                // 重新计算对比视图
                this.updateComparison();

                // 如果当前在标注模式，重绘标注（标注不受偏移影响）
                this.drawAnnotations();
            }

            /**
            * 重置偏移值
            */
            resetOffset() {
                this.state.designYOffset = 0;
                if (this.offsetSlider) {
                    this.offsetSlider.value = 0;
                }
                if (this.offsetValue) {
                    this.offsetValue.textContent = '0px';
                }
                this.updateDesignPosition();
            }

            initCanvas() {
                this.resizeCanvas();
                window.addEventListener('resize', () => {
                    this.resizeCanvas();
                    if (this.state.designImage && this.state.devImage) {
                        this.updateComparison();
                        this.drawAnnotations();
                    }
                });
            }

            // 同时需要修改 resizeCanvas 方法：
            resizeCanvas() {
                // 在视检开始前保持默认尺寸
                const container = this.canvasWrapper;
                const width = container.clientWidth;
                const height = 400; // 默认高度，开始视检后会重新计算

                // 设置CSS样式尺寸
                [this.designCanvas, this.devCanvas, this.annotationCanvas].forEach(canvas => {
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
                });

                // 设置实际像素尺寸用于高清渲染
                this.setupCanvasBuffer(width, height);

                // 如果已经有图片，重新绘制
                if (this.state.designImage && this.state.devImage) {
                    setTimeout(() => {
                        this.drawAnnotations();
                    }, 50);
                }

            }

            // 设置Canvas缓冲区尺寸（考虑DPI）
            setupCanvasBuffer(cssWidth, cssHeight) {
                const dpr = this.devicePixelRatio;

                [this.designCanvas, this.devCanvas, this.annotationCanvas].forEach(canvas => {
                    // 设置实际像素尺寸 = CSS像素尺寸 × 设备像素比
                    canvas.width = Math.round(cssWidth * dpr);
                    canvas.height = Math.round(cssHeight * dpr);

                    // 缩放Canvas上下文以匹配设备像素比
                    const ctx = canvas.getContext('2d');
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                    // 设置高质量渲染
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                });
            }

            preventDefaults(e) {
                e.preventDefault();
                e.stopPropagation();
            }

            // 修改 handleImageUpload 方法，增加文件名校验
            async handleImageUpload(event, type) {
                const file = event.target.files[0];
                if (!file) return;

                const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
                if (!validTypes.includes(file.type)) {
                    alert('请上传PNG、JPG或WEBP格式的图片');
                    return;
                }

                if (file.size > 10 * 1024 * 1024) {
                    alert('图片大小不能超过10MB');
                    return;
                }

                try {
                    const image = await this.loadImage(file);
                    const previewId = type === 'design' ? this.designPreview: this.devPreview;

                this.state[`${type}Image`] = image;
                    this.updatePreview(previewId, file.name, image);
                    this.updateStartButton();
                } catch (error) {
                    console.error('图片加载失败: ', error);
                    alert('图片加载失败，请重试');
                }
            }

            loadImage(file) {
                return new Promise((resolve, reject) => {
                    // 读取用户上传文件的原始字节并保留原格式。后续保存历史时
                    // 可直接复用该 Data URL，不再通过 Canvas 转成 JPEG。
                    const reader = new FileReader();

                    reader.onload = () => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = reject;
                        img.src = reader.result;
                    };

                    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
                    reader.readAsDataURL(file);
                });
            }

            updatePreview(container, filename, image) {
                // 确保图片已经加载完成
                if (!image.complete) {
                    console.log('图片未加载完成，等待加载...');
                    image.onload = () => {
                        this._renderPreview(container, filename, image);
                    };
                } else {
                    this._renderPreview(container, filename, image);
                }
            }

            // 实际渲染预览方法
            _renderPreview(container, filename, image, isEmptyArea = false) {
                // 确保图片已经加载完成
                if (!image.complete) {
                    console.log('图片未加载完成，等待加载...');
                    image.onload = () => {
                        this._renderPreview(container, filename, image);
                    };
                    return;
                }

                // 直接使用image.src，它现在可能是Base64
                container.innerHTML = `
                <div class="preview-image">
        <img src="${image.src}" alt="${filename}" style="max-width: 100%; max-height: 150px; object-fit: contain;">
                </div>
                <div class="image-info">
            <div class="filename">${filename}</div>
        <div>尺寸: ${image.width} × ${image.height}px</div>
                </div>
                `;
                container.classList.add('active');
                console.log('预览更新完成: ', filename, '图片源类型:', image.src.substring(0, 30) + '...');
    // 🆕 同步紧凑版预览
    if (container === this.designPreview && this.designPreviewCompact) {
        this._renderCompactPreview(this.designPreviewCompact, filename, image);
    }
    if (container === this.devPreview && this.devPreviewCompact) {
        this._renderCompactPreview(this.devPreviewCompact, filename, image);
    }
            }

// 浮层图片上传处理
async handleCompactImageUpload(file, type) {
    // 验证文件类型
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        this.showToast('请上传PNG、JPG或WEBP格式的图片', 'error');
        return;
    }

    // 验证文件大小（10MB）
    if (file.size > 10 * 1024 * 1024) {
        this.showToast('图片大小不能超过10MB', 'error');
        return;
    }

    try {
        const image = await this.loadImage(file);
        
        if (this.prepareForImageChange) this.prepareForImageChange();
        // 更新主程序状态
        this.state[`${type}Image`] = image;
        
        // 更新左侧预览区
        const previewId = type === 'design' ? this.designPreview : this.devPreview;
        this.updatePreview(previewId, file.name, image);
        
        // 🆕 更新浮层预览区
        const compactPreview = type === 'design' ? this.designPreviewCompact : this.devPreviewCompact;
        this._renderCompactPreview(compactPreview, file.name, image);
        
        // 更新开始按钮状态
        this.updateStartButton();
        
        this.showToast(`${type === 'design' ? '设计图' : '开发图'}上传成功`, 'success');
        
    } catch (error) {
        console.error('图片加载失败: ', error);
        this.showToast('图片加载失败，请重试', 'error');
    }
}

// 紧凑版预览渲染
_renderCompactPreview(container, filename, image) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="preview-image">
            <img src="${image.src}" alt="${filename}">
        </div>
        <div class="image-info">
            <div class="filename">${filename}</div>
        </div>
    `;
    container.classList.add('active');
}

            handleDrop(e, type) {
                const dt = e.dataTransfer;
                const files = dt.files;

                if (files.length > 0) {
                    const input = type === 'design' ? this.designInput: this.devInput;
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(files[0]);
                    input.files = dataTransfer.files;
                this.handleImageUpload({ target: input }, type);
                }
            }

setInspectionMode(mode) {
    this.state.inspectionMode = mode;

    // 更新透明度控制显示
    this.opacityControl.classList.toggle('active', mode === 'overlay');

    // 如果已经在视检中，更新对比效果
    if (this.state.designImage && this.state.devImage) {
        this.updateComparison();
    }

    // 同步新的模式选择器滑块
    if (this.syncModeSelector) {
        this.syncModeSelector();
    }
                // 新历史按钮
		if (this.syncModeSelector) {
		    this.syncModeSelector();
		}
}

setBaseWidth(width, isCustom = false) {
    this.state.baseWidth = width;

    // 同步新的宽度选择器（如果有）
    if (this.syncWidthSelector) {
        this.syncWidthSelector(width);
    }

    // 如果已经在视检中，更新对比效果
    if (this.state.designImage && this.state.devImage) {
        this.updateComparison();
    }
}

updateStartButton() {
    const enabled = !!(this.state.designImage && this.state.devImage);
    if (this.startButton) {
        this.startButton.disabled = !enabled;
    }
   // 保存按钮：有图片内容时启用
   if (this.saveButton) {
       this.saveButton.disabled = !enabled;
   }
    // 同步紧凑版开始按钮状态
    if (this.startInspectionCompact) {
        this.startInspectionCompact.disabled = !enabled;
    }
    if (this.updateAIActionState) {
        this.updateAIActionState();
    }
}

            startInspection() {
                if (!this.state.designImage || !this.state.devImage) return;

                // 显示对比区域，隐藏空状态
                this.emptyState.style.display = 'none';
                this.comparisonContainer.style.display = 'flex';
                if (this.annotationCanvas) {
                    this.annotationCanvas.style.pointerEvents = this.state.annotationsVisible === false ? 'none' : 'auto';
                }

                // 更新对比效果
                this.updateComparison();

                // 绘制标注（确保在对比更新后）
                setTimeout(() => {
                    this.drawAnnotations();
                    console.log('标注绘制完成');
                }, 50);

                if (this.scheduleAutoInspection) {
                    this.scheduleAutoInspection();
                }

                // 更新缩放显示
            this.zoomLevelSpan.textContent = `${this.state.zoom}%`;

                // 如果是滑杆模式，多次尝试更新icon位置
                if (this.state.inspectionMode === 'slider') {
                    setTimeout(() => this.updateSliderIconPosition(), 0);
                    setTimeout(() => this.updateSliderIconPosition(), 50);
                    setTimeout(() => this.updateSliderIconPosition(), 150);
                    setTimeout(() => this.updateSliderIconPosition(), 300);
                }

    // 插件画布跟随“显示/隐藏标注”状态，避免隐藏后仍可盲操作。
    if (window.drawingToolbar) {
        const pluginInstance = window.drawingToolbar.getInstance();
        if (pluginInstance && pluginInstance.drawCanvas) {
            const annotationsVisible = this.state.annotationsVisible !== false;
            pluginInstance.drawCanvas.style.display = annotationsVisible ? 'block' : 'none';
            pluginInstance.drawCanvas.style.visibility = annotationsVisible ? 'visible' : 'hidden';
            pluginInstance.drawCanvas.style.opacity = annotationsVisible ? '1' : '0';
            pluginInstance.drawCanvas.style.pointerEvents = annotationsVisible ? '' : 'none';
        }
    }
            }

            updateComparison() {
                if (!this.state.designImage || !this.state.devImage) return;

                const scale = this.state.zoom / 100;
                const baseWidth = this.state.baseWidth * scale; // 这是CSS像素尺寸
                const isSideBySide = this.state.inspectionMode === 'side-by-side';
                const sideBySideGap = 24;
                const sideBySideLabelHeight = 36;

                // 计算缩放比例（基于CSS像素）
                const designScale = baseWidth / this.state.designImage.width;
                const devScale = baseWidth / this.state.devImage.width;

                // 计算实际尺寸（CSS像素）
                const designHeight = this.state.designImage.height * designScale;
                const devHeight = this.state.devImage.height * devScale;

                // 计算最大高度（CSS像素）
                const maxHeight = Math.max(designHeight, devHeight);

                // 获取容器可见区域高度（CSS像素）
                const containerHeight = this.canvasWrapper.clientHeight;

                // 左右模式将两张图按各自基准宽度铺开；旧模式继续使用原重叠尺寸。
                const comparisonWidth = isSideBySide ? (baseWidth * 2 + sideBySideGap) : baseWidth;
                const longScreenshotBottomSpace = this.getLongScreenshotBottomSpace
                    ? this.getLongScreenshotBottomSpace()
                    : 0;
                const comparisonHeight = maxHeight +
                    (isSideBySide ? sideBySideLabelHeight : 0) + longScreenshotBottomSpace;
                const canvasWidth = Math.max(this.canvasWrapper.clientWidth, comparisonWidth);
                const canvasHeight = Math.max(containerHeight, comparisonHeight);

                // 设置CSS样式尺寸
                [this.designCanvas, this.devCanvas, this.annotationCanvas].forEach(canvas => {
                canvas.style.width = `${canvasWidth}px`;
                canvas.style.height = `${canvasHeight}px`;
                });

                // 设置实际像素尺寸用于高清渲染
                this.setupCanvasBuffer(canvasWidth, canvasHeight);

                if (isSideBySide) {
                    // canvasOffsetX/Y 始终代表开发图边界，所有标注继续只绑定开发图。
                    const comparisonX = Math.max(0, (canvasWidth - comparisonWidth) / 2);
                    const comparisonY = comparisonHeight < containerHeight
                        ? Math.max(0, (containerHeight - comparisonHeight) / 2)
                        : 0;

                    this.state.designCanvasOffsetX = comparisonX;
                    this.state.canvasOffsetX = comparisonX + baseWidth + sideBySideGap;
                    this.state.canvasOffsetY = comparisonY + sideBySideLabelHeight;
                    this.state.imageWidth = baseWidth;
                    this.state.imageHeight = devHeight;
                } else {
                    // 旧模式保持原有居中、尺寸和标注边界逻辑。
                    this.state.canvasOffsetX = Math.max(0, (canvasWidth - baseWidth) / 2);
                    this.state.designCanvasOffsetX = this.state.canvasOffsetX;
                    if (maxHeight + longScreenshotBottomSpace < containerHeight) {
                        this.state.canvasOffsetY = Math.max(0,
                            (containerHeight - maxHeight - longScreenshotBottomSpace) / 2);
                    } else {
                        this.state.canvasOffsetY = 0;
                    }
                    this.state.imageWidth = baseWidth;
                    this.state.imageHeight = maxHeight;
                }

                // 根据模式选择渲染方式
                switch (this.state.inspectionMode) {
                    case 'side-by-side':
                    this.clearAllCanvases();
                    this.renderSideBySideMode(baseWidth, designHeight, devHeight, sideBySideLabelHeight);
                    break;
                    case 'slider': 
                    this.clearAllCanvases();
                    this.renderSliderMode(baseWidth, designHeight, devHeight, designScale, devScale);
                    break;
                    case 'overlay': 
                    this.clearAllCanvases();
                    this.renderOverlayMode(baseWidth, designHeight, devHeight, designScale, devScale);
                    break;
                    case 'invert': 
                    this.clearAllCanvases();
                    this.renderInvertMode(baseWidth, designHeight, devHeight, designScale, devScale);
                    break;
                }

                // 只有滑杆模式需要更新遮罩；其它模式调用会清空开发图画布。
                if (this.state.inspectionMode === 'slider') {
                    this.updateSliderPosition();
                }

                // 重要：更新对比后重新绘制标注
                this.drawAnnotations();
                
                // 使用双重 requestAnimationFrame 确保布局稳定后计算
                if (this.state.inspectionMode === 'slider') {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            this.updateSliderIconPosition();
                        });
                    });
                }

            }

            clearAllCanvases() {
                // 使用CSS像素尺寸清除
                const cssWidth = this.designCanvas.width / this.devicePixelRatio;
                const cssHeight = this.designCanvas.height / this.devicePixelRatio;

                this.designCtx.clearRect(0, 0, cssWidth, cssHeight);
                this.devCtx.clearRect(0, 0, cssWidth, cssHeight);
            }

            fillCheckerboard(ctx, x, y, width, height) {
                if (!ctx || width <= 0 || height <= 0) return;
                if (!this.comparisonCheckerTile) {
                    const tile = document.createElement('canvas');
                    tile.width = 24;
                    tile.height = 24;
                    const tileCtx = tile.getContext('2d');
                    tileCtx.fillStyle = '#e8ecf2';
                    tileCtx.fillRect(0, 0, 24, 24);
                    tileCtx.fillStyle = '#f7f8fa';
                    tileCtx.fillRect(0, 0, 12, 12);
                    tileCtx.fillRect(12, 12, 12, 12);
                    this.comparisonCheckerTile = tile;
                }
                ctx.save();
                ctx.fillStyle = ctx.createPattern(this.comparisonCheckerTile, 'repeat') || '#e8ecf2';
                ctx.fillRect(x, y, width, height);
                ctx.restore();
            }

            renderSideBySideMode(width, designHeight, devHeight, labelHeight) {
                const designX = this.state.designCanvasOffsetX;
                const devX = this.state.canvasOffsetX;
                const imageY = this.state.canvasOffsetY;
                const scale = this.state.zoom / 100;
                const designY = imageY + (this.state.designYOffset * scale);
                const labelY = imageY - labelHeight;

                // 两张图分别绘制在独立区域，开发图画布保持在右侧。
                this.fillCheckerboard(this.designCtx, designX, imageY, width, designHeight);
                this.fillCheckerboard(this.devCtx, devX, imageY, width, devHeight);

                this.designCtx.save();
                this.designCtx.beginPath();
                this.designCtx.rect(designX, imageY, width, designHeight);
                this.designCtx.clip();
                this.designCtx.drawImage(
                    this.state.designImage,
                    0, 0, this.state.designImage.width, this.state.designImage.height,
                    designX, designY, width, designHeight
                );
                this.designCtx.restore();

                this.devCtx.drawImage(
                    this.state.devImage,
                    0, 0, this.state.devImage.width, this.state.devImage.height,
                    devX, imageY, width, devHeight
                );

                this.drawSideBySideLabel(this.designCtx, designX, labelY, width, labelHeight, '设计图');
                this.drawSideBySideLabel(this.devCtx, devX, labelY, width, labelHeight, '开发图');
                this.sliderHandle.style.display = 'none';
            }

            drawSideBySideLabel(ctx, x, y, width, height, text) {
                ctx.save();
                ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                const horizontalPadding = 12;
                const pillHeight = height - 8;
                const pillWidth = Math.min(width, Math.ceil(ctx.measureText(text).width) + horizontalPadding * 2);
                const pillX = x + (width - pillWidth) / 2;
                const pillY = y + 4;
                const radius = pillHeight / 2;

                ctx.beginPath();
                ctx.moveTo(pillX + radius, pillY);
                ctx.lineTo(pillX + pillWidth - radius, pillY);
                ctx.quadraticCurveTo(pillX + pillWidth, pillY, pillX + pillWidth, pillY + radius);
                ctx.lineTo(pillX + pillWidth, pillY + pillHeight - radius);
                ctx.quadraticCurveTo(pillX + pillWidth, pillY + pillHeight, pillX + pillWidth - radius, pillY + pillHeight);
                ctx.lineTo(pillX + radius, pillY + pillHeight);
                ctx.quadraticCurveTo(pillX, pillY + pillHeight, pillX, pillY + pillHeight - radius);
                ctx.lineTo(pillX, pillY + radius);
                ctx.quadraticCurveTo(pillX, pillY, pillX + radius, pillY);
                ctx.closePath();
                ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, pillX + pillWidth / 2, pillY + pillHeight / 2);
                ctx.restore();
            }

            renderSliderMode(width, designHeight, devHeight, designScale, devScale) {
                const x = this.state.canvasOffsetX;
                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 计算视图偏移量 = 基准偏移量 × 缩放比例
                const viewOffset = this.state.designYOffset * scale;

                // 设计图应用视图偏移
                const designY = this.state.canvasOffsetY + viewOffset;
                const devY = this.state.canvasOffsetY;

                const maxHeight = Math.max(designHeight, devHeight);

    // 在图片区域填充背景色，偏移时显示得明显一点
    if (this.state.imageWidth > 0 && this.state.imageHeight > 0) {
        const x = this.state.canvasOffsetX;
        const y = this.state.canvasOffsetY;
        const w = this.state.imageWidth;
        const h = this.state.imageHeight;
        this.fillCheckerboard(this.designCtx, x, y, w, h);
        this.fillCheckerboard(this.devCtx, x, y, w, h);
    }

                // 设置高质量渲染
                this.designCtx.imageSmoothingEnabled = true;
                this.designCtx.imageSmoothingQuality = 'high';
                this.devCtx.imageSmoothingEnabled = true;
                this.devCtx.imageSmoothingQuality = 'high';

                // 保存设计图画布状态
                this.designCtx.save();

                // 创建裁剪区域：只绘制原始画布范围内的部分
                this.designCtx.beginPath();
                this.designCtx.rect(x, devY, width, designHeight); // 使用 devY 和 designHeight 作为裁剪区域
                this.designCtx.clip();

                // 绘制设计图（应用偏移），超出裁剪区域的部分会被裁剪
                this.designCtx.drawImage(
                this.state.designImage,
                0, 0, this.state.designImage.width, this.state.designImage.height,
                x, designY, width, designHeight
                );

                // 恢复设计图画布状态
                this.designCtx.restore();

                // 绘制开发图（保持不变，不需要裁剪）
                this.devCtx.drawImage(
                this.state.devImage,
                0, 0, this.state.devImage.width, this.state.devImage.height,
                x, devY, width, devHeight
                );

                // 显示滑动条
                this.sliderHandle.style.display = 'block';

                // 收进虚线框 1px，避免高分屏抗锯齿让滑杆越过图片底边。
                this.sliderHandle.style.height = `${Math.max(0, this.state.imageHeight - 1)}px`;

                // 设置滑杆滑动范围（CSS像素）
                const sliderMinX = x;
                const sliderMaxX = x + width;
                this.sliderHandle.setAttribute('data-min-x', sliderMinX);
                this.sliderHandle.setAttribute('data-max-x', sliderMaxX);

                // 设置滑杆的初始位置（中间）
                const initialX = x + width / 2;
                this.sliderHandle.style.left = `${initialX}px`;
                this.sliderHandle.style.top = `${devY}px`;  // 滑杆位置跟随开发图

                // 更新遮罩
                this.updateSliderMask(initialX);
            }

            renderOverlayMode(width, designHeight, devHeight, designScale, devScale) {
                const x = this.state.canvasOffsetX;
                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 计算视图偏移量 = 基准偏移量 × 缩放比例
                const viewOffset = this.state.designYOffset * scale;

                // 设计图应用视图偏移
                const designY = this.state.canvasOffsetY + viewOffset;
                const devY = this.state.canvasOffsetY;

                // 保存设计图画布状态
                this.designCtx.save();

                // 创建裁剪区域
                this.designCtx.beginPath();
                this.designCtx.rect(x, devY, width, designHeight);
                this.designCtx.clip();

                // 绘制设计图（应用偏移）
                this.designCtx.drawImage(
                this.state.designImage,
                0, 0, this.state.designImage.width, this.state.designImage.height,
                x, designY, width, designHeight
                );

                // 恢复画布状态（因为要叠加开发图，需要移除裁剪）
                this.designCtx.restore();

                // 再绘制开发图（设置透明度叠加）- 不需要裁剪
                this.designCtx.save();
                this.designCtx.globalAlpha = this.state.opacity / 100;
                this.designCtx.drawImage(
                this.state.devImage,
                0, 0, this.state.devImage.width, this.state.devImage.height,
                x, devY, width, devHeight
                );
                this.designCtx.restore();

                // 隐藏滑动条
                this.sliderHandle.style.display = 'none';
            }

            renderInvertMode(width, designHeight, devHeight, designScale, devScale) {
                const x = this.state.canvasOffsetX;
                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 计算视图偏移量 = 基准偏移量 × 缩放比例
                const viewOffset = this.state.designYOffset * scale;

                // 设计图应用视图偏移
                const designY = this.state.canvasOffsetY + viewOffset;
                const devY = this.state.canvasOffsetY;

                // 保存设计图画布状态
                this.designCtx.save();

                // 创建裁剪区域
                this.designCtx.beginPath();
                this.designCtx.rect(x, devY, width, designHeight);
                this.designCtx.clip();

                // 绘制设计图（应用偏移）
                this.designCtx.drawImage(
                this.state.designImage,
                0, 0, this.state.designImage.width, this.state.designImage.height,
                x, designY, width, designHeight
                );

                // 恢复画布状态
                this.designCtx.restore();

                // 创建一个临时canvas用于反相处理
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');

                // 设置临时canvas尺寸（考虑DPI）
                const dpr = this.devicePixelRatio;
                tempCanvas.width = Math.round(width * dpr);
                tempCanvas.height = Math.round(devHeight * dpr);

                // 缩放临时canvas上下文
                tempCtx.save();
                tempCtx.scale(dpr, dpr);
                tempCtx.imageSmoothingEnabled = true;
                tempCtx.imageSmoothingQuality = 'high';

                // 绘制开发图到临时canvas（使用CSS像素尺寸）
                tempCtx.drawImage(
                this.state.devImage,
                0, 0, this.state.devImage.width, this.state.devImage.height,
                0, 0, width, devHeight
                );

                // 获取图像数据并进行反相处理
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;

                // 反相算法：每个像素的RGB值取反
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = 255 - data[i];     // R
                    data[i + 1] = 255 - data[i + 1]; // G
                    data[i + 2] = 255 - data[i + 2]; // B
                    // Alpha通道保持不变
                }

                // 将处理后的图像数据放回临时canvas
                tempCtx.putImageData(imageData, 0, 0);
                tempCtx.restore();

                // 将反相后的图像绘制到设计图画布上（不需要裁剪）
                this.designCtx.save();
                this.designCtx.globalAlpha = 0.7;
                this.designCtx.drawImage(tempCanvas, x, devY, width, devHeight);
                this.designCtx.restore();

                // 隐藏滑动条
                this.sliderHandle.style.display = 'none';
            }

            startSliderMove(e) {
                if (e.isPrimary === false) return;
                e.preventDefault();
                e.stopPropagation();
                this.isSliderMoving = true;
                this.sliderPointerId = e.pointerId;
                try {
                    this.sliderHandle.setPointerCapture(e.pointerId);
                } catch (_) {}
                this.sliderHandle.style.cursor = 'ew-resize';
            }

            moveSlider(e) {
                if (!this.isSliderMoving) return;
                if (this.sliderPointerId !== undefined && e.pointerId !== this.sliderPointerId) return;

                const container = this.annotationCanvas.getBoundingClientRect();
                const x = e.clientX - container.left;

                // 获取滑杆限制范围
                const minX = parseFloat(this.sliderHandle.getAttribute('data-min-x')) || this.state.canvasOffsetX;
                const maxX = parseFloat(this.sliderHandle.getAttribute('data-max-x')) || (this.state.canvasOffsetX + this.state.imageWidth);

                // 限制滑杆在图片区域内
                const clampedX = Math.max(minX, Math.min(x, maxX));

            this.sliderHandle.style.left = `${clampedX}px`;

                // 更新画布遮罩
                this.updateSliderMask(clampedX);
            }

            updateSliderMask(sliderX) {
                const cssWidth = this.designCanvas.width / this.devicePixelRatio;
                const cssHeight = this.designCanvas.height / this.devicePixelRatio;
                const imageX = this.state.canvasOffsetX;
                const imageY = this.state.canvasOffsetY;  // 开发图的Y位置
                const imageWidth = this.state.imageWidth;
                const maxHeight = this.state.imageHeight;

                // 清除开发图画布
                this.devCtx.clearRect(0, 0, cssWidth, cssHeight);

                if (this.state.inspectionMode === 'slider' && this.state.designImage && this.state.devImage) {
                    const scale = this.state.zoom / 100;
                    const baseWidth = this.state.baseWidth * scale;
                    const devScale = baseWidth / this.state.devImage.width;
                    const devHeight = this.state.devImage.height * devScale;

                    // 保存当前状态
                    this.devCtx.save();

                    // 创建裁剪区域：只显示滑杆右侧的部分
                    this.devCtx.beginPath();
                    this.devCtx.rect(sliderX, imageY, cssWidth - sliderX, maxHeight);
                    this.devCtx.clip();

                    // 开发图一侧先铺透明格底；当两图高度不一致时，不再透出下层设计图。
                    this.fillCheckerboard(this.devCtx, imageX, imageY, imageWidth, maxHeight);

                    // 设置高质量渲染
                    this.devCtx.imageSmoothingEnabled = true;
                    this.devCtx.imageSmoothingQuality = 'high';

                    // 绘制开发图（使用CSS像素尺寸）- 保持原位置
                    this.devCtx.drawImage(
                    this.state.devImage,
                    0, 0, this.state.devImage.width, this.state.devImage.height,
                    imageX, imageY, imageWidth, devHeight
                    );

                    // 恢复状态
                    this.devCtx.restore();

                    // 绘制滑杆左侧的遮罩层
                    this.devCtx.fillStyle = 'rgba(0, 0, 0, 0.0)';
                    this.devCtx.fillRect(0, imageY, sliderX, maxHeight);
                }
            }

            updateSliderPosition() {
                const imageX = this.state.canvasOffsetX;
                const imageWidth = this.state.imageWidth;
                const imageY = this.state.canvasOffsetY;

                // 设置滑杆限制范围
                this.sliderHandle.setAttribute('data-min-x', imageX);
                this.sliderHandle.setAttribute('data-max-x', imageX + imageWidth);

                // 设置滑杆位置和高度
                const initialX = imageX + imageWidth / 2;
            this.sliderHandle.style.left = `${initialX}px`;
            this.sliderHandle.style.top = `${imageY}px`;
            // 收进虚线框 1px；滑杆现在位于可滚动画布内，会与长截图同步滚动。
            this.sliderHandle.style.height = `${Math.max(0, this.state.imageHeight - 1)}px`;

                this.updateSliderMask(initialX);
            }

            stopSliderMove(e) {
                if (e && this.sliderPointerId !== undefined && e.pointerId !== this.sliderPointerId) return;
                this.isSliderMoving = false;
                if (e && this.sliderHandle.hasPointerCapture?.(e.pointerId)) {
                    this.sliderHandle.releasePointerCapture(e.pointerId);
                }
                this.sliderPointerId = undefined;
                this.sliderHandle.style.cursor = 'ew-resize';
            }

            zoomIn() {
                if (this.state.zoom < 300) {
                    this.state.zoom += 10;
                    this.animateZoom(); // 改为调用 animateZoom，而不是直接更新
                }
            }

            zoomOut() {
                if (this.state.zoom > 10) {
                    this.state.zoom -= 10;
                    this.animateZoom(); // 改为调用 animateZoom，而不是直接更新
                }
            }

            resetZoom() {
                this.state.zoom = 100;
                this.animateZoom(); // 改为调用 animateZoom，而不是直接更新
            }

            updateZoom() {
            this.zoomLevelSpan.textContent = `${this.state.zoom}%`;

                // 清除所有标注的视图坐标缓存，强制重新计算
                this.state.annotations.forEach(annotation => {
                    delete annotation.viewX;
                    delete annotation.viewY;
                    delete annotation.viewWidth;
                    delete annotation.viewHeight;
                });

                if (this.state.designImage && this.state.devImage) {
                    // 开始动画
                    this.animateZoom();
                }
            }

            /**
            * 平滑缩放动画 - 缓进缓出
            */
            animateZoom() {
                if (this._zoomAnimationId) {
                    cancelAnimationFrame(this._zoomAnimationId);
                }

                const startTime = performance.now();
                const duration = 200;

                const startZoom = this._lastZoom || 100;
                const targetZoom = this.state.zoom;

                if (startZoom === targetZoom) return;

                this._lastZoom = targetZoom;

                const animate = (currentTime) => {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);

                    const easeProgress = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

                    const currentZoom = startZoom + (targetZoom - startZoom) * easeProgress;

                    // 更新 zoom-level 显示（实时更新）
                    if (this.zoomLevelSpan) {
                    this.zoomLevelSpan.textContent = `${Math.round(currentZoom)}%`;
                    }

                    // 保存当前 state.zoom
                    const originalZoom = this.state.zoom;

                    // 临时设置缩放值
                    this.state.zoom = currentZoom;

                    // 更新对比视图
                    this.updateComparison();

                    // 恢复原始值
                    this.state.zoom = originalZoom;

                    if (progress < 1) {
                        this._zoomAnimationId = requestAnimationFrame(animate);
                    } else {
                        // 动画结束，使用目标值
                        this.state.zoom = targetZoom;
                        this.updateComparison();
                        if (this.zoomLevelSpan) {
                        this.zoomLevelSpan.textContent = `${targetZoom}%`;
                        }
                        this._zoomAnimationId = null;
                    }
                };

                this._zoomAnimationId = requestAnimationFrame(animate);
            }

            /**
            * 使用指定的缩放值渲染
            */
            _renderWithZoom(zoomValue) {
                // 保存当前的 state.zoom
                const originalZoom = this.state.zoom;

                // 临时设置缩放值
                this.state.zoom = zoomValue;

                // 更新对比视图
                this.updateComparison();

                // 恢复原始的 state.zoom（因为 updateComparison 内部会使用 this.state.zoom）
                // 注意：这里需要在 updateComparison 之后恢复，但 updateComparison 是异步的
                // 所以我们使用 setTimeout 延迟恢复
                setTimeout(() => {
                    this.state.zoom = originalZoom;
                }, 0);
            }

};
