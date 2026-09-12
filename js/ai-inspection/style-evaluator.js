/**
 * v23 元素级样式评估器。
 * 只在已完成语义匹配的节点之间比较可由截图验证的样式证据。
 */
(function (global) {
    'use strict';

    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const colorDistance = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    const CORNER_NAMES = ['左上', '右上', '右下', '左下'];
    const STYLE_CONTAINERS = new Set(['card', 'component', 'button', 'input']);

    class ElementStyleEvaluator {
        constructor({ unit = 1, tolerance = 2, sensitivity, config = {}, emit }) {
            this.unit = Math.max(0.01, unit);
            this.tolerance = Math.max(this.unit * 0.5, tolerance);
            this.sensitivity = sensitivity || { colorThreshold: 26 };
            this.config = config;
            this.emit = emit;
        }

        evaluate(entity) {
            if (!entity?.accepted || !entity.d?.semantic || !entity.v?.semantic) return;
            const type = entity.d.semantic.type;
            if (type === 'divider') this.compareDivider(entity);
            if (STYLE_CONTAINERS.has(type)) {
                this.compareFill(entity);
                this.compareBorder(entity);
                this.compareCorners(entity);
                this.compareShadow(entity);
                this.compareContainerBottomGap(entity);
            }
            if (type === 'text') this.compareBoundaryPressure(entity);
        }

        compareDivider(entity) {
            const design = Math.min(entity.d.width, entity.d.height) / this.unit;
            const dev = Math.min(entity.v.width, entity.v.height) / this.unit;
            const threshold = Math.max(0.6, this.tolerance / this.unit * 0.5);
            if (Math.abs(dev - design) <= threshold) return;
            this.emit(entity.v, 'border', `分割线${dev > design ? '偏粗' : '偏细'}（设计约 ${this.amount(design)}px，开发约 ${this.amount(dev)}px）。`,
                this.evidence(entity, 'divider-thickness', {
                    designThickness: design,
                    devThickness: dev,
                    direction: dev > design ? 'larger' : 'smaller'
                }), { confidence: 0.94, pad: this.unit });
        }

        compareFill(entity) {
            const design = entity.d.semantic.style;
            const dev = entity.v.semantic.style;
            if (design.colorStd > 24 || dev.colorStd > 24) return;
            const delta = colorDistance(design.fillColor, dev.fillColor);
            if (delta <= this.sensitivity.colorThreshold) return;
            this.emit(entity.v, 'color', '元素填充颜色或透明度不一致。',
                this.evidence(entity, 'fill-color', { colorDelta: delta }), { confidence: 0.91 });
        }

        compareBorder(entity) {
            const design = entity.d.semantic.style;
            const dev = entity.v.semantic.style;
            const designWidth = design.border.median;
            const devWidth = dev.border.median;
            if (!designWidth && !devWidth) return;
            if (design.colorStd > 42 || dev.colorStd > 42) return;
            const threshold = Math.max(0.75, this.tolerance / this.unit * 0.45);
            if (Math.abs(devWidth - designWidth) <= threshold) return;
            const side = ['top', 'right', 'bottom', 'left'].sort((a, b) =>
                Math.abs(dev.border[b] - design.border[b]) - Math.abs(dev.border[a] - design.border[a]))[0];
            const box = this.edgeBox(entity.v, side, Math.max(this.unit, devWidth * this.unit));
            this.emit(box, 'border', `边框${devWidth > designWidth ? '偏粗' : '偏细'}（设计约 ${this.amount(designWidth)}px，开发约 ${this.amount(devWidth)}px）。`,
                this.evidence(entity, 'border-thickness', {
                    side,
                    designThickness: designWidth,
                    devThickness: devWidth,
                    direction: devWidth > designWidth ? 'larger' : 'smaller'
                }), { confidence: 0.86, pad: this.unit });
        }

        compareCorners(entity) {
            const design = entity.d.semantic.style.corners;
            const dev = entity.v.semantic.style.corners;
            if (Math.min(design.confidence, dev.confidence) < 0.38) return;
            const distances = design.profiles.map((profile, index) =>
                mean(profile.map((value, cell) => Math.abs(value - dev.profiles[index][cell]))));
            const index = distances.indexOf(Math.max(...distances));
            if (index < 0 || distances[index] < 0.22) return;
            const designFill = mean(design.profiles[index]);
            const devFill = mean(dev.profiles[index]);
            const direction = devFill > designFill ? 'smaller' : 'larger';
            const size = Math.min(entity.v.width, entity.v.height,
                Math.max(8 * this.unit, Math.max(design.extent, dev.extent) * this.unit));
            const box = this.cornerBox(entity.v, index, size);
            this.emit(box, 'radius', `${CORNER_NAMES[index]}圆角${direction === 'smaller' ? '偏小' : '偏大'}。`,
                this.evidence(entity, 'corner-radius', {
                    corner: index,
                    direction,
                    profileDelta: distances[index]
                }), { confidence: Math.min(0.94, 0.76 + distances[index] * 0.5), pad: this.unit });
        }

        compareShadow(entity) {
            if (!['card', 'button', 'component'].includes(entity.d.semantic.type)) return;
            const design = entity.d.semantic.style.shadow;
            const dev = entity.v.semantic.style.shadow;
            const delta = mean(design.map((value, index) => Math.abs(value - dev[index])));
            const strength = Math.max(mean(design), mean(dev));
            if (strength < 6 || delta < Math.max(7, this.sensitivity.colorThreshold * 0.33)) return;
            const designStrength = mean(design);
            const devStrength = mean(dev);
            const description = designStrength > devStrength * 1.7 ? '元素阴影缺失或过轻。' :
                (devStrength > designStrength * 1.7 ? '元素阴影过重。' : '元素阴影范围或方向不一致。');
            this.emit(entity.v, 'shadow', description,
                this.evidence(entity, 'shadow-profile', {
                    designStrength,
                    devStrength,
                    profileDelta: delta
                }), { confidence: 0.83 });
        }

        compareContainerBottomGap(entity) {
            const designChildren = this.meaningfulChildren(entity.d);
            const devChildren = this.meaningfulChildren(entity.v);
            if (!designChildren.length || !devChildren.length) return;
            const designLast = designChildren.reduce((last, child) => child.y + child.height > last.y + last.height ? child : last);
            const devLast = devChildren.reduce((last, child) => child.y + child.height > last.y + last.height ? child : last);
            const designGap = entity.d.y + entity.d.height - designLast.y - designLast.height;
            const devGap = entity.v.y + entity.v.height - devLast.y - devLast.height;
            const delta = devGap - designGap;
            if (Math.abs(delta) <= Math.max(this.tolerance, 2 * this.unit)) return;
            if (Math.max(designGap, devGap) < 3 * this.unit) return;
            const actualGap = Math.max(this.unit, devGap);
            const box = {
                x: entity.v.x,
                y: Math.min(entity.v.y + entity.v.height - this.unit, devLast.y + devLast.height),
                width: entity.v.width,
                height: actualGap
            };
            this.emit(box, 'spacing', `元素底部间距${delta > 0 ? '偏大' : '偏小'} ${this.amount(Math.abs(delta) / this.unit)}px（设计约 ${this.amount(designGap / this.unit)}px，开发约 ${this.amount(devGap / this.unit)}px）。`,
                this.evidence(entity, 'bottom-gap', {
                    designGap: designGap / this.unit,
                    devGap: devGap / this.unit,
                    direction: delta > 0 ? 'larger' : 'smaller',
                    markedRegion: 'development-gap'
                }), { confidence: 0.9, pad: 0 });
        }

        compareBoundaryPressure(entity) {
            if (!entity.parent?.d || !entity.parent?.v || !this.config.ignoreContent) return;
            const designRight = entity.parent.d.x + entity.parent.d.width - entity.d.x - entity.d.width;
            const devRight = entity.parent.v.x + entity.parent.v.width - entity.v.x - entity.v.width;
            const designBottom = entity.parent.d.y + entity.parent.d.height - entity.d.y - entity.d.height;
            const devBottom = entity.parent.v.y + entity.parent.v.height - entity.v.y - entity.v.height;
            const horizontalPressure = designRight >= 4 * this.unit && devRight <= this.unit && entity.v.width > entity.d.width * 1.12;
            const verticalPressure = designBottom >= 3 * this.unit && devBottom <= this.unit && entity.v.height > entity.d.height + this.tolerance;
            if (!horizontalPressure && !verticalPressure) return;
            this.emit(entity.v, 'layout', '内容变化造成元素挤压、溢出或裁切。',
                this.evidence(entity, 'content-overflow', {
                    horizontalPressure,
                    verticalPressure,
                    contentIgnored: true
                }), { confidence: 0.88 });
        }

        meaningfulChildren(node) {
            const minimumArea = 3 * this.unit * this.unit;
            return (node.parts || []).filter(child => child.width * child.height >= minimumArea &&
                child.semantic?.type !== 'divider');
        }

        evidence(entity, property, extra = {}) {
            const design = entity.d.semantic || {};
            const dev = entity.v.semantic || {};
            const repeatGroupId = design.repeatGroupId || dev.repeatGroupId || null;
            return {
                kind: property,
                property,
                nodeId: dev.id,
                designNodeId: design.id,
                elementType: dev.type || design.type,
                role: design.role || dev.role,
                criticality: design.criticality || 'ordinary',
                templateKey: design.templateKey || dev.templateKey,
                repeatGroupId,
                repeatCount: Math.max(design.repeatCount || 1, dev.repeatCount || 1),
                rootCauseId: `${dev.id || design.id}:${property}`,
                matchConfidence: entity.matchConfidence,
                orderChanged: !!entity.orderChanged,
                ...extra
            };
        }

        edgeBox(box, side, thickness) {
            if (side === 'top') return { x: box.x, y: box.y, width: box.width, height: thickness };
            if (side === 'right') return { x: box.x + box.width - thickness, y: box.y, width: thickness, height: box.height };
            if (side === 'bottom') return { x: box.x, y: box.y + box.height - thickness, width: box.width, height: thickness };
            return { x: box.x, y: box.y, width: thickness, height: box.height };
        }

        cornerBox(box, corner, size) {
            return {
                x: corner === 0 || corner === 3 ? box.x : box.x + box.width - size,
                y: corner < 2 ? box.y : box.y + box.height - size,
                width: size,
                height: size
            };
        }

        amount(value) {
            return Number(Number(value).toFixed(1));
        }
    }

    global.ElementStyleEvaluator = ElementStyleEvaluator;
})(typeof window !== 'undefined' ? window : globalThis);
