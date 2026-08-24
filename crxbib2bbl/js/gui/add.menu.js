
var meun_list = ['home', 's2t', 'bib2bbl', 'TikZ-PGF', 'colorlib']

var toolmeun = document.createElement('div');
toolmeun.className = 'toolbar toolbar-editor ng-scope meun'
toolmeun.style.backgroundColor = '#E7E9EE';

var meun_label = ``
for (let i = 0; i < meun_list.length; i++) {
    meun_label += `
    <label class="toggle-switch-label">
        <span class="meun ${meun_list[i]}">${meun_list[i]}</span>
    </label>
`
}
toolmeun.innerHTML = `
<div class="toggle-wrapper">
    <div class="editor-toggle-switch">
        <fieldset class="toggle-switch">
            ${meun_label}
        </fieldset>
    </div>
</div>
`









// 插入到指定位置
var aside = document.querySelector("#texAide");
if (aside) {
    aside.parentNode.insertBefore(toolmeun, aside.parentNode.childNodes[0]);
}



// 切换开关
var meun_tog_dic = {}
// 容器
var meun_div_dic = {}

// 创建 switch 对应容器
for (let i = 0; i < meun_list.length; i++) {
    toolmeun = document.createElement('div');
    toolmeun.className = `must ${meun_list[i]}`;
    meun_div_dic[meun_list[i]] = toolmeun;
    aside.parentNode.insertBefore(toolmeun, aside.parentNode.childNodes[1]);
    // 保存开关对象
    meun_tog_dic[meun_list[i]] = document.querySelector('.meun.' + meun_list[i]);
    // 注册 click 事件
    meun_tog_dic[meun_list[i]].addEventListener('click', active_tog);
}

window.meun = meun_div_dic;





// 点不同 label 时,触以事件
var tog_active = 'TikZ-PGF';
act_style(tog_active);

function unact_style(meun_name) {
    let tog = meun_tog_dic[meun_name];
    tog.style.backgroundColor = '#E7E9EE';
    tog.style.color = '#495365';
    meun_div_dic[meun_name].style.display = 'none';
    if (meun_name == 'chat') {
        aside.style.display = 'none';
    }
}
function act_style(meun_name) {
    let tog = meun_tog_dic[meun_name];
    tog.style.backgroundColor = '#138A07';
    tog.style.color = '#FFF';
    meun_div_dic[meun_name].style.display = 'block';
    if (meun_name == 'chat') {
        aside.style.display = 'block';
    }
}

function active_tog() {
    let e = window.event;
    let target = e.target.textContent;
    unact_style(tog_active);
    act_style(target);
    tog_active = target;
}








