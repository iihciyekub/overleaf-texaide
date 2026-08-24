// ver 0.23.04.22

const BIB = {
    'article': {
        'N': ['author', 'year', 'title', 'journal'],
        'UN': ['volume', 'number', 'pages', 'month', 'doi', 'note', "url"],
        'UQ': []
    },
    'conference': {
        'N': ['author', 'year', 'title', 'booktitle'],
        'UN': ['editor', 'edition', 'volume', 'number', 'series', 'pages', 'address', 'month', 'organization', 'publisher', 'note', "url"],
        'UQ': ['volume/number']
    },
    'inproceedings': {
        'N': ['author', 'year', 'title', 'booktitle'],
        'UN': ['editor', 'edition', 'volume', 'number', 'series', 'pages', 'address', 'month', 'organization', 'publisher', 'note', "url"],
        'UQ': ['volume/number']
    },
    'proceedings': {
        'N': ['title', 'year', 'editor'],
        'UN': ['volume', 'edition', 'number', 'series', 'address', 'month', 'organization', 'publisher', 'note', "url"],
        'UQ': ['volume/number']
    },
    'book': {
        'N': ['author', 'title', 'publisher', 'year'],
        'UN': ['volume', 'number', 'series', 'address', 'edition', 'month', 'note', "url"],
        'UQ': ['volume/number']
    },
    'booklet': {
        'N': ['title'],
        'UN': ['author', 'howpublished', 'address', 'month', 'year', 'note', "url"],
        'UQ': []
    },
    'inbook': {
        'N': ['author', 'title', 'chapter', 'pages', 'publisher', 'year'],
        'UN': ['volume', 'number', 'series', 'type', 'address', 'edition', 'month', 'note', "url"],
        'UQ': ['volume/number', 'chapter/pages']
    },
    'incollection': {
        'N': ['author', 'title', 'booktitle', 'publisher', 'year'],
        'UN': ['editor', 'volume', 'number', 'series', 'type', 'chapter', 'pages', 'address', 'edition', 'month', 'note', "url"],
        'UQ': ['volume/number']
    },
    'mastersthesis': {
        'N': ['author', 'title', 'year', 'school'],
        'UN': ['edition', 'address', 'month', 'keywords', 'note', "url"],
        'UQ': []
    },
    'phdthesis': {
        'N': ['author', 'title', 'year', 'school'],
        'UN': ['edition', 'address', 'month', 'keywords', 'note', "url"],
        'UQ': []
    },
    'manual': {
        'N': ['title'], 'UN': ['author', 'organization', 'address', 'edition', 'month', 'year', 'note', "url"],
        'UQ': []
    },
    'techreport': {
        'N': ['author', 'title', 'institution', 'year'],
        'UN': ['type', 'number', 'address', 'month', 'note', "url"],
        'UQ': []
    },
    'unpublished': {
        'N': ['author', 'title', 'note'],
        'UN': ['month', 'year', "url"],
        'UQ': []
    },
    'misc': {
        'N': [],
        'UN': ['author', 'title', 'howpublished', 'month', 'year', 'note', "url"],
        'UQ': []
    }
}

class itex {
    constructor(text) {
        this.orgT = text;
        this.T = this.__clear(text);
    };

    __clear(text) {
        text = text.trim()
        let CharList = ['.', '。', '，', ',', '、', '；', ';', '：', ':', '？', '?', '！', '!', '=', '-', '+', '*', '&', '^', '%', '$', '#', '@', '~', '`', '|'];
        // 循环判断 变量 t 的最后一个字符是否在 CharList 中
        while (CharList.indexOf(text.slice(-1)) > -1) {
            text = text.slice(0, -1);
        }

        while (CharList.indexOf(text[0]) > -1) {
            text = text.slice(1,);
        }

        let t = text;
        let r = /[\u4e00-\u9fa5]/g;
        if (r.test(text)) {
            t = t.replace(/([\u4e00-\u9fa5 ，。？！；：“”‘’《》【】（）])\s+([\u4e00-\u9fa5 ，。？！；：“”‘’《》【】（）])/g, "$1$2");
            while (t != text) {
                text = t;
                t = t.replace(/([\u4e00-\u9fa5 ，。？！；：“”‘’《》【】（）])\s+([\u4e00-\u9fa5 ，。？！；：“”‘’《》【】（）])/g, "$1$2");
            }
        }
        return text;
    }

    get T() {
        return this._T;
    }

    set T(text) {
        if (!this.hasOwnProperty("_T")) {
            this._T = ""
        }
        if (!this.hasOwnProperty("_listT")) {
            this._listT = ['']
        }

        let i = this._listT.indexOf(this._T);
        if (i > -1) {
            this._listT[i] = text;
        }
        this._T = text;
    }

    get language() {
        if (!this.hasOwnProperty("_language")) {
            this._language = ''
            if (/^[\u4e00-\u9fa5]/.test(this.T)) {
                this._language = 'zh';
            } else {
                this._language = 'en';
            }
        }
        return this._language
    }

    set language(v) {
        this._language = v;

    }

    _insert(f, b, T = this.T, _listT = this._listT) {
        //遍历 [a,1,] 数组,打印 数组元素的值和下标
        for (let k of f) {
            let i = _listT.indexOf(T);
            if (_listT.indexOf(k) > -1) {
                continue;
            }
            _listT.splice(i, 0, k);
        }
        for (let k of b) {
            let i = _listT.indexOf(T);
            if (_listT.indexOf(k) > -1) {
                continue;
            }
            _listT.splice(i + 1, 0, k);
        }
        return _listT;
    }

    /**
     * 获取最终输出的文本
     */
    get macro() {
        this.T = ` ${this.T}`
        return this._listT.join("");
    }

    get str() {
        return this.T;
    }


    get Title() {
        const commonWords = ["a", "an", "and", "but", "or", "for", "nor", "on", "in", "at", "to", "from", "by", "with", "about", "above", "across", "after", "against", "along", "among", "around", "before", "behind", "below", "beneath", "beside", "between", "beyond", "during", "except", "inside", "into", "like", "near", "of", "off", "out", "over", "past", "since", "through", "throughout", "till", "toward", "under", "until", "up", "upon", "via", "without"];

        let _listT = this._listT;
        let T = this.T;
        let k = _listT.indexOf(T)
        if (k > -1) {
            let i = _listT[k];
            // i = i.toLowerCase();
            //将i 按照空格进行分割,如果元素不在 commonwords 数组中,则不进行首字母大写替换
            i = i.replace(/\b(\w+)\b/g, function (m, p1) {
                //判断 如果 i 全部都为大写时,则不进行首字母大写替换
                if (p1.toUpperCase() == p1) {
                    return p1;
                }
                if (commonWords.indexOf(p1.toLowerCase()) > -1) {
                    return p1;
                } else {
                    return p1.replace(/(^\s*)(\w)/, function (m, p1, p2) {
                        return p1 + p2.toUpperCase();
                    });
                }
            });
            // update value
            this.T = i;
            this._listT[k] = i;

        }
        return this;
    }

    /**
     * 首字母大写   
     */
    get title() {
        let _listT = this._listT;
        let T = this.T;

        let k = _listT.indexOf(T)
        if (k > -1) {
            let i = _listT[k];

            //将i 按照空格进行分割,仅仅第一个元素首字母大写, 第二个元素之后,如果元素全为大写并不处理,否则将元素转为字母小写
            // 将句子按空格分割为数组
            let words = i.split(" ");

            // 将第一个单词的首字母大写，其余单词转为小写
            let result = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
            for (let j = 1; j < words.length; j++) {
                if (words[j] === words[j].toUpperCase()) {
                    // 如果单词全为大写，则不进行处理
                    result += " " + words[j];
                } else {
                    // 将单词转为小写
                    result += " " + words[j].toLowerCase();
                }
            }
            // update value
            this.T = result;
            this._listT[k] = result;
        }
        return this;
    }

    // /**
    //  * 斜体
    //  */
    get italic() {
        this._listT = this._insert(["{", "\\em"], ["}"]);
        return this;
    }

    /**
     * 粗体
     */
    get bold() {
        let value = this.T;

        value = value.replace(/([a-zA-Z]+)/g, function (match, p1, offset, string) {
            return `{\\em ${p1}}`;
        });
        this.T = value;
        this._listT = this._insert(["{", "\\bfseries"], ["}"]);
        return this;
    }

    /**
     * 圆括号
     */
    get cirBrackets() {
        let t = this.T;
        t = (this.language == 'zh') ? `（${t}）` : `(${t})`;
        this.T = t;
        return this;
    }

    /*
     * 方括号
     */
    get squBrackets() {
        let t = this.T;
        t = (this.language == 'zh') ? `〔${t}〕` : `[${t}]`;
        this.T = t;
        return this;
    }

    get clear() {
        //如果变量t中 存在非 \& 的 & 符号,则将其替换为 \&
        let t = this.T;
        t = t.replace(/(?<!\\)&/g, '\\&');
        t = t.replace(/(?<!\\)%/g, '\\%');
        t = t.replace(/(?<!\\)_/g, '\\_');
        this.T = t;
        return this;

    }

    get url() {
        let t = this.T;
        // 对 t 两边去空格
        t = t.trim();

        // 使用 正则表达式 在t 中匹配https开头,连续的字符串,空格或换行 结束的字符串 
        if (t.indexOf('\\url') > -1) {
            return this;
        }
        let url = t.split(" ")
        url = url.filter((v) => {
            return v != "";
        })
        //如果url 元素包含http或https,则将其替换为 \url{网址}
        url = url.map((v) => {
            if (v.indexOf('http://') > -1 || v.indexOf('https://') > -1) {
                return `\\url{${v}}`;
            } else {
                return v;
            }
        })
        // 将url 数组转换为字符串
        t = url.join(" ");
        this.T = t;
        return this;
    }

}

class idate extends itex {
    constructor(text) {
        super(text);
        this.month_dict = {
            "1": 'January',
            "2": 'February',
            "3": 'March',
            "4": 'April',
            "5": 'May',
            "6": 'June',
            "7": 'July',
            "8": 'August',
            "9": 'September',
            "10": 'October',
            "11": 'November',
            "12": 'December'
            //nbrylgptvc
        };

        // 创建月份英文单词的简写字典
        this.month_dict_abbr = {};
        for (let k in this.month_dict) {
            let v = this.month_dict[k];
            this.month_dict_abbr[k] = v.slice(0, 3);
            if (k == 9) {
                this.month_dict_abbr[k] = v.slice(0, 4);
            }
        };
    }

    get date() {
        let dai = this.orgT.trim();
        var year = '';
        var month = '';
        var day = '';
        var endday = '';
        let r = /(?<year>[12]\d{3})/;
        let a = r.exec(dai);
        if (a != null) {
            year = a.groups.year
            dai = dai.replace(year, '');
            r = /(?<month>[jfmasond][aepuco][nbrylgptvc])/i;
            a = r.exec(dai);
            if (a != null) {
                month = a.groups.month;
                dai = dai.replace(month, '');
                month = month.slice(0, 3);
                month = Object.keys(this.month_dict_abbr).find(key => this.month_dict_abbr[key] === month);
            } else {
                r = /(?<month>\d{1,2})/i;
                a = r.exec(dai);
                if (a != null) {
                    month = a.groups.month;
                    dai = dai.replace(month, '');
                }
            }

            r = /(?<day>\d{1,2})/i;
            a = r.exec(dai);
            if (a != null) {
                day = a.groups.day;
                dai = dai.replace(day, '');
            }

            r = /(?<endday>\d{1,2})/i;
            a = r.exec(dai);
            if (a != null) {
                endday = a.groups.endday;
                dai = dai.replace(endday, '');
            }

            if (month > 12) {
                [month, day, endday] = [month, day, endday].sort((a, b) => a - b);
                [day, endday] = [day, endday].sort((a, b) => a - b);
            }
            dai = [year, month, day, endday].filter((v) => v != '').join('-');
        }
        this._year = year;
        this._month = month;
        this._day = day;
        this._endday = endday;

        this.T = dai;
        return this;
    }

    get year() {
        if (!this.hasOwnProperty('_year')) {
            this.date;
        }
        this.T = this._year;
        return this
    }

    get month() {
        if (!this.hasOwnProperty('_year')) {
            this.date;
        }
        this.T = this._month;
        return this

    }

    get month_abbr() {
        if (!this.hasOwnProperty('_month')) {
            this.date;
        }
        let mon = this._month;
        mon = this.month_dict_abbr[mon];
        if (mon == undefined) {
            mon = "";
        }
        this.T = mon;
        return this;
    }

    get month_full() {
        if (!this.hasOwnProperty('_month')) {
            this.date;
        }
        let mon = this._month;
        mon = this.month_dict[mon];
        if (mon == undefined) {
            mon = "";
        }
        this.T = mon;
        return this;
    }

    get day() {
        this.date;
        this.T = this._day;
        return this
    }

    get endday() {
        this.date;
        this.T = this._endday;
        return this
    }

    get date_zh() {
        if (!this.hasOwnProperty('_year')) {
            this.date;
        }
        if (this._year != "") {
            var y = this._year
        };
        if (this._month != "") {
            y += "年"
            var m = this._month + "月"
        };
        if (this._endday != "") {
            var d = this._day
            var ed = this._endday + "日"
            d = d + "至" + ed
        } else if (this._day != "") {
            var d = this._day + "日"
        };
        this.T = [y, m, d].join("");

        // let y = this._year;
        // let m = this.month.str;
        // let d = this._day;
        // let ed = this._endday;
        // // console.log(y, m, d, ed);
        // let t1 = [y, m].filter((i) => i != "").join("年");
        // let t2 = [d, ed].filter((i) => i != "").join("至");
        // let t = [t1, t2].filter((i) => i != "").join("");
        // this.T = t;
        return this;
    }

    get date_en_abbr() {
        if (!this.hasOwnProperty('_year')) {
            this.date;
        }

        let y = this._year;
        let m = this.month_abbr.str;
        let d = this._day;
        let ed = this._endday;

        let t1 = [y, m].filter((i) => i != "").join(", ");
        let t2 = [d, ed].filter((i) => i != "").join("-");
        let t = [t1, t2].filter((i) => i != "").join(". ");

        this.T = t;
        return this;
    }

    get date_en_full() {
        if (!this.hasOwnProperty('_year')) {
            this.date;
        }

        let y = this._year;
        let m = this.month_full.str;
        let d = this._day;
        let ed = this._endday;

        let t1 = [y, m].filter((i) => i != "").join(", ");
        let t2 = [d, ed].filter((i) => i != "").join("-");
        let t = [t1, t2].filter((i) => i != "").join(" ");

        this.T = t;

        return this;
    }

}

class iname extends itex {
    constructor(text) {
        super(text);
    }

    get language() {
        if (this.hasOwnProperty("_language")) { return this["_language"]; }
        this._language = ''
        let t = this.T;
        t = t.match(/[\u4e00-\u9fa5]/) ? 'zh' : 'en';
        this["_language"] = t;
        return this["_language"];
    }

    set language(lang) {
        this["_language"] = lang;
    }

    __name_index(index) {
        this.__to_dict();
        let t_dic = this[`_name_dict`];

        if (Object.keys(t_dic).length == 0) { return "" };

        let ind = Number(index);
        if (isNaN(ind)) {
            ind = 0
        }
        let fn = t_dic[ind]['first'];
        let on = t_dic[ind]['others'];

        let t = fn[0].match(/[\u4e00-\u9fa5]/) ? 'zh' : 'en';
        if (t == 'zh') {
            t = fn + on

        } else if (t == 'en') {
            t = fn;
            if (t[0].indexOf("-") != -1) {
                t = t[0].split("-")[0];
            } else {
                t = fn.join("")
            }
        }
        return t
    }

    index(index = 0) {
        let t = this.__name_index(index);
        if (t == "") { return "" }
        return t;
    }

    /**
     * 中文则全名拼音,英文名则姓
     */
    spell(index = 0) {
        let t = this.__name_index(index);
        if (t == "") { return "" }
        if (t.match(/[\u4e00-\u9fa5]/)) {
            t = t.slice(0, 3);
        }
        t = cnchar.spell(t)
        //使用正则表达式, 将t中的所有中文替换为X
        // t = t.toLowerCase()
        t = t.replace(/[\u4e00-\u9fa5]/g, "X");
        return t;
    }

    stroke(index = 0) {
        let t = this.__name_index(index);
        // 用正则表达式 匹配变量t 最前面的三个汉字
        t = t.match(/[\u4e00-\u9fa5]{1,3}/);
        if (t == null) { return "" }
        t = t[0];

        if (t == "") { return "99999999" }

        let lan = this.language;
        if (lan == 'zh') {
            // 变量t 是一个字符串,遍历
            let t_list = t.split("");
            t = t_list.map(x => {
                let y = cnchar.stroke(x, 'array');
                y = `${y}`
                if (y == 0) {
                    if (x.match(/[\u4e00-\u9fa5]/)) {
                        y = "99"
                    } else {
                        y = `${x}`
                    }
                }
                return y.padStart(2, '0')
            });
            t = t.join("").slice(0, 8).padEnd(8, '0');
        }
        // console.log(t)
        return t
    }

    __to_list() {
        let t_list = this.T;
        // let name = this.name;
        let fidld1 = `_name_list`
        let fidld2 = `_name_num`

        if (t_list[0] == '{' && t_list[t_list.length - 1] == '}') {
            // t_list = t_list.split('and').map(x => x.trim()).filter(x => x !== '');
            t_list = [t_list]
        } else {
            if (t_list.indexOf("\\&") > -1) {
                t_list = t_list.split('\\&').map(x => x.trim()).filter(x => x !== '');
            } else if (t_list.indexOf("\&") > -1) {
                t_list = t_list.split('\&').map(x => x.trim()).filter(x => x !== '');
            } else {
                t_list = t_list.split('and').map(x => x.trim()).filter(x => x !== '');
            }
        }
        this[fidld1] = t_list;
        this[fidld2] = t_list.length;
    }

    __cn_name_dict() {
        // let name = this.name;
        this.__to_list();

        let t_list = this[`_name_list`]
        let t_dic = {};
        t_list.forEach((n, index) => {
            if (n[0] == '{' && n[n.length - 1] == '}') {
                t_dic[index] = { 'first': [n.slice(1, -1)] };
                t_dic[index]['others'] = []
            } else {
                // 如果,符号   在作者名字中
                if (n.includes(",")) {
                    //,符号分割 ,去空格去除空元素
                    n = n.split(",").map(s => s.trim()).filter(s => s);
                    // 将第一个元素保存到 namedict[index]['first'] 中
                    t_dic[index] = { 'first': [n[0]] };
                    // 删除第一个元素
                    n.shift();
                    // 将剩余元素保存到 namedict[index]['others'] 中
                    t_dic[index]['others'] = n;
                } else {
                    n = n.trim().replace(" ", '');
                    if (n.length >= 4) {
                        //将前两个字符保存到 namedict[index]['first'] 中
                        t_dic[index] = { 'first': [n.slice(0, 2)] };
                        //将剩余字符保存到 namedict[index]['others'] 中
                        t_dic[index]['others'] = [n.slice(2)];
                    } else {
                        //将字符保存到 namedict[index]['first'] 中
                        t_dic[index] = { 'first': [n.slice(0, 1)] };
                        //将剩余字符保存到 namedict[index]['others'] 中
                        t_dic[index]['others'] = [n.slice(1)];
                    }
                }
            }
        });
        t_dic = Object.fromEntries(Object.entries(t_dic).sort());
        return t_dic;
    }

    __en_name_dict() {
        // let name = this.name;
        this.__to_list();
        let t_list = this[`_name_list`]
        let t_dic = {};
        t_list.forEach((n, index) => {
            // console.log(n, n.slice(1, -1))
            if (n[0] == '{' && n[n.length - 1] == '}') {
                t_dic[index] = { 'first': [n.slice(1, -1)] };
                t_dic[index]['others'] = []
            } else {
                if (n.includes(",")) {
                    // ,分割 author去空格,去除空元素
                    n = n.split(",").map(s => s.trim()).filter(s => s !== "");
                    // 将第一个元素保存到 namedict[index]['first'] 中
                    t_dic[index] = { 'first': [n[0].toLowerCase()] };
                    // 删除第一个元素
                    n.shift();
                } else {
                    // 被空格分割
                    n = n.split(" ").map(s => s.trim()).filter(s => s !== "");
                    // 将最一个元素保存到 namedict[index]['first'] 中
                    t_dic[index] = { 'first': [n[n.length - 1]] };
                    // 删除最后一个元素
                    n.pop();
                }
                n = n.join(" ");
                n = n.split(" ").map(s => s.trim()).filter(s => s).map(s => s.replace(".", ""));

                t_dic[index]['others'] = n;
            }
        });
        // 更新 t_dic,按key 排序
        t_dic = Object.fromEntries(Object.entries(t_dic).sort());

        return t_dic;
    }

    __to_dict() {
        // let name = this.name;
        let field = `_name_dict`;
        if (!this.hasOwnProperty(field)) {
            let lan = this.language;
            let v = ''
            if (lan == 'zh') {
                v = this.__cn_name_dict()
            } else if (lan == 'en') {
                v = this.__en_name_dict()
            }
            this[field] = v;
        }
        // return this[field];
    }

    _join_en_name(t_dic, k) {
        let [a, b] = ['', ''];
        // console.log(t_dic[k])
        a = t_dic[k]['first'].map(s => s.charAt(0).toUpperCase() + s.slice(1))
        a = a.filter(s => s !== "").join(" ");

        b = t_dic[k]['others'].map(s => s.charAt(0).toUpperCase() + '.')
        b = b.filter(s => s !== "").join(" ");
        a = [a, b].filter(s => s !== "").join(", ");
        return a;

    }

    /**
     *  apa 格式要求下的,作者 list, 
     */
    get apa_authors() {
        // this.name = 'author';
        // let name = this.name;
        let apaField = `_author_apa7`
        if (this.hasOwnProperty(apaField)) { return this[apaField] };
        this.__to_dict();
        let t_dic = this[`_name_dict`];
        if (Object.keys(t_dic).length == 0) { return "" };

        let lan = this.language;
        let num_name = this[`_name_num`]

        let v = "";
        let a = "";
        let apa_sty_name = [];

        if (lan == 'en') {
            for (let key in t_dic) {
                if (key == 0) {
                    a = this._join_en_name(t_dic, key)
                    apa_sty_name.push(a);
                };
                if (key >= 1 && key <= 19 && key < num_name - 1) {
                    a = this._join_en_name(t_dic, key)
                    apa_sty_name.push(a);
                };
                if (key != 0 && key == num_name - 1) {
                    a = this._join_en_name(t_dic, key)
                    apa_sty_name.push(`\\& ${a}`);
                };
                if (key == 20 && num_name >= 21) {
                    apa_sty_name.push(`,...`);
                };
            }
            v = apa_sty_name.join(", ");
        } else if (lan == 'zh') {
            for (let key in t_dic) {
                if (key == 0) {
                    a = t_dic[0]['first'].join("");
                    a += t_dic[0]['others'].join("");
                    apa_sty_name.push(a);
                };
                if (key >= 1 && key <= 19 && key < num_name - 1) {
                    //当key 大于20时
                    a = t_dic[key]['first'].join("");
                    a += t_dic[key]['others'].join("");
                    apa_sty_name.push(a);
                };
                if (key != 0 && key == num_name - 1) {
                    a = t_dic[num_name - 1]['first'].join("");
                    a += t_dic[num_name - 1]['others'].join("");
                    apa_sty_name.push(a);
                };
                if (key == 20 && num_name >= 21) {
                    apa_sty_name.push(`、……`);
                };
            };
            v = apa_sty_name.join("、");
        }
        this[apaField] = v;
        return this[apaField]
    }

    get apa_editors() {
        let apaField = `_editor_apa7`
        if (this.hasOwnProperty(apaField)) { return this[apaField] };
        this.__to_dict();
        let t_dic = this[`_name_dict`];
        if (Object.keys(t_dic).length == 0) { return "" };

        let lan = this.language;
        let a = "";

        if (lan == 'en') {
            a = this._join_en_name(t_dic, 0)
            a = `In ${a} (Ed.)`;
        } else if (lan == 'zh') {
            a = t_dic[0]['first'].join("");
            a += t_dic[0]['others'].join("");
            a = `在${a}（主编）`;
        }
        this[apaField] = a;
        return this[apaField]
    }

    get apa_chair() {
        let apaField = `_chairs_apa7`
        if (this.hasOwnProperty(apaField)) { return this[apaField] };
        this.__to_dict();
        let t_dic = this[`_name_dict`];
        if (Object.keys(t_dic).length == 0) { return "" };

        let lan = this.language;
        let a = "";

        if (lan == 'en') {
            a = this._join_en_name(t_dic, 0)
            a = `In ${a}(Ch.)`;
        } else if (lan == 'zh') {
            a = t_dic[0]['first'].join("");
            a += t_dic[0]['others'].join("");
            a = `在${a}（主持）`;
        }
        this[apaField] = a;
        return this[apaField]
    }

    /**
     * apa 格式要求下的,出现在段落中的作者引用,2024-04-21 停用
     */
    get back_apa_citeauthor() {
        let apaField = `_author_apa7`
        if (this.hasOwnProperty(apaField)) { return this[apaField] };
        this.__to_dict();
        let t_dic = this[`_name_dict`];
        // 判断t_dic 为空字典
        if (Object.keys(t_dic).length == 0) { return "" };

        let lan = this.language;
        let num_name = this[`_name_num`]

        let t = "";

        if (lan == 'en') {
            t += t_dic[0]['first'].map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
            if (num_name == 2) {
                t += ' \\& ';
                t += t_dic[1]['first'].map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
            } else if (num_name >= 3) {
                t += ' et al.';
            }
        } else if (lan == 'zh') {
            t += t_dic[0]['first'].join("");
            t += t_dic[0]['others'].join("");
            if (num_name == 2) {
                t += '與';
                t += t_dic[1]['first'].join("");
                t += t_dic[1]['others'].join("");
            } else if (num_name >= 3) {
                t += `等`;
            }
        }
        this[apaField] = t;
        return this[apaField]
    };

    /**
     * apa 格式要求下的,出现在段落中的作者引用,2024-04-21 启用
     */
    get apa_citeauthor() {
        let apaField = `_author_apa7`
        if (this.hasOwnProperty(apaField)) { return this[apaField] };
        this.__to_dict();
        let t_dic = this[`_name_dict`];
        // 判断t_dic 为空字典
        if (Object.keys(t_dic).length == 0) { return "" };

        let lan = this.language;
        let num_name = this[`_name_num`]
        let t = "";
        if (lan == 'en') {
            // 遍历 t_dic 字典
            for (let key in t_dic) {
                if (key == 0) {
                } else if (num_name ==2) {
                    t += ' \\& '
                } else if (num_name !=2 & key == num_name - 1) {
                    t += ', \\& '
                } else {
                    t += ", "
                }
                t += t_dic[key]['first'].map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
            }
        } else if (lan == 'zh') {
            for (let key in t_dic) {
                if (key == 0) {
                } else if (key == num_name - 1) {
                    t += '與'
                } else {
                    t += "、"
                }
                t += t_dic[key]['first'].join("") + t_dic[key]['others'].join("");
            }
        }
        this[apaField] = `{${t}}`;
        return this[apaField]
    }
}

class anybib {
    constructor(txt) {
        this.txt = txt;
        /**
         * 去空行和注释后的原始单个 bib 文本
         */
        this.f_txt = this.__fjoin(txt)
        txt = this.f_txt;

        let entry = this.entryType;
        //如果 entry 不在 BIB.key中
        if (BIB.hasOwnProperty(entry)) {
            let fileds = BIB[entry]['N'] + BIB[entry]['UN'];
            //遍历 BIB[entry]['N'] 所有的字段，并创建
            BIB[entry]['N'].forEach(f => {
                this[`org_${f}`] = '';
            });

            const key_value = [...txt.matchAll(/(\w+)\s*=\s*[{"'](.*)[}"']/g)].map(m => [m[1], m[2]]);
            key_value.forEach(([field, value]) => {
                field = field.toLowerCase().trim();
                value = value.trim();
                if (fileds.includes(field) && value != '') {
                    // 如果field 在 数组[note,authout]中则不需要处理
                    if (['note', 'url',].includes(field)) {
                        value = new itex(value);
                        value = value.url.str
                        this[`org_${field}`] = value;
                    } else {
                        value = new itex(value);
                        value = value.clear.str;
                        this[`org_${field}`] = value;
                    }
                }
            });
        }
    }

    /**
     * 对bib内容,进行去无意义行, 去%起始的行,等
     */
    __fjoin(t) {
        t = t.split('\n')
        t = t.filter(line => line.trim() !== '' && !line.trim().startsWith('%'));
        //遍历t 数据, 如果元素去两边空格后, 最后一个字符不是逗号, 则与下一个元素合并

        let b = {};
        let n = 0;
        for (let i = 0; i < t.length - 1; i++) {
            if (!Object.keys(b).includes(n.toString())) {
                b[n] = [t[i]]
            } else {
                b[n].push(t[i])
            }
            if (t[i].trim().endsWith(',')) {
                n += 1
            }
        }

        t = ''
        for (let i = 0; i < Object.keys(b).length; i++) {
            // b[i]元素去左边空格
            b[i] = b[i].map(x => x.trimLeft())
            let c = b[i].join('')
            // 去两边空格
            c = c.trim()
            c += '\n'
            t += c
        }
        return t;

    }

    get_field(field, a = 'apa7', o = 'org') {
        let apaField = `${a}_${field}`;
        let orgField = `${o}_${field}`;

        if (!Object.keys(this).includes(orgField)) { this[orgField] = ''; }
        if (!Object.keys(this).includes(apaField)) { this[apaField] = ''; }

        return [apaField, orgField];
    }

    /**
     * 只要 bib中有出现中文,则认为这是中文文献
     */
    get language() {
        let [apaField, _] = this.get_field('language', 'apa7', '');
        if (this[apaField] != '') { return this[apaField] };
        // let t = this.f_txt;
        let t = this.org_title + this.org_author
        t = t.match(/[\u4e00-\u9fa5]/) ? 'zh' : 'en';
        this[apaField] = t;
        return this[apaField];
    }

    /**
     * 获取 bib 的类型,如果不符合则会舍去
     */
    get entryType() {
        let [apaField, _] = this.get_field('entryType', 'apa7', '');
        if (this[apaField] != '') { return this[apaField] };

        let t = this.f_txt;
        t = t.match(/@(\w*\s*){/)[1];
        // t = t.trim();
        t = t.toLowerCase().trim();
        this[apaField] = t;
        return this[apaField];
    }

    /**
     * 获取 bib 的citekey
     */
    get citekey() {
        let [apaField, _] = this.get_field('citekey', '', '');
        if (this[apaField] != '') { return this[apaField] };

        let t = this.f_txt;
        try {
            t = t.match(/@.*?{(.*?),/)[1];
            t = t.trim();
            //去除 变量t 的所有空格
            t = t.replace(/\s+/g, '');
            // t = t.toLowerCase().trim();
        } catch (error) {
            t = '';
        }
        this[apaField] = t;
        return this[apaField];
    }

    set citekey(v) {
        let [apaField, _] = this.get_field('citekey', '', '');

        v = v.replace(/\s+/g, '');
        this[apaField] = v;
    }

    /**
     * 设置新的 citekeys
     * @parameter v {number} 1:作者名加年份; 
     */
    recitekeys(v) {
        switch (v) {
            case 1:
                this.__recitekeys_byAuthorYear();
                break;
            default:
                return ''
        }
    }

    __recitekeys_byAuthorYear() {
        let t = this.name_spell();
        if (t == '') {
            t = "undefined"
        }
        let year = this.year;
        year = new idate(year);
        year = year.year.str;
        if (year == "") { year = "9999" }
        t += year;
        if (!this.hasOwnProperty("_year_suffix")) {
            this.year_suffix = ""
        }
        t += this.year_suffix;
        // # 更新citekey
        this.citekey = t
        return this.citekey
    }

    get author() {
        let [_, orgField] = this.get_field('author');
        return this[orgField];
    }

    first_author(name = 'author') {
        let [apaField, _] = this.get_field('first_author_name', '', '');
        if (this[apaField] != '') { return this[apaField] };

        let author = this[name];
        if (author == '') { return "" }
        author = new iname(author);
        this[apaField] = author.index(0);
        return this[apaField];
    }

    /**
     * 获取中文作者的全名拼音, 英文作者的姓 ,用于生成 citeykeys
     */
    name_spell(index = 0, name = 'author') {

        let [apaField, _] = this.get_field('name_spell', '', '');
        if (this[apaField] != '') { return this[apaField] };

        let author = this[name];
        if (author == '') { return "" }
        author = new iname(author);
        this[apaField] = author.spell(0);
        return this[apaField];
    }

    name_stroke() {
        let [apaField, _] = this.get_field('first_name_stroke', '', '');
        if (this[apaField] != '') { return this[apaField] };

        let author = this.author;
        if (author == '') { return "" }
        author = new iname(author);
        this[apaField] = author.stroke(0);
        return this[apaField];
    }

    get apa_authors() {
        let [apaField, _] = this.get_field('authors', '', '');
        if (this[apaField] != '') { return this[apaField] };

        let author = this.author;
        if (author == '') { return "" }
        author = new iname(author);
        this[apaField] = author.apa_authors;
        return this[apaField];
    }

    /**
     * 出现文章段落中的 citetext
     */
    get apa_citetxt() {
        let [apaField, _] = this.get_field('citetxt', 'apa7', '');
        if (this[apaField] != '') { return this[apaField] };

        let citeauthor = this.author;
        if (citeauthor == '') {
            citeauthor = "undefined"
        } else {
            citeauthor = new iname(citeauthor);
            citeauthor = citeauthor.apa_citeauthor;
        }
        let year = this.year;
        year = new idate(year);
        year = year.year.str
        if (year == '') { year = this.year }
        let value = [citeauthor, year].join(', ')
        this[apaField] = value;
        return this[apaField];
    }

    __apa_citetxt_addsuffix(v) {
        let [apaField, _] = this.get_field('citetxt', 'apa7', '');
        let vaule = this[apaField];
        let year = vaule.match(/\d{4}/g)
        if (year != null) {
            year = year[0]
            vaule = vaule.replace(year, `${year}${v}`)
        } else {
            vaule += v;
        }
        this[apaField] = vaule;
    }

    get apa_title() {
        let [apaField, orgField] = this.get_field('title');
        let title = this[orgField];
        if (this[orgField] == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;
        let typelist = ['article', 'conference', 'incollection'];

        let value = new itex(title);
        if (language == 'zh') {
            // 如果this.entryType 出现在 lista ['book] 中
            if (!typelist.includes(entryType)) {
                value = value.clear.bold.macro
                // 使用正则表达式, 提取出连续的英文字符,并将其转换为大写
            } else {
                value = value.clear.str;
            }
        } else if (language == 'en') {
            if (!typelist.includes(entryType)) {
                value = value.clear.title.italic.macro;
            } else {
                value = value.clear.title.str;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_booktitle() {//"书名，论文集的名称或会议名称", 会议论文
        let [apaField, orgField] = this.get_field('booktitle');
        let booktitle = this[orgField];
        if (booktitle == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;
        let typelist = ['article', 'incollection'];
        let value = new itex(booktitle);
        if (language == 'zh') {
            // 如果this.entryType 出现在 lista ['book] 中
            if (typelist.includes(entryType)) {
                value = value.bold.macro
            } else {
                value = value.title.str;
            }
        } else if (language == 'en') {
            if (typelist.includes(entryType)) {
                value = value.title.italic.macro;
            } else {
                value = value.title.str;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_series() {
        let [apaField, orgField] = this.get_field('series');
        let series = this[orgField];
        if (series == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;
        let typelist = ['book', 'inbook', 'incollection', 'conference'];
        let value = new itex(series);
        if (language == 'zh') {
            // 如果this.entryType 出现在 lista ['book] 中
            if (typelist.includes(entryType)) {
                value = value.bold.macro
                if (this.apa_volume != '') {
                    value += this.org_volume + "卷";
                }

            } else {
                value = value.title.str;
            }
        } else if (language == 'en') {
            if (typelist.includes(entryType)) {
                value = value.title.italic.macro;
                if (this.apa_volume != '') {
                    value = "volume " + this.org_volume + " of " + value;
                }
            } else {
                value = value.title.str;
            }
        }

        this[apaField] = value;
        return this[apaField];
    }

    get apa_chapter() {//章节编号或标题
        let [apaField, orgField] = this.get_field('chapter');
        let chapter = this[orgField];
        if (chapter == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;
        let typelist = ['book', 'inbook'];
        let value = new itex(chapter);
        if (language == 'zh') {
            // 如果this.entryType 出现在 lista ['book] 中
            if (typelist.includes(entryType)) {
                value = value.title.str
                value += "章";

            } else {
                value = value.title.str;
            }
        } else if (language == 'en') {
            if (typelist.includes(entryType)) {
                value = "chapter " + value.title.str;
            }
        }

        this[apaField] = value;
        return this[apaField];
    }

    get year() {
        let [apaField, orgField] = this.get_field('year');
        let year = this[orgField];
        this[apaField] = this[orgField];
        let [mapaField, morgField] = this.get_field('month');

        if (this[morgField] != '') {
            year += ` - ${this[morgField]}`;
        }
        // 如果year 不为"" 
        if (this[orgField] != '') {
            //如果没有在year中匹配到4个数字
            if (year.match(/\d{4}/)) {
                let date_obj = new idate(year);
                let y = date_obj.year.str;
                let m = date_obj.month_full.str;
                let d = date_obj.day.str;
                let ed = date_obj.endday.str;

                this[orgField] = y;
                if (this[morgField] != '') {
                    // [m,d,ed] 排除元素=='' 的join
                    let ded = [d, ed].filter(x => x != '').join('-');
                    ded = [m, ded].filter(x => x != '').join(', ')
                    this[morgField] = ded;
                }
                this[apaField] = date_obj.date.str
                return this[orgField];
            }
        };

        let language = this.language;
        let value = ''
        let date_obj = new idate(year);
        value = date_obj.year.str;
        if (value == '') {
            if (language == 'zh') {
                value = `出版中`
            } else if (language == 'en') {
                value = "in press"
            }
        };
        this[orgField] = value
        return this[orgField];
    }

    /**
     * 格式化后的年份,比如 (2023) (2023年)...等
     */
    get apa_year() {
        let [apaField, _] = this.get_field('apayear', "", "");
        if (this[apaField] != '') { return this[apaField] };

        let year = this.year;
        year = this['apa7_year'];
        let language = this.language;
        let entryType = this.entryType;

        if (!year.match(/\d{4}/)) {
            if (language == 'zh') {
                return `（出版中）`
            } else if (language == 'en') {
                return "(in press)"
            }
        };

        let value = new idate(year);
        value.language = language;
        if (language == 'zh') {
            switch (entryType) {
                case 'misc':
                    value = value.date_zh.cirBrackets.str;
                    break;
                case 'conference':
                    value = value.date_zh.cirBrackets.str;
                    break;
                default:
                    value = value.date_zh.cirBrackets.str;
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                case 'misc':
                    value = value.date_en_full.cirBrackets.str;
                    break;
                case 'conference':
                    value = value.date_en_full.cirBrackets.str;
                    break;
                default:
                    value = value.date_en_full.cirBrackets.str;
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    __apa_year_addsuffix(v) {
        let [apaField, _] = this.get_field('apayear', "", "");
        let vaule = this.apa_year;
        let apayear = vaule.match(/\d{4}/g)
        if (apayear != null) {
            apayear = apayear[0]
            vaule = vaule.replace(apayear, `${apayear}${v}`)
        } else {
            vaule = vaule.slice(0, -1) + v + vaule.slice(-1);
        }
        this[apaField] = vaule
    }

    get year_suffix() {
        let [apaField, _] = this.get_field('year_suffix', '', '');
        if (this[apaField] != '') { return this[apaField] };

        return this[apaField]
    }

    set year_suffix(v) {
        let [apaField, _] = this.get_field('year_suffix', '', '');
        this[apaField] = v;
        this.__apa_year_addsuffix(v);
        this.__apa_citetxt_addsuffix(v);
    }

    get apa_journal() {
        let [apaField, orgField] = this.get_field('journal');
        let journal = this[orgField];
        if (journal == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;

        let value = new itex(journal);
        value.language = language;
        if (language == 'zh') {
            switch (entryType) {
                default:
                    value = value.title.bold.macro;
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    value = value.Title.italic.macro;
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_volume() {
        let [apaField, orgField] = this.get_field('volume');
        let volume = this[orgField];
        if (volume == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };


        let language = this.language;
        let entryType = this.entryType;


        let value = new itex(volume);
        value.language = language;

        if (language == 'zh') {
            switch (entryType) {
                default:
                    // value = value.italic.bold.macro 20240421停用
                    value = value.macro
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    // value = value.italic.macro
                    value = value.macro
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_number() {
        let [apaField, orgField] = this.get_field('number');
        let number = this[orgField];
        if (number == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;


        let value = new itex(number);
        value.language = language;

        if (language == 'zh') {
            switch (entryType) {
                default:
                    value = value.cirBrackets.str
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    value = value.cirBrackets.str
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_pages() { //页码
        let [apaField, orgField] = this.get_field('pages');
        let pages = this[orgField];
        if (pages == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;

        let typelist = ['book', 'inbook', 'incollection', 'conference'];
        let value = new itex(pages);

        //  如果pages 包含英文文,则不进行处理\
        if (pages.match(/[\u4e00-\u9fa5]/g) != null || pages.match(/[\u4e00-\u9fa5]/g) != null) {
            // if (pages.match(/[\u4e00-\u9fa5]/g) != null) { 

            // if (pages.match(/\d+/g) == null) {
            value.language = language;
            value = value.str;
        } else {
            if (language == 'zh') {
                // 如果this.entryType 出现在 lista ['book] 中
                if (typelist.includes(entryType)) {
                    value = `（頁 ${value.str}）`
                } else {
                    value = value.str;
                }
            } else if (language == 'en') {
                if (typelist.includes(entryType)) {
                    value = ` (pp.${value.str})`;
                } else {
                    value = value.str;
                }
            }

        }
        this[apaField] = value;
        return this[apaField]
    }

    get apa_doi() {//学术文献 DOI 
        let [apaField, orgField] = this.get_field('doi');
        let doi = this[orgField];
        if (doi == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        // 判断 "https://doi.org/" 是否存在 attr 字符中
        if (!doi.includes("https://")) { doi = `https://doi.org/${doi}`; }
        let value = `\\url{${doi}}`;
        this[apaField] = value;
        return this[apaField]
    }

    get apa_publisher() {//出版社
        let [apaField, orgField] = this.get_field('publisher');
        let publisher = this[orgField];
        if (publisher == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;

        publisher = new itex(publisher);

        if (language == 'zh') {
            switch (entryType) {
                default:
                    publisher = publisher.clear.str;
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    publisher = publisher.clear.Title.str;
                    break;
            }
        }

        this[apaField] = publisher;
        return this[apaField];
    }

    get apa_address() { // 地址
        let [apaField, orgField] = this.get_field('address');
        let address = this[orgField];
        if (address == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        this[apaField] = address;
        return this[apaField];
    }

    get editor() {
        let [_, orgField] = this.get_field('editor');
        return this[orgField];
    }

    get apa_editors() {
        let editor = this.editor;
        if (editor == '') { return "" }
        editor = new iname(editor);
        return editor.apa_editors;
    }

    get apa_chair() {
        let chair = this.editor;
        if (chair == '') { return "null" }
        chair = new iname(chair);
        return chair.apa_chair;
    }

    get apa_edition() {
        let [apaField, orgField] = this.get_field('edition');
        let edition = this[orgField];
        if (edition == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;

        let value = new itex(edition);
        value.language = this.language;

        if (language == 'en') {
            switch (entryType) {
                case 'misc':
                    value = value.str;
                    break;
                case 'conference':
                    value = value.squBrackets.str;
                    break;
                case 'inproceedings':
                    value = value.squBrackets.str;
                    break;
                case 'proceedings':
                    value = value.squBrackets.str;
                    break;
                case 'phdthesis':
                    value = value.squBrackets.str;
                    break;
                case 'mastersthesis':
                    value = value.squBrackets.str;
                    break;
                default:
                    value = value.cirBrackets.str
                    break;
            }
        } else if (language == 'zh') {
            switch (entryType) {
                case 'misc':
                    value = value.str;
                    break;
                case 'conference':
                    value = value.squBrackets.str;
                    break;
                case 'inproceedings':
                    value = value.squBrackets.str;
                    break;
                case 'proceedings':
                    value = value.squBrackets.str;
                    break;
                case 'phdthesis':
                    value = value.squBrackets.str;
                    break;
                case 'mastersthesis':
                    value = value.squBrackets.str;
                    break;
                default:
                    value = value.cirBrackets.str
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField];
    }

    get apa_howpublished() {
        let [apaField, orgField] = this.get_field('howpublished');
        let howpublished = this[orgField];
        if (howpublished == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        let language = this.language;
        let entryType = this.entryType;


        let value = new itex(howpublished);
        value.Language = this.language;

        if (language == 'zh') {
            switch (entryType) {
                default:
                    value = value.bold.str;
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    value = value.Title.italic.str;
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField];
    }

    get apa_institution() {
        let [apaField, orgField] = this.get_field('institution');
        let institution = this[orgField];
        if (institution == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        this[apaField] = institution;
        return this[apaField];

    }

    get apa_note() {
        let [apaField, orgField] = this.get_field('note');
        let note = this[orgField];
        if (note == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };
        note = new itex(note);
        note = note.str;
        this[apaField] = note;
        return this[apaField];
    }

    get apa_school() {
        let [apaField, orgField] = this.get_field('school');
        let school = this[orgField];
        if (school == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        this[apaField] = school;
        return this[apaField];
    }

    // organization
    get apa_organization() {
        let [apaField, orgField] = this.get_field('organization');
        let organization = this[orgField];
        if (organization == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };
        this[apaField] = organization;
        return this[apaField];
    }

    get apa_type() {// 会议报告类型
        let [apaField, orgField] = this.get_field('type');
        let type = this[orgField];
        if (type == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };
        let language = this.language;
        let entryType = this.entryType;

        let value = new itex(type);
        value.language = language;


        if (language == 'zh') {
            switch (entryType) {
                default:
                    value = value.cirBrackets.str
                    break;
            }
        } else if (language == 'en') {
            switch (entryType) {
                default:
                    value = value.cirBrackets.str
                    break;
            }
        }
        this[apaField] = value;
        return this[apaField];
    }

    get apa_url() {//普通 url
        let [apaField, orgField] = this.get_field('url');
        let url = this[orgField];
        if (url == '') { return '' };
        if (this[apaField] != '') { return this[apaField] };

        url = new itex(url);
        url = url.url.str;
        this[orgField] = url;
        let addf = `\\enfz `;
        this[apaField] = `{${addf} ${url}}`;
        return this[apaField];

    }

    // ----------------- 以下为辅助函数 -----------------
    f_output(tlist, f = ', ') {
        var b = '.';
        var t = '';
        if (this.language == 'zh') {
            switch (f) {
                case ', ':
                    f = '，';
                    break;
                case '. ':
                    f = '。';
                    break;
                case ': ':
                    f = '：';
                    break;
                case '; ':
                    f = '；';
                    break;
                case ' ':
                    f = '';
                    break;
                default:
                    f = '';
                    break;
            }
            b = '。';
        }
        // lsit 去掉值为 '' 的元素\
        tlist = tlist.filter((item) => item != '');
        if (tlist.every((item) => item == '')) { return '' };
        //
        t += '\n\\newblock ';
        t += tlist.join(f);
        t += b;
        return t;

    }

    // ----------------- 以下为输出函数 -----------------
    /**
    @article
    期刊杂志论文
    必要域: author, title, journal, year.
    可选域: volume, number, pages, month, note.
  
    @article{
        % 以下为必选域
        author={},
        title={},
        journal={},
        year={},
        % 以下为可选域
        volume={},
        number={},
        pages={},
        note={}
    }
    */
    get article() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title]);
        info += this.f_output([this.apa_journal, this.apa_volume + this.apa_number, this.apa_pages], ', ')
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    /**
    @book
    公开出版的图书
    必要域: author/editor, title, publisher, year.
    可选域: volume/number, series, address, edition, month, note.
  
    @book{
        % 以下为必选域
        author={},
        title={},
        publisher={},
        year={},
        % 以下为可选域
        volume={},
        series={},%书籍所属的系列名称或编号
        address={},
        edition={},
        month={},
        note={}
    }
    */
    get book() {// 出现在正文的引用文本+引用id,作者,年份,标题(出版版本),出版社, 
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title + this.apa_edition, this.apa_series], ', ');
        info += this.f_output([this.apa_address, this.apa_publisher], ': ');
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    /**
    @booklet
    无出版商或作者的图书
    必要域: title.
    可选域: author, howpublished, address, month, year, note.
    */
    get booklet() {
        console.log("unsopoorted type: booklet")
    }

    /**
    @inbook
    书籍的一部分章节
    必要域: author/editor, title, chapter and/or pages, publisher, year.
    可选域: volume/number, series, address, edition, month, note.
    @inbook{
        % 以下为必选域
        author={},
        title={},
        publisher={},
        chapter={},% 或 pages={},
        year={},
        % 以下为可选域
        volume={},
        series={},%书籍所属的系列名称或编号
        address={},
        edition={},
        note={}
    }
    */
    get inbook() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;

        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        if (this.org_chapter != '') {
            info += this.f_output([this.apa_title + this.apa_edition, this.apa_chapter, this.apa_series], ', ');
        } else {
            info += this.f_output([this.apa_title + this.apa_edition, this.apa_series, this.apa_pages], ', ');
        }

        info += this.f_output([this.apa_address, this.apa_publisher]);
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    /**
     * @incollection
    书籍中带独立标题的章节
    必要域: author, title, booktitle, publisher, year.
    可选域: editor, volume/number, series, chapter, pages, address, edition, month, note.
    @incollection{
        % 以下为必选域
        author={},
        title={},
        booktitle={},
        publisher={},
        year={},
        % 以下为可选域
        editor={},
        volume={},%或 number={},
        series={},%书籍所属的系列名称或编号
        chapter={},
        address={},
        edition={},
        note={}
    }
    */
    get incollection() {
        if (this.entryType != 'incollection') { return "" };

        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title, this.apa_series], ', ');
        info += this.f_output([this.apa_editors, this.apa_booktitle + this.apa_edition + this.apa_pages], ', ');
        info += this.f_output([this.apa_address, this.apa_publisher], ', ');
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    /**
     * @conference
   等价于 inproceedings
   必要域: author, title, booktitle, year.
   可选域: editor, volume/number, series, pages, address, month, organization, publisher, note.
     */
    get conference() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        if (this.apa_series == '') {
            info += this.f_output([this.apa_title + this.apa_edition]);
        } else {
            info += this.f_output([this.apa_title]);
            info += this.f_output([this.apa_chair, this.apa_series + this.apa_edition + this.apa_pages], ', ');
        }
        info += this.f_output([this.apa_booktitle, this.apa_address, this.apa_publisher,], ', ');
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    get inproceedings() {
        return this.conference;
    }

    /**
    @proceedings
    会议论文集
    必要域: title, year.
    可选域: editor, volume/number, series, address, month, organization, publisher, note.
    */
    get proceedings() {
        console.log("unsopoorted type: proceedings")
    }

    /**
    @phdthesis
    必要域: author, title, year, school.
    可选域: address, month, keywords, note.
    */
    get phdthesis() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title + this.apa_edition]);
        info += this.f_output([this.apa_address, this.apa_school], ", ");
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    get mastersthesis() {
        // let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        // info += this.f_output([this.apa_authors, this.apa_year], ' ')
        // info += this.f_output([this.apa_title + this.apa_edition]);
        // info += this.f_output([this.apa_address, this.apa_school], ", ");
        // info += this.f_output([this.apa_url]);
        // info += this.f_output([this.apa_note]);
        // info += "\n";
        return this.phdthesis()
    }

    /**
     * @manual
    技术文档
    必要域: title.
    可选域: author, organization, address, edition, month, year, note.
     */
    get manual() {
        console.log("unsopoorted type: manual")
    }

    /**
     * @techreport
    教育，商业机构的技术报告
    必要域: author, title, institution, year.
    可选域: type, number, address, month, note.
     */
    get techreport() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title + this.apa_number + this.apa_type]);
        info += this.f_output([this.apa_institution]);
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    /**
  *     @unpublished
    未出版的论文，图书
    必要域: author, title, note.
    可选域: month, year.
     */
    get unpublished() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title]);
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;
    }

    get misc() {
        let info = `\\bibitem[${this.apa_citetxt}]{${this.citekey}}`;
        info += this.f_output([this.apa_authors, this.apa_year], ' ')
        info += this.f_output([this.apa_title + this.apa_edition]);
        info += this.f_output([this.apa_journal, this.apa_howpublished, this.apa_volume, this.apa_number, this.apa_pages], ',')
        info += this.f_output([this.apa_url]);
        info += this.f_output([this.apa_note]);
        info += "\n";
        return info;

    }

    get output_bib() {
        // 遍历所有的属性，如果 包含''org 字符串，则保留
        let t = `@${this.entryType}{${this.citekey},\n`;
        let UN = BIB[this.entryType]['UN'];
        let NUN = BIB[this.entryType]['UN'] + BIB[this.entryType]['N'];

        for (let key in this) {
            if (key.includes('org_')) {
                //如果 key 在bib 中
                let k = key.replace('org_', '');
                if (!NUN.includes(k)) {
                    continue;
                }
                if (UN.includes(k) && this[key] == '') {
                    continue;
                }
                t += `    ${k} = {${this[key]}},\n`;
            }
        }
        t += '}\n';

        return t;
    }

    get output_bbl() {
        let t = '';
        switch (this.entryType) {
            case 'article':// article: 期刊或杂志上的文章
                return this.article;
            case 'book': // book: 书籍
                return this.book;
            case 'booklet':// booklet: 和book一样，但没有指定的出版商
                return this.booklet;
            case 'inbook':// inbook: 书中的一章或一节
                return this.inbook;
            case 'unpublished':// unpublished: 尚未正式出版的作品
                return this.unpublished;
            case 'manual':// manual: 技术手册
                return this.manual;
            case 'mastersthesis':// masterthesis: 硕士论文
                return this.phdthesis;
            case 'phdthesis':// phdthesis: 博士论文
                return this.phdthesis;
            case 'conference':// conference: 会议论文
                return this.conference;
            case 'inproceedings':// inproceedings: 会议论文与 conference 相同
                return this.conference;
            case 'incollection':// incollection: 论文集中的文章
                return this.incollection;
            case 'proceedings':// proceedings: 整个会议记录
                return this.proceedings;
            case 'techreport'://  techreport: 技术报告，政府报告或白皮书
                return this.techreport;
            case 'misc':// misc: 如果没有其他合适的可以使用，则使用 misc，比如网址，邮件等。
                return this.misc;
            case 'patent':// patent: 专利
                return this.misc;
            default:
                return "";
        }
    }
}

class read_bib {
    constructor(bibtxt) {
        // console.log(cn2hk('汉语，门槛'))
        bibtxt = cn2hk(bibtxt);
        this.bibtxt = bibtxt;
        this.citekey_list = [];
        this._recitekey = 0;
        this.sortby = 'must';
        // 简体 => 繁体
    }

    get recitekey() {
        return this._recitekey;
    }

    set recitekey(val) {
        this._recitekey = val;
    }

    get to_bbl() {
        return this.__bbl();
    }

    get to_bib() {
        return this.__bib();
    }

    get citekeys() {
        return this.citekey_list.join(", ")
    }

    get to_yearbib() {
        return this.__yearbib();
    }

    _formatbib(bibtxt) {
        // 计算元素出现在数组中多少次
        function countOccurrences(arr, val) {
            return arr.reduce((count, item) => {
                return count + (item === val);
            }, 0);
        }

        //分割bib txt,  以 @ 开头, 以 @ 结尾
        const at_pos = [...bibtxt.matchAll(/@/g)].map(m => m.index);
        let res = at_pos.map((pos, i) => bibtxt.slice(pos, at_pos[i + 1])).filter(x => x !== undefined);

        var bib_dict = {
            "en": {}, "zh": {}
        };

        let count_list = [];
        let inds = 'abcdefghijklmnopqrstuvwxyz'

        let duplicate = [];
        this.citekey_list = [];
        //遍历 res 
        for (let i = 0; i < res.length; i++) {
            // // 去除注释
            // var tembib = res[i].split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('%')).join('\n');
            var tembib = res[i];
            var t = new anybib(tembib);
            if (!BIB.hasOwnProperty(t.entryType)) {
                console.log(`${t.entryType}, 类型bibitem 不支持, 解析错误..`)
                continue;
            }

            //  通过 citetxt 加 title的方式 判断此 bib 已存入
            let citetxt = t.apa_citetxt;
            let title = t.apa_title;
            // 按 引用文本加标题判断是否重复, 如果重复, 则跳过
            if (duplicate.includes(citetxt + title)) {
                continue;
            }
            duplicate.push(citetxt + title);

            // 如果不需要重命名 citekey, 则将 citekey 保存到 list 中,方便后期汇总citekeys 输出

            var n = 0;
            var iauthor = t.author;
            iauthor = new iname(iauthor);
            var num = iauthor.stroke()
            var yearnum = t.year;
            if (isNaN(yearnum)) { yearnum = 9999; }
            var numj = `${num}${yearnum}0`
            var lan = t.language;

            if (bib_dict[lan][citetxt] == undefined) {
                t.year_suffix = "";
            } else {
                count_list.push(citetxt)
                n = countOccurrences(count_list, citetxt);
                let nn = inds[n]
                numj = `${num}${yearnum}${n}`
                // year_suffix set方法会更新与 year 相关的其它变量
                t.year_suffix = nn;
                //  如果this.recitekeys ==1 时,会按字母名+年份+重复标记的方式重命名 citekey
            }
            t.recitekeys(this.recitekey)
            bib_dict[lan][t.apa_citetxt] = [numj, t];
        }
        // count_list 去重
        count_list = [...new Set(count_list)]
        // count_list 为空
        if (count_list.length != 0) {
            // 遍历 count_list, 如果元素在biblist['zh']的key中, 则是取出值,并删除
            for (let i = 0; i < count_list.length; i++) {
                let lan = ""

                if (count_list[i] in bib_dict['zh']) {
                    lan = 'zh'
                } else {
                    lan = 'en'
                }
                let tem = bib_dict[lan][count_list[i]]
                tem[1].year_suffix = 'a';
                tem[1].recitekeys(this.recitekey)
                bib_dict[lan][tem[1].apa_citetxt] = [tem[0], tem[1]]
                delete bib_dict[lan][count_list[i]]
            }
        }

        //取出bib_dict['zh'] 下的所有值,并排序
        let zhcitekeys = Object.values(bib_dict['zh']).map(s => s[1].citekey)
        let encitekeys = Object.values(bib_dict['en']).map(s => s[1].citekey)

        //zhcitekeys encitekeys 两个数组的所有元素添加到 this.citekey_list 中
        this.citekey_list = this.citekey_list.concat(zhcitekeys, encitekeys)

        this.bib_dict = bib_dict;
        // 输出 bib_dict en 有多少个元素
        this.numofzhbib = Object.keys(bib_dict['zh']).length;
        this.numofenbib = Object.keys(bib_dict['en']).length;
        return bib_dict;
    }

    __sort_must() {
        let bib_dict = this.bib_dict;
        let biblist_zh = '';
        let biblist_en = '';

        // biblist_zh  biblist_en 为数组
        biblist_zh = Object.entries(bib_dict['zh']).sort((a, b) => a[1][0] - b[1][0]).map(x => x[1][1])

        // 按字典 bib_dict['en'] 的值第二个元素的 apa7_citetxt 属性排序
        biblist_en = Object.entries(bib_dict['en']).sort((a, b) => a[1][1].apa7_citetxt.localeCompare(b[1][1].apa7_citetxt)).map(x => x[1][1])

        return [biblist_zh, biblist_en]
    }

    __sort_year() {
        let bib_dict = this.bib_dict;
        // biblist['zh'] 与 biblist['en']  合并
        let biblist_all = Object.assign(bib_dict['zh'], bib_dict['en'])
        // biblist_all 取出所值的第三个元素
        let biblist_all_values = Object.values(biblist_all).map(x => x[1])
        // 遍历 biblist_all_values 的元素
        let biblist_all_values_sort = biblist_all_values.sort((a, b) => {
            // 如果 a.year 与 b.year 都是数字, 则按照数字排序
            if (!isNaN(a.year) && !isNaN(b.year)) {
                return b.year - a.year
            }
            // 如果 a.year 与 b.year 都不是数字, 则按照字符串排序
            if (isNaN(a.year) && isNaN(b.year)) {
                return a.year.localeCompare(b.year)
            }
            // 如果 a.year 是数字, b.year 不是数字, 则 a.year 排在 b.year 的后面
            if (!isNaN(a.year) && isNaN(b.year)) {
                return 1
            }
            // 如果 a.year 不是数字, b.year 是数字, 则 a.year 排在 b.year 的前面
            if (isNaN(a.year) && !isNaN(b.year)) {
                return -1
            }
        })
        return [biblist_all_values_sort, '']
    }

    __sort_citekey() {
        let bib_dict = this.bib_dict;
        // biblist['zh'] 与 biblist['en']  合并
        let biblist_all = Object.assign(bib_dict['zh'], bib_dict['en'])
        // biblist_all 取出所值的第三个元素
        let biblist_all_values = Object.values(biblist_all).map(x => x[1])
        // 遍历 biblist_all_values 的元素
        let biblist_all_values_sort = biblist_all_values.sort((a, b) => {
            // 如果 a.year 与 b.year 都是数字, 则按照数字排序
            if (!isNaN(a.citekey) && !isNaN(b.year)) {
                return b.citekey - a.citekey
            }
            // 如果 a.citekey 与 b.citekey 都不是数字, 则按照字符串排序
            if (isNaN(a.citekey) && isNaN(b.citekey)) {
                return a.citekey.localeCompare(b.citekey)
            }
            // 如果 a.citekey 是数字, b.citekey 不是数字, 则 a.citekey 排在 b.citekey 的后面
            if (!isNaN(a.citekey) && isNaN(b.citekey)) {
                return 1
            }
            // 如果 a.citekey 不是数字, b.citekey 是数字, 则 a.citekey 排在 b.citekey 的前面
            if (isNaN(a.citekey) && !isNaN(b.citekey)) {
                return -1
            }
        })
        return [biblist_all_values_sort, '']
    }

    __sort() {
        switch (this.sortby) {
            case 'must':
                return this.__sort_must()
            case 'year':
                return this.__sort_year()
            case 'citekey':
                return this.__sort_citekey()
        }
    }

    __bbl() {
        let bibtxt = this.bibtxt

        this.bib_dict = this._formatbib(bibtxt);

        let [biblist_zh, biblist_en] = this.__sort();

        let zhbbl = [];
        let totalt = 0;
        for (let i = 0; i < biblist_zh.length; i++) {
            totalt += 1;
            let t = `%zh:${i + 1}/${biblist_zh.length}\n`
            t += biblist_zh[i].output_bbl;
            zhbbl.push(t);
        }

        let enbbl = [];
        for (let i = 0; i < biblist_en.length; i++) {
            totalt += 1;
            let t = `%en:${i + 1}/${biblist_en.length}\n`
            t += biblist_en[i].output_bbl;
            enbbl.push(t);
        }

        var a = ""
        if (this.numofenbib == 0) {
            a = ""
        } else {
            a = `\\bibitem[zh, 2019]{zh2019}{\\fontsize{16 pt}{\\baselineskip}\\selectfont 中文部分：}`
        }
        a += `\n{\\cnfz \n`


        let b = `}`
        if (zhbbl.length > 0) {
            //  在 zhbbl 数组, 第一个位置上 添加元素
            zhbbl.unshift(a);
            //  在 zhbbl 数组, 最后一个位置上 添加元素
            zhbbl.push(b);
        }

        if (this.numofzhbib == 0) {
            a = ""
        } else {
            a = `\n\n\\vspace{0.5cm}\\bibitem[En, 2019]{en2019}{\\fontsize{16 pt}{\\baselineskip}\\selectfont 英文部分：}`
        }
        a += `\n{\\enfz \n`


        b = `} `
        if (enbbl.length > 0) {
            enbbl.unshift(a);
            enbbl.push(b);
        }

        let allbll = [zhbbl.join('\n'), enbbl.join('\n')]
        //allbbl 去空元素
        allbll = allbll.filter(line => line.trim() !== '' && !line.trim().startsWith('%'));
        allbll = allbll.join('\n\n')
        let bbl = `\\begin{thebibliography} {} \n`
        bbl += allbll
        bbl += `\n\n%total ref num:${totalt}. (zh:${biblist_zh.length}, en:${biblist_en.length}) `
        bbl += `\n\n\\end{thebibliography} `;
        return bbl
    }

    __bib() {
        let bibtxt = this.bibtxt
        this.bib_dict = this._formatbib(bibtxt);
        let [biblist_zh, biblist_en] = this.__sort();

        let zhbbl = [];
        let totalt = 0;
        if (biblist_zh != '') {
            for (let i = 0; i < biblist_zh.length; i++) {
                totalt += 1;
                let t = `%num of zh ref: ${i + 1}/${biblist_zh.length}\n`
                t += biblist_zh[i].output_bib;
                zhbbl.push(t);
            }
        }
        let enbbl = [];
        if (biblist_en != '') {
            for (let i = 0; i < biblist_en.length; i++) {
                totalt += 1;
                let t = `%num of en ref: ${i + 1}/${biblist_en.length}\n`
                t += biblist_en[i].output_bib;
                enbbl.push(t);
            }
        }
        // zhbbl & enbbl 合并输出字符
        let allbll = [zhbbl.join('\n'), enbbl.join('\n')]
        // console.log(allbll);

        //allbbl 去空元素
        allbll = allbll.filter(line => line.trim() !== '');
        // allbll = allbll.join('\n\n')
        //遍历 allbll 数组
        let outbib = '';
        for (let i = 0; i < allbll.length; i++) {
            outbib += allbll[i];
            outbib += '\n\n';
        }
        outbib += `%total num of ref: ${totalt}\n`;
        // console.log(outbib);
        return outbib
    }
}


