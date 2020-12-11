var Mu = Mu || {};
Mu.conf = {
    title: "Deezer",
    domain: "*://www.deezer.com/*",
    icon: "https://music.yandex.ru/blocks/common/badge.deezer.png",
    selectors: {
        play: "#player .control-pause, #player .control-play",
        next: "#player .control-next",
        prev: "#player .control-prev",
        artist: ".player-track-artist .player-track-link",
        title: ".player-track-title .player-track-link",

        player: "#player",

        stateCont: "#player .control-play, #player .control-pause",
        stateClass: "control-pause"
    }
};
