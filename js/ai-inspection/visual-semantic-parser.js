/**
 * v23 视觉语义解析器。
 * 将像素分割结果提升为带类型、角色、层级、重复组与可比较样式的视觉节点。
 * 解析器只产生证据，不直接生成标注。
 */
(function (global) {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const median = values => {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };
    const colorDistance = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    const ACTION_TEXT = /(提交|确认|保存|支付|付款|登录|登陆|注册|下一步|立即|购买|开通|完成|继续|领取|发送|确定|submit|confirm|save|pay|login|register|next|continue|done)/i;

    class VisualSemanticParser {
        constructor({ design, dev, unit, tolerance, pixel, background, photoLike, nativeText = null }) {
            this.images = { design, dev };
            this.unit = Math.max(0.01, unit || 1);
            this.tolerance = Math.max(this.unit * 0.5, tolerance || this.unit * 2);
            this.pixel = pixel;
            this.background = background;
            this.photoLike = photoLike;
            this.nativeText = nativeText;
            this.nextNodeId = 1;
            this.nextRepeatId = 1;
        }

        parsePage(side, blocks) {
            const image = this.images[side];
            const edgeWidth = Math.max(2, Math.round(image.width * 0.025));
            const pageBackground = this.background(image, { x: 0, y: 0, width: edgeWidth, height: image.height });
            const page = {
                side,
                width: image.width,
                height: image.height,
                background: pageBackground,
                nodes: [],
                allNodes: [],
                repeatGroups: new Map()
            };
            page.nodes = blocks.map((box, index) => this.enrichNode(page, box, null, index, 0));
            this.assignRoles(page);
            this.inferRepeatGroups(page.nodes, page);
            return page;
        }

        enrichNode(page, box, parent, index, depth) {
            const image = this.images[page.side];
            const nodeId = `${page.side}-${this.nextNodeId++}`;
            // 先登记父节点编号，再递归子节点，保证复合组件关系不会因构建顺序丢失。
            box.semantic = { id: nodeId, parentId: parent?.semantic?.id || null };
            const children = (box.parts || []).map((part, childIndex) =>
                this.enrichNode(page, part, box, childIndex, depth + 1));
            box.parts = children;
            const text = this.textForBox(page.side, box);
            if (text && !box.ocrText) box.ocrText = text;
            const style = this.measureStyle(image, box, page.background);
            const typeResult = this.classify(box, style, page, depth);
            const childHistogram = this.childHistogram(children);
            const aspect = box.width / Math.max(1, box.height);
            const templateKey = [
                typeResult.type,
                this.aspectBucket(aspect),
                Object.keys(childHistogram).sort().map(key => `${key}:${Math.min(4, childHistogram[key])}`).join(',') || 'leaf'
            ].join('|');
            const semantic = {
                id: nodeId,
                side: page.side,
                index,
                depth,
                parentId: parent?.semantic?.id || null,
                type: typeResult.type,
                typeConfidence: typeResult.confidence,
                role: 'ordinary',
                roleConfidence: 0.6,
                criticality: 'ordinary',
                templateKey,
                repeatGroupId: null,
                repeatCount: 1,
                childHistogram,
                text: box.ocrText || '',
                style
            };
            box.semantic = semantic;
            box.nodeId = semantic.id;
            box.semanticType = semantic.type;
            box.templateKey = templateKey;
            page.allNodes.push(box);
            return box;
        }

        textForBox(side, box) {
            const items = this.nativeText?.[side] || [];
            const matches = [];
            for (const item of items) {
                const b = item.boundingBox;
                if (!b) continue;
                const intersection = Math.max(0, Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x)) *
                    Math.max(0, Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y));
                const itemCoverage = intersection / Math.max(1, b.width * b.height);
                const boxCoverage = intersection / Math.max(1, box.width * box.height);
                if (itemCoverage < 0.45 && boxCoverage < 0.2) continue;
                const value = item.rawValue || item.text || item.value || '';
                if (value) matches.push({ value: String(value), x: b.x, y: b.y });
            }
            return matches.sort((a, b) => a.y - b.y || a.x - b.x).map(item => item.value).join(' ').trim();
        }

        measureStyle(image, box, pageBackground) {
            const sampleSize = 12;
            const colors = [];
            const bins = new Map();
            let edges = 0;
            let foreground = 0;
            const localBackground = box.background || pageBackground;
            for (let row = 0; row < sampleSize; row += 1) {
                for (let column = 0; column < sampleSize; column += 1) {
                    const x = box.x + (column + 0.5) * box.width / sampleSize;
                    const y = box.y + (row + 0.5) * box.height / sampleSize;
                    const color = this.pixel(image, x, y);
                    colors.push(color);
                    const key = color.map(value => Math.round(value / 12)).join(',');
                    const bin = bins.get(key) || { count: 0, sum: [0, 0, 0] };
                    bin.count += 1;
                    for (let channel = 0; channel < 3; channel += 1) bin.sum[channel] += color[channel];
                    bins.set(key, bin);
                    if (colorDistance(color, localBackground) > 18) foreground += 1;
                    const right = this.pixel(image, x + Math.max(1, box.width / sampleSize), y);
                    const bottom = this.pixel(image, x, y + Math.max(1, box.height / sampleSize));
                    if (colorDistance(color, right) > 24 || colorDistance(color, bottom) > 24) edges += 1;
                }
            }
            const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
            const fillColor = dominant ? dominant.sum.map(value => value / dominant.count) : localBackground.slice();
            const mean = [0, 1, 2].map(channel => colors.reduce((sum, color) => sum + color[channel], 0) / Math.max(1, colors.length));
            const variance = colors.reduce((sum, color) => sum + colorDistance(color, mean) ** 2, 0) / Math.max(1, colors.length);
            const border = this.estimateBorder(image, box, fillColor);
            const corners = this.cornerProfiles(image, box, pageBackground, fillColor);
            const shadow = this.shadowProfile(image, box, pageBackground);
            const saturation = Math.max(...fillColor) - Math.min(...fillColor);
            return {
                fillColor,
                meanColor: mean,
                colorStd: Math.sqrt(variance),
                fillContrast: colorDistance(fillColor, pageBackground),
                foregroundCoverage: foreground / (sampleSize * sampleSize),
                edgeDensity: edges / (sampleSize * sampleSize),
                saturation,
                border,
                corners,
                shadow,
                lineThickness: Math.min(box.width, box.height) / this.unit,
                glyphHeight: (box.glyphHeight || 0) / this.unit
            };
        }

        estimateBorder(image, box, fillColor) {
            const maxDepth = Math.max(1, Math.min(8, Math.round(Math.min(box.width, box.height) / this.unit / 3)));
            const positions = [0.3, 0.42, 0.58, 0.7];
            const scan = (side, ratio) => {
                let run = 0;
                for (let depth = 0; depth < maxDepth; depth += 1) {
                    let x;
                    let y;
                    if (side === 'top' || side === 'bottom') {
                        x = box.x + box.width * ratio;
                        y = side === 'top' ? box.y + depth * this.unit : box.y + box.height - 1 - depth * this.unit;
                    } else {
                        x = side === 'left' ? box.x + depth * this.unit : box.x + box.width - 1 - depth * this.unit;
                        y = box.y + box.height * ratio;
                    }
                    if (colorDistance(this.pixel(image, x, y), fillColor) <= 13) break;
                    run += 1;
                }
                return run;
            };
            const result = {};
            for (const side of ['top', 'right', 'bottom', 'left']) {
                result[side] = median(positions.map(position => scan(side, position)));
            }
            result.median = median([result.top, result.right, result.bottom, result.left]);
            return result;
        }

        cornerProfiles(image, box, pageBackground, fillColor) {
            const grid = 6;
            const extent = Math.max(this.unit * 3, Math.min(box.width, box.height, this.unit * 18) * 0.45);
            const contrast = Math.max(10, colorDistance(fillColor, pageBackground) * 0.3);
            const profiles = [];
            for (let corner = 0; corner < 4; corner += 1) {
                const values = [];
                for (let row = 0; row < grid; row += 1) for (let column = 0; column < grid; column += 1) {
                    const localX = (column + 0.5) * extent / grid;
                    const localY = (row + 0.5) * extent / grid;
                    const x = corner === 0 || corner === 3 ? box.x + localX : box.x + box.width - localX;
                    const y = corner < 2 ? box.y + localY : box.y + box.height - localY;
                    const color = this.pixel(image, x, y);
                    values.push(colorDistance(color, pageBackground) > contrast ? 1 : 0);
                }
                profiles.push(values);
            }
            return { profiles, extent: extent / this.unit, confidence: clamp(colorDistance(fillColor, pageBackground) / 42, 0, 1) };
        }

        shadowProfile(image, box, pageBackground) {
            const offsets = [1, 2, 4, 7].map(value => value * this.unit);
            const values = [];
            for (const offset of offsets) {
                const points = [
                    [box.x + box.width * 0.5, box.y - offset],
                    [box.x + box.width + offset, box.y + box.height * 0.5],
                    [box.x + box.width * 0.5, box.y + box.height + offset],
                    [box.x - offset, box.y + box.height * 0.5]
                ];
                values.push(...points.map(point => colorDistance(this.pixel(image, point[0], point[1]), pageBackground)));
            }
            return values;
        }

        classify(box, style, page, depth) {
            const width = box.width / this.unit;
            const height = box.height / this.unit;
            const minor = Math.min(width, height);
            const major = Math.max(width, height);
            const aspect = width / Math.max(1, height);
            const children = box.parts || [];
            const hasText = !!(box.text || box.textLike || box.ocrText || children.some(child => child.text || child.textLike || child.ocrText));
            if (box.text || box.textLike) return { type: 'text', confidence: 0.96 };
            if (minor <= Math.max(6, 3.5 + this.tolerance / this.unit) && major >= 18 && major / Math.max(1, minor) >= 6) {
                return { type: 'divider', confidence: 0.94 };
            }
            if (this.photoLike(imageFor(page, this.images), box)) return { type: 'image', confidence: 0.9 };
            const filledControl = style.fillContrast >= 18 && style.foregroundCoverage >= 0.55 &&
                style.colorStd < 62 && style.saturation >= 12;
            if (height >= 24 && height <= 72 && aspect >= 1.35 && aspect <= 12 &&
                (hasText || filledControl) && (style.fillContrast >= 9 || style.border.median > 0)) {
                return { type: 'button', confidence: hasText ? 0.84 : 0.78 };
            }
            const hasDivider = children.some(child => child.semanticType === 'divider' || Math.min(child.width, child.height) <= 3.5 * this.unit);
            if (width >= page.width / this.unit * 0.48 && height >= 28 && height <= 104 && hasText &&
                (hasDivider || style.fillContrast < 26)) return { type: 'input', confidence: 0.76 };
            if (width >= page.width / this.unit * 0.42 && height >= 56 && children.length >= 2) return { type: 'card', confidence: 0.74 };
            if (minor >= 8 && major <= 58 && aspect >= 0.45 && aspect <= 2.2 && depth > 0) return { type: 'icon', confidence: 0.76 };
            if (style.colorStd >= 34 && width >= 32 && height >= 32) return { type: 'image', confidence: 0.72 };
            if (children.length >= 2) return { type: 'component', confidence: 0.68 };
            return { type: 'element', confidence: 0.58 };
        }

        childHistogram(children) {
            return children.reduce((result, child) => {
                const type = child.semantic?.type || child.semanticType || 'element';
                result[type] = (result[type] || 0) + 1;
                return result;
            }, {});
        }

        aspectBucket(aspect) {
            if (aspect < 0.65) return 'portrait';
            if (aspect < 1.5) return 'square';
            if (aspect < 4) return 'wide';
            return 'strip';
        }

        assignRoles(page) {
            const buttons = [];
            for (const node of page.allNodes) {
                const semantic = node.semantic;
                const text = semantic.text || '';
                if (semantic.type === 'text') {
                    semantic.role = 'text';
                    semantic.roleConfidence = 0.9;
                } else if (semantic.type === 'input') {
                    semantic.role = 'field';
                    semantic.roleConfidence = 0.82;
                } else if (semantic.type === 'button') {
                    const areaRatio = node.width * node.height / Math.max(1, page.width * page.height);
                    const widthRatio = node.width / page.width;
                    const prominence = widthRatio * 0.5 + clamp(semantic.style.saturation / 90, 0, 1) * 0.25 +
                        clamp(semantic.style.fillContrast / 70, 0, 1) * 0.2 + clamp(areaRatio * 20, 0, 1) * 0.05;
                    semantic.role = 'action';
                    semantic.roleConfidence = 0.78;
                    semantic.actionText = ACTION_TEXT.test(text);
                    semantic.prominence = prominence;
                    buttons.push(node);
                } else if (semantic.type === 'icon') {
                    semantic.role = 'icon';
                    semantic.roleConfidence = 0.76;
                } else if (semantic.type === 'image') {
                    semantic.role = 'media';
                    semantic.roleConfidence = 0.8;
                } else if (semantic.type === 'card') {
                    semantic.role = 'container';
                    semantic.roleConfidence = 0.72;
                }
            }
            const byId = new Map(page.allNodes.map(node => [node.semantic.id, node]));
            const ranked = buttons.filter(node => {
                const parent = byId.get(node.semantic.parentId);
                if (!parent || parent.semantic.type !== 'button') return true;
                const overlap = Math.max(0, Math.min(node.x + node.width, parent.x + parent.width) - Math.max(node.x, parent.x)) *
                    Math.max(0, Math.min(node.y + node.height, parent.y + parent.height) - Math.max(node.y, parent.y));
                return overlap / Math.max(1, node.width * node.height) < 0.85;
            }).sort((a, b) => b.semantic.prominence - a.semantic.prominence);
            for (const button of ranked) {
                const semantic = button.semantic;
                const uniqueVisualPrimary = ranked.length === 1 && semantic.prominence >= 0.28 && button.width >= page.width * 0.28;
                const clearlyDominant = semantic.prominence >= 0.38 &&
                    (!ranked[1] || semantic.prominence >= ranked[1].semantic.prominence * 1.35);
                if (semantic.actionText || uniqueVisualPrimary || clearlyDominant) {
                    semantic.role = 'primary-action';
                    semantic.roleConfidence = semantic.actionText ? 0.96 : 0.82;
                    semantic.criticality = 'critical';
                    break;
                }
            }
            for (const node of page.allNodes.slice().reverse()) {
                if (node.semantic.criticality !== 'critical' || !node.semantic.parentId) continue;
                let parent = byId.get(node.semantic.parentId);
                while (parent) {
                    if (parent.semantic.type === 'card' || parent.semantic.type === 'component') {
                        parent.semantic.criticality = 'critical';
                        parent.semantic.role = 'critical-scene';
                        parent.semantic.roleConfidence = Math.min(0.9, node.semantic.roleConfidence);
                    }
                    parent = parent.semantic.parentId ? byId.get(parent.semantic.parentId) : null;
                }
            }
        }

        inferRepeatGroups(nodes, page) {
            const groups = new Map();
            for (const node of nodes) {
                const key = node.semantic.templateKey;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(node);
            }
            for (const [key, members] of groups) {
                if (members.length < 2) continue;
                const sizes = members.map(node => ({ width: node.width / this.unit, height: node.height / this.unit }));
                const widthMedian = median(sizes.map(size => size.width));
                const heightMedian = median(sizes.map(size => size.height));
                const consistent = members.filter((node, index) =>
                    Math.abs(sizes[index].width - widthMedian) <= Math.max(8, widthMedian * 0.22) &&
                    Math.abs(sizes[index].height - heightMedian) <= Math.max(8, heightMedian * 0.28));
                if (consistent.length < 2) continue;
                const groupId = `${page.side}-repeat-${this.nextRepeatId++}`;
                page.repeatGroups.set(groupId, { id: groupId, key, members: consistent });
                for (const node of consistent) {
                    node.semantic.repeatGroupId = groupId;
                    node.semantic.repeatCount = consistent.length;
                }
            }
            for (const node of nodes) {
                if (node.parts?.length) this.inferRepeatGroups(node.parts, page);
            }
        }
    }

    function imageFor(page, images) {
        return images[page.side];
    }

    global.VisualSemanticParser = VisualSemanticParser;
})(typeof window !== 'undefined' ? window : globalThis);
