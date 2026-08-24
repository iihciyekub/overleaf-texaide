var tikzPGFjson = window.tikzPGFjson //ewewe


// 通过query_tikzPGFjson_item() 得到的结果
var tikzPGFjson_query_items = [];

// 容器对象
var pgfplot_div, macro_example, macro_code;

// 对 tikzPGFjson 进行计算用的变量
var id_count = 0;

// 保存 tag 对应的按键与 tikzPGFjson item
var mark_but, mark_tagitem;

function query_tikzPGFjson_with_k1k2(k1, k2) {
    let itemslist = []
    for (var i = 0; i < tikzPGFjson.length; i++) {
        var item = tikzPGFjson[i]
        var themes = item['themes']
        var categorys = item['categorys']
        themes = (typeof themes == 'string') ? [themes] : themes
        categorys = (typeof categorys == 'string') ? [categorys] : categorys
        if (themes != null) {
            if (themes.includes(k1) && categorys.includes(k2)) {
                itemslist.push(item)
            }
        }
    }
    // 进行排序
    itemslist.sort((a, b) => a.tag.localeCompare(b.tag));
    // 将值更新到全局变量中,
    tikzPGFjson_query_items = itemslist;
}


function query_tikzPGFjson_with_text(text) {
    let itemslist = []
    for (var i = 0; i < tikzPGFjson.length; i++) {
        var item = tikzPGFjson[i]
        var themes = item['themes']
        var categorys = item['categorys']
        var macro = item['macro'];
        var example = item['example'];
        themes = (typeof themes == 'string') ? [themes] : themes
        categorys = (typeof categorys == 'string') ? [categorys] : categorys
        if (themes != null && categorys != null) {
            if (typeof themes == 'object' && typeof categorys == 'object') {
                themes = themes.concat(categorys)
                var txt = themes.join(" ") + " " + macro + " " + example;

                var r = new RegExp(text, "i");
                var d = r.exec(txt);
                if (d != null) {
                    itemslist.push(item)
                }
            }
        }
    }
    // 进行排序
    itemslist.sort((a, b) => a.tag.localeCompare(b.tag));
    // 将值更新到全局变量中,
    tikzPGFjson_query_items = itemslist;
};






// 传入 tikzPGFjson 的 item
function display_tag_items(display_items) {
    let t2 = ``;
    // 由索引值获得到的 tikzPGFjson item 字典,可通过tag button的 value 值索引
    var items_dict = {};
    display_items.forEach(element => {
        t2 += `<button class="btn btn-primary tag" value="${element.id}">${element.tag}</button>\n`
        // 将 id 与 item 对应起来
        items_dict[element.id] = element
    });
    t2 += `<button class="btn btn-primary tag add" value="99999" title="创建新 snippet">+</button>\n`
    t2 += `<button id ='exportjson' class="btn btn-primary tag add" value="999999" style="background-color:#bcee68" title="导出 export tikzPGF-json">e</button>\n`

    container_tag = document.querySelector(".modal-body.tagHere");
    container_tag.innerHTML = t2;

    //对所有 class btn btn-primary prompt 注册点击事件
    let btns = document.querySelectorAll('button.btn.btn-primary.tag');
    for (let i = 0; i < btns.length; i++) {
        let item_id = btns[i].value;
        if (item_id == 99999) {
            btns[i].addEventListener("click", function () {
                let tdic = {};
                tdic['id'] = id_count + 1;
                var userInput = prompt("请输入新 theme:");
                if (userInput === null) {
                    return 0;
                }
                tdic['themes'] = userInput;

                userInput = prompt("请输入新 category:");
                if (userInput === null) {
                    return 0;
                }
                tdic['categorys'] = userInput;

                userInput = prompt("请输入新 tag:");
                if (userInput === null) {
                    return 0;
                }
                tdic['tag'] = userInput;

                userInput = prompt("请输入新 example:");
                if (userInput === null) {
                    return 0;
                }
                tdic['example'] = userInput;

                userInput = prompt("请输入新 macro:");
                if (userInput === null) {
                    return 0;
                }
                tdic['macro'] = userInput;
                tikzPGFjson.push(tdic);
                id_count++;
                isyn = confirm("是否重载 TikZ-PGF?");
                if (isyn) {
                    reload_tikzPGFjson();
                }
            });
        } else if (item_id == 999999) {
            // 导出 json 文件
            // var exportjson = pgfplot_div.querySelector("#exportjson");
            btns[i].addEventListener("click", function () {
                var jsonStr = JSON.stringify(tikzPGFjson);
                var blob = new Blob([jsonStr], { type: "application/json" });
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url;
                a.download = "data.json";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }
        else {
            let item = items_dict[item_id];
            //判断 mark_but 类型是否为 object
            if (typeof mark_but == 'object') {
                if (mark_but.value == btns[i].value) {
                    btns[i].style.backgroundColor = "#00d15690";
                    btns[i].style.border = "1.5pt solid #93939300";
                    mark_but = btns[i];
                    mark_tagitem = item;
                }
            }
            btns[i].addEventListener('click', function () {
                mark_tagitem = item;
                if (mark_but != null) {
                    mark_but.style.backgroundColor = "#ffffff";
                    mark_but.style.border = "0.5pt solid #939393d8";
                }
                btns[i].style.backgroundColor = "#00d15690";
                btns[i].style.border = "1.5pt solid #93939300";
                macro_example.innerHTML = item.example;
                macro_code.innerHTML = item.macro;
                mark_but = btns[i];

            });
            // 双击事件
            btns[i].addEventListener('dblclick', function () {
                var newName = prompt("已更新 macro 点击确定保存(可修改tag)", item.tag);
                if (newName !== null) {
                    item.tag = newName;
                    if (macro_example.value != "") {
                        item.example = macro_example.textContent;
                    }
                    isyn = confirm("是否重载 TikZ-PGF?");
                    if (isyn) {
                        reload_tikzPGFjson();
                    }
                }
            });
            // 长按事件
            btns[i].addEventListener("mousedown", function () {
                let timer;
                timer = setTimeout(function () {
                    var result = confirm(`确定删除 ${item.tag} tag?`);
                    if (result) {
                        let ind = tikzPGFjson.indexOf(item);
                        let ind2 = tikzPGFjson_query_items.indexOf(item);

                        if (ind != -1) {
                            tikzPGFjson.splice(ind, 1);
                            tikzPGFjson_query_items.splice(ind2, 1);
                        }
                        reload_tikzPGFjson();
                    }
                }, 1000); // 这里设置长按的时间阈值，单位为毫秒
                btns[i].addEventListener("mouseup", function () {
                    clearTimeout(timer);
                });
            });
        }
    }
}


function reload_tikzPGFjson() {
    // 设置一个计数器
    var dom_dict = {}
    var isread_dict = {}
    // load tikzPGFjson
    for (var i = 0; i < tikzPGFjson.length; i++) {
        let item = tikzPGFjson[i]
        item['id'] = i;
        id_count = i;
        var themes = item['themes']
        var categorys = item['categorys']
        themes = (typeof themes == 'string') ? [themes] : themes;
        categorys = (typeof categorys == 'string') ? [categorys] : categorys;
        if (typeof themes == 'object' && themes != null) {
            for (var j = 0; j < themes.length; j++) {
                let theme = themes[j];
                let category = categorys[j];
                if (!(theme in dom_dict)) {
                    dom_dict[theme] = `<select class="maseeselect" title=${theme}>\n`;
                    dom_dict[theme] += `<option selected="" disabled="">${theme}</option>\n`
                    isread_dict[theme] = [];
                }
                if (!isread_dict[theme].includes(category)) {
                    dom_dict[theme] += `<option value="${i}">${category}</option>\n`;
                    isread_dict[theme].push(category);
                }
            }
        }
    };
    var c = "";
    for (var key in dom_dict) {
        c += `${dom_dict[key]}</select>\n`;
    };
    const selModal = pgfplot_div.querySelector(".modal-title.tool.select")
    selModal.innerHTML = c;
    const selElements = selModal.querySelectorAll('select')
    selElements.forEach(function (sel) {
        sel.addEventListener('change', function () {
            k1 = sel.options[0].text;
            k2 = sel.options[sel.selectedIndex].text;
            sel.selectedIndex = 0;
            pgfplot_div.querySelector(`#latex-macro-search`).value = `${k2}`;
            query_tikzPGFjson_with_k1k2(k1, k2);
            display_tag_items(tikzPGFjson_query_items);
        });
    });
    display_tag_items(tikzPGFjson_query_items);
}


// 初始化生成基本页面, 
function gen_base_plane() {
    var inhtml = `
<div class="modal-header tool">
    <i class="fa fa-bars fa-fw" ></i> 
    <div id ='searchtype' class="modal-title tool seasel">
        <input spellcheck="false" aria-label="Search" placeholder="Search…" type="search" id="latex-macro-search" class="symbol-palette-search" value="">
        <div class="modal-title tool select"></div>
    </div>
</div>

<div class="modal-body tagHere"></div>


<div style="display:flex;margin-top:5pt;">
    <div class="modal-body exampleHere">
        <div class="code macro example" >
        <pre contenteditable="false" spellcheck="false"></pre>
        </div>
    </div>

    <div class="modal-body macroHere">
        <div class="code macro here">
            <pre contenteditable="false" spellcheck="false"></pre>
        </div>
    </div>
</div>
    `
    // 取得菜单中的 PGFplot div
    pgfplot_div = window.meun['TikZ-PGF']
    pgfplot_div.innerHTML = inhtml

    // macro example 与 macro here 的点击事件
    var css = 'div.code.macro.example pre'
    macro_example = pgfplot_div.querySelector(css)

    css = 'div.code.macro.here pre'
    macro_code = pgfplot_div.querySelector(css)

    // 添加 macro 示例与 macro 的点击事件
    const preElements = document.querySelectorAll('div.code.macro pre')
    preElements.forEach(function (pre) {
        // 双点击时
        pre.addEventListener('dblclick', function (event) {
            window.copyToClipboard(pre.textContent)
        })
        // 添加 ctrl 点击事件 ,进入编译文本模式
        pre.addEventListener('click', function (event) {
            if (event.ctrlKey) { pre.contentEditable = true }
        })
        // 添加保存 ctrl+s 事件
        pre.addEventListener('keydown', function (event) {
            // 检查是否同时按下了 Ctrl 键和 S 键
            if (event.ctrlKey && event.key === 's') {
                // 阻止默认的保存行为
                event.preventDefault()
                pre.contentEditable = false
                var isyn = confirm("是否保存修改")
                if (isyn) {
                    mark_tagitem.example = macro_example.textContent
                    mark_tagitem.macro = macro_code.textContent
                    isyn = confirm("是否重载 TikZ-PGF?")
                    if (isyn) {
                        reload_tikzPGFjson()
                    }
                }
            }
        })
    });


    //搜索框事件
    var search = pgfplot_div.querySelector("input#latex-macro-search");
    search.addEventListener("input", handleInputChange);
    function handleInputChange(event) {
        query_tikzPGFjson_with_text(event.target.value);
        display_tag_items(tikzPGFjson_query_items);
    };


}





gen_base_plane()
reload_tikzPGFjson()
