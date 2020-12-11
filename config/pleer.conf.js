var Mu = Mu || {};
Mu.conf = {
    title: "Pleer",
    domain: "*://pleer.com/*",
    icon: "https://music.yandex.ru/blocks/common/badge.pleer.png",
    trackRegExp: /(?:\d\d:\d\d)\s*(:<artist>.*)\s*—\s*(:<title>.*)\s*\(\d\d:\d\d\)/,
    selectors: {
        play: "#play",
        title: "#player .now-playing",
        next: "#fw",
        prev: "#rw",
        player: "#player",

        stateCont: "#play",
        stateClass: "pause"
    }
};
