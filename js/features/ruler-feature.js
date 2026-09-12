/**
 * 参考标尺功能
 * 负责从开发图边缘拖出、移动与清除水平/垂直参考线。
 * 参考线只辅助当前视检，不写入历史记录，也不触发未保存状态。
 */
const withRulerFeature = (Base) => class extends Base {
    initElements() {
        super.initElements();
        this.rulerCanvas = document.getElementById('ruler-canvas');
        this.rulerCtx = this.rulerCanvas?.getContext('2d') || null;
    }

    initRulerEvents() {
        this.rulerGuides = [];
        this.rulerGuideSeed = 1;
        this.rulerHoveredGuideId = null;
        this.rulerHoverAxis = null;
        this.rulerDrag = null;
        this.rulerImageIdentity = null;

        if (!this.canvasWrapper || !this.rulerCanvas) return;

        this._rulerPointerDown = (event) => this.handleRulerPointerDown(event);
        this._rulerPointerMove = (event) => this.handleRulerPointerMove(event);
        this._rulerPointerUp = (event) => this.finishRulerDrag(event);
        this._rulerDoubleClick = (event) => this.handleRulerDoubleClick(event);
        this._rulerPointerLeave = () => {
            if (!this.rulerDrag) this.clearRulerHover();
        };

        // 使用捕获阶段，让参考线在普通浏览状态下优先响应；标注开启时会主动让出事件。
        this.canvasWrapper.addEventListener('pointerdown', this._rulerPointerDown, true);
        this.canvasWrapper.addEventListener('pointermove', this._rulerPointerMove, true);
        this.canvasWrapper.addEventListener('pointerleave', this._rulerPointerLeave, true);
        this.canvasWrapper.addEventListener('dblclick', this._rulerDoubleClick, true);
        document.addEventListener('pointermove', this._rulerPointerMove, true);
        document.addEventListener('pointerup', this._rulerPointerUp, true);
        document.addEventListener('pointercancel', this._rulerPointerUp, true);
    }

    isRulerInteractionEnabled() {
        return !!(this.state.designImage && this.state.devImage &&
            !this.state.isAnnotating && !window.drawingToolbar?.isEnabled?.());
    }

    getRulerDevBounds() {
        const width = Math.max(0, Number(this.state.imageWidth) || 0);
        const devImage = this.state.devImage;
        const height = devImage?.width
            ? devImage.height * width / devImage.width
            : Math.max(0, Number(this.state.imageHeight) || 0);
        return {
            x: Number(this.state.canvasOffsetX) || 0,
            y: Number(this.state.canvasOffsetY) || 0,
            width,
            height: Math.max(0, height)
        };
    }

    getRulerHorizontalExtents() {
        const dev = this.getRulerDevBounds();
        if (this.state.inspectionMode !== 'side-by-side') {
            return { start: dev.x, end: dev.x + dev.width };
        }
        const designX = Number(this.state.designCanvasOffsetX) || 0;
        return { start: designX, end: dev.x + dev.width };
    }

    syncRulerCanvas() {
        if (!this.rulerCanvas || !this.annotationCanvas || !this.rulerCtx) return;
        const dpr = this.devicePixelRatio || 1;
        const cssWidth = this.annotationCanvas.width / dpr;
        const cssHeight = this.annotationCanvas.height / dpr;
        this.rulerCanvas.style.width = `${cssWidth}px`;
        this.rulerCanvas.style.height = `${cssHeight}px`;
        const bufferWidth = Math.max(1, Math.round(cssWidth * dpr));
        const bufferHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (this.rulerCanvas.width !== bufferWidth || this.rulerCanvas.height !== bufferHeight) {
            this.rulerCanvas.width = bufferWidth;
            this.rulerCanvas.height = bufferHeight;
        }
        this.rulerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.drawRulerGuides();
    }

    getRulerPointerPosition(event) {
        const rect = this.rulerCanvas.getBoundingClientRect();
        const dpr = this.devicePixelRatio || 1;
        const cssWidth = this.rulerCanvas.width / dpr;
        const cssHeight = this.rulerCanvas.height / dpr;
        return {
            x: rect.width ? (event.clientX - rect.left) * cssWidth / rect.width : 0,
            y: rect.height ? (event.clientY - rect.top) * cssHeight / rect.height : 0
        };
    }

    getRulerGuideViewPosition(guide) {
        const bounds = this.getRulerDevBounds();
        return guide.axis === 'horizontal'
            ? bounds.y + guide.position * bounds.height
            : bounds.x + guide.position * bounds.width;
    }

    findRulerGuideAt(point, tolerance = 6) {
        const bounds = this.getRulerDevBounds();
        const horizontal = this.getRulerHorizontalExtents();
        for (let index = this.rulerGuides.length - 1; index >= 0; index -= 1) {
            const guide = this.rulerGuides[index];
            const position = this.getRulerGuideViewPosition(guide);
            if (guide.axis === 'horizontal' &&
                point.x >= horizontal.start - tolerance && point.x <= horizontal.end + tolerance &&
                Math.abs(point.y - position) <= tolerance) return guide;
            if (guide.axis === 'vertical' &&
                point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance &&
                Math.abs(point.x - position) <= tolerance) return guide;
        }
        return null;
    }

    findRulerEdgeAt(point, tolerance = 7) {
        const bounds = this.getRulerDevBounds();
        if (!bounds.width || !bounds.height) return null;
        const withinX = point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance;
        const withinY = point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
        const distances = [];
        if (withinX) {
            distances.push({ axis: 'horizontal', distance: Math.abs(point.y - bounds.y) });
            distances.push({ axis: 'horizontal', distance: Math.abs(point.y - bounds.y - bounds.height) });
        }
        if (withinY) {
            distances.push({ axis: 'vertical', distance: Math.abs(point.x - bounds.x) });
            distances.push({ axis: 'vertical', distance: Math.abs(point.x - bounds.x - bounds.width) });
        }
        const match = distances
            .filter(item => item.distance <= tolerance)
            .sort((a, b) => a.distance - b.distance)[0];
        return match?.axis || null;
    }

    createRulerGuide(axis, point) {
        const bounds = this.getRulerDevBounds();
        const denominator = axis === 'horizontal' ? bounds.height : bounds.width;
        const raw = axis === 'horizontal' ? point.y - bounds.y : point.x - bounds.x;
        const guide = {
            id: this.rulerGuideSeed++,
            axis,
            position: denominator > 0 ? Math.max(0, Math.min(1, raw / denominator)) : 0
        };
        this.rulerGuides.push(guide);
        return guide;
    }

    updateRulerGuidePosition(guide, point) {
        if (!guide) return;
        const bounds = this.getRulerDevBounds();
        const denominator = guide.axis === 'horizontal' ? bounds.height : bounds.width;
        const raw = guide.axis === 'horizontal' ? point.y - bounds.y : point.x - bounds.x;
        guide.position = denominator > 0 ? Math.max(0, Math.min(1, raw / denominator)) : 0;
        this.drawRulerGuides();
    }

    handleRulerPointerDown(event) {
        if (event.button !== 0 || event.metaKey ||
            (event.pointerType && event.pointerType !== 'mouse') || !this.isRulerInteractionEnabled()) return;
        const point = this.getRulerPointerPosition(event);
        let guide = this.findRulerGuideAt(point);
        const edgeAxis = guide ? null : this.findRulerEdgeAt(point);
        if (!guide && !edgeAxis) return;
        if (!guide) guide = this.createRulerGuide(edgeAxis, point);
        this.rulerDrag = { guide, pointerId: event.pointerId };
        this.rulerHoveredGuideId = guide.id;
        this.rulerHoverAxis = guide.axis;
        this.applyRulerCursor(guide.axis, true);
        this.updateRulerGuidePosition(guide, point);
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    handleRulerPointerMove(event) {
        if (this.rulerDrag) {
            if (event.pointerId !== this.rulerDrag.pointerId) return;
            this.updateRulerGuidePosition(this.rulerDrag.guide, this.getRulerPointerPosition(event));
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (event.currentTarget === document || !this.isRulerInteractionEnabled()) {
            if (!this.isRulerInteractionEnabled()) this.clearRulerHover();
            return;
        }
        const point = this.getRulerPointerPosition(event);
        const guide = this.findRulerGuideAt(point);
        const axis = guide?.axis || this.findRulerEdgeAt(point);
        const nextId = guide?.id || null;
        if (this.rulerHoveredGuideId !== nextId) {
            this.rulerHoveredGuideId = nextId;
            this.drawRulerGuides();
        }
        this.rulerHoverAxis = axis;
        this.applyRulerCursor(axis, false);
    }

    finishRulerDrag(event) {
        if (!this.rulerDrag || (event.pointerId !== undefined &&
            event.pointerId !== this.rulerDrag.pointerId)) return;
        this.rulerDrag = null;
        this.clearRulerHover();
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
    }

    handleRulerDoubleClick(event) {
        if (!event.metaKey || !this.isRulerInteractionEnabled()) return;
        const point = this.getRulerPointerPosition(event);
        const edgeAxis = this.findRulerEdgeAt(point);
        if (edgeAxis) {
            this.clearRulerGuides();
        } else {
            const guide = this.findRulerGuideAt(point);
            if (!guide) return;
            this.rulerGuides = this.rulerGuides.filter(item => item.id !== guide.id);
            this.clearRulerHover();
            this.drawRulerGuides();
        }
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    applyRulerCursor(axis, dragging = false) {
        if (!this.canvasWrapper) return;
        this.canvasWrapper.classList.toggle('ruler-horizontal-ready', axis === 'horizontal');
        this.canvasWrapper.classList.toggle('ruler-vertical-ready', axis === 'vertical');
        this.canvasWrapper.classList.toggle('ruler-dragging', dragging);
    }

    clearRulerHover() {
        const redraw = this.rulerHoveredGuideId !== null;
        this.rulerHoveredGuideId = null;
        this.rulerHoverAxis = null;
        this.applyRulerCursor(null, false);
        if (redraw) this.drawRulerGuides();
    }

    refreshRulerInteractionState() {
        if (!this.isRulerInteractionEnabled()) {
            this.rulerDrag = null;
            this.clearRulerHover();
        }
    }

    clearRulerGuides() {
        this.rulerGuides = [];
        this.rulerDrag = null;
        this.clearRulerHover();
        this.drawRulerGuides();
    }

    drawRulerGuides() {
        if (!this.rulerCtx || !this.rulerCanvas) return;
        const dpr = this.devicePixelRatio || 1;
        const width = this.rulerCanvas.width / dpr;
        const height = this.rulerCanvas.height / dpr;
        this.rulerCtx.clearRect(0, 0, width, height);
        if (!this.rulerGuides?.length) return;

        const bounds = this.getRulerDevBounds();
        const horizontal = this.getRulerHorizontalExtents();
        this.rulerGuides.forEach(guide => {
            const hovered = guide.id === this.rulerHoveredGuideId || guide === this.rulerDrag?.guide;
            const position = this.getRulerGuideViewPosition(guide);
            this.rulerCtx.save();
            this.rulerCtx.beginPath();
            this.rulerCtx.strokeStyle = hovered ? 'rgba(38, 99, 219, 0.98)' : 'rgba(52, 111, 230, 0.78)';
            this.rulerCtx.lineWidth = hovered ? 1.5 : 1;
            this.rulerCtx.setLineDash([6, 5]);
            if (guide.axis === 'horizontal') {
                this.rulerCtx.moveTo(horizontal.start, Math.round(position) + 0.5);
                this.rulerCtx.lineTo(horizontal.end, Math.round(position) + 0.5);
            } else {
                this.rulerCtx.moveTo(Math.round(position) + 0.5, bounds.y);
                this.rulerCtx.lineTo(Math.round(position) + 0.5, bounds.y + bounds.height);
            }
            this.rulerCtx.stroke();
            this.rulerCtx.restore();
        });
    }

    syncRulerImageIdentity() {
        const next = { design: this.state.designImage, dev: this.state.devImage };
        if (this.rulerImageIdentity &&
            (this.rulerImageIdentity.design !== next.design || this.rulerImageIdentity.dev !== next.dev)) {
            this.clearRulerGuides();
        }
        this.rulerImageIdentity = next;
    }

    toggleAnnotationMode() {
        const result = super.toggleAnnotationMode();
        this.refreshRulerInteractionState();
        return result;
    }

    updateComparison() {
        const result = super.updateComparison();
        this.syncRulerImageIdentity();
        this.syncRulerCanvas();
        requestAnimationFrame(() => this.syncRulerCanvas());
        return result;
    }

    startInspection() {
        const result = super.startInspection();
        this.syncRulerImageIdentity();
        requestAnimationFrame(() => this.syncRulerCanvas());
        return result;
    }

    resetAll() {
        this.clearRulerGuides();
        return super.resetAll();
    }
};
