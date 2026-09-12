const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const context = { window: {}, globalThis: {} };
context.globalThis = context.window;
vm.createContext(context);

for (const file of ['semantic-matcher.js', 'style-evaluator.js', 'annotation-policy.js']) {
    const source = fs.readFileSync(path.join(projectRoot, 'js', 'ai-inspection', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
}

const { SemanticStructureMatcher, ElementStyleEvaluator, AIAnnotationPolicy } = context.window;

function node(id, type, templateKey, x, y, options = {}) {
    return {
        x,
        y,
        width: options.width || 120,
        height: options.height || 44,
        parts: options.parts || [],
        semantic: {
            id,
            type,
            templateKey,
            role: options.role || 'ordinary',
            criticality: options.criticality || 'ordinary',
            typeConfidence: options.typeConfidence == null ? 0.9 : options.typeConfidence,
            childHistogram: options.childHistogram || {},
            repeatGroupId: options.repeatGroupId || null,
            repeatCount: options.repeatCount || 1,
            style: options.style || {}
        }
    };
}

function annotation(overrides = {}) {
    return {
        baseX: 10,
        baseY: 10,
        baseWidth: 40,
        baseHeight: 20,
        category: 'color',
        description: '颜色不一致。',
        confidence: 0.9,
        source: 'ai',
        evidence: {},
        ...overrides
    };
}

function run() {
    const matcher = new SemanticStructureMatcher({
        shapeDistance: (design, dev) => design.semantic.templateKey === dev.semantic.templateKey ? 0 : 0.9,
        config: { ignoreContent: true, ignoreQuantity: true }
    });

    const design = [
        node('d-a', 'card', 'a', 0, 0),
        node('d-b', 'card', 'b', 0, 100),
        node('d-c', 'card', 'c', 0, 200)
    ];
    const dev = [
        node('v-c', 'card', 'c', 0, 0),
        node('v-a', 'card', 'a', 0, 100),
        node('v-b', 'card', 'b', 0, 200)
    ];
    const reordered = matcher.match(design, dev, {
        designWidth: 375,
        designHeight: 300,
        devWidth: 375,
        devHeight: 300
    });
    assert.strictEqual(Array.from(reordered.pairs, pair => pair.v.semantic.templateKey).join(','), 'a,b,c');
    assert.ok(reordered.pairs.every(pair => pair.orderChanged), '模块换序必须被识别为换序，而非位置错误');

    const policy = new AIAnnotationPolicy({ config: { ignoreContent: true, ignoreQuantity: true } });
    const ordinaryField = node('field', 'input', 'field', 0, 0);
    assert.strictEqual(policy.decideUnmatched({ node: ordinaryField, changeType: 'missing', mappingConfidence: 0.9 }).action, 'ignore');

    const criticalButton = node('submit', 'button', 'button', 0, 0, {
        role: 'primary-action',
        criticality: 'critical'
    });
    const criticalDecision = policy.decideUnmatched({ node: criticalButton, changeType: 'missing', mappingConfidence: 0.9 });
    assert.strictEqual(criticalDecision.action, 'mark');
    assert.strictEqual(criticalDecision.category, 'critical-missing');

    const criticalScene = node('scene', 'card', 'scene', 0, 0, {
        role: 'container',
        criticality: 'critical'
    });
    assert.strictEqual(policy.decideUnmatched({ node: criticalScene, changeType: 'missing', mappingConfidence: 0.9 }).description, '关键场景缺失。');
    assert.strictEqual(policy.decideUnmatched({ node: criticalScene, changeType: 'missing', mappingConfidence: 0.3 }).action, 'abstain');

    const uncertain = policy.apply([annotation({
        category: 'unconfirmed',
        description: '局部外观不一致，具体原因待确认。',
        confidence: 0.6
    })]);
    assert.strictEqual(uncertain.annotations.length, 0, '不确定候选不能生成可见自动标注');

    const reorderedPosition = policy.apply([annotation({
        category: 'position',
        description: '模块向下偏移。',
        evidence: { orderChanged: true, property: 'position' }
    })]);
    assert.strictEqual(reorderedPosition.annotations.length, 0, '纯模块换序不得作为位置问题输出');

    const contentLayout = policy.apply([annotation({
        category: 'layout',
        description: '文字内容挤压或溢出容器。',
        evidence: { property: 'overflow', contentDifference: true }
    })]);
    assert.strictEqual(contentLayout.annotations.length, 1, '内容可忽略，但内容造成的视觉破坏必须保留');

    const repeated = policy.apply([0, 1, 2, 3].map(index => annotation({
        baseY: index * 60,
        category: 'radius',
        description: '圆角偏小。',
        evidence: {
            nodeId: `card-${index}`,
            rootCauseId: `card-${index}:radius`,
            property: 'corner-radius',
            direction: 'smaller',
            templateKey: 'repeat-card',
            repeatGroupId: 'group-1',
            repeatCount: 4
        }
    })));
    assert.strictEqual(repeated.annotations.length, 1, '规律性错误只保留一个代表标注');
    assert.strictEqual(repeated.annotations[0].evidence.representativeCount, 4);

    const merged = policy.apply([
        annotation({
            category: 'size',
            description: '文字大小不一致。',
            evidence: { nodeId: 'text-1', rootCauseId: 'text-1:size', property: 'text-size' }
        }),
        annotation({
            category: 'color',
            description: '文字颜色不一致。',
            evidence: { nodeId: 'text-1', rootCauseId: 'text-1:color', property: 'text-color' }
        })
    ]);
    assert.strictEqual(merged.annotations.length, 1, '同一元素的可合并属性只输出一个元素框');
    assert.match(merged.annotations[0].description, /大小.*颜色/);

    const emitted = [];
    const evaluator = new ElementStyleEvaluator({
        unit: 1,
        tolerance: 2,
        sensitivity: { colorThreshold: 26 },
        config: { ignoreContent: true },
        emit: (...args) => emitted.push(args)
    });
    const baseStyle = {
        fillColor: [240, 240, 240],
        colorStd: 10,
        border: { top: 0, right: 0, bottom: 0, left: 0, median: 0 },
        corners: { profiles: Array.from({ length: 4 }, () => Array(36).fill(1)), extent: 10, confidence: 1 },
        shadow: Array(16).fill(0)
    };
    const dividerEntity = {
        accepted: true,
        matchConfidence: 0.9,
        d: node('d-line', 'divider', 'line', 0, 0, { width: 120, height: 1, style: baseStyle }),
        v: node('v-line', 'divider', 'line', 0, 0, { width: 120, height: 3, style: baseStyle })
    };
    evaluator.evaluate(dividerEntity);
    assert.ok(emitted.some(call => call[1] === 'border' && /分割线/.test(call[2])), '分割线粗细需要元素级标注');

    emitted.length = 0;
    const designCard = node('d-card', 'card', 'card', 0, 0, {
        width: 160,
        height: 200,
        parts: [node('d-child', 'text', 'text', 20, 40, { width: 80, height: 100 })],
        style: baseStyle
    });
    const devCard = node('v-card', 'card', 'card', 0, 0, {
        width: 160,
        height: 200,
        parts: [node('v-child', 'text', 'text', 20, 40, { width: 80, height: 80 })],
        style: baseStyle
    });
    evaluator.evaluate({ accepted: true, matchConfidence: 0.9, d: designCard, v: devCard });
    assert.ok(emitted.some(call => call[1] === 'spacing' && /元素底部间距/.test(call[2])), '字段删减后的固定容器留白应归因为元素底部间距');

    console.log('v23 AI 规则回归通过：10 组核心判断全部符合《AI打标原则》。');
}

run();
