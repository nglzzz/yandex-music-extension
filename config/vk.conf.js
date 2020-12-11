var Mu = Mu || {};
Mu.conf = {
    title: "Вконтакте",
    domain: "*://vk.com/*",
    icon: "https://music.yandex.ru/blocks/common/badge.vk.png",
    trackRegExp: /(:<artist>.*)\s*–\s*(:<title>.*)/,
    selectors: {
        play: "#top_audio_player .top_audio_player_play",
        next: "#top_audio_player .top_audio_player_next",
        prev: "#top_audio_player .top_audio_player_prev",
        title: "#top_audio_player .top_audio_player_title",

        player: "#top_audio_player",

        stateCont: "#top_audio_player",
        stateClass: "top_audio_player_playing"
    },

    overrides: {
        onReady: function() {
            this._bindElement("#top_audio_player .top_audio_player_title_wrap", "domChanged", function(evt) {
                if (!evt.addedNodes || !evt.addedNodes.length) {
                    return;
                }
                for (var i = 0; i < evt.addedNodes.length; i++) {
                    var element = evt.addedNodes[i];
                    if (typeof element.matches === "function"
                        && element.matches(this.selectors.title)) {
                        this.updateTrack();
                        return;
                    }
                }
            }.bind(this));
            this.base.onReady.call(this);
        },
        updateTrack: function() {
            var self = this;
            setTimeout(function() {
                self.base.updateTrack.call(self);
            }, 200);
        }
    }
};
