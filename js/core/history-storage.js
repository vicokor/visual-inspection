/**
 * 历史记录数据层
 * 只负责 IndexedDB 的初始化、读写、删除和分组查询。
 */
/**
* IndexedDB 存储管理
* 用于存储历史视检记录，支持大图片数据（使用Base64）
*/
class HistoryStorage {
    constructor(dbName = 'InspectionHistory', version = 3) { // 版本升级到3
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    /**
    * 更新历史记录 - 直接删除并添加（更简洁）
    */
    async update(data) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['histories'], 'readwrite');
            const store = transaction.objectStore('histories');

            const oldTimestamp = data.timestamp;
            const newTimestamp = Date.now();

            // 创建新记录对象
            const newRecord = {
                ...data,
                timestamp: newTimestamp,
                date: new Date(newTimestamp).toISOString().split('T')[0],
        month: `${new Date(newTimestamp).getFullYear()}-${String(new Date(newTimestamp).getMonth() + 1).padStart(2, '0')}`,

        pluginAnnotations: data.pluginAnnotations || [] //确保 pluginAnnotations 被保存
            };

            // 先删除原记录
            const deleteRequest = store.delete(oldTimestamp);

            deleteRequest.onsuccess = () => {
                // 再添加新记录
                const addRequest = store.add(newRecord);

                addRequest.onsuccess = () => {
                    console.log('数据更新成功:', {
                        原时间戳: oldTimestamp,
                        新时间戳: newTimestamp
                    });
                    resolve(newTimestamp);
                };

                addRequest.onerror = () => {
                    console.error('添加新记录失败: ', addRequest.error);
                    reject(addRequest.error);
                };
            };

            deleteRequest.onerror = () => {
                console.error('删除原记录失败: ', deleteRequest.error);
                reject(deleteRequest.error);
            };
        });
    }

    /**
    * 初始化数据库
    */
    async init() {
        return new Promise((resolve, reject) => {
            // 检查是否在 file: // 协议下
            if (window.location.protocol === 'file:') {
                console.warn('在 file: // 协议下运行，使用Base64存储模式');
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('数据库打开失败: ', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('数据库初始化成功，版本: ', this.version);
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('数据库升级/创建到版本', this.version);

                // 如果存在旧存储，删除重建（因为数据结构变了）
                if (db.objectStoreNames.contains('histories')) {
                    db.deleteObjectStore('histories');
                }

                // 创建历史记录存储对象
            const store = db.createObjectStore('histories', { keyPath: 'timestamp' });

                // 创建索引：按时间倒序查询
            store.createIndex('by-timestamp', 'timestamp', { unique: true });

                // 创建索引：按日期分组查询（年-月-日）
            store.createIndex('by-date', 'date', { unique: false });

                // 创建索引：按月份分组查询（年-月）
            store.createIndex('by-month', 'month', { unique: false });

                console.log('数据库结构创建完成');
            };
        });
    }

    /**
    * 保存历史记录
* @param {Object} data 需要保存的数据
    */
    async save(data) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['histories'], 'readwrite');
            const store = transaction.objectStore('histories');

            // 确保数据中包含所有必要字段
            const record = {
                timestamp: data.timestamp,
                date: data.date,
                month: data.month,
                designImageBase64: data.designImageBase64,
                devImageBase64: data.devImageBase64,
                designWidth: data.designWidth,
                designHeight: data.designHeight,
                devWidth: data.devWidth,
                devHeight: data.devHeight,
                annotations: data.annotations || [],
                pluginAnnotations: data.pluginAnnotations || [],  // 👈 保存插件层数据
                inspectionMode: data.inspectionMode || 'side-by-side',
                baseWidth: data.baseWidth || 375,
                opacity: data.opacity || 50,
                preview: data.preview || '',
                designYOffset: data.designYOffset || 0,  // 保存设计图偏移量
                longScreenshot: data.longScreenshot || null
            };

            const request = store.add(record);

            request.onsuccess = () => {
                console.log('数据保存成功, timestamp: ', data.timestamp);
                resolve(data.timestamp);
            };

            request.onerror = () => {
                console.error('数据保存失败: ', request.error);
                reject(request.error);
            };
        });
    }

    /**
    * 获取所有历史记录（按时间倒序）
    */
    async getAll() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['histories'], 'readonly');
                const store = transaction.objectStore('histories');
                const index = store.index('by-timestamp');

                const request = index.openCursor(null, 'prev');
                const histories = [];

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        histories.push(cursor.value);
                        cursor.continue();
                    } else {
                        console.log('getAll 成功，获取到记录数: ', histories.length);
                        resolve(histories);
                    }
                };

                request.onerror = (event) => {
                    console.error('getAll 失败: ', event.target.error);
                    reject(event.target.error);
                };

            } catch (error) {
                console.error('getAll 异常: ', error);
                reject(error);
            }
        });
    }

    /**
    * 获取单个历史记录
* @param {number} timestamp 时间戳
    */
    async get(timestamp) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['histories'], 'readonly');
            const store = transaction.objectStore('histories');
            const request = store.get(timestamp);

            request.onsuccess = () => {
                console.log('获取历史记录成功: ', timestamp);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('获取历史记录失败: ', request.error);
                reject(request.error);
            };
        });
    }

    /**
    * 删除历史记录
* @param {number} timestamp 时间戳
    */
    async delete(timestamp) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['histories'], 'readwrite');
            const store = transaction.objectStore('histories');
            const request = store.delete(timestamp);

            request.onsuccess = () => {
                console.log('删除历史记录成功: ', timestamp);
                resolve();
            };

            request.onerror = () => {
                console.error('删除历史记录失败: ', request.error);
                reject(request.error);
            };
        });
    }

    /**
    * 清空所有历史记录
    */
    async clear() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['histories'], 'readwrite');
            const store = transaction.objectStore('histories');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('清空所有历史记录成功');
                resolve();
            };

            request.onerror = () => {
                console.error('清空历史记录失败: ', request.error);
                reject(request.error);
            };
        });
    }

    /**
    * 按分组获取历史记录
    */
    async getGroupedHistories() {
        try {
            const histories = await this.getAll();
            console.log('getGroupedHistories 获取到记录: ', histories.length);

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const yesterday = today - 86400000;
            const lastWeek = today - 7 * 86400000;
            const lastMonth = today - 30 * 86400000;

            const groups = {
                today: [],
                yesterday: [],
                last7Days: [],
                last30Days: [],
            months: {}
            };

            histories.forEach(history => {
                if (!history || !history.timestamp) {
                    console.warn('无效的历史记录: ', history);
                    return;
                }

                const historyDate = new Date(history.timestamp);
                const historyDay = new Date(historyDate.getFullYear(), historyDate.getMonth(), historyDate.getDate()).getTime();

                if (historyDay === today) {
                    groups.today.push(history);
                } else if (historyDay === yesterday) {
                    groups.yesterday.push(history);
                } else if (historyDay >= lastWeek) {
                    groups.last7Days.push(history);
                } else if (historyDay >= lastMonth) {
                    groups.last30Days.push(history);
                } else {
            const monthKey = `${historyDate.getFullYear()}-${String(historyDate.getMonth() + 1).padStart(2, '0')}`;
            const monthName = `${historyDate.getFullYear()}年${historyDate.getMonth() + 1}月`;
                    if (!groups.months[monthKey]) {
                        groups.months[monthKey] = {
                            name: monthName,
                            items: []
                        };
                    }
                    groups.months[monthKey].items.push(history);
                }
            });

            console.log('分组完成:', {
                today: groups.today.length,
                yesterday: groups.yesterday.length,
                last7Days: groups.last7Days.length,
                last30Days: groups.last30Days.length,
                months: Object.keys(groups.months).length
            });

            return groups;

        } catch (error) {
            console.error('getGroupedHistories 失败: ', error);
            return {
                today: [],
                yesterday: [],
                last7Days: [],
                last30Days: [],
            months: {}
            };
        }
    }

    /**
    * 检查数据库状态
    */
    async checkDatabase() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['histories'], 'readonly');
                const store = transaction.objectStore('histories');
                const countRequest = store.count();

                countRequest.onsuccess = () => {
                    console.log('数据库中记录数量: ', countRequest.result);
                    resolve(countRequest.result);
                };

                countRequest.onerror = (event) => {
                    console.error('检查数据库失败: ', event.target.error);
                    reject(event.target.error);
                };

            } catch (error) {
                console.error('checkDatabase 异常: ', error);
                reject(error);
            }
        });
    }
}
