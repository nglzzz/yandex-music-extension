(function(modules, bindings) {
    var globalObj;
    if (typeof window !== "undefined") {
        globalObj = window;
    } else if (typeof global !== "undefined") {
        globalObj = global;
    }

    var base = "js".split("/");
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

    require.call({moduleName: "background.js"}, "background.js");
})({"background.js": function(module, exports, require, global) {
var DataSrc = require("./background/datasrc");
var consts = require("./common/consts");
var Msg = require("./common/messenger");
var utils = require("./common/utils");
var auth = require("./background/auth");

var Tabs = require("./background/tabs");
var Radio = require("./background/radio");
var Commands = require("./background/commands");
var Composer = require("./background/composer");
var extManager = require("./background/extManager");
var logger = require("./background/logger");

var tabs = new Tabs();

var msgPopup = new Msg(consts.SOURCE_BG, consts.SOURCE_POPUP, Msg.mode.HOST);
var msgCommands = new Commands();

var msgTab = new Msg(consts.SOURCE_BG, consts.SOURCE_CONTENT, Msg.mode.HOST);
var msgRadio = new Radio();

var msgContent = new Composer([ msgTab, msgRadio ]);
var msgControl = new Composer([ msgPopup, msgCommands ]);

msgPopup.start();
msgTab.start();

var Bg = function() {
    this.volume = undefined;
    this.extManager = extManager;
};

Bg.prototype.init = function() {
    // preload library
    DataSrc.get("handler://library", {});

    this.extManager.init();
    this.onPopupVolumeChanged = utils.throttle(100, false, this.onPopupVolumeChanged.bind(this));
    if (/Mac\sOS\sX/.test(navigator.userAgent)) {
        this.onPopupConnected = utils.debounce(300, false, this.onPopupConnected.bind(this));
    }

    /** bind content script event listeners */

    msgContent.on(consts.ACTION_CONNECTED, this.onContentConnected.bind(this));
    msgContent.on(consts.ACTION_DISCONNECTED, this.onContentDisconnected.bind(this));
    msgContent.on(consts.ACTION_STATE, this.onContentStateChanged.bind(this));
    msgContent.on(consts.ACTION_TRACK, this.onContentTrackChanged.bind(this));
    msgContent.on(consts.ACTION_CONTEXT, this.onContentContextChanged.bind(this));
    msgContent.on(consts.ACTION_BTN_STATE, this.onContentBtnStateChanged.bind(this));
    msgContent.on(consts.ACTION_VOLUME, this.onContentVolumeChanged.bind(this));

    /** bind popup event listeners*/

    msgPopup.on(consts.ACTION_CONNECTED, this.onPopupConnected.bind(this));
    msgPopup.on(consts.ACTION_DATA_REQ, this.onPopupDataRequest.bind(this));
    msgPopup.on(consts.ACTION_START_RADIO, this.onPopupRadioClicked.bind(this));
    msgPopup.on(consts.ACTION_SELECT_TAB, this.onPopupTabSelected.bind(this));
    msgPopup.on(consts.ACTION_OPEN_LINK, this.onPopupLinkClicked.bind(this));
    msgPopup.on(consts.ACTION_CLOSE_TAB, this.onPopupTabClosed.bind(this));
    msgPopup.on(consts.ACTION_VOLUME, this.onPopupVolumeChanged.bind(this));

    /** bind control event listeners */

    msgControl.on(consts.ACTION_PREV, this.proxyToContent.bind(this));
    msgControl.on(consts.ACTION_NEXT, this.proxyToContent.bind(this));
    msgControl.on(consts.ACTION_PLAY, this.proxyToContent.bind(this));

    msgPopup.on(consts.ACTION_LIKE, this.proxyToContent.bind(this));
    msgPopup.on(consts.ACTION_DISLIKE, this.proxyToContent.bind(this));
    msgCommands.on(consts.ACTION_LIKE, this.onCommandLikeDislike.bind(this));
    msgCommands.on(consts.ACTION_DISLIKE, this.onCommandLikeDislike.bind(this));

    /** bind tabs event listeners */

    tabs.on(consts.ACTION_ACTIVE_CHANGED, this.onTabsActiveChanged.bind(this));
    tabs.on(consts.ACTION_TABS_CHANGED, this.onTabsChanged.bind(this));

    /** remote logs */
    msgContent.on(consts.ACTION_LOG, this.onLog.bind(this));
    msgControl.on(consts.ACTION_LOG, this.onLog.bind(this));
};

/**
 * Content script event listeners.
 */

Bg.prototype.onContentConnected = function(evt, source) {
    tabs.add(source.id, source);
    logger.debug(evt.event, source.id);
};

Bg.prototype.onContentDisconnected = function(evt, source) {
    tabs.remove(source.id);
    logger.debug(evt.event, source.id);
};

/**
 * Play/Pause event listener. Set active tab if state is playing.
 * @param evt { data: Number } play/pause state
 * @param source
 */
Bg.prototype.onContentStateChanged = function(evt, source) {
    var tab = tabs.get(source.id);
    if (tab.state == evt.data) {
        return;
    }
    tab.state = evt.data;
    this.proxyToPopup({ event: evt.event, data: tab });
    if (evt.data === consts.STATE_PLAYING) {
        tabs.setActiveId(source.id);
    }
    logger.debug(evt.event, source.id, evt.data);
};

Bg.prototype.onContentTrackChanged = function(evt, source) {
    var tab = tabs.get(source.id);
    tab.track = evt.data;
    if (tabs.isActive(source.id)) {
        this.proxyToPopup({ event: evt.event, data: tab });
    }
    logger.debug(evt.event, source.id, evt.data);
};

Bg.prototype.onContentContextChanged = function(evt, source) {
    var tab = tabs.get(source.id);
    tab.context = evt.data;
    this.proxyToPopup({ event: evt.event, data: tab });
    this.saveToHistory(source.id);
    this.onTabsChanged(evt);
    logger.debug(evt.event, source.id, evt.data);
};

Bg.prototype.onContentBtnStateChanged = function(evt, source) {
    var tab = tabs.get(source.id);
    var data = evt.data || {};
    tab.buttons[data.button] = data.state;
    this.proxyToPopup({ event: evt.event, data: { id: source.id , button: data.button, state: data.state }});
    logger.debug(evt.event, source.id, evt.data);
};

Bg.prototype.onContentVolumeChanged = function(evt, source) {
    if (tabs.isActive(source.id) && this.volume != evt.data) {
        this.volume = evt.data;
        this.extManager.setVolume(this.volume);
        this.proxyToPopup(evt);
        logger.debug(evt.event + ":FROM_SOURCE", source.id, this.volume);
    }
};

/**
 * Popup event listeners.
 */

Bg.prototype.onPopupConnected = function(evt, source) {
    auth.check();
    msgPopup.send(consts.ACTION_TABS_CHANGED, tabs.getTabs(), source);
};

/**
 * Start playing radio
 * @param evt
 */
Bg.prototype.onPopupRadioClicked = function(evt, source) {
    msgRadio.send(evt.event, evt.data);
};

/**
 * Set selected tab by id or open new tab from history.
 * @param evt { data: { id: {String|Number} }}
 */
Bg.prototype.onPopupTabSelected = function(evt, source) {
    if (evt.data.id == "history") {
        this.openFromHistory();
    } else {
        this.extManager.setSelectedTab(evt.data.id);
    }
};

/**
 * Open link function. if is music host then navigate to link through unity, else open in tab.
 * @param evt { data: { id: {String|Number} }}
 */
Bg.prototype.onPopupLinkClicked = function(evt, source) {
    var tab = tabs.get(evt.data.id);
    if (tab && /https?:\/\/music.yandex/.test(tab.context.source)) {
        this.proxyToContent(evt);
        this.extManager.setSelectedTab(evt.data.id);
    } else {
        this.extManager.openLink(evt.data.url);
    }
};

/**
 * Disable tab.
 * @param evt { data { id: { String | Number }}}
 */
Bg.prototype.onPopupTabClosed = function(evt, source) {
    tabs.enable(evt.data.id, false);
    logger.debug(evt.event, evt.data.id, evt.data);
};

/**
 * On popup volume changed event listener. Proxy event to active tab and save to local storage.
 * @param evt { data: Number } volume value.
 */
Bg.prototype.onPopupVolumeChanged = function(evt, source) {
    var tab = tabs.getActive();
    if (tab) {
        this.volume = evt.data;
        this.extManager.setVolume(this.volume);
        msgContent.send(evt.event, evt.data, tab.port);
        logger.debug(evt.event + ":FROM_POPUP", tabs.getActiveId(), evt.data);
    }
};

/**
 * Fake DataSrc for popup requests
 * @param evt
 */
Bg.prototype.onPopupDataRequest = function(evt) {
    var data = evt.data;
    var what = data && data.what;
    if (!what || !data.uid) {
        return;
    }
    var sendResponse = function(response, error, nodebug) {
        msgPopup.send(consts.ACTION_DATA_RES, error ? {error: error, uid: data.uid} : {data: response, uid: data.uid});
        !nodebug && logger.debug(consts.ACTION_DATA_RES, response);
    };

    switch (what) {
        case "get-services":
            this.getTabs(sendResponse);
            break;
        case "get-volume":
            this.extManager.getVolume(sendResponse);
            break;
        default:
            DataSrc.get("handler://" + what, {}, function(res) { sendResponse(res, res.error, false); });
            break;
    }
};

/**
 * Tabs event listeners
 */

Bg.prototype.onTabsActiveChanged = function(evt) {
    var tab = tabs.get(evt.value);
    var oldTab = tabs.get(evt.oldValue);
    var isYandexHost = function(tab) {
        return tab && tab.context && tab.context.url && /\.yandex\.(ru|by|kz|ua)/.test(tab.context.url);
    };
    if (oldTab
        && oldTab.state == consts.STATE_PLAYING
        && !(isYandexHost(oldTab) && isYandexHost(tab))) {
        msgContent.send(consts.ACTION_PLAY, consts.STATE_PAUSED, oldTab.port);
    }
    this.extManager.getItem("volume", function(value) {
        if (tab && !isNaN(value)) {
            msgContent.send(consts.ACTION_VOLUME, value, tab.port);
        }
    });
    this.proxyToPopup({ event: consts.ACTION_ACTIVE_CHANGED, data: tab });
};


Bg.prototype.onTabsChanged = function(evt) {
    msgPopup.send(consts.ACTION_TABS_CHANGED, tabs.getTabs());
    logger.debug(consts.ACTION_TABS_CHANGED);
};

/**
 * Commands event listeners
 */

Bg.prototype.onCommandLikeDislike = function(evt) {
    var id = (evt.data && evt.data.id) || tabs.getActiveId();
    var tab = tabs.get(id) || {};
    var track = tab.track || {};

    // disable unlike/undislike from hotkeys
    if (track.liked && evt.event == consts.ACTION_LIKE ||
        track.disliked && evt.event == consts.ACTION_DISLIKE) {
        return;
    }
    msgContent.send(evt.event, evt.data, tab.port);
};

/** proxy remote logs to debug page */
Bg.prototype.onLog = function(evt) {
    logger.msg.send(evt.event, evt.data);
};

Bg.prototype.proxyToPopup = function(evt) {
    msgPopup.send(evt.event, evt.data);
};

Bg.prototype.proxyToContent = function(evt) {
    var id = (evt.data && evt.data.id) || tabs.getActiveId();
    var tab = tabs.get(id);
    if (id == "history") {
        this.openFromHistory();
    } else if (tab) {
        msgContent.send(evt.event, evt.data, tab.port);
    }
};

Bg.prototype.getTabs = function(callback) {
    var _tabs = tabs.getTabs();
    if (_tabs.length) {
        callback({tabs: _tabs, active: tabs.getActive()});
    } else {
        this.extManager.getItem("historyTab", function(tab) {
            if (tab) {
                tab.id = "history";
                tab.track = null;
                tab.state = consts.STATE_PAUSED;
                tab.buttons.volume = consts.BUTTON_STATE_HIDDEN;
                _tabs = [tab];
            }
            callback({tabs: _tabs});
        });
    }
};

Bg.prototype.saveToHistory = function(id) {
    var tab = tabs.get(id);
    var context = tab && tab.context;
    if (!context || !context.source) {
        return;
    }
    if ((tab.id == "radio" && tab.context.stationId.type !== "user")
        || context.source.indexOf("music.yandex") !== -1
        || context.source.indexOf("radio.yandex") !== -1) {
        this.extManager.setItem("historyTab", tab);
        logger.debug("saveToHistory", tab);
    }
};

Bg.prototype.openFromHistory = function() {
    this.extManager.getItem("historyTab", function(data) {
        if (!data || !data.id || !data.context) {
            return;
        }
        if (data.id == "radio") {
            msgRadio.send(consts.ACTION_START_RADIO, data.context.stationId);
            return;
        }

        var url = data.context.url;
        url = url.replace(/\?.*/, "");
        if (url.indexOf("music.yandex") != -1) {
            url = url + "?playSeq=1";
        } else if (url.indexOf("radio.yandex") != -1) {
            url = url + "?from=chrome";
        }

        this.extManager.openLink(url, true);
        logger.debug("loadFromHistory", data);
    }.bind(this));
};

var bg = new Bg();
bg.init();

}
,"background/datasrc.js": function(module, exports, require, global) {
var dataSrcBase = require("../common/datasrc");
var auth = require("./auth");

var DataSrc = function() {
    auth.on("info", this.onInfo.bind(this));
};

DataSrc.prototype = dataSrcBase;

DataSrc.prototype.onInfo = function() {
    this.clearCache();
};

module.exports = new DataSrc();

}
,"common/datasrc.js": function(module, exports, require, global) {
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
,"background/auth.js": function(module, exports, require, global) {
var consts = require("../common/consts");
var extManager = require("./extManager");
var eventize = require("../common/eventize");
var logger = require("./logger");

var Auth = function() {
    eventize(this);
    this.getLogin(function(login) {
        logger.debug("Login: " + login);
        this.login = login;
    }.bind(this));
};

// call this method when user data requested
// another way is listen all cookie changes
Auth.prototype.check = function() {
    this.getLogin(function(login) {
        if (this.login != login) {
            logger.debug("Login changed");
            logger.debug("Login: " + login);
            this.login = login;
            this.trigger("info");
        }
    }.bind(this));
};

Auth.prototype.getLogin = function(callback) {
    extManager.getCookie("https://yandex.ru", "yandex_login", function(data) {
        if (callback) {
            callback(data && data.value);
        }
    })
};

module.exports = new Auth();

}
,"common/consts.js": function(module, exports, require, global) {
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
,"background/extManager.js": function(module, exports, require, global) {
var stat = require("./stat");
var utils = require("../common/utils");
var logger = require("./logger");

var Manager = function() {
    this.linkTabId = null;
};

Manager.prototype.init = function() {
    if (chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    }

    chrome.tabs.onRemoved.addListener(function(tabId, info) {
        if (this.linkTabId == tabId) {
            this.linkTabId = null;
        }
    }.bind(this));
    this.setVolume = utils.debounce(500, false, this.setVolume.bind(this));

    this.initAppCookie();
    this.initAppVolume();
    stat.start();
};

Manager.prototype.getSelectedTab = function(callback) {
    if (typeof callback !== "function") {
        return;
    }
    chrome.tabs.query({ active: true }, function(tabs) {
        tabs = tabs || [];
        callback(tabs[0]);
    });
};

Manager.prototype.setSelectedTab = function(id) {
    if (isNaN(id)) {
        return;
    }
    chrome.tabs.update(id, {selected: true});
    chrome.tabs.get(id, function(tab) {
        if (tab && tab.windowId) {
            chrome.windows.update(tab.windowId, { focused: true });
        }
    });
};

Manager.prototype.openLink = function(url, forceNew, callback) {
    if (!forceNew && this.linkTabId) {
        chrome.tabs.update(this.linkTabId, { url: url, selected: true });
    } else {
        chrome.tabs.create({ url: url, selected: true }, function(tab) {
            if (!forceNew) {
                this.linkTabId = tab.id;
            }
            if (callback) {
                callback(tab);
            }
        }.bind(this));
    }
};

Manager.prototype.setItem = function(key, value) {
    if (!chrome.storage.sync) {
        return;
    }

    var param = {};
    param[key] = value;
    chrome.storage.sync.set(param, function() {});
};

Manager.prototype.getItem = function(key, callback) {
    if (!chrome.storage.sync) {
        if (callback) {
            callback();
        }
        return;
    }

    chrome.storage.sync.get(key, function(result) {
        if (callback) {
            callback(result && result[key]);
        }
    });
};

Manager.prototype.setVolume = function(value) {
    this.setItem("volume", value);
};

Manager.prototype.getVolume = function(callback) {
    this.getItem("volume", callback);
};

Manager.prototype.getCookie = function(url, key, callback) {
    chrome.cookies.get({url: url, name: key}, function(data) {
        if (callback) {
            callback(data);
        }
    });
};

Manager.prototype.initAppCookie = function() {
    var cookieKey = "musicchrome";
    var domain = ".yandex.ru";
    var yaCookieKey = "ys";
    var regExp = new RegExp(cookieKey + "\\.([\\d]{1,2}-[\\d]{1,2}-[\\d]{1,2})");
    var version = (chrome.runtime.getManifest() || {}).version;
    var newValue = cookieKey + "." + version.replace(/\./g, "-");
    chrome.cookies.get({ url: "https://yandex.ru", name: yaCookieKey }, function(data) {
        var value = (data || {}).value;
        if (!value) {
            value = newValue;
        } else if (value.indexOf(cookieKey) != -1) {
            value = value.replace(regExp, newValue);
        } else {
            value = value + "#" + newValue;
        }
        chrome.cookies.set({ url: "https://yandex.ru", domain: domain, name: yaCookieKey, value: value });
    });
};

Manager.prototype.initAppVolume = function() {
    this.getItem("volume", function(value) {
        if (isNaN(value)) {
            this.setItem("volume", 0.5);
        }
    }.bind(this));
};

Manager.prototype.onInstalled = function(info) {
    var self = this;
    var conf = chrome.runtime.getManifest();
    var cs = conf["content_scripts"].map(function(item) {
        return {
            matches: item.matches.map(self.patternToRegExp),
            js: item.js
        }
    });
    var testTab = function(tab) {
        cs.forEach(function(item) {
            var isMatch = item.matches.some(function(regExp) {
                return regExp.test(tab.url)
            });
            if (isMatch) {
                item.js.forEach(function(js) {
                    chrome.tabs.executeScript(tab.id, {file: js});
                });
            }
        });
    };
    chrome.tabs.query({}, function(tabs) {
        tabs.forEach(testTab);
    });
};

Manager.prototype.patternToRegExp = function(str) {
    str = str.replace(/\./g, "\\.")
             .replace(/\*/g, ".*");
    return new RegExp(str);
};

module.exports = new Manager();

}
,"background/stat.js": function(module, exports, require, global) {
var storage = require("../common/storage");
var utils = require("../common/utils");

var host = "https://soft.export.yandex.ru/status.xml";
var uiKey = "stat.ui";
var statTimeKey = "stat.time";

var ts = {
    DAY: 24 * 60 * 60 * 1000,
    TWO_HOURS: 2 * 60 * 60 * 1000,
    START_DELAY: 10 * 1000
};
var type = {
    DAY: "dayuse",
    INSTALL: "install",
    UNINSTALL: "uninstall"
};

var Stat = function() {
    this.params = {
        brandID: "yandex",
        yasoft: "musicchr",
        os: this.getOs(),
        ver: this.getVersion(),
        ui: this.getUi(),
        // TODO: получить сид?
        //clid: "",
    };
    this.started = false;
};

Stat.prototype.start = function() {
    if (!this.started) {
        this.started = true;
        setInterval(this.tick.bind(this), ts.TWO_HOURS);
        setTimeout(this.tick.bind(this), ts.START_DELAY);
    }
};

Stat.prototype.tick = function() {
    var time = storage.getItem(statTimeKey);
    var now = (new Date()).valueOf();
    if (!time || (now - time > ts.DAY)) {
        this.send(time ? type.DAY : type.INSTALL);
    }
};

Stat.prototype.send = function(type) {
    var url = this.getUrl(type);
    var request = this.request(url);
};

Stat.prototype.request = function(url) {
    var request = new XMLHttpRequest();
    try {
        request.withCredentials = true;
    } catch (e) {}
    request.open("GET", url, false);
    request.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2005 00:00:00 GMT");
    request.onload =  this.response.bind(this);
    request.onerror = this.error.bind(this);
    request.send();
    return request;
};

Stat.prototype.response = function(data) {
    var request = data.target;
    var xml = request.responseXML;
    var success;
    try {
        var page = xml.getElementsByTagName("page")[0];
        success = page.textContent.indexOf("ok") != -1;
    } catch(ex) {
        success = false;
    } finally {
        if (success) {
            storage.setItem(statTimeKey, new Date().valueOf());
        }
    }
};

Stat.prototype.error = function(err) {

};

Stat.prototype.makeQuery = function(object) {
    var array = [], j = 0;
    for (var key in object) {
        if (!object.hasOwnProperty(key)) {
            return;
        }
        var value = object[key];
        if (value !== null) {
            if (value instanceof Array) {
                for (var i = 0; i < value.length; i++) {
                    array.push(encodeURIComponent(key) + "=" + encodeURIComponent(value[i]));
                }
            } else {
                array.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
            }
        }
    }
    return array.join("&");
};

Stat.prototype.getUrl = function(type) {
    var query = this.makeQuery(utils.extend({stat: type}, this.params));
    return host + "?" + query;
};

Stat.prototype.getUi = function() {
    var ui = storage.getItem(uiKey);
    if (!ui) {
        ui = '{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}';
        var mask = '0123456789ABCDEF';
        while (ui.indexOf('x') != -1) {
            ui = ui.replace('x', mask[Math.floor(Math.random() * 16)]);
        }
        storage.setItem(uiKey, ui);
    }
    return ui;
};

Stat.prototype.getOs = function() {
    var platform = navigator.platform;
    if (platform.toLowerCase().indexOf("win") == 0) {
        platform = "winnt";
    }
    if (platform.toLowerCase().indexOf("mac") == 0) {
        platform = "darwin";
    }
    return platform;
};

Stat.prototype.getVersion = function() {
    var manifest = chrome.runtime.getManifest();
    return manifest.version;
};

module.exports = new Stat();

}
,"common/storage.js": function(module, exports, require, global) {
function Storage() {
};

Storage.prototype.setItem = function(key, value) {
    if (typeof value != "undefined") {
        window.localStorage.setItem(key, value);
    } else {
        window.localStorage.removeItem(key);
    }
    return value;
};

Storage.prototype.getItem = function(key) {
    return window.localStorage.getItem(key);
};

module.exports = new Storage();

}
,"common/utils.js": function(module, exports, require, global) {
var utils = {
    throttle: function(delay, no_trailing, callback, debounce_mode) {
        var timeout_id,
            last_exec = 0;

        if (typeof no_trailing !== 'boolean') {
            debounce_mode = callback;
            callback = no_trailing;
            no_trailing = undefined;
        }

        function wrapper() {
            var that = this,
                elapsed = +new Date() - last_exec,
                args = arguments;

            function exec() {
                last_exec = +new Date();
                callback.apply(that, args);
            };
            function clear() {
                timeout_id = undefined;
            };
            if (debounce_mode && !timeout_id) {
                exec();
            }
            timeout_id && clearTimeout(timeout_id);
            if (debounce_mode === undefined && elapsed > delay) {
                exec();
            } else if (no_trailing !== true) {
                timeout_id = setTimeout(debounce_mode ? clear : exec, debounce_mode === undefined ? delay - elapsed : delay);
            }
        };
        return wrapper;
    },

    debounce: function(delay, at_begin, callback) {
        return callback === undefined
            ? this.throttle(delay, at_begin, false)
            : this.throttle(delay, callback, at_begin !== false);
    },

    named: function(regexp) {
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
    },

    inherit: function(ctor, proto) {
        var f = function() {};
        f.prototype = proto;
        ctor.prototype = new f();
    },

    extend: function(dest, source) {
        for (var prop in source) {
            if (source.hasOwnProperty(prop)) {
                dest[prop] = source[prop];
            }
        }
        return dest;
    }
};

module.exports = utils;

}
,"background/logger.js": function(module, exports, require, global) {
var Logger = require("../common/remoteLogger");
var consts = require("../common/consts");
var Msg = require("../common/messenger");

var msg = new Msg(consts.SOURCE_BG, consts.SOURCE_DEBUG, Msg.mode.HOST);
var logger = new Logger(consts.SOURCE_BG, msg);

msg.start();

module.exports = logger;

}
,"common/remoteLogger.js": function(module, exports, require, global) {
var conf = require("./conf");
var consts = require("./consts");

var Logger = require("./logger");

var RemoteLogger = function(source, msg) {
    this.source = source;
    this.msg = msg;
};

RemoteLogger.prototype = new Logger();

RemoteLogger.prototype.write = function(entry) {
    try {
        var level = entry.level;
        var msg = this.formatMessage(entry.data);
        var time = this.formatDate(entry.ts);
        console[level].call(console, time + ": " + msg);
        this.msg.send("log", { level: level, msg: msg, time: time, source: this.source });
    } catch (e) {}
};

conf.get(function(conf) {
    if (!conf.debug) {
        Logger.LEVELS.forEach(function(level) {
            RemoteLogger.prototype[level] = function() {
            };
        });
    }
});

module.exports = RemoteLogger;

}
,"common/conf.js": function(module, exports, require, global) {
var DataSrc = require("./datasrc");

module.exports = {
    get: function(callback) {
        DataSrc.get(chrome.extension.getURL('/config/conf.json'), { contentType: "application/json" }, function(data) {
            callback(data);
        });
    }
};

}
,"common/logger.js": function(module, exports, require, global) {
var Logger = function() {
};

Logger.LEVELS = ["log", "debug", "info", "warn", "error"];

Logger.prototype._log = function(level /** data to log */) {
    var data = [].slice.call(arguments, 1);
    var entry = {
        level: level,
        data: data,
        ts: (new Date()).getTime()
    };
    this.write(entry);
};

Logger.prototype.mute = function(level) {
    if (Logger.LEVELS.indexOf(level) != -1) {
        this[level] = function() {};
    }
};

Logger.prototype.write = function(entry) {
    try {
        var level = entry.level;
        var msg = this.formatMessage(entry.data);
        var time = this.formatDate(entry.ts);
        console[level].call(console, time + ": " + msg);
    } catch (e) {}
};

Logger.prototype.formatMessage = function(data) {
    return data.map(function(item) {
        return item && (typeof item === "object") ? JSON.stringify(item) : item;
    }).join(" | ");
};

Logger.prototype.formatDate = function(timestamp) {
    var date = new Date(timestamp);
    var ms = date.getMilliseconds();
    ms = ms > 100 ? ms : ms > 10 ? "0" + ms : "00" + ms;
    return date.toLocaleTimeString() + "." + ms;
};

Logger.LEVELS.forEach(function(level) {
    Logger.prototype[level] = function() {
        this._log.apply(this, [level].concat(Array.prototype.slice.apply(arguments)));
    };
});

module.exports = Logger;

}
,"common/messenger.js": function(module, exports, require, global) {
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
,"common/winMessenger.js": function(module, exports, require, global) {
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
,"common/eventize.js": function(module, exports, require, global) {
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
,"background/tabs.js": function(module, exports, require, global) {
var eventize = require("../common/eventize");
var consts = require("../common/consts");

var Tabs = function() {
    this.items = {};
    this.activeId = null;
    eventize(this);
};

Tabs.prototype.add = function(id, port) {
    if (id && !this.items[id]) {
        this.items[id] = {
            id: id,
            port: port,
            state: consts.STATE_PAUSED,
            buttons: {
                "play": consts.BUTTON_STATE_ENABLED,
                "next": consts.BUTTON_STATE_ENABLED,
                "prev": consts.BUTTON_STATE_ENABLED,
                "like": consts.BUTTON_STATE_HIDDEN,
                "dislike": consts.BUTTON_STATE_HIDDEN,
                "volume": consts.BUTTON_STATE_HIDDEN
            },
            enabled: true,
            ts: new Date().getTime()
        };
    }
    if (!this.activeId) {
        this.setActiveId(id);
    }
    this.trigger(consts.ACTION_TABS_CHANGED);
    return this.items[id];
};

Tabs.prototype.remove = function(id) {
    var item = this.items[id];
    if (item) {
        delete this.items[id];
    }
    if (this.activeId == id) {
        this.activeId = null;
    }
    this.trigger(consts.ACTION_TABS_CHANGED);
    return item;
};

Tabs.prototype.enable = function(id, state) {
    var tab = this.get(id);
    if (tab && tab.enabled !== state) {
        tab.enabled = typeof state == "undefined" ? true : !!state;
        if (!tab.enabled && id == this.activeId) {
            this.setActiveId(null);
        }
        this.trigger(consts.ACTION_TABS_CHANGED);
    }
};

Tabs.prototype.get = function(id) {
    return this.items[id];
};

Tabs.prototype.getTabs = function() {
    return this.toArray(this.items).filter(function(tab) {
        return tab.enabled && !!tab.context;
    });
};

Tabs.prototype.getActive = function() {
    return this.items[this.activeId];
};

Tabs.prototype.getActiveId = function() {
    return this.activeId;
};

Tabs.prototype.setActiveId = function(id) {
    var oldValue = this.activeId;
    if (this.activeId == id) {
        return;
    }
    this.activeId = id;
    this.enable(id, true);
    this.trigger(consts.ACTION_ACTIVE_CHANGED, { oldValue: oldValue, value: this.activeId });
};

Tabs.prototype.isActive = function(id) {
    return id == this.activeId;
};

Tabs.prototype.toArray = function(obj) {
    var result = [];
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
            result.push(obj[prop]);
        }
    }
    return result;
};

module.exports = Tabs;

}
,"background/radio.js": function(module, exports, require, global) {
var consts = require("../common/consts");
var eventize = require("../common/eventize");
var dataSrc = require("../background/datasrc");
var Flow = require("./flow");
var logger = require("./logger");
var auth = require("./auth");

var musicHost = Flow.MUSIC_HOST;
var id = "radio";

var Radio = function() {
    eventize(this);
    this.flow = new Flow();
    this.flow.init();
    this.flow.on("state", this.onStateChange.bind(this));
    this.flow.on("changeCurrent", this.onChangeCurrent.bind(this));
    this.flow.on("volume", function() {
        this._trigger(consts.ACTION_VOLUME, this.flow.getVolume());
    }.bind(this));

    this.connected = false;

    // HACK: implement chrome api port format.
    this.source = {
        id: id,
        name: id,
        sender: { tab: { id: id } }
    };

    auth.on("info", function() {
        this.onClearRadio();
    }.bind(this));
};

Radio.prototype.send = function(event, msg) {
    switch(event) {
        case consts.ACTION_START_RADIO:
            this.onPlay(msg);
            this.onChangeContext(msg);
            break;
        case consts.ACTION_PLAY:
            this.onTogglePause();
            break;
        case consts.ACTION_NEXT:
            this.onFeedback(Flow.consts.FEEDBACK_SKIP);
            break;
        case consts.ACTION_LIKE:
            this.onLike();
            break;
        case consts.ACTION_DISLIKE:
            this.onFeedback(Flow.consts.FEEDBACK_DISLIKE);
            break;
        case consts.ACTION_VOLUME:
            this.onVolume(msg);
            break;
        default:
            break;
    }
};

Radio.prototype.onStateChange = function(evt) {
    if (!this.connected) {
        return;
    }
    var state = this.flow.getState();
    var value = state === Flow.consts.STATE_ADV_PLAYING || state === Flow.consts.STATE_PLAYING ? consts.STATE_PLAYING : consts.STATE_PAUSED;
    this._trigger(consts.ACTION_STATE, value);
};

Radio.prototype.onChangeCurrent = function() {
    var track = this.flow.getCurrent();
    if (!track) {
        return;
    }
    var artist = this._getArtist(track);
    var album = this._getAlbum(track);
    this._trigger(consts.ACTION_TRACK, {
        title: track.title,
        album: album.title,
        artist: artist.name,
        cover: this._getCover(track),
        liked: track.liked,
        url: musicHost + "album/" + album.id + "/track/" + track.id,
        artistUrl: musicHost + "artist/" + artist.id
    });
};

Radio.prototype.onPlay = function(id) {
    if (!id || !id.type || !id.tag) {
        return;
    }
    // if previous radio played, trigger disconnected
    if (this.flow.flow) {
        this.connected = false;
        this._trigger(consts.ACTION_DISCONNECTED);
    }
    this.connected = true;
    this._trigger(consts.ACTION_CONNECTED);
    this._trigger(consts.ACTION_BTN_STATE, { button: consts.BUTTON_PREV, state: consts.BUTTON_STATE_DISABLED });
    this._trigger(consts.ACTION_BTN_STATE, { button: consts.BUTTON_LIKE, state: consts.BUTTON_STATE_VISIBLE });
    this._trigger(consts.ACTION_BTN_STATE, { button: consts.BUTTON_DISLIKE, state: consts.BUTTON_STATE_VISIBLE });
    this._trigger(consts.ACTION_BTN_STATE, {button: consts.BUTTON_VOLUME, state: consts.BUTTON_STATE_VISIBLE });
    this.flow.playRadio({type: id.type, tag: id.tag});
};

Radio.prototype.onClearRadio = function() {
    this.flow.clearRadio();
    this.connected = false;
    this._trigger(consts.ACTION_DISCONNECTED);
};

Radio.prototype.onChangeContext = function(id) {
    var self = this;
    if (!id || !id.type || !id.tag) {
        return;
    }
    dataSrc.get("handler://library", {}, function(data) {
        if (!data && !data.stations) {
            return;
        }

        var item = data.stations[id.type + ":" + id.tag];
        var station = item && item.station;
        if (station) {
            var icon = "https://" + station.icon.imageUrl.replace("%%", "m100x100");

            this._trigger(consts.ACTION_CONTEXT, {
                "icon": icon,
                "color": station.icon.backgroundColor,
                "title": station.name,
                "source": "Яндекс.Радио",
                "bar": consts.BAR_FEEDBACK,
                "stationId": id
            });
            this._trigger(consts.ACTION_VOLUME, this.flow.getVolume());
        }
    }.bind(this));
};

Radio.prototype.onLike = function() {
    var track = this.flow.getCurrent();
    if (!track) {
        return;
    }
    track.liked = !track.liked;
    this.onFeedback(track.liked ? Flow.consts.FEEDBACK_LIKE : Flow.consts.FEEDBACK_UNLIKE);
    this.onChangeCurrent();
};

Radio.prototype.onFeedback = function(feedback) {
    this.flow.sendFeedback(feedback);
};

Radio.prototype.onTogglePause = function() {
    this.flow.togglePause();
};

Radio.prototype.onVolume = function(value) {
    this.flow.setVolume(value);
};

Radio.prototype._getCover = function(track) {
    var album = track.albums && track.albums[0];
    if (album && album.coverUri) {
        return "https://" + album.coverUri.replace("%%", "80x80");
    } else {
        return "";
    }
};

Radio.prototype._getAlbum = function(track) {
    return (track.albums && track.albums[0] && track.albums[0]) || {};
};

Radio.prototype._getArtist = function(track) {
    return (track.artists && track.artists[0] && track.artists[0]) || {};
};

Radio.prototype._trigger = function(event, data) {
    this.trigger(event, {
        event: event,
        data: data
    },this.source);
};

module.exports = Radio;

}
,"background/flow.js": function(module, exports, require, global) {
var auth = require("./auth");
var eventize = require("../common/eventize");
var from = "radio-chrome";
var defaultContext = {id: {}, from: from};
var Vow = require("vow");

var consts = {

    FEEDBACK_LIKE: "like",
    FEEDBACK_UNLIKE: "unlike",
    FEEDBACK_DISLIKE: "dislike",
    FEEDBACK_UNDISLIKE: "undislike",
    FEEDBACK_SKIP: "skip",

    REASON_PLAY: "playpressed",
    REASON_NEXT: "nextpressed",
    REASON_PREV: "prevpressed",
    REASON_AUTO: "auto",

    // error codes

    ERROR_RIGHTS: "rightsError",
    ERROR_PLAYER: "playerFailed",
    ERROR_PLAY: "playError",
    ERROR_FLOW: "flowError",

    // radio states

    STATE_NONE: "none",
    STATE_PLAYING: "playing",
    STATE_PAUSED: "paused",
    STATE_ADV_PLAYING: "advPlaying",
    STATE_ADV_PAUSED: "advPaused",
    STATE_ADV_WAITING: "advWaiting",

    // adv loader states

    ADV_STATE_WAITING: "waitingPlay",
    ADV_STATE_PLAYING: "playing",
    ADV_STATE_PAUSED: "paused",
    ADV_STATE_FAILED: "failed",

    ADV_STATE_PRELOADING: "preloading",
    ADV_STATE_PRELOADED: "preloaded",
    ADV_STATE_LOADING: "loading",
    ADV_STATE_LOADED: "loaded",
    ADV_STATE_READY: "ready"
};

var PlayFlow = function() {
    this.flow = null;
    eventize(this);
};

PlayFlow.consts = consts;
PlayFlow.MUSIC_HOST = "https://music.yandex.ru/";

PlayFlow.prototype.init = function() {
    this.flowAPI = Ya.Music.Player.flowAPI;
    this.player = new Ya.Music.Player(null);
    this.advLoader = Ya.Music.Advert.loader;

    this.player.on("trackdata", function(player, trackData) {
        player.additionalData = this.getAdditionalData(trackData);
    }.bind(this));
    this.player.on("preloading", function(player, trackData) {
        player.preloadData = this.getAdditionalData(trackData);
    }.bind(this));
    this.player.on("status", this.onStateChange.bind(this));

    this.advLoader.on("setState:paused", this.onStateChange.bind(this));
    this.advLoader.on("setState:playing", this.onStateChange.bind(this));

    this.advLoader.on("started", this.onAdvPlay.bind(this));
    this.advLoader.on("stopped", this.onAdvStop.bind(this));
    this.advLoader.on("error", this.onAdvError.bind(this));

    this.player.on("volume", function() {
        this.trigger("volume");
    }.bind(this));

    var updateApiAuth = function() {
        try {
            Ya.Music.updateAuth();
        } catch (ex) {}
    };

    setInterval(updateApiAuth, 1 * 60 * 60 * 1000);
    auth.on("info", updateApiAuth);
};

PlayFlow.prototype.playRadio = function(id, callback) {
    var self = this;
    var flow = self.createFlow(id);
    self.setFlow(flow, function() {
        self.play(consts.REASON_PLAY);
        if (callback) {
            callback();
        }
    });
};

PlayFlow.prototype.clearRadio = function() {
    // unsubscribe from previous flow
    if (!this.flow) {
        return;
    }
    this.player.stop();
    this.flow.clearListeners();
    this.flow = null;
};

PlayFlow.prototype.togglePause = function() {
    var state = this.getState();
    switch (state) {
        case consts.STATE_PLAYING:
            this.player.pause();
            break;
        case consts.STATE_PAUSED:
            this.player.resume();
            break;
        case consts.STATE_ADV_PLAYING:
            this.advLoader.pause();
            break;
        case consts.STATE_ADV_PAUSED:
            this.advLoader.resume();
            break;
        case consts.STATE_NONE:
            if (this.getCurrent()) {
                this.play(consts.REASON_PLAY);
            }
            break;
        default:
            break;
    }
};

PlayFlow.prototype.sendFeedback = function(type, track, callback) {
    if (!this.flow || this.throttled || this.isAdvShowing()) {
        return;
    }

    auth.check();

    var params = this.getFeedbackParams(type, track);
    var delay = setTimeout(function() {
        this.throttled = false;
    }.bind(this), 2000);

    if (type === consts.FEEDBACK_DISLIKE || type === consts.FEEDBACK_SKIP) {
        this.throttled = true;
    }
    this.flow.sendFeedback(params, function() {
        this.throttled = false;
        clearTimeout(delay);
        if (callback) {
            callback();
        }
    }.bind(this));
    this.onFeedback({type: type, track: track});
};

PlayFlow.prototype.getCurrent = function() {
    return this.flow && this.flow.getTrack();
};

PlayFlow.prototype.getTracks = function() {
    return this.flow && this.flow.getList();
};

PlayFlow.prototype.getIndex = function() {
    return this.flow && this.flow.getIndex();
};

PlayFlow.prototype.getContext = function() {
    return (this.flow && this.flow.context) || defaultContext;
};

PlayFlow.prototype.getAdvData = function() {
    return this.advLoader.getData();
};

PlayFlow.prototype.getState = function() {
    var advState = this.advLoader.getState();
    if (advState === consts.ADV_STATE_WAITING) {
        return consts.STATE_ADV_WAITING;
    } else if (advState === consts.ADV_STATE_PAUSED) {
        return consts.STATE_ADV_PAUSED;
    } else if (advState === consts.ADV_STATE_PLAYING) {
        return consts.STATE_ADV_PLAYING;
    } else if (this.player.isPlaying()) {
        return consts.STATE_PLAYING;
    } else if (this.player.isPaused()) {
        return consts.STATE_PAUSED;
    } else {
        return consts.STATE_NONE;
    }
};

PlayFlow.prototype.getVolume = function() {
    return this.player.getVolume();
};

PlayFlow.prototype.canShowAdv = function() {
    var current = this.getCurrent();
    var advState = this.advLoader.getState();
    return current && current.advert
        && advState !== consts.ADV_STATE_FAILED
        && (advState === consts.ADV_STATE_PRELOADING
        || advState === consts.ADV_STATE_PRELOADED
        || advState === consts.ADV_STATE_LOADING
        || advState === consts.ADV_STATE_LOADED
        || advState === consts.ADV_STATE_READY);
};

PlayFlow.prototype.isAdvShowing = function() {
    var state = this.getState();
    return state === consts.STATE_ADV_WAITING
        || state === consts.STATE_ADV_PLAYING
        || state === consts.STATE_ADV_PAUSED;
};

/** private */
PlayFlow.prototype.getAdditionalData = function(track) {
    var data = {};
    data.from = from;
    return data;
};

/** private */
PlayFlow.prototype.play = function(reason) {
    if (!this.flow) {
        throw new Error("No flow specified");
    }

    if (this.player.getStatus() === "failed") {
        this.onError(consts.ERROR_PLAYER);
        return;
    }

    var onPlay = function(err, succ) {
        if (err || !succ) {
            this.onError(consts.ERROR_PLAY, this.flow.getTrack());
        }
    }.bind(this);

    var play = function() {
        this.flow.play(reason || consts.REASON_AUTO, null, onPlay);
    }.bind(this);

    this.flow.onInit(function() {
        if (this.isAdvShowing()) {
            this.advLoader.once("stopped", play);
            this.advLoader.once("error", play);
        } else {
            play();
        }
    }.bind(this));
};

/** private */
PlayFlow.prototype.createFlow = function(id) {
    var flow = new this.flowAPI.FlowNewRadio(id.type, id.tag);
    flow.context = {id: id, from: from };
    flow.needNextCount = 1;
    flow.oldTracksCount = 1;
    return flow;
};

/** private */
PlayFlow.prototype.setFlow = function(flow, callback) {
    this.clearRadio();

    // если играет реклама в момент запуска
    if (this.player.isLocked()) {
        if (this.unlocker) {
            this.player.off("locked", this.unlocker);
        }

        this.unlocker = function(_, locked) {
            if (locked) {
                return;
            }
            this.setFlow(flow, callback);
            this.player.off("locked", this.unlocker);
            this.unlocker = false;
        }.bind(this);

        this.player.on("locked", this.unlocker);
        return;
    }

    //subscibe to new flow
    flow.on("update", function(reason, list, index, trackData, navInfo) {
        if (reason === "list" || reason === "all") {
            this.onChangeTracks();
        }

        if (trackData && trackData.id && (reason === "index" || reason === "all")) {
            this.onChangeCurrent();
        }
    }.bind(this));
    flow.on("ended", function() {
        this.endMetrics();
    }.bind(this));

    this.flow = flow;
    this.player.requestOptions.from = from;

    this.player.setFlow(flow, function(error, data) {
        if (error) {
            this.onError(consts.ERROR_FLOW, data);
            return;
        }
        this.onChangeFlow();
        if (callback) {
            callback(data);
        }
    }.bind(this));
};

PlayFlow.prototype.setVolume = function(value) {
    this.player.whenReady(function() {
        if (value != -1) {
            this.player.setVolume(value);
        } else {
            this.player.toggleMute();
        }
    }.bind(this));
};

/**
 * Event listeners
 */

PlayFlow.prototype.onAdvPlay = function(data) {
    this.trigger("advStarted");
    this.onStateChange();
};

PlayFlow.prototype.onAdvStop = function(data) {
    this.trigger("advStopped");
    this.onStateChange();
};

PlayFlow.prototype.onAdvError = function(data) {
    this.trigger("advError", data);
    this.onStateChange();
};

PlayFlow.prototype.onStateChange = function(data) {
    this.trigger("state");
};

/** private */
PlayFlow.prototype.onFeedback = function(data) {
    data.track = data.track || this.getCurrent();
    this.trigger("feedback", data);
};

/** private */
PlayFlow.prototype.onChangeFlow = function(data) {
    this.__current = null;
    this.trigger("changeFlow");
};

/** private */
PlayFlow.prototype.onChangeTracks = function(data) {
    this.trigger("changeTracks");
};

/** private */
PlayFlow.prototype.onChangeCurrent = function(data) {
    var current = this.getCurrent();
    if (current === this.__current) {
        return;
    }
    this.__current = current;
    // hack for stupid adv
    if (current.advert) {
        this.onStateChange();
    }

    auth.check();

    this.trigger("changeCurrent");
};

/** private */
PlayFlow.prototype.onError = function(error, data) {
    if (error === consts.ERROR_RIGHTS) {
        this.notify.show(consts.ERROR_RIGHTS);
    }
    this.trigger("error", {reason: error});
};

/** private */
PlayFlow.prototype.getFeedbackParams = function(type, track) {
    if (!track) {
        return type;
    }
    return {
        type: type,
        data: {
            trackId: track.id,
            albumId: track.albums && track.albums[0] && track.albums[0].id
        }
    };
};

var apiPromise;
function loadApi() {;
    var body = document.body;
    var script = document.createElement('script');
    var defer = Vow.defer();
    script.type = 'text/javascript';
    script.src = PlayFlow.MUSIC_HOST + "api/v1.6/index.js";

    script.onload = function() {
        defer.resolve();
    };

    // TODO: try reload
    script.onerror = function() {
        apiPromise = undefined;
        script.remove();
        defer.reject();
    };

    // Fire the loading
    body.appendChild(script);
    return defer.promise();
};

[
    "init",
    "playRadio",
    "togglePause",
    "sendFeedback"
].forEach(function(name) {
    var fn = PlayFlow.prototype[name];
    PlayFlow.prototype[name] = function() {
        var args = arguments;
        var self = this;
        if (!apiPromise) {
            apiPromise = loadApi();
        }
        apiPromise.then(function() {
            fn.apply(self, args);
        });
    }
})

module.exports = PlayFlow;

}
,"../node_modules/vow/lib/vow.js": function(module, exports, require, global) {
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
,"background/commands.js": function(module, exports, require, global) {
var eventize = require("../common/eventize");
var consts = require("../common/consts");

var Commands = function() {
    // try/catch - for Firefox (check `chrome.commands.onCommand` is not enough).
    try {
        chrome.commands.onCommand.addListener(this._onCommand.bind(this));
    } catch (e) {}

    eventize(this);
};

Commands.prototype._onCommand = function(command) {
    this._trigger(command);
};

Commands.prototype._trigger = function(event, data) {
    this.trigger(event, {
        event: event,
        data: data
    }, this);
};

module.exports = Commands;

}
,"background/composer.js": function(module, exports, require, global) {
var consts = require("../common/consts");

var Composer = function(items) {
    this.items = items || [];
    this.ports = {};
    this.init();
};

Composer.prototype.init = function() {
    var self = this;
    self.items.forEach(function(item, index) {
        item.on(consts.ACTION_CONNECTED, function(evt, source) {
            self.ports[source.id] = index;
        });
    });
    self.items.forEach(function(item, index) {
        item.on(consts.ACTION_DISCONNECTED, function(evt, source) {
            self.ports[source.id] = index;
        });
    });
};

Composer.prototype.on = function(event, callback) {
    this.items.forEach(function(item) {
        item.on(event, callback);
    });
};

Composer.prototype.send = function(event, msg, port) {
    if (port) {
        var id = this.ports[port.id];
        var item = this.items[id];
        item.send(event, msg, port);
    } else {
        this.items.forEach(function(item) {
            item.send(event, msg, port);
        });
    }
};

module.exports = Composer;

}
}, {"vow":"../node_modules/vow/lib/vow.js"});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlcy9qcyIsInNvdXJjZXMiOlsiYmFja2dyb3VuZC5qcyIsImJhY2tncm91bmQvZGF0YXNyYy5qcyIsImNvbW1vbi9kYXRhc3JjLmpzIiwiYmFja2dyb3VuZC9hdXRoLmpzIiwiY29tbW9uL2NvbnN0cy5qcyIsImJhY2tncm91bmQvZXh0TWFuYWdlci5qcyIsImJhY2tncm91bmQvc3RhdC5qcyIsImNvbW1vbi9zdG9yYWdlLmpzIiwiY29tbW9uL3V0aWxzLmpzIiwiYmFja2dyb3VuZC9sb2dnZXIuanMiLCJjb21tb24vcmVtb3RlTG9nZ2VyLmpzIiwiY29tbW9uL2NvbmYuanMiLCJjb21tb24vbG9nZ2VyLmpzIiwiY29tbW9uL21lc3Nlbmdlci5qcyIsImNvbW1vbi93aW5NZXNzZW5nZXIuanMiLCJjb21tb24vZXZlbnRpemUuanMiLCJiYWNrZ3JvdW5kL3RhYnMuanMiLCJiYWNrZ3JvdW5kL3JhZGlvLmpzIiwiYmFja2dyb3VuZC9mbG93LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3Zvdy9saWIvdm93LmpzIiwiYmFja2dyb3VuZC9jb21tYW5kcy5qcyIsImJhY2tncm91bmQvY29tcG9zZXIuanMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQURBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9XQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDZkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMxRUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BDQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNyS0EsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzdJQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbEJBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN2RkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNYQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDakNBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ1ZBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNuREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM1SUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3hFQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDckdBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzNMQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3ZjQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMzd0NBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pCQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7In0=
