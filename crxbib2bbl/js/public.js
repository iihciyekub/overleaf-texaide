try {
    window.name = chrome.runtime.getManifest().name;
    window.version = chrome.runtime.getManifest().version;
}
catch (e) {
    window.name = "overleaf s2t/bib2bbl";
    window.version = "?";
}



// 一闪而过的提示框
function tooltip(txt) {
    // 创建提示框元素，显示 1 秒后移除
    const tooltip = document.createElement('div');
    tooltip.innerText = txt;
    tooltip.style.position = 'fixed';
    tooltip.style.top = '50%';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    tooltip.style.background = 'rgba(0, 0, 0, 0.8)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '10px';
    tooltip.style.borderRadius = '5px';
    tooltip.style.transition = 'opacity 0.5s';
    document.body.appendChild(tooltip);

    setTimeout(() => {
        tooltip.style.opacity = 0;
        setTimeout(() => {
            document.body.removeChild(tooltip);
        }, 500);
    }, 1000);
}

// 文本内容写入剪贴板
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(function () {
            // console.log("已成功复制行内容到剪贴板");
        })
        .catch(function (error) {
            // console.error("复制行内容到剪贴板失败:", error);
        });
}











// 外部调用
window.tooltip = tooltip;
window.copyToClipboard = copyToClipboard;
 