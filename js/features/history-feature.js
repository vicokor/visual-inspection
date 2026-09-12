/**
 * 历史记录功能
 * 负责保存/恢复、历史侧边栏、批量选择与历史报告画布生成。
 */
const withHistoryFeature = (Base) => class extends Base {
    initHistoryEvents() {
        if (this.sidebarOverlay) {
            this.sidebarOverlay.addEventListener('click', () => this.closeHistorySidebar());
        }

        // 新增：保存按钮事件
        if (this.saveButton) {
            this.saveButton.addEventListener('click', () => this.saveCurrentState());
        }

        // 新增：历史侧边栏事件
        if (this.historyToggle) {
            this.historyToggle.addEventListener('click', () => this.toggleHistorySidebar());
        }
        if (this.historyClose) {
            this.historyClose.addEventListener('click', () => this.closeHistorySidebar());
        }
        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', () => this.confirmClearHistory());
        }

        // 新增：未保存确认弹窗事件
        if (this.unsavedSaveBtn) {
            this.unsavedSaveBtn.addEventListener('click', () => this.handleUnsavedSave());
        }
        if (this.unsavedDiscardBtn) {
            this.unsavedDiscardBtn.addEventListener('click', () => this.handleUnsavedDiscard());
        }
        if (this.unsavedCancelBtn) {
            this.unsavedCancelBtn.addEventListener('click', () => this.closeUnsavedModal());
        }

// 历史侧边栏唤起调用
if (this.navMenuBtn) {
    this.navMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 唤起历史侧边栏
        if (this.historyToggle) {
            this.historyToggle.click();
        } else {
            this.toggleHistorySidebar();
        }
    });
}

// 清空历史确认弹窗事件
if (this.clearHistoryCancelBtn) {
    this.clearHistoryCancelBtn.addEventListener('click', () => {
        this.closeClearHistoryModal();
    });
}

if (this.clearHistoryConfirmBtn) {
    this.clearHistoryConfirmBtn.addEventListener('click', () => {
        this.performClearHistory();
    });
}

if (this.clearHistoryModal) {
    this.clearHistoryModal.addEventListener('click', (e) => {
        if (e.target === this.clearHistoryModal) {
            this.closeClearHistoryModal();
        }
    });
}
    }

    async saveCurrentState() {
        if (!this.state.designImage || !this.state.devImage) {
            this.showToast('请先上传图片', 'error');
            return;
        }

        try {
            // 显示保存中状态
            this.saveButton.innerHTML = '<i class="icon loader"></i> 保存中';
            this.saveButton.disabled = true;

            console.log('开始保存当前状态...');

            // 判断是覆盖还是新建
            const isOverwrite = this.currentSavedTimestamp !== null;

            // 准备数据（使用当前时间作为基础）
            const now = Date.now();
            const date = new Date(now);

            // 将图片转换为Base64
            console.log('转换设计图到Base64...');
            const designBase64 = await this.imageToBase64(this.state.designImage);

            console.log('转换开发图到Base64...');
            const devBase64 = await this.imageToBase64(this.state.devImage);

            // 创建预览图
            console.log('创建预览图...');
            const previewBase64 = await this.imageToBase64(this.state.devImage, 560, 0.98);

            // 构建保存数据对象
            const saveData = {
                // 注意：这里先用旧时间戳占位，update方法会生成新时间戳
                timestamp: isOverwrite ? this.currentSavedTimestamp : now,
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,

                // 图片数据（Base64格式）
                designImageBase64: designBase64,
                devImageBase64: devBase64,

                // 原始图片尺寸
                designWidth: this.state.designImage.width,
                designHeight: this.state.designImage.height,
                devWidth: this.state.devImage.width,
                devHeight: this.state.devImage.height,

                // 标注数据
                annotations: this.state.annotations.map(a => ({
                    id: a.id,
                    baseX: a.baseX,
                    baseY: a.baseY,
                    baseWidth: a.baseWidth,
                    baseHeight: a.baseHeight,
                    description: a.description || '',
                    status: a.status || 'pending',
                    source: a.source || 'manual',
                    category: a.category || '',
                    confidence: Number.isFinite(a.confidence) ? a.confidence : null,
                    reviewStatus: a.reviewStatus || '',
                    analysisId: a.analysisId || null
                })),

// 👈 插件标注数据
pluginAnnotations: (window.getPluginAnnotations ? window.getPluginAnnotations() : []).map(ann => {
    // 深拷贝，避免引用问题
    return JSON.parse(JSON.stringify(ann));
}),

                // 视检状态
                inspectionMode: this.state.inspectionMode,
                baseWidth: this.state.baseWidth,
                opacity: this.state.opacity,

                // 预览图数据
                preview: previewBase64,

                // 新增：保存偏移量（基准值）
                designYOffset: this.state.designYOffset,

                // 长截图为可选扩展字段；旧记录无需迁移，数据库版本保持不变。
                longScreenshot: this.serializeLongScreenshotForHistory
                    ? this.serializeLongScreenshotForHistory()
                    : null
            };

            console.log('保存数据准备完成:', {
                mode: isOverwrite ? '覆盖' : '新建',
                oldTimestamp: isOverwrite ? this.currentSavedTimestamp : '无',
                annotationsCount: saveData.annotations.length
            });

            let newTimestamp;

            if (isOverwrite) {
                // 覆盖模式：更新数据，返回新的时间戳
                newTimestamp = await this.historyStorage.update(saveData);
                this.showToast('更新成功', 'success');
            } else {
                // 新建模式：创建新记录
                await this.historyStorage.save(saveData);
                newTimestamp = saveData.timestamp;
                this.showToast('保存成功', 'success');
            }

            // 更新状态为新的时间戳
            this.currentSavedTimestamp = newTimestamp;
            this.hasUnsavedChanges = false;
            this.updateSaveButtonState();

            console.log('保存完成，当前编辑时间戳: ', newTimestamp);

            // 刷新历史侧边栏（如果打开）
            if (this.isSidebarOpen) {
                await this.loadHistoryList();
            }

        } catch (error) {
            console.error('保存失败: ', error);
            this.showToast('保存失败：' + error.message, 'error');
            this.saveButton.innerHTML = '<i class="icon check"></i> 保存';
            this.saveButton.disabled = false;
        }
    }

    // 新增：创建预览图
    async createPreview(blob) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // 缩放预览图到合适尺寸
                const maxSize = 140;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height = height * (maxSize / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = width * (maxSize / height);
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                // 转为base64预览
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = URL.createObjectURL(blob);
        });
    }

    // 显示Toast提示

    async toggleHistorySidebar() {
        if (this.isSidebarOpen) {
            this.closeHistorySidebar();
        } else {
            await this.openHistorySidebar();
        }
    }

// 修改：打开历史侧边栏
async openHistorySidebar() {
    this.isSidebarOpen = true;
    this.historySidebar.classList.add('active');
    this.appContainer.classList.add('sidebar-active');
    if (this.sidebarOverlay) {
        this.sidebarOverlay.classList.add('active');
    }

    // 退出批量选择模式
    if (this.isBatchSelectMode) {
        this.isBatchSelectMode = false;
        this.selectedBatchItems.clear();
    }

    // 加载历史记录列表
    console.log('打开侧边栏，加载历史记录');
    await this.loadHistoryList();
    
    // 初始化批量导出按钮
    this.initBatchExportButtons();
}

// 关闭历史侧边栏
closeHistorySidebar() {
    // 如果未保存确认弹窗正在显示，阻止关闭侧边栏
    if (this.unsavedModal && this.unsavedModal.classList.contains('active')) {
        return;
    }
    
    this.isSidebarOpen = false;
    
    // 退出批量选择模式
    if (this.isBatchSelectMode) {
        this.isBatchSelectMode = false;
        this.selectedBatchItems.clear();
        this.updateFooterButtons();
    }
    
    this.historySidebar.classList.remove('active');
    this.appContainer.classList.remove('sidebar-active');
    if (this.sidebarOverlay) {
        this.sidebarOverlay.classList.remove('active');
    }
}

// ===== 新增：批量导出功能 =====

/**
 * 初始化批量导出按钮（在侧边栏打开时调用）
 */
initBatchExportButtons() {
    // 在标题中添加导出按钮
    const headerElement = this.historySidebar.querySelector('.history-sidebar-header');
    if (!headerElement) return;
    
    // 移除旧的按钮（如果存在）
    const existingBtn = headerElement.querySelector('#batch-export-btn');
    if (existingBtn) existingBtn.remove();
    
    // 创建导出按钮
    const exportBtn = document.createElement('button');
    exportBtn.id = 'batch-export-btn';
    exportBtn.innerHTML = '导出';
    exportBtn.title = '批量导出';
    
    // 插入到标题后面
    const titleElement = headerElement.querySelector('h3');
    if (titleElement) {
        titleElement.after(exportBtn);
    } else {
        headerElement.appendChild(exportBtn);
    }
    
    this.batchExportBtn = exportBtn;
    
    // 绑定点击事件
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleBatchSelectMode();
    });
    
    // 初始化底部按钮（在 loadHistoryList 中动态更新）
    this.updateFooterButtons();
}

/**
 * 切换批量选择模式
 */
toggleBatchSelectMode() {
    this.isBatchSelectMode = !this.isBatchSelectMode;
    this.selectedBatchItems.clear();
    
    if (this.isBatchSelectMode) {
        this.enterBatchSelectMode();
    } else {
        this.exitBatchSelectMode();
    }
    
    this.updateBatchUI();
}

/**
 * 进入批量选择模式
 */
enterBatchSelectMode() {
    if (this.batchExportBtn) {
        this.batchExportBtn.innerHTML = '取消';
        this.batchExportBtn.classList.add('cancel-mode');
    }
    
    // 显示所有复选框
    this.showAllCheckboxes(true);
    
    // 更新计数（此时 isBatchSelectMode = true，会显示计数）
    this.updateBatchSelectCount();
}

/**
 * 退出批量选择模式
 */
exitBatchSelectMode() {
    if (this.batchExportBtn) {
        this.batchExportBtn.innerHTML = '导出';
        this.batchExportBtn.classList.remove('cancel-mode');
    }
    
    // 隐藏所有复选框
    this.showAllCheckboxes(false);
    
    // 移除计数标签
    this.removeBatchSelectCount();
    
    // 恢复底部按钮
    this.updateFooterButtons();
}

/**
 * 显示/隐藏所有复选框
 */
showAllCheckboxes(visible) {
    const checkboxes = this.historyContent.querySelectorAll('.history-item-checkbox');
    checkboxes.forEach(cb => {
        if (visible) {
            cb.classList.add('visible');
        } else {
            cb.classList.remove('visible', 'checked');
        }
    });
}

/**
 * 更新底部按钮区域
 */
updateFooterButtons() {
    const footer = this.historySidebar.querySelector('.history-sidebar-footer');
    if (!footer) return;
    
    if (this.isBatchSelectMode) {
        // 批量选择模式：显示导出和取消按钮
        footer.innerHTML = `
            <div class="batch-export-actions">
                <button id="batch-export-cancel">
                    <i class="icon x"></i> 取消
                </button>
                <button id="batch-export-pdf" disabled>
                    <i class="icon icon file-type-pdf"></i> 导出PDF
                </button>
            </div>
        `;
        
        // 绑定事件
        this.batchExportPdfBtn = document.getElementById('batch-export-pdf');
        this.batchExportCancelBtn = document.getElementById('batch-export-cancel');
        
        if (this.batchExportCancelBtn) {
            this.batchExportCancelBtn.addEventListener('click', () => {
                this.toggleBatchSelectMode();
            });
        }
        
        if (this.batchExportPdfBtn) {
            this.batchExportPdfBtn.addEventListener('click', () => {
                this.openExportReportModal?.('batch');
            });
        }
    } else {
        // 正常模式：显示清空按钮
        footer.innerHTML = `
            <button id="clear-history" class="btn-secondary" style="width: 100%;">
                <i class="icon trash"></i> 清空视检记录
            </button>
        `;
        
        // 重新绑定清空按钮事件
        const clearBtn = document.getElementById('clear-history');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.confirmClearHistory());
        }
    }
}

/**
 * 更新批量选择计数（只在批量选择模式下显示）
 */
updateBatchSelectCount() {
    this.removeBatchSelectCount();
    
    // 只有进入批量选择模式后才显示计数
    if (!this.isBatchSelectMode) return;
    
    const headerElement = this.historySidebar.querySelector('.history-sidebar-header h3');
    if (!headerElement) return;
    
    const countSpan = document.createElement('span');
    countSpan.className = 'batch-select-count';
    countSpan.id = 'batch-select-count';
    countSpan.textContent = `(${this.selectedBatchItems.size})`;
    headerElement.appendChild(countSpan);
    this.batchSelectCount = countSpan;
    
    // 更新导出按钮状态
    if (this.batchExportPdfBtn) {
        this.batchExportPdfBtn.disabled = this.selectedBatchItems.size === 0;
    }
}

/**
 * 移除批量选择计数
 */
removeBatchSelectCount() {
    if (this.batchSelectCount) {
        this.batchSelectCount.remove();
        this.batchSelectCount = null;
    }
}

/**
 * 切换单个项目的选择状态
 */
toggleBatchItemSelection(timestamp, checkboxElement) {
    if (this.selectedBatchItems.has(timestamp)) {
        this.selectedBatchItems.delete(timestamp);
        checkboxElement.classList.remove('checked');
    } else {
        this.selectedBatchItems.add(timestamp);
        checkboxElement.classList.add('checked');
    }
    
    this.updateBatchSelectCount();
}

/**
 * 更新批量UI状态
 */
updateBatchUI() {
    this.updateFooterButtons();
    this.updateBatchSelectCount();
}

// =========== 👇批量导出开始 ===========

/**
 * 批量导出PDF（按页分开）
 */
async batchExportToPDF(reportName = '') {
    if (this.selectedBatchItems.size === 0) {
        this.showToast('请至少选择一个历史记录', 'warning');
        return;
    }
    
    try {
        this.showToast(`正在导出 ${this.selectedBatchItems.size} 个记录...`, 'info');
        
        // 禁用导出按钮
        if (this.batchExportPdfBtn) {
            this.batchExportPdfBtn.disabled = true;
            this.batchExportPdfBtn.innerHTML = '<i class="icon loader"></i> 导出中';
        }
        
        // 获取所有选中的历史记录，按时间排序
        const selectedTimestamps = Array.from(this.selectedBatchItems).sort((a, b) => a - b);
        const histories = [];
        
        for (const timestamp of selectedTimestamps) {
            const history = await this.historyStorage.get(timestamp);
            if (history) {
                histories.push(history);
            }
        }
        
        if (histories.length === 0) {
            this.showToast('未找到有效的历史记录', 'error');
            return;
        }
        
        // 生成批量PDF（多页）
        await this.generateBatchPDFMultiPage(histories, reportName);
        
        // 退出选择模式
        this.toggleBatchSelectMode();
        
        this.showToast(`成功导出 ${histories.length} 个记录的PDF`, 'success');
        
    } catch (error) {
        console.error('批量导出失败:', error);
        this.showToast('批量导出失败：' + error.message, 'error');
        
        // 恢复按钮状态
        if (this.batchExportPdfBtn) {
            this.batchExportPdfBtn.disabled = this.selectedBatchItems.size === 0;
            this.batchExportPdfBtn.innerHTML = '<i class="icon file-type-pdf"></i> 导出PDF';
        }
    }
}

/**
 * 生成批量PDF（多页模式 - 完全复用单页导出逻辑）
 */
async generateBatchPDFMultiPage(histories, reportName = '') {
    const { jsPDF } = window.jspdf;
    
    // ========== 第1步：为每个历史记录独立截图生成Canvas ==========
    const pageCanvases = [];
    
    for (let i = 0; i < histories.length; i++) {
        const history = histories[i];
        const pageCanvas = await this.exportHistoryItemToCanvas(
            history,
            i + 1,
            histories.length
        );
        pageCanvases.push(pageCanvas);
        console.log(`[批量导出] 第${i + 1}页Canvas尺寸: ${pageCanvas.width} x ${pageCanvas.height}`);
    }
    
    if (pageCanvases.length === 0) return;
    
    // ========== 第2步：确定PDF的固定宽度 ==========
    const firstHistory = histories[0];
    const isWebMode = (firstHistory.baseWidth || 375) >= 1024;
    const pdfTotalWidth = isWebMode ? 2095 : 1280;
    
    // ========== 第3步：创建PDF ==========
    const firstCanvas = pageCanvases[0];
    const firstPdfHeight = (firstCanvas.height / firstCanvas.width) * pdfTotalWidth;
    
    // 第一页的方向根据宽高决定
    const firstOrientation = pdfTotalWidth > firstPdfHeight ? 'l' : 'p';
    
    const pdf = new jsPDF({
        orientation: firstOrientation,
        unit: 'pt',
        format: [pdfTotalWidth, firstPdfHeight]
    });
    
    console.log(`[批量导出] 第一页创建: orientation=${firstOrientation}, format=${pdfTotalWidth}x${firstPdfHeight.toFixed(0)}`);
    
    // ========== 第4步：逐页添加图片 ==========
    for (let i = 0; i < pageCanvases.length; i++) {
        const canvas = pageCanvases[i];
        const pageHeight = (canvas.height / canvas.width) * pdfTotalWidth;
        
        if (i > 0) {
            // 根据该页的宽高决定orientation，防止jsPDF自动交换宽高
            const pageOrientation = pdfTotalWidth > pageHeight ? 'l' : 'p';
            const pageFormat = [pdfTotalWidth, pageHeight];
            
            console.log(`[批量导出] 添加第${i + 1}页: orientation=${pageOrientation}, format=${pageFormat[0]}x${pageFormat[1].toFixed(0)}`);
            
            // addPage时传入orientation参数，明确告诉jsPDF不要自动旋转
            pdf.addPage(pageFormat, pageOrientation);
            
            // 验证新页面尺寸
            const actualWidth = pdf.internal.pageSize.getWidth();
            const actualHeight = pdf.internal.pageSize.getHeight();
            console.log(`[批量导出] 第${i + 1}页实际尺寸: ${actualWidth}x${actualHeight}`);
        }
        
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfTotalWidth, pageHeight);
    }
    
    // ========== 第5步：保存PDF ==========
    const exportName = this.normalizeExportReportName
        ? this.normalizeExportReportName(reportName)
        : `视检报告-${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
    pdf.save(`${exportName}.pdf`);
}


/**
 * 导出单个历史记录为Canvas（复用原有exportToPDF的单页逻辑）
 */
async exportHistoryItemToCanvas(history, pageNum, totalPages) {
    // 加载图片
    const designImage = await this.base64ToImage(history.designImageBase64);
    const devImage = await this.base64ToImage(history.devImageBase64);
    
    // 判断模式
    const isWebMode = (history.baseWidth || 375) >= 1024;
    const pdfImageWidth = isWebMode ? 800 : 375;
    const pdfListWidth = 375;
    const pdfTotalWidth = isWebMode ? 2095 : 1280;
    
    const exportScale = 2;
    
    // 创建临时容器（不设固定高度，让内容撑开）
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        width: ${pdfTotalWidth}px;
        background-color: #000000;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='3' fill='rgba(255,255,255,0.45)'/%3E%3C/svg%3E");
            background-repeat: repeat;
            background-size: 32px 32px;
        padding: 40px 40px 60px 40px;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    document.body.appendChild(tempContainer);
    
    // ===== 报告头部 =====
    const header = document.createElement('div');
    header.style.cssText = `
        margin-bottom: 32px;
        border-bottom: 2px solid rgba(255,255,255,0.2);
        padding-bottom: 16px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
    `;
    
    const title = document.createElement('h1');
    title.style.cssText = 'margin: 0; font-size: 24px; color: #ffffff;';
    if (totalPages > 1) {
        title.innerText = `视检报告 (${pageNum}/${totalPages})`;
    } else {
        title.innerText = '视检报告';
    }
    
    const date = document.createElement('div');
    date.style.cssText = 'font-size: 14px; color: rgba(255,255,255,0.5);';
    const recordDate = new Date(history.timestamp);
    date.innerText = `记录时间：${recordDate.toLocaleString('zh-CN')}`;
    
    header.appendChild(title);
    header.appendChild(date);
    tempContainer.appendChild(header);
    
    // ===== 三列布局容器 =====
    const rowContainer = document.createElement('div');
    rowContainer.style.cssText = `
        display: flex;
        flex-direction: row;
        gap: 20px;
        justify-content: center;
        margin-top: 20px;
        align-items: flex-start;
    `;
    
    // 设计图列
    const designCol = this._buildImageColumn(
        designImage,
        '设计图',
        pdfImageWidth,
        exportScale
    );
    
    const visibleHistoryAnnotations = this.getVisibleAnnotations
        ? this.getVisibleAnnotations(history.annotations || [])
        : (history.annotations || []);
    const exportHistory = { ...history, annotations: visibleHistoryAnnotations };

    // 开发图列（含标注 + 插件标注）
    const devCol = await this._buildDevColumn(
        devImage,
        exportHistory,
        pdfImageWidth,
        exportScale
    );
    
    // 标注列表列
    const annotationCol = this._buildAnnotationColumn(
        visibleHistoryAnnotations,
        pdfListWidth
    );
    
    rowContainer.appendChild(designCol);
    rowContainer.appendChild(devCol);
    rowContainer.appendChild(annotationCol);
    tempContainer.appendChild(rowContainer);
    
    // ===== 统一三列高度 =====
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const designColHeight = designCol.scrollHeight;
    const devColHeight = devCol.scrollHeight;
    const annotationColHeight = annotationCol.scrollHeight;
    const maxColHeight = Math.max(designColHeight, devColHeight, annotationColHeight);
    
    designCol.style.height = maxColHeight + 'px';
    devCol.style.height = maxColHeight + 'px';
    annotationCol.style.height = maxColHeight + 'px';
    
    // ===== 报告底部 =====
    const footer = document.createElement('div');
    footer.style.cssText = `
        margin-top: 40px;
        padding-top: 10px;
        padding-bottom: 0;
        margin-bottom: 0;
        border-top: 1px solid rgba(255,255,255,0.2);
        text-align: center;
        font-size: 12px;
        color: rgba(255,255,255,0.6);
    `;
    if (totalPages > 1) {
        footer.innerText = `第 ${pageNum}/${totalPages} 页 · 以上视检问题请修正，如有疑问请联系归属设计师`;
    } else {
        footer.innerText = '以上视检问题请修正，如有疑问请联系归属设计师';
    }
    tempContainer.appendChild(footer);
    
    // 等待DOM完全渲染
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // 截图 - 不设置width/height，让html2canvas根据内容自动计算
    const canvas = await html2canvas(tempContainer, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        allowTaint: true,
        useCORS: true
    });
    
    // 清理
    document.body.removeChild(tempContainer);
    
    return canvas;
}

/**
 * 构建图片列
 */
_buildImageColumn(image, titleText, pdfImageWidth, exportScale) {
    const aspectRatio = image.height / image.width;
    const targetHeight = pdfImageWidth * aspectRatio;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = pdfImageWidth * exportScale;
    canvas.height = targetHeight * exportScale;
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, pdfImageWidth, targetHeight);
    
    const col = document.createElement('div');
    col.style.cssText = `width: ${pdfImageWidth}px; flex-shrink: 0;`;
    
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = `
        text-align: center;
        margin-bottom: 12px;
        font-size: 16px;
        font-weight: 500;
        color: #ffffff;
        padding: 4px 0;
    `;
    titleDiv.innerText = titleText;
    col.appendChild(titleDiv);
    
    const imgElement = document.createElement('img');
    imgElement.src = canvas.toDataURL('image/png');
    imgElement.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 12px;
    `;
    col.appendChild(imgElement);
    
    return col;
}

/**
 * 构建开发图列（含主程序标注 + 插件标注）
 */
async _buildDevColumn(devImage, history, pdfImageWidth, exportScale) {
    const devAspectRatio = devImage.height / devImage.width;
    const devTargetHeight = pdfImageWidth * devAspectRatio;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = pdfImageWidth * exportScale;
    canvas.height = devTargetHeight * exportScale;
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 1. 绘制开发图
    ctx.drawImage(devImage, 0, 0, pdfImageWidth, devTargetHeight);
    
    // 2. 绘制主程序标注
    const annotations = history.annotations || [];
    const baseWidth = history.baseWidth || 375;
    const pdfScale = pdfImageWidth / baseWidth;
    
    annotations.forEach((annotation, index) => {
        const status = annotation.status || 'pending';
        const statusColor = this.STATUS_CONFIG[status]?.color || '#ff4444';
        const statusBgColor = this.STATUS_CONFIG[status]?.bgColor || '#ff4444';
        
        const pdfX = annotation.baseX * pdfScale;
        const pdfY = annotation.baseY * pdfScale;
        const pdfW = annotation.baseWidth * pdfScale;
        const pdfH = annotation.baseHeight * pdfScale;
        
        ctx.fillStyle = this.hexToRgba(statusColor, 0.15);
        ctx.fillRect(pdfX, pdfY, pdfW, pdfH);
        
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(pdfX, pdfY, pdfW, pdfH);
        
        const badgeSize = 20;
        const badgeRadius = 10;
        let badgeX = pdfX - 2;
        let badgeY = pdfY - badgeSize - 2;
        if (badgeY < 0) {
            badgeX = pdfX + 4;
            badgeY = pdfY + 4;
        }
        
        ctx.fillStyle = statusBgColor;
        ctx.beginPath();
        ctx.arc(badgeX + badgeRadius, badgeY + badgeRadius, badgeRadius, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((index + 1).toString(), badgeX + badgeRadius, badgeY + badgeRadius);
    });
    
    // 3. 绘制插件标注
    const pluginAnnotations = history.pluginAnnotations || [];
    if (pluginAnnotations.length > 0) {
        const currentZoom = 1;
        const zoomAdjustedBaseWidth = baseWidth * currentZoom;
        const coordinateRatio = pdfImageWidth / zoomAdjustedBaseWidth;
        const sizeRatio = pdfImageWidth / baseWidth;
        
        pluginAnnotations.forEach((ann) => {
            switch (ann.type) {
                case 'pen':
                    if (ann.points && ann.points.length > 1) {
                        ctx.beginPath();
                        ctx.strokeStyle = ann.color || '#ff4d4f';
                        ctx.lineWidth = (ann.size || 3) * sizeRatio;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        
                        ctx.moveTo(ann.points[0].x * coordinateRatio, ann.points[0].y * coordinateRatio);
                        for (let i = 1; i < ann.points.length; i++) {
                            ctx.lineTo(ann.points[i].x * coordinateRatio, ann.points[i].y * coordinateRatio);
                        }
                        ctx.stroke();
                    }
                    break;
                    
                case 'arrow':
                    if (ann.start && ann.end) {
                        const sx = ann.start.x * coordinateRatio;
                        const sy = ann.start.y * coordinateRatio;
                        const ex = ann.end.x * coordinateRatio;
                        const ey = ann.end.y * coordinateRatio;
                        
                        const dx = ex - sx, dy = ey - sy;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        if (length < 5) break;
                        
                        const angle = Math.atan2(dy, dx);
                        const lineWidth = (ann.size || 3) * sizeRatio;
                        const arrowSize = Math.min(24, Math.max(10, lineWidth * 2.5));
                        const shorten = arrowSize * 0.7;
                        
                        ctx.beginPath();
                        ctx.strokeStyle = ann.color || '#ff4d4f';
                        ctx.lineWidth = lineWidth;
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(ex - Math.cos(angle) * shorten, ey - Math.sin(angle) * shorten);
                        ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.fillStyle = ann.color || '#ff4d4f';
                        ctx.moveTo(ex, ey);
                        ctx.lineTo(ex - arrowSize * Math.cos(angle - 0.5), ey - arrowSize * Math.sin(angle - 0.5));
                        ctx.lineTo(ex - arrowSize * Math.cos(angle + 0.5), ey - arrowSize * Math.sin(angle + 0.5));
                        ctx.closePath();
                        ctx.fill();
                    }
                    break;
                    
                case 'rect':
                    if (ann.start && ann.end) {
                        const x = Math.min(ann.start.x, ann.end.x) * coordinateRatio;
                        const y = Math.min(ann.start.y, ann.end.y) * coordinateRatio;
                        const w = Math.abs(ann.end.x - ann.start.x) * coordinateRatio;
                        const h = Math.abs(ann.end.y - ann.start.y) * coordinateRatio;
                        
                        ctx.strokeStyle = ann.color || '#ff4d4f';
                        ctx.lineWidth = (ann.size || 3) * sizeRatio;
                        ctx.strokeRect(x, y, w, h);
                    }
                    break;
                    
                case 'text':
                    if (ann.position && ann.text) {
                        const tx = (ann.position.x || 0) * coordinateRatio;
                        const ty = (ann.position.y || 0) * coordinateRatio;
                        const fontSize = (ann.fontSize || 16) * coordinateRatio;
                        
                        ctx.save();
                        ctx.font = `normal ${fontSize}px system-ui, sans-serif`;
                        ctx.fillStyle = ann.color || '#ff4d4f';
                        ctx.textBaseline = 'top';
                        ctx.textAlign = 'left';
                        
                        const lines = ann.text.split('\n');
                        const lineHeight = fontSize * (ann.lineHeight || 1.2);
                        lines.forEach((line, idx) => {
                            ctx.fillText(line, tx, ty + (idx * lineHeight));
                        });
                        ctx.restore();
                    }
                    break;
            }
        });
    }
    
    const col = document.createElement('div');
    col.style.cssText = `width: ${pdfImageWidth}px; flex-shrink: 0;`;
    
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = `
        text-align: center;
        margin-bottom: 12px;
        font-size: 16px;
        font-weight: 500;
        color: #ffffff;
        padding: 4px 0;
    `;
    titleDiv.innerText = '开发图';
    col.appendChild(titleDiv);
    
    const imgElement = document.createElement('img');
    imgElement.src = canvas.toDataURL('image/png');
    imgElement.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 12px;
    `;
    col.appendChild(imgElement);
    
    return col;
}

/**
 * 构建标注列表列
 */
_buildAnnotationColumn(annotations, pdfListWidth) {
    const col = document.createElement('div');
    col.style.cssText = `width: ${pdfListWidth}px; flex-shrink: 0;`;
    
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = `
        text-align: center;
        margin-bottom: 12px;
        font-size: 16px;
        font-weight: 500;
        color: #ffffff;
        padding: 4px 0;
    `;
    titleDiv.innerHTML = '视检问题';
    col.appendChild(titleDiv);
    
    const content = document.createElement('div');
    content.style.cssText = `
        min-height: 200px;
    `;
    
    if (annotations.length > 0) {
        annotations.forEach((annotation, index) => {
            const status = annotation.status || 'pending';
            const statusBgColor = this.STATUS_CONFIG[status]?.bgColor || '#ff4444';
            
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = `
                margin-bottom: 16px;
                padding: 12px;
                background-color: rgba(255,255,255,0.12);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.12);
            `;
            
            const headerDiv = document.createElement('div');
            headerDiv.style.cssText = `
                display: flex;
                align-items: flex-start;
                gap: 8px;
            `;

            //问题序号数字
            const numberSpan = document.createElement('span');
            numberSpan.style.cssText = `
                background-color: ${statusBgColor};
                color: white;
                font-size: 12px;
                font-weight: bold;
                width: 20px;
                height: 20px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                margin-top: 2px;
                line-height: 1;
                padding-bottom: 3px;
            `;
            numberSpan.innerText = index + 1;
            
            const descDiv = document.createElement('div');
            descDiv.style.cssText = `
                font-size: 14px;
                line-height: 1.5;
                color: #ffffff;
                flex: 1;
            `;
            descDiv.innerText = annotation.description || '（无描述）';
            
            headerDiv.appendChild(numberSpan);
            headerDiv.appendChild(descDiv);
            itemDiv.appendChild(headerDiv);
            content.appendChild(itemDiv);
        });
    } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = `
            color: rgba(255,255,255,0.6);
            text-align: center;
            padding: 60px 0;
            font-size: 14px;
        `;
        emptyMsg.innerText = '暂无标注';
        content.appendChild(emptyMsg);
    }
    
    col.appendChild(content);
    
    return col;
}

// =========== 批量导出结束 ===========



    // 在 loadHistoryList 方法中，添加当前编辑状态的检查
    async loadHistoryList() {
        try {
            console.log('开始加载历史记录列表...');

            if (!this.historyStorage.db) {
                console.log('数据库未初始化，重新初始化');
                await this.historyStorage.init();
            }

            const groups = await this.historyStorage.getGroupedHistories();
            console.log('获取到的分组数据: ', groups);

            // 检查是否有数据
            const hasData = groups.today.length > 0 ||
            groups.yesterday.length > 0 ||
            groups.last7Days.length > 0 ||
            groups.last30Days.length > 0 ||
            Object.keys(groups.months).length > 0;

            if (!hasData) {
                console.log('没有历史记录数据');
                this.historyContent.innerHTML = `
                <div class="history-empty">
                <i class="icon ufo"></i>
                <p>暂无历史记录</p>
                </div>
                `;
                return;
            }

            let html = '';

            // 今天
            if (groups.today.length > 0) {
                html += this.renderHistoryGroup('今天', groups.today);
            }

            // 昨天
            if (groups.yesterday.length > 0) {
                html += this.renderHistoryGroup('昨天', groups.yesterday);
            }

            // 最近7天
            if (groups.last7Days.length > 0) {
                html += this.renderHistoryGroup('最近7天', groups.last7Days);
            }

            // 30天内
            if (groups.last30Days.length > 0) {
                html += this.renderHistoryGroup('30天内', groups.last30Days);
            }

            // 月份分组
            const monthKeys = Object.keys(groups.months).sort().reverse();
            monthKeys.forEach(monthKey => {
                const month = groups.months[monthKey];
                html += this.renderHistoryGroup(month.name, month.items);
            });

            this.historyContent.innerHTML = html;

// 为每个历史项添加事件
this.historyContent.querySelectorAll('.history-item').forEach(item => {
    const timestamp = parseInt(item.dataset.timestamp);

    // 新增：复选框点击事件
    const checkbox = item.querySelector('.history-item-checkbox');
    if (checkbox) {
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isBatchSelectMode) {
                this.toggleBatchItemSelection(timestamp, checkbox);
            }
        });
    }

    // 点击加载
    item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('history-item-delete') && 
            !e.target.closest('.history-item-checkbox')) {
            if (this.isBatchSelectMode) {
                // 批量选择模式下，点击整个item也切换选择
                const cb = item.querySelector('.history-item-checkbox');
                if (cb) {
                    this.toggleBatchItemSelection(timestamp, cb);
                }
            } else {
                this.loadHistoryItem(timestamp);
            }
        }
    });

    // 删除按钮
    const deleteBtn = item.querySelector('.history-item-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteHistoryItem(timestamp, item);
        });
    }
});

            console.log('历史记录列表加载完成，当前编辑时间戳: ', this.currentSavedTimestamp);

        } catch (error) {
            console.error('加载历史记录失败: ', error);
            this.historyContent.innerHTML = `
            <div class="history-empty">
            <i class="icon mood-sad"></i>
        <p>加载失败: ${error.message}</p>
            </div>
            `;
        }
    }

    // 新增：渲染历史记录分组
    renderHistoryGroup(title, items) {
        return `
        <div class="history-group">
    <div class="history-group-title">${title}</div>
        <div class="history-grid">
    ${items.map(item => this.renderHistoryItem(item)).join('')}
        </div>
        </div>
        `;
    }


// 修改：渲染单个历史记录项（添加复选框）
renderHistoryItem(item) {
    const date = new Date(item.timestamp);
    const timeStr = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    // 使用存储的预览图Base64
    const previewSrc = item.preview || 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22140%22%20height%3D%22140%22%20viewBox%3D%220%200%20140%20140%22%3E%3Crect%20width%3D%22140%22%20height%3D%22140%22%20fill%3D%22%23f0f0f0%22%2F%3E%3Ctext%20x%3D%2270%22%20y%3D%2270%22%20font-family%3D%22Arial%22%20font-size%3D%2212%22%20fill%3D%22%23999%22%20text-anchor%3D%22middle%22%20dy%3D%22.3em%22%3E%E6%97%A0%E9%A2%84%E8%A7%88%3C%2Ftext%3E%3C%2Fsvg%3E';

    // 判断是否是当前编辑中的数据
    const isCurrentEditing = this.currentSavedTimestamp === item.timestamp;

    return `
    <div class="history-item ${isCurrentEditing ? 'current-editing' : ''}" data-timestamp="${item.timestamp}">
        <!-- 新增：复选框 -->
        <div class="history-item-checkbox" data-timestamp="${item.timestamp}">
            <i class="icon check"></i>
        </div>
        
        <button class="history-item-delete" title="删除">
            <i class="icon trash"></i>
        </button>
        ${isCurrentEditing ? '<div class="history-item-current-label">当前编辑</div>' : ''}
        <div class="history-item-image">
            <img src="${previewSrc}" alt="预览图"
                onerror="this.src='data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22140%22%20height%3D%22140%22%20viewBox%3D%220%200%20140%20140%22%3E%3Crect%20width%3D%22140%22%20height%3D%22140%22%20fill%3D%22%23f0f0f0%22%2F%3E%3Ctext%20x%3D%2270%22%20y%3D%2270%22%20font-family%3D%22Arial%22%20font-size%3D%2212%22%20fill%3D%22%23999%22%20text-anchor%3D%22middle%22%20dy%3D%22.3em%22%3E%E5%8A%A0%E8%BD%BD%E5%A4%B1%E8%B4%A5%3C%2Ftext%3E%3C%2Fsvg%3E'">
        </div>
        <div class="history-item-info">
            <div class="history-item-time">${timeStr}</div>
        </div>
    </div>
    `;
}

// ===== 加载历史记录 =====
            async loadHistoryItem(timestamp) {
                try {
                    // 检查是否有未保存更改
                    if (this.hasUnsavedChanges) {
                        // 显示确认弹窗
                        this.pendingLoadTimestamp = timestamp;
                        this.unsavedModal.classList.add('active');
                        return;
                    }

                    await this.performLoadHistory(timestamp);

                } catch (error) {
                    console.error('加载历史记录失败: ', error);
                    this.showToast('加载失败：' + error.message, 'error');
                }
            }


// ===== 加载历史记录方法 =====
async performLoadHistory(timestamp) {
    this.showToast('正在加载...', 'info');

    try {
        console.log('第一步：关闭侧边栏');
        this.closeHistorySidebar();

        console.log('第二步：等待侧边栏动画完成');
        await new Promise(resolve => setTimeout(resolve, 350));
        // 强制浏览器重新计算布局
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        console.log('第三步：开始加载历史数据');
        const history = await this.historyStorage.get(timestamp);
        if (!history) {
            this.showToast('记录不存在', 'error');
            return;
        }

        // 历史记录之间必须完全隔离涂鸦标注，先清掉当前插件画布和待恢复队列。
        const pluginAnnotations = (history.pluginAnnotations || []).map(annotation =>
            JSON.parse(JSON.stringify(annotation))
        );
        if (window.loadPluginAnnotations) window.loadPluginAnnotations([]);

        console.log('加载历史记录:', {
            timestamp: history.timestamp,
            hasDesignBase64: !!history.designImageBase64,
            hasDevBase64: !!history.devImageBase64,
            annotationsCount: history.annotations?.length,
            pluginAnnotationsCount: history.pluginAnnotations?.length || 0  // 👈 新增日志
        });

        // 从Base64加载图片
        const designImage = await this.base64ToImage(history.designImageBase64);
        const devImage = await this.base64ToImage(history.devImageBase64);

        // 更新状态
        this.state.designImage = designImage;
        this.state.devImage = devImage;
        if (this.restoreLongScreenshotFromHistory) {
            await this.restoreLongScreenshotFromHistory(history.longScreenshot || null);
        }
        
        // 加载主程序标注
        this.state.annotations = (history.annotations || []).map(a => ({
            ...a,
            status: a.status || 'pending',
            source: a.source || 'manual'
        }));
        this.state.inspectionMode = history.inspectionMode || 'side-by-side';
        this.state.baseWidth = history.baseWidth || 375;
        this.state.opacity = history.opacity || 50;
        this.state.zoom = 100;
        this.state.currentAnnotationId = Math.max(...(this.state.annotations || []).map(a => a.id), 0) + 1;

    if (this.syncModeSelector) {
        this.syncModeSelector();
    }

        // ===== 加载偏移量 =====
        if (history.designYOffset !== undefined) {
            this.state.designYOffset = history.designYOffset;
            const scale = this.state.zoom / 100;
            const viewOffset = this.state.designYOffset * scale;

            if (this.offsetSlider) {
                this.offsetSlider.value = Math.round(viewOffset);
            }
            if (this.offsetValue) {
                this.offsetValue.textContent = Math.round(viewOffset) + 'px';
            }
        } else {
            this.state.designYOffset = 0;
            if (this.offsetSlider) {
                this.offsetSlider.value = 0;
            }
            if (this.offsetValue) {
                this.offsetValue.textContent = '0px';
            }
        }

        // ===== 加载插件标注 =====
        this.state.pluginAnnotations = pluginAnnotations;
        
        console.log('[加载历史] 插件标注数据:', {
            数量: pluginAnnotations.length,
            数据: pluginAnnotations
        }); //======================

                    // 更新上传预览区
                this._renderPreview(this.designPreview, `历史记录_${timestamp}`, designImage);
                this._renderPreview(this.devPreview, `历史记录_${timestamp}`, devImage);

                    // 更新模式按钮
                    //this.modeButtons.forEach(btn => {
                    //    btn.classList.toggle('active', btn.dataset.mode === this.state.inspectionMode);
                    //});

                    // 更新宽度按钮
                    //this.widthButtons.forEach(btn => {
                    //    const width = parseInt(btn.dataset.width);
                    //    btn.classList.toggle('active', width === this.state.baseWidth);
                    //});

                    // 更新自定义宽度输入框
                    //if (![375, 390, 1280, 1440].includes(this.state.baseWidth)) {
                    //    this.customWidthInput.value = this.state.baseWidth;
                    //    this.widthButtons.forEach(btn => btn.classList.remove('active'));
                    //} else {
                    //    this.customWidthInput.value = '';
                    //}

// 同步新的模式&宽度选择器
if (this.syncModeSelector) {
    this.syncModeSelector();
}
if (this.syncWidthSelector) {
    this.syncWidthSelector(this.state.baseWidth);
}

                    // 更新透明度
                    this.opacitySlider.value = this.state.opacity;
                    this.opacityValue.textContent = `${this.state.opacity}%`;

                    // 重置缩放显示
                    this.zoomLevelSpan.textContent = '100%';

                    // 第四步：开始视检（此时容器宽度已恢复正常）
                    console.log('第四步：开始视检');
                    this._skipNextAutoInspection = true;
                    this.startInspection();

// ===== 恢复插件标注（必须在 startInspection 之后） =====
this.state.pluginAnnotations = pluginAnnotations;
if (window.loadPluginAnnotations) window.loadPluginAnnotations(pluginAnnotations);

if (pluginAnnotations.length > 0) {
    console.log('[加载历史] 准备恢复插件标注:', pluginAnnotations.length, '个');
    
    // 直接调用全局函数，它会自动处理等待逻辑
        // 👇 模拟工具激活再取消，触发插件渲染显示
        const toolbar = window.drawingToolbar;
        if (toolbar) {
            const wasEnabled = toolbar.isEnabled();
            toolbar.enable('pen');      // 临时激活工具
            setTimeout(() => {
                if (!wasEnabled) {
                    toolbar.disable();  // 恢复初始状态
                }
            }, 50);
        }
}


                    // 第五步：更新标注列表
                    this.updateAnnotationsList();
                    if (this.updateAIActionState) this.updateAIActionState();

                    // 确保标注可见
                    this.state.annotationsVisible = true;
                    if (this.annotationCanvas) {
                        this.annotationCanvas.style.pointerEvents = 'auto';
                    }
                    if (this.toggleVisibilityButton) {
                        const icon = this.toggleVisibilityButton.querySelector('i');
                        if (icon) {
                            icon.className = 'icon eye-edit';
                            this.toggleVisibilityButton.classList.remove('hidden-active');
                        }
                    }

// 加载完成后，调整所有 textarea 高度
setTimeout(() => {
    document.querySelectorAll('.annotation-desc').forEach(textarea => {
        this.autoResizeTextarea(textarea);
    });
}, 100);

                    // 标记为已保存
                    this.currentSavedTimestamp = timestamp;
                    this.hasUnsavedChanges = false;
                    this.updateSaveButtonState();

                    this.showToast('加载成功', 'success');

                } catch (error) {
                    console.error('加载历史记录失败: ', error);
                    this.showToast('加载失败：' + error.message, 'error');
                }
            }

            // 新增：删除历史记录
            async deleteHistoryItem(timestamp, element) {
                try {
                    // 添加删除动画
                    element.classList.add('deleting');

                    await this.historyStorage.delete(timestamp);

                    // 如果当前正在显示这个记录，清除保存状态
                    if (this.currentSavedTimestamp === timestamp) {
                        this.currentSavedTimestamp = null;
                        this.hasUnsavedChanges = true;
                        this.updateSaveButtonState();
                    }

                    // 动画结束后移除元素
                    setTimeout(() => {
                        element.remove();

                        // 检查是否还有历史记录
                        if (this.historyContent.querySelectorAll('.history-item').length === 0) {
                            this.historyContent.innerHTML = `
                            <div class="history-empty">
                            <i class="fa-regular fa-folder-open"></i>
                            <p>暂无历史记录</p>
                            </div>
                            `;
                        }
                    }, 200);

                    this.showToast('已删除', 'success');

                } catch (error) {
                    console.error('删除失败: ', error);
                    element.classList.remove('deleting');
                    this.showToast('删除失败', 'error');
                }
            }

            // 确认清空历史记录
            confirmClearHistory() {
                this.showClearHistoryModal();
            }

            // 清空所有历史记录（此方法可删除，因已被performClearHistory替代，但保留供其他地方调用）
            async clearAllHistory() {
                await this.performClearHistory();
            }

// 处理未保存时点击保存
async handleUnsavedSave() {
    // 先拿到要跳转的时间戳
    const targetTimestamp = this.pendingLoadTimestamp;
    
    // 关闭弹窗
    this.closeUnsavedModal();

    // 先保存当前状态
    await this.saveCurrentState();

    // 保存完成后，加载之前点击的历史记录
    if (targetTimestamp) {
        await this.performLoadHistory(targetTimestamp);
    }
}

// 处理未保存时点击不保存
async handleUnsavedDiscard() {
    // 先拿到要跳转的时间戳
    const targetTimestamp = this.pendingLoadTimestamp;
    
    // 关闭弹窗
    this.closeUnsavedModal();

    // 放弃更改，直接加载之前点击的历史记录
    if (targetTimestamp) {
        await this.performLoadHistory(targetTimestamp);
    }
}

            // 关闭未保存确认弹窗
            closeUnsavedModal() {
                this.unsavedModal.classList.remove('active');
                // this.pendingLoadTimestamp = null;
            }

// 显示清空确认弹窗
showClearHistoryModal() {
    if (this.clearHistoryModal) {
        this.clearHistoryModal.classList.add('active');
    }
}

// 关闭清空确认弹窗
closeClearHistoryModal() {
    if (this.clearHistoryModal) {
        this.clearHistoryModal.classList.remove('active');
    }
}

// 执行清空历史记录
async performClearHistory() {
    try {
        await this.historyStorage.clear();

        // 清空当前保存状态
        this.currentSavedTimestamp = null;
        this.hasUnsavedChanges = true;
        this.updateSaveButtonState();

        // 刷新侧边栏
        await this.loadHistoryList();

        this.showToast('已清空所有记录', 'success');
        
        // 关闭弹窗
        this.closeClearHistoryModal();

    } catch (error) {
        console.error('清空失败: ', error);
        this.showToast('清空失败', 'error');
    }
}

// 显示清空标注确认弹窗
showClearAnnotationsModal() {
    if (this.clearAnnotationsModal) {
        this.clearAnnotationsModal.classList.add('active');
    }
}

// 关闭清空标注确认弹窗
closeClearAnnotationsModal() {
    if (this.clearAnnotationsModal) {
        this.clearAnnotationsModal.classList.remove('active');
    }
}

// 执行清空所有标注
performClearAnnotations() {
    this.state.annotations = [];
    if (this.lastAIAnalysisSummary) {
        this.lastAIAnalysisSummary = null;
        this.renderAIAnalysisSummary?.();
    }
    this.drawAnnotations();
    this.updateAnnotationsList();
    this.closeClearAnnotationsModal();
    this.showToast('已清空所有标注', 'success');
}

};
