var Mu = Mu || {};
Mu.conf = {
    title: "Youtube",
    domain: "*://www.youtube.com/*",
    icon: "https://music.yandex.ru/blocks/common/badge.youtube.png",
    trackRegExp: /(:<artist>.*)\s*-\s*(:<title>.*)/,
    selectors: {
        play: "#movie_player .ytp-play-button",
        next: "#movie_player .ytp-next-button",
        title: "#eow-title",

        player: "#movie_player",

        stateCont: "#movie_player",
        stateClass: "playing-mode"
    }
};
