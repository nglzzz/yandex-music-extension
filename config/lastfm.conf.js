var Mu = Mu || {};
Mu.conf = {
    title: "Last.fm",
    domain: "*://www.last.fm/*",
    icon: "https://music.yandex.ru/blocks/common/badge.lastfm.png",
    selectors: {
        play: ".player-bar-controls .js-play-pause",
        next: ".player-bar-controls .js-next",
        prev: ".player-bar-controls .js-previous",
        title: ".player-bar-now-playing .player-bar-track-name",
        artist: ".player-bar-now-playing .player-bar-artist-name",

        player: ".player-bar-controls",

        stateCont: ".player-bar-controls .js-play-pause",
        stateClass: "player-bar-btn--pause"
    },
    overrides: {
        onReady: function() {
            this._bindElement(".player-bar-track", "domChanged", function(evt) {
                if (!evt.addedNodes || !evt.addedNodes.length) {
                    return;
                }
                for (var i = 0; i < evt.addedNodes.length; i++) {
                    var element = evt.addedNodes[i];
                    if (typeof element.matches === "function"
                        && (element.matches(this.selectors.title) || element.matches(this.selectors.artist))) {
                        this.updateTrack();
                        return;
                    }
                }
            }.bind(this));
            this.base.onReady.call(this);
        }
    }
};
