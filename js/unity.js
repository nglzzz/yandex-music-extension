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

    require.call({moduleName: "unity.js"}, "unity.js");
})({"unity.js": function(module, exports, require, global) {
;(function() {
    var UnityObject = require("./unity/unityObject.js");
    var unityObject;

    // init Unity
    if (!("external" in window)) {
        window.external = {};
    }

    if (!("getUnityObject" in window.external)) {
        window.external.getUnityObject = function() {
            return unityObject || (unityObject = new UnityObject());
        };
    }

    window.external.extendUnityObject = function(params) {
        params = params || {};
        if (unityObject) {
            unityObject.MediaPlayer._setCallback("feedback", params.onFeedback)
        }
    };

}());

}
,"unity/unityObject.js": function(module, exports, require, global) {
var MediaPlayer = require("./mediaPlayer");

var UnityObject = function() {
    this.MediaPlayer = new MediaPlayer();
    this.Notification = new Notification();
    this.Launcher = new Launcher();
    this.MessagingIndicator = new MessagingIndicator();
};

UnityObject.prototype.init = function(params) {
    params = params || {};
    if (params.onInit) {
        params.onInit();
    }
    if (params.onInitExtended) {
        params.onInitExtended();
    }
};

// Заглушки чтоб не поломать сайты поддерживающие Unity.

UnityObject.prototype.addAction = function(actionName, onActionInvoked) {};
UnityObject.prototype.removeAction = function(actionName) {};
UnityObject.prototype.removeActions = function() {};

// Unity.MessagingIndicator

var MessagingIndicator = function() {
};

MessagingIndicator.prototype.showIndicator = function(name, indicatorProperties) {};
MessagingIndicator.prototype.clearIndicator = function(name) {};
MessagingIndicator.prototype.clearIndicators = function() {};

MessagingIndicator.prototype.addAction = function(actionName, onActionInvoked) {};
MessagingIndicator.prototype.removeAction = function(actionName) {};
MessagingIndicator.prototype.removeActions = function() {};

MessagingIndicator.prototype.onPresenceChanged = function(onPresenceChanged) {};
MessagingIndicator.prototype.presence = "";

// Unity.Notification

var Notification = function() {
};

Notification.prototype.showNotification = function(summary, body, optional, iconUrl) {};

// Unity.Launcher

var Launcher = function() {
};

Launcher.prototype.setCount = function(count) {};
Launcher.prototype.clearCount = function() {};

Launcher.prototype.setProgress = function(progress) {};
Launcher.prototype.clearProgress = function() {};

Launcher.prototype.setUrgent = function(urgent) {};

Launcher.prototype.addAction = function(actionName, onActionInvoked) {};
Launcher.prototype.removeAction = function(actionName) {};
Launcher.prototype.removeActions = function() {};

module.exports = UnityObject;

}
,"unity/mediaPlayer.js": function(module, exports, require, global) {
var consts = require("../common/consts");
var Msg = require("../common/winMessenger");

var MediaPlayer = function() {
    var self = this;
    self.callbacks = {};
    self.msg = new Msg(consts.SOURCE_INJECTED, consts.SOURCE_CONTENT, 1);
    self.msg.start();

    self.msg.on(consts.ACTION_NEXT, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_PREV, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_PLAY, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_LIKE, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_DISLIKE, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_VOLUME, self._invokeCallback.bind(self));
    self.msg.on(consts.ACTION_OPEN_LINK, self._invokeCallback.bind(self));
    self._sendMessage(consts.ACTION_CONNECTED);
    self._sendMessage(consts.ACTION_BTN_STATE, { button: consts.BUTTON_VOLUME, state: consts.BUTTON_STATE_VISIBLE });
};
MediaPlayer.prototype.PlaybackState = {
    "PLAYING": consts.STATE_PLAYING,
    "PAUSED": consts.STATE_PAUSED
};

MediaPlayer.prototype.onNext = function(callback) {
    this._setCallback(consts.ACTION_NEXT, callback);
};
MediaPlayer.prototype.onPrevious = function(callback) {
    this._setCallback(consts.ACTION_PREV, callback);
};
MediaPlayer.prototype.onPlayPause = function(callback) {
    this._setCallback(consts.ACTION_PLAY, callback);
};

MediaPlayer.prototype.setCanPlay = function(can) {
    this._sendMessage(consts.ACTION_BTN_STATE, { button: consts.BUTTON_PLAY, state: this._getButtonState(can) });
};
MediaPlayer.prototype.setCanPause = function(can) {
    //this._sendMessage({ action: consts.ACTION_BTN_STATE, button: consts.BUTTON_PLAY, data: can });
};
MediaPlayer.prototype.setCanGoNext = function(can) {
    this._sendMessage(consts.ACTION_BTN_STATE, { button: consts.BUTTON_NEXT, state: this._getButtonState(can) });
};
MediaPlayer.prototype.setCanGoPrev = function(can) {
    this._sendMessage(consts.ACTION_BTN_STATE, { button: consts.BUTTON_PREV, state: this._getButtonState(can) });
};

MediaPlayer.prototype.setTrack = function(data) {
    data = data || {};
    this._sendMessage(consts.ACTION_TRACK, {
        title: data.title,
        album: data.album,
        artist: data.artist,
        cover: data.artLocation,
        liked: data.liked,
        url: data.url,
        artistUrl: data.artistUrl
    });
};
MediaPlayer.prototype.setPlaybackState = function(state) {
    this._sendMessage(consts.ACTION_STATE, state);
};
MediaPlayer.prototype.getPlaybackState = function(callback) {
    if (callback) {
        callback(this.PlaybackState.PLAYING);
    }
};

/** extended unity methods */

MediaPlayer.prototype.onLike = function(callback) {
    this._setCallback(consts.ACTION_LIKE, callback);
};
MediaPlayer.prototype.onDislike = function(callback) {
    this._setCallback(consts.ACTION_DISLIKE, callback);
};
MediaPlayer.prototype.onNavigateTo = function(callback) {
    this._setCallback(consts.ACTION_OPEN_LINK, callback);
};
MediaPlayer.prototype.onVolume = function(callback) {
    this._setCallback(consts.ACTION_VOLUME, callback);
};

MediaPlayer.prototype.setContext = function(data) {
    data = data || {};
    if (!data.url) {
        data.url = location.href;
    }
    this._sendMessage(consts.ACTION_CONTEXT, data);
};
MediaPlayer.prototype.setVolume = function(data) {
    this._sendMessage(consts.ACTION_VOLUME, data);
};

/** @private */

MediaPlayer.prototype._getButtonState = function(can) {
    return can ? consts.BUTTON_STATE_ENABLED : consts.BUTTON_STATE_DISABLED;
};
MediaPlayer.prototype._setCallback = function(action, callback) {
    this.callbacks[action] = callback;
};
MediaPlayer.prototype._invokeCallback = function(msg) {
    if (typeof this.callbacks[msg.event] === "function") {
        this.callbacks[msg.event].call(null, msg);
    }
};
MediaPlayer.prototype._sendMessage = function(event, data) {
    this.msg.send(event, data);
};

module.exports = MediaPlayer;

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
}, {});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidW5pdHkuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZXMvanMiLCJzb3VyY2VzIjpbInVuaXR5LmpzIiwidW5pdHkvdW5pdHlPYmplY3QuanMiLCJ1bml0eS9tZWRpYVBsYXllci5qcyIsImNvbW1vbi9jb25zdHMuanMiLCJjb21tb24vd2luTWVzc2VuZ2VyLmpzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFEQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDeEJBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ25FQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pIQSxBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0RBLEFBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzsifQ==
