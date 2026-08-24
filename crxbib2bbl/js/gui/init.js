var init = document.createElement('div');
init.id = 'init';
init.innerHTML = `
<div id = "texAide" style="display:flex">
<div class="mustesc">隐藏面板: 按 Esc /或/ 鼠标左右两侧移出 </div>
<div class="mustinfo"> Ctrl+ Q: 呼出/隐藏;  | 双击绿 code 时将自动复制; </div>
</div>`
document.body.appendChild(init);

var tolgo = document.createElement('div');
tolgo.id = 'tolgo';
tolgo.className = "togshow";
tolgo.innerHTML = `
<i class="fa fa-bars fa-fw editor-menu-icon"></i>&nbsp<span class="latexapp" style="color:white;">texAide (Ctrl + Q) </span>
`
document.body.appendChild(tolgo);






function switch_ani() {
    if (init.className == "initshow") {
        init.className = "inithiden";
        tolgo.className = "togshow";
    } else {
        init.className = "initshow";
        tolgo.className = "toghiden";
    }
}




function tolgo_ani() {
    if (tolgo.className == "togshow") {
        tolgo.className = "toghiden";
    } else {
        tolgo.className = "togshow";
    }
}




tolgo.addEventListener('click', function () {
    tolgo.className = "toghiden";
    init.className = "initshow";
    var input = document.getElementById('latex-macro-search');
    if (input) {
        if (init.className == "initshow") {
            input.focus();
            input.select();
        };
    }
});




document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && (event.key === 'q' || event.key === '`')) {
        switch_ani();
        var input = document.getElementById('latex-macro-search');
        if (input) {
            if (init.className == "initshow") {
                input.focus();
                input.select();
            };
        }
    }
});
// 判断是否按下esc通出
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        if (init.className == "initshow") {
            init.className = "inithiden";
            tolgo.className = "togshow";
        }
    }
}
);


var esc = document.querySelector('.mustesc');
//在容器时的方法
esc.addEventListener('mouseleave', function () {
    if (init.className == "initshow") {
        init.className = "inithiden";
        tolgo.className = "togshow";
    }
});

//在容器时的方法
init.addEventListener('mouseleave', function (event) {
    var mouseX = event.clientX;
    var windowWidth = window.innerWidth;
    if (mouseX < windowWidth * 0.07 || mouseX > windowWidth * 0.93) {
        if (init.className == "initshow") {
            init.className = "inithiden";
            tolgo.className = "togshow";
        }
    }
});




// init.addEventListener("mousedown", function (event) {
//     isMouseDown = true;
//     initialY = event.clientY;
//     offsetY = init.offsetTop;

// });

// init.addEventListener("mouseup", function () {
//     isMouseDown = false;
// });



// init.addEventListener("mousemove", function (event) {
//     if (isMouseDown && event.clientX < 100) {
//         var deltaY = event.clientY - initialY;
//         var newY = offsetY + deltaY;
//         var windowHeight = window.innerHeight;
//         var containerHeight = init.offsetHeight;
//         // 限制容器的上边界
//         if (newY < 0) {
//             newY = 0;
//         }
//         // 限制容器的下边界
//         if (newY + containerHeight > windowHeight) {
//             newY = windowHeight - containerHeight;
//         }
//         init.style.top = newY + "px";
//     }

// });


// init.addEventListener('mouseenter', function (event) {

//     var mouseX = event.clientX;
//     var windowWidth = window.innerWidth;
//     if (mouseX > windowWidth * 0.96) {
//         init.className = "reverse-animation";
//     }
// }
// );



