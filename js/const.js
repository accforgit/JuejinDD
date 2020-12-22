// popup 发起指令，下载当前文章
const popupDownloadCurrent = 'popupDownloadCurrent'
// popup 发起指令，下载当前作者的所有文章
const popupDownloadAuthor = 'popupDownloadAuthor'
// 取消下载
const popupDownloadCancle = 'popupDownloadCancle'
// index.js 获取到当前文章md字符串之后，让 popup.js 进行下载
const contentScriptDownloadArticle = 'contentScriptDownloadArticle'
// index.js 获取到当前文章md字符串之后，让 popup.js 进行md中图片的下载
const contentScriptDownloadImg = 'contentScriptDownloadImg'
// index.js 中发生的一般错误
const contentError = 'contentError'
// index.js 中发生的文章下载错误
const contentArticleError = 'contentArticleError'
// index.js 告知 popup 展示当前下载文章和图片的数量信息
const contentDownloadInfo = 'contentDownloadInfo'
