/**
 * 应用入口
 * 仅负责组装功能模块和启动应用。新增功能优先放入对应 feature，
 * 避免继续把业务代码堆进入口文件。
 */
class InspectionTool extends withRulerFeature(
    withAIInspectionFeature(
        withExportFeature(
            withAnnotationFeature(
                withLongScreenshotFeature(
                    withComparisonFeature(
                        withHistoryFeature(InspectionToolCore)
                    )
                )
            )
        )
    )
) {}

        // 修改原来的初始化代码
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('DOM加载完成，初始化数据库...');

            // 先初始化数据库
            const storage = new HistoryStorage();
            try {
                await storage.init();
                console.log('历史记录数据库初始化成功');

                // 检查现有数据
                const count = await storage.checkDatabase();
                console.log('当前数据库中的记录数: ', count);

                // 如果有数据，打印出来看看
                if (count > 0) {
                    const histories = await storage.getAll();
                    console.log('现有历史记录:', histories.map(h => ({
                        timestamp: h.timestamp,
                        date: h.date,
                        hasDesignBlob: !!h.designImageBlob,
                        hasDevBlob: !!h.devImageBlob,
                        annotationsCount: h.annotations?.length
                    })));
                }
            } catch (error) {
                console.error('数据库初始化失败: ', error);
            }

            // 初始化应用
            window.inspectionTool = new InspectionTool();

            // 添加一个延迟检查，确保所有元素都加载完成
            setTimeout(() => {
                if (window.inspectionTool) {

                    // 如果元素仍然为null，尝试重新获取
                    if (!window.inspectionTool.offsetToggle) {
                        // 调试日志 console.log('尝试重新获取偏移元素');
                        window.inspectionTool.offsetToggle = document.getElementById('offset-toggle');
                        window.inspectionTool.offsetMenu = document.getElementById('offset-menu');
                        window.inspectionTool.offsetSlider = document.getElementById('offset-slider');
                        window.inspectionTool.offsetValue = document.getElementById('offset-value');
                    }
                }
            }, 100);
        });
