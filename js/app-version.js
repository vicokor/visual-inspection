/**
 * 发布版本单一数据源。
 * 后续发布只更新此处，浏览器页签标题会自动同步当前版本。
 */
window.APP_RELEASE = Object.freeze({
    productName: '视检工具',
    version: '23.0',
    channel: '测试版'
});

document.title = `${window.APP_RELEASE.productName} v${window.APP_RELEASE.version} ${window.APP_RELEASE.channel}`;
document.documentElement.dataset.appVersion = window.APP_RELEASE.version;
