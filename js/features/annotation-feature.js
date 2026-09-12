/**
 * 问题标注功能
 * 负责框选、移动/缩放、状态菜单、标注列表及显隐控制。
 */
const withAnnotationFeature = (Base) => class extends Base {
    initAnnotationEvents() {
        // 标注事件
        if (this.annotationToggle) {
            this.annotationToggle.addEventListener('change', () => this.toggleAnnotationMode());
        }
        if (this.clearAllButton) {
            this.clearAllButton.addEventListener('click', () => this.clearAllAnnotations());
        }
        if (this.toggleVisibilityButton) {
            this.toggleVisibilityButton.addEventListener('click', () => this.toggleAnnotationsVisibility());
        }

        // 模态框事件
        if (this.saveAnnotationButton) {
            this.saveAnnotationButton.addEventListener('click', () => this.saveAnnotation());
        }
        if (this.deleteAnnotationButton) {
            this.deleteAnnotationButton.addEventListener('click', () => this.deleteAnnotation());
        }

        // Canvas交互事件
        if (this.annotationCanvas) {
            this.annotationCanvas.style.touchAction = 'auto';
            this.annotationCanvas.addEventListener('pointerdown', (e) => {
                if (e.isPrimary === false) return;
                if (!this.state.annotationsVisible) return;
                this.startDrawing(e);
                this.startResize(e);
                if (this.isDrawing || this.state.isResizing) {
                    try {
                        this.annotationCanvas.setPointerCapture(e.pointerId);
                    } catch (_) {}
                }
            });
            this.annotationCanvas.addEventListener('pointermove', (e) => {
                if (e.isPrimary === false) return;
                if (!this.state.annotationsVisible) return;
                this.updateImageBoundaryHoverFromEvent(e);
                this.draw(e);
                this.handleAnnotationHover(e);
                this.doResize(e);
            });
            this.annotationCanvas.addEventListener('pointerleave', () => {
                this.setImageBoundaryHover(false);
                if (!this.state.isResizing) this.annotationCanvas.style.cursor = 'default';
            });
            const finishPointerInteraction = (e) => {
                this.stopDrawing();
                this.stopResize();
                if (e && this.annotationCanvas.hasPointerCapture?.(e.pointerId)) {
                    this.annotationCanvas.releasePointerCapture(e.pointerId);
                }
            };
            this.annotationCanvas.addEventListener('pointerup', finishPointerInteraction);
            this.annotationCanvas.addEventListener('pointercancel', finishPointerInteraction);
        }

        // 新增：按ESC键关闭状态菜单
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllStatusMenus();
            }
        });

        // 点击模态框外部关闭
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });
        }

// 清空标注确认弹窗事件
if (this.clearAnnotationsCancelBtn) {
    this.clearAnnotationsCancelBtn.addEventListener('click', () => {
        this.closeClearAnnotationsModal();
    });
}

if (this.clearAnnotationsConfirmBtn) {
    this.clearAnnotationsConfirmBtn.addEventListener('click', () => {
        this.performClearAnnotations();
    });
}

if (this.clearAnnotationsModal) {
    this.clearAnnotationsModal.addEventListener('click', (e) => {
        if (e.target === this.clearAnnotationsModal) {
            this.closeClearAnnotationsModal();
        }
    });
}
    }

            toggleAnnotationMode() {
                this.state.isAnnotating = this.annotationToggle.checked;
                if (this.annotationHint) {
                    this.annotationHint.classList.toggle('active', this.state.isAnnotating);
                }

                // 标注模式时添加类名，让滑杆忽略鼠标事件（包括伪元素热区）
                this.comparisonContainer.classList.toggle('annotating', this.state.isAnnotating);

                if (this.state.isAnnotating) {
                    this.annotationCanvas.style.cursor = this.state.imageBoundaryHovered ? 'crosshair' : 'default';
                    this.annotationCanvas.style.touchAction = 'none';
                } else {
                    this.annotationCanvas.style.cursor = 'default';
                    this.annotationCanvas.style.touchAction = 'auto';
                    this.setImageBoundaryHover(false);
                    // 停止绘制
                    this.stopDrawing();
                }
            }

            startDrawing(e) {
                if (!this.state.isAnnotating) return;

                e.preventDefault();
                e.stopPropagation();

                const rect = this.annotationCanvas.getBoundingClientRect();

                // 所有模式都只允许从开发图的可标注容器内开始。
                const startViewX = e.clientX - rect.left;
                const startViewY = e.clientY - rect.top;
                if (!this.isPointInsideDevelopmentImage(startViewX, startViewY)) {
                    this.annotationCanvas.style.cursor = 'default';
                    return;
                }

                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 存储视图坐标（用于实时绘制）
                this.isDrawing = true;
                this.startViewX = startViewX;
                this.startViewY = startViewY;

                // 转换为基准坐标（用于存储）
                this.startBaseX = (this.startViewX - this.state.canvasOffsetX) / scale;
                this.startBaseY = (this.startViewY - this.state.canvasOffsetY) / scale;

                this.endViewX = this.startViewX;
                this.endViewY = this.startViewY;

                // 保存初始画布状态
                this.annotationCtx.save();

                // 开始绘制时，添加 drawing 类，让滑杆完全穿透
                this.comparisonContainer.classList.add('drawing');
            }

            draw(e) {
                if (!this.isDrawing || !this.state.isAnnotating) return;

                e.preventDefault();
                e.stopPropagation();

                const rect = this.annotationCanvas.getBoundingClientRect();
                const scale = this.state.zoom / 100;

                // 更新视图坐标
                this.endViewX = e.clientX - rect.left;
                this.endViewY = e.clientY - rect.top;

                // 获取图片边界（视图坐标）
                const imageViewX = this.state.canvasOffsetX || 0;
                const imageViewY = this.state.canvasOffsetY || 0;
                const imageViewWidth = this.state.imageWidth || 0;
                const imageViewHeight = this.state.imageHeight || 0;

                // 限制视图坐标在图片区域内
                const clampedEndViewX = Math.max(imageViewX, Math.min(this.endViewX, imageViewX + imageViewWidth));
                const clampedEndViewY = Math.max(imageViewY, Math.min(this.endViewY, imageViewY + imageViewHeight));
                const clampedStartViewX = Math.max(imageViewX, Math.min(this.startViewX, imageViewX + imageViewWidth));
                const clampedStartViewY = Math.max(imageViewY, Math.min(this.startViewY, imageViewY + imageViewHeight));

                // 临时绘制（使用视图坐标）
                const cssWidth = this.annotationCanvas.width / this.devicePixelRatio;
                const cssHeight = this.annotationCanvas.height / this.devicePixelRatio;
                this.annotationCtx.clearRect(0, 0, cssWidth, cssHeight);
                this.drawAnnotations(); // 重绘已有标注

                // 绘制当前矩形（虚线）- 使用视图坐标
                this.annotationCtx.strokeStyle = '#ff4444';
                this.annotationCtx.lineWidth = 2;
                this.annotationCtx.setLineDash([5, 5]);

                const rectViewX = Math.min(clampedStartViewX, clampedEndViewX);
                const rectViewY = Math.min(clampedStartViewY, clampedEndViewY);
                const rectViewWidth = Math.abs(clampedEndViewX - clampedStartViewX);
                const rectViewHeight = Math.abs(clampedEndViewY - clampedStartViewY);

                this.annotationCtx.strokeRect(rectViewX, rectViewY, rectViewWidth, rectViewHeight);

                // 添加半透明填充预览
                this.annotationCtx.fillStyle = 'rgba(255, 68, 68, 0.1)';
                this.annotationCtx.fillRect(rectViewX, rectViewY, rectViewWidth, rectViewHeight);

                this.annotationCtx.setLineDash([]);
            }

            stopDrawing() {
                if (!this.isDrawing) return;

                this.isDrawing = false;
                this.comparisonContainer.classList.remove('drawing');

                // 检查绘制区域是否有效（使用视图坐标）
                const rectViewWidth = Math.abs(this.endViewX - this.startViewX);
                const rectViewHeight = Math.abs(this.endViewY - this.startViewY);

                if (rectViewWidth < 10 || rectViewHeight < 10) {
                    this.drawAnnotations();
                    return;
                }

                // 获取当前缩放比例
                const scale = this.state.zoom / 100;

                // 获取图片边界（视图坐标）
                const imageViewX = this.state.canvasOffsetX || 0;
                const imageViewY = this.state.canvasOffsetY || 0;
                const imageViewWidth = this.state.imageWidth || 0;
                const imageViewHeight = this.state.imageHeight || 0;

                // 计算视图坐标下的矩形
                const viewRectX = Math.min(this.startViewX, this.endViewX);
                const viewRectY = Math.min(this.startViewY, this.endViewY);
                const viewRectRight = Math.max(this.startViewX, this.endViewX);
                const viewRectBottom = Math.max(this.startViewY, this.endViewY);

                // 限制在图片区域内（视图坐标）
                const clampedViewX = Math.max(viewRectX, imageViewX);
                const clampedViewY = Math.max(viewRectY, imageViewY);
                const clampedViewRight = Math.min(viewRectRight, imageViewX + imageViewWidth);
                const clampedViewBottom = Math.min(viewRectBottom, imageViewY + imageViewHeight);

                // 计算视图坐标下的最终尺寸
                let finalViewX = Math.round(clampedViewX);
                let finalViewY = Math.round(clampedViewY);
                let finalViewWidth = Math.round(Math.max(10, clampedViewRight - clampedViewX));
                let finalViewHeight = Math.round(Math.max(10, clampedViewBottom - clampedViewY));

                // 转换为基准坐标（用于存储）
                const baseX = (finalViewX - imageViewX) / scale;
                const baseY = (finalViewY - imageViewY) / scale;
                const baseWidth = finalViewWidth / scale;
                const baseHeight = finalViewHeight / scale;

                // 创建标注时添加 status 字段
                const annotation = {
                    id: this.state.currentAnnotationId++,
                    // 存储基准坐标（相对于图片，不受缩放影响）
                    baseX: Math.max(0, baseX),  // 确保坐标非负
                    baseY: Math.max(0, baseY),
                    baseWidth: Math.max(10, baseWidth),  // 确保最小尺寸
                    baseHeight: Math.max(10, baseHeight),
                    // 同时存储视图坐标（用于当前显示）
                    viewX: finalViewX,
                    viewY: finalViewY,
                    viewWidth: finalViewWidth,
                    viewHeight: finalViewHeight,
                    description: '',
                    status: 'pending'  // 默认状态：待修复
                };

                console.log('创建标注:', {
                    缩放比例: scale,
                基准坐标: { x: baseX, y: baseY, width: baseWidth, height: baseHeight },
                视图坐标: { x: finalViewX, y: finalViewY, width: finalViewWidth, height: finalViewHeight }
                });

                this.state.annotations.push(annotation);

                // 确保标注可见
                this.state.annotationsVisible = true;

                // 同步按钮状态
                const icon = this.toggleVisibilityButton.querySelector('i');
                if (icon) {
                    icon.className = 'icon eye-edit';
                    this.toggleVisibilityButton.classList.remove('hidden-active');
                }

                this.drawAnnotations();
                this.updateAnnotationsList();
                this.showAnnotationModal(annotation);
            }

            /**
            * 检测鼠标悬停在哪条标注上
            */
            handleAnnotationHover(e) {
                if (!this.state.annotationsVisible) return;
                const rect = this.annotationCanvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (this.state.isAnnotating) {
                    const canAnnotate = this.isPointInsideDevelopmentImage(mouseX, mouseY);
                    this.annotationCanvas.style.cursor = canAnnotate ? 'crosshair' : 'default';
                    return;
                }

                if (this.state.isResizing) return;

                // 查找鼠标下的标注
                let hoveredId = null;
                let hoveredDirection = null;

                // 先检查是否悬停在当前编辑标注的手柄上
                if (this.currentEditingAnnotation && this._annotationRects) {
                    const currentAnn = this._annotationRects.find(a => a.id === this.currentEditingAnnotation.id);
                    if (currentAnn) {
                        hoveredDirection = this.getResizeDirection(mouseX, mouseY, currentAnn);
                        if (hoveredDirection) {
                            hoveredId = currentAnn.id;
                            this.annotationCanvas.style.cursor = hoveredDirection + '-resize';
                        }
                    }
                }

                // 如果不是手柄，检查所有标注框
                if (!hoveredDirection && this._annotationRects) {
                    for (let i = this._annotationRects.length - 1; i >= 0; i--) {
                        const ann = this._annotationRects[i];

                        // 检查鼠标是否在标注框内（精确判断，不带额外边距）
                        if (mouseX >= ann.x && mouseX <= ann.x + ann.width &&
                        mouseY >= ann.y && mouseY <= ann.y + ann.height) {

                            hoveredId = ann.id;

                            // 根据是否当前编辑标注显示不同光标
                            if (this.currentEditingAnnotation && this.currentEditingAnnotation.id === ann.id) {
                                this.annotationCanvas.style.cursor = 'move';
                            } else {
                                this.annotationCanvas.style.cursor = 'pointer';
                            }
                            break;
                        }
                    }
                }

                // 如果没有悬停任何标注，恢复默认光标
                if (!hoveredId) {
                    this.annotationCanvas.style.cursor = this.state.isAnnotating &&
                        this.isPointInsideDevelopmentImage(mouseX, mouseY) ? 'crosshair' : 'default';
                }

                // 更新悬停状态
                if (this.state.hoveredAnnotationId !== hoveredId) {
                    this.state.hoveredAnnotationId = hoveredId;
                    this.drawAnnotations();
                }
            }

            /**
            * 判断视图坐标是否位于开发图范围内。
            * canvasOffsetX/Y 在所有模式中都代表开发图的绘制原点。
            */
            isPointInsideDevelopmentImage(viewX, viewY) {
                const imageX = this.state.canvasOffsetX || 0;
                const imageY = this.state.canvasOffsetY || 0;
                const imageWidth = this.state.imageWidth || 0;
                const imageHeight = this.state.imageHeight || 0;

                return imageWidth > 0 && imageHeight > 0 &&
                    viewX >= imageX && viewX <= imageX + imageWidth &&
                    viewY >= imageY && viewY <= imageY + imageHeight;
            }

            updateImageBoundaryHoverFromEvent(e) {
                if (!this.annotationCanvas) return;
                const rect = this.annotationCanvas.getBoundingClientRect();
                this.setImageBoundaryHover(this.isPointInsideDevelopmentImage(
                    e.clientX - rect.left,
                    e.clientY - rect.top
                ));
            }

            setImageBoundaryHover(hovered) {
                const next = !!hovered;
                if (this.state.imageBoundaryHovered === next) return;
                this.state.imageBoundaryHovered = next;
                this.drawAnnotations();
            }

            /**
            * 获取鼠标所在位置的调整方向
            */
            getResizeDirection(mouseX, mouseY, ann) {
                const x = ann.x;
                const y = ann.y;
                const w = ann.width;
                const h = ann.height;

                // 手柄的精确位置（8个控制点的中心坐标）
                const handlePositions = [
            { x: x, y: y, dir: 'nw' },                          // 左上角
            { x: x + w/2, y: y, dir: 'n' },                     // 上边中点
            { x: x + w, y: y, dir: 'ne' },                       // 右上角
            { x: x, y: y + h/2, dir: 'w' },                      // 左边中点
            { x: x + w, y: y + h/2, dir: 'e' },                  // 右边中点
            { x: x, y: y + h, dir: 'sw' },                       // 左下角
            { x: x + w/2, y: y + h, dir: 's' },                  // 下边中点
            { x: x + w, y: y + h, dir: 'se' }                    // 右下角
                ];

                // 感应半径：手柄的可点击范围（像素）
                const SENSITIVITY_RADIUS = 8;

                // 检查鼠标是否靠近任何一个手柄
                for (const handle of handlePositions) {
                    const distance = Math.sqrt(
                    Math.pow(mouseX - handle.x, 2) +
                    Math.pow(mouseY - handle.y, 2)
                    );

                    if (distance <= SENSITIVITY_RADIUS) {
                        return handle.dir;
                    }
                }

                return null;
            }

            /**
            * 开始调整标注
            */
            startResize(e) {
                if (this.state.isAnnotating || !this.state.annotationsVisible) return;

                const rect = this.annotationCanvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (!this._annotationRects) return;

                // 检查是否点击在当前编辑标注的手柄上
                if (this.currentEditingAnnotation) {
                    const currentAnn = this._annotationRects.find(a => a.id === this.currentEditingAnnotation.id);
                    if (currentAnn) {
                        const direction = this.getResizeDirection(mouseX, mouseY, currentAnn);
                        if (direction) {
                            e.preventDefault();
                            e.stopPropagation();

                            const annotation = this.state.annotations.find(a => a.id === currentAnn.id);
                            if (!annotation) return;

                            // 修改：同时添加 annotating 和 drawing 类，复用画标注的滑竿禁用机制
                            this.comparisonContainer.classList.add('annotating', 'drawing');

                            this.state.isResizing = true;
                            this.state.resizeAnnotationId = currentAnn.id;
                            this.state.resizeDirection = direction;
                            this.state.resizeStartX = mouseX;
                            this.state.resizeStartY = mouseY;
                            this.state.resizeStartBaseX = annotation.baseX;
                            this.state.resizeStartBaseY = annotation.baseY;
                            this.state.resizeStartBaseWidth = annotation.baseWidth;
                            this.state.resizeStartBaseHeight = annotation.baseHeight;

                            console.log('开始调整标注: ', currentAnn.id, '方向:', direction);
                            return;
                        }
                    }
                }

                // 情况2：检查是否点击在其他标注上（用于切换当前编辑）
                for (let i = this._annotationRects.length - 1; i >= 0; i--) {
                    const ann = this._annotationRects[i];

                    // 精确判断是否在标注框内
                    if (mouseX >= ann.x && mouseX <= ann.x + ann.width &&
                    mouseY >= ann.y && mouseY <= ann.y + ann.height) {

                        const annotation = this.state.annotations.find(a => a.id === ann.id);
                        if (annotation) {
                            e.preventDefault();
                            e.stopPropagation();

                            // 如果点击的不是当前编辑的标注，切换到新标注
                            if (!this.currentEditingAnnotation || this.currentEditingAnnotation.id !== ann.id) {
                                console.log('切换到标注: ', ann.id);

                                this.currentEditingAnnotation = annotation;
                                this.startHighlightAnimation();
                                this.focusAnnotationInList(ann.id);
                                this.drawAnnotations();
                            }

                            return;
                        }
                    }
                }
            }

            /**
            * 执行调整
            */
            doResize(e) {
                if (!this.state.annotationsVisible || !this.state.isResizing || !this.state.resizeAnnotationId) return;

                e.preventDefault();
                e.stopPropagation();

                const rect = this.annotationCanvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const scale = this.state.zoom / 100;
                const dx = (mouseX - this.state.resizeStartX) / scale;
                const dy = (mouseY - this.state.resizeStartY) / scale;

                const annotation = this.state.annotations.find(a => a.id === this.state.resizeAnnotationId);
                if (!annotation) return;

                const direction = this.state.resizeDirection;

                // 计算新值（基准坐标系）
                let newBaseX = annotation.baseX;
                let newBaseY = annotation.baseY;
                let newBaseWidth = annotation.baseWidth;
                let newBaseHeight = annotation.baseHeight;

                // 根据方向计算新值
                switch(direction) {
                    case 'nw': 
                    newBaseX = this.state.resizeStartBaseX + dx;
                    newBaseY = this.state.resizeStartBaseY + dy;
                    newBaseWidth = this.state.resizeStartBaseWidth - dx;
                    newBaseHeight = this.state.resizeStartBaseHeight - dy;
                    break;
                    case 'ne': 
                    newBaseY = this.state.resizeStartBaseY + dy;
                    newBaseWidth = this.state.resizeStartBaseWidth + dx;
                    newBaseHeight = this.state.resizeStartBaseHeight - dy;
                    break;
                    case 'sw': 
                    newBaseX = this.state.resizeStartBaseX + dx;
                    newBaseWidth = this.state.resizeStartBaseWidth - dx;
                    newBaseHeight = this.state.resizeStartBaseHeight + dy;
                    break;
                    case 'se': 
                    newBaseWidth = this.state.resizeStartBaseWidth + dx;
                    newBaseHeight = this.state.resizeStartBaseHeight + dy;
                    break;
                    case 'n': 
                    newBaseY = this.state.resizeStartBaseY + dy;
                    newBaseHeight = this.state.resizeStartBaseHeight - dy;
                    break;
                    case 's': 
                    newBaseHeight = this.state.resizeStartBaseHeight + dy;
                    break;
                    case 'w': 
                    newBaseX = this.state.resizeStartBaseX + dx;
                    newBaseWidth = this.state.resizeStartBaseWidth - dx;
                    break;
                    case 'e': 
                    newBaseWidth = this.state.resizeStartBaseWidth + dx;
                    break;
                }

                // ===== 复用画标注的边界控制逻辑 =====

                // 1. 获取图片边界（视图坐标）- 同画标注时完全一致
                const imageViewX = this.state.canvasOffsetX || 0;
                const imageViewY = this.state.canvasOffsetY || 0;
                const imageViewWidth = this.state.imageWidth || 0;
                const imageViewHeight = this.state.imageHeight || 0;

                // 2. 将基准坐标转换为视图坐标
                let viewX = imageViewX + (newBaseX * scale);
                let viewY = imageViewY + (newBaseY * scale);
                let viewWidth = newBaseWidth * scale;
                let viewHeight = newBaseHeight * scale;
                let viewRight = viewX + viewWidth;
                let viewBottom = viewY + viewHeight;

                // 3. 限制在图片区域内（视图坐标）- 完全复用画标注的逻辑
                const clampedViewX = Math.max(viewX, imageViewX);
                const clampedViewY = Math.max(viewY, imageViewY);
                const clampedViewRight = Math.min(viewRight, imageViewX + imageViewWidth);
                const clampedViewBottom = Math.min(viewBottom, imageViewY + imageViewHeight);

                // 4. 计算视图坐标下的最终尺寸
                let finalViewX = Math.round(clampedViewX);
                let finalViewY = Math.round(clampedViewY);
                let finalViewWidth = Math.round(Math.max(10, clampedViewRight - clampedViewX));
                let finalViewHeight = Math.round(Math.max(10, clampedViewBottom - clampedViewY));

                // 5. 转换回基准坐标 - 完全复用画标注的逻辑
                const finalBaseX = (finalViewX - imageViewX) / scale;
                const finalBaseY = (finalViewY - imageViewY) / scale;
                const finalBaseWidth = finalViewWidth / scale;
                const finalBaseHeight = finalViewHeight / scale;

                // 6. 应用最终值
                if (this.promoteAIAnnotation) this.promoteAIAnnotation(annotation);
                annotation.baseX = Math.max(0, finalBaseX);
                annotation.baseY = Math.max(0, finalBaseY);
                annotation.baseWidth = Math.max(10, finalBaseWidth);
                annotation.baseHeight = Math.max(10, finalBaseHeight);

                // 标记为未保存
                this.markAsUnsaved();

                // 重绘
                this.drawAnnotations();
            }

            /**
            * 停止调整
            */
            stopResize() {
                if (this.state.isResizing) {
                    // 修改：同时移除 annotating 和 drawing 类
                    this.comparisonContainer.classList.remove('annotating', 'drawing');

                    this.state.isResizing = false;
                    this.state.resizeAnnotationId = null;
                    this.state.resizeDirection = null;

                    if (this.currentEditingAnnotation) {
                        this.updateAnnotationListItem(this.currentEditingAnnotation.id);
                    }

                    this.drawAnnotations();
                }
            }

            /**
            * 绘制标注
            */
            drawAnnotations() {
                // 检查 Canvas 实际像素尺寸，如果为 0 则重新初始化
                if (this.annotationCanvas.width === 0 || this.annotationCanvas.height === 0) {
                    const containerWidth = this.canvasWrapper.clientWidth;
                    const containerHeight = this.canvasWrapper.clientHeight || 400;
                    this.setupCanvasBuffer(containerWidth, containerHeight);
                }

                // 清空标注画布（使用CSS像素尺寸）
                const cssWidth = this.annotationCanvas.width / this.devicePixelRatio;
                const cssHeight = this.annotationCanvas.height / this.devicePixelRatio;
                this.annotationCtx.clearRect(0, 0, cssWidth, cssHeight);

                // Hit testing must be cleared together with the pixels. Otherwise
                // hidden annotations can still be selected or resized blindly.
                this._annotationRects = [];

                // ===== 新增：绘制图片边界指示（每次清空后重新绘制）=====
                if (this.state.imageWidth > 0 && this.state.imageHeight > 0) {
                    this.annotationCtx.save();
                    this.annotationCtx.strokeStyle = this.state.imageBoundaryHovered
                        ? 'rgba(118, 128, 145, 0.9)'
                        : 'rgba(198, 205, 216, 0.78)';
                    this.annotationCtx.lineWidth = this.state.imageBoundaryHovered ? 1.5 : 1;
                    this.annotationCtx.setLineDash([4, 4]);      // 虚线细节调整
                    this.annotationCtx.strokeRect(
                    this.state.canvasOffsetX,
                    this.state.canvasOffsetY,
                    this.state.imageWidth,
                    this.state.imageHeight
                    );
                    this.annotationCtx.restore();
                }

                // 如果标注被隐藏，直接返回
                if (!this.state.annotationsVisible) return;

                const scale = this.state.zoom / 100;
                const imageViewX = this.state.canvasOffsetX || 0;
                const imageViewY = this.state.canvasOffsetY || 0;

                const visibleAnnotations = this.getVisibleAnnotations
                    ? this.getVisibleAnnotations()
                    : this.state.annotations;

                visibleAnnotations.forEach((annotation, index) => {
                    const status = annotation.status || 'pending';
                    const statusColor = this.STATUS_CONFIG[status]?.color || '#ff4444';
                    const statusBgColor = this.STATUS_CONFIG[status]?.bgColor || '#ff4444';

                    const viewX = imageViewX + (annotation.baseX * scale);
                    const viewY = imageViewY + (annotation.baseY * scale);
                    const viewWidth = annotation.baseWidth * scale;
                    const viewHeight = annotation.baseHeight * scale;

                    // 存储用于交互检测
                    this._annotationRects.push({
                        id: annotation.id,
                        x: viewX,
                        y: viewY,
                        width: viewWidth,
                        height: viewHeight,
                        baseX: annotation.baseX,
                        baseY: annotation.baseY,
                        baseWidth: annotation.baseWidth,
                        baseHeight: annotation.baseHeight
                    });

                    // 1. 绘制半透明填充
                    this.annotationCtx.fillStyle = this.hexToRgba(statusColor, 0.15);
                    this.annotationCtx.fillRect(viewX, viewY, viewWidth, viewHeight);

                    // 2. 绘制边框
                    this.annotationCtx.strokeStyle = statusColor;
                    this.annotationCtx.lineWidth = 2;
                    this.annotationCtx.strokeRect(viewX, viewY, viewWidth, viewHeight);

                    // 3. 绘制序号
                    const badgeSize = 20;
                    const badgeRadius = 10;
                    let badgeX = viewX - 2;
                    let badgeY = viewY - badgeSize - 2;

                    if (badgeY < 0) {
                        badgeX = viewX + 4;
                        badgeY = viewY + 4;
                    }

                    this.annotationCtx.fillStyle = statusBgColor;
                    this.annotationCtx.beginPath();
                    this.annotationCtx.arc(badgeX + badgeRadius, badgeY + badgeRadius, badgeRadius, 0, 2 * Math.PI);
                    this.annotationCtx.fill();

                    this.annotationCtx.fillStyle = 'white';
                    this.annotationCtx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    this.annotationCtx.textAlign = 'center';
                    this.annotationCtx.textBaseline = 'middle';
                    this.annotationCtx.fillText(
                    (index + 1).toString(),
                    badgeX + badgeRadius,
                    badgeY + badgeRadius
                    );

                    // 5. 高亮当前编辑的标注
                    if (this.currentEditingAnnotation && this.currentEditingAnnotation.id === annotation.id) {
                        const opacity = this.state.highlightOpacity || 1;

                        // 绘制调整手柄（8个小圆点）
                        this.drawResizeHandles(viewX, viewY, viewWidth, viewHeight);
                    }

                    // 6. 如果是悬停状态，添加悬停效果
                    if (this.state.hoveredAnnotationId === annotation.id &&
                    this.currentEditingAnnotation?.id !== annotation.id) {
                        this.annotationCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                        this.annotationCtx.lineWidth = 2;
                        this.annotationCtx.setLineDash([5, 5]);
                        this.annotationCtx.strokeRect(viewX, viewY, viewWidth, viewHeight);
                        this.annotationCtx.setLineDash([]);
                    }

                });
            }

            /**
            * 绘制调整手柄（8个控制点）
            */
            drawResizeHandles(x, y, width, height) {
                const handleSize = 8;
                const halfHandle = handleSize / 2;

                // 8个控制点的位置
                const handles = [
            { x: x - halfHandle, y: y - halfHandle, cursor: 'nw-resize' },      // 左上
            { x: x + width/2 - halfHandle, y: y - halfHandle, cursor: 'n-resize' },     // 上中
            { x: x + width - halfHandle, y: y - halfHandle, cursor: 'ne-resize' },      // 右上
            { x: x - halfHandle, y: y + height/2 - halfHandle, cursor: 'w-resize' },    // 左中
            { x: x + width - halfHandle, y: y + height/2 - halfHandle, cursor: 'e-resize' }, // 右中
            { x: x - halfHandle, y: y + height - halfHandle, cursor: 'sw-resize' },     // 左下
            { x: x + width/2 - halfHandle, y: y + height - halfHandle, cursor: 's-resize' }, // 下中
            { x: x + width - halfHandle, y: y + height - halfHandle, cursor: 'se-resize' }   // 右下
                ];

                this.annotationCtx.fillStyle = '#000000';
                this.annotationCtx.strokeStyle = 'white';
                this.annotationCtx.lineWidth = 2;

                handles.forEach(handle => {
                    this.annotationCtx.beginPath();
                    this.annotationCtx.arc(handle.x + halfHandle, handle.y + halfHandle, halfHandle, 0, 2 * Math.PI);
                    this.annotationCtx.fill();
                    this.annotationCtx.stroke();
                });
            }

            /**
            * 十六进制颜色转RGBA
        * @param {string} hex 十六进制颜色值
        * @param {number} alpha 透明度 (0-1)
        * @returns {string} rgba颜色字符串
            */
            hexToRgba(hex, alpha) {
                // 移除 # 号
                hex = hex.replace('#', '');

                // 解析RGB值
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);

return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }

            /**
            * 更新标注状态
        * @param {number} annotationId 标注ID
        * @param {string} status 新状态 ('pending'|'keep'|'fixed')
            */
            updateAnnotationStatus(annotationId, status) {
                const annotation = this.state.annotations.find(a => a.id === annotationId);
                if (annotation) {
                    if (this.promoteAIAnnotation) this.promoteAIAnnotation(annotation);
                    annotation.status = status;

                    // 标记为未保存
                    this.markAsUnsaved();

                    // 更新标注列表显示
                    this.updateAnnotationsList();

                    // 重绘标注
                    this.drawAnnotations();

                    // 如果当前有编辑中的标注，更新其状态
                    if (this.currentEditingAnnotation && this.currentEditingAnnotation.id === annotationId) {
                        this.currentEditingAnnotation.status = status;
                    }

                    // 关闭浮动菜单（如果存在）
                    if (this.currentFloatingMenu) {
                        this.closeFloatingStatusMenu();
                    }
                }
            }

            showFloatingStatusMenu(e, annotationId) {
                e.stopPropagation();

                // 如果已经有菜单打开，先关闭
                if (document.body.classList.contains('menu-open')) {
                    this.closeFloatingStatusMenu();
                    return;
                }

                // 获取当前标注
                const annotation = this.state.annotations.find(a => a.id === annotationId);
                if (!annotation) return;

                // 获取触发元素的位置
                const trigger = e.currentTarget;
                const rect = trigger.getBoundingClientRect();

                // 创建浮动菜单
                const menu = document.createElement('div');
                menu.className = 'floating-status-menu';
                menu.dataset.annotationId = annotationId;
                menu.innerHTML = `
                <div class="menu-item" data-status="pending">
                <div class="menu-dot pending"></div>
                <span class="menu-text">待修复</span>
                </div>
                <div class="menu-item" data-status="keep">
                <div class="menu-dot keep"></div>
                <span class="menu-text">可遗留</span>
                </div>
                <div class="menu-item" data-status="fixed">
                <div class="menu-dot fixed"></div>
                <span class="menu-text">已修复</span>
                </div>
                `;

                // 设置菜单位置
                menu.style.left = rect.left + 'px';
                menu.style.top = (rect.bottom + 4) + 'px';

                // 添加到body
                document.body.appendChild(menu);

                // 激活菜单
                setTimeout(() => {
                    menu.classList.add('active');
                }, 10);

                // 给body添加菜单打开状态
                document.body.classList.add('menu-open');

                // 为菜单项添加事件
                menu.querySelectorAll('.menu-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const status = item.dataset.status;
                        this.updateAnnotationStatus(annotationId, status);
                        this.closeFloatingStatusMenu();
                    });
                });

                // 点击外部关闭菜单
                const closeOnClickOutside = (event) => {
                    if (!menu.contains(event.target) && !trigger.contains(event.target)) {
                        this.closeFloatingStatusMenu();
                        document.removeEventListener('click', closeOnClickOutside);
                    }
                };

                // 延迟添加事件，避免立即触发
                setTimeout(() => {
                    document.addEventListener('click', closeOnClickOutside);
                }, 10);

                // 按ESC关闭菜单
                const closeOnEsc = (event) => {
                    if (event.key === 'Escape') {
                        this.closeFloatingStatusMenu();
                        document.removeEventListener('keydown', closeOnEsc);
                    }
                };
                document.addEventListener('keydown', closeOnEsc);

                // 保存菜单引用，以便后续关闭
                this.currentFloatingMenu = menu;
                this.currentMenuTrigger = trigger;
                this.closeOnClickOutside = closeOnClickOutside;
                this.closeOnEsc = closeOnEsc;
            }

            /**
            * 关闭浮动状态菜单
            */
            closeFloatingStatusMenu() {
                // 如果偏移菜单开着，不关闭它
                if (this.isOffsetMenuOpen) {
                    // 可以选择关闭或者保持
                    // 这里选择保持偏移菜单
                }

                if (this.currentFloatingMenu) {
                    // 先移除 active 类 -> 触发 CSS 过渡动画
                    this.currentFloatingMenu.classList.remove('active');

                    // 等待动画完成后移除 DOM 元素
                    setTimeout(() => {
                        if (this.currentFloatingMenu && this.currentFloatingMenu.parentNode) {
                            this.currentFloatingMenu.parentNode.removeChild(this.currentFloatingMenu);
                        }
                        // 清理引用
                        this.currentFloatingMenu = null;
                        this.currentMenuTrigger = null;
                    }, 200); // 200ms 与 CSS transition 时间一致
                }

                // 清理事件监听
                if (this.closeOnClickOutside) {
                    document.removeEventListener('click', this.closeOnClickOutside);
                }
                if (this.closeOnEsc) {
                    document.removeEventListener('keydown', this.closeOnEsc);
                }

                this.closeOnClickOutside = null;
                this.closeOnEsc = null;

                // 移除body状态
                document.body.classList.remove('menu-open');
            }

/**
* ECS快捷键关闭菜单方法，需要ESC关闭在此添加
*/
closeAllStatusMenus() {
   // 关闭浮动状态菜单
   if (this.currentFloatingMenu) {
       this.closeFloatingStatusMenu();
   }
   // 关闭偏移菜单
   if (this.isOffsetMenuOpen) {
       this.closeOffsetMenu();
   }
   // 关闭宽度选择下拉菜单
   if (this.widthDropdown && this.widthDropdown.classList.contains('active')) {
       this.widthDropdown.classList.remove('active');
       this.widthSelectorTrigger?.classList.remove('active');
   }
   // 关闭图片替换菜单
   if (this.imageReplaceMenu && this.imageReplaceMenu.classList.contains('active')) {
       this.imageReplaceMenu.classList.remove('active');
   }
   if (this.closeAISettingsPanel) {
       this.closeAISettingsPanel();
   }
   // 关闭历史侧边栏
   if (this.isSidebarOpen) {
       this.closeHistorySidebar();
   }
}

            /**
            * 更新标注列表
            */
            updateAnnotationsList() {
                const visibleAnnotations = this.getVisibleAnnotations
                    ? this.getVisibleAnnotations()
                    : this.state.annotations;

                if (visibleAnnotations.length === 0) {
                    const hasHiddenAI = this.state.annotations.some(annotation => annotation.source === 'ai') &&
                        this.aiSettings?.showAIAnnotations === false;
                    this.annotationsList.innerHTML = `
                    <div class="empty-annotations">
                    <i class="icon ufo"></i>
                    <p>${hasHiddenAI ? 'AI标注已隐藏' : '暂无标注'}</p>
                    </div>
                    `;
                    this.clearAllButton.disabled = true;
                    this.exportPdfButton.disabled = true;
                    this.toggleVisibilityButton.style.display = 'none';
                    if (this.updateAIActionState) this.updateAIActionState();
                    return;
                }

                this.clearAllButton.disabled = false;
                this.exportPdfButton.disabled = false;
                this.toggleVisibilityButton.style.display = 'flex';

                this.annotationsList.innerHTML = visibleAnnotations.map((annotation, index) => {
                    // 根据状态设置对应的样式类
                    const statusClass = annotation.status || 'pending';

                    return `
                <div class="annotation-item" data-id="${annotation.id}">
                    <div class="annotation-header-row">
                    <!-- 序号容器 -->
                    <div class="annotation-number-container">
                    <!-- 可点击的状态触发器（只有序号，没有菜单） -->
                <div class="status-trigger" data-annotation-id="${annotation.id}">
            <div class="badge ${statusClass}">${index + 1}</div>
                    </div>
                    </div>

                    <!-- 描述区域 -->
                    <div class="annotation-desc-container">
                <textarea class="annotation-desc" data-id="${annotation.id}"
                placeholder="请输入标注内容">${annotation.description || ''}</textarea>
                    </div>

                    <!-- 删除按钮 -->
                <button class="delete-annotation" data-id="${annotation.id}" title="删除标注">
                    <i class="icon x"></i>
                    </button>
                    </div>
                    </div>
                    `;
                }).join('');

                // 为状态触发器添加事件
                this.annotationsList.querySelectorAll('.status-trigger').forEach(trigger => {
                    const annotationId = parseInt(trigger.dataset.annotationId);

                    // 点击序号显示菜单
                    trigger.addEventListener('click', (e) => {
                        this.showFloatingStatusMenu(e, annotationId);
                    });
                });

                // 为菜单项添加事件
                this.annotationsList.querySelectorAll('.menu-item').forEach(item => {
                    const annotationId = parseInt(item.dataset.annotationId);
                    const status = item.dataset.status;

                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.updateAnnotationStatus(annotationId, status);

                        // 关闭菜单
                        const menu = item.closest('.status-menu');
                        if (menu) {
                            menu.classList.remove('active');
                        }
                    });
                });

                // 为删除按钮添加事件
                this.annotationsList.querySelectorAll('.delete-annotation').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const id = parseInt(btn.dataset.id);
                        this.deleteAnnotation(id);
                    });
                });

// 为文本框添加事件
this.annotationsList.querySelectorAll('.annotation-desc').forEach(textarea => {
    // 🆕 初始化时调整一次高度
    this.autoResizeTextarea(textarea);
    
    // 输入时自动调整高度
    textarea.addEventListener('input', (e) => {
        const id = parseInt(e.target.dataset.id);
        const annotation = this.state.annotations.find(a => a.id === id);
        if (annotation) {
            if (this.promoteAIAnnotation) this.promoteAIAnnotation(annotation);
            annotation.description = e.target.value;
            this.markAsUnsaved();
        }
        // 🆕 自动调整高度
        this.autoResizeTextarea(e.target);
    });

    textarea.addEventListener('focus', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.focusAnnotation(id);
    });

    textarea.addEventListener('blur', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.blurAnnotation(id);
    });
    
    // 🆕 监听内容变化（如从历史记录加载时）
    const observer = new MutationObserver(() => {
        this.autoResizeTextarea(textarea);
    });
    observer.observe(textarea, { 
        attributes: true, 
        attributeFilter: ['value'] 
    });
});

            }

            /**
            * 更新列表中对应的标注项
            */
            updateAnnotationListItem(annotationId) {
                const annotation = this.state.annotations.find(a => a.id === annotationId);
                if (!annotation) return;

                // 找到列表中对应的textarea
            const textarea = document.querySelector(`.annotation-desc[data-id="${annotationId}"]`);
                if (textarea) {
                    // 可以在这里更新显示，比如在description旁边显示坐标
                    // 或者保持原样，因为坐标不直接在列表中显示
                }
            }

            /**
            * 在列表中聚焦对应的标注
            */
            focusAnnotationInList(annotationId) {
            const textarea = document.querySelector(`.annotation-desc[data-id="${annotationId}"]`);
                if (textarea) {
                    textarea.focus();
                    // 滚动到视图
                textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }

            focusAnnotation(id) {
                const annotation = this.state.annotations.find(a => a.id === id);
                if (annotation) {
                    // 高亮显示对应的标注框，并启动淡入动画
                    this.currentEditingAnnotation = annotation;
                    this.startHighlightAnimation();
                }
            }

            blurAnnotation(id) {
                // 清除高亮，停止动画
                this.currentEditingAnnotation = null;
                this.stopHighlightAnimation();
                this.state.hoveredAnnotationId = null;
                this.drawAnnotations();
            }

            /**
            * 显示标注编辑模态框
        * @param {Object} annotation 标注对象
            */
            showAnnotationModal(annotation) {
                this.currentEditingAnnotation = annotation;

                // 获取标注的序号（在数组中的位置 + 1）
                const visibleAnnotations = this.getVisibleAnnotations
                    ? this.getVisibleAnnotations()
                    : this.state.annotations;
                const index = visibleAnnotations.findIndex(a => a.id === annotation.id);
                const displayNumber = index >= 0 ? index + 1: 1;

                this.modalAnnotationId.textContent = displayNumber;
                this.annotationDesc.value = annotation.description || '';
                this.modal.classList.add('active');

                // 自动聚焦到文本框
                setTimeout(() => {
                    this.annotationDesc.focus();
                }, 100);
            }

            closeModal() {
                this.modal.classList.remove('active');
                this.currentEditingAnnotation = null;
                this.stopHighlightAnimation();
                this.drawAnnotations(); // 清除高亮
            }

            saveAnnotation() {
                if (this.currentEditingAnnotation) {
                    if (this.promoteAIAnnotation) this.promoteAIAnnotation(this.currentEditingAnnotation);
                    this.currentEditingAnnotation.description = this.annotationDesc.value;
                    this.updateAnnotationsList();
                    this.closeModal();
                }
            }

            deleteAnnotation(id = null) {
                if (id === null && this.currentEditingAnnotation) {
                    id = this.currentEditingAnnotation.id;
                }

                if (id) {
                    this.state.annotations = this.state.annotations.filter(a => a.id !== id);
                    this.stopHighlightAnimation();
                    this.drawAnnotations();
                    this.updateAnnotationsList();
                    this.closeModal();
                }
            }

            clearAllAnnotations() {
                this.showClearAnnotationsModal();
            }

// ===== 标注显示隐藏控制 =====
toggleAnnotationsVisibility() {
    this.state.annotationsVisible = !this.state.annotationsVisible;

    if (!this.state.annotationsVisible) {
        this.isDrawing = false;
        this.state.isDrawing = false;
        this.state.isResizing = false;
        this.state.resizeAnnotationId = null;
        this.state.resizeDirection = null;
        this.state.hoveredAnnotationId = null;
        this.currentEditingAnnotation = null;
        this._annotationRects = [];
        this.comparisonContainer?.classList.remove('annotating', 'drawing');
    } else if (this.state.isAnnotating) {
        this.comparisonContainer?.classList.add('annotating');
    }

    if (this.annotationCanvas) {
        this.annotationCanvas.style.pointerEvents = this.state.annotationsVisible ? 'auto' : 'none';
        this.annotationCanvas.style.cursor = this.state.annotationsVisible
            ? (this.state.isAnnotating && this.state.imageBoundaryHovered ? 'crosshair' : 'default')
            : 'default';
    }

    if (!this.state.annotationsVisible) {
        this.setImageBoundaryHover(false);
    }

    // 更新按钮图标
    const icon = this.toggleVisibilityButton.querySelector('i');
    if (this.state.annotationsVisible) {
        icon.className = 'icon eye-edit';
        this.toggleVisibilityButton.classList.remove('hidden-active');
    } else {
        icon.className = 'icon eye-dotted';
        this.toggleVisibilityButton.classList.add('hidden-active');
    }

    // 重绘画布（根据状态显示或隐藏标注）
    this.drawAnnotations();

    // 同时控制插件标注画布的显示/隐藏
    if (window.drawingToolbar) {
        const pluginInstance = window.drawingToolbar.getInstance();
        if (pluginInstance && pluginInstance.drawCanvas) {
            if (this.state.annotationsVisible) {
                pluginInstance.drawCanvas.style.display = 'block';
                pluginInstance.drawCanvas.style.visibility = 'visible';
                pluginInstance.drawCanvas.style.opacity = '1';
                pluginInstance.drawCanvas.style.pointerEvents = '';
            } else {
                pluginInstance.drawCanvas.style.display = 'none';
                pluginInstance.drawCanvas.style.visibility = 'hidden';
                pluginInstance.drawCanvas.style.opacity = '0';
                pluginInstance.drawCanvas.style.pointerEvents = 'none';
            }
        }
    }
}

};
