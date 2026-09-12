/**
 * v23 语义结构匹配器。
 * 使用类型、角色、子结构、外观和局部几何做全局一对一分配；元素序号只作弱证据。
 */
(function (global) {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const CONTAINER_TYPES = new Set(['card', 'component', 'element']);
    const FIELD_TYPES = new Set(['input', 'text']);

    class SemanticStructureMatcher {
        constructor({ shapeDistance, unit = 1, tolerance = 2, config = {} }) {
            this.shapeDistance = shapeDistance;
            this.unit = Math.max(0.01, unit);
            this.tolerance = Math.max(this.unit * 0.5, tolerance);
            this.config = config;
        }

        match(designNodes, devNodes, context = {}) {
            const design = designNodes || [];
            const dev = devNodes || [];
            if (!design.length) return { pairs: [], extra: dev.slice(), missing: [] };
            if (!dev.length) return { pairs: [], extra: [], missing: design.slice() };

            const rawCosts = design.map(d => dev.map(v => this.pairingCost(d, v, context)));
            const columns = dev.length + design.length;
            const matrix = design.map((node, row) => {
                const penalty = this.unmatchedPenalty(node);
                const values = [];
                for (let column = 0; column < columns; column += 1) {
                    if (column < dev.length) {
                        const gate = this.matchGate(node, dev[column]);
                        const raw = rawCosts[row][column];
                        values.push(raw <= gate ? raw : penalty + 0.45 + Math.min(0.4, raw * 0.05));
                    } else {
                        values.push(penalty + (column - dev.length) * 0.00001);
                    }
                }
                return values;
            });

            const assignment = this.hungarian(matrix);
            const usedDev = new Set();
            const pairs = [];
            const missing = [];
            for (let di = 0; di < design.length; di += 1) {
                const vi = assignment[di];
                const node = design[di];
                if (vi >= 0 && vi < dev.length && rawCosts[di][vi] <= this.matchGate(node, dev[vi])) {
                    const cost = rawCosts[di][vi];
                    usedDev.add(vi);
                    pairs.push({
                        d: node,
                        v: dev[vi],
                        di,
                        vi,
                        cost,
                        matchConfidence: clamp(1 - cost / Math.max(0.75, this.matchGate(node, dev[vi]) + 0.2), 0.35, 0.99),
                        matchedBy: 'semantic-structure',
                        orderChanged: false
                    });
                } else {
                    missing.push(node);
                }
            }
            const extra = dev.filter((_, index) => !usedDev.has(index));
            this.markOrderChanges(pairs, design.length, dev.length, context);
            return { pairs: pairs.sort((a, b) => a.di - b.di), extra, missing };
        }

        pairingCost(design, dev, context) {
            const d = design.semantic || {};
            const v = dev.semantic || {};
            const type = this.typeDistance(d.type, v.type);
            if (type >= 1.25) return 2 + type;
            const structure = this.structureDistance(d.childHistogram, v.childHistogram);
            const role = this.roleDistance(d, v);
            const geometry = this.geometryDistance(design, dev, d.type === 'text' && v.type === 'text');
            const position = this.positionDistance(design, dev, context);
            let visual = 0.5;
            try {
                visual = clamp(Number(this.shapeDistance(design, dev)) || 0, 0, 2);
            } catch (_) {
                visual = 0.5;
            }
            const repeatBonus = d.templateKey && d.templateKey === v.templateKey ? -0.1 : 0;
            // 文案只作为“这是同一个模块”的正向锚点；文案不同不加罚，因此不会把内容差异当样式错误。
            const textIdentity = this.textSimilarity(d.text, v.text);
            const identityBonus = textIdentity >= 0.28 ? -0.16 * textIdentity : 0;
            const criticalPenalty = d.criticality === 'critical' && v.criticality !== 'critical' && d.role !== v.role ? 0.28 : 0;
            return Math.max(0, type * 0.42 + structure * 0.28 + role * 0.18 + geometry * 0.27 +
                visual * 0.28 + position * 0.08 + repeatBonus + identityBonus + criticalPenalty);
        }

        textSimilarity(a = '', b = '') {
            const normalize = value => String(value).toLowerCase().replace(/\s+/g, ' ').trim();
            const left = normalize(a);
            const right = normalize(b);
            if (!left || !right) return 0;
            if (left === right) return 1;
            const grams = value => {
                if (value.length < 2) return new Set([value]);
                const result = new Set();
                for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
                return result;
            };
            const x = grams(left);
            const y = grams(right);
            let intersection = 0;
            for (const value of x) if (y.has(value)) intersection += 1;
            return intersection / Math.max(1, x.size + y.size - intersection);
        }

        typeDistance(a = 'element', b = 'element') {
            if (a === b) return 0;
            if (CONTAINER_TYPES.has(a) && CONTAINER_TYPES.has(b)) return 0.22;
            if (FIELD_TYPES.has(a) && FIELD_TYPES.has(b)) return 0.36;
            if ((a === 'button' && b === 'component') || (a === 'component' && b === 'button')) return 0.42;
            if ((a === 'image' && b === 'icon') || (a === 'icon' && b === 'image')) return 0.64;
            if (a === 'divider' || b === 'divider') return 1.4;
            if (a === 'text' || b === 'text') return 1.35;
            if (a === 'button' || b === 'button' || a === 'input' || b === 'input') return 0.95;
            return 0.72;
        }

        structureDistance(a = {}, b = {}) {
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            if (!keys.size) return 0;
            let different = 0;
            let total = 0;
            for (const key of keys) {
                different += Math.abs((a[key] || 0) - (b[key] || 0));
                total += Math.max(a[key] || 0, b[key] || 0);
            }
            return total ? different / total : 0;
        }

        roleDistance(a, b) {
            if (a.role === b.role) return 0;
            if (a.role === 'ordinary' || b.role === 'ordinary') return 0.3;
            if (a.role === 'primary-action' || b.role === 'primary-action') return 0.95;
            if ((a.role === 'text' && b.role === 'field') || (a.role === 'field' && b.role === 'text')) return 0.35;
            return 0.55;
        }

        geometryDistance(a, b, text) {
            const heightRatio = b.height / Math.max(1, a.height);
            const widthRatio = b.width / Math.max(1, a.width);
            if (heightRatio < 0.28 || heightRatio > 3.6) return 1.8;
            if (!text && (widthRatio < 0.32 || widthRatio > 3.2)) return 1.8;
            const height = Math.abs(Math.log(Math.max(0.05, heightRatio)));
            const width = text && this.config.ignoreContent ? 0 : Math.abs(Math.log(Math.max(0.05, widthRatio)));
            const aspectA = a.width / Math.max(1, a.height);
            const aspectB = b.width / Math.max(1, b.height);
            const aspect = text && this.config.ignoreContent ? 0 : Math.abs(Math.log(Math.max(0.05, aspectB / Math.max(0.05, aspectA))));
            return height + width * 0.65 + aspect * 0.25;
        }

        positionDistance(a, b, context) {
            const dParent = context.designParent;
            const vParent = context.devParent;
            const dWidth = dParent?.width || context.designWidth || Math.max(a.x + a.width, b.x + b.width, 1);
            const vWidth = vParent?.width || context.devWidth || dWidth;
            const dHeight = dParent?.height || context.designHeight || Math.max(a.y + a.height, b.y + b.height, 1);
            const vHeight = vParent?.height || context.devHeight || dHeight;
            const dx = (a.x - (dParent?.x || 0)) / Math.max(1, dWidth);
            const vx = (b.x - (vParent?.x || 0)) / Math.max(1, vWidth);
            const dy = (a.y - (dParent?.y || 0)) / Math.max(1, dHeight);
            const vy = (b.y - (vParent?.y || 0)) / Math.max(1, vHeight);
            return Math.min(1.5, Math.abs(dx - vx) + Math.abs(dy - vy));
        }

        unmatchedPenalty(node) {
            const semantic = node.semantic || {};
            if (semantic.criticality === 'critical') return 1.12;
            if (semantic.type === 'text' && this.config.ignoreContent) return 0.58;
            if (semantic.repeatGroupId && this.config.ignoreQuantity) return 0.58;
            return 0.78;
        }

        matchGate(design, dev) {
            const d = design.semantic || {};
            const v = dev.semantic || {};
            if (d.type === 'text' && v.type === 'text' && this.config.ignoreContent) return 1.05;
            if (d.criticality === 'critical') return 1.08;
            if (d.templateKey && d.templateKey === v.templateKey) return 1.02;
            return 0.9;
        }

        markOrderChanges(pairs, designCount, devCount, context) {
            if (context.level === 'element') return;
            for (const current of pairs) {
                const inverted = pairs.some(other =>
                    (other.di < current.di && other.vi > current.vi) ||
                    (other.di > current.di && other.vi < current.vi));
                const normalizedShift = designCount > 1 && devCount > 1 ?
                    Math.abs(current.di / (designCount - 1) - current.vi / (devCount - 1)) : 0;
                current.orderChanged = inverted || normalizedShift > 0.34;
            }
        }

        hungarian(matrix) {
            const rows = matrix.length;
            const columns = matrix[0]?.length || 0;
            if (!rows || !columns) return [];
            if (columns < rows) throw new Error('语义匹配矩阵列数必须不少于行数');
            const u = new Float64Array(rows + 1);
            const v = new Float64Array(columns + 1);
            const p = new Int32Array(columns + 1);
            const way = new Int32Array(columns + 1);
            for (let row = 1; row <= rows; row += 1) {
                p[0] = row;
                let column0 = 0;
                const min = new Float64Array(columns + 1);
                min.fill(Infinity);
                const used = new Uint8Array(columns + 1);
                do {
                    used[column0] = 1;
                    const row0 = p[column0];
                    let delta = Infinity;
                    let column1 = 0;
                    for (let column = 1; column <= columns; column += 1) {
                        if (used[column]) continue;
                        const current = matrix[row0 - 1][column - 1] - u[row0] - v[column];
                        if (current < min[column]) {
                            min[column] = current;
                            way[column] = column0;
                        }
                        if (min[column] < delta) {
                            delta = min[column];
                            column1 = column;
                        }
                    }
                    for (let column = 0; column <= columns; column += 1) {
                        if (used[column]) {
                            u[p[column]] += delta;
                            v[column] -= delta;
                        } else {
                            min[column] -= delta;
                        }
                    }
                    column0 = column1;
                } while (p[column0] !== 0);
                do {
                    const column1 = way[column0];
                    p[column0] = p[column1];
                    column0 = column1;
                } while (column0 !== 0);
            }
            const assignment = new Int32Array(rows);
            assignment.fill(-1);
            for (let column = 1; column <= columns; column += 1) {
                if (p[column]) assignment[p[column] - 1] = column - 1;
            }
            return Array.from(assignment);
        }
    }

    global.SemanticStructureMatcher = SemanticStructureMatcher;
})(typeof window !== 'undefined' ? window : globalThis);
