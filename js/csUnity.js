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

    require.call({moduleName: "csUnity.js"}, "csUnity.js");
})({"csUnity.js": function(module, exports, require, global) {
var consts = require("./common/consts.js");
var Msg = require("./common/messenger.js");
var injector = require("./content/injector.js");


var msgWin = new Msg(consts.SOURCE_CONTENT, consts.SOURCE_INJECTED, Msg.mode.HOST);
var msgBg = new Msg(consts.SOURCE_CONTENT, consts.SOURCE_BG, Msg.mode.CLIENT);

msgBg.start();
msgWin.start();

msgBg.on(consts.ACTION_BROADCAST, function(evt) {
    msgWin.send(evt.event, evt.data);
});

msgWin.on(consts.ACTION_BROADCAST, function(evt) {
    msgBg.send(evt.event, evt.data);
});

injector.inject("/js/unity.js", function() {
    msgWin.send("unityInjected");
});

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
,"content/injector.js": function(module, exports, require, global) {
var inject = function(path, callback) {
    var script = document.createElement("script");
    script.src = chrome.extension.getURL(path);
    script.onload = function() {
        if (callback) {
            callback();
        }
        script = null;
    };
    (document.head || document.documentElement).appendChild(script);
};

module.exports = {
    inject: inject
};

}
}, {});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3NVbml0eS5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlcy9qcyIsInNvdXJjZXMiOlsiY3NVbml0eS5qcyIsImNvbW1vbi9jb25zdHMuanMiLCJjb21tb24vbWVzc2VuZ2VyLmpzIiwiY29tbW9uL3dpbk1lc3Nlbmdlci5qcyIsImNvbnRlbnQvaW5qZWN0b3IuanMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQURBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdkJBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMvREEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM1SUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3hFQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzsifQ==
