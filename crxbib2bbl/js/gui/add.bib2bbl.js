var bib2bbl_div = window.meun['bib2bbl'];
bib2bbl_div.innerHTML = `
<div class="modal-header tool">
<div class="modal-title tool"><i class="fa fa-bars fa-fw" ></i> </div>
    <div class="modal-title tool ">
        bib2bbl
    </div>
</div>

<div class="modal-header">

    <div style="display: flex; justify-content: center; align-items:center; padding: 5px">
        <button id="get_bib" class="btn btn-primary ct">get bib files from current project </button>
        <div class="modal-title tool select">
            <option selected="" disabled=""> get current project all bib file</option>
            
        </div>
    </div>
    <div style="display: flex; justify-content: center;">
        <textarea id="bib-input" spellcheck="false" placeholder="步驟1: 在這裏輸入bib;"></textarea>
        <textarea id="bbl-output" spellcheck="false"
            placeholder="步驟2: 結果會自動轉繁體, 在這裏將得到符合澳門科技大學論文文獻排版要求的 bbl"></textarea>
    </div>
    <button id="copybbl" class="btn btn-primary ct">copy bbl</button>
    <button id="copyclear" class="btn btn-primary ct">clear</button>
    <button id="copybib" class="btn btn-primary ct">copy bib</button>
</div>


<div class="modal-header">           
    <div style="display: flex; justify-content: center;">
        <textarea id="citekeys" spellcheck="false"
            placeholder="這裏將得到所有 citekeys, 如果您不需要對 citekey 進行重命名處理,請忽略!!"></textarea>
    </div>
    <button id="recitekeys" class="btn btn-primary ct">rename citekey</button>
    <button id="copycitekeys" class="btn btn-primary ct">copy citekeys</button>
</div>
`


var zhnum = 0
var endum = 0

// 处理bib 信息
function processText(rename = 0) {
    // 獲取左側文本輸入框的文本
    var text = document.getElementById("bib-input").value;
    //使用正則錶達式, 判斷 text 是否包含@符號
    var t = /@.*?/gm;

    if (!t.test(text)) {
        window.tooltip("無效或不完的 bib 信息,請重新輸入!");
        document.getElementById("bib-input").value = ''
        document.getElementById("bbl-output").value = ''
        return;
    }

    let a = new read_bib(text)
    // a.sortby = 'year'
    a.recitekey = rename
    // a.sortby = 'author'
    // a.recitekey = 1;
    let bibt = a.to_bib;
    let bblt = a.to_bbl;
    // 將排序後的數組輸齣成文本，顯示在右側文本輸入框中
    document.getElementById("bib-input").value = bibt;
    document.getElementById("bbl-output").value = bblt;

    let citekeys = a.citekeys;
    document.getElementById("citekeys").value = citekeys;

    zhnum = a.numofzhbib;
    endum = a.numofenbib;

}

function copyfbib() {
    let t = document.getElementById("bib-input").value;
    if (t != "") {
        navigator.clipboard.writeText(t).then(function () {
            let info = `bib 已寫入剪貼板。中文文獻數量:${zhnum}; 英文文獻數量:${endum}`
            window.tooltip(info)
        }, function (err) {
            console.error('Async: Could not copy text: ', err);
        });
    }
}

function copyfbbl() {
    let t = document.getElementById("bbl-output").value;
    if (t != "") {
        navigator.clipboard.writeText(t).then(function () {
            let info = `bbl 已寫入剪貼板。中文文獻數量:${zhnum}; 英文文獻數量:${endum}`
            window.tooltip(info)
        }, function (err) {
            console.error('Async: Could not copy text: ', err);
        });
    }
}

function copyfcitekeys() {
    let t = document.getElementById("citekeys").value;
    if (t != "") {
        navigator.clipboard.writeText(t).then(function () {
            let info = `citekeys 結果已復製到剪貼板! 中文文獻數量:${zhnum}; 英文文獻數量:${endum}`
            window.tooltip(info)
        }, function (err) {
            console.error('Async: Could not copy text: ', err);
        });
    }
}

function clearbibbbl() {
    document.getElementById("bib-input").value = "";
    document.getElementById("bbl-output").value = "";
    document.getElementById("citekeys").value = "";
}

// 获取当前project 所有bib 的 文件 id
function get_bib_id() {
    let res = {};
    var list = document.querySelector('.list-unstyled.file-tree-list');
    // 遍历所有 li 子元素
    var listItems = list.querySelectorAll('li');

    listItems.forEach(function (item) {
        // 检查 aria-label 属性中是否包含 'bib'
        if (item.getAttribute('aria-label').includes('.bib')) {
            // 如果条件满足，点击该元素
            item.click();
            const toggleButton = item.querySelector('.entity-menu-toggle.btn.btn-sm');
            // 打印这个元素的 id
            if (toggleButton) {
                bib_file = item.getAttribute('aria-label');
                bib_id = toggleButton.id
                bib_id = bib_id.split('-');
                bib_id = bib_id[2];
                res[bib_file] = bib_id;
            };
        }
    });
    return res;
}

// 获取 bib 文件并转换为 bbl
function getbib_and_Tran2bbl(bibID) {
    let url = ""
    try {
        const org_url = window.location.href;
        url = org_url.match(/(https:\/\/[wcn]+.overleaf.com\/project\/[a-z0-9]{24})/)[0];
    }
    catch (e) {
        console.log('Error:', e);
        return;
    }
    // 获取当前网页url
    url = `${window.location.href}/doc/${bibID}/download`;
    // 使用 fetch API 下载文件
    fetch(url)
        .then(response => {
            // 确保请求成功
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.text(); // 将响应体转换为文本
        })
        .then(text => {
            document.getElementById("bib-input").value = text;
            processText(0);
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });
}

// 加载 bib 文件
function load_bib_file() {
    let bib_sel = bib2bbl_div.querySelector(".modal-title.tool.select");
    bib_sel.innerHTML = "";
    let res = get_bib_id();
    let opt = "";
    let i = 0;
    for (let [bib_file, bib_id] of Object.entries(res)) {
        opt += `<option value=${i} id =${bib_id}>${bib_file}</option>\n`;
        i++;
    }

    let html = `
<select class="maseeselect" title="bib file">
${opt}
</select>
`
    bib_sel.innerHTML = html;
    const selElements = bib_sel.querySelectorAll('select')
    selElements.forEach(function (sel) {
        sel.addEventListener('change', function () {
            // k1 = sel.options[0].text;
            k2 = sel.options[sel.selectedIndex].text;
            // sel.selectedIndex = 0;
            let bib_id = res[k2];
            getbib_and_Tran2bbl(bib_id);
        });
    });
    let bib_id = res[selElements[0].options[0].text];
    getbib_and_Tran2bbl(bib_id);
}









var leftinput = document.getElementById("bib-input")
leftinput.addEventListener('input', function () {
    processText(0);
    copyfbbl()
});
leftinput.addEventListener('contextmenu', (event) => {
    event.preventDefault(); //阻止默認事件
    clearbibbbl()
});

var rightinput = document.getElementById("bbl-output")
rightinput.addEventListener('input', function () {
    processText(0);
});
rightinput.addEventListener('contextmenu', (event) => {
    event.preventDefault(); //阻止默認事件
    clearbibbbl()
});




document.getElementById("get_bib").addEventListener('click', load_bib_file);

document.getElementById("copybib").addEventListener('click', copyfbib);


document.getElementById("copybbl").addEventListener('click', copyfbbl);


document.getElementById("copycitekeys").addEventListener('click', copyfcitekeys);


document.getElementById("copyclear").addEventListener('click', clearbibbbl);


document.getElementById("recitekeys").addEventListener('click', function () {
    processText(1);
});



