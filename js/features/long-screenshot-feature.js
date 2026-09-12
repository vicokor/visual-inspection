/**
 * 长截图拼接功能
 * 自动识别相邻截图重叠区，并把重叠区拆分为“上图底部裁切 + 下图顶部裁切”。
 * 最终图片只顺序绘制裁切后的有效像素，不再通过图层覆盖制造拼接效果。
 */
const withLongScreenshotFeature = (Base) => class extends Base {
    initLongScreenshotEvents() {
        this.longScreenshotToggle = document.getElementById('dev-long-screenshot-toggle');
        this.longScreenshotToggleCompact = document.getElementById('dev-long-screenshot-toggle-compact');
        this.longScreenshotAdjustButton = document.getElementById('long-screenshot-adjust-btn');
        this.longScreenshotModal = document.getElementById('long-screenshot-modal');
        this.longScreenshotCloseButton = document.getElementById('long-screenshot-close');
        this.longScreenshotCancelButton = document.getElementById('long-screenshot-cancel');
        this.longScreenshotApplyButton = document.getElementById('long-screenshot-apply');
        this.longScreenshotAutoButton = document.getElementById('long-screenshot-auto-arrange');
        this.longScreenshotPreviewShell = document.getElementById('long-screenshot-preview-shell');
        this.longScreenshotPreviewStage = document.getElementById('long-screenshot-preview-stage');
        this.longScreenshotPreviewCanvas = document.getElementById('long-screenshot-preview-canvas');
        this.longScreenshotSeamsLayer = document.getElementById('long-screenshot-seams-layer');
        this.longScreenshotModeEnabled = false;
        this.longScreenshotConfig = null;
        this.longScreenshotWorkingConfig = null;
        this.longScreenshotActiveSeam = -1;
        this.longScreenshotDrag = null;
        this.longScreenshotEdgeSpace = null;
        this.longScreenshotEdgeAnimation = null;
        this.longScreenshotRequiresManualAI = false;
        this.longScreenshotOrderWasReversed = false;

        [this.longScreenshotToggle, this.longScreenshotToggleCompact].forEach(toggle => {
            if (!toggle) return;
            toggle.closest('.long-screenshot-upload-option')
                ?.addEventListener('click', event => event.stopPropagation());
            toggle.addEventListener('change', event => {
                this.setLongScreenshotUploadMode(event.target.checked);
                if (this.state.designImage && this.state.devImage &&
                    this.comparisonContainer?.style.display !== 'none') this.updateComparison();
                else this.syncLongScreenshotAdjustButton();
            });
        });

        this.longScreenshotAdjustButton?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            this.openLongScreenshotEditor();
        });
        this.longScreenshotCloseButton?.addEventListener('click', () => this.closeLongScreenshotEditor());
        this.longScreenshotCancelButton?.addEventListener('click', () => this.closeLongScreenshotEditor());
        this.longScreenshotApplyButton?.addEventListener('click', () => this.applyLongScreenshotEdits());
        this.longScreenshotAutoButton?.addEventListener('click', () => this.resetLongScreenshotAutoLayout());
        this.longScreenshotModal?.addEventListener('click', event => {
            if (event.target === this.longScreenshotModal) this.closeLongScreenshotEditor();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.longScreenshotModal?.classList.contains('active')) {
                this.closeLongScreenshotEditor();
            }
        });

        if (this.longScreenshotPreviewCanvas) {
            this.longScreenshotPreviewCanvas.addEventListener('pointerdown', event => this.startLongScreenshotDrag(event));
            this.longScreenshotPreviewCanvas.addEventListener('pointermove', event => this.moveLongScreenshotDrag(event));
            this.longScreenshotPreviewCanvas.addEventListener('pointerup', event => this.stopLongScreenshotDrag(event));
            this.longScreenshotPreviewCanvas.addEventListener('pointercancel', event => this.stopLongScreenshotDrag(event));
        }
        this.setLongScreenshotUploadMode(false);
    }

    setLongScreenshotUploadMode(enabled) {
        this.longScreenshotModeEnabled = !!enabled;
        if (this.longScreenshotToggle) this.longScreenshotToggle.checked = this.longScreenshotModeEnabled;
        if (this.longScreenshotToggleCompact) this.longScreenshotToggleCompact.checked = this.longScreenshotModeEnabled;
        if (this.devInput) this.devInput.multiple = this.longScreenshotModeEnabled;
        const hint = this.devUpload?.querySelector('.upload-hint');
        if (hint) {
            hint.textContent = this.longScreenshotModeEnabled
                ? '选择多张截图，或复制多张后按 Cmd/Ctrl+V'
                : '点击或拖拽上传图片';
        }
    }

    isLongScreenshotUploadEnabled() {
        return !!this.longScreenshotModeEnabled;
    }

    hasActiveLongScreenshot() {
        return !!(this.isLongScreenshotUploadEnabled() &&
            this.longScreenshotConfig?.segments?.length > 1);
    }

    shouldSkipAutomaticAIInspection() {
        return !!(this.hasActiveLongScreenshot() && this.longScreenshotRequiresManualAI);
    }

    clearLongScreenshotState({ keepToggle = false } = {}) {
        this.longScreenshotConfig = null;
        this.longScreenshotWorkingConfig = null;
        this.longScreenshotActiveSeam = -1;
        this.longScreenshotDrag = null;
        this.longScreenshotRequiresManualAI = false;
        this.longScreenshotOrderWasReversed = false;
        if (!keepToggle) this.setLongScreenshotUploadMode(false);
        this.syncLongScreenshotAdjustButton();
    }

    async handleImageUpload(event, type) {
        const files = Array.from(event?.target?.files || []);
        if (type === 'dev' && this.isLongScreenshotUploadEnabled() && files.length > 1) {
            if (event?.target) event.target.value = '';
            return this.handleLongScreenshotFiles(files);
        }
        if (type === 'dev') this.clearLongScreenshotState({ keepToggle: true });
        return super.handleImageUpload(event, type);
    }

    handleDrop(event, type) {
        const files = Array.from(event?.dataTransfer?.files || []);
        if (type === 'dev' && this.isLongScreenshotUploadEnabled() && files.length > 1) {
            return this.handleLongScreenshotFiles(files);
        }
        if (type === 'dev') this.clearLongScreenshotState({ keepToggle: true });
        return super.handleDrop(event, type);
    }

    handleDroppedFiles(fileList, type, { compact = false } = {}) {
        const files = Array.from(fileList || []);
        if (type === 'dev' && this.isLongScreenshotUploadEnabled() && files.length > 1) {
            return this.handleLongScreenshotFiles(files);
        }
        if (!files.length) return;
        if (type === 'dev') this.clearLongScreenshotState({ keepToggle: true });
        return compact
            ? super.handleCompactImageUpload(files[0], type)
            : super.handleImageUpload({ target: { files } }, type);
    }

    async handleCompactImageUpload(file, type) {
        if (type === 'dev') this.clearLongScreenshotState({ keepToggle: true });
        return super.handleCompactImageUpload(file, type);
    }

    async handleClipboardImage(file, type) {
        if (type === 'dev') this.clearLongScreenshotState({ keepToggle: true });
        return super.handleClipboardImage(file, type);
    }

    async handlePaste(event) {
        const pasteTarget = event.target;
        const isEditableTarget = pasteTarget?.matches?.('input, textarea, [contenteditable="true"]');
        const isDevTarget = this.hoveredUploadArea === 'dev' ||
            this.hoveredUploadArea === 'dev-compact' ||
            (!this.hoveredUploadArea && !isEditableTarget && this.isLongScreenshotUploadEnabled());
        if (!isDevTarget || !this.isLongScreenshotUploadEnabled()) {
            return super.handlePaste(event);
        }

        event.preventDefault();
        event.stopPropagation();
        let files = this.getClipboardImageFiles(event.clipboardData);
        if (files.length < 2 && typeof navigator !== 'undefined' && navigator.clipboard?.read) {
            try {
                const clipboardItems = await navigator.clipboard.read();
                const asyncFiles = [];
                for (let itemIndex = 0; itemIndex < clipboardItems.length; itemIndex += 1) {
                    const item = clipboardItems[itemIndex];
                    const imageType = item.types.find(type => type.startsWith('image/'));
                    if (!imageType) continue;
                    const blob = await item.getType(imageType);
                    const extension = imageType.includes('jpeg') ? 'jpg' : (imageType.split('/')[1] || 'png');
                    asyncFiles.push(new File([blob], `剪贴板截图_${itemIndex + 1}.${extension}`, { type: imageType }));
                }
                if (asyncFiles.length > files.length) files = asyncFiles;
            } catch (error) {
                console.warn('异步读取多图剪贴板失败，使用粘贴事件数据:', error);
            }
        }

        if (files.length < 2) {
            if (files.length === 1) return this.handleClipboardImage(files[0], 'dev');
            this.showToast('剪贴板中未读取到图片', 'error', 4200);
            return undefined;
        }
        return this.handleLongScreenshotFiles(files);
    }

    getClipboardImageFiles(clipboardData) {
        if (!clipboardData) return [];
        const directFiles = Array.from(clipboardData.files || []).filter(file => this.isSupportedImageFile(file));
        if (directFiles.length) return directFiles;
        return Array.from(clipboardData.items || [])
            .filter(item => item.kind === 'file' && item.type?.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter(Boolean);
    }

    isSupportedImageFile(file) {
        const type = String(file?.type || '').toLowerCase();
        const name = String(file?.name || '');
        return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(type) ||
            (!type && /\.(png|jpe?g|webp)$/i.test(name));
    }

    validateLongScreenshotFiles(files) {
        if (files.length < 2) return '长截图拼接至少需要 2 张手机截图';
        if (files.length > 20) return '单次最多拼接 20 张截图';
        const invalid = files.find(file => !this.isSupportedImageFile(file));
        if (invalid) return '请仅上传 PNG、JPG 或 WEBP 格式的图片';
        const oversized = files.find(file => file.size > 10 * 1024 * 1024);
        if (oversized) return `“${oversized.name}”超过 10MB`;
        return '';
    }

    async handleLongScreenshotFiles(files) {
        const error = this.validateLongScreenshotFiles(files);
        if (error) {
            this.showToast(error, 'error');
            return;
        }
        try {
            this.showToast(`正在识别并裁切 ${files.length} 张截图…`, 'info', 1800);
            const images = await Promise.all(files.map(file => this.loadImage(file)));
            const targetWidth = Math.max(1, images[0].naturalWidth || images[0].width);
            const segments = images.map((image, index) => ({
                image,
                name: files[index].name || `截图 ${index + 1}`,
                height: Math.max(1, Math.round((image.naturalHeight || image.height) * targetWidth /
                    Math.max(1, image.naturalWidth || image.width)))
            }));
            const config = {
                version: 2,
                targetWidth,
                segments,
                topCrops: new Array(segments.length).fill(0),
                bottomCrops: new Array(segments.length).fill(0),
                seamConfirmed: new Array(Math.max(0, segments.length - 1)).fill(false),
                autoFailedSeams: []
            };

            this.longScreenshotOverlapCache = new WeakMap();
            this.longScreenshotOrderWasReversed = this.orientLongScreenshotSegments(config);
            await this.autoArrangeLongScreenshot(config);
            this.fitLongScreenshotConfig(config);
            const composedImage = await this.buildLongScreenshotImage(config);
            if (this.prepareForImageChange) this.prepareForImageChange();
            this.state.devImage = composedImage;
            this.longScreenshotConfig = config;
            this.longScreenshotRequiresManualAI = config.autoFailedSeams.length > 0;
            this.setLongScreenshotUploadMode(true);
            this.updatePreview(this.devPreview, `开发长截图（${segments.length} 张）.png`, composedImage);
            this.updateStartButton();
            this.syncLongScreenshotAdjustButton();
            if (this.longScreenshotRequiresManualAI) {
                const seams = config.autoFailedSeams.map(index => `${index + 1}-${index + 2}`).join('、');
                this.showToast(`第 ${seams} 张截图间未找到可靠重叠，已顺接并跳过自动 AI 检测；请调整后在 AI 面板手动检测`,
                    'warning', 6200);
            } else {
                this.showToast(`${this.longScreenshotOrderWasReversed ? '已修正截图顺序，' : ''}已裁切重叠区域并合并 ${segments.length} 张截图`,
                    'success');
            }
        } catch (error) {
            console.error('长截图拼接失败:', error);
            this.showToast('长截图拼接失败，请减少图片数量后重试', 'error');
        }
    }

    async autoArrangeLongScreenshot(config) {
        config.topCrops.fill(0);
        config.bottomCrops.fill(0);
        config.seamConfirmed = new Array(Math.max(0, config.segments.length - 1)).fill(false);
        config.autoFailedSeams = [];
        for (let index = 1; index < config.segments.length; index += 1) {
            const overlap = this.getCachedLongScreenshotOverlap(
                config.segments[index - 1], config.segments[index], config.targetWidth
            );
            const minimumReliableOverlap = Math.round(Math.min(
                config.segments[index - 1].height, config.segments[index].height) * 0.1);
            if (overlap >= minimumReliableOverlap) {
                const lowerTopCrop = Math.round(overlap * 0.6);
                config.bottomCrops[index - 1] = Math.max(0, overlap - lowerTopCrop);
                config.topCrops[index] = Math.max(0, lowerTopCrop);
            } else {
                config.autoFailedSeams.push(index - 1);
            }
            this.normalizeLongScreenshotCrops(config);
            if (index % 2 === 0) {
                await new Promise(resolve => {
                    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
                    else resolve();
                });
            }
        }
    }

    orientLongScreenshotSegments(config) {
        if (config.segments.length < 2) return false;
        const score = segments => segments.slice(1).reduce((total, segment, index) => {
            const previous = segments[index];
            const overlap = this.getCachedLongScreenshotOverlap(previous, segment, config.targetWidth);
            const minimumHeight = Math.min(previous.height, segment.height);
            return total + (overlap >= minimumHeight * 0.1 ? overlap / minimumHeight : 0);
        }, 0);
        const forwardScore = score(config.segments);
        const reversed = config.segments.slice().reverse();
        const reverseScore = score(reversed);
        if (reverseScore <= forwardScore + 0.18 * (config.segments.length - 1)) return false;
        config.segments = reversed;
        return true;
    }

    getCachedLongScreenshotOverlap(previous, current, targetWidth) {
        if (!this.longScreenshotOverlapCache) this.longScreenshotOverlapCache = new WeakMap();
        let currentMap = this.longScreenshotOverlapCache.get(previous);
        if (!currentMap) {
            currentMap = new WeakMap();
            this.longScreenshotOverlapCache.set(previous, currentMap);
        }
        const cached = currentMap.get(current);
        if (cached && cached.targetWidth === targetWidth) return cached.overlap;
        const overlap = this.estimateLongScreenshotOverlap(previous, current, targetWidth);
        currentMap.set(current, { targetWidth, overlap });
        return overlap;
    }

    estimateLongScreenshotOverlap(previous, current, targetWidth) {
        try {
            const sampleWidth = 96;
            // 横向缩小以降低计算量，Y 轴尽量保留原始像素密度，避免纵向缩略造成
            // 1px 相位偏差后把正确重叠位置错判为相邻位置。
            const verticalScale = Math.min(1, 2400 / Math.max(previous.height, current.height));
            const previousHeight = Math.max(1, Math.round(previous.height * verticalScale));
            const currentHeight = Math.max(1, Math.round(current.height * verticalScale));
            const minHeight = Math.min(previousHeight, currentHeight);
            if (minHeight < 48) return 0;

            const previousCanvas = document.createElement('canvas');
            const currentCanvas = document.createElement('canvas');
            previousCanvas.width = currentCanvas.width = sampleWidth;
            previousCanvas.height = previousHeight;
            currentCanvas.height = currentHeight;
            previousCanvas.getContext('2d').drawImage(previous.image, 0, 0, sampleWidth, previousHeight);
            currentCanvas.getContext('2d').drawImage(current.image, 0, 0, sampleWidth, currentHeight);
            const previousData = previousCanvas.getContext('2d', { willReadFrequently: true })
                .getImageData(0, 0, sampleWidth, previousHeight).data;
            const currentData = currentCanvas.getContext('2d', { willReadFrequently: true })
                .getImageData(0, 0, sampleWidth, currentHeight).data;

            const minimumOverlap = Math.max(16, Math.round(minHeight * 0.08));
            const maximumOverlap = Math.max(minimumOverlap, Math.round(minHeight * 0.9));
            const step = Math.max(1, Math.floor((maximumOverlap - minimumOverlap) / 220));
            const sampleLeft = Math.round(sampleWidth * 0.05);
            const sampleRight = Math.round(sampleWidth * 0.86);
            const scoreOverlap = overlap => {
                const startY = Math.min(overlap - 1,
                    Math.max(2, Math.min(Math.round(currentHeight * 0.14), Math.round(overlap * 0.42))));
                const endY = Math.max(startY + 1,
                    overlap - Math.max(2, Math.round(previousHeight * 0.045)));
                if (endY - startY < 10) return null;

                let difference = 0;
                let samples = 0;
                let luminanceTotal = 0;
                let luminanceSquaredTotal = 0;
                const rows = Math.min(140, Math.max(36, endY - startY));
                const columns = 48;
                for (let row = 0; row < rows; row += 1) {
                    const relativeY = Math.min(endY - 1,
                        Math.floor(startY + (row + 0.5) * (endY - startY) / rows));
                    const previousY = previousHeight - overlap + relativeY;
                    const currentY = relativeY;
                    for (let column = 0; column < columns; column += 1) {
                        const x = Math.min(sampleRight - 1,
                            Math.floor(sampleLeft + (column + 0.5) * (sampleRight - sampleLeft) / columns));
                        const previousOffset = (previousY * sampleWidth + x) * 4;
                        const currentOffset = (currentY * sampleWidth + x) * 4;
                        difference += Math.abs(previousData[previousOffset] - currentData[currentOffset]);
                        difference += Math.abs(previousData[previousOffset + 1] - currentData[currentOffset + 1]);
                        difference += Math.abs(previousData[previousOffset + 2] - currentData[currentOffset + 2]);
                        const luminance = previousData[previousOffset] * 0.299 +
                            previousData[previousOffset + 1] * 0.587 + previousData[previousOffset + 2] * 0.114;
                        luminanceTotal += luminance;
                        luminanceSquaredTotal += luminance * luminance;
                        samples += 3;
                    }
                }
                const meanDifference = difference / Math.max(1, samples);
                const luminanceSamples = rows * columns;
                const meanLuminance = luminanceTotal / luminanceSamples;
                const contrast = Math.sqrt(Math.max(0,
                    luminanceSquaredTotal / luminanceSamples - meanLuminance * meanLuminance));
                return { overlap, score: meanDifference, meanDifference, contrast };
            };

            let best = null;
            for (let overlap = minimumOverlap; overlap <= maximumOverlap; overlap += step) {
                const candidate = scoreOverlap(overlap);
                if (candidate && (!best || candidate.score < best.score)) best = candidate;
            }
            if (best && step > 1) {
                const refineStart = Math.max(minimumOverlap, best.overlap - step);
                const refineEnd = Math.min(maximumOverlap, best.overlap + step);
                for (let overlap = refineStart; overlap <= refineEnd; overlap += 1) {
                    const candidate = scoreOverlap(overlap);
                    if (candidate && candidate.score < best.score) best = candidate;
                }
            }
            if (!best || best.meanDifference > 20 || best.contrast < 2.5) return 0;
            return Math.max(0, Math.round(best.overlap / verticalScale));
        } catch (error) {
            console.warn('自动重叠识别失败，使用无裁切顺接:', error);
            return 0;
        }
    }

    normalizeLongScreenshotCrops(config) {
        const minimumVisible = 32;
        config.segments.forEach((segment, index) => {
            let top = Math.max(0, Math.round(Number(config.topCrops[index]) || 0));
            let bottom = Math.max(0, Math.round(Number(config.bottomCrops[index]) || 0));
            const maximumTotalCrop = Math.max(0, segment.height - minimumVisible);
            if (top + bottom > maximumTotalCrop) {
                const excess = top + bottom - maximumTotalCrop;
                if (bottom >= excess) bottom -= excess;
                else {
                    top = Math.max(0, top - (excess - bottom));
                    bottom = 0;
                }
            }
            config.topCrops[index] = top;
            config.bottomCrops[index] = bottom;
        });
        config.topCrops[0] = 0;
        config.bottomCrops[config.segments.length - 1] = 0;
    }

    getLongScreenshotVisibleHeight(config, index) {
        const segment = config.segments[index];
        return Math.max(1, segment.height - config.topCrops[index] - config.bottomCrops[index]);
    }

    getLongScreenshotHeight(config) {
        return Math.max(1, config.segments.reduce((total, _segment, index) =>
            total + this.getLongScreenshotVisibleHeight(config, index), 0));
    }

    fitLongScreenshotConfig(config) {
        this.normalizeLongScreenshotCrops(config);
        const height = this.getLongScreenshotHeight(config);
        const maxHeight = 32760;
        const maxWidth = 8192;
        const maxArea = 160000000;
        const scale = Math.min(1, maxHeight / height, maxWidth / config.targetWidth,
            Math.sqrt(maxArea / Math.max(1, config.targetWidth * height)));
        if (scale >= 0.999) return false;
        config.targetWidth = Math.max(1, Math.floor(config.targetWidth * scale));
        config.segments.forEach(segment => {
            segment.height = Math.max(1, Math.floor(segment.height * scale));
        });
        config.topCrops = config.topCrops.map(value => Math.max(0, Math.floor(value * scale)));
        config.bottomCrops = config.bottomCrops.map(value => Math.max(0, Math.floor(value * scale)));
        this.normalizeLongScreenshotCrops(config);
        this.showToast('长图尺寸较大，已等比例优化以保证浏览器稳定运行', 'info', 4200);
        return true;
    }

    drawLongScreenshotSegment(context, config, index, destinationY, destinationScale = 1) {
        const segment = config.segments[index];
        const image = segment.image;
        const topCrop = config.topCrops[index];
        const visibleHeight = this.getLongScreenshotVisibleHeight(config, index);
        const imageHeight = image.naturalHeight || image.height;
        const imageWidth = image.naturalWidth || image.width;
        const sourceScale = imageHeight / segment.height;
        context.drawImage(
            image,
            0, topCrop * sourceScale, imageWidth, visibleHeight * sourceScale,
            0, destinationY, config.targetWidth * destinationScale, visibleHeight * destinationScale
        );
    }

    buildLongScreenshotImage(config) {
        this.fitLongScreenshotConfig(config);
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = config.targetWidth;
                canvas.height = this.getLongScreenshotHeight(config);
                const context = canvas.getContext('2d');
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
                let destinationY = 0;
                config.segments.forEach((_segment, index) => {
                    this.drawLongScreenshotSegment(context, config, index, destinationY, 1);
                    destinationY += this.getLongScreenshotVisibleHeight(config, index);
                });
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('合成长截图加载失败'));
                image.src = canvas.toDataURL('image/png');
            } catch (error) {
                reject(error);
            }
        });
    }

    cloneLongScreenshotConfig(config) {
        return {
            version: 2,
            targetWidth: config.targetWidth,
            segments: config.segments.map(segment => ({ ...segment })),
            topCrops: config.topCrops.slice(),
            bottomCrops: config.bottomCrops.slice(),
            seamConfirmed: (config.seamConfirmed || []).slice(),
            autoFailedSeams: (config.autoFailedSeams || []).slice()
        };
    }

    openLongScreenshotEditor() {
        if (!this.longScreenshotConfig || this.longScreenshotConfig.segments.length < 2) {
            this.showToast('当前开发图不是可调整的长截图', 'info');
            return;
        }
        this.longScreenshotWorkingConfig = this.cloneLongScreenshotConfig(this.longScreenshotConfig);
        this.longScreenshotActiveSeam = -1;
        this.releaseLongScreenshotEdgeSpace(false);
        this.renderLongScreenshotPreview();
        this.longScreenshotModal?.classList.add('active');
        this.longScreenshotModal?.setAttribute('aria-hidden', 'false');
    }

    closeLongScreenshotEditor() {
        this.releaseLongScreenshotEdgeSpace(false);
        this.longScreenshotDrag = null;
        this.longScreenshotWorkingConfig = null;
        this.longScreenshotActiveSeam = -1;
        this.longScreenshotModal?.classList.remove('active');
        this.longScreenshotModal?.setAttribute('aria-hidden', 'true');
    }

    renderLongScreenshotPreview() {
        const config = this.longScreenshotWorkingConfig;
        const canvas = this.longScreenshotPreviewCanvas;
        if (!config || !canvas) return;
        this.normalizeLongScreenshotCrops(config);
        const previewWidth = Math.min(460, Math.max(280, config.targetWidth));
        const scale = previewWidth / config.targetWidth;
        const previewHeight = Math.max(1, Math.ceil(this.getLongScreenshotHeight(config) * scale));
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.style.width = `${previewWidth}px`;
        canvas.style.height = `${previewHeight}px`;
        canvas.width = Math.max(1, Math.round(previewWidth * ratio));
        canvas.height = Math.max(1, Math.round(previewHeight * ratio));
        if (this.longScreenshotPreviewStage) {
            this.longScreenshotPreviewStage.style.width = `${previewWidth}px`;
            this.longScreenshotPreviewStage.style.height = `${previewHeight}px`;
        }
        const context = canvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, previewWidth, previewHeight);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

        const layout = [];
        let outputY = 0;
        config.segments.forEach((_segment, index) => {
            const visibleHeight = this.getLongScreenshotVisibleHeight(config, index);
            this.drawLongScreenshotSegment(context, config, index, outputY * scale, scale);
            layout.push({ start: outputY, end: outputY + visibleHeight, visibleHeight });
            outputY += visibleHeight;
        });
        this.longScreenshotPreviewScale = scale;
        this.longScreenshotPreviewLayout = layout;
        this.renderLongScreenshotSeams();
        canvas.classList.toggle('is-adjusting', this.longScreenshotActiveSeam >= 0);
    }

    activateLongScreenshotEdgeSpace(index) {
        const shell = this.longScreenshotPreviewShell;
        const stage = this.longScreenshotPreviewStage;
        const layout = this.longScreenshotPreviewLayout;
        const scale = this.longScreenshotPreviewScale;
        if (!shell || !stage || !layout?.[index] || !layout[index + 1] || !scale) return;

        if (this.longScreenshotEdgeAnimation) {
            cancelAnimationFrame(this.longScreenshotEdgeAnimation);
            this.longScreenshotEdgeAnimation = null;
        }

        const previousTop = this.longScreenshotEdgeSpace?.top || 0;
        const viewportBuffer = Math.max(160, shell.clientHeight || 0);
        const top = Math.ceil(Math.max(viewportBuffer, layout[index].visibleHeight * scale) + 24);
        const bottom = Math.ceil(Math.max(viewportBuffer, layout[index + 1].visibleHeight * scale) + 24);
        stage.style.marginTop = `${top}px`;
        stage.style.marginBottom = `${bottom}px`;
        shell.scrollTop = Math.max(0, shell.scrollTop + top - previousTop);
        this.longScreenshotEdgeSpace = { top, bottom };
    }

    releaseLongScreenshotEdgeSpace(animate = true) {
        const shell = this.longScreenshotPreviewShell;
        const stage = this.longScreenshotPreviewStage;
        const space = this.longScreenshotEdgeSpace;
        if (!shell || !stage || !space) return;

        if (this.longScreenshotEdgeAnimation) {
            cancelAnimationFrame(this.longScreenshotEdgeAnimation);
            this.longScreenshotEdgeAnimation = null;
        }

        const startScrollTop = shell.scrollTop;
        const finish = () => {
            stage.style.marginTop = '';
            stage.style.marginBottom = '';
            this.longScreenshotEdgeSpace = null;
            this.longScreenshotEdgeAnimation = null;
        };

        if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            shell.scrollTop = Math.max(0, startScrollTop - space.top);
            finish();
            return;
        }

        const startTime = performance.now();
        const duration = 240;
        const step = now => {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const remaining = 1 - eased;
            stage.style.marginTop = `${space.top * remaining}px`;
            stage.style.marginBottom = `${space.bottom * remaining}px`;
            shell.scrollTop = Math.max(0, startScrollTop - space.top * eased);
            if (progress < 1) {
                this.longScreenshotEdgeAnimation = requestAnimationFrame(step);
            } else {
                finish();
            }
        };
        this.longScreenshotEdgeAnimation = requestAnimationFrame(step);
    }

    renderLongScreenshotSeams() {
        const layer = this.longScreenshotSeamsLayer;
        const config = this.longScreenshotWorkingConfig;
        if (!layer || !config || !this.longScreenshotPreviewLayout) return;
        const scale = this.longScreenshotPreviewScale;
        layer.innerHTML = config.segments.slice(0, -1).map((_segment, index) => {
            const active = index === this.longScreenshotActiveSeam;
            const confirmed = !!config.seamConfirmed[index];
            const icon = active ? 'check' : 'arrows-move-vertical';
            const label = active ? '完成此处调整' : (confirmed ? '重新调整此处' : '调整此处拼接');
            return `
                <div class="long-screenshot-seam${active ? ' active' : ''}${confirmed ? ' confirmed' : ''}"
                     data-seam="${index}" style="top:${this.longScreenshotPreviewLayout[index].end * scale}px">
                    <span class="long-screenshot-seam-line"></span>
                    <button class="long-screenshot-seam-button" type="button" data-seam-button="${index}"
                            title="${label}" aria-label="${label}"><i class="icon ${icon}"></i></button>
                    ${active ? '<span class="long-screenshot-direction upper"><i class="icon chevrons-down"></i></span><span class="long-screenshot-direction lower"><i class="icon chevrons-up"></i></span>' : ''}
                </div>`;
        }).join('');
        layer.querySelectorAll('[data-seam-button]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleLongScreenshotSeam(Number(button.dataset.seamButton));
            });
        });
    }

    toggleLongScreenshotSeam(index) {
        const config = this.longScreenshotWorkingConfig;
        if (!config) return;
        if (this.longScreenshotActiveSeam === index) {
            config.seamConfirmed[index] = true;
            this.longScreenshotActiveSeam = -1;
            this.renderLongScreenshotPreview();
            this.releaseLongScreenshotEdgeSpace(true);
        } else {
            this.releaseLongScreenshotEdgeSpace(false);
            this.longScreenshotActiveSeam = index;
            config.seamConfirmed[index] = false;
            this.renderLongScreenshotPreview();
            this.activateLongScreenshotEdgeSpace(index);
        }
    }

    startLongScreenshotDrag(event) {
        const config = this.longScreenshotWorkingConfig;
        const seam = this.longScreenshotActiveSeam;
        if (!config || seam < 0 || !this.longScreenshotPreviewScale || !this.longScreenshotPreviewLayout) return;
        const rect = this.longScreenshotPreviewCanvas.getBoundingClientRect();
        const outputY = (event.clientY - rect.top) / this.longScreenshotPreviewScale;
        const seamY = this.longScreenshotPreviewLayout[seam].end;
        const upper = outputY <= seamY;
        const segmentIndex = upper ? seam : seam + 1;
        const cropKey = upper ? 'bottomCrops' : 'topCrops';
        this.longScreenshotDrag = {
            pointerId: event.pointerId,
            startClientY: event.clientY,
            startCrop: config[cropKey][segmentIndex],
            segmentIndex,
            cropKey,
            seam,
            upper,
            startSeamTop: this.longScreenshotPreviewLayout[seam].end * this.longScreenshotPreviewScale,
            startScrollTop: this.longScreenshotPreviewShell?.scrollTop || 0
        };
        this.longScreenshotPreviewCanvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    moveLongScreenshotDrag(event) {
        const drag = this.longScreenshotDrag;
        const config = this.longScreenshotWorkingConfig;
        if (!drag || !config || event.pointerId !== drag.pointerId) return;
        const delta = (event.clientY - drag.startClientY) / Math.max(0.0001, this.longScreenshotPreviewScale);
        const otherKey = drag.cropKey === 'topCrops' ? 'bottomCrops' : 'topCrops';
        const segment = config.segments[drag.segmentIndex];
        const maximumCrop = Math.max(0, segment.height - config[otherKey][drag.segmentIndex] - 32);
        // 上图跟随指针移动，所以下移时增加底部裁切；下图上移时增加顶部裁切。
        // 两侧分别使用相反换算，视觉上都会向固定黄线聚拢。
        const nextCrop = drag.startCrop + (drag.upper ? delta : -delta);
        config[drag.cropKey][drag.segmentIndex] = Math.max(0,
            Math.min(maximumCrop, Math.round(nextCrop)));
        this.renderLongScreenshotPreview();
        if (drag.upper && this.longScreenshotPreviewShell && this.longScreenshotPreviewLayout) {
            const nextSeamTop = this.longScreenshotPreviewLayout[drag.seam].end * this.longScreenshotPreviewScale;
            this.longScreenshotPreviewShell.scrollTop = Math.max(0,
                drag.startScrollTop + nextSeamTop - drag.startSeamTop);
        }
        event.preventDefault();
    }

    stopLongScreenshotDrag(event) {
        if (!this.longScreenshotDrag || event.pointerId !== this.longScreenshotDrag.pointerId) return;
        this.longScreenshotPreviewCanvas.releasePointerCapture?.(event.pointerId);
        this.longScreenshotDrag = null;
    }

    async resetLongScreenshotAutoLayout() {
        if (!this.longScreenshotWorkingConfig || !this.longScreenshotAutoButton) return;
        this.longScreenshotAutoButton.disabled = true;
        this.longScreenshotAutoButton.innerHTML = '<i class="icon loader"></i> 正在重新识别';
        try {
            this.releaseLongScreenshotEdgeSpace(false);
            await this.autoArrangeLongScreenshot(this.longScreenshotWorkingConfig);
            const hasFailedSeams = this.longScreenshotWorkingConfig.autoFailedSeams.length > 0;
            this.longScreenshotActiveSeam = -1;
            this.renderLongScreenshotPreview();
            this.showToast(hasFailedSeams
                ? '仍有拼接处未找到可靠重叠，应用后将跳过自动 AI 检测'
                : '已重新识别全部拼接处', hasFailedSeams ? 'warning' : 'success');
        } finally {
            this.longScreenshotAutoButton.disabled = false;
            this.longScreenshotAutoButton.innerHTML = '<i class="icon reload"></i> 重新自动拼接';
        }
    }

    async applyLongScreenshotEdits() {
        if (!this.longScreenshotWorkingConfig || !this.longScreenshotApplyButton) return;
        const config = this.cloneLongScreenshotConfig(this.longScreenshotWorkingConfig);
        this.longScreenshotApplyButton.disabled = true;
        this.longScreenshotApplyButton.innerHTML = '<i class="icon loader"></i> 正在应用';
        try {
            const composedImage = await this.buildLongScreenshotImage(config);
            if (this.prepareForImageChange) this.prepareForImageChange();
            this.state.devImage = composedImage;
            this.longScreenshotConfig = config;
            this.longScreenshotRequiresManualAI = config.autoFailedSeams.length > 0;
            this.updatePreview(this.devPreview, `开发长截图（${config.segments.length} 张）.png`, composedImage);
            this.updateStartButton();
            this.closeLongScreenshotEditor();
            if (this.comparisonContainer?.style.display !== 'none') {
                this.updateComparison();
                if (this.scheduleAutoInspection) this.scheduleAutoInspection();
            }
            this.markAsUnsaved();
            this.showToast('裁切位置已更新，长截图已重新生成', 'success');
        } catch (error) {
            console.error('应用长截图调整失败:', error);
            this.showToast('应用失败，请缩短长图后重试', 'error');
        } finally {
            this.longScreenshotApplyButton.disabled = false;
            this.longScreenshotApplyButton.innerHTML = '<i class="icon check"></i> 应用拼接';
        }
    }

    serializeLongScreenshotForHistory() {
        const config = this.longScreenshotConfig;
        if (!config || config.segments.length < 2) return null;
        return {
            version: 2,
            targetWidth: config.targetWidth,
            topCrops: config.topCrops.map(value => Math.round(value)),
            bottomCrops: config.bottomCrops.map(value => Math.round(value)),
            seamConfirmed: (config.seamConfirmed || []).slice(),
            autoFailedSeams: (config.autoFailedSeams || []).slice(),
            segments: config.segments.map(segment => ({
                name: segment.name,
                height: segment.height,
                src: segment.image?.src || ''
            }))
        };
    }

    migrateLongScreenshotV1(saved, segments) {
        const topCrops = new Array(segments.length).fill(0);
        const bottomCrops = new Array(segments.length).fill(0);
        const offsets = Array.isArray(saved.offsets) ? saved.offsets.map(value => Number(value) || 0) : [];
        for (let index = 1; index < segments.length; index += 1) {
            const previousOffset = offsets[index - 1] || 0;
            const currentOffset = offsets[index] ?? (previousOffset + segments[index - 1].height);
            const overlap = Math.max(0, Math.round(previousOffset + segments[index - 1].height - currentOffset));
            const lowerTopCrop = Math.round(overlap * 0.6);
            bottomCrops[index - 1] = overlap - lowerTopCrop;
            topCrops[index] = lowerTopCrop;
        }
        return { topCrops, bottomCrops };
    }

    async restoreLongScreenshotFromHistory(saved) {
        if (!saved || !Array.isArray(saved.segments) || saved.segments.length < 2 ||
            !saved.segments.every(segment => typeof segment.src === 'string' && segment.src.startsWith('data:image/'))) {
            this.clearLongScreenshotState({ keepToggle: false });
            return;
        }
        try {
            const images = await Promise.all(saved.segments.map(segment => this.base64ToImage(segment.src)));
            const segments = saved.segments.map((segment, index) => ({
                name: segment.name || `截图 ${index + 1}`,
                height: Math.max(1, Math.round(Number(segment.height) || images[index].height)),
                image: images[index]
            }));
            const migrated = Number(saved.version) >= 2
                ? { topCrops: saved.topCrops || [], bottomCrops: saved.bottomCrops || [] }
                : this.migrateLongScreenshotV1(saved, segments);
            this.longScreenshotConfig = {
                version: 2,
                targetWidth: Math.max(1, Number(saved.targetWidth) || images[0].width),
                segments,
                topCrops: segments.map((_segment, index) => Math.max(0,
                    Math.round(Number(migrated.topCrops[index]) || 0))),
                bottomCrops: segments.map((_segment, index) => Math.max(0,
                    Math.round(Number(migrated.bottomCrops[index]) || 0))),
                seamConfirmed: segments.slice(0, -1).map((_segment, index) => !!saved.seamConfirmed?.[index]),
                autoFailedSeams: Array.isArray(saved.autoFailedSeams)
                    ? saved.autoFailedSeams.filter(index => Number.isInteger(index) && index >= 0 && index < segments.length - 1)
                    : []
            };
            this.normalizeLongScreenshotCrops(this.longScreenshotConfig);
            this.longScreenshotRequiresManualAI = this.longScreenshotConfig.autoFailedSeams.length > 0;
            this.setLongScreenshotUploadMode(true);
            this.syncLongScreenshotAdjustButton();
        } catch (error) {
            console.warn('长截图分段恢复失败，保留已合成开发图:', error);
            this.clearLongScreenshotState({ keepToggle: false });
        }
    }

    getLongScreenshotBottomSpace() {
        return this.hasActiveLongScreenshot() ? 54 : 0;
    }

    syncLongScreenshotAdjustButton() {
        if (!this.longScreenshotAdjustButton) {
            this.longScreenshotAdjustButton = document.getElementById('long-screenshot-adjust-btn');
        }
        const button = this.longScreenshotAdjustButton;
        if (!button) return;
        const visible = !!(this.hasActiveLongScreenshot() &&
            this.state.designImage && this.state.devImage &&
            this.comparisonContainer?.style.display !== 'none');
        button.hidden = !visible;
        if (!visible) {
            button.style.left = '';
            button.style.top = '';
            return;
        }
        const width = this.state.imageWidth || this.state.baseWidth * this.state.zoom / 100;
        button.style.left = `${this.state.canvasOffsetX + width / 2}px`;
        // 入口始终位于两图共用容器之外，避免设计图较高时落到图片内部。
        button.style.top = `${this.state.canvasOffsetY + this.state.imageHeight + 10}px`;
    }

    startInspection() {
        const result = super.startInspection();
        if (this.shouldSkipAutomaticAIInspection()) {
            this.showToast('长截图存在未识别的拼接处，已跳过自动 AI 检测；请调整后在 AI 面板手动检测',
                'warning', 5200);
        }
        requestAnimationFrame(() => this.syncLongScreenshotAdjustButton());
        return result;
    }

    updateComparison() {
        const result = super.updateComparison();
        this.syncLongScreenshotAdjustButton();
        return result;
    }
};
