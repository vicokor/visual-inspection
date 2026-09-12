/**
 * 本地 AI 视检功能
 * 负责检测偏好、自动分析、AI 标注生命周期和显示过滤。
 */
const withAIInspectionFeature = (Base) => class extends Base {
    initAIInspectionEvents() {
        this.aiSettingsButton = document.getElementById('ai-settings-btn');
        this.aiSettingsPanel = document.getElementById('ai-settings-panel');
        this.aiSettingsClose = document.getElementById('ai-settings-close');
        this.aiSensitivity = document.getElementById('ai-sensitivity');
        this.aiSensitivityValue = document.getElementById('ai-sensitivity-value');
        this.aiRerunButton = document.getElementById('ai-rerun');
        this.aiClearButton = document.getElementById('ai-clear');
        this.aiResetButton = document.getElementById('ai-reset-settings');
        this.aiProgress = document.getElementById('ai-analysis-progress');
        this.aiProgressBar = document.getElementById('ai-progress-bar');
        this.aiProgressText = document.getElementById('ai-progress-text');
        this.aiSettingsDirty = document.getElementById('ai-settings-dirty');
        this.aiSummary = document.getElementById('ai-analysis-summary');

        this.aiSettings = this.loadAISettings();
        this.aiInspectionEngine = null;
        this.aiAnalysisToken = 0;
        this.aiAnalysisTimer = null;
        this.lastAIAnalysisSummary = null;

        this.syncAISettingsUI();

        if (this.aiSettingsButton) {
            this.aiSettingsButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.toggleAISettingsPanel();
            });
        }
        if (this.aiSettingsClose) {
            this.aiSettingsClose.addEventListener('click', () => this.closeAISettingsPanel());
        }
        if (this.aiSettingsPanel) {
            this.aiSettingsPanel.addEventListener('click', event => event.stopPropagation());
        }

        document.querySelectorAll('[data-ai-setting]').forEach(control => {
            control.addEventListener('change', event => this.handleAISettingChange(event));
        });

        if (this.aiSensitivity) {
            this.aiSensitivity.addEventListener('input', event => {
                this.aiSettings.sensitivity = Number(event.target.value);
                this.updateSensitivityLabel();
                this.persistAISettings();
                this.markAISettingsDirty();
            });
        }
        if (this.aiRerunButton) {
            this.aiRerunButton.addEventListener('click', () => this.runAIInspection({ manual: true }));
        }
        if (this.aiClearButton) {
            this.aiClearButton.addEventListener('click', () => {
                const removed = this.clearAIAnnotations();
                this.showToast(removed ? `已清除 ${removed} 条自动标注` : '当前没有自动标注', removed ? 'success' : 'info');
            });
        }
        if (this.aiResetButton) {
            this.aiResetButton.addEventListener('click', () => this.resetAISettings());
        }

        document.addEventListener('click', event => {
            if (!this.aiSettingsPanel?.classList.contains('active')) return;
            if (this.aiSettingsPanel.contains(event.target) || this.aiSettingsButton?.contains(event.target)) return;
            this.closeAISettingsPanel();
        });

        this.updateAIActionState();
    }

    loadAISettings() {
        const defaults = window.AI_INSPECTION_DEFAULT_SETTINGS || {
            autoDetect: true,
            showAIAnnotations: true,
            sensitivity: 3,
            ignoreContent: true,
            ignoreQuantity: true,
            ignoreSystemUI: true,
            ignoreDynamicImages: true,
            ignoreRenderNoise: true
        };
        try {
            const current = localStorage.getItem('inspection-ai-settings-v2');
            const saved = JSON.parse(current || localStorage.getItem('inspection-ai-settings-v1') || '{}');
            const result = { ...defaults };
            if (saved && typeof saved === 'object') {
                for (const key of Object.keys(defaults)) {
                    if (key !== 'sensitivity' && typeof saved[key] === 'boolean') result[key] = saved[key];
                }
                const value = Number(saved.sensitivity);
                // 旧版低/标准/高映射到新1/3/5档，不将旧标准档误读成较宽松。
                result.sensitivity = current
                    ? Math.max(1, Math.min(5, Math.round(value) || 3))
                    : ({ 1: 1, 2: 3, 3: 5 }[value] || 3);
            }
            return result;
        } catch (error) {
            console.warn('[本地视检] 设置读取失败，使用推荐设置', error);
            return { ...defaults };
        }
    }

    persistAISettings() {
        try {
            localStorage.setItem('inspection-ai-settings-v2', JSON.stringify(this.aiSettings));
        } catch (error) {
            console.warn('[本地视检] 设置保存失败', error);
        }
    }

    syncAISettingsUI() {
        document.querySelectorAll('[data-ai-setting]').forEach(control => {
            const key = control.dataset.aiSetting;
            control.checked = !!this.aiSettings[key];
        });
        if (this.aiSensitivity) this.aiSensitivity.value = String(this.aiSettings.sensitivity || 3);
        this.updateSensitivityLabel();
        this.updateAIVisibilityUI();
    }

    handleAISettingChange(event) {
        const key = event.target.dataset.aiSetting;
        this.aiSettings[key] = !!event.target.checked;
        this.persistAISettings();

        if (key === 'showAIAnnotations') {
            this.updateAIVisibilityUI();
            this.drawAnnotations();
            this.updateAnnotationsList();
            return;
        }

        this.markAISettingsDirty();
    }

    updateSensitivityLabel() {
        const value = Math.max(1, Math.min(5, Number(this.aiSettings.sensitivity) || 3));
        const setting = window.AI_INSPECTION_SENSITIVITY[value];
        if (this.aiSensitivityValue) {
            this.aiSensitivityValue.textContent = setting.label;
        }
        const hint = document.getElementById('ai-tolerance-hint');
        if (hint) hint.textContent = `位置容差 ${setting.tolerance}px · 色差阈值 ${setting.colorThreshold}/255 · 按基准宽度计算`;
        if (this.aiSensitivity) {
            const min = Number(this.aiSensitivity.min) || 1;
            const max = Number(this.aiSensitivity.max) || 5;
            const progress = ((value - min) / Math.max(1, max - min)) * 100;
            this.aiSensitivity.style.setProperty('--ai-slider-progress', `${progress}%`);
            this.aiSensitivity.setAttribute('aria-valuetext', `${setting.label}，位置容差 ${setting.tolerance} 像素`);
        }
    }

    updateAIVisibilityUI() {
        const visible = this.aiSettings?.showAIAnnotations !== false;
        this.aiSettingsButton?.classList.toggle('ai-hidden', !visible);
        this.aiSettingsButton?.setAttribute('aria-pressed', String(visible));
        this.aiSettingsButton?.setAttribute('title', visible ? 'AI 视检设置' : 'AI 标注已隐藏');
    }

    markAISettingsDirty() {
        if (!this.aiSettingsDirty) return;
        const hasImages = !!(this.state.designImage && this.state.devImage);
        this.aiSettingsDirty.hidden = !hasImages;
    }

    resetAISettings() {
        this.aiSettings = { ...(window.AI_INSPECTION_DEFAULT_SETTINGS || {}) };
        this.persistAISettings();
        this.syncAISettingsUI();
        this.drawAnnotations();
        this.updateAnnotationsList();
        this.updateClearButton();
        this.markAISettingsDirty();
        this.showToast('已恢复默认设置', 'success');
    }

    toggleAISettingsPanel() {
        if (!this.aiSettingsPanel) return;
        const opening = !this.aiSettingsPanel.classList.contains('active');
        this.aiSettingsPanel.classList.toggle('active', opening);
        this.aiSettingsButton?.classList.toggle('active', opening);
        if (opening && this.imageReplaceMenu?.classList.contains('active')) {
            this.imageReplaceMenu.classList.remove('active');
            this.imageReplaceBtn?.classList.remove('active');
        }
    }

    closeAISettingsPanel() {
        this.aiSettingsPanel?.classList.remove('active');
        this.aiSettingsButton?.classList.remove('active');
    }

    scheduleAutoInspection() {
        if (this._skipNextAutoInspection) {
            this._skipNextAutoInspection = false;
            return;
        }
        if (this.shouldSkipAutomaticAIInspection?.()) return;
        if (!this.aiSettings?.autoDetect) return;
        clearTimeout(this.aiAnalysisTimer);
        this.aiAnalysisTimer = setTimeout(() => this.runAIInspection(), 120);
    }

    async runAIInspection({ manual = false } = {}) {
        if (!this.state.designImage || !this.state.devImage) {
            if (manual) this.showToast('请先上传设计图和开发图', 'warning');
            return;
        }
        if (typeof window.LocalVisualInspectionEngine !== 'function') {
            this.showToast('本地检测引擎加载失败', 'error');
            return;
        }

        this.cancelAIInspection();
        const token = ++this.aiAnalysisToken;
        this.aiInspectionEngine = new window.LocalVisualInspectionEngine();
        this.setAIAnalyzing(true, 2, '准备检测');
        if (!manual) this.closeAISettingsPanel();

        try {
            const result = await this.aiInspectionEngine.analyze({
                designImage: this.state.designImage,
                devImage: this.state.devImage,
                baseWidth: this.state.baseWidth,
                settings: {
                    ...this.aiSettings,
                    longScreenshotMode: !!this.hasActiveLongScreenshot?.(),
                    ignoreRightEdgeRatio: this.hasActiveLongScreenshot?.() ? 0.04 : 0
                },
                onProgress: (percent, text) => {
                    if (token !== this.aiAnalysisToken) return;
                    this.setAIAnalyzing(true, percent, text);
                }
            });

            if (token !== this.aiAnalysisToken) return;
            this.replaceAIAnnotations(result.annotations || []);
            this.lastAIAnalysisSummary = result.summary || null;
            this.renderAIAnalysisSummary();
            if (this.aiSettingsDirty) this.aiSettingsDirty.hidden = true;

            const issueCount = result.summary?.issueCount || 0;
            const ignoredTotal = result.summary?.ignoredTotal || 0;
            this.showToast(`检测完成：发现 ${issueCount} 处问题，已忽略或合并 ${ignoredTotal} 处非样式／重复差异${result.summary?.truncated ? '（结果较多，当前显示前 60 处）' : ''}`, 'success');
        } catch (error) {
            if (token !== this.aiAnalysisToken || error.message === '检测已取消') return;
            console.error('[本地视检] 检测失败', error);
            this.showToast('自动检测失败，可继续使用手工标注', 'error');
        } finally {
            if (token === this.aiAnalysisToken) this.setAIAnalyzing(false);
        }
    }

    replaceAIAnnotations(newAnnotations) {
        const manualAnnotations = this.state.annotations.filter(annotation => annotation.source !== 'ai');
        const accepted = newAnnotations.filter(candidate => {
            return !manualAnnotations.some(manual => this.annotationIoU(manual, candidate) > 0.55);
        });
        const analysisId = Date.now();
        const aiAnnotations = accepted.map(annotation => ({
            ...annotation,
            id: this.state.currentAnnotationId++,
            analysisId
        }));
        this.state.annotations = [...manualAnnotations, ...aiAnnotations];
        this.drawAnnotations();
        this.updateAnnotationsList();
        this.updateClearButton();
        this.markAsUnsaved();
    }

    clearAIAnnotations({ silent = false } = {}) {
        const before = this.state.annotations.length;
        this.state.annotations = this.state.annotations.filter(annotation => annotation.source !== 'ai');
        const removed = before - this.state.annotations.length;
        if (removed) {
            this.lastAIAnalysisSummary = null;
            this.renderAIAnalysisSummary();
            this.drawAnnotations();
            this.updateAnnotationsList();
            this.updateClearButton();
            this.markAsUnsaved();
        }
        if (!silent) this.updateAIActionState();
        return removed;
    }

    prepareForImageChange() {
        this.cancelAIInspection();
        this.clearAIAnnotations({ silent: true });
        this.lastAIAnalysisSummary = null;
        this.renderAIAnalysisSummary();
    }

    cancelAIInspection() {
        clearTimeout(this.aiAnalysisTimer);
        this.aiAnalysisTimer = null;
        if (this.aiInspectionEngine) this.aiInspectionEngine.cancel();
        this.aiAnalysisToken += 1;
        this.setAIAnalyzing(false);
    }

    setAIAnalyzing(active, percent = 0, text = '') {
        if (this.aiProgress) this.aiProgress.hidden = !active;
        if (this.aiProgressBar) this.aiProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (this.aiProgressText && text) this.aiProgressText.textContent = text;
        this.aiSettingsButton?.classList.toggle('analyzing', active);
        if (this.aiRerunButton) this.aiRerunButton.disabled = active || !(this.state.designImage && this.state.devImage);
        if (this.aiClearButton) this.aiClearButton.disabled = active || !this.state.annotations.some(annotation => annotation.source === 'ai');
    }

    renderAIAnalysisSummary() {
        if (!this.aiSummary) return;
        const summary = this.lastAIAnalysisSummary;
        if (!summary) {
            this.aiSummary.hidden = true;
            this.aiSummary.textContent = '';
            return;
        }
        this.aiSummary.hidden = false;
        this.aiSummary.textContent = `发现 ${summary.issueCount || 0} 处问题 · 已忽略或合并 ${summary.ignoredTotal || 0} 处差异`;
    }

    updateAIActionState() {
        const hasImages = !!(this.state.designImage && this.state.devImage);
        const hasAI = this.state.annotations.some(annotation => annotation.source === 'ai');
        if (this.aiRerunButton) this.aiRerunButton.disabled = !hasImages;
        if (this.aiClearButton) this.aiClearButton.disabled = !hasAI;
    }

    updateClearButton() {
        const visible = this.getVisibleAnnotations();
        if (this.clearAllButton) this.clearAllButton.disabled = this.state.annotations.length === 0;
        if (this.exportPdfButton) this.exportPdfButton.disabled = visible.length === 0;
        if (this.toggleVisibilityButton) {
            this.toggleVisibilityButton.style.display = this.state.annotations.length ? 'flex' : 'none';
        }
        this.updateAIActionState();
    }

    getVisibleAnnotations(annotations = this.state.annotations) {
        if (this.aiSettings?.showAIAnnotations === false) {
            return (annotations || []).filter(annotation => annotation.source !== 'ai');
        }
        return annotations || [];
    }

    promoteAIAnnotation(annotation) {
        if (!annotation || annotation.source !== 'ai') return;
        annotation.source = 'manual';
        annotation.reviewStatus = 'confirmed';
    }

    annotationIoU(a, b) {
        const x0 = Math.max(a.baseX, b.baseX);
        const y0 = Math.max(a.baseY, b.baseY);
        const x1 = Math.min(a.baseX + a.baseWidth, b.baseX + b.baseWidth);
        const y1 = Math.min(a.baseY + a.baseHeight, b.baseY + b.baseHeight);
        const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
        const union = a.baseWidth * a.baseHeight + b.baseWidth * b.baseHeight - intersection;
        return union ? intersection / union : 0;
    }
};
