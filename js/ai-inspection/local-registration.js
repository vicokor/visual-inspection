/**
 * 局部配准与证据归因。只变换比较坐标，不修改用户原图。
 * v23 由语义节点与顺序无关匹配先建立对应，再执行平移/缩放、间距和像素证据验证。
 * 配准失败的区域只保留内部候选证据，不以模糊分类生成可见自动标注。
 */
(function () {
    'use strict';
    const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
    const distance = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

    class LocalVisualRegistration {
        constructor({ designData, devData, baseWidth, config, sensitivity, ensureActive, nativeText = null }) {
            this.design = designData;
            this.dev = devData;
            this.unit = devData.width / baseWidth;
            this.config = config;
            this.sensitivity = sensitivity;
            this.tolerance = sensitivity.tolerance * this.unit;
            const offsets = [0];
            const divisions = Math.max(1, Math.ceil(this.tolerance / 2));
            for (let i = 1; i <= divisions; i++) offsets.push(this.tolerance * i / divisions, -this.tolerance * i / divisions);
            this.neighborhood = offsets.flatMap(y => offsets.map(x => ({ x, y })))
                .filter(p => p.x * p.x + p.y * p.y <= this.tolerance * this.tolerance + 0.01);
            this.ensureActive = ensureActive;
            this.nativeText = nativeText;
            this.entities = [];
            this.annotations = [];
            this.ignored = { content: 0, quantity: 0, dynamic: 0, uncertain: 0, cascade: 0, duplicate: 0 };
            this.semanticParser = typeof window.VisualSemanticParser === 'function'
                ? new window.VisualSemanticParser({
                    design: this.design,
                    dev: this.dev,
                    unit: this.unit,
                    tolerance: this.tolerance,
                    pixel: (image, x, y) => this.pixel(image, x, y),
                    background: (image, box) => this.background(image, box),
                    photoLike: (image, box) => this.photoLike(image, box),
                    nativeText: this.nativeText
                }) : null;
            this.semanticMatcher = typeof window.SemanticStructureMatcher === 'function'
                ? new window.SemanticStructureMatcher({
                    shapeDistance: (design, dev) => this.shapeDistance(design, dev),
                    unit: this.unit,
                    tolerance: this.tolerance,
                    config: this.config
                }) : null;
            this.annotationPolicy = typeof window.AIAnnotationPolicy === 'function'
                ? new window.AIAnnotationPolicy({ config: this.config, sensitivity: this.sensitivity }) : null;
            this.styleEvaluator = typeof window.ElementStyleEvaluator === 'function'
                ? new window.ElementStyleEvaluator({
                    unit: this.unit,
                    tolerance: this.tolerance,
                    sensitivity: this.sensitivity,
                    config: this.config,
                    emit: (box, category, description, evidence, options) =>
                        this.addIssue(box, category, description, evidence, options)
                }) : null;
            this.semanticPages = null;
            this.topLevelMatches = [];
        }

        pixel(image, x, y) {
            if (x < 0 || y < 0 || x >= image.width || y >= image.height) return [255, 255, 255];
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const color = [0, 0, 0];
            // 双线性采样使 0.5 基准像素及缩放坐标具有实际意义。
            for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
                const p = (Math.min(image.height - 1, iy + dy) * image.width + Math.min(image.width - 1, ix + dx)) * 4;
                const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
                const alpha = image.data[p + 3] / 255;
                for (let c = 0; c < 3; c++) color[c] += (image.data[p + c] * alpha + 255 * (1 - alpha)) * weight;
            }
            return color;
        }

        background(image, rect) {
            const colors = new Map();
            const step = Math.max(1, Math.floor(Math.sqrt(rect.width * rect.height / 1800)));
            for (let y = rect.y; y < rect.y + rect.height; y += step) for (let x = rect.x; x < rect.x + rect.width; x += step) {
                const rgb = this.pixel(image, x, y);
                const key = rgb.map(v => Math.round(v / 12)).join(',');
                const item = colors.get(key) || { sum: [0, 0, 0], count: 0 };
                item.count++;
                rgb.forEach((v, c) => { item.sum[c] += v; });
                colors.set(key, item);
            }
            const best = [...colors.values()].sort((a, b) => b.count - a.count)[0];
            return best ? best.sum.map(v => v / best.count) : [255, 255, 255];
        }

        blocks(image) {
            // 在页面边缘取背景，不将卡片内部的大面积填充当作页面背景。
            const edgeWidth = Math.max(2, Math.round(image.width * 0.025));
            const bg = this.background(image, { x: 0, y: 0, width: edgeWidth, height: image.height });
            const rows = [];
            for (let y = 0; y < image.height; y++) {
                let left = image.width, right = -1, count = 0;
                for (let x = 0; x < image.width; x++) {
                    const p = (y * image.width + x) * 4;
                    const alpha = image.data[p + 3] / 255;
                    const delta = (Math.abs(image.data[p] * alpha + 255 * (1 - alpha) - bg[0]) +
                        Math.abs(image.data[p + 1] * alpha + 255 * (1 - alpha) - bg[1]) +
                        Math.abs(image.data[p + 2] * alpha + 255 * (1 - alpha) - bg[2])) / 3;
                    if (delta <= 9) continue;
                    left = Math.min(left, x); right = x; count++;
                }
                rows.push({ left, right, active: count >= Math.max(2, image.width * 0.006) });
            }
            const gap = Math.max(1, Math.round(3 * this.unit));
            const blocks = [];
            let start = -1, last = -1, left = image.width, right = -1;
            const flush = () => {
                if (start < 0) return;
                const rect = { x: left, y: start, width: right - left + 1, height: last - start + 1 };
                if (rect.width * rect.height >= 16 * this.unit * this.unit) {
                    rect.background = bg;
                    blocks.push(rect);
                }
                start = -1; left = image.width; right = -1;
            };
            rows.forEach((row, y) => {
                if (start >= 0 && y - last > gap) flush();
                if (!row.active) return;
                if (start < 0) start = y;
                last = y; left = Math.min(left, row.left); right = Math.max(right, row.right);
            });
            flush();
            return blocks;
        }

        children(image, block) {
            if (block.height < 10 * this.unit || block.width < 12 * this.unit) return [];
            const inset = Math.max(2, Math.round(3 * this.unit));
            const r = { x: block.x + inset, y: block.y + inset,
                width: Math.floor(block.width - inset * 2), height: Math.floor(block.height - inset * 2) };
            if (r.width <= 0 || r.height <= 0) return [];
            const bg = this.background(image, r);
            const mask = new Uint8Array(r.width * r.height);
            const queue = new Int32Array(mask.length);
            for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
                if (distance(this.pixel(image, r.x + x, r.y + y), bg) > 22) mask[y * r.width + x] = 1;
            }
            const result = [];
            for (let p = 0; p < mask.length; p++) {
                if (!mask[p]) continue;
                let head = 0, tail = 1, x0 = r.width, x1 = 0, y0 = r.height, y1 = 0;
                queue[0] = p; mask[p] = 0;
                while (head < tail) {
                    const q = queue[head++], x = q % r.width, y = Math.floor(q / r.width);
                    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy, n = ny * r.width + nx;
                        if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height || !mask[n]) continue;
                        mask[n] = 0; queue[tail++] = n;
                    }
                }
                const width = x1 - x0 + 1, height = y1 - y0 + 1;
                if (tail < Math.max(2, this.unit * this.unit) || width * height > r.width * r.height * 0.65) continue;
                result.push({ x: r.x + x0, y: r.y + y0, width, height, background: bg, glyphs: 1 });
            }
            // 同基线近邻字形合成文字行；跨过明显空隙的新增文字/图标保持独立。
            const grouped = [];
            result.sort((a, b) => a.x - b.x).forEach(item => {
                const match = grouped.find(g => {
                    const horizontalGap = Math.max(0, item.x - g.x - g.width, g.x - item.x - item.width);
                    return horizontalGap <= Math.min(g.height, item.height) * 0.35 &&
                    Math.abs(center(g).y - center(item).y) <= Math.max(2 * this.unit, Math.min(g.height, item.height) * 0.25) &&
                    Math.max(g.height, item.height) / Math.max(1, Math.min(g.height, item.height)) < 1.65 &&
                    item.height < 40 * this.unit && g.height < 40 * this.unit;
                });
                if (!match) { grouped.push({ ...item, glyphHeights: [item.height], glyphBoxes: [{ ...item }] }); return; }
                const left = Math.min(match.x, item.x), right = Math.max(match.x + match.width, item.x + item.width);
                const top = Math.min(match.y, item.y), bottom = Math.max(match.y + match.height, item.y + item.height);
                match.x = left; match.y = top; match.width = right - left; match.height = bottom - top;
                match.glyphs++; match.glyphHeights.push(item.height); match.glyphBoxes.push({ ...item });
            });
            const lines = grouped.map(g => ({ ...g, text: g.glyphs >= 3, glyphHeight: median(g.glyphHeights) }));
            const mergeInto = (target, source) => {
                const left = Math.min(target.x, source.x), right = Math.max(target.x + target.width, source.x + source.width);
                const top = Math.min(target.y, source.y), bottom = Math.max(target.y + target.height, source.y + source.height);
                target.x = left; target.y = top; target.width = right - left; target.height = bottom - top;
                target.glyphs += source.glyphs;
                target.glyphHeights.push(...source.glyphHeights);
                target.glyphBoxes.push(...source.glyphBoxes);
                target.text = target.glyphs >= 3;
                target.glyphHeight = median(target.glyphHeights);
            };
            // 中文字形常被拆为多个偏旁。以已确认文字行为种子吸收近邻小部件，
            // 再合并同基线文字段；宽头像、图片和按钮不会被当作文字桥接。
            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 0; i < lines.length && !changed; i++) {
                    if (!lines[i].text) continue;
                    for (let j = 0; j < lines.length; j++) {
                        if (i === j) continue;
                        const line = lines[i], candidate = lines[j];
                        const gapX = Math.max(0, candidate.x - line.x - line.width, line.x - candidate.x - candidate.width);
                        const overlapY = Math.min(line.y + line.height, candidate.y + candidate.height) - Math.max(line.y, candidate.y);
                        const smallPart = candidate.glyphs <= 2 && candidate.width <= line.height * 1.45 && candidate.height <= line.height * 1.25;
                        const allowedGap = Math.max(line.height, candidate.height) * 0.18;
                        if (gapX > allowedGap || overlapY <= Math.min(line.height, candidate.height) * 0.18 || (!candidate.text && !smallPart)) continue;
                        mergeInto(line, candidate);
                        lines.splice(j, 1);
                        changed = true;
                        break;
                    }
                }
            }
            return lines.sort((a, b) => a.y - b.y || a.x - b.x);
        }

        horizontalSegments(image, block) {
            const bg = block.background || this.background(image, block);
            const x0 = Math.max(0, Math.floor(block.x)), x1 = Math.min(image.width, Math.ceil(block.x + block.width));
            const y0 = Math.max(0, Math.floor(block.y)), y1 = Math.min(image.height, Math.ceil(block.y + block.height));
            const columns = [];
            for (let x = x0; x < x1; x++) {
                let count = 0;
                for (let y = y0; y < y1; y++) if (distance(this.pixel(image, x, y), bg) > 15) count++;
                columns.push({ x, active: count >= Math.max(1, (y1 - y0) * 0.04) });
            }
            const minGap = Math.max(3, Math.round(4 * this.unit));
            const runs = [];
            let start = -1, last = -1;
            const flush = () => {
                if (start >= 0) runs.push({ start, end: last });
                start = -1; last = -1;
            };
            columns.forEach(column => {
                if (!column.active) {
                    if (start >= 0 && column.x - last >= minGap) flush();
                    return;
                }
                if (start < 0) start = column.x;
                last = column.x;
            });
            flush();
            return runs.map(run => {
                let top = y1, bottom = y0 - 1, foreground = 0;
                for (let y = y0; y < y1; y++) for (let x = run.start; x <= run.end; x++) {
                    if (distance(this.pixel(image, x, y), bg) <= 15) continue;
                    top = Math.min(top, y); bottom = Math.max(bottom, y); foreground++;
                }
                const box = { x: run.start, y: top, width: run.end - run.start + 1,
                    height: Math.max(1, bottom - top + 1), background: bg };
                const pad = 2 * this.unit;
                const expanded = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
                    width: Math.min(image.width - Math.max(0, box.x - pad), box.width + pad * 2),
                    height: Math.min(image.height - Math.max(0, box.y - pad), box.height + pad * 2) };
                const textParts = this.children(image, expanded).filter(part => part.text);
                const glyphs = textParts.reduce((sum, part) => sum + part.glyphs, 0);
                const coverage = foreground / Math.max(1, box.width * box.height);
                if (glyphs >= 3 && box.width >= box.height * 2.2 && coverage < 0.72) {
                    box.text = true;
                    box.glyphs = glyphs;
                    box.glyphHeight = median(textParts.map(part => part.glyphHeight));
                    box.glyphBoxes = textParts.flatMap(part => part.glyphBoxes || []);
                }
                return box;
            }).filter(box => box.width * box.height >= 2 * this.unit * this.unit);
        }

        signature(image, box) {
            if (box.signature) return box.signature;
            const samples = [], size = 18;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const color = this.pixel(image, box.x + (x + 0.5) / size * box.width,
                    box.y + (y + 0.5) / size * box.height);
                samples.push(color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114);
            }
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            const std = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length);
            return (box.signature = { values: samples.map(v => (v - mean) / Math.max(12, std)), std });
        }

        shapeDistance(a, b) {
            const d = this.signature(this.design, a), v = this.signature(this.dev, b);
            return d.values.reduce((sum, value, i) => sum + Math.abs(value - v.values[i]), 0) / d.values.length;
        }

        pairingCost(a, b, parent) {
            const aText = !!(a.text || a.textLike), bText = !!(b.text || b.textLike);
            if (aText !== bText && (a.glyphs || b.glyphs || a.textLike || b.textLike)) return 4;
            const hr = b.height / a.height, wr = b.width / a.width;
            const text = aText && bText;
            // 开启内容忽略后，标题长度可以明显不同；文字配对不再用宽度比否决。
            if ((text && (hr < 0.33 || hr > 3)) || (!text && (hr < 0.45 || hr > 2.1 || wr < 0.4 || wr > 2.5))) return 4;
            const expectedX = parent ? a.x + parent.dx : a.x;
            const expectedY = parent ? a.y + parent.dy : a.y;
            const position = Math.min(1, (Math.abs(b.x - expectedX) + Math.abs(b.y - expectedY)) / (160 * this.unit));
            const geometry = text ? Math.abs(Math.log(hr)) : Math.abs(Math.log(hr)) + Math.abs(Math.log(wr));
            return (text ? 0.14 : this.shapeDistance(a, b) * 0.55) + geometry * 0.35 + position * 0.45;
        }

        pairBlocks(design, dev, parent = null, unordered = false) {
            if (unordered) {
                // 卡片内图标变大可能使包围框顶部早于标题；不得以Y排序锁死匹配。
                const candidates = [];
                design.forEach((d, di) => dev.forEach((v, vi) => {
                    const cost = this.pairingCost(d, v, parent);
                    if (cost < 1.05) candidates.push({ d, v, di, vi, cost });
                }));
                candidates.sort((a, b) => a.cost - b.cost);
                const usedD = new Set(), usedV = new Set(), pairs = [];
                for (const c of candidates) {
                    if (usedD.has(c.di) || usedV.has(c.vi)) continue;
                    usedD.add(c.di); usedV.add(c.vi); pairs.push(c);
                }
                return { pairs, extra: dev.filter((_, i) => !usedV.has(i)), missing: design.filter((_, i) => !usedD.has(i)) };
            }
            const n = design.length, m = dev.length, cols = m + 1;
            const cost = new Float64Array((n + 1) * cols), prev = new Uint8Array(cost.length);
            for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
                if (!i && !j) continue;
                const k = i * cols + j;
                let best = Infinity, action = 0;
                if (i && j) { best = cost[(i - 1) * cols + j - 1] + this.pairingCost(design[i - 1], dev[j - 1], parent); action = 1; }
                if (i && cost[(i - 1) * cols + j] + 0.65 < best) { best = cost[(i - 1) * cols + j] + 0.65; action = 2; }
                if (j && cost[i * cols + j - 1] + 0.65 < best) { best = cost[i * cols + j - 1] + 0.65; action = 3; }
                cost[k] = best; prev[k] = action;
            }
            let i = n, j = m;
            const pairs = [], extra = [], missing = [];
            while (i || j) {
                const action = prev[i * cols + j];
                if (action === 1) { pairs.push({ d: design[i - 1], v: dev[j - 1], di: i - 1, vi: j - 1 }); i--; j--; }
                else if (action === 2) { missing.push(design[--i]); }
                else { extra.push(dev[--j]); }
            }
            return { pairs: pairs.reverse(), extra, missing };
        }

        error(d, v, transform) {
            let total = 0, count = 0, visible = 0, geometry = 0;
            const step = Math.max(1, Math.sqrt(v.width * v.height / 700));
            for (let y = v.y + 0.5; y < v.y + v.height; y += step) for (let x = v.x + 0.5; x < v.x + v.width; x += step) {
                const px = transform.x + (x - v.x) / transform.sx;
                const py = transform.y + (y - v.y) / transform.sy;
                count++;
                if (px < 0 || py < 0 || px >= this.design.width || py >= this.design.height) continue;
                const dc = this.pixel(this.design, px, py), vc = this.pixel(this.dev, x, y);
                total += distance(dc, vc) / 255;
                const dInk = distance(dc, d.background || [255, 255, 255]) > 20;
                const vInk = distance(vc, v.background || [255, 255, 255]) > 20;
                geometry += dInk !== vInk ? 1 : 0;
                visible++;
            }
            return { value: visible ? total / visible : 1, geometry: visible ? geometry / visible : 1, coverage: count ? visible / count : 0 };
        }

        verify(pair, parent) {
            const { d, v } = pair;
            const inheritedX = parent?.dx || 0, inheritedY = parent?.dy || 0;
            const direct = this.error(d, v, { x: v.x - inheritedX, y: v.y - inheritedY, sx: 1, sy: 1 });
            let translation = { x: d.x, y: d.y, sx: 1, sy: 1 };
            let moved = this.error(d, v, translation);
            // 先以模块包围框定位，再在局部做亚基准像素搜索；不以8px横条量化位移。
            const radius = Math.max(1, Math.round(this.unit));
            for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
                const candidate = { x: d.x + ox, y: d.y + oy, sx: 1, sy: 1 };
                const score = this.error(d, v, candidate);
                if (score.value + 0.0001 < moved.value) { moved = score; translation = candidate; }
            }
            const sameBounds = d.x === v.x && d.y === v.y && d.width === v.width && d.height === v.height;
            if (sameBounds) {
                translation = { x: d.x, y: d.y, sx: 1, sy: 1 };
                moved = this.error(d, v, translation);
            }
            const scaling = { x: d.x, y: d.y, sx: v.width / d.width, sy: v.height / d.height };
            const scaled = this.error(d, v, scaling);
            const shape = this.shapeDistance(d, v);
            const sizeChanged = Math.abs(v.width - d.width) > this.tolerance || Math.abs(v.height - d.height) > this.tolerance;
            const clipped = v.y + v.height >= this.dev.height && d.height > v.height + this.tolerance &&
                v.height / d.height >= 0.5 && Math.abs(v.width - d.width) <= this.tolerance;
            const translationEvidence = moved.coverage >= 0.9 && moved.value < 0.10 &&
                (moved.value <= direct.value * 0.6 || direct.value < 0.01) && shape < 0.65;
            const scaleEvidence = !clipped && sizeChanged && scaled.coverage >= 0.9 && shape < 0.48 &&
                ((scaled.value < 0.075 && scaled.value + 0.002 < moved.value * 0.62) ||
                 (scaled.geometry < 0.08 && scaled.geometry + 0.005 < moved.geometry * 0.6));
            const sameSemanticType = d.semantic?.type && d.semantic.type === v.semantic?.type;
            const semanticEvidence = sameSemanticType && (pair.matchConfidence || 0) >= 0.78 &&
                (shape < 0.9 || d.semantic.type === 'divider');
            const semanticScaleEvidence = semanticEvidence && sizeChanged && (pair.matchConfidence || 0) >= 0.82 && shape < 0.72;
            const useScale = scaleEvidence || semanticScaleEvidence;
            return {
                ...pair, direct: direct.value, residual: useScale ? scaled.value : moved.value,
                transform: useScale ? scaling : translation,
                dx: v.x - (useScale ? d.x : translation.x), dy: v.y - (useScale ? d.y : translation.y),
                inheritedX, inheritedY, sizeChanged: useScale, clipped,
                accepted: translationEvidence || useScale || semanticEvidence || sameBounds || (clipped && moved.value < 0.025), parent
            };
        }

        markNativeText(parts, image) {
            const items = this.nativeText?.[image === this.design ? 'design' : 'dev'] || [];
            for (const part of parts) {
                const item = items.find(t => {
                    const b = t.boundingBox;
                    if (!b) return false;
                    const intersection = Math.max(0, Math.min(b.x + b.width, part.x + part.width) - Math.max(b.x, part.x)) *
                        Math.max(0, Math.min(b.y + b.height, part.y + part.height) - Math.max(b.y, part.y));
                    return intersection / Math.max(1, part.width * part.height) > 0.82 &&
                        intersection / Math.max(1, b.width * b.height) > 0.7;
                });
                if (item) {
                    part.text = true;
                    part.glyphHeight = part.glyphHeight || item.boundingBox.height;
                    part.ocrText = String(item.rawValue || item.text || item.value || '').trim();
                }
            }
        }

        photoLike(image, box) {
            if (box.text || box.width < 48 * this.unit || box.height < 48 * this.unit) return false;
            const bins = new Set();
            let edges = 0, samples = 0;
            const step = Math.max(2, Math.floor(Math.min(box.width, box.height) / 30));
            for (let y = box.y; y < box.y + box.height; y += step) for (let x = box.x; x < box.x + box.width; x += step) {
                const color = this.pixel(image, x, y);
                bins.add(color.map(c => Math.round(c / 24)).join(','));
                if (distance(color, this.pixel(image, x + 2, y)) > 30) edges++;
                samples++;
            }
            return bins.size > 30 && samples && edges / samples > 0.24;
        }

        dynamicImage(pair, parent) {
            return this.config.ignoreDynamicImages &&
                Math.abs(pair.d.x + (parent?.dx || 0) - pair.v.x) <= this.tolerance &&
                Math.abs(pair.d.y + (parent?.dy || 0) - pair.v.y) <= this.tolerance &&
                Math.abs(pair.d.width - pair.v.width) <= this.tolerance &&
                Math.abs(pair.d.height - pair.v.height) <= this.tolerance &&
                this.photoLike(this.design, pair.d) && this.photoLike(this.dev, pair.v);
        }

        addIssue(box, category, description, evidence = {}, options = {}) {
            // 原截图裁切以外无可见证据，不创建负尺寸或越界标注。
            if (box.width <= 0 || box.height <= 0 || box.y >= this.dev.height || box.x >= this.dev.width || box.y + box.height <= 0 || box.x + box.width <= 0) return;
            const pad = options.pad == null ? 3 * this.unit : options.pad;
            const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
            const semantic = box.semantic || {};
            const enrichedEvidence = {
                ...evidence,
                nodeId: evidence.nodeId || semantic.id || null,
                parentNodeId: evidence.parentNodeId || semantic.parentId || null,
                elementType: evidence.elementType || semantic.type || null,
                role: evidence.role || semantic.role || null,
                criticality: evidence.criticality || semantic.criticality || 'ordinary',
                templateKey: evidence.templateKey || semantic.templateKey || null,
                repeatGroupId: evidence.repeatGroupId || semantic.repeatGroupId || null,
                repeatCount: evidence.repeatCount || semantic.repeatCount || 1
            };
            if (!enrichedEvidence.rootCauseId) {
                const identity = enrichedEvidence.nodeId || `${Math.round(x / this.unit)}:${Math.round(y / this.unit)}`;
                enrichedEvidence.rootCauseId = `${identity}:${enrichedEvidence.kind || category}`;
            }
            this.annotations.push({ baseX: x / this.unit, baseY: y / this.unit,
                baseWidth: (Math.min(this.dev.width, box.x + box.width + pad) - x) / this.unit,
                baseHeight: (Math.min(this.dev.height, box.y + box.height + pad) - y) / this.unit,
                description, category, evidence: enrichedEvidence, confidence: options.confidence == null ? 0.92 : options.confidence,
                source: 'ai', status: 'pending', reviewStatus: 'unreviewed' });
        }

        amount(n) { return Number((n / this.unit).toFixed(1)); }

        spacingBox(upper, lower, gap) {
            // 间距标注只覆盖开发图中的实际留白，横向采用上下模块的整体覆盖范围。
            const x = Math.min(upper.x, lower.x);
            const right = Math.max(upper.x + upper.width, lower.x + lower.width);
            const width = Math.max(this.unit, right - x);
            if (gap >= 0) return { x, y: upper.y + upper.height, width, height: Math.max(this.unit, gap) };
            return { x, y: lower.y, width, height: Math.max(this.unit, -gap) };
        }

        describeSpacing(entity, previous) {
            const { d, v, parent } = entity;
            const horizontalOverlap = previous ? Math.min(previous.v.x + previous.v.width, v.x + v.width) - Math.max(previous.v.x, v.x) : 0;
            const adjacent = !parent && previous?.accepted && previous.di + 1 === entity.di && previous.vi + 1 === entity.vi &&
                horizontalOverlap >= Math.min(previous.v.width, v.width) * 0.5 && previous.v.y + previous.v.height <= v.y;
            if (!adjacent) return { adjacent: false, changed: false };
            const designGap = d.y - previous.d.y - previous.d.height;
            const devGap = v.y - previous.v.y - previous.v.height;
            const delta = devGap - designGap;
            if (Math.abs(delta) <= this.tolerance) return { adjacent: true, changed: false };
            const gapBox = this.spacingBox(previous.v, v, devGap);
            this.addIssue(gapBox, 'spacing', `与上方模块的间距${delta > 0 ? '偏大' : '偏小'} ${this.amount(Math.abs(delta))}px（设计 ${this.amount(designGap)}px，开发 ${this.amount(devGap)}px）。`,
                { kind: 'gap', property: 'spacing', designGap: designGap / this.unit, devGap: devGap / this.unit,
                    direction: delta > 0 ? 'larger' : 'smaller', markedRegion: 'development-gap',
                    nodeId: v.semantic?.id, parentNodeId: v.semantic?.parentId,
                    elementType: v.semantic?.type, templateKey: v.semantic?.templateKey,
                    repeatGroupId: v.semantic?.repeatGroupId, repeatCount: v.semantic?.repeatCount,
                    rootCauseId: `spacing:${previous.v.semantic?.id || previous.vi}:${v.semantic?.id || entity.vi}` }, { pad: 0 });
            return { adjacent: true, changed: true };
        }

        describeGeometry(entity, previous) {
            if (!entity.accepted) return;
            const { d, v, parent } = entity;
            const unitName = d.text && v.text ? '文字' : (d.glyphs || parent ? '元素' : '模块');
            if (entity.sizeChanged) {
                this.addIssue(v, 'size', `${unitName}大小不一致：设计 ${this.amount(d.width)}×${this.amount(d.height)}px，开发 ${this.amount(v.width)}×${this.amount(v.height)}px。`,
                    { kind: 'scale', property: 'size', sx: entity.transform.sx, sy: entity.transform.sy,
                        before: entity.direct, after: entity.residual, matchConfidence: entity.matchConfidence,
                        orderChanged: !!entity.orderChanged });
            }
            // 完整模块换序不属于视觉样式错误；内部元素仍在各自模块坐标中继续检查。
            if (!parent && entity.orderChanged) return;
            const rx = entity.dx - entity.inheritedX, ry = entity.dy - entity.inheritedY;
            const centerDX = center(v).x - center(d).x - entity.inheritedX;
            const centerDY = center(v).y - center(d).y - entity.inheritedY;
            // 中心锚点缩放不重复报位置变化。
            if (entity.sizeChanged && Math.abs(centerDX) <= this.tolerance && Math.abs(centerDY) <= this.tolerance) return;
            if (Math.abs(rx) <= this.tolerance && Math.abs(ry) <= this.tolerance) return;
            const spacing = this.describeSpacing(entity, previous);
            if (spacing.adjacent) {
                if (Math.abs(rx) <= this.tolerance) return;
            }
            if (previous && (previous.di + 1 !== entity.di || previous.vi + 1 !== entity.vi) && this.config.ignoreQuantity) return;
            const parts = [];
            if (Math.abs(rx) > this.tolerance) parts.push(`向${rx > 0 ? '右' : '左'}偏移 ${this.amount(Math.abs(rx))}px`);
            if (!spacing.adjacent && Math.abs(ry) > this.tolerance) parts.push(`向${ry > 0 ? '下' : '上'}偏移 ${this.amount(Math.abs(ry))}px`);
            if (parts.length) this.addIssue(v, 'position', `${unitName}${parts.join('、')}。`, {
                kind: 'translation', property: 'position', dx: rx / this.unit, dy: ry / this.unit,
                matchConfidence: entity.matchConfidence, orderChanged: !!entity.orderChanged
            });
        }

        variableText(pair) {
            const { d, v } = pair;
            return this.config.ignoreContent && d.text && v.text;
        }

        textStyle(image, box) {
            if (box.textStyle) return box.textStyle;
            const bg = box.background || this.background(image, box);
            const inkColors = [];
            const rows = [];
            const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(image.width, Math.ceil(box.x + box.width));
            const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(image.height, Math.ceil(box.y + box.height));
            for (let y = y0; y < y1; y++) {
                let count = 0;
                for (let x = x0; x < x1; x++) {
                    const color = this.pixel(image, x, y);
                    if (distance(color, bg) <= 22) continue;
                    count++; inkColors.push(color);
                }
                rows.push({ y, active: count >= Math.max(1, (x1 - x0) * 0.004) });
            }
            const bands = [];
            const joinGap = Math.max(1, Math.round(this.unit));
            let start = -1, last = -1;
            const flush = () => {
                if (start >= 0) bands.push({ top: start, bottom: last, height: last - start + 1 });
                start = -1; last = -1;
            };
            rows.forEach(row => {
                if (!row.active) {
                    if (start >= 0 && row.y - last > joinGap) flush();
                    return;
                }
                if (start < 0) start = row.y;
                last = row.y;
            });
            flush();
            const visibleHeight = median(bands.map(b => b.height)) || box.height;
            const fontSize = Math.max(box.glyphHeight || 0, visibleHeight);
            const lineSteps = bands.slice(1).map((band, index) => band.top - bands[index].top);
            return (box.textStyle = {
                fontSize,
                lineCount: bands.length,
                lineHeight: lineSteps.length ? median(lineSteps) : null,
                inkColor: inkColors.length ? [0, 1, 2].map(c => median(inkColors.map(v => v[c]))) : bg
            });
        }

        createVariableTextEntity(pair, parent) {
            return {
                ...this.verify(pair, parent), accepted: true, textMask: true, parent,
                transform: { x: pair.d.x, y: pair.d.y, sx: 1, sy: 1 },
                dx: pair.v.x - pair.d.x, dy: pair.v.y - pair.d.y,
                inheritedX: parent?.dx || 0, inheritedY: parent?.dy || 0
            };
        }

        sameTextFlow(previous, entity) {
            if (!previous?.textMask || previous.parent !== entity.parent) return false;
            const a = this.textStyle(this.design, previous.d), b = this.textStyle(this.design, entity.d);
            const font = Math.max(a.fontSize, b.fontSize, this.unit);
            const step = entity.d.y - previous.d.y;
            const aligned = Math.min(Math.abs(entity.d.x - previous.d.x), Math.abs(center(entity.d).x - center(previous.d).x)) <= 2 * this.tolerance;
            return step > 0 && step <= font * 1.9 && Math.abs(a.fontSize - b.fontSize) <= this.tolerance && aligned;
        }

        describeVariableText(entity, previous) {
            const { d, v } = entity;
            const designStyle = this.textStyle(this.design, d), devStyle = this.textStyle(this.dev, v);
            const sizeDifference = Math.abs(devStyle.fontSize - designStyle.fontSize);
            const relativeSizeDifference = sizeDifference / Math.max(this.unit, designStyle.fontSize);
            if (sizeDifference > this.tolerance || (sizeDifference >= this.unit * 0.75 && relativeSizeDifference >= 0.1)) {
                this.addIssue(v, 'size', `文字大小不一致：设计约 ${this.amount(designStyle.fontSize)}px，开发约 ${this.amount(devStyle.fontSize)}px。`,
                    { kind: 'text-size', property: 'text-size', designSize: designStyle.fontSize / this.unit,
                        devSize: devStyle.fontSize / this.unit, matchConfidence: entity.matchConfidence,
                        orderChanged: !!entity.orderChanged });
            }
            if (designStyle.lineHeight != null && devStyle.lineHeight != null && designStyle.lineCount === devStyle.lineCount &&
                Math.abs(devStyle.lineHeight - designStyle.lineHeight) > this.tolerance) {
                this.addIssue(v, 'typography', `文字行高不一致：设计约 ${this.amount(designStyle.lineHeight)}px，开发约 ${this.amount(devStyle.lineHeight)}px。`,
                    { kind: 'line-height', property: 'line-height', designLineHeight: designStyle.lineHeight / this.unit,
                        devLineHeight: devStyle.lineHeight / this.unit, matchConfidence: entity.matchConfidence,
                        orderChanged: !!entity.orderChanged });
            }
            if (distance(designStyle.inkColor, devStyle.inkColor) > this.sensitivity.colorThreshold) {
                this.addIssue(v, 'color', '文字颜色或透明度不一致。', {
                    kind: 'text-color', property: 'text-color', matchConfidence: entity.matchConfidence,
                    orderChanged: !!entity.orderChanged
                });
                entity.colorReported = true;
            }
            if (!entity.parent && entity.orderChanged) return;
            let lineHeightReported = false;
            const sameFlow = this.sameTextFlow(previous, entity);
            if (sameFlow) {
                const designLineHeight = d.y - previous.d.y;
                const devLineHeight = v.y - previous.v.y;
                if (Math.abs(devLineHeight - designLineHeight) > this.tolerance) {
                    const top = Math.min(previous.v.y, v.y), bottom = Math.max(previous.v.y + previous.v.height, v.y + v.height);
                    const left = Math.min(previous.v.x, v.x), right = Math.max(previous.v.x + previous.v.width, v.x + v.width);
                    this.addIssue({ x: left, y: top, width: right - left, height: bottom - top }, 'typography',
                        `文字行高不一致：设计约 ${this.amount(designLineHeight)}px，开发约 ${this.amount(devLineHeight)}px。`,
                        { kind: 'line-height', property: 'line-height', designLineHeight: designLineHeight / this.unit,
                            devLineHeight: devLineHeight / this.unit, matchConfidence: entity.matchConfidence });
                    lineHeightReported = true;
                }
            }
            const spacing = sameFlow ? { adjacent: false, changed: false } : this.describeSpacing(entity, previous);
            const inheritedX = entity.parent?.dx || 0, inheritedY = entity.parent?.dy || 0;
            const horizontal = [
                v.x - d.x - inheritedX,
                center(v).x - center(d).x - inheritedX,
                v.x + v.width - d.x - d.width - inheritedX
            ].sort((a, b) => Math.abs(a) - Math.abs(b))[0];
            const vertical = v.y - d.y - inheritedY;
            const shifts = [];
            if (Math.abs(horizontal) > this.tolerance) shifts.push(`向${horizontal > 0 ? '右' : '左'}偏移 ${this.amount(Math.abs(horizontal))}px`);
            if (!lineHeightReported && !spacing.adjacent && Math.abs(vertical) > this.tolerance) shifts.push(`向${vertical > 0 ? '下' : '上'}偏移 ${this.amount(Math.abs(vertical))}px`);
            if (shifts.length) this.addIssue(v, 'position', `文字${shifts.join('、')}。`,
                { kind: 'text-position', property: 'position', dx: horizontal / this.unit, dy: vertical / this.unit,
                    matchConfidence: entity.matchConfidence, orderChanged: !!entity.orderChanged });
        }

        repeated(box, references, isDev) {
            if (box.height < 36 * this.unit || box.width < this.dev.width * 0.35) return false;
            return references.some(ref => Math.abs(ref.width - box.width) <= this.tolerance &&
                Math.abs(ref.height - box.height) <= this.tolerance &&
                (isDev ? this.shapeDistance(ref, box) : this.shapeDistance(box, ref)) < 0.2);
        }

        matchBlocks(design, dev, parent = null, level = 'module') {
            if (!this.semanticMatcher) return this.pairBlocks(design, dev, parent, level === 'element');
            return this.semanticMatcher.match(design, dev, {
                level,
                designParent: parent?.d || null,
                devParent: parent?.v || null,
                designWidth: this.design.width,
                designHeight: this.design.height,
                devWidth: this.dev.width,
                devHeight: this.dev.height
            });
        }

        projectMissingBox(node, parent = null, pairs = this.topLevelMatches) {
            let dx = 0;
            let dy = 0;
            let confidence = 0.56;
            if (parent?.accepted) {
                dx = parent.dx || 0;
                dy = parent.dy || 0;
                confidence = Math.max(0.8, parent.matchConfidence || 0.8);
            } else if (pairs?.length) {
                const target = center(node);
                const nearest = pairs.slice().sort((a, b) => {
                    const ac = center(a.d), bc = center(b.d);
                    return Math.hypot(ac.x - target.x, ac.y - target.y) - Math.hypot(bc.x - target.x, bc.y - target.y);
                })[0];
                if (nearest) {
                    dx = nearest.v.x - nearest.d.x;
                    dy = nearest.v.y - nearest.d.y;
                    const distanceToAnchor = Math.hypot(center(nearest.d).x - target.x, center(nearest.d).y - target.y) / this.unit;
                    confidence = Math.max(0.55, (nearest.matchConfidence || 0.7) - Math.min(0.25, distanceToAnchor / 1800));
                    if (nearest.orderChanged) confidence -= 0.12;
                }
            }
            let x = node.x + dx;
            let y = node.y + dy;
            let width = node.width;
            let height = node.height;
            if (x < 0) { width += x; x = 0; }
            if (y < 0) { height += y; y = 0; }
            width = Math.min(width, this.dev.width - x);
            height = Math.min(height, this.dev.height - y);
            if (width <= 0 || height <= 0) {
                const markerHeight = Math.min(this.dev.height, Math.max(24 * this.unit, Math.min(node.height, 96 * this.unit)));
                x = Math.max(0, Math.min(this.dev.width - Math.min(node.width, this.dev.width), node.x + dx));
                y = Math.max(0, this.dev.height - markerHeight);
                width = Math.min(node.width, this.dev.width);
                height = markerHeight;
                confidence -= 0.16;
            }
            return { box: { ...node, x, y, width, height }, confidence: Math.max(0, confidence) };
        }

        handleUnmatched(node, changeType, parent = null, pairs = this.topLevelMatches) {
            const projected = changeType === 'missing'
                ? this.projectMissingBox(node, parent, pairs)
                : { box: node, confidence: 1 };
            const decision = this.annotationPolicy
                ? this.annotationPolicy.decideUnmatched({ node, changeType, mappingConfidence: projected.confidence })
                : { action: 'mark', category: 'structure', description: changeType === 'missing' ? '缺少元素。' : '多出元素。', confidence: 0.88 };
            const reason = decision.reason || 'uncertain';
            if (decision.action === 'ignore' || decision.action === 'abstain') {
                this.ignored[reason] = (this.ignored[reason] || 0) + 1;
            } else {
                const semantic = node.semantic || {};
                this.addIssue(projected.box, decision.category, decision.description, {
                    kind: changeType,
                    property: 'structure',
                    changeType,
                    nodeId: changeType === 'extra' ? semantic.id : `missing:${semantic.id || 'node'}`,
                    designNodeId: changeType === 'missing' ? semantic.id : null,
                    elementType: semantic.type,
                    role: semantic.role,
                    criticality: semantic.criticality,
                    templateKey: semantic.templateKey,
                    repeatGroupId: semantic.repeatGroupId,
                    repeatCount: semantic.repeatCount,
                    mappingConfidence: projected.confidence,
                    rootCauseId: `${changeType}:${semantic.id || `${Math.round(node.x)}:${Math.round(node.y)}`}`
                }, { confidence: decision.confidence });
            }
            if (changeType === 'extra') {
                this.entities.push({ v: node, quantity: true, ignoredReason: decision.action });
            } else {
                this.entities.push({ d: node, v: projected.box, parent, quantity: true, removedQuantity: true,
                    transform: { x: node.x, y: node.y, sx: 1, sy: 1 }, dx: projected.box.x - node.x, dy: projected.box.y - node.y,
                    ignoredReason: decision.action });
            }
            return decision;
        }

        async prepare(onProgress = () => {}) {
            const top = this.config.ignoreSystemUI ? (this.dev.width / this.unit <= 500 ? 44 : 56) * this.unit : 0;
            const designBlocks = this.blocks(this.design).filter(b => b.y + b.height > top);
            const devBlocks = this.blocks(this.dev).filter(b => b.y + b.height > top);
            // 不可分割的大图/纹理背景不强行对齐：保留原始比较，避免臆造模块。
            const eligible = blocks => blocks.filter(b => b.height <= 700 * this.unit).slice(0, 140);
            const dBlocks = eligible(designBlocks), vBlocks = eligible(devBlocks);
            for (const [image, blocks] of [[this.design, dBlocks], [this.dev, vBlocks]]) {
                for (const block of blocks) {
                    const canSegmentRow = block.height < 48 * this.unit && block.width > block.height * 2;
                    block.parts = canSegmentRow ? this.horizontalSegments(image, block) : this.children(image, block);
                    block.segmentedRow = canSegmentRow;
                    this.markNativeText(block.parts, image);
                    // 单行、无卡片底的内容直接使用字形分组信息。
                    if (block.height < 42 * this.unit && block.width > block.height * 2) {
                        const padded = { x: Math.max(0, block.x - 4 * this.unit), y: Math.max(0, block.y - 4 * this.unit),
                            width: Math.min(image.width - Math.max(0, block.x - 4 * this.unit), block.width + 8 * this.unit), height: block.height + 8 * this.unit };
                        const paddedParts = block.segmentedRow ? block.parts : this.children(image, padded);
                        const lines = paddedParts.filter(p => p.text);
                        if (lines.length === 1) {
                            const primary = lines[0];
                            const auxiliaries = paddedParts.filter(p => !p.text);
                            const auxiliaryArea = auxiliaries.reduce((sum, part) => sum + part.width * part.height, 0);
                            const lowAuxiliaryArea = auxiliaryArea <= block.width * block.height * 0.34;
                            block.textLike = lowAuxiliaryArea && primary.width >= block.width * 0.42;
                            if (block.textLike && auxiliaries.length === 0) block.text = true;
                            if (block.textLike) {
                                block.glyphHeight = primary.glyphHeight; block.glyphs = primary.glyphs;
                                block.glyphBoxes = primary.glyphBoxes; block.primaryText = primary; block.parts = paddedParts;
                            }
                        } else if (!lines.length && paddedParts.length >= 3) {
                            const ordered = paddedParts.slice().sort((a, b) => a.x - b.x);
                            const medianWidth = median(ordered.map(part => part.width));
                            const largestGap = Math.max(0, ...ordered.slice(1).map((part, index) => part.x - ordered[index].x - ordered[index].width));
                            const glyphLike = medianWidth <= block.height * 1.5 && largestGap <= block.height * 0.45;
                            if (glyphLike) {
                                block.text = true; block.textLike = true; block.glyphs = paddedParts.length;
                                block.glyphHeight = median(paddedParts.map(part => part.height));
                                block.glyphBoxes = paddedParts; block.parts = paddedParts;
                            }
                        }
                    }
                    this.markNativeText([block], image);
                }
            }
            if (this.semanticParser) {
                this.semanticPages = {
                    design: this.semanticParser.parsePage('design', dBlocks),
                    dev: this.semanticParser.parsePage('dev', vBlocks)
                };
            }
            const matched = this.matchBlocks(dBlocks, vBlocks, null, 'module');
            this.topLevelMatches = matched.pairs;
            let previous = null;
            for (let index = 0; index < matched.pairs.length; index++) {
                this.ensureActive();
                const pair = matched.pairs[index];
                if (this.dynamicImage(pair, null)) {
                    this.entities.push({ ...pair, quantity: true }); this.ignored.dynamic++;
                    previous = null;
                    continue;
                }
                let entity = this.verify(pair, null);
                if (this.variableText(pair, null)) {
                    entity = this.createVariableTextEntity(pair, null);
                    this.describeVariableText(entity, previous);
                    this.ignored.content++;
                } else if (this.config.ignoreContent && pair.d.textLike && pair.v.textLike) {
                    // 头像+文字等单行字段作为容器配对，内部仍逐元素检查，不因文案宽度改变报模块增删。
                    entity = { ...entity, accepted: true, transform: { x: pair.d.x, y: pair.d.y, sx: 1, sy: 1 },
                        dx: pair.v.x - pair.d.x, dy: pair.v.y - pair.d.y, inheritedX: 0, inheritedY: 0, textContainer: true };
                } else this.describeGeometry(entity, previous);
                if (entity.accepted) {
                    this.entities.push(entity);
                    this.styleEvaluator?.evaluate(entity);
                }
                const childPairs = !pair.d.text && !pair.v.text && !entity.sizeChanged
                    ? this.matchBlocks(pair.d.parts, pair.v.parts, entity.accepted ? entity : null, 'element') : { pairs: [], extra: [], missing: [] };
                childPairs.pairs.sort((a, b) => a.d.y - b.d.y || a.d.x - b.d.x);
                let previousText = null;
                for (const child of childPairs.pairs) {
                    const parent = entity.accepted ? entity : null;
                    if (this.dynamicImage(child, parent)) {
                        this.entities.push({ ...child, quantity: true }); this.ignored.dynamic++;
                        continue;
                    }
                    if (this.variableText(child, parent)) {
                        const textEntity = this.createVariableTextEntity(child, parent);
                        this.describeVariableText(textEntity, previousText);
                        this.entities.push(textEntity);
                        this.styleEvaluator?.evaluate(textEntity);
                        previousText = textEntity;
                        this.ignored.content++;
                    } else {
                        const inner = this.verify(child, parent);
                        this.describeGeometry(inner, null);
                        if (inner.accepted) {
                            this.entities.push(inner);
                            this.styleEvaluator?.evaluate(inner);
                        }
                        previousText = null;
                    }
                }
                if (entity.accepted && !entity.textMask && !entity.sizeChanged && !entity.clipped) {
                    for (const v of childPairs.extra || []) this.handleUnmatched(v, 'extra', entity, childPairs.pairs);
                    for (const d of childPairs.missing || []) this.handleUnmatched(d, 'missing', entity, childPairs.pairs);
                }
                previous = entity;
                if (index % 3 === 0) { onProgress(26 + Math.round(index / Math.max(1, matched.pairs.length) * 28)); await new Promise(resolve => setTimeout(resolve, 0)); }
            }
            matched.extra.forEach(v => this.handleUnmatched(v, 'extra', null, matched.pairs));
            matched.missing.forEach(d => this.handleUnmatched(d, 'missing', null, matched.pairs));
            this.indexEntities();
            return this;
        }

        indexEntities() {
            this.devRows = Array.from({ length: this.dev.height }, () => []);
            this.ghostRows = Array.from({ length: this.dev.height }, () => []);
            for (const entity of this.entities) {
                if (entity.v) for (let y = Math.max(0, Math.floor(entity.v.y)); y < Math.min(this.dev.height, entity.v.y + entity.v.height); y++) this.devRows[y].push(entity);
                if (!entity.d) continue;
                const parent = entity.parent;
                entity.ghost = { x: entity.d.x + (parent?.dx || 0), y: entity.d.y + (parent?.dy || 0), width: entity.d.width, height: entity.d.height };
                for (let y = Math.max(0, Math.floor(entity.ghost.y)); y < Math.min(this.dev.height, entity.ghost.y + entity.ghost.height); y++) this.ghostRows[y].push(entity);
            }
        }

        insideClippedEntity(annotation) {
            const box = { x: annotation.baseX * this.unit, y: annotation.baseY * this.unit,
                width: annotation.baseWidth * this.unit, height: annotation.baseHeight * this.unit };
            return this.entities.some(entity => {
                if (!entity.clipped || !entity.v) return false;
                const overlap = Math.max(0, Math.min(box.x + box.width, entity.v.x + entity.v.width) - Math.max(box.x, entity.v.x)) *
                    Math.max(0, Math.min(box.y + box.height, entity.v.y + entity.v.height) - Math.max(box.y, entity.v.y));
                return overlap / Math.max(1, box.width * box.height) >= 0.35;
            });
        }

        referenceAt(x, y) {
            const row = this.devRows[Math.floor(y)] || [];
            const ghosts = this.ghostRows[Math.floor(y)] || [];
            let entity = null;
            for (let i = row.length - 1; i >= 0; i--) if (inside(row[i].v, x, y)) { entity = row[i]; break; }
            // 子元素移位后的旧位置需与容器底色比较，不能留下原位置的重影。
            for (let i = ghosts.length - 1; i >= 0; i--) {
                const ghost = ghosts[i];
                if (!inside(ghost.ghost, x, y) || ghost === entity) continue;
                if (entity && entity !== ghost.parent) continue;
                return { color: ghost.d.background || [255, 255, 255], ghost };
            }
            if (!entity) return { x, y, color: this.pixel(this.design, x, y) };
            if (entity.quantity) return { skip: true };
            if (entity.textMask) return this.textReference(entity, x, y);
            const px = entity.transform.x + (x - entity.v.x) / entity.transform.sx;
            const py = entity.transform.y + (y - entity.v.y) / entity.transform.sy;
            return { x: px, y: py, color: this.pixel(this.design, px, py), entity };
        }

        textReference(entity, x, y) {
            // 内容像素始终屏蔽；颜色、大小、行高和位置已由文字样式层独立生成证据。
            return { skip: true };
        }

        differenceAt(x, y) {
            const reference = this.referenceAt(x, y);
            if (reference.skip) return 0;
            const devColor = this.pixel(this.dev, x, y);
            const direct = distance(devColor, reference.color);
            if (direct <= this.sensitivity.colorThreshold || reference.x == null) return direct;
            if (this.config.longScreenshotMode && this.config.ignoreRenderNoise) {
                // 长截图常见“JPEG 设计图 vs PNG 拼接图”。对局部做小范围均值比较，
                // 消除压缩振铃和重采样产生的碎边；真实的填充色、字号和结构变化仍会保留。
                const radius = Math.max(1, Math.round(this.unit));
                const mean = (image, px, py) => {
                    const result = [0, 0, 0];
                    let count = 0;
                    for (const oy of [-radius, 0, radius]) for (const ox of [-radius, 0, radius]) {
                        const color = this.pixel(image, px + ox, py + oy);
                        for (let channel = 0; channel < 3; channel++) result[channel] += color[channel];
                        count++;
                    }
                    return result.map(value => value / count);
                };
                if (distance(mean(this.design, reference.x, reference.y), mean(this.dev, x, y)) <=
                    this.sensitivity.colorThreshold * 0.55) return 0;
            }
            if (reference.entity?.sizeChanged && this.config.ignoreRenderNoise) {
                const localEdge = (image, px, py) => distance(this.pixel(image, px - 1, py), this.pixel(image, px + 1, py)) +
                    distance(this.pixel(image, px, py - 1), this.pixel(image, px, py + 1));
                // 已验证的缩放边界只消除重采样噪声；平坦内部仍复检颜色，不整块屏蔽。
                if (localEdge(this.design, reference.x, reference.y) > 20 || localEdge(this.dev, x, y) > 20) return 0;
            }
            // 双向邻域容差：两边都能在邻域找到对应像素才算渲染/微小位置差异。
            // 不用单向膨胀掩掉开发图新增的细线或字符。
            let forward = direct, backward = direct;
            for (const offset of this.neighborhood) {
                forward = Math.min(forward, distance(devColor, this.pixel(this.design, reference.x + offset.x, reference.y + offset.y)));
                backward = Math.min(backward, distance(reference.color, this.pixel(this.dev, x + offset.x, y + offset.y)));
            }
            return Math.max(forward, backward);
        }

        semanticContextForRegion(region) {
            const regionArea = Math.max(1, region.width * region.height);
            let best = null;
            for (const entity of this.entities) {
                if (!entity.v?.semantic || entity.quantity || !entity.accepted) continue;
                const box = entity.v;
                const intersection = Math.max(0, Math.min(region.x + region.width, box.x + box.width) - Math.max(region.x, box.x)) *
                    Math.max(0, Math.min(region.y + region.height, box.y + box.height) - Math.max(region.y, box.y));
                if (!intersection) continue;
                const entityArea = Math.max(1, box.width * box.height);
                const score = intersection / regionArea * 0.68 + intersection / entityArea * 0.22 +
                    Math.min(0.1, (box.semantic.depth || 0) * 0.04);
                if (!best || score > best.score) best = { entity, score };
            }
            if (!best || best.score < 0.34 || (best.entity.matchConfidence || 0.7) < 0.48) return null;
            const semantic = best.entity.v.semantic;
            return {
                box: best.entity.v,
                evidence: {
                    nodeId: semantic.id,
                    parentNodeId: semantic.parentId,
                    elementType: semantic.type,
                    role: semantic.role,
                    criticality: semantic.criticality,
                    templateKey: semantic.templateKey,
                    repeatGroupId: semantic.repeatGroupId,
                    repeatCount: semantic.repeatCount,
                    matchConfidence: best.entity.matchConfidence,
                    orderChanged: !!best.entity.orderChanged,
                    rootCauseId: `${semantic.id}:pixel-color`
                }
            };
        }

        classify(region) {
            // 在配准后的坐标中检查几何边缘是否相似；颜色/透明度不从几何误差猜测。
            let supported = 0, samples = 0;
            const step = Math.max(1, Math.floor(Math.min(region.width, region.height) / 12));
            for (let y = region.y; y < region.y + region.height; y += step) for (let x = region.x; x < region.x + region.width; x += step) {
                const r = this.referenceAt(x, y);
                if (r.skip || r.x == null) continue;
                if (r.entity?.sizeChanged) { supported++; samples++; continue; }
                const edge = (image, px, py) => distance(this.pixel(image, px - 1, py), this.pixel(image, px + 1, py)) +
                    distance(this.pixel(image, px, py - 1), this.pixel(image, px, py + 1));
                const a = edge(this.design, r.x, r.y), b = edge(this.dev, x, y);
                if ((a < 12 && b < 12) || (a > 20 && b > 20)) supported++;
                samples++;
            }
            if (samples && supported / samples > 0.88) return { category: 'color', description: '元素颜色或透明度不一致。' };
            return { category: 'unconfirmed', description: '局部外观不一致，具体原因待确认。' };
        }
    }
    window.LocalVisualRegistration = LocalVisualRegistration;
})();
