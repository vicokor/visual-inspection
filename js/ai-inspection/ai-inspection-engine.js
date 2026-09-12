/**
 * v23 本地视觉视检调度：语义解析、结构匹配、样式验证、策略过滤和现有标注格式。
 * 不联网、不改变原图；像素差异只作为语义匹配后的复核证据。
 */
(function () {
    'use strict';

    const DEFAULT_SETTINGS = Object.freeze({
        autoDetect: true,
        showAIAnnotations: true,
        sensitivity: 3,
        ignoreContent: true,
        ignoreQuantity: true,
        ignoreSystemUI: true,
        ignoreDynamicImages: true,
        ignoreRenderNoise: true
    });

    // 容差均以用户选择的基准宽度下的 px 为单位，与源图倍率无关。
    const SENSITIVITY = Object.freeze({
        1: Object.freeze({ label: '宽松', tolerance: 4, colorThreshold: 48, minCells: 12, maxAnnotations: 60 }),
        2: Object.freeze({ label: '较宽松', tolerance: 3, colorThreshold: 36, minCells: 9, maxAnnotations: 60 }),
        3: Object.freeze({ label: '标准', tolerance: 2, colorThreshold: 26, minCells: 6, maxAnnotations: 60 }),
        4: Object.freeze({ label: '较严格', tolerance: 1, colorThreshold: 18, minCells: 4, maxAnnotations: 60 }),
        5: Object.freeze({ label: '严格', tolerance: 0.5, colorThreshold: 10, minCells: 2, maxAnnotations: 60 })
    });


    class LocalVisualInspectionEngine {
        constructor() { this.cancelled = false; }
        cancel() { this.cancelled = true; }
        ensureActive() { if (this.cancelled) throw new Error('检测已取消'); }
        yieldToBrowser() { return new Promise(resolve => setTimeout(resolve, 0)); }

        async analyze({ designImage, devImage, baseWidth = 375, settings = {}, onProgress = () => {} } = {}) {
            if (!designImage || !devImage) throw new Error('缺少设计图或开发图');
            this.cancelled = false;
            baseWidth = Number(baseWidth) > 0 ? Number(baseWidth) : 375;
            const config = { ...DEFAULT_SETTINGS, ...settings };
            config.sensitivity = Math.max(1, Math.min(5, Math.round(Number(config.sensitivity) || 3)));
            const sensitivity = SENSITIVITY[config.sensitivity];
            onProgress(8, '正在统一比较基准');
            await this.yieldToBrowser();
            const { width } = this.chooseAnalysisSize(designImage, devImage, baseWidth);
            const designCanvas = this.createScaledCanvas(designImage, width);
            const devCanvas = this.createScaledCanvas(devImage, width);
            const designData = designCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, designCanvas.height);
            const devData = devCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, devCanvas.height);
            const nativeText = config.ignoreContent ? await this.detectNativeText(designCanvas, devCanvas) : null;
            this.ensureActive();
            onProgress(24, '正在解析元素与页面结构');
            const registration = new window.LocalVisualRegistration({
                designData, devData, baseWidth, config, sensitivity, nativeText, ensureActive: () => this.ensureActive()
            });
            await registration.prepare(percent => onProgress(percent, '正在匹配组件与页面结构'));
            this.ensureActive();
            onProgress(56, '正在复检对齐后的局部差异');
            // 固定约1个基准像素的采样格，灵敏度不再通过粗采样改变检测结果。
            const cellSize = Math.max(1, Math.round(width / baseWidth));
            const gridWidth = Math.ceil(width / cellSize), gridHeight = Math.ceil(devCanvas.height / cellSize);
            const diff = await this.buildDifferenceGrid({ registration, gridWidth, gridHeight, cellSize, baseWidth, config, sensitivity });
            this.ensureActive();
            onProgress(82, '正在按证据生成问题描述');
            if (config.ignoreRenderNoise) this.removeIsolatedCells(diff.grid, gridWidth, gridHeight);
            this.closeSmallGaps(diff.grid, gridWidth, gridHeight);
            let regions = this.findConnectedRegions(diff.grid, diff.deltaGrid, diff.edgeGrid, diff.unmatchedGrid,
                gridWidth, gridHeight, cellSize);
            regions = this.mergeNearbyRegions(regions, 3 * registration.unit);
            const annotations = [...registration.annotations];
            for (const region of regions) {
                if (region.cells < sensitivity.minCells) continue;
                const cause = registration.classify(region);
                const semantic = registration.semanticContextForRegion?.(region) || null;
                if (cause.category === 'color' && semantic?.evidence?.nodeId && annotations.some(annotation =>
                    annotation.category === 'color' && annotation.evidence?.nodeId === semantic.evidence.nodeId)) continue;
                const pad = 3 * registration.unit;
                const target = semantic?.box || region;
                const x = Math.max(0, target.x - pad), y = Math.max(0, target.y - pad);
                annotations.push({
                    baseX: x / registration.unit, baseY: y / registration.unit,
                    baseWidth: (Math.min(width, target.x + target.width + pad) - x) / registration.unit,
                    baseHeight: (Math.min(devCanvas.height, target.y + target.height + pad) - y) / registration.unit,
                    ...cause,
                    evidence: {
                        kind: cause.category === 'color' ? 'pixel-color' : 'unconfirmed-pixel-residual',
                        property: cause.category === 'color' ? 'color' : null,
                        ...(semantic?.evidence || {}),
                        residualCells: region.cells,
                        residualMeanDelta: region.meanDelta
                    },
                    confidence: cause.category === 'unconfirmed' ? 0.6 : (semantic ? 0.88 : 0.8),
                    status: 'pending', source: 'ai', reviewStatus: 'unreviewed'
                });
            }
            this.ensureActive();
            const devBaseHeight = devCanvas.height / registration.unit;
            const croppedBottom = designCanvas.height > devCanvas.height + registration.tolerance;
            const visibleAnnotations = annotations.filter(annotation => {
                if (registration.insideClippedEntity(annotation)) return false;
                if (config.longScreenshotMode && config.ignoreRenderNoise &&
                    !this.longScreenshotAnnotationHasEvidence(registration, annotation,
                        sensitivity.colorThreshold)) return false;
                const ignoredRightStart = baseWidth * (1 - Math.max(0, Math.min(0.25,
                    Number(config.ignoreRightEdgeRatio) || 0)));
                const rightOverlap = Math.max(0,
                    annotation.baseX + annotation.baseWidth - ignoredRightStart);
                if (rightOverlap / Math.max(1, annotation.baseWidth) >= 0.5) return false;
                const boundaryCause = annotation.category === 'structure' || annotation.category === 'unconfirmed';
                return !(croppedBottom && boundaryCause && annotation.baseY + annotation.baseHeight >= devBaseHeight - 12);
            });
            const policy = registration.annotationPolicy || (typeof window.AIAnnotationPolicy === 'function'
                ? new window.AIAnnotationPolicy({ config, sensitivity, maxAnnotations: sensitivity.maxAnnotations }) : null);
            const resolution = policy
                ? policy.apply(visibleAnnotations)
                : { annotations: this.removeOverlappingAnnotations(this.consolidateElementAnnotations(visibleAnnotations))
                    .slice(0, sensitivity.maxAnnotations), suppressed: {}, truncated: false };
            const finalAnnotations = resolution.annotations;
            const ignored = { ...registration.ignored };
            for (const [key, value] of Object.entries(resolution.suppressed || {})) ignored[key] = (ignored[key] || 0) + value;
            onProgress(100, '检测完成');
            return {
                annotations: finalAnnotations,
                summary: { issueCount: finalAnnotations.length, ignoredTotal: Object.values(ignored).reduce((a, b) => a + b, 0),
                    ignored, analysisWidth: width, tolerance: sensitivity.tolerance,
                    truncated: resolution.truncated,
                    engineVersion: '23.0',
                    semanticNodes: (registration.semanticPages?.design?.allNodes?.length || 0) +
                        (registration.semanticPages?.dev?.allNodes?.length || 0),
                    semanticMatches: registration.topLevelMatches?.length || 0,
                    ocrMode: nativeText ? 'native-ocr' : 'local-text-structure' }
            };
        }

        longScreenshotAnnotationHasEvidence(registration, annotation, colorThreshold) {
            const unit = registration.unit;
            const x0 = annotation.baseX * unit;
            const y0 = annotation.baseY * unit;
            const width = Math.max(unit, annotation.baseWidth * unit);
            const height = Math.max(unit, annotation.baseHeight * unit);
            const radius = Math.max(1, Math.round(unit));
            const mean = (image, x, y) => {
                const value = [0, 0, 0];
                let count = 0;
                for (const oy of [-radius, 0, radius]) for (const ox of [-radius, 0, radius]) {
                    const color = registration.pixel(image, x + ox, y + oy);
                    for (let channel = 0; channel < 3; channel++) value[channel] += color[channel];
                    count++;
                }
                return value.map(channel => channel / count);
            };
            let total = 0;
            let strong = 0;
            const columns = 10;
            const rows = 10;
            for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
                const x = x0 + (column + 0.5) * width / columns;
                const y = y0 + (row + 0.5) * height / rows;
                const designMean = mean(registration.design, x, y);
                const devMean = mean(registration.dev, x, y);
                const delta = designMean.reduce((sum, value, channel) =>
                    sum + Math.abs(value - devMean[channel]), 0) / 3;
                total += delta;
                if (delta > colorThreshold) strong++;
            }
            const samples = columns * rows;
            return total / samples > colorThreshold * 0.6 || strong / samples >= 0.3;
        }

        async detectNativeText(designCanvas, devCanvas) {
            if (typeof window.TextDetector !== 'function' || designCanvas.width * designCanvas.height > 4200000) return null;
            let timer;
            try {
                const detector = new window.TextDetector();
                return await Promise.race([
                    Promise.all([detector.detect(designCanvas), detector.detect(devCanvas)])
                        .then(([design, dev]) => ({ design, dev })),
                    new Promise(resolve => { timer = setTimeout(() => resolve(null), 4000); })
                ]);
            } catch (_) { return null; }
            finally { clearTimeout(timer); }
        }

        chooseAnalysisSize(designImage, devImage, baseWidth) {
            const ratio = Math.max(designImage.height / designImage.width, devImage.height / devImage.width);
            // 保留2倍基准分辨率；长图受总像素预算限制时容差仍按同一比例换算。
            const width = Math.max(160, Math.floor(Math.min(1440, baseWidth * 2, Math.sqrt(4500000 / Math.max(1, ratio)))));
            return { width };
        }

        createScaledCanvas(image, targetWidth) {
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = Math.max(1, Math.round(image.height * targetWidth / image.width));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas;
        }

        async buildDifferenceGrid({ registration, gridWidth, gridHeight, cellSize, baseWidth, config, sensitivity }) {
            const grid = new Uint8Array(gridWidth * gridHeight), deltaGrid = new Uint8Array(grid.length);
            const edgeGrid = new Uint8Array(grid.length), unmatchedGrid = new Uint8Array(grid.length);
            const top = config.ignoreSystemUI ? (baseWidth <= 500 ? 44 : 56) * registration.unit : 0;
            const right = registration.dev.width * (1 - Math.max(0, Math.min(0.25,
                Number(config.ignoreRightEdgeRatio) || 0)));
            for (let gy = 0; gy < gridHeight; gy++) {
                if (gy % 64 === 0) { await this.yieldToBrowser(); this.ensureActive(); }
                const y = Math.min(registration.dev.height - 1, gy * cellSize + Math.floor(cellSize / 2));
                if (y < top) continue;
                for (let gx = 0; gx < gridWidth; gx++) {
                    const x = Math.min(registration.dev.width - 1, gx * cellSize + Math.floor(cellSize / 2));
                    if (x >= right) continue;
                    const delta = registration.differenceAt(x, y), index = gy * gridWidth + gx;
                    deltaGrid[index] = Math.round(delta);
                    if (delta > sensitivity.colorThreshold) grid[index] = 1;
                }
            }
            return { grid, deltaGrid, edgeGrid, unmatchedGrid };
        }

        removeIsolatedCells(grid, width, height) {
            const source = grid.slice();
            for (let y = 1; y < height - 1; y += 1) {
                for (let x = 1; x < width - 1; x += 1) {
                    const index = y * width + x;
                    if (!source[index]) continue;
                    let neighbors = 0;
                    for (let oy = -1; oy <= 1; oy += 1) {
                        for (let ox = -1; ox <= 1; ox += 1) {
                            if (ox || oy) neighbors += source[(y + oy) * width + x + ox];
                        }
                    }
                    if (neighbors <= 1) grid[index] = 0;
                }
            }
        }

        closeSmallGaps(grid, width, height) {
            const source = grid.slice();
            for (let y = 1; y < height - 1; y += 1) {
                for (let x = 1; x < width - 1; x += 1) {
                    const index = y * width + x;
                    if (source[index]) continue;
                    const horizontal = source[index - 1] && source[index + 1];
                    const vertical = source[index - width] && source[index + width];
                    if (horizontal || vertical) grid[index] = 1;
                }
            }
        }

        findConnectedRegions(grid, deltaGrid, edgeGrid, unmatchedGrid, width, height, cellSize) {
            const regions = [];
            const queue = new Int32Array(grid.length);
            for (let start = 0; start < grid.length; start += 1) {
                if (!grid[start]) continue;
                let head = 0;
                let tail = 0;
                queue[tail++] = start;
                grid[start] = 0;
                let minX = width;
                let minY = height;
                let maxX = 0;
                let maxY = 0;
                let cells = 0;
                let delta = 0;
                let edge = 0;
                let unmatched = 0;

                while (head < tail) {
                    const index = queue[head++];
                    const x = index % width;
                    const y = Math.floor(index / width);
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                    cells += 1;
                    delta += deltaGrid[index];
                    edge += edgeGrid[index];
                    unmatched += unmatchedGrid[index];

                    for (let oy = -1; oy <= 1; oy += 1) {
                        for (let ox = -1; ox <= 1; ox += 1) {
                            if (!ox && !oy) continue;
                            const nx = x + ox;
                            const ny = y + oy;
                            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                            const next = ny * width + nx;
                            if (!grid[next]) continue;
                            grid[next] = 0;
                            queue[tail++] = next;
                        }
                    }
                }

                const boxCells = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
                regions.push({
                    x: minX * cellSize,
                    y: minY * cellSize,
                    width: (maxX - minX + 1) * cellSize,
                    height: (maxY - minY + 1) * cellSize,
                    cells,
                    fillRatio: cells / boxCells,
                    meanDelta: delta / Math.max(1, cells),
                    meanEdgeDelta: edge / Math.max(1, cells),
                    unmatchedRatio: unmatched / Math.max(1, cells),
                    score: cells * (1 + delta / Math.max(1, cells) / 80)
                });
            }
            return regions;
        }

        mergeNearbyRegions(regions, gap) {
            const output = [];
            regions.forEach(region => {
                const match = output.find(item => this.rectGap(item, region) <= gap && this.shouldMerge(item, region));
                if (!match) {
                    output.push({ ...region });
                    return;
                }
                const right = Math.max(match.x + match.width, region.x + region.width);
                const bottom = Math.max(match.y + match.height, region.y + region.height);
                match.x = Math.min(match.x, region.x);
                match.y = Math.min(match.y, region.y);
                match.width = right - match.x;
                match.height = bottom - match.y;
                const totalCells = match.cells + region.cells;
                match.meanDelta = (match.meanDelta * match.cells + region.meanDelta * region.cells) / totalCells;
                match.meanEdgeDelta = (match.meanEdgeDelta * match.cells + region.meanEdgeDelta * region.cells) / totalCells;
                match.unmatchedRatio = (match.unmatchedRatio * match.cells + region.unmatchedRatio * region.cells) / totalCells;
                match.cells = totalCells;
                match.fillRatio = Math.min(1, match.fillRatio + region.fillRatio * 0.5);
                match.score += region.score;
            });
            return output;
        }

        rectGap(a, b) {
            const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
            const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
            return Math.max(dx, dy);
        }

        shouldMerge(a, b) {
            const horizontalOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            return horizontalOverlap > Math.min(a.width, b.width) * 0.2 ||
                verticalOverlap > Math.min(a.height, b.height) * 0.2;
        }

        splitOversizedRegions(regions, canvasWidth, canvasHeight) {
            const output = [];
            regions.forEach(region => {
                if (region.height < canvasHeight * 0.24 || region.width < canvasWidth * 0.55) {
                    output.push(region);
                    return;
                }
                const partHeight = Math.max(100, Math.round(canvasHeight * 0.12));
                const parts = Math.ceil(region.height / partHeight);
                for (let part = 0; part < parts; part += 1) {
                    const y = region.y + part * partHeight;
                    const height = Math.min(partHeight, region.y + region.height - y);
                    output.push({
                        ...region,
                        y,
                        height,
                        cells: Math.max(1, Math.round(region.cells / parts)),
                        score: region.score / parts
                    });
                }
            });
            return output;
        }

        consolidateElementAnnotations(annotations) {
            const fixed = annotations.filter(annotation => annotation.category === 'spacing');
            const groups = [];
            const mergeBox = (target, source) => {
                const right = Math.max(target.baseX + target.baseWidth, source.baseX + source.baseWidth);
                const bottom = Math.max(target.baseY + target.baseHeight, source.baseY + source.baseHeight);
                target.baseX = Math.min(target.baseX, source.baseX);
                target.baseY = Math.min(target.baseY, source.baseY);
                target.baseWidth = right - target.baseX;
                target.baseHeight = bottom - target.baseY;
            };
            const related = (a, b) => {
                const overlapX = Math.min(a.baseX + a.baseWidth, b.baseX + b.baseWidth) - Math.max(a.baseX, b.baseX);
                const overlapY = Math.min(a.baseY + a.baseHeight, b.baseY + b.baseHeight) - Math.max(a.baseY, b.baseY);
                const gapX = Math.max(0, -overlapX), gapY = Math.max(0, -overlapY);
                if (overlapX > 0 && overlapY > 0) return true;
                if (gapX <= 3 && overlapY >= Math.min(a.baseHeight, b.baseHeight) * 0.35) return true;
                return gapY <= 3 && overlapX >= Math.min(a.baseWidth, b.baseWidth) * 0.35;
            };
            annotations.filter(annotation => annotation.category !== 'spacing')
                .sort((a, b) => a.baseY - b.baseY || a.baseX - b.baseX)
                .forEach(annotation => {
                    const matches = groups.filter(group => related(group, annotation));
                    if (!matches.length) {
                        groups.push({ ...annotation, members: [annotation] });
                        return;
                    }
                    const target = matches[0];
                    target.members.push(annotation);
                    mergeBox(target, annotation);
                    for (let i = 1; i < matches.length; i++) {
                        const extra = matches[i];
                        target.members.push(...extra.members);
                        mergeBox(target, extra);
                        groups.splice(groups.indexOf(extra), 1);
                    }
                });
            const summarized = groups.map(group => this.summarizeElementGroup(group));
            return [...summarized, ...fixed].sort((a, b) => a.baseY - b.baseY || a.baseX - b.baseX);
        }

        summarizeElementGroup(group) {
            const members = group.members || [group];
            if (members.length === 1) {
                const { members: _, ...single } = group;
                if (single.category === 'color' && !single.evidence && /^该区域/.test(single.description)) {
                    single.description = single.description.replace(/^该区域/, '元素');
                }
                return single;
            }
            const categories = new Set(members.map(item => item.category));
            if (categories.size > 1) categories.delete('unconfirmed');
            const kinds = members.map(item => item.evidence?.kind || '');
            const textCount = kinds.filter(kind => kind.startsWith('text-') || kind === 'line-height').length;
            const scope = textCount === members.length ? '文字' : (textCount ? '字段' : '元素');
            let description;
            if (categories.has('structure')) {
                description = '元素与设计稿不一致。';
            } else {
                const properties = [];
                if (categories.has('size')) properties.push('大小');
                if (categories.has('position')) properties.push('位置');
                if (categories.has('typography')) properties.push('排版');
                if (categories.has('color')) properties.push('颜色或透明度');
                description = properties.length ? `${scope}${properties.join('和')}不一致。` : '元素与设计稿不一致。';
            }
            const preferred = members.slice().sort((a, b) => b.confidence - a.confidence)[0];
            return {
                ...preferred,
                baseX: group.baseX,
                baseY: group.baseY,
                baseWidth: group.baseWidth,
                baseHeight: group.baseHeight,
                category: categories.size === 1 ? [...categories][0] : 'combined',
                description,
                confidence: Math.max(...members.map(item => item.confidence || 0.6)),
                evidence: { kind: 'element-summary', causes: [...categories], memberCount: members.length }
            };
        }


        removeOverlappingAnnotations(annotations) {
            const result = [];
            annotations.sort((a, b) => b.confidence - a.confidence).forEach(annotation => {
                // 同一元素的尺寸与颜色可以同时有错，不跨原因去重。
                if (!result.some(item => item.category === annotation.category && this.intersectionOverUnion(item, annotation) > 0.68)) {
                    result.push(annotation);
                }
            });
            return result.sort((a, b) => a.baseY - b.baseY || a.baseX - b.baseX);
        }

        intersectionOverUnion(a, b) {
            const x0 = Math.max(a.baseX, b.baseX);
            const y0 = Math.max(a.baseY, b.baseY);
            const x1 = Math.min(a.baseX + a.baseWidth, b.baseX + b.baseWidth);
            const y1 = Math.min(a.baseY + a.baseHeight, b.baseY + b.baseHeight);
            const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
            const union = a.baseWidth * a.baseHeight + b.baseWidth * b.baseHeight - intersection;
            return union ? intersection / union : 0;
        }


    }
    window.AI_INSPECTION_SENSITIVITY = SENSITIVITY;
    window.AI_INSPECTION_DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    window.LocalVisualInspectionEngine = LocalVisualInspectionEngine;
})();
