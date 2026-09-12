/**
 * v23 自动打标策略。
 * 负责内容／数量忽略、关键缺失例外、低置信弃权、根因归并与规律性代表标注。
 */
(function (global) {
    'use strict';

    const LOCAL_CATEGORIES = new Set(['spacing', 'radius', 'border']);
    const CONTENT_TYPES = new Set(['text', 'image', 'input', 'button', 'card', 'component', 'element']);

    class AIAnnotationPolicy {
        constructor({ config = {}, sensitivity = {}, maxAnnotations = 60 } = {}) {
            this.config = config;
            this.sensitivity = sensitivity;
            this.maxAnnotations = maxAnnotations;
        }

        decideUnmatched({ node, changeType, mappingConfidence = 1 }) {
            const semantic = node?.semantic || {};
            const type = semantic.type || 'element';
            const critical = semantic.criticality === 'critical';
            const typeConfidence = semantic.typeConfidence == null ? 0.5 : semantic.typeConfidence;

            if (changeType === 'missing' && critical) {
                if (mappingConfidence < 0.58) return { action: 'abstain', reason: 'uncertain' };
                if (semantic.role === 'primary-action') {
                    return { action: 'mark', category: 'critical-missing', description: '关键操作按钮缺失。', confidence: 0.96 };
                }
                return { action: 'mark', category: 'critical-missing', description: '关键场景缺失。', confidence: 0.92 };
            }

            if (changeType === 'extra' && this.config.ignoreContent && type !== 'divider') {
                return { action: 'ignore', reason: semantic.repeatGroupId ? 'quantity' : 'content' };
            }
            if (semantic.repeatGroupId && this.config.ignoreQuantity) {
                return { action: 'ignore', reason: 'quantity' };
            }
            if (this.config.ignoreContent && CONTENT_TYPES.has(type)) {
                return { action: 'ignore', reason: type === 'input' ? 'quantity' : 'content' };
            }
            if (typeConfidence < 0.6 || mappingConfidence < 0.58) {
                return { action: 'abstain', reason: 'uncertain' };
            }

            const label = {
                text: changeType === 'missing' ? '缺少文字。' : '多出文字。',
                icon: changeType === 'missing' ? '图标缺失。' : '多出图标。',
                divider: changeType === 'missing' ? '分割线缺失。' : '多出分割线。',
                button: changeType === 'missing' ? '按钮缺失。' : '多出按钮。',
                input: changeType === 'missing' ? '缺少输入字段。' : '多出输入字段。',
                card: changeType === 'missing' ? '缺少模块。' : '多出模块。'
            }[type] || (changeType === 'missing' ? '缺少元素。' : '多出元素。');
            return { action: 'mark', category: 'structure', description: label, confidence: 0.88 };
        }

        apply(annotations) {
            const suppressed = { uncertain: 0, content: 0, quantity: 0, cascade: 0, duplicate: 0 };
            const filtered = [];
            for (const original of annotations || []) {
                const annotation = { ...original, evidence: { ...(original.evidence || {}) } };
                const evidence = annotation.evidence;
                if (annotation.category === 'unconfirmed' || evidence.uncertainState || /待确认|可能是/.test(annotation.description || '')) {
                    suppressed.uncertain += 1;
                    continue;
                }
                if (evidence.orderChanged && annotation.category === 'position') {
                    suppressed.cascade += 1;
                    continue;
                }
                if (evidence.suppressedByReflow || evidence.cascadeOnly) {
                    suppressed.cascade += 1;
                    continue;
                }
                if (evidence.changeType && evidence.criticality !== 'critical') {
                    if (evidence.repeatGroupId && this.config.ignoreQuantity) {
                        suppressed.quantity += 1;
                        continue;
                    }
                    if (this.config.ignoreContent && CONTENT_TYPES.has(evidence.elementType)) {
                        suppressed.content += 1;
                        continue;
                    }
                }
                const minimum = evidence.criticality === 'critical' ? 0.72 : 0.78;
                if ((annotation.confidence || 0) < minimum) {
                    suppressed.uncertain += 1;
                    continue;
                }
                if (annotation.category === 'structure' && /^元素与设计稿不一致/.test(annotation.description || '') &&
                    !evidence.property && (annotation.confidence || 0) < 0.92) {
                    suppressed.uncertain += 1;
                    continue;
                }
                filtered.push(annotation);
            }

            const roots = this.dedupeRootCauses(filtered, suppressed);
            const merged = this.mergeElementProperties(roots, suppressed);
            const overlaps = this.removeOverlaps(merged, suppressed);
            const represented = this.collapseRepeatedPatterns(overlaps, suppressed);
            const ordered = represented.sort((a, b) => a.baseY - b.baseY || a.baseX - b.baseX);
            return {
                annotations: ordered.slice(0, this.maxAnnotations),
                suppressed,
                truncated: ordered.length > this.maxAnnotations
            };
        }

        dedupeRootCauses(annotations, suppressed) {
            const result = [];
            const roots = new Map();
            for (const annotation of annotations) {
                const root = annotation.evidence?.rootCauseId;
                if (!root) {
                    result.push(annotation);
                    continue;
                }
                const previous = roots.get(root);
                if (!previous) {
                    roots.set(root, annotation);
                    result.push(annotation);
                    continue;
                }
                suppressed.duplicate += 1;
                if ((annotation.confidence || 0) <= (previous.confidence || 0)) continue;
                result.splice(result.indexOf(previous), 1, annotation);
                roots.set(root, annotation);
            }
            return result;
        }

        mergeElementProperties(annotations, suppressed) {
            const result = [];
            for (const annotation of annotations) {
                const nodeId = annotation.evidence?.nodeId;
                const local = LOCAL_CATEGORIES.has(annotation.category);
                const target = !nodeId || local ? null : result.find(item =>
                    item.evidence?.nodeId === nodeId && !LOCAL_CATEGORIES.has(item.category) && this.iou(item, annotation) >= 0.42);
                if (!target) {
                    result.push(annotation);
                    continue;
                }
                suppressed.duplicate += 1;
                const right = Math.max(target.baseX + target.baseWidth, annotation.baseX + annotation.baseWidth);
                const bottom = Math.max(target.baseY + target.baseHeight, annotation.baseY + annotation.baseHeight);
                target.baseX = Math.min(target.baseX, annotation.baseX);
                target.baseY = Math.min(target.baseY, annotation.baseY);
                target.baseWidth = right - target.baseX;
                target.baseHeight = bottom - target.baseY;
                target.description = this.joinDescriptions(target.description, annotation.description);
                target.confidence = Math.max(target.confidence || 0, annotation.confidence || 0);
                const properties = new Set([
                    ...(target.evidence.properties || [target.evidence.property || target.evidence.kind].filter(Boolean)),
                    ...(annotation.evidence.properties || [annotation.evidence.property || annotation.evidence.kind].filter(Boolean))
                ]);
                target.evidence.properties = [...properties];
                target.evidence.memberCount = (target.evidence.memberCount || 1) + (annotation.evidence.memberCount || 1);
                target.category = target.category === annotation.category ? target.category : 'combined';
            }
            return result;
        }

        removeOverlaps(annotations, suppressed) {
            const result = [];
            for (const annotation of annotations.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))) {
                const property = annotation.evidence?.property || annotation.evidence?.kind || annotation.category;
                const duplicate = result.some(item => {
                    const other = item.evidence?.property || item.evidence?.kind || item.category;
                    return property === other && this.iou(item, annotation) > 0.68;
                });
                if (duplicate) {
                    suppressed.duplicate += 1;
                    continue;
                }
                result.push(annotation);
            }
            return result;
        }

        collapseRepeatedPatterns(annotations, suppressed) {
            const groups = new Map();
            const standalone = [];
            for (const annotation of annotations) {
                const evidence = annotation.evidence || {};
                if (!evidence.repeatGroupId || (evidence.repeatCount || 1) < 2) {
                    standalone.push(annotation);
                    continue;
                }
                const property = evidence.property || evidence.kind || annotation.category;
                const direction = evidence.direction || '';
                const key = `${evidence.templateKey || evidence.repeatGroupId}|${property}|${direction}`;
                const group = groups.get(key) || [];
                group.push(annotation);
                groups.set(key, group);
            }
            for (const group of groups.values()) {
                const representative = group.slice().sort((a, b) =>
                    (b.confidence || 0) - (a.confidence || 0) || a.baseY - b.baseY)[0];
                const affected = group.length;
                if (affected > 1) {
                    representative.description = `${String(representative.description || '').replace(/。$/, '')}；同类组件共 ${affected} 处，此处为代表标注。`;
                    representative.evidence = { ...representative.evidence, representativeCount: affected };
                    suppressed.duplicate += affected - 1;
                }
                standalone.push(representative);
            }
            return standalone;
        }

        joinDescriptions(a = '', b = '') {
            const cleanA = a.replace(/[。；]+$/, '');
            const cleanB = b.replace(/[。；]+$/, '');
            if (!cleanA) return cleanB ? `${cleanB}。` : '';
            if (!cleanB || cleanA === cleanB) return `${cleanA}。`;
            return `${cleanA}；${cleanB}。`;
        }

        iou(a, b) {
            const x0 = Math.max(a.baseX, b.baseX);
            const y0 = Math.max(a.baseY, b.baseY);
            const x1 = Math.min(a.baseX + a.baseWidth, b.baseX + b.baseWidth);
            const y1 = Math.min(a.baseY + a.baseHeight, b.baseY + b.baseHeight);
            const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
            const union = a.baseWidth * a.baseHeight + b.baseWidth * b.baseHeight - intersection;
            return union ? intersection / union : 0;
        }
    }

    global.AIAnnotationPolicy = AIAnnotationPolicy;
})(typeof window !== 'undefined' ? window : globalThis);
