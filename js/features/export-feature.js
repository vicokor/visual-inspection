/**
 * PDF 导出功能
 * 负责当前视检报告的版式构建、截图和文件导出。
 */
const withExportFeature = (Base) => class extends Base {
            initExportEvents() {
                this.exportPdfButton?.addEventListener('click', () => this.openExportReportModal());
                this.exportReportCancelBtn?.addEventListener('click', () => this.closeExportReportModal());
                this.exportReportConfirmBtn?.addEventListener('click', () => this.confirmExportReport());
                this.exportReportModal?.addEventListener('pointerdown', (event) => {
                    if (event.target === this.exportReportModal) this.closeExportReportModal();
                });
                this.exportReportNameInput?.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.confirmExportReport();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        this.closeExportReportModal();
                    }
                });
            }

            getDefaultExportReportName() {
                const now = new Date();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                return `视检报告-${month}${day}`;
            }

            normalizeExportReportName(value) {
                const normalized = String(value || '')
                    .trim()
                    .replace(/\.pdf$/i, '')
                    .replace(/[\\/:*?"<>|]+/g, '-')
                    .replace(/\s+/g, ' ')
                    .slice(0, 80)
                    .trim();
                return normalized || this.getDefaultExportReportName();
            }

            openExportReportModal(mode = 'single') {
                if (!this.exportReportModal || !this.exportReportNameInput) {
                    if (mode === 'batch') {
                        this.batchExportToPDF(this.getDefaultExportReportName());
                    } else {
                        this.exportToPDF(this.getDefaultExportReportName());
                    }
                    return;
                }
                this.pendingExportMode = mode === 'batch' ? 'batch' : 'single';
                this.exportReportNameInput.value = '';
                this.exportReportNameInput.placeholder = this.getDefaultExportReportName();
                this.exportReportModal.classList.add('active');
                this.exportReportModal.setAttribute('aria-hidden', 'false');
                requestAnimationFrame(() => this.exportReportNameInput.focus());
            }

            closeExportReportModal() {
                this.exportReportModal?.classList.remove('active');
                this.exportReportModal?.setAttribute('aria-hidden', 'true');
                const returnTarget = this.pendingExportMode === 'batch'
                    ? this.batchExportPdfBtn
                    : this.exportPdfButton;
                returnTarget?.focus();
            }

            async confirmExportReport() {
                const reportName = this.normalizeExportReportName(this.exportReportNameInput?.value);
                const exportMode = this.pendingExportMode || 'single';
                this.closeExportReportModal();
                if (exportMode === 'batch') {
                    await this.batchExportToPDF(reportName);
                } else {
                    await this.exportToPDF(reportName);
                }
            }

            async exportToPDF(reportName = '') {
                try {
                    if (!this.state.designImage || !this.state.devImage) {
                        alert('请先上传设计图和开发图');
                        return;
                    }

                    // 显示加载提示
                    const exportBtn = document.getElementById('export-pdf');
                    const originalText = exportBtn.innerHTML;
                    exportBtn.innerHTML = '<i class="icon loader"></i> 生成中';
                    exportBtn.disabled = true;

                    // ========== 1. 准备原始图片数据 ==========
                    const exportAnnotations = this.getVisibleAnnotations
                        ? this.getVisibleAnnotations()
                        : this.state.annotations;
                    const hiddenAICount = this.state.annotations.filter(annotation => annotation.source === 'ai').length -
                        exportAnnotations.filter(annotation => annotation.source === 'ai').length;
                    if (hiddenAICount > 0) {
                        this.showToast('当前已隐藏自动标注，本次仅导出可见标注', 'info');
                    }

                    // 设计图原始数据
                    const designImg = this.state.designImage;
                    // 开发图原始数据
                    const devImg = this.state.devImage;

                    // ========== 2. 根据基准宽度确定PDF尺寸 ==========
                    const isWebMode = this.state.baseWidth >= 1024;
                    const pdfImageWidth = isWebMode ? 800: 375; // 图片宽度：网页端800px，移动端375px
                    const pdfListWidth = 375; // 视检问题列固定375px，永远不变
                    const pdfTotalWidth = isWebMode ?
                    (800 + 20 + 800 + 20 + 375 + 80): // 网页端：800+20+800+20+375+80=2095px
                    1280; // 移动端保持1280px

                    console.log('PDF导出模式:', {
                        基准宽度: this.state.baseWidth,
                        模式: isWebMode ? '网页端(大图)' : '移动端(小图)',
                        图片宽度: pdfImageWidth,
                        列表宽度: pdfListWidth,
                        PDF总宽度: pdfTotalWidth,
            布局: `${pdfImageWidth}px + 20px + ${pdfImageWidth}px + 20px + ${pdfListWidth}px + 80px`
                    });

                    // ========== 3. 创建临时容器 ==========
                    const tempContainer = document.createElement('div');
tempContainer.style.width = pdfTotalWidth + 'px';
tempContainer.style.backgroundColor = '#000000';
tempContainer.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='3' fill='rgba(255,255,255,0.45)'/%3E%3C/svg%3E")`;
tempContainer.style.backgroundRepeat = 'repeat';
tempContainer.style.backgroundSize = '32px 32px';
tempContainer.style.padding = '40px 40px 60px 40px';
tempContainer.style.boxSizing = 'border-box';
tempContainer.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

                    // ========== 4. 报告头部 ==========
                    const header = document.createElement('div');
                    header.style.marginBottom = '32px';
                    header.style.borderBottom = '2px solid rgba(255,255,255,0.2)';
                    header.style.paddingBottom = '16px';
                    header.style.display = 'flex';
                    header.style.justifyContent = 'space-between';
                    header.style.alignItems = 'flex-end';

                    const title = document.createElement('h1');
                    title.style.margin = '0';
                    title.style.fontSize = '24px';
                    title.style.color = '#ffffff';
                    title.innerText = '视检报告';

                    const date = document.createElement('div');
                    date.style.fontSize = '14px';
                    date.style.color = 'rgba(255,255,255,0.4)';
                    date.innerText = `生成时间：${new Date().toLocaleString('zh-CN')}`;

                    header.appendChild(title);
                    header.appendChild(date);
                    tempContainer.appendChild(header);

                    // ========== 5. 三列布局容器 ==========
                    const rowContainer = document.createElement('div');
                    rowContainer.style.display = 'flex';
                    rowContainer.style.flexDirection = 'row';
                    rowContainer.style.gap = '20px';
                    rowContainer.style.justifyContent = 'center';
                    rowContainer.style.marginTop = '20px';
                    rowContainer.style.alignItems = 'flex-start';

                    // ========== 6. 左侧：设计图（原始） ==========
                    // 使用局部变量，避免冲突
                    const exportScale = window.devicePixelRatio || 2;

                    // 创建设计图Canvas
                    const designCanvas = document.createElement('canvas');
                    const designCtx = designCanvas.getContext('2d');

                    // 计算等比例高度 - 使用 pdfImageWidth
                    const designAspectRatio = designImg.height / designImg.width;
                    const designTargetHeight = pdfImageWidth * designAspectRatio;

                    // 设置实际像素尺寸
                    designCanvas.width = pdfImageWidth * exportScale;
                    designCanvas.height = designTargetHeight * exportScale;
                    designCtx.setTransform(exportScale, 0, 0, exportScale, 0, 0);

                    // 高质量渲染
                    designCtx.imageSmoothingEnabled = true;
                    designCtx.imageSmoothingQuality = 'high';

                    // 绘制设计图
                    designCtx.drawImage(designImg, 0, 0, pdfImageWidth, designTargetHeight);

                    const designCol = document.createElement('div');
                    designCol.style.width = pdfImageWidth + 'px';
                    designCol.style.flexShrink = '0';

                    // 设计图标题
                    const designTitle = document.createElement('div');
                    designTitle.style.textAlign = 'center';
                    designTitle.style.marginBottom = '12px';
                    designTitle.style.fontSize = '16px';
                    designTitle.style.fontWeight = '500';
                    designTitle.style.color = '#ffffff';
                    designTitle.style.padding = '4px 0';
                    //designTitle.style.backgroundColor = '#ebf0f7';
                    //designTitle.style.borderRadius = '4px';
                    designTitle.innerText = '设计图';
                    designCol.appendChild(designTitle);

                    // 转换为图片元素
                    const designImgElement = document.createElement('img');
                    designImgElement.src = designCanvas.toDataURL('image/png');
                    designImgElement.style.width = '100%';
                    designImgElement.style.height = 'auto';
                    //designImgElement.style.border = '1px solid #ddd';
                    designImgElement.style.borderRadius = '12px';
                    //designImgElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    designCol.appendChild(designImgElement);

                    // ========== 7. 中间：开发图 + 标注 ==========
                    // 使用相同的 exportScale
                    const devCanvas = document.createElement('canvas');
                    const devCtx = devCanvas.getContext('2d');

                    const devAspectRatio = devImg.height / devImg.width;
                    const devTargetHeight = pdfImageWidth * devAspectRatio;

                    devCanvas.width = pdfImageWidth * exportScale;
                    devCanvas.height = devTargetHeight * exportScale;
                    devCtx.setTransform(exportScale, 0, 0, exportScale, 0, 0);

                    devCtx.imageSmoothingEnabled = true;
                    devCtx.imageSmoothingQuality = 'high';

                    // 绘制开发图
                    devCtx.drawImage(devImg, 0, 0, pdfImageWidth, devTargetHeight);

                    const devCol = document.createElement('div');
                    devCol.style.width = pdfImageWidth + 'px';
                    devCol.style.flexShrink = '0';

                    // 开发图标题
                    const devTitle = document.createElement('div');
                    devTitle.style.textAlign = 'center';
                    devTitle.style.marginBottom = '12px';
                    devTitle.style.fontSize = '16px';
                    devTitle.style.fontWeight = '500';
                    devTitle.style.color = '#ffffff';
                    devTitle.style.padding = '4px 0';
                    //devTitle.style.backgroundColor = '#ebf0f7';
                    //devTitle.style.borderRadius = '4px';
                    devTitle.innerText = '开发图';
                    devCol.appendChild(devTitle);

                    // 绘制标注（如果有）
                    if (exportAnnotations.length > 0) {
                        // PDF导出时的目标宽度 - 使用 pdfImageWidth
                        const pdfTargetWidth = pdfImageWidth; // px

                        // 开发图原始尺寸
                        const devOriginalWidth = devImg.width;
                        const devOriginalHeight = devImg.height;

                        // PDF中的缩放比例
                        const pdfScale = pdfTargetWidth / devOriginalWidth;

                        // 当前视检的基准宽度（用户设置的）
                        const currentBaseWidth = this.state.baseWidth;

                        // 当前视检中开发图的显示比例（相对于原始图片）
                        const currentDisplayScale = currentBaseWidth / devOriginalWidth;

                        console.log('PDF标注坐标转换:', {
                            当前基准宽度: currentBaseWidth,
                            当前显示比例: currentDisplayScale,
                            PDF目标宽度: pdfTargetWidth,
                            PDF缩放比例: pdfScale,
                            标注数量: exportAnnotations.length
                        });

                        exportAnnotations.forEach((annotation, index) => {
                            // 获取状态对应的颜色
                            const status = annotation.status || 'pending';
                            const statusColor = this.STATUS_CONFIG[status]?.color || '#ff4444';
                            const statusBgColor = this.STATUS_CONFIG[status]?.bgColor || '#ff4444';

                            // 关键：将标注的基准坐标转换为原始图片坐标
                            // baseX/baseY 是相对于当前基准宽度下的显示坐标
                            // 需要先转换回原始图片坐标
                            const originalX = annotation.baseX / currentDisplayScale;
                            const originalY = annotation.baseY / currentDisplayScale;
                            const originalWidth = annotation.baseWidth / currentDisplayScale;
                            const originalHeight = annotation.baseHeight / currentDisplayScale;

                            // 然后再转换到PDF的坐标系
                            const pdfX = originalX * pdfScale;
                            const pdfY = originalY * pdfScale;
                            const pdfWidth = originalWidth * pdfScale;
                            const pdfHeight = originalHeight * pdfScale;

                        console.log(`标注${index + 1}转换:`, {
                            base: { x: annotation.baseX.toFixed(2), y: annotation.baseY.toFixed(2) },
                            original: { x: originalX.toFixed(2), y: originalY.toFixed(2) },
                            pdf: { x: pdfX.toFixed(2), y: pdfY.toFixed(2) }
                            });

                            // 绘制半透明填充（使用状态颜色）
                            devCtx.fillStyle = this.hexToRgba(statusColor, 0.15);
                            devCtx.fillRect(pdfX, pdfY, pdfWidth, pdfHeight);

                            // 绘制边框（使用状态颜色）
                            devCtx.strokeStyle = statusColor;
                            devCtx.lineWidth = 2;
                            devCtx.strokeRect(pdfX, pdfY, pdfWidth, pdfHeight);

                            // 绘制内部高光
                            //devCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                            //devCtx.lineWidth = 1;
                            //devCtx.strokeRect(pdfX + 1, pdfY + 1, pdfWidth - 2, pdfHeight - 2);

                            // 绘制序号（使用状态背景色）
                            const badgeSize = 20;
                            const badgeRadius = 10;

                            // 计算序号位置
                            let badgeX = pdfX - 2;
                            let badgeY = pdfY - badgeSize - 2;

                            // 检查是否会超出画布顶部
                            if (badgeY < 0) {
                                badgeX = pdfX + 4;
                                badgeY = pdfY + 4;
                            }

                            // 绘制正圆形背景（使用状态颜色）
                            devCtx.fillStyle = statusBgColor;
                            devCtx.beginPath();
                            devCtx.arc(badgeX + badgeRadius, badgeY + badgeRadius, badgeRadius, 0, 2 * Math.PI);
                            devCtx.fill();

                            // 绘制序号
                            devCtx.fillStyle = 'white';
                            devCtx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            devCtx.textAlign = 'center';
                            devCtx.textBaseline = 'middle';
                            devCtx.fillText(
                            (index + 1).toString(),
                            badgeX + badgeRadius,
                            badgeY + badgeRadius
                            );
                        });
                    }

// ===== 新增：绘制插件标注（画笔、箭头、矩形、文字等）=====
const pluginAnnotations = window.getPluginAnnotations ? window.getPluginAnnotations() : [];
if (pluginAnnotations.length > 0) {
    const devOriginalWidth = devImg.width;
    const pdfScale = pdfImageWidth / devOriginalWidth;
    const currentZoom = this.state.zoom / 100;
    
    // 坐标转换比例：抵消 zoom 影响
    const zoomAdjustedBaseWidth = this.state.baseWidth * currentZoom;
    const coordinateRatio = pdfImageWidth / zoomAdjustedBaseWidth;
    
    // 👇 新增：线宽转换比例，不受 zoom 影响
    const sizeRatio = pdfImageWidth / this.state.baseWidth;

    console.log('PDF插件标注转换:', {
        基准宽度: this.state.baseWidth,
        当前zoom: currentZoom,
        PDF图片宽度: pdfImageWidth,
        coordinateRatio: coordinateRatio,
        sizeRatio: sizeRatio
    });

    pluginAnnotations.forEach((ann) => {
        switch (ann.type) {
            case 'pen':
                if (ann.points && ann.points.length > 1) {
                    const firstPoint = ann.points[0];
                    const pdfFirstX = firstPoint.x * coordinateRatio;
                    const pdfFirstY = firstPoint.y * coordinateRatio;

                    devCtx.beginPath();
                    devCtx.strokeStyle = ann.color || '#ff4d4f';
                    // 👇 修改：线宽用 sizeRatio
                    devCtx.lineWidth = (ann.size || 3) * sizeRatio;
                    devCtx.lineCap = 'round';
                    devCtx.lineJoin = 'round';
                    devCtx.moveTo(pdfFirstX, pdfFirstY);

                    for (let i = 1; i < ann.points.length; i++) {
                        const pdfX = ann.points[i].x * coordinateRatio;
                        const pdfY = ann.points[i].y * coordinateRatio;
                        devCtx.lineTo(pdfX, pdfY);
                    }
                    devCtx.stroke();
                }
                break;

            case 'arrow':
                if (ann.start && ann.end) {
                    const pdfStartX = ann.start.x * coordinateRatio;
                    const pdfStartY = ann.start.y * coordinateRatio;
                    const pdfEndX = ann.end.x * coordinateRatio;
                    const pdfEndY = ann.end.y * coordinateRatio;

                    const dx = pdfEndX - pdfStartX;
                    const dy = pdfEndY - pdfStartY;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    if (length < 5) break;

                    const angle = Math.atan2(dy, dx);
                    // 👇 修改：线宽用 sizeRatio
                    const lineWidth = (ann.size || 3) * sizeRatio;
                    const arrowSize = Math.min(24, Math.max(10, lineWidth * 2.5));
                    const shorten = arrowSize * 0.7;
                    const endX = pdfEndX - Math.cos(angle) * shorten;
                    const endY = pdfEndY - Math.sin(angle) * shorten;

                    devCtx.beginPath();
                    devCtx.strokeStyle = ann.color || '#ff4d4f';
                    devCtx.fillStyle = ann.color || '#ff4d4f';
                    devCtx.lineWidth = lineWidth;
                    devCtx.moveTo(pdfStartX, pdfStartY);
                    devCtx.lineTo(endX, endY);
                    devCtx.stroke();

                    const angleOffset = 0.5;
                    devCtx.beginPath();
                    devCtx.moveTo(pdfEndX, pdfEndY);
                    devCtx.lineTo(
                        pdfEndX - arrowSize * Math.cos(angle - angleOffset),
                        pdfEndY - arrowSize * Math.sin(angle - angleOffset)
                    );
                    devCtx.lineTo(
                        pdfEndX - arrowSize * Math.cos(angle + angleOffset),
                        pdfEndY - arrowSize * Math.sin(angle + angleOffset)
                    );
                    devCtx.closePath();
                    devCtx.fill();
                }
                break;

            case 'rect':
                if (ann.start && ann.end) {
                    const pdfX = Math.min(ann.start.x, ann.end.x) * coordinateRatio;
                    const pdfY = Math.min(ann.start.y, ann.end.y) * coordinateRatio;
                    const pdfWidth = Math.abs(ann.end.x - ann.start.x) * coordinateRatio;
                    const pdfHeight = Math.abs(ann.end.y - ann.start.y) * coordinateRatio;

                    devCtx.strokeStyle = ann.color || '#ff4d4f';
                    // 👇 修改：线宽用 sizeRatio
                    devCtx.lineWidth = (ann.size || 3) * sizeRatio;
                    devCtx.strokeRect(pdfX, pdfY, pdfWidth, pdfHeight);
                }
                break;

            case 'text':
                // 👇 不动：保持原有逻辑
                if (ann.position && ann.text) {
                    const pdfTextX = (ann.position.x || 0) * coordinateRatio;
                    const pdfTextY = (ann.position.y || 0) * coordinateRatio;
                    const pdfFontSize = (ann.fontSize || 16) * coordinateRatio;

                    devCtx.save();
                    devCtx.font = `normal ${pdfFontSize}px system-ui, sans-serif`;
                    devCtx.fillStyle = ann.color || '#ff4d4f';
                    devCtx.textBaseline = 'top';
                    devCtx.textAlign = 'left';

                    const lines = ann.text.split('\n');
                    const lineHeight = pdfFontSize * (ann.lineHeight || 1.2);
                    lines.forEach((line, index) => {
                        devCtx.fillText(line, pdfTextX, pdfTextY + (index * lineHeight));
                    });
                    devCtx.restore();
                }
                break;
        }
    });
}

                    // 将带标注的开发图转换为图片元素
                    const devImgElement = document.createElement('img');
                    devImgElement.src = devCanvas.toDataURL('image/png');
                    devImgElement.style.width = '100%';
                    devImgElement.style.height = 'auto';
                    //devImgElement.style.border = '1px solid #ddd';
                    devImgElement.style.borderRadius = '12px';
                    //devImgElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    devCol.appendChild(devImgElement);

                    // ========== 8. 右侧：标注列表 ==========
                    const annotationCol = document.createElement('div');
                    annotationCol.style.width = pdfListWidth + 'px';
                    annotationCol.style.flexShrink = '0';

                    // 标注列表标题
                    const annotationTitle = document.createElement('div');
                    annotationTitle.style.textAlign = 'center';
                    annotationTitle.style.marginBottom = '12px';
                    annotationTitle.style.fontSize = '16px';
                    annotationTitle.style.fontWeight = '500';
                    annotationTitle.style.color = '#ffffff';
                    annotationTitle.style.padding = '4px 0';
                    //annotationTitle.style.backgroundColor = '#ebf0f7';
                    //annotationTitle.style.borderRadius = '4px';
                    annotationTitle.style.display = 'flex';
                    annotationTitle.style.alignItems = 'center';
                    annotationTitle.style.justifyContent = 'center';
                    annotationTitle.style.gap = '8px';
                    annotationTitle.innerHTML = '视检问题';
                    annotationCol.appendChild(annotationTitle);

                    // 标注列表内容
                    const annotationContent = document.createElement('div');
                    //annotationContent.style.backgroundColor = '#rgba(255,255,255,0.1)';
                    //annotationContent.style.borderRadius = '12px';
                    //annotationContent.style.padding = '16px';
                    annotationContent.style.minHeight = '200px';
                    //annotationContent.style.border = '1px solid rgba(255,255,255,0.2)';

                    if (exportAnnotations.length > 0) {
                        exportAnnotations.forEach((annotation, index) => {
                            // 获取状态对应的颜色
                            const status = annotation.status || 'pending';
                            const statusBgColor = this.STATUS_CONFIG[status]?.bgColor || '#ff4444';

                            // 标注列表子项
                            const itemDiv = document.createElement('div');
                            itemDiv.style.marginBottom = '16px';
                            itemDiv.style.padding = '12px';
                            itemDiv.style.backgroundColor = 'rgba(255,255,255,0.12)';
                            //itemDiv.style.backdropFilter = 'blur(2px)';
                            itemDiv.style.borderRadius = '12px';
                            itemDiv.style.border = '1px solid rgba(255,255,255,0.12)';

                            const headerDiv = document.createElement('div');
                            headerDiv.style.display = 'flex';
                            headerDiv.style.alignItems = 'top';
                            headerDiv.style.gap = '8px';
                            headerDiv.style.marginBottom = '8px';

                            const numberSpan = document.createElement('span');
                            numberSpan.style.backgroundColor = statusBgColor; // 使用状态颜色
                            numberSpan.style.fontFamily = 'Arial, sans-serif';
                            numberSpan.style.marginTop = '2px';
                            numberSpan.style.paddingBottom = '2px';
                            numberSpan.style.color = 'white';
                            numberSpan.style.fontSize = '12px';
                            numberSpan.style.fontWeight = 'bold';
                            numberSpan.style.width = '20px';
                            numberSpan.style.height = '20px';
                            numberSpan.style.borderRadius = '10px';
                            numberSpan.style.display = 'flex';
                            numberSpan.style.alignItems = 'center';
                            numberSpan.style.justifyContent = 'center';
                            numberSpan.innerText = index + 1;

                            const descDiv = document.createElement('div');
                            descDiv.style.fontSize = '14px';
                            descDiv.style.lineHeight = '1.5';
                            descDiv.style.color = '#ffffff';
                            descDiv.style.flex = '1';
                            descDiv.innerText = annotation.description || '（无描述）';

                            headerDiv.appendChild(numberSpan);
                            headerDiv.appendChild(descDiv);
                            itemDiv.appendChild(headerDiv);

                            annotationContent.appendChild(itemDiv);
                        });
                    } else {
                        const emptyMsg = document.createElement('div');
                        emptyMsg.style.color = '#999';
                        emptyMsg.style.textAlign = 'center';
                        emptyMsg.style.padding = '60px 0';
                        emptyMsg.style.fontSize = '14px';
                        emptyMsg.innerText = '暂无标注';
                        annotationContent.appendChild(emptyMsg);
                    }

                    annotationCol.appendChild(annotationContent);

                    // ========== 9. 组装 ==========
                    rowContainer.appendChild(designCol);
                    rowContainer.appendChild(devCol);
                    rowContainer.appendChild(annotationCol);
                    tempContainer.appendChild(rowContainer);

                    // 报告底部
                    const footer = document.createElement('div');
                    footer.style.marginTop = '20px';
                    footer.style.paddingTop = '10px';
                    footer.style.borderTop = '1px solid rgba(255,255,255,0.2)';
                    footer.style.textAlign = 'center';
                    footer.style.fontSize = '12px';
                    footer.style.color = 'rgba(255,255,255,0.6)';
                    footer.innerText = '以上视检问题请修正，如有疑问请联系归属设计师';
                    tempContainer.appendChild(footer);

                    // ========== 10. 临时添加到body ==========
                    tempContainer.style.position = 'absolute';
                    tempContainer.style.left = '-9999px';
                    tempContainer.style.top = '0';
                    tempContainer.style.width = pdfTotalWidth + 'px';
                    tempContainer.style.height = 'auto';
                    document.body.appendChild(tempContainer);

                    // 等待DOM完全渲染
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // ========== 11. 统一三列高度，去除底部空白 ==========
                    // 获取三列的最大高度
                    const designColHeight = designCol.scrollHeight;
                    const devColHeight = devCol.scrollHeight;
                    const annotationColHeight = annotationCol.scrollHeight;
                    const maxColHeight = Math.max(designColHeight, devColHeight, annotationColHeight);

                    // 设置三列的高度一致
                    designCol.style.height = maxColHeight + 'px';
                    devCol.style.height = maxColHeight + 'px';
                    annotationCol.style.height = maxColHeight + 'px';

                    // 调整footer的边距
                    footer.style.marginTop = '40px';
                    footer.style.paddingTop = '10px';
                    footer.style.marginBottom = '0';
                    footer.style.paddingBottom = '0';

                    // 再次等待样式应用
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // ========== 12. 截图 ==========
                    const canvas = await html2canvas(tempContainer, {
                        scale: 2,
                        backgroundColor: '#ffffff',
                        logging: false,
                        allowTaint: true,
                        useCORS: true
                    });

                    // ========== 13. 生成PDF ==========
                    const pdfWidth = pdfTotalWidth; // pt，固定宽度

                    // 计算图片在PDF中的高度（保持宽高比）
                    const imgHeightInPdf = (canvas.height / canvas.width) * pdfWidth; // pt

                    // PDF的高度就是图片的高度（图片占满整个PDF）
                    const pdfHeight = imgHeightInPdf;

                    console.log('PDF生成:', {
                canvas尺寸: `${canvas.width} x ${canvas.height} px`,
                PDF尺寸: `${pdfWidth.toFixed(0)} x ${pdfHeight.toFixed(0)} pt`,
                    图片高度: `${imgHeightInPdf.toFixed(0)} pt`
                    });

                const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({
                        orientation: pdfWidth > pdfHeight ? 'l' : 'p',
                        unit: 'pt',
                        format: [pdfWidth, pdfHeight]
                    });

                    const imgData = canvas.toDataURL('image/jpeg', 1.0);
                    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeightInPdf);

                pdf.save(`${this.normalizeExportReportName(reportName)}.pdf`);

                    // ========== 14. 清理 ==========
                    document.body.removeChild(tempContainer);

                    // 恢复按钮状态
                    exportBtn.innerHTML = originalText;
                    exportBtn.disabled = false;

                } catch (error) {
                    console.error('PDF导出失败: ', error);
                    alert('PDF导出失败：' + error.message);

                    const exportBtn = document.getElementById('export-pdf');
                    exportBtn.innerHTML = '<i class="icon file-type-pdf"></i>导出PDF';
                    exportBtn.disabled = false;
                }
            }

};
