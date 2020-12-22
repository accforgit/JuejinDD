const downloadType = {
  article: 'article',
  img: 'img'
}
// 取消下载标志位
let downloadCancle = false

const errorListEle = document.getElementById('error_list')
const downloadPicCheckEle = document.getElementById('pic_download_check')

const downloadItemDetailMap = {
  [downloadType.article]: {},
  [downloadType.img]: {}
}
;[
  [downloadType.article, document.querySelector('.download_article_item')],
  [downloadType.img, document.querySelector('.download_img_item')]
].forEach(item => {
  syncDataDom(downloadItemDetailMap[item[0]], 'total', 0, item[1].querySelector('.download_total_count'))
  syncDataDom(downloadItemDetailMap[item[0]], 'success', 0, item[1].querySelector('.download_success_count'))
  syncDataDom(downloadItemDetailMap[item[0]], 'failed', 0, item[1].querySelector('.download_failed_count'))
})

const downloadStateEle = document.getElementById('download_state')

const downloadInfo = {
  totalArticle: 0,
  totalPic: 0,
  hasDownloadArticle: 0,
  hasDownloadPic: 0
}
let downloadItemMap = {}

document.getElementById('download_current').addEventListener('click', () => {
  resetData()
  sendMessage({
    type: popupDownloadCurrent,
    shouldDownloadPic: downloadPicCheckEle.checked
  })
})
document.getElementById('download_author').addEventListener('click', () => {
  resetData()
  sendMessage({
    type: popupDownloadAuthor,
    shouldDownloadPic: downloadPicCheckEle.checked
  })
})
// 取消下载点击
document.getElementById('download_cancle').addEventListener('click', () => {
  downloadCancle = true
  downloadStateEle.style.display = 'none'
  sendMessage({
    type: popupDownloadCancle,
    shouldDownloadPic: downloadPicCheckEle.checked
  })
})
document.getElementById('error_issue').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://github.com/accforgit/JuejinDD/issues'
  })
})
// 重置数据、DOM
function resetData() {
  downloadCancle = false
  downloadStateEle.style.display = 'list-item'
  downloadStateEle.style.color = '#f8ad13'
  downloadStateEle.textContent = '下载中...（完成下载前不要退出本弹窗）'
  errorListEle.innerHTML = ''
  downloadItemMap = {}
  Object.keys(downloadItemDetailMap).forEach(key => {
    downloadItemDetailMap[key].total = 0
    downloadItemDetailMap[key].success = 0
    downloadItemDetailMap[key].failed = 0
  })
}
// 同步数据与DOM
function syncDataDom(obj, key, value, ele) {
  let _value = value
  ele.textContent = value
  Object.defineProperty(obj, key, {
    get() {
      return _value
    },
    set(val) {
      ele.textContent = val
      _value = val
    }
  })
}
// 处理错误
function appendError(message) {
  const item = document.createElement('li')
  item.textContent = message
  item.className = 'error_li'
  errorListEle.appendChild(item)
}
// 下载信息
function updateDownloadInfo(message) {
  if (message.articleCount) {
    // totalArticle 一次就可以确定
    downloadItemDetailMap.article.total = message.articleCount
  }
  if (message.picCount) {
    // totalPic 需要分批累加
    downloadItemDetailMap.img.total += message.picCount
  }
}
// 检查是否下载完毕
function checkDownloaded() {
  if (downloadCancle) return
  downloadStateEle.style.display = 'list-item'
  if (
    downloadItemDetailMap[downloadType.article].success + downloadItemDetailMap[downloadType.article].failed >= downloadItemDetailMap[downloadType.article].total
    && downloadItemDetailMap[downloadType.img].success + downloadItemDetailMap[downloadType.img].failed >= downloadItemDetailMap[downloadType.img].total
  ) {
    downloadStateEle.style.color = '#1890ff'
    downloadStateEle.textContent = '下载完毕'
  }
}

// 向其他模块发送消息
function sendMessage(paramData, cb) {
  chrome.tabs.query({active: true, currentWindow: true}, async tabs => {
    if (tabs[0].url.indexOf('juejin.cn/post') === -1) {
      appendError('请在掘金文章详情页使用本插件')
      downloadStateEle.style.display = 'none'
      return
    }
    chrome.tabs.sendMessage(tabs[0].id, paramData, () => {
      cb && cb()
    })
  })
}

// 下载 markdown 文章
function extensionDownloadMd(message) {
  const blob = new Blob([message.data.content], { type: 'text/x-markdown' })
  chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: message.data.userName + '/' + message.data.title + '/' + 'index.md',
    conflictAction: 'uniquify',
    saveAs: false
  }, data => {
    if (data) {
      downloadItemMap[data] = downloadType.article
      return
    }
    if (chrome.runtime.lastError.message) {
      appendError(`《${message.data.title}》下载失败: ${chrome.runtime.lastError.message}`)
    }
  })
}
// 下载图片
function extensionDownloadImg(message) {
  if (!message.data.picUrl) {
    appendError(`《${message.data.title}》中的图片链接有问题，下载失败`)
    return
  }
  chrome.downloads.download({
    url: message.data.picUrl,
    filename: message.data.userName + '/' + message.data.title + '/' + message.data.picName,
    conflictAction: 'uniquify',
    saveAs: false
  }, data => {
    if (data) {
      downloadItemMap[data] = downloadType.img
      return
    }
    if (chrome.runtime.lastError.message) {
      appendError(`《${message.data.title}》中的图片 ${message.data.picUrl} 下载失败: ${chrome.runtime.lastError.message}`)
    }
  })
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === contentScriptDownloadArticle) {
    if (downloadCancle) return
    extensionDownloadMd(message)
  } else if (message.type === contentScriptDownloadImg) {
    if (downloadCancle) return
    extensionDownloadImg(message)
  } else if (message.type === contentDownloadInfo) {
    updateDownloadInfo(message.data)
  } else if (message.type === contentError) {
    appendError(message.data, message.type)
  } else if (message.type === contentArticleError) {
    appendError(message.data, message.type)
    downloadItemDetailMap[downloadType.article].failed += 1
    checkDownloaded()
  }
})
// 监听下载
chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!state || !state.current || state.current === 'in_progress') return
  const activeItem = downloadItemMap[id]
  if (!activeItem) {
    if (downloadCancle) return
    downloadItemDetailMap[downloadType.article].failed += 1
    downloadItemDetailMap[downloadType.article].failed += 1
    checkDownloaded()
    appendError(`未知下载id: ${id}，state: ${JSON.stringify(state)}`)
    return
  }
  if (state.current === 'complete') {
    downloadItemDetailMap[activeItem].success += 1
  } else {
    downloadItemDetailMap[activeItem].failed += 1
  }
  checkDownloaded()
})
