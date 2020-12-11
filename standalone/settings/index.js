(function(modules, bindings) {
    var globalObj;
    if (typeof window !== "undefined") {
        globalObj = window;
    } else if (typeof global !== "undefined") {
        globalObj = global;
    }

    var base = "standalone/settings".split("/");
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
var conf = require("../../js/common/conf");

conf.get(function(conf) {
    var version = conf.buildVersion;
    var buildTs = conf.buildTs;
    var buildDate = new Date(buildTs);

    document.getElementById("version").innerText = version;
    document.getElementById("versionDate").innerText = buildDate.toLocaleDateString();
    document.getElementById("year").innerText = (new Date()).getFullYear().toString();
});

var prefix = /YaBrowser/.test(navigator.userAgent) ? "browser" : "chrome";
document.getElementById("ext-link").innerText = prefix + "://extensions/";

}
,"../../js/common/conf.js": function(module, exports, require, global) {
var DataSrc = require("./datasrc");

module.exports = {
    get: function(callback) {
        DataSrc.get(chrome.extension.getURL('/config/conf.json'), { contentType: "application/json" }, function(data) {
            callback(data);
        });
    }
};

}
,"../../js/common/datasrc.js": function(module, exports, require, global) {
var DataSrc = function() {
    this.cache = {};
};

DataSrc.prototype.get = function(url, options, callback) {
    options = options || {};
    callback = callback || function() {};
    if (url.indexOf("handler://") == 0) {
        url = "https://radio.yandex.ru/handlers/" + url.split("://")[1] + ".jsx";
    }
    if (this.cache[url]) {
        callback(this.cache[url]);
    } else {
        this._get(url, options, callback);
    }
};

DataSrc.prototype.clearCache = function() {
    this.cache = {};
};

DataSrc.prototype._get = function(url, options, callback) {
    var self = this;
    self._makeRequest(
        url,
        options,
        function(data) {
            self.cache[url] = data;
            callback(data);
        },
        function(err) {
            callback({ error: err });
        }
    );
};

DataSrc.prototype._makeRequest = function(url, options, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) {
            return;
        }
        if (xhr.status != 200) {
            onError({
                msg: xhr.responseText,
                status: xhr.status
            });
            return;
        }
        var contentType = options.contentType || xhr.getResponseHeader("Content-Type");
        if (contentType && contentType.indexOf("application/json") != -1) {
            var data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch(ex) {
                onError({
                    msg: "invalid data",
                    status: xhr.status
                });
            }
            onSuccess(data);
        } else {
            onError({
                msg: "invalid content type",
                status: xhr.status
            });
        }
    };
    xhr.send();
};

module.exports = new DataSrc();

}
}, {});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZXMvc3RhbmRhbG9uZS9zZXR0aW5ncyIsInNvdXJjZXMiOlsiaW5kZXguanMiLCIuLi8uLi9qcy9jb21tb24vY29uZi5qcyIsIi4uLy4uL2pzL2NvbW1vbi9kYXRhc3JjLmpzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDZkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDVkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzsifQ==
