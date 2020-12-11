var Mu = Mu || {};
Mu.conf = {
    title: "Zvooq",
    domain: "*://zvooq.ru/*",
    icon: "https://music.yandex.ru/blocks/common/badge.zvook.png",
    trackRegExp: /(:<artist>.*)\s*—\s*(:<title>.*)/,
    selectors: {
        play: ".topPanel-center .topPanelPlay, .topPanel .topPanelPause",
        prev: ".topPanel-center .topPanelRewind",
        next: ".topPanel-center .topPanelForward",
        title: ".topPanelTimeline .topPanelTimeline-title",
        player: ".topPanel-center"
    },

    overrides: {
        onReady: function() {
            this._bindElement(this.selectors.player, "domChanged", function(evt) {
                if (!evt.addedNodes || !evt.addedNodes.length) {
                    return;
                }
                for (var i = 0; i < evt.addedNodes.length; i++) {
                    var element = evt.addedNodes[i];
                    if (typeof element.matches === "function" && element.matches(this.selectors.play)) {
                        this.onStateChanged();
                        return;
                    }
                }
            }.bind(this));
            this.base.onReady.call(this);
        },

        getState: function() {
            var elem = this._getElement(".topPanel .topPanelPlay");
            return elem ? 1 : 0;
        }
    }
};
