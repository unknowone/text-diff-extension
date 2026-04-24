// 点击工具栏图标时,在新标签页中打开对比页面
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('pages/diff.html')
  });
});

// 安装时打开欢迎页(可选)
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('pages/diff.html')
    });
  }
});
