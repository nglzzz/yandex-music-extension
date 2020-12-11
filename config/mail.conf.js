var Mu = Mu || {};
Mu.conf = {
    title: "Mail Music",
    domain: "*://my.mail.ru/music/*",
    //icon: "https://music.yandex.ru/blocks/common/badge.play-google.png",
    selectors: {
        play: ".l-music__player .play",
        next: ".l-music__player .next",
        prev: ".l-music__player .prev",
        artist: ".l-music__player .author",
        title: ".l-music__player .name",

        player: ".l-music__player",

        stateCont: ".l-music__player-wrapper",
        stateClass: "playing"
    },
    overrides: {
        onReady: function() {
            this._bindElement(".l-music__player .label", "domChanged", function(evt) {
                if (!evt.addedNodes || !evt.addedNodes.length) {
                    return;
                }
                for (var i = 0; i < evt.addedNodes.length; i++) {
                    var element = evt.addedNodes[i];
                    if (typeof element.matches === "function" && element.matches(".l-music__player .title")) {
                        this.updateTrack();
                        return;
                    }
                }
            }.bind(this));
            this.base.onReady.call(this);
        }
    }
};
