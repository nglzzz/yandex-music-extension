var Mu = Mu || {};
Mu.conf = {
    title: "Zv.fm",
    domain: "*://zv.fm/*",
    icon: "https://music.yandex.ru/blocks/common/badge.zvfm.png",
    trackRegExp: /(:<artist>.*)\s*—\s*(:<title>.*)/,
    selectors: {
        play: "#player .player-nav-play",
        next: "#player .player-nav-next",
        prev: "#player .player-nav-prev",
        title: "#player .player-song-name",

        player: "#player",

        stateCont: "#player .player-nav-play",
        stateClass: "stop"
    }
};
