

var bib2bbl_div = window.meun['bib2bbl'];
bib2bbl_div.innerHTML = `
<div class="modal-header tool">
<div class="modal-title tool"><i class="fa fa-bars fa-fw" ></i> </div>
    <div class="modal-title tool ">
        bib2bbl
    </div>
</div>

<div class="modal-header">           
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


document.getElementById("copybib").addEventListener('click', copyfbib);


document.getElementById("copybbl").addEventListener('click', copyfbbl);


document.getElementById("copycitekeys").addEventListener('click', copyfcitekeys);


document.getElementById("copyclear").addEventListener('click', clearbibbbl);


// document.getElementById("copyclearbibbbl").addEventListener('click', clearbibbbl);



document.getElementById("recitekeys").addEventListener('click', function () {
    processText(1);
});



