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

    require.call({moduleName: "csController.js"}, "csController.js");
})({"csController.js": function(module, exports, require, global) {
var consts = require("./common/consts.js");
var Msg = require("./common/messenger.js");
var Controller = require("./content/controller");

var msgBg = new Msg(consts.SOURCE_CONTENT, consts.SOURCE_BG, Msg.mode.CLIENT);
var controller = new Controller(Mu.conf);

msgBg.on(consts.ACTION_BROADCAST, function(evt) {
    controller.send(evt.event, evt.data);
});
msgBg.start();

controller.on(consts.ACTION_BROADCAST, function(evt) {
    msgBg.send(evt.event, evt.data);
});
controller.start();

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
,"content/controller.js": function(module, exports, require, global) {
var Observer = require("./observer");
var eventize = require("../common/eventize");
var consts = require("../common/consts");
var utils = require("../common/utils");

var Controller = function(conf) {
    conf = conf || {};
    this.title = conf.title;
    this.icon = conf.icon;
    this.trackRegExp = !!conf.trackRegExp ? utils.named(conf.trackRegExp) : undefined;
    this.selectors = conf.selectors || {};
    this.overrides = conf.overrides || {};
    this.observer = new Observer();
    this.elements = {};

    this.play = Controller.prototype.click.bind(this, consts.ACTION_PLAY);
    this.prev = Controller.prototype.click.bind(this, consts.ACTION_PREV);
    this.next = Controller.prototype.click.bind(this, consts.ACTION_NEXT);

    eventize(this);
};

Controller.prototype.start = function() {
    var self = this;
    var player = self._getElement(self.selectors.player);
    if (player) {
        self.onReady();
    } else {
        var body = document.body;
        self.observer.on(body, "domChanged", function(evt) {
            if (!evt.addedNodes || !evt.addedNodes.length) {
                return;
            }
            for (var i = 0; i < evt.addedNodes.length; i++) {
                var element = evt.addedNodes[i];
                if (typeof element.matches === "function" && element.matches(self.selectors.player)) {
                    self.onReady();
                    self.observer.off(body);
                    return;
                }
            }
        });
    }
};

Controller.prototype.send = function(event, msg) {
    switch (event) {
        case consts.ACTION_PLAY:
            this.play();
            break;
        case consts.ACTION_PREV:
            this.prev();
            break;
        case consts.ACTION_NEXT:
            this.next();
            break;
        default:
            break;
    }
};

Controller.prototype.click = function(action) {
    if (this.selectors[action]) {
        this.triggerClick(this.selectors[action]);
        this.updateTrack();
    }
};

Controller.prototype.onReady = function() {
    this._bindElement(this.selectors.stateCont, "attrChanged", this.onStateChanged.bind(this));
    this._bindElement(this.selectors.artist, "domChanged", this.updateTrack.bind(this));
    this._bindElement(this.selectors.title, "domChanged", this.updateTrack.bind(this));

    this.triggerEvent(consts.ACTION_CONTEXT, {
        "title": this.title,
        "icon": this.icon,
        "source": location.href
    });
    this.onStateChanged();
};

Controller.prototype.onStateChanged = function(evt) {
    var state = this.getState();
    this.triggerEvent(consts.ACTION_STATE, state);
    this.updateTrack();
};

Controller.prototype.getState = function() {
    var elem = this._getElement(this.selectors.stateCont);
    return elem && elem.classList.contains(this.selectors.stateClass) ? consts.STATE_PLAYING : consts.STATE_PAUSED;
};

Controller.prototype.updateTrack = function() {
    var titleEl = this._getElement(this.selectors.title);
    var artistEl = this._getElement(this.selectors.artist);
    var title = titleEl && titleEl.innerText;
    var artist = artistEl && artistEl.innerText;
    var data = this.fixTrack({
        artist: artist,
        title: title
    });
    if (title || artist) {
        this.triggerEvent(consts.ACTION_TRACK, data);
    }
};

Controller.prototype.fixTrack = function(track) {
    if (!this.trackRegExp) {
        return track;
    }
    var match = this.trackRegExp.exec(track.title);
    if (match && match.title) {
        return {
            title: match.title,
            artist: match.artist
        };
    } else {
        return track;
    }
};

Controller.prototype.triggerClick = function(selector) {
    var element = this._getElement(selector);
    if (element) {
        var evt = document.createEvent('MouseEvents');
        evt.initEvent('click', true, true);
        element.dispatchEvent(evt);
    }
};

Controller.prototype.triggerEvent = function(event, data) {
    this.trigger(event, { event: event, data: data });
    this.trigger(consts.ACTION_BROADCAST, { event: event, data: data });
};

Controller.prototype._getElement = function(selector) {
    return document.querySelector(selector);
};

Controller.prototype._bindElement = function(selector, event, callback) {
    if (!selector) {
        return;
    }
    var element = document.querySelector(selector);
    if (element) {
        this.observer.on(element, event, callback);
    }
};

var ServiceController = function(conf) {
    Controller.call(this, conf);
    utils.extend(this, conf.overrides || {});
    this.base = Controller.prototype;
};
utils.inherit(ServiceController, Controller.prototype);

module.exports = ServiceController;

}
,"content/observer.js": function(module, exports, require, global) {
var eventize = require("../common/eventize");

var Observer = function(options) {
    this.inc = 0;
    this.targets = {};
    this.options = options || {};
};

Observer.options = {
    "attrChanged": {
        "attributes": true,
        "attributeFilter": ["class", "style"]
    },
    "domChanged": {
        "childList": true,
        "subtree": true,
        "attributes": true,
        "characterData": true
    }
};

Observer.prototype.on = function(element, event, callback) {
    if (isNaN(element.observerId)) {
        element.observerId = this.inc++;
    }
    var target = this.targets[element.observerId] || (this.targets[element.observerId] = {});
    if (!target.observer) {
        target.observer = new MutationObserver(this._onMutations.bind(this, target));
        eventize(target);
    }
    target.observer.observe(element, Observer.options[event]);
    target.on(event, callback);
};

Observer.prototype.off = function(element) {
    var target = this.targets[element.observerId];
    if (target.observer) {
        target.observer.disconnect();
        delete target.observer;
        delete target;
    }
};

Observer.prototype._onMutations = function(target, mutations) {
    if (target) {
        mutations = mutations || [];
        mutations.forEach(this._onMutation.bind(this, target));
    }
};

Observer.prototype._onMutation = function(target, mutation) {
    var eventName;
    switch (mutation.type) {
        case "attributes":
            eventName = "attrChanged";
            break;
        case "subtree":
        case "childList":
        case "characterData":
            eventName = "domChanged";
            break;
        default:
            break;
    }
    if (eventName) {
        target.trigger(eventName, mutation);
    }
};

module.exports = Observer;

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
}, {});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3NDb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6Ii9zb3VyY2VzL2pzIiwic291cmNlcyI6WyJjc0NvbnRyb2xsZXIuanMiLCJjb21tb24vY29uc3RzLmpzIiwiY29tbW9uL21lc3Nlbmdlci5qcyIsImNvbW1vbi93aW5NZXNzZW5nZXIuanMiLCJjb250ZW50L2NvbnRyb2xsZXIuanMiLCJjb250ZW50L29ic2VydmVyLmpzIiwiY29tbW9uL2V2ZW50aXplLmpzIiwiY29tbW9uL3V0aWxzLmpzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pCQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDNUlBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4RUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM5SkEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN2RUEsQUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9EQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7In0=
