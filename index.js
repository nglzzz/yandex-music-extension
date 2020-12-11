(function(modules, bindings) {
    var globalObj;
    if (typeof window !== "undefined") {
        globalObj = window;
    } else if (typeof global !== "undefined") {
        globalObj = global;
    }

    var base = "".split("/");
    var resolveName = function(from, to) {
        var k, l;

        if (bindings[to]) {
            return bindings[to];
        }
        if (to[0] === "/") {
            return to;
        }
        var path = from.split("/").slice(0, -1);

        var toArr = to.split("/");
        for (k = 0, l = toArr.length; k < l; k++) {
            if (toArr[k] === ".") {
                continue;
            }
            if (toArr[k] === ".." && path.length > 0 && path[path.length - 1] !== "..") {
                path.pop();
                continue;
            }
            path.push(toArr[k]);
        }

        if (path[0] === "..") {
            var u = [".."];
            for (k = 1; k < path.length; k++) {
                if (path[k] === "..") {
                    u.push("..");
                } else {
                    if (path[k] === base[k - base.length]) {
                        u.pop();
                    } else {
                        path = u.concat(path.slice(k));
                        break;
                    }
                }
            }
        }

        return path.join("/");
    };

    var cache = {};
    var require = function(moduleName) {
        var ref = resolveName(this.moduleName, moduleName);

        if (!modules[ref] && modules[ref + ".js"]) {
            ref += ".js";
        }

        if (ref in cache) {
            return cache[ref].exports;
        }

        if (!modules[ref]) {
            console.error("No such module: " + ref);
            return;
        }

        var module = cache[ref] = {exports: {}};
        modules[ref].call(globalObj, module, module.exports,
            function() { return require.apply({moduleName: ref}, arguments); },
            globalObj);

        return module.exports;
    };

    require.call({moduleName: "index.js"}, "index.js");
})({"index.js": function(module, exports, require, global) {
window.yr = require("yate/lib/runtime.js");
window.Vow = require("vow");
window.Mu = {};

Mu.render = function(template, data, params) {
    data = data || {};
    return yr.run("index", data, template, params);
};

require("./index.yate.temp.js");
require("./lib/js.js");

require("./js/popup/datasrc.js");
require("music-common/js/mini-di.js");
require("music-common/js/blocks.js");

Mu.eventize = require("music-common/js/tools/eventize.js");
Mu.consts = require("./js/common/consts.js");
Mu.msg = new (require("./js/common/messenger"))(Mu.consts.SOURCE_POPUP, Mu.consts.SOURCE_BG);

Mu.blocks = new Mu.Blocks();
require("./lib/blocks.js");

Mu.pages = new Mu.Pages();
require("./lib/pages.js");

var di = new Mu.MiniDi(true);
Mu.datasrc = new Mu.Datasrc();

$(".page-root")[0].innerHTML = Mu.render();

di.init({
    pages: Mu.pages,
    routes: Mu.routes,
    navigation: Mu.navigation,
    datasrc: Mu.datasrc,
    blocks: Mu.blocks,
    msg: Mu.msg,
    layout: new Mu.Layout(),
    dispatcher: new Mu.Dispatcher()
});

Mu.blocks.initPendingBlocks(document.body);
Mu.navigation.start();
Mu.msg.start();

}
,"node_modules/yate/lib/runtime.js": function(module, exports, require, global) {
//  ---------------------------------------------------------------------------------------------------------------  //
//  yate runtime
//  ---------------------------------------------------------------------------------------------------------------  //

var yr = {};

(function() {

yr.log = function() {};

//  TODO:
//  Пустой массив. Можно использовать везде, где предполается,
//  что он read-only. Например, когда из select() возвращается пустой нодесет и т.д.
//  var emptyA = [];

var modules = {};

//  ---------------------------------------------------------------------------------------------------------------  //

//  Кешируем регулярки для лучшей производительности.
//  (http://jsperf.com/entityify-test/2)
//
var RE_AMP = /&/g;
var RE_LT = /</g;
var RE_GT = />/g;
var RE_QUOTE = /"/g;

var RE_E_AMP = /&amp;/g;
var RE_E_LT = /&lt;/g;
var RE_E_GT = /&gt;/g;

yr.text2xml = function(s) {
    if (s == null) { return ''; }

    //  NOTE: Странное поведение Safari в этом месте.
    //  Иногда сюда попадает объект, которые != null, но при этом у него
    //  нет метода toString. По идее, такого быть просто не может.
    //  Попытки пронаблюдать этот объект (при помощи console.log и т.д.)
    //  приводят к тому, что он "нормализуется" и баг пропадает.
    //  Вообще, любые операции, которые неявно приводят его к строке, например,
    //  тоже приводят к нормализации и пропаданию бага.
    //
    //  Поэтому, вместо `s.toString()` используем `('' + s)`.
    //
    return ('' + s)
        .replace(RE_AMP, '&amp;')
        .replace(RE_LT, '&lt;')
        .replace(RE_GT, '&gt;');
};

yr.xml2text = function(s) {
    //  NOTE: См. коммент про Safari выше.

    if (s == null) { return ''; }

    return ('' + s)
        .replace(RE_E_LT, '<')
        .replace(RE_E_GT, '>')
        .replace(RE_E_AMP, '&');
};

yr.text2attr = function(s) {
    //  NOTE: См. коммент про Safari выше.

    if (s == null) { return ''; }

    return ('' + s)
        .replace(RE_AMP, '&amp;')
        .replace(RE_QUOTE, '&quot;')
        .replace(RE_LT, '&lt;')
        .replace(RE_GT, '&gt;');
};

yr.xml2attr = function(s) {
    //  NOTE: См. коммент про Safari выше.

    if (s == null) { return ''; }

    return ('' + s)
        .replace(RE_QUOTE, '&quot;')
        .replace(RE_LT, '&lt;')
        .replace(RE_GT, '&gt;');
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.register = function(id, module) {
    if ( modules[id] ) {
        throw Error('Module "' + id + '" already exists');
    }

    //  Резолвим ссылки на импортируемые модули.

    var ids = module.imports || [];
    /// module.id = id;
    //  Для удобства добавляем в imports сам модуль.
    var imports = [ module ];
    for (var i = 0, l = ids.length; i < l; i++) {
        var module_ = modules[ ids[i] ];
        if (!module_) {
            throw Error('Module "' + ids[i] + '" doesn\'t exist');
        } else {
            imports = imports.concat(module_.imports);
        }
    }
    //  В результате мы дерево импортов превратили в плоский список.
    module.imports = imports;

    modules[id] = module;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.run = function(id, data, mode, args) {
    mode = mode || '';

    var module = modules[id];
    if (!module) {
        throw 'Module "' + id + '" is undefined';
    }

    var doc = new Doc(data);

    args = args || [];
    var r = module.a.apply(module, [module, [doc.root], mode, { a: {} }].concat(args));

    return r;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.join = function join(left, right) {
    return left.concat(right);
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.nodeValue = function nodeValue(node) {
    var data = node.data;
    return (typeof data === 'object') ? '': data;
};

yr.nodeName = function nodeName(nodeset) {
    var node = nodeset[0];

    return (node) ? node.name : '';
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.simpleScalar = function simpleScalar(name, context) {
    var data = context.data;
    if (!data) { return ''; }

    if (name === '*') {
        for (var key in data) {
            return yr.simpleScalar(key, context);
        }
        return '';
    }

    var r = data[name];

    if (typeof r === 'object') {
        return '';
    }

    return r;
};

yr.simpleBoolean = function simpleBoolean(name, context) {
    var data = context.data;
    if (!data) { return false; }

    if (name === '*') {
        for (var key in data) {
            var r = yr.simpleBoolean(key, context);
            if (r) { return true; }
        }
        return false;
    }

    var r = data[name];

    if (!r) { return false; }

    if (r instanceof Array) {
        return r.length;
    }

    return true;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.nodeset2scalar = function nodeset2scalar(nodeset) {
    if (!nodeset.length) { return ''; }

    var data = nodeset[0].data;
    return (typeof data == 'object') ? '': data;
};

yr.nodeset2boolean = function nodeset2boolean(nodeset) {
    if (! (nodeset && nodeset.length > 0) ) {
        return false;
    }

    return !!nodeset[0].data;
};

yr.nodeset2xml = function nodeset2xml(nodeset) {
    return yr.scalar2xml( yr.nodeset2scalar(nodeset) );
};

yr.nodeset2attrvalue = function nodeset2attrvalue(nodeset) {
    return yr.scalar2attrvalue( yr.nodeset2scalar(nodeset) );
};

yr.scalar2xml = yr.text2xml;
yr.xml2scalar = yr.xml2text;

//  FIXME: Откуда вообще взялась идея, что xml в атрибуты нужно кастить не так, как скаляры?!
//  Смотри #157. Не нужно квотить амперсанд, потому что он уже заквочен.
yr.xml2attrvalue = yr.xml2attr;

yr.scalar2attrvalue = yr.text2attr;

yr.object2nodeset = function object2nodeset(object) {
    return [ ( new Doc(object) ).root ];
};

yr.array2nodeset = function array2nodeset(array) {
    var object = {
        'item': array
    };
    return [ ( new Doc(object) ).root ];
};

//  Сравниваем скаляр left с нодесетом right.
yr.cmpSN = function cmpSN(left, right) {
    for (var i = 0, l = right.length; i < l; i++) {
        if ( left == yr.nodeValue( right[i] ) ) {
            return true;
        }
    }
    return false;
};

//  Сравниваем два нодесета.
yr.cmpNN = function cmpNN(left, right) {
    var m = right.length;

    if (m === 0) { return false; }
    if (m === 1) { return yr.cmpSN( yr.nodeValue( right[0] ), left ); }

    var values = [];

    var rv = yr.nodeValue( right[0] );
    for (var i = 0, l = left.length; i < l; i++) {
        var lv = yr.nodeValue( left[i] );
        if (lv == rv) { return true; }
        values[i] = lv;
    }

    for (var j = 1; j < m; j++) {
        rv = yr.nodeValue( right[j] );
        for (var i = 0, l = left.length; i < l; i++) {
            if ( values[i] == rv ) { return true; }
        }
    }

    return false;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.shortTags = {
    br: true,
    col: true,
    embed: true,
    hr: true,
    img: true,
    input: true,
    link: true,
    meta: true,
    param: true,
    wbr: true
};

yr.closeAttrs = function closeAttrs(a) {
    var name = a.s;

    if (name) {
        var r = '';
        var attrs = a.a;

        for (var attr in attrs) {
            r += ' ' + attr + '="' + attrs[attr].quote() + '"';
        }
        /*
        for (var attr in attrs) {
            if ( attrs.hasOwnProperty(attr) ) {
                var v = attrs[attr];
                if (v.quote) {
                    r += ' ' + attr + '="' + v.quote() + '"';
                } else {
                    yr.log({
                        id: 'NO_QUOTE',
                        message: "Attr doesn't have quote() method",
                        data: {
                            key: attr,
                            value: v
                        }
                    });
                }
            } else {
                yr.log({
                    id: 'BAD_PROTOTYPE',
                    message: 'Object prototype is corrupted',
                    data: {
                        key: attr,
                        value: v
                    }
                });
            }
        }
        */
        r += (yr.shortTags[name]) ? '/>' : '>';
        a.s = null;

        return r;
    }

    return '';
};

yr.copyAttrs = function copyAttrs(to, from) {
    for (var key in from) {
        to[key] = from[key];
    }
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.scalarAttr = function(s) {
    //  NOTE: См. коммент про Safari выше.

    this.s = (s == null) ? '' : ('' + s);
};

yr.scalarAttr.prototype.quote = function() {
    return yr.text2attr(this.s);
};

function quoteAmp(s) {
    return s.replace(/&/g, '&amp;');
}

yr.scalarAttr.prototype.addxml = function(xml) {
    return new yr.xmlAttr( quoteAmp(this.s) + xml );
};

yr.scalarAttr.prototype.addscalar = function(xml) {
    return new yr.scalarAttr( this.s + xml );
};

yr.xmlAttr = function(s) {
    //  NOTE: См. коммент про Safari выше.

    this.s = (s == null) ? '' : ('' + s);
};

yr.xmlAttr.prototype.quote = function() {
    return yr.xml2attr(this.s);
};

yr.xmlAttr.prototype.addscalar = function(scalar) {
    return new yr.xmlAttr( this.s + quoteAmp(scalar) );
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.slice = function(s, from, to) {
    //  NOTE: См. коммент про Safari выше.

    s = '' + s;
    return (to) ? s.slice(from, to) : s.slice(from);
};

yr.exists = function(nodeset) {
    return nodeset.length > 0;
};

yr.grep = function(nodeset, predicate) {
    var r = [];
    for (var index = 0, count = nodeset.length; index < count; index++) {
        var node = nodeset[index];
        if (predicate(node, index, count)) {
            r.push(node);
        }
    }
    return r;
};

yr.byIndex = function(nodeset, i) {
    return nodeset.slice(i, i + 1);
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.sort = function(nodes, by, desc) {
    var values = [];
    for (var i = 0, l = nodes.length; i < l; i++) {
        var node = nodes[i];
        var value = by(node, i, l);
        values.push({
            node: node,
            value: value
        });
    }

    var greater = (desc) ? -1 : +1;
    var less = (desc) ? +1 : -1;

    var sorted = values.sort(function(a, b) {
        var va = a.value;
        var vb = b.value;
        if (va < vb) { return less; }
        if (va > vb) { return greater; }
        return 0;
    });

    var r = [];
    for (var i = 0, l = sorted.length; i < l; i++) {
        r.push( sorted[i].node );
    }

    return r;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.nodeset2data = function(nodes) {
    var l = nodes.length;
    if (l === 0) {
        return '';
    }

    if (l === 1) {
        return nodes[0].data;
    }

    var data = [];
    for (var i = 0; i < l; i++) {
        data.push( nodes[i].data );
    }

    return data;
};

//  ---------------------------------------------------------------------------------------------------------------  //

yr.externals = {};


//  ---------------------------------------------------------------------------------------------------------------  //
//  Module
//  ---------------------------------------------------------------------------------------------------------------  //


var Module = function() {};

//  ---------------------------------------------------------------------------------------------------------------  //

//  NOTE: ex applyValue.
Module.prototype.a = function applyValue(M, nodeset, mode, a0) {
    var r = '';

    //  Достаем аргументы, переданные в apply, если они там есть.
    var args;
    if (arguments.length > 4) {
        args = Array.prototype.slice.call(arguments, 4);
    }

    var imports = M.imports;

    //  Идем по нодесету.
    for (var i0 = 0, l0 = nodeset.length; i0 < l0; i0++) {
        var c0 = nodeset[i0];

        //  Для каждой ноды ищем подходящий шаблон.
        //  Сперва ищем в текущем модуле ( imports[0] ),
        //  затем идем далее по списку импортов.

        //  Если мы найдем шаблон, в found будет его id, а в module -- модуль,
        //  в котором находится этот шаблон.
        var found = false;
        var module;

        var i2 = 0;
        var l2 = imports.length;
        var template;
        while (!found && i2 < l2) {
            module = imports[i2++];

            //  matcher представляем собой двухуровневый объект,
            //  на первом уровне ключами являются моды,
            //  на втором -- имена нод.
            //  Значения на втором уровне -- список id-шников шаблонов.
            var names = module.matcher[mode];

            if (names) {
                //  FIXME: Тут неправильно. Если шаблоны для c0.name будут,
                //  но ни один из них не подойдет, то шаблоны для '*' не применятся вообще.
                //  FIXME: Плюс шаблоны на '*' всегда имеют более низкий приоритет.
                var templates = names[c0.name] || names['*'];
                if (templates) {
                    var i3 = 0;
                    var l3 = templates.length;
                    while (!found && i3 < l3) {
                        var tid = templates[i3++];
                        template = module[tid];

                        var selector = template.j;
                        if (selector) {
                            //  В template.j лежит id селектора (jpath'а).
                            //  В tempalte.a флаг о том, является ли jpath абсолютным.
                            if ( module.matched(selector, template.a, c0, i0, l0) ) {
                                found = tid;
                            }
                        } else {
                            var selectors = template.s;
                            var abs = template.a;
                            //  В template.s лежит массив с id-шниками селекторов.
                            for (var i4 = 0, l4 = selectors.length; i4 < l4; i4++) {
                                if ( module.matched(selectors[i4], abs[i4], c0, i0, l0) ) {
                                    found = tid;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (found) {
            //  Шаблон нашли, применяем его.
            if (args) {
                //  Шаблон позвали с параметрами, приходится изгаляться.
                r += template.apply( M, [M, c0, i0, l0, a0].concat(args) );
            } else {
                r += template(M, c0, i0, l0, a0);
            }
        }
    }

    return r;
};

//  ---------------------------------------------------------------------------------------------------------------  //

Module.prototype.matched = function matched(jpath, abs, c0, i0, l0) {
    if (jpath === 1) {
        //  Это jpath '/'
        return !c0.parent;
    }

    var l = jpath.length;
    //  i (и l) всегда будет четное.
    var i = l - 2;
    while (i >= 0) {
        if (!c0) { return false; }

        var step = jpath[i];
        //  Тут step может быть либо 0 (nametest), либо 2 (predicate).
        //  Варианты 1 (dots) и 3 (index) в jpath'ах в селекторах запрещены.
        switch (step) {
            case 0:
                //  Nametest.
                var name = jpath[i + 1];
                if (name !== '*' && name !== c0.name) { return false; }
                c0 = c0.parent;
                break;

            case 2:
            case 4:
                //  Predicate or guard.
                var predicate = jpath[i + 1];
                if ( !predicate(this, c0, i0, l0) ) { return false; }
                break;
        }

        i -= 2;
    }

    if (abs && c0.parent) {
        return false;
    }

    return true;
};

//  ---------------------------------------------------------------------------------------------------------------  //

//  NOTE: ex selectN.
Module.prototype.s = function selectN(jpath, node) {
    return this.n( jpath, [ node ] );
};

//  NOTE: ex selectNs.
Module.prototype.n = function selectNs(jpath, nodeset) {

    var current = nodeset;
    var m = current.length;

    var result;
    for (var i = 0, n = jpath.length; i < n; i += 2) {
        result = [];

        var type = jpath[i];
        var step = jpath[i + 1];

        switch (type) {

            case 0: // Это nametest (.foo или .*), в step 'foo' или '*'.
                for (var j = 0; j < m; j++) {
                    yr.selectNametest(step, current[j], result);
                }
                break;

            case 1: // Это dots (., .., ...), в step количество шагов минус один ( . -- 0, .. -- 1, ... -- 2 и т.д. ).
                for (var j = 0; j < m; j++) {
                    var k = 0;
                    var node = current[j];
                    while (k < step && node) {
                        node = node.parent;
                        k++;
                    }
                    if (node) {
                        result.push(node);
                    }
                }
                break;

            case 2: // Это filter, в step предикат.
                for (var j = 0; j < m; j++) {
                    var node = current[j];
                    if (step(this, node, j, m)) { // Предикат принимает четыре параметра: module, node, index и count.
                        result.push(node);
                    }
                }
                break;

            case 3: // Это index, в step индекс нужного элемента.
                var node = current[ step ];
                result = (node) ? [ node ] : [];
                break;

            case 4:
                //  Это глобальный гвард.
                if (m > 0) {
                    var node = current[0];
                    if ( step(this, node.doc.root, 0, 1) ) {
                        result = result.concat(current);
                    }
                }

        }

        current = result;
        m = current.length;

        if (!m) { return []; }
    }

    return result;
};

yr.selectNametest = function selectNametest(step, context, result) {

    var data = context.data;

    if (!data || typeof data !== 'object') { return result; }

    if (step === '*') {
        if (data instanceof Array) {
            for (var i = 0, l = data.length; i < l; i++) {
                yr.selectNametest(i, context, result);
            }
        } else {
            for (step in data) {
                yr.selectNametest(step, context, result);
            }
        }
        return result;
    }

    data = data[step];
    if (data === undefined) { return result; }

    var doc = context.doc;
    if (data instanceof Array) {
        for (var i = 0, l = data.length; i < l; i++) {
            result.push({
                data: data[i],
                parent: context,
                name: step,
                //  FIXME: Не нравится мне этот doc.
                doc: doc
            });
        }
    } else {
        result.push({
            data: data,
            parent: context,
            name: step,
            //  FIXME: Не нравится мне этот doc.
            doc: doc
        });
    }

    return result;
};

yr.document = function(nodeset) {
    var doc;
    if (!nodeset.length) {
        doc = new Doc( {} );
    } else {
        doc = new Doc( nodeset[0].data );
    }
    return [ doc.root ];
};

yr.subnode = function(name, data, context) {
    var doc = context.doc;

    if (data instanceof Array) {
        var nodeset = [];
        for (var i = 0, l = data.length; i < l; i++) {
            nodeset.push({
                data: data[i],
                name: name,
                parent: context,
                doc: doc
            });
        }
        return nodeset;
    }

    return [
        {
            data: data,
            name: name,
            parent: context,
            doc: doc
        }
    ];
};

//  ---------------------------------------------------------------------------------------------------------------  //

//  Глобальные переменные у нас "ленивые" с кэшированием.
//  В this[name] находится только лишь функция,
//  вычисляющая нужное значение.
//
//  NOTE: ex vars
Module.prototype.v = function vars(id, c0) {
    var vars = c0.doc._vars;
    var value = vars[id];
    if (value === undefined) {
        var var_ = this.findSymbol(id);
        value = (typeof var_ === 'function') ? var_(this, c0, 0, 1) : var_;
        vars[id] = value;
    }
    return value;
};

//  FIXME: Тут еще бывает a0, а иногда не бывает.
//
//  NOTE: ex funcs
Module.prototype.f = function funcs(id, c0, i0, l0, v0) {
    var func = this.findSymbol(id);

    if (arguments.length > 5) {
        //  Два и более аргументов.
        var args = Array.prototype.slice.call(arguments);
        args[0] = this;
        return func.apply(this, args);
    }

    if (v0 !== undefined) {
        //  Один аргумент.
        return func(this, c0, i0, l0, v0);
    }

    //  Без аргументов.
    return func(this, c0, i0, l0);
};

//  NOTE: ex keys.
Module.prototype.k = function keys(id, use, c0, multiple) {
    var keys = c0.doc._keys;

    var key = this.findSymbol(id);

    var cache = keys[id];
    if (!cache) {
        cache = this._initKey(key, id, use, c0);
    }

    var values = cache.values;
    var nodes = cache.nodes;

    var that = this;

    if (multiple) {
        //  В use -- нодесет.
        var r;

        if (cache.xml) {
            r = '';
            for (var i = 0, l = use.length; i < l; i++) {
                var c0 = use[i];
                r += getValue( yr.nodeValue(c0) );
            }
        } else {
            r = [];
            for (var i = 0, l = use.length; i < l; i++) {
                var c0 = use[i];
                r = r.concat( getValue( yr.nodeValue(c0) ) );
            }
        }

        return r;

    } else {
        //  В use -- скаляр.
        var value = values[use];
        if (value === undefined) {
            value = getValue(use);
        }

        return value;

    }

    function getValue(use) {
        var nodes_ = nodes[use];

        var r;
        if (cache.xml) {
            r = '';
            if (nodes_) {
                for (var i = 0, l = nodes_.length; i < l; i++) {
                    var node = nodes_[i];
                    //  FIXME: Нельзя ли тут последний параметр сделать общим,
                    //  а не создавать его для каждого элемента цикла?
                    r += key.b( that, node.c, node.i, node.l, {} );
                }
            }
        } else {
            r = [];
            if (nodes_) {
                for (var i = 0, l = nodes_.length; i < l; i++) {
                    var node = nodes_[i];
                    r = r.concat( key.b(that, node.c, node.i, node.l) );
                }
            }
        }

        values[use] = r;

        return r;
    }

};

Module.prototype._initKey = function(key, id, use, c0) {
    var keys = c0.doc._keys;
    var cache = keys[id] = {};

    //  Тело ключ имеет тип xml.
    cache.xml = (key.bt === 'xml');

    //  Вычисляем нодесет с нодами, которые матчатся ключом.
    var matched = key.n(this, c0);
    //  Хранилище для этих нод.
    var nodes = cache.nodes = {};

    //  Значение use ключа может возвращать нодесет или скаляр.
    if (key.ut === 'nodeset') {
        for (var i0 = 0, l0 = matched.length; i0 < l0; i0++) {
            var c1 = matched[i0];
            //  Тип use_ -- nodeset.
            var use_ = key.u(this, c1, i0, l0);

            for (var j = 0, m = use_.length; j < m; j++) {
                store( yr.nodeValue( use_[j] ), { c: c1, i: i0, l: l0 } );
            }
        }

    } else {
        for (var i0 = 0, l0 = matched.length; i0 < l0; i0++) {
            var c1 = matched[i0];
            //  Тип use_ -- nodeset.
            var use_ = key.u(this, c1, i0, l0);

            store( use_, { c: c1, i: i0, l: l0 } );
        }

    }

    //  Хранилище для уже вычисленных значений ключа.
    cache.values = {};

    return cache;

    //  Сохраняем ноду по соответствующему ключу.
    //  Одному ключу может соответствовать несколько нод.
    function store(key, info) {
        var items = nodes[key];
        if (!items) {
            items = nodes[key] = [];
        }
        items.push(info);
    }


};

//  ---------------------------------------------------------------------------------------------------------------  //

Module.prototype.findSymbol = function(id) {
    var imports = this.imports;
    for (var i = 0, l = imports.length; i < l; i++) {
        var module = imports[i];
        var symbol = module[id];
        if (symbol !== undefined) { return symbol; }
    }
};

//  ---------------------------------------------------------------------------------------------------------------  //

function Doc(data) {
    //  FIXME: Что тут использовать? Array.isArray?
    if (data instanceof Array) {
        data = {
            //  FIXME: Сделать название поля ('item') настраеваемым.
            'item': data
        };
    }

    this.root = {
        data: data,
        parent: null,
        name: '',
        doc: this
    };

    this._vars = {};
    this._keys = {};
}

//  ---------------------------------------------------------------------------------------------------------------  //



yr.Module = Module;

//  ---------------------------------------------------------------------------------------------------------------  //

})();

//  ---------------------------------------------------------------------------------------------------------------  //

//  NOTE: Для использования из node.js.
//  При этом недостаточно просто проверить window/document.
//  Потому что в тестах runtime грузится не как модуль (пока что, надеюсь),
//  но просто эвалится, поэтому в нем module не определен.
//
if (typeof module !== 'undefined') {
    module.exports = yr;
}


}
,"node_modules/vow/lib/vow.js": function(module, exports, require, global) {
/**
 * @module vow
 * @author Filatov Dmitry <dfilatov@yandex-team.ru>
 * @version 0.4.5
 * @license
 * Dual licensed under the MIT and GPL licenses:
 *   * http://www.opensource.org/licenses/mit-license.php
 *   * http://www.gnu.org/licenses/gpl.html
 */

(function(global) {

/**
 * @class Deferred
 * @exports vow:Deferred
 * @description
 * The `Deferred` class is used to encapsulate newly-created promise object along with functions that resolve, reject or notify it.
 */

/**
 * @constructor
 * @description
 * You can use `vow.defer()` instead of using this constructor.
 *
 * `new vow.Deferred()` gives the same result as `vow.defer()`.
 */
var Deferred = function() {
    this._promise = new Promise();
};

Deferred.prototype = /** @lends Deferred.prototype */{
    /**
     * Returns corresponding promise.
     *
     * @returns {vow:Promise}
     */
    promise : function() {
        return this._promise;
    },

    /**
     * Resolves corresponding promise with given `value`.
     *
     * @param {*} value
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.then(function(value) {
     *     // value is "'success'" here
     * });
     *
     * defer.resolve('success');
     * ```
     */
    resolve : function(value) {
        this._promise.isResolved() || this._promise._resolve(value);
    },

    /**
     * Rejects corresponding promise with given `reason`.
     *
     * @param {*} reason
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.fail(function(reason) {
     *     // reason is "'something is wrong'" here
     * });
     *
     * defer.reject('something is wrong');
     * ```
     */
    reject : function(reason) {
        this._promise.isResolved() || this._promise._reject(reason);
    },

    /**
     * Notifies corresponding promise with given `value`.
     *
     * @param {*} value
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.progress(function(value) {
     *     // value is "'20%'", "'40%'" here
     * });
     *
     * defer.notify('20%');
     * defer.notify('40%');
     * ```
     */
    notify : function(value) {
        this._promise.isResolved() || this._promise._notify(value);
    }
};

var PROMISE_STATUS = {
    PENDING   : 0,
    RESOLVED  : 1,
    FULFILLED : 2,
    REJECTED  : 3
};

/**
 * @class Promise
 * @exports vow:Promise
 * @description
 * The `Promise` class is used when you want to give to the caller something to subscribe to,
 * but not the ability to resolve or reject the deferred.
 */

/**
 * @constructor
 * @param {Function} resolver See https://github.com/domenic/promises-unwrapping/blob/master/README.md#the-promise-constructor for details.
 * @description
 * You should use this constructor directly only if you are going to use `vow` as DOM Promises implementation.
 * In other case you should use `vow.defer()` and `defer.promise()` methods.
 * @example
 * ```js
 * function fetchJSON(url) {
 *     return new vow.Promise(function(resolve, reject, notify) {
 *         var xhr = new XMLHttpRequest();
 *         xhr.open('GET', url);
 *         xhr.responseType = 'json';
 *         xhr.send();
 *         xhr.onload = function() {
 *             if(xhr.response) {
 *                 resolve(xhr.response);
 *             }
 *             else {
 *                 reject(new TypeError());
 *             }
 *         };
 *     });
 * }
 * ```
 */
var Promise = function(resolver) {
    this._value = undef;
    this._status = PROMISE_STATUS.PENDING;

    this._fulfilledCallbacks = [];
    this._rejectedCallbacks = [];
    this._progressCallbacks = [];

    if(resolver) { // NOTE: see https://github.com/domenic/promises-unwrapping/blob/master/README.md
        var _this = this,
            resolverFnLen = resolver.length;

        resolver(
            function(val) {
                _this.isResolved() || _this._resolve(val);
            },
            resolverFnLen > 1?
                function(reason) {
                    _this.isResolved() || _this._reject(reason);
                } :
                undef,
            resolverFnLen > 2?
                function(val) {
                    _this.isResolved() || _this._notify(val);
                } :
                undef);
    }
};

Promise.prototype = /** @lends Promise.prototype */ {
    /**
     * Returns value of fulfilled promise or reason in case of rejection.
     *
     * @returns {*}
     */
    valueOf : function() {
        return this._value;
    },

    /**
     * Returns `true` if promise is resolved.
     *
     * @returns {Boolean}
     */
    isResolved : function() {
        return this._status !== PROMISE_STATUS.PENDING;
    },

    /**
     * Returns `true` if promise is fulfilled.
     *
     * @returns {Boolean}
     */
    isFulfilled : function() {
        return this._status === PROMISE_STATUS.FULFILLED;
    },

    /**
     * Returns `true` if promise is rejected.
     *
     * @returns {Boolean}
     */
    isRejected : function() {
        return this._status === PROMISE_STATUS.REJECTED;
    },

    /**
     * Adds reactions to promise.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise} A new promise, see https://github.com/promises-aplus/promises-spec for details
     */
    then : function(onFulfilled, onRejected, onProgress, ctx) {
        var defer = new Deferred();
        this._addCallbacks(defer, onFulfilled, onRejected, onProgress, ctx);
        return defer.promise();
    },

    /**
     * Adds rejection reaction only. It is shortcut for `promise.then(undefined, onRejected)`.
     *
     * @param {Function} onRejected Callback to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    'catch' : function(onRejected, ctx) {
        return this.then(undef, onRejected, ctx);
    },

    /**
     * Adds rejection reaction only. It is shortcut for `promise.then(null, onRejected)`. It's alias for `catch`.
     *
     * @param {Function} onRejected Callback to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    fail : function(onRejected, ctx) {
        return this.then(undef, onRejected, ctx);
    },

    /**
     * Adds resolving reaction (to fulfillment and rejection both).
     *
     * @param {Function} onResolved Callback that to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    always : function(onResolved, ctx) {
        var _this = this,
            cb = function() {
                return onResolved.call(this, _this);
            };

        return this.then(cb, cb, ctx);
    },

    /**
     * Adds progress reaction.
     *
     * @param {Function} onProgress Callback to be called with the value when promise has been notified
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    progress : function(onProgress, ctx) {
        return this.then(undef, undef, onProgress, ctx);
    },

    /**
     * Like `promise.then`, but "spreads" the array into a variadic value handler.
     * It is useful with `vow.all` and `vow.allResolved` methods.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all([defer1.promise(), defer2.promise()]).spread(function(arg1, arg2) {
     *     // arg1 is "1", arg2 is "'two'" here
     * });
     *
     * defer1.resolve(1);
     * defer2.resolve('two');
     * ```
     */
    spread : function(onFulfilled, onRejected, ctx) {
        return this.then(
            function(val) {
                return onFulfilled.apply(this, val);
            },
            onRejected,
            ctx);
    },

    /**
     * Like `then`, but terminates a chain of promises.
     * If the promise has been rejected, throws it as an exception in a future turn of the event loop.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     *
     * @example
     * ```js
     * var defer = vow.defer();
     * defer.reject(Error('Internal error'));
     * defer.promise().done(); // exception to be thrown
     * ```
     */
    done : function(onFulfilled, onRejected, onProgress, ctx) {
        this
            .then(onFulfilled, onRejected, onProgress, ctx)
            .fail(throwException);
    },

    /**
     * Returns a new promise that will be fulfilled in `delay` milliseconds if the promise is fulfilled,
     * or immediately rejected if promise is rejected.
     *
     * @param {Number} delay
     * @returns {vow:Promise}
     */
    delay : function(delay) {
        var timer,
            promise = this.then(function(val) {
                var defer = new Deferred();
                timer = setTimeout(
                    function() {
                        defer.resolve(val);
                    },
                    delay);

                return defer.promise();
            });

        promise.always(function() {
            clearTimeout(timer);
        });

        return promise;
    },

    /**
     * Returns a new promise that will be rejected in `timeout` milliseconds
     * if the promise is not resolved beforehand.
     *
     * @param {Number} timeout
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promiseWithTimeout1 = defer.promise().timeout(50),
     *     promiseWithTimeout2 = defer.promise().timeout(200);
     *
     * setTimeout(
     *     function() {
     *         defer.resolve('ok');
     *     },
     *     100);
     *
     * promiseWithTimeout1.fail(function(reason) {
     *     // promiseWithTimeout to be rejected in 50ms
     * });
     *
     * promiseWithTimeout2.then(function(value) {
     *     // promiseWithTimeout to be fulfilled with "'ok'" value
     * });
     * ```
     */
    timeout : function(timeout) {
        var defer = new Deferred(),
            timer = setTimeout(
                function() {
                    defer.reject(Error('timed out'));
                },
                timeout);

        this.then(
            function(val) {
                defer.resolve(val);
            },
            function(reason) {
                defer.reject(reason);
            });

        defer.promise().always(function() {
            clearTimeout(timer);
        });

        return defer.promise();
    },

    _vow : true,

    _resolve : function(val) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        if(val === this) {
            this._reject(TypeError('Can\'t resolve promise with itself'));
            return;
        }

        this._status = PROMISE_STATUS.RESOLVED;

        if(val && !!val._vow) { // shortpath for vow.Promise
            val.isFulfilled()?
                this._fulfill(val.valueOf()) :
                val.isRejected()?
                    this._reject(val.valueOf()) :
                    val.then(
                        this._fulfill,
                        this._reject,
                        this._notify,
                        this);
            return;
        }

        if(isObject(val) || isFunction(val)) {
            var then;
            try {
                then = val.then;
            }
            catch(e) {
                this._reject(e);
                return;
            }

            if(isFunction(then)) {
                var _this = this,
                    isResolved = false;

                try {
                    then.call(
                        val,
                        function(val) {
                            if(isResolved) {
                                return;
                            }

                            isResolved = true;
                            _this._resolve(val);
                        },
                        function(err) {
                            if(isResolved) {
                                return;
                            }

                            isResolved = true;
                            _this._reject(err);
                        },
                        function(val) {
                            _this._notify(val);
                        });
                }
                catch(e) {
                    isResolved || this._reject(e);
                }

                return;
            }
        }

        this._fulfill(val);
    },

    _fulfill : function(val) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        this._status = PROMISE_STATUS.FULFILLED;
        this._value = val;

        this._callCallbacks(this._fulfilledCallbacks, val);
        this._fulfilledCallbacks = this._rejectedCallbacks = this._progressCallbacks = undef;
    },

    _reject : function(reason) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        this._status = PROMISE_STATUS.REJECTED;
        this._value = reason;

        this._callCallbacks(this._rejectedCallbacks, reason);
        this._fulfilledCallbacks = this._rejectedCallbacks = this._progressCallbacks = undef;
    },

    _notify : function(val) {
        this._callCallbacks(this._progressCallbacks, val);
    },

    _addCallbacks : function(defer, onFulfilled, onRejected, onProgress, ctx) {
        if(onRejected && !isFunction(onRejected)) {
            ctx = onRejected;
            onRejected = undef;
        }
        else if(onProgress && !isFunction(onProgress)) {
            ctx = onProgress;
            onProgress = undef;
        }

        var cb;

        if(!this.isRejected()) {
            cb = { defer : defer, fn : isFunction(onFulfilled)? onFulfilled : undef, ctx : ctx };
            this.isFulfilled()?
                this._callCallbacks([cb], this._value) :
                this._fulfilledCallbacks.push(cb);
        }

        if(!this.isFulfilled()) {
            cb = { defer : defer, fn : onRejected, ctx : ctx };
            this.isRejected()?
                this._callCallbacks([cb], this._value) :
                this._rejectedCallbacks.push(cb);
        }

        if(this._status <= PROMISE_STATUS.RESOLVED) {
            this._progressCallbacks.push({ defer : defer, fn : onProgress, ctx : ctx });
        }
    },

    _callCallbacks : function(callbacks, arg) {
        var len = callbacks.length;
        if(!len) {
            return;
        }

        var isResolved = this.isResolved(),
            isFulfilled = this.isFulfilled();

        nextTick(function() {
            var i = 0, cb, defer, fn;
            while(i < len) {
                cb = callbacks[i++];
                defer = cb.defer;
                fn = cb.fn;

                if(fn) {
                    var ctx = cb.ctx,
                        res;
                    try {
                        res = ctx? fn.call(ctx, arg) : fn(arg);
                    }
                    catch(e) {
                        defer.reject(e);
                        continue;
                    }

                    isResolved?
                        defer.resolve(res) :
                        defer.notify(res);
                }
                else {
                    isResolved?
                        isFulfilled?
                            defer.resolve(arg) :
                            defer.reject(arg) :
                        defer.notify(arg);
                }
            }
        });
    }
};

/** @lends Promise */
var staticMethods = {
    /**
     * Coerces given `value` to a promise, or returns the `value` if it's already a promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    cast : function(value) {
        return vow.cast(value);
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are fulfilled,
     * or to be rejected when any of the `iterable` is rejected.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     */
    all : function(iterable) {
        return vow.all(iterable);
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` are fulfilled,
     * or to be rejected when the first item is rejected.
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    race : function(iterable) {
        return vow.anyResolved(iterable);
    },

    /**
     * Returns a promise that has already been resolved with the given `value`.
     * If `value` is a promise, returned promise will be adopted with the state of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    resolve : function(value) {
        return vow.resolve(value);
    },

    /**
     * Returns a promise that has already been rejected with the given `reason`.
     *
     * @param {*} reason
     * @returns {vow:Promise}
     */
    reject : function(reason) {
        return vow.reject(reason);
    }
};

for(var prop in staticMethods) {
    staticMethods.hasOwnProperty(prop) &&
        (Promise[prop] = staticMethods[prop]);
}

var vow = /** @exports vow */ {
    Deferred : Deferred,

    Promise : Promise,

    /**
     * Creates a new deferred. This method is a factory method for `vow:Deferred` class.
     * It's equivalent to `new vow.Deferred()`.
     *
     * @returns {vow:Deferred}
     */
    defer : function() {
        return new Deferred();
    },

    /**
     * Static equivalent to `promise.then`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     */
    when : function(value, onFulfilled, onRejected, onProgress, ctx) {
        return vow.cast(value).then(onFulfilled, onRejected, onProgress, ctx);
    },

    /**
     * Static equivalent to `promise.fail`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onRejected Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    fail : function(value, onRejected, ctx) {
        return vow.when(value, undef, onRejected, ctx);
    },

    /**
     * Static equivalent to `promise.always`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onResolved Callback that will to be invoked with the reason after promise has been resolved
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    always : function(value, onResolved, ctx) {
        return vow.when(value).always(onResolved, ctx);
    },

    /**
     * Static equivalent to `promise.progress`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onProgress Callback that will to be invoked with the reason after promise has been notified
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    progress : function(value, onProgress, ctx) {
        return vow.when(value).progress(onProgress, ctx);
    },

    /**
     * Static equivalent to `promise.spread`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     */
    spread : function(value, onFulfilled, onRejected, ctx) {
        return vow.when(value).spread(onFulfilled, onRejected, ctx);
    },

    /**
     * Static equivalent to `promise.done`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     */
    done : function(value, onFulfilled, onRejected, onProgress, ctx) {
        vow.when(value).done(onFulfilled, onRejected, onProgress, ctx);
    },

    /**
     * Checks whether the given `value` is a promise-like object
     *
     * @param {*} value
     * @returns {Boolean}
     *
     * @example
     * ```js
     * vow.isPromise('something'); // returns false
     * vow.isPromise(vow.defer().promise()); // returns true
     * vow.isPromise({ then : function() { }); // returns true
     * ```
     */
    isPromise : function(value) {
        return isObject(value) && isFunction(value.then);
    },

    /**
     * Coerces given `value` to a promise, or returns the `value` if it's already a promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    cast : function(value) {
        return vow.isPromise(value)?
            value :
            vow.resolve(value);
    },

    /**
     * Static equivalent to `promise.valueOf`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {*}
     */
    valueOf : function(value) {
        return value && isFunction(value.valueOf)? value.valueOf() : value;
    },

    /**
     * Static equivalent to `promise.isFulfilled`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isFulfilled : function(value) {
        return value && isFunction(value.isFulfilled)? value.isFulfilled() : true;
    },

    /**
     * Static equivalent to `promise.isRejected`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isRejected : function(value) {
        return value && isFunction(value.isRejected)? value.isRejected() : false;
    },

    /**
     * Static equivalent to `promise.isResolved`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isResolved : function(value) {
        return value && isFunction(value.isResolved)? value.isResolved() : true;
    },

    /**
     * Returns a promise that has already been resolved with the given `value`.
     * If `value` is a promise, returned promise will be adopted with the state of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    resolve : function(value) {
        var res = vow.defer();
        res.resolve(value);
        return res.promise();
    },

    /**
     * Returns a promise that has already been fulfilled with the given `value`.
     * If `value` is a promise, returned promise will be fulfilled with fulfill/rejection value of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    fulfill : function(value) {
        var defer = vow.defer(),
            promise = defer.promise();

        defer.resolve(value);

        return promise.isFulfilled()?
            promise :
            promise.then(null, function(reason) {
                return reason;
            });
    },

    /**
     * Returns a promise that has already been rejected with the given `reason`.
     * If `reason` is a promise, returned promise will be rejected with fulfill/rejection value of given promise.
     *
     * @param {*} reason
     * @returns {vow:Promise}
     */
    reject : function(reason) {
        if(vow.isPromise(reason)) {
            return reason.then(function(val) {
                var defer = vow.defer();
                defer.reject(val);
                return defer.promise();
            });
        }

        var defer = vow.defer();
        defer.reject(reason);
        return defer.promise();
    },

    /**
     * Invokes a given function `fn` with arguments `args`
     *
     * @param {Function} fn
     * @param {...*} [args]
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var promise1 = vow.invoke(function(value) {
     *         return value;
     *     }, 'ok'),
     *     promise2 = vow.invoke(function() {
     *         throw Error();
     *     });
     *
     * promise1.isFulfilled(); // true
     * promise1.valueOf(); // 'ok'
     * promise2.isRejected(); // true
     * promise2.valueOf(); // instance of Error
     * ```
     */
    invoke : function(fn, args) {
        var len = Math.max(arguments.length - 1, 0),
            callArgs;
        if(len) { // optimization for V8
            callArgs = Array(len);
            var i = 0;
            while(i < len) {
                callArgs[i++] = arguments[i];
            }
        }

        try {
            return vow.resolve(callArgs?
                fn.apply(global, callArgs) :
                fn.call(global));
        }
        catch(e) {
            return vow.reject(e);
        }
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are fulfilled,
     * or to be rejected when any of the `iterable` is rejected.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     *
     * @example
     * with array:
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all([defer1.promise(), defer2.promise(), 3])
     *     .then(function(value) {
     *          // value is "[1, 2, 3]" here
     *     });
     *
     * defer1.resolve(1);
     * defer2.resolve(2);
     * ```
     *
     * @example
     * with object:
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all({ p1 : defer1.promise(), p2 : defer2.promise(), p3 : 3 })
     *     .then(function(value) {
     *          // value is "{ p1 : 1, p2 : 2, p3 : 3 }" here
     *     });
     *
     * defer1.resolve(1);
     * defer2.resolve(2);
     * ```
     */
    all : function(iterable) {
        var defer = new Deferred(),
            isPromisesArray = isArray(iterable),
            keys = isPromisesArray?
                getArrayKeys(iterable) :
                getObjectKeys(iterable),
            len = keys.length,
            res = isPromisesArray? [] : {};

        if(!len) {
            defer.resolve(res);
            return defer.promise();
        }

        var i = len;
        vow._forEach(
            iterable,
            function() {
                if(!--i) {
                    var j = 0;
                    while(j < len) {
                        res[keys[j]] = vow.valueOf(iterable[keys[j++]]);
                    }
                    defer.resolve(res);
                }
            },
            defer.reject,
            defer.notify,
            defer,
            keys);

        return defer.promise();
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are resolved.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.allResolved([defer1.promise(), defer2.promise()]).spread(function(promise1, promise2) {
     *     promise1.isRejected(); // returns true
     *     promise1.valueOf(); // returns "'error'"
     *     promise2.isFulfilled(); // returns true
     *     promise2.valueOf(); // returns "'ok'"
     * });
     *
     * defer1.reject('error');
     * defer2.resolve('ok');
     * ```
     */
    allResolved : function(iterable) {
        var defer = new Deferred(),
            isPromisesArray = isArray(iterable),
            keys = isPromisesArray?
                getArrayKeys(iterable) :
                getObjectKeys(iterable),
            i = keys.length,
            res = isPromisesArray? [] : {};

        if(!i) {
            defer.resolve(res);
            return defer.promise();
        }

        var onResolved = function() {
                --i || defer.resolve(iterable);
            };

        vow._forEach(
            iterable,
            onResolved,
            onResolved,
            defer.notify,
            defer,
            keys);

        return defer.promise();
    },

    allPatiently : function(iterable) {
        return vow.allResolved(iterable).then(function() {
            var isPromisesArray = isArray(iterable),
                keys = isPromisesArray?
                    getArrayKeys(iterable) :
                    getObjectKeys(iterable),
                rejectedPromises, fulfilledPromises,
                len = keys.length, i = 0, key, promise;

            if(!len) {
                return isPromisesArray? [] : {};
            }

            while(i < len) {
                key = keys[i++];
                promise = iterable[key];
                if(vow.isRejected(promise)) {
                    rejectedPromises || (rejectedPromises = isPromisesArray? [] : {});
                    isPromisesArray?
                        rejectedPromises.push(promise.valueOf()) :
                        rejectedPromises[key] = promise.valueOf();
                }
                else if(!rejectedPromises) {
                    (fulfilledPromises || (fulfilledPromises = isPromisesArray? [] : {}))[key] = vow.valueOf(promise);
                }
            }

            if(rejectedPromises) {
                throw rejectedPromises;
            }

            return fulfilledPromises;
        });
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` are fulfilled,
     * or to be rejected when all the items are rejected (with the reason of the first rejected item).
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    any : function(iterable) {
        var defer = new Deferred(),
            len = iterable.length;

        if(!len) {
            defer.reject(Error());
            return defer.promise();
        }

        var i = 0, reason;
        vow._forEach(
            iterable,
            defer.resolve,
            function(e) {
                i || (reason = e);
                ++i === len && defer.reject(reason);
            },
            defer.notify,
            defer);

        return defer.promise();
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` are fulfilled,
     * or to be rejected when the first item is rejected.
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    anyResolved : function(iterable) {
        var defer = new Deferred(),
            len = iterable.length;

        if(!len) {
            defer.reject(Error());
            return defer.promise();
        }

        vow._forEach(
            iterable,
            defer.resolve,
            defer.reject,
            defer.notify,
            defer);

        return defer.promise();
    },

    /**
     * Static equivalent to `promise.delay`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Number} delay
     * @returns {vow:Promise}
     */
    delay : function(value, delay) {
        return vow.resolve(value).delay(delay);
    },

    /**
     * Static equivalent to `promise.timeout`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Number} timeout
     * @returns {vow:Promise}
     */
    timeout : function(value, timeout) {
        return vow.resolve(value).timeout(timeout);
    },

    _forEach : function(promises, onFulfilled, onRejected, onProgress, ctx, keys) {
        var len = keys? keys.length : promises.length,
            i = 0;
        while(i < len) {
            vow.when(promises[keys? keys[i] : i], onFulfilled, onRejected, onProgress, ctx);
            ++i;
        }
    }
};

var undef,
    nextTick = (function() {
        var fns = [],
            enqueueFn = function(fn) {
                return fns.push(fn) === 1;
            },
            callFns = function() {
                var fnsToCall = fns, i = 0, len = fns.length;
                fns = [];
                while(i < len) {
                    fnsToCall[i++]();
                }
            };

        if(typeof setImmediate === 'function') { // ie10, nodejs >= 0.10
            return function(fn) {
                enqueueFn(fn) && setImmediate(callFns);
            };
        }

        if(typeof process === 'object' && process.nextTick) { // nodejs < 0.10
            return function(fn) {
                enqueueFn(fn) && process.nextTick(callFns);
            };
        }

        if(global.postMessage) { // modern browsers
            var isPostMessageAsync = true;
            if(global.attachEvent) {
                var checkAsync = function() {
                        isPostMessageAsync = false;
                    };
                global.attachEvent('onmessage', checkAsync);
                global.postMessage('__checkAsync', '*');
                global.detachEvent('onmessage', checkAsync);
            }

            if(isPostMessageAsync) {
                var msg = '__promise' + +new Date,
                    onMessage = function(e) {
                        if(e.data === msg) {
                            e.stopPropagation && e.stopPropagation();
                            callFns();
                        }
                    };

                global.addEventListener?
                    global.addEventListener('message', onMessage, true) :
                    global.attachEvent('onmessage', onMessage);

                return function(fn) {
                    enqueueFn(fn) && global.postMessage(msg, '*');
                };
            }
        }

        var doc = global.document;
        if('onreadystatechange' in doc.createElement('script')) { // ie6-ie8
            var createScript = function() {
                    var script = doc.createElement('script');
                    script.onreadystatechange = function() {
                        script.parentNode.removeChild(script);
                        script = script.onreadystatechange = null;
                        callFns();
                };
                (doc.documentElement || doc.body).appendChild(script);
            };

            return function(fn) {
                enqueueFn(fn) && createScript();
            };
        }

        return function(fn) { // old browsers
            enqueueFn(fn) && setTimeout(callFns, 0);
        };
    })(),
    throwException = function(e) {
        nextTick(function() {
            throw e;
        });
    },
    isFunction = function(obj) {
        return typeof obj === 'function';
    },
    isObject = function(obj) {
        return obj !== null && typeof obj === 'object';
    },
    toStr = Object.prototype.toString,
    isArray = Array.isArray || function(obj) {
        return toStr.call(obj) === '[object Array]';
    },
    getArrayKeys = function(arr) {
        var res = [],
            i = 0, len = arr.length;
        while(i < len) {
            res.push(i++);
        }
        return res;
    },
    getObjectKeys = Object.keys || function(obj) {
        var res = [];
        for(var i in obj) {
            obj.hasOwnProperty(i) && res.push(i);
        }
        return res;
    };

var defineAsGlobal = true;
if(typeof exports === 'object') {
    module.exports = vow;
    defineAsGlobal = false;
}

if(typeof modules === 'object') {
    modules.define('vow', function(provide) {
        provide(vow);
    });
    defineAsGlobal = false;
}

if(typeof define === 'function') {
    define(function(require, exports, module) {
        module.exports = vow;
    });
    defineAsGlobal = false;
}

defineAsGlobal && (global.vow = vow);

})(this);

}
,"index.yate.temp.js": function(module, exports, require, global) {
var yr = yr || require('yate/lib/runtime.js');

(function() {

    var cmpNN = yr.cmpNN;
    var cmpSN = yr.cmpSN;
    var nodeset2xml = yr.nodeset2xml;
    var nodeset2boolean = yr.nodeset2boolean;
    var nodeset2attrvalue = yr.nodeset2attrvalue;
    var nodeset2scalar = yr.nodeset2scalar;
    var scalar2attrvalue = yr.scalar2attrvalue;
    var xml2attrvalue = yr.xml2attrvalue;
    var scalar2xml = yr.scalar2xml;
    var xml2scalar = yr.xml2scalar;
    var simpleScalar = yr.simpleScalar;
    var simpleBoolean = yr.simpleBoolean;
    var selectNametest = yr.selectNametest;
    var closeAttrs = yr.closeAttrs;

    var M = new yr.Module();

    var j0 = [ 0, '*' ];

    var j1 = [ 1, 0 ];

    var j2 = [ 0, 'after' ];

    var j3 = [ 0, 'href' ];

    var j4 = [ 0, 'use-link' ];

    var j5 = [ 0, 'checked' ];

    var j6 = [ 0, 'target' ];

    var j7 = [ 0, 'icon' ];

    var j8 = [ 0, 'disabled' ];

    var j9 = [ 0, 'attrs', 0, '*' ];

    var j10 = [ 0, 'iconPosition' ];

    var j11 = [ 0, 'text' ];

    var j12 = [ 0, 'service' ];

    var j13 = [ 0, 'parentId' ];

    var j14 = [ 0, 'children' ];

    function p0(m, c0, i0, l0) {
        return simpleBoolean('icon', c0) && !simpleBoolean('parentId', c0) && simpleBoolean('children', c0);
    }

    var j15 = [ 0, '*', 2, p0 ];

    var j16 = [ 0, 'id', 0, 'type' ];

    var j17 = [ 0, 'id', 0, 'tag' ];

    function p1(m, c0, i0, l0) {
        return simpleBoolean('icon', c0) && !simpleBoolean('parentId', c0) && !simpleBoolean('children', c0);
    }

    var j18 = [ 0, '*', 2, p1 ];

    function p2(m, c0, i0, l0) {
        return simpleBoolean('icon', c0) && simpleBoolean('parentId', c0);
    }

    var j19 = [ 0, '*', 2, p2 ];

    function p3(m, c0, i0, l0) {
        return !simpleBoolean('icon', c0);
    }

    var j20 = [ 0, '*', 2, p3 ];

    var j21 = [ 0, 'id' ];

    function p4(m, c0, i0, l0) {
        return cmpSN("user", selectNametest('id', c0, []));
    }

    var j22 = [ 0, '*', 2, p4 ];

    function p5(m, c0, i0, l0) {
        return cmpSN("user", selectNametest('id', c0, [])) && !simpleBoolean('children', c0);
    }

    var j23 = [ 0, '*', 2, p5 ];

    var j24 = [ 0, 'icon', 0, 'backgroundColor' ];

    var j25 = [ 0, 'icon', 0, 'imageUrl' ];

    var j26 = [ 0, 'name' ];

    var j27 = [ 0, 'state' ];

    var j28 = [ 0, 'buttons', 0, 'play' ];

    function p6(m, c0, i0, l0) {
        return !simpleBoolean('id', c0);
    }

    var j29 = [ 0, '*', 2, p6 ];

    var j30 = [ 0, 'context', 0, 'color' ];

    function p7(m, c0, i0, l0) {
        return nodeset2boolean( m.s(j30, c0) );
    }

    var j31 = [ 0, '*', 2, p7 ];

    var j32 = [ 0, 'buttons', 0, 'prev' ];

    var j33 = [ 0, 'buttons', 0, 'next' ];

    function p8(m, c0, i0, l0) {
        return cmpSN("radio", selectNametest('id', c0, []));
    }

    var j34 = [ 0, '*', 2, p8 ];

    var j35 = [ 0, 'context', 0, 'icon' ];

    var j36 = [ 0, 'context', 0, 'title' ];

    var j37 = [ 0, 'context', 0, 'source' ];

    function p9(m, c0, i0, l0) {
        return cmpSN("history", selectNametest('id', c0, []));
    }

    var j38 = [ 0, '*', 2, p9 ];

    var j39 = [ 0, 'track', 0, 'title' ];

    function p10(m, c0, i0, l0) {
        return nodeset2boolean( m.s(j39, c0) );
    }

    var j40 = [ 0, '*', 2, p10 ];

    var j41 = [ 0, 'track' ];

    var j42 = [ 0, 'context', 0, 'bar' ];

    function p11(m, c0, i0, l0) {
        return cmpSN("barLike", m.s(j42, c0));
    }

    var j43 = [ 0, '*', 2, p11 ];

    var j44 = [ 0, 'track', 0, 'liked' ];

    function p12(m, c0, i0, l0) {
        return cmpSN("barFeedback", m.s(j42, c0));
    }

    var j45 = [ 0, '*', 2, p12 ];

    var j46 = [ 0, 'tooltipText' ];

    var j47 = [ 0, 'title' ];

    var j48 = [ 0, 'url' ];

    function p13(m, c0, i0, l0) {
        return simpleBoolean('url', c0);
    }

    var j49 = [ 0, '*', 2, p13 ];

    var j50 = [ 0, 'artist' ];

    var j51 = [ 0, 'artistUrl' ];

    function p14(m, c0, i0, l0) {
        return simpleBoolean('artistUrl', c0);
    }

    var j52 = [ 0, '*', 2, p14 ];

    var j53 = [ 0, 'buttons', 0, 'volume' ];

    var j54 = [ ];

    var j55 = [ 0, 'parent' ];

    var j56 = [ 0, 'items' ];

    var j57 = [ 0, 'selected' ];

    var j58 = [ 0, 'services' ];

    var j59 = [ 1, 1, 0, 'selected', 0, 'id' ];

    function p15(m, c0, i0, l0) {
        return simpleBoolean('selected', c0);
    }

    var j60 = [ 0, '*', 2, p15 ];

    // match .* : button
    M.t0 = function t0(m, c0, i0, l0, a0, v0, v1) {
        var r0 = '';

        r0 += closeAttrs(a0);
        if (simpleBoolean('href', c0) || simpleBoolean('use-link', c0)) {
            r0 += "<a";
            a0.a = {
            };
            a0.s = 'a';
            if (!simpleBoolean('checked', c0) && simpleBoolean('href', c0)) {
                a0.a[ "href" ] = new yr.scalarAttr(simpleScalar('href', c0));
                if (simpleBoolean('target', c0)) {
                    a0.a[ "target" ] = new yr.scalarAttr(simpleScalar('target', c0));
                }
            }
            r0 += m.a(m, m.s(j1, c0), 'button__class', a0, v0, v1)
            r0 += m.a(m, m.s(j1, c0), 'button__attrs', a0)
            r0 += m.a(m, m.s(j1, c0), 'button__content', a0, v0)
            r0 += closeAttrs(a0);
            if (simpleBoolean('after', c0)) {
                r0 += simpleScalar('after', c0);
            }
            r0 += "</a>";
        } else {
            r0 += "<button";
            a0.a = {
            };
            a0.s = 'button';
            r0 += m.a(m, m.s(j1, c0), 'button__class', a0, v0, v1)
            r0 += m.a(m, m.s(j1, c0), 'button__attrs', a0)
            r0 += m.a(m, m.s(j1, c0), 'button__content', a0, v0)
            r0 += closeAttrs(a0);
            if (simpleBoolean('after', c0)) {
                r0 += simpleScalar('after', c0);
            }
            r0 += "</button>";
        }

        return r0;
    };
    M.t0.j = j0;
    M.t0.a = 0;

    // match .* : button__class
    M.t1 = function t1(m, c0, i0, l0, a0, v2, v3) {
        var r0 = '';

        //  var add-class : scalar
        var r1 = '';
        var a1 = { a: {} };
        if (v2) {
            r1 += " button_size_" + ( v2 );
        }
        if (v3) {
            r1 += " " + ( v3 );
        }
        if (simpleBoolean('icon', c0)) {
            r1 += " button_ico";
        }
        if (simpleBoolean('checked', c0)) {
            r1 += " button_checked";
        }
        if (simpleBoolean('disabled', c0)) {
            r1 += " button_disabled";
        }
        var v4 = r1;

        a0.a[ "class" ] = new yr.scalarAttr("button" + ( v4 ));

        return r0;
    };
    M.t1.j = j0;
    M.t1.a = 0;

    // match .* : button__attrs
    M.t2 = function t2(m, c0, i0, l0, a0) {
        var r0 = '';

        var items0 = m.s(j9, c0);
        for (var i1 = 0, l1 = items0.length; i1 < l1; i1++) {
            var c1 = items0[ i1 ];
            a0.a[ ( c1.name ) ] = new yr.scalarAttr(nodeset2scalar( m.s(j1, c1) ));
        }

        return r0;
    };
    M.t2.j = j0;
    M.t2.a = 0;

    // match .* : button__content
    M.t3 = function t3(m, c0, i0, l0, a0, v5) {
        var r0 = '';

        if (cmpSN("right", selectNametest('iconPosition', c0, []))) {
            r0 += m.a(m, m.s(j1, c0), 'button__label', a0, " button__label_left")
            r0 += m.a(m, m.s(j1, c0), 'button__icon', a0, v5)
        } else {
            r0 += m.a(m, m.s(j1, c0), 'button__icon', a0, v5)
            r0 += m.a(m, m.s(j1, c0), 'button__label', a0)
        }

        return r0;
    };
    M.t3.j = j0;
    M.t3.a = 0;

    // match .* : button__icon
    M.t4 = function t4(m, c0, i0, l0, a0, v6) {
        var r0 = '';

        r0 += closeAttrs(a0);
        if (simpleBoolean('icon', c0)) {
            r0 += "<span";
            a0.a = {
                'class': new yr.scalarAttr("icon icon_" + nodeset2scalar( ( selectNametest('icon', c0, []) ) ))
            };
            a0.s = 'span';
            if (v6 == "S") {
                var tmp0 = a0.a[ "class" ];
                if (tmp0) {
                    a0.a[ "class" ] = tmp0.addscalar(" icon_size_M");
                } else {
                    a0.a[ "class" ] = new yr.scalarAttr(" icon_size_M");
                }
            } else if (v6 == "L") {
                var tmp0 = a0.a[ "class" ];
                if (tmp0) {
                    a0.a[ "class" ] = tmp0.addscalar(" icon_size_XL");
                } else {
                    a0.a[ "class" ] = new yr.scalarAttr(" icon_size_XL");
                }
            } else {
                var tmp0 = a0.a[ "class" ];
                if (tmp0) {
                    a0.a[ "class" ] = tmp0.addscalar(" icon_size_L");
                } else {
                    a0.a[ "class" ] = new yr.scalarAttr(" icon_size_L");
                }
            }
            r0 += closeAttrs(a0);
            r0 += "</span>";
        }

        return r0;
    };
    M.t4.j = j0;
    M.t4.a = 0;

    // match .* : button__label
    M.t5 = function t5(m, c0, i0, l0, a0, v7) {
        var r0 = '';

        r0 += closeAttrs(a0);
        if (simpleBoolean('text', c0)) {
            r0 += "<span class=\"" + "button__label" + scalar2attrvalue( ( v7 ) ) + "\">" + nodeset2xml( ( selectNametest('text', c0, []) ) ) + "</span>";
        }

        return r0;
    };
    M.t5.j = j0;
    M.t5.a = 0;

    // match .* : spinner
    M.t6 = function t6(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "spinner" + "\">";
        r0 += "<span class=\"" + "spinner__circle" + "\"></span>";
        r0 += "</div>";

        return r0;
    };
    M.t6.j = j0;
    M.t6.a = 0;

    // match .* : volume
    M.t7 = function t7(m, c0, i0, l0, a0, v8) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("volume")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "volume", true));
        if ((v8)) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" " + ( v8 ));
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" " + ( v8 ));
            }
        }
        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "volume__control" + "\">";
        r0 += "<div class=\"" + "volume__track" + "\">";
        r0 += "<div class=\"" + "volume__filled" + "\" style=\"" + "height: 20px;" + "\"></div>";
        r0 += "</div>";
        r0 += "</div>";
        r0 += "<div class=\"" + "volume__holder" + "\">";
        r0 += "</div>";
        r0 += "<div class=\"" + "volume__btn" + "\">";
        r0 += "<div class=\"" + "volume__icon" + "\"></div>";
        r0 += "</div>";
        r0 += "</div>";

        return r0;
    };
    M.t7.j = j0;
    M.t7.a = 0;

    // match .* : button-icon
    M.t8 = function t8(m, c0, i0, l0, a0, v9, v10) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("button-icon")
        };
        a0.s = 'div';
        var r1 = '';
        var a1 = { a: {} };
        if (v9) {
            r1 += " " + ( v9 );
        }
        if (v10) {
            r1 += " button-icon_size_" + ( v10 );
        }
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(r1);
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(r1);
        }
        r0 += m.a(m, m.s(j1, c0), 'button-icon__attrs', a0, v10)
        r0 += m.a(m, m.s(j1, c0), 'button-icon__icon', a0, v10)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t8.j = j0;
    M.t8.a = 0;

    // match .* : button-icon__icon
    M.t9 = function t9(m, c0, i0, l0, a0, v11) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("icon")
        };
        a0.s = 'span';
        var r1 = '';
        var a1 = { a: {} };
        r1 += " icon_" + nodeset2scalar( ( selectNametest('icon', c0, []) ) );
        if (v11) {
            r1 += " icon_size_" + ( v11 );
        }
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(r1);
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(r1);
        }
        r0 += closeAttrs(a0);
        r0 += "</span>";

        return r0;
    };
    M.t9.j = j0;
    M.t9.a = 0;

    // match .* : button-icon__attrs
    M.t10 = function t10(m, c0, i0, l0, a0) {
        var r0 = '';

        var items0 = m.s(j9, c0);
        for (var i1 = 0, l1 = items0.length; i1 < l1; i1++) {
            var c1 = items0[ i1 ];
            a0.a[ ( c1.name ) ] = new yr.scalarAttr(nodeset2scalar( m.s(j1, c1) ));
        }

        return r0;
    };
    M.t10.j = j0;
    M.t10.a = 0;

    // match .* : button-link
    M.t11 = function t11(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<a class=\"" + "button-link link link_mute" + "\" href=\"" + nodeset2attrvalue( ( selectNametest('href', c0, []) ) ) + "\">";
        r0 += "<span class=\"" + "icon icon_" + nodeset2attrvalue( ( selectNametest('icon', c0, []) ) ) + "\"></span>";
        r0 += "<span class=\"" + "button-link__label" + "\">";
        r0 += nodeset2xml( selectNametest('text', c0, []) );
        r0 += "</span>";
        r0 += "</a>";

        return r0;
    };
    M.t11.j = j0;
    M.t11.a = 0;

    // match .* : button__icon
    M.t12 = function t12(m, c0, i0, l0, a0, v12) {
        var r0 = '';

        r0 += closeAttrs(a0);
        if (simpleBoolean('icon', c0)) {
            r0 += "<span";
            a0.a = {
                'class': new yr.scalarAttr("icon icon_" + nodeset2scalar( ( selectNametest('icon', c0, []) ) ))
            };
            a0.s = 'span';
            if (v12) {
                var tmp0 = a0.a[ "class" ];
                if (tmp0) {
                    a0.a[ "class" ] = tmp0.addscalar(" icon_size_" + ( v12 ));
                } else {
                    a0.a[ "class" ] = new yr.scalarAttr(" icon_size_" + ( v12 ));
                }
            }
            r0 += closeAttrs(a0);
            r0 += "</span>";
        }

        return r0;
    };
    M.t12.j = j0;
    M.t12.a = 0;

    // match .* : head
    M.t13 = function t13(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("head act_all-listener")
        };
        a0.s = 'div';
        var r1 = {};
        r1[ "icon" ] = yr.nodeset2data(selectNametest('icon', c0, []));
        r1[ "text" ] = yr.nodeset2data(selectNametest('text', c0, []));
        r1[ "href" ] = yr.nodeset2data(selectNametest('href', c0, []));
        r0 += m.a(m, yr.object2nodeset(r1), 'button-link', a0)
        r0 += m.a(m, selectNametest('service', c0, []), 'volume-control', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t13.j = j0;
    M.t13.a = 0;

    // match .* : loading
    M.t14 = function t14(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("loading")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "loading", true));
        r0 += m.a(m, m.s(j1, c0), 'spinner', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t14.j = j0;
    M.t14.a = 0;

    // match .*[ .icon && !.parentId && .children ] : nav-item
    M.t15 = function t15(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<a";
        a0.a = {
            'class': new yr.scalarAttr("nav-item"),
            'href': new yr.scalarAttr("/nav/" + nodeset2scalar( ( m.s(j16, c0) ) ) + "/" + nodeset2scalar( ( m.s(j17, c0) ) ))
        };
        a0.s = 'a';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "nav-item"));
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(" nav-item_type_styled");
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(" nav-item_type_styled");
        }
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(" nav-item_arrow");
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(" nav-item_arrow");
        }
        r0 += m.a(m, m.s(j1, c0), 'nav-item__icon', a0)
        r0 += m.a(m, m.s(j1, c0), 'nav-item__title', a0)
        r0 += closeAttrs(a0);
        r0 += "</a>";

        return r0;
    };
    M.t15.j = j15;
    M.t15.a = 0;

    // match .*[ .icon && !.parentId && !.children ] : nav-item
    M.t16 = function t16(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item nav-item_type_link")
        };
        a0.s = 'span';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "nav-item"));
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(" nav-item_type_styled");
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(" nav-item_type_styled");
        }
        r0 += m.a(m, m.s(j1, c0), 'nav-item__icon', a0)
        r0 += m.a(m, m.s(j1, c0), 'nav-item__title', a0)
        r0 += closeAttrs(a0);
        r0 += "</span>";

        return r0;
    };
    M.t16.j = j18;
    M.t16.a = 0;

    // match .*[ .icon && .parentId ] : nav-item
    M.t17 = function t17(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item nav-item_type_link")
        };
        a0.s = 'span';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "nav-item"));
        r0 += m.a(m, m.s(j1, c0), 'nav-item__title', a0)
        r0 += closeAttrs(a0);
        r0 += "</span>";

        return r0;
    };
    M.t17.j = j19;
    M.t17.a = 0;

    // match .*[ !.icon ] : nav-item
    M.t18 = function t18(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<a";
        a0.a = {
            'class': new yr.scalarAttr("nav-item nav-item_type_root"),
            'href': new yr.scalarAttr("/nav/" + nodeset2scalar( ( selectNametest('id', c0, []) ) ))
        };
        a0.s = 'a';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "nav-item"));
        var tmp0 = a0.a[ "class" ];
        if (tmp0) {
            a0.a[ "class" ] = tmp0.addscalar(" nav-item_arrow");
        } else {
            a0.a[ "class" ] = new yr.scalarAttr(" nav-item_arrow");
        }
        r0 += m.a(m, m.s(j1, c0), 'nav-item__title', a0, "link")
        r0 += closeAttrs(a0);
        r0 += "</a>";

        return r0;
    };
    M.t18.j = j20;
    M.t18.a = 0;

    // match .*[ .id == "user" ] : nav-item
    M.t19 = function t19(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item nav-item_type_link nav-item_type_root")
        };
        a0.s = 'span';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "nav-item"));
        r0 += closeAttrs(a0);
        r0 += "<span class=\"" + "nav-item__title" + "\">";
        r0 += "Моя станция";
        r0 += "</span>";
        r0 += "</span>";

        return r0;
    };
    M.t19.j = j22;
    M.t19.a = 0;

    // match .*[ .id == "user" && !.children ] : nav-item
    M.t20 = function t20(m, c0, i0, l0, a0) {
        var r0 = '';

        return r0;
    };
    M.t20.j = j23;
    M.t20.a = 0;

    // match .* : nav-item__icon
    M.t21 = function t21(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item__icon")
        };
        a0.s = 'span';
        var r1 = '';
        var a1 = { a: {} };
        r1 += "background-color: " + nodeset2scalar( ( m.s(j24, c0) ) );
        a0.a[ "style" ] = new yr.scalarAttr(r1);
        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item__img")
        };
        a0.s = 'span';
        var r1 = '';
        var a1 = { a: {} };
        r1 += "background-image: url(" + ( (yr.externals['cover'])(nodeset2scalar( m.s(j25, c0) ), 100) ) + ")";
        a0.a[ "style" ] = new yr.scalarAttr(r1);
        r0 += closeAttrs(a0);
        r0 += "</span>";
        r0 += "</span>";

        return r0;
    };
    M.t21.j = j0;
    M.t21.a = 0;

    // match .* : nav-item__title
    M.t22 = function t22(m, c0, i0, l0, a0, v13) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("nav-item__title")
        };
        a0.s = 'span';
        if ((v13)) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" " + ( v13 ));
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" " + ( v13 ));
            }
        }
        r0 += closeAttrs(a0);
        r0 += nodeset2xml( selectNametest('name', c0, []) );
        r0 += "</span>";

        return r0;
    };
    M.t22.j = j0;
    M.t22.a = 0;

    // match .* : play
    M.t23 = function t23(m, c0, i0, l0, a0, v14) {
        var r0 = '';

        //  var class : scalar
        var r1 = '';
        var a1 = { a: {} };
        r1 += "play act act_play";
        if (cmpSN((yr.externals['consts'])("STATE_PLAYING"), selectNametest('state', c0, []))) {
            r1 += " playing";
        }
        if (cmpSN("disabled", m.s(j28, c0))) {
            r1 += " disabled";
        }
        var v15 = r1;

        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        var r1 = {};
        r1[ "icon" ] = "pp";
        var r2 = {};
        var a2 = { a: {} };
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button-icon', a0, v15, v14)

        return r0;
    };
    M.t23.j = j0;
    M.t23.a = 0;

    // match .* : player-controls
    M.t24 = function t24(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("player-controls")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "player-controls", true));
        r0 += m.a(m, m.s(j1, c0), 'player-controls__blur', a0)
        r0 += m.a(m, m.s(j1, c0), 'player-controls__main', a0)
        r0 += m.a(m, m.s(j1, c0), 'track-controls', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t24.j = j0;
    M.t24.a = 0;

    // match .* : player-controls__main
    M.t25 = function t25(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "player-controls__main" + "\">";
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("player-controls__icon")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'service-icon', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";
        r0 += m.a(m, m.s(j1, c0), 'service-title', a0)
        r0 += m.a(m, m.s(j1, c0), 'player-controls__bar', a0)
        r0 += "</div>";

        return r0;
    };
    M.t25.j = j0;
    M.t25.a = 0;

    // match .*[ !.id ] : player-controls__main
    M.t26 = function t26(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "player-controls__main" + "\">";
        r0 += "<div class=\"" + "player-controls__tip" + "\">";
        r0 += "Откройте ";
        r0 += "<a href=\"" + "https://music.yandex.ru" + "\" class=\"" + "link link_mute" + "\" target=\"" + "_blank" + "\">" + "музыкальный сайт" + "</a>";
        r0 += " или воспользуйтесь нашим ";
        r0 += "<a href=\"" + "/nav" + "\" class=\"" + "link link_mute" + "\">" + "каталогом" + "</a>";
        r0 += "</div>";
        var r1 = {};
        r1[ "id" ] = "empty";
        var r2 = {};
        var a2 = { a: {} };
        r2[ "play" ] = "disabled";
        r2[ "prev" ] = "disabled";
        r2[ "next" ] = "disabled";
        r1[ "buttons" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'player-controls__bar', a0)
        r0 += "</div>";

        return r0;
    };
    M.t26.j = j29;
    M.t26.a = 0;

    // match .* : player-controls__bar
    M.t27 = function t27(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("player-controls__bar act act_track act_active-changed")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'player-controls__prev', a0)
        r0 += m.a(m, m.s(j1, c0), 'play', a0, "L")
        r0 += m.a(m, m.s(j1, c0), 'player-controls__next', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t27.j = j0;
    M.t27.a = 0;

    // match .*[ !.id ] : player-controls__bar
    M.t28 = function t28(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "player-controls__bar act act_track act_active-changed" + "\">";
        r0 += "</div>";

        return r0;
    };
    M.t28.j = j29;
    M.t28.a = 0;

    // match .*[ .context.color ] : player-controls__blur
    M.t29 = function t29(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("player-controls__blur")
        };
        a0.s = 'div';
        var tmp0 = a0.a[ "style" ];
        if (tmp0) {
            a0.a[ "style" ] = tmp0.addscalar("background-color: " + nodeset2scalar( ( m.s(j30, c0) ) ) + ";");
        } else {
            a0.a[ "style" ] = new yr.scalarAttr("background-color: " + nodeset2scalar( ( m.s(j30, c0) ) ) + ";");
        }
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t29.j = j31;
    M.t29.a = 0;

    // match .* : player-controls__prev
    M.t30 = function t30(m, c0, i0, l0, a0) {
        var r0 = '';

        //  var class : scalar
        var r1 = '';
        var a1 = { a: {} };
        r1 += "act act_prev";
        if (cmpSN("disabled", m.s(j32, c0))) {
            r1 += " disabled";
        }
        var v16 = r1;

        var r1 = {};
        r1[ "icon" ] = "prev";
        var r2 = {};
        var a2 = { a: {} };
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button-icon', a0, v16, "L")

        return r0;
    };
    M.t30.j = j0;
    M.t30.a = 0;

    // match .* : player-controls__next
    M.t31 = function t31(m, c0, i0, l0, a0) {
        var r0 = '';

        //  var class : scalar
        var r1 = '';
        var a1 = { a: {} };
        r1 += "act act_next";
        if (cmpSN("disabled", m.s(j33, c0))) {
            r1 += " disabled";
        }
        var v17 = r1;

        var r1 = {};
        r1[ "icon" ] = "next";
        var r2 = {};
        var a2 = { a: {} };
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button-icon', a0, v17, "L")

        return r0;
    };
    M.t31.j = j0;
    M.t31.a = 0;

    // match .* : service-icon
    M.t32 = function t32(m, c0, i0, l0, a0, v18, v19) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-icon service-icon_hover act act_activate")
        };
        a0.s = 'div';
        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        r0 += m.a(m, m.s(j1, c0), 'service-icon__content', a0, v18, v19)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t32.j = j0;
    M.t32.a = 0;

    // match .*[ .id == "radio" ] : service-icon
    M.t33 = function t33(m, c0, i0, l0, a0, v20, v21) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-icon")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'service-icon__content', a0, v20, v21)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t33.j = j34;
    M.t33.a = 0;

    // match .* : service-icon__content
    M.t34 = function t34(m, c0, i0, l0, a0, v22, v23) {
        var r0 = '';

        if (v22) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" service-icon_size_" + ( v22 ));
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" service-icon_size_" + ( v22 ));
            }
        }
        if (nodeset2boolean( m.s(j30, c0) )) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" service-icon_bg");
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" service-icon_bg");
            }
            var tmp0 = a0.a[ "style" ];
            if (tmp0) {
                a0.a[ "style" ] = tmp0.addscalar(" background-color: " + nodeset2scalar( ( m.s(j30, c0) ) ));
            } else {
                a0.a[ "style" ] = new yr.scalarAttr(" background-color: " + nodeset2scalar( ( m.s(j30, c0) ) ));
            }
        }
        r0 += closeAttrs(a0);
        r0 += "<span";
        a0.a = {
            'class': new yr.scalarAttr("service-icon__img")
        };
        a0.s = 'span';
        var r1 = '';
        var a1 = { a: {} };
        r1 += "background-image: url(" + nodeset2scalar( ( m.s(j35, c0) ) ) + ")";
        a0.a[ "style" ] = new yr.scalarAttr(r1);
        r0 += closeAttrs(a0);
        r0 += "</span>";
        if ((v23)) {
            r0 += "<div";
            a0.a = {
                'class': new yr.scalarAttr("service-icon__shim act act_close")
            };
            a0.s = 'div';
            a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
            r0 += closeAttrs(a0);
            r0 += "<span class=\"" + "icon icon_close" + "\"></span>";
            r0 += "</div>";
        }

        return r0;
    };
    M.t34.j = j0;
    M.t34.a = 0;

    // match .* : service-title
    M.t35 = function t35(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-title")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "service-title"));
        r0 += m.a(m, m.s(j1, c0), 'service-title__title', a0)
        r0 += m.a(m, m.s(j1, c0), 'service-title__source', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t35.j = j0;
    M.t35.a = 0;

    // match .* : service-title__title
    M.t36 = function t36(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-title__title link act act_activate"),
            'title': new yr.scalarAttr(nodeset2scalar( ( m.s(j36, c0) ) ))
        };
        a0.s = 'div';
        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        if (nodeset2boolean( (m.s(j30, c0)) )) {
            a0.a[ "style" ] = new yr.scalarAttr("color: " + nodeset2scalar( ( m.s(j30, c0) ) ));
        }
        r0 += closeAttrs(a0);
        r0 += nodeset2xml( m.s(j36, c0) );
        r0 += "</div>";

        return r0;
    };
    M.t36.j = j0;
    M.t36.a = 0;

    // match .*[ .id == "radio" ] : service-title__title
    M.t37 = function t37(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-title__title"),
            'title': new yr.scalarAttr(nodeset2scalar( ( m.s(j36, c0) ) ))
        };
        a0.s = 'div';
        if (nodeset2boolean( (m.s(j30, c0)) )) {
            a0.a[ "style" ] = new yr.scalarAttr("color: " + nodeset2scalar( ( m.s(j30, c0) ) ));
        }
        r0 += closeAttrs(a0);
        r0 += nodeset2xml( m.s(j36, c0) );
        r0 += "</div>";

        return r0;
    };
    M.t37.j = j34;
    M.t37.a = 0;

    // match .* : service-title__source
    M.t38 = function t38(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-title__source link act act_activate")
        };
        a0.s = 'div';
        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        r0 += closeAttrs(a0);
        r0 += scalar2xml( (yr.externals['serviceName'])(nodeset2scalar( m.s(j37, c0) )) );
        r0 += "</div>";

        return r0;
    };
    M.t38.j = j0;
    M.t38.a = 0;

    // match .*[ .id == "radio" ] : service-title__source
    M.t39 = function t39(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "service-title__source" + "\">";
        r0 += scalar2xml( (yr.externals['serviceName'])(nodeset2scalar( m.s(j37, c0) )) );
        r0 += "</div>";

        return r0;
    };
    M.t39.j = j34;
    M.t39.a = 0;

    // match .*[ .id == "history" ] : service-title__source
    M.t40 = function t40(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service-title__source link act act_activate")
        };
        a0.s = 'div';
        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        r0 += closeAttrs(a0);
        r0 += "Продолжить слушать?";
        r0 += "</div>";

        return r0;
    };
    M.t40.j = j38;
    M.t40.a = 0;

    // match .* : service
    M.t41 = function t41(m, c0, i0, l0, a0, v24) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("service")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "service"));
        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));
        if (v24) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" " + ( v24 ));
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" " + ( v24 ));
            }
        }
        r0 += m.a(m, m.s(j1, c0), 'service-icon', a0, "s", true)
        r0 += m.a(m, m.s(j1, c0), 'service-title', a0)
        r0 += m.a(m, m.s(j1, c0), 'play', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t41.j = j0;
    M.t41.a = 0;

    // match .* : track-controls
    M.t42 = function t42(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track-controls _hidden act act_track act_active-changed")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'track-controls__attrs', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t42.j = j0;
    M.t42.a = 0;

    // match .*[ .track.title ] : track-controls
    M.t43 = function t43(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track-controls act act_track act_active-changed")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'track-controls__attrs', a0)
        r0 += m.a(m, selectNametest('track', c0, []), 'track', a0, simpleScalar('id', c0))
        r0 += m.a(m, m.s(j1, c0), 'track-controls__bar', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t43.j = j40;
    M.t43.a = 0;

    // match .*[ .context.bar == "barLike" ] : track-controls__bar
    M.t44 = function t44(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track-controls__bar")
        };
        a0.s = 'div';
        var r1 = {};
        var r2 = '';
        var a2 = { a: {} };
        if (nodeset2boolean( m.s(j44, c0) )) {
            r2 += "heart_on";
        } else {
            r2 += "heart";
        }
        r1[ "icon" ] = r2;
        var r2 = {};
        var a2 = { a: {} };
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button', a0, "M", "act act_like")
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t44.j = j43;
    M.t44.a = 0;

    // match .*[ .context.bar == "barFeedback" ] : track-controls__bar
    M.t45 = function t45(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track-controls__bar")
        };
        a0.s = 'div';
        var r1 = {};
        r1[ "icon" ] = "dislike";
        var r2 = {};
        var a2 = { a: {} };
        r2[ "title" ] = yr.nodeset2data(selectNametest('tooltipText', c0, []));
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button', a0, "M", "button_pin_right act act_dislike")
        var r1 = {};
        var r2 = '';
        var a2 = { a: {} };
        if (nodeset2boolean( m.s(j44, c0) )) {
            r2 += "like_on";
        } else {
            r2 += "like";
        }
        r1[ "icon" ] = r2;
        var r2 = {};
        var a2 = { a: {} };
        r2[ "data-act-target" ] = yr.nodeset2data(selectNametest('id', c0, []));
        r2[ "title" ] = yr.nodeset2data(selectNametest('tooltipText', c0, []));
        r1[ "attrs" ] = r2;
        r0 += m.a(m, yr.object2nodeset(r1), 'button', a0, "M", "button_pin_left act act_like")
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t45.j = j45;
    M.t45.a = 0;

    // match .* : track-controls__attrs
    M.t46 = function t46(m, c0, i0, l0, a0) {
        var r0 = '';

        a0.a[ "data-act-target" ] = new yr.scalarAttr(simpleScalar('id', c0));

        return r0;
    };
    M.t46.j = j0;
    M.t46.a = 0;

    // match .* : track
    M.t47 = function t47(m, c0, i0, l0, a0, v25) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "track"));
        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("track__info")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'track__title', a0, v25)
        r0 += m.a(m, m.s(j1, c0), 'track__artist', a0, v25)
        r0 += closeAttrs(a0);
        r0 += "</div>";
        r0 += "</div>";

        return r0;
    };
    M.t47.j = j0;
    M.t47.a = 0;

    // match .* : track__title
    M.t48 = function t48(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "track__title" + "\" title=\"" + nodeset2attrvalue( ( selectNametest('title', c0, []) ) ) + "\">";
        r0 += nodeset2xml( selectNametest('title', c0, []) );
        r0 += "</div>";

        return r0;
    };
    M.t48.j = j0;
    M.t48.a = 0;

    // match .*[ .url ] : track__title
    M.t49 = function t49(m, c0, i0, l0, a0, v26) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<a";
        a0.a = {
            'class': new yr.scalarAttr("track__title link act act_link"),
            'href': new yr.scalarAttr(nodeset2scalar( ( selectNametest('url', c0, []) ) )),
            'target': new yr.scalarAttr("_yaMusic"),
            'title': new yr.scalarAttr(nodeset2scalar( ( selectNametest('title', c0, []) ) ))
        };
        a0.s = 'a';
        if ((v26)) {
            a0.a[ "data-act-target" ] = new yr.scalarAttr(v26);
        }
        r0 += closeAttrs(a0);
        r0 += nodeset2xml( selectNametest('title', c0, []) );
        r0 += "</a>";

        return r0;
    };
    M.t49.j = j49;
    M.t49.a = 0;

    // match .* : track__artist
    M.t50 = function t50(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "track__artist" + "\" title=\"" + nodeset2attrvalue( ( selectNametest('artist', c0, []) ) ) + "\">";
        r0 += nodeset2xml( selectNametest('artist', c0, []) );
        r0 += "</div>";

        return r0;
    };
    M.t50.j = j0;
    M.t50.a = 0;

    // match .*[ .artistUrl ] : track__artist
    M.t51 = function t51(m, c0, i0, l0, a0, v27) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<a";
        a0.a = {
            'class': new yr.scalarAttr("track__artist link act act_link"),
            'href': new yr.scalarAttr(nodeset2scalar( ( selectNametest('artistUrl', c0, []) ) )),
            'target': new yr.scalarAttr("_yaMusic"),
            'title': new yr.scalarAttr(nodeset2scalar( ( selectNametest('artist', c0, []) ) ))
        };
        a0.s = 'a';
        if ((v27)) {
            a0.a[ "data-act-target" ] = new yr.scalarAttr(v27);
        }
        r0 += closeAttrs(a0);
        r0 += nodeset2xml( selectNametest('artist', c0, []) );
        r0 += "</a>";

        return r0;
    };
    M.t51.j = j52;
    M.t51.a = 0;

    // match .* : volume-control
    M.t52 = function t52(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("volume-control volume volume_position_top act act_active-changed")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "volume", true));
        if ((!(cmpSN("visible", m.s(j53, c0))))) {
            var tmp0 = a0.a[ "class" ];
            if (tmp0) {
                a0.a[ "class" ] = tmp0.addscalar(" _hidden");
            } else {
                a0.a[ "class" ] = new yr.scalarAttr(" _hidden");
            }
        }
        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "volume__control" + "\">";
        r0 += "<div class=\"" + "volume__track" + "\">";
        r0 += "<div class=\"" + "volume__filled" + "\" style=\"" + "height: 20px;" + "\"></div>";
        r0 += "</div>";
        r0 += "</div>";
        r0 += "<div class=\"" + "volume__holder" + "\">";
        r0 += "</div>";
        r0 += "<div class=\"" + "volume__btn" + "\">";
        r0 += "<div class=\"" + "volume__icon" + "\"></div>";
        r0 += "</div>";
        r0 += "</div>";

        return r0;
    };
    M.t52.j = j0;
    M.t52.a = 0;

    // match / : page-index
    M.t53 = function t53(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("page-index")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "page-index"));
        var r1 = {};
        r1[ "icon" ] = "lines";
        r1[ "text" ] = "Больше музыки";
        r1[ "href" ] = "/nav";
        r1[ "service" ] = yr.nodeset2data(m.s(j1, c0));
        r0 += m.a(m, yr.object2nodeset(r1), 'head', a0)
        r0 += m.a(m, m.s(j1, c0), 'player-controls', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";

        return r0;
    };
    M.t53.j = 1;
    M.t53.a = 1;

    // match / : page-nav
    M.t54 = function t54(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("page-nav")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "page-nav"));
        var r1 = {};
        r1[ "icon" ] = "dropdown";
        r1[ "text" ] = "Назад";
        r1[ "href" ] = yr.nodeset2data(selectNametest('parent', c0, []));
        r0 += m.a(m, yr.object2nodeset(r1), 'head', a0)
        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("page-nav__items")
        };
        a0.s = 'div';
        var items0 = selectNametest('items', c0, []);
        for (var i1 = 0, l1 = items0.length; i1 < l1; i1++) {
            var c1 = items0[ i1 ];
            r0 += m.a(m, m.s(j1, c1), 'nav-item', a0)
        }
        r0 += closeAttrs(a0);
        r0 += "</div>";
        r0 += "</div>";

        return r0;
    };
    M.t54.j = 1;
    M.t54.a = 1;

    // match / : page-services
    M.t55 = function t55(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("page-services")
        };
        a0.s = 'div';
        a0.a[ "data-b" ] = new yr.scalarAttr((yr.externals['blockRoot'])(m.s(j1, c0), "page-services"));
        var r1 = {};
        r1[ "icon" ] = "lines";
        r1[ "text" ] = "Больше музыки";
        r1[ "href" ] = "/nav";
        r1[ "service" ] = yr.nodeset2data(selectNametest('selected', c0, []));
        r0 += m.a(m, yr.object2nodeset(r1), 'head', a0)
        r0 += closeAttrs(a0);
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("page-services__services")
        };
        a0.s = 'div';
        var items0 = selectNametest('services', c0, []);
        for (var i1 = 0, l1 = items0.length; i1 < l1; i1++) {
            var c1 = items0[ i1 ];
            if ((l1 - i1 <= 8)) {
                //  var class : scalar
                var r1 = '';
                var a1 = { a: {} };
                if (cmpNN(selectNametest('id', c1, []), m.s(j59, c1))) {
                    r1 += "service_selected";
                }
                var v28 = r1;

                r0 += m.a(m, m.s(j1, c1), 'service', a0, v28)
            }
        }
        r0 += closeAttrs(a0);
        r0 += "</div>";
        r0 += "<div";
        a0.a = {
            'class': new yr.scalarAttr("act_all-listener")
        };
        a0.s = 'div';
        r0 += m.a(m, m.s(j1, c0), 'page-service__bar', a0)
        r0 += closeAttrs(a0);
        r0 += "</div>";
        r0 += "</div>";

        return r0;
    };
    M.t55.j = 1;
    M.t55.a = 1;

    // match .* : page-service__bar
    M.t56 = function t56(m, c0, i0, l0, a0) {
        var r0 = '';

        //  var selected : object
        var r1 = {};
        var a1 = { a: {} };
        r1[ "id" ] = "";
        var v29 = r1;

        r0 += m.a(m, yr.object2nodeset(v29), 'player-controls__bar', a0)
        r0 += m.a(m, yr.object2nodeset(v29), 'track-controls', a0)

        return r0;
    };
    M.t56.j = j0;
    M.t56.a = 0;

    // match .*[ .selected ] : page-service__bar
    M.t57 = function t57(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += m.a(m, selectNametest('selected', c0, []), 'player-controls__bar', a0)
        r0 += m.a(m, selectNametest('selected', c0, []), 'track-controls', a0)

        return r0;
    };
    M.t57.j = j60;
    M.t57.a = 0;

    // match /
    M.t58 = function t58(m, c0, i0, l0, a0) {
        var r0 = '';

        r0 += closeAttrs(a0);
        r0 += "<div class=\"" + "centerblock" + "\">";
        r0 += "</div>";
        r0 += m.a(m, m.s(j1, c0), 'loading', a0)

        return r0;
    };
    M.t58.j = 1;
    M.t58.a = 1;

    M.matcher = {
        "button": {
            "*": [
                "t0"
            ]
        },
        "button__class": {
            "*": [
                "t1"
            ]
        },
        "button__attrs": {
            "*": [
                "t2"
            ]
        },
        "button__content": {
            "*": [
                "t3"
            ]
        },
        "button__icon": {
            "*": [
                "t12",
                "t4"
            ]
        },
        "button__label": {
            "*": [
                "t5"
            ]
        },
        "spinner": {
            "*": [
                "t6"
            ]
        },
        "volume": {
            "*": [
                "t7"
            ]
        },
        "button-icon": {
            "*": [
                "t8"
            ]
        },
        "button-icon__icon": {
            "*": [
                "t9"
            ]
        },
        "button-icon__attrs": {
            "*": [
                "t10"
            ]
        },
        "button-link": {
            "*": [
                "t11"
            ]
        },
        "head": {
            "*": [
                "t13"
            ]
        },
        "loading": {
            "*": [
                "t14"
            ]
        },
        "nav-item": {
            "*": [
                "t20",
                "t19",
                "t18",
                "t17",
                "t16",
                "t15"
            ]
        },
        "nav-item__icon": {
            "*": [
                "t21"
            ]
        },
        "nav-item__title": {
            "*": [
                "t22"
            ]
        },
        "play": {
            "*": [
                "t23"
            ]
        },
        "player-controls": {
            "*": [
                "t24"
            ]
        },
        "player-controls__main": {
            "*": [
                "t26",
                "t25"
            ]
        },
        "player-controls__bar": {
            "*": [
                "t28",
                "t27"
            ]
        },
        "player-controls__blur": {
            "*": [
                "t29"
            ]
        },
        "player-controls__prev": {
            "*": [
                "t30"
            ]
        },
        "player-controls__next": {
            "*": [
                "t31"
            ]
        },
        "service-icon": {
            "*": [
                "t33",
                "t32"
            ]
        },
        "service-icon__content": {
            "*": [
                "t34"
            ]
        },
        "service-title": {
            "*": [
                "t35"
            ]
        },
        "service-title__title": {
            "*": [
                "t37",
                "t36"
            ]
        },
        "service-title__source": {
            "*": [
                "t40",
                "t39",
                "t38"
            ]
        },
        "service": {
            "*": [
                "t41"
            ]
        },
        "track-controls": {
            "*": [
                "t43",
                "t42"
            ]
        },
        "track-controls__bar": {
            "*": [
                "t45",
                "t44"
            ]
        },
        "track-controls__attrs": {
            "*": [
                "t46"
            ]
        },
        "track": {
            "*": [
                "t47"
            ]
        },
        "track__title": {
            "*": [
                "t49",
                "t48"
            ]
        },
        "track__artist": {
            "*": [
                "t51",
                "t50"
            ]
        },
        "volume-control": {
            "*": [
                "t52"
            ]
        },
        "page-index": {
            "": [
                "t53"
            ]
        },
        "page-nav": {
            "": [
                "t54"
            ]
        },
        "page-services": {
            "": [
                "t55"
            ]
        },
        "page-service__bar": {
            "*": [
                "t57",
                "t56"
            ]
        },
        "": {
            "": [
                "t58"
            ]
        }
    };
    M.imports = [];

    yr.register('index', M);

})();
}
,"lib/js.js": function(module, exports, require, global) {
require("../js/popup/actionDispatcher.js");
require("../js/popup/datasrc.js");
require("../js/popup/layout.js");
require("../js/popup/navigation.js");
require("../js/popup/pages.js");
require("../js/popup/routes.js");
require("../js/popup/yate.externals.js");
}
,"js/popup/actionDispatcher.js": function(module, exports, require, global) {
;(function() {

    var Msg, Nav, Layout;
    var $window, $body;

    var Dispatcher = function() {
    };

    Dispatcher.prototype.init = function(di) {
        Msg = di.get("msg");
        Nav = di.get("navigation");
        Layout = di.get("layout");

        $window = $(window);
        $body = $(document.body);

        Msg.on(Mu.consts.ACTION_TRACK, this.onActionUpdate.bind(this, "act_track"));
        Msg.on(Mu.consts.ACTION_STATE, this.onState.bind(this));
        Msg.on(Mu.consts.ACTION_BTN_STATE, this.onButtonState.bind(this));
        Msg.on(Mu.consts.ACTION_ACTIVE_CHANGED, this.onActionUpdate.bind(this, "act_active-changed"));

        Msg.on(Mu.consts.ACTION_ACTIVE_CHANGED, this.setActiveService.bind(this));

        $body.on("click", ".act.act_activate", this.onActionClick.bind(this, Mu.consts.ACTION_SELECT_TAB));
        $body.on("click", ".act.act_play", this.onActionClick.bind(this, Mu.consts.ACTION_PLAY));
        $body.on("click", ".act.act_next", this.onActionClick.bind(this, Mu.consts.ACTION_NEXT));
        $body.on("click", ".act.act_prev", this.onActionClick.bind(this, Mu.consts.ACTION_PREV));
        $body.on("click", ".act.act_like", this.onActionClick.bind(this, Mu.consts.ACTION_LIKE));
        $body.on("click", ".act.act_dislike", this.onActionClick.bind(this, Mu.consts.ACTION_DISLIKE));
        $body.on("click", ".act.act_close", this.onActionClick.bind(this, Mu.consts.ACTION_CLOSE_TAB));
        $body.on("click", ".act.act_link", this.onLinkClick.bind(this));
    };

    Dispatcher.prototype.onActionClick = function(action, evt) {
        var $target = $(evt.target).closest(".act");
        if (!action ||
            !$target.length ||
            $target.hasClass("disabled")) {
            return;
        }
        var id = $target.attr("data-act-target");
        if (typeof id !== "undefined") {
            Msg.send(action, { id: isNaN(id) ? id : +id });
        }
        evt.stopPropagation();
    };

    Dispatcher.prototype.onLinkClick = function(evt) {
        var $target = $(evt.target).closest(".act");
        if (!$target.length) {
            return;
        }
        var id = $target.attr("data-act-target");
        var url = $target.attr("href");
        Msg.send(Mu.consts.ACTION_OPEN_LINK, { id: isNaN(id) ? id : +id, url: url });
        evt.preventDefault();
    };

    Dispatcher.prototype.onActionUpdate = function(selector, evt) {
        var self = this;
        var elements = this.getElements(evt.data.id, selector);
        elements.forEach(function(elem) {
            self.refresh(elem, evt.data);
        });
    };

    Dispatcher.prototype.onState = function(evt) {
        var elements = this.getElements(evt.data.id, "act_play");
        elements.forEach(function(elem) {
            $(elem).toggleClass("playing", evt.data.state === Mu.consts.STATE_PLAYING);
        });
    };

    Dispatcher.prototype.onButtonState = function(evt) {
        var elements = this.getElements(evt.data.id, "act_" + evt.data.button);
        elements.forEach(function(elem) {
            var $elem = $(elem);
            $elem.toggleClass("disabled", evt.data.state === Mu.consts.BUTTON_STATE_DISABLED);
            $elem.toggleClass("hidden", evt.data.state === Mu.consts.BUTTON_STATE_HIDDEN);
        });
    };

    Dispatcher.prototype.setActiveService = function(evt) {
        var id = evt.data.id;
        $(".service.service_selected").toggleClass("service_selected", false);
        $(".service[data-act-target='" + id + "']").toggleClass("service_selected", true);
    };

    Dispatcher.prototype.getElements = function(id, type) {
        var selector = "";
        type = (type ? "." + type : "");
        selector += type + '.act[data-act-target="' + id + '"]';
        if (type) {
            selector += ", " + ".act_all-listener > " + type;
        }
        var $items = $(selector);
        var result = [];
        $items.each(function() {
            result.push(this);
        });
        return result;
    };

    Dispatcher.prototype.refresh = function(elem, data) {
        var tmpl = elem.classList[0];
        if (!tmpl) {
            return;
        }
        var $old = $(elem);
        var $new = $(Mu.render(tmpl, data));

        Layout.smoothResize(function() {
            $old.replaceWith($new);
        });

        Mu.blocks.forElem($new[0]);
    };

    //////////////////////////////

    Mu.Dispatcher = Dispatcher;

})();

}
,"js/popup/datasrc.js": function(module, exports, require, global) {
; (function() {

var Msg;

var Datasrc = function() {
    this.promises = {};
};

Datasrc.init = function(di) {
};

Datasrc.prototype.init = function(di) {
    Msg = di.get("msg");
    Msg.on(Mu.consts.ACTION_DATA_RES, this._onResponse.bind(this));
};

// this method returns a promise
Datasrc.prototype.get = function(what, params, options) {
    var deferred = Vow.defer();
    var uid = what + Math.random();
    var result = deferred.promise();

    this.promises[uid] = deferred;
    Msg.send(Mu.consts.ACTION_DATA_REQ, { what: what, uid: uid });
    return result;
};

Datasrc.prototype._onResponse = function(evt) {
    var data = evt.data;
    if (!data || !data.uid) {
        return;
    }
    var deferred = this.promises[data.uid];
    if (!deferred) {
        return
    }
    delete this.promises[data.uid];
    if (data.error) {
        deferred.reject(data.error);
    } else {
        deferred.resolve(data.data);
    }
};

//////////////////////////////
Mu.Datasrc = Datasrc;

})();

}
,"js/popup/layout.js": function(module, exports, require, global) {
;(function() {

    var $body;
    var Msg, Nav;

    var Layout = function() {
    };

    Layout.prototype.init = function(di) {
        Msg = di.get("msg");
        Nav = di.get("navigation");
        $body = $(document.body);

        Msg.on(Mu.consts.ACTION_STATE, function(evt) {
            $body.toggleClass("body_state_playing", evt.data === Mu.consts.STATE_PLAYING);
        });
        Msg.on(Mu.consts.ACTION_TABS_CHANGED, this.onTabsChanged.bind(this));
    };

    Layout.prototype.onTabsChanged = function(evt) {
        var tabs = evt.data || [];
        if (tabs.length < 2) {
            Nav.navigateTo("/");
        } else {
            Nav.navigateTo("/services");
        }
    };

    Layout.prototype.smoothResize = function(render) {
        render = render || function() {};
        render();
        return;
    };

    //////////////////////////////

    Mu.Layout = Layout;

})();
}
,"js/popup/navigation.js": function(module, exports, require, global) {
;(function() {
    var Navigation = {};
    var lastLoc;

    var loadLocation = function(url) {
        //if (lastLoc === url)
        //    return;
        lastLoc = url;
        Navigation.reload();
    };

    var clickHandler = function(evt) {
        var target = this.getAttribute("target", 2);

        if (target) {
            return;
        }
        if (evt.ctrlKey || evt.metaKey) {
            return;
        }
        var url = this.getAttribute("href", 2);
        if (!url)
            return;

        try {
            Navigation.navigateTo(url, true);
        } finally {
            evt.preventDefault();
            return false;
        }
    };

    Navigation.navigateTo = function(url) {
        if (url.charAt(0) !== "/")
            url = "/" + url;
        //if (lastLoc !== url) {
            loadLocation(url);
        //}
    };

    Navigation.reload = function() {
        var pageInfo = this.routes.match(lastLoc);
        this.pages.show(pageInfo.name, pageInfo.param);
    };

    Navigation.start = function() {
        //loadLocation("/");
    };

    Navigation.init = function(di) {
        this.pages = di.get("pages");
        this.routes = di.get("routes");
        this.msg = di.get("msg");

        // клики
        $(document.body).on("click", "a", clickHandler);
    };

//////////////////////////////
    Mu.navigation = Navigation;

})();

}
,"js/popup/pages.js": function(module, exports, require, global) {
;(function() {

    var BasePageManager = require("music-common/js/pageManager");

    //////////////////////////////

    var Pages = function() {
        BasePageManager.call(this);
    };
    $.extend(Pages.prototype, BasePageManager.prototype);

    Pages.prototype.init = function(di) {
        BasePageManager.prototype.init.call(this, di);
        this.parent = $(".centerblock")[0];
        this.layout = di.get("layout");
    };

    Pages.prototype.construct = function(name, params) {
        return BasePageManager.prototype.construct.call(this, name, params);
    };

    Pages.prototype.detach = function(page) {
        BasePageManager.prototype.detach.call(this, page);
    };

    Pages.prototype.onData = function(page, data) {
        var self = this;
        this.layout.smoothResize(function() {
            BasePageManager.prototype.onData.call(self, page, data);
        });
    };

    //////////////////////////////

    Mu.Pages = Pages;

})();
}
,"node_modules/music-common/js/pageManager.js": function(module, exports, require, global) {
;
(function() {

var BasePageManager = function() {
    this.repo = {};
    this.current = null;
    this.loading = null;
    this.parent = null;
    this.containerHtml = '<div>';
    this.blockPrefix = "page-";
    Mu.eventize(this);
};
BasePageManager.prototype.register = function(pageName, pageClass) {
    this.repo[pageName] = pageClass;
};
/** @abstract */
BasePageManager.prototype.show = function(name, param) {
    param = param || {};
    var page = this.construct(name, param);

    this.loading = page;
    this.trigger("loading", page);

    var pageData = Mu.pageData || page.data;
    var pageName = Mu.pageName || page.name;
    if (pageData && pageName === name) {
        delete Mu.pageData;
        delete Mu.pageName;
        if (pageData === 404) {
            this.onError(page, {error: "Not Found"});
            return;
        }
        this.onData(page, pageData);
    } else {
        var self = this;
        // TODO: catch errors in fetchData()
        page.fetchData(this.datasrc)
            .then(function(x) { self.onData(page, x); })
            // catching errors in promise and in onData()
            // TODO: this crashes IE7, wtf?
            .then(null, function(x) { self.onError(page, x); });
    }
};
/** @virtual */
BasePageManager.prototype.construct = function(name, param) {
    var page = new this.repo[name](param);
    page.container = $(this.containerHtml)[0];
    page.name = name;
    page.from = param && param.from;
    return page;
};
/** @virtual */
BasePageManager.prototype.detach = function(page) {
    $(page.container).remove().off();
    page.undelegateAll();
    page.container = null;
    this.blocks.cleanRange(page.bindingRange);
    if (page.destroy) {
        page.destroy();
    }
};
BasePageManager.prototype.render = function(page) {
    //TODO: this.blocks.resetBinding();
    if (page.rendered) {
        return;
    }
    this.blocks.beginBinding();
    try {
        this.blocks.assignNext(page);
        var html = Mu.render(page.templateName, page.data);
    } finally {
        page.bindingRange = this.blocks.endBinding();
    }

    page.container.innerHTML = html;
    this.blocks.initPendingBlocks(page.container);
    if (page.onRender) {
        page.onRender();
    }
    page.rendered = true;
};
BasePageManager.prototype.unloadPreviuos = function() {
    var cpage = this.current;
    this.trigger("unloading", cpage);

    if (!cpage) {
        return;
    }
    if (cpage.onHide) {
        cpage.onHide();
    }
    this.detach(cpage);
    this.trigger("unloaded", cpage);
};
BasePageManager.prototype.onData = function(page, data) {
    // TODO: almost everything here can throw, use try-catch
    if (page !== this.loading) {
        return;
    }

    this.unloadPreviuos();

    page.data = data;

    try {
        this.render(page);
    } catch(err) {
        delete Mu.pageData;
        this.onError(page, err);
        return;
    }

    // and show
    this.parent.appendChild(page.container);
    this.current = page;
    if (page.onShow) {
        page.onShow();
    }

    this.loading = null;
    this.trigger("loaded", page);
};
BasePageManager.prototype.onError = function(page, err) {
    if (page !== this.loading) {
        return;
    }
    if (page.name === "500") {
        alert("Error showing error: " + err.stack || JSON.stringify(err));
    } else {
        this.blocks.endBinding();
        if (err.error === "Not Found") {
            this.show("404");
        } else {
            this.show("500", {brokenPage: page, error: err});
        }
    }
};
BasePageManager.prototype.init = function(di) {
    this.datasrc = di.get("datasrc");
    this.blocks = di.get("blocks");

    for (var i in this.repo) {
        if (this.repo.hasOwnProperty(i)) {
            this.blocks.register(this.blockPrefix + i, this.repo[i]);
        }
    }
};

//////////////////////////////

module.exports = BasePageManager;

})();

}
,"js/popup/routes.js": function(module, exports, require, global) {
;(function() {

    var Routes = require("music-common/js/routes");

    Routes.items = [
        [Routes.named(/^\/?$/), "index"],
        [Routes.named(/^\/services(?:\/(:<serviceId>[^/?]*))?$/), "services"],
        [Routes.named(/^\/nav(?:\/(:<type>[^/?]*))?(?:\/(:<tag>[^/?]*))?$/), "nav"]
    ];

    Mu.routes = Routes;

})();

}
,"node_modules/music-common/js/routes.js": function(module, exports, require, global) {
; (function() {

    // WARNING: this file might be used both in browser and nodejs

    var Routes = {
        items: [],
        match: function(url) {
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
                var m = item[0].exec(url);
                if (m) {
                    m.query = m.query ? parseQuery(m.query) : {};
                    return { name: item[1], param: m };
                }
            }
            return { name: "404", param: { url: url } };
        },
        rewriteRules: [],
        rewriteFacebookParams: function(url) {
            var re = /[?&](song|musician|album|playlist)=([^&]*)/;
            var result = re.exec(url);
            if (!result || !result[2]) {
                return url;
            }
            var fbUrl = result[2];
            try {
                fbUrl = decodeURIComponent(fbUrl);
            } catch(err) {}
            fbUrl = fbUrl.replace(/https?:\/\/[^/]*\//, "/"); // remove protocol&host part
            return fbUrl;
        },
        rewrite: function(url) {
            //console.log("rewriteUrl(" + url + ")");
            url = this.rewriteFacebookParams(url);
            for (var i = 0; i < this.rewriteRules.length; i++) {
                var rule = this.rewriteRules[i];
                if (!rule[0].exec(url))
                    continue;
                url = url.replace(rule[0], rule[1]);
                if (rule[2] === "last")
                    break;
            }
            //console.log(" --> " + url);
            return url;
        },
        named: named
    };

    /////////////////////////////////////////////////////////////////////////////////////////
    /**
     * https://github.com/cho45/named-regexp.js
     * (c) cho45 http://cho45.github.com/mit-license
     * Recognize (:<name>regexp) format named captures.
     */
    function named(regexp) {
        var names = [];
        var ret = new RegExp(regexp.source.replace(/\(:<(\w+)>/g, function(_, name) {
            names.push(name);
            return '(';
        }),
                (regexp.global ? 'g' : '') +
                (regexp.ignoreCase ? 'i' : '') +
                (regexp.multiline ? 'm' : '')
        );

        var captures = function(matched) {
            if (!matched) return matched;
            for (var i = 0; i < names.length; i++) {
                matched[names[i]] = matched[i + 1];
            }
            return matched;
        };

        // override RegExp#exec
        ret.exec = function(string) {
            return captures(RegExp.prototype.exec.call(this, string));
        };

        return ret;
    }

    function parseQuery(qs) {
        var query = qs.split("&");
        var result = {};
        for (var i = 0; i < query.length; i++) {
            var pair = query[i].split('=');
            var value = pair[1] || "";
            value = value.replace(/\+/g, ' ');
            try {
                value = decodeURIComponent(value);
            } catch(err) {}
            result[pair[0]] = value;
        }
        return result;
    }
    ////////////////////////////////////////////////////////////////////////////////////////

    module.exports = Routes;

})();

}
,"js/popup/yate.externals.js": function(module, exports, require, global) {
;(function() {

    var yr = (typeof window !== "undefined" && window.yr) || require('yate/lib/runtime.js');
    var externals = yr.externals = yr.externals || {};
    var protocol = (typeof location !== "undefined") ? location.protocol : "https:";

    externals.cover = function(cover, sizeX) {
        var size;
        if (cover.indexOf("%%") !== -1) {
            // new cover format
            if (!sizeX) {
                size = "orig";
            } else if (sizeX) {
                size = "m" + sizeX + 'x' + sizeX;
            }
            return "https://" + cover.replace("%%", size);
        } else {
            return "";
        }
    };

    externals.serviceName = function(source) {
        if (!source) {
            return;
        }
        var match = /(?:\w*:?\/\/)?([\w\._-]{2,})(?:\/)?/.exec(source);
        return (match && match[1]) || source;
    };

    externals.consts = function(id) {
        return Mu.consts[id];
    };

})();

}
,"node_modules/music-common/js/mini-di.js": function(module, exports, require, global) {
; (function() {

    var MiniDi = function(noStrict) {
        this.repo = {};
        this.initPhase = null;
        this.noStrict = noStrict;
    };

    MiniDi.prototype.init = function(objects) {
        if (!objects || typeof (objects) !== "object")
            throw new Error("MiniDi.init() expects hash object or array as a parameter.");

        var objectsToInit = [];

        if (objects instanceof Array) {
            for (var i = 0; i < objects.length; i++) {
                if (typeof (objects[i].init) === "function") {
                    objectsToInit.push(i);
                }
            }
        } else {
            for (var n in objects) {
                this.provide(n, objects[n]);
                if (typeof (objects[n].init) === "function") {
                    objectsToInit.push(n);
                }
            }
        }

        for (var i = 0; i < objectsToInit.length; i++) {
            this.runInit(objectsToInit[i], objects[objectsToInit[i]]);
        }
    };

    MiniDi.prototype.get = function(name) {
        if (this.initPhase === null)
            throw new Error("MiniDi.get() cannot be called outside of .init() method.");
        if (!(name in this.repo) && !this.noStrict) {
            throw new Error("Object `" + name + "` required by `" + this.initPhase + "` not found in repository.");
        }
        return this.repo[name];
    };

    MiniDi.prototype.provide = function(name, obj) {
        if (name in this.repo)
            throw new Error("Object `" + name + "` has been already provided.");
        this.repo[name] = obj;
    };

    MiniDi.prototype.runInit = function(name, obj) {
        try {
            this.initPhase = name;
            obj.init(this);
        } finally {
            this.initPhase = null;
        }
    };

    //////////////////////////////
    Mu.MiniDi = MiniDi;

})();

}
,"node_modules/music-common/js/blocks.js": function(module, exports, require, global) {
; (function() {
    var externals = yr.externals = yr.externals || {};

    var MAX_INT = 4294967295;

    var DELEGATED_KEY = "__delegatedEvents";

    var BlockMixin = function(blocks) {
        var $body;
        var lastEvt; // sometimes jQuery fires this event twice, stupid piece of crap

        this.staticMethods = {
            domDelegate: function(event, selector, handler) {
                if (typeof selector === "function") {
                    handler = selector;
                    selector = undefined;
                }
                selector = selector || "";
                selector = selector.indexOf(":") === 0 ? selector : " " + selector;

                if (!$body)
                    $body = $(document.body);

                $body.on(event, "." + this.type + selector, function(evt) {
                    if (evt !== lastEvt) {
                        lastEvt = evt;
                        handler.call(this, evt);
                    }
                });
            }
        };

        this.methods = {
            getParent: function() {
                var node = this.container.parentNode;
                while (node) {
                    var block = blocks.forElem(node);
                    if (block)
                        return block;
                    node = node.parentNode;
                }
            },
            closestParent: function(type) {
                var block = this.getParent();
                while (block) {
                    if (block.constructor.type === type)
                        return block;
                    block = block.getParent();
                }
            },
            triggerEvent: function(evt) {
                if (!evt || !evt.type) {
                    throw new Error("Event required");
                }
                evt.target = this;

                // bubble this event up
                var block = this, delegated, arr;
                while (block) {
                    if ((delegated = block[DELEGATED_KEY]) && (arr = delegated[evt.type]))
                        arr.forEach(function(handler) {
                            var retVal = handler.call(block, evt);
                            if (retVal !== undefined)
                                evt.returnValue = retVal;
                        });
                    if (evt.stopBubble)
                        break;
                    block = block.getParent();
                }

                return evt.returnValue;
            },
            delegate: function(eventType, handler) {
                var delegated = this[DELEGATED_KEY] || (this[DELEGATED_KEY] = {});
                var arr = delegated[eventType] || (delegated[eventType] = []);
                arr.push(handler);
            },
            undelegateAll: function() {
                this[DELEGATED_KEY] = null;
            }
        };
    };
    BlockMixin.prototype.mix = function(obj) {
        $.extend(obj, this.staticMethods);
        $.extend(obj.prototype, this.methods);
        return obj;
    };

    var Blocks = function() {
        this.blocks = {};
        this.binding = {};
        this.bindingId = 1;
        this.objectToAssign = null;
        this.pendingBlocks = {};

        this.blockMixin = new BlockMixin(this);

        var blocks = this;
        externals.blockRoot = function(nodeset, type, requiresInit) {
            return blocks.bindModel(nodeset[0].data, type, requiresInit);
        };
    };

    Blocks.prototype.register = function(type, constructor) {
        this.blocks[type] = constructor;
        constructor.type = type;
        this.blockMixin.mix(constructor);
    };

    Blocks.prototype.get = function(type) {
        return this.blocks[type];
    };

    /**
     * Открывает новый «диапазон биндинга» — последовательность объектов, привязанных, например, к странице.
     * Этот диапазон нужен, чтобы потом при удалении страницы аккуратно почистить уже ненужные данные.
     */
    Blocks.prototype.beginBinding = function() {
        if (this.currentRange)
            throw "beginBinding() failed: end previous binding";
        this.currentRange = { start: this.bindingId, end: -1 };
    };

    /**
     * Завершает диапазон и возвращает его.
     */
    Blocks.prototype.endBinding = function() {
        var range = this.currentRange;
        if (range) {
            range.end = this.bindingId;
            this.currentRange = null;
        }
        return range;
    };

    /**
     * Очищает диапазон биндинга.
     */
    Blocks.prototype.cleanRange = function(range) {
        var binding;
        for (var i = range.start; i < range.end; i++) {
            binding = this.binding[i];
            if (binding && binding.block && binding.block.destroy) {
                binding.block.destroy();
            }
            delete this.binding[i];
        }
    };

    Blocks.prototype.bindModel = function(data, type, requiresInit) {
        if (this.bindingId === MAX_INT)
            this.bindingId = 1;
        this.binding[this.bindingId] = { data: data, type: type, block: this.objectToAssign };
        if (requiresInit) {
            this.pendingBlocks[type] = true;
        }
        this.objectToAssign = null;
        return this.bindingId++;
    };

    /**
     * forElem(elem) returns block on elem
     * forElem(elem, "myblock") returns closest block named "myblock"
     * {HTMLElement} @elem
     * {string} [@type]
     */
    Blocks.prototype.forElem = function(elem, type) {
        if (!elem || !elem.getAttribute)
            return null;
        if (type) {
            elem = $(elem).closest("." + type)[0];
            if (!elem) {
                return null;
            }
        }
        var modelId = elem.getAttribute("data-b");
        if (!modelId)
            return null;
        var result = this.binding[modelId];
        if (!result.block) {
            result.block = this.createBlock(result, elem);
        }
        return result.block;
    };

    Blocks.prototype.createBlock = function(bindingData, elem) {
        var ctor = this.blocks[bindingData.type];
        if (!ctor) {
            ctor = this.blockMixin.mix(function() { });
            ctor.type = bindingData.type;
        }
        var block = new ctor(elem);
        block.container = elem;
        block.data = bindingData.data;
        if (block.init) {
            this.di.init([block]);
        }
        return block;
    };

    Blocks.prototype.assignNext = function(obj) {
        this.objectToAssign = obj;
    };

    Blocks.prototype.init = function(di) {
        this.di = di;
        for (var i in this.blocks) if (this.blocks.hasOwnProperty(i)) {
            di.init([this.blocks[i]]);
        }
    };

    Blocks.prototype.initPendingBlocks = function(container) {
        var $cont = $(container);
        for (var name in this.pendingBlocks) {
            var roots = $cont.find("." + name);
            for (var i = 0; i < roots.length; i++) {
                this.forElem(roots[i]);
            }
        }
        this.pendingBlocks = {};
    };

    //////////////////////////////

    Mu.Blocks = Blocks;

})();

}
,"node_modules/music-common/js/tools/eventize.js": function(module, exports, require, global) {
var PROPERTY_NAME = "__eventCallbacks__";

var isArray = function(obj) {
    return obj instanceof Array;
};

var triggerEvent = function(eventName/*, eventData...*/) {
    if (!this.hasOwnProperty(PROPERTY_NAME)) {
        return;
    }

    var callbacks = this[PROPERTY_NAME][eventName];
    if (!isArray(callbacks)) {
        return;
    }

    callbacks = callbacks.slice(0, callbacks.length);
    var eventData = [].slice.call(arguments, 1);
    for (var i = 0; i < callbacks.length; i++) {
        if (typeof callbacks[i] === "function") {
            callbacks[i].apply(this, eventData);
        }
    }
};

var onEvent = function(eventName, callback) {
    if (!this.hasOwnProperty(PROPERTY_NAME)) {
        return;
    }

    var callbacks = this[PROPERTY_NAME][eventName];
    if (!isArray(callbacks)) {
        callbacks = this[PROPERTY_NAME][eventName] = [];
    }

    callbacks.push(callback);
};

var offEvent = function(eventName, callback) {
    if (!this.hasOwnProperty(PROPERTY_NAME)) {
        return;
    }

    var callbacks = this[PROPERTY_NAME][eventName];
    if (!isArray(callbacks)) {
        return;
    }

    for (var i = callbacks.length; i-- > 0;) {
        if (callbacks[i] === callback) {
            callbacks.splice(i, 1);
        }
    }
};

module.exports = function(object) {
    object[PROPERTY_NAME] = {};

    object.trigger = triggerEvent;
    object.on = onEvent;
    object.off = offEvent;
};

}
,"js/common/consts.js": function(module, exports, require, global) {
var consts = {

    ACTION_START_RADIO: "startRadio",

    ACTION_NEXT: "next",
    ACTION_PREV: "prev",
    ACTION_PLAY: "play",
    ACTION_LIKE: "like",
    ACTION_DISLIKE: "dislike",
    ACTION_VOLUME: "volume",

    ACTION_BTN_STATE: "setBtnState",
    ACTION_TRACK: "setTrack",
    ACTION_STATE: "setState",
    ACTION_CONTEXT: "context",

    ACTION_BROADCAST: "broadcast",

    ACTION_CONT_INITED: "inited",
    ACTION_POPUP_OPENED: "popupOpened",

    ACTION_CONNECTED: "connected",
    ACTION_DISCONNECTED: "disconnected",
    ACTION_TABS_CHANGED: "tabsChanged",

    ACTION_DATA_REQ: "dataRequest",
    ACTION_DATA_RES: "dataResponse",

    ACTION_CLOSE_TAB: "closeTab",
    ACTION_SELECT_TAB: "activateTab",
    ACTION_OPEN_LINK: "openLink",
    ACTION_ACTIVE_CHANGED: "activeChanged",

    ACTION_LOG: "log",

    BAR_NONE: "barNone",
    BAR_LIKE: "barLike",
    BAR_FEEDBACK: "barFeedback",

    BUTTON_NEXT: "next",
    BUTTON_PREV: "prev",
    BUTTON_PLAY: "play",
    BUTTON_LIKE: "like",
    BUTTON_DISLIKE: "dislike",
    BUTTON_VOLUME: "volume",

    BUTTON_STATE_ENABLED: "enabled",
    BUTTON_STATE_DISABLED: "disabled",
    BUTTON_STATE_VISIBLE: "visible",
    BUTTON_STATE_HIDDEN: "hidden",

    SOURCE_POPUP: "popup",
    SOURCE_BG: "background",
    SOURCE_CONTENT: "content",
    SOURCE_INJECTED: "window",
    SOURCE_DEBUG: "debug",

    STATE_PLAYING: 0,
    STATE_PAUSED: 1
};

module.exports = consts;

}
,"js/common/messenger.js": function(module, exports, require, global) {
var WinMessenger = require("./winMessenger");

/**
 * Class for working with chrome long-lived channels.
 * @param from {String} self name.
 * @param to {String} target name.
 * @param mode {Number} 0/1 - host/client.
 * @constructor
 */
var ChromeMessenger = function(from, to, mode) {
    this.mode = mode;
    this.name = this.mode === Messenger.mode.CLIENT ? to + ":" + from : from + ":" + to;
    this.ports = [];
    this.callbacks = {};
};

/**
 * Start communication.
 */
ChromeMessenger.prototype.start = function() {
    var self = this;
    if (this.mode === Messenger.mode.HOST) {
        chrome.runtime.onConnect.addListener(function(port) {
            if (port.name !== self.name) {
                return;
            }
            self._onConnected(port);
            self._onMessage(port, { event: "connected" });
        });
    } else {
        var port = chrome.runtime.connect({ "name": self.name });
        self._onConnected(port);
    }
};

/**
 * Reconnect communication.
 */
ChromeMessenger.prototype.restart = function() {
    if (this.mode === Messenger.mode.CLIENT) {
        this.ports.forEach(function(port) {
            port.disconnect();
        });
        var port = chrome.runtime.connect({ "name": this.name });
        this._onConnected(port);
    }
};

/**
 * Add on event listener.
 * @param event {String} event name.
 * @param callback {Function} callback function.
 */
ChromeMessenger.prototype.on = function(event, callback) {
    var callbacks = this.callbacks[event] || (this.callbacks[event] = []);
    callbacks.push(callback);
};

/**
 * Send message.
 * @param event {String} event name.
 * @param msg {Object} data to send.
 * @param port {Object} send message to specified port.
 */
ChromeMessenger.prototype.send = function(event, msg, port) {
    if (!event) {
        return;
    }
    var ports = port ? [port] : this.ports;
    ports.forEach(function(port) {
        port.postMessage({event: event, data: msg});
    });
};

/** @private */
ChromeMessenger.prototype._onConnected = function(port) {
    port.onMessage.addListener(this._onMessage.bind(this, port));
    port.onDisconnect.addListener(this._onDisconnected.bind(this, port));
    this.ports.push(port);
};

/** @private */
ChromeMessenger.prototype._onDisconnected = function(port) {
    this.ports = this.ports.filter(function(current) {
        return current !== port;
    });
    this._onMessage(port, { event: "disconnected" });
};

/** @private */
ChromeMessenger.prototype._onMessage = function(port, msg) {
    if (!msg.event) {
        return;
    }
    port.id = port.id || (port.sender && port.sender.tab && port.sender.tab.id);
    var broadcast = this.callbacks["broadcast"] || [];
    var callbacks = this.callbacks[msg.event] || [];
    callbacks = callbacks.concat(broadcast);
    callbacks.forEach(function(callback) {
        callback.call(null, msg, port);
    });
};

/**
 * Wrapper under window & chrome messengers.
 * Maintains a single interface
 */

var Messenger = function(from, to, mode) {
    mode = isNaN(mode) ? Messenger.mode.CLIENT : mode;
    if (from === "window" || to === "window") {
        this.messenger = new WinMessenger(from, to, mode);
    } else {
        this.messenger = new ChromeMessenger(from, to, mode);
    }
};

Messenger.mode = {
    "HOST": 0,
    "CLIENT": 1
};

Messenger.prototype.start = function() {
    this.messenger.start();
};

Messenger.prototype.restart = function() {
    this.messenger.restart();
};

Messenger.prototype.send = function(event, msg, port) {
    this.messenger.send(event, msg, port);
};

Messenger.prototype.on = function(event, callback) {
    this.messenger.on(event, callback);
};

module.exports = Messenger;

}
,"js/common/winMessenger.js": function(module, exports, require, global) {
/**
 * Class for simulation long-lived channel.
 * @param from {String} self name.
 * @param to {String} target name.
 * @param mode {Number} 0/1 - host/client.
 * @constructor
 */
var WinMessenger = function(from, to, mode) {
    this.mode = mode;
    this.name = this.mode === 1 ? to + ":" + from : from + ":" + to;
    this.uid = this.mode + ":" + Math.random();
    this.callbacks = {};
};

/**
 * Start communication.
 */
WinMessenger.prototype.start = function() {
    var self = this;
    window.addEventListener("message", function(evt) {
        var data = evt.data;
        if (evt.source != window
            || !data
            || !data.event
            || data.uid === self.uid
            || data.name != self.name) {
            return;
        }
        self._onMessage(data);
    }, false);
};

/**
 * Just for implement messenger interface.
 */
WinMessenger.prototype.reset = function() {};

/**
 * Add on event listener.
 * @param event {String} event name.
 * @param callback {Function} callback function.
 */
WinMessenger.prototype.on = function(event, callback) {
    if (!event || !callback) {
        return;
    }
    var callbacks = this.callbacks[event] || (this.callbacks[event] = []);
    callbacks.push(callback);
};

/**
 * Send message.
 * @param event {String} event name.
 * @param msg {Object} data to send.
 * @param port {Object} just to maintain interface implementation.
 */
WinMessenger.prototype.send = function(event, msg, port) {
    window.postMessage({event: event, data: msg, name: this.name, uid: this.uid}, "*");
};

/** @private */
WinMessenger.prototype._onMessage = function(data) {
    var broadcast = this.callbacks["broadcast"] || [];
    var callbacks = this.callbacks[data.event] || [];
    callbacks = callbacks.concat(broadcast);
    callbacks.forEach(function(callback) {
        callback.call(null, data);
    });
};

module.exports = WinMessenger;

}
,"lib/blocks.js": function(module, exports, require, global) {
require("../blocks/loading/loading.js");
require("../blocks/nav-item/nav-item.js");
require("../blocks/player-controls/player-controls.js");
require("../blocks/service-title/service-title.js");
require("../blocks/service/service.js");
require("../blocks/volume/volume.js");
}
,"blocks/loading/loading.js": function(module, exports, require, global) {
Mu.blocks.register("loading", (function() {

    var Pages;
    var current;
    var Control = function() {

    };

    Control.init = function(di) {
        Pages = di.get("pages");
        Pages.on("loaded", function() {
            if (current) {
                current.hide();
            }
        });
    };

    Control.prototype.init = function(di) {
        current = this;
        this.$cont = $(this.container);
    };

    Control.prototype.hide = function() {
        this.$cont.toggleClass("_hidden", true);
    };

    return Control;
})());

}
,"blocks/nav-item/nav-item.js": function(module, exports, require, global) {
Mu.blocks.register("nav-item", (function() {

    var Pages, Msg;

    var Control = function() {
    };

    Control.init = function(di) {
        Pages = di.get("pages");
        Msg = di.get("msg");
        this.domDelegate("click", function(evt) {
            var block = Mu.blocks.forElem(evt.target, "nav-item");
            if (!block) {
                return;
            }
            block.onClick();
        });
    };

    Control.prototype.init = function() {
        this.$cont = $(this.container);
    };

    Control.prototype.onClick = function(evt) {
        if (this.$cont.hasClass("nav-item_type_link")) {
            var id = this.data.id;
            if (id == "user") {
                id = this.data.children[0];
            }
            Msg.send(Mu.consts.ACTION_START_RADIO, id);
        }
    };

    return Control;
})());

}
,"blocks/player-controls/player-controls.js": function(module, exports, require, global) {
Mu.blocks.register("player-controls", (function() {

    var Msg;
    var PlayerControls = function() {
        this.context = {};
    };

    PlayerControls.init = function(di) {
        Msg = di.get("msg");
    };

    PlayerControls.prototype.init = function() {
        var self = this;
        self.$cont = $(self.container);

        self.$track = self.$cont.find(".track");

        self.$play = self.$cont.find(".icon_play").closest(".player-controls__btn");
        self.$next = self.$cont.find(".icon_next").closest(".player-controls__btn");
        self.$prev = self.$cont.find(".icon_prev").closest(".player-controls__btn");
        self.$like = self.$cont.find(".icon_like").closest(".player-controls__btn");
        self.$dislike = self.$cont.find(".icon_dislike").closest(".player-controls__btn");
    };

    PlayerControls.prototype.onChangeCurrent = function(evt) {
        this.replace("player-controls__track", { track: evt.data});
    };

    PlayerControls.prototype.onContextChange = function(evt) {
        this.replace("service-icon", this.context);
        this.replace("service-title", this.context);
    };

    PlayerControls.prototype.onButtonState = function(evt) {
        var $btn;
        switch(evt.data.button) {
            case Mu.consts.BUTTON_NEXT:
                $btn = this.$next;
                break;
            case Mu.consts.BUTTON_PREV:
                $btn = this.$prev;
                break;
            case Mu.consts.BUTTON_PLAY:
                $btn = this.$play;
                break;
            default:
                break;
        }
        if ($btn) {
            $btn.toggleClass("disabled", !evt.data.state);
        }
    };

    PlayerControls.prototype.replace = function(tmpl, data) {
        var $old = this.$cont.find("." + tmpl);
        var $new = $(Mu.render(tmpl, data));
        $old.replaceWith($new);
    };

    return PlayerControls;
})());

}
,"blocks/service-title/service-title.js": function(module, exports, require, global) {
Mu.blocks.register("service-title", (function() {

    var Msg;
    var Control = function() {
    };

    Control.init = function(di) {
        Msg = di.get("msg");
        //this.domDelegate("click", ".service-title__source", function(evt) {
        //    var block = Mu.blocks.forElem(evt.target, "service-title");
        //    if (!block) {
        //        return;
        //    }
        //   // block.onSourceClick();
        //});
    };

    Control.prototype.init = function() {
        var self = this;
    };

    return Control;
})());

}
,"blocks/service/service.js": function(module, exports, require, global) {
Mu.blocks.register("service", (function() {

    var Msg;
    var Control = function() {
    };

    Control.init = function(di) {
        Msg = di.get("msg");
        this.domDelegate("click", ".play", function(evt) {
            var block = Mu.blocks.forElem(evt.target, "service");
            if (!block) {
                return;
            }
            block.onPlayClick();
        });
    };

    Control.prototype.init = function() {
        var self = this;
    };

    Control.prototype.onPlayClick = function() {
        this.triggerEvent({ type: "service.play" });
    };

    Control.prototype.setSelected = function(state) {
        $(this.container).toggleClass("service_selected", !!state);
    };

    return Control;
})());

}
,"blocks/volume/volume.js": function(module, exports, require, global) {
Mu.blocks.register("volume", (function() {
    var $document = $(document),
        SCROLL_STEP = 0.03;
    var dataSrc, msg;
    var Dnd = require("music-common/js/tools/dnd");

    var Volume = function(node) {
        this.value = -1;
        this.maxHeight = 100;
    };

    Volume.init = function(di) {
        dataSrc = di.get("datasrc");
        msg = di.get("msg");
    };

    Volume.prototype.init = function(di) {
        this.$cont = $(this.container);
        this.$icon = this.$cont.find(".volume__icon");

        this.track = this.$cont.find(".volume__track")[0];
        this.filled = this.$cont.find(".volume__filled")[0];

        this.$cont.on("click", ".volume__btn", this.onClick.bind(this));
        this.$cont.on("mousedown", ".volume__control", this.onMouseDown.bind(this));
        this.$cont.on("mouseenter", this.onMouseEnter.bind(this));
        this.$cont.on("mouseleave", this.onMouseLeave.bind(this));

        msg.on(Mu.consts.ACTION_VOLUME, function(evt) {
            this.onPlayerVolume(evt.data);
        }.bind(this));
        this.refresh();
    };

    Volume.prototype.refresh = function() {
        dataSrc.get("get-volume").then(function(value) {
            this.onPlayerVolume(value);
        }.bind(this));
    };

    /** @private */
    Volume.prototype.onClick = function(evt) {
        this.saveVolume(-1);
    };

    /** @private */
    Volume.prototype.onMouseDown = function(evt) {
        var self = this;
        self.changing = true;
        self.$cont.toggleClass("volume_used", true);
        Dnd(evt, {
            startY: $(this.track).offset().top + this.maxHeight,
            onMove: function(evt) {
                self.onUserPosChange(-evt.deltaY);
            },
            onEnd: function(evt, cancelled) {
                self.$cont.toggleClass("volume_used", false);
                self.changing = false;
            }
        });
        evt.preventDefault();
    };

    /** @private */
    Volume.prototype.onMouseEnter = function(evt) {
        $document.bind("DOMMouseScroll.volume", this.onScroll.bind(this)); // for FF
        $document.bind("mousewheel.volume", this.onScroll.bind(this)); // for IE, Chorme, Opera
    };

    /** @private */
    Volume.prototype.onMouseLeave = function(evt) {
        $document.unbind(".volume");
    };

    /** @private */
    Volume.prototype.onScroll = function(evt) {
        evt = evt.originalEvent ? evt.originalEvent : evt;
        var delta = evt.detail ? (-1) * evt.detail : evt.wheelDelta; // detail for FF, wheelDelta for others
        var scrollStep = delta < 0 ? -SCROLL_STEP : SCROLL_STEP;
        this.onUserPosChange(this.maxHeight * (this.getVolume() + scrollStep));
        evt.preventDefault();
    };

    /** @private */
    Volume.prototype.onUserPosChange = function(posY) {
        if (posY < 0) {
            posY = 0;
        } else if (posY > this.maxHeight) {
            posY = this.maxHeight;
        }

        var value = posY / this.maxHeight;
        this.saveVolume(value);
        this.onPlayerVolume(value);
    };

    /** @private */
    Volume.prototype.onPlayerVolume = function(value) {
        if (this.value !== value) {
            this.value = value;
            this.filled.style.height = Math.round(value * this.maxHeight) + "px";
            this.updateIcon();
        }
    };

    /** @private */
    Volume.prototype.onMuted = function(muted) {
        this.updateIcon();
    };

    /** @private */
    Volume.prototype.getVolume = function(cached) {
        return this.value;
    };

    /** @private */
    Volume.prototype.saveVolume = function(value) {
        msg.send(Mu.consts.ACTION_VOLUME, value);
    };

    /** @private */
    Volume.prototype.updateIcon = function() {
        var value = this.getVolume();
        var muted = value === 0;
        var halfVolume = !muted && value < 0.45;
        this.$icon.toggleClass("volume__icon_mute", muted);
        this.$icon.toggleClass("volume__icon_half", halfVolume);
        this.$icon.attr("title", muted ? "Включить звук" : "Выключить звук");
    };

    return Volume;
})());

}
,"node_modules/music-common/js/tools/dnd.js": function(module, exports, require, global) {
var lastDnd = undefined;
var threshold = 8;

var STATE_NONE = 0, STATE_PRE = 1, STATE_DRAG = 2;

var $document = $(document);
var $window = $(window);
var $shim = undefined;

var DnD = function(evt, options) {
    this.startX = options.startX || evt.pageX;
    this.startY = options.startY || evt.pageY;
    this.options = options || {};
    this.overlay = undefined;

    options.shim = "shim" in options ? options.shim : true;

    $document.bind("mousemove.DnD", this.onMove.bind(this));
    $document.bind("mouseup.DnD", this.end.bind(this, false));
    $window.bind("blur", this.end.bind(this, true));
    if (document.body.setCapture) {
        document.body.setCapture();
    }

    this.state = this.options.draggable ? STATE_PRE : STATE_DRAG;
    this.onMove(evt);
    evt.preventDefault();
};

DnD.prototype.onMove = function(evt) {
    evt.deltaX = evt.pageX - this.startX;
    evt.deltaY = evt.pageY - this.startY;

    if (this.state === STATE_PRE) {
        this.onDragStart(evt);
    }
    if (this.state === STATE_DRAG) {
        this.onDragMove(evt);
    }
};

DnD.prototype.onDragStart = function(evt) {
    if ((evt.deltaX * evt.deltaX + evt.deltaY * evt.deltaY) < (threshold * threshold)) {
        return;
    }

    if (this.options.shim) {
        this.showShim();
    }
    this.showOverlay();
    this.state = STATE_DRAG;
    if (this.options.onDragStart) {
        this.options.onDragStart(evt);
    }

    document.body.style.userSelect = document.body.style.MozUserSelect = "none";
};

DnD.prototype.onDragMove = function(evt) {
    this.moveOverlay(evt);
    if (this.options.onMove) {
        this.options.onMove(evt);
    }
    evt.preventDefault();
};

DnD.prototype.showOverlay = function() {
    if (!this.options.overlay) {
        return;
    }
    var $cont = $('<div style="position: absolute; z-index: 100001; pointer-events: none;"></div>');
    $cont.append(this.options.overlay);
    $cont.appendTo(document.body);
    var offset = {
        x: -Math.round($cont.outerWidth() / 2),
        y: -Math.round($cont.outerHeight() / 2)
    };
    this.overlay = {
        $cont: $cont,
        offset: offset
    };
};

DnD.prototype.hideOverlay = function() {
    if (this.overlay) {
        this.overlay.$cont.remove();
        this.overlay = undefined;
    }
};

DnD.prototype.moveOverlay = function(evt) {
    if (!this.overlay) {
        return;
    }
    var offset = this.overlay.offset;
    this.overlay.$cont.css({ left: evt.pageX + offset.x, top: evt.pageY + offset.y });
};

DnD.prototype.showShim = function() {
    if (!$shim)
        this.initShim();
    $shim.css({ display: "block" });
};

DnD.prototype.hideShim = function() {
    if ($shim)
        $shim.css({ display: "none" });
};

DnD.prototype.initShim = function() {
    $shim = $('<div style="position: fixed; z-index: 100000; left: 0; top: 0; width: 100%; height: 100%; display: none;"></div>');
    $shim.appendTo(document.body);
};

DnD.prototype.end = function(cancelled, evt) {
    $document.unbind(".DnD");
    if (document.body.releaseCapture) {
        document.body.releaseCapture();
    }

    if (this.options.shim) {
        this.hideShim();
    }
    this.state = STATE_NONE;
    this.hideOverlay();
    if (!cancelled) {
        this.onMove(evt);
    }
    if (this.options.onEnd) {
        this.options.onEnd(evt, !!cancelled);
    }
    lastDnd = undefined;
};

module.exports = function(evt, options) {
    if (lastDnd) {
        lastDnd.end(true, undefined);
    }
    lastDnd = new DnD(evt, options);
};

}
,"lib/pages.js": function(module, exports, require, global) {
require("../pages/index/page-index.js");
require("../pages/nav/page-nav.js");
require("../pages/services/page-services.js");
}
,"pages/index/page-index.js": function(module, exports, require, global) {
;(function() {

    var Nav;

    var Page = function(param) {
        this.templateName = "page-index";
    };

    Page.init = function(di) {
        Nav = di.get("navigation");
    };

    Page.prototype.fetchData = function(datasrc) {
        var defer = Vow.defer();
        datasrc.get("get-services").then(function(data) {
            defer.resolve(data.tabs[0]);
            if (data.tabs.length > 1) {
                Nav.navigateTo("/services");
            }
        });
        return defer.promise();
    };

//////////////////////////////

    Mu.pages.register("index", Page);
})();

}
,"pages/nav/page-nav.js": function(module, exports, require, global) {
;(function() {

    var Nav;

    var Page = function(param) {
        this.templateName = "page-nav";
        this.type = param.type;
        this.tag = param.tag;
    };

    Page.init = function(di) {
        Nav = di.get("navigation");
    };

    Page.prototype.fetchData = function(datasrc) {
        var self = this;
        var defer = Vow.defer();
        datasrc.get("library").then(function(data) {
            var types = data.types;
            var stations = data.stations;
            var station, items, parent;

            if (!self.type) {
                items = self.toArray(types);
                parent = "/"
            } else if (!self.tag) {
                items = types[self.type].children.map(function(id) {
                    return stations[id.type + ":" + id.tag].station
                });
                parent = "/nav";
            } else {
                station = stations[self.type + ":" + self.tag].station;
                items = station.children.map(function(id) {
                    return stations[id.type + ":" + id.tag].station
                });
                items = [{
                    "id": station.id,
                    "name": station.name,
                    "icon": station.icon,
                    "parentId": station.id
                }].concat(items);
                parent = "/nav/" + self.type;
            }
            defer.resolve({
                parent: parent,
                items: items
            });
        });
        return defer.promise();
    };

    Page.prototype.toArray = function(obj) {
        var result = [];
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                result.push(obj[prop]);
            }
        }
        return result;
    };

//////////////////////////////

    Mu.pages.register("nav", Page);
})();

}
,"pages/services/page-services.js": function(module, exports, require, global) {
;(function() {

    var Nav;
    var selected;

    var Page = function(param) {
        this.templateName = "page-services";
    };

    Page.init = function(di) {
        Nav = di.get("navigation");
    };

    Page.prototype.fetchData = function(datasrc) {
        var self = this;
        var defer = Vow.defer();
        datasrc.get("get-services").then(function(data) {
            defer.resolve({
                services: data.tabs,
                selected: data.active
            });
        });
        return defer.promise();
    };

    Page.prototype.onShow = function() {
        var self = this;
        self.$cont = $(this.container);
        self.delegate("service.play", this.onServicePlay.bind(this));
        var $selected = self.$cont.find(".service_selected");
        selected = $selected.length ? Mu.blocks.forElem($selected[0]) : null;
    };

    // INFO: set selected there to fast reaction by user click
    Page.prototype.onServicePlay = function(evt) {
        var target = evt.target;
        if (selected != target) {
            if (selected) {
                selected.setSelected(false);
            }
            selected = target;
            selected.setSelected(true);
        }
    };

    Page.prototype.getSelected = function(services) {
        var result;
        var service;
        for (var i = 0; i < services.length; i++) {
            service = services[i];
            if (this.serviceId && service.id == this.serviceId ||
                !this.serviceId && service.state === Mu.consts.STATE_PLAYING) {
                result = service;
                break;
            }
        }
        return result;
    };

    Page.prototype.refreshVolume = function() {
        if (selected) {
            var isVolume = selected.data.buttons && selected.data.buttons.volume == "visible";
            $(".head .volume").toggleClass("_hidden", !isVolume);
        }
    };

//////////////////////////////

    Mu.pages.register("services", Page);
})();

}
}, {"yate/lib/runtime.js":"node_modules/yate/lib/runtime.js","vow":"node_modules/vow/lib/vow.js","music-common/js/pageManager":"node_modules/music-common/js/pageManager.js","music-common/js/routes":"node_modules/music-common/js/routes.js","music-common/js/mini-di.js":"node_modules/music-common/js/mini-di.js","music-common/js/blocks.js":"node_modules/music-common/js/blocks.js","music-common/js/tools/eventize.js":"node_modules/music-common/js/tools/eventize.js","music-common/js/tools/dnd":"node_modules/music-common/js/tools/dnd.js"});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZXMiLCJzb3VyY2VzIjpbImluZGV4LmpzIiwibm9kZV9tb2R1bGVzL3lhdGUvbGliL3J1bnRpbWUuanMiLCJub2RlX21vZHVsZXMvdm93L2xpYi92b3cuanMiLCJpbmRleC55YXRlLnRlbXAuanMiLCJsaWIvanMuanMiLCJqcy9wb3B1cC9hY3Rpb25EaXNwYXRjaGVyLmpzIiwianMvcG9wdXAvZGF0YXNyYy5qcyIsImpzL3BvcHVwL2xheW91dC5qcyIsImpzL3BvcHVwL25hdmlnYXRpb24uanMiLCJqcy9wb3B1cC9wYWdlcy5qcyIsIm5vZGVfbW9kdWxlcy9tdXNpYy1jb21tb24vanMvcGFnZU1hbmFnZXIuanMiLCJqcy9wb3B1cC9yb3V0ZXMuanMiLCJub2RlX21vZHVsZXMvbXVzaWMtY29tbW9uL2pzL3JvdXRlcy5qcyIsImpzL3BvcHVwL3lhdGUuZXh0ZXJuYWxzLmpzIiwibm9kZV9tb2R1bGVzL211c2ljLWNvbW1vbi9qcy9taW5pLWRpLmpzIiwibm9kZV9tb2R1bGVzL211c2ljLWNvbW1vbi9qcy9ibG9ja3MuanMiLCJub2RlX21vZHVsZXMvbXVzaWMtY29tbW9uL2pzL3Rvb2xzL2V2ZW50aXplLmpzIiwianMvY29tbW9uL2NvbnN0cy5qcyIsImpzL2NvbW1vbi9tZXNzZW5nZXIuanMiLCJqcy9jb21tb24vd2luTWVzc2VuZ2VyLmpzIiwibGliL2Jsb2Nrcy5qcyIsImJsb2Nrcy9sb2FkaW5nL2xvYWRpbmcuanMiLCJibG9ja3MvbmF2LWl0ZW0vbmF2LWl0ZW0uanMiLCJibG9ja3MvcGxheWVyLWNvbnRyb2xzL3BsYXllci1jb250cm9scy5qcyIsImJsb2Nrcy9zZXJ2aWNlLXRpdGxlL3NlcnZpY2UtdGl0bGUuanMiLCJibG9ja3Mvc2VydmljZS9zZXJ2aWNlLmpzIiwiYmxvY2tzL3ZvbHVtZS92b2x1bWUuanMiLCJub2RlX21vZHVsZXMvbXVzaWMtY29tbW9uL2pzL3Rvb2xzL2RuZC5qcyIsImxpYi9wYWdlcy5qcyIsInBhZ2VzL2luZGV4L3BhZ2UtaW5kZXguanMiLCJwYWdlcy9uYXYvcGFnZS1uYXYuanMiLCJwYWdlcy9zZXJ2aWNlcy9wYWdlLXNlcnZpY2VzLmpzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM5Q0EsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzM5QkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDM3dDQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3QzREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDUEEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDNUhBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdkNBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMvREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDckNBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzFKQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDckdBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbkNBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMvREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BPQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMvREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM1SUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3hFQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDTkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3QkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BDQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzlEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDeEJBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDaENBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3JJQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDN0lBLEFBQ0E7QUFDQTtBQUNBOzs7QUNIQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM1QkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2xFQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OyJ9
