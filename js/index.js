const preCode = '`'
const preCodeArea = '```'
const httpMethodMap = {
  post: 'POST',
  get: "GET"
}
// 取消下载标志位
let downloadCancle = false

// 监听 popup 发来的消息
chrome.runtime.onMessage.addListener(function(data, sender, sendResponse){
  sendResponse('response ' + data.type)
  downloadCancle = false
  if (data.type === popupDownloadCancle) {
    downloadCancle = true
  } else if (data.type === popupDownloadCurrent) {
    chrome.runtime.sendMessage({
      type: contentDownloadInfo,
      data: {
        articleCount: 1
      }
    })
    downloadArticle(getArticleId(), data.shouldDownloadPic)
  } else if (data.type === popupDownloadAuthor) {
    downloadAuthorArticles(data.shouldDownloadPic)
  }
})

/**
 * 根据 文章id 下载文章，如果没传 articleId，则下载当前文章
 * @param {string} articleId articleId
 * @param {boolean} shouldDownloadPic 是否需要下载文章中的图片
 * @param {string} [_isMyArticle] 下载的文章是否是当前登录用户的（即我的）
 */
async function downloadArticle(articleId, shouldDownloadPic, _isMyArticle) {
  if (downloadCancle) return
  let { user_id, user_name, draft_id, link_url, title, content, mark_content } = await getArticleDetail(articleId)
  if (!title || (!content && !mark_content)) {
    errorHandler(`文章《${title || articleId}》数据获取失败` + (link_url ? `，这篇文章可能是外链: ${link_url}` : ''), contentArticleError)
    return
  }
  // 早期的文章，文章详情接口只返回了文章md转换后的 html 数据，解析起来可能不是那么精确
  if (!mark_content) {
    // 去draft接口获取更准确的信息
    const draftMdContent = await getMyArticleDraft(user_id, draft_id, _isMyArticle)
    if (draftMdContent) {
      mark_content = draftMdContent
    }
  }
  title = getFileTitle(title) || ('未知文章名' + articleId)
  mark_content = clearThemeComment(mark_content)
  content = clearThemeComment(content)
  const userName = getFileTitle(user_name) || ('未知作者名' + user_id)
  let mdData = {
    md: mark_content || content,
    imgList: []
  }
  if (shouldDownloadPic) {
    if (mark_content) {
      mdData = await manageMdContent(mark_content, title)
    } else {
      mdData = await manageContent(content, title)
    }
  }
  if (!mdData || !mdData.md) {
    errorHandler(`文章《${title}》数据解析失败${link_url ? (': ' + link_url) : ''}`, contentArticleError)
    return
  }
  // 排除掉一些无法下载的图片
  mdData.imgList = mdData.imgList.filter(img => img.originUrl !== img.newUrl)
  chrome.runtime.sendMessage({
    type: contentDownloadInfo,
    data: {
      picCount: mdData.imgList.length
    }
  })
  // 下载文章
  mdData.imgList.forEach(({ originUrl, newUrl }) => {
    downloadFile({
      type: contentScriptDownloadImg,
      data: {
        picUrl: getFullUrl(originUrl),
        picName: newUrl,
        userName,
        title
      }
    })
  })
  // 下载图片
  downloadFile({
    type: contentScriptDownloadArticle,
    data: { userName, title, content: mdData.md }
  })
}

/**
 * 下载当前作者的所有文章
 * @param {boolean} shouldDownloadPic 是否需要下载文章中的图片
 */
async function downloadAuthorArticles(shouldDownloadPic) {
  let articles = await getAllArticles()
  const userId = await getUserId()
  chrome.runtime.sendMessage({
    type: contentDownloadInfo,
    data: {
      articleCount: articles.length
    }
  })
  const _isMyArticle = await isMyArticle(userId)
  for (let i = 0; i < articles.length; i++) {
    // 避免浏览器阻塞过多请求
    await sleep()
    downloadArticle(articles[i].article_id, shouldDownloadPic, _isMyArticle)
  }
}

// 下载资源
function downloadFile(data) {
  chrome.runtime.sendMessage(data)
}

/**
 * 处理 md 中的 img
 * @param {string} htmlStr html字符串
 * @param {string} title title
 */
async function manageContent(htmlStr, title) {
  let imgList = []
  let img = null
  let i = 0
  // https://github.com/domchristie/turndown
  const turndownService = new TurndownService({
    hr: '--',
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  })
  turndownService.use(turndownPluginGfm.gfm)
  const mdNice = isUseMdNice(htmlStr)
  turndownService.addRule('img', {
    filter: ['img'],
    replacement: function (content, node) {
      img = node.src || node.dataset.src
      i++
      imgList.push({
        originUrl: img,
        newUrl: i
      })
      return mdNice ? node.outerHTML : `![img](${i})`
    }
  })
  let md = htmlStr
  try {
    md = turndownService.turndown(md)
  } catch (err) {
    errorHandler(`文章${title} manageContent 失败`)
    return {
      md,
      mdList: []
    }
  }
  return await splitMdImg(md, imgList, title)
}
/**
 * 处理 md 中的 img
 * @param {string} mdStr mdStr
 * @param {string} title title
 */
async function manageMdContent(mdStr, title) {
  let i = 0
  let imgList = []
  let md = ''
  // 使用了 mdnice 的文章内容，图片都是用 html 的 <img /> 标签
  if (isUseMdNice(mdStr)) {
    const htmlImgRe = new RegExp('(?<=<img[\\s\\S]+?src=").+?(?="[\\s\\S]*>)', 'g')
    md = mdStr.replace(htmlImgRe, mt => {
      i++
      imgList.push({
        originUrl: mt,
        newUrl: i
      })
      // 用了 mdnice 后基本上都是 html 字符串，只下载其中的图片，不替换图片字符串（html的 <img>替换成 md 的 ![]() 就没法正常展示了）
      return mt
    })
    return await splitMdImg(md, imgList, title)
  }
  const mdImgRe = new RegExp('(?<=!\\[[^\\]]*?\]\\().+?(?=\\))', 'g')
  // md 中的 ` 和 ``` 中的字符不处理，直接分割筛选比直接使用正则匹配快
  md = mdStr.split(preCodeArea).reduce((t1, str1, index1) => {
    // 奇数的肯定是两个 ``` 中间的字符，不需要处理
    if (index1 % 2 === 1) {
      return t1 + preCodeArea + str1 + preCodeArea
    }
    return t1 + str1.split(preCode).reduce((t2, str2, index2) => {
      // 奇数的肯定是两个 ` 中间的字符，不需要处理
      if (index2 % 2 === 1) {
        return t2 + preCode + str2 + preCode
      }
      return t2 + str2.replace(mdImgRe, mt => {
        i++
        imgList.push({
          originUrl: mt,
          newUrl: i
        })
        return i
      })
    }, '')
  }, '')
  // 会取到一些奇怪的图片链接（链接最后有空格/换行符再加上一串字符），处理下
  imgList.forEach(img => {
    img.originUrl = img.originUrl.split(/\s+/)[0]
    return img
  })
  return await splitMdImg(md, imgList, title)
}

/**
 * 处理文章内容中的图片
 * @param {string} md md
 * @param {any[]} imgList imgList
 * @param {string} title title
 */
async function splitMdImg(md, imgList, title) {
  const mimeList = await Promise.all(imgList.map(img => getContentType(img.originUrl, title)))
  const isMdNiceContent = isUseMdNice(md)
  imgList.forEach(obj => {
    if (mimeList[obj.newUrl - 1] !== '') {
      obj.newUrl += mimeList[obj.newUrl - 1]
    } else if (isMdNiceContent) {
      obj.newUrl = obj.originUrl
    }
  })
  if (isMdNiceContent) {
    return {
      md,
      imgList
    }
  }
  let imgItem = null
  md = md.replace(/(?<=!\[.*?\]\()\d+?(?=\))/g, mt => {
    if (mimeList[mt - 1] !== '') {
      return (mt + mimeList[mt - 1])
    }
    imgItem = imgList.find(img => img.newUrl === +mt)
    if (imgItem) {
      imgItem.newUrl = imgItem.originUrl
      return imgItem.originUrl
    }
    errorHandler(`《${title}》未匹配图片 ${mt}`)
    return ''
  })
  return {
    md,
    imgList
  }
}
/**
 * 获取文章相关信息
 * @param {string} articleId articleId
 */
async function getArticleDetail(articleId) {
  if (!articleId) return {}
  const { code, data } = await httpRequest('https://api.juejin.cn/content_api/v1/article/detail', {
    article_id: articleId
  }, httpMethodMap.post)
  if (code !== 200 || !data || !data.data) return {}
  const article_info = data.data.article_info
  return {
    user_id: article_info.user_id,
    user_name: data.data.author_user_info.user_name,
    draft_id: article_info.draft_id,
    link_url: article_info.link_url,
    title: article_info.title,
    // 早期的文章返回 content 而不是 mark_content
    content: article_info.content,
    mark_content: article_info.mark_content
  }
}

/**
 * 获取当前我的文章的 draft 数据，这是我文章的原始数据，信息最准确
 * @param {string} userId userId
 * @param {string} draftId draftId
 * @param {boolean} [_isMyArticle] _isMyArticle
 */
async function getMyArticleDraft(userId, draftId, _isMyArticle) {
  if (typeof _isMyArticle !== 'boolean') {
    _isMyArticle = await isMyArticle(userId)
  }
  if (!_isMyArticle) return ''
  // 是我的文章，那么去draft接口获取更准确的信息
  const { code, data } = await httpRequest('https://juejin.cn/content_api/v1/article_draft/detail', {
    draft_id: draftId
  }, httpMethodMap.post)
  if (code !== 200) return ''
  return data.data ? data.data.article_draft.mark_content : ''
}

/**
 * 获取所有的文章列表数据
 * @returns {Promise<any[]>}
 */
async function getAllArticles() {
  const { user_id } = await getArticleDetail(getArticleId())
  if (!user_id) {
    errorHandler('获取所有文章列表失败：未获取到 user_id')
    return []
  }
  return await getArticlesByCursor('0', user_id)
}
async function getArticlesByCursor(cursor, user_id, articles = []) {
  const { code, data } = await httpRequest('https://api.juejin.cn/content_api/v1/article/query_list', {
    cursor,
    sort_type: 2,
    user_id
  }, httpMethodMap.post)
  if (code !== 200) {
    errorHandler(`getArticlesByCursor 获取所有文章列表失败, cursor: ${cursor}, code: ${code}`)
    return articles
  }
  articles = articles.concat(data.data)
  if (data.count > +data.cursor) {
    return await getArticlesByCursor(data.cursor, user_id, articles)
  }
  return articles
}

/**
 * 当前文章是否是我的文章
 * @param {string} articleUserId 当前文章的id
 * 只有当已经登录，并且当前文章是所登录的用户的文章的时候，才返回 true
 */
async function isMyArticle(articleUserId) {
  if (!articleUserId) return false
  const { code, data } = await httpRequest('https://api.juejin.cn/user_api/v1/user/get?aid=2608&not_self=0')
  if (code !== 200) return false
  return data.data && data.data.user_id === articleUserId
}

/**
 * 获取当前文章的 user_id
 * @returns {Promise<string>}
 */
async function getUserId() {
  const { user_id } = await getArticleDetail(getArticleId())
  return user_id
}
/**
 * 获取图片的 content-type 以确定后缀
 * @param {string} url 图片链接
 * @param {string} title 图片所属文章的标题
 */
async function getContentType(url, title) {
  if (!url) return
  // 可能会有跨域问题，所以统一改为新域名
  url = url.replace(/(?<=^(https?:)?\/\/)juejin.im/, 'juejin.cn').replace('http://', 'https://')
  try {
    const resp = await fetch(url, { mode: 'cors' })
    return getImgExtMap(resp.headers.get("content-type"))
  } catch (e) {
    // 尝试直接取后缀
    const mt = url.match(/\/.+(\.(png|jpg|svg|gif|webp))$/)
    if (mt && mt[1]) {
      return mt[1]
    }
    errorHandler(`《${title}》中的图片${url}获取MIME失败，失败原因：${e.message}，此图片下载失败不会影响总体下载结果`)
  }
  return ''
}

/**
 * 获取当前文章的 article_id
 */
function getArticleId() {
  const mt = location.href.match(/post\/(\d+)/)
  return mt ? (mt[1] + '') : ''
}
/**
 * 有些字符不能作为文件名，需要替换下
 * @param {string} title 原始title
 */
function getFileTitle(title) {
  let result = title.trim().slice(0, 128).replace(/[<>/\\|:"*?~.]/g, '_')
  // 8203 我也不知道啥神仙字符
  return Array.prototype.filter.call(result, c => c.charCodeAt(0) !== 8203).join('')
}
/**
 * 去除 md 文档开头的掘金主题字符串
 * @param {string} mdStr mdStr
 */
function clearThemeComment(mdStr) {
  if (!mdStr) return ''
  return mdStr.replace(/^---[\s\S]+?theme[\s\S]+?highlight[\s\S]+?---\s*/, '')
}
/**
 * 当前文章是否使用了 mdnice
 * @param {string} md md
 */
function isUseMdNice(md) {
  // 为了防止误判，正则规则写得比较严格
  // 这个规则以后可能会因为 mdnice 的改版而发生变化
  return /^\s*<section\s+id="nice"\s+data-tool="mdnice编辑器"\s+data-website="https:\/\/www.mdnice.com"/.test(md)
}

/**
 * 给没加协议的url添加协议
 * @param {string} url 原始 url
 * @example
 * // returns 'https://example.com/1.png'
 * getFullUrl('//example.com/1.png')
 */
function getFullUrl(url) {
  if (!url) return
  if (url.indexOf('//') === 0) {
    return 'https:' + url
  }
  return url
}
/**
 * 错误处理
 * @param {string} message 错误信息
 */
function errorHandler(message, contentArticleError) {
  console.log('JuejinDD Error: ', message, contentArticleError)
  chrome.runtime.sendMessage({ type: typeof contentArticleError !== 'undefined' ? contentArticleError : contentError, data: message })
}
function sleep(duration = 30) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, duration)
  }) 
}

/**
 * 下载图片的后缀，不同的 content-type 后缀不一样
 * @param {string} contentType 原始 content-type 值
 */
function getImgExtMap(contentType) {
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  }
  const mime = Object.keys(mimeMap).find(key => {
    return contentType.includes(key)
  })
  return mime ? mimeMap[mime] : ''
}

/**
 * 请求接口
 * @param {string} url 接口url
 * @param {string} [data] 当 method=httpMethodMap.post 时，传递的 data
 * @param {'GET' | 'POST'} [method] 请求方法
 */
async function httpRequest(url, data, method = httpMethodMap.get) {
  const params = {
    method,
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  }
  if (method === httpMethodMap.post && data) {
    params.body = JSON.stringify(data)
  }
  let result = {
    code: -1,
    data: null
  }
  try {
    const resp = await fetch(url, params)
    const data = await resp.json()
    result = {
      code: resp.status,
      data
    }
  } catch (e) {
    errorHandler(`链接 ${url} 请求失败，${data ? ('请求参数: ' + JSON.stringify(data)) : ''}失败原因：${e.message}`)
  }
  return result
}
